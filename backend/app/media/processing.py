from __future__ import annotations

import functools
import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import TypeVar

from PIL import Image, ImageOps

from app.common.concurrency import ThreadSlots

# 衍生檔（規格 L139：原檔保留，衍生縮圖另存）。縮圖給後台列表、選圖器與官網
# 小版位；大圖給官網手機與一般寬度的版位，原檔只在高解析螢幕的滿版才會被選到。
THUMBNAIL_SIZE = (480, 480)
LARGE_SIDE = 1600
# 中圖：手機 2 倍螢幕滿版約 780px，只有 480 與 1600 時只能拿 1600（2026-10-03）。
MEDIUM_SIDE = 960

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
    """素材處理失敗。retryable：逾時、ffmpeg 無法執行這類「晚點再試可能就好」的
    失敗；影片本身解不開，重試也沒用，背景處理直接標成失敗。"""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


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


def needs_medium_rendition(width: int | None, height: int | None) -> bool:
    """原圖長邊超過 MEDIUM_SIDE 才另存中圖。"""
    return max(width or 0, height or 0) > MEDIUM_SIDE


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
            raise ProcessingError("ffmpeg 抽幀逾時（30 秒）", retryable=True) from exc
        except OSError as exc:
            raise ProcessingError(f"無法執行 ffmpeg：{exc}", retryable=True) from exc

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


# ---- 影片轉檔（2026-10-03，背景處理用，見 app/media/jobs.py） ----
# 官網影片版位（首屏、孩子的一天、活動影片）一律靜音播放，轉檔版本不帶聲音。
# 桌機、手機同解析度同構圖，手機只把 CRF 拉高（web/app/utils/media-policy.ts、
# DESIGN.md「孩子的一天」影片）。參數改這裡；後台說明與文件寫的數字跟著改。
TRANSCODE_MAX_SIDE = 1920
TRANSCODE_MAX_FPS = 30
TRANSCODE_CRF = {"desktop": 20, "mobile": 26}
TRANSCODE_PRESET = "medium"
# 解碼、濾鏡、編碼各自的執行緒上限。只在 -i 之後寫 -threads 只限到編碼器，解碼與濾鏡
# 仍依主機 CPU 數開（審查實測 8 核、6 秒 4K：20 個執行緒、RSS 636 MB；三處都限 2
# 之後 13 個、472 MB）。
TRANSCODE_THREADS = 2
TRANSCODE_MAX_SECONDS = 600
# 一支影片可能轉好幾分鐘：另開一組名額，不佔上傳驗證、縮圖共用的 MEDIA_JOB_CONCURRENCY。
TRANSCODE_CONCURRENCY = 1
# 原檔已經是瀏覽器能直接播的 H.264 時，轉檔版本要比原檔小到這個比例以下才採用；
# 否則沿用原檔（不寫版本，官網照播原檔）。再壓一次 H.264 一定掉畫質，省不到一成流量
# 不值得；審查實測官網內建四支影片的桌機版是原檔的 0.78–1.22 倍，有一支反而變大。
KEEP_ORIGINAL_RATIO = 0.9
# ffmpeg 的錯誤輸出只留尾端：寫到暫存檔、不進記憶體（壞檔可能讓 ffmpeg 一直印錯誤）。
_STDERR_TAIL_BYTES = 4096
# 停機時先 terminate，等這麼久還沒結束就 kill。ffmpeg 收到 SIGTERM 會把編碼器裡還沒
# 輸出的影格編完、寫完檔尾才結束（preset 越慢越久），但這份輸出反正不要了，不必等它。
TERMINATE_GRACE_SECONDS = 2.0
_HDR_TRANSFERS = frozenset({"smpte2084", "arib-std-b67"})
# 長邊縮到上限以內（不放大），寬高取偶數（yuv420p 的要求）。ffmpeg 轉檔預設依
# 顯示矩陣自動轉正，這裡的 iw／ih 已經是轉正後的寬高。
_SCALE_FILTER = (
    f"scale=w='if(gte(iw,ih),min({TRANSCODE_MAX_SIDE},trunc(iw/2)*2),-2)'"
    f":h='if(gte(iw,ih),-2,min({TRANSCODE_MAX_SIDE},trunc(ih/2)*2))'"
)
# HDR（iPhone 預設錄 HLG／Dolby Vision）轉成 SDR，不然 8 位元 H.264 會灰白。要 zscale（libzimg）。
# 接在縮圖之後：浮點 RGB（gbrpf32le）一格 4K 約 100 MB，先縮到 1920 才做。最後一步由
# zscale 直接輸出 bt709 的 yuv420p，不交給 swscale 從 RGB 轉 YUV（會偏色）。
_TONEMAP_FILTER = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
)
# 色調轉完的畫面是 SDR，標記要是 bt709。ffmpeg 7 起編碼器的色彩標記跟著影格走（最後一個
# zscale 已標成 bt709）；更舊的版本（CI 6.1、Debian bookworm 5.1）會沿用來源的 HLG／PQ
# 標記，要靠這幾個輸出選項蓋掉。
_SDR_OUTPUT_TAGS = ("-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv")
# 轉檔讓給 API 請求：降低排程優先權（不用 preexec_fn，它在 thread 裡不安全）。
# nice 會 exec 成 ffmpeg，Popen 拿到的就是 ffmpeg 本身，停機時 terminate 得到。
_NICE = ("nice", "-n", "10") if shutil.which("nice") else ()
_transcode_slots = ThreadSlots(TRANSCODE_CONCURRENCY)

