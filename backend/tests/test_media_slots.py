"""素材衍生檔路由、素材版位（影片／照片＋各版位焦點）與匯入既有素材。"""
from __future__ import annotations

import io
import json
import shutil
import uuid
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import select

from app.content.models import ContentItem, ContentRevision
from app.content.registry import CONTENT_KIND_REGISTRY, set_at_path
from app.content.schemas import CampusProfilePayload, DayExperiencePayload, HomeNewsPayload, youtube_id
from app.media import site_import
from app.media.models import MediaAsset, MediaKind, MediaUsage
from app.media.storage import LocalMediaStorage
from app.operations.models import AuditLogEntry

API = "/api/website/v1"
MEDIA = f"{API}/admin/media"
FIXTURES = Path("/tmp/media-fixtures")
WEB_ROOT = Path(__file__).resolve().parents[2] / "web"

requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="影片需要 ffmpeg／ffprobe"
)


def _jpeg(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (78, 184, 122)).save(buf, "JPEG")
    return buf.getvalue()


async def _upload(client, *, campus_key: str | None = None, kind: str = "image", data: bytes | None = None, name: str = "a.jpg") -> dict:
    form = {"kind": kind}
    if campus_key:
        form["campus_key"] = campus_key
    content = data if data is not None else (FIXTURES / ("test.mp4" if kind == "video" else "test.jpg")).read_bytes()
    response = await client.post(MEDIA, data=form, files={"file": (name, content, "video/mp4" if kind == "video" else "image/jpeg")})
    assert response.status_code == 201, response.text
    return response.json()


async def _save(client, kind: str, payload: dict, *, campus_key: str | None = None, version: int = 0):
    suffix = f"?campus_key={campus_key}" if campus_key else ""
    return await client.post(
        f"{API}/admin/content-items/{kind}/revisions{suffix}", json={"expected_version": version, "payload": payload}
    )


async def _publish(client, kind: str, saved: dict, *, campus_key: str | None = None) -> None:
    suffix = f"?campus_key={campus_key}" if campus_key else ""
    response = await client.post(
        f"{API}/admin/content-items/{kind}/publish{suffix}", json={"revision_id": saved["latest_revision"]["id"]}
    )
    assert response.status_code == 200, response.text


def _about(**extra) -> dict:
    return {"title": "關於", "since_label": "Since 1997", "body_text": "內文。", "caption": "圖說", **extra}


def _hero(**extra) -> dict:
    return {"eyebrow": "小標", "copy_lines": ["一行"], **extra}


def _slot(media_id: str, **focus) -> dict:
    return {"media_id": media_id, **focus}


# ---------------------------------------------------------------------------
# 衍生檔：縮圖、大圖、poster 與讀取路由
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_large_image_gets_thumbnail_and_large_variants_with_sizes(admin_client):
    body = await _upload(admin_client, data=_jpeg(2000, 1500))
    variants = {v["kind"]: v for v in body["variants"]}
    assert set(variants) == {"thumbnail", "large"}
    assert (variants["thumbnail"]["width"], variants["thumbnail"]["height"]) == (480, 360)
    assert (variants["large"]["width"], variants["large"]["height"]) == (1600, 1200)

    small = await _upload(admin_client, data=_jpeg(100, 80))
    assert [(v["kind"], v["width"], v["height"]) for v in small["variants"]] == [("thumbnail", 100, 80)]


@pytest.mark.asyncio
async def test_same_file_records_same_sha256(admin_client, db_session):
    data = _jpeg(120, 90)
    first = await _upload(admin_client, data=data)
    second = await _upload(admin_client, data=data)
    rows = (await db_session.execute(select(MediaAsset.sha256).where(MediaAsset.id.in_([uuid.UUID(first["id"]), uuid.UUID(second["id"])])))).scalars().all()
    assert len(set(rows)) == 1 and len(rows[0]) == 64


