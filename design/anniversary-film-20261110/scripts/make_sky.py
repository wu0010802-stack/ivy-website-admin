"""第一、二幕〈星圖〉的夜空底圖：深綠夜色＋兩層星雲（遠景、近景塵埃），算圖時各自以不同視差移動。

- sky-far.png  2400×2400 RGB：深墨綠漸層底＋大片柔和星雲（墨綠、青綠，零星一點暖金）
- sky-near.png 2400×2400 RGBA：細的發光塵埃絲（薄荷、暖金），alpha 很低，疊在星星上方增加景深
- <key>-photo.png：五校實景照（官網 web/public/assets 原圖轉 PNG），在光窗裡出現

星雲是 domain-warp 的 fbm 雜訊；全部以 seed 固定，可重現。輸出 output/anniversary-film/stills/。

    python3 make_sky.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ASSETS = os.path.join(REPO, 'web', 'public', 'assets')
OUT = os.path.join(REPO, 'output', 'anniversary-film', 'stills')
PHOTOS = {
    'yihua': 'yihua-exterior-v2.webp',
    'minghua': 'minghua-enhanced-v1.webp',
    'chongde': 'chongde-enhanced-v1.webp',
    'international': 'international-enhanced-v1.webp',
    'renwu': 'renwu-enhanced-v1.webp',
}
N = 2400
WORK = 800  # 在低解析度算雜訊再放大（星雲本來就柔）


def fbm(shape, seed, octaves=6, base=4):
    rng = np.random.default_rng(seed)
    h, w = shape
    out = np.zeros(shape, np.float64)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        res = base * 2 ** o
        g = rng.standard_normal((res + 1, res + 1))
        layer = ndimage.zoom(g, (h / res, w / res), order=3)[:h, :w]
        out += amp * layer
        tot += amp
        amp *= 0.52
    out /= tot
    return (out - out.min()) / (out.max() - out.min())


def warp(field, dx, dy, k):
    h, w = field.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    return ndimage.map_coordinates(field, [yy + dy * k, xx + dx * k], order=1, mode='reflect')


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, name in PHOTOS.items():
        Image.open(os.path.join(ASSETS, name)).convert('RGB').save(os.path.join(OUT, f'{key}-photo.png'))
    s = (WORK, WORK)
    a = fbm(s, 11)
    b = fbm(s, 12)
    c = fbm(s, 13, base=3)
    wa = warp(c, a - 0.5, b - 0.5, 120)
    wb = warp(fbm(s, 14, base=5), b - 0.5, a - 0.5, 90)
    yy, xx = np.mgrid[0:WORK, 0:WORK] / WORK - 0.5
    r = np.sqrt(xx ** 2 + yy ** 2)

    # 遠景：底色由中央的深墨綠到邊緣接近黑
    base_in = np.array([13, 33, 26], np.float64)
    base_out = np.array([4, 11, 8], np.float64)
    t = np.clip(r / 0.7, 0, 1)[..., None]
    img = base_in * (1 - t) + base_out * t
    cloud = np.clip((wa - 0.42) / 0.5, 0, 1) ** 1.6
    teal = np.array([30, 78, 62], np.float64)
    img += cloud[..., None] * teal * 0.55
    deep = np.clip((wb - 0.5) / 0.4, 0, 1) ** 2
    img += deep[..., None] * np.array([18, 52, 44]) * 0.6
    gold = np.clip((wa * wb - 0.42) / 0.25, 0, 1) ** 2.2
    img += gold[..., None] * np.array([60, 48, 20]) * 0.45
    far = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)
    # 放大後加極細的雜訊避免色階
    farr = np.asarray(far).astype(np.float64) + np.random.default_rng(3).uniform(-0.6, 0.6, (N, N, 3))
    Image.fromarray(np.clip(farr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'sky-far.png'), optimize=True)

    # 近景塵埃：細絲（高頻、強 warp），只在部分區域出現
    d = warp(fbm(s, 21, base=5), fbm(s, 22) - 0.5, fbm(s, 23) - 0.5, 160)
    ridge = 1 - np.abs(2 * d - 1)          # 雜訊的稜線＝細絲
    mask = np.clip((fbm(s, 24, base=2) - 0.4) / 0.35, 0, 1)
    fil = np.clip((ridge - 0.78) / 0.22, 0, 1) ** 3 * mask
    col = np.zeros((WORK, WORK, 4))
    mix = fbm(s, 25, base=3)[..., None]
    col[..., :3] = np.array([150, 205, 180]) * (1 - mix) + np.array([240, 205, 130]) * mix
    col[..., 3] = fil * 70
    near = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), 'RGBA').resize((N, N), Image.BICUBIC)
    near.save(os.path.join(OUT, 'sky-near.png'), optimize=True)
    print('ok', np.asarray(far).reshape(-1, 3).mean(0), 'near alpha max', np.asarray(near)[..., 3].max())


if __name__ == '__main__':
    main()
