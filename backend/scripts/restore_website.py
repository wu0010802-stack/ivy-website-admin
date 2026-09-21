#!/usr/bin/env python3
"""還原官網資料庫備份。**只能還原到明確標示為隔離測試的資料庫**，
還原前會重新驗證目標 DSN（沿用 Settings 的隔離檢查，且額外要求
WEBSITE_ENVIRONMENT=test，不接受 development/production 環境執行還原，
避免不小心蓋掉正在使用的開發資料庫）。

用法：WEBSITE_ENVIRONMENT=test uv run python scripts/restore_website.py <dump.sql 路徑>
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from app.config import get_settings  # noqa: E402


def _psql_args(database_url: str) -> list[str]:
    parsed = urlparse(database_url.replace("+asyncpg", ""))
    args = ["psql", "--quiet"]
    if parsed.hostname:
        args += ["-h", parsed.hostname]
    if parsed.port:
        args += ["-p", str(parsed.port)]
    if parsed.username:
        args += ["-U", parsed.username]
    args += ["-d", parsed.path.lstrip("/")]
    return args


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：uv run python scripts/restore_website.py <dump.sql 路徑>", file=sys.stderr)
        return 1

    dump_path = Path(sys.argv[1])
    if not dump_path.exists():
        print(f"找不到備份檔：{dump_path}", file=sys.stderr)
        return 1

    settings = get_settings()
    if settings.environment != "test":
        print(
            "拒絕還原：這個指令只能在 WEBSITE_ENVIRONMENT=test 時執行，"
            f"目前是 {settings.environment}。還原前先確認目標是隔離測試環境。",
            file=sys.stderr,
        )
        return 1

    database_url = settings.active_database_url()
    print(f"還原到隔離測試資料庫（DSN 已通過 Settings 驗證，非 ivymanagement）...")
    with open(dump_path, encoding="utf-8") as f:
        result = subprocess.run(_psql_args(database_url), stdin=f, env={**os.environ})
    if result.returncode != 0:
        print("還原失敗", file=sys.stderr)
        return 1

    print("還原完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