# 執行中的轉檔 ffmpeg → 是否已被停機中止。轉檔在 thread 裡跑，停機在 event loop 上
# 呼叫 terminate_running_transcodes，兩邊都要拿鎖。
_running: dict[subprocess.Popen, bool] = {}
_running_lock = threading.Lock()


async def run_transcode_job(func: Callable[..., _T], /, *args) -> _T:
    return await _transcode_slots.run(func, *args)


class TranscodeInterrupted(ProcessingError):
    """停機時 ffmpeg 被中止。工作已經放回佇列，下一個程序會重新轉；這不是影片的問題，
    也不退回不轉色調再試一次。"""

    def __init__(self) -> None:
        super().__init__("轉檔因為程式停止而中斷，稍後會重新處理", retryable=True)


@dataclass(frozen=True)
class VideoColor:
    transfer: str | None = None
    primaries: str | None = None

    @property
    def is_hdr(self) -> bool:
        return self.transfer in _HDR_TRANSFERS


@dataclass(frozen=True)
class VideoStream:
    """原檔第一條影像軌：決定要不要轉色調，以及轉出來的版本值不值得用。"""

    color: VideoColor = field(default_factory=VideoColor)
    codec: str | None = None
    pix_fmt: str | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None

    @property
    def plays_in_browsers(self) -> bool:
        """已經是官網可以直接播的影片：H.264、8 位元 4:2:0、SDR，長邊與每秒格數都不超過
        轉檔上限。讀不到的欄位一律當成不是（照常轉檔）。"""
        return (
            self.codec == "h264"
            and self.pix_fmt == "yuv420p"
            and not self.color.is_hdr
            and self.width is not None
            and self.height is not None
            and max(self.width, self.height) <= TRANSCODE_MAX_SIDE
            and self.fps is not None
            and self.fps <= TRANSCODE_MAX_FPS + 0.01
        )


def should_keep_original(stream: VideoStream, source_bytes: int, output_bytes: int) -> bool:
    """轉出來的版本不採用、沿用原檔：原檔本來就能直接播，而且轉檔版本沒有小到
    KEEP_ORIGINAL_RATIO 以下。HEVC 等瀏覽器不一定能播的來源一律採用，不看大小。"""
    return stream.plays_in_browsers and output_bytes >= source_bytes * KEEP_ORIGINAL_RATIO