@pytest.mark.asyncio
async def test_admin_variant_route_serves_thumbnail_and_404s_missing_kind(admin_client, minghua_client):
    body = await _upload(admin_client, campus_key="yihua", data=_jpeg(2000, 1500))
    thumb = await admin_client.get(f"{MEDIA}/{body['id']}/variants/thumbnail")
    assert thumb.status_code == 200
    assert thumb.headers["content-type"] == "image/webp"
    assert thumb.headers["x-content-type-options"] == "nosniff"
    assert Image.open(io.BytesIO(thumb.content)).size == (480, 360)
    assert (await admin_client.get(f"{MEDIA}/{body['id']}/variants/large")).status_code == 200
    # 圖片沒有 poster；不認得的種類 422。
    assert (await admin_client.get(f"{MEDIA}/{body['id']}/variants/poster")).status_code == 404
    assert (await admin_client.get(f"{MEDIA}/{body['id']}/variants/original")).status_code == 422
    # 權限跟原檔一樣：別校看不到。
    other = await minghua_client.get(f"{MEDIA}/{body['id']}/variants/thumbnail")
    assert other.status_code == (await minghua_client.get(f"{MEDIA}/{body['id']}/file")).status_code
    assert other.status_code in (403, 404)


@requires_ffmpeg
@pytest.mark.asyncio
async def test_video_poster_variant_route(admin_client):
    body = await _upload(admin_client, kind="video", name="a.mp4")
    [poster] = body["variants"]
    assert poster["kind"] == "poster" and poster["width"] == 160 and poster["height"] == 120
    response = await admin_client.get(f"{MEDIA}/{body['id']}/variants/poster")
    assert response.status_code == 200 and response.headers["content-type"] == "image/webp"


@pytest.mark.asyncio
async def test_public_variant_follows_same_rules_as_original(admin_client, public_client):
    body = await _upload(admin_client, data=_jpeg(2000, 1500))
    url = f"{API}/public/media/{body['id']}/variants/large"
    assert (await public_client.get(url)).status_code == 404
    preview = await admin_client.get(url)
    assert preview.status_code == 200 and preview.headers["cache-control"] == "private, no-store"

    saved = (await _save(admin_client, "home_about", _about(photo=_slot(body["id"])))).json()
    await _publish(admin_client, "home_about", saved)
    published = await public_client.get(url)
    assert published.status_code == 200
    assert "immutable" in published.headers["cache-control"]
    assert (await public_client.get(f"{API}/public/media/{body['id']}/variants/poster")).status_code == 404


