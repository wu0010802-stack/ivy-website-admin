"""「待人工處理」的案件：園方關了時段、設了休假日或停用分校之後，既有案件
不會被自動取消（規格 L110、L227），但家長可能照原時間到園，要有人逐一聯絡
改期或取消。

案件清單的 needs_attention 篩選、CSV 匯出與總覽的待辦數共用這一個條件，
總覽的數字點進清單才會是同一批案件。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, or_, select

from app.booking import slot_service
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.campuses.models import Campus
from app.common.timezones import now_utc, today_local

# 尚未結案的案件。停用分校時回傳的「進行中件數」也是這個定義。
OPEN_STATUSES = (
    VisitRequestStatus.NEW.value,
    VisitRequestStatus.CONTACTING.value,
    VisitRequestStatus.PENDING_CONFIRMATION.value,
    VisitRequestStatus.CONFIRMED.value,
)


def needs_attention_condition(now: datetime | None = None):
    """符合任一項就算：

    - 排入的時段已被關閉（手動關閉或休假日），參觀日還沒過，而且家長還
      要來（已確認，或待確認且占位未到期）。參觀日已過的交給完成／未到場
      流程，不再列為要聯絡。
    - 分校已停用，案件還沒結案（含尚未排時段的新需求與聯絡中）。"""
    current = now or now_utc()
    closed_upcoming_slots = select(VisitSlot.id).where(
        VisitSlot.closed.is_(True), VisitSlot.slot_date >= today_local(current)
    )
    inactive_campuses = select(Campus.key).where(Campus.active.is_(False))
    return or_(
        and_(
            VisitRequest.slot_id.in_(closed_upcoming_slots),
            slot_service.awaiting_visit_condition(current),
        ),
        and_(
            VisitRequest.campus_key.in_(inactive_campuses),
            VisitRequest.status.in_(OPEN_STATUSES),
        ),
    )
