"""30 週年校徽拆層（片尾逐層組裝用），全解析度、透明底。

來源 web/media-src/ivy-30th-anniversary-projection.png（1254×1254，米白底）。去背做法沿用
scripts/build-crest-popup.py（從角落連通的近白區＝背景，邊緣依色差給半透明，再去白邊），
但保留整張（含 30th 緞帶），並把頂部拆成皇冠與五顆星、麥穗拆成左右兩半。

輸出 output/anniversary-film/stills/crest/<layer>.png（1254×1254，同一座標系，直接疊）與 layers.json（每層外框）。
    python3 build_crest_layers.py
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(REPO, 'web', 'media-src', 'ivy-30th-anniversary-projection.png')
OUT = os.path.join(REPO, 'output', 'anniversary-film', 'stills', 'crest')
BG = np.array([253, 254, 247], np.float32)


def floodfill_mask(mask, seed=(0, 0)):
    im = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8)).copy()
    ImageDraw.floodfill(im, seed, 128)
    return np.asarray(im) == 128


def main():
    os.makedirs(OUT, exist_ok=True)
    rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
    h, w = rgb.shape[:2]
    dist = np.sqrt(((rgb - BG) ** 2).sum(axis=2))
    core = floodfill_mask(dist < 14)
    band = np.asarray(Image.fromarray(core.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
    alpha = np.where(core, 0.0, np.where(band, np.clip((dist - 6) / 50, 0, 1), 1.0))
    a3 = alpha[..., None]
    clean = np.clip(np.where(a3 > 0.02, (rgb - BG * (1 - a3)) / np.maximum(a3, 0.02), 0), 0, 255)

    ink = alpha > 0.05
    # 連通區塊（8 連通）：較大的拿來分類
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    layers: dict[str, np.ndarray] = {k: np.zeros((h, w), bool) for k in
                                     ['crown', 'star1', 'star2', 'star3', 'star4', 'star5', 'star6', 'wreathL', 'wreathR', 'kids', 'banner', 'ribbon']}
    cx = w / 2
    stars = []
    pieces = []
    for i, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        m = lab[sl] == i
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        col = clean[sl][m].mean(axis=0)
        r, g, b = col
        area = sizes[i - 1]
        pieces.append(dict(i=i, box=(x0, y0, x1, y1), rgb=(int(r), int(g), int(b)), area=int(area)))
    # 依位置與顏色分類
    for p in pieces:
        i, (x0, y0, x1, y1), (r, g, b), area = p['i'], p['box'], p['rgb'], p['area']
        my, mx = (y0 + y1) / 2, (x0 + x1) / 2
        mask = lab == i
        if my > 860:
            layers['ribbon'] |= mask
        elif my > 760:
            layers['banner'] |= mask
        elif my < 400 and r > 170 and b < 140:
            if abs(mx - cx) < 90 and area > 2000:
                layers['crown'] |= mask
            else:
                stars.append((mx, my, mask))
        elif g > r + 15 and my > 380 and (mx < 470 or mx > w - 470):
            layers['wreathL' if mx < cx else 'wreathR'] |= mask
        else:
            layers['kids'] |= mask
    # 六顆星（左三右三）：取面積最大的六塊、由左到右編號；其餘小碎片併到最近的星
    stars.sort(key=lambda s: -int(s[2].sum()))
    main_stars = sorted(stars[:6], key=lambda s: s[0])
    if len(main_stars) != 6:
        print('warning: expected 6 stars, got', len(main_stars))
    for k, (mx, my, m) in enumerate(main_stars):
        layers[f'star{k + 1}'] |= m
    for mx, my, m in stars[6:]:
        d = [abs(mx - st[0]) + abs(my - st[1]) for st in main_stars]
        layers[f'star{int(np.argmin(d)) + 1}'] |= m

    # 半透明邊緣：每個像素歸屬最近的實心區塊（距離轉換）
    keys = [k for k in layers if layers[k].any()]
    stack = np.stack([layers[k] for k in keys])
    dists = np.stack([ndimage.distance_transform_edt(~m) for m in stack])
    owner = np.argmin(dists, axis=0)
    meta = {}
    for idx, k in enumerate(keys):
        a = np.where(owner == idx, alpha, 0) * (np.min(dists, axis=0) < 6)
        if not a.any():
            continue
        rgba = np.dstack([clean, a * 255]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, f'{k}.png'))
        ys, xs = np.nonzero(a > 0.05)
        meta[k] = dict(x0=int(xs.min()), y0=int(ys.min()), x1=int(xs.max()) + 1, y1=int(ys.max()) + 1,
                       cx=float(xs.mean()), cy=float(ys.mean()))
    meta['_size'] = [w, h]
    json.dump(meta, open(os.path.join(OUT, 'layers.json'), 'w'), indent=1)
    # 檢查圖：每層隨機色
    chk = np.full((h, w, 3), 255, np.uint8)
    rng = np.random.default_rng(3)
    for k in meta:
        if k.startswith('_'):
            continue
        a = np.asarray(Image.open(os.path.join(OUT, f'{k}.png')))[..., 3] > 30
        chk[a] = rng.integers(40, 220, 3)
    Image.fromarray(chk).resize((627, 627)).save(os.path.join(OUT, 'check.png'))
    print({k: (v['x0'], v['y0'], v['x1'], v['y1']) for k, v in meta.items() if not k.startswith('_')})


if __name__ == '__main__':
    main()
