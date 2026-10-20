"""招生潛力來源一：附近園所停辦釋出（2026-10-20 招生潛力第二、三波，報告 A-07、I-4）。

純函式測試用自己造的 ClosureEvent；載入測試用 peer_fees_helpers 的小園所（義華校址往北幾公尺），不依賴真回補檔。
回測兩例照報告：愛爾蘭（核定 136、607 m）與童年綠地（480、676 m），收費相近、私立，承接率 13.8%。"""
from __future__ import annotations

import json
import math
import threading
from dataclasses import replace
from datetime import date, datetime, timezone

import pytest

from app.admissions import area, potential
from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.enrolled.models import EnrolledRoster
from app.admissions.geo import boundaries, matcher
from app.admissions.geo import presale as presale_io
from app.admissions.geo.models import GeoDatasetStatus, GeoPresaleBuildcase, GeoProviderEvent, GeoVillagePopulation
from app.admissions.potential import (
    CATCH_RATE_HIGH,
    CATCH_RATE_MID,
    DELIVERY_RADIUS_M,
    GRADUATING_SHARE,
    KIDS_PER_100_HOUSEHOLDS,
    OCCUPANCY_RATE,
    ClosureEvent,
    Delivery,
    Range,
    VillageObs,
    band_shares,
    band_weight,
    closure_inflow,
    closures_range,
    first_window_start,
    fit_distance_model,
    load_closure_events,
    load_deliveries,
    load_village_obs,
    next_school_year_start,
    presale_range,
    price_factor,
    query_potential,
    school_year_window,
    village_gaps,
    villages_range,
)
from tests.enrolled_helpers import payload_text, points_payload, student
from tests.geo_helpers import YIHUA_POINT
from tests.peer_fees_helpers import add_fee, add_kindergarten

UNIT = OCCUPANCY_RATE * (1 - GRADUATING_SHARE)  # 核定 1 席、距離與價格係數都是 1 時，承接率取 1 的流入


def event(
    on: date, capacity: int | None = 100, *, distance: float = 500, kind: str = "private",
    own: int | None = 100_000, their: int | None = 100_000, name: str = "測試幼兒園",
) -> ClosureEvent:
    return ClosureEvent(
        occurred_on=on, name=name, kind=kind, approved_capacity=capacity, distance_m=distance,
        own_fee=own, their_fee=their,
    )


# ---- 常數與係數 ----


def test_parameters_are_the_report_values():
    assert (OCCUPANCY_RATE, GRADUATING_SHARE, CATCH_RATE_MID, CATCH_RATE_HIGH) == (0.67, 0.29, 0.138, 0.173)


@pytest.mark.parametrize(
    ("distance", "weight"),
    [(0, 1), (1500, 1), (1501, 0.45), (3000, 0.45), (3001, 0.12), (5000, 0.12), (5001, 0.02), (8000, 0.02), (8001, 0)],
)
def test_band_weight_boundaries(distance, weight):
    assert band_weight(distance) == weight


@pytest.mark.parametrize(
    ("kind", "own", "their", "factor"),
    [
        # 義華收費是對方的 0.8–1.3 倍 → 1（兩端都含）
        ("private", 100_000, 100_000, 1),
        ("private", 80_000, 100_000, 1),
        ("private", 130_000, 100_000, 1),
        # 對方貴很多（義華不到 0.8 倍）→ 0.7
        ("private", 79_999, 100_000, 0.7),
        # 義華貴 1.3–1.6 倍 → 0.6；更貴 → 0.3
        ("private", 130_001, 100_000, 0.6),
        ("private", 160_000, 100_000, 0.6),
        ("private", 160_001, 100_000, 0.3),
        # 公共化（公幼、非營利、準公共）→ 0.1，不看收費
        ("public", 100_000, 100_000, 0.1),
        ("nonprofit", 100_000, 40_000, 0.1),
        ("quasi_public", None, None, 0.1),
        # 沒有收費資料 → 1
        ("private", 100_000, None, 1),
        ("private", None, 100_000, 1),
        ("private", 100_000, 0, 1),
    ],
)
def test_price_factor(kind, own, their, factor):
    assert price_factor(kind, own, their) == factor


@pytest.mark.parametrize(
    ("day", "year"),
    [
        (date(2022, 10, 1), 111),
        (date(2023, 9, 30), 111),
        (date(2023, 10, 1), 112),
        (date(2022, 9, 30), 110),
        (date(2022, 12, 31), 111),
        (date(2023, 1, 1), 111),
        (date(2026, 10, 20), 115),
    ],
)
def test_school_year_window(day, year):
    assert school_year_window(day) == year


# ---- 回測（報告 I-4：不受空位限制的數字）----


def test_backtest_ireland():
    # 136 席、607 m、私立、收費相近：136 × 0.67 × 0.71 × 0.138 ≈ 8.9
    inflow = closure_inflow(event(date(2025, 12, 1), 136, distance=607, own=125_000, their=100_000), catch_rate=CATCH_RATE_MID)
    assert inflow == pytest.approx(8.9, abs=0.1)


def test_backtest_childhood_green():
    inflow = closure_inflow(event(date(2025, 6, 1), 480, distance=676), catch_rate=CATCH_RATE_MID)
    assert inflow == pytest.approx(31.5, abs=0.1)


def test_closure_inflow_applies_every_factor():
    # 核定 200 × 0.67 × 0.71 × 0.138 × 距離（2 km → 0.45）× 價格（義華貴 1.4 倍 → 0.6）
    far = event(date(2024, 1, 1), 200, distance=2000, own=140_000, their=100_000)
    assert closure_inflow(far, catch_rate=CATCH_RATE_MID) == pytest.approx(200 * UNIT * 0.138 * 0.45 * 0.6)
    assert closure_inflow(far, catch_rate=1) == pytest.approx(200 * UNIT * 0.45 * 0.6)


def test_closure_inflow_is_zero_without_capacity_or_beyond_8km():
    assert closure_inflow(event(date(2024, 1, 1), None), catch_rate=1) == 0
    assert closure_inflow(event(date(2024, 1, 1), 0), catch_rate=1) == 0
    assert closure_inflow(event(date(2024, 1, 1), 100, distance=8001), catch_rate=1) == 0


# ---- Range ----


def test_range_rounds_to_one_decimal():
    assert Range(1.38, 2.76, 5.19) == Range(1.4, 2.8, 5.2)
    assert (Range(1.38, 2.76, 5.19).low, Range(1.38, 2.76, 5.19).high) == (1.4, 5.2)


# ---- closures_range ----

TODAY = date(2025, 10, 1)  # 111、112、113 三個學年窗口都已結束（113 在 2025-09-30 結束）


def three_windows() -> list[ClosureEvent]:
    return [
        event(date(2022, 11, 15), 100),  # 111 學年
        event(date(2024, 3, 1), 300),  # 112 學年
        event(date(2025, 5, 1), 200),  # 113 學年
    ]


def test_closures_range_low_mid_high():
    # 三個窗口的加權值 1:3:2（×100×UNIT）→ 低＝最低年 × 13.8%、中＝平均 × 13.8%、高＝最高年 × 17.3%
    result, details = closures_range(three_windows(), today=TODAY)
    assert result == Range(
        low=100 * UNIT * 0.138, mid=200 * UNIT * 0.138, high=300 * UNIT * 0.173
    )
    assert [(year["school_year"], year["events"]) for year in details["years"]] == [(111, 1), (112, 1), (113, 1)]
    assert [year["weighted"] for year in details["years"]] == [round(value * UNIT, 1) for value in (100, 300, 200)]
    assert details["skipped"] == {"no_capacity": 0, "outside_windows": 0}
    assert details["price_unknown"] == 0
    assert [(item["school_year"], item["approved_capacity"]) for item in details["events"]] == [(111, 100), (112, 300), (113, 200)]


def test_closures_range_numbers_match_the_brief_ratio():
    # brief 的 10／30／20：把核定換成使加權值剛好 10、30、20（承接率取 1 前）的席數。
    events = [event(date(2022, 11, 15), 10 / UNIT), event(date(2024, 3, 1), 30 / UNIT), event(date(2025, 5, 1), 20 / UNIT)]
    result, _ = closures_range(events, today=TODAY)
    assert (result.low, result.mid, result.high) == (1.4, 2.8, 5.2)  # 10×0.138、20×0.138、30×0.173


def test_closures_range_sums_events_in_the_same_window_and_counts_empty_windows():
    events = [event(date(2022, 10, 1), 100), event(date(2023, 9, 30), 100)]  # 都在 111 學年（兩端日期都含）
    result, details = closures_range(events, today=TODAY)
    assert [(year["school_year"], year["events"]) for year in details["years"]] == [(111, 2), (112, 0), (113, 0)]
    assert details["years"][0]["weighted"] == round(200 * UNIT, 1)
    assert result.low == 0  # 空窗口算 0，不是略過
    assert result.mid == round(200 * UNIT / 3 * 0.138, 1)
    assert result.high == round(200 * UNIT * 0.173, 1)


def test_closures_range_ignores_the_window_in_progress_and_events_before_it_starts():
    events = three_windows() + [
        event(date(2025, 10, 1), 9999),  # 114 學年，進行中
        event(date(2022, 9, 30), 9999),  # 110 學年，在 2022-10 之前
    ]
    result, details = closures_range(events, today=TODAY)
    assert result == closures_range(three_windows(), today=TODAY)[0]
    assert details["skipped"]["outside_windows"] == 2
    assert len(details["events"]) == 3


def test_a_window_is_complete_only_after_its_last_day():
    events = three_windows()
    _, on_last_day = closures_range(events, today=date(2025, 9, 30))
    assert [year["school_year"] for year in on_last_day["years"]] == [111, 112]
    _, next_day = closures_range(events, today=date(2025, 10, 1))
    assert [year["school_year"] for year in next_day["years"]] == [111, 112, 113]


def test_no_full_window():
    # 資料只回補到 2025、或今天還在第一個窗口裡：沒有完整窗口就不給數字，不是 0
    for today in (date(2022, 10, 1), date(2023, 9, 30)):
        result, details = closures_range(three_windows(), today=today)
        assert result is None
        assert details["years"] == []
        assert details["skipped"]["outside_windows"] == len(three_windows())


