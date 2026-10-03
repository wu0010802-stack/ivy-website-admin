"""404 頁立體書校徽的五張紙片：從開場布幕的高解析校徽拆層，每層加米白紙邊，輸出 WebP。

來源 web/public/assets/ivy-30th-anniversary-projection.png 只取 y<876（IVY KIDS 緞帶以上，不含 30 週年緞帶）。
執行（repo 根目錄）：python3 scripts/build-crest-popup.py
輸出 web/public/assets/crest-popup/{base,wreath,top,kids,banner}.webp（480px，對應 web/app/utils/crest-popup.ts 的 CREST_LAYERS）。
比稿與原理：design/logo-3d-directions-20261003/（本機工作檔）。需 Pillow、numpy。
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'web/public/assets/ivy-30th-anniversary-projection.png'
OUT = ROOT / 'web/public/assets/crest-popup'
CROP_BOTTOM = 876  # IVY KIDS 緞帶與 30 週年緞帶之間的整列空白
BG = np.array([253, 254, 247], np.float32)  # 原圖底色（四角中位數）
PAPER = (255, 253, 245)  # --ivy-ivory
WORK = 1024
SIZE = 480


def floodfill_mask(mask, seed=(0, 0)):
    """回傳從 seed 連通的區域。Pillow 12 的 fromarray 共用記憶體，floodfill 前要 copy。"""
    im = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8)).copy()
    ImageDraw.floodfill(im, seed, 128)
    return np.asarray(im) == 128


def blur_threshold(mask, radius, t):
    im = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(im).astype(np.float32) / 255 > t


def cut_crest():
    rgb = np.asarray(Image.open(SRC).convert('RGB').crop((0, 0, 1254, CROP_BOTTOM))).astype(np.float32)
    dist = np.sqrt(((rgb - BG) ** 2).sum(axis=2))
    # 背景＝從角落連通的近白區。臉與手的膚色離底色只有約 28，門檻要比它小，否則臉會被挖空。
    core = floodfill_mask(dist < 14)
    band = np.asarray(Image.fromarray(core.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
    alpha = np.where(core, 0.0, np.where(band, np.clip((dist - 6) / 50, 0, 1), 1.0))
    a3 = alpha[..., None]
    clean = np.clip(np.where(a3 > 0.02, (rgb - BG * (1 - a3)) / np.maximum(a3, 0.02), 0), 0, 255)  # 去白邊
    crest = Image.fromarray(np.dstack([clean, alpha * 255]).astype(np.uint8), 'RGBA')
    x0, y0, x1, y1 = crest.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    side = int(max(x1 - x0, y1 - y0) * 1.16)  # 四周留白給紙邊
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(crest, ((side - (x1 - x0)) // 2 - x0, (side - (y1 - y0)) // 2 - y0))
    return canvas.resize((WORK, WORK), Image.LANCZOS), side, (side - (x1 - x0)) // 2 - x0, (side - (y1 - y0)) // 2 - y0


def split_layers(crest, side, ox, oy):
    alpha = np.asarray(crest.getchannel('A')).astype(np.float32) / 255
    ink = alpha > 0.35
    s = WORK / side
    to_work = lambda x, y: (int((x + ox) * s), int((y + oy) * s))  # 原圖座標 → 工作座標
    component = lambda seed: floodfill_mask(ink, seed)
    masks = {
        'kids': component(to_work(470, 440)) | component(to_work(700, 460)),
        'banner': component(to_work(620, 790)),
    }
    # 剩下的是一片片葉子、星星、皇冠、頭髮：逐塊依平均色分到麥穗（綠）、頂部（金）或小孩（深藍頭髮）
    rest = ink & ~masks['kids'] & ~masks['banner']
    masks['wreath'] = np.zeros_like(ink)
    masks['top'] = np.zeros_like(ink)
    colours = np.asarray(crest)[..., :3]
    todo = rest.copy()
    while todo.any():
        ys, xs = np.nonzero(todo)
        piece = component((int(xs[0]), int(ys[0]))) & rest
        if not piece.any():
            todo[ys[0], xs[0]] = False
            continue
        r, g, b = colours[piece].mean(axis=0)
        masks['wreath' if g > r + 15 else 'top' if (r > 170 and b < 120) else 'kids'] |= piece
        todo &= ~piece
    return alpha, masks


def paper(part_alpha, crest, margin):
    """部件＋米白紙邊（像立體書裁下的紙片）。"""
    edge = ~floodfill_mask(~blur_threshold(part_alpha > 0.5, margin, 0.08))
    out = np.zeros((WORK, WORK, 4), np.float32)
    out[..., :3] = PAPER
    out[..., 3] = np.asarray(Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)))
    src = np.asarray(crest).astype(np.float32)
    pa = part_alpha[..., None]
    out[..., :3] = src[..., :3] * pa + out[..., :3] * (1 - pa)
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def main():
    crest, side, ox, oy = cut_crest()
    alpha, masks = split_layers(crest, side, ox, oy)
    OUT.mkdir(parents=True, exist_ok=True)
    layers = {name: paper(alpha * blur_threshold(masks[name], 2.5, 0.05), crest, 9) for name in ('wreath', 'top', 'kids', 'banner')}
    # 底板：整個校徽擴邊、補洞、平滑後的米白紙卡
    sticker = ~floodfill_mask(~blur_threshold(alpha > 0.5, 26, 0.06))
    sticker = ~floodfill_mask(~blur_threshold(sticker, 10, 0.5))
    base = np.zeros((WORK, WORK, 4), np.uint8)
    base[..., :3] = PAPER
    base[..., 3] = np.asarray(Image.fromarray((sticker * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)))
    layers['base'] = Image.fromarray(base, 'RGBA')
    for name, im in layers.items():
        path = OUT / f'{name}.webp'
        im.resize((SIZE, SIZE), Image.LANCZOS).save(path, 'WEBP', quality=86, method=6)
        print(f'{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
