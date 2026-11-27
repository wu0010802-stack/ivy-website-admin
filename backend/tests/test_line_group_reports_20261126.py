"""總部群組的週報與月報、官網電話／LINE 按鈕的點擊（docs/specs/2026-11-26-line-group-reports-design.md §2–§4）。
週報、月報是推播（每期每群組一則，推成功才記）；「週報」「月報」「聯絡」指令是 reply（不計則數）。"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select

from app.common.timezones import OPERATING_TZ, today_local
from app.notifications import line_reports
from app.notifications import line_group_commands as commands
from app.notifications import line_group_reports as reports
from app.notifications.line import LineMessagingClient
from app.notifications.line_group_commands import Command
from app.notifications.models import LineGroupSetting, LineReportRun
from app.operations.models import AnalyticsEvent, AnalyticsEventType
from tests.test_line_group_commands import HQ_GROUP, YIHUA_GROUP, _world
from tests.test_line_group_commands_more_20261125 import _ask, _parsed, _text
from tests.test_line_group_dispatch import ALL_KINDS
from tests.test_line_integrations_20261116 import MAIN_TOKEN, fake_line  # noqa: F401  (fixtures)

pytestmark = pytest.mark.usefixtures("booking_consent")

REPORT_KINDS = [line_reports.WEEKLY_KIND, line_reports.MONTHLY_KIND]


def _next_monday() -> date:
    today = today_local()
    return today + timedelta(days=7 - today.weekday())


def _next_first() -> date:
    return (today_local().replace(day=1) + timedelta(days=32)).replace(day=1)


def _at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=OPERATING_TZ)


async def _kinds(app, kinds: list[str], target: str = HQ_GROUP) -> None:
    async with app.state.session_factory() as db:
        await db.merge(LineGroupSetting(target_id=target, is_hq=True, kinds=kinds, updated_at=datetime.now(timezone.utc)))
        await db.commit()


async def _send(app, fake, now: datetime) -> int:
    line = LineMessagingClient(MAIN_TOKEN, transport=fake.transport())
    try:
        async with app.state.session_factory() as db:
            return await line_reports.send_due_reports(db, line_client=line, now=now)
    finally:
        await line.aclose()


async def _runs(app) -> list[tuple[str, str, date]]:
    async with app.state.session_factory() as db:
        rows = await db.execute(select(LineReportRun.target_id, LineReportRun.kind, LineReportRun.period_start))
        return [tuple(row) for row in rows.all()]


async def _clicks(app, day: date, rows: list[tuple[AnalyticsEventType, str | None]]) -> None:
    async with app.state.session_factory() as db:
        db.add_all([
            AnalyticsEvent(event_type=kind, campus_key=campus, created_at=_at(day, 0, 5 + i))
            for i, (kind, campus) in enumerate(rows)
        ])
        await db.commit()


PHONE, LINE = AnalyticsEventType.CTA_CLICK_PHONE, AnalyticsEventType.CTA_CLICK_LINE


# --- 哪一天推哪一份 ---------------------------------------------------------------------------------


def test_due_reports_by_day():
    assert line_reports.due_reports(date(2026, 11, 23)) == [("weekly_report", date(2026, 11, 16))]
    assert line_reports.due_reports(date(2026, 12, 1)) == [("monthly_report", date(2026, 11, 1))]
    assert line_reports.due_reports(date(2026, 11, 25)) == []
    # 2027-02-01 是週一：兩份都推。1 月 1 日的月報是去年 12 月。
    assert line_reports.due_reports(date(2027, 2, 1)) == [
        ("weekly_report", date(2027, 1, 25)), ("monthly_report", date(2027, 1, 1)),
    ]
    assert line_reports.due_reports(date(2027, 1, 1)) == [("monthly_report", date(2026, 12, 1))]


def test_delta_and_rate_text():
    assert reports._delta(12, 9, "前一週") == "（前一週 9，+3）"
    assert reports._delta(2, 5, "前一週") == "（前一週 5，-3）"
    assert reports._delta(4, 4, "前一個月") == "（前一個月 4，持平）"
    assert reports._rate_text(0, 0) == "—" and reports._rate_text(4, 1) == "80%"


def test_new_commands_are_parsed():
    assert _parsed("週報") == _parsed("周報") == Command("weekly_report")
    assert _parsed("月報") == Command("monthly_report")
    assert _parsed("今天聯絡") == _parsed("昨日聯絡") == _parsed("@聯絡") == Command("contact")
    assert _parsed("聯絡") is None  # 短字要標記官方帳號才認
    assert _parsed("義華 今天聯絡") == Command("contact", campus="yihua")


# --- 週報 -------------------------------------------------------------------------------------------


async def test_weekly_report_pushed_once_to_hq_groups_that_enabled_it(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=1, minghua=1)
    monday = _next_monday()
    # 總部群組沒開這個種類：不推。
    assert await _send(app, fake_line, _at(monday, 9, 30)) == 0
    await _kinds(app, [*ALL_KINDS, *REPORT_KINDS])
    for hour in (8, 12):  # 時段外
        assert await _send(app, fake_line, _at(monday, hour, 0 if hour == 12 else 59)) == 0
    assert fake_line.pushes == []

    before = len(fake_line.pushes)
    assert await _send(app, fake_line, _at(monday, 9, 30)) >= 1
    weekly = [push for push in fake_line.pushes[before:] if push["body"]["messages"][0]["type"] == "text"]
    assert len(weekly) == 1 and weekly[0]["body"]["to"] == HQ_GROUP
    lines = weekly[0]["body"]["messages"][0]["text"].split("\n")
    start = monday - timedelta(days=7)
    end = monday - timedelta(days=1)
    assert lines[0] == f"週報（{start.month}/{start.day}–{end.month}/{end.day}）"
    assert lines[1] == "【上週送出的預約】"
    assert lines[2].startswith("義華校　預約 1（前一週 0，+1）｜到場 0｜")
    assert lines[2].endswith("｜預繳 0（前一週 0，持平）")
    assert lines[7].startswith("合計　預約 2（前一週 0，+2）｜")
    assert lines[8] == "【上週實際來參觀的（依參觀日）】"
    assert lines[9] == "義華校　到場 0｜未到場 0｜到場率 —"
    assert lines[14] == "合計　到場 0｜未到場 0｜到場率 —"
    # 同一期不重推；只記這個群組。
    assert await _send(app, fake_line, _at(monday, 10, 0)) == 0
    assert (HQ_GROUP, "weekly_report", start) in await _runs(app)
    assert all(push["body"]["to"] == HQ_GROUP for push in fake_line.pushes)


async def test_report_push_failure_is_not_recorded_and_retries(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _kinds(app, [*ALL_KINDS, "weekly_report"])
    monday = _next_monday()
    fake_line.push_status = [500]
    assert await _send(app, fake_line, _at(monday, 9, 5)) == 0
    assert await _runs(app) == []
    assert await _send(app, fake_line, _at(monday, 9, 6)) == 1
    assert len(await _runs(app)) == 1


async def test_visited_counts_use_the_slot_date(app, fake_line, admin_client, public_client):
    from tests import test_line_group_recruitment as rec

    await rec._all_groups(app)
    await rec._attended(app, admin_client, public_client, fake_line)
    today = today_local()
    async with app.state.session_factory() as db:
        assert (await reports.visited_counts(db, ["yihua", "minghua"], today, today)) == {
            "yihua": {"completed": 1, "no_show": 0}, "minghua": {"completed": 0, "no_show": 0},
        }
        assert (await reports.visited_counts(db, ["yihua"], today + timedelta(days=1), today + timedelta(days=7)))["yihua"]["completed"] == 0


# --- 月報 -------------------------------------------------------------------------------------------


async def test_monthly_report_card(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2, minghua=1)
    await _kinds(app, [*ALL_KINDS, "monthly_report"])
    first = _next_first()
    assert await _send(app, fake_line, _at(first, 9, 30)) == 1
    message = fake_line.pushes[-1]["body"]["messages"][0]
    month = today_local().month
    assert message["type"] == "flex" and message["altText"] == f"{month} 月月報：預約 3 筆"
    body = message["contents"]["body"]["contents"]
    text = str(body)
    assert "3 筆（前一個月 0，+3）" in text and "各校預約數" in text
    bars = [item for item in body if item.get("layout") == "horizontal"]
    assert [bar["contents"][0]["text"] for bar in bars] == ["義華校", "明華校", "崇德校", "國際校", "仁武校"]
    assert bars[0]["contents"][1]["contents"][0]["width"] == "100%"
    assert bars[1]["contents"][1]["contents"][0]["width"] == "50%"
    assert bars[2]["contents"][1]["contents"] == [{"type": "filler"}]
    assert [bar["contents"][2]["text"] for bar in bars] == ["2", "1", "0", "0", "0"]
    assert "09" not in message["altText"]  # altText 沒有電話之類的個資
    assert await _send(app, fake_line, _at(first, 11, 0)) == 0
    assert (HQ_GROUP, "monthly_report", today_local().replace(day=1)) in await _runs(app)


def test_monthly_range_crosses_the_year():
    assert reports.monthly_range(date(2027, 1, 1)) == (date(2026, 12, 1), date(2026, 12, 31))
    assert reports.monthly_range(date(2026, 12, 1)) == (date(2026, 11, 1), date(2026, 11, 30))


# --- 指令 -------------------------------------------------------------------------------------------


async def test_report_commands_are_hq_only(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    for text in ("週報", "月報"):
        assert _text(await _ask(app, fake_line, text, YIHUA_GROUP)) == commands.HQ_ONLY_TEXT
    assert _text(await _ask(app, fake_line, "週報")).startswith("週報（")
    monthly = (await _ask(app, fake_line, "月報"))["body"]["messages"][0]
    assert monthly["type"] == "flex" and "月月報" in monthly["altText"]
    assert await _runs(app) == []  # 指令不算推過


async def test_contact_command_scopes_clicks_to_the_group(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    today = today_local()
    await _clicks(app, today, [(PHONE, "yihua"), (PHONE, "yihua"), (LINE, "minghua"), (LINE, None)])
    await _clicks(app, today - timedelta(days=1), [(LINE, "yihua")])
    await _clicks(app, today, [(AnalyticsEventType.BOOKING_CTA_CLICKED, "yihua")])  # 不是聯絡按鈕

    yihua = _text(await _ask(app, fake_line, "今天聯絡", YIHUA_GROUP)).split("\n")
    assert yihua[0] == "官網的電話與 LINE 按鈕"
    assert yihua[1] == f"【今天到目前（{today.month}/{today.day}）】" and yihua[2] == "按電話 2 次｜按 LINE 0 次"
    assert yihua[4] == "按電話 0 次｜按 LINE 1 次" and yihua[-1] == reports.CONTACT_NOTE
    assert "明華" not in "\n".join(yihua) and reports.NO_CAMPUS_LABEL not in "\n".join(yihua)

    hq = _text(await _ask(app, fake_line, "今天聯絡"))
    assert "義華校　按電話 2 次｜按 LINE 0 次" in hq and "明華校　按電話 0 次｜按 LINE 1 次" in hq
    assert f"{reports.NO_CAMPUS_LABEL}　按電話 0 次｜按 LINE 1 次" in hq
    only = _text(await _ask(app, fake_line, "明華 今天聯絡"))
    assert "按電話 0 次｜按 LINE 1 次" in only and reports.NO_CAMPUS_LABEL not in only and "沒有人按" in only
