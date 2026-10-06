"""招生訪視的建立、編輯、刪除、查詢、序號與歷程寫入（規格 5.1、5.2、6.1、6.6）。

只 flush、丟自訂例外；權限、稽核與 commit 在 routes.py。create_visit 也會在
「標記已到場」的交易內被 booking_link 呼叫：那條路徑的欄位已在
fields_from_visit_request 截斷並補好預設，也不帶帳號，這裡不做任何會丟例外的
資料檢查（帳號檢查只有帶了 tour_guide_user_id 才會發生）。

本檔不在模組層匯入 funnel 與 schemas：funnel 從 A4 起在模組層匯入本檔
（write_event、VersionConflict），反過來匯入會循環。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.auth.models import User
from app.common.timezones import today_local

# 篩選選項（來源、介紹者）各列幾個。
OPTION_LIMIT = 50

_Grade = Literal[constants.GRADES]
_FollowUpKind = Literal[constants.FOLLOW_UP_KINDS]
_Stage = Literal[constants.STAGES]
_NoDepositReason = Literal[constants.NO_DEPOSIT_REASONS]
_PRIORITY_OF = {reason: level for level, reasons in constants.NO_DEPOSIT_PRIORITY.items() for reason in reasons}


class RecordNotFound(Exception):
    """找不到這筆招生訪視。"""


class VersionConflict(Exception):
    """訪視剛被別人改過（編輯、狀態轉換、保留座位、刪除都比對 version）。"""

    def __init__(self, current_version: int) -> None:
        self.current_version = current_version
        super().__init__(current_version)


class TourGuideNotFound(Exception):
    """tour_guide_user_id 指到不存在的帳號（不擋的話外鍵錯誤會變成 500）。"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _lock_month(db: AsyncSession, campus_key: str, month: str) -> None:
    """同校同月份配號排隊（交易結束自動釋放）。"""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"recruitment_visits.seq:{campus_key}:{month}"},
    )


async def _next_seq_no(db: AsyncSession, campus_key: str, month: str) -> str:
    """同校同月份現有序號「開頭數字」的最大值＋1（園務 shared.next_seq_no；
    「60補」這類舊序號只認開頭數字）。呼叫前先 _lock_month。"""
    current = await db.scalar(
        text(
            "SELECT COALESCE(MAX(CAST(substring(seq_no FROM '^[0-9]+') AS BIGINT)), 0) "
            "FROM recruitment_visits WHERE campus_key = :campus_key AND month = :month"
        ),
        {"campus_key": campus_key, "month": month},
    )
    return str(int(current or 0) + 1)


async def _resolve_tour_guide(db: AsyncSession, values: dict) -> None:
    """有帶帳號就確認帳號存在（不存在丟 TourGuideNotFound）。沒給姓名時只用帳號的
    顯示名稱當快照（截到 LEN_TOUR_GUIDE）；沒設定顯示名稱就是 None，絕不用 Email。"""
    user_id = values.get("tour_guide_user_id")
    if user_id is None:
        return
    user = await db.get(User, user_id)
    if user is None:
        raise TourGuideNotFound()
    if not values.get("tour_guide_name"):
        # 只用顯示名稱；沒有就留空，不拿同事的 Email 當姓名快照（稽核也不寫 Email）。
        values["tour_guide_name"] = user.display_name[: constants.LEN_TOUR_GUIDE] if user.display_name else None


def write_event(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    event_type: str,
    from_stage: str | None,
    to_stage: str,
    actor_user_id: uuid.UUID | None,
    reason: str | None = None,
    metadata: dict | None = None,
    created_at: datetime | None = None,
) -> RecruitmentEventLog:
    """寫一筆招生歷程。created_at 只在同一個動作要寫兩筆、需要保證先後時傳入
    （取消註冊並取消預繳）。metadata 不放個資。"""
    event = RecruitmentEventLog(
        id=uuid.uuid4(),
        recruitment_visit_id=visit.id,
        event_type=event_type,
        from_stage=from_stage,
        to_stage=to_stage,
        reason=reason,
        actor_user_id=actor_user_id,
        metadata_json=metadata,
        created_at=created_at or _now(),
    )
    db.add(event)
    return event