def _frame_rate(value: object) -> float | None:
    """ffprobe 的 "30000/1001"；"0/0" 或讀不懂回 None。"""
    try:
        rate = Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return None
    return float(rate) if rate > 0 else None


def probe_video_stream(video_path: Path) -> VideoStream:
    """第一條影像軌的編碼、像素格式、寬高、每秒格數與色彩轉換特性；讀不到就全空
    （當成一般 SDR、需要轉檔）。"""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", *FFMPEG_INPUT_GUARD, "-select_streams", "v:0",
                "-show_entries",
                "stream=codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,color_transfer,color_primaries",
                "-of", "json", str(video_path),
            ],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return VideoStream()
    if result.returncode != 0:
        return VideoStream()
    try:
        streams = json.loads(result.stdout or b"{}").get("streams") or [{}]
    except ValueError:
        return VideoStream()
    stream = streams[0] if isinstance(streams[0], dict) else {}
    return VideoStream(
        color=VideoColor(
            transfer=stream.get("color_transfer") or None, primaries=stream.get("color_primaries") or None
        ),
        codec=stream.get("codec_name") or None,
        pix_fmt=stream.get("pix_fmt") or None,
        width=_positive_int(stream.get("width")),
        height=_positive_int(stream.get("height")),
        # 可變格率（手機常見）看平均格率；沒有平均才看 r_frame_rate。
        fps=_frame_rate(stream.get("avg_frame_rate")) or _frame_rate(stream.get("r_frame_rate")),
    )


def probe_video_color(video_path: Path) -> VideoColor:
    """第一條影像軌的色彩轉換特性；讀不到就當成一般 SDR。"""
    return probe_video_stream(video_path).color


@functools.lru_cache(maxsize=1)
def tonemap_available() -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, stdin=subprocess.DEVNULL, timeout=15
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    listed = result.stdout.decode("utf-8", errors="replace")
    return " zscale " in listed and " tonemap " in listed


def transcode_timeout(duration: float | None) -> int:
    """一個版本的轉檔上限秒數：影片長度的 6 倍，至少 2 分鐘、最多 30 分鐘；長度不明給上限。"""
    if not duration:
        return 1800
    return int(min(1800, max(120, duration * 6)))


def transcode_args(source: Path, target: Path, edition: str, color: VideoColor, *, tonemap: bool) -> list[str]:
    tonemapped = color.is_hdr and tonemap
    vf = f"{_SCALE_FILTER},{_TONEMAP_FILTER}" if tonemapped else _SCALE_FILTER
    threads = str(TRANSCODE_THREADS)
    return [
        *_NICE,
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        # -i 之前的 -threads 是解碼；-filter_threads 是濾鏡（縮圖、轉色調）。
        "-threads", threads, "-filter_threads", threads,
        *FFMPEG_INPUT_GUARD, "-max_pixels", str(MAX_IMAGE_PIXELS), "-i", str(source),
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        "-vf", f"{vf},format=yuv420p",
        "-c:v", "libx264", "-preset", TRANSCODE_PRESET, "-crf", str(TRANSCODE_CRF[edition]),
        "-profile:v", "high", "-pix_fmt", "yuv420p", "-fpsmax", str(TRANSCODE_MAX_FPS),
        *(_SDR_OUTPUT_TAGS if tonemapped else ()),
        "-threads", threads, "-movflags", "+faststart",
        "-f", "mp4", "-y", str(target),
    ]


def _stderr_tail(stream) -> str:
    stream.seek(0, os.SEEK_END)
    stream.seek(max(0, stream.tell() - _STDERR_TAIL_BYTES))
    return stream.read().decode("utf-8", errors="replace")


