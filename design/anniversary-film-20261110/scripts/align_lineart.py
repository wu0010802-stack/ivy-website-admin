"""把五校線稿（鉛筆線、水彩上色）對位到實景照上，讓「線稿 → 上色 → 實景」能原地溶接。

線稿是照著實景照描的，但裁切、比例不同。做法：
1. 粗搜尋：水彩版（白底）去白當遮罩，在實景照上做多尺度遮罩模板比對（Lab 三通道 NCC），得等比縮放＋平移。
2. 實景照取 Canny 邊緣、線稿取線條像素。
3. 細修：以 ECC（仿射）對齊兩張模糊過的邊緣圖。
4. 依結果把線稿（ink，透明底）與水彩（colour，白底）轉到實景照座標，輸出到
   output/anniversary-film/stills/<key>-{photo,ink,colour}.png 以及對位檢查圖。

    python3 align_lineart.py
"""
from __future__ import annotations

import json
import os

import cv2
import numpy as np

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


def read(path, flags=cv2.IMREAD_UNCHANGED):
    img = cv2.imread(path, flags)
    if img is None:
        raise FileNotFoundError(path)
    return img


def line_mask(base_rgba: np.ndarray) -> np.ndarray:
    """線稿底圖（米白紙＋鉛筆線）→ 線條強度 0~1。"""
    rgb = base_rgba[..., :3].astype(np.float32)
    gray = cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY)
    paper = cv2.GaussianBlur(gray, (0, 0), 25)
    ink = np.clip((paper - gray) / 60.0, 0, 1)
    if base_rgba.shape[2] == 4:
        ink *= base_rgba[..., 3] / 255.0
    return ink


def photo_edges(photo: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (0, 0), 1.2)
    return cv2.Canny(gray, 40, 110)


def colour_search(colour_bgr: np.ndarray, sx: float, photo: np.ndarray):
    """粗搜尋：水彩版（白底）去掉白色部分當遮罩，對實景照做多尺度遮罩模板比對（灰階＋色彩兩個通道）。
    回傳 L（線稿底圖座標）→ P 的 2×3 矩陣與分數。"""
    work_w = 720
    k = work_w / photo.shape[1]
    ph = cv2.resize(photo, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    ph_lab = cv2.cvtColor(cv2.GaussianBlur(ph, (0, 0), 2.0), cv2.COLOR_BGR2Lab).astype(np.float32)
    col_lab_full = cv2.cvtColor(colour_bgr, cv2.COLOR_BGR2Lab).astype(np.float32)
    white = (col_lab_full[..., 0] > 240) & (np.abs(col_lab_full[..., 1] - 128) < 6) & (np.abs(col_lab_full[..., 2] - 128) < 6)
    ys, xs = np.nonzero(~white)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    best = (-1, None)
    # 水彩版座標 → 線稿底圖座標：乘 sx
    for s_rel in np.linspace(0.5, 1.6, 45):
        # 水彩版 1px 在工作圖上是幾 px
        s = s_rel * ph.shape[1] / colour_bgr.shape[1]
        tw, th = int((x1 - x0) * s), int((y1 - y0) * s)
        if tw < 40 or th < 30 or tw > ph.shape[1] or th > ph.shape[0]:
            continue
        crop = colour_bgr[y0:y1, x0:x1]
        t = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_AREA)
        t = cv2.GaussianBlur(t, (0, 0), 2.0)
        t_lab = cv2.cvtColor(t, cv2.COLOR_BGR2Lab).astype(np.float32)
        m = cv2.resize((~white[y0:y1, x0:x1]).astype(np.float32), (tw, th))
        m = (cv2.erode(m, np.ones((5, 5), np.uint8)) > 0.5).astype(np.float32)
        score = None
        for c, wgt in ((0, 1.0), (1, 0.6), (2, 0.6)):
            r = cv2.matchTemplate(ph_lab[..., c], t_lab[..., c], cv2.TM_CCOEFF_NORMED, mask=m)
            r = np.nan_to_num(r, nan=-1, posinf=-1, neginf=-1)
            score = r * wgt if score is None else score + r * wgt
        _, mx, _, loc = cv2.minMaxLoc(score)
        if mx > best[0]:
            best = (mx, (s, loc))
    s, (lx, ly) = best[1]
    # colour 座標 (x, y) → 工作圖 (lx + (x - x0) s, ly + (y - y0) s) → 原圖 ÷k；線稿底圖座標 = colour 座標 × sx
    a = s / k / sx
    tx = (lx - x0 * s) / k
    ty = (ly - y0 * s) / k
    return np.array([[a, 0, tx], [0, a, ty]], np.float32), best[0]


