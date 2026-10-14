"""國定假日匯入（2026-10-14 規格 §2）：解析辦公日曆、從開放平台下載、套用成各校休假日。"""
from __future__ import annotations

import json
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.booking import holidays
from app.booking.models import VisitException, VisitSlot
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.conftest import add_weekly_rule, book_slot, create_slot_record

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
_WEEKDAYS = "一二三四五六日"


def calendar_csv(year: int, holidays_by_day: dict[date, str], *, workdays: dict[date, str] | None = None) -> str:
    """產生一整年的辦公日曆表（欄位同人事行政總處的 CSV）。"""
    workdays = workdays or {}
    lines = ["西元日期,星期,是否放假,備註"]
    day = date(year, 1, 1)
    while day.year == year:
        if day in workdays:
            off, note = "0", workdays[day]
        elif day in holidays_by_day:
            off, note = "2", holidays_by_day[day]
        else:
            off, note = ("2" if day.weekday() >= 5 else "0"), ""
        lines.append(f"{day:%Y%m%d},{_WEEKDAYS[day.weekday()]},{off},{note}")
        day += timedelta(days=1)
    return "\r\n".join(lines) + "\r\n"


def _first(year: int, weekday: int, month: int = 3) -> date:
    """year 年 month 月第一個星期 weekday（0＝一）。"""
    day = date(year, month, 1)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


def _upcoming_weekday(min_days: int = 10) -> date:
    """今天起至少 min_days 天後的第一個星期一到五。"""
    day = today_local() + timedelta(days=min_days)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


# ---------------------------------------------------------------------------
# 解析
# ---------------------------------------------------------------------------


def test_parse_lists_weekday_holidays_and_named_weekends_only():
    year = 2027
    monday, saturday = _first(year, 0), _first(year, 5)
    workday_saturday = _first(year, 5, month=4)
    raw = calendar_csv(
        year,
        {date(year, 1, 1): "開國紀念日", monday: "補假", saturday: "國慶日"},
        workdays={workday_saturday: "補行上班"},
    ).encode("utf-8-sig")

    calendar = holidays.parse_calendar(raw, source_label="116年中華民國政府行政機關辦公日曆表")

    assert [(h.day, h.name) for h in calendar.holidays] == [
        (date(year, 1, 1), "開國紀念日"),
        (monday, "補假"),
        (saturday, "國慶日"),
    ]
    assert calendar.years == [year]
    assert calendar.source_label == "116年中華民國政府行政機關辦公日曆表"


def test_parse_reads_big5_files():
    year = 2025
    raw = calendar_csv(year, {date(year, 10, 10): "國慶日"}).encode("cp950")

    calendar = holidays.parse_calendar(raw, source_label="114年(1141020更新)")

    assert [(h.day, h.name) for h in calendar.holidays] == [(date(year, 10, 10), "國慶日")]


def test_parse_names_unnamed_weekday_holiday():
    year = 2027
    monday = _first(year, 0)
    calendar = holidays.parse_calendar(calendar_csv(year, {monday: ""}).encode(), source_label="x")
    assert [(h.day, h.name) for h in calendar.holidays] == [(monday, "放假")]


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("Subject,Start Date,Start Time\r\n開國紀念日,2027/1/1,\r\n", "Google行事曆專用"),
        ("日期,放假\r\n20270101,2\r\n", "找不到「西元日期」「是否放假」欄位"),
        ("西元日期,星期,是否放假,備註\r\n2027-01-01,五,2,開國紀念日\r\n", "不是 8 位數字"),
        ("西元日期,星期,是否放假,備註\r\n20270230,五,2,\r\n", "不存在"),
        ("西元日期,星期,是否放假,備註\r\n20270101,五,1,\r\n", "應該是 0 或 2"),
        ("西元日期,星期,是否放假,備註\r\n20270101,五,2,開國紀念日\r\n", "日子太少"),
        ("", "檔案是空的"),
    ],
)
def test_parse_rejects_files_that_are_not_the_office_calendar(raw, message):
    with pytest.raises(holidays.HolidayCalendarError, match=message):
        holidays.parse_calendar(raw.encode("utf-8"), source_label="x")


