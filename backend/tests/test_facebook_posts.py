"""各校 Facebook 粉專貼文收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md）：
設定、Graph API 同步、轉成 campus_news 草稿、略過與權限。Meta 一律用 httpx.MockTransport 假造。"""
from __future__ import annotations

import io
import logging
import uuid
from datetime import datetime, timezone

from pathlib import Path

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select

from app.config import Settings
from app.facebook.models import FacebookPagePost, FacebookPageSync
from app.facebook.service import article_id, build_article
from app.facebook.sync import sync_pages
from app.media.models import MediaAsset, MediaKind
from app.operations.models import AuditLogEntry

API = "/api/website/v1/admin/facebook-posts"
CONTENT = "/api/website/v1/admin/content-items"
SYSTEM_TOKEN = "SYSTEM-USER-TOKEN-should-never-leak"
PAGE_TOKEN = "PAGE-TOKEN-should-never-leak"
YIHUA_PAGE = "1111111111"
MINGHUA_PAGE = "2222222222"
PICTURE = "https://scontent.xx.fbcdn.net/v/t39/photo.jpg?oe=ABC&_nc_sid=1"
VIDEO = "https://video.xx.fbcdn.net/o1/v/t2/reel.mp4?oe=ABC&_nc_sid=1"
MP4 = Path("/tmp/media-fixtures/test.mp4")  # conftest 的 _ensure_media_fixtures 產生


def _jpeg(color=(200, 120, 40)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (120, 90), color).save(buffer, "JPEG")
    return buffer.getvalue()


def _video_attachment(source: str | None = VIDEO) -> dict:
    """影片貼文（含 Reel）在 Graph 的樣子（2026-11-10 義華粉專實測）。"""
    media = {"image": {"height": 720, "src": PICTURE, "width": 405}}
    if source is not None:
        media["source"] = source
    return {"attachments": {"data": [{"media_type": "video", "media": media}]}}


def _post(post_id: str, message: str | None = "第一行標題\n\n第二段內文", picture: str | None = PICTURE, **extra) -> dict:
    row = {
        "id": post_id,
        "created_time": "2026-10-26T17:30:00+0000",  # 台北 10-27 凌晨
        "permalink_url": f"https://www.facebook.com/{post_id}",
        **extra,
    }
    if message is not None:
        row["message"] = message
    if picture is not None:
        row["full_picture"] = picture
    return row


class FakeMeta:
    """graph.facebook.com＋fbcdn.net。記下每個請求，最後檢查 token 沒有送到別的主機。"""

    def __init__(self) -> None:
        self.posts: dict[str, list[dict]] = {YIHUA_PAGE: [_post(f"{YIHUA_PAGE}_1")], MINGHUA_PAGE: []}
        self.picture_status = 200
        self.picture = _jpeg()
        self.video_status = 200
        self.video = MP4.read_bytes() if MP4.exists() else b""
        self.fail_posts_with: int | None = None
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host, path = request.url.host, request.url.path
        if host == "graph.facebook.com":
            # token 走 Authorization header，網址裡不能有：httpx 的 INFO 紀錄會印完整網址，
            # 放 query string 就會進正式站的 log（2026-11-10 本機實測抓到）。
            assert "access_token" not in request.url.params
            token = request.headers.get("authorization", "").removeprefix("Bearer ")
            assert token in (SYSTEM_TOKEN, PAGE_TOKEN)
            parts = path.strip("/").split("/")
            if len(parts) == 2:
                return httpx.Response(200, json={"access_token": PAGE_TOKEN, "id": parts[1]})
            if len(parts) == 3 and parts[2] == "published_posts":
                assert token == PAGE_TOKEN
                if self.fail_posts_with:
                    return httpx.Response(
                        self.fail_posts_with,
                        json={"error": {"message": f"Invalid token {PAGE_TOKEN}", "code": 190}},
                    )
                return httpx.Response(200, json={"data": self.posts.get(parts[1], [])})
        if host.endswith("fbcdn.net"):
            assert "access_token" not in request.url.params and "authorization" not in request.headers
            if path.endswith(".mp4"):
                if self.video_status != 200:
                    return httpx.Response(self.video_status)
                return httpx.Response(200, content=self.video, headers={"content-type": "video/mp4"})
            if self.picture_status != 200:
                return httpx.Response(self.picture_status)
            return httpx.Response(200, content=self.picture, headers={"content-type": "image/jpeg"})
        return httpx.Response(404)


