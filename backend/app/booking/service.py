from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import slot_service
from app.booking.models import (
    BookingConfig,
    BookingMode,
    VisitRequest,
    VisitRequestEvent,
    VisitRequestStatus,
)
from app.booking.exceptions import SlotFull
from app.booking.outbox import enqueue_outbox


class ConfigVersionConflict(Exception):
    pass


class ModeFieldMissing(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class BookingConfigVersionChanged(Exception):
    """對應公開提交時的 BOOKING_CONFIG_CHANGED：使用者手上的 config_version
    已經過期（園方剛好改了設定）。"""


class BookingUnavailable(Exception):
    """對應 BOOKING_UNAVAILABLE：目前模式不接受公開表單提交
    （line/phone/external/paused，以及階段 C 尚未開放的 slots）。"""


class IdempotencyConflict(Exception):
    """同一個 idempotency key 但 body 不同——不能悄悄當成同一筆處理。"""


_MODE_REQUIRED_FIELD = {
    BookingMode.LINE: "line_url",
    BookingMode.PHONE: "phone",
    BookingMode.EXTERNAL: "external_url",
}

_MODE_FIELD_LABEL = {
    "line_url": "LINE 官方帳號連結",
    "phone": "電話",
    "external_url": "外部預約網址",
}


async def get_or_create_config(db: AsyncSession, campus_key: str) -> BookingConfig:
    result = await db.execute(select(BookingConfig).where(BookingConfig.campus_key == campus_key))
    config = result.scalar_one_or_none()
    if config is None:
        config = BookingConfig(
            campus_key=campus_key,
            mode=BookingMode.PAUSED,
            version=0,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(config)
        await db.flush()
    return config


def _validate_mode_fields(
    mode: BookingMode, line_url: str | None, phone: str | None, external_url: str | None
) -> None:
    required_field = _MODE_REQUIRED_FIELD.get(mode)
    if required_field is None:
        return
    values = {"line_url": line_url, "phone": phone, "external_url": external_url}
    if not values[required_field]:
        raise ModeFieldMissing(f"啟用此模式前必須先填寫「{_MODE_FIELD_LABEL[required_field]}」")


async def update_config(
    db: AsyncSession,
    config: BookingConfig,
    *,
    mode: BookingMode,
    line_url: str | None,
    phone: str | None,
    external_url: str | None,
    message: str | None,
    expected_version: int,
    updated_by: uuid.UUID,
) -> BookingConfig:
    if config.version != expected_version:
        raise ConfigVersionConflict()

    _validate_mode_fields(mode, line_url, phone, external_url)

    config.mode = mode
    config.line_url = line_url
    config.phone = phone
    config.external_url = external_url
    config.message = message
    config.version += 1
    config.updated_at = datetime.now(timezone.utc)
    config.updated_by = updated_by
    await db.flush()
    return config


def _hash_payload(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def submit_visit_request(
    db: AsyncSession,
    *,
    campus_key: str,
    idempotency_key: str,
    payload: dict,
    config_version: int,
) -> tuple[VisitRequest, bool]:
    """回傳 (visit_request, is_new)。is_new=False 代表這是重播（同 key 同
    payload），呼叫端應回 200 而非 201，且不得重新寫入任何列。"""
    payload_hash = _hash_payload(payload)

    # 先查是否為重播請求，避免對已存在的案件重新走一次驗證/寫入。
    result = await db.execute(
        select(VisitRequest).where(
            VisitRequest.campus_key == campus_key,
            VisitRequest.idempotency_key == idempotency_key,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.payload_hash != payload_hash:
            raise IdempotencyConflict()
        return existing, False

    # 鎖住這個校區的設定列，確保驗證期間不會跟「園方剛好改設定」的
    # 交易交錯——同一份鎖也保護了 config_version 重驗的正確性。
    result = await db.execute(
        select(BookingConfig).where(BookingConfig.campus_key == campus_key).with_for_update()
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise BookingUnavailable()

    if config.version != config_version:
        raise BookingConfigVersionChanged()

    if config.mode not in (BookingMode.INQUIRY, BookingMode.SLOTS):
        raise BookingUnavailable()

    slot_id = payload.get("slot_id")
    status = VisitRequestStatus.NEW.value
    confirmed_at = None

    if config.mode == BookingMode.SLOTS:
        if not slot_id:
            raise BookingUnavailable()
        slot = await slot_service.get_slot_for_update(db, uuid.UUID(slot_id))
        if slot is None or slot.campus_key != campus_key or slot.closed:
            raise SlotFull()
        booked = await slot_service.count_booked(db, slot.id)
        if booked >= slot.capacity:
            raise SlotFull()
        status = VisitRequestStatus.CONFIRMED.value
        confirmed_at = datetime.now(timezone.utc)
    else:
        slot_id = None

    visit_request = VisitRequest(
        id=uuid.uuid4(),
        campus_key=campus_key,
        idempotency_key=idempotency_key,
        payload_hash=payload_hash,
        config_version=config_version,
        parent_name=payload["parent_name"],
        phone=payload["phone"],
        age=payload.get("age"),
        preferred_time=payload.get("preferred_time"),
        questions=payload.get("questions"),
        consent_given=payload["consent_given"],
        status=status,
        slot_id=uuid.UUID(slot_id) if slot_id else None,
        confirmed_at=confirmed_at,
        created_at=datetime.now(timezone.utc),
    )
    db.add(visit_request)
    try:
        await db.flush()
    except IntegrityError:
        # 真正的競爭條件：兩個請求都通過了前面的「查無既有案件」檢查，
        # 同時嘗試 INSERT 同一組 (campus_key, idempotency_key)。唯一鍵
        # 約束擋掉了其中一個，這裡把它當成一次安全重播處理，而不是讓
        # 例外往外炸掉、回應 500。
        await db.rollback()
        result = await db.execute(
            select(VisitRequest).where(
                VisitRequest.campus_key == campus_key,
                VisitRequest.idempotency_key == idempotency_key,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            raise
        if existing.payload_hash != payload_hash:
            raise IdempotencyConflict() from None
        return existing, False

    db.add(
        VisitRequestEvent(
            id=uuid.uuid4(),
            visit_request_id=visit_request.id,
            event_type="created",
            created_at=datetime.now(timezone.utc),
        )
    )
    enqueue_outbox(
        db,
        visit_request.id,
        "visit_request_created",
        {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
    )
    if status == VisitRequestStatus.CONFIRMED.value:
        enqueue_outbox(
            db,
            visit_request.id,
            "visit_request_confirmed",
            {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
        )
    await db.flush()
    return visit_request, True
