"""附近同業收費端點與托嬰清單的新欄位（2026-10-15 規格 §6）。"""

from __future__ import annotations

import pytest
from sqlalchemy import update

from app.admissions.geo.models import GeoBabycare
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.geo_helpers import load_babycare_sample
from tests.peer_fees_helpers import peers  # noqa: F401

FEES = f"{AREA}/fees"


async def test_fees_endpoint(admin_client, peers):
    response = await admin_client.get(f"{FEES}?campus_key=yihua&radius_km=3&age=3")
    assert response.status_code == 200
    body = response.json()
    assert (body["age"], body["radius_km"], body["school_year"], body["own"]["semester_total"]) == (3, 3, 114, 89750)
    assert body["groups"][0] == {
        "kind": "private", "schools": 4, "with_fee": 3, "median": 75000, "lowest": 40200, "highest": 93000,
        "own_rank": 2, "rank_total": 4,
    }
    assert body["own"]["items"]["materials"] == 24750
    assert body["source_note"] == "資料來源：全國教保資訊網（kiang 整理），園所公告收費"


async def test_fees_defaults_to_three_km_and_three_years_old(admin_client, peers):
    body = (await admin_client.get(f"{FEES}?campus_key=yihua")).json()
    assert (body["radius_km"], body["age"]) == (3, 3)


@pytest.mark.parametrize("age", ["1", "6", "abc", "3.5", ""])
async def test_bad_age(admin_client, peers, age):
    response = await admin_client.get(f"{FEES}?campus_key=yihua&age={age}")
    assert response.status_code == 422
    detail = response.json()["detail"]  # 錯誤本文另帶 request_id，只比業務欄位
    assert (detail["code"], detail["message"]) == ("INVALID_AGE", "年齡只能是 2 到 5 歲")


@pytest.mark.parametrize("radius", ["2", "abc"])
async def test_bad_radius(admin_client, peers, radius):
    response = await admin_client.get(f"{FEES}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422 and response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_permissions(reception_yihua_client, editor_client, minghua_client, public_client, peers):
    assert (await reception_yihua_client.get(f"{FEES}?campus_key=yihua")).status_code == 200
    assert (await editor_client.get(f"{FEES}?campus_key=yihua")).status_code == 403
    assert (await minghua_client.get(f"{FEES}?campus_key=yihua")).status_code == 404
    assert (await public_client.get(f"{FEES}?campus_key=yihua&age=abc")).status_code == 401  # 登入檢查在年齡檢查之前


async def test_babycare_endpoint_has_fees(admin_client, db_session, peers):
    await load_babycare_sample(db_session)
    await db_session.execute(update(GeoBabycare).values(monthly_fee=17900, evaluation_grade="優等", evaluation_year=114, quasi_public=True))
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}/babycare?campus_key=yihua")).json()
    first = body["items"][0]
    assert (first["monthly_fee"], first["evaluation_grade"], first["evaluation_year"], first["quasi_public"]) == (17900, "優等", 114, True)
    assert (body["summary"]["fee_median"], body["summary"]["own_age2_monthly"], body["summary"]["fee_school_year"]) == (17900, 19264, 114)
