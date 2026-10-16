"""退出原因分類的 migration 與約束（docs/specs/2026-10-15-withdraw-reason-category-design.md §3.1）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.admissions import constants
from app.admissions.models import RecruitmentVisit

BACKEND = Path(__file__).resolve().parents[1]
REVISION = "5c8e1f3a9d27"
# 實作當下 origin/main 的 head；合併前別的 migration 先進 main，就改這裡和 migration 的 down_revision。
DOWN_REVISION = "f2b8c4d1e7a9"
MIGRATION = BACKEND / "migrations" / "versions" / f"{REVISION}_withdraw_reason_category.py"
CATEGORY_CHECK = "ck_recruitment_visits_withdraw_reason_category"
WITHDRAWN_CHECK = "ck_recruitment_visits_withdraw_category_withdrawn"
CHECK_NAMES = (CATEGORY_CHECK, WITHDRAWN_CHECK)
NOW = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)


def _checks() -> dict[str, str]:
    return {c.name: str(c.sqltext) for c in RecruitmentVisit.__table__.constraints if isinstance(c, CheckConstraint)}


def _visit(**overrides) -> RecruitmentVisit:
    return RecruitmentVisit(
        id=uuid.uuid4(), campus_key="yihua", month="115.09", visit_date=date(2026, 9, 8), child_name="王小明",
        created_at=NOW, updated_at=NOW, **overrides,
    )


def test_categories_are_the_approved_eight():
    assert constants.WITHDRAW_REASON_CATEGORIES == (
        "抽中公幼／非營利", "改讀其他私立幼兒園", "搬家／距離因素", "費用考量",
        "家庭照顧安排改變", "孩子健康／適應因素", "課程／環境有疑慮", "未註明／聯絡不上",
    )
    assert max(len(value) for value in constants.WITHDRAW_REASON_CATEGORIES) <= constants.LEN_WITHDRAW_CATEGORY
    assert RecruitmentVisit.__table__.columns["withdraw_reason_category"].type.length == constants.LEN_WITHDRAW_CATEGORY
    assert constants.WITHDRAW_UNCLASSIFIED not in constants.WITHDRAW_REASON_CATEGORIES


def test_migration_follows_head_without_branching_and_keeps_data():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision(REVISION).down_revision == DOWN_REVISION
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只加可空欄位與約束，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


def test_check_conditions_are_identical_in_model_and_migration():
    source = MIGRATION.read_text(encoding="utf-8")
    checks = _checks()
    for name in CHECK_NAMES:
        assert f'"{name}"' in source, name
        assert f'"{checks[name]}"' in source, f"{name} 的條件與 migration 不一致：{checks[name]}"


@pytest.mark.asyncio
async def test_column_and_constraints_exist(db_session):
    names = set(
        (await db_session.execute(text("SELECT conname FROM pg_constraint WHERE conrelid = 'recruitment_visits'::regclass"))).scalars()
    )
    assert set(CHECK_NAMES) <= names
    column = (
        await db_session.execute(
            text(
                "SELECT data_type, character_maximum_length, is_nullable FROM information_schema.columns "
                "WHERE table_name = 'recruitment_visits' AND column_name = 'withdraw_reason_category'"
            )
        )
    ).one()
    assert tuple(column) == ("character varying", 40, "YES")


@pytest.mark.asyncio
async def test_database_accepts_valid_and_empty_categories(db_session):
    # 正向對照：八項分類的退出者、舊資料（已退出但沒分類）、一般進行中的訪視都能寫入。
    for category in constants.WITHDRAW_REASON_CATEGORIES:
        db_session.add(_visit(withdraw_reason_category=category, withdrawn_at=NOW, withdrawn_from="deposited"))
    db_session.add(_visit(withdrawn_at=NOW, withdrawn_from="enrolled"))
    db_session.add(_visit())
    await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_database_rejects_a_category_outside_the_list(db_session):
    # 這一筆已退出，唯一不合的是分類值，所以只可能是分類清單的 CHECK 擋下。
    db_session.add(_visit(withdraw_reason_category="其他", withdrawn_at=NOW, withdrawn_from="deposited"))
    with pytest.raises(IntegrityError) as blocked:
        await db_session.flush()
    await db_session.rollback()
    assert CATEGORY_CHECK in str(blocked.value.orig)
    assert WITHDRAWN_CHECK not in str(blocked.value.orig)


@pytest.mark.asyncio
async def test_database_rejects_a_category_on_a_visit_that_is_not_withdrawn(db_session):
    # 分類值在清單內，唯一不合的是沒有退出，所以只可能是「有分類就一定已退出」的 CHECK 擋下。
    db_session.add(_visit(withdraw_reason_category="費用考量"))
    with pytest.raises(IntegrityError) as blocked:
        await db_session.flush()
    await db_session.rollback()
    assert WITHDRAWN_CHECK in str(blocked.value.orig)
    assert CATEGORY_CHECK not in str(blocked.value.orig)
