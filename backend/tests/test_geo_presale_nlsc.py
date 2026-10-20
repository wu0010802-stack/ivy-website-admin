"""預售建案的地號座標本機查詢（2026-10-20 預售建案規格 P6）：段名最長前綴、地號 8 碼、JSONP 解析、Referer 與 User-Agent、
只查還沒有的、查無不重查（--retry-missing 才重查）、連續失敗停手、每次請求至少隔 1 秒，以及腳本整支的行為。
網路一律用假回應（MockTransport），不打國土測繪中心。"""

from __future__ import annotations

import importlib.util
import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.admissions.geo import nlsc
from app.admissions.geo import presale_parcels as pp
from tests.test_geo_presale import SAMPLE

TODAY = date(2026, 10, 20)
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_presale_parcels.py"


def _sections_xml(*items: tuple[str, str, str]) -> str:
    body = "".join(
        f"<sectItem><office>{office}</office><officestr>測試</officestr><sectcode>{code}</sectcode><sectstr>{name}</sectstr></sectItem>"
        for office, code, name in items
    )
    return f'<?xml version="1.0" encoding="UTF-8" standalone="no"?><sectItems>{body}</sectItems>'


# 國土測繪中心的假服務：段清單依區碼、地號依（段碼、8 碼地號）回座標，沒帶 Referer 一律回「查無資料」（同真的）。
SECTIONS = {
    "E05": [("DA", "0101", "澄清段二小段"), ("DA", "0102", "澄清段"), ("DA", "0103", "明義段")],
    "E17": [("DE", "0201", "新甲段")],
    "E12": [("DK", "0301", "過埤段")],
    "E14": [("DO", "0401", "仁德段")],
}
YIHUA = (120.3437133, 22.6424556)
PARCELS = {("0103", "00900000"): YIHUA, ("0201", "11180013"): (120.35, 22.7)}


class FakeNlsc:
    def __init__(self, *, fail: bool = False, bad_point: bool = False):
        self.requests: list[httpx.Request] = []
        self.fail = fail
        self.bad_point = bad_point

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            return httpx.Response(503)
        url = httpx.URL(str(request.url))
        if url.host == "api.nlsc.gov.tw":
            town = url.path.rsplit("/", 1)[-1]
            return httpx.Response(200, text=_sections_xml(*SECTIONS.get(town, [])), headers={"content-type": "text/xml"})
        assert url.host == "landmaps.nlsc.gov.tw" and url.path == "/S_Maps/qryTileMapIndex"
        params = url.params
        point = PARCELS.get((params["sect"], params["landno"]))
        if request.headers.get("referer") != nlsc.REFERER or point is None:
            return httpx.Response(200, text='cb([[{"msg":"地號查詢無資料!"}]])')
        cx, cy = (point[1], point[0]) if self.bad_point else point  # bad_point：經緯度對調
        return httpx.Response(200, text=f'cb([[{{"cx":{cx},"cy":{cy},"msg":"ok"}}]])')

    @property
    def parcel_requests(self) -> list[httpx.Request]:
        return [request for request in self.requests if request.url.host == "landmaps.nlsc.gov.tw"]


def _client(fake: FakeNlsc) -> httpx.Client:
    return nlsc.new_client(transport=httpx.MockTransport(fake.handle))


WANTED = [
    ("三民區", "明義段", "90"),  # 有座標
    ("三民區", "澄清段二小段", "75"),  # 查無
    ("仁武區", "新甲段", "1118-13"),  # 有座標（子號 13）
    ("旗津區", "港旗段", "5"),  # 段清單裡沒有這一段
]


def test_town_codes_follow_the_national_order():
    assert (nlsc.town_code("鹽埕區"), nlsc.town_code("三民區"), nlsc.town_code("鳳山區"), nlsc.town_code("那瑪夏區")) == (
        "E01", "E05", "E12", "E38",
    )


