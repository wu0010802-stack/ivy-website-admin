"""後台 CSV 下載共用模組（2026-10-03 匯出擴充）：公式注入防護、BOM、附件回應。"""

from __future__ import annotations

import pytest

from app.common import csv_export


@pytest.mark.parametrize(
    "value, expected",
    [
        ("=1+1", "'=1+1"),
        ("+886912345678", "'+886912345678"),
        ("-3", "'-3"),
        ("@SUM(A1)", "'@SUM(A1)"),
        # 試算表會先略過開頭的空白與控制字元再判斷是不是公式。
        ('\t=HYPERLINK("http://x")', '\'\t=HYPERLINK("http://x")'),
        (" +1+1", "' +1+1"),
        ("\r@SUM(A1)", "'\r@SUM(A1)"),
        ("王小明", "王小明"),
        ("0912-345-601", "0912-345-601"),
        ("2026/10/03 14:30", "2026/10/03 14:30"),
        ("", ""),
        (None, ""),
        (3, "3"),
    ],
)
def test_safe_cell_neutralises_formula_starts(value, expected):
    assert csv_export.safe_cell(value) == expected


def test_csv_attachment_writes_bom_crlf_quotes_and_no_store():
    resp = csv_export.csv_attachment(
        ("姓名", "備註"),
        [("王小明", "第一行\n第二行，有逗號"), ("=1+1", None), ('李"小"華', "a,b")],
        "x-all-20261003.csv",
    )
    assert resp.body.decode("utf-8") == (
        "\ufeff姓名,備註\r\n"
        '王小明,"第一行\n第二行，有逗號"\r\n'
        "'=1+1,\r\n"
        '"李""小""華","a,b"\r\n'
    )
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="x-all-20261003.csv"'
    assert resp.headers["cache-control"] == "private, no-store"


def test_csv_attachment_neutralises_header_cells_too():
    resp = csv_export.csv_attachment(("=欄名",), [], "x.csv")
    assert resp.body.decode("utf-8") == "\ufeff'=欄名\r\n"


def test_filename_part_only_keeps_safe_keys():
    assert csv_export.filename_part("yihua") == "yihua"
    assert csv_export.filename_part(None) == "all"
    assert csv_export.filename_part("") == "all"
    assert csv_export.filename_part('yihua"; x') == "all"
    assert csv_export.filename_part("YIHUA") == "all"
    assert csv_export.filename_part("a" * 33) == "all"
    assert csv_export.filename_part("bad", fallback="none") == "bad"
    assert csv_export.filename_part("Bad", fallback="none") == "none"


def test_too_many_rows_says_the_limit_in_chinese():
    exc = csv_export.too_many_rows()
    assert exc.status_code == 422
    assert exc.detail["code"] == "EXPORT_TOO_LARGE"
    assert "10,000" in exc.detail["message"]


def test_too_many_rows_reads_the_limit_at_call_time(monkeypatch):
    monkeypatch.setattr(csv_export, "EXPORT_ROW_LIMIT", 3)
    assert "3 筆" in csv_export.too_many_rows().detail["message"]


def test_bom_is_the_utf8_byte_order_mark():
    # 原始碼裡寫 ﻿ 跳脫而不是實體字元：看不見的字元在 diff 與編輯器裡容易被吃掉。
    assert csv_export.BOM == "﻿"
    assert csv_export.BOM.encode("utf-8") == b"\xef\xbb\xbf"
    assert csv_export.csv_attachment(("a",), [], "x.csv").body.startswith(csv_export.BOM.encode("utf-8"))


@pytest.mark.parametrize(
    "value, expected",
    [
        ("115.09", "115年09月"),
        ("115.10", "115年10月"),
        ("114.12", "114年12月"),
        ("99.01", "99年01月"),
        ("115.9", "115年09月"),
        # 不是「年.月」格式的原樣不動（和前端 rocMonthCsv 一致）。
        ("未填寫", "未填寫"),
        ("", ""),
        (None, ""),
        ("1150.09", "1150.09"),
        ("115.009", "115.009"),
        ("115.09.08", "115.09.08"),
        ("115.09\n", "115.09\n"),
        ("１１５.０９", "１１５.０９"),
    ],
)
def test_roc_month_csv_matches_the_admin_helper(value, expected):
    # 和 admin/src/utils/csv.ts 的 rocMonthCsv 同一條規則：Excel 會把 115.10 轉成數字 115.1。
    assert csv_export.roc_month_csv(value) == expected
