"""幼兒園停辦回補檔的讀取（2026-10-15 規格 §5）。"""

from __future__ import annotations

from datetime import date

import pytest

from app.admissions.geo.closure_backfill import BackfillFormatError, ClosureBackfill, load_closure_backfill

HEADER = "source_id,name,left_on,reason\n"


def _write(tmp_path, body: str, header: str = HEADER):
    path = tmp_path / "closures.csv"
    path.write_text(header + body, encoding="utf-8")
    return path


def test_closed_and_renamed_rows_are_loaded(tmp_path):
    path = _write(tmp_path, "a,甲幼兒園,2026-09-15,closed\nb,乙幼兒園,,closed\nc,丙幼兒園,2026-03-25,renamed\n")
    assert load_closure_backfill(path) == {
        "a": ClosureBackfill("closed", date(2026, 9, 15)),
        "b": ClosureBackfill("closed", None),
        "c": ClosureBackfill("renamed", date(2026, 3, 25)),
    }


@pytest.mark.parametrize(
    "body",
    [
        "a,甲,2026-09-15,gone\n",  # reason 只有 closed、renamed
        "a,甲,2026/09/15,closed\n",  # 日期固定 ISO
        "a,甲,2026-02-30,closed\n",  # 不存在的日期
        ",甲,2026-09-15,closed\n",  # 沒有 source_id
        "a,甲,2026-09-15,closed\na,甲,2026-09-16,closed\n",  # source_id 重複
    ],
    ids=["reason", "slash-date", "bad-date", "no-id", "duplicate"],
)
def test_bad_rows_are_rejected(tmp_path, body):
    with pytest.raises(BackfillFormatError):
        load_closure_backfill(_write(tmp_path, body))


def test_a_different_header_is_rejected(tmp_path):
    with pytest.raises(BackfillFormatError):
        load_closure_backfill(_write(tmp_path, "a,甲,2026-09-15,closed\n", header="id,name,date,reason\n"))


def test_the_shipped_backfill_file_is_well_formed():
    """隨程式提交的那份（scripts/build_kindergarten_closures.py 產生）：讀得進來、日期不在未來、兩個已知案例對得上。"""
    entries = load_closure_backfill()
    assert len(entries) >= 40  # 2026-10-15 產生時 47 筆
    assert all(entry.left_on is None or entry.left_on <= date.today() for entry in entries.values())
    assert entries["a77948d8-5d25-4af9-8d0d-5d82e6c41c13"] == ClosureBackfill("closed", date(2026, 9, 15))  # 童年綠地
    assert entries["e517b294-6109-4c89-a847-07a260585e6c"] == ClosureBackfill("closed", date(2026, 10, 13))  # 愛爾蘭
