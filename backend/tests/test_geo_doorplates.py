"""高雄市門牌 CSV 的逐列解析、分批匯入、切換批次（2026-10-08 規格 §4、§7）。"""

from __future__ import annotations

import logging
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


def _line(
    *, town="6400100", village="中原里", road="七賢三路", lane="", alley="", number="１號",
    x="176205.163", y="2503011.609",
) -> str:
    return f"64,{town},{village},001,{road},,{lane},{alley},{number},{x},{y}"


def test_a_normal_line_is_kept_by_the_helper():
    rows, parser = _feed(_line())
    assert len(rows) == 1 and parser.skipped == 0


@pytest.mark.parametrize(
    "line",
    [
        _line(road="甲" * 41),  # street 欄寬 40
        _line(village="甲" * 17 + "里"),  # village 欄寬 16
        _line(village="甲" * 16),  # 補上「里」之後 17 字
        _line(lane="１" * 17 + "巷"),  # lane 欄寬 16
        _line(lane="甲" * 17 + "巷"),
        _line(alley="甲" * 17 + "弄"),
        _line(number="１" * 5000 + "號"),  # 超大數字不能丟例外
        _line(number="１００００００號"),  # 超過 99999：解析端也不會產生這種門牌
        _line(number="１之" + "９" * 5000 + "號"),
        _line(number="１之１００００００號"),
    ],
    ids=["street", "village", "village-fixed", "lane-digits", "lane-name", "alley", "number-5000", "number-7", "sub-5000", "sub-7"],
)
def test_overlong_fields_skip_the_line_and_are_counted(line):
    rows, parser = _feed(line, _line(number="２號"))
    assert [r.number for r in rows] == [2]  # 後面的好行照常
    assert (parser.parsed, parser.skipped) == (1, 1)


def test_fields_exactly_at_column_width_are_kept():
    rows, parser = _feed(
        _line(road="甲" * 40, village="乙" * 15 + "里", lane="１" * 16 + "巷", alley="丙" * 16 + "弄", number="９９９９９號")
    )
    assert parser.skipped == 0
    (row,) = rows
    assert (len(row.street), len(row.village), len(row.lane), len(row.alley), row.number) == (40, 16, 16, 16, 99999)


def test_leading_zero_lane_and_chinese_lane_match_the_address_parser():
    rows, _ = _feed(_line(lane="０６６巷"), _line(lane="一百零八巷", number="２號"))
    assert [(r.lane, r.number) for r in rows] == [("66", 1), ("108", 2)]


@pytest.mark.parametrize(
    ("x", "y"),
    [
        ("nan", "2503011.609"), ("176205.163", "nan"), ("inf", "2503011.609"), ("176205.163", "-inf"),
        ("1e999", "2503011.609"),  # float() 本身就變 inf
        ("1e200", "1e200"),  # 投影公式溢位（OverflowError）
        ("0", "0"),  # 轉出來在幾內亞灣
        ("2503011.609", "176205.163"),  # 橫縱對調
        ("-176205.163", "2503011.609"),
        ("176205.163", "9999999"),  # 在北極圈
        ("550000", "2503011.609"),  # 在台灣東邊外海
    ],
)
def test_bad_or_out_of_range_coordinates_are_skipped_without_raising(x, y):
    rows, parser = _feed(_line(x=x, y=y), _line(number="２號"))
    assert [r.number for r in rows] == [2]
    assert (parser.parsed, parser.skipped) == (1, 1)


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


async def test_source_generator_is_closed_when_the_import_fails(app, monkeypatch):
    """匯入中途失敗（寫入出錯）時，上游的列產生器要被確實關閉（它握著下載連線），
    不能等垃圾回收；匯入成功讀完時也一樣關。"""
    from app.admissions.geo import doorplates as doorplate_io

    rows = sample_doorplate_rows()
    closed: list[str] = []

    async def source(name: str):
        try:
            for row in rows[:10]:
                yield row
        finally:
            closed.append(name)

    real_copy = doorplate_io.copy_doorplates
    calls: list[int] = []

    async def failing_second_copy(db, tag, batch):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("寫入失敗")
        await real_copy(db, tag, batch)

    monkeypatch.setattr(doorplate_io, "copy_doorplates", failing_second_copy)
    broken = source("broken")
    with pytest.raises(RuntimeError, match="寫入失敗"):
        await import_doorplates(app.state.session_factory, "115-11#close0", broken, batch_size=3)
    assert closed == ["broken"]  # 呼叫端還握著 broken，不是垃圾回收收掉的

    monkeypatch.setattr(doorplate_io, "copy_doorplates", real_copy)
    finished = source("finished")
    assert await import_doorplates(app.state.session_factory, "115-11#close1", finished, batch_size=3) == 10
    assert closed == ["broken", "finished"]


async def test_failed_cleanup_does_not_hide_the_original_error(caplog):
    """下載中斷（原例外）之後清批次又失敗（連線也斷了）：往上丟的要是原例外，清理失敗只記 log。"""

    def broken_session_factory():
        raise RuntimeError("清理時連線也斷了")

    async def interrupted():
        yield sample_doorplate_rows()[0]
        raise ConnectionError("下載中斷")

    with caplog.at_level(logging.WARNING, logger="app.admissions.geo.doorplates"):
        with pytest.raises(ConnectionError, match="下載中斷"):
            await import_doorplates(broken_session_factory, "115-11#bad000", interrupted(), batch_size=3)
    assert any("115-11#bad000" in record.getMessage() for record in caplog.records)


async def test_a_skipped_line_never_fails_the_whole_import(app):
    """超長、座標不合格的列由解析器擋下並計數，整批照常寫進資料庫（以前一列超長整批 COPY 失敗）。"""
    parser = DoorplateParser()
    lines = [
        HEADER,
        _line(road="甲" * 41),
        _line(x="nan", y="nan"),
        _line(number="１" * 5000 + "號"),
        _line(number="７號"),
        _line(number="８號"),
    ]

    async def rows():
        for line in lines:
            row = parser.feed(line)
            if row is not None:
                yield row

    factory = app.state.session_factory
    assert await import_doorplates(factory, "115-10#skips0", rows()) == 2
    assert (parser.parsed, parser.skipped) == (2, 3)
    assert await _count(app, "115-10#skips0") == 2


def test_fixture_keeps_original_file_format():
    raw = (FIXTURES / "doorplates-sample.csv").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw
