"""把 compose.py 的總譜渲染成各聲部 stem（48 kHz float32 WAV）。

- 鋼琴：sampler.py（Salamander Grand Piano V3）
- 其他：fluidsynth + MuseScore General（關掉內建殘響與合唱，殘響在 mix.py 統一做）
- 音效（升起聲、低頻、金色閃光）與反向鈸：numpy 合成

用法：nice -n 5 python3 render.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose  # noqa: E402
import sampler  # noqa: E402

SR = 48000
SF2 = '/usr/share/sounds/sf2/MuseScore_General_Full.sf2'
OUT = compose.OUT
STEMS = f'{OUT}/stems'
TOTAL = 144.0
N = int(TOTAL * SR)


def fit(x: np.ndarray, n: int = N) -> np.ndarray:
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    if len(x) >= n:
        return x[:n].astype(np.float32)
    return np.vstack([x, np.zeros((n - len(x), 2), np.float32)]).astype(np.float32)


def fluid(mid: str, wav: str, gain: float = 0.5):
    subprocess.run(['fluidsynth', '-ni', '-F', wav, '-r', str(SR), '-O', 'float', '-g', str(gain),
                    '-o', 'synth.reverb.active=0', '-o', 'synth.chorus.active=0', '-o', 'synth.polyphony=1024',
                    '-o', 'synth.cpu-cores=1', SF2, mid], check=True, capture_output=True)


def bar_t(bar: float) -> float:
    return bar * 8 / 3


# ── 音效 ────────────────────────────────────────────────────────────────
rng = np.random.default_rng(30)


def bandpass_sweep(noise: np.ndarray, f0: float, f1: float, q: float = 1.2) -> np.ndarray:
    """時變帶通（狀態變數濾波器），中心頻率由 f0 指數滑到 f1。"""
    n = len(noise)
    fc = f0 * (f1 / f0) ** (np.arange(n) / max(1, n - 1))
    g = np.tan(np.pi * fc / SR)
    k = 1 / q
    out = np.zeros(n)
    ic1 = ic2 = 0.0
    for i in range(n):
        gi = g[i]
        a1 = 1 / (1 + gi * (gi + k))
        a2 = gi * a1
        a3 = gi * a2
        v3 = noise[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = v1
    return out


def riser(end_t: float, length: float, level_db: float, f0=300.0, f1=6000.0) -> tuple[int, np.ndarray]:
    n = int(length * SR)
    t = np.arange(n) / SR
    env = (t / length) ** 2.2
    # 最後 40 ms 收掉，正好停在拍點前
    tail = int(0.04 * SR)
    env[-tail:] *= np.linspace(1, 0, tail) ** 2
    out = np.zeros((n, 2))
    for c in range(2):
        nz = rng.standard_normal(n)
        out[:, c] = bandpass_sweep(nz, f0 * (1 + 0.05 * c), f1 * (1 - 0.05 * c), 1.4)
    out *= env[:, None]
    out /= np.abs(out).max() + 1e-9
    out *= 10 ** (level_db / 20)
    return int((end_t - length) * SR), out


def boom(t0: float, level_db: float) -> tuple[int, np.ndarray]:
    d = 3.0
    n = int(d * SR)
    t = np.arange(n) / SR
    f = 52 * np.exp(-t / 0.5) + 34
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.004))
    thump = rng.standard_normal(n) * np.exp(-t / 0.03)
    # 低通的噪音（一階 IIR）
    from scipy.signal import butter, sosfilt
    thump = sosfilt(butter(2, 180, 'lp', fs=SR, output='sos'), thump)
    y = body + 0.5 * thump / (np.abs(thump).max() + 1e-9)
    y /= np.abs(y).max()
    y *= 10 ** (level_db / 20)
    return int(t0 * SR), np.stack([y, y], 1)


def shimmer(t0: float, level_db: float) -> tuple[int, np.ndarray]:
    d = 4.5
    n = int(d * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    freqs = [1174.66, 1760.0, 2349.32, 2959.96, 3520.0, 4698.64, 5919.91]  # D6 A6 D7 F#7 A7 D8 F#8
    for i, f in enumerate(freqs):
        for c in range(2):
            det = f * (1 + rng.uniform(-0.002, 0.002))
            trem = 1 + 0.25 * np.sin(2 * np.pi * (5 + i * 0.7) * t + rng.uniform(0, 6.28))
            att = 1 - np.exp(-t / (0.01 + 0.012 * i))
            dec = np.exp(-t / (1.6 - i * 0.12))
            out[:, c] += np.sin(2 * np.pi * det * t + rng.uniform(0, 6.28)) * trem * att * dec / (1 + i * 0.35)
    # 閃爍顆粒
    from scipy.signal import butter, sosfilt
    grains = np.zeros((n, 2))
    for _ in range(60):
        s = int(rng.uniform(0, 2.2) ** 1.6 * SR)
        L = int(0.012 * SR)
        if s + L >= n:
            continue
        g = rng.standard_normal((L, 2)) * np.hanning(L)[:, None] * np.exp(-s / SR / 1.2)
        grains[s:s + L] += g
    grains = sosfilt(butter(4, [6000, 14000], 'bp', fs=SR, output='sos'), grains, axis=0)
    out += 0.35 * grains / (np.abs(grains).max() + 1e-9)
    out /= np.abs(out).max()
    out *= 10 ** (level_db / 20)
    return int(t0 * SR), out


def place(buf: np.ndarray, start: int, y: np.ndarray):
    s = max(0, start)
    y = y[s - start:]
    e = min(len(buf), s + len(y))
    buf[s:e] += y[: e - s]


def render_sfx():
    buf = np.zeros((N, 2))
    place(buf, *riser(bar_t(8), bar_t(1), -6, 400, 5000))
    place(buf, *riser(bar_t(20), bar_t(2), -4, 250, 7000))
    place(buf, *riser(bar_t(34), bar_t(1), -10, 500, 3500))
    place(buf, *riser(bar_t(40), bar_t(2), -2, 200, 9000))
    place(buf, *boom(bar_t(44), -9))
    place(buf, *shimmer(bar_t(47), -4))
    sf.write(f'{STEMS}/sfx.wav', buf.astype(np.float32), SR, subtype='FLOAT')


def render_revcym():
    """一下鈸（Orchestra Kit 49）反過來，尾巴對齊在拍點前 30 ms。"""
    import mido
    path = f'{OUT}/midi/_crash.mid'
    mid = mido.MidiFile(ticks_per_beat=480)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.Message('program_change', channel=9, program=48))
    tr.append(mido.Message('note_on', channel=9, note=49, velocity=110))
    tr.append(mido.Message('note_off', channel=9, note=49, velocity=0, time=480 * 8))
    tr.append(mido.Message('control_change', channel=9, control=7, value=100, time=480 * 8))
    mid.save(path)
    fluid(path, f'{OUT}/midi/_crash.wav', 0.5)
    c, _ = sf.read(f'{OUT}/midi/_crash.wav', dtype='float32', always_2d=True)
    env = np.abs(c).max(1)
    on = int(np.argmax(env > env.max() * 0.01))
    c = c[on:]
    buf = np.zeros((N, 2), np.float32)
    for bar, length_bars, level in [(20, 1, -14), (36, 1, -10), (40, 2, -3), (42, 1, -9)]:
        L = int(bar_t(length_bars) * SR)
        seg = c[:L][::-1].copy()
        if len(seg) < L:
            seg = np.vstack([np.zeros((L - len(seg), 2), np.float32), seg])
        fade = np.linspace(0, 1, L) ** 1.5
        seg *= fade[:, None]
        seg /= np.abs(seg).max() + 1e-9
        seg *= 10 ** (level / 20)
        end = int((bar_t(bar) - 0.03) * SR)
        place(buf, end - L, seg)
    sf.write(f'{STEMS}/revcym.wav', buf, SR, subtype='FLOAT')


def main():
    os.makedirs(STEMS, exist_ok=True)
    compose.main()
    # fluidsynth 各聲部
    for name in compose.T:
        mid = f'{OUT}/midi/{name}.mid'
        if not os.path.exists(mid):
            continue
        tmp = f'{STEMS}/_{name}.wav'
        fluid(mid, tmp, 0.5)
        x, sr = sf.read(tmp, dtype='float32', always_2d=True)
        assert sr == SR
        sf.write(f'{STEMS}/{name}.wav', fit(x), SR, subtype='FLOAT')
        os.remove(tmp)
        print(name, f'peak {20 * np.log10(np.abs(x).max() + 1e-12):.1f} dBFS', flush=True)
    # 鋼琴
    data = json.load(open(f'{OUT}/piano.json'))
    notes = [sampler.PianoNote(*n) for n in data['notes']]
    pedal = [tuple(p) for p in data['pedal']]
    y = sampler.render(notes, pedal, TOTAL + 2)
    sf.write(f'{STEMS}/piano.wav', fit(y), SR, subtype='FLOAT')
    print('piano', f'peak {20 * np.log10(np.abs(y).max()):.1f} dBFS', flush=True)
    render_sfx()
    render_revcym()
    print('done')


if __name__ == '__main__':
    main()
