from __future__ import annotations

import io
import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

THUMBNAIL_SIZE = (480, 480)

logger = logging.getLogger("app.media")

# 本機 ffmpeg 8.x 沒有編譯 libwebp，不能假設 `ffmpeg -c:v libwebp` 可用；
# 一律先讓 ffmpeg 抽 PNG 影格，再交給 Pillow 轉成 WebP。
# 見 CLAUDE.md「本機媒體工具限制與繞法」。


class ProcessingError(Exception):
    pass


def make_image_thumbnail_webp(source: bytes | Path) -> bytes:
    with Image.open(io.BytesIO(source) if isinstance(source, bytes) else source) as img:
        img = img.convert("RGB")
        img.thumbnail(THUMBNAIL_SIZE)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=80)
        return buf.getvalue()


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
    None——這些是補充資訊，不能因此讓上傳失敗（抽 poster 另有 ffmpeg 把關）。"""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
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
    """從影片檔抽一格轉成 WebP。影片已經在暫存檔裡，直接讀路徑，不把整支
    影片讀進記憶體再寫一次。"""
    with tempfile.TemporaryDirectory() as tmp:
        frame_path = Path(tmp) / "frame.png"

        # ffmpeg 不存在、逾時、被 kill 都要收斂成 ProcessingError，呼叫端
        # 才能照既有路徑把 asset 標成 failed；否則這些 infra 失敗會直接變成
        # 未捕捉例外（500），而且剛寫進 media_root 的原始檔會變成孤兒。
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
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
            return make_image_thumbnail_webp(frame_path.read_bytes())
        except Exception as exc:  # Pillow 對壞影格可能丟各種例外
            raise ProcessingError(f"影片 poster 轉檔失敗：{exc}") from exc
