"""資安修正（media 套件，2026-09-29 白箱稽核）：

- 原檔去除拍攝資訊（EXIF／GPS、XMP、IPTC、註解、影片 udta/meta），保留 ICC 與影片旋轉。
- Pillow 只開 JPEG／PNG／WebP，白名單在解碼之前生效；記憶體不足收斂成既有錯誤。
- ffprobe／ffmpeg 限定 mov demuxer 與 file protocol。
- 解碼、轉檔、抽幀有程序層級的並行上限；poster 影格先看尺寸再解碼。
- 讀檔路由在送檔之前就結束交易、歸還 DB 連線。
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import ExifTags, Image, ImageChops, ImageCms, ImageOps, ImageStat, PngImagePlugin
from sqlalchemy import select
from starlette.responses import StreamingResponse

from app.media import metadata, processing, regenerate, service
from app.media.models import MediaAsset, MediaKind, MediaStatus
from app.media.storage import LocalMediaStorage
from app.media.validation import MediaValidationError, sniff_and_validate
from app.operations.models import AuditLogEntry

API = "/api/website/v1"
MEDIA = f"{API}/admin/media"
FIXTURES = Path("/tmp/media-fixtures")

requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="需要 ffmpeg／ffprobe"
)

SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
GPS_MARKERS = (b"Exif\x00\x00", b"GPS-", b"Kaohsiung", b"TRAILER")


# ---------------------------------------------------------------------------
# 測試素材
# ---------------------------------------------------------------------------


def _pattern(size: tuple[int, int], mode: str = "RGB") -> Image.Image:
    """左上角一塊紅色，轉正後可以看出方向對不對。"""
    img = Image.new(mode, size, (40, 150, 90) if mode == "RGB" else (40, 150, 90, 255))
    img.paste((220, 20, 20) if mode == "RGB" else (220, 20, 20, 255), (0, 0, size[0] // 3, size[1] // 3))
    return img


def _exif(orientation: int | None = None) -> Image.Exif:
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "GPS-PhoneMaker"
    exif[ExifTags.Base.DateTime] = "2026:09:01 10:00:00"
    if orientation is not None:
        exif[ExifTags.Base.Orientation] = orientation
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "N"
    gps[ExifTags.GPS.GPSLatitude] = (25.0, 1.0, 58.8)
    gps[ExifTags.GPS.GPSLongitudeRef] = "E"
    gps[ExifTags.GPS.GPSLongitude] = (121.0, 33.0, 55.44)
    return exif


def _jpeg_segment(marker: int, payload: bytes) -> bytes:
    return bytes((0xFF, marker)) + (len(payload) + 2).to_bytes(2, "big") + payload


def _jpeg_with_metadata(size=(64, 48), orientation: int | None = None) -> bytes:
    buf = io.BytesIO()
    _pattern(size).save(
        buf, "JPEG", quality=90, exif=_exif(orientation).tobytes(), icc_profile=SRGB,
        xmp=b"<x:xmpmeta>GPS-XMP 25.0330,121.5654</x:xmpmeta>", comment=b"GPS-COMMENT",
    )
    data = buf.getvalue()
    iptc = _jpeg_segment(0xED, b"Photoshop 3.0\x008BIM\x04\x04\x00\x00\x00\x00\x00\x10Kaohsiung-City")
    # IPTC 插在 SOI 後面；EOI 之後接廠商附加資料（多圖、動態照片常見）。
    return data[:2] + iptc + data[2:] + b"TRAILER-GPS-25.0330"


def _png_with_metadata(size=(64, 48), orientation: int | None = None) -> bytes:
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "GPS-TEXT")
    info.add_text("Location", "GPS-ZTXT", zip=True)
    info.add_itxt("XML:com.adobe.xmp", "GPS-ITXT")
    info.add(b"tIME", bytes([0x07, 0xEA, 9, 1, 10, 0, 0]))
    info.add(b"prVt", b"GPS-PRIVATE")
    buf = io.BytesIO()
    _pattern(size, "RGBA").save(buf, "PNG", pnginfo=info, exif=_exif(orientation).tobytes(), icc_profile=SRGB)
    return buf.getvalue() + b"TRAILER-GPS"


def _webp_with_metadata(size=(64, 48), orientation: int | None = None) -> bytes:
    buf = io.BytesIO()
    _pattern(size, "RGBA").save(
        buf, "WEBP", lossless=True, exif=_exif(orientation).tobytes(), icc_profile=SRGB,
        xmp=b"<x:xmpmeta>GPS-XMP</x:xmpmeta>",
    )
    return buf.getvalue()


def _png_chunks(data: bytes) -> list[bytes]:
    pos, types = 8, []
    while pos + 8 <= len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        types.append(data[pos + 4:pos + 8])
        pos += 12 + length
        if types[-1] == b"IEND":
            break
    return types


def _webp_chunks(data: bytes) -> list[bytes]:
    pos, types = 12, []
    while pos + 8 <= len(data):
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        types.append(data[pos:pos + 4])
        pos += 8 + size + (size & 1)
    return types


def _minimal_fits() -> bytes:
    """最小的一般 FITS 檔（1x1、未壓縮）：用來確認白名單外的格式連開都不開。"""
    cards = ["SIMPLE  =                    T", "BITPIX  =                    8", "NAXIS   =                    2",
             "NAXIS1  =                    1", "NAXIS2  =                    1", "END"]
    header = "".join(card.ljust(80) for card in cards).ljust(2880).encode("ascii")
    return header + b"\x00" * 2880


def _bmp() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, "BMP")
    return buf.getvalue()


async def _upload(client, data: bytes, name: str, content_type: str, kind: str = "image") -> dict:
    response = await client.post(
        MEDIA, data={"kind": kind, "campus_key": "yihua"}, files={"file": (name, data, content_type)}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _stored(client, db_session, body: dict) -> bytes:
    """素材庫實際存的原檔；順便確認 DB 的大小與 sha256 跟存的位元組一致。"""
    response = await client.get(f"{MEDIA}/{body['id']}/file")
    assert response.status_code == 200
    stored = response.content
    size, sha = (
        await db_session.execute(
            select(MediaAsset.size_bytes, MediaAsset.sha256).where(MediaAsset.id == uuid.UUID(body["id"]))
        )
    ).one()
    await db_session.rollback()
    assert body["size_bytes"] == size == len(stored)
    assert sha == hashlib.sha256(stored).hexdigest()
    return stored


def _close_to(a: Image.Image, b: Image.Image) -> bool:
    assert a.size == b.size
    diff = ImageStat.Stat(ImageChops.difference(a.convert("RGB"), b.convert("RGB"))).mean
    return max(diff) < 4


# ---------------------------------------------------------------------------
# Pillow：白名單在解碼之前生效
# ---------------------------------------------------------------------------


def test_non_whitelisted_formats_are_never_opened(monkeypatch, tmp_path):
    from PIL import BmpImagePlugin, FitsImagePlugin

    opened: list[str] = []

    def _spy(name):
        def _open(self):
            opened.append(name)
            raise AssertionError(f"{name} 解碼器不應該被呼叫")
        return _open

    monkeypatch.setattr(FitsImagePlugin.FitsImageFile, "_open", _spy("FITS"))
    monkeypatch.setattr(BmpImagePlugin.BmpImageFile, "_open", _spy("BMP"))
    for name, data in (("fits.jpg", _minimal_fits()), ("bmp.jpg", _bmp())):
        path = tmp_path / name
        path.write_bytes(data)
        with pytest.raises(MediaValidationError) as exc:
            sniff_and_validate(path, MediaKind.IMAGE)
        assert exc.value.code == "MEDIA_INVALID"
        # 衍生檔與重新產生也只開白名單格式。
        with pytest.raises(Exception):
            processing.make_webp(data, 480)
        with pytest.raises(Exception):
            regenerate._inspect(data, "image/jpeg")
    assert opened == []


@pytest.mark.asyncio
async def test_fits_upload_rejected_as_invalid(admin_client):
    response = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", _minimal_fits(), "image/jpeg")}
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_INVALID"


def test_memory_error_while_decoding_maps_to_too_large(monkeypatch, tmp_path):
    from PIL import ImageFile

    def _boom(self):
        raise MemoryError()

    monkeypatch.setattr(ImageFile.ImageFile, "load", _boom)
    path = tmp_path / "a.jpg"
    path.write_bytes((FIXTURES / "test.jpg").read_bytes())
    with pytest.raises(MediaValidationError) as exc:
        sniff_and_validate(path, MediaKind.IMAGE)
    assert exc.value.code == "MEDIA_TOO_LARGE"


def test_pillow_is_patched_version():
    import PIL

    assert tuple(int(p) for p in PIL.__version__.split(".")[:2]) >= (12, 3)


# ---------------------------------------------------------------------------
# 原檔去除拍攝資訊
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jpeg_metadata_stripped_losslessly(admin_client, db_session):
    original = _jpeg_with_metadata()
    body = await _upload(admin_client, original, "kid.jpg", "image/jpeg")
    stored = await _stored(admin_client, db_session, body)
    for marker in (*GPS_MARKERS, b"http://ns.adobe.com/xap/1.0/", b"Photoshop 3.0", b"GPS-COMMENT"):
        assert marker not in stored, marker
    assert stored.endswith(b"\xff\xd9")
    with Image.open(io.BytesIO(stored)) as clean, Image.open(io.BytesIO(original)) as source:
        assert clean.info.get("icc_profile") == SRGB
        assert not clean.getexif()
        # 只拿掉標記段，熵編碼資料原封不動：解出來的像素完全相同。
        assert clean.tobytes() == source.tobytes()
    assert (body["width"], body["height"]) == (64, 48)


@pytest.mark.asyncio
async def test_rotated_jpeg_is_reencoded_upright_without_exif(admin_client, db_session):
    original = _jpeg_with_metadata((64, 48), orientation=6)
    body = await _upload(admin_client, original, "phone.jpg", "image/jpeg")
    stored = await _stored(admin_client, db_session, body)
    for marker in GPS_MARKERS:
        assert marker not in stored, marker
    with Image.open(io.BytesIO(stored)) as clean, Image.open(io.BytesIO(original)) as source:
        assert clean.size == (48, 64)
        assert clean.getexif().get(ExifTags.Base.Orientation) is None
        assert clean.info.get("icc_profile") == SRGB
        assert _close_to(clean, ImageOps.exif_transpose(source))
    assert (body["width"], body["height"]) == (48, 64)


@pytest.mark.asyncio
async def test_png_metadata_chunks_dropped(admin_client, db_session):
    original = _png_with_metadata()
    body = await _upload(admin_client, original, "line.png", "image/png")
    stored = await _stored(admin_client, db_session, body)
    chunks = _png_chunks(stored)
    assert not {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME", b"prVt"} & set(chunks)
    assert b"iCCP" in chunks and chunks[-1] == b"IEND" and stored.endswith(b"IEND\xaeB`\x82")
    for marker in GPS_MARKERS:
        assert marker not in stored, marker
    with Image.open(io.BytesIO(stored)) as clean, Image.open(io.BytesIO(original)) as source:
        assert clean.info.get("icc_profile") == SRGB
        assert clean.tobytes() == source.tobytes()


@pytest.mark.asyncio
async def test_rotated_png_is_reencoded_upright(admin_client, db_session):
    original = _png_with_metadata((64, 48), orientation=6)
    body = await _upload(admin_client, original, "phone.png", "image/png")
    stored = await _stored(admin_client, db_session, body)
    assert not {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"} & set(_png_chunks(stored))
    with Image.open(io.BytesIO(stored)) as clean, Image.open(io.BytesIO(original)) as source:
        assert clean.size == (48, 64)
        assert clean.tobytes() == ImageOps.exif_transpose(source).tobytes()
    assert (body["width"], body["height"]) == (48, 64)


@pytest.mark.asyncio
async def test_webp_exif_and_xmp_dropped_and_flags_fixed(admin_client, db_session):
    original = _webp_with_metadata()
    assert {b"EXIF", b"XMP "} <= set(_webp_chunks(original))
    body = await _upload(admin_client, original, "a.webp", "image/webp")
    stored = await _stored(admin_client, db_session, body)
    chunks = _webp_chunks(stored)
    assert b"EXIF" not in chunks and b"XMP " not in chunks and b"ICCP" in chunks
    assert chunks[0] == b"VP8X"
    flags = stored[20]
    assert not flags & 0x08 and not flags & 0x04 and flags & 0x20
    assert int.from_bytes(stored[4:8], "little") == len(stored) - 8
    with Image.open(io.BytesIO(stored)) as clean, Image.open(io.BytesIO(original)) as source:
        assert clean.info.get("icc_profile") == SRGB
        assert "exif" not in clean.info and "xmp" not in clean.info
        assert clean.tobytes() == source.tobytes()


@pytest.mark.asyncio
async def test_rotated_webp_is_reencoded_upright(admin_client, db_session):
    original = _webp_with_metadata((64, 48), orientation=6)
    body = await _upload(admin_client, original, "phone.webp", "image/webp")
    stored = await _stored(admin_client, db_session, body)
    assert b"EXIF" not in _webp_chunks(stored)
    with Image.open(io.BytesIO(stored)) as clean, Image.open(io.BytesIO(original)) as source:
        assert clean.size == (48, 64)
        assert clean.tobytes() == ImageOps.exif_transpose(source).tobytes()
    assert (body["width"], body["height"]) == (48, 64)


def test_strip_is_idempotent_and_leaves_clean_files_untouched():
    for data, content_type in (
        (_jpeg_with_metadata(), "image/jpeg"),
        (_jpeg_with_metadata(orientation=8), "image/jpeg"),
        (_png_with_metadata(), "image/png"),
        (_webp_with_metadata(orientation=3), "image/webp"),
    ):
        once, _ = metadata.strip_image_bytes(data, content_type)
        twice, _ = metadata.strip_image_bytes(once, content_type)
        assert once == twice, content_type
    plain = (FIXTURES / "test.jpg").read_bytes()
    assert metadata.strip_image_bytes(plain, "image/jpeg") == (plain, (100, 80))


def _make_tagged_video(tmp_path: Path) -> tuple[Path, bool]:
    base = tmp_path / "base.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=green:s=160x120:d=1",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            "-metadata", "location=+25.0330+121.5654/", "-metadata", "title=GPS-TITLE",
            "-metadata", "creation_time=2026-09-01T10:00:00Z", "-movflags", "use_metadata_tags", str(base),
        ],
        check=True, capture_output=True, timeout=60,
    )
    rotated = tmp_path / "rotated.mp4"
    result = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-display_rotation", "90", "-i", str(base), "-c", "copy",
         "-map_metadata", "0", "-movflags", "use_metadata_tags", str(rotated)],
        capture_output=True, timeout=60,
    )
    if result.returncode != 0:  # 舊版 ffmpeg 沒有 -display_rotation：只驗 metadata。
        return base, False
    return rotated, True


def _ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_side_data:stream=codec_type",
         "-of", "json", str(path)],
        check=True, capture_output=True, timeout=30,
    ).stdout
    return json.loads(out)


def _rotation(info: dict) -> int | None:
    for stream in info.get("streams", []):
        for side in stream.get("side_data_list", []):
            if "rotation" in side:
                return int(side["rotation"])
    return None


@requires_ffmpeg
@pytest.mark.asyncio
async def test_video_location_tags_removed_rotation_kept(admin_client, db_session, tmp_path):
    source, rotated = _make_tagged_video(tmp_path)
    before = _ffprobe(source)
    assert before["format"]["tags"].get("location") == "+25.0330+121.5654/"
    if rotated:
        assert abs(_rotation(before)) == 90

    body = await _upload(admin_client, source.read_bytes(), "clip.mp4", "video/mp4", kind="video")
    assert body["status"] == "ready"
    stored = await _stored(admin_client, db_session, body)
    assert b"25.0330" not in stored and b"GPS-TITLE" not in stored
    clean = tmp_path / "stored.mp4"
    clean.write_bytes(stored)
    after = _ffprobe(clean)
    tags = {k.lower() for k in after["format"].get("tags", {})}
    assert not tags & {"location", "location-eng", "title", "creation_time"}
    assert {s["codec_type"] for s in after["streams"]} == {"video", "audio"}
    if rotated:
        assert _rotation(after) == _rotation(before)
    assert body["duration_seconds"] and body["width"] == 160 and body["height"] == 120


# ---------------------------------------------------------------------------
# ffprobe／ffmpeg 限定 demuxer 與 protocol
# ---------------------------------------------------------------------------


def _assert_guarded(argv: list[str]) -> None:
    input_at = argv.index("-i") if "-i" in argv else len(argv) - 1
    head = argv[:input_at]
    assert "-protocol_whitelist" in head and head[head.index("-protocol_whitelist") + 1] == "file", argv
    assert "-f" in head and head[head.index("-f") + 1] == "mov", argv
    if argv[0] == "ffmpeg":
        assert "-nostdin" in head, argv


def test_ffmpeg_and_ffprobe_restrict_demuxer_and_protocol(monkeypatch, tmp_path):
    calls: list[list[str]] = []

    def _fake_run(argv, **kwargs):
        calls.append(list(argv))
        assert kwargs.get("stdin") == subprocess.DEVNULL
        return subprocess.CompletedProcess(argv, 1, b"", b"fake failure")

    monkeypatch.setattr(processing.subprocess, "run", _fake_run)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    processing.probe_video(video)
    with pytest.raises(processing.ProcessingError):
        processing.extract_video_poster(video)
    with pytest.raises(MediaValidationError):
        metadata.strip_video_file(video, tmp_path / "out.mp4")
    assert [c[0] for c in calls] == ["ffprobe", "ffmpeg", "ffmpeg"]
    for argv in calls:
        _assert_guarded(argv)
    # 抽 poster 的 ffmpeg 解碼端也限制像素數。
    assert calls[1][calls[1].index("-max_pixels") + 1] == str(processing.MAX_IMAGE_PIXELS)
    # 去 metadata 只複製影音軌，不轉碼、不帶資料軌與章節。
    strip = calls[2]
    assert strip[strip.index("-map_metadata") + 1] == "-1" and strip[strip.index("-c") + 1] == "copy"


def test_poster_frame_size_checked_before_decoding(monkeypatch, tmp_path):
    def _fake_run(argv, **kwargs):
        Image.new("RGB", (40, 30)).save(argv[-1], "PNG")
        return subprocess.CompletedProcess(argv, 0, b"", b"")

    decoded: list[object] = []
    monkeypatch.setattr(processing.subprocess, "run", _fake_run)
    monkeypatch.setattr(processing, "make_webp", lambda *a, **k: decoded.append(a))
    monkeypatch.setattr(processing, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(processing.ProcessingError, match="像素"):
        processing.extract_video_poster(tmp_path / "in.mp4")
    assert decoded == []


# ---------------------------------------------------------------------------
# 並行上限
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_image_processing_concurrency_is_bounded(admin_client, monkeypatch):
    lock = threading.Lock()
    state = {"now": 0, "peak": 0}

    def _slow_validate(path, kind):
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        time.sleep(0.15)
        with lock:
            state["now"] -= 1
        raise MediaValidationError("MEDIA_INVALID", "測試")

    monkeypatch.setattr(service, "sniff_and_validate", _slow_validate)
    data = (FIXTURES / "test.jpg").read_bytes()
    responses = await asyncio.gather(*[
        admin_client.post(MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", data, "image/jpeg")})
        for _ in range(5)
    ])
    assert [r.status_code for r in responses] == [422] * 5
    assert state["peak"] == processing.MEDIA_JOB_CONCURRENCY == 2


# ---------------------------------------------------------------------------
# 送檔期間不握 DB 連線
# ---------------------------------------------------------------------------


class _SlowStorage:
    """送檔時每一塊都記下連線池借出的連線數。"""

    def __init__(self, engine) -> None:
        self.engine = engine
        self.checked_out: list[int] = []

    async def file_response(self, storage_key, *, request, media_type, headers):
        async def body():
            for _ in range(3):
                self.checked_out.append(self.engine.sync_engine.pool.checkedout())
                await asyncio.sleep(0.01)
                yield b"x" * 16

        return StreamingResponse(body(), media_type=media_type, headers=headers)


@pytest.mark.asyncio
async def test_file_routes_release_db_connection_before_streaming(app, admin_client, monkeypatch):
    body = await _upload(admin_client, (FIXTURES / "test.jpg").read_bytes(), "a.jpg", "image/jpeg")
    slow = _SlowStorage(app.state.engine)
    monkeypatch.setattr(service, "get_storage", lambda settings: slow)
    urls = [
        f"{MEDIA}/{body['id']}/file",
        f"{MEDIA}/{body['id']}/variants/thumbnail",
        # 帶後台 session 的草稿預覽：公開路由也有查 session 與權限。
        f"{API}/public/media/{body['id']}/file",
        f"{API}/public/media/{body['id']}/variants/thumbnail",
    ]
    for url in urls:
        slow.checked_out.clear()
        response = await admin_client.get(url)
        assert response.status_code == 200, (url, response.text)
        assert response.content == b"x" * 48
        assert slow.checked_out == [0, 0, 0], url


# ---------------------------------------------------------------------------
# 既有素材：strip-media-metadata 指令
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strip_media_metadata_cli_dry_run_apply_and_rerun(app, db_session, monkeypatch, capsys, tmp_path):
    from app import cli

    media_root = tmp_path / "media"
    storage = LocalMediaStorage(str(media_root))
    settings = app.state.settings.model_copy(update={"media_root": str(media_root)})
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    async def factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", factory)

    def _asset(data: bytes, content_type: str, ext: str, *, sha: bool = True, width=64, height=48) -> MediaAsset:
        key = storage.generate_key(ext)
        storage.write_bytes(key, data)
        return MediaAsset(
            id=uuid.uuid4(), campus_key="yihua", kind=MediaKind.IMAGE, status=MediaStatus.READY,
            storage_key=key, original_filename=f"old{ext}", content_type=content_type, size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest() if sha else None, width=width, height=height,
            created_at=datetime.now(timezone.utc),
        )

    tagged = _asset(_jpeg_with_metadata(), "image/jpeg", ".jpg")
    # 2026-09-25 以前的舊素材：sha256 為 NULL、寬高沒轉正；sha256 要留給重新產生縮圖判斷。
    legacy = _asset(_jpeg_with_metadata((64, 48), orientation=6), "image/jpeg", ".jpg", sha=False)
    clean_bytes = (FIXTURES / "test.jpg").read_bytes()
    clean = _asset(clean_bytes, "image/jpeg", ".jpg", width=100, height=80)
    missing = MediaAsset(
        id=uuid.uuid4(), campus_key=None, kind=MediaKind.IMAGE, status=MediaStatus.READY,
        storage_key=f"{uuid.uuid4().hex}.png", original_filename="gone.png", content_type="image/png",
        size_bytes=10, width=1, height=1, created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([tagged, legacy, clean, missing])
    await db_session.commit()
    keys = {a.id: a.storage_key for a in (tagged, legacy, clean)}

    await cli.strip_media_metadata(apply=False)
    out = capsys.readouterr().out
    assert "dry-run：共 4 個素材：會去除 2、已乾淨 1、找不到檔案 1、無法處理 0" in out
    assert storage.exists(keys[tagged.id]) and storage.exists(keys[legacy.id])

    await cli.strip_media_metadata(apply=True)
    out = capsys.readouterr().out
    assert "共 4 個素材：已去除 2、已乾淨 1、找不到檔案 1、無法處理 0" in out

    rows = {
        row.id: row
        for row in (await db_session.execute(
            select(MediaAsset).where(MediaAsset.id.in_(list(keys))).execution_options(populate_existing=True)
        )).scalars()
    }
    for asset_id in (tagged.id, legacy.id):
        row = rows[asset_id]
        assert row.storage_key != keys[asset_id]
        assert not storage.exists(keys[asset_id])  # 舊檔在 commit 之後刪掉
        stored = storage.read_bytes(row.storage_key)
        assert b"Exif\x00\x00" not in stored and b"Kaohsiung" not in stored and b"TRAILER" not in stored
        assert row.size_bytes == len(stored)
    assert rows[tagged.id].sha256 == hashlib.sha256(storage.read_bytes(rows[tagged.id].storage_key)).hexdigest()
    assert rows[legacy.id].sha256 is None
    assert (rows[legacy.id].width, rows[legacy.id].height) == (48, 64)
    assert rows[clean.id].storage_key == keys[clean.id]
    [entry] = (await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == "media.strip_metadata")
    )).scalars().all()
    assert entry.metadata_json["stripped"] == sorted([str(tagged.id), str(legacy.id)])
    await db_session.rollback()

    # 重跑：已經乾淨，什麼都不動。
    await cli.strip_media_metadata(apply=True)
    assert "共 4 個素材：已去除 0、已乾淨 3、找不到檔案 1、無法處理 0" in capsys.readouterr().out


def test_storage_download_file_local_and_s3(tmp_path):
    """strip-media-metadata 讀原檔用 download_file：本機與 S3 都落地成暫存檔，不在丟 MediaFileMissing。"""
    import boto3
    from moto import mock_aws

    from app.media.storage import MediaFileMissing, S3MediaStorage

    local = LocalMediaStorage(str(tmp_path / "media"))
    local.write_bytes("a.jpg", b"local-bytes")
    local.download_file("a.jpg", tmp_path / "local.out")
    assert (tmp_path / "local.out").read_bytes() == b"local-bytes"
    with pytest.raises(MediaFileMissing):
        local.download_file("missing.jpg", tmp_path / "x")

    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="ivy-media")
        remote = S3MediaStorage(
            bucket="ivy-media", access_key_id="k", secret_access_key="s", region="us-east-1", prefix="media/"
        )
        remote.write_bytes("b.mp4", b"s3-bytes")
        remote.download_file("b.mp4", tmp_path / "s3.out")
        assert (tmp_path / "s3.out").read_bytes() == b"s3-bytes"
        with pytest.raises(MediaFileMissing):
            remote.download_file("missing.mp4", tmp_path / "y")


# ---------------------------------------------------------------------------
# 同校配額鎖不受一般 lock_timeout 限制（稽核 media-quota-lock-timeout-500）
# ---------------------------------------------------------------------------


async def _media_app_with_lock_timeout(db_session, lock_timeout_ms: int):
    from app.auth.models import Role
    from app.main import create_app
    from tests.conftest import _create_user, _logged_in_client, _test_settings

    await _create_user(db_session, "media-lock@ivy.example", "media-lock-password-1", Role.SUPER_ADMIN)
    app = create_app(_test_settings().model_copy(update={"db_lock_timeout_ms": lock_timeout_ms}))
    client = await _logged_in_client(app, "media-lock@ivy.example", "media-lock-password-1")
    return app, client


@pytest.mark.asyncio
async def test_quota_lock_wait_outlasts_the_default_lock_timeout(db_session):
    """持鎖的上傳在交易內還要寫檔、產生衍生檔，常超過一般的 lock_timeout；原本
    第二個上傳等不到鎖就變成 500。現在等配額鎖另有上限（120 秒），排得到就成功。"""
    from sqlalchemy import text

    app, client = await _media_app_with_lock_timeout(db_session, lock_timeout_ms=200)
    data = (FIXTURES / "test.jpg").read_bytes()
    conn = await db_session.connection()
    try:
        await conn.execute(text("SELECT pg_advisory_lock(hashtext('media-quota:yihua'))"))
        upload = asyncio.create_task(
            client.post(MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", data, "image/jpeg")})
        )
        deadline = time.monotonic() + 10
        while not (await conn.execute(
            text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")
        )).scalar_one():
            assert time.monotonic() < deadline, "上傳沒有開始等配額鎖"
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.6)  # 超過這個 app 的 lock_timeout（200 ms）
        await conn.execute(text("SELECT pg_advisory_unlock(hashtext('media-quota:yihua'))"))
        response = await upload
    finally:
        await db_session.rollback()
        await client.aclose()
        await app.state.engine.dispose()
        await app.state.rate_limit_engine.dispose()
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_quota_lock_timeout_is_409_not_500(db_session, monkeypatch):
    """真的等太久（超過配額鎖的上限）時回 409 MEDIA_BUSY 請使用者重試，不是 500。"""
    from sqlalchemy import text

    monkeypatch.setattr(service, "QUOTA_LOCK_TIMEOUT", "200ms")
    app, client = await _media_app_with_lock_timeout(db_session, lock_timeout_ms=10_000)
    data = (FIXTURES / "test.jpg").read_bytes()
    conn = await db_session.connection()
    try:
        await conn.execute(text("SELECT pg_advisory_lock(hashtext('media-quota:yihua'))"))
        response = await client.post(
            MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", data, "image/jpeg")}
        )
        await conn.execute(text("SELECT pg_advisory_unlock(hashtext('media-quota:yihua'))"))
    finally:
        await db_session.rollback()
        await client.aclose()
        await app.state.engine.dispose()
        await app.state.rate_limit_engine.dispose()
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "MEDIA_BUSY"
