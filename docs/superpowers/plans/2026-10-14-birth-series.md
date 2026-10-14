# 多年出生數走勢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 出生資料改用戶政 ODRP061、保留 72 個月，區域分析「里的變化」多一塊「近幾年的出生數」（本校半徑每 12 個月一期、最多 6 期），並補齊 ODRP010 缺的三個月。

**Architecture:** 沿用 A 段的月份歷史表與讀取時彙整：`Series` 加各自的保留月數（出生 72、其餘 25），出生來源代碼改 `ODRP061`；回補沒到頭時隔天續補；`trends.py` 一次讀 72 個月，`baseline.births_series` 回傳每期出生數與增減；前端新元件 `BirthSeries.vue` 放在「里的變化」總結句下面、里表上面。**不新增 migration。**

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、PostgreSQL、pytest；Vue 3 + TypeScript + Element Plus、vitest；Playwright stack e2e；openapi-typescript 契約。

**Spec:** `docs/specs/2026-10-14-birth-series-design.md`（使用者 10-14 核可，commit `372dd1ef`）。基準 `origin/main` `03eaa872`。

## 共通規則與指令

- 繁體中文（台灣用語），技術名詞與識別符保留原文；commit 訊息繁體中文、Conventional Commit，結尾加 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；只 `git add` 你動到的檔案（不要 `git add .`／`-A`）。
- 顏色一律走 token（`var(--…)`），不寫 rgba／oklch／hex 字面值；不裝圖表套件。
- 一次只跑一組測試（機器 8GB RAM）；不要在子代理裡跑後端全套 pytest 或 stack 全套（超過 10 分鐘會被殺，由主 session 背景跑）。
- worktree：`~/Repositories/ivy-website-wt/birth-series-20261014`（分支 `feature/birth-series-20261014`）。以下指令都從這個 worktree 的根目錄出發。
- 後端測試指令（`<DB>` 用控制者備好的 `ivy_website_birthseries1014_test`，已升到 head）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/<DB> WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider <檔案或 node id>`（`WEBSITE_*` 必須逐一寫在同一行，zsh 不會把變數字串斷字）。
- 前端指令：`cd admin && source ~/.nvm/nvm.sh; nvm use 22; npx vitest run <檔案>`、`npm run typecheck`（用分號串接，`source nvm.sh` 會 exit 3，不要用 `&&`）。
- 契約：**不要用 `npm run contract:check`／`contract:generate`**（它們呼叫 `uv run`，會改到共用 venv）。用：
  `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs`；
  重新產生：`cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts`。

## Global Constraints

（逐字取自規格；每個 task 都隱含這一節。）

- 出生改抓 **ODRP061**（取代 ODRP010），不做退回 ODRP010 的備援；解析仍只留 `statistic_yyymm`、`district_code`、`site_id`、`village`、`birth_total` 五個欄位。（S1）
- 出生表留最新月份往回（含）**72 個月**；遷入遷出、年齡維持 **25 個月**。（S2）
- 期間：每 12 個月一期，終點是最新月份往回每 12 個月，最多 **6 期**；一期有資料的月份不到 **10 個月**就不列。（S3）
- 只算**本校半徑合計**（沿用 `all_codes`）；里層級不出走勢。（S4）
- 增減：每期和**前一期（更舊的）**只比兩期都有資料的同月份；可比月份不到 **6 個**、或前一期可比的出生不到 **20 位**、或沒有前一期，為 `null`；`baseline.births_change_pct` 用同一個函式。（S5）
- 缺月**不估算、不補值**，缺的月份列在該期。（S6）
- 到期：`checked_at` 距今 30 天，**或**表內最舊月份比視窗起點晚 **2 個月以上**。（S7）
- 打包腳本出生抓 72 個月。（S8）
- 只描述過去，**不推估未來**；不做里層級走勢、不依性別拆開、不估算缺月、不顯示在公開官網。（§1.3）
- **不新增 migration**；`geo_village_births` 結構不變。（S11）
- API 多 `baseline.births_series`（最新一期在前）；欄位：`starts`、`ends`、`months`、`missing`、`births`、`change_pct`；契約重新產生。（S10、§4.2）
- 畫面：位置在「里的變化」內、總結句下面、里表上面；最新一期在最上面；缺月寫出來；可匯出 CSV；手機（≤720px）不橫向溢出；`births_series` 為空整塊不顯示；只有一期照列、「和前一期」寫「—」；地圖、彈出框、里表、總結句不改。（S9、§4.3）

## 計畫裁定（Plan Rulings）

| # | 裁定 | 理由 |
|---|---|---|
| R1 | `BirthSeries.vue` 用自己的 ARIA table（`role="table"`／`row`／`cell`，div＋CSS grid），**不嵌套第二個 `StatsDimensionTable`** | 巢狀的 `StatsDimensionTable` 會讓既有 `areaTab.test.ts` 對「里的變化」區塊的 `thead th`、`tbody tr`、`.stats-block__caption` 選到兩張表而全部壞掉；長條樣式照抄 `.stats-bar`，所以資訊與外觀不變，還能做到規格說的「缺月淡色小字」。規格 §4.3 的「`StatsDimensionTable` 長條欄」改為「同樣式的長條」，Task 6 一併改規格 |
| R2 | 到期規則的「晚 2 個月以上」寫成 `min(months) > shift(start, 1)`（`start` ＝ `shift(max(months), -(keep_months - 1))`） | 起點那個月來源查無時，最舊月份剛好是 `start + 1`，不算沒補到頭 |
| R3 | `births_series` 在 pydantic 裡是**必填**（沒有預設值），不是預設空陣列 | 讓產生的 TypeScript 型別是必填欄位，前端測試資料漏填會在 typecheck 就被擋；伺服器永遠會填（空陣列也算填） |

## Review Focus

（規格沒有直接說、但最可能咬到使用者的情況；每一條都有 task 內的測試釘住。）

1. **回補永遠不結束或天天重試**：視窗起點剛好是永久缺月（如日後 111-03 落在起點）、或起點連續缺兩個月。→ Task 2 `test_a_missing_window_start_month_does_not_retry_every_day`、`test_two_missing_months_at_the_window_start_are_asked_again`。
2. **缺月那一期被誤判成少了一個月的出生**（111-03 那期 11 個月）：增減要只比兩期都有的月份。→ Task 3 `test_births_series_lists_the_periods_newest_first`（P3 對 P4 是 −25.0、不是 −32.0）。
3. **小半徑數字亂跳**：1 公里半徑前一期可比出生不到 20 位時不給百分比（含 `baseline.births_change_pct`）。→ Task 3 `test_a_change_needs_twenty_births_in_the_previous_period`。
4. **部署後回補到一半的狀態**：只有 1～2 期湊得滿 10 個月、或根本沒有出生資料時畫面不報錯。→ Task 3 `test_a_period_with_fewer_than_ten_months_is_not_listed`、`test_without_births_the_series_is_empty`；Task 4 `BirthSeries` 空陣列與單期測試。
5. **手機寬度撐出頁面／長期間標籤擠爆**：390px。→ Task 5 stack e2e `390px：近幾年的出生數不撐出頁面`。
6. **檔案模式匯入視窗內的舊月份被「寫進去又立刻刪掉」**（保留月數改成逐 series 之後）。→ Task 1 `test_births_files_keep_months_inside_the_72_month_window`。
7. **新區塊讓既有「里的變化」表測試的選擇器選到兩張表**。→ Task 4 `areaTab` 新案例同時斷言原表頭不變、新區塊沒有 `<table>`。

## File Structure

後端
- Modify `backend/app/admissions/geo/village_series.py`：`Series.keep_months`、`BIRTHS_KEEP_MONTHS = 72`、`BIRTHS` 改 ODRP061、`prune` 用各 series 的保留月數。
- Modify `backend/app/admissions/geo/sync.py`：回補視窗用 `series.keep_months`；`_series_due(status, now, backfill_pending=False)`；新增 `_backfill_pending`；docstring。
- Modify `backend/app/admissions/geo/models.py`：只改 `GeoVillageBirths` docstring。
- Modify `backend/scripts/fetch_geo_bundle.py`：每個 series 用自己的視窗；docstring。
- Modify `backend/app/admissions/trends.py`：出生載入 72 個月；新增 `births_change`、`birth_series`；`baseline` 多 `births_series`。
- Modify `backend/app/admissions/schemas.py`：`AreaTrendsBirthPeriodOut`、`AreaTrendsBaselineOut.births_series`。
- Modify `backend/tests/geo_helpers.py`、`backend/tests/test_geo_village_series.py`、`backend/tests/test_geo_bundle.py`、`backend/tests/test_admissions_trends.py`。
- Rename `backend/tests/fixtures/geo/ris-odrp010-11509.json` → `ris-odrp061-11509.json`（加幾個 ODRP061 才有的欄位）。
- Modify `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（重新產生）。

前端（`admin/src/`）
- Modify `api/types.ts`（匯出 `AreaTrendsBirthPeriod`）、`components/admissions/area/areaFormat.ts`（匯出 `signedPercent`）、`components/admissions/area/VillageTrendsPanel.vue`（掛載一行）。
- Create `components/admissions/area/birthSeriesFormat.ts`（期間標籤、缺月、增減、CSV 列）、`components/admissions/area/BirthSeries.vue`。
- Modify `__tests__/admissionsTestKit.ts`、`__tests__/areaTab.test.ts`；Create `__tests__/birthSeriesFormat.test.ts`、`__tests__/birthSeries.test.ts`。

e2e／文件
- Modify `tests/stack/db.ts`（`seedBirthSeries`）、`tests/stack/admissions-area.spec.ts`（兩個案例）。
- Modify `deploy/README.md`、`DESIGN.md`、`README.md`、`backend/app/admissions/geo_data/README.md`、規格 `docs/specs/2026-10-14-birth-series-design.md`。

