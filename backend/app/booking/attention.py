"""「待人工處理」的案件：園方設了休假日（含停班停課）或停用分校之後，既有案件不會被自動取消
（規格 L110、L227），但家長可能照原時間到園，要有人逐一聯絡改期或取消。園方手動
「停止申請」一個場次只是不收新預約，已約的家長照常參觀，不列入這裡。

案件清單的 needs_attention 篩選、CSV 匯出與總覽的待辦數共用這一個條件，
總覽的數字點進清單才會是同一批案件。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, or_, select

from app.booking import slot_service, status_groups
from app.booking.models import SlotClosedSource, VisitException, VisitRequest, VisitSlot
from app.campuses.models import Campus
from app.common.timezones import now_utc, today_local

# 尚未結案的案件。停用分校時回傳的「進行中件數」也是這個定義。
OPEN_STATUSES = status_groups.OPEN_STATUSES


def needs_attention_condition(now: datetime | None = None):
    """符合任一項就算：

    - 排入的時段因休假日被關閉，參觀日還沒過，而且家長還要來（已確認）。
      參觀日已過的交給完成／未到場流程，不再列為要聯絡。
    - 分校已停用，案件還沒結案（已確認）。"""
    current = now or now_utc()
    # 2026-09-30 起「停止申請」（園方手動關閉）只是不收新預約，已約的家長照常參觀；
    # 只有休假日整天關閉，已排入的家長才需要人工聯絡。2026-10-14 起看「那天有沒有休假」：
    # 先停止申請、之後整天休假的場次仍記 manual，但那天整天不開，已約的家長一樣要聯絡
    # （與 parent_policy.day_closed 同一個定義）。
    day_off = (
        select(VisitException.id)
        .where(
            VisitException.campus_key == VisitSlot.campus_key,
            VisitException.exception_date == VisitSlot.slot_date,
        )
        .exists()
    )
    closed_upcoming_slots = select(VisitSlot.id).where(
        VisitSlot.closed.is_(True),
        or_(VisitSlot.closed_source == SlotClosedSource.EXCEPTION.value, day_off),
        VisitSlot.slot_date >= today_local(current),
    )
    inactive_campuses = select(Campus.key).where(Campus.active.is_(False))
    return or_(
        and_(
            VisitRequest.slot_id.in_(closed_upcoming_slots),
            slot_service.awaiting_visit_condition(),
        ),
        and_(
            VisitRequest.campus_key.in_(inactive_campuses),
            VisitRequest.status.in_(OPEN_STATUSES),
        ),
    )
