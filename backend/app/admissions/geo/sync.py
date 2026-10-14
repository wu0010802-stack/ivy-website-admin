"""公開地理資料同步（docs/specs/2026-10-08-admissions-area-design.md §7）：高雄市門牌、
幼兒園、各里人口（2026-10-13 招生機會規格 §4）、托嬰名單（2026-10-14 規格 §4）；門牌換版或校址變更後重算訪視。

只下載公開資料，不送出任何家長資料。四種資料各自成敗：失敗只寫
geo_dataset_status.last_error（不含地址）並保留使用中的版本。

兩種用法：
- 背景（app/workers/geo_loop.py，每天一次）：門牌、各里人口超過 30 天沒確認過，幼兒園與托嬰超過 7 天
  （providers.PROVIDER_REFRESH_AFTER）才去看來源；門牌先找最新月份，月份和使用中的一樣就不下載。
- 手動（`python -m app.cli geo-sync`）：可加 --force 立刻重抓；或用 --doorplates-file／
  --kindergartens-file／--babycare-file／--population-file 指定本機檔案，這時完全不連外，沒指定檔案的那幾種跳過。
  門牌檔不檢查筆數下限（人工指定的檔案，含 stack 測試用的小樣本）；幼兒園與托嬰的檔案一樣過殘缺檔檢查
  （P9：上次營業中至少 20 所，新檔營業中少於上次的 80% 就不換版，原因寫進 last_error），--force 一個旗標
  同時代表「立刻重抓」與「略過殘缺檔檢查」。

高雄市資料開放平台（data.kcg.gov.tw，2026 年改版後不是 CKAN，/api/3 回 404）：
- 搜尋頁 /dataset?keyword=門牌坐標資料：每年一個資料集，連結 title「高雄市115年門牌坐標資料-TWD97」；
- 資料集頁：每月一個資源，連結 title「115年10月門牌坐標資料」、href /Resource/<guid>；
- 檔案 /File/DirectDownload/<guid>（text/csv、UTF-8 帶 BOM；HEAD 回 405、Range 被忽略）。
頁面上的 title 是 HTML 實體編碼，用 html.parser 讀 <a> 的屬性（實體會還原；屬性順序、
單雙引號、中間夾別的屬性都不影響）。

內政部戶政司 ODRP014（各里人口，population.py）：網址帶民國年月與頁碼，還沒公布的月份回
「查無資料」；從上一個月往回找第一個有資料的月份，再把全部頁數抓完、篩出高雄市。

網址一律 https：客戶端的 request hook 檢查每一跳（含轉址），被導到 http 就在送出前擋下。

同一時間只允許一個同步（CLI、背景迴圈、多個副本都一樣）：run_geo_sync 開頭取 session 級
advisory lock，整個同步期間持有。否則後到的同步開頭清「使用中以外的批次」，會刪掉先到的
同步剛寫好的列，先到的同步卻以為整批都在而換版。"""

from __future__ import annotations

import asyncio
import codecs
import hashlib
import itertools
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.academic import current_term
from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo import population as population_io
from app.admissions.geo import providers
from app.admissions.geo.babycare import BabycareFormatError, parse_babycare
from app.admissions.geo.kindergartens import KindergartenFormatError, ParseReport, parse_preschools
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
# 月份只認 ASCII 數字；檔名裡的「667aae8f-d427-488b」「20261008_1」這類不是月份（年份前面不能接數字、
# 月份後面不能接英數），月份要在 1–12。年份前面可以接英文字母（「kcg115-10.csv」「report115_10.csv」
# 是正常檔名）；月份後面排除英文字母：隨機 GUID 檔名有一段像「b123-12de」「a123-1a」時不能誤判。
_LABEL = re.compile(r"([0-9]{3})-([0-9]{2})")
_LABEL_IN_FILENAME = re.compile(r"(?<![0-9])([0-9]{3})[-_年]([0-9]{1,2})(?![0-9A-Za-z])")
_DATASET_TITLE = re.compile(r"高雄市([0-9]{3})年門牌坐標資料-TWD97")
_DATASET_HREF = re.compile(r"/DataSet/Detail/[0-9a-f-]{36}")
_RESOURCE_TITLE = re.compile(r"([0-9]{3})年([0-9]{1,2})月門牌坐標資料")
_RESOURCE_HREF = re.compile(r"/Resource/([0-9a-f-]{36})")
# 指定本機檔案時，每次交給執行緒讀取與解析的行數。
FILE_CHUNK_LINES = 5000
# 各里人口從上一個月往回找幾個月：戶政司通常在次月中旬公布，往回 4 個月夠涵蓋偶爾的延遲。
POPULATION_LOOKBACK_MONTHS = 4

