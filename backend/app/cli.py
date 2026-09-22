from __future__ import annotations

import asyncio
import getpass
import sys
import uuid
from datetime import datetime, timezone

import json
from pathlib import Path

from sqlalchemy import func, select

from app.auth import service
from app.auth.models import Role, User
from app.campuses.models import Campus
from app.config import get_settings
from app.content import service as content_service
from app.db import create_engine, create_session_factory
from app.notifications.email_adapter import EmailNotConfigured, get_email_adapter
from app.booking.workflow_service import expire_holds
from app.workers.runner import process_outbox_batch

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
    # 與 UserCreateRequest 共用同一個正規化規則：一律小寫存、小寫比對，
    # 否則 Wang@ 與 wang@ 會變成兩個帳號，之後誰都登不進去。
    email = input("總管理者 email：").strip().lower()
    if not email:
        print("email 不可為空", file=sys.stderr)
        raise SystemExit(1)

    factory = await _session_factory()
    async with factory() as db:
        existing = await db.execute(select(User).where(func.lower(User.email) == email))
        if existing.scalars().first() is not None:
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


async def content_seed_from_fixture(fixture_path: str) -> None:
    """階段 B 一次性工具：把 fixture 目前的 home_about／home_hero／
    site_footer 文字灌進 typed content 系統並直接發布，讓 Nuxt 一開始讀到
    的內容跟現行原型一致，不必園方手動重打一次文案。重跑會用目前
    latest_version 建新 revision，不會出錯，但會多一版歷史
    （屬預期行為，不是覆寫 bug）。"""
    data = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    about = data["home"]["about"]
    hero = data["home"]["hero"]
    footer = data["footer"]

    payloads = {
        "home_about": {
            "title": about["title"],
            "since_label": about["sinceLabel"],
            "body_text": about["bodyText"],
            "caption": about["caption"],
        },
        "home_hero": {
            "eyebrow": hero["eyebrow"],
            "copy_lines": hero["copyLines"],
            "cta_label": hero["ctaLabel"],
        },
        "site_footer": {
            "tagline": footer["tagline"],
        },
    }

    factory = await _session_factory()
    async with factory() as db:
        result = await db.execute(select(User).where(User.role == Role.SUPER_ADMIN).limit(1))
        admin_user = result.scalar_one_or_none()
        created_by = admin_user.id if admin_user else None

        for kind, payload in payloads.items():
            item = await content_service.get_or_create_content_item(db, kind, None)
            revision = await content_service.create_revision(
                db, item, payload, item.latest_version, created_by
            )
            await content_service.publish_revision(db, item, revision, created_by)
            print(f"已建立並發布 {kind} revision v{revision.version}")
        await db.commit()
        print(f"（來源：{fixture_path}）")


async def process_notifications_once() -> None:
    """跑一輪 outbox worker；`WEBSITE_NOTIFICATION_EMAIL_SINK_DIR` 沒設定
    時如實印出「未配置」，不假裝寄出。生產排程可用 cron 定期呼叫這個
    指令，暫不內建常駐 daemon（避免跟本機 8GB RAM 限制下的其他背景
    程序搶資源）。"""
    settings = get_settings()
    try:
        adapter = get_email_adapter(settings.notification_email_sink_dir)
    except EmailNotConfigured:
        print("尚未設定 WEBSITE_NOTIFICATION_EMAIL_SINK_DIR，通知寄送功能未配置。")
        return

    factory = await _session_factory()
    async with factory() as db:
        # 先處理過期占位：規格 222 要求逾期的 pending_confirmation 轉
        # cancelled、釋放名額並通知園方。它會寫進 outbox，所以要排在
        # 處理 outbox 之前，這一輪就能把通知一起送出去。
        expired = await expire_holds(db)
        await db.commit()
        if expired:
            print(f"已釋放 {expired} 筆逾期的時段占位。")

        result = await process_outbox_batch(db, adapter, worker_id="cli-worker")
        print(f"已處理：成功 {result['sent']} 筆、失敗 {result['failed']} 筆")


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "用法：python -m app.cli <seed|seed --dry-run|bootstrap-admin|"
            "content-seed-from-fixture|initialize-content|process-notifications>",
            file=sys.stderr,
        )
        raise SystemExit(1)

    command = sys.argv[1]
    if command == "seed":
        dry_run = "--dry-run" in sys.argv[2:]
        asyncio.run(seed(dry_run))
    elif command == "bootstrap-admin":
        asyncio.run(bootstrap_admin())
    elif command == "content-seed-from-fixture":
        if len(sys.argv) < 3:
            print("用法：python -m app.cli content-seed-from-fixture <fixture路徑>", file=sys.stderr)
            raise SystemExit(1)
        asyncio.run(content_seed_from_fixture(sys.argv[2]))
    elif command == "initialize-content":
        if len(sys.argv) != 3:
            raise SystemExit("用法：python -m app.cli initialize-content <fixture路徑>")
        from app.content.initialize import initialize_content

        async def run_initialize() -> None:
            data = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
            factory = await _session_factory()
            async with factory() as db:
                count = await initialize_content(db, data)
                await db.commit()
                print(f"已初始化並發布 {count} 筆內容；既有草稿及發布版本未變更。")

        asyncio.run(run_initialize())
    elif command == "process-notifications":
        asyncio.run(process_notifications_once())
    else:
        print(f"未知指令：{command}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
