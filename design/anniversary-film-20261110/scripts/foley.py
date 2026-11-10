"""擬音：跟著畫面格數合成的紙筆聲，混在配樂底下（很小聲，只補質感）。

- 鉛筆描線：每一站線稿揭露的那段時間，一筆一筆的沙沙聲（帶通雜訊＋紙纖維的細碎起伏），聲像偏向畫框那一側。
- 紙張飛過：相片飛到時間軸小相片的那 34 格，低通掃頻的「咻」，聲像跟著往左移。
- 翻頁：2006–2019 每張日常照片疊上來時一聲很短的紙片聲。
- 五校五聯屏：五張小相片升起時各一聲輕輕的紙聲。

時間全部來自 film/film.js 的 ST（各站）與固定格數；輸出 output/anniversary-film/music/foley.wav，
再由 mix_final.py 和 score-master.wav 混成最後的聲音。

    python3 foley.py [--vertical]
"""
from __future__ import annotations

import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'output', 'anniversary-film', 'music'))
SR, FPS, DUR = 48000, 30, 144.0
VERT = '--vertical' in sys.argv
rng = np.random.default_rng(30)

# 與 film.js 的 ST 一致（格數）
ST = {
    'yihua': dict(ink=(214, 330), fly=(606, 640)),
    'minghua': dict(ink=(640, 690), fly=(766, 800)),
    'chongde': dict(ink=(800, 850), fly=(926, 960)),
    'international': dict(ink=(1120, 1170), fly=(1246, 1280)),
    'renwu': dict(ink=(1280, 1330), fly=(1406, 1440)),
}
N = int(DUR * SR)
L = np.zeros(N)
R = np.zeros(N)


def t2s(frame):
    return int(round(frame / FPS * SR))


def db(x):
    return 10 ** (x / 20)


def bandnoise(n, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, rng.standard_normal(n + 2000))[2000:]


def place(sig, start, pan):
    """pan -1（左）~ +1（右），等功率"""
    a = (pan + 1) * np.pi / 4
    s0 = max(0, start)
    e = min(N, start + len(sig))
    if e <= s0:
        return
    seg = sig[s0 - start:e - start]
    L[s0:e] += seg * np.cos(a)
    R[s0:e] += seg * np.sin(a)


def pencil(f0, f1, pan):
    """一段鉛筆描線：多個長短不一的筆畫，彼此略有空隙。"""
    t = t2s(f0)
    end = t2s(f1)
    while t < end:
        dur = int(SR * rng.uniform(0.07, 0.26))
        x = bandnoise(dur, 1800, 7000)
        # 紙纖維：40–90 Hz 的隨機起伏
        grain = 1 + 0.6 * signal.sosfilt(signal.butter(2, [30, 90], btype='band', fs=SR, output='sos'), rng.standard_normal(dur)) * 3
        env = np.sin(np.linspace(0, np.pi, dur)) ** 0.7
        stroke = x * grain * env
        stroke /= np.sqrt(np.mean(stroke ** 2)) + 1e-9
        place(stroke * db(-38 + rng.uniform(-3, 2)), t, pan + rng.uniform(-0.12, 0.12))
        t += dur + int(SR * rng.uniform(0.02, 0.09))


def whoosh(f0, f1, pan0, pan1, level=-33):
    n = t2s(f1) - t2s(f0)
    x = rng.standard_normal(n + 4000)
    # 時變低通：6 kHz → 700 Hz（分段處理）
    out = np.zeros(n)
    blk = 512
    zi = None
    for i in range(0, n, blk):
        p = i / n
        fc = 6000 * (1 - p) + 700 * p
        sos = signal.butter(2, fc, btype='low', fs=SR, output='sos')
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        y, zi = signal.sosfilt(sos, x[i:i + blk], zi=zi)
        out[i:i + len(y)] = y[:min(blk, n - i)]
    env = np.sin(np.linspace(0, np.pi, n)) ** 1.6
    out = out * env
    out /= np.sqrt(np.mean(out ** 2)) + 1e-9
    a0 = t2s(f0)
    for i in range(0, n, blk):  # 聲像跟著移動
        pan = pan0 + (pan1 - pan0) * (i / n)
        place(out[i:i + blk] * db(level), a0 + i, pan)


def flick(frame, pan, level=-37):
    n = int(SR * 0.05)
    x = bandnoise(n, 2500, 9000, 2)
    env = np.exp(-np.linspace(0, 9, n))
    s = x * env
    s /= np.sqrt(np.mean(s ** 2)) + 1e-9
    place(s * db(level), t2s(frame), pan)


def main():
    frame_pan = 0.0 if VERT else 0.35  # 畫框在右半邊（直式在中間）
    for k, t in ST.items():
        pencil(*t['ink'], frame_pan)
        whoosh(*t['fly'], frame_pan, -0.2 if VERT else -0.55)
    for i in range(14):
        flick(960 + i * 10 + 1, frame_pan + rng.uniform(-0.1, 0.1))
    for i in range(5):
        whoosh(1440 + i * 5, 1478 + i * 5, -0.6 + i * 0.3, -0.6 + i * 0.3, level=-38)
    # 收尾的柔和衰減，避免任何殘留
    st = np.stack([L, R], 1)
    # 3 kHz 附近略收，讓擬音更像在紙上而不是嘶聲
    sos = signal.butter(2, 9000, btype='low', fs=SR, output='sos')
    st = signal.sosfilt(sos, st, axis=0)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'foley-v.wav' if VERT else 'foley.wav')
    sf.write(path, st.astype(np.float32), SR, subtype='FLOAT')
    pk = 20 * np.log10(np.abs(st).max() + 1e-12)
    print(path, f'peak {pk:.1f} dBFS')


if __name__ == '__main__':
    main()
