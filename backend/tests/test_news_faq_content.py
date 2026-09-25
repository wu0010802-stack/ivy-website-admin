"""消息的適用範圍、結構化內文、首頁推薦與活動時間；各校消息（campus_news）
與全站共用常見問題（shared_faq）的欄位規則與權限。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.content.schemas import (
    CampusFaqPayload,
    CampusNewsPayload,
    HomeNewsPayload,
    NewsArticlePayload,
    NewsEventPayload,
    SharedFaqPayload,
)

API = "/api/website/v1/admin/content-items"
MEDIA = Path("/tmp/media-fixtures")


def _article(**overrides) -> dict:
    base = {
        "id": "a1", "date": "2026-10-01", "scope": "global", "campus_keys": [], "category": "校園日常",
        "title": "標題", "description": "摘要", "image": "garden", "alt": "替代文字",
    }
    return {**base, **overrides}


def _event(**overrides) -> dict:
    base = {"id": "e1", "date": "2026-10-03", "scope": "global", "title": "活動", "description": "說明"}
    return {**base, **overrides}


def _news(**overrides) -> dict:
    return {"sample_note": "", "articles": [], "events": [], **overrides}


async def _upload(client, campus_key: str | None = None) -> str:
    data = {"kind": "image"}
    if campus_key:
        data["campus_key"] = campus_key
    response = await client.post(
        "/api/website/v1/admin/media",
        data=data,
        files={"file": ("test.jpg", (MEDIA / "test.jpg").read_bytes(), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _save_and_publish(client, kind: str, payload: dict, campus_key: str | None = None):
    query = f"?campus_key={campus_key}" if campus_key else ""
    current = (await client.get(f"{API}/{kind}{query}")).json()
    saved = await client.post(
        f"{API}/{kind}/revisions{query}",
        json={"expected_version": current["latest_version"], "payload": payload},
    )
    assert saved.status_code == 201, saved.text
    published = await client.post(
        f"{API}/{kind}/publish{query}", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    return saved.json()


# ---------------------------------------------------------------------------
# 適用範圍（scope）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "scope", "keys"),
    [("義華校", "campus", ["yihua"]), ("仁武校", "campus", ["renwu"]), ("全校", "global", []), ("親子館", "global", [])],
)
def test_legacy_campus_label_becomes_scope(label, scope, keys):
    legacy = {k: v for k, v in _article().items() if k not in ("scope", "campus_keys")}
    article = NewsArticlePayload.model_validate({**legacy, "campus": label}).model_dump()
    assert (article["scope"], article["campus_keys"]) == (scope, keys)
    assert "campus" not in article


def test_campus_scope_needs_known_keys_and_is_normalised():
    article = NewsArticlePayload.model_validate(
        _article(scope="campus", campus_keys=["renwu", "yihua", "renwu"])
    )
    assert article.campus_keys == ["yihua", "renwu"]
    # 全校的消息不留校區清單。
    assert NewsArticlePayload.model_validate(_article(campus_keys=["yihua"])).campus_keys == []
    with pytest.raises(ValidationError, match="至少要選一校"):
        NewsArticlePayload.model_validate(_article(scope="campus", campus_keys=[]))
    with pytest.raises(ValidationError, match="不認得的校區"):
        NewsArticlePayload.model_validate(_article(scope="campus", campus_keys=["taipei"]))
    with pytest.raises(ValidationError):
        NewsEventPayload.model_validate(_event(scope="everywhere"))


# ---------------------------------------------------------------------------
# 結構化內文
# ---------------------------------------------------------------------------


def test_body_accepts_the_five_block_types():
    media_id = "0b4b7b2e-5d8e-4a44-9f4b-2f5c3c9d1e11"
    body = [
        {"type": "heading", "text": "活動花絮"},
        {"type": "paragraph", "text": "孩子們在菜園裡澆水。"},
        {"type": "list", "items": ["帶水壺", "", "穿雨鞋"], "ordered": True},
        {"type": "image", "image": media_id.upper(), "alt": "菜園", "caption": "九月的菜園"},
        {"type": "link", "label": "活動相簿", "url": "https://example.com/album"},
    ]
    article = NewsArticlePayload.model_validate(_article(body=body)).model_dump()
    assert [block["type"] for block in article["body"]] == ["heading", "paragraph", "list", "image", "link"]
    assert article["body"][2]["items"] == ["帶水壺", "穿雨鞋"]
    assert article["body"][3]["image"] == media_id


@pytest.mark.parametrize(
    "block",
    [
        {"type": "html", "text": "<b>粗體</b>"},
        {"type": "paragraph", "text": "   "},
        {"type": "paragraph", "text": "javascript:alert(1)"},
        {"type": "heading", "text": "字" * 61},
        {"type": "list", "items": ["", " "]},
        {"type": "image", "image": "garden"},
        {"type": "link", "label": "報名", "url": "javascript:alert(1)"},
        {"type": "link", "label": "寫信", "url": "mailto:a@example.com"},
        {"type": "link", "label": "報名", "url": "example.com/form"},
        {"type": "link", "label": "", "url": "https://example.com"},
        {"type": "link", "label": "報名", "url": "https://example.com/a b"},
    ],
)
def test_body_rejects_unsafe_or_unknown_blocks(block):
    with pytest.raises(ValidationError):
        NewsArticlePayload.model_validate(_article(body=[block]))


def test_body_block_count_is_bounded():
    blocks = [{"type": "paragraph", "text": f"第 {i} 段"} for i in range(41)]
    with pytest.raises(ValidationError):
        NewsArticlePayload.model_validate(_article(body=blocks))


# ---------------------------------------------------------------------------
# 首頁推薦與顯示筆數
# ---------------------------------------------------------------------------


def test_featured_and_display_count():
    payload = HomeNewsPayload.model_validate(
        _news(articles=[_article(featured=True), _article(id="a2")], home_display_count=6)
    ).model_dump()
    assert [a["featured"] for a in payload["articles"]] == [True, False]
    assert payload["home_display_count"] == 6
    assert HomeNewsPayload.model_validate(_news()).home_display_count is None
    for bad in (0, 31):
        with pytest.raises(ValidationError):
            HomeNewsPayload.model_validate(_news(home_display_count=bad))


# ---------------------------------------------------------------------------
# 活動時間、地點與連結
# ---------------------------------------------------------------------------


def test_event_time_location_and_link():
    event = NewsEventPayload.model_validate(_event(
        all_day=False, start_time="09:30", end_time="11:00", location="義華校 一樓大廳",
        link_url=" https://example.com/signup", link_label="報名表",
    )).model_dump()
    assert (event["start_time"], event["end_time"]) == ("09:30", "11:00")
    assert event["location"] == "義華校 一樓大廳"
    assert event["link_url"] == "https://example.com/signup"

    # 全天活動不留時間；沒有網址就不留連結文字。
    whole_day = NewsEventPayload.model_validate(_event(start_time="09:30", link_label="報名表")).model_dump()
    assert whole_day["all_day"] is True and whole_day["start_time"] is None and whole_day["link_label"] == ""
    # 舊資料（沒有這些欄位）照樣通過，視為全天。
    assert NewsEventPayload.model_validate({**_event(), "campus": "全校"}).all_day is True


@pytest.mark.parametrize(
    "overrides",
    [
        {"all_day": False},
        {"all_day": False, "start_time": "9:30"},
        {"all_day": False, "start_time": "24:00"},
        {"all_day": False, "start_time": "10:00", "end_time": "10:00"},
        {"all_day": False, "start_time": "10:00", "end_time": "09:00"},
        {"link_url": "ftp://example.com"},
        {"link_url": "tel:0912345678"},
        {"location": "地" * 81},
    ],
)
def test_event_rejects_bad_times_and_links(overrides):
    with pytest.raises(ValidationError):
        NewsEventPayload.model_validate(_event(**overrides))


@pytest.mark.parametrize("url", ["https://a b", "https://example.com/a\u3000b", "https://example.com/\u00a0x", "https://a\tb"])
def test_event_link_with_inner_whitespace_is_rejected(url):
    """官網 safeWebUrl 與後台 webUrlInvalid 都用 ^https?://\\S+$：後端放行的話
    後台存得進去，官網卻默默不顯示連結（半形空白以前還會被悄悄刪掉、變成另一個網址）。"""
    with pytest.raises(ValidationError, match="不能有空白"):
        NewsEventPayload.model_validate(_event(link_url=url))
    # 頭尾的空白（含全形）照樣去掉，不算錯。
    event = NewsEventPayload.model_validate(_event(link_url="\u3000https://example.com/signup \n"))
    assert event.link_url == "https://example.com/signup"


# ---------------------------------------------------------------------------
# 各校消息：分校人員只編本校
# ---------------------------------------------------------------------------


def test_campus_news_has_no_scope_or_featured():
    payload = CampusNewsPayload.model_validate({
        "articles": [_article(scope="global", featured=True)],
        "events": [_event(scope="campus", campus_keys=["yihua"])],
    }).model_dump()
    assert "scope" not in payload["articles"][0] and "featured" not in payload["articles"][0]
    assert "campus_keys" not in payload["events"][0]
    with pytest.raises(ValidationError):
        CampusNewsPayload.model_validate({"articles": [_article(id=f"a{i}") for i in range(13)], "events": []})


@pytest.mark.asyncio
async def test_campus_admin_edits_only_own_campus_news(minghua_client, admin_client, public_client):
    payload = {"articles": [_article(id="open-house")], "events": [_event(id="sports-day")]}
    await _save_and_publish(minghua_client, "campus_news", payload, "minghua")

    other = await minghua_client.post(
        f"{API}/campus_news/revisions?campus_key=yihua", json={"expected_version": 0, "payload": payload}
    )
    assert other.status_code == 404
    shared = await minghua_client.post(
        f"{API}/home_news/revisions", json={"expected_version": 0, "payload": _news()}
    )
    assert shared.status_code == 403
    # 分校內容一定要指定校區，不能存成一份沒有校區的「各校消息」。
    missing = await admin_client.post(
        f"{API}/campus_news/revisions", json={"expected_version": 0, "payload": payload}
    )
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "CAMPUS_KEY_REQUIRED"

    content = (await public_client.get("/api/website/v1/public/site")).json()["content"]
    assert [a["id"] for a in content["campus_news"]["minghua"]["articles"]] == ["open-house"]
    assert "yihua" not in content["campus_news"]


@pytest.mark.asyncio
async def test_campus_editor_cannot_publish_or_touch_other_campus(editor_client):
    payload = {"articles": [_article()], "events": []}
    saved = await editor_client.post(
        f"{API}/campus_news/revisions?campus_key=yihua", json={"expected_version": 0, "payload": payload}
    )
    assert saved.status_code == 201, saved.text
    publish = await editor_client.post(
        f"{API}/campus_news/publish?campus_key=yihua",
        json={"revision_id": saved.json()["latest_revision"]["id"]},
    )
    assert publish.status_code == 403
    other = await editor_client.get(f"{API}/campus_news?campus_key=minghua")
    assert other.status_code == 404


@pytest.mark.asyncio
async def test_news_body_images_are_protected_and_campus_bound(admin_client, minghua_client):
    shared_media = await _upload(admin_client)
    body = [{"type": "image", "image": shared_media, "alt": "菜園"}]
    await _save_and_publish(admin_client, "home_news", _news(articles=[_article(body=body)]))
    assert (await admin_client.delete(f"/api/website/v1/admin/media/{shared_media}")).status_code == 409

    # 分校消息的內文圖片只能用自己校或共用的素材。
    yihua_media = await _upload(admin_client, "yihua")
    response = await minghua_client.post(
        f"{API}/campus_news/revisions?campus_key=minghua",
        json={"expected_version": 0, "payload": {
            "articles": [_article(body=[{"type": "image", "image": yihua_media}])], "events": [],
        }},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_CROSS_CAMPUS"


# ---------------------------------------------------------------------------
# 常見問題：全站共用＋各校
# ---------------------------------------------------------------------------


def test_faq_rules():
    shared = SharedFaqPayload.model_validate({"items": [
        {"id": "f1", "q": "要帶什麼？", "a": "水壺", "scope": "campus", "campus_keys": ["renwu"]},
        {"id": "f2", "q": "可以參觀嗎？", "a": "可以", "enabled": False},
    ]}).model_dump()
    assert shared["items"][0]["campus_keys"] == ["renwu"] and shared["items"][1]["enabled"] is False
    with pytest.raises(ValidationError, match="不可重複"):
        SharedFaqPayload.model_validate({"items": [{"id": "f1", "q": "a", "a": "b"}] * 2})
    with pytest.raises(ValidationError):
        SharedFaqPayload.model_validate({"items": [{"id": "f1", "q": " ", "a": "b"}]})

    # 各校可以沒有自己的題目（全部用共用題目），舊資料沒有新欄位照樣通過。
    empty = CampusFaqPayload.model_validate({"items": []}).model_dump()
    assert empty == {"items": [], "include_shared": True, "shared_position": "before"}
    legacy = CampusFaqPayload.model_validate({"items": [{"q": "問", "a": "答"}]}).model_dump()
    assert legacy["items"][0]["enabled"] is True
    with pytest.raises(ValidationError):
        CampusFaqPayload.model_validate({"items": [], "shared_position": "middle"})
    with pytest.raises(ValidationError):
        CampusFaqPayload.model_validate({"items": [{"q": "問", "a": "答"}] * 21})


def test_campus_faq_shown_items_need_question_and_answer():
    """「本校不顯示」產生的是只有問題的停用題；之後切回顯示卻沒寫回答，官網就會
    出現一題空白的回答，所以顯示中的題目問題與回答都要有。"""
    hidden = CampusFaqPayload.model_validate({"items": [{"q": "要帶什麼？", "a": "", "enabled": False}]})
    assert hidden.items[0].enabled is False
    for item in ({"q": "要帶什麼？", "a": ""}, {"q": "要帶什麼？", "a": "  "}, {"q": " ", "a": "水壺"}):
        with pytest.raises(ValidationError, match="問題與回答都不能空白"):
            CampusFaqPayload.model_validate({"items": [item]})


@pytest.mark.asyncio
async def test_campus_faq_with_blank_shown_item_cannot_be_published(db_session, admin_client):
    """規則收緊前存下的草稿（顯示中卻沒有回答）發布時擋下，不讓空白回答上官網。"""
    from app.content import service

    item = await service.get_or_create_content_item(db_session, "campus_faq", "yihua")
    revision = await service.create_revision(
        db_session, item,
        {"items": [{"q": "有校車嗎？", "a": "有", "enabled": True}, {"q": "要帶什麼？", "a": "", "enabled": True}]},
        0, None,
    )
    await db_session.commit()
    response = await admin_client.post(
        f"{API}/campus_faq/publish?campus_key=yihua", json={"revision_id": str(revision.id)}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CONTENT_NOT_READY"
    assert "第 2 題" in response.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_shared_faq_is_shared_only_and_public_hides_disabled(admin_client, minghua_client, public_client):
    shared = {"items": [
        {"id": "f1", "q": "要帶什麼？", "a": "水壺"},
        {"id": "f2", "q": "停用的題目", "a": "不該出現", "enabled": False},
    ]}
    denied = await minghua_client.post(
        f"{API}/shared_faq/revisions", json={"expected_version": 0, "payload": shared}
    )
    assert denied.status_code == 403
    await _save_and_publish(admin_client, "shared_faq", shared)
    await _save_and_publish(minghua_client, "campus_faq", {
        "items": [
            {"q": "明華的題目", "a": "明華的回答"},
            {"q": "要帶什麼？", "a": "明華不顯示這題", "enabled": False},
            {"q": "明華停用的私房題", "a": "不該出現", "enabled": False},
            # 跟停用的共用題目同一題：共用那題官網本來就不顯示，不必留記號。
            {"q": "停用的題目", "a": "", "enabled": False},
        ],
        "shared_position": "after",
    }, "minghua")

    content = (await public_client.get("/api/website/v1/public/site")).json()["content"]
    assert [item["id"] for item in content["shared_faq"]["items"]] == ["f1"]
    minghua = content["campus_faq"]["minghua"]
    assert minghua["shared_position"] == "after"
    # 停用的本校題目只在藏住同一題共用題目時留下問題文字（官網靠它藏那一題），
    # 回答不輸出；跟共用題目無關的停用題整題不輸出。
    assert minghua["items"] == [
        {"q": "明華的題目", "a": "明華的回答", "enabled": True},
        {"q": "要帶什麼？", "a": "", "enabled": False},
    ]
    assert "明華停用的私房題" not in json.dumps(content, ensure_ascii=False)


@pytest.mark.asyncio
async def test_public_faq_marker_needs_shared_question_for_that_campus(admin_client, public_client):
    """共用題目只給別校時，本校同一題的停用記號也不輸出；還沒有共用題目時全部不輸出。"""
    await _save_and_publish(admin_client, "campus_faq", {
        "items": [{"q": "有校車嗎？", "a": "", "enabled": False}, {"q": "要帶什麼？", "a": "", "enabled": False}],
    }, "yihua")
    content = (await public_client.get("/api/website/v1/public/site")).json()["content"]
    assert content["campus_faq"]["yihua"]["items"] == []

    await _save_and_publish(admin_client, "shared_faq", {"items": [
        {"id": "f1", "q": "要帶什麼？", "a": "水壺"},
        {"id": "f2", "q": "有校車嗎？", "a": "仁武有", "scope": "campus", "campus_keys": ["renwu"]},
    ]})
    content = (await public_client.get("/api/website/v1/public/site")).json()["content"]
    assert content["campus_faq"]["yihua"]["items"] == [{"q": "要帶什麼？", "a": "", "enabled": False}]
