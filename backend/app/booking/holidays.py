"""國定假日匯入（2026-10-14 規格 §2）：解析人事行政總處「中華民國政府行政機關辦公日曆表」，
套用成各校的休假日。

資料來源是政府資料開放平台資料集 14718，每年一份 CSV（通常 6 月公布隔年）。欄位是
西元日期、星期、是否放假（2＝放假、0＝上班）、備註（節日名稱）。編碼不固定：115、116 年
是 UTF-8 含 BOM，114 年更新版是 Big5，先試 UTF-8 再試 cp950。

哪些日子算假日：是否放假＝2，而且是星期一到五、或備註有寫節日名稱（國慶日剛好週六這種）。
一般週末沒有備註，不列。補行上班（週六上班）不加開參觀場次。

套用時每一校走既有的 schedule_service.add_exception（鎖設定列、關閉當天已產生的場次），
已經是休假日的不動；週末的假日只有那校每週規則有那一天才建。正式站曾經連不到高雄市
開放資料平台，所以下載失敗時畫面改用上傳同一份 CSV。"""
from __future__ import annotations

import csv
import io
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import date

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import schedule_service, slot_service
from app.booking.models import VisitRequest, VisitSlot
from app.booking.service import get_or_create_config

DATASET_URL = "https://data.gov.tw/api/v2/rest/dataset/14718"
USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-holiday-import/1.0)"
# 一年一份約 6 KB；留足空間給更新版或多年合併的檔案，但不收來路不明的大檔。
MAX_FILE_BYTES = 512 * 1024
# 一年的國定假日（含補假、週末的節日）約 20 天；多年合併的檔案也不會超過這個數。
MAX_HOLIDAYS = 80
REASON_SUFFIX = "（國定假日）"
NAME_MAX_LENGTH = 40

_DATE_HEADER = "西元日期"
_OFF_HEADER = "是否放假"
_NOTE_HEADER = "備註"
_OFF = "2"
_WORK = "0"


class HolidayCalendarError(ValueError):
    """檔案不是辦公日曆表、或內容對不上；訊息直接給後台顯示。"""


class HolidaySourceUnavailable(RuntimeError):
    """連不到政府資料開放平台（含逾時、非 200、回應不是預期格式）。"""


class HolidayYearNotPublished(LookupError):
    """資料集裡還沒有這一年的辦公日曆。"""


@dataclass(frozen=True)
class Holiday:
    day: date
    name: str


@dataclass(frozen=True)
class HolidayCalendar:
    source_label: str
    holidays: list[Holiday]

    @property
    def years(self) -> list[int]:
        return sorted({h.day.year for h in self.holidays})


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp950"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HolidayCalendarError("讀不懂檔案的文字編碼，請上傳政府資料開放平台下載的原始 CSV")


def parse_calendar(raw: bytes, *, source_label: str) -> HolidayCalendar:
    """解析辦公日曆表 CSV，回傳假日清單（依日期排序）。格式不對就丟 HolidayCalendarError。"""
    if len(raw) > MAX_FILE_BYTES:
        raise HolidayCalendarError("檔案太大，請確認是「中華民國政府行政機關辦公日曆表」的 CSV")
    text = _decode(raw)
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise HolidayCalendarError("檔案是空的")
    header = [cell.strip() for cell in rows[0]]
    if _DATE_HEADER not in header or _OFF_HEADER not in header:
        if any("Subject" in cell or "Start Date" in cell for cell in header):
            raise HolidayCalendarError("這是「Google行事曆專用」的版本，請改用沒有這幾個字的那一份辦公日曆表")
        raise HolidayCalendarError("找不到「西元日期」「是否放假」欄位，請確認是「中華民國政府行政機關辦公日曆表」")
    date_col = header.index(_DATE_HEADER)
    off_col = header.index(_OFF_HEADER)
    note_col = header.index(_NOTE_HEADER) if _NOTE_HEADER in header else None

    seen: set[date] = set()
    holidays: list[Holiday] = []
    for line_no, row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in row):
            continue
        try:
            raw_date = row[date_col].strip()
            off = row[off_col].strip()
        except IndexError as exc:
            raise HolidayCalendarError(f"第 {line_no} 行欄位不足") from exc
        if not re.fullmatch(r"\d{8}", raw_date):
            raise HolidayCalendarError(f"第 {line_no} 行的日期「{raw_date[:20]}」不是 8 位數字")
        try:
            day = date(int(raw_date[:4]), int(raw_date[4:6]), int(raw_date[6:]))
        except ValueError as exc:
            raise HolidayCalendarError(f"第 {line_no} 行的日期「{raw_date}」不存在") from exc
        if day in seen:
            raise HolidayCalendarError(f"{day.isoformat()} 出現兩次")
        seen.add(day)
        if off not in (_OFF, _WORK):
            raise HolidayCalendarError(f"第 {line_no} 行的「是否放假」是「{off[:10]}」，應該是 0 或 2")
        note = row[note_col].strip() if note_col is not None and note_col < len(row) else ""
        if off != _OFF or (day.weekday() >= 5 and not note):
            continue
        holidays.append(Holiday(day=day, name=(note or "放假")[:NAME_MAX_LENGTH]))

    if len(seen) < 28:
        raise HolidayCalendarError("檔案裡的日子太少，請確認是整年的辦公日曆表")
    if not holidays:
        raise HolidayCalendarError("檔案裡沒有任何放假日")
    if len(holidays) > MAX_HOLIDAYS:
        raise HolidayCalendarError("放假日超過 80 天，請一次匯入一年")
    holidays.sort(key=lambda h: h.day)
    return HolidayCalendar(source_label=source_label, holidays=holidays)