## Task 0：環境（控制者先備，不交給實作者）

- [ ] **Step 1：補 sparse checkout 與依賴**

```bash
cd ~/Repositories/ivy-website-wt/birth-series-20261014
git sparse-checkout set docs backend admin web contracts tests deploy scripts
git checkout -q
source ~/.nvm/nvm.sh; nvm use 22
(cd admin && npm ci); (cd web && npm ci); npm ci
(cd backend && uv sync --frozen)
```

- [ ] **Step 2：建測試庫並升到 head**

```bash
createdb ivy_website_birthseries1014_test
createdb ivy_website_birthseries1014_e2e_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head
```

預期：`alembic heads` 單一 head `c6a9e3f15d27`。e2e 使用 `E2E_DB_NAME=ivy_website_birthseries1014_e2e_test E2E_API_PORT=8743 E2E_WEB_PORT=3743`。

---

### Task 1：出生來源改 ODRP061，保留月數逐 series

**Files:**
- Rename: `backend/tests/fixtures/geo/ris-odrp010-11509.json` → `ris-odrp061-11509.json`
- Modify: `backend/tests/geo_helpers.py`、`backend/tests/test_geo_village_series.py`、`backend/tests/test_geo_bundle.py`
- Modify: `backend/app/admissions/geo/village_series.py`、`backend/app/admissions/geo/sync.py`、`backend/app/admissions/geo/models.py`、`backend/scripts/fetch_geo_bundle.py`

**Interfaces:**
- Produces（Task 2、3 依賴）：`village_series.Series.keep_months: int`（預設 `KEEP_MONTHS`＝25）、`village_series.BIRTHS_KEEP_MONTHS = 72`、`BIRTHS.code == "ODRP061"`、`BIRTHS.keep_months == 72`、`MIGRATION.keep_months == 25`、`AGES.keep_months == 25`；`prune(db, series, latest)` 簽名不變、內部用 `series.keep_months`。
- Consumes：無。

- [ ] **Step 1：把樣本檔改名成 ODRP061，並加幾個 ODRP061 才有的欄位**

```bash
git mv backend/tests/fixtures/geo/ris-odrp010-11509.json backend/tests/fixtures/geo/ris-odrp061-11509.json
python3 -I - <<'EOF'
import json
from pathlib import Path

path = Path("backend/tests/fixtures/geo/ris-odrp061-11509.json")
data = json.loads(path.read_text(encoding="utf-8"))
for row in data["responseData"]:
    # ODRP061 有 56 欄；程式只用 birth_total，多出來的欄位解析時要被丟掉。
    row.update({
        "household_no": "1234", "neighbor_no2": "20", "people_total": "3456",
        "twinborn_child_m": "0", "twinborn_child_f": "0",
        "birth_legal_m": row["birth_total_m"], "birth_legal_f": row["birth_total_f"],
    })
path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(len(data["responseData"]), "rows")
EOF
```

預期印出 `26 rows`（24 個高雄里＋2 筆新北市）。

- [ ] **Step 2：改測試假站（`backend/tests/geo_helpers.py`）**

(a) 檔頭說明（約第 16 行）把 `ris-odrp010-11509.json、ris-odrp011-11509.json：ODRP010（出生）、ODRP011（遷入遷出）` 改成 `ris-odrp061-11509.json、ris-odrp011-11509.json：ODRP061（出生，2026-10-14 起取代 ODRP010）、ODRP011（遷入遷出）`，並在該段末尾補一句：`ODRP061 樣本多了 household_no 等幾個欄位（程式只用 birth_total，其餘解析時丟掉）`。

(b) 網址規則與樣本對照（約第 77–79 行）改成：

```python
_RIS_PATH = re.compile(re.escape(series_io.RIS_ROOT) + r"/(ODRP(?:01[14]|061))/([0-9]{5})")
RIS_SERIES_FIXTURES = {"ODRP061": FIXTURES / "ris-odrp061-11509.json", "ODRP011": FIXTURES / "ris-odrp011-11509.json"}
```

（刻意拿掉 ODRP010：程式若又去抓 ODRP010，假站回 `None`，測試端轉成 404，馬上看得到。）

(c) `ris_series_page` 與 `ris_response` 的 docstring 裡的 `ODRP010／ODRP011` 改成 `ODRP061／ODRP011`（含 `series_months 給定時 ODRP010／011 只有這些月份有資料` 那句）。

- [ ] **Step 3：改既有測試並新增測試（先紅）**

`backend/tests/test_geo_village_series.py`：

(a) 全檔把字串 `"ODRP010"` 換成 `"ODRP061"`（`_rows("ODRP010")`、`ris_series_page("ODRP010", month)`）：

```bash
sed -i '' 's/"ODRP010"/"ODRP061"/g' backend/tests/test_geo_village_series.py backend/tests/test_geo_bundle.py
grep -n "ODRP010" backend/tests/test_geo_village_series.py backend/tests/test_geo_bundle.py
```

grep 預期只剩 `test_page_url_asks_only_for_kaohsiung` 裡的網址字串與檔頭 docstring。

(b) `test_month_arithmetic_crosses_years` 的第 79 行（`assert len(window("115-09", series_io.KEEP_MONTHS)) == 25 …`）換成：

```python
    assert series_io.KEEP_MONTHS == 25 and series_io.BIRTHS_KEEP_MONTHS == 72
    assert (series_io.BIRTHS.keep_months, series_io.MIGRATION.keep_months, series_io.AGES.keep_months) == (72, 25, 25)
    assert window("115-09", 25)[0] == "113-09" and window("115-09", 72)[0] == "109-10"
```

(c) `test_page_url_asks_only_for_kaohsiung` 的網址改成 `ODRP061`：

```python
    assert series_io.page_url(BIRTHS, "11509", 1) == (
        "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP061/11509?COUNTY=%E9%AB%98%E9%9B%84%E5%B8%82&page=1"
    )
```

(d) 在 `test_parse_keeps_kaohsiung_rows_and_only_the_fields_in_use` 後面新增：

```python
def test_births_parse_ignores_the_other_odrp061_columns():
    data = series_io.parse_page(BIRTHS, json.dumps(ris_series_page("ODRP061"), ensure_ascii=False))
    rows = series_io.response_rows(BIRTHS, data)
    assert len(rows) == RIS_SAMPLE_VILLAGES  # 新北市 2 筆在解析時就丟掉
    assert set(rows[0]) == {"statistic_yyymm", "district_code", "site_id", "village", "birth_total"}
```

(e) 把 `test_first_sync_backfills_25_months_and_records_the_latest` 整個換成：

```python
@pytest.mark.parametrize(
    ("series", "model", "keep"), [(BIRTHS, GeoVillageBirths, 72), (MIGRATION, GeoVillageMigration, 25)]
)
async def test_first_sync_backfills_the_retention_window_and_records_the_latest(app, few_villages, october, series, model, keep):
    transport, seen = _ris()
    assert await _sync(app, transport, series) == ("updated", keep)
    months = await _months(app, model)
    assert sorted(months) == window("115-09", keep)
    assert set(months.values()) == {RIS_SAMPLE_VILLAGES}
    status = await _status(app, series.dataset)
    assert (status.active_version, status.label, status.last_error) == ("115-09", "115-09", None)
    assert status.checked_at is not None
    # 最新月份的第一頁拿來找月份，不重抓；其餘月份各一次。
    assert len(seen) == keep and seen[0] == series_io.page_url(series, "11509", 1)
```

(f) `test_months_the_source_does_not_have_are_skipped_and_asked_again_later`：把 `window("115-09", 25)` 改成 `window("115-09", 72)`、`("updated", 22)` 改成 `("updated", 69)`；docstring 改成「出生 API 缺 113-10、113-11、114-01 的 ODRP010 已不用；這裡模擬來源仍然缺這三個月」。

(g) `test_failure_midway_keeps_the_months_already_written` 最後三行改成：

```python
    transport, seen = _ris()
    assert await _sync(app, transport, BIRTHS) == ("updated", 69)
    assert len(await _months(app, GeoVillageBirths)) == 72
    assert series_io.page_url(BIRTHS, "11508", 1) not in seen
```

(h) 把 `test_months_older_than_25_are_pruned` 整個換成：

```python
async def test_months_older_than_the_births_window_are_pruned(app, few_villages, october):
    async with app.state.session_factory() as db:
        db.add(GeoVillageBirths(month="109-09", village_code=YIHUA_VILLAGE, district="三民區", village="本揚里", births=1))
        await db.commit()
    transport, _ = _ris()
    await _sync(app, transport, BIRTHS)
    months = await _months(app, GeoVillageBirths)
    assert "109-09" not in months and "109-10" in months
```

(i) 在 `test_files_are_grouped_by_month_and_do_not_go_online` 後面新增：

```python
async def test_births_files_keep_months_inside_the_72_month_window(app, few_villages, tmp_path: Path):
    """出生視窗是 72 個月：檔案模式匯入的 109-10（視窗起點）不能被寫進去又立刻刪掉。"""
    files = []
    for month in ("11509", "10910"):
        path = tmp_path / f"births-{month}.json"
        path.write_text(json.dumps(ris_series_page("ODRP061", month), ensure_ascii=False), encoding="utf-8")
        files.append(path)
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, births_files=files)
    assert (result.births, result.births_months) == ("updated", 2)
    assert sorted(await _months(app, GeoVillageBirths)) == ["109-10", "115-09"]
```

(j) `test_run_geo_sync_fills_births_migration_and_the_year_ago_ages` 的第二個 assert 改成：

```python
    assert (result.births_version, result.migration_version, result.births_months, result.migration_months) == ("115-09", "115-09", 72, 25)
```

