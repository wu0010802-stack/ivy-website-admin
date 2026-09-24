"""校園探索換照片後熱點待複核；全站設定新增欄位。"""
from __future__ import annotations

import pytest

TOUR = "/api/website/v1/admin/content-items/campus_tour"


def _tour(image="campus", reviewed=None):
    scene = {
        "key": "hall", "name": "大廳", "image": image, "intro": "介紹",
        "spots": [{"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}],
    }
    if reviewed is not None:
        scene["spots_reviewed"] = reviewed
    return {"scenes": [scene]}


@pytest.mark.asyncio
async def test_changing_scene_image_requires_spot_review_before_publish(admin_client):
    first = await admin_client.post(f"{TOUR}/revisions?campus_key=yihua", json={"expected_version": 0, "payload": _tour("campus")})
    assert first.status_code == 201, first.text
    assert first.json()["latest_revision"]["payload"]["scenes"][0]["spots_reviewed"] is True

    # 換照片：就算前端說已複核，伺服器也改回待複核。
    swapped = await admin_client.post(
        f"{TOUR}/revisions?campus_key=yihua",
        json={"expected_version": 1, "payload": _tour("classroom", reviewed=True)},
    )
    assert swapped.json()["latest_revision"]["payload"]["scenes"][0]["spots_reviewed"] is False

    blocked = await admin_client.post(
        f"{TOUR}/publish?campus_key=yihua",
        json={"revision_id": swapped.json()["latest_revision"]["id"]},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CONTENT_NOT_READY"
    assert "大廳" in blocked.json()["detail"]["message"]

    # 照片沒再變、園方按「熱點已複核」→ 可以發布。
    reviewed = await admin_client.post(
        f"{TOUR}/revisions?campus_key=yihua",
        json={"expected_version": 2, "payload": _tour("classroom", reviewed=True)},
    )
    assert reviewed.json()["latest_revision"]["payload"]["scenes"][0]["spots_reviewed"] is True
    ok = await admin_client.post(
        f"{TOUR}/publish?campus_key=yihua",
        json={"revision_id": reviewed.json()["latest_revision"]["id"]},
    )
    assert ok.status_code == 200, ok.text


META = "/api/website/v1/admin/content-items/site_meta"


def _meta(**extra):
    base = {
        "title": "常春藤", "description": "描述",
        "header_phone_number": "07-0000000", "header_phone_note": "義華",
    }
    base.update(extra)
    return base


@pytest.mark.asyncio
async def test_site_meta_old_payload_still_valid_and_defaults(admin_client):
    resp = await admin_client.post(f"{META}/revisions", json={"expected_version": 0, "payload": _meta()})
    assert resp.status_code == 201, resp.text
    saved = resp.json()["latest_revision"]["payload"]
    assert saved["allow_indexing"] is True
    assert saved["share_image"] == ""


@pytest.mark.asyncio
async def test_site_meta_share_image_must_be_media(admin_client):
    bad = await admin_client.post(f"{META}/revisions", json={"expected_version": 0, "payload": _meta(share_image="hero")})
    assert bad.status_code == 422
    import uuid

    missing = await admin_client.post(
        f"{META}/revisions", json={"expected_version": 0, "payload": _meta(share_image=str(uuid.uuid4()))}
    )
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "MEDIA_NOT_FOUND"
    ok = await admin_client.post(
        f"{META}/revisions",
        json={"expected_version": 0, "payload": _meta(admission_title="入學資訊｜常春藤", allow_indexing=False)},
    )
    assert ok.status_code == 201, ok.text
