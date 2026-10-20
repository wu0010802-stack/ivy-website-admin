"""國土測繪中心地號查詢（2026-10-20 預售建案規格 P6）：**只給本機腳本 scripts/fetch_presale_parcels.py 用**，
正式站的同步迴圈、背景工作、API 都不 import 這個模組、也不連這兩個服務（tests/test_geo_presale_sync.py 檢查）。

兩個服務都沒有公開文件與授權，使用者 2026-10-20 選擇照用，所以只在本機、低頻（每次請求至少間隔 1 秒）、請求不帶任何帳號：
- 段清單 `https://api.nlsc.gov.tw/other/ListLandSection/E/<區碼>`（E01 鹽埕…E38 那瑪夏；XML，免 Referer）：
  `<sectItem><office>EA</office><officestr>鹽埕</officestr><sectcode>0005</sectcode><sectstr>府北段五小段</sectstr></sectItem>`；
- 地號座標 `https://landmaps.nlsc.gov.tw/S_Maps/qryTileMapIndex?type=2&flag=2&office=<所碼>&sect=<段碼4碼>&landno=<主號4碼子號4碼>
  &alpah=0.5f&callback=cb`（JSONP，回 cx＝經度、cy＝緯度）。**要帶 `Referer: https://maps.nlsc.gov.tw/T09/mapshow.action`，
  否則回「地號查詢無資料!」**；查無的地號也回這句（msg），所以要把兩種情況分清楚：帶了 Referer 還是查無才算查無。"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

import httpx

from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT, in_kaohsiung
from app.admissions.geo.presale_parcels import ParcelRow, landno8

SECTION_URL = "https://api.nlsc.gov.tw/other/ListLandSection/E/{town}"
PARCEL_URL = "https://landmaps.nlsc.gov.tw/S_Maps/qryTileMapIndex"
REFERER = "https://maps.nlsc.gov.tw/T09/mapshow.action"
# 不帶任何帳號、email（規格 P6）。
USER_AGENT = "ivy-website/1.0 (+presale-parcels)"
MIN_DELAY_SECONDS = 1.0
# 連續這麼多次請求失敗就停手（被擋或服務出問題，不要再打）。
MAX_CONSECUTIVE_ERRORS = 5
_SECT_ITEM = re.compile(r"<sectItem>(.*?)</sectItem>", re.S)
_JSONP = re.compile(r"\s*cb\((.*)\)\s*;?\s*$", re.S)


class NlscError(RuntimeError):
    """國土測繪中心的回應看不懂或座標不合理；這個地號不記錄，下次再查。"""


def town_code(district: str) -> str:
    """區名 → 國土測繪中心的鄉鎮代碼（E01 鹽埕區 … E38 那瑪夏區，順序同門牌表的鄉鎮市區代碼）。"""
    return f"E{int(CODE_OF_DISTRICT[district][2:5]):02d}"


def parse_sections(xml_text: str) -> dict[str, tuple[str, str]]:
    """段清單 XML → {段名: (所碼, 段碼)}。用規則式讀取，不展開 XML 實體。"""
    sections: dict[str, tuple[str, str]] = {}
    for item in _SECT_ITEM.findall(xml_text):
        fields = {tag: _tag(item, tag) for tag in ("office", "sectcode", "sectstr")}
        if all(fields.values()):
            sections[fields["sectstr"]] = (fields["office"], fields["sectcode"])
    return sections


def _tag(text: str, tag: str) -> str:
    matched = re.search(rf"<{tag}>([^<]*)</{tag}>", text)
    return matched.group(1).strip() if matched else ""


def resolve_section(section: str, sections: dict[str, tuple[str, str]]) -> tuple[str, str] | None:
    """presale.first_parcel 的段名 → (所碼, 段碼)：先完全相同，再取該區段清單裡最長的前綴（段名後面多的字不影響）。"""
    if section in sections:
        return sections[section]
    prefixes = [name for name in sections if len(name) >= 2 and section.startswith(name)]
    return sections[max(prefixes, key=len)] if prefixes else None


def parse_jsonp(text: str) -> tuple[float, float] | None:
    """地號座標的 JSONP 回應 → (經度, 緯度)；明確的「查無資料」回 None，其他看不懂的丟 NlscError。"""
    matched = _JSONP.match(text)
    if matched is None:
        raise NlscError("回應不是 JSONP")
    try:
        data = json.loads(matched.group(1))
    except json.JSONDecodeError as exc:
        raise NlscError("回應不是 JSON") from exc
    head = data[0] if isinstance(data, list) and data else None
    if isinstance(head, list):
        head = head[0] if head else None
    if not isinstance(head, dict):
        raise NlscError("回應的格式不認得")
    if "cx" in head and "cy" in head:
        try:
            lon, lat = float(head["cx"]), float(head["cy"])
        except (TypeError, ValueError) as exc:
            raise NlscError("座標不是數字") from exc
        if not in_kaohsiung(lat, lon):
            raise NlscError("座標不在高雄市範圍")
        return lon, lat
    if "無資料" in str(head.get("msg", "")):
        return None
    raise NlscError("回應沒有座標也不是查無資料")


def new_client(*, transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(30.0, connect=15.0), headers={"User-Agent": USER_AGENT}, follow_redirects=False,
        transport=transport,
    )


def fetch_sections(client: httpx.Client, district: str) -> dict[str, tuple[str, str]]:
    response = client.get(SECTION_URL.format(town=town_code(district)))
    response.raise_for_status()
    return parse_sections(response.text)


def query_parcel(client: httpx.Client, office: str, sect: str, landno_8: str) -> tuple[float, float] | None:
    """查一個地號：(經度, 緯度)；查無回 None；網路錯誤丟 httpx.HTTPError、看不懂丟 NlscError。"""
    response = client.get(
        PARCEL_URL,
        params={"type": "2", "flag": "2", "office": office, "sect": sect, "landno": landno_8, "alpah": "0.5f", "callback": "cb"},
        headers={"Referer": REFERER},
    )
    response.raise_for_status()
    return parse_jsonp(response.text)


@dataclass
class CollectResult:
    rows: dict[tuple[str, str, str], ParcelRow]
    queried: int = 0
    found: int = 0
    missing: int = 0
    errors: int = 0
    aborted: bool = False
    unresolved: list[tuple[str, str, str]] = field(default_factory=list)


def collect(
    client: httpx.Client,
    wanted: list[tuple[str, str, str]],
    existing: dict[tuple[str, str, str], ParcelRow],
    *,
    today: date,
    delay: float = MIN_DELAY_SECONDS,
    retry_missing: bool = False,
    limit: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    on_progress: Callable[[CollectResult], None] | None = None,
) -> CollectResult:
    """把 wanted（(區, 段名, 地號)）裡 existing 還沒有的查一遍（retry_missing 時連查無的也重查），回傳合併後的全部列。
    每次請求（含段清單）之後 sleep delay 秒（至少 1 秒）；連續 5 次失敗就停手（aborted）。看不懂或座標不合理的回應不記錄，
    下次再查；對不到國土測繪中心段清單的段名放進 unresolved。"""
    delay = max(delay, MIN_DELAY_SECONDS)
    result = CollectResult(rows=dict(existing))
    todo = [
        key for key in dict.fromkeys(wanted)
        if key not in existing or (retry_missing and existing[key].lon is None)
    ]
    sections: dict[str, dict[str, tuple[str, str]]] = {}
    consecutive = 0
    for key in todo:
        if limit is not None and result.queried >= limit:
            break
        district, section, landno = key
        number = landno8(landno)
        try:
            if district not in sections:
                sections[district] = fetch_sections(client, district)
                sleep(delay)
            resolved = resolve_section(section, sections[district])
            if resolved is None or number is None:
                result.unresolved.append(key)
                continue
            office, sect = resolved
            point = query_parcel(client, office, sect, number)
        except (httpx.HTTPError, NlscError):
            result.errors += 1
            consecutive += 1
            if consecutive >= MAX_CONSECUTIVE_ERRORS:
                result.aborted = True
                break
            sleep(delay)
            continue
        consecutive = 0
        result.queried += 1
        if point is None:
            result.missing += 1
        else:
            result.found += 1
        result.rows[key] = ParcelRow(
            district, section, landno, office, sect, None if point is None else point[0], None if point is None else point[1], today
        )
        sleep(delay)
        if on_progress is not None:
            on_progress(result)
    return result
