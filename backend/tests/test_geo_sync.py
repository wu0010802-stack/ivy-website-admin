"""公開地理資料同步（2026-10-08 規格 §7）。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten, RecruitmentVisitGeo
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
from tests.geo_helpers import FIXTURES, add_visit, publish_campus_address

CSV_URL = "https://data.kcg.gov.tw/File/DirectDownload/667aae8f-d427-488b-9420-e51f28783dc3"
DATASET_115 = "https://data.kcg.gov.tw/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414"
DATASET_114 = "https://data.kcg.gov.tw/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3"
KIANG_URL = "https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json"


def _site(*, csv: bytes | None = None, csv_status: int = 200, kiang: bytes | None = None, dataset_115: str | None = None):
    """假的高雄市資料平台＋kiang；回傳 (transport, 請求過的網址清單)。"""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        if url.startswith("https://data.kcg.gov.tw/dataset?keyword="):
            return httpx.Response(200, text=(FIXTURES / "kcg-search.html").read_text(encoding="utf-8"))
        if url == DATASET_115:
            page = dataset_115 if dataset_115 is not None else (FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8")
            return httpx.Response(200, text=page)
        if url == DATASET_114:
            return httpx.Response(200, text=(FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8").replace("115&#x5E74;", "114&#x5E74;"))
        if url == CSV_URL or url == "https://example.org/doorplates.csv":
            body = csv if csv is not None else (FIXTURES / "doorplates-sample.csv").read_bytes()
            return httpx.Response(csv_status, content=body, headers={"content-type": "text/csv"})
        if url == KIANG_URL:
            body = kiang if kiang is not None else (FIXTURES / "preschools-sample.json").read_bytes()
            return httpx.Response(200, content=body, headers={"content-type": "application/json"})
        return httpx.Response(404)

    return httpx.MockTransport(handle), seen


@pytest.fixture
def small_minimum(monkeypatch):
    """樣本只有 73 個門牌；下載的筆數下限降到 1。"""
    monkeypatch.setattr(sync, "MIN_DOORPLATE_ROWS", 1)


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


@pytest.mark.parametrize(
    ("name", "given", "expected"),
    [
        ("kcg_115_10.csv", None, "115-10"),
        ("門牌115年9月.csv", None, "115-09"),
        ("高雄市115年門牌坐標資料_115_10.csv", None, "115-10"),
        ("x.csv", "114-12", "114-12"),
        # 檔名裡不是月份的數字不能被當成月份，找不到有效的就用今天的民國年月
        ("667aae8f-d427-488b-9420-e51f28783dc3.csv", None, "199-12"),
        ("doorplates_2026_10.csv", None, "199-12"),
        ("export-20261008_1.csv", None, "199-12"),
        ("doorplates_115_13.csv", None, "199-12"),
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
            kindergartens_file=FIXTURES / "preschools-sample.json",
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
    result = await run_geo_sync(app.state.session_factory, app.state.settings, kindergartens_file=bom_json)
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
