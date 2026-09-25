from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import consent, history, readiness, slot_service
from app.booking.models import (
    BookingConfig,
    BookingMode,
    VisitRequest,
    VisitRequestSource,
    VisitRequestStatus,
)
from app.booking.exceptions import SlotClosed, SlotFull, SlotNotFound
from app.booking.outbox import enqueue_outbox
from app.booking.schemas import CONTACT_TIME_LABELS
from app.common.timezones import now_utc, slot_start_utc
from app.operations import analytics_service
from app.operations.models import AnalyticsEventType


# 規格 222：人工待確認的 slot 案件占位 24 小時。
HOLD_TTL = timedelta(hours=24)


class ConfigVersionConflict(Exception):
    pass


class BookingConfigVersionChanged(Exception):
    """對應公開提交時的 BOOKING_CONFIG_CHANGED：使用者手上的 config_version
    已經過期（園方剛好改了設定）。"""


class BookingUnavailable(Exception):
    """對應 BOOKING_UNAVAILABLE：目前模式不接受公開表單提交
    （line/phone/external/paused，以及階段 C 尚未開放的 slots）。"""


class IdempotencyConflict(Exception):
    """同一個 idempotency key 但 body 不同——不能悄悄當成同一筆處理。"""


class PartySizeRequired(Exception):
    """官網新送的需求沒有參觀人數（規格 L194）。對應 422。"""


# 稽核紀錄記「修改前後」的完整設定（規格 L181）。都是分校公開資訊，沒有家長個資。
CONFIG_AUDIT_FIELDS = (
    "mode",
    "line_url",
    "phone",
    "external_url",
    "message",
    "slots_auto_confirm",
    "parent_change_deadline_hours",
)


def config_snapshot(config: BookingConfig) -> dict:
    snapshot = {field: getattr(config, field) for field in CONFIG_AUDIT_FIELDS}
    snapshot["mode"] = BookingMode(snapshot["mode"]).value
    return snapshot


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
    parent_change_deadline_hours: int | None = None,
) -> BookingConfig:
    if config.version != expected_version:
        raise ConfigVersionConflict()

    # 不符啟用條件丟 readiness.ModeNotReady（逐條列出原因）。
    await readiness.check_update(
        db, config, mode=mode, line_url=line_url, phone=phone, external_url=external_url, message=message
    )

    config.mode = mode
    config.line_url = line_url
    config.phone = phone
    config.external_url = external_url
    config.message = message
    config.slots_auto_confirm = slots_auto_confirm
    if parent_change_deadline_hours is not None:
        config.parent_change_deadline_hours = parent_change_deadline_hours
    config.version += 1
    config.updated_at = datetime.now(timezone.utc)
    config.updated_by = updated_by
    await db.flush()
    return config