def _settings(base: Settings, **overrides) -> Settings:
    return base.model_copy(update={
        "facebook_access_token": SYSTEM_TOKEN,
        "facebook_pages": f"yihua={YIHUA_PAGE},minghua={MINGHUA_PAGE}",
        **overrides,
    })


@pytest.fixture
def meta(app) -> FakeMeta:
    fake = FakeMeta()
    original = app.state.settings
    app.state.settings = _settings(original)
    app.state.facebook_transport = httpx.MockTransport(fake.handler)
    yield fake
    app.state.settings = original
    app.state.facebook_transport = None


async def _sync(app, meta: FakeMeta, campus_keys=None):
    return await sync_pages(
        app.state.session_factory, app.state.settings, campus_keys=campus_keys,
        transport=httpx.MockTransport(meta.handler),
    )


async def _only_post(db_session) -> FacebookPagePost:
    return (await db_session.scalars(select(FacebookPagePost))).one()


# ── 設定 ──────────────────────────────────────────────


def test_settings_parse_pages(isolated_settings):
    settings = isolated_settings.model_validate({
        **isolated_settings.model_dump(), "facebook_access_token": "t", "facebook_pages": " yihua = 12345 , minghua=67890 ",
    })
    assert settings.facebook_enabled
    assert settings.facebook_page_ids == {"yihua": "12345", "minghua": "67890"}
    assert "facebook_access_token" not in repr(settings)


@pytest.mark.parametrize("pages", ["yihua", "yihua=abc", "Yihua=12345", "yihua=12345,yihua=67890"])
def test_settings_reject_bad_pages(isolated_settings, pages):
    with pytest.raises(ValidationError):
        Settings.model_validate({**isolated_settings.model_dump(), "facebook_access_token": "t", "facebook_pages": pages})


def test_settings_require_token_and_pages_together(isolated_settings):
    with pytest.raises(ValidationError, match="同時設定"):
        Settings.model_validate({**isolated_settings.model_dump(), "facebook_access_token": "t"})
    with pytest.raises(ValidationError, match="同時設定"):
        Settings.model_validate({**isolated_settings.model_dump(), "facebook_pages": "yihua=12345"})
    assert not isolated_settings.facebook_enabled


# ── 欄位對照 ──────────────────────────────────────────


def _model(message: str | None, permalink: str | None = "https://www.facebook.com/p/1") -> FacebookPagePost:
    return FacebookPagePost(
        post_id="111_222",
        message=message,
        posted_at=datetime(2026, 10, 26, 17, 30, tzinfo=timezone.utc),
        permalink_url=permalink,
    )


def test_build_article_maps_fields():
    article = build_article(_model("🎃 萬聖節變裝遊行 #義華 #萬聖節\n\n孩子們穿上\n自己做的服裝。\n\n\n謝謝家長幫忙！"), "m-1")
    assert article["id"] == "fb-111-222" == article_id("111_222")
    assert article["date"] == "2026-10-27"  # 台北日期
    assert article["title"] == "萬聖節變裝遊行"
    assert article["description"] == "孩子們穿上 自己做的服裝。 謝謝家長幫忙！"
    assert article["body"] == [
        {"type": "paragraph", "text": "孩子們穿上 自己做的服裝。"},
        {"type": "paragraph", "text": "謝謝家長幫忙！"},
        {"type": "link", "label": "在 Facebook 看原文", "url": "https://www.facebook.com/p/1"},
    ]
    assert article["image"] == "m-1"


