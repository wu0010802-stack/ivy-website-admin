"""官網送單時讀網站來源與點擊識別碼（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §1、§2）。

`ivy_src` 是官網伺服器（web/server/middleware/01.attribution.ts）在訪客進站時寫的第一方 cookie：
base64url 編碼的 JSON，`v` 固定 1，格式與 web/shared/attribution-cookie.ts 一致（兩邊測試用同一組樣本）。

- `f`：第一次進站 {s 來源代碼, c 活動代碼（可省略）, d 日期 YYYY-MM-DD}
- `l`：最後一次不是直接進站的進站，欄位同上（可省略）
- `o`：最後一次落地網址上的 OpenAI 點擊代碼 {v, t 毫秒}（可省略）
- `b`：最後一次的 fbclid {v, t 毫秒}（可省略）
- `n`：最後一次落地網址上的 LINE 廣告點擊代碼 ldtag_cl {v, t 毫秒}（可省略，2026-11-16）

cookie 是訪客瀏覽器送來的，什麼都可能被改：整個格式不對就當沒有，個別欄位不合規則就丟掉那一欄，
不讓壞資料進資料庫，也不讓送單失敗。訪客開了 DNT 或 GPC（代理有轉這兩個標頭）就什麼都不讀。
"""
from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from app.operations.models import ENGAGEMENT_SOURCES

SITE_COOKIE = "ivy_src"
# 比 4 KB 上限再寬一點；超過就不是官網寫的。
_MAX_COOKIE_LENGTH = 3000
_CAMPAIGN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# 點擊代碼：可見 ASCII，不含 cookie 與 JSON 會出問題的字元；長度設上限。
_CLICK_TOKEN = re.compile(r"^[A-Za-z0-9._~:+/=-]{1,500}$")
_FBCLID = re.compile(r"^[A-Za-z0-9_-]{1,500}$")
# GA4 的 _ga：GA1.<網域層數>.<隨機數>.<建立時間>，client_id 是後兩段。
_GA_COOKIE = re.compile(r"^GA\d\.\d+\.(\d{1,20}\.\d{1,20})$")
# Meta：_fbc＝fb.<子網域層數>.<毫秒>.<fbclid>；_fbp＝fb.<層數>.<毫秒>.<隨機數>。
_FBC = re.compile(r"^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,500}$")
_FBP = re.compile(r"^fb\.\d\.\d{10,13}\.\d{1,20}$")
# OpenAI 點擊後的歸因期間是 30 天（廣告管理平台轉換事件的設定）；更舊的點擊代碼不記。
OPPREF_MAX_AGE = timedelta(days=30)
# Meta 的 fbc 點擊歸因同樣不超過 28～30 天；自己組 fbc 時只用這麼新的 fbclid。
FBCLID_MAX_AGE = timedelta(days=30)
# LINE 廣告預設的轉換期間是點擊後 30 天（自訂轉換最長 90 天）；用 90 天，超過的點擊代碼不記。
LINE_CLICK_MAX_AGE = timedelta(days=90)
# LINE Tag（lt.js）在官網網域寫的第一方 cookie，Conversion API 的 browser_id。名稱是 2026-11-16 實測 lt.js 3.7.0
# 看到的（__lt__cid）；LINE 文件沒寫名稱，lt.js 改版要重查。
LINE_BROWSER_COOKIE = "__lt__cid"

# 各平台在 ad_click_ids 裡用到的鍵；送出時也照這張表找識別碼（app/ad_conversions/）。
PLATFORM_KEYS: dict[str, tuple[str, ...]] = {
    "ga4": ("ga_client_id",),
    "meta": ("fbc", "fbp"),
    "openai": ("oppref", "obref"),
    "line": ("line_click_id", "line_browser_id"),
}


@dataclass(frozen=True)
class Touch:
    source: str
    campaign: str | None
    on: date


@dataclass(frozen=True)
class ClickToken:
    value: str
    at: datetime


@dataclass(frozen=True)
class SiteCookie:
    first: Touch | None
    last: Touch | None
    oppref: ClickToken | None
    fbclid: ClickToken | None
    line_click: ClickToken | None = None


