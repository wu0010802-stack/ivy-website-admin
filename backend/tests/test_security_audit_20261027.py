"""2026-10-27 資安稽核的回歸測試。"""

from __future__ import annotations

import json
import time
import uuid
from urllib.parse import quote

import pytest

from app.auth.models import Role

BASE = "/api/website/v1"


def _search_header(**fields) -> dict[str, str]:
    return {"X-Ivy-Search": quote(json.dumps(fields, ensure_ascii=False), safe="")}


# ---------------------------------------------------------------------------
# 公開點擊事件：校區代碼含控制字元或亂打，不碰 DB、不回 500
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("campus_key", ["\u0000", "yihua\u0000", "nope", "x" * 33])
async def test_click_event_with_bad_campus_key_is_rejected_not_a_500(public_client, campus_key):
    response = await public_client.post(
        f"{BASE}/public/analytics-events",
        json={"event_type": "cta_click_line", "campus_key": campus_key, "event_id": str(uuid.uuid4())},
    )
    assert response.status_code in (404, 422), response.text


# ---------------------------------------------------------------------------
# 素材上傳：沒有 media.manage 的帳號在讀本文之前就被擋
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [Role.READONLY, Role.RECEPTION])
async def test_media_upload_without_media_manage_is_rejected_before_reading_body(app, db_session, role):
    from tests.conftest import _create_user, _logged_in_client

    email = f"{role.value}-upload@ivy.example"
    await _create_user(db_session, email, "upload-password-123", role, campus_keys=["yihua"])
    client = await _logged_in_client(app, email, "upload-password-123")
    try:
        # 宣稱的大小超過一般 JSON 上限、沒超過素材上限：舊版會放行並把本文整份讀完才 403。
        response = await client.post(
            f"{BASE}/admin/media",
            content=b"x" * 16,
            headers={"Content-Type": "multipart/form-data; boundary=x", "Content-Length": str(5 * 1024 * 1024)},
        )
        assert response.status_code == 403, response.text
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# 操作紀錄：搜尋詞改走 header
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_log_reads_search_terms_from_header(admin_client):
    path = f"{BASE}/admin/audit-log"
    everything = await admin_client.get(path)
    assert everything.status_code == 200, everything.text
    assert everything.json(), "登入本身就會留紀錄"

    miss = await admin_client.get(path, headers=_search_header(q=["no-such-term-20261027"]))
    assert miss.status_code == 200, miss.text
    assert miss.json() == []
    # header 優先於查詢參數；多個詞任一符合就列出。
    hit = await admin_client.get(
        path, params={"q": "no-such-term-20261027"}, headers=_search_header(q=["no-such-term-20261027", "user.login"])
    )
    assert hit.status_code == 200, hit.text
    assert hit.json()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fields",
    [
        {"q": "user.login"},
        {"q": [1]},
        {"q": ["a" * 101]},
        {"q": ["x"] * 31},
        {"q": ["\u0000"]},
        {"other": ["x"]},
    ],
)
async def test_malformed_audit_search_header_is_rejected(admin_client, fields):
    response = await admin_client.get(f"{BASE}/admin/audit-log", headers=_search_header(**fields))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/admin/audit-log", "/admin/visit-requests?campus_key=yihua"])
async def test_deeply_nested_search_header_is_rejected_not_a_500(admin_client, path):
    nested = '{"q":' + "[" * 12000 + "]" * 12000 + "}"
    response = await admin_client.get(f"{BASE}{path}", headers={"X-Ivy-Search": nested})
    assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# 家長改資料：每案每日上限在案件列鎖內重數
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_parent_edit_limit_is_counted_inside_the_case_lock(admin_client, public_client, db_session):
    """路由上的限流器只看不記、成功後才記；併發送出的修改都會先通過那一關。
    這裡直接寫入 10 筆家長改資料的歷程（限流器的桶是空的），鎖內重數要擋下第 11 次。"""
    from app.booking import access_service, history, workflow_service
    from tests.conftest import book_slot, open_manage

    booked = await book_slot(admin_client, public_client, idempotency_key="sec1027-edit-limit")
    await open_manage(public_client, booked["manage_path"])
    receipt = uuid.UUID(booked["receipt_id"])
    for _ in range(access_service.PARENT_EDITS_PER_DAY):
        history.record_event(db_session, receipt, "details_updated", actor=history.PARENT, after={"fields": ["parent_name"]})
    await db_session.commit()
    version = await workflow_service.details_version(db_session, receipt)

    response = await public_client.patch(
        f"{BASE}/public/visit-manage/me",
        json={"visit_request_id": str(receipt), "expected_version": version, "parent_name": "第十一次"},
    )
    assert response.status_code == 429, response.text
    assert response.json()["detail"]["code"] == "RATE_LIMITED"


# ---------------------------------------------------------------------------
# 密碼錯誤：帳號存不存在，失敗這一步都至少花同樣的時間
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_password_failure_for_unknown_email_takes_the_minimum_time(app, db_session):
    from app.auth import service

    started = time.monotonic()
    await service.record_password_failure(
        db_session,
        app.state.rate_limiter,
        "nobody-20261027@ivy.example",
        None,
        reason="wrong_password",
        context="login",
    )
    assert time.monotonic() - started >= service.PASSWORD_FAILURE_MIN_SECONDS
