"""延伸後的 1x 圖（outpaint.py 輸出 1880×1123）→ 義華 v2 母檔 2820×1684。

前一步：realesrgan-ncnn-vulkan -i ext.png -o ext-x4.png -n realesrgan-x4plus -t 256
（Real-ESRGAN v0.2.5.0 macOS ncnn 版，M2 上約 100 秒）

1. x4 結果 LANCZOS 縮到 1.5 倍（2820×1684）。
2. 直式招牌「常春藤幼稚園」與上方英文字：Real-ESRGAN 會把立體字的側面誇大、改掉字形，
   只在字形周圍換回原圖 LANCZOS 1.5 倍＋輕微 unsharp（遮罩限在字的那一欄與英文那一行）。
3. WebP q90（method 6）存成 web/public/assets/yihua-exterior-v2.webp。
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ext_path, x4_path, out_path = sys.argv[1:4]
ext = Image.open(ext_path).convert('RGB')
W, H = round(ext.width * 1.5), round(ext.height * 1.5)
es = Image.open(x4_path).convert('RGB').resize((W, H), Image.LANCZOS)
lz = ext.resize((W, H), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))

box = tuple(round(v * 1.5) for v in (1490, 300, 1630, 690))  # 延伸座標（原圖 +200）的招牌區
a = np.asarray(lz.crop(box)).astype(float)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
y = .299 * r + .587 * g + .114 * b
m = ((g - r > 12) & (y < 170)) | (y < 125)          # 綠色字面＋深色側面
region = np.zeros_like(m)
region[80:560, 45:130] = True                       # 中文字那一欄
region[22:82, 8:200] = True                         # 英文字那一行
m &= region
mask = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2.5))
full = Image.new('L', es.size, 0)
full.paste(mask, box[:2])
Image.composite(lz, es, full).save(out_path, 'WEBP', quality=90, method=6)
print(out_path, W, H)
