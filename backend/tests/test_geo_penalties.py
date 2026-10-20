"""幼兒園裁罰明細的解析（2026-10-20 規格 §2、C1–C4）。純函式，不連資料庫、不連外。

人名欄（「負責人：姓名」「行為人：姓名」）一定不能進輸出：測試檔裡的姓名全是 FAKE_PERSON_NAMES 的假值。"""

from __future__ import annotations

from datetime import date

import pytest

from app.admissions.geo import penalties as pen
from app.admissions.geo.penalties import PenaltyFormatError
from tests.geo_helpers import FAKE_PERSON_NAMES, penalty_files


def _record(**overrides) -> list:
    base = {
        "date": "2026/01/27", "doc": "高市教幼字第11530761100號", "law": "幼兒教育及照顧法第58條第1項第7款(111/6/29修正公布)",
        "content": "第17條第7項幼兒園未依規定配置廚工。", "person": f"負責人：{FAKE_PERSON_NAMES[0]}", "punish": "罰鍰：6,000元",
    }
    base.update(overrides)
    return [base["date"], base["doc"], base["law"], base["content"], base["person"], base["punish"]]


def _parse(*records: list, name: str = "高雄市私立測試幼兒園") -> list[pen.PenaltyRow]:
    return pen.parse_penalty_file(list(records), name).rows


def test_a_fine_keeps_the_amount_and_drops_the_thousands_separator():
    (row,) = _parse(_record())
    assert (row.kind, row.amount, row.period_start, row.period_end, row.punishment_text) == ("fine", 6000, None, None, None)
    assert row.occurred_on == date(2026, 1, 27)
    assert row.doc_no == "高市教幼字第11530761100號"
    assert row.law.startswith("幼兒教育及照顧法第58條")
    assert row.content == "第17條第7項幼兒園未依規定配置廚工。"


@pytest.mark.parametrize(
    ("label", "kind"),
    [("停止招生", "stop_enrollment"), ("減少招收人數", "reduce_enrollment"), ("停辦", "closure")],
)
def test_the_three_period_punishments_keep_start_and_end(label, kind):
    (row,) = _parse(_record(punish=f"{label}：2022/08/01~2023/05/31"))
    assert (row.kind, row.amount) == (kind, None)
    assert (row.period_start, row.period_end) == (date(2022, 8, 1), date(2023, 5, 31))
    assert row.punishment_text is None


@pytest.mark.parametrize(
    "text",
    [
        "警告",  # 不認得的處分
        "罰鍰：待查",  # 認得標籤但金額不是數字
        "停止招生：2022/08/01",  # 沒有迄日
        "停止招生：2023/05/31~2022/08/01",  # 迄日早於起日
        "停辦：2022/13/01~2022/14/01",  # 日期不存在
        "罰鍰：99999999999元",  # 超出 int4
    ],
)
def test_punishments_in_an_unknown_format_become_other_and_keep_the_original_text(text):
    (row,) = _parse(_record(punish=text))
    assert (row.kind, row.amount, row.period_start, row.period_end) == ("other", None, None, None)
    assert row.punishment_text == text


def test_an_other_punishment_never_keeps_what_follows_a_person_label():
    (row,) = _parse(_record(punish=f"警告 負責人：{FAKE_PERSON_NAMES[0]}"))
    assert row.kind == "other" and row.punishment_text == "警告"


def test_content_may_be_just_the_article_number():
    (row,) = _parse(_record(content="第38條第2項"))
    assert row.content == "第38條第2項"


def test_the_seventh_column_is_the_full_name_at_the_time_of_the_penalty():
    plain, with_name = _parse(_record(), _record() + ["高雄市私立舊名幼兒園"])
    assert plain.alt_name is None and with_name.alt_name == "高雄市私立舊名幼兒園"


