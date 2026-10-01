"""招生入學測試共用的資料與帳號（A3 建立；A4 加 transition，A6 加已開始場次的預約）。

- 手動新增訪視的最小欄位、用 API 建一筆訪視。
- 各角色的義華帳號 client。測試檔用
  `from tests.admissions_helpers import reception_yihua_client  # noqa: F401`
  匯入 fixture（pytest 認得模組裡匯入的 fixture）。
- 同校同手機 10 分鐘內最多送 5 筆預約（SUBMIT_LIMIT_BY_PHONE），建預約一律用
  unique_phone() 換號碼。"""

from __future__ import annotations

import itertools

import pytest_asyncio

from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
ADMISSIONS = f"{API}/admin/admissions"

_PHONES = itertools.count(30_000_001)


def unique_phone() -> str:
    """09 開頭 10 碼，每次呼叫都不同。"""
    return f"09{next(_PHONES):08d}"


def manual_fields(**overrides) -> dict:
    """手動新增訪視的必填欄位（規格 6.1 第 3 點）：參觀日期、幼生姓名、生日、入學學年學期。"""
    body = {
        "visit_date": "2026-09-08",
        "child_name": "王小明",
        "birthday": "2023-03-02",
        "target_school_year": 115,
        "target_semester": 1,
    }
    body.update(overrides)
    return body


async def create_record(client, campus_key: str = "yihua", **overrides) -> dict:
    response = await client.post(f"{ADMISSIONS}/records?campus_key={campus_key}", json=manual_fields(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


async def _staff_client(app, db_session, email: str, role: Role):
    password = f"{email.split('@')[0]}-password-123"
    await _create_user(db_session, email, password, role, ["yihua"])
    return await _logged_in_client(app, email, password)


@pytest_asyncio.fixture
async def campus_admin_yihua_client(app, db_session):
    client = await _staff_client(app, db_session, "admissions-admin-yihua@ivy.example", Role.CAMPUS_ADMIN)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def reception_yihua_client(app, db_session):
    client = await _staff_client(app, db_session, "admissions-reception-yihua@ivy.example", Role.RECEPTION)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def readonly_yihua_client(app, db_session):
    client = await _staff_client(app, db_session, "admissions-readonly-yihua@ivy.example", Role.READONLY)
    yield client
    await client.aclose()


async def transition(client, record: dict, to_stage: str, **fields) -> dict:
    """帶目前版本送一次狀態轉換，回傳轉換後的訪視。"""
    response = await client.post(
        f"{ADMISSIONS}/records/{record['id']}/transition",
        json={"to_stage": to_stage, "expected_version": record["version"], **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def record_at_stage(
    client, stage: str, *, withdrawn_from: str = "deposited", campus_key: str = "yihua", **overrides
) -> dict:
    """用 API 建一筆訪視並推到指定階段。已註冊一律是 115 學年上學期小班；
    withdrawn 依 withdrawn_from 從已預繳或已註冊退出，原因「家長改送他校」。"""
    record = await create_record(client, campus_key, **overrides)
    if stage == "visited":
        return record
    record = await transition(client, record, "deposited")
    if stage == "deposited":
        return record
    if stage == "enrolled" or withdrawn_from == "enrolled":
        record = await transition(
            client, record, "enrolled", grade="小班", target_school_year=115, target_semester=1, enrolled_on="2026-09-30"
        )
        if stage == "enrolled":
            return record
    return await transition(client, record, "withdrawn", reason="家長改送他校")
