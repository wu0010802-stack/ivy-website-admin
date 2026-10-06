from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.models import User
from app.booking.models import VisitRequest
from app.common.client_info import current_client_info
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
    client = current_client_info()
    entry = AuditLogEntry(
        id=uuid.uuid4(),
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        campus_key=campus_key,
        metadata_json=_mask_metadata(metadata or {}),
        created_at=datetime.now(timezone.utc),
        ip_address=client.ip_address,
        user_agent=client.user_agent,
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
    # target_type 為 visit_request 時：那筆案件現在還在不在（個資清理會刪掉
    # 案件）；其他對象為 None。後台用它決定要不要給「查看案件」連結。
    target_exists: bool | None = None


def _uuid_or_none(value: str) -> uuid.UUID | None:
    # 登入失敗等紀錄的 target_id 可能是 "unknown"。
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


# 例行的登入登出：每人每天都有，操作紀錄頁可以勾選隱藏。登入失敗與帳號
# 鎖定不算在內，那是要留意的事。
ROUTINE_LOGIN_ACTIONS = ("user.login_password", "user.login_google", "user.login_line", "user.logout")


def _visit_exists(entry: AuditLogEntry, existing: set[uuid.UUID]) -> bool | None:
    # 匯出這類動作的 target_id 是校區代號或 "all"，不是哪一筆案件。
    if entry.target_type != "visit_request" or (visit_id := _uuid_or_none(entry.target_id)) is None:
        return None
    return visit_id in existing


async def list_recent(
    db: AsyncSession,
    campus_key: str | None,
    limit: int = 100,
    *,
    before: tuple[datetime, uuid.UUID] | None = None,
    exclude_login: bool = False,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[AuditRow]:
    """新的在前，一次 limit 筆。before 是上一頁最後一筆的 (created_at, id)，
    傳了就接著往更早的讀；同一時間的多筆用 id 排出固定順序，不會漏也不會重複。
    since（含）、until（不含）是 UTC，路由先把台北日期換好。"""
    actor = aliased(User)
    stmt = (
        select(AuditLogEntry, actor.email, actor.display_name)
        .outerjoin(actor, actor.id == AuditLogEntry.actor_user_id)
        .order_by(AuditLogEntry.created_at.desc(), AuditLogEntry.id.desc())
        .limit(limit)
    )
    if campus_key:
        stmt = stmt.where(AuditLogEntry.campus_key == campus_key)
    if before is not None:
        stmt = stmt.where(tuple_(AuditLogEntry.created_at, AuditLogEntry.id) < tuple_(*before))
    if exclude_login:
        stmt = stmt.where(AuditLogEntry.action.not_in(ROUTINE_LOGIN_ACTIONS))
    if since is not None:
        stmt = stmt.where(AuditLogEntry.created_at >= since)
    if until is not None:
        stmt = stmt.where(AuditLogEntry.created_at < until)
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

    visit_ids = {
        target_id
        for entry, _, _ in rows
        if entry.target_type == "visit_request" and (target_id := _uuid_or_none(entry.target_id)) is not None
    }
    existing_visits: set[uuid.UUID] = set()
    if visit_ids:
        result = await db.execute(select(VisitRequest.id).where(VisitRequest.id.in_(visit_ids)))
        existing_visits = set(result.scalars())

    return [
        AuditRow(
            entry=entry,
            actor_email=actor_email,
            actor_display_name=actor_display_name,
            target_label=(
                targets.get(_uuid_or_none(entry.target_id)) if entry.target_type == "user" else None
            ),
            target_exists=_visit_exists(entry, existing_visits),
        )
        for entry, actor_email, actor_display_name in rows
    ]