def test_no_events_but_complete_windows_is_zero():
    # 有完整窗口、窗口內沒有停辦：數字就是 0（資料齊的前提下附近沒人退場），不是 no_data
    result, details = closures_range([], today=TODAY)
    assert result == Range(0, 0, 0)
    assert (details["events"], details["skipped"], details["price_unknown"]) == (
        [], {"no_capacity": 0, "outside_windows": 0}, 0
    )
    assert [(year["school_year"], year["weighted"], year["events"]) for year in details["years"]] == [
        (111, 0, 0), (112, 0, 0), (113, 0, 0)
    ]


def test_no_complete_window_is_none_even_without_events():
    assert closures_range([], today=date(2023, 9, 30))[0] is None
    assert closures_range([], today=date(2022, 10, 1))[1]["years"] == []


@pytest.mark.parametrize(
    ("today", "first_year", "start"),
    [
        (date(2026, 10, 20), 111, date(2022, 10, 1)),  # 保留期最舊的一天是 2020-10-20，早於 2022-10 回補檔的起點
        (date(2028, 10, 1), 111, date(2022, 10, 1)),  # 保留期最舊 2022-10-01，111 窗口剛好完整
        (date(2028, 10, 2), 112, date(2023, 10, 1)),  # 最舊 2022-10-02：111 窗口缺了第一天，不算
        (date(2029, 9, 30), 112, date(2023, 10, 1)),
        (date(2029, 10, 1), 112, date(2023, 10, 1)),
        (date(2029, 10, 2), 113, date(2024, 10, 1)),
    ],
)
def test_first_window_follows_the_retention_period(today, first_year, start):
    assert first_window_start(today) == start
    _, details = closures_range([event(date(2022, 11, 15), 100)], today=today)
    assert details["years"][0]["school_year"] == first_year
    assert details["years"][-1]["school_year"] == school_year_window(today) - 1


@pytest.mark.parametrize(
    ("today", "since_text"),
    [
        (date(2026, 10, 20), "2022 年 10 月"),
        (date(2028, 10, 1), "2022 年 10 月"),
        (date(2028, 10, 2), "2023 年 10 月"),  # 保留期把 2022-10 的窗口切掉一角，第一個完整窗口往後一年
        (date(2029, 10, 2), "2024 年 10 月"),
    ],
)
def test_how_to_read_it_names_the_first_window_not_a_fixed_date(today, since_text):
    """「怎麼看這個數字」的起點跟著 first_window_start 走，不寫死 2022 年 10 月（保留期 72 個月，起點會往後移）。"""
    rows = {item["label"]: item["value"] for item in potential._closure_assumptions(today, None)}

    assert rows["怎麼看這個數字"] == f"{since_text}以來各學年的平均，不是預測下一所會停辦"
    assert f"{first_window_start(today).year} 年 {first_window_start(today).month} 月" == since_text


def test_events_before_the_first_window_are_outside_windows():
    # 2029-10-01：保留期只剩 2023-10-01 起，111 學年的事件（理論上已被清掉）不能再當完整的一年算
    today = date(2029, 10, 1)
    result, details = closures_range([event(date(2022, 11, 15), 9999), event(date(2024, 3, 1), 100)], today=today)
    assert 111 not in [year["school_year"] for year in details["years"]]
    assert details["skipped"]["outside_windows"] == 1
    assert [item["school_year"] for item in details["events"]] == [112]
    assert result.high == round(100 * UNIT * 0.173, 1)


def test_closure_without_capacity_skipped():
    events = three_windows() + [event(date(2023, 2, 1), None, name="沒核定"), event(date(2023, 3, 1), 0, name="核定零")]
    result, details = closures_range(events, today=TODAY)
    assert result == closures_range(three_windows(), today=TODAY)[0]  # 不影響數字，也不丟例外
    assert details["skipped"]["no_capacity"] == 2
    assert {item["name"] for item in details["events"]} == {"測試幼兒園"}  # 沒核定的不進事件清單
    assert details["years"][0]["events"] == 1  # 事件數也只數算進去的


def test_price_unknown_is_counted_but_still_weighted_as_one():
    events = [
        event(date(2022, 11, 15), 100, their=None, name="沒收費"),
        event(date(2024, 3, 1), 100, own=None, name="本校沒收費"),
        event(date(2025, 5, 1), 100, kind="public", their=None, name="公幼沒收費"),  # 公共化直接 0.1，不算「不知道價格」
        event(date(2025, 6, 1), 100, name="有收費"),
    ]
    _, details = closures_range(events, today=TODAY)
    assert details["price_unknown"] == 2
    weighted = {item["name"]: item["weighted"] for item in details["events"]}
    assert weighted["沒收費"] == weighted["有收費"] == round(100 * UNIT, 1)
    assert weighted["公幼沒收費"] == round(100 * UNIT * 0.1, 1)


def test_event_details_carry_what_the_screen_lists():
    _, details = closures_range([event(date(2023, 2, 1), 136, distance=607.4, name="愛爾蘭")], today=TODAY)
    assert details["events"] == [
        {
            "occurred_on": date(2023, 2, 1), "name": "愛爾蘭", "approved_capacity": 136, "distance_m": 607,
            "school_year": 111, "weighted": round(136 * UNIT, 1),
        }
    ]


# ---- load_closure_events（DB）----

SINCE = date(2022, 10, 1)
NOW = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)
LOAD_TODAY = date(2026, 10, 20)


def closed(source_id: str, on: date, *, provider: str = "kindergarten", change: str = "closed") -> GeoProviderEvent:
    return GeoProviderEvent(provider=provider, source_id=source_id, change=change, occurred_on=on)


@pytest.fixture
def campuses(monkeypatch):
    """義華在 YIHUA_POINT；明華放在正北 2 km（只有座標，不必發布校址）。其他三校沒有座標。"""
    lat, lng = YIHUA_POINT

    async def points(db):
        return {
            "yihua": matcher.CampusPoint("yihua", lat, lng, None),
            "minghua": matcher.CampusPoint("minghua", lat + 2000 / 111_320.0, lng, None),
            "chongde": matcher.CampusPoint("chongde", None, None, "no_address"),
        }

    monkeypatch.setattr(matcher, "campus_points", points)


async def test_load_closure_events_reads_closures_in_the_window_with_both_fees(db_session, campuses):
    add_kindergarten(db_session, "own", "高雄市私立常春藤幼兒園", "private", 0, approved_capacity=210)
    add_kindergarten(db_session, "gone", "高雄市私立甲幼兒園", "private", 607, approved_capacity=136, is_active=False)
    add_kindergarten(db_session, "pub", "高雄市立乙幼兒園", "public", 1200, approved_capacity=60, is_active=False)
    add_kindergarten(db_session, "nofee", "高雄市私立丙幼兒園", "private", -3000, approved_capacity=None, is_active=False)
    await db_session.flush()
    add_fee(db_session, "own", 3, 89_750)
    add_fee(db_session, "own", 2, 105_950)
    add_fee(db_session, "gone", 3, 80_000)
    add_fee(db_session, "gone", 2, 1)  # 只取 3 歲
    add_fee(db_session, "pub", 3, 17_965)
    db_session.add_all([closed("gone", date(2025, 7, 31)), closed("pub", date(2023, 2, 1)), closed("nofee", date(2024, 8, 1))])
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert [(item.name, item.occurred_on) for item in events] == [
        ("高雄市立乙幼兒園", date(2023, 2, 1)),
        ("高雄市私立丙幼兒園", date(2024, 8, 1)),
        ("高雄市私立甲幼兒園", date(2025, 7, 31)),
    ]
    pub, nofee, gone = events
    assert (gone.kind, gone.approved_capacity, gone.own_fee, gone.their_fee) == ("private", 136, 89_750, 80_000)
    assert gone.distance_m == pytest.approx(607, abs=2)
    assert (pub.kind, pub.approved_capacity, pub.their_fee) == ("public", 60, 17_965)
    assert (nofee.approved_capacity, nofee.their_fee, nofee.own_fee) == (None, None, 89_750)  # 沒核定的照樣載入，算的時候略過
    assert nofee.distance_m == pytest.approx(3000, abs=5)


async def test_load_closure_events_filters_by_date_kind_of_event_and_distance(db_session, campuses):
    for source_id, north in (("a", 500), ("b", 500), ("c", 500), ("d", 500), ("e", 500), ("near8", 7900), ("far8", 8100)):
        add_kindergarten(db_session, source_id, f"園{source_id}", "private", north, is_active=False)
    db_session.add_all(
        [
            closed("a", date(2022, 9, 30)),  # 比 since 早
            closed("b", date(2026, 10, 21)),  # 在今天之後
            closed("c", date(2024, 1, 1), change="opened"),  # 不是停辦
            closed("d", date(2024, 1, 1), provider="babycare"),  # 托嬰的事件，source_id 碰巧一樣也不算
            closed("e", SINCE),  # 剛好在 since 當天，算
            closed("near8", date(2024, 5, 1)),
            closed("far8", date(2024, 5, 1)),  # 8.1 km，超出
        ]
    )
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert [item.name for item in events] == ["園e", "園near8"]


async def test_own_campus_excluded(db_session, campuses):
    add_kindergarten(db_session, "old-own", "舊本校址", "private", 30, is_active=False)  # 義華 30 m：本機構
    add_kindergarten(db_session, "old-minghua", "舊明華址", "private", 2040, is_active=False)  # 明華 40 m：本機構
    add_kindergarten(db_session, "edge", "邊界外", "private", 2060, is_active=False)  # 明華 60 m：不是
    add_kindergarten(db_session, "other", "別人家", "private", 800, is_active=False)
    db_session.add_all([closed(source_id, date(2024, 1, 1)) for source_id in ("old-own", "old-minghua", "edge", "other")])
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert sorted(item.name for item in events) == ["別人家", "邊界外"]
    assert area.OWN_CAMPUS_RADIUS_M == 50


