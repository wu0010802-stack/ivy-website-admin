"""案件歷程（規格 L211、L299 VisitHistory）的寫入點。

每筆歷程記：做了什麼（event_type）、誰做的（actor）、異動前後（before／
after）、原因（reason）。workflow_service、access_service 與建案流程都經過
這裡寫，不直接 new VisitRequestEvent，欄位格式才會一致。

before／after 只放狀態、時段、承辦人這類非個資欄位，不放家長姓名或電話；
reason 是人員填的自由文字，匿名化時會清掉。"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitEventSource, VisitRequest, VisitRequestEvent, VisitSlot


@dataclass(frozen=True)
class Actor:
    """歷程的操作者。後台人員記 user_id；家長沒有帳號、定期工作不是人，
    都只記來源。"""

    source: str
    user_id: uuid.UUID | None = None

    @classmethod
    def staff(cls, user_id: uuid.UUID | None) -> "Actor":
        return cls(VisitEventSource.STAFF.value, user_id)


PARENT = Actor(VisitEventSource.PARENT.value)
SYSTEM = Actor(VisitEventSource.SYSTEM.value)


def slot_brief(slot: VisitSlot | None) -> dict | None:
    if slot is None:
        return None
    return {
        "id": str(slot.id),
        "slot_date": slot.slot_date.isoformat(),
        "start_time": slot.start_time.isoformat(),
        "end_time": slot.end_time.isoformat(),
    }


async def load_slot(db: AsyncSession, slot_id: uuid.UUID | None) -> VisitSlot | None:
    """已經在這個 session 裡的時段直接取用（identity map），不會觸發
    async 下的 lazy load。"""
    if slot_id is None:
        return None
    return await db.get(VisitSlot, slot_id)


async def state_of(db: AsyncSession, visit_request: VisitRequest) -> dict:
    """案件目前的狀態與時段，給 before／after 用。"""
    return {
        "status": visit_request.status,
        "slot": slot_brief(await load_slot(db, visit_request.slot_id)),
    }


def record_event(
    db: AsyncSession,
    visit_request_id: uuid.UUID,
    event_type: str,
    *,
    actor: Actor | None = None,
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
) -> None:
    """actor 為 None 代表呼叫端沒有提供（例如直接呼叫 service 的測試），
    歷程照寫，只是不知道是誰。"""
    cleaned_reason = reason.strip() if reason else None
    db.add(
        VisitRequestEvent(
            id=uuid.uuid4(),
            visit_request_id=visit_request_id,
            event_type=event_type,
            created_at=datetime.now(timezone.utc),
            actor_user_id=actor.user_id if actor else None,
            source=actor.source if actor else None,
            before=before,
            after=after,
            reason=cleaned_reason or None,
        )
    )
