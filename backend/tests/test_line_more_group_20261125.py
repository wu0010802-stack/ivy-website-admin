"""LINE 群組再加的三項（docs/specs/2026-11-25-line-more-features-design.md §2–§4）：「待標記」、指定日期與下週查詢、
卡片多帶參觀人數與取消方。回覆都用 reply（不計則數）；LINE API 用 httpx.MockTransport 模擬。"""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select, update

from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import today_local
from app.notifications import line_flex, line_group_actions as actions
from app.notifications.line_group_commands import AWAITING_EMPTY_TEXT, PAST_DAY_TEXT, _day_of
from tests.test_line_group_commands import YIHUA_GROUP, _carousel, _group_event, _world
from tests.test_line_group_dispatch import _outbox
from tests.test_line_integrations_20261116 import MAIN_TOKEN, _webhook, fake_line  # noqa: F401  (fixtures)
from tests.test_line_notifications import flex_texts

pytestmark = pytest.mark.usefixtures("booking_consent")


async def _visits(app) -> list[VisitRequest]:
    async with app.state.session_factory() as db:
        return list((await db.execute(select(VisitRequest).order_by(VisitRequest.created_at))).scalars())


async def _move(app, visit: VisitRequest, day: date) -> None:
    async with app.state.session_factory() as db:
        await db.execute(update(VisitSlot).where(VisitSlot.id == visit.slot_id).values(slot_date=day))
        await db.commit()


def _texts(reply: dict) -> list[str]:
    message = reply["body"]["messages"][0]
    return [message["text"]] if message["type"] == "text" else [message["altText"], *flex_texts(message)]


def _datas(node) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        action = node.get("action")
        if isinstance(action, dict) and action.get("type") == "postback":
            found.append(action["data"])
        for value in node.values():
            found += _datas(value)
    elif isinstance(node, list):
        for item in node:
            found += _datas(item)
    return found


# --- 待標記（§2） -----------------------------------------------------------------------------------


async def test_awaiting_lists_started_unmarked_visits_newest_first_with_buttons(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=3)
    older, newer, future = await _visits(app)
    today = today_local()
    await _move(app, older, today - timedelta(days=3))
    await _move(app, newer, today - timedelta(days=1))
    await _move(app, future, today + timedelta(days=2))
    await _webhook(app, [_group_event("message", text="待標記")], account="main")
    assert len(fake_line.replies) == 1 and fake_line.pushes == []
    reply = fake_line.replies[0]
    assert reply["body"]["messages"][0]["altText"] == "待標記到場（共 2 筆）"
    bubbles = _carousel(reply)
    assert len(bubbles) == 3  # 總覽＋兩筆；之後的那筆不列
    datas = [_datas(bubble) for bubble in bubbles[1:]]
    # 新的在前，每筆都有已到場／未到場。
    assert datas[0] == [actions.encode(actions.ATTEND_ASK, str(newer.id)), actions.encode(actions.NOSHOW_ASK, str(newer.id))]
    assert datas[1][0] == actions.encode(actions.ATTEND_ASK, str(older.id))


