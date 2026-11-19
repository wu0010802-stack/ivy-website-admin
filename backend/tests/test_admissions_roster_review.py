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


# ---- 延後小項的第二輪（2026-11-15）----

from datetime import datetime, timedelta, timezone  # noqa: E402
import asyncio  # noqa: E402
import uuid  # noqa: E402

from app.admissions.roster import service  # noqa: E402
from app.admissions.roster.calc import Facts, compute_gap  # noqa: E402
from app.admissions.roster.models import RosterStudent  # noqa: E402
from app.common.timezones import today_local  # noqa: E402
from tests.admissions_helpers import campus_admin_yihua_client  # noqa: E402,F401


async def test_claiming_backfilled_student_bumps_version(reception_yihua_client):
    backfilled = await add_pending(reception_yihua_client, "測試甲", grade="小班")
    record = await create_record(reception_yihua_client, child_name="測試甲", birthday="2023-03-02")
    await transition(reception_yihua_client, record, "deposited")
    [claimed] = (await get_roster(reception_yihua_client)).json()["unassigned"]
    assert claimed["id"] == backfilled["id"] and claimed["version"] == backfilled["version"] + 1
    stale = await patch_student(reception_yihua_client, backfilled, birthday="2020-01-01")
    assert stale.status_code == 409  # 先前開著的編輯框不會悄悄蓋掉看板補上的生日


async def test_first_tier_targets_saved_concurrently(admin_client, campus_admin_yihua_client, monkeypatch):
    """兩人同時第一次設定同一組三段目標：不能 500（主鍵撞到）。"""
    original = service._tier_row

    async def slow(*args, **kwargs):
        row = await original(*args, **kwargs)
        await asyncio.sleep(0.3)
        return row

    monkeypatch.setattr(service, "_tier_row", slow)
    body = {"school_year": 115, "semester": 2, "base": 10, "boost": 20, "top": 30}
    first, second = await asyncio.gather(
        admin_client.put(f"{ROSTER}/tier-targets?campus_key=yihua", json=body),
        campus_admin_yihua_client.put(f"{ROSTER}/tier-targets?campus_key=yihua", json={**body, "base": 11}),
    )
    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)


async def test_note_edit_survives_concurrent_drag(reception_yihua_client, db_session):
    """只改備註不需要比對班級：lock_student 可以略過「還在原班」的檢查。"""
    room = await make_class(reception_yihua_client)
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試甲"])
    student, _ = await service.lock_student(db_session, uuid.UUID(kid["id"]), set(), None, check_class=False)
    assert student is not None and student.class_id == uuid.UUID(room["id"])
    await db_session.rollback()


async def test_dates_cannot_be_in_the_future_or_out_of_order(reception_yihua_client):
    tomorrow = (today_local() + timedelta(days=1)).isoformat()
    future_deposit = await reception_yihua_client.post(
        f"{ROSTER}/students?campus_key=yihua",
        json={"school_year": 115, "names": ["測試甲"], "pending": {"grade": "小班", "target_school_year": 115, "target_semester": 1, "deposit_date": tomorrow}},
    )
    assert future_deposit.status_code == 422
    room = await make_class(reception_yihua_client)
    [kid] = await add_students(reception_yihua_client, room["id"], ["測試乙"])
    assert (await patch_student(reception_yihua_client, kid, enrollment_date=tomorrow)).status_code == 422
    entered = (await patch_student(reception_yihua_client, kid, enrollment_date="2026-10-05")).json()
    early_leave = await act(reception_yihua_client, entered, "leave", left_date="2026-10-01")
    assert early_leave.status_code == 422
    assert early_leave.json()["detail"]["code"] == "ROSTER_DATE_ORDER"
    pending = await add_pending(reception_yihua_client, "測試丙", deposit_date="2026-09-10")
    early_refund = await act(reception_yihua_client, pending, "refund", refunded_date="2026-09-01")
    assert early_refund.status_code == 422 and early_refund.json()["detail"]["code"] == "ROSTER_DATE_ORDER"
    assert (await patch_student(reception_yihua_client, pending, deposit_date=tomorrow)).status_code == 422


def test_manually_underage_without_birthday_is_not_counted_as_missing():
    """「沒填生日，暫時算可以升小班」只該數真的被算成可以升小班的人。"""
    def toddler(**kw):
        values = dict(grade="幼幼班", status="enrolled", enrollment_date=None, deposit_date=None, left_date=None, refunded_date=None,
                      target_school_year=None, target_semester=None, birthday=None, underage_manual=False, is_new_manual=False, next_year="continue")
        values.update(kw)
        return Facts(**values)

    gap = compute_gap([toddler(), toddler(underage_manual=True)], school_year=115, as_of=date(2026, 11, 11))
    assert gap.missing_birthday == 1 and gap.underage_enrolled == 1
