# 招生潛力與市佔率：第二、三波（招生潛力三個來源）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已上線的「招生潛力與市佔率」分頁加上「每年還能多招幾位」：附近園所停辦釋出、現有的里還沒招到、新建案搬進來三個來源，各給低／中／高，旁邊寫目前空位；走勢圖標出 3 公里內的停辦事件。

**Architecture:**
- 資料：延伸 10-15 的幼兒園停辦回補，從 2025-06 往前推到 2022-08，產生新的固定回補檔；同步每輪把檔裡的停辦事件補進 `geo_provider_events`，並保留 72 個月。
- 計算：新模組 `backend/app/admissions/potential.py`，三個來源各一個純函式加一個查詢組裝函式；預售規則直接 import 另一案的 `presale.py` 與 `trends.building_cases`。
- API：沿用 `GET /admin/admissions/potential`，回應多 `events` 與 `potential`。
- 後台：`PotentialTab` 加第二張大數字卡與三個來源的表，走勢圖加停辦標記。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、Alembic（本波**不需要** migration）、PostgreSQL、Vue 3、Element Plus、Vitest。不新增 numpy／scipy 依賴。

**Spec:** `docs/specs/2026-10-20-admissions-potential-share-design.md` §1、§3.4、§3.5、§5、§6（第一波實作紀錄在 §10）

## Global Constraints

- worktree `~/Repositories/ivy-website-wt/admissions-potential2-20261020`，分支 `feature/admissions-potential2-20261020`（從 main `87ec0d95`）。Node 22：`source ~/.nvm/nvm.sh; nvm use 22`，用分號串接。
- 不 `git add .`／`-A`；Conventional Commit、繁體中文；不 push、不部署。
- 權限：只有 `admissions.stats`（super_admin），沿用第一波端點。
- 規格 §1.2：「不做預測」只對本分頁放寬；不對個別家長或個別園所打分、不排名「誰最可能停辦」。畫面與 API 不出現「退場風險」之類的逐園評分。
- 只看需求面、不受空位限制（使用者 10-20）；卡片旁寫「目前空位 N」，N＝本校核定名額 − 最近一次在籍清冊人數（義華 210 − 192 ＝ 18）。
- 隱私：來源二（現有的里）只回距離帶彙總，不回逐里數字。
- 文案：直白、不寫開發輔助字或載入字、不用眉標；顏色走既有 token（admin 主色）；數字 tabular-nums；窄螢幕 720px。
- 參數全部放在 `potential.py` 開頭的常數，畫面「怎麼算」照列參數與出處；這一版不開放後台修改。
- 報告參數（`~/Downloads/義華校招生與經營整合判讀_v18.html` A-07、B-03、B-06、B-11）：
  - 距離帶：A ≤ 1.5 km 係數 1、B 1.5–3 km 0.45、C 3–5 km 0.12、D 5–8 km 0.02、E > 8 km 0。
  - 實收率 0.67（全市 114 學年核定 vs 幼生）；畢業比例 0.29（大班不轉園）；承接率中 0.138、高 0.173。
  - 價格係數（義華 3 歲一學期收費 ÷ 對方）：0.8–1.3 → 1；< 0.8（對方貴很多）→ 0.7；1.3–1.6 → 0.6；> 1.6 → 0.3；對方是公幼、非營利、準公共 → 0.1。對方沒有收費資料 → 1，並計數。
  - 每百戶 2–5 歲孩子：低 2.5、中 4.0、高 6.0。
  - 現有的里：距離模型 log μ = a + b·距離 + log(2–5 歲)（報告 M1：a ≈ −2.613、b ≈ −1.067），收縮參數 5.1，每年新生＝在籍缺口 ÷ 3。
- 測試指令：
  - 後端：`cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_potential2 uv run pytest <檔> -q`。測試庫先 `createdb`，再 `alembic upgrade head`（環境變數同第一波 common.md）。
  - 前端：`npm --prefix admin run test:unit -- <檔>`。
  - 8GB RAM，同時只跑一組測試。

## 裁定（寫計畫時定下，Task 8 寫進規格 §11）

