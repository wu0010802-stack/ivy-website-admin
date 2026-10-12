"""全站設定（site_meta）的各頁搜尋與分享（page_seo）、機構社群連結（social_links）。

2026-10-12：入學頁的搜尋標題／描述改放進 page_seo.admission，舊的 admission_title／
admission_description 退役（保留欄位只為讀得懂舊版本）；公開輸出把舊值補進新結構。"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.content import service as content_service
from app.content.registry import CONTENT_KIND_REGISTRY, set_at_path
from app.content.schemas import PAGE_SEO_KEYS
from app.media.models import MediaUsage

API = "/api/website/v1"
META = f"{API}/admin/content-items/site_meta"
MEDIA = f"{API}/admin/media"
FIXTURES = Path("/tmp/media-fixtures")


def _meta(**extra) -> dict:
    base = {
        "title": "常春藤", "description": "描述",
        "header_phone_number": "07-0000000", "header_phone_note": "義華",
    }
    base.update(extra)
    return base


def _seo(**fields) -> dict:
    return {"title": "", "description": "", "share_image": "", "share_image_alt": "", **fields}


def _link(platform: str = "facebook", label: str = "臉書", url: str = "https://www.facebook.com/ivy.kids.fb/") -> dict:
    return {"platform": platform, "label": label, "url": url}


async def _save(client, payload: dict, *, version: int = 0):
    return await client.post(f"{META}/revisions", json={"expected_version": version, "payload": payload})


async def _upload(client, kind: str = "image") -> dict:
    name, mime, source = ("a.mp4", "video/mp4", "test.mp4") if kind == "video" else ("a.jpg", "image/jpeg", "test.jpg")
    response = await client.post(
        MEDIA, data={"kind": kind}, files={"file": (name, (FIXTURES / source).read_bytes(), mime)}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _publish_raw(db_session, payload: dict):
    """直接寫進版本與發布紀錄（不經 API 的欄位規則），模擬正式庫已發布的舊版本。"""
    item = await content_service.get_or_create_content_item(db_session, "site_meta", None)
    revision = await content_service.create_revision(db_session, item, payload, item.latest_version, None)
    await content_service.publish_revision(db_session, item, revision, None)
    await db_session.commit()
    return revision


async def _public_meta(public_client) -> dict:
    return (await public_client.get(f"{API}/public/site")).json()["content"]["site_meta"]


# ---------------------------------------------------------------------------
# 1、2：舊的入學頁標題／描述補進 page_seo.admission，公開輸出不再帶舊欄位
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_view_folds_old_admission_fields_into_page_seo(public_client, db_session):
    old = await _publish_raw(db_session, _meta(admission_title="舊標題", admission_description="舊描述"))
    # 已發布的版本本身不動（沒有 migration）：舊鍵還在、沒有 page_seo。
    assert old.payload["admission_title"] == "舊標題" and "page_seo" not in old.payload

    meta = await _public_meta(public_client)
    assert meta["page_seo"] == {"admission": _seo(title="舊標題", description="舊描述")}
    assert "admission_title" not in meta and "admission_description" not in meta
    assert meta["title"] == "常春藤"


@pytest.mark.asyncio
async def test_public_view_without_old_values_has_no_admission_entry(public_client, db_session):
    await _publish_raw(db_session, _meta(admission_title="", admission_description=""))
    meta = await _public_meta(public_client)
    assert not meta.get("page_seo")
    assert "admission_title" not in meta and "admission_description" not in meta


@pytest.mark.asyncio
async def test_public_view_prefers_new_structure_and_only_fills_empty_fields(public_client, db_session):
    await _publish_raw(
        db_session,
        _meta(
            admission_title="舊標題", admission_description="舊描述",
            page_seo={
                "admission": _seo(title="新標題", share_image_alt="分享圖說明"),
                "about": _seo(title="關於"),
            },
        ),
    )
    meta = await _public_meta(public_client)
    # 標題已有新值就用新值；描述是空的才補舊值；其他欄位與其他頁照舊。
    assert meta["page_seo"]["admission"] == _seo(title="新標題", description="舊描述", share_image_alt="分享圖說明")
    assert meta["page_seo"]["about"] == _seo(title="關於")
    assert "admission_title" not in meta and "admission_description" not in meta


@pytest.mark.asyncio
async def test_public_view_does_not_change_the_stored_revision(public_client, db_session):
    old = await _publish_raw(db_session, _meta(admission_title="舊標題", page_seo={"about": _seo(title="關於")}))
    await _public_meta(public_client)
    await db_session.refresh(old)
    assert old.payload["admission_title"] == "舊標題"
    assert set(old.payload["page_seo"]) == {"about"}


def test_public_view_tolerates_odd_stored_values():
    view = CONTENT_KIND_REGISTRY["site_meta"].public_view
    assert view({"title": "x", "page_seo": None, "admission_title": "舊"}, "2026-10-12")["page_seo"] == {
        "admission": _seo(title="舊")
    }
    assert view({"title": "x", "page_seo": "壞掉", "admission_description": "舊"}, "2026-10-12")["page_seo"] == {
        "admission": _seo(description="舊")
    }
    assert "page_seo" not in view({"title": "x"}, "2026-10-12")


@pytest.mark.asyncio
async def test_retired_admission_fields_are_accepted_but_not_saved(admin_client):
    saved = await _save(admin_client, _meta(admission_title="入學資訊｜常春藤", admission_description="舊描述"))
    assert saved.status_code == 201, saved.text
    payload = saved.json()["latest_revision"]["payload"]
    assert "admission_title" not in payload and "admission_description" not in payload
    assert payload["page_seo"] is None and payload["social_links"] is None
    # 舊值仍照原規則驗證。
    bad = await _save(admin_client, _meta(admission_title="javascript:alert(1)"), version=1)
    assert bad.status_code == 422


# ---------------------------------------------------------------------------
# 3：page_seo 的鍵與欄位規則
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_page_seo_saves_all_seven_pages_with_defaults(admin_client):
    assert PAGE_SEO_KEYS == ("admission", "about", "curriculum", "environment", "news", "anniversary", "privacy")
    seo = {key: {"title": f"{key} 標題"} for key in PAGE_SEO_KEYS}
    saved = await _save(admin_client, _meta(page_seo=seo))
    assert saved.status_code == 201, saved.text
    payload = saved.json()["latest_revision"]["payload"]
    assert payload["page_seo"] == {key: _seo(title=f"{key} 標題") for key in PAGE_SEO_KEYS}


@pytest.mark.asyncio
async def test_page_seo_rejects_unknown_page_key(admin_client):
    for key in ("visit", "home", ""):
        resp = await _save(admin_client, _meta(page_seo={key: _seo(title="x")}))
        assert resp.status_code == 422, key


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fields",
    [
        {"title": "字" * 121},
        {"description": "字" * 301},
        {"share_image_alt": "字" * 201},
        {"title": "javascript:alert(1)"},
        {"description": " JavaScript:alert(1)"},
        {"share_image_alt": "data:text/html,x"},
        {"share_image": "hero"},
        {"share_image": "not-a-uuid"},
    ],
)
async def test_page_seo_field_rules(admin_client, fields):
    resp = await _save(admin_client, _meta(page_seo={"about": fields}))
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_page_seo_limits_are_inclusive(admin_client):
    resp = await _save(
        admin_client,
        _meta(page_seo={"news": {"title": "字" * 120, "description": "字" * 300, "share_image_alt": "字" * 200}}),
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_page_seo_title_and_description_stay_free_text(admin_client):
    resp = await _save(admin_client, _meta(page_seo={"privacy": _seo(title="隱私權政策 | 常春藤", description="說明：data 與 javascript 都是一般字")}))
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# 4：分享圖只能是圖片，發布後素材才在公開素材路由可取得
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_page_seo_share_image_must_be_an_image(admin_client):
    video = await _upload(admin_client, "video")
    wrong = await _save(admin_client, _meta(page_seo={"about": _seo(share_image=video["id"])}))
    assert wrong.status_code == 422
    assert wrong.json()["detail"]["code"] == "MEDIA_KIND_MISMATCH"
    assert wrong.json()["detail"]["field_path"] == "page_seo.about.share_image"

    missing = await _save(admin_client, _meta(page_seo={"about": _seo(share_image=str(uuid.uuid4()))}))
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "MEDIA_NOT_FOUND"


@pytest.mark.asyncio
async def test_page_seo_share_image_is_served_publicly_only_after_publishing(admin_client, public_client, db_session):
    image = await _upload(admin_client)
    saved = await _save(admin_client, _meta(page_seo={"curriculum": _seo(share_image=image["id"].upper())}))
    assert saved.status_code == 201, saved.text
    # 存下來的是正規化後的小寫 UUID。
    assert saved.json()["latest_revision"]["payload"]["page_seo"]["curriculum"]["share_image"] == image["id"]

    rows = (await db_session.execute(select(MediaUsage.field_name, MediaUsage.media_id))).all()
    assert [(name, str(media_id)) for name, media_id in rows] == [("page_seo.curriculum.share_image", image["id"])]

    url = f"{API}/public/media/{image['id']}/file"
    assert (await public_client.get(url)).status_code == 404
    published = await admin_client.post(
        f"{META}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    assert (await public_client.get(url)).status_code == 200
    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["site_meta"]["page_seo"]["curriculum"]["share_image"] == image["id"]
    assert site["media"][image["id"]]["kind"] == "image"
    # 引用中的素材不能刪。
    assert (await admin_client.delete(f"{MEDIA}/{image['id']}")).status_code == 409


def test_site_meta_media_refs_cover_page_share_images_and_work_with_set_at_path():
    config = CONTENT_KIND_REGISTRY["site_meta"]
    top, about, news = (str(uuid.uuid4()) for _ in range(3))
    payload = _meta(
        share_image=top,
        page_seo={"about": _seo(share_image=about), "news": _seo(share_image=news), "privacy": _seo()},
    )
    refs = config.extract_media_refs(payload)
    assert [(r.path, str(r.media_id), r.kind) for r in refs] == [
        ("share_image", top, None),
        ("page_seo.about.share_image", about, "image"),
        ("page_seo.news.share_image", news, "image"),
    ]
    replacement = str(uuid.uuid4())
    set_at_path(payload, "page_seo.about.share_image", replacement)
    assert payload["page_seo"]["about"]["share_image"] == replacement
    assert payload["page_seo"]["news"]["share_image"] == news


@pytest.mark.parametrize(
    "payload",
    [{}, {"page_seo": None}, {"page_seo": "x"}, {"page_seo": {"about": None, "news": {"share_image": 3}}}, {"page_seo": {"about": {}}}],
)
def test_site_meta_media_refs_tolerate_odd_stored_values(payload):
    assert CONTENT_KIND_REGISTRY["site_meta"].extract_media_refs(payload) == []


# ---------------------------------------------------------------------------
# 5：機構社群連結
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_social_links_save_and_publish_unchanged(admin_client, public_client):
    links = [
        _link("facebook", "臉書", "https://www.facebook.com/ivy.kids.fb/"),
        _link("line", "LINE", "https://lin.ee/abc123"),
        _link("instagram", "IG", "https://www.instagram.com/ivykids/"),
        _link("youtube", "YouTube", "https://www.youtube.com/@ivykids"),
    ]
    saved = await _save(admin_client, _meta(social_links=links))
    assert saved.status_code == 201, saved.text
    assert saved.json()["latest_revision"]["payload"]["social_links"] == links
    published = await admin_client.post(
        f"{META}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    assert (await _public_meta(public_client))["social_links"] == links


@pytest.mark.asyncio
async def test_social_links_none_and_empty_are_both_kept(admin_client):
    first = await _save(admin_client, _meta(social_links=None))
    assert first.json()["latest_revision"]["payload"]["social_links"] is None
    second = await _save(admin_client, _meta(social_links=[]), version=1)
    assert second.status_code == 201, second.text
    assert second.json()["latest_revision"]["payload"]["social_links"] == []


@pytest.mark.asyncio
async def test_social_links_label_is_trimmed(admin_client):
    saved = await _save(admin_client, _meta(social_links=[_link(label="  臉書  ", url="  https://www.facebook.com/ivy  ")]))
    assert saved.status_code == 201, saved.text
    assert saved.json()["latest_revision"]["payload"]["social_links"] == [
        _link(label="臉書", url="https://www.facebook.com/ivy")
    ]


@pytest.mark.asyncio
async def test_social_links_accept_six_and_reject_seven(admin_client):
    def many(n: int) -> list[dict]:
        return [_link("facebook", f"粉專{i}", f"https://www.facebook.com/page{i}") for i in range(n)]

    assert (await _save(admin_client, _meta(social_links=many(6)))).status_code == 201
    assert (await _save(admin_client, _meta(social_links=many(7)), version=1)).status_code == 422


@pytest.mark.asyncio
async def test_social_links_reject_duplicate_urls(admin_client):
    dup = [_link(url="https://www.facebook.com/ivy"), _link("line", "LINE", "https://www.facebook.com/ivy")]
    assert (await _save(admin_client, _meta(social_links=dup))).status_code == 422
    # 大小寫不同的網域、結尾斜線也算同一個。
    dup = [_link(url="https://www.facebook.com/ivy"), _link(label="另一個", url="https://WWW.Facebook.com/ivy/")]
    assert (await _save(admin_client, _meta(social_links=dup))).status_code == 422
    # 路徑不同就不是重複。
    ok = [_link(url="https://www.facebook.com/ivy"), _link(label="另一個", url="https://www.facebook.com/ivy2")]
    assert (await _save(admin_client, _meta(social_links=ok))).status_code == 201


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://www.facebook.com/ivy",
        "javascript:alert(1)",
        " JavaScript:alert(1)",
        "java\tscript:alert(1)",
        "data:text/html,x",
        "mailto:a@b.com",
        "tel:0700000000",
        "//www.facebook.com/ivy",
        "www.facebook.com/ivy",
        "https:",
        "https://",
        "https:///ivy",
        "https://user:pass@www.facebook.com/ivy",
        "https://user@www.facebook.com/ivy",
        "https://www.face book.com/ivy",
        "https://www.facebook.com/iv\ny",
        "https://www.facebook.com\\@evil.com/",
        "https://www.facebook.com:99999/ivy",
        "https://www.facebook.com/" + "a" * 300,
        "",
    ],
)
async def test_social_links_reject_unsafe_urls(admin_client, url):
    resp = await _save(admin_client, _meta(social_links=[_link(url=url)]))
    assert resp.status_code == 422, (url, resp.text)


@pytest.mark.asyncio
@pytest.mark.parametrize("platform", ["tiktok", "twitter", "", "Facebook"])
async def test_social_links_reject_unknown_platform(admin_client, platform):
    resp = await _save(admin_client, _meta(social_links=[_link(platform=platform)]))
    assert resp.status_code == 422, platform


@pytest.mark.asyncio
@pytest.mark.parametrize("label", ["", "   ", "字" * 21, "javascript:alert(1)"])
async def test_social_links_label_rules(admin_client, label):
    resp = await _save(admin_client, _meta(social_links=[_link(label=label)]))
    assert resp.status_code == 422, label


@pytest.mark.asyncio
async def test_social_links_allow_twenty_char_label_and_https_with_port_and_query(admin_client):
    resp = await _save(
        admin_client,
        _meta(social_links=[_link(label="字" * 20, url="https://example.com:8443/path?x=1&y=2#top")]),
    )
    assert resp.status_code == 201, resp.text
