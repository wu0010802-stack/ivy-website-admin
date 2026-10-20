"""附近幼兒園的裁罰與評鑑（2026-10-20 規格 §5、C3、C11）：清單每所一行的摘要，以及展開時讀的全部明細。只讀。

資料表裡沒有任何人名（geo_kindergarten_penalties 只存對象類別 operator／staff），這裡回的也只有類別。
件數以「件」計：同一所、同一個裁處日、同一個裁處文號是一件（C3），不論有幾條法條、幾筆處分；
同一所對到兩個檔名（改名前後的檔都對到同一個 source_id）時，相同的件只算一次。

近 3 年：裁處日在「今天往前推三年的同月同日」當天或之後。畫面三種狀態靠這幾個欄位：
penalties_recent > 0 → 「近 3 年裁罰 N 件」；penalties_recent == 0 且 has_older_penalty → 「3 年前有裁罰」；其餘不顯示。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import (
    GeoDatasetStatus, GeoKindergarten, GeoKindergartenEvaluation, GeoKindergartenPenalty,
)

PENALTY_WINDOW_YEARS = 3
SOURCE_NOTE = "資料來源：全國教保資訊網（裁罰經 kiang 整理）"


def window_start(today: date) -> date:
    """近 3 年的起算日（含當天）：今天往前三年的同月同日；2 月 29 日往前三年沒有這天，取 2 月 28 日。"""
    try:
        return today.replace(year=today.year - PENALTY_WINDOW_YEARS)
    except ValueError:
        return today.replace(year=today.year - PENALTY_WINDOW_YEARS, day=28)


@dataclass(frozen=True)
class RecordsSummary:
    penalties_recent: int = 0
    penalty_latest_on: date | None = None
    has_older_penalty: bool = False
    evaluation_latest: dict | None = None


def _evaluation_rank(year: int, completed_on: date | None) -> tuple[int, date]:
    return year, completed_on or date.min


async def summaries(db: AsyncSession, source_ids: list[str], today: date) -> dict[str, RecordsSummary]:
    """清單用：每個 source_id 一個摘要（沒有任何紀錄的也有，全是預設值）。"""
    result = {source_id: RecordsSummary() for source_id in source_ids}
    if not source_ids:
        return result
    cutoff = window_start(today)
    cases: dict[str, set[tuple[date, str]]] = {}
    for source_id, occurred_on, doc_no in (
        await db.execute(
            select(GeoKindergartenPenalty.source_id, GeoKindergartenPenalty.occurred_on, GeoKindergartenPenalty.doc_no)
            .where(GeoKindergartenPenalty.source_id.in_(source_ids))
            .distinct()
        )
    ).all():
        cases.setdefault(source_id, set()).add((occurred_on, doc_no))
    latest: dict[str, tuple[date | None, int, str]] = {}
    for source_id, year, completed_on, text in (
        await db.execute(
            select(
                GeoKindergartenEvaluation.source_id, GeoKindergartenEvaluation.school_year,
                GeoKindergartenEvaluation.completed_on, GeoKindergartenEvaluation.result,
            ).where(GeoKindergartenEvaluation.source_id.in_(source_ids))
        )
    ).all():
        best = latest.get(source_id)
        if best is None or _evaluation_rank(year, completed_on) > _evaluation_rank(best[1], best[0]):
            latest[source_id] = (completed_on, year, text)
    for source_id in source_ids:
        found = cases.get(source_id, set())
        recent = [case for case in found if case[0] >= cutoff]
        evaluation = latest.get(source_id)
        result[source_id] = RecordsSummary(
            penalties_recent=len(recent),
            penalty_latest_on=max((day for day, _ in found), default=None),
            has_older_penalty=any(day < cutoff for day, _ in found),
            evaluation_latest=(
                {"year": evaluation[1], "completed_on": evaluation[0], "result": evaluation[2]} if evaluation else None
            ),
        )
    return result


async def records(db: AsyncSession, source_id: str, today: date) -> dict | None:
    """展開時讀：這所園所的全部裁罰（新到舊，每筆處分一列）與評鑑（新到舊）。園所不存在回 None。
    裁罰欄位是規格 C1 的那些，沒有姓名；recent 標出是不是近 3 年內（和清單的件數同一個起算日）。"""
    school = await db.get(GeoKindergarten, source_id)
    if school is None:
        return None
    cutoff = window_start(today)
    penalty_rows = (
        await db.execute(
            select(GeoKindergartenPenalty)
            .where(GeoKindergartenPenalty.source_id == source_id)
            .order_by(
                GeoKindergartenPenalty.occurred_on.desc(), GeoKindergartenPenalty.doc_no,
                GeoKindergartenPenalty.law, GeoKindergartenPenalty.id,
            )
        )
    ).scalars().all()
    seen: set[tuple] = set()
    penalties = []
    for row in penalty_rows:
        key = (row.occurred_on, row.doc_no, row.law, row.punishment_hash)
        if key in seen:  # 兩個檔名對到同一所時，同一筆只列一次
            continue
        seen.add(key)
        penalties.append(
            {
                "occurred_on": row.occurred_on, "doc_no": row.doc_no, "law": row.law, "content": row.content,
                "kind": row.kind, "amount": row.amount, "period_start": row.period_start, "period_end": row.period_end,
                "punishment_text": row.punishment_text, "subject": row.subject, "recent": row.occurred_on >= cutoff,
            }
        )
    evaluation_rows = (
        await db.execute(select(GeoKindergartenEvaluation).where(GeoKindergartenEvaluation.source_id == source_id))
    ).scalars().all()
    evaluations = [
        {"school_year": row.school_year, "completed_on": row.completed_on, "result": row.result}
        for row in sorted(evaluation_rows, key=lambda row: _evaluation_rank(row.school_year, row.completed_on), reverse=True)
    ]
    penalties_status = await db.get(GeoDatasetStatus, "kindergarten_penalties")
    evaluations_status = await db.get(GeoDatasetStatus, "kindergarten_evaluations")
    return {
        "source_id": school.source_id,
        "name": school.name,
        "penalties_synced_at": penalties_status.synced_at if penalties_status is not None else None,
        "evaluations_synced_at": evaluations_status.synced_at if evaluations_status is not None else None,
        "source_note": SOURCE_NOTE,
        "penalties": penalties,
        "evaluations": evaluations,
    }
