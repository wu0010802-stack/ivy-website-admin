"""Instagram 貼文進同一個粉專收件匣（docs/specs/2026-11-12-external-integrations-design.md §2）：
設定、Graph 同步、狀態、來源篩選、轉成 campus_news 草稿。Meta 一律用 httpx.MockTransport 假造，
沿用 test_facebook_posts.py 的假 Meta（同一把 Page token、同一個收件匣）。"""
from __future__ import annotations

import logging
import uuid

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.facebook import graph
from app.facebook.graph import is_meta_cdn
from app.facebook.models import FacebookPagePost, FacebookPageSync
from app.facebook.service import build_article
from app.media.models import MediaAsset, MediaKind
from app.operations.models import AuditLogEntry
from tests.test_facebook_posts import (
    API,
    CONTENT,
    MINGHUA_PAGE,
    MP4,
    PAGE_TOKEN,
    PICTURE,
    SYSTEM_TOKEN,
    YIHUA_PAGE,
    FakeMeta,
    _model,
    _settings,
    _sync,
)

IG_ID = "17841400000000001"
IG_PICTURE = "https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-15/photo.jpg?_nc_sid=1&oe=ABC"
IG_PICTURE_2 = "https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-15/photo2.jpg?_nc_sid=1&oe=ABC"
IG_THUMB = "https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-15/thumb.jpg?_nc_sid=1&oe=ABC"
IG_VIDEO = "https://scontent-tpe1-1.cdninstagram.com/o1/v/t16/reel.mp4?_nc_sid=1&oe=ABC"
NO_IG_ACCOUNT = "粉專沒有連結 Instagram 專業帳號"
NO_IG_PERMISSION = "權杖沒有 Instagram 權限"
MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}"


def _ig(media_id: str, media_type: str = "IMAGE", caption: str | None = "第一行標題\n\n第二段內文", **extra) -> dict:
    """Graph 的 /{ig_user_id}/media 一列。IMAGE 的 media_url 是照片；VIDEO 的 media_url 是影片、thumbnail_url 是封面。"""
    row = {
        "id": media_id,
        "media_type": media_type,
        "permalink": f"https://www.instagram.com/p/{media_id}/",
        "timestamp": "2026-10-26T17:30:00+0000",  # 台北 10-27 凌晨
    }
    if caption is not None:
        row["caption"] = caption
    if media_type == "IMAGE":
        row["media_url"] = IG_PICTURE
    return {**row, **extra}


def _error(status: int, code: int) -> httpx.Response:
    return httpx.Response(status, json={"error": {"message": f"Invalid token {PAGE_TOKEN}", "code": code}})


class FakeInstagram(FakeMeta):
    """FakeMeta 再加 Instagram：粉專 → instagram_business_account、/{ig_user_id}/media。"""

    def __init__(self) -> None:
        super().__init__()
        self.ig_accounts: dict[str, str | None] = {YIHUA_PAGE: IG_ID, MINGHUA_PAGE: None}
        self.ig_media: dict[str, list[dict]] = {IG_ID: [_ig("1")]}
        self.fail_token_with: int | None = None
        self.fail_account_with: tuple[int, int] | None = None
        self.fail_media_with: tuple[int, int] | None = None

    def ig_requests(self) -> list[httpx.Request]:
        return [
            r for r in self.requests
            if "instagram_business_account" in r.url.params.get("fields", "") or r.url.path.endswith("/media")
        ]

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host != "graph.facebook.com":
            return super().handler(request)
        parts = request.url.path.strip("/").split("/")
        fields = request.url.params.get("fields", "")
        if len(parts) == 2 and fields == "access_token" and self.fail_token_with:
            self.requests.append(request)
            return _error(self.fail_token_with, 190)
        is_account = len(parts) == 2 and fields == "instagram_business_account"
        is_media = len(parts) == 3 and parts[2] == "media"
        if not (is_account or is_media):
            return super().handler(request)
        self.requests.append(request)
        # token 只走 Authorization header，而且 Instagram 這兩步用的是粉專 token。
        assert "access_token" not in request.url.params
        assert request.headers.get("authorization") == f"Bearer {PAGE_TOKEN}"
        if is_account:
            if self.fail_account_with:
                return _error(*self.fail_account_with)
            ig_id = self.ig_accounts.get(parts[1])
            return httpx.Response(
                200, json={"id": parts[1], **({"instagram_business_account": {"id": ig_id}} if ig_id else {})}
            )
        if self.fail_media_with:
            return _error(*self.fail_media_with)
        return httpx.Response(200, json={"data": self.ig_media.get(parts[1], [])})


