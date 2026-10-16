"""預約全程漏斗 API 與查庫（2026-10-15 預約全程規格 §3、§4）。

種子直接寫庫：預約案件、場次、事件、招生訪視與預繳事件都能指定時間。固定「現在」是 2026-10-15 12:00（台北），
service 層測試傳 `now`；API 層測試用相對今天的日期。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admissions import journey
from app.admissions.academic import roc_month
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking.models import VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

API = "/api/website/v1"
JOURNEY = f"{API}/admin/admissions/journey"
NOW = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)  # 台北 12:00
TODAY = date(2026, 10, 15)


def at(day: date, hour: int = 12, minute: int = 0) -> datetime:
    """台北牆上時間 → aware UTC。"""
    return datetime.combine(day, time(hour, minute), tzinfo=OPERATING_TZ).astimezone(timezone.utc)


def d(month: int, day: int) -> date:
    return date(2026, month, day)


async def add_case(
    db, *, campus: str = "yihua", status: str = "completed", source: str = "web", slot_day: date | None, slot_hour: int = 10,
    created: datetime, cancelled_at: datetime | None = None, cancel_reason: str | None = None,
    events: list[tuple[str, datetime]] | None = None, anonymized: bool = False,
) -> uuid.UUID:
    slot_id = None
    if slot_day is not None:
        slot = VisitSlot(
            id=uuid.uuid4(), campus_key=campus, slot_date=slot_day, start_time=time(slot_hour, 0),
            end_time=time(slot_hour + 1, 0), capacity=99, closed=False, created_at=created,
        )
        db.add(slot)
        await db.flush()
        slot_id = slot.id
    request = VisitRequest(
        id=uuid.uuid4(), campus_key=campus, idempotency_key=f"journey-{uuid.uuid4().hex}", payload_hash="0" * 64,
        config_version=0, parent_name="測試家長", phone="0911000333", referral_sources=[], consent_given=True,
        status=status, source=source, slot_id=slot_id, cancelled_at=cancelled_at, cancel_reason=cancel_reason,
        anonymized_at=created if anonymized else None, created_at=created,
    )
    db.add(request)
    await db.flush()
    for event_type, when in events or []:
        db.add(VisitRequestEvent(id=uuid.uuid4(), visit_request_id=request.id, event_type=event_type, created_at=when))
    await db.flush()
    return request.id


async def add_visit(
    db, *, request_id: uuid.UUID | None, campus: str = "yihua", visit_date: date, deposit: bool = False,
    deposit_event: datetime | None = None, enrolled: bool = False, enrolled_on: date | None = None,
    withdrawn_at: datetime | None = None, withdrawn_from: str | None = None, anonymized: bool = False,
) -> RecruitmentVisit:
    visit = RecruitmentVisit(
        id=uuid.uuid4(), campus_key=campus, visit_request_id=request_id, month=roc_month(visit_date), seq_no=None,
        visit_date=visit_date, child_name="測試幼生", has_deposit=deposit, rides_bus=False, enrolled=enrolled,
        enrolled_on=enrolled_on, withdrawn_at=withdrawn_at, withdrawn_from=withdrawn_from,
        withdraw_reason="家長改送他校" if withdrawn_at else None, target_school_year=115, target_semester=1,
        version=1, anonymized_at=NOW if anonymized else None, created_at=NOW, updated_at=NOW,
    )
    db.add(visit)
    await db.flush()
    if deposit_event is not None:
        db.add(RecruitmentEventLog(
            id=uuid.uuid4(), recruitment_visit_id=visit.id, event_type="deposit_added", from_stage=None,
            to_stage="deposited", created_at=deposit_event,
        ))
        await db.flush()
    return visit


async def run(db, *, date_from=d(9, 1), date_to=d(10, 15), source="all", campus="yihua", now=NOW) -> dict:
    return await journey.query_journey(db, campus, date_from, date_to, source, now=now)


async def test_cohort_boundaries_are_inclusive(db_session):
    for day in (d(8, 31), d(9, 1), d(9, 30), d(10, 1)):
        await add_case(db_session, slot_day=day, created=at(day - timedelta(days=3)))
    await db_session.commit()
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30))
    assert result["cases"]["total"] == 2
    assert result["filters"] == {"campus_key": "yihua", "date_from": d(9, 1), "date_to": d(9, 30), "source": "all"}


async def test_unmarked_today_and_upcoming_today(db_session):
    """今天 10:00 的場次現在（12:00）已開始、沒標記＝時間已過未標記；今天 15:00 還沒開始，不納入。"""
    await add_case(db_session, status="confirmed", slot_day=TODAY, slot_hour=10, created=at(d(10, 1)))
    await add_case(db_session, status="confirmed", slot_day=TODAY, slot_hour=15, created=at(d(10, 1)))
    await db_session.commit()
    result = await run(db_session, date_from=d(10, 1), date_to=TODAY)
    assert result["cases"]["total"] == 1
    assert result["visit_outcomes"]["unmarked"] == 1


async def test_cancelled_later_today_waits_for_the_visit_time(db_session):
    """今天 15:00 的場次現在（12:00）還沒開始：取消了也還沒到參觀時間，不進批次（J3）；今天 10:00 已開始的取消照算。"""
    await add_case(db_session, status="cancelled", slot_day=TODAY, slot_hour=15, created=at(d(10, 1)), cancelled_at=at(d(10, 14)))
    await add_case(db_session, status="cancelled", slot_day=TODAY, slot_hour=10, created=at(d(10, 1)), cancelled_at=at(d(10, 14)))
    await db_session.commit()
    result = await run(db_session, date_from=d(10, 1), date_to=TODAY)
    assert result["cases"]["total"] == 1
    assert result["visit_outcomes"]["cancelled"]["total"] == 1
    later = await run(db_session, date_from=d(10, 1), date_to=TODAY, now=at(TODAY, 15))
    assert later["cases"]["total"] == 2


async def test_early_complete_uses_the_completion_day(db_session):
    """提早到場、約之後的日子：場次被釋出（沒有場次），預定參觀日取最後一次 completed 事件的台北日（UTC 16:30＝隔天）。"""
    await add_case(
        db_session, slot_day=None, created=at(d(9, 1)), events=[("completed", datetime(2026, 9, 9, 16, 30, tzinfo=timezone.utc))],
    )
    await db_session.commit()
    inside = await run(db_session, date_from=d(9, 10), date_to=d(9, 10))
    assert inside["cases"]["total"] == 1
    assert (await run(db_session, date_from=d(9, 9), date_to=d(9, 9)))["cases"]["total"] == 0


async def test_rescheduled_case_uses_the_current_slot(db_session):
    await add_case(db_session, slot_day=d(9, 20), created=at(d(9, 1)), events=[("rescheduled", at(d(9, 5)))])
    await db_session.commit()
    assert (await run(db_session, date_from=d(9, 20), date_to=d(9, 20)))["cases"]["total"] == 1
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 19))
    assert result["cases"]["total"] == 0
    assert (await run(db_session, date_from=d(9, 1), date_to=d(9, 30)))["rescheduled"] == {"cases": 1, "total": 1}


async def test_taipei_day_boundary(db_session):
    """UTC 16:30 是台北隔天 00:30：提前量、取消時點、預繳天數都以台北日算。"""
    # 預約 09-07 UTC 16:30（台北 09-08 00:30），參觀 09-08 → 提前量 0 天，不是 −1 也不是 1。
    created = datetime(2026, 9, 7, 16, 30, tzinfo=timezone.utc)
    request = await add_case(db_session, slot_day=d(9, 8), created=created)
    # 預繳事件 09-20 UTC 16:30（台北 09-21）→ 參觀 09-08 後第 13 天。
    await add_visit(
        db_session, request_id=request, visit_date=d(9, 8), deposit=True,
        deposit_event=datetime(2026, 9, 20, 16, 30, tzinfo=timezone.utc),
    )
    # 取消：09-14 UTC 16:30（台北 09-15）、參觀 09-16 → 1 天前。
    await add_case(
        db_session, status="cancelled", slot_day=d(9, 16), created=at(d(9, 1)),
        cancelled_at=datetime(2026, 9, 14, 16, 30, tzinfo=timezone.utc), cancel_reason="parent",
    )
    await db_session.commit()
    timing = (await run(db_session))["timing"]
    # 兩筆：台北 00:30 送出、當天參觀＝0 天；09-01 送出、09-16 參觀＝15 天 → 中位數 7.5。
    assert timing["lead_days"] == {"median": 7.5, "n": 2, "excluded": 0}
    assert timing["visit_to_deposit"] == {"median": 13.0, "n": 1, "excluded": 0}
    assert timing["cancel_before_visit"]["parent"]["day_1"] == 1


async def test_source_filter(db_session):
    await add_case(db_session, source="web", slot_day=d(9, 10), created=at(d(9, 1)))
    await add_case(db_session, source="phone", slot_day=d(9, 11), created=at(d(9, 1)))
    await add_case(db_session, source="walk_in", slot_day=d(9, 12), created=at(d(9, 1)))
    await db_session.commit()
    assert (await run(db_session, source="all"))["cases"]["total"] == 3
    web = await run(db_session, source="web")
    assert (web["cases"]["total"], web["cases"]["by_source"]["web"]) == (1, 1)
    assisted = await run(db_session, source="assisted")
    assert assisted["cases"]["total"] == 2 and assisted["cases"]["by_source"]["web"] == 0


async def test_funnel_through_linked_visits(db_session):
    """預約 → 到場 → 訪視 → 預繳 → 註冊 / 退出，全部經由 visit_request_id。"""
    a = await add_case(db_session, slot_day=d(9, 8), created=at(d(9, 1)))
    await add_visit(db_session, request_id=a, visit_date=d(9, 8), deposit=True, deposit_event=at(d(9, 20)), enrolled=True, enrolled_on=d(10, 1))
    b = await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 5)))
    await add_visit(
        db_session, request_id=b, visit_date=d(9, 10), deposit=True, deposit_event=at(d(9, 15)),
        withdrawn_at=at(d(9, 30)), withdrawn_from="deposited",
    )
    c = await add_case(db_session, slot_day=d(9, 12), created=at(d(9, 10)))
    await add_visit(db_session, request_id=c, visit_date=d(9, 12))  # 沒預繳，33 天 → 逾期
    await add_case(db_session, slot_day=d(9, 25), created=at(d(9, 20)))  # 到場但沒有訪視
    await add_case(db_session, status="no_show", slot_day=d(9, 24), created=at(d(9, 18)))
    await add_case(
        db_session, status="cancelled", slot_day=d(9, 20), created=at(d(9, 1)), cancelled_at=at(d(9, 13)), cancel_reason="staff",
    )
    await db_session.commit()
    result = await run(db_session)
    assert result["cases"]["total"] == 6
    assert result["visit_outcomes"] == {
        "completed": 4, "no_show": 1, "cancelled": {"total": 1, "parent": 0, "staff": 1, "other": 0}, "unmarked": 0,
    }
    assert result["admissions"] == {
        "with_visit": 3, "completed_without_visit": 1, "deposited": 2, "enrolled": 1,
        "withdrawn": {"total": 1, "from_deposit": 1, "from_enrolled": 0},
        "not_deposited": {"observing": 0, "overdue": 1, "cold": 0},
    }
    assert result["timing"]["visit_to_deposit"] == {"median": 8.5, "n": 2, "excluded": 0}
    assert result["timing"]["cancel_before_visit"]["staff"]["days_4_7"] == 1
    assert result["timing"]["deposit_to_enrolled"] == {"median": 11.0, "n": 1, "excluded": 0}
    assert result["timing"]["deposit_to_withdrawn"] == {"median": 15.0, "n": 1, "excluded": 0}


async def test_withdrawn_from_enrolled_has_no_enrolled_day(db_session):
    """funnel.transition 退註冊時會清掉 has_deposit、enrolled、enrolled_on，只留 deposit_added 事件與 withdrawn_*。
    這種家庭算預繳過、註冊過，預繳到退出有天數，預繳到註冊因缺註冊日列在不納入。"""
    request = await add_case(db_session, slot_day=d(9, 8), created=at(d(9, 1)))
    await add_visit(
        db_session, request_id=request, visit_date=d(9, 8), deposit=False, deposit_event=at(d(9, 20)),
        enrolled=False, enrolled_on=None, withdrawn_at=at(d(10, 5)), withdrawn_from="enrolled",
    )
    await db_session.commit()
    result = await run(db_session)
    assert result["admissions"]["enrolled"] == 1
    assert result["admissions"]["deposited"] == 1
    assert result["admissions"]["withdrawn"] == {"total": 1, "from_deposit": 0, "from_enrolled": 1}
    assert result["timing"]["deposit_to_enrolled"] == {"median": None, "n": 0, "excluded": 1}
    assert result["timing"]["deposit_to_withdrawn"]["n"] == 1


async def test_deposit_day_is_the_last_deposit_event(db_session):
    """同一個訪視有兩筆 deposit_added（先收一次、補收一次）：預繳日取最後一筆的台北日。"""
    request = await add_case(db_session, slot_day=d(9, 8), created=at(d(9, 1)))
    visit = await add_visit(db_session, request_id=request, visit_date=d(9, 8), deposit=True, deposit_event=at(d(9, 12)))
    db_session.add(RecruitmentEventLog(
        id=uuid.uuid4(), recruitment_visit_id=visit.id, event_type="deposit_added", from_stage=None, to_stage="deposited",
        created_at=at(d(9, 18)),
    ))
    # 預繳旗標開著、卻沒有任何 deposit_added 事件：算預繳過，天數另列。
    other = await add_case(db_session, slot_day=d(9, 9), created=at(d(9, 2)))
    await add_visit(db_session, request_id=other, visit_date=d(9, 9), deposit=True)
    await db_session.commit()
    result = await run(db_session)
    assert result["admissions"]["deposited"] == 2
    assert result["timing"]["visit_to_deposit"] == {"median": 10.0, "n": 1, "excluded": 1}


async def test_visit_of_a_request_outside_the_period_is_not_counted(db_session):
    inside = await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 1)))
    outside = await add_case(db_session, slot_day=d(8, 1), created=at(d(7, 20)))
    await add_visit(db_session, request_id=inside, visit_date=d(9, 10), deposit=True, deposit_event=at(d(9, 12)))
    await add_visit(db_session, request_id=outside, visit_date=d(8, 1), deposit=True, deposit_event=at(d(8, 3)))
    await db_session.commit()
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30))
    assert result["cases"]["total"] == 1
    assert result["admissions"]["with_visit"] == 1 and result["admissions"]["deposited"] == 1


async def test_coverage_lists_what_the_funnel_does_not_contain(db_session):
    # 沒有預約案件的訪視（手動新增、現場參觀）：visit_date 在期間內才算。
    await add_visit(db_session, request_id=None, visit_date=d(9, 5))
    await add_visit(db_session, request_id=None, visit_date=d(9, 6))
    await add_visit(db_session, request_id=None, visit_date=d(8, 1))  # 期間外
    # 已到場但沒有訪視。
    await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 1)))
    # 預定參觀日算不出來（已到場、沒場次、沒有 completed 事件）：以送出日在期間內計入 undated，不進批次。
    await add_case(db_session, slot_day=None, created=at(d(9, 3)))
    await add_case(db_session, slot_day=None, created=at(d(8, 3)))  # 送出日在期間外：不計
    # 別校的資料不混進來。
    await add_visit(db_session, request_id=None, campus="minghua", visit_date=d(9, 5))
    await db_session.commit()
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30))
    assert result["cases"]["total"] == 1
    assert result["coverage"] == {"visits_without_request": 2, "completed_without_visit": 1, "undated_cases": 1}


async def test_coverage_follows_the_source_filter_except_visits_without_request(db_session):
    """沒有預約案件的訪視沒有來源，不受篩選；已到場無訪視、預定參觀日算不出來都是批次內的案件，跟著來源走。"""
    await add_visit(db_session, request_id=None, visit_date=d(9, 5))
    await add_case(db_session, source="web", slot_day=d(9, 10), created=at(d(9, 1)))  # 已到場、無訪視
    await add_case(db_session, source="web", slot_day=None, created=at(d(9, 3)))  # 預定參觀日算不出來
    await add_case(db_session, source="phone", slot_day=d(9, 11), created=at(d(9, 1)))  # 已到場、無訪視
    await add_case(db_session, source="phone", slot_day=None, created=at(d(9, 3)))  # 預定參觀日算不出來
    await add_case(db_session, source="phone", slot_day=None, created=at(d(9, 4)))  # 預定參觀日算不出來
    await db_session.commit()
    web = {"visits_without_request": 1, "completed_without_visit": 1, "undated_cases": 1}
    assisted = {"visits_without_request": 1, "completed_without_visit": 1, "undated_cases": 2}
    everything = {"visits_without_request": 1, "completed_without_visit": 2, "undated_cases": 3}
    for source, expected in (("web", web), ("assisted", assisted), ("all", everything)):
        result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30), source=source)
        assert result["coverage"] == expected, source


async def test_anonymized_cases_are_counted(db_session):
    request = await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 1)), anonymized=True)
    await add_visit(db_session, request_id=request, visit_date=d(9, 10), deposit=True, deposit_event=at(d(9, 14)), anonymized=True)
    await db_session.commit()
    result = await run(db_session)
    assert result["cases"]["total"] == 1 and result["admissions"]["deposited"] == 1
    assert result["timing"]["visit_to_deposit"]["median"] == 4.0


# ---- API ----


def api_range(days: int = 30) -> str:
    today = today_local()
    return f"from={today - timedelta(days=days)}&to={today}"


async def test_api_response_shape(admin_client, db_session):
    request = await add_case(db_session, slot_day=today_local() - timedelta(days=5), created=at(today_local() - timedelta(days=9)))
    await add_visit(db_session, request_id=request, visit_date=today_local() - timedelta(days=5))
    await db_session.commit()
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"filters", "as_of", "cases", "visit_outcomes", "admissions", "rates", "timing", "rescheduled", "coverage"}
    assert body["filters"]["source"] == "all" and body["cases"]["total"] == 1
    assert [rate["key"] for rate in body["rates"]] == ["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]


async def test_to_is_clamped_to_today(admin_client):
    today = today_local()
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&from={today - timedelta(days=10)}&to={today + timedelta(days=30)}")
    assert response.status_code == 200
    assert response.json()["filters"]["date_to"] == today.isoformat()


@pytest.mark.parametrize(
    "query",
    [
        "from=2026-10-10&to=2026-10-01",  # 開始晚於結束
        "from=2024-01-01&to=2026-01-01",  # 超過 400 天
        "from=2999-01-01&to=2999-02-01",  # 整段在未來：截到今天後 from > to
    ],
)
async def test_rejects_bad_ranges(admin_client, query):
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&{query}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_DATE_RANGE"


async def test_rejects_unknown_source(admin_client):
    assert (await admin_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}&source=hack")).status_code == 422


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):  # noqa: F811
    path = f"{JOURNEY}?{api_range()}&campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_needs_login(public_client):
    assert (await public_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")).status_code == 401


async def test_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_never_writes_audit_entries(admin_client, db_session):
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")
    assert response.status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before