@pytest.mark.asyncio
async def test_public_file_supports_range_requests(admin_client, public_client):
    body = await _upload(admin_client, data=_jpeg(300, 200))
    saved = (await _save(admin_client, "home_about", _about(photo=_slot(body["id"])))).json()
    await _publish(admin_client, "home_about", saved)
    full = await public_client.get(f"{API}/public/media/{body['id']}/file")
    partial = await public_client.get(f"{API}/public/media/{body['id']}/file", headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206
    assert partial.content == full.content[:100]
    assert partial.headers["content-range"].startswith("bytes 0-99/")


@pytest.mark.asyncio
async def test_crop_focus_must_be_between_zero_and_one(admin_client):
    body = await _upload(admin_client)
    bad = await admin_client.patch(f"{MEDIA}/{body['id']}", json={"expected_version": 1, "crop_focus_x": 1.5, "crop_focus_y": 0.5})
    assert bad.status_code == 422
    ok = await admin_client.patch(f"{MEDIA}/{body['id']}", json={"expected_version": 1, "crop_focus_x": 0.25, "crop_focus_y": 1})
    assert ok.status_code == 200 and ok.json()["crop_focus_x"] == 0.25


# ---------------------------------------------------------------------------
# 素材版位
# ---------------------------------------------------------------------------


@requires_ffmpeg
@pytest.mark.asyncio
async def test_hero_slots_record_usage_and_check_media_kind(admin_client, db_session):
    image = await _upload(admin_client)
    video = await _upload(admin_client, kind="video", name="a.mp4")

    wrong = await _save(admin_client, "home_hero", _hero(video_desktop=_slot(image["id"])))
    assert wrong.status_code == 422
    assert wrong.json()["detail"]["code"] == "MEDIA_KIND_MISMATCH"
    assert wrong.json()["detail"]["field_path"] == "video_desktop.media_id"
    wrong = await _save(admin_client, "home_hero", _hero(poster=_slot(video["id"])))
    assert wrong.json()["detail"]["code"] == "MEDIA_KIND_MISMATCH"

    saved = await _save(
        admin_client,
        "home_hero",
        _hero(video_desktop=_slot(video["id"]), poster=_slot(image["id"], focus_x=30, focus_y=70), poster_alt="孩子在草地上"),
    )
    assert saved.status_code == 201, saved.text
    rows = (await db_session.execute(select(MediaUsage.field_name, MediaUsage.media_id))).all()
    assert sorted((name, str(media_id)) for name, media_id in rows) == sorted(
        [("video_desktop.media_id", video["id"]), ("poster.media_id", image["id"])]
    )
    # 引用中的素材不能刪。
    assert (await admin_client.delete(f"{MEDIA}/{video['id']}")).status_code == 409


@pytest.mark.asyncio
async def test_slot_focus_is_0_to_100_and_paired(admin_client):
    image = await _upload(admin_client)
    for focus in ({"focus_x": 120, "focus_y": 50}, {"focus_x": 50}):
        response = await _save(admin_client, "home_about", _about(photo=_slot(image["id"], **focus)))
        assert response.status_code == 422, focus
    not_media = await _save(admin_client, "home_about", _about(photo={"media_id": "about-together"}))
    assert not_media.status_code == 422


@pytest.mark.asyncio
async def test_campus_profile_cover_line_art_and_placement_focus(admin_client):
    cover = await _upload(admin_client, campus_key="yihua")
    other_campus = await _upload(admin_client, campus_key="minghua")
    base = {
        "name": "義華校", "district": "鳳山區", "address": "地址", "phone": "07", "intro": "簡介",
        "description": "介紹", "facebook": "", "fb_note": "", "line": "",
    }
    saved = await _save(
        admin_client, "campus_profile",
        {**base, "cover": _slot(cover["id"]), "card_focus": {"x": 85, "y": 50}, "hero_focus": {"x": 85, "y": 8}},
        campus_key="yihua",
    )
    assert saved.status_code == 201, saved.text
    payload = saved.json()["latest_revision"]["payload"]
    assert payload["card_focus"] == {"x": 85.0, "y": 50.0}
    refs = CONTENT_KIND_REGISTRY["campus_profile"].extract_media_refs(payload)
    assert [(r.path, str(r.media_id), r.kind) for r in refs] == [("cover.media_id", cover["id"], "image")]
    # 焦點只收 0–100，不收 CSS 字串。
    bad = await _save(admin_client, "campus_profile", {**base, "card_focus": "85% center"}, campus_key="yihua", version=1)
    assert bad.status_code == 422
    cross = await _save(admin_client, "campus_profile", {**base, "line_art": _slot(other_campus["id"])}, campus_key="yihua", version=1)
    assert cross.json()["detail"]["code"] == "MEDIA_CROSS_CAMPUS"


def test_day_and_film_refs_cover_every_slot():
    ids = [str(uuid.uuid4()) for _ in range(6)]
    day = DayExperiencePayload.model_validate({
        "eyebrow": "孩子的一天", "eyebrow_en": "A DAY", "note": "", "source_note": "",
        "film_desktop": _slot(ids[0]), "film_mobile": _slot(ids[1]), "film_poster": _slot(ids[2]),
        "moments": [
            {"key": "a", "time": "08:00", "label": "早", "caption": "", "title": "早安", "story": "", "question": "", "answer": "",
             "photo": _slot(ids[3], focus_x=10, focus_y=20), "alt": "孩子", "tint": "mint"},
        ],
    }).model_dump()
    refs = CONTENT_KIND_REGISTRY["day_experience"].extract_media_refs(day)
    assert [(r.path, r.kind) for r in refs] == [
        ("film_desktop.media_id", "video"), ("film_mobile.media_id", "video"),
        ("film_poster.media_id", "image"), ("moments[0].photo.media_id", "image"),
    ]
    assert refs[3].label == "早安"
    # 批次替換用 set_at_path 改路徑指到的字串。
    set_at_path(day, "moments[0].photo.media_id", ids[5])
    assert day["moments"][0]["photo"] == {"media_id": ids[5], "focus_x": 10.0, "focus_y": 20.0}

    with pytest.raises(ValueError):
        DayExperiencePayload.model_validate({**day, "moments": [{**day["moments"][0], "tint": "#ff0000"}]})

    news = HomeNewsPayload.model_validate({
        "sample_note": "", "articles": [], "events": [],
        "films": [
            {"id": "run", "title": "一起跑", "source": "file", "video": _slot(ids[0]), "start": 0, "end": 9.7, "poster": _slot(ids[4])},
            {"id": "yt", "title": "表演", "source": "youtube", "youtube_url": "https://youtu.be/dQw4w9WgXcQ"},
        ],
    }).model_dump()
    refs = CONTENT_KIND_REGISTRY["home_news"].extract_media_refs(news)
    assert [(r.path, r.kind) for r in refs] == [("films[0].video.media_id", "video"), ("films[0].poster.media_id", "image")]


def test_film_validation():
    base = {"id": "a", "title": "影片"}
    with pytest.raises(ValueError, match="素材庫選一支影片"):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": [], "films": [{**base, "source": "file"}]})
    with pytest.raises(ValueError, match="YouTube"):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": [], "films": [{**base, "source": "youtube", "youtube_url": "https://example.com/v"}]})
    with pytest.raises(ValueError, match="結束秒數"):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": [], "films": [
            {**base, "source": "file", "video": _slot(str(uuid.uuid4())), "start": 5, "end": 5}]})
    with pytest.raises(ValueError):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": [], "films": []})
    assert youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3") == "dQw4w9WgXcQ"
    assert youtube_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert youtube_id("not a video") == ""


