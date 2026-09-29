"""素材原檔去除拍攝資訊。

園方多半用手機拍孩子的照片、影片直接上傳，原檔會公開在官網（高解析 srcset、
放大檢視、og:image、影片本體）。手機開定位時 EXIF／XMP 帶 GPS 座標，影片的
udta／meta 也有拍攝地點與時間，所以原檔存進儲存體之前一律先去掉：

- JPEG：只留 APP0（JFIF）、APP2 的 ICC profile、APP14（Adobe，CMYK 色彩轉換要用）
  與影像本身的標記段；APP1（EXIF、XMP）、APP13（IPTC／Photoshop）、COM、其他 APPn
  （MPF 多圖索引、C2PA…）與 EOI 之後的附加資料（多圖、動態照片）都拿掉。熵編碼
  資料原封不動，不重新壓縮。
- PNG：只留影像需要的 chunk 與色彩、透明相關的 ancillary chunk（iCCP、sRGB…）；
  eXIf、tEXt、zTXt、iTXt、tIME 與不認得的私有 chunk 都拿掉。
- WebP：拿掉 EXIF、XMP 與不認得的 chunk，同時清掉 VP8X 裡對應的旗標。
- EXIF 有拍攝方向（Orientation 2–8）時，拿掉 EXIF 會讓瀏覽器把照片顯示成躺著
  的，所以改成依方向轉正後重新編碼（JPEG quality 95；PNG、無損 WebP 維持無損），
  保留 ICC profile；重新編碼的結果再走一次上面的篩選。動畫圖不轉（只轉得了
  第一格），只拿掉資訊。
- MP4：ffmpeg 只複製影像與聲音軌（不轉碼）、不帶任何 metadata 與章節。旋轉記在
  顯示矩陣（tkhd），不是 metadata，照樣保留；資料軌（例如運動相機的 GPS 軌跡）
  與封面圖不帶。

同一個檔案處理兩次結果相同，已經乾淨的檔案原樣不動，既有素材可以重跑
`python -m app.cli strip-media-metadata`。
"""
from __future__ import annotations

import io
import subprocess
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.media.processing import CONTENT_TYPE_BY_FORMAT, FFMPEG_INPUT_GUARD, MAX_IMAGE_PIXELS
from app.media.validation import MediaValidationError

_FORMAT_BY_CONTENT_TYPE = {content_type: fmt for fmt, content_type in CONTENT_TYPE_BY_FORMAT.items()}
STRIPPABLE_CONTENT_TYPES = frozenset({*_FORMAT_BY_CONTENT_TYPE, "video/mp4"})

_EXIF_ORIENTATION = 0x0112
_ROTATED_ORIENTATIONS = {2, 3, 4, 5, 6, 7, 8}

# 影片只複製不轉碼，150 MB 也是幾秒的事；逾時多半是檔案有問題。
VIDEO_STRIP_TIMEOUT_SECONDS = 120


def _invalid(detail: str = "檔案結構不完整") -> MediaValidationError:
    return MediaValidationError("MEDIA_INVALID", f"無法去除拍攝資訊：{detail}")


# ---------------------------------------------------------------------------
# JPEG
# ---------------------------------------------------------------------------

_JPEG_KEEP_APP = {0xE0, 0xEE}  # APP0 JFIF、APP14 Adobe
_ICC_PROFILE = b"ICC_PROFILE\x00"
_EXIF_HEADER = b"Exif\x00\x00"


def _keep_jpeg_segment(marker: int, payload: bytes) -> bool:
    if marker == 0xFE:  # COM
        return False
    if 0xE0 <= marker <= 0xEF:
        return marker in _JPEG_KEEP_APP or (marker == 0xE2 and payload.startswith(_ICC_PROFILE))
    return True


def _jpeg_scan_end(data: bytes, pos: int) -> int:
    """SOS 之後的熵編碼資料到哪裡結束：下一個不是 FF00、RST 或 FF 填充的 marker。"""
    n = len(data)
    while True:
        i = data.find(b"\xff", pos)
        if i < 0 or i + 1 >= n:
            return n
        following = data[i + 1]
        if following == 0xFF:
            pos = i + 1
        elif following == 0x00 or 0xD0 <= following <= 0xD7:
            pos = i + 2
        else:
            return i