def _run_ffmpeg(argv: list[str], timeout: int) -> tuple[int, str]:
    """跑一次轉檔 ffmpeg，回傳 (returncode, 錯誤輸出尾端)。逾時就 kill 並丟可重試的
    ProcessingError；停機時被 terminate_running_transcodes 中止丟 TranscodeInterrupted。

    用 Popen 而不是 subprocess.run：程序要登記起來，停機時才收得掉。不然 asyncio.run
    收尾與直譯器結束都會等這個 thread，程序要撐到 ffmpeg 跑完（最長 30 分鐘）或被
    SIGKILL，部署時舊容器遲遲不退。"""
    with tempfile.TemporaryFile(prefix="ffmpeg-stderr-") as stderr:
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=stderr)
        except OSError as exc:
            raise ProcessingError(f"無法執行 ffmpeg：{exc}", retryable=True) from exc
        with _running_lock:
            _running[proc] = False
        try:
            returncode = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise ProcessingError(f"影片轉檔逾時（{timeout} 秒）", retryable=True) from exc
        finally:
            # 逾時或其他例外：不留下還在跑的 ffmpeg。
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            with _running_lock:
                interrupted = _running.pop(proc, False)
        if interrupted:
            raise TranscodeInterrupted()
        return returncode, _stderr_tail(stderr)


def terminate_running_transcodes(grace: float = TERMINATE_GRACE_SECONDS) -> int:
    """停機用：中止所有執行中的轉檔 ffmpeg，先 terminate、grace 秒內沒結束就 kill。
    回傳中止了幾個。會等程序結束，在 event loop 上要丟到 thread 裡呼叫。"""
    with _running_lock:
        procs = list(_running)
        for proc in procs:
            _running[proc] = True
    for proc in procs:
        try:
            proc.terminate()
        except OSError:  # 剛好已經結束
            pass
    deadline = time.monotonic() + grace
    for proc in procs:
        try:
            proc.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    if procs:
        logger.info("背景處理：停機，中止 %s 個轉檔中的 ffmpeg", len(procs))
    return len(procs)


def _transcode_once(
    source: Path, target: Path, edition: str, color: VideoColor, duration: float | None, *, tonemap: bool
) -> VideoProbe:
    timeout = transcode_timeout(duration)
    try:
        returncode, stderr = _run_ffmpeg(transcode_args(source, target, edition, color, tonemap=tonemap), timeout)
    except ProcessingError:
        target.unlink(missing_ok=True)
        raise
    if returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        if returncode < 0:
            # 被訊號砍掉（多半是記憶體不足被系統收掉）：重試多半一樣，不排重試。
            raise ProcessingError("影片轉檔時記憶體不足或被系統中止，請剪短或降低解析度後重新上傳")
        raise ProcessingError(f"影片轉檔失敗：{stderr[-300:]}")
    return probe_video(target)


def transcode_video(source: Path, target: Path, edition: str, color: VideoColor, duration: float | None) -> VideoProbe:
    """轉成 H.264 MP4 寫到 target，回傳輸出檔的寬高與時長。不裁切、不改時間軸：
    活動影片的開始／結束秒數是對原片算的。HDR 轉 SDR 失敗時退回不轉色調再轉一次
    （顏色可能偏灰，但影片可以用）。"""
    if duration is not None and duration > TRANSCODE_MAX_SECONDS:
        raise ProcessingError(f"影片超過 {TRANSCODE_MAX_SECONDS // 60} 分鐘，請剪短後重新上傳")
    tonemap = color.is_hdr and tonemap_available()
    if color.is_hdr and not tonemap:
        logger.warning("ffmpeg 沒有 zscale，HDR 影片直接轉成 8 位元，顏色可能偏灰")
    if tonemap:
        try:
            return _transcode_once(source, target, edition, color, duration, tonemap=True)
        except TranscodeInterrupted:
            raise
        except ProcessingError as exc:
            logger.warning("HDR 轉 SDR 失敗，改成不轉色調再轉一次：%s", exc)
    return _transcode_once(source, target, edition, color, duration, tonemap=False)
