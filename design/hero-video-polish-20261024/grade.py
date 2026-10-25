#!/usr/bin/env python3
"""首屏影片第二版調色（2026-10-24）：每鏡一個 3D LUT，取代 10-20 的 soft-light 提亮。

10-20 版的白色 soft-light 曲線把黑位一起抬高（L* 9 → 23），整支片蒙一層灰霧；鏡頭之間的
白平衡也沒對齊，背景普遍偏綠灰（中性區 a* 約 −3）。這版改成：

1. 白平衡：每鏡估計中性區（低彩度、中間亮度）的平均色，在線性光以通道增益往「微暖中性」
   拉（綠–洋紅軸 70%、黃–藍軸 35%），不全拉是因為中性區會混到真的有顏色的牆和制服。
2. 黑位：每鏡把最暗 0.3% 的 L* 往下收一點（長鏡頭的大氣霧），再套共用的影調曲線：
   中間調對齊正式站「螢幕上實際看到」的亮度（見下方 TONE 註解），暗部維持原片深度，亮部收肩。
   曲線作用在 CIE L*（由線性亮度算），RGB 以亮度比例縮放，色相與色度比例不變。
3. 彩度：Oklab 裡低彩度補一點（vibrance），高彩度（螢光粉紅上衣、黃色制服）以軟肩收，
   膚色色相區不補，色相往黃轉 3°（亮度比例縮放讓膚色略偏紅）。
4. 超出 sRGB 的值在 Oklab 保持 L、h 降彩度收回色域，不硬切通道。

輸入是 BT.601 解出來的 sRGB（瀏覽器與 10-20 封面一直都是這樣解這支片），輸出交給
ffmpeg 以 BT.709 矩陣壓回 YUV，標 sRGB 轉換函數（理由見 build.py）。
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

W, H = 1080, 800
LUT_SIZE = 65

# 影調曲線（L* 進 → L* 出），用單調三次內插（PCHIP），不會有過衝。舊檔沒有色彩標記，macOS 的 Chrome／Safari
# 播放時中間調再被抬高約 11/255，使用者 10-20 看到並認可的是那個亮度：12 幀實測螢幕上 L50 71.7、平均 71.0、
# 最暗 0.5% 25.7。新檔標 sRGB、照原值顯示，所以中間調要拉到 L50 71.8（50→66.5），暗部幾乎不動（最暗 0.5% 8.3），
# 平均 69.1；亮部 80 以上收肩，接近白的像素 3.5%（舊檔螢幕上 2.5%）。
TONE = [(0, 0), (6, 5.8), (12, 14.6), (22, 31.5), (35, 50), (50, 66.5), (65, 78.6), (80, 87.6), (90, 92), (96, 95.6), (100, 100)]
# 白平衡目標：Oklab a, b（微暖中性）與各軸往目標拉的比例。綠–洋紅軸（a）是陰天加草地反光的
# 偏色，拉 70%；黃–藍軸（b）多半是米色牆與暖陽本身，只拉 35% 讓鏡頭之間接近，不把暖色洗掉。
WB_TARGET = (0.0, 0.010)
WB_STRENGTH = (0.7, 0.35)
# 黑位：最暗 0.3% 的 L* 超過 BLACK_FLOOR 的部分收掉 BLACK_STRENGTH。
BLACK_FLOOR = 4.0
BLACK_STRENGTH = 0.6
# 彩度（Oklab chroma）：低彩度補 VIBRANCE，到 VIB_FADE 漸弱為 0；超過 KNEE 以軟肩壓縮。照原值顯示本來就比舊檔
# 螢幕上鮮（舊檔被多轉一次色域），所以只補一點，螢光粉紅上衣壓得比較多。
VIBRANCE = 0.04
VIB_START = (0.012, 0.04)  # 接近中性的灰不補，免得把殘留偏色一起放大
VIB_FADE = 0.13
KNEE = 0.13
KNEE_ROOM = 0.07  # 超過 KNEE 的部分以 x/(1+x/ROOM) 漸近，最多再多 ROOM；在 KNEE 處斜率 1、沒有折角
# 膚色色相（Oklab h，度）：中心與半寬。膚色不補彩度，色相往黃轉 SKIN_TURN 度（亮度比例縮放後偏紅）。
SKIN_HUE = (58.0, 24.0)
SKIN_VIB = 0.0
SKIN_TURN = 3.0


# ---- 色彩空間 ----
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def luminance(lin):
    return lin @ np.array([0.2126, 0.7152, 0.0722])


def lstar(Y):
    Y = np.clip(Y, 0, None)
    return np.where(Y > 216 / 24389, 116 * np.cbrt(Y) - 16, Y * 24389 / 27)


def lstar_inv(L):
    L = np.clip(L, 0, None)
    return np.where(L > 8, ((L + 16) / 116) ** 3, L * 27 / 24389)


_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]])
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]])
_M2I = np.linalg.inv(_M2)
_M1I = np.linalg.inv(_M1)


def linear_to_oklab(lin):
    return np.cbrt(lin @ _M1.T) @ _M2.T


def oklab_to_linear(lab):
    return (lab @ _M2I.T) ** 3 @ _M1I.T


# ---- 曲線 ----
def pchip(xs, ys):
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h = np.diff(xs); d = np.diff(ys) / h
    m = np.zeros_like(xs)
    for k in range(1, len(xs) - 1):
        if d[k - 1] * d[k] > 0:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    m[0], m[-1] = d[0], d[-1]

    def f(x):
        x = np.clip(np.asarray(x, float), xs[0], xs[-1])
        k = np.clip(np.searchsorted(xs, x) - 1, 0, len(h) - 1)
        t = (x - xs[k]) / h[k]
        h00, h10, h01, h11 = 2*t**3 - 3*t**2 + 1, t**3 - 2*t**2 + t, -2*t**3 + 3*t**2, t**3 - t**2
        return h00 * ys[k] + h10 * h[k] * m[k] + h01 * ys[k + 1] + h11 * h[k] * m[k + 1]
    return f


TONE_CURVE = pchip(*zip(*TONE))


# ---- 每鏡估計 ----
def read_rgb(path, frames):
    """以 BT.601 把 limited-range YUV 解成 sRGB（0–1）。"""
    sel = '+'.join(f'eq(n\\,{f})' for f in frames)
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-vf',
           f"select='{sel}',scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int+bicubic,format=rgb48le",
           '-fps_mode', 'passthrough', '-f', 'rawvideo', '-']
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<u2').reshape(-1, H, W, 3).astype(np.float64) / 65535


def frame_count(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
                                   'stream=nb_read_frames', '-of', 'csv=p=0', str(path)])
    return int(out)


def estimate_shot(path):
    n = frame_count(path)
    picks = sorted({0, n // 4, n // 2, 3 * n // 4, n - 1})
    rgb = read_rgb(path, picks).reshape(-1, 3)
    lin = srgb_to_linear(rgb)
    lab = linear_to_oklab(lin)
    C = np.hypot(lab[:, 1], lab[:, 2])
    neutral = (C < 0.035) & (lab[:, 0] > 0.40) & (lab[:, 0] < 0.93)
    mean = lin[neutral].mean(0)
    cur = linear_to_oklab(mean[None])[0]
    target = np.array([cur[0], cur[1] + (WB_TARGET[0] - cur[1]) * WB_STRENGTH[0],
                       cur[2] + (WB_TARGET[1] - cur[2]) * WB_STRENGTH[1]])
    want = oklab_to_linear(target[None])[0]
    gains = want / mean
    gains /= luminance(gains * mean) / luminance(mean)  # 中性區亮度不變
    L = lstar(luminance(lin))
    black = float(np.percentile(L, 0.3))
    return {'frames': n, 'neutral_frac': float(neutral.mean()), 'neutral_oklab': cur.round(4).tolist(),
            'gains': gains.round(5).tolist(), 'black_lstar': round(black, 2),
            'black_point': round(max(0.0, black - BLACK_FLOOR) * BLACK_STRENGTH, 3)}


# ---- 調色 ----
def grade_rgb(rgb, gains=(1, 1, 1), black_point=0.0):
    """rgb: (..., 3) sRGB 0–1 → 調色後 sRGB 0–1。LUT 與封面都走這一個函式。"""
    lin = srgb_to_linear(np.asarray(rgb, float)) * np.asarray(gains)
    Y = luminance(lin)
    L = lstar(Y)
    if black_point:
        L = np.clip((L - black_point) / (100 - black_point) * 100, 0, None)
    Y2 = lstar_inv(TONE_CURVE(L))
    ratio = np.where(Y > 1e-6, Y2 / np.maximum(Y, 1e-6), 1.0)
    lin = np.where((Y > 1e-6)[..., None], lin * ratio[..., None], Y2[..., None])
    lab = linear_to_oklab(np.clip(lin, 0, None))
    C = np.hypot(lab[..., 1], lab[..., 2])
    h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    skin = np.clip(1 - np.abs((h - SKIN_HUE[0] + 180) % 360 - 180) / SKIN_HUE[1], 0, 1)
    skin = skin * skin * (3 - 2 * skin)
    ramp = np.clip((C - VIB_START[0]) / (VIB_START[1] - VIB_START[0]), 0, 1)
    vib = (VIBRANCE * (1 - skin) + SKIN_VIB * skin) * ramp * ramp * (3 - 2 * ramp) * np.clip(1 - C / VIB_FADE, 0, 1)
    C2 = C * (1 + vib)
    x = np.clip(C2 - KNEE, 0, None)
    C2 = np.where(C2 > KNEE, KNEE + x / (1 + x / KNEE_ROOM), C2)
    h2 = np.radians(h + SKIN_TURN * skin * np.clip(C / 0.03, 0, 1))
    lab[..., 1] = C2 * np.cos(h2)
    lab[..., 2] = C2 * np.sin(h2)
    return linear_to_srgb(gamut_map(lab))


def gamut_map(lab):
    """保持 Oklab L 與色相，二分降彩度到 sRGB 色域內。"""
    lab = lab.copy()
    lab[..., 0] = np.clip(lab[..., 0], 0, 1)
    lin = oklab_to_linear(lab)
    bad = ((lin < -1e-6) | (lin > 1 + 1e-6)).any(-1)
    if bad.any():
        sub = lab[bad]
        lo, hi = np.zeros(len(sub)), np.ones(len(sub))
        for _ in range(18):
            mid = (lo + hi) / 2
            test = sub.copy(); test[:, 1:] *= mid[:, None]
            l = oklab_to_linear(test)
            ok = ((l >= -1e-6) & (l <= 1 + 1e-6)).all(-1)
            lo = np.where(ok, mid, lo); hi = np.where(ok, hi, mid)
        sub[:, 1:] *= lo[:, None]
        lin[bad] = oklab_to_linear(sub)
    return np.clip(lin, 0, 1)


def write_cube(path, gains, black_point, size=LUT_SIZE):
    g = np.linspace(0, 1, size)
    # .cube：紅色變化最快
    b, gg, r = np.meshgrid(g, g, g, indexing='ij')
    rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
    out = grade_rgb(rgb, gains, black_point)
    with open(path, 'w') as f:
        f.write(f'TITLE "ivy hero 2026-10-24"\nLUT_3D_SIZE {size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
        np.savetxt(f, out, fmt='%.6f')


if __name__ == '__main__':
    import sys
    for p in sys.argv[1:]:
        print(Path(p).name, json.dumps(estimate_shot(p)))
