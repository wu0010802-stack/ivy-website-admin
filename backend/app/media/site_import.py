"""把官網目前內建的照片與影片匯入素材庫（計畫 L243、規格 L144）。

`python -m app.cli import-site-assets` 呼叫這裡：預設只列出會匯入什麼；
`--apply` 才真的上傳，`--write-drafts` 另外把對應的內容版位寫成草稿（不發布，
園方在後台確認後自己發布）。以檔案的 SHA-256 去重，可以重跑：同一校區（或
共用）已經有內容相同的素材就沿用，不再上傳一次。

來源是 web/ 的現況：`server/data/site-fixture.json`（哪一校用哪張照片、替代
文字、焦點）、`public/assets/` 的原始檔，以及 `app/generated/video-manifest.json`
（官網實際播放的是壓縮過的影片，不是 assets 根目錄的母帶）。

注意（規格 L144）：這些檔案本來就公開在官網的 /assets 底下，匯入素材庫不會讓
它們變回私密。
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content import service as content_service
from app.content.models import ContentItem, ContentRevision
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media import service as media_service
from app.media.models import MediaKind
from app.media.storage import MediaStorage
from app.media.validation import MediaValidationError
from app.operations import audit_service

DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[3] / "web"


@dataclass(frozen=True)
class DraftTarget:
    """匯入後要寫進哪個內容項的哪個版位。`path` 是版位欄位（例如 `poster`、
    `moments[2].photo`）；`extra` 是同時要補的欄位（例如封面在各版位的焦點，
    讓發布後裁切跟現在一樣）。"""

    kind: str
    campus_key: str | None
    path: str
    extra: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ImportEntry:
    key: str
    label: str
    path: Path
    kind: MediaKind
    campus_key: str | None
    alt_text: str | None = None
    target: DraftTarget | None = None


@dataclass
class ImportResult:
    entry: ImportEntry
    status: str  # "import"｜"exists"｜"missing"｜"too_large"｜"imported"｜"failed"
    media_id: uuid.UUID | None = None
    message: str = ""


@dataclass
class DraftResult:
    kind: str
    campus_key: str | None
    written: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    note: str = ""


_POSITION_WORDS = {"left": 0.0, "center": 50.0, "right": 100.0, "top": 0.0, "bottom": 100.0}


def css_position_to_focus(value: str | None) -> dict | None:
    """fixture 的 CSS object-position（"85% center"、"center 12%"、"85% 8%"）換成
    0–100 的 {x, y}；看不懂或沒有值回 None。只給匯入用：規格 L108 不讓新 API
    存 CSS 字串。"""
    if not value:
        return None
    parts = value.split()
    if len(parts) == 1:
        parts.append("center")
    if len(parts) != 2:
        return None
    out: list[float] = []
    for part in parts:
        if part in _POSITION_WORDS:
            out.append(_POSITION_WORDS[part])
            continue
        match = re.fullmatch(r"(\d+(?:\.\d+)?)%", part)
        if not match:
            return None
        out.append(min(100.0, float(match.group(1))))
    return {"x": out[0], "y": out[1]}


def _asset(web_root: Path, name: str) -> Path:
    return web_root / "public" / "assets" / f"{name}.webp"


def _manifest_video(web_root: Path, manifest: dict, key: str, fallback: str) -> Path:
    src = manifest.get(key)
    if isinstance(src, str) and src.startswith("/"):
        return web_root / "public" / src.lstrip("/")
    return web_root / "public" / fallback


def plan_site_assets(web_root: Path = DEFAULT_WEB_ROOT) -> list[ImportEntry]:
    """官網目前用到、而且在後台有版位（或值得先進素材庫，例如 Logo）的檔案。"""
    fixture = json.loads((web_root / "server" / "data" / "site-fixture.json").read_text(encoding="utf-8"))
    manifest_path = web_root / "app" / "generated" / "video-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    hero = fixture["home"]["hero"]
    about = fixture["home"]["about"]
    day = fixture["dayExperience"]
    entries: list[ImportEntry] = [
        # Logo 依 2026-09-19 核可鎖定、後台沒有版位；先收進素材庫方便追蹤與替換。
        ImportEntry("logo", "機構 Logo", web_root / "public" / fixture["siteMeta"]["logo"], MediaKind.IMAGE, None, "常春藤教育機構 Logo"),
        ImportEntry(
            "hero-video-desktop", "首屏影片（桌機）",
            _manifest_video(web_root, manifest, "hero-desktop", hero["heroVideoSrc"]), MediaKind.VIDEO, None,
            hero["heroImageAlt"], DraftTarget("home_hero", None, "video_desktop"),
        ),
        ImportEntry(
            "hero-video-mobile", "首屏影片（手機）",
            _manifest_video(web_root, manifest, "hero-mobile", hero["heroVideoSrc"]), MediaKind.VIDEO, None,
            hero["heroImageAlt"], DraftTarget("home_hero", None, "video_mobile"),
        ),
        ImportEntry(
            "hero-poster", "首屏影片 poster", _asset(web_root, hero["heroImage"]), MediaKind.IMAGE, None,
            hero["heroImageAlt"], DraftTarget("home_hero", None, "poster"),
        ),
    ]
    if about.get("photos"):
        photo = about["photos"][0]
        entries.append(ImportEntry(
            "about-photo", "關於常春藤照片", _asset(web_root, photo["image"]), MediaKind.IMAGE, None,
            photo.get("alt"), DraftTarget("home_about", None, "photo"),
        ))
    entries += [
        ImportEntry(
            "day-film-desktop", "孩子的一天影片（桌機）",
            _manifest_video(web_root, manifest, "day-desktop", day["filmSrc"]), MediaKind.VIDEO, None,
            None, DraftTarget("day_experience", None, "film_desktop"),
        ),
        ImportEntry(
            "day-film-mobile", "孩子的一天影片（手機）",
            _manifest_video(web_root, manifest, "day-mobile", day["filmSrcMobile"]), MediaKind.VIDEO, None,
            None, DraftTarget("day_experience", None, "film_mobile"),
        ),
        ImportEntry(
            "day-poster", "孩子的一天影片 poster", _asset(web_root, day["filmPoster"]), MediaKind.IMAGE, None,
            None, DraftTarget("day_experience", None, "film_poster"),
        ),
    ]
    for i, moment in enumerate(day["moments"]):
        entries.append(ImportEntry(
            f"day-moment-{moment['key']}", f"孩子的一天：{moment['time']} {moment['label']}",
            _asset(web_root, moment["photo"]), MediaKind.IMAGE, None, moment.get("alt"),
            DraftTarget("day_experience", None, f"moments[{i}].photo", {"key": moment["key"]}),
        ))
    for campus in fixture["campuses"]:
        key = campus["key"]
        name = campus["name"]
        focus = {
            name: point
            for name, point in (
                ("card_focus", css_position_to_focus(campus.get("panoramaPos"))),
                ("hero_focus", css_position_to_focus(campus.get("heroPhotoPos"))),
            )
            if point is not None
        }
        entries += [
            ImportEntry(
                f"{key}-cover", f"{name}封面照片", _asset(web_root, campus["image"]), MediaKind.IMAGE, key,
                f"{name}校園外觀", DraftTarget("campus_profile", key, "cover", focus),
            ),
            ImportEntry(
                f"{key}-line-art", f"{name}建築線稿", _asset(web_root, f"campus-line-art-{key}"), MediaKind.IMAGE, key,
                f"{name}建築線稿", DraftTarget("campus_profile", key, "line_art"),
            ),
            ImportEntry(
                f"{key}-line-art-colour", f"{name}建築線稿（上色）",
                _asset(web_root, f"campus-line-art-{key}-colour"), MediaKind.IMAGE, key,
                f"{name}建築線稿（上色）", DraftTarget("campus_profile", key, "line_art_colour"),
            ),
        ]
    return entries


async def check_entries(
    db: AsyncSession, entries: list[ImportEntry], max_bytes: dict[str, int]
) -> list[ImportResult]:
    """dry-run 與正式執行共用的判斷：檔案在不在、會不會超過上限、素材庫是否已有。"""
    results: list[ImportResult] = []
    for entry in entries:
        if not entry.path.is_file():
            results.append(ImportResult(entry, "missing", message=f"找不到檔案 {entry.path}"))
            continue
        size = entry.path.stat().st_size
        if size > max_bytes[entry.kind.value]:
            results.append(ImportResult(entry, "too_large", message=f"{size // (1024 * 1024)} MB 超過上傳上限"))
            continue
        existing = await media_service.find_by_sha256(db, media_service.file_sha256(entry.path), entry.campus_key)
        if existing is not None:
            results.append(ImportResult(entry, "exists", media_id=existing.id))
        else:
            results.append(ImportResult(entry, "import"))
    return results


async def import_entry(
    db: AsyncSession, storage: MediaStorage, result: ImportResult, quota_bytes: int | None
) -> None:
    """上傳一個檔案（呼叫端負責 commit）。失敗記在 result，不丟例外。"""
    entry = result.entry
    # 同一次匯入裡可能有內容相同的檔案（例如桌機與手機用同一支影片）：前一個
    # 已經匯入就沿用。
    existing = await media_service.find_by_sha256(db, media_service.file_sha256(entry.path), entry.campus_key)
    if existing is not None:
        result.status, result.media_id = "exists", existing.id
        return
    try:
        asset = await media_service.create_media_asset(
            db,
            storage,
            source_path=entry.path,
            size_bytes=entry.path.stat().st_size,
            declared_kind=entry.kind,
            original_filename=entry.path.name,
            campus_key=entry.campus_key,
            created_by=None,  # type: ignore[arg-type] - 指令列匯入沒有登入者
            alt_text=entry.alt_text,
            source_attribution="官網內建素材匯入",
            quota_bytes=quota_bytes,
        )
    except media_service.MediaQuotaExceeded:
        result.status, result.message = "failed", "素材空間已滿"
        return
    except MediaValidationError as exc:
        result.status, result.message = "failed", exc.message
        return
    if asset.status.value != "ready":
        result.status, result.message = "failed", asset.processing_error or "處理失敗"
    else:
        result.status = "imported"
    result.media_id = asset.id
    asset.tags = ["官網內建"]


def _slot(media_id: uuid.UUID) -> dict:
    return {"media_id": str(media_id), "focus_x": None, "focus_y": None}


def _current(payload: dict, path: str) -> tuple[dict, str] | None:
    """`moments[2].photo` → (moments[2] 那個 dict, "photo")；對不上回 None。"""
    parent: object = payload
    *parents, name = path.split(".")
    for part in parents:
        match = re.fullmatch(r"(\w+)\[(\d+)\]", part)
        if match is None or not isinstance(parent, dict):
            return None
        items = parent.get(match.group(1))
        index = int(match.group(2))
        if not isinstance(items, list) or index >= len(items):
            return None
        parent = items[index]
    return (parent, name) if isinstance(parent, dict) else None


async def write_drafts(
    db: AsyncSession, results: list[ImportResult], *, apply: bool
) -> list[DraftResult]:
    """把匯入（或本來就有）的素材寫進對應內容項的最新一版，存成新草稿。已經
    設定過的版位不覆蓋；內容項還沒有任何版本（沒跑過 initialize-content）就
    略過。apply=False 只回報會寫哪些。"""
    grouped: dict[tuple[str, str | None], list[ImportResult]] = {}
    usable = ("exists", "imported") if apply else ("exists", "import")
    for result in results:
        target = result.entry.target
        if target is None or result.status not in usable:
            continue
        grouped.setdefault((target.kind, target.campus_key), []).append(result)

    out: list[DraftResult] = []
    for (kind, campus_key), items in grouped.items():
        report = DraftResult(kind, campus_key)
        out.append(report)
        item = (
            await db.execute(select(ContentItem).where(ContentItem.kind == kind, ContentItem.campus_key == campus_key))
        ).scalar_one_or_none()
        if item is None or item.latest_version == 0:
            report.note = "內容還沒初始化（先執行 initialize-content），略過"
            continue
        latest = (
            await db.execute(
                select(ContentRevision).where(
                    ContentRevision.content_item_id == item.id, ContentRevision.version == item.latest_version
                )
            )
        ).scalar_one()
        payload = json.loads(json.dumps(latest.payload))
        for result in items:
            target = result.entry.target
            assert target is not None
            found = _current(payload, target.path)
            if found is None:
                report.skipped.append(f"{target.path}（內容裡沒有這個位置）")
                continue
            parent, name = found
            expected_key = target.extra.get("key")
            if expected_key is not None and parent.get("key") != expected_key:
                report.skipped.append(f"{target.path}（卡片順序已經改過）")
                continue
            if parent.get(name):
                report.skipped.append(f"{target.path}（已經設定過）")
                continue
            # dry-run 時還沒上傳的檔案沒有 id，用暫時的值算出會寫哪些版位（不存檔）。
            parent[name] = _slot(result.media_id or uuid.uuid4())
            for extra_name, value in target.extra.items():
                if extra_name != "key" and not parent.get(extra_name):
                    parent[extra_name] = value
            report.written.append(target.path)
        if not report.written or not apply:
            continue
        config = CONTENT_KIND_REGISTRY[kind]
        dumped = config.payload_model.model_validate(payload).model_dump()
        revision = await content_service.create_revision(db, item, dumped, item.latest_version, None)  # type: ignore[arg-type]
        await media_service.sync_content_item_usages(
            db, str(item.id), kind, campus_key, revision.id, config.extract_media_refs(dumped)
        )
    return out


async def log_import(db: AsyncSession, results: list[ImportResult], drafts: list[DraftResult]) -> None:
    await audit_service.log_action(
        db,
        actor_user_id=None,
        action="media.import_site_assets",
        target_type="media_asset",
        target_id="site-assets",
        metadata={
            "imported": [r.entry.key for r in results if r.status == "imported"],
            "reused": [r.entry.key for r in results if r.status == "exists"],
            "failed": [r.entry.key for r in results if r.status in ("failed", "missing", "too_large")],
            "drafts": [
                {"kind": d.kind, "campus_key": d.campus_key, "fields": d.written} for d in drafts if d.written
            ],
        },
    )
