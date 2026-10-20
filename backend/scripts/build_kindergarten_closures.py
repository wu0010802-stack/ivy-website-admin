"""產生 app/admissions/geo_data/kindergarten-closures-<日期>.csv（2026-10-15 幼兒園名單規格 §5.3；2026-10-20 延伸到 2022-08）。

找出 --since 起、離開教育部名單（kiang docs/data/高雄市.csv）的高雄幼兒園，各自的離開日、處理方式與園所資料：
- 取樣：名單歷史（--since 起的每一版）先取最舊一版與每月最後一版當樣本（月底那版列數掉到前一個樣本的 80% 以下＝殘缺版，
  名單歷史有過，例如 2025-07-09 只有 351 列，改用同月前一版），不逐版下載整個歷史。
  最新一版沒有、但曾出現在樣本裡的園所就是「離開名單」的；最新一版本身列數不到前一個樣本的 80% 就停下來（疑似殘缺版，晚點再跑）。不用二分搜尋：歷史有殘缺版本，「最舊版本裡沒有它」不代表更早就消失。
- left_on：只對離開的園所，到「最後含它的樣本」與下一個樣本之間，新到舊逐版掃描，取最新一個含它的版本的下一個較新版本的日期
  （台北日期，定義同 10-15）；每個版本最多下載一次。--since 之前就離開的抓不到，留空（只會出現在 --merge 的舊檔裡）。
- reason：renamed＝改名或換承辦，只下架；closed＝停辦。改名取兩個規則的聯集：
  (1) 現行名單（以及有座標的營業中園所）上有同地址、同設立日的另一所（10-15 規則，時間不限）；
  (2) 3 個月內同址一進一出：同地址另有一所在離開日前後 3 個月內「新出現在名單」（只知道落在相鄰兩個樣本之間，
      區間內有一天落在前後 3 個月就算）。
- 名稱、核定、座標、類型、source_id：取自離開前最後一版（含它的最後一個版本）的 docs/preschools.json；那一版沒有 preschools.json
  （404）或沒有這一筆，改用最新版的那一筆（kiang 還標營業中的幽靈）；都沒有就沒有 source_id，寫不出一列，只在摘要計數。
  那一版有這一筆但座標、類型不合格（和同步用同一套 parse_preschools）：source_id 保留，核定、座標、類型留空。
  類型的準公共用離開日所在的學年判斷。名稱一律用名單上的名稱（就是 kiang 產生 source_id 的鍵）。
- --merge 舊檔（10-15 的四欄檔，或八欄檔）：同 source_id 以舊檔的 left_on、reason、名稱與非空的新欄位為準；
  舊檔 left_on 空白、新掃描找到日期的補上；掃描不到的舊列照留，新欄位用最新版 preschools.json 補。
- --cache 目錄：下載過的檔案（名單、preschools.json）依 commit 存起來，重跑不重抓。
輸出寫完會用同步的載入程式（load_closure_backfill）讀一遍自檢，讀不了就刪掉輸出並結束。
開發用，不進執行期。需要已登入的 gh CLI；請求數＝樣本數（約 50）＋離開區間內的掃描版本數＋preschools.json 的版本數。

用法（在 backend/）：
  uv run --frozen python scripts/build_kindergarten_closures.py --since 2022-08-31 \\
      --merge app/admissions/geo_data/kindergarten-closures-20261015.csv \\
      --out app/admissions/geo_data/kindergarten-closures-20261020.csv --cache /tmp/closures-cache
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import subprocess
import sys
import time
import urllib.parse
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admissions.academic import current_term  # noqa: E402
from app.admissions.geo.closure_backfill import COLUMNS, REASONS, BackfillFormatError, load_closure_backfill  # noqa: E402
from app.admissions.geo.kindergartens import (  # noqa: E402
    KindergartenFormatError, Registry, parse_preschools, parse_registry, place_key, registry_key,
)
from app.admissions.geo.providers import months_ago  # noqa: E402

REPO = "kiang/ap.ece.moe.edu.tw"
REGISTRY_PATH = "docs/data/高雄市.csv"
JSON_PATH = "docs/preschools.json"
TAIPEI = timezone(timedelta(hours=8))
SCHOOL_YEAR = 115  # 沒有離開日的舊列（找最新版 preschools.json 的資料）用這個學年判斷準公共
MIN_SAMPLE_RATIO = 0.8  # 月底版列數低於前一個樣本的這個比例＝殘缺版，不當樣本
RENAME_MONTHS = 3  # 同址一進一出的時間差
CACHE_DIR: Path | None = None  # main() 依 --cache 設定

Key = tuple[str, str]  # (立案文號, 名稱)＝kiang 產生 source_id 的鍵
Listing = dict[Key, tuple[str, str]]  # 一版名單：鍵 → (地址（去郵遞區號）, 設立日原文)
_POSTAL_PREFIX = re.compile(r"^\[\d+\]")  # 和 kindergartens 的郵遞區號前綴同一個寫法


class GhError(RuntimeError):
    def __init__(self, message: str, *, not_found: bool = False):
        super().__init__(message)
        self.not_found = not_found


def gh(*args: str) -> str:
    for attempt in range(3):
        if attempt:
            time.sleep(2)  # 重試前等一下，連續失敗多半是 GitHub 的暫時限流
        done = subprocess.run(["gh", "api", *args], capture_output=True, text=True, encoding="utf-8-sig")
        if done.returncode == 0:
            return done.stdout
        if "HTTP 404" in done.stderr:
            raise GhError(f"gh api 找不到：{' '.join(args)}", not_found=True)  # 404 重試也沒用
    raise GhError(f"gh api 失敗：{' '.join(args)}\n{done.stderr[:300]}")


def raw(path: str, sha: str) -> str:
    """某個 commit 的檔案內容；有 --cache 時下載過的不再抓。"""
    cached = CACHE_DIR / f"{sha}-{Path(path).name}" if CACHE_DIR is not None else None
    if cached is not None and cached.exists():
        return cached.read_text(encoding="utf-8")
    text = gh("-H", "Accept: application/vnd.github.raw", f"repos/{REPO}/contents/{urllib.parse.quote(path)}?ref={sha}")
    if cached is not None:
        cached.parent.mkdir(parents=True, exist_ok=True)
        partial = cached.with_name(cached.name + ".part")  # 先寫暫存再改名，中斷不會留下半個檔
        partial.write_text(text, encoding="utf-8")
        partial.replace(cached)
    return text


def raw_or_none(path: str, sha: str) -> str | None:
    """同 raw，但那個 commit 沒有這個檔（404）回 None；其他失敗照丟，不能把限流當成「沒有」。"""
    try:
        return raw(path, sha)
    except GhError as exc:
        if exc.not_found:
            return None
        raise


def head_sha() -> str:
    return gh(f"repos/{REPO}/commits/master", "--jq", ".sha").strip()


def history(since: date) -> list[tuple[str, date]]:
    """名單的 commit，新到舊：(sha, 台北日期)。"""
    query = f"repos/{REPO}/commits?path={urllib.parse.quote(REGISTRY_PATH)}&since={since.isoformat()}T00:00:00Z&per_page=100"
    lines = gh("--paginate", query, "--jq", ".[] | [.sha, .commit.committer.date] | @tsv").splitlines()
    commits = []
    for line in lines:
        sha, stamp = line.split("\t")
        commits.append((sha, datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(TAIPEI).date()))
    return commits


def school_year_of(day: date | None) -> int:
    return current_term(day)[0] if day else SCHOOL_YEAR


def registry_listing(text: str) -> Listing:
    """一版名單 → {(立案文號, 名稱): (地址, 設立日原文)}。沒有必要欄位或一列可用的都沒有 → KindergartenFormatError。"""
    parse_registry(text)
    listing: Listing = {}
    for row in csv.DictReader(io.StringIO(text)):
        key = registry_key(row.get("reg_docno"), row.get("title"))
        if all(key):
            address = _POSTAL_PREFIX.sub("", str(row.get("address") or "").strip())
            listing[key] = (address, str(row.get("reg_date") or "").strip())
    return listing


@dataclass
class Stats:
    head: str = ""
    registry_size: int = 0
    versions: int = 0  # --since 起的名單歷史版本數
    samples: int = 0
    fetched: int = 0  # 下載並讀過的名單版本數（樣本＋掃描）
    unreadable: int = 0  # 格式不對的歷史版本（當成空名單）
    departed: int = 0
    unmatched: int = 0  # 離開了、但 preschools.json 從沒有它（沒有 source_id）
    json_versions: int = 0  # 下載的 preschools.json 版本數
    old_rows: int = 0
    date_differs: int = 0
    date_filled: int = 0
    reason_differs: int = 0
    unreadable_positions: set[int] = field(default_factory=set)


class Versions:
    """名單歷史（新到舊）。listing(pos) 讀第 pos 版；格式不對的當成空名單並計數。"""

    def __init__(self, commits: list[tuple[str, date]], stats: Stats, texts: dict[str, str] | None = None):
        self.commits = commits
        self.stats = stats
        self.texts = texts or {}  # 已經下載過的版本（sha → 名單文字），例如最新一版
        self.kept: dict[int, Listing] = {}

    def listing(self, pos: int, *, keep: bool = False) -> Listing:
        if pos in self.kept:
            return self.kept[pos]
        try:
            sha = self.commits[pos][0]
            listing = registry_listing(self.texts[sha] if sha in self.texts else raw(REGISTRY_PATH, sha))
        except KindergartenFormatError:
            listing = {}
            self.stats.unreadable_positions.add(pos)
            self.stats.unreadable = len(self.stats.unreadable_positions)
        self.stats.fetched += 1
        if keep:
            self.kept[pos] = listing
        return listing


@dataclass(frozen=True)
class Sample:
    pos: int  # 在歷史裡的位置（0 是最新）
    day: date
    listing: Listing


def pick_samples(versions: Versions) -> list[Sample]:
    """最舊一版加每月最後一版，最新一版當最後一個樣本；由舊到新。"""
    commits = versions.commits
    months: dict[tuple[int, int], list[int]] = {}
    for pos, (_, day) in enumerate(commits):
        months.setdefault((day.year, day.month), []).append(pos)  # 每月的位置新到舊
    slots = [[len(commits) - 1], *reversed(list(months.values()))]  # 由舊到新：最舊一版、各月
    samples: list[Sample] = []
    for positions in slots:
        for pos in positions:
            if samples and samples[-1].pos == pos:
                break  # 最舊一版剛好也是該月最後一版
            listing = versions.listing(pos, keep=True)
            truncated = bool(samples) and len(listing) < MIN_SAMPLE_RATIO * len(samples[-1].listing)
            if pos == 0:  # 最新一版一定要；讀不出來或殘缺就停，不然整批都會被當成離開
                if not listing:
                    raise SystemExit("最新一版的教育部名單讀不出來")
                if truncated:
                    raise SystemExit(
                        f"最新一版的教育部名單只有 {len(listing)} 列，不到前一個樣本（{samples[-1].day}，"
                        f"{len(samples[-1].listing)} 列）的 {MIN_SAMPLE_RATIO:.0%}，疑似殘缺版；晚點等 kiang 更新再跑"
                    )
            elif not listing or truncated:
                continue  # 空的或殘缺的月底版：改用同月前一版
            samples.append(Sample(pos, commits[pos][1], listing))
            break
    return samples


@dataclass(frozen=True)
class Departure:
    key: Key
    address: str
    reg_date: str
    left_on: date
    last_pos: int  # 最後含它的版本（離開前最後一版）


def find_departures(versions: Versions, samples: list[Sample]) -> dict[Key, Departure]:
    """最新樣本沒有、但曾在樣本裡的園所；在「最後含它的樣本」與下一個樣本之間逐版找離開日。"""
    last: dict[Key, int] = {}
    for index, sample in enumerate(samples):
        for key in sample.listing:
            last[key] = index
    by_interval: dict[int, set[Key]] = {}
    for key, index in last.items():
        if index < len(samples) - 1:
            by_interval.setdefault(index, set()).add(key)
    departures: dict[Key, Departure] = {}
    for index, keys in sorted(by_interval.items()):
        newer, older = samples[index + 1].pos, samples[index].pos
        unresolved = set(keys)
        for pos in range(newer + 1, older + 1):  # 新到舊；older 是樣本，一定含有剩下的全部
            present = unresolved.intersection(versions.listing(pos))
            for key in present:
                address, reg_date = samples[index].listing[key]
                departures[key] = Departure(key, address, reg_date, versions.commits[pos - 1][1], pos)
            unresolved -= present
            if not unresolved:
                break
        print(f"  離開區間 {samples[index].day}～{samples[index + 1].day}：{len(keys)} 所", file=sys.stderr, flush=True)
    return departures


def arrivals_by_address(samples: list[Sample]) -> dict[str, list[tuple[Key, date, date]]]:
    """第一次出現在樣本裡的園所（最舊樣本本來就有的不算）：地址 → [(鍵, 上一個樣本日, 這個樣本日)]。
    它是在 (上一個樣本日, 這個樣本日] 之間加入名單的，只知道這個區間。"""
    seen = set(samples[0].listing)
    arrivals: dict[str, list[tuple[Key, date, date]]] = {}
    for before, sample in zip(samples, samples[1:]):
        for key, (address, _) in sample.listing.items():
            if key not in seen:
                seen.add(key)
                if address:
                    arrivals.setdefault(address, []).append((key, before.day, sample.day))
    return arrivals


def is_renamed(departure: Departure, current_places: set, arrivals: dict[str, list[tuple[Key, date, date]]]) -> bool:
    place = place_key(departure.address, departure.reg_date)
    if place is not None and place in current_places:
        return True  # 10-15 規則：現行名單有同地址、同設立日的另一所
    if not departure.address:
        return False
    start = months_ago(departure.left_on, RENAME_MONTHS)
    end = months_ago(departure.left_on, -RENAME_MONTHS)  # 負的月數＝往後推
    return any(key != departure.key and low < end and high >= start for key, low, high in arrivals.get(departure.address, ()))


@dataclass(frozen=True)
class Found:
    """preschools.json 裡的一筆。核定、座標、類型是 None＝這筆座標或類型不合格，parse_preschools 不收。"""

    source_id: str
    approved_capacity: int | None = None
    lat: float | None = None
    lng: float | None = None
    kind: str | None = None


def feature_keys(data: dict) -> dict[str, Key]:
    """preschools.json 裡高雄市的 {id: 鍵}。"""
    keys: dict[str, Key] = {}
    for feature in data.get("features") or []:
        props = feature.get("properties") or {}
        if str(props.get("city") or "").replace("臺", "台") == "高雄市" and props.get("id"):
            keys[str(props["id"])] = registry_key(props.get("reg_docno"), props.get("title"))
    return keys


def lookup(data: dict, keys: set[Key], school_year: int) -> dict[Key, Found]:
    """在一版 preschools.json 裡找這些鍵：source_id 取 id；核定、座標、類型沿用同步的解析（parse_preschools）。"""
    ids = {key: source_id for source_id, key in feature_keys(data).items() if key in keys}
    if not ids:
        return {}
    try:
        rows = {
            row.source_id: row
            for row in parse_preschools(data, registry=Registry(frozenset(ids), frozenset()), school_year=school_year)
        }
    except KindergartenFormatError:  # 一筆都不合格
        rows = {}
    found = {}
    for key, source_id in ids.items():
        row = rows.get(source_id)
        found[key] = Found(source_id, row.approved_capacity, row.lat, row.lng, row.kind) if row else Found(source_id)
    return found


@dataclass
class Old:
    """--merge 舊檔的一列。"""

    name: str
    left_on: date | None
    reason: str
    approved_capacity: str = ""
    lat: str = ""
    lng: str = ""
    kind: str = ""


def read_old(path: Path) -> dict[str, Old]:
    try:
        handle = path.open(encoding="utf-8", newline="")
    except FileNotFoundError:
        raise SystemExit(f"找不到 --merge 的檔案：{path}") from None
    with handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not {"source_id", "name", "left_on", "reason"} <= set(reader.fieldnames):
            raise SystemExit(f"{path.name} 的欄位不對（至少要有 source_id,name,left_on,reason）")
        rows: dict[str, Old] = {}
        for line, row in enumerate(reader, start=2):
            source_id = (row["source_id"] or "").strip()
            reason = (row["reason"] or "").strip()
            if not source_id or reason not in REASONS:
                raise SystemExit(f"{path.name} 第 {line} 列不對")
            left_on = (row["left_on"] or "").strip()
            rows[source_id] = Old(
                name=(row["name"] or "").strip(),
                left_on=date.fromisoformat(left_on) if left_on else None,
                reason=reason,
                **{name: (row.get(name) or "").strip() for name in ("approved_capacity", "lat", "lng", "kind")},
            )
    return rows


@dataclass
class Row:
    source_id: str
    name: str
    left_on: date | None
    reason: str
    found: Found | None = None
    old: Old | None = None

    def render(self) -> dict[str, str]:
        found = self.found
        values = {
            # 來源偶爾有負數的核定人數（int4 範圍內，parse_preschools 收），載入器不收，當成未知
            "approved_capacity": (
                "" if found is None or found.approved_capacity is None or found.approved_capacity < 0
                else str(found.approved_capacity)
            ),
            "lat": "" if found is None or found.lat is None else str(found.lat),
            "lng": "" if found is None or found.lng is None else str(found.lng),
            "kind": "" if found is None or found.kind is None else found.kind,
        }
        if self.old is not None:  # 舊檔已有的新欄位值不被改掉
            values = {name: getattr(self.old, name) or value for name, value in values.items()}
        return {
            "source_id": self.source_id, "name": self.name,
            "left_on": self.left_on.isoformat() if self.left_on else "", "reason": self.reason, **values,
        }


def build_rows(since: date, merge: Path | None = None) -> tuple[list[dict[str, str]], Stats]:
    stats = Stats()
    old_rows = read_old(merge) if merge is not None else {}
    stats.old_rows = len(old_rows)

    head = head_sha()
    stats.head = head
    head_text = raw(REGISTRY_PATH, head)
    registry = parse_registry(head_text)
    head_data = json.loads(raw(JSON_PATH, head))
    open_rows = parse_preschools(head_data, registry=registry, school_year=SCHOOL_YEAR)
    stats.registry_size = len(registry.keys)
    current_places = set(registry.places) | {(row.address, row.registered_on) for row in open_rows if row.registered_on}

    commits = history(since)  # 新到舊
    if not commits:
        raise SystemExit("名單歷史是空的")
    stats.versions = len(commits)
    versions = Versions(commits, stats, {head: head_text})
    samples = pick_samples(versions)
    stats.samples = len(samples)
    departures = find_departures(versions, samples)
    stats.departed = len(departures)
    arrivals = arrivals_by_address(samples)

    # 園所資料：離開前最後一版的 preschools.json；同一版離開日相同，學年也相同。
    found: dict[Key, Found] = {}
    by_pos: dict[int, list[Departure]] = {}
    for departure in departures.values():
        by_pos.setdefault(departure.last_pos, []).append(departure)
    for index, (pos, group) in enumerate(sorted(by_pos.items()), start=1):
        text = raw_or_none(JSON_PATH, commits[pos][0])
        print(f"  preschools.json {index}/{len(by_pos)}（{commits[pos][1]}）", file=sys.stderr, flush=True)
        if text is None:
            continue
        stats.json_versions += 1
        found.update(lookup(json.loads(text), {item.key for item in group}, school_year_of(group[0].left_on)))

    # 這一版找不到的（和 --merge 舊檔裡掃描不到的）改用最新版 preschools.json。
    head_keys = feature_keys(head_data)  # id → 鍵
    requests: dict[Key, int] = {}
    for departure in departures.values():
        if departure.key not in found:
            requests[departure.key] = school_year_of(departure.left_on)
    scanned_ids = {item.source_id for item in found.values()}
    for source_id, old in old_rows.items():
        key = head_keys.get(source_id)
        if key is not None and source_id not in scanned_ids:
            requests.setdefault(key, school_year_of(old.left_on))
    by_year: dict[int, set[Key]] = {}
    for key, year in requests.items():
        by_year.setdefault(year, set()).add(key)
    for year, keys in by_year.items():
        for key, item in lookup(head_data, keys, year).items():
            found.setdefault(key, item)

    rows: dict[str, Row] = {}
    for departure in departures.values():
        item = found.get(departure.key)
        if item is None:
            stats.unmatched += 1
            continue
        reason = "renamed" if is_renamed(departure, current_places, arrivals) else "closed"
        rows[item.source_id] = Row(item.source_id, departure.key[1], departure.left_on, reason, item)
    for source_id, old in old_rows.items():
        row = rows.get(source_id)
        if row is None:
            key = head_keys.get(source_id)
            rows[source_id] = Row(source_id, old.name, old.left_on, old.reason, found.get(key) if key else None, old)
            continue
        if old.left_on is None:
            stats.date_filled += 1
        else:
            stats.date_differs += row.left_on != old.left_on
            row.left_on = old.left_on
        stats.reason_differs += row.reason != old.reason
        row.reason, row.name, row.old = old.reason, old.name or row.name, old

    out_rows = [row.render() for row in rows.values()]
    out_rows.sort(key=lambda item: (item["left_on"] or "0000-00-00", item["name"], item["source_id"]))  # 同日同名時順序固定
    return out_rows, stats


def summary(rows: list[dict[str, str]], stats: Stats) -> str:
    closed = [item for item in rows if item["reason"] == "closed"]
    renamed = [item for item in rows if item["reason"] == "renamed"]
    dated = [item for item in closed if item["left_on"]]
    per_year = Counter(item["left_on"][:4] for item in dated)
    filled = sum(1 for item in rows if item["kind"] and item["lat"] and item["lng"])
    lines = [
        f"head {stats.head[:10]}：名單 {stats.registry_size} 所；歷史 {stats.versions} 版、樣本 {stats.samples} 版、"
        f"下載名單 {stats.fetched} 版（格式不對 {stats.unreadable}）、preschools.json {stats.json_versions} 版",
        f"離開名單 {stats.departed} 所（preschools.json 從沒有它、略過 {stats.unmatched}）",
        f"回補 {len(rows)} 筆＝停辦 {len(closed)}（有日期 {len(dated)}）、改名 {len(renamed)}"
        f"（有日期 {len([item for item in renamed if item['left_on']])}）；"
        f"核定、座標、類型都有 {filled} 筆、留空 {len(rows) - filled} 筆",
    ]
    if stats.old_rows:
        lines.append(
            f"舊檔 {stats.old_rows} 筆：日期以舊檔為準（新掃描日期不同 {stats.date_differs}、舊檔空白而補上 {stats.date_filled}），"
            f"處理方式不同 {stats.reason_differs}"
        )
    lines.append("有日期的停辦每年：" + "、".join(f"{year} 年 {count}" for year, count in sorted(per_year.items())))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    global CACHE_DIR
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--since", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--merge", type=Path, help="舊的回補檔（10-15 的四欄檔或八欄檔）")
    parser.add_argument("--cache", type=Path, help="下載檔案的快取目錄，重跑不重抓")
    args = parser.parse_args(argv)
    CACHE_DIR = args.cache
    try:
        rows, stats = build_rows(args.since, args.merge)
    except GhError as exc:
        raise SystemExit(str(exc)) from exc
    except KindergartenFormatError as exc:
        raise SystemExit(f"最新一版的資料格式不對：{exc}") from exc
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, list(COLUMNS), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    try:
        load_closure_backfill(args.out)  # 自檢：同步會用同一支載入程式讀這個檔，現在讀不了就不留下壞檔
    except BackfillFormatError as exc:
        args.out.unlink()
        raise SystemExit(f"輸出的檔案載入器讀不了，已刪除 {args.out.name}：{exc}") from exc
    print(summary(rows, stats))


if __name__ == "__main__":
    main()
