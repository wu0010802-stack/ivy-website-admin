"""各里結婚對數（2026-11-16 廣告成效 §9）：ODRP060 解析、檔案同步、里的變化裡的近 12 個月與走勢、五校並排不讀。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.admissions import trends
from app.admissions.geo import sync
from app.admissions.geo import village_series as series_io
from app.admissions.geo.models import GeoDatasetStatus, GeoVillageMarriages
from app.admissions.geo.village_series import MARRIAGES, collect
from tests.geo_helpers import RIS_SAMPLE_VILLAGES, ris_series_page
from tests.test_admissions_trends import (  # noqa: F401
    BAOYE,
    BENYANG,
    CURRENT,
    NOW,
    _get,
    _name,
    _seed,
    located_campus,
)
from tests.test_admissions_trends import AGES, OLD_CODE

YIHUA_VILLAGE = "64000050015"


@pytest.fixture
def few_villages(monkeypatch):
    monkeypatch.setattr(series_io, "MIN_VILLAGES", 1)


def test_marriages_series_parses_odrp060_page(few_villages):
    page = ris_series_page("ODRP060")["responseData"]
    # 實測欄位：異性與同性結婚對數分開，其他離婚、死亡欄位解析時丟掉。
    assert {"marry_pair_OppositeSex", "marry_pair_SameSex", "divorce_pair_OppositeSex"} <= set(page[0])
    batch = collect(MARRIAGES, [page])
    assert batch.label == "115-09" and len(batch.rows) == RIS_SAMPLE_VILLAGES
    for source in page:
        if not source["district_code"].startswith("64000"):
            continue
        row = next(r for r in batch.rows if r["village_code"] == source["district_code"])
        assert row["marriages"] == int(source["marry_pair_OppositeSex"]) + int(source["marry_pair_SameSex"])
    assert set(batch.rows[0]) == {"month", "village_code", "district", "village", "marriages"}
    # 樣本裡至少有一個里同性結婚對數不是 0，兩欄相加才測得到。
    assert any(int(r["marry_pair_SameSex"]) > 0 for r in page)


async def test_geo_sync_marriages_from_files(app, few_villages, tmp_path: Path):
    files = []
    for month in ("11509", "11508"):
        path = tmp_path / f"marriages-{month}.json"
        path.write_text(json.dumps(ris_series_page("ODRP060", month), ensure_ascii=False), encoding="utf-8")
        files.append(path)
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, marriages_files=files)
    assert (result.marriages, result.marriages_version, result.marriages_months) == ("updated", "115-09", 2)
    assert (result.births, result.migration, result.population) == ("skipped",) * 3
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(GeoVillageMarriages)) == 2 * RIS_SAMPLE_VILLAGES
        status = await db.get(GeoDatasetStatus, "marriages")
    assert status is not None and status.active_version == "115-09" and status.last_error is None


async def _seed_marriages(db, months: list[str], count_of, *, codes=None) -> None:
    for month in months:
        for code in codes or [c for c in AGES if c != OLD_CODE]:
            district, village = _name(code)
            db.add(GeoVillageMarriages(month=month, village_code=code, district=district, village=village, marriages=count_of(month, code)))
    db.add(GeoDatasetStatus(dataset="marriages", active_version=months[-1], label=months[-1], synced_at=NOW))
    await db.commit()


async def test_trends_marriages_per_village_and_baseline(admin_client, db_session, located_campus):
    await _seed(db_session)
    months = series_io.window(CURRENT, 12)
    # 本揚里每月 2 對、寶業里每月 1 對、其他里沒有結婚資料列。
    await _seed_marriages(
        db_session, months, lambda month, code: {BENYANG: 2, BAOYE: 1}[code], codes=[BENYANG, BAOYE]
    )
    body = await _get(admin_client)
    assert body["sources"]["marriages"] == {"latest": CURRENT, "months": months, "missing": []}
    villages = {row["key"]: row for row in body["villages"]}
    assert villages[BENYANG]["marriages_12m"] == 24
    assert villages[BAOYE]["marriages_12m"] == 12
    others = [row for key, row in villages.items() if key not in (BENYANG, BAOYE)]
    assert others and all(row["marriages_12m"] is None for row in others)
    assert body["baseline"]["marriages_12m"] == 36 and body["baseline"]["marriages_months"] == 12


async def test_marriages_window_follows_its_own_latest_month(admin_client, db_session, located_campus):
    await _seed(db_session)
    months = series_io.window("115-08", 12)  # 出生是 115-09、結婚只到 115-08
    await _seed_marriages(db_session, months, lambda month, code: 1, codes=[BENYANG])
    body = await _get(admin_client)
    assert body["sources"]["births"]["latest"] == CURRENT
    assert body["sources"]["marriages"] == {"latest": "115-08", "months": months, "missing": []}


async def test_without_marriages_the_fields_are_empty(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["sources"]["marriages"] == {"latest": None, "months": [], "missing": []}
    assert body["baseline"]["marriages_12m"] is None and body["baseline"]["marriages_months"] == 0
    assert all(row["marriages_12m"] is None for row in body["villages"])
    assert all(period["marriages"] is None for period in body["baseline"]["births_series"])


def test_birth_series_includes_marriages():
    births = {month: {"a": 1} for month in series_io.window("115-09", 24)}
    full = series_io.window("115-09", 12)  # 最新一期 12 個月
    older = series_io.window("114-09", 12)
    marriages = {month: {"a": 2} for month in full}
    marriages.update({month: {"a": 3} for month in older[:9]})  # 前一期只有 9 個月
    periods = trends.birth_series(births, "115-09", ["a"], marriages)
    assert [period["marriages"] for period in periods] == [24, None]
    assert [period["births"] for period in periods] == [12, 12]
    # 沒給結婚資料：舊的呼叫方式不變、marriages 是 None。
    assert [period["marriages"] for period in trends.birth_series(births, "115-09", ["a"])] == [None, None]


async def test_kids_only_skips_marriages(db_session, located_campus):
    await _seed(db_session)
    await _seed_marriages(db_session, series_io.window(CURRENT, 12), lambda month, code: 1, codes=[BENYANG])
    full = await trends.query_trends(db_session, "yihua", school_year=None, semester=None, radius_km=1)
    light = await trends.query_trends(db_session, "yihua", school_year=None, semester=None, radius_km=1, kids_only=True)
    assert full["baseline"]["marriages_12m"] == 12
    assert light["sources"]["marriages"] == {"latest": None, "months": [], "missing": []}
    assert light["baseline"]["marriages_12m"] is None and light["baseline"]["marriages_months"] == 0
    assert all(row["marriages_12m"] is None for row in light["villages"])
    assert all(period["marriages"] is None for period in light["baseline"]["births_series"])


def test_cli_and_bundle_accept_marriages(tmp_path: Path):
    from app.admissions.geo.bundle import KINDS
    from app.cli import geo_sync_options

    first, second = tmp_path / "a.json", tmp_path / "b.json"
    for path in (first, second):
        path.write_text("{}")
    options = geo_sync_options(["--marriages-file", str(first), "--marriages-file", str(second)])
    assert options["marriages_files"] == [first, second] and options["births_files"] is None
    assert "marriages" in KINDS