1. 停辦回補新檔 `kindergarten-closures-20261020.csv` **取代** 10-15 檔，欄位 `source_id,name,left_on,reason,approved_capacity,lat,lng,kind`。兩份都有的園所以 10-15 的日期為準。
2. 同步每輪多一步 `apply_closure_backfill`：檔裡 `closed` 且有 `left_on` 的，園所表沒有就補一列 `is_active=False`（名稱、核定、座標、類型取自檔），再寫停辦事件，衝突就略過。`retire()` 照舊讀同一份檔。新設不寫事件（維持 P3 讀設立日）。
3. `EVENT_RETENTION_MONTHS` 24 → 72。
4. 來源一的年度窗口是學年口徑（10 月到隔年 9 月）。只算 2022-10 起完整的學年窗口，進行中的窗口不算。
   - 低＝最低那年 × 承接率中值；中＝平均 × 承接率中值；高＝最高那年 × 承接率高值。
   - 規格寫「低 0%」會讓低值恆為 0，資訊量太低，所以改成這樣。
5. 流入公式照報告 A-07：核定 × 實收率 × (1 − 畢業比例) × 承接率 × 距離係數 × 價格係數。
   - 類型係數（連鎖 0.6）與老師帶班不算，因為公開資料無法判斷連鎖，老師帶班也無法預期。這兩點寫進「怎麼算」。
   - 本校 50 m 內的園所與五校本身不算。
6. 來源二用 Poisson，自己寫兩參數牛頓法。低／中／高用參數化自助法：固定亂數種子 20261020，200 次，取 10／50／90 百分位。在籍點用 `boundaries.village_code(district, village)` 對到里，對不到的不算。
7. 來源三算「在建」且預計交屋落在「今天到下一個 8 月 31 日」的案。已過預計交屋時間但還沒登記的也算進來，因為很可能就在這一年內交屋。
   - 距離：有座標用座標，否則用里重心。只算 3 km 內。
   - 占有率用來源二的距離帶占有率（0–1、1–2、2–3 km：在籍 ÷ 2–5 歲）。
8. 本校核定名額用 `fees.own_fee(...)[0].approved_capacity` 的做法（座標 50 m 內最近營業中園所）。沒有核定或沒有清冊 → `capacity = null`，卡片不寫空位。
9. 每個來源 `status`：`ok`／`no_data`（例：沒有在籍清冊、沒有預售資料、沒有回補事件）。總數只加 `ok` 的來源，並寫「這個數字只含 …」。

## Review Focus

1. 停辦園所沒有核定名額或座標 → 不算進流入，並在 `assumptions` 計數，不能讓整個來源變 500（Task 3 `test_closure_without_capacity_skipped`）。
2. 校區沒匯入在籍清冊 → 來源二、三 `no_data`，來源一照算，總數只含來源一（Task 6 `test_no_roster_partial_total`）。
3. 半徑內沒有在建預售 → 來源三 `ok` 且三值都是 0，不是 `no_data`（Task 5 `test_no_cases_is_zero`）。
4. 距離模型無法收斂（例如全部里在籍都是 0）→ 來源二 `no_data`，不丟例外（Task 4 `test_model_degenerate`）。
5. 停辦事件的學年窗口不足一年（例：資料只回補到 2025） → 只用完整窗口；完整窗口少於 1 個時來源一 `no_data`（Task 3 `test_no_full_window`）。

---

### Task 1: 停辦回補檔延伸到 2022-08（腳本＋載入器）

**Files:**
- Modify: `backend/scripts/build_kindergarten_closures.py`
- Modify: `backend/app/admissions/geo/closure_backfill.py`
- Test: `backend/tests/test_geo_closure_backfill.py`、新 `backend/tests/test_build_kindergarten_closures.py`

**Interfaces:**
- Produces:
  - `ClosureBackfill(reason: str, left_on: date | None, name: str, approved_capacity: int | None, lat: float | None, lng: float | None, kind: str | None)`
  - `BACKFILL_FILE` 指向 `kindergarten-closures-20261020.csv`
  - `COLUMNS = ("source_id","name","left_on","reason","approved_capacity","lat","lng","kind")`
  - `load_closure_backfill(path=BACKFILL_FILE) -> dict[str, ClosureBackfill]`：新欄空字串 → None；kind 必須是 `KINDERGARTEN_KINDS` 之一或空。