async def create_visit(
    db: AsyncSession,
    *,
    campus_key: str,
    fields: dict,
    actor_user_id: uuid.UUID | None,
    origin: str,
    visit_request_id: uuid.UUID | None = None,
    today: date | None = None,
    follow_up_at: datetime | None = None,
    follow_up_owner_id: uuid.UUID | None = None,
) -> RecruitmentVisit:
    """建立一筆招生訪視並寫 created 事件（metadata {"origin": origin, "follow_up": ...}，
    origin 是 constants.ORIGINS 之一）。fields 的鍵是 RecruitmentVisitCreate 的欄位名；month
    由 visit_date 算、seq_no 在同校同月份鎖內配號；入學學年或學期缺值時補
    today（台北日期，預設今天）所在學期，同園務 records.py:232-237。

    追蹤欄位由呼叫端用 follow_up.initial_fields 算好傳入（2026-10-04 規格 6.1）：不自動排
    第一次聯絡，follow_up_at 只會是沿用預約的下次聯絡，所以 metadata 的 follow_up 是
    booking（有沿用）或 none。"""
    values = dict(fields)
    await _resolve_tour_guide(db, values)
    if values.get("target_school_year") is None or values.get("target_semester") is None:
        school_year, semester = academic.current_term(today or today_local())
        if values.get("target_school_year") is None:
            values["target_school_year"] = school_year
        if values.get("target_semester") is None:
            values["target_semester"] = semester
    rides_bus = bool(values.pop("rides_bus", False))
    transfer_term = bool(values.pop("transfer_term", False))
    month = academic.roc_month(values["visit_date"])
    await _lock_month(db, campus_key, month)
    seq_no = await _next_seq_no(db, campus_key, month)
    now = _now()
    visit = RecruitmentVisit(
        id=uuid.uuid4(),
        campus_key=campus_key,
        visit_request_id=visit_request_id,
        month=month,
        seq_no=seq_no,
        has_deposit=False,
        enrolled=False,
        rides_bus=rides_bus,
        transfer_term=transfer_term,
        version=1,
        created_at=now,
        updated_at=now,
        follow_up_at=follow_up_at,
        follow_up_owner_id=follow_up_owner_id,
        **values,
    )
    db.add(visit)
    await db.flush()
    write_event(
        db, visit, event_type="created", from_stage=None, to_stage="visited",
        actor_user_id=actor_user_id,
        metadata={"origin": origin, "follow_up": "booking" if follow_up_at is not None else "none"},
    )
    await db.flush()
    return visit


