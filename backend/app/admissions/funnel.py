"""招生漏斗（規格 6.2、6.3、10）：階段推導、狀態轉換、權限對照與看板。

- 階段不存欄位，一律由 withdrawn_at、enrolled、has_deposit 推導（園務
  services/recruitment_funnel.py derive_stage，「有學生檔」換成 enrolled 旗標）：
  Python 端用 derive_stage，SQL 端用 stage_condition，兩者規則相同。
- 轉換對照規格 6.3 的表（園務 api/recruitment/funnel.py:151-165、
  services/recruitment_funnel.py:235-580）。園務退註冊另要 STUDENTS_WRITE 並刪學生
  檔；官網沒有學生檔，只要 admissions.convert。預繳對帳警示與同名同生日檢查不移植。
- 本檔在模組層匯入 records（write_event、VersionConflict）；records 只在函式內
  匯入本檔的 stage_condition，也不匯入 schemas，所以沒有循環匯入。呼叫一律寫
  records.xxx，測試可以 monkeypatch。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, get_args

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants, records
from app.admissions.models import RecruitmentVisit
from app.common.timezones import today_local

Stage = Literal["visited", "deposited", "enrolled", "withdrawn"]
# 與 constants.STAGES 相同（tests/test_admissions_records.py 檢查）。
STAGE_VALUES: tuple[str, ...] = get_args(Stage)

# (起, 迄) → 需要的 capability；不在表裡的組合（含同階段）不允許。
_CAPABILITY: dict[tuple[str, str], str] = {
    ("visited", "deposited"): "admissions.write",
    ("deposited", "visited"): "admissions.write",
    ("deposited", "enrolled"): "admissions.convert",
    ("enrolled", "deposited"): "admissions.convert",
    ("enrolled", "visited"): "admissions.convert",
    ("deposited", "withdrawn"): "admissions.write",
    ("enrolled", "withdrawn"): "admissions.convert",
    ("withdrawn", "visited"): "admissions.write",
    ("withdrawn", "deposited"): "admissions.write",
}
# 原因必填：退出，以及從已註冊往前退（園務 is_destructive）。
_REASON_REQUIRED = {("enrolled", "deposited"), ("enrolled", "visited"), ("deposited", "withdrawn"), ("enrolled", "withdrawn")}


class TransitionNotAllowed(Exception):
    """規格 6.3 不允許的組合（路由回 422 TRANSITION_NOT_ALLOWED）。"""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class TransitionFieldsMissing(Exception):
    """這個轉換的必填欄位沒給（路由回 422 TRANSITION_FIELDS_REQUIRED）。"""

    def __init__(self, fields: list[str]) -> None:
        self.fields = fields
        super().__init__(fields)


def derive_stage(visit) -> Stage:
    """visit 可以是 RecruitmentVisit，也可以是任何有 withdrawn_at、enrolled、
    has_deposit 三個屬性的物件（RecruitmentVisitOut 的 stage 欄位也用這支）。"""
    if visit.withdrawn_at is not None:
        return "withdrawn"
    if visit.enrolled:
        return "enrolled"
    if visit.has_deposit:
        return "deposited"
    return "visited"


def stage_condition(stage: str):
    """與 derive_stage 相同規則的 SQL 條件；未知階段丟 ValueError。"""
    active = RecruitmentVisit.withdrawn_at.is_(None)
    if stage == "withdrawn":
        return RecruitmentVisit.withdrawn_at.is_not(None)
    if stage == "enrolled":
        return and_(active, RecruitmentVisit.enrolled.is_(True))
    if stage == "deposited":
        return and_(active, RecruitmentVisit.enrolled.is_(False), RecruitmentVisit.has_deposit.is_(True))
    if stage == "visited":
        return and_(active, RecruitmentVisit.enrolled.is_(False), RecruitmentVisit.has_deposit.is_(False))
    raise ValueError(f"未知的招生階段：{stage}")


def transition_capability(from_stage: str, to_stage: str) -> str | None:
    """None＝不允許；否則是 "admissions.write" 或 "admissions.convert"。"""
    return _CAPABILITY.get((from_stage, to_stage))


def not_allowed_reason(from_stage: str, to_stage: str) -> str:
    """不允許的轉換回給畫面的中文說明（visited→withdrawn 用園務原文）。"""
    if from_stage == to_stage:
        return f"已經在「{constants.STAGE_LABELS[to_stage]}」階段"
    if (from_stage, to_stage) == ("visited", "withdrawn"):
        return "已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」"
    if (from_stage, to_stage) == ("visited", "enrolled"):
        return "要先標記預繳，才能標記註冊"
    if (from_stage, to_stage) == ("withdrawn", "enrolled"):
        return "已退出的訪視要先取消退出、回到「已預繳」，才能再標記註冊"
    return f"不能從「{constants.STAGE_LABELS[from_stage]}」直接移到「{constants.STAGE_LABELS[to_stage]}」"


async def transition(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    to_stage: str,
    expected_version: int,
    actor_user_id: uuid.UUID | None,
    reason: str | None = None,
    deposit_collector: str | None = None,
    enrolled_on: date | None = None,
    grade: str | None = None,
    target_school_year: int | None = None,
    target_semester: int | None = None,
) -> Stage:
    """依規格 6.3 改狀態欄位並寫歷程；回傳轉換前的階段。呼叫前已用
    records.get_visit_for_update 鎖列，路由已檢查這個轉換的 capability。

    檢查都在改任何欄位之前做完：丟例外時訪視原封不動。
    - 標記註冊：年級沒給用保留座位的年級，入學學年學期沒給用訪視上的；給了就
      寫進 provisional_grade 與 target_*（註冊的年級為準，同園務以班級年級為準）。
      註冊日期沒給用台北今天。
    - 取消註冊、退註冊不動 provisional_grade：之後取消退出回已預繳，保留座位還在
      （Review Focus 4）。"""
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    from_stage = derive_stage(visit)
    if transition_capability(from_stage, to_stage) is None:
        raise TransitionNotAllowed(not_allowed_reason(from_stage, to_stage))
    reason = reason.strip() if reason and reason.strip() else None
    if (from_stage, to_stage) in _REASON_REQUIRED and reason is None:
        raise TransitionFieldsMissing(["reason"])
    if (from_stage, to_stage) == ("deposited", "enrolled"):
        seat_grade = grade or visit.provisional_grade
        school_year = target_school_year or visit.target_school_year
        missing = [name for name, value in (("grade", seat_grade), ("target_school_year", school_year)) if value is None]
        if missing:
            raise TransitionFieldsMissing(missing)
        semester = target_semester or visit.target_semester or 1

    now = datetime.now(timezone.utc)

    def event(event_type: str, start: str, end: str, *, metadata: dict | None = None, at: datetime | None = None) -> None:
        records.write_event(
            db, visit, event_type=event_type, from_stage=start, to_stage=end,
            actor_user_id=actor_user_id, reason=reason, metadata=metadata, created_at=at or now,
        )

    if (from_stage, to_stage) == ("visited", "deposited"):
        visit.has_deposit = True
        collector = (deposit_collector or "").strip()
        if collector:
            visit.deposit_collector = collector
        event("deposit_added", "visited", "deposited")
    elif (from_stage, to_stage) == ("deposited", "visited"):
        visit.has_deposit = False
        event("deposit_removed", "deposited", "visited")
    elif (from_stage, to_stage) == ("deposited", "enrolled"):
        visit.enrolled = True
        visit.enrolled_on = enrolled_on or today_local()
        visit.provisional_grade = seat_grade
        visit.target_school_year = school_year
        visit.target_semester = semester
        event(
            "converted", "deposited", "enrolled",
            metadata={"website_manual": True, "grade": seat_grade, "school_year": school_year, "semester": semester},
        )
    elif from_stage == "enrolled" and to_stage in ("deposited", "visited"):
        visit.enrolled = False
        visit.enrolled_on = None
        event("revert_converted", "enrolled", "deposited")
        if to_stage == "visited":
            visit.has_deposit = False
            # 同一個動作寫兩筆：第二筆晚一微秒，歷程排序固定（A 計畫調整第 3 條）。
            event("deposit_removed", "deposited", "visited", at=now + timedelta(microseconds=1))
    elif to_stage == "withdrawn":
        visit.enrolled = False
        visit.enrolled_on = None
        visit.has_deposit = False
        visit.withdrawn_at = now
        visit.withdrawn_from = from_stage
        visit.withdraw_reason = reason
        event("withdrawn", from_stage, "withdrawn")
    else:
        # 取消退出：withdrawn → visited／deposited（規格 6.3 最後一列）。
        visit.withdrawn_at = None
        visit.withdrawn_from = None
        visit.withdraw_reason = None
        visit.has_deposit = to_stage == "deposited"
        event("withdraw_cancelled", "withdrawn", to_stage)
    visit.version += 1
    visit.updated_at = now
    await db.flush()
    return from_stage


def _card(visit: RecruitmentVisit) -> dict:
    return {
        "id": visit.id,
        "child_name": visit.child_name,
        "grade": visit.grade,
        "provisional_grade": visit.provisional_grade,
        "target_school_year": visit.target_school_year,
        "target_semester": visit.target_semester,
        "visit_date": visit.visit_date,
        "has_visit_request": visit.visit_request_id is not None,
        "withdrawn_from": visit.withdrawn_from,
        "version": visit.version,
    }


async def board(db: AsyncSession, campus_key: str, school_year: int, semester: int | None) -> dict:
    """漏斗看板（規格 10；園務 GET /board）：以入學學年學期圈範圍，semester 為
    None 時是整學年。unscoped_count 是這一校沒填入學學年的訪視數，不受學年篩選
    影響（沒有它，空看板會像是「還沒有訪視」）。"""
    conditions = [RecruitmentVisit.campus_key == campus_key, RecruitmentVisit.target_school_year == school_year]
    if semester is not None:
        conditions.append(RecruitmentVisit.target_semester == semester)
    result = await db.execute(
        select(RecruitmentVisit)
        .where(*conditions)
        .order_by(RecruitmentVisit.visit_date.desc(), RecruitmentVisit.created_at.desc())
    )
    columns: dict[str, list[dict]] = {stage: [] for stage in STAGE_VALUES}
    for visit in result.scalars():
        columns[derive_stage(visit)].append(_card(visit))
    unscoped = await db.scalar(
        select(func.count())
        .select_from(RecruitmentVisit)
        .where(RecruitmentVisit.campus_key == campus_key, RecruitmentVisit.target_school_year.is_(None))
    )
    return {"columns": columns, "unscoped_count": int(unscoped or 0), "school_year": school_year, "semester": semester}
