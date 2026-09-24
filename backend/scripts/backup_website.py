#!/usr/bin/env python3
"""備份官網資料庫與媒體檔案。只能對明確標示為隔離開發/測試的資料庫
操作——沿用 app.config.Settings 的驗證邏輯（拒絕連 ivymanagement，
拒絕未標示 test 的 DSN）。

用法：uv run python scripts/backup_website.py <輸出目錄>
"""
from __future__ import annotations

import os
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from app.config import get_settings  # noqa: E402


def _pg_dump_args(database_url: str) -> list[str]:
    """把 SQLAlchemy 的 asyncpg DSN 轉成 pg_dump 看得懂的連線參數；
    不把密碼印進任何輸出。"""
    parsed = urlparse(database_url.replace("+asyncpg", ""))
    args = ["pg_dump", "--no-owner", "--no-privileges"]
    if parsed.hostname:
        args += ["-h", parsed.hostname]
    if parsed.port:
        args += ["-p", str(parsed.port)]
    if parsed.username:
        args += ["-U", parsed.username]
    args.append(parsed.path.lstrip("/"))
    return args


def _open_private(path: Path):
    """建立只有擁有者可讀寫的新檔；已存在（含符號連結）就失敗，不覆寫。"""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    return os.fdopen(fd, "wb")


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：uv run python scripts/backup_website.py <輸出目錄>", file=sys.stderr)
        return 1

    settings = get_settings()
    database_url = settings.active_database_url()

    output_dir = Path(sys.argv[1])
    # 備份含家長與孩子個資：目錄只給擁有者（0700），檔案 0600，不依賴
    # 執行環境的 umask。既有目錄若其他帳號進得去就拒絕，不擅自改它的
    # 權限（使用者可能指到 /tmp 這種共用目錄）。
    output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output_dir.is_symlink() or output_dir.stat().st_mode & 0o077:
        print(
            f"輸出目錄 {output_dir} 不是只有擁有者可存取（需要 0700 的一般目錄），拒絕寫入備份。",
            file=sys.stderr,
        )
        return 1
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    dump_path = output_dir / f"website-db-{timestamp}.sql"
    print(f"備份資料庫（環境：{settings.environment}）到 {dump_path} ...")
    with _open_private(dump_path) as f:
        result = subprocess.run(_pg_dump_args(database_url), stdout=f, env={**os.environ})
    if result.returncode != 0:
        print("pg_dump 失敗，請確認本機有裝 PostgreSQL client 工具", file=sys.stderr)
        return 1

    media_root = Path(settings.media_root)
    if media_root.exists():
        media_archive = output_dir / f"website-media-{timestamp}.tar.gz"
        print(f"打包媒體檔案到 {media_archive} ...")
        with _open_private(media_archive) as f, tarfile.open(fileobj=f, mode="w:gz") as tar:
            tar.add(media_root, arcname="media")
    else:
        print(f"媒體目錄 {media_root} 不存在，略過媒體打包（可能還沒有上傳過素材）。")

    print("備份完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
