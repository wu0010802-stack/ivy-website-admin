from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

from app.media.models import MediaKind

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024

_IMAGE_CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
}


class MediaValidationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _looks_like_mp4(data: bytes) -> bool:
    # ISO base media file format：前 4 bytes 是 box size，接著是 'ftyp'。
    return len(data) > 12 and data[4:8] == b"ftyp"


def sniff_and_validate(data: bytes, declared_kind: MediaKind) -> tuple[str, int | None, int | None]:
    """回傳 (真實 content_type, width, height)。只信任實際解碼結果，
    完全不信任使用者宣稱的副檔名或 Content-Type header——這是擋偽裝副檔名
    攻擊（例如把可執行檔改名成 .jpg）的關鍵防線。"""
    if declared_kind == MediaKind.IMAGE:
        if len(data) > MAX_IMAGE_BYTES:
            raise MediaValidationError("MEDIA_TOO_LARGE", "圖片超過大小限制")
        try:
            with Image.open(io.BytesIO(data)) as img:
                img.verify()
            with Image.open(io.BytesIO(data)) as img:
                img.load()
                width, height = img.size
                fmt = img.format
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise MediaValidationError(
                "MEDIA_INVALID", "檔案內容不是合法的圖片（可能是偽裝副檔名）"
            ) from exc
        content_type = _IMAGE_CONTENT_TYPES.get(fmt or "")
        if content_type is None:
            raise MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", f"不支援的圖片格式：{fmt}")
        return content_type, width, height

    if declared_kind == MediaKind.VIDEO:
        if len(data) > MAX_VIDEO_BYTES:
            raise MediaValidationError("MEDIA_TOO_LARGE", "影片超過大小限制")
        if not _looks_like_mp4(data):
            raise MediaValidationError(
                "MEDIA_INVALID", "檔案內容不是合法的 MP4 影片（可能是偽裝副檔名）"
            )
        return "video/mp4", None, None

    raise MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", "不支援的素材種類")