async def test_own_campus_excluded_even_when_the_campus_is_not_located(db_session, monkeypatch):
    """五校校址都查不到座標時，傳進來的校址座標本身仍要排除（50 m 內）。"""

    async def nothing(db):
        return {"yihua": matcher.CampusPoint("yihua", None, None, "no_doorplate")}

    monkeypatch.setattr(matcher, "campus_points", nothing)
    add_kindergarten(db_session, "old-own", "舊本校址", "private", 30, is_active=False)
    add_kindergarten(db_session, "other", "別人家", "private", 800, is_active=False)
    db_session.add_all([closed("old-own", date(2024, 1, 1)), closed("other", date(2024, 1, 1))])
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert [item.name for item in events] == ["別人家"]


async def test_load_closure_events_without_an_own_school_has_no_own_fee(db_session, campuses):
    add_kindergarten(db_session, "gone", "甲", "private", 600, is_active=False)
    db_session.add(closed("gone", date(2024, 1, 1)))
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert [(item.own_fee, item.their_fee) for item in events] == [(None, None)]


async def test_the_same_school_closed_twice_counts_once_with_the_latest_date(db_session, campuses):
    add_kindergarten(db_session, "twice", "停了兩次", "private", 600, is_active=False)
    add_kindergarten(db_session, "once", "只停一次", "private", 700, is_active=False)
    db_session.add_all(
        [
            closed("twice", date(2023, 2, 1)),
            closed("twice", date(2025, 7, 31)),
            closed("once", date(2024, 1, 1)),
        ]
    )
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert [(item.name, item.occurred_on) for item in events] == [
        ("只停一次", date(2024, 1, 1)),
        ("停了兩次", date(2025, 7, 31)),
    ]


async def test_the_latest_closure_is_taken_within_the_requested_period(db_session, campuses):
    """較新的那筆在 today 之後或較舊的在 since 之前，各自被期間濾掉，不會讓同一所變成零筆或兩筆。"""
    add_kindergarten(db_session, "late", "之後又停", "private", 600, is_active=False)
    add_kindergarten(db_session, "early", "之前就停", "private", 700, is_active=False)
    db_session.add_all(
        [
            closed("late", date(2024, 5, 1)),
            closed("late", date(2026, 11, 1)),  # 在 LOAD_TODAY 之後
            closed("early", date(2022, 9, 1)),  # 在 SINCE 之前
            closed("early", date(2023, 5, 1)),
        ]
    )
    await db_session.commit()

    events = await load_closure_events(db_session, *YIHUA_POINT, since=SINCE, today=LOAD_TODAY)

    assert [(item.name, item.occurred_on) for item in events] == [
        ("之前就停", date(2023, 5, 1)),
        ("之後又停", date(2024, 5, 1)),
    ]


# ---- 來源二：現有的里還沒招到 ----

REPORT_A, REPORT_B = -2.6, -1.07


def synthetic_obs(*, villages: int = 60, wobble: tuple[float, ...] = (1.0,)) -> list[VillageObs]:
    """100 m 起每 100 m 一個里，2–5 歲 2000–2900 位；在籍是 a＝-2.6、b＝-1.07 的期望值乘上 wobble（輪流）後取整。"""
    obs = []
    for index in range(villages):
        distance = 100 + index * 100
        kids = 2000 + (index * 37) % 900
        expected = kids * math.exp(REPORT_A + REPORT_B * distance / 1000) * wobble[index % len(wobble)]
        obs.append(VillageObs(f"640{index:08d}", distance, kids, round(expected)))
    return obs


def test_fit_recovers_parameters():
    fitted = fit_distance_model(synthetic_obs())

    assert fitted is not None
    a, b = fitted
    assert a == pytest.approx(REPORT_A, abs=0.05)
    assert b == pytest.approx(REPORT_B, abs=0.05)


def test_fit_ignores_villages_without_children():
    obs = synthetic_obs() + [VillageObs("640ghost0001", 400, 0, 50), VillageObs("640ghost0002", 4000, 0, 0)]

    assert fit_distance_model(obs) == fit_distance_model(synthetic_obs())


def test_gap_shrinks_small_villages():
    a, b = math.log(0.02), 0.0  # 每 100 位孩子期望 2 位在籍，與距離無關
    small = village_gaps([VillageObs("s", 500, 100, 0)], a, b)
    large = village_gaps([VillageObs("l", 500, 10_000, 0)], a, b)  # 期望 200 位

    assert 0 < small < 2
    assert small == pytest.approx(2 * 2 / (2 + 5.1))  # μ·(μ − y) ÷ (μ + 收縮參數)
    assert large == pytest.approx(200 * 200 / (200 + 5.1))
    assert large > 190  # 大里幾乎不被收縮


def test_gap_counts_shortfalls_inside_the_radius_only():
    a, b = math.log(0.02), 0.0
    short = VillageObs("a", 500, 100, 0)
    over = VillageObs("b", 600, 100, 9)  # 招得比期望多：缺口 0，也不抵銷別的里
    edge = VillageObs("c", 3000, 100, 0)  # 剛好 3 km 算半徑內
    outside = VillageObs("d", 3001, 100, 0)

    assert village_gaps([over], a, b) == 0
    assert village_gaps([short, over], a, b) == village_gaps([short], a, b)
    assert village_gaps([edge], a, b) > 0
    assert village_gaps([outside], a, b) == 0
    assert village_gaps([outside], a, b, radius_m=4000) > 0
    assert village_gaps([short], a, b, shrink=0) == pytest.approx(2)  # 不收縮就是期望減實際


def test_villages_range_deterministic():
    obs = synthetic_obs(wobble=(0.5, 1.5, 1.0))
    first, details = villages_range(obs)
    second, details_again = villages_range(obs)

    assert first is not None
    assert first == second and details == details_again
    assert first.low <= first.mid <= first.high
    assert first.high > first.low
    assert villages_range(list(reversed(obs)))[0] == first  # 資料列順序不影響
    assert villages_range(obs, seed=1)[0] != first  # 種子真的有用到


def test_villages_range_mid_is_the_observed_gap_over_three_years():
    obs = synthetic_obs(wobble=(0.5, 1.5, 1.0))
    result, _ = villages_range(obs)

    a, b = fit_distance_model(obs)
    assert result.mid == pytest.approx(village_gaps(obs, a, b) / 3, abs=0.05)


@pytest.mark.parametrize(
    "obs",
    [
        synthetic_obs(wobble=(0.5, 1.5, 1.0)),  # 各里高低不一
        synthetic_obs(),  # 在籍剛好等於期望值
        [VillageObs(f"640{index:08d}", 100 + index * 100, 2000, 0 if index < 30 else 40) for index in range(60)],  # 近處沒招、遠處招得多
    ],
    ids=["uneven", "exact", "near-empty"],
)
def test_villages_range_straddles_the_observed_gap(obs):
    """重抽里的區間以實際缺口為中心往兩邊散開（不是只量雜訊的缺口），所以低、高不必靠 clamp 也包住中值。"""
    result, _ = villages_range(obs)

    assert result is not None
    assert result.low < result.mid < result.high


def test_villages_range_resamples_villages_and_scores_the_original_ones(monkeypatch):
    """每次抽樣：從有孩子的里有放回地抽出同樣數量的里重新擬合（在籍數原封不動），再用新的 (a, b) 對原本的里算缺口。"""
    obs = sorted(synthetic_obs(wobble=(0.5, 1.5, 1.0)) + [VillageObs("640ghost0001", 400, 0, 3)], key=lambda item: item.code)
    pool = [item for item in obs if item.kids > 0]
    fit_inputs: list[list[VillageObs]] = []
    gap_inputs: list[list[VillageObs]] = []
    real_fit, real_gaps = potential.fit_distance_model, potential.village_gaps

    def spy_fit(sample):
        fit_inputs.append(list(sample))
        return real_fit(sample)

    def spy_gaps(sample, *args, **kwargs):
        gap_inputs.append(list(sample))
        return real_gaps(sample, *args, **kwargs)

    monkeypatch.setattr(potential, "fit_distance_model", spy_fit)
    monkeypatch.setattr(potential, "village_gaps", spy_gaps)

    result, _ = villages_range(obs, draws=60)

    assert result is not None
    first, *drawn = fit_inputs
    assert first == obs  # 第一次擬合是實際資料
    assert len(drawn) == 60
    assert all(len(sample) == len(pool) and all(item in pool for item in sample) for sample in drawn)
    assert any(len({item.code for item in sample}) < len(pool) for sample in drawn)  # 有放回：會抽到重複的里
    whole = [sample for sample in gap_inputs if len(sample) > 1]  # 逐帶彙總每次只傳一個里
    assert whole and all(sample == obs for sample in whole)  # 缺口一律對原本的里算
    assert len(whole) == 1 + 60


def test_villages_range_keeps_the_range_around_the_point_estimate(monkeypatch):
    """抽樣的百分位若沒包住中值，低／高向中值靠攏：區間永遠包住中值。"""
    obs = synthetic_obs(wobble=(0.5, 1.5, 1.0))
    mid, _ = villages_range(obs)

    monkeypatch.setattr(potential, "_percentile", lambda ordered, percent: 1000.0 if percent == 10 else 2000.0)
    above, _ = villages_range(obs)
    monkeypatch.setattr(potential, "_percentile", lambda ordered, percent: 0.0 if percent == 10 else 0.5)
    below, _ = villages_range(obs)

    assert (above.low, above.mid, above.high) == (mid.mid, mid.mid, 2000.0)
    assert (below.low, below.mid, below.high) == (0.0, mid.mid, mid.mid)


def test_villages_range_needs_enough_successful_draws():
    result, details = villages_range(synthetic_obs(), draws=10)

    assert result is None
    assert details["model"] is not None  # 模型本身有估出來，只是區間抽樣的次數不夠


