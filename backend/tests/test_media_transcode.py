"""影片轉檔函式（app/media/processing.py，2026-10-03）。"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from app.media import processing
from app.media.processing import TranscodeInterrupted, VideoColor, VideoStream
from tests.test_secfix_media import _make_tagged_video, _rotation

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
    tail = ffmpeg[ffmpeg.index("-i"):]
    assert "-nostdin" in head
    assert head[head.index("-protocol_whitelist") + 1] == "file"
    assert head[head.index("-f") + 1] == "mov"
    assert head[head.index("-max_pixels") + 1] == str(processing.MAX_IMAGE_PIXELS)
    # 解碼與濾鏡的執行緒要在 -i 之前限；-i 之後的 -threads 只管編碼器。
    assert head[head.index("-threads") + 1] == "2"
    assert head[head.index("-filter_threads") + 1] == "2"
    assert tail[tail.index("-threads") + 1] == "2"
    assert "-an" in ffmpeg and ffmpeg[ffmpeg.index("-map_metadata") + 1] == "-1"
    assert ffmpeg[ffmpeg.index("-crf") + 1] == "26"
    assert ffmpeg[ffmpeg.index("-movflags") + 1] == "+faststart"
    assert "-ss" not in ffmpeg and "-t" not in ffmpeg
    assert "zscale" not in ffmpeg[ffmpeg.index("-vf") + 1]
    assert "-color_trc" not in ffmpeg  # SDR 來源不改色彩標記


def test_hdr_is_tonemapped_after_scaling_only_when_zscale_exists(tmp_path):
    hdr = VideoColor(transfer="arib-std-b67", primaries="bt2020")
    with_zscale = processing.transcode_args(tmp_path / "a", tmp_path / "b", "desktop", hdr, tonemap=True)
    without = processing.transcode_args(tmp_path / "a", tmp_path / "b", "desktop", hdr, tonemap=False)
    vf = with_zscale[with_zscale.index("-vf") + 1]
    # 先縮圖再轉色調（浮點 RGB 不在 4K 原尺寸上做），最後由 zscale 直接出 bt709 yuv420p。
    assert vf.startswith("scale=") and vf.index("scale=") < vf.index("zscale=")
    assert vf.endswith(",zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
    assert vf.index("format=gbrpf32le") < vf.index("tonemap=") < vf.rindex("zscale=")
    for flag in ("-color_primaries", "-color_trc", "-colorspace"):
        assert with_zscale[with_zscale.index(flag) + 1] == "bt709"
    assert "zscale" not in without[without.index("-vf") + 1]
    assert "-color_trc" not in without
    assert hdr.is_hdr and not VideoColor(transfer="bt709").is_hdr


def test_transcode_timeout_bounds():
    assert processing.transcode_timeout(None) == 1800
    assert processing.transcode_timeout(5) == 120
    assert processing.transcode_timeout(100) == 600
    assert processing.transcode_timeout(1000) == 1800


def test_too_long_video_is_rejected_before_running_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(processing.subprocess, "run", lambda *a, **k: pytest.fail("不該執行 ffmpeg"))
    monkeypatch.setattr(processing.subprocess, "Popen", lambda *a, **k: pytest.fail("不該執行 ffmpeg"))
    with pytest.raises(processing.ProcessingError, match="10 分鐘") as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 601)
    assert caught.value.retryable is False


def _fake_ffmpeg(monkeypatch, code: str) -> None:
    """轉檔指令換成一段 Python（不真的跑 ffmpeg），驗 Popen 的收尾。"""
    monkeypatch.setattr(processing, "transcode_args", lambda *a, **k: [sys.executable, "-c", code])


def test_ffmpeg_timeout_is_retryable_and_kills_the_process(tmp_path, monkeypatch):
    _fake_ffmpeg(monkeypatch, "import time; time.sleep(30)")
    monkeypatch.setattr(processing, "transcode_timeout", lambda duration: 1)
    began = time.monotonic()
    with pytest.raises(processing.ProcessingError, match="逾時") as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 10)
    assert caught.value.retryable is True
    assert time.monotonic() - began < 10
    assert processing._running == {}


def test_signal_killed_ffmpeg_says_out_of_memory_and_is_not_retried(tmp_path, monkeypatch):
    _fake_ffmpeg(monkeypatch, "import os, signal; os.kill(os.getpid(), signal.SIGKILL)")
    with pytest.raises(processing.ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 10)
    assert "記憶體不足或被系統中止" in str(caught.value)
    assert caught.value.retryable is False


def test_ffmpeg_error_output_keeps_only_the_tail(tmp_path, monkeypatch):
    _fake_ffmpeg(monkeypatch, "import sys; sys.stderr.write('x' * 200000 + 'LAST-LINE'); sys.exit(1)")
    with pytest.raises(processing.ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 10)
    message = str(caught.value)
    assert message.startswith("影片轉檔失敗：") and message.endswith("LAST-LINE")
    assert len(message) < 400


def test_terminate_running_transcodes_stops_ffmpeg(tmp_path, monkeypatch):
    _fake_ffmpeg(monkeypatch, "import time; time.sleep(60)")
    caught: list[BaseException] = []

    def _run() -> None:
        try:
            processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 10)
        except BaseException as exc:  # noqa: BLE001 - 留給主執行緒檢查
            caught.append(exc)

    worker = threading.Thread(target=_run)
    worker.start()
    deadline = time.monotonic() + 5
    while not processing._running:
        assert time.monotonic() < deadline, "ffmpeg 沒有登記成執行中"
        time.sleep(0.01)
    (proc,) = list(processing._running)
    began = time.monotonic()
    assert processing.terminate_running_transcodes(grace=2) == 1
    worker.join(5)
    assert not worker.is_alive() and time.monotonic() - began < 5
    assert proc.poll() is not None
    assert len(caught) == 1 and isinstance(caught[0], TranscodeInterrupted)
    assert caught[0].retryable is True
    assert processing._running == {}
    assert processing.terminate_running_transcodes(grace=0) == 0


def test_tonemap_failure_falls_back_to_plain_transcode(tmp_path, monkeypatch, caplog):
    hdr = VideoColor(transfer="arib-std-b67", primaries="bt2020")
    monkeypatch.setattr(processing, "tonemap_available", lambda: True)
    tonemapped: list[bool] = []

    def _run(argv, timeout):
        vf = argv[argv.index("-vf") + 1]
        tonemapped.append("zscale" in vf)
        if "zscale" in vf:
            return 1, "No such filter: 'zscale'"
        Path(argv[-1]).write_bytes(b"mp4")
        return 0, ""

    monkeypatch.setattr(processing, "_run_ffmpeg", _run)
    monkeypatch.setattr(processing, "probe_video", lambda path: processing.VideoProbe(160, 120, 1.0))
    with caplog.at_level(logging.WARNING, logger="app.media"):
        result = processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", hdr, 1.0)
    assert tonemapped == [True, False]
    assert result.width == 160
    assert any("改成不轉色調" in r.getMessage() for r in caplog.records)


def test_interrupted_tonemap_does_not_fall_back(tmp_path, monkeypatch):
    hdr = VideoColor(transfer="arib-std-b67", primaries="bt2020")
    monkeypatch.setattr(processing, "tonemap_available", lambda: True)
    calls: list[str] = []

    def _run(argv, timeout):
        calls.append(argv[argv.index("-vf") + 1])
        raise TranscodeInterrupted()

    monkeypatch.setattr(processing, "_run_ffmpeg", _run)
    with pytest.raises(TranscodeInterrupted):
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", hdr, 1.0)
    assert len(calls) == 1


def test_plays_in_browsers_and_keep_original_rule():
    ready = VideoStream(codec="h264", pix_fmt="yuv420p", width=1920, height=1080, fps=30000 / 1001)
    assert ready.plays_in_browsers
    for other in (
        VideoStream(codec="hevc", pix_fmt="yuv420p", width=1920, height=1080, fps=30),
        VideoStream(codec="h264", pix_fmt="yuv420p10le", width=1920, height=1080, fps=30),
        VideoStream(codec="h264", pix_fmt="yuv420p", width=3840, height=2160, fps=30),
        VideoStream(codec="h264", pix_fmt="yuv420p", width=1920, height=1080, fps=60),
        VideoStream(codec="h264", pix_fmt="yuv420p", width=1920, height=1080, fps=None),
        VideoStream(
            color=VideoColor(transfer="arib-std-b67"), codec="h264", pix_fmt="yuv420p", width=1920, height=1080, fps=30
        ),
        VideoStream(),
    ):
        assert not other.plays_in_browsers, other
    limit = processing.KEEP_ORIGINAL_RATIO
    assert processing.should_keep_original(ready, 1000, int(1000 * limit))
    assert not processing.should_keep_original(ready, 1000, int(1000 * limit) - 1)
    # 瀏覽器不一定能播的來源：一律採用轉檔版本，不看大小。
    hevc = VideoStream(codec="hevc", pix_fmt="yuv420p", width=1920, height=1080, fps=30)
    assert not processing.should_keep_original(hevc, 1000, 5000)
    assert processing._frame_rate("30000/1001") == pytest.approx(29.97, abs=0.01)
    assert processing._frame_rate("0/0") is None and processing._frame_rate(None) is None


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


@requires_ffmpeg
def test_probe_video_stream_reads_codec_and_frame_rate(tmp_path):
    source = _make(tmp_path / "in.mp4", "320x240", seconds=1, audio=False)
    stream = processing.probe_video_stream(source)
    assert (stream.codec, stream.pix_fmt, stream.width, stream.height) == ("h264", "yuv420p", 320, 240)
    assert stream.fps == 60 and not stream.plays_in_browsers
    assert processing.probe_video_color(source) == stream.color


@requires_ffmpeg
def test_unstripped_gps_rotated_video_comes_out_clean_and_upright(tmp_path):
    """背景工作讀的是上傳時已清理的原檔；這裡直接餵未清理、帶 GPS 與旋轉的檔，確認
    轉檔本身也不帶出拍攝資訊，而且把旋轉寫進畫面。"""
    source, rotated = _make_tagged_video(tmp_path)
    assert rotated  # 本機 8.x、CI 6.1 都支援 -display_rotation
    assert abs(_rotation(_probe(source))) == 90
    target = tmp_path / "out.mp4"
    result = processing.transcode_video(source, target, "desktop", processing.probe_video_color(source), 1.0)
    assert b"25.0330" not in target.read_bytes() and b"GPS-TITLE" not in target.read_bytes()
    info = _probe(target)
    tags = {k.lower() for k in info["format"].get("tags", {})}
    assert not tags & {"location", "location-eng", "title", "creation_time"}
    assert not _rotation(info)
    assert (result.width, result.height) == (120, 160)


@requires_ffmpeg
@pytest.mark.skipif(not processing.tonemap_available(), reason="這台的 ffmpeg 沒有 zscale（CI 的 Ubuntu ffmpeg 有）")
def test_hlg_video_is_tonemapped_to_sdr(tmp_path, caplog):
    source = tmp_path / "hlg.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:d=1:r=30",
            # 用 setparams 標在影格上：ffmpeg 7 起編碼器的色彩標記跟著影格走，
            # 只寫 -color_trc 之類的輸出選項不一定會寫進檔案。
            "-vf", "setparams=color_trc=arib-std-b67:color_primaries=bt2020:colorspace=bt2020nc:range=tv",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
        ],
        check=True, capture_output=True, timeout=60,
    )
    color = processing.probe_video_color(source)
    assert color.is_hdr
    target = tmp_path / "out.mp4"
    with caplog.at_level(logging.WARNING, logger="app.media"):
        result = processing.transcode_video(source, target, "desktop", color, 1.0)
    assert not [r for r in caplog.records if "改成不轉色調" in r.getMessage()]
    info = _probe(target)
    video = info["streams"][0]
    assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert video.get("color_transfer") == "bt709" and video.get("color_primaries") == "bt709"
    assert abs(float(info["format"]["duration"]) - 1.0) < 0.1
    assert (result.width, result.height) == (320, 240)


def test_transcode_popen_is_guarded(tmp_path, monkeypatch):
    """轉檔改用 Popen 之後，安全規則不能退：stdin 接 /dev/null、不用 preexec_fn、
    輸入端限定 mov demuxer 與本機檔案。"""
    seen: dict = {}
    real_popen = subprocess.Popen

    def _popen(argv, **kwargs):
        seen["argv"], seen["kwargs"] = list(argv), kwargs
        return real_popen([sys.executable, "-c", "import sys; sys.exit(1)"], **kwargs)

    monkeypatch.setattr(processing.subprocess, "Popen", _popen)
    with pytest.raises(processing.ProcessingError):
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 1.0)
    assert seen["kwargs"]["stdin"] == subprocess.DEVNULL
    assert "preexec_fn" not in seen["kwargs"]
    ffmpeg = seen["argv"][seen["argv"].index("ffmpeg"):]
    head = ffmpeg[: ffmpeg.index("-i")]
    assert "-nostdin" in head and head[head.index("-protocol_whitelist") + 1] == "file"
    assert head[head.index("-f") + 1] == "mov"