def test_parse_rejects_duplicate_dates_and_years_without_holidays():
    year = 2027
    duplicated = calendar_csv(year, {date(year, 1, 1): "開國紀念日"}) + f"{year}0101,五,2,開國紀念日\r\n"
    with pytest.raises(holidays.HolidayCalendarError, match="出現兩次"):
        holidays.parse_calendar(duplicated.encode(), source_label="x")

    no_holidays = "\r\n".join(
        ["西元日期,星期,是否放假,備註"]
        + [f"{date(year, 3, 1) + timedelta(days=i):%Y%m%d},一,0," for i in range(40)]
    )
    with pytest.raises(holidays.HolidayCalendarError, match="沒有任何放假日"):
        holidays.parse_calendar(no_holidays.encode(), source_label="x")


def test_pick_resource_prefers_the_latest_update_and_skips_google_versions():
    distribution = [
        {"resourceDescription": "114年中華民國政府行政機關辦公日曆表", "resourceFormat": "CSV", "resourceDownloadUrl": "https://a/base.csv"},
        {"resourceDescription": "114年中華民國政府行政機關辦公日曆表_Google行事曆專用", "resourceFormat": "CSV", "resourceDownloadUrl": "https://a/google.csv"},
        {"resourceDescription": "114年中華民國政府行政機關辦公日曆表(1141020更新)", "resourceFormat": "CSV", "resourceDownloadUrl": "https://a/1020.csv"},
        {"resourceDescription": "114年中華民國政府行政機關辦公日曆表(1140601更新)", "resourceFormat": "CSV", "resourceDownloadUrl": "https://a/0601.csv"},
        {"resourceDescription": "115年中華民國政府行政機關辦公日曆表", "resourceFormat": "CSV", "resourceDownloadUrl": "https://a/115.csv"},
    ]

    assert holidays.pick_resource(distribution, 114) == ("114年中華民國政府行政機關辦公日曆表(1141020更新)", "https://a/1020.csv")
    assert holidays.pick_resource(distribution, 115)[1] == "https://a/115.csv"
    with pytest.raises(holidays.HolidayYearNotPublished, match="116 年"):
        holidays.pick_resource(distribution, 116)


# ---------------------------------------------------------------------------
# 下載與上傳（只解析，不寫資料）
# ---------------------------------------------------------------------------


_REAL_NEW_CLIENT = holidays.new_client


def _fake_open_data(monkeypatch, handler) -> list[str]:
    requested: list[str] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return handler(request)

    monkeypatch.setattr(holidays, "new_client", lambda: _REAL_NEW_CLIENT(transport=httpx.MockTransport(recording_handler)))
    return requested


@pytest.mark.asyncio
async def test_fetch_downloads_next_years_calendar(admin_client, monkeypatch):
    year = today_local().year + 1
    roc = year - 1911
    csv_bytes = calendar_csv(year, {date(year, 1, 1): "開國紀念日"}).encode("utf-8-sig")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "data.gov.tw":
            return httpx.Response(200, json={"success": True, "result": {"distribution": [
                {"resourceDescription": f"{roc}年中華民國政府行政機關辦公日曆表", "resourceFormat": "CSV", "resourceDownloadUrl": "https://www.dgpa.gov.tw/FileConversion?filename=x.csv"},
            ]}})
        return httpx.Response(200, content=csv_bytes)

    requested = _fake_open_data(monkeypatch, handler)
    response = await admin_client.post(f"{API}/admin/holiday-calendar/fetch", json={"year": year})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "open_data"
    assert body["source_label"] == f"{roc}年中華民國政府行政機關辦公日曆表"
    assert body["years"] == [year]
    assert body["holidays"][0] == {"date": f"{year}-01-01", "name": "開國紀念日", "weekday": date(year, 1, 1).weekday()}
    assert requested == [holidays.DATASET_URL, "https://www.dgpa.gov.tw/FileConversion?filename=x.csv"]


@pytest.mark.asyncio
async def test_fetch_reports_unpublished_year_and_unreachable_source(admin_client, monkeypatch):
    year = today_local().year + 1
    _fake_open_data(monkeypatch, lambda request: httpx.Response(200, content=json.dumps({"result": {"distribution": []}})))
    missing = await admin_client.post(f"{API}/admin/holiday-calendar/fetch", json={"year": year})
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "HOLIDAY_YEAR_NOT_PUBLISHED"

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("reset", request=request)

    _fake_open_data(monkeypatch, unreachable)
    down = await admin_client.post(f"{API}/admin/holiday-calendar/fetch", json={"year": year})
    assert down.status_code == 502
    assert down.json()["detail"]["code"] == "HOLIDAY_SOURCE_UNAVAILABLE"
    assert down.json()["detail"]["message"] == "連不到政府資料開放平台，請改用上傳檔案"

    _fake_open_data(monkeypatch, lambda request: httpx.Response(503))
    assert (await admin_client.post(f"{API}/admin/holiday-calendar/fetch", json={"year": year})).status_code == 502