# 上游回應的大小與同步時間上限（2026-10-13 深度掃描 12、13）：同步在 API 同一支程序裡跑，上游內容的
# 發布者不該能用超大回應耗盡記憶體、或用超量的列數填滿共用資料庫。都是正常值的好幾倍，只擋失控的來源。
# 位元組數以解壓縮後計（壓縮炸彈也擋）。
HTML_MAX_BYTES = 2 * 1024 * 1024  # 高雄市資料平台的搜尋頁與資料集頁（正常約數百 KB）
KINDERGARTENS_MAX_BYTES = 64 * 1024 * 1024  # 全國幼兒園名單（正常約十 MB）
BABYCARE_MAX_BYTES = 8 * 1024 * 1024  # 托嬰名單（正常約 1.4 MB）
POPULATION_PAGE_MAX_BYTES = 32 * 1024 * 1024  # 各里人口每一頁（正常約 10 MB）
DOORPLATE_MAX_BYTES = 400 * 1024 * 1024  # 門牌 CSV（正常約 102 MB）
DOORPLATE_MAX_ROWS = 1_500_000  # 匯入資料庫的門牌列數（全市正常約 76 萬）
DOORPLATE_MAX_LINE_CHARS = 64 * 1024  # 單行長度：沒有換行的串流不能無限長大
# 單一資料種類從開始到結束的時間上限（逾時中止、寫進狀態列）。
DOORPLATE_TIME_BUDGET = timedelta(minutes=45)
KINDERGARTENS_TIME_BUDGET = timedelta(minutes=10)
BABYCARE_TIME_BUDGET = timedelta(minutes=5)
POPULATION_TIME_BUDGET = timedelta(minutes=30)


class GeoSyncError(RuntimeError):
    """同步失敗的原因；訊息會寫進 geo_dataset_status.last_error，不得含地址。"""


class ResponseTooLarge(GeoSyncError):
    """上游回應超過大小上限；訊息不含網址與內容。"""


class InvalidDoorplateLabel(GeoSyncError, ValueError):
    """指定的門牌月份不是「115-10」這種格式（月份 01–12）。"""


class GeoSyncBusy(RuntimeError):
    """另一個公開資料同步正在進行；這一輪什麼都沒做。"""


async def _require_https(request: httpx.Request) -> None:
    """每一個請求（含轉址的每一跳）送出前檢查：不是 https 就不送。設定只驗了起始網址，
    轉址目的地要靠這裡擋。訊息不含網址（狀態列會顯示）。"""
    if request.url.scheme != "https":
        raise GeoSyncError("下載網址不是 https，已拒絕")


def new_client(*, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """同步用的 HTTP 客戶端：會跟轉址，但只跟 https。transport 給測試換成假網站。"""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=15.0),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        event_hooks={"request": [_require_https]},
        transport=transport,
    )


def _too_large() -> ResponseTooLarge:
    return ResponseTooLarge("上游回應超過大小上限，已中止")


def _declared_too_large(response: httpx.Response, max_bytes: int) -> bool:
    declared = response.headers.get("content-length", "")
    return declared.isdigit() and int(declared) > max_bytes


async def _fetch_capped(client: httpx.AsyncClient, url: str, *, max_bytes: int) -> tuple[bytes, str]:
    """GET 並串流收本文，解壓縮後超過 max_bytes 就在收滿之前中止（回傳 (本文, 編碼)）。HTTP 錯誤照 raise_for_status 丟。"""
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        if _declared_too_large(response, max_bytes):
            raise _too_large()
        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > max_bytes:
                raise _too_large()
            chunks.append(chunk)
        return b"".join(chunks), response.encoding or "utf-8"