def _hash_payload(payload: dict) -> str:
    # 新 schema 的選填預設值不能改變舊 payload 的 hash。只排除這次新增的
    # 空欄位，保留既有 age/preferred_time/questions/slot_id 的序列化規則。
    canonical_payload = payload.copy()
    # 參觀人數是家長填的內容，同一把 key 改了人數就是不同的送單（回 409）；
    # 舊的重試請求沒有這個欄位，空值不進 hash，舊 hash 不變。
    for field in ("child_name", "child_birthdate", "email", "referral_sources", "party_size"):
        if canonical_payload.get(field) in (None, []):
            canonical_payload.pop(field, None)
    # 同意說明版本不是家長填的資料：重送時只要內容相同就是同一筆，案件記的是
    # 第一次成功送出時的版本。呼叫端應該另外傳，這裡保險再排除一次。
    canonical_payload.pop("consent_revision_id", None)
    # 2026-09-24 起方便聯絡時段存代碼，但更新前的官網送的是中文標籤，已存的
    # hash 也是用標籤算的。hash 一律換回標籤再算，跨版本的重送（同一個
    # Idempotency-Key）才會認得是同一筆，不會誤判成不同內容回 409。
    # 年齡不用換：更新前後都是 "3-4" 這類值（現行表單已不送年齡）。
    time_code = canonical_payload.get("preferred_time")
    if time_code in CONTACT_TIME_LABELS:
        canonical_payload["preferred_time"] = CONTACT_TIME_LABELS[time_code]
    canonical = json.dumps(canonical_payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def submit_visit_request(
    db: AsyncSession,
    *,
    campus_key: str,
    idempotency_key: str,
    payload: dict,
    config_version: int,
    consent_revision_id: uuid.UUID | None = None,
) -> tuple[VisitRequest, bool]:
    """回傳 (visit_request, is_new)。is_new=False 代表這是重播（同 key 同
    payload），呼叫端應回 200 而非 201，且不得重新寫入任何列。

    consent_revision_id 是家長看到的同意說明版本，新建案件時要是目前發布中
    的內容（consent.accept_submitted），否則丟 consent.ConsentVersionChanged；
    重播不檢查——已成功建立的案件先回原結果（規格 L183）。"""
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

    if payload.get("party_size") is None:
        raise PartySizeRequired()

    try:
        accepted_consent = await consent.accept_submitted(db, consent_revision_id)
    except consent.ConsentUnavailable as exc:
        raise BookingUnavailable() from exc

    slot_id = payload.get("slot_id")
    status = VisitRequestStatus.NEW.value
    confirmed_at = None
    hold_expires_at = None
    now = now_utc()

    if config.mode == BookingMode.SLOTS:
        if not slot_id:
            raise BookingUnavailable()
        slot = await slot_service.get_slot_for_update(db, uuid.UUID(slot_id))
        if slot is None or slot.campus_key != campus_key:
            raise SlotNotFound()
        if slot.closed:
            raise SlotClosed()
        # 時間窗與公開查詢用同一份判斷：已過去或不在開放區間的時段不能被
        # 預約，否則名額會被永久佔住、也永遠不會有人來。
        if not slot_service.is_publicly_bookable(slot, now, **slot_service.window_for(config)):
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
        child_name=payload.get("child_name"),
        child_birthdate=(
            date.fromisoformat(payload["child_birthdate"])
            if payload.get("child_birthdate")
            else None
        ),
        email=payload.get("email"),
        referral_sources=payload.get("referral_sources", []),
        age=payload.get("age"),
        preferred_time=payload.get("preferred_time"),
        questions=payload.get("questions"),
        party_size=payload.get("party_size"),
        consent_given=payload["consent_given"],
        consent_revision_id=accepted_consent,
        consent_accepted_at=now,
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

    # 家長從官網送出：沒有帳號，歷程記來源為家長。slots 模式送出當下就占位
    # （或自動確認），after 帶時段。
    history.record_event(
        db,
        visit_request.id,
        "created",
        actor=history.PARENT,
        after={"status": status, "slot": history.slot_brief(slot) if slot_id else None},
    )
    enqueue_outbox(
        db,
        visit_request.id,
        "visit_request_created",
        {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
    )
    await analytics_service.record_internal_event(
        db, event_type=AnalyticsEventType.REQUEST_CREATED, campus_key=campus_key, visit_request=visit_request
    )
    if status == VisitRequestStatus.CONFIRMED.value:
        enqueue_outbox(
            db,
            visit_request.id,
            "visit_request_confirmed",
            {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
        )
        await analytics_service.record_internal_event(
            db, event_type=AnalyticsEventType.VISIT_CONFIRMED, campus_key=campus_key, visit_request=visit_request
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


# 後台補登與官網表單共用 (campus_key, idempotency_key) 唯一鍵；加前綴分開
# 兩個命名空間，家長端送來的 key 永遠不會撞到或重播出人員補登的案件。
MANUAL_IDEMPOTENCY_PREFIX = "admin:"


async def create_manual_visit_request(
    db: AsyncSession,
    *,
    campus_key: str,
    idempotency_key: str,
    payload: dict,
    source: VisitRequestSource,
    created_by: uuid.UUID,
) -> tuple[VisitRequest, bool]:
    """人員補登一筆案件，狀態一律從 new 開始（要排時段由呼叫端接著走
    confirm_with_slot，容量規則與一般確認完全相同）。不看預約模式、不寫
    「新需求」通知（登錄的人自己就是承辦人），也不計入官網成效統計——
    成效看的是官網帶來的需求，混進電話補登會讓轉換率失真。

    回傳 (visit_request, is_new)；同一個 key 重送回原案件，不重複建立。"""
    key = f"{MANUAL_IDEMPOTENCY_PREFIX}{idempotency_key}"
    payload_hash = _hash_payload(payload)

    async def _find_existing() -> VisitRequest | None:
        result = await db.execute(
            select(VisitRequest).where(
                VisitRequest.campus_key == campus_key, VisitRequest.idempotency_key == key
            )
        )
        return result.scalar_one_or_none()

    existing = await _find_existing()
    if existing is not None:
        if existing.payload_hash != payload_hash:
            raise IdempotencyConflict()
        return existing, False

    config = await get_or_create_config(db, campus_key)
    now = now_utc()
    visit_request = VisitRequest(
        id=uuid.uuid4(),
        campus_key=campus_key,
        idempotency_key=key,
        payload_hash=payload_hash,
        config_version=config.version,
        parent_name=payload["parent_name"],
        phone=payload["phone"],
        child_name=payload.get("child_name"),
        child_birthdate=(
            date.fromisoformat(payload["child_birthdate"])
            if payload.get("child_birthdate")
            else None
        ),
        email=payload.get("email"),
        referral_sources=payload.get("referral_sources", []),
        age=payload.get("age"),
        preferred_time=payload.get("preferred_time"),
        questions=payload.get("questions"),
        party_size=payload.get("party_size"),
        # 人員向家長說明並取得同意後代勾；沒有官網同意說明版本。
        consent_given=payload["consent_given"],
        consent_accepted_at=now,
        status=VisitRequestStatus.NEW.value,
        source=source.value,
        created_by=created_by,
        # 誰接的電話誰先承辦，之後可以在案件頁改派。
        assigned_staff_id=created_by,
        created_at=now,
    )
    db.add(visit_request)
    try:
        await db.flush()
    except IntegrityError:
        # 同一張補登表單連點兩次、兩個請求同時通過上面的查詢。
        await db.rollback()
        existing = await _find_existing()
        if existing is None:
            raise
        if existing.payload_hash != payload_hash:
            raise IdempotencyConflict() from None
        return existing, False

    history.record_event(
        db,
        visit_request.id,
        "created",
        actor=history.Actor.staff(created_by),
        after={"status": visit_request.status, "source": source.value},
    )
    await db.flush()
    return visit_request, True
