from __future__ import annotations

import io
import json
import logging
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

from PIL import Image, ImageOps

from app.common.concurrency import ThreadSlots

# 衍生檔（規格 L139：原檔保留，衍生縮圖另存）。縮圖給後台列表、選圖器與官網
# 小版位；大圖給官網手機與一般寬度的版位，原檔只在高解析螢幕的滿版才會被選到。
THUMBNAIL_SIZE = (480, 480)
LARGE_SIDE = 1600

# Pillow 格式與 content_type 的唯一對照；上傳驗證（validation）、去除拍攝資訊
# （metadata）、重新產生衍生檔（regenerate）都從這裡衍生，新增或拿掉格式只改這裡
# （metadata 另要為新格式寫去除資訊的實作）。規格 L137 只收 JPEG、PNG、WebP。
CONTENT_TYPE_BY_FORMAT = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
# 2026-09-25 以前收過的 GIF：不再接受新上傳，但既有素材仍要能重新產生衍生檔。
LEGACY_CONTENT_TYPE_BY_FORMAT = {"GIF": "image/gif"}

# 只解這三種格式。Image.open 不帶 formats 時，Pillow 會依內容試遍
# 所有內建解碼器（FITS、PSD、JPEG 2000…），格式白名單就等於在解碼之後才生效；
# 這些少用的解碼器歷來是記憶體破壞與解壓縮炸彈的來源，一律不讓它們碰上傳檔。
IMAGE_FORMATS = tuple(CONTENT_TYPE_BY_FORMAT)

# 壓縮炸彈：一張 10KB 的 PNG 可以宣告成 40000x40000，解碼後要吃掉數 GB
# 記憶體。Pillow 自己的 MAX_IMAGE_PIXELS 預設只會發 warning（超過兩倍才
# 拋例外），所以這裡設一個明確上限，上傳驗證（validation）與影片 poster
# 都在真正 decode 之前先用 header 的尺寸擋掉。
MAX_IMAGE_PIXELS = 50_000_000  # 約 8660x5770，遠高於官網任何實際用圖
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# 解碼、去除拍攝資訊、產生衍生檔、ffprobe／ffmpeg 同時最多跑幾件。一張大圖
# 解碼加兩張衍生檔就要數百 MB；API 只有一個程序，後台多人（或被盜的帳號）
# 同時上傳時沒有上限，會讓整個 API OOM 被重啟，公開官網跟著中斷。
MEDIA_JOB_CONCURRENCY = 2

# ffprobe／ffmpeg 讀上傳檔時一律指定 mov demuxer（涵蓋 mp4／m4v／mov）、只准
# 讀本機檔案：不讓內容偵測挑到播放清單類 demuxer，也就不會去讀別的檔案或連網。
FFMPEG_INPUT_GUARD = ("-protocol_whitelist", "file", "-f", "mov")

logger = logging.getLogger("app.media")

# 本機 ffmpeg 8.x 沒有編譯 libwebp，不能假設 `ffmpeg -c:v libwebp` 可用；
# 一律先讓 ffmpeg 抽 PNG 影格，再交給 Pillow 轉成 WebP。
# 見 CLAUDE.md「本機媒體工具限制與繞法」。

_T = TypeVar("_T")
_job_slots = ThreadSlots(MEDIA_JOB_CONCURRENCY)


async def run_media_job(func: Callable[..., _T], /, *args) -> _T:
    """在 thread 裡跑一件吃 CPU／記憶體的素材處理，同時最多 MEDIA_JOB_CONCURRENCY
    件，其餘在 event loop 上排隊（排隊時不佔 thread；語意見 app/common/concurrency）。"""
    return await _job_slots.run(func, *args)


class ProcessingError(Exception):
    pass


@dataclass(frozen=True)
class Rendition:
    """一個 WebP 衍生檔與它的實際尺寸（官網 srcset 的寬度描述用）。"""

    data: bytes
    width: int
    height: int


# EXIF Orientation 5–8 是轉 90／270 度（含鏡像），轉正後寬高對調。
_SWAPPED_ORIENTATIONS = {5, 6, 7, 8}
_EXIF_ORIENTATION = 0x0112


def oriented_size(img: Image.Image) -> tuple[int, int]:
    """依 EXIF 拍攝方向轉正之後的寬高（跟 ImageOps.exif_transpose 同一套判斷）。
    瀏覽器顯示原檔時會套用拍攝方向，素材記的寬高、衍生檔與官網 srcset 的
    寬度描述都要用轉正後的尺寸，手機直拍的照片長寬才不會對調。"""
    width, height = img.size
    try:
        orientation = img.getexif().get(_EXIF_ORIENTATION)
    except Exception:  # noqa: BLE001 - EXIF 壞掉就當沒有方向資訊（exif_transpose 也不會轉）
        return width, height
    return (height, width) if orientation in _SWAPPED_ORIENTATIONS else (width, height)