- 腳本：
  - `--since 2022-08-31 --merge app/admissions/geo_data/kindergarten-closures-20261015.csv --out …20261020.csv`。
  - 取樣：每月最後一個 commit 掃描，找出「某月有、下個月沒有」的園所。對這類園所再到該月份區間逐版掃描，取精確的 `left_on`（定義同 10-15：最新含它的版本的下一個較新版本日期）。
  - 名稱、核定、座標、類型：取自離開前最後一版的 `preschools.json`；那一版找不到就留空。
  - 改名判斷取 10-15 規則與「3 個月內同址一進一出」的聯集。
  - `--merge` 讀舊檔：同 source_id 以舊檔的 `left_on`、`reason` 為準，新欄位補上。
  - 用 `gh api`；`raw()` 加快取目錄 `--cache <dir>`，重跑不重抓。

- [ ] **Step 1: 寫失敗測試**
  - 載入器：新欄位解析、空值、壞 kind、壞座標 → `BackfillFormatError`。
  - 腳本（不連網）：把 `gh`/`raw` 換成假函式，用三個假月份版本測試：
    - `test_left_on_refined_within_month`：月底版本少一所，月中逐版找到正確日期。
    - `test_merge_keeps_old_dates`。
    - `test_rename_same_address_within_three_months`。
    - `test_fields_from_last_preschools_version`。
- [ ] **Step 2: 跑測試，確認失敗**。
- [ ] **Step 3: 實作**。
- [ ] **Step 4: 跑測試，確認通過**：`tests/test_geo_closure_backfill.py tests/test_build_kindergarten_closures.py tests/test_geo_providers.py`。
- [ ] **Step 5: Commit** `feat(admissions): 幼兒園停辦回補延伸到 2022 年並帶名稱、核定與座標`

（真資料的 CSV 由主 session 跑腳本產生後另外 commit，見 Task 8。）

### Task 2: 同步時套用回補事件、保留 72 個月

**Files:**
- Modify: `backend/app/admissions/geo/providers.py`（`EVENT_RETENTION_MONTHS = 72`；新函式）
- Modify: `backend/app/admissions/geo/sync.py`（幼兒園同步成功後呼叫）
- Test: `backend/tests/test_geo_providers.py`

**Interfaces:**
- Consumes: `load_closure_backfill`（Task 1）
- Produces:
  - `async def apply_closure_backfill(db, backfill: dict[str, ClosureBackfill]) -> int`：回寫入的事件數。
    - 園所表沒有該 source_id → insert `GeoKindergarten`（`is_active=False`；`lat`/`lng` 缺就跳過不補列、不寫事件，因為欄位非空）。
    - 寫 `closed` 事件，`occurred_on=left_on`，`on_conflict_do_nothing`。
    - 不碰 `is_active=True` 的園所。真的還在營業的，交給現有 `retire` 流程處理。
- 呼叫點：`sync.py` 幼兒園寫入成功後、同一交易內；失敗用 SAVEPOINT 包住只記 warning（比照第一波 `september.record_month`）。

- [ ] **Step 1: 寫失敗測試**
  - `test_backfill_inserts_missing_kindergarten_and_event`
  - `test_backfill_idempotent`
  - `test_backfill_skips_active_and_no_coords`
  - `test_retention_keeps_72_months`：60 個月前的事件同步後仍在、80 個月前的被刪。
  - `test_backfill_failure_does_not_block_sync`
- [ ] **Step 2–4: 紅 → 實作 → 綠**：`tests/test_geo_providers.py tests/test_geo_sync*.py tests/test_admissions_area*.py`。
- [ ] **Step 5: Commit** `feat(admissions): 同步時補上回補的停辦事件，異動保留六年`

### Task 3: 來源一：附近園所停辦釋出

