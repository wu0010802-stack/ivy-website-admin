"""園務系統拉官網招生資料的唯讀同步端點（2026-11-20，docs/specs/2026-11-20-ivy-management-sync-api.md）。

資料一律是合成的（測試幼生甲…、0900000001…），不放真實個資。"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, time as clock_time, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import event, update

from app.admissions.constants import ANONYMIZED_TEXT, MISSING_CHILD_NAME
from app.admissions.models import RecruitmentVisit
from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import today_local
from app.config import Settings
from app.integrations.ivy_management.cursor import Cursor, InvalidCursor
from app.main import create_app
from tests.conftest import _create_user, _logged_in_client, _test_settings, freeze_rate_limit_clock
from app.auth.models import Role

PATH = "/api/website/v1/integrations/ivy-management/leads"
KEY_HEADER = "X-Ivy-Integration-Key"
YIHUA_KEY = "yihua-sync-test-key-0001"
MINGHUA_KEY = "minghua-sync-test-key-0002"
BASE = datetime(2026, 11, 1, 2, 0, tzinfo=timezone.utc)


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


HASHES = {"yihua": _sha(YIHUA_KEY), "minghua": _sha(MINGHUA_KEY)}


def _settings(**overrides) -> Settings:
    values = _test_settings().model_dump()
    values.update(overrides)
    return Settings(**values)


@pytest_asyncio.fixture
async def sync_app():
    application = create_app(_settings(ivy_sync_key_hashes=json.dumps(HASHES)))
    yield application
    await application.state.rate_limit_engine.dispose()
    await application.state.engine.dispose()


@pytest_asyncio.fixture
async def sync_client(sync_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=sync_app), base_url="http://test") as client:
        yield client


def _get(client, campus="yihua", key=YIHUA_KEY, **params):
    headers = {KEY_HEADER: key} if key is not None else {}
    return client.get(PATH, params={"campus_key": campus, **params}, headers=headers)


# ------------------------------------------------------------------ 資料建立（直接寫 DB，created_at 可控）


def _request(index: int, *, campus="yihua", created_at=None, status="completed", slot_id=None, **kw) -> VisitRequest:
    return VisitRequest(
        id=uuid.uuid4(),
        campus_key=campus,
        idempotency_key=f"sync-test-{uuid.uuid4().hex}",
        payload_hash="0" * 64,
        config_version=0,
        parent_name=kw.pop("parent_name", f"測試家長{index}"),
        phone=kw.pop("phone", f"090000{index:04d}"),
        child_name=kw.pop("child_name", f"測試幼生{index}"),
        referral_sources=kw.pop("referral_sources", []),
        consent_given=True,
        status=status,
        source=kw.pop("source", "web"),
        slot_id=slot_id,
        created_at=created_at or BASE + timedelta(minutes=index),
        **kw,
    )


def _visit(index: int, *, campus="yihua", visit_request_id=None, created_at=None, **kw) -> RecruitmentVisit:
    created = created_at or BASE + timedelta(hours=1, minutes=index)
    values = {
        "id": uuid.uuid4(),
        "campus_key": campus,
        "visit_request_id": visit_request_id,
        "month": "115.11",
        "seq_no": str(index),
        "visit_date": date(2026, 11, 3),
        "child_name": f"測試幼生{index}",
        "phone": f"090000{index:04d}",
        "contact_name": f"測試家長{index}",
        "has_deposit": False,
        "enrolled": False,
        "transfer_term": False,
        "version": 1,
        "created_at": created,
        "updated_at": created + timedelta(minutes=5),
    }
    values.update(kw)
    return RecruitmentVisit(**values)


async def _save(db, *rows) -> None:
    db.add_all(rows)
    await db.commit()


async def _slot(db, slot_date: date, campus="yihua") -> VisitSlot:
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key=campus, slot_date=slot_date, start_time=clock_time(9, 0),
        end_time=clock_time(10, 0), capacity=9, closed=False, created_at=BASE,
    )
    await _save(db, slot)
    return slot


# ------------------------------------------------------------------ 設定


def test_settings_default_is_disabled():
    assert _settings().ivy_sync_enabled is False
    assert _settings(ivy_sync_key_hashes="").ivy_sync_enabled is False
    assert _settings(ivy_sync_key_hashes="{}").ivy_sync_enabled is False
    assert _settings(ivy_sync_key_hashes="  ").ivy_sync_hashes == {}


def test_settings_normalizes_hash_to_lowercase_and_reads_env(monkeypatch):
    upper = _sha("k").upper()
    monkeypatch.setenv("WEBSITE_IVY_SYNC_KEY_HASHES", json.dumps({"yihua": upper}))
    settings = Settings(**{k: v for k, v in _test_settings().model_dump().items() if k != "ivy_sync_key_hashes"})
    assert settings.ivy_sync_hashes == {"yihua": upper.lower()}
    assert settings.ivy_sync_enabled is True
    assert "ivy_sync_key_hashes" not in repr(settings)


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        '["a"]',
        '"yihua"',
        '{"nowhere": "%s"}' % ("a" * 64),
        '{"yihua": "short"}',
        '{"yihua": "%s"}' % ("g" * 64),
        '{"yihua": 123}',
        '{"yihua": "%s"}' % ("a" * 65),
    ],
)
def test_settings_rejects_bad_value_without_echoing_it(raw):
    with pytest.raises(ValidationError) as caught:
        _settings(ivy_sync_key_hashes=raw)
    message = str(caught.value)
    assert "WEBSITE_IVY_SYNC_KEY_HASHES" in message
    assert "a" * 40 not in message and "g" * 40 not in message


# ------------------------------------------------------------------ 掛載與驗證


async def test_disabled_feature_is_404(public_client):
    response = await public_client.get(PATH, params={"campus_key": "yihua"}, headers={KEY_HEADER: YIHUA_KEY})
    assert response.status_code == 404


async def test_works_when_admissions_disabled(db_session):
    """不綁 admissions_enabled：招生關閉時仍回預約資料（只是沒有招生訪視）。"""
    await _save(db_session, _request(1))
    application = create_app(_settings(ivy_sync_key_hashes=json.dumps(HASHES), admissions_enabled=False))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://test") as client:
            response = await _get(client)
    finally:
        await application.state.rate_limit_engine.dispose()
        await application.state.engine.dispose()
    assert response.status_code == 200, response.text
    assert [item["origin"] for item in response.json()["items"]] == ["visit_request"]


async def test_all_auth_failures_are_the_same_401(sync_client):
    cases = {
        "沒帶標頭": _get(sync_client, key=None),
        "金鑰不對": _get(sync_client, key="wrong-key"),
        "空金鑰": _get(sync_client, key=""),
        "別校的金鑰": _get(sync_client, campus="yihua", key=MINGHUA_KEY),
        "沒設定金鑰的校區": _get(sync_client, campus="renwu", key=YIHUA_KEY),
        "不認得的校區": _get(sync_client, campus="nowhere", key=YIHUA_KEY),
    }
    bodies = {}
    for name, pending in cases.items():
        response = await pending
        assert response.status_code == 401, (name, response.text)
        # request_id 每次請求都不同，其餘（錯誤碼與訊息）必須逐字相同。
        bodies[name] = {k: v for k, v in response.json()["detail"].items() if k != "request_id"}
    assert len({json.dumps(body, sort_keys=True) for body in bodies.values()}) == 1, bodies
    assert bodies["沒帶標頭"]["code"] == "INTEGRATION_AUTH_FAILED"


async def test_valid_admin_session_without_key_is_still_401(sync_app, db_session):
    await _create_user(db_session, "sync-admin@ivy.example", "super-admin-password-123", Role.SUPER_ADMIN)
    admin = await _logged_in_client(sync_app, "sync-admin@ivy.example", "super-admin-password-123")
    try:
        assert (await admin.get("/api/website/v1/auth/me")).status_code == 200
        response = await admin.get(PATH, params={"campus_key": "yihua"})
        assert response.status_code == 401
        # 帶了 session 又帶錯金鑰一樣 401。
        wrong = await admin.get(PATH, params={"campus_key": "yihua"}, headers={KEY_HEADER: "nope"})
        assert wrong.status_code == 401
    finally:
        await admin.aclose()


async def test_failed_attempts_are_rate_limited_per_source(sync_app, sync_client):
    freeze_rate_limit_clock(sync_app)
    for attempt in range(20):
        assert (await _get(sync_client, key="wrong")).status_code == 401, attempt
    limited = await _get(sync_client, key="wrong")
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) >= 1
    assert limited.json()["detail"]["code"] == "INTEGRATION_AUTH_RATE_LIMITED"
    # 擋的是「失敗」的猜測；有效金鑰不受來源失敗次數影響。
    assert (await _get(sync_client)).status_code == 200


async def test_success_does_not_count_toward_the_failure_limit(sync_app, sync_client):
    freeze_rate_limit_clock(sync_app)
    for _ in range(30):
        assert (await _get(sync_client)).status_code == 200
    assert (await _get(sync_client, key="wrong")).status_code == 401


async def test_auth_failure_logs_warning_without_key(sync_client, caplog):
    secret_attempt = "super-secret-attempt-value"
    with caplog.at_level("INFO", logger="app.integrations.ivy_management"):
        await _get(sync_client, key=secret_attempt)
        await _get(sync_client)
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    infos = [r for r in caplog.records if r.levelname == "INFO"]
    assert len(warnings) == 1 and "campus=yihua" in warnings[0].getMessage()
    assert secret_attempt not in caplog.text
    assert len(infos) == 1 and "campus=yihua" in infos[0].getMessage() and "count=0" in infos[0].getMessage()


# ------------------------------------------------------------------ 資料


async def test_response_shape_and_headers(sync_client, db_session):
    await _save(db_session, _request(1))
    response = await _get(sync_client)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["campus_key"] == "yihua"
    assert datetime.fromisoformat(body["as_of"]).tzinfo is not None
    assert body["next_cursor"] is None
    assert len(body["items"]) == 1
    # 錯誤回應也不快取。
    assert (await _get(sync_client, key="wrong")).headers["cache-control"] == "private, no-store"


async def test_campus_isolation(sync_client, db_session):
    yihua = _request(1, campus="yihua")
    minghua = _request(2, campus="minghua")
    manual_yihua = _visit(3, campus="yihua")
    manual_minghua = _visit(4, campus="minghua")
    await _save(db_session, yihua, minghua, manual_yihua, manual_minghua)

    mine = (await _get(sync_client, campus="yihua", key=YIHUA_KEY)).json()["items"]
    assert {item["id"] for item in mine} == {f"vr:{yihua.id}", f"rv:{manual_yihua.id}"}
    theirs = (await _get(sync_client, campus="minghua", key=MINGHUA_KEY)).json()["items"]
    assert {item["id"] for item in theirs} == {f"vr:{minghua.id}", f"rv:{manual_minghua.id}"}
    # A 校的金鑰拿不到 B 校的資料。
    assert (await _get(sync_client, campus="minghua", key=YIHUA_KEY)).status_code == 401


async def test_excluded_requests_and_their_visits_are_left_out(sync_client, db_session):
    kept = _request(1)
    excluded = _request(2, excluded_at=BASE, exclude_reason="test")
    visit_of_excluded = _visit(2, visit_request_id=excluded.id)
    await _save(db_session, kept, excluded)
    await _save(db_session, visit_of_excluded)
    body = (await _get(sync_client)).json()
    assert [item["id"] for item in body["items"]] == [f"vr:{kept.id}"]


async def test_request_with_visit_carries_deposit_enrollment_and_stage(sync_client, db_session):
    request = _request(1, status="completed")
    deposited = _visit(
        1, visit_request_id=request.id, has_deposit=True, grade="中班", address="測試路 1 號", district="測試區",
        source="親友介紹", referrer="測試介紹人", deposit_collector="測試收款人", notes="測試備註",
        parent_response="測試回應", birthday=date(2022, 3, 4), target_school_year=115, target_semester=2,
    )
    second = _request(2, status="completed")
    enrolled = _visit(2, visit_request_id=second.id, has_deposit=True, enrolled=True, enrolled_on=date(2026, 11, 10), transfer_term=True)
    third = _request(3, status="completed")
    withdrawn = _visit(3, visit_request_id=third.id, has_deposit=True, withdrawn_at=BASE, withdrawn_from="deposited")
    await _save(db_session, request, second, third)
    await _save(db_session, deposited, enrolled, withdrawn)

    items = {item["visit_request_id"]: item for item in (await _get(sync_client)).json()["items"]}
    one = items[str(request.id)]
    assert one["origin"] == "visit_request" and one["id"] == f"vr:{request.id}"
    assert one["recruitment_visit_id"] == str(deposited.id)
    assert one["booking_status"] == "completed" and one["booking_source"] == "web"
    assert one["stage"] == "deposited" and one["has_deposit"] is True and one["enrolled"] is False
    assert one["month"] == "115.11" and one["visit_date"] == "2026-11-03"
    assert one["child_name"] == "測試幼生1" and one["phone"] == "0900000001" and one["contact_name"] == "測試家長1"
    assert one["address"] == "測試路 1 號" and one["district"] == "測試區" and one["grade"] == "中班"
    assert one["source"] == "親友介紹" and one["referrer"] == "測試介紹人" and one["deposit_collector"] == "測試收款人"
    assert one["notes"] == "測試備註" and one["parent_response"] == "測試回應" and one["birthday"] == "2022-03-04"
    assert (one["target_school_year"], one["target_semester"]) == (115, 2)
    assert one["updated_at"] is not None and one["anonymized"] is False
    assert items[str(second.id)]["stage"] == "enrolled" and items[str(second.id)]["transfer_term"] is True
    assert items[str(third.id)]["stage"] == "withdrawn"


async def test_request_without_visit_uses_converted_fields_and_slot_date(sync_client, db_session):
    slot_day = today_local() + timedelta(days=7)
    slot = await _slot(db_session, slot_day)
    with_slot = _request(
        1, status="confirmed", slot_id=slot.id, child_birthdate=date(2022, 3, 4),
        referral_sources=["friends_family", "online"], questions="學費", expected_start="asap", source="phone",
    )
    without_slot = _request(2, status="cancelled", child_name=None)
    await _save(db_session, with_slot, without_slot)

    items = {item["visit_request_id"]: item for item in (await _get(sync_client)).json()["items"]}
    a = items[str(with_slot.id)]
    assert a["recruitment_visit_id"] is None and a["stage"] is None and a["updated_at"] is None and a["month"] is None
    assert a["booking_status"] == "confirmed" and a["booking_source"] == "phone"
    assert a["visit_date"] == slot_day.isoformat()
    assert a["child_name"] == "測試幼生1" and a["birthday"] == "2022-03-04" and a["grade"] is not None
    assert a["phone"] == "0900000001" and a["contact_name"] == "測試家長1"
    assert a["source"] == "親友介紹、網路上看到" and a["notes"] == "家長想了解：學費"
    assert a["target_school_year"] is not None and a["target_semester"] in (1, 2)
    for name in ("address", "district", "referrer", "deposit_collector", "parent_response"):
        assert a[name] is None, name
    assert (a["has_deposit"], a["enrolled"], a["transfer_term"]) == (False, False, False)

    b = items[str(without_slot.id)]
    # 沒有場次也沒有訪視：參觀日期是 null，不拿今天補；沒填姓名維持既有的佔位值。
    assert b["visit_date"] is None
    assert b["child_name"] == MISSING_CHILD_NAME
    assert b["booking_status"] == "cancelled"


async def test_manual_and_orphaned_visits_come_after_requests(sync_client, db_session):
    request = _request(1, created_at=BASE + timedelta(days=5))
    manual = _visit(1, created_at=BASE)  # 比預約早建立，仍排在第二段
    orphan = _visit(2, created_at=BASE + timedelta(minutes=1), visit_request_id=None, has_deposit=True, enrolled=True, enrolled_on=date(2026, 11, 9))
    await _save(db_session, request, manual, orphan)
    items = (await _get(sync_client)).json()["items"]
    assert [item["id"] for item in items] == [f"vr:{request.id}", f"rv:{manual.id}", f"rv:{orphan.id}"]
    first, second = items[1], items[2]
    assert first["origin"] == "manual_visit" and first["visit_request_id"] is None
    assert first["recruitment_visit_id"] == str(manual.id)
    assert first["booking_status"] is None and first["booking_source"] is None
    assert first["stage"] == "visited" and first["visit_date"] == "2026-11-03" and first["month"] == "115.11"
    assert second["stage"] == "enrolled"
    assert datetime.fromisoformat(first["created_at"]).tzinfo is not None


async def test_anonymized_rows_have_no_personal_data(sync_client, db_session):
    anonymized_request = _request(
        1, parent_name="（已依保存政策匿名化）", phone="0000000000", child_name=None, anonymized_at=BASE,
    )
    plain_request = _request(2, anonymized_at=None)
    visit_anonymized_only = _visit(
        2, visit_request_id=plain_request.id, anonymized_at=BASE, child_name=ANONYMIZED_TEXT, phone=None, contact_name=None,
        notes=None, district="測試區", source="親友介紹", has_deposit=True,
    )
    request_anonymized_only = _request(3, anonymized_at=BASE)
    live_visit = _visit(3, visit_request_id=request_anonymized_only.id, notes="還在的備註", referrer="測試介紹人", address="測試路 2 號")
    orphan = _visit(4, anonymized_at=BASE, child_name=ANONYMIZED_TEXT, phone=None, contact_name=None, district="測試區")
    await _save(db_session, anonymized_request, plain_request, request_anonymized_only)
    await _save(db_session, visit_anonymized_only, live_visit, orphan)

    response = await _get(sync_client)
    assert response.status_code == 200
    assert "0000000000" not in response.text and ANONYMIZED_TEXT not in response.text and "還在的備註" not in response.text
    assert MISSING_CHILD_NAME not in response.text
    items = response.json()["items"]
    assert len(items) == 4
    for item in items:
        assert item["anonymized"] is True, item["id"]
        for name in ("child_name", "birthday", "phone", "contact_name", "address", "notes", "parent_response", "referrer"):
            assert item[name] is None, (item["id"], name)
    by_id = {item["id"]: item for item in items}
    # 非個資欄位照常：行政區、來源、階段、金額旗標。
    assert by_id[f"vr:{plain_request.id}"]["district"] == "測試區"
    assert by_id[f"vr:{plain_request.id}"]["stage"] == "deposited"
    assert by_id[f"rv:{orphan.id}"]["district"] == "測試區"


async def test_pagination_walks_both_segments_without_gaps_or_duplicates(sync_client, db_session):
    # 同一個 created_at 的多筆預約，驗證 (created_at, id) 的游標不會漏掉或重複同時間的列。
    tied = [_request(index, created_at=BASE) for index in range(1, 5)]
    later = [_request(index, created_at=BASE + timedelta(minutes=index)) for index in range(5, 8)]
    manuals = [_visit(index, created_at=BASE + timedelta(seconds=index * 0)) for index in range(1, 4)]
    await _save(db_session, *tied, *later, *manuals)
    expected = {f"vr:{r.id}" for r in tied + later} | {f"rv:{v.id}" for v in manuals}
    assert len(expected) == 10

    reference = [item["id"] for item in (await _get(sync_client)).json()["items"]]
    assert set(reference) == expected and len(reference) == 10

    for limit in (1, 3, 4, 7, 9, 10, 11):
        seen: list[str] = []
        cursor = None
        pages = 0
        while True:
            params = {"limit": limit, **({"cursor": cursor} if cursor else {})}
            body = (await _get(sync_client, **params)).json()
            assert len(body["items"]) <= limit
            seen.extend(item["id"] for item in body["items"])
            pages += 1
            assert pages < 30
            cursor = body["next_cursor"]
            if cursor is None:
                break
        assert seen == reference, f"limit={limit}"
        # 取滿剛好一頁時，最後一頁游標就是 null，不多出空頁。
        if limit >= 10:
            assert pages == 1


async def test_pagination_cursor_stays_valid_when_rows_arrive_between_pages(sync_client, db_session):
    first = [_request(index) for index in range(1, 4)]
    await _save(db_session, *first)
    page_one = (await _get(sync_client, limit=2)).json()
    assert len(page_one["items"]) == 2 and page_one["next_cursor"]
    late = _request(9, created_at=BASE + timedelta(days=1))
    await _save(db_session, late)
    page_two = (await _get(sync_client, limit=2, cursor=page_one["next_cursor"])).json()
    assert [item["id"] for item in page_two["items"]] == [f"vr:{first[2].id}", f"vr:{late.id}"]
    assert page_two["next_cursor"] is None


@pytest.mark.parametrize("cursor", ["!!!", "abc", "e30", "bm90LWpzb24", "x" * 300])
async def test_garbage_cursor_is_422_after_auth(sync_client, cursor):
    response = await _get(sync_client, cursor=cursor)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_CURSOR"
    # 沒有金鑰的人看不到這個 422。
    assert (await _get(sync_client, key=None, cursor=cursor)).status_code == 401


@pytest.mark.parametrize("limit", [0, -1, 201, "abc"])
async def test_limit_out_of_range_is_422(sync_client, limit):
    assert (await _get(sync_client, limit=limit)).status_code == 422


async def test_campus_key_is_required(sync_client):
    response = await sync_client.get(PATH, headers={KEY_HEADER: YIHUA_KEY})
    assert response.status_code == 422


def test_cursor_round_trip_and_rejects_naive_time():
    stamp = datetime(2026, 11, 1, 2, 3, 4, 567890, tzinfo=timezone(timedelta(hours=8)))
    row_id = uuid.uuid4()
    decoded = Cursor.decode(Cursor("rv", stamp, row_id).encode())
    assert decoded.segment == "rv" and decoded.row_id == row_id and decoded.created_at == stamp
    import base64

    naive = base64.urlsafe_b64encode(json.dumps({"s": "vr", "t": "2026-11-01T00:00:00", "i": str(row_id)}).encode()).decode()
    with pytest.raises(InvalidCursor):
        Cursor.decode(naive)


async def test_query_count_does_not_grow_with_rows(sync_app, sync_client, db_session):
    slot = await _slot(db_session, today_local() + timedelta(days=3))
    requests = [_request(index, slot_id=slot.id) for index in range(1, 31)]
    visits = [_visit(index, visit_request_id=r.id) for index, r in enumerate(requests[:15], start=1)]
    manuals = [_visit(100 + index) for index in range(5)]
    await _save(db_session, *requests)
    await _save(db_session, *visits, *manuals)

    statements: list[str] = []

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(sync_app.state.engine.sync_engine, "before_cursor_execute", count)
    try:
        body = (await _get(sync_client)).json()
    finally:
        event.remove(sync_app.state.engine.sync_engine, "before_cursor_execute", count)
    assert len(body["items"]) == 35
    # 預約、訪視、場次各一次，加上第二段的手動訪視；與列數無關。
    assert len(statements) <= 5, statements


async def test_route_is_not_session_guarded_and_ignores_cookies(sync_client):
    """機器端點：不看後台 session cookie，帶亂寫的 cookie 也不影響結果。"""
    sync_client.cookies.set("ivy_admin_session", "not-a-session")
    assert (await _get(sync_client)).status_code == 200
    assert (await _get(sync_client, key=None)).status_code == 401
