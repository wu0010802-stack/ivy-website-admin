"""官網結構類內容：停用分校不公開、首頁五校順序、主選單與頁尾連結、分校
地圖網址、首屏按鈕文字退場。"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.schemas import (
    CampusProfilePayload,
    HomeCampusBoardPayload,
    HomeHeroPayload,
    SiteFooterPayload,
    SiteMetaPayload,
    is_map_url,
)

API = "/api/website/v1"
CONTENT = f"{API}/admin/content-items"


def _profile(name: str = "仁武校", **overrides) -> dict:
    base = {
        "name": name, "district": "仁武區", "address": "高雄市仁武區仁雄路1號", "phone": "07-000-0000",
        "intro": "簡介", "description": "介紹", "facebook": "", "fb_note": "", "line": "",
    }
    return {**base, **overrides}


def _meta(**overrides) -> dict:
    base = {"title": "常春藤", "description": "描述", "header_phone_number": "07-0000000", "header_phone_note": "義華"}
    return {**base, **overrides}


def _footer(**overrides) -> dict:
    base = {"tagline": "標語", "copyright": "©", "bottom_note": "", "campus_list_label": "五校"}
    return {**base, **overrides}


def _board(**overrides) -> dict:
    return {"section_title": "分校資訊", "eyebrow": "Campuses", "note": "", **overrides}


async def _save_and_publish(client, kind: str, payload: dict, campus_key: str | None = None) -> dict:
    query = f"?campus_key={campus_key}" if campus_key else ""
    current = (await client.get(f"{CONTENT}/{kind}{query}")).json()
    saved = await client.post(
        f"{CONTENT}/{kind}/revisions{query}",
        json={"expected_version": current["latest_version"], "payload": payload},
    )
    assert saved.status_code == 201, saved.text
    published = await client.post(
        f"{CONTENT}/{kind}/publish{query}", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    return saved.json()


# ---------------------------------------------------------------------------
# 停用分校（規格 3.2、9.2）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_inactive_campus_is_left_out_of_public_site_until_reactivated(admin_client, public_client):
    for key in ("yihua", "renwu"):
        await _save_and_publish(admin_client, "campus_profile", _profile(name=f"{key}校"), key)
        await _save_and_publish(admin_client, "campus_faq", {"items": [{"q": "問", "a": "答"}]}, key)
    await _save_and_publish(admin_client, "campus_news", {"articles": [], "events": [
        {"id": "e1", "date": "2026-10-03", "title": "仁武活動", "description": "說明"},
    ]}, "renwu")
    article = {
        "id": "a1", "date": "2026-10-01", "category": "公告", "title": "只給仁武", "description": "摘要",
        "image": "garden", "alt": "替代文字", "scope": "campus", "campus_keys": ["renwu"],
    }
    await _save_and_publish(admin_client, "home_news", {"sample_note": "", "events": [], "articles": [
        article,
        {**article, "id": "a2", "title": "義華與仁武", "campus_keys": ["yihua", "renwu"]},
        {**article, "id": "a3", "title": "全校", "scope": "global", "campus_keys": []},
    ]})
    await _save_and_publish(admin_client, "shared_faq", {"items": [
        {"id": "f1", "q": "仁武題", "a": "答", "scope": "campus", "campus_keys": ["renwu"]},
        {"id": "f2", "q": "全校題", "a": "答", "scope": "global"},
    ]})

    off = await admin_client.patch(f"{API}/admin/campuses/renwu/status", json={"active": False, "reason": "暫停招生"})
    assert off.status_code == 200, off.text

    content = (await public_client.get(f"{API}/public/site")).json()["content"]
    for kind in ("campus_profile", "campus_faq"):
        assert set(content[kind]) == {"yihua"}
    assert "campus_news" not in content
    titles = [a["title"] for a in content["home_news"]["articles"]]
    assert titles == ["義華與仁武", "全校"]
    assert content["home_news"]["articles"][0]["campus_keys"] == ["yihua"]
    assert [i["q"] for i in content["shared_faq"]["items"]] == ["全校題"]

    # 公開時段查詢也不列停用校區。
    today = date.today()
    slots = await public_client.get(
        f"{API}/public/slots",
        params={"campus_key": "renwu", "date_from": today.isoformat(), "date_to": (today + timedelta(days=7)).isoformat()},
    )
    assert slots.status_code == 200
    assert slots.json() == []

    # 後台照常讀得到（草稿預覽走這條）。
    draft = await admin_client.get(f"{CONTENT}/campus_profile?campus_key=renwu")
    assert draft.status_code == 200
    assert draft.json()["latest_revision"]["payload"]["name"] == "renwu校"

    on = await admin_client.patch(f"{API}/admin/campuses/renwu/status", json={"active": True})
    assert on.status_code == 200
    content = (await public_client.get(f"{API}/public/site")).json()["content"]
    assert set(content["campus_profile"]) == {"yihua", "renwu"}
    assert set(content["campus_news"]) == {"renwu"}
    assert [a["title"] for a in content["home_news"]["articles"]] == ["只給仁武", "義華與仁武", "全校"]
    assert len(content["shared_faq"]["items"]) == 2


def test_legacy_news_campus_label_of_inactive_campus_is_hidden():
    """2026-09-25 以前的消息只有手打的 campus 文字；公開輸出時照校名比對。"""
    from app.content import service

    payload = {"articles": [
        {"id": "old", "campus": "仁武校", "title": "舊消息"},
        {"id": "all", "campus": "全校", "title": "舊全校"},
    ], "events": []}
    kept = service._without_inactive_campuses("home_news", payload, {"renwu"})
    assert [a["id"] for a in kept["articles"]] == ["all"]


# ---------------------------------------------------------------------------
# 首頁五校順序與預設校區（規格 L107）
# ---------------------------------------------------------------------------


def test_campus_board_defaults_keep_builtin_order():
    board = HomeCampusBoardPayload.model_validate(_board()).model_dump()
    assert board["campus_order"] == ["yihua", "minghua", "chongde", "international", "renwu"]
    assert board["default_campus"] == "yihua"


@pytest.mark.parametrize(
    "order",
    [
        ["yihua", "minghua", "chongde", "international"],
        ["yihua", "yihua", "minghua", "chongde", "international"],
        ["yihua", "minghua", "chongde", "international", "renwu", "yihua"],
        ["yihua", "minghua", "chongde", "international", "tainan"],
    ],
)
def test_campus_board_order_must_be_the_five_keys(order):
    with pytest.raises(ValidationError):
        HomeCampusBoardPayload.model_validate(_board(campus_order=order))


def test_campus_board_default_campus_must_be_known():
    with pytest.raises(ValidationError):
        HomeCampusBoardPayload.model_validate(_board(default_campus="tainan"))


@pytest.mark.asyncio
async def test_campus_board_order_roundtrip(admin_client, public_client):
    order = ["renwu", "chongde", "yihua", "minghua", "international"]
    await _save_and_publish(admin_client, "home_campus_board", _board(campus_order=order, default_campus="chongde"))
    board = (await public_client.get(f"{API}/public/site")).json()["content"]["home_campus_board"]
    assert board["campus_order"] == order
    assert board["default_campus"] == "chongde"


# ---------------------------------------------------------------------------
# 主選單與頁尾連結（規格 L89）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "href",
    ["/", "/#about", "/admission", "/campuses/yihua#faq", "https://www.ivykidschool.com/", "https://example.com:8443/"],
)
def test_site_links_accept_internal_paths_and_https(href):
    footer = SiteFooterPayload.model_validate(_footer(links=[{"label": "連結", "href": href}]))
    assert footer.links[0].href == href


@pytest.mark.parametrize(
    "href",
    [
        "http://example.com/", "//example.com/", "javascript:alert(1)", "java\tscript:alert(1)",
        "admission", "https://", "https://user@example.com/", "https://example.com/a b", "mailto:a@b.c",
        "/\\example.com",
        # 官網與後台用 new URL() 解析不了、會默默略過的網址（B08 審查）：埠號無效、主機名稱有不允許的字元。
        "https://example.com:99999/", "https://example.com:abc/", "https://exa%mple.com/", "https://ex<a.com/",
    ],
)
def test_site_links_reject_other_urls(href):
    with pytest.raises(ValidationError):
        SiteFooterPayload.model_validate(_footer(links=[{"label": "連結", "href": href}]))


def test_site_links_rules():
    ok = {"label": "入學資訊", "label_en": "Admission", "href": "/admission"}
    assert SiteMetaPayload.model_validate(_meta()).primary_nav is None
    with pytest.raises(ValidationError):
        SiteMetaPayload.model_validate(_meta(primary_nav=[]))
    with pytest.raises(ValidationError):
        SiteMetaPayload.model_validate(_meta(primary_nav=[ok, {**ok, "label": "重複"}]))
    with pytest.raises(ValidationError):
        SiteMetaPayload.model_validate(_meta(primary_nav=[{**ok, "href": f"/p{i}"} for i in range(9)]))
    with pytest.raises(ValidationError):
        SiteMetaPayload.model_validate(_meta(primary_nav=[{**ok, "label_en": "入學"}]))
    with pytest.raises(ValidationError):
        SiteMetaPayload.model_validate(_meta(primary_nav=[{**ok, "label": "  "}]))
    with pytest.raises(ValidationError):
        SiteFooterPayload.model_validate(_footer(links=[{"label": "x", "href": f"/p{i}"} for i in range(13)]))
    assert SiteFooterPayload.model_validate(_footer(links=[])).links == []


@pytest.mark.asyncio
async def test_nav_and_footer_links_roundtrip(admin_client, public_client):
    nav = [
        {"label": "入學資訊", "label_en": "Admission", "href": "/admission"},
        {"label": "機構官網", "label_en": "", "href": "https://www.ivykidschool.com/"},
    ]
    await _save_and_publish(admin_client, "site_meta", _meta(primary_nav=nav))
    await _save_and_publish(admin_client, "site_footer", _footer(links=[{"label": "預約參觀", "href": "/visit"}]))
    content = (await public_client.get(f"{API}/public/site")).json()["content"]
    assert content["site_meta"]["primary_nav"] == nav
    assert content["site_footer"]["links"] == [{"label": "預約參觀", "href": "/visit"}]


# ---------------------------------------------------------------------------
# 分校地圖網址（規格 L111）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://maps.app.goo.gl/AbCdEf123",
        "https://goo.gl/maps/AbCdEf123",
        "https://www.google.com/maps/place/%E7%BE%A9%E8%8F%AF/@22.6,120.3,17z",
        "https://www.google.com.tw/maps/search/?api=1&query=義華路68號",
        "https://maps.google.com/?cid=123",
        "https://google.com/maps",
    ],
)
def test_map_url_accepts_google_maps(url):
    assert is_map_url(url)
    assert CampusProfilePayload.model_validate(_profile(map_url=url)).map_url == url


@pytest.mark.parametrize(
    "url",
    [
        "http://maps.app.goo.gl/AbCdEf123",
        "https://maps.app.goo.gl/",
        "https://goo.gl/AbCdEf123",
        "https://www.google.com/search?q=maps",
        "https://www.google.com/mapsfoo",
        "https://evil.example/maps/",
        "https://maps.google.com.evil.example/",
        "https://user@maps.google.com/",
        "https://maps.google.com:8443/",
        "javascript:alert(1)",
        "<iframe src=\"https://www.google.com/maps/embed\"></iframe>",
    ],
)
def test_map_url_rejects_other_urls(url):
    assert not is_map_url(url)
    with pytest.raises(ValidationError):
        CampusProfilePayload.model_validate(_profile(map_url=url))


def test_map_url_is_optional_for_old_profiles():
    assert CampusProfilePayload.model_validate(_profile()).map_url == ""
    assert CampusProfilePayload.model_validate(_profile(map_url="  ")).map_url == ""


# ---------------------------------------------------------------------------
# 首屏按鈕文字（2026-09-23 拿掉首屏按鈕）
# ---------------------------------------------------------------------------


def test_home_hero_ignores_legacy_cta_label():
    hero = HomeHeroPayload.model_validate({"eyebrow": "小標", "copy_lines": ["一"], "cta_label": "看看孩子的一天"})
    # 2026-09-25 起多了影片與照片版位（預設 None），這裡只看沒有按鈕文字。
    assert hero.model_dump(exclude_defaults=True) == {"eyebrow": "小標", "copy_lines": ["一"]}
    assert HomeHeroPayload.model_validate({"eyebrow": "小標", "copy_lines": ["一"]})
    legacy = {"eyebrow": "小標", "copy_lines": ["一"], "cta_label": "舊按鈕"}
    assert "cta_label" not in CONTENT_KIND_REGISTRY["home_hero"].public_view(legacy, "2026-09-25")


@pytest.mark.asyncio
async def test_home_hero_saved_without_cta_label(admin_client, public_client):
    saved = await _save_and_publish(
        admin_client, "home_hero", {"eyebrow": "小標", "copy_lines": ["一", "二"], "cta_label": "舊按鈕"}
    )
    assert "cta_label" not in saved["latest_revision"]["payload"]
    hero = (await public_client.get(f"{API}/public/site")).json()["content"]["home_hero"]
    assert {k: v for k, v in hero.items() if v not in (None, "")} == {"eyebrow": "小標", "copy_lines": ["一", "二"]}


def test_initialize_keeps_builtin_links_and_order():
    """原型 fixture 的連結是 hash 網址，匯入時不帶；五校順序照原型。"""
    import json
    from pathlib import Path

    from app.content.initialize import initial_payloads

    data = json.loads((Path(__file__).resolve().parents[2] / "content" / "site-fixture.json").read_text())
    payloads = {(kind, campus): payload for kind, campus, payload in initial_payloads(data)}
    assert payloads[("site_footer", None)]["links"] is None
    assert payloads[("site_meta", None)]["primary_nav"] is None
    assert payloads[("home_campus_board", None)]["campus_order"] == data["home"]["campusBoard"]["campusOrder"]
    assert payloads[("campus_profile", "yihua")]["map_url"] == ""
    assert "cta_label" not in payloads[("home_hero", None)]