def test_build_article_with_video_puts_video_block_first():
    article = build_article(_model("運動會\n\n孩子們跑得好快。"), "m-1", "v-1")
    assert article["image"] == "m-1"
    assert article["body"] == [
        {"type": "video", "video": "v-1", "caption": ""},
        {"type": "paragraph", "text": "孩子們跑得好快。"},
        {"type": "link", "label": "在 Facebook 看原文", "url": "https://www.facebook.com/p/1"},
    ]
    # 段落很多時，影片、段落、原文連結加起來不超過內文上限。
    long_post = _model("標題\n\n" + "\n\n".join(f"第 {i} 段" for i in range(60)))
    with_video, without_video = build_article(long_post, "m", "v")["body"], build_article(long_post, "m")["body"]
    assert len(with_video) == len(without_video) == 40
    assert with_video[0]["type"] == "video" and with_video[-1]["type"] == without_video[-1]["type"] == "link"


def test_build_article_long_title_keeps_full_line_in_body():
    line = "一" * 60
    article = build_article(_model(line, permalink=None), "m")
    assert len(article["title"]) == 40 and article["title"].endswith("…")
    assert article["body"] == [{"type": "paragraph", "text": line}]


def test_build_article_without_text_uses_fallback_title():
    article = build_article(_model("#只有標籤"), "m")
    assert article["title"] == "粉專貼文"
    assert article["description"] == ""


def test_build_article_cleans_real_page_post_shape():
    """2026-11-10 義華粉專實測的樣子：第一行 emoji＋【標題】、句中 hashtag、結尾一整段 hashtag。"""
    message = (
        "🎃👻【萬聖節變裝派對｜小小變裝家出動啦！】👻🎃\n\n"
        "🎶 很開心邀請 #公視台語台《#穎仔穎仔育》 團隊蒞臨校園！\n"
        "孩子們跟著唱跳 🎵 #台語唱跳 #穎仔穎仔育\n\n"
        "#萬聖節闖關活動 🎃\n#小小變裝家 👻\n#921國家防災日 🌏 #防震演練 🏠\n＃常春藤幼兒園 #寶貝您的寶貝"
    )
    article = build_article(_model(message, permalink=None), "m")
    assert article["title"] == "萬聖節變裝派對｜小小變裝家出動啦！"
    # 內文保留 emoji 交給人決定；句中的 hashtag 留字、行尾與整行的 hashtag 拿掉。
    assert article["body"] == [
        {"type": "paragraph", "text": "🎶 很開心邀請 公視台語台《穎仔穎仔育》 團隊蒞臨校園！ 孩子們跟著唱跳"},
    ]
    assert article["description"] == "🎶 很開心邀請 公視台語台《穎仔穎仔育》 團隊蒞臨校園！ 孩子們跟著唱跳"


def test_build_article_title_skips_emoji_only_line_and_keeps_partial_brackets():
    article = build_article(_model("🎉🎉🎉\n【公告】下週一停課 📢\n\n請家長留意。", permalink=None), "m")
    assert article["title"] == "【公告】下週一停課"
    assert article["body"] == [{"type": "paragraph", "text": "請家長留意。"}]


# ── 同步 ──────────────────────────────────────────────


async def test_sync_writes_posts_and_keeps_status(app, meta, db_session):
    results = await _sync(app, meta)
    assert [(r.campus_key, r.count, r.error) for r in results] == [("yihua", 1, None), ("minghua", 0, None)]
    post = await _only_post(db_session)
    assert (post.campus_key, post.status, post.picture_url) == ("yihua", "new", PICTURE)

    post.status = "dismissed"
    await db_session.commit()
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_1", message="改過的內文", picture=PICTURE + "&v=2")]
    await _sync(app, meta, ["yihua"])
    db_session.expire_all()
    post = await _only_post(db_session)
    assert (post.status, post.message, post.picture_url) == ("dismissed", "改過的內文", PICTURE + "&v=2")
    sync_row = await db_session.get(FacebookPageSync, "yihua")
    assert sync_row.last_error is None and sync_row.last_count == 1


