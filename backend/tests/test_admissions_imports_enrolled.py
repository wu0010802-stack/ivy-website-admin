"""後台資料匯入：在籍清冊的狀態、預覽、確認與清除端點（2026-10-21 規格 §5、§8）。

地址一律是假的（同 test_enrolled_match.py），姓名是「測試小明」；斷言重點是地址和姓名不會出現在
回應、日誌與操作紀錄裡。"""
from __future__ import annotations

import json
import logging

import pytest
from sqlalchemy import func, select

from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint
from app.admissions.history.importer import replace_history
from app.admissions.history.payload import load_payload as load_history_payload
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.admissions_helpers import requests_queued_on_import_lock
from tests.conftest import _logged_in_client, _test_settings
from tests.enrolled_helpers import payload_text, points_payload, student
from tests.geo_helpers import load_geo_samples, publish_campus_address
from tests.history_helpers import history_payload, history_text, term_row

IMPORTS = "/api/website/v1/admin/admissions/imports"
STUDENTS = [
    {"grade": "小班", "address": "本揚里1鄰義華路68號"},
    {"grade": "小班", "address": "本揚里1鄰義華路68號"},
    {"grade": "中班", "address": "高雄市三民區義華路999號"},
    {"grade": "中班", "address": "臺北市內湖區文德路1號"},
]
# 九位有點（義華路 68、72、74 號都在樣本門牌附近）、一位在外縣市：剛好 90%，是確認匯入的下限。
NINE_OF_TEN = [
    *({"grade": "小班", "address": "本揚里1鄰義華路68號"} for _ in range(4)),
    *({"grade": "中班", "address": "高雄市三民區義華路72號"} for _ in range(3)),
    *({"grade": "大班", "address": "高雄市三民區義華路74號"} for _ in range(2)),
    {"grade": "大班", "address": "臺北市內湖區文德路1號"},
]
FILE = {"roster_date": "2026-10-15", "students": STUDENTS}


async def _ready(db) -> None:
    await load_geo_samples(db)
    await publish_campus_address(db, "yihua", "高雄市三民區義華路68號")


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _audit(db, action: str | None = None) -> list[AuditLogEntry]:
    query = select(AuditLogEntry).order_by(AuditLogEntry.created_at)
    if action is not None:
        query = query.where(AuditLogEntry.action == action)
    return list((await db.execute(query.execution_options(populate_existing=True))).scalars())