**Files:**
- Create: `backend/app/admissions/potential.py`（先放常數、`Range`、來源一）
- Test: `backend/tests/test_admissions_potential.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Range: low: float; mid: float; high: float`（四捨五入到 1 位）
  - `@dataclass(frozen=True) class ClosureEvent: occurred_on: date; name: str; kind: str; approved_capacity: int | None; distance_m: float; own_fee: int | None; their_fee: int | None`
  - `def band_weight(distance_m: float) -> float`
  - `def price_factor(kind: str, own_fee: int | None, their_fee: int | None) -> float`
  - `def school_year_window(day: date) -> int`：10/1 起算新學年，回民國學年；例：2022-10-01 → 111、2023-09-30 → 111。
  - `def closure_inflow(event: ClosureEvent, *, catch_rate: float) -> float`
  - `def closures_range(events: list[ClosureEvent], *, today: date) -> tuple[Range | None, dict]`：dict 是 `details`，含 `years`（每學年窗口的加權流入，承接率取 1 前的值）、`skipped`、`events`。完整窗口＝窗口結束日 < today。
  - `async def load_closure_events(db, lat: float, lng: float, *, since: date, today: date) -> list[ClosureEvent]`：8 km 內；排除五校 50 m 內；本校收費用 `fees.own_fee(db, lat, lng, age=3, radius_m=area.OWN_CAMPUS_RADIUS_M)`；對方收費取 `GeoKindergartenFee` age=3 的 `semester_total`。

- [ ] **Step 1: 寫失敗測試**
  - `band_weight` 邊界：1500 → 1、1501 → 0.45、3000 → 0.45、5000 → 0.12、8000 → 0.02、8001 → 0。
  - `price_factor` 五種情況。
  - `school_year_window` 邊界。
  - `test_backtest_ireland`：136 席、607 m、私立、收費相近 → `closure_inflow(..., catch_rate=0.138)` ≈ 136×0.67×0.71×0.138 ≈ 8.9（±0.1）。
  - `test_backtest_childhood_green`：480 席、676 m → ≈ 31.5。
  - `test_closures_range_low_mid_high`：三個完整窗口，加權值 10／30／20 → low = 10×0.138、mid = 20×0.138、high = 30×0.173。
  - `test_closure_without_capacity_skipped`、`test_no_full_window`、`test_own_campus_excluded`（DB）。
- [ ] **Step 2–4: 紅 → 實作 → 綠**。
- [ ] **Step 5: Commit** `feat(admissions): 招生潛力來源一：附近園所停辦釋出`

### Task 4: 來源二：現有的里還沒招到

**Files:**
- Modify: `backend/app/admissions/potential.py`
- Test: `backend/tests/test_admissions_potential.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class VillageObs: code: str; distance_m: float; kids: int; enrolled: int`
  - `def fit_distance_model(obs: list[VillageObs]) -> tuple[float, float] | None`：Poisson 牛頓法估 (a, b)，offset log(kids)；kids=0 的里不參與；不收斂或總在籍 0 → None。
  - `def village_gaps(obs, a, b, *, radius_m=3000, shrink=5.1) -> float`：半徑內 Σ max(0, μᵢ − θᵢ·μᵢ)，其中 θᵢ = (yᵢ + shrink)/(μᵢ + shrink)。
  - `def villages_range(obs, *, seed=20261020, draws=200) -> tuple[Range | None, dict]`：
    - 先 fit 一次，中值＝缺口 ÷ 3。
    - 自助法：yᵢ* ~ Poisson(μ̂ᵢ)，重 fit、算缺口 ÷ 3，取 10／90 百分位當低／高（`random.Random(seed)`，Poisson 用 Knuth 演算法）。
    - details 只有 `bands`：0–0.5、0.5–1、1–2、2–3 km 各帶的 `villages, kids, enrolled, expected, gap`，以及 `model:{a,b}`；**沒有逐里數字**。
  - `def band_shares(obs) -> dict[str, float]`：0–1、1–2、2–3 km 三帶在籍 ÷ 2–5 歲，給 Task 5 用。
  - `async def load_village_obs(db, campus_key, lat, lng, *, radius_m=6000) -> list[VillageObs] | None`：沒有清冊 → None。kids 取 `geo_village_population` 使用中月份的 age_2..age_5。在籍用 `EnrolledStudentPoint` 依 (district, village) 計數，再用 `boundaries.village_code` 對到里。

- [ ] **Step 1: 寫失敗測試**
  - `test_fit_recovers_parameters`：用 a=−2.6、b=−1.07 生成期望值當觀測（取整），估回來的值誤差在 0.05 內。
  - `test_gap_shrinks_small_villages`：期望 2、實際 0 的里，缺口 < 2。
  - `test_villages_range_deterministic`：同種子兩次結果相同，且 low ≤ mid ≤ high。
  - `test_details_have_no_village_codes`：details 序列化後不含任何里代碼。
  - `test_model_degenerate`、`test_band_shares`。