@pytest.mark.asyncio
async def test_fetch_refuses_files_outside_government_sites(admin_client, monkeypatch):
    """檔案網址來自資料集回應：不是 https 的 gov.tw 就不下載。"""
    year = today_local().year + 1
    roc = year - 1911
    for url in ("https://evil.example/x.csv", "http://www.dgpa.gov.tw/x.csv", "https://gov.tw.evil.example/x.csv"):
        requested = _fake_open_data(
            monkeypatch,
            lambda request, url=url: httpx.Response(200, json={"result": {"distribution": [
                {"resourceDescription": f"{roc}年中華民國政府行政機關辦公日曆表", "resourceFormat": "CSV", "resourceDownloadUrl": url},
            ]}}),
        )
        response = await admin_client.post(f"{API}/admin/holiday-calendar/fetch", json={"year": year})
        assert response.status_code == 502, url
        assert requested == [holidays.DATASET_URL], url


@pytest.mark.asyncio
async def test_fetch_only_accepts_this_year_and_next(admin_client):
    response = await admin_client.post(f"{API}/admin/holiday-calendar/fetch", json={"year": today_local().year + 2})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_YEAR"


@pytest.mark.asyncio
async def test_upload_parses_the_same_file(admin_client, editor_client):
    year = today_local().year + 1
    raw = calendar_csv(year, {date(year, 1, 1): "開國紀念日"}).encode("utf-8-sig")
    files = {"file": ("116年辦公日曆表.csv", raw, "text/csv")}

    response = await admin_client.post(f"{API}/admin/holiday-calendar/parse", files=files)
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "upload"
    assert response.json()["source_label"] == "116年辦公日曆表.csv"

    bad = await admin_client.post(f"{API}/admin/holiday-calendar/parse", files={"file": ("x.csv", b"a,b\r\n1,2\r\n", "text/csv")})
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "HOLIDAY_CSV_INVALID"

    # 內容編輯沒有 booking.manage。
    assert (await editor_client.post(f"{API}/admin/holiday-calendar/parse", files=files)).status_code == 403


# ---------------------------------------------------------------------------
# 套用
# ---------------------------------------------------------------------------


async def _exceptions(db_session, campus_key: str) -> dict[date, str | None]:
    rows = await db_session.execute(
        select(VisitException.exception_date, VisitException.reason).where(VisitException.campus_key == campus_key)
    )
    return dict(rows.all())


@pytest.mark.asyncio
async def test_dry_run_counts_without_writing(admin_client, db_session):
    holiday = _upcoming_weekday()
    past = today_local() - timedelta(days=3)

    response = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply",
        json={
            "campus_keys": ["yihua", "minghua"],
            "holidays": [{"date": holiday.isoformat(), "name": "中秋節"}, {"date": past.isoformat(), "name": "補假"}],
            "dry_run": True,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is True
    assert body["skipped_past"] == 1
    assert [c["campus_key"] for c in body["campuses"]] == ["minghua", "yihua"]
    assert all(c["created"] == 1 for c in body["campuses"])
    assert await _exceptions(db_session, "yihua") == {}
    assert (await db_session.scalar(select(AuditLogEntry.id).where(AuditLogEntry.action == "visit_exception.import_holidays"))) is None


@pytest.mark.asyncio
async def test_apply_creates_holidays_and_keeps_existing_ones(admin_client, db_session):
    first, second = _upcoming_weekday(10), _upcoming_weekday(20)
    existing = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": second.isoformat(), "reason": "教師研習"}
    )
    assert existing.status_code == 201

    response = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply",
        json={
            "campus_keys": ["yihua"],
            "holidays": [{"date": first.isoformat(), "name": "中秋節"}, {"date": second.isoformat(), "name": "補假"}],
            "dry_run": False,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["campuses"] == [
        {"campus_key": "yihua", "created": 1, "skipped_existing": 1, "skipped_weekend": 0, "affected_requests": 0, "affected_dates": []}
    ]
    db_session.expire_all()
    assert await _exceptions(db_session, "yihua") == {first: "中秋節（國定假日）", second: "教師研習"}
    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "visit_exception.import_holidays"))
    ).scalar_one()
    assert audit.campus_key == "yihua"
    assert audit.metadata_json["created"] == 1
    assert audit.metadata_json["date_from"] == first.isoformat()


