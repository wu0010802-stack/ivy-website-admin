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
from app.campuses.models import CAMPUS_NAMES, Campus
from app.config import get_settings
from app.db import create_engine, create_session_factory
from app.workers.maintenance import run_cycle

CAMPUSES = list(CAMPUS_NAMES.items())


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


async def content_seed_from_fixture(fixture_path: str, *, force: bool, dry_run: bool) -> None:
    """把 fixture 的首頁「關於」、首頁大圖標語與頁尾文字寫進後台並發布。

    只適合全新的資料庫：這三項任何一項已經有版本（後台編輯過、或跑過
    initialize-content）就拒絕，避免把園方改好的文字蓋回原型文字；確定要蓋
    才加 --force（舊版本仍留在版本紀錄，可以還原）。新環境請改用
    initialize-content，它只補空白項目、不會覆寫。"""
    from app.content.initialize import SeedRefused, seed_from_fixture

    data = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    factory = await _session_factory()
    async with factory() as db:
        result = await db.execute(select(User).where(User.role == Role.SUPER_ADMIN).limit(1))
        admin_user = result.scalar_one_or_none()
        created_by = admin_user.id if admin_user else None
        try:
            plan = await seed_from_fixture(db, data, created_by, force=force, dry_run=dry_run)
        except SeedRefused as exc:
            await db.rollback()
            print(
                f"以下內容已經有版本，可能是後台編輯過的，這次不寫入：{'、'.join(exc.existing)}。"
                "新環境請用 initialize-content；確定要用 fixture 蓋回去再加 --force。",
                file=sys.stderr,
            )
            raise SystemExit(1) from exc
        if dry_run:
            await db.rollback()
            print(f"dry-run：欄位驗證通過，會寫入並發布 {'、'.join(plan.kinds)}（未寫入）。")
            if plan.existing:
                print(f"其中 {'、'.join(plan.existing)} 已經有版本，--force 會以 fixture 文字另存新版並發布。")
            return
        await db.commit()
        print(f"已寫入並發布 {'、'.join(plan.kinds)}（來源：{fixture_path}）。")


async def initialize_content_command(fixture_path: str, *, dry_run: bool) -> None:
    """驗證所有 payload 後，只補還沒有任何版本的內容項並發布；dry-run 列出會補哪些。"""
    from app.content.initialize import faq_adoption_candidates, initialize_content, pending_initialization

    data = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    factory = await _session_factory()
    async with factory() as db:
        adopt = await faq_adoption_candidates(db, data)
        adopt_note = (
            f"{'、'.join(adopt)} 的常見問題還是原型匯入的版本，改用全站共用題目"
            "（拿掉搬進共用的那幾題並發布；題目內容不變，共用題目排在本校題目之前）。"
        )
        if dry_run:
            pending = await pending_initialization(db, data)
            await db.rollback()
            print(f"dry-run：欄位驗證通過，會初始化並發布 {len(pending)} 筆內容（未寫入）。")
            for kind, campus in pending:
                print(f"  - {kind}{f'（{campus}）' if campus else ''}")
            if adopt:
                print(f"另外：{adopt_note}")
            return
        count = await initialize_content(db, data)
        await db.commit()
        print(f"已初始化並發布 {count} 筆內容；既有草稿及發布版本未變更。")
        if adopt:
            print(f"另外：{adopt_note}")


async def process_notifications_once() -> None:
    """手動跑一輪定期工作（排程發布、逾期占位、依規則補時段、提醒、通知、清限流計數）。正式站
    的 API 已經每 60 秒自己跑一次（app/workers/maintenance.py），這個指令
    留給本機、測試與臨時補跑；兩者同時執行時後到者會跳過，不會重複處理。
    寄信未設定時如實印出「未配置」，站內通知照寫、不假裝寄出。"""
    settings = get_settings()
    factory = await _session_factory()
    result = await run_cycle(factory, settings, worker_id="cli-worker")
    if not result.ran:
        print("另一個程序正在執行定期工作，這次跳過。")
        return
    if result.published or result.publish_failed or result.publish_skipped:
        print(f"排程發布：成功 {result.published} 筆、失敗 {result.publish_failed} 筆")
    if result.publish_skipped:
        print(f"另有 {result.publish_skipped} 筆排程到期時官網已經是較新的版本，沒有蓋回去。")
    if result.expired_holds:
        print(f"已釋放 {result.expired_holds} 筆逾期的時段占位。")
    if result.slots_generated:
        print(f"已依每週規則補上 {result.slots_generated} 場時段。")
    if result.reminders_enqueued:
        print(f"已產生 {result.reminders_enqueued} 則提醒（即將參觀、逾期未處理）。")
    if not result.email_configured:
        print("尚未設定 WEBSITE_SMTP_HOST 或 WEBSITE_NOTIFICATION_EMAIL_SINK_DIR，email 通知未配置（站內通知照寫）。")
    print(f"已處理通知：成功 {result.notifications_sent} 筆、失敗 {result.notifications_failed} 筆")
    if result.notifications_skipped:
        print(f"另有 {result.notifications_skipped} 則提醒到寄送時已不適用（改期、取消或已處理），未送出。")
    if result.failed_steps:
        print(f"以下步驟失敗，詳見錯誤紀錄：{'、'.join(result.failed_steps)}", file=sys.stderr)
        raise SystemExit(1)


