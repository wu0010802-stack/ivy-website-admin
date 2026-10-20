"""招生潛力來源一：附近園所停辦釋出（2026-10-20 招生潛力第二、三波，報告 A-07、I-4）。

純函式測試用自己造的 ClosureEvent；載入測試用 peer_fees_helpers 的小園所（義華校址往北幾公尺），不依賴真回補檔。
回測兩例照報告：愛爾蘭（核定 136、607 m）與童年綠地（480、676 m），收費相近、私立，承接率 13.8%。"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.admissions import area
from app.admissions.geo import matcher
from app.admissions.geo.models import GeoProviderEvent
from app.admissions.potential import (
    CATCH_RATE_HIGH,
    CATCH_RATE_MID,
    GRADUATING_SHARE,
    OCCUPANCY_RATE,
    ClosureEvent,
    Range,
    band_weight,
    closure_inflow,
    closures_range,
    first_window_start,
    load_closure_events,
    price_factor,
    school_year_window,
)
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