async def test_sync_skips_empty_posts(app, meta, db_session):
    meta.posts[YIHUA_PAGE] = [
        _post(f"{YIHUA_PAGE}_1", message=None, picture=None),
        _post(f"{YIHUA_PAGE}_2", message="只有字", picture=None),
        _post(f"{YIHUA_PAGE}_3", picture="http://insecure.example/x.jpg"),
    ]
    await _sync(app, meta, ["yihua"])
    rows = (await db_session.scalars(select(FacebookPagePost).order_by(FacebookPagePost.post_id))).all()
    assert [(r.post_id, r.picture_url) for r in rows] == [(f"{YIHUA_PAGE}_2", None), (f"{YIHUA_PAGE}_3", None)]


async def test_sync_reads_video_source(app, meta, db_session):
    album = {"attachments": {"data": [{"media_type": "album", "media": {"image": {"src": PICTURE}}}]}}
    meta.posts[YIHUA_PAGE] = [
        _post(f"{YIHUA_PAGE}_1", **_video_attachment()),
        _post(f"{YIHUA_PAGE}_2", **album),
        _post(f"{YIHUA_PAGE}_3", **_video_attachment("http://insecure.example/reel.mp4")),
        _post(f"{YIHUA_PAGE}_4", **_video_attachment(None)),
    ]
    await _sync(app, meta, ["yihua"])
    rows = (await db_session.scalars(select(FacebookPagePost).order_by(FacebookPagePost.post_id))).all()
    assert [r.video_url for r in rows] == [VIDEO, None, None, None]
    posts_request = next(r for r in meta.requests if r.url.path.endswith("/published_posts"))
    assert "attachments{media_type,media{source}}" in posts_request.url.params["fields"]

    # 影片網址跟照片一樣每次同步換新；處理狀態不動。
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_1", **_video_attachment(VIDEO + "&v=2"))]
    await _sync(app, meta, ["yihua"])
    db_session.expire_all()
    assert (await db_session.scalars(select(FacebookPagePost.video_url).where(FacebookPagePost.post_id == f"{YIHUA_PAGE}_1"))).one() == VIDEO + "&v=2"


async def test_sync_error_records_code_without_token(app, meta, db_session, caplog):
    # 連 DEBUG／INFO 都要看：httpx 在 INFO 會印出完整請求網址。
    caplog.set_level(logging.DEBUG)
    meta.fail_posts_with = 400
    results = await _sync(app, meta, ["yihua"])
    assert results[0].error == "讀取貼文（HTTP 400、code 190）"
    sync_row = await db_session.get(FacebookPageSync, "yihua")
    assert sync_row.last_error == "讀取貼文（HTTP 400、code 190）" and sync_row.last_success_at is None
    assert PAGE_TOKEN not in caplog.text and SYSTEM_TOKEN not in caplog.text


async def test_sync_sends_appsecret_proof(app, meta):
    app.state.settings = _settings(app.state.settings, facebook_app_secret="app-secret")
    await _sync(app, meta, ["yihua"])
    graph_requests = [r for r in meta.requests if r.url.host == "graph.facebook.com"]
    assert graph_requests and all(len(r.url.params["appsecret_proof"]) == 64 for r in graph_requests)


async def test_sync_disabled_does_nothing(app, db_session):
    assert await sync_pages(app.state.session_factory, app.state.settings) == []


# ── 後台 API ──────────────────────────────────────────


async def test_list_not_configured(admin_client):
    response = await admin_client.get(API, params={"campus_key": "yihua"})
    assert response.status_code == 200
    assert response.json()["configured"] is False and response.json()["posts"] == []
    response = await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "FACEBOOK_NOT_CONFIGURED"


