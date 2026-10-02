"""預約文案裡的個資使用說明，與舊案的同意說明版本。

2026-10-02 業主裁定官網預約不用勾選同意：送單不再帶、也不再比對同意說明
版本，官網不顯示同意條款文字。共用內容「預約文案」（booking_content）的
隱私說明 privacy_title／privacy_sections 仍由官網表單與頁尾開啟；更新前
送出的案件記著家長當時同意的 revision id，後台明細照樣顯示是第幾版。

「目前已發布」看 ContentItem.current_published_revision_id：它跟站台 release
由 content.service.publish_revision 在同一個交易裡一起切換。
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.models import ContentItem, ContentRevision

BOOKING_CONTENT_KIND = "booking_content"


@dataclass(frozen=True)
class PrivacyNotice:
    title: str
    sections: list[dict]


async def _booking_item(db: AsyncSession) -> ContentItem | None:
    result = await db.execute(
        select(ContentItem).where(
            ContentItem.kind == BOOKING_CONTENT_KIND, ContentItem.campus_key.is_(None)
        )
    )
    return result.scalar_one_or_none()


async def published_privacy_notice(db: AsyncSession) -> PrivacyNotice | None:
    """目前發布中的預約文案的個資使用說明；沒有發布過或沒有段落時回 None。"""
    item = await _booking_item(db)
    if item is None or item.current_published_revision_id is None:
        return None
    revision = await db.get(ContentRevision, item.current_published_revision_id)
    if revision is None:
        return None
    sections = [
        {"heading": str(s.get("heading", "")), "body": str(s.get("body", ""))}
        for s in revision.payload.get("privacy_sections") or []
    ]
    if not sections:
        return None
    return PrivacyNotice(title=str(revision.payload.get("privacy_title") or ""), sections=sections)


async def revision_version(db: AsyncSession, revision_id: uuid.UUID | None) -> int | None:
    """後台明細顯示「同意說明第 N 版」用（2026-10-02 以前送出的案件）。"""
    if revision_id is None:
        return None
    revision = await db.get(ContentRevision, revision_id)
    return revision.version if revision is not None else None
