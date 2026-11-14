"""音效：跟著第一、二幕〈星圖〉的畫面格數合成的光與空氣的聲音，混在配樂底下（只補質感）。

2026-11-11 加上「三十年的星環」之後多了：開場從整圈星環推進到義華的那一段空氣聲、2022–2026 五顆年份星連續亮起的
上行鐘聲（D 大調五聲音階，接第 18 小節的 Gadd9）、星環合起來時繞一圈的細碎閃光、流星的短促氣聲。
點亮的鐘聲音高也改成都在調上（原本崇德、仁武與第 18 小節各有一個調外音）。

- 聚光：開場光往義華聚，一層很輕、慢慢升高的高頻氣聲，夾著零星的細小閃光聲。
- 點亮：每顆星點亮的那一格（320／640／800／1120／1280），鐘聲般的非諧波泛音＋一道亮的氣流，聲像在星的位置。
- 光窗：張開時往上掃的空氣聲，收回時往下掃。
- 移動：鏡頭在星與星之間移動時，低通掃頻的「咻」，聲像跟著移動方向。
- 星軌：2006–2019 一層繞著左右轉的氣流，每顆記憶光球一聲很短的閃光。
- 第 18 小節：五顆星一起亮時，一陣散在左右的細碎閃光。
- 衝進明華那顆星：往上推的風聲接進白光。

時間與 film/sky.js 一致。輸出 output/anniversary-film/music/foley(.wav|-v.wav)，再由 mix_final.py 與配樂相加。

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
rng = np.random.default_rng(1997)

# 與 sky.js 一致（格數）
IGN = {'yihua': 320, 'minghua': 640, 'chongde': 800, 'international': 1120, 'renwu': 1280}
CLOSE = {'yihua': (558, 586), 'minghua': (738, 764), 'chongde': (904, 932), 'international': (1226, 1254), 'renwu': (1386, 1414)}
TRAVEL = [(588, 640), (762, 800), (930, 962), (1092, 1122), (1252, 1282), (1412, 1446)]
RING_RUN = [1416, 1421, 1426, 1431, 1436]  # 2022–2026 的年份星（sky.js 的 SKY_RING_LIT）
RING_CLOSE = 1440
METEORS = [1456, 1466, 1481, 1495, 1507, 1522, 1537]  # 流星起點（和 sky.js 同一顆亂數種子算出來的）
STAR_PAN = 0.0 if VERT else 0.37  # 星在畫面上的水平位置（橫式偏右）

N = int(DUR * SR)
L = np.zeros(N)
R = np.zeros(N)


def t2s(frame):
    return int(round(frame / FPS * SR))


def db(x):
    return 10 ** (x / 20)


def norm(x):
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-12)


def bandnoise(n, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, rng.standard_normal(n + 4000))[4000:]


def place(sig, start, pan):
    pan = float(np.clip(pan, -1, 1))
    a = (pan + 1) * np.pi / 4
    s0 = max(0, start)
    e = min(N, start + len(sig))
    if e <= s0:
        return
    seg = sig[s0 - start:e - start]
    L[s0:e] += seg * np.cos(a)
    R[s0:e] += seg * np.sin(a)


def place_moving(sig, start, pan0, pan1):
    blk = 1024
    n = len(sig)
    for i in range(0, n, blk):
        place(sig[i:i + blk], start + i, pan0 + (pan1 - pan0) * (i / n))


def sweep_noise(n, f0, f1, kind='low', q_order=2):
    """時變濾波的雜訊：截止頻率由 f0 指數掃到 f1"""
    x = rng.standard_normal(n + 2048)
    out = np.zeros(n)
    blk = 512
    zi = None
    for i in range(0, n, blk):
        p = i / max(1, n - 1)
        fc = f0 * (f1 / f0) ** p
        sos = signal.butter(q_order, min(fc, SR / 2 - 200), btype=kind, fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        y, zi = signal.sosfilt(sos, x[i:i + blk], zi=zi)
        out[i:i + len(y)] = y[:min(blk, n - i)]
    return out


def bell(freq, dur, detune=0.003):
    """非諧波泛音的鐘聲（像玻璃或鋼片琴，但更散）"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, dec in ((1.0, 1.0, 1.6), (2.76, 0.55, 1.0), (5.40, 0.32, 0.6), (8.93, 0.18, 0.35), (13.34, 0.08, 0.2)):
        f = freq * ratio * (1 + rng.uniform(-detune, detune))
        out += amp * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / dec)
    att = np.minimum(1, t / 0.004)
    return out * att


def glint(freq, dur=0.09):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t / (dur / 4)) * np.minimum(1, t / 0.002)


def env_sine(n, power=1.5):
    return np.sin(np.linspace(0, np.pi, n)) ** power


