"""各里綜合所得（2026-10-14 里的變化規格 §2.3、§3.3、§4.4）：CSV 解析與驗證、data.gov.tw 找新年度、
讀不到時直接試財政資訊中心、404＝還沒出、連線被 reset 重試、年度不倒退、檔案匯入、CLI 與打包檔。
HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app import cli
from app.admissions.geo import income as income_io
from app.admissions.geo import sync
from app.admissions.geo.bundle import BundleError, BundleFile, open_bundle, write_bundle
from app.admissions.geo.models import GeoDatasetStatus, GeoVillageIncome
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import INCOME_SAMPLE, INCOME_SAMPLE_VILLAGES, datagov_income_listing

TODAY = date(2026, 10, 14)
BENYANG = "64000050015"  # 三民區本揚里


@pytest.fixture
def few_villages(monkeypatch):
    """樣本只有 24 個里；下限降到 1。"""
    monkeypatch.setattr(income_io, "MIN_VILLAGES", 1)


@pytest.fixture
def october(monkeypatch):
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


@pytest.fixture
def no_wait(monkeypatch):
    waits: list[float] = []

    async def record(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(sync, "_sleep", record)
    return waits


def _sample_text() -> str:
    return INCOME_SAMPLE.read_bytes().decode("utf-8")


def _site(*, listed: list[int] | None = (112,), csv_years: set[int] = frozenset({112}), datagov_down: bool = False):
    """假的 data.gov.tw 與財政資訊中心：listed 是資料集列出的年度；csv_years 是財政資訊中心有檔的年度
    （其他年度回 404，和真的一樣是一小段 HTML）。"""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        if url == income_io.DATASET_API:
            if datagov_down:
                return httpx.Response(503, text="<html>maintenance</html>")
            return httpx.Response(200, json=datagov_income_listing(list(listed or [])))
        year = income_io.year_of_url(url)
        if year is not None:
            if year in csv_years:
                return httpx.Response(200, content=INCOME_SAMPLE.read_bytes(), headers={"content-type": "text/csv"})
            return httpx.Response(404, text="error page!", headers={"content-type": "text/html"})
        return httpx.Response(404)

    return httpx.MockTransport(handle), seen


async def _sync(app, transport, **kwargs) -> tuple[str, int]:
    async with httpx.AsyncClient(transport=transport) as client:
        return await sync.sync_income(
            app.state.session_factory, client, now=kwargs.pop("now", datetime.now(timezone.utc)),
            force=kwargs.pop("force", False), file=None, file_year=None,
        )


async def _status(app) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, "income")


async def _rows(app) -> dict[str, GeoVillageIncome]:
    async with app.state.session_factory() as db:
        return {row.village_code: row for row in (await db.execute(select(GeoVillageIncome))).scalars()}


# ---- 解析與驗證 ----


def test_parse_the_sample(few_villages):
    batch = income_io.parse_csv(_sample_text(), 112)
    assert (batch.year, len(batch.rows), batch.skipped) == (112, INCOME_SAMPLE_VILLAGES, 1)  # 慈愛里對不到里界
    row = next(row for row in batch.rows if row.village_code == BENYANG)
    assert (row.district, row.village, row.year) == ("三民區", "本揚里", 112)
    assert row.median > 0 and row.q1 <= row.median <= row.q3 and row.taxpayers > 0
    # 「其他」「合計」「高雄市其他」都不是里。
    assert {row.village for row in batch.rows}.isdisjoint({"其他", "合計"})


def test_parse_accepts_the_older_header_and_plain_bom(few_villages):
    """109 年度第一欄叫「鄉鎮市區」、BOM 不在引號裡；欄名寫錯（110 年度起的「縣市別」）也只看位置。"""
    lines = _sample_text().split("\r\n")
    older = "\ufeff" + lines[0].replace("\ufeff縣市別", "鄉鎮市區") + "\r\n" + "\r\n".join(lines[1:])
    assert len(income_io.parse_csv(older, 109).rows) == INCOME_SAMPLE_VILLAGES


def test_parse_rounds_amounts_written_with_decimals(few_villages):
    lines = _sample_text().split("\r\n")
    index = next(i for i, line in enumerate(lines) if '"本揚里"' in line)
    cells = lines[index].split('","')
    cells[5] = "512.50"  # 中位數
    cells[2] = "1234.00"  # 納稅單位
    lines[index] = '","'.join(cells)
    row = next(row for row in income_io.parse_csv("\r\n".join(lines), 112).rows if row.village_code == BENYANG)
    assert (row.median, row.taxpayers) == (513, 1234)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("<html><body>系統訊息</body></html>", "表頭不對"),
        ("", "空的"),
        ('"縣市別","村里","中位數"\r\n"高雄市三民區","本揚里","500"\r\n', "表頭不對"),
    ],
)
def test_parse_rejects_error_pages(text, message):
    with pytest.raises(income_io.IncomeFormatError, match=message):
        income_io.parse_csv(text, 112)


@pytest.mark.parametrize("bad", ["-5", "abc", "1e3", "²"])
def test_parse_rejects_amounts_that_are_not_plain_numbers(few_villages, bad):
    text = _sample_text()
    lines = text.split("\r\n")
    index = next(i for i, line in enumerate(lines) if '"本揚里"' in line)
    cells = lines[index].split('","')
    cells[5] = bad
    lines[index] = '","'.join(cells)
    with pytest.raises(income_io.IncomeFormatError, match="中位數"):
        income_io.parse_csv("\r\n".join(lines), 112)


def test_parse_rejects_a_village_listed_twice(few_villages):
    lines = _sample_text().split("\r\n")
    line = next(line for line in lines if '"本揚里"' in line)
    with pytest.raises(income_io.IncomeFormatError, match="重複"):
        income_io.parse_csv("\r\n".join([*lines[:-1], line, ""]), 112)


def test_parse_requires_enough_villages_on_the_boundary_file():
    with pytest.raises(income_io.IncomeFormatError, match=f"只有 {INCOME_SAMPLE_VILLAGES} 個里"):
        income_io.parse_csv(_sample_text(), 112)


def test_years_listed_only_trusts_kaohsiung_files_on_fia():
    data = datagov_income_listing([110, 112, 111])
    data["result"]["distribution"] += [
        {"resourceDownloadUrl": "http://www.fia.gov.tw/WEB/fia/ias/ias113/113_165-E.csv"},  # 不是 https
        {"resourceDownloadUrl": "https://example.org/WEB/fia/ias/ias114/114_165-E.csv"},
        {"resourceDownloadUrl": "https://www.fia.gov.tw/WEB/fia/ias/ias114/114_165-A.csv"},  # 臺北市
        {"resourceDownloadUrl": "https://www.fia.gov.tw/WEB/fia/ias/ias114/113_165-E.csv"},  # 年度對不起來
        "not an object",
    ]
    assert income_io.years_listed(data) == [112, 111, 110]
    with pytest.raises(income_io.IncomeFormatError):
        income_io.years_listed({"result": {}})


def test_year_of_filename():
    assert income_io.year_of_filename("112_165-E.csv") == 112
    assert income_io.year_of_filename("/data/fia-112_165-e.csv") == 112
    assert income_io.year_of_filename("income.csv") is None


def test_citation_names_the_agency_year_and_the_official_note():
    text = income_io.citation(112, datetime(2026, 10, 14, tzinfo=timezone.utc))
    assert text.startswith("資料來源：財政部財政資訊中心（2026）綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市（112年度）")
    assert "不宜逕作為衡量所得差距之參據" in text
    assert income_io.citation(None, None) == ""


# ---- 網路同步 ----


async def test_first_sync_finds_the_latest_year_on_datagov(app, few_villages):
    transport, seen = _site(listed=[110, 111, 112])
    assert await _sync(app, transport) == ("updated", 1)
    assert seen == [income_io.DATASET_API, income_io.csv_url(112)]
    rows = await _rows(app)
    assert len(rows) == INCOME_SAMPLE_VILLAGES and rows[BENYANG].year == 112
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("112", "112", None)


async def test_within_30_days_does_not_go_online(app, few_villages):
    transport, seen = _site()
    await _sync(app, transport)
    seen.clear()
    assert await _sync(app, transport) == ("skipped", 0)
    assert seen == []


async def test_no_newer_year_only_records_the_check(app, few_villages):
    transport, seen = _site()
    now = datetime.now(timezone.utc)
    await _sync(app, transport, now=now)
    seen.clear()
    later = now + timedelta(days=31)
    assert await _sync(app, transport, now=later) == ("skipped", 0)
    assert seen == [income_io.DATASET_API]
    status = await _status(app)
    assert status.checked_at == later and status.synced_at == now


async def test_an_older_year_listed_on_datagov_never_replaces_the_one_in_use(app, few_villages):
    transport, _ = _site()
    now = datetime.now(timezone.utc)
    await _sync(app, transport, now=now)
    transport, seen = _site(listed=[110, 111], csv_years={110, 111})
    assert await _sync(app, transport, now=now + timedelta(days=31)) == ("skipped", 0)
    assert seen == [income_io.DATASET_API]
    assert (await _status(app)).active_version == "112"


async def test_force_downloads_the_year_in_use_again(app, few_villages):
    transport, seen = _site()
    await _sync(app, transport)
    seen.clear()
    assert await _sync(app, transport, force=True) == ("updated", 1)
    assert seen == [income_io.DATASET_API, income_io.csv_url(112)]


async def test_datagov_down_falls_back_to_guessing_years_on_fia(app, few_villages, october):
    """data.gov.tw 讀不到、表是空的：從今年（115）往回 2～4 年試，113 是 404（還沒出）、112 有。"""
    transport, seen = _site(datagov_down=True)
    assert await _sync(app, transport) == ("updated", 1)
    assert seen == [income_io.DATASET_API, income_io.csv_url(113), income_io.csv_url(112)]


async def test_datagov_down_and_next_year_not_out_is_only_a_check(app, few_villages):
    transport, _ = _site()
    now = datetime.now(timezone.utc)
    await _sync(app, transport, now=now)
    transport, seen = _site(datagov_down=True)
    assert await _sync(app, transport, now=now + timedelta(days=31)) == ("skipped", 0)
    assert seen == [income_io.DATASET_API, income_io.csv_url(113)]
    status = await _status(app)
    assert status.last_error is None and status.active_version == "112"


async def test_nothing_found_with_an_empty_table_fails(app, few_villages, october):
    transport, _ = _site(datagov_down=True, csv_years=set())
    assert await _sync(app, transport) == ("failed", 0)
    assert "找不到" in (await _status(app)).last_error


async def test_a_reset_connection_is_retried(app, few_villages, no_wait):
    calls = {"csv": 0}
    transport, _ = _site()

    async def flaky(request: httpx.Request) -> httpx.Response:
        if income_io.year_of_url(str(request.url)) is not None:
            calls["csv"] += 1
            if calls["csv"] <= 2:
                raise httpx.ReadError("Connection reset by peer", request=request)
        return await transport.handle_async_request(request)

    assert await _sync(app, httpx.MockTransport(flaky)) == ("updated", 1)
    assert calls["csv"] == 3 and no_wait == [2.0, 4.0]


async def test_a_connection_that_keeps_resetting_fails_after_three_retries(app, few_villages, no_wait):
    transport, _ = _site()

    async def always_reset(request: httpx.Request) -> httpx.Response:
        if income_io.year_of_url(str(request.url)) is not None:
            raise httpx.ReadError("Connection reset by peer", request=request)
        return await transport.handle_async_request(request)

    assert await _sync(app, httpx.MockTransport(always_reset)) == ("failed", 0)
    assert no_wait == [2.0, 4.0, 8.0]
    assert (await _status(app)).last_error == "下載或匯入失敗：ReadError"


async def test_an_error_page_with_status_200_keeps_the_year_in_use(app, few_villages):
    transport, _ = _site()
    now = datetime.now(timezone.utc)
    await _sync(app, transport, now=now)

    def error_page(request: httpx.Request) -> httpx.Response:
        if str(request.url) == income_io.DATASET_API:
            return httpx.Response(200, json=datagov_income_listing([112, 113]))
        return httpx.Response(200, text="<html><body>系統訊息</body></html>", headers={"content-type": "text/html"})

    assert await _sync(app, httpx.MockTransport(error_page), now=now + timedelta(days=31)) == ("failed", 0)
    status = await _status(app)
    assert status.active_version == "112" and "表頭不對" in status.last_error
    assert len(await _rows(app)) == INCOME_SAMPLE_VILLAGES


async def test_too_few_villages_keeps_the_year_in_use(app):
    """下限沒降：樣本只有 24 個里，不換版。"""
    transport, _ = _site()
    assert await _sync(app, transport) == ("failed", 0)
    status = await _status(app)
    assert status.active_version is None and "少於 850 個" in status.last_error
    assert await _rows(app) == {}


# ---- 檔案、CLI、打包檔 ----


async def _file_sync(app, path: Path, *, year: int | None = None, force: bool = False) -> sync.GeoSyncResult:
    def must_not_be_called(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 被叫到就是錯
        raise AssertionError(f"不應連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(must_not_be_called)) as client:
        return await sync.run_geo_sync(
            app.state.session_factory, app.state.settings, income_file=path, income_year=year, force=force, client=client
        )


async def test_a_file_takes_its_year_from_the_name_and_does_not_go_online(app, few_villages, tmp_path: Path):
    path = tmp_path / "112_165-E.csv"
    path.write_bytes(INCOME_SAMPLE.read_bytes())
    result = await _file_sync(app, path)
    assert (result.income, result.income_version, result.income_rows_skipped) == ("updated", "112", 1)
    assert (result.doorplates, result.population, result.births) == ("skipped",) * 3


async def test_a_file_without_a_year_needs_one(app, few_villages, tmp_path: Path):
    path = tmp_path / "income.csv"
    path.write_bytes(INCOME_SAMPLE.read_bytes())
    assert (await _file_sync(app, path)).income == "failed"
    assert "--income-year" in (await _status(app)).last_error
    assert (await _file_sync(app, path, year=111)).income_version == "111"


async def test_an_older_file_needs_force(app, few_villages, tmp_path: Path):
    path = tmp_path / "112_165-E.csv"
    path.write_bytes(INCOME_SAMPLE.read_bytes())
    await _file_sync(app, path)
    older = tmp_path / "111_165-E.csv"
    older.write_bytes(INCOME_SAMPLE.read_bytes())
    assert (await _file_sync(app, older)).income == "failed"
    assert "比使用中的 112 年度舊" in (await _status(app)).last_error
    assert (await _file_sync(app, older, force=True)).income_version == "111"
    # 同一年度重匯可以（不必 --force）。
    assert (await _file_sync(app, older)).income == "updated"


def test_cli_options_for_income(tmp_path: Path):
    path = tmp_path / "x.csv"
    path.write_bytes(b"")
    options = geo_sync_options(["--income-file", str(path), "--income-year", "112"])
    assert (options["income_file"], options["income_year"]) == (path, 112)
    for args in (["--income-year", "112"], ["--income-file", str(path), "--income-year", "2023"]):
        with pytest.raises(SystemExit):
            geo_sync_options(args)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_cli_prints_the_income_result(app, few_villages, cli_on_test_app, capsys, tmp_path: Path):
    path = tmp_path / "112_165-E.csv"
    path.write_bytes(INCOME_SAMPLE.read_bytes())
    await geo_sync_command(**geo_sync_options(["--income-file", str(path)]))
    output = capsys.readouterr().out
    assert "各里所得：updated（使用中 112 年度）" in output
    assert "各里所得 1 列（對不到里界）" in output


async def test_cli_failure_prints_the_reason_and_exits_one(app, cli_on_test_app, capsys, tmp_path: Path):
    path = tmp_path / "112_165-E.csv"
    path.write_bytes(INCOME_SAMPLE.read_bytes())
    with pytest.raises(SystemExit) as exit_info:
        await geo_sync_command(**geo_sync_options(["--income-file", str(path)]))
    assert exit_info.value.code == 1
    assert "各里所得同步失敗：所得資料只有 24 個里對得到里界" in capsys.readouterr().err


async def test_bundle_imports_income(app, few_villages, cli_on_test_app, capsys, tmp_path: Path):
    target = tmp_path / "bundle.zip"
    write_bundle(target, [BundleFile("112_165-E.csv", "income", "112", income_io.csv_url(112), INCOME_SAMPLE.read_bytes())])
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    assert "各里所得：updated（使用中 112 年度）" in capsys.readouterr().out
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(GeoVillageIncome)) == INCOME_SAMPLE_VILLAGES


def test_bundle_with_two_income_files_is_refused(tmp_path: Path):
    target = tmp_path / "bundle.zip"
    content = INCOME_SAMPLE.read_bytes()
    write_bundle(
        target,
        [
            BundleFile("112_165-E.csv", "income", "112", "", content),
            BundleFile("111_165-E.csv", "income", "111", "", content),
        ],
    )
    with pytest.raises(BundleError, match="只能有一個檔"):
        open_bundle(target, tmp_path / "out")
