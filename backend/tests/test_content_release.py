from __future__ import annotations

import pytest


def _payload(title="標題", since_label="SINCE 1997", body="內文", caption="說明"):
    return {"title": title, "since_label": since_label, "body_text": body, "caption": caption}


@pytest.mark.asyncio
async def test_public_site_returns_503_before_any_publish(public_client):
    response = await public_client.get("/api/website/v1/public/site")
    assert response.status_code == 503
    # 後台全站設定頁靠這個代碼判斷「還沒發布過」，不當成讀取失敗（B11-R4）。
    assert response.json()["detail"]["code"] == "NO_PUBLISHED_CONTENT"


@pytest.mark.asyncio
async def test_draft_does_not_change_public_release(admin_client, public_client):
    before = await public_client.get("/api/website/v1/public/site")
    assert before.status_code == 503  # 尚無 release

    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="草稿標題")},
    )
    assert draft.status_code == 201, draft.text

    after_draft = await public_client.get("/api/website/v1/public/site")
    assert after_draft.status_code == 503  # 草稿不影響公開站，這裡仍未發布過


@pytest.mark.asyncio
async def test_publish_makes_content_public_and_stable_release(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="發布前標題")},
    )
    revision_id = draft.json()["latest_revision"]["id"]

    publish = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/publish",
        json={"revision_id": revision_id},
    )
    assert publish.status_code == 200

    site = await public_client.get("/api/website/v1/public/site")
    assert site.status_code == 200
    body = site.json()
    assert body["content"]["home_about"]["title"] == "發布前標題"
    release_id = body["release_id"]

    # 再打一次，release_id 不變（沒有新發布動作）
    site_again = await public_client.get("/api/website/v1/public/site")
    assert site_again.json()["release_id"] == release_id


@pytest.mark.asyncio
async def test_editing_after_publish_does_not_change_public_release(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="第一版")},
    )
    revision_id = draft.json()["latest_revision"]["id"]
    await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/publish", json={"revision_id": revision_id}
    )
    before = await public_client.get("/api/website/v1/public/site")

    # 儲存新草稿但不發布
    draft2 = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 1, "payload": _payload(title="第二版尚未發布")},
    )
    assert draft2.status_code == 201

    after = await public_client.get("/api/website/v1/public/site")
    assert after.json()["release_id"] == before.json()["release_id"]
    assert after.json()["content"]["home_about"]["title"] == "第一版"


@pytest.mark.asyncio
async def test_version_conflict_rejected(admin_client):
    await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="A")},
    )
    # 用過期的 expected_version 再送一次
    stale = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="B")},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "CONTENT_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_campus_admin_cannot_edit_shared_home_content(minghua_client):
    response = await minghua_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload()},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_javascript_url_scheme_rejected(admin_client):
    response = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={
            "expected_version": 0,
            "payload": _payload(body="javascript:alert(1)"),
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_unknown_content_kind_returns_404(admin_client):
    response = await admin_client.get("/api/website/v1/admin/content-items/not-a-real-kind")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_home_hero_kind_roundtrip(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_hero/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "常春藤幼兒園 · 高雄五校",
                "copy_lines": ["第一行", "第二行"],
                "cta_label": "看看孩子的一天",
            },
        },
    )
    assert draft.status_code == 201, draft.text
    revision_id = draft.json()["latest_revision"]["id"]

    publish = await admin_client.post(
        "/api/website/v1/admin/content-items/home_hero/publish", json={"revision_id": revision_id}
    )
    assert publish.status_code == 200

    site = await public_client.get("/api/website/v1/public/site")
    # 2026-09-23 拿掉首屏按鈕：舊前端送來的按鈕文字直接忽略，不存也不輸出。
    # 沒設的素材版位（None／空字串）＝官網沿用內建影片與照片。
    hero = {k: v for k, v in site.json()["content"]["home_hero"].items() if v not in (None, "")}
    assert hero == {
        "eyebrow": "常春藤幼兒園 · 高雄五校",
        "copy_lines": ["第一行", "第二行"],
    }


@pytest.mark.asyncio
async def test_home_hero_rejects_too_many_copy_lines(admin_client):
    response = await admin_client.post(
        "/api/website/v1/admin/content-items/home_hero/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "x",
                "copy_lines": ["1", "2", "3", "4"],
                "cta_label": "x",
            },
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_site_footer_kind_roundtrip(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/site_footer/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "tagline": "測試標語",
                "copyright": "測試版權",
                "bottom_note": "測試備註",
                "campus_list_label": "測試校區清單",
            },
        },
    )
    assert draft.status_code == 201
    revision_id = draft.json()["latest_revision"]["id"]
    await admin_client.post(
        "/api/website/v1/admin/content-items/site_footer/publish", json={"revision_id": revision_id}
    )
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["site_footer"]["tagline"] == "測試標語"


def _campus_profile_payload(name: str) -> dict:
    return {
        "name": name,
        "district": "測試區",
        "address": "測試地址",
        "phone": "07-000-0000",
        "intro": "測試簡介",
        "description": "測試描述",
        "facebook": "https://facebook.com/test",
        "fb_note": "測試粉專",
        "line": "",
    }


