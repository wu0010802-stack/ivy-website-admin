"""看板轉預繳 → 編班表（單向、自動）與看板後續異動的提醒（2026-11-15 計畫 Task 7）。姓名一律虛構。"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select, update

from app.admissions.academic import current_term
from app.admissions.models import RecruitmentVisit
from app.admissions.roster.models import RosterStudent
from app.common.timezones import today_local
from tests.admissions_helpers import ADMISSIONS, create_record, reception_yihua_client, transition  # noqa: F401
from tests.roster_helpers import ROSTER, act, add_pending, make_class, move_student

WITHDRAW = dict(reason="家長改送他校", withdraw_reason_category="改讀其他私立幼兒園")


async def roster(client, school_year: int = 115) -> dict:
    response = await client.get(ROSTER, params={"campus_key": "yihua", "school_year": school_year})
    assert response.status_code == 200, response.text
    return response.json()


async def all_students(db_session) -> list:
    rows = await db_session.execute(
        select(RosterStudent.child_name, RosterStudent.status, RosterStudent.from_funnel, RosterStudent.recruitment_visit_id)
        .order_by(RosterStudent.created_at)
    )
    return list(rows)


async def test_deposit_creates_unassigned_pending(reception_yihua_client):
    record = await create_record(reception_yihua_client, child_name="測試甲", birthday="2023-03-02")
    deposited = await transition(reception_yihua_client, record, "deposited")
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    assert (kid["child_name"], kid["birthday"], kid["status"], kid["class_id"]) == ("測試甲", "2023-03-02", "pending", None)
    assert kid["grade"] == (deposited["provisional_grade"] or deposited["grade"])
    assert kid["deposit_date"] == today_local().isoformat() and kid["from_funnel"] is True
    assert (kid["school_year"], kid["target_school_year"], kid["target_semester"]) == (115, 115, 1)
    assert kid["board_notice"] is None


async def test_missing_grade_and_term_still_created(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .values(grade=None, provisional_grade=None, target_school_year=None, target_semester=None)
    )
    await db_session.commit()
    await transition(reception_yihua_client, record, "deposited")
    year = current_term(today_local())[0]
    body = await roster(reception_yihua_client, year)
    [kid] = body["unassigned"]
    assert kid["grade"] is None and kid["school_year"] == year
    assert body["incomplete"] == 1 and body["current"]["rows"]["estimate"]["total"] == 0


async def test_back_and_forth_does_not_duplicate(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    record = await transition(reception_yihua_client, record, "deposited")
    for _ in range(2):
        record = await transition(reception_yihua_client, record, "visited")
        [kid] = (await roster(reception_yihua_client))["unassigned"]
        assert kid["board_notice"] == "deposit_removed"
        record = await transition(reception_yihua_client, record, "deposited")
        [kid] = (await roster(reception_yihua_client))["unassigned"]
        assert kid["board_notice"] is None
    assert len(await all_students(db_session)) == 1


async def test_withdraw_then_cancel(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    record = await transition(reception_yihua_client, record, "deposited")
    record = await transition(reception_yihua_client, record, "withdrawn", **WITHDRAW)
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    assert kid["board_notice"] == "deposit_removed"
    await act(reception_yihua_client, kid, "refund")
    await transition(reception_yihua_client, record, "deposited")  # 取消退出
    body = await roster(reception_yihua_client)
    assert len(body["unassigned"]) == 1 and body["unassigned"][0]["id"] != kid["id"]
    assert [g["status"] for g in body["gone"]] == ["refunded"]


async def test_cancel_exit_without_roster_refund_keeps_single_student(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    record = await transition(reception_yihua_client, record, "deposited")
    record = await transition(reception_yihua_client, record, "withdrawn", **WITHDRAW)
    await transition(reception_yihua_client, record, "deposited")
    assert len(await all_students(db_session)) == 1


async def test_enrolled_to_deposited_does_not_trigger(admin_client, reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    record = await transition(reception_yihua_client, record, "deposited")
    await act(reception_yihua_client, (await roster(reception_yihua_client))["unassigned"][0], "refund")
    record = await transition(
        admin_client, record, "enrolled", grade="小班", target_school_year=115, target_semester=1,
        enrolled_on="2026-09-30",
    )
    await transition(admin_client, record, "deposited", reason="誤標註冊")  # 取消註冊（需要 admissions.convert 與原因）
    assert len(await all_students(db_session)) == 1


async def test_claims_backfilled_student(reception_yihua_client, db_session):
    backfilled = await add_pending(reception_yihua_client, "測試甲", grade="小班")
    assert backfilled["birthday"] is None and backfilled["from_funnel"] is False
    record = await create_record(reception_yihua_client, child_name="測試甲", birthday="2023-03-02")
    await transition(reception_yihua_client, record, "deposited")
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    assert kid["id"] == backfilled["id"] and kid["from_funnel"] is True and kid["birthday"] == "2023-03-02"
    [(_, _, _, visit_id)] = await all_students(db_session)
    assert str(visit_id) == record["id"]


async def test_claim_skipped_when_ambiguous(reception_yihua_client, db_session):
    await add_pending(reception_yihua_client, "測試甲", grade="小班")
    await add_pending(reception_yihua_client, "測試甲", grade="小班")
    record = await create_record(reception_yihua_client, child_name="測試甲", birthday="2023-03-02")
    await transition(reception_yihua_client, record, "deposited")
    assert len(await all_students(db_session)) == 3


async def test_claim_skipped_when_birthdays_differ(reception_yihua_client, db_session):
    await add_pending(reception_yihua_client, "測試甲", grade="小班", birthday="2022-01-01")
    record = await create_record(reception_yihua_client, child_name="測試甲", birthday="2023-03-02")
    await transition(reception_yihua_client, record, "deposited")
    students = await all_students(db_session)
    assert len(students) == 2 and sorted(s[2] for s in students) == [False, True]


async def test_board_enrolled_notice(admin_client, reception_yihua_client):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    record = await transition(reception_yihua_client, record, "deposited")
    await transition(
        admin_client, record, "enrolled", grade="小班", target_school_year=115, target_semester=1,
        enrolled_on="2026-09-30",
    )
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    assert kid["board_notice"] == "enrolled" and kid["status"] == "pending"


async def test_deleted_visit_notice(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    await transition(reception_yihua_client, record, "deposited")
    await db_session.execute(delete(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])))
    await db_session.commit()
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    assert kid["board_notice"] == "deposit_removed" and kid["from_funnel"] is True
    [(_, _, _, visit_id)] = await all_students(db_session)
    assert visit_id is None


async def test_manual_students_never_get_notice(reception_yihua_client):
    await add_pending(reception_yihua_client, "測試甲")
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    assert kid["board_notice"] is None


async def test_roster_actions_do_not_touch_visit(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client, child_name="測試甲")
    await transition(reception_yihua_client, record, "deposited")
    room = await make_class(reception_yihua_client, grade="小班")
    [kid] = (await roster(reception_yihua_client))["unassigned"]
    kid = (await move_student(reception_yihua_client, kid, room["id"], 0)).json()
    kid = (await act(reception_yihua_client, kid, "enter")).json()
    await act(reception_yihua_client, kid, "leave")
    visit = await db_session.execute(
        select(RecruitmentVisit.version, RecruitmentVisit.has_deposit, RecruitmentVisit.enrolled).where(
            RecruitmentVisit.id == uuid.UUID(record["id"])
        )
    )
    [(version, has_deposit, enrolled)] = visit
    assert (has_deposit, enrolled) == (True, False)
    assert version == (await reception_yihua_client.get(f"{ADMISSIONS}/records/{record['id']}")).json()["version"]
