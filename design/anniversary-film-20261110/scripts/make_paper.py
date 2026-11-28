"""產生影片用的米白紙紋（橫式 2112×1188、直式 1188×2112，比畫面大 1.1 倍，留給鏡頭微動）。

底色取 --paper #FDFCF6 與 --cream #F5F2E5 之間，加低頻斑駁、纖維與細顆粒；起伏都在 ±1.5% 以內，
不會出現色階斷層。輸出 output/anniversary-film/stills/paper.png。
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
STILLS = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'output', 'anniversary-film', 'stills'))


def make(W, H, name):
    rng = np.random.default_rng(1997)

    base = np.array([251, 249, 241], np.float32)  # 約 #FBF9F1
    low = ndimage.gaussian_filter(rng.standard_normal((H, W)), 90)
    low /= np.abs(low).max()
    mid = ndimage.gaussian_filter(rng.standard_normal((H, W)), 12)
    mid /= np.abs(mid).max()
    fib = ndimage.gaussian_filter(rng.standard_normal((H, W)), (0.6, 7))  # 橫向纖維
    fib /= np.abs(fib).max()
    grain = rng.standard_normal((H, W)) * 0.5
    lum = 1 + 0.012 * low + 0.006 * mid + 0.010 * fib + 0.004 * grain
    img = base[None, None, :] * lum[..., None]
    # 斑駁處略偏暖（紙的黃），亮處略偏白
    img[..., 2] -= 3.0 * np.clip(-low, 0, 1)
    img = np.clip(img + rng.uniform(-0.5, 0.5, img.shape), 0, 255).astype(np.uint8)
    os.makedirs(STILLS, exist_ok=True)
    OUT = os.path.join(STILLS, name)
    Image.fromarray(img).save(OUT, optimize=True)
    print(OUT, img.reshape(-1, 3).mean(0))


make(2112, 1188, 'paper.png')
make(1188, 2112, 'paper-v.png')
