"""高雄市門牌 CSV 的逐列解析、分批匯入、切換批次（2026-10-08 規格 §4、§7）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.doorplates import (
    EXPECTED_HEADER,
    DoorplateFormatError,
    DoorplateParser,
    activate_doorplates,
    import_doorplates,
)
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.common.csv_export import BOM
from tests.geo_helpers import FIXTURES, sample_doorplate_rows

HEADER = ",".join(EXPECTED_HEADER)


def _feed(*lines: str):
    parser = DoorplateParser()
    rows = [parser.feed(line) for line in (HEADER, *lines)]
    return [row for row in rows if row is not None], parser


def test_sample_is_parsed_and_floors_are_deduplicated():
    rows = sample_doorplate_rows()
    assert len(rows) == 73
    yihua_68 = [r for r in rows if r.street == "義華路" and r.number == 68]
    assert len(yihua_68) == 1  # 原檔 68 號另有 4 列樓層
    row = yihua_68[0]
    assert (row.town_code, row.district, row.village, row.lane, row.alley, row.number_sub) == (
        "6400500", "三民區", "本揚里", "", "", 0,
    )
    assert row.lat == pytest.approx(22.6424556, abs=1e-6) and row.lng == pytest.approx(120.3437133, abs=1e-6)


def test_fullwidth_lanes_named_lanes_areas_and_village_fix():
    rows = sample_doorplate_rows()
    assert {(r.lane, r.alley) for r in rows if r.street == "旗津三路"} >= {("900", ""), ("900", "3")}
    assert {r.lane for r in rows if r.street == "仁心路"} == {"博愛"}
    area = [r for r in rows if r.street == "右昌一巷"]
    assert area and {r.street_kind for r in area} == {"area"}
    assert {r.street_kind for r in rows if r.street == "義華路"} == {"road"}
    assert "北美術館里" in {r.village for r in rows}


@pytest.mark.parametrize(
    ("number_text", "expected"),
    [
        ("１１０號", (110, 0)),
        ("１１４之４號", (114, 4)),
        ("５２號之５", (52, 5)),  # 之號寫在號後面
        ("１２８號十樓之１", (128, 0)),  # 樓層的之不算
        ("４之３之１號", (4, 3)),
        ("臨２９號", (29, 0)),
        ("２５號四樓之３附１", (25, 0)),
    ],
)
def test_number_forms(number_text, expected):
    rows, _ = _feed(f"64,6400100,中原里,001,七賢三路,,,,{number_text},176205.163,2503011.609")
    assert [(r.number, r.number_sub) for r in rows] == [expected]


@pytest.mark.parametrize("number_text", ["７４附２號", "特８號", "一棟二樓1號", "之24號"])
def test_irregular_numbers_are_skipped(number_text):
    rows, parser = _feed(f"64,6400200,光化里,002,鼓山二路,,,,{number_text},176260.29,2503752.934")
    assert rows == [] and parser.skipped == 1


def test_unknown_town_and_broken_coordinates_are_skipped():
    rows, parser = _feed(
        "65,6500100,某里,001,某路,,,,１號,176205.163,2503011.609",
        "64,6400100,中原里,001,七賢三路,,,,１號,,",
    )
    assert rows == [] and parser.skipped == 2


@pytest.mark.parametrize("header", [HEADER, BOM + HEADER, HEADER + "\r\n"])
def test_header_with_or_without_bom(header):
    parser = DoorplateParser()
    assert parser.feed(header) is None
    assert parser.feed("64,6400100,中原里,001,七賢三路,,,,１號,176205.163,2503011.609") is not None


def test_changed_header_is_rejected():
    with pytest.raises(DoorplateFormatError):
        DoorplateParser().feed("省市縣市代碼,鄉鎮市區代碼,村里\n")


async def _rows(items):
    for item in items:
        yield item


async def _count(app, tag: str | None = None) -> int:
    async with app.state.session_factory() as db:
        stmt = select(func.count()).select_from(GeoDoorplate)
        if tag is not None:
            stmt = stmt.where(GeoDoorplate.dataset_version == tag)
        return await db.scalar(stmt)


async def test_import_then_activate_replaces_previous_batch(app):
    rows = sample_doorplate_rows()
    factory = app.state.session_factory
    now = datetime.now(timezone.utc)
    assert await import_doorplates(factory, "115-09#old000", _rows(rows[:10]), batch_size=4) == 10
    await activate_doorplates(factory, "115-09#old000", "115-09", now=now)
    assert await import_doorplates(factory, "115-10#new000", _rows(rows), batch_size=50) == 73
    assert await _count(app, "115-09#old000") == 10  # 切換前舊批次照常可查

    await activate_doorplates(factory, "115-10#new000", "115-10", now=now)
    assert await _count(app) == 73 == await _count(app, "115-10#new000")
    async with factory() as db:
        status = await db.get(GeoDatasetStatus, "doorplates")
    assert (status.active_version, status.label, status.last_error) == ("115-10#new000", "115-10", None)


async def test_failed_import_leaves_active_batch_alone(app):
    rows = sample_doorplate_rows()
    factory = app.state.session_factory
    await import_doorplates(factory, "115-10#good00", _rows(rows))
    await activate_doorplates(factory, "115-10#good00", "115-10", now=datetime.now(timezone.utc))

    async def broken():
        for row in rows[:7]:
            yield row
        raise ConnectionError("下載中斷")

    with pytest.raises(ConnectionError):
        await import_doorplates(factory, "115-11#bad000", broken(), batch_size=3)
    assert await _count(app, "115-11#bad000") == 0
    assert await _count(app) == 73
    async with factory() as db:
        assert (await db.get(GeoDatasetStatus, "doorplates")).active_version == "115-10#good00"


def test_fixture_keeps_original_file_format():
    raw = (FIXTURES / "doorplates-sample.csv").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw
