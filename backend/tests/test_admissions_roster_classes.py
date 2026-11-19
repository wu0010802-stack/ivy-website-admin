"""編班表的班級 API（2026-11-15 計畫 Task 3）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.admissions.roster.models import RosterStudent
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings, minghua_client  # noqa: F401
from tests.roster_helpers import ROSTER, make_class


async def test_create_class_appends_in_grade(reception_yihua_client):
    first = await make_class(reception_yihua_client)
    second = await make_class(reception_yihua_client)
    other = await make_class(reception_yihua_client, grade="中班")
    assert second["sort_order"] == first["sort_order"] + 1
    assert other["sort_order"] == 0
    assert first["version"] == 1 and first["target_seats"] is None


async def test_duplicate_class_code_conflict(reception_yihua_client):
    first = await make_class(reception_yihua_client, class_code="大A")
    response = await reception_yihua_client.post(
        f"{ROSTER}/classes?campus_key=yihua",
        json={"school_year": 115, "grade": "中班", "name": "另一班", "class_code": first["class_code"]},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROSTER_CLASS_CODE_TAKEN"
    # 不同學年可以用同一個班序。
    await make_class(reception_yihua_client, class_code="大A", school_year=116)


async def test_update_class_fields_and_version(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    response = await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}",
        json={"head_teacher": "測試老師", "target_seats": 22, "expected_version": 1},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert (updated["head_teacher"], updated["target_seats"], updated["version"]) == ("測試老師", 22, 2)
    stale = await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"head_teacher": "別人", "expected_version": 1}
    )
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["code"] == "ROSTER_VERSION_CONFLICT" and detail["current_version"] == 2


async def test_grade_cannot_change(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    response = await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"grade": "中班", "expected_version": 1}
    )
    assert response.status_code == 422


async def test_target_seats_null_vs_zero(reception_yihua_client):
    room = await make_class(reception_yihua_client, target_seats=0)
    assert room["target_seats"] == 0
    cleared = await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"target_seats": None, "expected_version": 1}
    )
    assert cleared.json()["target_seats"] is None
    untouched = await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"head_teacher": "測試老師", "expected_version": 2}
    )
    assert untouched.json()["target_seats"] is None
    zero = await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"target_seats": 0, "expected_version": 3}
    )
    assert zero.json()["target_seats"] == 0


async def test_delete_empty_class(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    response = await reception_yihua_client.delete(f"{ROSTER}/classes/{room['id']}?expected_version=1")
    assert response.status_code == 204
    again = await reception_yihua_client.delete(f"{ROSTER}/classes/{room['id']}?expected_version=1")
    assert again.status_code == 404


async def test_delete_class_with_students_conflict(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client)
    now = datetime.now(timezone.utc)
    db_session.add(
        RosterStudent(
            id=uuid.uuid4(), campus_key="yihua", school_year=115, class_id=uuid.UUID(room["id"]), position=0,
            child_name="測試甲", status="enrolled", created_at=now, updated_at=now,
        )
    )
    await db_session.commit()
    response = await reception_yihua_client.delete(f"{ROSTER}/classes/{room['id']}?expected_version=1")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROSTER_CLASS_NOT_EMPTY"


async def test_delete_class_stale_version(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    response = await reception_yihua_client.delete(f"{ROSTER}/classes/{room['id']}?expected_version=9")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROSTER_VERSION_CONFLICT"


async def test_other_campus_is_404(reception_yihua_client, minghua_client):  # noqa: F811
    room = await make_class(reception_yihua_client)
    patched = await minghua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"head_teacher": "測試老師", "expected_version": 1}
    )
    assert patched.status_code == 404
    deleted = await minghua_client.delete(f"{ROSTER}/classes/{room['id']}?expected_version=1")
    assert deleted.status_code == 404
    created = await minghua_client.post(
        f"{ROSTER}/classes?campus_key=yihua",
        json={"school_year": 115, "grade": "大班", "name": "大9班", "class_code": "大9"},
    )
    assert created.status_code == 404
    unknown_campus = await minghua_client.post(
        f"{ROSTER}/classes?campus_key=nowhere",
        json={"school_year": 115, "grade": "大班", "name": "大9班", "class_code": "大9"},
    )
    assert unknown_campus.status_code == 404


async def test_readonly_cannot_write(readonly_yihua_client):
    response = await readonly_yihua_client.post(
        f"{ROSTER}/classes?campus_key=yihua",
        json={"school_year": 115, "grade": "大班", "name": "大9班", "class_code": "大9"},
    )
    assert response.status_code == 403


async def test_routes_absent_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        response = await client.post(
            f"{ROSTER}/classes?campus_key=yihua",
            json={"school_year": 115, "grade": "大班", "name": "大9班", "class_code": "大9"},
        )
        assert response.status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_audit_has_no_teacher_names(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client, head_teacher="測試導師")
    await reception_yihua_client.patch(
        f"{ROSTER}/classes/{room['id']}", json={"assistant_teacher": "測試副導", "expected_version": 1}
    )
    entries = (
        await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action.like("roster_class.%")))
    ).all()
    assert {e.action for e in entries} == {"roster_class.create", "roster_class.update"}
    dump = " ".join(str(e.metadata_json) for e in entries)
    assert "測試導師" not in dump and "測試副導" not in dump
    update = next(e for e in entries if e.action == "roster_class.update")
    assert update.metadata_json["fields"] == ["assistant_teacher"]