@pytest.fixture
def ig(app) -> FakeInstagram:
    fake = FakeInstagram()
    original = app.state.settings
    app.state.settings = _settings(original, instagram_enabled=True)
    app.state.facebook_transport = httpx.MockTransport(fake.handler)
    yield fake
    app.state.settings = original
    app.state.facebook_transport = None


async def _ig_posts(db_session) -> list[FacebookPagePost]:
    rows = await db_session.scalars(
        select(FacebookPagePost).where(FacebookPagePost.source == "instagram").order_by(FacebookPagePost.post_id)
    )
    return list(rows)


async def _sync_row(db_session, campus_key: str = "yihua") -> FacebookPageSync:
    db_session.expire_all()
    return await db_session.get(FacebookPageSync, campus_key)


# ── 設定 ──────────────────────────────────────────────


def test_instagram_is_off_by_default(isolated_settings):
    assert isolated_settings.instagram_enabled is False
    assert isolated_settings.instagram_sync_enabled is False


def test_instagram_needs_facebook_settings(isolated_settings):
    with pytest.raises(ValidationError, match="INSTAGRAM_ENABLED"):
        Settings.model_validate({**isolated_settings.model_dump(), "instagram_enabled": True})
    settings = Settings.model_validate({
        **isolated_settings.model_dump(), "instagram_enabled": True,
        "facebook_access_token": "t", "facebook_pages": "yihua=12345",
    })
    assert settings.instagram_sync_enabled
    # 只設 Facebook、沒開 Instagram：照舊只同步 Facebook。
    assert not Settings.model_validate({
        **isolated_settings.model_dump(), "facebook_access_token": "t", "facebook_pages": "yihua=12345",
    }).instagram_sync_enabled


def test_instagram_switch_reads_env_name(isolated_settings, monkeypatch):
    monkeypatch.setenv("WEBSITE_INSTAGRAM_ENABLED", "true")
    monkeypatch.setenv("WEBSITE_FACEBOOK_ACCESS_TOKEN", "t")
    monkeypatch.setenv("WEBSITE_FACEBOOK_PAGES", "yihua=12345")
    settings = Settings(
        environment="test",
        database_url=isolated_settings.database_url,
        test_database_url=isolated_settings.test_database_url,
        session_secret=isolated_settings.session_secret,
    )
    assert settings.instagram_sync_enabled


# ── 下載白名單 ────────────────────────────────────────


@pytest.mark.parametrize("url", [
    "https://scontent.xx.fbcdn.net/v/photo.jpg",
    "https://fbcdn.net/v/photo.jpg",
    "https://scontent-tpe1-1.cdninstagram.com/v/photo.jpg?oe=1",
    "https://cdninstagram.com/v/photo.jpg",
    "https://SCONTENT.CDNINSTAGRAM.COM/v/photo.jpg",
])
def test_meta_cdn_accepts_facebook_and_instagram_hosts(url):
    assert is_meta_cdn(url)


@pytest.mark.parametrize("url", [
    "http://scontent.cdninstagram.com/v/photo.jpg",  # 只收 https
    "https://evilcdninstagram.com/v/photo.jpg",
    "https://cdninstagram.com.evil.example/v/photo.jpg",
    "https://cdninstagram.com@evil.example/v/photo.jpg",
    "https://user:pw@scontent.cdninstagram.com/v/photo.jpg",
    "https://notfbcdn.net/v/photo.jpg",
    "https://www.instagram.com/p/1/",
    "https://evil.example/photo.jpg",
])
def test_meta_cdn_rejects_lookalikes(url):
    assert not is_meta_cdn(url)


# ── 資料表 ────────────────────────────────────────────


