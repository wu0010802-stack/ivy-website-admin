"""公開地理資料同步（2026-10-08 規格 §7）。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo import providers, sync
from app.admissions.geo.doorplates import DoorplateParser
from app.admissions.geo.models import (
    GeoDatasetStatus, GeoDoorplate, GeoKindergarten, GeoProviderEvent, RecruitmentVisitGeo,
)
from app.admissions.geo.sync import (
    DoorplateSource,
    GeoSyncBusy,
    GeoSyncError,
    discover_doorplate_source,
    label_for_file,
    parse_dataset_resources,
    parse_dataset_search,
    run_geo_sync,
)
from app.admissions.geo import population as population_io
from app.admissions.geo import village_series as series_io
from app.admissions.geo import income as income_io
from app.admissions.geo import new_homes as new_homes_io
from tests.geo_helpers import (
    FIXTURES,
    REGISTRY_SAMPLE,
    add_visit,
    income_response,
    lock_is_free,
    plvr_response,
    publish_campus_address,
    ris_response,
)

CSV_URL = "https://data.kcg.gov.tw/File/DirectDownload/667aae8f-d427-488b-9420-e51f28783dc3"
DATASET_115 = "https://data.kcg.gov.tw/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414"
DATASET_114 = "https://data.kcg.gov.tw/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3"
KIANG_URL = "https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json"
BABYCARE_URL = "https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json"
REGISTRY_URL = "https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv"


def _site(
    *,
    csv: bytes | None = None,
    csv_status: int = 200,
    kiang: bytes | None = None,
    registry: bytes | None = None,
    registry_status: int = 200,
    babycare: bytes | None = None,
    dataset_115: str | None = None,
    dataset_115_status: int = 200,
    population_months: set[str] | None = None,
):
    """假的高雄市資料平台＋kiang（幼兒園 JSON 與教育部名單）＋托嬰名單＋內政部 ODRP061／011／014＋data.gov.tw 與財政資訊中心（各里所得）＋
    實價登錄季檔（新成屋）；回傳 (transport, 請求過的網址清單)。"""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        if url.startswith("https://data.kcg.gov.tw/dataset?keyword="):
            return httpx.Response(200, text=(FIXTURES / "kcg-search.html").read_text(encoding="utf-8"))
        if url == DATASET_115:
            page = dataset_115 if dataset_115 is not None else (FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8")
            return httpx.Response(dataset_115_status, text=page)
        if url == DATASET_114:
            return httpx.Response(200, text=(FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8").replace("115&#x5E74;", "114&#x5E74;"))
        if url == CSV_URL or url == "https://example.org/doorplates.csv":
            body = csv if csv is not None else (FIXTURES / "doorplates-sample.csv").read_bytes()
            return httpx.Response(csv_status, content=body, headers={"content-type": "text/csv"})
        if url == REGISTRY_URL:
            body = registry if registry is not None else REGISTRY_SAMPLE.read_bytes()
            return httpx.Response(registry_status, content=body, headers={"content-type": "text/csv; charset=utf-8"})
        if url == KIANG_URL:
            body = kiang if kiang is not None else (FIXTURES / "preschools-sample.json").read_bytes()
            return httpx.Response(200, content=body, headers={"content-type": "application/json"})
        if url == BABYCARE_URL:
            body = babycare if babycare is not None else (FIXTURES / "babycare-sample.json").read_bytes()
            return httpx.Response(200, content=body, headers={"content-type": "application/json"})
        population = ris_response(url, months=population_months)
        if population is not None:
            return population
        income = income_response(url)
        if income is not None:
            return income
        new_homes = plvr_response(url)
        if new_homes is not None:
            return new_homes
        return httpx.Response(404)

    return httpx.MockTransport(handle), seen


@pytest.fixture
def small_minimum(monkeypatch):
    """樣本只有 73 個門牌、24 個里的人口與所得、一季 7 筆新成屋；下載的筆數下限都降到 1。"""
    monkeypatch.setattr(sync, "MIN_DOORPLATE_ROWS", 1)
    monkeypatch.setattr(population_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(series_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(income_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(new_homes_io, "MIN_ROWS", 1)


async def _sync(app, transport, **kwargs):
    async with httpx.AsyncClient(transport=transport) as client:
        return await run_geo_sync(app.state.session_factory, kwargs.pop("settings", app.state.settings), client=client, **kwargs)


async def _counts(app) -> tuple[int, int]:
    async with app.state.session_factory() as db:
        return (
            await db.scalar(select(func.count()).select_from(GeoDoorplate)),
            await db.scalar(select(func.count()).select_from(GeoKindergarten)),
        )


async def _status(app, dataset: str) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, dataset)


def test_parse_search_page():
    found = parse_dataset_search((FIXTURES / "kcg-search.html").read_text(encoding="utf-8"))
    assert found[:2] == [(115, "/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414"), (114, "/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3")]
    assert len(found) == 5  # 「高雄市區代碼」不算


def test_parse_dataset_page():
    found = parse_dataset_resources((FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8"))
    assert found == [
        (115, 10, "667aae8f-d427-488b-9420-e51f28783dc3"),
        (115, 9, "222a9251-194a-478f-9ff9-c218da6cec7b"),
        (115, 8, "dce0b155-72fb-48ff-8ca0-3ed74f620a3d"),
    ]


async def test_discover_latest_month():
    transport, _ = _site()
    async with httpx.AsyncClient(transport=transport) as client:
        assert await discover_doorplate_source(client) == DoorplateSource("115-10", CSV_URL)


async def test_discover_falls_back_to_previous_year_early_in_the_year():
    transport, _ = _site(dataset_115="<html><body>尚無資料</body></html>")
    async with httpx.AsyncClient(transport=transport) as client:
        source = await discover_doorplate_source(client)
    assert source.label == "114-10"


async def test_discover_gives_up_without_resources():
    transport, _ = _site(dataset_115="<html></html>")

    def no_114(request):
        if str(request.url) == DATASET_114:
            return httpx.Response(200, text="<html></html>")
        return transport.handle_request(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(no_114)) as client:
        with pytest.raises(GeoSyncError):
            await discover_doorplate_source(client)


async def test_one_page_without_resources_and_one_http_error_is_not_reported_as_http():
    """2026-10-13：最新年度頁打得開但還沒有下載檔、前一年度頁 500——原因是找不到下載檔，
    不是 HTTP 500（只有每一頁都是 HTTP 錯誤時才報狀態碼）。"""
    transport, _ = _site(dataset_115="<html></html>")

    def broken_114(request):
        if str(request.url) == DATASET_114:
            return httpx.Response(500)
        return transport.handle_request(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(broken_114)) as client:
        with pytest.raises(GeoSyncError):
            await discover_doorplate_source(client)


@pytest.mark.parametrize(
    ("name", "given", "expected"),
    [
        ("kcg_115_10.csv", None, "115-10"),
        ("門牌115年9月.csv", None, "115-09"),
        ("門牌115年10月.csv", None, "115-10"),
        ("高雄市115年門牌坐標資料_115_10.csv", None, "115-10"),
        ("x.csv", "114-12", "114-12"),
        # 檔名裡不是月份的數字不能被當成月份，找不到有效的就用今天的民國年月
        ("667aae8f-d427-488b-9420-e51f28783dc3.csv", None, "199-12"),
        ("doorplates_2026_10.csv", None, "199-12"),
        ("export-20261008_1.csv", None, "199-12"),
        ("doorplates_115_13.csv", None, "199-12"),
        # 月份後面接英文字母也不是月份（隨機 GUID 檔名：8-4-4-4-12 的某一段剛好像「123-12」「123-1」）
        ("9f0a-b123-12de-4b5c-8d3e-1a2b3c4d5e6f.csv", None, "199-12"),
        ("9f0a-4b5c-a123-1a2b-8d3e-1a2b3c4d5e6f.csv", None, "199-12"),
        # 年份前面接英文字母可以（「kcg115-10.csv」「report115_10.csv」這類檔名），只排除前面接數字
        ("kcg115-10.csv", None, "115-10"),
        ("report115_10.csv", None, "115-10"),
        # 前面是標點、空白、中文都可以
        ("門牌_115-10.csv", None, "115-10"),
        ("kcg 115年10月.csv", None, "115-10"),
    ],
)
def test_label_for_file(tmp_path, monkeypatch, name, given, expected):
    monkeypatch.setattr(sync, "current_label", lambda: "199-12")
    assert label_for_file(tmp_path / name, given) == expected


@pytest.mark.parametrize("given", ["2026-10", "115-13", "115-00", "115-1", "\uff11\uff11\uff15-\uff11\uff10"])
def test_label_for_file_rejects_bad_label(tmp_path, given):
    with pytest.raises(ValueError) as caught:
        label_for_file(tmp_path / "x.csv", given)
    assert isinstance(caught.value, GeoSyncError)


async def test_first_sync_imports_both_and_second_is_skipped(app, small_minimum):
    transport, seen = _site()
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens, result.doorplate_version) == ("updated", "updated", "115-10")
    assert await _counts(app) == (73, 10)

    seen.clear()
    again = await _sync(app, transport)
    assert (again.doorplates, again.kindergartens, again.rematched) == ("skipped", "skipped", 0)
    assert seen == []  # 30 天內不連外


async def test_same_month_is_not_downloaded_again(app, small_minimum):
    transport, seen = _site()
    await _sync(app, transport)
    async with app.state.session_factory() as db:
        old = datetime.now(timezone.utc) - timedelta(days=31)
        await db.execute(update(GeoDatasetStatus).values(checked_at=old, synced_at=old))
        await db.commit()
    seen.clear()
    result = await _sync(app, transport)
    assert result.doorplates == "skipped"
    assert CSV_URL not in seen  # 只看了搜尋頁與資料集頁
    assert (await _status(app, "doorplates")).checked_at > old


async def test_force_reimports_into_a_new_batch(app, small_minimum):
    transport, _ = _site()
    await _sync(app, transport)
    before = (await _status(app, "doorplates")).active_version
    result = await _sync(app, transport, force=True)
    after = (await _status(app, "doorplates")).active_version
    assert result.doorplates == "updated" and before != after and after.startswith("115-10#")
    assert await _counts(app) == (73, 10)


@pytest.mark.parametrize(
    ("csv", "status", "message"),
    [
        (b"x,y\n1,2\n", 200, "門牌資料的欄位和預期不同"),
        (b"", 500, "下載失敗：HTTP 500"),
    ],
)
async def test_failed_download_keeps_active_version(app, small_minimum, csv, status, message):
    """Review Focus 3：同步中途失敗，使用中的版本照常可查，原因不含地址。"""
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version

    bad, _ = _site(csv=csv, csv_status=status)
    result = await _sync(app, bad, force=True)
    assert (result.doorplates, result.doorplate_version) == ("failed", "115-10")
    status_row = await _status(app, "doorplates")
    assert status_row.active_version == active and status_row.last_error == message
    assert await _counts(app) == (73, 10)


async def test_download_cut_off_midway_keeps_active_version(app, small_minimum, monkeypatch):
    """下載到一半斷線：已寫進資料庫的半個批次清掉，使用中的版本照常，原因只有例外類別名。"""
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version
    sample = (FIXTURES / "doorplates-sample.csv").read_bytes().splitlines(keepends=True)
    rows_in_db_at_cut: list[int] = []

    async def cut_off():
        for line in sample[:11]:  # 標題列加 10 筆
            yield line
        rows_in_db_at_cut.append((await _counts(app))[0])
        raise httpx.ReadError("peer closed connection reading https://data.kcg.gov.tw/File/DirectDownload/x 高雄市三民區義華路68號")

    async def handle(request):
        if str(request.url) == CSV_URL:
            return httpx.Response(200, content=cut_off(), headers={"content-type": "text/csv"})
        return await good.handle_async_request(request)

    real_import = doorplate_io.import_doorplates

    async def small_batches(session_factory, tag, rows, **kwargs):
        return await real_import(session_factory, tag, rows, batch_size=3)

    monkeypatch.setattr(doorplate_io, "import_doorplates", small_batches)
    # 下載中的行收滿一塊才交給執行緒解析：塊也調小，斷線前的 10 筆才會先解析、寫進資料庫。
    monkeypatch.setattr(sync, "FILE_CHUNK_LINES", 3)
    result = await _sync(app, httpx.MockTransport(handle), force=True)
    assert (result.doorplates, result.doorplate_version) == ("failed", "115-10")
    status_row = await _status(app, "doorplates")
    assert status_row.active_version == active
    assert status_row.last_error == "下載或匯入失敗：ReadError"
    assert rows_in_db_at_cut and rows_in_db_at_cut[0] > 73  # 斷線前半個批次真的寫進去過
    assert await _counts(app) == (73, 10)


async def test_row_count_mismatch_before_activation_is_refused(app, small_minimum, monkeypatch):
    """換版前核對資料庫裡的列數：匯入途中有人刪掉這個批次的列，不能換版。"""
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version
    real_import = doorplate_io.import_doorplates
    lost: list[int] = []

    async def lose_rows(session_factory, tag, rows, **kwargs):
        count = await real_import(session_factory, tag, rows, **kwargs)
        async with session_factory() as db:
            deleted = await db.execute(
                delete(GeoDoorplate).where(GeoDoorplate.dataset_version == tag, GeoDoorplate.street == "義華路")
            )
            await db.commit()
        lost.append(deleted.rowcount)
        return count

    monkeypatch.setattr(doorplate_io, "import_doorplates", lose_rows)
    result = await _sync(app, good, force=True)
    assert lost and lost[0] > 0
    assert result.doorplates == "failed"
    status_row = await _status(app, "doorplates")
    assert status_row.active_version == active
    assert status_row.last_error == f"門牌資料匯入後資料庫有 {73 - lost[0]} 筆，應有 73 筆，不換版"
    assert await _counts(app) == (73, 10)


async def test_too_few_rows_is_refused(app, small_minimum, monkeypatch):
    good, _ = _site()
    await _sync(app, good)
    monkeypatch.setattr(sync, "MIN_DOORPLATE_ROWS", 1000)
    result = await _sync(app, good, force=True)
    assert result.doorplates == "failed"
    assert (await _status(app, "doorplates")).last_error == "門牌資料只有 73 筆，少於 1000 筆，不換版"
    assert await _counts(app) == (73, 10)


async def test_broken_kindergarten_feed_does_not_block_doorplates(app, small_minimum):
    transport, _ = _site(kiang=b'{"type": "FeatureCollection", "features": []}')
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens) == ("updated", "failed")
    assert (await _status(app, "kindergartens")).last_error == "幼兒園資料裡沒有高雄市營業中的園所"


async def test_override_url(app, small_minimum):
    transport, seen = _site()
    settings = app.state.settings.model_copy(update={"geo_doorplate_url": "https://example.org/doorplates.csv"})
    result = await _sync(app, transport, settings=settings)
    assert result.doorplates == "updated"
    assert "https://example.org/doorplates.csv" in seen
    assert not any("data.kcg.gov.tw" in url for url in seen)
    assert result.doorplate_version == sync.current_label()


async def test_files_never_touch_the_network(app):
    """CLI 指定檔案：完全不連外、不檢查筆數下限；沒指定的那一種跳過。"""
    def refuse(request):
        raise AssertionError(f"不該連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
        result = await run_geo_sync(
            app.state.session_factory, app.state.settings, client=client,
            doorplates_file=FIXTURES / "doorplates-sample.csv", doorplates_version="115-10",
        )
        assert (result.doorplates, result.kindergartens, result.doorplate_version) == ("updated", "skipped", "115-10")
        result = await run_geo_sync(
            app.state.session_factory, app.state.settings, client=client,
            kindergartens_file=FIXTURES / "preschools-sample.json", kindergartens_registry_file=REGISTRY_SAMPLE,
        )
        assert (result.doorplates, result.kindergartens) == ("skipped", "updated")
    assert await _counts(app) == (73, 10)


async def test_files_without_bom(app, tmp_path):
    plain = tmp_path / "doorplates.csv"
    plain.write_bytes((FIXTURES / "doorplates-sample.csv").read_bytes().removeprefix(b"\xef\xbb\xbf"))
    result = await run_geo_sync(app.state.session_factory, app.state.settings, doorplates_file=plain)
    assert result.doorplates == "updated" and result.doorplate_version == sync.current_label()
    assert (await _counts(app))[0] == 73


async def test_visits_are_rematched_when_doorplates_or_campus_address_change(app, small_minimum):
    async with app.state.session_factory() as db:
        visit_id = (await add_visit(db, address="高雄市三民區義華路74號")).id
        await db.commit()
    transport, _ = _site()
    first = await _sync(app, transport)
    assert first.rematched == 1
    async with app.state.session_factory() as db:
        geo = await db.get(RecruitmentVisitGeo, visit_id)
        assert (geo.village, geo.match_level, geo.distance_m) == ("本揚里", "nearby", None)  # 校址還沒發布

        await publish_campus_address(db, "yihua", "高雄市三民區義華路68號")
    second = await _sync(app, transport)  # 30 天內不下載，但校址變了照樣重算
    assert (second.doorplates, second.rematched) == ("skipped", 1)
    async with app.state.session_factory() as db:
        geo = await db.get(RecruitmentVisitGeo, visit_id)
        assert geo.distance_m == 0


async def test_kindergarten_file_with_bom(app, tmp_path):
    bom_json = tmp_path / "preschools.json"
    bom_json.write_bytes(b"\xef\xbb\xbf" + (FIXTURES / "preschools-sample.json").read_bytes())
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=bom_json, kindergartens_registry_file=REGISTRY_SAMPLE,
    )
    assert (result.doorplates, result.kindergartens) == ("skipped", "updated")
    assert (await _counts(app))[1] == 10


async def test_bad_explicit_doorplate_version_is_recorded_as_failure(app):
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        doorplates_file=FIXTURES / "doorplates-sample.csv", doorplates_version="115-13",
    )
    assert result.doorplates == "failed"
    assert (await _status(app, "doorplates")).last_error == "門牌月份格式要像 115-10"
    assert await _counts(app) == (0, 0)


async def _try_lock(conn) -> bool:
    return await conn.scalar(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": sync.LOCK_KEY})


async def test_second_sync_is_refused_while_another_holds_the_lock(app, small_minimum):
    """兩個同步不能同時進行：後到的什麼都不做（不連外、不動資料）；鎖放開後照常。"""
    transport, seen = _site()
    engine = app.state.session_factory.kw["bind"]
    async with engine.connect() as holder:
        holder = await holder.execution_options(isolation_level="AUTOCOMMIT")
        assert await _try_lock(holder)
        try:
            with pytest.raises(GeoSyncBusy):
                await _sync(app, transport)
            assert seen == []
            assert await _counts(app) == (0, 0)
            assert await _status(app, "doorplates") is None
        finally:
            await holder.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": sync.LOCK_KEY})
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens) == ("updated", "updated")


@pytest.mark.parametrize("csv", [None, b"x,y\n1,2\n"])
async def test_lock_is_released_after_sync(app, small_minimum, csv):
    """成功或失敗，同步結束後別的連線（全新連線，不受同連線可重入影響）拿得到鎖。"""
    transport, _ = _site(csv=csv)
    await _sync(app, transport)
    fresh = create_async_engine(app.state.engine.url, poolclass=NullPool)
    try:
        async with fresh.connect() as other:
            other = await other.execution_options(isolation_level="AUTOCOMMIT")
            assert await _try_lock(other)
            await other.invalidate()  # 關掉這條連線，鎖隨連線釋放
    finally:
        await fresh.dispose()


def _csv_with_bad_lines() -> bytes:
    """樣本門牌加三列壞資料：街路名超長、座標是 nan、號碼是 5000 位數。"""
    header, _, body = (FIXTURES / "doorplates-sample.csv").read_text(encoding="utf-8-sig").partition("\n")
    bad = [
        "64,6400500,本揚里,001," + "甲" * 41 + ",,,,１號,176205.163,2503011.609",
        "64,6400500,本揚里,001,義華路,,,,２號,nan,nan",
        "64,6400500,本揚里,001,義華路,,,," + "３" * 5000 + "號,176205.163,2503011.609",
    ]
    return ("\ufeff" + header + "\n" + "\n".join(bad) + "\n" + body).encode("utf-8")


async def test_bad_doorplate_lines_are_skipped_counted_and_do_not_fail_the_sync(app, tmp_path):
    """以前一列超長 COPY 就失敗、每月同步都卡住；現在略過那幾列，其餘照常換版，略過數放進結果。"""
    path = tmp_path / "doorplates.csv"
    path.write_bytes(_csv_with_bad_lines())
    result = await run_geo_sync(app.state.session_factory, app.state.settings, doorplates_file=path, doorplates_version="115-10")
    assert (result.doorplates, result.doorplate_rows_skipped, result.kindergarten_rows_skipped) == ("updated", 3, 0)
    assert (await _counts(app))[0] == 73
    assert (await _status(app, "doorplates")).last_error is None


async def test_clean_sample_skips_nothing(app):
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        doorplates_file=FIXTURES / "doorplates-sample.csv", doorplates_version="115-10",
        kindergartens_file=FIXTURES / "preschools-sample.json", kindergartens_registry_file=REGISTRY_SAMPLE,
    )
    assert (result.doorplates, result.kindergartens) == ("updated", "updated")
    assert (result.doorplate_rows_skipped, result.kindergarten_rows_skipped) == (0, 0)


async def test_downloaded_doorplates_report_skipped_lines_too(app, small_minimum):
    transport, _ = _site(csv=_csv_with_bad_lines())
    result = await _sync(app, transport)
    assert (result.doorplates, result.doorplate_rows_skipped) == ("updated", 3)
    assert (await _counts(app))[0] == 73


async def test_bad_kindergarten_entries_are_skipped_and_counted(app, tmp_path):
    import json

    data = json.loads((FIXTURES / "preschools-sample.json").read_text(encoding="utf-8"))
    data["features"].append(
        {"properties": {"id": "long", "title": "園" * 121, "reg_docno": "府教字第8號", "city": "高雄市", "town": "三民區", "type": "私立", "is_active": 1},
         "geometry": {"coordinates": [120.3, 22.6]}}
    )
    data["features"].append(
        {"properties": {"id": "far", "title": "遠方", "reg_docno": "府教字第9號", "city": "高雄市", "town": "三民區", "type": "私立", "is_active": 1},
         "geometry": {"coordinates": [0, 0]}}
    )
    path = tmp_path / "preschools.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    registry = tmp_path / "registry.csv"
    long_title = "園" * 121
    registry.write_text(
        REGISTRY_SAMPLE.read_text(encoding="utf-8")
        + f"x,府教字第8號,,{long_title},,高雄市,三民區,私立,[807]某路1號\n"
        + "x,府教字第9號,,遠方,,高雄市,三民區,私立,[807]某路2號\n",
        encoding="utf-8",
    )
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings, kindergartens_file=path, kindergartens_registry_file=registry
    )
    assert (result.kindergartens, result.kindergarten_rows_skipped, result.doorplate_rows_skipped) == ("updated", 2, 0)
    assert (await _counts(app))[1] == 10


# ---- 教育部名單（2026-10-15 規格 §3） ----


async def test_the_registry_decides_which_kindergartens_are_open(app, small_minimum):
    """名單沒有的（即使 kiang 標營業中）不收；名單與 JSON 都從網路抓。"""
    trimmed = "".join(
        line for line in REGISTRY_SAMPLE.read_text(encoding="utf-8").splitlines(keepends=True) if "愛爾蘭" not in line
    )
    transport, seen = _site(registry=trimmed.encode())
    result = await _sync(app, transport)
    assert result.kindergartens == "updated"
    assert REGISTRY_URL in seen and KIANG_URL in seen
    assert (await _counts(app))[1] == 9


@pytest.mark.parametrize(
    ("body", "status", "error"),
    [
        (b"<!DOCTYPE html><html><body>error</body></html>", 200, "教育部幼兒園名單格式不對"),
        (b"", 200, "教育部幼兒園名單格式不對"),
        (b"not found", 404, "下載失敗：HTTP 404"),
    ],
    ids=["錯誤頁", "空檔", "404"],
)
async def test_a_broken_registry_fails_the_kindergarten_sync_and_keeps_the_data(app, small_minimum, body, status, error):
    good, _ = _site()
    await _sync(app, good)
    broken, _ = _site(registry=body, registry_status=status)
    result = await _sync(app, broken, force=True)
    assert result.kindergartens == "failed"
    assert (await _status(app, "kindergartens")).last_error == error
    async with app.state.session_factory() as db:
        open_now = select(func.count()).select_from(GeoKindergarten).where(GeoKindergarten.is_active.is_(True))
        assert await db.scalar(open_now) == 10
        assert await db.scalar(select(func.count()).select_from(GeoProviderEvent)) == 0


async def test_a_truncated_registry_is_refused_by_the_truncation_guard(app, monkeypatch, tmp_path):
    """名單只剩 3 所：營業中少於上次 80%，不換版、沒有一所被標停辦。"""
    monkeypatch.setattr(providers, "TRUNCATION_MIN_PREVIOUS", 5)
    sample_json = FIXTURES / "preschools-sample.json"
    first = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=sample_json, kindergartens_registry_file=REGISTRY_SAMPLE,
    )
    assert first.kindergartens == "updated"
    short = tmp_path / "registry.csv"
    short.write_text("".join(REGISTRY_SAMPLE.read_text(encoding="utf-8").splitlines(keepends=True)[:4]), encoding="utf-8")
    second = await run_geo_sync(
        app.state.session_factory, app.state.settings, kindergartens_file=sample_json, kindergartens_registry_file=short,
    )
    assert second.kindergartens == "failed"
    assert (await _status(app, "kindergartens")).last_error == providers.SHRUNK_MESSAGE
    async with app.state.session_factory() as db:
        open_now = select(func.count()).select_from(GeoKindergarten).where(GeoKindergarten.is_active.is_(True))
        assert await db.scalar(open_now) == 10
        assert await db.scalar(select(func.count()).select_from(GeoProviderEvent)) == 0


async def test_a_registry_file_with_a_bom_is_read(app, tmp_path):
    bom = tmp_path / "registry.csv"
    bom.write_bytes(b"\xef\xbb\xbf" + REGISTRY_SAMPLE.read_bytes())
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=FIXTURES / "preschools-sample.json", kindergartens_registry_file=bom,
    )
    assert result.kindergartens == "updated"
    assert (await _counts(app))[1] == 10


@pytest.mark.parametrize(
    "kwargs",
    [{"kindergartens_file": FIXTURES / "preschools-sample.json"}, {"kindergartens_registry_file": REGISTRY_SAMPLE}],
    ids=["只有 JSON", "只有名單"],
)
async def test_kindergarten_files_must_come_in_pairs(app, kwargs):
    with pytest.raises(ValueError, match="要一起給"):
        await run_geo_sync(app.state.session_factory, app.state.settings, **kwargs)


# ---- 延後項目 D2：轉址、年度退回、log、解鎖、解析、檔案讀取 ----


def _redirecting_client(location: str, seen: list[str]) -> httpx.AsyncClient:
    """用 sync 自己建客戶端的方式（new_client）接上假網站；CSV_URL 轉址到 location。"""
    transport, _ = _site()

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if str(request.url) == CSV_URL:
            return httpx.Response(302, headers={"location": location})
        return transport.handle_request(request)

    return sync.new_client(transport=httpx.MockTransport(handle))


async def test_redirect_to_plain_http_is_refused_before_any_request_is_sent(app, small_minimum):
    """轉址只跟 https：被導到 http 時那一跳根本不送出，同步失敗、使用中的版本不動。"""
    seen: list[str] = []
    async with _redirecting_client("http://data.kcg.gov.tw/File/DirectDownload/x", seen) as client:
        result = await run_geo_sync(app.state.session_factory, app.state.settings, client=client)
    assert result.doorplates == "failed"
    assert not any(url.startswith("http://") for url in seen)
    assert (await _status(app, "doorplates")).last_error == "下載網址不是 https，已拒絕"
    assert await _counts(app) == (0, 10)  # 幼兒園不受影響


async def test_redirect_to_another_https_url_is_followed(app, small_minimum):
    seen: list[str] = []
    async with _redirecting_client("https://example.org/doorplates.csv", seen) as client:
        result = await run_geo_sync(app.state.session_factory, app.state.settings, client=client)
    assert result.doorplates == "updated"
    assert "https://example.org/doorplates.csv" in seen
    assert (await _counts(app))[0] == 73


async def test_new_client_follows_redirects_and_checks_every_hop():
    """客戶端本身（不經同步流程）：第一跳 https 轉第二跳 http 時，第二跳被擋在送出之前。"""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.path == "/a":
            return httpx.Response(302, headers={"location": "https://example.org/b"})
        if request.url.path == "/b":
            return httpx.Response(302, headers={"location": "http://example.org/c"})
        return httpx.Response(200, text="不該到這裡")

    async with sync.new_client(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(GeoSyncError):
            await client.get("https://example.org/a")
    assert seen == ["https://example.org/a", "https://example.org/b"]


async def test_latest_year_page_http_error_falls_back_to_previous_year():
    """年初最新年度的資料集頁還沒上線（404／500）：退回前一年度，不讓整個同步失敗。"""
    for status in (404, 500):
        transport, _ = _site(dataset_115_status=status)
        async with httpx.AsyncClient(transport=transport) as client:
            source = await discover_doorplate_source(client)
        assert source.label == "114-10", status


async def test_every_dataset_page_failing_reports_the_http_status(app, small_minimum):
    transport, _ = _site(dataset_115_status=503)

    def handle(request: httpx.Request) -> httpx.Response:
        if str(request.url) == DATASET_114:
            return httpx.Response(502)
        return transport.handle_request(request)

    result = await _sync(app, httpx.MockTransport(handle))
    assert result.doorplates == "failed"
    assert (await _status(app, "doorplates")).last_error == "下載失敗：HTTP 502"


async def test_fallback_never_downgrades_to_an_older_month_than_the_active_one(app, small_minimum):
    """最新年度頁暫時出錯、退回前一年度時，找到的月份比使用中的舊：不換版、不連去下載，下次再看。"""
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version
    async with app.state.session_factory() as db:
        old = datetime.now(timezone.utc) - timedelta(days=31)
        await db.execute(update(GeoDatasetStatus).values(checked_at=old, synced_at=old))
        await db.commit()

    flaky, seen = _site(dataset_115_status=500)
    result = await _sync(app, flaky, force=True)
    assert result.doorplates == "skipped"
    assert CSV_URL not in seen and not any("DirectDownload" in url for url in seen)
    status_row = await _status(app, "doorplates")
    assert status_row.active_version == active and status_row.label == "115-10"
    assert status_row.checked_at == old  # 沒有確認成功，不能延後下一次檢查


async def test_failures_are_logged_with_traceback(app, small_minimum, caplog):
    """兩種資料的失敗都帶 traceback（狀態列只留例外類別，正式站要靠 log 查原因）。"""
    transport, _ = _site(csv=b"", csv_status=500, kiang=b'{"type": "FeatureCollection", "features": []}')
    with caplog.at_level(logging.WARNING, logger="app.admissions.geo.sync"):
        result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens) == ("failed", "failed")
    failures = {record.getMessage().split("：")[0]: record for record in caplog.records if "同步失敗" in record.getMessage()}
    assert set(failures) == {"門牌資料同步失敗", "幼兒園資料同步失敗"}
    assert all(record.exc_info and record.exc_info[1] is not None for record in failures.values())


class _TrackedStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


async def test_download_stream_is_closed_when_the_import_fails_midway(app, small_minimum, monkeypatch):
    """寫入中途失敗時，下載連線要立刻關掉（不等垃圾回收）。"""
    sample = (FIXTURES / "doorplates-sample.csv").read_bytes().splitlines(keepends=True)
    stream = _TrackedStream(sample)
    good, _ = _site()

    async def handle(request):
        if str(request.url) == CSV_URL:
            return httpx.Response(200, stream=stream, headers={"content-type": "text/csv"})
        return await good.handle_async_request(request)

    real_copy = doorplate_io.copy_doorplates
    real_import = doorplate_io.import_doorplates
    calls: list[int] = []

    async def failing_second_copy(db, tag, batch):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("寫入失敗")
        await real_copy(db, tag, batch)

    async def small_batches(session_factory, tag, rows, **kwargs):
        return await real_import(session_factory, tag, rows, batch_size=3)

    monkeypatch.setattr(doorplate_io, "copy_doorplates", failing_second_copy)
    monkeypatch.setattr(doorplate_io, "import_doorplates", small_batches)
    result = await _sync(app, httpx.MockTransport(handle))
    assert result.doorplates == "failed"
    assert stream.closed


async def test_second_cancellation_during_unlock_does_not_leak_the_lock_into_the_pool(app, monkeypatch):
    """停機取消同步時，解鎖那一步又被取消一次（CancelledError 不是 Exception）：鎖還在連線上，
    連線不能原樣還回連線池，要丟掉。（改前：except Exception 接不到，鎖隨連線回池，之後所有同步都被 Busy 擋掉。）"""
    from sqlalchemy.ext.asyncio import AsyncConnection

    real_execute = AsyncConnection.execute

    async def execute(self, statement, *args, **kwargs):
        if "pg_advisory_unlock" in str(statement):
            raise asyncio.CancelledError
        return await real_execute(self, statement, *args, **kwargs)

    with monkeypatch.context() as patched:
        patched.setattr(AsyncConnection, "execute", execute)
        with pytest.raises(asyncio.CancelledError):
            async with sync._exclusive(app.state.session_factory):
                pass

    # 池裡不能留著還握鎖的連線：同一個 engine 再借連線拿鎖要成功，全新連線也拿得到。
    engine = app.state.session_factory.kw["bind"]
    async with engine.connect() as again:
        again = await again.execution_options(isolation_level="AUTOCOMMIT")
        assert await _try_lock(again)
        await again.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": sync.LOCK_KEY})
    assert await lock_is_free(app)


async def test_cancellation_while_running_releases_the_lock(app):
    """同步進行中被取消（停機逾時）：鎖照常釋放。"""
    entered = asyncio.Event()

    async def hang():
        async with sync._exclusive(app.state.session_factory):
            entered.set()
            await asyncio.sleep(3600)

    task = asyncio.create_task(hang())
    await asyncio.wait_for(entered.wait(), timeout=5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await lock_is_free(app)


def test_dataset_links_are_found_whatever_the_attribute_order():
    page = (
        '<a href="/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414" class="x" '
        'title="高雄市115年門牌坐標資料-TWD97">115</a>'
        "<a title='高雄市114年門牌坐標資料-TWD97' href='/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3'>114</a>"
        '<a href="/DataSet/Detail/7d92ad41-81a0-495e-aa45-3180f2ee72ab" title="高雄市區代碼">不是</a>'
    )
    assert parse_dataset_search(page) == [
        (115, "/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414"),
        (114, "/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3"),
    ]


def test_resource_links_are_found_whatever_the_attribute_order():
    page = (
        '<a href="/Resource/667aae8f-d427-488b-9420-e51f28783dc3" class="fw-bolder" '
        'data-x="1" title="115&#x5E74;10&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;">115年10月</a>'
        '<a title="115年9月門牌坐標資料" class="fw-bolder" href="/Resource/222a9251-194a-478f-9ff9-c218da6cec7b">9</a>'
        '<a title="詳細資料" href="/Resource/222a9251-194a-478f-9ff9-c218da6cec7b">詳細資料</a>'
    )
    assert parse_dataset_resources(page) == [
        (115, 10, "667aae8f-d427-488b-9420-e51f28783dc3"),
        (115, 9, "222a9251-194a-478f-9ff9-c218da6cec7b"),
    ]


async def test_reading_a_file_does_not_block_the_event_loop(tmp_path, monkeypatch):
    """指定本機檔案時，讀檔與解析在執行緒裡分塊做：每一塊之間事件迴圈有機會處理別的工作。
    （改前：整個產生器一個 await 都沒有，其他協程要等到整份讀完。）"""
    monkeypatch.setattr(sync, "FILE_CHUNK_LINES", 10)
    path = tmp_path / "doorplates.csv"
    path.write_bytes((FIXTURES / "doorplates-sample.csv").read_bytes())
    ticks = 0
    done = False

    async def ticker():
        nonlocal ticks
        while not done:
            ticks += 1
            await asyncio.sleep(0)

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0)
    parser = DoorplateParser()
    rows = [row async for row in sync._file_rows(path, parser)]
    done = True
    await task
    assert len(rows) == 73 and parser.skipped == 0
    assert ticks >= 5  # 約 74 行、每塊 10 行：至少 7 次讓出
