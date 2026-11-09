"""產生後台 PWA（加到手機主畫面）的圖示：admin/public/pwa-192.png、pwa-512.png、pwa-maskable-512.png。

執行：python3 scripts/build-admin-pwa-icons.py（需 Pillow；backend/.venv 裡就有）。可重跑，輸出固定。
來源是 admin/src/assets/brand/ivy-crest.webp（714×760，透明底的常春藤校徽）。

- pwa-192／pwa-512（purpose any）：校徽放在後台頁面底色上，高度約占 84%。
- pwa-maskable-512（purpose maskable）：Android 會依機型把圖示裁成圓形、圓角方形等，只有中央安全區
  （半徑 40% 的圓）保證看得到，所以校徽縮到「每個不透明像素都在中心半徑 40% 內」，底色鋪滿整張，
  被裁掉的只有底色。縮放比例由程式依實際像素計算並檢查，不是估的。
- 底色 BACKGROUND 與 admin/public/manifest.webmanifest 的 background_color 同一個值（後台 style.css 的
  --surface-2 oklch(0.973 0.005 250) 換成 sRGB 的 #f4f6f9）。改底色要兩邊一起改。"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "admin/src/assets/brand/ivy-crest.webp"
OUT = ROOT / "admin/public"
BACKGROUND = (0xF4, 0xF6, 0xF9, 255)

ANY_HEIGHT_RATIO = 0.84
SAFE_RADIUS_RATIO = 0.40  # maskable 安全區：直徑 80% 的圓
SAFE_MARGIN = 0.985  # 不貼著安全區邊緣


def render(size: int, crest: Image.Image, height_ratio: float) -> Image.Image:
    scale = size * height_ratio / crest.height
    resized = crest.resize((round(crest.width * scale), round(crest.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def farthest_opaque_pixel(canvas_size: int, crest: Image.Image, height_ratio: float) -> float:
    """校徽縮放並置中後，不透明像素（alpha > 16）離圖示中心最遠的距離，除以圖示邊長。"""
    scale = canvas_size * height_ratio / crest.height
    width, height = round(crest.width * scale), round(crest.height * scale)
    alpha = crest.resize((width, height), Image.LANCZOS).getchannel("A")
    offset_x, offset_y = (canvas_size - width) / 2, (canvas_size - height) / 2
    center = canvas_size / 2
    farthest = 0.0
    pixels = alpha.load()
    for y in range(height):
        for x in range(width):
            if pixels[x, y] > 16:
                farthest = max(farthest, math.hypot(offset_x + x + 0.5 - center, offset_y + y + 0.5 - center))
    return farthest / canvas_size


def maskable_height_ratio(crest: Image.Image) -> float:
    """最大的高度比例，使校徽所有不透明像素都在安全區（半徑 40%）內。"""
    probe = 512
    low, high = 0.3, 0.9
    for _ in range(14):
        mid = (low + high) / 2
        if farthest_opaque_pixel(probe, crest, mid) <= SAFE_RADIUS_RATIO * SAFE_MARGIN:
            low = mid
        else:
            high = mid
    return low


def main() -> None:
    crest = Image.open(SOURCE).convert("RGBA")
    ratio = maskable_height_ratio(crest)
    assert farthest_opaque_pixel(512, crest, ratio) <= SAFE_RADIUS_RATIO, "maskable 校徽超出安全區"
    jobs = {
        "pwa-192.png": (192, ANY_HEIGHT_RATIO),
        "pwa-512.png": (512, ANY_HEIGHT_RATIO),
        "pwa-maskable-512.png": (512, ratio),
    }
    for name, (size, height_ratio) in jobs.items():
        target = OUT / name
        render(size, crest, height_ratio).convert("RGB").save(target, "PNG", optimize=True)
        print(f"{target.relative_to(ROOT)}  {size}×{size}  校徽高度 {height_ratio:.1%}")
    print(f"maskable 安全區檢查：最遠像素 {farthest_opaque_pixel(512, crest, ratio):.3f}（上限 {SAFE_RADIUS_RATIO}）")


if __name__ == "__main__":
    main()
