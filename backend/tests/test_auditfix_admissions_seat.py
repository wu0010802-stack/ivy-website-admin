"""已退出的訪視不能釋放保留座位（2026-10-20 稽核 #06）。

退註冊刻意保留 provisional_grade，取消退出回已預繳時座位還在。/seat 只要 admissions.write，接待也有；
若允許對已退出的訪視釋放，接待就能改掉曾註冊訪視的座位，繞過「動到註冊紀錄要 convert」的規則。"""

from __future__ import annotations

import pytest

from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    record_at_stage,
    reception_yihua_client,
)

RECORDS = f"{ADMISSIONS}/records"


async def _release(client, record: dict):
    body = {"grade": None, "target_school_year": 115, "target_semester": 1, "expected_version": record["version"]}
    return await client.post(f"{RECORDS}/{record['id']}/seat", json=body)


@pytest.mark.asyncio
async def test_reception_cannot_release_seat_of_withdrawn_enrolled_visit(admin_client, reception_yihua_client):  # noqa: F811
    withdrawn = await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="退註冊")
    assert withdrawn["provisional_grade"] == "小班"

    response = await _release(reception_yihua_client, withdrawn)

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "SEAT_NOT_ALLOWED"
    assert response.json()["detail"]["message"] == "已退出的訪視不能變更座位，要調整請先取消退出"
    fresh = (await admin_client.get(f"{RECORDS}/{withdrawn['id']}")).json()
    assert fresh["provisional_grade"] == "小班" and fresh["version"] == withdrawn["version"]


@pytest.mark.asyncio
async def test_admin_also_cannot_release_seat_of_withdrawn_visit(admin_client):
    withdrawn = await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="退註冊")
    assert (await _release(admin_client, withdrawn)).status_code == 422
