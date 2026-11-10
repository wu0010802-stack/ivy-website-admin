#!/usr/bin/env python3
"""後台「使用小技巧」截圖：output/admin-tips/*.png → admin/src/assets/tips/*.webp＋manifest.json。

PNG 由 tests/stack/admin-tips-shots.spec.ts 以 2 倍像素拍（見該檔開頭的指令）。這裡：
- 寬度超過 MAX_WIDTH 像素的等比縮小（頁面上寬截圖放在文字下方、最寬約 1100 CSS 像素，2 倍就夠 Retina）；
- 轉成 WebP（本機 ffmpeg 沒有 libwebp，用 Pillow）；
- manifest.json 記每張的 CSS 尺寸（像素 ÷ 2），頁面拿來寫 <img width height>，載入時不跳版。
資料夾裡多出來、這次沒有 PNG 的舊 WebP 會刪掉（tips.test.ts 也會擋沒人用的截圖）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "output" / "admin-tips"
DEST = ROOT / "admin" / "src" / "assets" / "tips"
MAX_WIDTH = 2200
QUALITY = 82


def main() -> int:
    pngs = sorted(SRC.glob("*.png"))
    if not pngs:
        print(f"找不到截圖：{SRC}（先跑 ADMIN_TIPS_SHOTS=1 的 stack 測試）", file=sys.stderr)
        return 1
    DEST.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, int]] = {}
    total = 0
    for png in pngs:
        with Image.open(png) as image:
            image = image.convert("RGB")
            if image.width > MAX_WIDTH:
                height = round(image.height * MAX_WIDTH / image.width)
                image = image.resize((MAX_WIDTH, height), Image.LANCZOS)
            out = DEST / f"{png.stem}.webp"
            image.save(out, "WEBP", quality=QUALITY, method=6)
            manifest[png.stem] = {"width": round(image.width / 2), "height": round(image.height / 2)}
        size = out.stat().st_size
        total += size
        print(f"{out.name:28} {manifest[png.stem]['width']:>4}×{manifest[png.stem]['height']:<4} {size / 1024:6.1f} KB")
    for stale in DEST.glob("*.webp"):
        if stale.stem not in manifest:
            stale.unlink()
            print(f"刪除沒有截圖的舊檔 {stale.name}")
    (DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"共 {len(manifest)} 張，{total / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
