"""幼兒園評鑑同步（2026-10-20 規格 C5–C9）。HTTP 一律用 MockTransport（假教保資訊網，見 tests/geo_helpers.py），不連外。

重點：搜尋結果區塊裡的負責人姓名與電話一定不能進資料庫、日誌、狀態列的錯誤訊息；換頁表單要把上一頁的隱藏欄位帶回去。"""

from __future__ import annotations

import logging
import ssl
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text, update

from app.admissions.geo import evaluations as ev
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenEvaluation
from app.admissions.geo.sync import run_geo_sync
from app.common.timezones import today_local
from tests.geo_helpers import (
    FAKE_PERSON_NAMES, FAKE_PHONES, FIXTURES, EvaluationConfig, default_evaluation_schools, evaluation_response,
)
from tests.test_geo_sync import _site, _status, _sync, small_minimum  # noqa: F401

CHANGCHUN = "高雄市私立常春藤幼兒園"
YIHUA = "高雄市私立義華幼兒園"


@pytest.fixture(autouse=True)
def _sleeps(monkeypatch):
    waited: list[float] = []

    async def record(seconds: float) -> None:
        waited.append(seconds)

    monkeypatch.setattr(sync, "_sleep", record)
    return waited


class EvaluationSite:
    """假教保資訊網加 test_geo_sync 的 _site（其他資料）。config 決定頁面內容；statuses 讓指定的請求回錯誤。"""

    def __init__(self, config: EvaluationConfig | None = None, *, fail_with: int | None = None, fail_on_post: int | None = None, connect_error: str | None = None, **site):
        self.config = config or EvaluationConfig()
        self.fail_with, self.fail_on_post, self.connect_error = fail_with, fail_on_post, connect_error
        self.requests: list[str] = []  # "GET" 或 "POST"
        self._base, _ = _site(**site)

    def handle(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) != ev.SEARCH_URL:
            return self._base.handler(request)
        self.requests.append(request.method)
        if self.connect_error is not None:
            raise httpx.ConnectError(self.connect_error)
        if self.fail_with is not None:
            return httpx.Response(self.fail_with)
        if request.method == "POST" and self.fail_on_post == len(self.config.posts) + 1:
            return httpx.Response(500, text="boom")
        return evaluation_response(request, self.config)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


async def _rows(app) -> list[GeoKindergartenEvaluation]:
    async with app.state.session_factory() as db:
        result = await db.execute(
            select(GeoKindergartenEvaluation).order_by(GeoKindergartenEvaluation.school_name, GeoKindergartenEvaluation.school_year.desc())
        )
        return list(result.scalars())


async def _source_id(app, name: str) -> str:
    async with app.state.session_factory() as db:
        return (await db.execute(select(GeoKindergarten.source_id).where(GeoKindergarten.name == name))).scalar_one()


async def _age_status(app, days: int) -> None:
    old = datetime.now(timezone.utc) - timedelta(days=days)
    async with app.state.session_factory() as db:
        await db.execute(
            update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergarten_evaluations").values(checked_at=old, synced_at=old)
        )
        await db.commit()


async def _everything_stored(app) -> str:
    async with app.state.session_factory() as db:
        parts = (await db.execute(text("SELECT row_to_json(t)::text FROM geo_kindergarten_evaluations t"))).scalars().all() + (
            await db.execute(text("SELECT row_to_json(t)::text FROM geo_dataset_status t"))
        ).scalars().all()
    return "\n".join(parts)


async def test_first_sync_walks_every_page_and_stores_the_evaluations_of_known_schools(app, small_minimum, _sleeps, monkeypatch):
    monkeypatch.setattr(sync, "EVALUATIONS_REQUEST_GAP_SECONDS", 1.0)  # small_minimum 把它降成 0；這裡驗間隔
    site = EvaluationSite()
    result = await _sync(app, site.transport)
    assert result.kindergartens == "updated" and result.kindergarten_evaluations == "updated"
    # 一次 GET、一次搜尋 POST、換頁 POST 兩次（共 3 頁）
    assert site.requests == ["GET", "POST", "POST", "POST"]
    assert [fields.get("PageControl1$txtPages") for fields in site.config.posts] == [None, "1", "2"]
    assert result.kindergarten_evaluation_rows == 3
    rows = await _rows(app)
    assert [(row.school_name, row.school_year, row.result) for row in rows] == [
        (CHANGCHUN, 112, "全數指標通過追蹤評鑑"), (CHANGCHUN, 107, "全數指標通過基礎評鑑"), (YIHUA, 114, "部分指標通過基礎評鑑"),
    ]
    assert rows[0].completed_on == date(2025, 5, 16)
    assert {row.source_id for row in rows if row.school_name == CHANGCHUN} == {await _source_id(app, CHANGCHUN)}
    assert {row.source_id for row in rows if row.school_name == YIHUA} == {await _source_id(app, YIHUA)}
    status = await _status(app, "kindergarten_evaluations")
    assert status.label == status.active_version == today_local().isoformat() and status.last_error is None
    assert result.kindergarten_evaluations_version == today_local().isoformat()
    # 請求之間隔 1 秒（政府站放慢）：GET 與搜尋之間一次、之後每換一頁一次
    assert _sleeps.count(1.0) == 3


