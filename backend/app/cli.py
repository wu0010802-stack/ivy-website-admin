from __future__ import annotations

import asyncio
import getpass
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.auth import service
from app.auth.models import Role, User
from app.campuses.models import Campus
from app.config import get_settings
from app.db import create_engine, create_session_factory

CAMPUSES = [
    ("yihua", "義華校"),
    ("minghua", "明華校"),
    ("chongde", "崇德校"),
    ("international", "國際校"),
    ("renwu", "仁武校"),
]


async def _session_factory():
    settings = get_settings()
    engine = create_engine(settings)
    return create_session_factory(engine)


async def seed(dry_run: bool) -> None:
    """五校 seed；重跑不覆寫既有資料（只 INSERT 缺少的 key）。"""
    factory = await _session_factory()
    async with factory() as db:
        result = await db.execute(select(Campus.key))
        existing = {row[0] for row in result.all()}
        missing = [(key, name) for key, name in CAMPUSES if key not in existing]

        if dry_run:
            if missing:
                print("將新增以下校區：")
                for key, name in missing:
                    print(f"  - {key}（{name}）")
            else:
                print("五校已全數存在，dry-run 不會新增任何資料。")
            return

        for key, name in missing:
            db.add(Campus(key=key, name=name, active=True))
        await db.commit()
        print(f"已新增 {len(missing)} 筆校區資料（既有資料未被覆寫）。")


async def bootstrap_admin() -> None:
    """互動式建立第一位總管理者；密碼不接受 command line 參數、不寫入 log。"""
    email = input("總管理者 email：").strip()
    if not email:
        print("email 不可為空", file=sys.stderr)
        raise SystemExit(1)

    factory = await _session_factory()
    async with factory() as db:
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none() is not None:
            print(f"{email} 已存在，取消建立。", file=sys.stderr)
            raise SystemExit(1)

        password = getpass.getpass("密碼（至少 12 字元，輸入時不顯示）：")
        confirm = getpass.getpass("再輸入一次密碼：")
        if password != confirm:
            print("兩次密碼不一致，取消建立。", file=sys.stderr)
            raise SystemExit(1)
        if len(password) < 12:
            print("密碼至少需要 12 字元，取消建立。", file=sys.stderr)
            raise SystemExit(1)

        user = User(
            id=uuid.uuid4(),
            email=email,
            password_hash=service.hash_password(password),
            role=Role.SUPER_ADMIN,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.commit()
        print(f"已建立總管理者：{email}")


def main() -> None:
    if len(sys.argv) < 2:
        print("用法：python -m app.cli <seed|seed --dry-run|bootstrap-admin>", file=sys.stderr)
        raise SystemExit(1)

    command = sys.argv[1]
    if command == "seed":
        dry_run = "--dry-run" in sys.argv[2:]
        asyncio.run(seed(dry_run))
    elif command == "bootstrap-admin":
        asyncio.run(bootstrap_admin())
    else:
        print(f"未知指令：{command}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
