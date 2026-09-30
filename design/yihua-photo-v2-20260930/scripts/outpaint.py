"""義華外觀照左右延伸背景 v2：最外側先鋪真實背景紋理（右緣背景條翻面），LaMa 只補中間接縫，兩側都有參考不會糊。

用法：outpaint2.py EL ER OUT
- 右側：外側 = 右緣背景條鏡像；中間 hole = ER - 鏡像寬
- 左側：外側 = 右緣背景條水平翻轉（天空、樹林、草地的層次跟左緣一致）；中間 hole
"""
import sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = Path(__file__).parent
SRC = HERE / 'old/8a3d6d_cfb59ec2fd8e45e5a4ca514127e0b18a.jpg'
EL, ER = int(sys.argv[1]), int(sys.argv[2])
OUT = HERE / sys.argv[3]
T = 512
BG_FROM = 1470  # 原圖右緣只有 x≥1470 是背景（右塔外緣約 1460）

src = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32) / 255
h, w, _ = src.shape
W = w + EL + ER
canvas = np.zeros((h, W, 3), np.float32)
canvas[:, EL:EL + w] = src
hole = np.zeros((h, W), bool)

strip = src[:, BG_FROM:w - 2]      # 背景條；原圖最外 2 欄偏暗，不取
sw = strip.shape[1]

# 右側：image | hole | mirror(strip)
r_scaf = min(sw, ER // 2)
r_hole = ER - r_scaf
canvas[:, W - r_scaf:] = strip[:, ::-1][:, :r_scaf]  # 鏡像：貼著 hole 的是原圖最右欄
hole[:, EL + w - 2:W - r_scaf] = True
hole[790:1010, W - r_scaf:] = True  # 長椅、花台、霧帶交給 LaMa，不複製
hole[812:910, EL + w - 34:EL + w] = True  # 原圖右緣花台被切齊，補柔

# 左側：flip(strip) | hole | image —— 最左欄是原圖最右欄
l_scaf = min(sw, EL // 2)
l_hole = EL - l_scaf
canvas[:, :l_scaf] = strip[:, ::-1][:, :l_scaf]
hole[:, l_scaf:EL + 2] = True
hole[:470, :l_scaf] = True          # 左上天空直接補
hole[790:1010, :l_scaf] = True
hole[560:915, EL:EL + 36] = True     # 公寓與地面的合成直邊補柔
print('left scaffold', l_scaf, 'hole', l_hole, '| right hole', r_hole, 'scaffold', r_scaf)

sess = ort.InferenceSession(str(HERE / 'lama_fp32.onnx'), providers=['CPUExecutionProvider'])

def fill(x0):
    step = (h - T) / 2
    for y0 in [round(i * step) for i in range(3)]:
        m = hole[y0:y0 + T, x0:x0 + T]
        if not m.any():
            continue
        img = canvas[y0:y0 + T, x0:x0 + T].copy()
        img[m] = 0
        out = sess.run(None, {'image': img.transpose(2, 0, 1)[None], 'mask': m[None, None].astype(np.float32)})[0][0].transpose(1, 2, 0)
        out = np.clip(out / 255 if out.max() > 2 else out, 0, 1)
        canvas[y0:y0 + T, x0:x0 + T][m] = out[m]
        hole[y0:y0 + T, x0:x0 + T] = False

fill(0)
fill(W - T)
Image.fromarray((canvas * 255 + .5).astype(np.uint8)).save(OUT)
print(OUT, W, h)