- [ ] **Step 4：跑測試確認是紅的**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_geo_village_series.py tests/test_geo_bundle.py
```

預期：多項失敗（`BIRTHS_KEEP_MONTHS`／`keep_months` 不存在、網址仍是 ODRP010、回補月份數是 25）。

- [ ] **Step 5：實作 `village_series.py`**

(a) 模組 docstring 第 1 行 `ODRP010／ODRP011／ODRP014` 改成 `ODRP061／ODRP011／ODRP014`，「表裡留最新月份往回 KEEP_MONTHS 個月」改成「表裡留最新月份往回各 series 的 keep_months 個月（出生 72、其餘 25）」。

(b) 常數區改成：

```python
RIS_ROOT = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore"
# 最新月份往回幾個月（含）：近 12 個月，加上前一年同月份。遷入遷出、年齡用這個。
KEEP_MONTHS = 25
# 出生（2026-10-14 出生走勢規格 S2）：6 個完整的 12 個月期，現在是 109-10 到 115-09。
BIRTHS_KEEP_MONTHS = 72
```

(c) `Series` 在 `columns` 後面多一個欄位（有預設值，所以放最後）：

```python
    dataset: str
    code: str
    name: str
    model: type
    columns: dict[str, tuple[str, ...]]
    keep_months: int = KEEP_MONTHS
```

docstring 補一句：「keep_months 是表裡留的月數（最新月份往回，含）。」

(d) `BIRTHS` 改成：

```python
BIRTHS = Series(
    "births", "ODRP061", "各里出生", GeoVillageBirths, {"births": ("birth_total",)}, BIRTHS_KEEP_MONTHS
)
```

(e) `prune` 改成：

```python
async def prune(db: AsyncSession, series: Series, latest: str) -> None:
    """只留 latest 往回 series.keep_months 個月（不 commit）。比 latest 新的月份不會出現（換版只往前）。"""
    model = series.model
    await db.execute(delete(model).where(model.month < shift(latest, -(series.keep_months - 1))))
```

- [ ] **Step 6：實作 `sync.py`、`models.py`、`fetch_geo_bundle.py`**

`backend/app/admissions/geo/sync.py`：
- 第 939 行 `for label in reversed(series_io.window(latest, series_io.KEEP_MONTHS)):` 改成 `for label in reversed(series_io.window(latest, series.keep_months)):`。
- 模組 docstring 約第 28–30 行把 `ODRP010、ODRP011（出生、遷入遷出，village_series.py）同一支 API：找到最新月份後，往回 24 個月` 改成 `ODRP061、ODRP011（出生、遷入遷出，village_series.py）同一支 API：找到最新月份後，出生往回 71 個月（表留 72 個月）、遷入遷出往回 24 個月`，其餘文字照舊。
- `sync_series` docstring 的「再把最新往回 24 個月內表裡沒有的月份逐月補」改成「再把最新往回（`series.keep_months` − 1）個月內表裡沒有的月份逐月補」。

`backend/app/admissions/geo/models.py` 第 235 行 docstring：`內政部戶政司 ODRP010` → `內政部戶政司 ODRP061（2026-10-14 起取代 ODRP010）`。

`backend/scripts/fetch_geo_bundle.py`：
- 第 80 行 `for label in reversed(series_io.window(latest, series_io.KEEP_MONTHS)):` 改成 `for label in reversed(series_io.window(latest, series.keep_months)):`。
- 第 3 行說明 `各里出生（ODRP010）、遷入遷出（ODRP011）各最新月份往回 25 個月` 改成 `各里出生（ODRP061，往回 72 個月）、遷入遷出（ODRP011，往回 25 個月）各抓最新月份往回的視窗`。

- [ ] **Step 7：跑測試確認變綠**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_geo_village_series.py tests/test_geo_bundle.py tests/test_geo_sync.py tests/test_geo_loop.py tests/test_geo_limits.py tests/test_geo_schema.py
```

預期全部通過。若別的檔案有寫死「25 個月出生」的斷言（例如 `test_geo_sync.py`），改成 72；改了什麼寫進回報。

- [ ] **Step 8：Commit**

```bash
git add backend/app/admissions/geo/village_series.py backend/app/admissions/geo/sync.py backend/app/admissions/geo/models.py backend/scripts/fetch_geo_bundle.py backend/tests/geo_helpers.py backend/tests/test_geo_village_series.py backend/tests/test_geo_bundle.py backend/tests/fixtures/geo/ris-odrp061-11509.json
git commit -m "feat(geo): 出生改抓戶政 ODRP061，出生表留 72 個月、其餘維持 25 個月

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2：回補沒到頭時隔天續補

**Files:**
- Modify: `backend/app/admissions/geo/sync.py`（`_series_due`、新增 `_backfill_pending`、`sync_series`）
- Test: `backend/tests/test_geo_village_series.py`

**Interfaces:**
- Consumes（Task 1）：`series.keep_months`、`series_io.months_in_table`、`series_io.shift`。
- Produces：`sync._series_due(status, now, backfill_pending: bool = False) -> bool`（舊的兩個參數呼叫仍然有效，`sync.py:1110` 的另一處呼叫不用改）；`async sync._backfill_pending(session_factory, series) -> bool`。

- [ ] **Step 1：寫測試（先紅）**

在 `backend/tests/test_geo_village_series.py` 的 `test_force_downloads_the_latest_month_again` 後面新增：

```python
async def _insert_births(app, months: list[str], *, checked_at: datetime) -> None:
    """表裡已有這些月份（舊程式寫的）、整輪確認時間是 checked_at：用來測「回補沒到頭」的到期判斷。"""
    async with app.state.session_factory() as db:
        for month in months:
            db.add(GeoVillageBirths(month=month, village_code=YIHUA_VILLAGE, district="三民區", village="本揚里", births=1))
        latest = max(months)
        db.add(GeoDatasetStatus(dataset="births", active_version=latest, label=latest, synced_at=checked_at, checked_at=checked_at))
        await db.commit()


async def test_an_unfinished_backfill_is_due_even_within_30_days(app, few_villages, october):
    """部署後表裡只有 25 個月、確認時間才剛記過：最舊月份還沒補到視窗起點，馬上接著補（不等 30 天）。"""
    await _insert_births(app, window("115-09", 25), checked_at=datetime.now(timezone.utc))
    transport, seen = _ris()
    assert await _sync(app, transport, BIRTHS) == ("updated", 47)
    assert sorted(await _months(app, GeoVillageBirths)) == window("115-09", 72)
    # 最新月份的第一頁拿來找月份、不重抓；其餘 47 個月各一次。
    assert len(seen) == 48
    seen.clear()
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)  # 補到頭了：回到 30 天一次
    assert seen == []


async def test_a_missing_window_start_month_does_not_retry_every_day(app, few_villages, october):
    """視窗起點（109-10）剛好是來源查無的月份：最舊月份只晚 1 個月，不算沒補到頭。"""
    months = [month for month in window("115-09", 72) if month != "109-10"]
    await _insert_births(app, months, checked_at=datetime.now(timezone.utc))
    transport, seen = _ris()
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)
    assert seen == []


async def test_two_missing_months_at_the_window_start_are_asked_again(app, few_villages, october):
    """起點連續缺兩個月：最舊月份晚了 2 個月，視為還沒補到頭，會再問來源（問到查無就什麼都不寫）。"""
    months = [month for month in window("115-09", 72) if month not in ("109-10", "109-11")]
    await _insert_births(app, months, checked_at=datetime.now(timezone.utc))
    available = {series_io.yyymm_of(month) for month in window("115-09", 72)} - {"10910", "10911"}
    transport, seen = _ris(series_months=available)
    assert await _sync(app, transport, BIRTHS) == ("skipped", 0)
    assert sorted(seen) == sorted(series_io.page_url(BIRTHS, month, 1) for month in ("11509", "10910", "10911"))
```

- [ ] **Step 2：跑測試確認紅**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_geo_village_series.py -k "unfinished_backfill or window_start"
```

預期：`test_an_unfinished_backfill_is_due_even_within_30_days` 失敗（回 `("skipped", 0)`）；另兩個可能先綠（它們驗的是「不重試」與「再問」），紅燈只要有第一個就夠。

- [ ] **Step 3：實作**

`backend/app/admissions/geo/sync.py`，把 `_series_due` 換成：

```python
def _series_due(status: GeoDatasetStatus | None, now: datetime, backfill_pending: bool = False) -> bool:
    """只看 checked_at（整輪回補做完才記）：回補到一半失敗時 synced_at 是新的、checked_at 沒動，
    下一輪（背景迴圈一天一次）就接著補，不必等 30 天。backfill_pending（表裡最舊月份還沒補到視窗起點）
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
```

`sync_series` 裡（約第 913–915 行）改成：

```python
    status = await _status(session_factory, series.dataset)
    pending = await _backfill_pending(session_factory, series)
    if not files and (client is None or (not force and not _series_due(status, now, pending))):
        return "skipped", 0
```

- [ ] **Step 4：跑測試確認綠**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_geo_village_series.py tests/test_geo_sync.py tests/test_geo_loop.py
```

預期全部通過（含既有的 `test_within_30_days_does_not_go_online`、`test_months_the_source_does_not_have_are_skipped_and_asked_again_later`：它們的表都已補到起點，不是 pending）。

- [ ] **Step 5：Commit**

```bash
git add backend/app/admissions/geo/sync.py backend/tests/test_geo_village_series.py
git commit -m "feat(geo): 出生回補沒到頭時隔天續補，起點缺一個月不重試

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3：`/area/trends` 回傳每期出生數（`baseline.births_series`）