async def test_sync_now_and_list(admin_client, meta):
    response = await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is True and body["counts"] == {"new": 1, "imported": 0, "dismissed": 0}
    assert body["sync"]["last_count"] == 1 and body["sync"]["last_error"] is None
    post = body["posts"][0]
    assert post["has_picture"] is True and "picture_url" not in post
    assert post["has_video"] is False and "video_url" not in post
    assert SYSTEM_TOKEN not in response.text and PAGE_TOKEN not in response.text


async def test_picture_proxy(admin_client, meta, app, db_session):
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    response = await admin_client.get(f"{API}/{post.id}/picture")
    assert response.status_code == 200
    assert response.content == meta.picture and response.headers["content-type"] == "image/jpeg"
    assert "max-age" in response.headers["cache-control"]

    post.picture_url = "https://evil.example/x.jpg"
    await db_session.commit()
    response = await admin_client.get(f"{API}/{post.id}/picture")
    assert response.status_code == 404 and response.json()["detail"]["code"] == "FACEBOOK_PICTURE_UNTRUSTED"
    assert not any(r.url.host == "evil.example" for r in meta.requests)


async def test_import_creates_media_and_draft(admin_client, meta, app, db_session):
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["article_id"] == f"fb-{YIHUA_PAGE}-1" and body["post"]["status"] == "imported"
    assert body["article_title"] == "第一行標題"
    assert body["video_included"] is False and body["video_skipped_reason"] is None

    item = (await admin_client.get(f"{CONTENT}/campus_news", params={"campus_key": "yihua"})).json()
    article = item["latest_revision"]["payload"]["articles"][0]
    assert article["title"] == "第一行標題" and article["date"] == "2026-10-27"
    asset = await db_session.get(MediaAsset, uuid.UUID(article["image"]))
    assert asset.campus_key == "yihua" and asset.source_attribution == "Facebook 粉專貼文"
    assert item["current_published_revision_id"] is None  # 只是草稿

    again = await admin_client.post(f"{API}/{post.id}/import")
    assert again.status_code == 409
    actions = set(await db_session.scalars(select(AuditLogEntry.action)))
    assert "facebook_post.import" in actions


async def test_import_keeps_existing_articles_and_reuses_media(admin_client, meta, app, db_session):
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_1"), _post(f"{YIHUA_PAGE}_2", message="另一則")]
    await _sync(app, meta, ["yihua"])
    posts = (await db_session.scalars(select(FacebookPagePost).order_by(FacebookPagePost.post_id))).all()
    for post in posts:
        assert (await admin_client.post(f"{API}/{post.id}/import")).status_code == 200
    item = (await admin_client.get(f"{CONTENT}/campus_news", params={"campus_key": "yihua"})).json()
    articles = item["latest_revision"]["payload"]["articles"]
    assert [a["title"] for a in articles] == ["另一則", "第一行標題"]
    # 兩則用同一張圖：素材庫只有一份。
    assert await db_session.scalar(select(func.count()).select_from(MediaAsset)) == 1


async def test_import_expired_picture(admin_client, meta, app, db_session):
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    meta.picture_status = 403
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "FACEBOOK_PICTURE_EXPIRED"
    db_session.expire_all()
    assert (await _only_post(db_session)).status == "new"


# ── 影片貼文 ──────────────────────────────────────────


async def _video_post(app, meta, db_session) -> FacebookPagePost:
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_1", **_video_attachment())]
    await _sync(app, meta, ["yihua"])
    return await _only_post(db_session)


async def _draft_article(admin_client) -> dict:
    item = (await admin_client.get(f"{CONTENT}/campus_news", params={"campus_key": "yihua"})).json()
    return item["latest_revision"]["payload"]["articles"][0]


async def _media_kinds(db_session) -> list[str]:
    return sorted(kind.value for kind in await db_session.scalars(select(MediaAsset.kind)))


