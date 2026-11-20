"""「這台裝置記住預約」的使用次數（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md §7）。

只累加次數：台北日 × 校區 × 動作 × 家長有沒有留 Email。沒有案件代號、IP、cookie。三個公開端點都要
帶有效的記住預約 cookie 才會走到記錄這一步，不會被匿名灌數字。記錄失敗不得影響家長的操作，
呼叫端用 record_safely（另開 savepoint，失敗就丟掉這一筆）。"""
from __future__ import annotations

import logging
import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import REMEMBERED_ACTIONS, VisitRememberedDaily, VisitRequest
from app.common.timezones import today_local

logger = logging.getLogger(__name__)


async def record_safely(db: AsyncSession, visit_request: VisitRequest, action: str, today: date | None = None) -> None:
    """累加一次並 commit 自己的 savepoint；任何錯誤只記 log。"""
    try:
        async with db.begin_nested():
            stmt = insert(VisitRememberedDaily).values(
                id=uuid.uuid4(), day=today or today_local(), campus_key=visit_request.campus_key, action=action,
                has_email=bool(visit_request.email), count=1,
            )
            await db.execute(stmt.on_conflict_do_update(
                constraint="uq_visit_remembered_daily", set_={"count": VisitRememberedDaily.count + 1},
            ))
    except Exception:  # noqa: BLE001 — 統計不能擋住家長
        logger.warning("記住預約次數寫入失敗", exc_info=True)


async def summary(db: AsyncSession, campus_keys: list[str], date_from: date | None, date_to: date | None) -> dict:
    """期間內各動作的合計；opened_without_email 是沒留 Email 的家長按「修改或取消」的次數。"""
    T = VisitRememberedDaily
    conditions = [T.campus_key.in_(campus_keys)]
    if date_from is not None:
        conditions.append(T.day >= date_from)
    if date_to is not None:
        conditions.append(T.day <= date_to)
    counts = dict.fromkeys(REMEMBERED_ACTIONS, 0)
    without_email = 0
    for action, has_email, total in (await db.execute(
        select(T.action, T.has_email, func.sum(T.count)).where(*conditions).group_by(T.action, T.has_email)
    )).all():
        counts[action] += int(total)
        if action == "opened" and not has_email:
            without_email += int(total)
    first = await db.scalar(select(func.min(T.day)).where(T.campus_key.in_(campus_keys)))
    return {**counts, "opened_without_email": without_email, "first_day": first}
