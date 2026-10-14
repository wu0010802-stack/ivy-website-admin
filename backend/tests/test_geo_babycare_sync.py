"""托嬰名單的同步（2026-10-14 規格 §4）：基準、7 天頻率、各自成敗、檔案匯入、大小與時間上限、CLI。
HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import asyncio
import codecs
import dataclasses
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from functools import partial

import httpx
import pytest
from sqlalchemy import func, select, update

from app import cli
from app.admissions.geo import providers, sync
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.sync import GeoSyncResult, run_geo_sync
from app.cli import geo_sync_command, geo_sync_options
from app.common.timezones import today_local
from app.workers import geo_loop
from app.workers.geo_loop import GeoSyncLoop
from tests.geo_helpers import FIXTURES
from tests.test_geo_limits import _wrap
from tests.test_geo_providers import kg, many_babycare
from tests.test_geo_sync import BABYCARE_URL, KIANG_URL, _site, _status, _sync, small_minimum  # noqa: F401

BABYCARE_SAMPLE = FIXTURES / "babycare-sample.json"
KINDERGARTEN_SAMPLE = FIXTURES / "preschools-sample.json"


async def _count(app, model=GeoBabycare) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model))


async def _age(app, days: int) -> None:
    """把幼兒園與托嬰的「上次確認」往前推 days 天。"""
    old = datetime.now(timezone.utc) - timedelta(days=days)
    async with app.state.session_factory() as db:
        await db.execute(
            update(GeoDatasetStatus)
            .where(GeoDatasetStatus.dataset.in_(["kindergartens", "babycare"]))
            .values(checked_at=old, synced_at=old)
        )
        await db.commit()


async def test_first_sync_imports_the_babycare_list_and_sets_the_baseline(app, small_minimum):
    transport, _ = _site()
    result = await _sync(app, transport)
    assert (result.babycare, result.babycare_rows_skipped) == ("updated", 0)
    assert await _count(app) == 6  # 兩筆停業、一筆新北市不收
    status = await _status(app, "babycare")
    assert status.baseline_on == today_local(status.synced_at) and status.last_error is None
    assert await _count(app, GeoProviderEvent) == 0  # 第一次只建立基準


async def test_a_second_sync_within_seven_days_does_not_download_again(app, small_minimum):
    transport, seen = _site()
    await _sync(app, transport)
    seen.clear()
    again = await _sync(app, transport)
    assert (again.kindergartens, again.babycare) == ("skipped", "skipped")
    assert BABYCARE_URL not in seen and KIANG_URL not in seen


@pytest.mark.parametrize(("age_days", "downloads"), [(6, False), (8, True)])
async def test_kindergartens_and_babycare_are_due_after_seven_days_not_thirty(app, small_minimum, age_days, downloads):
    transport, seen = _site()
    await _sync(app, transport)
    await _age(app, age_days)
    seen.clear()
    result = await _sync(app, transport)
    assert (BABYCARE_URL in seen, KIANG_URL in seen) == (downloads, downloads)
    assert (result.babycare, result.kindergartens) == (("updated",) * 2 if downloads else ("skipped",) * 2)


async def test_a_missing_baseline_makes_the_lists_due_at_once(app, small_minimum):
    """既有幼兒園資料沒有基準日與設立日（舊程式寫的）：上線後第一輪就補上，不必等 7 天。"""
    transport, seen = _site()
    await _sync(app, transport)
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergartens").values(baseline_on=None))
        await db.commit()
    seen.clear()
    result = await _sync(app, transport)
    assert result.kindergartens == "updated" and KIANG_URL in seen
    assert (await _status(app, "kindergartens")).baseline_on is not None
    assert result.babycare == "skipped" and BABYCARE_URL not in seen


async def test_a_broken_babycare_feed_does_not_block_the_others(app, small_minimum):
    transport, _ = _site(babycare=b'{"type": "FeatureCollection", "features": []}')
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens, result.babycare) == ("updated", "updated", "failed")
    assert (await _status(app, "babycare")).last_error == "托嬰名單裡沒有高雄市營業中的機構"


async def test_a_failed_download_keeps_the_previous_list(app, small_minimum):
    good, _ = _site()
    await _sync(app, good)
    await _age(app, 8)
    bad, _ = _site(babycare=b"not json at all")
    result = await _sync(app, bad)
    assert result.babycare == "failed"
    assert await _count(app) == 6
    assert "JSONDecodeError" in (await _status(app, "babycare")).last_error


async def test_a_babycare_file_never_touches_the_network(app):
    requested: list[str] = []

    def refuse(request):
        requested.append(str(request.url))  # 同步會把連線錯誤吞掉記成 failed，所以另外記下有沒有發出請求
        raise AssertionError(f"不該連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
        result = await run_geo_sync(app.state.session_factory, app.state.settings, client=client, babycare_file=BABYCARE_SAMPLE)
    assert requested == []
    # 結果欄位（型別是 str）除了托嬰，其餘每一種資料都沒碰：之後新增的資料種類也會被這裡抓到
    outcomes = {f.name: getattr(result, f.name) for f in dataclasses.fields(result) if f.type in (str, "str")}
    assert outcomes.pop("babycare") == "updated"
    assert set(outcomes.values()) == {"skipped"}, outcomes
    assert await _count(app) == 6


async def test_a_babycare_file_with_a_bom_is_read(app, tmp_path):
    path = tmp_path / "babycare.json"
    path.write_bytes(codecs.BOM_UTF8 + BABYCARE_SAMPLE.read_bytes())
    result = await run_geo_sync(app.state.session_factory, app.state.settings, babycare_file=path)
    assert result.babycare == "updated" and await _count(app) == 6


async def test_the_list_that_is_closed_in_a_later_sync_becomes_a_closed_event(app, small_minimum):
    good, _ = _site()
    await _sync(app, good)
    async with app.state.session_factory() as db:  # 模擬先前的名單多一所：之後的同步看到它不在了
        db.add(
            GeoBabycare(
                source_id="gone", name="已不在名單", kind="center", address="高雄市三民區某路1號", lat=22.64, lng=120.34,
                is_active=True, synced_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    await _age(app, 8)
    await _sync(app, good)
    async with app.state.session_factory() as db:
        events = (await db.execute(select(GeoProviderEvent))).scalars().all()
    assert [(e.provider, e.source_id, e.change) for e in events] == [("babycare", "gone", "closed")]


# ---- 殘缺檔檢查（P9）接在同步層：拒絕、不動使用中的版本、--force 放行 ----


async def _seed(app, dataset: str, apply, rows, *, days_ago: int = 10) -> tuple:
    """直接把一份名單寫成「使用中的版本」（days_ago 天前同步），回傳該版本的狀態快照。"""
    async with app.state.session_factory() as db:
        await apply(db, rows, synced_at=datetime.now(timezone.utc) - timedelta(days=days_ago))
        await db.commit()
    return _live_version(await _status(app, dataset))


def _live_version(status) -> tuple:
    """使用中的版本（換版時會動的欄位）；last_error 與 last_attempt_at 不算，失敗時本來就會寫。"""
    return (status.active_version, status.label, status.synced_at, status.checked_at, status.baseline_on)


async def _active(app, model) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model).where(model.is_active.is_(True)))


async def test_a_shrunken_babycare_file_is_refused_and_force_lets_it_through(app):
    before = await _seed(app, "babycare", providers.apply_babycare, many_babycare(25))
    refused = await run_geo_sync(app.state.session_factory, app.state.settings, babycare_file=BABYCARE_SAMPLE)
    assert refused.babycare == "failed"
    status = await _status(app, "babycare")
    assert status.last_error == providers.SHRUNK_MESSAGE
    assert _live_version(status) == before, "使用中的版本與基準日沒被動"
    assert await _active(app, GeoBabycare) == 25 and await _count(app) == 25
    assert await _count(app, GeoProviderEvent) == 0, "殘缺檔不能讓整批變成停辦"

    forced = await run_geo_sync(app.state.session_factory, app.state.settings, babycare_file=BABYCARE_SAMPLE, force=True)
    assert forced.babycare == "updated"
    status = await _status(app, "babycare")
    assert status.last_error is None
    assert status.active_version == today_local(status.synced_at).isoformat() != before[0]
    assert status.baseline_on == before[4], "基準日只在第一次設定"
    assert await _active(app, GeoBabycare) == 6
    async with app.state.session_factory() as db:
        changes = Counter((await db.execute(select(GeoProviderEvent.change))).scalars())
    assert changes == {"closed": 25, "opened": 6}


async def test_a_shrunken_kindergarten_file_is_refused_and_force_lets_it_through(app):
    apply = partial(providers.apply_kindergartens, school_year=115)
    before = await _seed(app, "kindergartens", apply, [kg(f"k{index:02d}") for index in range(25)])
    refused = await run_geo_sync(app.state.session_factory, app.state.settings, kindergartens_file=KINDERGARTEN_SAMPLE)
    assert refused.kindergartens == "failed"
    status = await _status(app, "kindergartens")
    assert status.last_error == providers.SHRUNK_MESSAGE
    assert _live_version(status) == before, "使用中的版本與基準日沒被動"
    assert await _active(app, GeoKindergarten) == 25
    assert await _count(app, GeoProviderEvent) == 0

    forced = await run_geo_sync(app.state.session_factory, app.state.settings, kindergartens_file=KINDERGARTEN_SAMPLE, force=True)
    assert forced.kindergartens == "updated"
    status = await _status(app, "kindergartens")
    assert status.last_error is None and status.active_version != before[0]
    assert status.baseline_on == before[4]
    assert await _active(app, GeoKindergarten) < 20


async def test_a_shrunken_downloaded_list_is_retried_on_the_next_round(app, small_minimum):
    """背景迴圈走網路：殘缺檔被拒絕時不算「確認過」（checked_at 不動），隔天那一輪還會再去看來源。"""
    before = await _seed(app, "babycare", providers.apply_babycare, many_babycare(25))
    transport, seen = _site()
    first = await _sync(app, transport)
    assert (first.babycare, BABYCARE_URL in seen) == ("failed", True)
    status = await _status(app, "babycare")
    assert status.last_error == providers.SHRUNK_MESSAGE and _live_version(status) == before
    seen.clear()
    second = await _sync(app, transport)
    assert (second.babycare, BABYCARE_URL in seen) == ("failed", True)
    assert await _active(app, GeoBabycare) == 25


# ---- 大小與時間上限（沿用 2026-10-13 深度掃描的做法）----


async def test_an_oversized_babycare_list_is_refused(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "BABYCARE_MAX_BYTES", 100)
    good, _ = _site()
    result = await _sync(app, good, force=True)
    assert result.babycare == "failed"
    assert "超過大小上限" in ((await _status(app, "babycare")).last_error or "")
    assert await _count(app) == 0
    assert result.kindergartens == "updated", "一種資料失敗不擋其他"


async def test_a_stalled_babycare_source_is_cancelled_by_the_time_budget(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "BABYCARE_TIME_BUDGET", timedelta(seconds=0.3))
    good, _ = _site()

    async def stalled():
        yield b"["
        await asyncio.sleep(30)
        yield b"]"

    def replace(url):
        if url == BABYCARE_URL:
            return httpx.Response(200, content=stalled(), headers={"content-type": "application/json"})

    result = await asyncio.wait_for(_sync(app, _wrap(good, replace), force=True), 20)
    assert result.babycare == "failed"
    assert "同步超過" in ((await _status(app, "babycare")).last_error or "")
    assert result.doorplates == "updated", "一種資料逾時不擋其他"


# ---- CLI 與背景迴圈 ----


def test_cli_collects_the_babycare_file():
    options = geo_sync_options(["--babycare-file", str(BABYCARE_SAMPLE)])
    assert options["babycare_file"] == BABYCARE_SAMPLE
    assert options["kindergartens_file"] is None and options["doorplates_file"] is None


@pytest.mark.parametrize("args", [["--babycare-file"], ["--babycare-file", "/no/such/babycare.json"]])
def test_cli_rejects_bad_babycare_arguments(args):
    with pytest.raises(SystemExit):
        geo_sync_options(args)


async def test_cli_geo_sync_with_a_babycare_file(app, monkeypatch, capsys):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    await geo_sync_command(**geo_sync_options(["--babycare-file", str(BABYCARE_SAMPLE)]))
    output = capsys.readouterr().out
    assert "托嬰：updated" in output
    assert "門牌：skipped" in output and "幼兒園：skipped" in output


async def test_cli_exits_1_and_prints_the_reason_when_the_babycare_list_is_refused(app, monkeypatch, capsys, tmp_path):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    bad = tmp_path / "empty.json"
    bad.write_text('{"type": "FeatureCollection", "features": []}', encoding="utf-8")
    with pytest.raises(SystemExit) as caught:
        await geo_sync_command(**geo_sync_options(["--babycare-file", str(bad)]))
    assert caught.value.code == 1
    assert "托嬰同步失敗：托嬰名單裡沒有高雄市營業中的機構" in capsys.readouterr().err


async def test_the_loop_summarises_a_round_when_only_babycare_was_updated(app, monkeypatch, caplog):
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        ran.set()
        return GeoSyncResult("skipped", "skipped", None, 0, babycare="updated")

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.INFO, logger="app.admissions.geo.loop"):
        loop.start()
        await asyncio.wait_for(ran.wait(), 10)
        await loop.stop()
    assert any("babycare='updated'" in record.getMessage() for record in caplog.records)
