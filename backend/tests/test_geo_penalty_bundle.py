"""幼兒園裁罰與評鑑的打包退路與 CLI（2026-10-20 規格 C10）：scripts/fetch_geo_bundle.py 轉成我們自己的 CSV（人名、電話不寫出），
`geo-sync --bundle` 或 --kindergarten-…-file 匯入，不連外。"""

from __future__ import annotations

import importlib.util
import logging
import zipfile
from datetime import date
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app import cli
from app.admissions.geo import evaluations as ev
from app.admissions.geo import penalties as pen
from app.admissions.geo import sync
from app.admissions.geo.bundle import KINDS, SINGLE_KINDS, BundleError, BundleFile, open_bundle, write_bundle
from app.admissions.geo.models import GeoKindergartenEvaluation, GeoKindergartenPenalty
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import (
    FAKE_PERSON_NAMES, FAKE_PHONES, EvaluationConfig, evaluation_response, load_geo_samples, penalty_files, penalty_response,
)

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_geo_bundle.py"
CHANGCHUN = "高雄市私立常春藤幼兒園"


def _load_script():
    spec = importlib.util.spec_from_file_location("fetch_geo_bundle_for_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def instant(seconds: float) -> None:
        return None

    monkeypatch.setattr(sync, "_sleep", instant)
    monkeypatch.setattr(sync, "EVALUATIONS_MIN_SCHOOLS", 1)
    monkeypatch.setattr(sync, "EVALUATIONS_MIN_PAGES", 1)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


def _fake_sites(monkeypatch, *, errors: set[str] = frozenset(), config: EvaluationConfig | None = None) -> EvaluationConfig:
    """腳本用的 sync.new_client 換成假的 kiang＋假教保資訊網。errors 的裁罰檔回 500。"""
    config = config or EvaluationConfig()

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        for name in errors:
            if url == pen.punish_url(name):
                return httpx.Response(500)
        return penalty_response(url) or evaluation_response(request, config) or httpx.Response(404)

    monkeypatch.setattr(sync, "new_client", lambda **kwargs: httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    return config


def test_the_two_kinds_are_known_single_file_kinds():
    assert {"kindergarten_penalties", "kindergarten_evaluations"} <= set(KINDS) & set(SINGLE_KINDS)


def test_a_bundle_may_only_carry_one_file_of_each_kind(tmp_path: Path):
    target = tmp_path / "b.zip"
    write_bundle(target, [BundleFile(f"p{index}.csv", "kindergarten_penalties", "2026-10-20", "x", b"a") for index in range(2)])
    with pytest.raises(BundleError, match="只能有一個檔"):
        open_bundle(target, tmp_path / "out")


async def test_kindergarten_only_bundle_has_csvs_without_names_or_phones(tmp_path, monkeypatch, capsys):
    _fake_sites(monkeypatch)
    target = await _load_script().build(tmp_path / "k.zip", kindergarten_only=True)
    grouped = open_bundle(target, tmp_path / "out")
    assert set(grouped) == {"kindergarten_penalties", "kindergarten_evaluations"}
    penalties_csv = grouped["kindergarten_penalties"][0].read_text(encoding="utf-8")
    evaluations_csv = grouped["kindergarten_evaluations"][0].read_text(encoding="utf-8")
    assert penalties_csv.splitlines()[0] == ",".join(pen.CSV_COLUMNS)
    assert evaluations_csv.splitlines()[0] == ",".join(ev.CSV_COLUMNS)
    assert len(pen.parse_csv(penalties_csv)) == 7
    assert sum(len(items) for items in ev.parse_csv(evaluations_csv).values()) == 4 + 21  # 4 所手造的 3 筆＋21 所補的各 1 筆
    for text in (penalties_csv, evaluations_csv, capsys.readouterr().out, *(path.name for paths in grouped.values() for path in paths)):
        for secret in (*FAKE_PERSON_NAMES, *FAKE_PHONES, "負責人：", "行為人：", "SECRETSESSION"):
            assert secret not in text
    with zipfile.ZipFile(target) as archive:
        for name in archive.namelist():
            assert not any(secret.encode() in archive.read(name) for secret in (*FAKE_PERSON_NAMES, *FAKE_PHONES))


async def test_a_bundle_with_a_failed_penalty_file_is_not_written(tmp_path, monkeypatch):
    _fake_sites(monkeypatch, errors={CHANGCHUN})
    with pytest.raises(SystemExit, match="裁罰檔有 1 個下載失敗"):
        await _load_script().build(tmp_path / "k.zip", kindergarten_only=True)
    assert not (tmp_path / "k.zip").exists()


async def test_a_bundle_with_too_few_evaluations_is_not_written(tmp_path, monkeypatch):
    _fake_sites(monkeypatch)
    monkeypatch.setattr(sync, "EVALUATIONS_MIN_SCHOOLS", 26)
    with pytest.raises(SystemExit, match="疑似殘缺"):
        await _load_script().build(tmp_path / "k.zip", kindergarten_only=True)
    assert not (tmp_path / "k.zip").exists()


async def test_the_bundle_imports_through_the_cli_without_going_online(app, cli_on_test_app, monkeypatch, capsys, tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    async with app.state.session_factory() as db:
        await load_geo_samples(db)
    _fake_sites(monkeypatch)
    target = await _load_script().build(tmp_path / "k.zip", kindergarten_only=True)

    def no_network(**kwargs):
        raise AssertionError("匯入打包檔不該連外")

    monkeypatch.setattr(sync, "new_client", no_network)
    capsys.readouterr()
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    output = capsys.readouterr().out
    assert "幼兒園裁罰：updated（" in output and "這次寫入 7 筆）" in output
    assert "幼兒園評鑑：updated（" in output and "這次寫入 3 筆）" in output
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(GeoKindergartenPenalty)) == 7
        assert await db.scalar(select(func.count()).select_from(GeoKindergartenEvaluation)) == 3
        matched = await db.scalar(
            select(func.count()).select_from(GeoKindergartenPenalty).where(GeoKindergartenPenalty.source_id.is_not(None))
        )
    assert matched == 6  # 已停辦那一檔對不到
    for secret in (*FAKE_PERSON_NAMES, *FAKE_PHONES):
        assert secret not in output and secret not in caplog.text


async def test_single_file_options_import_and_report_a_failure_with_exit_one(app, cli_on_test_app, capsys, tmp_path):
    good = tmp_path / "p.csv"
    rows = pen.parse_penalty_file(penalty_files()[CHANGCHUN], CHANGCHUN).rows
    good.write_text(pen.rows_to_csv(rows), encoding="utf-8")
    await geo_sync_command(**geo_sync_options(["--kindergarten-penalties-file", str(good)]))
    assert "幼兒園裁罰：updated" in capsys.readouterr().out
    bad = tmp_path / "e.csv"
    bad.write_text("<html>error</html>", encoding="utf-8")
    with pytest.raises(SystemExit) as exit_info:
        await geo_sync_command(**geo_sync_options(["--kindergarten-evaluations-file", str(bad)]))
    assert exit_info.value.code == 1
    assert "幼兒園評鑑同步失敗：評鑑檔不是預期的格式" in capsys.readouterr().err


def test_cli_options(tmp_path: Path):
    a, b = tmp_path / "p.csv", tmp_path / "e.csv"
    for path in (a, b):
        path.write_text("x", encoding="utf-8")
    options = geo_sync_options(["--kindergarten-penalties-file", str(a), "--kindergarten-evaluations-file", str(b)])
    assert (options["kindergarten_penalties_file"], options["kindergarten_evaluations_file"]) == (a, b)
    with pytest.raises(SystemExit):
        geo_sync_options(["--kindergarten-penalties-file", str(tmp_path / "missing.csv")])
    with pytest.raises(SystemExit):
        geo_sync_options(["--kindergarten-evaluations-file"])