async def test_source_defaults_to_facebook_and_is_checked(app, db_session):
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    post = FacebookPagePost(campus_key="yihua", post_id="1_1", posted_at=now, fetched_at=now)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)
    assert post.source == "facebook"

    db_session.add(FacebookPagePost(campus_key="yihua", post_id="ig_9", posted_at=now, fetched_at=now, source="twitter"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


# ── 同步 ──────────────────────────────────────────────


async def test_sync_does_nothing_for_instagram_when_switch_is_off(app, db_session):
    fake = FakeInstagram()
    app.state.settings = _settings(app.state.settings)  # 沒開 instagram_enabled
    results = await _sync(app, fake, ["yihua"])
    assert results[0].error is None and results[0].instagram_count is None and results[0].instagram_error is None
    assert fake.ig_requests() == []
    row = await _sync_row(db_session)
    assert (row.ig_last_attempt_at, row.ig_last_success_at, row.ig_last_error, row.ig_last_count) == (None, None, None, None)
    assert await _ig_posts(db_session) == []


async def test_sync_writes_instagram_posts_into_same_inbox(app, ig, db_session):
    carousel = _ig("2", "CAROUSEL_ALBUM", caption="相簿", children={"data": [
        {"media_type": "VIDEO", "media_url": IG_VIDEO, "thumbnail_url": IG_THUMB},
        {"media_type": "IMAGE", "media_url": IG_PICTURE_2},
        {"media_type": "IMAGE", "media_url": IG_PICTURE},
    ]})
    reel = _ig("3", "VIDEO", caption="Reel", media_url=IG_VIDEO, thumbnail_url=IG_THUMB)
    ig.ig_media[IG_ID] = [_ig("1"), carousel, reel]
    results = await _sync(app, ig, ["yihua"])
    assert (results[0].count, results[0].error) == (1, None)  # Facebook 那一列只算 Facebook 的貼文
    assert (results[0].instagram_count, results[0].instagram_error) == (3, None)

    rows = {row.post_id: row for row in await _ig_posts(db_session)}
    assert sorted(rows) == [f"ig_{n}" for n in ("1", "2", "3")]
    image = rows["ig_1"]
    assert (image.campus_key, image.source, image.status) == ("yihua", "instagram", "new")
    assert (image.message, image.picture_url, image.video_url) == ("第一行標題\n\n第二段內文", IG_PICTURE, None)
    assert image.permalink_url == "https://www.instagram.com/p/1/"
    assert image.posted_at.isoformat() == "2026-10-26T17:30:00+00:00"
    # 相簿取第一張「圖片」（跳過前面的影片）；不取相簿裡的影片。
    assert (rows["ig_2"].picture_url, rows["ig_2"].video_url) == (IG_PICTURE_2, None)
    # 影片（含 Reels）：影片＝media_url、照片＝thumbnail_url。
    assert (rows["ig_3"].picture_url, rows["ig_3"].video_url) == (IG_THUMB, IG_VIDEO)
    # 同一個收件匣：Facebook 的貼文照舊在，來源是 facebook。
    facebook = (await db_session.scalars(select(FacebookPagePost).where(FacebookPagePost.source == "facebook"))).one()
    assert facebook.post_id == f"{YIHUA_PAGE}_1"

    row = await _sync_row(db_session)
    assert (row.last_error, row.last_count) == (None, 1)
    assert row.ig_last_error is None and row.ig_last_count == 3
    assert row.ig_last_attempt_at is not None and row.ig_last_success_at is not None


async def test_sync_requests_expected_fields_with_page_token(app, ig):
    await _sync(app, ig, ["yihua"])
    account, media = ig.ig_requests()
    assert account.url.path.endswith(f"/{YIHUA_PAGE}")
    assert media.url.path.endswith(f"/{IG_ID}/media")
    assert media.url.params["fields"] == MEDIA_FIELDS and media.url.params["limit"] == "25"
    assert not any(SYSTEM_TOKEN in str(r.url) or PAGE_TOKEN in str(r.url) for r in ig.requests)


async def test_sync_sends_appsecret_proof_for_instagram(app, ig):
    app.state.settings = _settings(app.state.settings, instagram_enabled=True, facebook_app_secret="app-secret")
    await _sync(app, ig, ["yihua"])
    requests = ig.ig_requests()
    assert len(requests) == 2 and all(len(r.url.params["appsecret_proof"]) == 64 for r in requests)


async def test_sync_upsert_keeps_status_and_refreshes_content(app, ig, db_session):
    await _sync(app, ig, ["yihua"])
    post = (await _ig_posts(db_session))[0]
    post.status = "dismissed"
    await db_session.commit()
    ig.ig_media[IG_ID] = [_ig("1", caption="改過的說明", media_url=IG_PICTURE + "&v=2")]
    await _sync(app, ig, ["yihua"])
    db_session.expire_all()
    post = (await _ig_posts(db_session))[0]
    assert (post.status, post.message, post.picture_url, post.source) == (
        "dismissed", "改過的說明", IG_PICTURE + "&v=2", "instagram"
    )
    assert len(await _ig_posts(db_session)) == 1


async def test_sync_skips_empty_or_insecure_instagram_posts(app, ig, db_session):
    ig.ig_media[IG_ID] = [
        _ig("1", caption=None, media_url=None),  # 沒字也沒照片
        _ig("2", caption="只有字", media_url=None),
        _ig("3", media_url="http://insecure.example/x.jpg"),
        _ig("4", "VIDEO", caption=None, media_url=IG_VIDEO),  # 影片沒有封面也沒有字
        {"media_type": "IMAGE"},  # 沒有 id
        _ig("5", media_url=IG_PICTURE, timestamp="not a time"),
    ]
    await _sync(app, ig, ["yihua"])
    rows = await _ig_posts(db_session)
    assert [(r.post_id, r.picture_url) for r in rows] == [("ig_2", None), ("ig_3", None)]


async def test_sync_without_linked_instagram_account_records_status(app, ig, db_session):
    results = await _sync(app, ig, ["minghua"])
    assert results[0].error is None  # Facebook 照常
    assert (results[0].instagram_count, results[0].instagram_error) == (None, NO_IG_ACCOUNT)
    row = await _sync_row(db_session, "minghua")
    assert row.last_error is None and row.last_success_at is not None
    assert row.ig_last_error == NO_IG_ACCOUNT and row.ig_last_attempt_at is not None and row.ig_last_success_at is None
    assert not any(r.url.path.endswith("/media") for r in ig.requests)


@pytest.mark.parametrize("step", ["account", "media"])
@pytest.mark.parametrize("code", [10, 200])
async def test_sync_permission_error_is_explained_and_does_not_touch_facebook(app, ig, db_session, step, code):
    setattr(ig, f"fail_{step}_with", (400, code))
    results = await _sync(app, ig, ["yihua"])
    assert (results[0].count, results[0].error) == (1, None)
    assert results[0].instagram_error == NO_IG_PERMISSION
    row = await _sync_row(db_session)
    assert row.ig_last_error == NO_IG_PERMISSION and row.ig_last_success_at is None
    # IG 失敗不影響 Facebook 那一列：貼文照寫、狀態照舊成功。
    assert (row.last_error, row.last_count) == (None, 1) and row.last_success_at is not None
    assert len((await db_session.scalars(select(FacebookPagePost))).all()) == 1


async def test_sync_other_instagram_errors_carry_only_status_and_code(app, ig, db_session, caplog):
    caplog.set_level(logging.DEBUG)
    ig.fail_media_with = (400, 190)
    results = await _sync(app, ig, ["yihua"])
    assert results[0].instagram_error == "讀取 Instagram 貼文（HTTP 400、code 190）"
    ig.fail_media_with = None
    ig.fail_account_with = (500, 2)
    results = await _sync(app, ig, ["yihua"])
    assert results[0].instagram_error == "取得 Instagram 帳號（HTTP 500、code 2）"
    row = await _sync_row(db_session)
    assert row.ig_last_error == "取得 Instagram 帳號（HTTP 500、code 2）"
    assert PAGE_TOKEN not in caplog.text and SYSTEM_TOKEN not in caplog.text


async def test_sync_instagram_error_then_success_clears_error_and_keeps_last_success(app, ig, db_session):
    await _sync(app, ig, ["yihua"])
    first = (await _sync_row(db_session)).ig_last_success_at
    ig.fail_media_with = (400, 190)
    await _sync(app, ig, ["yihua"])
    row = await _sync_row(db_session)
    assert row.ig_last_error and row.ig_last_success_at == first and row.ig_last_count == 1
    ig.fail_media_with = None
    await _sync(app, ig, ["yihua"])
    row = await _sync_row(db_session)
    assert row.ig_last_error is None and row.ig_last_success_at > first


async def test_sync_facebook_failure_does_not_block_instagram(app, ig, db_session):
    ig.fail_posts_with = 400  # Facebook 讀貼文失敗，粉專 token 已經拿到
    results = await _sync(app, ig, ["yihua"])
    assert results[0].error == "讀取貼文（HTTP 400、code 190）"
    assert results[0].instagram_count == 1 and results[0].instagram_error is None
    row = await _sync_row(db_session)
    assert row.last_error == "讀取貼文（HTTP 400、code 190）" and row.last_success_at is None
    assert row.ig_last_error is None and row.ig_last_count == 1
    assert [p.post_id for p in await _ig_posts(db_session)] == ["ig_1"]


async def test_sync_skips_instagram_when_page_token_cannot_be_obtained(app, ig, db_session):
    ig.fail_token_with = 400
    results = await _sync(app, ig, ["yihua"])
    assert results[0].error == "取得粉專權杖（HTTP 400、code 190）"
    assert (results[0].instagram_count, results[0].instagram_error) == (None, None)
    assert ig.ig_requests() == []
    row = await _sync_row(db_session)
    assert row.ig_last_attempt_at is None and row.ig_last_error is None


async def test_unexpected_instagram_failure_does_not_stop_facebook_or_other_campuses(app, ig, db_session, monkeypatch, caplog):
    async def boom(*args, **kwargs):
        raise RuntimeError(f"bug with {PAGE_TOKEN}")

    monkeypatch.setattr(graph, "instagram_media", boom)
    ig.ig_accounts[MINGHUA_PAGE] = "17841400000000002"
    results = await _sync(app, ig, ["yihua", "minghua"])
    assert [(r.campus_key, r.error) for r in results] == [("yihua", None), ("minghua", None)]
    assert all(r.instagram_error == "Instagram 同步發生未預期的錯誤" for r in results)
    row = await _sync_row(db_session)
    assert row.last_error is None and row.last_count == 1 and row.ig_last_error == "Instagram 同步發生未預期的錯誤"
    assert PAGE_TOKEN not in caplog.text  # 例外的內容（可能帶 token）不寫進 log
    assert len((await db_session.scalars(select(FacebookPagePost))).all()) == 1


async def test_cli_prints_instagram_line_and_exits_nonzero_when_it_fails(app, ig, monkeypatch, capsys):
    from app import cli
    from app.facebook import sync as sync_module

    real_sync = sync_module.sync_pages

    async def session_factory():
        return app.state.session_factory

    async def with_mock_transport(factory, settings, **kwargs):
        return await real_sync(factory, settings, transport=httpx.MockTransport(ig.handler), **kwargs)

    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(sync_module, "sync_pages", with_mock_transport)

    await cli.facebook_sync_command(["yihua"])
    out = capsys.readouterr().out
    assert "yihua：1 則" in out and "yihua Instagram：1 則" in out

    ig.fail_media_with = (400, 10)
    with pytest.raises(SystemExit) as exit_info:
        await cli.facebook_sync_command(["yihua"])
    assert exit_info.value.code == 1
    assert f"yihua Instagram：{NO_IG_PERMISSION}" in capsys.readouterr().out


# ── 後台 API ──────────────────────────────────────────


async def test_list_reports_instagram_status_only_when_enabled(admin_client, app, db_session):
    fake = FakeInstagram()
    app.state.settings = _settings(app.state.settings)
    app.state.facebook_transport = httpx.MockTransport(fake.handler)
    body = (await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})).json()
    assert body["instagram_enabled"] is False and body["sync"]["instagram"] is None
    assert [p["source"] for p in body["posts"]] == ["facebook"]

    app.state.settings = _settings(app.state.settings, instagram_enabled=True)
    body = (await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})).json()
    assert body["instagram_enabled"] is True
    assert body["sync"]["instagram"]["last_count"] == 1 and body["sync"]["instagram"]["last_error"] is None
    assert body["sync"]["instagram"]["last_success_at"] and body["sync"]["last_error"] is None
    assert sorted(p["source"] for p in body["posts"]) == ["facebook", "instagram"]
    assert PAGE_TOKEN not in str(body) and SYSTEM_TOKEN not in str(body)
    assert all("picture_url" not in p and "video_url" not in p for p in body["posts"])