async def test_the_search_post_is_a_kaohsiung_search_with_the_view_state_from_the_form_page(app, small_minimum):
    site = EvaluationSite()
    await _sync(app, site.transport)
    first = site.config.posts[0]
    assert first["ddlCityS"] == "18" and first["ddlKey"] == "school_name" and first["txtKeyNameS"] == ""
    assert first["btnSearch"] == "搜尋" and first["__VIEWSTATE"] == "VS-0"
    assert "__EVENTTARGET" not in first


async def test_charge_names_and_phones_never_reach_the_database_the_logs_or_the_status(app, small_minimum, caplog):
    caplog.set_level(logging.DEBUG)
    result = await _sync(app, EvaluationSite().transport)
    stored = await _everything_stored(app)
    logged = "\n".join(record.getMessage() for record in caplog.records) + "\n" + caplog.text
    for secret in (*FAKE_PERSON_NAMES, *FAKE_PHONES, "SECRETSESSION"):
        assert secret not in stored and secret not in logged and secret not in repr(result)


async def test_errors_do_not_echo_the_page_content(app, small_minimum, caplog):
    caplog.set_level(logging.DEBUG)
    config = EvaluationConfig(stuck=True)
    result = await _sync(app, EvaluationSite(config).transport)
    assert result.kindergarten_evaluations == "failed"
    error = (await _status(app, "kindergarten_evaluations")).last_error
    assert error == "換頁後頁碼對不上"
    for secret in (*FAKE_PERSON_NAMES, *FAKE_PHONES):
        assert secret not in error and secret not in caplog.text


async def test_second_sync_within_thirty_days_does_not_fetch_again(app, small_minimum):
    site = EvaluationSite()
    await _sync(app, site.transport)
    site.requests.clear()
    await _age_status(app, 29)
    result = await _sync(app, site.transport)
    assert result.kindergarten_evaluations == "skipped" and site.requests == []


async def test_after_thirty_days_the_table_is_replaced(app, small_minimum):
    await _sync(app, EvaluationSite().transport)
    await _age_status(app, 31)
    schools = default_evaluation_schools()
    schools[0] = (CHANGCHUN, [("114", "2026-10-01".replace("-", "/"), "全數指標通過基礎評鑑")])
    schools[1] = (YIHUA, [])  # 義華這次沒有評鑑
    result = await _sync(app, EvaluationSite(EvaluationConfig(schools=schools)).transport)
    assert result.kindergarten_evaluations == "updated" and result.kindergarten_evaluation_rows == 1
    assert [(row.school_name, row.school_year) for row in await _rows(app)] == [(CHANGCHUN, 114)]


async def test_force_fetches_even_when_not_due(app, small_minimum):
    site = EvaluationSite()
    await _sync(app, site.transport)
    site.requests.clear()
    result = await _sync(app, site.transport, force=True)
    assert result.kindergarten_evaluations == "updated" and site.requests


async def test_a_search_result_with_too_few_schools_or_pages_keeps_the_old_rows(app, small_minimum, monkeypatch):
    await _sync(app, EvaluationSite().transport)
    before = len(await _rows(app))
    await _age_status(app, 31)
    monkeypatch.setattr(sync, "EVALUATIONS_MIN_SCHOOLS", 26)  # 假站只有 25 所
    result = await _sync(app, EvaluationSite().transport)
    assert result.kindergarten_evaluations == "failed" and len(await _rows(app)) == before
    assert (await _status(app, "kindergarten_evaluations")).last_error == "評鑑搜尋結果只有 25 所、3 頁，少於 26 所或 1 頁，疑似殘缺，未更新"
    monkeypatch.setattr(sync, "EVALUATIONS_MIN_SCHOOLS", 1)
    monkeypatch.setattr(sync, "EVALUATIONS_MIN_PAGES", 4)
    result = await _sync(app, EvaluationSite().transport, force=True)
    assert result.kindergarten_evaluations == "failed" and len(await _rows(app)) == before


