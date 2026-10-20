"""每年九月底各里人口（2026-10-20 招生潛力與市佔率規格 §3.2）：解析時剝掉回應第一個鍵的 BOM、--september-file
回補、正常人口同步順手寫入、年齡歷史 prune 不動它、打包檔收 september。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app import cli
from app.admissions.geo import boundaries
from app.admissions.geo import population as population_io
from app.admissions.geo import september as september_io
from app.admissions.geo import sync
from app.admissions.geo import village_series as series_io
from app.admissions.geo.bundle import BundleFile, open_bundle, write_bundle
from app.admissions.geo.models import (
    GeoDatasetStatus,
    GeoElementaryGrade1,
    GeoVillageAges,
    GeoVillageAgesSeptember,
    GeoVillagePopulation,
)
from app.admissions.geo.september import (
    backfill_from_ages,
    current_code,
    normalize,
    september_months,
    september_years,
    upsert_september,
)
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import FIXTURES, RIS_SAMPLE_VILLAGES, ris_response, ris_sample_pages

BOM = chr(0xFEFF)  # U+FEFF：內政部 API 在部分月份（例如 10809）把它放在每列第一個鍵前面
BOM_FIXTURE = FIXTURES / "ris-odrp014-10809-bom.json"
# 真實 10709 回應裁出的 6 列（數字是真值，只有人口數）：三民一 2 里、三民二 2 里、鹽埕區 2 里（藍橋里現行、
# 慈愛里 115-07 廢止，換不到現行代碼）。
LEGACY_FIXTURE = FIXTURES / "ris-odrp014-10709-legacy.json"
LEGACY_AGE_2_TO_5 = 103 + 83 + 162 + 331 + 36 + 5
LEGACY_PEOPLE_TOTAL = 3295 + 2817 + 4423 + 9068 + 1500 + 403
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


def _unmatched_code_files(tmp_path: Path, month: str, unmatched: dict[str, tuple[str, str]]) -> list[Path]:
    """樣本頁把 unmatched 裡的 (代碼, 里名) 換成里界檔沒有、也換不到現行代碼的里（像 115-07 廢止的里）。"""
    files = []
    for index, page in enumerate(ris_sample_pages(month), start=1):
        for row in page["responseData"]:
            row["district_code"], row["village"] = unmatched.get(row["district_code"], (row["district_code"], row["village"]))
        path = tmp_path / f"{month}-unmatched-{index}.json"
        path.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
        files.append(path)
    return files


async def test_september_keeps_codes_the_boundary_file_does_not_have(app, few_villages, tmp_path: Path):
    """換不到現行代碼的里（例如 115-07 廢止的里）九月底人口照原代碼存，不能像使用中的人口一樣略過。"""
    unmatched = {"64000050015": ("64000059901", "舊一里"), "64000050025": ("64000059902", "舊二里")}
    files = _unmatched_code_files(tmp_path, "10809", unmatched)
    await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=files)
    assert await _september(app) == {108: RIS_SAMPLE_VILLAGES}
    async with app.state.session_factory() as db:
        kept = await db.get(GeoVillageAgesSeptember, (108, "64000059901"))
    assert kept is not None and (kept.village, kept.district) == ("舊一里", "三民區")
    # 使用中的人口仍只收里界檔有的代碼。
    assert await _sync_files(app, _unmatched_code_files(tmp_path, "11509", unmatched)) == ("updated", len(unmatched))
    assert await _count(app, GeoVillagePopulation) == RIS_SAMPLE_VILLAGES - len(unmatched)
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


# ---- 舊代碼換成現行代碼 ----


def _legacy_rows() -> list[population_io.PopulationRow]:
    """用到 collect，呼叫的測試要帶 few_villages（fixture 只有 6 個里）。"""
    rows = population_io.response_rows(population_io.parse_page(LEGACY_FIXTURE.read_text(encoding="utf-8")))
    return population_io.collect([rows], keep_unknown=True).rows


def _legacy_row(village: str) -> population_io.PopulationRow:
    return next(row for row in _legacy_rows() if row.village == village)


def test_current_code_maps_legacy_codes_by_district_prefix_and_village_name():
    expected = boundaries.village_code("三民區", "安東里")
    assert expected is not None and expected != "64000051046"
    assert current_code("64000051046", "安東里") == expected  # 三民一
    assert current_code("64000052001", "鼎金里") == boundaries.village_code("三民區", "鼎金里")  # 三民二
    assert current_code(expected, "任何名稱") == expected  # 本來就是現行代碼：原樣
    assert current_code("64000010002", "慈愛里") is None  # 廢止的里：對不到
    assert current_code("64000051046", "沒有這個里") is None


def test_current_code_gives_up_when_the_match_is_not_unique(few_villages, monkeypatch):
    monkeypatch.setattr(september_io, "_index", lambda: {("6400005", "安東里"): ["64000050001", "64000050002"]})
    assert current_code("64000051046", "安東里") is None
    rows = [_legacy_row("安東里")]
    result = normalize(rows)
    assert (result.remapped, result.merged, result.unmatched) == (0, 0, 1)
    assert result.rows == rows  # 不唯一就照原代碼、原名稱存


def test_normalize_replaces_legacy_codes_and_counts(few_villages):
    rows = _legacy_rows()
    assert {row.village_code for row in rows} >= {"64000051046", "64000051047", "64000052001", "64000052002"}
    result = normalize(rows)
    assert (result.remapped, result.merged, result.unmatched) == (4, 0, 1)
    by_village = {row.village: row for row in result.rows}
    assert len(result.rows) == len(rows)
    for village in ("安東里", "安和里", "鼎金里", "鼎盛里"):
        row = by_village[village]
        assert row.village_code == boundaries.village_code("三民區", village) and row.district == "三民區"
    assert by_village["藍橋里"].village_code == "64000010001"  # 本來就是現行代碼
    assert by_village["慈愛里"].village_code == "64000010002"  # 換不到：照原代碼
    assert sum(row.age_2 + row.age_3 + row.age_4 + row.age_5 for row in result.rows) == LEGACY_AGE_2_TO_5
    assert sum(row.people_total for row in result.rows) == LEGACY_PEOPLE_TOTAL


def test_normalize_sums_rows_that_land_on_the_same_current_code(few_villages):
    old = _legacy_row("安東里")  # 三民一（舊代碼）
    current = boundaries.village_code("三民區", "安東里")
    other = replace(old, village_code=current, district="三民區", age_2=5, age_3=1, people_total=10)
    result = normalize([old, other])
    assert (result.remapped, result.merged, result.unmatched) == (1, 1, 0)
    (row,) = result.rows
    assert (row.village_code, row.district, row.village) == (current, "三民區", "安東里")
    assert (row.age_2, row.age_3, row.people_total) == (old.age_2 + 5, old.age_3 + 1, old.people_total + 10)


async def test_september_file_writes_current_codes_and_keeps_the_totals(app, few_villages):
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, september_files=[LEGACY_FIXTURE])
    assert (result.september, result.september_years) == ("updated", 1)
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(GeoVillageAgesSeptember).where(GeoVillageAgesSeptember.year == 107))).scalars().all()
    assert len(rows) == 6
    sanmin = [row for row in rows if row.village in ("安東里", "安和里", "鼎金里", "鼎盛里")]
    assert len(sanmin) == 4
    assert all(row.village_code == boundaries.village_code("三民區", row.village) and row.district == "三民區" for row in sanmin)
    assert all(row.village_code in boundaries.village_codes() for row in rows if row.village != "慈愛里")
    assert sum(row.age_2 + row.age_3 + row.age_4 + row.age_5 for row in rows) == LEGACY_AGE_2_TO_5
    assert sum(row.people_total for row in rows) == LEGACY_PEOPLE_TOTAL
    old = [row for row in rows if row.village == "慈愛里"]
    assert [(row.village_code, row.district) for row in old] == [("64000010002", "鹽埕區")]


# ---- 年齡歷史裡漏掉的九月補進來 ----


async def _write_ages(app, month: str) -> None:
    async with app.state.session_factory() as db:
        batch = series_io.collect(series_io.AGES, [page["responseData"] for page in ris_sample_pages(month)])
        await series_io.replace_month(db, series_io.AGES, batch)
        await db.commit()


async def test_backfill_from_ages_fills_every_missing_september(app, few_villages):
    for month in ("11409", "11508", "11509"):
        await _write_ages(app, month)
    async with app.state.session_factory() as db:
        # 114 年九月表已經有（只有 3 列）：不覆蓋。
        rows = population_io.collect([page["responseData"] for page in ris_sample_pages("11409")]).rows
        await upsert_september(db, 114, rows[:3])
        assert await backfill_from_ages(db) == [115]
        await db.commit()
    assert await _september(app) == {114: 3, 115: RIS_SAMPLE_VILLAGES}
    async with app.state.session_factory() as db:
        assert await backfill_from_ages(db) == []


async def test_backfill_from_ages_replaces_legacy_codes(app, few_villages):
    async with app.state.session_factory() as db:
        db.add(GeoVillageAges(
            month="107-09", village_code="64000051046", district="三民一", village="安東里",
            age_0=1, age_1=2, age_2=3, age_3=4, age_4=5, age_5=6, age_6=7, people_total=100,
        ))
        await db.commit()
        assert await backfill_from_ages(db) == [107]
        await db.commit()
        row = await db.get(GeoVillageAgesSeptember, (107, boundaries.village_code("三民區", "安東里")))
    assert (row.district, row.village, row.age_3, row.people_total) == ("三民區", "安東里", 4, 100)


async def test_age_history_sync_fills_septembers_missing_from_the_september_table(app, few_villages):
    """年齡歷史有 11409、11509、九月表是空的（部署前就同步過、或同步跳過九月）：下一輪年齡歷史同步補上兩年。"""
    async with app.state.session_factory() as db:
        batch = population_io.collect([page["responseData"] for page in ris_sample_pages("11509")])
        await population_io.replace_population(db, batch, synced_at=datetime.now(timezone.utc))
        await db.commit()
    for month in ("11409", "11509"):
        await _write_ages(app, month)
    assert await _september(app) == {}
    result = await sync.sync_age_history(app.state.session_factory, None, now=datetime.now(timezone.utc))
    assert result == "updated"
    assert await _september(app) == {114: RIS_SAMPLE_VILLAGES, 115: RIS_SAMPLE_VILLAGES}
    assert await sync.sync_age_history(app.state.session_factory, None, now=datetime.now(timezone.utc)) == "skipped"


async def test_a_population_sync_also_fills_the_missing_september_before_it_prunes(app, few_villages, tmp_path: Path):
    """十月的月份不是九月，但年齡歷史裡漏掉的 114 年九月要在 prune 之前補上。"""
    await _write_ages(app, "11409")
    assert await _sync_files(app, _sample_files(tmp_path, "11510")) == ("updated", 0)
    assert await _september(app) == {114: RIS_SAMPLE_VILLAGES}


# ---- 九月表失敗不拖累人口與年齡歷史 ----


async def _boom(*args, **kwargs):
    raise RuntimeError("九月表壞了")


def _september_warnings(caplog) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.levelno == logging.WARNING and "九月底人口" in record.getMessage()]


async def _ages_months(app) -> set[str]:
    async with app.state.session_factory() as db:
        return set((await db.execute(select(GeoVillageAges.month).distinct())).scalars())


async def test_a_failing_september_write_keeps_the_population_and_heals_next_round(
    app, few_villages, monkeypatch, caplog, tmp_path: Path
):
    """九月的 upsert 拋錯：使用中的人口照樣換版、年齡歷史照樣寫入、同步結果不是 failed，記 warning；
    下一輪年齡歷史同步（沒有新月份）從年齡歷史把九月補回來。"""
    with monkeypatch.context() as patched, caplog.at_level(logging.WARNING):
        patched.setattr(september_io, "upsert_september", _boom)
        assert await _sync_files(app, _sample_files(tmp_path, "11509")) == ("updated", 0)
    assert await _population_label(app) == "115-09"
    assert await _count(app, GeoVillagePopulation) == RIS_SAMPLE_VILLAGES
    assert await _ages_months(app) == {"115-09"}
    assert await _september(app) == {}
    assert len(_september_warnings(caplog)) >= 1 and all(record.exc_info for record in _september_warnings(caplog))
    async with app.state.session_factory() as db:
        assert (await db.get(GeoDatasetStatus, "population")).last_error is None
    result = await sync.sync_age_history(app.state.session_factory, None, now=datetime.now(timezone.utc))
    assert result == "updated"
    assert await _september(app) == {115: RIS_SAMPLE_VILLAGES}


async def test_a_failing_september_backfill_keeps_the_new_population_month(
    app, few_villages, monkeypatch, caplog, tmp_path: Path
):
    await _write_ages(app, "11409")
    with monkeypatch.context() as patched, caplog.at_level(logging.WARNING):
        patched.setattr(september_io, "backfill_from_ages", _boom)
        assert await _sync_files(app, _sample_files(tmp_path, "11510")) == ("updated", 0)
    assert await _population_label(app) == "115-10"
    assert await _ages_months(app) == {"114-09", "115-10"}
    assert await _september(app) == {}
    assert len(_september_warnings(caplog)) == 1


async def test_a_failing_september_backfill_does_not_stop_the_age_history_sync(
    app, few_villages, monkeypatch, caplog
):
    """sync_age_history：複製使用中的月份、一年前的下載與 prune 都照做，補漏失敗只記 warning。"""
    async with app.state.session_factory() as db:
        batch = population_io.collect([page["responseData"] for page in ris_sample_pages("11509")])
        await population_io.replace_population(db, batch, synced_at=datetime.now(timezone.utc))
        await db.commit()

    def handle(request: httpx.Request) -> httpx.Response:
        return ris_response(str(request.url), months={"11409"}) or httpx.Response(404)

    with monkeypatch.context() as patched, caplog.at_level(logging.WARNING):
        patched.setattr(september_io, "backfill_from_ages", _boom)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            result = await sync.sync_age_history(app.state.session_factory, client, now=datetime.now(timezone.utc))
    assert result == "updated"
    assert await _ages_months(app) == {"114-09", "115-09"}
    assert len(_september_warnings(caplog)) >= 1
    async with app.state.session_factory() as db:
        assert (await db.get(GeoDatasetStatus, "population")).last_error is None


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
    """sync_age_history 下載一年前的月份（114-09）走 _write_age_history：九月表也要有 114（115 是從使用中的人口複製進年齡歷史後補的）。"""
    async with app.state.session_factory() as db:
        batch = population_io.collect([page["responseData"] for page in ris_sample_pages("11509")])
        await population_io.replace_population(db, batch, synced_at=datetime.now(timezone.utc))
        await db.commit()

    def handle(request: httpx.Request) -> httpx.Response:
        return ris_response(str(request.url), months={"11409"}) or httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert await sync.sync_age_history(app.state.session_factory, client, now=datetime.now(timezone.utc)) == "updated"
    # 年齡歷史同步會把 115-09（從使用中的人口複製進來的）一起補進九月表。
    assert await _september(app) == {114: RIS_SAMPLE_VILLAGES, 115: RIS_SAMPLE_VILLAGES}


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


async def test_cli_checks_september_files_before_anything_is_written(app, few_villages, cli_on_test_app, tmp_path: Path):
    """九月檔有一個是 11508：run_geo_sync 之前就 exit，同時給的人口檔（九月之前寫）、國小檔（九月之後寫）都不寫。"""
    population = _sample_files(tmp_path, "11509")
    elementary = tmp_path / "114_basec.csv"
    elementary.write_bytes((FIXTURES / "moe-basec-114.csv").read_bytes())
    args = [arg for path in population for arg in ("--population-file", str(path))]
    args += ["--september-file", str(_bom_file(tmp_path, "10809")), "--september-file", str(_bom_file(tmp_path, "11508"))]
    args += ["--elementary-file", str(elementary)]

    with pytest.raises(SystemExit) as raised:
        await geo_sync_command(**geo_sync_options(args))

    assert "115-08" in str(raised.value)
    assert await _september(app) == {}
    assert await _count(app, GeoVillagePopulation) == 0
    assert await _count(app, GeoVillageAges) == 0
    assert await _count(app, GeoElementaryGrade1) == 0


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