**Files:**
- Modify: `backend/app/admissions/trends.py`、`backend/app/admissions/schemas.py`
- Test: `backend/tests/test_admissions_trends.py`
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 1）：`series_io.BIRTHS.keep_months == 72`。
- Produces（Task 4、5 依賴）：回應 `baseline.births_series: list[{starts: str, ends: str, months: int, missing: list[str], births: int, change_pct: float | None}]`（最新一期在最前）；`baseline.births_change_pct` 規則改為「可比不到 6 個月或前一期可比出生不到 20 位為 null」；模組函式 `trends.births_change(births, present, codes) -> tuple[float | None, int]`、`trends.birth_series(births, latest, codes) -> list[dict]`。

- [ ] **Step 1：寫測試（先紅）**

`backend/tests/test_admissions_trends.py`：

(a) 在 `_seed` 後面新增兩個輔助函式：

```python
async def _seed_births(db, months: list[str], count_of) -> None:
    """出生表：本揚里每月 count_of(month) 位、其他里 0；月份裡沒列出的就是缺月。"""
    for month in months:
        for code in AGES:
            if code == OLD_CODE:
                continue
            district, village = _name(code)
            count = count_of(month) if code == BENYANG else 0
            db.add(GeoVillageBirths(month=month, village_code=code, district=district, village=village, births=count))
    db.add(GeoDatasetStatus(dataset="births", active_version=CURRENT, label=CURRENT, synced_at=NOW))
    await db.commit()


def _per_period(counts: list[int]):
    """第 k 期（從最新往回，每期 12 個月）每月 counts[k] 位。"""

    def count_of(month: str) -> int:
        index = (int(CURRENT[:3]) * 12 + int(CURRENT[4:]) - (int(month[:3]) * 12 + int(month[4:]))) // 12
        return counts[index]

    return count_of
```

(b) 在 `test_birth_gaps_are_listed_and_too_few_compared_months_are_not_compared` 後面新增：

```python
async def test_births_series_lists_the_periods_newest_first(admin_client, db_session, located_campus):
    """每月出生（每期）：2、2、3、3、4、4；111-03 來源查無，那一期 11 個月、增減只比兩期都有的月份。"""
    await _seed(db_session, births=False)
    months = [month for month in series_io.window(CURRENT, 72) if month != "111-03"]
    await _seed_births(db_session, months, _per_period([2, 2, 3, 3, 4, 4]))
    baseline = (await _get(admin_client))["baseline"]
    assert baseline["births_series"] == [
        {"starts": "114-10", "ends": "115-09", "months": 12, "missing": [], "births": 24, "change_pct": 0.0},
        {"starts": "113-10", "ends": "114-09", "months": 12, "missing": [], "births": 24, "change_pct": -33.3},
        {"starts": "112-10", "ends": "113-09", "months": 12, "missing": [], "births": 36, "change_pct": 0.0},
        # 112-03 的前一年同月份是缺月 111-03，只比 11 個月：33 對 44，是 −25.0，不是 36 對 44 的 −18.2。
        {"starts": "111-10", "ends": "112-09", "months": 12, "missing": [], "births": 36, "change_pct": -25.0},
        {"starts": "110-10", "ends": "111-09", "months": 11, "missing": ["111-03"], "births": 44, "change_pct": 0.0},
        # 最舊一期沒有前一期（表裡沒有 108-10 以前）。
        {"starts": "109-10", "ends": "110-09", "months": 12, "missing": [], "births": 48, "change_pct": None},
    ]
    assert (baseline["births_12m"], baseline["births_compared_months"], baseline["births_change_pct"]) == (24, 12, 0.0)


async def test_a_period_with_fewer_than_ten_months_is_not_listed(admin_client, db_session, located_campus):
    """回補到一半：只有 20 個月。第一期湊滿 12 個月；第二期只有 8 個月（< 10）不列；增減只比有前一年同月份的 8 個月。"""
    await _seed(db_session, births=False)
    await _seed_births(db_session, series_io.window(CURRENT, 20), lambda month: 2 if month > YEAR_AGO else 3)
    series = (await _get(admin_client))["baseline"]["births_series"]
    assert series == [
        {"starts": "114-10", "ends": "115-09", "months": 12, "missing": [], "births": 24, "change_pct": -33.3}
    ]


async def test_a_change_needs_twenty_births_in_the_previous_period(admin_client, db_session, located_campus):
    """前一年同月份合計只有 12 位（< 20）：不給百分比（含 baseline），月份數照實寫。"""
    await _seed(db_session, births=False)
    await _seed_births(db_session, series_io.window(CURRENT, 24), lambda month: 2 if month > YEAR_AGO else 1)
    baseline = (await _get(admin_client))["baseline"]
    assert (baseline["births_compared_months"], baseline["births_change_pct"]) == (12, None)
    assert baseline["births_series"][0]["change_pct"] is None


async def test_without_births_the_series_is_empty(admin_client, db_session, located_campus):
    await _seed(db_session, births=False)
    baseline = (await _get(admin_client))["baseline"]
    assert baseline["births_series"] == [] and baseline["births_12m"] is None
```

(c) 既有 `test_baseline_sums_rows_and_compares_births_with_the_same_months` 的期望字典，在 `"births_12m": 24, …` 那行後面加：

```python
        "births_series": [
            {"starts": "114-10", "ends": "115-09", "months": 12, "missing": [], "births": 24, "change_pct": -33.3},
            {"starts": "113-10", "ends": "114-09", "months": 12, "missing": [], "births": 36, "change_pct": None},
        ],
```

- [ ] **Step 2：跑測試確認紅**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_admissions_trends.py
```

預期：上面四個新測試與 (c) 失敗（沒有 `births_series` 欄位）。

- [ ] **Step 3：實作 `schemas.py`**

在 `AreaTrendsBaselineOut` 前面新增（`AreaTrendsMonthsOut` 附近也可，只要在它前面）：

```python
class AreaTrendsBirthPeriodOut(BaseModel):
    """半徑合計每 12 個月一期的出生數（2026-10-14 出生走勢規格 §4.2）。starts／ends 是「114-10」「115-09」；
    months 是這一期有資料的月數、missing 是這一期裡沒有資料的月份（舊到新）；change_pct 和前一期（更舊的）
    只比兩期都有資料的同月份（小數一位），比較的月份不到 6 個、前一期可比的出生不到 20 位、或沒有前一期時 null。"""

    starts: str
    ends: str
    months: int
    missing: list[str]
    births: int
    change_pct: float | None
```

`AreaTrendsBaselineOut` 的 docstring 裡把「比較的月份不到 6 個或前一年是 0 時 null」改成「比較的月份不到 6 個或前一年可比的出生不到 20 位時 null」；欄位在 `births_change_pct` 後面加（**必填，沒有預設值，見計畫裁定 R3**）：

```python
    births_change_pct: float | None
    # 每 12 個月一期，最新一期在前；沒有出生資料或湊不滿 10 個月時是空陣列。
    births_series: list[AreaTrendsBirthPeriodOut]
```

- [ ] **Step 4：實作 `trends.py`**

(a) 常數區（`MIN_COMPARE_MONTHS = 6` 附近）新增：

```python
# 出生走勢（2026-10-14 規格 S3、S5）：最多幾期、一期至少有幾個月的資料才列、前一年可比的出生至少幾位才算增減。
BIRTH_PERIODS = 6
MIN_PERIOD_MONTHS = 10
MIN_CHANGE_BASE = 20
```

(b) 在 `_ends_differ` 前面（模組層）新增兩個函式與一個輔助：

```python
def _birth_total(births: dict[str, dict[str, int]], months: list[str], codes: list[str]) -> int:
    return sum(births[month][code] for month in months for code in codes if code in births.get(month, {}))


def births_change(births: dict[str, dict[str, int]], present: list[str], codes: list[str]) -> tuple[float | None, int]:
    """present（這一段有資料的月份）裡「前一年同月份也有資料」的月份拿來比（只比兩段都有的月份）。
    回傳 (增減百分比, 比較的月份數)；比較的月份不到 6 個、或前一年可比的出生不到 20 位（半徑太小，比例會亂跳）時
    百分比是 None。"""
    compared = [month for month in present if series_io.shift(month, -PERIOD_MONTHS) in births]
    before = _birth_total(births, [series_io.shift(month, -PERIOD_MONTHS) for month in compared], codes)
    now = _birth_total(births, compared, codes)
    if len(compared) < MIN_COMPARE_MONTHS or before < MIN_CHANGE_BASE:
        return None, len(compared)
    return round((now / before - 1) * 100, 1), len(compared)


def birth_series(births: dict[str, dict[str, int]], latest: str, codes: list[str]) -> list[dict[str, Any]]:
    """最新月份往回每 12 個月一期、最多 6 期，最新在前；一期有資料的月份不到 10 個月不列。缺月不估算。"""
    periods: list[dict[str, Any]] = []
    for index in range(BIRTH_PERIODS):
        months = series_io.window(series_io.shift(latest, -PERIOD_MONTHS * index), PERIOD_MONTHS)
        present = [month for month in months if month in births]
        if len(present) < MIN_PERIOD_MONTHS:
            continue
        change, _ = births_change(births, present, codes)
        periods.append(
            {
                "starts": months[0],
                "ends": months[-1],
                "months": len(present),
                "missing": [month for month in months if month not in births],
                "births": _birth_total(births, present, codes),
                "change_pct": change,
            }
        )
    return periods
```

(c) `query_trends` 裡：
- 刪掉 `births_previous = [series_io.shift(month, -PERIOD_MONTHS) for month in births_window]` 這一行。
- `_load(...)` 的 `births_months=sorted({*births_window, *births_previous})` 改成：
  `births_months=series_io.window(births_latest, series_io.BIRTHS.keep_months) if births_latest else [],`
- 把 `all_codes = …` 後面那一整段（`compared = [ … ]`、`births_now`、`births_before`、`change = (…)`）換成：

```python
    all_codes = [code for row in villages for code in row["codes"]]
    change, compared_months = births_change(data.births, births_present, all_codes)