@pytest.mark.asyncio
async def test_public_site_lists_referenced_media_with_variants_and_focus(admin_client, public_client):
    image = await _upload(admin_client, data=_jpeg(2000, 1500))
    await admin_client.patch(f"{MEDIA}/{image['id']}", json={"expected_version": 1, "alt_text": "孩子與長輩", "crop_focus_x": 0.3, "crop_focus_y": 0.6})
    unused = await _upload(admin_client)
    saved = (await _save(admin_client, "home_about", _about(photo=_slot(image["id"]), photo_alt=""))).json()
    await _publish(admin_client, "home_about", saved)

    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["home_about"]["photo"] == {"media_id": image["id"], "focus_x": None, "focus_y": None}
    assert list(site["media"]) == [image["id"]]
    info = site["media"][image["id"]]
    assert unused["id"] not in site["media"]
    assert info["kind"] == "image" and (info["width"], info["height"]) == (2000, 1500)
    assert info["alt_text"] == "孩子與長輩"
    assert (info["focus_x"], info["focus_y"]) == (30.0, 60.0)
    assert [(v["kind"], v["width"]) for v in info["variants"]] == [("thumbnail", 480), ("large", 1600)]


@pytest.mark.asyncio
async def test_replace_references_rewrites_slot_media_id(admin_client):
    old = await _upload(admin_client)
    new = await _upload(admin_client, data=_jpeg(120, 90))
    saved = (await _save(admin_client, "home_about", _about(photo=_slot(old["id"], focus_x=40, focus_y=60)))).json()
    item_id = saved["id"]
    response = await admin_client.post(
        f"{MEDIA}/{old['id']}/replace-references",
        json={"replacement_id": new["id"], "items": [{"content_item_id": item_id, "expected_version": 1}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["field_paths"] == ["photo.media_id"]
    latest = (await admin_client.get(f"{API}/admin/content-items/home_about")).json()["latest_revision"]["payload"]
    # 版位的焦點留著，只換素材。
    assert latest["photo"] == {"media_id": new["id"], "focus_x": 40.0, "focus_y": 60.0}


# ---------------------------------------------------------------------------
# 匯入既有素材
# ---------------------------------------------------------------------------


def test_css_position_to_focus():
    assert site_import.css_position_to_focus("85% center") == {"x": 85.0, "y": 50.0}
    assert site_import.css_position_to_focus("center 12%") == {"x": 50.0, "y": 12.0}
    assert site_import.css_position_to_focus("85% 8%") == {"x": 85.0, "y": 8.0}
    assert site_import.css_position_to_focus(None) is None
    assert site_import.css_position_to_focus("calc(50% + 2px) top") is None


def test_plan_covers_current_site_files():
    """官網現在用到的檔案都要找得到（web/ 改了檔名時這裡會先失敗）。"""
    entries = site_import.plan_site_assets(WEB_ROOT)
    missing = [str(e.path) for e in entries if not e.path.is_file()]
    assert missing == []
    keys = {e.key for e in entries}
    assert {"logo", "hero-video-desktop", "hero-video-mobile", "hero-poster", "about-photo", "day-film-desktop",
            "day-film-mobile", "day-poster"} <= keys
    for campus in ("yihua", "minghua", "chongde", "international", "renwu"):
        assert {f"{campus}-cover", f"{campus}-line-art", f"{campus}-line-art-colour"} <= keys
    # 官網實際播放的是 manifest 裡壓縮過的影片。
    video = next(e for e in entries if e.key == "hero-video-desktop")
    assert "optimized" in str(video.path)
    yihua = next(e for e in entries if e.key == "yihua-cover")
    assert yihua.campus_key == "yihua"
    assert yihua.target.extra == {"card_focus": {"x": 50.0, "y": 12.0}, "hero_focus": {"x": 85.0, "y": 8.0}}


def _mini_web_root(tmp_path: Path) -> Path:
    """跟 web/ 同樣結構、但檔案都很小的複本（影片用測試片）。"""
    root = tmp_path / "web"
    (root / "server" / "data").mkdir(parents=True)
    (root / "app" / "generated").mkdir(parents=True)
    shutil.copy(WEB_ROOT / "server" / "data" / "site-fixture.json", root / "server" / "data" / "site-fixture.json")
    shutil.copy(WEB_ROOT / "app" / "generated" / "video-manifest.json", root / "app" / "generated" / "video-manifest.json")
    for index, entry in enumerate(site_import.plan_site_assets(WEB_ROOT)):
        target = root / entry.path.relative_to(WEB_ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        if entry.kind == MediaKind.VIDEO:
            shutil.copy(FIXTURES / "test.mp4", target)
        else:
            # 每個檔案內容不同，才不會被雜湊去重合併。
            Image.new("RGB", (40 + index, 30), (index * 7 % 255, 120, 90)).save(
                target, "PNG" if target.suffix == ".png" else "WEBP"
            )
    return root


@requires_ffmpeg
@pytest.mark.asyncio
async def test_import_site_assets_dedupes_and_writes_drafts(db_session, tmp_path):
    from app.content.initialize import initialize_content

    web_root = _mini_web_root(tmp_path)
    fixture = json.loads((web_root / "server" / "data" / "site-fixture.json").read_text())
    await initialize_content(db_session, fixture)
    await db_session.commit()

    storage = LocalMediaStorage(str(tmp_path / "media"))
    limits = {"image": 15 * 1024 * 1024, "video": 150 * 1024 * 1024}
    entries = site_import.plan_site_assets(web_root)
    results = await site_import.check_entries(db_session, entries, limits)
    assert {r.status for r in results} == {"import"}
    # dry-run 也列得出會寫哪些版位，但不存檔。
    preview = await site_import.write_drafts(db_session, results, apply=False)
    assert {(d.kind, d.campus_key) for d in preview if d.written} >= {("home_hero", None), ("campus_profile", "yihua")}
    await db_session.rollback()
    assert (await db_session.execute(select(MediaAsset))).first() is None

    for result in results:
        await site_import.import_entry(db_session, storage, result, None)
        assert result.status in ("imported", "exists"), result.message
    # 測試用的影片都是同一支：只匯入一次，其他沿用。
    videos = [r for r in results if r.entry.kind == MediaKind.VIDEO]
    assert [r.status for r in videos] == ["imported", "exists", "exists", "exists"]
    assert len({r.media_id for r in videos}) == 1
    drafts = await site_import.write_drafts(db_session, results, apply=True)
    await site_import.log_import(db_session, results, drafts)
    await db_session.commit()

    by_key = {r.entry.key: str(r.media_id) for r in results}
    hero = await _latest(db_session, "home_hero")
    assert hero["video_desktop"]["media_id"] == by_key["hero-video-desktop"]
    assert hero["poster"]["media_id"] == by_key["hero-poster"]
    day = await _latest(db_session, "day_experience")
    assert day["moments"][0]["photo"]["media_id"] == by_key["day-moment-hello"]
    yihua = await _latest(db_session, "campus_profile", "yihua")
    assert yihua["cover"]["media_id"] == by_key["yihua-cover"]
    assert yihua["card_focus"] == {"x": 50.0, "y": 12.0} and yihua["hero_focus"] == {"x": 85.0, "y": 8.0}
    minghua = await _latest(db_session, "campus_profile", "minghua")
    assert minghua["card_focus"] is None
    # 草稿不發布：公開內容仍是初始化的版本。
    item = (await db_session.execute(select(ContentItem).where(ContentItem.kind == "home_hero"))).scalar_one()
    assert item.latest_version == 2
    assert (await db_session.execute(select(AuditLogEntry.action))).scalars().all().count("media.import_site_assets") == 1
    assert (await db_session.get(MediaAsset, uuid.UUID(by_key["yihua-cover"]))).campus_key == "yihua"

    # 重跑：全部沿用，版位已經設定過不覆蓋。
    again = await site_import.check_entries(db_session, site_import.plan_site_assets(web_root), limits)
    assert {r.status for r in again} == {"exists"}
    assert {str(r.media_id) for r in again} == set(by_key.values())
    redo = await site_import.write_drafts(db_session, again, apply=True)
    assert all(not d.written for d in redo)
    assert item.latest_version == 2


async def _latest(db, kind: str, campus_key: str | None = None) -> dict:
    item = (
        await db.execute(select(ContentItem).where(ContentItem.kind == kind, ContentItem.campus_key == campus_key))
    ).scalar_one()
    revision = (
        await db.execute(
            select(ContentRevision).where(
                ContentRevision.content_item_id == item.id, ContentRevision.version == item.latest_version
            )
        )
    ).scalar_one()
    return revision.payload


def test_campus_profile_old_payload_still_valid():
    """舊版本沒有素材欄位，照常通過驗證（留空＝官網沿用內建）。"""
    payload = CampusProfilePayload.model_validate({
        "name": "義華校", "district": "鳳山區", "address": "地址", "phone": "07", "intro": "簡介",
        "description": "介紹", "facebook": "", "fb_note": "", "line": "",
    })
    assert payload.cover is None and payload.card_focus is None and payload.line_art is None


@requires_ffmpeg
@pytest.mark.asyncio
async def test_import_site_assets_cli_defaults_to_dry_run(app, monkeypatch, capsys, tmp_path):
    from app import cli

    web_root = _mini_web_root(tmp_path)
    settings = app.state.settings.model_copy(update={"media_root": str(tmp_path / "media")})
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    async def factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", factory)

    await cli.import_site_assets(web_root, apply=False, write_drafts=False)
    out = capsys.readouterr().out
    assert "dry-run：共 29 個檔案，會匯入 29" in out and "[會匯入] 首屏影片（桌機）" in out
    async with app.state.session_factory() as db:
        assert (await db.execute(select(MediaAsset))).first() is None

    await cli.import_site_assets(web_root, apply=True, write_drafts=True)
    out = capsys.readouterr().out
    assert "已匯入 26、沿用 3" in out
    # 內容還沒初始化：版位不寫，照實說。
    assert "內容還沒初始化" in out

    await cli.import_site_assets(web_root, apply=True, write_drafts=False)
    assert "已匯入 0、沿用 29" in capsys.readouterr().out
