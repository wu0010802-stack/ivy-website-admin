"""幼兒園停辦回補檔的讀取（2026-10-15 規格 §5；2026-10-20 招生潛力第二、三波延伸到 2022-08，加名稱、核定、座標、類型）。"""

from __future__ import annotations

from datetime import date

import pytest

from app.admissions.geo.closure_backfill import BACKFILL_FILE, COLUMNS, BackfillFormatError, ClosureBackfill, load_closure_backfill
from app.admissions.geo.models import KINDERGARTEN_KINDS
from app.common.timezones import today_local

HEADER = "source_id,name,left_on,reason,approved_capacity,lat,lng,kind\n"


def _write(tmp_path, body: str, header: str = HEADER):
    path = tmp_path / "closures.csv"
    path.write_text(header + body, encoding="utf-8")
    return path


def test_the_file_name_and_columns_are_the_2026_10_20_ones():
    assert BACKFILL_FILE.name == "kindergarten-closures-20261020.csv"
    assert COLUMNS == ("source_id", "name", "left_on", "reason", "approved_capacity", "lat", "lng", "kind")


def test_rows_with_the_new_columns_are_loaded(tmp_path):
    path = _write(
        tmp_path,
        "a,甲幼兒園,2026-09-15,closed,120,22.6,120.3,private\n"
        "b,乙幼兒園,,closed,,,,\n"
        "c,丙幼兒園,2026-03-25,renamed,60,22.7,120.35,quasi_public\n",
    )
    assert load_closure_backfill(path) == {
        "a": ClosureBackfill("closed", date(2026, 9, 15), "甲幼兒園", 120, 22.6, 120.3, "private"),
        "b": ClosureBackfill("closed", None, "乙幼兒園", None, None, None, None),
        "c": ClosureBackfill("renamed", date(2026, 3, 25), "丙幼兒園", 60, 22.7, 120.35, "quasi_public"),
    }


def test_the_new_fields_default_to_empty_so_existing_callers_keep_working():
    entry = ClosureBackfill("closed", date(2026, 9, 15))
    assert (entry.name, entry.approved_capacity, entry.lat, entry.lng, entry.kind) == ("", None, None, None, None)


@pytest.mark.parametrize("kind", KINDERGARTEN_KINDS)
def test_every_kindergarten_kind_is_accepted(tmp_path, kind):
    entry = load_closure_backfill(_write(tmp_path, f"a,甲,2026-09-15,closed,100,22.6,120.3,{kind}\n"))["a"]
    assert entry.kind == kind


def test_a_capacity_of_zero_is_a_number_not_empty(tmp_path):
    assert load_closure_backfill(_write(tmp_path, "a,甲,2026-09-15,closed,0,,,\n"))["a"].approved_capacity == 0


@pytest.mark.parametrize(
    "body",
    [
        "a,甲,2026-09-15,gone,,,,\n",  # reason 只有 closed、renamed
        "a,甲,2026/09/15,closed,,,,\n",  # 日期固定 ISO
        "a,甲,2026-02-30,closed,,,,\n",  # 不存在的日期
        ",甲,2026-09-15,closed,,,,\n",  # 沒有 source_id
        "a,甲,2026-09-15,closed,,,,\na,甲,2026-09-16,closed,,,,\n",  # source_id 重複
        "a,,2026-09-15,closed,,,,\n",  # 沒有名稱
        "a,甲,2026-09-15,closed,,,,charter\n",  # kind 不在 KINDERGARTEN_KINDS
        "a,甲,2026-09-15,closed,,,,Private\n",  # 大小寫也不行
        "a,甲,2026-09-15,closed,abc,,,\n",  # 核定不是數字
        "a,甲,2026-09-15,closed,-1,,,\n",  # 核定是負數
        "a,甲,2026-09-15,closed,12.5,,,\n",  # 核定不是整數
        "a,甲,2026-09-15,closed,99999999999,,,\n",  # 超出 int4（寫入資料表會失敗）
        "a,甲,2026-09-15,closed,,abc,120.3,\n",  # 緯度不是數字
        "a,甲,2026-09-15,closed,,22.6,abc,\n",  # 經度不是數字
        "a,甲,2026-09-15,closed,,22.6,,\n",  # 只有緯度
        "a,甲,2026-09-15,closed,,,120.3,\n",  # 只有經度
        "a,甲,2026-09-15,closed,,nan,120.3,\n",  # 不是有限數
        "a,甲,2026-09-15,closed,,22.6,inf,\n",
        "a,甲,2026-09-15,closed,,0,0,\n",  # 不在高雄市外框
        "a,甲,2026-09-15,closed,,120.3,22.6,\n",  # 經緯度對調
    ],
    ids=[
        "reason", "slash-date", "bad-date", "no-id", "duplicate", "no-name", "kind", "kind-case", "capacity-text",
        "capacity-negative", "capacity-decimal", "capacity-int4", "lat-text", "lng-text", "lat-only", "lng-only",
        "nan", "inf", "outside", "swapped",
    ],
)
def test_bad_rows_are_rejected(tmp_path, body):
    with pytest.raises(BackfillFormatError):
        load_closure_backfill(_write(tmp_path, body))


