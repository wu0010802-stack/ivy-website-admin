"""常春藤環境頁（/environment，2026-09-28 手繪版）的字型：圓體 Chiron GoRound TC 與手寫芫荽 Iansui。

兩套都是 SIL OFL 1.1（Google Fonts 收錄版，授權沒有 Reserved Font Name，子集可沿用原名），原始檔釘 sha256，
預設讀 output/fonts-src/（已 gitignore），沒有就下載。需要 fontTools 與 Brotli：

  node scripts/environment-font-chars.cjs http://127.0.0.1:3107   # 先量本頁各字重實際用到的字（要起本機 server）
  uv run --no-project --with 'fonttools[woff]==4.63.0' python scripts/subset-environment-fonts.py

圓體原檔是可變字型（wght 200–900）。這頁只用 400（內文）、700（小標）、800（大標），先各做成固定字重：
固定字重不帶可變差量，同樣的字小一半以上（2026-09-28 實測可變版每字約 730 bytes）。

每個字重切成：
1. critical：web/app/generated/environment-font-chars.json 裡那個字重在本頁一開始就畫得到的字（圓體 400 再加英數與
   常用標點）。宣告在 web/app/assets/css/environment-fonts.css（跟著頁面 CSS 進來）；大標那片由頁面預載。
2. tour：還沒切到的校園探索分頁用到、但 critical 沒有的字，另切一片，切過去才下載（同樣宣告在 inline CSS）。
3. 其餘（只有會顯示後台文字的字重才做：圓體 400 的校園探索說明、芫荽的場景名與標註名）：
   scripts/data/noto-sans-tc-frequency-tiers.json 的常用字（Google Fonts 繁中切片的字頻層級）與標點，扣掉 critical，
   由常用到罕用切成約 40 KB（上限 60 KB）的分片，宣告在帶雜湊的
   web/public/assets/fonts/environment/environment-fonts-extended-*.css，由頁面在執行時掛上（utils/environment-fonts.ts），
   用到新字時才下載那一片。字頻表以外的罕用字、以及 700／800 不在本頁的字退回系統字。

同一個字重內 unicode-range 互斥。重跑會刪掉輸出目錄裡沒用到的舊雜湊檔；另外產出
web/app/generated/environment-font-manifest.json（預載與樣式表網址）與兩份 OFL 授權全文。
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import re
import unicodedata
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'output/fonts-src'
OUTPUT = ROOT / 'web/public/assets/fonts/environment'
PUBLIC_URL = '/assets/fonts/environment'
INLINE_CSS = ROOT / 'web/app/assets/css/environment-fonts.css'
MANIFEST = ROOT / 'web/app/generated/environment-font-manifest.json'
CHARS = ROOT / 'web/app/generated/environment-font-chars.json'
FREQUENCY = ROOT / 'scripts/data/noto-sans-tc-frequency-tiers.json'
GOOGLE = 'https://github.com/google/fonts/raw/main/ofl'

SOURCES = {
    'round': {
        'family': 'Chiron GoRound TC', 'file': 'ChironGoRoundTC[wght].ttf', 'url': f'{GOOGLE}/chirongoroundtc/ChironGoRoundTC%5Bwght%5D.ttf',
        'sha256': '47cd5ff5153799d4c0d05bcc64da849e13b8eb842e46728a66bf2d52c480231f',
        'license': 'chiron-goround-tc-OFL.txt', 'license_url': f'{GOOGLE}/chirongoroundtc/OFL.txt',
    },
    'hand': {
        'family': 'Iansui', 'file': 'Iansui-Regular.ttf', 'url': f'{GOOGLE}/iansui/Iansui-Regular.ttf',
        'sha256': '6e6340d80d618a42b48ade9370c34fa37a8210750c6fbc8efe65f23716538a2b',
        'license': 'iansui-OFL.txt', 'license_url': f'{GOOGLE}/iansui/OFL.txt',
    },
}
# (字型, CSS 字重, 可變軸位置, 要不要其餘分片, 要不要預載, critical 要不要加英數標點)
FACES = [
    ('round', 800, {'wght': 800}, False, True, False),
    ('round', 700, {'wght': 700}, False, False, False),
    ('round', 400, {'wght': 400}, True, False, True),
    ('hand', 400, None, True, False, False),
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
    def __init__(self, code: str, weight: int, location: dict | None):
        spec = SOURCES[code]
        data = fetch(spec['file'], spec['url'])
        digest = hashlib.sha256(data).hexdigest()
        assert digest == spec['sha256'], f"{spec['file']} 的 sha256 是 {digest}，跟釘住的不同；上游改版時先核對授權與字形再更新"
        font = TTFont(io.BytesIO(data))
        if location:
            font = instancer.instantiateVariableFont(font, location)
        buffer = io.BytesIO()
        font.save(buffer)
        self.code, self.weight, self.family, self.data = code, weight, spec['family'], buffer.getvalue()
        self.cmap = font.getBestCmap()
        self.advance = {cp: font['hmtx'][glyph][0] for cp, glyph in self.cmap.items()}
        glyf = font['glyf']
        # 大小估算：輪廓點數，只拿來分片，實際大小以實切為準
        self.cost = {cp: max(1, len(glyf[name].getCoordinates(glyf)[0]) if glyf[name].numberOfContours else 1) for cp, name in self.cmap.items()}

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
        assert set(cmap) == codepoints, f'{self.code}-{self.weight}: 字形覆蓋與規劃不同'
        for cp, glyph in cmap.items():
            assert check['hmtx'][glyph][0] == self.advance[cp], f'{self.code}-{self.weight} U+{cp:04X}: 字寬改變'
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
    for code, weight, location, extend, preload, basics in FACES:
        face = Face(code, weight, location)
        wanted = {ord(char) for char in used.get(f'{code}-{weight}', '') + (BASICS if basics else '')} | {0x20}
        hidden = {ord(char) for char in used.get(f'{code}-{weight}-hidden', '')} - wanted
        missing = sorted(cp for cp in wanted | hidden if cp not in face.cmap)
        assert not [cp for cp in missing if unicodedata.category(chr(cp)).startswith('Lo')], \
            f"{face.family} {weight} 缺本頁用字：{''.join(chr(cp) for cp in missing)}"
        critical = wanted & set(face.cmap)
        tour = hidden & set(face.cmap)
        plan: list[tuple[str, list[int]]] = [('critical', sorted(critical))] + ([('tour', sorted(tour))] if tour else [])
        if extend:
            rest = set(face.cmap) - critical - tour
            marks = sorted(cp for cp in rest if unicodedata.category(chr(cp))[0] in 'PS')
            common = marks + sorted((cp for cp in rest if cp in tier_of and cp not in marks), key=lambda cp: (tier_of[cp], cp))
            probe = set(common[len(common) // 2:len(common) // 2 + 150])
            budget = TARGET_BYTES / (len(face.build(probe)) / sum(face.cost[cp] for cp in probe))
            plan += [('common', group) for group in pack(common, face.cost, budget)]

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
            assert not covered & codepoints, f'{code}-{weight}: 分片的 unicode-range 重疊'
            covered |= codepoints

        key = f'{code}-{weight}'
        summary: dict = {'family': face.family, 'weight': weight, 'characters': len(covered), 'slices': len(built), 'bytes': 0, 'largest': 0, 'critical': None}
        for number, (kind, codepoints, data) in enumerate(built):
            label = kind if kind in ('critical', 'tour') else f'{number:03d}'
            filename = f'{key}-{label}-{hashlib.sha256(data).hexdigest()[:12]}.woff2'
            target = OUTPUT / filename
            if not target.exists() or target.read_bytes() != data:
                target.write_bytes(data)
            written.add(filename)
            url = f'{PUBLIC_URL}/{filename}'
            rule = f"@font-face{{font-family:'{face.family}';font-weight:{weight};font-display:swap;src:url({url}) format('woff2');unicode-range:{unicode_range(codepoints)}}}"
            (inline_rules if kind in ('critical', 'tour') else extended_rules).append(rule)
            summary['bytes'] += len(data)
            summary['largest'] = max(summary['largest'], len(data))
            if kind == 'critical':
                summary['critical'] = {'src': url, 'bytes': len(data), 'characters': len(codepoints)}
                if preload:
                    manifest['preload'].append(url)
        manifest['faces'][key] = summary
        print(f"{face.family} {weight}: {len(covered)} 字、{len(built)} 片、共 {summary['bytes'] / 1e6:.2f} MB；critical {summary['critical']['characters']} 字 {summary['critical']['bytes'] / 1e3:.0f} KB")

    for code, spec in SOURCES.items():
        manifest['sources'].append({'family': spec['family'], 'url': spec['url'], 'sha256': spec['sha256']})
        license_text = fetch(spec['license'], spec['license_url']).decode('utf-8').lstrip('﻿')
        flat = ' '.join(license_text.split())
        assert 'SIL Open Font License, Version 1.1' in flat, f"{spec['license']} 不是 OFL 1.1，先重新核對"
        assert 'Reserved Font Name "' not in flat, f"{spec['license']} 有 Reserved Font Name，子集要改內部名稱"
        (OUTPUT / spec['license']).write_text(license_text, encoding='utf-8')
        written.add(spec['license'])

    extended = '/* Generated by scripts/subset-environment-fonts.py：常春藤環境頁字型的其餘分片（執行時掛上）。 */\n' + '\n'.join(extended_rules) + '\n'
    sheet = f'environment-fonts-extended-{hashlib.sha256(extended.encode()).hexdigest()[:12]}.css'
    (OUTPUT / sheet).write_text(extended, encoding='utf-8')
    written.add(sheet)
    manifest['stylesheet'] = {'src': f'{PUBLIC_URL}/{sheet}', 'bytes': len(extended.encode())}
    INLINE_CSS.write_text('/* Generated by scripts/subset-environment-fonts.py：常春藤環境頁字型各字重的 critical 分片（本頁實際用字）；其餘分片見 environment-font-manifest.json 的 stylesheet。 */\n' + '\n'.join(inline_rules) + '\n', encoding='utf-8')
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for stale in OUTPUT.iterdir():
        if stale.name not in written:
            stale.unlink()
    print(f'extended 樣式表 {sheet}（{len(extended.encode()) / 1e3:.0f} KB）')


if __name__ == '__main__':
    main()
