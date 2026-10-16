"""公開地理資料同步的上限（2026-10-13 深度掃描 12、13）：上游回應大小、門牌總列數、同步時間。

同步在 API 同一支程序裡跑；上游內容的發布者不該能用超大的回應耗盡記憶體、用超量的合法列填滿共用
資料庫，或讓同步（與它持有的鎖、連線）無限期跑下去。超過上限一律中止、保留使用中的版本。"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import httpx
import pytest

from app.admissions.geo import sync
from tests.geo_helpers import FIXTURES
from tests.test_geo_sync import CSV_URL, KIANG_URL, _counts, _site, _status, _sync, small_minimum  # noqa: F401

pytestmark = pytest.mark.asyncio


def _wrap(good, replace):
    """replace(url) 回傳 httpx.Response 就蓋掉，回 None 就照 good 的假網站。"""

    async def handle(request: httpx.Request) -> httpx.Response:
        replaced = replace(str(request.url))
        return replaced if replaced is not None else await good.handle_async_request(request)

    return httpx.MockTransport(handle)


def _chunked(parts: list[bytes], **headers) -> httpx.Response:
    """沒有 Content-Length 的串流回應（chunked）：只能邊收邊數。"""

    async def body():
        for part in parts:
            yield part

    return httpx.Response(200, content=body(), headers=headers)


async def _last_error(app, dataset: str) -> str | None:
    status = await _status(app, dataset)
    return status.last_error if status else None


@pytest.mark.parametrize("streamed", [False, True], ids=["declared-length", "chunked"])
async def test_oversized_search_page_stops_discovery_before_parsing(app, monkeypatch, streamed):
    monkeypatch.setattr(sync, "HTML_MAX_BYTES", 200)
    good, _ = _site()
    page = (FIXTURES / "kcg-search.html").read_bytes()
    assert len(page) > 200

    def replace(url):
        if url.startswith("https://data.kcg.gov.tw/dataset?keyword="):
            return _chunked([page[:150], page[150:]], **{"content-type": "text/html"}) if streamed else httpx.Response(
                200, content=page, headers={"content-type": "text/html"}
            )

    result = await _sync(app, _wrap(good, replace), force=True)

    assert result.doorplates == "failed"
    assert "超過大小上限" in (await _last_error(app, "doorplates") or "")


async def test_oversized_kindergarten_list_is_refused(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "KINDERGARTENS_MAX_BYTES", 100)
    good, _ = _site()

    result = await _sync(app, good, force=True)

    assert result.kindergartens == "failed"
    assert "超過大小上限" in (await _last_error(app, "kindergartens") or "")
    assert (await _counts(app))[1] == 0
    assert result.doorplates == "updated", "一種資料失敗不擋其他"


async def test_oversized_kindergarten_registry_is_refused(app, small_minimum, monkeypatch):
    good, _ = _site()
    await _sync(app, good)
    assert await _counts(app) == (73, 10)
    monkeypatch.setattr(sync, "KINDERGARTEN_REGISTRY_MAX_BYTES", 100)
    assert len((FIXTURES / "kindergarten-registry-sample.csv").read_bytes()) > 100

    result = await _sync(app, good, force=True)

    assert result.kindergartens == "failed"
    assert "超過大小上限" in (await _last_error(app, "kindergartens") or "")
    assert (await _counts(app))[1] == 10, "名單被拒絕時幼兒園資料不動"
    assert result.doorplates == "updated", "一種資料失敗不擋其他"


async def test_oversized_population_page_is_refused(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "POPULATION_PAGE_MAX_BYTES", 100)
    good, _ = _site(population_months={"11509"})

    result = await _sync(app, good, force=True)

    assert result.population == "failed"
    assert "超過大小上限" in (await _last_error(app, "population") or "")


async def test_oversized_doorplate_download_keeps_the_active_version(app, small_minimum, monkeypatch):
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version
    monkeypatch.setattr(sync, "DOORPLATE_MAX_BYTES", 400)
    csv = (FIXTURES / "doorplates-sample.csv").read_bytes()
    assert len(csv) > 400

    def replace(url):
        if url == CSV_URL:
            return _chunked([csv[i : i + 100] for i in range(0, len(csv), 100)], **{"content-type": "text/csv"})

    result = await _sync(app, _wrap(good, replace), force=True)

    assert result.doorplates == "failed"
    status = await _status(app, "doorplates")
    assert status.active_version == active and "超過大小上限" in status.last_error
    assert await _counts(app) == (73, 10), "中斷的批次已清掉"


async def test_a_line_without_newline_cannot_grow_without_bound(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "DOORPLATE_MAX_LINE_CHARS", 1000)
    good, _ = _site()
    header = (FIXTURES / "doorplates-sample.csv").read_bytes().splitlines()[0]

    def replace(url):
        if url == CSV_URL:
            return _chunked([header + b"\n"] + [b"x" * 400] * 10, **{"content-type": "text/csv"})

    result = await _sync(app, _wrap(good, replace), force=True)

    assert result.doorplates == "failed"
    assert "超過大小上限" in (await _last_error(app, "doorplates") or "")


async def test_doorplate_row_cap_aborts_the_import_and_removes_the_batch(app, small_minimum, monkeypatch):
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version
    monkeypatch.setattr(sync, "DOORPLATE_MAX_ROWS", 30)

    result = await _sync(app, good, force=True)

    assert result.doorplates == "failed"
    status = await _status(app, "doorplates")
    assert status.active_version == active and "超過列數上限" in status.last_error
    assert await _counts(app) == (73, 10)


async def test_normal_sized_downloads_still_import(app, small_minimum):
    good, _ = _site()

    result = await _sync(app, good)

    assert (result.doorplates, result.kindergartens) == ("updated", "updated")
    assert await _counts(app) == (73, 10)


async def test_a_stalled_source_is_cancelled_by_the_time_budget(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "KINDERGARTENS_TIME_BUDGET", timedelta(seconds=0.3))
    good, _ = _site()

    async def stalled():
        yield b"["
        await asyncio.sleep(30)
        yield b"]"

    def replace(url):
        if url == KIANG_URL:
            return httpx.Response(200, content=stalled(), headers={"content-type": "application/json"})

    result = await asyncio.wait_for(_sync(app, _wrap(good, replace), force=True), 20)

    assert result.kindergartens == "failed"
    assert "同步超過" in (await _last_error(app, "kindergartens") or "")
    assert result.doorplates == "updated", "一種資料逾時不擋其他"
