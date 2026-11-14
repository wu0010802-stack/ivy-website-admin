"""看板 → 編班表的單向同步，以及看板後續異動的提醒（2026-11-14 規格 §7）。

編班表的動作從不寫 recruitment_visits；看板這邊只有一個入口：funnel.transition 轉成
「已預繳」時呼叫 on_stage_changed，在同一個交易裡替它新增（或認領）一位預繳未入園的幼生。
提醒（board_notice）是讀取時比對，不存狀態。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.academic import current_term
from app.admissions.models import RecruitmentVisit
from app.admissions.roster.models import RosterStudent

# 這兩種轉換才會新增：已訪視→已預繳，以及取消退出回已預繳。取消註冊（已註冊→已預繳）不觸發。
_TRIGGER_FROM = ("visited", "withdrawn")


async def on_stage_changed(
    db: AsyncSession, visit: RecruitmentVisit, *, from_stage: str, to_stage: str, today: date
) -> None:
    if to_stage != "deposited" or from_stage not in _TRIGGER_FROM:
        return
    active = await db.scalar(
        select(RosterStudent.id)
        .where(RosterStudent.recruitment_visit_id == visit.id, RosterStudent.status.in_(("pending", "enrolled")))
        .limit(1)
    )
    if active is not None:
        return
    if await _claim_backfilled(db, visit):
        return
    school_year = visit.target_school_year if visit.target_school_year is not None else current_term(today)[0]
    now = datetime.now(timezone.utc)
    student = RosterStudent(
        id=uuid.uuid4(),
        campus_key=visit.campus_key,
        school_year=school_year,
        grade=visit.provisional_grade or visit.grade,
        child_name=visit.child_name,
        birthday=visit.birthday,
        status="pending",
        deposit_date=today,
        target_school_year=visit.target_school_year,
        target_semester=visit.target_semester,
        is_special_education=False,
        is_indigenous=False,
        is_new_manual=False,
        underage_manual=False,
        next_year="continue",
        recruitment_visit_id=visit.id,
        from_funnel=True,
        version=1,
        created_at=now,
        updated_at=now,
    )
    # 兩個請求同時轉預繳時，部分唯一索引會擋掉第二筆；用 savepoint 吞掉，不拖垮看板的轉換。
    try:
        async with db.begin_nested():
            db.add(student)
    except IntegrityError:
        return


async def _claim_backfilled(db: AsyncSession, visit: RecruitmentVisit) -> bool:
    """同校、同姓名、還沒掛看板紀錄的補登預繳生剛好一位，而且兩邊生日沒有互相矛盾：掛上去、補生日。"""
    candidates = list(
        await db.scalars(
            select(RosterStudent)
            .where(
                RosterStudent.campus_key == visit.campus_key,
                RosterStudent.child_name == visit.child_name,
                RosterStudent.recruitment_visit_id.is_(None),
                RosterStudent.from_funnel.is_(False),
                RosterStudent.status == "pending",
            )
            .with_for_update()
            .limit(2)
        )
    )
    if len(candidates) != 1:
        return False
    student = candidates[0]
    if student.birthday is not None and visit.birthday is not None and student.birthday != visit.birthday:
        return False
    student.recruitment_visit_id = visit.id
    student.from_funnel = True
    if student.birthday is None:
        student.birthday = visit.birthday
    student.updated_at = datetime.now(timezone.utc)
    return True


async def board_notices(db: AsyncSession, students: list[RosterStudent]) -> dict[uuid.UUID, str]:
    """來自看板、還是預繳未入園的幼生：看板已退預繳、退回已訪視或被刪 → deposit_removed；
    看板已註冊 → enrolled；其餘沒有提醒。"""
    from app.admissions.funnel import derive_stage  # 函式內匯入：funnel 在模組層匯入本檔

    watched = [s for s in students if s.from_funnel and s.status == "pending"]
    if not watched:
        return {}
    visit_ids = {s.recruitment_visit_id for s in watched if s.recruitment_visit_id is not None}
    stages: dict[uuid.UUID, str] = {}
    if visit_ids:
        rows = await db.execute(
            select(
                RecruitmentVisit.id, RecruitmentVisit.withdrawn_at, RecruitmentVisit.enrolled, RecruitmentVisit.has_deposit
            ).where(RecruitmentVisit.id.in_(visit_ids))
        )
        stages = {row.id: derive_stage(row) for row in rows}
    notices: dict[uuid.UUID, str] = {}
    for student in watched:
        stage = stages.get(student.recruitment_visit_id) if student.recruitment_visit_id else None
        if stage is None or stage in ("visited", "withdrawn"):
            notices[student.id] = "deposit_removed"
        elif stage == "enrolled":
            notices[student.id] = "enrolled"
    return notices
