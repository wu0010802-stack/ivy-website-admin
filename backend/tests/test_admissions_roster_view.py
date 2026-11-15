"""讀取整張編班表、缺額統計、三段目標與結算紀錄（2026-11-15 計畫 Task 6）。姓名一律虛構。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from app.admissions.roster.models import RosterStudent
from app.common.timezones import today_local
from tests.admissions_helpers import ADMISSIONS, readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import minghua_client  # noqa: F401
from tests.roster_helpers import ROSTER, act, add_pending, add_students, make_class, patch_student, seed_baseline

BASELINE_DAY = "2026-11-11"


async def get_roster(client, campus_key: str = "yihua", school_year: int = 115, **params):
    query = {"campus_key": campus_key, "school_year": school_year, **params}
    return await client.get(ROSTER, params=query)


async def test_empty_roster_shape(reception_yihua_client):
    response = await get_roster(reception_yihua_client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["classes"] == [] and body["unassigned"] == [] and body["next_year"] == [] and body["gone"] == []
    assert body["snapshots"] == []
    assert body["today"] == today_local().isoformat() and body["as_of"] == body["today"]
    assert set(body["grade_totals"]) == {"大班", "中班", "小班", "幼幼班"}
    assert body["grade_totals"]["大班"] == {"count": 0, "returning": 0, "new": 0, "pending": 0}
    assert all(value is None for value in body["current"]["targets"].values())
    assert body["current"]["rows"]["estimate"]["total"] == 0
    assert body["current"]["tier"] == {"base": None, "boost": None, "top": None, "reached": None, "next": None, "short": None}
    assert (body["underage_enrolled"], body["underage_pending"], body["missing_birthday"], body["incomplete"]) == (0, 0, 0, 0)


async def test_view_matches_calc_baseline(admin_client, db_session):
    await seed_baseline(db_session)
    body = (await get_roster(admin_client, "renwu", as_of=BASELINE_DAY)).json()
    assert body["current"]["rows"]["enrolled"] == {"大班": 60, "中班": 59, "小班": 40, "幼幼班": 45, "total": 204}
    assert body["current"]["rows"]["pending_s1"]["幼幼班"] == 8
    assert body["current"]["rows"]["pending_s2"] == {"大班": 0, "中班": 1, "小班": 0, "幼幼班": 23, "total": 24}
    assert body["current"]["rows"]["estimate"]["total"] == 236
    assert body["next"]["rows"]["estimate_next"] == {"大班": 60, "中班": 40, "小班": 39, "幼幼班": 61, "total": 200}
    assert (body["underage_enrolled"], body["underage_pending"]) == (10, 31)
    assert [c["class_code"] for c in body["classes"]] == ["大1", "中1", "小1", "幼1"]
    assert body["classes"][0]["count"] == 60 and len(body["classes"][0]["students"]) == 60
    assert len(body["unassigned"]) == 8 + 1 + 23 and len(body["next_year"]) == 24
    assert body["grade_totals"]["幼幼班"]["count"] == 45


async def test_class_targets_sum_to_grade_target(reception_yihua_client):
    await make_class(reception_yihua_client, grade="大班", target_seats=22)
    await make_class(reception_yihua_client, grade="大班", target_seats=22)
    await make_class(reception_yihua_client, grade="大班")
    await make_class(reception_yihua_client, grade="中班")
    body = (await get_roster(reception_yihua_client)).json()
    assert body["current"]["targets"]["大班"] == 44
    assert body["current"]["targets"]["中班"] is None
    assert body["current"]["gap"]["total"] is None and body["current"]["achievement"]["total"] is None
    for grade in ("中班", "小班", "幼幼班"):
        await make_class(reception_yihua_client, grade=grade, target_seats=10)
    body = (await get_roster(reception_yihua_client)).json()
    assert body["current"]["targets"]["total"] == 74
    assert body["current"]["gap"]["total"] == -74 and body["current"]["achievement"]["total"] == 0
    assert body["current"]["gap"]["大班"] == -44


async def test_next_targets_from_intake_targets(reception_yihua_client):
    response = await reception_yihua_client.put(
        f"{ADMISSIONS}/intake-targets?campus_key=yihua",
        json={"school_year": 116, "semester": 1, "targets": {"大班": 30, "小班": 0}},
    )
    assert response.status_code == 200, response.text
    block = (await get_roster(reception_yihua_client)).json()["next"]
    assert block["targets"]["大班"] == 30 and block["targets"]["小班"] == 0 and block["targets"]["中班"] is None
    assert block["gap"]["大班"] == -30 and block["achievement"]["小班"] is None  # 目標 0 沒有達成率


async def test_class_gap_sign(reception_yihua_client):
    short = await make_class(reception_yihua_client, target_seats=22)
    full = await make_class(reception_yihua_client, target_seats=16)
    over = await make_class(reception_yihua_client, target_seats=16)
    unset = await make_class(reception_yihua_client)
    await add_students(reception_yihua_client, short["id"], [f"甲{i}" for i in range(18)])
    await add_students(reception_yihua_client, full["id"], [f"乙{i}" for i in range(16)])
    await add_students(reception_yihua_client, over["id"], [f"丙{i}" for i in range(17)])
    await add_students(reception_yihua_client, unset["id"], ["丁"])
    gaps = {c["id"]: c["gap"] for c in (await get_roster(reception_yihua_client)).json()["classes"]}
    assert gaps == {short["id"]: -4, full["id"]: 0, over["id"]: 1, unset["id"]: None}


async def test_grade_totals_new_vs_returning(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班")
    old, fresh, flagged = await add_students(reception_yihua_client, room["id"], ["舊生", "新入園", "手動新生"])
    await patch_student(reception_yihua_client, fresh, enrollment_date="2026-09-14")
    await patch_student(reception_yihua_client, flagged, is_new_manual=True)
    await add_pending(reception_yihua_client, "預繳生", class_id=room["id"], grade="小班")
    totals = (await get_roster(reception_yihua_client)).json()["grade_totals"]["小班"]
    assert totals == {"count": 4, "returning": 1, "new": 3, "pending": 1}


async def test_as_of_recomputes_counts_not_lists(reception_yihua_client):
    room = await make_class(reception_yihua_client, grade="小班")
    await add_students(reception_yihua_client, room["id"], ["舊生"])
    kid = await add_pending(reception_yihua_client, "測試甲", class_id=room["id"], grade="小班")
    await act(reception_yihua_client, kid, "enter", enrollment_date="2026-10-05")
    early = (await get_roster(reception_yihua_client, as_of="2026-09-15")).json()
    now = (await get_roster(reception_yihua_client)).json()
    assert early["current"]["rows"]["enrolled"]["小班"] == 1 and now["current"]["rows"]["enrolled"]["小班"] == 2
    assert early["current"]["rows"]["pending_s1"]["小班"] == 1 and now["current"]["rows"]["pending_s1"]["小班"] == 0
    assert early["current"]["rows"]["estimate"]["total"] == now["current"]["rows"]["estimate"]["total"] == 2
    assert [s["child_name"] for s in early["classes"][0]["students"]] == [s["child_name"] for s in now["classes"][0]["students"]]
    assert early["as_of"] == "2026-09-15"


async def test_as_of_out_of_range(reception_yihua_client):
    tomorrow = (today_local() + timedelta(days=1)).isoformat()
    for value in (tomorrow, "2026-07-31"):
        response = await get_roster(reception_yihua_client, as_of=value)
        assert response.status_code == 422, value
        assert response.json()["detail"]["code"] == "ROSTER_AS_OF_OUT_OF_RANGE"
    assert (await get_roster(reception_yihua_client, as_of="2026-08-01")).status_code == 200


async def test_tier_targets_roundtrip_and_status(admin_client, db_session):
    await seed_baseline(db_session)
    put = await admin_client.put(
        f"{ROSTER}/tier-targets?campus_key=renwu",
        json={"school_year": 115, "semester": 2, "base": 220, "boost": 230, "top": 240},
    )
    assert put.status_code == 200, put.text
    assert put.json()["reached"] == "boost"
    tier = (await get_roster(admin_client, "renwu", as_of=BASELINE_DAY)).json()["current"]["tier"]
    assert tier == {"base": 220, "boost": 230, "top": 240, "reached": "boost", "next": "top", "short": 4}
    cleared = await admin_client.put(
        f"{ROSTER}/tier-targets?campus_key=renwu", json={"school_year": 115, "semester": 2, "base": None, "boost": None, "top": None}
    )
    assert cleared.json()["reached"] is None
    out_of_order = await admin_client.put(
        f"{ROSTER}/tier-targets?campus_key=renwu", json={"school_year": 115, "semester": 2, "base": 250, "boost": 230}
    )
    assert out_of_order.status_code == 422


async def test_next_tier_uses_next_year_semester_one(admin_client, db_session):
    await seed_baseline(db_session)
    await admin_client.put(
        f"{ROSTER}/tier-targets?campus_key=renwu", json={"school_year": 116, "semester": 1, "base": 190, "boost": 210}
    )
    tier = (await get_roster(admin_client, "renwu", as_of=BASELINE_DAY)).json()["next"]["tier"]
    assert (tier["reached"], tier["next"], tier["short"]) == ("base", "boost", 10)


async def test_snapshot_create_conflict_overwrite(admin_client, db_session):
    await seed_baseline(db_session)
    body = {"school_year": 115, "as_of": BASELINE_DAY}
    first = await admin_client.post(f"{ROSTER}/snapshots?campus_key=renwu", json=body)
    assert first.status_code == 201, first.text
    saved = first.json()
    assert saved["as_of"] == BASELINE_DAY and saved["total_enrolled"] == 204 and saved["estimate_total"] == 236
    assert saved["enrolled"] == {"大班": 60, "中班": 59, "小班": 40, "幼幼班": 45}
    again = await admin_client.post(f"{ROSTER}/snapshots?campus_key=renwu", json=body)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ROSTER_SNAPSHOT_EXISTS"
    overwritten = await admin_client.post(f"{ROSTER}/snapshots?campus_key=renwu", json={**body, "overwrite": True})
    assert overwritten.status_code == 201
    snapshots = (await get_roster(admin_client, "renwu")).json()["snapshots"]
    assert len(snapshots) == 1 and snapshots[0]["id"] == overwritten.json()["id"]
    assert (await admin_client.post(f"{ROSTER}/snapshots?campus_key=renwu", json={**body, "as_of": "2999-01-01"})).status_code == 422


async def test_snapshot_is_frozen(admin_client, db_session):
    await seed_baseline(db_session)
    await admin_client.post(f"{ROSTER}/snapshots?campus_key=renwu", json={"school_year": 115, "as_of": BASELINE_DAY})
    room = (await get_roster(admin_client, "renwu")).json()["classes"][0]
    await add_students(admin_client, room["id"], ["新來的"], campus_key="renwu")
    snapshots = (await get_roster(admin_client, "renwu")).json()["snapshots"]
    assert snapshots[0]["total_enrolled"] == 204


async def test_next_year_list_and_unassigned_split(reception_yihua_client, db_session):
    next_up = await add_pending(reception_yihua_client, "下學年", target_school_year=116, target_semester=1, grade="小班")
    this_year = await add_pending(reception_yihua_client, "這學年", target_school_year=115, target_semester=2)
    now = datetime.now(timezone.utc)
    db_session.add(
        RosterStudent(
            id=uuid.uuid4(), campus_key="yihua", school_year=116, child_name="更晚", status="pending", grade="小班",
            deposit_date=date(2026, 9, 1), target_school_year=116, target_semester=2, created_at=now, updated_at=now,
        )
    )
    await db_session.commit()
    body = (await get_roster(reception_yihua_client)).json()
    assert [s["id"] for s in body["next_year"]] == [next_up["id"]]
    assert [s["id"] for s in body["unassigned"]] == [this_year["id"]]
    shown = {s["id"] for s in body["next_year"]} | {s["id"] for s in body["unassigned"]}
    assert len(shown) == 2


async def test_gone_list_newest_first(reception_yihua_client):
    room = await make_class(reception_yihua_client)
    a, b = await add_students(reception_yihua_client, room["id"], ["先走", "後走"])
    await act(reception_yihua_client, a, "leave", left_date="2026-10-01")
    await act(reception_yihua_client, b, "leave", left_date="2026-10-20")
    gone = (await get_roster(reception_yihua_client)).json()["gone"]
    assert [s["child_name"] for s in gone] == ["後走", "先走"]


async def test_view_scope(reception_yihua_client, readonly_yihua_client, minghua_client):
    assert (await get_roster(minghua_client, "yihua")).status_code == 404
    assert (await get_roster(reception_yihua_client, "nowhere")).status_code == 404
    assert (await get_roster(readonly_yihua_client)).status_code == 403  # 唯讀角色沒有 admissions.read
    denied = await readonly_yihua_client.put(
        f"{ROSTER}/tier-targets?campus_key=yihua", json={"school_year": 115, "semester": 2, "base": 1}
    )
    assert denied.status_code == 403