async def _preview(client, students=None, campus_key: str = "yihua") -> dict:
    response = await client.post(
        f"{IMPORTS}/enrolled/preview?campus_key={campus_key}",
        json={"roster_date": "2026-10-15", "students": students if students is not None else STUDENTS},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _requests(campus_key: str) -> list[tuple[str, str, dict | None]]:
    query = f"?campus_key={campus_key}"
    return [
        ("GET", f"{IMPORTS}/status{query}", None),
        ("POST", f"{IMPORTS}/enrolled/preview{query}", FILE),
        ("POST", f"{IMPORTS}/enrolled/apply{query}", points_payload()),
        ("DELETE", f"{IMPORTS}/enrolled{query}", None),
    ]


async def test_permissions(
    reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client, public_client, db_session
):
    """限總管理者（admissions.stats）：其他角色不論本校或他校一律 403；未登入 401；不存在的校區 404。"""
    await _ready(db_session)
    for client in (reception_yihua_client, readonly_yihua_client, minghua_client, editor_client):
        for campus_key in ("yihua", "minghua"):
            for method, path, body in _requests(campus_key):
                assert (await client.request(method, path, json=body)).status_code == 403, (method, path)
    for method, path, body in _requests("yihua"):
        response = await admin_client.request(method, path, json=body)
        assert response.status_code == 200, (method, path, response.text)
    for method, path, body in _requests("nowhere"):
        assert (await admin_client.request(method, path, json=body)).status_code == 404, (method, path)
    for method, path, body in _requests("yihua"):
        assert (await public_client.request(method, path, json=body)).status_code == 401, (method, path)


async def test_hidden_when_admissions_are_disabled(admin_client):
    """admin_client 只為了建好總管理者帳號；這裡用另一個關掉招生的 app 登入。"""
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for method, path, body in _requests("yihua"):
            assert (await client.request(method, path, json=body)).status_code == 404, (method, path)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_status_before_and_after_import(admin_client, db_session):
    empty = await admin_client.get(f"{IMPORTS}/status?campus_key=yihua")
    assert empty.status_code == 200, empty.text
    assert empty.json() == {"active_doorplate_version": None, "enrolled": None, "history": None}

    await load_geo_samples(db_session)
    await replace_roster(db_session, load_payload(payload_text(points_payload([student(), student(match_level="street", lat=None, lng=None)]))))
    await replace_history(
        db_session,
        load_history_payload(history_text(history_payload([term_row(114, 2), term_row(115, 1), term_row(115, 1, "中班")]))),
    )
    await db_session.commit()

    body = (await admin_client.get(f"{IMPORTS}/status?campus_key=yihua")).json()
    assert body["active_doorplate_version"] == "115-10"
    enrolled = body["enrolled"]
    assert (enrolled["roster_date"], enrolled["school_year"], enrolled["doorplate_version"]) == ("2026-10-15", 115, "115-10")
    assert (enrolled["total"], enrolled["placed"]) == (2, 1)
    assert enrolled["imported_at"]
    history = body["history"]
    assert (history["rows"], history["first_school_year"], history["first_semester"]) == (3, 114, 2)
    assert (history["last_school_year"], history["last_semester"]) == (115, 1)
    assert history["imported_at"]

    # 別校沒有匯入，不受影響。
    other = (await admin_client.get(f"{IMPORTS}/status?campus_key=minghua")).json()
    assert (other["enrolled"], other["history"]) == (None, None)


async def test_preview_reports_and_writes_nothing(admin_client, db_session):
    await _ready(db_session)
    audits_before = len(await _audit(db_session))
    body = await _preview(admin_client)
    assert (body["total"], body["school_year"], body["doorplate_version"]) == (4, 115, "115-10")
    assert body["roster_date"] == "2026-10-15"
    assert (body["placed"], body["placed_ratio"], body["importable"]) == (2, 0.5, False)
    assert body["grades"] == {"小班": 2, "中班": 2}
    assert body["levels"] == {"exact": 2, "street": 1, "unlocated": 1}
    assert sum(body["methods"].values()) == 4
    assert len(body["unplaced"]) == 2
    assert {item["street"] for item in body["unplaced"]} <= {"義華路…", ""}
    assert body["payload"]["format"] == "ivy-enrolled-points/1" and body["payload"]["campus_key"] == "yihua"
    assert len(body["payload"]["students"]) == 4
    assert await _count(db_session, EnrolledRoster) == 0
    assert await _count(db_session, EnrolledStudentPoint) == 0
    assert len(await _audit(db_session)) == audits_before


async def test_preview_accepts_a_blank_address(admin_client, db_session):
    """清冊上沒填地址的學生（瀏覽器送空字串）同 CLI：算進總數、列為 no_address，不讓整份預覽 422。"""
    await _ready(db_session)
    body = await _preview(admin_client, [*STUDENTS, {"grade": "小班", "address": ""}])
    assert body["total"] == 5
    assert body["levels"]["unlocated"] == 2
    assert {"match_level": "unlocated", "unlocated_reason": "no_address", "street": ""} in body["unplaced"]


async def test_preview_marks_a_good_roster_importable(admin_client, db_session):
    await _ready(db_session)
    body = await _preview(admin_client, NINE_OF_TEN)
    assert (body["total"], body["placed"], body["placed_ratio"], body["importable"]) == (10, 9, 0.9, True)


async def test_preview_never_echoes_or_logs_addresses(admin_client, db_session, caplog):
    await _ready(db_session)
    caplog.set_level(logging.DEBUG)
    ok = await admin_client.post(f"{IMPORTS}/enrolled/preview?campus_key=yihua", json=FILE)
    bad = await admin_client.post(
        f"{IMPORTS}/enrolled/preview?campus_key=yihua",
        json={
            "roster_date": "2026-10-15",
            "students": [{"grade": "大大班", "address": "本揚里1鄰義華路68號", "name": "測試小明"}],
        },
    )
    assert ok.status_code == 200, ok.text
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    for text in (ok.text, bad.text, caplog.text):
        assert "義華路68號" not in text and "文德路1號" not in text and "測試小明" not in text and '"name"' not in text


async def test_preview_error_message_lists_positions_without_extra_keys(admin_client, db_session):
    await _ready(db_session)
    response = await admin_client.post(
        f"{IMPORTS}/enrolled/preview?campus_key=yihua",
        json={"roster_date": "2026-10-15", "students": [{"grade": "大大班", "address": "x", "name": "測試小明"}]},
    )
    detail = response.json()["detail"]
    assert response.status_code == 422 and detail["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "students.0.grade：literal_error" in detail["message"]
    assert "students.0.（多餘欄位）：extra_forbidden" in detail["message"]
    assert response.json()["request_id"]


async def test_preview_rejects_unreadable_bodies_without_echo(admin_client, db_session):
    await _ready(db_session)
    path = f"{IMPORTS}/enrolled/preview?campus_key=yihua"
    headers = {"content-type": "application/json"}
    broken = await admin_client.post(path, content='{"students": [{"address": "本揚里1鄰義華路68號"', headers=headers)
    assert broken.status_code == 422 and broken.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "義華路68號" not in broken.text
    wrong_type = await admin_client.post(path, json=["本揚里1鄰義華路68號"])
    assert wrong_type.status_code == 422 and wrong_type.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "義華路68號" not in wrong_type.text


async def test_preview_needs_doorplates(admin_client, db_session):
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")  # 有校址、沒有門牌
    response = await admin_client.post(f"{IMPORTS}/enrolled/preview?campus_key=yihua", json=FILE)
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "ENROLLED_MATCH_FAILED"
    assert "門牌" in detail["message"]
    assert "義華路68號" not in response.text


async def test_preview_limits(admin_client, db_session):
    await _ready(db_session)
    path = f"{IMPORTS}/enrolled/preview?campus_key=yihua"
    too_many = [{"grade": "小班", "address": "本揚里1鄰義華路68號"}] * 2001
    long_address = [{"grade": "小班", "address": "義" * 121}]
    for students in (too_many, long_address, []):
        response = await admin_client.post(path, json={"roster_date": "2026-10-15", "students": students})
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    # 上限當下仍可預覽：2000 位、地址 120 字；瀏覽器的 JSON.stringify 不跳脫中文（UTF-8 約 790 KB），所以也在 1 MB 本文上限內。
    body = {"roster_date": "2026-10-15", "students": [{"grade": "小班", "address": "義" * 120}] * 2000}
    content = json.dumps(body, ensure_ascii=False).encode()
    assert len(content) < 1024 * 1024
    edge = await admin_client.post(path, content=content, headers={"content-type": "application/json"})
    assert edge.status_code == 200, edge.text[:200]
    assert edge.json()["total"] == 2000


async def test_preview_rejects_an_implausible_roster_date(admin_client, db_session):
    """學年落在匯入端收得下的範圍（100–200）之外，預覽就擋下，免得預覽通過、確認匯入才被擋。"""
    await _ready(db_session)
    for roster_date in ("1900-01-01", "2200-01-01"):
        response = await admin_client.post(
            f"{IMPORTS}/enrolled/preview?campus_key=yihua", json={"roster_date": roster_date, "students": STUDENTS}
        )
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "INVALID_IMPORT_PAYLOAD" and "roster_date：value_error" in detail["message"]


async def test_apply_replaces_roster_and_audits(admin_client, db_session):
    await _ready(db_session)
    await replace_roster(db_session, load_payload(payload_text(points_payload([student(grade="大班")] * 3))))
    await db_session.commit()
    preview = await _preview(admin_client, NINE_OF_TEN)
    response = await admin_client.post(f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=preview["payload"])
    assert response.status_code == 200, response.text
    assert response.json() == {"students": 10, "placed": 9}

    rosters = (await db_session.execute(select(EnrolledRoster).execution_options(populate_existing=True))).scalars().all()
    assert [(row.campus_key, row.total, row.school_year, row.doorplate_version) for row in rosters] == [("yihua", 10, 115, "115-10")]
    assert await _count(db_session, EnrolledStudentPoint) == 10

    status_body = (await admin_client.get(f"{IMPORTS}/status?campus_key=yihua")).json()
    assert (status_body["enrolled"]["total"], status_body["enrolled"]["placed"]) == (10, 9)

    [entry] = await _audit(db_session, "enrolled_roster.import")
    assert (entry.target_type, entry.target_id, entry.campus_key) == ("enrolled_roster", "yihua", "yihua")
    assert set(entry.metadata_json) == {"students", "placed_students", "roster_date", "doorplate_version"}
    assert entry.metadata_json == {
        "students": 10, "placed_students": 9, "roster_date": "2026-10-15", "doorplate_version": "115-10",
    }
    text = json.dumps(entry.metadata_json, ensure_ascii=False)
    assert "義華路" not in text and "文德路" not in text


async def test_concurrent_applies_for_one_campus_queue_on_the_lock(app, admin_client, db_session):
    """同一校兩個確認匯入同時送到、都卡在同一把匯入鎖上（原本沒有資料）：依序整校取代，兩個都成功，最後只有一份清冊。"""
    await _ready(db_session)
    path = f"{IMPORTS}/enrolled/apply?campus_key=yihua"
    body = points_payload([student()] * 3)
    responses = await requests_queued_on_import_lock(
        app, "enrolled_roster", "yihua", [admin_client.post(path, json=body) for _ in range(2)]
    )
    assert [response.status_code for response in responses] == [200, 200], [response.text for response in responses]
    assert await _count(db_session, EnrolledRoster) == 1
    assert await _count(db_session, EnrolledStudentPoint) == 3
    assert len(await _audit(db_session, "enrolled_roster.import")) == 2


async def test_apply_rejects_low_ratio(admin_client, db_session):
    await _ready(db_session)
    students = [student()] * 8 + [student(match_level="street", lat=None, lng=None)] * 2
    response = await admin_client.post(f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload(students))
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "LOW_PLACED_RATIO"
    assert await _count(db_session, EnrolledRoster) == 0
    assert await _audit(db_session, "enrolled_roster.import") == []


async def test_apply_rejects_other_campus(admin_client, db_session):
    await _ready(db_session)
    response = await admin_client.post(f"{IMPORTS}/enrolled/apply?campus_key=minghua", json=points_payload())
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "CAMPUS_MISMATCH"
    assert await _count(db_session, EnrolledRoster) == 0


async def test_apply_rejects_changed_doorplate(admin_client, db_session):
    await _ready(db_session)
    response = await admin_client.post(
        f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload(doorplate_version="114-01")
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "DOORPLATE_CHANGED"
    assert await _count(db_session, EnrolledRoster) == 0


async def test_apply_rejects_when_no_doorplates_are_loaded(admin_client, db_session):
    response = await admin_client.post(f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload())
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "DOORPLATE_CHANGED"


async def test_apply_rejects_school_year_mismatch(admin_client, db_session):
    await _ready(db_session)
    response = await admin_client.post(
        f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload(roster_date="2026-10-15", school_year=114)
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "SCHOOL_YEAR_MISMATCH"
    assert await _count(db_session, EnrolledRoster) == 0


async def test_apply_checks_run_in_order(admin_client, db_session):
    """校區 → 比例 → 門牌 → 學年：同時不符時回最前面那一個。"""
    await _ready(db_session)
    low = [student(match_level="street", lat=None, lng=None)]
    response = await admin_client.post(
        f"{IMPORTS}/enrolled/apply?campus_key=minghua",
        json=points_payload(low, doorplate_version="114-01", school_year=114),
    )
    assert response.json()["detail"]["code"] == "CAMPUS_MISMATCH"
    response = await admin_client.post(
        f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload(low, doorplate_version="114-01", school_year=114)
    )
    assert response.json()["detail"]["code"] == "LOW_PLACED_RATIO"
    response = await admin_client.post(
        f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload(doorplate_version="114-01", school_year=114)
    )
    assert response.json()["detail"]["code"] == "DOORPLATE_CHANGED"


async def test_apply_rejects_extra_fields_without_echo(admin_client, db_session):
    await _ready(db_session)
    leaked = {**student(), "address": "高雄市三民區義華路68號"}
    response = await admin_client.post(f"{IMPORTS}/enrolled/apply?campus_key=yihua", json=points_payload([leaked]))
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "義華路68號" not in response.text
    assert await _count(db_session, EnrolledRoster) == 0


async def test_clear(admin_client, db_session):
    await _ready(db_session)
    await replace_roster(db_session, load_payload(payload_text(points_payload())))
    await db_session.commit()
    first = await admin_client.delete(f"{IMPORTS}/enrolled?campus_key=yihua")
    assert (first.status_code, first.json()) == (200, {"removed": True})
    assert await _count(db_session, EnrolledRoster) == 0
    assert await _count(db_session, EnrolledStudentPoint) == 0
    second = await admin_client.delete(f"{IMPORTS}/enrolled?campus_key=yihua")
    assert (second.status_code, second.json()) == (200, {"removed": False})
    # 只有真的清掉那一次寫了稽核；沒有資料的第二次不寫。
    [entry] = await _audit(db_session, "enrolled_roster.clear")
    assert (entry.target_type, entry.target_id, entry.campus_key, entry.metadata_json) == ("enrolled_roster", "yihua", "yihua", {})
    assert await _audit(db_session, "enrolled_roster.import") == []


@pytest.mark.parametrize("path", ["status", "enrolled/preview", "enrolled/apply", "enrolled"])
async def test_requires_a_campus_key(admin_client, path):
    method = {"status": "GET", "enrolled": "DELETE"}.get(path, "POST")
    response = await admin_client.request(method, f"{IMPORTS}/{path}", json=None if method != "POST" else {})
    assert response.status_code == 422
