"""2026-11-12 探索式 E2E 找到、11-13 修正的後端問題（來龍去脈見 README 11-13 段落）。

同一輪的 surrogate 500 與不存在的校區已由 fix/qa-report-20261112 修掉，測試在
test_request_id_and_error_codes.py、test_content_revisions.py，這裡不重複。"""
from __future__ import annotations

import uuid

import pytest

from app.booking import access_service
from tests.conftest import book_slot, open_manage
from tests.test_content_rules import _publish_raw

API = "/api/website/v1"


# ---------------------------------------------------------------------------
# 1. 網站標題與首頁兩個區塊標題清空：草稿照存，發布擋下（原本首頁會沒有 <title>）
# ---------------------------------------------------------------------------

_BLANK_TITLE_CASES = [
    ("site_meta", {"title": "  ", "description": "描述", "header_phone_number": "07-0000000"}, "網站標題不能空白"),
    ("home_about", {"title": "", "since_label": "1997", "body_text": "內文", "caption": "圖說"}, "標題不能空白"),
    ("home_campus_board", {"section_title": " ", "eyebrow": "五校", "note": ""}, "區塊標題不能空白"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "payload", "message"), _BLANK_TITLE_CASES, ids=[c[0] for c in _BLANK_TITLE_CASES])
async def test_blank_titles_save_as_draft_but_cannot_be_published(admin_client, kind, payload, message):
    item = (await admin_client.get(f"{API}/admin/content-items/{kind}")).json()
    saved = await admin_client.post(
        f"{API}/admin/content-items/{kind}/revisions",
        json={"expected_version": item["latest_version"], "payload": payload},
    )
    assert saved.status_code == 201, saved.text

    published = await admin_client.post(
        f"{API}/admin/content-items/{kind}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )

    assert published.status_code == 409, published.text
    assert message in published.json()["detail"]["message"]


# ---------------------------------------------------------------------------
# 2. 已拿掉的欄位（頁首電話備註、關於頁結尾、場景說明）：新版本不帶，已發布的舊版本公開輸出也剔除
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retired_fields_are_dropped_on_save_and_from_old_published_versions(admin_client, public_client, db_session):
    await _publish_raw(
        db_session, "site_meta", None,
        {"title": "常春藤", "description": "描述", "header_phone_number": "07-0000000", "header_phone_note": "週一至週五"},
    )
    await _publish_raw(
        db_session, "campus_tour", "yihua",
        {"scenes": [{"key": "hall", "name": "大廳", "image": "campus", "intro": "舊的場景說明"}]},
    )

    content = (await public_client.get(f"{API}/public/site")).json()["content"]
    assert content["site_meta"]["header_phone_number"] == "07-0000000"
    assert "header_phone_note" not in content["site_meta"]
    [scene] = content["campus_tour"]["yihua"]["scenes"]
    assert scene["name"] == "大廳" and "intro" not in scene

    # 新存的版本不帶已拿掉的欄位（舊值照原規則驗證）。
    tour = (await admin_client.get(f"{API}/admin/content-items/campus_tour?campus_key=yihua")).json()
    saved = await admin_client.post(
        f"{API}/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": tour["latest_version"], "payload": {"scenes": [{"key": "hall", "name": "大廳", "image": "campus", "intro": "說明"}]}},
    )
    assert saved.status_code == 201, saved.text
    assert all("intro" not in scene for scene in saved.json()["latest_revision"]["payload"]["scenes"])
    unsafe = await admin_client.post(
        f"{API}/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": tour["latest_version"] + 1, "payload": {"scenes": [{"key": "hall", "name": "大廳", "image": "campus", "intro": "javascript:alert(1)"}]}},
    )
    assert unsafe.status_code == 422


# ---------------------------------------------------------------------------
# 3. 沒設定寄信時，家長改 Email 不撤銷管理連結（那條連結只顯示在畫面上，換發的新連結寄不出去）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_parent_changing_email_keeps_the_only_link_when_mail_is_off(app, admin_client, public_client, second_public_client):
    assert not app.state.settings.real_email_enabled
    booked = await book_slot(admin_client, public_client, email="typo@example.com", idempotency_key="mail-off-email-change")
    receipt = booked["receipt_id"]
    await open_manage(public_client, booked["manage_path"])

    response = await public_client.patch(
        f"{API}/public/visit-manage/me",
        json={"visit_request_id": receipt, "expected_version": 1, "email": "right@example.com"},
    )

    assert response.status_code == 200, response.text
    async with app.state.session_factory() as db:
        current = await access_service.current_manage_path(db, uuid.UUID(receipt), secret=app.state.settings.session_secret)
    assert current == booked["manage_path"], "收藏的那條連結要繼續有效"
    again = await second_public_client.post(
        f"{API}/public/visit-manage/exchange", json={"token": booked["manage_path"].split("token=", 1)[1]}
    )
    assert again.status_code == 200, again.text
