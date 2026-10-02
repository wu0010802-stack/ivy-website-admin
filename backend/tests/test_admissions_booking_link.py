"""官網預約「已到場」自動建立招生訪視、補建與待確認清單（規格 6.1；R01、R01a；
Review Focus 1、2）。"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from app.admissions import academic, booking_link, constants, records
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking import status_groups
from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    complete,
    move_slot,
    reception_yihua_client,
    started_booking,
)
from app.main import create_app
from tests.conftest import _logged_in_client, _test_settings, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

LABELS_TS = Path(__file__).resolve().parents[2] / "admin" / "src" / "api" / "labels.ts"
ARRIVALS = f"{ADMISSIONS}/arrivals?campus_key=yihua"


async def _visits_for(db_session, visit_request_id) -> list[RecruitmentVisit]:
    result = await db_session.execute(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(visit_request_id)))
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


def _request(**overrides) -> SimpleNamespace:
    values = {
        "child_name": "王小明",
        "child_birthdate": date(2023, 3, 2),
        "phone": "0912345678",
        "parent_name": "王媽媽",
        "referral_sources": ["facebook", "friends_family"],
        "questions": "午睡怎麼安排？",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_fields_from_visit_request_maps_spec_fields():
    """規格 6.1 第 1 點的欄位對應。"""
    fields = booking_link.fields_from_visit_request(_request(), today=date(2026, 9, 8), slot_date=date(2026, 9, 5))
    assert fields == {
        "visit_date": date(2026, 9, 5),
        "child_name": "王小明",
        "birthday": date(2023, 3, 2),
        "grade": "小班",
        "phone": "0912345678",
        "contact_name": "王媽媽",
        "source": "Facebook、親友介紹",
        "notes": "家長想了解：午睡怎麼安排？",
        "target_school_year": 115,
        "target_semester": 1,
    }


def test_fields_from_visit_request_truncates_and_defaults():
    """Review Focus 1 的純函式部分：超長截斷、缺值用預設，不丟例外。"""
    long = booking_link.fields_from_visit_request(
        _request(
            child_name="王" * 64,
            parent_name="陳" * 64,
            referral_sources=list(booking_link.REFERRAL_SOURCE_TEXT),
            questions="問" * 1000,
        ),
        today=date(2026, 9, 8),
    )
    assert (len(long["child_name"]), len(long["contact_name"])) == (constants.LEN_CHILD_NAME, constants.LEN_CONTACT)
    assert long["source"] == "親友介紹、住附近／路過看到、網路上看到、其他、Facebook、Google 評論、媽媽社團"
    assert len(long["source"]) <= constants.LEN_SOURCE
    assert long["notes"] == booking_link.NOTES_PREFIX + "問" * 1000
    assert long["visit_date"] == date(2026, 9, 8)  # 沒有場次：確認當天
    empty = booking_link.fields_from_visit_request(
        _request(child_name=None, child_birthdate=None, referral_sources=[], questions="   "), today=date(2026, 9, 8)
    )
    assert (empty["child_name"], empty["birthday"], empty["grade"], empty["source"], empty["notes"]) == (
        constants.MISSING_CHILD_NAME, None, None, None, None,
    )
    too_young = booking_link.fields_from_visit_request(_request(child_birthdate=date(2025, 1, 1)), today=date(2026, 9, 8))
    assert too_young["grade"] is None


@pytest.mark.parametrize(
    ("today", "term", "grade"),
    [
        (date(2026, 7, 31), (114, 2), "幼幼班"),
        (date(2026, 8, 1), (115, 1), "小班"),
        (date(2027, 1, 31), (115, 1), "小班"),
        (date(2027, 2, 1), (115, 2), "小班"),
    ],
)
def test_target_term_follows_confirmation_date(today, term, grade):
    """Review Focus 2：確認到場當天的台北學期；年級依那個學年換算。"""
    fields = booking_link.fields_from_visit_request(_request(child_birthdate=date(2023, 9, 1)), today=today)
    assert (fields["target_school_year"], fields["target_semester"]) == term
    assert fields["grade"] == grade


def test_referral_text_matches_admin_labels():
    """後端串來源文案用的對照，與後台 REFERRAL_SOURCE_LABELS 是同一組字。"""
    line = next(
        row for row in LABELS_TS.read_text(encoding="utf-8").splitlines()
        if row.startswith("export const REFERRAL_SOURCE_LABELS")
    )
    assert dict(re.findall(r"(\w+): '([^']+)'", line.split("=", 1)[1])) == booking_link.REFERRAL_SOURCE_TEXT


@pytest.mark.asyncio
async def test_completion_creates_exactly_one_visit_and_rebuild_returns_it(admin_client, public_client, db_session):
    """R01：標記已到場建立一筆、欄位依規格 6.1；重複標記與補建都不會多一筆；刪掉後可以再補建。"""
    booking = await started_booking(
        admin_client, public_client, db_session,
        child_name="陳小寶", child_birthdate="2022-05-02", referral_sources=["google_reviews"], questions="有沒有英文課？",
    )
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    [visit] = await _visits_for(db_session, booking["id"])
    slot_date = today_local() - timedelta(days=1)
    school_year, semester = academic.current_term(today_local())
    assert (visit.campus_key, visit.visit_date, visit.month, visit.seq_no) == (
        "yihua", slot_date, academic.roc_month(slot_date), "1",
    )
    assert (visit.child_name, visit.birthday, visit.contact_name, visit.phone) == (
        "陳小寶", date(2022, 5, 2), "陳媽媽", booking["phone"],
    )
    assert visit.grade == academic.grade_for_birthday(date(2022, 5, 2), school_year)
    assert (visit.source, visit.notes) == ("Google 評論", "家長想了解：有沒有英文課？")
    assert (visit.target_school_year, visit.target_semester) == (school_year, semester)
    assert (visit.has_deposit, visit.enrolled, visit.version) == (False, False, 1)
    events = (
        await db_session.execute(select(RecruitmentEventLog).where(RecruitmentEventLog.recruitment_visit_id == visit.id))
    ).scalars().all()
    assert [(e.event_type, e.from_stage, e.to_stage, e.metadata_json) for e in events] == [
        ("created", None, "visited", {"origin": "visit_request"}),
    ]
    assert events[0].actor_user_id is not None  # 按下「標記已到場」的人

    again = await complete(admin_client, booking["id"])
    assert again.status_code == 409
    rebuilt = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
    assert rebuilt.status_code == 200, rebuilt.text
    assert (rebuilt.json()["id"], rebuilt.json()["has_visit_request"]) == (str(visit.id), True)
    assert len(await _visits_for(db_session, booking["id"])) == 1

    deleted = await admin_client.delete(f"{ADMISSIONS}/records/{visit.id}?expected_version=1")
    assert deleted.status_code == 204
    recreated = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
    assert recreated.status_code == 200, recreated.text
    assert recreated.json()["id"] != str(visit.id) and recreated.json()["child_name"] == "陳小寶"
    assert await _audit(db_session, "recruitment_visit.create_from_booking") == [{"created": False}, {"created": True}]
    # 「標記已到場」本身照舊只記預約的稽核。
    assert len(await _audit(db_session, "visit_request.complete")) == 1


@pytest.mark.asyncio
async def test_only_completed_and_not_anonymized_requests_can_be_rebuilt(admin_client, public_client, db_session):
    """R01：已取消、未到場、還沒確認到場的預約不產生招生訪視；已匿名化的不補建（調整第 13 條）。"""
    cancelled = await started_booking(admin_client, public_client, db_session)
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cancelled['id']}/cancel")).status_code == 200
    no_show = await started_booking(admin_client, public_client, db_session)
    assert (await admin_client.post(f"{API}/admin/visit-requests/{no_show['id']}/no-show")).status_code == 200
    pending = await started_booking(admin_client, public_client, db_session)
    for booking in (cancelled, no_show, pending):
        response = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "VISIT_REQUEST_NOT_COMPLETED"
        assert await _visits_for(db_session, booking["id"]) == []

    anonymized = await legacy_request(db_session, status="completed")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(anonymized)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    response = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{anonymized}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "VISIT_REQUEST_ANONYMIZED"
    assert (await admin_client.post(f"{ADMISSIONS}/from-visit-request/{uuid.uuid4()}")).status_code == 404


@pytest.mark.asyncio
async def test_completion_never_fails_on_long_or_missing_fields(admin_client, public_client, db_session):
    """Review Focus 1：孩子姓名與家長稱呼 64 字、勾滿五個得知管道、提問 500 字；
    以及什麼都沒填。照常標記成功，招生訪視欄位截斷或用預設值。"""
    full = await started_booking(
        admin_client, public_client, db_session,
        parent_name="陳" * 64, child_name="王" * 64, child_birthdate="2023-09-01",
        referral_sources=list(booking_link.REFERRAL_SOURCE_TEXT), questions="問" * 500,
    )
    bare = await started_booking(admin_client, public_client, db_session)
    for booking in (full, bare):
        response = await complete(admin_client, booking["id"])
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "completed"
    [long_visit] = await _visits_for(db_session, full["id"])
    assert (long_visit.child_name, long_visit.contact_name) == ("王" * 50, "陳" * 50)
    assert long_visit.source == "親友介紹、住附近／路過看到、網路上看到、其他、Facebook、Google 評論、媽媽社團"
    assert long_visit.notes == "家長想了解：" + "問" * 500
    [bare_visit] = await _visits_for(db_session, bare["id"])
    assert (bare_visit.child_name, bare_visit.birthday, bare_visit.grade, bare_visit.source, bare_visit.notes) == (
        constants.MISSING_CHILD_NAME, None, None, None, None,
    )
    assert bare_visit.contact_name == "陳媽媽"


@pytest.mark.asyncio
async def test_database_error_rolls_back_the_whole_completion(admin_client, public_client, db_session, monkeypatch):
    """Global Constraints：不吞例外。資料庫錯誤時整個「標記已到場」回滾，不留下
    「已到場卻沒有招生訪視」的半套狀態。"""
    booking = await started_booking(admin_client, public_client, db_session)

    async def broken(*args, **kwargs):
        raise IntegrityError("INSERT INTO recruitment_visits", {}, Exception("模擬資料庫錯誤"))

    monkeypatch.setattr(records, "create_visit", broken)
    response = await complete(admin_client, booking["id"])
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "INTERNAL_ERROR"
    status = await db_session.scalar(
        select(VisitRequest.status)
        .where(VisitRequest.id == uuid.UUID(booking["id"]))
        .execution_options(populate_existing=True)
    )
    assert status == "confirmed"
    assert await _visits_for(db_session, booking["id"]) == []


@pytest.mark.asyncio
async def test_month_follows_slot_date_not_created_at(admin_client, public_client, db_session):
    """Review Focus 2：民國月份依場次日期（台北牆上日期），不依預約建立時間。"""
    booking = await started_booking(
        admin_client, public_client, db_session, slot_date=date(2025, 12, 31), starts_at=time(23, 30)
    )
    assert (await complete(admin_client, booking["id"])).status_code == 200
    [visit] = await _visits_for(db_session, booking["id"])
    assert (visit.visit_date, visit.month) == (date(2025, 12, 31), "114.12")
    created_at = await db_session.scalar(select(VisitRequest.created_at).where(VisitRequest.id == uuid.UUID(booking["id"])))
    assert academic.roc_month(today_local(created_at)) != "114.12"
    assert (visit.target_school_year, visit.target_semester) == academic.current_term(today_local())


@pytest.mark.asyncio
async def test_arrivals_lists_started_confirmed_and_completed_without_visit(admin_client, public_client, db_session):
    """R01a：只列 confirmed 且場次已開始（含剛好開始、含停止申請的場次）；結果與
    status_groups.group_condition("past") 去掉已到場、未到場一致。"""
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    local = now.astimezone(OPERATING_TZ)
    later = local + timedelta(minutes=1)

    async def booking(**kwargs) -> dict:
        return await started_booking(admin_client, public_client, db_session, **kwargs)

    yesterday = await booking(child_name="昨天")
    on_time = await booking(slot_date=local.date(), starts_at=local.time().replace(tzinfo=None), child_name="剛好開始")
    not_yet = await booking(slot_date=later.date(), starts_at=later.time().replace(tzinfo=None), child_name="還沒開始")
    stopped = await booking(child_name="停止申請")
    await move_slot(db_session, stopped["slot_id"], slot_date=today_local() - timedelta(days=1), closed=True)
    arrived = await booking(child_name="已到場")
    assert (await complete(admin_client, arrived["id"])).status_code == 200
    absent = await booking(child_name="未到場")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{absent['id']}/no-show")).status_code == 200
    cancelled = await booking(child_name="已取消")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cancelled['id']}/cancel")).status_code == 200
    other_campus = await started_booking(admin_client, public_client, db_session, campus_key="minghua")
    no_slot = await legacy_request(db_session, status="confirmed")
    legacy_done = await legacy_request(db_session, status="completed", parent_name="上線前到場的家長")
    legacy_gone = await legacy_request(db_session, status="completed")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(legacy_gone)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()

    result = await booking_link.arrivals(db_session, "yihua", now=now)
    awaiting = {str(row["visit_request_id"]) for row in result["awaiting"]}
    assert awaiting == {yesterday["id"], on_time["id"], stopped["id"]}
    for excluded in (not_yet, arrived, absent, cancelled, other_campus):
        assert excluded["id"] not in awaiting
    assert no_slot not in awaiting
    expected = (
        await db_session.execute(
            select(VisitRequest.id).where(
                VisitRequest.campus_key == "yihua",
                status_groups.group_condition("past", now),
                VisitRequest.status.not_in(["completed", "no_show"]),
            )
        )
    ).scalars()
    assert awaiting == {str(value) for value in expected}
    assert [str(row["visit_request_id"]) for row in result["missing"]] == [legacy_done]
    assert result["missing"][0]["parent_name"] == "上線前到場的家長"
    row = next(row for row in result["awaiting"] if str(row["visit_request_id"]) == yesterday["id"])
    assert (row["child_name"], row["parent_name"], row["party_size"], row["status"]) == ("昨天", "陳媽媽", None, "confirmed")
    assert row["slot_date"] == today_local() - timedelta(days=1)

    # API 用現在時間：上面確定已開始的幾筆一定在。
    response = await admin_client.get(ARRIVALS)
    assert response.status_code == 200, response.text
    api_awaiting = {row["visit_request_id"] for row in response.json()["awaiting"]}
    assert {yesterday["id"], on_time["id"], stopped["id"]} <= api_awaiting
    assert [row["visit_request_id"] for row in response.json()["missing"]] == [legacy_done]
    # 補建之後就不在「沒有招生訪視」清單。
    assert (await admin_client.post(f"{ADMISSIONS}/from-visit-request/{legacy_done}")).status_code == 200
    assert (await booking_link.arrivals(db_session, "yihua", now=now))["missing"] == []


@pytest.mark.asyncio
async def test_arrivals_and_rebuild_permissions(admin_client, reception_yihua_client, editor_client, minghua_client, db_session):
    """arrivals 要 booking.read；補建要 booking.read＋admissions.write；他校 404（R07）。"""
    request_id = await legacy_request(db_session, status="completed")
    assert (await editor_client.get(ARRIVALS)).status_code == 403
    assert (await editor_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")).status_code == 403
    assert (await minghua_client.get(ARRIVALS)).status_code == 404
    assert (await minghua_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")).status_code == 404
    assert (await reception_yihua_client.get(ARRIVALS)).status_code == 200
    created = await reception_yihua_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")
    assert created.status_code == 200, created.text
    assert created.json()["visit_request_id"] == request_id
    assert created.json()["visit_date"] == today_local().isoformat()  # 舊案沒有場次：建立當天


@pytest.mark.asyncio
async def test_admissions_disabled_skips_visit_and_hides_endpoints(admin_client, public_client, db_session):
    """F1：招生功能開關關閉（正式站預設）時，標記已到場照常、不建招生訪視；
    /admin/admissions/* 不掛路由，一律 404。"""
    booking = await started_booking(admin_client, public_client, db_session)
    request_id = await legacy_request(db_session, status="completed")
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        done = await complete(client, booking["id"])
        assert done.status_code == 200, done.text
        assert done.json()["status"] == "completed"
        assert await _visits_for(db_session, booking["id"]) == []
        for method, path in (
            ("GET", f"{ADMISSIONS}/records?campus_key=yihua"),
            ("POST", f"{ADMISSIONS}/records?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/board?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/options?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/stats?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/compare?school_year=115&semester=1"),
            ("GET", f"{ADMISSIONS}/no-deposit-records?campus_key=yihua"),
            ("GET", ARRIVALS),
            ("POST", f"{ADMISSIONS}/from-visit-request/{request_id}"),
        ):
            response = await client.request(method, path, json={} if method == "POST" else None)
            assert response.status_code == 404, (method, path, response.text)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
    # 之後開啟：關閉期間已到場的預約出現在「已到場但沒有招生訪視」，可以補建。
    missing = (await booking_link.arrivals(db_session, "yihua"))["missing"]
    assert booking["id"] in {str(row["visit_request_id"]) for row in missing}


@pytest.mark.asyncio
async def test_arrivals_caps_each_list_newest_first_with_totals(admin_client, db_session):
    """F3：兩份清單各最多 ARRIVALS_LIMIT 筆。待確認依場次日期與開始時間新到舊；
    已到場沒有招生訪視依場次日期（沒有場次用建立時間）新到舊；total 是截斷前的總數。"""
    now = datetime.now(timezone.utc)
    today = today_local()
    slots = {}
    for key, days_ago, start in (("oldest", 3, time(9, 0)), ("morning", 1, time(9, 0)), ("afternoon", 1, time(14, 0))):
        slots[key] = uuid.uuid4()
        db_session.add(
            VisitSlot(
                id=slots[key], campus_key="yihua", slot_date=today - timedelta(days=days_ago), start_time=start,
                end_time=time(start.hour + 1, 0), capacity=10, created_at=now,
            )
        )
    await db_session.flush()

    def requests(count: int, parent_name: str, *, status: str, slot: str | None = None, created_at=now) -> list[dict]:
        return [
            {
                "id": uuid.uuid4(), "campus_key": "yihua", "idempotency_key": f"cap-{uuid.uuid4().hex}",
                "payload_hash": "0" * 64, "config_version": 0, "parent_name": parent_name, "phone": "0911000111",
                "referral_sources": [], "party_size": 2, "consent_given": True, "status": status, "source": "web",
                "slot_id": slots[slot] if slot else None, "created_at": created_at,
            }
            for _ in range(count)
        ]

    await db_session.execute(
        insert(VisitRequest),
        [
            *requests(5, "三天前", status="confirmed", slot="oldest"),
            *requests(100, "昨天上午", status="confirmed", slot="morning"),
            *requests(100, "昨天下午", status="confirmed", slot="afternoon"),
            *requests(1, "今天建立沒有場次", status="completed"),
            *requests(200, "昨天上午到場", status="completed", slot="morning"),
            *requests(2, "一個月前建立沒有場次", status="completed", created_at=now - timedelta(days=30)),
        ],
    )
    await db_session.commit()

    assert booking_link.ARRIVALS_LIMIT == 200
    result = await booking_link.arrivals(db_session, "yihua", now=now)
    assert (result["awaiting_total"], result["missing_total"]) == (205, 203)
    assert [row["parent_name"] for row in result["awaiting"]] == ["昨天下午"] * 100 + ["昨天上午"] * 100
    assert [row["parent_name"] for row in result["missing"]] == ["今天建立沒有場次"] + ["昨天上午到場"] * 199

    response = await admin_client.get(ARRIVALS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (len(body["awaiting"]), body["awaiting_total"], len(body["missing"]), body["missing_total"]) == (200, 205, 200, 203)
