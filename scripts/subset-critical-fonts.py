"""LINE Seed TW 完整字型（Bold 700／ExtraBold 800）切成首屏 critical＋按需載入的 unicode-range 分片。

來源是官方 LINE_Seed_TW.zip（ver02，Version 1.400，SIL OFL 1.1，Reserved Font Name「LINE Seed TW」），
sha256 釘在 ZIP_SHA256。預設讀 output/fonts-src/LINE_Seed_TW.zip（output/ 已 gitignore），沒有就下載；
也可用 --zip 指定已下載的檔案。需要 fontTools 與 Brotli（2026-09-25 用 fontTools 4.63.0 產生）：

  uv run --no-project --with 'fonttools[woff]==4.63.0' python scripts/subset-critical-fonts.py

兩個字重用同一套字組；同一字重內 unicode-range 互斥，聯集＝完整字型 cmap（空白字元除外，見下）：
1. critical：fixture 的 hero 標語＋五校名（保底）∪ web/app/generated/first-screen-chars.json 的
   union（首屏 Bold 用字）與 extraBoldUnion（首屏 ExtraBold 用字）。改首屏文案後先重跑
   scripts/first-screen-chars.cjs 再跑這裡。只有首屏用得到的字重會預載它（nuxt.config.ts 讀
   font-manifest.json 的 preload）；2026-09-25 沒有任何首屏文字是 ExtraBold（studio.css 的
   .studio-hero h1 最後被 font-weight:700 蓋過），所以只預載 Bold。
2. site：scripts/data/lineseed-site-chars.txt（2026-09-24 為止官網用到的 737 字）扣掉 critical，依字頻
   切成數片。英數與標點固定在第一片，halt 的「」（）和原本的 remaining 一樣留在同一個字型裡。
3. 其餘：完整字型剩下的字先依 scripts/data/noto-sans-tc-frequency-tiers.json（Google Fonts 繁中切片的
   字頻層級）由常用到罕用排，Google 沒列的罕用字依碼位接在最後；其餘標點全部排在最前面（進同一片）。
   每片目標約 40 KB、上限 60 KB。

首屏用得到的字重（Bold）的 critical 與 site 宣告在 web/app/assets/css/font-subsets.css（併進 inline CSS，
和原本 critical／remaining 是同一批字，既有頁面的行為不變）；其餘分片與 ExtraBold 全部寫進帶雜湊的
subsets/lineseed-extended-*.css，由 web/app/plugins/title-font-slices.client.ts 在執行時掛上：不阻塞渲染，
也不讓每頁 HTML 多幾十 KB 的 unicode-range。這兩支產出是 LINE Seed TW 唯一的 @font-face 來源，
styles.css 不能再另外宣告（兩份都留時瀏覽器會重複下載，2026-09-22 線上實測過）。

另外產出 web/app/generated/font-manifest.json、web/public/assets/fonts/chars-bd.txt／chars-eb.txt
（完整 cmap 字表，後台缺字提示讀它）與 lineseed-tw-OFL.txt；重跑會刪掉 subsets/ 裡沒用到的舊雜湊檔。

- 空白字元不放進字形：原本的子集沒有空白，標題裡的空白一直由後備字型畫，放進來會改變既有標題的行寬。
  critical 的 unicode-range 仍含 U+20，讓它成為 CSS 的 first available font（決定行框高度）。
- 字型檔內部名稱改為 Ivy Heading TW：OFL 第 3 條不允許修改版（子集、轉檔都算）沿用保留名稱；
  保留著作權、版本與 OFL 網址（name ID 0、5、14），授權全文放在同目錄的 lineseed-tw-OFL.txt。
  CSS 的 font-family 仍叫 'LINE Seed TW'（不是呈現給使用者的字型名稱）。
- 每片都核對：cmap 與規劃相同、每字字寬與 halt 值和官方 OTF 相同；另外拿凍結原型的
  assets/fonts/lineseed-bd.woff／lineseed-eb.woff 當基準，逐字比對字寬與 halt。
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import math
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / 'web/public/assets/fonts'
OUTPUT = FONTS / 'subsets'
PUBLIC_URL = '/assets/fonts/subsets'
INLINE_CSS = ROOT / 'web/app/assets/css/font-subsets.css'
MANIFEST = ROOT / 'web/app/generated/font-manifest.json'
FIRST_SCREEN = ROOT / 'web/app/generated/first-screen-chars.json'
SITE_CHARS = ROOT / 'scripts/data/lineseed-site-chars.txt'
FREQUENCY = ROOT / 'scripts/data/noto-sans-tc-frequency-tiers.json'
FIXTURE = ROOT / 'web/server/data/site-fixture.json'

ZIP_URL = 'https://seed.line.me/src/images/fonts/LINE_Seed_TW.zip'
ZIP_SHA256 = 'a1992cd9e372f94a3cef52b98cee781639fe8b7f4d1a77e318a133acf857aecd'
ZIP_CACHE = ROOT / 'output/fonts-src/LINE_Seed_TW.zip'
ZIP_DIR = 'LINE Seed TW_ver02'

FAMILY = 'LINE Seed TW'  # CSS 名稱，站內 --font-head 與 paperPrints 用這個
RENAMED = 'Ivy Heading TW'  # 字型檔內部名稱（OFL 保留名稱不能用在修改版）
# (CSS 字重, 檔名代號, 官方 OTF, 樣式名, first-screen-chars.json 的欄位)
WEIGHTS = [
    (700, 'bd', 'LINESeedTW_OTF_Bd.otf', 'Bold', 'union'),
    (800, 'eb', 'LINESeedTW_OTF_Eb.otf', 'ExtraBold', 'extraBoldUnion'),
]
BASELINES = {700: ROOT / 'assets/fonts/lineseed-bd.woff', 800: ROOT / 'assets/fonts/lineseed-eb.woff'}
TARGET_BYTES = 40_000
LIMIT_BYTES = 60_000


def options() -> subset.Options:
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.hinting = False
    opts.desubroutinize = True
    # 字型名稱（改名後）、著作權、版本、OFL 網址；name ID 13 的授權長文每片多約 270 bytes，全文改放 lineseed-tw-OFL.txt
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 14]
    return opts


def read_zip(path: Path | None) -> zipfile.ZipFile:
    target = path or ZIP_CACHE
    if not target.exists():
        if path:
            sys.exit(f'找不到 {path}')
        target.parent.mkdir(parents=True, exist_ok=True)
        print(f'下載 {ZIP_URL} → {target}')
        with urllib.request.urlopen(ZIP_URL) as response:
            target.write_bytes(response.read())
    data = target.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == ZIP_SHA256, f'{target} 的 sha256 是 {digest}，不是釘住的 ver02；官方改版時先核對授權、字寬與 halt 再更新 ZIP_SHA256'
    return zipfile.ZipFile(io.BytesIO(data))


def is_ideograph(cp: int) -> bool:
    return 0x3400 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF or cp >= 0x20000


def visible(text: str) -> set[int]:
    return {ord(char) for char in text if not char.isspace()}


def halt_values(font: TTFont) -> dict[int, tuple[int, ...]]:
    """每個字（依 cmap）的 halt 調整值；LINE Seed TW 的 halt 都是 SinglePos。"""
    gpos = font['GPOS'].table if 'GPOS' in font else None
    if not gpos or not gpos.FeatureList:
        return {}
    indices = {i for record in gpos.FeatureList.FeatureRecord if record.FeatureTag == 'halt' for i in record.Feature.LookupListIndex}
    by_glyph: dict[str, tuple[int, ...]] = {}
    for index in sorted(indices):
        lookup = gpos.LookupList.Lookup[index]
        for table in lookup.SubTable:
            table = table.ExtSubTable if lookup.LookupType == 9 else table
            if table.LookupType != 1:
                continue
            glyphs = table.Coverage.glyphs
            values = [table.Value] * len(glyphs) if table.Format == 1 else table.Value
            for glyph, value in zip(glyphs, values):
                by_glyph.setdefault(glyph, tuple(getattr(value, field, 0) or 0 for field in ('XPlacement', 'YPlacement', 'XAdvance', 'YAdvance')))
    return {cp: by_glyph[glyph] for cp, glyph in font.getBestCmap().items() if glyph in by_glyph}


def rename(font: TTFont, style: str, version: str) -> None:
    postscript = f"{RENAMED.replace(' ', '')}-{style}"
    full = f'{RENAMED} {style}'
    names = font['name']
    for name_id, value in ((1, full), (3, f'{postscript};{version}'), (4, full), (6, postscript)):
        names.removeNames(nameID=name_id)
        names.setName(value, name_id, 3, 1, 0x409)
    cff = font['CFF '].cff
    cff.fontNames = [postscript]
    top = cff.topDictIndex[0]
    top.FullName = full
    top.FamilyName = RENAMED


def unicode_range(codepoints: set[int]) -> str:
    runs: list[list[int]] = []
    for cp in sorted(codepoints):
        if runs and cp == runs[-1][1] + 1:
            runs[-1][1] = cp
        else:
            runs.append([cp, cp])
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in runs)


class Source:
    def __init__(self, archive: zipfile.ZipFile, weight: int, code: str, filename: str, style: str):
        self.weight, self.code, self.style = weight, code, style
        self.data = archive.read(f'{ZIP_DIR}/OTF/{filename}')
        font = TTFont(io.BytesIO(self.data), recalcTimestamp=False)
        self.cmap = font.getBestCmap()
        self.advance = {cp: font['hmtx'][glyph][0] for cp, glyph in self.cmap.items()}
        self.halt = halt_values(font)
        self.version = font['name'].getDebugName(5)
        self.characters = {cp for cp in self.cmap if not chr(cp).isspace()}

    def costs(self) -> dict[int, int]:
        """每字去掉 subroutine 與 hint 後的 charstring 長度，只拿來估分片大小。"""
        font = TTFont(io.BytesIO(self.data), recalcTimestamp=False)
        subsetter = subset.Subsetter(options())
        subsetter.populate(unicodes=self.characters)
        subsetter.subset(font)
        charstrings = font['CFF '].cff.topDictIndex[0].CharStrings
        result = {}
        for cp, glyph in font.getBestCmap().items():
            charstring = charstrings[glyph]
            charstring.compile()
            result[cp] = len(charstring.bytecode)
        return result

    def build(self, codepoints: set[int]) -> bytes:
        font = TTFont(io.BytesIO(self.data), recalcTimestamp=False, lazy=True)
        subsetter = subset.Subsetter(options())
        subsetter.populate(unicodes=codepoints)
        subsetter.subset(font)
        # 康熙部首、相容漢字和本字共用字形，subsetter 會把它們一起留在 cmap；只留規劃的字，
        # 讓 cmap 與 unicode-range 一致（同一個字不會出現在兩片的 cmap 裡）。
        for table in font['cmap'].tables:
            if table.format != 14:
                table.cmap = {cp: glyph for cp, glyph in table.cmap.items() if cp in codepoints}
        rename(font, self.style, self.version)
        font.flavor = 'woff2'
        buffer = io.BytesIO()
        font.save(buffer)
        data = buffer.getvalue()
        check = TTFont(io.BytesIO(data))
        cmap = check.getBestCmap()
        assert set(cmap) == codepoints, f'{self.code}: 字形覆蓋與規劃不同'
        for cp, glyph in cmap.items():
            assert check['hmtx'][glyph][0] == self.advance[cp], f'{self.code} U+{cp:04X}: 字寬改變'
        assert halt_values(check) == {cp: value for cp, value in self.halt.items() if cp in codepoints}, f'{self.code}: halt 值改變'
        assert check['name'].getDebugName(1).startswith(RENAMED) and FAMILY not in check['name'].getDebugName(4), f'{self.code}: 內部名稱沒有改掉'
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
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--zip', type=Path, help=f'官方 LINE_Seed_TW.zip（預設 {ZIP_CACHE.relative_to(ROOT)}，沒有就下載）')
    args = parser.parse_args()
    logging.getLogger('fontTools').setLevel(logging.ERROR)

    archive = read_zip(args.zip)
    license_text = archive.read(f'{ZIP_DIR}/license.txt').decode('utf-8').replace('\r\n', '\n')
    assert 'SIL Open Font License, Version 1.1' in license_text and 'Reserved Font Name "LINE Seed TW"' in license_text, '授權檔和 2026-09-25 核對過的 OFL 1.1 不同，先重新核對'
    sources = [Source(archive, *spec[:4]) for spec in WEIGHTS]
    characters = sources[0].characters
    assert all(source.characters == characters for source in sources), 'Bold 與 ExtraBold 的字集不同，不能共用分片'

    fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
    fixture_text = ''.join(fixture['home']['hero']['titleParts'].values()) + ''.join(c['name'] for c in fixture['campuses'])
    measured = json.loads(FIRST_SCREEN.read_text(encoding='utf-8')) if FIRST_SCREEN.exists() else {}
    first_screen = {weight: visible(measured.get(key, '')) for weight, *_, key in WEIGHTS}
    first_screen[700] |= visible(fixture_text)  # hero 標語與校名是 Bold，保底一定進 critical
    critical = set().union(*first_screen.values())
    missing = sorted(critical - characters)
    assert not missing, f'首屏用字不在 LINE Seed TW 裡：{"".join(map(chr, missing))}'
    site = visible(SITE_CHARS.read_text(encoding='utf-8'))
    assert site <= characters, f'官網既有用字不在 LINE Seed TW 裡：{"".join(map(chr, sorted(site - characters)))}'
    site -= critical

    tiers = json.loads(FREQUENCY.read_text(encoding='utf-8'))['tiers']
    tier_of: dict[int, int] = {}
    for index, tier in enumerate(tiers):
        for char in tier:
            tier_of.setdefault(ord(char), index)

    def rank(cp: int) -> tuple[int, int]:
        return tier_of.get(cp, len(tiers)), cp

    # 其餘的標點（含直排標點）集中在第一片 common：halt 的『』〈〉《》【】〔〕等留在同一個字型裡
    rest = characters - critical - site
    marks = sorted(cp for cp in rest if unicodedata.category(chr(cp)).startswith('P'))
    rest -= set(marks)
    common = marks + sorted((cp for cp in rest if cp in tier_of), key=rank)
    rare = sorted(cp for cp in rest if cp not in tier_of)

    costs = [source.costs() for source in sources]
    cost = {cp: max(table[cp] for table in costs) for cp in characters}
    # 拿一段中頻字實切一次，換算「charstring 長度 → WOFF2 位元組」
    probe = set(common[len(common) // 2:len(common) // 2 + 150])
    ratio = max(len(source.build(probe)) for source in sources) / sum(cost[cp] for cp in probe)
    budget = TARGET_BYTES / ratio
    site_groups = pack(sorted(site, key=lambda cp: (is_ideograph(cp), rank(cp))), cost, budget)
    assert all(is_ideograph(cp) for group in site_groups[1:] for cp in group), '英數標點要全在第一片 site'
    plan = [('critical', sorted(critical))] + [('site', group) for group in site_groups]
    plan += [('common', group) for group in pack(common, cost, budget)]
    plan += [('rare', group) for group in pack(rare, cost, budget)]

    built: list[tuple[str, set[int], list[bytes]]] = []
    while plan:
        kind, group = plan.pop(0)
        codepoints = set(group)
        datas = [source.build(codepoints) for source in sources]
        if kind != 'critical' and len(group) > 1 and max(map(len, datas)) > LIMIT_BYTES:
            half = len(group) // 2
            plan[:0] = [(kind, group[:half]), (kind, group[half:])]
            continue
        built.append((kind, codepoints, datas))

    covered: set[int] = set()
    for _, codepoints, _ in built:
        assert not covered & codepoints, '分片的 unicode-range 重疊'
        covered |= codepoints
    assert covered == characters, '分片聯集與完整字型不同'
    for source in sources:
        baseline = TTFont(BASELINES[source.weight])
        base_cmap = baseline.getBestCmap()
        assert set(base_cmap) <= characters, f'{source.code}: 原子集有完整字型沒有的字'
        for cp, glyph in base_cmap.items():
            assert baseline['hmtx'][glyph][0] == source.advance[cp], f'{source.code} U+{cp:04X}: 與原子集字寬不同'
        assert halt_values(baseline) == {cp: v for cp, v in source.halt.items() if cp in base_cmap}, f'{source.code}: 與原子集 halt 不同'

    OUTPUT.mkdir(parents=True, exist_ok=True)
    written: set[str] = set()
    inline_rules: list[str] = []
    extended_rules: list[str] = []
    manifest: dict = {'source': {'url': ZIP_URL, 'sha256': ZIP_SHA256, 'version': sources[0].version}, 'preload': [], 'stylesheet': None, 'weights': {}}
    report = []
    for position, source in enumerate(sources):
        on_first_screen = bool(first_screen[source.weight])
        summary: dict = {'characters': len(characters), 'slices': len(built), 'bytes': 0, 'largest': 0, 'critical': None}
        for number, (kind, codepoints, datas) in enumerate(built):
            data = datas[position]
            label = 'critical' if kind == 'critical' else f'{number:03d}'
            filename = f'lineseed-{source.code}-{label}-{hashlib.sha256(data).hexdigest()[:12]}.woff2'
            target = OUTPUT / filename
            if not target.exists() or target.read_bytes() != data:
                target.write_bytes(data)
            written.add(filename)
            url = f'{PUBLIC_URL}/{filename}'
            ranges = unicode_range(codepoints | ({0x20} if kind == 'critical' else set()))
            rule = f"@font-face{{font-family:'{FAMILY}';font-weight:{source.weight};font-display:swap;src:url({url}) format('woff2');unicode-range:{ranges}}}"
            inline = on_first_screen and kind in ('critical', 'site')
            (inline_rules if inline else extended_rules).append(rule)
            summary['bytes'] += len(data)
            summary['largest'] = max(summary['largest'], len(data))
            if kind == 'critical':
                summary['critical'] = {'src': url, 'bytes': len(data), 'characters': len(codepoints)}
                if on_first_screen:
                    manifest['preload'].append(url)
            where = ('preload' if kind == 'critical' else 'inline') if inline else 'extended'
            report.append((source.code, label, kind, len(codepoints), len(data), where))
        manifest['weights'][str(source.weight)] = summary

    extended = '/* Generated by scripts/subset-critical-fonts.py：LINE Seed TW 其餘分片，由 plugins/title-font-slices.client.ts 掛上。 */\n' + '\n'.join(extended_rules) + '\n'
    extended_bytes = extended.encode('utf-8')
    extended_name = f'lineseed-extended-{hashlib.sha256(extended_bytes).hexdigest()[:12]}.css'
    (OUTPUT / extended_name).write_bytes(extended_bytes)
    written.add(extended_name)
    manifest['stylesheet'] = {'src': f'{PUBLIC_URL}/{extended_name}', 'bytes': len(extended_bytes)}
    for stale in OUTPUT.glob('lineseed-*'):
        if stale.name not in written:
            stale.unlink()

    INLINE_CSS.write_text('/* Generated by scripts/subset-critical-fonts.py：LINE Seed TW 首屏 critical 與官網既有用字；其餘分片在 lineseed-extended-*.css。 */\n' + '\n'.join(inline_rules) + '\n', encoding='utf-8')
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    chars = ''.join(chr(cp) for cp in sorted(characters))
    for source in sources:
        (FONTS / f'chars-{source.code}.txt').write_text(chars, encoding='utf-8')
    (FONTS / 'lineseed-tw-OFL.txt').write_text(license_text, encoding='utf-8')

    for row in report:
        print('\t'.join(map(str, row)))
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
