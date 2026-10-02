"""隱私權政策（privacy_policy）：payload 規則、發布阻擋、權限與公開輸出。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.schemas import PrivacyPolicyPayload
from tests.conftest import publish_booking_consent

API = "/api/website/v1"
ITEM = f"{API}/admin/content-items/privacy_policy"


def _payload(**changes) -> dict:
    base = {
        "title": "隱私權政策",
        "updated_on": "2026-10-03",
        "sections": [
            {
                "heading": "適用範圍",
                "body": "本政策適用本網站。\n\n- 條列一\n- 條列二\n詳見 https://policies.google.com/privacy",
            }
        ],
    }
    return {**base, **changes}


async def _save(client, **changes) -> dict:
    item = (await client.get(ITEM)).json()
    saved = await client.post(
        f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": _payload(**changes)}
    )
    assert saved.status_code == 201, saved.text
    return saved.json()["latest_revision"]


def test_registered_as_shared_only():
    assert CONTENT_KIND_REGISTRY["privacy_policy"].shared_only is True


def test_valid_payload_keeps_list_and_url_text_verbatim():
    payload = PrivacyPolicyPayload.model_validate(_payload())
    assert payload.sections[0].body.endswith("https://policies.google.com/privacy")
    assert payload.updated_on is not None


def test_draft_may_leave_updated_on_empty():
    assert PrivacyPolicyPayload.model_validate(_payload(updated_on=None)).updated_on is None


@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"title": "字" * 41},
        {"sections": []},
        {"sections": [{"heading": "x", "body": "段"}] * 21},
        {"sections": [{"heading": "", "body": "段"}]},
        {"sections": [{"heading": "   ", "body": "段"}]},
        {"sections": [{"heading": "字" * 61, "body": "段"}]},
        {"sections": [{"heading": "x", "body": "   "}]},
        {"sections": [{"heading": "x", "body": "javascript:alert(1)"}]},
        {"sections": [{"heading": "x", "body": "字" * 2001}]},
        {"title": "vbscript:x"},
        {"updated_on": "2026-02-30"},
        {"updated_on": "10/03/2026"},
    ],
)
def test_bad_payloads_are_rejected(changes):
    with pytest.raises(ValidationError):
        PrivacyPolicyPayload.model_validate(_payload(**changes))


@pytest.mark.asyncio
async def test_api_returns_422_for_bad_payload(admin_client):
    item = (await admin_client.get(ITEM)).json()
    response = await admin_client.post(
        f"{ITEM}/revisions",
        json={"expected_version": item["latest_version"], "payload": _payload(sections=[])},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_pending_marker_blocks_publish_with_count(admin_client):
    revision = await _save(
        admin_client,
        sections=[
            {"heading": "蒐集者", "body": "【待確認：登記名稱】"},
            {"heading": "保存", "body": "【待確認：天數】與【待確認：招生紀錄】"},
        ],
    )
    blocked = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CONTENT_NOT_READY"
    assert "3 處" in blocked.json()["detail"]["message"]
    assert "待確認" in blocked.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_pending_marker_in_title_blocks_publish(admin_client):
    revision = await _save(admin_client, title="【待確認：標題】")
    blocked = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_missing_updated_on_blocks_publish(admin_client):
    revision = await _save(admin_client, updated_on=None)
    blocked = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert blocked.status_code == 409
    assert "最後更新日期" in blocked.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_public_site_has_policy_only_after_publish(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)  # 先有一個 release，/public/site 才有內容可讀
    before = (await public_client.get(f"{API}/public/site")).json()
    assert "privacy_policy" not in before["content"]

    revision = await _save(admin_client)
    assert "privacy_policy" not in (await public_client.get(f"{API}/public/site")).json()["content"]

    published = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert published.status_code == 200, published.text
    after = (await public_client.get(f"{API}/public/site")).json()
    assert after["content"]["privacy_policy"] == _payload()


@pytest.mark.asyncio
async def test_draft_with_pending_marker_does_not_replace_published(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)
    good = await _save(admin_client)
    assert (await admin_client.post(f"{ITEM}/publish", json={"revision_id": good["id"]})).status_code == 200

    pending = await _save(admin_client, sections=[{"heading": "x", "body": "【待確認：補】"}])
    assert (await admin_client.post(f"{ITEM}/publish", json={"revision_id": pending["id"]})).status_code == 409
    live = (await public_client.get(f"{API}/public/site")).json()["content"]["privacy_policy"]
    assert live == _payload()


@pytest.mark.asyncio
async def test_editor_can_read_but_not_edit_shared_policy(editor_client):
    assert (await editor_client.get(ITEM)).status_code == 200
    item = (await editor_client.get(ITEM)).json()
    denied = await editor_client.post(
        f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": _payload()}
    )
    assert denied.status_code == 403
