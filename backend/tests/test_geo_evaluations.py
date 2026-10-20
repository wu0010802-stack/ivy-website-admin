"""幼兒園評鑑的搜尋頁解析、換頁表單、TLS 設定與打包 CSV（2026-10-20 規格 §2、C5、C6、C10）。純函式，不連資料庫、不連外。

假頁面由 tests/geo_helpers.py 的 _evaluation_page 造：每個結果區塊都有假的負責人姓名與電話（FAKE_PERSON_NAMES、FAKE_PHONES），
解析結果裡一定不能出現它們。"""

from __future__ import annotations

import ssl
from datetime import date

import pytest

from app.admissions.geo import evaluations as ev
from app.admissions.geo.evaluations import Evaluation, EvaluationFormatError
from tests.geo_helpers import FAKE_PERSON_NAMES, FAKE_PHONES, EvaluationConfig, _evaluation_page


def _page(config: EvaluationConfig | None = None, page: int | None = 1) -> ev.SearchPage:
    return ev.parse_search_page(_evaluation_page(config or EvaluationConfig(), page))


def _span(ident: str, text: str) -> str:
    return f'<span id="{ident}">{text}</span>'


def test_a_result_page_gives_each_school_with_its_evaluation_rows_in_order():
    page = _page()
    assert len(page.schools) == 10 and (page.total_count, page.current_page, page.total_pages) == (25, 1, 3)
    name, evaluations = page.schools[0]
    assert name == "高雄市私立常春藤幼兒園"
    assert evaluations == [
        Evaluation(112, date(2025, 5, 16), "全數指標通過追蹤評鑑"),
        Evaluation(107, date(2018, 10, 11), "全數指標通過基礎評鑑"),
    ]
    assert page.schools[2] == ("高雄市私立保羅幼兒園", [])  # 「評鑑情形：無」
    assert [name for name, _ in _page(page=3).schools][0] == "高雄市私立假資料16幼兒園"
    assert len(_page(page=3).schools) == 5


def test_only_the_three_evaluation_columns_are_read_never_the_charge_or_the_phone():
    pages = [_page(page=number) for number in (1, 2, 3)]
    output = repr(pages) + repr([page.__dict__ for page in pages])
    for secret in (*FAKE_PERSON_NAMES, *FAKE_PHONES, "SECRETSESSION", "負責人", "電話"):
        assert secret not in output


def test_the_form_page_has_the_hidden_fields_and_the_city_list_but_no_schools():
    page = _page(page=None)
    assert page.schools == [] and page.current_page is None and page.total_pages is None
    assert page.hidden == {
        "__VIEWSTATE": "VS-0", "__VIEWSTATEGENERATOR": "1AE246C8", "__VIEWSTATEENCRYPTED": "", "__EVENTVALIDATION": "EV-0",
        "hY": "",
    }
    assert page.city_value() == "18"
    assert page.cities["臺南市"] == "19"


def test_only_whitelisted_hidden_fields_are_kept():
    html = (
        '<input type="hidden" name="__VIEWSTATE" value="a"/><input type="hidden" name="hY" value="b"/>'
        '<input type="hidden" name="secretToken" value="c"/><input type="text" name="__EVENTTARGET" value="d"/>'
    )
    assert ev.parse_search_page(html).hidden == {"__VIEWSTATE": "a", "hY": "b"}


def test_city_value_ignores_the_tai_variant_and_missing_city_is_an_error():
    html = '<select name="ddlCityS"><option value="9">高雄市</option></select><select name="other"><option value="1">高雄市</option></select>'
    assert ev.parse_search_page(html).city_value() == "9"
    assert ev.parse_search_page('<select name="ddlCityS"><option value="1">臺南市</option></select>').cities == {"臺南市": "1"}
    with pytest.raises(EvaluationFormatError, match="找不到縣市選項"):
        ev.parse_search_page('<select name="ddlCityS"><option value="1">臺南市</option></select>').city_value()


def test_the_search_form_carries_the_hidden_fields_and_the_search_conditions():
    form = ev.search_form(_page(page=None), "18")
    assert form == {
        "__VIEWSTATE": "VS-0", "__VIEWSTATEGENERATOR": "1AE246C8", "__VIEWSTATEENCRYPTED": "", "__EVENTVALIDATION": "EV-0",
        "hY": "", "ddlKey": "school_name", "txtKeyNameS": "", "ddlCityS": "18", "ddlAreaS": "", "btnSearch": "搜尋",
    }


def test_the_next_page_form_uses_the_hidden_fields_of_the_page_just_received():
    form = ev.next_page_form(_page(page=2), "18")
    assert form["__VIEWSTATE"] == "VS-2" and form["__EVENTVALIDATION"] == "EV-2"
    assert form["__EVENTTARGET"] == "PageControl1$lbNextPage" and form["__EVENTARGUMENT"] == ""
    assert form["PageControl1$txtPages"] == "2" and form["ddlCityS"] == "18" and form["ddlKey"] == "school_name"
    assert "btnSearch" not in form  # 連結觸發的 postback 不帶搜尋鈕


