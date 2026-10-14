"""國小學區對照檔的守門（2026-10-14 里的變化規格 §4.5）：隨程式提交的兩個 CSV 和里界檔一致。
里界換版、或換學年的對照檔時，這裡會擋下沒更新好的檔。"""

from __future__ import annotations

import csv
import functools
import importlib.util
import sys
from collections import Counter
from pathlib import Path

import pytest

from app.admissions.geo import boundaries
from app.admissions.geo import school_districts as sd

BACKEND = Path(__file__).resolve().parents[1]


def test_every_village_on_the_boundary_file_has_a_school():
    covered = set(sd.by_village())
    missing = sorted(set(boundaries.village_codes()) - covered)
    assert missing == [], [boundaries.village_names()[code] for code in missing]


def test_every_village_in_the_file_is_on_the_boundary_file_with_the_same_name():
    names = boundaries.village_names()
    for row in csv.DictReader((sd.GEO_DATA / f"school-districts-{sd.SCHOOL_DISTRICT_YEAR}.csv").open(encoding="utf-8")):
        assert names.get(row["village_code"]) == (row["district"], row["village"]), row


def test_every_school_code_is_in_the_school_file():
    assert {item.school_code for item in sd.assignments()} <= set(sd.schools())
    # 每所學校至少有一個里（沒有學區的學校不該在檔裡）。
    assert set(sd.by_school()) == set(sd.schools())


def test_a_village_and_school_appear_once():
    pairs = Counter((item.village_code, item.school_code) for item in sd.assignments())
    assert [pair for pair, count in pairs.items() if count > 1] == []


def test_two_schools_covering_a_whole_village_must_be_a_free_zone():
    for code, items in sd.by_village().items():
        full = [item for item in items if not item.partial]
        if len(full) >= 2:
            assert all(item.free_zone for item in full), (boundaries.village_names()[code], full)


def test_values_are_the_declared_ones():
    assert {school.enrollment for school in sd.schools().values()} <= set(sd.ENROLLMENTS)
    for school in sd.schools().values():
        assert school.name and school.district.endswith("區"), school
        # 分校的代碼是「本校代碼-分校名」，本校要在檔裡。
        if "-" in school.code:
            assert school.code.split("-")[0] in sd.schools(), school


def test_counts_of_the_115_file():
    """115 學年版（2026-10-14 轉出）：241 個學校單位、893 個里；實驗教育 7 校大學區、空間充裕 38 校、總量管制 13 校。"""
    assert len(sd.schools()) == 241
    assert len(sd.by_village()) == 893
    assert Counter(school.enrollment for school in sd.schools().values()) == {
        "district": 183, "spacious": 38, "capped": 13, "open": 7,
    }


@pytest.mark.parametrize(
    ("district", "village", "expected"),
    [
        # 整里一校。
        ("三民區", "本揚里", {("東光國小", False, False)}),
        # 一個里對五所（部分鄰、自由學區）。
        ("仁武區", "高楠里", {("八卦國小", False, True), ("福山國小", False, True), ("文府國小", False, True)}),
        # 115-07 新設的里沿用調整前的里，一律算部分。
        ("仁武區", "八德里", {("八卦國小", True, True), ("灣內國小", True, True)}),
        ("鹽埕區", "北端里", {("壽山國小", False, True), ("河濱國小", False, True)}),
        # 一覽表把里寫在學校所在的區（蚵寮國小寫梓官區頂鹽里），人工改區。
        ("橋頭區", "頂鹽里", {("甲圍國小", True, False), ("蚵寮國小", True, False)}),
        # 「全里」加上部分鄰的自由學區。
        ("楠梓區", "藍田里", {
            ("藍田國小", False, True), ("援中國小", True, True), ("甲圍國小", True, True), ("翠屏國中小", True, True),
        }),
    ],
)
def test_sample_villages(district, village, expected):
    code = boundaries.village_code(district, village)
    got = {(sd.schools()[item.school_code].name, item.partial, item.free_zone) for item in sd.by_village()[code]}
    assert got == expected


def test_same_named_schools_are_different_codes():
    same = Counter(school.name for school in sd.schools().values())
    duplicated = {name for name, count in same.items() if count > 1}
    assert {"民權國小", "中山國小", "成功國小", "中正國小", "忠孝國小", "鼓山國小", "大社國小", "新興國小"} <= duplicated
    for name in duplicated:
        districts = [school.district for school in sd.schools().values() if school.name == name]
        assert len(set(districts)) == len(districts), name


# ---- 轉換腳本（pdfplumber 不是執行期依賴；這裡只測不用 PDF 的文字解析） ----


@functools.lru_cache(maxsize=1)
def _builder():
    """scripts/ 不是套件：照路徑載入（dataclass 要在 sys.modules 裡找得到模組）。"""
    spec = importlib.util.spec_from_file_location("build_school_districts", BACKEND / "scripts" / "build_school_districts.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_builder_splits_items_outside_parentheses_only():
    builder = _builder()
    text = builder.normalize("信德里(1、⏎3-16、18-19、21 鄰)，(17、22-33 鄰，與鎮昌⏎國小自由學區)、德昌里。".replace("⏎", "\n"))
    assert builder.split_items(text) == ["信德里(1、3-16、18-19、21鄰)", "(17、22-33鄰，與鎮昌國小自由學區)", "德昌里"]


def test_builder_parses_villages_segments_and_whole_villages():
    builder = _builder()
    parsed, unknown = builder.parse_items(
        ["中里里", "藍田里全里", "港都里公園路以北(1-2鄰)", "東埔里", "(7-8、10鄰)", "台灣中油公司所屬單位直系子女"]
    )
    assert parsed == [("中里里", ""), ("藍田里", ""), ("港都里", "公園路以北(1-2鄰)"), ("東埔里", "(7-8、10鄰)")]
    assert unknown == ["台灣中油公司所屬單位直系子女"]


@pytest.mark.parametrize(
    ("segment", "full"),
    [
        ("", True),
        ("(與大汕國小自由學區)", True),
        ("(與八卦國小及文府國小自由學區)", True),
        ("(1-8鄰)", False),
        ("(9、25鄰與民族國小自由學區)", False),
        ("(1鄰，與鳳雄國小自由學區)", False),
        ("公園路以北(1-2、6-8鄰)", False),
    ],
)
def test_builder_tells_whole_villages_from_partial_ones(segment, full):
    assert _builder().segment_is_full(segment) is full