@pytest.mark.skipif(not MP4.exists(), reason="需要 ffmpeg 產生測試影片")
async def test_import_video_post_puts_video_in_media_and_body(admin_client, meta, app, db_session):
    post = await _video_post(app, meta, db_session)
    listed = (await admin_client.get(API, params={"campus_key": "yihua"})).json()
    assert listed["posts"][0]["has_video"] is True and VIDEO not in str(listed)

    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["video_included"] is True and body["video_skipped_reason"] is None

    article = await _draft_article(admin_client)
    assert [block["type"] for block in article["body"]] == ["video", "paragraph", "link"]
    video = await db_session.get(MediaAsset, uuid.UUID(article["body"][0]["video"]))
    assert (video.kind, video.campus_key, video.source_attribution) == (MediaKind.VIDEO, "yihua", "Facebook 粉專貼文")
    assert video.duration_seconds and video.original_filename == "facebook.mp4"
    cover = await db_session.get(MediaAsset, uuid.UUID(article["image"]))
    assert cover.kind == MediaKind.IMAGE
    cover_id, video_id = cover.id, video.id
    db_session.expire_all()
    post = await _only_post(db_session)
    assert (post.media_id, post.video_media_id) == (cover_id, video_id)
    # 影片檔只從 FB CDN 拿，不帶 token（FakeMeta.handler 會擋）；素材用上之後不能刪。
    assert any(r.url.path.endswith(".mp4") for r in meta.requests)
    assert (await admin_client.delete(f"/api/website/v1/admin/media/{video_id}")).status_code == 409


async def test_import_video_too_large_still_imports_without_video(admin_client, meta, app, db_session):
    app.state.settings = _settings(app.state.settings, media_max_video_mb=1)
    meta.video = b"0" * (1024 * 1024 + 1)
    post = await _video_post(app, meta, db_session)
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["video_included"] is False and body["video_skipped_reason"] == "影片超過 1 MB"
    article = await _draft_article(admin_client)
    assert [block["type"] for block in article["body"]] == ["paragraph", "link"]
    assert await _media_kinds(db_session) == ["image"]


async def test_import_broken_video_still_imports_without_video(admin_client, meta, app, db_session):
    meta.video = b"this is not an mp4 at all\n" * 20
    post = await _video_post(app, meta, db_session)
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["video_included"] is False and body["video_skipped_reason"]
    # 影片退掉了，封面照片素材與草稿照樣存下來。
    article = await _draft_article(admin_client)
    assert [block["type"] for block in article["body"]] == ["paragraph", "link"]
    assert await _media_kinds(db_session) == ["image"]
    db_session.expire_all()
    post = await _only_post(db_session)
    assert post.status == "imported" and post.video_media_id is None


async def test_import_video_from_unexpected_host_or_format_skips_video(admin_client, meta, app, db_session):
    post = await _video_post(app, meta, db_session)
    post.video_url = "https://evil.example/reel.mp4"
    await db_session.commit()
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    assert response.json()["video_included"] is False
    assert response.json()["video_skipped_reason"] == "影片網址不是 Facebook 的影片主機"
    assert not any(r.url.host == "evil.example" for r in meta.requests)

    # 回來的不是 mp4（FakeMeta 對非 .mp4 的網址回 JPEG）。
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_2", **_video_attachment("https://video.xx.fbcdn.net/v/reel.webm?oe=1"))]
    await _sync(app, meta, ["yihua"])
    second = (await db_session.scalars(select(FacebookPagePost).where(FacebookPagePost.post_id == f"{YIHUA_PAGE}_2"))).one()
    response = await admin_client.post(f"{API}/{second.id}/import")
    assert response.status_code == 200, response.text
    assert response.json()["video_skipped_reason"] == "影片格式不支援"
    assert await _media_kinds(db_session) == ["image"]


