"""Import the existing website copy into empty CMS entries without replacing edits."""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.content import service
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


async def initialize_content(
    db: AsyncSession, data: dict, created_by: uuid.UUID | None = None
) -> int:
    created = 0
    for kind, campus, payload in initial_payloads(data):
        item = await service.get_or_create_content_item(db, kind, campus)
        if item.latest_version != 0:
            continue
        revision = await service.create_revision(db, item, payload, 0, created_by)
        await service.publish_revision(db, item, revision, created_by)
        created += 1
    return created