def test_sections_and_longest_prefix():
    sections = nlsc.parse_sections(_sections_xml(("DA", "0101", "澄清段二小段"), ("DA", "0102", "澄清段"), ("DA", "0103", "明義段")))
    assert sections["澄清段"] == ("DA", "0102")
    assert nlsc.resolve_section("明義段", sections) == ("DA", "0103")
    # 完全相同優先；沒有完全相同取最長的前綴（「澄清段二小段」比「澄清段」長）。
    assert nlsc.resolve_section("澄清段二小段", sections) == ("DA", "0101")
    assert nlsc.resolve_section("澄清段二小段多出來的字", sections) == ("DA", "0101")
    assert nlsc.resolve_section("澄清段三小段", sections) == ("DA", "0102")
    assert nlsc.resolve_section("不存在段", sections) is None
    assert nlsc.parse_sections("<sectItems><sectItem><office>X</office></sectItem></sectItems>") == {}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('cb([[{"cx":120.34,"cy":22.64,"msg":"ok"}]])', (120.34, 22.64)),
        ('cb([{"cx":"120.34","cy":"22.64"}]);', (120.34, 22.64)),
        ('cb([[{"msg":"地號查詢無資料!"}]])', None),
    ],
)
def test_parse_jsonp(text, expected):
    assert nlsc.parse_jsonp(text) == expected


@pytest.mark.parametrize(
    "text",
    ["<html>blocked</html>", "cb(not json)", "cb([])", 'cb([[{"msg":"系統忙碌"}]])', 'cb([[{"cx":22.6,"cy":120.3}]])', 'cb([[{"cx":"x","cy":"y"}]])'],
)
def test_parse_jsonp_rejects_what_it_does_not_understand(text):
    with pytest.raises(nlsc.NlscError):
        nlsc.parse_jsonp(text)


def test_collect_queries_only_what_is_missing_and_marks_unresolved():
    fake, waits = FakeNlsc(), []
    result = nlsc.collect(_client(fake), WANTED, {}, today=TODAY, delay=1.0, sleep=waits.append)
    assert (result.queried, result.found, result.missing, result.errors) == (3, 2, 1, 0)
    assert result.unresolved == [("旗津區", "港旗段", "5")]
    rows = result.rows
    assert rows[("三民區", "明義段", "90")].lon == YIHUA[0] and rows[("三民區", "明義段", "90")].office == "DA"
    assert rows[("三民區", "澄清段二小段", "75")].lon is None  # 查無：寫空座標
    assert rows[("仁武區", "新甲段", "1118-13")].lat == 22.7
    assert ("旗津區", "港旗段", "5") not in rows
    # 地號 8 碼、Referer 與 User-Agent（不帶帳號）、段清單每區只查一次。
    sent = {request.url.params["landno"] for request in fake.parcel_requests}
    assert sent == {"00900000", "00750000", "11180013"}
    assert all(request.headers["referer"] == nlsc.REFERER for request in fake.parcel_requests)
    assert {request.headers["user-agent"] for request in fake.requests} == {nlsc.USER_AGENT}
    assert "@" not in nlsc.USER_AGENT
    assert sum(request.url.host == "api.nlsc.gov.tw" for request in fake.requests) == 3  # 三民、仁武、旗津
    # 每次請求之後等 1 秒（段清單 3 次＋地號 3 次）。
    assert waits == [1.0] * 6


