"""enhanced-v1（AI 重建）對到新母檔：邊緣圖＋FFT 相位相關，x／y 縮放分開搜尋。
回傳 enhanced-v1 像素 → 新母檔像素的 (sx, sy, tx, ty)。"""
import sys
import numpy as np
from PIL import Image, ImageFilter

cur = Image.open(sys.argv[1]).convert('L')
new = Image.open(sys.argv[2]).convert('L')
K = 0.5  # 在半尺寸上算，省記憶體

def edges(im):
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]; gy[1:-1] = a[2:] - a[:-2]
    g = np.hypot(gx, gy)
    return (g - g.mean()) / (g.std() + 1e-6)

N = new.resize((round(new.width * K), round(new.height * K)), Image.LANCZOS)
EN = edges(N)
H, W = EN.shape
best = None
# 期望值：sx≈1.5*1536/1546≈1.4903、sy≈1.5*1013/1017≈1.4941（再乘 K）
SX0,SX1,SY0,SY1,STEP=map(float,sys.argv[3:8])
for sx in np.arange(SX0, SX1, STEP):
    for sy in np.arange(SY0, SY1, STEP):
        C = cur.resize((round(cur.width * sx * K), round(cur.height * sy * K)), Image.LANCZOS)
        EC = edges(C)
        pad = np.zeros((H, W), np.float32)
        h, w = min(EC.shape[0], H), min(EC.shape[1], W)
        pad[:h, :w] = EC[:h, :w]
        F = np.fft.fft2(EN) * np.conj(np.fft.fft2(pad))
        r = np.fft.ifft2(F / (np.abs(F) + 1e-6)).real
        iy, ix = np.unravel_index(np.argmax(r), r.shape)
        if iy > H / 2: iy -= H
        if ix > W / 2: ix -= W
        score = r.max()
        if best is None or score > best[0]:
            best = (score, sx, sy, ix / K, iy / K)
print('score %.4f sx %.4f sy %.4f tx %.1f ty %.1f' % best)
