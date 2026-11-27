"""總部群組的週報與月報（2026-11-26，docs/specs/2026-11-26-line-group-reports-design.md §2、§3）。

台灣時間 09:00–12:00 之間：週一推上週的週報、每月 1 日推上個月的月報，給開了那個種類的總部群組。
不走 outbox（outbox 的每一列都綁一個案件）：直接推播，推成功才寫 `LineReportRun`；失敗下一輪（約每分鐘）
再試，到 12:00 為止，過了就不補（要看可以在群組輸入「週報」「月報」）。"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.campuses.models import Campus
from app.common.timezones import OPERATING_TZ, now_utc, today_local
from app.notifications import line as line_api
from app.notifications import line_flex
from app.notifications import line_group_reports as reports
from app.notifications.line import LineMessagingClient, LinePushError
from app.notifications.models import LineGroup, LineGroupSetting, LineReportRun

logger = logging.getLogger("app.line_reports")

WEEKLY_KIND = "weekly_report"
MONTHLY_KIND = "monthly_report"
REPORT_START = time(9, 0)
REPORT_END = time(12, 0)


def due_reports(today: date) -> list[tuple[str, date]]:
    """今天該推哪幾份：(種類, 那一期的第一天)。週一＝上週的週報；1 日＝上個月的月報。"""
    due: list[tuple[str, date]] = []
    if today.weekday() == 0:
        due.append((WEEKLY_KIND, reports.weekly_range(today)[0]))
    if today.day == 1:
        due.append((MONTHLY_KIND, reports.monthly_range(today)[0]))
    return due


async def _targets(db: AsyncSession, kind: str) -> list[str]:
    """開了這個種類的總部群組（bot 還在群組裡）。"""
    rows = (await db.execute(
        select(LineGroupSetting.target_id, LineGroupSetting.kinds)
        .join(LineGroup, LineGroup.target_id == LineGroupSetting.target_id)
        .where(LineGroupSetting.is_hq.is_(True), LineGroup.left_at.is_(None))
        .order_by(LineGroupSetting.target_id)
    )).all()
    return [target_id for target_id, kinds in rows if kind in (kinds or ())]


async def active_campuses(db: AsyncSession) -> list[str]:
    """總部群組看的校區：所有營運中的校區，照五校固定順序。"""
    keys = (await db.execute(select(Campus.key).where(Campus.active.is_(True)))).scalars().all()
    return reports.ordered(list(keys))


async def build(db: AsyncSession, kind: str, now: datetime | None = None) -> list[dict]:
    """那一份報表的訊息；「週報」「月報」指令共用。2026-11-27 起帶各校明細鈕
    （docs/specs/2026-11-27-line-card-buttons-design.md §2）：月報卡片放在 footer；週報是純文字掛不了按鈕，
    後面多一張選校小卡（同一次推播／回覆，LINE 照收件人數算一則）。"""
    campuses = await active_campuses(db)
    names = await reports.campus_names(db)
    pairs = [(key, names.get(key, key)) for key in campuses]
    today = today_local(now or now_utc())
    if kind == WEEKLY_KIND:
        start = reports.weekly_range(today)[0]
        return [
            line_api.text_message(await reports.weekly_report_text(db, campuses, names, now)),
            line_flex.report_picker_message(reports.WEEKLY_CODE, start, pairs),
        ]
    start = reports.monthly_range(today)[0]
    return [line_flex.monthly_report_message(
        await reports.monthly_report(db, campuses, names, now),
        detail_buttons=line_flex.report_detail_buttons(reports.MONTHLY_CODE, start, pairs),
    )]


async def send_due_reports(
    db: AsyncSession, *, line_client: LineMessagingClient, now: datetime | None = None
) -> int:
    """推今天該推、還沒推的報表，回傳成功推出的則數。`now` 讓測試凍結時間。"""
    current = now or now_utc()
    local = current.astimezone(OPERATING_TZ)
    if not REPORT_START <= local.time() < REPORT_END:
        return 0
    sent = 0
    for kind, period_start in due_reports(local.date()):
        targets = await _targets(db, kind)
        if not targets:
            continue
        done = set(
            (await db.execute(
                select(LineReportRun.target_id).where(
                    LineReportRun.kind == kind, LineReportRun.period_start == period_start
                )
            )).scalars()
        )
        pending = [target for target in targets if target not in done]
        if not pending:
            continue
        messages = await build(db, kind, current)
        for target in pending:
            key = uuid.uuid5(uuid.NAMESPACE_URL, f"report:{kind}:{target}:{period_start.isoformat()}")
            try:
                await line_client.push(target, messages, key=key)
            except (LinePushError, httpx.HTTPError):
                logger.warning("%s 推播失敗，下一輪再試：%s", kind, target, exc_info=True)
                continue
            db.add(LineReportRun(target_id=target, kind=kind, period_start=period_start, created_at=now_utc()))
            await db.commit()
            sent += 1
    return sent
