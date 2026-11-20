"""來源的相近寫法（2026-11-20）：比對鍵與合併後的來源列。純計算，不碰資料庫。"""
from __future__ import annotations

import pytest

from app.admissions import estimation
from app.admissions.source_alias import source_key
from app.admissions.stats import UNFILLED, _by_source_merged, _with_range


@pytest.mark.parametrize(
    "labels",
    [
        # 大小寫、全形半形、空白與標點。
        ("Facebook", "facebook", "FACEBOOK", "Ｆａｃｅｂｏｏｋ", " Face book ", "Face-book"),
        # 中英文與縮寫。
        ("Facebook", "FB", "fb", "ＦＢ", "臉書", "面書"),
        ("FB 粉專", "臉書粉專", "Facebook粉專", "fb-粉專"),
        ("Instagram", "IG", "ig", "instagram"),
        ("Google", "google", "谷歌", "估狗"),
        ("Google 評論", "google評論", "谷歌評論", "Google　評論"),
        ("LINE", "line", "Line", "賴"),
        # 固定說法。
        ("官網", "官方網站", "學校官網", "學校網站", "網站"),
        ("親友介紹", "朋友介紹", "親戚介紹", "友人介紹", "親友推薦", "朋友推薦"),
        ("傳單／DM", "傳單/DM", "傳單", "DM", "dm"),
    ],
)
def test_same_source_written_differently_shares_a_key(labels: tuple[str, ...]) -> None:
    assert len({source_key(label) for label in labels}) == 1, [source_key(label) for label in labels]


def test_related_but_different_channels_stay_apart() -> None:
    # 同一家公司的不同管道、自然流量與廣告、看起來像縮寫的別的字，都不合併。
    apart = ["Facebook", "FB 廣告", "FB 粉專", "Instagram", "Google", "Google 評論", "Google 搜尋", "Google 地圖",
             "LINE", "官網", "親友介紹", "舊生手足", "路過招牌", "FBI", "IGLOO", "媽媽社團", "網路上看到", "其他"]
    keys = [source_key(label) for label in apart]
    assert len(set(keys)) == len(apart), sorted(zip(keys, apart))


def test_multi_select_answers_are_their_own_source() -> None:
    # 官網預約的「從哪裡知道我們」可以複選，寫進來源是「親友介紹、Facebook」：是另一個值，不併進任何一邊。
    assert source_key("親友介紹、Facebook") not in {source_key("親友介紹"), source_key("Facebook")}


def _row(source: str, visit: int, deposit: int) -> dict:
    return {"source": source, "visit": visit, "deposit": deposit, "visit_to_deposit_rate": None}


def test_merged_rows_sum_counts_name_after_the_biggest_variant_and_list_the_rest() -> None:
    # 輸入是 _by_source 的結果：已依參觀數由大到小排好。
    rows = [_row("親友介紹", 41, 31), _row("Facebook", 33, 18), _row("FB", 9, 5), _row("官網", 8, 4), _row("臉書", 6, 3),
            _row("朋友介紹", 4, 2), _row("IG", 4, 1), _row(UNFILLED, 3, 0)]
    merged = _by_source_merged(rows)
    assert [(row["source"], row["visit"], row["deposit"], row["visit_to_deposit_rate"], row["variants"]) for row in merged] == [
        ("Facebook", 48, 26, 54.2, ["FB", "臉書"]),
        ("親友介紹", 45, 33, 73.3, ["朋友介紹"]),
        ("官網", 8, 4, 50.0, []),
        ("IG", 4, 1, 25.0, []),
        (UNFILLED, 3, 0, 0.0, []),
    ]
    # 合併不增不減：總數和原文那張表一樣。
    assert sum(row["visit"] for row in merged) == sum(row["visit"] for row in rows)
    assert sum(row["deposit"] for row in merged) == sum(row["deposit"] for row in rows)


def test_merged_range_uses_the_merged_counts() -> None:
    # 可能範圍用合併後的筆數算（同一支 rate_range）：三列各自 33、9、6 筆的範圍都比合起來 48 筆的寬。
    rows = [_row("Facebook", 33, 18), _row("FB", 9, 5), _row("臉書", 6, 3)]
    prior = estimation.prior_rate(26, 48)
    merged = _with_range(_by_source_merged(rows), prior)
    assert merged[0]["visit_to_deposit_range"] == estimation.rate_range(26, 48, prior)
    width = merged[0]["visit_to_deposit_range"]["high"] - merged[0]["visit_to_deposit_range"]["low"]
    for row in _with_range(rows, prior):
        assert row["visit_to_deposit_range"]["high"] - row["visit_to_deposit_range"]["low"] > width


def test_unfilled_never_merges_even_if_someone_types_the_same_words() -> None:
    # 「未填寫」是後端給沒填來源的標籤，不是一種寫法；老師真的打「未 填寫」也不併進去。
    merged = _by_source_merged([_row(UNFILLED, 5, 1), _row("未 填寫", 2, 0)])
    assert [(row["source"], row["visit"], row["variants"]) for row in merged] == [(UNFILLED, 5, []), ("未 填寫", 2, [])]
