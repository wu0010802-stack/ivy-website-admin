"""國小一年級人數（2026-10-20 招生潛力與市佔率規格 §3.3）：教育部統計處校別資料（basec）新舊兩種格式的解析、
檔案匯入、自動同步（還沒公布的學年回 404 不算錯、30 天看一次、中途失敗隔天接著補、筆數太少不換版）、
設定、CLI 與打包檔。HTTP 一律用 MockTransport，不連外。

fixtures 是真實檔案（stats.moe.gov.tw，2026-10-20 下載）裡的三列加原表頭：高雄市光武國小、鳳山國小，加一所臺南市的學校
（要被篩掉）；107 學年是舊格式（沒有「學年度」「鄉鎮市區」），114 學年是新格式。"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app import cli
from app.admissions.geo import elementary as elementary_io
from app.admissions.geo import school_districts, sync
from app.admissions.geo.bundle import BundleFile, open_bundle, write_bundle
from app.admissions.geo.models import GeoDatasetStatus, GeoElementaryGrade1
from app.cli import geo_sync_command, geo_sync_options
from app.config import Settings
from tests.geo_helpers import FIXTURES

OLD_FIXTURE = FIXTURES / "moe-basec-107.csv"
NEW_FIXTURE = FIXTURES / "moe-basec-114.csv"
GUANGWU = "553610"  # 市立光武國小
FENGSHAN = "124601"  # 市立鳳山國小
TODAY = date(2026, 10, 20)  # 115 學年；校別資料最新到 114 學年
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_geo_bundle.py"


@pytest.fixture
def few_schools(monkeypatch):
    """樣本只有兩所高雄的學校；自動同步的下限降到 1。"""
    monkeypatch.setattr(elementary_io, "MIN_ROWS", 1)


@pytest.fixture
def october(monkeypatch):
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


def _text(path: Path) -> str:
    return path.read_bytes().decode("utf-8-sig")


def _file(tmp_path: Path, name: str, source: Path = NEW_FIXTURE, *, transform=None) -> Path:
    """fixture 存成 name（可改內容）；檔名決定學年。"""
    content = source.read_bytes() if transform is None else transform(_text(source)).encode("utf-8")
    path = tmp_path / name
    path.write_bytes(content)
    return path


def _by_code(rows: list[elementary_io.Grade1Row]) -> dict[str, elementary_io.Grade1Row]:
    return {row.school_code: row for row in rows}


def _site(published: dict[int, bytes]):
    """假的教育部統計處：published 是「學年 → 檔案內容」，其他學年回 404（和真的一樣是一小段 HTML）。"""
    seen: list[str] = []
    urls = {elementary_io.url_for(elementary_io.URL_TEMPLATE, year): body for year, body in published.items()}

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        if url in urls:
            return httpx.Response(200, content=urls[url], headers={"content-type": "application/octet-stream"})
        return httpx.Response(404, text="<html>404</html>", headers={"content-type": "text/html"})

    return httpx.MockTransport(handle), seen


def _url(year: int) -> str:
    return elementary_io.url_for(elementary_io.URL_TEMPLATE, year)


async def _sync(app, transport, *, now: datetime | None = None, force: bool = False) -> tuple[str, int]:
    async with httpx.AsyncClient(transport=transport) as client:
        return await sync.sync_elementary(
            app.state.session_factory, app.state.settings, client,
            now=now or datetime.now(timezone.utc), force=force, files=None,
        )


def _a_month_later() -> datetime:
    """匯入檔案剛記過確認時間；要走自動同步的測試用這個時間，過了 30 天才會到期。"""
    return datetime.now(timezone.utc) + timedelta(days=31)


async def _import(app, *files: Path) -> tuple[str, int]:
    return await sync.sync_elementary(
        app.state.session_factory, app.state.settings, None, now=datetime.now(timezone.utc), force=False, files=list(files)
    )


async def _status(app) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, "elementary")


@dataclass(frozen=True)
class Stored:
    grade1: int
    school_name: str


async def _table(app) -> dict[tuple[int, str], Stored]:
    """(學年, 學校代碼) → 存的內容；換成不可變的值，前後比對不受 ORM 物件身分影響。"""
    async with app.state.session_factory() as db:
        return {
            (row.school_year, row.school_code): Stored(row.grade1, row.school_name)
            for row in (await db.execute(select(GeoElementaryGrade1))).scalars()
        }


async def _years(app) -> dict[int, int]:
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(GeoElementaryGrade1.school_year, func.count()).group_by(GeoElementaryGrade1.school_year))).all()
    return {year: count for year, count in rows}


# ---- 解析 ----


def test_parse_old_format():
    """107 學年：沒有「學年度」「鄉鎮市區」兩欄；光武一年級男 111＋女 115。"""
    assert "學年度" not in _text(OLD_FIXTURE).splitlines()[0]
    rows = elementary_io.parse_basec(_text(OLD_FIXTURE), school_year=107)
    assert [row.school_code for row in rows] == [FENGSHAN, GUANGWU]  # 臺南那所被篩掉，依代碼排
    assert _by_code(rows)[GUANGWU] == elementary_io.Grade1Row(GUANGWU, "市立光武國小", 226)
    assert _by_code(rows)[FENGSHAN].grade1 == 34 + 40


def test_parse_new_format():
    """114 學年：前面多「學年度」、後面多「鄉鎮市區」，欄位位置全移位；光武男 106＋女 72。"""
    assert _text(NEW_FIXTURE).splitlines()[0].startswith("學年度,縣市代碼,縣市名稱,鄉鎮市區,")
    rows = elementary_io.parse_basec(_text(NEW_FIXTURE), school_year=114)
    assert [row.school_code for row in rows] == [FENGSHAN, GUANGWU]
    assert _by_code(rows)[GUANGWU].grade1 == 178
    assert _by_code(rows)[FENGSHAN].grade1 == 37 + 29


def test_the_bom_is_stripped_whether_or_not_the_caller_decoded_it():
    raw = NEW_FIXTURE.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")  # fixture 真的帶 BOM
    assert elementary_io.parse_basec(raw.decode("utf-8"), school_year=114) == elementary_io.parse_basec(
        elementary_io.decode(raw), school_year=114
    )


def test_fixture_codes_are_schools_in_the_district_table():
    """學校代碼和學區檔（schools()）同一套 6 碼，之後才串得起來。"""
    schools = school_districts.schools()
    assert {GUANGWU, FENGSHAN} <= set(schools)
    assert schools[GUANGWU].name == "光武國小"


def test_year_mismatch_rejected():
    with pytest.raises(ValueError, match="學年度不是 113"):
        elementary_io.parse_basec(_text(NEW_FIXTURE), school_year=113)


def test_missing_header_rejected():
    text = _text(NEW_FIXTURE).replace("1年級女學生數", "女學生數", 1)
    with pytest.raises(ValueError, match="國小校別資料缺欄位：1年級女學生數"):
        elementary_io.parse_basec(text, school_year=114)
    html = "<html><body>系統維護中</body></html>"
    with pytest.raises(ValueError, match="國小校別資料缺欄位：縣市名稱、學校代碼、學校名稱、1年級男學生數、1年級女學生數"):
        elementary_io.parse_basec(html, school_year=114)
    with pytest.raises(ValueError, match="空的"):
        elementary_io.parse_basec("", school_year=114)


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        (",106,72,", ",一百,72,", "不是非負整數"),
        (",106,72,", ",106,-3,", "不是非負整數"),
        (",106,72,", ",106,,", "不是非負整數"),
        ("114,50,高雄市,三民區,553610,", "114,50,高雄市,三民區,5536100,", "學校代碼"),
        ("114,12,高雄市,鳳山區,124601,", "114,12,高雄市,鳳山區,553610,", "重複的學校代碼：553610"),
    ],
)
def test_bad_values_rejected(old, new, message):
    text = _text(NEW_FIXTURE)
    assert old in text
    with pytest.raises(ValueError, match=message):
        elementary_io.parse_basec(text.replace(old, new, 1), school_year=114)


def test_a_short_row_is_rejected_and_blank_lines_are_skipped():
    lines = _text(NEW_FIXTURE).splitlines()
    with pytest.raises(ValueError, match="欄位不足"):
        elementary_io.parse_basec("\r\n".join([*lines, "114,50,高雄市"]), school_year=114)
    assert len(elementary_io.parse_basec("\r\n".join([*lines, "", ",,,"]), school_year=114)) == 2


def test_thousands_separators_and_long_names_are_handled():
    long_name = "市立" + "很長的校名" * 10
    text = _text(OLD_FIXTURE).replace("市立光武國小", long_name, 1).replace(",111,115,", ',"1,111",115,', 1)
    row = _by_code(elementary_io.parse_basec(text, school_year=107))[GUANGWU]
    assert (row.grade1, len(row.school_name)) == (1111 + 115, elementary_io.LEN_NAME)


def test_require_rows():
    one = elementary_io.parse_basec(_text(NEW_FIXTURE), school_year=114)[:1]
    elementary_io.require_rows(one)
    with pytest.raises(ValueError, match="沒有高雄市"):
        elementary_io.require_rows([])
    with pytest.raises(ValueError, match="只有 1 所高雄市的學校，少於 200 所"):
        elementary_io.require_rows(one, minimum=200)


def test_year_of_filename():
    assert elementary_io.year_of_filename("114_basec.csv") == 114
    assert elementary_io.year_of_filename("107_BASEC.CSV") == 107
    for name in ("basec.csv", "114_basec.csv.bak", "114-basec.csv", "1140_basec.csv", "14_basec.csv", "114_basec.xlsx", ""):
        with pytest.raises(ValueError, match="114_basec.csv"):
            elementary_io.year_of_filename(name)


def test_years_to_fetch_runs_from_the_year_after_the_latest_to_the_year_before_the_current_one():
    assert elementary_io.years_to_fetch(None, 115) == [107, 108, 109, 110, 111, 112, 113, 114]
    assert elementary_io.years_to_fetch(112, 115) == [113, 114]
    assert elementary_io.years_to_fetch(114, 115) == []  # 已經是前一學年：只記確認
    assert elementary_io.years_to_fetch(114, 116) == [115]
    assert elementary_io.years_to_fetch(114, 115, force=True) == [114]  # force：最新那一學年重抓
    assert elementary_io.years_to_fetch(None, 107) == []


# ---- 檔案匯入與狀態 ----


async def test_file_import_and_status(app, tmp_path: Path):
    """--elementary-file：學年取檔名，兩學年一起匯入；不連外，也不受自動同步下限（200 所）限制。"""
    files = [_file(tmp_path, "114_basec.csv"), _file(tmp_path, "107_basec.csv", OLD_FIXTURE)]

    def must_not_be_called(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 被叫到就是錯
        raise AssertionError(f"不應連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(must_not_be_called)) as client:
        result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, elementary_files=files, client=client)
    assert (result.elementary, result.elementary_version, result.elementary_years) == ("updated", "114", 2)
    assert (result.doorplates, result.population, result.income, result.september) == ("skipped",) * 4
    assert await _years(app) == {107: 2, 114: 2}
    table = await _table(app)
    assert (table[107, GUANGWU].grade1, table[114, GUANGWU].grade1) == (226, 178)
    assert table[114, GUANGWU].school_name == "市立光武國小"
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("114", "114", None)
    assert status.synced_at is not None and status.checked_at is not None


async def test_importing_a_year_again_replaces_the_whole_year(app, tmp_path: Path):
    assert await _import(app, _file(tmp_path, "114_basec.csv"), _file(tmp_path, "107_basec.csv", OLD_FIXTURE)) == ("updated", 2)

    def only_guangwu(text: str) -> str:
        lines = text.splitlines()
        return "\r\n".join(lines[:2]).replace(",106,72,", ",110,70,") + "\r\n"

    assert await _import(app, _file(tmp_path, "114_basec.csv", transform=only_guangwu)) == ("updated", 1)
    assert await _years(app) == {107: 2, 114: 1}  # 鳳山不會殘留，107 學年不動
    assert (await _table(app))[114, GUANGWU].grade1 == 180


async def test_importing_an_older_year_keeps_the_latest_as_the_status_label(app, tmp_path: Path):
    await _import(app, _file(tmp_path, "114_basec.csv"))
    await _import(app, _file(tmp_path, "107_basec.csv", OLD_FIXTURE))
    assert (await _status(app)).label == "114"


@pytest.mark.parametrize(
    ("names", "message"),
    [
        (["elementary.csv"], "114_basec.csv"),  # 檔名沒有學年
        (["113_basec.csv"], "學年度不是 113"),  # 內容是 114 學年
        (["114_basec.csv", "114_basec.csv"], "114 學年給了兩個檔"),
    ],
)
async def test_a_bad_file_fails_and_nothing_is_written(app, tmp_path: Path, names, message):
    files = []
    for index, name in enumerate(names):
        folder = tmp_path / str(index)
        folder.mkdir()
        files.append(_file(folder, name))
    assert await _import(app, *files) == ("failed", 0)
    assert message in (await _status(app)).last_error
    assert await _years(app) == {}


async def test_one_bad_file_among_good_ones_writes_none_of_them(app, tmp_path: Path):
    good = _file(tmp_path, "107_basec.csv", OLD_FIXTURE)
    bad = _file(tmp_path, "114_basec.csv", transform=lambda text: text.replace("1年級男學生數", "男學生數", 1))
    assert await _import(app, good, bad) == ("failed", 0)
    assert "缺欄位" in (await _status(app)).last_error
    assert await _years(app) == {}


async def test_a_file_without_kaohsiung_rows_fails_and_keeps_the_old_year(app, tmp_path: Path):
    await _import(app, _file(tmp_path, "114_basec.csv"))
    nobody = _file(tmp_path, "114_basec.csv", transform=lambda text: text.replace("高雄市", "臺南市"))
    assert await _import(app, nobody) == ("failed", 0)
    assert "沒有高雄市" in (await _status(app)).last_error
    assert await _years(app) == {114: 2}


# ---- 自動同步 ----


async def test_auto_sync_from_an_empty_table_fetches_107_to_the_year_before_the_current_one(app, few_schools, october):
    old, new = OLD_FIXTURE.read_bytes(), NEW_FIXTURE.read_bytes()
    transport, seen = _site({**{year: old for year in range(107, 114)}, 114: new, 115: new})
    now = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)
    assert await _sync(app, transport, now=now) == ("updated", 8)
    assert seen == [_url(year) for year in range(107, 115)]  # 115 學年還沒到「前一學年」，不抓
    assert await _years(app) == {year: 2 for year in range(107, 115)}
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("114", "114", None)
    assert (status.synced_at, status.checked_at) == (now, now)
    assert (await _table(app))[114, GUANGWU].grade1 == 178


async def test_auto_sync_only_fetches_the_years_after_the_latest(app, few_schools, october, tmp_path: Path):
    await _import(app, _file(tmp_path, "112_basec.csv", OLD_FIXTURE))
    transport, seen = _site({113: OLD_FIXTURE.read_bytes(), 114: NEW_FIXTURE.read_bytes()})
    assert await _sync(app, transport, now=_a_month_later()) == ("updated", 2)
    assert seen == [_url(113), _url(114)]
    assert await _years(app) == {112: 2, 113: 2, 114: 2}


async def test_auto_sync_skips_unpublished(app, few_schools, october, tmp_path: Path):
    """教育部還沒公布 114 學年（404）：不是錯誤，不寫 last_error，舊的 113 學年原封不動。"""
    await _import(app, _file(tmp_path, "113_basec.csv", OLD_FIXTURE))
    before = await _table(app)
    now = _a_month_later()
    transport, seen = _site({})
    assert await _sync(app, transport, now=now) == ("skipped", 0)
    assert seen == [_url(114)]
    status = await _status(app)
    assert (status.last_error, status.active_version, status.checked_at) == (None, "113", now)
    assert status.last_attempt_at == now
    assert await _table(app) == before


async def test_a_missing_year_in_the_middle_does_not_stop_the_later_ones(app, few_schools, october):
    transport, seen = _site({year: OLD_FIXTURE.read_bytes() for year in (107, 109, 110, 111, 112, 113)} | {114: NEW_FIXTURE.read_bytes()})
    assert await _sync(app, transport) == ("updated", 7)
    assert await _years(app) == {107: 2, 109: 2, 110: 2, 111: 2, 112: 2, 113: 2, 114: 2}
    assert len(seen) == 8


async def test_auto_sync_up_to_date_only_records_a_check(app, few_schools, october, tmp_path: Path):
    await _import(app, _file(tmp_path, "114_basec.csv"))
    now = _a_month_later()
    transport, seen = _site({})
    assert await _sync(app, transport, now=now) == ("skipped", 0)
    assert seen == []  # 表裡已經有前一學年：不連外
    assert (await _status(app)).checked_at == now


async def test_auto_sync_looks_again_only_after_30_days(app, few_schools, october):
    t0 = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)
    transport, seen = _site({})
    assert await _sync(app, transport, now=t0) == ("skipped", 0)
    first_round = len(seen)
    assert first_round == 8  # 空表從 107 一路試到 114，全部 404
    assert await _sync(app, transport, now=t0 + timedelta(days=29, hours=23)) == ("skipped", 0)
    assert len(seen) == first_round
    assert await _sync(app, transport, now=t0 + timedelta(days=30)) == ("skipped", 0)
    assert len(seen) == 2 * first_round


async def test_auto_sync_does_nothing_without_a_client_or_files(app, few_schools, october):
    assert await sync.sync_elementary(
        app.state.session_factory, app.state.settings, None, now=datetime.now(timezone.utc), force=True, files=None
    ) == ("skipped", 0)
    assert await _status(app) is None


async def test_force_downloads_the_latest_year_again(app, few_schools, october, tmp_path: Path):
    await _import(app, _file(tmp_path, "114_basec.csv"))
    corrected = NEW_FIXTURE.read_bytes().decode("utf-8-sig").replace(",106,72,", ",106,80,").encode("utf-8")
    now = datetime.now(timezone.utc)
    transport, seen = _site({114: corrected})
    assert await _sync(app, transport, now=now) == ("skipped", 0)  # 匯入剛記過確認時間，還沒到 30 天：不連外
    assert seen == []
    assert await _sync(app, transport, now=now, force=True) == ("updated", 1)
    assert seen == [_url(114)]
    assert (await _table(app))[114, GUANGWU].grade1 == 186


async def test_too_few_rows_kept_old(app, october, tmp_path: Path):
    """下限（200 所）沒降：網路抓到的檔只有兩所高雄的學校，不換版、寫 last_error，舊的 114 學年原封不動。"""
    await _import(app, _file(tmp_path, "114_basec.csv"))
    before = await _table(app)
    changed = NEW_FIXTURE.read_bytes().decode("utf-8-sig").replace(",106,72,", ",1,1,").encode("utf-8")
    transport, _ = _site({114: changed})
    assert await _sync(app, transport, force=True) == ("failed", 0)
    status = await _status(app)
    assert "只有 2 所高雄市的學校，少於 200 所" in status.last_error
    assert status.active_version == "114"
    assert await _table(app) == before


async def test_an_error_page_with_status_200_fails_and_keeps_the_old_year(app, few_schools, october, tmp_path: Path):
    await _import(app, _file(tmp_path, "113_basec.csv", OLD_FIXTURE))
    transport, _ = _site({114: "<html><body>系統訊息</body></html>".encode()})
    assert await _sync(app, transport, now=_a_month_later()) == ("failed", 0)
    status = await _status(app)
    assert status.active_version == "113" and "缺欄位" in status.last_error
    assert await _years(app) == {113: 2}


async def test_a_year_that_is_not_the_one_asked_for_is_refused(app, few_schools, october, tmp_path: Path):
    """網址的 114 學年檔裡寫的學年度是別的：不收（抓錯檔）。"""
    await _import(app, _file(tmp_path, "113_basec.csv", OLD_FIXTURE))
    wrong = NEW_FIXTURE.read_bytes().decode("utf-8-sig").replace("114,", "113,").encode("utf-8")
    transport, _ = _site({114: wrong})
    assert await _sync(app, transport, now=_a_month_later()) == ("failed", 0)
    assert "學年度不是 114" in (await _status(app)).last_error
    assert await _years(app) == {113: 2}


async def test_a_server_error_midway_keeps_the_years_written_and_resumes_the_next_day(app, few_schools, october):
    body = OLD_FIXTURE.read_bytes()
    t0 = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)
    flaky = {"down": True}
    transport, seen = _site({year: body for year in range(107, 115)})

    async def handle(request: httpx.Request) -> httpx.Response:
        if flaky["down"] and str(request.url) == _url(109):
            return httpx.Response(500, text="oops")
        return await transport.handle_async_request(request)

    assert await _sync(app, httpx.MockTransport(handle), now=t0) == ("failed", 2)
    status = await _status(app)
    assert (status.active_version, status.last_error) == ("108", "下載失敗：HTTP 500")
    assert await _years(app) == {107: 2, 108: 2}
    # 整輪沒做完就不記確認時間：隔天（不必等 30 天）從 109 接著補。
    flaky["down"] = False
    seen.clear()
    assert await _sync(app, httpx.MockTransport(handle), now=t0 + timedelta(days=1)) == ("updated", 6)
    assert seen == [_url(year) for year in range(109, 115)]
    status = await _status(app)
    assert (status.active_version, status.last_error) == ("114", None)
    assert await _years(app) == {year: 2 for year in range(107, 115)}


async def test_a_reset_connection_is_retried(app, few_schools, october, tmp_path: Path, monkeypatch):
    waits: list[float] = []

    async def record(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(sync, "_sleep", record)
    await _import(app, _file(tmp_path, "113_basec.csv", OLD_FIXTURE))
    transport, _ = _site({114: NEW_FIXTURE.read_bytes()})
    calls = {"count": 0}

    async def flaky(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] <= 2:
            raise httpx.ReadError("Connection reset by peer", request=request)
        return await transport.handle_async_request(request)

    assert await _sync(app, httpx.MockTransport(flaky), now=_a_month_later()) == ("updated", 1)
    assert waits == [2.0, 4.0]


@pytest.mark.parametrize(
    ("today", "last_year"),
    [
        (date(2026, 7, 31), 113),  # 7 月還是 114 學年
        (date(2026, 8, 1), 114),  # 8/1 起 115 學年
        (date(2027, 1, 31), 114),  # 1 月還是 115 學年
        (date(2027, 2, 1), 114),
        (date(2027, 8, 1), 115),
    ],
)
async def test_the_current_school_year_follows_the_taipei_calendar(app, few_schools, monkeypatch, today, last_year):
    monkeypatch.setattr(sync, "today_local", lambda *args: today)
    transport, seen = _site({})
    await _sync(app, transport)
    assert seen[-1] == _url(last_year)


# ---- 設定 ----


def _settings(**overrides) -> Settings:
    return Settings(
        database_url="postgresql://localhost/ivy_website_dev",
        environment="test",
        test_database_url="postgresql://localhost/ivy_website_test",
        session_secret="test-only-secret",
        **overrides,
    )


def test_the_url_template_default_is_the_one_the_script_uses():
    assert _settings().geo_elementary_url_template == "https://stats.moe.gov.tw/files/detail/{year}/{year}_basec.csv"
    assert _settings().geo_elementary_url_template == elementary_io.URL_TEMPLATE


@pytest.mark.parametrize(
    "template",
    ["http://stats.moe.gov.tw/files/detail/{year}/{year}_basec.csv", "ftp://example.org/{year}.csv", "https://example.org/basec.csv"],
)
def test_the_url_template_must_be_https_and_carry_the_year(template):
    with pytest.raises(ValueError):
        _settings(geo_elementary_url_template=template)


async def test_the_template_from_settings_is_used(app, few_schools, october):
    settings = app.state.settings.model_copy(update={"geo_elementary_url_template": "https://example.org/moe/{year}.csv"})
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        await sync.sync_elementary(
            app.state.session_factory, settings, client, now=datetime.now(timezone.utc), force=False, files=None
        )
    assert seen[0] == "https://example.org/moe/107.csv" and seen[-1] == "https://example.org/moe/114.csv"


# ---- CLI 與打包檔 ----


def test_cli_options_collect_every_elementary_file(tmp_path: Path):
    first, second = _file(tmp_path, "107_basec.csv", OLD_FIXTURE), _file(tmp_path, "114_basec.csv")
    options = geo_sync_options(["--elementary-file", str(first), "--elementary-file", str(second)])
    assert options["elementary_files"] == [first, second]
    assert options["september_files"] is None
    assert geo_sync_options([])["elementary_files"] is None
    with pytest.raises(SystemExit):
        geo_sync_options(["--elementary-file"])
    with pytest.raises(SystemExit):
        geo_sync_options(["--elementary-file", str(tmp_path / "missing_basec.csv")])


async def test_cli_prints_the_elementary_result(app, cli_on_test_app, capsys, tmp_path: Path):
    files = [_file(tmp_path, "107_basec.csv", OLD_FIXTURE), _file(tmp_path, "114_basec.csv")]
    await geo_sync_command(**geo_sync_options([arg for path in files for arg in ("--elementary-file", str(path))]))
    assert "國小一年級人數：updated（最新 114 學年，這次寫入 2 學年）" in capsys.readouterr().out
    assert await _years(app) == {107: 2, 114: 2}


async def test_cli_fails_with_the_reason_when_a_file_is_refused(app, cli_on_test_app, capsys, tmp_path: Path):
    mismatch = _file(tmp_path, "113_basec.csv")  # 內容是 114 學年
    with pytest.raises(SystemExit) as raised:
        await geo_sync_command(**geo_sync_options(["--elementary-file", str(mismatch)]))
    assert raised.value.code == 1
    assert "國小一年級人數同步失敗：國小校別資料的學年度不是 113" in capsys.readouterr().err
    assert await _years(app) == {}


def test_bundle_kind_elementary(tmp_path: Path):
    content = OLD_FIXTURE.read_bytes()
    target = tmp_path / "bundle.zip"
    write_bundle(target, [BundleFile("107_basec.csv", "elementary", "107", _url(107), content)])
    grouped = open_bundle(target, tmp_path / "out")
    assert [path.name for path in grouped["elementary"]] == ["107_basec.csv"]
    assert grouped["elementary"][0].read_bytes() == content


async def test_cli_geo_sync_bundle_with_elementary_files(app, cli_on_test_app, capsys, tmp_path: Path):
    target = tmp_path / "bundle.zip"
    write_bundle(
        target,
        [
            BundleFile("107_basec.csv", "elementary", "107", _url(107), OLD_FIXTURE.read_bytes()),
            BundleFile("114_basec.csv", "elementary", "114", _url(114), NEW_FIXTURE.read_bytes()),
        ],
    )
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    assert await _years(app) == {107: 2, 114: 2}
    assert "國小一年級人數：updated" in capsys.readouterr().out


# ---- 打包腳本 ----


def _load_script():
    spec = importlib.util.spec_from_file_location("fetch_geo_bundle_for_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_the_bundle_script_packs_every_published_elementary_year(few_schools, monkeypatch, capsys):
    script = _load_script()
    monkeypatch.setattr(script, "today_local", lambda *args: TODAY)
    transport, seen = _site({**{year: OLD_FIXTURE.read_bytes() for year in range(107, 114)}, 114: NEW_FIXTURE.read_bytes()})
    async with httpx.AsyncClient(transport=transport) as client:
        files = await script.elementary_files(client)
    assert [(item.path, item.kind, item.period, item.source) for item in files] == [
        (f"{year}_basec.csv", "elementary", str(year), _url(year)) for year in range(107, 115)
    ]
    assert seen == [_url(year) for year in range(107, 115)]
    assert files[-1].content == NEW_FIXTURE.read_bytes()


async def test_the_bundle_script_skips_unpublished_years_and_refuses_bad_files(few_schools, monkeypatch, capsys):
    script = _load_script()
    monkeypatch.setattr(script, "today_local", lambda *args: TODAY)
    transport, _ = _site({114: NEW_FIXTURE.read_bytes()})
    async with httpx.AsyncClient(transport=transport) as client:
        files = await script.elementary_files(client)
    assert [item.path for item in files] == ["114_basec.csv"]
    assert "107 學年" in capsys.readouterr().out
    transport, _ = _site({114: b"<html>error</html>"})
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ValueError, match="缺欄位"):
            await script.elementary_files(client)
