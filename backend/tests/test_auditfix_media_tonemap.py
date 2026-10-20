"""HDR 轉色調只在 ffmpeg 跑完卻失敗時才退回不轉色調（2026-10-20 稽核 #13）。

逾時、ffmpeg 無法執行不是 zscale 的問題：退回只會讓同一支影片佔用唯一的轉檔名額
兩倍時間，成功時還默默產出偏灰版。這兩種直接往外丟，交給工作的重試／失敗。
被訊號砍掉（多半是 zscale 浮點影格吃太多記憶體）照舊退回：不轉色調用的記憶體少，
第二次多半做得完。"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.media import processing
from app.media.processing import ProcessingError, VideoColor

HDR = VideoColor(transfer="arib-std-b67", primaries="bt2020")


def _with_fake_ffmpeg(monkeypatch, on_tonemap):
    monkeypatch.setattr(processing, "tonemap_available", lambda: True)
    monkeypatch.setattr(processing, "probe_video", lambda path: processing.VideoProbe(160, 120, 1.0))
    calls: list[bool] = []

    def _run(argv, timeout):
        tonemapped = "zscale" in argv[argv.index("-vf") + 1]
        calls.append(tonemapped)
        if tonemapped:
            return on_tonemap(timeout)
        Path(argv[-1]).write_bytes(b"mp4")
        return 0, ""

    monkeypatch.setattr(processing, "_run_ffmpeg", _run)
    return calls


def test_tonemap_timeout_is_raised_without_plain_retry(tmp_path, monkeypatch):
    def _timeout(timeout):
        raise ProcessingError(f"影片轉檔逾時（{timeout} 秒）", retryable=True)

    calls = _with_fake_ffmpeg(monkeypatch, _timeout)
    with pytest.raises(ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert calls == [True]
    assert caught.value.retryable is True
    assert "逾時" in str(caught.value)


def test_tonemap_killed_by_signal_falls_back_without_tonemap(tmp_path, monkeypatch):
    calls = _with_fake_ffmpeg(monkeypatch, lambda timeout: (-9, ""))
    result = processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert calls == [True, False]
    assert result.width == 160


def test_tonemap_empty_output_falls_back_without_tonemap(tmp_path, monkeypatch):
    calls = _with_fake_ffmpeg(monkeypatch, lambda timeout: (0, ""))
    result = processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert calls == [True, False]
    assert result.width == 160


def test_killed_by_signal_again_without_tonemap_reports_memory(tmp_path, monkeypatch):
    monkeypatch.setattr(processing, "tonemap_available", lambda: True)
    calls: list[bool] = []

    def _run(argv, timeout):
        calls.append("zscale" in argv[argv.index("-vf") + 1])
        return -9, ""

    monkeypatch.setattr(processing, "_run_ffmpeg", _run)
    with pytest.raises(ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert calls == [True, False]
    assert caught.value.retryable is False
    assert "記憶體不足" in str(caught.value)


def test_ffmpeg_that_cannot_start_is_not_retried_without_tonemap(tmp_path, monkeypatch):
    def _cannot_start(timeout):
        raise ProcessingError("無法執行 ffmpeg：No such file", retryable=True)

    calls = _with_fake_ffmpeg(monkeypatch, _cannot_start)
    with pytest.raises(ProcessingError):
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert calls == [True]


def test_tonemap_nonzero_exit_still_falls_back(tmp_path, monkeypatch):
    calls = _with_fake_ffmpeg(monkeypatch, lambda timeout: (1, "No such filter: 'zscale'"))
    result = processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert calls == [True, False]
    assert result.width == 160


def test_real_timeout_from_run_ffmpeg_is_not_retried_without_tonemap(tmp_path, monkeypatch):
    """_run_ffmpeg 真的逾時（不是假的例外）也一樣往外丟。"""
    monkeypatch.setattr(processing, "tonemap_available", lambda: True)
    monkeypatch.setattr(processing, "transcode_timeout", lambda duration: 1)
    argvs: list[list[str]] = []
    real_popen = subprocess.Popen

    def _popen(argv, **kwargs):
        argvs.append(argv)
        return real_popen(["sleep", "5"], **kwargs)

    monkeypatch.setattr(processing.subprocess, "Popen", _popen)
    with pytest.raises(ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", HDR, 1.0)
    assert len(argvs) == 1
    assert caught.value.retryable is True
