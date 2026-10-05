"""招生訪視的新增、查詢、編輯、刪除、歷程與篩選選項（規格 5、6.1 第 3 點、6.2、6.6、
7、13；R02、R03、R05 編輯部分、R06 讀取部分、R07）。"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select, update

from app.admissions import constants, funnel
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.auth.models import Role
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    campus_admin_yihua_client,
    create_record,
    manual_fields,
    readonly_yihua_client,
    reception_yihua_client,
    record_at_stage,
)
from tests.conftest import _create_user, legacy_request

RECORDS = f"{ADMISSIONS}/records"


async def _audit(db_session, action: str) -> list[AuditLogEntry]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


def _locations(response) -> list[list]:
    return [error["loc"] for error in response.json()["detail"]]


@pytest.mark.asyncio
async def test_create_computes_month_seq_and_writes_created_event(admin_client, db_session):
    first = await create_record(
        admin_client, child_name="王小明", visit_date="2026-09-08", grade="小班",
        phone="0912-345-678", contact_name="王媽媽", source="親友介紹", notes="  想了解午睡  ",
    )
    second = await create_record(admin_client, child_name="陳小華", visit_date="2026-09-30")
    october = await create_record(admin_client, child_name="林小安", visit_date="2026-10-01")
    minghua = await create_record(admin_client, "minghua", child_name="李小美", visit_date="2026-09-08")

    assert (first["month"], first["seq_no"]) == ("115.09", "1")
    assert (second["month"], second["seq_no"]) == ("115.09", "2")
    assert (october["month"], october["seq_no"]) == ("115.10", "1")
    assert (minghua["month"], minghua["seq_no"]) == ("115.09", "1")
    assert first["stage"] == "visited" and first["has_visit_request"] is False
    assert (first["has_deposit"], first["enrolled"], first["version"]) == (False, False, 1)
    assert first["notes"] == "想了解午睡"
    assert first["phone"] == "0912-345-678"
    assert (first["target_school_year"], first["target_semester"]) == (115, 1)

    events = (await admin_client.get(f"{RECORDS}/{first['id']}/events")).json()
    assert [(e["event_type"], e["from_stage"], e["to_stage"]) for e in events] == [("created", None, "visited")]
    # 參觀後追蹤（2026-10-04 規格 6.1）：手動新增不自動排下次聯絡。
    assert events[0]["metadata_json"] == {"origin": "manual", "follow_up": "none"}
    assert events[0]["actor_name"] == "admin@ivy.example"

    entries = await _audit(db_session, "recruitment_visit.create")
    assert len(entries) == 4
    assert {(e.target_type, e.campus_key) for e in entries} == {("recruitment_visit", "yihua"), ("recruitment_visit", "minghua")}
    assert all(e.metadata_json == {"origin": "manual"} for e in entries)
    dumped = json.dumps([e.metadata_json for e in entries], ensure_ascii=False)
    assert "王小明" not in dumped and "0912" not in dumped


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["visit_date", "child_name", "birthday", "target_school_year", "target_semester"])
async def test_create_requires_the_four_ivy_fields(admin_client, field):
    """R02：園務表單的必填（參觀日期、幼生姓名、生日、入學學年學期），缺任何一個 422 指到該欄位。"""
    body = manual_fields()
    body.pop(field)
    response = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=body)
    assert response.status_code == 422, response.text
    assert any(loc[-1] == field for loc in _locations(response))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"child_name": "   "}, "child_name"),
        ({"child_name": "王" * 51}, "child_name"),
        ({"visit_date": None}, "visit_date"),
        ({"target_semester": 3}, "target_semester"),
        ({"target_school_year": 99}, "target_school_year"),
        ({"grade": "小一"}, "grade"),
        ({"no_deposit_reason": "其他"}, "no_deposit_reason"),
        ({"source_category": "tiktok"}, "source_category"),
        ({"address": "路" * 201}, "address"),
        ({"notes": "字" * (constants.TEXT_MAX + 1)}, "notes"),
        ({"notes": "含控制字元\x00"}, "notes"),
        ({"has_deposit": True}, "has_deposit"),
        ({"enrolled": True}, "enrolled"),
        ({"enrolled_on": "2026-09-08"}, "enrolled_on"),
        ({"withdrawn_at": "2026-09-08T00:00:00Z"}, "withdrawn_at"),
        ({"provisional_grade": "小班"}, "provisional_grade"),
        ({"month": "115.09"}, "month"),
        ({"seq_no": "7"}, "seq_no"),
        ({"district": "苓雅區"}, "district"),
    ],
)
async def test_create_rejects_invalid_and_state_fields(admin_client, change, field):
    """R02＋調整第 11 條：列舉外的值、超長、狀態欄位與後端算的欄位一律 422，loc 指到該欄位。"""
    response = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields(**change))
    assert response.status_code == 422, response.text
    assert any(field in loc for loc in _locations(response)), response.text


@pytest.mark.asyncio
async def test_tour_guide_must_exist_and_name_is_snapshotted(admin_client, db_session):
    missing = await admin_client.post(
        f"{RECORDS}?campus_key=yihua", json=manual_fields(tour_guide_user_id=str(uuid.uuid4()))
    )
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "TOUR_GUIDE_INVALID"

    guide = await _create_user(db_session, "guide-yihua@ivy.example", "guide-yihua-password-123", Role.RECEPTION, ["yihua"])
    guide.display_name = "林老師"
    await db_session.commit()
    snapshot = await create_record(admin_client, tour_guide_user_id=str(guide.id))
    assert (snapshot["tour_guide_user_id"], snapshot["tour_guide_name"]) == (str(guide.id), "林老師")
    typed = await create_record(admin_client, tour_guide_user_id=str(guide.id), tour_guide_name="林老師（代班）")
    assert typed["tour_guide_name"] == "林老師（代班）"


@pytest.mark.asyncio
async def test_paper_form_fields_round_trip_and_clear(admin_client):
    """2026-10-05 照園方紙本補的欄位：英文名、父母職業（官網延伸），以及畫面新放上來的
    帶參觀老師（只打名字）、來源分類、娃娃車。"""
    record = await create_record(
        admin_client, english_name="  Celeste  ", father_occupation="軍", mother_occupation="教師",
        tour_guide_name="Marvyna", source_category="sibling_current", rides_bus=True,
    )
    assert (record["english_name"], record["father_occupation"], record["mother_occupation"]) == ("Celeste", "軍", "教師")
    assert (record["tour_guide_user_id"], record["tour_guide_name"]) == (None, "Marvyna")
    assert (record["source_category"], record["rides_bus"]) == ("sibling_current", True)

    url = f"{RECORDS}/{record['id']}"
    cleared = await admin_client.patch(
        url,
        json={
            "expected_version": 1, "english_name": None, "father_occupation": "", "mother_occupation": None,
            "tour_guide_name": None, "source_category": None, "rides_bus": False,
        },
    )
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert [body[k] for k in ("english_name", "father_occupation", "mother_occupation", "tour_guide_name", "source_category")] == [None] * 5
    assert body["rides_bus"] is False

    for field, limit in (
        ("english_name", constants.LEN_ENGLISH_NAME),
        ("father_occupation", constants.LEN_OCCUPATION),
        ("mother_occupation", constants.LEN_OCCUPATION),
    ):
        too_long = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields(**{field: "長" * (limit + 1)}))
        assert too_long.status_code == 422, field
        assert ["body", field] in _locations(too_long)


@pytest.mark.asyncio
async def test_keyword_search_matches_english_name(admin_client):
    await create_record(admin_client, child_name="甲", english_name="Celeste")
    await create_record(admin_client, child_name="乙", english_name="Leo")
    response = await admin_client.get(f"{RECORDS}?campus_key=yihua&q=celeste")
    assert response.status_code == 200, response.text
    assert [row["child_name"] for row in response.json()] == ["甲"]


@pytest.mark.asyncio
async def test_options_lists_tour_guides_typed_before(admin_client):
    await create_record(admin_client, tour_guide_name="Marvyna")
    await create_record(admin_client, tour_guide_name="Marvyna")
    await create_record(admin_client, tour_guide_name="林老師")
    await create_record(admin_client, "minghua", tour_guide_name="明華老師")
    body = (await admin_client.get(f"{ADMISSIONS}/options?campus_key=yihua")).json()
    assert body["tour_guides"] == ["Marvyna", "林老師"]  # 次數多的在前、只看本校


@pytest.mark.asyncio
async def test_concurrent_creates_get_distinct_seq_numbers(admin_client):
    """R03：同校同月份並行新增，序號不重複（pg_advisory_xact_lock 排隊後再取最大值）。"""
    responses = await asyncio.gather(
        *(
            admin_client.post(
                f"{RECORDS}?campus_key=yihua", json=manual_fields(child_name=f"並行{n}", visit_date="2026-09-15")
            )
            for n in range(6)
        )
    )
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    assert sorted(int(r.json()["seq_no"]) for r in responses) == [1, 2, 3, 4, 5, 6]


@pytest.mark.asyncio
async def test_list_filters_and_paging(admin_client, db_session):
    a = await create_record(
        admin_client, child_name="甲", visit_date="2026-09-03", grade="小班", source="Facebook",
        referrer="林老師", no_deposit_reason="時程未到／仍在觀望",
    )
    b = await create_record(
        admin_client, child_name="乙", visit_date="2026-10-05", grade="中班", source="親友介紹",
        target_school_year=115, target_semester=2,
    )
    c = await create_record(admin_client, child_name="丙", visit_date="2026-09-20", notes="打折要 100% 確認")
    await create_record(admin_client, "minghua", child_name="丁", visit_date="2026-09-20")
    # 乙已預繳（狀態只能走轉換；這裡直接改資料庫，只測篩選）。甲連到一筆官網預約。
    request_id = await legacy_request(db_session, status="completed")
    await db_session.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(b["id"])).values(has_deposit=True))
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(a["id"])).values(visit_request_id=uuid.UUID(request_id))
    )
    await db_session.commit()

    async def names(query: str) -> list[str]:
        response = await admin_client.get(f"{RECORDS}?campus_key=yihua&{query}")
        assert response.status_code == 200, response.text
        return [row["child_name"] for row in response.json()]

    assert await names("") == ["乙", "丙", "甲"]  # 參觀日期新到舊
    assert await names("month=115.09") == ["丙", "甲"]
    assert await names("grade=小班") == ["甲"]
    assert await names("target_school_year=115&target_semester=2") == ["乙"]
    assert await names("source=Facebook") == ["甲"]
    assert await names("referrer=林老師") == ["甲"]
    assert await names("has_deposit=true") == ["乙"]
    assert await names("has_deposit=false") == ["丙", "甲"]
    assert await names("stage=deposited") == ["乙"]
    assert await names("stage=visited") == ["丙", "甲"]
    assert await names(f"no_deposit_reason={constants.NO_DEPOSIT_REASONS[0]}") == ["甲"]
    assert await names(f"visit_request_id={request_id}") == ["甲"]
    # 使用者打的 % 是字面值，不是萬用字元。
    assert await names("q=100%25") == ["丙"]
    assert await names("q=%25") == ["丙"]
    assert await names("page_size=2") == ["乙", "丙"]
    assert await names("page_size=2&page=2") == ["甲"]
    linked = (await admin_client.get(f"{RECORDS}/{a['id']}")).json()
    assert linked["has_visit_request"] is True and linked["visit_request_id"] == request_id
    assert c["has_visit_request"] is False
    for bad in ("month=115.9", "stage=lost", "grade=小一", "page_size=101", "target_semester=3"):
        assert (await admin_client.get(f"{RECORDS}?campus_key=yihua&{bad}")).status_code == 422, bad


@pytest.mark.asyncio
async def test_options_lists_months_sources_and_ivy_enums(admin_client):
    await create_record(admin_client, visit_date="2026-09-08", source="Facebook", referrer="林老師")
    await create_record(admin_client, visit_date="2026-10-02", source="Facebook", referrer="張老師")
    await create_record(admin_client, visit_date="2026-08-20", source="親友介紹")
    await create_record(admin_client, "minghua", visit_date="2026-07-01", source="明華限定", referrer="明華老師")

    response = await admin_client.get(f"{ADMISSIONS}/options?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["months"] == ["115.10", "115.09", "115.08"]
    assert body["sources"] == ["Facebook", "親友介紹"]  # 次數多的在前
    assert sorted(body["referrers"]) == ["張老師", "林老師"]
    assert body["grades"] == list(constants.GRADES)
    assert [r["value"] for r in body["no_deposit_reasons"]] == list(constants.NO_DEPOSIT_REASONS)
    priority = {r["value"]: r["priority"] for r in body["no_deposit_reasons"]}
    assert priority["時程未到／仍在觀望"] == "high"
    assert priority["費用考量"] == "medium"
    assert priority["特殊需求／名額限制"] == "low"
    assert priority["未註明／待追蹤"] is None
    assert list(body["source_categories"].items()) == list(constants.SOURCE_CATEGORIES.items())


@pytest.mark.asyncio
async def test_patch_uses_fields_set_and_optimistic_lock(admin_client, db_session):
    """R05 編輯部分：沒送的欄位不動、送 null 清空；後送的舊版本 409，資料不被覆蓋。"""
    record = await create_record(admin_client, notes="第一次", phone="0912345678")
    url = f"{RECORDS}/{record['id']}"
    updated = await admin_client.patch(url, json={"expected_version": 1, "notes": None, "referrer": "林老師"})
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert (body["notes"], body["referrer"], body["phone"], body["version"]) == (None, "林老師", "0912345678", 2)

    stale = await admin_client.patch(url, json={"expected_version": 1, "notes": "蓋掉別人的修改"})
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == 2
    assert (await admin_client.get(url)).json()["notes"] is None

    # 送了但值沒變：不加版本、不寫稽核。
    same = await admin_client.patch(url, json={"expected_version": 2, "referrer": "林老師"})
    assert same.status_code == 200 and same.json()["version"] == 2
    [entry] = await _audit(db_session, "recruitment_visit.update")
    assert sorted(entry.metadata_json["fields"]) == ["notes", "referrer"]
    assert set(entry.metadata_json) == {"fields"}


@pytest.mark.asyncio
async def test_patch_rejects_state_fields_and_clearing_required(admin_client):
    record = await create_record(admin_client)
    url = f"{RECORDS}/{record['id']}"
    for change, field in (
        ({"has_deposit": True}, "has_deposit"),
        ({"enrolled": True}, "enrolled"),
        ({"enrolled_on": "2026-09-30"}, "enrolled_on"),
        ({"withdrawn_from": "deposited"}, "withdrawn_from"),
        ({"withdraw_reason": "改送他校"}, "withdraw_reason"),
        ({"provisional_grade": "小班"}, "provisional_grade"),
        ({"month": "115.01"}, "month"),
        ({"seq_no": "9"}, "seq_no"),
        ({"version": 5}, "version"),
        ({"child_name": None}, "child_name"),
        ({"visit_date": None}, "visit_date"),
        ({"target_school_year": None}, "target_school_year"),
        ({"target_semester": None}, "target_semester"),
    ):
        response = await admin_client.patch(url, json={"expected_version": 1, **change})
        assert response.status_code == 422, (change, response.text)
        assert any(field in loc for loc in _locations(response)), response.text
    assert (await admin_client.patch(url, json={"notes": "沒帶版本"})).status_code == 422
    assert (await admin_client.get(url)).json()["version"] == 1


@pytest.mark.asyncio
async def test_patch_visit_date_moves_month_and_reassigns_seq(admin_client):
    september = await create_record(admin_client, visit_date="2026-09-08")
    october = await create_record(admin_client, visit_date="2026-10-02")
    moved = await admin_client.patch(f"{RECORDS}/{september['id']}", json={"expected_version": 1, "visit_date": "2026-10-20"})
    assert moved.status_code == 200, moved.text
    assert (moved.json()["month"], moved.json()["seq_no"]) == ("115.10", "2")
    assert october["seq_no"] == "1"


@pytest.mark.asyncio
async def test_delete_requires_version_and_cascades_events(admin_client, db_session):
    record = await create_record(admin_client)
    url = f"{RECORDS}/{record['id']}"
    stale = await admin_client.delete(f"{url}?expected_version=9")
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["current_version"] == 1
    gone = await admin_client.delete(f"{url}?expected_version=1")
    assert gone.status_code == 204, gone.text
    assert (await admin_client.get(url)).status_code == 404
    assert await db_session.scalar(select(func.count()).select_from(RecruitmentEventLog)) == 0
    [entry] = await _audit(db_session, "recruitment_visit.delete")
    assert (entry.target_id, entry.campus_key, entry.metadata_json) == (record["id"], "yihua", {"stage": "visited"})


@pytest.mark.asyncio
async def test_reception_writes_but_editor_and_readonly_get_403(
    admin_client, reception_yihua_client, editor_client, readonly_yihua_client
):
    """R06 讀取部分：editor、readonly 沒有招生權限，讀也是 403；接待可以新增與編輯。"""
    record = await create_record(admin_client)
    by_desk = await create_record(reception_yihua_client, child_name="櫃台建的")
    assert by_desk["seq_no"] == "2"
    edited = await reception_yihua_client.patch(f"{RECORDS}/{record['id']}", json={"expected_version": 1, "notes": "櫃台補記"})
    assert edited.status_code == 200, edited.text
    for client in (editor_client, readonly_yihua_client):
        for path in (
            f"{RECORDS}?campus_key=yihua",
            f"{RECORDS}/{record['id']}",
            f"{RECORDS}/{record['id']}/events",
            f"{ADMISSIONS}/options?campus_key=yihua",
        ):
            assert (await client.get(path)).status_code == 403, path
        assert (await client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields())).status_code == 403


@pytest.mark.asyncio
async def test_other_campus_and_unknown_ids_get_404(admin_client, minghua_client):
    """R07：分校帳號改 campus_key、用訪視 id 存取他校，一律 404。"""
    record = await create_record(admin_client)
    url = f"{RECORDS}/{record['id']}"
    assert (await minghua_client.get(url)).status_code == 404
    assert (await minghua_client.get(f"{url}/events")).status_code == 404
    assert (await minghua_client.patch(url, json={"expected_version": 1, "notes": "越權"})).status_code == 404
    assert (await minghua_client.delete(f"{url}?expected_version=1")).status_code == 404
    assert (await minghua_client.get(f"{RECORDS}?campus_key=yihua")).status_code == 404
    assert (await minghua_client.get(f"{ADMISSIONS}/options?campus_key=yihua")).status_code == 404
    assert (await minghua_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields())).status_code == 404
    assert (await admin_client.get(f"{RECORDS}/{uuid.uuid4()}")).status_code == 404
    assert (await admin_client.get(f"{RECORDS}?campus_key=nowhere")).status_code == 404
    assert (await admin_client.post(f"{RECORDS}?campus_key=nowhere", json=manual_fields())).status_code == 404
    assert (await create_record(minghua_client, "minghua"))["campus_key"] == "minghua"
    assert (await admin_client.get(url)).json()["notes"] is None


@pytest.mark.asyncio
async def test_stage_condition_matches_derive_stage(db_session):
    """規格 6.2：SQL 的 stage_condition 與 Python 的 derive_stage 規則相同（退出最優先）。"""
    now = datetime.now(timezone.utc)

    def visit(name: str, **state) -> RecruitmentVisit:
        return RecruitmentVisit(
            id=uuid.uuid4(), campus_key="yihua", month="115.09", visit_date=date(2026, 9, 8), child_name=name,
            created_at=now, updated_at=now, **state,
        )

    rows = [
        visit("訪"),
        visit("預", has_deposit=True),
        visit("註", has_deposit=True, enrolled=True, enrolled_on=date(2026, 9, 30)),
        visit("退預", withdrawn_at=now, withdrawn_from="deposited"),
        visit("退註", withdrawn_at=now, withdrawn_from="enrolled", enrolled=True, enrolled_on=date(2026, 9, 30)),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    assert [funnel.derive_stage(row) for row in rows] == ["visited", "deposited", "enrolled", "withdrawn", "withdrawn"]
    for stage in constants.STAGES:
        found = set(
            (await db_session.execute(select(RecruitmentVisit.child_name).where(funnel.stage_condition(stage)))).scalars()
        )
        assert found == {row.child_name for row in rows if funnel.derive_stage(row) == stage}, stage
    with pytest.raises(ValueError):
        funnel.stage_condition("lost")
    assert funnel.STAGE_VALUES == constants.STAGES


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_date", ["2001-05-01", "2010-12-31", "2112-01-01"])
async def test_visit_date_outside_roc_range_is_422(admin_client, bad_date):
    """visit_date 的民國年必須在 SCHOOL_YEAR_MIN～MAX（三位數），否則 month 會違反格式。"""
    created = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields(visit_date=bad_date))
    assert created.status_code == 422, created.text
    assert any(loc[-1] == "visit_date" for loc in _locations(created))
    record = await create_record(admin_client)
    patched = await admin_client.patch(f"{RECORDS}/{record['id']}", json={"expected_version": 1, "visit_date": bad_date})
    assert patched.status_code == 422, patched.text
    assert any(loc[-1] == "visit_date" for loc in _locations(patched))


@pytest.mark.asyncio
async def test_visit_date_roc_range_boundaries_pass(admin_client):
    low = await create_record(admin_client, visit_date="2011-01-01")
    high = await create_record(admin_client, visit_date="2111-12-31")
    assert (low["month"], high["month"]) == ("100.01", "200.12")
    moved = await admin_client.patch(f"{RECORDS}/{low['id']}", json={"expected_version": 1, "visit_date": "2011-02-01"})
    assert moved.status_code == 200 and moved.json()["month"] == "100.02"


@pytest.mark.asyncio
async def test_anonymized_visit_rejects_edit_transition_and_seat_but_can_be_deleted(admin_client, db_session):
    """F2：保存政策匿名化後，編輯、狀態轉換、保留座位一律 409 RECRUITMENT_VISIT_ANONYMIZED，
    資料與版本不動；刪除不擋。"""
    fresh = await create_record(admin_client, child_name="還沒匿名化")
    assert fresh["anonymized_at"] is None
    record = await record_at_stage(admin_client, "deposited")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    url = f"{RECORDS}/{record['id']}"
    current = (await admin_client.get(url)).json()
    assert current["anonymized_at"] is not None
    version = current["version"]
    seat = {"grade": "小班", "target_school_year": 115, "target_semester": 1, "expected_version": version}
    attempts = (
        lambda: admin_client.patch(url, json={"expected_version": version, "notes": "補記"}),
        lambda: admin_client.post(f"{url}/transition", json={"to_stage": "visited", "expected_version": version}),
        lambda: admin_client.post(f"{url}/seat", json=seat),
    )
    for attempt in attempts:
        response = await attempt()
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "RECRUITMENT_VISIT_ANONYMIZED"
        assert response.json()["detail"]["message"] == "這筆招生訪視已依保存政策匿名化，不能再修改"
    after = (await admin_client.get(url)).json()
    assert (after["version"], after["stage"], after["notes"], after["provisional_grade"]) == (version, "deposited", None, None)
    assert (await admin_client.delete(f"{url}?expected_version={version}")).status_code == 204


@pytest.mark.asyncio
async def test_deleting_enrolled_related_visit_needs_convert(
    admin_client, reception_yihua_client, campus_admin_yihua_client
):
    """F5：已註冊、或從已註冊退出的訪視，刪除除了 admissions.write 還要 admissions.convert（403）；
    版本先比對（409 在 403 之前，同狀態轉換）。已預繳、退預繳的接待照常可以刪。"""
    enrolled = await record_at_stage(admin_client, "enrolled", child_name="已註冊")
    withdrawn = await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="退註冊")
    deposited = await record_at_stage(admin_client, "deposited", child_name="已預繳")
    withdrawn_deposit = await record_at_stage(admin_client, "withdrawn", child_name="退預繳")

    async def delete(client, record: dict, version: int | None = None):
        return await client.delete(f"{RECORDS}/{record['id']}?expected_version={version or record['version']}")

    stale = await delete(reception_yihua_client, enrolled, version=enrolled["version"] + 5)
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    for record in (enrolled, withdrawn):
        denied = await delete(reception_yihua_client, record)
        assert denied.status_code == 403, denied.text
        assert (await admin_client.get(f"{RECORDS}/{record['id']}")).status_code == 200
    for record in (deposited, withdrawn_deposit):
        assert (await delete(reception_yihua_client, record)).status_code == 204
    for record in (enrolled, withdrawn):
        assert (await delete(campus_admin_yihua_client, record)).status_code == 204


def _same_moment_visits(count: int) -> list[RecruitmentVisit]:
    """參觀日期與建立時間完全相同、id 由小到大（也照這個順序寫入）的訪視。"""
    now = datetime.now(timezone.utc)
    return [
        RecruitmentVisit(
            id=uuid.UUID(int=n), campus_key="yihua", month="115.09", visit_date=date(2026, 9, 8),
            child_name=f"同時{n}", target_school_year=115, target_semester=1, created_at=now, updated_at=now,
        )
        for n in range(1, count + 1)
    ]


@pytest.mark.asyncio
async def test_list_order_is_stable_when_date_and_created_at_tie(admin_client, db_session):
    """F10：參觀日期與建立時間都相同時以 id 排定（大到小），分頁不重複、不遺漏。"""
    visits = _same_moment_visits(5)
    db_session.add_all(visits)
    await db_session.commit()
    expected = [str(visit.id) for visit in reversed(visits)]
    response = await admin_client.get(f"{RECORDS}?campus_key=yihua")
    assert [row["id"] for row in response.json()] == expected
    paged = []
    for page in (1, 2, 3):
        paged += (await admin_client.get(f"{RECORDS}?campus_key=yihua&page_size=2&page={page}")).json()
    assert [row["id"] for row in paged] == expected
