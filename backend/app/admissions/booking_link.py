"""官網預約與招生訪視的串接（規格 6.1）。

- fields_from_visit_request：預約欄位 → 招生訪視欄位。純函式：截斷、補預設，
  不丟例外，也不碰 visit_request.slot（async 下 lazy load 會丟 MissingGreenlet）。
- ensure_from_visit_request：在「標記已到場」的同一個交易內建立招生訪視，已有
  就回傳那一筆；workflow_service.mark_completed 與補建端點共用。
- arrivals：「官網預約」分頁的待確認清單與「已到場但沒有招生訪視」。

整條建立路徑沒有會丟例外的資料檢查，也不用 try/except 吞例外：真的是資料庫
錯誤就讓整個「標記已到場」回滾，不會留下「已到場卻沒有招生訪視」的半套狀態。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants, records
from app.admissions.models import RecruitmentVisit
from app.booking import history, status_groups
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local

# 「從哪裡知道我們」的後台顯示文案（與 admin labels.ts 的 REFERRAL_SOURCE_LABELS
# 同一組字，tests/test_admissions_booking_link.py 比對）。
REFERRAL_SOURCE_TEXT: dict[str, str] = {
    "friends_family": "親友介紹",
    "nearby": "住附近／路過看到",
    "online": "網路上看到",
    "other": "其他",
    # 2026-10-03 以前的選項，舊案件仍會有。
    "facebook": "Facebook",
    "google_reviews": "Google 評論",
    "parent_community": "媽媽社團",
}
NOTES_PREFIX = "家長想了解："
# 「官網預約」分頁兩份清單各最多回幾筆（另回截斷前的總數）。
ARRIVALS_LIMIT = 200

_DONE = (VisitRequestStatus.COMPLETED.value, VisitRequestStatus.NO_SHOW.value)


def _cut(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    return value.strip()[:limit] or None


def fields_from_visit_request(visit_request, *, today: date, slot_date: date | None = None) -> dict:
    """規格 6.1 第 1 點的欄位對應（today 是確認到場當天的台北日期）：

    - visit_date：場次日期；沒有場次（舊案）用 today。
    - child_name：孩子姓名截到 50 字；沒填寫「（未填姓名）」。
    - grade：有生日時依 today 所在學年換算（範圍外為 None）。
    - phone、contact_name：家長手機與稱呼（稱呼截到 50 字）。
    - source：勾選的「從哪裡知道我們」照後台文案以「、」串接，截到 50 字。
    - notes：「家長想了解：」＋想了解的事；沒填為 None。
    - target_school_year／target_semester：today 所在學期（同園務建立時補當前學期）。
    家長 Email 不複製（園務招生沒有 Email 欄位）。"""
    school_year, semester = academic.current_term(today)
    birthday = visit_request.child_birthdate
    sources = "、".join(REFERRAL_SOURCE_TEXT.get(str(code), str(code)) for code in (visit_request.referral_sources or []))
    questions = (visit_request.questions or "").strip()
    return {
        "visit_date": slot_date or today,
        "child_name": _cut(visit_request.child_name, constants.LEN_CHILD_NAME) or constants.MISSING_CHILD_NAME,
        "birthday": birthday,
        "grade": academic.grade_for_birthday(birthday, school_year) if birthday else None,
        "phone": _cut(visit_request.phone, constants.LEN_PHONE),
        "contact_name": _cut(visit_request.parent_name, constants.LEN_CONTACT),
        "source": _cut(sources, constants.LEN_SOURCE),
        "notes": f"{NOTES_PREFIX}{questions}" if questions else None,
        "target_school_year": school_year,
        "target_semester": semester,
    }


async def ensure_from_visit_request(
    db: AsyncSession, visit_request: VisitRequest, *, actor_user_id: uuid.UUID | None
) -> tuple[RecruitmentVisit, bool]:
    """這筆預約的招生訪視；沒有就建立（created 事件 origin＝visit_request）。回傳
    (訪視, 是否新建立)。呼叫端已鎖住預約列（mark_completed 的 _lock_status、補建
    端點的 with_for_update），同一筆預約不會同時建兩次；唯一鍵
    uq_recruitment_visits_visit_request 是最後防線。"""
    existing = await db.scalar(select(RecruitmentVisit).where(RecruitmentVisit.visit_request_id == visit_request.id))
    if existing is not None:
        return existing, False
    slot = await history.load_slot(db, visit_request.slot_id)
    today = today_local()
    fields = fields_from_visit_request(visit_request, today=today, slot_date=slot.slot_date if slot else None)
    visit = await records.create_visit(
        db,
        campus_key=visit_request.campus_key,
        fields=fields,
        actor_user_id=actor_user_id,
        origin="visit_request",
        visit_request_id=visit_request.id,
        today=today,
    )
    return visit, True


def _row(visit_request: VisitRequest, slot: VisitSlot | None) -> dict:
    return {
        "visit_request_id": visit_request.id,
        "slot_date": slot.slot_date if slot else None,
        "start_time": slot.start_time if slot else None,
        "parent_name": visit_request.parent_name,
        "child_name": visit_request.child_name,
        "party_size": visit_request.party_size,
        "status": visit_request.status,
    }


async def _capped(db: AsyncSession, query, *order_by) -> tuple[list[dict], int]:
    """依 order_by 取前 ARRIVALS_LIMIT 筆，另回截斷前的總數。"""
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    result = await db.execute(query.order_by(*order_by).limit(ARRIVALS_LIMIT))
    return [_row(visit_request, slot) for visit_request, slot in result.all()], int(total or 0)


async def arrivals(db: AsyncSession, campus_key: str, *, now: datetime | None = None) -> dict:
    """規格 6.1 第 2 點。兩份清單各最多 ARRIVALS_LIMIT 筆、新到舊，另回總數
    （awaiting_total、missing_total）。

    - awaiting：confirmed 且場次已開始、還沒確認到場。直接用預約改版的
      status_groups.group_condition("past") 再排除已到場、未到場，不另寫「已開始」
      的判斷；已停止申請的場次照列，沒有場次的 confirmed 不在 past，也不列。依場次
      日期與開始時間新到舊。
    - missing：已到場、還沒匿名化、沒有招生訪視（本模組上線前就已到場、開關關閉時
      到場，或招生訪視被刪掉）。依場次日期與開始時間新到舊；沒有場次的舊案用建立
      時間（台北時間）一起排。"""
    awaiting, awaiting_total = await _capped(
        db,
        select(VisitRequest, VisitSlot)
        .join(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
        .where(
            VisitRequest.campus_key == campus_key,
            status_groups.group_condition("past", now),
            VisitRequest.status.not_in(_DONE),
        ),
        VisitSlot.slot_date.desc(),
        VisitSlot.start_time.desc(),
        VisitRequest.created_at.desc(),
        VisitRequest.id.desc(),
    )
    linked = exists().where(RecruitmentVisit.visit_request_id == VisitRequest.id)
    # 場次的台北牆上時間；沒有場次用建立時間換成台北時間，兩者都是不帶時區的 timestamp。
    happened_at = func.coalesce(
        VisitSlot.slot_date + VisitSlot.start_time, func.timezone(OPERATING_TZ.key, VisitRequest.created_at)
    )
    missing, missing_total = await _capped(
        db,
        select(VisitRequest, VisitSlot)
        .outerjoin(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
        .where(
            VisitRequest.campus_key == campus_key,
            VisitRequest.status == VisitRequestStatus.COMPLETED.value,
            VisitRequest.anonymized_at.is_(None),
            ~linked,
        ),
        happened_at.desc(),
        VisitRequest.created_at.desc(),
        VisitRequest.id.desc(),
    )
    return {"awaiting": awaiting, "awaiting_total": awaiting_total, "missing": missing, "missing_total": missing_total}
