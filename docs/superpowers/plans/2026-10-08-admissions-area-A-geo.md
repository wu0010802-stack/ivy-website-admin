# 招生區域分析 A 階段：公開地理資料與地址比對 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後端能在本機把家長手填地址比對成「行政區＋里＋到本校直線距離」，並能自動（或用 CLI）更新高雄市門牌、幼兒園兩種公開資料；B 階段的 API 直接拿來用。

**Architecture:** 新子套件 `backend/app/admissions/geo/`：純函式的地址解析與座標轉換、四張新表（一支 migration）、門牌 CSV 串流匯入（分批 COPY、批次標記、成功才切換）、幼兒園 JSON 匯入、五級比對與校區座標、每天醒一次的背景同步迴圈（獨立 advisory lock）、`geo-sync` CLI。里界 GeoJSON 隨程式提交。

**Tech Stack:** FastAPI 0.136.1、SQLAlchemy 2.0 async＋asyncpg（COPY 走 asyncpg 原生連線）、Alembic、PostgreSQL、httpx（既有）、pytest＋pytest-asyncio（`asyncio_mode = "auto"`）。

**Spec:** `docs/specs/2026-10-08-admissions-area-design.md`（以下稱「規格」）

**對應總覽：** `docs/superpowers/plans/2026-10-08-admissions-area.md`。總覽的「Global Constraints」全部適用；本檔的任務 A1–A9 產出總覽「A 產出、B／C 使用」那一節的介面。本階段定案、和總覽寫法不同的地方列在下一節，**以本檔為準**（B、C 階段計畫已依此對齊）。

本計畫每一個程式檔、測試檔、fixture 都已在 2026-10-08 於 origin/main `82937a9f` 的副本上實際跑過：geo 測試＋`test_maintenance`、`test_media_job_loop`、`test_config_isolation`、`test_admissions_schema`、`test_admissions_records`、`test_health` 共 283 passed；完整 115 年 10 月門牌（77.6 萬列）＋kiang 734 所幼兒園地址比對率 98.0%。照抄即可，不要「改寫得更好」。

## 本階段定案（與總覽的差異）

| 項目 | 總覽 | 本檔定案 | 原因 |
|---|---|---|---|
| `ParsedAddress.lane`、`.alley` | `int \| None` | `str \| None`（"66"、"博愛"、"1"） | 門牌表有 1.6 萬列具名巷（「博愛巷」「南二巷」「光明10巷」）與「1之3弄」，整數存不下 |
| `geo_doorplates.lane`、`.alley`（規格 §5.1） | Integer nullable | String(16) NOT NULL，沒有時存 `""` | 同上；查詢一律等號比對，不必處理 NULL |
| `geo_doorplates.dataset_version` | 「115-10」 | 匯入批次標記「115-10#a1b2c3」 | 同月份重匯（`--force`、CLI 檔案）不會和使用中的批次混在一起 |
| `geo_dataset_status` 欄位 | dataset、synced_at… | 另有 `label`（畫面用「115-10」）、`checked_at`、`last_attempt_at`；`dataset` 多一種 `campuses`（校址＋門牌批次指紋，變了就重算訪視） | B 的 `data_status.doorplate_version` 讀 `label`；`active_version` 是內部批次標記 |
| `run_geo_sync` | — | 多一個 `doorplates_version: str \| None = None` | CLI 指定檔案時的月份；省略時從檔名找（`115_10`、`115-10`、`115年10`），找不到用今天的民國年月 |
| `matcher` 另外匯出 | — | `doorplate_label(db)`、`distance_to(match, point)` | B 的 `/area` 顯示門牌月份、算距離分組可共用 |
| 規格 §4「台→臺」 | 統一成「臺」 | 統一成「台」 | 門牌表街名寫「台上路」「南台路」「台糖路」；外縣市判斷兩種寫法都認 |
| 門牌「號之N」 | — | 「５２號之５」＝52 之 5；「十樓之１」不算 | 門牌表有 3,348 列把之號寫在號後面 |
| 「附」號、「特8號」等 | — | 略過（全市 544 列） | 不是一般門牌；同號另有正常列 |
| 門牌表大小（規格 §13） | 約 85MB | 一版含索引 **約 185MB**（表 94MB＋索引 91MB），換版時新舊並存約 370MB | 實測；開同步前的空間門檻要跟著改 |

## Review Focus

1. **地址寫法變體**（全形半形混用、`68-1號`／`68之1號`／`68號之1`、`3F`／`十二樓之3`、沒寫「高雄市」、寫了「○○里○鄰」、郵遞區號在前、舊高雄縣、「建國路3段」「京吉1路」）：一律解析出同一個門牌。→ A1 `CASES`（46 例）。
2. **地址改成空白或外縣市**：`recruitment_visit_geo` 變 `unlocated`、`recruitment_visits.district` 清成 NULL，舊的里與距離不殘留。→ A5 `test_changed_address_clears_old_result`。
3. **門牌同步中途失敗**（欄位變了、HTTP 500、筆數太少、下載到一半斷線）：使用中的批次照常可查，`last_error` 有原因且不含地址。→ A4 `test_failed_import_leaves_active_batch_alone`、A6 `test_failed_download_keeps_active_version`、`test_too_few_rows_is_refused`。
4. **校址比對不到**：`campus_point` 回 `locate_error`（`no_address`／`pending`／`no_doorplate`），距離一律 None，不丟例外。→ A5 `test_campus_point`、`test_distance_rounds_to_100m`。
5. **背景重算不碰樂觀鎖、不蓋掉使用者剛改的地址**：只寫 `district` 與 `recruitment_visit_geo`，`version`、`updated_at` 不變；重算途中使用者改了地址就跳過那一筆。→ A5 `test_rematch_keeps_version_and_updated_at`、`test_rematch_does_not_overwrite_a_concurrent_address_edit`。

---

## 前置：環境（每個 session 開頭做一次）

- [ ] **建 venv、測試庫，確認基準綠燈**

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008/backend
uv sync
createdb ivy_website_area1008_test 2>/dev/null; true
export WEBSITE_ENVIRONMENT=test \
  WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test \
  WEBSITE_SESSION_SECRET=local-only-session-secret-0000
uv run alembic upgrade head
uv run pytest -q tests/test_health.py tests/test_admissions_schema.py
```

Expected：`alembic` 停在 `c4e8a2f61b97`（A3 之後是 `e7a1c4d9b2f6`）；兩個測試檔全過。之後所有 `uv run pytest` 都在這個 shell（`WEBSITE_TEST_DATABASE_URL` 已設）裡跑。所有測試（含純函式）都會經過 conftest 的 autouse 清表 fixture，所以一定要有測試庫。

---

### Task A1：高雄市行政區表與地址解析

**Files:**
- Create: `backend/app/admissions/geo/__init__.py`（空檔）
- Create: `backend/app/admissions/geo/kaohsiung.py`
- Create: `backend/app/admissions/geo/address.py`
- Test: `backend/tests/test_geo_address.py`

**Interfaces:**
- Consumes：無。
- Produces：`TOWN_CODES: dict[str, str]`、`DISTRICTS: frozenset[str]`、`CODE_OF_DISTRICT: dict[str, str]`、`LEGACY_TOWNS: dict[str, str]`、`OTHER_COUNTIES: tuple[str, ...]`、`fix_village_name(name: str) -> str`；`ParsedAddress(district, street, lane, alley, number, number_sub, outside_kaohsiung)`（frozen dataclass，lane／alley 是 `str | None`）、`parse_address(raw: str | None) -> ParsedAddress | None`、`normalize_text(raw: str) -> str`、`unit_token(token: str) -> str`、`cn_number(value: int) -> str`、`cn_to_int(text: str) -> int | None`。

- [ ] **Step 1：寫失敗測試** — 建立 `backend/tests/test_geo_address.py`：

```python
"""地址正規化與解析（2026-10-08 區域分析規格 §6.2）。純函式，不連資料庫。"""

from __future__ import annotations

import pytest

from app.admissions.geo.address import ParsedAddress, cn_number, cn_to_int, normalize_text, parse_address, unit_token
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT, DISTRICTS, LEGACY_TOWNS, TOWN_CODES, fix_village_name


def P(district=None, street=None, lane=None, alley=None, number=None, sub=0, outside=False) -> ParsedAddress:
    return ParsedAddress(district, street, lane, alley, number, sub, outside)


YIHUA_68 = P("三民區", "義華路", number=68)
YIHUA_68_1 = P("三民區", "義華路", number=68, sub=1)
OUTSIDE = P(outside=True)
NO_DISTRICT = P()

CASES = [
    # 同一個門牌的各種寫法（Review Focus 1）
    ("高雄市三民區義華路68號", YIHUA_68),
    ("807高雄市三民區義華路68號", YIHUA_68),
    ("80794高雄市三民區義華路68號", YIHUA_68),
    ("[807]高雄市三民區義華路６８號", YIHUA_68),
    ("（807）高雄市三民區義華路68號", YIHUA_68),
    ("台灣高雄市三民區義華路68號", YIHUA_68),
    ("三民區義華路68號", YIHUA_68),
    ("高雄三民區義華路68號", YIHUA_68),
    ("高雄市 三民區 義華路 68 號", YIHUA_68),
    ("高雄市三民區本揚里3鄰義華路68號3樓之2", YIHUA_68),
    ("高雄市三民區鼎金里義華路68號", YIHUA_68),
    ("高雄市三民區3鄰義華路68號", YIHUA_68),
    ("高雄市三民區義華路68號3F", YIHUA_68),
    ("高雄市三民區義華路68號十二樓之3", YIHUA_68),
    ("高雄市三民區義華路68", YIHUA_68),
    ("高雄市三民區義華路六十八號", YIHUA_68),
    ("高雄市三民區義華路68-1號", YIHUA_68_1),
    ("高雄市三民區義華路68－1號", YIHUA_68_1),
    ("高雄市三民區義華路68之1號", YIHUA_68_1),
    ("高雄市三民區義華路68號之1", YIHUA_68_1),
    # 外縣市
    ("臺北市大安區信義路三段1號", OUTSIDE),
    ("台中市西屯區台灣大道三段99號", OUTSIDE),
    ("屏東縣屏東市自由路1號", OUTSIDE),
    ("臺南市東區中華東路二段185巷14號", OUTSIDE),
    ("台南市", OUTSIDE),
    # 舊高雄縣
    ("高雄縣仁武鄉京吉一路102號", P("仁武區", "京吉一路", number=102)),
    ("高雄縣鳳山市建國路三段100號", P("鳳山區", "建國路三段", number=100)),
    ("高雄縣三民鄉民生村1號", P("那瑪夏區", "民生村", number=1)),
    # 路名序數、段號的阿拉伯數字轉成門牌表的中文寫法
    ("高雄市仁武區京吉1路102號", P("仁武區", "京吉一路", number=102)),
    ("高雄市鳳山區建國路3段100號", P("鳳山區", "建國路三段", number=100)),
    ("高雄市三民區建國3路100號", P("三民區", "建國三路", number=100)),
    ("高雄市三民區民族1路10號", P("三民區", "民族一路", number=10)),
    ("高雄市彌陀區舊港路東段46巷21號", P("彌陀區", "舊港路東段", lane="46", number=21)),
    # 街名本身帶「里」「村」不能被當成里拿掉
    ("高雄市大樹區五里路1號", P("大樹區", "五里路", number=1)),
    ("高雄市橋頭區里林東路10號", P("橋頭區", "里林東路", number=10)),
    # 「臺」統一成門牌表的「台」
    ("高雄市大寮區臺上路1號", P("大寮區", "台上路", number=1)),
    # 「地區」型、具名巷、巷弄
    ("高雄市楠梓區右昌一巷12號", P("楠梓區", "右昌一巷", number=12)),
    ("高雄市仁武區仁心路博愛巷1弄2之1號", P("仁武區", "仁心路", lane="博愛", alley="1", number=2, sub=1)),
    ("高雄市三民區義華路12巷3弄5號", P("三民區", "義華路", lane="12", alley="3", number=5)),
    ("高雄市三民區義華路十二巷5號", P("三民區", "義華路", lane="12", number=5)),
    ("高雄市三民區義華路12巷", P("三民區", "義華路", lane="12")),
    ("高雄市三民區義華路", P("三民區", "義華路")),
    ("高雄市三民區", P("三民區")),
    # 多門牌：取寫著「號」的那個
    ("高雄市楠梓區大學東路115、117號", P("楠梓區", "大學東路", number=117)),
    # 解析不出高雄市的區
    ("義華路68號", NO_DISTRICT),
    ("高雄市", NO_DISTRICT),
    ("台北", NO_DISTRICT),
]


@pytest.mark.parametrize(("raw", "expected"), CASES, ids=[case[0] for case in CASES])
def test_parse_address(raw, expected):
    assert parse_address(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", "　　"])
def test_blank_address_is_none(raw):
    assert parse_address(raw) is None


def test_chinese_numbers():
    assert [cn_number(n) for n in (1, 3, 10, 12, 20, 21)] == ["一", "三", "十", "十二", "二十", "二十一"]
    assert [cn_to_int(t) for t in ("三", "十", "十二", "二十", "六十八")] == [3, 10, 12, 20, 68]
    assert cn_to_int("博愛") is None
    assert cn_to_int("") is None


def test_normalize_text():
    assert normalize_text("臺北 １２３－４　號") == "台北123-4號"


@pytest.mark.parametrize(("token", "expected"), [("06", "6"), ("66", "66"), ("十二", "12"), ("博愛", "博愛"), ("光明10", "光明10")])
def test_unit_token(token, expected):
    assert unit_token(token) == expected


def test_kaohsiung_tables():
    assert len(TOWN_CODES) == 38 and len(DISTRICTS) == 38
    assert CODE_OF_DISTRICT["三民區"] == "6400500" and CODE_OF_DISTRICT["仁武區"] == "6401700"
    assert len(LEGACY_TOWNS) == 27
    assert set(LEGACY_TOWNS.values()) <= DISTRICTS
    assert LEGACY_TOWNS["三民鄉"] == "那瑪夏區"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("北美術館", "北美術館里"), ("南美術館", "南美術館里"), ("達卡努瓦", "達卡努瓦里"), ("鼎金里", "鼎金里"), (" 本揚里 ", "本揚里")],
)
def test_fix_village_name(raw, expected):
    assert fix_village_name(raw) == expected
```

- [ ] **Step 2：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_address.py`
Expected：collection error，`ModuleNotFoundError: No module named 'app.admissions.geo'`。

- [ ] **Step 3：實作** — 建立空的 `backend/app/admissions/geo/__init__.py`，再建立 `backend/app/admissions/geo/kaohsiung.py`（區代碼取自高雄市資料開放平台「高雄市區代碼」，2026-10-08 下載核對過 38 區）：

```python
"""高雄市行政區代碼、舊高雄縣鄉鎮市對照、門牌資料的里名補字（規格 §4、§6.2）。

區代碼取自高雄市政府資料開放平台「高雄市區代碼」（民政局），與門牌坐標資料的
「鄉鎮市區代碼」欄相同。2010-12-25 縣市合併前的高雄縣 27 個鄉鎮市一律改制為區，
名稱只把鄉／鎮／市換成區，唯一例外是三民鄉改名那瑪夏區。"""

from __future__ import annotations

TOWN_CODES: dict[str, str] = {
    "6400100": "鹽埕區", "6400200": "鼓山區", "6400300": "左營區", "6400400": "楠梓區",
    "6400500": "三民區", "6400600": "新興區", "6400700": "前金區", "6400800": "苓雅區",
    "6400900": "前鎮區", "6401000": "旗津區", "6401100": "小港區", "6401200": "鳳山區",
    "6401300": "林園區", "6401400": "大寮區", "6401500": "大樹區", "6401600": "大社區",
    "6401700": "仁武區", "6401800": "鳥松區", "6401900": "岡山區", "6402000": "橋頭區",
    "6402100": "燕巢區", "6402200": "田寮區", "6402300": "阿蓮區", "6402400": "路竹區",
    "6402500": "湖內區", "6402600": "茄萣區", "6402700": "永安區", "6402800": "彌陀區",
    "6402900": "梓官區", "6403000": "旗山區", "6403100": "美濃區", "6403200": "六龜區",
    "6403300": "甲仙區", "6403400": "杉林區", "6403500": "內門區", "6403600": "茂林區",
    "6403700": "桃源區", "6403800": "那瑪夏區",
}
DISTRICTS: frozenset[str] = frozenset(TOWN_CODES.values())
CODE_OF_DISTRICT: dict[str, str] = {name: code for code, name in TOWN_CODES.items()}

LEGACY_TOWNS: dict[str, str] = {
    "鳳山市": "鳳山區", "岡山鎮": "岡山區", "旗山鎮": "旗山區", "美濃鎮": "美濃區",
    "林園鄉": "林園區", "大寮鄉": "大寮區", "大樹鄉": "大樹區", "仁武鄉": "仁武區",
    "大社鄉": "大社區", "鳥松鄉": "鳥松區", "橋頭鄉": "橋頭區", "燕巢鄉": "燕巢區",
    "田寮鄉": "田寮區", "阿蓮鄉": "阿蓮區", "路竹鄉": "路竹區", "湖內鄉": "湖內區",
    "茄萣鄉": "茄萣區", "永安鄉": "永安區", "彌陀鄉": "彌陀區", "梓官鄉": "梓官區",
    "六龜鄉": "六龜區", "甲仙鄉": "甲仙區", "杉林鄉": "杉林區", "內門鄉": "內門區",
    "茂林鄉": "茂林區", "桃源鄉": "桃源區", "三民鄉": "那瑪夏區",
}

# 地址開頭寫這些縣市＝非高雄市（「臺」已在 normalize_text 統一成「台」）。
OTHER_COUNTIES: tuple[str, ...] = (
    "台北市", "新北市", "桃園市", "台中市", "台南市", "基隆市", "新竹市", "新竹縣", "苗栗縣",
    "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣",
    "澎湖縣", "金門縣", "連江縣", "台北縣", "桃園縣", "台中縣", "台南縣",
)


def fix_village_name(name: str) -> str:
    """門牌資料有 3 個里漏了「里」字（北美術館、南美術館、達卡努瓦），補上後才對得上
    里界圖與戶政資料。已經以「里」結尾的不變。"""
    name = name.strip()
    return name if not name or name.endswith("里") else f"{name}里"
```

建立 `backend/app/admissions/geo/address.py`：

