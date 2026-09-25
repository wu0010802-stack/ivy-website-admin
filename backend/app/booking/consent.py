"""預約表單的同意說明版本（規格 L130、L196）。

同意說明放在共用內容「預約文案」（booking_content）：勾選框文字
consent_text 與可開啟的隱私說明 privacy_title／privacy_sections。家長送單時
帶上當時看到的 revision id，伺服器確認是目前已發布的版本才收，並把 id 與
接受時間存進案件；事後可以查出家長同意的是哪一版文字。

「目前已發布」看 ContentItem.current_published_revision_id：它跟站台 release
由 content.service.publish_revision 在同一個交易裡一起切換。
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.models import ContentItem, ContentRevision, SiteReleaseEntry

BOOKING_CONTENT_KIND = "booking_content"

# 同意紀錄比對的欄位：這幾個一樣，家長看到的同意說明就一樣。只改預約按鈕或
# 橫幅文字而重新發布時，正在填表的家長不必重新勾選。
CONSENT_FIELDS = ("consent_text", "privacy_title", "privacy_sections")


class ConsentUnavailable(Exception):
    """還沒有已發布的同意文字：表單不能收件（啟用 inquiry／slots 時也會擋）。"""


class ConsentVersionChanged(Exception):
    """家長送出的同意說明版本不是目前發布的內容（或沒帶版本）。"""


@dataclass(frozen=True)
class PublishedConsent:
    revision_id: uuid.UUID
    version: int
    text: str
    privacy_title: str
    privacy_sections: list[dict]

    @property
    def has_privacy_notice(self) -> bool:
        return bool(self.privacy_sections)


def _consent_view(payload: dict) -> tuple:
    return tuple(_normalized(payload.get(field)) for field in CONSENT_FIELDS)


def _normalized(value):
    # 舊版本沒有隱私說明欄位；缺欄位與空值視為相同。
    if value in (None, "", []):
        return None
    if isinstance(value, list):
        return tuple(
            (str(item.get("heading", "")), str(item.get("body", ""))) for item in value
        )
    return value


async def _booking_item(db: AsyncSession) -> ContentItem | None:
    result = await db.execute(
        select(ContentItem).where(
            ContentItem.kind == BOOKING_CONTENT_KIND, ContentItem.campus_key.is_(None)
        )
    )
    return result.scalar_one_or_none()


async def current_consent(db: AsyncSession) -> PublishedConsent | None:
    """目前發布中的同意說明；沒有發布過或同意文字是空白時回 None。"""
    item = await _booking_item(db)
    if item is None or item.current_published_revision_id is None:
        return None
    revision = await db.get(ContentRevision, item.current_published_revision_id)
    if revision is None:
        return None
    text = str(revision.payload.get("consent_text") or "").strip()
    if not text:
        return None
    return PublishedConsent(
        revision_id=revision.id,
        version=revision.version,
        text=revision.payload["consent_text"],
        privacy_title=str(revision.payload.get("privacy_title") or ""),
        privacy_sections=[
            {"heading": str(s.get("heading", "")), "body": str(s.get("body", ""))}
            for s in revision.payload.get("privacy_sections") or []
        ],
    )


async def accept_submitted(db: AsyncSession, submitted: uuid.UUID | None) -> uuid.UUID:
    """驗證家長送出的同意說明版本，回傳要存進案件的 revision id。

    - 等於目前發布版本：收。
    - 是同一內容項、曾經發布過、同意相關欄位跟目前發布版本完全相同的舊版本：
      也收，存家長實際看到的那一版（只改了按鈕文字之類的重新發布）。
    - 其他（沒帶、草稿、文字已改）：ConsentVersionChanged，前端重新載入後
      讓家長重新閱讀、勾選。
    """
    current = await current_consent(db)
    if current is None:
        raise ConsentUnavailable()
    if submitted is None:
        raise ConsentVersionChanged()
    if submitted == current.revision_id:
        return submitted
    revision = await db.get(ContentRevision, submitted)
    if revision is None:
        raise ConsentVersionChanged()
    item = await _booking_item(db)
    if item is None or revision.content_item_id != item.id:
        raise ConsentVersionChanged()
    was_published = await db.scalar(
        select(SiteReleaseEntry.revision_id).where(SiteReleaseEntry.revision_id == submitted).limit(1)
    )
    if was_published is None:
        raise ConsentVersionChanged()
    current_revision = await db.get(ContentRevision, current.revision_id)
    if current_revision is None or _consent_view(revision.payload) != _consent_view(current_revision.payload):
        raise ConsentVersionChanged()
    return submitted


async def revision_version(db: AsyncSession, revision_id: uuid.UUID | None) -> int | None:
    """後台明細顯示「同意說明第 N 版」用。"""
    if revision_id is None:
        return None
    revision = await db.get(ContentRevision, revision_id)
    return revision.version if revision is not None else None
