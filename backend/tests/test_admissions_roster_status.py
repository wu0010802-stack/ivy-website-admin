"""已入園、離園、退預繳、恢復（2026-11-15 計畫 Task 5）。姓名一律虛構。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.admissions.roster.models import RosterStudent
from app.common.timezones import today_local
from tests.admissions_helpers import create_record, reception_yihua_client  # noqa: F401
from tests.roster_helpers import add_pending, add_students, act, make_class, move_student, patch_student
from tests.test_admissions_roster_students import names_in


async def test_enter_sets_today_and_keeps_deposit_date(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班")
    kid = await add_pending(reception_yihua_client, "測試甲", class_id=room["id"], grade="小班")
    response = await act(reception_yihua_client, kid, "enter")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "enrolled" and body["enrollment_date"] == today_local().isoformat()
    assert body["deposit_date"] == "2026-09-01" and body["position"] == 0 and body["class_id"] == room["id"]
    assert body["version"] == kid["version"] + 1


async def test_enter_with_explicit_date(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班")
    kid = await add_pending(reception_yihua_client, "測試甲", class_id=room["id"], grade="小班")
    response = await act(reception_yihua_client, kid, "enter", enrollment_date="2026-10-05")
    assert response.json()["enrollment_date"] == "2026-10-05"


async def test_enter_requires_class(reception_yihua_client):
    kid = await add_pending(reception_yihua_client, "測試甲")
    response = await act(reception_yihua_client, kid, "enter")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROSTER_NEEDS_CLASS"


async def test_enter_rejects_future_date(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班")
    kid = await add_pending(reception_yihua_client, "測試甲", class_id=room["id"], grade="小班")
    tomorrow = (today_local() + timedelta(days=1)).isoformat()
    assert (await act(reception_yihua_client, kid, "enter", enrollment_date=tomorrow)).status_code == 422


async def test_leave_clears_class_and_closes_gap(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client)
    a, b, c = await add_students(reception_yihua_client, room["id"], ["甲", "乙", "丙"])
    response = await act(reception_yihua_client, b, "leave")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "left" and body["class_id"] is None and body["position"] is None
    assert body["grade"] == "大班" and body["left_date"] == today_local().isoformat()
    assert await names_in(db_session, room["id"]) == [("甲", 0), ("丙", 1)]


async def test_refund_then_restore_goes_unassigned(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client, grade="小班")
    kid = await add_pending(reception_yihua_client, "測試甲", class_id=room["id"], grade="小班")
    refunded = (await act(reception_yihua_client, kid, "refund")).json()
    assert refunded["status"] == "refunded" and refunded["class_id"] is None and refunded["grade"] == "小班"
    assert refunded["refunded_date"] == today_local().isoformat()
    assert await names_in(db_session, room["id"]) == []
    restored = (await act(reception_yihua_client, refunded, "restore", class_id=room["id"])).json()
    assert restored["status"] == "pending" and restored["class_id"] is None and restored["refunded_date"] is None
    assert restored["deposit_date"] == "2026-09-01"


async def test_restore_left_needs_class(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client)
    a, b = await add_students(reception_yihua_client, room["id"], ["甲", "乙"])
    left = (await act(reception_yihua_client, a, "leave")).json()
    missing = await act(reception_yihua_client, left, "restore")
    assert missing.status_code == 422
    other = await make_class(reception_yihua_client, school_year=116)
    assert (await act(reception_yihua_client, left, "restore", class_id=other["id"])).status_code == 422
    restored = await act(reception_yihua_client, left, "restore", class_id=room["id"])
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["status"] == "enrolled" and body["left_date"] is None and body["position"] == 1
    assert await names_in(db_session, room["id"]) == [("乙", 0), ("甲", 1)]


async def test_invalid_transitions(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    enrolled, leaver = await add_students(reception_yihua_client, room["id"], ["測試甲", "測試丁"])
    pending = await add_pending(reception_yihua_client, "測試乙")
    left = (await act(reception_yihua_client, leaver, "leave")).json()
    enrolled = (await patch_student(reception_yihua_client, enrolled, note="新版本")).json()  # 位置補位不改版本，這裡取最新
    for student, action in ((enrolled, "refund"), (pending, "leave"), (left, "enter"), (pending, "restore"), (enrolled, "restore")):
        response = await act(reception_yihua_client, student, action)
        assert response.status_code == 409, (action, response.text)
        assert response.json()["detail"]["code"] == "ROSTER_STATUS_INVALID", (action, response.text)


async def test_left_student_cannot_move(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    left = (await act(reception_yihua_client, kid, "leave")).json()
    response = await move_student(reception_yihua_client, left, room["id"], 0)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROSTER_STATUS_INVALID"


async def test_stale_version_on_action(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    await patch_student(reception_yihua_client, kid, note="備註")
    response = await act(reception_yihua_client, kid, "leave")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROSTER_VERSION_CONFLICT"


async def test_refunded_visit_can_get_new_student(reception_yihua_client, db_session):
    record = await create_record(reception_yihua_client)
    visit_id = uuid.UUID(record["id"])
    now = datetime.now(timezone.utc)

    def student(**overrides) -> RosterStudent:
        values = dict(
            id=uuid.uuid4(), campus_key="yihua", school_year=115, child_name="測試甲", status="pending",
            grade="小班", deposit_date=today_local(), target_school_year=115, target_semester=1,
            recruitment_visit_id=visit_id, from_funnel=True, created_at=now, updated_at=now,
        )
        values.update(overrides)
        return RosterStudent(**values)

    old = student()
    db_session.add(old)
    await db_session.commit()
    body = (await act(reception_yihua_client, {"id": str(old.id), "version": 1}, "refund")).json()
    assert body["status"] == "refunded"
    db_session.add(student())  # 舊的退預繳後，同一筆看板紀錄可以再有一位預繳未入園
    await db_session.commit()
    rows = (
        await db_session.scalars(select(RosterStudent.status).where(RosterStudent.recruitment_visit_id == visit_id))
    ).all()
    assert sorted(rows) == ["pending", "refunded"]
