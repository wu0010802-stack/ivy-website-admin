from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image

THUMBNAIL_SIZE = (480, 480)

# 本機 ffmpeg 8.x 沒有編譯 libwebp，不能假設 `ffmpeg -c:v libwebp` 可用；
# 一律先讓 ffmpeg 抽 PNG 影格，再交給 Pillow 轉成 WebP。
# 見 CLAUDE.md「本機媒體工具限制與繞法」。


class ProcessingError(Exception):
    pass


def make_image_thumbnail_webp(source_bytes: bytes) -> bytes:
    import io

    with Image.open(io.BytesIO(source_bytes)) as img:
        img = img.convert("RGB")
        img.thumbnail(THUMBNAIL_SIZE)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=80)
        return buf.getvalue()


def extract_video_poster_webp(video_bytes: bytes, at_seconds: float = 0.5) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        video_path = Path(tmp) / "source.mp4"
        frame_path = Path(tmp) / "frame.png"
        video_path.write_bytes(video_bytes)

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
