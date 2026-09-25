"""Import the existing website copy into empty CMS entries without replacing edits."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field as dataclass_field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content import service
from app.content.models import ContentItem, ReleaseSource
from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.schemas import FORMAL_CONSENT_TEXT, LEGACY_DEMO_CONSENT_TEXT


def _copy_fields(source: dict, kind: str) -> dict:
    payload = {}
    for field, info in CONTENT_KIND_REGISTRY[kind].payload_model.model_fields.items():
        parts = field.split("_")
        source_key = parts[0] + "".join(part.title() for part in parts[1:])
        # 之後才加、有預設值的欄位（例如預約文案的隱私說明）原型沒有，用預設值。
        if source_key not in source and not info.is_required():
            continue
        payload[field] = source[source_key]
    return payload


def _booking_payload(source: dict) -> dict:
    """原型的同意文字是示範用的（「資料不會傳送給學校」），正式官網不能
    發布；匯入時換成官網實際顯示的正式文字。隱私說明本文由園方提供，
    匯入時留空（官網不顯示入口）。"""
    payload = _copy_fields(source, "booking_content")
    if payload["consent_text"] == LEGACY_DEMO_CONSENT_TEXT:
        payload["consent_text"] = FORMAL_CONSENT_TEXT
    return payload


def initial_payloads(data: dict) -> list[tuple[str, str | None, dict]]:
    entries = [
        ("home_about", None, _copy_fields(data["home"]["about"], "home_about")),
        ("home_hero", None, _copy_fields(data["home"]["hero"], "home_hero")),
        ("site_footer", None, _copy_fields(data["footer"], "site_footer")),
        ("home_campus_board", None, _copy_fields(data["home"]["campusBoard"], "home_campus_board")),
        ("booking_content", None, _booking_payload(data["booking"])),
        ("day_experience", None, _copy_fields(data["dayExperience"], "day_experience")),
        # 原樣帶入原型的示意消息與 sampleNote：上線畫面不變（仍標「示意內容」），
        # 園方在後台換成真實消息、清空示意說明後才拿掉標示。
        ("home_news", None, _copy_fields(data["news"], "home_news")),
        # 入學資訊頁：舊官網「常春藤入學」四個分頁移植來的內容（2026-09-24）。
        ("admission_content", None, _copy_fields(data["admission"], "admission_content")),
    ]
    meta = data["siteMeta"]
    entries.append(("site_meta", None, {
        "title": meta["title"], "description": meta["description"],
        "header_phone_number": meta["headerPhone"]["number"],
        "header_phone_note": meta["headerPhone"]["note"],
    }))
    for campus in data["campuses"]:
        profile = _copy_fields(campus, "campus_profile")
        profile["line"] = profile["line"] or ""
        entries.append(("campus_profile", campus["key"], profile))
        entries.append(("campus_faq", campus["key"], {"items": campus["faq"]["items"]}))
        # Generated templates remain marked as pending on the public website.
        if isinstance(campus["tourScenes"], list):
            entries.append(("campus_tour", campus["key"], {"scenes": campus["tourScenes"]}))
    # Validate everything before writing any entries; drop source-only fields.
    return [
        (kind, campus, CONTENT_KIND_REGISTRY[kind].payload_model.model_validate(payload).model_dump())
        for kind, campus, payload in entries
    ]


async def _existing_item(db: AsyncSession, kind: str, campus_key: str | None) -> ContentItem | None:
    """只查不建：dry-run 不能在資料庫留下空白的內容項。"""
    result = await db.execute(
        select(ContentItem).where(ContentItem.kind == kind, ContentItem.campus_key == campus_key)
    )
    return result.scalar_one_or_none()


async def pending_initialization(db: AsyncSession, data: dict) -> list[tuple[str, str | None]]:
    """initialize-content 會補建的內容項（還沒有任何版本的）；不寫入。"""
    pending = []
    for kind, campus, _payload in initial_payloads(data):
        item = await _existing_item(db, kind, campus)
        if item is None or item.latest_version == 0:
            pending.append((kind, campus))
    return pending


async def initialize_content(
    db: AsyncSession, data: dict, created_by: uuid.UUID | None = None
) -> int:
    created = 0
    for kind, campus, payload in initial_payloads(data):
        item = await service.get_or_create_content_item(db, kind, campus)
        if item.latest_version != 0:
            continue
        revision = await service.create_revision(db, item, payload, 0, created_by)
        await service.publish_revision(db, item, revision, created_by, source=ReleaseSource.INITIALIZE)
        created += 1
    return created


# content-seed-from-fixture 只處理這三項（階段 B 最早搬進後台的首頁文字與頁尾）。
SEED_KINDS = ("home_about", "home_hero", "site_footer")


@dataclass
class SeedPlan:
    # 要寫入並發布的內容項。
    kinds: list[str]
    # 已經有版本（後台編輯過或初始化過）的內容項；沒有 --force 就整批不寫。
    existing: list[str] = dataclass_field(default_factory=list)


class SeedRefused(Exception):
    def __init__(self, existing: list[str]) -> None:
        self.existing = existing
        super().__init__(", ".join(existing))


async def seed_from_fixture(
    db: AsyncSession,
    data: dict,
    created_by: uuid.UUID | None,
    *,
    force: bool = False,
    dry_run: bool = False,
) -> SeedPlan:
    """把 fixture 的首頁「關於」、首頁大圖標語、頁尾文字寫進後台並發布。

    payload 與 initialize-content 同一個來源，寫入前全部用欄位規則驗過（頁尾
    四個欄位都帶）。這三項任何一項已經有版本，就代表後台可能改過，預設整批
    拒絕（規格 L367：重跑不得覆寫後台已編輯的內容）；確定要用 fixture 蓋回去
    才加 force，舊版本仍留在版本紀錄裡。dry_run 只回傳計畫、不寫入。"""
    payloads = {kind: payload for kind, campus, payload in initial_payloads(data) if kind in SEED_KINDS and campus is None}
    existing = []
    for kind in SEED_KINDS:
        item = await _existing_item(db, kind, None)
        if item is not None and item.latest_version > 0:
            existing.append(kind)
    plan = SeedPlan(kinds=list(SEED_KINDS), existing=existing)
    if existing and not force:
        raise SeedRefused(existing)
    if dry_run:
        return plan
    for kind in SEED_KINDS:
        item = await service.get_or_create_content_item(db, kind, None)
        revision = await service.create_revision(db, item, payloads[kind], item.latest_version, created_by)
        await service.publish_revision(db, item, revision, created_by, source=ReleaseSource.INITIALIZE)
    return plan
