#!/usr/bin/env python3
"""把官網招生資料匯出成園務招生三張表的 JSONL（規格 12.2；格式見
contracts/ivy-recruitment/README.md）。

只讀：連線的 default_transaction_read_only 設成 on，寫入會被資料庫擋下；結束一律
rollback。所有校區在同一個 REPEATABLE READ 交易內查詢，訪視、歷程、計畫名額是同一個
快照（匯出途中有人改資料也不會對不上）。校區→租戶對照由命令列給（不寫死：明華、
崇德、國際的租戶還不存在）。

用法（在 backend/ 下，環境變數同 API）：
  uv run python scripts/export_ivy_recruitment.py --campus yihua=1 --campus renwu=3 --out <輸出目錄>

每個校區輸出到 <輸出目錄>/<campus_key>/ 的四個 JSONL。內容含幼生與家長個資：目錄
0700、檔案 0600，已存在的檔案不覆寫。"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine  # noqa: E402

from app.admissions import export  # noqa: E402
from app.booking import models as booking_models  # noqa: E402,F401  招生訪視的外鍵 visit_requests 要在同一份 metadata
from app.campuses.models import CAMPUS_KEYS  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402


def readonly_engine(settings: Settings) -> AsyncEngine:
    """每條連線一建立就是唯讀交易（asyncpg server_settings），隔離等級 REPEATABLE READ：
    同一個交易內的查詢都看同一個快照。"""
    return create_async_engine(
        settings.active_database_url(),
        hide_parameters=True,
        isolation_level="REPEATABLE READ",
        connect_args={"server_settings": {"default_transaction_read_only": "on"}},
    )


def _campus_tenant(value: str) -> tuple[str, int]:
    campus_key, separator, tenant = value.partition("=")
    if not separator or campus_key not in CAMPUS_KEYS or not tenant.isdigit():
        raise argparse.ArgumentTypeError(f"格式是「校區=租戶編號」，例如 yihua=1；校區只能是 {'、'.join(CAMPUS_KEYS)}")
    return campus_key, int(tenant)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="匯出官網招生資料（園務欄位形狀，只讀）")
    parser.add_argument("--campus", action="append", required=True, type=_campus_tenant, metavar="校區=租戶編號")
    parser.add_argument("--out", required=True, type=Path, help="輸出目錄（每個校區一個子資料夾）")
    return parser.parse_args(argv)


async def run(campuses: list[tuple[str, int]], out: Path) -> int:
    engine = readonly_engine(get_settings())
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            for campus_key, tenant_id in campuses:
                result = await export.export_campus(db, campus_key, tenant_id=tenant_id)
                paths = export.write_jsonl(result, out / campus_key)
                counts = "、".join(f"{name} {len(result[name])} 筆" for name in export.FILES)
                print(f"{campus_key}（租戶 {tenant_id}）：{counts} → {paths[0].parent}")
            await db.rollback()
    finally:
        await engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    return asyncio.run(run(args.campus, args.out))


if __name__ == "__main__":
    raise SystemExit(main())
