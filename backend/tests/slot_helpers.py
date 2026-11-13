"""測試用：把已建好的場次移到指定日期。

建立場次的 API 不收「開始時間已過」的場次（2026-11-12 QA L13），要模擬「已開始 / 昨天的場次」的測試
先用 API 建一個未來的場次（走正常流程），再用這裡直接改 DB 的日期。"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitSlot


async def move_slot_to_day(db: AsyncSession, slot_id: str | uuid.UUID, day: date) -> None:
    await db.execute(update(VisitSlot).where(VisitSlot.id == uuid.UUID(str(slot_id))).values(slot_date=day))
    await db.commit()
