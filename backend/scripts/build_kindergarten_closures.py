"""產生 app/admissions/geo_data/kindergarten-closures-<日期>.csv（2026-10-15 幼兒園名單規格 §5.3）。

kiang preschools.json 標營業中（is_active＝1）、但已不在教育部名單（docs/data/高雄市.csv）的高雄幼兒園，
各自離開名單的日期（名單歷史裡第一個不含它的版本，台北日期）與處理方式：
- renamed：名單上有同地址、同設立日的另一所（改名或換承辦），只下架；
- closed：停辦；離開日期在 --since 之前的 left_on 留空（只下架、不寫事件）。
開發用，不進執行期。需要已登入的 gh CLI（約 60 個 GitHub API 請求）。

用法（在 backend/）：
  uv run --frozen python scripts/build_kindergarten_closures.py --since 2025-06-01 \\
      --out app/admissions/geo_data/kindergarten-closures-20261015.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admissions.geo.kindergartens import Registry, parse_preschools, parse_registry, registry_key  # noqa: E402
from app.admissions.geo.providers import months_ago  # noqa: E402

REPO = "kiang/ap.ece.moe.edu.tw"
REGISTRY_PATH = "docs/data/高雄市.csv"
JSON_PATH = "docs/preschools.json"
TAIPEI = timezone(timedelta(hours=8))
SCHOOL_YEAR = 115  # 只用來把 JSON 轉成資料列；類型不影響這裡的判斷


def gh(*args: str) -> str:
    for _ in range(3):
        done = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
        if done.returncode == 0:
            return done.stdout
    raise SystemExit(f"gh api 失敗：{' '.join(args)}\n{done.stderr[:300]}")


def raw(path: str, sha: str) -> str:
    return gh("-H", "Accept: application/vnd.github.raw", f"repos/{REPO}/contents/{urllib.parse.quote(path)}?ref={sha}")


def history(since: date) -> list[tuple[str, date]]:
    """名單的 commit，新到舊：(sha, 台北日期)。"""
    query = f"repos/{REPO}/commits?path={urllib.parse.quote(REGISTRY_PATH)}&since={since.isoformat()}T00:00:00Z&per_page=100"
    lines = gh("--paginate", query, "--jq", ".[] | [.sha, .commit.committer.date] | @tsv").splitlines()
    commits = []
    for line in lines:
        sha, stamp = line.split("\t")
        commits.append((sha, datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(TAIPEI).date()))
    return commits


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--since", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    head = gh(f"repos/{REPO}/commits/master", "--jq", ".sha").strip()
    registry = parse_registry(raw(REGISTRY_PATH, head))
    data = json.loads(raw(JSON_PATH, head))
    open_rows = parse_preschools(data, registry=registry, school_year=SCHOOL_YEAR)
    # 幽靈＝kiang 標營業中（舊程式會收進資料表的）、但不在當前名單的高雄園所。
    ghost_keys: set[tuple[str, str]] = set()
    key_of: dict[str, tuple[str, str]] = {}
    for feature in data["features"]:
        props = feature.get("properties") or {}
        key = registry_key(props.get("reg_docno"), props.get("title"))
        key_of[str(props.get("id"))] = key
        in_kaohsiung = str(props.get("city") or "").replace("臺", "台") == "高雄市"
        if in_kaohsiung and str(props.get("is_active")) == "1" and key not in registry.keys:
            ghost_keys.add(key)
    ghosts = parse_preschools(data, registry=Registry(frozenset(ghost_keys), frozenset()), school_year=SCHOOL_YEAR)
    same_place = set(registry.places) | {(row.address, row.registered_on) for row in open_rows if row.registered_on}

    commits = history(args.since)
    cache: dict[str, frozenset[tuple[str, str]]] = {}

    def listed(index: int) -> frozenset[tuple[str, str]]:
        sha = commits[index][0]
        if sha not in cache:
            cache[sha] = parse_registry(raw(REGISTRY_PATH, sha)).keys
        return cache[sha]

    out_rows = []
    oldest = len(commits) - 1
    for row in ghosts:
        key = key_of[row.source_id]
        left_on: date | None = None
        if key in listed(oldest):
            lo, hi = 0, oldest  # lo 不含、hi 含
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if key in listed(mid):
                    hi = mid
                else:
                    lo = mid
            left_on = commits[lo][1]
        renamed = row.registered_on is not None and (row.address, row.registered_on) in same_place
        out_rows.append(
            {"source_id": row.source_id, "name": row.name, "left_on": left_on.isoformat() if left_on else "",
             "reason": "renamed" if renamed else "closed"}
        )
    out_rows.sort(key=lambda item: (item["left_on"] or "0000-00-00", item["name"]))
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, ["source_id", "name", "left_on", "reason"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(out_rows)

    window = months_ago(datetime.now(TAIPEI).date(), 12).isoformat()
    closed = [item for item in out_rows if item["reason"] == "closed"]
    recent = [item for item in closed if item["left_on"] >= window]
    print(
        f"head {head[:10]}：名單 {len(registry.keys)} 所、營業中有座標 {len(open_rows)} 所；"
        f"回補 {len(out_rows)} 筆＝停辦 {len(closed)}（近 12 個月 {len(recent)}）、改名 {len(out_rows) - len(closed)}；"
        f"抓了 {len(cache)} 個歷史版本"
    )
    for item in recent:
        print(f"  {item['left_on']} {item['name']}")


if __name__ == "__main__":
    main()
