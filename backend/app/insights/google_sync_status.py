"""商家檔案與 Keyword Planner 背景同步共用的狀態紀錄（google_sync_status 一個 key 一列）。

一輪同步分兩段交易：開始前記 last_attempt_at 並提交（向 Google 要資料時不握著資料庫連線），寫完資料時在同一個交易
記 last_success_at；失敗只記 last_error。「上一次失敗」＝有嘗試、但成功時間早於嘗試時間（或從來沒成功）。"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.insights.models import GoogleSyncStatus

# 失敗後至少隔這麼久才再試（API 還沒核准時一天只會打 Google 幾次，不會每小時刷一次錯誤）。
RETRY_AFTER = timedelta(hours=3)
ERROR_MAX = 200


def failed_last_time(status: GoogleSyncStatus | None) -> bool:
    if status is None or status.last_attempt_at is None:
        return False
    return status.last_success_at is None or status.last_success_at < status.last_attempt_at


def waiting_to_retry(status: GoogleSyncStatus | None, now: datetime) -> bool:
    """上一次失敗、而且離那次嘗試還不到 RETRY_AFTER。"""
    return failed_last_time(status) and status is not None and status.last_attempt_at is not None and (
        now - status.last_attempt_at < RETRY_AFTER
    )


async def mark_attempt(db: AsyncSession, key: str, now: datetime) -> GoogleSyncStatus:
    status = await db.get(GoogleSyncStatus, key, with_for_update=True)
    if status is None:
        status = GoogleSyncStatus(key=key)
        db.add(status)
    status.last_attempt_at = now
    return status


async def mark_success(db: AsyncSession, key: str, attempt_at: datetime, *, note: str | None = None) -> None:
    """成功：成功時間記成這一輪開始的時間（等於 last_attempt_at，failed_last_time 就是 False）。note 是部分失敗的說明。"""
    status = await db.get(GoogleSyncStatus, key, with_for_update=True)
    if status is None:
        status = GoogleSyncStatus(key=key, last_attempt_at=attempt_at)
        db.add(status)
    status.last_success_at = attempt_at
    status.last_error = note[:ERROR_MAX] if note else None


async def mark_failure(db: AsyncSession, key: str, error: str) -> None:
    status = await db.get(GoogleSyncStatus, key, with_for_update=True)
    if status is None:
        status = GoogleSyncStatus(key=key)
        db.add(status)
    status.last_error = error[:ERROR_MAX]
