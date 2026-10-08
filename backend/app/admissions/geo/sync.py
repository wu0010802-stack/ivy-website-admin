"""公開地理資料同步（docs/specs/2026-10-08-admissions-area-design.md §7）：高雄市門牌、
幼兒園；門牌換版或校址變更後重算訪視。

只下載公開資料，不送出任何家長資料。兩種資料各自成敗：失敗只寫
geo_dataset_status.last_error（不含地址）並保留使用中的版本。

兩種用法：
- 背景（app/workers/geo_loop.py，每天一次）：各自超過 30 天沒確認過才去看來源；門牌
  先找最新月份，月份和使用中的一樣就不下載。
- 手動（`python -m app.cli geo-sync`）：可加 --force 立刻重抓；或用 --doorplates-file／
  --kindergartens-file 指定本機檔案，這時完全不連外，沒指定檔案的那一種跳過。
  指定檔案不檢查筆數下限（人工指定的檔案，含 stack 測試用的小樣本）。

高雄市資料開放平台（data.kcg.gov.tw，2026 年改版後不是 CKAN，/api/3 回 404）：
- 搜尋頁 /dataset?keyword=門牌坐標資料：每年一個資料集，連結 title「高雄市115年門牌坐標資料-TWD97」；
- 資料集頁：每月一個資源，連結 title「115年10月門牌坐標資料」、href /Resource/<guid>；
- 檔案 /File/DirectDownload/<guid>（text/csv、UTF-8 帶 BOM；HEAD 回 405、Range 被忽略）。
頁面上的 title 是 HTML 實體編碼，先 html.unescape 再比對。

同一時間只允許一個同步（CLI、背景迴圈、多個副本都一樣）：run_geo_sync 開頭取 session 級
advisory lock，整個同步期間持有。否則後到的同步開頭清「使用中以外的批次」，會刪掉先到的
同步剛寫好的列，先到的同步卻以為整批都在而換版。"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.academic import current_term
from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo.kindergartens import KindergartenFormatError, parse_preschools, replace_kindergartens
from app.admissions.geo.matcher import active_doorplate_version, rematch_visits
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.campuses.models import CAMPUS_KEYS
from app.common.timezones import today_local
from app.config import Settings
from app.content import service as content_service

logger = logging.getLogger("app.admissions.geo.sync")

KCG_BASE = "https://data.kcg.gov.tw"
KCG_SEARCH_URL = f"{KCG_BASE}/dataset?keyword={quote('門牌坐標資料')}"
REFRESH_AFTER = timedelta(days=30)
# 全市約 76 萬個基礎門牌；下載到的檔案少於這個數字多半是平台給了殘缺檔，不換版。
MIN_DOORPLATE_ROWS = 500_000
USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-geo-sync/1.0)"
LOCK_KEY = "ivy-website:geo-sync"
# 月份只認 ASCII 數字；檔名裡的「667aae8f-d427-488b」「20261008_1」這類不是月份（前面不能接數字、
# 後面不能接數字），月份要在 1–12。
_LABEL = re.compile(r"([0-9]{3})-([0-9]{2})")
_LABEL_IN_FILENAME = re.compile(r"(?<![0-9])([0-9]{3})[-_年]([0-9]{1,2})(?![0-9])")
_DATASET_LINK = re.compile(r'title="高雄市(\d{3})年門牌坐標資料-TWD97"\s+href="(/DataSet/Detail/[0-9a-f-]{36})"')
_RESOURCE_LINK = re.compile(r'title="(\d{3})年(\d{1,2})月門牌坐標資料"\s+href="/Resource/([0-9a-f-]{36})"')


class GeoSyncError(RuntimeError):
    """同步失敗的原因；訊息會寫進 geo_dataset_status.last_error，不得含地址。"""


class InvalidDoorplateLabel(GeoSyncError, ValueError):
    """指定的門牌月份不是「115-10」這種格式（月份 01–12）。"""


class GeoSyncBusy(RuntimeError):
    """另一個公開資料同步正在進行；這一輪什麼都沒做。"""


@dataclass(frozen=True)
class DoorplateSource:
    label: str  # 「115-10」
    url: str


@dataclass
class GeoSyncResult:
    doorplates: str  # "skipped" | "updated" | "failed"
    kindergartens: str
    doorplate_version: str | None  # 使用中的門牌月份（label）
    rematched: int


def parse_dataset_search(page: str) -> list[tuple[int, str]]:
    """搜尋頁 → [(民國年, "/DataSet/Detail/<guid>")]，新到舊。"""
    found = {(int(year), path) for year, path in _DATASET_LINK.findall(html.unescape(page))}
    return sorted(found, reverse=True)


def parse_dataset_resources(page: str) -> list[tuple[int, int, str]]:
    """資料集頁 → [(民國年, 月, guid)]，新到舊。"""
    found = {(int(year), int(month), guid) for year, month, guid in _RESOURCE_LINK.findall(html.unescape(page))}
    return sorted(found, reverse=True)


async def discover_doorplate_source(client: httpx.AsyncClient) -> DoorplateSource:
    """最新年度資料集的最新月份；最新年度還沒有資源（年初）就看前一年度。"""
    search = await client.get(KCG_SEARCH_URL)
    search.raise_for_status()
    for _, path in parse_dataset_search(search.text)[:2]:
        page = await client.get(f"{KCG_BASE}{path}")
        page.raise_for_status()
        resources = parse_dataset_resources(page.text)
        if resources:
            year, month, guid = resources[0]
            return DoorplateSource(f"{year}-{month:02d}", f"{KCG_BASE}/File/DirectDownload/{guid}")
    raise GeoSyncError("找不到高雄市門牌坐標資料的下載檔")


def current_label() -> str:
    """今天（台北）的民國年月「115-10」。"""
    today = today_local()
    return f"{today.year - 1911}-{today.month:02d}"


def label_for_file(path: Path, given: str | None) -> str:
    """指定檔案匯入時的月份：有給就驗格式；沒給就從檔名找「115-10」「115_10」「115年10」，
    再找不到用今天的民國年月。"""
    if given is not None:
        matched = _LABEL.fullmatch(given)
        if matched is None or not 1 <= int(matched.group(2)) <= 12:
            raise InvalidDoorplateLabel("門牌月份格式要像 115-10")
        return given
    for year, month in _LABEL_IN_FILENAME.findall(path.name):
        if 1 <= int(month) <= 12:
            return f"{year}-{int(month):02d}"
    return current_label()


async def _stream_rows(client: httpx.AsyncClient, url: str) -> AsyncIterator[doorplate_io.DoorplateRow]:
    parser = doorplate_io.DoorplateParser()
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        response.encoding = "utf-8"
        async for line in response.aiter_lines():
            row = parser.feed(line)
            if row is not None:
                yield row


async def _file_rows(path: Path) -> AsyncIterator[doorplate_io.DoorplateRow]:
    parser = doorplate_io.DoorplateParser()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for line in handle:
            row = parser.feed(line)
            if row is not None:
                yield row


async def _status(session_factory: async_sessionmaker[AsyncSession], dataset: str) -> GeoDatasetStatus | None:
    async with session_factory() as db:
        return await db.get(GeoDatasetStatus, dataset)


async def _record(
    session_factory: async_sessionmaker[AsyncSession],
    dataset: str,
    *,
    now: datetime,
    error: str | None = None,
    checked: bool = False,
) -> None:
    async with session_factory() as db:
        status = await db.get(GeoDatasetStatus, dataset, with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset=dataset)
            db.add(status)
        status.last_attempt_at = now
        if error is not None:
            status.last_error = error[:300]
        if checked:
            status.checked_at = now
            status.last_error = None
        await db.commit()


def _due(status: GeoDatasetStatus | None, now: datetime) -> bool:
    if status is None or status.active_version is None:
        return True
    last = status.checked_at or status.synced_at
    return last is None or now - last >= REFRESH_AFTER


async def _discard_batches(session_factory: async_sessionmaker[AsyncSession], keep: str | None) -> None:
    async with session_factory() as db:
        await doorplate_io.delete_batches(db, keep=keep)
        await db.commit()


async def _batch_rows(session_factory: async_sessionmaker[AsyncSession], tag: str) -> int:
    """資料庫裡這個批次實際有幾列（換版前和匯入時數的列數核對）。"""
    async with session_factory() as db:
        await db.execute(text("SET LOCAL statement_timeout = 0"))
        count = await db.scalar(
            select(func.count()).select_from(GeoDoorplate).where(GeoDoorplate.dataset_version == tag)
        )
        return count or 0


def _error_text(exc: Exception) -> str:
    """寫進狀態列的原因：只留我們自己的訊息或例外類別，不帶回應內容（可能很長）。"""
    if isinstance(exc, (GeoSyncError, doorplate_io.DoorplateFormatError, KindergartenFormatError)):
        return str(exc)
    if isinstance(exc, httpx.HTTPStatusError):
        return f"下載失敗：HTTP {exc.response.status_code}"
    return f"下載或匯入失敗：{type(exc).__name__}"


async def sync_doorplates(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
    file_label: str | None,
) -> str:
    status = await _status(session_factory, "doorplates")
    if file is None and (client is None or (not force and not _due(status, now))):
        return "skipped"
    active = status.active_version if status else None
    try:
        # 之前中斷（停機、程序被殺）留下的半套批次，先清掉。
        await _discard_batches(session_factory, active)
        if file is not None:
            label, rows, minimum = label_for_file(file, file_label), _file_rows(file), 1
        else:
            assert client is not None
            if settings.geo_doorplate_url:
                source = DoorplateSource(current_label(), settings.geo_doorplate_url)
            else:
                source = await discover_doorplate_source(client)
            if not force and active is not None and status is not None and status.label == source.label:
                await _record(session_factory, "doorplates", now=now, checked=True)
                return "skipped"
            label, rows, minimum = source.label, _stream_rows(client, source.url), MIN_DOORPLATE_ROWS
        tag = f"{label}#{uuid.uuid4().hex[:6]}"
        count = await doorplate_io.import_doorplates(session_factory, tag, rows)
        if count < minimum:
            await _discard_batches(session_factory, active)
            raise GeoSyncError(f"門牌資料只有 {count} 筆，少於 {minimum} 筆，不換版")
        stored = await _batch_rows(session_factory, tag)
        if stored != count:
            await _discard_batches(session_factory, active)
            raise GeoSyncError(f"門牌資料匯入後資料庫有 {stored} 筆，應有 {count} 筆，不換版")
        await doorplate_io.activate_doorplates(session_factory, tag, label, now=now)
        logger.info("門牌資料已更新：%s，%s 筆", label, count)
        return "updated"
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("門牌資料同步失敗：%s", _error_text(exc))
        await _record(session_factory, "doorplates", now=now, error=_error_text(exc))
        return "failed"


async def sync_kindergartens(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
) -> str:
    status = await _status(session_factory, "kindergartens")
    if file is None and (client is None or (not force and not _due(status, now))):
        return "skipped"
    try:
        if file is not None:
            data = json.loads(file.read_text(encoding="utf-8-sig"))
        else:
            assert client is not None
            response = await client.get(settings.geo_kindergartens_url)
            response.raise_for_status()
            data = response.json()
        school_year, _ = current_term(today_local())
        rows = parse_preschools(data, school_year=school_year)
        async with session_factory() as db:
            await replace_kindergartens(db, rows, synced_at=now)
            await db.commit()
        logger.info("幼兒園資料已更新：%s 所", len(rows))
        return "updated"
    except Exception as exc:  # noqa: BLE001
        logger.warning("幼兒園資料同步失敗：%s", _error_text(exc))
        await _record(session_factory, "kindergartens", now=now, error=_error_text(exc))
        return "failed"


async def campus_fingerprint(db: AsyncSession) -> str:
    """各校已發布校址＋使用中門牌批次的指紋；任一個變了就要重算訪視。"""
    addresses = []
    for key in CAMPUS_KEYS:
        profile = await content_service.published_payload(db, "campus_profile", key) or {}
        addresses.append([key, str(profile.get("address") or "").strip()])
    digest = hashlib.sha1(json.dumps(addresses, ensure_ascii=False).encode()).hexdigest()
    return f"{digest}|{await active_doorplate_version(db) or ''}"


async def rematch_if_changed(session_factory: async_sessionmaker[AsyncSession], *, now: datetime) -> int:
    async with session_factory() as db:
        fingerprint = await campus_fingerprint(db)
        status = await db.get(GeoDatasetStatus, "campuses")
        if status is not None and status.active_version == fingerprint:
            return 0
        rematched = await rematch_visits(db)
        status = await db.get(GeoDatasetStatus, "campuses", with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset="campuses")
            db.add(status)
        status.active_version = fingerprint
        status.synced_at = now
        await db.commit()
        return rematched


@asynccontextmanager
async def _exclusive(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[None]:
    """整個同步期間持有 session 級 advisory lock；拿不到就 GeoSyncBusy。

    鎖放在專用連線上，用 AUTOCOMMIT：不開交易，下載幾分鐘也不會被 idle_in_transaction
    逾時收回，也不會讓交易一直開著。"""
    engine = session_factory.kw["bind"]
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        acquired = await conn.scalar(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": LOCK_KEY})
        if not acquired:
            raise GeoSyncBusy("另一個公開資料同步正在進行")
        try:
            yield
        finally:
            try:
                await conn.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": LOCK_KEY})
            except Exception:  # noqa: BLE001 - 解鎖失敗就丟掉這條連線，鎖隨連線結束釋放，不能還回連線池
                logger.warning("公開資料同步鎖解除失敗，關閉該連線")
                await conn.invalidate()


async def run_geo_sync(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    force: bool = False,
    doorplates_file: Path | None = None,
    doorplates_version: str | None = None,
    kindergartens_file: Path | None = None,
    client: httpx.AsyncClient | None = None,
) -> GeoSyncResult:
    async with _exclusive(session_factory):
        now = datetime.now(timezone.utc)
        file_mode = doorplates_file is not None or kindergartens_file is not None
        own_client = client is None and not file_mode
        if own_client:
            client = httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=15.0), headers={"User-Agent": USER_AGENT}, follow_redirects=True
            )
        network = None if file_mode else client
        try:
            doorplates = await sync_doorplates(
                session_factory, settings, network,
                now=now, force=force, file=doorplates_file, file_label=doorplates_version,
            )
            kindergartens = await sync_kindergartens(
                session_factory, settings, network, now=now, force=force, file=kindergartens_file
            )
        finally:
            if own_client and client is not None:
                await client.aclose()
        rematched = await rematch_if_changed(session_factory, now=now)
        status = await _status(session_factory, "doorplates")
        return GeoSyncResult(doorplates, kindergartens, status.label if status else None, rematched)