```python
"""家長手填地址的正規化與解析（規格 §6.2）。純函式，不查資料庫。

解析結果的寫法對齊高雄市門牌坐標資料，matcher 直接拿來查表：
- 街路段：門牌表段號與路名序數都是中文（「建國路三段」「民族一路」），手寫的阿拉伯數字
  轉成中文；「臺」「台」一律用「台」（門牌表街名寫「台上路」「南台路」）。
- 巷、弄：數字轉成不帶前導零的阿拉伯數字字串（「６６巷」→"66"）；門牌表也有具名巷
  （「博愛巷」「南二巷」），照原字保留（"博愛"）。
- 號：主號與之號；「號」之後的樓層全部丟掉。
沒有路／街／大道的地址（門牌表「地區」欄，例「右昌一巷」「合群新村」）整段當街路段。"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.admissions.geo.kaohsiung import DISTRICTS, LEGACY_TOWNS, OTHER_COUNTIES


@dataclass(frozen=True)
class ParsedAddress:
    district: str | None
    street: str | None
    lane: str | None
    alley: str | None
    number: int | None
    number_sub: int
    outside_kaohsiung: bool


_CN_DIGITS = "〇一二三四五六七八九"
_CN_VALUE = {char: value for value, char in enumerate(_CN_DIGITS)} | {"零": 0, "兩": 2}
_ROAD = r"(?:大道|路|街)"
_DASHES = re.compile(r"[‐‑‒–—―ー]")
_POSTAL = re.compile(r"^[\[(]?\d{3}(?:\d{2,3})?[\])]?")
_DISTRICT = re.compile(
    "^(" + "|".join(sorted([*DISTRICTS, *LEGACY_TOWNS], key=len, reverse=True)) + ")"
)
_VILLAGE = re.compile(r"^([一-鿿]{1,3}[里村])(\d+鄰)?(.*)$")
_STARTS_WITH_ROAD = re.compile(r"^[一-鿿]{2,}?" + _ROAD)
_NUMBER = re.compile(r"臨?(\d+|[〇一二三四五六七八九十]+)(?:[-之](\d+))?號(?:之(\d+)(?![樓F\d]))?")
_BARE_NUMBER = re.compile(r"(\d+)(?:-(\d+))?$")
_ROAD_ORDINAL = re.compile(r"(?<=[一-鿿])(\d{1,2})(?=" + _ROAD + ")")
_SECTION_DIGITS = re.compile("(" + _ROAD + r")(\d{1,2})段")
_STREET = re.compile(r"^(.*?" + _ROAD + r"(?:[一-鿿]{1,2}段)?)(.*)$")
_LANE_ALLEY = re.compile(r"^(?:(.+?)巷)?(?:(.+?)弄)?$")
_AREA = re.compile(r"^(.+?)(?:(\d+)巷)?(?:(\d+)弄)?$")


def cn_number(value: int) -> str:
    """1–99 的中文數字（10→十、21→二十一），用在路名序數與段號。"""
    if value < 10:
        return _CN_DIGITS[value]
    tens, ones = divmod(value, 10)
    return ("" if tens == 1 else _CN_DIGITS[tens]) + "十" + (_CN_DIGITS[ones] if ones else "")


def cn_to_int(text: str) -> int | None:
    """「十二」「二十」「三」「一二」→ 整數；含其他字回 None。"""
    if not text or any(char not in _CN_VALUE and char != "十" for char in text):
        return None
    if "十" not in text:
        return int("".join(str(_CN_VALUE[char]) for char in text))
    tens, _, ones = text.partition("十")
    if "十" in ones:
        return None
    return (_CN_VALUE[tens] if tens else 1) * 10 + (_CN_VALUE[ones] if ones else 0)


def normalize_text(raw: str) -> str:
    """NFKC（全形轉半形）、去所有空白、各種破折號統一成 -、「臺」統一成「台」。"""
    text = unicodedata.normalize("NFKC", raw)
    text = re.sub(r"\s+", "", text)
    text = _DASHES.sub("-", text)
    return text.replace("臺", "台")


def unit_token(token: str) -> str:
    """巷、弄的編號：阿拉伯或純中文數字 → 不帶前導零的數字字串；具名巷照原字。"""
    if token.isdigit():
        return str(int(token))
    value = cn_to_int(token)
    return str(value) if value is not None else token


def _number_value(token: str) -> int | None:
    return int(token) if token.isdigit() else cn_to_int(token)


def parse_address(raw: str | None) -> ParsedAddress | None:
    if raw is None:
        return None
    text = normalize_text(raw)
    if not text:
        return None
    text = _POSTAL.sub("", text)
    text = re.sub(r"^(?:中華民國)?(?:台灣省?)?", "", text)
    if text.startswith(("高雄市", "高雄縣")):
        text = text[3:]
    elif text.startswith("高雄"):
        text = text[2:]
    elif text.startswith(OTHER_COUNTIES):
        return ParsedAddress(None, None, None, None, None, 0, True)

    matched = _DISTRICT.match(text)
    if matched is None:
        return ParsedAddress(None, None, None, None, None, 0, False)
    district = LEGACY_TOWNS.get(matched.group(1), matched.group(1))
    text = text[matched.end():]

    # 使用者寫的里鄰不採信（里以門牌表為準），只是要拿掉。「五里路」「大里街」這種
    # 街名本身帶里字的不能誤刪：拿掉之後剩下的必須還是「兩個字以上＋路／街／大道」。
    village = _VILLAGE.match(text)
    if village and (village.group(2) or _STARTS_WITH_ROAD.match(village.group(3))):
        text = village.group(3)
    text = re.sub(r"^\d+鄰", "", text)

    number: int | None = None
    number_sub = 0
    head = text
    found = _NUMBER.search(text)
    if found:
        number = _number_value(found.group(1))
        number_sub = int(found.group(2) or found.group(3) or 0)
        head = text[: found.start()]
    else:
        bare = _BARE_NUMBER.search(text)
        if bare and re.search(_ROAD + r"$|巷$|弄$", text[: bare.start()]):
            number = int(bare.group(1))
            number_sub = int(bare.group(2) or 0)
            head = text[: bare.start()]

    head = _ROAD_ORDINAL.sub(lambda m: cn_number(int(m.group(1))), head)
    head = _SECTION_DIGITS.sub(lambda m: m.group(1) + cn_number(int(m.group(2))) + "段", head)
    lane: str | None = None
    alley: str | None = None
    street_match = _STREET.match(head)
    if street_match and len(street_match.group(1)) >= 2:
        street = street_match.group(1)
        # 街名與號之間若夾了巷弄以外的字（「115、117號」「121.123號」這種多門牌），
        # 巷弄當作沒寫，號仍照用。
        units = _LANE_ALLEY.match(street_match.group(2))
        if units is not None:
            lane = unit_token(units.group(1)) if units.group(1) else None
            alley = unit_token(units.group(2)) if units.group(2) else None
    else:
        area = _AREA.match(head)
        if area is None:
            return ParsedAddress(district, None, None, None, number, number_sub, False)
        street = area.group(1)
        lane = unit_token(area.group(2)) if area.group(2) else None
        alley = unit_token(area.group(3)) if area.group(3) else None
    return ParsedAddress(district, street or None, lane, alley, number, number_sub, False)
```

- [ ] **Step 4：跑測試確認通過**

Run：`uv run pytest -q tests/test_geo_address.py`
Expected：64 passed。

- [ ] **Step 5：Commit**（使用者同意才做，見總覽）

```bash
git add backend/app/admissions/geo/__init__.py backend/app/admissions/geo/kaohsiung.py backend/app/admissions/geo/address.py backend/tests/test_geo_address.py
git commit -m "feat(admissions): 區域分析的高雄市地址解析

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2：TWD97 TM2 轉經緯度與直線距離

**Files:**
- Create: `backend/app/admissions/geo/projection.py`
- Test: `backend/tests/test_geo_projection.py`

**Interfaces:**
- Consumes：無。
- Produces：`twd97_tm2_to_wgs84(x: float, y: float) -> tuple[float, float]`（回 `(lat, lng)`）、`haversine_m(lat1, lng1, lat2, lng2) -> float`。

- [ ] **Step 1：寫失敗測試** — 建立 `backend/tests/test_geo_projection.py`（向量由 pyproj 3.x `Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)` 算出，2026-10-08）：

```python
"""TWD97 TM2 → WGS84 與直線距離。測試向量由 pyproj（EPSG:3826 → EPSG:4326）算出。"""

from __future__ import annotations

import pytest

from app.admissions.geo.projection import haversine_m, twd97_tm2_to_wgs84

VECTORS = [
    (182545.62, 2504840.809, 22.642455639, 120.343713324),  # 義華路68號
    (176205.163, 2503011.609, 22.625672795, 120.282114231),  # 七賢三路110號
    (182380.03, 2509289.16, 22.682619963, 120.341910791),  # 京吉一路102號
    (165650.0, 2486410.0, 22.475262695, 120.180325848),  # 高雄市門牌 x、y 最小值
    (252731.0, 2590754.0, 23.419652797, 121.026724036),  # 高雄市門牌 x、y 最大值
    (250000.0, 2544283.12, 22.999999957, 121.0),  # 中央經線
]


@pytest.mark.parametrize(("x", "y", "lat", "lng"), VECTORS)
def test_tm2_to_wgs84_matches_pyproj(x, y, lat, lng):
    got_lat, got_lng = twd97_tm2_to_wgs84(x, y)
    assert got_lat == pytest.approx(lat, abs=1e-6)
    assert got_lng == pytest.approx(lng, abs=1e-6)


def test_haversine():
    yihua = (22.642455639, 120.343713324)
    renwu = (22.682619963, 120.341910791)
    assert haversine_m(*yihua, *renwu) == pytest.approx(4469.9, abs=1.0)
    assert haversine_m(*renwu, *yihua) == pytest.approx(haversine_m(*yihua, *renwu))
    assert haversine_m(*yihua, *yihua) == 0
```

- [ ] **Step 2：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_projection.py`
Expected：`ModuleNotFoundError: No module named 'app.admissions.geo.projection'`。

- [ ] **Step 3：實作** — 建立 `backend/app/admissions/geo/projection.py`：

```python
"""TWD97 二度分帶（TM2，中央經線 121°，EPSG:3826）座標轉 WGS84 經緯度，以及兩點的
大圓距離。門牌資料的橫縱座標是 TM2 公尺；TWD97 與 WGS84 的橢球差在公分級，
直接當 WGS84 用。不引入 pyproj：反算公式（Snyder, Map Projections 第 8 章）幾十行
就夠，與 pyproj 對照誤差在 1e-9 度以內（tests/test_geo_projection.py）。"""

from __future__ import annotations

import math

_A = 6378137.0  # GRS80 長半軸
_F = 1 / 298.257222101  # GRS80 扁率
_K0 = 0.9999
_LON0 = math.radians(121.0)
_FALSE_EASTING = 250000.0
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_E1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
_MU_DENOMINATOR = _A * (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256)
_EARTH_RADIUS_M = 6371008.8


def twd97_tm2_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """(橫座標, 縱座標) 公尺 → (緯度, 經度) 度。"""
    mu = (y / _K0) / _MU_DENOMINATOR
    phi1 = (
        mu
        + (3 * _E1 / 2 - 27 * _E1**3 / 32) * math.sin(2 * mu)
        + (21 * _E1**2 / 16 - 55 * _E1**4 / 32) * math.sin(4 * mu)
        + (151 * _E1**3 / 96) * math.sin(6 * mu)
        + (1097 * _E1**4 / 512) * math.sin(8 * mu)
    )
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = _EP2 * cos1**2
    t1 = tan1**2
    n1 = _A / math.sqrt(1 - _E2 * sin1**2)
    r1 = _A * (1 - _E2) / (1 - _E2 * sin1**2) ** 1.5
    d = (x - _FALSE_EASTING) / (n1 * _K0)
    lat = phi1 - (n1 * tan1 / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * _EP2 - 3 * c1**2) * d**6 / 720
    )
    lng = _LON0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * _EP2 + 24 * t1**2) * d**5 / 120
    ) / cos1
    return math.degrees(lat), math.degrees(lng)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """兩點大圓距離（公尺）。"""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lng2 - lng1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(h))
```

- [ ] **Step 4：跑測試確認通過**

Run：`uv run pytest -q tests/test_geo_projection.py`
Expected：7 passed（實際誤差在 1e-9 度）。

- [ ] **Step 5：Commit**

```bash
git add backend/app/admissions/geo/projection.py backend/tests/test_geo_projection.py
git commit -m "feat(admissions): 區域分析的 TWD97 座標轉換與直線距離

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3：四張表、migration、測試隔離

**Files:**
- Create: `backend/app/admissions/geo/models.py`
- Create: `backend/migrations/versions/e7a1c4d9b2f6_admissions_area_geo.py`
- Create: `backend/tests/geo_helpers.py`（本任務先放 `add_visit`；A4 補其餘）
- Modify: `backend/migrations/env.py:20`（import geo models）
- Modify: `backend/tests/conftest.py:143`（TRUNCATE 清單加四張表）
- Test: `backend/tests/test_geo_schema.py`

**Interfaces:**
- Consumes：`app.db.Base`、`app.admissions.models.RecruitmentVisit`（只在測試輔助用）。
- Produces：`GeoDoorplate`、`GeoKindergarten`、`GeoDatasetStatus`、`RecruitmentVisitGeo`；常數 `MATCH_LEVELS`、`UNLOCATED_REASONS`、`VILLAGE_LEVELS`、`KINDERGARTEN_KINDS`、`STREET_KINDS`、`DATASETS`。`geo/models.py` **不 import** `app.admissions.models`（B1 會在 `admissions/models.py` 檔尾 import 這裡、從 `RecruitmentVisit` 建 `geo` relationship）；`RecruitmentVisitGeo` 沒有 relationship，只有 `visit_id` 外鍵＋`ON DELETE CASCADE`。

- [ ] **Step 1：確認 revision 沒撞號**

Run：`grep -rl "e7a1c4d9b2f6" migrations/ ; uv run alembic heads`
Expected：grep 沒有輸出；heads 只有 `c4e8a2f61b97 (head)`。若 head 已不是 `c4e8a2f61b97`（main 又進了 migration），把下面 migration 的 `down_revision` 改成新的 head，`test_geo_schema.py` 的斷言一起改。

- [ ] **Step 2：寫失敗測試** — 建立 `backend/tests/geo_helpers.py` 的第一版（只有 `add_visit`，A4 Step 1 會換成完整版）：

```python
"""招生區域分析測試共用（A4 補上公開資料樣本）。"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.models import RecruitmentVisit


async def add_visit(
    db: AsyncSession, *, address: str | None, campus_key: str = "yihua", anonymized: bool = False
) -> RecruitmentVisit:
    """直接寫一筆最小的招生訪視（不走 API、不比對）。會 flush、不 commit。"""
    now = datetime.now(timezone.utc)
    visit = RecruitmentVisit(
        campus_key=campus_key,
        month="115.09",
        visit_date=date(2026, 9, 8),
        child_name="區域測試",
        address=address,
        created_at=now,
        updated_at=now,
        anonymized_at=now if anonymized else None,
    )
    db.add(visit)
    await db.flush()
    return visit
```

建立 `backend/tests/test_geo_schema.py`：

```python
"""招生區域分析四張表的 migration 與約束（2026-10-08 規格 §5）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, delete, func, select, text
from sqlalchemy.exc import IntegrityError

from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten, RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from tests.geo_helpers import add_visit

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "e7a1c4d9b2f6_admissions_area_geo.py"
MODELS = (GeoDoorplate, GeoKindergarten, GeoDatasetStatus, RecruitmentVisitGeo)


def test_migration_follows_previous_head_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("e7a1c4d9b2f6").down_revision == "c4e8a2f61b97"
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只建表，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source and "add_column" not in source


def test_check_conditions_are_identical_in_models_and_migration():
    source = MIGRATION.read_text(encoding="utf-8").replace('"\n    "', "")
    for model in MODELS:
        for constraint in model.__table__.constraints:
            if isinstance(constraint, CheckConstraint):
                assert str(constraint.sqltext) in source, constraint.name


async def test_tables_exist(db_session):
    names = (
        await db_session.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND (table_name LIKE 'geo\\_%' OR table_name = 'recruitment_visit_geo')"
            )
        )
    ).scalars().all()
    assert set(names) == {"geo_doorplates", "geo_kindergartens", "geo_dataset_status", "recruitment_visit_geo"}


