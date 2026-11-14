"""混音與母帶：各聲部 EQ／音量／聲像寬度 → 合成的音樂廳殘響 → 匯流排壓縮 → 真峰值限幅 → -14 LUFS。

音量不是手調數字，而是「在指定段落裡，這個聲部比鋼琴小幾 LU」（BALANCE），由程式量 K 加權響度後換算增益；
這樣改了編曲、重新渲染，平衡也跟著對。

用法：nice -n 5 python3 mix.py   （先跑 render.py）
輸出：score-master.wav（24-bit）、score-master.json、groups/*.wav、analysis/*.png
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import ndimage, signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose  # noqa: E402

SR = 48000
OUT = compose.OUT
STEMS = f'{OUT}/stems'
TOTAL = 144.0
N = int(TOTAL * SR)
BAR = 8 / 3
TARGET_LUFS = -14.0
CEILING_DBTP = -1.2
meter = pyln.Meter(SR)


def bars(a, b):
    return slice(int(a * BAR * SR), int(b * BAR * SR))


# ── EQ（RBJ biquad） ────────────────────────────────────────────────────
def _sos(b, a):
    return np.hstack([b / a[0], a / a[0]])[None, :]


def hp(f, q=0.707):
    return signal.butter(2, f, 'hp', fs=SR, output='sos')


def lp(f):
    return signal.butter(2, f, 'lp', fs=SR, output='sos')


def peak(f, g, q=1.0):
    A = 10 ** (g / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w), 1 - al / A])
    return _sos(b, a)


def shelf(f, g, high=True, s=0.8):
    A = 10 ** (g / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / 2 * np.sqrt((A + 1 / A) * (1 / s - 1) + 2)
    c = np.cos(w)
    sq = 2 * np.sqrt(A) * al
    if high:
        b = np.array([A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)])
        a = np.array([(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq])
    else:
        b = np.array([A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)])
        a = np.array([(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq])
    return _sos(b, a)


def eq(x, chain):
    if not chain:
        return x
    sos = np.vstack(chain)
    return signal.sosfilt(sos, x, axis=0)


VIOLIN_EQ = [hp(110), peak(450, -1.0, 1.0), peak(2800, -2.0, 0.9), shelf(8000, -0.5)]
STEMS_CFG = {
    #  名稱       EQ                                                     寬度  殘響送出
    'piano':   ([hp(32), shelf(80, -1.5, high=False), peak(280, -2.5, 1.0), peak(1200, -0.8, 1.2), shelf(9500, 1.0)], 0.92, 0.20),
    'vln1':    (VIOLIN_EQ, 1.0, 0.42),
    'vln1mel': (VIOLIN_EQ, 1.0, 0.36),
    'vln2':    (VIOLIN_EQ, 1.0, 0.42),
    'vla':     ([hp(90), peak(400, -1.0, 1.0), peak(2600, -1.5, 0.9), shelf(8000, -1.5)], 1.0, 0.42),
    'vc':      ([hp(45), peak(250, -1.5, 1.0), peak(2500, -1.0, 1.0)], 1.0, 0.38),
    'cb':      ([hp(30), lp(3500)], 1.0, 0.30),
    'pizz':    ([hp(90), peak(3000, -1.5, 1.0)], 1.0, 0.32),
    'vcpizz':  ([hp(45)], 1.0, 0.28),
    'harp':    ([hp(70), peak(2500, -1.0, 1.0)], 1.0, 0.42),
    'celesta': ([hp(350), shelf(10000, -1.0)], 1.0, 0.48),
    'glock':   ([hp(400), shelf(10000, -2.0)], 1.0, 0.48),
    'timp':    ([hp(32), peak(110, 1.0, 1.0)], 1.0, 0.32),
    'horns':   ([hp(70), peak(2400, -2.0, 1.0), lp(7000)], 1.0, 0.42),
    'perc':    ([hp(35)], 1.0, 0.18),
    'revcym':  ([hp(250)], 1.0, 0.25),
    'sfx':     ([hp(25)], 1.15, 0.30),
}
GROUPS = {
    'piano': ['piano'],
    'strings': ['vln1', 'vln1mel', 'vln2', 'vla', 'vc', 'cb'],
    'colour': ['pizz', 'vcpizz', 'harp', 'celesta', 'glock', 'horns'],
    'percussion': ['timp', 'perc', 'revcym'],
    'sfx': ['sfx'],
}
# 平衡：（參考段落起訖小節，比鋼琴小/大幾 LU）。弦樂各部先依 STRING_TRIM 組內平衡，再整組對鋼琴。
STRING_TRIM = {'vln1': -1.0, 'vln2': 0.0, 'vla': -0.5, 'vc': 0.0, 'cb': -4.5}
STRINGS_REF = ((36, 44), -0.5)
BALANCE = {
    'vln1mel': ((28, 34), -4.0),
    'pizz':    ((28, 34), -13.0),
    'vcpizz':  ((20, 28), -12.0),
    'harp':    ((28, 34), -12.0),
    'celesta': ((28, 34), -15.0),
    'glock':   ((45, 48), -6.0),
    'timp':    ((39, 41), -4.0),
    'horns':   ((36, 44), -9.0),
    'perc':    ((36, 44), -10.0),
    'revcym':  ((39, 40), -7.0),
    'sfx':     ((38, 40), -9.0),
}


def lufs(x):
    try:
        v = meter.integrated_loudness(x)
    except ValueError:
        return -120.0
    return v if np.isfinite(v) else -120.0


def width(x, w):
    if abs(w - 1) < 1e-6:
        return x
    m = (x[:, 0] + x[:, 1]) / 2
    s = (x[:, 0] - x[:, 1]) / 2 * w
    return np.stack([m + s, m - s], 1)


# ── 殘響 IR（合成的音樂廳） ────────────────────────────────────────────
def hall_ir(rt60=2.2, predelay=0.02, length=3.2, seed=7):
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    bands = [(20, 250, rt60 * 1.15), (250, 2000, rt60), (2000, 6000, rt60 * 0.72), (6000, 20000, rt60 * 0.45)]
    ir = np.zeros((n, 2))
    for c in range(2):
        for lo, hi, rt in bands:
            nz = rng.standard_normal(n)
            sos = signal.butter(4, [lo, min(hi, SR / 2 - 100)], 'bp', fs=SR, output='sos')
            nz = signal.sosfilt(sos, nz)
            ir[:, c] += nz * np.exp(-6.91 * t / rt)
    # 起音稍微淡入（擴散）
    ir *= (1 - np.exp(-t / 0.012))[:, None]
    # 早期反射
    for d, g, pan in [(0.011, 0.55, -0.6), (0.017, 0.45, 0.5), (0.023, 0.4, -0.2), (0.031, 0.35, 0.7),
                      (0.043, 0.3, -0.8), (0.057, 0.25, 0.3), (0.071, 0.2, -0.4)]:
        k = int(d * SR)
        ir[k, 0] += g * (1 - pan) / 2 * 6
        ir[k, 1] += g * (1 + pan) / 2 * 6
    pd = int(predelay * SR)
    ir = np.vstack([np.zeros((pd, 2)), ir])[:n]
    ir /= np.sqrt((ir ** 2).sum(0).mean())
    return ir


def reverb(x, ir):
    return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)


# ── 動態 ────────────────────────────────────────────────────────────────
def compressor(x, thresh_db, ratio=2.0, knee=6.0, attack=0.025, release=0.3):
    mono = np.sqrt((x ** 2).mean(1))
    # RMS 偵測（10 ms）
    win = int(0.01 * SR)
    rms = np.sqrt(ndimage.uniform_filter1d(mono ** 2, win) + 1e-12)
    lvl = 20 * np.log10(rms)
    over = lvl - thresh_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    # 攻擊／釋放：對 gain reduction 做非對稱平滑（先用 release 的 cummax 技巧，再 attack 低通）
    k = 1.0 / (release * SR) * 20  # dB/sample 下降速度近似
    idx = np.arange(len(gr))
    env = -idx * k + np.maximum.accumulate(gr + idx * k)
    b, a = signal.butter(1, 1 / (2 * np.pi * attack) / (SR / 2))
    env = signal.filtfilt(b, a, env)
    env = np.maximum(env, 0)
    return x * (10 ** (-env / 20))[:, None], env


def true_peak_env(x, os_factor=4):
    up = signal.resample_poly(x, os_factor, 1, axis=0)
    pk = np.abs(up).max(1)
    pk = pk[: len(x) * os_factor].reshape(len(x), os_factor).max(1)
    return pk


def limiter(x, ceiling_db=CEILING_DBTP, lookahead=0.004, release_db_per_s=60.0):
    pk = true_peak_env(x)
    req = np.maximum(0, 20 * np.log10(pk + 1e-12) - ceiling_db)
    L = int(lookahead * SR)
    att = ndimage.maximum_filter1d(req, size=L, origin=-(L // 2))  # 往前看 L
    k = release_db_per_s / SR
    idx = np.arange(len(att))
    env = -idx * k + np.maximum.accumulate(att + idx * k)
    env = ndimage.uniform_filter1d(env, size=L, origin=(L - 1) // 2)  # 往後平均 → 平滑起音
    env = np.maximum(env, 0)
    return x * (10 ** (-env / 20))[:, None], env


def tp_db(x):
    return 20 * np.log10(true_peak_env(x).max() + 1e-12)


# ── 主流程 ──────────────────────────────────────────────────────────────
# 起音慢的取樣整軌提前（track delay 補償）：弦樂 Slow 到 -20 dB 要約 100 ms、Fast 約 28 ms
ADVANCE_MS = {'vln1': 90, 'vln2': 90, 'vla': 90, 'vc': 90, 'cb': 90, 'vln1mel': 45, 'horns': 40, 'pizz': 6, 'vcpizz': 8}


def load(name):
    x, sr = sf.read(f'{STEMS}/{name}.wav', dtype='float64', always_2d=True)
    assert sr == SR
    adv = int(ADVANCE_MS.get(name, 0) / 1000 * SR)
    if adv:
        x = np.vstack([x[adv:], np.zeros((adv, 2))])
    x = x[:N] if len(x) >= N else np.vstack([x, np.zeros((N - len(x), 2))])
    assert np.isfinite(x).all(), name
    return x


def main():
    os.makedirs(f'{OUT}/groups', exist_ok=True)
    os.makedirs(f'{OUT}/analysis', exist_ok=True)
    proc = {}
    for name, (chain, w, _) in STEMS_CFG.items():
        x = load(name)
        if np.abs(x).max() < 1e-6:
            raise SystemExit(f'空的聲部：{name}')
        proc[name] = width(eq(x, chain), w)

    gains = {'piano': 0.0}
    piano_l = {}

    def piano_in(a, b):
        if (a, b) not in piano_l:
            piano_l[(a, b)] = lufs(proc['piano'][bars(a, b)])
        return piano_l[(a, b)]

    # 弦樂組
    for n, trim in STRING_TRIM.items():
        gains[n] = trim
    (a, b), rel = STRINGS_REF
    sgrp = sum(proc[n] * 10 ** (gains[n] / 20) for n in STRING_TRIM)
    g = piano_in(a, b) + rel - lufs(sgrp[bars(a, b)])
    for n in STRING_TRIM:
        gains[n] += g
    for n, ((a, b), rel) in BALANCE.items():
        gains[n] = piano_in(a, b) + rel - lufs(proc[n][bars(a, b)])

    ir = hall_ir()
    dry = np.zeros((N, 2))
    send = np.zeros((N, 2))
    groups = {k: np.zeros((N, 2)) for k in GROUPS}
    group_of = {n: g for g, ns in GROUPS.items() for n in ns}
    for name, x in proc.items():
        y = x * 10 ** (gains[name] / 20)
        dry += y
        send += y * STEMS_CFG[name][2]
        groups[group_of[name]] += y
    wet = reverb(send, ir)
    wet = eq(wet, [hp(120), shelf(7000, -1.0)])
    mix = dry + wet
    # 分組 stem：殘響依各組送出量分攤（給剪接師重新平衡用）
    for gname, ns in GROUPS.items():
        gs = sum(proc[n] * 10 ** (gains[n] / 20) * STEMS_CFG[n][2] for n in ns)
        groups[gname] = groups[gname] + eq(reverb(gs, ir), [hp(120), shelf(7000, -1.0)])

    # 先粗調到 -16 LUFS，再壓縮、限幅、精調
    pre = TARGET_LUFS - 2 - lufs(mix)
    mix *= 10 ** (pre / 20)
    for k in groups:
        groups[k] *= 10 ** (pre / 20)
    integ = lufs(mix)
    mix, gr = compressor(mix, integ + 3.0, ratio=2.4, attack=0.03, release=0.35)
    for k in groups:
        groups[k] *= (10 ** (-gr / 20))[:, None]
    mix = eq(mix, [hp(26), shelf(100, -1.5, high=False), shelf(11000, 0.5)])

    # 結尾淡出（最後 2 秒）
    fade = np.ones(N)
    fl = int(2.0 * SR)
    fade[-fl:] = np.cos(np.linspace(0, np.pi / 2, fl)) ** 2
    mix *= fade[:, None]

    final_gain = 0.0
    for _ in range(6):
        y = mix * 10 ** (final_gain / 20)
        y, lim = limiter(y)
        L = lufs(y)
        if abs(L - TARGET_LUFS) < 0.1:
            break
        final_gain += TARGET_LUFS - L
    # 最後保險：若真峰值仍超過，整體再降
    tp = tp_db(y)
    if tp > CEILING_DBTP + 0.05:
        y *= 10 ** ((CEILING_DBTP - tp) / 20)
        tp = tp_db(y)
    L = lufs(y)

    assert np.isfinite(y).all()
    sf.write(f'{OUT}/score-master.wav', y.astype(np.float32), SR, subtype='PCM_24')
    for k, g in groups.items():
        sf.write(f'{OUT}/groups/{k}.wav', (g * fade[:, None] * 10 ** (final_gain / 20)).astype(np.float32),
                 SR, subtype='PCM_24')

    report = analyse(y, lim)
    report['gains_db'] = {k: round(v, 2) for k, v in gains.items()}
    report['integrated_lufs'] = round(L, 2)
    report['true_peak_dbtp'] = round(tp, 2)
    report['limiter_max_gr_db'] = round(float(lim.max()), 2)
    report['bus_comp_max_gr_db'] = round(float(gr.max()), 2)
    hits = json.load(open(f'{OUT}/hits.json'))
    report.update(hits)
    with open(f'{OUT}/score-master.json', 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k not in ('hits',)}, ensure_ascii=False, indent=1))


# ── 檢查 ────────────────────────────────────────────────────────────────
def onset_times(y, hits):
    """在每個提示點 ±60 ms 內找音頭：高頻（>1.5 kHz）包絡上升最快的位置。"""
    mono = y.mean(1)
    hf = signal.sosfilt(signal.butter(4, 1500, 'hp', fs=SR, output='sos'), mono)
    env = np.sqrt(ndimage.uniform_filter1d(hf ** 2, int(0.002 * SR)) + 1e-12)
    env_db = 20 * np.log10(env)
    d = np.diff(ndimage.uniform_filter1d(env_db, int(0.003 * SR)), prepend=env_db[0])
    res = []
    for h in hits:
        t = h['time']
        if t <= 0.0 or t >= TOTAL - 0.1:
            continue
        a, b = int((t - 0.06) * SR), int((t + 0.06) * SR)
        i = a + int(np.argmax(d[a:b]))
        # 前 3 ms 開始上升的點
        res.append({'label': h['label'], 'expected': t, 'onset': round(i / SR, 4), 'error_ms': round((i / SR - t) * 1000, 1)})
    return res


HIT_STEMS = [('開場', 'piano'), ('2001', 'celesta'), ('2005', 'celesta'), ('滴答', 'pizz'), ('2020', 'celesta'),
             ('2021', 'celesta'), ('五校', 'timp'), ('第三幕', 'timp'), ('第四幕', 'piano'), ('升到', 'timp'),
             ('高潮', 'perc'), ('片名', 'perc'), ('收回', 'perc'), ('星星', 'celesta'), ('緞帶', 'glock'), ('最後', 'piano')]


def stem_onsets(hits):
    """用負責那個提示點的聲部（未混音的 stem）量音頭。"""
    cache = {}
    res = []
    for h in hits:
        stem = next((s for k, s in HIT_STEMS if k in h['label']), None)
        if stem is None or h['time'] >= TOTAL - 0.1:
            continue
        if stem not in cache:
            x = load(stem)  # 含整軌提前的補償
            m = x.mean(1)
            if stem == 'piano':  # 低音的波形週期比 1 ms 長，用琴槌敲擊的高頻來量
                m = signal.sosfilt(signal.butter(4, 400, 'hp', fs=SR, output='sos'), m)
            env = np.sqrt(ndimage.uniform_filter1d(m ** 2, int(0.001 * SR)) + 1e-14)
            cache[stem] = 20 * np.log10(env)
        e = cache[stem]
        t = h['time']
        a, c, b = int(max(0, t - 0.08) * SR), int(max(0, t - 0.015) * SR), int((t + 0.12) * SR)
        pre = e[a:c].max() if c > a else -140.0
        pk = e[c:b].max()
        # 兩個指標都只會比真正的起點晚，取較早的那個：
        # (1) 包絡（dB，2 ms 平滑）上升最陡的一刻；(2) 比之前高 6 dB 且離峰值 20 dB 內的第一刻
        c0 = max(0, c - 96)
        sm = ndimage.uniform_filter1d(e[c0:b], 96)
        slope = np.diff(sm)[c - c0:]
        i1 = c + int(np.argmax(slope))
        i2 = c + int(np.argmax(e[c:b] >= max(pre + 6, pk - 20)))
        i = min(i1, i2)
        masked = pk - pre < 6
        res.append({'label': h['label'], 'stem': stem, 'expected': t, 'onset': round(i / SR, 4),
                    'error_ms': None if masked else round((i / SR - t) * 1000, 1), 'rise_db': round(pk - pre, 1),
                    'note': '前面有漸強滾奏／延音蓋住，量不到獨立的音頭' if masked else ''})
    return res


def analyse(y, lim):
    out = {}
    blocks = []
    for b in range(0, 54, 4):
        seg = y[bars(b, min(54, b + 4))]
        blocks.append({'bars': f'{b}-{min(54, b + 4) - 1}', 'lufs': round(lufs(seg), 1),
                       'peak_dbfs': round(20 * np.log10(np.abs(seg).max() + 1e-12), 1)})
    out['blocks'] = blocks
    out['clipped_samples'] = int((np.abs(y) >= 0.999).sum())
    hits = json.load(open(f'{OUT}/hits.json'))['hits']
    on = stem_onsets(hits)
    out['onsets'] = on
    out['onset_max_abs_error_ms'] = max(abs(o['error_ms']) for o in on if o['error_ms'] is not None)
    out['onsets_in_mix'] = onset_times(y, hits)
    # 頻譜平衡（整段平均，八度頻帶）
    f, P = signal.welch(y.mean(1), SR, nperseg=8192)
    bands = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 5000), (5000, 10000), (10000, 20000)]
    tot = P.sum()
    out['spectrum_share_db'] = {f'{a}-{b}': round(10 * np.log10(P[(f >= a) & (f < b)].sum() / tot + 1e-12), 1) for a, b in bands}
    draw(y, lim)
    return out


def draw(y, lim):
    from PIL import Image, ImageDraw
    W, H = 1800, 420
    mono = y.mean(1)
    # 波形
    img = Image.new('RGB', (W, H + 60), (16, 20, 18))
    d = ImageDraw.Draw(img)
    per = len(mono) // W
    seg = np.abs(mono[: per * W]).reshape(W, per)
    pk = seg.max(1)
    rms = np.sqrt((mono[: per * W].reshape(W, per) ** 2).mean(1))
    for x in range(W):
        d.line([(x, H / 2 - pk[x] * H / 2), (x, H / 2 + pk[x] * H / 2)], fill=(70, 120, 90))
        d.line([(x, H / 2 - rms[x] * H / 2), (x, H / 2 + rms[x] * H / 2)], fill=(150, 220, 170))
    lim_px = lim[: per * W].reshape(W, per).max(1)
    for x in range(W):
        if lim_px[x] > 0.05:
            d.line([(x, H), (x, H - min(40, lim_px[x] * 10))], fill=(220, 90, 60))
    for b in range(55):
        x = int(b * BAR / TOTAL * W)
        d.line([(x, H), (x, H + (14 if b % 4 == 0 else 6))], fill=(200, 200, 200))
        if b % 4 == 0:
            d.text((x + 2, H + 16), str(b), fill=(220, 220, 220))
    d.text((6, H + 36), 'waveform (peak / rms) · red = limiter gain reduction · numbers = bar', fill=(200, 200, 200))
    img.save(f'{OUT}/analysis/waveform.png')
    # 頻譜圖（對數頻率）
    f, t, Z = signal.stft(mono, SR, nperseg=4096, noverlap=4096 - 1024)
    mag = 20 * np.log10(np.abs(Z) + 1e-9)
    fl = np.geomspace(30, 20000, 360)
    rows = np.array([mag[np.argmin(np.abs(f - ff))] for ff in fl])[::-1]
    cols = np.linspace(0, rows.shape[1] - 1, W).astype(int)
    rows = rows[:, cols]
    v = np.clip((rows + 100) / 80, 0, 1)
    rgb = np.stack([np.clip(v * 2.2 - 0.9, 0, 1), np.clip(v * 1.6 - 0.2, 0, 1) * 0.9, np.clip(0.4 + v - v ** 2 * 1.2, 0, 1)], -1)
    im = Image.fromarray((rgb * 255).astype(np.uint8)).resize((W, 520))
    canvas = Image.new('RGB', (W + 70, 560), (10, 10, 10))
    canvas.paste(im, (70, 0))
    d = ImageDraw.Draw(canvas)
    for hz in [50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000]:
        yy = int((1 - np.log(hz / 30) / np.log(20000 / 30)) * 520)
        d.line([(60, yy), (70, yy)], fill=(255, 255, 255))
        d.text((2, yy - 6), f'{hz}', fill=(255, 255, 255))
    for b in range(0, 55, 4):
        x = 70 + int(b * BAR / TOTAL * W)
        d.text((x, 530), str(b), fill=(255, 255, 255))
    canvas.save(f'{OUT}/analysis/spectrogram.png')


if __name__ == '__main__':
    main()