def test_villages_range_survives_a_refit_that_overflows(monkeypatch):
    """重抽的里沒抽到某些距離時，重新擬合的斜率可能離譜，套回沒被抽到的里 exp 會溢位：這次抽樣當失敗略過，不丟例外。
    這組只有 8 個里，低於資料量門檻，所以把門檻調低才走得到自助法。"""
    monkeypatch.setattr(potential, "MIN_FIT_VILLAGES", 1)
    monkeypatch.setattr(potential, "MIN_FIT_ENROLLED", 1)
    overflows: list[bool] = []
    real_gaps = potential.village_gaps

    def counting(*args, **kwargs):
        try:
            return real_gaps(*args, **kwargs)
        except OverflowError:
            overflows.append(True)
            raise

    monkeypatch.setattr(potential, "village_gaps", counting)
    obs = [
        VillageObs("c0", 3122.6, 5000, 40), VillageObs("c1", 1911.3, 5000, 1), VillageObs("c2", 3460.4, 500, 40),
        VillageObs("c3", 3857.1, 0, 300), VillageObs("c4", 4886.4, 0, 2), VillageObs("c5", 3903.7, 5000, 0),
        VillageObs("c6", 3109.3, 5, 300), VillageObs("c7", 381.3, 1, 40),
    ]

    result, details = villages_range(obs, draws=60)

    assert overflows  # 這組資料真的會讓重抽的缺口溢位
    assert result is None or result.low <= result.mid <= result.high
    assert set(details) == {"bands", "model"}


@pytest.mark.parametrize("failure", [OverflowError("math range error"), math.nan, math.inf])
def test_villages_range_without_a_usable_point_estimate_is_none(monkeypatch, failure):
    """實際資料的缺口算不出來（溢位或不是有限數）：來源二 None，不丟例外。"""

    def broken(*args, **kwargs):
        if isinstance(failure, Exception):
            raise failure
        return failure

    monkeypatch.setattr(potential, "village_gaps", broken)

    assert villages_range(synthetic_obs()) == (None, {"bands": [], "model": None})


@pytest.mark.parametrize("failure", [OverflowError("math range error"), math.nan, math.inf])
def test_villages_range_skips_draws_whose_gap_is_unusable(monkeypatch, failure):
    """某次抽樣的缺口溢位或不是有限數就略過；全部略過（成功 < 50 次）就沒有區間，但 details 仍在。"""
    obs = synthetic_obs(wobble=(0.5, 1.5, 1.0))
    a, b = fit_distance_model(obs)
    real = potential.village_gaps

    def broken_for_refits(sample, a_, b_, **kwargs):
        if (a_, b_) == (a, b):
            return real(sample, a_, b_, **kwargs)
        if isinstance(failure, Exception):
            raise failure
        return failure

    monkeypatch.setattr(potential, "village_gaps", broken_for_refits)

    result, details = villages_range(obs)

    assert result is None
    assert details["model"] is not None and len(details["bands"]) == 3


def test_details_have_no_village_codes():
    obs = synthetic_obs(wobble=(0.5, 1.5, 1.0))
    _, details = villages_range(obs)

    text = json.dumps(details, ensure_ascii=False, default=str)
    assert not any(item.code in text for item in obs)
    assert set(details) == {"bands", "model"}
    assert all(set(band) == {"band", "villages", "kids", "enrolled", "expected", "gap"} for band in details["bands"])


def test_details_bands_are_aggregates_of_the_villages_in_range():
    obs = synthetic_obs(villages=40, wobble=(0.5, 1.5, 1.0))
    result, details = villages_range(obs)

    bands = details["bands"]
    assert [band["band"] for band in bands] == ["0-1", "1-2", "2-3"]  # 和 band_shares 同鍵
    # 100 m 一個里；帶界含上界：1000 m 在第一帶、3000 m 在最後一帶、3100 m 起不在任何一帶
    assert [band["villages"] for band in bands] == [10, 10, 10]
    inside = [item for item in obs if item.distance_m <= 3000]
    assert sum(band["kids"] for band in bands) == sum(item.kids for item in inside)
    assert sum(band["enrolled"] for band in bands) == sum(item.enrolled for item in inside)
    a, b = fit_distance_model(obs)
    assert details["model"] == {"a": pytest.approx(a, abs=0.001), "b": pytest.approx(b, abs=0.001)}
    assert sum(band["gap"] for band in bands) == pytest.approx(result.mid * 3, abs=0.5)  # 各帶缺口加起來就是總缺口
    assert all(band["expected"] >= 0 and band["gap"] >= 0 for band in bands)


HIDDEN = {"enrolled": None, "expected": None, "gap": None}


def test_details_hide_every_band_when_one_band_has_fewer_than_three_villages():
    """一帶只有 1–2 個里，在籍、期望、缺口就等於逐里數字；只藏那一帶，總和減其他帶還是推得回來，所以三帶都只回里數與孩子數。"""
    everything = synthetic_obs(villages=40, wobble=(0.5, 1.5, 1.0))
    outer = [item for item in everything if item.distance_m > 1000]  # 1–2、2–3 km 各 10 個里
    two = [item for item in everything if item.distance_m <= 200]  # 0–1 km 只有 2 個里
    three = [item for item in everything if item.distance_m <= 300]  # 剛好 3 個
    thin_middle = [item for item in everything if item.distance_m <= 1000 or item.distance_m in (1100, 1200) or item.distance_m > 2000]

    _, hidden = villages_range(outer + two)
    _, shown = villages_range(outer + three)
    _, middle_hidden = villages_range(thin_middle)

    assert [band["villages"] for band in hidden["bands"]] == [2, 10, 10]
    for band in hidden["bands"]:
        assert {key: band[key] for key in HIDDEN} == HIDDEN
        assert band["kids"] > 0
    assert hidden["bands"][0]["kids"] == sum(item.kids for item in two)
    assert [band["villages"] for band in middle_hidden["bands"]] == [10, 2, 10]  # 中間那帶薄，另外兩帶也藏
    assert all({key: band[key] for key in HIDDEN} == HIDDEN for band in middle_hidden["bands"])
    assert [band["villages"] for band in shown["bands"]] == [3, 10, 10]
    assert all(band[key] is not None for band in shown["bands"] for key in HIDDEN)


def test_details_hide_every_band_when_a_band_has_no_village():
    everything = synthetic_obs(villages=40, wobble=(0.5, 1.5, 1.0))

    _, details = villages_range([item for item in everything if item.distance_m > 1000])

    assert details["bands"][0] == {"band": "0-1", "villages": 0, "kids": 0, **HIDDEN}
    assert all({key: band[key] for key in HIDDEN} == HIDDEN for band in details["bands"])


def test_details_count_only_villages_with_children_toward_the_minimum():
    """沒有 2–5 歲孩子的里不算一個里：一帶有 3 個里但只有 2 個有孩子，仍然藏；多出沒孩子的里也不能讓它過關。"""
    everything = synthetic_obs(villages=40, wobble=(0.5, 1.5, 1.0))
    outer = [item for item in everything if item.distance_m > 1000]
    near = [item for item in everything if item.distance_m <= 300]
    childless = replace(near[2], kids=0, enrolled=0)
    extra_childless = [VillageObs("640extra0001", 150, 0, 0), VillageObs("640extra0002", 250, 0, 0)]

    _, hidden = villages_range(outer + near[:2] + [childless])
    _, shown = villages_range(outer + near + extra_childless)

    assert [band["villages"] for band in hidden["bands"]] == [3, 10, 10]  # 里數照列，但只有 2 個有孩子
    assert all({key: band[key] for key in HIDDEN} == HIDDEN for band in hidden["bands"])
    assert [band["villages"] for band in shown["bands"]] == [5, 10, 10]  # 3 個有孩子的里就夠
    assert all(band[key] is not None for band in shown["bands"] for key in HIDDEN)


def test_model_degenerate():
    kids = 500
    nobody_enrolled = [VillageObs(f"v{i}", 500 + i * 700, kids, 0) for i in range(8)]
    same_distance = [VillageObs(f"v{i}", 1000, kids, 5 + i) for i in range(8)]
    no_children = [VillageObs(f"v{i}", 500 + i * 700, 0, 3) for i in range(8)]
    runs_away = [VillageObs("near", 1000, kids, 5), VillageObs("far", 2000, kids, 0)]  # 估計值要跑到無限遠才擬合得上
    single = [VillageObs("only", 1000, kids, 5)]

    for obs in (nobody_enrolled, same_distance, no_children, runs_away, single, []):
        assert fit_distance_model(obs) is None
        result, details = villages_range(obs)  # 不丟例外
        assert result is None
        assert details == {"bands": [], "model": None}


def test_villages_range_with_enough_data_but_no_model_is_none():
    """資料量過了門檻、模型卻擬合不出來（全在同一個距離、在籍全擠在最近的一個里）：一樣是 None，不丟例外。"""
    same_distance = [VillageObs(f"v{i:02d}", 1000, 500, 3) for i in range(25)]
    all_in_one_village = [VillageObs("v00", 100, 500, 60)] + [VillageObs(f"v{i:02d}", 100 + i * 100, 500, 0) for i in range(1, 25)]

    for obs in (same_distance, all_in_one_village):
        assert len(obs) >= potential.MIN_FIT_VILLAGES and sum(item.enrolled for item in obs) >= potential.MIN_FIT_ENROLLED
        assert fit_distance_model(obs) is None
        assert villages_range(obs) == (None, {"bands": [], "model": None})


def test_villages_range_needs_enough_villages_with_children():
    """有 2–5 歲孩子的里不到 20 個就不估（資料太少，重抽里的區間是外插）；沒有孩子的里不能湊數。"""
    assert potential.MIN_FIT_VILLAGES == 20
    enough = synthetic_obs(villages=20)
    childless = [VillageObs(f"640x{i:07d}", 150 + i * 100, 0, 0) for i in range(10)]

    assert villages_range(enough)[1]["model"] is not None
    assert villages_range(enough[:19]) == (None, {"bands": [], "model": None})
    assert villages_range(enough[:19] + childless) == (None, {"bands": [], "model": None})