def _strip_jpeg(data: bytes) -> tuple[bytes, bool, bool]:
    if not data.startswith(b"\xff\xd8"):
        raise _invalid()
    out = bytearray(b"\xff\xd8")
    has_exif = False
    pos, n = 2, len(data)
    while pos < n:
        # 標記段之間的雜訊與填充位元組（Pillow 讀檔時也會略過）不保留。
        while pos < n and data[pos] != 0xFF:
            pos += 1
        while pos < n and data[pos] == 0xFF:
            pos += 1
        if pos >= n:
            break
        marker = data[pos]
        pos += 1
        if marker == 0xD9:  # EOI：之後的附加資料一律不留
            out += b"\xff\xd9"
            break
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out += bytes((0xFF, marker))
            continue
        if marker == 0xD8 or pos + 2 > n:
            raise _invalid()
        end = pos + int.from_bytes(data[pos:pos + 2], "big")
        if end < pos + 2 or end > n:
            raise _invalid()
        payload = data[pos + 2:end]
        if marker == 0xE1 and payload.startswith(_EXIF_HEADER):
            has_exif = True
        if _keep_jpeg_segment(marker, payload):
            out += bytes((0xFF, marker)) + data[pos:end]
        pos = end
        if marker == 0xDA:  # SOS
            scan_end = _jpeg_scan_end(data, pos)
            out += data[pos:scan_end]
            pos = scan_end
    return bytes(out), has_exif, False


# ---------------------------------------------------------------------------
# PNG
# ---------------------------------------------------------------------------

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# 大寫開頭的 critical chunk（IHDR、PLTE、IDAT、IEND）一律保留；ancillary 只留這些。
# iDOT（Apple 平行解碼索引）記的是位移，拿掉前面的 chunk 之後會錯，所以不留。
_PNG_KEEP_ANCILLARY = {
    b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"iCCP", b"sBIT", b"pHYs", b"bKGD", b"hIST", b"sPLT",
    b"acTL", b"fcTL", b"fdAT", b"cICP", b"mDCV", b"cLLI",
}
_PNG_TEXT_CHUNKS = {b"tEXt", b"zTXt", b"iTXt"}
_PNG_EXIF_TEXT_KEY = b"Raw profile type exif"  # Pillow 也從這個文字欄位讀 EXIF


def _strip_png(data: bytes) -> tuple[bytes, bool, bool]:
    if not data.startswith(_PNG_SIGNATURE):
        raise _invalid()
    out = bytearray(_PNG_SIGNATURE)
    has_exif = False
    pos, n = len(_PNG_SIGNATURE), len(data)
    while pos < n:
        if pos + 12 > n:
            raise _invalid()
        length = int.from_bytes(data[pos:pos + 4], "big")
        chunk_type = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > n:
            raise _invalid()
        if chunk_type == b"eXIf" or (
            chunk_type in _PNG_TEXT_CHUNKS and data[pos + 8:end - 4].split(b"\x00", 1)[0] == _PNG_EXIF_TEXT_KEY
        ):
            has_exif = True
        if not chunk_type[0] & 0x20 or chunk_type in _PNG_KEEP_ANCILLARY:
            out += data[pos:end]
        pos = end
        if chunk_type == b"IEND":  # 之後的附加資料不留
            break
    return bytes(out), has_exif, False


# ---------------------------------------------------------------------------
# WebP
# ---------------------------------------------------------------------------

_WEBP_KEEP = {b"VP8X", b"ICCP", b"ANIM", b"ANMF", b"ALPH", b"VP8 ", b"VP8L"}
_VP8X_EXIF_FLAG = 0x08
_VP8X_XMP_FLAG = 0x04


def _strip_webp(data: bytes) -> tuple[bytes, bool, bool]:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise _invalid()
    end = 8 + int.from_bytes(data[4:8], "little")
    if end > len(data):
        raise _invalid()
    chunks: list[bytes] = []
    has_exif = lossless = False
    pos = 12
    while pos < end:
        if pos + 8 > end:
            raise _invalid()
        fourcc = data[pos:pos + 4]
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        body_end = pos + 8 + size
        if body_end > end:
            raise _invalid()
        padded_end = min(body_end + (size & 1), end)
        if fourcc == b"EXIF":
            has_exif = True
        elif fourcc == b"VP8L":
            lossless = True
        if fourcc in _WEBP_KEEP:
            chunk = bytearray(data[pos:padded_end])
            if size & 1 and len(chunk) == 8 + size:
                chunk += b"\x00"
            if fourcc == b"VP8X" and size >= 1:
                chunk[8] &= ~(_VP8X_EXIF_FLAG | _VP8X_XMP_FLAG) & 0xFF
            chunks.append(bytes(chunk))
        pos = padded_end
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + len(body).to_bytes(4, "little") + body, has_exif, lossless


_STRIPPERS = {"JPEG": _strip_jpeg, "PNG": _strip_png, "WEBP": _strip_webp}


