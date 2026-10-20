"""把去識別的歷年註冊 JSON 寫進資料庫（2026-10-20 招生潛力與市佔率規格 §3.1）：同一校整批取代，在呼叫端的單一交易內完成。"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.history.models import CampusTermEnrollment
from app.admissions.history.payload import EnrollmentHistoryIn

logger = logging.getLogger("app.admissions.history")


async def replace_history(db: AsyncSession, payload: EnrollmentHistoryIn) -> int:
    """先刪該校所有列再寫入（其他校不動）；回寫入列數。呼叫端 commit。"""
    await db.execute(delete(CampusTermEnrollment).where(CampusTermEnrollment.campus_key == payload.campus_key))
    now = datetime.now(timezone.utc)
    db.add_all(
        CampusTermEnrollment(campus_key=payload.campus_key, imported_at=now, **row.model_dump()) for row in payload.rows
    )
    await db.flush()
    logger.info("歷年註冊已匯入：%s，%d 列", payload.campus_key, len(payload.rows))
    return len(payload.rows)
