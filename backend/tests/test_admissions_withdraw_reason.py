"""退出原因分類（docs/specs/2026-10-15-withdraw-reason-category-design.md）。

Task 4：轉換與補分類。Task 5 在檔尾加篩選、統計、匯出與匿名化。"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import update

from app.admissions.models import RecruitmentVisit
from tests.admissions_helpers import ADMISSIONS, manual_fields, record_at_stage, transition

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