async def test_sync_now_logs_instagram_result_only_when_it_ran(admin_client, app, ig, db_session):
    await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    entry = (await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "facebook_posts.sync"))).one()
    assert entry.metadata_json["instagram_posts"] == 1 and entry.metadata_json["instagram_failed"] is False

    ig.fail_media_with = (400, 10)
    await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    entries = (await db_session.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "facebook_posts.sync").order_by(AuditLogEntry.created_at)
    )).all()
    assert entries[-1].metadata_json["instagram_failed"] is True and entries[-1].metadata_json["sync_failed"] is False

    app.state.settings = _settings(app.state.settings, instagram_enabled=False)  # 關掉 Instagram
    await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    last = (await db_session.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "facebook_posts.sync").order_by(AuditLogEntry.created_at.desc())
    )).first()
    assert "instagram_posts" not in last.metadata_json and "instagram_failed" not in last.metadata_json


async def test_list_filters_by_source_and_counts_follow_the_filter(admin_client, app, ig, db_session):
    ig.ig_media[IG_ID] = [_ig("1"), _ig("2")]
    await _sync(app, ig, ["yihua"])
    facebook = (await db_session.scalars(select(FacebookPagePost).where(FacebookPagePost.source == "facebook"))).one()
    instagram = (await _ig_posts(db_session))[0]
    instagram.status = "dismissed"
    await db_session.commit()

    everything = (await admin_client.get(API, params={"campus_key": "yihua"})).json()
    assert everything["counts"] == {"new": 2, "imported": 0, "dismissed": 1}
    only_ig = (await admin_client.get(API, params={"campus_key": "yihua", "source": "instagram"})).json()
    assert only_ig["counts"] == {"new": 1, "imported": 0, "dismissed": 1}
    assert [p["source"] for p in only_ig["posts"]] == ["instagram"]
    only_fb = (await admin_client.get(API, params={"campus_key": "yihua", "source": "facebook"})).json()
    assert only_fb["counts"] == {"new": 1, "imported": 0, "dismissed": 0}
    assert [p["id"] for p in only_fb["posts"]] == [str(facebook.id)]
    dismissed_ig = (await admin_client.get(
        API, params={"campus_key": "yihua", "source": "instagram", "status": "dismissed"}
    )).json()
    assert [p["id"] for p in dismissed_ig["posts"]] == [str(instagram.id)]
    bad = await admin_client.get(API, params={"campus_key": "yihua", "source": "twitter"})
    assert bad.status_code == 422


