#!/usr/bin/env python3
"""產生 LINE 圖文選單的四張底圖（backend/app/notifications/richmenu/*.png，2500×843）。

    python3 scripts/build-line-rich-menu-images.py

用本機的 Google Chrome（headless）把一頁 HTML 拍成圖：字型是官網的 LINE Seed TW 子集
（web/app/assets/css/font-subsets.css），圖示取自官網的 Phosphor Regular sprite（web/app/components/IconSprite.vue），
顏色是官網的 token。選單上的字要在子集裡才行（缺字會退回系統字型）——改字之前先查，腳本也會擋。
格子的字與順序要和 backend/app/notifications/line_rich_menus.py 的 build_specs 一致。

LINE 的限制：JPEG／PNG、寬 800–2500、高 ≥250、寬高比 ≥1.45、1 MB 以內。圖上傳後不能換，
改了圖之後後台會顯示「選單內容有更新」，要按重新套用。"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend/app/notifications/richmenu"
FONT_CSS = ROOT / "web/app/assets/css/font-subsets.css"
SPRITE = ROOT / "web/app/components/IconSprite.vue"
PUBLIC = ROOT / "web/public"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WIDTH, HEIGHT = 2500, 843
CELLS = (833, 834, 833)

# 檔名 → 三格（字, 圖示）；第一格是主要動作（深綠底）。
MENUS = {
    "campus-default.png": (("預約參觀", "calendar-check"), ("園所位置", "map-pin"), ("撥打電話", "phone")),
    "campus-booked.png": (("我的預約", "magnifying-glass"), ("園所位置", "map-pin"), ("撥打電話", "phone")),
    "shared-default.png": (("預約參觀", "calendar-check"), ("校園環境", "tree"), ("官方網站", "house-line")),
    "shared-booked.png": (("我的預約", "magnifying-glass"), ("校園環境", "tree"), ("官方網站", "house-line")),
}


def covered_codepoints(css: str) -> set[int]:
    points: set[int] = set()
    for ranges in re.findall(r"unicode-range:([^;}]+)", css):
        for part in ranges.split(","):
            part = part.strip()[2:]
            if "-" in part:
                first, last = part.split("-")
                points.update(range(int(first, 16), int(last, 16) + 1))
            else:
                points.add(int(part, 16))
    return points


def page(cells: tuple[tuple[str, str], ...], font_css: str, symbols: str) -> str:
    columns = " ".join(f"{width}px" for width in CELLS)
    items = "".join(
        f'<div class="cell{" main" if index == 0 else ""}"><svg viewBox="0 0 256 256"><use href="#i-{icon}"/></svg>'
        f"<span>{label}</span></div>"
        for index, (label, icon) in enumerate(cells)
    )
    return f"""<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>
{font_css}
:root{{--green:oklch(37% .057 157);--paper:oklch(99% .008 95);--line:oklch(86% .018 145)}}
*{{box-sizing:border-box;margin:0}}
html,body{{width:{WIDTH}px;height:{HEIGHT}px;overflow:hidden;background:var(--paper)}}
.menu{{display:grid;grid-template-columns:{columns};width:{WIDTH}px;height:{HEIGHT}px}}
.cell{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:52px;color:var(--green);
  border-left:4px solid var(--line);font-family:'LINE Seed TW',sans-serif;font-weight:700;font-size:112px;
  line-height:1;letter-spacing:.06em}}
.cell span{{margin-right:-.06em}}
.cell:first-child,.cell.main+.cell{{border-left:0}}
.cell.main{{background:var(--green);color:var(--paper)}}
.cell svg{{width:232px;height:232px;fill:currentColor}}
</style><svg width="0" height="0" style="position:absolute">{symbols}</svg><div class="menu">{items}</div></html>"""


def main() -> int:
    css = FONT_CSS.read_text(encoding="utf-8")
    covered = covered_codepoints(css)
    missing = sorted({char for cells in MENUS.values() for label, _ in cells for char in label if ord(char) not in covered})
    if missing:
        print(f"這些字不在 LINE Seed TW 子集裡，請換字：{''.join(missing)}", file=sys.stderr)
        return 1
    font_css = css.replace("url(/assets/", f"url({PUBLIC.as_uri()}/assets/")
    sprite = SPRITE.read_text(encoding="utf-8")
    symbols = "".join(re.findall(r"<symbol\b.*?</symbol>", sprite, flags=re.S))
    for name, cells in MENUS.items():
        for _, icon in cells:
            if f'id="i-{icon}"' not in symbols:
                print(f"sprite 裡沒有圖示 i-{icon}", file=sys.stderr)
                return 1
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, cells in MENUS.items():
            html = Path(tmp) / f"{name}.html"
            html.write_text(page(cells, font_css, symbols), encoding="utf-8")
            target = OUT / name
            subprocess.run(
                [
                    CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={WIDTH},{HEIGHT}", "--virtual-time-budget=4000", f"--screenshot={target}",
                    "--allow-file-access-from-files", html.as_uri(),
                ],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
            )
            size = target.stat().st_size
            print(f"{name}: {size / 1024:.0f} KB")
            if size > 1_000_000:
                print(f"{name} 超過 1 MB，LINE 不收", file=sys.stderr)
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