# ---------------------------------------------------------------------------
# 拍攝方向：轉正後重新編碼
# ---------------------------------------------------------------------------


def _check_pixels(img: Image.Image) -> None:
    width, height = img.size
    if width * height > MAX_IMAGE_PIXELS:
        raise MediaValidationError("MEDIA_TOO_LARGE", f"圖片像素過多（{width}x{height}），已拒絕解碼")


def _needs_rotation(data: bytes, fmt: str) -> bool:
    """EXIF 的拍攝方向是否要轉（跟 processing.oriented_size、ImageOps.exif_transpose
    讀同一個來源）。動畫圖不轉：exif_transpose 只轉得了第一格。"""
    with Image.open(io.BytesIO(data), formats=(fmt,)) as img:
        _check_pixels(img)
        if getattr(img, "n_frames", 1) > 1:
            return False
        try:
            orientation = img.getexif().get(_EXIF_ORIENTATION)
        except (MemoryError, Image.DecompressionBombError):
            raise
        except Exception:  # noqa: BLE001 - EXIF 壞掉：oriented_size 與 exif_transpose 也當沒有方向
            return False
    return orientation in _ROTATED_ORIENTATIONS


def _upright(data: bytes, fmt: str, lossless: bool) -> bytes:
    with Image.open(io.BytesIO(data), formats=(fmt,)) as img:
        _check_pixels(img)
        icc_profile = img.info.get("icc_profile")
        upright = ImageOps.exif_transpose(img)
    # 只明確帶 ICC profile：轉正後的 info 裡仍有含 GPS 的 exif／xmp，不能讓它跟著存。
    options: dict = {"icc_profile": icc_profile} if icc_profile else {}
    if fmt == "JPEG":
        options["quality"] = 95
    elif fmt == "WEBP":
        options.update({"lossless": True} if lossless else {"quality": 95})
    buf = io.BytesIO()
    upright.save(buf, fmt, **options)
    return buf.getvalue()


def strip_image_bytes(data: bytes, content_type: str) -> tuple[bytes, tuple[int, int]]:
    """回傳 (去掉拍攝資訊的圖檔, 實際像素寬高)。沒有任何拍攝資訊的檔案原樣回傳。"""
    fmt = _FORMAT_BY_CONTENT_TYPE.get(content_type)
    if fmt is None:
        raise MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", f"不支援的圖片格式：{content_type}")
    strip = _STRIPPERS[fmt]
    try:
        clean, has_exif, lossless = strip(data)
        if has_exif and _needs_rotation(data, fmt):
            clean = strip(_upright(data, fmt, lossless))[0]
        # 確認處理後仍是同一種格式、讀得出尺寸；這也是素材要記的寬高（EXIF 已經
        # 拿掉，不會再有「依方向轉正」的差別）。
        with Image.open(io.BytesIO(clean), formats=(fmt,)) as img:
            size = img.size
    except MediaValidationError:
        raise
    except (Image.DecompressionBombError, MemoryError) as exc:
        raise MediaValidationError("MEDIA_TOO_LARGE", "圖片像素過多，已拒絕解碼") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise _invalid() from exc
    return clean, size


# ---------------------------------------------------------------------------
# 影片
# ---------------------------------------------------------------------------


def strip_video_file(src: Path, dst: Path) -> None:
    """ffmpeg 不轉碼重新封裝：只帶影像（不含封面圖）與聲音軌，不帶 metadata 與章節，
    moov 移到檔頭（官網邊下載邊播）。"""
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                *FFMPEG_INPUT_GUARD,
                "-i",
                str(src),
                "-map",
                "0:V",
                "-map",
                "0:a?",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
                "-y",
                str(dst),
            ],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=VIDEO_STRIP_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise _invalid("影片處理逾時") from exc
    except OSError as exc:
        raise _invalid("伺服器無法執行 ffmpeg，請稍後再試") from exc
    if result.returncode != 0 or not dst.is_file() or dst.stat().st_size == 0:
        raise _invalid("影片無法重新封裝（可能已損毀，或不是標準 MP4），請重新匯出成 MP4 後再上傳")


def strip_file(src: Path, dst: Path, content_type: str) -> tuple[int, int] | None:
    """把 src 去掉拍攝資訊後寫到 dst（src 不動）。圖片回傳實際寬高；影片回 None，
    寬高與時長另由 ffprobe 讀。"""
    if content_type == "video/mp4":
        strip_video_file(src, dst)
        return None
    clean, size = strip_image_bytes(src.read_bytes(), content_type)
    dst.write_bytes(clean)
    return size
