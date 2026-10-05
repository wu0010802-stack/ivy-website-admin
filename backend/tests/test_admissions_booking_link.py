"""官網預約「已到場」自動建立招生訪視與補建（規格 6.1；R01；Review Focus 1、2）。
2026-10-05 拿掉「官網預約」分頁與 /admin/admissions/arrivals，補建只剩預約明細。"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.admissions import academic, booking_link, constants, records
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking.models import VisitRequest
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    complete,
    reception_yihua_client,
    started_booking,
)
from app.main import create_app
from tests.conftest import _logged_in_client, _test_settings, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

LABELS_TS = Path(__file__).resolve().parents[2] / "admin" / "src" / "api" / "labels.ts"


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
    every = "親友介紹、哥哥姊姊讀過或正在讀、住附近／路過看到、傳單／DM、網路上看到、其他、Facebook、Google 評論、媽媽社團"
    assert long["source"] == every[: constants.LEN_SOURCE]
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
        ("created", None, "visited", {"origin": "visit_request", "follow_up": "none"}),
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
    every = "親友介紹、哥哥姊姊讀過或正在讀、住附近／路過看到、傳單／DM、網路上看到、其他、Facebook、Google 評論、媽媽社團"
    assert long_visit.source == every[: constants.LEN_SOURCE]
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
async def test_rebuild_permissions(admin_client, reception_yihua_client, editor_client, minghua_client, db_session):
    """補建要 booking.read＋admissions.write；他校 404（R07）。"""
    request_id = await legacy_request(db_session, status="completed")
    assert (await editor_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")).status_code == 403
    assert (await minghua_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")).status_code == 404
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
            ("POST", f"{ADMISSIONS}/from-visit-request/{request_id}"),
        ):
            response = await client.request(method, path, json={} if method == "POST" else None)
            assert response.status_code == 404, (method, path, response.text)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
    # 之後開啟：關閉期間已到場的預約可以從預約明細補建。
    rebuilt = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
    assert rebuilt.status_code == 200, rebuilt.text
    assert len(await _visits_for(db_session, booking["id"])) == 1