def ecc_refine(ink: np.ndarray, edges: np.ndarray, M: np.ndarray) -> np.ndarray:
    h, w = edges.shape
    tgt = cv2.GaussianBlur(edges.astype(np.float32) / 255.0, (0, 0), 3)
    src = cv2.warpAffine(ink.astype(np.float32), M, (w, h))
    src = cv2.GaussianBlur(src, (0, 0), 3)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cc, warp = cv2.findTransformECC(tgt, src, warp, cv2.MOTION_AFFINE,
                                        (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
    except cv2.error as exc:
        print('  ECC failed, keep coarse:', exc)
        return M
    # ECC 給的是 tgt→src 的反向對應：src(x') = tgt(warp·x)；合成 L→P = inv(warp)∘M
    W = np.vstack([warp, [0, 0, 1]])
    Mf = np.vstack([M, [0, 0, 1]])
    return (np.linalg.inv(W) @ Mf)[:2].astype(np.float32)


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for key, photo_name in PHOTOS.items():
        photo = read(os.path.join(ASSETS, photo_name), cv2.IMREAD_COLOR)
        base = read(os.path.join(ASSETS, f'campus-line-art-{key}.webp'))
        if base.shape[2] == 3:
            base = cv2.cvtColor(base, cv2.COLOR_BGR2BGRA)
        ink = line_mask(base)
        edges = photo_edges(photo)
        colour = read(os.path.join(ASSETS, f'campus-line-art-{key}-colour.webp'), cv2.IMREAD_COLOR)
        sx = base.shape[1] / colour.shape[1]
        M, score = colour_search(colour, sx, photo)
        M2 = ecc_refine(ink, edges, M)
        h, w = photo.shape[:2]
        # 輸出：鉛筆線（深綠灰、透明底）、水彩（白底，給 multiply）、實景照原樣
        ink_w = cv2.warpAffine(ink, M2, (w, h), flags=cv2.INTER_LINEAR)
        ink_rgba = np.zeros((h, w, 4), np.uint8)
        ink_rgba[..., :3] = (51, 62, 52)  # BGR，約 --text #25342C 再淡一點的鉛筆色
        ink_rgba[..., 3] = np.clip(ink_w * 255, 0, 255).astype(np.uint8)
        Mc = M2 @ np.array([[sx, 0, 0], [0, sx, 0], [0, 0, 1]], np.float32)
        # 水彩版的「白底」其實是略帶米色的紙（約 248–252），multiply 時會把整個矩形壓暗一點、露出邊界：
        # 以原圖四周的紙色當白點拉到 255，接近白的部分再平滑推成純白
        border = np.concatenate([colour[:8].reshape(-1, 3), colour[-8:].reshape(-1, 3), colour[:, :8].reshape(-1, 3), colour[:, -8:].reshape(-1, 3)])
        white = np.median(border, axis=0).astype(np.float32)
        cf = np.clip(colour.astype(np.float32) * (255.0 / np.maximum(white, 1)), 0, 255)
        lum = cf.mean(axis=2, keepdims=True)
        t = np.clip((lum - 238) / 14, 0, 1)
        cf = cf * (1 - t) + 255 * t
        colour = cf.astype(np.uint8)
        colour_w = cv2.warpAffine(colour, Mc, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
        cv2.imwrite(os.path.join(OUT, f'{key}-photo.png'), photo)
        cv2.imwrite(os.path.join(OUT, f'{key}-ink.png'), ink_rgba)
        cv2.imwrite(os.path.join(OUT, f'{key}-colour.png'), colour_w)
        # 對位檢查：實景照降飽和＋紅色線稿
        chk = cv2.cvtColor(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
        chk = (chk * 0.6 + 100).astype(np.uint8)
        a = ink_w[..., None]
        chk = (chk * (1 - a) + np.array([0, 0, 230]) * a).astype(np.uint8)
        cv2.imwrite(os.path.join(OUT, f'{key}-check.jpg'), cv2.resize(chk, None, fx=900 / w, fy=900 / w))
        report[key] = dict(photo=photo_name, size=[w, h], coarse=M.tolist(), affine=M2.tolist(), ncc=float(score))
        print(key, 'ncc', round(float(score), 2), 'affine', np.round(M2, 3).tolist())
    json.dump(report, open(os.path.join(OUT, 'alignment.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
