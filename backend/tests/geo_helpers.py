"""招生區域分析測試共用（A4 補上公開資料樣本）。"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.models import RecruitmentVisit


async def add_visit(
    db: AsyncSession, *, address: str | None, campus_key: str = "yihua", anonymized: bool = False
) -> RecruitmentVisit:
    """直接寫一筆最小的招生訪視（不走 API、不比對）。會 flush、不 commit。"""
    now = datetime.now(timezone.utc)
    visit = RecruitmentVisit(
        campus_key=campus_key,
        month="115.09",
        visit_date=date(2026, 9, 8),
        child_name="區域測試",
        address=address,
        created_at=now,
        updated_at=now,
        anonymized_at=now if anonymized else None,
    )
    db.add(visit)
    await db.flush()
    return visit