def make_webp(
    source: bytes | Path, max_side: int, quality: int = 80, *, formats: tuple[str, ...] = IMAGE_FORMATS
) -> Rendition:
    """縮到長邊不超過 max_side（小圖不放大）。先依 EXIF 轉正：瀏覽器顯示原檔
    JPEG 時會套用拍攝方向，衍生檔若沒轉正，同一張照片會在官網上躺下來。

    去背 PNG／WebP 保留透明（存成含 alpha 的 WebP）：官網的線稿用 multiply
    疊色、消息封面等版位也可能放去背圖，丟掉 alpha 的話透明處會變成黑底，
    而且只有選到縮圖／大圖的螢幕寬度才會黑，同一張圖依寬度顯示不同。

    formats 限定能開的格式（預設是上傳白名單）；重新產生舊 GIF 素材的衍生檔時
    由呼叫端依素材的 content_type 指定。"""
    with Image.open(io.BytesIO(source) if isinstance(source, bytes) else source, formats=formats) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGBA" if img.has_transparency_data else "RGB")
        img.thumbnail((max_side, max_side))
        # 宣告有 alpha、實際上整張不透明（常見於匯出成 RGBA 的照片）就存成
        # 一般 WebP，檔案比較小。
        if img.mode == "RGBA" and img.getchannel("A").getextrema()[0] == 255:
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=quality)
        return Rendition(buf.getvalue(), img.width, img.height)


def make_image_thumbnail_webp(source: bytes | Path) -> bytes:
    return make_webp(source, THUMBNAIL_SIZE[0]).data


def needs_large_rendition(width: int | None, height: int | None) -> bool:
    """原圖長邊超過 LARGE_SIDE 才另存大圖；更小的原圖本身就夠小，官網直接用原檔。"""
    return max(width or 0, height or 0) > LARGE_SIDE


@dataclass(frozen=True)
class VideoProbe:
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None


def _positive_int(value: object) -> int | None:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def probe_video(video_path: Path) -> VideoProbe:
    """用 ffprobe 讀影片的寬高與時長。ffprobe 不存在、逾時或讀不懂都回全
    None——這些是補充資訊，不能因此讓上傳失敗（抽 poster 另有 ffmpeg 把關）。
    ffprobe 沒有 -nostdin，stdin 直接接 /dev/null。"""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                *FFMPEG_INPUT_GUARD,
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height:format=duration",
                "-of",
                "json",
                str(video_path),
            ],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("ffprobe 無法執行，影片寬高與時長記為空白：%s", exc)
        return VideoProbe()
    if result.returncode != 0:
        return VideoProbe()
    try:
        info = json.loads(result.stdout or b"{}")
    except ValueError:
        return VideoProbe()
    streams = info.get("streams") or [{}]
    stream = streams[0] if isinstance(streams[0], dict) else {}
    try:
        duration: float | None = float((info.get("format") or {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    if duration is not None and not duration > 0:
        duration = None
    return VideoProbe(
        width=_positive_int(stream.get("width")),
        height=_positive_int(stream.get("height")),
        duration_seconds=round(duration, 2) if duration is not None else None,
    )


def extract_video_poster_webp(video_path: Path, at_seconds: float = 0.5) -> bytes:
    return extract_video_poster(video_path, at_seconds).data


def extract_video_poster(video_path: Path, at_seconds: float = 0.5) -> Rendition:
    """從影片檔抽一格轉成 WebP。影片已經在暫存檔裡，直接讀路徑，不把整支
    影片讀進記憶體再寫一次。"""
    with tempfile.TemporaryDirectory() as tmp:
        frame_path = Path(tmp) / "frame.png"

        # ffmpeg 不存在、逾時、被 kill 都要收斂成 ProcessingError，呼叫端
        # 才能照既有路徑把 asset 標成 failed；否則這些 infra 失敗會直接變成
        # 未捕捉例外（500），而且剛寫進 media_root 的原始檔會變成孤兒。
        # -max_pixels 讓解碼器拒絕超過像素上限的影格，ffmpeg 自己也不會為巨大
        # 影格配置記憶體。
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    *FFMPEG_INPUT_GUARD,
                    "-max_pixels",
                    str(MAX_IMAGE_PIXELS),
                    "-ss",
                    str(at_seconds),
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    str(frame_path),
                ],
                capture_output=True,
                stdin=subprocess.DEVNULL,
                timeout=30,
            )
        except subprocess.TimeoutExpired as exc:
            raise ProcessingError("ffmpeg 抽幀逾時（30 秒）") from exc
        except OSError as exc:
            raise ProcessingError(f"無法執行 ffmpeg：{exc}") from exc

        if result.returncode != 0 or not frame_path.exists():
            raise ProcessingError(
                f"ffmpeg 抽幀失敗：{result.stderr.decode('utf-8', errors='replace')[:500]}"
            )
        try:
            # 先只讀 PNG header 比對像素上限，再交給 Pillow 解碼。
            with Image.open(frame_path, formats=("PNG",)) as frame:
                width, height = frame.size
            if width * height > MAX_IMAGE_PIXELS:
                raise ProcessingError(f"影片影格像素過多（{width}x{height}），無法產生 poster")
            return make_webp(frame_path.read_bytes(), THUMBNAIL_SIZE[0], formats=("PNG",))
        except ProcessingError:
            raise
        except Exception as exc:  # Pillow 對壞影格可能丟各種例外（含 MemoryError）
            raise ProcessingError(f"影片 poster 轉檔失敗：{exc}") from exc
