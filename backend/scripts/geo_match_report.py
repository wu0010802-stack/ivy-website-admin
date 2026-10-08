"""招生區域分析：用真實公開資料量地址比對率（2026-10-08 規格 §14.2，不進 CI）。

把完整的高雄市門牌 CSV 匯進 WEBSITE_TEST_DATABASE_URL 指的資料庫（要先 alembic upgrade
head），再拿 kiang preschools.json 裡高雄市營業中幼兒園的地址（公開的園所地址，不是
家長資料）跑 locate()。精確＋鄰近 ≥ 95% 才算通過（exit 0）。

匯入完會把該資料庫裡其他門牌批次全部刪掉（啟用新批次的標準動作），所以只准寫入專用的
報告庫：WEBSITE_ENVIRONMENT 必須是 test，且資料庫名稱要含 geo（例如
ivy_website_area1008_geo_test；共用測試庫、dev、prod 一律拒絕，exit 2）。用完 dropdb。

用法（在 backend/）：
  WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \\
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_geo_test \\
  WEBSITE_SESSION_SECRET=local-only-session-secret-0000 \\
  uv run python scripts/geo_match_report.py <門牌.csv> <preschools.json> [--label 115-10]
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
from app.admissions.geo.matcher import locate
from app.admissions.geo.models import GeoDoorplate
from app.config import get_settings
from app.db import create_engine, create_session_factory

PASS_RATE = 0.95
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
        return 0 if rate >= PASS_RATE else 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("doorplates")
    parser.add_argument("preschools")
    parser.add_argument("--label", default="115-10")
    sys.exit(asyncio.run(main(parser.parse_args())))
