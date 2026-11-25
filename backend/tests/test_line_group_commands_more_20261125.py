"""總部群組為基準的指令擴充（docs/specs/2026-11-25-line-group-commands-design.md）：手打 @ 與同義字、指令前加校名、
待追蹤、名額、休假日、待辦，以及只給總部群組的統計與額度。回覆都用 reply（不計則數）；LINE API 用 httpx.MockTransport 模擬。"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import update

from app.admissions.models import RecruitmentVisit
from app.booking.models import VisitException, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.notifications import line_group_actions as actions
from app.notifications import line_group_commands as commands
from app.notifications import line_group_reports as reports
from app.notifications.line_group_commands import Command, _addressed, parse
from tests import test_line_group_recruitment as rec
from tests.test_line_group_attend import _case, _postback, _press
from tests.test_line_group_commands import HQ_GROUP, MEMBER, YIHUA_GROUP, _group_event, _world
from tests.test_line_integrations_20261116 import _webhook, fake_line  # noqa: F401  (fixtures)

pytestmark = pytest.mark.usefixtures("booking_consent")

NAMES = {"yihua": "義華校", "minghua": "明華校", "chongde": "崇德校", "international": "國際校", "renwu": "仁武校"}
WEDNESDAY = date(2026, 11, 25)
_WEEKDAYS = "一二三四五六日"


def _plain(text: str) -> dict:
    return {"type": "message", "message": {"type": "text", "id": "m", "text": text}}


def _parsed(text: str, event: dict | None = None) -> Command | None:
    stripped, addressed, typed = _addressed(event or _plain(text), text)
    return parse(stripped, addressed, typed, NAMES, WEDNESDAY)


def _text(reply: dict) -> str:
    message = reply["body"]["messages"][0]
    assert message["type"] == "text", message
    return message["text"]


async def _ask(app, fake_line, text: str, group: str = HQ_GROUP) -> dict:  # noqa: F811
    before = len(fake_line.replies)
    response = await _webhook(app, [_group_event("message", group, text)], account="main")
    assert response.status_code == 200
    assert len(fake_line.replies) == before + 1, f"「{text}」沒有回覆"
    assert fake_line.pushes == []
    return fake_line.replies[-1]


async def _slots(app, **values) -> None:
    async with app.state.session_factory() as db:
        await db.execute(update(VisitSlot).values(**values))
        await db.commit()


def _day(day: date) -> str:
    return f"{day.month}/{day.day}（{_WEEKDAYS[day.weekday()]}）"


def _at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=OPERATING_TZ)


# --- 指令怎麼認（§1） -------------------------------------------------------------------------------


def test_typed_at_sign_and_synonyms_are_understood():
    visits_today = Command("visits", "today")
    for text in ("@當日參觀", "@今日參觀", "＠今天參觀", "當日參觀", "今日參觀", "@今天", "＠ 當日"):
        assert _parsed(text) == visits_today, text
    assert _parsed("@待標記") == _parsed("未標記") == Command("awaiting")
    assert _parsed("明日參觀") == Command("visits", "tomorrow")
    assert _parsed("這周參觀") == Command("visits", "week")
    assert _parsed("下周名額") == Command("seats", "next_week")
    assert _parsed("停課日") == _parsed("@休假") == Command("closures")
    assert _parsed("上個月統計") == Command("stats", "last_month")
    assert _parsed("@") == Command("menu")
    assert _parsed("@說明") == _parsed("指令") == _parsed("@HELP") == Command("help")
    # 手打名字再接完整指令也認；接短字不認（前面可能是任何人的名字）。
    assert _parsed("@常春藤官網通知 待標記") == Command("awaiting")
    assert _parsed("@小明 今天") is None


def test_short_words_need_the_at_sign_and_chatter_is_ignored():
    for text in ("今天", "明日", "名額", "休假", "統計", "說明", "今天參觀嗎", "我明天休假", "大家好", "義華", "@小明"):
        assert _parsed(text) is None, text
    assert _parsed("@名額") == Command("seats", "next7")
    assert _parsed("@統計") == Command("stats", "week")
    # 標記別的成員的訊息不算手打 @（有 mention 資料）。
    event = _plain("@小明 今天參觀")
    event["message"]["mention"] = {"mentionees": [{"index": 0, "length": 3, "type": "user", "userId": MEMBER}]}
    assert _parsed("@小明 今天參觀", event) is None


def test_campus_prefix_and_dates():
    assert _parsed("義華 今天參觀") == Command("visits", "today", "yihua")
    assert _parsed("明華校待追蹤") == Command("follow_up", None, "minghua")
    assert _parsed("＠國際　本週名額") == Command("seats", "week", "international")
    assert _parsed("仁武 11/28 名額") == Command("seats", date(2026, 11, 28), "renwu")
    assert _parsed("１１／２８　參觀") == Command("visits", date(2026, 11, 28))
    assert _parsed("@崇德 11/28") == Command("visits", date(2026, 11, 28), "chongde")
    # 與校區無關的指令不能加校名；不認得的校名、不存在的日期都不算指令。
    assert _parsed("義華 額度") is None and _parsed("義華 指令") is None
    assert _parsed("台北 今天參觀") is None and _parsed("2/30 名額") is None


async def test_typed_at_command_gets_a_reply_in_the_group(app, fake_line, admin_client, public_client):
    """使用者 11-25 在群組打「@當日參觀」「@待標記」沒有回應：現在都會回。"""
    await _world(app, admin_client, public_client)
    today = today_local()
    reply = await _ask(app, fake_line, "@當日參觀", YIHUA_GROUP)
    assert reply["body"]["messages"][0]["altText"].startswith(f"今日參觀（{today.month}/{today.day} 週")
    await _ask(app, fake_line, "@待標記", YIHUA_GROUP)
    assert _text(await _ask(app, fake_line, "指令", YIHUA_GROUP)).count("統計") == 0
    assert "本週統計" in _text(await _ask(app, fake_line, "＠說明"))


async def test_campus_prefix_narrows_hq_and_is_refused_for_unserved_campus(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=1, minghua=1)
    both = json.dumps((await _ask(app, fake_line, "今天參觀"))["body"], ensure_ascii=False)
    assert "義華校" in both and "明華校" in both
    only = json.dumps((await _ask(app, fake_line, "明華 今天參觀"))["body"], ensure_ascii=False)
    assert "明華校" in only and "義華校" not in only
    assert _text(await _ask(app, fake_line, "明華校今天參觀", YIHUA_GROUP)) == "這個群組查不到明華校。"


# --- 待追蹤（§2） -----------------------------------------------------------------------------------


async def _due(app, rv_id: str, days_ago: int = 2) -> None:
    await rec._set(app, rv_id, follow_up_at=datetime.now(timezone.utc) - timedelta(days=days_ago))


async def test_follow_up_list_shows_due_visits_and_buttons_reschedule(app, fake_line, admin_client, public_client):
    await rec._all_groups(app)
    receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    assert _text(await _ask(app, fake_line, "待追蹤", YIHUA_GROUP)) == commands.FOLLOW_UP_EMPTY_TEXT
    await _due(app, rv_id)
    reply = await _ask(app, fake_line, "待追蹤", YIHUA_GROUP)
    message = reply["body"]["messages"][0]
    assert message["altText"] == "待追蹤（共 1 筆）"
    summary, card = message["contents"]["contents"]
    dumped = json.dumps(card, ensure_ascii=False)
    assert "義華校" in dumped and "陳媽媽" in dumped and "（逾 2 天）" in dumped
    assert rec._postback_datas(card) == [rec._rf(actions.RF_FOLLOW, rv_id, days) for days in ("1", "3", "7")]
    assert f"/admin/visit-requests/{receipt}" in dumped
    # 不放電話與孩子姓名。
    visit = await rec._visit(app, rv_id)
    whole = json.dumps(reply["body"], ensure_ascii=False)
    assert visit.phone and visit.phone not in whole and visit.child_name not in whole

    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "7"), YIHUA_GROUP))
    assert rec._texts(fake_line, 1)[0].startswith("已記錄：下次聯絡 ")
    assert (await rec._visit(app, rv_id)).follow_up_at == actions.follow_up_time(7)
    assert _text(await _ask(app, fake_line, "待追蹤", YIHUA_GROUP)) == commands.FOLLOW_UP_EMPTY_TEXT


async def test_follow_up_button_works_for_staff_created_visit_but_other_fields_still_refuse(
    app, fake_line, admin_client, public_client
):
    """園方自己建的訪視（沒有對應預約）也會到期：名單列得出來、能延後；結果欄位仍只收官網預約建立的訪視。"""
    await rec._all_groups(app)
    _receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    await rec._set(app, rv_id, visit_request_id=None)
    await _due(app, rv_id, days_ago=0)
    card = (await _ask(app, fake_line, "義華 待追蹤"))["body"]["messages"][0]["contents"]["contents"][1]
    dumped = json.dumps(card, ensure_ascii=False)
    assert "（今天）" in dumped and "開啟案件" not in dumped
    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "1"), rec.HQ_GROUP))
    assert (await rec._visit(app, rv_id)).follow_up_at == actions.follow_up_time(1)
    await _press(app, _postback(rec._rf(actions.RF_BUS, rv_id, "1"), rec.HQ_GROUP))
    assert rec._texts(fake_line, 1) == [actions.CANNOT_FILL_REPLY]
    # 別校群組按不了。
    await _due(app, rv_id)
    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "3"), rec.MINGHUA_GROUP))
    assert rec._texts(fake_line, 1) == [actions.NO_PERMISSION_REPLY]


async def test_follow_up_list_scope_and_admissions_switch(app, fake_line, admin_client, public_client):
    await rec._all_groups(app)
    _receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    await _due(app, rv_id)
    # 明華的群組看不到義華的；總部看得到。
    assert _text(await _ask(app, fake_line, "待追蹤", rec.MINGHUA_GROUP)) == commands.FOLLOW_UP_EMPTY_TEXT
    assert (await _ask(app, fake_line, "待追蹤"))["body"]["messages"][0]["altText"] == "待追蹤（共 1 筆）"
    app.state.settings.admissions_enabled = False
    assert _text(await _ask(app, fake_line, "待追蹤")) == commands.ADMISSIONS_OFF_TEXT


def test_follow_up_list_overflows_into_a_note():
    from app.notifications import line_flex

    rows = [line_flex.FollowUpRow(str(i), "義華校", None, "11/20（四）", "11/24（一）10:00（逾 1 天）") for i in range(14)]
    message = line_flex.follow_up_list_message(rows)
    bubbles = message["contents"]["contents"]
    assert message["altText"] == "待追蹤（共 14 筆）" and len(bubbles) == 12
    assert "另有 3 筆，請開後台" in json.dumps(bubbles[-1], ensure_ascii=False)
    assert rec._postback_datas(bubbles[-1]) == [] and len(rec._postback_datas(bubbles[1])) == 3


# --- 名額（§3） -------------------------------------------------------------------------------------


async def test_seats_for_one_day_lists_every_slot_per_campus(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=1, minghua=1)
    tomorrow = today_local() + timedelta(days=1)
    await _slots(app, slot_date=tomorrow)
    text = _text(await _ask(app, fake_line, "明天名額"))
    assert text.startswith(f"明日名額（{tomorrow.month}/{tomorrow.day} 週{_WEEKDAYS[tomorrow.weekday()]}）\n義華校")
    assert "義華校\n・06:00–06:30　已約 1／2 組" in text
    assert re.search(r"明華校(（目前是.+）)?\n・06:00–06:30　已約 1／2 組", text)
    assert re.search(r"崇德校(（目前是.+）)?\n・這天沒有場次", text)
    # 校區群組只看自己的；指定日期同一個格式。
    own = _text(await _ask(app, fake_line, f"{tomorrow.month}/{tomorrow.day} 名額", YIHUA_GROUP))
    assert "義華校" in own and "明華校" not in own and "已約 1／2 組" in own


async def test_seats_show_full_closed_and_refuse_past_days(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2)
    tomorrow = today_local() + timedelta(days=1)
    await _slots(app, slot_date=tomorrow, capacity=1)
    async with app.state.session_factory() as db:
        await db.execute(update(VisitSlot).where(VisitSlot.start_time == time(7, 0)).values(closed=True))
        await db.commit()
    text = _text(await _ask(app, fake_line, "義華 明天名額"))
    assert "・06:00–06:30　額滿（1／1 組）" in text and "・07:00–07:30　已關閉" in text and "明華校" not in text
    yesterday = today_local() - timedelta(days=1)
    assert _text(await _ask(app, fake_line, f"{yesterday.month}/{yesterday.day} 名額")) == commands.PAST_SEATS_TEXT


async def test_seats_for_a_week_sum_up_each_day(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2)
    today = today_local()
    monday = today + timedelta(days=7 - today.weekday())
    await _slots(app, slot_date=monday)
    text = _text(await _ask(app, fake_line, "下週名額", YIHUA_GROUP))
    sunday = monday + timedelta(days=6)
    assert text.startswith(f"下週名額（{monday.month}/{monday.day}–{sunday.month}/{sunday.day}）\n義華校")
    # 兩場各 2 組、各約了 1 組。
    assert f"・{_day(monday)}剩 2 組（2 場）" in text


async def test_seats_treat_started_slots_as_gone(app, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2)
    today = today_local()
    async with app.state.session_factory() as db:
        before = await reports.seats_text(db, ["yihua"], NAMES, today, today, "今日名額", now=_at(today, 5))
        between = await reports.seats_text(db, ["yihua"], NAMES, today, today, "今日名額", now=_at(today, 6, 15))
        week = await reports.seats_text(db, ["yihua"], NAMES, today, today + timedelta(days=1), "本週名額", now=_at(today, 6, 15))
        after = await reports.seats_text(db, ["yihua"], NAMES, today, today + timedelta(days=1), "本週名額", now=_at(today, 9))
    assert "（已開始）" not in before
    assert "・06:00–06:30　已約 1／2 組（已開始）" in between and "・07:00–07:30　已約 1／2 組\n" in between + "\n"
    assert f"・{_day(today)}剩 1 組（1 場）" in week
    assert f"・{_day(today)}場次都已開始" in after


# --- 休假日（§4） -----------------------------------------------------------------------------------


async def test_closures_list_days_off_with_visits_to_contact(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=1)
    assert _text(await _ask(app, fake_line, "休假日", YIHUA_GROUP)) == "近 14 天沒有休假日。"
    day = today_local() + timedelta(days=3)
    await _slots(app, slot_date=day)
    now = datetime.now(timezone.utc)
    async with app.state.session_factory() as db:
        db.add(VisitException(campus_key="yihua", exception_date=day, reason="颱風停班停課 詳見 https://evil.example/x", created_at=now))
        db.add(VisitException(campus_key="minghua", exception_date=day + timedelta(days=1), reason=None, created_at=now))
        db.add(VisitException(campus_key="yihua", exception_date=day + timedelta(days=30), reason="太遠", created_at=now))
        await db.commit()
    text = _text(await _ask(app, fake_line, "＠休假"))
    lines = text.split("\n")
    assert lines[0].startswith("近 14 天的休假日（")
    assert lines[1] == f"・{_day(day)}義華校　颱風停班停課 詳見　還有 1 筆預約要聯絡"
    assert lines[2] == f"・{_day(day + timedelta(days=1))}明華校"
    assert len(lines) == 3 and "evil.example" not in text
    # 校區群組只看自己的。
    assert "明華校" not in _text(await _ask(app, fake_line, "停課日", YIHUA_GROUP))


# --- 待辦（§5） -------------------------------------------------------------------------------------


async def test_todo_counts_match_the_dashboard_conditions(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2, minghua=1)
    today = today_local()
    async with app.state.session_factory() as db:
        text = await reports.todo_text(db, ["yihua", "minghua"], NAMES, admissions_enabled=True, now=_at(today, 6, 15))
        plain = await reports.todo_text(db, ["yihua"], NAMES, admissions_enabled=False, now=_at(today, 23, 30))
    lines = text.split("\n")
    assert lines[0] == "目前待辦"
    # 06:15：06:00 的兩場（義華、明華各一）已開始、還沒標記；義華 07:00 那場還沒到。
    assert lines[1] == "義華校　今天參觀 2｜待標記 1｜待追蹤 0｜停課要聯絡 0"
    assert lines[2] == "明華校　今天參觀 1｜待標記 1｜待追蹤 0｜停課要聯絡 0"
    assert lines[3] == "合計　今天參觀 3｜待標記 2｜待追蹤 0｜停課要聯絡 0"
    assert lines[4] == "看名單請輸入：今天參觀、待標記、待追蹤、休假日"
    # 招生入學沒開就沒有待追蹤那一欄；只有一校不列合計。
    assert plain.split("\n")[1:] == ["義華校　今天參觀 2｜待標記 2｜停課要聯絡 0", "看名單請輸入：今天參觀、待標記、休假日"]
    replied = _text(await _ask(app, fake_line, "待辦", YIHUA_GROUP))
    assert replied.startswith("目前待辦\n義華校　今天參觀 2｜") and "明華校" not in replied and "合計" not in replied


async def test_todo_counts_follow_ups_and_closure_contacts(app, fake_line, admin_client, public_client):
    await rec._all_groups(app)
    _receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    await _due(app, rv_id)
    await _case(app, admin_client, public_client, "yihua", when="future", start="11:00:00", key="b")
    day = today_local() + timedelta(days=3)
    async with app.state.session_factory() as db:
        await db.execute(update(VisitSlot).where(VisitSlot.slot_date == day).values(closed=True, closed_source="exception"))
        db.add(VisitException(campus_key="yihua", exception_date=day, reason="校慶補假", created_at=datetime.now(timezone.utc)))
        await db.commit()
    text = _text(await _ask(app, fake_line, "義華 待辦"))
    assert "待追蹤 1｜停課要聯絡 1" in text.split("\n")[1]


# --- 統計（§6，只有總部群組） -----------------------------------------------------------------------


def test_stats_ranges():
    assert reports.stats_range("week", WEDNESDAY) == (date(2026, 11, 23), WEDNESDAY)
    assert reports.stats_range("last_week", WEDNESDAY) == (date(2026, 11, 16), date(2026, 11, 22))
    assert reports.stats_range("month", WEDNESDAY) == (date(2026, 11, 1), WEDNESDAY)
    assert reports.stats_range("last_month", WEDNESDAY) == (date(2026, 10, 1), date(2026, 10, 31))
    assert reports.stats_range("last_month", date(2027, 1, 5)) == (date(2026, 12, 1), date(2026, 12, 31))
    assert reports.stats_range("week", date(2026, 11, 23)) == (date(2026, 11, 23), date(2026, 11, 23))


async def test_stats_are_hq_only_and_match_booking_outcomes(app, fake_line, admin_client, public_client):
    await rec._all_groups(app)
    _receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    async with app.state.session_factory() as db:
        await db.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(rv_id)).values(has_deposit=True))
        await db.commit()
    await _case(app, admin_client, public_client, "minghua", when="future")
    for group in (YIHUA_GROUP, rec.MINGHUA_GROUP):
        assert _text(await _ask(app, fake_line, "本週統計", group)) == commands.HQ_ONLY_TEXT
        assert _text(await _ask(app, fake_line, "額度", group)) == commands.HQ_ONLY_TEXT

    today = today_local()
    monday = today - timedelta(days=today.weekday())
    lines = _text(await _ask(app, fake_line, "本週統計")).split("\n")
    assert lines[0] == f"本週統計（{monday.month}/{monday.day}–{today.month}/{today.day}，依預約送出日）"
    assert lines[1] == "義華校　預約 1｜到場 1｜未到場 0｜取消 0｜待標記 0｜尚未參觀 0｜預繳 1"
    assert lines[2] == "明華校　預約 1｜到場 0｜未到場 0｜取消 0｜待標記 0｜尚未參觀 1｜預繳 0"
    assert [line.split("　")[0] for line in lines[1:6]] == ["義華校", "明華校", "崇德校", "國際校", "仁武校"]
    assert lines[6] == "合計　預約 2｜到場 1｜未到場 0｜取消 0｜待標記 0｜尚未參觀 1｜預繳 1"
    assert lines[7] == "到場率 100%（到場 1 ÷ 已標記 1）"

    only = _text(await _ask(app, fake_line, "義華 本月統計")).split("\n")
    assert only[0].startswith("本月統計（") and only[1].startswith("義華校　預約 1｜") and "合計" not in "\n".join(only)
    last_week = _text(await _ask(app, fake_line, "上週統計"))
    assert "合計　預約 0｜" in last_week and last_week.endswith("到場率 —（還沒有標記到場或未到場的）")


# --- 額度（§7，只有總部群組） -----------------------------------------------------------------------


async def test_quota_lists_each_account_for_hq(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    lines = _text(await _ask(app, fake_line, "額度")).split("\n")
    assert lines[0] == "LINE 官方帳號本月用量"
    assert "・常春藤官網　12／200 則（6%）" in lines
    assert "・常春藤義華　170／200 則（85%，快用完了）" in lines
    assert lines[-1].startswith("推到群組是幾個人收到算幾則")


# --- 選單與新成員說明（§8） -------------------------------------------------------------------------


async def test_menu_and_join_help_differ_for_hq(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _webhook(
        app,
        [
            _group_event("message", YIHUA_GROUP, "@常春藤", mention_self=True),
            _group_event("message", HQ_GROUP, "@常春藤", mention_self=True),
            _group_event("memberJoined", YIHUA_GROUP),
            _group_event("memberJoined", HQ_GROUP),
        ],
        account="main",
    )
    campus_menu, hq_menu, campus_help, hq_help = (json.dumps(r["body"], ensure_ascii=False) for r in fake_line.replies)
    assert '"text": "待追蹤"' in campus_menu and '"text": "額度"' not in campus_menu
    assert '"text": "本週統計"' in hq_menu and '"text": "額度"' in hq_menu
    assert "待辦" in campus_help and "總部專用" not in campus_help and "總部專用" in hq_help
