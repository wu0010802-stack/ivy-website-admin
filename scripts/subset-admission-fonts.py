"""入學資訊頁（/admission）的字型：明體 Noto Serif TC，護照印章（SemiBold 600 小標、Black 900 印章字）。

來源是 notofonts/noto-cjk 的靜態 CFF OTF（非可變字型），SIL OFL 1.1，授權沒有 Reserved Font Name（子集可沿用原名，
不必像 LINE Seed TW 那樣改內部名稱）；原始檔釘 sha256，預設讀 output/fonts-src/（已 gitignore），沒有就下載。
CSS 的 font-family 另外取名 'Ivy Passport Serif'，避免跟使用者電腦裡可能裝的 Noto Serif TC 混用（字型內部名稱
不受影響，@font-face 的 font-family 才是瀏覽器實際比對的名稱）。需要 fontTools 與 Brotli：

  node scripts/admission-font-chars.cjs http://127.0.0.1:3107   # 先量本頁各字重實際用到的字（要起本機 server）
  uv run --no-project --with 'fonttools[woff]==4.63.0' python scripts/subset-admission-fonts.py

來源是靜態 CFF（.otf），沒有 glyf，不做可變字型 instancer；分片大小估算改用 CFF charstring 長度
（去 subroutine、去 hint 後 compile 取 bytecode 長度，只拿來分片，實際大小以實切為準——跟
scripts/subset-critical-fonts.py 的 costs() 同一招）。

每個字重切成：
1. critical：web/app/generated/admission-font-chars.json 裡那個字重在本頁畫得到的字（900 印章字另加英數與
   常用標點，600 小標同樣加英數標點）。宣告在 web/app/assets/css/admission-fonts.css（跟著頁面 CSS 進來）；
   900 那片由頁面預載（護照印章一進頁就蓋，是後台可改的文字：步驟名稱、穿著）。
2. 其餘（只有 900 印章字重做，600 小標是寫死文案，只切 critical）：
   scripts/data/noto-sans-tc-frequency-tiers.json 的常用字（Google Fonts 繁中切片的字頻層級）與標點，扣掉
   critical，由常用到罕用切成約 40 KB（上限 60 KB）的分片，宣告在帶雜湊的
   web/public/assets/fonts/admission/admission-fonts-extended-*.css，由頁面在執行時掛上
   （utils/admission-fonts.ts），用到新字時才下載那一片。字頻表以外的罕用字退回系統字。

同一個字重內 unicode-range 互斥。重跑會刪掉輸出目錄裡沒用到的舊雜湊檔；另外產出
web/app/generated/admission-font-manifest.json（預載與樣式表網址）與一份 OFL 授權全文。
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import unicodedata
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'output/fonts-src'
OUTPUT = ROOT / 'web/public/assets/fonts/admission'
PUBLIC_URL = '/assets/fonts/admission'
INLINE_CSS = ROOT / 'web/app/assets/css/admission-fonts.css'
MANIFEST = ROOT / 'web/app/generated/admission-font-manifest.json'
CHARS = ROOT / 'web/app/generated/admission-font-chars.json'
FREQUENCY = ROOT / 'scripts/data/noto-sans-tc-frequency-tiers.json'

NOTOCJK = 'https://github.com/notofonts/noto-cjk/raw/main/Serif/SubsetOTF/TC'
LICENSE_URL = 'https://github.com/notofonts/noto-cjk/raw/main/Serif/LICENSE'
LICENSE_CACHE_NAME = 'noto-cjk-serif-LICENSE'
LICENSE_FILE = 'noto-serif-tc-OFL.txt'

FAMILY = 'Ivy Passport Serif'  # CSS 字型名稱，避免跟系統可能裝的 Noto Serif TC 混用
SOURCES = {
    600: {
        'weight': 600, 'style': 'SemiBold', 'file': 'NotoSerifTC-SemiBold.otf', 'url': f'{NOTOCJK}/NotoSerifTC-SemiBold.otf',
        'sha256': 'e59aa64fa67b08efd000372cba5c4902424e50efef962084377c02c80f5ad593',
    },
    900: {
        'weight': 900, 'style': 'Black', 'file': 'NotoSerifTC-Black.otf', 'url': f'{NOTOCJK}/NotoSerifTC-Black.otf',
        'sha256': '55c68df309e702cdb56b9ffd6b8185468afc0cb070aa9c2f14099de0cae64d12',
    },
}
# (CSS 字重, 要不要其餘分片, 要不要預載, critical 要不要加英數標點)
FACES = [
    (900, True, True, True),
    (600, False, False, True),
]
TARGET_BYTES = 40_000
LIMIT_BYTES = 60_000
# 內文字重的英數與常用全形標點一律進 critical：頁面各處都有，不值得為它們多下載一片
BASICS = ''.join(chr(cp) for cp in range(0x20, 0x7F)) + '，。、：；！？「」『』（）・～—…％＋－'


def fetch(name: str, url: str) -> bytes:
    path = CACHE / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f'下載 {url} → {path.relative_to(ROOT)}')
        with urllib.request.urlopen(url) as response:
            path.write_bytes(response.read())
    return path.read_bytes()


def options() -> subset.Options:
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.hinting = False
    opts.desubroutinize = True  # CJK CFF 轉 woff2 比較小
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 14]
    opts.notdef_outline = True
    return opts


def unicode_range(codepoints: set[int]) -> str:
    runs: list[list[int]] = []
    for cp in sorted(codepoints):
        if runs and cp == runs[-1][1] + 1:
            runs[-1][1] = cp
        else:
            runs.append([cp, cp])
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in runs)


class Face:
    def __init__(self, weight: int):
        spec = SOURCES[weight]
        data = fetch(spec['file'], spec['url'])
        digest = hashlib.sha256(data).hexdigest()
        assert digest == spec['sha256'], f"{spec['file']} 的 sha256 是 {digest}，跟釘住的不同；上游改版時先核對授權與字形再更新"
        font = TTFont(io.BytesIO(data), recalcTimestamp=False)
        self.weight, self.data = weight, data
        self.cmap = font.getBestCmap()
        self.advance = {cp: font['hmtx'][glyph][0] for cp, glyph in self.cmap.items()}

    def costs(self) -> dict[int, int]:
        """每字去 subroutine、去 hint 後的 charstring 長度，只拿來分片；CFF 沒有 glyf 可量輪廓點數。"""
        font = TTFont(io.BytesIO(self.data), recalcTimestamp=False)
        subsetter = subset.Subsetter(options())
        subsetter.populate(unicodes=set(self.cmap))
        subsetter.subset(font)
        charstrings = font['CFF '].cff.topDictIndex[0].CharStrings
        result: dict[int, int] = {}
        for cp, glyph in font.getBestCmap().items():
            charstring = charstrings[glyph]
            charstring.compile()
            result[cp] = max(1, len(charstring.bytecode))
        return result

    def build(self, codepoints: set[int]) -> bytes:
        font = TTFont(io.BytesIO(self.data), recalcTimestamp=False, lazy=True)
        subsetter = subset.Subsetter(options())
        subsetter.populate(unicodes=codepoints)
        subsetter.subset(font)
        # 康熙部首、相容漢字和本字共用字形，subsetter 會把它們一起留在 cmap；只留規劃的字，
        # 讓 cmap 與 unicode-range 一致（同一個字不會出現在兩片的 cmap 裡）
        for table in font['cmap'].tables:
            if table.format != 14:
                table.cmap = {cp: glyph for cp, glyph in table.cmap.items() if cp in codepoints}
        font.flavor = 'woff2'
        buffer = io.BytesIO()
        font.save(buffer)
        data = buffer.getvalue()
        check = TTFont(io.BytesIO(data))
        cmap = check.getBestCmap()
        assert set(cmap) == codepoints, f'serif-{self.weight}: 字形覆蓋與規劃不同'
        for cp, glyph in cmap.items():
            assert check['hmtx'][glyph][0] == self.advance[cp], f'serif-{self.weight} U+{cp:04X}: 字寬改變'
        return data


def pack(chars: list[int], cost: dict[int, int], budget: float) -> list[list[int]]:
    """依序切成 ceil(總量／budget) 片，每片估算量盡量平均。"""
    total = sum(cost[cp] for cp in chars)
    count = max(1, math.ceil(total / budget))
    groups: list[list[int]] = []
    current: list[int] = []
    spent = 0
    for cp in chars:
        current.append(cp)
        spent += cost[cp]
        if len(groups) < count - 1 and spent >= total * (len(groups) + 1) / count:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def main() -> None:
    logging.getLogger('fontTools').setLevel(logging.ERROR)
    used = json.loads(CHARS.read_text(encoding='utf-8'))['groups']
    tiers = json.loads(FREQUENCY.read_text(encoding='utf-8'))['tiers']
    tier_of: dict[int, int] = {}
    for index, tier in enumerate(tiers):
        for char in tier:
            tier_of.setdefault(ord(char), index)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    written: set[str] = set()
    inline_rules: list[str] = []
    extended_rules: list[str] = []
    manifest: dict = {'sources': [], 'preload': [], 'stylesheet': None, 'faces': {}}
    for weight, extend, preload, basics in FACES:
        face = Face(weight)
        wanted = {ord(char) for char in used.get(f'serif-{weight}', '') + (BASICS if basics else '')} | {0x20}
        missing = sorted(cp for cp in wanted if cp not in face.cmap)
        assert not [cp for cp in missing if unicodedata.category(chr(cp)).startswith('Lo')], \
            f"{FAMILY} {weight} 缺本頁用字：{''.join(chr(cp) for cp in missing)}"
        critical = wanted & set(face.cmap)
        plan: list[tuple[str, list[int]]] = [('critical', sorted(critical))]
        if extend:
            cost = face.costs()
            rest = set(face.cmap) - critical
            marks = sorted(cp for cp in rest if unicodedata.category(chr(cp))[0] in 'PS')
            common = marks + sorted((cp for cp in rest if cp in tier_of and cp not in marks), key=lambda cp: (tier_of[cp], cp))
            probe = set(common[len(common) // 2:len(common) // 2 + 150])
            budget = TARGET_BYTES / (len(face.build(probe)) / sum(cost[cp] for cp in probe))
            plan += [('common', group) for group in pack(common, cost, budget)]

        built: list[tuple[str, set[int], bytes]] = []
        while plan:
            kind, group = plan.pop(0)
            codepoints = set(group)
            data = face.build(codepoints)
            if kind == 'common' and len(group) > 1 and len(data) > LIMIT_BYTES:
                half = len(group) // 2
                plan[:0] = [(kind, group[:half]), (kind, group[half:])]
                continue
            built.append((kind, codepoints, data))
        covered: set[int] = set()
        for _, codepoints, _ in built:
            assert not covered & codepoints, f'serif-{weight}: 分片的 unicode-range 重疊'
            covered |= codepoints

        key = f'serif-{weight}'
        summary: dict = {'family': FAMILY, 'weight': weight, 'characters': len(covered), 'slices': len(built), 'bytes': 0, 'largest': 0, 'critical': None}
        for number, (kind, codepoints, data) in enumerate(built):
            label = 'critical' if kind == 'critical' else f'{number:03d}'
            filename = f'{key}-{label}-{hashlib.sha256(data).hexdigest()[:12]}.woff2'
            target = OUTPUT / filename
            if not target.exists() or target.read_bytes() != data:
                target.write_bytes(data)
            written.add(filename)
            url = f'{PUBLIC_URL}/{filename}'
            rule = f"@font-face{{font-family:'{FAMILY}';font-weight:{weight};font-display:swap;src:url({url}) format('woff2');unicode-range:{unicode_range(codepoints)}}}"
            (inline_rules if kind == 'critical' else extended_rules).append(rule)
            summary['bytes'] += len(data)
            summary['largest'] = max(summary['largest'], len(data))
            if kind == 'critical':
                summary['critical'] = {'src': url, 'bytes': len(data), 'characters': len(codepoints)}
                if preload:
                    manifest['preload'].append(url)
        manifest['faces'][key] = summary
        print(f"{FAMILY} {weight}: {len(covered)} 字、{len(built)} 片、共 {summary['bytes'] / 1e6:.2f} MB；critical {summary['critical']['characters']} 字 {summary['critical']['bytes'] / 1e3:.0f} KB")

    for weight, spec in SOURCES.items():
        manifest['sources'].append({'weight': weight, 'style': spec['style'], 'url': spec['url'], 'sha256': spec['sha256']})
    license_text = fetch(LICENSE_CACHE_NAME, LICENSE_URL).decode('utf-8').lstrip('﻿')
    flat = ' '.join(license_text.split())
    assert 'SIL Open Font License, Version 1.1' in flat, f'{LICENSE_FILE} 不是 OFL 1.1，先重新核對'
    assert 'Reserved Font Name "' not in flat, f'{LICENSE_FILE} 有 Reserved Font Name，子集要改內部名稱'
    (OUTPUT / LICENSE_FILE).write_text(license_text, encoding='utf-8')
    written.add(LICENSE_FILE)

    extended = '/* Generated by scripts/subset-admission-fonts.py：入學資訊頁字型的其餘分片（執行時掛上）。 */\n' + '\n'.join(extended_rules) + '\n'
    sheet = f'admission-fonts-extended-{hashlib.sha256(extended.encode()).hexdigest()[:12]}.css'
    (OUTPUT / sheet).write_text(extended, encoding='utf-8')
    written.add(sheet)
    manifest['stylesheet'] = {'src': f'{PUBLIC_URL}/{sheet}', 'bytes': len(extended.encode())}
    INLINE_CSS.write_text('/* Generated by scripts/subset-admission-fonts.py：入學資訊頁字型各字重的 critical 分片（本頁實際用字）；其餘分片見 admission-font-manifest.json 的 stylesheet。 */\n' + '\n'.join(inline_rules) + '\n', encoding='utf-8')
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for stale in OUTPUT.iterdir():
        if stale.name not in written:
            stale.unlink()
    print(f'extended 樣式表 {sheet}（{len(extended.encode()) / 1e3:.0f} KB）')


if __name__ == '__main__':
    main()
