"""素材原檔去除拍攝資訊：不重新編碼，只拿掉可能洩漏隱私的區塊。

官網的 <img src>、srcset 最大尺寸、放大檢視、og:image 與影片本體都直接指向
原檔，匿名訪客下載得到。手機照片的 EXIF 帶 GPS 座標、拍攝時間、機型與序號，
XMP／IPTC 也可能帶地點與作者，影片的 udta／meta 有拍攝地點與時間；幼兒照片
配上拍攝地點不能公開，而原檔帶一年 immutable 快取，事後修正收不回來。所以
原檔在存進儲存體之前先清理（上傳、替換、匯入官網內建素材都一樣）。

只保留拍攝方向（EXIF Orientation）：瀏覽器依它轉正原檔，素材記錄的寬高與
衍生檔轉正（processing.oriented_size／make_webp）也以它為準，拿掉會讓照片
躺著。像素資料逐位元組照抄，畫質不變。各格式只留白名單內的區塊：

- JPEG：APP0（JFIF）、APP2 的 ICC profile、APP14（Adobe，CMYK 色彩轉換要用）
  與影像本身的標記段；APP1（EXIF 只重建一段只有方向的最小 EXIF、XMP 拿掉）、
  APP13（IPTC／Photoshop）、COM、其他 APPn（MPF 多圖索引、C2PA…）與 EOI
  之後的附加資料（多圖、動態照片）都拿掉。多次掃描（progressive）之間的
  區段一樣過濾，熵編碼資料原封不動。
- PNG：critical chunk 與色彩、透明、動畫相關的 ancillary chunk（iCCP、sRGB…）；
  eXIf 只留方向，tEXt、zTXt、iTXt、tIME 與不認得的私有 chunk 都拿掉。
  iDOT（Apple 平行解碼索引）記的是位移，拿掉前面的 chunk 之後會錯，也不留。
- WebP：EXIF 只留方向，XMP 與不認得的 chunk 拿掉，VP8X 旗標跟著修正。
- MP4：ffmpeg 只複製影像與聲音軌（不轉碼）、不帶任何 metadata 與章節。旋轉記在
  顯示矩陣（tkhd），不是 metadata，照樣保留；資料軌（例如運動相機的 GPS 軌跡）
  與封面圖不帶。

同一個檔案處理兩次結果相同，已經乾淨的檔案原樣不動，既有素材可以重跑
`python -m app.cli strip-media-metadata`。
"""

from __future__ import annotations

import io
import struct
import subprocess
import zlib
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app.media.processing import CONTENT_TYPE_BY_FORMAT, FFMPEG_INPUT_GUARD
from app.media.validation import MediaValidationError

_FORMAT_BY_CONTENT_TYPE = {content_type: fmt for fmt, content_type in CONTENT_TYPE_BY_FORMAT.items()}
STRIPPABLE_CONTENT_TYPES = frozenset({*_FORMAT_BY_CONTENT_TYPE, "video/mp4"})

_EXIF_ORIENTATION = 0x0112
_EXIF_HEADER = b"Exif\x00\x00"
# 跟 processing.oriented_size 同一套：5–8 轉 90／270 度，轉正後寬高對調。
_SWAPPED_ORIENTATIONS = {5, 6, 7, 8}

# 影片只複製不轉碼，150 MB 也是幾秒的事；逾時多半是檔案有問題。
VIDEO_STRIP_TIMEOUT_SECONDS = 120


class MetadataStripError(Exception):
    """檔案結構不是預期的格式，無法安全清理。"""


def _orientation(exif_tiff: bytes | None) -> int | None:
    """原本的 EXIF（TIFF 結構，不含 Exif\\0\\0 前綴）裡要轉的拍攝方向（2–8）。
    沒有方向、方向為 1（不用轉）或 EXIF 壞掉都回 None。"""
    if not exif_tiff:
        return None
    try:
        exif = Image.Exif()
        exif.load(_EXIF_HEADER + exif_tiff)
        orientation = exif.get(_EXIF_ORIENTATION)
    except Exception:  # noqa: BLE001 - EXIF 壞掉就當沒有方向資訊（exif_transpose 也不會轉）
        return None
    if not isinstance(orientation, int) or orientation in (0, 1) or orientation > 8:
        return None
    return orientation


def _minimal_exif(orientation: int) -> bytes:
    """只有拍攝方向的最小 EXIF（TIFF 結構，不含 Exif\\0\\0 前綴）。"""
    minimal = Image.Exif()
    minimal[_EXIF_ORIENTATION] = orientation
    data = minimal.tobytes()
    return data[len(_EXIF_HEADER):] if data.startswith(_EXIF_HEADER) else data


