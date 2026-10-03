"""關於頁第一章紀念章的三張面圖（2026-10-03 取代拉紙條；10-04 正反交替）：正面大校徽、正面帶字版（小校徽）、背面金色校徽剪影。
校名與年份由 AboutMedal.vue 的 SVG 疊上。

流程：從開場布幕的高解析校徽去背（同 404 立體書的來源，只取 y<876、不含 30 週年緞帶）→ 本機伺服器開 render.html，
three.js 正面視角渲染（比稿 C 紀念章的材質）→ Playwright 截透明 PNG → 裁到徽章外框、縮成 256px WebP。
執行（repo 根目錄，Node 22、已 npm ci）：python3 scripts/about-medal/build.py
輸出 web/public/assets/about-medal/{front,label,back}.webp（給 web/app/components/AboutMedal.vue）。需 Pillow、numpy、Chrome。
比稿：design/about-medal-directions-20261003/（本機工作檔）。
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
SRC = ROOT / 'web/public/assets/ivy-30th-anniversary-projection.png'
OUT = ROOT / 'web/public/assets/about-medal'
CREST = HERE / '.crest.png'
CROP_BOTTOM = 876  # IVY KIDS 緞帶與 30 週年緞帶之間的整列空白
BG = np.array([253, 254, 247], np.float32)  # 原圖底色（四角中位數）
SIZE = 256  # 顯示最大 128px，2 倍密度


def extract_crest():
    """去米白底：從四角連通的近白區當背景，邊緣依離底色距離給 alpha、去白邊，置中到正方形。"""
    img = Image.open(SRC).convert('RGB')
    img = img.crop((0, 0, img.width, CROP_BOTTOM))
    rgb = np.asarray(img).astype(np.float32)
    dist = np.sqrt(((rgb - BG) ** 2).sum(axis=2))
    near = (dist < 14).astype(np.uint8) * 255  # 臉、手的膚色離底色只有 ~28，門檻要比它小
    flood = Image.fromarray(near).copy()  # Pillow 12：fromarray 共用記憶體，floodfill 前要 copy
    h, w = near.shape
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if flood.getpixel(seed) == 255:
            ImageDraw.floodfill(flood, seed, 128)
    bgmask = np.asarray(flood) == 128
    band = np.asarray(Image.fromarray(bgmask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
    alpha = np.where(bgmask, 0.0, np.where(band, np.clip((dist - 6) / 50, 0, 1), 1.0))
    a3 = alpha[..., None]
    clean = np.clip(np.where(a3 > 0.02, (rgb - BG * (1 - a3)) / np.maximum(a3, 0.02), 0), 0, 255)
    crest = Image.fromarray(np.dstack([clean, alpha * 255]).astype(np.uint8), 'RGBA')
    x0, y0, x1, y1 = crest.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    side = int(max(x1 - x0, y1 - y0) * 1.16)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(crest, ((side - (x1 - x0)) // 2 - x0, (side - (y1 - y0)) // 2 - y0))
    canvas.resize((1024, 1024), Image.LANCZOS).save(CREST)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    extract_crest()
    server = serve()
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['node', str(HERE / 'render.cjs'), str(server.server_address[1]), tmp], cwd=ROOT, check=True)
            for side in ['front', 'label', 'back']:
                im = Image.open(Path(tmp) / f'{side}.png').convert('RGBA')
                im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 4 else 0).getbbox())
                im.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / f'{side}.webp', 'WEBP', quality=88, method=6)
                print(side, (OUT / f'{side}.webp').stat().st_size, 'bytes')
    finally:
        server.shutdown()
        CREST.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
