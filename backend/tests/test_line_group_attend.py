"""群組按鈕標記已到場／未到場（二次確認；設計 §5）。

按「已到場」「未到場」先回確認卡（不寫入）；按確認卡上的「確認」（帶 5 分鐘有效的無狀態 token）
才走 workflow_service.mark_completed／mark_no_show。授權、狀態、時間在鎖內重做一次。
回覆都用 reply（不計則數）；LINE API 全部用 httpx.MockTransport 模擬。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, time, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, update
from starlette.requests import Request

from app.ad_conversions.models import AdConversionJob
from app.admissions.models import RecruitmentVisit
from app.booking.models import VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.notifications import line_group_actions as actions
from app.notifications import line_group_settings
from app.notifications.models import LineCampusTarget, LineGroup, LineGroupSetting
from app.operations.audit_service import LINE_GROUP_ACTIONS, LINE_GROUP_PRIVATE_KEYS, LINE_GROUP_SEARCH_KEYS
from app.operations.models import AuditLogEntry
from tests.conftest import book_slot, freeze_rate_limit_clock
from tests.test_line_group_dispatch import ALL_KINDS
from tests.test_line_integrations_20261116 import FakeLine, _reply_texts, _webhook, fake_line  # noqa: F401  (fixtures)

pytestmark = pytest.mark.usefixtures("booking_consent")

YIHUA_GROUP = "C" + "a" * 32
HQ_GROUP = "C" + "b" * 32
FREE_GROUP = "C" + "c" * 32
MEMBER = "U" + "9" * 32


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _postback(data, group: str = YIHUA_GROUP, *, user: str | None = MEMBER) -> dict:
    source: dict = {"type": "group", "groupId": group}
    if user:
        source["userId"] = user
    event: dict = {
        "type": "postback",
        "replyToken": uuid.uuid4().hex,
        "source": source,
        "timestamp": 0,
        "webhookEventId": uuid.uuid4().hex,
    }
    if data is not None:
        event["postback"] = {"data": data}
    return event


def _secret(app) -> str:
    return app.state.settings.session_secret


def _ok(app, action: str, receipt: str, *, now: datetime | None = None) -> str:
    """確認卡上「確認」按鈕的 data（帶有效 token）。"""
    token = actions.make_token(_secret(app), action, receipt, now=now or _now())
    return actions.encode(action, receipt, token)


async def _groups(app) -> None:
    """義華校區群組、總部群組、沒綁任何校的群組。"""
    now = _now()
    async with app.state.session_factory() as db:
        for target in (YIHUA_GROUP, HQ_GROUP, FREE_GROUP):
            db.add(LineGroup(target_id=target, source_type="group", first_seen_at=now, last_seen_at=now, verified_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="yihua", target_id=YIHUA_GROUP, updated_at=now))
        db.add(LineGroupSetting(target_id=HQ_GROUP, is_hq=True, kinds=ALL_KINDS, updated_at=now))
        await db.commit()


async def _case(
    app, admin_client, public_client, campus: str = "yihua", *, when: str = "started", start: str = "10:00:00", key: str = "a"
) -> str:
    """一筆已確認的預約，帶 GA 點擊識別碼（到場會排一筆廣告轉換回傳）。
    when：started＝今天 00:00 已開始；later＝今天 23:59 還沒開始；future＝三天後。"""
    hour = start[:2]
    booked = await book_slot(
        admin_client, public_client, campus, start_time=start, end_time=f"{hour}:30:00", idempotency_key=f"{campus}-{key}",
        phone=f"09{hour}{'1' if campus == 'yihua' else '2'}12345",
    )
    receipt = booked["receipt_id"]
    async with app.state.session_factory() as db:
        await db.execute(
            update(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt)).values(ad_click_ids={"ga_client_id": "555.666"})
        )
        await db.commit()
    await _move_slot(app, receipt, when)
    return receipt


async def _move_slot(app, receipt: str, when: str) -> None:
    if when == "future":
        return
    if when == "later" and datetime.now(OPERATING_TZ).time() >= time(23, 58):
        pytest.skip("台灣時間接近午夜，「今天還沒開始的場次」做不出來")
    values = (
        {"slot_date": today_local(), "start_time": time(0, 0), "end_time": time(0, 30)}
        if when == "started"
        else {"slot_date": today_local(), "start_time": time(23, 59), "end_time": time(23, 59, 30)}
    )
    async with app.state.session_factory() as db:
        slot_id = await db.scalar(select(VisitRequest.slot_id).where(VisitRequest.id == uuid.UUID(receipt)))
        await db.execute(update(VisitSlot).where(VisitSlot.id == slot_id).values(**values))
        await db.commit()


async def _press(app, *events: dict) -> None:
    response = await _webhook(app, list(events), account="main")
    assert response.status_code == 200, response.text


async def _status(app, receipt: str) -> str:
    async with app.state.session_factory() as db:
        return await db.scalar(select(VisitRequest.status).where(VisitRequest.id == uuid.UUID(receipt)))


async def _count(app, model, *where) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model).where(*where))


async def _audits(app, action: str) -> list[AuditLogEntry]:
    async with app.state.session_factory() as db:
        return list((await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == action))).scalars())


async def _closing_event(app, receipt: str, event_type: str) -> VisitRequestEvent:
    async with app.state.session_factory() as db:
        return (
            await db.execute(
                select(VisitRequestEvent).where(
                    VisitRequestEvent.visit_request_id == uuid.UUID(receipt), VisitRequestEvent.event_type == event_type
                )
            )
        ).scalar_one()


def _last(fake_line: FakeLine) -> dict:
    return fake_line.replies[-1]["body"]["messages"][0]


def _last_texts(fake_line: FakeLine) -> list[str]:
    return _reply_texts(fake_line.replies[-1])


def _postback_datas(node) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        action = node.get("action")
        if isinstance(action, dict) and action.get("type") == "postback":
            found.append(action["data"])
        for value in node.values():
            found += _postback_datas(value)
    elif isinstance(node, list):
        for item in node:
            found += _postback_datas(item)
    return found


def _uris(node) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        action = node.get("action")
        if isinstance(action, dict) and action.get("type") == "uri":
            found.append(action["uri"])
        for value in node.values():
            found += _uris(value)
    elif isinstance(node, list):
        for item in node:
            found += _uris(item)
    return found


# ---- token ------------------------------------------------------------------------------------------


def test_token_roundtrip_expiry_and_binding():
    now = datetime(2026, 11, 17, 2, 0, tzinfo=timezone.utc)
    rid = str(uuid.uuid4())
    token = actions.make_token("s" * 32, actions.ATTEND_OK, rid, now=now)
    exp, sig = token.split(".")
    assert int(exp) == int(now.timestamp()) + 300 and len(sig) == 16
    assert actions.check_token("s" * 32, actions.ATTEND_OK, rid, token, now=now)
    assert actions.check_token("s" * 32, actions.ATTEND_OK, rid, token, now=now + timedelta(seconds=300))
    assert not actions.check_token("s" * 32, actions.ATTEND_OK, rid, token, now=now + timedelta(seconds=301))
    # 綁動作、案件、密鑰；改一個字都不行。
    assert not actions.check_token("s" * 32, actions.NOSHOW_OK, rid, token, now=now)
    assert not actions.check_token("s" * 32, actions.ATTEND_OK, str(uuid.uuid4()), token, now=now)
    assert not actions.check_token("t" * 32, actions.ATTEND_OK, rid, token, now=now)
    assert not actions.check_token("s" * 32, actions.ATTEND_OK, rid, f"{int(exp) + 9999}.{sig}", now=now)
    for bad in ("", "garbage", ".", f"{exp}.", f".{sig}", f"x{exp}.{sig}", f"{exp}.{sig}.x", "１２３.abc", None):
        assert not actions.check_token("s" * 32, actions.ATTEND_OK, rid, bad, now=now)


# ---- 主流程 ------------------------------------------------------------------------------------------


async def test_ask_then_confirm_marks_completed_and_creates_recruitment_visit(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    assert app.state.settings.admissions_enabled is True

    await _press(app, _postback(actions.encode(actions.ATTEND_ASK, receipt)))
    assert len(fake_line.replies) == 1 and fake_line.pushes == []
    card = _last(fake_line)
    assert card["type"] == "flex" and "已到場" in " ".join(_last_texts(fake_line))
    ok_data = [d for d in _postback_datas(card) if d.startswith(f"ivy:{actions.ATTEND_OK}:")]
    assert len(ok_data) == 1
    assert await _status(app, receipt) == "confirmed"
    assert await _audits(app, "line.group.visit_attend") == []

    await _press(app, _postback(ok_data[0]))
    assert await _status(app, receipt) == "completed"
    rid = uuid.UUID(receipt)
    assert await _count(app, RecruitmentVisit, RecruitmentVisit.visit_request_id == rid) == 1
    assert await _count(app, AdConversionJob, AdConversionJob.visit_request_id == rid, AdConversionJob.event == "visit_attended") == 1
    event = await _closing_event(app, receipt, "completed")
    assert event.source == "line_group" and event.actor_user_id is None
    assert not (event.after or {}).get("early")
    [audit] = await _audits(app, "line.group.visit_attend")
    assert audit.actor_user_id is None and audit.target_type == "visit_request" and audit.target_id == receipt
    assert audit.campus_key == "yihua"
    assert audit.metadata_json == {
        "group_id": YIHUA_GROUP, "from_status": "confirmed", "to_status": "completed", "line_user_id": MEMBER,
    }
    # 群組 ID 與 userId 只給 notifications.manage 看，其餘鍵分校帳號搜得到（operations/audit_service）。
    assert audit.action in LINE_GROUP_ACTIONS
    assert set(audit.metadata_json) <= set(LINE_GROUP_SEARCH_KEYS) | LINE_GROUP_PRIVATE_KEYS
    # 結果卡：已標記〈家長稱呼〉已到場＋結果欄位按鈕（招生訪視 id）＋到後台的連結。
    result = _last(fake_line)
    texts = _last_texts(fake_line)
    assert "已標記陳媽媽已到場" in texts
    async with app.state.session_factory() as db:
        rv_id = await db.scalar(select(RecruitmentVisit.id).where(RecruitmentVisit.visit_request_id == rid))
    datas = _postback_datas(result)
    assert any(d.startswith(f"ivy:{actions.RF_DEPOSIT}:{rv_id}") for d in datas)
    assert f"https://admin.ivy.example/admin/visit-requests/{receipt}?openExternalBrowser=1" in _uris(result)
    assert len(fake_line.replies) == 2 and fake_line.pushes == []


async def test_confirm_without_ask_still_needs_valid_token(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    forged = actions.encode(actions.ATTEND_OK, receipt, f"{int(_now().timestamp()) + 200}.{'0' * 16}")
    await _press(app, _postback(forged), _postback(actions.encode(actions.NOSHOW_OK, receipt, "1.abc")))
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == [actions.EXPIRED_REPLY] * 2
    assert await _status(app, receipt) == "confirmed"
    assert await _count(app, RecruitmentVisit) == 0
    # 沒按過「已到場」也行：token 是無狀態的，只要有效就寫入。
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    assert await _status(app, receipt) == "completed"


async def test_expired_token_rejected(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    stale = _ok(app, actions.ATTEND_OK, receipt, now=_now() - timedelta(seconds=301))
    await _press(app, _postback(stale))
    assert _last(fake_line)["text"] == actions.EXPIRED_REPLY
    assert await _status(app, receipt) == "confirmed"
    assert await _audits(app, "line.group.visit_attend") == []


async def test_token_for_another_receipt_rejected(app, fake_line, admin_client, public_client):
    await _groups(app)
    first = await _case(app, admin_client, public_client, start="08:00:00", key="a")
    second = await _case(app, admin_client, public_client, start="09:00:00", key="b")
    token = actions.make_token(_secret(app), actions.ATTEND_OK, first, now=_now())
    await _press(app, _postback(actions.encode(actions.ATTEND_OK, second, token)))
    # 未到場的 token 也不能拿來確認已到場。
    nos_token = actions.make_token(_secret(app), actions.NOSHOW_OK, first, now=_now())
    await _press(app, _postback(actions.encode(actions.ATTEND_OK, first, nos_token)))
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == [actions.EXPIRED_REPLY] * 2
    assert await _status(app, first) == "confirmed" and await _status(app, second) == "confirmed"


async def test_double_confirm_second_press_reports_current_state_and_writes_once(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    data = _ok(app, actions.ATTEND_OK, receipt)
    # 兩個人同時按確認：案件列上鎖，後到的看到已到場。
    first, second = await asyncio.gather(
        _webhook(app, [_postback(data)], account="main"), _webhook(app, [_postback(data, user=None)], account="main")
    )
    assert first.status_code == 200 and second.status_code == 200
    # 同一個人再按一次（重放已成功的確認）。
    await _press(app, _postback(data))
    texts = [_reply_texts(r) for r in fake_line.replies]
    assert sum("已標記陳媽媽已到場" in t for t in texts) == 1
    assert [t for t in texts if t == [actions.STATUS_REPLIES["completed"]]] == [["已標記已到場"]] * 2
    rid = uuid.UUID(receipt)
    assert await _status(app, receipt) == "completed"
    assert await _count(app, RecruitmentVisit, RecruitmentVisit.visit_request_id == rid) == 1
    assert await _count(app, AdConversionJob, AdConversionJob.visit_request_id == rid) == 1
    assert len(await _audits(app, "line.group.visit_attend")) == 1
    assert await _count(app, VisitRequestEvent, VisitRequestEvent.visit_request_id == rid, VisitRequestEvent.event_type == "completed") == 1
    # 之後再按「已到場」「未到場」也只回目前狀態。
    await _press(app, _postback(actions.encode(actions.ATTEND_ASK, receipt)), _postback(actions.encode(actions.NOSHOW_ASK, receipt)))
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies[-2:]] == ["已標記已到場"] * 2


async def test_other_campus_case_is_refused(app, fake_line, admin_client, public_client):
    await _groups(app)
    minghua = await _case(app, admin_client, public_client, "minghua")
    await _press(
        app,
        _postback(actions.encode(actions.ATTEND_ASK, minghua)),
        _postback(_ok(app, actions.ATTEND_OK, minghua)),
        _postback(actions.encode(actions.NOSHOW_ASK, minghua)),
        _postback(_ok(app, actions.NOSHOW_OK, minghua)),
    )
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == [actions.NO_PERMISSION_REPLY] * 4
    assert await _status(app, minghua) == "confirmed"
    assert await _count(app, AuditLogEntry, AuditLogEntry.action.like("line.group.visit_%")) == 0
    assert await _count(app, RecruitmentVisit) == 0
    # 總部群組可以處理所有校區。
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, minghua), HQ_GROUP))
    assert await _status(app, minghua) == "completed"
    [audit] = await _audits(app, "line.group.visit_attend")
    assert audit.metadata_json["group_id"] == HQ_GROUP and audit.campus_key == "minghua"


async def test_total_future_day_slot_refused_until_the_day(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client, when="future")
    await _press(
        app,
        _postback(actions.encode(actions.ATTEND_ASK, receipt)),
        _postback(_ok(app, actions.ATTEND_OK, receipt)),
        _postback(actions.encode(actions.NOSHOW_ASK, receipt)),
        _postback(_ok(app, actions.NOSHOW_OK, receipt)),
    )
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == [
        actions.FUTURE_DAY_REPLY, actions.FUTURE_DAY_REPLY, actions.NOSHOW_TOO_EARLY_REPLY, actions.NOSHOW_TOO_EARLY_REPLY,
    ]
    assert actions.FUTURE_DAY_REPLY == "要到參觀當天才能標記"
    assert await _status(app, receipt) == "confirmed"
    assert await _count(app, AdConversionJob) == 0


async def test_today_not_started_slot_uses_early_arrival(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client, when="later")
    await _press(app, _postback(actions.encode(actions.ATTEND_ASK, receipt)))
    assert _last(fake_line)["type"] == "flex"
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    assert await _status(app, receipt) == "completed"
    event = await _closing_event(app, receipt, "completed")
    assert event.after["early"] is True
    assert "slot" not in event.after  # 約的是今天：保留場次，不釋出
    async with app.state.session_factory() as db:
        assert await db.scalar(select(VisitRequest.slot_id).where(VisitRequest.id == uuid.UUID(receipt))) is not None


async def test_no_show_only_after_slot_started(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client, when="later")
    await _press(app, _postback(actions.encode(actions.NOSHOW_ASK, receipt)), _postback(_ok(app, actions.NOSHOW_OK, receipt)))
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == [actions.NOSHOW_TOO_EARLY_REPLY] * 2
    assert actions.NOSHOW_TOO_EARLY_REPLY == "參觀時段開始後才能標記未到場"
    assert await _status(app, receipt) == "confirmed"

    await _move_slot(app, receipt, "started")
    await _press(app, _postback(actions.encode(actions.NOSHOW_ASK, receipt), user=None))
    card = _last(fake_line)
    assert card["type"] == "flex" and "未到場" in " ".join(_last_texts(fake_line))
    [ok] = [d for d in _postback_datas(card) if d.startswith(f"ivy:{actions.NOSHOW_OK}:")]
    await _press(app, _postback(ok, user=None))
    assert await _status(app, receipt) == "no_show"
    # 結果帶家長稱呼：用卡片，altText（鎖定畫面看得到）不放稱呼；純文字沒有 altText，通知會顯示整句。
    result = _last(fake_line)
    assert result["type"] == "flex" and result["altText"] == "已標記未到場"
    assert "已標記陳媽媽未到場" in _last_texts(fake_line)
    assert _postback_datas(result) == []
    event = await _closing_event(app, receipt, "no_show")
    assert event.source == "line_group" and event.actor_user_id is None
    [audit] = await _audits(app, "line.group.visit_no_show")
    # 事件沒帶 userId 就不記。
    assert audit.metadata_json == {"group_id": YIHUA_GROUP, "from_status": "confirmed", "to_status": "no_show"}
    assert await _count(app, RecruitmentVisit) == 0 and await _count(app, AdConversionJob) == 0
    await _press(app, _postback(ok))
    assert _last(fake_line)["text"] == "已標記未到場"


async def test_garbage_data_is_ignored_or_fixed_reply(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    missing = str(uuid.uuid4())
    await _press(
        app,
        _postback("ivy:att:not-a-uuid"),
        _postback(f"ivy:attok:{receipt}:garbage"),
        _postback("zzz"),
        _postback(None),
        _postback(12345),
        _postback("ivy:att"),
        _postback(f"ivy:att:{receipt}:extra"),
        _postback(f"ivy:attok:{receipt}"),
        _postback("ivy:no:extra"),
        _postback("ivy:zzz:" + receipt),
        _postback(""),
        _postback(f"ivy:att:{missing}"),
        _postback(_ok(app, actions.ATTEND_OK, missing)),
        _postback(_ok(app, actions.ATTEND_OK, "not-a-uuid")),
    )
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == [
        actions.GONE_REPLY, actions.EXPIRED_REPLY, actions.GONE_REPLY, actions.GONE_REPLY, actions.GONE_REPLY,
    ]
    assert await _status(app, receipt) == "confirmed"
    # 「取消」按鈕：不能只回「已取消」（會讀成預約被取消）。
    await _press(app, _postback(actions.encode(actions.CANCEL)))
    assert _last(fake_line)["text"] == actions.CANCEL_REPLY == "已取消這次標記，沒有寫入"
    assert await _status(app, receipt) == "confirmed"


async def test_admissions_disabled_still_marks_but_result_has_only_admin_link(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    app.state.settings.admissions_enabled = False
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    assert await _status(app, receipt) == "completed"
    assert await _count(app, RecruitmentVisit) == 0
    result = _last(fake_line)
    assert "已標記陳媽媽已到場" in _last_texts(fake_line)
    assert _postback_datas(result) == []
    assert _uris(result) == [f"https://admin.ivy.example/admin/visit-requests/{receipt}?openExternalBrowser=1"]


async def test_group_that_left_cannot_act(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    async with app.state.session_factory() as db:
        await db.execute(update(LineGroup).where(LineGroup.target_id == YIHUA_GROUP).values(left_at=_now()))
        await db.commit()
    # webhook 收到群組事件就代表官方帳號還在群組裡（會清掉 left_at），所以直接呼叫處理器，
    # 模擬「資料庫記著已離開」的群組按到舊卡片。
    request = Request({"type": "http", "app": app, "method": "POST", "path": "/", "headers": [], "query_string": b""})
    events = [_postback(actions.encode(actions.ATTEND_ASK, receipt)), _postback(_ok(app, actions.ATTEND_OK, receipt))]
    async with app.state.session_factory() as db:
        await actions.handle(request, db, events)
    assert fake_line.replies == []
    assert await _status(app, receipt) == "confirmed"
    # 沒綁任何校區的群組、沒綁校區的多人聊天室、一對一：一律不回應、不寫入。
    room = _postback(_ok(app, actions.ATTEND_OK, receipt))
    room["source"] = {"type": "room", "roomId": "R" + "d" * 32}
    user = _postback(_ok(app, actions.ATTEND_OK, receipt))
    user["source"] = {"type": "user", "userId": MEMBER}
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt), FREE_GROUP), room, user)
    assert fake_line.replies == []
    assert await _status(app, receipt) == "confirmed"
    assert await _count(app, AuditLogEntry, AuditLogEntry.action.like("line.group.visit_%")) == 0


LEGACY_GROUP = "C" + "e" * 32
ROOM = "R" + "f" * 32


def _in_room(event: dict, room: str = ROOM) -> dict:
    """同一個事件改成從多人聊天室來（source.roomId）。"""
    event["source"] = {"type": "room", "roomId": room, "userId": MEMBER}
    return event


async def test_unverified_legacy_group_buttons_do_nothing(app, fake_line, admin_client, public_client):
    """2026-09-29 以前綁定、沒貼過驗證碼的舊群組照常收卡片、查名單，但會寫入的按鈕（已到場／未到場、確認、
    招生結果欄位、取消）一律不回應、不寫入：設計 §5 第 4 點的前提是群組由驗證碼證明有後台人員在內。"""
    await _groups(app)
    now = _now()
    async with app.state.session_factory() as db:
        db.add(LineGroup(target_id=LEGACY_GROUP, source_type="group", first_seen_at=now, last_seen_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="minghua", target_id=LEGACY_GROUP, updated_at=now))
        await db.commit()
    receipt = await _case(app, admin_client, public_client, "minghua")
    await _press(
        app,
        _postback(actions.encode(actions.ATTEND_ASK, receipt), LEGACY_GROUP),
        _postback(_ok(app, actions.ATTEND_OK, receipt), LEGACY_GROUP),
        _postback(actions.encode(actions.NOSHOW_ASK, receipt), LEGACY_GROUP),
        _postback(_ok(app, actions.NOSHOW_OK, receipt), LEGACY_GROUP),
        _postback(actions.encode(actions.RF_BUS, str(uuid.uuid4()), "1"), LEGACY_GROUP),
        _postback(actions.encode(actions.CANCEL), LEGACY_GROUP),
    )
    assert fake_line.replies == []
    assert await _status(app, receipt) == "confirmed"
    assert await _count(app, AuditLogEntry, AuditLogEntry.action.like("line.group.visit_%")) == 0
    assert await _count(app, RecruitmentVisit) == 0
    # 唯讀的查名單照常回（只要綁著校區）。
    query = _postback(None, LEGACY_GROUP)
    query.update(type="message", message={"type": "text", "id": "m", "text": "今天參觀"})
    await _press(app, query)
    assert len(fake_line.replies) == 1 and "明華" in " ".join(_last_texts(fake_line))
    # 貼過驗證碼之後，按鈕就能用。
    async with app.state.session_factory() as db:
        await db.execute(update(LineGroup).where(LineGroup.target_id == LEGACY_GROUP).values(verified_at=_now()))
        await db.commit()
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt), LEGACY_GROUP))
    assert await _status(app, receipt) == "completed"


async def test_bound_room_can_press_buttons(app, fake_line, admin_client, public_client):
    """多人聊天室（roomId）也能被選為校區推播目標、收到帶按鈕的卡片：按鈕同群組一樣能用，授權規則相同。"""
    await _groups(app)
    now = _now()
    async with app.state.session_factory() as db:
        db.add(LineGroup(target_id=ROOM, source_type="room", first_seen_at=now, last_seen_at=now, verified_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="minghua", target_id=ROOM, updated_at=now))
        await db.commit()
    minghua = await _case(app, admin_client, public_client, "minghua", start="08:00:00", key="m")
    yihua = await _case(app, admin_client, public_client, "yihua", start="09:00:00", key="y")

    await _press(app, _in_room(_postback(actions.encode(actions.ATTEND_ASK, minghua))))
    card = _last(fake_line)
    assert card["type"] == "flex"
    [ok] = [d for d in _postback_datas(card) if d.startswith(f"ivy:{actions.ATTEND_OK}:")]
    await _press(app, _in_room(_postback(ok)))
    assert await _status(app, minghua) == "completed"
    [audit] = await _audits(app, "line.group.visit_attend")
    assert audit.metadata_json["group_id"] == ROOM and audit.campus_key == "minghua"
    # 聊天室只綁明華：義華的案件回沒有權限。
    await _press(app, _in_room(_postback(_ok(app, actions.ATTEND_OK, yihua))))
    assert _last(fake_line)["text"] == actions.NO_PERMISSION_REPLY
    assert await _status(app, yihua) == "confirmed"


async def test_hq_group_that_leaves_loses_hq(app, fake_line, admin_client, public_client):
    """總部群組被移出（leave）就不再是總部群組：有人再把官方帳號拉回來，不會默默恢復收五校卡片與按鈕寫入權。"""
    await _groups(app)
    receipt = await _case(app, admin_client, public_client, "minghua")

    def _event(kind: str, group: str) -> dict:
        event = _postback(None, group, user=None)
        event["type"] = kind
        if kind == "leave":
            del event["replyToken"]
        return event

    # 沒有設定列的群組（義華）離開也不出錯。
    await _press(app, _event("leave", HQ_GROUP), _event("leave", YIHUA_GROUP))
    async with app.state.session_factory() as db:
        setting = await db.get(LineGroupSetting, HQ_GROUP)
        group = await db.get(LineGroup, HQ_GROUP)
        assert group.left_at is not None
        assert setting.is_hq is False and setting.updated_by is None
        assert setting.kinds == ALL_KINDS  # 其他開關照留
        assert await db.get(LineGroupSetting, YIHUA_GROUP) is None

    # 再被拉回來（join）：群組恢復在線，但不是總部、也沒綁校區，說明與按鈕都不回應。
    await _press(app, _event("join", HQ_GROUP), _postback(_ok(app, actions.ATTEND_OK, receipt), HQ_GROUP))
    async with app.state.session_factory() as db:
        assert (await db.get(LineGroup, HQ_GROUP)).left_at is None
        assert (await db.get(LineGroupSetting, HQ_GROUP)).is_hq is False
    assert fake_line.replies == []
    assert await _status(app, receipt) == "confirmed"


async def test_campus_group_pulled_back_after_leaving_loses_its_campus(app, fake_line, admin_client, public_client):
    """校區群組被移出（leave）後，群組裡的人再把官方帳號拉回來（join），不會默默恢復收該校卡片、查名單與
    按鈕寫入，要總管理者在後台重新選（2026-11-19 資安審查）。離開期間綁定保留，後台才看得到「群組已離開」。"""
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)

    def _event(kind: str) -> dict:
        event = _postback(None, YIHUA_GROUP, user=None)
        event["type"] = kind
        if kind == "leave":
            del event["replyToken"]
        return event

    await _press(app, _event("leave"))
    async with app.state.session_factory() as db:
        assert (await db.get(LineGroup, YIHUA_GROUP)).left_at is not None
        assert (await db.get(LineCampusTarget, "yihua")).target_id == YIHUA_GROUP
    assert await _audits(app, "line.campus_target.update") == []

    await _press(app, _event("join"), _postback(_ok(app, actions.ATTEND_OK, receipt)))
    async with app.state.session_factory() as db:
        group = await db.get(LineGroup, YIHUA_GROUP)
        assert group.left_at is None and group.verified_at is not None
        assert await db.get(LineCampusTarget, "yihua") is None
        assert await line_group_settings.campuses_served(db, YIHUA_GROUP) is None
        # 義華的卡片只剩總部群組收。
        assert [target.target_id for target in await line_group_settings.targets_for(db, "yihua")] == [HQ_GROUP]
    [audit] = await _audits(app, "line.campus_target.update")
    assert audit.actor_user_id is None and audit.campus_key == "yihua" and audit.target_id == "yihua"
    assert audit.metadata_json == {"before": YIHUA_GROUP, "after": None, "reason": "line_group_rejoined"}
    assert fake_line.replies == []
    assert await _status(app, receipt) == "confirmed"

    # 一直在群組裡的群組照常：總部群組按按鈕不會被解除任何設定。
    await _press(app, _postback(actions.encode(actions.CANCEL), HQ_GROUP))
    async with app.state.session_factory() as db:
        assert (await db.get(LineGroupSetting, HQ_GROUP)).is_hq is True
    assert len(await _audits(app, "line.campus_target.update")) == 1


async def test_cancelled_case_replies_its_state(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    cancelled = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    await _press(app, _postback(actions.encode(actions.ATTEND_ASK, receipt)), _postback(_ok(app, actions.NOSHOW_OK, receipt)))
    assert [r["body"]["messages"][0]["text"] for r in fake_line.replies] == ["這筆預約已取消"] * 2
    assert await _status(app, receipt) == "cancelled"


async def test_reply_failure_does_not_undo_the_mark(app, fake_line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)

    def failing(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/bot/message/reply":
            return httpx.Response(500, json={"message": "error"})
        return fake_line.handler(request)

    app.state.line_transport = httpx.MockTransport(failing)
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    assert await _status(app, receipt) == "completed"
    assert len(await _audits(app, "line.group.visit_attend")) == 1


async def test_thirty_first_press_in_a_minute_is_ignored(app, fake_line, admin_client, public_client):
    await _groups(app)
    freeze_rate_limit_clock(app)
    await _press(app, *[_postback(actions.encode(actions.CANCEL)) for _ in range(31)])
    assert len(fake_line.replies) == 30