# --- JPEG -------------------------------------------------------------------

_JPEG_APP0 = 0xE0
_JPEG_APP1 = 0xE1
_JPEG_APP2 = 0xE2
_JPEG_APP14 = 0xEE
_JPEG_COM = 0xFE
_JPEG_SOI = 0xD8
_JPEG_SOS = 0xDA
_JPEG_EOI = 0xD9
_JPEG_STANDALONE = {0x01, *range(0xD0, 0xD8)}  # TEM、RST0–7：沒有長度欄
_ICC_PROFILE = b"ICC_PROFILE\x00"


def _keep_jpeg_segment(marker: int, payload: bytes) -> bool:
    if marker == _JPEG_COM:
        return False
    if 0xE0 <= marker <= 0xEF:
        return marker in (_JPEG_APP0, _JPEG_APP14) or (marker == _JPEG_APP2 and payload.startswith(_ICC_PROFILE))
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


def _jpeg_orientation_segment(orientation: int | None) -> bytes:
    if orientation is None:
        return b""
    payload = _EXIF_HEADER + _minimal_exif(orientation)
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def _strip_jpeg(data: bytes) -> tuple[bytes, int | None]:
    if data[:2] != b"\xff\xd8":
        raise MetadataStripError("not a JPEG")
    out = bytearray(b"\xff\xd8")
    orientation: int | None = None
    seen_exif = False
    # 只有方向的 EXIF 放回原本的位置附近：SOI 之後，若第一段是 APP0（JFIF 規定
    # 要在最前面）就放在它後面。
    exif_at = len(out)
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
        if marker == _JPEG_EOI:  # EOI 之後的附加資料一律不留
            out += b"\xff\xd9"
            break
        if marker in _JPEG_STANDALONE:
            out += bytes((0xFF, marker))
            continue
        if marker == _JPEG_SOI or pos + 2 > n:
            raise MetadataStripError("bad JPEG marker")
        end = pos + struct.unpack(">H", data[pos:pos + 2])[0]
        if end < pos + 2 or end > n:
            raise MetadataStripError("bad JPEG segment length")
        payload = data[pos + 2:end]
        segment = bytes((0xFF, marker)) + data[pos:end]
        pos = end
        if marker == _JPEG_APP1 and payload.startswith(_EXIF_HEADER):
            # 跟 Pillow 一樣只看第一段 EXIF 的方向（sniff_and_validate 記的寬高也是）。
            if not seen_exif:
                seen_exif = True
                orientation = _orientation(payload[len(_EXIF_HEADER):])
            continue
        if _keep_jpeg_segment(marker, payload):
            if marker == _JPEG_APP0 and len(out) == 2:
                exif_at = 2 + len(segment)
            out += segment
        if marker == _JPEG_SOS:
            scan_end = _jpeg_scan_end(data, pos)
            out += data[pos:scan_end]
            pos = scan_end
    return bytes(out[:exif_at]) + _jpeg_orientation_segment(orientation) + bytes(out[exif_at:]), orientation


# --- PNG --------------------------------------------------------------------

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# 大寫開頭的 critical chunk（IHDR、PLTE、IDAT、IEND）一律保留；ancillary 只留這些。
_PNG_KEEP_ANCILLARY = {
    b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"iCCP", b"sBIT", b"pHYs", b"bKGD", b"hIST", b"sPLT",
    b"acTL", b"fcTL", b"fdAT", b"cICP", b"mDCV", b"cLLI",
}


def _png_chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def _strip_png(data: bytes) -> tuple[bytes, int | None]:
    if not data.startswith(_PNG_SIGNATURE):
        raise MetadataStripError("not a PNG")
    out = bytearray(_PNG_SIGNATURE)
    orientation: int | None = None
    seen_exif = False
    pos, n = len(_PNG_SIGNATURE), len(data)
    while pos < n:
        if pos + 12 > n:
            raise MetadataStripError("truncated PNG")
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > n:
            raise MetadataStripError("truncated PNG chunk")
        body = data[pos + 8:pos + 8 + length]
        chunk = data[pos:end]
        pos = end
        if kind == b"eXIf":
            if not seen_exif:
                seen_exif = True
                orientation = _orientation(body)
                if orientation is not None:
                    out += _png_chunk(b"eXIf", _minimal_exif(orientation))
            continue
        if not kind[0] & 0x20 or kind in _PNG_KEEP_ANCILLARY:
            out += chunk
        if kind == b"IEND":  # 之後的附加資料不留
            break
    return bytes(out), orientation


# --- WebP -------------------------------------------------------------------

