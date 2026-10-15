"""托嬰逐所明細：月費、評鑑、準公共（2026-10-15 規格 §4.3、F11）。"""

from __future__ import annotations

import copy
import json
from urllib.parse import quote

import pytest

from app.admissions.geo import babycare
from app.admissions.geo.models import GeoBabycare
from tests.geo_helpers import FIXTURES

DETAIL = json.loads((FIXTURES / "babycare-detail-sample.json").read_text(encoding="utf-8"))


def test_detail_is_parsed():
    detail = babycare.parse_babycare_detail(DETAIL)
    assert (detail.monthly_fee, detail.evaluation_grade, detail.evaluation_year, detail.quasi_public) == (18375, "乙等", 114, True)
    assert detail.fee_note == "平均月費: 18,375元(內含每學期註冊費16,500元＋月費:14,515元＋每月餐點費1,110元)"
    assert set(vars(detail)) == {"monthly_fee", "fee_note", "evaluation_grade", "evaluation_year", "quasi_public"}


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"收費情形": {"日間托育": [{"費用名稱": "其他", "費用金額": "100", "費用說明": "x"}]}}, (None, None)),
        ({"收費情形": {"日間托育": [{"費用名稱": " 托育費 ", "費用金額": "0", "費用說明": " a \n b "}]}}, (None, "a b")),
        ({"收費情形": {"日間托育": [{"費用名稱": "托育費", "費用金額": "abc", "費用說明": ""}]}}, (None, None)),
        ({"收費情形": {}}, (None, None)),
        ({"收費情形": {"日間托育": [{"費用名稱": "托育費", "費用金額": "17,900", "費用說明": "說" * 300}]}}, (17900, "說" * 200)),
    ],
)
def test_fee_and_note(changes, expected):
    data = {**copy.deepcopy(DETAIL), **changes}
    detail = babycare.parse_babycare_detail(data)
    assert (detail.monthly_fee, detail.fee_note) == expected


@pytest.mark.parametrize(
    ("grade", "year", "quasi", "expected"),
    [("　　", "", "", (None, None, None)), ("優等", "99", "否", ("優等", 99, False)), ("很長很長很長很長很長", "114年", "不明", (None, None, None))],
)
def test_grade_year_and_quasi_public(grade, year, quasi, expected):
    data = {**DETAIL, "評鑑等級": grade, "最近一次評鑑年度": year, "準公共資格": quasi}
    detail = babycare.parse_babycare_detail(data)
    assert (detail.evaluation_grade, detail.evaluation_year, detail.quasi_public) == expected


@pytest.mark.parametrize("data", [None, [], "x"])
def test_unexpected_shape_is_rejected(data):
    with pytest.raises(babycare.BabycareFormatError):
        babycare.parse_babycare_detail(data)


def test_detail_url():
    assert babycare.detail_url("CW10112243") == f"{babycare.DETAIL_ROOT}/{quote('高雄市')}/CW10112243.json"


# （DetailSite 與同步測試屬於 5b，本任務不寫。）


async def test_nearby_returns_the_details(db_session):
    from tests.geo_helpers import load_babycare_sample

    await load_babycare_sample(db_session)
    await db_session.execute(GeoBabycare.__table__.update().values(monthly_fee=17900, evaluation_grade="優等", evaluation_year=114, quasi_public=True, fee_note="平均月費"))
    await db_session.commit()
    items = await babycare.nearby(db_session, 22.6424556, 120.3437133, 3000)
    assert (items[0].monthly_fee, items[0].evaluation_grade, items[0].evaluation_year, items[0].quasi_public, items[0].fee_note) == (17900, "優等", 114, True, "平均月費")
