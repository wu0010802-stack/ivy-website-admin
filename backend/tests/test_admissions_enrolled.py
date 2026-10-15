"""在籍學生分布 API（2026-10-15 規格 §5）。"""
from __future__ import annotations

import pytest

from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.geo import boundaries, matcher
from app.main import create_app
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.enrolled_helpers import payload_text, points_payload, student

ENROLLED = f"{AREA}/enrolled"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
ZERO = {"幼幼班": 0, "小班": 0, "中班": 0, "大班": 0, "其他": 0}


@pytest.fixture
def located_campus(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district="三民區")

    monkeypatch.setattr(matcher, "campus_point", located)


async def _seed(db, students=None) -> None:
    students = students or [
        student(grade="小班"),  # (22.642, 120.344)，約 60 m
        student(grade="中班"),  # 同一格
        student(grade="大班", district="左營區", village="新上里", lat=22.700, lng=120.300),  # 約 7.8 km
        student(grade="小班", match_level="street", lat=None, lng=None),
        student(grade="幼幼班", match_level="unlocated", unlocated_reason="outside_kaohsiung", district=None, village=None, lat=None, lng=None),
    ]
    await replace_roster(db, load_payload(payload_text(points_payload(students))))
    await db.commit()


async def test_not_imported(admin_client, located_campus):
    response = await admin_client.get(f"{ENROLLED}?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "not_imported"
    assert (body["total"], body["points"], body["grades"]) == (0, [], [])


async def test_aggregates_points_grades_unplaced_bands_and_villages(admin_client, db_session, located_campus):
    await _seed(db_session)
    response = await admin_client.get(f"{ENROLLED}?campus_key=yihua")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert (body["status"], body["roster_date"], body["school_year"], body["doorplate_version"], body["total"]) == (
        "ready", "2026-10-15", 115, "115-10", 5,
    )
    assert body["grades"] == [
        {"grade": "幼幼班", "total": 1, "placed": 0},
        {"grade": "小班", "total": 2, "placed": 1},
        {"grade": "中班", "total": 1, "placed": 1},
        {"grade": "大班", "total": 1, "placed": 1},
    ]
    assert body["points"] == [
        {"lat": 22.642, "lng": 120.344, "counts": {**ZERO, "小班": 1, "中班": 1}},
        {"lat": 22.7, "lng": 120.3, "counts": {**ZERO, "大班": 1}},
    ]
    assert body["unplaced"] == [
        {"reason": "street", "counts": {**ZERO, "小班": 1}},
        {"reason": "outside_kaohsiung", "counts": {**ZERO, "幼幼班": 1}},
    ]
    assert body["distance_bands"] == [
        {"band": "0-1", "counts": {**ZERO, "小班": 1, "中班": 1}},
        {"band": "1-3", "counts": ZERO},
        {"band": "3-6", "counts": ZERO},
        {"band": "6+", "counts": {**ZERO, "大班": 1}},
        {"band": "none", "counts": {**ZERO, "小班": 1, "幼幼班": 1}},
    ]
    assert body["villages"][0] == {
        "district": "三民區", "village": "本揚里", "village_code": boundaries.village_code("三民區", "本揚里"),
        "counts": {**ZERO, "小班": 2, "中班": 1}, "total": 3,
    }
    assert [(row["district"], row["village"], row["total"]) for row in body["villages"]] == [
        ("三民區", "本揚里", 3), ("左營區", "新上里", 1),
    ]


async def test_other_grade_is_listed_only_when_present(admin_client, db_session, located_campus):
    await _seed(db_session, [student(grade="其他")])
    body = (await admin_client.get(f"{ENROLLED}?campus_key=yihua")).json()
    assert body["grades"][-1] == {"grade": "其他", "total": 1, "placed": 1}


async def test_unlocated_campus_puts_everyone_in_none(admin_client, db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="pending", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _seed(db_session)
    bands = {row["band"]: sum(row["counts"].values()) for row in (await admin_client.get(f"{ENROLLED}?campus_key=yihua")).json()["distance_bands"]}
    assert bands == {"0-1": 0, "1-3": 0, "3-6": 0, "6+": 0, "none": 5}


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client, public_client, located_campus):
    path = f"{ENROLLED}?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404
    assert (await public_client.get(path + "yihua")).status_code == 401


async def test_hidden_when_admissions_are_disabled(admin_client):
    """admin_client 只為了建好總管理者帳號；這裡用另一個關掉招生的 app 登入。"""
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{ENROLLED}?campus_key=yihua")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
