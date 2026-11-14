"""編班表幼生的新增、編輯與移動（2026-11-15 計畫 Task 4）。姓名一律虛構。"""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import select

from app.admissions.roster.models import RosterStudent
from tests.admissions_helpers import campus_admin_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import minghua_client  # noqa: F401
from tests.roster_helpers import ROSTER, add_pending, add_students, make_class, move_student, patch_student


async def names_in(db_session, class_id: str) -> list[tuple[str, int]]:
    """班內（名字, position），依 position；直接查欄位，不經 identity map。"""
    rows = await db_session.execute(
        select(RosterStudent.child_name, RosterStudent.position)
        .where(RosterStudent.class_id == uuid.UUID(class_id))
        .order_by(RosterStudent.position)
    )
    return [(name, position) for name, position in rows]


async def test_bulk_add_enrolled_appends_in_order(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client)
    students = await add_students(reception_yihua_client, room["id"], ["測試甲", "測試乙", "測試丙"])
    assert [s["position"] for s in students] == [0, 1, 2]
    assert {s["status"] for s in students} == {"enrolled"}
    assert all(s["enrollment_date"] is None and s["grade"] == "大班" for s in students)
    more = await add_students(reception_yihua_client, room["id"], ["測試丁"])
    assert more[0]["position"] == 3


async def test_dirty_paste(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client)
    response = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={"school_year": 115, "class_id": room["id"], "names": ["  測試甲 ", "", "測試甲", "測試乙\t"]},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert [s["child_name"] for s in body["students"]] == ["測試甲", "測試甲", "測試乙"]
    assert body["duplicates"] == ["測試甲"]


async def test_duplicate_of_existing_student_is_reported(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    await add_students(reception_yihua_client, room["id"], ["測試甲"])
    response = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={"school_year": 115, "class_id": room["id"], "names": ["測試甲", "測試乙"]},
    )
    assert response.json()["duplicates"] == ["測試甲"]


async def test_name_too_long_rejects_whole_batch(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client)
    response = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={"school_year": 115, "class_id": room["id"], "names": ["測試甲", "字" * 51, "測試乙"]},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "ROSTER_NAME_TOO_LONG" and detail["line"] == 2
    assert await names_in(db_session, room["id"]) == []


async def test_empty_names_and_missing_target_rejected(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    blank = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua", json={"school_year": 115, "class_id": room["id"], "names": [" ", ""]}
    )
    assert blank.status_code == 422
    neither = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua", json={"school_year": 115, "names": ["測試甲"]}
    )
    assert neither.status_code == 422
    too_many = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={"school_year": 115, "class_id": room["id"], "names": [f"測試{i}" for i in range(61)]},
    )
    assert too_many.status_code == 422


async def test_add_pending_unassigned_and_assigned(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班")
    loose = await add_pending(reception_yihua_client, "測試甲", grade="中班")
    assert loose["class_id"] is None and loose["grade"] == "中班" and loose["status"] == "pending"
    assert loose["deposit_date"] == "2026-09-01" and loose["school_year"] == 115
    placed = await add_pending(reception_yihua_client, "測試乙", class_id=room["id"], grade="小班")
    assert placed["class_id"] == room["id"] and placed["position"] == 0 and placed["grade"] == "小班"


async def test_pending_school_year_follows_target(reception_yihua_client):
    next_year = await add_pending(
        reception_yihua_client, "測試甲", target_school_year=116, target_semester=1, grade="小班"
    )
    assert next_year["school_year"] == 116
    bad_semester = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={
            "school_year": 115,
            "names": ["測試乙"],
            "pending": {"grade": "小班", "target_school_year": 116, "target_semester": 2, "deposit_date": "2026-09-01"},
        },
    )
    assert bad_semester.status_code == 422
    too_far = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={
            "school_year": 115,
            "names": ["測試乙"],
            "pending": {"grade": "小班", "target_school_year": 117, "target_semester": 1, "deposit_date": "2026-09-01"},
        },
    )
    assert too_far.status_code == 422


async def test_pending_class_year_must_match_target(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班", school_year=115)
    response = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={
            "school_year": 115,
            "names": ["測試甲"],
            "class_id": room["id"],
            "pending": {"grade": "小班", "target_school_year": 116, "target_semester": 1, "deposit_date": "2026-09-01"},
        },
    )
    assert response.status_code == 422


async def test_birthday_only_with_single_name(reception_yihua_client):
    response = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={
            "school_year": 115,
            "names": ["測試甲", "測試乙"],
            "pending": {
                "grade": "小班", "target_school_year": 115, "target_semester": 1,
                "deposit_date": "2026-09-01", "birthday": "2023-05-01",
            },
        },
    )
    assert response.status_code == 422
    single = await add_pending(reception_yihua_client, "測試甲", birthday="2023-05-01")
    assert single["birthday"] == "2023-05-01"


