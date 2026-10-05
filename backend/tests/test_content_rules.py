"""校園探索不再有熱點（官網環境頁只用場景照片、名稱、說明）；全站設定新增欄位。"""
from __future__ import annotations

import pytest

TOUR = "/api/website/v1/admin/content-items/campus_tour"
HERO = "/api/website/v1/admin/content-items/home_hero"


def _tour(image="campus", spots=None, reviewed=None):
    scene = {"key": "hall", "name": "大廳", "image": image, "intro": "介紹"}
    if spots is not None:
        scene["spots"] = spots
    if reviewed is not None:
        scene["spots_reviewed"] = reviewed
    return {"scenes": [scene]}


@pytest.mark.asyncio
async def test_tour_scene_saves_and_publishes_without_spots(admin_client):
    # 2026-10-04：熱點的編輯從後台拿掉，新場景不再帶熱點。
    draft = await admin_client.post(f"{TOUR}/revisions?campus_key=yihua", json={"expected_version": 0, "payload": _tour()})
    assert draft.status_code == 201, draft.text
    assert draft.json()["latest_revision"]["payload"]["scenes"][0]["spots"] == []
    ok = await admin_client.post(
        f"{TOUR}/publish?campus_key=yihua",
        json={"revision_id": draft.json()["latest_revision"]["id"]},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_changing_scene_image_no_longer_blocks_publish(admin_client):
    spot = {"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}
    first = await admin_client.post(
        f"{TOUR}/revisions?campus_key=yihua", json={"expected_version": 0, "payload": _tour("campus", spots=[spot])}
    )
    assert first.status_code == 201, first.text

    # 換照片：以前會被標成「熱點待複核」擋住發布；熱點已不顯示，照常發布，
    # 舊資料裡的熱點原樣保留。
    swapped = await admin_client.post(
        f"{TOUR}/revisions?campus_key=yihua",
        json={"expected_version": 1, "payload": _tour("classroom", spots=[spot])},
    )
    assert swapped.status_code == 201, swapped.text
    scene = swapped.json()["latest_revision"]["payload"]["scenes"][0]
    assert scene["spots"] == [spot]
    assert scene["spots_reviewed"] is True
    ok = await admin_client.post(
        f"{TOUR}/publish?campus_key=yihua",
        json={"revision_id": swapped.json()["latest_revision"]["id"]},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_old_draft_with_unreviewed_spots_can_publish(admin_client):
    # 上線前存下、被標成待複核的草稿，不能卡住發布。
    draft = await admin_client.post(
        f"{TOUR}/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": _tour(reviewed=False)},
    )
    assert draft.status_code == 201, draft.text
    ok = await admin_client.post(
        f"{TOUR}/publish?campus_key=yihua",
        json={"revision_id": draft.json()["latest_revision"]["id"]},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_home_hero_saves_without_eyebrow(admin_client):
    # 2026-09-30 首屏拿掉小標，後台 2026-10-04 拿掉這個欄位，不再送它。
    resp = await admin_client.post(f"{HERO}/revisions", json={"expected_version": 0, "payload": {"copy_lines": ["一行"]}})
    assert resp.status_code == 201, resp.text
    assert resp.json()["latest_revision"]["payload"]["eyebrow"] == ""


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
