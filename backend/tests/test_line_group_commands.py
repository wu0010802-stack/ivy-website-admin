"""群組文字指令（今天／明天／本週參觀）、@官方帳號選單、新成員說明（設計 §4.2、§4.6、§4.7）。
回覆都用 reply（不計則數）；不存任何訊息內容。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import func, select, update

from app.booking.models import VisitSlot
from app.common.timezones import today_local
from app.notifications.models import LineCampusTarget, LineGroup, LineGroupSetting
from app.operations.models import AuditLogEntry
from tests.conftest import book_slot, freeze_rate_limit_clock
from tests.test_line_group_dispatch import ALL_KINDS
from tests.test_line_integrations_20261116 import FakeLine, _webhook, fake_line  # noqa: F401  (fixtures)

pytestmark = pytest.mark.usefixtures("booking_consent")

YIHUA_GROUP = "C" + "a" * 32
HQ_GROUP = "C" + "b" * 32
FREE_GROUP = "C" + "c" * 32
MEMBER = "U" + "9" * 32


def _group_event(kind: str, group: str = YIHUA_GROUP, text: str | None = None, *, mention_self: bool = False) -> dict:
    event: dict = {
        "type": kind,
        "source": {"type": "group", "groupId": group, "userId": MEMBER},
        "replyToken": uuid.uuid4().hex,
        "timestamp": 0,
        "webhookEventId": uuid.uuid4().hex,
    }
    if text is not None:
        message: dict = {"type": "text", "id": "m", "text": text}
        if mention_self:
            message["mention"] = {"mentionees": [{"index": 0, "length": 5, "type": "user", "isSelf": True}]}
        event["message"] = message
    return event


async def _world(app, admin_client, public_client, *, yihua: int = 1, minghua: int = 0) -> None:
    for i in range(yihua):
        await book_slot(admin_client, public_client, "yihua", start_time=f"{6 + i:02d}:00:00", end_time=f"{6 + i:02d}:30:00", idempotency_key=f"y{i}", phone=f"09123450{i:02d}")
    for i in range(minghua):
        await book_slot(admin_client, public_client, "minghua", start_time=f"{6 + i:02d}:00:00", end_time=f"{6 + i:02d}:30:00", idempotency_key=f"m{i}", phone=f"09123460{i:02d}")
    now = datetime.now(timezone.utc)
    async with app.state.session_factory() as db:
        for target in (YIHUA_GROUP, HQ_GROUP, FREE_GROUP):
            db.add(LineGroup(target_id=target, source_type="group", first_seen_at=now, last_seen_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="yihua", target_id=YIHUA_GROUP, updated_at=now))
        db.add(LineGroupSetting(target_id=HQ_GROUP, is_hq=True, kinds=ALL_KINDS, updated_at=now))
        await db.execute(update(VisitSlot).values(slot_date=today_local()))
        await db.commit()


def _carousel(reply: dict) -> list[dict]:
    return reply["body"]["messages"][0]["contents"]["contents"]


async def test_today_visits_command_replies_with_list_and_costs_no_push(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    response = await _webhook(app, [_group_event("message", text="今天參觀")], account="main")
    assert response.status_code == 200
    assert len(fake_line.replies) == 1 and fake_line.pushes == []
    reply = fake_line.replies[0]
    assert reply["account"] == "main"
    assert reply["body"]["messages"][0]["contents"]["type"] == "carousel"
    assert len(_carousel(reply)) == 2
    assert "今日參觀" in reply["body"]["messages"][0]["altText"]


async def test_command_needs_exact_match(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _webhook(app, [_group_event("message", text="今天參觀嗎"), _group_event("message", text="今天"), _group_event("message", text="大家好")], account="main")
    assert fake_line.replies == []


async def test_campus_group_sees_only_its_campus_hq_sees_all(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client, yihua=1, minghua=1)
    await _webhook(app, [_group_event("message", YIHUA_GROUP, "今天參觀"), _group_event("message", HQ_GROUP, "今天參觀")], account="main")
    assert len(fake_line.replies) == 2
    dumped = [json.dumps(r["body"], ensure_ascii=False) for r in fake_line.replies]
    assert "義華" in dumped[0] and "明華" not in dumped[0]
    assert "義華" in dumped[1] and "明華" in dumped[1]


async def test_unbound_or_left_group_gets_no_reply(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _webhook(app, [_group_event("message", FREE_GROUP, "今天參觀"), _group_event("memberJoined", FREE_GROUP)], account="main")
    assert fake_line.replies == []
    # 從沒看過的群組：記下來，但沒綁校區，不回。
    await _webhook(app, [_group_event("message", "C" + "d" * 32, "今天參觀")], account="main")
    assert fake_line.replies == []


async def test_mention_self_returns_menu_and_short_word_works_with_mention(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _webhook(app, [_group_event("message", text="@常春藤", mention_self=True)], account="main")
    assert len(fake_line.replies) == 1
    assert "參觀名單選單" in fake_line.replies[0]["body"]["messages"][0]["altText"]
    await _webhook(app, [_group_event("message", text="@常春藤 今天", mention_self=True)], account="main")
    assert len(fake_line.replies) == 2
    assert fake_line.replies[1]["body"]["messages"][0]["contents"]["type"] == "carousel"
    await _webhook(app, [_group_event("message", text="@常春藤 你好", mention_self=True)], account="main")
    assert len(fake_line.replies) == 2


def _mention_event(text: str, *mentions: tuple[int, int, bool], group: str = YIHUA_GROUP) -> dict:
    """mentions：(index, length, isSelf)，index／length 以 UTF-16 code unit 計（同 LINE）。"""
    event = _group_event("message", group, text)
    event["message"]["mention"] = {
        "mentionees": [
            {"index": index, "length": length, "type": "user", **({"isSelf": True} if is_self else {"userId": MEMBER})}
            for index, length, is_self in mentions
        ]
    }
    return event


def _kinds(fake_line: FakeLine) -> list[str]:
    """每則回覆是選單（menu）還是名單（list）。"""
    return [
        "menu" if r["body"]["messages"][0].get("altText") == "參觀名單選單" else "list" for r in fake_line.replies
    ]


async def test_mention_uses_mentionee_offsets_anywhere_in_the_message(app, fake_line, admin_client, public_client):
    """@官方帳號 用 mention 的 index／length 切掉，不靠「開頭到第一個空白」：名稱含空白、@ 在句尾、
    名稱含 emoji（UTF-16 算 2）都認得。"""
    await _world(app, admin_client, public_client)
    await _webhook(
        app,
        [
            _mention_event("@常春藤 官方", (0, 7, True)),  # 名稱含空白，只有 @ → 選單
            _mention_event("@常春藤 官方 今天", (0, 7, True)),
            _mention_event("今天 @常春藤", (3, 4, True)),  # @ 在句尾
            _mention_event("本週 @常春藤🌱", (3, 6, True)),  # 名稱含 emoji：@1＋3＋2
            _mention_event("  明天\n@常春藤 ", (5, 4, True)),
        ],
        account="main",
    )
    assert _kinds(fake_line) == ["menu", "list", "list", "list", "list"]


async def test_mention_of_other_user_is_not_stripped(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _webhook(
        app,
        [
            # 同時 @ 了官方帳號與別人：只切官方帳號那段，剩「@小明」不是空的，不出選單。
            _mention_event("@常春藤 @小明", (0, 4, True), (5, 3, False)),
            # 只 @ 別人＋短字：沒 @ 官方帳號，短字不算指令。
            _mention_event("@小明 今天", (0, 3, False)),
            _mention_event("今天 @小明", (3, 3, False)),
        ],
        account="main",
    )
    assert fake_line.replies == []


def test_self_mention_offsets_are_utf16_code_units():
    from app.notifications.line_group_commands import _command, _without_self_mentions

    self_at = lambda index, length: {"index": index, "length": length, "type": "user", "isSelf": True}  # noqa: E731
    # emoji 在 @ 前面：👍 佔 2 個 UTF-16 單位，@常春藤 從 3 開始；用字元位置切會切錯。
    assert _without_self_mentions("👍 @常春藤 今天", [self_at(3, 4)]) == "👍  今天"
    assert _without_self_mentions("😀😀@常春藤", [self_at(4, 4)]) == "😀😀"
    # 兩段都 @ 官方帳號。
    assert _without_self_mentions("@常春藤 今天 @常春藤", [self_at(0, 4), self_at(8, 4)]) == " 今天 "
    # 用不了的 index／length → None（呼叫端退回舊規則）：缺欄位、布林、負數、超出、重疊、切在 emoji 中間。
    for bad in (
        [{"isSelf": True}],
        [{"index": True, "length": 4, "isSelf": True}],
        [self_at(-1, 4)],
        [self_at(0, 0)],
        [self_at(0, 99)],
        [self_at(0, 4), self_at(2, 4)],
        [self_at(1, 4)],  # 從 👍 的後半開始切
    ):
        assert _without_self_mentions("👍 @常春藤 今天", bad) is None, bad
    assert _without_self_mentions("@小明 今天", [{"index": 0, "length": 3, "isSelf": False}]) is None
    # 退回舊規則：開頭的 @… 剝到第一個空白。
    event = _group_event("message", text="@常春藤 今天")
    event["message"]["mention"] = {"mentionees": [{"isSelf": True}]}
    assert _command(event, "@常春藤 今天") == ("today", False)


async def test_confirm_display_texts_are_not_commands(app, fake_line, admin_client, public_client):
    """確認卡「確認」的 displayText 會以按的人的名義送進群組（一般文字訊息事件）：不能被當成指令或選單。"""
    from app.notifications import line_flex
    from app.notifications.line_group_commands import _command

    await _world(app, admin_client, public_client)
    assert set(line_flex.CONFIRM_DISPLAY_TEXTS) == {"確認已到場", "確認未到場", "確認已預繳"}
    events = [_group_event("message", text=text) for text in line_flex.CONFIRM_DISPLAY_TEXTS]
    response = await _webhook(app, events, account="main")
    assert response.status_code == 200
    assert fake_line.replies == []
    for event in events:
        assert _command(event, event["message"]["text"]) == (None, False)


async def test_bound_room_can_query(app, fake_line, admin_client, public_client):
    """多人聊天室（roomId）也能被選為推播目標：指令同群組一樣回覆，只看它服務的校區。"""
    await _world(app, admin_client, public_client, yihua=1, minghua=1)
    room = "R" + "e" * 32
    now = datetime.now(timezone.utc)
    async with app.state.session_factory() as db:
        db.add(LineGroup(target_id=room, source_type="room", first_seen_at=now, last_seen_at=now, verified_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="minghua", target_id=room, updated_at=now))
        await db.commit()
    event = _group_event("message", text="今天參觀")
    event["source"] = {"type": "room", "roomId": room, "userId": MEMBER}
    await _webhook(app, [event], account="main")
    assert len(fake_line.replies) == 1
    dumped = json.dumps(fake_line.replies[0]["body"], ensure_ascii=False)
    assert "明華" in dumped and "義華" not in dumped


async def test_seventh_query_in_a_minute_is_ignored(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    freeze_rate_limit_clock(app)
    await _webhook(app, [_group_event("message", text="今天參觀") for _ in range(7)], account="main")
    assert len(fake_line.replies) == 6


async def test_member_joined_replies_help_once_per_10_minutes(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    freeze_rate_limit_clock(app)
    await _webhook(app, [_group_event("memberJoined")], account="main")
    assert len(fake_line.replies) == 1
    assert "今天參觀" in fake_line.replies[0]["body"]["messages"][0]["text"]
    await _webhook(app, [_group_event("memberJoined"), _group_event("join")], account="main")
    assert len(fake_line.replies) == 1


async def test_reply_failure_does_not_break_webhook(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)

    original = fake_line.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/bot/message/reply":
            return httpx.Response(500, json={"message": "error"})
        return original(request)

    app.state.line_transport = httpx.MockTransport(handler)
    response = await _webhook(app, [_group_event("message", text="今天參觀")], account="main")
    assert response.status_code == 200


async def test_messages_are_not_stored(app, fake_line, admin_client, public_client, db_session):
    await _world(app, admin_client, public_client)
    await _webhook(app, [_group_event("message", text="今天參觀"), _group_event("message", text="本週參觀")], account="main")
    audit_rows = (await db_session.execute(select(AuditLogEntry))).scalars().all()
    for row in audit_rows:
        assert "本週參觀" not in repr(vars(row))
    groups = (await db_session.scalars(select(LineGroup))).all()
    for group in groups:
        assert "參觀" not in repr((group.name, group.source_type))
    assert (await db_session.execute(select(func.count()).select_from(LineGroup))).scalar_one() == 3
