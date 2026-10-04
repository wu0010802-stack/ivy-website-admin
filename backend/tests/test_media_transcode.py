"""影片轉檔函式（app/media/processing.py，2026-10-03）。"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.media import processing
from app.media.processing import VideoColor

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="轉檔需要 ffmpeg")


def _make(path: Path, size: str, *, seconds: int = 2, audio: bool = True) -> Path:
    args = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=s={size}:d={seconds}:r=60"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac", "-shortest"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(args, check=True, capture_output=True, timeout=120)
    return path


def _probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, timeout=30,
    ).stdout
    return json.loads(out)


def test_needs_medium_rendition_only_above_960():
    assert processing.needs_medium_rendition(961, 100) is True
    assert processing.needs_medium_rendition(960, 960) is False
    assert processing.needs_medium_rendition(None, None) is False


def test_transcode_args_are_guarded_and_drop_audio_and_metadata(tmp_path):
    argv = processing.transcode_args(tmp_path / "in.mp4", tmp_path / "out.mp4", "mobile", VideoColor(), tonemap=True)
    ffmpeg = argv[argv.index("ffmpeg"):]
    head = ffmpeg[: ffmpeg.index("-i")]
    assert "-nostdin" in head
    assert head[head.index("-protocol_whitelist") + 1] == "file"
    assert head[head.index("-f") + 1] == "mov"
    assert head[head.index("-max_pixels") + 1] == str(processing.MAX_IMAGE_PIXELS)
    assert "-an" in ffmpeg and ffmpeg[ffmpeg.index("-map_metadata") + 1] == "-1"
    assert ffmpeg[ffmpeg.index("-crf") + 1] == "26"
    assert ffmpeg[ffmpeg.index("-movflags") + 1] == "+faststart"
    assert "-ss" not in ffmpeg and "-t" not in ffmpeg
    assert "zscale" not in ffmpeg[ffmpeg.index("-vf") + 1]


def test_hdr_is_tonemapped_only_when_zscale_exists(tmp_path):
    hdr = VideoColor(transfer="arib-std-b67", primaries="bt2020")
    with_zscale = processing.transcode_args(tmp_path / "a", tmp_path / "b", "desktop", hdr, tonemap=True)
    without = processing.transcode_args(tmp_path / "a", tmp_path / "b", "desktop", hdr, tonemap=False)
    assert with_zscale[with_zscale.index("-vf") + 1].startswith("zscale=")
    assert "zscale" not in without[without.index("-vf") + 1]
    assert hdr.is_hdr and not VideoColor(transfer="bt709").is_hdr


def test_transcode_timeout_bounds():
    assert processing.transcode_timeout(None) == 1800
    assert processing.transcode_timeout(5) == 120
    assert processing.transcode_timeout(100) == 600
    assert processing.transcode_timeout(1000) == 1800


def test_too_long_video_is_rejected_before_running_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(processing.subprocess, "run", lambda *a, **k: pytest.fail("不該執行 ffmpeg"))
    with pytest.raises(processing.ProcessingError, match="10 分鐘") as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 601)
    assert caught.value.retryable is False


def test_ffmpeg_timeout_is_retryable(tmp_path, monkeypatch):
    def _timeout(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, kwargs.get("timeout"))

    monkeypatch.setattr(processing.subprocess, "run", _timeout)
    with pytest.raises(processing.ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 10)
    assert caught.value.retryable is True


@requires_ffmpeg
def test_transcode_keeps_duration_and_drops_audio(tmp_path):
    source = _make(tmp_path / "in.mp4", "320x240", seconds=2, audio=True)
    target = tmp_path / "out.mp4"
    result = processing.transcode_video(source, target, "mobile", processing.probe_video_color(source), 2.0)
    info = _probe(target)
    streams = info["streams"]
    assert [s["codec_type"] for s in streams] == ["video"]
    assert streams[0]["codec_name"] == "h264" and streams[0]["pix_fmt"] == "yuv420p"
    assert abs(float(info["format"]["duration"]) - 2.0) < 0.1
    # 60fps 來源降到 30fps。
    assert streams[0]["r_frame_rate"] == "30/1"
    data = target.read_bytes()
    assert data.index(b"moov") < data.index(b"mdat")  # faststart
    assert (result.width, result.height) == (320, 240)


@requires_ffmpeg
def test_transcode_scales_long_side_to_1920(tmp_path):
    source = _make(tmp_path / "wide.mp4", "2400x1200", seconds=1, audio=False)
    result = processing.transcode_video(source, tmp_path / "out.mp4", "desktop", VideoColor(), 1.0)
    assert (result.width, result.height) == (1920, 960)
