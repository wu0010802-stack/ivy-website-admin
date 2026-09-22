from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitRequestStatus

DEFAULT_RETENTION_DAYS = 365

# 只匿名化已經結案、不會再變動的狀態；new/confirmed 這種還在走流程的
# 案件即使超過天數也不動，避免破壞還在進行中的接待工作。
_ELIGIBLE_STATUSES = (VisitRequestStatus.CANCELLED.value, VisitRequestStatus.NO_SHOW.value)


async def find_retention_candidates(
    db: AsyncSession, older_than_days: int = DEFAULT_RETENTION_DAYS
) -> list[VisitRequest]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    result = await db.execute(
        select(VisitRequest).where(
            VisitRequest.status.in_(_ELIGIBLE_STATUSES),
            VisitRequest.created_at < cutoff,
            VisitRequest.anonymized_at.is_(None),
        )
    )
    return list(result.scalars())


def build_dry_run_report(candidates: list[VisitRequest]) -> dict:
    return {
        "candidate_count": len(candidates),
        "candidate_ids": [str(c.id) for c in candidates],
    }


async def anonymize(db: AsyncSession, visit_request: VisitRequest) -> None:
    """匿名化不動狀態、不動時段、不動預約設定——只清掉個資欄位，
    保留案件本身與統計用的 event/analytics 紀錄完整。"""
    visit_request.parent_name = "（已依保存政策匿名化）"
    visit_request.phone = "0000000000"
    visit_request.questions = None
    visit_request.anonymized_at = datetime.now(timezone.utc)
    await db.flush()


async def run_retention_sweep(
    db: AsyncSession, *, older_than_days: int = DEFAULT_RETENTION_DAYS, dry_run: bool = True
) -> dict:
    candidates = await find_retention_candidates(db, older_than_days)
    report = build_dry_run_report(candidates)
    if dry_run:
        return report
    for candidate in candidates:
        await anonymize(db, candidate)
    return report
