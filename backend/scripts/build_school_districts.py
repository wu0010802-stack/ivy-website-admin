"""把高雄市「國民小學學區劃分一覽表」PDF 轉成隨程式提交的兩個 CSV（2026-10-14 里的變化規格 §2.4、§3.4、§4.5）。

每學年教育局公告新的一覽表（約 1 月）後，人工下載 PDF 與教育部國民小學名錄，跑這支腳本，看差異報告、補
overrides，再提交新的兩個檔並改 `app/admissions/geo/school_districts.py` 的 SCHOOL_DISTRICT_YEAR。步驟在
`app/admissions/geo_data/README.md`。

用法（在 backend/；pdfplumber 只在這支腳本用，不是執行期依賴）：
  uv run --with pdfplumber==0.11.4 python scripts/build_school_districts.py \\
      --pdf 115學年度國民小學學區劃分一覽表.pdf --schools e1_new.csv --year 115

輸入：
- 一覽表 PDF：一列一所學校（編號／學校名稱／行政區／學區），跨區的學校分段續列、跨頁的儲存格接在下一頁第一列，
  中間夾歷年調整備註（只有第一欄有字）；
- 教育部「國民小學名錄」CSV（data.gov.tw 6087，`https://stats.moe.gov.tw/files/school/<學年>/e1_new.csv`）；
- `app/admissions/geo_data/school-districts-<學年>-overrides.csv`：人工處理的列，逐列寫原因。

輸出（`app/admissions/geo_data/`）：
- `school-districts-<學年>.csv`：一列一個（里、學校）；
- `elementary-schools-<學年>.csv`：一列一所學校（含分校）；
- 差異報告（stdout）：對不到里界的里、自動改區、人工列、和上一學年比多出或少掉的對應。

學區文字的規則（逐項以頂層的「、」「，」「；」切開，括號裡的不切）：
- 「X里」整里；「X里(…鄰…)」部分鄰；緊接的「(…鄰…)」是前一個里的另一段；
- 任何一段寫「自由學區」，那個（里、學校）標 free_zone；
- 「全里」或括號裡只有「與…自由學區」算整里；同一所學校同一個里只要有一段是整里，就是整里；
- 鄰範圍只存原文（不拿來算），訪視只比到里。"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admissions.geo import boundaries  # noqa: E402

GEO_DATA = Path(__file__).resolve().parents[1] / "app" / "admissions" / "geo_data"
# 一覽表的備註裡列的招生方式（115 學年：實驗教育 7 校大學區、空間充裕 38 校、總量管制 13 校）。
ENROLLMENT_NOTES = {
    "open": re.compile(r"實驗教育學校：(.+?)等\s*\d+\s*校列為大學區"),
    "spacious": re.compile(r"學年度空間充裕學校：(.+?)等\s*\d+\s*校"),
    "capped": re.compile(r"學年度總量管制學校：(.+?)等\s*\d+\s*校"),
}
_FULLWIDTH = str.maketrans({"（": "(", "）": ")", "～": "-", "~": "-", "－": "-", "，": "，", "　": ""})
# 里名取括號前最後一個「里」（「中里里」是一個里）；「藍田里全里」的「全里」另外處理。
_VILLAGE = re.compile(r"^([^()]+里)(.*)$")
_WHOLE = re.compile(r"^([^()]+里)全里$")
_DISTRICT_PREFIX = re.compile(r"^([^區]{1,4}區)(.+)$")


@dataclass
class Record:
    """一覽表裡一所學校在一個行政區的那一段。number 是一覽表的編號（分校是「本校編號:分校名」），
    同名學校（前鎮區、那瑪夏區都有民權國小）靠它分開。"""

    number: str
    school: str
    district: str
    text: str
    page: int


@dataclass
class Entry:
    """一所學校、一個里（同一所學校同一個里的幾段合起來）。school 是 Record.number。"""

    school: str
    district: str
    village: str
    segments: list[str] = field(default_factory=list)
    full: bool = False
    free_zone: bool = False
    note: str = ""


# ---- 文字 ----


def normalize(text: str) -> str:
    """換行接起來、全形括號與波浪號換半形、去空白與結尾句號。"""
    joined = "".join(part.strip() for part in text.splitlines())
    return re.sub(r"\s+", "", joined.translate(_FULLWIDTH)).rstrip("。.")


def split_items(text: str) -> list[str]:
    """以頂層（括號外）的「、」「，」「；」切開。"""
    items, depth, current = [], 0, []
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if depth == 0 and char in "、，；":
            if current:
                items.append("".join(current))
            current = []
            continue
        current.append(char)
    if current:
        items.append("".join(current))
    return [item for item in items if item]


def segment_is_full(segment: str) -> bool:
    """這一段是不是整里：空的、「全里」、或只有「與…自由學區」。"""
    rest = re.sub(r"^\(|\)$", "", segment)
    rest = re.sub(r"[，、]?(為|與|和)?[^，、()]*自由學區", "", rest)
    return rest in ("", "全里")


def parse_items(items: list[str]) -> tuple[list[tuple[str, str]], list[str]]:
    """學區項目 → ([(里名, 段落)], [看不懂的項目])。緊接的「(…)」是前一個里的另一段。"""
    parsed: list[tuple[str, str]] = []
    unknown: list[str] = []
    for item in items:
        if item.startswith("(") and parsed:
            if parsed[-1][1] == "":
                # 「東埔里、(7-8、10鄰)」：里名後面多了頓號，括號是那個里的鄰範圍，不是另一段。
                parsed[-1] = (parsed[-1][0], item)
            else:
                parsed.append((parsed[-1][0], item))
            continue
        matched = _WHOLE.match(item) or _VILLAGE.match(item)
        if matched is None:
            unknown.append(item)
            continue
        parsed.append((matched.group(1), matched.group(2) if matched.re is _VILLAGE else ""))
    return parsed, unknown


# ---- PDF ----


def read_pdf(path: Path) -> list[list]:
    import pdfplumber  # 只在這支腳本用

    rows = []
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                for cells in table:
                    rows.append([number, *[(cell or "") for cell in cells]])
    return rows


def records_of(rows: list[list]) -> tuple[list[Record], list[str]]:
    """表格列 → 學校段落與備註文字。
    - 「編號」列是每頁的表頭；
    - 編號空、學校名稱空、行政區有字：同一所學校的另一個區；
    - 編號空、學校名稱有字（分校）：新的一所，行政區空就沿用上一列的；
    - 前三欄都空、第四欄有字：上一頁最後一格的續行；
    - 只有第一欄有字：備註。"""
    records: list[Record] = []
    notes: list[str] = []
    for page, number, school, district, text in rows:
        number, school, district = number.strip(), normalize(school), normalize(district)
        if number.replace(" ", "") == "編號":
            continue
        if number and not number.isdigit():
            notes.append(number)
            continue
        if number or school:
            district = district or (records[-1].district if records else "")
            if not number:  # 分校：沒有自己的編號
                number = f"{records[-1].number.split(':')[0]}:{school}"
            records.append(Record(number, school, district, text, page))
        elif district:
            records.append(Record(records[-1].number, records[-1].school, district, text, page))
        elif text.strip():
            records[-1].text += text
    for record in records:
        record.text = normalize(record.text)
    return records, notes


def enrollment_of(notes: list[str]) -> dict[str, str]:
    """備註 → 「區＋校名」或「校名」→ 招生方式（open／spacious／capped）。"""
    text = normalize("\n".join(notes))
    result: dict[str, str] = {}
    for kind, pattern in ENROLLMENT_NOTES.items():
        matched = pattern.search(text)
        if matched is None:
            raise SystemExit(f"備註裡找不到{kind}的學校清單，一覽表格式可能改了")
        for name in matched.group(1).split("、"):
            result[school_key(name.strip())] = kind
    return result


# ---- 學校名錄 ----


@dataclass
class School:
    code: str
    name: str
    district: str
    address: str


def read_schools(path: Path) -> list[School]:
    """教育部國民小學名錄的高雄市公立學校。名稱去掉「市立」與同名學校前面的區名。"""
    schools = []
    for row in csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))):
        if "高雄市" not in row["縣市名稱"] or row["公/私立"] != "公立":
            continue
        address = re.sub(r"^\[\d+\]", "", row["地址"]).strip()
        district = re.match(r"高雄市(..?.?區)", address)
        name = row["學校名稱"].removeprefix("市立")
        prefixed = _DISTRICT_PREFIX.match(name)
        if prefixed and prefixed.group(1) == (district.group(1) if district else None):
            name = prefixed.group(2)
        schools.append(School(row["代碼"], name.replace("國(中)小", "國中小"), district.group(1) if district else "", address))
    return schools


def school_key(name: str) -> str:
    """一覽表的校名 → 名錄的校名：「翠屏國中小(國小部)」→「翠屏國中小」。"""
    return re.sub(r"\(國小部\)$", "", name)


# ---- overrides ----


@dataclass
class Override:
    kind: str
    school: str
    district: str
    item: str
    value: str
    reason: str


def read_overrides(path: Path) -> list[Override]:
    if not path.exists():
        return []
    rows = csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig")))
    result = []
    for row in rows:
        override = Override(**{key: (row.get(key) or "").strip() for key in Override.__dataclass_fields__})
        if override.kind not in ("item", "district", "inherit", "add", "note", "school", "free"):
            raise SystemExit(f"overrides 有不認得的 kind：{override.kind}")
        if not override.reason:
            raise SystemExit(f"overrides 每一列都要寫原因：{override}")
        result.append(override)
    return result


# ---- 主流程 ----


def build(records: list[Record], overrides: list[Override], report: list[str]) -> dict[tuple[str, str, str], Entry]:
    """學校段落 → (學校, 區, 里) → Entry。區、里是里界檔的名稱。"""
    item_fixes = {(o.school, o.district, o.item): o for o in overrides if o.kind == "item"}
    district_fixes = {(o.school, o.district, o.item): o.value for o in overrides if o.kind == "district"}
    used: set[tuple[str, str, str]] = set()
    entries: dict[tuple[str, str, str], Entry] = {}
    numbers = {(r.school, r.district): r.number for r in records}
    for record in records:
        _SCHOOL_NUMBERS[record.school].add(record.number)
    extra = []
    for o in (o for o in overrides if o.kind == "add"):
        if (o.school, o.district) not in numbers:
            raise SystemExit(f"add 找不到學校（校名＋一覽表上的區）：{o}")
        extra.append(Record(numbers[(o.school, o.district)], o.school, o.district, o.item, 0))
        report.append(f"人工加入：{o.school}（{o.district}）「{o.item}」：{o.reason}")
    for record in [*records, *extra]:
        items = []
        for item in split_items(record.text):
            fix = item_fixes.get((record.school, record.district, item))
            if fix is not None:
                used.add((fix.school, fix.district, fix.item))
                report.append(f"人工：{record.school}（{record.district}）「{item}」→「{fix.value or '不列'}」：{fix.reason}")
                items.extend(split_items(fix.value))
                continue
            items.append(item)
        parsed, unknown = parse_items(items)
        for item in unknown:
            report.append(f"看不懂、未列入：{record.school}（{record.district}）「{item}」")
        for village, segment in parsed:
            district = district_fixes.get((record.school, record.district, village), record.district)
            if district != record.district:
                used.add((record.school, record.district, village))
            entry = entries.setdefault((record.number, district, village), Entry(record.number, district, village))
            if segment:
                entry.segments.append(segment)
            entry.full = entry.full or segment_is_full(segment)
            entry.free_zone = entry.free_zone or "自由學區" in segment
    for override in overrides:
        if override.kind == "item" and (override.school, override.district, override.item) not in used:
            report.append(f"overrides 沒用到（一覽表可能改了）：{override}")
        if override.kind == "district" and (override.school, override.district, override.item) not in used:
            report.append(f"overrides 沒用到（一覽表可能改了）：{override}")
    return entries


_SCHOOL_NUMBERS: dict[str, set[str]] = defaultdict(set)


def override_numbers(school: str) -> set[str]:
    """overrides 寫的校名 → 一覽表編號（build 時記下；同名學校會有兩個，free 要再用區分開）。"""
    return _SCHOOL_NUMBERS[school]


def inherit(entries: dict[tuple[str, str, str], Entry], overrides: list[Override], report: list[str]) -> None:
    """一覽表公告後才新設的里：沿用調整前所屬里的學校。從單一個里分出來的（那個里還在）一律算部分；
    幾個里合併成的，沿用各里的整里／部分。"""
    for override in (o for o in overrides if o.kind == "inherit"):
        sources = [name for name in override.value.split("、") if name]
        split = len(sources) == 1 and boundaries.village_code(override.district, sources[0]) is not None
        found = False
        for (school, district, village), entry in list(entries.items()):
            if district != override.district or village not in sources:
                continue
            found = True
            target = entries.setdefault(
                (school, district, override.item),
                Entry(school, district, override.item, full=not split and entry.full, note=override.reason),
            )
            target.full = target.full and not split and entry.full
            target.free_zone = target.free_zone or entry.free_zone
        if not found:
            raise SystemExit(f"inherit 找不到來源里：{override}")
        report.append(f"沿用：{override.district}{override.item} ← {'、'.join(sources)}（{'分出，算部分' if split else '合併'}）")
    for override in (o for o in overrides if o.kind == "free"):
        targets = [
            entry for (number, district, village), entry in entries.items()
            if (district, village) == (override.district, override.item) and number in override_numbers(override.school)
        ]
        if not targets:
            raise SystemExit(f"free 找不到（學校、里）：{override}")
        for entry in targets:
            entry.free_zone = True
        report.append(f"人工：{override.school}「{override.district}{override.item}」標自由學區：{override.reason}")
    for override in (o for o in overrides if o.kind == "note"):
        targets = [entry for (_, district, village), entry in entries.items() if (district, village) == (override.district, override.item)]
        if not targets:
            raise SystemExit(f"note 找不到里：{override}")
        for entry in targets:
            entry.note = override.value


def resolve_schools(
    records: list[Record], schools: list[School], enrollment: dict[str, str], overrides: list[Override], report: list[str]
) -> dict[str, dict]:
    """一覽表的編號 → 名錄的代碼等。同名學校用一覽表列的區分辨；分校用本校代碼加「-分校名」。
    改名、改制成分校的學校用 overrides 的 school（一覽表校名＋區 → 名錄校名，分校寫「本校名＋分校名」）。"""
    aliases = {(o.school, o.district): o for o in overrides if o.kind == "school"}
    districts: dict[str, set[str]] = defaultdict(set)
    school_names: dict[str, str] = {}
    for record in records:
        districts[record.number].add(record.district)
        school_names[record.number] = record.school
    by_name: dict[str, list[School]] = defaultdict(list)
    for school in schools:
        by_name[school.name].append(school)
    resolved: dict[str, dict] = {}
    first_district = {}
    for record in records:
        first_district.setdefault(record.number, record.district)
    for number, name in school_names.items():
        alias = aliases.get((name, first_district[number]))
        if alias is not None:
            report.append(f"人工：學校「{name}」→「{alias.value}」：{alias.reason}")
        target = alias.value if alias is not None else name
        base, branch = target, ""
        matched = re.match(r"^(.+?(?:國小|國中小|小學))(.+分校)$", target)
        if matched:
            base, branch = matched.group(1), matched.group(2)
        candidates = by_name.get(school_key(base), [])
        if len(candidates) > 1:
            candidates = [c for c in candidates if c.district in districts[number]]
        if len(candidates) != 1:
            raise SystemExit(f"名錄對不到或對到不只一所：{name}（{sorted(districts[number])}）")
        school = candidates[0]
        label = f"{school.district}{school_key(base)}"
        kind = enrollment.get(label) or enrollment.get(school_key(base)) or "district"
        resolved[number] = {
            "school_code": f"{school.code}-{branch}" if branch else school.code,
            "name": f"{school_key(base)}{branch}",
            "listed_as": name,
            # 分校：名錄只有本校的地址；區寫一覽表上分校那一列的區（新威分校在六龜區，本校在美濃區），地址留空。
            "district": first_district[number] if branch else school.district,
            "address": "" if branch else school.address,
            "enrollment": "district" if branch else kind,
        }
    return resolved


def write_outputs(
    entries: dict[tuple[str, str, str], Entry], resolved: dict[str, dict], year: int, report: list[str]
) -> tuple[list[dict], list[dict]]:
    names = boundaries.village_names()
    rows, missing = [], []
    for (school, district, village), entry in sorted(entries.items(), key=lambda item: item[0]):
        code = boundaries.village_code(district, village)
        if code is None:
            missing.append(f"{district}{village}（{school}）")
            continue
        rows.append(
            {
                "village_code": code,
                "district": district,
                "village": village,
                "school_code": resolved[school]["school_code"],
                "coverage": "full" if entry.full else "partial",
                "neighborhoods": "；".join(entry.segments),
                "free_zone": "true" if entry.free_zone else "false",
                "note": entry.note,
            }
        )
    rows.sort(key=lambda row: (row["village_code"], row["school_code"]))
    for item in missing:
        report.append(f"對不到里界、未列入：{item}")
    covered = {row["village_code"] for row in rows}
    for code, (district, village) in sorted(names.items()):
        if code not in covered:
            report.append(f"里界檔有、對照檔沒有學校：{district}{village}")
    schools = sorted(
        ({"school_code": info["school_code"], **{k: info[k] for k in ("name", "listed_as", "district", "address", "enrollment")}}
         for info in resolved.values()),
        key=lambda row: row["school_code"],
    )
    return rows, schools


def _write_csv(path: Path, rows: list[dict]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]), lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    path.write_text(buffer.getvalue(), encoding="utf-8")


def _diff(previous: Path, rows: list[dict], report: list[str]) -> None:
    if not previous.exists():
        report.append(f"沒有上一學年的檔（{previous.name}），不比對")
        return
    old = {(r["village_code"], r["school_code"]) for r in csv.DictReader(previous.open(encoding="utf-8"))}
    new = {(r["village_code"], r["school_code"]) for r in rows}
    names = boundaries.village_names()
    for code, school in sorted(new - old):
        report.append(f"多出：{''.join(names.get(code, ('', code)))} → {school}")
    for code, school in sorted(old - new):
        report.append(f"少掉：{''.join(names.get(code, ('', code)))} → {school}")


def main() -> None:
    parser = argparse.ArgumentParser(description="國小學區一覽表 PDF → 里對國小 CSV")
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--schools", type=Path, required=True, help="教育部國民小學名錄 e1_new.csv")
    parser.add_argument("--year", type=int, required=True, help="學年度（民國），例如 115")
    parser.add_argument("--out", type=Path, default=GEO_DATA)
    parser.add_argument("--dump", type=Path, default=None, help="另存表格原始列（JSON），方便寫 overrides")
    args = parser.parse_args()

    rows = read_pdf(args.pdf)
    if args.dump:
        args.dump.write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    records, notes = records_of(rows)
    overrides = read_overrides(args.out / f"school-districts-{args.year}-overrides.csv")
    report: list[str] = []
    entries = build(records, overrides, report)
    inherit(entries, overrides, report)
    resolved = resolve_schools(records, read_schools(args.schools), enrollment_of(notes), overrides, report)
    district_rows, school_rows = write_outputs(entries, resolved, args.year, report)
    _diff(args.out / f"school-districts-{args.year - 1}.csv", district_rows, report)
    _write_csv(args.out / f"school-districts-{args.year}.csv", district_rows)
    _write_csv(args.out / f"elementary-schools-{args.year}.csv", school_rows)
    print(f"學校 {len(school_rows)} 所（段落 {len(records)}）；（里、學校）{len(district_rows)} 列；"
          f"里 {len({r['village_code'] for r in district_rows})} 個")
    print("\n".join(report))


if __name__ == "__main__":
    main()