def privacy_opt_out(headers: Mapping[str, str]) -> bool:
    """訪客開了「不要追蹤」或 Global Privacy Control。"""
    return headers.get("dnt") == "1" or headers.get("sec-gpc") == "1"


def _touch(raw: object) -> Touch | None:
    if not isinstance(raw, dict):
        return None
    source, campaign, day = raw.get("s"), raw.get("c"), raw.get("d")
    if source not in ENGAGEMENT_SOURCES or not isinstance(day, str) or not _DAY.match(day):
        return None
    try:
        on = date.fromisoformat(day)
    except ValueError:
        return None
    if campaign is not None and not (isinstance(campaign, str) and _CAMPAIGN.match(campaign)):
        campaign = None
    return Touch(source=source, campaign=campaign, on=on)


def _click(raw: object, pattern: re.Pattern[str]) -> ClickToken | None:
    if not isinstance(raw, dict):
        return None
    value, at = raw.get("v"), raw.get("t")
    if not isinstance(value, str) or not pattern.match(value):
        return None
    if isinstance(at, bool) or not isinstance(at, int) or not 1_000_000_000_000 <= at <= 99_999_999_999_999:
        return None
    return ClickToken(value=value, at=datetime.fromtimestamp(at / 1000, tz=timezone.utc))


def parse_site_cookie(raw: str | None) -> SiteCookie | None:
    if not raw or len(raw) > _MAX_COOKIE_LENGTH:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or data.get("v") != 1:
        return None
    return SiteCookie(
        first=_touch(data.get("f")),
        last=_touch(data.get("l")),
        oppref=_click(data.get("o"), _CLICK_TOKEN),
        fbclid=_click(data.get("b"), _FBCLID),
        line_click=_click(data.get("n"), _CLICK_TOKEN),
    )


def touch_columns(site: SiteCookie | None) -> dict:
    """寫進 visit_requests 的六個網站來源欄位（沒有就是 None）。"""
    columns: dict = {}
    for prefix, touch in (("first_touch", site.first if site else None), ("last_touch", site.last if site else None)):
        columns[f"{prefix}_source"] = touch.source if touch else None
        columns[f"{prefix}_campaign"] = touch.campaign if touch else None
        columns[f"{prefix}_on"] = touch.on if touch else None
    return columns


def click_ids(
    cookies: Mapping[str, str], site: SiteCookie | None, platforms: tuple[str, ...], now: datetime
) -> dict | None:
    """只記已設定伺服器端金鑰的平台要用的識別碼；一個都沒有回 None。"""
    ids: dict[str, str] = {}
    if "ga4" in platforms and (match := _GA_COOKIE.match(cookies.get("_ga", ""))):
        ids["ga_client_id"] = match.group(1)
    if "meta" in platforms:
        fbc = cookies.get("_fbc", "")
        if _FBC.match(fbc):
            ids["fbc"] = fbc
        elif site and site.fbclid and now - site.fbclid.at <= FBCLID_MAX_AGE:
            # Meta Pixel 沒載入（例如進站後很快就換頁）時沒有 _fbc；照 Meta 的格式用落地時的 fbclid 自己組。
            ids["fbc"] = f"fb.1.{int(site.fbclid.at.timestamp() * 1000)}.{site.fbclid.value}"
        fbp = cookies.get("_fbp", "")
        if _FBP.match(fbp):
            ids["fbp"] = fbp
    if "openai" in platforms:
        if site and site.oppref and now - site.oppref.at <= OPPREF_MAX_AGE:
            ids["oppref"] = site.oppref.value
        obref = cookies.get("__obref", "")
        if _CLICK_TOKEN.match(obref):
            ids["obref"] = obref
    if "line" in platforms:
        if site and site.line_click and now - site.line_click.at <= LINE_CLICK_MAX_AGE:
            ids["line_click_id"] = site.line_click.value
        browser = cookies.get(LINE_BROWSER_COOKIE, "")
        if len(browser) <= 200 and _CLICK_TOKEN.match(browser):
            ids["line_browser_id"] = browser
    return ids or None
