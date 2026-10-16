"""預計入學時間的修改與帶進招生（2026-10-15 規格 X4、X5、X7；計畫裁定 P4、W3-16）。"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.admissions import academic
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking import expected_start
from app.booking.models import OutboxMessage, VisitRequest
from app.common.timezones import today_local
from tests.admissions_helpers import API, complete, started_booking
from tests.conftest import book_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
CASES = f"{API}/admin/visit-requests"
MANAGE = f"{API}/public/visit-manage"


def _month_choice(index: int = 1) -> str:
    return expected_start.public_choices(today_local())[index]["value"]


def _term_after(offset: int) -> str:
    """今天所在學期往後 offset 個學期（負數往前）。"""
    year, semester = academic.current_term(today_local())
    index = year * 2 + semester - 1 + offset
    return expected_start.format_term((index // 2, index % 2 + 1))


async def _detail(client, case_id: str) -> dict:
    response = await client.get(f"{CASES}/{case_id}")
    assert response.status_code == 200, response.text
    return response.json()


async def _staff_patch(client, case_id: str, **fields):
    version = (await _detail(client, case_id))["details_version"]
    return await client.patch(f"{CASES}/{case_id}/details", json={"expected_version": version, **fields})


async def _parent_patch(public_client, me: dict, **fields):
    return await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": me["id"], "expected_version": me["version"], **fields}
    )


@pytest.mark.asyncio
async def test_staff_can_set_change_and_clear_it(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    case_id = booked["receipt_id"]
    # 後台只檢查格式，可以填過去的學期（規格 X8）。
    first = await _staff_patch(admin_client, case_id, expected_start="110-1")
    assert first.status_code == 200, first.text
    assert (first.json()["changed_fields"], first.json()["expected_start"]) == (["expected_start"], "110-1")
    second = await _staff_patch(admin_client, case_id, expected_start="111-2")
    assert (second.json()["changed_fields"], second.json()["expected_start"]) == (["expected_start"], "111-2")
    cleared = await _staff_patch(admin_client, case_id, expected_start="")
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["expected_start"] is None
    # 歷程只記欄位名，不記內容；三次修改各一筆。
    events = [e for e in cleared.json()["history"] if e["event_type"] == "details_updated"]
    assert [e["after"] for e in events] == [{"fields": ["expected_start"]}] * 3


@pytest.mark.asyncio
async def test_staff_null_also_clears_it(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, expected_start="asap")
    case_id = booked["receipt_id"]
    assert (await _detail(admin_client, case_id))["expected_start"] == "asap"
    cleared = await _staff_patch(admin_client, case_id, expected_start=None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["changed_fields"] == ["expected_start"]
    assert cleared.json()["expected_start"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["115-3", "soon", "99-1", "200-1", "115-2 "])
async def test_staff_rejects_malformed_values(admin_client, public_client, bad):
    booked = await book_slot(admin_client, public_client)
    case_id = booked["receipt_id"]
    version = (await _detail(admin_client, case_id))["details_version"]
    body = {"expected_version": version}
    rejected = await admin_client.patch(f"{CASES}/{case_id}/details", json={**body, "expected_start": bad})
    assert rejected.status_code == 422
    assert ["body", "expected_start"] in [error["loc"] for error in rejected.json()["detail"]]
    # 正向對照：同一個版本號、同一份 body 只換成格式正確的值就改得動，所以上面被擋的原因只是這個值。
    accepted = await admin_client.patch(f"{CASES}/{case_id}/details", json={**body, "expected_start": "115-2"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["expected_start"] == "115-2"


@pytest.mark.asyncio
async def test_parent_can_change_it_within_the_public_range(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, days_ahead=5, expected_start="asap")
    me = await open_manage(public_client, booked["manage_path"])
    assert me["expected_start"] == "asap"
    ok = await _parent_patch(public_client, me, expected_start=_month_choice(2))
    assert ok.status_code == 200, ok.text
    assert ok.json()["expected_start"] == _month_choice(2)
    year, semester = academic.current_term(today_local())
    past = await _parent_patch(
        public_client,
        {**me, "version": ok.json()["version"]},
        expected_start=expected_start.format_term((year - 1, semester)),
    )
    assert past.status_code == 422
    assert ["body", "expected_start"] in [error["loc"] for error in past.json()["detail"]]


@pytest.mark.asyncio
async def test_parent_range_ends_at_the_fifth_following_term(admin_client, public_client):
    """官網只列四個學期，公開端多收一個（規格 X7）；再往後一個學期就擋。"""
    booked = await book_slot(admin_client, public_client, days_ahead=5)
    me = await open_manage(public_client, booked["manage_path"])
    last = _term_after(expected_start.PUBLIC_TERMS_AHEAD)
    assert last not in {choice["value"] for choice in expected_start.public_choices(today_local())}
    too_far = await _parent_patch(public_client, me, expected_start=_term_after(expected_start.PUBLIC_TERMS_AHEAD + 1))
    assert too_far.status_code == 422
    assert ["body", "expected_start"] in [error["loc"] for error in too_far.json()["detail"]]
    ok = await _parent_patch(public_client, me, expected_start=last)
    assert ok.status_code == 200, ok.text
    assert ok.json()["expected_start"] == last


@pytest.mark.asyncio
@pytest.mark.parametrize("cleared", [None, ""])
async def test_parent_can_clear_it(admin_client, public_client, cleared):
    booked = await book_slot(admin_client, public_client, days_ahead=5, expected_start="unsure")
    me = await open_manage(public_client, booked["manage_path"])
    assert me["expected_start"] == "unsure"
    response = await _parent_patch(public_client, me, expected_start=cleared)
    assert response.status_code == 200, response.text
    assert response.json()["expected_start"] is None
    assert response.json()["version"] == me["version"] + 1


@pytest.mark.asyncio
async def test_parent_changing_only_the_term_sends_the_changed_mail(admin_client, public_client, db_session):
    """計畫裁定 W3-16：只改這一題也照現有行為寄「預約已變更」信，和只改人數、想了解的事一致。"""

    async def changed_mail_count() -> int:
        kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
        return kinds.count("parent_visit_changed")

    booked = await book_slot(admin_client, public_client, days_ahead=5, expected_start="asap")
    me = await open_manage(public_client, booked["manage_path"])
    before = await changed_mail_count()
    # 正向對照：送同一個值沒有變更，不寫歷程也不寄信。
    same = await _parent_patch(public_client, me, expected_start="asap")
    assert same.status_code == 200 and same.json()["version"] == me["version"]
    assert await changed_mail_count() == before
    changed = await _parent_patch(public_client, me, expected_start=_month_choice(1))
    assert changed.status_code == 200, changed.text
    assert await changed_mail_count() == before + 1


@pytest.mark.asyncio
async def test_parent_can_edit_other_fields_when_the_old_term_is_out_of_range(admin_client, public_client, db_session):
    """送單後跨了學期，原值已不在範圍內：沒動這一題就不送、不擋其他欄位（Review Focus 3）。"""
    booked = await book_slot(admin_client, public_client, days_ahead=5)
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"])).values(expected_start="110-1")
    )
    await db_session.commit()
    me = await open_manage(public_client, booked["manage_path"])
    assert me["expected_start"] == "110-1"
    response = await _parent_patch(public_client, me, child_name="小樹")
    assert response.status_code == 200, response.text
    assert response.json()["child_name"] == "小樹"
    assert response.json()["expected_start"] == "110-1"
    # 正向對照：同一個案件，把這一題送成範圍外的值才會被擋。
    stale = await _parent_patch(public_client, {**me, "version": response.json()["version"]}, expected_start="110-1")
    assert stale.status_code == 422
    assert ["body", "expected_start"] in [error["loc"] for error in stale.json()["detail"]]


async def _visit_for(db_session, case_id: str) -> RecruitmentVisit:
    return (
        await db_session.execute(
            select(RecruitmentVisit)
            .where(RecruitmentVisit.visit_request_id == uuid.UUID(case_id))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


def _term_of(visit: RecruitmentVisit) -> tuple[int, int]:
    return visit.target_school_year, visit.target_semester


async def _arrive(admin_client, public_client, db_session, **fields) -> RecruitmentVisit:
    """送單（場次移到昨天）→ 標記已到場，回傳建出來的招生訪視。"""
    booking = await started_booking(admin_client, public_client, db_session, **fields)
    assert (await complete(admin_client, booking["id"])).status_code == 200
    return await _visit_for(db_session, booking["id"])


@pytest.mark.asyncio
async def test_arrival_carries_the_chosen_term(admin_client, public_client, db_session):
    chosen = _month_choice(3)
    visit = await _arrive(admin_client, public_client, db_session, expected_start=chosen)
    assert _term_of(visit) == expected_start.parse(chosen)
    # 正向對照：選的學期和「今天所在學期」不同，所以帶進去的確實是家長選的，不是預設值。
    assert _term_of(visit) != academic.current_term(today_local())


@pytest.mark.asyncio
async def test_arrival_with_asap_uses_the_visit_day_term(admin_client, public_client, db_session):
    visit = await _arrive(admin_client, public_client, db_session, expected_start="asap")
    assert _term_of(visit) == academic.current_term(today_local() - timedelta(days=1))  # started_booking 把場次移到昨天


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", [{"expected_start": "unsure"}, {}], ids=["unsure", "left-blank"])
async def test_arrival_with_unsure_or_blank_uses_the_current_term(admin_client, public_client, db_session, fields):
    visit = await _arrive(admin_client, public_client, db_session, **fields)
    assert _term_of(visit) == academic.current_term(today_local())


@pytest.mark.asyncio
async def test_arrival_with_a_term_before_the_visit_day_uses_the_visit_day_term(admin_client, public_client, db_session):
    """家長很晚才來：預約上的學期比參觀日所在學期還早（後台補填的過去學期），用參觀日所在學期。"""
    booking = await started_booking(admin_client, public_client, db_session, expected_start=_month_choice(3))
    set_early = await _staff_patch(admin_client, booking["id"], expected_start="110-1")
    assert set_early.status_code == 200, set_early.text
    assert (await complete(admin_client, booking["id"])).status_code == 200
    visit = await _visit_for(db_session, booking["id"])
    assert _term_of(visit) == academic.current_term(today_local() - timedelta(days=1))
    assert _term_of(visit) != expected_start.parse("110-1")


@pytest.mark.asyncio
async def test_later_booking_edits_do_not_move_the_admissions_term(admin_client, public_client, db_session):
    """規格 X4：到場之後預約資料再改，不同步招生的入學學期，也不寫招生歷程。"""
    booking = await started_booking(
        admin_client, public_client, db_session, expected_start=_month_choice(3), parent_name="陳媽媽"
    )
    assert (await complete(admin_client, booking["id"])).status_code == 200
    before = await _visit_for(db_session, booking["id"])
    term = _term_of(before)

    async def history() -> list[RecruitmentEventLog]:
        result = await db_session.execute(
            select(RecruitmentEventLog)
            .where(RecruitmentEventLog.recruitment_visit_id == before.id, RecruitmentEventLog.event_type == "details_updated")
            .execution_options(populate_existing=True)
        )
        return list(result.scalars())

    response = await _staff_patch(admin_client, booking["id"], expected_start="unsure")
    assert response.status_code == 200, response.text
    assert response.json()["changed_fields"] == ["expected_start"]
    after = await _visit_for(db_session, booking["id"])
    assert _term_of(after) == term
    assert after.version == before.version
    assert await history() == []

    # 正向對照：改家長稱呼會同步到招生，也寫 details_updated；所以上面沒有事件是因為入學學期不同步，不是同步壞了。
    renamed = await _staff_patch(admin_client, booking["id"], parent_name="林媽媽")
    assert renamed.status_code == 200, renamed.text
    synced = await _visit_for(db_session, booking["id"])
    assert synced.contact_name == "林媽媽"
    assert _term_of(synced) == term
    [event] = await history()
    assert event.metadata_json["fields"] == ["contact_name"]