def test_the_subject_is_only_a_category_never_a_name():
    operator, staff, none = _parse(
        _record(person=f"負責人：{FAKE_PERSON_NAMES[0]}"),
        _record(person=f"行為人：{FAKE_PERSON_NAMES[1]}"),
        _record(person=FAKE_PERSON_NAMES[2]),  # 沒有標籤：不認得，也不存
    )
    assert (operator.subject, staff.subject, none.subject) == ("operator", "staff", None)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("負責人：甲", "operator"), ("負責人:甲", "operator"), (" 負責人 ： 甲", "operator"), ("行為人：乙", "staff"),
        ("負責人", None), ("園長：甲", None), ("", None), (None, None),
    ],
)
def test_subject_of(value, expected):
    assert pen.subject_of(value) == expected


def test_names_do_not_appear_in_any_output():
    rows = []
    for name, data in penalty_files().items():
        rows.extend(pen.parse_penalty_file(data, name).rows)
    assert rows
    outputs = [repr(rows), pen.rows_to_csv(rows), "\n".join(repr(row.__dict__) for row in rows)]
    for output in outputs:
        for person in FAKE_PERSON_NAMES:
            assert person not in output
        assert "負責人：" not in output and "行為人：" not in output
    assert not hasattr(rows[0], "person") and "person" not in pen.CSV_COLUMNS


def test_a_person_label_inside_a_text_field_cuts_everything_after_it():
    (row,) = _parse(_record(content=f"第17條第7項 負責人：{FAKE_PERSON_NAMES[0]}", law=f"法條 行為人:{FAKE_PERSON_NAMES[1]}"))
    assert row.content == "第17條第7項" and row.law == "法條"


def test_a_person_label_without_a_colon_in_the_document_number_is_cut_too():
    """真檔有一筆的裁處文號是「高市教幼字第負責人＋姓名＋號」（來源欄位錯置、沒有冒號）：識別用的短欄位從標籤起整段截掉。"""
    (row,) = _parse(_record(doc=f"高市教幼字第負責人{FAKE_PERSON_NAMES[0]}號", law=f"法條行為人{FAKE_PERSON_NAMES[1]}"))
    assert row.doc_no == "高市教幼字第" and row.law == "法條"
    (other,) = _parse(_record(punish=f"警告行為人{FAKE_PERSON_NAMES[2]}"))
    assert other.punishment_text == "警告"
    (named,) = pen.parse_penalty_file([_record() + [f"高雄市私立測試幼兒園負責人{FAKE_PERSON_NAMES[3]}"]], "高雄市私立測試幼兒園").rows
    assert named.alt_name == "高雄市私立測試幼兒園"
    for output in (repr(row), repr(other), repr(named)):
        assert not any(person in output for person in FAKE_PERSON_NAMES)


def test_content_that_merely_mentions_the_operator_is_kept_unless_a_name_follows():
    kept, cut_colon, cut_name = _parse(
        _record(content="第9條第2項負責人未依規定辦理保險，幼兒園應改善。"),
        _record(content=f"第9條第2項 負責人：{FAKE_PERSON_NAMES[0]}"),
        _record(content=f"第9條第2項 負責人{FAKE_PERSON_NAMES[1]}"),
    )
    assert kept.content == "第9條第2項負責人未依規定辦理保險，幼兒園應改善。"
    assert cut_colon.content == "第9條第2項" and cut_name.content == "第9條第2項"


def test_long_text_is_cut_to_the_column_widths_and_whitespace_collapsed():
    (row,) = _parse(_record(content="字  \n" * 400, law="法" * 500, doc="號" * 200))
    assert len(row.content) <= 300 and len(row.law) <= 160 and len(row.doc_no) <= 80
    assert "\n" not in row.content and "  " not in row.content


def test_records_with_too_few_columns_or_a_bad_date_are_skipped_and_counted():
    result = pen.parse_penalty_file(
        [_record(), ["2026/01/27", "x"], _record(date="115/01/27"), _record(date="2026/02/30"), "not a record", _record(date="2026/1/5")],
        "高雄市私立測試幼兒園",
    )
    assert [row.occurred_on for row in result.rows] == [date(2026, 1, 27), date(2026, 1, 5)]
    assert result.skipped == 4


