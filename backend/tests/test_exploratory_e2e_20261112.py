"""2026-11-12 全專案探索式 E2E 找到、已修正的後端問題（各條的來龍去脈見 README 同日段落）。"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.booking import access_service
from app.content.models import ContentItem
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, open_manage, set_booking_mode
from tests.test_content_rules import _publish_raw

API = "/api/website/v1"


# ---------------------------------------------------------------------------
# 1. 孤立的 UTF-16 surrogate：原本 422 的回應本身編不出 UTF-8，變成 500 並寫進 error_groups
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validation_error_with_a_lone_surrogate_is_422_not_500(public_client):
    response = await public_client.post(
        VISIT_SUBMIT_PATH,
        content=b'{"parent_name":"\\ud800"}',
        headers={"content-type": "application/json", "Idempotency-Key": f"surrogate-{uuid.uuid4()}"},
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail and all("input" not in error for error in detail), "422 不回傳呼叫端送來的原值"
    assert all({"loc", "msg", "type"} <= set(error) for error in detail)


@pytest.mark.asyncio
async def test_a_complete_booking_with_a_lone_surrogate_is_rejected_before_the_database(admin_client, public_client):
    slot_id = await create_slot(admin_client, "yihua", days_ahead=3)
    mode = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert mode.status_code == 200, mode.text

    response = await public_client.post(
        VISIT_SUBMIT_PATH,
        json={
            "campus_key": "yihua", "config_version": mode.json()["version"], "slot_id": slot_id,
            "parent_name": "陳\ud800媽媽", "phone": "0912345678", "consent_given": True,
        },
        headers={"Idempotency-Key": f"surrogate-full-{slot_id}"},
    )

    assert response.status_code == 422, response.text
    assert any(error["loc"][-1] == "parent_name" for error in response.json()["detail"])


# ---------------------------------------------------------------------------
# 2. 不存在的校區：content-items 原本一路寫到外鍵才 500（campus_tour 連分校角色都打得到）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["campus_profile", "campus_news", "campus_tour"])
async def test_unknown_campus_key_is_404_for_every_content_route(admin_client, db_session, kind):
    for path in (
        f"{API}/admin/content-items/{kind}?campus_key=nope",
        f"{API}/admin/content-items/{kind}/revisions?campus_key=nope",
        f"{API}/admin/content-items/{kind}/schedules?campus_key=nope",
    ):
        response = await admin_client.get(path)
        assert response.status_code == 404, (path, response.text)
        assert response.json()["detail"]["code"] == "CAMPUS_NOT_FOUND"
    saved = await admin_client.post(
        f"{API}/admin/content-items/{kind}/revisions?campus_key=nope", json={"expected_version": 0, "payload": {}}
    )
    assert saved.status_code == 404, saved.text

    count = await db_session.scalar(select(func.count()).select_from(ContentItem).where(ContentItem.campus_key == "nope"))
    assert count == 0


@pytest.mark.asyncio
async def test_scoped_role_gets_404_not_500_on_hq_managed_campus_tour(editor_client):
    response = await editor_client.get(f"{API}/admin/content-items/campus_tour?campus_key=nope")
    assert response.status_code == 404, response.text


# ---------------------------------------------------------------------------
# 3. 網站標題與首頁兩個區塊標題清空：草稿照存，發布擋下（原本首頁會沒有 <title>）
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
# 4. 已拿掉的欄位（頁首電話備註、關於頁結尾、場景說明）：新版本不帶，已發布的舊版本公開輸出也剔除
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
# 5. 沒設定寄信時，家長改 Email 不撤銷管理連結（那條連結只顯示在畫面上，換發的新連結寄不出去）
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
