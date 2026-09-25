"""內容審核與排程發布的個人站內通知（規格 L151-156）。

送審通知能核准這項內容的人，核准或退回通知送審的人，排程沒有執行通知排程
的人。收件人都是「現在」還有權限的帳號：送審當下就查，不事先寫死名單。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.auth.permissions import can_publish_shared_content, covers_campus, has_capability, roles_with
from app.content.models import ContentItem
from app.notifications.models import UserNotification

REVIEW_SUBMITTED = "content_review_submitted"
REVIEW_APPROVED = "content_review_approved"
REVIEW_REJECTED = "content_review_rejected"
SCHEDULE_FAILED = "content_schedule_failed"
SCHEDULE_SKIPPED = "content_schedule_skipped"

KINDS = (REVIEW_SUBMITTED, REVIEW_APPROVED, REVIEW_REJECTED, SCHEDULE_FAILED, SCHEDULE_SKIPPED)


def user_can_publish(user: User | None, item: ContentItem) -> bool:
    if user is None or not user.is_active:
        return False
    if item.campus_key is None:
        return can_publish_shared_content(user)
    if not has_capability(user, "content.publish"):
        return False
    return covers_campus(user, item.campus_key)


async def reviewers_for(db: AsyncSession, item: ContentItem) -> list[User]:
    """現在能核准這項內容的人（和 /admin/content-reviews 同一個定義）。"""
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.is_active.is_(True), User.role.in_(roles_with("content.publish")))
        .order_by(User.email)
    )
    return [user for user in result.scalars() if user_can_publish(user, item)]


async def notify(
    db: AsyncSession,
    recipient_ids: list[uuid.UUID | None],
    kind: str,
    item: ContentItem,
    *,
    exclude: uuid.UUID | None = None,
    **details,
) -> int:
    """寫給每位收件人一則通知（自己做的動作不通知自己），回傳寫了幾則。
    details 是摘要（版本、原因、排程時間），不含內容本身。"""
    now = datetime.now(timezone.utc)
    payload = {"content_kind": item.kind, **{k: v for k, v in details.items() if v is not None}}
    written = 0
    for user_id in dict.fromkeys(recipient_ids):
        if user_id is None or user_id == exclude:
            continue
        db.add(
            UserNotification(
                id=uuid.uuid4(),
                recipient_user_id=user_id,
                kind=kind,
                content_item_id=item.id,
                campus_key=item.campus_key,
                payload=payload,
                created_at=now,
            )
        )
        written += 1
    await db.flush()
    return written
