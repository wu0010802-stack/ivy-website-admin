from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

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
from app.common.timezones import now_utc, slot_start_utc
from app.operations import analytics_service
from app.operations.models import AnalyticsEventType


# 規格 222：人工待確認的 slot 案件占位 24 小時。
HOLD_TTL = timedelta(hours=24)


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


async def get_or_create_config(
    db: AsyncSession, campus_key: str, *, for_update: bool = False
) -> BookingConfig:
    """for_update=True 會鎖住這一列。後台存檔一定要鎖：版本比對與 UPDATE
    落在同一把鎖內，兩個人同時存檔才不會雙雙通過 expected_version 檢查、
    後送出的那筆把前一筆靜默蓋掉（例如「暫停收件」被改回去）。"""
    stmt = select(BookingConfig).where(BookingConfig.campus_key == campus_key)
    if for_update:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    config = result.scalar_one_or_none()
    if config is None:
        config = BookingConfig(
            campus_key=campus_key,
            mode=BookingMode.PAUSED,
            version=0,
            slots_auto_confirm=False,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(config)
        await db.flush()
        if for_update:
            # 重新以 FOR UPDATE 鎖住剛建立的列，與其他併發交易序列化。
            result = await db.execute(
                select(BookingConfig)
                .where(BookingConfig.campus_key == campus_key)
                .with_for_update()
            )
            config = result.scalar_one()
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
    slots_auto_confirm: bool = False,
) -> BookingConfig:
    if config.version != expected_version:
        raise ConfigVersionConflict()

    _validate_mode_fields(mode, line_url, phone, external_url)

    config.mode = mode
    config.line_url = line_url
    config.phone = phone
    config.external_url = external_url
    config.message = message
    config.slots_auto_confirm = slots_auto_confirm
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
    hold_expires_at = None
    now = now_utc()

    if config.mode == BookingMode.SLOTS:
        if not slot_id:
            raise BookingUnavailable()
        slot = await slot_service.get_slot_for_update(db, uuid.UUID(slot_id))
        if slot is None or slot.campus_key != campus_key or slot.closed:
            raise SlotFull()
        # 時間窗與公開查詢用同一份判斷：已過去或不在開放區間的時段不能被
        # 預約，否則名額會被永久佔住、也永遠不會有人來。
        if not slot_service.is_publicly_bookable(slot, now):
            raise slot_service.SlotNotBookable()
        booked = await slot_service.count_booked(db, slot.id)
        if booked >= slot.capacity:
            raise SlotFull()
        if config.slots_auto_confirm:
            status = VisitRequestStatus.CONFIRMED.value
            confirmed_at = now
        else:
            # 規格 197：人工確認模式下送出只代表「已收到時段申請，待園方
            # 確認」，不是「預約成立」。規格 222：占位 24 小時，且不得
            # 超過參觀開始時間。
            status = VisitRequestStatus.PENDING_CONFIRMATION.value
            hold_expires_at = min(
                now + HOLD_TTL, slot_start_utc(slot.slot_date, slot.start_time)
            )
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
        hold_expires_at=hold_expires_at,
        created_at=now,
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
    await analytics_service.record_internal_event(
        db, event_type=AnalyticsEventType.REQUEST_CREATED, campus_key=campus_key
    )
    if status == VisitRequestStatus.CONFIRMED.value:
        enqueue_outbox(
            db,
            visit_request.id,
            "visit_request_confirmed",
            {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
        )
        await analytics_service.record_internal_event(
            db, event_type=AnalyticsEventType.VISIT_CONFIRMED, campus_key=campus_key
        )
    elif status == VisitRequestStatus.PENDING_CONFIRMATION.value:
        # 通知園方有一筆待確認的時段申請——不是「已確認」，文案不同，
        # 也不計入 VISIT_CONFIRMED 成效統計。
        enqueue_outbox(
            db,
            visit_request.id,
            "visit_request_pending_confirmation",
            {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
        )
    await db.flush()
    return visit_request, True