async def test_import_expired_video_asks_for_sync_and_keeps_nothing(admin_client, meta, app, db_session):
    post = await _video_post(app, meta, db_session)
    meta.video_status = 403
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "FACEBOOK_VIDEO_EXPIRED"
    assert await _media_kinds(db_session) == []
    db_session.expire_all()
    assert (await _only_post(db_session)).status == "new"


@pytest.mark.skipif(not MP4.exists(), reason="需要 ffmpeg 產生測試影片")
async def test_import_video_when_news_full_leaves_no_media(admin_client, meta, app, db_session, monkeypatch, tmp_path):
    import app.facebook.routes as routes

    monkeypatch.setattr(routes, "CAMPUS_NEWS_MAX_ARTICLES", 0)
    post = await _video_post(app, meta, db_session)
    media_root = Path(app.state.settings.media_root)
    before = {path for path in media_root.rglob("*") if path.is_file()} if media_root.exists() else set()
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "FACEBOOK_NEWS_FULL"
    assert await _media_kinds(db_session) == []
    # 已經寫進儲存空間的照片與影片檔也要清掉，不留孤兒檔。
    after = {path for path in media_root.rglob("*") if path.is_file()} if media_root.exists() else set()
    assert after == before


async def test_import_without_picture(admin_client, meta, app, db_session):
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_1", picture=None)]
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 422 and response.json()["detail"]["code"] == "FACEBOOK_POST_NO_PICTURE"


async def test_import_when_news_full_leaves_no_media(admin_client, meta, app, db_session, monkeypatch):
    import app.facebook.routes as routes

    monkeypatch.setattr(routes, "CAMPUS_NEWS_MAX_ARTICLES", 0)
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "FACEBOOK_NEWS_FULL"
    assert await db_session.scalar(select(func.count()).select_from(MediaAsset)) == 0
    db_session.expire_all()
    assert (await _only_post(db_session)).status == "new"


async def test_dismiss_and_restore(admin_client, meta, app, db_session):
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    assert (await admin_client.post(f"{API}/{post.id}/dismiss")).json()["status"] == "dismissed"
    assert (await admin_client.post(f"{API}/{post.id}/dismiss")).status_code == 409
    listed = (await admin_client.get(API, params={"campus_key": "yihua", "status": "dismissed"})).json()
    assert [p["id"] for p in listed["posts"]] == [str(post.id)]
    assert (await admin_client.post(f"{API}/{post.id}/restore")).json()["status"] == "new"


async def test_campus_scope(minghua_client, editor_client, meta, app, db_session):
    await _sync(app, meta, ["yihua"])
    post = await _only_post(db_session)
    # 明華的管理者看不到、動不了義華的貼文。
    assert (await minghua_client.get(API, params={"campus_key": "yihua"})).status_code == 404
    assert (await minghua_client.get(f"{API}/{post.id}/picture")).status_code == 404
    assert (await minghua_client.post(f"{API}/{post.id}/import")).status_code == 404
    assert (await minghua_client.post(f"{API}/sync", json={"campus_key": "yihua"})).status_code == 404
    # 義華的內容編輯可以轉成草稿（發布照舊要送審）。
    response = await editor_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text


# ── 背景迴圈 ──────────────────────────────────────────


async def test_loop_runs_and_stops(app, monkeypatch):
    import asyncio

    from app.workers import facebook_loop

    calls: list[int] = []
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings):
        calls.append(1)
        ran.set()
        if len(calls) == 1:
            raise RuntimeError("第一輪失敗也要繼續")
        return []

    monkeypatch.setattr(facebook_loop, "sync_pages", fake_sync)
    loop = facebook_loop.FacebookSyncLoop(
        app.state.session_factory, app.state.settings, interval_seconds=0.01, first_delay_seconds=0
    )
    loop.start()
    await asyncio.wait_for(ran.wait(), timeout=2)
    for _ in range(100):
        if len(calls) >= 2:
            break
        await asyncio.sleep(0.01)
    await loop.stop(timeout=2)
    assert len(calls) >= 2 and not loop.running and loop.last_run_at is not None
