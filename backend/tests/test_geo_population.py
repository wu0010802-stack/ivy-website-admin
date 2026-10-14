"""各里人口的解析、驗證、同步與 CLI（2026-10-13 招生機會規格 §2–§4）。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, update

from app import cli
from app.admissions.geo import population as population_io
from app.admissions.geo import sync
from app.admissions.geo import village_series as series_io
from app.admissions.geo.models import GeoDatasetStatus, GeoVillageAges, GeoVillagePopulation
from app.admissions.geo.population import PopulationFormatError, collect, label_of, response_rows, total_pages
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import RIS_SAMPLE_PAGES, RIS_SAMPLE_VILLAGES, ris_response, ris_sample_pages

TODAY = date(2026, 10, 13)


@pytest.fixture
def few_villages(monkeypatch):
    """樣本只有 24 個里；下限降到 1（年齡歷史用同一份資料，下限一起降）。"""
    monkeypatch.setattr(population_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(series_io, "MIN_VILLAGES", 1)


@pytest.fixture
def october(monkeypatch):
    """今天固定是 2026-10-13：往回找的月份是 11509、11508、11507、11506。"""
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


def _rows(pages: list[dict]) -> list[list[dict]]:
    return [page["responseData"] for page in pages]


def _ris(months: set[str] | None = None):
    """只有內政部的假網站；回傳 (transport, 請求過的網址)。"""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return ris_response(str(request.url), months=months) or httpx.Response(404)

    return httpx.MockTransport(handle), seen


async def _sync_population(app, transport, **kwargs) -> tuple[str, int]:
    async with httpx.AsyncClient(transport=transport) as client:
        return await sync.sync_population(
            app.state.session_factory, client, now=kwargs.pop("now", datetime.now(timezone.utc)),
            force=kwargs.pop("force", False), files=None,
        )


async def _status(app) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, "population")


async def _village(app, code: str) -> GeoVillagePopulation | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoVillagePopulation, code)


async def _count(app) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(GeoVillagePopulation))


# ---- 解析與驗證 ----


def test_collect_keeps_kaohsiung_and_sums_both_sexes(few_villages):
    pages = ris_sample_pages()
    batch = collect(_rows(pages))
    assert batch.label == "115-09"
    assert len(batch.rows) == RIS_SAMPLE_VILLAGES and batch.skipped == 0
    assert all(row.village_code.startswith("64000") for row in batch.rows)
    raw = next(row for page in pages for row in page["responseData"] if row["village"] == "本揚里")
    benyang = next(row for row in batch.rows if row.village == "本揚里")
    assert benyang.district == "三民區"
    assert benyang.age_3 == int(raw["people_age_003_m"]) + int(raw["people_age_003_f"])
    assert benyang.people_total == int(raw["people_total"])


def test_collect_skips_codes_that_are_not_in_the_boundary_file(few_villages):
    pages = ris_sample_pages()
    pages[0]["responseData"].append({**pages[1]["responseData"][0], "district_code": "64000999999"})
    batch = collect(_rows(pages))
    assert batch.skipped == 1 and len(batch.rows) == RIS_SAMPLE_VILLAGES


def test_collect_needs_enough_villages():
    """預設下限 850 個里：樣本只有 24 個，不換版。"""
    with pytest.raises(PopulationFormatError, match="少於 850"):
        collect(_rows(ris_sample_pages()))


@pytest.mark.parametrize("bad", ["", "1.5", "-3", "²", "三"])
def test_collect_rejects_counts_that_are_not_plain_integers(few_villages, bad):
    pages = ris_sample_pages()
    kaohsiung = next(row for row in pages[0]["responseData"] if row["district_code"].startswith("64000"))
    kaohsiung["people_age_002_f"] = bad
    with pytest.raises(PopulationFormatError, match="people_age_002_f"):
        collect(_rows(pages))


def test_collect_rejects_mixed_months_duplicates_and_empty(few_villages):
    mixed = ris_sample_pages()
    mixed[1]["responseData"][0]["statistic_yyymm"] = "11508"
    with pytest.raises(PopulationFormatError, match="不同月份"):
        collect(_rows(mixed))

    duplicated = ris_sample_pages()
    kaohsiung = next(row for row in duplicated[0]["responseData"] if row["district_code"].startswith("64000"))
    duplicated[1]["responseData"].append(dict(kaohsiung))
    with pytest.raises(PopulationFormatError, match="重複"):
        collect(_rows(duplicated))

    with pytest.raises(PopulationFormatError, match="空的"):
        collect([[]])


def test_parse_page_keeps_only_kaohsiung_rows_and_needed_fields():
    """解析當下就丟掉其他縣市的列與 7 歲以上的欄位（全國一頁整份解析要上百 MB）。"""
    page = json.loads(RIS_SAMPLE_PAGES[0].read_text(encoding="utf-8"))
    parsed = population_io.parse_page(RIS_SAMPLE_PAGES[0].read_text(encoding="utf-8"))
    kept = parsed["responseData"]
    assert parsed["totalPage"] == "2" and parsed["responseCode"] == "OD-0101-S"
    assert len(kept) == sum(row["district_code"].startswith("64000") for row in page["responseData"]) > 0
    assert all(row["district_code"].startswith("64000") for row in kept)
    assert "people_age_007_m" not in kept[0] and "people_age_006_f" in kept[0] and "people_total" in kept[0]


def test_response_rows_and_pages():
    first = ris_sample_pages()[0]
    assert response_rows(first) == first["responseData"]
    assert total_pages(first) == 2
    assert response_rows({"responseCode": "OD-0102-S", "responseMessage": "查無資料"}) is None
    for bad in ({"responseCode": "OD-0500-E"}, {"responseCode": "OD-0101-S", "responseData": "x"}, ["not", "dict"]):
        with pytest.raises(PopulationFormatError):
            response_rows(bad)
    for pages in ("", "0", "11", "abc"):
        with pytest.raises(PopulationFormatError):
            total_pages({"totalPage": pages})


def test_page_url_asks_only_for_kaohsiung():
    assert population_io.page_url("11509", 2) == (
        "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11509?COUNTY=%E9%AB%98%E9%9B%84%E5%B8%82&page=2"
    )


def test_label_of():
    assert label_of("11509") == "115-09"
    for bad in ("1159", "11513", "115-09", "11500"):
        with pytest.raises(PopulationFormatError):
            label_of(bad)


def test_recent_months_cross_the_year(monkeypatch):
    monkeypatch.setattr(sync, "today_local", lambda *args: date(2027, 1, 5))
    assert sync.recent_months() == ["11512", "11511", "11510", "11509"]


# ---- 同步 ----


async def test_first_sync_imports_latest_month_and_records_status(app, few_villages, october):
    transport, seen = _ris(months={"11509"})
    assert await _sync_population(app, transport) == ("updated", 0)
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("115-09", "115-09", None)
    assert await _count(app) == RIS_SAMPLE_VILLAGES
    assert seen == [population_io.page_url("11509", 1), population_io.page_url("11509", 2)]


async def test_months_without_data_fall_back_to_earlier_ones(app, few_villages, october):
    transport, seen = _ris(months={"11507"})
    assert await _sync_population(app, transport) == ("updated", 0)
    assert (await _status(app)).label == "115-07"
    assert seen[:3] == [population_io.page_url(month, 1) for month in ("11509", "11508", "11507")]


async def test_no_recent_month_fails_and_keeps_nothing(app, few_villages, october):
    transport, _ = _ris(months=set())
    assert await _sync_population(app, transport) == ("failed", 0)
    status = await _status(app)
    assert status.active_version is None and "找不到" in status.last_error
    assert await _count(app) == 0


async def test_within_30_days_does_not_go_online(app, few_villages, october):
    transport, seen = _ris(months={"11509"})
    await _sync_population(app, transport)
    seen.clear()
    assert await _sync_population(app, transport) == ("skipped", 0)
    assert seen == []


async def test_same_month_only_reads_the_first_page(app, few_villages, october):
    transport, seen = _ris(months={"11509"})
    await _sync_population(app, transport)
    old = datetime.now(timezone.utc) - timedelta(days=31)
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).values(checked_at=old, synced_at=old))
        await db.commit()
    seen.clear()
    assert await _sync_population(app, transport) == ("skipped", 0)
    assert seen == [population_io.page_url("11509", 1)]
    assert (await _status(app)).checked_at > old


async def test_force_downloads_the_same_month_again(app, few_villages, october):
    transport, seen = _ris(months={"11509"})
    await _sync_population(app, transport)
    seen.clear()
    assert await _sync_population(app, transport, force=True) == ("updated", 0)
    assert len(seen) == 2


async def test_an_older_month_never_replaces_a_newer_one(app, few_villages, october):
    newer, _ = _ris(months={"11509"})
    await _sync_population(app, newer)
    older, _ = _ris(months={"11508"})
    assert await _sync_population(app, older, force=False, now=datetime.now(timezone.utc) + timedelta(days=40)) == ("skipped", 0)
    assert (await _status(app)).label == "115-09"


async def test_a_bad_page_fails_and_keeps_the_month_in_use(app, few_villages, october):
    good, _ = _ris(months={"11509"})
    await _sync_population(app, good)

    def broken(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.url.params.get("page") == "2":
            return httpx.Response(500)
        response = ris_response(url, months={"11509"})
        return response or httpx.Response(404)

    assert await _sync_population(app, httpx.MockTransport(broken), force=True) == ("failed", 0)
    status = await _status(app)
    assert status.label == "115-09" and status.last_error == "下載失敗：HTTP 500"
    assert await _count(app) == RIS_SAMPLE_VILLAGES


async def test_page_that_turns_into_no_data_is_a_source_error(app, few_villages, october):
    def flaky(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.url.params.get("page") == "2":
            return httpx.Response(200, json={"responseCode": "OD-0102-S", "responseMessage": "查無資料"})
        return ris_response(url, months={"11509"}) or httpx.Response(404)

    assert await _sync_population(app, httpx.MockTransport(flaky)) == ("failed", 0)
    assert "下載到一半" in (await _status(app)).last_error


async def test_run_geo_sync_with_population_files_does_not_go_online(app, few_villages, tmp_path: Path):
    files = []
    for index, page in enumerate(ris_sample_pages(), start=1):
        path = tmp_path / f"11509-{index}.json"
        path.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
        files.append(path)

    def must_not_be_called(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 被叫到就是錯
        raise AssertionError(f"不應連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(must_not_be_called)) as client:
        result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, population_files=files, client=client)
    assert (result.doorplates, result.kindergartens, result.population) == ("skipped", "skipped", "updated")
    assert result.population_version == "115-09"
    assert await _count(app) == RIS_SAMPLE_VILLAGES


def _write_pages(tmp_path: Path, month: str) -> list[Path]:
    """那個月份的樣本頁寫成檔案（和 --population-file 收的內政部原始回應一樣）。"""
    files = []
    for index, page in enumerate(ris_sample_pages(month), start=1):
        path = tmp_path / f"{month}-{index}.json"
        path.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
        files.append(path)
    return files


async def _sync_files(app, files: list[Path], **kwargs) -> tuple[str, int]:
    return await sync.sync_population(
        app.state.session_factory, None, now=kwargs.pop("now", datetime.now(timezone.utc)),
        force=kwargs.pop("force", False), files=files,
    )


async def test_an_older_population_file_only_goes_into_the_age_history(app, few_villages, tmp_path: Path):
    """檔案匯入和網路一樣不退回舊月份。2026-10-14 起舊月份的檔案不再當錯誤：只寫進年齡歷史（「這一年淨增」要
    一年前的月份），使用中的人口、版本與時間戳都不動。"""
    assert await _sync_files(app, _write_pages(tmp_path, "11509")) == ("updated", 0)
    before = await _status(app)
    result = await _sync_files(app, _write_pages(tmp_path, "11508"), now=before.synced_at + timedelta(days=1))
    assert result == ("history", 0)
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("115-09", "115-09", None)
    assert (status.synced_at, status.checked_at) == (before.synced_at, before.checked_at)
    assert await _count(app) == RIS_SAMPLE_VILLAGES
    assert await _history_months(app) == {"115-08": RIS_SAMPLE_VILLAGES, "115-09": RIS_SAMPLE_VILLAGES}


async def test_population_files_of_two_months_import_the_newer_and_keep_the_older_as_history(
    app, few_villages, tmp_path: Path
):
    """bundle 會同時帶使用中的月份與一年前的月份：較新的換上使用中，較舊的只進歷史。"""
    files = _write_pages(tmp_path, "11409") + _write_pages(tmp_path, "11509")
    assert await _sync_files(app, files) == ("updated", 0)
    assert (await _status(app)).label == "115-09"
    assert await _history_months(app) == {"114-09": RIS_SAMPLE_VILLAGES, "115-09": RIS_SAMPLE_VILLAGES}


async def test_nationwide_pages_without_kaohsiung_rows_are_skipped(app, few_villages, tmp_path: Path):
    """部署文件寫「全國的四頁也收」：全國的頁有的整頁都不是高雄，略過，不能當成空檔失敗。"""
    files = _write_pages(tmp_path, "11509")
    others = ris_sample_pages()[0]
    others["responseData"] = [row for row in others["responseData"] if not row["district_code"].startswith("64000")]
    assert others["responseData"]  # 樣本第一頁有新北市的列
    path = tmp_path / "11509-nationwide-other.json"
    path.write_text(json.dumps(others, ensure_ascii=False), encoding="utf-8")
    assert await _sync_files(app, [*files, path]) == ("updated", 0)
    assert await _count(app) == RIS_SAMPLE_VILLAGES
    result = await _sync_files(app, [path])
    assert result == ("failed", 0)
    assert "沒有高雄市的資料" in (await _status(app)).last_error


async def _history_months(app) -> dict[str, int]:
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(GeoVillageAges.month, func.count()).group_by(GeoVillageAges.month))).all()
    return {month: count for month, count in rows}


async def test_force_lets_an_older_population_file_replace_the_month(app, few_villages, tmp_path: Path):
    """真的要退回舊月份（新月份的檔案有問題）：明確加 --force 才行。"""
    await _sync_files(app, _write_pages(tmp_path, "11509"))
    assert await _sync_files(app, _write_pages(tmp_path, "11508"), force=True) == ("updated", 0)
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("115-08", "115-08", None)


async def test_the_same_month_population_file_can_be_imported_again(app, few_villages, tmp_path: Path):
    files = _write_pages(tmp_path, "11509")
    await _sync_files(app, files)
    assert await _sync_files(app, files) == ("updated", 0)
    assert (await _status(app)).label == "115-09"


async def test_population_file_with_no_data_fails(app, few_villages, tmp_path: Path):
    path = tmp_path / "empty.json"
    path.write_text(json.dumps({"responseCode": "OD-0102-S", "responseMessage": "查無資料"}), encoding="utf-8")
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, population_files=[path])
    assert result.population == "failed"
    assert "查無資料" in (await _status(app)).last_error


async def test_replacing_a_month_leaves_no_rows_from_the_old_one(app, few_villages, october):
    first, _ = _ris(months={"11508"})
    await _sync_population(app, first)
    async with app.state.session_factory() as db:
        # 假裝上個月多一個里（新版沒有它）：換版後不能殘留。
        db.add(GeoVillagePopulation(
            village_code="64000999999", district="測試區", village="測試里",
            age_0=1, age_1=1, age_2=1, age_3=1, age_4=1, age_5=1, age_6=1, people_total=7,
        ))
        await db.commit()
    newer, _ = _ris(months={"11509"})
    assert await _sync_population(app, newer, now=datetime.now(timezone.utc) + timedelta(days=40)) == ("updated", 0)
    assert await _village(app, "64000999999") is None
    assert await _count(app) == RIS_SAMPLE_VILLAGES


# ---- CLI ----


def test_cli_options_collect_every_population_file():
    first, second = RIS_SAMPLE_PAGES
    options = geo_sync_options(["--population-file", str(first), "--population-file", str(second)])
    assert options["population_files"] == [first, second]
    assert options["doorplates_file"] is None and options["kindergartens_file"] is None


@pytest.mark.parametrize("args", [["--population-file"], ["--population-file", "/no/such/page.json"]])
def test_cli_rejects_bad_population_arguments(args):
    with pytest.raises(SystemExit):
        geo_sync_options(args)


async def test_cli_geo_sync_with_population_files(app, few_villages, monkeypatch, capsys):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    # 用測試 app 的設定（同 test_geo_loop 的 cli_on_test_app）：CI 沒有設 WEBSITE_DATABASE_URL 等執行期變數。
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    await geo_sync_command(**geo_sync_options([arg for path in RIS_SAMPLE_PAGES for arg in ("--population-file", str(path))]))
    output = capsys.readouterr().out
    assert "各里人口：updated（使用中 115-09）" in output
    assert "門牌：skipped" in output and "幼兒園：skipped" in output
