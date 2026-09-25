"""B10 審查意見：衍生檔保留透明、依 EXIF 轉正的寬高、舊縮圖退出 srcset 與
重新產生、活動影片片段對照影片長度。"""
from __future__ import annotations

import importlib.util
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.media import regenerate
from app.media.models import MediaAsset, MediaKind, MediaStatus, MediaVariant, VariantKind
from app.media.processing import make_webp
from app.media.storage import LocalMediaStorage
from app.operations.models import AuditLogEntry

API = "/api/website/v1"
MEDIA = f"{API}/admin/media"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "de61f57ec77d_media_variants_orientation_alpha.py"


def _png_with_hole(width: int = 120, height: int = 80) -> bytes:
    """透明底、中間一塊不透明的紅色（去背線稿的樣子）。"""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    img.paste((200, 40, 40, 255), (width // 4, height // 4, width // 2, height // 2))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _rotated_jpeg(width: int, height: int, orientation: int = 6) -> bytes:
    """原始像素是橫的，EXIF 說要轉 90 度（手機直拍）。"""
    img = Image.new("RGB", (width, height), (78, 184, 122))
    exif = img.getexif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def _jpeg(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (78, 184, 122)).save(buf, "JPEG")
    return buf.getvalue()


async def _upload(client, data: bytes, name: str, content_type: str) -> dict:
    response = await client.post(MEDIA, data={"kind": "image"}, files={"file": (name, data, content_type)})
    assert response.status_code == 201, response.text
    return response.json()


def _variants(body: dict) -> dict[str, tuple[int | None, int | None]]:
    return {v["kind"]: (v["width"], v["height"]) for v in body["variants"]}


# ---------------------------------------------------------------------------
# 衍生檔保留透明（B10-1）
# ---------------------------------------------------------------------------


def test_make_webp_keeps_alpha_and_drops_it_when_fully_opaque():
    out = Image.open(io.BytesIO(make_webp(_png_with_hole(), 480).data))
    assert out.mode == "RGBA"
    assert out.getpixel((0, 0))[3] == 0
    assert out.getpixel((40, 30))[3] == 255

    # 調色盤 PNG 用 transparency 標透明色、灰階加 alpha：一樣保留。
    palette = Image.new("P", (40, 40), 0)
    palette.putpalette([255, 255, 255, 10, 10, 10] + [0] * 762)
    palette.paste(1, (10, 10, 20, 20))
    palette.info["transparency"] = 0
    buf = io.BytesIO()
    palette.save(buf, "PNG", transparency=0)
    assert Image.open(io.BytesIO(make_webp(buf.getvalue(), 480).data)).getpixel((0, 0))[3] == 0
    buf = io.BytesIO()
    Image.new("LA", (40, 40), (128, 0)).save(buf, "PNG")
    assert Image.open(io.BytesIO(make_webp(buf.getvalue(), 480).data)).mode == "RGBA"

    # 宣告 RGBA 但整張不透明：存成一般 WebP。
    buf = io.BytesIO()
    Image.new("RGBA", (40, 40), (10, 20, 30, 255)).save(buf, "PNG")
    assert Image.open(io.BytesIO(make_webp(buf.getvalue(), 480).data)).mode == "RGB"


@pytest.mark.asyncio
async def test_transparent_png_thumbnail_and_large_keep_alpha(admin_client):
    body = await _upload(admin_client, _png_with_hole(2000, 1000), "line.png", "image/png")
    assert _variants(body) == {"thumbnail": (480, 240), "large": (1600, 800)}
    for kind in ("thumbnail", "large"):
        response = await admin_client.get(f"{MEDIA}/{body['id']}/variants/{kind}")
        img = Image.open(io.BytesIO(response.content))
        assert img.mode == "RGBA", kind
        assert img.getpixel((0, 0))[3] == 0, kind


# ---------------------------------------------------------------------------
# 依 EXIF 轉正的寬高（B10-2）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_exif_rotated_photo_records_oriented_size(admin_client):
    body = await _upload(admin_client, _rotated_jpeg(2000, 1000), "phone.jpg", "image/jpeg")
    # 原始像素 2000×1000，瀏覽器依 EXIF 顯示成 1000×2000；素材與衍生檔都記直的。
    assert (body["width"], body["height"]) == (1000, 2000)
    assert _variants(body) == {"thumbnail": (240, 480), "large": (800, 1600)}
    thumb = await admin_client.get(f"{MEDIA}/{body['id']}/variants/thumbnail")
    assert Image.open(io.BytesIO(thumb.content)).size == (240, 480)

    mirrored = await _upload(admin_client, _rotated_jpeg(300, 100, orientation=2), "mirror.jpg", "image/jpeg")
    # 只有水平鏡像（2）不換長寬。
    assert (mirrored["width"], mirrored["height"]) == (300, 100)


# ---------------------------------------------------------------------------
# migration：舊縮圖與去背圖的衍生檔退出 srcset、轉正後寬高對調
# ---------------------------------------------------------------------------


def _load_migration():
    spec = importlib.util.spec_from_file_location("media_variants_orientation_alpha", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@pytest.mark.asyncio
async def test_migration_clears_legacy_and_alpha_capable_variants_and_swaps_rotated_sizes(app, admin_client, db_session):
    legacy = await _upload(admin_client, _jpeg(2000, 1500), "old.jpg", "image/jpeg")
    png = await _upload(admin_client, _png_with_hole(), "line.png", "image/png")
    photo = await _upload(admin_client, _jpeg(2000, 1500), "photo.jpg", "image/jpeg")
    rotated = await _upload(admin_client, _rotated_jpeg(2000, 1000), "phone.jpg", "image/jpeg")
    ids = {name: uuid.UUID(body["id"]) for name, body in [("legacy", legacy), ("png", png), ("photo", photo), ("rotated", rotated)]}
    # 還原成正式庫的樣子：舊素材沒有 sha256；B10 上傳的直拍照片記的是原檔未轉正的寬高。
    await db_session.execute(update(MediaAsset).where(MediaAsset.id == ids["legacy"]).values(sha256=None))
    await db_session.execute(update(MediaAsset).where(MediaAsset.id == ids["rotated"]).values(width=2000, height=1000))
    await db_session.commit()

    migration = _load_migration()
    captured: list = []

    class _Op:
        @staticmethod
        def execute(statement):
            captured.append(statement)

    migration.op = _Op()
    migration.upgrade()
    async with app.state.engine.begin() as conn:
        for statement in captured:
            await conn.execute(statement)

    db_session.expire_all()
    rows = (
        await db_session.execute(select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id.in_(ids.values())))
    ).scalars().all()
    by_id = {row.id: row for row in rows}

    def sizes(name: str) -> dict[str, tuple[int | None, int | None]]:
        return {v.kind.value: (v.width, v.height) for v in by_id[ids[name]].variants}

    assert sizes("legacy") == {"thumbnail": (None, None), "large": (None, None)}
    assert sizes("png") == {"thumbnail": (None, None)}
    assert sizes("photo") == {"thumbnail": (480, 360), "large": (1600, 1200)}
    assert (by_id[ids["rotated"]].width, by_id[ids["rotated"]].height) == (1000, 2000)
    assert sizes("rotated") == {"thumbnail": (240, 480), "large": (800, 1600)}
    assert (by_id[ids["photo"]].width, by_id[ids["photo"]].height) == (2000, 1500)


# ---------------------------------------------------------------------------
# 重新產生衍生檔（CLI）
# ---------------------------------------------------------------------------


async def _make_legacy_rotated(app, admin_client, db_session) -> uuid.UUID:
    """模擬 2026-09-25 以前上傳的直拍照片：縮圖是躺著的、沒有大圖、沒有
    sha256、寬高是原檔未轉正的尺寸，migration 已經把縮圖寬高清掉。"""
    body = await _upload(admin_client, _rotated_jpeg(2000, 1000), "legacy.jpg", "image/jpeg")
    media_id = uuid.UUID(body["id"])
    storage = LocalMediaStorage(app.state.settings.media_root)
    asset = (
        await db_session.execute(select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == media_id))
    ).scalar_one()
    for variant in list(asset.variants):
        if variant.kind == VariantKind.LARGE:
            storage.delete(variant.storage_key)
            asset.variants.remove(variant)
        else:
            buf = io.BytesIO()
            Image.new("RGB", (480, 240), (0, 0, 255)).save(buf, "WEBP")
            storage.write_bytes(variant.storage_key, buf.getvalue())
            variant.width = variant.height = None
    asset.sha256 = None
    asset.width, asset.height = 2000, 1000
    await db_session.commit()
    return media_id


@pytest.mark.asyncio
async def test_regenerate_rebuilds_legacy_and_transparent_variants(app, admin_client, public_client, db_session):
    legacy_id = await _make_legacy_rotated(app, admin_client, db_session)
    png = await _upload(admin_client, _png_with_hole(), "line.png", "image/png")
    png_id = uuid.UUID(png["id"])
    await db_session.execute(update(MediaVariant).where(MediaVariant.media_id == png_id).values(width=None, height=None))
    fine = await _upload(admin_client, _jpeg(300, 200), "fine.jpg", "image/jpeg")
    await db_session.commit()

    # 官網看得到舊素材時，縮圖寬度不明就不放進 srcset；版本號跟著記錄。
    saved = await admin_client.post(
        f"{API}/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": {"title": "關於", "since_label": "Since 1997", "body_text": "內文。", "caption": "圖說", "photo": {"media_id": str(legacy_id)}}},
    )
    assert saved.status_code == 201, saved.text
    published = await admin_client.post(
        f"{API}/admin/content-items/home_about/publish", json={"revision_id": saved.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    before = (await public_client.get(f"{API}/public/site")).json()["media"][str(legacy_id)]["variants"]
    assert [(v["kind"], v["width"]) for v in before] == [("thumbnail", None)]

    candidates = {c.asset_id: c for c in await regenerate.find_candidates(db_session)}
    await db_session.rollback()
    assert set(candidates) == {legacy_id, png_id}
    assert regenerate.REASON_LEGACY in candidates[legacy_id].reasons
    assert regenerate.REASON_NO_LARGE in candidates[legacy_id].reasons
    assert candidates[png_id].reasons == [regenerate.REASON_STALE]
    assert uuid.UUID(fine["id"]) in {c.asset_id for c in await regenerate.find_candidates(db_session, include_all=True)}
    await db_session.rollback()

    storage = LocalMediaStorage(app.state.settings.media_root)
    old_keys = set(
        (await db_session.execute(select(MediaVariant.storage_key).where(MediaVariant.media_id == legacy_id))).scalars()
    )
    outcome = await regenerate.regenerate_image_variants(db_session, storage, legacy_id)
    await db_session.commit()
    assert set(outcome.old_keys) == old_keys
    assert all(storage.exists(key) for key in outcome.new_keys)

    db_session.expire_all()
    asset = (
        await db_session.execute(select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == legacy_id))
    ).scalar_one()
    assert (asset.width, asset.height) == (1000, 2000)
    assert asset.sha256 is not None and len(asset.sha256) == 64
    assert {v.kind.value: (v.width, v.height) for v in asset.variants} == {"thumbnail": (240, 480), "large": (800, 1600)}
    thumb = await admin_client.get(f"{MEDIA}/{legacy_id}/variants/thumbnail")
    assert Image.open(io.BytesIO(thumb.content)).size == (240, 480)

    after = (await public_client.get(f"{API}/public/site")).json()["media"][str(legacy_id)]["variants"]
    assert [(v["kind"], v["width"]) for v in after] == [("thumbnail", 240), ("large", 800)]
    # 新的衍生檔是新記錄：網址上的版本換掉，瀏覽器不會拿快取過的躺著的縮圖。
    assert after[0]["version"] != before[0]["version"]
    await db_session.rollback()


@pytest.mark.asyncio
async def test_regenerate_cli_dry_run_then_apply(app, admin_client, db_session, monkeypatch, capsys):
    from app import cli

    legacy_id = await _make_legacy_rotated(app, admin_client, db_session)
    png = await _upload(admin_client, _png_with_hole(), "line.png", "image/png")
    await db_session.execute(update(MediaVariant).where(MediaVariant.media_id == uuid.UUID(png["id"])).values(width=None, height=None))
    missing = MediaAsset(
        id=uuid.uuid4(), campus_key=None, kind=MediaKind.IMAGE, status=MediaStatus.READY,
        storage_key=f"{uuid.uuid4().hex}.jpg", original_filename="gone.jpg", content_type="image/jpeg",
        size_bytes=10, width=100, height=100, created_at=datetime.now(timezone.utc),
    )
    db_session.add(missing)
    missing_id = str(missing.id)
    await db_session.commit()
    old_keys = list(
        (await db_session.execute(select(MediaVariant.storage_key).where(MediaVariant.media_id == legacy_id))).scalars()
    )
    await db_session.rollback()

    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)

    async def factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", factory)

    await cli.regenerate_media_variants(apply=False, include_all=False)
    out = capsys.readouterr().out
    assert "dry-run：共 3 張圖片需要重新產生" in out
    assert "legacy.jpg（2026-09-25 以前上傳" in out
    db_session.expire_all()
    assert (await db_session.execute(select(MediaAsset.sha256).where(MediaAsset.id == legacy_id))).scalar_one() is None
    await db_session.rollback()

    with pytest.raises(SystemExit):
        await cli.regenerate_media_variants(apply=True, include_all=False)
    captured = capsys.readouterr()
    assert "共 3 張：已重新產生 2、失敗 1" in captured.out
    assert "gone.jpg（儲存空間裡找不到原檔）" in captured.err

    storage = LocalMediaStorage(app.state.settings.media_root)
    assert not any(storage.exists(key) for key in old_keys)
    db_session.expire_all()
    [entry] = (await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "media.regenerate_variants"))).scalars().all()
    assert set(entry.metadata_json["regenerated"]) == {str(legacy_id), png["id"]}
    assert entry.metadata_json["failed"] == [missing_id]
    await db_session.rollback()

    # 處理完的不會再列出來；只剩讀不到原檔的那張。
    await cli.regenerate_media_variants(apply=False, include_all=False)
    assert "dry-run：共 1 張" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# 活動影片片段對照影片長度（B10-4）
