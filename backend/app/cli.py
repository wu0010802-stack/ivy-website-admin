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
from app.workers.maintenance import run_cycle

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
    """手動跑一輪定期工作（排程發布、逾期占位、通知、清限流計數）。正式站
    的 API 已經每 60 秒自己跑一次（app/workers/maintenance.py），這個指令
    留給本機、測試與臨時補跑；兩者同時執行時後到者會跳過，不會重複處理。
    寄信未設定時如實印出「未配置」，站內通知照寫、不假裝寄出。"""
    settings = get_settings()
    factory = await _session_factory()
    result = await run_cycle(factory, settings, worker_id="cli-worker")
    if not result.ran:
        print("另一個程序正在執行定期工作，這次跳過。")
        return
    if result.published or result.publish_failed:
        print(f"排程發布：成功 {result.published} 筆、失敗 {result.publish_failed} 筆")
    if result.expired_holds:
        print(f"已釋放 {result.expired_holds} 筆逾期的時段占位。")
    if not result.email_configured:
        print("尚未設定 WEBSITE_SMTP_HOST 或 WEBSITE_NOTIFICATION_EMAIL_SINK_DIR，email 通知未配置（站內通知照寫）。")
    print(f"已處理通知：成功 {result.notifications_sent} 筆、失敗 {result.notifications_failed} 筆")
    if result.failed_steps:
        print(f"以下步驟失敗，詳見錯誤紀錄：{'、'.join(result.failed_steps)}", file=sys.stderr)
        raise SystemExit(1)


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