async def test_picture_proxy_serves_instagram_cdn_and_rejects_lookalike(admin_client, app, ig, db_session):
    await _sync(app, ig, ["yihua"])
    post = (await _ig_posts(db_session))[0]
    response = await admin_client.get(f"{API}/{post.id}/picture")
    assert response.status_code == 200 and response.content == ig.picture
    assert any(r.url.host.endswith("cdninstagram.com") for r in ig.requests)

    post.picture_url = "https://evilcdninstagram.com/x.jpg"
    await db_session.commit()
    response = await admin_client.get(f"{API}/{post.id}/picture")
    assert response.status_code == 404 and response.json()["detail"]["code"] == "FACEBOOK_PICTURE_UNTRUSTED"
    assert not any(r.url.host == "evilcdninstagram.com" for r in ig.requests)


# ── 轉成消息草稿 ──────────────────────────────────────


def test_build_article_uses_instagram_link_label():
    post = _model("標題\n\n內文", permalink="https://www.instagram.com/p/9/")
    post.post_id, post.source = "ig_9", "instagram"
    article = build_article(post, "m-1")
    assert article["id"] == "fb-ig-9"
    assert article["body"][-1] == {"type": "link", "label": "在 Instagram 看原文", "url": "https://www.instagram.com/p/9/"}
    # 沒標來源的（也就是 Facebook）照舊。
    assert build_article(_model("標題\n\n內文"), "m-1")["body"][-1]["label"] == "在 Facebook 看原文"