async def test_planned_entry_date_sets_term(reception_yihua_client):
    student = await add_pending(reception_yihua_client)
    response = await patch_student(reception_yihua_client, student, planned_entry_date="2027-02-01")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["target_school_year"], body["target_semester"], body["school_year"]) == (115, 2, 115)
    assert body["version"] == 2


async def test_birthday_clears_manual_underage(reception_yihua_client):
    student = await add_pending(reception_yihua_client)
    marked = (await patch_student(reception_yihua_client, student, underage_manual=True)).json()
    assert marked["underage_manual"] is True and marked["is_underage"] is True
    filled = (await patch_student(reception_yihua_client, marked, birthday="2023-05-01")).json()
    assert filled["underage_manual"] is False and filled["is_underage"] is False


async def test_derived_flags(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="幼幼班")
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    assert kid["is_new"] is False and kid["is_underage"] is False
    updated = (await patch_student(reception_yihua_client, kid, birthday="2024-10-01")).json()
    assert updated["is_underage"] is True
    new_kid = await add_pending(reception_yihua_client, "測試乙")
    assert new_kid["is_new"] is True
    big = await make_class(reception_yihua_client, grade="大班")
    [elder] = await add_students(reception_yihua_client, big["id"], ["測試丙"])
    assert elder["is_underage"] is None