- [ ] **Step 2–4: 紅 → 實作 → 綠**。
- [ ] **Step 5: Commit** `feat(admissions): 招生潛力來源二：現有的里還沒招到`

### Task 5: 來源三：新建案搬進來

**Files:**
- Modify: `backend/app/admissions/potential.py`
- Test: `backend/tests/test_admissions_potential.py`

**Interfaces:**
- Consumes: `presale.expected_delivery`、`presale.delivery_half`、`trends.building_cases`、`band_shares`（Task 4）
- Produces:
  - `@dataclass(frozen=True) class Delivery: name: str; households: int; distance_m: float; expected: date`
  - `def next_school_year_start(today: date) -> date`：下一個 9 月 1 日（今天是 9/1 時取明年）。
  - `def presale_range(deliveries: list[Delivery], shares: dict[str, float], *, today: date) -> tuple[Range, dict]`：只取 `expected < next_school_year_start(today)` 的案（含已過期）。孩子＝households × {2.5, 4.0, 6.0}/100 × 該案距離帶占有率。details 列每案 name、households、`expected_year`、`expected_half`、`distance_m`（取整 100）、mid 貢獻。
  - `async def load_deliveries(db, lat, lng, *, today, radius_m=3000) -> list[Delivery] | None`：預售表空 → None。
- [ ] **Step 1: 寫失敗測試**：`test_only_next_year_deliveries`、`test_overdue_included`、`test_presale_math`（100 戶、距離 0.5 km、0–1 km 占有率 0.0373 → mid = 100×0.04×0.0373 ≈ 0.15）、`test_no_cases_is_zero`、`test_presale_missing_table_none`。
- [ ] **Step 2–4: 紅 → 實作 → 綠**。
- [ ] **Step 5: Commit** `feat(admissions): 招生潛力來源三：新建案搬進來`

### Task 6: 組裝、空位、停辦事件與 API

**Files:**
- Modify: `backend/app/admissions/potential.py`（`query_potential`）
- Modify: `backend/app/admissions/schemas.py`（新 schema，`PotentialOut` 多兩個欄位）
- Modify: `backend/app/admissions/routes.py:1100`（同一端點）
- Modify: `contracts/*`（重產）、`admin/src/api/types.ts`
- Test: `backend/tests/test_admissions_potential.py`、`backend/tests/test_admissions_potential_api.py`

**Interfaces:**
- Produces: `async def query_potential(db, campus_key: str, *, today: date | None = None) -> dict`，回傳：
  ```
  {
    "status": "ready" | "no_campus_point",
    "sources": [
      {"key": "closures" | "villages" | "presale", "status": "ok" | "no_data",
       "low": float|None, "mid": float|None, "high": float|None,
       "assumptions": [{"label": str, "value": str}], "details": {...}}
    ],                                   # 固定三筆、固定順序
    "total": {"low", "mid", "high", "included": [key...]} | None,
    "capacity": {"approved": int, "enrolled": int, "open": int} | None,
    "events": [{"occurred_on": date, "name": str, "approved_capacity": int|None,
                "distance_m": int, "school_year": int}],   # 3 km 內、2022-10 起
  }
  ```
  - schema 名稱：`PotentialSourceOut`、`PotentialAssumptionOut`、`PotentialTotalOut`、`PotentialCapacityOut`、`PotentialEventOut`、`PotentialEstimateOut`。
  - `details` 用三個各自的 schema：`ClosureDetailsOut`、`VillageDetailsOut`、`PresaleDetailsOut`。
  - `PotentialOut` 多 `potential: PotentialEstimateOut`。
  - admin types 加 `PotentialEstimate`、`PotentialSource`、`PotentialEvent`。
- [ ] **Step 1: 寫失敗測試**：`test_no_roster_partial_total`、`test_capacity_open_seats`（210、192 → 18）、`test_events_within_3km_since_2022`、`test_sources_fixed_order`；API：形狀、權限沿用第一波測試。
- [ ] **Step 2–4: 紅 → 實作 → 綠**，再跑 `npm run contract:generate` 與 `npm run contract:check`。
- [ ] **Step 5: Commit** `feat(admissions): 招生潛力 API 加三個來源、空位與停辦事件`

### Task 7: 後台畫面

