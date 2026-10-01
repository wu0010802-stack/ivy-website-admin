"""保留座位、名額規劃與計畫名額（規格 6.5、8；R08、R09；Review Focus 4）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from app.admissions.models import GradeIntakeTarget, RecruitmentVisit
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    create_record,
    record_at_stage,
    reception_yihua_client,
    transition,
)

RECORDS = f"{ADMISSIONS}/records"
PLAN = f"{ADMISSIONS}/intake-plan?campus_key=yihua&school_year=115&semester=1"


async def _seat(client, record: dict, grade: str | None, **fields):
    body = {"grade": grade, "target_school_year": 115, "target_semester": 1, "expected_version": record["version"]}
    return await client.post(f"{RECORDS}/{record['id']}/seat", json={**body, **fields})


async def _targets(client, targets: dict, *, school_year: int = 115, semester: int = 1, campus_key: str = "yihua"):
    return await client.put(
        f"{ADMISSIONS}/intake-targets?campus_key={campus_key}",
        json={"school_year": school_year, "semester": semester, "targets": targets},
    )


async def _plan(client, url: str = PLAN) -> dict:
    response = await client.get(url)
    assert response.status_code == 200, response.text
    return response.json()


def _rows(plan: dict) -> dict[str, tuple]:
    """年級 → (計畫名額, 已保留, 已註冊, 剩餘, 超額)。"""
    return {
        row["grade"]: (row["target_seats"], row["reserved"], row["enrolled"], row["remaining"], row["over_capacity"])
        for row in plan["rows"]
    }


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


@pytest.mark.asyncio
async def test_seat_requires_deposit_year_and_not_enrolled(admin_client):
    """R08：未預繳、未給學年拒絕；已註冊的不能改也不能清除保留（規格 6.5）。"""
    visited = await create_record(admin_client)
    response = await _seat(admin_client, visited, "小班")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "SEAT_NOT_ALLOWED"
    assert response.json()["detail"]["message"] == "未預繳的訪視不可保留座位"

    deposited = await record_at_stage(admin_client, "deposited", child_name="已預繳")
    no_year = await _seat(admin_client, deposited, "小班", target_school_year=None)
    assert no_year.status_code == 422
    assert no_year.json()["detail"]["message"] == "保留座位需指定目標學年"
    stale = await _seat(admin_client, deposited, "小班", expected_version=deposited["version"] + 5)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"

    withdrawn = await record_at_stage(admin_client, "withdrawn", child_name="已退出")
    assert (await _seat(admin_client, withdrawn, "小班")).status_code == 422

    enrolled = await record_at_stage(admin_client, "enrolled", child_name="已註冊")
    change = await _seat(admin_client, enrolled, "中班")
    assert change.status_code == 422 and "請先取消註冊" in change.json()["detail"]["message"]
    release = await _seat(admin_client, enrolled, None)
    assert release.status_code == 422
    assert release.json()["detail"]["message"] == "已註冊的訪視不可清除保留，要改年級或學期請先取消註冊"
    assert (await admin_client.get(f"{RECORDS}/{enrolled['id']}")).json()["provisional_grade"] == "小班"


@pytest.mark.asyncio
async def test_reserve_and_release_keep_term_and_write_events(admin_client):
    deposited = await record_at_stage(admin_client, "deposited")
    reserved = await _seat(admin_client, deposited, "小班", target_school_year=116, target_semester=None)
    assert reserved.status_code == 200, reserved.text
    body = reserved.json()
    assert body["visit"]["provisional_grade"] == "小班"
    assert (body["visit"]["target_school_year"], body["visit"]["target_semester"]) == (116, 1)  # 學期預設上學期
    assert (body["capacity_warning"], body["warning_code"]) == (False, None)
    assert body["visit"]["version"] == deposited["version"] + 1

    released = await _seat(admin_client, body["visit"], None, target_school_year=None, target_semester=None)
    assert released.status_code == 200, released.text
    visit = released.json()["visit"]
    # 釋放只清年級，入學學年學期保留（否則卡片會從看板消失；同園務）。
    assert (visit["provisional_grade"], visit["target_school_year"], visit["target_semester"]) == (None, 116, 1)
    again = await _seat(admin_client, visit, None)
    assert again.status_code == 422 and again.json()["detail"]["message"] == "這筆訪視目前沒有保留座位"

    events = [
        (e["event_type"], e["from_stage"], e["to_stage"], e["metadata_json"])
        for e in (await admin_client.get(f"{RECORDS}/{deposited['id']}/events")).json()
        if e["event_type"].startswith("seat_")
    ]
    assert events == [
        ("seat_reserved", "deposited", "deposited", {"grade": "小班", "school_year": 116, "semester": 1}),
        ("seat_released", "deposited", "deposited", {"grade": "小班", "school_year": 116, "semester": 1}),
    ]


@pytest.mark.asyncio
async def test_over_capacity_only_warns(admin_client, db_session):
    """R08：超過計畫名額只警示（SEAT_CAPACITY_WARNING 放在回應），照樣保留。"""
    assert (await _targets(admin_client, {"小班": 1})).status_code == 200
    first = await record_at_stage(admin_client, "deposited", child_name="一")
    second = await record_at_stage(admin_client, "deposited", child_name="二")
    assert (await _seat(admin_client, first, "小班")).json()["capacity_warning"] is False
    over = await _seat(admin_client, second, "小班")
    assert over.status_code == 200, over.text
    assert (over.json()["capacity_warning"], over.json()["warning_code"]) == (True, "SEAT_CAPACITY_WARNING")
    assert over.json()["visit"]["provisional_grade"] == "小班"
    assert await _audit(db_session, "recruitment_visit.seat") == [
        {"grade_set": True, "capacity_warning": False},
        {"grade_set": True, "capacity_warning": True},
    ]


@pytest.mark.asyncio
async def test_intake_plan_counts_match_spec(admin_client, db_session):
    """R09：已保留、已註冊、退出、轉學期、他學期、他校、未設定計畫（規格 8）。"""
    assert (await _targets(admin_client, {"小班": 2, "中班": 0})).status_code == 200
    # 已保留小班兩筆：其中一筆勾了轉其他學期，同園務 compute_intake_plan 仍依目標學期計算。
    for name, transfer in (("保留一", False), ("保留二", True)):
        record = await record_at_stage(admin_client, "deposited", child_name=name)
        seated = (await _seat(admin_client, record, "小班")).json()["visit"]
        if transfer:
            response = await admin_client.patch(
                f"{RECORDS}/{record['id']}", json={"expected_version": seated["version"], "transfer_term": True}
            )
            assert response.status_code == 200, response.text
    # 已註冊：小班（record_at_stage 的註冊）、中班。
    await record_at_stage(admin_client, "enrolled", child_name="註冊小班")
    middle = await record_at_stage(admin_client, "deposited", child_name="註冊中班")
    await transition(admin_client, middle, "enrolled", grade="中班", target_school_year=115, target_semester=1)
    # 舊資料：已註冊但沒有 provisional_grade，年級取 grade（COALESCE）。
    legacy = await record_at_stage(admin_client, "enrolled", child_name="舊資料大班")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(legacy["id"]))
        .values(provisional_grade=None, grade="大班")
    )
    await db_session.commit()
    # 不該算進來的：保留後退預繳、下學期的保留、他校的保留、沒保留的已預繳與已訪視。
    gone = await record_at_stage(admin_client, "deposited", child_name="退預繳")
    gone = (await _seat(admin_client, gone, "小班")).json()["visit"]
    await transition(admin_client, gone, "withdrawn", reason="改送他校")
    spring = await record_at_stage(admin_client, "deposited", child_name="下學期")
    await _seat(admin_client, spring, "小班", target_semester=2)
    minghua = await record_at_stage(admin_client, "deposited", campus_key="minghua", child_name="明華")
    await _seat(admin_client, minghua, "小班")
    await record_at_stage(admin_client, "deposited", child_name="沒保留")
    await create_record(admin_client, child_name="只參觀")

    plan = await _plan(admin_client)
    assert [row["grade"] for row in plan["rows"]] == ["幼幼班", "小班", "中班", "大班"]
    assert _rows(plan) == {
        "幼幼班": (None, 0, 0, None, False),  # 未設定，與 0 分開
        "小班": (2, 2, 1, -1, True),
        "中班": (0, 0, 1, -1, True),
        "大班": (None, 0, 1, None, False),
    }
    assert plan["totals"] == {"target_seats": 2, "reserved": 2, "enrolled": 3, "remaining": -2}
    assert (plan["school_year"], plan["semester"]) == (115, 1)
    spring_plan = await _plan(admin_client, f"{ADMISSIONS}/intake-plan?campus_key=yihua&school_year=115&semester=2")
    assert _rows(spring_plan)["小班"] == (None, 1, 0, None, False)
    assert spring_plan["totals"] == {"target_seats": None, "reserved": 1, "enrolled": 0, "remaining": None}

@pytest.mark.asyncio
async def test_save_targets_upserts_and_null_deletes(admin_client, db_session):
    saved = await _targets(admin_client, {"小班": 10, "中班": 0})
    assert saved.status_code == 200, saved.text
    assert _rows(saved.json())["小班"][0] == 10 and _rows(saved.json())["中班"][0] == 0
    again = await _targets(admin_client, {"小班": 12, "中班": 0, "大班": None})
    assert _rows(again.json())["小班"][0] == 12
    cleared = await _targets(admin_client, {"中班": None})
    assert _rows(cleared.json())["中班"][0] is None  # 回到「未設定」
    assert await db_session.scalar(select(func.count()).select_from(GradeIntakeTarget)) == 1
    # 沒有任何變動不寫稽核；下學期是另一組計畫。
    await _targets(admin_client, {"小班": 12})
    await _targets(admin_client, {"小班": 5}, semester=2)
    assert _rows(await _plan(admin_client))["小班"][0] == 12
    assert await _audit(db_session, "grade_intake_target.update") == [
        {"school_year": 115, "semester": 1, "grades": ["小班", "中班"]},
        {"school_year": 115, "semester": 1, "grades": ["小班"]},
        {"school_year": 115, "semester": 1, "grades": ["中班"]},
        {"school_year": 115, "semester": 2, "grades": ["小班"]},
    ]
    for bad in ({"小一": 3}, {"小班": -1}, {"小班": 1000}):
        assert (await _targets(admin_client, bad)).status_code == 422, bad
    extra = await admin_client.put(
        f"{ADMISSIONS}/intake-targets?campus_key=yihua",
        json={"school_year": 115, "semester": 1, "targets": {}, "campus_key": "minghua"},
    )
    assert extra.status_code == 422


@pytest.mark.asyncio
async def test_cancel_withdraw_restores_reserved_seat(admin_client):
    """Review Focus 4：退註冊 → 取消退出回已預繳，預繳恢復、註冊日期已清、保留座位
    還在並算進「已保留」；退預繳 → 取消退出回已訪視，不算進任何名額。"""
    record = await record_at_stage(admin_client, "deposited", child_name="退註冊")
    seated = (await _seat(admin_client, record, "小班")).json()["visit"]
    enrolled = await transition(admin_client, seated, "enrolled")
    assert _rows(await _plan(admin_client))["小班"][1:3] == (0, 1)
    withdrawn = await transition(admin_client, enrolled, "withdrawn", reason="搬家")
    assert _rows(await _plan(admin_client))["小班"][1:3] == (0, 0)
    back = await transition(admin_client, withdrawn, "deposited")
    assert (back["stage"], back["has_deposit"], back["enrolled_on"], back["provisional_grade"]) == ("deposited", True, None, "小班")
    assert _rows(await _plan(admin_client))["小班"][1:3] == (1, 0)

    other = await record_at_stage(admin_client, "deposited", child_name="退預繳")
    other = (await _seat(admin_client, other, "中班")).json()["visit"]
    other = await transition(admin_client, other, "withdrawn", reason="改送他校")
    visited = await transition(admin_client, other, "visited")
    assert (visited["stage"], visited["has_deposit"]) == ("visited", False)
    rows = _rows(await _plan(admin_client))
    assert rows["中班"][1:3] == (0, 0)
    assert rows["小班"][1:3] == (1, 0)


@pytest.mark.asyncio
async def test_intake_permissions_and_scope(admin_client, reception_yihua_client, editor_client, minghua_client):
    record = await record_at_stage(admin_client, "deposited")
    assert (await _seat(reception_yihua_client, record, "小班")).status_code == 200
    assert (await _targets(reception_yihua_client, {"小班": 3})).status_code == 200
    assert (await reception_yihua_client.get(PLAN)).status_code == 200
    assert (await editor_client.get(PLAN)).status_code == 403
    assert (await _targets(editor_client, {"小班": 3})).status_code == 403
    assert (await minghua_client.get(PLAN)).status_code == 404
    assert (await _targets(minghua_client, {"小班": 3})).status_code == 404
    current = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (await _seat(minghua_client, current, None)).status_code == 404
    assert (await admin_client.get(f"{ADMISSIONS}/intake-plan?campus_key=nowhere&school_year=115")).status_code == 404


@pytest.mark.asyncio
async def test_intake_plan_reports_applied_filters_and_as_of(admin_client):
    """F4：名額規劃（查詢與存計畫名額後的回應）帶實際套用的校區、學年學期與資料時間（UTC）。"""
    before = datetime.now(timezone.utc)
    plan = await _plan(admin_client, f"{ADMISSIONS}/intake-plan?campus_key=renwu&school_year=116&semester=2")
    saved = await _targets(admin_client, {"小班": 3}, school_year=116, semester=2, campus_key="renwu")
    after = datetime.now(timezone.utc)
    assert saved.status_code == 200, saved.text
    for body in (plan, saved.json()):
        assert (body["campus_key"], body["school_year"], body["semester"]) == ("renwu", 116, 2)
        as_of = datetime.fromisoformat(body["as_of"])
        assert as_of.utcoffset() == timedelta(0) and before <= as_of <= after
