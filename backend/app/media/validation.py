from __future__ import annotations

from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app.media.models import MediaKind
from app.media.processing import CONTENT_TYPE_BY_FORMAT, IMAGE_FORMATS, MAX_IMAGE_PIXELS, oriented_size

# 單檔大小上限是部署設定（Settings.media_max_image_mb／media_max_video_mb），
# 由路由在複製上傳檔之前比對（media/routes._receive_upload），這裡只看內容。

# 像素上限（MAX_IMAGE_PIXELS）與 Pillow 全域上限的說明見 processing；這裡在
# 真正 decode 之前就用 header 裡的尺寸擋掉。測試會暫時改這個模組的值。
__all__ = ["MAX_IMAGE_PIXELS", "MediaValidationError", "sniff_and_validate"]

# 規格 L137 只收 JPEG、PNG、WebP（影片 MP4）。2026-09-25 以前收過的 GIF 素材
# 照常可用，只是不再接受新的 GIF。
_IMAGE_CONTENT_TYPES = CONTENT_TYPE_BY_FORMAT

# 白名單外的格式 Pillow 連開都不開（見 processing.IMAGE_FORMATS），只有 GIF
# 以前收過，看檔頭簽章就回明確的「不支援的格式」，不必解碼。
_GIF_SIGNATURES = (b"GIF87a", b"GIF89a")


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


def _unsupported_or_invalid(path: Path) -> MediaValidationError:
    with path.open("rb") as fh:
        head = fh.read(6)
    if head in _GIF_SIGNATURES:
        return MediaValidationError("MEDIA_UNSUPPORTED_FORMAT", "不支援的圖片格式：GIF（只接受 JPG、PNG、WebP）")
    return MediaValidationError("MEDIA_INVALID", "檔案內容不是合法的圖片（可能是偽裝副檔名）")


def sniff_and_validate(path: Path, declared_kind: MediaKind) -> tuple[str, int | None, int | None]:
    """回傳 (真實 content_type, width, height)。只信任實際解碼結果，
    完全不信任使用者宣稱的副檔名或 Content-Type header——這是擋偽裝副檔名
    攻擊（例如把可執行檔改名成 .jpg）的關鍵防線。檔案已經在暫存檔裡，
    影片只讀檔頭，不整份讀進記憶體。

    Pillow 只以 JPEG／PNG／WebP 解讀內容，其他格式在 open 階段就被當成
    讀不懂的檔案，不會進到那些格式的解碼器。"""
    if declared_kind == MediaKind.IMAGE:
        try:
            with Image.open(path, formats=IMAGE_FORMATS) as img:
                img.verify()
            with Image.open(path, formats=IMAGE_FORMATS) as img:
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
                # 素材記轉正後的寬高：衍生檔依 EXIF 轉正，官網 srcset 裡原檔的
                # 寬度描述與 <img width/height> 也要跟瀏覽器實際顯示的方向一致。
                width, height = oriented_size(img)
        except MediaValidationError:
            raise
        except (Image.DecompressionBombError, MemoryError) as exc:
            raise MediaValidationError("MEDIA_TOO_LARGE", "圖片像素過多，已拒絕解碼") from exc
        except UnidentifiedImageError as exc:
            raise _unsupported_or_invalid(path) from exc
        except (OSError, ValueError) as exc:
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
