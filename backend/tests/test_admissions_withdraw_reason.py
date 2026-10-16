"""退出原因分類（docs/specs/2026-10-15-withdraw-reason-category-design.md）。

Task 4：轉換與補分類。Task 5 在檔尾加篩選、統計、匯出與匿名化。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import constants, export, retention
from app.admissions.models import RecruitmentVisit
from tests.admissions_helpers import ADMISSIONS, create_record, manual_fields, record_at_stage, transition

RECORDS = f"{ADMISSIONS}/records"
FEE = "費用考量"
# record_at_stage(..., "withdrawn") 一律用這個分類、說明「家長改送他校」（tests/admissions_helpers.py）。
HELPER_CATEGORY = "改讀其他私立幼兒園"


async def _post(client, record: dict, to_stage: str, **fields):
    return await client.post(
        f"{RECORDS}/{record['id']}/transition",
        json={"to_stage": to_stage, "expected_version": record["version"], **fields},
    )


async def _events(client, record: dict, event_type: str) -> list[dict]:
    return [e for e in (await client.get(f"{RECORDS}/{record['id']}/events")).json() if e["event_type"] == event_type]


async def _unclassify(db_session, record: dict) -> None:
    """模擬改版前就退出的舊資料：分類是 NULL。"""
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).values(withdraw_reason_category=None)
    )
    await db_session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("start", ["deposited", "enrolled"])
async def test_withdraw_requires_category_and_reason_is_optional(admin_client, start):
    record = await record_at_stage(admin_client, start)
    missing = await _post(admin_client, record, "withdrawn", reason="家長改送他校")
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
    assert missing.json()["detail"]["fields"] == ["withdraw_reason_category"]
    assert missing.json()["detail"]["message"] == "請填寫：退出原因"
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]

    done = await _post(admin_client, record, "withdrawn", withdraw_reason_category=FEE)
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["stage"], body["withdraw_reason_category"], body["withdraw_reason"]) == ("withdrawn", FEE, None)
    [event] = await _events(admin_client, record, "withdrawn")
    assert (event["metadata_json"], event["reason"]) == ({"withdraw_reason_category": FEE}, None)


@pytest.mark.asyncio
async def test_unknown_category_is_422(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    assert (await _post(admin_client, record, "withdrawn", withdraw_reason_category="其他")).status_code == 422
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["withdrawn_at"] is None
    assert (await _post(admin_client, record, "withdrawn", withdraw_reason_category=FEE)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("to_stage", ["deposited", "visited"])
async def test_revert_from_enrolled_still_requires_text_reason(admin_client, to_stage):
    record = await record_at_stage(admin_client, "enrolled")
    response = await _post(admin_client, record, to_stage, withdraw_reason_category=FEE)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["fields"] == ["reason"]


@pytest.mark.asyncio
async def test_cancel_withdrawal_clears_category_and_withdrawing_again_needs_a_new_one(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    withdrawn = await transition(admin_client, record, "withdrawn", withdraw_reason_category=FEE, reason="學費")
    back = await transition(admin_client, withdrawn, "deposited")
    assert (back["withdraw_reason_category"], back["withdraw_reason"]) == (None, None)
    again = await _post(admin_client, back, "withdrawn")
    assert again.status_code == 422 and again.json()["detail"]["fields"] == ["withdraw_reason_category"]


@pytest.mark.asyncio
async def test_patch_can_classify_a_withdrawn_visit_and_records_history(admin_client, db_session):
    record = await record_at_stage(admin_client, "withdrawn")
    await _unclassify(db_session, record)
    legacy = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert legacy["withdraw_reason_category"] is None
    response = await admin_client.patch(
        f"{RECORDS}/{record['id']}",
        json={
            "expected_version": legacy["version"],
            "withdraw_reason_category": "搬家／距離因素",
            "contact_name": "陳爸爸",
            "phone": "0912345678",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["withdraw_reason_category"] == "搬家／距離因素"
    [event] = await _events(admin_client, record, "details_updated")
    assert event["metadata_json"] == {"fields": ["contact_name", "phone", "withdraw_reason_category"]}
    assert (event["from_stage"], event["to_stage"]) == ("withdrawn", "withdrawn")
    assert event["reason"] is None
    history = json.dumps((await admin_client.get(f"{RECORDS}/{record['id']}/events")).json(), ensure_ascii=False)
    assert "陳爸爸" not in history and "0912345678" not in history


@pytest.mark.asyncio
async def test_patch_category_on_a_visit_that_has_not_withdrawn_is_422(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    response = await admin_client.patch(
        f"{RECORDS}/{record['id']}", json={"expected_version": record["version"], "withdraw_reason_category": FEE}
    )
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]  # 錯誤本文會另外帶 request_id（app/main.py _error_body）
    assert (detail["code"], detail["message"]) == ("RECRUITMENT_NOT_WITHDRAWN", "只有已退出的訪視可以設定退出原因分類")
    unchanged = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (unchanged["version"], unchanged["withdraw_reason_category"]) == (record["version"], None)
    assert await _events(admin_client, record, "details_updated") == []
    # 對照：同一筆退出之後就能補分類。
    withdrawn = await transition(admin_client, record, "withdrawn", withdraw_reason_category="搬家／距離因素")
    ok = await admin_client.patch(
        f"{RECORDS}/{record['id']}", json={"expected_version": withdrawn["version"], "withdraw_reason_category": FEE}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["withdraw_reason_category"] == FEE


@pytest.mark.asyncio
async def test_patch_cannot_clear_category(admin_client):
    record = await record_at_stage(admin_client, "withdrawn")
    cleared = await admin_client.patch(
        f"{RECORDS}/{record['id']}", json={"expected_version": record["version"], "withdraw_reason_category": None}
    )
    assert cleared.status_code == 422
    kept = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (kept["version"], kept["withdraw_reason_category"]) == (record["version"], HELPER_CATEGORY)
    assert await _events(admin_client, record, "details_updated") == []


@pytest.mark.asyncio
async def test_create_does_not_accept_category(admin_client):
    rejected = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields(withdraw_reason_category=FEE))
    assert rejected.status_code == 422
    accepted = await admin_client.post(f"{RECORDS}?campus_key=yihua", json=manual_fields())
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["withdraw_reason_category"] is None


# ---- Task 5：篩選、統計、匯出、匿名化 ----


@pytest.mark.asyncio
async def test_records_filter_by_category_and_unclassified(admin_client, db_session):
    fee = await record_at_stage(admin_client, "deposited", child_name="費用")
    await transition(admin_client, fee, "withdrawn", withdraw_reason_category=FEE)
    await record_at_stage(admin_client, "withdrawn", child_name="改讀")
    legacy = await record_at_stage(admin_client, "withdrawn", child_name="舊資料")
    await _unclassify(db_session, legacy)
    await create_record(admin_client, child_name="還在")

    async def names(value: str) -> set[str]:
        response = await admin_client.get(RECORDS, params={"campus_key": "yihua", "withdraw_reason_category": value})
        assert response.status_code == 200, response.text
        return {row["child_name"] for row in response.json()}

    assert await names(FEE) == {"費用"}
    assert await names(HELPER_CATEGORY) == {"改讀"}
    assert await names(constants.WITHDRAW_UNCLASSIFIED) == {"舊資料"}
    # 正向對照：沒帶篩選時四筆都在，上面三個結果才是篩出來的。
    everyone = await admin_client.get(RECORDS, params={"campus_key": "yihua"})
    assert {row["child_name"] for row in everyone.json()} == {"費用", "改讀", "舊資料", "還在"}
    bad = await admin_client.get(RECORDS, params={"campus_key": "yihua", "withdraw_reason_category": "其他"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_stats_withdraw_reasons_by_category_and_side(admin_client, db_session):
    deposited = await record_at_stage(admin_client, "deposited", child_name="甲")
    await transition(admin_client, deposited, "withdrawn", withdraw_reason_category=FEE)
    await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="乙")
    legacy = await record_at_stage(admin_client, "withdrawn", child_name="丙")
    await _unclassify(db_session, legacy)
    await record_at_stage(admin_client, "withdrawn", child_name="下學期", target_semester=2)  # 頁首選上學期時不算
    await record_at_stage(admin_client, "withdrawn", child_name="下學年", target_school_year=116)  # 頁首選 115 時不算
    await record_at_stage(admin_client, "withdrawn", campus_key="minghua", child_name="明華的")
    await create_record(admin_client, child_name="沒退出")

    async def body(**scope) -> dict:
        response = await admin_client.get(f"{ADMISSIONS}/stats", params={"campus_key": "yihua", **scope})
        assert response.status_code == 200, response.text
        return response.json()

    first_term = await body(school_year=115, semester=1)
    assert [row["reason"] for row in first_term["withdraw_reasons"]] == [*constants.WITHDRAW_REASON_CATEGORIES, "未分類"]
    rows = {row["reason"]: row for row in first_term["withdraw_reasons"]}
    assert rows[FEE] == {"reason": FEE, "deposited": 1, "enrolled": 0, "total": 1}
    assert rows[HELPER_CATEGORY] == {"reason": HELPER_CATEGORY, "deposited": 0, "enrolled": 1, "total": 1}
    assert rows["未分類"] == {"reason": "未分類", "deposited": 1, "enrolled": 0, "total": 1}
    # 其餘六項沒有人退，但列還在（0 筆）。
    zero_rows = [row for name, row in rows.items() if name not in (FEE, HELPER_CATEGORY, "未分類")]
    assert len(zero_rows) == 6
    assert all((row["deposited"], row["enrolled"], row["total"]) == (0, 0, 0) for row in zero_rows)
    assert first_term["withdraw_total"] == 3

    # 正向對照：換成下學期、116 學年就會看到剛才被擋在範圍外的那一筆，其他校的退出始終不算。
    second_term = await body(school_year=115, semester=2)
    assert second_term["withdraw_total"] == 1
    assert {row["reason"]: row["total"] for row in second_term["withdraw_reasons"]}[HELPER_CATEGORY] == 1
    next_year = await body(school_year=116, semester=1)
    assert next_year["withdraw_total"] == 1
    minghua = await admin_client.get(f"{ADMISSIONS}/stats", params={"campus_key": "minghua", "school_year": 115, "semester": 1})
    assert minghua.json()["withdraw_total"] == 1


@pytest.mark.asyncio
async def test_export_composes_withdraw_reason_and_extension(admin_client, db_session):
    only_category = await record_at_stage(admin_client, "deposited", child_name="只有分類")
    await transition(admin_client, only_category, "withdrawn", withdraw_reason_category=FEE)
    both = await record_at_stage(admin_client, "withdrawn", child_name="兩者都有")
    legacy = await record_at_stage(admin_client, "withdrawn", child_name="舊資料")
    await _unclassify(db_session, legacy)
    stay = await create_record(admin_client, child_name="沒退出")

    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    columns = {row["website_id"]: row["columns"] for row in result["recruitment_visits"]}
    extensions = {row["website_id"]: row for row in result["extensions"]}
    assert columns[only_category["id"]]["withdraw_reason"] == FEE
    assert columns[both["id"]]["withdraw_reason"] == f"{HELPER_CATEGORY}：家長改送他校"
    assert columns[legacy["id"]]["withdraw_reason"] == "家長改送他校"
    assert columns[stay["id"]]["withdraw_reason"] is None
    assert "withdraw_reason_category" not in columns[both["id"]]  # 園務欄位不能多
    assert extensions[only_category["id"]]["withdraw_reason_category"] == FEE
    assert extensions[both["id"]]["withdraw_reason_category"] == HELPER_CATEGORY
    assert extensions[legacy["id"]]["withdraw_reason_category"] is None
    assert extensions[stay["id"]]["withdraw_reason_category"] is None
    [withdrawn] = [
        row for row in result["recruitment_event_log"]
        if row["mapping"]["recruitment_visit_website_id"] == only_category["id"] and row["columns"]["event_type"] == "withdrawn"
    ]
    assert withdrawn["columns"]["metadata_json"]["withdraw_reason_category"] == FEE


def test_withdraw_reason_text_composes_category_and_detail():
    assert export.withdraw_reason_text(FEE, "太貴") == f"{FEE}：太貴"
    assert export.withdraw_reason_text(FEE, None) == FEE
    assert export.withdraw_reason_text(None, "太貴") == "太貴"
    assert export.withdraw_reason_text(None, None) is None
    # 空字串視同沒有（說明欄不會存空字串，但別在匯出組出「分類：」）。
    assert export.withdraw_reason_text(FEE, "") == FEE
    assert export.withdraw_reason_text("", "") is None


@pytest.mark.asyncio
async def test_anonymization_keeps_category_and_clears_detail(admin_client, db_session):
    record = await record_at_stage(admin_client, "withdrawn", child_name="王小明")
    before = await export.export_campus(db_session, "yihua", tenant_id=1)
    [exported_before] = [r for r in before["recruitment_visits"] if r["website_id"] == record["id"]]
    assert exported_before["columns"]["withdraw_reason"] == f"{HELPER_CATEGORY}：家長改送他校"

    assert await retention.anonymize_due(db_session, 1, now=datetime.now(timezone.utc) + timedelta(days=2)) >= 1
    await db_session.commit()
    visit = await db_session.scalar(
        select(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).execution_options(populate_existing=True)
    )
    assert (visit.withdraw_reason_category, visit.withdraw_reason) == (HELPER_CATEGORY, None)
    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    [row] = [r for r in result["recruitment_visits"] if r["website_id"] == record["id"]]
    assert row["columns"]["withdraw_reason"] == HELPER_CATEGORY
