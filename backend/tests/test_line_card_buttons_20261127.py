"""報表各校明細、查詢切換鈕、統計異常「知道了」（docs/specs/2026-11-27-line-card-buttons-design.md）。
回覆都用 reply（不計則數）；LINE API 用 httpx.MockTransport 模擬。"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.notifications import line as line_api
from app.notifications import line_flex
from app.notifications import line_group_commands as commands
from app.notifications import line_group_report_actions as report_actions
from app.notifications.line import LineMessagingClient
from app.notifications.line_group_actions import REPORT_DETAIL, STATS_MUTE, encode
from app.notifications.line_group_commands import Command, parse, switches
from app.notifications.models import LineGroup, LineGroupSetting
from app.operations import stats_health
from app.operations.audit_service import visible_metadata
from app.operations.models import StatsHealthMute
from tests.test_analytics_more import _FakeGa4, _views
from tests.test_line_group_attend import (
    FREE_GROUP, MEMBER, _audits, _groups, _postback, _postback_datas, _press, _uris,
)
from tests.test_line_group_commands import HQ_GROUP, YIHUA_GROUP, _world
from tests.test_line_group_commands_more_20261125 import NAMES, WEDNESDAY, _ask, _text
from tests.test_line_group_dispatch import ALL_KINDS
from tests.test_line_integrations_20261116 import MAIN_TOKEN, fake_line  # noqa: F401  (fixtures)

pytestmark = pytest.mark.usefixtures("booking_consent")

ALL_CAMPUSES = ["yihua", "minghua", "chongde", "international", "renwu"]


def _quick(message: dict) -> list[str]:
    return [item["action"]["text"] for item in message.get("quickReply", {}).get("items", [])]


def _last_message(reply: dict) -> dict:
    return reply["body"]["messages"][-1]


def _flat(node) -> str:
    return json.dumps(node, ensure_ascii=False)


# --- 快速回覆的輔助函式 --------------------------------------------------------------------------------


def test_with_quick_reply_dedupes_caps_and_keeps_the_original():
    message = line_api.text_message("x")
    out = line_api.with_quick_reply(message, ["今天參觀", "今天參觀", "明天參觀"])
    assert _quick(out) == ["今天參觀", "明天參觀"]
    assert all(item["action"]["type"] == "message" for item in out["quickReply"]["items"])
    assert "quickReply" not in message
    assert line_api.with_quick_reply(message, []) is message
    many = line_api.with_quick_reply(message, [f"{i}/1 參觀" for i in range(1, 21)])
    assert len(many["quickReply"]["items"]) == line_api.QUICK_REPLY_MAX
    long = line_api.with_quick_reply(message, ["字" * 30])
    assert long["quickReply"]["items"][0]["action"]["label"] == "字" * 20


# --- 切換鈕（§3） --------------------------------------------------------------------------------------

_ALL_COMMANDS = [
    *(Command("visits", arg) for arg in ("today", "tomorrow", "week", "next_week")),
    *(Command("seats", arg) for arg in ("today", "tomorrow", "week", "next_week", "next7")),
    *(Command("stats", arg) for arg in ("week", "last_week", "month", "last_month")),
    *(Command(kind) for kind in ("awaiting", "follow_up", "closures", "todo", "contact", "weekly_report", "monthly_report")),
    Command("visits", WEDNESDAY + timedelta(days=3)), Command("seats", WEDNESDAY + timedelta(days=3)),
]


def test_every_switch_is_a_command_and_never_points_back_to_itself():
    for command in _ALL_COMMANDS:
        texts = switches(command, WEDNESDAY, admissions_enabled=True)
        assert texts, command
        assert len(texts) == len(set(texts)) <= line_api.QUICK_REPLY_MAX
        for text in texts:
            assert len(text) <= line_api.QUICK_REPLY_LABEL_MAX
            parsed = parse(text, False, False, NAMES, WEDNESDAY)
            assert parsed is not None, (command, text)
            assert parsed != command, (command, text)


def test_switch_sets():
    assert switches(Command("visits", "today"), WEDNESDAY, admissions_enabled=True) == ["明天參觀", "本週參觀", "待標記", "今天名額"]
    assert switches(Command("todo"), WEDNESDAY, admissions_enabled=True) == ["待標記", "待追蹤", "今天參觀", "休假日"]
    # 招生入學關閉：待追蹤會回「沒有開啟」，不放。
    assert switches(Command("todo"), WEDNESDAY, admissions_enabled=False) == ["待標記", "今天參觀", "休假日"]
    assert "待追蹤" not in switches(Command("awaiting"), WEDNESDAY, admissions_enabled=False)
    assert switches(Command("stats", "week"), WEDNESDAY, admissions_enabled=True) == ["上週統計", "本月統計", "週報"]
    assert switches(Command("weekly_report"), WEDNESDAY, admissions_enabled=True) == ["月報", "本週統計"]


def test_campus_prefix_is_kept_except_for_campus_free_commands():
    yihua = switches(Command("visits", "today", campus="yihua"), WEDNESDAY, admissions_enabled=True, campus_name="義華校")
    assert yihua == ["義華 明天參觀", "義華 本週參觀", "義華 待標記", "義華 今天名額"]
    assert parse("義華 明天參觀", False, False, NAMES, WEDNESDAY) == Command("visits", "tomorrow", campus="yihua")
    stats = switches(Command("stats", "week", campus="yihua"), WEDNESDAY, admissions_enabled=True, campus_name="義華校")
    assert stats == ["義華 上週統計", "義華 本月統計", "週報"]


def test_dated_switches_step_one_day_and_skip_the_past():
    def dated(kind: str, days: int) -> list[str]:
        return switches(Command(kind, WEDNESDAY + timedelta(days=days)), WEDNESDAY, admissions_enabled=True)

    assert dated("visits", 3) == ["11/27 參觀", "11/29 參觀", "11/28 名額"]
    assert dated("visits", 1) == ["今天參觀", "11/27 參觀", "明天名額"]
    assert dated("visits", 0) == ["明天參觀", "今天名額"]
    assert dated("seats", 2) == ["明天名額", "11/28 名額", "11/27 參觀"]
    assert dated("visits", -1) == []  # 過去的日子回「請到後台」
    # 約半年後的「月/日」會被認成半年前的同一天（_day_of 取先找到的那年），這種切換鈕不放。
    far = WEDNESDAY + timedelta(days=181)
    assert dated("visits", 182) == [f"{far.month}/{far.day} 參觀"]


async def test_query_replies_carry_switches_but_refusals_and_menus_do_not(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    reply = await _ask(app, fake_line, "今天參觀", YIHUA_GROUP)
    assert _quick(_last_message(reply)) == ["明天參觀", "本週參觀", "待標記", "今天名額"]
    # 文字回覆（沒有資料那種）也掛。
    tomorrow = await _ask(app, fake_line, "明天參觀", YIHUA_GROUP)
    assert _text(tomorrow) == commands.EMPTY_TEXT
    assert _quick(_last_message(tomorrow)) == ["今天參觀", "本週參觀", "下週參觀", "明天名額"]
    todo = await _ask(app, fake_line, "待辦", YIHUA_GROUP)
    assert _text(todo).startswith("目前待辦") and "待標記" in _quick(_last_message(todo))

    # 總部指定校名：切換鈕帶同一個校名，按下去照樣認得。
    hq = await _ask(app, fake_line, "義華 今天參觀")
    assert _quick(_last_message(hq)) == ["義華 明天參觀", "義華 本週參觀", "義華 待標記", "義華 今天名額"]
    again = await _ask(app, fake_line, "義華 明天參觀")
    assert _text(again) == commands.EMPTY_TEXT and _quick(_last_message(again))[0] == "義華 今天參觀"

    for text, group in (("本週統計", YIHUA_GROUP), ("明華 今天參觀", YIHUA_GROUP), ("指令", YIHUA_GROUP), ("額度", HQ_GROUP)):
        assert "quickReply" not in _last_message(await _ask(app, fake_line, text, group)), text
    menu = await _webhook_mention(app, fake_line)
    assert "quickReply" not in menu


async def _webhook_mention(app, fake_line) -> dict:
    from tests.test_line_group_commands import _group_event
    from tests.test_line_integrations_20261116 import _webhook

    # 義華群組前面已經查了 6 次（每分鐘上限 6），選單改在總部群組叫。
    await _webhook(app, [_group_event("message", HQ_GROUP, "@常春藤", mention_self=True)], account="main")
    return _last_message(fake_line.replies[-1])


# --- 報表的各校明細（§2） ------------------------------------------------------------------------------


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


async def test_weekly_reply_adds_a_picker_and_monthly_card_has_campus_buttons(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    today = today_local()
    weekly = await _ask(app, fake_line, "週報")
    messages = weekly["body"]["messages"]
    assert [message["type"] for message in messages] == ["text", "flex"]
    assert messages[0]["text"].startswith("週報（")
    last_monday = _monday(today) - timedelta(days=7)
    assert _postback_datas(messages[1]) == [
        encode(REPORT_DETAIL, "w", key, last_monday.strftime("%Y%m%d")) for key in ALL_CAMPUSES
    ]
    labels = [box["action"]["label"] for row in messages[1]["contents"]["footer"]["contents"] for box in row["contents"]]
    assert labels == ["義華", "明華", "崇德", "國際", "仁武"]
    assert _quick(messages[1]) == ["月報", "本週統計"] and "quickReply" not in messages[0]

    monthly = (await _ask(app, fake_line, "月報"))["body"]["messages"]
    assert len(monthly) == 1
    first_of_last_month = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    assert _postback_datas(monthly[0]) == [
        encode(REPORT_DETAIL, "m", key, first_of_last_month.strftime("%Y%m%d")) for key in ALL_CAMPUSES
    ]
    assert line_flex.DETAIL_HINT in _flat(monthly[0])


async def test_weekly_push_sends_report_and_picker_in_one_request(app, fake_line, admin_client, public_client):
    from tests.test_line_group_reports_20261126 import _at, _kinds, _next_monday, _send

    await _world(app, admin_client, public_client)
    await _kinds(app, [*ALL_KINDS, "weekly_report"])
    monday = _next_monday()
    assert await _send(app, fake_line, _at(monday, 9, 30)) == 1
    messages = fake_line.pushes[-1]["body"]["messages"]
    assert [message["type"] for message in messages] == ["text", "flex"]
    assert _postback_datas(messages[1])[0] == encode(REPORT_DETAIL, "w", "yihua", (monday - timedelta(days=7)).strftime("%Y%m%d"))
    assert all("quickReply" not in message for message in messages)  # 推播不掛切換鈕


async def _detail_world(app, admin_client, public_client) -> date:
    """義華 4 筆、明華 1 筆，都在本週送出。義華：一筆未到場、兩筆待標記（場次昨天）、一筆家長取消；
    一筆有記到第一次進站來源（搜尋）。回傳本週一。"""
    await _world(app, admin_client, public_client, yihua=4, minghua=1)
    yesterday = today_local() - timedelta(days=1)
    async with app.state.session_factory() as db:
        await db.execute(update(VisitSlot).values(slot_date=yesterday, start_time=time(9, 0), end_time=time(9, 30)))
        rows = (await db.execute(
            select(VisitRequest.id).where(VisitRequest.campus_key == "yihua").order_by(VisitRequest.phone)
        )).scalars().all()
        await db.execute(update(VisitRequest).where(VisitRequest.id == rows[0]).values(status="no_show", parent_name="王媽媽"))
        await db.execute(update(VisitRequest).where(VisitRequest.id == rows[1]).values(parent_name="林爸爸 www.evil.example", first_touch_source="search"))
        await db.execute(update(VisitRequest).where(VisitRequest.id == rows[2]).values(parent_name="張媽媽"))
        await db.execute(update(VisitRequest).where(VisitRequest.id == rows[3]).values(
            status="cancelled", cancel_reason="parent", cancelled_at=datetime.now(timezone.utc),
        ))
        await db.commit()
    return _monday(today_local())


def _detail_postback(code: str, campus: str, start: date | str, group: str = HQ_GROUP) -> dict:
    day = start if isinstance(start, str) else start.strftime("%Y%m%d")
    return _postback(encode(REPORT_DETAIL, code, campus, day), group)


async def test_detail_button_shows_that_campus_for_that_period(app, fake_line, admin_client, public_client):
    monday = await _detail_world(app, admin_client, public_client)
    sunday = monday + timedelta(days=6)
    await _press(app, _detail_postback("w", "yihua", monday))  # _world 的總部群組沒貼過驗證碼：唯讀照樣回
    message = _last_message(fake_line.replies[-1])
    span = f"{monday.month}/{monday.day}–{sunday.month}/{sunday.day}"
    assert message["type"] == "flex" and message["altText"] == f"義華校 {span} 明細"
    assert message["contents"]["header"]["contents"][0]["text"] == "常春藤官網｜週報明細"
    body = _flat(message["contents"]["body"])
    assert "4 筆" in body and "官網表單 4" in body
    assert "搜尋引擎 1｜沒記到 3" in body
    assert "到場 0｜未到場 1｜待標記 2｜尚未參觀 0｜取消 1" in body and "家長取消 1" in body
    assert "王媽媽（" in body and "林爸爸（" in body and "張媽媽（" in body
    assert "evil" not in body  # 稱呼裡的網址拿掉
    assert "0912" not in _flat(message)  # 沒有電話
    assert "明華" not in body
    assert _uris(message) == ["https://admin.ivy.example/admin/analytics?openExternalBrowser=1"]

    await _press(app, _detail_postback("m", "minghua", today_local().replace(day=1)))
    monthly = _last_message(fake_line.replies[-1])
    assert monthly["contents"]["header"]["contents"][0]["text"] == "常春藤官網｜月報明細"
    assert monthly["altText"].startswith("明華校 ") and "1 筆" in _flat(monthly["contents"]["body"])


async def test_detail_button_refuses_other_groups_and_ignores_data_we_did_not_make(app, fake_line, admin_client, public_client):
    monday = await _detail_world(app, admin_client, public_client)
    await _press(app, _detail_postback("w", "yihua", monday, YIHUA_GROUP))
    assert _text(fake_line.replies[-1]) == commands.HQ_ONLY_TEXT
    before = len(fake_line.replies)
    for event in (
        _detail_postback("w", "yihua", monday, FREE_GROUP),  # 沒綁任何校
        _detail_postback("w", "yihua", monday + timedelta(days=1)),  # 不是週一
        _detail_postback("w", "yihua", monday + timedelta(days=7)),  # 還沒到
        _detail_postback("m", "yihua", monday.replace(day=2) if monday.day != 2 else monday.replace(day=3)),  # 不是 1 號
        _detail_postback("x", "yihua", monday),
        _detail_postback("w", "nowhere", monday),
        _detail_postback("w", "yihua", "20261399"),
        _postback(f"ivy:{REPORT_DETAIL}:w:yihua", HQ_GROUP),  # 參數個數不對
    ):
        await _press(app, event)
    assert len(fake_line.replies) == before


def test_detail_display_text_is_not_a_command_and_long_lists_say_how_many():
    for name in NAMES.values():
        text = line_flex.detail_display_text(name)
        assert parse(text, False, False, NAMES, WEDNESDAY) is None
        assert parse(text, True, False, NAMES, WEDNESDAY) is None
    assert line_flex._names(["甲（11/2）"] * 8, 10).endswith("甲（11/2） 等 10 位")
    assert line_flex._names(["甲（11/2）"], 1) == "甲（11/2）"


# --- 統計異常「知道了」（§4） ---------------------------------------------------------------------------


async def _alert_world(app) -> date:
    """驗證過的總部群組開了統計異常；昨天 50 次瀏覽、內容興趣 0 → engagement_low。回傳今天。"""
    await _groups(app)
    today = today_local()
    async with app.state.session_factory() as db:
        await db.merge(LineGroupSetting(target_id=HQ_GROUP, is_hq=True, kinds=[*ALL_KINDS, "stats_health"], updated_at=datetime.now(timezone.utc)))
        await _views(db, today - timedelta(days=1), 50)
        await db.commit()
    return today


async def _alert(app, fake_line, day: date) -> int:
    stats_health.reset_clean_day()
    line = LineMessagingClient(MAIN_TOKEN, transport=fake_line.transport())
    try:
        async with app.state.session_factory() as db:
            return await stats_health.send_due_alerts(
                db, app.state.settings, line_client=line,
                now=datetime.combine(day, time(9, 30), tzinfo=OPERATING_TZ), ga4=_FakeGa4(10),
            )
    finally:
        await line.aclose()


async def _mutes(app) -> dict[str, date]:
    async with app.state.session_factory() as db:
        return {row.issue_key: row.muted_until for row in (await db.execute(select(StatsHealthMute))).scalars()}


def _md(day: date) -> str:
    return f"{day.month}/{day.day}"


async def test_alert_card_mute_button_pauses_that_issue_for_three_days(app, fake_line):
    today = await _alert_world(app)
    yesterday = today - timedelta(days=1)
    assert await _alert(app, fake_line, today) == 1
    card = fake_line.pushes[-1]["body"]["messages"][0]
    assert card["type"] == "flex" and card["altText"].startswith(f"官網統計可能有狀況（{_md(yesterday)}")
    data = encode(STATS_MUTE, yesterday.strftime("%Y%m%d"), "engagement_low")
    assert _postback_datas(card) == [data]
    assert _uris(card) == ["https://admin.ivy.example/admin/analytics?openExternalBrowser=1"]
    footer = card["contents"]["footer"]["contents"]
    assert footer[0]["action"]["displayText"] == line_flex.STATS_MUTE_DISPLAY
    assert parse(line_flex.STATS_MUTE_DISPLAY, True, False, NAMES, WEDNESDAY) is None

    await _press(app, _postback(data, HQ_GROUP))
    until = today + timedelta(days=3)
    assert _text(fake_line.replies[-1]) == report_actions.MUTED_REPLY.format(
        labels="內容興趣偏少", start=_md(today + timedelta(days=1)), until=_md(until), resume=_md(until + timedelta(days=1)),
    )
    assert await _mutes(app) == {"engagement_low": until}
    audits = await _audits(app, "line.group.stats_health_mute")
    assert len(audits) == 1
    metadata = audits[0].metadata_json
    assert metadata == {"issues": ["engagement_low"], "muted_until": until.isoformat(), "group_id": HQ_GROUP, "line_user_id": MEMBER}
    assert visible_metadata(audits[0].action, metadata, show_line_ids=False) == {"issues": ["engagement_low"], "muted_until": until.isoformat()}

    # 之後三天同樣的問題不推；第 4 天問題還在就再推。
    async with app.state.session_factory() as db:
        for offset in range(0, 5):
            await _views(db, today + timedelta(days=offset), 50)
        await db.commit()
    pushes = len(fake_line.pushes)
    for offset in (1, 2, 3):
        assert await _alert(app, fake_line, today + timedelta(days=offset)) == 0
    assert len(fake_line.pushes) == pushes
    assert await _alert(app, fake_line, today + timedelta(days=4)) == 1
    # 後台的健康檢查不受暫停影響。
    async with app.state.session_factory() as db:
        _, issues = await stats_health.check(db, app.state.settings, today=today + timedelta(days=1), ga4=_FakeGa4(10))
    assert [issue.key for issue in issues] == ["engagement_low"]


async def test_muted_issue_is_dropped_but_others_still_go_out(app, fake_line):
    today = await _alert_world(app)
    async with app.state.session_factory() as db:
        db.add(StatsHealthMute(issue_key="engagement_low", muted_until=today, updated_at=datetime.now(timezone.utc)))
        await db.commit()
    assert await _alert(app, fake_line, today) == 0  # 唯一的問題在暫停中：不推、也不記已推
    async with app.state.session_factory() as db:
        await db.execute(update(StatsHealthMute).values(issue_key="ga4_silent"))
        await db.commit()
    assert await _alert(app, fake_line, today) == 1


async def test_mute_never_shortens_and_rejects_others(app, fake_line):
    today = await _alert_world(app)
    later = today + timedelta(days=10)
    async with app.state.session_factory() as db:
        db.add(StatsHealthMute(issue_key="ga4_silent", muted_until=later, updated_at=datetime.now(timezone.utc)))
        await db.commit()
    day = (today - timedelta(days=1)).strftime("%Y%m%d")
    await _press(app, _postback(encode(STATS_MUTE, day, "ga4_silent,traffic_zero"), HQ_GROUP))
    assert await _mutes(app) == {"ga4_silent": later, "traffic_zero": today + timedelta(days=3)}

    await _press(app, _postback(encode(STATS_MUTE, day, "engagement_low"), YIHUA_GROUP))
    assert _text(fake_line.replies[-1]) == commands.HQ_ONLY_TEXT
    for stale in (today - timedelta(days=3), today + timedelta(days=1)):
        await _press(app, _postback(encode(STATS_MUTE, stale.strftime("%Y%m%d"), "engagement_low"), HQ_GROUP))
        assert _text(fake_line.replies[-1]) == report_actions.STALE_ALERT_REPLY
    assert "engagement_low" not in await _mutes(app)

    before = len(fake_line.replies)
    for data in (
        encode(STATS_MUTE, day, "engagement_low,whatever"),
        encode(STATS_MUTE, day, ""),
        encode(STATS_MUTE, "2026-11-26", "engagement_low"),
    ):
        await _press(app, _postback(data, HQ_GROUP))
    # 沒貼過驗證碼的總部群組：會寫入的按鈕不回應。
    async with app.state.session_factory() as db:
        await db.execute(update(LineGroup).where(LineGroup.target_id == HQ_GROUP).values(verified_at=None))
        await db.commit()
    await _press(app, _postback(encode(STATS_MUTE, day, "engagement_low"), HQ_GROUP))
    assert len(fake_line.replies) == before
    assert "engagement_low" not in await _mutes(app)


def test_alert_message_lists_every_issue():
    day = date(2026, 11, 26)
    issues = [stats_health.HealthIssue("traffic_zero", day, "甲"), stats_health.HealthIssue("ga4_silent", day, "乙")]
    message = stats_health.alert_message(day, issues, None)
    assert message["altText"] == "官網統計可能有狀況（11/26 週四）"
    assert _postback_datas(message) == [encode(STATS_MUTE, "20261126", "traffic_zero,ga4_silent")]
    assert _uris(message) == []  # 沒設後台網址就不放連結
    assert "・甲" in _flat(message) and "・乙" in _flat(message)
    assert set(stats_health.ISSUE_LABELS) == {"traffic_zero", "engagement_low", "attribution_missing", "ga4_silent"}
