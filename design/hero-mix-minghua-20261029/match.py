#!/usr/bin/env python3
"""第二版（2026-10-29 下午）：舊首屏鏡頭往明華原片的影調拉。

明華六鏡不調色：沒有色彩標記的原片在 Mac 的 Chrome／Safari 上怎麼顯示，用 10-25 實測的
design/day-film-color-20261025/screen-17.cube 燒進像素（輸入是 BT.601 解出的 R'G'B'），交付檔再標 sRGB，
螢幕上就跟原片一樣。舊鏡頭先套同一個 cube（從它自己在螢幕上的樣子出發），再套這裡算出的對齊 LUT：

1. 白平衡：中性區（Oklab 低彩度、中間亮度）平均色往明華六鏡的中性區平均拉 WB_PULL。
2. 影調：L* 曲線過 (最暗 0.5%, 中位, 最亮 0.5%) 三點，各自往明華六鏡的平均拉；黑位只壓不抬（舊第 1 鏡有一層霧）。
   RGB 以亮度比例縮放，色相與色度比例不變（同 grade.py）。
3. 膚色：膚色色相區的平均彩度與色相往明華拉（舊片膚色偏淡、第 3 鏡偏黃），倍率上限 SKIN_CHROMA_MAX。
4. 超出 sRGB 的值用 grade.gamut_map 保持 L、h 降彩度收回。

目標值每次從明華六鏡量（5 格取樣），寫進 manifest。
"""
from __future__ import annotations

import subprocess

import numpy as np

W, H = 1080, 800
SWS = 'accurate_rnd+full_chroma_int+bicubic'
WB_PULL = 0.8
BLACK_PULL = 0.8
MID_PULL = 0.6
WHITE_PULL = 0.5
SKIN_HUE = (55.0, 25.0)  # 中心、半寬（度）
SKIN_CHROMA_PULL = 0.7
SKIN_CHROMA_MAX = 1.3
SKIN_HUE_PULL = 0.7
LUT_SIZE = 65


def read_screen(grade, path, cube):
    """BT.601 解 → screen cube：沒有標記的片在螢幕上的 sRGB（0–1）。"""
    n = grade.frame_count(path)
    picks = sorted({0, n // 4, n // 2, 3 * n // 4, n - 1})
    sel = '+'.join(f'eq(n\\,{f})' for f in picks)
    raw = subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-vf',
         f"select='{sel}',scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,"
         f'lut3d=file={cube}:interp=tetrahedral',
         '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-'],
        check=True, capture_output=True).stdout
    return np.frombuffer(raw, '<u2').reshape(-1, H, W, 3).astype(np.float64) / 65535


def _skin_weight(lab):
    C = np.hypot(lab[..., 1], lab[..., 2])
    h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    w = np.clip(1 - np.abs((h - SKIN_HUE[0] + 180) % 360 - 180) / SKIN_HUE[1], 0, 1)
    w = w * w * (3 - 2 * w)
    ramp = np.clip((C - 0.02) / 0.02, 0, 1)
    return w * ramp * (lab[..., 0] > 0.45), C, h


def measure(grade, rgb):
    """影調、中性區、膚色的統計（rgb: (..., 3) sRGB 0–1）。"""
    rgb = rgb.reshape(-1, 3)
    lin = grade.srgb_to_linear(rgb)
    lab = grade.linear_to_oklab(lin)
    L = grade.lstar(grade.luminance(lin))
    C = np.hypot(lab[:, 1], lab[:, 2])
    neutral = (C < 0.035) & (lab[:, 0] > 0.40) & (lab[:, 0] < 0.93)
    skin, _, h = _skin_weight(lab)
    return {'black': float(np.percentile(L, 0.5)), 'mid': float(np.percentile(L, 50)),
            'white': float(np.percentile(L, 99.5)),
            'neutral_ab': [float(lab[neutral, 1].mean()), float(lab[neutral, 2].mean())],
            'neutral_lin': lin[neutral].mean(0),
            'skin_chroma': float((C * skin).sum() / skin.sum()),
            'skin_hue': float((h * skin).sum() / skin.sum())}


