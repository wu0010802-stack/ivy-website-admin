"""上傳圖片的原檔會公開供應：GPS、機型、XMP、註解要拿掉，拍攝方向與像素不變。"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

from app.media import metadata
from app.media.storage import LocalMediaStorage
from app.media.validation import MediaValidationError

MEDIA = "/api/website/v1/admin/media"
XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description exif:GPSLatitude="22,37.5N"/></x:xmpmeta>'


def _exif(orientation: int | None = 6) -> Image.Exif:
    exif = Image.Exif()
    if orientation is not None:
        exif[0x0112] = orientation
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0110] = "PhoneModel X"  # Model
    exif[0x9003] = "2026:09:01 10:00:00"  # DateTimeOriginal（Exif IFD 內，這裡放主 IFD 也一樣會被清）
    gps = {1: "N", 2: (22.0, 37.0, 30.0), 3: "E", 4: (120.0, 18.0, 5.0)}
    exif[0x8825] = gps
    return exif


def _image() -> Image.Image:
    img = Image.new("RGB", (64, 32))
    for x in range(64):
        img.putpixel((x, x % 32), (x * 3, 200 - x, 40))
    return img


def _jpeg(orientation: int | None = 6) -> bytes:
    buf = io.BytesIO()
    _image().save(buf, "JPEG", exif=_exif(orientation).tobytes(), comment=b"shot at home", quality=90)
    data = buf.getvalue()
    # 補一段 XMP APP1（Pillow 存檔不會自己寫）。
    xmp = b"http://ns.adobe.com/xap/1.0/\x00" + XMP
    return data[:2] + b"\xff\xe1" + len(xmp + b"..").to_bytes(2, "big") + xmp + data[2:]


def _png() -> bytes:
    info = PngImagePlugin.PngInfo()
    info.add_text("Location", "home")
    info.add_itxt("XML:com.adobe.xmp", XMP.decode())
    buf = io.BytesIO()
    _image().save(buf, "PNG", pnginfo=info, exif=_exif(6).tobytes())
    return buf.getvalue()


def _webp() -> bytes:
    buf = io.BytesIO()
    _image().save(buf, "WEBP", lossless=True, exif=_exif(6).tobytes(), xmp=XMP)
    return buf.getvalue()


def _strip(tmp_path: Path, data: bytes, content_type: str) -> tuple[bytes, tuple[int, int] | None]:
    """走正式流程用的 strip_file（上傳、替換、匯入、CLI 都是它）：寫到 dst、src 不動。"""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.write_bytes(data)
    size = metadata.strip_file(src, dst, content_type)
    assert src.read_bytes() == data, "來源檔不能被改動"
    return dst.read_bytes(), size


def _assert_clean(data: bytes, original: bytes, *, orientation: int | None) -> None:
    assert b"PhoneModel" not in data and b"PhoneMaker" not in data
    assert b"GPSLatitude" not in data and b"xmpmeta" not in data
    with Image.open(io.BytesIO(data)) as img:
        exif = img.getexif()
        assert 0x8825 not in exif, "GPS IFD 要拿掉"
        assert exif.get(0x0112) == orientation, "拍攝方向要保留，否則照片會躺著"
        assert "Location" not in img.info and "comment" not in img.info
        with Image.open(io.BytesIO(original)) as before:
            assert img.tobytes() == before.tobytes(), "像素不能重新編碼"


@pytest.mark.parametrize(
    ("maker", "content_type"),
    [(_jpeg, "image/jpeg"), (_png, "image/png"), (_webp, "image/webp")],
)
def test_strips_gps_camera_xmp_and_keeps_orientation(tmp_path, maker, content_type):
    original = maker()
    assert b"PhoneModel" in original, "測試圖要真的帶中繼資料"
    cleaned, size = _strip(tmp_path, original, content_type)
    _assert_clean(cleaned, original, orientation=6)
    # 方向 6：原始像素 64x32，素材記轉正後的寬高。
    assert size == (32, 64)


def test_jpeg_without_orientation_keeps_no_exif(tmp_path):
    original = _jpeg(orientation=None)
    cleaned, size = _strip(tmp_path, original, "image/jpeg")
    _assert_clean(cleaned, original, orientation=None)
    assert b"Exif\x00\x00" not in cleaned
    assert size == (64, 32)


def test_malformed_file_is_left_untouched(tmp_path):
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.write_bytes(b"\xff\xd8\xff\xe1\xff\xff")
    with pytest.raises(MediaValidationError) as exc:
        metadata.strip_file(src, dst, "image/jpeg")
    assert exc.value.code == "MEDIA_INVALID"
    assert not dst.exists()
    assert src.read_bytes() == b"\xff\xd8\xff\xe1\xff\xff"


@pytest.mark.asyncio
async def test_uploaded_original_has_no_gps(admin_client, app):
    response = await admin_client.post(
        MEDIA,
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("trip.jpg", _jpeg(), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    # 方向 6：原始像素 64x32，轉正後直的。
    assert (body["width"], body["height"]) == (32, 64)

    from sqlalchemy import select

    from app.media.models import MediaAsset

    async with app.state.session_factory() as db:
        asset = (await db.execute(select(MediaAsset).where(MediaAsset.id == body["id"]))).scalar_one()
    stored = LocalMediaStorage(Path(app.state.settings.media_root)).path_for(asset.storage_key).read_bytes()
    assert asset.size_bytes == len(stored)
    assert b"PhoneModel" not in stored and b"xmpmeta" not in stored
    with Image.open(io.BytesIO(stored)) as img:
        assert 0x8825 not in img.getexif()
        assert img.getexif().get(0x0112) == 6


def _mpo() -> bytes:
    """相機／部分手機的 JPEG：帶 MPF 多圖索引與第二張附帶影像，Pillow 認成 MPO。"""
    second = Image.new("RGB", (32, 16), (200, 40, 40))
    buf = io.BytesIO()
    _image().save(buf, format="MPO", save_all=True, append_images=[second], exif=_exif(None).tobytes(), quality=90)
    data = buf.getvalue()
    with Image.open(io.BytesIO(data)) as img:
        assert img.format == "MPO" and img.n_frames == 2, "測試圖要真的是兩頁 MPO"
    assert b"MPF\x00" in data
    return data


def test_mpo_is_accepted_as_jpeg(tmp_path):
    """2026-10-22 稽核：MPO（多圖 JPEG）原本被當成不支援的格式拒收。"""
    from app.media.models import MediaKind
    from app.media.validation import sniff_and_validate

    path = tmp_path / "camera.jpg"
    path.write_bytes(_mpo())
    assert sniff_and_validate(path, MediaKind.IMAGE) == ("image/jpeg", 64, 32)


@pytest.mark.asyncio
async def test_uploaded_mpo_is_stored_as_plain_jpeg_without_mpf(admin_client, app):
    """上傳 MPO：存成 image/jpeg，原檔去掉 MPF 索引與附帶影像（EOI 之後的資料），衍生檔照常產生。"""
    original = _mpo()
    response = await admin_client.post(
        MEDIA,
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("camera.jpg", original, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["content_type"] == "image/jpeg"
    assert (body["width"], body["height"]) == (64, 32)
    assert [v["kind"] for v in body["variants"]] == ["thumbnail"]

    from sqlalchemy import select

    from app.media.models import MediaAsset, MediaVariant

    async with app.state.session_factory() as db:
        asset = (await db.execute(select(MediaAsset).where(MediaAsset.id == body["id"]))).scalar_one()
        variants = (await db.execute(select(MediaVariant).where(MediaVariant.media_id == asset.id))).scalars().all()
    storage = LocalMediaStorage(Path(app.state.settings.media_root))
    stored = storage.path_for(asset.storage_key).read_bytes()
    assert asset.content_type == "image/jpeg"
    assert asset.size_bytes == len(stored) < len(original)
    assert b"MPF\x00" not in stored and b"PhoneModel" not in stored
    with Image.open(io.BytesIO(stored)) as img:
        assert img.format == "JPEG"
        assert getattr(img, "n_frames", 1) == 1
        assert img.size == (64, 32)
        with Image.open(io.BytesIO(original)) as before:
            assert img.tobytes() == before.tobytes(), "主圖像素不能重新編碼"
    assert variants
    for variant in variants:
        with Image.open(storage.path_for(variant.storage_key)) as derived:
            derived.load()
            assert derived.size[0] > 0
