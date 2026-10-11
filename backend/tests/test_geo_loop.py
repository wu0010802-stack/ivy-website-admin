"""公開地理資料同步的背景迴圈、啟動條件、設定與 CLI 參數（2026-10-08 規格 §7）。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app import cli
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.cli import geo_sync_command, geo_sync_options
from app.config import Settings
from app.main import create_app
from app.workers import geo_loop
from app.workers.geo_loop import GeoSyncLoop
from tests.conftest import _test_settings
from tests.geo_helpers import FIXTURES

SAMPLE_CSV = FIXTURES / "doorplates-sample.csv"
SAMPLE_JSON = FIXTURES / "preschools-sample.json"


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
            session_factory, settings, doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON, **kwargs
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


async def test_run_once_does_not_hold_a_transaction_during_sync(app, monkeypatch):
    """同步期間迴圈自己不佔交易（舊作法是持鎖交易整段閒置）：run_geo_sync 執行時，
    資料庫裡沒有 idle in transaction 的連線。"""
    seen: list[int] = []

    async def fake_sync(session_factory, settings, **kwargs):
        async with session_factory() as probe:
            seen.append(
                await probe.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()"
                    )
                )
            )
        return "done"

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600)
    assert await loop.run_once() == "done"
    assert seen == [0]


async def test_loop_runs_and_stops_cleanly(app, monkeypatch):
    calls: list[int] = []

    async def fake_sync(session_factory, settings, **kwargs):
        calls.append(1)
        raise RuntimeError("這一輪失敗也不能讓迴圈結束")

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=0.05, first_delay_seconds=0)
    loop.start()
    await asyncio.sleep(0.3)
    assert loop.running
    await loop.stop()
    assert not loop.running and len(calls) >= 2


async def test_loop_keeps_going_when_another_sync_is_busy(app, monkeypatch):
    calls: list[int] = []

    async def busy_sync(session_factory, settings, **kwargs):
        calls.append(1)
        raise sync.GeoSyncBusy("另一個公開資料同步正在進行")

    monkeypatch.setattr(geo_loop, "run_geo_sync", busy_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=0.05, first_delay_seconds=0)
    loop.start()
    await asyncio.sleep(0.3)
    assert loop.running
    await loop.stop()
    assert len(calls) >= 2 and loop.last_run_at is None


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
        {"geo_sync_check_seconds": 10},
    ],
)
def test_geo_settings_reject_unsafe_values(overrides):
    with pytest.raises(ValueError):
        _settings(**overrides)


def test_cli_options_with_files():
    csv, data = SAMPLE_CSV, SAMPLE_JSON
    assert geo_sync_options(["--doorplates-file", str(csv), "--kindergartens-file", str(data)]) == {
        "force": False, "doorplates_file": csv, "doorplates_version": None, "kindergartens_file": data,
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
    await geo_sync_command(doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON)
    output = capsys.readouterr().out
    assert "門牌：updated" in output and "幼兒園：updated" in output
    assert await _doorplate_count(app) > 0


async def test_cli_geo_sync_exits_one_when_a_dataset_fails(app, cli_on_test_app, capsys, tmp_path: Path):
    bad = tmp_path / "doorplates.csv"
    bad.write_text("x,y\n1,2\n", encoding="utf-8")
    with pytest.raises(SystemExit) as exit_info:
        await geo_sync_command(doorplates_file=bad, kindergartens_file=SAMPLE_JSON)
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
                await geo_sync_command(doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON)
        finally:
            await _unlock(holder)
    assert exit_info.value.code == 1
    captured = capsys.readouterr()
    assert "另一個公開資料同步正在進行，稍後再試" in captured.out + captured.err
    assert await _doorplate_count(app) == 0