async def test_visit_geo_follows_visit_and_rejects_unknown_values(db_session):
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    db_session.add(RecruitmentVisitGeo(visit_id=visit.id, match_level="exact", matched_at=datetime.now(timezone.utc)))
    await db_session.commit()

    await db_session.execute(delete(RecruitmentVisit).where(RecruitmentVisit.id == visit.id))
    await db_session.commit()
    count = await db_session.scalar(select(func.count()).select_from(RecruitmentVisitGeo))
    assert count == 0

    other = await add_visit(db_session, address=None)
    db_session.add(RecruitmentVisitGeo(visit_id=other.id, match_level="guess", matched_at=datetime.now(timezone.utc)))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    db_session.add(GeoDatasetStatus(dataset="unknown"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
```

- [ ] **Step 3：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_schema.py`
Expected：`ModuleNotFoundError: No module named 'app.admissions.geo.models'`。

- [ ] **Step 4：實作 models** — 建立 `backend/app/admissions/geo/models.py`：

```python
"""招生區域分析的公開地理資料與訪視比對結果（docs/specs/2026-10-08-admissions-area-design.md 第 5 節）。

四張表都是官網專用，不進園務轉移契約。geo_doorplates／geo_kindergartens／
geo_dataset_status 是公開資料、與校區無關；recruitment_visit_geo 一筆訪視一列，
不存家長座標。列舉用 String＋CheckConstraint，條件字串與 migration
e7a1c4d9b2f6 逐字相同（tests/test_geo_schema.py 檢查）。

這個模組不 import app.admissions.models：admissions/models.py 檔尾會 import 這裡，
再從 RecruitmentVisit 那邊建立 geo relationship（階段 B）；反過來 import 會循環。
所以 RecruitmentVisitGeo 只有指向 recruitment_visits.id 的外鍵，沒有 relationship。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

MATCH_LEVELS = ("exact", "nearby", "street", "district", "unlocated", "pending")
UNLOCATED_REASONS = ("no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village", "anonymized")
# 有里的比對等級；exact、nearby 另有座標（算得出距離）。
VILLAGE_LEVELS = ("exact", "nearby", "street")
KINDERGARTEN_KINDS = ("public", "nonprofit", "quasi_public", "private")
STREET_KINDS = ("road", "area")
DATASETS = ("doorplates", "kindergartens", "campuses")


def _in(column: str, values: tuple[str, ...], *, nullable: bool = False) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    condition = f"{column} IN ({listed})"
    return f"{column} IS NULL OR {condition}" if nullable else condition


class GeoDoorplate(Base):
    """高雄市門牌（去樓層）。dataset_version 是匯入批次標記（「115-10#a1b2c3」）：同一個
    月份重匯也不會和使用中的批次混在一起，切換完成才刪舊批次。巷、弄沒有時存空字串，
    查詢一律用等號比對；具名巷（「博愛巷」）存「博愛」。"""

    __tablename__ = "geo_doorplates"
    __table_args__ = (
        CheckConstraint(_in("street_kind", STREET_KINDS), name="ck_geo_doorplates_street_kind"),
        Index(
            "ix_geo_doorplates_lookup",
            "dataset_version", "town_code", "street", "lane", "alley", "number", "number_sub",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    dataset_version: Mapped[str] = mapped_column(String(16), nullable=False)
    town_code: Mapped[str] = mapped_column(String(8), nullable=False)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    village: Mapped[str] = mapped_column(String(16), nullable=False)
    street: Mapped[str] = mapped_column(String(40), nullable=False)
    street_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    lane: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    alley: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    number_sub: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)


class GeoKindergarten(Base):
    """高雄市營業中的幼兒園（kiang 整理的全國教保資訊網資料）。不存負責人姓名。"""

    __tablename__ = "geo_kindergartens"
    __table_args__ = (
        CheckConstraint(_in("kind", KINDERGARTEN_KINDS), name="ck_geo_kindergartens_kind"),
        Index("ix_geo_kindergartens_lat_lng", "lat", "lng"),
    )

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    reg_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    pre_public_period: Mapped[str | None] = mapped_column(String(16), nullable=True)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    address: Mapped[str] = mapped_column(String(200), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    approved_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_fee_estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    has_penalty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GeoDatasetStatus(Base):
    """一種資料一列。
    - doorplates：active_version＝使用中的匯入批次標記（查詢用），label＝畫面上的「115-10」；
    - kindergartens：active_version、label 都是同步日期；
    - campuses：active_version＝「各校已發布校址＋使用中門牌批次」的指紋，變了就重算訪視
      （同步工作內部用，畫面不讀）。
    last_error 是最近一次失敗的原因，不含任何地址；成功或確認來源沒變時清掉。"""

    __tablename__ = "geo_dataset_status"
    __table_args__ = (CheckConstraint(_in("dataset", DATASETS), name="ck_geo_dataset_status_dataset"),)

    dataset: Mapped[str] = mapped_column(String(20), primary_key=True)
    active_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    label: Mapped[str | None] = mapped_column(String(16), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)


class RecruitmentVisitGeo(Base):
    """訪視地址的比對結果（規格 §5.4）。行政區寫回 recruitment_visits.district，這裡放里、
    比對等級、未定位原因、到本校的直線距離（取整到 100 m）、比對當時的門牌月份。"""

    __tablename__ = "recruitment_visit_geo"
    __table_args__ = (
        CheckConstraint(_in("match_level", MATCH_LEVELS), name="ck_recruitment_visit_geo_match_level"),
        CheckConstraint(
            _in("unlocated_reason", UNLOCATED_REASONS, nullable=True), name="ck_recruitment_visit_geo_reason"
        ),
    )

    visit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recruitment_visits.id", ondelete="CASCADE"), primary_key=True
    )
    village: Mapped[str | None] = mapped_column(String(16), nullable=True)
    match_level: Mapped[str] = mapped_column(String(16), nullable=False)
    unlocated_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    distance_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doorplate_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    matched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

- [ ] **Step 5：實作 migration** — 建立 `backend/migrations/versions/e7a1c4d9b2f6_admissions_area_geo.py`：

```python
"""招生區域分析：公開地理資料三張表與訪視比對結果表（2026-10-08 區域分析規格第 5 節）

規格：docs/specs/2026-10-08-admissions-area-design.md。
只新增表，不改既有資料，也不動 recruitment_visits 的結構（district 欄位原本就有）；
上一版程式不讀這些表，先跑 migration 再換程式也相容。CheckConstraint 的條件字串與
app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

Revision ID: e7a1c4d9b2f6
Revises: c4e8a2f61b97
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7a1c4d9b2f6"
down_revision = "c4e8a2f61b97"
branch_labels = None
depends_on = None

STREET_KIND_CHECK = "street_kind IN ('road', 'area')"
KIND_CHECK = "kind IN ('public', 'nonprofit', 'quasi_public', 'private')"
DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses')"
MATCH_LEVEL_CHECK = "match_level IN ('exact', 'nearby', 'street', 'district', 'unlocated', 'pending')"
REASON_CHECK = (
    "unlocated_reason IS NULL OR unlocated_reason IN "
    "('no_address', 'outside_kaohsiung', 'no_doorplate', 'ambiguous_village', 'anonymized')"
)


def upgrade() -> None:
    op.create_table(
        "geo_doorplates",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("dataset_version", sa.String(16), nullable=False),
        sa.Column("town_code", sa.String(8), nullable=False),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
        sa.Column("street", sa.String(40), nullable=False),
        sa.Column("street_kind", sa.String(8), nullable=False),
        sa.Column("lane", sa.String(16), nullable=False),
        sa.Column("alley", sa.String(16), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("number_sub", sa.Integer(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.CheckConstraint(STREET_KIND_CHECK, name="ck_geo_doorplates_street_kind"),
    )
    op.create_index(
        "ix_geo_doorplates_lookup",
        "geo_doorplates",
        ["dataset_version", "town_code", "street", "lane", "alley", "number", "number_sub"],
    )
    op.create_table(
        "geo_kindergartens",
        sa.Column("source_id", sa.String(64), primary_key=True),
        sa.Column("reg_no", sa.String(80), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("pre_public_period", sa.String(16), nullable=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("address", sa.String(200), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("approved_capacity", sa.Integer(), nullable=True),
        sa.Column("monthly_fee_estimate", sa.Integer(), nullable=True),
        sa.Column("has_penalty", sa.Boolean(), nullable=False),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(KIND_CHECK, name="ck_geo_kindergartens_kind"),
    )
    op.create_index("ix_geo_kindergartens_lat_lng", "geo_kindergartens", ["lat", "lng"])
    op.create_table(
        "geo_dataset_status",
        sa.Column("dataset", sa.String(20), primary_key=True),
        sa.Column("active_version", sa.String(64), nullable=True),
        sa.Column("label", sa.String(16), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.CheckConstraint(DATASET_CHECK, name="ck_geo_dataset_status_dataset"),
    )
    op.create_table(
        "recruitment_visit_geo",
        sa.Column(
            "visit_id",
            sa.Uuid(),
            sa.ForeignKey("recruitment_visits.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("village", sa.String(16), nullable=True),
        sa.Column("match_level", sa.String(16), nullable=False),
        sa.Column("unlocated_reason", sa.String(24), nullable=True),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("doorplate_version", sa.String(16), nullable=True),
        sa.Column("matched_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(MATCH_LEVEL_CHECK, name="ck_recruitment_visit_geo_match_level"),
        sa.CheckConstraint(REASON_CHECK, name="ck_recruitment_visit_geo_reason"),
    )


def downgrade() -> None:
    op.drop_table("recruitment_visit_geo")
    op.drop_table("geo_dataset_status")
    op.drop_index("ix_geo_kindergartens_lat_lng", table_name="geo_kindergartens")
    op.drop_table("geo_kindergartens")
    op.drop_index("ix_geo_doorplates_lookup", table_name="geo_doorplates")
    op.drop_table("geo_doorplates")
```

- [ ] **Step 6：`migrations/env.py` 收齊 metadata、conftest 每個測試清這四張表**

```diff
--- a/backend/migrations/env.py
+++ b/backend/migrations/env.py
@@ -18,6 +18,7 @@
 from app.booking import models as booking_models  # noqa: F401
 from app.booking import access_models as booking_access_models  # noqa: F401
 from app.admissions import models as admissions_models  # noqa: F401
+from app.admissions.geo import models as geo_models  # noqa: F401
 from app.notifications import models as notification_models  # noqa: F401
 from app.operations import models as operations_models  # noqa: F401
 from app.common import models as common_models  # noqa: F401
```

```diff
--- a/backend/tests/conftest.py
+++ b/backend/tests/conftest.py
@@ -140,6 +140,7 @@
                 "visit_requests, visit_slots, visit_rules, visit_exceptions, publish_jobs, "
                 "booking_configs, rate_limit_counters, line_campus_targets, line_groups, "
                 "retention_policies, retention_runs, "
+                "recruitment_visit_geo, geo_doorplates, geo_kindergartens, geo_dataset_status, "
                 "recruitment_contact_logs, recruitment_event_log, recruitment_visits, grade_intake_targets "
                 "RESTART IDENTITY CASCADE"
             )
```

（`recruitment_visit_geo` 本來就會被 `recruitment_visits` 的 TRUNCATE CASCADE 清掉，寫明是為了一眼看得到；三張公開資料表沒有外鍵，一定要列。）

- [ ] **Step 7：升級測試庫、來回一次 downgrade，跑測試**

```bash
uv run alembic upgrade head
uv run alembic downgrade -1 && uv run alembic upgrade head
uv run pytest -q tests/test_geo_schema.py tests/test_admissions_schema.py
```

Expected：upgrade 訊息是「Running upgrade c4e8a2f61b97 -> e7a1c4d9b2f6, 招生區域分析：公開地理資料三張表與訪視比對結果表（2026-10-08 區域分析規格第 5 節）」；downgrade／upgrade 都成功；測試全過。

- [ ] **Step 8：Commit**

```bash
git add backend/app/admissions/geo/models.py backend/migrations/versions/e7a1c4d9b2f6_admissions_area_geo.py \
  backend/migrations/env.py backend/tests/conftest.py backend/tests/geo_helpers.py backend/tests/test_geo_schema.py
git commit -m "feat(admissions): 區域分析的門牌、幼兒園、同步狀態與訪視比對結果四張表

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A4：門牌與幼兒園的解析、匯入、半徑查詢（含測試樣本）

**Files:**
- Create: `backend/tests/fixtures/geo/doorplates-sample.csv`、`preschools-sample.json`、`kcg-search.html`、`kcg-dataset.html`
- Create: `backend/app/admissions/geo/doorplates.py`
- Create: `backend/app/admissions/geo/kindergartens.py`
- Modify: `backend/tests/geo_helpers.py`（換成完整版）
- Test: `backend/tests/test_geo_doorplates.py`、`backend/tests/test_geo_kindergartens.py`

**Interfaces:**
- Consumes：A1 `normalize_text`、`unit_token`、`TOWN_CODES`、`fix_village_name`；A2 `twd97_tm2_to_wgs84`、`haversine_m`；A3 models。
- Produces：
  - `doorplates`：`EXPECTED_HEADER`、`DOORPLATE_COLUMNS`、`COPY_BATCH_SIZE = 5000`、`DoorplateFormatError`、`DoorplateRow`（frozen dataclass：town_code, district, village, street, street_kind, lane, alley, number, number_sub, lat, lng）、`DoorplateParser().feed(line: str) -> DoorplateRow | None`（屬性 `parsed`、`skipped`；表頭有無 BOM 都可）、`copy_doorplates(db, tag, rows) -> None`（不 commit）、`delete_batches(db, *, keep: str | None) -> None`（不 commit）、`import_doorplates(session_factory, tag, rows: AsyncIterable[DoorplateRow], *, batch_size=5000) -> int`、`activate_doorplates(session_factory, tag, label, *, now) -> None`。
  - `kindergartens`：`SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），月費為估計值"`、`KindergartenFormatError`、`KindergartenRow`、`NearbyKindergarten`（欄位同總覽）、`parse_preschools(data: dict, *, school_year: int) -> list[KindergartenRow]`（只留 `city` 高雄市且 `is_active` 為 1 或 "1"）、`replace_kindergartens(db, rows, *, synced_at) -> int`（不 commit）、`nearby(db, lat, lng, radius_m) -> list[NearbyKindergarten]`（依 `distance_m`、名稱排序）。
  - `tests/geo_helpers.py`（B、C 也用）：`FIXTURES`、`SAMPLE_TAG = "115-10#sample"`、`SAMPLE_LABEL = "115-10"`、`SAMPLE_SCHOOL_YEAR = 115`、`YIHUA_POINT = (22.6424556, 120.3437133)`、`SAMPLE_ADDRESSES`（鍵 `yihua_exact`、`yihua_nearby`、`district_only`、`outside`、`ambiguous`）、`sample_doorplate_rows()`、`sample_preschools()`、`async load_geo_samples(db)`（冪等、會 commit；`geo_dataset_status` 的 doorplates、kindergartens 兩筆都有 `synced_at`）、`async publish_campus_address(db, campus_key, address)`（會 commit）、`async add_visit(db, *, address, campus_key="yihua", anonymized=False)`。

- [ ] **Step 1：放測試樣本與完整的 geo_helpers**

樣本取自 2026-10-08 下載的真實公開資料（不含任何個人資料；幼兒園已拿掉負責人姓名等欄位）。建立 `backend/tests/fixtures/geo/doorplates-sample.csv`，內容如下（先存成 UTF-8、LF）：

```text
省市縣市代碼,鄉鎮市區代碼,村里,鄰,街路段,地區,巷,弄,號,橫座標,縱座標
64,6400100,府北里,014,府北路,,,,２５號四樓之３附１,176580.200,2503281.910
64,6400200,北美術館,001,中華一路,,,,１０２號,176900.770,2507617.030
64,6400200,北美術館,001,中華一路,,,,１０４號,176904.379,2507615.037
64,6400200,裕豐里,009,中華一路,,,,１０１號,177286.905,2507414.029
64,6400200,裕豐里,009,中華一路,,,,１０１號二樓,177286.905,2507414.029
64,6400200,裕豐里,009,中華一路,,,,１０１號三樓,177286.905,2507414.029
64,6400200,裕豐里,009,中華一路,,,,１０１號四樓,177286.905,2507414.029
64,6400200,裕豐里,009,中華一路,,,,１０１號五樓,177286.905,2507414.029
64,6400200,裕豐里,009,中華一路,,,,１０３號,177288.805,2507411.028
64,6400300,新超里,013,明華一路,,,,１７６號,178710.890,2507154.120
64,6400300,菜福里,005,崇德路,,,,８７號,178808.368,2508313.417
64,6400400,廣昌里,002,,右昌一巷,,１弄,１１號,176931.732,2512398.171
64,6400400,廣昌里,002,,右昌一巷,,３弄,１１號,176917.031,2512416.172
64,6400400,廣昌里,002,,右昌一巷,,,１１號,176906.331,2512439.172
64,6400400,廣昌里,004,,右昌一巷,,８７弄,１０號,176821.720,2512325.770
64,6400400,廣昌里,004,,右昌一巷,,８７弄,１２號,176824.980,2512323.570
64,6400400,廣昌里,009,,右昌一巷,,１４８弄,１１號,176748.618,2512362.171
64,6400400,廣昌里,005,,右昌一巷,,１５５弄,１０號,176769.619,2512252.168
64,6400400,廣昌里,005,,右昌一巷,,１５５弄,１２號,176766.918,2512248.168
64,6400400,廣昌里,010,,右昌一巷,,１７８弄,１０號,176723.444,2512327.888
64,6400400,廣昌里,011,,右昌一巷,,１７８弄,１１號,176698.814,2512317.171
64,6400400,廣昌里,010,,右昌一巷,,１７８弄,１２號,176720.247,2512329.655
64,6400400,廣昌里,007,,右昌一巷,,１８３弄,１０號,176738.780,2512202.570
64,6400400,廣昌里,006,,右昌一巷,,１８３弄,１１號,176747.510,2512211.980
64,6400400,廣昌里,007,,右昌一巷,,１８３弄,１２號,176743.040,2512200.150
64,6400400,廣昌里,011,,右昌一巷,,１９２弄,１０號,176700.214,2512302.170
64,6400400,廣昌里,011,,右昌一巷,,１９２弄,１１號,176686.113,2512281.170
64,6400400,廣昌里,012,,右昌一巷,,２１６弄,１０號,176681.790,2512256.720
64,6400400,廣昌里,012,,右昌一巷,,２１６弄,１１號,176672.930,2512247.720
64,6400400,廣昌里,012,,右昌一巷,,２１６弄,１２號,176678.560,2512258.450
64,6400400,福昌里,005,,右昌一巷,,,１２號,176863.560,2512465.590
64,6400400,福昌里,007,,右昌一巷,,１４８弄,１０號,176756.728,2512384.659
64,6400500,博惠里,032,憲政路,,,,２３９號,179981.370,2504196.917
64,6400500,博惠里,032,憲政路,,,,２４１號,179977.170,2504195.917
64,6400500,博惠里,032,憲政路,,,,２４３號,179973.170,2504193.917
64,6400500,博惠里,032,憲政路,,,,２４５號,179968.969,2504192.917
64,6400500,博惠里,032,憲政路,,,,２５５號,179954.268,2504189.917
64,6400500,博惠里,032,憲政路,,,,２５７號,179950.168,2504187.917
64,6400500,博惠里,032,憲政路,,,,２５９號,179946.268,2504186.917
64,6400500,博惠里,032,憲政路,,,,２６１號,179942.067,2504185.917
64,6400500,本揚里,032,義華路,,,,６２號,182571.669,2504834.914
64,6400500,本揚里,032,義華路,,,,６４號,182567.168,2504835.914
64,6400500,本揚里,032,義華路,,,,６６號,182562.668,2504836.914
64,6400500,本揚里,032,義華路,,,,６８號,182545.620,2504840.809
64,6400500,本揚里,032,義華路,,,,７０號,182533.168,2504843.486
64,6400500,本揚里,032,義華路,,,,７２號十樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號三樓,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號四樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號四樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號五樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號五樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號六樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號六樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號七樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號七樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號八樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號八樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號九樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號九樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十一樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十一樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十二樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十二樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十三樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十三樓之２,182515.298,2504864.179
64,6400500,本揚里,032,義華路,,,,７２號十四樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十四樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十五樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十五樓之２,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十六樓之１,182525.866,2504844.914
64,6400500,本揚里,032,義華路,,,,７２號十六樓之２,182525.866,2504844.914
64,6401000,中華里,007,旗津三路,,９００巷,,１號,175194.150,2500753.444
64,6401000,復興里,024,旗津三路,,９００巷,,１號二樓,175189.279,2500748.859
64,6401000,復興里,024,旗津三路,,９００巷,１弄,１號二樓,175249.785,2500852.861
64,6401000,復興里,024,旗津三路,,９００巷,１弄,１號三樓,175249.785,2500852.861
64,6401000,復興里,024,旗津三路,,９００巷,,１號三樓,175189.279,2500748.859
64,6401000,復興里,024,旗津三路,,９００巷,,１號四樓,175189.279,2500748.859
64,6401000,復興里,024,旗津三路,,９００巷,１弄,１號四樓,175249.785,2500852.861
64,6401000,復興里,024,旗津三路,,９００巷,１弄,１號五樓,175249.785,2500852.861
64,6401000,復興里,024,旗津三路,,９００巷,,１號五樓,175189.279,2500748.859
64,6401000,復興里,025,旗津三路,,９００巷,３弄,１號,175239.984,2500869.862
64,6401000,復興里,025,旗津三路,,９００巷,３弄,１號二樓,175239.984,2500869.862
64,6401000,復興里,025,旗津三路,,９００巷,３弄,１號三樓,175239.984,2500869.862
64,6401000,復興里,025,旗津三路,,９００巷,３弄,１號四樓,175239.984,2500869.862
64,6401000,復興里,025,旗津三路,,９００巷,３弄,１號五樓,175239.984,2500869.862
64,6401000,復興里,026,旗津三路,,９００巷,５弄,１號,175229.083,2500887.862
64,6401000,復興里,026,旗津三路,,９００巷,５弄,１號二樓,175229.083,2500887.862
64,6401000,復興里,026,旗津三路,,９００巷,５弄,１號三樓,175229.083,2500887.862
64,6401000,復興里,026,旗津三路,,９００巷,５弄,１號四樓,175229.083,2500887.862
64,6401000,復興里,026,旗津三路,,９００巷,５弄,１號五樓,175229.083,2500887.862
64,6401200,文英里,009,建國路三段,,,,９８號,183672.070,2504232.860
64,6401200,文英里,009,建國路三段,,,,１００號,183667.980,2504233.670
64,6401700,八卦里,019,京吉一路,,,,１０２號,182380.030,2509289.160
64,6401700,八卦里,019,京吉一路,,,,１０６號,182368.820,2509267.970
64,6401700,考潭里,019,仁心路,,博愛巷,１弄,１號,184916.380,2509651.840
64,6401700,考潭里,019,仁心路,,博愛巷,１弄,２號,184895.560,2509654.780
64,6401700,考潭里,019,仁心路,,博愛巷,１弄,２之１號,184898.930,2509645.620
64,6401700,考潭里,019,仁心路,,博愛巷,１弄,３號,184919.560,2509643.530
64,6401700,考潭里,020,仁心路,,博愛巷,２弄,１號,184948.120,2509654.610
64,6401700,考潭里,020,仁心路,,博愛巷,２弄,２號,184928.870,2509647.390
64,6401700,考潭里,020,仁心路,,博愛巷,２弄,３號,184951.080,2509646.620
64,6401700,考潭里,021,仁心路,,博愛巷,３弄,１號,184978.310,2509658.580
64,6401700,考潭里,021,仁心路,,博愛巷,３弄,２號,184957.520,2509658.350
64,6401700,考潭里,021,仁心路,,博愛巷,３弄,３號,184981.220,2509650.880
64,6401700,考潭里,022,仁心路,,博愛巷,４弄,１號,185065.880,2509509.850
64,6401700,考潭里,022,仁心路,,博愛巷,４弄,２號,185066.270,2509500.720
64,6401700,考潭里,022,仁心路,,博愛巷,４弄,３號,185063.360,2509487.410
64,6401700,考潭里,023,仁心路,,博愛巷,５弄,１號,184992.810,2509433.570
64,6401700,考潭里,023,仁心路,,博愛巷,５弄,２號,184977.710,2509411.000
64,6401700,考潭里,023,仁心路,,博愛巷,５弄,３號,184996.270,2509424.920
64,6401700,考潭里,023,仁心路,,博愛巷,６弄,１號,185079.670,2509555.840
64,6401700,考潭里,023,仁心路,,博愛巷,６弄,３號,185084.040,2509554.610
64,6401800,大華里,016,球場路,,,,５９號,181788.690,2506342.190
```

再把它轉成門牌原檔的格式（UTF-8 帶 BOM、CRLF）——`test_fixture_keeps_original_file_format` 會檢查：

```bash
python3 -c "
from pathlib import Path
p = Path('tests/fixtures/geo/doorplates-sample.csv')
text = p.read_text(encoding='utf-8-sig').replace('\r\n', '\n')
p.write_bytes(('\ufeff' + text).replace('\n', '\r\n').encode('utf-8'))
"
head -c 3 tests/fixtures/geo/doorplates-sample.csv | xxd   # 應為 efbb bf
```

建立 `backend/tests/fixtures/geo/preschools-sample.json`：

```json
{
 "type": "FeatureCollection",
 "features": [
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第10138771900號",
    "title": "高雄市私立常春藤幼兒園",
    "city": "高雄市",
    "town": "三民區",
    "type": "私立",
    "address": "[807]義華路68號",
    "tel": "(07)3928366#7",
    "count_approved": "210",
    "pre_public": "無",
    "penalty": "有",
    "id": "016cc701-ac12-4f88-9457-5eb6431ed449",
    "monthly": 15073,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.343815,
     22.642513
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第10132493200號",
    "title": "高雄市私立何嘉仁幼兒園",
    "city": "高雄市",
    "town": "三民區",
    "type": "私立",
    "address": "[807]澄和路16號",
    "tel": "(07)3929678",
    "count_approved": "150",
    "pre_public": "無",
    "penalty": "有",
    "id": "e464ae13-0cbc-4a8e-9289-de0c18abc263",
    "monthly": 15501,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.345523,
     22.644576
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第10132801800號",
    "title": "高雄市私立保羅幼兒園",
    "city": "高雄市",
    "town": "三民區",
    "type": "私立",
    "address": "[807]褒揚街276號1樓",
    "tel": "(07)3837050",
    "count_approved": "88",
    "pre_public": "113-115",
    "penalty": "有",
    "id": "0f26d968-d574-4e8f-bbdd-2b88a65efaf1",
    "monthly": 3750,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.338816,
     22.641514
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第11233339300號",
    "title": "高雄市私立義華幼兒園",
    "city": "高雄市",
    "town": "三民區",
    "type": "私立",
    "address": "[807]應安街112號",
    "tel": "(07)3834406",
    "count_approved": "150",
    "pre_public": "113-115",
    "penalty": "有",
    "id": "f52ff84f-335d-472e-955c-d441c562255f",
    "monthly": 3750,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.338086,
     22.641922
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第10133854400號",
    "title": "高雄市私立愛爾蘭幼兒園",
    "city": "高雄市",
    "town": "鳥松區",
    "type": "私立",
    "address": "[833]本館路3-13號",
    "tel": "(07)3705788",
    "count_approved": "136",
    "pre_public": "無",
    "penalty": "有",
    "id": "e517b294-6109-4c89-a847-07a260585e6c",
    "monthly": 11267,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.345863,
     22.647538
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第11430152000號",
    "title": "高雄市私立新美倫幼兒園",
    "city": "高雄市",
    "town": "鳳山區",
    "type": "私立",
    "address": "[830]文龍路33號",
    "tel": "(07)7775900",
    "count_approved": "360",
    "pre_public": "無",
    "penalty": "無",
    "id": "52c587f0-8993-46f2-b518-4b42f2e5941f",
    "monthly": 15758,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.349638,
     22.643203
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第11435914500號",
    "title": "高雄市灣內非營利幼兒園",
    "city": "高雄市",
    "town": "仁武區",
    "type": "非營利",
    "address": "[814]八德東路568號",
    "tel": "(07)3730272",
    "count_approved": "182",
    "pre_public": "無",
    "penalty": "無",
    "id": "e7c0d4ca-ade9-4f31-84a1-f33764179e24",
    "monthly": 2000,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     "120.347932",
     "22.687159"
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第10734465000號",
    "title": "高雄市私立小太陽哈佛幼兒園",
    "city": "高雄市",
    "town": "彌陀區",
    "type": "私立",
    "address": "[827]光華五巷15號",
    "tel": "(07)6101001",
    "count_approved": "40",
    "pre_public": "無",
    "penalty": "無",
    "id": "008b76eb-8e63-4089-ae9b-5a0b6c7b7d0e",
    "monthly": 5183,
    "is_active": 0
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.2367685,
     22.7608131
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第11232748300號",
    "title": "高雄市光武非營利幼兒園(委託高雄市教保人員職業工會辦理)",
    "city": "高雄市",
    "town": "三民區",
    "type": "非營利",
    "address": "[807]光武路35號",
    "tel": "(07)3853955",
    "count_approved": "106",
    "pre_public": "無",
    "penalty": "無",
    "id": "5a2708ce-9f97-4793-82fd-247c00de16e9",
    "monthly": 2000,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.334305,
     22.638867
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第11336439400號",
    "title": "高雄市三民區東光國民小學附設幼兒園",
    "city": "高雄市",
    "town": "三民區",
    "type": "公立",
    "address": "[807]黃興路206號",
    "tel": "(07)3839350#71",
    "count_approved": "76",
    "pre_public": "無",
    "penalty": "無",
    "id": "cff4213c-c1f6-4269-8e12-aa015c4248b0",
    "monthly": 4014,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.340118,
     22.648701
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第10935866800號",
    "title": "高雄市英明非營利幼兒園",
    "city": "高雄市",
    "town": "苓雅區",
    "type": "非營利",
    "address": "[802]英明路147號",
    "tel": "(07)7160076",
    "count_approved": "272",
    "pre_public": "無",
    "penalty": "無",
    "id": "1bf1a3ed-bf89-44dc-bf1a-06e8dca40808",
    "monthly": "",
    "is_active": 0
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.324395,
     22.615251
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "高市教幼字第11034819200號",
    "title": "高雄市私立常春藤仁武幼兒園",
    "city": "高雄市",
    "town": "仁武區",
    "type": "私立",
    "address": "[814]京吉一路102號",
    "tel": "(07)3757081",
    "count_approved": "346",
    "pre_public": "無",
    "penalty": "有",
    "id": "bc460930-0f69-42d1-bf99-976c5199e2f5",
    "monthly": 19227,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.341902,
     22.682562
    ]
   }
  },
  {
   "type": "Feature",
   "properties": {
    "reg_no": "南市教特(一)字第1151196278號",
    "title": "臺南市私立耶魯幼兒園",
    "city": "臺南市",
    "town": "東區",
    "type": "私立",
    "address": "[701]中華東路二段185巷14號",
    "tel": "(06)2699630",
    "count_approved": "120",
    "pre_public": "113-115",
    "penalty": "無",
    "id": "00089c75-4393-42f9-ac95-a3e922878004",
    "monthly": 3000,
    "is_active": 1
   },
   "geometry": {
    "type": "Point",
    "coordinates": [
     120.233692,
     22.984356
    ]
   }
  }
 ]
}
```

建立 `backend/tests/fixtures/geo/kcg-search.html`（高雄市資料開放平台搜尋頁的連結片段，原樣保留 HTML 實體）：

```html
<!DOCTYPE html>
<!-- 2026-10-08 擷取自 https://data.kcg.gov.tw/dataset?keyword=門牌坐標資料（只留結果清單的連結） -->
<html lang="zh-Hant"><body><div class="list">
<a type="button" class="border-bottom fw-bolder text-decoration-none text-black p-3 d-flex flex-column" title="&#x9AD8;&#x96C4;&#x5E02;115&#x5E74;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;-TWD97" href="/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414">
<a type="button" class="border-bottom fw-bolder text-decoration-none text-black p-3 d-flex flex-column" title="&#x9AD8;&#x96C4;&#x5E02;114&#x5E74;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;-TWD97" href="/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3">
<a type="button" class="border-bottom fw-bolder text-decoration-none text-black p-3 d-flex flex-column" title="&#x9AD8;&#x96C4;&#x5E02;112&#x5E74;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;-TWD97" href="/DataSet/Detail/f692449b-3410-4fda-886c-7cb8a40ae957">
<a type="button" class="border-bottom fw-bolder text-decoration-none text-black p-3 d-flex flex-column" title="&#x9AD8;&#x96C4;&#x5E02;113&#x5E74;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;-TWD97" href="/DataSet/Detail/b9579154-2b39-40f3-aacd-4d160029fbb9">
<a type="button" class="border-bottom fw-bolder text-decoration-none text-black p-3 d-flex flex-column" title="&#x9AD8;&#x96C4;&#x5E02;111&#x5E74;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;-TWD97" href="/DataSet/Detail/6d3e42e0-e5da-468b-b5c5-f82dafc1fadd">
<a type="button" class="border-bottom fw-bolder text-decoration-none text-black p-3 d-flex flex-column" title="&#x9AD8;&#x96C4;&#x5E02;&#x5340;&#x4EE3;&#x78BC;" href="/DataSet/Detail/7d92ad41-81a0-495e-aa45-3180f2ee72ab">
</div></body></html>
```

建立 `backend/tests/fixtures/geo/kcg-dataset.html`（「高雄市115年門牌坐標資料-TWD97」資料集頁的資源清單片段）：

```html
<!DOCTYPE html>
<!-- 2026-10-08 擷取自 https://data.kcg.gov.tw/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414（只留資料資源清單的前三筆） -->
<html lang="zh-Hant"><body><ul class="list-group rounded-0 mb-4">
<li><h6><a class="fw-bolder text-black text-decoration-none" title="115&#x5E74;10&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;" href="/Resource/667aae8f-d427-488b-9420-e51f28783dc3">115&#x5E74;10&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;</a></h6><a class="btn btn-main me-2 rounded-pill" title="詳細資料" href="/Resource/667aae8f-d427-488b-9420-e51f28783dc3">詳細資料</a></li>
<li><h6><a class="fw-bolder text-black text-decoration-none" title="115&#x5E74;9&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;" href="/Resource/222a9251-194a-478f-9ff9-c218da6cec7b">115&#x5E74;9&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;</a></h6><a class="btn btn-main me-2 rounded-pill" title="詳細資料" href="/Resource/222a9251-194a-478f-9ff9-c218da6cec7b">詳細資料</a></li>
<li><h6><a class="fw-bolder text-black text-decoration-none" title="115&#x5E74;8&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;" href="/Resource/dce0b155-72fb-48ff-8ca0-3ed74f620a3d">115&#x5E74;8&#x6708;&#x9580;&#x724C;&#x5750;&#x6A19;&#x8CC7;&#x6599;</a></h6><a class="btn btn-main me-2 rounded-pill" title="詳細資料" href="/Resource/dce0b155-72fb-48ff-8ca0-3ed74f620a3d">詳細資料</a></li>
</ul></body></html>
```

把 `backend/tests/geo_helpers.py` 整檔換成：

```python
"""招生區域分析測試共用：tests/fixtures/geo/ 的公開資料樣本、發布校址、建訪視。

樣本取自 2026-10-08 下載的真實公開資料，不含任何個人資料：
- doorplates-sample.csv：高雄市 115 年 10 月門牌坐標（原檔格式，UTF-8 帶 BOM、CRLF），
  義華路 62–72 號、仁武京吉一路 102／106 號、五校校址、旗津三路 900 巷（1 號對到兩個里）、
  仁心路博愛巷（具名巷＋弄）、右昌一巷（「地區」型）、中華一路（北美術館里缺「里」字）、
  憲政路（整條同一里）、府北路 25 號四樓之 3 附 1（附號寫在樓層後）。
- preschools-sample.json：kiang preschools.json 的 13 筆（去掉負責人等欄位），含停業、
  臺南市、座標是字串、準公共、非營利、公立、本機構。
- kcg-search.html、kcg-dataset.html：高雄市資料開放平台搜尋頁與資料集頁的連結片段。"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.doorplates import DoorplateParser, DoorplateRow, copy_doorplates
from app.admissions.geo.kindergartens import parse_preschools, replace_kindergartens
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten
from app.admissions.models import RecruitmentVisit

FIXTURES = Path(__file__).parent / "fixtures" / "geo"
SAMPLE_TAG = "115-10#sample"
SAMPLE_LABEL = "115-10"
SAMPLE_SCHOOL_YEAR = 115
# 義華校址（高雄市三民區義華路68號）在樣本門牌裡的座標。
YIHUA_POINT = (22.6424556, 120.3437133)
SAMPLE_ADDRESSES: dict[str, str] = {
    "yihua_exact": "高雄市三民區義華路68號",  # 本揚里，距義華 0 m
    "yihua_nearby": "高雄市三民區義華路74號",  # 樣本沒有 74 號，最近 72 號，本揚里
    "district_only": "高雄市三民區九如一路1號",  # 樣本沒有這條路
    "outside": "臺南市東區中華東路二段185巷14號",
    "ambiguous": "高雄市旗津區旗津三路900巷1號",  # 中華里、復興里各有一筆
}


def sample_doorplate_rows() -> list[DoorplateRow]:
    parser = DoorplateParser()
    rows: list[DoorplateRow] = []
    with (FIXTURES / "doorplates-sample.csv").open(encoding="utf-8", newline="") as handle:
        for line in handle:
            row = parser.feed(line)
            if row is not None:
                rows.append(row)
    return rows


def sample_preschools() -> dict:
    return json.loads((FIXTURES / "preschools-sample.json").read_text(encoding="utf-8"))


async def load_geo_samples(db: AsyncSession) -> None:
    """清掉三張公開資料表，載入門牌與幼兒園樣本並設為使用中（doorplates、kindergartens
    兩筆狀態都有 synced_at）。可以重複呼叫。會 commit。"""
    await db.execute(delete(GeoDoorplate))
    await db.execute(delete(GeoKindergarten))
    await db.execute(delete(GeoDatasetStatus))
    await copy_doorplates(db, SAMPLE_TAG, sample_doorplate_rows())
    now = datetime.now(timezone.utc)
    db.add(
        GeoDatasetStatus(
            dataset="doorplates", active_version=SAMPLE_TAG, label=SAMPLE_LABEL, synced_at=now, checked_at=now
        )
    )
    await db.flush()
    rows = parse_preschools(sample_preschools(), school_year=SAMPLE_SCHOOL_YEAR)
    await replace_kindergartens(db, rows, synced_at=now)
    await db.commit()


async def publish_campus_address(db: AsyncSession, campus_key: str, address: str) -> None:
    """發布一版只有必填欄位的校區資料，讓 campus_point 讀得到校址。會 commit。"""
    from app.content import service as content_service

    payload = {
        "name": f"{campus_key} 測試校", "district": "", "address": address, "phone": "07-0000000",
        "intro": "", "description": "", "facebook": "", "fb_note": "", "line": "",
    }
    item = await content_service.get_or_create_content_item(db, "campus_profile", campus_key)
    revision = await content_service.create_revision(db, item, payload, item.latest_version, None)
    await content_service.publish_revision(db, item, revision, None)
    await db.commit()


async def add_visit(
    db: AsyncSession, *, address: str | None, campus_key: str = "yihua", anonymized: bool = False
) -> RecruitmentVisit:
    """直接寫一筆最小的招生訪視（不走 API、不比對）。會 flush、不 commit。"""
    now = datetime.now(timezone.utc)
    visit = RecruitmentVisit(
        campus_key=campus_key,
        month="115.09",
        visit_date=date(2026, 9, 8),
        child_name="區域測試",
        address=address,
        created_at=now,
        updated_at=now,
        anonymized_at=now if anonymized else None,
    )
    db.add(visit)
    await db.flush()
    return visit
```

- [ ] **Step 2：寫失敗測試** — 建立 `backend/tests/test_geo_doorplates.py`：

```python
"""高雄市門牌 CSV 的逐列解析、分批匯入、切換批次（2026-10-08 規格 §4、§7）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.doorplates import (
    EXPECTED_HEADER,
    DoorplateFormatError,
    DoorplateParser,
    activate_doorplates,
    import_doorplates,
)
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.common.csv_export import BOM
from tests.geo_helpers import FIXTURES, sample_doorplate_rows

HEADER = ",".join(EXPECTED_HEADER)


def _feed(*lines: str):
    parser = DoorplateParser()
    rows = [parser.feed(line) for line in (HEADER, *lines)]
    return [row for row in rows if row is not None], parser


def test_sample_is_parsed_and_floors_are_deduplicated():
    rows = sample_doorplate_rows()
    assert len(rows) == 73
    yihua_68 = [r for r in rows if r.street == "義華路" and r.number == 68]
    assert len(yihua_68) == 1  # 原檔 68 號另有 4 列樓層
    row = yihua_68[0]
    assert (row.town_code, row.district, row.village, row.lane, row.alley, row.number_sub) == (
        "6400500", "三民區", "本揚里", "", "", 0,
    )
    assert row.lat == pytest.approx(22.6424556, abs=1e-6) and row.lng == pytest.approx(120.3437133, abs=1e-6)


def test_fullwidth_lanes_named_lanes_areas_and_village_fix():
    rows = sample_doorplate_rows()
    assert {(r.lane, r.alley) for r in rows if r.street == "旗津三路"} >= {("900", ""), ("900", "3")}
    assert {r.lane for r in rows if r.street == "仁心路"} == {"博愛"}
    area = [r for r in rows if r.street == "右昌一巷"]
    assert area and {r.street_kind for r in area} == {"area"}
    assert {r.street_kind for r in rows if r.street == "義華路"} == {"road"}
    assert "北美術館里" in {r.village for r in rows}


@pytest.mark.parametrize(
    ("number_text", "expected"),
    [
        ("１１０號", (110, 0)),
        ("１１４之４號", (114, 4)),
        ("５２號之５", (52, 5)),  # 之號寫在號後面
        ("１２８號十樓之１", (128, 0)),  # 樓層的之不算
        ("４之３之１號", (4, 3)),
        ("臨２９號", (29, 0)),
        ("２５號四樓之３附１", (25, 0)),
    ],
)
def test_number_forms(number_text, expected):
    rows, _ = _feed(f"64,6400100,中原里,001,七賢三路,,,,{number_text},176205.163,2503011.609")
    assert [(r.number, r.number_sub) for r in rows] == [expected]


@pytest.mark.parametrize("number_text", ["７４附２號", "特８號", "一棟二樓1號", "之24號"])
def test_irregular_numbers_are_skipped(number_text):
    rows, parser = _feed(f"64,6400200,光化里,002,鼓山二路,,,,{number_text},176260.29,2503752.934")
    assert rows == [] and parser.skipped == 1


def test_unknown_town_and_broken_coordinates_are_skipped():
    rows, parser = _feed(
        "65,6500100,某里,001,某路,,,,１號,176205.163,2503011.609",
        "64,6400100,中原里,001,七賢三路,,,,１號,,",
    )
    assert rows == [] and parser.skipped == 2


@pytest.mark.parametrize("header", [HEADER, BOM + HEADER, HEADER + "\r\n"])
def test_header_with_or_without_bom(header):
    parser = DoorplateParser()
    assert parser.feed(header) is None
    assert parser.feed("64,6400100,中原里,001,七賢三路,,,,１號,176205.163,2503011.609") is not None


def test_changed_header_is_rejected():
    with pytest.raises(DoorplateFormatError):
        DoorplateParser().feed("省市縣市代碼,鄉鎮市區代碼,村里\n")


async def _rows(items):
    for item in items:
        yield item


async def _count(app, tag: str | None = None) -> int:
    async with app.state.session_factory() as db:
        stmt = select(func.count()).select_from(GeoDoorplate)
        if tag is not None:
            stmt = stmt.where(GeoDoorplate.dataset_version == tag)
        return await db.scalar(stmt)


async def test_import_then_activate_replaces_previous_batch(app):
    rows = sample_doorplate_rows()
    factory = app.state.session_factory
    now = datetime.now(timezone.utc)
    assert await import_doorplates(factory, "115-09#old000", _rows(rows[:10]), batch_size=4) == 10
    await activate_doorplates(factory, "115-09#old000", "115-09", now=now)
    assert await import_doorplates(factory, "115-10#new000", _rows(rows), batch_size=50) == 73
    assert await _count(app, "115-09#old000") == 10  # 切換前舊批次照常可查

    await activate_doorplates(factory, "115-10#new000", "115-10", now=now)
    assert await _count(app) == 73 == await _count(app, "115-10#new000")
    async with factory() as db:
        status = await db.get(GeoDatasetStatus, "doorplates")
    assert (status.active_version, status.label, status.last_error) == ("115-10#new000", "115-10", None)


async def test_failed_import_leaves_active_batch_alone(app):
    rows = sample_doorplate_rows()
    factory = app.state.session_factory
    await import_doorplates(factory, "115-10#good00", _rows(rows))
    await activate_doorplates(factory, "115-10#good00", "115-10", now=datetime.now(timezone.utc))

    async def broken():
        for row in rows[:7]:
            yield row
        raise ConnectionError("下載中斷")

    with pytest.raises(ConnectionError):
        await import_doorplates(factory, "115-11#bad000", broken(), batch_size=3)
    assert await _count(app, "115-11#bad000") == 0
    assert await _count(app) == 73
    async with factory() as db:
        assert (await db.get(GeoDatasetStatus, "doorplates")).active_version == "115-10#good00"


def test_fixture_keeps_original_file_format():
    raw = (FIXTURES / "doorplates-sample.csv").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw
```

建立 `backend/tests/test_geo_kindergartens.py`：

```python
"""幼兒園公開資料的解析、整批換新與半徑查詢（2026-10-08 規格 §4、§5.2）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.kindergartens import KindergartenFormatError, nearby, parse_preschools, replace_kindergartens
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten
from tests.geo_helpers import SAMPLE_TAG, YIHUA_POINT, load_geo_samples, sample_preschools


def _by_name(rows):
    return {row.name: row for row in rows}


def test_only_active_kaohsiung_kindergartens_are_kept():
    rows = parse_preschools(sample_preschools(), school_year=115)
    names = {row.name for row in rows}
    assert len(rows) == 10
    assert "臺南市私立耶魯幼兒園" not in names  # 非高雄市
    assert "高雄市私立小太陽哈佛幼兒園" not in names  # is_active 0
    assert "高雄市英明非營利幼兒園" not in names  # is_active 0


def test_inactive_as_string_and_other_city_are_dropped():
    data = {"type": "FeatureCollection", "features": [
        {"properties": {"id": "a", "title": "甲", "city": "高雄市", "type": "公立", "is_active": "0"},
         "geometry": {"coordinates": [120.3, 22.6]}},
        {"properties": {"id": "b", "title": "乙", "city": "臺南市", "type": "公立", "is_active": 1},
         "geometry": {"coordinates": [120.2, 22.9]}},
        {"properties": {"id": "c", "title": "丙", "city": "高雄市", "type": "公立", "is_active": "1"},
         "geometry": {"coordinates": [120.3, 22.6]}},
    ]}
    assert [row.name for row in parse_preschools(data, school_year=115)] == ["丙"]


def test_kinds_and_quasi_public_period():
    rows = _by_name(parse_preschools(sample_preschools(), school_year=115))
    assert rows["高雄市私立保羅幼兒園"].kind == "quasi_public"  # pre_public 113-115
    assert rows["高雄市私立保羅幼兒園"].pre_public_period == "113-115"
    assert rows["高雄市私立常春藤幼兒園"].kind == "private"
    assert rows["高雄市私立常春藤幼兒園"].pre_public_period is None  # 「無」當成沒有
    assert rows["高雄市灣內非營利幼兒園"].kind == "nonprofit"
    assert rows["高雄市三民區東光國民小學附設幼兒園"].kind == "public"
    later = _by_name(parse_preschools(sample_preschools(), school_year=116))
    assert later["高雄市私立保羅幼兒園"].kind == "private"  # 準公共期間已過


def test_fields_are_cleaned():
    rows = _by_name(parse_preschools(sample_preschools(), school_year=115))
    wannei = rows["高雄市灣內非營利幼兒園"]  # 原始座標是字串
    assert (wannei.lat, wannei.lng) == (22.687159, 120.347932)
    ivy = rows["高雄市私立常春藤幼兒園"]
    assert (ivy.address, ivy.district) == ("義華路68號", "三民區")  # 去掉郵遞區號
    assert (ivy.approved_capacity, ivy.has_penalty) == (210, True)
    assert not hasattr(ivy, "owner")


def test_capacity_and_monthly_parsing():
    data = {"type": "FeatureCollection", "features": [
        {"properties": {"id": "x", "title": "測試", "city": "高雄市", "town": "三民區", "type": "私立",
                        "address": "[807]某路1號", "count_approved": "1,200", "monthly": "", "pre_public": "無",
                        "penalty": "無", "tel": "", "is_active": 1},
         "geometry": {"coordinates": [120.3, 22.6]}},
    ]}
    (row,) = parse_preschools(data, school_year=115)
    assert (row.approved_capacity, row.monthly_fee_estimate, row.phone, row.address) == (1200, None, None, "某路1號")


@pytest.mark.parametrize(
    "data",
    [{}, {"features": "x"}, {"type": "FeatureCollection", "features": [
        {"properties": {"id": "t", "title": "臺南", "city": "臺南市", "type": "公立", "is_active": 1},
         "geometry": {"coordinates": [120.2, 22.9]}}]}],
)
def test_unexpected_shape_is_rejected(data):
    with pytest.raises(KindergartenFormatError):
        parse_preschools(data, school_year=115)


async def test_replace_and_nearby(db_session):
    rows = parse_preschools(sample_preschools(), school_year=115)
    now = datetime.now(timezone.utc)
    assert await replace_kindergartens(db_session, rows, synced_at=now) == 10
    await db_session.commit()

    within_1km = await nearby(db_session, *YIHUA_POINT, 1000)
    assert [(item.name, item.distance_m) for item in within_1km] == [
        ("高雄市私立常春藤幼兒園", 12),
        ("高雄市私立何嘉仁幼兒園", 300),
        ("高雄市私立保羅幼兒園", 513),
        ("高雄市私立義華幼兒園", 581),
        ("高雄市私立愛爾蘭幼兒園", 607),
        ("高雄市私立新美倫幼兒園", 614),
        ("高雄市三民區東光國民小學附設幼兒園", 786),
    ]
    within_3km = await nearby(db_session, *YIHUA_POINT, 3000)
    assert [item.name for item in within_3km][-1] == "高雄市光武非營利幼兒園(委託高雄市教保人員職業工會辦理)"

    status = await db_session.get(GeoDatasetStatus, "kindergartens")
    assert status.synced_at == now and status.label == now.date().isoformat()

    await replace_kindergartens(db_session, rows[:2], synced_at=now)
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 2


async def test_load_geo_samples_is_repeatable(db_session):
    await load_geo_samples(db_session)
    await load_geo_samples(db_session)
    assert await db_session.scalar(select(func.count()).select_from(GeoDoorplate)) == 73
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 10
    statuses = {s.dataset: s for s in (await db_session.execute(select(GeoDatasetStatus))).scalars()}
    assert set(statuses) == {"doorplates", "kindergartens"}
    assert statuses["doorplates"].active_version == SAMPLE_TAG
    assert all(s.synced_at is not None for s in statuses.values())
```

- [ ] **Step 3：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_doorplates.py tests/test_geo_kindergartens.py`
Expected：collection error，`No module named 'app.admissions.geo.doorplates'`（geo_helpers import 時就失敗）。

- [ ] **Step 4：實作門牌** — 建立 `backend/app/admissions/geo/doorplates.py`：

```python
"""高雄市門牌坐標資料（TWD97）的逐列解析與分批匯入（規格 §4、§7）。

CSV 約 102MB、129 萬列，一律串流：解析器一次吃一行；匯入每 5,000 列一個交易、用
COPY 寫進去，不整檔讀進記憶體，也不讓交易在下載時閒置（執行期連線有
idle_in_transaction 逾時）。全部匯完才由 activate_doorplates 切換使用中的批次；
任何一步失敗都只會留下沒人查的批次，下次同步開頭清掉。

「號」含樓層的列（「１２８號十樓之１」）去掉樓層後和同號重複、而且前後相鄰，用前一列
的鍵去重。「附」號（「７４附２號」）、「特８號」「一棟二樓1號」這類不是一般門牌的寫法
（全市約 800 列）直接略過。執行期資料庫角色只有 DML 權限（deploy/README.md），所以
清批次用 DELETE、不用 TRUNCATE。"""

from __future__ import annotations

import csv
import re
import unicodedata
from collections.abc import AsyncIterable
from dataclasses import astuple, dataclass
from datetime import datetime

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo.address import normalize_text, unit_token
from app.admissions.geo.kaohsiung import TOWN_CODES, fix_village_name
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.admissions.geo.projection import twd97_tm2_to_wgs84
from app.common.csv_export import BOM

EXPECTED_HEADER = ["省市縣市代碼", "鄉鎮市區代碼", "村里", "鄰", "街路段", "地區", "巷", "弄", "號", "橫座標", "縱座標"]
DOORPLATE_COLUMNS = (
    "town_code", "district", "village", "street", "street_kind", "lane", "alley",
    "number", "number_sub", "lat", "lng",
)
COPY_BATCH_SIZE = 5000
# 「號」：主號、之號；門牌表也有把之號寫在號後面的（「５２號之５」），但「號」後面接樓層
# 的「之」（「十樓之１」）不算。
_NUMBER = re.compile(r"臨?(\d+)(?:之(\d+))?(?:之\d+)*號(?:之(\d+)(?![樓\d]))?")


class DoorplateFormatError(ValueError):
    """CSV 欄位和預期不同（平台改版）。訊息不含任何資料內容。"""


@dataclass(frozen=True)
class DoorplateRow:
    town_code: str
    district: str
    village: str
    street: str
    street_kind: str
    lane: str
    alley: str
    number: int
    number_sub: int
    lat: float
    lng: float


def _unit(value: str, suffix: str) -> str:
    normalized = normalize_text(value)
    return unit_token(normalized.removesuffix(suffix)) if normalized else ""


class DoorplateParser:
    """一次餵一行（行尾換行可有可無）。第一個非空行必須是表頭；回傳 None＝這行略過。"""

    def __init__(self) -> None:
        self._header_checked = False
        self._previous: tuple | None = None
        self.parsed = 0
        self.skipped = 0

    def feed(self, line: str) -> DoorplateRow | None:
        line = line.rstrip("\r\n")
        if not line:
            return None
        fields = next(csv.reader([line]))
        if not self._header_checked:
            if fields and fields[0].startswith(BOM):
                fields[0] = fields[0][1:]
            if fields != EXPECTED_HEADER:
                raise DoorplateFormatError("門牌資料的欄位和預期不同")
            self._header_checked = True
            return None
        row = self._row(fields)
        if row is None:
            self.skipped += 1
            return None
        key = astuple(row)[:9]
        if key == self._previous:
            return None
        self._previous = key
        self.parsed += 1
        return row

    @staticmethod
    def _row(fields: list[str]) -> DoorplateRow | None:
        if len(fields) != len(EXPECTED_HEADER):
            return None
        _, town_code, village, _, road, area, lane, alley, number_text, x, y = fields
        district = TOWN_CODES.get(town_code)
        matched = _NUMBER.match(unicodedata.normalize("NFKC", number_text))
        street = normalize_text(road or area)
        if district is None or matched is None or not street or not village.strip():
            return None
        try:
            lat, lng = twd97_tm2_to_wgs84(float(x), float(y))
        except ValueError:
            return None
        return DoorplateRow(
            town_code=town_code,
            district=district,
            village=fix_village_name(village),
            street=street,
            street_kind="road" if road else "area",
            lane=_unit(lane, "巷"),
            alley=_unit(alley, "弄"),
            number=int(matched.group(1)),
            number_sub=int(matched.group(2) or matched.group(3) or 0),
            lat=round(lat, 7),
            lng=round(lng, 7),
        )


async def copy_doorplates(db: AsyncSession, tag: str, rows: list[DoorplateRow]) -> None:
    """把一批門牌以 COPY 寫進 tag 批次（不 commit）。走 asyncpg 原生連線。"""
    if not rows:
        return
    connection = await db.connection()
    raw = await connection.get_raw_connection()
    await raw.driver_connection.copy_records_to_table(
        GeoDoorplate.__tablename__,
        records=[(tag, *astuple(row)) for row in rows],
        columns=("dataset_version", *DOORPLATE_COLUMNS),
    )


async def delete_batches(db: AsyncSession, *, keep: str | None) -> None:
    """刪掉 keep 以外的所有批次（不 commit）。一個舊批次約 76 萬列，放寬語句逾時。"""
    await db.execute(text("SET LOCAL statement_timeout = 0"))
    stmt = delete(GeoDoorplate)
    if keep is not None:
        stmt = stmt.where(GeoDoorplate.dataset_version != keep)
    await db.execute(stmt)


async def import_doorplates(
    session_factory: async_sessionmaker[AsyncSession],
    tag: str,
    rows: AsyncIterable[DoorplateRow],
    *,
    batch_size: int = COPY_BATCH_SIZE,
) -> int:
    """把 rows 全部寫進 tag 批次，回傳列數。每批一個交易；失敗時刪掉這個批次再往上丟。"""
    count = 0
    batch: list[DoorplateRow] = []
    try:
        async for row in rows:
            batch.append(row)
            if len(batch) >= batch_size:
                async with session_factory() as db:
                    await copy_doorplates(db, tag, batch)
                    await db.commit()
                count += len(batch)
                batch = []
        if batch:
            async with session_factory() as db:
                await copy_doorplates(db, tag, batch)
                await db.commit()
            count += len(batch)
    except Exception:
        async with session_factory() as db:
            await db.execute(text("SET LOCAL statement_timeout = 0"))
            await db.execute(delete(GeoDoorplate).where(GeoDoorplate.dataset_version == tag))
            await db.commit()
        raise
    return count


async def activate_doorplates(
    session_factory: async_sessionmaker[AsyncSession], tag: str, label: str, *, now: datetime
) -> None:
    """切換使用中的批次，再刪掉其他批次。切換和刪除分兩個交易：刪除失敗（例如逾時）也
    不影響已經切過去的查詢，剩下的舊批次下次同步開頭再清。"""
    async with session_factory() as db:
        status = await db.get(GeoDatasetStatus, "doorplates", with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset="doorplates")
            db.add(status)
        status.active_version = tag
        status.label = label
        status.synced_at = now
        status.checked_at = now
        status.last_error = None
        await db.commit()
    async with session_factory() as db:
        await delete_batches(db, keep=tag)
        await db.commit()
```

- [ ] **Step 5：實作幼兒園** — 建立 `backend/app/admissions/geo/kindergartens.py`：

```python
"""幼兒園公開資料：kiang 整理的全國教保資訊網 preschools.json（規格 §4、§5.2）。

只留高雄市、營業中（is_active＝1）的園所；不存負責人姓名（owner），也不讀
punish_all.json（以行為人姓名為鍵）。類型對照：公立→public、非營利→nonprofit、
私立且 pre_public 學年區間涵蓋目前學年→quasi_public、其餘私立→private。月費是
kiang 依收費明細估算的值，畫面上要標「估」。kiang 的資料有一筆座標是字串，一律轉 float。"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten
from app.admissions.geo.projection import haversine_m

SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），月費為估計值"
_KIND_BY_TYPE = {"公立": "public", "非營利": "nonprofit", "私立": "private"}
_PRE_PUBLIC = re.compile(r"(\d{3})-(\d{3})")
_POSTAL_PREFIX = re.compile(r"^\[\d+\]")
_METERS_PER_DEGREE = 111_320.0


class KindergartenFormatError(ValueError):
    """preschools.json 不是預期的格式（或一所高雄市營業中的園所都沒有）。"""


@dataclass(frozen=True)
class KindergartenRow:
    source_id: str
    reg_no: str | None
    name: str
    kind: str
    pre_public_period: str | None
    district: str
    address: str
    lat: float
    lng: float
    approved_capacity: int | None
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None


@dataclass(frozen=True)
class NearbyKindergarten:
    source_id: str
    name: str
    kind: str
    pre_public_period: str | None
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    digits = re.sub(r"[^\d]", "", str(value or ""))
    return int(digits) if digits else None


def _text_or_none(value: object) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _kind(type_name: str, pre_public: str | None, school_year: int) -> str | None:
    kind = _KIND_BY_TYPE.get(type_name)
    if kind == "private" and pre_public:
        matched = _PRE_PUBLIC.fullmatch(pre_public)
        if matched and int(matched.group(1)) <= school_year <= int(matched.group(2)):
            return "quasi_public"
    return kind


def parse_preschools(data: dict, *, school_year: int) -> list[KindergartenRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise KindergartenFormatError("幼兒園資料不是 GeoJSON FeatureCollection")
    rows: list[KindergartenRow] = []
    for feature in features:
        props = feature.get("properties") or {}
        if str(props.get("city") or "").replace("臺", "台") != "高雄市" or str(props.get("is_active")) != "1":
            continue
        try:
            lng, lat = (float(value) for value in feature["geometry"]["coordinates"][:2])
        except (KeyError, TypeError, ValueError):
            continue
        pre_public = _text_or_none(props.get("pre_public"))
        pre_public = None if pre_public == "無" else pre_public
        kind = _kind(str(props.get("type") or ""), pre_public, school_year)
        source_id = _text_or_none(props.get("id"))
        name = _text_or_none(props.get("title"))
        if kind is None or source_id is None or name is None:
            continue
        rows.append(
            KindergartenRow(
                source_id=source_id,
                reg_no=_text_or_none(props.get("reg_no")),
                name=name,
                kind=kind,
                pre_public_period=pre_public,
                district=str(props.get("town") or "").strip(),
                address=_POSTAL_PREFIX.sub("", str(props.get("address") or "").strip()),
                lat=lat,
                lng=lng,
                approved_capacity=_int_or_none(props.get("count_approved")),
                monthly_fee_estimate=_int_or_none(props.get("monthly")),
                has_penalty=str(props.get("penalty") or "") == "有",
                phone=_text_or_none(props.get("tel")),
            )
        )
    if not rows:
        raise KindergartenFormatError("幼兒園資料裡沒有高雄市營業中的園所")
    return rows


async def replace_kindergartens(db: AsyncSession, rows: list[KindergartenRow], *, synced_at: datetime) -> int:
    """整批換新並更新狀態列（不 commit）。約 700 筆，一個交易做完。"""
    await db.execute(delete(GeoKindergarten))
    await db.execute(
        insert(GeoKindergarten),
        [{**asdict(row), "is_active": True, "synced_at": synced_at} for row in rows],
    )
    status = await db.get(GeoDatasetStatus, "kindergartens", with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset="kindergartens")
        db.add(status)
    status.active_version = synced_at.date().isoformat()
    status.label = synced_at.date().isoformat()
    status.synced_at = synced_at
    status.checked_at = synced_at
    status.last_error = None
    return len(rows)


async def nearby(db: AsyncSession, lat: float, lng: float, radius_m: int) -> list[NearbyKindergarten]:
    """半徑 radius_m 內的營業中園所，依距離（公尺，四捨五入）、名稱排序。先用經緯度
    方框篩，再算大圓距離。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.lat.between(lat - dlat, lat + dlat),
            GeoKindergarten.lng.between(lng - dlng, lng + dlng),
        )
    )
    items: list[NearbyKindergarten] = []
    for row in result.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        items.append(
            NearbyKindergarten(
                source_id=row.source_id,
                name=row.name,
                kind=row.kind,
                pre_public_period=row.pre_public_period,
                address=row.address,
                lat=row.lat,
                lng=row.lng,
                distance_m=round(distance),
                approved_capacity=row.approved_capacity,
                monthly_fee_estimate=row.monthly_fee_estimate,
                has_penalty=row.has_penalty,
                phone=row.phone,
            )
        )
    items.sort(key=lambda item: (item.distance_m, item.name))
    return items
```

- [ ] **Step 6：跑測試確認通過**

Run：`uv run pytest -q tests/test_geo_doorplates.py tests/test_geo_kindergartens.py tests/test_geo_schema.py`
Expected：35 passed（21＋10＋4）。`sample_doorplate_rows()` 是 73 列（樣本 114 列，樓層去重後）。

- [ ] **Step 7：Commit**

```bash
git add backend/app/admissions/geo/doorplates.py backend/app/admissions/geo/kindergartens.py \
  backend/tests/fixtures/geo backend/tests/geo_helpers.py backend/tests/test_geo_doorplates.py backend/tests/test_geo_kindergartens.py
git commit -m "feat(admissions): 區域分析的門牌與幼兒園公開資料匯入

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A5：地址比對、校區座標、寫入訪視、重算

**Files:**
- Create: `backend/app/admissions/geo/matcher.py`
- Test: `backend/tests/test_geo_matcher.py`

**Interfaces:**
- Consumes：A1 `parse_address`、`CODE_OF_DISTRICT`；A2 `haversine_m`；A3 models；`app.admissions.models.RecruitmentVisit`；`app.campuses.models.CAMPUS_KEYS`；`app.content.service.published_payload(db, "campus_profile", campus_key)`（已發布的校區資料，`address` 欄；沒發布回 None）。
- Produces（B 階段用）：`NEARBY_MAX_GAP = 30`、`GeoMatch`、`CampusPoint`、`active_doorplate_version(db) -> str | None`、`doorplate_label(db) -> str | None`、`locate(db, address, *, version) -> GeoMatch`、`campus_point(db, campus_key) -> CampusPoint`、`campus_points(db) -> dict[str, CampusPoint]`、`distance_to(match, point) -> int | None`、`apply_visit_geo(db, visit) -> None`（visit 要已 flush；不 commit、不碰 version／updated_at；已匿名化的不動）、`rematch_visits(db, *, batch_size=500) -> int`（每批 commit）。

- [ ] **Step 1：寫失敗測試** — 建立 `backend/tests/test_geo_matcher.py`：

```python
"""訪視地址比對（2026-10-08 規格 §6）：五個等級、校區座標、寫入訪視、重算。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions.geo import matcher
from app.admissions.geo.matcher import (
    CampusPoint,
    GeoMatch,
    active_doorplate_version,
    apply_visit_geo,
    campus_point,
    campus_points,
    distance_to,
    locate,
    rematch_visits,
)
from app.admissions.geo.models import GeoDatasetStatus, RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from tests.geo_helpers import SAMPLE_ADDRESSES, SAMPLE_TAG, YIHUA_POINT, add_visit, load_geo_samples, publish_campus_address

LOCATE_CASES = [
    # (地址, 區, 里, 等級, 未定位原因)
    ("高雄市三民區義華路68號", "三民區", "本揚里", "exact", None),
    ("高雄市三民區義華路68之1號", "三民區", "本揚里", "exact", None),  # 之號對不到退回之 0
    ("高雄縣仁武鄉京吉一路102號", "仁武區", "八卦里", "exact", None),
    ("高雄市旗津區旗津三路900巷3弄1號", "旗津區", "復興里", "exact", None),
    ("高雄市仁武區仁心路博愛巷1弄2之1號", "仁武區", "考潭里", "exact", None),
    ("高雄市楠梓區右昌一巷12號", "楠梓區", "福昌里", "exact", None),
    ("高雄市鼓山區中華一路102號", "鼓山區", "北美術館里", "exact", None),
    ("高雄市三民區義華路74號", "三民區", "本揚里", "nearby", None),
    ("高雄市仁武區京吉一路104號", "仁武區", "八卦里", "nearby", None),
    ("高雄市三民區義華路200號", "三民區", "本揚里", "street", None),  # 差超過 30 號
    ("高雄市三民區憲政路", "三民區", "博惠里", "street", None),
    ("高雄市三民區九如一路1號", "三民區", None, "district", None),
    ("高雄市旗津區旗津三路900巷1號", "旗津區", None, "district", "ambiguous_village"),
    ("臺南市東區中華東路二段185巷14號", None, None, "unlocated", "outside_kaohsiung"),
    ("義華路68號", None, None, "unlocated", "no_doorplate"),
    ("", None, None, "unlocated", "no_address"),
    (None, None, None, "unlocated", "no_address"),
]


@pytest.mark.parametrize(("address", "district", "village", "level", "reason"), LOCATE_CASES)
async def test_locate_levels(db_session, address, district, village, level, reason):
    await load_geo_samples(db_session)
    match = await locate(db_session, address, version=await active_doorplate_version(db_session))
    assert (match.district, match.village, match.match_level, match.unlocated_reason) == (district, village, level, reason)
    has_point = level in ("exact", "nearby")
    assert (match.lat is not None, match.lng is not None) == (has_point, has_point)


async def test_sample_addresses_for_later_stages(db_session):
    await load_geo_samples(db_session)
    version = await active_doorplate_version(db_session)
    levels = {key: (await locate(db_session, value, version=version)).match_level for key, value in SAMPLE_ADDRESSES.items()}
    assert levels == {
        "yihua_exact": "exact", "yihua_nearby": "nearby", "district_only": "district",
        "outside": "unlocated", "ambiguous": "district",
    }


async def test_pending_before_doorplates_are_imported(db_session):
    assert await active_doorplate_version(db_session) is None
    match = await locate(db_session, "高雄市三民區義華路68號", version=None)
    assert match == GeoMatch("三民區", None, "pending", None, None, None)
    outside = await locate(db_session, "臺南市東區中華東路二段185巷14號", version=None)
    assert outside.unlocated_reason == "outside_kaohsiung"


async def test_campus_point(db_session):
    assert (await campus_point(db_session, "yihua")).locate_error == "no_address"
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    assert (await campus_point(db_session, "yihua")).locate_error == "pending"

    await load_geo_samples(db_session)
    point = await campus_point(db_session, "yihua")
    assert point.locate_error is None
    assert (point.lat, point.lng) == pytest.approx(YIHUA_POINT, abs=1e-6)

    await publish_campus_address(db_session, "renwu", "高雄市仁武區不存在路1號")
    points = await campus_points(db_session)
    assert set(points) == {"yihua", "minghua", "chongde", "international", "renwu"}
    assert points["renwu"].locate_error == "no_doorplate"


def test_distance_rounds_to_100m():
    point = CampusPoint("yihua", *YIHUA_POINT, None)
    renwu = GeoMatch("仁武區", "八卦里", "exact", None, 22.68262, 120.3419108)
    assert distance_to(renwu, point) == 4500
    assert distance_to(GeoMatch("三民區", "本揚里", "street", None, None, None), point) is None
    assert distance_to(renwu, CampusPoint("yihua", None, None, "pending")) is None


async def _geo(db, visit_id) -> RecruitmentVisitGeo:
    return (await db.execute(select(RecruitmentVisitGeo).where(RecruitmentVisitGeo.visit_id == visit_id))).scalar_one()


async def test_apply_visit_geo_writes_result_without_touching_version(db_session):
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    visit = await add_visit(db_session, address="高雄縣仁武鄉京吉一路102號")
    await apply_visit_geo(db_session, visit)
    await db_session.commit()

    geo = await _geo(db_session, visit.id)
    assert visit.district == "仁武區" and visit.version == 1
    assert (geo.village, geo.match_level, geo.unlocated_reason, geo.distance_m, geo.doorplate_version) == (
        "八卦里", "exact", None, 4500, "115-10",
    )


@pytest.mark.parametrize(
    ("new_address", "reason"), [("  ", "no_address"), ("臺南市東區中華東路二段185巷14號", "outside_kaohsiung")]
)
async def test_changed_address_clears_old_result(db_session, new_address, reason):
    """Review Focus 2：地址改成空白或外縣市，舊的區、里、距離都不殘留。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    await apply_visit_geo(db_session, visit)
    await db_session.commit()

    visit.address = new_address
    await apply_visit_geo(db_session, visit)
    await db_session.commit()
    geo = await _geo(db_session, visit.id)
    assert visit.district is None
    assert (geo.village, geo.match_level, geo.unlocated_reason, geo.distance_m) == (None, "unlocated", reason, None)


async def test_anonymized_visit_is_left_alone(db_session):
    await load_geo_samples(db_session)
    visit = await add_visit(db_session, address=None, anonymized=True)
    await apply_visit_geo(db_session, visit)
    await db_session.commit()
    assert (await db_session.execute(select(RecruitmentVisitGeo))).first() is None


async def test_rematch_keeps_version_and_updated_at(db_session):
    """Review Focus 5：重算只寫比對結果與 district，不加 version、不改 updated_at。"""
    await load_geo_samples(db_session)
    visit_id = (await add_visit(db_session, address="高雄市三民區義華路74號")).id
    anonymized_id = (await add_visit(db_session, address=None, anonymized=True)).id
    stamp = datetime.now(timezone.utc) - timedelta(days=3)
    await db_session.execute(update(RecruitmentVisit).values(updated_at=stamp, version=4))
    await db_session.commit()

    assert await rematch_visits(db_session, batch_size=1) == 1  # 匿名化的不算

    db_session.expire_all()
    refreshed = await db_session.get(RecruitmentVisit, visit_id)
    assert (refreshed.version, refreshed.updated_at, refreshed.district) == (4, stamp, "三民區")
    assert (await _geo(db_session, visit_id)).match_level == "nearby"
    geo_of_anonymized = select(RecruitmentVisitGeo).where(RecruitmentVisitGeo.visit_id == anonymized_id)
    assert (await db_session.execute(geo_of_anonymized)).first() is None


async def test_rematch_does_not_overwrite_a_concurrent_address_edit(db_session, app, monkeypatch):
    await load_geo_samples(db_session)
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    await db_session.commit()
    original_locate = matcher.locate

    async def locate_while_user_edits(db, address, *, version):
        async with app.state.session_factory() as other:
            await other.execute(
                update(RecruitmentVisit).where(RecruitmentVisit.id == visit.id).values(address="高雄市仁武區京吉一路102號")
            )
            await other.commit()
        return await original_locate(db, address, version=version)

    monkeypatch.setattr(matcher, "locate", locate_while_user_edits)
    await rematch_visits(db_session)
    assert (await db_session.execute(select(RecruitmentVisitGeo))).first() is None


async def test_status_row_is_what_marks_the_active_batch(db_session):
    await load_geo_samples(db_session)
    status = await db_session.get(GeoDatasetStatus, "doorplates")
    assert status.active_version == SAMPLE_TAG == await active_doorplate_version(db_session)
```

- [ ] **Step 2：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_matcher.py`
Expected：`No module named 'app.admissions.geo.matcher'`。

- [ ] **Step 3：實作** — 建立 `backend/app/admissions/geo/matcher.py`：

```python
"""訪視地址 → 行政區＋里＋到本校直線距離（docs/specs/2026-10-08-admissions-area-design.md §6）。
只查官網自己的資料庫，家長地址不送任何外部服務。

比對等級依序：
- exact：門牌完全對到（之號對不到時退回同號之 0）；
- nearby：同街路段、同巷弄，號碼最近（差距 NEARBY_MAX_GAP 號以內，同單雙號優先）；
- street：巷弄、巷、整條街路段，由窄到寬其中一層的門牌全在同一個里（沒有座標）；
- district：只知道區；
- unlocated：沒有地址、外縣市、解析不出高雄市的區。
精確門牌對到兩個里時不硬選：district＋ambiguous_village。里一律以門牌表為準，
不採信地址裡寫的里。門牌表還沒匯入時是 pending（區照樣從地址解析）。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import distinct, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.address import parse_address
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, RecruitmentVisitGeo
from app.admissions.geo.projection import haversine_m
from app.admissions.models import RecruitmentVisit
from app.campuses.models import CAMPUS_KEYS
from app.content import service as content_service

NEARBY_MAX_GAP = 30


@dataclass(frozen=True)
class GeoMatch:
    district: str | None
    village: str | None
    match_level: str
    unlocated_reason: str | None
    lat: float | None
    lng: float | None


@dataclass(frozen=True)
class CampusPoint:
    campus_key: str
    lat: float | None
    lng: float | None
    locate_error: str | None  # "no_address" | "no_doorplate" | "pending"；有座標時 None


def _unlocated(reason: str) -> GeoMatch:
    return GeoMatch(None, None, "unlocated", reason, None, None)


async def active_doorplate_version(db: AsyncSession) -> str | None:
    """使用中的門牌批次標記（「115-10#a1b2c3」）；還沒匯入過回 None。"""
    return await db.scalar(
        select(GeoDatasetStatus.active_version).where(GeoDatasetStatus.dataset == "doorplates")
    )


async def doorplate_label(db: AsyncSession) -> str | None:
    """畫面上顯示的門牌資料月份（「115-10」）；還沒匯入過回 None。"""
    return await db.scalar(select(GeoDatasetStatus.label).where(GeoDatasetStatus.dataset == "doorplates"))


async def locate(db: AsyncSession, address: str | None, *, version: str | None) -> GeoMatch:
    parsed = parse_address(address)
    if parsed is None:
        return _unlocated("no_address")
    if parsed.outside_kaohsiung:
        return _unlocated("outside_kaohsiung")
    if parsed.district is None:
        return _unlocated("no_doorplate")
    district = parsed.district
    if version is None:
        return GeoMatch(district, None, "pending", None, None, None)
    if parsed.street:
        base = (
            GeoDoorplate.dataset_version == version,
            GeoDoorplate.town_code == CODE_OF_DISTRICT[district],
            GeoDoorplate.street == parsed.street,
        )
        same_unit = (GeoDoorplate.lane == (parsed.lane or ""), GeoDoorplate.alley == (parsed.alley or ""))
        if parsed.number is not None:
            picked = await _exact_rows(db, base, same_unit, parsed.number, parsed.number_sub)
            villages = {row.village for row in picked}
            if len(villages) == 1:
                return GeoMatch(district, picked[0].village, "exact", None, picked[0].lat, picked[0].lng)
            if len(villages) > 1:
                return GeoMatch(district, None, "district", "ambiguous_village", None, None)
            near = (
                await db.execute(
                    select(GeoDoorplate.village, GeoDoorplate.lat, GeoDoorplate.lng)
                    .where(*base, *same_unit, func.abs(GeoDoorplate.number - parsed.number) <= NEARBY_MAX_GAP)
                    # 同單雙號（同一側街廓）優先，再看號碼差距：里界常沿街道中線劃分。
                    .order_by(
                        func.mod(GeoDoorplate.number + parsed.number, 2),
                        func.abs(GeoDoorplate.number - parsed.number),
                        GeoDoorplate.number_sub,
                        GeoDoorplate.id,
                    )
                    .limit(1)
                )
            ).first()
            if near is not None:
                return GeoMatch(district, near.village, "nearby", None, near.lat, near.lng)
        for extra in (same_unit, same_unit[:1], ()):
            villages_found = (
                await db.execute(select(distinct(GeoDoorplate.village)).where(*base, *extra).limit(2))
            ).scalars().all()
            if len(villages_found) == 1:
                return GeoMatch(district, villages_found[0], "street", None, None, None)
            if len(villages_found) > 1:
                break
    return GeoMatch(district, None, "district", None, None, None)


async def _exact_rows(db: AsyncSession, base: tuple, same_unit: tuple, number: int, number_sub: int) -> list:
    """同號同之號的門牌；之號對不到時退回同號之 0。"""
    rows = (
        await db.execute(
            select(GeoDoorplate.village, GeoDoorplate.lat, GeoDoorplate.lng, GeoDoorplate.number_sub)
            .where(*base, *same_unit, GeoDoorplate.number == number, GeoDoorplate.number_sub.in_({number_sub, 0}))
            .order_by(GeoDoorplate.id)
        )
    ).all()
    return [row for row in rows if row.number_sub == number_sub] or [row for row in rows if row.number_sub == 0]


async def campus_point(db: AsyncSession, campus_key: str) -> CampusPoint:
    """校址取已發布的校區資料（content campus_profile 的 address），用同一套比對取座標；
    只接受 exact／nearby。"""
    profile = await content_service.published_payload(db, "campus_profile", campus_key) or {}
    address = str(profile.get("address") or "").strip()
    if not address:
        return CampusPoint(campus_key, None, None, "no_address")
    version = await active_doorplate_version(db)
    if version is None:
        return CampusPoint(campus_key, None, None, "pending")
    match = await locate(db, address, version=version)
    if match.match_level in ("exact", "nearby"):
        return CampusPoint(campus_key, match.lat, match.lng, None)
    return CampusPoint(campus_key, None, None, "no_doorplate")


async def campus_points(db: AsyncSession) -> dict[str, CampusPoint]:
    return {key: await campus_point(db, key) for key in CAMPUS_KEYS}


def distance_to(match: GeoMatch, point: CampusPoint | None) -> int | None:
    """到校區的直線距離，取整到 100 m；任一邊沒有座標回 None。"""
    if point is None or point.lat is None or point.lng is None or match.lat is None or match.lng is None:
        return None
    return int(round(haversine_m(point.lat, point.lng, match.lat, match.lng) / 100.0)) * 100


async def _upsert_geo(
    db: AsyncSession, visit_id: uuid.UUID, match: GeoMatch, distance_m: int | None, label: str | None
) -> None:
    values = {
        "village": match.village,
        "match_level": match.match_level,
        "unlocated_reason": match.unlocated_reason,
        "distance_m": distance_m,
        "doorplate_version": label,
        "matched_at": datetime.now(timezone.utc),
    }
    await db.execute(
        pg_insert(RecruitmentVisitGeo)
        .values(visit_id=visit_id, **values)
        .on_conflict_do_update(index_elements=[RecruitmentVisitGeo.visit_id], set_=values)
    )


async def apply_visit_geo(db: AsyncSession, visit: RecruitmentVisit) -> None:
    """依 visit.address 比對，upsert recruitment_visit_geo、設定 visit.district。visit 必須
    已 flush（recruitment_visits 已有這一列）。不碰 version、updated_at；不 commit。
    已匿名化的訪視不動（匿名化另外處理，階段 B）。"""
    if visit.anonymized_at is not None:
        return
    version = await active_doorplate_version(db)
    match = await locate(db, visit.address, version=version)
    point = await campus_point(db, visit.campus_key) if match.lat is not None else None
    visit.district = match.district
    await _upsert_geo(db, visit.id, match, distance_to(match, point), await doorplate_label(db))


async def rematch_visits(db: AsyncSession, *, batch_size: int = 500) -> int:
    """重算所有未匿名化訪視（門牌換版、校址變更後由同步工作呼叫）。每批 commit；回傳
    處理筆數。用 Core UPDATE 只寫 district，條件是「地址仍是剛才讀到的值」：使用者同時
    改了地址就不覆蓋（他那筆交易已經用新地址比對過）。不碰 version、updated_at。"""
    version = await active_doorplate_version(db)
    label = await doorplate_label(db)
    points = await campus_points(db)
    processed = 0
    last_id: uuid.UUID | None = None
    while True:
        stmt = (
            select(RecruitmentVisit.id, RecruitmentVisit.campus_key, RecruitmentVisit.address)
            .where(RecruitmentVisit.anonymized_at.is_(None))
            .order_by(RecruitmentVisit.id)
            .limit(batch_size)
        )
        if last_id is not None:
            stmt = stmt.where(RecruitmentVisit.id > last_id)
        rows = (await db.execute(stmt)).all()
        if not rows:
            return processed
        for row in rows:
            match = await locate(db, row.address, version=version)
            updated = await db.execute(
                update(RecruitmentVisit)
                .where(
                    RecruitmentVisit.id == row.id,
                    RecruitmentVisit.address.is_not_distinct_from(row.address),
                    RecruitmentVisit.anonymized_at.is_(None),
                )
                .values(district=match.district)
                .execution_options(synchronize_session=False)
            )
            if updated.rowcount == 1:
                await _upsert_geo(db, row.id, match, distance_to(match, points.get(row.campus_key)), label)
        await db.commit()
        processed += len(rows)
        last_id = rows[-1].id
```

- [ ] **Step 4：跑測試確認通過**

Run：`uv run pytest -q tests/test_geo_matcher.py`
Expected：28 passed。

- [ ] **Step 5：Commit**

```bash
git add backend/app/admissions/geo/matcher.py backend/tests/test_geo_matcher.py
git commit -m "feat(admissions): 區域分析的地址比對與訪視比對結果

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A6：公開資料同步

**Files:**
- Create: `backend/app/admissions/geo/sync.py`
- Modify: `backend/app/config.py`（四個 `geo_*` 設定；diff 在 A8 Step 3）
- Test: `backend/tests/test_geo_sync.py`

**Interfaces:**
- Consumes：A4 `doorplates`（模組整個 import 成 `doorplate_io`）、`parse_preschools`、`replace_kindergartens`、`KindergartenFormatError`；A5 `active_doorplate_version`、`rematch_visits`；`app.admissions.academic.current_term(today) -> (school_year, semester)`；`app.common.timezones.today_local()`；`Settings.geo_doorplate_url`、`Settings.geo_kindergartens_url`（本任務 Step 1 加進 `Settings`）。
- Produces：`KCG_BASE`、`KCG_SEARCH_URL`、`REFRESH_AFTER = timedelta(days=30)`、`MIN_DOORPLATE_ROWS = 500_000`、`USER_AGENT`、`GeoSyncError`、`DoorplateSource(label, url)`、`GeoSyncResult(doorplates, kindergartens, doorplate_version, rematched)`、`parse_dataset_search(page)`、`parse_dataset_resources(page)`、`discover_doorplate_source(client)`、`current_label()`、`label_for_file(path, given)`、`sync_doorplates(...)`、`sync_kindergartens(...)`、`campus_fingerprint(db)`、`rematch_if_changed(session_factory, *, now)`、`run_geo_sync(session_factory, settings, *, force=False, doorplates_file=None, doorplates_version=None, kindergartens_file=None, client=None) -> GeoSyncResult`。指定任一個檔案＝完全不連外、沒指定的那一種回 `"skipped"`、不檢查筆數下限；之後一律跑 `rematch_if_changed`（門牌批次或已發布校址變了才真的重算）。

- [ ] **Step 1：先加 config 四個欄位** — `sync.py` 讀 `settings.geo_doorplate_url`／`geo_kindergartens_url`，所以 A8 Step 3 的 `backend/app/config.py` diff 在這裡先套用（A8 就跳過那一步；設定的測試在 A8）。

- [ ] **Step 2：寫失敗測試** — 建立 `backend/tests/test_geo_sync.py`：

```python
"""公開地理資料同步（2026-10-08 規格 §7）。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, update

from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten, RecruitmentVisitGeo
from app.admissions.geo.sync import (
    DoorplateSource,
    GeoSyncError,
    discover_doorplate_source,
    label_for_file,
    parse_dataset_resources,
    parse_dataset_search,
    run_geo_sync,
)
from tests.geo_helpers import FIXTURES, add_visit, publish_campus_address

CSV_URL = "https://data.kcg.gov.tw/File/DirectDownload/667aae8f-d427-488b-9420-e51f28783dc3"
DATASET_115 = "https://data.kcg.gov.tw/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414"
DATASET_114 = "https://data.kcg.gov.tw/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3"
KIANG_URL = "https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json"


def _site(*, csv: bytes | None = None, csv_status: int = 200, kiang: bytes | None = None, dataset_115: str | None = None):
    """假的高雄市資料平台＋kiang；回傳 (transport, 請求過的網址清單)。"""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        if url.startswith("https://data.kcg.gov.tw/dataset?keyword="):
            return httpx.Response(200, text=(FIXTURES / "kcg-search.html").read_text(encoding="utf-8"))
        if url == DATASET_115:
            page = dataset_115 if dataset_115 is not None else (FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8")
            return httpx.Response(200, text=page)
        if url == DATASET_114:
            return httpx.Response(200, text=(FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8").replace("115&#x5E74;", "114&#x5E74;"))
        if url == CSV_URL or url == "https://example.org/doorplates.csv":
            body = csv if csv is not None else (FIXTURES / "doorplates-sample.csv").read_bytes()
            return httpx.Response(csv_status, content=body, headers={"content-type": "text/csv"})
        if url == KIANG_URL:
            body = kiang if kiang is not None else (FIXTURES / "preschools-sample.json").read_bytes()
            return httpx.Response(200, content=body, headers={"content-type": "application/json"})
        return httpx.Response(404)

    return httpx.MockTransport(handle), seen


@pytest.fixture
def small_minimum(monkeypatch):
    """樣本只有 73 個門牌；下載的筆數下限降到 1。"""
    monkeypatch.setattr(sync, "MIN_DOORPLATE_ROWS", 1)


async def _sync(app, transport, **kwargs):
    async with httpx.AsyncClient(transport=transport) as client:
        return await run_geo_sync(app.state.session_factory, kwargs.pop("settings", app.state.settings), client=client, **kwargs)


async def _counts(app) -> tuple[int, int]:
    async with app.state.session_factory() as db:
        return (
            await db.scalar(select(func.count()).select_from(GeoDoorplate)),
            await db.scalar(select(func.count()).select_from(GeoKindergarten)),
        )


async def _status(app, dataset: str) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, dataset)


def test_parse_search_page():
    found = parse_dataset_search((FIXTURES / "kcg-search.html").read_text(encoding="utf-8"))
    assert found[:2] == [(115, "/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414"), (114, "/DataSet/Detail/1e015103-320c-45e7-927b-70a3c0be87c3")]
    assert len(found) == 5  # 「高雄市區代碼」不算


def test_parse_dataset_page():
    found = parse_dataset_resources((FIXTURES / "kcg-dataset.html").read_text(encoding="utf-8"))
    assert found == [
        (115, 10, "667aae8f-d427-488b-9420-e51f28783dc3"),
        (115, 9, "222a9251-194a-478f-9ff9-c218da6cec7b"),
        (115, 8, "dce0b155-72fb-48ff-8ca0-3ed74f620a3d"),
    ]


async def test_discover_latest_month():
    transport, _ = _site()
    async with httpx.AsyncClient(transport=transport) as client:
        assert await discover_doorplate_source(client) == DoorplateSource("115-10", CSV_URL)


async def test_discover_falls_back_to_previous_year_early_in_the_year():
    transport, _ = _site(dataset_115="<html><body>尚無資料</body></html>")
    async with httpx.AsyncClient(transport=transport) as client:
        source = await discover_doorplate_source(client)
    assert source.label == "114-10"


async def test_discover_gives_up_without_resources():
    transport, _ = _site(dataset_115="<html></html>")

    def no_114(request):
        if str(request.url) == DATASET_114:
            return httpx.Response(200, text="<html></html>")
        return transport.handle_request(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(no_114)) as client:
        with pytest.raises(GeoSyncError):
            await discover_doorplate_source(client)


@pytest.mark.parametrize(
    ("name", "given", "expected"),
    [("kcg_115_10.csv", None, "115-10"), ("門牌115年9月.csv", None, "115-09"), ("x.csv", "114-12", "114-12")],
)
def test_label_for_file(tmp_path, name, given, expected):
    assert label_for_file(tmp_path / name, given) == expected


def test_label_for_file_rejects_bad_label(tmp_path):
    with pytest.raises(GeoSyncError):
        label_for_file(tmp_path / "x.csv", "2026-10")


async def test_first_sync_imports_both_and_second_is_skipped(app, small_minimum):
    transport, seen = _site()
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens, result.doorplate_version) == ("updated", "updated", "115-10")
    assert await _counts(app) == (73, 10)

    seen.clear()
    again = await _sync(app, transport)
    assert (again.doorplates, again.kindergartens, again.rematched) == ("skipped", "skipped", 0)
    assert seen == []  # 30 天內不連外


async def test_same_month_is_not_downloaded_again(app, small_minimum):
    transport, seen = _site()
    await _sync(app, transport)
    async with app.state.session_factory() as db:
        old = datetime.now(timezone.utc) - timedelta(days=31)
        await db.execute(update(GeoDatasetStatus).values(checked_at=old, synced_at=old))
        await db.commit()
    seen.clear()
    result = await _sync(app, transport)
    assert result.doorplates == "skipped"
    assert CSV_URL not in seen  # 只看了搜尋頁與資料集頁
    assert (await _status(app, "doorplates")).checked_at > old


async def test_force_reimports_into_a_new_batch(app, small_minimum):
    transport, _ = _site()
    await _sync(app, transport)
    before = (await _status(app, "doorplates")).active_version
    result = await _sync(app, transport, force=True)
    after = (await _status(app, "doorplates")).active_version
    assert result.doorplates == "updated" and before != after and after.startswith("115-10#")
    assert await _counts(app) == (73, 10)


@pytest.mark.parametrize(
    ("csv", "status", "message"),
    [
        (b"x,y\n1,2\n", 200, "門牌資料的欄位和預期不同"),
        (b"", 500, "下載失敗：HTTP 500"),
    ],
)
async def test_failed_download_keeps_active_version(app, small_minimum, csv, status, message):
    """Review Focus 3：同步中途失敗，使用中的版本照常可查，原因不含地址。"""
    good, _ = _site()
    await _sync(app, good)
    active = (await _status(app, "doorplates")).active_version

    bad, _ = _site(csv=csv, csv_status=status)
    result = await _sync(app, bad, force=True)
    assert (result.doorplates, result.doorplate_version) == ("failed", "115-10")
    status_row = await _status(app, "doorplates")
    assert status_row.active_version == active and status_row.last_error == message
    assert await _counts(app) == (73, 10)


async def test_too_few_rows_is_refused(app, small_minimum, monkeypatch):
    good, _ = _site()
    await _sync(app, good)
    monkeypatch.setattr(sync, "MIN_DOORPLATE_ROWS", 1000)
    result = await _sync(app, good, force=True)
    assert result.doorplates == "failed"
    assert (await _status(app, "doorplates")).last_error == "門牌資料只有 73 筆，少於 1000 筆，不換版"
    assert await _counts(app) == (73, 10)


async def test_broken_kindergarten_feed_does_not_block_doorplates(app, small_minimum):
    transport, _ = _site(kiang=b'{"type": "FeatureCollection", "features": []}')
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens) == ("updated", "failed")
    assert (await _status(app, "kindergartens")).last_error == "幼兒園資料裡沒有高雄市營業中的園所"


async def test_override_url(app, small_minimum):
    transport, seen = _site()
    settings = app.state.settings.model_copy(update={"geo_doorplate_url": "https://example.org/doorplates.csv"})
    result = await _sync(app, transport, settings=settings)
    assert result.doorplates == "updated"
    assert "https://example.org/doorplates.csv" in seen
    assert not any("data.kcg.gov.tw" in url for url in seen)
    assert result.doorplate_version == sync.current_label()


async def test_files_never_touch_the_network(app):
    """CLI 指定檔案：完全不連外、不檢查筆數下限；沒指定的那一種跳過。"""
    def refuse(request):
        raise AssertionError(f"不該連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
        result = await run_geo_sync(
            app.state.session_factory, app.state.settings, client=client,
            doorplates_file=FIXTURES / "doorplates-sample.csv", doorplates_version="115-10",
        )
        assert (result.doorplates, result.kindergartens, result.doorplate_version) == ("updated", "skipped", "115-10")
        result = await run_geo_sync(
            app.state.session_factory, app.state.settings, client=client,
            kindergartens_file=FIXTURES / "preschools-sample.json",
        )
        assert (result.doorplates, result.kindergartens) == ("skipped", "updated")
    assert await _counts(app) == (73, 10)


async def test_files_without_bom(app, tmp_path):
    plain = tmp_path / "doorplates.csv"
    plain.write_bytes((FIXTURES / "doorplates-sample.csv").read_bytes().removeprefix(b"\xef\xbb\xbf"))
    result = await run_geo_sync(app.state.session_factory, app.state.settings, doorplates_file=plain)
    assert result.doorplates == "updated" and result.doorplate_version == sync.current_label()
    assert (await _counts(app))[0] == 73


async def test_visits_are_rematched_when_doorplates_or_campus_address_change(app, small_minimum):
    async with app.state.session_factory() as db:
        visit_id = (await add_visit(db, address="高雄市三民區義華路74號")).id
        await db.commit()
    transport, _ = _site()
    first = await _sync(app, transport)
    assert first.rematched == 1
    async with app.state.session_factory() as db:
        geo = await db.get(RecruitmentVisitGeo, visit_id)
        assert (geo.village, geo.match_level, geo.distance_m) == ("本揚里", "nearby", None)  # 校址還沒發布

        await publish_campus_address(db, "yihua", "高雄市三民區義華路68號")
    second = await _sync(app, transport)  # 30 天內不下載，但校址變了照樣重算
    assert (second.doorplates, second.rematched) == ("skipped", 1)
    async with app.state.session_factory() as db:
        geo = await db.get(RecruitmentVisitGeo, visit_id)
        assert geo.distance_m == 0
```

- [ ] **Step 3：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_sync.py`
Expected：`No module named 'app.admissions.geo.sync'`。

- [ ] **Step 4：實作** — 建立 `backend/app/admissions/geo/sync.py`（平台頁面結構是 2026-10-08 用 curl 實際看過的；fixture 就是當天的片段）：

```python
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
頁面上的 title 是 HTML 實體編碼，先 html.unescape 再比對。"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.academic import current_term
from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo.kindergartens import KindergartenFormatError, parse_preschools, replace_kindergartens
from app.admissions.geo.matcher import active_doorplate_version, rematch_visits
from app.admissions.geo.models import GeoDatasetStatus
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
_LABEL = re.compile(r"\d{3}-\d{2}")
_LABEL_IN_FILENAME = re.compile(r"(\d{3})[-_年](\d{1,2})")
_DATASET_LINK = re.compile(r'title="高雄市(\d{3})年門牌坐標資料-TWD97"\s+href="(/DataSet/Detail/[0-9a-f-]{36})"')
_RESOURCE_LINK = re.compile(r'title="(\d{3})年(\d{1,2})月門牌坐標資料"\s+href="/Resource/([0-9a-f-]{36})"')


class GeoSyncError(RuntimeError):
    """同步失敗的原因；訊息會寫進 geo_dataset_status.last_error，不得含地址。"""


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
        if not _LABEL.fullmatch(given):
            raise GeoSyncError("門牌月份格式要像 115-10")
        return given
    matched = _LABEL_IN_FILENAME.search(path.name)
    if matched:
        return f"{matched.group(1)}-{int(matched.group(2)):02d}"
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
        async with session_factory() as db:
            await doorplate_io.delete_batches(db, keep=active)
            await db.commit()
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
            async with session_factory() as db:
                await doorplate_io.delete_batches(db, keep=active)
                await db.commit()
            raise GeoSyncError(f"門牌資料只有 {count} 筆，少於 {minimum} 筆，不換版")
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
            data = json.loads(file.read_text(encoding="utf-8"))
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
```

- [ ] **Step 5：跑測試確認通過**

Run：`uv run pytest -q tests/test_geo_sync.py`
Expected：20 passed。

- [ ] **Step 6：Commit**

```bash
git add backend/app/admissions/geo/sync.py backend/tests/test_geo_sync.py backend/app/config.py
git commit -m "feat(admissions): 區域分析的公開資料同步與重算

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A7：高雄市里界 GeoJSON

**Files:**
- Create: `backend/app/admissions/geo_data/kaohsiung-villages.geojson`（約 600KB，產生的資料檔）
- Create: `backend/app/admissions/geo_data/README.md`
- Create: `backend/app/admissions/geo/boundaries.py`
- Test: `backend/tests/test_geo_boundaries.py`

**Interfaces:**
- Consumes：A1 `DISTRICTS`；A4 `sample_doorplate_rows`（測試用）。
- Produces：`BOUNDARY_PATH`、`BOUNDARY_VERSION = "115-08-17"`、`boundary_bytes() -> bytes`、`boundary_etag() -> str`（`"villages-115-08-17-<sha1 前 12 碼>"`，含雙引號）、`village_code(district, village) -> str | None`。B 的測試會斷言 893 個 feature、三民區鼎金里 `64000050001`。

- [ ] **Step 1：寫失敗測試** — 建立 `backend/tests/test_geo_boundaries.py`：

```python
"""高雄市里界 GeoJSON（2026-10-08 規格 §5.6）。"""

from __future__ import annotations

import json

from app.admissions.geo.boundaries import BOUNDARY_PATH, BOUNDARY_VERSION, boundary_bytes, boundary_etag, village_code
from app.admissions.geo.kaohsiung import DISTRICTS
from tests.geo_helpers import sample_doorplate_rows


def _features():
    return json.loads(boundary_bytes())["features"]


def _points(geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        for ring in polygon:
            yield from ring


def test_file_has_kaohsiung_villages_only():
    features = _features()
    assert len(features) == 893
    assert all(f["properties"]["VILLNAME"] and f["properties"]["TOWNNAME"] in DISTRICTS for f in features)
    assert all(f["properties"]["VILLCODE"].startswith("64000") for f in features)
    assert set(features[0]["properties"]) == {"TOWNNAME", "VILLNAME", "VILLCODE"}


def test_no_far_away_islands():
    """未編定村里（東沙、南沙）要濾掉，否則地圖 fitBounds 會縮到南海。"""
    lngs, lats = zip(*(point for f in _features() for point in _points(f["geometry"])))
    assert 120.1 < min(lngs) and max(lngs) < 121.1
    assert 22.4 < min(lats) and max(lats) < 23.5


def test_village_codes():
    assert village_code("三民區", "鼎金里") == "64000050001"
    assert village_code("三民區", "本揚里") == "64000050015"
    assert village_code("鼓山區", "北美術館里") == "64000020040"
    assert village_code("三民區", "不存在里") is None


def test_doorplate_village_names_match_boundaries():
    """門牌表補過「里」字後，里名要對得上界圖。"""
    for row in sample_doorplate_rows():
        assert village_code(row.district, row.village) is not None, (row.district, row.village)


def test_etag_and_size():
    assert boundary_etag().startswith(f'"villages-{BOUNDARY_VERSION}-') and boundary_etag().endswith('"')
    assert BOUNDARY_PATH.stat().st_size < 800_000
```

- [ ] **Step 2：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_boundaries.py`
Expected：`No module named 'app.admissions.geo.boundaries'`。

- [ ] **Step 3：產生里界檔** — 先看 2026-10-08 研究時的輸出還在不在，在就直接複製：

```bash
SP=/private/tmp/claude-501/-Users-yilunwu-Desktop-ivy-website-admin/60f10af9-5431-4bf8-992f-3396c9128318/scratchpad
mkdir -p app/admissions/geo_data
if [ -f "$SP/opendata/villages/out2/kh_v_s10.geojson" ]; then
  cp "$SP/opendata/villages/out2/kh_v_s10.geojson" app/admissions/geo_data/kaohsiung-villages.geojson
fi
ls -l app/admissions/geo_data/
```

不在（例如重開機清掉 /private/tmp）就照下面 README 的「重新產生」指令做（下載約 21MB zip、`npx -y mapshaper@0.7.80`），輸出到 `app/admissions/geo_data/kaohsiung-villages.geojson`。

建立 `backend/app/admissions/geo_data/README.md`：

````markdown
# 高雄市里界（招生區域分析）

`kaohsiung-villages.geojson`：高雄市 893 個里的界線，給後台區域分析地圖著色、以及
`app/admissions/geo/boundaries.py` 的 (區, 里) → 里代碼對照。

- 來源：內政部國土測繪中心「村里界圖（TWD97經緯度）」<https://data.gov.tw/dataset/7438>，
  檔案 `VILLAGE_NLSC_1150817`（115/08/17 版），政府資料開放授權條款第 1 版。
- 座標：TWD97 經緯度（與 WGS84 差在公分級，Leaflet 直接用）。
- 處理：只留高雄市、去掉 11 筆「未編定村里」（`VILLNAME` 空白，含東沙、南沙——不濾掉地圖
  `fitBounds` 會縮到南海）；只留 `TOWNNAME`、`VILLNAME`、`VILLCODE`；mapshaper 簡化 10%
  （`keep-shapes`），座標精度 1e-5 度。約 600KB，gzip 約 130KB。
- 里代碼（`VILLCODE`）與內政部戶政司人口統計 ODRP014 的 `district_code` 相同。

## 重新產生

```bash
mkdir -p /tmp/villages && cd /tmp/villages
curl -sSLo villages.zip 'https://www.tgos.tw/tgos/VirtualDir/Product/a04697c8-64db-450a-a105-3eb471c45abd/%E6%9D%91(%E9%87%8C)%E7%95%8C(TWD97%E7%B6%93%E7%B7%AF%E5%BA%A6).zip'
unzip -o villages.zip
npx -y mapshaper@0.7.80 VILLAGE_NLSC_*.shp encoding=utf8 \
  -filter 'COUNTYNAME=="高雄市" && VILLNAME!=""' \
  -filter-fields TOWNNAME,VILLNAME,VILLCODE \
  -simplify 10% keep-shapes \
  -o kaohsiung-villages.geojson format=geojson precision=0.00001
```

換版時同步改 `boundaries.py` 的 `BOUNDARY_VERSION`，並重跑 `tests/test_geo_boundaries.py`。
````

- [ ] **Step 4：實作** — 建立 `backend/app/admissions/geo/boundaries.py`：

```python
"""高雄市里界 GeoJSON（docs/specs/2026-10-08-admissions-area-design.md §5.6）。檔案隨
backend 提交，產生方式見 app/admissions/geo_data/README.md；API 原樣回傳，另外提供
(區, 里) → 里代碼對照。"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

BOUNDARY_PATH = Path(__file__).resolve().parent.parent / "geo_data" / "kaohsiung-villages.geojson"
# 內政部國土測繪中心村里界圖 VILLAGE_NLSC_1150817（115/08/17 版）。
BOUNDARY_VERSION = "115-08-17"


@lru_cache(maxsize=1)
def boundary_bytes() -> bytes:
    return BOUNDARY_PATH.read_bytes()


@lru_cache(maxsize=1)
def boundary_etag() -> str:
    digest = hashlib.sha1(boundary_bytes()).hexdigest()[:12]
    return f'"villages-{BOUNDARY_VERSION}-{digest}"'


@lru_cache(maxsize=1)
def _village_codes() -> dict[tuple[str, str], str]:
    data = json.loads(boundary_bytes())
    return {
        (feature["properties"]["TOWNNAME"], feature["properties"]["VILLNAME"]): feature["properties"]["VILLCODE"]
        for feature in data["features"]
    }


def village_code(district: str, village: str) -> str | None:
    return _village_codes().get((district, village))
```

打包確認：`deploy/api.Dockerfile` 是 `COPY backend ./` 後 `uv sync`（專案以 editable 安裝、從原始碼目錄執行），`.dockerignore` 與 `.gitignore` 都不擋 `backend/app/admissions/geo_data/`，不必改 `pyproject.toml`。用這兩行確認：

```bash
git check-ignore -v app/admissions/geo_data/kaohsiung-villages.geojson; echo "exit=$?"   # 應為 exit=1（沒被忽略）
grep -n "COPY backend" ../deploy/api.Dockerfile
```

- [ ] **Step 5：跑測試確認通過**

Run：`uv run pytest -q tests/test_geo_boundaries.py`
Expected：5 passed。

- [ ] **Step 6：Commit**

```bash
git add backend/app/admissions/geo_data backend/app/admissions/geo/boundaries.py backend/tests/test_geo_boundaries.py
git commit -m "feat(admissions): 區域分析的高雄市里界資料

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A8：設定、背景迴圈、API 啟動條件、CLI

**Files:**
- Modify: `backend/app/config.py`（A6 Step 1 已套用，這裡只核對）
- Modify: `backend/.env.example`
- Create: `backend/app/workers/geo_loop.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/cli.py`
- Test: `backend/tests/test_geo_loop.py`

**Interfaces:**
- Consumes：A6 `run_geo_sync`、`GeoSyncResult`。
- Produces：`Settings.geo_auto_sync: bool = False`、`Settings.geo_doorplate_url: str | None = None`（空白→None、必須 https）、`Settings.geo_kindergartens_url: str`（必須 https）、`Settings.geo_sync_check_seconds: int = 86400`（300–604800）；`GeoSyncLoop(session_factory, settings, *, check_seconds, first_delay_seconds=30.0)`（`start()`、`stop()`、`run_once()`、`running`、`last_result`、`last_run_at`）、`LOCK_KEY = "ivy-website:geo-sync"`；`app.state.geo_sync`（兩個開關都開才是 `GeoSyncLoop`，否則 None）；`app.cli.geo_sync_options(args) -> dict`、`geo_sync_command(**options)`；指令 `python -m app.cli geo-sync [--force] [--doorplates-file <CSV>] [--doorplates-version 115-10] [--kindergartens-file <JSON>]`（C 的 stack 腳本用 `--doorplates-file`、`--kindergartens-file`；CLI 不看 `WEBSITE_GEO_AUTO_SYNC`；有任何一個 `failed` 時 exit 1）。

- [ ] **Step 1：寫失敗測試** — 建立 `backend/tests/test_geo_loop.py`：

```python
"""公開地理資料同步的背景迴圈、啟動條件、設定與 CLI 參數（2026-10-08 規格 §7）。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from sqlalchemy import text

from app.cli import geo_sync_options
from app.config import Settings
from app.main import create_app
from app.workers import geo_loop
from app.workers.geo_loop import LOCK_KEY, GeoSyncLoop
from tests.conftest import _test_settings
from tests.geo_helpers import FIXTURES


async def test_run_once_skips_while_another_worker_holds_the_lock(app, monkeypatch):
    calls: list[int] = []

    async def fake_sync(session_factory, settings, **kwargs):
        calls.append(1)
        return "done"

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600)
    async with app.state.session_factory() as other:
        await other.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": LOCK_KEY})
        assert await loop.run_once() is None
        await other.rollback()
    assert await loop.run_once() == "done"
    assert calls == [1] and loop.last_run_at is not None


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


@pytest.mark.parametrize(("admissions", "auto_sync", "expected"), [(True, True, True), (True, False, False), (False, True, False)])
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
    csv, data = FIXTURES / "doorplates-sample.csv", FIXTURES / "preschools-sample.json"
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
```

- [ ] **Step 2：跑測試確認失敗**

Run：`uv run pytest -q tests/test_geo_loop.py`
Expected：`ImportError: cannot import name 'geo_sync_options' from 'app.cli'`（或 `No module named 'app.workers.geo_loop'`）。

- [ ] **Step 3：config 四個欄位與驗證**（A6 Step 1 已套用的 diff，這裡核對一次）；`.env.example` 在這一步加

```diff
--- a/backend/app/config.py
+++ b/backend/app/config.py
@@ -62,6 +62,16 @@
     # 招生聯繫、招生訪視保存幾天）裁定前，正式站不可開啟。關閉時「標記已到場」
     # 不建招生訪視，/admin/admissions/* 不掛路由（404）；保存政策的招生類別照常。
     admissions_enabled: bool = False
+    # 招生區域分析的公開地理資料（高雄市門牌、幼兒園）自動同步（2026-10-08 規格 §7）。
+    # 所有環境預設關閉：開了會在 API 啟動後下載並匯入約 100MB 的門牌資料，正式站要先確認
+    # 資料庫空間（deploy/README.md）。只在 admissions_enabled 也開時才有作用；CLI
+    # `python -m app.cli geo-sync` 不看這個開關。
+    geo_auto_sync: bool = False
+    # 門牌檔案網址；留空＝自動在高雄市資料開放平台找最新月份。平台改版找不到時的退路。
+    geo_doorplate_url: str | None = None
+    geo_kindergartens_url: str = "https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json"
+    # 背景迴圈多久醒來檢查一次（秒）；真的下載與否由「超過 30 天沒確認過」決定。
+    geo_sync_check_seconds: int = Field(default=86400, ge=300, le=7 * 86400)
     # API 內建定期工作（排程發布、補時段、通知、清限流計數）的間隔秒數。
     # 沒設定時 production 每 60 秒一輪，其他環境關閉；設 0 明確關閉。
     background_jobs_interval_seconds: int | None = None
@@ -131,7 +141,23 @@
         if value is None:
             return None
         return value.strip().rstrip("/") or None
+
+    @field_validator("geo_doorplate_url")
+    @classmethod
+    def _geo_doorplate_url(cls, value: str | None) -> str | None:
+        value = (value or "").strip()
+        if value and not value.startswith("https://"):
+            raise ValueError("WEBSITE_GEO_DOORPLATE_URL 必須是 https:// 網址")
+        return value or None
 
+    @field_validator("geo_kindergartens_url")
+    @classmethod
+    def _geo_kindergartens_url(cls, value: str) -> str:
+        value = value.strip()
+        if not value.startswith("https://"):
+            raise ValueError("WEBSITE_GEO_KINDERGARTENS_URL 必須是 https:// 網址")
+        return value
+
     @field_validator("background_jobs_interval_seconds")
     @classmethod
     def _sane_background_interval(cls, value: int | None) -> int | None:
```

`.env.example`：

```diff
--- a/backend/.env.example
+++ b/backend/.env.example
@@ -50,6 +50,15 @@
 # 招生入學模組，預設關閉（後台招生端點 404、標記已到場不建招生訪視）。正式站要等
 # 規格 §15 Q1（同意書範圍、招生訪視保存天數）裁定後才能開，見 deploy/README.md。
 # WEBSITE_ADMISSIONS_ENABLED=true
+# 招生區域分析的公開地理資料（高雄市門牌、幼兒園）自動同步，預設關閉。開了會在 API 啟動後
+# 下載並匯入門牌資料（一版含索引約 185MB，換版時新舊並存），開之前先確認資料庫剩餘空間，
+# 見 deploy/README.md。只在 WEBSITE_ADMISSIONS_ENABLED 也開時才有作用；手動匯入用
+# python -m app.cli geo-sync（不看這個開關）。
+# WEBSITE_GEO_AUTO_SYNC=true
+# 門牌檔案網址（留空＝自動在高雄市資料開放平台找最新月份）、幼兒園資料網址、背景檢查間隔秒數。
+# WEBSITE_GEO_DOORPLATE_URL=
+# WEBSITE_GEO_KINDERGARTENS_URL=https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json
+# WEBSITE_GEO_SYNC_CHECK_SECONDS=86400
 # 公開端點限流信任的訪客 IP header；只有 api 不直接對外時才可信任，見 deploy/README.md。
 # WEBSITE_TRUSTED_CLIENT_IP_HEADER=x-website-client-ip
 # --- 2026-09-29 資安稽核修正新增的設定（全部選填，括號內為預設） ---
```

- [ ] **Step 4：背景迴圈** — 建立 `backend/app/workers/geo_loop.py`：

```python
"""API 程序內的公開地理資料同步迴圈（招生區域分析，docs/specs/2026-10-08-admissions-area-design.md §7）。

不併進 maintenance 的 run_cycle：那一輪持全域 advisory lock、每 60 秒一次，下載並匯入
約 100MB 的門牌資料要一兩分鐘，會讓排程發布與通知一起延後。這裡自己一個 asyncio
task，每 check_seconds（預設一天）呼叫一次 run_geo_sync；要不要真的下載由 sync 依
「超過 30 天沒確認過」判斷。多個副本同時醒來時以 advisory lock「ivy-website:geo-sync」
互斥，後到者跳過。只在 WEBSITE_ADMISSIONS_ENABLED 與 WEBSITE_GEO_AUTO_SYNC 都開時啟動
（app/main.py）；CLI `geo-sync` 不看這兩個開關。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo.sync import GeoSyncResult, run_geo_sync
from app.config import Settings

logger = logging.getLogger("app.admissions.geo.loop")

LOCK_KEY = "ivy-website:geo-sync"
# 第一輪不要跟啟動搶資源：健康檢查先過再開始。
FIRST_DELAY_SECONDS = 30.0


class GeoSyncLoop:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        check_seconds: float,
        first_delay_seconds: float = FIRST_DELAY_SECONDS,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self.check_seconds = check_seconds
        self.first_delay_seconds = first_delay_seconds
        self.last_result: GeoSyncResult | None = None
        self.last_run_at: datetime | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="geo-sync-loop")

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def stop(self, *, timeout: float = 10.0) -> None:
        """停機：下載到一半就取消；沒切換的批次下次同步開頭會清掉。"""
        self._stopping.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout)
        except asyncio.TimeoutError:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def run_once(self) -> GeoSyncResult | None:
        """拿到鎖就同步一次；別的副本正在跑回 None。"""
        async with self._session_factory() as lock_db:
            acquired = (
                await lock_db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": LOCK_KEY})
            ).scalar_one()
            if not acquired:
                await lock_db.rollback()
                return None
            # 持鎖的交易刻意閒置到同步做完（下載可能好幾分鐘），只對它關掉 idle 逾時。
            await lock_db.execute(text("SET LOCAL idle_in_transaction_session_timeout = 0"))
            try:
                result = await run_geo_sync(self._session_factory, self._settings)
            finally:
                await lock_db.rollback()
        self.last_result = result
        self.last_run_at = datetime.now(timezone.utc)
        return result

    async def _sleep(self, seconds: float) -> bool:
        """等下一輪；收到停止訊號就提早醒來並回傳 False。"""
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return True
        return False

    async def _run(self) -> None:
        if not await self._sleep(self.first_delay_seconds):
            return
        while True:
            try:
                result = await self.run_once()
                if result is not None and "skipped" not in (result.doorplates, result.kindergartens):
                    logger.info("公開地理資料同步：%s", result)
            except Exception:  # noqa: BLE001 - 取鎖或連線失敗，下一輪再試
                logger.exception("公開地理資料同步：這一輪無法完成")
            if not await self._sleep(self.check_seconds):
                return
```

- [ ] **Step 5：API 啟動條件**

```diff
--- a/backend/app/main.py
+++ b/backend/app/main.py
@@ -37,6 +37,7 @@
 from app.config import Settings, get_settings
 from app.logging_config import configure_logging
 from app.db import create_engine, create_rate_limit_engine, create_session_factory
+from app.workers.geo_loop import GeoSyncLoop
 from app.workers.maintenance import MaintenanceLoop
 from app.workers.media_loop import MediaJobLoop
 
@@ -141,9 +142,17 @@
                 app.state.session_factory, settings, poll_seconds=settings.media_jobs_poll_seconds
             )
             app.state.media_jobs.start()
+        # 招生區域分析的公開地理資料（app/workers/geo_loop.py）；兩個開關都開才跑。
+        if settings.admissions_enabled and settings.geo_auto_sync:
+            app.state.geo_sync = GeoSyncLoop(
+                app.state.session_factory, settings, check_seconds=settings.geo_sync_check_seconds
+            )
+            app.state.geo_sync.start()
         try:
             yield
         finally:
+            if app.state.geo_sync is not None:
+                await app.state.geo_sync.stop()
             # 先停轉檔迴圈：做到一半的影片放回佇列，下一個程序馬上接手（不算一次嘗試）。
             if app.state.media_jobs is not None:
                 await app.state.media_jobs.stop()
@@ -166,6 +175,7 @@
     )
     app.state.maintenance = None
     app.state.media_jobs = None
+    app.state.geo_sync = None
     app.state.settings = settings
     app.state.engine = create_engine(settings)
     app.state.session_factory: async_sessionmaker = create_session_factory(
```

- [ ] **Step 6：CLI**

```diff
--- a/backend/app/cli.py
+++ b/backend/app/cli.py
@@ -591,6 +591,52 @@
         raise SystemExit(1)
 
 
+def geo_sync_options(args: list[str]) -> dict:
+    """`geo-sync` 的參數。指定任一個檔案就完全不連外，沒指定檔案的那一種跳過；
+    --doorplates-version 省略時從檔名找「115-10」「115_10」，找不到用今天的民國年月。"""
+    usage = (
+        "用法：python -m app.cli geo-sync [--force] [--doorplates-file <CSV>] "
+        "[--doorplates-version 115-10] [--kindergartens-file <JSON>]"
+    )
+    options: dict = {"force": False, "doorplates_file": None, "doorplates_version": None, "kindergartens_file": None}
+    valued = {"--doorplates-file": "doorplates_file", "--doorplates-version": "doorplates_version",
+              "--kindergartens-file": "kindergartens_file"}
+    index = 0
+    while index < len(args):
+        arg = args[index]
+        if arg == "--force":
+            options["force"] = True
+            index += 1
+        elif arg in valued and index + 1 < len(args) and not args[index + 1].startswith("--"):
+            value = args[index + 1]
+            options[valued[arg]] = value if arg == "--doorplates-version" else Path(value)
+            index += 2
+        else:
+            raise SystemExit(usage)
+    for key in ("doorplates_file", "kindergartens_file"):
+        if options[key] is not None and not options[key].is_file():
+            raise SystemExit(f"找不到檔案：{options[key]}")
+    if options["doorplates_version"] is not None and options["doorplates_file"] is None:
+        raise SystemExit(usage)
+    return options
+
+
+async def geo_sync_command(**options) -> None:
+    """招生區域分析的公開地理資料同步（app/admissions/geo/sync.py）。不看
+    WEBSITE_GEO_AUTO_SYNC：那個開關只管 API 內的背景迴圈。"""
+    from app.admissions.geo.sync import run_geo_sync
+
+    settings = get_settings()
+    session_factory = await _session_factory()
+    result = await run_geo_sync(session_factory, settings, **options)
+    print(
+        f"門牌：{result.doorplates}（使用中 {result.doorplate_version or '尚未匯入'}）；"
+        f"幼兒園：{result.kindergartens}；重算訪視 {result.rematched} 筆"
+    )
+    if "failed" in (result.doorplates, result.kindergartens):
+        raise SystemExit(1)
+
+
 def main() -> None:
     if len(sys.argv) < 2:
         print(
@@ -599,7 +645,8 @@
             "initialize-content <fixture> [--dry-run]|process-notifications|"
             "requeue-notifications [--campus <key>] [--dry-run]|media-copy-to-s3 [--dry-run]|"
             "import-site-assets [--web-root <web 目錄>] [--apply] [--write-drafts]|"
-            "regenerate-media-variants [--apply] [--all]|strip-media-metadata [--apply]|transcode-media-videos [--apply]>",
+            "regenerate-media-variants [--apply] [--all]|strip-media-metadata [--apply]|transcode-media-videos [--apply]|"
+            "geo-sync [--force] [--doorplates-file <CSV>] [--doorplates-version 115-10] [--kindergartens-file <JSON>]>",
             file=sys.stderr,
         )
         raise SystemExit(1)
@@ -666,6 +713,8 @@
         if args - {"--apply", "--dry-run"} or {"--apply", "--dry-run"} <= args:
             raise SystemExit("用法：python -m app.cli transcode-media-videos [--apply]")
         asyncio.run(transcode_media_videos(apply="--apply" in args))
+    elif command == "geo-sync":
+        asyncio.run(geo_sync_command(**geo_sync_options(sys.argv[2:])))
     else:
         print(f"未知指令：{command}", file=sys.stderr)
         raise SystemExit(1)
```

- [ ] **Step 7：跑測試確認通過（含既有的迴圈、設定測試）**

Run：`uv run pytest -q tests/test_geo_loop.py tests/test_maintenance.py tests/test_media_job_loop.py tests/test_config_isolation.py tests/test_health.py`
Expected：全部 passed（`test_geo_loop.py` 15 項）。

- [ ] **Step 8：Commit**

```bash
git add backend/app/config.py backend/.env.example backend/app/workers/geo_loop.py backend/app/main.py backend/app/cli.py backend/tests/test_geo_loop.py
git commit -m "feat(admissions): 區域分析公開資料的背景同步與 geo-sync 指令

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A9：真實資料比對率與階段閘門

**Files:**
- Create: `backend/scripts/geo_match_report.py`

**Interfaces:**
- Consumes：A4 `DoorplateParser`、`import_doorplates`、`activate_doorplates`；A5 `locate`；`app.config.get_settings`、`app.db.create_engine`、`create_session_factory`。
- Produces：報告腳本（不進 CI）；精確＋鄰近 ≥ 95% 時 exit 0。

- [ ] **Step 1：寫腳本** — 建立 `backend/scripts/geo_match_report.py`：

```python
"""招生區域分析：用真實公開資料量地址比對率（2026-10-08 規格 §14.2，不進 CI）。

把完整的高雄市門牌 CSV 匯進 WEBSITE_TEST_DATABASE_URL 指的資料庫（要先 alembic upgrade
head，名稱要含 test），再拿 kiang preschools.json 裡高雄市營業中幼兒園的地址（公開的
園所地址，不是家長資料）跑 locate()。精確＋鄰近 ≥ 95% 才算通過（exit 0）。

用法（在 backend/）：
  WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \\
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_geo_test \\
  WEBSITE_SESSION_SECRET=local-only-session-secret-0000 \\
  uv run python scripts/geo_match_report.py <門牌.csv> <preschools.json> [--label 115-10]
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.admissions.geo import doorplates as doorplate_io
from app.admissions.geo.matcher import locate
from app.config import get_settings
from app.db import create_engine, create_session_factory

PASS_RATE = 0.95


async def _rows(path: Path):
    parser = doorplate_io.DoorplateParser()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for line in handle:
            row = parser.feed(line)
            if row is not None:
                yield row
    print(f"門牌：解析 {parser.parsed} 列、略過 {parser.skipped} 列")


async def main(args: argparse.Namespace) -> int:
    settings = get_settings()
    engine = create_engine(settings)
    session_factory = create_session_factory(engine)
    tag = f"{args.label}#report"
    try:
        count = await doorplate_io.import_doorplates(session_factory, tag, _rows(Path(args.doorplates)))
        await doorplate_io.activate_doorplates(session_factory, tag, args.label, now=datetime.now(timezone.utc))
        print(f"門牌：匯入 {count} 筆（{args.label}）")
        data = json.loads(Path(args.preschools).read_text(encoding="utf-8"))
        levels: collections.Counter[str] = collections.Counter()
        misses: list[str] = []
        async with session_factory() as db:
            for feature in data["features"]:
                props = feature["properties"]
                if props.get("city") != "高雄市" or str(props.get("is_active")) != "1":
                    continue
                address = "高雄市" + str(props.get("town") or "") + re.sub(r"^\[\d+\]", "", str(props.get("address") or ""))
                match = await locate(db, address, version=tag)
                levels[match.match_level] += 1
                if match.match_level not in ("exact", "nearby"):
                    misses.append(f"  {match.match_level:<9} {match.unlocated_reason or '':<18} {address}")
        total = sum(levels.values())
        rate = (levels["exact"] + levels["nearby"]) / total if total else 0.0
        print(f"幼兒園地址 {total} 筆：" + "、".join(f"{level} {n}" for level, n in levels.most_common()))
        print(f"精確＋鄰近：{rate:.1%}（門檻 {PASS_RATE:.0%}）")
        print("沒對到門牌的：\n" + "\n".join(misses[:40]))
        return 0 if rate >= PASS_RATE else 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("doorplates")
    parser.add_argument("preschools")
    parser.add_argument("--label", default="115-10")
    sys.exit(asyncio.run(main(parser.parse_args())))
```

- [ ] **Step 2：準備真實資料** — 2026-10-08 研究時下載過，先看 scratchpad 還在不在：

```bash
SP=/private/tmp/claude-501/-Users-yilunwu-Desktop-ivy-website-admin/60f10af9-5431-4bf8-992f-3396c9128318/scratchpad/opendata
ls -l "$SP/kcg/kcg_115_10.csv" "$SP/kiang/preschools.json" 2>/dev/null
```

不在就重新下載到自己的暫存目錄（約 112MB；下載物不受信任，只當資料讀）：

```bash
mkdir -p /tmp/ivy-geo-report && cd /tmp/ivy-geo-report
curl -sSL -A 'Mozilla/5.0' -o kcg_115_10.csv 'https://data.kcg.gov.tw/File/DirectDownload/667aae8f-d427-488b-9420-e51f28783dc3'
curl -sSL -o preschools.json 'https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json'
head -c 120 kcg_115_10.csv; echo; ls -l
cd -
```

- [ ] **Step 3：跑報告（獨立的報告庫，名稱要含 test）**

```bash
createdb ivy_website_area1008_geo_test 2>/dev/null; true
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_geo_test \
WEBSITE_SESSION_SECRET=local-only-session-secret-0000 uv run alembic upgrade head
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_geo_test \
WEBSITE_SESSION_SECRET=local-only-session-secret-0000 \
uv run python scripts/geo_match_report.py <門牌CSV路徑> <preschools.json 路徑> --label 115-10; echo "exit=$?"
psql -d ivy_website_area1008_geo_test -Atc "select pg_size_pretty(pg_total_relation_size('geo_doorplates')), count(*) from geo_doorplates"
```

Expected（2026-10-08 實測）：

```
門牌：解析 775772 列、略過 544 列
門牌：匯入 775772 筆（115-10）
幼兒園地址 734 筆：exact 708、district 13、nearby 11、street 2
精確＋鄰近：98.0%（門檻 95%）
exit=0
185 MB|775772
```

約 20 秒。把實際輸出（比對率、表大小）抄進 B 階段結束時的 README 紀錄。跑完 `dropdb ivy_website_area1008_geo_test`。

- [ ] **Step 4：A 階段閘門**

```bash
uv run pytest -q tests/test_geo_*.py
uv run alembic downgrade -1 && uv run alembic upgrade head
uv run pytest -q tests/test_maintenance.py tests/test_media_job_loop.py tests/test_config_isolation.py \
  tests/test_admissions_schema.py tests/test_admissions_records.py tests/test_health.py
```

Expected：全綠（2026-10-08 實測 geo＋這幾個檔共 283 passed）。全套 pytest 留給 B 階段閘門由主 session 背景跑。

- [ ] **Step 5：Commit**

```bash
git add backend/scripts/geo_match_report.py
git commit -m "chore(admissions): 區域分析地址比對率報告腳本

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 自我檢查（2026-10-08 寫完時）

- 規格覆蓋：§4 資料特性（BOM、全形、樓層、地區型、補里字、91／104 個歧義鍵、東沙南沙、非 CKAN）→ A1、A4、A6、A7；§5 四張表 → A3；§5.5 `district` 由伺服器填 → A5 `apply_visit_geo`（B 接到建立／更新流程）；§5.6 里界 → A7；§6 比對 → A1、A5；§7 同步（每天檢查、30 天、空表立即匯入、失敗保留、獨立鎖、預設關、CLI、測試不連外）→ A6、A8；§10 不存家長座標、log 不含地址 → A3、A5、A6；§14.1 後端測試、§14.2 實際資料 → 各任務、A9。§8 API、§9 畫面、§10 匿名化、§11–§13 屬 B／C。
- 規格要回寫（B／C 階段文件回寫時一起改）：§4「台→臺」改成「台」；§5.1 `lane`／`alley` 改字串、`dataset_version` 是批次標記；§5.3 加 `label`、`checked_at`、`last_attempt_at`、`campuses`；§13 空間門檻改成「門牌一版含索引約 185MB，換版時約 370MB，開同步前剩餘空間至少 500MB」。