def target_of(grade, frames):
    stats = [measure(grade, f) for f in frames]
    return {'black': float(np.mean([s['black'] for s in stats])), 'mid': float(np.mean([s['mid'] for s in stats])),
            'white': float(np.mean([s['white'] for s in stats])),
            'neutral_ab': np.mean([s['neutral_ab'] for s in stats], 0).tolist(),
            'skin_chroma': float(np.mean([s['skin_chroma'] for s in stats])),
            'skin_hue': float(np.mean([s['skin_hue'] for s in stats]))}


def estimate(grade, rgb, target):
    src = measure(grade, rgb)
    # 1. 白平衡增益（中性區亮度不變）
    cur = grade.linear_to_oklab(src['neutral_lin'][None])[0]
    want_ab = cur[1:] + (np.array(target['neutral_ab']) - cur[1:]) * WB_PULL
    want = grade.oklab_to_linear(np.array([[cur[0], *want_ab]]))[0]
    gains = want / src['neutral_lin']
    gains /= grade.luminance(gains * src['neutral_lin']) / grade.luminance(src['neutral_lin'])
    params = {'gains': gains.round(5).tolist(), 'tone': [], 'skin_scale': 1.0, 'skin_turn': 0.0}
    # 2. 影調三點（量白平衡後的值）
    after = measure(grade, grade.linear_to_srgb(grade.srgb_to_linear(rgb.reshape(-1, 3)) * gains))
    black = min(after['black'], after['black'] + (target['black'] - after['black']) * BLACK_PULL)
    mid = after['mid'] + (target['mid'] - after['mid']) * MID_PULL
    white = after['white'] + (target['white'] - after['white']) * WHITE_PULL
    params['tone'] = [[0, 0], [round(after['black'], 2), round(black, 2)], [round(after['mid'], 2), round(mid, 2)],
                      [round(after['white'], 2), round(white, 2)], [100, 100]]
    # 3. 膚色（量影調後的值）
    toned = match_rgb(grade, rgb.reshape(-1, 3), params)
    skin = measure(grade, toned)
    scale = 1 + (target['skin_chroma'] / skin['skin_chroma'] - 1) * SKIN_CHROMA_PULL
    params['skin_scale'] = round(float(np.clip(scale, 1 / SKIN_CHROMA_MAX, SKIN_CHROMA_MAX)), 4)
    params['skin_turn'] = round((target['skin_hue'] - skin['skin_hue']) * SKIN_HUE_PULL, 2)
    params['source'] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in src.items() if k != 'neutral_lin'}
    return params


def match_rgb(grade, rgb, params):
    """rgb: (..., 3) 螢幕上的 sRGB 0–1 → 對齊明華後的 sRGB 0–1。"""
    lin = grade.srgb_to_linear(np.asarray(rgb, float)) * np.asarray(params['gains'])
    Y = grade.luminance(lin)
    L = grade.lstar(Y)
    curve = grade.pchip(*zip(*params['tone']))
    Y2 = grade.lstar_inv(curve(L))
    ratio = np.where(Y > 1e-6, Y2 / np.maximum(Y, 1e-6), 1.0)
    lin = np.where((Y > 1e-6)[..., None], lin * ratio[..., None], Y2[..., None])
    lab = grade.linear_to_oklab(np.clip(lin, 0, None))
    if params['skin_scale'] != 1.0 or params['skin_turn']:
        w, C, h = _skin_weight(lab)
        C2 = C * (1 + (params['skin_scale'] - 1) * w)
        h2 = np.radians(h + params['skin_turn'] * w)
        lab[..., 1] = C2 * np.cos(h2)
        lab[..., 2] = C2 * np.sin(h2)
    return grade.linear_to_srgb(grade.gamut_map(lab))


def write_cube(grade, path, params, size=LUT_SIZE):
    g = np.linspace(0, 1, size)
    b, gg, r = np.meshgrid(g, g, g, indexing='ij')
    out = match_rgb(grade, np.stack([r, gg, b], -1).reshape(-1, 3), params)
    with open(path, 'w') as f:
        f.write(f'TITLE "ivy hero match minghua 2026-10-29"\nLUT_3D_SIZE {size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
        np.savetxt(f, out, fmt='%.6f')
