"""招生漏斗：階段推導（規格 6.2）。A4 在這個檔加狀態轉換、權限對照與看板。

階段不存欄位，一律由 withdrawn_at、enrolled、has_deposit 推導（園務
services/recruitment_funnel.py derive_stage，「有學生檔」換成 enrolled 旗標）：
Python 端用 derive_stage，SQL 端用 stage_condition，兩者規則相同。

records.py 在函式內匯入 stage_condition：本檔 A4 起在模組層匯入 records.write_event，
records 若也在模組層匯入本檔會循環匯入。"""

from __future__ import annotations

from typing import Literal, get_args

from sqlalchemy import and_

from app.admissions.models import RecruitmentVisit

Stage = Literal["visited", "deposited", "enrolled", "withdrawn"]
# 與 constants.STAGES 相同（tests/test_admissions_records.py 檢查）。
STAGE_VALUES: tuple[str, ...] = get_args(Stage)


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
