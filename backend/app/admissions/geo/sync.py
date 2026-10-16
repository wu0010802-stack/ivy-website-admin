"""公開地理資料同步（docs/specs/2026-10-08-admissions-area-design.md §7）：高雄市門牌、
幼兒園、各里人口（2026-10-13 招生機會規格 §4）、各里出生與遷入遷出的月份歷史與一年前的年齡、
各里綜合所得、新成屋交屋（2026-10-14 里的變化規格 §4）、托嬰名單（2026-10-14 托嬰與園所異動規格 §4）、
幼兒園公告收費（2026-10-15 附近同業比較規格 §4.2）；
門牌換版或校址變更後重算訪視與新成屋。

只下載公開資料，不送出任何家長資料。每種資料各自成敗：失敗只寫
geo_dataset_status.last_error（不含地址）並保留使用中的版本。

兩種用法：
- 背景（app/workers/geo_loop.py，每天一次）：門牌、各里人口超過 30 天沒確認過，幼兒園與托嬰超過 7 天
  （providers.PROVIDER_REFRESH_AFTER）才去看來源；門牌先找最新月份，月份和使用中的一樣就不下載。
- 手動（`python -m app.cli geo-sync`）：可加 --force 立刻重抓；或用 --doorplates-file／
  --kindergartens-file／--babycare-file／--population-file／--births-file／--migration-file／--income-file／
  --new-homes-file（或 --bundle）指定本機檔案，這時完全不連外，沒指定檔案的那幾種跳過。
  幼兒園的 --kindergartens-file（JSON）要和 --kindergartens-registry-file（教育部名單）成對給，營業中以名單為準。
  指定檔案不檢查筆數下限（人工指定的檔案，含 stack 測試用的小樣本）；但幼兒園與托嬰的檔案一樣過殘缺檔檢查
  （P9：上次營業中至少 20 所，新檔營業中少於上次的 80% 就不換版，原因寫進 last_error），--force 一個旗標
  同時代表「立刻重抓」與「略過殘缺檔檢查」。
  幼兒園收費（fees.py）只在連網時做、沒有對應的檔案選項：名單同一輪更新成功才接著抓（從沒匯入成功過的
  不等 7 天），先探測最新學年，再全量（30 天一次、學年換新、--force）或只補缺。

高雄市資料開放平台（data.kcg.gov.tw，2026 年改版後不是 CKAN，/api/3 回 404）：
- 搜尋頁 /dataset?keyword=門牌坐標資料：每年一個資料集，連結 title「高雄市115年門牌坐標資料-TWD97」；
- 資料集頁：每月一個資源，連結 title「115年10月門牌坐標資料」、href /Resource/<guid>；
- 檔案 /File/DirectDownload/<guid>（text/csv、UTF-8 帶 BOM；HEAD 回 405、Range 被忽略）。
頁面上的 title 是 HTML 實體編碼，用 html.parser 讀 <a> 的屬性（實體會還原；屬性順序、
單雙引號、中間夾別的屬性都不影響）。

內政部戶政司 ODRP014（各里人口，population.py）：網址帶民國年月與頁碼，還沒公布的月份回
「查無資料」；從上一個月往回找第一個有資料的月份，再把全部頁數抓完、篩出高雄市。
ODRP061、ODRP011（出生、遷入遷出，village_series.py）同一支 API：找到最新月份後，出生往回 71 個月（表留 72 個月）、遷入遷出往回 24 個月
內表裡沒有的月份逐月補，每個月份各自一個交易。ris.gov.tw 連續快速請求會回擋頁（2026-10-14 實測），
所以每個請求之間至少隔 RIS_REQUEST_GAP_SECONDS 秒。

財政部財政資訊中心的各里所得（income.py）：每 30 天讀一次 data.gov.tw 的資料集 API，從檔案清單找年度最大、
比使用中新的高雄市檔；data.gov.tw 讀不到時直接試財政資訊中心的下一個年度（404＝還沒出）。
www.fia.gov.tw 約一半的請求被 reset（2026-10-14 實測），下載連線失敗時間隔 2、4、8 秒重試。

內政部實價登錄的新成屋（new_homes.py）：季檔依登記日切季，從使用中的下一季往後試（表空時從今天所在的季往回試），
回 HTML 錯誤頁（HTTP 200）＝那一季還沒出；最新季往回 8 季內表裡沒有的逐季補，每季一個交易。約一成請求被 reset，
同樣重試。門牌換版後同步結束時整表重比（只重比比對當時門牌月份和使用中不同的列）。

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
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.academic import current_term
from app.admissions.geo import babycare as babycare_io
from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo import fees as fees_io
from app.admissions.geo import income as income_io
from app.admissions.geo import new_homes as new_homes_io
from app.admissions.geo import population as population_io
from app.admissions.geo import providers
from app.admissions.geo import village_series as series_io
from app.admissions.geo.babycare import BabycareFormatError, parse_babycare
from app.admissions.geo.closure_backfill import BackfillFormatError, load_closure_backfill
from app.admissions.geo.kindergartens import KindergartenFormatError, ParseReport, parse_preschools, parse_registry
from app.admissions.geo.matcher import active_doorplate_version, rematch_visits
from app.admissions.geo.models import (
    GeoBabycare, GeoDatasetStatus, GeoDoorplate, GeoKindergarten, GeoKindergartenFee, GeoVillagePopulation,
)
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
# ris.gov.tw 不間斷連抓約 70 次後回了 HTML 擋頁、間隔 3 秒的都正常（2026-10-14 實測）：每個請求之間至少隔這麼久。
RIS_REQUEST_GAP_SECONDS = 3.0
# 托嬰逐所明細（2026-10-15）：一所一個請求，對 GitHub Pages 客氣一點，請求之間隔這麼久。
BABYCARE_DETAIL_GAP_SECONDS = 0.2

# 上游回應的大小與同步時間上限（2026-10-13 深度掃描 12、13）：同步在 API 同一支程序裡跑，上游內容的
# 發布者不該能用超大回應耗盡記憶體、或用超量的列數填滿共用資料庫。都是正常值的好幾倍，只擋失控的來源。
# 位元組數以解壓縮後計（壓縮炸彈也擋）。
HTML_MAX_BYTES = 2 * 1024 * 1024  # 高雄市資料平台的搜尋頁與資料集頁（正常約數百 KB）
KINDERGARTENS_MAX_BYTES = 64 * 1024 * 1024  # 全國幼兒園名單（正常約十 MB）
KINDERGARTEN_REGISTRY_MAX_BYTES = 4 * 1024 * 1024  # 教育部高雄市幼兒園名單（正常約 200 KB）
BABYCARE_MAX_BYTES = 8 * 1024 * 1024  # 托嬰名單（正常約 1.4 MB）
BABYCARE_DETAIL_MAX_BYTES = 256 * 1024  # 托嬰逐所明細（正常約 5 KB）
POPULATION_PAGE_MAX_BYTES = 32 * 1024 * 1024  # 各里人口每一頁（正常約 10 MB）
DOORPLATE_MAX_BYTES = 400 * 1024 * 1024  # 門牌 CSV（正常約 102 MB）
DOORPLATE_MAX_ROWS = 1_500_000  # 匯入資料庫的門牌列數（全市正常約 76 萬）
DOORPLATE_MAX_LINE_CHARS = 64 * 1024  # 單行長度：沒有換行的串流不能無限長大
# 單一資料種類從開始到結束的時間上限（逾時中止、寫進狀態列）。
DOORPLATE_TIME_BUDGET = timedelta(minutes=45)
KINDERGARTENS_TIME_BUDGET = timedelta(minutes=10)
BABYCARE_DETAIL_TIME_BUDGET = timedelta(minutes=5)
BABYCARE_TIME_BUDGET = timedelta(minutes=5)
# 幼兒園收費（2026-10-15 附近同業比較 §4.2）：一所一檔，正常 37 KB；全量約 624 檔，每個請求隔 0.2 秒。
FEES_MAX_BYTES = 512 * 1024
FEES_TIME_BUDGET = timedelta(minutes=20)
FEES_REQUEST_GAP_SECONDS = 0.2
FEES_REFRESH_AFTER = timedelta(days=30)  # 規格 F7：距上次全量 30 天就全量重抓
FEES_LOOKBACK_YEARS = 3  # 規格 F6：從目前學年往回試三年
FEES_PROBES = 5
FEES_TRUNCATION_RATIO = 0.8  # 規格 F9
FEES_TRUNCATION_MIN = 20
FEES_MAX_ERROR_RATIO = 0.1
FEES_INSERT_CHUNK = 1000  # 一列 14 個參數；asyncpg 單一語句上限 32,767 個
FEES_SHRUNK_MESSAGE = "有收費的園所比上次少了兩成以上，疑似殘缺，未更新"
POPULATION_TIME_BUDGET = timedelta(minutes=30)
# 各里出生、遷入遷出（2026-10-14）：高雄一個月一頁約 0.2–1.2 MB（全國一頁約 3 MB）；出生 72 個月、遷入遷出
# 25 個月，每個請求隔 3 秒；SERIES_TIME_BUDGET 為每個資料集整輪的時間上限。
SERIES_PAGE_MAX_BYTES = 16 * 1024 * 1024
SERIES_TIME_BUDGET = timedelta(minutes=20)
# 各里所得（2026-10-14 C 段）：data.gov.tw 資料集回應（正常約 16 KB）、所得 CSV（正常約 90 KB）。
DATASET_API_MAX_BYTES = 2 * 1024 * 1024
INCOME_MAX_BYTES = 4 * 1024 * 1024
INCOME_TIME_BUDGET = timedelta(minutes=5)
# 連線被 reset（TransportError）時的重試間隔：最多重試三次。
FETCH_RETRY_WAITS = (2.0, 4.0, 8.0)
# 新成屋（2026-10-14 B 段）：一季高雄買賣檔約 3.5 MB；找新的一季最多往後試幾季。
NEW_HOMES_MAX_BYTES = 32 * 1024 * 1024
NEW_HOMES_TIME_BUDGET = timedelta(minutes=20)
NEW_HOMES_LOOKAHEAD = 2


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
    babycare_details: int = 0  # 這一輪更新了明細的托嬰數（2026-10-15）
    # 幼兒園收費（2026-10-15）：結果、這一輪抓到收費的園所數、使用中的收費學年。
    kindergarten_fees: str = "skipped"
    kindergarten_fee_schools: int = 0
    kindergarten_fees_version: str | None = None
    # 各里出生、遷入遷出（2026-10-14）：結果、表裡最新的月份、這一輪寫入的月份數；一年前的年齡回補結果。
    births: str = "skipped"
    births_version: str | None = None
    births_months: int = 0
    migration: str = "skipped"
    migration_version: str | None = None
    migration_months: int = 0
    age_history: str = "skipped"
    # 各里所得（2026-10-14 C 段）：結果、使用中的年度、對不到里界而略過的列數（115-07 調整前的舊里）。
    income: str = "skipped"
    income_version: str | None = None
    income_rows_skipped: int = 0
    # 新成屋（2026-10-14 B 段）：結果、表裡最新的季、這一輪寫入的季數、這一輪重比的列數。
    new_homes: str = "skipped"
    new_homes_version: str | None = None
    new_homes_seasons: int = 0
    new_homes_rematched: int = 0


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
        BackfillFormatError,
        BabycareFormatError,
        fees_io.FeeFormatError,
        providers.ProviderShrunk,
        population_io.PopulationFormatError,
        series_io.SeriesFormatError,
        income_io.IncomeFormatError,
        new_homes_io.NewHomesFormatError,
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
    registry_file: Path | None,
) -> tuple[str, int]:
    """回傳 (結果, 略過的筆數)。營業中以教育部名單為準（2026-10-15 規格 §3）：名單與 preschools.json
    任一抓不到或格式不對，整輪失敗、資料不動。file 與 registry_file 由 run_geo_sync 保證成對。"""
    status = await _status(session_factory, "kindergartens")
    if file is None and (client is None or (not force and not _provider_due(status, now))):
        return "skipped", 0
    try:
        if file is not None:
            assert registry_file is not None
            registry_text = registry_file.read_text(encoding="utf-8-sig")
            data = json.loads(file.read_text(encoding="utf-8-sig"))
        else:
            assert client is not None
            registry_body, _ = await _fetch_capped(
                client, settings.geo_kindergartens_registry_url, max_bytes=KINDERGARTEN_REGISTRY_MAX_BYTES
            )
            registry_text = registry_body.decode("utf-8-sig")
            body, _ = await _fetch_capped(client, settings.geo_kindergartens_url, max_bytes=KINDERGARTENS_MAX_BYTES)
            # 全國名單有好幾 MB：解析 JSON 與篩選都在執行緒裡做，不占住事件迴圈。
            data = await asyncio.to_thread(json.loads, body)
        registry = parse_registry(registry_text)
        backfill = load_closure_backfill()  # 2026-10-15 規格 §5：檔案不對就整輪失敗，不靠猜
        school_year, _ = current_term(today_local())
        report = ParseReport()
        rows = await asyncio.to_thread(parse_preschools, data, registry=registry, school_year=school_year, report=report)
        async with session_factory() as db:
            changes = await providers.apply_kindergartens(
                db, rows, synced_at=now, school_year=school_year, force=force, backfill=backfill,
                listed_places=registry.places,
            )
            await db.commit()
        logger.info(
            "幼兒園資料已更新：%s 所，略過 %s 筆、名單有但沒有座標 %s 筆、有幼童專用車 %s 所；停辦事件 %s、"
            "依回補檔下架 %s、改名下架 %s、重新營業 %s、類型變動 %s",
            changes.active, report.skipped, report.unplaced, sum(1 for row in rows if row.has_shuttle is True),
            changes.closed, changes.backfilled, changes.renamed, changes.opened, changes.kind_changed,
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


async def babycare_details_missing(session_factory: async_sessionmaker[AsyncSession]) -> bool:
    """有營業中的托嬰、卻沒有一所抓過明細（上線第一輪）。"""
    async with session_factory() as db:
        active = await db.scalar(select(func.count()).select_from(GeoBabycare).where(GeoBabycare.is_active.is_(True)))
        filled = await db.scalar(
            select(func.count()).select_from(GeoBabycare).where(GeoBabycare.is_active.is_(True), GeoBabycare.quasi_public.is_not(None))
        )
    return bool(active) and not filled


async def sync_babycare_details(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    *,
    now: datetime,
    only_if_missing: bool = False,
) -> int:
    """托嬰逐所明細（2026-10-15 規格 §4.3）：回傳更新了幾所。這一段怎麼失敗都不丟例外、不改 babycare 的
    同步結果與狀態列，只寫 WARNING 日誌與計數：單所失敗（含回應解析不出任何欄位）保留舊值、繼續下一所；
    資料庫出錯就中止這一段；整段有硬性時間上限（到了直接取消進行中的請求），沒抓的下一輪再抓。
    only_if_missing：名單這一輪沒更新時用，只有營業中的托嬰一所明細都沒抓過才做。"""
    updated = failed = 0
    limit = asyncio.timeout(BABYCARE_DETAIL_TIME_BUDGET.total_seconds())
    try:
        async with limit:
            if only_if_missing and not await babycare_details_missing(session_factory):
                return 0
            async with session_factory() as db:
                ids = (
                    await db.execute(
                        select(GeoBabycare.source_id).where(GeoBabycare.is_active.is_(True)).order_by(GeoBabycare.source_id)
                    )
                ).scalars().all()
            for source_id in ids:
                try:
                    body, _ = await _fetch_capped(client, babycare_io.detail_url(source_id), max_bytes=BABYCARE_DETAIL_MAX_BYTES)
                    values = asdict(babycare_io.parse_babycare_detail(json.loads(body)))
                    if all(value is None for value in values.values()):
                        raise BabycareFormatError("明細沒有任何可用欄位")  # 上游改版回空內容：保留舊值
                except Exception as exc:  # noqa: BLE001 - 一所壞掉不擋其他
                    failed += 1
                    logger.warning("托嬰明細下載或解析失敗（%s）：%s", source_id, _error_text(exc))
                else:
                    async with session_factory() as db:
                        await db.execute(update(GeoBabycare).where(GeoBabycare.source_id == source_id).values(**values))
                        await db.commit()
                    updated += 1
                await _sleep(BABYCARE_DETAIL_GAP_SECONDS)
    except Exception as exc:  # noqa: BLE001 - 這一段失敗不影響 babycare 的結果與後面的資料種類
        if isinstance(exc, TimeoutError) and limit.expired():
            seconds = int(BABYCARE_DETAIL_TIME_BUDGET.total_seconds())
            after = f"{seconds // 60} 分鐘" if seconds >= 60 else f"{seconds} 秒"
            logger.warning("托嬰明細超過 %s，這一輪先停：已更新 %s 所，其餘下一輪再抓", after, updated)
        else:
            logger.warning("托嬰明細同步中止：%s", _error_text(exc), exc_info=True)
    logger.info("托嬰明細已更新：%s 所，失敗 %s 所", updated, failed)
    return updated


async def _fetch_slip(client: httpx.AsyncClient, url: str) -> dict | None:
    """一所的收費檔：404 回 None（沒有公布收費）；其他錯誤照丟。"""
    try:
        body, _ = await _fetch_capped(client, url, max_bytes=FEES_MAX_BYTES)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return None
        raise
    return json.loads(body)


async def _latest_fee_year(client: httpx.AsyncClient, titles: list[str], current_year: int) -> tuple[int | None, int]:
    """規格 F6：從目前學年往回試，探測園所裡有一所的檔案存在，那一年就是最新學年。回傳 (學年, 探測時的下載錯誤次數)；
    探測時的網路錯誤當作這所沒有、換下一所再試，找不到學年時次數會寫進原因，分得出「真的沒有」和「連線有問題」。"""
    errors = 0
    for year in range(current_year, current_year - FEES_LOOKBACK_YEARS, -1):
        for title in titles:
            try:
                found = await _fetch_slip(client, fees_io.slip_url(year, title))
            except Exception:  # noqa: BLE001 - 換下一所再試
                found = None
                errors += 1
            await _sleep(FEES_REQUEST_GAP_SECONDS)
            if found is not None:
                return year, errors
    return None, errors


async def fees_never_imported(session_factory: async_sessionmaker[AsyncSession]) -> bool:
    """收費從沒成功匯入過（上線第一輪，或之前每輪都失敗）：不等名單的 7 天，下一輪就再試。"""
    status = await _status(session_factory, "kindergarten_fees")
    return status is None or status.active_version is None


async def sync_kindergarten_fees(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    *,
    now: datetime,
    force: bool,
    only_if_never_imported: bool = False,
) -> tuple[str, int]:
    """幼兒園收費（2026-10-15 規格 §4.2）。回傳 (結果, 這一輪抓到收費的園所數)。
    全量（學年換新、距上次全量 30 天、--force、從沒匯入）通過門檻才整表替換；補缺只新增沒有收費列的園所。
    only_if_never_imported：名單這一輪沒更新時用，只有收費從沒匯入成功過才做（判斷在 try 裡，資料庫出錯也只算這一段失敗）。"""
    deadline = time.monotonic() + FEES_TIME_BUDGET.total_seconds()
    try:
        if only_if_never_imported and not await fees_never_imported(session_factory):
            return "skipped", 0
        async with session_factory() as db:
            schools = (
                await db.execute(
                    select(GeoKindergarten.source_id, GeoKindergarten.name, GeoKindergarten.kind)
                    .where(GeoKindergarten.is_active.is_(True))
                    .order_by(GeoKindergarten.source_id)
                )
            ).all()
            existing = set((await db.execute(select(GeoKindergartenFee.source_id).distinct())).scalars())
            status = await db.get(GeoDatasetStatus, "kindergarten_fees")
            stored_year = int(status.active_version) if status is not None and status.active_version else None
            last_full = status.synced_at if status is not None else None
        probes = [name for source_id, name, _ in schools if source_id in existing][:FEES_PROBES] or [
            name for _, name, kind in schools if kind in ("private", "quasi_public")
        ][:FEES_PROBES]
        current_year, _ = current_term(today_local(now))
        year, probe_errors = await _latest_fee_year(client, probes, current_year)
        if year is None:
            raise GeoSyncError("找不到任何學年的收費檔" + (f"（探測時 {probe_errors} 次下載錯誤）" if probe_errors else ""))
        if stored_year is not None and year < stored_year:
            # 規格 F4 只存最新學年：探測退到舊學年時，補缺不能把舊學年的列插進新學年的表，全量也不能把學年倒退。
            raise GeoSyncError(f"找到的收費學年（{year}）比使用中的（{stored_year}）舊，未更新")
        full = (
            force or stored_year is None or year > stored_year
            or last_full is None or now - last_full >= FEES_REFRESH_AFTER
        )
        targets = schools if full else [school for school in schools if school[0] not in existing]
        fetched: dict[str, list[fees_io.FeeRow]] = {}
        errors = 0
        timed_out = False
        for source_id, name, _ in targets:
            if time.monotonic() > deadline:
                timed_out = True
                break
            try:
                data = await _fetch_slip(client, fees_io.slip_url(year, name))
                rows = fees_io.parse_slip(data) if data is not None else []
            except Exception as exc:  # noqa: BLE001 - 一所壞掉不擋整輪，只計數
                errors += 1
                logger.warning("收費檔下載或解析失敗（%s）：%s", source_id, _error_text(exc))
            else:
                if rows:
                    fetched[source_id] = rows
            await _sleep(FEES_REQUEST_GAP_SECONDS)
        minutes = int(FEES_TIME_BUDGET.total_seconds() // 60)
        timeout_message = f"收費同步超過 {minutes} 分鐘，已中止"
        if full:
            if timed_out:
                raise GeoSyncError(timeout_message)
            if errors > len(targets) * FEES_MAX_ERROR_RATIO:
                raise GeoSyncError("收費檔下載錯誤太多，未更新")
            if len(existing) >= FEES_TRUNCATION_MIN and len(fetched) < len(existing) * FEES_TRUNCATION_RATIO:
                raise GeoSyncError(FEES_SHRUNK_MESSAGE)
        values = [
            {
                "source_id": source_id, "age": row.age, "school_year": year, "months": row.months,
                "tuition": row.tuition, "misc_fee": row.misc_fee, "materials": row.materials,
                "activities": row.activities, "lunch": row.lunch, "snack": row.snack,
                "semester_total": row.semester_total, "after_care_monthly": row.after_care_monthly,
                "transport_note": row.transport_note, "synced_at": now,
            }
            for source_id, rows in fetched.items()
            for row in rows
        ]
        async with session_factory() as db:
            if full:
                await db.execute(delete(GeoKindergartenFee))
            for start in range(0, len(values), FEES_INSERT_CHUNK):
                await db.execute(
                    pg_insert(GeoKindergartenFee).values(values[start:start + FEES_INSERT_CHUNK]).on_conflict_do_nothing()
                )
            record = await db.get(GeoDatasetStatus, "kindergarten_fees", with_for_update=True)
            if record is None:
                record = GeoDatasetStatus(dataset="kindergarten_fees")
                db.add(record)
            record.last_attempt_at = now
            record.checked_at = now
            record.last_error = timeout_message if timed_out else None  # 補缺逾時：已抓到的照寫，原因同一個交易寫進去
            if full:
                record.active_version = str(year)
                record.label = str(year)
                record.synced_at = now
            await db.commit()
        if timed_out:  # 補缺：抓到的已經寫入，但這一輪算失敗
            logger.warning("幼兒園收費補缺超過 %s 分鐘，這一輪先停：已寫入 %s 所，其餘下一輪再補", minutes, len(fetched))
            return "failed", len(fetched)
        logger.info(
            "幼兒園收費已更新：%s 學年，%s，這次抓到 %s 所、下載錯誤 %s 所",
            year, "全量" if full else "補缺", len(fetched), errors,
        )
        return "updated", len(fetched)
    except Exception as exc:  # noqa: BLE001
        logger.warning("幼兒園收費同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "kindergarten_fees", now=now, error=_error_text(exc))
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


_ris_last_request: float | None = None


async def _sleep(seconds: float) -> None:
    """測試換掉這個就不必真的等。"""
    await asyncio.sleep(seconds)


async def _ris_text(client: httpx.AsyncClient, url: str, *, max_bytes: int) -> str:
    """向 ris.gov.tw 要一頁（有大小上限，同 _fetch_text）：和上一個請求至少隔 RIS_REQUEST_GAP_SECONDS 秒
    （整個程序共用一個時鐘）。"""
    global _ris_last_request
    if _ris_last_request is not None:
        wait = RIS_REQUEST_GAP_SECONDS - (time.monotonic() - _ris_last_request)
        if wait > 0:
            await _sleep(wait)
    try:
        return await _fetch_text(client, url, max_bytes=max_bytes)
    finally:
        _ris_last_request = time.monotonic()


async def _population_page(client: httpx.AsyncClient, yyymm: str, page: int) -> object:
    """一頁回應，解析時就只留高雄市的列（population.parse_page）；解析在執行緒裡做，不卡住事件迴圈。"""
    text_ = await _ris_text(client, population_io.page_url(yyymm, page), max_bytes=POPULATION_PAGE_MAX_BYTES)
    return await asyncio.to_thread(population_io.parse_page, text_)


async def discover_population_month(client: httpx.AsyncClient) -> tuple[str, object]:
    """最近一個有資料的月份與它的第一頁；最近幾個月都「查無資料」就丟錯。"""
    for yyymm in recent_months():
        first = await _population_page(client, yyymm, 1)
        if population_io.response_rows(first) is not None:
            return yyymm, first
    raise GeoSyncError("找不到最近幾個月的各里人口資料")


async def _download_population(
    client: httpx.AsyncClient, yyymm: str, first: object
) -> tuple[population_io.PopulationBatch, list[list[dict]]]:
    """第一頁已經在手上：照 totalPage 把其餘頁抓完再一起驗證。中途某頁變成「查無資料」視為來源異常。
    連同各頁的資料列一起回傳（年齡歷史用同一份資料，不再下載）。"""
    pages = [population_io.response_rows(first) or []]
    for page in range(2, population_io.total_pages(first) + 1):
        rows = population_io.response_rows(await _population_page(client, yyymm, page))
        if rows is None:
            raise GeoSyncError("各里人口資料下載到一半變成查無資料")
        pages.append(rows)
    batch = population_io.collect(pages)
    if batch.label != population_io.label_of(yyymm):
        raise GeoSyncError("各里人口資料的月份和網址不一致")
    return batch, pages


def _population_file_pages(files: list[Path]) -> dict[str, list[list[dict]]]:
    """指定的本機檔案（API 原始回應，一頁一檔）依資料本身的統計月份分組：月份「115-09」→ 各頁的資料列。
    全國的頁也收（解析時只留高雄）：沒有高雄列的那幾頁略過。"""
    grouped: dict[str, list[list[dict]]] = {}
    for path in files:
        rows = population_io.response_rows(population_io.parse_page(path.read_text(encoding="utf-8-sig")))
        if rows is None:
            raise GeoSyncError(f"人口檔 {path.name} 是「查無資料」的回應")
        if not rows:
            continue
        month = series_io.month_of_rows(rows)
        if month is None:
            raise GeoSyncError(f"人口檔 {path.name} 是空的或混了不同月份")
        grouped.setdefault(population_io.label_of(month), []).append(rows)
    return grouped


async def _write_population(
    session_factory: async_sessionmaker[AsyncSession],
    batch: population_io.PopulationBatch,
    pages: list[list[dict]],
    *,
    now: datetime,
) -> None:
    """換上使用中的月份，同一個交易也把這個月寫進年齡歷史（2026-10-14 規格 §4.2）。"""
    ages = series_io.collect(series_io.AGES, pages)
    async with session_factory() as db:
        await population_io.replace_population(db, batch, synced_at=now)
        await series_io.replace_month(db, series_io.AGES, ages)
        await series_io.prune(db, series_io.AGES, batch.label)
        await db.commit()


async def _write_age_history(session_factory: async_sessionmaker[AsyncSession], pages: list[list[dict]]) -> str:
    """只寫進年齡歷史（不動使用中的人口）；回傳寫入的月份。"""
    ages = series_io.collect(series_io.AGES, pages)
    async with session_factory() as db:
        await series_io.replace_month(db, series_io.AGES, ages)
        await db.commit()
    return ages.label


async def sync_population(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    files: list[Path] | None,
) -> tuple[str, int]:
    """各里人口（2026-10-13 招生機會規格 §4）。回傳 (結果, 對不到里界而略過的高雄列數)。
    月份和使用中的一樣就不下載其餘頁、只記確認時間；比使用中的舊不換（同門牌）。換上新月份時同一個交易
    也寫進年齡歷史（2026-10-14 里的變化規格 §4.2）。

    指定檔案時依統計月份分組：最新的那個月照舊當使用中的候選；比使用中的舊（或不是最新的那幾個月）
    只寫進年齡歷史、不動使用中的人口，結果是 "history"（2026-10-14 起不再當錯誤：一年前的月份要靠這條匯入）。
    人口的月份取自資料本身，舊檔不能讓五校共用的人口倒退；確定要退回就加 force。網路來源連 force 也不退。"""
    status = await _status(session_factory, "population")
    if not files and (client is None or (not force and not _due(status, now))):
        return "skipped", 0
    active = status.label if status is not None and status.active_version is not None else None
    try:
        if files:
            # 幾頁 JSON、每頁約 10 MB：解析交給執行緒，不卡住事件迴圈。
            grouped = await asyncio.to_thread(_population_file_pages, files)
            if not grouped:
                raise GeoSyncError("人口檔裡沒有高雄市的資料")
            newest = max(grouped)
            history_only = [label for label in grouped if label != newest]
            if not force and active is not None and newest < active:
                history_only.append(newest)
                newest = None
            for label in sorted(history_only):
                written = await _write_age_history(session_factory, grouped[label])
                logger.info("各里人口檔 %s 比使用中的舊，只寫進年齡歷史", written)
            if newest is None:
                return "history", 0
            batch = population_io.collect(grouped[newest])
            pages = grouped[newest]
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
            batch, pages = await _download_population(client, yyymm, first)
        await _write_population(session_factory, batch, pages, now=now)
        logger.info("各里人口已更新：%s，%s 個里，略過 %s 列", batch.label, len(batch.rows), batch.skipped)
        return "updated", batch.skipped
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("各里人口同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "population", now=now, error=_error_text(exc))
        return "failed", 0


async def sync_age_history(
    session_factory: async_sessionmaker[AsyncSession], client: httpx.AsyncClient | None, *, now: datetime
) -> str:
    """確認使用中的人口月份 M 與一年前 M−12 都在年齡歷史裡（「這一年淨增」要比這兩個月，規格 §4.2）。
    M 不在：從使用中的人口表複製（不下載；部署後第一輪就靠這個補）。M−12 不在：下載 ODRP014 那個月，
    只寫進歷史。不看 30 天間隔（只有缺的時候才下載）；沒有網路（檔案模式）時只做複製。
    失敗不影響使用中的人口，原因寫進 population 的 last_error。"""
    status = await _status(session_factory, "population")
    if status is None or status.active_version is None or status.label is None:
        return "skipped"
    current = status.label
    year_ago = series_io.shift(current, -12)
    try:
        async with session_factory() as db:
            present = await series_io.months_in_table(db, series_io.AGES)
            changed = False
            if current not in present:
                await _copy_population_to_history(db, current)
                changed = True
            await series_io.prune(db, series_io.AGES, current)
            await db.commit()
        if year_ago not in present and client is not None:
            yyymm = series_io.yyymm_of(year_ago)
            first = await _population_page(client, yyymm, 1)
            if population_io.response_rows(first) is None:
                raise GeoSyncError(f"一年前（{year_ago}）的各里人口查無資料")
            pages = [population_io.response_rows(first) or []]
            for page in range(2, population_io.total_pages(first) + 1):
                rows = population_io.response_rows(await _population_page(client, yyymm, page))
                if rows is None:
                    raise GeoSyncError("一年前的各里人口下載到一半變成查無資料")
                pages.append(rows)
            await _write_age_history(session_factory, pages)
            changed = True
        return "updated" if changed else "skipped"
    except Exception as exc:  # noqa: BLE001
        logger.warning("一年前的各里人口回補失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "population", now=now, error=f"一年前的人口：{_error_text(exc)}")
        return "failed"


async def _paired(work: Awaitable[str]) -> tuple[str, int]:
    """把只回結果的同步包成 _within_budget 要的 (結果, 數字)。"""
    return await work, 0


async def _copy_population_to_history(db: AsyncSession, month: str) -> None:
    """使用中的人口表 → 年齡歷史的那個月份（不 commit）。"""
    rows = (await db.execute(select(GeoVillagePopulation))).scalars().all()
    batch = series_io.SeriesBatch(
        label=month,
        rows=[
            {
                "month": month, "village_code": row.village_code, "district": row.district, "village": row.village,
                **{f"age_{age}": getattr(row, f"age_{age}") for age in range(7)}, "people_total": row.people_total,
            }
            for row in rows
        ],
    )
    await series_io.replace_month(db, series_io.AGES, batch)


def _series_due(status: GeoDatasetStatus | None, now: datetime, backfill_pending: bool = False) -> bool:
    """只看 checked_at（整輪回補做完才記）：回補到一半失敗時 synced_at 是新的、checked_at 沒動，
    下一輪（背景迴圈一天一次）就接著補，不必等 30 天。backfill_pending（表裡最舊月份比視窗起點晚 2 個月以上）
    時不管 checked_at 一律到期：部署把保留月數從 25 拉到 72 後，確認時間才剛記過也要馬上續補。"""
    if backfill_pending:
        return True
    if status is None or status.checked_at is None:
        return True
    return now - status.checked_at >= REFRESH_AFTER


async def _backfill_pending(session_factory: async_sessionmaker[AsyncSession], series: series_io.Series) -> bool:
    """回補還沒到頭：表裡最舊的月份比視窗起點晚 2 個月以上（容許起點那個月來源查無，不會天天重試）。
    表是空的由 status 判斷，這裡不算。"""
    async with session_factory() as db:
        months = await series_io.months_in_table(db, series)
    if not months:
        return False
    start = series_io.shift(max(months), -(series.keep_months - 1))
    return min(months) > series_io.shift(start, 1)


async def _series_page(client: httpx.AsyncClient, series: series_io.Series, yyymm: str, page: int) -> object:
    text_ = await _ris_text(client, series_io.page_url(series, yyymm, page), max_bytes=SERIES_PAGE_MAX_BYTES)
    return await asyncio.to_thread(series_io.parse_page, series, text_)


async def _download_series_month(
    client: httpx.AsyncClient, series: series_io.Series, yyymm: str, first: object | None = None
) -> series_io.SeriesBatch | None:
    """抓一個月份的全部頁並驗證；那個月份來源查無資料回 None。"""
    if first is None:
        first = await _series_page(client, series, yyymm, 1)
    rows = series_io.response_rows(series, first)
    if rows is None:
        return None
    pages = [rows]
    for page in range(2, series_io.total_pages(series, first) + 1):
        more = series_io.response_rows(series, await _series_page(client, series, yyymm, page))
        if more is None:
            raise GeoSyncError(f"{series.name}下載到一半變成查無資料")
        pages.append(more)
    batch = series_io.collect(series, pages)
    if batch.label != series_io.label_of(yyymm):
        raise GeoSyncError(f"{series.name}的月份和網址不一致")
    return batch


def _series_file_pages(series: series_io.Series, files: list[Path]) -> dict[str, list[list[dict]]]:
    grouped: dict[str, list[list[dict]]] = {}
    for path in files:
        rows = series_io.response_rows(series, series_io.parse_page(series, path.read_text(encoding="utf-8-sig")))
        if rows is None:
            raise GeoSyncError(f"{series.name}檔 {path.name} 是「查無資料」的回應")
        if not rows:
            continue  # 全國的頁裡沒有高雄列的那幾頁
        month = series_io.month_of_rows(rows)
        if month is None:
            raise GeoSyncError(f"{series.name}檔 {path.name} 是空的或混了不同月份")
        grouped.setdefault(series_io.label_of(month), []).append(rows)
    return grouped


async def _write_series_month(
    session_factory: async_sessionmaker[AsyncSession], series: series_io.Series, batch: series_io.SeriesBatch, *, now: datetime
) -> str:
    """寫入一個月份並更新狀態列（label＝表裡最新的月份），同一個交易；回傳表裡最新的月份。"""
    async with session_factory() as db:
        await series_io.replace_month(db, series, batch)
        latest = max(await series_io.months_in_table(db, series))
        await series_io.prune(db, series, latest)
        status = await db.get(GeoDatasetStatus, series.dataset, with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset=series.dataset)
            db.add(status)
        status.active_version = latest
        status.label = latest
        status.synced_at = now
        status.last_error = None
        await db.commit()
    return latest


async def sync_series(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient | None,
    series: series_io.Series,
    *,
    now: datetime,
    force: bool,
    files: list[Path] | None,
) -> tuple[str, int]:
    """各里出生或遷入遷出（2026-10-14 里的變化規格 §4.2）。回傳 (結果, 這一輪寫入的月份數)。

    網路：從上一個月往回最多 4 個月找最新月份，再把最新往回（`series.keep_months` − 1）個月內表裡沒有的月份逐月補（來源查無資料的
    月份跳過、不記錄，下次到期再問）；force 時最新月份重抓。每個月份各自一個交易，中途失敗已寫的保留。
    檔案：依資料本身的月份分組逐月寫入，不連外。"""
    status = await _status(session_factory, series.dataset)
    pending = await _backfill_pending(session_factory, series)
    if not files and (client is None or (not force and not _series_due(status, now, pending))):
        return "skipped", 0
    written = 0
    try:
        if files:
            grouped = await asyncio.to_thread(_series_file_pages, series, files)
            if not grouped:
                raise GeoSyncError(f"{series.name}檔裡沒有高雄市的資料")
            for label in sorted(grouped):
                await _write_series_month(session_factory, series, series_io.collect(series, grouped[label]), now=now)
                written += 1
            await _record(session_factory, series.dataset, now=now, checked=True)
            return "updated", written
        assert client is not None
        latest_yyymm, first = None, None
        for yyymm in recent_months():
            page = await _series_page(client, series, yyymm, 1)
            if series_io.response_rows(series, page) is not None:
                latest_yyymm, first = yyymm, page
                break
        if latest_yyymm is None:
            raise GeoSyncError(f"找不到最近幾個月的{series.name}資料")
        latest = series_io.label_of(latest_yyymm)
        async with session_factory() as db:
            present = await series_io.months_in_table(db, series)
        for label in reversed(series_io.window(latest, series.keep_months)):
            if label in present and not (force and label == latest):
                continue
            yyymm = series_io.yyymm_of(label)
            batch = await _download_series_month(client, series, yyymm, first if label == latest else None)
            if batch is None:
                continue
            await _write_series_month(session_factory, series, batch, now=now)
            written += 1
        await _record(session_factory, series.dataset, now=now, checked=True)
        if written:
            logger.info("%s已更新：最新 %s，這一輪寫入 %s 個月份", series.name, latest, written)
        return ("updated" if written else "skipped"), written
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("%s同步失敗：%s", series.name, _error_text(exc), exc_info=True)
        await _record(session_factory, series.dataset, now=now, error=_error_text(exc))
        return "failed", written


async def _fetch_retrying(client: httpx.AsyncClient, url: str, *, max_bytes: int) -> bytes:
    """GET（有大小上限）；連線層的錯誤（reset、逾時）間隔 FETCH_RETRY_WAITS 重試，HTTP 錯誤照丟不重試。"""
    for wait in (*FETCH_RETRY_WAITS, None):
        try:
            body, _ = await _fetch_capped(client, url, max_bytes=max_bytes)
            return body
        except httpx.TransportError:
            if wait is None:
                raise
            await _sleep(wait)
    raise AssertionError("unreachable")  # pragma: no cover


def _income_guesses(active: int | None) -> list[int]:
    """data.gov.tw 讀不到時直接試的年度：使用中的下一年；還沒有使用中的年度時，從今年（民國）往回 2～4 年
    （所得落後約 3 年：115 年時最新是 112 年度）。"""
    if active is not None:
        return [active + 1]
    year = today_local().year - 1911
    return [year - 2, year - 3, year - 4]


async def _discover_income(client: httpx.AsyncClient, active: int | None, *, force: bool) -> tuple[int, bytes] | None:
    """找比使用中新的所得年度並下載；沒有新的回 None（force 時使用中的年度也重抓）。"""
    try:
        text_ = await _fetch_text(client, income_io.DATASET_API, max_bytes=DATASET_API_MAX_BYTES)
        listed: list[int] | None = income_io.years_listed(json.loads(text_))
    except Exception as exc:  # noqa: BLE001 - data.gov.tw 讀不到就直接試財政資訊中心
        logger.info("data.gov.tw 的所得資料集讀不到（%s），直接試財政資訊中心", _error_text(exc))
        listed = None
    if listed is not None:
        if not listed:
            raise GeoSyncError("data.gov.tw 的所得資料集沒有高雄市的檔案")
        latest = listed[0]
        if active is not None and (latest < active or (latest == active and not force)):
            return None
        return latest, await _fetch_retrying(client, income_io.csv_url(latest), max_bytes=INCOME_MAX_BYTES)
    candidates = _income_guesses(active)
    if force and active is not None:
        candidates.append(active)
    for year in candidates:
        try:
            return year, await _fetch_retrying(client, income_io.csv_url(year), max_bytes=INCOME_MAX_BYTES)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise
    if active is None:
        raise GeoSyncError("找不到各里所得的檔案")
    return None


async def sync_income(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
    file_year: int | None,
) -> tuple[str, int]:
    """各里綜合所得（2026-10-14 里的變化規格 §4.4）。回傳 (結果, 對不到里界而略過的列數)。
    網路：每 30 天看一次有沒有比使用中新的年度。檔案：年度取 file_year 或檔名（「112_165-E.csv」）；
    比使用中舊的年度要加 force 才換（同一年度可重匯）。"""
    status = await _status(session_factory, "income")
    if file is None and (client is None or (not force and not _due(status, now))):
        return "skipped", 0
    active = int(status.active_version) if status is not None and status.active_version else None
    try:
        if file is not None:
            year = file_year or income_io.year_of_filename(file.name)
            if year is None:
                raise GeoSyncError("所得檔名裡沒有年度（例：112_165-E.csv），請加 --income-year 112")
            if active is not None and year < active and not force:
                raise GeoSyncError(f"所得檔是 {year} 年度，比使用中的 {active} 年度舊；要換回舊年度請加 --force")
            body = file.read_bytes()
        else:
            assert client is not None
            found = await _discover_income(client, active, force=force)
            if found is None:
                await _record(session_factory, "income", now=now, checked=True)
                return "skipped", 0
            year, body = found
        batch = await asyncio.to_thread(income_io.parse_csv, income_io.decode(body), year)
        async with session_factory() as db:
            await income_io.replace_income(db, batch, synced_at=now)
            await db.commit()
        logger.info("各里所得已更新：%s 年度，%s 個里，略過 %s 列", year, len(batch.rows), batch.skipped)
        return "updated", batch.skipped
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("各里所得同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "income", now=now, error=_error_text(exc))
        return "failed", 0


async def _new_homes_text(client: httpx.AsyncClient, season: str) -> str | None:
    """一季的買賣檔（文字）；錯誤頁（那一季還沒出）回 None。"""
    body = await _fetch_retrying(client, new_homes_io.season_url(season), max_bytes=NEW_HOMES_MAX_BYTES)
    return new_homes_io.decode(body)


async def discover_new_home_seasons(client: httpx.AsyncClient, active: str | None) -> tuple[str, dict[str, str]]:
    """(最新季, 這次已下載的季 → 檔案文字)。有使用中的季時從下一季往後試 NEW_HOMES_LOOKAHEAD 季；沒有時從今天
    所在的季往回試三季。都沒有就丟錯。"""
    fetched: dict[str, str] = {}
    if active is not None:
        latest = active
        for offset in range(1, NEW_HOMES_LOOKAHEAD + 1):
            season = new_homes_io.shift_season(active, offset)
            text_ = await _new_homes_text(client, season)
            if text_ is None:
                break
            fetched[season], latest = text_, season
        return latest, fetched
    current = new_homes_io.season_of_day(today_local())
    for offset in (0, -1, -2):
        season = new_homes_io.shift_season(current, offset)
        text_ = await _new_homes_text(client, season)
        if text_ is not None:
            fetched[season] = text_
            return season, fetched
    raise GeoSyncError("找不到最近幾季的實價登錄買賣檔")


def _new_homes_files(files: list[Path], season: str | None) -> list[tuple[str, str]]:
    """(季別, 檔案文字)。季別取 season（只能配一個檔）或檔名（「115S3_e_lvr_land_a.csv」）。"""
    if season is not None and len(files) != 1:
        raise GeoSyncError("--new-homes-season 只能配一個 --new-homes-file")
    result = []
    for path in files:
        label = season or new_homes_io.season_of_filename(path.name)
        if label is None:
            raise GeoSyncError(f"新成屋檔名裡沒有季別（例：115S3_e_lvr_land_a.csv），請加 --new-homes-season：{path.name}")
        text_ = new_homes_io.decode(path.read_bytes())
        if text_ is None:
            raise GeoSyncError(f"新成屋檔 {path.name} 不是實價登錄的買賣季檔（可能是錯誤頁）")
        result.append((label, text_))
    return result


async def sync_new_homes(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    files: list[Path] | None,
    season: str | None,
) -> tuple[str, int]:
    """新成屋交屋（2026-10-14 里的變化規格 §4.3）。回傳 (結果, 這一輪寫入的季數)。
    網路：找最新季，最新往回 8 季內表裡沒有的逐季補（force 時最新季重抓）；每季一個交易，中途失敗已寫的保留，
    「到期」只看 checked_at（同出生、遷入遷出），回補到一半失敗隔天就接著補。檔案：逐檔寫入，不連外。"""
    status = await _status(session_factory, "new_homes")
    if not files and (client is None or (not force and not _series_due(status, now))):
        return "skipped", 0
    written = 0
    try:
        if files:
            for label, text_ in await asyncio.to_thread(_new_homes_files, files, season):
                batch = await asyncio.to_thread(new_homes_io.parse_csv, text_, label)
                await new_homes_io.write_season(session_factory, batch, now=now)
                written += 1
            await _record(session_factory, "new_homes", now=now, checked=True)
            return "updated", written
        assert client is not None
        active = status.label if status is not None and status.active_version else None
        latest, fetched = await discover_new_home_seasons(client, active)
        async with session_factory() as db:
            present = await new_homes_io.seasons_in_table(db)
        for label in reversed(new_homes_io.window(latest)):  # 新到舊：中途失敗時先保住最新的季
            if label in present and not (force and label == latest):
                continue
            text_ = fetched.get(label) or await _new_homes_text(client, label)
            if text_ is None:
                continue  # 那一季來源沒有檔
            batch = await asyncio.to_thread(new_homes_io.parse_csv, text_, label)
            await new_homes_io.write_season(session_factory, batch, now=now)
            written += 1
        await _record(session_factory, "new_homes", now=now, checked=True)
        if written:
            logger.info("新成屋已更新：最新 %s，這一輪寫入 %s 季", latest, written)
        return ("updated" if written else "skipped"), written
    except Exception as exc:  # noqa: BLE001 - 一種資料失敗不擋其他
        logger.warning("新成屋同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "new_homes", now=now, error=_error_text(exc))
        return "failed", written


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
    kindergartens_registry_file: Path | None = None,
    babycare_file: Path | None = None,
    population_files: list[Path] | None = None,
    births_files: list[Path] | None = None,
    migration_files: list[Path] | None = None,
    income_file: Path | None = None,
    income_year: int | None = None,
    new_homes_files: list[Path] | None = None,
    new_homes_season: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> GeoSyncResult:
    if (kindergartens_file is None) != (kindergartens_registry_file is None):
        raise ValueError("幼兒園檔案與教育部名單檔要一起給（--kindergartens-file、--kindergartens-registry-file）")
    async with _exclusive(session_factory):
        now = datetime.now(timezone.utc)
        file_mode = (
            doorplates_file is not None or kindergartens_file is not None or babycare_file is not None
            or bool(population_files) or bool(births_files) or bool(migration_files) or income_file is not None
            or bool(new_homes_files)
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
                work=sync_kindergartens(
                    session_factory, settings, network,
                    now=now, force=force, file=kindergartens_file, registry_file=kindergartens_registry_file,
                ),
            )
            kindergarten_fees, kindergarten_fee_schools = "skipped", 0
            # 收費只在名單沒失敗時做：名單這一輪更新了就接著做，沒更新（還沒到 7 天）只在從沒匯入成功過才補（計畫 Task 4）。
            # 外層再包一道硬性時間上限，上游慢慢吐資料也不會讓單一請求長期占住全域同步鎖。
            if network is not None and kindergartens != "failed":
                kindergarten_fees, kindergarten_fee_schools = await _within_budget(
                    session_factory, "kindergarten_fees", FEES_TIME_BUDGET + timedelta(minutes=2), now=now,
                    work=sync_kindergarten_fees(
                        session_factory, network, now=now, force=force, only_if_never_imported=kindergartens != "updated"
                    ),
                )
            babycare, babycare_skipped = await _within_budget(
                session_factory, "babycare", BABYCARE_TIME_BUDGET, now=now,
                work=sync_babycare(session_factory, settings, network, now=now, force=force, file=babycare_file),
            )
            babycare_details = 0
            if network is not None and babycare != "failed":
                babycare_details = await sync_babycare_details(
                    session_factory, network, now=now, only_if_missing=babycare != "updated"
                )
            population, population_skipped = await _within_budget(
                session_factory, "population", POPULATION_TIME_BUDGET, now=now,
                work=sync_population(session_factory, network, now=now, force=force, files=population_files),
            )
            births, births_months = await _within_budget(
                session_factory, "births", SERIES_TIME_BUDGET, now=now,
                work=sync_series(session_factory, network, series_io.BIRTHS, now=now, force=force, files=births_files),
            )
            migration, migration_months = await _within_budget(
                session_factory, "migration", SERIES_TIME_BUDGET, now=now,
                work=sync_series(session_factory, network, series_io.MIGRATION, now=now, force=force, files=migration_files),
            )
            # 檔案模式只在指定了人口檔時做（只會從使用中的人口表複製，不連外）。逾時記在 population。
            age_history = "skipped"
            if network is not None or population_files:
                age_history, _ = await _within_budget(
                    session_factory, "population", POPULATION_TIME_BUDGET, now=now,
                    work=_paired(sync_age_history(session_factory, network, now=now)),
                )
            income, income_skipped = await _within_budget(
                session_factory, "income", INCOME_TIME_BUDGET, now=now,
                work=sync_income(session_factory, network, now=now, force=force, file=income_file, file_year=income_year),
            )
            new_homes, new_homes_seasons = await _within_budget(
                session_factory, "new_homes", NEW_HOMES_TIME_BUDGET, now=now,
                work=sync_new_homes(
                    session_factory, network, now=now, force=force, files=new_homes_files, season=new_homes_season
                ),
            )
        finally:
            if own_client and client is not None:
                await client.aclose()
        rematched = await rematch_if_changed(session_factory, now=now)
        # 新成屋：門牌換版（或之前門牌還沒匯入）的列重比；失敗只記在 new_homes，不擋同步結果。
        try:
            new_homes_rematched = await new_homes_io.rematch(session_factory)
        except Exception as exc:  # noqa: BLE001
            logger.warning("新成屋重比失敗：%s", _error_text(exc), exc_info=True)
            await _record(session_factory, "new_homes", now=now, error=f"重比失敗：{_error_text(exc)}")
            new_homes_rematched = 0
        status = await _status(session_factory, "doorplates")
        population_status = await _status(session_factory, "population")
        births_status = await _status(session_factory, "births")
        migration_status = await _status(session_factory, "migration")
        income_status = await _status(session_factory, "income")
        new_homes_status = await _status(session_factory, "new_homes")
        fees_status = await _status(session_factory, "kindergarten_fees")
        return GeoSyncResult(
            doorplates, kindergartens, status.label if status else None, rematched,
            doorplate_rows_skipped=doorplate_skipped, kindergarten_rows_skipped=kindergarten_skipped,
            population=population,
            population_version=population_status.label if population_status and population_status.active_version else None,
            population_rows_skipped=population_skipped,
            babycare=babycare, babycare_rows_skipped=babycare_skipped, babycare_details=babycare_details,
            kindergarten_fees=kindergarten_fees, kindergarten_fee_schools=kindergarten_fee_schools,
            kindergarten_fees_version=fees_status.label if fees_status is not None else None,
            births=births,
            births_version=births_status.label if births_status and births_status.active_version else None,
            births_months=births_months,
            migration=migration,
            migration_version=migration_status.label if migration_status and migration_status.active_version else None,
            migration_months=migration_months,
            age_history=age_history,
            income=income,
            income_version=income_status.label if income_status and income_status.active_version else None,
            income_rows_skipped=income_skipped,
            new_homes=new_homes,
            new_homes_version=new_homes_status.label if new_homes_status and new_homes_status.active_version else None,
            new_homes_seasons=new_homes_seasons,
            new_homes_rematched=new_homes_rematched,
        )
