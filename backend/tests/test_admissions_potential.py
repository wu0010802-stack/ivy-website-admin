"""招生潛力來源一：附近園所停辦釋出（2026-10-20 招生潛力第二、三波，報告 A-07、I-4）。

純函式測試用自己造的 ClosureEvent；載入測試用 peer_fees_helpers 的小園所（義華校址往北幾公尺），不依賴真回補檔。
回測兩例照報告：愛爾蘭（核定 136、607 m）與童年綠地（480、676 m），收費相近、私立，承接率 13.8%。"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone

import pytest

from app.admissions import area
from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import GeoProviderEvent, GeoVillagePopulation
from app.admissions.potential import (
    CATCH_RATE_HIGH,
    CATCH_RATE_MID,
    GRADUATING_SHARE,
    OCCUPANCY_RATE,
    ClosureEvent,
    Range,
    VillageObs,
    band_shares,
    band_weight,
    closure_inflow,
    closures_range,
    first_window_start,
    fit_distance_model,
    load_closure_events,
    load_village_obs,
    price_factor,
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


def test_villages_range_never_excludes_the_observed_gap():
    """近處（3 km 內）幾乎沒招到、遠處招得多：實際缺口遠大於抽樣只靠雜訊產生的缺口，區間仍包住中值。"""
    obs = [
        VillageObs(f"640{index:08d}", 100 + index * 100, 2000, 0 if index < 30 else 40)
        for index in range(60)
    ]
    result, _ = villages_range(obs)

    assert result is not None
    assert result.low < result.mid  # 抽樣的 90 百分位遠低於實際缺口，高值向中值靠攏
    assert result.high == result.mid


def test_villages_range_never_goes_above_the_observed_gap_on_the_low_side():
    """在籍剛好等於期望值（實際缺口幾乎是 0）時，光靠雜訊抽出來的缺口都比它大：低值向中值靠攏。"""
    result, _ = villages_range(synthetic_obs())

    assert result is not None
    assert result.low == result.mid
    assert result.high > result.mid


def test_villages_range_needs_enough_successful_draws():
    result, details = villages_range(synthetic_obs(), draws=10)

    assert result is None
    assert details["model"] is not None  # 模型本身有估出來，只是區間抽樣的次數不夠


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
    assert [band["band"] for band in bands] == ["0-0.5", "0.5-1", "1-2", "2-3"]
    # 100 m 一個里；帶界含上界：500 m 在第一帶、3000 m 在最後一帶、3100 m 起不在任何一帶
    assert [band["villages"] for band in bands] == [5, 5, 10, 10]
    inside = [item for item in obs if item.distance_m <= 3000]
    assert sum(band["kids"] for band in bands) == sum(item.kids for item in inside)
    assert sum(band["enrolled"] for band in bands) == sum(item.enrolled for item in inside)
    a, b = fit_distance_model(obs)
    assert details["model"] == {"a": pytest.approx(a, abs=0.001), "b": pytest.approx(b, abs=0.001)}
    assert sum(band["gap"] for band in bands) == pytest.approx(result.mid * 3, abs=0.5)  # 各帶缺口加起來就是總缺口
    assert all(band["expected"] >= 0 and band["gap"] >= 0 for band in bands)


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