def test_villages_range_needs_enough_enrolled_students():
    """在籍總和不到 30 位就不估；剛好 30 位可以。"""
    assert potential.MIN_FIT_ENROLLED == 30

    def with_total(total: int) -> list[VillageObs]:
        """40 個里、各 1000 位孩子；在籍從最近的里開始每個里 2 位，餘數放下一個里。"""
        left, obs = total, []
        for index in range(40):
            count = min(2, left)
            left -= count
            obs.append(VillageObs(f"640{index:08d}", 100 + index * 75, 1000, count))
        return obs

    assert villages_range(with_total(29)) == (None, {"bands": [], "model": None})
    result, details = villages_range(with_total(30))
    assert details["model"] is not None  # 過了門檻就會估（區間是否出得來看抽樣，這裡只看有沒有被門檻擋下）


def test_band_shares():
    obs = [
        VillageObs("a", 0, 100, 4),
        VillageObs("b", 1000, 100, 2),  # 含 1 km：仍在 0–1
        VillageObs("c", 1001, 200, 4),
        VillageObs("d", 2500, 400, 2),
        VillageObs("e", 3000, 100, 3),  # 含 3 km
        VillageObs("f", 3001, 100, 50),  # 3 km 外不算
    ]

    shares = band_shares(obs)

    assert list(shares) == ["0-1", "1-2", "2-3"]
    assert shares["0-1"] == pytest.approx(6 / 200)
    assert shares["1-2"] == pytest.approx(4 / 200)
    assert shares["2-3"] == pytest.approx(5 / 500)


def test_band_shares_without_children_in_a_band_is_zero():
    shares = band_shares([VillageObs("a", 500, 100, 4), VillageObs("b", 2500, 0, 2)])

    assert shares == {"0-1": pytest.approx(0.04), "1-2": 0.0, "2-3": 0.0}
    assert band_shares([]) == {"0-1": 0.0, "1-2": 0.0, "2-3": 0.0}


# ---- 來源二：載入 ----

POPULATION_NOW = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)
# (區, 里) → (2、3、4、5 歲每一歲人數)；本揚里 287 m、寶業里 329 m、本武里 1530 m、新上里 4065 m、青島里 7864 m
VILLAGE_KIDS = {
    ("三民區", "本揚里"): 100,
    ("三民區", "寶業里"): 50,
    ("三民區", "本武里"): 40,
    ("左營區", "新上里"): 20,
    ("小港區", "青島里"): 200,
}


async def add_population(db, rows=VILLAGE_KIDS) -> None:
    for (district, village), per_age in rows.items():
        db.add(
            GeoVillagePopulation(
                village_code=boundaries.village_code(district, village), district=district, village=village,
                age_0=7, age_1=8, age_2=per_age, age_3=per_age + 1, age_4=per_age + 2, age_5=per_age + 3, age_6=9,
                people_total=per_age * 30,
            )
        )
    await db.flush()


async def import_roster(db, students: list[dict]) -> None:
    await replace_roster(db, load_payload(payload_text(points_payload(students))))
    await db.commit()


async def test_load_village_obs_without_a_roster_is_none(db_session):
    await add_population(db_session)
    await db_session.commit()

    assert await load_village_obs(db_session, "yihua", *YIHUA_POINT) is None


async def test_load_village_obs_counts_enrolled_per_village_within_the_radius(db_session):
    await add_population(db_session)
    await import_roster(
        db_session,
        [
            student(),  # 本揚里 exact
            student(village="本揚里", match_level="nearby"),
            student(village="寶業里", match_level="street", lat=None, lng=None),  # street 只到里：算
            student(district="左營區", village="新上里", lat=22.700, lng=120.300),
            student(district="三民區", village=None, match_level="district", lat=None, lng=None),  # 只到區：不算
            student(match_level="unlocated", unlocated_reason="no_address", district=None, village=None, lat=None, lng=None),
            student(district="三民區", village="不存在里"),  # 里界檔對不到：不算
            student(district="小港區", village="青島里", lat=22.55, lng=120.35),  # 7.9 km：半徑外
        ],
    )

    obs = await load_village_obs(db_session, "yihua", *YIHUA_POINT)

    assert obs is not None
    by_code = {item.code: item for item in obs}
    code = boundaries.village_code
    # 2–5 歲孩子數是 age_2..age_5 加總（age_0、age_1、age_6 不算）；沒有在籍的里照樣列出，在籍 0
    assert set(by_code) == {code("三民區", "本揚里"), code("三民區", "寶業里"), code("三民區", "本武里"), code("左營區", "新上里")}
    assert (by_code[code("三民區", "本揚里")].kids, by_code[code("三民區", "本揚里")].enrolled) == (4 * 100 + 6, 2)
    assert (by_code[code("三民區", "寶業里")].kids, by_code[code("三民區", "寶業里")].enrolled) == (4 * 50 + 6, 1)
    assert (by_code[code("三民區", "本武里")].kids, by_code[code("三民區", "本武里")].enrolled) == (4 * 40 + 6, 0)
    assert (by_code[code("左營區", "新上里")].kids, by_code[code("左營區", "新上里")].enrolled) == (4 * 20 + 6, 1)
    assert by_code[code("三民區", "本揚里")].distance_m == pytest.approx(287, abs=3)
    assert by_code[code("三民區", "本武里")].distance_m == pytest.approx(1530, abs=3)
    assert by_code[code("左營區", "新上里")].distance_m == pytest.approx(4065, abs=3)


async def test_load_village_obs_radius_is_adjustable_and_other_campuses_are_ignored(db_session):
    await add_population(db_session)
    await import_roster(db_session, [student()])

    near = await load_village_obs(db_session, "yihua", *YIHUA_POINT, radius_m=1000)
    assert near is not None
    assert {item.distance_m < 1000 for item in near} == {True} and len(near) == 2
    assert await load_village_obs(db_session, "minghua", *YIHUA_POINT) is None  # 明華沒有清冊


async def test_load_village_obs_feeds_the_model(db_session):
    """端到端：一份只有近處有人的清冊，載入後可以直接擬合；缺口與距離帶都算得出來。"""
    await add_population(db_session)
    await import_roster(
        db_session, [student() for _ in range(30)] + [student(village="寶業里") for _ in range(15)]
        + [student(village="本武里", lat=22.650, lng=120.350) for _ in range(5)]
    )

    obs = await load_village_obs(db_session, "yihua", *YIHUA_POINT)

    assert obs is not None and sum(item.enrolled for item in obs) == 50
    assert fit_distance_model(obs) is not None
    assert band_shares(obs)["0-1"] > band_shares(obs)["1-2"]


# ---- 來源三：新建案搬進來 ----

# 0-1 km 的占有率照報告 B-03 的量級（義華 0.0373）；1-2、2-3 km 各取一個不同的值，才分得出算到哪一帶。
SHARES = {"0-1": 0.0373, "1-2": 0.02, "2-3": 0.01}
OCTOBER = date(2026, 10, 20)  # 下一個 9/1 是 2027-09-01
DELIVERY_KEYS = {"name", "households", "expected_year", "expected_half", "distance_m", "mid", "overdue"}


def delivery(expected: date, households: int = 100, *, distance: float = 500.0, name: str = "測試建案") -> Delivery:
    return Delivery(name=name, households=households, distance_m=distance, expected=expected)


def test_presale_parameters():
    assert KIDS_PER_100_HOUSEHOLDS == (2.5, 4.0, 6.0)  # 低、中、高：每百戶 2–5 歲孩子（報告 B-06）
    assert DELIVERY_RADIUS_M == 3000


@pytest.mark.parametrize(
    ("today", "start"),
    [
        (date(2026, 1, 1), date(2026, 9, 1)),
        (date(2026, 8, 31), date(2026, 9, 1)),
        (date(2026, 9, 1), date(2027, 9, 1)),  # 9/1 當天取明年
        (date(2026, 10, 20), date(2027, 9, 1)),
        (date(2026, 12, 31), date(2027, 9, 1)),
    ],
)
def test_next_school_year_start(today, start):
    assert next_school_year_start(today) == start


def test_only_next_year_deliveries():
    """今天到下一個 8/31 交屋的才算；9/1 起交屋的是再下一年。"""
    deliveries = [
        delivery(date(2027, 8, 31), name="八月底"),
        delivery(date(2027, 9, 1), name="九月初"),
        delivery(date(2028, 3, 1), name="後年"),
    ]

    result, details = presale_range(deliveries, SHARES, today=OCTOBER)

    assert [item["name"] for item in details["deliveries"]] == ["八月底"]
    assert result.mid == round(100 * 0.04 * 0.0373, 1)
    _, on_the_first = presale_range(deliveries, SHARES, today=date(2027, 9, 1))  # 9/1 當天：窗口換成 2028-09-01 以前
    assert [item["name"] for item in on_the_first["deliveries"]] == ["八月底", "九月初", "後年"]


def test_overdue_included():
    """已過預計交屋時間但還沒登記的，很可能就在這一年內交屋，照算。"""
    deliveries = [delivery(date(2025, 1, 1), name="過期很久"), delivery(date(2026, 10, 19), name="昨天")]

    result, details = presale_range(deliveries, SHARES, today=OCTOBER)

    assert [item["name"] for item in details["deliveries"]] == ["過期很久", "昨天"]
    assert result.mid == round(2 * 100 * 0.04 * 0.0373, 1)


def test_presale_math():
    """100 戶、離本校 0.5 km、0–1 km 占有率 0.0373：中 100 × 4.0 / 100 × 0.0373 ≈ 0.15。"""
    result, details = presale_range([delivery(date(2027, 3, 1), 100, distance=500)], SHARES, today=OCTOBER)

    assert details["deliveries"][0]["mid"] == pytest.approx(0.15, abs=0.005)
    assert result == Range(low=0.1, mid=0.1, high=0.2)  # 0.093 / 0.149 / 0.224，Range 四捨五入到 1 位
    big, _ = presale_range([delivery(date(2027, 3, 1), 1000, distance=500)], SHARES, today=OCTOBER)
    assert (big.low, big.mid, big.high) == (0.9, 1.5, 2.2)  # 1000 戶：0.9325 / 1.492 / 2.238


