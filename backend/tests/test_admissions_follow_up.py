"""參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 12 節 F01–F16）。"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select, update

from app.admissions import follow_up, retention
from app.admissions.models import RecruitmentContactLog, RecruitmentEventLog, RecruitmentVisit
from app.auth.models import Role, User
from app.booking.models import VisitRequest
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    complete,
    create_record,
    readonly_yihua_client,
    reception_yihua_client,
    record_at_stage,
    started_booking,
    transition,
)
from tests.conftest import _create_user, _logged_in_client, _test_settings, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

RECEPTION_EMAIL = "admissions-reception-yihua@ivy.example"


def _iso(value: datetime) -> str:
    return value.isoformat()


def _in(**delta) -> str:
    return _iso(datetime.now(timezone.utc) + timedelta(**delta))


async def _user_id(db_session, email: str) -> uuid.UUID:
    return await db_session.scalar(select(User.id).where(User.email == email))


async def _visit(db_session, visit_id) -> RecruitmentVisit:
    return await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(str(visit_id)))
        .execution_options(populate_existing=True)
    )


async def _visit_for_request(db_session, request_id) -> RecruitmentVisit:
    return await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(request_id)))
        .execution_options(populate_existing=True)
    )


async def _created_metadata(db_session, visit_id) -> dict:
    return await db_session.scalar(
        select(RecruitmentEventLog.metadata_json).where(
            RecruitmentEventLog.recruitment_visit_id == uuid.UUID(str(visit_id)),
            RecruitmentEventLog.event_type == "created",
        )
    )


async def _set_booking(db_session, request_id, **values) -> None:
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(str(request_id))).values(**values))
    await db_session.commit()


async def _log(client, record: dict, **overrides):
    body = {
        "expected_version": record["version"],
        "channel": "phone",
        "reached": True,
        "note": "家長說下週再決定",
        "next_follow_up_at": _in(days=3),
        **overrides,
    }
    return await client.post(f"{ADMISSIONS}/records/{record['id']}/contact-logs", json=body)


# ---- F01–F04：建檔時帶入的追蹤欄位（規格 6.1）----


@pytest.mark.asyncio
async def test_completion_sets_owner_from_assignee_without_scheduling(
    admin_client, public_client, reception_yihua_client, db_session
):
    """F01：標記已到場不自動排第一次聯絡；負責人＝預約承辦人。"""
    reception_id = await _user_id(db_session, RECEPTION_EMAIL)
    booking = await started_booking(admin_client, public_client, db_session)
    await _set_booking(db_session, booking["id"], assigned_staff_id=reception_id)
    assert (await complete(admin_client, booking["id"])).status_code == 200
    visit = await _visit_for_request(db_session, booking["id"])
    assert (visit.follow_up_at, visit.follow_up_owner_id, visit.last_contacted_at) == (None, reception_id, None)
    assert await _created_metadata(db_session, visit.id) == {"origin": "visit_request", "follow_up": "none"}


@pytest.mark.asyncio
async def test_owner_falls_back_to_the_person_marking_arrival(
    admin_client, public_client, minghua_client, db_session
):
    """F02：承辦人停用、沒有該校區、沒有承辦人時，負責人是標記到場的人。"""
    admin_id = await _user_id(db_session, "admin@ivy.example")
    other_campus_id = await _user_id(db_session, "minghua-admin@ivy.example")
    inactive_id = (
        await _create_user(db_session, "inactive-desk@ivy.example", "inactive-desk-password-1", Role.RECEPTION, ["yihua"])
    ).id
    await db_session.execute(update(User).where(User.id == inactive_id).values(is_active=False))
    await db_session.commit()
    for assignee in (inactive_id, other_campus_id, None):
        booking = await started_booking(admin_client, public_client, db_session)
        await _set_booking(db_session, booking["id"], assigned_staff_id=assignee)
        assert (await complete(admin_client, booking["id"])).status_code == 200
        visit = await _visit_for_request(db_session, booking["id"])
        assert visit.follow_up_owner_id == admin_id, assignee


@pytest.mark.asyncio
async def test_initial_fields_skips_ineligible_candidates(editor_client, db_session):
    """F02：候選人都不符合（editor 沒有招生權限、帳號不存在）時負責人為 None。"""
    editor_id = await _user_id(db_session, "editor-yihua@ivy.example")
    fields = await follow_up.initial_fields(
        db_session, campus_key="yihua", booking_follow_up_at=None, owner_candidates=[editor_id, uuid.uuid4(), None]
    )
    assert fields == {"follow_up_at": None, "follow_up_owner_id": None}


@pytest.mark.asyncio
async def test_booking_follow_up_is_carried_only_when_still_ahead(admin_client, public_client, db_session):
    """F03：預約上還沒到的下次聯絡沿用（follow_up=booking）；已過的不沿用。"""
    ahead = datetime.now(timezone.utc) + timedelta(days=2)
    future = await started_booking(admin_client, public_client, db_session)
    await _set_booking(db_session, future["id"], follow_up_at=ahead)
    past = await started_booking(admin_client, public_client, db_session)
    await _set_booking(db_session, past["id"], follow_up_at=datetime.now(timezone.utc) - timedelta(hours=1))
    for booking in (future, past):
        assert (await complete(admin_client, booking["id"])).status_code == 200
    carried = await _visit_for_request(db_session, future["id"])
    dropped = await _visit_for_request(db_session, past["id"])
    assert carried.follow_up_at == ahead
    assert await _created_metadata(db_session, carried.id) == {"origin": "visit_request", "follow_up": "booking"}
    assert dropped.follow_up_at is None
    # 預約本身不動：下次聯絡與版本照舊。
    request = await db_session.scalar(
        select(VisitRequest).where(VisitRequest.id == uuid.UUID(future["id"])).execution_options(populate_existing=True)
    )
    assert request.follow_up_at == ahead


@pytest.mark.asyncio
async def test_manual_and_rebuild_paths(admin_client, reception_yihua_client, db_session):
    """F04：手動新增負責人＝建立者、不排；補建同到場規則；已有訪視時追蹤欄位不變。"""
    reception_id = await _user_id(db_session, RECEPTION_EMAIL)
    record = await create_record(reception_yihua_client)
    assert (record["follow_up_at"], record["follow_up_owner_id"]) == (None, str(reception_id))

    request_id = await legacy_request(db_session, status="completed")
    await _set_booking(db_session, request_id, follow_up_at=datetime.now(timezone.utc) + timedelta(days=1))
    built = await reception_yihua_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")
    assert built.status_code == 200, built.text
    assert built.json()["follow_up_owner_id"] == str(reception_id)
    assert built.json()["follow_up_at"] is not None
    patched = await admin_client.patch(
        f"{ADMISSIONS}/records/{built.json()['id']}/follow-up",
        json={"expected_version": built.json()["version"], "follow_up_at": None},
    )
    assert patched.status_code == 200, patched.text
    again = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")
    assert again.json()["follow_up_at"] is None
    assert again.json()["follow_up_owner_id"] == str(reception_id)


# ---- F05：追蹤狀態（規格 6.2）----


NOW = datetime(2026, 10, 5, 2, 0, tzinfo=timezone.utc)


def _raw(campus_key: str = "yihua", **overrides) -> RecruitmentVisit:
    values = {
        "id": uuid.uuid4(),
        "campus_key": campus_key,
        "month": "115.10",
        "visit_date": date(2026, 10, 1),
        "child_name": "測試",
        "created_at": NOW - timedelta(days=5),
        "updated_at": NOW - timedelta(days=5),
        **overrides,
    }
    return RecruitmentVisit(**values)


@pytest.mark.asyncio
async def test_follow_up_kinds_boundaries_scope_and_owner_filter(admin_client, db_session):
    owner = await _user_id(db_session, "admin@ivy.example")
    rows = {
        "due_now": _raw(follow_up_at=NOW, follow_up_owner_id=owner),
        "due_old": _raw(follow_up_at=NOW - timedelta(days=3), has_deposit=True),
        "upcoming_edge": _raw(follow_up_at=NOW + timedelta(days=7), follow_up_owner_id=owner),
        "beyond": _raw(follow_up_at=NOW + timedelta(days=7, seconds=1)),
        "unscheduled": _raw(),
        "enrolled": _raw(enrolled=True, enrolled_on=date(2026, 10, 2), has_deposit=True),
        "withdrawn": _raw(withdrawn_at=NOW, withdrawn_from="deposited"),
        "anonymized": _raw(anonymized_at=NOW),
        "other_campus": _raw("minghua", follow_up_at=NOW - timedelta(days=1)),
    }
    db_session.add_all(rows.values())
    await db_session.commit()

    async def ids(kind, owner_filter=None):
        result = await follow_up.follow_up_list(
            db_session, "yihua", kind=kind, owner=owner_filter, current_user_id=owner, page=1, page_size=50, now=NOW
        )
        name_of = {str(v.id): k for k, v in rows.items()}
        return [name_of[str(row["visit_id"])] for row in result["rows"]], result

    due, result = await ids("due")
    assert due == ["due_old", "due_now"]  # 下次聯絡舊到新
    assert result["totals"] == {"due": 2, "upcoming": 1, "unscheduled": 1}
    assert (await ids("upcoming"))[0] == ["upcoming_edge"]
    assert (await ids("unscheduled"))[0] == ["unscheduled"]
    mine, mine_result = await ids("due", "me")
    assert mine == ["due_now"] and mine_result["total"] == 1
    assert mine_result["totals"]["due"] == 2  # totals 不受負責人篩選影響
    assert (await ids("due", "none"))[0] == ["due_old"]
    assert (await ids("upcoming", str(owner)))[0] == ["upcoming_edge"]
    assert await follow_up.due_counts(db_session, None, now=NOW) == {"yihua": 2, "minghua": 1}
    assert await follow_up.due_counts(db_session, ["minghua"], now=NOW) == {"minghua": 1}


@pytest.mark.asyncio
async def test_follow_ups_endpoint_and_record_filters(admin_client, db_session):
    record = await create_record(admin_client)
    other = await create_record(admin_client, child_name="李小華")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .values(follow_up_at=datetime.now(timezone.utc) - timedelta(hours=1))
    )
    await db_session.commit()
    response = await admin_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scope"] == "due" and body["totals"] == {"due": 1, "upcoming": 0, "unscheduled": 1}
    [row] = body["rows"]
    assert row["visit_id"] == record["id"] and row["stage"] == "visited"
    assert row["follow_up_owner_name"] == "admin@ivy.example" and row["follow_up_owner_active"] is True
    assert row["last_contact_channel"] is None and "birthday" not in row and "address" not in row
    unscheduled = (await admin_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua&scope=unscheduled")).json()
    assert [r["visit_id"] for r in unscheduled["rows"]] == [other["id"]]

    filtered = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&follow_up=due&owner=me")
    assert [r["id"] for r in filtered.json()] == [record["id"]]
    assert (await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&owner=none")).json() == []
    assert (await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&owner=someone")).status_code == 422
    assert (await admin_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua&scope=later")).status_code == 422

    board = (await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).json()
    cards = {card["id"]: card for card in board["columns"]["visited"]}
    assert cards[record["id"]]["follow_up_at"] is not None and cards[other["id"]]["follow_up_at"] is None
    options = (await admin_client.get(f"{ADMISSIONS}/options?campus_key=yihua")).json()
    assert options["contact_channels"] == {
        "phone": "電話", "line": "LINE", "in_person": "當面", "revisit": "再參觀", "other": "其他",
    }


@pytest.mark.asyncio
async def test_contact_log_accepts_revisit(admin_client, db_session):
    """2026-10-05 照紙本「再參觀／電訪」補的方式；資料庫 CHECK 也要放行。"""
    record = await create_record(admin_client)
    response = await _log(admin_client, record, channel="revisit", note="帶阿嬤再來看一次")
    assert response.status_code == 201, response.text
    [log] = (
        await db_session.execute(
            select(RecruitmentContactLog).where(RecruitmentContactLog.recruitment_visit_id == uuid.UUID(record["id"]))
        )
    ).scalars().all()
    assert log.channel == "revisit"


# ---- F06–F09：記錄聯絡、改期、轉換連動、並行（規格 6.3–6.5）----


@pytest.mark.asyncio
async def test_contact_log_rules(admin_client, db_session):
    """F06。"""
    record = await create_record(admin_client)
    missing = await admin_client.post(
        f"{ADMISSIONS}/records/{record['id']}/contact-logs",
        json={"expected_version": record["version"], "channel": "phone", "reached": False},
    )
    assert missing.status_code == 422  # next_follow_up_at 必填（可為 null）
    assert (await _log(admin_client, record, next_follow_up_at=_in(minutes=-1))).json()["detail"]["code"] == "FOLLOW_UP_IN_PAST"
    assert (await _log(admin_client, record, contacted_at=_in(minutes=10))).json()["detail"]["code"] == "CONTACTED_AT_IN_FUTURE"
    assert (await _log(admin_client, record, note="   ")).status_code == 422  # 聯絡到要寫內容
    assert (await _log(admin_client, record, reached=False, note=None, update_parent_response=True)).status_code == 422
    assert (await _log(admin_client, record, channel="sms")).status_code == 422
    # 沒帶時區的時間無法和伺服器的現在比較：一律 422，不是 500。
    assert (await _log(admin_client, record, next_follow_up_at="2099-01-01T10:00:00")).status_code == 422
    assert (await _log(admin_client, record, contacted_at="2026-01-01T10:00:00")).status_code == 422
    naive_patch = await admin_client.patch(
        f"{ADMISSIONS}/records/{record['id']}/follow-up",
        json={"expected_version": record["version"], "follow_up_at": "2099-01-01T10:00:00"},
    )
    assert naive_patch.status_code == 422

    first = await _log(admin_client, record, update_parent_response=True, note="想先看學費")
    assert first.status_code == 201, first.text
    visit = first.json()["visit"]
    assert visit["version"] == record["version"] + 1
    assert visit["parent_response"] == "想先看學費" and visit["follow_up_at"] is not None
    assert first.json()["log"]["created_by_name"] == "admin@ivy.example"
    contacted = datetime.fromisoformat(visit["last_contacted_at"])

    # 補登一筆較早的、沒聯絡到、不用再追：最近聯絡不往回改，下次聯絡清掉，電訪回應不動。
    earlier = await _log(
        admin_client, visit, reached=False, note=None, contacted_at=_in(days=-2), next_follow_up_at=None
    )
    assert earlier.status_code == 201, earlier.text
    after = earlier.json()["visit"]
    assert datetime.fromisoformat(after["last_contacted_at"]) == contacted
    assert after["follow_up_at"] is None and after["parent_response"] == "想先看學費"
    # 時鐘誤差內的「未來」聯絡時間改用現在。
    skew = await _log(admin_client, after, contacted_at=_in(seconds=30))
    assert skew.status_code == 201
    assert datetime.fromisoformat(skew.json()["log"]["contacted_at"]) <= datetime.now(timezone.utc)

    logs = (await admin_client.get(f"{ADMISSIONS}/records/{record['id']}/contact-logs")).json()
    assert len(logs) == 3 and logs[-1]["reached"] is False  # 新到舊：補登的最早
    audit = (
        await db_session.execute(select(AuditLogEntry.metadata_json).where(AuditLogEntry.action == "recruitment_visit.contact_logged"))
    ).scalars().all()
    assert len(audit) == 3 and "想先看學費" not in json.dumps(audit, ensure_ascii=False)


@pytest.mark.asyncio
async def test_closed_stages_can_log_but_not_schedule(admin_client, db_session):
    """F07：已註冊、已退出只能「不用再追」；聯絡紀錄照記。"""
    for stage in ("enrolled", "withdrawn"):
        record = await record_at_stage(admin_client, stage)
        blocked = await _log(admin_client, record)
        assert blocked.json()["detail"]["code"] == "FOLLOW_UP_NOT_ALLOWED", stage
        patch = await admin_client.patch(
            f"{ADMISSIONS}/records/{record['id']}/follow-up",
            json={"expected_version": record["version"], "follow_up_at": _in(days=1)},
        )
        assert patch.json()["detail"]["code"] == "FOLLOW_UP_NOT_ALLOWED"
        assert (await _log(admin_client, record, next_follow_up_at=None)).status_code == 201


@pytest.mark.asyncio
async def test_transitions_clear_follow_up_and_keep_owner(admin_client, db_session):
    """F08。"""
    record = await create_record(admin_client)
    owner = record["follow_up_owner_id"]
    scheduled = (await _log(admin_client, record)).json()["visit"]
    deposited = await transition(admin_client, scheduled, "deposited")
    assert deposited["follow_up_at"] is not None  # 已預繳照樣追
    enrolled = await transition(
        admin_client, deposited, "enrolled", grade="小班", target_school_year=115, target_semester=1
    )
    assert (enrolled["follow_up_at"], enrolled["follow_up_owner_id"]) == (None, owner)
    reverted = await transition(admin_client, enrolled, "deposited", reason="家長改期")
    assert reverted["follow_up_at"] is None  # 往回轉不會自動恢復

    other = (await _log(admin_client, await create_record(admin_client, child_name="另一位"))).json()["visit"]
    other = await transition(admin_client, other, "deposited")
    withdrawn = await transition(admin_client, other, "withdrawn", reason="改送他校")
    assert withdrawn["follow_up_at"] is None and withdrawn["last_contacted_at"] is not None


@pytest.mark.asyncio
async def test_stale_version_is_rejected_without_writing(admin_client, db_session):
    """F09。"""
    record = await create_record(admin_client)
    assert (await _log(admin_client, record)).status_code == 201
    stale = await _log(admin_client, record, note="舊畫面送的")
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    stale_patch = await admin_client.patch(
        f"{ADMISSIONS}/records/{record['id']}/follow-up", json={"expected_version": record["version"], "follow_up_at": None}
    )
    assert stale_patch.status_code == 409
    count = await db_session.scalar(
        select(RecruitmentContactLog.id).where(RecruitmentContactLog.note == "舊畫面送的")
    )
    assert count is None


# ---- F10–F12：負責人、權限、開關 ----


@pytest.mark.asyncio
async def test_owner_validation_and_staff_list(
    admin_client, reception_yihua_client, editor_client, minghua_client, db_session
):
    """F10：停用、editor、他校帳號不能當負責人；帳號被刪後負責人為 null。/staff 只列可指派的人。"""
    record = await create_record(admin_client)
    editor_id = await _user_id(db_session, "editor-yihua@ivy.example")
    other_campus_id = await _user_id(db_session, "minghua-admin@ivy.example")
    reception_id = await _user_id(db_session, RECEPTION_EMAIL)
    gone = await _create_user(db_session, "leaving@ivy.example", "leaving-password-12", Role.RECEPTION, ["yihua"])
    inactive = await _create_user(db_session, "inactive@ivy.example", "inactive-password-12", Role.RECEPTION, ["yihua"])
    await db_session.execute(update(User).where(User.id == inactive.id).values(is_active=False))
    await db_session.commit()

    staff = (await admin_client.get(f"{ADMISSIONS}/staff?campus_key=yihua")).json()
    emails = {row["email"] for row in staff}
    assert {RECEPTION_EMAIL, "admin@ivy.example", "leaving@ivy.example"} <= emails
    assert not emails & {"editor-yihua@ivy.example", "minghua-admin@ivy.example", "inactive@ivy.example"}

    for user_id, message in (
        (inactive.id, "這個帳號已停用，不能指派"),
        (editor_id, "這個帳號沒有招生入學的權限"),
        (other_campus_id, "這個帳號沒有這個校區的權限"),
        (uuid.uuid4(), "找不到這個帳號"),
    ):
        response = await admin_client.patch(
            f"{ADMISSIONS}/records/{record['id']}/follow-up",
            json={"expected_version": record["version"], "follow_up_owner_id": str(user_id)},
        )
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert (detail["code"], detail["message"]) == ("FOLLOW_UP_OWNER_INVALID", message)

    moved = await admin_client.patch(
        f"{ADMISSIONS}/records/{record['id']}/follow-up",
        json={"expected_version": record["version"], "follow_up_owner_id": str(gone.id), "follow_up_at": _in(days=1)},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["version"] == record["version"] + 1
    unchanged = await admin_client.patch(
        f"{ADMISSIONS}/records/{record['id']}/follow-up",
        json={"expected_version": moved.json()["version"], "follow_up_owner_id": str(gone.id)},
    )
    assert unchanged.json()["version"] == moved.json()["version"]  # 沒變不加版本
    audit = (
        await db_session.execute(select(AuditLogEntry.metadata_json).where(AuditLogEntry.action == "recruitment_visit.follow_up_update"))
    ).scalars().all()
    assert audit == [{"follow_up_set": True, "follow_up_cleared": False, "owner_changed": True}]

    await db_session.execute(delete(User).where(User.id == gone.id))
    await db_session.commit()
    assert (await _visit(db_session, record["id"])).follow_up_owner_id is None
    assert reception_id is not None


@pytest.mark.asyncio
async def test_follow_up_permissions(
    admin_client, reception_yihua_client, readonly_yihua_client, editor_client, minghua_client, db_session
):
    """F11：reception 可記錄聯絡；editor／readonly 403；他校 404。"""
    record = await create_record(admin_client)
    assert (await _log(reception_yihua_client, record)).status_code == 201
    for client in (editor_client, readonly_yihua_client):
        assert (await client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua")).status_code == 403
        assert (await client.get(f"{ADMISSIONS}/records/{record['id']}/contact-logs")).status_code == 403
    assert (await minghua_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua")).status_code == 404
    assert (await minghua_client.get(f"{ADMISSIONS}/staff?campus_key=yihua")).status_code == 404
    assert (await minghua_client.get(f"{ADMISSIONS}/records/{record['id']}/contact-logs")).status_code == 404
    assert (await minghua_client.patch(
        f"{ADMISSIONS}/records/{record['id']}/follow-up", json={"expected_version": 1, "follow_up_at": None}
    )).status_code == 404


@pytest.mark.asyncio
async def test_disabled_flag_hides_follow_up_endpoints_and_dashboard_keys(admin_client, db_session):
    """F12。"""
    record = await create_record(admin_client)
    summary = (await admin_client.get(f"{API}/admin/dashboard")).json()
    assert summary["admissions_follow_up_due"] == 0 and summary["admissions_follow_up_due_by_campus"] == {}
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for method, path in (
            ("GET", f"{ADMISSIONS}/follow-ups?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/staff?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/records/{record['id']}/contact-logs"),
            ("POST", f"{ADMISSIONS}/records/{record['id']}/contact-logs"),
            ("PATCH", f"{ADMISSIONS}/records/{record['id']}/follow-up"),
        ):
            response = await client.request(method, path, json={} if method != "GET" else None)
            assert response.status_code == 404, (method, path)
        dashboard = (await client.get(f"{API}/admin/dashboard")).json()
        assert "admissions_follow_up_due" not in dashboard
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


# ---- F13：保存政策 ----


@pytest.mark.asyncio
async def test_anonymization_clears_contact_notes_and_follow_up(admin_client, db_session):
    record = await create_record(admin_client)
    logged = (await _log(admin_client, record, note="媽媽說爸爸想再看一次")).json()["visit"]
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .values(updated_at=datetime.now(timezone.utc) - timedelta(days=40))
    )
    await db_session.commit()
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    visit = await _visit(db_session, record["id"])
    assert visit.anonymized_at is not None and visit.follow_up_at is None
    log = await db_session.scalar(
        select(RecruitmentContactLog)
        .where(RecruitmentContactLog.recruitment_visit_id == visit.id)
        .execution_options(populate_existing=True)
    )
    assert (log.note, log.channel, log.reached) == (None, "phone", True)
    assert visit.last_contacted_at is not None
    again = await _log(admin_client, {**logged, "version": visit.version})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "RECRUITMENT_VISIT_ANONYMIZED"


# ---- F15、F16：預約端防呆與總覽 ----


@pytest.mark.asyncio
async def test_booking_follow_up_rejected_on_completed_or_cancelled(admin_client, public_client, db_session):
    """F15：已到場、已取消的預約不能設下次聯絡；清除與單純記錄照舊；已確認、未到場照舊。"""
    booking = await started_booking(admin_client, public_client, db_session)
    notes = f"{API}/admin/visit-requests/{booking['id']}/contact-notes"

    async def version() -> int:
        return (await admin_client.get(f"{API}/admin/visit-requests/{booking['id']}")).json()["version"]

    confirmed = await admin_client.post(notes, json={"note": "確認會來", "follow_up_at": _in(days=1), "expected_version": await version()})
    assert confirmed.status_code == 201, confirmed.text
    assert (await complete(admin_client, booking["id"])).status_code == 200
    blocked = await admin_client.post(notes, json={"note": "參觀後再聯絡", "follow_up_at": _in(days=2), "expected_version": await version()})
    assert blocked.status_code == 422 and blocked.json()["detail"]["code"] == "FOLLOW_UP_NOT_TRACKED"
    assert (await admin_client.post(notes, json={"note": "單純記一筆"})).status_code == 201
    cleared = await admin_client.post(notes, json={"note": "不用再追", "follow_up_at": None, "expected_version": await version()})
    assert cleared.status_code == 201, cleared.text

    no_show = await started_booking(admin_client, public_client, db_session)
    assert (await admin_client.post(f"{API}/admin/visit-requests/{no_show['id']}/no-show")).status_code == 200
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{no_show['id']}")).json()
    rebook = await admin_client.post(
        f"{API}/admin/visit-requests/{no_show['id']}/contact-notes",
        json={"note": "再約一次", "follow_up_at": _in(days=1), "expected_version": detail["version"]},
    )
    assert rebook.status_code == 201, rebook.text


@pytest.mark.asyncio
async def test_dashboard_counts_match_follow_up_list(admin_client, minghua_client, db_session):
    """F16：總覽與待追蹤分頁的已到期同一個條件；分校帳號只算自己的校區。"""
    yihua = await create_record(admin_client)
    minghua = await create_record(admin_client, "minghua")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id.in_([uuid.UUID(yihua["id"]), uuid.UUID(minghua["id"])]))
        .values(follow_up_at=datetime.now(timezone.utc) - timedelta(minutes=5))
    )
    await db_session.commit()
    summary = (await admin_client.get(f"{API}/admin/dashboard")).json()
    assert summary["admissions_follow_up_due"] == 2
    assert summary["admissions_follow_up_due_by_campus"] == {"yihua": 1, "minghua": 1}
    listed = (await admin_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua")).json()
    assert listed["totals"]["due"] == summary["admissions_follow_up_due_by_campus"]["yihua"]
    scoped = (await minghua_client.get(f"{API}/admin/dashboard")).json()
    assert scoped["admissions_follow_up_due"] == 1 and scoped["admissions_follow_up_due_by_campus"] == {"minghua": 1}


# ---- F14：匯出 ----


@pytest.mark.asyncio
async def test_export_adds_follow_up_extensions_and_contact_log_file(admin_client, db_session):
    from app.admissions import export

    await db_session.execute(update(User).where(User.email == "admin@ivy.example").values(display_name="王園長"))
    await db_session.commit()
    record = await create_record(admin_client)
    logged = (await _log(admin_client, record, note="想看英文課")).json()
    await create_record(admin_client, child_name="沒聯絡的")
    result = await export.export_campus(db_session, "yihua")
    assert list(result) == list(export.FILES) and export.FILES[-1] == "recruitment_contact_logs"
    extensions = {row["website_id"]: row for row in result["extensions"]}
    row = extensions[record["id"]]
    assert row["follow_up_owner_user_id"] == record["follow_up_owner_id"]
    assert row["follow_up_owner_name"] == "王園長"
    assert row["follow_up_at"] is not None and "+" not in row["follow_up_at"]  # 台北 naive
    [log] = result["recruitment_contact_logs"]
    assert log["website_id"] == logged["log"]["id"]
    assert log["recruitment_visit_website_id"] in extensions
    assert (log["channel"], log["reached"], log["note"]) == ("phone", True, "想看英文課")
    assert log["created_by"]["name"] == "王園長"
    assert "@" not in json.dumps(result["recruitment_contact_logs"] + result["extensions"], ensure_ascii=False)
