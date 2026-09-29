"""上傳圖片的中繼資料清理：不重新編碼，只拿掉可能洩漏隱私的區塊。

官網的 <img src>、srcset 最大尺寸與 og:image 都直接指向原檔，匿名訪客下載
得到。手機照片的 EXIF 帶 GPS 座標、拍攝時間、機型與序號，XMP／IPTC 也可能
帶地點與作者；幼兒照片配上拍攝地點不能公開，而原檔帶一年 immutable 快取，
事後修正收不回來。所以原檔在存進儲存體之前先清理。

只保留拍攝方向（EXIF Orientation）：瀏覽器依它轉正原檔，素材記錄的寬高與
衍生檔轉正（processing.oriented_size／make_webp）也以它為準，拿掉會讓照片
躺著。色彩描述檔（JPEG APP2 ICC、PNG iCCP、WebP ICCP）與 Adobe APP14 會影響
顏色，一律保留。像素資料逐位元組照抄，畫質不變。"""

from __future__ import annotations

import os
import struct
import zlib
from pathlib import Path

from PIL import Image

_EXIF_ORIENTATION = 0x0112
_EXIF_HEADER = b"Exif\x00\x00"


class MetadataStripError(Exception):
    """檔案結構不是預期的格式，無法安全清理。"""


def _orientation_exif(exif_tiff: bytes | None) -> bytes | None:
    """從原本的 EXIF（TIFF 結構，不含 Exif\\0\\0 前綴）只取出拍攝方向，
    重建一段最小的 EXIF。沒有方向或方向為 1（不用轉）就回 None。"""
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
    minimal = Image.Exif()
    minimal[_EXIF_ORIENTATION] = orientation
    data = minimal.tobytes()
    return data[len(_EXIF_HEADER):] if data.startswith(_EXIF_HEADER) else data


# --- JPEG -------------------------------------------------------------------

# 會帶隱私的區段：APP1（EXIF／XMP）、APP13（Photoshop／IPTC）、COM（註解）。
# 其他 APPn（APP0 JFIF、APP2 ICC、APP14 Adobe 色彩轉換）照留。
_JPEG_APP1 = 0xE1
_JPEG_APP13 = 0xED
_JPEG_COM = 0xFE
_JPEG_SOS = 0xDA
_JPEG_EOI = 0xD9
_JPEG_STANDALONE = {0x01, *range(0xD0, 0xD8)}  # TEM、RST0–7：沒有長度欄


def _strip_jpeg(data: bytes) -> bytes:
    if data[:2] != b"\xff\xd8":
        raise MetadataStripError("not a JPEG")
    out = bytearray(b"\xff\xd8")
    orientation: bytes | None = None
    # EXIF 放回原本的位置附近：SOI 之後，若第一段是 APP0（JFIF 規定要在最前面）
    # 就放在它後面。
    exif_at = len(out)
    pos = 2
    while True:
        if pos >= len(data) or data[pos] != 0xFF:
            raise MetadataStripError("bad JPEG marker")
        while pos < len(data) and data[pos] == 0xFF:  # 標記前可以有填充的 0xFF
            pos += 1
        if pos >= len(data):
            raise MetadataStripError("truncated JPEG")
        marker = data[pos]
        pos += 1
        if marker in _JPEG_STANDALONE:
            out += bytes((0xFF, marker))
            continue
        if marker == _JPEG_EOI:
            out += b"\xff\xd9"
            break
        if pos + 2 > len(data):
            raise MetadataStripError("truncated JPEG")
        length = struct.unpack(">H", data[pos:pos + 2])[0]
        if length < 2 or pos + length > len(data):
            raise MetadataStripError("bad JPEG segment length")
        body = data[pos + 2:pos + length]
        segment = data[pos - 2:pos + length]
        pos += length
        if marker == _JPEG_SOS:
            # 影像資料從這裡開始，之後（含其餘掃描與 EOI、尾端資料）原樣照抄。
            out += segment
            out += data[pos:]
            break
        if marker == _JPEG_APP1:
            if body.startswith(_EXIF_HEADER) and orientation is None:
                orientation = _orientation_exif(body[len(_EXIF_HEADER):])
            continue
        if marker in (_JPEG_APP13, _JPEG_COM):
            continue
        if marker == 0xE0 and len(out) == 2:
            exif_at = 2 + len(segment)
        out += segment
    return bytes(out[:exif_at]) + _jpeg_orientation_segment(orientation) + bytes(out[exif_at:])