@pytest.mark.asyncio
async def test_weekend_holidays_only_for_campuses_open_that_weekday(admin_client, db_session):
    # add_weekly_rule 給義華一條星期六的固定場次；明華沒有週末場次。
    await add_weekly_rule(admin_client, "yihua")
    saturday = today_local() + timedelta(days=14)
    while saturday.weekday() != 5:
        saturday += timedelta(days=1)

    response = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply",
        json={"campus_keys": ["yihua", "minghua"], "holidays": [{"date": saturday.isoformat(), "name": "國慶日"}], "dry_run": False},
    )

    assert response.status_code == 200, response.text
    by_campus = {c["campus_key"]: c for c in response.json()["campuses"]}
    assert by_campus["yihua"]["created"] == 1
    assert by_campus["minghua"]["skipped_weekend"] == 1
    db_session.expire_all()
    assert saturday in await _exceptions(db_session, "yihua")
    assert await _exceptions(db_session, "minghua") == {}
    # 義華那天依規則產生的場次跟著關掉，來源記休假。
    slots = (await db_session.execute(select(VisitSlot).where(VisitSlot.campus_key == "yihua", VisitSlot.slot_date == saturday))).scalars().all()
    assert slots and all(s.closed and s.closed_source == "exception" for s in slots)


@pytest.mark.asyncio
async def test_weekday_holidays_apply_even_without_weekly_rules(admin_client, db_session):
    """四校還沒設場次：先建好休假日，之後設了規則也不會在假日開出場次。"""
    holiday = _upcoming_weekday()
    response = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply",
        json={"campus_keys": ["renwu"], "holidays": [{"date": holiday.isoformat(), "name": "中秋節"}], "dry_run": False},
    )
    assert response.json()["campuses"][0]["created"] == 1


@pytest.mark.asyncio
async def test_apply_reports_bookings_already_on_a_new_holiday(admin_client, public_client, db_session):
    holiday = _upcoming_weekday(5)
    booked = await book_slot(admin_client, public_client, days_ahead=(holiday - today_local()).days)

    response = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply",
        json={"campus_keys": ["yihua"], "holidays": [{"date": holiday.isoformat(), "name": "補假"}], "dry_run": False},
    )

    assert response.json()["campuses"][0]["affected_requests"] == 1
    assert response.json()["campuses"][0]["affected_dates"] == [holiday.isoformat()]
    attention = await admin_client.get(f"{API}/admin/visit-requests?needs_attention=true")
    assert attention.status_code == 200, attention.text
    assert booked["receipt_id"] in [row["id"] for row in attention.json()]


@pytest.mark.asyncio
async def test_campus_admin_can_only_apply_to_own_campus(minghua_client):
    body = {"holidays": [{"date": _upcoming_weekday().isoformat(), "name": "中秋節"}], "dry_run": True}
    assert (await minghua_client.post(f"{API}/admin/holiday-calendar/apply", json={**body, "campus_keys": ["yihua"]})).status_code == 404
    assert (await minghua_client.post(f"{API}/admin/holiday-calendar/apply", json={**body, "campus_keys": ["minghua"]})).status_code == 200


@pytest.mark.asyncio
async def test_apply_validates_names_and_duplicates(admin_client):
    day = _upcoming_weekday().isoformat()
    dup = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply",
        json={"campus_keys": ["yihua"], "holidays": [{"date": day, "name": "a"}, {"date": day, "name": "b"}]},
    )
    assert dup.status_code == 422
    blank = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply", json={"campus_keys": ["yihua"], "holidays": [{"date": day, "name": "  "}]}
    )
    assert blank.status_code == 422
    control = await admin_client.post(
        f"{API}/admin/holiday-calendar/apply", json={"campus_keys": ["yihua"], "holidays": [{"date": day, "name": "a\x07"}]}
    )
    assert control.status_code == 422