async def test_the_real_limits_are_the_ones_in_the_spec():
    """規格 C8、C9：600 所、60 頁；單頁 2 MB、整輪 15 分鐘、請求間隔 1 秒。"""
    assert (sync.EVALUATIONS_MIN_SCHOOLS, sync.EVALUATIONS_MIN_PAGES) == (600, 60)
    assert sync.EVALUATIONS_MAX_BYTES == 2 * 1024 * 1024 and sync.EVALUATIONS_TIME_BUDGET == timedelta(minutes=15)
    assert sync.EVALUATIONS_REQUEST_GAP_SECONDS == 1.0


async def test_a_server_that_ignores_paging_fails_instead_of_looping(app, small_minimum):
    site = EvaluationSite(EvaluationConfig(stuck=True))
    result = await _sync(app, site.transport)
    assert result.kindergarten_evaluations == "failed" and await _rows(app) == []
    assert site.requests == ["GET", "POST", "POST"]  # 第 2 頁拿到第 1 頁就中止


async def test_a_form_page_without_view_state_fails(app, small_minimum):
    result = await _sync(app, EvaluationSite(EvaluationConfig(drop_view_state=True)).transport)
    assert result.kindergarten_evaluations == "failed"
    assert (await _status(app, "kindergarten_evaluations")).last_error == "搜尋頁沒有表單欄位"


async def test_a_failed_page_request_keeps_the_old_rows_and_reports_the_status_code(app, small_minimum):
    await _sync(app, EvaluationSite().transport)
    before = [(row.school_name, row.school_year) for row in await _rows(app)]
    await _age_status(app, 31)
    site = EvaluationSite(fail_on_post=2)  # 第二個 POST（換到第 2 頁）回 500
    result = await _sync(app, site.transport)
    assert result.kindergarten_evaluations == "failed"
    assert [(row.school_name, row.school_year) for row in await _rows(app)] == before
    assert (await _status(app, "kindergarten_evaluations")).last_error == "下載失敗：HTTP 500"


async def test_the_form_page_returning_an_error_fails(app, small_minimum):
    result = await _sync(app, EvaluationSite(fail_with=503).transport)
    assert result.kindergarten_evaluations == "failed"
    assert (await _status(app, "kindergarten_evaluations")).last_error == "下載失敗：HTTP 503"


async def test_a_certificate_failure_is_reported_as_such(app, small_minimum):
    site = EvaluationSite(connect_error="[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate")
    result = await _sync(app, site.transport)
    assert result.kindergarten_evaluations == "failed"
    assert (await _status(app, "kindergarten_evaluations")).last_error == "憑證驗證失敗（TLS）"


async def test_a_page_over_the_size_cap_fails(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "EVALUATIONS_MAX_BYTES", 200)
    result = await _sync(app, EvaluationSite().transport)
    assert result.kindergarten_evaluations == "failed"
    assert (await _status(app, "kindergarten_evaluations")).last_error == "上游回應超過大小上限，已中止"


async def test_an_absurd_page_count_fails(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "EVALUATIONS_MAX_PAGES", 2)
    result = await _sync(app, EvaluationSite().transport)  # 假站有 3 頁
    assert result.kindergarten_evaluations == "failed"
    assert (await _status(app, "kindergarten_evaluations")).last_error == "搜尋結果的頁數大得不合理"


async def test_running_out_of_time_fails_the_round(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "EVALUATIONS_TIME_BUDGET", timedelta(0))
    result = await _sync(app, EvaluationSite().transport)
    assert result.kindergarten_evaluations == "failed" and await _rows(app) == []
    assert (await _status(app, "kindergarten_evaluations")).last_error.startswith("評鑑同步超過")


async def test_evaluations_are_not_fetched_when_the_school_list_failed(app, small_minimum):
    site = EvaluationSite(kiang=b"not json")
    result = await _sync(app, site.transport)
    assert (result.kindergartens, result.kindergarten_evaluations) == ("failed", "skipped")
    assert site.requests == []


async def test_a_school_listed_twice_merges_and_the_same_year_and_result_keeps_the_latest_date(app, small_minimum):
    schools = [
        (CHANGCHUN, [("112", "2025/05/16", "全數指標通過追蹤評鑑")]),
        (CHANGCHUN, [("112", "2025/06/20", "全數指標通過追蹤評鑑"), ("107", "2018/10/11", "全數指標通過基礎評鑑")]),
    ]
    result = await _sync(app, EvaluationSite(EvaluationConfig(schools=schools)).transport)
    assert result.kindergarten_evaluation_rows == 2
    rows = await _rows(app)
    assert [(row.school_year, row.completed_on) for row in rows] == [(112, date(2025, 6, 20)), (107, date(2018, 10, 11))]