# ---------------------------------------------------------------------------


async def _video(db_session, duration: float | None) -> str:
    asset = MediaAsset(
        id=uuid.uuid4(), campus_key=None, kind=MediaKind.VIDEO, status=MediaStatus.READY,
        storage_key=f"{uuid.uuid4().hex}.mp4", original_filename="run.mp4", content_type="video/mp4",
        size_bytes=10, duration_seconds=duration, created_at=datetime.now(timezone.utc),
    )
    db_session.add(asset)
    await db_session.commit()
    return str(asset.id)


def _news(video_id: str, start: float, end: float | None) -> dict:
    return {
        "sample_note": "", "articles": [], "events": [],
        "films": [{"id": "run", "title": "一起跑", "source": "file", "video": {"media_id": video_id}, "start": start, "end": end}],
    }


@pytest.mark.asyncio
async def test_film_clip_must_fit_video_duration(admin_client, db_session):
    video = await _video(db_session, 12.34)

    async def save(start: float, end: float | None, version: int):
        return await admin_client.post(
            f"{API}/admin/content-items/home_news/revisions", json={"expected_version": version, "payload": _news(video, start, end)}
        )

    too_long = await save(0, 15, 0)
    assert too_long.status_code == 422
    detail = too_long.json()["detail"]
    assert detail["code"] == "MEDIA_CLIP_OUT_OF_RANGE"
    assert detail["field_path"] == "films[0].video.media_id"
    assert "「一起跑」的影片只有 12.34 秒" in detail["message"]
    assert (await save(12.34, None, 0)).json()["detail"]["code"] == "MEDIA_CLIP_OUT_OF_RANGE"

    assert (await save(3, 12.34, 0)).status_code == 201
    assert (await save(12, None, 1)).status_code == 201

    # 影片長度不明（主機沒有 ffprobe）時不擋。
    unknown = await _video(db_session, None)
    response = await admin_client.post(
        f"{API}/admin/content-items/home_news/revisions", json={"expected_version": 2, "payload": _news(unknown, 30, 60)}
    )
    assert response.status_code == 201, response.text