```

- `result["baseline"]` 裡把兩行換掉並多一行：

```python
        "births_compared_months": compared_months,
        "births_change_pct": change,
        "births_series": birth_series(data.births, births_latest, all_codes) if births_latest else [],
```

（`births_months`、`births_12m` 等其他欄位照舊。）

- [ ] **Step 5：跑測試確認綠**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_admissions_trends.py
```

預期全部通過。若別的既有案例有「整個 `baseline` 字典相等」的斷言（例如 `test_nothing_imported`），加上 `"births_series": []`；改了哪幾個寫進回報。

- [ ] **Step 6：重新產生契約並檢查**

```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && source ~/.nvm/nvm.sh; npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts
cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
git diff --stat contracts/
```

預期：兩個檢查都印「一致」；diff 只有 `AreaTrendsBirthPeriodOut` 與 `AreaTrendsBaselineOut.births_series`（以及 `births_change_pct` 的說明文字）。

- [ ] **Step 7：Commit**

```bash
git add backend/app/admissions/trends.py backend/app/admissions/schemas.py backend/tests/test_admissions_trends.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(trends): /area/trends 回傳本校半徑每 12 個月一期的出生數

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4：「近幾年的出生數」畫面

**Files:**
- Create: `admin/src/components/admissions/area/birthSeriesFormat.ts`、`admin/src/components/admissions/area/BirthSeries.vue`
- Modify: `admin/src/api/types.ts`、`admin/src/components/admissions/area/areaFormat.ts`、`admin/src/components/admissions/area/VillageTrendsPanel.vue`
- Test: `admin/src/__tests__/birthSeriesFormat.test.ts`（新）、`admin/src/__tests__/birthSeries.test.ts`（新）、`admin/src/__tests__/areaTab.test.ts`、`admin/src/__tests__/admissionsTestKit.ts`

**Interfaces:**
- Consumes（Task 3）：`components['schemas']['AreaTrendsBirthPeriodOut']`、`AreaTrends['baseline']['births_series']`。
- Produces：`AreaTrendsBirthPeriod` 型別（`api/types.ts`）；`birthSeriesFormat.ts` 匯出 `BIRTH_SERIES_NOTE`、`birthPeriodLabel(period)`、`birthMissingText(period)`、`birthChangeText(pct)`、`birthSeriesRows(periods)`、`birthSeriesCsv(periods)`、`BirthSeriesRow`；`BirthSeries.vue` props：`periods`、`radiusKm`、`csvName`（完整檔名）。

- [ ] **Step 1：型別與 `signedPercent` 匯出**

`admin/src/api/types.ts` 在 `AreaTrendsVillage` 那一組匯出旁邊新增：

```ts
export type AreaTrendsBirthPeriod = components['schemas']['AreaTrendsBirthPeriodOut']
```

`admin/src/components/admissions/area/areaFormat.ts`：把 `function signedPercent(value: number): string {` 改成 `export function signedPercent(value: number): string {`（其他不動）。

- [ ] **Step 2：測試資料（`admissionsTestKit.ts`）**

`buildAreaTrends` 的 `baseline` 在 `births_change_pct: -20.7,` 後面加：

```ts
    births_series: [
      { starts: '114-10', ends: '115-09', months: 12, missing: [], births: 180, change_pct: -20.7 },
      { starts: '113-10', ends: '114-09', months: 12, missing: [], births: 227, change_pct: -5.2 },
      { starts: '112-10', ends: '113-09', months: 11, missing: ['113-03'], births: 215, change_pct: null },
    ],
```

- [ ] **Step 3：寫格式函式測試（先紅）**

新檔 `admin/src/__tests__/birthSeriesFormat.test.ts`：

```ts
// 近幾年的出生數（2026-10-14 出生走勢規格 §4.3）：期間標籤、缺月、增減、CSV 列。
import { describe, expect, it } from 'vitest'
import type { AreaTrendsBirthPeriod } from '../api/types'
import {
  birthChangeText, birthMissingText, birthPeriodLabel, birthSeriesCsv, birthSeriesRows,
} from '../components/admissions/area/birthSeriesFormat'

const period = (changes: Partial<AreaTrendsBirthPeriod> = {}): AreaTrendsBirthPeriod => ({
  starts: '114-10', ends: '115-09', months: 12, missing: [], births: 10929, change_pct: -19, ...changes,
})

describe('birthSeriesFormat', () => {
  it('期間標籤：跨年也寫完整年月', () => {
    expect(birthPeriodLabel(period())).toBe('114 年 10 月～115 年 9 月')
    expect(birthPeriodLabel(period({ starts: '109-10', ends: '110-09' }))).toBe('109 年 10 月～110 年 9 月')
  })

  it('缺月：寫出缺的月份；沒有缺月是空字串', () => {
    expect(birthMissingText(period())).toBe('')
    expect(birthMissingText(period({ missing: ['111-03'] }))).toBe('缺 111 年 3 月')
    expect(birthMissingText(period({ missing: ['113-10', '113-11'] }))).toBe('缺 113 年 10 月、113 年 11 月')
  })

  it('增減：有正負號、小數一位；算不出來寫「—」', () => {
    expect(birthChangeText(-19)).toBe('−19.0%')
    expect(birthChangeText(12.34)).toBe('+12.3%')
    expect(birthChangeText(0)).toBe('0.0%')
    expect(birthChangeText(null)).toBe('—')
  })

  it('列：最新在前（照後端順序），出生數加千分位', () => {
    const rows = birthSeriesRows([period(), period({ starts: '113-10', ends: '114-09', births: 13497, change_pct: null, missing: ['113-11'], months: 11 })])
    expect(rows).toEqual([
      { key: '115-09', label: '114 年 10 月～115 年 9 月', missing_text: '', births: 10929, births_text: '10,929', change_text: '−19.0%' },
      { key: '114-09', label: '113 年 10 月～114 年 9 月', missing_text: '缺 113 年 11 月', births: 13497, births_text: '13,497', change_text: '—' },
    ])
  })

  it('CSV：期間起訖用文字（不會被試算表當日期）、缺月用頓號、增減寫數字沒有值寫空白', () => {
    const { header, rows } = birthSeriesCsv([period({ missing: ['111-03', '111-04'], months: 10 }), period({ change_pct: null })])
    expect(header).toEqual(['期間起', '期間迄', '有資料月數', '缺的月份', '出生數', '和前一期增減（%）'])
    expect(rows).toEqual([
      ['114 年 10 月', '115 年 9 月', 10, '111 年 3 月、111 年 4 月', 10929, -19],
      ['114 年 10 月', '115 年 9 月', 12, '', 10929, ''],
    ])
  })
})
```

- [ ] **Step 4：寫元件測試（先紅）**

新檔 `admin/src/__tests__/birthSeries.test.ts`：

```ts
// 「近幾年的出生數」區塊：一期一列、缺月與增減寫出來、長條以最大值為 100%、空資料不顯示、匯出 CSV。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import BirthSeries from '../components/admissions/area/BirthSeries.vue'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))

afterEach(() => vi.mocked(downloadCsv).mockClear())

const periods = [
  { starts: '114-10', ends: '115-09', months: 12, missing: [], births: 100, change_pct: -20 },
  { starts: '113-10', ends: '114-09', months: 11, missing: ['113-11'], births: 125, change_pct: null },
]
const mountIt = (props: Record<string, unknown> = {}) =>
  mount(BirthSeries, { props: { periods, radiusKm: 3, csvName: '招生統計-近幾年的出生數.csv', ...props }, global: { plugins: [ElementPlus] } })

describe('BirthSeries', () => {
  it('標題寫半徑；一期一列：期間、缺月小字、出生數、和前一期', () => {
    const wrapper = mountIt()
    expect(wrapper.get('.birth-series__title').text()).toBe('近幾年的出生數（本校 3 公里內）')
    const rows = wrapper.findAll('.birth-series__row:not(.birth-series__row--head)')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.get('.birth-series__label').text()).toBe('114 年 10 月～115 年 9 月')
    expect(rows[0]!.find('.birth-series__missing').exists()).toBe(false)
    expect(rows[0]!.get('.birth-series__number').text()).toBe('100')
    expect(rows[0]!.get('.birth-series__change').text()).toBe('−20.0%')
    expect(rows[1]!.get('.birth-series__missing').text()).toBe('缺 113 年 11 月')
    expect(rows[1]!.get('.birth-series__change').text()).toBe('—')
    wrapper.unmount()
  })

  it('長條以最大值為 100%（長條只是輔助，數字一定寫出來）', () => {
    const wrapper = mountIt()
    const widths = wrapper.findAll('.birth-series__fill').map((fill) => (fill.element as HTMLElement).style.width)
    expect(widths).toEqual(['80%', '100%'])
    wrapper.unmount()
  })

  it('用 ARIA table 結構；不是 <table>（避免和「里的變化」表的選擇器互相干擾）', () => {
    const wrapper = mountIt()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[role="table"]').attributes('aria-label')).toBe('近幾年的出生數（本校 3 公里內）')
    expect(wrapper.findAll('[role="columnheader"]').map((cell) => cell.text())).toEqual(['期間', '出生數', '和前一期'])
    wrapper.unmount()
  })

  it('只有一期照列、和前一期寫「—」；沒有資料整塊不顯示', () => {
    const single = mountIt({ periods: [periods[1]] })
    expect(single.findAll('.birth-series__row:not(.birth-series__row--head)')).toHaveLength(1)
    single.unmount()
    const empty = mountIt({ periods: [] })
    expect(empty.find('.birth-series').exists()).toBe(false)
    empty.unmount()
  })

  it('匯出 CSV：檔名由呼叫端給，欄名與數字同 birthSeriesCsv', async () => {
    const wrapper = mountIt()
    await wrapper.get('[data-test="birth-series-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-近幾年的出生數.csv')
    expect(csv.slice(1).split('\r\n')).toEqual([
      '期間起,期間迄,有資料月數,缺的月份,出生數,和前一期增減（%）',
      '114 年 10 月,115 年 9 月,12,,100,-20',
      '113 年 10 月,114 年 9 月,11,113 年 11 月,125,',
      '',
    ])
    wrapper.unmount()
  })
})
```

- [ ] **Step 5：寫 `areaTab` 整合案例（先紅）**

`admin/src/__tests__/areaTab.test.ts` 的 `describe('里的變化' …)` 裡、「表格：淨增最多的在前…」案例後面新增：

```ts
  it('近幾年的出生數：在總結句下面、里表上面；一期一列，缺月與增減寫出來；里表的表頭與列不變', async () => {
    const { wrapper } = await mountTab()
    const section = block(wrapper, TITLE)
    const series = section.get('.birth-series')
    expect(series.get('.birth-series__title').text()).toBe('近幾年的出生數（本校 3 公里內）')
    const rows = series.findAll('.birth-series__row:not(.birth-series__row--head)')
    expect(rows.map((row) => [row.get('.birth-series__label').text(), row.get('.birth-series__number').text(), row.get('.birth-series__change').text()])).toEqual([
      ['114 年 10 月～115 年 9 月', '180', '−20.7%'],
      ['113 年 10 月～114 年 9 月', '227', '−5.2%'],
      ['112 年 10 月～113 年 9 月', '215', '—'],
    ])
    expect(rows[2]!.get('.birth-series__missing').text()).toBe('缺 113 年 3 月')
    // 順序：總結句 → 近幾年的出生數 → 里表；而且新區塊沒有 <table>，原表頭與列不受影響。
    const html = section.html()
    expect(html.indexOf('trends-summary')).toBeLessThan(html.indexOf('birth-series'))
    expect(html.indexOf('birth-series')).toBeLessThan(html.indexOf('<table'))
    expect(series.find('table').exists()).toBe(false)
    expect(section.findAll('thead th')).toHaveLength(10)
  })

  it('沒有出生走勢（空陣列）時不顯示這一塊', async () => {
    const base = areaTrends()
    const { wrapper } = await mountTrends(areaTrends({ baseline: { ...base.baseline!, births_series: [] } }))
    expect(block(wrapper, TITLE).find('.birth-series').exists()).toBe(false)
  })
```

- [ ] **Step 6：跑測試確認紅**

```bash
cd admin && source ~/.nvm/nvm.sh; nvm use 22; npx vitest run src/__tests__/birthSeriesFormat.test.ts
```

預期：找不到模組 `birthSeriesFormat`。（`birthSeries.test.ts`、`areaTab.test.ts` 在 Step 7 之後才跑。）

- [ ] **Step 7：實作格式函式**

新檔 `admin/src/components/admissions/area/birthSeriesFormat.ts`：

```ts
import type { AreaTrendsBirthPeriod } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import type { CsvCell } from '../../../utils/csv'
import { formatCount, populationVersionLabel, signedPercent } from './areaFormat'

// 近幾年的出生數（2026-10-14 出生走勢規格 §4.3）：本校半徑每 12 個月一期的出生數。只呈現後端算好的數字，
// 不另外推估；缺月寫出來，不補值。

export const BIRTH_SERIES_NOTE = '每 12 個月一期，加總本校半徑內各里的出生數；出生依出生登記的戶籍里。資料來源：內政部戶政司。'

export interface BirthSeriesRow {
  key: string
  label: string
  missing_text: string
  births: number
  births_text: string
  change_text: string
}

/** 「114 年 10 月～115 年 9 月」。 */
export function birthPeriodLabel(period: Pick<AreaTrendsBirthPeriod, 'starts' | 'ends'>): string {
  return `${populationVersionLabel(period.starts)}～${populationVersionLabel(period.ends)}`
}

/** 「缺 111 年 3 月」；沒有缺月是空字串。 */
export function birthMissingText(period: Pick<AreaTrendsBirthPeriod, 'missing'>): string {
  return period.missing.length ? `缺 ${period.missing.map(populationVersionLabel).join('、')}` : ''
}

/** 和前一期的增減：「−19.0%」「+12.3%」；算不出來寫「—」。 */
export function birthChangeText(pct: number | null): string {
  return pct === null ? NO_VALUE : signedPercent(pct)
}

export function birthSeriesRows(periods: readonly AreaTrendsBirthPeriod[]): BirthSeriesRow[] {
  return periods.map((period) => ({
    key: period.ends,
    label: birthPeriodLabel(period),
    missing_text: birthMissingText(period),
    births: period.births,
    births_text: formatCount(period.births),
    change_text: birthChangeText(period.change_pct),
  }))
}

/** CSV：期間起訖寫文字（「114 年 10 月」，試算表不會當日期轉）、缺的月份用頓號、增減寫數字（沒有值寫空白）。 */
export function birthSeriesCsv(periods: readonly AreaTrendsBirthPeriod[]): { header: string[]; rows: CsvCell[][] } {
  return {
    header: ['期間起', '期間迄', '有資料月數', '缺的月份', '出生數', '和前一期增減（%）'],
    rows: periods.map((period) => [
      populationVersionLabel(period.starts),
      populationVersionLabel(period.ends),
      period.months,
      period.missing.map(populationVersionLabel).join('、'),
      period.births,
      period.change_pct ?? '',
    ]),
  }
}
```

- [ ] **Step 8：實作元件**

新檔 `admin/src/components/admissions/area/BirthSeries.vue`：

```vue
<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AreaTrendsBirthPeriod } from '../../../api/types'
import { barWidth } from '../../../admissions/statsFormat'
import { notifyError } from '../../../composables/notify'
import { buildCsv, downloadCsv } from '../../../utils/csv'
import { BIRTH_SERIES_NOTE, birthSeriesCsv, birthSeriesRows } from './birthSeriesFormat'

