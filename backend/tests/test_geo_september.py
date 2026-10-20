"""每年九月底各里人口（2026-10-20 招生潛力與市佔率規格 §3.2）：解析時剝掉回應第一個鍵的 BOM、--september-file
回補、正常人口同步順手寫入、年齡歷史 prune 不動它、打包檔收 september。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app import cli
from app.admissions.geo import population as population_io
from app.admissions.geo import sync
from app.admissions.geo import village_series as series_io
from app.admissions.geo.bundle import BundleFile, open_bundle, write_bundle
from app.admissions.geo.models import GeoDatasetStatus, GeoVillageAges, GeoVillageAgesSeptember, GeoVillagePopulation
from app.admissions.geo.september import september_months, september_years, upsert_september
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import FIXTURES, RIS_SAMPLE_VILLAGES, ris_response, ris_sample_pages

BOM = chr(0xFEFF)  # U+FEFF：內政部 API 在部分月份（例如 10809）把它放在每列第一個鍵前面
BOM_FIXTURE = FIXTURES / "ris-odrp014-10809-bom.json"
# fixture 裡高雄 4 個里（另有 1 筆新北市要被篩掉）的 2–5 歲男女加總。
BOM_FIXTURE_VILLAGES = 4
BOM_FIXTURE_AGE_2_TO_5 = 317 + 258 + 242 + 236
TODAY = date(2026, 10, 20)


@pytest.fixture
def few_villages(monkeypatch):
    """樣本只有 24 個里（BOM fixture 只有 4 個）；下限降到 1（年齡歷史用同一份資料，下限一起降）。"""
    monkeypatch.setattr(population_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(series_io, "MIN_VILLAGES", 1)


@pytest.fixture
def october(monkeypatch):
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


def _bom_file(tmp_path: Path, month: str = "10809", name: str | None = None) -> Path:
    """BOM fixture 換成那個月份的統計月份（鍵仍帶 BOM），寫成 --september-file 收的檔。"""
    data = json.loads(BOM_FIXTURE.read_text(encoding="utf-8"))
    for row in data["responseData"]:
        row[BOM + "statistic_yyymm"] = month
    path = tmp_path / (name or f"september-{month}-1.json")
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def _sample_files(tmp_path: Path, month: str) -> list[Path]:
    """那個月份的樣本頁寫成檔案（和 --population-file 收的內政部原始回應一樣）。"""
    files = []
    for index, page in enumerate(ris_sample_pages(month), start=1):
        path = tmp_path / f"{month}-{index}.json"
        path.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
        files.append(path)
    return files


async def _september(app) -> dict[int, int]:
    async with app.state.session_factory() as db:
        rows = (
            await db.execute(select(GeoVillageAgesSeptember.year, func.count()).group_by(GeoVillageAgesSeptember.year))
        ).all()
    return {year: count for year, count in rows}


async def _count(app, model) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model))


async def _population_label(app) -> str | None:
    async with app.state.session_factory() as db:
        status = await db.get(GeoDatasetStatus, "population")
    return status.label if status is not None else None


async def _sync_files(app, files: list[Path]) -> tuple[str, int]:
    return await sync.sync_population(
        app.state.session_factory, None, now=datetime.now(timezone.utc), force=False, files=files
    )


# ---- 鍵上的 BOM ----


def test_bom_key_is_stripped(few_villages):
    text = BOM_FIXTURE.read_text(encoding="utf-8")
    assert BOM + "statistic_yyymm" in text  # fixture 真的帶 BOM，不是被編輯器吃掉了
    rows = population_io.response_rows(population_io.parse_page(text))
    assert rows is not None and all(row["statistic_yyymm"] == "10809" for row in rows)
    batch = population_io.collect([rows])
    assert batch.label == "108-09"
    assert len(batch.rows) == BOM_FIXTURE_VILLAGES  # 新北市那列在解析時就丟了
    assert sum(row.age_2 + row.age_3 + row.age_4 + row.age_5 for row in batch.rows) == BOM_FIXTURE_AGE_2_TO_5


def test_bom_key_is_stripped_in_the_series_parser_too(few_villages):
    text = BOM_FIXTURE.read_text(encoding="utf-8")
    rows = series_io.response_rows(series_io.AGES, series_io.parse_page(series_io.AGES, text))
    assert rows is not None and series_io.month_of_rows(rows) == "10809"
    batch = series_io.collect(series_io.AGES, [rows])
    assert (batch.label, len(batch.rows)) == ("108-09", BOM_FIXTURE_VILLAGES)


# ---- 寫入與讀取 ----


async def test_upsert_september_replaces_the_whole_year(app, few_villages):
    rows = population_io.collect([page["responseData"] for page in ris_sample_pages("11509")]).rows
    async with app.state.session_factory() as db:
        assert await upsert_september(db, 115, rows) == RIS_SAMPLE_VILLAGES
        assert await upsert_september(db, 114, rows[:3]) == 3
        await db.commit()
    assert await _september(app) == {114: 3, 115: RIS_SAMPLE_VILLAGES}
    async with app.state.session_factory() as db:
        # 同一年再寫一次是整年換新：少掉的里不會殘留，其他年份不動。
        assert await upsert_september(db, 115, rows[:5]) == 5
        await db.commit()
        assert await september_years(db) == [114, 115]
    assert await _september(app) == {114: 3, 115: 5}
    async with app.state.session_factory() as db:
        row = await db.get(GeoVillageAgesSeptember, (115, rows[0].village_code))
    assert (row.age_2, row.people_total, row.village) == (rows[0].age_2, rows[0].people_total, rows[0].village)


# ---- --september-file ----


async def test_september_file_backfill(app, few_villages, tmp_path: Path):
    """回補一年前的九月：只進九月表，使用中的人口與年齡歷史都不動。"""
    assert await _sync_files(app, _sample_files(tmp_path, "11509")) == ("updated", 0)
    population_before = await _count(app, GeoVillagePopulation)
    ages_before = await _count(app, GeoVillageAges)
    september_before = await _september(app)
    result = await sync.run_geo_sync(
        app.state.session_factory, app.state.settings, september_files=[_bom_file(tmp_path)]
    )
    assert (result.population, result.september, result.september_years) == ("skipped", "updated", 1)
    assert await _september(app) == {**september_before, 108: BOM_FIXTURE_VILLAGES}
    assert await _count(app, GeoVillagePopulation) == population_before
    assert await _count(app, GeoVillageAges) == ages_before
    assert await _population_label(app) == "115-09"
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(GeoVillageAgesSeptember).where(GeoVillageAgesSeptember.year == 108))).scalars().all()
    assert sum(row.age_2 + row.age_3 + row.age_4 + row.age_5 for row in rows) == BOM_FIXTURE_AGE_2_TO_5


async def test_september_files_of_several_years_and_importing_twice(app, few_villages, tmp_path: Path):
    files = [_bom_file(tmp_path, "10709"), _bom_file(tmp_path, "10809"), _bom_file(tmp_path, "10909")]

    def must_not_be_called(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 被叫到就是錯
        raise AssertionError(f"不應連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(must_not_be_called)) as client:
        result = await sync.run_geo_sync(
            app.state.session_factory, app.state.settings, september_files=files, client=client
        )
    assert (result.september, result.september_years) == ("updated", 3)
    assert await _september(app) == {107: 4, 108: 4, 109: 4}
    await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=files)
    assert await _september(app) == {107: 4, 108: 4, 109: 4}


async def test_non_september_file_rejected(app, few_villages, tmp_path: Path):
    """任何一個檔不是九月：整批不寫（好的那個也不寫）。"""
    good = _bom_file(tmp_path, "10809")
    bad = _bom_file(tmp_path, "11508")
    with pytest.raises(SystemExit) as raised:
        await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=[good, bad])
    assert "115-08" in str(raised.value)
    assert await _september(app) == {}
    # 只有不是九月的檔也一樣。
    with pytest.raises(SystemExit):
        await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=[bad])
    assert await _september(app) == {}


async def test_unusable_september_files_exit_without_writing(app, few_villages, tmp_path: Path):
    empty = tmp_path / "no-data.json"
    empty.write_text(json.dumps({"responseCode": "OD-0102-S", "responseMessage": "查無資料"}), encoding="utf-8")
    html = tmp_path / "blocked.json"
    html.write_text("<html>blocked</html>", encoding="utf-8")
    for path in (empty, html):
        with pytest.raises(SystemExit):
            await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=[path])
    assert await _september(app) == {}


def _legacy_code_files(tmp_path: Path, month: str, legacy: dict[str, str]) -> list[Path]:
    """樣本頁把 legacy 裡的代碼換成里界檔沒有的舊代碼（107、108 年三民、鳳山的分區代碼）。"""
    files = []
    for index, page in enumerate(ris_sample_pages(month), start=1):
        for row in page["responseData"]:
            row["district_code"] = legacy.get(row["district_code"], row["district_code"])
        path = tmp_path / f"{month}-legacy-{index}.json"
        path.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
        files.append(path)
    return files


async def test_september_keeps_codes_the_boundary_file_does_not_have(app, few_villages, tmp_path: Path):
    """10709、10809 的三民、鳳山用分區代碼（約 160 個里和現行里界檔不同）：九月底人口照存，不能像使用中的人口一樣略過。"""
    legacy = {"64000050015": "64000051046", "64000050025": "64000052047"}
    files = _legacy_code_files(tmp_path, "10809", legacy)
    await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=files)
    assert await _september(app) == {108: RIS_SAMPLE_VILLAGES}
    async with app.state.session_factory() as db:
        kept = await db.get(GeoVillageAgesSeptember, (108, "64000051046"))
    assert kept is not None and kept.village == "本揚里"
    # 使用中的人口仍只收里界檔有的代碼。
    assert await _sync_files(app, _legacy_code_files(tmp_path, "11509", legacy)) == ("updated", len(legacy))
    assert await _count(app, GeoVillagePopulation) == RIS_SAMPLE_VILLAGES - len(legacy)
    assert (await _september(app))[115] == RIS_SAMPLE_VILLAGES


async def test_september_file_with_too_few_villages_is_rejected(app, few_villages, monkeypatch, tmp_path: Path):
    """殘缺檔（高雄的列少於下限）不匯入，里界檔對不對得到都一樣算。"""
    monkeypatch.setattr(population_io, "MIN_VILLAGES", RIS_SAMPLE_VILLAGES + 1)
    with pytest.raises(SystemExit) as raised:
        await sync.run_geo_sync(
            app.state.session_factory, app.state.settings, september_files=_sample_files(tmp_path, "11509")
        )
    assert "少於" in str(raised.value)
    assert await _september(app) == {}


# ---- 正常的人口同步順手寫入 ----


async def test_population_sync_september_also_upserts(app, few_villages, tmp_path: Path):
    assert await _sync_files(app, _sample_files(tmp_path, "11509")) == ("updated", 0)
    assert await _september(app) == {115: RIS_SAMPLE_VILLAGES}
    async with app.state.session_factory() as db:
        row = await db.get(GeoVillageAgesSeptember, (115, "64000050015"))
        pop = await db.get(GeoVillagePopulation, "64000050015")
    assert (row.age_0, row.age_5, row.people_total) == (pop.age_0, pop.age_5, pop.people_total)
    # 十月不是九月：換上新的使用中月份，九月表不動。
    assert await _sync_files(app, _sample_files(tmp_path, "11510")) == ("updated", 0)
    assert await _population_label(app) == "115-10"
    assert await _september(app) == {115: RIS_SAMPLE_VILLAGES}


async def test_population_sync_from_the_network_writes_september(app, few_villages, october):
    def handle(request: httpx.Request) -> httpx.Response:
        return ris_response(str(request.url), months={"11509"}) or httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await sync.sync_population(
            app.state.session_factory, client, now=datetime.now(timezone.utc), force=False, files=None
        )
    assert result == ("updated", 0)
    assert await _september(app) == {115: RIS_SAMPLE_VILLAGES}


async def test_older_population_files_only_go_into_the_history_but_a_september_is_still_kept(
    app, few_villages, tmp_path: Path
):
    """一年前的月份比使用中的舊，只寫進年齡歷史；它若是九月，九月表也要有。八月不是九月，九月表不動。"""
    await _sync_files(app, _sample_files(tmp_path, "11509"))
    assert await _sync_files(app, _sample_files(tmp_path, "11408")) == ("history", 0)
    assert await _september(app) == {115: RIS_SAMPLE_VILLAGES}
    assert await _sync_files(app, _sample_files(tmp_path, "11409")) == ("history", 0)
    assert await _september(app) == {114: RIS_SAMPLE_VILLAGES, 115: RIS_SAMPLE_VILLAGES}
    assert await _population_label(app) == "115-09"


async def test_a_year_ago_download_in_a_september_month_writes_september(app, few_villages):
    """sync_age_history 下載一年前的月份（114-09）走 _write_age_history：九月表也要有 114。"""
    async with app.state.session_factory() as db:
        batch = population_io.collect([page["responseData"] for page in ris_sample_pages("11509")])
        await population_io.replace_population(db, batch, synced_at=datetime.now(timezone.utc))
        await db.commit()

    def handle(request: httpx.Request) -> httpx.Response:
        return ris_response(str(request.url), months={"11409"}) or httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert await sync.sync_age_history(app.state.session_factory, client, now=datetime.now(timezone.utc)) == "updated"
    assert await _september(app) == {114: RIS_SAMPLE_VILLAGES}


# ---- 年齡歷史 prune ----


async def test_prune_does_not_touch_september(app, few_villages, tmp_path: Path):
    """年齡歷史只留 25 個月；九月表不刪舊年。"""
    await sync.run_geo_sync(
        app.state.session_factory, app.state.settings,
        september_files=[_bom_file(tmp_path, "10709"), _bom_file(tmp_path, "10809")],
    )
    await _sync_files(app, _sample_files(tmp_path, "11509"))
    before = await _september(app)
    assert before == {107: 4, 108: 4, 115: RIS_SAMPLE_VILLAGES}
    async with app.state.session_factory() as db:
        await series_io.prune(db, series_io.AGES, "115-09")
        await db.commit()
    assert await _september(app) == before
    # 九月表比年齡歷史的視窗（113-09 起）舊的 107、108 年還在；經過 _write_population 內的 prune 也一樣。
    await _sync_files(app, _sample_files(tmp_path, "11510"))
    assert await _september(app) == before


# ---- 打包檔與 CLI ----


def test_september_months_run_from_107_to_the_latest_published_september():
    """fetch_geo_bundle 要抓的九月：ODRP014 最早 107-01，所以從 10709 起；到人口最新月份以前最後一個九月。"""
    assert september_months("11509") == ["10709", "10809", "10909", "11009", "11109", "11209", "11309", "11409", "11509"]
    assert september_months("11510")[-1] == "11509"
    assert september_months("11608")[-1] == "11509"  # 還沒到 116 年的九月
    assert september_months("11609")[-1] == "11609"
    assert september_months("10708") == []


def test_bundle_kind_september(tmp_path: Path):
    content = _bom_file(tmp_path).read_bytes()
    target = tmp_path / "bundle.zip"
    write_bundle(target, [BundleFile("september-10809-1.json", "september", "108-09", "https://example.org", content)])
    grouped = open_bundle(target, tmp_path / "out")
    assert [path.name for path in grouped["september"]] == ["september-10809-1.json"]
    assert grouped["september"][0].read_bytes() == content


def test_cli_options_collect_every_september_file(tmp_path: Path):
    first, second = _bom_file(tmp_path, "10709"), _bom_file(tmp_path, "10809")
    options = geo_sync_options(["--september-file", str(first), "--september-file", str(second)])
    assert options["september_files"] == [first, second]
    assert options["population_files"] is None
    with pytest.raises(SystemExit):
        geo_sync_options(["--september-file"])
    with pytest.raises(SystemExit):
        geo_sync_options(["--september-file", str(tmp_path / "missing.json")])


async def test_cli_geo_sync_bundle_with_september_files(app, few_villages, cli_on_test_app, tmp_path: Path, capsys):
    target = tmp_path / "bundle.zip"
    write_bundle(
        target,
        [
            BundleFile(f"september-{month}-1.json", "september", f"{month[:3]}-09", "https://example.org", _bom_file(tmp_path, month).read_bytes())
            for month in ("10709", "10809")
        ],
    )
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    assert await _september(app) == {107: 4, 108: 4}
    assert "九月底人口：updated（這次寫入 2 年）" in capsys.readouterr().out
    assert await _count(app, GeoVillagePopulation) == 0
