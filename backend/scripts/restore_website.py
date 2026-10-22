#!/usr/bin/env python3
"""還原官網資料庫備份。**只能還原到明確標示為隔離測試的資料庫**，
還原前會重新驗證目標 DSN（沿用 Settings 的隔離檢查，且額外要求
WEBSITE_ENVIRONMENT=test，不接受 development/production 環境執行還原，
避免不小心蓋掉正在使用的開發資料庫）。

目標必須是剛 createdb、還沒有任何資料表的空庫：備份是 plain pg_dump（沒有 --clean），
還原整批包在一個交易、出錯就停，灌進已有 schema 的庫會在第一句 CREATE TABLE 失敗並整批回滾。

用法：WEBSITE_ENVIRONMENT=test uv run python scripts/restore_website.py <dump.sql 路徑>
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from app import libpq  # noqa: E402
from app.config import get_settings  # noqa: E402


def _psql_command(database_url: str) -> tuple[list[str], dict[str, str]]:
    """psql 的命令列與環境變數；密碼與 TLS 要求只走環境變數（見 backup_website._pg_dump_command）。
    出錯就停、整批包在一個交易：中途失敗全部回滾並回非 0，不會留下半新半舊的資料還印「還原完成」。"""
    connection = libpq.parse(database_url)
    return (
        [
            "psql",
            "--quiet",
            "-v",
            "ON_ERROR_STOP=1",
            "--single-transaction",
            *connection.host_args(),
            "-d",
            connection.dbname,
        ],
        connection.env,
    )


def _refusal(database_url: str) -> str | None:
    """Settings 只檢查整串 DSN 含不含 test（帳號、密碼、主機名裡有 test 也算過）；
    還原會整批覆寫，另外要求「資料庫名稱」本身標明是測試庫（2026-10-22 資安稽核）。
    psql -d 遇到含 = 或 URI 開頭的值會當成連線字串展開（可以換掉主機與庫名），一律拒絕。"""
    dbname = libpq.parse(database_url).dbname
    if not dbname or "=" in dbname or any(ch.isspace() for ch in dbname) or "://" in dbname:
        return "目標資料庫名稱不是單純的名稱"
    if "test" not in dbname.lower():
        return "目標資料庫名稱沒有標明 test，不像隔離測試庫"
    return None


def _has_tables(command: list[str], env: dict[str, str]) -> bool:
    """目標庫 public schema 裡有沒有資料表（還原只接受剛 createdb 的空庫）。"""
    query = [*command, "-tAc", "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"]
    result = subprocess.run(query, env={**os.environ, **env}, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("連不上目標資料庫")
    return int(result.stdout.strip() or 0) > 0


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
    try:
        refusal = _refusal(database_url)
        command, connection_env = _psql_command(database_url)
    except libpq.UnsupportedDsn as exc:
        print(f"拒絕還原：{exc}", file=sys.stderr)
        return 1
    if refusal:
        print(f"拒絕還原：{refusal}", file=sys.stderr)
        return 1
    try:
        not_empty = _has_tables(command, connection_env)
    except RuntimeError as exc:
        print(f"拒絕還原：{exc}", file=sys.stderr)
        return 1
    if not_empty:
        print("拒絕還原：目標庫已經有資料表，請還原到剛 createdb 的空庫", file=sys.stderr)
        return 1
    print("還原到隔離測試資料庫（DSN 已通過 Settings 驗證、資料庫名稱標明 test、目標是空庫）...")
    with open(dump_path, encoding="utf-8") as f:
        result = subprocess.run(command, stdin=f, env={**os.environ, **connection_env})
    if result.returncode != 0:
        print("還原失敗，已整批回滾", file=sys.stderr)
        return 1

    print("還原完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