async def test_rows_are_inserted_in_chunks(app, small_minimum, monkeypatch):
    monkeypatch.setattr(ev, "INSERT_CHUNK", 1)
    result = await _sync(app, EvaluationSite().transport)
    assert result.kindergarten_evaluation_rows == 3 and len(await _rows(app)) == 3


async def test_a_database_error_while_writing_fails_only_the_evaluations(app, small_minimum, monkeypatch):
    def blow_up(*args, **kwargs):
        raise RuntimeError("資料庫寫入壞掉")

    monkeypatch.setattr(ev, "pg_insert", blow_up)
    result = await _sync(app, EvaluationSite().transport)
    assert (result.kindergartens, result.kindergarten_evaluations) == ("updated", "failed")
    assert (await _status(app, "kindergarten_evaluations")).last_error == "下載或匯入失敗：RuntimeError"


async def test_when_it_builds_its_own_client_the_evaluation_requests_use_the_bundled_intermediate_certificate(app, small_minimum, monkeypatch):
    """沒注入客戶端時（正式站的背景同步、CLI）：評鑑用專用客戶端，帶 certifi＋中繼憑證的 SSL 設定；其他資料照舊用預設的客戶端。"""
    site = EvaluationSite()
    made: list[dict] = []
    real_new_client = sync.new_client

    def fake_new_client(**kwargs):
        made.append(kwargs)
        return httpx.AsyncClient(transport=site.transport, headers={"User-Agent": sync.USER_AGENT})

    monkeypatch.setattr(sync, "new_client", fake_new_client)
    result = await run_geo_sync(app.state.session_factory, app.state.settings)
    assert result.kindergarten_evaluations == "updated" and result.kindergarten_evaluation_rows == 3
    with_context = [kwargs for kwargs in made if kwargs.get("ssl_context") is not None]
    assert len(with_context) == 1 and len(made) == 2
    context = with_context[0]["ssl_context"]
    assert isinstance(context, ssl.SSLContext) and context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    # 真的客戶端：預設驗證憑證，會用這個 context
    client = real_new_client(ssl_context=ev.ssl_context())
    try:
        assert client.headers["User-Agent"] == sync.USER_AGENT
    finally:
        await client.aclose()


async def test_file_mode_imports_the_bundled_csv_without_touching_the_network(app, small_minimum, tmp_path):
    schools = {name: [ev.Evaluation(int(y), date(*map(int, d.split("/"))), r) for y, d, r in items] for name, items in default_evaluation_schools()}
    path = tmp_path / "kindergarten-evaluations.csv"
    path.write_text(ev.rows_to_csv(schools), encoding="utf-8")
    assert "負責" not in path.read_text(encoding="utf-8")
    site = EvaluationSite()
    result = await _sync(app, site.transport, kindergarten_evaluations_file=path)
    assert result.kindergarten_evaluations == "updated" and site.requests == []
    assert result.kindergartens == "skipped"
    assert len(await _rows(app)) == 0  # 沒有園所資料可比對，名稱對不到的不存


async def test_file_mode_matches_schools_that_are_already_imported(app, small_minimum, tmp_path):
    await _sync(app, EvaluationSite(fail_with=500).transport)  # 先匯入幼兒園名單（評鑑這輪失敗沒關係）
    schools = {CHANGCHUN: [ev.Evaluation(112, date(2025, 5, 16), "全數指標通過追蹤評鑑")]}
    path = tmp_path / "e.csv"
    path.write_text(ev.rows_to_csv(schools), encoding="utf-8")
    result = await _sync(app, EvaluationSite().transport, kindergarten_evaluations_file=path)
    assert result.kindergarten_evaluations == "updated" and result.kindergarten_evaluation_rows == 1
    assert [row.source_id for row in await _rows(app)] == [await _source_id(app, CHANGCHUN)]


async def test_a_broken_csv_fails_without_echoing_the_content(app, small_minimum, tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text(f"<html>{FAKE_PERSON_NAMES[0]}{FAKE_PHONES[0]}</html>", encoding="utf-8")
    result = await _sync(app, EvaluationSite().transport, kindergarten_evaluations_file=path)
    assert result.kindergarten_evaluations == "failed"
    error = (await _status(app, "kindergarten_evaluations")).last_error
    assert error == "評鑑檔不是預期的格式" and FAKE_PERSON_NAMES[0] not in error


async def test_the_fixtures_directory_has_no_saved_search_page():
    """真的搜尋頁含負責人姓名與電話，不進 repo。"""
    assert not [path for path in FIXTURES.iterdir() if "pubsearch" in path.name.lower() or "evaluation" in path.name.lower()]
