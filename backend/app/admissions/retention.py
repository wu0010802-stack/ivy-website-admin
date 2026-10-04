"""招生訪視的保存政策（規格 11）：試算與匿名化。

- 符合條件：還沒匿名化，且最後更新（updated_at）早於 now − admissions_days。
- 清除：幼生姓名（欄位 NOT NULL，換成「（已依保存政策匿名化）」）、生日、電話、
  聯絡人、地址、備註、電訪回應、未預繳原因說明、退出原因，以及歷程裡人員寫的原因；
  參觀後追蹤（2026-10-04 規格 10）另清下次聯絡（DB CHECK 要求）與聯絡紀錄的內容，
  聯絡紀錄的時間、方式、有沒有聯絡到保留。
- 保留：統計欄位（月份、參觀日期、年級、來源、介紹者、預繳、註冊、轉學期、未預繳
  原因、保留座位、入學學年學期、退出時間與來源）、updated_at 與 anonymized_at。
  version 加一：開著舊畫面的人存檔會收到 409，不會把個資寫回去。
- 與預約的匿名化各自獨立：預約匿名化不連動招生訪視，反之亦然。
- days 為 None（預設，天數待業主裁定）時什麼都不做。

只 flush；retention_service 負責清理紀錄、稽核與 commit。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.admissions.constants import ANONYMIZED_TEXT
from app.admissions.models import RecruitmentContactLog, RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import now_utc


def _due(days: int, now: datetime | None) -> tuple:
    cutoff = (now or now_utc()) - timedelta(days=days)
    return (RecruitmentVisit.anonymized_at.is_(None), RecruitmentVisit.updated_at < cutoff)


async def eligible_count(db: AsyncSession, days: int | None, *, now: datetime | None = None) -> int:
    """現在執行會匿名化幾筆（試算，不改資料）。"""
    if days is None:
        return 0
    count = await db.scalar(select(func.count()).select_from(RecruitmentVisit).where(*_due(days, now)))
    return int(count or 0)


def anonymize_visit(
    visit: RecruitmentVisit,
    events: list[RecruitmentEventLog],
    contact_logs: list[RecruitmentContactLog] = (),
) -> None:
    """清掉一筆訪視的個資欄位、歷程原因與聯絡紀錄內容（events、contact_logs 是這筆
    訪視的歷程與聯絡紀錄）。"""
    visit.child_name = ANONYMIZED_TEXT
    visit.birthday = None
    visit.phone = None
    visit.contact_name = None
    visit.address = None
    visit.notes = None
    visit.parent_response = None
    visit.no_deposit_reason_detail = None
    visit.withdraw_reason = None
    for event in events:
        event.reason = None
    for log in contact_logs:
        log.note = None
    visit.follow_up_at = None
    visit.anonymized_at = datetime.now(timezone.utc)
    visit.version += 1


async def anonymize_due(db: AsyncSession, days: int | None, *, now: datetime | None = None) -> int:
    """匿名化到期的訪視，回傳筆數。鎖住到期的列，與同時進行的編輯排隊。"""
    if days is None:
        return 0
    result = await db.execute(
        select(RecruitmentVisit)
        .where(*_due(days, now))
        .options(selectinload(RecruitmentVisit.events), selectinload(RecruitmentVisit.contact_logs))
        .order_by(RecruitmentVisit.created_at)
        .with_for_update(of=RecruitmentVisit)
    )
    visits = list(result.scalars())
    for visit in visits:
        anonymize_visit(visit, list(visit.events), list(visit.contact_logs))
    await db.flush()
    return len(visits)