def test_presale_uses_the_share_of_the_band_each_case_is_in():
    deliveries = [
        delivery(date(2027, 3, 1), 1000, distance=1000, name="含 1 km"),  # 0-1
        delivery(date(2027, 3, 1), 1000, distance=1001, name="剛過 1 km"),  # 1-2
        delivery(date(2027, 3, 1), 1000, distance=3000, name="含 3 km"),  # 2-3
        delivery(date(2027, 3, 1), 1000, distance=3001, name="3 km 外"),  # 沒有占有率，不算
    ]

    result, details = presale_range(deliveries, SHARES, today=OCTOBER)

    contributions = {item["name"]: item["mid"] for item in details["deliveries"]}
    assert contributions == {"含 1 km": 1.49, "剛過 1 km": 0.8, "含 3 km": 0.4}
    assert result.mid == round(1000 * 0.04 * (0.0373 + 0.02 + 0.01), 1)


def test_a_band_without_a_share_contributes_zero():
    result, details = presale_range([delivery(date(2027, 3, 1), 500, distance=2500)], {"0-1": 0.05}, today=OCTOBER)

    assert result == Range(0, 0, 0)
    assert details["deliveries"][0]["mid"] == 0.0  # 照樣列出，只是沒有貢獻


def test_no_cases_is_zero():
    assert presale_range([], SHARES, today=OCTOBER) == (Range(0, 0, 0), {"deliveries": []})
    later = [delivery(date(2028, 1, 1)), delivery(date(2027, 9, 1))]
    assert presale_range(later, SHARES, today=OCTOBER) == (Range(0, 0, 0), {"deliveries": []})


def test_presale_details_list_only_what_the_screen_needs():
    deliveries = [
        delivery(date(2027, 7, 1), 80, distance=451, name="乙"),
        delivery(date(2027, 6, 30), 120, distance=449.9, name="甲"),
        delivery(date(2027, 6, 30), 60, distance=1649, name="丙"),
    ]

    _, details = presale_range(deliveries, SHARES, today=OCTOBER)

    assert list(details) == ["deliveries"]
    assert all(set(item) == DELIVERY_KEYS for item in details["deliveries"])
    # 依預計交屋、距離、案名排序；距離取整 100；上半年是 1–6 月、下半年 7–12 月。
    assert [(i["name"], i["households"], i["expected_year"], i["expected_half"], i["distance_m"]) for i in details["deliveries"]] == [
        ("甲", 120, 2027, 1, 400),
        ("丙", 60, 2027, 1, 1600),
        ("乙", 80, 2027, 2, 500),
    ]
    assert all(isinstance(item["distance_m"], int) for item in details["deliveries"])


def test_overdue_flag_marks_cases_expected_before_today():
    deliveries = [
        delivery(date(2026, 10, 19), name="昨天"),
        delivery(date(2026, 10, 20), name="今天"),
        delivery(date(2027, 3, 1), name="明年"),
        delivery(date(2024, 1, 1), name="早就過了"),
    ]

    _, details = presale_range(deliveries, SHARES, today=OCTOBER)

    assert {item["name"]: item["overdue"] for item in details["deliveries"]} == {
        "早就過了": True, "昨天": True, "今天": False, "明年": False,
    }


def test_include_mid_false_blanks_the_per_case_contribution_but_not_the_range():
    deliveries = [
        delivery(date(2027, 3, 1), 300, distance=500, name="近"),
        delivery(date(2026, 6, 1), 120, distance=2500, name="遠"),
    ]
    with_mid, with_details = presale_range(deliveries, SHARES, today=OCTOBER)

    hidden, details = presale_range(deliveries, SHARES, today=OCTOBER, include_mid=False)

    assert hidden == with_mid and hidden.mid > 0  # 數字照算
    assert [item["mid"] for item in with_details["deliveries"]] == [0.05, 0.45]  # 遠（2-3 km）、近（0-1 km）
    assert [item["mid"] for item in details["deliveries"]] == [None, None]
    assert all(set(item) == DELIVERY_KEYS for item in details["deliveries"])  # 鍵照舊，只有值是 None
    assert [{k: v for k, v in item.items() if k != "mid"} for item in details["deliveries"]] == [
        {k: v for k, v in item.items() if k != "mid"} for item in with_details["deliveries"]
    ]


def test_include_mid_defaults_to_true():
    _, details = presale_range([delivery(date(2027, 3, 1), 100, distance=500)], SHARES, today=OCTOBER)

    assert details["deliveries"][0]["mid"] == pytest.approx(0.15, abs=0.005)


def test_presale_details_do_not_carry_the_band_shares():
    odd = {"0-1": 0.0373123, "1-2": 0.0211456, "2-3": 0.0098765}
    deliveries = [delivery(date(2027, 3, 1), 100, distance=d) for d in (500, 1500, 2500)]

    _, details = presale_range(deliveries, odd, today=OCTOBER)

    text = json.dumps(details, default=str)
    assert not any(str(value)[:6] in text for value in odd.values())
    assert "share" not in text


# ---- 來源三：載入 ----

BENYANG = boundaries.village_code("三民區", "本揚里")  # 重心離義華 287 m
DINGZHONG = boundaries.village_code("三民區", "鼎中里")  # 重心 3340 m
YIHUA_LAT, YIHUA_LNG = YIHUA_POINT
NORTH_M = 1 / 111_320.0  # 往北 1 m 的緯度差


def buildcase(name: str, level: str, village_code: str | None, **kwargs) -> GeoPresaleBuildcase:
    values = {
        "district": "三民區", "street": "義華路", "households": 100, "main_use": "住家用", "residential": True,
        "permit_on": date(2024, 1, 1), "first_registered_on": None, "match_level": level, "lat": None, "lon": None,
        "source_version": "115-10", "updated_at": NOW,
    }
    values.update(kwargs)
    village = boundaries.village_names()[village_code][1] if village_code else None
    return GeoPresaleBuildcase(name=name, village_code=village_code, village=village, **values)


async def test_presale_missing_table_none(db_session):
    assert await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY) is None


async def seed_buildcases(db) -> None:
    db.add_all(
        [
            # 有座標：用座標距離（正北 500 m），不用里重心。120 戶：建照 2024-03 + 48 個月 = 2028-03-10。
            buildcase("座標案", "exact", BENYANG, households=120, permit_on=date(2024, 3, 10), lat=YIHUA_LAT + 500 * NORTH_M, lon=YIHUA_LNG),
            # 只到里：用里重心（本揚里 287 m）。36 戶：2023-06 + 36 個月 = 2026-06-01，已過預計時間。
            buildcase("重心案", "street", BENYANG, households=36, permit_on=date(2023, 6, 1)),
            # 地號座標在 2.2 km 外，雖然落在 287 m 的里：有座標就用座標。60 戶：2024-06 + 36 個月 = 2027-06-01。
            buildcase("遠點案", "parcel", BENYANG, households=60, permit_on=date(2024, 6, 1), lat=YIHUA_LAT + 2200 * NORTH_M, lon=YIHUA_LNG),
            # 3 km 外：座標 3.5 km、里重心 3340 m。
            buildcase("太遠座標", "parcel", BENYANG, permit_on=date(2024, 6, 2), lat=YIHUA_LAT + 3500 * NORTH_M, lon=YIHUA_LNG),
            buildcase("太遠重心", "street", DINGZHONG),
            # 不算：已登記、非住宅、建照超過 6 年、只到區、待比對、別區。
            buildcase("已登記", "exact", BENYANG, first_registered_on=date(2026, 1, 1)),
            buildcase("廠房", "exact", BENYANG, residential=False),
            buildcase("太舊", "exact", BENYANG, permit_on=date(2020, 10, 19)),
            buildcase("只到區", "district", None),
            buildcase("待比對", "pending", None),
            buildcase("岡山案", "district", None, district="岡山區"),
        ]
    )
    await db.commit()


async def test_load_deliveries_reads_building_cases_within_the_radius(db_session):
    await seed_buildcases(db_session)

    deliveries = await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY)

    assert [(item.name, item.households, item.expected) for item in deliveries] == [
        ("重心案", 36, presale_io.expected_delivery(date(2023, 6, 1), 36)),
        ("遠點案", 60, presale_io.expected_delivery(date(2024, 6, 1), 60)),
        ("座標案", 120, presale_io.expected_delivery(date(2024, 3, 10), 120)),
    ]
    near, far, pin = deliveries
    assert near.expected == date(2026, 6, 1) and pin.expected == date(2028, 3, 10)
    assert near.distance_m == pytest.approx(287, abs=3)  # 里重心
    assert far.distance_m == pytest.approx(2200, abs=3)  # 座標，不是 287 m
    assert pin.distance_m == pytest.approx(500, abs=3)


async def test_load_deliveries_radius_is_adjustable(db_session):
    await seed_buildcases(db_session)

    assert [item.name for item in await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY, radius_m=1000)] == ["重心案", "座標案"]
    wide = await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY, radius_m=4000)
    assert {item.name for item in wide} == {"太遠重心", "太遠座標", "座標案", "遠點案", "重心案"}


async def test_load_deliveries_with_no_case_in_range_is_empty_not_none(db_session):
    db_session.add(buildcase("岡山案", "street", BENYANG, first_registered_on=date(2026, 1, 1)))
    await db_session.commit()

    assert await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY) == []  # 有資料、只是半徑內沒有在建案


async def test_load_deliveries_skips_a_street_case_whose_village_has_no_centroid(db_session, monkeypatch):
    """里名單有這個里、里界重心沒有（兩份資料不同步）：只到里的案沒有位置可量，略過；有座標的案不受影響。"""
    await seed_buildcases(db_session)
    centroids = dict(boundaries.village_centroids())
    centroids.pop(BENYANG)
    monkeypatch.setattr(boundaries, "village_centroids", lambda: centroids)

    deliveries = await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY)

    assert [item.name for item in deliveries] == ["遠點案", "座標案"]