**Files:**
- Modify: `admin/src/components/admissions/potential/PotentialTab.vue`、`ShareTrendChart.vue`、`potentialFormat.ts`
- Create: `admin/src/components/admissions/potential/PotentialSources.vue`
- Modify: `admin/src/__tests__/admissionsTestKit.ts`（`potentialData` 多 `potential` 夾具）
- Test: `admin/src/__tests__/potentialTab.test.ts`、`potentialFormat.test.ts`、新 `potentialSources.test.ts`

**Interfaces / 畫面（版面 A）：**
- 兩張大數字卡並排（窄螢幕上下排）：
  - 左：市佔率（既有）。
  - 右：標題「每年還能多招」，大字「約 {mid 取整} 位」，下一行「{low 取整}～{high 取整} 位」，再一行「目前空位 {open} 位」（capacity 為 null 不寫）。`total.included` 少於三個時，加一行「只含：{來源名稱、}」。
- 三個來源表（`PotentialSources.vue`），在走勢圖下方、各學年數字上方：
  - 欄位：來源、每年可多招（低／中／高）、區間條（CSS 長條，`low`–`high` 淡色、`mid` 實線，刻度上限取三個來源的最大 high）。
  - 來源名稱：「附近園所停辦釋出」「現有的里還沒招到」「新建案搬進來」。
  - `no_data` 的列顯示「沒有資料」，並寫原因：沒有在籍清冊／沒有預售資料／沒有停辦紀錄。
  - 每列可展開「怎麼算」：列出 `assumptions`（label：value），再接 details 小表——
    - 停辦：各學年窗口的值、事件清單（日期、園名、核定、距離 km）；
    - 現有的里：距離帶表；
    - 新建案：案名、戶數、預計交屋（「約 2027 下半年」）、距離。
- 走勢圖：`events` 依 `school_year` 在 x 軸下方畫小三角形（admin 警示色 token），`<title>`「{日期} {園名}停辦（核定 {N}）」。同學年多所時合併成一個標記，title 列出全部。只畫落在圖上學年範圍內的。
- 卡片與來源表的數字一律整數顯示（API 是 1 位小數）。

- [ ] **Step 1: 寫失敗測試**：卡片三種狀態（完整、只含部分、無空位）；來源表三種列狀態；展開後的 details；走勢圖標記數量與 title；窄螢幕排列。
- [ ] **Step 2–4: 紅 → 實作 → 綠**，跑 `npm --prefix admin run test:unit` 全套與 `typecheck`。
- [ ] **Step 5: Commit** `feat(admin): 招生潛力卡片、三個來源與停辦標記`

### Task 8: 真資料回補檔、驗證、文件

- [ ] **Step 1（主 session）**：在 worktree 跑腳本（`--since 2022-08-31 --merge …20261015.csv --cache <scratchpad>`），產生 `kindergarten-closures-20261020.csv`。
  - 核對：3 km 內 2022-10～2026-10 停辦應約 11 所、核定約 1,578（報告 B-04）。有差異就寫原因。
  - 刪除舊檔 `…20261015.csv`，同步更新 `test_geo_closure_backfill.py` 讀真檔的守門測試。
  - commit `data(admissions): 幼兒園停辦回補檔延伸到 2022-08`。
- [ ] **Step 2（主 session）**：本機驗證庫跑真資料。
  - `geo-sync` 抓幼兒園、收費、預售（本機連得到），加九月人口；在籍清冊本機沒有，來源二只用合成資料測。
  - 呼叫 `query_potential` 看來源一、三的數字，對照報告：愛爾蘭單一事件約 9 位、新建案整體 1.0／1.6／2.5 位量級（本案只算一年內交屋，應更小）。
- [ ] **Step 3（實作者）**：文件。
  - 規格加 §11 第二、三波實作紀錄（上面 9 條裁定＋驗證數字）。
  - DESIGN.md 該節補第二、三波。
  - README 頂部日期段。
  - `deploy/README.md` 寫回補檔換版與部署後檢查。
  - `geo_data/README.md` 的停辦回補段改寫成新檔。
- [ ] **Step 4（主 session）**：後端全套、admin 全套、typecheck、contract:check、stack e2e，以及截圖（桌機、手機）。
- [ ] **Step 5**：Commit `docs: 記錄招生潛力第二、三波`。