@pytest.mark.parametrize(
    "header",
    ["source_id,name,left_on,reason\n", "id,name,date,reason,approved_capacity,lat,lng,kind\n"],
    ids=["old-four-columns", "renamed-columns"],
)
def test_a_different_header_is_rejected(tmp_path, header):
    with pytest.raises(BackfillFormatError):
        load_closure_backfill(_write(tmp_path, "a,甲,2026-09-15,closed,,,,\n", header=header))


def test_a_missing_file_is_a_format_error(tmp_path):
    with pytest.raises(BackfillFormatError, match="找不到 missing.csv"):
        load_closure_backfill(tmp_path / "missing.csv")


# 有日期的停辦（離開教育部名單的台北日期）：scripts/build_kindergarten_closures.py 逐版掃描名單歷史的結果。
DATED_CLOSURES = [
    ("bb07dd39-533c-4d56-b071-6d7a0c9fed7b", date(2025, 8, 22)),  # 亨利
    ("d14ede93-b2e3-4acc-b53c-f636ca838a69", date(2025, 9, 3)),  # 昱賢
    ("8b7fc287-59bc-4be5-8d24-cb0809d57abb", date(2025, 10, 22)),  # 一二三
    ("fa38cb23-cf94-4491-acd2-1b787d8469fe", date(2025, 10, 22)),  # 大寮恆青
    ("d99b7082-bfc6-4f57-8a06-0e6a6401d452", date(2025, 10, 22)),  # 永祥
    ("e3aced84-3b3f-425b-aaae-e45b97b433d3", date(2025, 10, 22)),  # 理幼
    ("68bd3ddc-f6d4-4342-9e70-2b19024b680b", date(2026, 1, 30)),  # 文親
    ("e7f3d804-8e1a-4fc6-984f-43ac636c8c7c", date(2026, 2, 1)),  # 新藝術
    ("70c782e5-a316-4ed3-b316-7291cf28f69c", date(2026, 2, 5)),  # 新創意
    ("2a948331-6793-415d-a44b-a28e28aa27e5", date(2026, 3, 25)),  # 聖愛
    ("5612652e-5519-48fd-b2d2-24b215c0b5e4", date(2026, 4, 1)),  # 小天才
    ("0297d618-865f-4fee-bec8-390cb4ebd086", date(2026, 7, 13)),  # 六龜區新威國小附設
    ("b5ede60c-611e-4a45-b25f-d6d0e09032bb", date(2026, 7, 17)),  # 安倪
    ("a77948d8-5d25-4af9-8d0d-5d82e6c41c13", date(2026, 9, 15)),  # 童年綠地
    ("1f8f0195-04e8-4d0f-aa19-4c9f6d5304ca", date(2026, 10, 8)),  # 時代
    ("e517b294-6109-4c89-a847-07a260585e6c", date(2026, 10, 13)),  # 愛爾蘭
]


def test_the_shipped_backfill_file_is_well_formed():
    """隨程式提交的那份（scripts/build_kindergarten_closures.py 產生）：讀得進來、日期不在未來、10-15 的筆數只增不減。"""
    entries = load_closure_backfill()
    assert len(entries) >= 47  # 2026-10-15 產生時：停辦 33（有日期 16、沒日期 17）、改名 14；10-20 延伸到 2022-08 只會增加
    assert sum(1 for entry in entries.values() if entry.reason == "closed") >= 33
    assert all(entry.left_on is None or entry.left_on <= today_local() for entry in entries.values())


@pytest.mark.parametrize(("source_id", "left_on"), DATED_CLOSURES, ids=[source_id[:8] for source_id, _ in DATED_CLOSURES])
def test_each_dated_closure_in_the_shipped_file_is_pinned(source_id, left_on):
    """10-15 檔的日期以舊檔為準（合併時不被新掃描改掉）。"""
    entry = load_closure_backfill()[source_id]
    assert (entry.reason, entry.left_on) == ("closed", left_on)
