"""2026-10-06 後台 bug 稽核的回歸測試（對 origin/main d70bce03 審查出的問題）。

內容發布：已退回的版本不能靠排程上線、發布端點鎖的順序、同時審核、直接發布待審版要
通知送審的人。"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.auth.models import Role
from app.content.models import ContentItem, ContentRevision, PublishJob, SiteRelease
from app.common.timezones import today_local
from app.content.publish_jobs import run_due_jobs
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
FAQ = f"{API}/admin/content-items/campus_faq"
Q = "?campus_key=yihua"


def _faq(q="參觀要預約嗎？"):
    return {"items": [{"q": q, "a": "請先來電。"}]}


@pytest.fixture
async def yihua_admin(app, db_session):
    await _create_user(db_session, "yihua-admin@ivy.example", "yihua-admin-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    client = await _logged_in_client(app, "yihua-admin@ivy.example", "yihua-admin-password-123")
    yield client
    await client.aclose()


async def _draft(client, expected=0, q="參觀要預約嗎？"):
    resp = await client.post(f"{FAQ}/revisions{Q}", json={"expected_version": expected, "payload": _faq(q)})
    assert resp.status_code == 201, resp.text
    return resp.json()["latest_revision"]


async def _submitted(editor_client, q="被退回的內容"):
    rev = await _draft(editor_client, q=q)
    submitted = await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev["id"]})
    assert submitted.status_code == 200, submitted.text
    return rev


def _later(hours=2):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


async def _make_due(db_session):
    await db_session.execute(update(PublishJob).values(publish_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    await db_session.commit()


async def _my_notification_kinds(client) -> list[str]:
    return [n["kind"] for n in (await client.get(f"{API}/admin/my-notifications")).json()]


# ---------------------------------------------------------------- 內容發布


@pytest.mark.asyncio
async def test_rejected_revision_cannot_be_scheduled(editor_client, yihua_admin):
    rev = await _submitted(editor_client)
    await yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "reject", "note": "電話未確認"})
    scheduled = await yihua_admin.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": _later()})
    assert scheduled.status_code == 409, scheduled.text
    assert scheduled.json()["detail"]["code"] == "CONTENT_REVISION_REJECTED"


@pytest.mark.asyncio
async def test_rejecting_cancels_schedules_of_that_revision(editor_client, yihua_admin, public_client, db_session):
    rev = await _submitted(editor_client)
    job = await yihua_admin.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": _later()})
    assert job.status_code == 201, job.text
    rejected = await yihua_admin.post(
        f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "reject", "note": "電話未確認"}
    )
    assert rejected.status_code == 200, rejected.text
    assert (await db_session.get(PublishJob, uuid.UUID(job.json()["id"]), populate_existing=True)).status == "cancelled"

    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 0, "skipped": 0}
    assert (await public_client.get(f"{API}/public/site")).status_code == 503


@pytest.mark.asyncio
async def test_due_schedule_fails_when_revision_was_rejected(admin_client, public_client, db_session):
    """退回時會取消排程；這裡模擬繞過取消的情況（例如舊資料），到期時也不能發布。"""
    rev = await _draft(admin_client)
    job = await admin_client.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": _later()})
    assert job.status_code == 201, job.text
    await db_session.execute(
        update(ContentRevision).where(ContentRevision.id == uuid.UUID(rev["id"])).values(review_status="rejected")
    )
    await db_session.commit()
    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 1, "skipped": 0}
    assert (await public_client.get(f"{API}/public/site")).status_code == 503


@pytest.mark.asyncio
async def test_publish_takes_site_lock_before_item_lock(app, admin_client, db_session):
    """發布端點要先拿站台鎖、再鎖內容項（與 publish_revision 其他呼叫端同順序）。
    反過來的話，另一個已拿到站台鎖、正在寫 release entries（外鍵要 FOR KEY SHARE
    這個內容項）的發布會和它互等，PostgreSQL 判死結後中止其中一個。"""
    rev = await _draft(admin_client)
    item_id = (
        await db_session.execute(
            select(ContentItem.id).where(ContentItem.kind == "campus_faq", ContentItem.campus_key == "yihua")
        )
    ).scalar_one()
    await db_session.execute(text("INSERT INTO site_state (id, current_release_id) VALUES (1, NULL) ON CONFLICT DO NOTHING"))
    await db_session.commit()

    async with app.state.engine.connect() as other:
        trans = await other.begin()
        await other.execute(text("SELECT id FROM site_state WHERE id = 1 FOR UPDATE"))
        publish = asyncio.create_task(
            admin_client.post(
                f"{FAQ}/publish{Q}", json={"revision_id": rev["id"], "expected_published_revision_id": None}
            )
        )
        await asyncio.sleep(0.5)
        await other.execute(text("SET LOCAL lock_timeout = '500ms'"))
        try:
            await other.execute(
                text("SELECT id FROM content_items WHERE id = :id FOR KEY SHARE"), {"id": item_id}
            )
            blocked = False
        except DBAPIError:
            blocked = True
        await trans.rollback()
    response = await publish
    assert response.status_code == 200, response.text
    assert blocked is False, "發布端點在等站台鎖時已經鎖住內容項"


@pytest.fixture
def slow_publish_check(monkeypatch):
    """核准時在「讀到待審」與「發布」之間停一下，讓兩個審核請求確實交錯。"""
    from app.content import publish_jobs

    original = publish_jobs.check_publishable

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.3)
        return await original(*args, **kwargs)

    monkeypatch.setattr(publish_jobs, "check_publishable", slow)


@pytest.mark.asyncio
async def test_concurrent_approvals_publish_once(slow_publish_check, editor_client, yihua_admin, admin_client, db_session):
    # 兩位審核者（不同 session）同時核准。
    rev = await _submitted(editor_client)
    body = {"revision_id": rev["id"], "decision": "approve"}
    first, second = await asyncio.gather(
        yihua_admin.post(f"{FAQ}/review{Q}", json=body), admin_client.post(f"{FAQ}/review{Q}", json=body)
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    releases = (await db_session.execute(select(SiteRelease))).scalars().all()
    assert len(releases) == 1


@pytest.mark.asyncio
async def test_concurrent_approve_and_reject_keep_one_decision(slow_publish_check, editor_client, yihua_admin, admin_client, db_session):
    rev = await _submitted(editor_client)
    approve, reject = await asyncio.gather(
        yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "approve"}),
        admin_client.post(f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "reject", "note": "不行"}),
    )
    assert sorted([approve.status_code, reject.status_code]) == [200, 409], (approve.text, reject.text)
    revision = await db_session.get(ContentRevision, uuid.UUID(rev["id"]), populate_existing=True)
    item = (await db_session.execute(select(ContentItem).where(ContentItem.id == revision.content_item_id))).scalar_one()
    live = item.current_published_revision_id is not None
    assert (revision.review_status, live) in {("approved", True), ("rejected", False)}
    assert len(await _my_notification_kinds(editor_client)) == 1


@pytest.mark.asyncio
async def test_direct_publish_of_pending_revision_notifies_submitter(editor_client, yihua_admin):
    rev = await _submitted(editor_client, q="直接發布")
    published = await yihua_admin.post(f"{FAQ}/publish{Q}", json={"revision_id": rev["id"]})
    assert published.status_code == 200, published.text
    assert await _my_notification_kinds(editor_client) == ["content_review_approved"]


@pytest.mark.asyncio
async def test_scheduled_publish_of_pending_revision_notifies_submitter(editor_client, yihua_admin, db_session):
    rev = await _submitted(editor_client, q="排程發布")
    job = await yihua_admin.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": _later()})
    assert job.status_code == 201, job.text
    await _make_due(db_session)
    assert (await run_due_jobs(db_session))["published"] == 1
    assert await _my_notification_kinds(editor_client) == ["content_review_approved"]


# ---------------------------------------------------------------- 招生入學

from tests.admissions_helpers import (  # noqa: E402,F401
    ADMISSIONS,
    campus_admin_yihua_client,
    record_at_stage,
    reception_yihua_client,
    transition,
)


@pytest.mark.asyncio
async def test_reception_cannot_cancel_withdrawal_from_enrolled(campus_admin_yihua_client, reception_yihua_client):
    """退註冊要 convert；取消退註冊等於恢復註冊紀錄，也要 convert（否則接待能先取消退出、
    再刪掉曾註冊的訪視，繞過「刪除曾註冊的訪視要 convert」）。"""
    record = await record_at_stage(campus_admin_yihua_client, "withdrawn", withdrawn_from="enrolled")
    for to_stage in ("deposited", "visited"):
        denied = await reception_yihua_client.post(
            f"{ADMISSIONS}/records/{record['id']}/transition",
            json={"to_stage": to_stage, "expected_version": record["version"]},
        )
        assert denied.status_code == 403, denied.text
    revived = await transition(campus_admin_yihua_client, record, "deposited")
    assert revived["withdrawn_from"] is None


@pytest.mark.asyncio
async def test_reception_can_still_cancel_withdrawal_from_deposited(campus_admin_yihua_client, reception_yihua_client):
    record = await record_at_stage(campus_admin_yihua_client, "withdrawn", withdrawn_from="deposited")
    revived = await transition(reception_yihua_client, record, "deposited")
    assert revived["has_deposit"] is True


@pytest.mark.asyncio
async def test_enrolled_visit_term_cannot_be_edited(campus_admin_yihua_client, reception_yihua_client):
    record = await record_at_stage(campus_admin_yihua_client, "enrolled")
    for client in (reception_yihua_client, campus_admin_yihua_client):
        patched = await client.patch(
            f"{ADMISSIONS}/records/{record['id']}",
            json={"expected_version": record["version"], "target_school_year": 116},
        )
        assert patched.status_code == 409, patched.text
        assert patched.json()["detail"]["code"] == "RECRUITMENT_ENROLLED_TERM_LOCKED"
    # 其他欄位照常可以改；送一樣的學年學期也不算改。
    ok = await reception_yihua_client.patch(
        f"{ADMISSIONS}/records/{record['id']}",
        json={"expected_version": record["version"], "notes": "已繳學費", "target_school_year": record["target_school_year"]},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_reserved_seat_term_must_change_through_seat(campus_admin_yihua_client):
    record = await record_at_stage(campus_admin_yihua_client, "deposited")
    seat = await campus_admin_yihua_client.post(
        f"{ADMISSIONS}/records/{record['id']}/seat",
        json={"expected_version": record["version"], "grade": "小班", "target_school_year": 115, "target_semester": 1},
    )
    assert seat.status_code == 200, seat.text
    version = (await campus_admin_yihua_client.get(f"{ADMISSIONS}/records/{record['id']}")).json()["version"]
    patched = await campus_admin_yihua_client.patch(
        f"{ADMISSIONS}/records/{record['id']}", json={"expected_version": version, "target_semester": 2}
    )
    assert patched.status_code == 409, patched.text
    assert patched.json()["detail"]["code"] == "RECRUITMENT_SEAT_TERM_LOCKED"


# ---------------------------------------------------------------- 預約

from tests.conftest import (  # noqa: E402
    VISIT_SUBMIT_PATH,
    book_slot,
    case_version,
    create_slot,
    open_manage,
    set_booking_mode,
)

MANAGE = f"{API}/public/visit-manage"
CASES = f"{API}/admin/visit-requests"


async def _booked_and_open(admin_client, public_client, **kwargs) -> dict:
    booked = await book_slot(admin_client, public_client, **kwargs)
    await open_manage(public_client, booked["manage_path"])
    return booked


def _soon() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()


@pytest.mark.asyncio
async def test_parent_edit_does_not_conflict_with_staff_follow_up(admin_client, public_client, booking_consent):
    """家長改資料與園方的承辦人／下次聯絡是兩組不同的欄位，不能共用一個樂觀鎖。"""
    booked = await _booked_and_open(admin_client, public_client)
    staff_version = await case_version(admin_client, booked["receipt_id"])
    me = (await public_client.get(f"{MANAGE}/me")).json()

    edited = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "email": "new@example.com"},
    )
    assert edited.status_code == 200, edited.text
    note = await admin_client.post(
        f"{CASES}/{booked['receipt_id']}/contact-notes",
        json={"note": "已電話確認", "follow_up_at": _soon(), "expected_version": staff_version},
    )
    assert note.status_code == 201, note.text

    # 反過來：園方先改了下次聯絡，家長用自己頁面上的版本存檔照樣成功。
    me = edited.json()
    staff_version = await case_version(admin_client, booked["receipt_id"])
    cleared = await admin_client.post(
        f"{CASES}/{booked['receipt_id']}/contact-notes",
        json={"note": "改期再聯絡", "follow_up_at": None, "expected_version": staff_version},
    )
    assert cleared.status_code == 201, cleared.text
    again = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "child_name": "小明"},
    )
    assert again.status_code == 200, again.text


@pytest.mark.asyncio
async def test_parent_edits_from_two_tabs_still_conflict(admin_client, public_client, booking_consent):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()
    first = await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "child_name": "甲"}
    )
    assert first.status_code == 200, first.text
    assert first.json()["version"] == me["version"] + 1
    stale = await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "child_name": "乙"}
    )
    assert stale.status_code == 409, stale.text


@pytest.fixture
def slow_reschedule(monkeypatch):
    """在「檢查每案額度」之後、改期之前停一下，讓同時送出的請求都先通過額度檢查
    （正式站多個 worker 同時處理時就是這樣）。"""
    from app.booking import access_service

    original = access_service.validate_parent_reschedule

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.3)
        return await original(*args, **kwargs)

    monkeypatch.setattr(access_service, "validate_parent_reschedule", slow)


@pytest.mark.asyncio
async def test_parent_daily_reschedule_cap_holds_under_concurrency(slow_reschedule, app, admin_client, public_client, booking_consent):
    booked = await _booked_and_open(admin_client, public_client)
    x = await create_slot(admin_client, days_ahead=4, start_time="09:00:00", end_time="10:00:00")
    y = await create_slot(admin_client, days_ahead=4, start_time="13:00:00", end_time="14:00:00")
    for target in (x, y, x, y):
        moved = await public_client.post(
            f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": target}
        )
        assert moved.status_code == 200, moved.text
    targets = [
        await create_slot(admin_client, days_ahead=5, start_time=f"{hour:02d}:00:00", end_time=f"{hour:02d}:30:00")
        for hour in (9, 10, 11, 14)
    ]
    # 同一條修改連結在四個瀏覽器各開一個 session，同時送出。
    from tests.conftest import parent_client

    clients = [parent_client(app) for _ in targets]
    try:
        for client in clients:
            await open_manage(client, booked["manage_path"])
        responses = await asyncio.gather(
            *(
                client.post(f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": t})
                for client, t in zip(clients, targets)
            )
        )
    finally:
        for client in clients:
            await client.aclose()
    codes = sorted(r.status_code for r in responses)
    assert codes.count(200) == 1, [r.text for r in responses]
    assert codes.count(429) == 3, [r.text for r in responses]


@pytest.mark.asyncio
async def test_replayed_submit_does_not_reveal_regenerated_link(admin_client, public_client, booking_consent):
    booked = await book_slot(admin_client, public_client, idempotency_key="replay-key-1")
    regenerated = await admin_client.post(f"{CASES}/{booked['receipt_id']}/access-link")
    assert regenerated.status_code == 200, regenerated.text
    mode = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    replay = await public_client.post(
        VISIT_SUBMIT_PATH,
        json={
            "campus_key": "yihua",
            "config_version": mode["version"],
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "consent_given": True,
            "slot_id": booked["slot_id"],
        },
        headers={"Idempotency-Key": "replay-key-1"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["receipt_id"] == booked["receipt_id"]
    assert replay.json()["manage_path"] is None


@pytest.mark.asyncio
async def test_first_replay_still_returns_the_original_link(admin_client, public_client, booking_consent):
    booked = await book_slot(admin_client, public_client, idempotency_key="replay-key-2")
    mode = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    replay = await public_client.post(
        VISIT_SUBMIT_PATH,
        json={
            "campus_key": "yihua",
            "config_version": mode["version"],
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "consent_given": True,
            "slot_id": booked["slot_id"],
        },
        headers={"Idempotency-Key": "replay-key-2"},
    )
    assert replay.json()["manage_path"] == booked["manage_path"]


@pytest.mark.asyncio
async def test_duplicate_slot_is_rejected(admin_client):
    await create_slot(admin_client, days_ahead=6, start_time="10:00:00", end_time="11:00:00")

    body = {
        "slot_date": (today_local() + timedelta(days=6)).isoformat(),
        "start_time": "10:00:00",
        "end_time": "11:00:00",
        "capacity": 2,
    }
    again = await admin_client.post(f"{API}/admin/slots?campus_key=yihua", json=body)
    assert again.status_code == 409, again.text
    assert again.json()["detail"]["code"] == "SLOT_DUPLICATE"


@pytest.mark.asyncio
async def test_concurrent_duplicate_slots_create_one(admin_client):
    body = {
        "slot_date": (today_local() + timedelta(days=7)).isoformat(),
        "start_time": "15:00:00",
        "end_time": "16:00:00",
        "capacity": 2,
    }
    responses = await asyncio.gather(
        *(admin_client.post(f"{API}/admin/slots?campus_key=yihua", json=body) for _ in range(3))
    )
    assert sorted(r.status_code for r in responses) == [201, 409, 409], [r.text for r in responses]


@pytest.mark.asyncio
async def test_unknown_campus_is_404_not_500(admin_client):
    assert (await admin_client.get(f"{API}/admin/booking-config/typo")).status_code == 404
    patched = await admin_client.patch(
        f"{API}/admin/booking-config/typo", json={"expected_version": 1, "mode": "slots"}
    )
    assert patched.status_code == 404, patched.text
    slot = await admin_client.post(
        f"{API}/admin/slots?campus_key=typo",
        json={"slot_date": "2099-01-01", "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 2},
    )
    assert slot.status_code == 404, slot.text


@pytest.mark.asyncio
async def test_control_characters_are_422_not_500(admin_client):
    for params in ("q=%00", "status=%00", "source=a%00", "assignee=me&campus_key=yi%00hua"):
        listed = await admin_client.get(f"{CASES}?{params}")
        assert listed.status_code == 422, (params, listed.text)
    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions",
        json={"exception_date": "2099-01-01", "reason": "颱風\x00假"},
    )
    assert holiday.status_code == 422, holiday.text
    config = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    patched = await admin_client.patch(
        f"{API}/admin/booking-config/yihua",
        json={"expected_version": config["version"], "mode": "paused", "message": "暫停\x00受理"},
    )
    assert patched.status_code == 422, patched.text


# ---------------------------------------------------------------- 登入與帳號管理

from app.auth import service as auth_service  # noqa: E402
from app.auth.models import Session as AuthSession  # noqa: E402
from app.auth.models import User, UserCampusScope  # noqa: E402

AUTH = f"{API}/auth"
USERS = f"{API}/admin/users"


async def _age_sessions(db_session, user_id, minutes: int = 20) -> None:
    await db_session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id)
        .values(created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes))
    )
    await db_session.commit()


async def _user_id(db_session, email: str):
    return (await db_session.execute(select(User.id).where(User.email == email))).scalar_one()


@pytest.mark.asyncio
async def test_password_login_fails_if_password_was_reset_during_login(app, db_session, monkeypatch):
    """驗完密碼到建 session 之間，總管理者剛好重設了密碼（撤銷所有 session）：這次登入
    不能留下一個重設之後還有效的 session。"""
    await _create_user(db_session, "victim@ivy.example", "old-password-123456", Role.EDITOR, ["yihua"])
    original = auth_service.authenticate

    async def authenticate_then_reset(db, *args, **kwargs):
        user = await original(db, *args, **kwargs)
        async with app.state.engine.begin() as conn:
            await conn.execute(
                update(User).where(User.id == user.id).values(password_hash=auth_service.hash_password("new-password-654321"))
            )
        return user

    monkeypatch.setattr(auth_service, "authenticate", authenticate_then_reset)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(f"{AUTH}/login", json={"email": "victim@ivy.example", "password": "old-password-123456"})
    assert response.status_code == 401, response.text
    user_id = await _user_id(db_session, "victim@ivy.example")
    sessions = (await db_session.execute(select(AuthSession).where(AuthSession.user_id == user_id))).scalars().all()
    assert sessions == []


@pytest.mark.asyncio
@pytest.mark.parametrize("provider,column", [("line", "line_sub"), ("google", "google_sub")])
async def test_self_unlink_signs_out_other_devices(app, admin_client, db_session, provider, column):
    user_id = await _user_id(db_session, "admin@ivy.example")
    await db_session.execute(update(User).where(User.id == user_id).values(**{column: "linked-subject"}))
    await db_session.commit()
    other = await _logged_in_client(app, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await other.get(f"{AUTH}/me")).status_code == 200
        unlinked = await admin_client.delete(f"{AUTH}/{provider}/link")
        assert unlinked.status_code == 204, unlinked.text
        assert (await other.get(f"{AUTH}/me")).status_code == 401
        assert (await admin_client.get(f"{AUTH}/me")).status_code == 200
    finally:
        await other.aclose()


def _new_user(**overrides):
    body = {
        "email": "new-staff@ivy.example",
        "password": "new-staff-password-123",
        "role": "editor",
        "campus_keys": ["yihua"],
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_user_management_writes_need_recent_auth(admin_client, db_session):
    target = await _create_user(db_session, "target@ivy.example", "target-password-123", Role.EDITOR, ["yihua"])
    admin_id = await _user_id(db_session, "admin@ivy.example")
    await _age_sessions(db_session, admin_id)

    attempts = [
        ("post", USERS, _new_user()),
        ("patch", f"{USERS}/{target.id}/role", {"role": "super_admin"}),
        ("patch", f"{USERS}/{target.id}/scope", {"campus_keys": ["yihua", "minghua"]}),
        ("patch", f"{USERS}/{target.id}/capabilities", {"capabilities": ["booking.export"]}),
        ("post", f"{USERS}/{target.id}/password", {"password": "taken-over-password-1"}),
    ]
    for method, url, body in attempts:
        denied = await getattr(admin_client, method)(url, json=body)
        assert denied.status_code == 403, (url, denied.text)
        assert denied.json()["detail"]["code"] == "REAUTH_REQUIRED", url

    wrong = await admin_client.post(USERS, json=_new_user(current_password="not-my-password-1"))
    assert wrong.status_code == 403 and wrong.json()["detail"]["code"] == "REAUTH_REQUIRED"
    created = await admin_client.post(USERS, json=_new_user(current_password="super-admin-password-123"))
    assert created.status_code == 201, created.text

    # 停用是止血動作，不用重新驗證；重新啟用要。
    deactivated = await admin_client.patch(f"{USERS}/{target.id}/active", json={"is_active": False})
    assert deactivated.status_code == 200, deactivated.text
    reactivated = await admin_client.patch(f"{USERS}/{target.id}/active", json={"is_active": True})
    assert reactivated.status_code == 403 and reactivated.json()["detail"]["code"] == "REAUTH_REQUIRED"
    reactivated = await admin_client.patch(
        f"{USERS}/{target.id}/active", json={"is_active": True, "current_password": "super-admin-password-123"}
    )
    assert reactivated.status_code == 200, reactivated.text


@pytest.mark.asyncio
async def test_user_management_writes_within_ten_minutes_need_no_password(admin_client):
    created = await admin_client.post(USERS, json=_new_user())
    assert created.status_code == 201, created.text


@pytest.mark.asyncio
async def test_unknown_or_duplicate_campus_keys_are_rejected_or_merged(admin_client, db_session):
    unknown = await admin_client.post(USERS, json=_new_user(campus_keys=["typo"]))
    assert unknown.status_code == 422, unknown.text
    created = await admin_client.post(USERS, json=_new_user(campus_keys=["yihua", "yihua"]))
    assert created.status_code == 201, created.text
    assert created.json()["campus_keys"] == ["yihua"]
    user_id = created.json()["id"]
    scope = await admin_client.patch(f"{USERS}/{user_id}/scope", json={"campus_keys": ["minghua", "nope"]})
    assert scope.status_code == 422, scope.text
    role = await admin_client.patch(f"{USERS}/{user_id}/role", json={"role": "reception", "campus_keys": ["x"]})
    assert role.status_code == 422, role.text


@pytest.mark.asyncio
async def test_admin_origin_with_trailing_slash_still_accepts_writes(app, db_session):
    from app.config import Settings
    from app.main import create_app

    settings = app.state.settings.model_copy(update={"admin_origin": "http://test/"})
    normalized = Settings(**{**settings.model_dump(), "admin_origin": "http://test/"})
    assert normalized.admin_origin == "http://test"
    origin_app = create_app(normalized)
    try:
        await _create_user(db_session, "origin@ivy.example", "origin-password-12345", Role.SUPER_ADMIN)
        client = await _logged_in_client(origin_app, "origin@ivy.example", "origin-password-12345")
        try:
            response = await client.patch(
                f"{AUTH}/me", json={"display_name": "測試"}, headers={"origin": "http://test"}
            )
            assert response.status_code == 200, response.text
        finally:
            await client.aclose()
    finally:
        await origin_app.state.engine.dispose()


# ---------------------------------------------------------------- 通知

from app.booking.models import OutboxMessage, VisitSlot  # noqa: E402
from app.notifications.service import line_text  # noqa: E402
from app.workers.runner import process_outbox_batch  # noqa: E402


def test_line_text_strips_links_from_parent_name():
    text = line_text(
        "新的參觀預約", "義華校", "case-1", "https://admin.ivy.example",
        parent_name="王媽媽 後台已更新請改由 https://evil.example/login 或 www.evil.example 登入",
    )
    parent_line = next(line for line in text.splitlines() if line.startswith("家長："))
    assert "http" not in parent_line and "evil" not in parent_line and "www." not in parent_line
    assert parent_line.startswith("家長：王媽媽")
    assert len(parent_line) <= len("家長：") + 20
    assert "https://admin.ivy.example/admin/visit-requests/case-1" in text


@pytest.mark.asyncio
async def test_booked_mail_is_skipped_once_the_visit_has_started(
    app, admin_client, public_client, db_session, recording_mail_adapter, booking_consent
):
    """「預約成功」信因 SMTP 斷線排到場次之後才補寄（requeue）：不能寄一封已經過去的預約成功信。"""
    booked = await book_slot(admin_client, public_client)
    await db_session.execute(
        update(VisitSlot)
        .where(VisitSlot.id == uuid.UUID(booked["slot_id"]))
        .values(slot_date=today_local() - timedelta(days=1))
    )
    await db_session.commit()
    await process_outbox_batch(
        db_session, recording_mail_adapter, limit=50, admin_origin="https://www.ivy.example",
        access_secret=app.state.settings.session_secret,
    )
    assert [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"] == []
    status = (
        await db_session.execute(select(OutboxMessage.status).where(OutboxMessage.kind == "parent_visit_booked"))
    ).scalar_one()
    assert status == "skipped"


from tests.test_line_oauth import SUB, finish, line_app, line_client, line_provider, start_login  # noqa: E402,F401


@pytest.mark.asyncio
async def test_line_login_holds_the_user_row_while_creating_the_session(
    line_app, line_client, line_provider, db_session, monkeypatch
):
    """總管理者同時「解除綁定並登出」：LINE 登入建 session 時要握著帳號列鎖，解除那邊才會
    等這裡提交、再撤銷得到這次的 session（Google 登入本來就有鎖）。"""
    user = await _create_user(db_session, "line-staff@ivy.example", "line-staff-password-1", Role.EDITOR, ["yihua"])
    user.line_sub = SUB
    await db_session.commit()
    original = auth_service.create_session
    blocked: list[bool] = []

    async def create_session_while_admin_unlinks(db, target, **kwargs):
        async with line_app.state.engine.connect() as other:
            trans = await other.begin()
            await other.execute(text("SET LOCAL lock_timeout = '300ms'"))
            try:
                await other.execute(text("UPDATE users SET line_sub = NULL WHERE id = :id"), {"id": target.id})
                blocked.append(False)
            except DBAPIError:
                blocked.append(True)
            await trans.rollback()
        return await original(db, target, **kwargs)

    monkeypatch.setattr(auth_service, "create_session", create_session_while_admin_unlinks)
    state = await start_login(line_client, line_provider)
    response = await finish(line_client, state)
    assert response.status_code == 303, response.text
    assert blocked == [True]


# ---------------------------------------------------------------- 素材

from pathlib import Path  # noqa: E402

from app.media.models import MediaAsset, MediaKind, MediaStatus  # noqa: E402
from app.media.storage import LocalMediaStorage  # noqa: E402

MEDIA = f"{API}/admin/media"


async def _failed_asset(db_session, kind: MediaKind, size_bytes: int) -> None:
    db_session.add(
        MediaAsset(
            id=uuid.uuid4(),
            campus_key="yihua",
            kind=kind,
            status=MediaStatus.FAILED,
            storage_key=uuid.uuid4().hex,
            original_filename="failed",
            content_type="video/mp4" if kind == MediaKind.VIDEO else "image/jpeg",
            size_bytes=size_bytes,
            created_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_failed_video_still_counts_toward_quota(app, admin_client, db_session):
    """背景轉檔失敗的影片原檔留在儲存空間（重新處理要用），配額要算它。"""
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()
    app.state.settings.media_quota_bytes_per_campus = 1_000_000
    await _failed_asset(db_session, MediaKind.VIDEO, 1_000_000)
    blocked = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "MEDIA_QUOTA_EXCEEDED"


@pytest.mark.asyncio
async def test_failed_image_does_not_count_toward_quota(app, admin_client, db_session):
    """圖片處理失敗時檔案當下就刪了，配額照舊不算。"""
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()
    app.state.settings.media_quota_bytes_per_campus = 1_000_000
    await _failed_asset(db_session, MediaKind.IMAGE, 1_000_000)
    ok = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
    )
    assert ok.status_code == 201, ok.text


@pytest.mark.asyncio
async def test_storage_error_mid_upload_leaves_no_orphan_files(app, admin_client, db_session, tmp_path, monkeypatch):
    app.state.settings.media_root = str(tmp_path)
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()

    def broken_write_bytes(self, storage_key, data):
        raise OSError("儲存空間暫時無法寫入")

    monkeypatch.setattr(LocalMediaStorage, "write_bytes", broken_write_bytes)
    try:
        response = await admin_client.post(
            MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
        )
    except OSError:
        response = None
    assert response is None or response.status_code >= 500
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []
    assert (await db_session.execute(select(func.count()).select_from(MediaAsset))).scalar_one() == 0


@pytest.mark.asyncio
async def test_failed_commit_after_upload_leaves_no_orphan_files(app, admin_client, db_session, tmp_path, monkeypatch):
    from app.media import routes as media_routes

    app.state.settings.media_root = str(tmp_path)
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()

    async def broken_audit(*args, **kwargs):
        raise RuntimeError("稽核寫入失敗")

    monkeypatch.setattr(media_routes.audit_service, "log_action", broken_audit)
    try:
        response = await admin_client.post(
            MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
        )
    except RuntimeError:
        response = None
    assert response is None or response.status_code >= 500
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []
