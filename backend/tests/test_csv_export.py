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
        "﻿姓名,備註\r\n"
        '王小明,"第一行\n第二行，有逗號"\r\n'
        "'=1+1,\r\n"
        '"李""小""華","a,b"\r\n'
    )
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="x-all-20261003.csv"'
    assert resp.headers["cache-control"] == "private, no-store"


def test_csv_attachment_neutralises_header_cells_too():
    resp = csv_export.csv_attachment(("=欄名",), [], "x.csv")
    assert resp.body.decode("utf-8") == "﻿'=欄名\r\n"


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