def test_the_punishment_hash_tells_two_punishments_of_one_case_apart():
    first, second = _parse(_record(punish="罰鍰：6,000元"), _record(punish="罰鍰：60,000元"))
    assert first.punishment_hash != second.punishment_hash
    assert len(first.punishment_hash) == 16
    assert pen.punishment_hash("罰鍰：6,000元") == pen.punishment_hash("罰鍰：6,000元  ")  # 空白不影響


@pytest.mark.parametrize("data", [{}, "x", None, 5])
def test_a_file_that_is_not_an_array_is_a_format_error_without_the_content(data):
    with pytest.raises(PenaltyFormatError) as caught:
        pen.parse_penalty_file(data, "高雄市私立測試幼兒園")
    assert str(caught.value) == "裁罰檔不是預期的格式"


@pytest.mark.parametrize("name", ["", "   ", "園" * 121])
def test_an_unusable_school_name_is_a_format_error(name):
    with pytest.raises(PenaltyFormatError):
        pen.parse_penalty_file([], name)


def test_listing_names_keeps_only_json_files_sorted_and_without_the_suffix():
    data = [
        {"name": "乙園.json", "type": "file"}, {"name": "甲園.json", "type": "file"}, {"name": "甲園.json", "type": "file"},
        {"name": "readme.md", "type": "file"}, {"name": "子目錄.json", "type": "dir"}, {"name": ".json", "type": "file"},
        {"name": 5, "type": "file"}, "oops",
    ]
    assert pen.listing_names(data) == ["乙園", "甲園"]


@pytest.mark.parametrize("data", [{"message": "API rate limit exceeded"}, "x", None])
def test_a_listing_that_is_not_an_array_is_a_format_error_without_the_content(data):
    with pytest.raises(PenaltyFormatError) as caught:
        pen.listing_names(data)
    assert str(caught.value) == "裁罰檔名清單不是預期的格式"


def test_punish_url_encodes_the_whole_name():
    url = pen.punish_url("高雄市光武非營利幼兒園(委託高雄市教保人員職業工會辦理)")
    assert url.startswith("https://kiang.github.io/ap.ece.moe.edu.tw/data/punish/%E9%AB%98%E9%9B%84%E5%B8%82/")
    assert url.endswith(".json") and "%28" in url and "(" not in url and " " not in url


def test_csv_round_trip_keeps_every_field():
    rows = []
    for name, data in penalty_files().items():
        rows.extend(pen.parse_penalty_file(data, name).rows)
    assert pen.parse_csv(pen.rows_to_csv(rows)) == rows


def test_csv_header_has_no_person_column():
    header = pen.rows_to_csv([]).splitlines()[0].split(",")
    assert tuple(header) == pen.CSV_COLUMNS
    assert not any(word in "".join(header) for word in ("person", "name_of", "負責", "行為"))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda row: row.replace(",fine,", ",warning,", 1),  # 種類不在約定值
        lambda row: row.replace("2026-01-27", "2026/01/27", 1),  # 日期不是 ISO
        lambda row: row.replace(",6000,", ",六千,", 1),  # 金額不是數字
        lambda row: row.replace(",operator,", ",boss,", 1),  # 對象類別不在約定值
    ],
)
def test_a_csv_with_bad_values_is_a_format_error(mutate):
    rows = pen.parse_penalty_file(penalty_files()["高雄市私立常春藤幼兒園"], "高雄市私立常春藤幼兒園").rows
    text = pen.rows_to_csv(rows)
    broken = text.replace(text.splitlines()[1], mutate(text.splitlines()[1]), 1)
    assert broken != text
    with pytest.raises(PenaltyFormatError):
        pen.parse_csv(broken)


def test_a_csv_without_the_expected_columns_is_a_format_error():
    with pytest.raises(PenaltyFormatError):
        pen.parse_csv("<html>error</html>")
