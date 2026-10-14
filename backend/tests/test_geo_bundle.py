"""公開資料打包檔與 `geo-sync --bundle`（2026-10-14 里的變化規格 §4.6）：整包驗證（manifest、檔名、種類、
sha256），不對就什麼都不匯入；對的話等於每個檔各自用 --…-file 指定、不連外。"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import cli
from app.admissions.geo import population as population_io
from app.admissions.geo import village_series as series_io
from app.admissions.geo.bundle import BundleError, BundleFile, open_bundle, write_bundle
from app.admissions.geo.models import GeoVillageAges, GeoVillageBirths, GeoVillageMigration, GeoVillagePopulation
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import RIS_SAMPLE_VILLAGES, ris_sample_pages, ris_series_page


@pytest.fixture
def few_villages(monkeypatch):
    monkeypatch.setattr(series_io, "MIN_VILLAGES", 1)
    monkeypatch.setattr(population_io, "MIN_VILLAGES", 1)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


def _json(data: dict) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def _sample_files() -> list[BundleFile]:
    files = [
        BundleFile(f"births-{month}.json", "births", series_io.label_of(month), "https://example.org", _json(ris_series_page("ODRP061", month)))
        for month in ("11509", "11508")
    ]
    files.append(BundleFile("migration-11509.json", "migration", "115-09", "https://example.org", _json(ris_series_page("ODRP011"))))
    for month in ("11509", "11409"):
        for index, page in enumerate(ris_sample_pages(month), start=1):
            files.append(
                BundleFile(f"population-{month}-{index}.json", "population", series_io.label_of(month), "https://example.org", _json(page))
            )
    return files


def test_round_trip(tmp_path: Path):
    target = tmp_path / "bundle.zip"
    write_bundle(target, _sample_files())
    grouped = open_bundle(target, tmp_path / "out")
    assert [path.name for path in grouped["births"]] == ["births-11509.json", "births-11508.json"]
    assert len(grouped["population"]) == 4 and len(grouped["migration"]) == 1
    assert grouped["births"][0].read_bytes() == _sample_files()[0].content


def _rewrite(target: Path, *, manifest=None, extra: dict[str, bytes] | None = None, drop: str | None = None) -> None:
    """改寫已經寫好的打包檔（模擬被改過或殘缺的檔）。"""
    with zipfile.ZipFile(target) as archive:
        contents = {name: archive.read(name) for name in archive.namelist()}
    if manifest is not None:
        contents["manifest.json"] = json.dumps(manifest).encode() if not isinstance(manifest, bytes) else manifest
    contents.update(extra or {})
    if drop:
        contents.pop(drop)
    with zipfile.ZipFile(target, "w") as archive:
        for name, content in contents.items():
            archive.writestr(name, content)


def _manifest(target: Path) -> dict:
    with zipfile.ZipFile(target) as archive:
        return json.loads(archive.read("manifest.json"))


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda m, t: _rewrite(t, extra={"births-11509.json": b"{}"}), "sha256 不符"),
        (lambda m, t: _rewrite(t, drop="births-11508.json"), "沒有 births-11508.json"),
        (lambda m, t: _rewrite(t, manifest={**m, "version": 2}), "版本"),
        (lambda m, t: _rewrite(t, manifest={**m, "files": []}), "檔案清單"),
        (lambda m, t: _rewrite(t, manifest=b"not json"), "不是 JSON"),
        (lambda m, t: _rewrite(t, drop="manifest.json"), "沒有 manifest"),
        (lambda m, t: _rewrite(t, manifest={**m, "files": [{**m["files"][0], "path": "../evil.json"}]}), "檔名不能用"),
        (lambda m, t: _rewrite(t, manifest={**m, "files": [{**m["files"][0], "kind": "doorplates"}]}), "不認得的資料種類"),
        (lambda m, t: _rewrite(t, manifest={**m, "files": [m["files"][0], m["files"][0]]}), "檔名不能用"),
    ],
)
def test_bad_bundles_are_refused_whole(tmp_path: Path, change, message):
    target = tmp_path / "bundle.zip"
    write_bundle(target, _sample_files())
    change(_manifest(target), target)
    with pytest.raises(BundleError, match=message):
        open_bundle(target, tmp_path / "out")
    assert not (tmp_path / "out").exists()  # 一個檔都沒解出來


def test_not_a_zip(tmp_path: Path):
    target = tmp_path / "bundle.zip"
    target.write_bytes(b"plain text")
    with pytest.raises(BundleError, match="不是 zip"):
        open_bundle(target, tmp_path / "out")


def test_write_refuses_unsafe_names(tmp_path: Path):
    with pytest.raises(BundleError):
        write_bundle(tmp_path / "x.zip", [BundleFile("../x.json", "births", "115-09", "", b"{}")])


async def _count(app, model) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model))


async def test_cli_bundle_imports_every_kind_without_going_online(app, few_villages, cli_on_test_app, capsys, tmp_path: Path):
    target = tmp_path / "geo-bundle-11509.zip"
    write_bundle(target, _sample_files())
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    output = capsys.readouterr().out
    assert "各里人口：updated（使用中 115-09）" in output
    assert "各里出生：updated（最新 115-09，這次寫入 2 個月）" in output
    assert "各里遷入遷出：updated（最新 115-09，這次寫入 1 個月）" in output
    assert await _count(app, GeoVillagePopulation) == RIS_SAMPLE_VILLAGES
    assert await _count(app, GeoVillageBirths) == 2 * RIS_SAMPLE_VILLAGES
    assert await _count(app, GeoVillageMigration) == RIS_SAMPLE_VILLAGES
    # 使用中的月份與一年前都進了年齡歷史。
    assert await _count(app, GeoVillageAges) == 2 * RIS_SAMPLE_VILLAGES


async def test_cli_bad_bundle_imports_nothing_and_exits_one(app, few_villages, cli_on_test_app, capsys, tmp_path: Path):
    target = tmp_path / "geo-bundle.zip"
    write_bundle(target, _sample_files())
    _rewrite(target, extra={"migration-11509.json": b"{}"})
    with pytest.raises(SystemExit) as exit_info:
        await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    assert exit_info.value.code == 1
    assert "打包檔不匯入：migration-11509.json 的 sha256 不符" in capsys.readouterr().err
    assert await _count(app, GeoVillageBirths) == 0 and await _count(app, GeoVillagePopulation) == 0


def test_cli_options_collect_births_migration_and_bundle(tmp_path: Path):
    births, migration, bundle = tmp_path / "b.json", tmp_path / "m.json", tmp_path / "x.zip"
    for path in (births, migration, bundle):
        path.write_bytes(b"{}")
    options = geo_sync_options(["--births-file", str(births), "--migration-file", str(migration), "--bundle", str(bundle)])
    assert (options["births_files"], options["migration_files"], options["bundle"]) == ([births], [migration], bundle)
    with pytest.raises(SystemExit):
        geo_sync_options(["--bundle", str(tmp_path / "missing.zip")])