// 近幾年的出生數（2026-10-14 出生走勢規格 §4.3）：放在「里的變化」總結句下面、里表上面。長條只是輔助，
// 數字一定寫出來；最新一期在最上面。用自己的 ARIA table 而不是第二個 StatsDimensionTable：巢狀的
// 表會讓外層「里的變化」表的 thead／tbody 選擇器選到兩張表（計畫裁定 R1）。
const props = defineProps<{
  periods: readonly AreaTrendsBirthPeriod[]
  radiusKm: number
  /** 匯出 CSV 的完整檔名（呼叫端用 csvName('近幾年的出生數') 組）。 */
  csvName: string
}>()

const headingId = useId()
const title = computed(() => `近幾年的出生數（本校 ${props.radiusKm} 公里內）`)
const rows = computed(() => birthSeriesRows(props.periods))
const max = computed(() => Math.max(0, ...rows.value.map((row) => row.births)))

function exportCsv() {
  const { header, rows: lines } = birthSeriesCsv(props.periods)
  try {
    downloadCsv(props.csvName, buildCsv(header, lines))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
}
</script>

<template>
  <section v-if="rows.length" class="birth-series" :aria-labelledby="headingId">
    <div class="birth-series__head">
      <h4 :id="headingId" class="birth-series__title">{{ title }}</h4>
      <el-button size="small" text data-test="birth-series-csv" :aria-label="`把「${title}」匯出 CSV`" @click="exportCsv">
        匯出 CSV
      </el-button>
    </div>
    <div class="birth-series__table" role="table" :aria-label="title">
      <div class="birth-series__row birth-series__row--head" role="row">
        <span role="columnheader">期間</span>
        <span role="columnheader">出生數</span>
        <span role="columnheader">和前一期</span>
      </div>
      <div v-for="row in rows" :key="row.key" class="birth-series__row" role="row">
        <span role="rowheader" class="birth-series__period">
          <span class="birth-series__label">{{ row.label }}</span>
          <small v-if="row.missing_text" class="birth-series__missing">{{ row.missing_text }}</small>
        </span>
        <span role="cell" class="birth-series__figure">
          <span class="birth-series__bar" aria-hidden="true">
            <span class="birth-series__fill" :style="{ width: barWidth(row.births, max) }" />
          </span>
          <span class="birth-series__number">{{ row.births_text }}</span>
        </span>
        <span role="cell" class="birth-series__change">{{ row.change_text }}</span>
      </div>
    </div>
    <p class="hint birth-series__note">{{ BIRTH_SERIES_NOTE }}</p>
  </section>
</template>

<style scoped>
.birth-series {
  min-width: 0;
  margin: 4px 0 12px;
}

.birth-series__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.birth-series__title {
  margin: 0 0 8px;
  font-size: var(--text-base);
  font-weight: 600;
}

.birth-series__table {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.birth-series__row {
  display: grid;
  grid-template-columns: minmax(170px, 1.6fr) minmax(150px, 1.2fr) minmax(72px, auto);
  gap: 4px 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-size: var(--text-base);
}

.birth-series__row:last-child {
  border-bottom: 0;
}

.birth-series__row--head {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.birth-series__missing {
  display: block;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.birth-series__figure {
  white-space: nowrap;
}

.birth-series__bar {
  display: inline-block;
  width: 72px;
  height: 6px;
  margin-right: 8px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
  vertical-align: middle;
}

.birth-series__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

.birth-series__number,
.birth-series__change {
  font-variant-numeric: tabular-nums;
}

.birth-series__change {
  text-align: right;
}

.birth-series__note {
  margin: 6px 0 0;
}

@media (max-width: 720px) {
  .birth-series__row {
    grid-template-columns: minmax(0, 1fr) auto auto;
    padding: 8px 10px;
  }

  .birth-series__bar {
    width: 40px;
  }
}
</style>
```

- [ ] **Step 9：掛進 `VillageTrendsPanel.vue`**

`<script setup>` 加 import 與兩個 computed：

```ts
import BirthSeries from './BirthSeries.vue'
```

```ts
const birthPeriods = computed(() => props.data?.baseline?.births_series ?? [])
const radiusKm = computed(() => props.data?.radius_km ?? 3)
```

`<template #intro>` 在總結 `div` 後面加：

```vue
      <BirthSeries
        v-if="!unavailable && birthPeriods.length"
        :periods="birthPeriods"
        :radius-km="radiusKm"
        :csv-name="csvName('近幾年的出生數')"
      />
```

- [ ] **Step 10：跑測試與 typecheck**

```bash
cd admin && source ~/.nvm/nvm.sh; nvm use 22; npx vitest run src/__tests__/birthSeriesFormat.test.ts; npx vitest run src/__tests__/birthSeries.test.ts; npx vitest run src/__tests__/areaTab.test.ts; npx vitest run src/__tests__/areaFormat.test.ts; npm run typecheck
```

預期：全部通過、typecheck 無錯誤。`areaTab.test.ts` 若逾時（5000ms）改加 `--testTimeout=60000` 重跑，並在回報寫明。

- [ ] **Step 11：Commit**

```bash
git add admin/src/api/types.ts admin/src/components/admissions/area/areaFormat.ts admin/src/components/admissions/area/birthSeriesFormat.ts admin/src/components/admissions/area/BirthSeries.vue admin/src/components/admissions/area/VillageTrendsPanel.vue admin/src/__tests__/birthSeriesFormat.test.ts admin/src/__tests__/birthSeries.test.ts admin/src/__tests__/areaTab.test.ts admin/src/__tests__/admissionsTestKit.ts
git commit -m "feat(admin): 里的變化多一塊「近幾年的出生數」

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5：stack e2e（真實資料庫＋瀏覽器）

**Files:**
- Modify: `tests/stack/db.ts`、`tests/stack/admissions-area.spec.ts`

**Interfaces:**
- Consumes（Task 3、4）：`/area/trends` 的 `births_series`、DOM class `.birth-series`、`.birth-series__row`、`.birth-series__label`、`.birth-series__missing`、`.birth-series__change`。
- Produces：`db.ts` 匯出 `seedBirthSeries(): void`（idempotent）。

- [ ] **Step 1：`tests/stack/db.ts` 新增種子函式**

在檔尾新增：

```ts
// 每個里每月出生數，從最新一期往回：2、2、3、3、4、4（出生走勢 e2e，2026-10-14）。
const BIRTH_PERIOD_COUNTS = [2, 2, 3, 3, 4, 4]

function birthSeriesMonths(): { month: string; perVillage: number }[] {
  const months: { month: string; perVillage: number }[] = []
  for (let period = 0; period < BIRTH_PERIOD_COUNTS.length; period++) {
    for (let offset = 0; offset < 12; offset++) {
      // 115-09 往回第 (period × 12 + offset) 個月。
      const total = 115 * 12 + 9 - 1 - (period * 12 + offset)
      const month = `${String(Math.floor(total / 12)).padStart(3, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
      if (month === '111-03') continue // 來源兩個資料集都查無的月份：留成缺月
      months.push({ month, perVillage: BIRTH_PERIOD_COUNTS[period]! })
    }
  }
  return months
}

/**
 * 近幾年的出生數（2026-10-14）：stack 啟動時只匯入各里人口，沒有出生歷史；要看有內容的畫面只能直接寫測試庫。
 * 每個里（沿用已匯入的 893 里）寫 71 個月（109-10 到 115-09，缺 111-03）、每月 2／2／3／3／4／4 位（每期一個數字，
 * 從最新往回），並寫出生的狀態列（最新月份 115-09）。重複執行不會重複。
 */
export function seedBirthSeries(): void {
  const values = birthSeriesMonths()
    .map(({ month, perVillage }) => `('${month}', ${perVillage})`)
    .join(', ')
  psql(
    `INSERT INTO geo_village_births (month, village_code, district, village, births)
     SELECT m.month, p.village_code, p.district, p.village, m.per_village
       FROM geo_village_population AS p CROSS JOIN (VALUES ${values}) AS m(month, per_village)
     ON CONFLICT (month, village_code) DO NOTHING;
     INSERT INTO geo_dataset_status (dataset, active_version, label, synced_at, checked_at)
     VALUES ('births', '115-09', '115-09', now(), now())
     ON CONFLICT (dataset) DO UPDATE SET active_version = '115-09', label = '115-09';`,
    {},
  )
}
```

- [ ] **Step 2：`tests/stack/admissions-area.spec.ts`**

(a) import 改成 `import { seedBirthSeries, seedProviderChanges } from './db'`。

(b) 在「`390px：托嬰中心清單與園所變化不撐出頁面`」案例後面新增兩個案例：

```ts
test('近幾年的出生數：6 期、缺月註明、增減只比兩期都有的月份', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  seedBirthSeries()
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)

  const series = page.locator('.birth-series')
  await test.step('標題與 6 期（最新在前）', async () => {
    await expect(series.locator('.birth-series__title')).toHaveText('近幾年的出生數（本校 3 公里內）')
    const rows = series.locator('.birth-series__row:not(.birth-series__row--head)')
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0).locator('.birth-series__label')).toHaveText('114 年 10 月～115 年 9 月')
    await expect(rows.nth(5).locator('.birth-series__label')).toHaveText('109 年 10 月～110 年 9 月')
  })

  await test.step('111-03 缺月：那一期寫「缺 111 年 3 月」，增減只比兩期都有的月份', async () => {
    const rows = series.locator('.birth-series__row:not(.birth-series__row--head)')
    await expect(rows.nth(4).locator('.birth-series__label')).toHaveText('110 年 10 月～111 年 9 月')
    await expect(rows.nth(4).locator('.birth-series__missing')).toHaveText('缺 111 年 3 月')
    // 每個里每月出生數 2、2、3、3、4、4：0%、−33.3%、0%、−25.0%（缺月那一年比 11 個月）、0%、最舊一期沒有前一期。
    await expect(rows.locator('.birth-series__change')).toHaveText(['0.0%', '−33.3%', '0.0%', '−25.0%', '0.0%', '—'])
  })

  await test.step('位置：在「里的變化」區塊內、總結句下面、里表上面', async () => {
    const block = page.locator('.stats-block', { has: page.locator('.stats-block__title', { hasText: '里的變化（本校 3 公里內）' }) }).first()
    const order = await block.evaluate((element) => {
      const children = [...element.querySelectorAll('.trends-summary, .birth-series, table.stats-table')]
      return children.map((child) => (child.matches('.trends-summary') ? 'summary' : child.matches('.birth-series') ? 'series' : 'table'))
    })
    expect(order.indexOf('summary')).toBeLessThan(order.indexOf('series'))
    expect(order.indexOf('series')).toBeLessThan(order.indexOf('table'))
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.birth-series').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await expectNoHorizontalOverflow(page)
  await series.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, 'admissions-birth-series-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：近幾年的出生數不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  seedBirthSeries()
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await expect(page.locator('.birth-series')).toBeVisible()
  await expect(page.locator('.birth-series__row:not(.birth-series__row--head)')).toHaveCount(6)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-birth-series-390.png'), fullPage: true })
  await context.close()
})
```

- [ ] **Step 3：build 並跑這兩個案例（背景，主 session 看結果）**

```bash
cd ~/Repositories/ivy-website-wt/birth-series-20261014 && source ~/.nvm/nvm.sh; nvm use 22
export E2E_DB_NAME=ivy_website_birthseries1014_e2e_test E2E_API_PORT=8743 E2E_WEB_PORT=3743
npm run e2e:build
npx playwright test -c playwright.stack.config.ts --workers=1 tests/stack/admissions-area.spec.ts -g "近幾年的出生數"
```

預期：2 個案例通過（外加 setup）。再人工看 `output/playwright/admissions-birth-series-1440.png`、`-390.png`：區塊在總結句與里表之間、缺月小字在期間下面、手機沒有橫向溢出。若 `.birth-series__change` 的文字斷言因負號字元不同而失敗，先確認顯示的是 U+2212。

- [ ] **Step 4：Commit**

```bash
git add tests/stack/db.ts tests/stack/admissions-area.spec.ts
git commit -m "test(e2e): 近幾年的出生數（6 期、缺月、位置、無障礙、手機不溢出）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6：文件與規格對齊

**Files:**
- Modify: `deploy/README.md`、`DESIGN.md`、`README.md`、`backend/app/admissions/geo_data/README.md`、`docs/specs/2026-10-14-birth-series-design.md`

**Interfaces:** 無（只改文件）。歷史紀錄（有日期的部署紀錄、舊的 README 日期段落）寫的是當時的事實，**不要改**；只改操作說明與設計說明。

- [ ] **Step 1：操作文件裡的 ODRP010 改 ODRP061，並補 72 個月與回補規則**

```bash
python3 -I - <<'EOF'
from pathlib import Path


def edit(path, old, new):
    p = Path(path)
    s = p.read_text(encoding="utf-8")
    assert s.count(old) == 1, (path, old[:40], s.count(old))
    p.write_text(s.replace(old, new), encoding="utf-8")


# 里界檔說明
edit(
    "backend/app/admissions/geo_data/README.md",
    "各里出生（ODRP010）、遷入遷出（ODRP011）",
    "各里出生（ODRP061，2026-10-14 起取代 ODRP010）、遷入遷出（ODRP011）",
)

# 部署操作說明（「各里出生、遷入遷出與一年前的年齡」那一段；有日期的部署紀錄不動）
edit(
    "deploy/README.md",
    "內政部戶政司 ODRP010（各里出生）、ODRP011（遷入遷出），網址同 ODRP014，只把代碼換掉；帶 `COUNTY=高雄市` 一個月一頁（約 220 KB、1.2 MB）。寫進 `geo_village_births`、`geo_village_migration`，各留最新月份往回 25 個月（約 2.2 萬列）。",
    "內政部戶政司 ODRP061（各里出生；2026-10-14 起取代 ODRP010：逐里數字相同、含 ODRP010 缺的月份、109-09 起連續）、ODRP011（遷入遷出），網址同 ODRP014，只把代碼換掉；帶 `COUNTY=高雄市` 一個月一頁（約 1.15 MB、1.2 MB）。寫進 `geo_village_births`（留最新月份往回 72 個月，約 6.4 萬列，給「近幾年的出生數」）、`geo_village_migration`（25 個月，約 2.2 萬列）。",
)
edit(
    "deploy/README.md",
    "整輪做完才記確認時間，之後 30 天看一次。",
    "整輪做完才記確認時間，之後 30 天看一次。出生表的視窗是 72 個月：表裡最舊月份比視窗起點晚 2 個月以上（例如部署前只有 25 個月）就算到期，不管確認時間，隔天接著補，補到頭才回到 30 天一次（約 50 個請求、5～8 分鐘、約 55 MB；111-03 兩個資料集都查無，是永久缺月，畫面寫「缺 111 年 3 月」）。",
)
edit(
    "deploy/README.md",
    "（出生目前 21 個月有資料）",
    "（補完後預期 71 個月：109-10 到最新月份，缺 111-03；`select min(month), max(month) from geo_village_births;`）",
)
edit(
    "deploy/README.md",
    "（不需要資料庫與環境變數，約 3 分鐘；2026-10-14 實測 48 個檔、2.4 MB）",
    "（不需要資料庫與環境變數；出生抓 72 個月後約 106 個檔，時間與 zip 大小打包時量，2026-10-14 A 段實測 48 個檔、2.4 MB 是出生 25 個月的版本）",
)

# DESIGN.md：里的變化那一節的資料說明
edit(
    "DESIGN.md",
    "- **資料**：內政部戶政司 ODRP010（各里出生）、ODRP011（遷入遷出），存最新月份往回 25 個月；",
    "- **資料**：內政部戶政司 ODRP061（各里出生；2026-10-14 起取代 ODRP010）、ODRP011（遷入遷出），出生存最新月份往回 72 個月、遷入遷出 25 個月；",
)
print("ok")
EOF
```

- [ ] **Step 2：DESIGN.md 新增一節**

在「招生入學：里的變化」那一節（`## 招生入學：里的變化（2026-10-14…`）的結尾後面、下一個 `## ` 之前，插入：

```markdown
## 招生入學：多年出生數走勢（2026-10-14，`feature/birth-series-20261014`）

招生判讀第三個子專案（商圈出生趨勢）。「里的變化」A 段已有近 12 個月出生與前一年同月份比；這次補兩件事：前一年同月份比滿 12 個月、看得到 5～6 年的走勢。規格 `docs/specs/2026-10-14-birth-series-design.md`。

- **資料**：出生改抓 ODRP061（取代 ODRP010）。實測 114-12 兩個資料集 890 個里逐里相同；ODRP061 含 ODRP010 缺的 113-10、113-11、114-01，109-09 起連續；111-03 兩個都查無（永久缺月）。出生表留 72 個月（109-10 到 115-09，6 個完整的 12 個月期），其他表維持 25 個月；不新增 migration。
- **走勢**：只在本校半徑合計、每 12 個月一期、最多 6 期；一期有資料的月份不到 10 個月不列；和前一期只比兩期都有的同月份，可比不到 6 個月或前一期可比出生不到 20 位不算增減。缺月不估算，寫在該期。
- **畫面**：「里的變化」區塊內、總結句下面、里表上面；用自己的 ARIA table 加 CSS 長條（不嵌套第二個 `StatsDimensionTable`，會讓外層表的選擇器選到兩張表）；缺月淡色小字；可匯出 CSV。
- **回補**：出生視窗從 25 拉到 72 個月，部署後表裡最舊月份比視窗起點晚 2 個月以上就算到期、隔天續補，補到頭才回到 30 天；起點那個月來源查無時不會天天重試。
- **限制**：里界合併仍只看最新 12 個月視窗的頭尾，更早廢止的里（2021～22 年間 1 個）在較早幾期不算進半徑，約少 0.1%；「整組相加」會讓合併組比實際略多；出生數依出生登記的戶籍里，不是孩子實際居住的里。
- **不做**：預測（兩年後幼幼班有幾位）、里層級走勢、依性別拆開、估算缺月、更早的年份（ODRP003／012 格式不同）、公開官網顯示。
```

- [ ] **Step 3：README.md 頂部加日期段落**

在 `README.md` 最上方（第一個 `## 2026-10-14 …` 之前）插入（驗證條由 Task 7 回填）：

```markdown
## 2026-10-14 多年出生數走勢（`feature/birth-series-20261014`）

招生判讀四個子專案的第三個。「商圈出生趨勢」的主體（近 12 個月出生、前一年同月份比）早已在「里的變化」A 段上線，這次補它缺的兩件事。規格 `docs/specs/2026-10-14-birth-series-design.md`，規則見 DESIGN.md「招生入學：多年出生數走勢」。

- **補缺月**：出生改抓戶政 ODRP061（取代 ODRP010，逐里數字相同），補上 113-10、113-11、114-01，前一年同月份比滿 12 個月。111-03 兩個資料集都查無，永久缺月。
- **多年走勢**：區域分析「里的變化」多一塊「近幾年的出生數」：本校半徑每 12 個月一期、最多 6 期（109-10 起），每期出生數與和前一期的增減（只比兩期都有的月份），缺月寫出來；只描述、不預測。
- **同步**：出生表留 72 個月（其餘 25 個月）；部署後回補約 50 個請求（5～8 分鐘），沒到頭隔天續補。沒有 migration。
- **小半徑**：前一期可比出生不到 20 位不給百分比，所以 1 公里半徑原本顯示的「比前一年同期少 N%」可能變成不顯示；3 公里不受影響。
- **不做**：預測、里層級走勢、依性別拆開、估算缺月、更早的年份、公開官網顯示。
```

- [ ] **Step 4：規格對齊實作**

編輯 `docs/specs/2026-10-14-birth-series-design.md`：

(a) §1.2 表 S9 的「理由」欄與 §4.3 第一個項目符號：把「表格＋CSS 橫向長條（`StatsDimensionTable` 的長條欄）」改成「用自己的 ARIA table 加同樣式的 CSS 長條（不嵌套第二個 `StatsDimensionTable`，會讓外層「里的變化」表的 `thead`、`tbody` 選擇器選到兩張表；計畫裁定 R1）」；S9 的理由欄「沿用 `StatsDimensionTable` 長條欄」改成「長條樣式同 `StatsDimensionTable`」。

(b) 檔尾新增：

```markdown
## 9. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-14-birth-series.md`，分支 `feature/birth-series-20261014`。
- 與規格的差異：`BirthSeries.vue` 用自己的 ARIA table，不是 `StatsDimensionTable`（§4.3，計畫裁定 R1）；`births_series` 在 pydantic 是必填欄位（R3）；到期規則寫成 `min(months) > shift(start, 1)`（R2，等價於「晚 2 個月以上」）。
```

- [ ] **Step 5：檢查並 Commit**

```bash
grep -rn "ODRP010" deploy/README.md DESIGN.md backend/app | head -20
```

預期：剩下的都是有日期的部署紀錄／歷史說明（例如「取代 ODRP010」「ODRP010 缺 113-10」），沒有把 ODRP010 當現行來源的敘述。

```bash
git add deploy/README.md DESIGN.md README.md backend/app/admissions/geo_data/README.md docs/specs/2026-10-14-birth-series-design.md
git commit -m "docs: 多年出生數走勢（ODRP061、72 個月、回補規則、畫面）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7：全套驗證（控制者在背景分開跑，不交給子代理）

- [ ] **Step 1：後端全套**（約 20 分鐘；背景；log 放 scratchpad；一次只跑這一組）

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_birthseries1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider
```

預期：0 failed。

- [ ] **Step 2：admin 全套、typecheck、契約**

```bash
cd admin && source ~/.nvm/nvm.sh; nvm use 22; npx vitest run
npm run typecheck; (cd ../web && npm run typecheck)
cd ../backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
```

預期：全部通過（高負載下 5000ms 逾時的檔改 `--testTimeout=60000` 重跑，並在回報寫明）。

- [ ] **Step 3：stack 全套**（背景）

```bash
export E2E_DB_NAME=ivy_website_birthseries1014_e2e_test E2E_API_PORT=8743 E2E_WEB_PORT=3743
npm run e2e:build && npx playwright test -c playwright.stack.config.ts
```

預期：0 failed（高負載逾時的案例單獨重跑確認，並如實寫在紀錄）。人工看截圖 `output/playwright/admissions-birth-series-1440.png`、`-390.png`。

- [ ] **Step 4：回填 README 驗證條，再對一次 `origin/main`**

在 `README.md` 本案段落補「驗證」條（各數字註明跑在哪個 commit、沒做的事：沒在正式站與真實資料驗證、Railway 連不連得到 ris.gov.tw 沒實測）；`git fetch origin`，若 main 有新 commit（特別是動 `trends.py`、`schemas.py`、`VillageTrendsPanel.vue`、契約檔的新成屋 B2 分支）就 merge 並重跑契約與受影響的測試；commit。

- [ ] **Step 5：交付**

回報：完成摘要、驗證結果、計畫裁定與實作中的新裁定、需要使用者決定的事（`feature/birth-series-20261014` 要不要 push main＝部署；部署後第一輪回補的結果要看 `geo_dataset_status`）。**不自己 push。**