async def get_visit_for_update(db: AsyncSession, visit_id: uuid.UUID) -> RecruitmentVisit | None:
    """鎖住訪視列並讀資料庫的最新值（同一個 session 先前讀過也覆蓋）。"""
    stmt = (
        select(RecruitmentVisit)
        .where(RecruitmentVisit.id == visit_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


class TermLocked(Exception):
    """已註冊或保留座位的訪視不能從編輯表單改入學學年學期（路由回 409）。"""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


_TERM_FIELDS = ("target_school_year", "target_semester")


def _check_term_editable(visit: RecruitmentVisit, values: dict) -> None:
    """入學學年學期決定看板、統計與名額算在哪一學期。已註冊的要先取消註冊（同保留座位
    的規則），保留座位的要走 /seat（寫歷程、重算超額），不能從編輯表單直接搬。註冊時
    一定寫 provisional_grade；舊資料沒有時，年級也決定算在哪一班，一併鎖住。"""
    moved = [key for key in _TERM_FIELDS if key in values and values[key] != getattr(visit, key)]
    if visit.enrolled and visit.withdrawn_at is None:
        if visit.provisional_grade is None and "grade" in values and values["grade"] != visit.grade:
            moved.append("grade")
        if moved:
            raise TermLocked("RECRUITMENT_ENROLLED_TERM_LOCKED", "已註冊的訪視不能改入學學期或年級，要改請先取消註冊")
    elif moved and visit.provisional_grade is not None:
        raise TermLocked("RECRUITMENT_SEAT_TERM_LOCKED", "保留座位的訪視要改學期，請用「變更座位」調整")


async def update_visit(
    db: AsyncSession, visit: RecruitmentVisit, *, changes: dict, expected_version: int
) -> list[str]:
    """改表單欄位（呼叫前已 get_visit_for_update）。changes 只含請求有送的欄位；
    回傳值真的有變的欄位名（沒變就不加版本）。參觀日期換到別的月份時，月份
    跟著換，並在新月份重新配號（舊序號在新月份可能已被用掉）。"""
    if visit.version != expected_version:
        raise VersionConflict(visit.version)
    values = dict(changes)
    _check_term_editable(visit, values)
    if values.get("tour_guide_user_id") is not None and values["tour_guide_user_id"] != visit.tour_guide_user_id:
        await _resolve_tour_guide(db, values)
    changed = [key for key, value in values.items() if getattr(visit, key) != value]
    if not changed:
        return []
    for key in changed:
        setattr(visit, key, values[key])
    if "visit_date" in changed:
        month = academic.roc_month(visit.visit_date)
        if month != visit.month:
            await _lock_month(db, visit.campus_key, month)
            # 先算新序號再一起改：先改 month 的話，查詢前的 autoflush 會把舊序號寫進新月份。
            seq_no = await _next_seq_no(db, visit.campus_key, month)
            visit.month, visit.seq_no = month, seq_no
    visit.version += 1
    visit.updated_at = _now()
    await db.flush()
    return changed


async def delete_visit(db: AsyncSession, visit: RecruitmentVisit, *, expected_version: int) -> None:
    """刪除訪視；歷程由資料庫 ON DELETE CASCADE 一併刪除（同園務）。"""
    if visit.version != expected_version:
        raise VersionConflict(visit.version)
    await db.delete(visit)
    await db.flush()


class RecruitmentVisitFilters:
    """訪視明細的篩選（規格 10「訪視明細」；園務 records.py GET /records）。路由用
    Depends() 帶入；權限在路由檢查。"""

    def __init__(
        self,
        campus_key: str,
        month: str | None = Query(default=None, pattern=academic.ROC_MONTH_RE.pattern, description="民國月份，例：115.09"),
        grade: _Grade | None = Query(default=None, description="適讀班級"),
        target_school_year: int | None = Query(
            default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX, description="入學學年（民國）"
        ),
        target_semester: int | None = Query(default=None, ge=1, le=2, description="入學學期：1 上、2 下"),
        source: str | None = Query(default=None, max_length=constants.LEN_SOURCE),
        referrer: str | None = Query(default=None, max_length=constants.LEN_REFERRER),
        has_deposit: bool | None = Query(default=None),
        no_deposit_reason: _NoDepositReason | None = Query(default=None),
        stage: _Stage | None = Query(default=None, description="漏斗階段（由狀態欄位推導）"),
        visit_request_id: uuid.UUID | None = Query(default=None, description="連結的官網預約"),
        q: str | None = Query(default=None, max_length=100, description="幼生姓名、聯絡人、電話、地址、備註、電訪回應"),
        follow_up: _FollowUpKind | None = Query(
            default=None, description="追蹤狀態：due 已到期、upcoming 7 天內、unscheduled 未排定（2026-10-04 規格 6.2）"
        ),
        owner: str | None = Query(
            default=None, pattern=constants.OWNER_FILTER_PATTERN, description="追蹤負責人：me、none 或帳號 id"
        ),
    ) -> None:
        self.campus_key = campus_key
        self.month = month
        self.grade = grade
        self.target_school_year = target_school_year
        self.target_semester = target_semester
        self.source = source
        self.referrer = referrer
        self.has_deposit = has_deposit
        self.no_deposit_reason = no_deposit_reason
        self.stage = stage
        self.visit_request_id = visit_request_id
        self.q = q.strip() if q and q.strip() else None
        self.follow_up = follow_up
        self.owner = owner

    def apply(self, stmt, *, current_user_id: uuid.UUID | None = None):
        """current_user_id 給 owner=me 用（路由傳入目前登入的帳號）。"""
        from app.admissions import follow_up
        from app.admissions.funnel import stage_condition

        stmt = stmt.where(RecruitmentVisit.campus_key == self.campus_key)
        if self.month:
            stmt = stmt.where(RecruitmentVisit.month == self.month)
        if self.grade:
            stmt = stmt.where(RecruitmentVisit.grade == self.grade)
        if self.target_school_year is not None:
            stmt = stmt.where(RecruitmentVisit.target_school_year == self.target_school_year)
        if self.target_semester is not None:
            stmt = stmt.where(RecruitmentVisit.target_semester == self.target_semester)
        if self.source:
            stmt = stmt.where(RecruitmentVisit.source == self.source)
        if self.referrer:
            stmt = stmt.where(RecruitmentVisit.referrer == self.referrer)
        if self.has_deposit is not None:
            stmt = stmt.where(RecruitmentVisit.has_deposit.is_(self.has_deposit))
            # 「預繳：否」＝統計的未預繳（stats.py 同口徑，2026-10-06）：退預繳／退註冊會清
            # has_deposit，不排除的話明細會比統計多出已退出的。
            if not self.has_deposit:
                stmt = stmt.where(RecruitmentVisit.withdrawn_at.is_(None))
        if self.no_deposit_reason:
            stmt = stmt.where(RecruitmentVisit.no_deposit_reason == self.no_deposit_reason)
        if self.stage:
            stmt = stmt.where(stage_condition(self.stage))
        if self.visit_request_id is not None:
            stmt = stmt.where(RecruitmentVisit.visit_request_id == self.visit_request_id)
        if self.follow_up:
            stmt = stmt.where(follow_up.condition(self.follow_up))
        if self.owner is not None and (self.owner != "me" or current_user_id is not None):
            stmt = stmt.where(follow_up.owner_condition(self.owner, current_user_id))
        if self.q:
            # 使用者打的 % 與 _ 是字面值（同 booking 的 VisitRequestFilters）。
            needle = self.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{needle}%"
            stmt = stmt.where(
                or_(
                    RecruitmentVisit.child_name.ilike(pattern, escape="\\"),
                    RecruitmentVisit.english_name.ilike(pattern, escape="\\"),
                    RecruitmentVisit.contact_name.ilike(pattern, escape="\\"),
                    RecruitmentVisit.phone.like(pattern, escape="\\"),
                    RecruitmentVisit.address.ilike(pattern, escape="\\"),
                    RecruitmentVisit.notes.ilike(pattern, escape="\\"),
                    RecruitmentVisit.parent_response.ilike(pattern, escape="\\"),
                )
            )
        return stmt


async def _top_values(db: AsyncSession, campus_key: str, column) -> list[str]:
    """該校用過的值，次數多的在前，同次數依字排。"""
    result = await db.execute(
        select(column)
        .where(RecruitmentVisit.campus_key == campus_key, column.is_not(None))
        .group_by(column)
        .order_by(func.count().desc(), column)
        .limit(OPTION_LIMIT)
    )
    return list(result.scalars())


async def options(db: AsyncSession, campus_key: str) -> dict:
    """GET /admin/admissions/options 的內容（AdmissionsOptionsOut）。"""
    months = await db.execute(
        select(RecruitmentVisit.month)
        .where(RecruitmentVisit.campus_key == campus_key)
        .distinct()
        .order_by(RecruitmentVisit.month.desc())
    )
    return {
        "months": list(months.scalars()),
        "sources": await _top_values(db, campus_key, RecruitmentVisit.source),
        "referrers": await _top_values(db, campus_key, RecruitmentVisit.referrer),
        "tour_guides": await _top_values(db, campus_key, RecruitmentVisit.tour_guide_name),
        "grades": list(constants.GRADES),
        "no_deposit_reasons": [
            {"value": reason, "priority": _PRIORITY_OF.get(reason)} for reason in constants.NO_DEPOSIT_REASONS
        ],
        "source_categories": dict(constants.SOURCE_CATEGORIES),
        "contact_channels": dict(constants.CONTACT_CHANNELS),
    }
