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
        # 等人輸入密碼前先結束這個唯讀交易：執行期連線帶 idle_in_transaction
        # 逾時（app/db.py，預設 5 分鐘），輸入超過逾時的話之後的 commit 會失敗。
        await db.rollback()

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
    from app.content.initialize import initialize_content, pending_initialization

    data = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    factory = await _session_factory()
    async with factory() as db:
        if dry_run:
            pending = await pending_initialization(db, data)
            await db.rollback()
            print(f"dry-run：欄位驗證通過，會初始化並發布 {len(pending)} 筆內容（未寫入）。")
            for kind, campus in pending:
                print(f"  - {kind}{f'（{campus}）' if campus else ''}")
            return
        count = await initialize_content(db, data)
        await db.commit()
        print(f"已初始化並發布 {count} 筆內容；既有草稿及發布版本未變更。")


async def process_notifications_once() -> None:
    """手動跑一輪定期工作（排程發布、依規則補時段、提醒、通知、清限流計數）。正式站
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
    if result.slots_generated:
        print(f"已依每週規則補上 {result.slots_generated} 場時段。")
    if result.reminders_enqueued:
        print(f"已產生 {result.reminders_enqueued} 則提醒（即將參觀）。")
    if result.parent_reminders_enqueued:
        print(f"已排 {result.parent_reminders_enqueued} 封家長參觀提醒信。")
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


_IMPORT_STATUS = {
    "import": "會匯入",
    "exists": "素材庫已有，沿用",
    "missing": "找不到檔案",
    "too_large": "超過上傳上限",
    "imported": "已匯入",
    "failed": "失敗",
}


async def import_site_assets(web_root: Path, *, apply: bool, write_drafts: bool) -> None:
    """把官網內建的 Logo、首屏與孩子的一天的影片和 poster、關於與時刻卡照片、
    五校封面與建築線稿匯入素材庫（app/media/site_import.py）。預設只列出會做
    什麼；--apply 才寫入，--write-drafts 另外把對應版位寫成草稿（不發布）。
    以檔案雜湊去重，可以重跑。"""
    from app.media import service as media_service
    from app.media import site_import

    settings = get_settings()
    entries = site_import.plan_site_assets(web_root)
    max_bytes = {"image": settings.media_max_bytes("image"), "video": settings.media_max_bytes("video")}
    storage = media_service.get_storage(settings)
    factory = await _session_factory()
    async with factory() as db:
        results = await site_import.check_entries(db, entries, max_bytes)
        await db.rollback()
    if apply:
        for result in results:
            if result.status != "import":
                continue
            async with factory() as db:
                await site_import.import_entry(db, storage, result, settings.media_quota_bytes_per_campus)
                if result.status == "imported":
                    await db.commit()
                else:
                    await db.rollback()

    for result in results:
        entry = result.entry
        where = f"{CAMPUS_NAMES.get(entry.campus_key, entry.campus_key)}" if entry.campus_key else "共用"
        media = f" → {result.media_id}" if result.media_id else ""
        note = f"（{result.message}）" if result.message else ""
        print(f"  [{_IMPORT_STATUS[result.status]}] {entry.label}・{where}：{entry.path.name}{media}{note}")

    drafts: list = []
    if write_drafts:
        async with factory() as db:
            drafts = await site_import.write_drafts(db, results, apply=apply)
            if apply:
                await site_import.log_import(db, results, drafts)
                await db.commit()
            else:
                await db.rollback()
        verb = "已寫成草稿" if apply else "會寫成草稿"
        for draft in drafts:
            where = f"（{draft.campus_key}）" if draft.campus_key else ""
            if draft.note:
                print(f"  {draft.kind}{where}：{draft.note}")
                continue
            if draft.written:
                print(f"  {draft.kind}{where}：{verb} {'、'.join(draft.written)}")
            for skipped in draft.skipped:
                print(f"  {draft.kind}{where}：略過 {skipped}")
    elif apply:
        async with factory() as db:
            await site_import.log_import(db, results, [])
            await db.commit()

    counts = {status: sum(1 for r in results if r.status == status) for status in _IMPORT_STATUS}
    if not apply:
        pending = counts["import"]
        print(
            f"dry-run：共 {len(results)} 個檔案，會匯入 {pending}、已在素材庫 {counts['exists']}、"
            f"找不到 {counts['missing']}、超過上限 {counts['too_large']}（未寫入）。加 --apply 才會執行"
            f"{'' if write_drafts else '；加 --write-drafts 會一併把版位寫成草稿'}。"
        )
        return
    print(
        f"共 {len(results)} 個檔案：已匯入 {counts['imported']}、沿用 {counts['exists']}、"
        f"失敗 {counts['failed']}、找不到 {counts['missing']}、超過上限 {counts['too_large']}。"
        + ("草稿不會自動發布，請到後台確認後發布。" if write_drafts else "")
    )
    if counts["failed"]:
        raise SystemExit(1)


async def regenerate_media_variants(*, apply: bool, include_all: bool) -> None:
    """重新產生圖片素材的縮圖、中圖與大圖（app/media/regenerate.py）：2026-09-25 以前
    上傳、縮圖沒有依拍攝方向轉正的圖片，去背圖的衍生檔，缺縮圖、中圖或大圖的圖片。
    預設只列出會處理哪些；--apply 才寫入，每張各自一個交易，失敗的不影響其他張，
    可以重跑（處理完的不會再列出來）。--all 不管需不需要，全部重新產生。"""
    from app.media import regenerate
    from app.media import service as media_service
    from app.operations import audit_service

    settings = get_settings()
    storage = media_service.get_storage(settings)
    factory = await _session_factory()
    async with factory() as db:
        candidates = await regenerate.find_candidates(db, include_all=include_all)
        await db.rollback()

    if not apply:
        for candidate in candidates:
            where = CAMPUS_NAMES.get(candidate.campus_key, candidate.campus_key) if candidate.campus_key else "共用"
            print(f"  {candidate.asset_id}・{where}：{candidate.filename}（{'；'.join(candidate.reasons)}）")
        print(f"dry-run：共 {len(candidates)} 張圖片需要重新產生縮圖、中圖或大圖（未寫入）。加 --apply 才會執行。")
        return

    done: list[str] = []
    failed: list[str] = []
    for candidate in candidates:
        async with factory() as db:
            outcome = None
            try:
                outcome = await regenerate.regenerate_image_variants(db, storage, candidate.asset_id)
                await db.commit()
            except Exception as exc:  # noqa: BLE001 - 一張失敗不中斷整批，最後一起回報
                await db.rollback()
                # 已經寫進儲存空間、但沒進資料庫的新衍生檔（commit 失敗）刪掉。
                for key in outcome.new_keys if outcome else []:
                    await asyncio.to_thread(storage.delete, key)
                reason = str(exc) if isinstance(exc, regenerate.RegenerationFailed) else type(exc).__name__
                failed.append(str(candidate.asset_id))
                print(f"  [失敗] {candidate.asset_id}：{candidate.filename}（{reason}）", file=sys.stderr)
                continue
        # commit 成功才刪舊檔；刪不掉只留下孤兒檔，官網已經改用新的衍生檔。
        for key in outcome.old_keys:
            try:
                await asyncio.to_thread(storage.delete, key)
            except Exception:  # noqa: BLE001
                print(f"  舊衍生檔 {key} 刪除失敗，留下孤兒檔。", file=sys.stderr)
        done.append(str(candidate.asset_id))
        print(f"  [完成] {candidate.asset_id}：{candidate.filename}")

    if done or failed:
        async with factory() as db:
            await audit_service.log_action(
                db,
                actor_user_id=None,
                action="media.regenerate_variants",
                target_type="media_asset",
                target_id="variants",
                metadata={"regenerated": done, "failed": failed, "all": include_all},
            )
            await db.commit()
    print(f"共 {len(candidates)} 張：已重新產生 {len(done)}、失敗 {len(failed)}。")
    if failed:
        raise SystemExit(1)


async def strip_media_metadata(*, apply: bool) -> None:
    """既有素材的原檔去除拍攝資訊（app/media/metadata.py）：PR #14 上線（2026-09-29）
    以前上傳的圖片原檔是原樣保存的，之後的只拿掉 EXIF／XMP／IPTC 等主要區塊，
    影片則一直沒有處理，EXIF／GPS、影片拍攝地點會跟著公開在官網。預設只列出會
    處理哪些；--apply 才改寫：去除後的檔案存成新的 storage key、更新素材記錄的
    大小、sha256 與寬高（轉正後），commit 成功才刪舊檔。每個素材各自一個交易，
    失敗的不影響其他個；已經乾淨的檔案不動，可以重跑。

    舊素材（sha256 為 NULL）的 sha256 維持 NULL：regenerate-media-variants 靠它認出
    還沒轉正的舊縮圖，會在重新產生時補上。舊 GIF 不處理。"""
    import tempfile

    from app.media import metadata as media_metadata
    from app.media import service as media_service
    from app.media.models import MediaAsset, MediaStatus
    from app.media.storage import MediaFileMissing
    from app.media.validation import MediaValidationError
    from app.operations import audit_service

    settings = get_settings()
    storage = media_service.get_storage(settings)
    factory = await _session_factory()
    async with factory() as db:
        rows = (
            await db.execute(
                select(MediaAsset.id, MediaAsset.storage_key, MediaAsset.content_type, MediaAsset.original_filename)
                .where(MediaAsset.status == MediaStatus.READY)
                .order_by(MediaAsset.created_at, MediaAsset.id)
            )
        ).all()
        await db.rollback()

    stripped: list[str] = []
    failed: list[str] = []
    already_clean = missing = skipped = 0
    with tempfile.TemporaryDirectory(prefix="media-strip-") as tmp:
        for row in rows:
            if row.content_type not in media_metadata.STRIPPABLE_CONTENT_TYPES:
                skipped += 1
                continue
            label = f"{row.id}：{row.original_filename}"
            source = Path(tmp) / f"source{Path(row.storage_key).suffix}"
            clean_path: Path | None = None
            try:
                await asyncio.to_thread(storage.download_file, row.storage_key, source)
                clean_path, size = await asyncio.to_thread(media_service.strip_to_temp, source, row.content_type)
                old_sha = await asyncio.to_thread(media_service.file_sha256, source)
                new_sha = await asyncio.to_thread(media_service.file_sha256, clean_path)
                if new_sha == old_sha:
                    already_clean += 1
                    continue
                if not apply:
                    stripped.append(str(row.id))
                    print(f"  {label}")
                    continue
                new_key = storage.generate_key(Path(row.storage_key).suffix)
                await asyncio.to_thread(storage.write_file, new_key, clean_path)
                async with factory() as db:
                    try:
                        asset = (
                            await db.execute(select(MediaAsset).where(MediaAsset.id == row.id).with_for_update())
                        ).scalar_one_or_none()
                        if asset is None or asset.storage_key != row.storage_key:
                            raise RuntimeError("素材在處理期間被改動或刪除")
                        asset.storage_key = new_key
                        asset.size_bytes = clean_path.stat().st_size
                        if asset.sha256 is not None:
                            asset.sha256 = new_sha
                        if size is not None:
                            asset.width, asset.height = size
                        await db.commit()
                    except Exception:
                        await db.rollback()
                        await asyncio.to_thread(storage.delete, new_key)
                        raise
            except (MediaFileMissing, FileNotFoundError):
                missing += 1
                print(f"  [找不到檔案] {label}", file=sys.stderr)
                continue
            except Exception as exc:  # noqa: BLE001 - 一個失敗不中斷整批，最後一起回報
                failed.append(str(row.id))
                reason = exc.message if isinstance(exc, MediaValidationError) else type(exc).__name__
                print(f"  [失敗] {label}（{reason}）", file=sys.stderr)
                continue
            finally:
                source.unlink(missing_ok=True)
                if clean_path is not None:
                    clean_path.unlink(missing_ok=True)
            # commit 成功才刪舊檔；刪不掉只留下孤兒檔，素材已經指向新檔。
            try:
                await asyncio.to_thread(storage.delete, row.storage_key)
            except Exception:  # noqa: BLE001
                print(f"  舊原檔 {row.storage_key} 刪除失敗，留下孤兒檔。", file=sys.stderr)
            stripped.append(str(row.id))
            print(f"  [完成] {label}")

    if apply and (stripped or failed):
        async with factory() as db:
            await audit_service.log_action(
                db,
                actor_user_id=None,
                action="media.strip_metadata",
                target_type="media_asset",
                target_id="originals",
                metadata={"stripped": sorted(stripped), "failed": sorted(failed)},
            )
            await db.commit()
    summary = (
        f"共 {len(rows)} 個素材：{'已去除' if apply else '會去除'} {len(stripped)}、已乾淨 {already_clean}、"
        f"找不到檔案 {missing}、無法處理 {len(failed)}"
    )
    extra = f"；另有 {skipped} 個舊 GIF 等格式不處理" if skipped else ""
    if apply:
        print(f"{summary}{extra}。")
    else:
        print(f"dry-run：{summary}{extra}（未寫入）。加 --apply 才會執行。")
    if failed:
        raise SystemExit(1)


async def transcode_media_videos(*, apply: bool) -> None:
    """既有影片補桌機／手機轉檔版本（app/media/jobs.py）。預設只列出會處理哪些；
    --apply 才排入。正式站（背景模式）只排進佇列，由 API 的背景迴圈一支一支轉，
    素材狀態不動、官網照常播原檔，轉好之後才改播轉檔版本；本機（inline）就地轉完。"""
    from app.media import jobs as media_jobs
    from app.media import service as media_service
    from app.media.models import MediaAsset, MediaJob
    from app.operations import audit_service

    settings = get_settings()
    factory = await _session_factory()
    async with factory() as db:
        candidates = await media_jobs.backfill_candidates(db)
        await db.rollback()
    for c in candidates:
        where = CAMPUS_NAMES.get(c.campus_key, c.campus_key) if c.campus_key else "共用"
        seconds = f"{c.duration:g} 秒" if c.duration else "長度不明"
        print(f"  {c.asset_id}・{where}：{c.filename}（{seconds}，缺 {'、'.join(c.missing)}）")
    if not apply:
        print(f"dry-run：共 {len(candidates)} 支影片需要補轉檔（未排入）。加 --apply 才會執行。")
        return

    async with factory() as db:
        queued = await media_jobs.enqueue_backfill(db, [c.asset_id for c in candidates])
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="media.transcode_backfill",
            target_type="media_asset",
            target_id="videos",
            metadata={"queued": [str(job.media_id) for job in queued]},
        )
        await db.commit()
        job_ids = [job.id for job in queued]

    if settings.media_video_processing_mode == "background":
        print(f"已排入 {len(job_ids)} 支，API 會一支一支轉；進度看素材庫或 /api/website/v1/health 的 media_jobs。")
        return
    storage = media_service.get_storage(settings)
    failed = 0
    for job_id in job_ids:
        async with factory() as db:
            job = await db.get(MediaJob, job_id)
            asset = await db.get(MediaAsset, job.media_id)
            outcome = await media_jobs.process_now(db, storage, asset, job)
            await db.commit()
            failed += outcome == "failed"
            print(f"  [{'完成' if outcome == 'done' else '失敗'}] {asset.original_filename}" + (f"（{job.error}）" if job.error else ""))
    print(f"共 {len(job_ids)} 支：完成 {len(job_ids) - failed}、失敗 {failed}。")
    if failed:
        raise SystemExit(1)


def geo_sync_options(args: list[str]) -> dict:
    """`geo-sync` 的參數。指定任一個檔案就完全不連外，沒指定檔案的那幾種跳過；
    --doorplates-version 省略時從檔名找「115-10」「115_10」，找不到用今天的民國年月。
    --population-file、--births-file、--migration-file 可以給好幾次（內政部 API 一頁一個檔），月份取資料本身的
    統計月份。--income-file 是財政資訊中心的各里所得 CSV，年度取 --income-year 或檔名（「112_165-E.csv」）；
    比使用中舊的年度要加 --force。--new-homes-file 是實價登錄的高雄市買賣季檔（可以給好幾次），季別取檔名
    （「115S3_e_lvr_land_a.csv」）或 --new-homes-season（只能配一個檔）。--presale-file 是實價登錄的高雄市預售屋建案備查檔
    （e_lvr_buildcase.csv），版本月份取檔名（「115-10」）或今天；--presale-parcels-file 是本機腳本
    scripts/fetch_presale_parcels.py 查好的地號座標 CSV（2026-10-20 預售建案規格 P6）。--kindergarten-penalties-file、
    --kindergarten-evaluations-file 是 scripts/fetch_geo_bundle.py 轉出的幼兒園裁罰、評鑑 CSV（2026-10-20 裁罰與評鑑規格 C10，
    沒有姓名與電話欄），整表替換、不檢查筆數下限。--bundle 是 scripts/fetch_geo_bundle.py
    打包的 zip（2026-10-14 里的變化規格 §4.6），等於把裡面的檔各自用 --…-file 指定。
    --kindergartens-file（kiang preschools.json）要和 --kindergartens-registry-file（kiang docs/data/高雄市.csv，教育部名單）
    一起給：營業中以名單為準（2026-10-15），只給一個就報錯。
    --force 一個旗標同時代表「立刻重抓」與「略過殘缺檔檢查」：幼兒園與托嬰（--babycare-file）的檔案一樣會檢查
    （上次營業中至少 20 所，新檔營業中少於上次的 80% 就不換版，原因寫進 last_error 並印出，exit 1），
    確定要換就加 --force。"""
    usage = (
        "用法：python -m app.cli geo-sync [--force（立刻重抓，也略過幼兒園與托嬰的殘缺檔檢查）] "
        "[--doorplates-file <CSV>] [--doorplates-version 115-10] "
        "[--kindergartens-file <JSON> --kindergartens-registry-file <CSV>] "
        "[--babycare-file <JSON>] [--population-file <JSON> ...] "
        "[--births-file <JSON> ...] [--migration-file <JSON> ...] [--income-file <CSV> [--income-year 112]] "
        "[--new-homes-file <CSV> ... [--new-homes-season 115S3]] "
        "[--presale-file <CSV>] [--presale-parcels-file <CSV>] "
        "[--kindergarten-penalties-file <CSV>] [--kindergarten-evaluations-file <CSV>] [--bundle <ZIP>]"
    )
    options: dict = {
        "force": False, "doorplates_file": None, "doorplates_version": None, "kindergartens_file": None,
        "kindergartens_registry_file": None,
        "babycare_file": None, "population_files": None, "births_files": None, "migration_files": None,
        "income_file": None, "income_year": None, "new_homes_files": None, "new_homes_season": None, "bundle": None,
        "presale_buildcases_file": None, "presale_parcels_file": None,
        "kindergarten_penalties_file": None, "kindergarten_evaluations_file": None,
    }
    valued = {"--doorplates-file": "doorplates_file", "--doorplates-version": "doorplates_version",
              "--kindergartens-file": "kindergartens_file",
              "--kindergartens-registry-file": "kindergartens_registry_file", "--babycare-file": "babycare_file",
              "--income-file": "income_file", "--income-year": "income_year",
              "--new-homes-season": "new_homes_season", "--bundle": "bundle",
              "--presale-file": "presale_buildcases_file", "--presale-parcels-file": "presale_parcels_file",
              "--kindergarten-penalties-file": "kindergarten_penalties_file",
              "--kindergarten-evaluations-file": "kindergarten_evaluations_file"}
    texts = {"--doorplates-version", "--income-year", "--new-homes-season"}
    repeated = {"--population-file": "population_files", "--births-file": "births_files",
                "--migration-file": "migration_files", "--new-homes-file": "new_homes_files"}
    lists: dict[str, list[Path]] = {key: [] for key in repeated.values()}
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--force":
            options["force"] = True
            index += 1
        elif arg in repeated and index + 1 < len(args) and not args[index + 1].startswith("--"):
            lists[repeated[arg]].append(Path(args[index + 1]))
            index += 2
        elif arg in valued and index + 1 < len(args) and not args[index + 1].startswith("--"):
            value = args[index + 1]
            options[valued[arg]] = value if arg in texts else Path(value)
            index += 2
        else:
            raise SystemExit(usage)
    singles = (
        options["doorplates_file"], options["kindergartens_file"], options["kindergartens_registry_file"],
        options["babycare_file"], options["income_file"], options["bundle"],
        options["presale_buildcases_file"], options["presale_parcels_file"],
        options["kindergarten_penalties_file"], options["kindergarten_evaluations_file"],
    )
    for path in (*singles, *(p for files in lists.values() for p in files)):
        if path is not None and not path.is_file():
            raise SystemExit(f"找不到檔案：{path}")
    if (options["kindergartens_file"] is None) != (options["kindergartens_registry_file"] is None):
        raise SystemExit("--kindergartens-file 與 --kindergartens-registry-file 要一起給（營業中以教育部名單為準）")
    if options["doorplates_version"] is not None and options["doorplates_file"] is None:
        raise SystemExit(usage)
    if options["income_year"] is not None:
        if options["income_file"] is None:
            raise SystemExit(usage)
        from app.admissions.geo.income import IncomeFormatError, parse_year

        try:
            options["income_year"] = parse_year(options["income_year"])
        except IncomeFormatError as exc:
            raise SystemExit(str(exc)) from exc
    if options["new_homes_season"] is not None:
        if len(lists["new_homes_files"]) != 1:
            raise SystemExit("--new-homes-season 只能配一個 --new-homes-file")
        from app.admissions.geo.new_homes import NewHomesFormatError, parse_season

        try:
            options["new_homes_season"] = parse_season(options["new_homes_season"])
        except NewHomesFormatError as exc:
            raise SystemExit(str(exc)) from exc
    for key, files in lists.items():
        if files:
            options[key] = files
    return options


async def geo_sync_command(**options) -> None:
    """招生區域分析的公開地理資料同步（app/admissions/geo/sync.py）。不看
    WEBSITE_GEO_AUTO_SYNC：那個開關只管 API 內的背景迴圈。另一個同步（背景迴圈或別的
    CLI）正在進行時什麼都不做，exit 1。--bundle 先驗證整包（sha256 等），不對就什麼都不匯入、exit 1。"""
    import tempfile

    from app.admissions.geo.bundle import SINGLE_KINDS, BundleError, open_bundle
    from app.admissions.geo.models import GeoDatasetStatus
    from app.admissions.geo.sync import GeoSyncBusy, run_geo_sync

    bundle = options.pop("bundle", None)
    settings = get_settings()
    session_factory = await _session_factory()
    with tempfile.TemporaryDirectory(prefix="geo-bundle-") as workdir:
        if bundle is not None:
            try:
                unpacked = open_bundle(bundle, Path(workdir))
            except BundleError as exc:
                print(f"打包檔不匯入：{exc}", file=sys.stderr)
                raise SystemExit(1)
            for kind, files in unpacked.items():
                if kind in SINGLE_KINDS:
                    # 這幾種在打包檔裡只有一個檔（bundle.py 驗證過）；所得的年度取檔名「112_165-E.csv」，預售建案的版本取檔名。
                    options[f"{kind}_file"] = files[0]
                    continue
                key = f"{kind}_files"
                options[key] = [*(options.get(key) or []), *files]
        try:
            result = await run_geo_sync(session_factory, settings, **options)
        except GeoSyncBusy:
            print("另一個公開資料同步正在進行，稍後再試", file=sys.stderr)
            raise SystemExit(1)
    print(
        f"門牌：{result.doorplates}（使用中 {result.doorplate_version or '尚未匯入'}）；"
        f"幼兒園：{result.kindergartens}；"
        f"幼兒園收費：{result.kindergarten_fees}（{result.kindergarten_fees_version + ' 學年' if result.kindergarten_fees_version else '尚未匯入'}，這次 {result.kindergarten_fee_schools} 所）；"
        f"托嬰：{result.babycare}；"
        f"各里人口：{result.population}（使用中 {result.population_version or '尚未匯入'}）；"
        f"重算訪視 {result.rematched} 筆"
    )
    print(
        f"各里出生：{result.births}（最新 {result.births_version or '尚未匯入'}，這次寫入 {result.births_months} 個月）；"
        f"各里遷入遷出：{result.migration}（最新 {result.migration_version or '尚未匯入'}，這次寫入 {result.migration_months} 個月）；"
        f"一年前的年齡：{result.age_history}；"
        f"各里所得：{result.income}（使用中 {result.income_version + ' 年度' if result.income_version else '尚未匯入'}）"
    )
    print(
        f"新成屋：{result.new_homes}（最新 {result.new_homes_version or '尚未匯入'}，這次寫入 {result.new_homes_seasons} 季，"
        f"重比 {result.new_homes_rematched} 筆）"
    )
    print(
        f"預售建案：{result.presale_buildcases}（使用中 {result.presale_buildcases_version or '尚未匯入'}，這次寫入 {result.presale_cases} 案，"
        f"重比改變 {result.presale_rematched} 案）；"
        f"地號座標：{result.presale_parcels}（匯入 {result.presale_parcel_rows} 列）"
    )
    print(
        f"幼兒園裁罰：{result.kindergarten_penalties}（{result.kindergarten_penalties_version or '尚未匯入'}，這次寫入 {result.kindergarten_penalty_rows} 筆）；"
        f"幼兒園評鑑：{result.kindergarten_evaluations}（{result.kindergarten_evaluations_version or '尚未匯入'}，這次寫入 {result.kindergarten_evaluation_rows} 筆）"
    )
    if (
        result.doorplate_rows_skipped or result.kindergarten_rows_skipped or result.babycare_rows_skipped
        or result.population_rows_skipped or result.income_rows_skipped
    ):
        print(
            f"略過：門牌 {result.doorplate_rows_skipped} 列、幼兒園 {result.kindergarten_rows_skipped} 筆、"
            f"托嬰 {result.babycare_rows_skipped} 筆、各里人口 {result.population_rows_skipped} 列、"
            f"各里所得 {result.income_rows_skipped} 列（對不到里界）"
        )
    failed = [
        (dataset, label)
        for dataset, label, outcome in (
            ("doorplates", "門牌", result.doorplates),
            ("kindergartens", "幼兒園", result.kindergartens),
            ("kindergarten_fees", "幼兒園收費", result.kindergarten_fees),
            ("babycare", "托嬰", result.babycare),
            ("population", "各里人口", result.population),
            ("births", "各里出生", result.births),
            ("migration", "各里遷入遷出", result.migration),
            ("population", "一年前的年齡", result.age_history),
            ("income", "各里所得", result.income),
            ("new_homes", "新成屋", result.new_homes),
            ("presale_buildcases", "預售建案", result.presale_buildcases),
            ("presale_buildcases", "地號座標", result.presale_parcels),
            ("kindergarten_penalties", "幼兒園裁罰", result.kindergarten_penalties),
            ("kindergarten_evaluations", "幼兒園評鑑", result.kindergarten_evaluations),
        )
        if outcome == "failed"
    ]
    if failed:
        # last_error 是 sync.py 自己寫的固定訊息（原因或例外類別），不含地址。
        async with session_factory() as db:
            for dataset, label in failed:
                status = await db.get(GeoDatasetStatus, dataset)
                if status is not None and status.last_error:
                    print(f"{label}同步失敗：{status.last_error}", file=sys.stderr)
        raise SystemExit(1)


def enrolled_match_options(args: list[str]) -> dict:
    """`enrolled-match` 的參數（2026-10-15 在籍學生規格 §3.5）：在本機比對清冊，輸出去識別 JSON。"""
    from datetime import date as date_type

    from app.campuses.models import CAMPUS_KEYS

    usage = (
        "用法：python -m app.cli enrolled-match --roster <清冊 xls> --campus <校區> --out <JSON> "
        "[--roster-date YYYY-MM-DD] [--allow-low-hit]"
    )
    values: dict[str, str] = {}
    allow_low_hit = False
    flags = {"--roster": "roster", "--campus": "campus", "--out": "out", "--roster-date": "roster_date"}
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--allow-low-hit":
            allow_low_hit = True
            index += 1
        elif arg in flags and index + 1 < len(args) and not args[index + 1].startswith("--"):
            values[flags[arg]] = args[index + 1]
            index += 2
        else:
            raise SystemExit(usage)
    if not {"roster", "campus", "out"} <= values.keys():
        raise SystemExit(usage)
    roster = Path(values["roster"])
    if not roster.is_file():
        raise SystemExit(f"找不到清冊檔：{roster}")
    if values["campus"] not in CAMPUS_KEYS:
        raise SystemExit(f"沒有這個校區：{values['campus']}")
    roster_date = None
    if "roster_date" in values:
        try:
            roster_date = date_type.fromisoformat(values["roster_date"])
        except ValueError:
            raise SystemExit("--roster-date 要寫 YYYY-MM-DD") from None
    return {
        "roster": roster, "campus_key": values["campus"], "out": Path(values["out"]),
        "roster_date": roster_date, "allow_low_hit": allow_low_hit,
    }


async def enrolled_match_command(*, roster: Path, campus_key: str, out: Path, roster_date, allow_low_hit: bool) -> None:
    from app.admissions.enrolled.match import MIN_PLACED_RATIO, MatchError, match_roster
    from app.admissions.enrolled.roster import RosterError, parse_roster

    try:
        parsed = parse_roster(roster.read_text(encoding="utf-8"))
    except (RosterError, UnicodeDecodeError) as error:
        print(f"清冊讀取失敗：{error}", file=sys.stderr)
        raise SystemExit(1) from None
    day = roster_date or parsed.printed_on
    if day is None:
        print("清冊沒有列印日期，請用 --roster-date 指定", file=sys.stderr)
        raise SystemExit(1)
    factory = await _session_factory()
    async with factory() as db:
        try:
            outcome = await match_roster(db, parsed, campus_key=campus_key, roster_date=day)
        except MatchError as error:
            print(f"比對失敗：{error}", file=sys.stderr)
            raise SystemExit(1) from None
    for line in outcome.report:
        print(line)
    if outcome.placed_ratio < MIN_PLACED_RATIO and not allow_low_hit:
        print(f"有點比例 {outcome.placed_ratio:.1%} 不到 90%，沒有寫出檔案；確認後可加 --allow-low-hit", file=sys.stderr)
        raise SystemExit(2)
    out.write_text(json.dumps(outcome.payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"已寫出 {out}")


def enrolled_import_options(args: list[str]) -> dict:
    """`enrolled-import` 的參數（2026-10-15 在籍學生規格 §3.5）。"""
    from app.campuses.models import CAMPUS_KEYS

    usage = "用法：python -m app.cli enrolled-import --file <JSON>｜enrolled-import --clear --campus <校區>"
    if len(args) == 2 and args[0] == "--file":
        path = Path(args[1])
        if not path.is_file():
            raise SystemExit(f"找不到檔案：{path}")
        return {"file": path, "clear": None}
    if len(args) == 3 and args[0] == "--clear" and args[1] == "--campus":
        if args[2] not in CAMPUS_KEYS:
            raise SystemExit(f"沒有這個校區：{args[2]}")
        return {"file": None, "clear": args[2]}
    raise SystemExit(usage)


async def enrolled_import_command(*, file: Path | None, clear: str | None) -> None:
    from pydantic import ValidationError

    from app.admissions.enrolled.importer import clear_roster, describe_error, load_payload, replace_roster
    from app.admissions.geo import matcher

    factory = await _session_factory()
    if clear is not None:
        async with factory() as db:
            removed = await clear_roster(db, clear)
            await db.commit()
        print(f"已刪除 {clear} 的在籍學生資料" if removed else f"{clear} 本來就沒有在籍學生資料")
        return
    assert file is not None
    try:
        payload = load_payload(file.read_text(encoding="utf-8"))
    except ValidationError as error:
        print(f"檔案格式不對，沒有匯入：{describe_error(error)}", file=sys.stderr)
        raise SystemExit(1) from None
    except UnicodeDecodeError:
        print("檔案不是 UTF-8，沒有匯入", file=sys.stderr)
        raise SystemExit(1) from None
    async with factory() as db:
        total, placed = await replace_roster(db, payload)
        await db.commit()
        active = await matcher.doorplate_label(db)
    print(f"匯入 {payload.campus_key}：{total} 位（有點 {placed} 位），清冊日期 {payload.roster_date.isoformat()}")
    if active is not None and active != payload.doorplate_version:
        # 只提醒、不阻止：點的位置是比對時定下的，換版只會讓里名和現行門牌不一致。
        print(
            f"注意：比對用的門牌版本（{payload.doorplate_version}）和正式站使用中的版本（{active}）不同，"
            "點的位置以比對時為準，里名可能和現行門牌不一致。"
        )


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "用法：python -m app.cli <seed|seed --dry-run|bootstrap-admin|"
            "content-seed-from-fixture <fixture> [--dry-run] [--force]|"
            "initialize-content <fixture> [--dry-run]|process-notifications|"
            "requeue-notifications [--campus <key>] [--dry-run]|media-copy-to-s3 [--dry-run]|"
            "import-site-assets [--web-root <web 目錄>] [--apply] [--write-drafts]|"
            "regenerate-media-variants [--apply] [--all]|strip-media-metadata [--apply]|transcode-media-videos [--apply]|"
            "geo-sync [--force] [--doorplates-file <CSV>] [--doorplates-version 115-10] "
            "[--kindergartens-file <JSON> --kindergartens-registry-file <CSV>] "
            "[--babycare-file <JSON>] [--population-file <JSON> ...] [--births-file <JSON> ...] [--migration-file <JSON> ...] "
            "[--income-file <CSV> [--income-year 112]] [--new-homes-file <CSV> ... [--new-homes-season 115S3]] "
            "[--presale-file <CSV>] [--presale-parcels-file <CSV>] "
            "[--kindergarten-penalties-file <CSV>] [--kindergarten-evaluations-file <CSV>] [--bundle <ZIP>]|"
            "enrolled-match --roster <xls> --campus <key> --out <JSON> [--roster-date YYYY-MM-DD] [--allow-low-hit]|"
            "enrolled-import --file <JSON>|enrolled-import --clear --campus <key>>",
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
    elif command == "import-site-assets":
        from app.media.site_import import DEFAULT_WEB_ROOT

        args = sys.argv[2:]
        web_root = DEFAULT_WEB_ROOT
        if "--web-root" in args:
            index = args.index("--web-root")
            if index + 1 >= len(args):
                raise SystemExit("用法：python -m app.cli import-site-assets [--web-root <web 目錄>] [--apply] [--write-drafts]")
            web_root = Path(args[index + 1])
            args = args[:index] + args[index + 2:]
        unknown = set(args) - {"--apply", "--write-drafts", "--dry-run"}
        if unknown or ("--apply" in args and "--dry-run" in args):
            raise SystemExit("用法：python -m app.cli import-site-assets [--web-root <web 目錄>] [--apply] [--write-drafts]")
        asyncio.run(import_site_assets(web_root, apply="--apply" in args, write_drafts="--write-drafts" in args))
    elif command == "regenerate-media-variants":
        args = set(sys.argv[2:])
        if args - {"--apply", "--all", "--dry-run"} or {"--apply", "--dry-run"} <= args:
            raise SystemExit("用法：python -m app.cli regenerate-media-variants [--apply] [--all]")
        asyncio.run(regenerate_media_variants(apply="--apply" in args, include_all="--all" in args))
    elif command == "strip-media-metadata":
        args = set(sys.argv[2:])
        if args - {"--apply", "--dry-run"} or {"--apply", "--dry-run"} <= args:
            raise SystemExit("用法：python -m app.cli strip-media-metadata [--apply]")
        asyncio.run(strip_media_metadata(apply="--apply" in args))
    elif command == "transcode-media-videos":
        args = set(sys.argv[2:])
        if args - {"--apply", "--dry-run"} or {"--apply", "--dry-run"} <= args:
            raise SystemExit("用法：python -m app.cli transcode-media-videos [--apply]")
        asyncio.run(transcode_media_videos(apply="--apply" in args))
    elif command == "geo-sync":
        asyncio.run(geo_sync_command(**geo_sync_options(sys.argv[2:])))
    elif command == "enrolled-match":
        asyncio.run(enrolled_match_command(**enrolled_match_options(sys.argv[2:])))
    elif command == "enrolled-import":
        asyncio.run(enrolled_import_command(**enrolled_import_options(sys.argv[2:])))
    else:
        print(f"未知指令：{command}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
