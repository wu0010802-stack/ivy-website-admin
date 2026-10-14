"""招生區域分析：用真實公開資料量地址比對率（2026-10-08 規格 §14.2，不進 CI）。

把完整的高雄市門牌 CSV 匯進 WEBSITE_TEST_DATABASE_URL 指的資料庫（要先 alembic upgrade
head），再拿 kiang preschools.json 裡高雄市營業中幼兒園的地址（公開的園所地址，不是
家長資料）跑 locate()。精確＋鄰近 ≥ 95% 才算通過（exit 0）。

匯入完會把該資料庫裡其他門牌批次全部刪掉（啟用新批次的標準動作），所以只准寫入專用的
報告庫：WEBSITE_ENVIRONMENT 必須是 test，且資料庫名稱要含 geo（例如
ivy_website_area1008_geo_test；共用測試庫、dev、prod 一律拒絕，exit 2）。用完 dropdb。

新成屋（2026-10-14 里的變化規格 §4.3，B2 開工前）：另給 `--new-homes <高雄市買賣季檔.csv> --season 115S3`，篩出
新成屋（V7）後用同一套比對量「到里」（exact＋nearby＋street）的比例，門檻 90%；兩項都過才 exit 0。

用法（在 backend/）：
  WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \\
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_geo_test \\
  WEBSITE_SESSION_SECRET=local-only-session-secret-0000 \\
  uv run python scripts/geo_match_report.py <門牌.csv> <preschools.json> [--label 115-10] \\
      [--new-homes 115S3_e_lvr_land_a.csv --season 115S3]
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, text
from sqlalchemy.engine import make_url

from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo import new_homes as new_homes_io
from app.admissions.geo.matcher import locate
from app.admissions.geo.models import GeoDoorplate
from app.config import get_settings
from app.db import create_engine, create_session_factory

PASS_RATE = 0.95
NEW_HOMES_PASS_RATE = 0.90
# 批次標記 f"{label}#report" 要放得進 geo_doorplates.dataset_version（String(16)）。
MAX_LABEL_LENGTH = 9


async def _rows(path: Path):
    parser = doorplate_io.DoorplateParser()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for line in handle:
            row = parser.feed(line)
            if row is not None:
                yield row
    print(f"門牌：解析 {parser.parsed} 列、略過 {parser.skipped} 列")


async def main(args: argparse.Namespace) -> int:
    if len(args.label) > MAX_LABEL_LENGTH:
        print(f"拒絕執行：--label 最長 {MAX_LABEL_LENGTH} 個字元", file=sys.stderr)
        return 2
    settings = get_settings()
    if settings.environment != "test":
        print("拒絕執行：只能在 WEBSITE_ENVIRONMENT=test 下寫入專用的報告庫", file=sys.stderr)
        return 2
    database = make_url(settings.active_database_url()).database or ""
    if "geo" not in database.lower():
        print(f"拒絕執行：資料庫 {database!r} 不是專用報告庫（名稱要含 geo）", file=sys.stderr)
        return 2
    print(f"目標資料庫：{database}")
    engine = create_engine(settings)
    session_factory = create_session_factory(engine)
    tag = f"{args.label}#report"
    try:
        async with session_factory() as db:
            await db.execute(text("SET LOCAL statement_timeout = 0"))
            await db.execute(delete(GeoDoorplate).where(GeoDoorplate.dataset_version == tag))
            await db.commit()
        count = await doorplate_io.import_doorplates(session_factory, tag, _rows(Path(args.doorplates)))
        await doorplate_io.activate_doorplates(session_factory, tag, args.label, now=datetime.now(timezone.utc))
        print(f"門牌：匯入 {count} 筆（{args.label}）")
        data = json.loads(Path(args.preschools).read_text(encoding="utf-8"))
        levels: collections.Counter[str] = collections.Counter()
        misses: list[str] = []
        async with session_factory() as db:
            for feature in data["features"]:
                props = feature["properties"]
                if props.get("city") != "高雄市" or str(props.get("is_active")) != "1":
                    continue
                address = "高雄市" + str(props.get("town") or "") + re.sub(r"^\[\d+\]", "", str(props.get("address") or ""))
                match = await locate(db, address, version=tag)
                levels[match.match_level] += 1
                if match.match_level not in ("exact", "nearby"):
                    misses.append(f"  {match.match_level:<9} {match.unlocated_reason or '':<18} {address}")
        total = sum(levels.values())
        rate = (levels["exact"] + levels["nearby"]) / total if total else 0.0
        print(f"幼兒園地址 {total} 筆：" + "、".join(f"{level} {n}" for level, n in levels.most_common()))
        print(f"精確＋鄰近：{rate:.1%}（門檻 {PASS_RATE:.0%}）")
        print("沒對到門牌的：\n" + "\n".join(misses[:40]))
        passed = rate >= PASS_RATE
        if args.new_homes:
            passed = await _new_homes_report(session_factory, Path(args.new_homes), args.season, tag) and passed
        return 0 if passed else 1
    finally:
        await engine.dispose()


async def _new_homes_report(session_factory, path: Path, season: str, tag: str) -> bool:
    """新成屋到里的比例（以筆數算；同一個門牌鍵只查一次）。"""
    text_ = new_homes_io.decode(path.read_bytes())
    if text_ is None:
        print("新成屋：檔案不是實價登錄的買賣季檔", file=sys.stderr)
        return False
    batch = new_homes_io.parse_csv(text_, new_homes_io.parse_season(season))
    async with session_factory() as db:
        matches = await new_homes_io.match_keys(db, (row.key for row in batch.rows), version=tag)
    levels: collections.Counter[str] = collections.Counter(matches[row.key].match_level for row in batch.rows)
    keys: collections.Counter[str] = collections.Counter(match.match_level for match in matches.values())
    placed = sum(levels[level] for level in ("exact", "nearby", "street"))
    rate = placed / len(batch.rows) if batch.rows else 0.0
    print(f"新成屋 {batch.season}：{len(batch.rows)} 筆（{len(matches)} 個門牌鍵）：" + "、".join(f"{k} {n}" for k, n in levels.most_common()))
    print("  門牌鍵：" + "、".join(f"{k} {n}" for k, n in keys.most_common()))
    print(f"  到里（exact＋nearby＋street）：{rate:.1%}（門檻 {NEW_HOMES_PASS_RATE:.0%}）")
    missed = collections.Counter(
        "".join(str(part) for part in row.key[:4] if part) + (f"{row.number}號" if row.number is not None else "")
        for row in batch.rows if matches[row.key].match_level not in ("exact", "nearby", "street")
    )
    print("  沒到里的門牌（筆數多的在前）：\n" + "\n".join(f"    {n:>4} {key}" for key, n in missed.most_common(30)))
    return rate >= NEW_HOMES_PASS_RATE


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("doorplates")
    parser.add_argument("preschools")
    parser.add_argument("--label", default="115-10")
    parser.add_argument("--new-homes", default=None, help="實價登錄高雄市買賣季檔（e_lvr_land_a.csv）")
    parser.add_argument("--season", default=None, help="新成屋季檔的季別，例如 115S3")
    parsed_args = parser.parse_args()
    if parsed_args.new_homes and not parsed_args.season:
        parser.error("--new-homes 要配 --season")
    sys.exit(asyncio.run(main(parsed_args)))
