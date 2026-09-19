#!/usr/bin/env python3
"""匯出 FastAPI OpenAPI schema 到 contracts/openapi.json，供 web/admin
產生共用 TypeScript 型別。只需要 app 物件的 route 定義，不連真實 DB，
用最小的隔離設定建立 app 即可。

用法：uv run python scripts/export_openapi.py [輸出路徑]
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from app.config import Settings
from app.main import create_app

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent.parent / "contracts" / "openapi.json"


def main() -> int:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    output_path = Path(positional[0]) if positional else DEFAULT_OUTPUT
    output_path.parent.mkdir(parents=True, exist_ok=True)

    settings = Settings(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="openapi-export-only-not-a-real-secret",
    )
    app = create_app(settings)
    schema = app.openapi()

    new_content = json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    old_content = output_path.read_text(encoding="utf-8") if output_path.exists() else None

    if "--check" in sys.argv:
        if old_content != new_content:
            print(f"契約已過期：{output_path} 與目前 API 不一致，請執行 export_openapi.py 重新產生")
            return 1
        print("契約與目前 API 一致")
        return 0

    output_path.write_text(new_content, encoding="utf-8")
    print(f"已寫入 {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
