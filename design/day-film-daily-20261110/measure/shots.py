#!/usr/bin/env python3
"""各鏡調色後的亮度與色偏（對齊用）：每鏡抽 6 格，算 L* 的 p5／中位／p95、平均 a*b*、膚色區（粗略）的 a*b*。

用法：python3 -I design/day-film-daily-20261110/measure/shots.py output/day-film-daily-20261110/graded [<輸出 contact.png>]
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_lab(rgb8):
    rgb = srgb_to_linear(rgb8 / 255.0)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = rgb @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return L, a, b


def sample(clip, temp):
    frames = int(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                                          '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(clip)]).decode().strip())
    step = max(1, frames // 6)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(clip), '-vf',
                    f"select='not(mod(n\\,{step}))',scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24",
                    '-fps_mode', 'passthrough', str(temp / f'{clip.stem}-%02d.png')], check=True)
    return sorted(temp.glob(f'{clip.stem}-*.png'))[:6]


if __name__ == '__main__':
    folder = Path(sys.argv[1])
    clips = sorted(folder.glob('shot-*.mkv'))
    tiles = []
    with tempfile.TemporaryDirectory() as temp:
        for clip in clips:
            pngs = sample(clip, Path(temp))
            arrays = [np.asarray(Image.open(p).convert('RGB'), dtype=np.float64) for p in pngs]
            allpx = np.concatenate([a.reshape(-1, 3) for a in arrays])
            L, a, b = to_lab(allpx)
            skin = (a > 8) & (a < 30) & (b > 10) & (b < 40) & (L > 35) & (L < 85)
            skin_note = f'膚色 a {a[skin].mean():5.1f} b {b[skin].mean():5.1f} ({skin.mean() * 100:4.1f}%)' if skin.sum() > 500 else '膚色 —'
            print(f'{clip.stem[:7]}: L p5 {np.percentile(L, 5):5.1f} 中位 {np.median(L):5.1f} p95 {np.percentile(L, 95):5.1f} | 平均 a {a.mean():5.1f} b {b.mean():5.1f} | {skin_note}')
            mid = Image.open(pngs[len(pngs) // 2]).convert('RGB').resize((480, 270), Image.LANCZOS)
            ImageDraw.Draw(mid).text((6, 6), clip.stem[:7], fill='yellow')
            tiles.append(mid)
    if len(sys.argv) > 2 and tiles:
        cols = 4
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new('RGB', (480 * cols, 270 * rows), 'black')
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 480, (i // cols) * 270))
        sheet.save(sys.argv[2])
