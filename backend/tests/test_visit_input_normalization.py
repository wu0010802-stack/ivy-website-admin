"""家長與園方輸入的正規化（2026-11-12 QA L30、L31）：schema 層直接驗，不碰資料庫。

電話：全形數字（０-９）要像全形破折號、空白一樣被轉成半形再驗證，不能回「請填寫 09 開頭的 10 碼」。
生日：下限是「今天（台北）往前 18 年」，早於此就擋（幼兒園 2–6 歲、課後班到國小，只擋明顯打錯的年份）。
官網送單、後台補登、家長改資料、後台改家長資料四個入口規則一致；web/app/utils/visit-form.ts 與
web/tests/visit-form.spec.ts 有同一組案例。"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from pydantic import ValidationError

from app.booking import schemas
from app.booking.schemas import (
    AdminDetailsUpdate,
    ParentDetailsUpdate,
    VisitRequestCreate,
    VisitRequestManualCreate,
    normalize_phone,
)

TODAY = date(2026, 11, 12)


@pytest.fixture
def frozen_today(monkeypatch):
    monkeypatch.setattr(schemas, "today_local", lambda: TODAY)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("０９１２３４５６７８", "0912345678"),
        ("０９１２－３４５－６７８", "0912345678"),  # 全形數字加全形破折號
        ("０９１２　３４５　６７８", "0912345678"),  # 全形數字加全形空白
        ("09１２3４5６7８", "0912345678"),  # 半形與全形混用
        (" 0912-345-678 ", "0912345678"),  # 既有行為不變
        ("0912 345 678", "0912345678"),
        ("0912‐345‑678", "0912345678"),  # U+2010、U+2011 破折號
    ],
)
def test_phone_accepts_fullwidth_digits_and_separators(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "０８１２３４５６７８",  # 08 開頭
        "０９１２３４５６７",  # 9 碼
        "０９１２３４５６７８９",  # 11 碼
        "09１２３４５６７８x",
        "０９①２３４５６７８",  # 圈圈數字不是數字（不要像 NFKC 那樣放寬）
        "０９¹２３４５６７８",  # 上標數字
        "٠٩١٢٣٤٥٦٧٨",  # 阿拉伯-印度數字
    ],
)
def test_phone_still_rejects_everything_else(raw):
    with pytest.raises(ValueError, match="手機號碼格式錯誤"):
        normalize_phone(raw)


def _public(**fields):
    base = dict(
        campus_key="yihua", parent_name="陳媽媽", phone="0912345678", email="parent@example.com",
        slot_id=uuid.uuid4(), config_version=1,
    )
    return VisitRequestCreate(**{**base, **fields})


def _manual(**fields):
    base = dict(campus_key="yihua", parent_name="陳媽媽", phone="0912345678", source="phone", slot_id=uuid.uuid4())
    return VisitRequestManualCreate(**{**base, **fields})


def _parent(**fields):
    return ParentDetailsUpdate(visit_request_id=uuid.uuid4(), expected_version=1, **fields)


def _staff(**fields):
    return AdminDetailsUpdate(expected_version=1, **fields)


ENTRANCES = [_public, _manual, _parent, _staff]


@pytest.mark.parametrize("build", ENTRANCES)
def test_every_entrance_normalizes_fullwidth_phone(build):
    assert build(phone="０９１２－３４５－６７８").phone == "0912345678"


@pytest.mark.parametrize("build", ENTRANCES)
@pytest.mark.parametrize(
    "birthdate, ok",
    [
        ("2008-11-12", True),  # 剛好滿 18 年
        ("2008-11-11", False),  # 再早一天
        ("1900-01-01", False),
        ("0001-01-01", False),
        ("2023-03-02", True),
        ("2026-11-12", True),  # 今天
        ("2026-11-13", False),  # 未來：既有規則不變
    ],
)
def test_child_birthdate_window_is_the_same_for_every_entrance(frozen_today, build, birthdate, ok):
    if ok:
        assert build(child_birthdate=birthdate).child_birthdate == date.fromisoformat(birthdate)
    else:
        with pytest.raises(ValidationError) as caught:
            build(child_birthdate=birthdate)
        assert caught.value.errors()[0]["loc"] == ("child_birthdate",)


@pytest.mark.parametrize("build", ENTRANCES)
def test_birthdate_lower_bound_on_leap_day(monkeypatch, build):
    """今天是 2/29 時，18 年前的 2/29 不存在，下限落在 2/28（不能因此丟例外或多放一天）。"""
    monkeypatch.setattr(schemas, "today_local", lambda: date(2028, 2, 29))
    assert build(child_birthdate="2010-02-28").child_birthdate == date(2010, 2, 28)
    with pytest.raises(ValidationError):
        build(child_birthdate="2010-02-27")


def test_too_old_message_asks_to_check_the_date(frozen_today):
    with pytest.raises(ValidationError) as caught:
        _public(child_birthdate="1900-01-01")
    assert "請確認" in caught.value.errors()[0]["msg"]