async def test_import_instagram_post_shares_the_facebook_flow(admin_client, app, ig, db_session):
    await _sync(app, ig, ["yihua"])
    post = (await _ig_posts(db_session))[0]
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["post"]["source"] == "instagram" and body["post"]["status"] == "imported"
    assert body["article_id"] == "fb-ig-1" and body["article_title"] == "第一行標題"
    assert body["video_included"] is False

    item = (await admin_client.get(f"{CONTENT}/campus_news", params={"campus_key": "yihua"})).json()
    article = item["latest_revision"]["payload"]["articles"][0]
    assert article["date"] == "2026-10-27"
    assert article["body"][-1] == {"type": "link", "label": "在 Instagram 看原文", "url": "https://www.instagram.com/p/1/"}
    asset = await db_session.get(MediaAsset, uuid.UUID(article["image"]))
    assert asset.campus_key == "yihua" and asset.source_attribution == "Instagram 貼文"
    assert item["current_published_revision_id"] is None  # 只是草稿
    assert (await admin_client.post(f"{API}/{post.id}/import")).status_code == 409
    actions = set(await db_session.scalars(select(AuditLogEntry.action)))
    assert "facebook_post.import" in actions


async def test_facebook_and_instagram_posts_of_the_same_event_both_import(admin_client, app, ig, db_session):
    """學校常同一篇兩邊都發：不自動去重，兩則各自能轉（由人略過一則）；用同一張圖時素材庫只有一份。"""
    await _sync(app, ig, ["yihua"])
    for post in (await db_session.scalars(select(FacebookPagePost))).all():
        assert (await admin_client.post(f"{API}/{post.id}/import")).status_code == 200
    item = (await admin_client.get(f"{CONTENT}/campus_news", params={"campus_key": "yihua"})).json()
    ids = sorted(a["id"] for a in item["latest_revision"]["payload"]["articles"])
    assert ids == [f"fb-{YIHUA_PAGE}-1", "fb-ig-1"]
    # 兩邊用的是同一份測試 JPEG：素材庫只有一份。
    assert len((await db_session.scalars(select(MediaAsset))).all()) == 1


