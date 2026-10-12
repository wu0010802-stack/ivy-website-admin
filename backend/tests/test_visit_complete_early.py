"""提早完成參觀（2026-10-12 使用者裁定）：家長比預約的場次早來。

- /complete 照舊要等場次開始（誤按會永久占住未來場次的名額）。
- /complete-early 只給場次還沒開始的案件：約的是今天就保留場次；約的是之後的
  日子就釋出那一場的名額（案件不再掛場次），參觀日期記今天，原場次留在歷程。
- 場次已經開始才按，就是一般的標記已到場。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import select, update

from app.admissions.models import RecruitmentVisit
from app.booking import workflow_service
from app.booking.models import VisitRequestEvent, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.operations.models import AuditLogEntry
from tests.conftest import legacy_request, set_booking_mode, start_visit_slot


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"


async def _slot(client, *, days_ahead=3, start="10:00:00", end="11:00:00", capacity=1) -> dict:
    response = await client.post(
        f"{BASE}/slots?campus_key=yihua",
        json={
            "slot_date": (today_local() + timedelta(days=days_ahead)).isoformat(),
            "start_time": start,
            "end_time": end,
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _manual(client, key: str, *, slot_id: str, parent_name="王媽媽"):
    """櫃台補登（電話）：一定要選場次，送出即確認。"""
    return await client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": parent_name, "phone": "0912345678",
              "consent_given": True, "slot_id": slot_id},
        headers={"Idempotency-Key": key},
    )


async def _case(client, key: str, *, slot_id: str) -> str:
    created = await _manual(client, key, slot_id=slot_id)
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "confirmed"
    return created.json()["id"]


async def _completed_event(client, case_id: str) -> dict:
    detail = await client.get(f"{BASE}/visit-requests/{case_id}")
    assert detail.status_code == 200, detail.text
    return next(e for e in detail.json()["history"] if e["event_type"] == "completed")


async def _audit_actions(db_session, case_id: str) -> list[AuditLogEntry]:
    rows = await db_session.execute(
        select(AuditLogEntry).where(
            AuditLogEntry.target_id == case_id,
            AuditLogEntry.action.in_(["visit_request.complete", "visit_request.complete_early"]),
        )
    )
    return list(rows.scalars().all())


async def _recruitment_visit(db_session, case_id: str) -> RecruitmentVisit:
    db_session.expire_all()
    visit = await db_session.scalar(select(RecruitmentVisit).where(RecruitmentVisit.visit_request_id == case_id))
    assert visit is not None
    return visit


@pytest.mark.asyncio
async def test_plain_complete_still_waits_for_the_slot_to_start(admin_client):
    slot = await _slot(admin_client, days_ahead=3)
    case_id = await _case(admin_client, "early-plain", slot_id=slot["id"])

    early = await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete")
    assert early.status_code == 409
    assert early.json()["detail"]["code"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_early_on_an_earlier_day_releases_the_seat_and_visits_today(admin_client, db_session):
    slot = await _slot(admin_client, days_ahead=3, capacity=1)
    case_id = await _case(admin_client, "early-release", slot_id=slot["id"])

    done = await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete-early")
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "completed"
    assert done.json()["slot_id"] is None
    assert done.json()["slot"] is None

    # 名額釋出：那一場又能排別人（容量只有 1）。
    day = slot["slot_date"]
    listed = await admin_client.get(f"{BASE}/slots?campus_key=yihua&date_from={day}&date_to={day}")
    assert listed.json()[0]["booked_count"] == 0
    other = await _manual(admin_client, "early-release-other", slot_id=slot["id"], parent_name="林爸爸")
    assert other.status_code == 201, other.text

    # 歷程留下原本約的場次（時間線顯示「釋出 …」）。
    event = await _completed_event(admin_client, case_id)
    assert event["before"]["status"] == "confirmed"
    assert event["before"]["slot"]["id"] == slot["id"]
    assert event["after"] == {"status": "completed", "slot": None, "early": True}

    [audit] = await _audit_actions(db_session, case_id)
    assert audit.action == "visit_request.complete_early"
    assert audit.metadata_json == {"from_status": "confirmed", "to_status": "completed"}

    # 招生訪視的參觀日期是今天，不是原本約的日子。
    assert (await _recruitment_visit(db_session, case_id)).visit_date == today_local()


@pytest.mark.asyncio
async def test_early_on_the_same_day_keeps_the_slot(admin_client, db_session, monkeypatch):
    """約今天、比場次早到：名額本來就是給這組家長的，場次保留（接待月曆那一場照樣看得到）。
    場次要是未來的才建得起來，所以把「今天」挪到場次那天。"""
    slot = await _slot(admin_client, days_ahead=2, capacity=1)
    case_id = await _case(admin_client, "early-same-day", slot_id=slot["id"])
    slot_day = date.fromisoformat(slot["slot_date"])
    monkeypatch.setattr(workflow_service, "today_local", lambda: slot_day)

    done = await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete-early")
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "completed"
    assert done.json()["slot_id"] == slot["id"]

    listed = await admin_client.get(f"{BASE}/slots?campus_key=yihua&date_from={slot_day}&date_to={slot_day}")
    assert listed.json()[0]["booked_count"] == 1
    event = await _completed_event(admin_client, case_id)
    assert event["after"] == {"status": "completed", "early": True}
    [audit] = await _audit_actions(db_session, case_id)
    assert audit.action == "visit_request.complete_early"
    assert (await _recruitment_visit(db_session, case_id)).visit_date == slot_day


@pytest.mark.asyncio
async def test_early_after_the_slot_started_is_a_plain_arrival(admin_client, db_session):
    """畫面每 30 秒重算，場次剛開始時頁面上可能還是「家長提早到了」：當成一般的標記已到場。"""
    slot = await _slot(admin_client, days_ahead=3)
    case_id = await _case(admin_client, "early-started", slot_id=slot["id"])
    await start_visit_slot(db_session, case_id)

    done = await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete-early")
    assert done.status_code == 200, done.text
    assert done.json()["slot_id"] == slot["id"]
    event = await _completed_event(admin_client, case_id)
    assert event["after"] == {"status": "completed"}
    [audit] = await _audit_actions(db_session, case_id)
    assert audit.action == "visit_request.complete"


@pytest.mark.asyncio
@pytest.mark.parametrize("closed_status", ["cancelled", "no_show", "completed"])
async def test_early_only_for_confirmed_cases(admin_client, db_session, closed_status):
    case_id = await legacy_request(db_session, status=closed_status)
    response = await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete-early")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "INVALID_TRANSITION"
    assert await _audit_actions(db_session, case_id) == []


@pytest.mark.asyncio
async def test_early_needs_booking_handle(admin_client, editor_client):
    slot = await _slot(admin_client, days_ahead=3)
    case_id = await _case(admin_client, "early-editor", slot_id=slot["id"])
    response = await editor_client.post(f"{BASE}/visit-requests/{case_id}/complete-early")
    assert response.status_code in (403, 404)
    detail = await admin_client.get(f"{BASE}/visit-requests/{case_id}")
    assert detail.json()["status"] == "confirmed"


@pytest.mark.asyncio
async def test_list_shows_visited_on_and_sorts_early_completed_by_that_day(admin_client, db_session):
    """提早完成釋出場次後案件沒有場次：列表的 visited_on 是完成當天（台北日期），
    visit_asc／visit_desc 依這一天排，不再整批掉到最後。同一天內有場次的在前，沒有場次的在後。"""
    today = today_local()
    done = {}
    for key, days in (("past", 3), ("same_day", 6), ("early", 5), ("future", 4)):
        slot = await _slot(admin_client, days_ahead=days, start="10:00:00", end="11:00:00")
        done[key] = (await _case(admin_client, f"visited-on-{key}", slot_id=slot["id"]), slot)

    # 正常場次的兩筆：一筆在昨天、一筆在今天 00:00（場次已開始才能標記到場）。
    await start_visit_slot(db_session, done["past"][0])
    await db_session.execute(
        update(VisitSlot).where(VisitSlot.id == done["same_day"][1]["id"]).values(slot_date=today, start_time=time(0, 0), end_time=time(0, 30))
    )
    await db_session.commit()
    for key in ("past", "same_day"):
        assert (await admin_client.post(f"{BASE}/visit-requests/{done[key][0]}/complete")).status_code == 200
    # 另一筆約之後的日子，今天提早到：釋出場次、沒有場次。
    assert (await admin_client.post(f"{BASE}/visit-requests/{done['early'][0]}/complete-early")).status_code == 200

    ids = {key: case_id for key, (case_id, _) in done.items()}

    async def listed(order: str) -> list[dict]:
        response = await admin_client.get(f"{BASE}/visit-requests", params={"order": order})
        assert response.status_code == 200, response.text
        return response.json()

    asc = await listed("visit_asc")
    rows = {row["id"]: row for row in asc}
    # 沒有場次的提早完成：visited_on 是今天。有場次的：就是場次日期（含還沒到的）。
    assert rows[ids["early"]]["slot"] is None
    assert rows[ids["early"]]["visited_on"] == today.isoformat()
    assert rows[ids["past"]]["visited_on"] == (today - timedelta(days=1)).isoformat()
    assert rows[ids["same_day"]]["visited_on"] == today.isoformat()
    assert rows[ids["future"]]["visited_on"] == done["future"][1]["slot_date"]

    order = [ids["past"], ids["same_day"], ids["early"], ids["future"]]
    assert [r["id"] for r in asc if r["id"] in order] == order
    # 遞減：日期由新到舊；同一天有場次的仍在沒有場次的前面。
    desc = await listed("visit_desc")
    assert [r["id"] for r in desc if r["id"] in order] == [ids["future"], ids["same_day"], ids["early"], ids["past"]]

    # 沒有場次、也不是已完成的案件（舊案取消）：visited_on 是 None，排在最後。
    legacy = await legacy_request(db_session, status="cancelled", parent_name="沒有場次")
    await db_session.commit()
    for direction in ("visit_asc", "visit_desc"):
        last = (await listed(direction))[-1]
        assert last["id"] == legacy and last["visited_on"] is None


@pytest.mark.asyncio
async def test_visited_on_is_the_taipei_day_of_the_last_completed_event(admin_client, db_session):
    """沒有場次的已完成案件取最後一筆 completed 歷程的台北日期：台北隔天凌晨完成的案件（UTC 還是前一天）算台北那天。"""
    slot = await _slot(admin_client, days_ahead=3)
    case_id = await _case(admin_client, "visited-on-tz", slot_id=slot["id"])
    assert (await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete-early")).status_code == 200

    # 把歷程時間改成台北 2026-10-13 00:30（UTC 10-12 16:30）。
    local = datetime(2026, 10, 13, 0, 30, tzinfo=OPERATING_TZ)
    await db_session.execute(
        update(VisitRequestEvent)
        .where(VisitRequestEvent.visit_request_id == uuid.UUID(case_id), VisitRequestEvent.event_type == "completed")
        .values(created_at=local)
    )
    await db_session.commit()

    response = await admin_client.get(f"{BASE}/visit-requests", params={"order": "newest"})
    [row] = [r for r in response.json() if r["id"] == case_id]
    assert row["slot"] is None
    assert row["visited_on"] == "2026-10-13"
