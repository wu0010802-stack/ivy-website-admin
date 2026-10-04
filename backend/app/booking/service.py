from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import access_service, history, readiness, slot_service
from app.booking.models import (
    BookingConfig,
    BookingMode,
    VisitRequest,
    VisitRequestSource,
    VisitRequestStatus,
    VisitSlot,
)
from app.booking.exceptions import SlotClosed, SlotFull, SlotNotFound
from app.booking.outbox import PARENT_VISIT_BOOKED, enqueue_outbox, enqueue_parent_email
from app.booking.schemas import CONTACT_TIME_LABELS
from app.common.timezones import now_utc
from app.operations import analytics_service
from app.operations.models import AnalyticsEventType


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


class PhoneSubmissionLimit(Exception):
    """同一校同一支手機在窗口內建立的案件已達上限。對應 429 RATE_LIMITED。"""

    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("phone submission limit")


# 稽核紀錄記「修改前後」的完整設定（規格 L181）。都是分校公開資訊，沒有家長個資。
CONFIG_AUDIT_FIELDS = (
    "mode",
    "line_url",
    "phone",
    "external_url",
    "message",
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
        # 還沒有設定列的校區，第一次被讀時才建。兩個請求同時第一次讀（例如
        # 後台時段頁同時讀預約方式與每週規則、官網同頁兩處都讀）時，一般的
        # INSERT 會讓慢的那個撞主鍵回 500；ON CONFLICT DO NOTHING 讓它等對方
        # 交易結束後什麼都不做，再讀回同一列。
        await db.execute(
            pg_insert(BookingConfig)
            .values(
                campus_key=campus_key,
                mode=BookingMode.PAUSED,
                version=0,
                slots_auto_confirm=False,
                updated_at=datetime.now(timezone.utc),
            )
            .on_conflict_do_nothing(index_elements=[BookingConfig.campus_key])
        )
        # for_update 時重新以 FOR UPDATE 鎖住這一列，與其他併發交易序列化。
        result = await db.execute(stmt)
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
    # 官網只剩自選場次、送出即成立；欄位保留（不刪），固定為 True。
    config.slots_auto_confirm = True
    if parent_change_deadline_hours is not None:
        config.parent_change_deadline_hours = parent_change_deadline_hours
    config.version += 1
    config.updated_at = datetime.now(timezone.utc)
    config.updated_by = updated_by
    await db.flush()
    return config


# payload hash 的專用金鑰由 session secret 衍生（不直接拿 session secret 當
# HMAC 金鑰，兩種用途互不影響）。
_PAYLOAD_HASH_PURPOSE = b"ivy-website:visit-request-payload-hash:v1"


def payload_hash_key(secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), _PAYLOAD_HASH_PURPOSE, hashlib.sha256).digest()


def _canonical_payload(payload: dict) -> bytes:
    # 新 schema 的選填預設值不能改變舊 payload 的 hash。只排除這次新增的
    # 空欄位，保留既有 age/preferred_time/questions/slot_id 的序列化規則。
    canonical_payload = payload.copy()
    # 參觀人數是家長填的內容，同一把 key 改了人數就是不同的送單（回 409）；
    # 舊的重試請求沒有這個欄位，空值不進 hash，舊 hash 不變。
    for field in ("child_name", "child_birthdate", "email", "referral_sources", "party_size"):
        if canonical_payload.get(field) in (None, []):
            canonical_payload.pop(field, None)
    # 同意說明版本與 Turnstile token 不是家長填的資料：重送時只要內容相同就是
    # 同一筆，案件記的是第一次成功送出時的版本；token 每次都不同。呼叫端應該
    # 另外傳，這裡保險再排除一次。
    canonical_payload.pop("consent_revision_id", None)
    canonical_payload.pop("turnstile_token", None)
    # 2026-09-24 起方便聯絡時段存代碼，但更新前的官網送的是中文標籤，已存的
    # hash 也是用標籤算的。hash 一律換回標籤再算，跨版本的重送（同一個
    # Idempotency-Key）才會認得是同一筆，不會誤判成不同內容回 409。
    # 年齡不用換：更新前後都是 "3-4" 這類值（現行表單已不送年齡）。
    time_code = canonical_payload.get("preferred_time")
    if time_code in CONTACT_TIME_LABELS:
        canonical_payload["preferred_time"] = CONTACT_TIME_LABELS[time_code]
    return json.dumps(canonical_payload, sort_keys=True, ensure_ascii=True).encode("utf-8")


def _payload_hash(payload: dict, key: bytes) -> str:
    """2026-09-29 起存 HMAC-SHA256。裸 SHA-256 在匿名化之後仍能用低熵的稱呼
    ＋手機暴力還原（稽核 payload-hash-survives-anonymization）。"""
    return hmac.new(key, _canonical_payload(payload), hashlib.sha256).hexdigest()


def _legacy_payload_hash(payload: dict) -> str:
    """2026-09-29 以前存的裸 SHA-256。只用來比對：部署前建立的案件，部署
    當下的重送（同一個 Idempotency-Key）仍要認得是同一筆。"""
    return hashlib.sha256(_canonical_payload(payload)).hexdigest()