@pytest.mark.parametrize("page", [ev.SearchPage(), ev.SearchPage(hidden={"__VIEWSTATE": "x"})])
def test_forms_cannot_be_built_from_a_page_without_view_state_or_page_number(page):
    with pytest.raises(EvaluationFormatError):
        ev.next_page_form(page, "18")
    if not page.hidden:
        with pytest.raises(EvaluationFormatError):
            ev.search_form(page, "18")


def test_rows_without_a_valid_year_or_a_result_are_dropped_and_a_bad_date_is_kept_as_none():
    html = (
        _span("GridView1_lblSchName_0", "高雄市私立測試幼兒園")
        + _span("GridView1_GridView11_0_lblSYear_0", "1111") + _span("GridView1_GridView11_0_lblDate_0", "2022/11/30")
        + _span("GridView1_GridView11_0_lblResult_0", "年度不對")
        + _span("GridView1_GridView11_0_lblSYear_1", "112") + _span("GridView1_GridView11_0_lblDate_1", "2025/13/40")
        + _span("GridView1_GridView11_0_lblResult_1", "全數指標通過基礎評鑑")
        + _span("GridView1_GridView11_0_lblSYear_2", "110") + _span("GridView1_GridView11_0_lblDate_2", "2021/11/04")
        + _span("GridView1_GridView11_0_lblResult_2", "   ")
        + _span("GridView1_GridView11_0_lblSYear_3", "109") + _span("GridView1_GridView11_0_lblResult_3", "結" * 200)
    )
    ((name, evaluations),) = ev.parse_search_page(html).schools
    assert name == "高雄市私立測試幼兒園"
    assert evaluations == [Evaluation(112, None, "全數指標通過基礎評鑑"), Evaluation(109, None, "結" * 100)]


def test_nested_tags_and_entities_inside_a_captured_span_are_read_as_text():
    html = _span("GridView1_lblSchName_0", "高雄市<span class='x'>私立</span>測試 &amp; 幼兒園") + _span("PageControl1_lblCurrentPage", "<b> 7 </b>")
    page = ev.parse_search_page(html)
    assert page.schools == [("高雄市私立測試 & 幼兒園", [])] and page.current_page == 7


def test_a_page_without_any_expected_element_is_empty_not_an_error():
    page = ev.parse_search_page("<html><body>系統維護中</body></html>")
    assert page.schools == [] and page.total_pages is None and page.hidden == {}


def test_evaluation_cells_of_different_blocks_do_not_mix():
    html = (
        _span("GridView1_lblSchName_0", "甲") + _span("GridView1_lblSchName_1", "乙")
        + _span("GridView1_GridView11_1_lblSYear_0", "111") + _span("GridView1_GridView11_1_lblDate_0", "2022/01/02")
        + _span("GridView1_GridView11_1_lblResult_0", "結果乙")
    )
    assert ev.parse_search_page(html).schools == [("甲", []), ("乙", [Evaluation(111, date(2022, 1, 2), "結果乙")])]


def test_the_tls_context_verifies_and_trusts_certifi_plus_the_bundled_intermediate():
    context = ev.ssl_context()
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname is True
    names = {dict(item[0] for item in cert["subject"]).get("commonName") for cert in context.get_ca_certs()}
    assert "TWCA Secure SSL Certification Authority" in names  # 隨程式提交的中繼憑證
    assert "TWCA Global Root CA" in names  # 它的簽發者在 certifi 的根憑證裡
    assert ev.CA_FILE.is_file()


def test_the_bundled_certificate_documents_its_source_and_expiry():
    header = ev.CA_FILE.read_text(encoding="utf-8").split("-----BEGIN CERTIFICATE-----", 1)[0]
    assert "sslserver.twca.com.tw/cacert/secure_sha2_2023G3.crt" in header
    assert "2030-10-16" in header and "SHA-256" in header


def test_csv_round_trip_and_it_has_no_charge_or_phone_column():
    schools = {
        "高雄市私立常春藤幼兒園": [Evaluation(112, date(2025, 5, 16), "全數指標通過追蹤評鑑"), Evaluation(107, None, "全數指標通過基礎評鑑")],
        "高雄市私立保羅幼兒園": [],
    }
    text = ev.rows_to_csv(schools)
    assert text.splitlines()[0] == "school_name,school_year,completed_on,result"
    assert ev.parse_csv(text) == {"高雄市私立常春藤幼兒園": schools["高雄市私立常春藤幼兒園"]}  # 沒有評鑑的園所不寫


@pytest.mark.parametrize(
    "text",
    [
        "<html>error</html>",
        "school_name,school_year,completed_on,result\n甲,1111,2022-01-01,結果\n",
        "school_name,school_year,completed_on,result\n甲,111,2022/01/01,結果\n",
        "school_name,school_year,completed_on,result\n甲,111,2022-01-01,\n",
        "school_name,school_year,completed_on,result\n,111,2022-01-01,結果\n",
    ],
)
def test_a_bad_csv_is_a_format_error(text):
    with pytest.raises(EvaluationFormatError):
        ev.parse_csv(text)
