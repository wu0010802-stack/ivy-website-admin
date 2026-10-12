"""校園探索不再有熱點（官網環境頁只用場景照片、名稱、說明）；全站設定新增欄位；
預約文案與五校介紹拿掉舊欄位（2026-10-08）。"""
from __future__ import annotations

import pytest

from app.content import service as content_service

API = "/api/website/v1"
TOUR = f"{API}/admin/content-items/campus_tour"
HERO = f"{API}/admin/content-items/home_hero"
BOOKING = f"{API}/admin/content-items/booking_content"
PROFILE = f"{API}/admin/content-items/campus_profile"


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


# ---------------------------------------------------------------------------
# 2026-10-08：預約文案的同意文字／橫幅三欄、五校介紹的簡介／詳細介紹／臉書備註拿掉
# ---------------------------------------------------------------------------

_BOOKING_RETIRED = {
    "consent_text": "我了解這是操作示範。",
    "banner_title_template": "歡迎{campus}",
    "banner_body": "期待與你相遇。",
    "banner_button_label": "預約校園參觀",
}
_PROFILE_RETIRED = {"intro": "舊簡介", "description": "舊介紹", "fb_note": "舊粉專備註"}
_PROFILE = {
    "name": "義華校", "district": "三民區", "address": "高雄市三民區義華路68號", "phone": "07-392-8366",
    "facebook": "https://www.facebook.com/ivy.kids.fb/", "line": "",
}


@pytest.mark.asyncio
async def test_booking_content_saves_without_retired_fields(admin_client):
    # 後台不再送這四欄：必填變選填，新版本也不帶它們。
    saved = await admin_client.post(
        f"{BOOKING}/revisions", json={"expected_version": 0, "payload": {"cta_label": "預約參觀", "cta_label_en": "Book a Visit"}}
    )
    assert saved.status_code == 201, saved.text
    payload = saved.json()["latest_revision"]["payload"]
    assert payload["cta_label"] == "預約參觀"
    assert not set(_BOOKING_RETIRED) & set(payload)
    published = await admin_client.post(f"{BOOKING}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    assert published.status_code == 200, published.text


@pytest.mark.asyncio
async def test_booking_content_old_values_are_accepted_but_not_saved(admin_client):
    # 舊版後台載入舊版本後原樣帶回：照收（不 422），但存下來的新版本不再帶這四欄。
    saved = await admin_client.post(
        f"{BOOKING}/revisions",
        json={"expected_version": 0, "payload": {"cta_label": "預約參觀", "cta_label_en": "Book", **_BOOKING_RETIRED}},
    )
    assert saved.status_code == 201, saved.text
    assert not set(_BOOKING_RETIRED) & set(saved.json()["latest_revision"]["payload"])
    # 舊值仍照原規則驗證。
    bad = await admin_client.post(
        f"{BOOKING}/revisions",
        json={"expected_version": 1, "payload": {"cta_label": "預約參觀", "cta_label_en": "Book", "banner_body": "javascript:alert(1)"}},
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_campus_profile_saves_without_retired_fields(admin_client):
    saved = await admin_client.post(f"{PROFILE}/revisions?campus_key=yihua", json={"expected_version": 0, "payload": _PROFILE})
    assert saved.status_code == 201, saved.text
    payload = saved.json()["latest_revision"]["payload"]
    assert payload["name"] == "義華校"
    assert not set(_PROFILE_RETIRED) & set(payload)
    published = await admin_client.post(
        f"{PROFILE}/publish?campus_key=yihua", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text


@pytest.mark.asyncio
async def test_campus_profile_old_values_are_accepted_but_not_saved(admin_client):
    saved = await admin_client.post(
        f"{PROFILE}/revisions?campus_key=yihua", json={"expected_version": 0, "payload": {**_PROFILE, **_PROFILE_RETIRED}}
    )
    assert saved.status_code == 201, saved.text
    assert not set(_PROFILE_RETIRED) & set(saved.json()["latest_revision"]["payload"])
    bad = await admin_client.post(
        f"{PROFILE}/revisions?campus_key=yihua",
        json={"expected_version": 1, "payload": {**_PROFILE, "intro": "javascript:alert(1)"}},
    )
    assert bad.status_code == 422


async def _publish_raw(db_session, kind: str, campus_key: str | None, payload: dict):
    """直接寫進版本與發布紀錄（不經 API 的欄位規則），模擬正式庫已發布的舊版本。"""
    item = await content_service.get_or_create_content_item(db_session, kind, campus_key)
    revision = await content_service.create_revision(db_session, item, payload, item.latest_version, None)
    await content_service.publish_revision(db_session, item, revision, None)
    await db_session.commit()
    return revision


@pytest.mark.asyncio
async def test_public_site_drops_retired_fields_from_old_published_versions(public_client, db_session):
    booking = await _publish_raw(
        db_session, "booking_content", None,
        {"cta_label": "預約參觀", "cta_label_en": "Book", "privacy_title": "個資說明", "privacy_sections": [], **_BOOKING_RETIRED},
    )
    profile = await _publish_raw(db_session, "campus_profile", "yihua", {**_PROFILE, **_PROFILE_RETIRED})
    # 已發布的版本本身不動（沒有 migration）。
    assert set(_BOOKING_RETIRED) <= set(booking.payload) and set(_PROFILE_RETIRED) <= set(profile.payload)

    content = (await public_client.get(f"{API}/public/site")).json()["content"]
    assert content["booking_content"] == {
        "cta_label": "預約參觀", "cta_label_en": "Book", "privacy_title": "個資說明", "privacy_sections": []
    }
    yihua = content["campus_profile"]["yihua"]
    assert yihua["name"] == "義華校" and yihua["facebook"] == _PROFILE["facebook"]
    assert not set(_PROFILE_RETIRED) & set(yihua)


@pytest.mark.asyncio
async def test_restoring_an_old_version_drops_retired_fields(admin_client, db_session):
    old = await _publish_raw(db_session, "campus_profile", "yihua", {**_PROFILE, **_PROFILE_RETIRED})
    restored = await admin_client.post(
        f"{PROFILE}/revisions/{old.id}/restore?campus_key=yihua", json={"expected_version": 1}
    )
    assert restored.status_code == 201, restored.text
    payload = restored.json()["latest_revision"]["payload"]
    assert payload["name"] == "義華校"
    assert not set(_PROFILE_RETIRED) & set(payload)
