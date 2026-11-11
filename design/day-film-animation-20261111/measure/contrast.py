#!/usr/bin/env python3
"""離線算「孩子的一天」開場那一屏的文字對比（同 2026-09-24／10-20 的方法：抽影片格、套實際遮罩、取每段字範圍內最亮的背景像素）。

用法：python3 -I design/day-film-animation-20261111/measure/contrast.py <rects.json> <寬度,寬度…>=<影片.mp4> […]
  例：contrast.py rects.json 1440,1280,1024=day-desktop.mp4 390=day-portrait.mp4（直拿手機播的是直式檔）
每支影片每 0.5 秒抽一格，依 rects.json 的影片框與 object-position 做 cover 裁切，疊 styles.css 的兩層墨綠紗
（常駐 .34／.18 42%／.36 ＋ 開場那屏 .39／.2 42%／.48，--word-fade=1），不計文字陰影與眉標的暗暈（保守），
再對每段文字取範圍內最亮像素算 WCAG 對比。開場那屏還沒選到拍立得，時段光不疊。
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

INK = np.array([17, 42, 33], dtype=np.float64)  # tokens.css --ink
SHADES = [[(0.0, 0.34), (0.42, 0.18), (1.0, 0.36)], [(0.0, 0.39), (0.42, 0.20), (1.0, 0.48)]]
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def luminance(rgb):
    lin = srgb_to_linear(rgb)
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def oklch_to_srgb(L, C, h):
    a, b = C * np.cos(np.radians(h)), C * np.sin(np.radians(h))
    l_, m_, s_ = L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    lin = np.array([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s])
    lin = np.clip(lin, 0, 1)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)
    return srgb * 255


def css_color(text):
    body = text[text.index('(') + 1:text.rindex(')')].replace('/', ' ').replace(',', ' ').split()
    if text.startswith('oklch'):
        return oklch_to_srgb(float(body[0].rstrip('%')) / (100 if body[0].endswith('%') else 1), float(body[1]), float(body[2]))
    return np.array([float(v) for v in body[:3]])


def alpha_at(stops, t):
    for (t0, a0), (t1, a1) in zip(stops, stops[1:]):
        if t <= t1:
            return a0 + (a1 - a0) * (t - t0) / (t1 - t0)
    return stops[-1][1]


def frames(video, out_dir):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(video), '-vf',
                    'fps=2,scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int+bilinear,format=rgb24',
                    str(out_dir / 'f-%03d.png')], check=True)
    return sorted(out_dir.glob('f-*.png'))


def cover(frame, film, object_position):
    """影片以 cover 鋪滿 film 框，回傳一張 film 框大小的影像（影片像素座標 → 視窗座標）。"""
    fw, fh = frame.size
    W, H = film['w'], film['h']
    scale = max(W / fw, H / fh)
    dw, dh = fw * scale, fh * scale
    def offset(value, room):
        # object-position 的每一軸：百分比是「多出來的部分」的比例，px 是絕對位移（styles.css 的 4% 0 會算成 '4% 0px'）
        return float(value.rstrip('px')) if value.endswith('px') else room * float(value.rstrip('%')) / 100
    px, py = object_position.split()
    ox, oy = offset(px, W - dw), offset(py, H - dh)
    # 瀏覽器縮放影片是雙線性；用 LANCZOS 會在鉛筆線旁多出振鈴亮邊，把「最亮像素」量高（淡彩插畫差到 0.3，實拍片幾乎沒差）
    resized = frame.resize((round(dw), round(dh)), Image.BILINEAR)
    canvas = Image.new('RGB', (round(W), round(H)))
    canvas.paste(resized, (round(ox), round(oy)))
    return np.asarray(canvas, dtype=np.float64)


def shaded(pixels):
    H = pixels.shape[0]
    out = pixels.copy()
    for stops in SHADES:
        alpha = np.array([alpha_at(stops, y / max(H - 1, 1)) for y in range(H)])[:, None, None]
        out = out * (1 - alpha) + INK * alpha
    return out


def contrast(fg_rgb, bg_rgb):
    lf, lb = luminance(fg_rgb), luminance(bg_rgb)
    hi, lo = max(lf, lb), min(lf, lb)
    return (hi + 0.05) / (lo + 0.05)


def measure(rects, video, per_frame=False):
    report = {}
    with tempfile.TemporaryDirectory() as temp:
        pngs = frames(video, Path(temp))
        images = [Image.open(p).convert('RGB') for p in pngs]
        for name, data in rects.items():
            film = data['film']
            worst = {}
            for index, image in enumerate(images):
                composite = shaded(cover(image, film, data['objectPosition'] or '50% 48%'))
                for key, item in data['text'].items():
                    r = item['rect']
                    x0, y0 = max(0, int(r['x'] - film['x'])), max(0, int(r['y'] - film['y']))
                    x1, y1 = min(composite.shape[1], int(np.ceil(r['x'] - film['x'] + r['w']))), min(composite.shape[0], int(np.ceil(r['y'] - film['y'] + r['h'])))
                    if x1 <= x0 or y1 <= y0:
                        continue
                    region = composite[y0:y1, x0:x1].reshape(-1, 3)
                    brightest = region[np.argmax(luminance(region))]
                    value = contrast(css_color(item['color']), brightest)
                    if value < worst.get(key, (99, 0))[0]:
                        worst[key] = (value, index / 2)
            report[name] = {k: (round(v, 2), t) for k, (v, t) in worst.items()}
    return report


if __name__ == '__main__':
    rects = json.loads(Path(sys.argv[1]).read_text())
    for pair in sys.argv[2:]:
        names, video = pair.split('=', 1)
        print(f'## {video}')
        subset = {name: rects[name] for name in names.split(',')}
        for name, values in measure(subset, Path(video)).items():
            print(f'{name}: ' + ', '.join(f'{k} {v}（最差在 {t:.1f} 秒）' for k, (v, t) in values.items()))