# 資料集上的檔名例如「114年中華民國政府行政機關辦公日曆表(1141020更新)」；更新版取日期最新的。
_UPDATE_RE = re.compile(r"[（(](\d{6,8})更新[)）]")


def pick_resource(distribution: list[dict], roc_year: int) -> tuple[str, str]:
    """從資料集的檔案清單挑出某一年的辦公日曆 CSV，回傳 (檔名, 下載網址)。

    排除「Google行事曆專用」；同一年有更新版時挑更新日期最新的，同日期取清單裡較後面的。"""
    prefix = f"{roc_year}年"
    candidates: list[tuple[int, int, str, str]] = []
    for index, item in enumerate(distribution):
        name = str(item.get("resourceDescription") or "").strip()
        url = str(item.get("resourceDownloadUrl") or "").strip()
        fmt = str(item.get("resourceFormat") or "").strip().upper()
        if not name.startswith(prefix) or "辦公日曆" not in name or "Google" in name or not url:
            continue
        if fmt and fmt != "CSV":
            continue
        match = _UPDATE_RE.search(name)
        candidates.append((int(match.group(1)) if match else 0, index, name, url))
    if not candidates:
        raise HolidayYearNotPublished(f"政府資料開放平台還沒有 {roc_year} 年的辦公日曆（通常每年 6 月公布隔年的）")
    _, _, name, url = max(candidates)
    return name, url


def _allowed_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    return host == "gov.tw" or host.endswith(".gov.tw")


async def _require_gov_https(request: httpx.Request) -> None:
    """每一個請求（含轉址的每一跳）送出前檢查：只連 https 的政府網站。檔案網址是從
    data.gov.tw 的回應讀出來的，不能讓伺服器被導去打任意網址。"""
    if request.url.scheme != "https" or not _allowed_host(request.url.host):
        raise HolidaySourceUnavailable("下載網址不是 https 的政府網站，已拒絕")


def new_client(*, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """只跟 https、gov.tw 的轉址。transport 給測試換成假網站。"""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        event_hooks={"request": [_require_gov_https]},
        transport=transport,
    )


async def _get(client: httpx.AsyncClient, url: str) -> bytes:
    try:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise HolidaySourceUnavailable(f"政府資料開放平台回應 {response.status_code}")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_FILE_BYTES * 4:
                    raise HolidaySourceUnavailable("回應太大，已停止下載")
            return bytes(body)
    except httpx.HTTPError as exc:
        raise HolidaySourceUnavailable("連不到政府資料開放平台") from exc


async def fetch_calendar(year: int, *, client: httpx.AsyncClient | None = None) -> HolidayCalendar:
    """下載某一年（西元）的辦公日曆並解析。"""
    owned = client is None
    client = client or new_client()
    try:
        meta_raw = await _get(client, DATASET_URL)
        try:
            meta = json.loads(meta_raw)
            distribution = (meta.get("result") or meta).get("distribution") or []
        except (ValueError, AttributeError) as exc:
            raise HolidaySourceUnavailable("政府資料開放平台的回應格式不對") from exc
        if not isinstance(distribution, list):
            raise HolidaySourceUnavailable("政府資料開放平台的回應格式不對")
        name, url = pick_resource([d for d in distribution if isinstance(d, dict)], year - 1911)
        raw = await _get(client, url)
    finally:
        if owned:
            await client.aclose()
    calendar = parse_calendar(raw, source_label=name)
    if year not in calendar.years:
        raise HolidayCalendarError(f"下載的檔案裡沒有 {year} 年的日子")
    return calendar


@dataclass
class CampusApplyResult:
    campus_key: str
    created: int = 0
    skipped_existing: int = 0
    skipped_weekend: int = 0
    affected_requests: int = 0
    affected_dates: list[date] = field(default_factory=list)


async def _confirmed_on(db: AsyncSession, campus_key: str, day: date) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(VisitRequest)
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date == day,
            slot_service.awaiting_visit_condition(),
        )
    )
    return result.scalar_one()


async def apply_holidays(
    db: AsyncSession,
    campus_key: str,
    holidays: list[Holiday],
    *,
    actor_id: uuid.UUID,
    dry_run: bool,
) -> CampusApplyResult:
    """把假日套用成一校的休假日。呼叫端已排除今天以前的日期，並負責 commit。

    dry_run 只算數字：不鎖、不寫。"""
    out = CampusApplyResult(campus_key=campus_key)
    if not dry_run:
        # 先鎖設定列再讀既有休假：同時有人在月曆上設休假時，不會把對方剛寫的原因蓋掉。
        await get_or_create_config(db, campus_key, for_update=True)
    rule_weekdays = {rule.weekday for rule in await schedule_service.list_rules(db, campus_key)}
    existing = {
        e.exception_date
        for e in await schedule_service.list_exceptions(db, campus_key, since=min(h.day for h in holidays))
    } if holidays else set()
    for holiday in holidays:
        if holiday.day in existing:
            out.skipped_existing += 1
            continue
        if holiday.day.weekday() >= 5 and holiday.day.weekday() not in rule_weekdays:
            out.skipped_weekend += 1
            continue
        if dry_run:
            affected = await _confirmed_on(db, campus_key, holiday.day)
        else:
            # add_exception 遇到同一天已有休假會改寫原因；上面已排除，這裡一定是新的。
            _, _, affected = await schedule_service.add_exception(
                db, campus_key, holiday.day, f"{holiday.name}{REASON_SUFFIX}", actor_id
            )
        out.created += 1
        if affected:
            out.affected_requests += affected
            out.affected_dates.append(holiday.day)
    return out

