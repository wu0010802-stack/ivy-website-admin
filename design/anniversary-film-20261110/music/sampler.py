"""Salamander Grand Piano V3 取樣器（numpy）。

- 取樣每小三度一個音（A0、C1、D#1、F#1…C8），其他音以最近的取樣做 ±1 半音重取樣（Catmull-Rom 三次內插）。
- 力度層：3、6、9、12、15（16 與 15 音量相同，不用）。依目標音量挑最接近的一層，再補增益，
  不在兩層之間交叉混合（兩次錄音相位不同，混在一起會梳狀濾波）。
- 延音踏板：鍵放開時若踏板踩著，延到踏板放開才止音；止音用依音高調整的制音器包絡，F6 以上沒有制音器、自然延音。
- 制音器落下時加一點 release 取樣（制音器的聲音），音量很低。
"""
from __future__ import annotations

import functools
import os
from dataclasses import dataclass

import numpy as np
import soundfile as sf

SR = 48000
SAMPLE_ROOT = os.environ.get(
    'SALAMANDER_DIR',
    '/tmp/claude-0/-home-user-ivy-website-admin/2de10abc-50cb-5b93-9166-274f3de97aa2/scratchpad/samples',
)
LAYERS = {3: -25.5, 6: -21.9, 9: -19.7, 12: -16.0, 15: -13.6}  # C4 前 0.5 秒 RMS（dBFS）
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def midi_name(m: int) -> str:
    return f'{NAMES[m % 12]}{m // 12 - 1}'


@functools.lru_cache(maxsize=None)
def load_sample(midi: int, layer: int) -> np.ndarray:
    name = midi_name(midi)
    path = f'{SAMPLE_ROOT}/audio-samples-piano-velocity{layer}-1.0.5/package/audio/{name}v{layer}.ogg'
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    assert sr == SR, (path, sr)
    # 去掉取樣開頭的空白（9–14 ms），讓音頭對準拍點
    env = np.abs(x).max(axis=1)
    thr = env.max() * 10 ** (-50 / 20)
    on = int(np.argmax(env > thr))
    on = max(0, on - int(0.0015 * SR))
    return np.ascontiguousarray(x[on:])


@functools.lru_cache(maxsize=None)
def load_release(key: int) -> np.ndarray:
    path = f'{SAMPLE_ROOT}/audio-samples-piano-release-1.0.5/package/audio/rel{key}.ogg'
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    return x


def nearest_sample(m: int) -> int:
    k = int(round((m - 21) / 3))
    k = max(0, min(k, (108 - 21) // 3))
    return 21 + 3 * k


def target_db(vel: float) -> float:
    vel = max(1.0, min(127.0, vel))
    return -13.6 - (127 - vel) * 0.165


def pick_layer(vel: float) -> tuple[int, float]:
    t = target_db(vel)
    layer = min(LAYERS, key=lambda L: abs(LAYERS[L] - t))
    return layer, t - LAYERS[layer]


def resample(x: np.ndarray, ratio: float, n_out: int) -> np.ndarray:
    """以 ratio（>1 升高音）讀取 x，輸出 n_out 個取樣；Catmull-Rom 三次內插。"""
    if abs(ratio - 1.0) < 1e-9:
        out = x[:n_out]
        if len(out) < n_out:
            out = np.vstack([out, np.zeros((n_out - len(out), x.shape[1]), np.float32)])
        return out
    pos = np.arange(n_out, dtype=np.float64) * ratio
    n_out = int(min(n_out, np.searchsorted(pos, len(x) - 3)))
    pos = pos[:n_out]
    i = pos.astype(np.int64)
    f = (pos - i)[:, None].astype(np.float32)
    xp = np.vstack([x[:1], x, x[-1:], x[-1:]])  # 前補一格，i 對應 xp[i+1]
    p0, p1, p2, p3 = xp[i], xp[i + 1], xp[i + 2], xp[i + 3]
    a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
    b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
    c = -0.5 * p0 + 0.5 * p2
    return ((a * f + b) * f + c) * f + p1


@dataclass
class PianoNote:
    t: float      # 秒
    dur: float    # 秒（按鍵時間）
    pitch: int
    vel: float


def damper_tau(pitch: int) -> float:
    # 低音制音器慢、高音快
    return float(np.interp(pitch, [21, 48, 72, 88], [0.32, 0.20, 0.12, 0.08]))


def effective_release(key_off: float, pedal: list[tuple[float, float]]) -> float:
    for down, up in pedal:
        if down <= key_off < up:
            return up
    return key_off


def render(notes: list[PianoNote], pedal: list[tuple[float, float]], total: float,
           release_gain_db: float = -34.0) -> np.ndarray:
    out = np.zeros((int(total * SR) + SR, 2), np.float32)
    # 同一個鍵再次敲下時，前一次的振動很快被打斷（不然踏板下同音會一直疊加）
    nxt: dict[int, float] = {}
    next_same: list[float] = [0.0] * len(notes)
    for i in sorted(range(len(notes)), key=lambda i: notes[i].t, reverse=True):
        next_same[i] = nxt.get(notes[i].pitch, 1e9)
        nxt[notes[i].pitch] = notes[i].t
    for idx, n in enumerate(notes):
        src = nearest_sample(n.pitch)
        layer, gain_db = pick_layer(n.vel)
        x = load_sample(src, layer)
        ratio = 2 ** ((n.pitch - src) / 12)
        off = effective_release(n.t + n.dur, pedal)
        if n.pitch >= 89:  # 沒有制音器
            off = max(off, n.t + 6.0)
        tau = damper_tau(n.pitch)
        ring = off - n.t
        cut = next_same[idx] - n.t + 0.01
        if cut < ring:
            ring, tau = cut, 0.035
        n_len = int((ring + tau * 7) * SR)
        y = resample(x, ratio, n_len)
        n_len = len(y)
        if n_len == 0:
            continue
        k_off = int(ring * SR)
        if k_off < n_len:
            tt = np.arange(n_len - k_off, dtype=np.float32) / SR
            y[k_off:] *= np.exp(-tt / tau)[:, None]
        y = y * np.float32(10 ** (gain_db / 20))
        s = int(round(n.t * SR))
        e = min(len(out), s + n_len)
        out[s:e] += y[: e - s]
        # 制音器落下的聲音
        if n.pitch < 89 and k_off < len(y) and tau != 0.035:
            r = load_release(n.pitch - 20)
            rg = 10 ** ((release_gain_db + (n.vel - 64) * 0.12) / 20)
            rs = int(round(off * SR))
            re = min(len(out), rs + len(r))
            if rs < len(out):
                out[rs:re] += r[: re - rs] * np.float32(rg)
    return out