def test_collect_does_not_requery_known_parcels_unless_retrying_missing():
    first = nlsc.collect(_client(FakeNlsc()), WANTED, {}, today=TODAY, sleep=lambda _: None).rows
    again = FakeNlsc()
    result = nlsc.collect(_client(again), WANTED, first, today=date(2026, 11, 1), sleep=lambda _: None)
    assert result.queried == 0 and again.parcel_requests == [] and result.rows == first
    # 只重查查無的：這次查得到了就更新，已有座標的不動。
    PARCELS[("0101", "00750000")] = (120.4, 22.7)
    try:
        retry = FakeNlsc()
        result = nlsc.collect(_client(retry), WANTED, first, today=date(2026, 11, 1), retry_missing=True, sleep=lambda _: None)
    finally:
        del PARCELS[("0101", "00750000")]
    assert [request.url.params["landno"] for request in retry.parcel_requests] == ["00750000"]
    updated = result.rows[("三民區", "澄清段二小段", "75")]
    assert (updated.lon, updated.lat, updated.fetched_on) == (120.4, 22.7, date(2026, 11, 1))
    assert result.rows[("三民區", "明義段", "90")].fetched_on == TODAY  # 沒重查，日期不變


def test_collect_limit_and_minimum_delay():
    waits: list[float] = []
    result = nlsc.collect(_client(FakeNlsc()), WANTED, {}, today=TODAY, delay=0.0, limit=1, sleep=waits.append)
    assert result.queried == 1 and set(waits) == {nlsc.MIN_DELAY_SECONDS}  # 再小的 delay 也至少 1 秒


def test_collect_stops_after_consecutive_failures_and_records_nothing_for_them():
    wanted = [("三民區", "明義段", str(number)) for number in range(1, 20)]
    fake = FakeNlsc(fail=True)
    result = nlsc.collect(_client(fake), wanted, {}, today=TODAY, sleep=lambda _: None)
    assert result.aborted and result.errors == nlsc.MAX_CONSECUTIVE_ERRORS and result.rows == {}
    # 座標不合理（經緯度對調）也是失敗、不記錄。
    swapped = nlsc.collect(_client(FakeNlsc(bad_point=True)), WANTED[:1], {}, today=TODAY, sleep=lambda _: None)
    assert swapped.errors == 1 and swapped.rows == {}


# ---- 腳本 ----


def _script():
    spec = importlib.util.spec_from_file_location("fetch_presale_parcels", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_script_writes_a_csv_the_importer_accepts_and_resumes(tmp_path: Path, capsys):
    script = _script()
    out = tmp_path / "presale_parcels.csv"
    fake = FakeNlsc()
    code = script.main(
        ["--cases", str(SAMPLE), "--out", str(out)], transport=httpx.MockTransport(fake.handle), sleep=lambda _: None, today=TODAY
    )
    assert code == 0
    rows = {row.key: row for row in pp.parse_csv(out.read_text(encoding="utf-8"))}
    # 樣本 9 案：港旗段、工業段、海城段（沒地號）、澄清段、仁德段、過埤段等不在假服務的段清單裡，查得到的是明義段 90 與新甲段 1118-13。
    assert rows[("三民區", "明義段", "90")].lon == YIHUA[0]
    assert rows[("仁武區", "新甲段", "1118-13")].lon == 120.35
    assert rows[("三民區", "澄清段二小段", "75")].lon is None
    assert "完成：這次查" in capsys.readouterr().out
    # 再跑一次：輸出檔已有的都不再查。
    again = FakeNlsc()
    script.main(["--cases", str(SAMPLE), "--out", str(out)], transport=httpx.MockTransport(again.handle), sleep=lambda _: None, today=TODAY)
    assert again.parcel_requests == []


def test_script_rejects_an_error_page(tmp_path: Path):
    page = tmp_path / "page.csv"
    page.write_text("<html>系統訊息</html>", encoding="utf-8")
    with pytest.raises(SystemExit):
        _script().main(["--cases", str(page), "--out", str(tmp_path / "out.csv")], transport=httpx.MockTransport(FakeNlsc().handle))


def test_script_never_sends_an_account_or_email():
    source = SCRIPT.read_text(encoding="utf-8") + Path(nlsc.__file__).read_text(encoding="utf-8")
    assert "gmail" not in source and "wu0010802" not in source and "@" not in nlsc.USER_AGENT
