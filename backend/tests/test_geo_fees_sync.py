"""幼兒園收費同步（2026-10-15 規格 §4.2、F6–F10）。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import httpx
import pytest
from sqlalchemy import delete, func, select, update

from app import cli
from app.admissions.geo import fees as fees_io
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenFee
from app.admissions.geo.sync import GeoSyncResult
from app.cli import geo_sync_command, geo_sync_options
from app.workers import geo_loop
from app.workers.geo_loop import GeoSyncLoop
from tests.geo_helpers import FIXTURES, sample_slip
from tests.test_geo_sync import _site, _status, _sync, small_minimum  # noqa: F401


class FeeSite:
    """假的 kiang 收費檔：years 這幾個學年、missing 以外的園所都有檔；overrides[(學年, 園名)] 可換內容；
    errors 的園名回 500。其他網址交給 test_geo_sync 的 _site（門牌、名單、托嬰、人口等）。"""

    def __init__(self, *, years=(114,), missing=(), overrides=None, errors=(), **site):
        self.years, self.missing, self.errors = set(years), set(missing), set(errors)
        self.overrides = dict(overrides or {})
        self.requests: list[tuple[int, str]] = []
        self._base, _ = _site(**site)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        prefix = f"{fees_io.SLIP_ROOT}/slip"
        if not url.startswith(prefix):
            return self._base.handler(request)
        year_text, _, rest = url[len(prefix):].partition("/")
        title = unquote(rest.split("/", 1)[1].removesuffix(".json"))
        year = int(year_text)
        self.requests.append((year, title))
        if title in self.errors:
            return httpx.Response(500)
        if year not in self.years or title in self.missing:
            return httpx.Response(404)
        return httpx.Response(200, json=self.overrides.get((year, title), sample_slip()))

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


async def _fee_count(app) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(GeoKindergartenFee))


async def _active(app) -> list[tuple[str, str]]:
    async with app.state.session_factory() as db:
        rows = await db.execute(
            select(GeoKindergarten.source_id, GeoKindergarten.name).where(GeoKindergarten.is_active.is_(True)).order_by(GeoKindergarten.source_id)
        )
        return [tuple(row) for row in rows]


async def _fee(app, source_id: str, age: int) -> GeoKindergartenFee | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoKindergartenFee, (source_id, age))


async def _age_status(app, dataset: str, days: int) -> None:
    old = datetime.now(timezone.utc) - timedelta(days=days)
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == dataset).values(checked_at=old, synced_at=old))
        await db.commit()


async def test_first_sync_finds_the_latest_year_and_imports_every_active_school(app, small_minimum):
    site = FeeSite(missing={"高雄市私立何嘉仁幼兒園"})
    result = await _sync(app, site.transport)
    assert result.kindergartens == "updated" and result.kindergarten_fees == "updated"
    active = await _active(app)
    with_fee = [name for _, name in active if name != "高雄市私立何嘉仁幼兒園"]
    assert result.kindergarten_fee_schools == len(with_fee)
    assert await _fee_count(app) == 4 * len(with_fee)  # 每所 2–5 歲各一列
    status = await _status(app, "kindergarten_fees")
    assert (status.active_version, status.label, status.last_error) == ("114", "114", None)
    assert result.kindergarten_fees_version == "114"
    assert {year for year, _ in site.requests} == {115, 114}  # 先試目前學年（115）再退一年


async def test_second_sync_within_seven_days_does_not_touch_the_fees(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    site.requests.clear()
    result = await _sync(app, site.transport)
    assert (result.kindergartens, result.kindergarten_fees) == ("skipped", "skipped")
    assert site.requests == []


async def test_fill_in_only_fetches_schools_without_fees_and_keeps_the_others(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    (gone_id, _), (kept_id, kept_name), *_ = await _active(app)
    async with app.state.session_factory() as db:
        await db.execute(delete(GeoKindergartenFee).where(GeoKindergartenFee.source_id == gone_id))
        await db.commit()
    site.overrides[(114, kept_name)] = sample_slip(totals={3: 99999})
    await _age_status(app, "kindergartens", 8)  # 名單到期；收費全量還沒到 30 天
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "updated"
    assert (await _fee(app, gone_id, 3)).semester_total == 89750  # 補回來了
    assert (await _fee(app, kept_id, 3)).semester_total == 89750  # 補缺不覆寫


async def test_full_refresh_after_thirty_days_overwrites(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    (kept_id, kept_name), *_ = await _active(app)
    site.overrides[(114, kept_name)] = sample_slip(totals={3: 99999})
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    await _sync(app, site.transport)
    assert (await _fee(app, kept_id, 3)).semester_total == 99999


async def test_a_new_school_year_replaces_the_whole_table(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    site.years = {114, 115}
    await _age_status(app, "kindergartens", 8)
    await _sync(app, site.transport)
    (source_id, _), *_ = await _active(app)
    assert (await _fee(app, source_id, 3)).school_year == 115
    assert (await _status(app, "kindergarten_fees")).label == "115"


async def test_no_year_found_fails_and_the_next_round_retries_even_if_the_list_is_fresh(app, small_minimum):
    site = FeeSite(years=())
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed"
    assert (await _status(app, "kindergarten_fees")).last_error == "找不到任何學年的收費檔"
    site.years = {114}
    result = await _sync(app, site.transport)
    assert result.kindergartens == "skipped" and result.kindergarten_fees == "updated"  # 從沒匯入過就不等 7 天


async def test_a_full_refresh_that_lost_too_many_schools_keeps_the_old_rows(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "FEES_TRUNCATION_MIN", 2)
    site = FeeSite()
    await _sync(app, site.transport)
    before = await _fee_count(app)
    active = await _active(app)
    site.missing = {name for _, name in active[1:]}  # 只剩一所有檔
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed"
    assert await _fee_count(app) == before
    assert (await _status(app, "kindergarten_fees")).last_error == "有收費的園所比上次少了兩成以上，疑似殘缺，未更新"


async def test_too_many_download_errors_keep_the_old_rows(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    before = await _fee_count(app)
    site.errors = {name for _, name in (await _active(app))[1:]}
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed" and await _fee_count(app) == before
    assert (await _status(app, "kindergarten_fees")).last_error == "收費檔下載錯誤太多，未更新"


async def test_fees_are_not_fetched_when_the_list_failed(app, small_minimum):
    site = FeeSite(kiang=b"not json")
    result = await _sync(app, site.transport)
    assert (result.kindergartens, result.kindergarten_fees) == ("failed", "skipped")
    assert site.requests == []


async def test_running_out_of_time_fails_a_full_refresh(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "FEES_TIME_BUDGET", timedelta(0))
    result = await _sync(app, FeeSite().transport)
    assert result.kindergarten_fees == "failed"
    assert (await _status(app, "kindergarten_fees")).last_error.startswith("收費同步超過")
    assert await _fee_count(app) == 0


async def test_fee_rows_are_inserted_in_chunks(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "FEES_INSERT_CHUNK", 3)  # 正式值避開 asyncpg 32,767 個參數上限
    await _sync(app, FeeSite().transport)
    assert await _fee_count(app) == 4 * len(await _active(app))


async def test_file_mode_never_fetches_fees(app, small_minimum):
    site = FeeSite()
    result = await _sync(app, site.transport, doorplates_file=FIXTURES / "doorplates-sample.csv")
    assert result.kindergarten_fees == "skipped" and site.requests == []


def _insert_blows_up(*args, **kwargs):
    raise RuntimeError("資料庫寫入壞掉")


async def test_a_database_error_while_writing_fails_only_the_fees(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "pg_insert", _insert_blows_up)
    result = await _sync(app, FeeSite().transport)  # 不丟例外：整輪照常回傳
    assert (result.kindergartens, result.kindergarten_fees, result.kindergarten_fee_schools) == ("updated", "failed", 0)
    assert result.kindergarten_fees_version is None
    assert await _fee_count(app) == 0
    assert (await _status(app, "kindergarten_fees")).last_error == "下載或匯入失敗：RuntimeError"


async def test_a_database_error_during_a_full_refresh_keeps_the_old_rows(app, small_minimum, monkeypatch):
    site = FeeSite()
    await _sync(app, site.transport)
    before = await _fee_count(app)
    monkeypatch.setattr(sync, "pg_insert", _insert_blows_up)
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed"
    assert await _fee_count(app) == before  # 整表替換在同一個交易裡，寫到一半壞掉就連刪除一起還原
    assert (await _status(app, "kindergarten_fees")).active_version == "114"


# ---- CLI 與背景迴圈（寫法同 test_geo_babycare_sync.py 的 CLI 段）----


def _patch_cli(app, monkeypatch, result: GeoSyncResult) -> None:
    async def session_factory():
        return app.state.session_factory

    async def fake_run(session_factory, settings, **options):
        return result

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    # cli 若在模組頂端 import run_geo_sync 就換 cli 的；若在函式裡 import 就換 sync 的。兩個都換最保險。
    monkeypatch.setattr(cli, "run_geo_sync", fake_run, raising=False)
    monkeypatch.setattr(sync, "run_geo_sync", fake_run)


async def test_cli_prints_the_fee_result(app, monkeypatch, capsys):
    _patch_cli(app, monkeypatch, GeoSyncResult(
        "skipped", "updated", None, 0, kindergarten_fees="updated", kindergarten_fee_schools=600, kindergarten_fees_version="114",
    ))
    await geo_sync_command(**geo_sync_options([]))
    assert "幼兒園收費：updated（114 學年，這次 600 所）" in capsys.readouterr().out


async def test_cli_exits_1_when_the_fees_failed(app, monkeypatch, capsys):
    async with app.state.session_factory() as db:
        db.add(GeoDatasetStatus(dataset="kindergarten_fees", last_error="找不到任何學年的收費檔"))
        await db.commit()
    _patch_cli(app, monkeypatch, GeoSyncResult("skipped", "updated", None, 0, kindergarten_fees="failed"))
    with pytest.raises(SystemExit) as caught:
        await geo_sync_command(**geo_sync_options([]))
    assert caught.value.code == 1
    assert "幼兒園收費同步失敗：找不到任何學年的收費檔" in capsys.readouterr().err


async def test_the_loop_summarises_a_round_when_only_the_fees_were_updated(app, monkeypatch, caplog):
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        ran.set()
        return GeoSyncResult("skipped", "skipped", None, 0, kindergarten_fees="updated")

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.INFO, logger="app.admissions.geo.loop"):
        loop.start()
        await asyncio.wait_for(ran.wait(), 10)
        await loop.stop()
    assert any("kindergarten_fees='updated'" in record.getMessage() for record in caplog.records)
