"""「待處理」的兩種（2026-09-30 招生分析報告 3.4，取代原本的「待聯絡」）。

自選場次之後沒有「等園方聯絡確認」這一步；還要人處理的只剩下面兩種。上線前留下的
new／contacting／pending_confirmation 舊案（原本的 legacy_pending）已在 2026-10-05
刪除，列表也拿掉了「待處理」分組。

- awaiting_attendance：已確認、場次已開始，還沒標記到場或未到場（列表「時間已過」的
  已確認部分；總覽「參觀時間過了，還沒標記到場」）。
- follow_up_due：設了下次聯絡時間而且到了，案件沒有取消也沒有到場。

總覽、案件列表的篩選與成效統計都從這裡取條件，數字點進清單才會是同一批案件。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_

from app.booking import status_groups
from app.booking.models import VisitRequest, VisitRequestStatus
from app.common.timezones import now_utc

PENDING_KINDS = ("awaiting_attendance", "follow_up_due")
# 不算「到期待追蹤」的狀態：設了下次聯絡也不會出現，聯絡紀錄 API 不讓設（參觀後的追蹤
# 在招生訪視，2026-10-04 規格 6.6）。
FOLLOW_UP_UNTRACKED_STATUSES = (VisitRequestStatus.CANCELLED.value, VisitRequestStatus.COMPLETED.value)


def condition(kind: str, now: datetime | None = None):
    current = now or now_utc()
    if kind == "awaiting_attendance":
        return and_(
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            status_groups.group_condition("past", current),
        )
    if kind == "follow_up_due":
        return and_(
            VisitRequest.follow_up_at.is_not(None),
            VisitRequest.follow_up_at <= current,
            VisitRequest.status.not_in(FOLLOW_UP_UNTRACKED_STATUSES),
        )
    raise ValueError(f"未知的待處理種類：{kind}")
