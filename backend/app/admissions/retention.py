"""招生訪視的保存政策（規格 11）：試算與匿名化。

- 符合條件：還沒匿名化，且最後更新（updated_at）早於 now − admissions_days。
- 清除：幼生姓名（欄位 NOT NULL，換成「（已依保存政策匿名化）」）、生日、電話、
  聯絡人、地址、備註、電訪回應、未預繳原因說明、退出原因，以及歷程裡人員寫的原因；
  參觀後追蹤（2026-10-04 規格 10）另清下次聯絡（DB CHECK 要求）與聯絡紀錄的內容，
  聯絡紀錄的時間、方式、有沒有聯絡到保留。
- 保留：統計欄位（月份、參觀日期、年級、來源、家長介紹、預繳、註冊、轉學期、未預繳
  原因、保留座位、入學學年學期、退出時間與來源）、updated_at 與 anonymized_at。
  version 加一：開著舊畫面的人存檔會收到 409，不會把個資寫回去。
- 區域比對結果（recruitment_visit_geo，2026-10-08 區域分析規格 10）：里與距離清掉，
  比對等級退到 district（訪視還有行政區）或 unlocated，原因記 anonymized；
  recruitment_visits.district 保留（同園務、同既有統計行為）。
- 與預約的匿名化各自獨立：預約匿名化不連動招生訪視，反之亦然。
- days 為 None（預設，天數待業主裁定）時什麼都不做。

只 flush；retention_service 負責清理紀錄、稽核與 commit。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.admissions.constants import ANONYMIZED_TEXT
from app.admissions.geo.models import RecruitmentVisitGeo
from app.admissions.models import RecruitmentContactLog, RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import now_utc


# 一次 UPDATE 帶的訪視 id 上限，遠低於 asyncpg 的參數數量上限。
_GEO_CHUNK = 1000


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
    訪視的歷程與聯絡紀錄）。區域比對結果的里與距離一併清掉，行政區保留。

    只改這一列訪視與它的歷程；區域比對結果由 anonymize_due 在訪視 flush 之後清
    （見 _anonymize_geo）。"""
    visit.child_name = ANONYMIZED_TEXT
    visit.english_name = None
    visit.birthday = None
    visit.phone = None
    visit.contact_name = None
    visit.father_occupation = None
    visit.mother_occupation = None
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


async def _anonymize_geo(db: AsyncSession, visits: list[RecruitmentVisit]) -> None:
    """清掉這批已匿名化訪視的區域比對結果：里與距離歸零，等級 district（訪視留有行政區）
    或 unlocated，原因 anonymized。沒有比對結果的訪視（上線前就存在）不補建。

    鎖定順序同 matcher.rematch_visits：呼叫前 recruitment_visits 已 UPDATE（取得列鎖），
    才動 recruitment_visit_geo。RecruitmentVisit.geo 是 viewonly，這裡用 Core UPDATE 直接
    改 geo 列，synchronize_session="fetch" 讓 session 內已載入的 geo 物件跟著更新。"""
    for match_level, has_district in (("district", True), ("unlocated", False)):
        ids = [visit.id for visit in visits if bool(visit.district) is has_district]
        for start in range(0, len(ids), _GEO_CHUNK):
            await db.execute(
                update(RecruitmentVisitGeo)
                .where(RecruitmentVisitGeo.visit_id.in_(ids[start : start + _GEO_CHUNK]))
                .values(village=None, distance_m=None, match_level=match_level, unlocated_reason="anonymized")
                .execution_options(synchronize_session="fetch")
            )


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
    await db.flush()  # 先寫訪視列，再動 geo 列（鎖定順序，見 _anonymize_geo）
    await _anonymize_geo(db, visits)
    return len(visits)