_WEBP_KEEP = {b"VP8X", b"ICCP", b"ANIM", b"ANMF", b"ALPH", b"VP8 ", b"VP8L"}
_VP8X_EXIF_FLAG = 0x08
_VP8X_XMP_FLAG = 0x04


def _strip_webp(data: bytes) -> tuple[bytes, int | None]:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise MetadataStripError("not a WebP")
    chunks: list[tuple[bytes, bytes]] = []
    orientation: int | None = None
    seen_exif = False
    pos = 12
    riff_end = min(len(data), 8 + struct.unpack("<I", data[4:8])[0])
    while pos + 8 <= riff_end:
        kind = data[pos:pos + 4]
        length = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + length]
        if len(body) != length:
            raise MetadataStripError("truncated WebP chunk")
        pos += 8 + length + (length & 1)
        if kind == b"EXIF":
            if not seen_exif:
                seen_exif = True
                tiff = body[len(_EXIF_HEADER):] if body.startswith(_EXIF_HEADER) else body
                orientation = _orientation(tiff)
                if orientation is not None:
                    chunks.append((kind, _minimal_exif(orientation)))
            continue
        if kind in _WEBP_KEEP:
            chunks.append((kind, body))
    has_exif = any(kind == b"EXIF" for kind, _ in chunks)
    out = bytearray()
    for kind, body in chunks:
        if kind == b"VP8X" and body:
            flags = body[0] & ~_VP8X_XMP_FLAG
            flags = flags | _VP8X_EXIF_FLAG if has_exif else flags & ~_VP8X_EXIF_FLAG
            body = bytes((flags & 0xFF,)) + body[1:]
        out += kind + struct.pack("<I", len(body)) + body
        if len(body) & 1:
            out += b"\x00"
    return b"RIFF" + struct.pack("<I", len(out) + 4) + b"WEBP" + bytes(out), orientation


_STRIPPERS = {
    "image/jpeg": _strip_jpeg,
    "image/png": _strip_png,
    "image/webp": _strip_webp,
}


def _strip_image_file(src: Path, dst: Path, content_type: str) -> tuple[int, int]:
    fmt = _FORMAT_BY_CONTENT_TYPE.get(content_type)
    if fmt is None:
        raise MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", f"不支援的圖片格式：{content_type}")
    try:
        clean, orientation = _STRIPPERS[content_type](src.read_bytes())
        # 確認處理後仍是同一種格式、讀得出尺寸（只讀檔頭，不解碼）。素材記的是
        # 轉正後的寬高，方向以實際留下來的那一份為準：XMP 或 PNG 文字欄位裡的
        # 方向已經拿掉，瀏覽器與衍生檔都不會再照它轉。
        with Image.open(io.BytesIO(clean), formats=(fmt,)) as img:
            width, height = img.size
    except MetadataStripError as exc:
        raise MediaValidationError("MEDIA_INVALID", "圖片結構無法辨識，請重新匯出後再上傳") from exc
    except (Image.DecompressionBombError, MemoryError) as exc:
        raise MediaValidationError("MEDIA_TOO_LARGE", "圖片像素過多，已拒絕解碼") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise MediaValidationError("MEDIA_INVALID", "圖片結構無法辨識，請重新匯出後再上傳") from exc
    dst.write_bytes(clean)
    return (height, width) if orientation in _SWAPPED_ORIENTATIONS else (width, height)


# --- 影片 -------------------------------------------------------------------


def _video_invalid(detail: str) -> MediaValidationError:
    return MediaValidationError("MEDIA_INVALID", f"無法去除拍攝資訊：{detail}")


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
        raise _video_invalid("影片處理逾時") from exc
    except OSError as exc:
        raise _video_invalid("伺服器無法執行 ffmpeg，請稍後再試") from exc
    if result.returncode != 0 or not dst.is_file() or dst.stat().st_size == 0:
        raise _video_invalid("影片無法重新封裝（可能已損毀，或不是標準 MP4），請重新匯出成 MP4 後再上傳")


def strip_file(src: Path, dst: Path, content_type: str) -> tuple[int, int] | None:
    """把 src 去掉拍攝資訊後寫到 dst（src 不動），失敗拋 MediaValidationError。
    圖片回傳轉正後的寬高；影片回 None，寬高與時長另由 ffprobe 讀。

    上傳、替換、匯入與 strip-media-metadata 都走這裡：不改動來源檔（匯入官網
    內建素材時來源是 repo 裡的檔案）。圖片上限 15 MB 左右，整份讀進記憶體處理。"""
    if content_type == "video/mp4":
        strip_video_file(src, dst)
        return None
    return _strip_image_file(src, dst, content_type)