@pytest.mark.skipif(not MP4.exists(), reason="需要 ffmpeg 產生測試影片")
async def test_import_instagram_reel_brings_video_from_cdninstagram(admin_client, app, ig, db_session):
    ig.ig_media[IG_ID] = [_ig("7", "VIDEO", media_url=IG_VIDEO, thumbnail_url=IG_THUMB)]
    await _sync(app, ig, ["yihua"])
    post = (await _ig_posts(db_session))[0]
    listed = (await admin_client.get(API, params={"campus_key": "yihua", "source": "instagram"})).json()
    assert listed["posts"][0]["has_video"] is True and IG_VIDEO not in str(listed)

    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    assert response.json()["video_included"] is True
    item = (await admin_client.get(f"{CONTENT}/campus_news", params={"campus_key": "yihua"})).json()
    article = item["latest_revision"]["payload"]["articles"][0]
    assert [block["type"] for block in article["body"]] == ["video", "paragraph", "link"]
    video = await db_session.get(MediaAsset, uuid.UUID(article["body"][0]["video"]))
    assert (video.kind, video.source_attribution) == (MediaKind.VIDEO, "Instagram 貼文")
    # 影片檔只從 Instagram CDN 拿，不帶 token（FakeMeta 會擋）。
    assert any(r.url.host.endswith("cdninstagram.com") and r.url.path.endswith(".mp4") for r in ig.requests)


async def test_import_instagram_video_from_unexpected_host_skips_video(admin_client, app, ig, db_session):
    ig.ig_media[IG_ID] = [_ig("7", "VIDEO", media_url=IG_VIDEO, thumbnail_url=IG_THUMB)]
    await _sync(app, ig, ["yihua"])
    post = (await _ig_posts(db_session))[0]
    post.video_url = "https://evilcdninstagram.com/reel.mp4"
    await db_session.commit()
    response = await admin_client.post(f"{API}/{post.id}/import")
    assert response.status_code == 200, response.text
    assert response.json()["video_included"] is False
    assert response.json()["video_skipped_reason"] == "影片網址不是 Facebook 或 Instagram 的影片主機"
    assert not any(r.url.host == "evilcdninstagram.com" for r in ig.requests)


async def test_existing_facebook_picture_url_is_still_the_default_source(app, ig, db_session):
    """Facebook 的貼文完全不受影響：照片仍是 fbcdn、來源是 facebook。"""
    await _sync(app, ig, ["yihua"])
    facebook = (await db_session.scalars(select(FacebookPagePost).where(FacebookPagePost.source == "facebook"))).one()
    assert (facebook.picture_url, facebook.post_id) == (PICTURE, f"{YIHUA_PAGE}_1")