async def test_field_rules_by_status(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    [enrolled] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    pending = await add_pending(reception_yihua_client, "測試乙")
    assert (await patch_student(reception_yihua_client, enrolled, deposit_date="2026-09-02")).status_code == 422
    assert (await patch_student(reception_yihua_client, enrolled, grade="中班")).status_code == 422
    assert (await patch_student(reception_yihua_client, enrolled, enrollment_date="2026-09-14")).status_code == 200
    assert (await patch_student(reception_yihua_client, pending, enrollment_date="2026-09-14")).status_code == 422
    assert (await patch_student(reception_yihua_client, pending, grade="小班")).status_code == 200
    assert (await patch_student(reception_yihua_client, pending, deposit_date=None)).status_code == 422


async def test_next_year_rules(reception_yihua_client):
    big = await make_class(reception_yihua_client, grade="大班")
    mid = await make_class(reception_yihua_client, grade="中班")
    [elder] = await add_students(reception_yihua_client, big["id"], ["測試甲"])
    [middle] = await add_students(reception_yihua_client, mid["id"], ["測試乙"])
    assert (await patch_student(reception_yihua_client, elder, next_year="leave")).status_code == 422
    assert (await patch_student(reception_yihua_client, middle, next_year="repeat")).status_code == 422
    assert (await patch_student(reception_yihua_client, elder, next_year="repeat")).status_code == 200
    assert (await patch_student(reception_yihua_client, middle, next_year="leave")).status_code == 200


async def test_move_between_classes_and_reorder(reception_yihua_client, db_session):
    class_a = await make_class(reception_yihua_client)
    class_b = await make_class(reception_yihua_client)
    a, b, c = await add_students(reception_yihua_client, class_a["id"], ["甲", "乙", "丙"])
    [x] = await add_students(reception_yihua_client, class_b["id"], ["戊"])
    response = await move_student(reception_yihua_client, b, class_b["id"], 0)
    assert response.status_code == 200, response.text
    assert await names_in(db_session, class_a["id"]) == [("甲", 0), ("丙", 1)]
    assert await names_in(db_session, class_b["id"]) == [("乙", 0), ("戊", 1)]
    # 同班內調順序：丙（版本仍是 1，被補位不算改動它的資料）移到最前面。
    response = await move_student(reception_yihua_client, c, class_a["id"], 0)
    assert response.status_code == 200, response.text
    assert await names_in(db_session, class_a["id"]) == [("丙", 0), ("甲", 1)]
    # position 超過人數就排最後。
    response = await move_student(reception_yihua_client, a, class_a["id"], 99)
    assert response.json()["position"] == 1


async def test_move_cross_grade_resets_next_year(reception_yihua_client):
    mid = await make_class(reception_yihua_client, grade="中班")
    big = await make_class(reception_yihua_client, grade="大班")
    [kid] = await add_students(reception_yihua_client, mid["id"], ["測試甲"])
    kid = (await patch_student(reception_yihua_client, kid, next_year="leave")).json()
    moved = (await move_student(reception_yihua_client, kid, big["id"], 0)).json()
    assert moved["next_year"] == "continue" and moved["grade"] == "大班"


async def test_leaving_toddler_class_clears_manual_underage(reception_yihua_client):
    toddlers = await make_class(reception_yihua_client, grade="幼幼班")
    small = await make_class(reception_yihua_client, grade="小班")
    [kid] = await add_students(reception_yihua_client, toddlers["id"], ["測試甲"])
    kid = (await patch_student(reception_yihua_client, kid, underage_manual=True)).json()
    moved = (await move_student(reception_yihua_client, kid, small["id"], 0)).json()
    assert moved["underage_manual"] is False


async def test_pending_can_return_to_unassigned_enrolled_cannot(reception_yihua_client, db_session):
    room = await make_class(reception_yihua_client, grade="小班")
    [enrolled] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    pending = await add_pending(reception_yihua_client, "測試乙", class_id=room["id"], grade="小班")
    refused = await move_student(reception_yihua_client, enrolled, None)
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "ROSTER_ENROLLED_NEEDS_CLASS"
    back = await move_student(reception_yihua_client, pending, None)
    assert back.status_code == 200
    assert back.json()["class_id"] is None and back.json()["position"] is None and back.json()["grade"] == "小班"
    assert await names_in(db_session, room["id"]) == [("測試甲", 0)]


async def test_move_requires_same_school_year(reception_yihua_client):
    room_115 = await make_class(reception_yihua_client)
    room_116 = await make_class(reception_yihua_client, school_year=116)
    [kid] = await add_students(reception_yihua_client, room_115["id"], ["測試甲"])
    response = await move_student(reception_yihua_client, kid, room_116["id"], 0)
    assert response.status_code == 422


async def test_stale_version_and_missing_class(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    fresh = (await patch_student(reception_yihua_client, kid, note="備註")).json()
    stale = await patch_student(reception_yihua_client, kid, note="另一個人")
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "ROSTER_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == fresh["version"]
    stale_move = await move_student(reception_yihua_client, kid, room["id"], 0)
    assert stale_move.status_code == 409
    gone = await move_student(reception_yihua_client, fresh, str(uuid.uuid4()), 0)
    assert gone.status_code == 404


async def test_concurrent_moves_keep_positions_dense(
    reception_yihua_client, campus_admin_yihua_client, db_session, monkeypatch
):
    """兩個連線同時移動同一班的兩位：讀完班內名單後各等 0.3 秒，沒有鎖的話兩邊會讀到同一份舊順序，
    丟掉其中一次移動；有鎖時後到的要等前一個 commit 才讀，兩次移動依序生效。"""
    from app.admissions.roster import service

    original = service.members_of

    async def slow_members_of(*args, **kwargs):
        members = await original(*args, **kwargs)
        await asyncio.sleep(0.3)
        return members

    monkeypatch.setattr(service, "members_of", slow_members_of)
    room = await make_class(reception_yihua_client)
    kids = await add_students(reception_yihua_client, room["id"], ["甲", "乙", "丙", "丁", "戊", "己"])
    first, second = await asyncio.gather(
        move_student(reception_yihua_client, kids[4], room["id"], 0),
        move_student(campus_admin_yihua_client, kids[5], room["id"], 0),
    )
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    rows = await names_in(db_session, room["id"])
    assert [position for _, position in rows] == [0, 1, 2, 3, 4, 5]
    # 兩次移動都要生效：結果等於依某個先後順序各套用一次（沒有鎖時後寫的人整批覆蓋，會丟掉另一次）。
    assert [name for name, _ in rows] in (["己", "戊", "甲", "乙", "丙", "丁"], ["戊", "己", "甲", "乙", "丙", "丁"])


async def test_audit_has_no_personal_data(reception_yihua_client, db_session):
    from app.operations.models import AuditLogEntry

    room = await make_class(reception_yihua_client, grade="幼幼班")
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    await patch_student(reception_yihua_client, kid, birthday="2024-10-01", is_special_education=True, note="私人備註")
    entries = (await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action.like("roster_student.%")))).all()
    assert {e.action for e in entries} == {"roster_student.create", "roster_student.update"}
    dump = " ".join(str(e.metadata_json) for e in entries)
    assert "測試甲" not in dump and "2024-10-01" not in dump and "私人備註" not in dump
    update = next(e for e in entries if e.action == "roster_student.update")
    assert "birthday" in update.metadata_json["fields"]  # 只記欄位名


async def test_other_campus_cannot_touch_students(reception_yihua_client, minghua_client):
    room = await make_class(reception_yihua_client)
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    assert (await patch_student(minghua_client, kid, note="x")).status_code == 404
    assert (await move_student(minghua_client, kid, room["id"], 0)).status_code == 404
    created = await minghua_client.post(
        f"{ROSTER}/students?campus_key=yihua", json={"school_year": 115, "class_id": room["id"], "names": ["測試乙"]}
    )
    assert created.status_code == 404
