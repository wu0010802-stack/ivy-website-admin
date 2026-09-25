"""預約方式的啟用條件（規格 L169-179）與切換前的影響範圍（規格 L181）。

| 方式 | 啟用條件 |
|---|---|
| inquiry | 已發布的同意文字 |
| slots | 已發布的同意文字，且有官網可預約的場次或至少一條每週開放規則 |
| line／phone／external | 該校的 LINE 連結／電話／外部網址 |
| paused | 暫停說明 |

規格的「接待窗口」「表單設定」目前沒有對應的設定欄位，不列入條件。

欄位類條件（連結、電話、暫停說明）每次存檔都驗；要讀其他資料的條件（同意
文字、場次）只在「切換成」該方式時驗——已經是 slots 的校區場次暫時用完時，
改其他設定不該被擋，這種情況改列在總覽待辦。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import consent, slot_service
from app.booking.models import BookingConfig, BookingMode, VisitRequest, VisitRequestStatus, VisitRule, VisitSlot
from app.common.timezones import now_utc, slot_start_utc, today_local


@dataclass(frozen=True)
class NotReadyReason:
    code: str
    message: str

    def as_dict(self) -> dict:
        return asdict(self)


class ModeNotReady(Exception):
    """對應 400 BOOKING_MODE_NOT_READY；reasons 逐條列出缺什麼。"""

    def __init__(self, reasons: list[NotReadyReason]) -> None:
        self.reasons = reasons
        super().__init__("；".join(r.message for r in reasons))

    @property
    def message(self) -> str:
        return "；".join(r.message for r in self.reasons)


LINE_URL_REQUIRED = NotReadyReason("LINE_URL_REQUIRED", "啟用 LINE 前必須先填寫「LINE 官方帳號連結」")
PHONE_REQUIRED = NotReadyReason("PHONE_REQUIRED", "啟用電話洽詢前必須先填寫「洽詢電話」")
EXTERNAL_URL_REQUIRED = NotReadyReason("EXTERNAL_URL_REQUIRED", "啟用外部預約前必須先填寫「外部預約網址」")
PAUSED_MESSAGE_REQUIRED = NotReadyReason(
    "PAUSED_MESSAGE_REQUIRED", "暫停預約時請填寫給家長看的暫停說明，例如何時恢復、可以怎麼聯絡"
)
CONSENT_NOT_PUBLISHED = NotReadyReason(
    "CONSENT_NOT_PUBLISHED", "「預約文案」還沒有發布同意條款文字，家長無法勾選同意，請先到預約文案發布"
)
NO_SLOTS_OR_RULES = NotReadyReason(
    "NO_SLOTS_OR_RULES", "目前沒有官網可預約的場次，也沒有每週開放規則，請先到「時段與容量」新增場次或規則"
)

_FORM_MODES = (BookingMode.INQUIRY, BookingMode.SLOTS)


def field_blockers(
    mode: BookingMode,
    *,
    line_url: str | None,
    phone: str | None,
    external_url: str | None,
    message: str | None,
) -> list[NotReadyReason]:
    def blank(value: str | None) -> bool:
        return not (value or "").strip()

    if mode == BookingMode.LINE and blank(line_url):
        return [LINE_URL_REQUIRED]
    if mode == BookingMode.PHONE and blank(phone):
        return [PHONE_REQUIRED]
    if mode == BookingMode.EXTERNAL and blank(external_url):
        return [EXTERNAL_URL_REQUIRED]
    if mode == BookingMode.PAUSED and blank(message):
        return [PAUSED_MESSAGE_REQUIRED]
    return []


async def _slots_available(db: AsyncSession, campus_key: str, config: BookingConfig | None, now: datetime) -> bool:
    rules = await db.scalar(select(func.count()).select_from(VisitRule).where(VisitRule.campus_key == campus_key))
    if rules:
        return True
    return await slot_service.count_bookable_slots(db, campus_key, config, now) > 0


async def data_blockers(
    db: AsyncSession, campus_key: str, config: BookingConfig | None, *, now: datetime | None = None
) -> dict[BookingMode, list[NotReadyReason]]:
    """每個方式要讀資料才知道的條件。line／phone／external／paused 沒有這類條件。"""
    current = now or now_utc()
    published = await consent.current_consent(db)
    common = [] if published is not None else [CONSENT_NOT_PUBLISHED]
    slots = list(common)
    if not await _slots_available(db, campus_key, config, current):
        slots.append(NO_SLOTS_OR_RULES)
    return {
        BookingMode.INQUIRY: list(common),
        BookingMode.SLOTS: slots,
        BookingMode.LINE: [],
        BookingMode.PHONE: [],
        BookingMode.EXTERNAL: [],
        BookingMode.PAUSED: [],
    }


async def check_update(
    db: AsyncSession,
    config: BookingConfig,
    *,
    mode: BookingMode,
    line_url: str | None,
    phone: str | None,
    external_url: str | None,
    message: str | None,
) -> None:
    reasons = field_blockers(mode, line_url=line_url, phone=phone, external_url=external_url, message=message)
    if mode in _FORM_MODES and mode != config.mode:
        reasons += (await data_blockers(db, config.campus_key, config))[mode]
    if reasons:
        raise ModeNotReady(reasons)


async def impact(db: AsyncSession, campus_key: str, config: BookingConfig | None, *, now: datetime | None = None) -> dict:
    """切換前的影響範圍。切換不修改既有案件（規格 L181、L185）。"""
    current = now or now_utc()
    counts = dict(
        (
            await db.execute(
                select(VisitRequest.status, func.count())
                .where(
                    VisitRequest.campus_key == campus_key,
                    VisitRequest.status.in_(
                        [
                            VisitRequestStatus.NEW.value,
                            VisitRequestStatus.CONTACTING.value,
                            VisitRequestStatus.PENDING_CONFIRMATION.value,
                            VisitRequestStatus.CONFIRMED.value,
                        ]
                    ),
                )
                .group_by(VisitRequest.status)
            )
        ).all()
    )
    # 一列一個案件（同一場可能有好幾組家長），不能 select 時段實體後去重。
    confirmed_starts = (
        await db.execute(
            select(VisitSlot.slot_date, VisitSlot.start_time)
            .join(VisitRequest, VisitRequest.slot_id == VisitSlot.id)
            .where(
                VisitRequest.campus_key == campus_key,
                VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
                VisitSlot.slot_date >= today_local(current),
            )
        )
    ).all()
    rules = await db.scalar(select(func.count()).select_from(VisitRule).where(VisitRule.campus_key == campus_key))
    return {
        "open_requests": sum(counts.values()),
        "new_requests": counts.get(VisitRequestStatus.NEW.value, 0),
        "contacting": counts.get(VisitRequestStatus.CONTACTING.value, 0),
        "pending_confirmation": counts.get(VisitRequestStatus.PENDING_CONFIRMATION.value, 0),
        "upcoming_confirmed": sum(1 for day, start in confirmed_starts if slot_start_utc(day, start) > current),
        "bookable_slots": await slot_service.count_bookable_slots(db, campus_key, config, current),
        "weekly_rules": rules or 0,
    }
