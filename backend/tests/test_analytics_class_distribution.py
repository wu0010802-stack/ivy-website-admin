"""預約孩子的班別（招生分析階段 1 第 3 項，E05、E06）：用招生入學同一個換算
（admissions/academic.grade_for_birthday）與共用案例；缺生日、已匿名化算「沒有生日
資料」，範圍外另列，不猜班別。"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from tests.analytics_fixtures import add_case, taipei

URL = "/api/website/v1/admin/analytics/class-distribution"
CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "grade-cases.json").read_text(encoding="utf-8")
)["cases"]


async def _get(client, query: str) -> dict:
    response = await client.get(f"{URL}?{query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
async def test_shared_grade_cases(admin_client, db_session, case):
    await add_case(db_session, child_birthdate=date.fromisoformat(case["birthday"]))
    await db_session.commit()
    body = await _get(admin_client, f"campus_key=yihua&school_year={case['expected_term'][0]}")
    grades = {row["grade"]: row["count"] for row in body["grades"]}
    if case["expected_grade"] is None:
        assert body["out_of_range"] == 1
        assert sum(grades.values()) == 0
    else:
        assert grades[case["expected_grade"]] == 1
        assert body["out_of_range"] == 0
    assert body["total"] == 1 and body["unrecorded"] == 0


@pytest.mark.asyncio
async def test_missing_or_anonymized_birthdays_are_unrecorded(admin_client, db_session):
    await add_case(db_session, child_birthdate=None)
    await add_case(db_session, child_birthdate=None, anonymized=True)  # 匿名化會清掉生日
    await add_case(db_session, child_birthdate=date(2023, 9, 1), status="cancelled", cancel_reason="parent")
    await db_session.commit()
    body = await _get(admin_client, "campus_key=yihua&school_year=115")
    assert [row["grade"] for row in body["grades"]] == ["幼幼班", "小班", "中班", "大班"]
    assert body["unrecorded"] == 2
    assert {row["grade"]: row["count"] for row in body["grades"]}["小班"] == 1  # 已取消也算
    assert body["total"] == 3
    assert body["unit"] == "visit_request" and body["school_year"] == 115


@pytest.mark.asyncio
async def test_period_scope_and_school_year_bounds(admin_client, minghua_client, db_session):
    await add_case(db_session, child_birthdate=date(2023, 9, 1), created_at=taipei(date(2026, 9, 1)))
    await add_case(db_session, child_birthdate=date(2023, 9, 1), created_at=taipei(date(2026, 10, 1)))
    await db_session.commit()
    body = await _get(admin_client, "campus_key=yihua&school_year=115&from=2026-10-01&to=2026-10-31")
    assert body["total"] == 1
    assert (await minghua_client.get(f"{URL}?campus_key=yihua&school_year=115")).status_code == 404
    assert (await admin_client.get(f"{URL}?campus_key=yihua&school_year=99")).status_code == 422