async def test_load_deliveries_feeds_presale_range(db_session):
    await seed_buildcases(db_session)

    deliveries = await load_deliveries(db_session, *YIHUA_POINT, today=LOAD_TODAY)
    result, details = presale_range(deliveries, SHARES, today=LOAD_TODAY)

    # 座標案 2028-03 交屋不在這一年；重心案（已過預計）在 0-1 km、遠點案（2027-06）在 2-3 km。
    assert [item["name"] for item in details["deliveries"]] == ["重心案", "遠點案"]
    assert [item["distance_m"] for item in details["deliveries"]] == [300, 2200]
    assert result.mid == round(36 * 0.04 * 0.0373 + 60 * 0.04 * 0.01, 1)


# ---- 組裝：query_potential ----

ASSEMBLE_TODAY = date(2026, 10, 20)
SOURCE_KEYS = ["closures", "villages", "presale"]
YIHUA_ROSTER_TOTAL = 192


@pytest.fixture
def located(monkeypatch, campuses):
    """校址在 YIHUA_POINT（query_potential 用 matcher.campus_point；campuses 另外給五校座標）。"""

    async def point(db, campus_key):
        return matcher.CampusPoint(campus_key, *YIHUA_POINT, None, "三民區")

    monkeypatch.setattr(matcher, "campus_point", point)


def patch_village_obs(monkeypatch, obs: list[VillageObs] | None) -> None:
    async def fake(db, campus_key, lat, lng, *, radius_m=potential.VILLAGE_FIT_RADIUS_M):
        return obs

    monkeypatch.setattr(potential, "load_village_obs", fake)


def add_roster(db, total: int = YIHUA_ROSTER_TOTAL) -> None:
    db.add(
        EnrolledRoster(
            campus_key="yihua", roster_date=date(2026, 10, 15), school_year=115, doorplate_version="115-10", total=total
        )
    )


def mark_kindergartens_synced(db) -> None:
    db.add(GeoDatasetStatus(dataset="kindergartens", active_version="2026-10-20", label="2026-10-20", synced_at=NOW))


async def seed_closures(db, *, own_capacity: int | None = 210) -> None:
    """本校（營業中，3 歲收費 89,750）加幾所停辦的園所。回測用的日期落在 111～114 學年窗口：
    ire 607 m、核定 136、2023-07-31（111 學年）；far 4 km、核定 100、2025-07-31（113 學年，距離係數 0.12）；
    nocap 往南 2 km（正北 2 km 是明華）、沒有核定、2024-08-01（112 學年）；recent 1 km、核定 60、2026-10-05（進行中的 115 學年）。
    old（2022-09-30，早於起點）與 toofar（9 km）不會被載入。"""
    add_kindergarten(db, "own", "高雄市私立常春藤幼兒園", "private", 0, approved_capacity=own_capacity)
    add_kindergarten(db, "ire", "高雄市私立愛爾蘭幼兒園", "private", 607, approved_capacity=136, is_active=False)
    add_kindergarten(db, "far", "高雄市私立遠幼兒園", "private", 4000, approved_capacity=100, is_active=False)
    add_kindergarten(db, "nocap", "高雄市私立無核定幼兒園", "private", -2000, approved_capacity=None, is_active=False)
    add_kindergarten(db, "recent", "高雄市私立新近幼兒園", "private", 1000, approved_capacity=60, is_active=False)
    add_kindergarten(db, "old", "高雄市私立舊幼兒園", "private", 1000, approved_capacity=50, is_active=False)
    add_kindergarten(db, "toofar", "高雄市私立太遠幼兒園", "private", 9000, approved_capacity=50, is_active=False)
    await db.flush()
    add_fee(db, "own", 3, 89_750)
    add_fee(db, "ire", 3, 80_000)
    add_fee(db, "far", 3, 89_750)
    db.add_all(
        [
            closed("ire", date(2023, 7, 31)), closed("far", date(2025, 7, 31)), closed("nocap", date(2024, 8, 1)),
            closed("recent", date(2026, 10, 5)), closed("old", date(2022, 9, 30)), closed("toofar", date(2024, 1, 1)),
        ]
    )
    mark_kindergartens_synced(db)
    await db.commit()


def by_key(result: dict) -> dict[str, dict]:
    return {source["key"]: source for source in result["sources"]}


async def test_sources_fixed_order(db_session, located, monkeypatch):
    """什麼資料都沒有：三個來源固定順序、都 no_data，總數與空位是 None；today 不給就取台北今天。"""
    monkeypatch.setattr(potential, "today_local", lambda: ASSEMBLE_TODAY)

    result = await query_potential(db_session, "yihua")

    assert result["status"] == "ready"
    assert [source["key"] for source in result["sources"]] == SOURCE_KEYS
    for source in result["sources"]:
        assert source["status"] == "no_data"
        assert (source["low"], source["mid"], source["high"]) == (None, None, None)
        assert source["reason"]
        assert source["assumptions"] and all(set(item) == {"label", "value"} for item in source["assumptions"])
    assert [source["reason"] for source in result["sources"]] == ["沒有停辦紀錄", "沒有在籍清冊", "沒有在籍清冊"]
    assert result["total"] is None and result["capacity"] is None and result["events"] == []
    # no_data 的 details 是空的同一種形狀，畫面不必另外判斷
    assert by_key(result)["closures"]["details"] == {
        "years": [], "skipped": {"no_capacity": 0, "outside_windows": 0}, "price_unknown": 0, "events": []
    }
    assert by_key(result)["villages"]["details"] == {"bands": [], "model": None}
    assert by_key(result)["presale"]["details"] == {"deliveries": []}


async def test_no_roster_partial_total(db_session, located):
    """沒有在籍清冊：來源二、三 no_data，來源一照算，總數只含來源一。"""
    await seed_closures(db_session)
    await seed_buildcases(db_session)

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    sources = by_key(result)
    first = (136 * UNIT, 100 * UNIT * 0.12)
    expected = Range(low=0.0, mid=sum(first) / 4 * CATCH_RATE_MID, high=first[0] * CATCH_RATE_HIGH)
    assert sources["closures"]["status"] == "ok" and sources["closures"]["reason"] is None
    assert (sources["closures"]["low"], sources["closures"]["mid"], sources["closures"]["high"]) == (
        expected.low, expected.mid, expected.high
    )
    assert (sources["villages"]["status"], sources["villages"]["reason"]) == ("no_data", "沒有在籍清冊")
    # 來源三沒有占有率可用（占有率來自來源二）
    assert (sources["presale"]["status"], sources["presale"]["reason"]) == ("no_data", "沒有在籍清冊")
    assert result["total"] == {"low": expected.low, "mid": expected.mid, "high": expected.high, "included": ["closures"]}


async def test_closures_details_and_counts(db_session, located):
    await seed_closures(db_session)

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    details = by_key(result)["closures"]["details"]
    assert [(year["school_year"], year["events"]) for year in details["years"]] == [(111, 1), (112, 0), (113, 1), (114, 0)]
    assert details["skipped"] == {"no_capacity": 1, "outside_windows": 1}
    assert details["price_unknown"] == 0
    assert [(item["name"], item["school_year"]) for item in details["events"]] == [
        ("高雄市私立愛爾蘭幼兒園", 111), ("高雄市私立遠幼兒園", 113),
    ]


async def test_capacity_open_seats(db_session, located):
    """核定 210、在籍 192 → 目前空位 18。"""
    await seed_closures(db_session)
    add_roster(db_session)
    await db_session.commit()

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    assert result["capacity"] == {"approved": 210, "enrolled": 192, "open": 18}


async def test_capacity_is_none_without_a_roster_or_an_approved_capacity(db_session, located):
    await seed_closures(db_session)
    assert (await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))["capacity"] is None  # 沒有清冊

    add_roster(db_session)
    await db_session.commit()
    own = await db_session.get(potential.GeoKindergarten, "own")
    own.approved_capacity = None
    await db_session.commit()
    assert (await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))["capacity"] is None  # 沒有核定

    own.approved_capacity = 0
    await db_session.commit()
    assert (await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))["capacity"] is None  # 核定 0 當作沒有


async def test_capacity_open_seats_never_negative(db_session, located):
    await seed_closures(db_session, own_capacity=180)
    add_roster(db_session)
    await db_session.commit()

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    assert result["capacity"] == {"approved": 180, "enrolled": 192, "open": 0}


async def test_capacity_without_an_own_school_is_none(db_session, located):
    add_roster(db_session)
    await db_session.commit()

    assert (await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))["capacity"] is None


async def test_events_within_3km_since_2022(db_session, located):
    """停辦事件清單（畫走勢圖標記用）：3 km 內、2022-10 起、含進行中的學年；4 km 的、9 km 的、2022-09-30 的都不列。"""
    await seed_closures(db_session)

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    assert [(item["occurred_on"], item["name"], item["approved_capacity"], item["school_year"]) for item in result["events"]] == [
        (date(2023, 7, 31), "高雄市私立愛爾蘭幼兒園", 136, 111),
        (date(2024, 8, 1), "高雄市私立無核定幼兒園", None, 112),
        (date(2026, 10, 5), "高雄市私立新近幼兒園", 60, 115),
    ]
    assert [item["distance_m"] for item in result["events"]] == pytest.approx([607, 2000, 1000], abs=3)
    assert all(isinstance(item["distance_m"], int) for item in result["events"])
    assert all(set(item) == {"occurred_on", "name", "approved_capacity", "distance_m", "school_year"} for item in result["events"])


async def test_closures_need_a_synced_dataset_and_a_full_window(db_session, located):
    await seed_closures(db_session)
    await db_session.delete(await db_session.get(GeoDatasetStatus, "kindergartens"))
    await db_session.commit()

    never_synced = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)
    assert (by_key(never_synced)["closures"]["status"], by_key(never_synced)["closures"]["reason"]) == ("no_data", "沒有停辦紀錄")

    mark_kindergartens_synced(db_session)
    await db_session.commit()
    early = await query_potential(db_session, "yihua", today=date(2023, 3, 1))  # 還沒有任何完整窗口
    assert (by_key(early)["closures"]["status"], by_key(early)["closures"]["reason"]) == ("no_data", "沒有停辦紀錄")