async def test_awaiting_with_nothing_pending_says_so(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    (visit,) = await _visits(app)
    await _move(app, visit, today_local() + timedelta(days=1))
    await _webhook(app, [_group_event("message", text="待標記")], account="main")
    assert _texts(fake_line.replies[0]) == [AWAITING_EMPTY_TEXT]


async def test_awaiting_is_in_the_mention_menu(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _webhook(app, [_group_event("message", text="@常春藤", mention_self=True)], account="main")
    menu = json.dumps(fake_line.replies[0]["body"], ensure_ascii=False)
    assert '"text": "待標記"' in menu and '"text": "下週參觀"' in menu


# --- 指定日期、下週（§3） ---------------------------------------------------------------------------


def test_day_of_picks_the_nearest_occurrence():
    assert _day_of(1, 5, date(2026, 12, 20)) == date(2027, 1, 5)
    assert _day_of(12, 30, date(2027, 1, 5)) == date(2026, 12, 30)
    assert _day_of(11, 28, date(2026, 11, 25)) == date(2026, 11, 28)
    assert _day_of(2, 30, date(2026, 11, 25)) is None
    assert _day_of(13, 1, date(2026, 11, 25)) is None
    assert _day_of(2, 29, date(2027, 11, 25)) == date(2028, 2, 29)


async def test_specific_day_lists_that_day_and_accepts_fullwidth(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2)
    first, second = await _visits(app)
    day = today_local() + timedelta(days=3)
    await _move(app, first, day)
    await _webhook(
        app,
        [
            _group_event("message", text=f"{day.month}/{day.day} 參觀"),
            _group_event("message", text=f"{day.month}/{day.day}參觀".translate(str.maketrans("0123456789/", "０１２３４５６７８９／"))),
        ],
        account="main",
    )
    assert len(fake_line.replies) == 2
    for reply in fake_line.replies:
        alt = reply["body"]["messages"][0]["altText"]
        assert alt.startswith(f"{day.month}/{day.day} 週") and alt.endswith("參觀（共 1 筆）")
        assert _datas(_carousel(reply)[1])[0] == actions.encode(actions.ATTEND_ASK, str(first.id))


async def test_past_day_points_to_awaiting_and_bad_dates_are_ignored(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    past = today_local() - timedelta(days=2)
    await _webhook(
        app,
        [
            _group_event("message", text=f"{past.month}/{past.day} 參觀"),
            _group_event("message", text="2/30 參觀"),
            _group_event("message", text="11/28"),  # 沒有 @ 官方帳號，不算
            _group_event("message", text="11/28 參觀嗎"),
        ],
        account="main",
    )
    assert [_texts(reply) for reply in fake_line.replies] == [[PAST_DAY_TEXT]]


async def test_short_date_and_next_week_work_with_mention(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=2)
    first, second = await _visits(app)
    today = today_local()
    next_monday = today + timedelta(days=7 - today.weekday())
    await _move(app, first, next_monday + timedelta(days=6))  # 下週日
    await _move(app, second, next_monday + timedelta(days=7))  # 下下週一，不算
    await _webhook(app, [_group_event("message", text="下週參觀")], account="main")
    reply = fake_line.replies[-1]
    sunday = next_monday + timedelta(days=6)
    assert reply["body"]["messages"][0]["altText"] == (
        f"下週參觀（{next_monday.month}/{next_monday.day}–{sunday.month}/{sunday.day}）（共 1 筆）"
    )
    event = _group_event("message", text=f"@常春藤 {sunday.month}/{sunday.day}", mention_self=True)
    event["message"]["mention"]["mentionees"][0]["length"] = 4
    await _webhook(app, [event], account="main")
    assert fake_line.replies[-1]["body"]["messages"][0]["altText"].endswith("（共 1 筆）")


# --- 卡片多帶人數與取消方（§4） ---------------------------------------------------------------------


def test_staff_card_shows_party_size_and_cancel_side_but_alt_text_is_unchanged():
    card = line_flex.staff_card(
        "參觀預約已取消", "義華校", when="11/28（五）10:00", parent_name="陳媽媽", receipt_id=str(uuid.uuid4()),
        url="https://admin.ivy.example/admin/visit-requests/x", kind="visit_request_cancelled", party_size=3, cancel_reason="parent",
    )
    texts = flex_texts(card)
    assert "參觀人數" in texts and "3 位" in texts and "取消方" in texts and "家長取消" in texts
    assert card["altText"] == "[常春藤官網] 參觀預約已取消｜義華校｜11/28（五）10:00"
    created = flex_texts(line_flex.staff_card("新的參觀預約", "義華校", when=None, parent_name=None, receipt_id="r", url=None, cancel_reason="staff"))
    assert "取消方" not in created and "參觀人數" not in created


def test_list_rows_show_party_size_and_parent_reply():
    rows = [
        line_flex.VisitRow("a", "義華校", "11/28（五）10:00", "陳媽媽", "confirmed", party_size=2, attendance_confirmed=True),
        line_flex.VisitRow("b", "義華校", "11/28（五）14:00", None, "confirmed"),
    ]
    bubbles = line_flex.visit_list_message("今日參觀", rows, empty_text="")["contents"]["contents"]
    first, second = flex_texts({"contents": bubbles[1]}), flex_texts({"contents": bubbles[2]})
    assert "2 位" in first and "家長回覆" in first and "會準時到" in first
    assert "參觀人數" not in second and "家長回覆" not in second


async def test_cancel_card_pushed_to_group_names_who_cancelled(app, fake_line, admin_client, public_client):
    from app.notifications.line import LineMessagingClient
    from app.notifications.service import dispatch_outbox_message

    await _world(app, admin_client, public_client)
    (visit,) = await _visits(app)
    async with app.state.session_factory() as db:
        await db.execute(
            update(VisitRequest).where(VisitRequest.id == visit.id).values(party_size=4, status="cancelled", cancel_reason="staff")
        )
        await db.commit()
    receipt_id = str(visit.id)
    outbox_id = await _outbox(app, receipt_id, "visit_request_cancelled")
    async with LineMessagingClient(MAIN_TOKEN, transport=fake_line.transport()) as line:
        async with app.state.session_factory() as db:
            await dispatch_outbox_message(
                db, outbox_message_id=outbox_id, campus_key="yihua", kind="visit_request_cancelled",
                payload={"receipt_id": receipt_id}, adapter=None, line=line, admin_origin="https://admin.ivy.example",
            )
    pushed = [push for push in fake_line.pushes if push["body"]["to"] == YIHUA_GROUP]
    assert pushed, fake_line.pushes
    texts = flex_texts(pushed[0]["body"]["messages"][0])
    assert "4 位" in texts and "園方取消" in texts
    assert actions.encode(actions.ATTEND_ASK, receipt_id) not in json.dumps(pushed[0]["body"])


# --- 到場結果卡的下次聯絡（§5） -------------------------------------------------------------------


@pytest.fixture
def _rf_helpers():
    from tests import test_line_group_recruitment as rec

    return rec


async def test_follow_up_buttons_on_result_card_set_next_contact_at_ten(app, fake_line, admin_client, public_client, _rf_helpers):
    from app.notifications.line_group_actions import follow_up_time
    from tests.test_line_group_attend import HQ_GROUP, _postback, _press

    rec = _rf_helpers
    await rec._all_groups(app)
    _receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    card = rec._last(fake_line)
    assert [rec._rf(actions.RF_FOLLOW, rv_id, days) for days in ("1", "3", "7")] == [
        data for data in rec._postback_datas(card) if data.startswith("ivy:rff:")
    ]
    assert {"明天聯絡", "3天後聯絡", "1週後聯絡"} <= set(rec._postback_labels(card))

    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "3"), HQ_GROUP))
    expected = follow_up_time(3)
    assert (await rec._visit(app, rv_id)).follow_up_at == expected
    assert rec._texts(fake_line, 1) == [
        f"已記錄：下次聯絡 {expected.month}/{expected.day}（{'一二三四五六日'[expected.weekday()]}）10:00"
    ]
    events = await rec._events(app, rv_id, "follow_up_updated")
    assert len(events) == 1 and events[0].actor_user_id is None
    audit = (await rec._field_audits(app))[-1]
    assert audit.metadata_json["field"] == "follow_up_at" and audit.metadata_json["value"] == 3

    # 再按同一顆：值沒變，不再寫歷程與稽核，照樣回已記錄。
    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "3"), HQ_GROUP))
    assert len(await rec._events(app, rv_id, "follow_up_updated")) == 1
    assert len(await rec._field_audits(app)) == 1


async def test_follow_up_refuses_bad_days_other_campus_and_enrolled(app, fake_line, admin_client, public_client, _rf_helpers):
    from tests.test_line_group_attend import HQ_GROUP, _postback, _press

    rec = _rf_helpers
    await rec._all_groups(app)
    _receipt, rv_id = await rec._attended(app, admin_client, public_client, fake_line)
    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "5"), HQ_GROUP))
    assert rec._texts(fake_line, 1) == [actions.INVALID_CHOICE_REPLY]
    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "1"), rec.MINGHUA_GROUP))
    assert rec._texts(fake_line, 1) == [actions.NO_PERMISSION_REPLY]
    await rec._set(app, rv_id, enrolled=True, enrolled_on=today_local())
    await _press(app, _postback(rec._rf(actions.RF_FOLLOW, rv_id, "1"), HQ_GROUP))
    assert rec._texts(fake_line, 1) == [actions.FOLLOW_UP_NOT_ALLOWED_REPLY]
    assert (await rec._visit(app, rv_id)).follow_up_at is None