async def requeue_notifications(campus_key: str | None, dry_run: bool) -> None:
    """把寄送失敗（已達自動重試上限）的通知重新排入，下一輪定期工作重送。
    已送到的管道與收件人會略過，不會重複寫站內通知或重推 LINE。後台「站內
    通知」頁也可以逐則或整批重新寄送；這個指令給 SMTP 修好後一次補送用。"""
    from app.notifications import outbox_admin

    factory = await _session_factory()
    async with factory() as db:
        scope = {campus_key} if campus_key else None
        if dry_run:
            failed = await outbox_admin.list_failed(db, scope, limit=10_000)
            print(f"寄送失敗的通知共 {len(failed)} 則（dry-run，未重新排入）。")
            for item in failed:
                print(f"  - {item['id']} {item['campus_key']} {item['kind']}（{item['error_code'] or '無錯誤碼'}）")
            return
        count = await outbox_admin.requeue_all_failed(db, scope, actor_user_id=None, source="cli")
        await db.commit()
    print(f"已重新排入 {count} 則寄送失敗的通知，下一輪定期工作（約一分鐘內）會重送。")


async def media_copy_to_s3(dry_run: bool) -> None:
    """把 volume（WEBSITE_MEDIA_ROOT）上的素材複製到 S3，供切換
    WEBSITE_MEDIA_STORAGE=s3 之前執行。只讀本機、只寫 S3、不動 DB；S3 已有
    同大小的物件就跳過，可以重跑。步驟見 deploy/README.md「素材改存 S3」。"""
    from app.media import service as media_service
    from app.media.models import MediaAsset, MediaVariant
    from app.media.storage import LocalMediaStorage

    settings = get_settings()
    if not settings.s3_configured:
        print("尚未設定 WEBSITE_S3_BUCKET／WEBSITE_S3_ACCESS_KEY_ID／WEBSITE_S3_SECRET_ACCESS_KEY。", file=sys.stderr)
        raise SystemExit(1)
    local = LocalMediaStorage(settings.media_root)
    remote = media_service.s3_storage(settings)
    factory = await _session_factory()
    async with factory() as db:
        keys = list((await db.execute(select(MediaAsset.storage_key))).scalars())
        keys += list((await db.execute(select(MediaVariant.storage_key))).scalars())

    copied = skipped = missing = failed = 0
    for key in keys:
        path = local.path_for(key)
        if not path.is_file():
            # DB 有記錄、volume 沒檔案：現在的官網上本來就是破圖，搬不過去。
            missing += 1
            print(f"本機找不到，略過：{key}")
            continue
        size = path.stat().st_size
        if remote.size(key) == size:
            skipped += 1
            continue
        if dry_run:
            copied += 1
            continue
        try:
            remote.upload_file(key, path)
            if remote.size(key) != size:
                raise RuntimeError("上傳後大小不符")
        except Exception as exc:  # noqa: BLE001 - 一個檔案失敗不中斷整批，最後一起回報
            failed += 1
            print(f"複製失敗：{key}（{type(exc).__name__}）", file=sys.stderr)
            continue
        copied += 1

    verb = "將複製" if dry_run else "已複製"
    print(f"共 {len(keys)} 個檔案：{verb} {copied}、S3 已有 {skipped}、本機缺檔 {missing}、失敗 {failed}。")
    if failed:
        raise SystemExit(1)


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "用法：python -m app.cli <seed|seed --dry-run|bootstrap-admin|"
            "content-seed-from-fixture <fixture> [--dry-run] [--force]|"
            "initialize-content <fixture> [--dry-run]|process-notifications|"
            "requeue-notifications [--campus <key>] [--dry-run]|media-copy-to-s3 [--dry-run]>",
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
        args = [arg for arg in sys.argv[2:] if not arg.startswith("--")]
        flags = {arg for arg in sys.argv[2:] if arg.startswith("--")}
        if len(args) != 1 or flags - {"--dry-run", "--force"}:
            print("用法：python -m app.cli content-seed-from-fixture <fixture路徑> [--dry-run] [--force]", file=sys.stderr)
            raise SystemExit(1)
        asyncio.run(content_seed_from_fixture(args[0], force="--force" in flags, dry_run="--dry-run" in flags))
    elif command == "initialize-content":
        args = [arg for arg in sys.argv[2:] if not arg.startswith("--")]
        flags = {arg for arg in sys.argv[2:] if arg.startswith("--")}
        if len(args) != 1 or flags - {"--dry-run"}:
            raise SystemExit("用法：python -m app.cli initialize-content <fixture路徑> [--dry-run]")
        asyncio.run(initialize_content_command(args[0], dry_run="--dry-run" in flags))
    elif command == "process-notifications":
        asyncio.run(process_notifications_once())
    elif command == "requeue-notifications":
        args = sys.argv[2:]
        campus_key = None
        if "--campus" in args:
            index = args.index("--campus")
            if index + 1 >= len(args):
                raise SystemExit("用法：python -m app.cli requeue-notifications [--campus <key>] [--dry-run]")
            campus_key = args[index + 1]
        asyncio.run(requeue_notifications(campus_key, "--dry-run" in args))
    elif command == "media-copy-to-s3":
        asyncio.run(media_copy_to_s3("--dry-run" in sys.argv[2:]))
    else:
        print(f"未知指令：{command}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
