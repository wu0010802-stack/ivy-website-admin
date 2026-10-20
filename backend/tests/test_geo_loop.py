"""公開地理資料同步的背景迴圈、啟動條件、設定與 CLI 參數（2026-10-08 規格 §7）。"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, text

from app import cli
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.admissions.geo.sync import GeoSyncResult
from app.cli import geo_sync_command, geo_sync_options
from app.config import Settings
from app.main import create_app
from app.workers import geo_loop
from app.workers.geo_loop import GeoSyncLoop
from app.workers.media_loop import MediaJobLoop
from tests.conftest import _test_settings
from tests.geo_helpers import FIXTURES, REGISTRY_SAMPLE, lock_is_free

SAMPLE_CSV = FIXTURES / "doorplates-sample.csv"
SAMPLE_JSON = FIXTURES / "preschools-sample.json"
REGISTRY_CSV = REGISTRY_SAMPLE


async def _try_lock(conn) -> bool:
    return await conn.scalar(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": sync.LOCK_KEY})


async def _unlock(conn) -> None:
    await conn.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": sync.LOCK_KEY})


async def _doorplate_count(app) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(GeoDoorplate))


@pytest.fixture
def offline_sync(monkeypatch):
    """讓迴圈裡的 run_geo_sync 用本機樣本檔跑真的同步（不連外）。回傳呼叫次數的清單。"""
    calls: list[int] = []
    real = sync.run_geo_sync

    async def run_from_files(session_factory, settings, **kwargs):
        calls.append(1)
        return await real(
            session_factory, settings, doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON,
            kindergartens_registry_file=REGISTRY_CSV, **kwargs,
        )

    monkeypatch.setattr(geo_loop, "run_geo_sync", run_from_files)
    return calls


async def test_run_once_skips_while_another_sync_holds_the_lock(app, offline_sync):
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600)
    engine = app.state.session_factory.kw["bind"]
    async with engine.connect() as holder:
        holder = await holder.execution_options(isolation_level="AUTOCOMMIT")
        assert await _try_lock(holder)
        try:
            assert await loop.run_once() is None  # 不丟例外、什麼都沒做
            assert offline_sync == [1]  # 真的走到 run_geo_sync，被它的全域鎖擋下
            assert await _doorplate_count(app) == 0
            assert loop.last_result is None and loop.last_run_at is None
        finally:
            await _unlock(holder)
    result = await loop.run_once()
    assert result is not None and (result.doorplates, result.kindergartens) == ("updated", "updated")
    assert await _doorplate_count(app) > 0
    assert loop.last_result is result and loop.last_run_at is not None


async def test_run_once_does_not_hold_a_transaction_during_sync(app, offline_sync, monkeypatch):
    """同步期間迴圈自己不佔交易（舊作法是持鎖交易整段閒置）：跑真的 run_geo_sync，在同步進行到
    一半（門牌已匯入、幼兒園開始前）查資料庫，沒有 idle in transaction 的連線。"""
    seen: list[int] = []
    real_kindergartens = sync.sync_kindergartens

    async def probe_then_sync(session_factory, settings, client, **kwargs):
        async with session_factory() as probe:
            seen.append(
                await probe.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()"
                    )
                )
            )
        return await real_kindergartens(session_factory, settings, client, **kwargs)

    monkeypatch.setattr(sync, "sync_kindergartens", probe_then_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600)
    result = await loop.run_once()
    assert result is not None and result.doorplates == "updated"
    assert seen == [0]
    assert await _doorplate_count(app) > 0  # 探測是在真的同步中間做的，不是假的


async def _until(condition_met: asyncio.Event) -> None:
    await asyncio.wait_for(condition_met.wait(), timeout=10)


async def test_loop_runs_and_stops_cleanly(app, monkeypatch):
    calls: list[int] = []
    twice = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        calls.append(1)
        if len(calls) >= 2:
            twice.set()
        raise RuntimeError("這一輪失敗也不能讓迴圈結束")

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=0.01, first_delay_seconds=0)
    loop.start()
    await _until(twice)  # 第一輪失敗之後迴圈還活著、又跑了一輪
    assert loop.running
    await loop.stop()
    assert not loop.running and len(calls) >= 2


async def test_loop_keeps_going_when_another_sync_is_busy(app, monkeypatch):
    calls: list[int] = []
    twice = asyncio.Event()

    async def busy_sync(session_factory, settings, **kwargs):
        calls.append(1)
        if len(calls) >= 2:
            twice.set()
        raise sync.GeoSyncBusy("另一個公開資料同步正在進行")

    monkeypatch.setattr(geo_loop, "run_geo_sync", busy_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=0.01, first_delay_seconds=0)
    loop.start()
    await _until(twice)
    assert loop.running
    await loop.stop()
    assert len(calls) >= 2 and loop.last_run_at is None


@pytest.fixture
def hanging_network(monkeypatch):
    """迴圈裡的 run_geo_sync 照常跑（真的鎖、真的資料庫），只是下載永遠等不到回應。
    回傳「同步已經送出第一個請求」的事件。"""
    entered = asyncio.Event()

    async def hang(request: httpx.Request) -> httpx.Response:
        entered.set()
        await asyncio.Event().wait()
        raise AssertionError("不該回來")

    real = sync.run_geo_sync

    async def run_with_hanging_network(session_factory, settings, **kwargs):
        async with httpx.AsyncClient(transport=httpx.MockTransport(hang)) as client:
            return await real(session_factory, settings, client=client, **kwargs)

    monkeypatch.setattr(geo_loop, "run_geo_sync", run_with_hanging_network)
    return entered


async def test_stop_during_a_real_sync_cancels_it_releases_the_lock_and_warns(app, hanging_network, caplog):
    """停機時同步還在下載：逾時就取消，記一則 warning；鎖放掉、沒有留下使用中的批次，下一次同步照常。"""
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.WARNING, logger="app.admissions.geo.loop"):
        loop.start()
        await _until(hanging_network)
        assert not await lock_is_free(app)  # 同步真的握著鎖在下載
        await loop.stop(timeout=0.2)
    assert not loop.running
    warnings = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert any("取消" in record.getMessage() for record in warnings), [r.getMessage() for r in caplog.records]
    assert await lock_is_free(app)
    assert await _doorplate_count(app) == 0
    async with app.state.session_factory() as db:
        assert await db.get(GeoDatasetStatus, "doorplates") is None


async def test_stop_that_finishes_in_time_does_not_warn(app, monkeypatch, caplog):
    async def quick_sync(session_factory, settings, **kwargs):
        return GeoSyncResult("skipped", "skipped", None, 0)

    monkeypatch.setattr(geo_loop, "run_geo_sync", quick_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.WARNING, logger="app.admissions.geo.loop"):
        loop.start()
        await loop.stop()
    assert [record for record in caplog.records if record.levelno >= logging.WARNING] == []


@pytest.mark.parametrize(
    ("doorplates", "kindergartens", "summarised"),
    [
        ("skipped", "skipped", False),  # 這一輪什麼都沒做（30 天內不看來源）：不吵
        ("updated", "skipped", True),  # 只要有一項做了事就記，另一項是 skipped 也一樣
        ("skipped", "updated", True),
        ("skipped", "failed", True),
        ("failed", "failed", True),
        ("updated", "updated", True),
    ],
)
async def test_loop_summarises_a_round_unless_both_were_skipped(app, monkeypatch, caplog, doorplates, kindergartens, summarised):
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        ran.set()
        return GeoSyncResult(doorplates, kindergartens, "115-10", 0)

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.INFO, logger="app.admissions.geo.loop"):
        loop.start()
        await _until(ran)
        await loop.stop()  # 等這一輪的收尾（含摘要）做完才回來
    lines = [record.getMessage() for record in caplog.records if f"doorplates='{doorplates}'" in record.getMessage()]
    assert bool(lines) is summarised, lines


@pytest.mark.parametrize("dataset", ["population", "babycare", "births", "migration", "age_history", "income", "new_homes"])
async def test_loop_summarises_a_round_in_which_only_a_later_dataset_did_something(app, monkeypatch, caplog, dataset):
    """門牌與幼兒園都沒到期、只有後來加的某一種資料做了事（或失敗）時，也要記摘要，不能因為前兩項是 skipped 就靜音。"""
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        ran.set()
        return GeoSyncResult("skipped", "skipped", None, 0, **{dataset: "failed"})

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.INFO, logger="app.admissions.geo.loop"):
        loop.start()
        await _until(ran)
        await loop.stop()
    lines = [record.getMessage() for record in caplog.records if f"{dataset}='failed'" in record.getMessage()]
    assert lines


@pytest.mark.parametrize(
    ("admissions", "auto_sync", "expected"), [(True, True, True), (True, False, False), (False, True, False)]
)
async def test_lifespan_starts_loop_only_with_both_flags(admissions, auto_sync, expected):
    settings = _test_settings().model_copy(update={"admissions_enabled": admissions, "geo_auto_sync": auto_sync})
    loop_app = create_app(settings)
    async with loop_app.router.lifespan_context(loop_app):
        assert isinstance(loop_app.state.geo_sync, GeoSyncLoop) is expected
    if expected:
        assert not loop_app.state.geo_sync.running


def _settings(**overrides) -> Settings:
    return Settings(
        database_url="postgresql://localhost/ivy_website_dev",
        environment="test",
        test_database_url="postgresql://localhost/ivy_website_test",
        session_secret="test-only-secret",
        **overrides,
    )


def test_geo_settings_defaults():
    settings = _settings()
    assert settings.geo_auto_sync is False
    assert settings.geo_doorplate_url is None
    assert settings.geo_kindergartens_url == "https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json"
    assert settings.geo_babycare_url == "https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json"
    assert settings.geo_kindergartens_registry_url == "https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv"
    assert settings.geo_sync_check_seconds == 86400


def test_geo_settings_read_environment(monkeypatch):
    monkeypatch.setenv("WEBSITE_GEO_AUTO_SYNC", "true")
    monkeypatch.setenv("WEBSITE_GEO_DOORPLATE_URL", "  ")
    settings = _settings()
    assert settings.geo_auto_sync is True and settings.geo_doorplate_url is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"geo_doorplate_url": "http://data.kcg.gov.tw/x.csv"},
        {"geo_kindergartens_url": "ftp://example.org/x.json"},
        {"geo_kindergartens_registry_url": "http://example.org/r.csv"},
        {"geo_babycare_url": "http://example.org/b.json"},
        {"geo_sync_check_seconds": 10},
    ],
)
def test_geo_settings_reject_unsafe_values(overrides):
    with pytest.raises(ValueError):
        _settings(**overrides)


def test_cli_options_with_files():
    csv, data = SAMPLE_CSV, SAMPLE_JSON
    args = ["--doorplates-file", str(csv), "--kindergartens-file", str(data), "--kindergartens-registry-file", str(REGISTRY_CSV)]
    assert geo_sync_options(args) == {
        "force": False, "doorplates_file": csv, "doorplates_version": None, "kindergartens_file": data,
        "kindergartens_registry_file": REGISTRY_CSV,
        "babycare_file": None, "population_files": None, "births_files": None, "migration_files": None,
        "income_file": None, "income_year": None, "new_homes_files": None, "new_homes_season": None, "bundle": None,
        "presale_buildcases_file": None, "presale_parcels_file": None,
        "kindergarten_penalties_file": None, "kindergarten_evaluations_file": None,
    }
    assert geo_sync_options(["--force"])["force"] is True
    assert geo_sync_options(["--doorplates-file", str(csv), "--doorplates-version", "115-10"])["doorplates_version"] == "115-10"


@pytest.mark.parametrize(
    "args",
    [["--doorplates-file"], ["--unknown"], ["--doorplates-version", "115-10"], ["--doorplates-file", "/no/such/file.csv"]],
)
def test_cli_options_reject_bad_arguments(args):
    with pytest.raises(SystemExit):
        geo_sync_options(args)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    """geo_sync_command 用測試 app 的資料庫與設定，而不是另外建連線。"""

    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_cli_geo_sync_with_files_imports_and_exits_zero(app, cli_on_test_app, capsys):
    await geo_sync_command(doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON, kindergartens_registry_file=REGISTRY_CSV)
    output = capsys.readouterr().out
    assert "門牌：updated" in output and "幼兒園：updated" in output
    assert "略過" not in output  # 樣本沒有壞資料，不多印一行
    assert await _doorplate_count(app) > 0


async def test_cli_geo_sync_prints_how_many_rows_were_skipped(app, cli_on_test_app, capsys, tmp_path: Path):
    csv = tmp_path / "doorplates.csv"
    lines = SAMPLE_CSV.read_text(encoding="utf-8-sig").splitlines()
    lines.insert(1, "64,6400500,本揚里,001," + "甲" * 41 + ",,,,１號,176205.163,2503011.609")
    csv.write_text("\n".join(lines) + "\n", encoding="utf-8")
    await geo_sync_command(doorplates_file=csv, kindergartens_file=SAMPLE_JSON, kindergartens_registry_file=REGISTRY_CSV)
    output = capsys.readouterr().out
    assert "門牌：updated" in output
    assert "略過：門牌 1 列、幼兒園 0 筆" in output


async def test_cli_geo_sync_exits_one_when_a_dataset_fails(app, cli_on_test_app, capsys, tmp_path: Path):
    bad = tmp_path / "doorplates.csv"
    bad.write_text("x,y\n1,2\n", encoding="utf-8")
    with pytest.raises(SystemExit) as exit_info:
        await geo_sync_command(doorplates_file=bad, kindergartens_file=SAMPLE_JSON, kindergartens_registry_file=REGISTRY_CSV)
    assert exit_info.value.code == 1
    captured = capsys.readouterr()
    assert "門牌：failed" in captured.out
    async with app.state.session_factory() as db:
        assert (await db.get(GeoDatasetStatus, "doorplates")).last_error == "門牌資料的欄位和預期不同"
    assert "門牌同步失敗：門牌資料的欄位和預期不同" in captured.err  # 失敗原因印到 stderr，不用另外查資料庫
    assert "幼兒園同步失敗" not in captured.err  # 成功的那一種不印


async def test_cli_geo_sync_exits_one_when_another_sync_is_running(app, cli_on_test_app, capsys):
    engine = app.state.session_factory.kw["bind"]
    async with engine.connect() as holder:
        holder = await holder.execution_options(isolation_level="AUTOCOMMIT")
        assert await _try_lock(holder)
        try:
            with pytest.raises(SystemExit) as exit_info:
                await geo_sync_command(doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON, kindergartens_registry_file=REGISTRY_CSV)
        finally:
            await _unlock(holder)
    assert exit_info.value.code == 1
    captured = capsys.readouterr()
    assert "另一個公開資料同步正在進行，稍後再試" in captured.out + captured.err
    assert await _doorplate_count(app) == 0


def test_geo_auto_sync_is_pinned_off_in_the_shared_test_settings(monkeypatch):
    """開發者 shell 裡設了 WEBSITE_GEO_AUTO_SYNC=true 時，測試也不能起同步迴圈、連外下載。"""
    monkeypatch.setenv("WEBSITE_GEO_AUTO_SYNC", "true")
    assert _test_settings().geo_auto_sync is False


@pytest.mark.parametrize(("pool", "overflow", "valid"), [(1, 0, False), (1, 1, True), (2, 0, True), (10, 10, True)])
def test_geo_auto_sync_needs_a_connection_besides_the_one_holding_the_lock(pool, overflow, valid):
    """同步期間有一條專用連線握著 advisory lock；連線池只有一條又不能溢出時，其他請求會一直等。"""
    overrides = {"geo_auto_sync": True, "db_pool_size": pool, "db_max_overflow": overflow}
    if valid:
        assert _settings(**overrides).geo_auto_sync is True
    else:
        with pytest.raises(ValueError, match="WEBSITE_DB_POOL_SIZE"):
            _settings(**overrides)


def test_a_single_connection_pool_is_fine_while_auto_sync_is_off():
    assert _settings(db_pool_size=1, db_max_overflow=0).geo_auto_sync is False


async def test_shutdown_stops_the_geo_and_media_loops_at_the_same_time(monkeypatch):
    """關閉時兩個迴圈各自最多等 10 秒：並行停，不疊加成 20 秒。"""
    events: list[tuple[str, str]] = []

    def slow_stop(name: str):
        async def stop(self, *, timeout: float = 10.0) -> None:
            events.append((name, "start"))
            await asyncio.sleep(0.05)
            events.append((name, "end"))

        return stop

    monkeypatch.setattr(GeoSyncLoop, "stop", slow_stop("geo"))
    monkeypatch.setattr(MediaJobLoop, "stop", slow_stop("media"))
    monkeypatch.setattr(MediaJobLoop, "start", lambda self: None)
    monkeypatch.setattr(GeoSyncLoop, "start", lambda self: None)
    settings = _test_settings().model_copy(
        update={"admissions_enabled": True, "geo_auto_sync": True, "media_video_processing": "background"}
    )
    loop_app = create_app(settings)
    async with loop_app.router.lifespan_context(loop_app):
        assert isinstance(loop_app.state.geo_sync, GeoSyncLoop) and isinstance(loop_app.state.media_jobs, MediaJobLoop)
    assert sorted(events[:2]) == [("geo", "start"), ("media", "start")]  # 兩個都開始停了，才有任何一個結束
    assert sorted(events[2:]) == [("geo", "end"), ("media", "end")]


async def test_shutdown_still_finishes_when_one_loop_fails_to_stop(monkeypatch):
    """其中一個迴圈停止時丟例外：另一個照樣停完、資料庫連線照樣關。"""
    stopped: list[str] = []

    async def broken_stop(self, *, timeout: float = 10.0) -> None:
        raise RuntimeError("停不下來")

    async def media_stop(self, *, timeout: float = 10.0) -> None:
        stopped.append("media")

    monkeypatch.setattr(GeoSyncLoop, "stop", broken_stop)
    monkeypatch.setattr(GeoSyncLoop, "start", lambda self: None)
    monkeypatch.setattr(MediaJobLoop, "stop", media_stop)
    monkeypatch.setattr(MediaJobLoop, "start", lambda self: None)
    settings = _test_settings().model_copy(
        update={"admissions_enabled": True, "geo_auto_sync": True, "media_video_processing": "background"}
    )
    loop_app = create_app(settings)
    async with loop_app.router.lifespan_context(loop_app):
        pass
    assert stopped == ["media"]


def test_cli_main_dispatches_geo_sync_with_parsed_options(monkeypatch):
    """`python -m app.cli geo-sync ...` 真的走到 geo_sync_command，帶著解析好的參數。"""
    received: list[dict] = []

    async def fake_command(**options) -> None:
        received.append(options)

    monkeypatch.setattr(cli, "geo_sync_command", fake_command)
    monkeypatch.setattr(
        sys, "argv", ["app.cli", "geo-sync", "--force", "--doorplates-file", str(SAMPLE_CSV), "--doorplates-version", "115-10"]
    )
    cli.main()
    assert received == [
        {
            "force": True, "doorplates_file": SAMPLE_CSV, "doorplates_version": "115-10", "kindergartens_file": None,
            "kindergartens_registry_file": None,
            "babycare_file": None, "population_files": None, "births_files": None, "migration_files": None,
            "income_file": None, "income_year": None, "new_homes_files": None, "new_homes_season": None, "bundle": None,
            "presale_buildcases_file": None, "presale_parcels_file": None,
            "kindergarten_penalties_file": None, "kindergarten_evaluations_file": None,
        }
    ]


def test_cli_main_rejects_bad_geo_sync_arguments_before_running_anything(monkeypatch):
    async def must_not_run(**options) -> None:
        raise AssertionError("參數錯誤時不該執行")

    monkeypatch.setattr(cli, "geo_sync_command", must_not_run)
    monkeypatch.setattr(sys, "argv", ["app.cli", "geo-sync", "--unknown"])
    with pytest.raises(SystemExit):
        cli.main()


@pytest.mark.parametrize(
    "args",
    [["--kindergartens-file", str(SAMPLE_JSON)], ["--kindergartens-registry-file", str(REGISTRY_CSV)]],
    ids=["只有 JSON", "只有名單"],
)
def test_cli_kindergarten_files_come_in_pairs(args):
    with pytest.raises(SystemExit, match="要一起給"):
        geo_sync_options(args)


def test_cli_rejects_a_missing_registry_file():
    with pytest.raises(SystemExit, match="找不到檔案"):
        geo_sync_options(["--kindergartens-file", str(SAMPLE_JSON), "--kindergartens-registry-file", "/no/such/registry.csv"])
