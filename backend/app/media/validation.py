from __future__ import annotations

from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app.media.models import MediaKind

# 單檔大小上限是部署設定（Settings.media_max_image_mb／media_max_video_mb），
# 在收檔時就擋（media/routes._receive_upload），這裡只看內容。

# 壓縮炸彈：一張 10KB 的 PNG 可以宣告成 40000x40000，解碼後要吃掉數 GB
# 記憶體。Pillow 自己的 MAX_IMAGE_PIXELS 預設只會發 warning（超過兩倍才
# 拋例外，而且那個例外原本沒人接會變成 500），所以這裡自己設一個明確
# 上限，並且在真正 decode 之前就用 header 裡的尺寸擋掉。
MAX_IMAGE_PIXELS = 50_000_000  # 約 8660x5770，遠高於官網任何實際用圖
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# 規格 L137 只收 JPEG、PNG、WebP（影片 MP4）。2026-09-25 以前收過的 GIF 素材
# 照常可用，只是不再接受新的 GIF。
_IMAGE_CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}


class MediaValidationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _looks_like_mp4(path: Path) -> bool:
    # ISO base media file format：前 4 bytes 是 box size，接著是 'ftyp'。
    with path.open("rb") as fh:
        head = fh.read(13)
    return len(head) > 12 and head[4:8] == b"ftyp"


def sniff_and_validate(path: Path, declared_kind: MediaKind) -> tuple[str, int | None, int | None]:
    """回傳 (真實 content_type, width, height)。只信任實際解碼結果，
    完全不信任使用者宣稱的副檔名或 Content-Type header——這是擋偽裝副檔名
    攻擊（例如把可執行檔改名成 .jpg）的關鍵防線。檔案已經在暫存檔裡，
    影片只讀檔頭，不整份讀進記憶體。"""
    if declared_kind == MediaKind.IMAGE:
        try:
            with Image.open(path) as img:
                img.verify()
            with Image.open(path) as img:
                # 先看 header 宣告的尺寸再決定要不要真的 decode——img.size
                # 在 open() 當下就有值，不需要先把像素展開到記憶體。
                width, height = img.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise MediaValidationError(
                        "MEDIA_TOO_LARGE",
                        f"圖片像素過多（{width}x{height}），上限為 {MAX_IMAGE_PIXELS:,} 像素",
                    )
                img.load()
                fmt = img.format
        except MediaValidationError:
            raise
        except Image.DecompressionBombError as exc:
            raise MediaValidationError("MEDIA_TOO_LARGE", "圖片像素過多，已拒絕解碼") from exc
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise MediaValidationError(
                "MEDIA_INVALID", "檔案內容不是合法的圖片（可能是偽裝副檔名）"
            ) from exc
        content_type = _IMAGE_CONTENT_TYPES.get(fmt or "")
        if content_type is None:
            raise MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", f"不支援的圖片格式：{fmt}（只接受 JPG、PNG、WebP）")
        return content_type, width, height

    if declared_kind == MediaKind.VIDEO:
        if not _looks_like_mp4(path):
            raise MediaValidationError(
                "MEDIA_INVALID", "檔案內容不是合法的 MP4 影片（可能是偽裝副檔名）"
            )
        # 寬高與時長由 processing.probe_video 另外取得（需要 ffprobe）。
        return "video/mp4", None, None

    raise MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", "不支援的素材種類")