def _same_payload(stored_hash: str, payload: dict, key: bytes) -> bool:
    return hmac.compare_digest(stored_hash, _payload_hash(payload, key)) or hmac.compare_digest(
        stored_hash, _legacy_payload_hash(payload)
    )


async def _find_by_idempotency_key(db: AsyncSession, campus_key: str, idempotency_key: str) -> VisitRequest | None:
    result = await db.execute(
        select(VisitRequest).where(
            VisitRequest.campus_key == campus_key,
            VisitRequest.idempotency_key == idempotency_key,
        )
    )
    return result.scalar_one_or_none()


async def find_replay(
    db: AsyncSession, *, campus_key: str, idempotency_key: str, payload: dict, hash_key: bytes
) -> VisitRequest | None:
    """不上鎖的重播查詢：同 key 同內容回既有案件，同 key 不同內容丟
    IdempotencyConflict，查無回 None。公開送單在限流、機器人驗證與上限之前
    先查，重送不吃額度、也不再驗一次 Turnstile（token 只能用一次）。"""
    existing = await _find_by_idempotency_key(db, campus_key, idempotency_key)
    if existing is None:
        return None
    if not _same_payload(existing.payload_hash, payload, hash_key):
        raise IdempotencyConflict()
    return existing


async def _validate_submission(
    db: AsyncSession,
    config: BookingConfig | None,
    *,
    campus_key: str,
    payload: dict,
    config_version: int,
    now: datetime,
    lock_slot: bool,
) -> VisitSlot:
    """送單的業務檢查（預檢與上鎖建立共用，錯誤順序一致）。回傳要占用的時段。
    lock_slot=True 時鎖住時段列。

    2026-10-02 業主裁定官網預約不用勾選同意：不再要求、也不再比對同意說明版本。"""
    if config is None:
        raise BookingUnavailable()

    if config.version != config_version:
        raise BookingConfigVersionChanged()

    if config.mode != BookingMode.SLOTS:
        raise BookingUnavailable()

    slot_id = payload["slot_id"]
    if lock_slot:
        slot = await slot_service.get_slot_for_update(db, uuid.UUID(slot_id))
    else:
        slot = await db.get(VisitSlot, uuid.UUID(slot_id))
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
    return slot


async def precheck_submission(
    db: AsyncSession,
    *,
    campus_key: str,
    payload: dict,
    config_version: int,
) -> bool:
    """不上鎖的預檢：與上鎖建立同一份檢查、丟同樣的例外。註定失敗的送單
    （設定已變、時段已滿…）在機器人驗證與上限計數之前就擋掉，
    不會白白用掉 Turnstile token 或上限額度。上鎖建立時會再驗一次。

    回傳這筆送單會不會占用時段名額（slots 模式）。"""
    config = await db.get(BookingConfig, campus_key)
    slot = await _validate_submission(
        db,
        config,
        campus_key=campus_key,
        payload=payload,
        config_version=config_version,
        now=now_utc(),
        lock_slot=False,
    )
    return slot is not None


