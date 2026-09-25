"""個資保存政策（規格 L282、L333；保存天數與範圍依使用者 2026-09-25 裁定）。

- 已取消、未到場：結案後超過 cancelled_days 匿名化。
- 已完成參觀：結案後超過 completed_days 匿名化。
- 結案時間：取消看 cancelled_at；完成與未到場看歷程裡 completed／no_show 那筆
  的時間；都沒有（歷程上線前的舊案）才退回 created_at。
- 還沒結案的案件（新案、聯絡中、待確認、已確認）一律不清；送出超過
  open_overdue_days 仍沒結案的只回報件數（open_overdue_count），提醒園方先結案。

試算不改資料、不留紀錄；真的匿名化一定要部署設定
WEBSITE_RETENTION_ALLOW_REAL_RUN=true，定期工作另外要政策開啟自動執行。每次
真正執行都寫一筆 retention_runs（不記案件 id）。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitContactNote, VisitRequest, VisitRequestEvent, VisitRequestStatus
from app.common.timezones import now_utc
from app.operations.models import DEFAULT_RETENTION_DAYS, RetentionPolicy, RetentionRun, RetentionRunTrigger

ANONYMIZED_NOTE = "（已依保存政策匿名化）"

# 各類的代碼（retention_runs.counts 的鍵，API 與後台共用）。
CANCELLED = VisitRequestStatus.CANCELLED.value
NO_SHOW = VisitRequestStatus.NO_SHOW.value
COMPLETED = VisitRequestStatus.COMPLETED.value
CATEGORIES = (CANCELLED, NO_SHOW, COMPLETED)
# 各類用哪一個天數設定。
_DAYS_FIELD = {CANCELLED: "cancelled_days", NO_SHOW: "cancelled_days", COMPLETED: "completed_days"}

_OPEN_STATUSES = (
    VisitRequestStatus.NEW.value,
    VisitRequestStatus.CONTACTING.value,
    VisitRequestStatus.PENDING_CONFIRMATION.value,
    VisitRequestStatus.CONFIRMED.value,
)
# 歷程裡代表「完成」與「未到場」的事件（workflow_service._close 寫入）。
_CLOSING_EVENTS = ("completed", "no_show")


async def get_policy(db: AsyncSession, *, for_update: bool = False) -> RetentionPolicy:
    """讀政策；還沒有就建立預設列（不啟用自動清理）。"""
    stmt = select(RetentionPolicy).where(RetentionPolicy.id == 1)
    if for_update:
        # 同一個 session 先前讀過時，鎖列後要用資料庫的最新值蓋掉記憶體裡的舊值。
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    policy = (await db.execute(stmt)).scalar_one_or_none()
    if policy is None:
        # 兩個請求同時建立預設列時，後到的一方撞主鍵；ON CONFLICT 讓它安靜
        # 地讀回同一列。
        await db.execute(insert(RetentionPolicy).values(id=1, **_default_values()).on_conflict_do_nothing())
        policy = (await db.execute(stmt.execution_options(populate_existing=True))).scalar_one()
    return policy


def _default_values() -> dict:
    return {
        "cancelled_days": DEFAULT_RETENTION_DAYS,
        "completed_days": DEFAULT_RETENTION_DAYS,
        "open_overdue_days": DEFAULT_RETENTION_DAYS,
        "auto_run_enabled": False,
        "version": 1,
    }


def policy_days(policy: RetentionPolicy) -> dict[str, int]:
    return {
        "cancelled_days": policy.cancelled_days,
        "completed_days": policy.completed_days,
        "open_overdue_days": policy.open_overdue_days,
    }


def closed_time():
    """結案時間（見模組說明）。"""
    closing_event = (
        select(func.max(VisitRequestEvent.created_at))
        .where(
            VisitRequestEvent.visit_request_id == VisitRequest.id,
            VisitRequestEvent.event_type.in_(_CLOSING_EVENTS),
        )
        .correlate(VisitRequest)
        .scalar_subquery()
    )
    return func.coalesce(VisitRequest.cancelled_at, closing_event, VisitRequest.created_at)


async def find_candidates(
    db: AsyncSession, days: dict[str, int], *, now: datetime | None = None
) -> dict[str, list[VisitRequest]]:
    current = now or now_utc()
    found: dict[str, list[VisitRequest]] = {}
    for category in CATEGORIES:
        cutoff = current - timedelta(days=days[_DAYS_FIELD[category]])
        result = await db.execute(
            select(VisitRequest)
            .where(
                VisitRequest.status == category,
                VisitRequest.anonymized_at.is_(None),
                closed_time() < cutoff,
            )
            .order_by(VisitRequest.created_at)
        )
        found[category] = list(result.scalars())
    return found


async def count_open_overdue(db: AsyncSession, days: dict[str, int], *, now: datetime | None = None) -> int:
    """送出已超過 open_overdue_days、卻還沒結案的案件數。這些不會被清理，要
    先在後台結案（取消、完成或未到場）。"""
    cutoff = (now or now_utc()) - timedelta(days=days["open_overdue_days"])
    return (
        await db.execute(
            select(func.count())
            .select_from(VisitRequest)
            .where(
                VisitRequest.status.in_(_OPEN_STATUSES),
                VisitRequest.anonymized_at.is_(None),
                VisitRequest.created_at < cutoff,
            )
        )
    ).scalar_one()


@dataclass
class RetentionReport:
    days: dict[str, int]
    counts: dict[str, int] = field(default_factory=dict)
    open_overdue_count: int = 0
    dry_run: bool = True
    run_id: uuid.UUID | None = None

    @property
    def total(self) -> int:
        return sum(self.counts.values())


async def preview(db: AsyncSession, days: dict[str, int], *, now: datetime | None = None) -> RetentionReport:
    """只算筆數，不改資料、不留紀錄（保存政策頁的「現在執行會處理幾筆」）。"""
    current = now or now_utc()
    found = await find_candidates(db, days, now=current)
    return RetentionReport(
        days=days,
        counts={k: len(v) for k, v in found.items()},
        open_overdue_count=await count_open_overdue(db, days, now=current),
    )


async def anonymize(db: AsyncSession, visit_request: VisitRequest) -> None:
    """匿名化不動狀態、不動時段、不動預約設定——只清掉個資欄位，
    保留案件本身與統計用的 event/analytics 紀錄完整。"""
    visit_request.parent_name = ANONYMIZED_NOTE
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


async def run_sweep(
    db: AsyncSession,
    days: dict[str, int],
    *,
    trigger: RetentionRunTrigger,
    actor_user_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> RetentionReport:
    """匿名化到期的已結案案件，並寫一筆 retention_runs。呼叫端負責確認部署
    允許真正清理、寫稽核與 commit。"""
    current = now or now_utc()
    found = await find_candidates(db, days, now=current)
    report = RetentionReport(
        days=days,
        counts={k: len(v) for k, v in found.items()},
        open_overdue_count=await count_open_overdue(db, days, now=current),
        dry_run=False,
    )
    for candidates in found.values():
        for candidate in candidates:
            await anonymize(db, candidate)
    await _backfill_anonymized(db)
    run = RetentionRun(
        id=uuid.uuid4(),
        created_at=current,
        trigger=trigger.value,
        actor_user_id=actor_user_id,
        policy=days,
        counts=report.counts,
        total=report.total,
        open_overdue_count=report.open_overdue_count,
    )
    db.add(run)
    await db.flush()
    report.run_id = run.id
    return report


async def _backfill_anonymized(db: AsyncSession) -> None:
    """回補：舊版匿名化沒有清聯絡紀錄與原因，已標記的案件不會再被選為候選。"""
    anonymized = select(VisitRequest.id).where(VisitRequest.anonymized_at.is_not(None))
    await db.execute(
        update(VisitContactNote)
        .where(VisitContactNote.visit_request_id.in_(anonymized), VisitContactNote.note != ANONYMIZED_NOTE)
        .values(note=ANONYMIZED_NOTE)
    )
    await _clear_free_text_reasons(db, anonymized)
    await db.flush()


def audit_metadata(report: RetentionReport, trigger: RetentionRunTrigger) -> dict:
    """retention.run 稽核的內容：觸發方式、天數、各類筆數，不含案件 id。"""
    return {
        "trigger": trigger.value,
        "days": report.days,
        "counts": report.counts,
        "total": report.total,
        "open_overdue_count": report.open_overdue_count,
        "run_id": str(report.run_id) if report.run_id else None,
    }


async def list_runs(db: AsyncSession, *, limit: int = 50) -> list[RetentionRun]:
    result = await db.execute(select(RetentionRun).order_by(RetentionRun.created_at.desc()).limit(limit))
    return list(result.scalars())


def due_today(policy: RetentionPolicy, today: date) -> bool:
    """定期工作一天最多跑一次（台灣日期）。"""
    return policy.last_scheduled_on is None or policy.last_scheduled_on < today
