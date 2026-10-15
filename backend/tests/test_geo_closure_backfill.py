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