async def submit_visit_request(
    db: AsyncSession,
    *,
    campus_key: str,
    idempotency_key: str,
    payload: dict,
    config_version: int,
    hash_key: bytes,
    phone_limit: tuple[int, timedelta] | None = None,
    access_secret: str,
) -> tuple[VisitRequest, bool]:
    """回傳 (visit_request, is_new)。is_new=False 代表這是重播（同 key 同
    payload），呼叫端應回 200 而非 201，且不得重新寫入任何列。

    phone_limit=(上限, 窗口)：同校同一支手機在窗口內最多建立幾筆，超過丟
    PhoneSubmissionLimit。在校區設定列鎖內用請求自己的連線計數，同一校的送單
    在這裡排隊，併發送單不會一起越過上限（稽核 phone-bucket-lost-atomicity），
    也不必在鎖內呼叫限流器；重播在上鎖前就返回，不佔額度。

    這裡會鎖住校區設定列直到呼叫端 commit：鎖住期間呼叫端不得再呼叫限流器
    （它另開連線；見 routes.create_visit_request）。"""
    # 先查是否為重播請求，避免對已存在的案件重新走一次驗證/寫入。
    existing = await find_replay(
        db, campus_key=campus_key, idempotency_key=idempotency_key, payload=payload, hash_key=hash_key
    )
    if existing is not None:
        return existing, False

    # 鎖住這個校區的設定列，確保驗證期間不會跟「園方剛好改設定」的
    # 交易交錯——同一份鎖也保護了 config_version 重驗的正確性。
    result = await db.execute(
        select(BookingConfig).where(BookingConfig.campus_key == campus_key).with_for_update()
    )
    config = result.scalar_one_or_none()
    # 同一把 key 的併發重送：開頭查重播時前一個請求還沒 commit，等到這把鎖時它已經
    # 建好案件——可能正好占走最後一個名額，或是手機上限的第 N 筆。拿到鎖後先再查
    # 一次，回原結果，不能回額滿或 429（2026-09-30 E2E：201＋409 SLOT_FULL）。
    existing = await find_replay(
        db, campus_key=campus_key, idempotency_key=idempotency_key, payload=payload, hash_key=hash_key
    )
    if existing is not None:
        return existing, False
    now = now_utc()
    slot = await _validate_submission(
        db,
        config,
        campus_key=campus_key,
        payload=payload,
        config_version=config_version,
        now=now,
        lock_slot=True,
    )
    if phone_limit is not None:
        max_per_phone, window = phone_limit
        recent = await db.scalar(
            select(func.count())
            .select_from(VisitRequest)
            .where(
                VisitRequest.campus_key == campus_key,
                VisitRequest.phone == payload["phone"],
                VisitRequest.created_at > now - window,
            )
        )
        if recent >= max_per_phone:
            raise PhoneSubmissionLimit(int(window.total_seconds()))

    # 2026-09-30 業主裁定：只有自選場次，送出即預約成立（不再有人工確認與占位）。
    status = VisitRequestStatus.CONFIRMED.value
    confirmed_at = now
    hold_expires_at = None
    slot_id = str(slot.id)

    payload_hash = _payload_hash(payload, hash_key)
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
        # 官網表單 2026-10-02 起不用勾選同意（consent_given 預設 False、不記版本）；
        # 更新前快取的舊頁面仍會送 True，照實記下勾選時間。
        consent_given=payload["consent_given"],
        consent_revision_id=None,
        consent_accepted_at=now if payload["consent_given"] else None,
        status=status,
        slot_id=uuid.UUID(slot_id),
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
        existing = await _find_by_idempotency_key(db, campus_key, idempotency_key)
        if existing is None:
            raise
        if not _same_payload(existing.payload_hash, payload, hash_key):
            raise IdempotencyConflict() from None
        return existing, False

    # 家長從官網送出：沒有帳號，歷程記來源為家長。slots 模式送出當下就占位
    # （或自動確認），after 帶時段。
    history.record_event(
        db,
        visit_request.id,
        "created",
        actor=history.PARENT,
        after={"status": status, "slot": history.slot_brief(slot)},
    )
    await access_service.create_access_token(db, visit_request.id, secret=access_secret, slot=slot)
    await enqueue_parent_email(db, visit_request, PARENT_VISIT_BOOKED)
    # 送出即預約成立，園方只發一則「新的參觀預約」。不再另排 visit_request_confirmed：
    # 那是舊的自動確認模式留下的，會讓 LINE 群組、站內通知、Email 每筆都收兩則
    # （2026-10-04 使用者裁定合併）。visit_request_confirmed 只留給園方確認補登的案件。
    enqueue_outbox(
        db,
        visit_request.id,
        "visit_request_created",
        {"campus_key": campus_key, "receipt_id": str(visit_request.id)},
    )
    await analytics_service.record_internal_event(
        db, event_type=AnalyticsEventType.REQUEST_CREATED, campus_key=campus_key, visit_request=visit_request
    )
    await analytics_service.record_internal_event(
        db, event_type=AnalyticsEventType.VISIT_CONFIRMED, campus_key=campus_key, visit_request=visit_request
    )
    await db.flush()
    return visit_request, True


# 後台補登與官網表單共用 (campus_key, idempotency_key) 唯一鍵；加前綴分開
# 兩個命名空間，家長端送來的 key 永遠不會撞到或重播出人員補登的案件。公開
# 端點拒收以保留前綴開頭的 key（routes.create_visit_request），這個不變式才
# 真的成立。
MANUAL_IDEMPOTENCY_PREFIX = "admin:"


async def create_manual_visit_request(
    db: AsyncSession,
    *,
    campus_key: str,
    idempotency_key: str,
    payload: dict,
    source: VisitRequestSource,
    created_by: uuid.UUID,
    hash_key: bytes,
) -> tuple[VisitRequest, bool]:
    """人員補登一筆案件，狀態一律從 new 開始（要排時段由呼叫端接著走
    confirm_with_slot，容量規則與一般確認完全相同）。不看預約模式、不寫
    「新需求」通知（登錄的人自己就是承辦人），也不計入官網成效統計——
    成效看的是官網帶來的需求，混進電話補登會讓轉換率失真。

    回傳 (visit_request, is_new)；同一個 key 重送回原案件，不重複建立。"""
    key = f"{MANUAL_IDEMPOTENCY_PREFIX}{idempotency_key}"
    payload_hash = _payload_hash(payload, hash_key)

    existing = await find_replay(db, campus_key=campus_key, idempotency_key=key, payload=payload, hash_key=hash_key)
    if existing is not None:
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
        # 2026-10-02 起補登不用勾選同意；舊版後台送 True 時照實記下時間。沒有官網同意說明版本。
        consent_given=payload["consent_given"],
        consent_accepted_at=now if payload["consent_given"] else None,
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
        existing = await find_replay(
            db, campus_key=campus_key, idempotency_key=key, payload=payload, hash_key=hash_key
        )
        if existing is None:
            raise
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