def main():
    # 開場：從整圈星環推進到義華的位置（f150–300），一道很慢、往上開的空氣聲
    a, b = t2s(150), t2s(300)
    n = b - a
    place_moving(norm(sweep_noise(n, 500, 4200, 'low')) * env_sine(n, 1.6) * db(-41), a, -0.3 if not VERT else 0.0, STAR_PAN)

    # 聚光（f40–318）
    a, b = t2s(40), t2s(318)
    n = b - a
    air = norm(bandnoise(n, 3000, 9000, 2)) * np.linspace(0, 1, n) ** 2.2
    place(air * db(-44), a, STAR_PAN)
    for _ in range(26):
        f = rng.uniform(60, 316)
        place(norm(glint(rng.uniform(3800, 7200))) * db(-46 + 6 * (f / 316)), t2s(f), STAR_PAN + rng.uniform(-0.4, 0.3))

    for k, g in IGN.items():
        # 點亮：鐘聲＋亮的氣流＋很輕的低頻
        base = {'yihua': 1568.0, 'minghua': 1760.0, 'chongde': 1479.98, 'international': 1975.53, 'renwu': 2349.32}[k]  # G6 A6 F♯6 B6 D7
        bl = bell(base, 3.2)
        place(norm(bl) * db(-37), t2s(g), STAR_PAN)
        hiss = norm(bandnoise(int(0.9 * SR), 4000, 14000, 2)) * np.exp(-np.arange(int(0.9 * SR)) / (0.18 * SR))
        place(hiss * db(-39), t2s(g), STAR_PAN)
        t = np.arange(int(0.6 * SR)) / SR
        thump = np.sin(2 * np.pi * 72 * t) * np.exp(-t / 0.16) * np.minimum(1, t / 0.01)
        place(norm(thump) * db(-44), t2s(g), 0.0)
        # 光窗張開（上掃）與收回（下掃）
        o0, o1 = t2s(g + 6), t2s(g + 40)
        place(norm(sweep_noise(o1 - o0, 900, 7000, 'low')) * env_sine(o1 - o0) * db(-41), o0, STAR_PAN)
        c0, c1 = t2s(CLOSE[k][0]), t2s(CLOSE[k][1])
        place(norm(sweep_noise(c1 - c0, 6000, 700, 'low')) * env_sine(c1 - c0) * db(-40), c0, STAR_PAN)

    # 鏡頭移動
    for f0, f1 in TRAVEL:
        a, b = t2s(f0), t2s(f1)
        sig = norm(sweep_noise(b - a, 5200, 600, 'low')) * env_sine(b - a, 1.4)
        place_moving(sig * db(-35), a, -0.5 if not VERT else -0.2, 0.5 if not VERT else 0.2)

    # 星軌（962–1092）：繞著左右轉的氣流
    a, b = t2s(962), t2s(1092)
    n = b - a
    swirl = norm(bandnoise(n, 500, 4000, 2)) * env_sine(n, 1.0)
    lfo = np.sin(2 * np.pi * 0.55 * np.arange(n) / SR)
    blk = 1024
    for i in range(0, n, blk):
        place(swirl[i:i + blk] * db(-40), a + i, 0.7 * lfo[i])
    for i in range(14):
        place(norm(glint(rng.uniform(4200, 6400), 0.12)) * db(-42), t2s(960 + i * 10 + 1), rng.uniform(-0.6, 0.6))

    # 第 18 小節前一拍：2022–2026 五顆年份星連續亮起，一個十六分音符一聲、一路往上（D E G A B）
    for i, (f, hz) in enumerate(zip(RING_RUN, (1174.66, 1318.51, 1567.98, 1760.0, 1975.53))):
        place(norm(bell(hz, 1.4)) * db(-41 + i), t2s(f), -0.5 + 0.25 * i if not VERT else 0.0)
        place(norm(glint(hz * 2, 0.08)) * db(-45), t2s(f), -0.5 + 0.25 * i if not VERT else 0.0)

    # 第 18 小節：星環合起來、五顆星一起亮
    for _ in range(40):
        f = RING_CLOSE + rng.uniform(0, 18)
        place(norm(glint(rng.uniform(3000, 8000), 0.1)) * db(-43), t2s(f), rng.uniform(-0.9, 0.9))
    place(norm(bell(1174.66, 3.5)) * db(-39), t2s(RING_CLOSE), 0.0)   # D6（Gadd9 的五音）
    place(norm(bell(2349.32, 2.4)) * db(-43), t2s(RING_CLOSE), 0.0)   # D7
    # 一道光順時針跑一圈（30 格）：一格一顆很小的閃光，音高慢慢往上，聲像繞一圈
    for i in range(30):
        ang = 2 * np.pi * i / 30
        place(norm(glint(3200 + 110 * i + rng.uniform(-80, 80), 0.07)) * db(-46), t2s(RING_CLOSE + i), (0.7 if not VERT else 0.4) * np.sin(ang))
    # 流星：很短的往下掃的氣聲
    for f in METEORS:
        n = int(0.42 * SR)
        place(norm(sweep_noise(n, 7000, 1500, 'low')) * env_sine(n, 2.0) * db(-45), t2s(f), rng.uniform(0.1, 0.8) if not VERT else rng.uniform(-0.5, 0.5))

    # 衝進明華那顆星（1556–1600）
    a, b = t2s(1556), t2s(1601)
    n = b - a
    rise = norm(sweep_noise(n, 400, 9000, 'low')) * np.linspace(0, 1, n) ** 2.5
    place(rise * db(-31), a, 0.0)
    t = np.arange(n) / SR
    fr = 260 * (3200 / 260) ** (t / t[-1])
    whine = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.linspace(0, 1, n) ** 3
    place(norm(whine) * db(-46), a, 0.0)

    st = np.stack([L, R], 1)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'foley-v.wav' if VERT else 'foley.wav')
    sf.write(path, st.astype(np.float32), SR, subtype='FLOAT')
    pk = 20 * np.log10(np.abs(st).max() + 1e-12)
    print(path, f'peak {pk:.1f} dBFS')


if __name__ == '__main__':
    main()
