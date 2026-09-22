from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.operations.models import AuditLogEntry

# 這些欄位絕不能出現在 metadata_json 裡（就算呼叫端不小心傳進來也擋掉），
# 避免稽核紀錄變成另一份個資外洩管道。
_FORBIDDEN_METADATA_KEYS = {
    "phone", "parent_name", "password", "email", "questions",
    "child_name", "child_birthdate", "referral_sources",
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


async def list_recent(db: AsyncSession, campus_key: str | None, limit: int = 100) -> list[AuditLogEntry]:
    stmt = select(AuditLogEntry).order_by(AuditLogEntry.created_at.desc()).limit(limit)
    if campus_key:
        stmt = stmt.where(AuditLogEntry.campus_key == campus_key)
    result = await db.execute(stmt)
    return list(result.scalars())
