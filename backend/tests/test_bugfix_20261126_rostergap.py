"""2026-11-26 修正：缺額統計回算時，入學 (Y+1, 上) 的幼生也要依統計日期回算，不看現在的狀態
（規格 §6.3「每位幼生在 D 那天的狀態依日期回算」、§11「已退預繳的在退預繳日之前仍算預繳」）。
之前只收「現在還是預繳」的，之後退預繳或標已入園的，連回算到那之前的日期都從下學年預估消失。姓名一律虛構。"""

from __future__ import annotations

from datetime import date

from app.admissions.roster.calc import Facts, compute_gap
from tests.admissions_helpers import reception_yihua_client  # noqa: F401
from tests.roster_helpers import ROSTER, act, add_pending, add_students, make_class


async def get_roster(client, school_year: int, **params) -> dict:
    response = await client.get(ROSTER, params={"campus_key": "yihua", "school_year": school_year, **params})
    assert response.status_code == 200, response.text
    return response.json()


async def act_ok(client, student: dict, action: str, **body) -> dict:
    response = await act(client, student, action, **body)
    assert response.status_code == 200, response.text
    return response.json()


def only(grade: str, count: int) -> dict[str, int]:
    return {**{g: 0 for g in ("大班", "中班", "小班", "幼幼班")}, grade: count, "total": count}


async def test_refunded_next_intake_counts_before_refund_date(reception_yihua_client):
    client = reception_yihua_client
    nxt = await add_pending(client, "測試甲", grade="小班", target_school_year=116, target_semester=1)
    this_year = await add_pending(client, "測試乙", grade="小班", target_school_year=115, target_semester=2)
    for kid in (nxt, this_year):
        await act_ok(client, kid, "refund", refunded_date="2026-10-15")

    before = await get_roster(client, 115, as_of="2026-10-01")
    assert before["current"]["rows"]["pending_s2"]["小班"] == 1  # 對照組：本學年的退預繳本來就回算得對
    assert before["next"]["rows"]["pending_next"] == only("小班", 1)
    assert before["next"]["rows"]["estimate_next"]["小班"] == 1

    after = await get_roster(client, 115, as_of="2026-10-15")
    assert after["current"]["rows"]["pending_s2"]["小班"] == 0
    assert after["next"]["rows"]["pending_next"]["total"] == 0


async def test_entered_next_intake_counts_on_previous_year_page(reception_yihua_client):
    """115 學年 8 月入園、已標已入園的新生，回頭看 114 頁（統計日期夾到 2026-07-31）仍是下學年 8 月入園。"""
    client = reception_yihua_client
    room = await make_class(client, school_year=115, grade="中班")
    await add_students(client, room["id"], ["測試舊生"], school_year=115)  # 115 自己的在籍：不能算進 114 頁
    common = {
        "class_id": room["id"], "grade": "中班", "target_school_year": 115, "target_semester": 1, "deposit_date": "2026-03-01"
    }
    entered = await add_pending(client, "測試丙", **common)
    await add_pending(client, "測試丁", **common)
    await act_ok(client, entered, "enter", enrollment_date="2026-08-20")

    latest = await get_roster(client, 114)
    assert latest["as_of"] == "2026-07-31"
    assert latest["next"]["rows"]["pending_next"] == only("中班", 2)
    assert latest["current"]["rows"]["enrolled"]["total"] == 0
    assert (await get_roster(client, 114, as_of="2026-03-15"))["next"]["rows"]["pending_next"] == only("中班", 2)
    assert (await get_roster(client, 114, as_of="2026-02-15"))["next"]["rows"]["pending_next"]["total"] == 0


async def test_early_entry_into_next_year_class_stays_in_next_intake(reception_yihua_client):
    """排進 116 班的 (116, 上) 預繳生提早標已入園：115 頁的下學年預估不能少這一位，也不能算進 115 的在籍。"""
    client = reception_yihua_client
    room = await make_class(client, school_year=116, grade="小班")
    await add_students(client, room["id"], ["測試舊生"], school_year=116)  # 116 自己的在籍（沒有入學學期）：不算
    kid = await add_pending(
        client, "測試戊", class_id=room["id"], grade="小班", target_school_year=116, target_semester=1
    )
    assert (await get_roster(client, 115, as_of="2026-11-15"))["next"]["rows"]["pending_next"] == only("小班", 1)

    await act_ok(client, kid, "enter", enrollment_date="2026-11-20")
    after = await get_roster(client, 115, as_of="2026-11-21")
    assert after["next"]["rows"]["pending_next"] == only("小班", 1)
    assert after["next"]["rows"]["estimate_next"] == only("小班", 1)
    assert after["current"]["rows"]["enrolled"]["total"] == 0
    assert after["next_year"] == []  # 名單照現在的狀態：已入園的不在下學年預繳清單
    assert (await get_roster(client, 115, as_of="2026-11-15"))["next"]["rows"]["pending_next"] == only("小班", 1)


def test_compute_gap_puts_early_entered_next_intake_in_row_eight():
    early = Facts(
        grade="幼幼班",
        status="enrolled",
        enrollment_date=date(2026, 11, 20),
        deposit_date=date(2026, 9, 1),
        left_date=None,
        refunded_date=None,
        target_school_year=116,
        target_semester=1,
        birthday=date(2025, 1, 1),
        underage_manual=False,
        is_new_manual=False,
        next_year="continue",
    )
    gap = compute_gap([early], school_year=115, as_of=date(2026, 11, 21))
    assert gap.pending_next["幼幼班"] == 1 and gap.estimate_next["幼幼班"] == 1
    assert sum(gap.enrolled.values()) == 0 and sum(gap.promoted.values()) == 0
    assert (gap.underage_enrolled, gap.missing_birthday, gap.incomplete) == (0, 0, 0)
