#!/usr/bin/env python3
"""階段 A 缺字檢查：比對 fixture 全部標題／品牌欄位對 LINE Seed TW
子集與品牌字子集 cmap 的涵蓋率。規則見 CLAUDE.md「字型子集」章節與
docs/superpowers/plans 2026-09-19 Task 2 checklist 第 4 項。

用法：python3 scripts/check-font-coverage.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "content" / "site-fixture.json"
FONTS = {
    "lineseed-bd": ROOT / "assets/fonts/lineseed-bd.woff",
    "lineseed-eb": ROOT / "assets/fonts/lineseed-eb.woff",
    "noto-sans-tc-600-brand": ROOT / "assets/fonts/noto-sans-tc-600-brand.woff",
}


def font_charset(path: Path) -> set[str]:
    font = TTFont(str(path))
    cmap = font.getBestCmap()
    return {chr(codepoint) for codepoint in cmap.keys()}


def collect_strings(node, bucket: list[str]) -> None:
    if isinstance(node, str):
        bucket.append(node)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key.startswith("_"):
                continue
            collect_strings(value, bucket)
    elif isinstance(node, list):
        for item in node:
            collect_strings(item, bucket)


# 只抽取「標題類」欄位：h1/h2/h3 級文案。用欄位名稱白名單而非全文，
# 避免把長篇內文（bodyText/description 等）算進「標題字型」涵蓋率。
TITLE_FIELD_NAMES = {
    "title", "eyebrow", "sectionTitle", "name", "label", "caption",
    "question", "sinceLabel", "before", "middle", "growingWord",
    "top", "bottom", "watermark",
}


def collect_title_strings(node, bucket: list[str], key_name: str | None = None) -> None:
    if isinstance(node, str):
        if key_name in TITLE_FIELD_NAMES:
            bucket.append(node)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key.startswith("_"):
                continue
            collect_title_strings(value, bucket, key)
    elif isinstance(node, list):
        for item in node:
            collect_title_strings(item, bucket, key_name)


def main() -> int:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    title_strings: list[str] = []
    collect_title_strings(fixture, title_strings)
    # 也加入常駐品牌字串（不在 fixture 內容樹裡的固定文案）
    title_strings.append("常春藤教育機構")
    title_strings.append("常春藤幼兒園")

    all_chars: set[str] = set()
    for s in title_strings:
        all_chars.update(re.sub(r"[\s\n]", "", s))

    charsets = {name: font_charset(path) for name, path in FONTS.items() if path.exists()}
    missing_from_any = {}
    print(f"標題類文字共 {len(title_strings)} 段，去重後 {len(all_chars)} 個字元。\n")

    for name, charset in charsets.items():
        missing = sorted(c for c in all_chars if c not in charset and not c.isascii())
        missing_from_any[name] = missing
        status = "OK" if not missing else f"缺 {len(missing)} 字"
        print(f"[{name}] {status}")
        if missing:
            print("  缺字：" + " ".join(missing))

    heading_only = {name: cs for name, cs in charsets.items() if name.startswith("lineseed")}
    combined_heading_missing = sorted(
        c for c in all_chars
        if not c.isascii() and not any(c in cs for cs in heading_only.values())
    )
    print(f"\n[lineseed-bd ∪ lineseed-eb 合併涵蓋] {'OK' if not combined_heading_missing else f'缺 {len(combined_heading_missing)} 字'}")
    if combined_heading_missing:
        print("  缺字：" + " ".join(combined_heading_missing))

    return 1 if combined_heading_missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
