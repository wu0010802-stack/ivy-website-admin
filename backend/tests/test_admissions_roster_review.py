"""最終審查發現的缺陷（2026-11-15）：每一條先紅後綠。姓名一律虛構。"""

from __future__ import annotations

from datetime import date

from tests.admissions_helpers import create_record, reception_yihua_client, transition  # noqa: F401
from tests.roster_helpers import ROSTER, act, add_pending, add_students, make_class, patch_student

WITHDRAW = dict(reason="家長改送他校", withdraw_reason_category="改讀其他私立幼兒園")


async def get_roster(client, school_year: int = 115, **params):
    return await client.get(ROSTER, params={"campus_key": "yihua", "school_year": school_year, **params})


async def test_restore_conflicts_with_recreated_funnel_student(reception_yihua_client):
    """C1：看板重新建了同一筆訪視的新預繳生之後，恢復舊的那位不能 500，要 409。"""
    record = await create_record(reception_yihua_client, child_name="測試甲")
    record = await transition(reception_yihua_client, record, "deposited")
    [old] = (await get_roster(reception_yihua_client)).json()["unassigned"]
    refunded = (await act(reception_yihua_client, old, "refund")).json()
    record = await transition(reception_yihua_client, record, "withdrawn", **WITHDRAW)
    await transition(reception_yihua_client, record, "deposited")  # 取消退出 → 看板重新建一位
    response = await act(reception_yihua_client, refunded, "restore")
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "ROSTER_VISIT_ALREADY_ACTIVE"


async def test_future_school_year_is_viewable(reception_yihua_client):
    """I1：還沒開始的學年（例如看板常選的下一學年）不能整頁 422。"""
    response = await get_roster(reception_yihua_client, 118)
    assert response.status_code == 200, response.text
    assert response.json()["as_of"] == "2029-08-01"
    assert (await get_roster(reception_yihua_client, 118, as_of="2029-08-02")).status_code == 422


async def test_refunded_next_year_student_is_listed_and_restorable(reception_yihua_client):
    """I1：在 115 頁把 116/8 月入園的預繳生退預繳，這位要出現在 115 頁的離園清單，才救得回來。"""
    kid = await add_pending(reception_yihua_client, "測試甲", target_school_year=116, target_semester=1, grade="小班")
    await act(reception_yihua_client, kid, "refund")
    gone = (await get_roster(reception_yihua_client)).json()["gone"]
    assert [s["child_name"] for s in gone] == ["測試甲"]
    refunded = gone[0]
    restored = await act(reception_yihua_client, refunded, "restore")
    assert restored.status_code == 200


async def test_planned_entry_date_sanity(reception_yihua_client):
    """I3：預定入園日打錯年份不能讓幼生消失到別的學年。"""
    kid = await add_pending(reception_yihua_client, "測試甲")  # 預繳日 2026-09-01，115 上
    early = await patch_student(reception_yihua_client, kid, planned_entry_date="2026-02-01")
    assert early.status_code == 422
    far = await patch_student(reception_yihua_client, kid, planned_entry_date="2028-02-01")
    assert far.status_code == 422
    ok = await patch_student(reception_yihua_client, kid, planned_entry_date="2027-08-15")  # 116 上
    assert ok.status_code == 200 and ok.json()["target_school_year"] == 116
    explicit = await patch_student(reception_yihua_client, ok.json(), target_school_year=119)
    assert explicit.status_code == 422


async def test_next_year_students_are_not_double_counted(reception_yihua_client):
    """I5：116 的在籍幼生不能算進 115 的缺額統計。"""
    now_room = await make_class(reception_yihua_client, grade="小班", school_year=115)
    later_room = await make_class(reception_yihua_client, grade="小班", school_year=116)
    await add_students(reception_yihua_client, now_room["id"], ["測試甲"])
    await add_students(reception_yihua_client, later_room["id"], ["測試乙"], school_year=116)
    body = (await get_roster(reception_yihua_client)).json()
    assert body["current"]["rows"]["enrolled"]["小班"] == 1
    assert body["current"]["rows"]["estimate"]["total"] == 1


async def test_past_school_year_default_as_of_is_year_end(reception_yihua_client, monkeypatch):
    """I5：學年結束後看那一學年，統計日期預設是學年最後一天，不能晚於它。"""
    from app.admissions.roster import service

    monkeypatch.setattr(service, "today_local", lambda: date(2027, 9, 1))
    body = (await get_roster(reception_yihua_client)).json()
    assert body["as_of"] == "2027-07-31" and body["today"] == "2027-09-01"
    assert (await get_roster(reception_yihua_client, as_of="2027-09-01")).status_code == 422
