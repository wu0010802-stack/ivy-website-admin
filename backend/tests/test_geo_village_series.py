"""各里出生、遷入遷出、年齡的月份歷史（2026-10-14 里的變化規格 §2.1、§3.1、§4.2）：解析、驗證、回補、
缺月、失敗保留已寫的月份、請求間隔、檔案匯入、一年前的年齡。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app.admissions.geo import population as population_io
from app.admissions.geo import sync
from app.admissions.geo import village_series as series_io
from app.admissions.geo.models import GeoDatasetStatus, GeoVillageAges, GeoVillageBirths, GeoVillageMigration
from app.admissions.geo.village_series import BIRTHS, MIGRATION, SeriesFormatError, collect, shift, window
from tests.geo_helpers import RIS_SAMPLE_VILLAGES, ris_response, ris_sample_pages, ris_series_page

TODAY = date(2026, 10, 14)
YIHUA_VILLAGE = "64000050015"  # 三民區本揚里


@pytest.fixture
def few_villages(monkeypatch):
    """樣本只有 24 個里；下限降到 1。"""
    monkeypatch.setattr(series_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(population_io, "MIN_VILLAGES", 1)


@pytest.fixture
def october(monkeypatch):
    """今天固定是 2026-10-14：往回找的月份是 11509、11508、11507、11506。"""
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


def _ris(months: set[str] | None = None, series_months: set[str] | None = None):
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return ris_response(str(request.url), months=months, series_months=series_months) or httpx.Response(404)

    return httpx.MockTransport(handle), seen


async def _sync(app, transport, series, **kwargs) -> tuple[str, int]:
    async with httpx.AsyncClient(transport=transport) as client:
        return await sync.sync_series(
            app.state.session_factory, client, series, now=kwargs.pop("now", datetime.now(timezone.utc)),
            force=kwargs.pop("force", False), files=None,
        )


async def _months(app, model) -> dict[str, int]:
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(model.month, func.count()).group_by(model.month))).all()
    return {month: count for month, count in rows}


async def _status(app, dataset: str) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, dataset)


def _rows(code: str, month: str = "11509") -> list[list[dict]]:
    return [ris_series_page(code, month)["responseData"]]


# ---- 月份 ----


def test_month_arithmetic_crosses_years():
    assert shift("115-09", -12) == "114-09"
    assert shift("115-01", -1) == "114-12"
    assert shift("114-12", 1) == "115-01"
    assert window("115-09", 3) == ["115-07", "115-08", "115-09"]
    assert series_io.KEEP_MONTHS == 25 and series_io.BIRTHS_KEEP_MONTHS == 72
    assert (series_io.BIRTHS.keep_months, series_io.MIGRATION.keep_months, series_io.AGES.keep_months) == (72, 25, 25)
    assert window("115-09", 25)[0] == "113-09" and window("115-09", 72)[0] == "109-10"
    assert series_io.yyymm_of("115-09") == "11509" and series_io.label_of("11509") == "115-09"
    for bad in ("115-13", "11509", "115-9"):
        with pytest.raises(SeriesFormatError):
            series_io.yyymm_of(bad)


def test_page_url_asks_only_for_kaohsiung():
    assert series_io.page_url(BIRTHS, "11509", 1) == (
        "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP061/11509?COUNTY=%E9%AB%98%E9%9B%84%E5%B8%82&page=1"
    )
    assert "/ODRP011/11508?" in series_io.page_url(MIGRATION, "11508", 1)


# ---- 解析與驗證 ----


def test_parse_keeps_kaohsiung_rows_and_only_the_fields_in_use():
    data = series_io.parse_page(MIGRATION, json.dumps(ris_series_page("ODRP011"), ensure_ascii=False))
    rows = series_io.response_rows(MIGRATION, data)
    assert len(rows) == RIS_SAMPLE_VILLAGES  # 新北市 2 筆在解析時就丟掉
    assert set(rows[0]) == {"statistic_yyymm", "district_code", "site_id", "village", *MIGRATION.source_keys}


def test_births_parse_ignores_the_other_odrp061_columns():
    data = series_io.parse_page(BIRTHS, json.dumps(ris_series_page("ODRP061"), ensure_ascii=False))
    rows = series_io.response_rows(BIRTHS, data)
    assert len(rows) == RIS_SAMPLE_VILLAGES  # 新北市 2 筆在解析時就丟掉
    assert set(rows[0]) == {"statistic_yyymm", "district_code", "site_id", "village", "birth_total"}


def test_a_block_page_is_a_format_error_without_its_content():
    with pytest.raises(SeriesFormatError, match="可能被來源擋下") as caught:
        series_io.parse_page(BIRTHS, "<html><head><META NAME=\"ROBOTS\"></head><body>Request Rejected</body></html>")
    assert "Rejected" not in str(caught.value)


def test_collect_births_sums_and_names(few_villages):
    batch = collect(BIRTHS, _rows("ODRP061"))
    assert batch.label == "115-09" and batch.unknown == 0
    assert len(batch.rows) == RIS_SAMPLE_VILLAGES
    yihua = next(row for row in batch.rows if row["village_code"] == YIHUA_VILLAGE)
    assert (yihua["month"], yihua["district"], yihua["village"]) == ("115-09", "三民區", "本揚里")
    source = next(r for r in _rows("ODRP061")[0] if r["district_code"] == YIHUA_VILLAGE)
    assert yihua["births"] == int(source["birth_total"])


def test_collect_migration_adds_men_and_women(few_villages):
    batch = collect(MIGRATION, _rows("ODRP011"))
    source = next(r for r in _rows("ODRP011")[0] if r["district_code"] == YIHUA_VILLAGE)
    yihua = next(row for row in batch.rows if row["village_code"] == YIHUA_VILLAGE)
    assert yihua["moved_in"] == int(source["in_total_m"]) + int(source["in_total_f"])
    assert yihua["address_out"] == int(source["out_migrants_m"]) + int(source["out_migrants_f"])
    assert yihua["boundary_in"] == int(source["vlg_chg_add_m"]) + int(source["vlg_chg_add_f"])


def test_collect_keeps_codes_that_are_not_in_the_boundary_file(few_villages):
    """115-07 里鄰調整前的舊里（例如鹽埕區慈愛里）不在里界檔：照存並計數（里界調整合併時要用）。"""
    rows = _rows("ODRP061")
    rows[0].append({**rows[0][-1], "district_code": "64000010002", "site_id": "高雄市鹽埕區", "village": "慈愛里"})
    batch = collect(BIRTHS, rows)
    assert batch.unknown == 1
    assert any(row["village_code"] == "64000010002" for row in batch.rows)


def test_collect_requires_enough_villages_on_the_boundary_file():
    with pytest.raises(SeriesFormatError, match="少於 850"):
        collect(BIRTHS, _rows("ODRP061"))


@pytest.mark.parametrize("bad", ["", "-1", "1.5", "²", None])
def test_collect_rejects_counts_that_are_not_plain_integers(few_villages, bad):
    rows = _rows("ODRP011")
    rows[0][3]["in_migrants_f"] = bad
    with pytest.raises(SeriesFormatError, match="in_migrants_f"):
        collect(MIGRATION, rows)


def test_collect_rejects_mixed_months_duplicates_and_empty(few_villages):
    rows = _rows("ODRP061")
    rows[0][4]["statistic_yyymm"] = "11508"
    with pytest.raises(SeriesFormatError, match="不同月份"):
        collect(BIRTHS, rows)
    rows = _rows("ODRP061")
    rows[0].append(dict(rows[0][-1]))
    with pytest.raises(SeriesFormatError, match="重複"):
        collect(BIRTHS, rows)
    with pytest.raises(SeriesFormatError, match="空的"):
        collect(BIRTHS, [[]])


# ---- 同步 ----


@pytest.mark.parametrize(
    ("series", "model", "keep"), [(BIRTHS, GeoVillageBirths, 72), (MIGRATION, GeoVillageMigration, 25)]
)
async def test_first_sync_backfills_the_retention_window_and_records_the_latest(app, few_villages, october, series, model, keep):
    transport, seen = _ris()
    assert await _sync(app, transport, series) == ("updated", keep)
    months = await _months(app, model)
    assert sorted(months) == window("115-09", keep)
    assert set(months.values()) == {RIS_SAMPLE_VILLAGES}
    status = await _status(app, series.dataset)
    assert (status.active_version, status.label, status.last_error) == ("115-09", "115-09", None)
    assert status.checked_at is not None
    # 最新月份的第一頁拿來找月份，不重抓；其餘月份各一次。
    assert len(seen) == keep and seen[0] == series_io.page_url(series, "11509", 1)


async def test_months_the_source_does_not_have_are_skipped_and_asked_again_later(app, few_villages, october):
    """出生 API 缺 113-10、113-11、114-01 的 ODRP010 已不用；這裡模擬來源仍然缺這三個月。"""
    available = {series_io.yyymm_of(label) for label in window("115-09", 72)} - {"11310", "11311", "11401"}
    transport, seen = _ris(series_months=available)
    assert await _sync(app, transport, BIRTHS) == ("updated", 69)
    assert {"113-10", "113-11", "114-01"}.isdisjoint(await _months(app, GeoVillageBirths))
    seen.clear()
    later = datetime.now(timezone.utc) + timedelta(days=31)
    assert await _sync(app, transport, BIRTHS, now=later) == ("skipped", 0)
    # 再問：最新月份的第一頁＋三個缺月。
    assert sorted(seen) == sorted(series_io.page_url(BIRTHS, m, 1) for m in ("11509", "11310", "11311", "11401"))


async def test_latest_month_falls_back_when_the_newest_is_not_out(app, few_villages, october):
    transport, _ = _ris(series_months={"11507", "11506"})
    assert await _sync(app, transport, MIGRATION) == ("updated", 2)
    assert (await _status(app, "migration")).label == "115-07"
    assert sorted(await _months(app, GeoVillageMigration)) == ["115-06", "115-07"]


async def test_within_30_days_does_not_go_online(app, few_villages, october):
    transport, seen = _ris()
    await _sync(app, transport, BIRTHS)
    seen.clear()
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)
    assert seen == []


async def test_force_downloads_the_latest_month_again(app, few_villages, october):
    transport, seen = _ris(series_months={"11509", "11508"})
    await _sync(app, transport, BIRTHS)
    seen.clear()
    assert await _sync(app, transport, BIRTHS, force=True) == ("updated", 1)
    assert seen.count(series_io.page_url(BIRTHS, "11509", 1)) == 1


async def _insert_births(app, months: list[str], *, checked_at: datetime) -> None:
    """表裡已有這些月份（舊程式寫的）、整輪確認時間是 checked_at：用來測「回補沒到頭」的到期判斷。"""
    async with app.state.session_factory() as db:
        for month in months:
            db.add(GeoVillageBirths(month=month, village_code=YIHUA_VILLAGE, district="三民區", village="本揚里", births=1))
        latest = max(months)
        db.add(GeoDatasetStatus(dataset="births", active_version=latest, label=latest, synced_at=checked_at, checked_at=checked_at))
        await db.commit()


async def test_an_unfinished_backfill_is_due_even_within_30_days(app, few_villages, october):
    """部署後表裡只有 25 個月、確認時間才剛記過：最舊月份還沒補到視窗起點，馬上接著補（不等 30 天）。"""
    await _insert_births(app, window("115-09", 25), checked_at=datetime.now(timezone.utc))
    transport, seen = _ris()
    assert await _sync(app, transport, BIRTHS) == ("updated", 47)
    assert sorted(await _months(app, GeoVillageBirths)) == window("115-09", 72)
    # 最新月份的第一頁拿來找月份、不重抓；其餘 47 個月各一次。
    assert len(seen) == 48
    seen.clear()
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)  # 補到頭了：回到 30 天一次
    assert seen == []


async def test_a_missing_window_start_month_does_not_retry_every_day(app, few_villages, october):
    """視窗起點（109-10）剛好是來源查無的月份：最舊月份只晚 1 個月，不算沒補到頭。"""
    months = [month for month in window("115-09", 72) if month != "109-10"]
    await _insert_births(app, months, checked_at=datetime.now(timezone.utc))
    transport, seen = _ris()
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)
    assert seen == []


async def test_two_missing_months_at_the_window_start_are_asked_again(app, few_villages, october):
    """起點連續缺兩個月：最舊月份晚了 2 個月，視為還沒補到頭，會再問來源（問到查無就什麼都不寫）。"""
    months = [month for month in window("115-09", 72) if month not in ("109-10", "109-11")]
    await _insert_births(app, months, checked_at=datetime.now(timezone.utc))
    available = {series_io.yyymm_of(month) for month in window("115-09", 72)} - {"10910", "10911"}
    transport, seen = _ris(series_months=available)
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)
    assert sorted(seen) == sorted(series_io.page_url(BIRTHS, month, 1) for month in ("11509", "10910", "10911"))


async def test_no_recent_month_fails(app, few_villages, october):
    transport, _ = _ris(series_months=set())
    assert await _sync(app, transport, BIRTHS) == ("failed", 0)
    status = await _status(app, "births")
    assert status.active_version is None and "找不到" in status.last_error


async def test_failure_midway_keeps_the_months_already_written(app, few_villages, october):
    """回補到一半被擋（回 HTML）：已寫好的月份保留，下一輪從缺的接著補。"""
    calls = {"n": 0}

    def blocked_after_three(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] > 3:
            return httpx.Response(200, text="<html><body>Request Rejected</body></html>")
        return ris_response(str(request.url)) or httpx.Response(404)

    result = await _sync(app, httpx.MockTransport(blocked_after_three), BIRTHS)
    assert result == ("failed", 3)
    assert sorted(await _months(app, GeoVillageBirths)) == ["115-07", "115-08", "115-09"]
    status = await _status(app, "births")
    assert status.label == "115-09" and "可能被來源擋下" in status.last_error

    transport, seen = _ris()
    assert await _sync(app, transport, BIRTHS) == ("updated", 69)
    assert len(await _months(app, GeoVillageBirths)) == 72
    assert series_io.page_url(BIRTHS, "11508", 1) not in seen


async def test_months_older_than_the_births_window_are_pruned(app, few_villages, october):
    async with app.state.session_factory() as db:
        db.add(GeoVillageBirths(month="109-09", village_code=YIHUA_VILLAGE, district="三民區", village="本揚里", births=1))
        await db.commit()
    transport, _ = _ris()
    await _sync(app, transport, BIRTHS)
    months = await _months(app, GeoVillageBirths)
    assert "109-09" not in months and "109-10" in months


async def test_requests_to_ris_are_spaced(app, few_villages, october, monkeypatch):
    waits: list[float] = []

    async def record(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(sync, "RIS_REQUEST_GAP_SECONDS", 3.0)
    monkeypatch.setattr(sync, "_sleep", record)
    transport, seen = _ris(series_months={"11509", "11508"})
    await _sync(app, transport, BIRTHS)
    # 第一個請求不用等；之後每個請求前都等到和上一個隔 3 秒（假網站瞬間回應，所以每次都要等將近 3 秒）。
    assert len(waits) == len(seen) - 1 and all(2.5 < wait <= 3.0 for wait in waits)


async def test_files_are_grouped_by_month_and_do_not_go_online(app, few_villages, tmp_path: Path):
    files = []
    for month in ("11509", "11508"):
        path = tmp_path / f"births-{month}.json"
        path.write_text(json.dumps(ris_series_page("ODRP061", month), ensure_ascii=False), encoding="utf-8")
        files.append(path)

    def must_not_be_called(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 被叫到就是錯
        raise AssertionError(f"不應連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(must_not_be_called)) as client:
        result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, births_files=files, client=client)
    assert (result.births, result.births_version, result.births_months) == ("updated", "115-09", 2)
    assert (result.doorplates, result.kindergartens, result.population, result.migration) == ("skipped",) * 4
    assert sorted(await _months(app, GeoVillageBirths)) == ["115-08", "115-09"]


async def test_births_files_keep_months_inside_the_72_month_window(app, few_villages, tmp_path: Path):
    """出生視窗是 72 個月：檔案模式匯入的 109-10（視窗起點）不能被寫進去又立刻刪掉。"""
    files = []
    for month in ("11509", "10910"):
        path = tmp_path / f"births-{month}.json"
        path.write_text(json.dumps(ris_series_page("ODRP061", month), ensure_ascii=False), encoding="utf-8")
        files.append(path)
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, births_files=files)
    assert (result.births, result.births_months) == ("updated", 2)
    assert sorted(await _months(app, GeoVillageBirths)) == ["109-10", "115-09"]


async def test_a_no_data_file_fails(app, few_villages, tmp_path: Path):
    path = tmp_path / "empty.json"
    path.write_text(json.dumps({"responseCode": "OD-0102-S", "responseMessage": "查無資料"}), encoding="utf-8")
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, migration_files=[path])
    assert result.migration == "failed"
    assert "查無資料" in (await _status(app, "migration")).last_error


# ---- 一年前的年齡 ----


async def _import_population(app, month: str = "11509") -> None:
    async with app.state.session_factory() as db:
        batch = population_io.collect([page["responseData"] for page in ris_sample_pages(month)])
        await population_io.replace_population(db, batch, synced_at=datetime.now(timezone.utc))
        await db.commit()


async def test_age_history_copies_the_current_month_and_downloads_a_year_ago(app, few_villages):
    await _import_population(app)  # 部署前就匯入的人口：歷史表是空的
    transport, seen = _ris(months={"11409"})
    async with httpx.AsyncClient(transport=transport) as client:
        result = await sync.sync_age_history(app.state.session_factory, client, now=datetime.now(timezone.utc))
    assert result == "updated"
    assert await _months(app, GeoVillageAges) == {"114-09": RIS_SAMPLE_VILLAGES, "115-09": RIS_SAMPLE_VILLAGES}
    # 本月從人口表複製、不下載；只抓一年前的兩頁。
    assert seen == [population_io.page_url("11409", 1), population_io.page_url("11409", 2)]
    seen.clear()
    async with httpx.AsyncClient(transport=transport) as client:
        assert await sync.sync_age_history(app.state.session_factory, client, now=datetime.now(timezone.utc)) == "skipped"
    assert seen == []


async def test_age_history_failure_is_written_on_population_and_keeps_the_month_in_use(app, few_villages):
    await _import_population(app)
    transport, _ = _ris(months=set())
    async with httpx.AsyncClient(transport=transport) as client:
        assert await sync.sync_age_history(app.state.session_factory, client, now=datetime.now(timezone.utc)) == "failed"
    status = await _status(app, "population")
    assert status.label == "115-09" and status.last_error.startswith("一年前的人口：") and "114-09" in status.last_error
    assert await _months(app, GeoVillageAges) == {"115-09": RIS_SAMPLE_VILLAGES}


async def test_a_new_population_month_is_written_into_the_history_too(app, few_villages, october):
    transport, _ = _ris(months={"11509"})
    async with httpx.AsyncClient(transport=transport) as client:
        result = await sync.sync_population(
            app.state.session_factory, client, now=datetime.now(timezone.utc), force=False, files=None
        )
    assert result == ("updated", 0)
    assert await _months(app, GeoVillageAges) == {"115-09": RIS_SAMPLE_VILLAGES}


async def test_run_geo_sync_fills_births_migration_and_the_year_ago_ages(app, few_villages, october, monkeypatch):
    """背景同步一輪：人口、出生、遷入遷出、一年前的年齡都補齊；門牌與幼兒園的來源在這裡回 404（各自失敗）。"""
    transport, _ = _ris()
    async with httpx.AsyncClient(transport=transport) as client:
        result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, client=client)
    assert (result.population, result.births, result.migration, result.age_history) == ("updated", "updated", "updated", "updated")
    assert (result.births_version, result.migration_version, result.births_months, result.migration_months) == ("115-09", "115-09", 72, 25)
    assert set(await _months(app, GeoVillageAges)) == {"114-09", "115-09"}