def _jpeg_orientation_segment(orientation_tiff: bytes | None) -> bytes:
    if orientation_tiff is None:
        return b""
    payload = _EXIF_HEADER + orientation_tiff
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


# --- PNG --------------------------------------------------------------------

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# 文字區塊（XMP 放在 iTXt）、時間戳記；eXIf 另外處理成只留方向。
_PNG_DROP = {b"tEXt", b"zTXt", b"iTXt", b"tIME"}


def _png_chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def _strip_png(data: bytes) -> bytes:
    if not data.startswith(_PNG_SIGNATURE):
        raise MetadataStripError("not a PNG")
    out = bytearray(_PNG_SIGNATURE)
    pos = len(_PNG_SIGNATURE)
    while pos < len(data):
        if pos + 8 > len(data):
            raise MetadataStripError("truncated PNG")
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > len(data):
            raise MetadataStripError("truncated PNG chunk")
        chunk = data[pos:end]
        body = data[pos + 8:pos + 8 + length]
        pos = end
        if kind == b"eXIf":
            orientation = _orientation_exif(body)
            if orientation is not None:
                out += _png_chunk(b"eXIf", orientation)
            continue
        if kind in _PNG_DROP:
            continue
        out += chunk
        if kind == b"IEND":
            break
    return bytes(out)


# --- WebP -------------------------------------------------------------------

_VP8X_EXIF_FLAG = 0x08
_VP8X_XMP_FLAG = 0x04


def _strip_webp(data: bytes) -> bytes:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise MetadataStripError("not a WebP")
    chunks: list[tuple[bytes, bytes]] = []
    pos = 12
    riff_end = min(len(data), 8 + struct.unpack("<I", data[4:8])[0])
    while pos + 8 <= riff_end:
        kind = data[pos:pos + 4]
        length = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + length]
        if len(body) != length:
            raise MetadataStripError("truncated WebP chunk")
        pos += 8 + length + (length & 1)
        if kind == b"XMP ":
            continue
        if kind == b"EXIF":
            tiff = body[len(_EXIF_HEADER):] if body.startswith(_EXIF_HEADER) else body
            orientation = _orientation_exif(tiff)
            if orientation is not None:
                chunks.append((kind, orientation))
            continue
        chunks.append((kind, body))
    has_exif = any(kind == b"EXIF" for kind, _ in chunks)
    out = bytearray()
    for kind, body in chunks:
        if kind == b"VP8X" and body:
            flags = body[0] & ~_VP8X_XMP_FLAG
            flags = flags | _VP8X_EXIF_FLAG if has_exif else flags & ~_VP8X_EXIF_FLAG
            body = bytes((flags,)) + body[1:]
        out += kind + struct.pack("<I", len(body)) + body
        if len(body) & 1:
            out += b"\x00"
    return b"RIFF" + struct.pack("<I", len(out) + 4) + b"WEBP" + bytes(out)


_STRIPPERS = {
    "image/jpeg": _strip_jpeg,
    "image/png": _strip_png,
    "image/webp": _strip_webp,
}


def strip_private_metadata(path: Path, content_type: str) -> None:
    """就地清理 `path`（已通過 sniff_and_validate 的圖片暫存檔）。先寫到旁邊的
    暫存檔再以 os.replace 換上，失敗時原檔不動並拋 MetadataStripError。
    上傳圖片上限 15 MB 左右，整份讀進記憶體處理即可。"""
    strip = _STRIPPERS.get(content_type)
    if strip is None:
        return
    cleaned = strip(path.read_bytes())
    tmp = path.with_name(path.name + ".clean")
    try:
        tmp.write_bytes(cleaned)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
