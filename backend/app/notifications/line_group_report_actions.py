"""總部群組卡片的兩種按鈕（2026-11-27，docs/specs/2026-11-27-line-card-buttons-design.md §2、§4）。

- 報表明細（`rpt`，唯讀）：週報、月報上的校名鈕，回那一校那一期的明細卡。沒貼過驗證碼的舊群組也能按（同指令）。
- 統計異常「知道了」（`shm`，寫入）：同樣的問題 3 天內早上不再推 LINE。line_group_actions 只把驗證過的群組
  交進來；這裡再擋非總部群組。

兩者都由 line_group_actions.handle 分派（限流、群組授權、回覆都在那邊）；不認得的參數一律不回應（回 None），
不是我們編的資料不透露任何東西。"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.timezones import today_local
from app.notifications import line as line_api
from app.notifications import line_group_reports as reports
from app.notifications.line_group_commands import HQ_ONLY_TEXT
from app.notifications.line_group_settings import is_hq_group
from app.operations import audit_service, stats_health

STALE_ALERT_REPLY = "這則提醒已經過了，請看最新的提醒。"
MUTED_REPLY = "已記下：{labels}。{start}–{until} 早上不再提醒；{resume} 起問題還在會再提醒。後台成效統計頁照常顯示。"


def _day(text: str) -> date | None:
    if len(text) != 8 or not (text.isascii() and text.isdigit()):
        return None
    try:
        return datetime.strptime(text, "%Y%m%d").date()
    except ValueError:
        return None


def _md(day: date) -> str:
    return f"{day.month}/{day.day}"


async def report_detail(
    request: Request, db: AsyncSession, group_id: str, served: list[str], parts: list[str]
) -> dict | None:
    """parts：w／m、校區 key、那一期第一天 YYYYMMDD。"""
    from app.notifications import line_flex

    code, campus_key, start_text = parts
    start = _day(start_text)
    period = reports.report_period(code, start) if start is not None else None
    if period is None or period[0] > today_local() or campus_key not in served:
        return None
    if not await is_hq_group(db, group_id):
        return line_api.text_message(HQ_ONLY_TEXT)
    names = await reports.campus_names(db)
    detail = await reports.campus_detail(db, campus_key, names, *period)
    settings = request.app.state.settings
    return line_flex.report_detail_message(code, detail, analytics_url=stats_health.analytics_url(settings.admin_origin))


async def stats_mute(
    request: Request,
    db: AsyncSession,
    group_id: str,
    parts: list[str],
    *,
    line_user_id: str | None,
    display_name: str | None = None,
) -> dict | None:
    """parts：檢查的那天 YYYYMMDD、問題代碼（逗號分隔）。只有總部群組能按；卡片太舊不寫入。"""
    day = _day(parts[0])
    keys = list(dict.fromkeys(parts[1].split(",")))
    if day is None or not keys or any(key not in stats_health.ISSUE_LABELS for key in keys):
        return None
    if not await is_hq_group(db, group_id):
        return line_api.text_message(HQ_ONLY_TEXT)
    today = today_local()
    if day < today - timedelta(days=stats_health.MUTE_CARD_MAX_AGE_DAYS) or day > today:
        return line_api.text_message(STALE_ALERT_REPLY)
    until = await stats_health.mute(db, keys, today)
    await audit_service.log_action(
        db,
        actor_user_id=None,
        action="line.group.stats_health_mute",
        target_type="stats_health",
        target_id="all",
        campus_key=None,
        metadata={
            "issues": keys,
            "muted_until": until.isoformat(),
            "group_id": group_id,
            **({"line_user_id": line_user_id} if line_user_id else {}),
            **({"line_display_name": display_name} if display_name else {}),
        },
    )
    await db.commit()
    return line_api.text_message(MUTED_REPLY.format(
        labels="、".join(stats_health.ISSUE_LABELS[key] for key in keys),
        start=_md(today + timedelta(days=1)),
        until=_md(until),
        resume=_md(until + timedelta(days=1)),
    ))