async def _fetch_text(client: httpx.AsyncClient, url: str, *, max_bytes: int) -> str:
    body, encoding = await _fetch_capped(client, url, max_bytes=max_bytes)
    return body.decode(encoding, errors="replace")


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
    # 這一輪解析時略過的列數（欄位超長、座標不合格等；門牌檔本來就有約 800 列不是一般門牌）。
    doorplate_rows_skipped: int = 0
    kindergarten_rows_skipped: int = 0
    # 各里人口（2026-10-13）：結果、使用中的月份（label）、對不到里界而略過的高雄列數。
    population: str = "skipped"
    population_version: str | None = None
    population_rows_skipped: int = 0
    # 托嬰名單（2026-10-14）：結果、解析時略過的筆數。
    babycare: str = "skipped"
    babycare_rows_skipped: int = 0


class _AnchorCollector(HTMLParser):
    """頁面上所有 <a> 的屬性（名稱小寫；屬性值的 HTML 實體已還原）。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self.anchors.append({name: value or "" for name, value in attrs})


def _anchors(page: str) -> list[dict[str, str]]:
    collector = _AnchorCollector()
    collector.feed(page)
    collector.close()
    return collector.anchors


def parse_dataset_search(page: str) -> list[tuple[int, str]]:
    """搜尋頁 → [(民國年, "/DataSet/Detail/<guid>")]，新到舊。"""
    found = set()
    for anchor in _anchors(page):
        title, href = _DATASET_TITLE.fullmatch(anchor.get("title", "")), anchor.get("href", "")
        if title is not None and _DATASET_HREF.fullmatch(href):
            found.add((int(title.group(1)), href))
    return sorted(found, reverse=True)


def parse_dataset_resources(page: str) -> list[tuple[int, int, str]]:
    """資料集頁 → [(民國年, 月, guid)]，新到舊。"""
    found = set()
    for anchor in _anchors(page):
        title, href = _RESOURCE_TITLE.fullmatch(anchor.get("title", "")), _RESOURCE_HREF.fullmatch(anchor.get("href", ""))
        if title is not None and href is not None:
            found.add((int(title.group(1)), int(title.group(2)), href.group(1)))
    return sorted(found, reverse=True)


async def discover_doorplate_source(client: httpx.AsyncClient) -> DoorplateSource:
    """最新年度資料集的最新月份；最新年度還沒有資源、或資料集頁暫時打不開（年初新年度的頁面
    常常先列在搜尋頁、內容還沒上線，回 404／500）就看前一年度。兩年都沒有就丟錯：兩頁都是 HTTP
    錯誤時丟最後一個，讓狀態列寫出 HTTP 狀態碼。"""
    pages = parse_dataset_search(await _fetch_text(client, KCG_SEARCH_URL, max_bytes=HTML_MAX_BYTES))[:2]
    errors: list[httpx.HTTPStatusError] = []
    for _, path in pages:
        try:
            page_text = await _fetch_text(client, f"{KCG_BASE}{path}", max_bytes=HTML_MAX_BYTES)
        except httpx.HTTPStatusError as exc:
            logger.warning("門牌資料集頁 %s 回 HTTP %s，改看前一年度", path, exc.response.status_code)
            errors.append(exc)
            continue
        resources = parse_dataset_resources(page_text)
        if resources:
            year, month, guid = resources[0]
            return DoorplateSource(f"{year}-{month:02d}", f"{KCG_BASE}/File/DirectDownload/{guid}")
    # 每一頁都是 HTTP 錯誤才報狀態碼；有一頁打得開只是沒有下載檔（新年度還沒上線）時，
    # 原因是「找不到下載檔」，不是另一頁的 HTTP 錯誤（2026-10-13）。
    if pages and len(errors) == len(pages):
        raise errors[-1]
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


def _parse_lines(parser: doorplate_io.DoorplateParser, lines: list[str]) -> list[doorplate_io.DoorplateRow]:
    """解析一塊已下載的行（在執行緒裡跑）。"""
    return [row for row in map(parser.feed, lines) if row is not None]


async def _capped_lines(response: httpx.Response, *, max_bytes: int) -> AsyncIterator[str]:
    """下載中的行（UTF-8，以 \n 分行）。解壓縮後的總位元組與單行長度都有上限：串流可以很長，
    但不能一路長大到耗盡記憶體（單行沒有換行時 aiter_lines 會一直暫存）。"""
    if _declared_too_large(response, max_bytes):
        raise _too_large()
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    pending = ""
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise _too_large()
        lines = (pending + decoder.decode(chunk)).split("\n")
        pending = lines.pop()
        if len(pending) > DOORPLATE_MAX_LINE_CHARS:
            raise _too_large()
        for line in lines:
            yield line
    pending += decoder.decode(b"", final=True)
    if pending:
        yield pending


async def _stream_rows(
    client: httpx.AsyncClient, url: str, parser: doorplate_io.DoorplateParser
) -> AsyncIterator[doorplate_io.DoorplateRow]:
    """下載中的門牌列。全市約 129 萬行、每行約 30 µs，逐行在事件迴圈上解析會讓 API 連續卡住近一分鐘
    （官網的預約、內容請求跟著排隊）；同 _file_rows 收滿 FILE_CHUNK_LINES 行交給執行緒解析一次。"""
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        lines: list[str] = []
        async for line in _capped_lines(response, max_bytes=DOORPLATE_MAX_BYTES):
            lines.append(line)
            if len(lines) >= FILE_CHUNK_LINES:
                for row in await asyncio.to_thread(_parse_lines, parser, lines):
                    yield row
                lines = []
        for row in await asyncio.to_thread(_parse_lines, parser, lines):
            yield row


def _read_chunk(handle, parser: doorplate_io.DoorplateParser, count: int) -> tuple[list[doorplate_io.DoorplateRow], bool]:
    """從 handle 再讀 count 行並解析（在執行緒裡跑）。回傳 (解析出的列, 檔案是否已經讀完)。"""
    rows = []
    lines = 0
    for line in itertools.islice(handle, count):
        lines += 1
        row = parser.feed(line)
        if row is not None:
            rows.append(row)
    return rows, lines < count


async def _file_rows(path: Path, parser: doorplate_io.DoorplateParser) -> AsyncIterator[doorplate_io.DoorplateRow]:
    """本機檔案的列。讀檔與解析（約 76 萬列、數秒的 CPU）交給執行緒、FILE_CHUNK_LINES 行一塊：
    每一塊之間事件迴圈可以處理別的工作，而不是整份讀完才讓出一次。parser 同一時間只被一個
    執行緒用（await 期間這個產生器自己停著）。"""
    with path.open(encoding="utf-8-sig", newline="") as handle:
        finished = False
        while not finished:
            rows, finished = await asyncio.to_thread(_read_chunk, handle, parser, FILE_CHUNK_LINES)
            for row in rows:
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


def _due(status: GeoDatasetStatus | None, now: datetime, interval: timedelta = REFRESH_AFTER) -> bool:
    if status is None or status.active_version is None:
        return True
    last = status.checked_at or status.synced_at
    return last is None or now - last >= interval


def _provider_due(status: GeoDatasetStatus | None, now: datetime) -> bool:
    """幼兒園、托嬰（規格 P10）：每 7 天看一次來源；基準日還是空的（還沒用異動比對的程式同步過，
    例如既有的幼兒園資料）立刻到期，上線後第一輪就補上設立日與基準。"""
    return _due(status, now, providers.PROVIDER_REFRESH_AFTER) or status.baseline_on is None


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
    own = (
        GeoSyncError,
        doorplate_io.DoorplateFormatError,
        doorplate_io.DoorplateTooManyRows,
        KindergartenFormatError,
        BabycareFormatError,
        providers.ProviderShrunk,
        population_io.PopulationFormatError,
    )
    if isinstance(exc, own):
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
) -> tuple[str, int]:
    """回傳 (結果, 略過的列數)。"""
    status = await _status(session_factory, "doorplates")
    if file is None and (client is None or (not force and not _due(status, now))):
        return "skipped", 0
    active = status.active_version if status else None
    parser = doorplate_io.DoorplateParser()
    try:
        # 之前中斷（停機、程序被殺）留下的半套批次，先清掉。
        await _discard_batches(session_factory, active)
        if file is not None:
            label, rows, minimum = label_for_file(file, file_label), _file_rows(file, parser), 1
        else:
            assert client is not None
            if settings.geo_doorplate_url:
                source = DoorplateSource(current_label(), settings.geo_doorplate_url)
            else:
                source = await discover_doorplate_source(client)
            if not force and active is not None and status is not None and status.label == source.label:
                await _record(session_factory, "doorplates", now=now, checked=True)
                return "skipped", 0
            if active is not None and status is not None and status.label and source.label < status.label:
                # 最新年度頁暫時出錯、退回前一年度時會走到這裡：不能拿舊月份換掉較新的，也不算確認過
                # （不更新 checked_at，明天再看）。標記是固定寬度的「115-10」，字串比較就是時間先後。
                logger.warning("門牌來源最新只找到 %s，比使用中的 %s 舊，不更新", source.label, status.label)
                return "skipped", 0
            label, rows, minimum = source.label, _stream_rows(client, source.url, parser), MIN_DOORPLATE_ROWS
        tag = f"{label}#{uuid.uuid4().hex[:6]}"
        count = await doorplate_io.import_doorplates(session_factory, tag, rows, max_rows=DOORPLATE_MAX_ROWS)
        if count < minimum:
            await _discard_batches(session_factory, active)
            raise GeoSyncError(f"門牌資料只有 {count} 筆，少於 {minimum} 筆，不換版")
        stored = await _batch_rows(session_factory, tag)
        if stored != count:
            await _discard_batches(session_factory, active)
            raise GeoSyncError(f"門牌資料匯入後資料庫有 {stored} 筆，應有 {count} 筆，不換版")
        await doorplate_io.activate_doorplates(session_factory, tag, label, now=now)
        logger.info("門牌資料已更新：%s，%s 筆，略過 %s 列", label, count, parser.skipped)
        return "updated", parser.skipped
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("門牌資料同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "doorplates", now=now, error=_error_text(exc))
        return "failed", 0


async def sync_kindergartens(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
) -> tuple[str, int]:
    """回傳 (結果, 略過的筆數)。"""
    status = await _status(session_factory, "kindergartens")
    if file is None and (client is None or (not force and not _provider_due(status, now))):
        return "skipped", 0
    try:
        if file is not None:
            data = json.loads(file.read_text(encoding="utf-8-sig"))
        else:
            assert client is not None
            body, _ = await _fetch_capped(client, settings.geo_kindergartens_url, max_bytes=KINDERGARTENS_MAX_BYTES)
            # 全國名單有好幾 MB：解析 JSON 與篩選都在執行緒裡做，不占住事件迴圈。
            data = await asyncio.to_thread(json.loads, body)
        school_year, _ = current_term(today_local())
        report = ParseReport()
        rows = await asyncio.to_thread(parse_preschools, data, school_year=school_year, report=report)
        async with session_factory() as db:
            changes = await providers.apply_kindergartens(db, rows, synced_at=now, school_year=school_year, force=force)
            await db.commit()
        logger.info(
            "幼兒園資料已更新：%s 所，略過 %s 筆；停辦 %s、重新營業 %s、類型變動 %s",
            changes.active, report.skipped, changes.closed, changes.opened, changes.kind_changed,
        )
        return "updated", report.skipped
    except Exception as exc:  # noqa: BLE001
        logger.warning("幼兒園資料同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "kindergartens", now=now, error=_error_text(exc))
        return "failed", 0


async def sync_babycare(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
) -> tuple[str, int]:
    """托嬰名單（2026-10-14 規格 §4）。回傳 (結果, 略過的筆數)。"""
    status = await _status(session_factory, "babycare")
    if file is None and (client is None or (not force and not _provider_due(status, now))):
        return "skipped", 0
    try:
        if file is not None:
            data = json.loads(file.read_text(encoding="utf-8-sig"))
        else:
            assert client is not None
            body, _ = await _fetch_capped(client, settings.geo_babycare_url, max_bytes=BABYCARE_MAX_BYTES)
            data = await asyncio.to_thread(json.loads, body)
        report = ParseReport()
        rows = await asyncio.to_thread(parse_babycare, data, report=report)
        async with session_factory() as db:
            changes = await providers.apply_babycare(db, rows, synced_at=now, force=force)
            await db.commit()
        logger.info(
            "托嬰名單已更新：%s 所，略過 %s 筆；新增 %s、停辦 %s",
            changes.active, report.skipped, changes.opened, changes.closed,
        )
        return "updated", report.skipped
    except Exception as exc:  # noqa: BLE001
        logger.warning("托嬰名單同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "babycare", now=now, error=_error_text(exc))
        return "failed", 0


def recent_months(count: int = POPULATION_LOOKBACK_MONTHS) -> list[str]:
    """今天（台北）的上一個月起往回 count 個月的民國年月「11509」，新到舊。這個月的資料要到下個月才公布。"""
    today = today_local()
    year, month = today.year - 1911, today.month
    months = []
    for _ in range(count):
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
        months.append(f"{year}{month:02d}")
    return months


async def _population_page(client: httpx.AsyncClient, yyymm: str, page: int) -> object:
    """一頁回應，解析時就只留高雄市的列（population.parse_page）；解析在執行緒裡做，不卡住事件迴圈。"""
    text_ = await _fetch_text(client, population_io.page_url(yyymm, page), max_bytes=POPULATION_PAGE_MAX_BYTES)
    return await asyncio.to_thread(population_io.parse_page, text_)


async def discover_population_month(client: httpx.AsyncClient) -> tuple[str, object]:
    """最近一個有資料的月份與它的第一頁；最近幾個月都「查無資料」就丟錯。"""
    for yyymm in recent_months():
        first = await _population_page(client, yyymm, 1)
        if population_io.response_rows(first) is not None:
            return yyymm, first
    raise GeoSyncError("找不到最近幾個月的各里人口資料")


async def _download_population(client: httpx.AsyncClient, yyymm: str, first: object) -> population_io.PopulationBatch:
    """第一頁已經在手上：照 totalPage 把其餘頁抓完再一起驗證。中途某頁變成「查無資料」視為來源異常。"""
    pages = [population_io.response_rows(first) or []]
    for page in range(2, population_io.total_pages(first) + 1):
        rows = population_io.response_rows(await _population_page(client, yyymm, page))
        if rows is None:
            raise GeoSyncError("各里人口資料下載到一半變成查無資料")
        pages.append(rows)
    batch = population_io.collect(pages)
    if batch.label != population_io.label_of(yyymm):
        raise GeoSyncError("各里人口資料的月份和網址不一致")
    return batch


def _population_file_batch(files: list[Path]) -> population_io.PopulationBatch:
    """指定的本機檔案（API 原始回應，可多頁）。月份取資料本身的 statistic_yyymm。"""
    pages = []
    for path in files:
        rows = population_io.response_rows(population_io.parse_page(path.read_text(encoding="utf-8-sig")))
        if rows is None:
            raise GeoSyncError(f"人口檔 {path.name} 是「查無資料」的回應")
        pages.append(rows)
    return population_io.collect(pages)


async def sync_population(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    files: list[Path] | None,
) -> tuple[str, int]:
    """各里人口（2026-10-13 招生機會規格 §4）。回傳 (結果, 對不到里界而略過的高雄列數)。
    月份和使用中的一樣就不下載其餘頁、只記確認時間；比使用中的舊不換（同門牌）。
    指定檔案也一樣不退回舊月份：人口的月份取自資料本身，不像門牌可以另外指定，拿錯舊檔會讓五校共用的
    人口一起倒退，而且重新起算 30 天的更新間隔。確定要退回就加 force；網路來源連 force 也不退。"""
    status = await _status(session_factory, "population")
    if not files and (client is None or (not force and not _due(status, now))):
        return "skipped", 0
    active = status.label if status is not None and status.active_version is not None else None
    try:
        if files:
            # 幾頁 JSON、每頁約 10 MB：解析交給執行緒，不卡住事件迴圈。
            batch = await asyncio.to_thread(_population_file_batch, files)
            if not force and active is not None and batch.label < active:
                # 當成驗證不過：保留使用中的版本與時間戳，原因寫進 last_error（CLI 會印出來）。
                raise GeoSyncError(f"人口檔的月份 {batch.label} 比使用中的 {active} 舊，不匯入（真的要退回舊月份請加 --force）")
        else:
            assert client is not None
            yyymm, first = await discover_population_month(client)
            label = population_io.label_of(yyymm)
            if not force and active == label:
                await _record(session_factory, "population", now=now, checked=True)
                return "skipped", 0
            if active is not None and label < active:
                logger.warning("各里人口來源最新只找到 %s，比使用中的 %s 舊，不更新", label, active)
                return "skipped", 0
            batch = await _download_population(client, yyymm, first)
        async with session_factory() as db:
            await population_io.replace_population(db, batch, synced_at=now)
            await db.commit()
        logger.info("各里人口已更新：%s，%s 個里，略過 %s 列", batch.label, len(batch.rows), batch.skipped)
        return "updated", batch.skipped
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("各里人口同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "population", now=now, error=_error_text(exc))
        return "failed", 0


async def _within_budget(
    session_factory: async_sessionmaker[AsyncSession],
    dataset: str,
    budget: timedelta,
    *,
    now: datetime,
    work: Awaitable[tuple[str, int]],
    on_timeout: Callable[[], Awaitable[None]] | None = None,
) -> tuple[str, int]:
    """一種資料的同步有時間上限：上游一直慢慢吐資料也不能讓同步（與它持有的鎖、連線）永遠跑下去。
    逾時就取消、寫進狀態列、保留使用中的版本（on_timeout 清掉中斷留下的半套批次）。"""
    limit = asyncio.timeout(budget.total_seconds())
    try:
        async with limit:
            return await work
    except TimeoutError:
        if not limit.expired():
            raise
        seconds = int(budget.total_seconds())
        after = f"{seconds // 60} 分鐘" if seconds >= 60 else f"{seconds} 秒"
        logger.warning("%s 同步超過 %s，已中止", dataset, after)
        await _record(session_factory, dataset, now=now, error=f"同步超過 {after}，已中止")
        if on_timeout is not None:
            await on_timeout()
        return "failed", 0


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
                # shield：停機取消同步後又被取消一次時，解鎖那一步不會做到一半被打斷。
                await asyncio.shield(conn.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": LOCK_KEY}))
            except BaseException as exc:
                # 解鎖失敗或又被取消（CancelledError 不是 Exception）：鎖可能還在這條連線上，不能還回連線
                # 池——丟掉連線，鎖隨連線結束釋放。被取消時關閉動作也 shield，之後照樣把取消往上丟。
                logger.warning("公開資料同步鎖解除失敗或被取消，關閉該連線", exc_info=isinstance(exc, Exception))
                await asyncio.shield(conn.invalidate())
                if not isinstance(exc, Exception):
                    raise


async def run_geo_sync(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    force: bool = False,
    doorplates_file: Path | None = None,
    doorplates_version: str | None = None,
    kindergartens_file: Path | None = None,
    babycare_file: Path | None = None,
    population_files: list[Path] | None = None,
    client: httpx.AsyncClient | None = None,
) -> GeoSyncResult:
    async with _exclusive(session_factory):
        now = datetime.now(timezone.utc)
        file_mode = (
            doorplates_file is not None or kindergartens_file is not None or babycare_file is not None
            or bool(population_files)
        )
        own_client = client is None and not file_mode
        if own_client:
            client = new_client()
        network = None if file_mode else client
        try:
            async def discard_unfinished_doorplates() -> None:
                status = await _status(session_factory, "doorplates")
                await _discard_batches(session_factory, status.active_version if status else None)

            doorplates, doorplate_skipped = await _within_budget(
                session_factory, "doorplates", DOORPLATE_TIME_BUDGET, now=now,
                work=sync_doorplates(
                    session_factory, settings, network,
                    now=now, force=force, file=doorplates_file, file_label=doorplates_version,
                ),
                on_timeout=discard_unfinished_doorplates,
            )
            kindergartens, kindergarten_skipped = await _within_budget(
                session_factory, "kindergartens", KINDERGARTENS_TIME_BUDGET, now=now,
                work=sync_kindergartens(session_factory, settings, network, now=now, force=force, file=kindergartens_file),
            )
            babycare, babycare_skipped = await _within_budget(
                session_factory, "babycare", BABYCARE_TIME_BUDGET, now=now,
                work=sync_babycare(session_factory, settings, network, now=now, force=force, file=babycare_file),
            )
            population, population_skipped = await _within_budget(
                session_factory, "population", POPULATION_TIME_BUDGET, now=now,
                work=sync_population(session_factory, network, now=now, force=force, files=population_files),
            )
        finally:
            if own_client and client is not None:
                await client.aclose()
        rematched = await rematch_if_changed(session_factory, now=now)
        status = await _status(session_factory, "doorplates")
        population_status = await _status(session_factory, "population")
        return GeoSyncResult(
            doorplates, kindergartens, status.label if status else None, rematched,
            doorplate_rows_skipped=doorplate_skipped, kindergarten_rows_skipped=kindergarten_skipped,
            population=population,
            population_version=population_status.label if population_status and population_status.active_version else None,
            population_rows_skipped=population_skipped,
            babycare=babycare, babycare_rows_skipped=babycare_skipped,
        )
