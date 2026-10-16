"""預約案件的「排除」標記（2026-10-15 規格 docs/specs/2026-10-15-visit-exclusion-design.md）。

測試或重複的案件由總管理者或校區管理者標記後，不算進下面這些數字（規格 §3.3 表「是」，一律用
not_excluded()／is_excluded()，不各自寫 excluded_at IS NULL）：
- 營運總覽：今天參觀、待標記到場、追蹤到期、要處理（operations/dashboard_service.py）
- 參觀預約統計：預約結果、班別（operations/booking_outcomes_service.py）
- 預約全程（admissions/journey.py 的 load_cases）
- 場次使用情況（booking/slot_usage.py）
- 員工「即將參觀」與家長參觀提醒（notifications/reminders.py；排入與寄出前都判斷）

不套用（§3.3 表「否」）：
- 營運總覽「本週五校」的已約／可約：不套用（使用者 10-16 確認）。這兩個數字講名額；排除不釋出名額，
  只扣已約會和可約對不起來（計畫 P10）。
- 名額占用（slot_service.occupying_condition：送單容量、接待月曆、場次產生）——排除不釋出名額。
- 案件列表、頁籤數字、CSV——不用 not_excluded()，改用 excluded 篩選（hide／only）。
- 停用分校的未結案件、切換預約方式前的確認數——營運安全檢查，看實際狀態。

各統計說明裡的「已排除 N 筆」用 excluded() 數（同一批期間、校區條件下的已排除案件）。

之後新增讀 visit_requests 的統計，規格要寫明套不套 not_excluded()。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import history
from app.booking.history import Actor
from app.booking.models import VisitRequest

REASONS = ("test", "duplicate", "other")
NOTE_MAX = 200
_FIELDS = ["excluded_at", "excluded_by", "exclude_reason", "exclude_note", "anonymized_at"]


class AlreadyExcluded(Exception):
    """這筆案件已經排除了。"""


class NotExcluded(Exception):
    """這筆案件沒有排除。"""


def not_excluded():
    """SQL 條件：沒有被排除的案件。統計、待辦、提醒用。"""
    return VisitRequest.excluded_at.is_(None)


def excluded():
    """SQL 條件：已排除的案件。各統計算「已排除 N 筆」用，和 not_excluded() 互補。"""
    return VisitRequest.excluded_at.is_not(None)


def is_excluded(visit_request: VisitRequest) -> bool:
    """Python 端判斷（已載入的案件，例如提醒寄出前再確認一次）。"""
    return visit_request.excluded_at is not None


async def exclude(db: AsyncSession, visit_request: VisitRequest, *, reason: str, note: str | None, actor: Actor) -> None:
    """鎖住案件列再標記。已匿名化的案件可以排除，但不存說明（計畫裁定 P15）：保存政策已清過自由文字，
    之後不會再清，不能讓新的自由文字留在匿名化案件上。"""
    await db.refresh(visit_request, attribute_names=_FIELDS, with_for_update=True)
    if visit_request.excluded_at is not None:
        raise AlreadyExcluded()
    cleaned = None if visit_request.anonymized_at is not None else ((note or "").strip() or None)
    visit_request.excluded_at = datetime.now(timezone.utc)
    visit_request.excluded_by = actor.user_id
    visit_request.exclude_reason = reason
    visit_request.exclude_note = cleaned
    history.record_event(db, visit_request.id, "excluded", actor=actor, after={"reason": reason}, reason=cleaned)
    await db.flush()


async def include(db: AsyncSession, visit_request: VisitRequest, *, actor: Actor) -> str:
    """取消排除：四個欄位清空（E4），回傳原本的原因（操作紀錄用）。"""
    await db.refresh(visit_request, attribute_names=_FIELDS, with_for_update=True)
    if visit_request.excluded_at is None:
        raise NotExcluded()
    previous = visit_request.exclude_reason or ""
    visit_request.excluded_at = None
    visit_request.excluded_by = None
    visit_request.exclude_reason = None
    visit_request.exclude_note = None
    history.record_event(db, visit_request.id, "exclusion_removed", actor=actor, before={"reason": previous})
    await db.flush()
    return previous
