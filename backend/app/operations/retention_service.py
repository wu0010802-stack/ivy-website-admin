from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitContactNote, VisitRequest, VisitRequestEvent, VisitRequestStatus

DEFAULT_RETENTION_DAYS = 365
ANONYMIZED_NOTE = "（已依保存政策匿名化）"

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
    visit_request.child_name = None
    visit_request.child_birthdate = None
    visit_request.email = None
    visit_request.referral_sources = []
    visit_request.questions = None
    # 聯絡紀錄是接待人員寫的自由文字，常會記下姓名、電話或家庭狀況；
    # 不清掉的話案件標成已匿名化，個資卻還留在關聯表裡。保留列與時間
    # （聯絡歷程次數仍可統計），只換掉內容。
    await db.execute(
        update(VisitContactNote)
        .where(VisitContactNote.visit_request_id == visit_request.id)
        .values(note=ANONYMIZED_NOTE)
    )
    await _clear_free_text_reasons(db, [visit_request.id])
    visit_request.anonymized_at = datetime.now(timezone.utc)
    await db.flush()


async def _clear_free_text_reasons(db: AsyncSession, visit_request_ids) -> None:
    """歷程與改期退回的「原因」也是人員寫的自由文字，跟聯絡紀錄一樣清掉；
    歷程的動作、時間與前後狀態保留。"""
    await db.execute(
        update(VisitRequestEvent)
        .where(VisitRequestEvent.visit_request_id.in_(visit_request_ids), VisitRequestEvent.reason.is_not(None))
        .values(reason=None)
    )
    await db.execute(
        update(RescheduleRequest)
        .where(RescheduleRequest.visit_request_id.in_(visit_request_ids), RescheduleRequest.reject_reason.is_not(None))
        .values(reject_reason=None)
    )


async def run_retention_sweep(
    db: AsyncSession, *, older_than_days: int = DEFAULT_RETENTION_DAYS, dry_run: bool = True
) -> dict:
    candidates = await find_retention_candidates(db, older_than_days)
    report = build_dry_run_report(candidates)
    if dry_run:
        return report
    for candidate in candidates:
        await anonymize(db, candidate)
    # 回補：舊版匿名化沒有清聯絡紀錄，已標記的案件不會再被選為候選。
    await db.execute(
        update(VisitContactNote)
        .where(
            VisitContactNote.visit_request_id.in_(
                select(VisitRequest.id).where(VisitRequest.anonymized_at.is_not(None))
            ),
            VisitContactNote.note != ANONYMIZED_NOTE,
        )
        .values(note=ANONYMIZED_NOTE)
    )
    await _clear_free_text_reasons(db, select(VisitRequest.id).where(VisitRequest.anonymized_at.is_not(None)))
    await db.flush()
    return report