async def test_a_quiet_market_is_zero_not_no_data(db_session, located):
    """同步過、有完整窗口、只是附近沒有停辦：ok 且是 0。"""
    add_kindergarten(db_session, "own", "高雄市私立常春藤幼兒園", "private", 0, approved_capacity=210)
    mark_kindergartens_synced(db_session)
    await db_session.commit()

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    closures = by_key(result)["closures"]
    assert (closures["status"], closures["low"], closures["mid"], closures["high"]) == ("ok", 0.0, 0.0, 0.0)
    assert result["total"]["included"] == ["closures"]


async def test_every_source_ok_adds_up(db_session, located, monkeypatch):
    await seed_closures(db_session)
    await seed_buildcases(db_session)
    obs = synthetic_obs(wobble=(0.5, 1.0))
    patch_village_obs(monkeypatch, obs)

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    sources = by_key(result)
    assert [source["status"] for source in result["sources"]] == ["ok", "ok", "ok"]
    assert all(source["reason"] is None for source in result["sources"])
    village_range, village_details = villages_range(obs)
    assert (sources["villages"]["low"], sources["villages"]["mid"], sources["villages"]["high"]) == (
        village_range.low, village_range.mid, village_range.high
    )
    assert [band["band"] for band in sources["villages"]["details"]["bands"]] == ["0-1", "1-2", "2-3"]
    assert sources["villages"]["details"]["model"] == village_details["model"]
    deliveries = await load_deliveries(db_session, *YIHUA_POINT, today=ASSEMBLE_TODAY)
    presale, presale_details = presale_range(deliveries, band_shares(obs), today=ASSEMBLE_TODAY)
    assert (sources["presale"]["low"], sources["presale"]["mid"], sources["presale"]["high"]) == (
        presale.low, presale.mid, presale.high
    )
    assert sources["presale"]["details"] == presale_details
    assert all(item["mid"] is not None for item in sources["presale"]["details"]["deliveries"])
    total = result["total"]
    assert total["included"] == SOURCE_KEYS
    for name in ("low", "mid", "high"):
        assert total[name] == round(sum(source[name] for source in result["sources"]), 1)


async def test_total_only_adds_the_sources_that_are_ok(db_session, located, monkeypatch):
    """來源三沒有預售資料（表是空的）：總數只含來源一與二。"""
    await seed_closures(db_session)
    patch_village_obs(monkeypatch, synthetic_obs(wobble=(0.5, 1.0)))

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    sources = by_key(result)
    assert (sources["presale"]["status"], sources["presale"]["reason"]) == ("no_data", "沒有預售資料")
    assert [source["status"] for source in result["sources"]] == ["ok", "ok", "no_data"]
    assert result["total"]["included"] == ["closures", "villages"]
    assert result["total"]["mid"] == round(sources["closures"]["mid"] + sources["villages"]["mid"], 1)


async def test_presale_with_no_case_in_range_is_zero_not_no_data(db_session, located, monkeypatch):
    patch_village_obs(monkeypatch, synthetic_obs(wobble=(0.5, 1.0)))
    db_session.add(buildcase("岡山案", "street", BENYANG, first_registered_on=date(2026, 1, 1)))  # 已登記：不算在建
    await db_session.commit()

    presale = by_key(await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))["presale"]

    assert (presale["status"], presale["low"], presale["mid"], presale["high"]) == ("ok", 0.0, 0.0, 0.0)
    assert presale["details"] == {"deliveries": []}


async def test_too_few_villages_has_no_village_or_presale_number(db_session, located):
    """有清冊但附近有孩子的里太少：來源二 no_data，來源三沒有占有率，也 no_data。"""
    add_roster(db_session)
    await seed_buildcases(db_session)

    sources = by_key(await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))

    for key in ("villages", "presale"):
        assert (sources[key]["status"], sources[key]["reason"]) == ("no_data", "附近有孩子的里太少")


@pytest.mark.parametrize(
    ("obs", "reason"),
    [
        ([VillageObs(f"640{index:08d}", 100.0 * (index + 1), 100, 3) for index in range(19)], "附近有孩子的里太少"),
        ([VillageObs(f"640{index:08d}", 100.0 * (index + 1), 100, 1) for index in range(25)], "在籍人數太少"),
        ([VillageObs(f"640{index:08d}", 500.0, 100, 2) for index in range(25)], "算不出距離曲線"),  # 全在同一個距離
    ],
)
async def test_villages_without_a_number_says_why(db_session, located, monkeypatch, obs, reason):
    patch_village_obs(monkeypatch, obs)

    sources = by_key(await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))

    assert (sources["villages"]["status"], sources["villages"]["reason"]) == ("no_data", reason)
    assert sources["villages"]["details"] == {"bands": [], "model": None}  # 算不出來時不留半成品
    assert (sources["presale"]["status"], sources["presale"]["reason"]) == ("no_data", reason)


def thin_near_band(obs: list[VillageObs]) -> list[VillageObs]:
    """0–1 km 只留 2 個有孩子的里（<3）：距離帶的在籍、期望、缺口會被藏起來。"""
    return [item for item in obs if item.distance_m > 1000 or item.distance_m <= 200]


async def test_hidden_bands_also_hide_each_cases_contribution(db_session, located, monkeypatch):
    """來源二把距離帶藏起來時，來源三每案的中值貢獻也不回（單案貢獻÷戶數÷0.04 就是占有率）；加總的低／中／高照回。"""
    await seed_buildcases(db_session)
    obs = thin_near_band(synthetic_obs(wobble=(0.5, 1.0)))
    patch_village_obs(monkeypatch, obs)

    sources = by_key(await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))

    assert sources["villages"]["status"] == "ok"
    assert all(band["enrolled"] is None and band["expected"] is None and band["gap"] is None for band in sources["villages"]["details"]["bands"])
    assert sources["presale"]["status"] == "ok"
    deliveries = sources["presale"]["details"]["deliveries"]
    assert deliveries and all(item["mid"] is None for item in deliveries)
    assert sources["presale"]["mid"] > 0


@pytest.mark.parametrize("hide", [False, True])
async def test_band_shares_never_appear_in_the_result(db_session, located, monkeypatch, hide):
    await seed_closures(db_session)
    await seed_buildcases(db_session)
    obs = synthetic_obs(wobble=(0.5, 1.0))
    obs = thin_near_band(obs) if hide else obs
    patch_village_obs(monkeypatch, obs)

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    blob = json.dumps(result, ensure_ascii=False, default=str)
    shares = band_shares(obs)
    assert min(shares.values()) > 0
    for band, share in shares.items():
        assert str(share)[:6] not in blob, band


async def test_assumptions_list_the_parameters_each_source_used(db_session, located, monkeypatch):
    await seed_closures(db_session)
    await seed_buildcases(db_session)
    patch_village_obs(monkeypatch, synthetic_obs(wobble=(0.5, 1.0)))

    sources = by_key(await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))

    for source in sources.values():
        labels = [item["label"] for item in source["assumptions"]]
        assert len(labels) == len(set(labels)) and labels
        assert all(isinstance(item["value"], str) and item["value"] for item in source["assumptions"])
    closures = {item["label"]: item["value"] for item in sources["closures"]["assumptions"]}
    assert closures["實收率"] == "0.67（全市 114 學年核定與幼生比）"
    assert "0.29" in closures["畢業比例"] and "13.8%" in closures["承接率"] and "17.3%" in closures["承接率"]
    assert "連鎖" in closures["沒有計入"] and "老師帶班" in closures["沒有計入"]
    assert "只有童年綠地、愛爾蘭兩次停辦可校準" in closures["承接率"]
    assert closures["停辦日期"] == "園所離開教育部名單的那天；名單消失日不等於實際停收日"
    assert closures["怎麼看這個數字"] == "2022 年 10 月以來各學年的平均，不是預測下一所會停辦"
    assert closures["核定名額沒填"].startswith("1 所") and closures["不在完整窗口"].startswith("1 所")
    assert closures["沒有收費資料"].startswith("0 所")
    assert "111" in closures["統計窗口"] and "114" in closures["統計窗口"]
    villages = {item["label"]: item["value"] for item in sources["villages"]["assumptions"]}
    assert "5.1" in villages["缺口"] and "3" in villages["每年新生"] and "20261020" in villages["低、高"]
    presale = {item["label"]: item["value"] for item in sources["presale"]["assumptions"]}
    assert "2.5" in presale["每百戶 2–5 歲孩子"] and "6.0" in presale["每百戶 2–5 歲孩子"]
    assert "2027-08-31" in presale["算進哪些案"]


async def test_the_village_model_runs_off_the_event_loop_thread(db_session, located, monkeypatch):
    """來源二的擬合與重抽是純 CPU 計算，放進執行緒，不卡住事件迴圈。"""
    loop_thread = threading.get_ident()
    threads: list[int] = []

    def spy(obs):
        threads.append(threading.get_ident())
        return villages_range(obs)

    monkeypatch.setattr(potential, "villages_range", spy)
    patch_village_obs(monkeypatch, synthetic_obs(wobble=(0.5, 1.0)))

    sources = by_key(await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY))

    assert sources["villages"]["status"] == "ok"
    assert threads and loop_thread not in threads


async def test_no_campus_point(db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key, None, None, "no_doorplate", "三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)

    result = await query_potential(db_session, "yihua", today=ASSEMBLE_TODAY)

    assert result["status"] == "no_campus_point"
    assert [(source["key"], source["status"]) for source in result["sources"]] == [(key, "no_data") for key in SOURCE_KEYS]
    assert all(source["reason"] for source in result["sources"])
    # 沒有數字（no_data）的來源一也列出口徑說明：停辦日期怎麼來、這個數字該怎麼讀
    closures = {item["label"]: item["value"] for item in result["sources"][0]["assumptions"]}
    assert "名單消失日不等於實際停收日" in closures["停辦日期"]
    assert "不是預測下一所會停辦" in closures["怎麼看這個數字"]
    assert "只有童年綠地、愛爾蘭兩次停辦可校準" in closures["承接率"]
    assert result["total"] is None and result["capacity"] is None and result["events"] == []
