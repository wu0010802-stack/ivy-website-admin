from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.models import User
from app.operations.models import AuditLogEntry

# 這些欄位絕不能出現在 metadata_json 裡（就算呼叫端不小心傳進來也擋掉），
# 避免稽核紀錄變成另一份個資外洩管道。同事的 email 與顯示名稱也不寫：
# 操作紀錄讀取時再 join users 帶出（見 list_recent），改名後舊紀錄跟著更新。
_FORBIDDEN_METADATA_KEYS = {
    "phone", "parent_name", "password", "email", "questions",
    "child_name", "child_birthdate", "referral_sources", "display_name",
}


def _mask_metadata(metadata: dict) -> dict:
    return {k: v for k, v in metadata.items() if k not in _FORBIDDEN_METADATA_KEYS}


async def log_action(
    db: AsyncSession,
    *,
    actor_user_id: uuid.UUID | None,
    action: str,
    target_type: str,
    target_id: str,
    campus_key: str | None = None,
    metadata: dict | None = None,
) -> AuditLogEntry:
    entry = AuditLogEntry(
        id=uuid.uuid4(),
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        campus_key=campus_key,
        metadata_json=_mask_metadata(metadata or {}),
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    await db.flush()
    return entry


@dataclass(frozen=True)
class AuditRow:
    """操作紀錄一筆，加上讀取當下查出來的人：誰做的（操作者）、對哪個帳號
    （target_type 為 user 時）。都不存在稽核表裡。"""

    entry: AuditLogEntry
    # 定期工作等系統動作沒有操作者；帳號刪除後 actor_user_id 也會被清成 NULL。
    actor_email: str | None
    actor_display_name: str | None
    # 被操作的帳號：顯示名稱，沒有就用 email；不是帳號或已找不到時為 None。
    target_label: str | None


def _uuid_or_none(value: str) -> uuid.UUID | None:
    # 登入失敗等紀錄的 target_id 可能是 "unknown"。
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def list_recent(db: AsyncSession, campus_key: str | None, limit: int = 100) -> list[AuditRow]:
    actor = aliased(User)
    stmt = (
        select(AuditLogEntry, actor.email, actor.display_name)
        .outerjoin(actor, actor.id == AuditLogEntry.actor_user_id)
        .order_by(AuditLogEntry.created_at.desc())
        .limit(limit)
    )
    if campus_key:
        stmt = stmt.where(AuditLogEntry.campus_key == campus_key)
    rows = (await db.execute(stmt)).all()

    target_ids = {
        target_id
        for entry, _, _ in rows
        if entry.target_type == "user" and (target_id := _uuid_or_none(entry.target_id)) is not None
    }
    targets: dict[uuid.UUID, str] = {}
    if target_ids:
        result = await db.execute(select(User.id, User.email, User.display_name).where(User.id.in_(target_ids)))
        targets = {user_id: display_name or email for user_id, email, display_name in result.all()}

    return [
        AuditRow(
            entry=entry,
            actor_email=actor_email,
            actor_display_name=actor_display_name,
            target_label=(
                targets.get(_uuid_or_none(entry.target_id)) if entry.target_type == "user" else None
            ),
        )
        for entry, actor_email, actor_display_name in rows
    ]