@pytest.mark.asyncio
async def test_campus_scoped_content_kind_isolated_per_campus(admin_client, public_client):
    """campus_profile 是非共用 kind，每校各一份；/public/site 要用
    campus_key 分層，不能讓其中一校的資料蓋掉另一校（get_public_content
    的真正 bug：曾經直接用 kind 當 key，多校會互相覆蓋）。"""
    for key, name in (("yihua", "義華測試"), ("minghua", "明華測試")):
        draft = await admin_client.post(
            f"/api/website/v1/admin/content-items/campus_profile/revisions?campus_key={key}",
            json={"expected_version": 0, "payload": _campus_profile_payload(name)},
        )
        assert draft.status_code == 201, draft.text
        revision_id = draft.json()["latest_revision"]["id"]
        publish = await admin_client.post(
            f"/api/website/v1/admin/content-items/campus_profile/publish?campus_key={key}",
            json={"revision_id": revision_id},
        )
        assert publish.status_code == 200, publish.text

    site = await public_client.get("/api/website/v1/public/site")
    profiles = site.json()["content"]["campus_profile"]
    assert profiles["yihua"]["name"] == "義華測試"
    assert profiles["minghua"]["name"] == "明華測試"


@pytest.mark.asyncio
async def test_campus_admin_cannot_edit_other_campus_profile(minghua_client):
    response = await minghua_client.post(
        "/api/website/v1/admin/content-items/campus_profile/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": _campus_profile_payload("越權測試")},
    )
    assert response.status_code in (403, 404)


@pytest.mark.asyncio
async def test_campus_admin_can_edit_own_campus_profile(minghua_client):
    response = await minghua_client.post(
        "/api/website/v1/admin/content-items/campus_profile/revisions?campus_key=minghua",
        json={"expected_version": 0, "payload": _campus_profile_payload("明華自編")},
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_day_experience_moments_bounds_and_duplicate_key_rejected(admin_client):
    def moment(key: str) -> dict:
        return {
            "key": key,
            "time": "08:00",
            "label": "早晨",
            "caption": "caption",
            "title": "title",
            "story": "story",
            "question": "question",
            "answer": "answer",
        }

    too_few = await admin_client.post(
        "/api/website/v1/admin/content-items/day_experience/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "e",
                "eyebrow_en": "e",
                "note": "n",
                "source_note": "s",
                "moments": [],
            },
        },
    )
    assert too_few.status_code == 422

    duplicate_key = await admin_client.post(
        "/api/website/v1/admin/content-items/day_experience/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "e",
                "eyebrow_en": "e",
                "note": "n",
                "source_note": "s",
                "moments": [moment("morning"), moment("morning")],
            },
        },
    )
    assert duplicate_key.status_code == 422

    ok = await admin_client.post(
        "/api/website/v1/admin/content-items/day_experience/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "e",
                "eyebrow_en": "e",
                "note": "n",
                "source_note": "s",
                "moments": [moment("morning"), moment("noon")],
            },
        },
    )
    assert ok.status_code == 201, ok.text


def _tour_spot(name: str, x: float = 50, y: float = 50) -> dict:
    return {"name": name, "x": x, "y": y, "text": "text", "question": "question"}


def _tour_scene(key: str) -> dict:
    return {
        "key": key,
        "name": "場景",
        "image": "campus",
        "intro": "intro",
        "spots": [_tour_spot("熱點 1")],
    }


@pytest.mark.asyncio
async def test_campus_tour_scene_and_spot_bounds(admin_client):
    too_many_scenes = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={
            "expected_version": 0,
            "payload": {"scenes": [_tour_scene(f"s{i}") for i in range(7)]},
        },
    )
    assert too_many_scenes.status_code == 422

    duplicate_scene_key = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={
            "expected_version": 0,
            "payload": {"scenes": [_tour_scene("dup"), _tour_scene("dup")]},
        },
    )
    assert duplicate_scene_key.status_code == 422

    too_many_spots = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={
            "expected_version": 0,
            "payload": {
                "scenes": [
                    {
                        "key": "s1",
                        "name": "場景",
                        "image": "campus",
                        "intro": "intro",
                        "spots": [_tour_spot(f"熱點{i}") for i in range(9)],
                    }
                ]
            },
        },
    )
    assert too_many_spots.status_code == 422

    x_out_of_range = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={
            "expected_version": 0,
            "payload": {"scenes": [{**_tour_scene("s1"), "spots": [_tour_spot("h", x=150, y=50)]}]},
        },
    )
    assert x_out_of_range.status_code == 422

    ok = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": {"scenes": [_tour_scene("s1"), _tour_scene("s2")]}},
    )
    assert ok.status_code == 201, ok.text


@pytest.mark.asyncio
async def test_campus_tour_isolated_per_campus(admin_client, public_client):
    for key in ("yihua", "minghua"):
        draft = await admin_client.post(
            f"/api/website/v1/admin/content-items/campus_tour/revisions?campus_key={key}",
            json={"expected_version": 0, "payload": {"scenes": [_tour_scene(f"{key}-scene")]}},
        )
        assert draft.status_code == 201, draft.text
        revision_id = draft.json()["latest_revision"]["id"]
        publish = await admin_client.post(
            f"/api/website/v1/admin/content-items/campus_tour/publish?campus_key={key}",
            json={"revision_id": revision_id},
        )
        assert publish.status_code == 200, publish.text

    site = await public_client.get("/api/website/v1/public/site")
    tours = site.json()["content"]["campus_tour"]
    assert tours["yihua"]["scenes"][0]["key"] == "yihua-scene"
    assert tours["minghua"]["scenes"][0]["key"] == "minghua-scene"


@pytest.mark.asyncio
async def test_public_site_read_requires_no_auth(public_client, admin_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="公開內容")},
    )
    revision_id = draft.json()["latest_revision"]["id"]
    await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/publish", json={"revision_id": revision_id}
    )
    response = await public_client.get("/api/website/v1/public/site")
    assert response.status_code == 200
    assert "content" in response.json()
