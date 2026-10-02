# 官網招生入學模組 Implementation Plan — 階段 C：統計、e2e 與文件

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後端移植園務 `_query_stats`（KPI、四個比率、月度、年度、班別、來源、接待、未預繳原因、主管決策摘要、月比、警示、行動入口）、未預繳明細（園務 `/no-deposit-analysis`）並新增五校比較；後台「統計分析」分頁取代 B1 的佔位，五個子分頁加「五校比較」，「未預繳原因」子分頁列未預繳明細（名單，2026-10-01 使用者裁定）；stack e2e 跑通「家長自選場次 → 已到場 → 看板 → 預繳 → 註冊 → 名額」，拍桌機與手機截圖；最後回寫規格、契約 README 與各份文件。

**Architecture:** `backend/app/admissions/stats.py` 只讀不寫（不 flush、不 commit、不稽核），所有聚合以 `campus_key`＋入學學年學期為母體，SQL 只做 `GROUP BY` 原始欄位，標籤（「未填寫」「未分類」）與同票排序在 Python 處理，避免 asyncpg 伺服器端參數讓 `GROUP BY coalesce(x, $1)` 對不上 `SELECT coalesce(x, $2)`。時間一律用注入的 `now`（預設 `now_utc()`），近 30／90 天、逾期 14 天、冷名單 90 天都以 `created_at` 與 `now` 的瞬間比較。後台 `StatsTab.vue` 負責篩選、載入與子分頁，`StatsOverview.vue` 畫總覽，`StatsDimensionTable.vue` 是表格＋CSS 長條的共用元件，`CompareTable.vue` 是五校比較，`NoDepositList.vue` 是「未預繳原因」子分頁的未預繳明細（名單，資料來自 `stats.py` 的 `no_deposit_records`）。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async＋asyncpg、PostgreSQL、pytest（`asyncio_mode="auto"`）；Vue 3＋Element Plus、vitest＋@vue/test-utils＋jsdom；Playwright（`playwright.stack.config.ts`、`tests/stack/`）。

**Spec:** `docs/specs/2026-09-30-website-admissions-design.md` 第 7、9、10、14、16 節（下稱「規格」）。

**先讀：** 總覽 `docs/superpowers/plans/2026-10-01-admissions.md` 的「工作環境」「Global Constraints」「技術調整」「介面」「Review Focus」。

**本階段閘門（進入 C 之前必須成立）：** 階段 B 閘門已過——`npm --prefix admin run typecheck`、`npm --prefix admin run test:unit` 全綠；`app/admissions/{constants,academic,models,intake,routes,schemas}.py`、`backend/tests/admissions_helpers.py`、`admin/src/api/admissions.ts`、`admin/src/views/AdmissionsView.vue`、`admin/src/components/admissions/StatsTab.vue`（B1 佔位）都已存在。開工先跑：

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git status --short
ls backend/app/admissions/ admin/src/components/admissions/
grep -n "StatsTab" admin/src/views/AdmissionsView.vue
grep -n "def intake_plan\|def shift_roc_month\|def roc_month" backend/app/admissions/intake.py backend/app/admissions/academic.py
```

Expected：上列檔案都在；`intake_plan`、`shift_roc_month`、`roc_month` 的簽章與總覽「介面」一致。不一致就停下回報，不要自己改 A／B 的檔案去湊。

**本階段完成閘門：**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
(cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q)   # 主 session 背景跑
npm run contract:check
npm --prefix admin run typecheck
npm --prefix admin run test:unit -- --maxWorkers=2
npm run test:website -- --maxWorkers=2
E2E_DB_NAME=ivy_website_e2e_test_admissions E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run e2e:build
E2E_DB_NAME=ivy_website_e2e_test_admissions E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run test:e2e:stack
```

外加 Playwright 1440／390 截圖（C5）。8GB RAM：上面七個指令依序跑，不要同時跑。`npm run test:website` 是為了 R12（web 的 `admission-grade-cases.spec.ts` 與後端、後台讀同一份年級案例）。

## 對總覽的調整

| 原本（總覽） | 改成 | 理由 |
|---|---|---|
| `admin/src/api/types.ts` 只在 B1 改 | C3 加 `AdmissionsStats`、C3b 加 `NoDepositRecords`、`NoDepositRecord`、C4 加 `AdmissionsCompareRow`、`AdmissionsRate` 五個型別別名 | `AdmissionsStatsOut`／`NoDepositRecordsOut`／`AdmissionsCompareRow` 在 C1／C2b／C2 才進 OpenAPI，B1 時產生檔裡還沒有 |
| `views/AdmissionsView.vue` 只在 B1 改 | C3 改 `<StatsTab>` 的 props 與事件（一處），C4 不動 | 統計分頁要知道使用者可看的校區（決定五校比較是否出現），並把「到訪視明細看某月」交回頁面切分頁 |
| 總覽未定 `StatsTab` 介面 | `defineProps<{ campusKey: string; schoolYear: number \| null; semester: number \| null; campusKeys: readonly string[] }>()`；`defineEmits<{ 'open-records': [filter: { month: string }] }>()` | 頁首篩選由 B1 的 `useAdmissionsFilters` 管，統計分頁只吃值；切到訪視明細屬於頁面層的事 |
| 園務警示與行動入口的 `target_tab`（`detail`／`nodeposit`／`area`） | 官網值為 `records`／`nodeposit`／`source`；行動入口「查看區域機會」（`AREA_OPPORTUNITY`）改為「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現 | 官網不做行政區（規格 3.2、9.3），`district` 不填；園務在沒有行政區時會寫出「優先檢查 未填寫 的來源分布與通勤熱區。」。C6 寫進契約 README 差異清單與規格 9.3 |
| `GET /admin/admissions/compare` 的 `school_year`、`semester` | 兩者必填（`semester` 1 或 2） | 名額剩餘要對到單一學期的計畫名額；頁首沒選學期時，後台用目前學期並在表格上方寫明 |
| B 計畫調整第 3 條：C3 覆寫 `StatsTab.vue` 時「props 與 emits 保持一樣」 | C3 多一個 prop `campusKeys`，`go` 事件換成 `open-records`；B1 的 `admissionsView.test.ts`「統計分析（C 階段前的空狀態）」改成驗 props 與 `router.push`，同檔 `noArrivals` 讓 `/admin/admissions/stats` 回錯誤 | 五校比較要知道看得到幾校；空狀態的按鈕隨 C3 消失，B1 那項測試一定要跟著換（C3 Step 11） |
| 規格 10 的網址參數只有 `campus`、`sy`、`sem`、`tab` | 統計的警示與行動入口要看某月明細時，`AdmissionsView` 用 `router.push({ query: { ...route.query, tab: 'records', month } })`；訪視明細讀寫 `month` 由 B2 負責（已約定） | `push` 讓上一頁回到統計；C3 的測試只驗頁面推出的網址，不重複測 B2 |
| 本表第 5 條「頁首沒選學期時用目前學期」 | 沒選學年：用目前學期（台北日期）；只選學年沒選學期：是目前學年就用目前學期，否則用上學期；頁首有任一沒選，就在表格上方寫明用哪個學期 | 選了去年或明年時，「目前的學期序」沒有意義；上學期是名額規劃與保留座位的預設（規格 6.5） |
| 規格 9 沒寫同票排序 | 班別、接待人員、介紹者 × 來源、未預繳原因、來源失衡候選都加第二鍵「標籤字串升序」；來源分析照園務三鍵 | 園務單鍵排序同票時看資料庫回傳順序，畫面與測試都不穩定；寫進規格 9.2 與契約 README 差異清單 |
| 規格 9.2 只寫「分母 0 回 null」 | 月比任一邊是 null，`delta` 也是 null（不判定漏斗下滑） | 園務會算成 100.0－0，上月沒資料時誤報「本月漏斗轉換下滑」；寫進規格 9.2 與契約 README |
| 規格 7「招生統計含孩子姓名（行動清單）」 | 統計回應（`/stats`、`/compare`）只有數字，不含孩子姓名；未預繳名單由 `GET /admin/admissions/no-deposit-records`（C2b）提供，含孩子姓名，權限同規格第 7 節（`admissions.read`＋校區範圍，越權 404、editor／readonly 403），每列只回畫面要的欄位（`id`、`month`、`seq_no`、`child_name`、`grade`、`no_deposit_reason`、`no_deposit_reason_detail`、`source`、`referrer`、`parent_response`、`created_at`、`priority`、`cold`），不含電話、地址、生日；後台在「未預繳原因」子分頁列「未預繳明細」（C3b `NoDepositList.vue`，照園務 `RecruitmentNoDepositTab`） | 2026-10-01 使用者裁定統計頁要列名單（原本的計畫是統計不列名單、名單到訪視明細篩）；數字與名單分兩個端點，`/stats` 仍不帶個資，名單只回追蹤要用的欄位 |
| 規格 9.3 總覽列的區塊 | 另加「本範圍合計」（六個計數、唯一幼生 `unique_visit`／`unique_deposit`、四個比率）；園務兩張圖由月度明細表的 CSS 長條取代；「全管道彙整」不做 | 規格 9.2 的唯一幼生與預繳→註冊率在園務總覽沒有地方看；全管道彙整是園務自家官網報名 |
| 規格 13 `GET /stats` 沒寫錯誤 | `reference_month` 格式錯回 422 `INVALID_REFERENCE_MONTH`（訊息照園務 `roc_month_utils` 原文） | 園務是未處理的 ValueError（500） |
| 規格 14 R17 沒寫「場次時間已過」怎麼做 | 新增 `tests/stack/db.ts` 的 `startVisitSlot`：psql 把本測試自己建的場次（義華第 12 天 15:00）移到昨天，只在那一場只有這筆預約時才改；入學學期與小班生日用 `admin/src/admissions/academic.ts` 算 | 不改系統時間、不動其他 spec 的場次；學期與年級跟後台同一套規則，換日子跑也不會壞 |
| 規格 14 R16 沒寫怎麼驗 | `admissions-flow.spec.ts` 以總管理者拍五個分頁＋五校比較的 1440／390 截圖到 `output/playwright/`，每頁檢查不橫向溢出；`a11y.spec.ts` 加招生頁五個分頁，`keyboard.spec.ts` 加招生頁兩個網址 | R16 要求頁面不溢出；axe 一起擋 B／C 新畫面的 serious／critical 問題 |
| 規格 9.3「來源分析：依 source，另有介紹者 × 來源交叉」 | 介紹者 × 來源交叉表放在「接待分析」子分頁（同園務 `RecruitmentStaffTab`）；「來源分析」只有來源排名明細 | 規格 9.3 的「接待分析同園務 StaffTab」也包含這張表，兩句互相矛盾；照園務放，介紹者就是接待人員（同一個 `referrer` 欄） |
| 總覽 API 表 `GET /no-deposit-records` 沒寫排序（園務 `ORDER BY month DESC, seq_no`） | 民國月份依 C1 的 `roc_month_sort_key` 降序、序號依開頭數字升序（`"2"` 在 `"10"` 前面；沒有開頭數字的排在有數字的後面，沒有序號的排最後），再以 `created_at`、`id` 升序收尾；在 Python 排好再切頁 | 園務兩欄都是字串排序：同月「10」排在「2」前面，`99.12` 會排在 `115.01` 前面；同鍵時順序看資料庫，換頁可能重複或漏列。單校單學期的未預繳筆數不多，Python 排序足夠 |
| 總覽沒寫未預繳名單能不能跳到訪視明細 | 每列「查看」：`NoDepositList` 發 `open-records`（`{ month: 該列月份 }`），`StatsTab` 原樣轉發，頁面照本表第 7 條切到訪視明細並帶 `month`；不帶姓名、不指定單筆 | B 的訪視明細只吃 `month`、`vr`（`visit_request_id`）兩個網址參數（B 調整第 2、15、16 條）；姓名關鍵字是 `RecordsTab` 的內部狀態，不吃 props、不進網址，名單列也沒有 `visit_request_id`，所以只能帶月份；不新增 B 沒有的介面 |
| 總覽未定 `NoDepositList` 介面；行動入口「查看高風險未預繳」只切子分頁 | `defineProps<{ campusKey: string; schoolYear: number \| null; semester: number \| null; preset?: Record<string, string \| number> \| null }>()`、`defineEmits<{ 'open-records': [filter: { month: string }] }>()`；`StatsTab` 收到指向 `nodeposit` 的警示或行動入口時，把 `target_filter`（`priority`、`overdue_days`）當 `preset` 交給名單（其餘篩選回預設、回第 1 頁）。三張數字卡仍用 `/stats` 的 `no_deposit_summary`；`/no-deposit-records` 的 `summary` 照園務回傳，畫面不重複顯示 | 園務 `RecruitmentStatsPanel.applyNoDepositFilter` 會把 `target_filter` 套進名單；不帶的話「目前有 2 筆高潛力名單逾期未追」點進來看到的是全部高潛力 |

---

## Global Constraints

見總覽「Global Constraints」，全部適用。本階段另外：

- 統計端點都是 GET、純讀取：不呼叫 `db.flush()`／`db.commit()`、不寫稽核（`test_audit_coverage.py` 只管寫入端點）。
- 比率一律 `round(num / den * 100, 1)`，**分母 0 回 `None`**；前端 `null` 顯示「—」，不顯示 0。
- 標籤：`grade`／`source`／`referrer` 為 NULL 顯示「未填寫」，`no_deposit_reason` 為 NULL 顯示「未分類」（園務原文）；空字串不轉。SQL `GROUP BY` 原始欄位，標籤在 Python 合併（不要寫 `GROUP BY coalesce(...)`：asyncpg 的 `$1`／`$2` 會讓 PostgreSQL 判定 SELECT 與 GROUP BY 不是同一個運算式）。
- 同票排序：園務只有單鍵降序、同票順序不固定；官網一律加第二鍵「標籤字串升序（Python 字碼順序）」。`by_source` 園務本來就有三鍵（參觀降、預繳降、來源升），照抄。
- 時間：`query_stats(..., now=None)` 預設 `now_utc()`；比較一律 `RecruitmentVisit.created_at >= now - timedelta(days=N)`（近 N 天）或 `<= now - timedelta(days=N)`（逾期），瞬間比較、不轉日期。測試一律注入 `now`。
- 統計含接待人員名字與來源原文，只給 `admissions.read`（super_admin、campus_admin、reception）；editor、readonly 403（規格第 7 節）。`/stats`、`/compare` 只回數字，不含孩子姓名、電話等個資；未預繳名單 `/no-deposit-records`（C2b）含孩子姓名，權限與校區範圍同上，每列只回畫面要的欄位，不含電話、地址、生日。
- 不新增 npm／Python 套件；長條圖用 CSS（`--el-color-primary` 等既有 token），不寫 hex／rgb／oklch 字面值。
- 規格 9.2 沒有「樣本較少」的提示規則，**不做**樣本數提示。
- e2e 只用 `tests/stack` 既有手段：API 準備資料、`psql` 把**本測試自己建的**場次移到昨天（同後端 `start_visit_slot`）；不改系統時間、不動其他測試用的場次。

## Review Focus（本階段負責）

總覽 Review Focus 第 5 條「空資料的統計」：

- 一筆訪視都沒有的校區：KPI 全 0、四個比率 `null`、`reference_month` 與 `previous_month` 是 `null`、各維度是空陣列、警示與行動入口是空陣列，不報錯。→ C1 `test_stats_empty_campus`。
- 某年級沒設計畫名額：五校比較的名額剩餘只加總有設定的年級；一個都沒設定是 `null`，畫面寫「未設定」，不是 0。→ C2 `test_compare_without_targets`。
- 畫面：沒有資料時寫原因（「這個校區在 115 學年上學期還沒有招生訪視。」），不顯示假的 0；比率 `null` 顯示「—」。→ C3 `statsTab.test.ts`「無資料」、C4 `compareTable.test.ts`「未設定」。

本階段另外要守的（規格沒逐條寫、容易出錯）：

- **快速切換校區**：先切到明華、再切回義華，明華的回應晚到也不能蓋掉畫面。→ C3 `statsTab.test.ts`「快速切換校區只顯示最後一次」。
- **退出後的舊原因**：退預繳的訪視 `has_deposit=false` 但 `no_deposit_reason` 可能還留著高潛力原因，不能算進未預繳母體與高潛力積壓。→ C1 `test_stats_matches_ivy_semantics`（V8）。
- **未預繳名單與統計同口徑**：名單母體與 `/stats` 的 `no_deposit_total` 相同（未預繳且未退出、篩入學學年學期），統計寫 7 筆、名單也要是 7 筆；`summary` 不因潛力、冷名單篩選變小。→ C2b `test_no_deposit_records_population_order_and_fields`、`test_no_deposit_records_filters_keep_summary`。
- **名單快速切換**：先切到明華、再切回義華，明華的名單晚到也不能蓋掉畫面。→ C3b `noDepositList.test.ts`「快速切換校區只顯示最後一次」。

## 檔案配置（本階段）

| 檔案 | 動作 | 負責 task |
|---|---|---|
| `backend/app/admissions/stats.py` | 新增 | C1、C2、C2b |
| `backend/app/admissions/schemas.py` | 修改（檔尾加統計 schema） | C1、C2、C2b |
| `backend/app/admissions/routes.py` | 修改（檔尾加三個 GET） | C1、C2、C2b |
| `backend/tests/test_admissions_stats.py` | 新增 | C1、C2、C2b |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | C1、C2、C2b |
| `admin/src/admissions/statsFormat.ts` | 新增 | C3 |
| `admin/src/api/admissions.ts`、`admin/src/api/types.ts` | 修改 | C3、C3b、C4 |
| `admin/src/components/admissions/StatsTab.vue` | 改寫（取代 B1 佔位）；C3b 在「未預繳原因」掛名單 | C3、C3b、C4 |
| `admin/src/components/admissions/StatsOverview.vue`、`StatsDimensionTable.vue` | 新增 | C3 |
| `admin/src/components/admissions/NoDepositList.vue` | 新增（未預繳明細） | C3b |
| `admin/src/components/admissions/CompareTable.vue` | 新增 | C4 |
| `admin/src/views/AdmissionsView.vue` | 修改（`<StatsTab>` 一處） | C3 |
| `admin/src/__tests__/statsFormat.test.ts`、`statsTab.test.ts`、`compareTable.test.ts`、`noDepositList.test.ts` | 新增（`statsTab.test.ts` 在 C3b 追加三項） | C3、C3b、C4 |
| `admin/src/__tests__/admissionsView.test.ts` | 修改（B1 的「統計分析」那一組換成接縫測試） | C3 |
| `tests/stack/db.ts`、`tests/stack/admissions-flow.spec.ts` | 新增 | C5 |
| `tests/stack/a11y.spec.ts`、`tests/stack/keyboard.spec.ts` | 修改（路由表加 `/admissions`） | C5 |
| `README.md`、`DESIGN.md`、`CLAUDE.md`、`deploy/README.md`、`docs/website-admin/acceptance.md`、`docs/specs/2026-09-30-website-admissions-design.md`、`docs/superpowers/plans/2026-10-01-admissions.md`、`contracts/ivy-recruitment/README.md` | 修改 | C6 |

---

### Task C1：統計查詢 `query_stats` 與 `GET /admin/admissions/stats`

**Files:**
- Create: `backend/app/admissions/stats.py`
- Modify: `backend/app/admissions/schemas.py`（檔尾加統計 schema）
- Modify: `backend/app/admissions/routes.py`（import 區＋檔尾加端點）
- Test: `backend/tests/test_admissions_stats.py`（新檔）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes：`app.admissions.models.RecruitmentVisit`（A2）、`app.admissions.constants.NO_DEPOSIT_PRIORITY`（A1）、`app.admissions.academic.roc_month`／`shift_roc_month`（A1）、`app.common.timezones.now_utc`、`app.campuses.models.CAMPUS_KEYS`、`app.auth.permissions.require_scope`／`ScopeDenied`；`tests.conftest` 的 `_create_user`、`_logged_in_client`、`admin_client`、`minghua_client`、`editor_client`。
- Produces（`app/admissions/stats.py`）：
  - 常數 `TOP_SOURCES_COUNT = 10`、`FUNNEL_DROP_THRESHOLD = 10.0`、`HIGH_POTENTIAL_BACKLOG_THRESHOLD = 5`、`DEFAULT_OVERDUE_DAYS = 14`、`COLD_LEAD_DAYS = 90`、`SOURCE_IMBALANCE_SHARE_THRESHOLD = 40.0`、`ACTION_QUEUE_LIMIT = 3`、`ROLLING_SHORT_DAYS = 30`、`ROLLING_LONG_DAYS = 90`
  - `class InvalidReferenceMonth(ValueError)`
  - `def pct(num: int, den: int) -> float | None`
  - `def metric_snapshot(visit=0, deposit=0, enrolled=0, transfer_term=0, pending_deposit=0, effective_deposit=0) -> dict`
  - `def normalize_roc_month(value: str | None) -> str | None`
  - `async def query_stats(db, campus_key: str, *, school_year: int | None, semester: int | None, reference_month: str | None, now: datetime | None = None) -> dict`
- Produces（schemas）：`AdmissionsMetricSnapshot`、`AdmissionsStatsKpi`、`AdmissionsMonthlyRow`、`AdmissionsYearlyRow`、`AdmissionsDecisionSummary`、`AdmissionsFunnelSnapshot`、`AdmissionsCountDiff`、`AdmissionsRateDiff`、`AdmissionsMonthOverMonth`、`AdmissionsStatsAlert`、`AdmissionsStatsAction`、`AdmissionsGradeRow`、`AdmissionsSourceRow`、`AdmissionsGradeCount`、`AdmissionsReferrerRow`、`AdmissionsCrossRow`、`AdmissionsReferrerSourceCross`、`AdmissionsNoDepositReason`、`AdmissionsNoDepositPriority`、`AdmissionsNoDepositSummary`、`AdmissionsStatsFilters`、`AdmissionsStatsOut`
- Produces（API）：`GET /api/website/v1/admin/admissions/stats?campus_key=&school_year=&semester=&reference_month=` → `AdmissionsStatsOut`；`admissions.read`；越權或不存在的校區 404；參考月份格式錯 422 `INVALID_REFERENCE_MONTH`。

`AdmissionsStatsOut` 的鍵（園務 `_query_stats` 移植＋官網延伸，延伸以 ★ 標示）：

| 鍵 | 內容 | 園務出處 |
|---|---|---|
| `as_of` ★ | 計算時刻（即 `now`） | 規格 13「聚合回應帶 as_of」 |
| `filters` ★ | 實際套用的 `campus_key`、`school_year`、`semester`、`reference_month`（正規化後的請求值） | 規格 13 |
| `reference_month` | 實際使用的參考月份；沒傳就取 `monthly` 最後一筆；沒資料 `null` | `_select_reference_month` |
| `kpi` | 六個計數＋四個比率＋`unique_visit`／`unique_deposit` | stats.py:88-139 |
| `decision_summary` | `current_month`／`rolling_30d`／`rolling_90d`／`ytd`，各為 metric snapshot | stats.py:489-529 |
| `funnel_snapshot` | 參考月份的 visit、deposit、enrolled、transfer_term、effective_deposit、pending_deposit | stats.py:587-632 |
| `month_over_month` | `current_month`、`previous_month`，五個計數與四個比率各 `{current, previous, delta}` | shared.py:299-339 |
| `alerts` | `FUNNEL_DROP`、`HIGH_POTENTIAL_BACKLOG`、`SOURCE_IMBALANCE`（固定順序，符合才列） | shared.py:377-439 |
| `top_action_queue` | `FOLLOW_HIGH_POTENTIAL`、`REVIEW_CURRENT_MONTH`、`REVIEW_SOURCE`（最多 3） | shared.py:442-491（`AREA_OPPORTUNITY` 改 `REVIEW_SOURCE`） |
| `monthly`、`by_year` | 月度（民國月份升序）、年度（民國年升序） | stats.py:141-233 |
| `by_grade`、`month_grade` | 班別（含三個比率）、`{月份: {年級: 筆數, "合計": 筆數}}` | stats.py:235-279 |
| `by_source`、`top_source_names` | 來源（★ 加 `visit_to_deposit_rate`）、前 10 名 | stats.py:281-306 |
| `by_referrer`、`referrer_source_cross` | 接待人員（★ 加 `visit_to_deposit_rate`，`by_grade` 每格 `{visit, deposit}`）、介紹者 × 來源（`total` 含前 10 以外） | stats.py:308-374 |
| `no_deposit_reasons`、`no_deposit_total` | 未預繳原因（★ 每列加 `priority`）、同母體總數；母體排除已退出 | stats.py:395-435 |
| `no_deposit_priority` ★ | `{high, medium, low, other}` 筆數（`other`＝「未註明／待追蹤」與「未分類」） | 規格 9.3「含優先度分組」 |
| `no_deposit_summary` ★ | `high_potential_count`、`overdue_followup_count`（建檔逾 14 天）、`cold_count`（逾 90 天）、`high_potential_backlog_count` | stats.py:938-1005 的 `summary`（`/stats` 只取數字；名單由 C2b 的 `/no-deposit-records` 回） |

- [ ] **Step 1：寫失敗的測試（R10、R11、Review Focus 5、權限）**

`backend/tests/test_admissions_stats.py`（C2 會在檔尾再加 compare 的測試）：

```python
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio

from app.admissions import stats
from app.admissions.academic import roc_month
from app.admissions.models import RecruitmentVisit
from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
# 台北 2026-10-01 12:00。服務層測試一律注入 now，近 30／90 天與逾期都相對這個時刻。
NOW = datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
HIGH = "時程未到／仍在觀望"


def days_ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def snap(visit, deposit, enrolled, transfer, pending, effective, v2d, v2e, d2e, e2e) -> dict:
    """期望值的 metric snapshot（比率已手算到小數一位）。"""
    return {
        "visit": visit, "deposit": deposit, "enrolled": enrolled, "transfer_term": transfer,
        "pending_deposit": pending, "effective_deposit": effective,
        "visit_to_deposit_rate": v2d, "visit_to_enrolled_rate": v2e,
        "deposit_to_enrolled_rate": d2e, "effective_to_enrolled_rate": e2e,
    }


EMPTY = snap(0, 0, 0, 0, 0, 0, None, None, None, None)


def add_visit(db, *, campus_key="yihua", visit_date=date(2026, 9, 1), child_name="測試幼生", birthday=None,
              grade=None, source=None, referrer=None, has_deposit=False, enrolled=False, transfer_term=False,
              no_deposit_reason=None, withdrawn_at=None, provisional_grade=None, target_school_year=115,
              target_semester=1, created_at=NOW) -> RecruitmentVisit:
    """直接寫一筆招生訪視（統計只讀資料，不經 API，才能控制 created_at）。month 用 A1 的 roc_month 由參觀日期換算。"""
    visit = RecruitmentVisit(
        id=uuid.uuid4(), campus_key=campus_key, month=roc_month(visit_date), seq_no=None, visit_date=visit_date,
        child_name=child_name, birthday=birthday, grade=grade, source=source, referrer=referrer,
        has_deposit=has_deposit, rides_bus=False, enrolled=enrolled,
        enrolled_on=visit_date + timedelta(days=10) if enrolled else None,
        transfer_term=transfer_term, no_deposit_reason=no_deposit_reason,
        withdrawn_at=withdrawn_at, withdrawn_from="deposited" if withdrawn_at else None,
        withdraw_reason="家長改送他校" if withdrawn_at else None,
        provisional_grade=provisional_grade, target_school_year=target_school_year, target_semester=target_semester,
        version=1, created_at=created_at, updated_at=created_at,
    )
    db.add(visit)
    return visit


@pytest_asyncio.fixture
async def reception_client(app, db_session):
    await _create_user(db_session, "stats-reception@ivy.example", "stats-reception-password-123", Role.RECEPTION, campus_keys=["yihua"])
    client = await _logged_in_client(app, "stats-reception@ivy.example", "stats-reception-password-123")
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def readonly_client(app, db_session):
    await _create_user(db_session, "stats-readonly@ivy.example", "stats-readonly-password-123", Role.READONLY, campus_keys=["yihua"])
    client = await _logged_in_client(app, "stats-readonly@ivy.example", "stats-readonly-password-123")
    yield client
    await client.aclose()


async def seed_r10(db) -> None:
    """R10 合成資料：義華 115 學年上學期 9 筆（V1–V9），另有 4 筆不該被算進來（X1–X4）。

    | 筆 | 參觀日 → 月份 | 姓名｜生日 | 年級 | 來源 | 介紹者 | 預繳 | 註冊 | 轉學期 | 未預繳原因 | 退出 | 建立 |
    | V1 | 08-10 → 115.08 | 王小明｜2022-03-01 | 小班 | Facebook | 林老師 | 是 | 是 | | | | 50 天前 |
    | V2 | 08-12 → 115.08 | 陳小華｜2022-05-02 | 小班 | Facebook | 林老師 | 是 | | | | | 95 天前 |
    | V3 | 08-15 → 115.08 | 李小美｜2021-04-03 | 中班 | 親友介紹 | 張老師 | 是 | | 是 | | | 29 天前 |
    | V4 | 09-03 → 115.09 | 林小安｜2022-06-04 | 小班 | Facebook | 林老師 | | | | 時程未到 | | 28 天前 |
    | V5 | 09-05 → 115.09 | 黃小雨｜2023-01-05 | 幼幼班 | Google 評論 | 張老師 | | | | （NULL） | | 26 天前 |
    | V6 | 09-10 → 115.09 | 吳小晴｜2021-02-06 | （NULL） | （NULL） | （NULL） | | | | 時程未到 | | 21 天前 |
    | V7 | 09-20 → 115.09 | 王小明｜2022-03-01（同 V1） | 小班 | Facebook | 林老師 | 是 | | | | | 11 天前 |
    | V8 | 09-25 → 115.09 | 周小宇｜2022-07-07 | 小班 | 親友介紹 | 林老師 | （退出後清掉） | | | 時程未到（舊值） | 2 天前退預繳 | 6 天前 |
    | V9 | 2025-12-15 → 114.12 | 鄭小芸｜2021-11-08 | 中班 | Facebook | 張老師 | 是 | 是 | | | | 290 天前 |
    """
    y = 2026
    add_visit(db, visit_date=date(y, 8, 10), child_name="王小明", birthday=date(2022, 3, 1), grade="小班", source="Facebook",
              referrer="林老師", has_deposit=True, enrolled=True, provisional_grade="小班", created_at=days_ago(50))
    add_visit(db, visit_date=date(y, 8, 12), child_name="陳小華", birthday=date(2022, 5, 2), grade="小班", source="Facebook",
              referrer="林老師", has_deposit=True, created_at=days_ago(95))
    add_visit(db, visit_date=date(y, 8, 15), child_name="李小美", birthday=date(2021, 4, 3), grade="中班", source="親友介紹",
              referrer="張老師", has_deposit=True, transfer_term=True, created_at=days_ago(29))
    add_visit(db, visit_date=date(y, 9, 3), child_name="林小安", birthday=date(2022, 6, 4), grade="小班", source="Facebook",
              referrer="林老師", no_deposit_reason=HIGH, created_at=days_ago(28))
    add_visit(db, visit_date=date(y, 9, 5), child_name="黃小雨", birthday=date(2023, 1, 5), grade="幼幼班", source="Google 評論",
              referrer="張老師", created_at=days_ago(26))
    add_visit(db, visit_date=date(y, 9, 10), child_name="吳小晴", birthday=date(2021, 2, 6), no_deposit_reason=HIGH,
              created_at=days_ago(21))
    add_visit(db, visit_date=date(y, 9, 20), child_name="王小明", birthday=date(2022, 3, 1), grade="小班", source="Facebook",
              referrer="林老師", has_deposit=True, created_at=days_ago(11))
    add_visit(db, visit_date=date(y, 9, 25), child_name="周小宇", birthday=date(2022, 7, 7), grade="小班", source="親友介紹",
              referrer="林老師", no_deposit_reason=HIGH, withdrawn_at=days_ago(2), created_at=days_ago(6))
    add_visit(db, visit_date=date(2025, 12, 15), child_name="鄭小芸", birthday=date(2021, 11, 8), grade="中班", source="Facebook",
              referrer="張老師", has_deposit=True, enrolled=True, provisional_grade="中班", created_at=days_ago(290))
    # X1 下學期、X2 114 學年、X3 沒填入學學期、X4 明華：篩選後都不在母體內。
    add_visit(db, visit_date=date(y, 9, 12), child_name="何小森", grade="大班", source="Facebook", has_deposit=True,
              target_semester=2, created_at=days_ago(15))
    add_visit(db, visit_date=date(y, 8, 20), child_name="許小樂", grade="大班", target_school_year=114, created_at=days_ago(40))
    add_visit(db, visit_date=date(y, 9, 18), child_name="蘇小晨", target_school_year=None, target_semester=None, created_at=days_ago(13))
    add_visit(db, campus_key="minghua", visit_date=date(y, 9, 22), child_name="楊小禾", has_deposit=True, created_at=days_ago(5))
    await db.commit()


async def test_stats_matches_ivy_semantics(db_session):
    """R10：每個指標都照園務 _visit_metric_cases 語意手算。"""
    await seed_r10(db_session)

    result = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)

    # 母體 V1–V9 共 9 筆。預繳 V1 V2 V3 V7 V9＝5；註冊 V1 V9＝2；轉學期 V3＝1；
    # 預繳未註冊未轉學期 V2 V7＝2；有效預繳（預繳且未轉學期）V1 V2 V7 V9＝4。
    # 比率：5/9＝55.6、2/9＝22.2、2/5＝40.0、2/4＝50.0。
    # 唯一幼生：V1 與 V7 同「王小明|2022-03-01」→ 9－1＝8；預繳唯一：V1 V2 V3 V7(=V1) V9 → 4。
    assert result["kpi"] == {**snap(9, 5, 2, 1, 2, 4, 55.6, 22.2, 40.0, 50.0), "unique_visit": 8, "unique_deposit": 4}
    assert result["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1, "reference_month": None}
    assert result["as_of"] == NOW

    # 月度（民國月份升序）：114.12＝V9；115.08＝V1 V2 V3；115.09＝V4–V8。
    # 115.08：預繳 3、註冊 1（V1）、轉學期 1（V3）、預繳未註冊 1（V2）、有效 2（V1 V2）→ 3/3＝100.0、1/3＝33.3、1/3＝33.3、1/2＝50.0
    # 115.09：預繳 1（V7）、有效 1、預繳未註冊 1 → 1/5＝20.0、0/5＝0.0、0/1＝0.0、0/1＝0.0
    assert result["monthly"] == [
        {"month": "114.12", **snap(1, 1, 1, 0, 0, 1, 100.0, 100.0, 100.0, 100.0)},
        {"month": "115.08", **snap(3, 3, 1, 1, 1, 2, 100.0, 33.3, 33.3, 50.0)},
        {"month": "115.09", **snap(5, 1, 0, 0, 1, 1, 20.0, 0.0, 0.0, 0.0)},
    ]
    assert sum(row["visit"] for row in result["monthly"]) == result["kpi"]["visit"]  # 不重不漏
    # 年度＝月份的民國年相加：115 年＝115.08＋115.09 → 8、4、1、1、2、3 → 4/8＝50.0、1/8＝12.5、1/4＝25.0、1/3＝33.3
    assert result["by_year"] == [
        {"year": "114", **snap(1, 1, 1, 0, 0, 1, 100.0, 100.0, 100.0, 100.0)},
        {"year": "115", **snap(8, 4, 1, 1, 2, 3, 50.0, 12.5, 25.0, 33.3)},
    ]

    # 參考月份預設最新的 115.09，上月 115.08。
    assert result["reference_month"] == "115.09"
    summary = result["decision_summary"]
    assert summary["current_month"] == snap(5, 1, 0, 0, 1, 1, 20.0, 0.0, 0.0, 0.0)
    # 近 30 天看 created_at（>= now－30 天）：V3(29) V4(28) V5(26) V6(21) V7(11) V8(6) → 6 筆；
    # 預繳 V3 V7＝2、轉學期 V3＝1、預繳未註冊 V7＝1、有效 V7＝1 → 2/6＝33.3、0/6＝0.0、0/2＝0.0、0/1＝0.0
    assert summary["rolling_30d"] == snap(6, 2, 0, 1, 1, 1, 33.3, 0.0, 0.0, 0.0)
    # 近 90 天：上列＋V1(50)；V2(95) 建立時間早於參觀日，證明看 created_at 不看月份 → 7 筆；
    # 預繳 V1 V3 V7＝3、註冊 V1＝1、轉學期 V3＝1、預繳未註冊 V7＝1、有效 V1 V7＝2
    # → 3/7＝42.9、1/7＝14.3、1/3＝33.3、1/2＝50.0
    assert summary["rolling_90d"] == snap(7, 3, 1, 1, 1, 2, 42.9, 14.3, 33.3, 50.0)
    # 年度累計＝同民國年、月份 <= 9：115.08＋115.09（114.12 不算）
    assert summary["ytd"] == snap(8, 4, 1, 1, 2, 3, 50.0, 12.5, 25.0, 33.3)
    assert result["funnel_snapshot"] == {
        "visit": 5, "deposit": 1, "enrolled": 0, "transfer_term": 0, "effective_deposit": 1, "pending_deposit": 1,
    }

    # 月比：115.09 對 115.08；delta＝round(本月－上月, 1)。
    assert result["month_over_month"] == {
        "current_month": "115.09", "previous_month": "115.08",
        "visit": {"current": 5, "previous": 3, "delta": 2},
        "deposit": {"current": 1, "previous": 3, "delta": -2},
        "enrolled": {"current": 0, "previous": 1, "delta": -1},
        "effective_deposit": {"current": 1, "previous": 2, "delta": -1},
        "pending_deposit": {"current": 1, "previous": 1, "delta": 0},
        "visit_to_deposit_rate": {"current": 20.0, "previous": 100.0, "delta": -80.0},
        "visit_to_enrolled_rate": {"current": 0.0, "previous": 33.3, "delta": -33.3},
        "deposit_to_enrolled_rate": {"current": 0.0, "previous": 33.3, "delta": -33.3},
        "effective_to_enrolled_rate": {"current": 0.0, "previous": 50.0, "delta": -50.0},
    }

    # 班別：小班 V1 V2 V4 V7 V8＝5（預繳 V1 V2 V7＝3、註冊 V1）→ 60.0、20.0、33.3；
    # 中班 V3 V9＝2（預繳 2、註冊 V9）→ 100.0、50.0、50.0；幼幼班 V5＝1 → 0.0、0.0、分母 0＝None；
    # 年級 NULL（V6）顯示「未填寫」。同為 1 筆時依標籤字碼升序：幼(U+5E7C) < 未(U+672A)。
    assert result["by_grade"] == [
        {"grade": "小班", "visit": 5, "deposit": 3, "enrolled": 1,
         "visit_to_deposit_rate": 60.0, "visit_to_enrolled_rate": 20.0, "deposit_to_enrolled_rate": 33.3},
        {"grade": "中班", "visit": 2, "deposit": 2, "enrolled": 1,
         "visit_to_deposit_rate": 100.0, "visit_to_enrolled_rate": 50.0, "deposit_to_enrolled_rate": 50.0},
        {"grade": "幼幼班", "visit": 1, "deposit": 0, "enrolled": 0,
         "visit_to_deposit_rate": 0.0, "visit_to_enrolled_rate": 0.0, "deposit_to_enrolled_rate": None},
        {"grade": "未填寫", "visit": 1, "deposit": 0, "enrolled": 0,
         "visit_to_deposit_rate": 0.0, "visit_to_enrolled_rate": 0.0, "deposit_to_enrolled_rate": None},
    ]
    assert result["month_grade"] == {
        "114.12": {"中班": 1, "合計": 1},
        "115.08": {"小班": 2, "中班": 1, "合計": 3},
        "115.09": {"小班": 3, "幼幼班": 1, "未填寫": 1, "合計": 5},
    }

    # 來源：Facebook V1 V2 V4 V7 V9＝5（預繳 4）→ 80.0；親友介紹 V3 V8＝2（預繳 1）→ 50.0；
    # Google 評論 1、未填寫 1 同票同預繳 → 來源升序，'G'(0x47) 排在「未」前面。
    assert result["by_source"] == [
        {"source": "Facebook", "visit": 5, "deposit": 4, "visit_to_deposit_rate": 80.0},
        {"source": "親友介紹", "visit": 2, "deposit": 1, "visit_to_deposit_rate": 50.0},
        {"source": "Google 評論", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
        {"source": "未填寫", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
    ]
    assert result["top_source_names"] == ["Facebook", "親友介紹", "Google 評論", "未填寫"]

    # 接待人員：林老師 V1 V2 V4 V7 V8＝5（預繳 3）→ 60.0，全是小班；
    # 張老師 V3 V5 V9＝3（預繳 V3 V9）→ 66.7，中班 2／2、幼幼班 1／0；V6 介紹者與年級都是 NULL。
    assert result["by_referrer"] == [
        {"referrer": "林老師", "visit": 5, "deposit": 3, "visit_to_deposit_rate": 60.0,
         "by_grade": {"小班": {"visit": 5, "deposit": 3}}},
        {"referrer": "張老師", "visit": 3, "deposit": 2, "visit_to_deposit_rate": 66.7,
         "by_grade": {"中班": {"visit": 2, "deposit": 2}, "幼幼班": {"visit": 1, "deposit": 0}}},
        {"referrer": "未填寫", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "by_grade": {"未填寫": {"visit": 1, "deposit": 0}}},
    ]
    # 介紹者 × 來源：欄是前 10 名來源，缺的補 0；total＝該介紹者全部來源合計。
    assert result["referrer_source_cross"] == {
        "sources": ["Facebook", "親友介紹", "Google 評論", "未填寫"],
        "referrers": [
            {"referrer": "林老師", "sources": {"Facebook": 4, "親友介紹": 1, "Google 評論": 0, "未填寫": 0}, "total": 5},
            {"referrer": "張老師", "sources": {"Facebook": 1, "親友介紹": 1, "Google 評論": 1, "未填寫": 0}, "total": 3},
            {"referrer": "未填寫", "sources": {"Facebook": 0, "親友介紹": 0, "Google 評論": 0, "未填寫": 1}, "total": 1},
        ],
    }

    # 未預繳母體＝未預繳且未退出：V4 V5 V6（V8 退預繳後 has_deposit=false，但不算，舊的高潛力原因也不算）。
    # 時程未到：V4（小班）、V6（未填寫）→ 2；原因 NULL 的 V5 →「未分類」1。
    assert result["no_deposit_reasons"] == [
        {"reason": HIGH, "count": 2, "by_grade": {"小班": 1, "未填寫": 1}, "priority": "high"},
        {"reason": "未分類", "count": 1, "by_grade": {"幼幼班": 1}, "priority": None},
    ]
    assert result["no_deposit_total"] == 3
    assert result["no_deposit_priority"] == {"high": 2, "medium": 0, "low": 0, "other": 1}
    # 高潛力 V4 V6＝2；建檔 <= now－14 天：V4(28) V5(26) V6(21)＝3；<= now－90 天：0；
    # 高潛力且逾 14 天：V4 V6＝2（V8 已退出，不算）。
    assert result["no_deposit_summary"] == {
        "high_potential_count": 2, "overdue_followup_count": 3, "cold_count": 0, "high_potential_backlog_count": 2,
    }

    # 警示：參觀轉預繳 delta －80.0 <= －10 → FUNNEL_DROP；高潛力積壓 2 < 5 不警示；
    # 近 90 天來源（V1 V3–V8）：Facebook 3 筆預繳 2，占比 42.9% 但預繳率 66.7% 不低於整體 3/7＝42.9% → 不失衡。
    assert result["alerts"] == [
        {
            "code": "FUNNEL_DROP", "level": "warning", "title": "本月漏斗轉換下滑",
            "message": "115.09 參觀轉預繳 -80.0 個百分點，參觀轉註冊 -33.3 個百分點。",
            "target_tab": "records", "target_filter": {"month": "115.09"},
        },
    ]
    assert result["top_action_queue"] == [
        {
            "code": "FOLLOW_HIGH_POTENTIAL", "title": "查看高風險未預繳",
            "description": "目前有 2 筆高潛力名單逾期未追。",
            "target_tab": "nodeposit", "target_filter": {"priority": "high", "overdue_days": 14},
        },
        {
            "code": "REVIEW_CURRENT_MONTH", "title": "查看本月明細",
            "description": "切換到 115.09 明細，檢查本月漏斗掉點。",
            "target_tab": "records", "target_filter": {"month": "115.09"},
        },
    ]


async def test_stats_endpoint_serializes_service_result(admin_client, db_session):
    await seed_r10(db_session)

    response = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&school_year=115&semester=1")

    assert response.status_code == 200, response.text
    body = response.json()
    # 不依賴現在時間的部分（近 30／90 天、逾期隨真實時鐘變動，由上一個測試注入 now 驗證）。
    assert body["kpi"] == {**snap(9, 5, 2, 1, 2, 4, 55.6, 22.2, 40.0, 50.0), "unique_visit": 8, "unique_deposit": 4}
    assert body["reference_month"] == "115.09"
    assert [row["grade"] for row in body["by_grade"]] == ["小班", "中班", "幼幼班", "未填寫"]
    assert body["by_grade"][2]["deposit_to_enrolled_rate"] is None
    assert body["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1, "reference_month": None}


async def test_cross_total_counts_sources_outside_top_ten(db_session):
    # 11 個來源各 1 筆、都同一位介紹者：前 10 名依來源升序是 來源01–來源10，來源11 不在欄上，
    # 但 total 仍是 11（園務 referrer_source_cross 的 total 含前 10 以外）。
    for n in range(1, 12):
        add_visit(db_session, campus_key="international", source=f"來源{n:02d}", referrer="林老師")
    await db_session.commit()

    result = await stats.query_stats(db_session, "international", school_year=None, semester=None, reference_month=None, now=NOW)

    assert result["top_source_names"] == [f"來源{n:02d}" for n in range(1, 11)]
    [row] = result["referrer_source_cross"]["referrers"]
    assert sum(row["sources"].values()) == 10
    assert row["total"] == 11


async def test_alert_thresholds_and_source_imbalance(db_session):
    # 明華：社區傳單 6 筆都是高潛力、未預繳——4 筆 20 天前、1 筆剛好 14 天前（<= 截止，算）、
    # 1 筆 14 天前再晚 1 秒（不算）；親友介紹 4 筆 10 天前、預繳 3。
    for _ in range(4):
        add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 10), source="社區傳單",
                  no_deposit_reason=HIGH, created_at=days_ago(20))
    add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 10), source="社區傳單",
              no_deposit_reason=HIGH, created_at=NOW - timedelta(days=14))
    add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 10), source="社區傳單",
              no_deposit_reason=HIGH, created_at=NOW - timedelta(days=14) + timedelta(seconds=1))
    for has_deposit in (True, True, True, False):
        add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 12), source="親友介紹",
                  has_deposit=has_deposit, created_at=days_ago(10))
    await db_session.commit()

    result = await stats.query_stats(db_session, "minghua", school_year=None, semester=None, reference_month=None, now=NOW)

    # 積壓 4＋1＝5 >= 5 → 警示。近 90 天共 10 筆、預繳 3 → 整體 30.0%；
    # 社區傳單 6/10＝60.0% >= 40 且預繳率 0.0% < 30.0% → 失衡；親友介紹 40.0% 但預繳率 75.0% → 不是。
    # 上月 115.08 沒資料：上月比率 None → 月比 delta None → 不判定漏斗下滑。
    assert result["month_over_month"]["visit_to_deposit_rate"] == {"current": 30.0, "previous": None, "delta": None}
    assert result["alerts"] == [
        {
            "code": "HIGH_POTENTIAL_BACKLOG", "level": "danger", "title": "高潛力未預繳名單堆積",
            "message": "超過 14 天仍未預繳的高潛力名單有 5 筆。",
            "target_tab": "nodeposit", "target_filter": {"priority": "high", "overdue_days": 14},
        },
        {
            "code": "SOURCE_IMBALANCE", "level": "info", "title": "來源結構失衡",
            "message": "社區傳單 近 90 天占比 60.0% ，預繳率 0.0% 低於整體 30.0%。",
            "target_tab": "source", "target_filter": {"source": "社區傳單"},
        },
    ]
    assert [action["code"] for action in result["top_action_queue"]] == [
        "FOLLOW_HIGH_POTENTIAL", "REVIEW_CURRENT_MONTH", "REVIEW_SOURCE",
    ]
    assert result["top_action_queue"][2] == {
        "code": "REVIEW_SOURCE", "title": "查看來源結構",
        "description": "社區傳單 近 90 天占比 60.0%，預繳率低於整體，先看這個來源的後續追蹤。",
        "target_tab": "source", "target_filter": {"source": "社區傳單"},
    }

    # 早 1 秒算：剛好 14 天前那筆變成「還沒逾期」→ 積壓 4 < 5，不警示；行動入口只要 > 0 就列。
    earlier = await stats.query_stats(
        db_session, "minghua", school_year=None, semester=None, reference_month=None, now=NOW - timedelta(seconds=1)
    )
    assert [alert["code"] for alert in earlier["alerts"]] == ["SOURCE_IMBALANCE"]
    assert earlier["top_action_queue"][0]["description"] == "目前有 4 筆高潛力名單逾期未追。"


async def test_funnel_drop_alert_at_exact_threshold(db_session):
    # 崇德：115.08 兩筆預繳 1 → 50.0%；115.09 五筆預繳 2 → 40.0%；delta＝－10.0，<= －10 也要警示。
    for has_deposit in (True, False):
        add_visit(db_session, campus_key="chongde", visit_date=date(2026, 8, 5), has_deposit=has_deposit)
    for has_deposit in (True, True, False, False, False):
        add_visit(db_session, campus_key="chongde", visit_date=date(2026, 9, 5), has_deposit=has_deposit)
    await db_session.commit()

    result = await stats.query_stats(db_session, "chongde", school_year=115, semester=1, reference_month=None, now=NOW)

    assert result["alerts"][0]["code"] == "FUNNEL_DROP"
    assert result["alerts"][0]["message"] == "115.09 參觀轉預繳 -10.0 個百分點，參觀轉註冊 0.0 個百分點。"


async def test_rolling_windows_cut_at_exact_instant_across_taipei_midnight(db_session):
    """R11：現在是台北 10/01 00:30（UTC 還是 09/30）。近 30／90 天以瞬間比較，截止點本身算在內。"""
    now = datetime(2026, 9, 30, 16, 30, tzinfo=timezone.utc)  # 台北 2026-10-01 00:30
    cut_30 = now - timedelta(days=30)  # 台北 2026-09-01 00:30
    cut_90 = now - timedelta(days=90)  # 台北 2026-07-03 00:30
    for created_at in (
        cut_30,                          # A：近 30、近 90
        cut_30 - timedelta(seconds=1),   # B：只有近 90
        cut_90,                          # C：近 90
        cut_90 - timedelta(seconds=1),   # D：都不算
        now - timedelta(hours=1),        # E：台北 09/30 23:30（台北的昨天、UTC 的今天）→ 都算
    ):
        add_visit(db_session, visit_date=date(2026, 9, 15), created_at=created_at)
    await db_session.commit()

    result = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=now)

    assert result["kpi"]["visit"] == 5
    assert result["decision_summary"]["rolling_30d"]["visit"] == 2  # A E
    assert result["decision_summary"]["rolling_90d"]["visit"] == 4  # A B C E
    assert result["as_of"] == now


async def test_reference_month_previous_month_and_ytd_cross_year(db_session):
    """R11：參考月份與上月跨年（115.01 的上月是 114.12），年度累計只算同一個民國年。"""
    add_visit(db_session, visit_date=date(2025, 12, 31), has_deposit=True)   # 114.12
    add_visit(db_session, visit_date=date(2026, 1, 1))                        # 115.01
    add_visit(db_session, visit_date=date(2026, 1, 20), has_deposit=True)    # 115.01
    await db_session.commit()

    default = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)
    assert [row["month"] for row in default["monthly"]] == ["114.12", "115.01"]
    assert default["reference_month"] == "115.01"
    mom = default["month_over_month"]
    assert (mom["current_month"], mom["previous_month"]) == ("115.01", "114.12")
    assert mom["visit"] == {"current": 2, "previous": 1, "delta": 1}
    # 1/2＝50.0 對 1/1＝100.0 → －50.0，觸發漏斗下滑。
    assert mom["visit_to_deposit_rate"] == {"current": 50.0, "previous": 100.0, "delta": -50.0}
    assert default["decision_summary"]["ytd"]["visit"] == 2  # 114.12 是去年，不算

    december = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="114.12", now=NOW)
    assert december["month_over_month"]["previous_month"] == "114.11"
    assert december["decision_summary"]["current_month"] == snap(1, 1, 0, 0, 1, 1, 100.0, 0.0, 0.0, 0.0)
    # 上月沒資料：計數是 0，比率是 None，delta 也是 None（園務會算成 100.0－0）。
    assert december["month_over_month"]["visit"] == {"current": 1, "previous": 0, "delta": 1}
    assert december["month_over_month"]["visit_to_deposit_rate"] == {"current": 100.0, "previous": None, "delta": None}
    assert december["decision_summary"]["ytd"]["visit"] == 1

    padded = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="115.1", now=NOW)
    assert padded["reference_month"] == "115.01"
    assert padded["filters"]["reference_month"] == "115.01"

    no_data = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="115.05", now=NOW)
    assert no_data["decision_summary"]["current_month"] == EMPTY
    assert no_data["decision_summary"]["ytd"]["visit"] == 2  # 115.01–115.05

    with pytest.raises(stats.InvalidReferenceMonth):
        await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="115.13", now=NOW)


async def test_invalid_reference_month_is_422(admin_client):
    response = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&reference_month=115-09")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_REFERENCE_MONTH"
    assert response.json()["detail"]["message"] == "月份格式應為 民國年.月，如 115.03"


async def test_stats_empty_campus(admin_client, db_session):
    """Review Focus 5：一筆訪視都沒有的校區——比率 null、參考月份 null、不報錯。"""
    result = await stats.query_stats(db_session, "renwu", school_year=115, semester=1, reference_month=None, now=NOW)

    assert result["kpi"] == {**EMPTY, "unique_visit": 0, "unique_deposit": 0}
    assert result["reference_month"] is None
    assert result["decision_summary"] == {"current_month": EMPTY, "rolling_30d": EMPTY, "rolling_90d": EMPTY, "ytd": EMPTY}
    assert result["funnel_snapshot"] == dict.fromkeys(
        ("visit", "deposit", "enrolled", "transfer_term", "effective_deposit", "pending_deposit"), 0
    )
    mom = result["month_over_month"]
    assert (mom["current_month"], mom["previous_month"]) == (None, None)
    assert mom["visit"] == {"current": 0, "previous": 0, "delta": 0}
    assert mom["visit_to_deposit_rate"] == {"current": None, "previous": None, "delta": None}
    for key in ("monthly", "by_year", "by_grade", "by_source", "top_source_names", "by_referrer",
                "no_deposit_reasons", "alerts", "top_action_queue"):
        assert result[key] == [], key
    assert result["month_grade"] == {}
    assert result["referrer_source_cross"] == {"referrers": [], "sources": []}
    assert result["no_deposit_total"] == 0
    assert result["no_deposit_priority"] == {"high": 0, "medium": 0, "low": 0, "other": 0}
    assert result["no_deposit_summary"] == dict.fromkeys(
        ("high_potential_count", "overdue_followup_count", "cold_count", "high_potential_backlog_count"), 0
    )

    response = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=renwu&school_year=115&semester=1")
    assert response.status_code == 200, response.text
    assert response.json()["reference_month"] is None
    assert response.json()["kpi"]["visit_to_deposit_rate"] is None


async def test_stats_permissions(reception_client, readonly_client, minghua_client, editor_client, admin_client):
    path = f"{API}/admin/admissions/stats?campus_key="
    # 接待人員有 admissions.read，只有義華。
    assert (await reception_client.get(path + "yihua")).status_code == 200
    assert (await reception_client.get(path + "minghua")).status_code == 404
    # 明華分校管理者看義華 → 404（不洩漏存在）。
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await minghua_client.get(path + "minghua")).status_code == 200
    # editor、readonly 沒有招生權限 → 403（規格 7：統計含接待人員名字，不開給只有 analytics.read 的角色）。
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_client.get(path + "yihua")).status_code == 403
    # 不存在的校區：總管理者也是 404。
    assert (await admin_client.get(path + "nowhere")).status_code == 404
```

- [ ] **Step 2：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q tests/test_admissions_stats.py
```

Expected: FAIL，收集階段就 `ImportError: cannot import name 'stats' from 'app.admissions'`。

- [ ] **Step 3：統計 schema**

`backend/app/admissions/schemas.py` 檔尾加（檔頭已有 `from __future__ import annotations`、`from datetime import datetime`、`from typing import Literal`、`from pydantic import BaseModel`；缺哪個就補在既有 import 區）：

```python
# ── 統計（C1）：欄位照園務 api/recruitment/stats.py::_query_stats，比率分母 0 為 None ──

AdmissionsStatsTarget = Literal["records", "nodeposit", "source"]


class AdmissionsMetricSnapshot(BaseModel):
    visit: int
    deposit: int
    enrolled: int
    transfer_term: int
    pending_deposit: int
    effective_deposit: int
    visit_to_deposit_rate: float | None
    visit_to_enrolled_rate: float | None
    deposit_to_enrolled_rate: float | None
    effective_to_enrolled_rate: float | None


class AdmissionsStatsKpi(AdmissionsMetricSnapshot):
    # 以「姓名|生日」去重（園務 stats.py:122-139）。
    unique_visit: int
    unique_deposit: int


class AdmissionsMonthlyRow(AdmissionsMetricSnapshot):
    month: str


class AdmissionsYearlyRow(AdmissionsMetricSnapshot):
    # 民國年（月份字串的年份部分），不是學年。
    year: str


class AdmissionsDecisionSummary(BaseModel):
    current_month: AdmissionsMetricSnapshot
    rolling_30d: AdmissionsMetricSnapshot
    rolling_90d: AdmissionsMetricSnapshot
    ytd: AdmissionsMetricSnapshot


class AdmissionsFunnelSnapshot(BaseModel):
    visit: int
    deposit: int
    enrolled: int
    transfer_term: int
    effective_deposit: int
    pending_deposit: int


class AdmissionsCountDiff(BaseModel):
    current: int
    previous: int
    delta: int


class AdmissionsRateDiff(BaseModel):
    current: float | None
    previous: float | None
    # 任一邊是 None（分母 0）就是 None。
    delta: float | None


class AdmissionsMonthOverMonth(BaseModel):
    current_month: str | None
    previous_month: str | None
    visit: AdmissionsCountDiff
    deposit: AdmissionsCountDiff
    enrolled: AdmissionsCountDiff
    effective_deposit: AdmissionsCountDiff
    pending_deposit: AdmissionsCountDiff
    visit_to_deposit_rate: AdmissionsRateDiff
    visit_to_enrolled_rate: AdmissionsRateDiff
    deposit_to_enrolled_rate: AdmissionsRateDiff
    effective_to_enrolled_rate: AdmissionsRateDiff


class AdmissionsStatsAlert(BaseModel):
    code: Literal["FUNNEL_DROP", "HIGH_POTENTIAL_BACKLOG", "SOURCE_IMBALANCE"]
    level: Literal["warning", "danger", "info"]
    title: str
    message: str
    # records＝訪視明細（帶 month）、nodeposit＝統計的未預繳原因、source＝統計的來源分析。
    target_tab: AdmissionsStatsTarget
    target_filter: dict[str, str | int]


class AdmissionsStatsAction(BaseModel):
    code: Literal["FOLLOW_HIGH_POTENTIAL", "REVIEW_CURRENT_MONTH", "REVIEW_SOURCE"]
    title: str
    description: str
    target_tab: AdmissionsStatsTarget
    target_filter: dict[str, str | int]


class AdmissionsGradeRow(BaseModel):
    grade: str
    visit: int
    deposit: int
    enrolled: int
    visit_to_deposit_rate: float | None
    visit_to_enrolled_rate: float | None
    deposit_to_enrolled_rate: float | None


class AdmissionsSourceRow(BaseModel):
    source: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None


class AdmissionsGradeCount(BaseModel):
    visit: int
    deposit: int


class AdmissionsReferrerRow(BaseModel):
    referrer: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    by_grade: dict[str, AdmissionsGradeCount]


class AdmissionsCrossRow(BaseModel):
    referrer: str
    sources: dict[str, int]
    # 該介紹者全部來源的合計（含前 10 名以外），不一定等於 sources 加總。
    total: int


class AdmissionsReferrerSourceCross(BaseModel):
    referrers: list[AdmissionsCrossRow]
    sources: list[str]


class AdmissionsNoDepositReason(BaseModel):
    reason: str
    count: int
    by_grade: dict[str, int]
    priority: Literal["high", "medium", "low"] | None


class AdmissionsNoDepositPriority(BaseModel):
    high: int
    medium: int
    low: int
    # 「未註明／待追蹤」與沒填原因（未分類）。
    other: int


class AdmissionsNoDepositSummary(BaseModel):
    high_potential_count: int
    overdue_followup_count: int
    cold_count: int
    high_potential_backlog_count: int


class AdmissionsStatsFilters(BaseModel):
    campus_key: str
    school_year: int | None
    semester: int | None
    reference_month: str | None


class AdmissionsStatsOut(BaseModel):
    as_of: datetime
    filters: AdmissionsStatsFilters
    reference_month: str | None
    kpi: AdmissionsStatsKpi
    decision_summary: AdmissionsDecisionSummary
    funnel_snapshot: AdmissionsFunnelSnapshot
    month_over_month: AdmissionsMonthOverMonth
    alerts: list[AdmissionsStatsAlert]
    top_action_queue: list[AdmissionsStatsAction]
    monthly: list[AdmissionsMonthlyRow]
    by_year: list[AdmissionsYearlyRow]
    by_grade: list[AdmissionsGradeRow]
    # {民國月份: {年級: 筆數, "合計": 筆數}}；畫面依 monthly 的月份順序取用。
    month_grade: dict[str, dict[str, int]]
    by_source: list[AdmissionsSourceRow]
    top_source_names: list[str]
    by_referrer: list[AdmissionsReferrerRow]
    referrer_source_cross: AdmissionsReferrerSourceCross
    no_deposit_reasons: list[AdmissionsNoDepositReason]
    no_deposit_total: int
    no_deposit_priority: AdmissionsNoDepositPriority
    no_deposit_summary: AdmissionsNoDepositSummary
```

- [ ] **Step 4：`stats.py`（統計查詢）**

`backend/app/admissions/stats.py`：

```python
"""招生統計（規格第 9 節）。

移植園務 ivy-backend dfd230c3 的 api/recruitment/stats.py::_query_stats 與 api/recruitment/shared.py
（_visit_metric_cases、_metric_snapshot、_select_reference_month、_build_month_over_month、
_build_ytd_snapshot、_build_alerts、_build_action_queue、_find_source_imbalance）。
只讀：不 flush、不 commit、不寫稽核。

刻意與園務不同（contracts/ivy-recruitment/README.md「統計與園務的差異」）：
- 比率分母 0 回 None（園務回 0）；月比任一邊是 None，delta 也是 None。
- 來源不做別名合併；不做童年綠地、行政區、預計就讀月份。
- 同票排序加第二鍵：標籤字串升序。
- 行動入口「查看區域機會」改為「查看來源結構」（REVIEW_SOURCE），只在來源失衡時出現。
- 參考月份格式錯丟 InvalidReferenceMonth（路由轉 422）；園務是未處理的 ValueError。
- SQL 只 GROUP BY 原始欄位，「未填寫」「未分類」在 Python 合併：asyncpg 用伺服器端參數，
  GROUP BY coalesce(x, $2) 與 SELECT coalesce(x, $1) 會被判定成不同運算式。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable, Iterable

from sqlalchemy import String, and_, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.academic import shift_roc_month
from app.admissions.constants import NO_DEPOSIT_PRIORITY
from app.admissions.models import RecruitmentVisit
from app.common.timezones import now_utc

# 門檻（園務 shared.py:54、77-82）。
TOP_SOURCES_COUNT = 10
FUNNEL_DROP_THRESHOLD = 10.0
HIGH_POTENTIAL_BACKLOG_THRESHOLD = 5
DEFAULT_OVERDUE_DAYS = 14
COLD_LEAD_DAYS = 90
SOURCE_IMBALANCE_SHARE_THRESHOLD = 40.0
ACTION_QUEUE_LIMIT = 3
ROLLING_SHORT_DAYS = 30
ROLLING_LONG_DAYS = 90

UNKNOWN_MONTH = "未知"
UNFILLED = "未填寫"
UNCLASSIFIED_REASON = "未分類"
MONTH_TOTAL = "合計"

COUNT_FIELDS = ("visit", "deposit", "enrolled", "transfer_term", "pending_deposit", "effective_deposit")
RATE_FIELDS = ("visit_to_deposit_rate", "visit_to_enrolled_rate", "deposit_to_enrolled_rate", "effective_to_enrolled_rate")
_MOM_COUNT_FIELDS = ("visit", "deposit", "enrolled", "effective_deposit", "pending_deposit")
_FUNNEL_FIELDS = ("visit", "deposit", "enrolled", "transfer_term", "effective_deposit", "pending_deposit")
_REASON_PRIORITY = {reason: level for level, reasons in NO_DEPOSIT_PRIORITY.items() for reason in reasons}
_SUMMARY_FIELDS = ("high_potential_count", "overdue_followup_count", "cold_count", "high_potential_backlog_count")


class InvalidReferenceMonth(ValueError):
    """參考月份不是「民國年.月」。訊息照園務 utils/roc_month_utils.py 原文。"""


def pct(num: int, den: int) -> float | None:
    """百分比到小數一位；分母 0 回 None（規格 9.2，園務回 0）。"""
    return round(num / den * 100, 1) if den else None


def metric_snapshot(
    visit: int = 0,
    deposit: int = 0,
    enrolled: int = 0,
    transfer_term: int = 0,
    pending_deposit: int = 0,
    effective_deposit: int = 0,
) -> dict[str, Any]:
    return {
        "visit": visit,
        "deposit": deposit,
        "enrolled": enrolled,
        "transfer_term": transfer_term,
        "pending_deposit": pending_deposit,
        "effective_deposit": effective_deposit,
        "visit_to_deposit_rate": pct(deposit, visit),
        "visit_to_enrolled_rate": pct(enrolled, visit),
        "deposit_to_enrolled_rate": pct(enrolled, deposit),
        "effective_to_enrolled_rate": pct(enrolled, effective_deposit),
    }


def normalize_roc_month(value: str | None) -> str | None:
    """「115.3」→「115.03」；空值回 None；格式錯丟 InvalidReferenceMonth。"""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    parts = text.split(".")
    if len(parts) != 2:
        raise InvalidReferenceMonth("月份格式應為 民國年.月，如 115.03")
    try:
        year, month = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise InvalidReferenceMonth("月份格式錯誤") from exc
    if year <= 0:
        raise InvalidReferenceMonth(f"年份須為正整數，收到 {parts[0]}")
    if not 1 <= month <= 12:
        raise InvalidReferenceMonth(f"月份須在 1-12 之間，收到 {month}")
    return f"{year}.{month:02d}"


def _safe_normalize(value: str | None) -> str | None:
    try:
        return normalize_roc_month(value)
    except InvalidReferenceMonth:
        stripped = (value or "").strip()
        return stripped or None


def roc_month_sort_key(value: str | None) -> tuple[int, int, str]:
    """園務 roc_month_sort_key：無法解析的排倒數第二，空值與「未知」排最後。"""
    normalized = _safe_normalize(value)
    if normalized in (None, "", UNKNOWN_MONTH):
        return (999999, 99, normalized or "")
    parts = normalized.split(".")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return (999998, 99, normalized)
    return (int(parts[0]), int(parts[1]), normalized)


def _month_parts(value: str) -> tuple[int, int]:
    normalized = normalize_roc_month(value)
    if normalized is None:
        raise InvalidReferenceMonth("月份格式錯誤")
    year, month = normalized.split(".")
    return int(year), int(month)


def _previous_month(month: str | None) -> str | None:
    if not month:
        return None
    try:
        _month_parts(month)
    except InvalidReferenceMonth:
        return None
    return shift_roc_month(month, -1)


def _label(value: str | None, fallback: str) -> str:
    return fallback if value is None else value


def _metric_cases() -> dict[str, Any]:
    """園務 _visit_metric_cases：effective＝預繳且未轉學期；pending＝預繳、未註冊、未轉學期。"""
    v = RecruitmentVisit
    return {
        "deposit": case((v.has_deposit.is_(True), 1), else_=0),
        "enrolled": case((v.enrolled.is_(True), 1), else_=0),
        "transfer_term": case((v.transfer_term.is_(True), 1), else_=0),
        "pending_deposit": case(
            (and_(v.has_deposit.is_(True), v.enrolled.is_(False), v.transfer_term.is_(False)), 1), else_=0
        ),
        "effective_deposit": case((and_(v.has_deposit.is_(True), v.transfer_term.is_(False)), 1), else_=0),
    }


def _count_columns() -> list[Any]:
    return [
        func.count(RecruitmentVisit.id).label("visit"),
        *(func.coalesce(func.sum(expr), 0).label(name) for name, expr in _metric_cases().items()),
    ]


def _counts(row: Any) -> dict[str, int]:
    return {name: int(getattr(row, name) or 0) for name in COUNT_FIELDS}


def _base_filters(campus_key: str, school_year: int | None, semester: int | None) -> list[Any]:
    filters: list[Any] = [RecruitmentVisit.campus_key == campus_key]
    if school_year is not None:
        filters.append(RecruitmentVisit.target_school_year == school_year)
    if semester is not None:
        filters.append(RecruitmentVisit.target_semester == semester)
    return filters


async def _aggregate(db: AsyncSession, filters: list[Any]) -> dict[str, Any]:
    row = (await db.execute(select(*_count_columns()).where(*filters))).one()
    return metric_snapshot(**_counts(row))


async def _grouped(db: AsyncSession, filters: list[Any], *columns: Any) -> list[Any]:
    stmt = select(*columns, *_count_columns()).where(*filters).group_by(*columns)
    return list((await db.execute(stmt)).all())


def _merge(rows: Iterable[Any], key: Callable[[Any], Any]) -> dict[Any, dict[str, int]]:
    """依標籤合併計數：NULL 與字面上的「未填寫」併成同一組（園務 SQL 分組後也是同一個標籤）。"""
    merged: dict[Any, dict[str, int]] = {}
    for row in rows:
        bucket = merged.setdefault(key(row), dict.fromkeys(COUNT_FIELDS, 0))
        for name, value in _counts(row).items():
            bucket[name] += value
    return merged


async def _unique_counts(db: AsyncSession, filters: list[Any]) -> tuple[int, int]:
    """園務 stats.py:122-139：coalesce(姓名,'')||'|'||coalesce(生日字串,'')，不 trim、不分大小寫。
    已匿名化的列姓名都是同一段固定文字、生日為空，照園務的鍵會被併成同一個孩子；
    改用列 id 當鍵，一筆算一個（2026-10-01 主 session 補，對應 A 調整第 30 條）。"""
    person_key = func.coalesce(RecruitmentVisit.child_name, "") + "|" + func.coalesce(cast(RecruitmentVisit.birthday, String), "")
    key = case(
        (RecruitmentVisit.anonymized_at.is_not(None), "anonymized|" + cast(RecruitmentVisit.id, String)),
        else_=person_key,
    )
    deposit_key = case((RecruitmentVisit.has_deposit.is_(True), key), else_=None)
    row = (
        await db.execute(select(func.count(func.distinct(key)), func.count(func.distinct(deposit_key))).where(*filters))
    ).one()
    return int(row[0] or 0), int(row[1] or 0)


def _monthly(rows: list[Any]) -> list[dict[str, Any]]:
    merged = _merge(rows, lambda row: _label(row.month, UNKNOWN_MONTH))
    return sorted(
        ({"month": month, **metric_snapshot(**counts)} for month, counts in merged.items()),
        key=lambda item: roc_month_sort_key(item["month"]),
    )


def _by_year(monthly: list[dict[str, Any]]) -> list[dict[str, Any]]:
    yearly: dict[str, dict[str, int]] = {}
    for row in monthly:
        label = row["month"]
        if label in (None, "", UNKNOWN_MONTH) or "." not in label:
            continue
        bucket = yearly.setdefault(label.split(".", 1)[0], dict.fromkeys(COUNT_FIELDS, 0))
        for name in COUNT_FIELDS:
            bucket[name] += row[name]
    order = sorted(yearly, key=lambda year: (int(year) if year.isdigit() else 999999, year))
    return [{"year": year, **metric_snapshot(**yearly[year])} for year in order]


def _by_grade(rows: list[Any]) -> list[dict[str, Any]]:
    merged = _merge(rows, lambda row: _label(row.grade, UNFILLED))
    result = [
        {
            "grade": grade,
            "visit": c["visit"],
            "deposit": c["deposit"],
            "enrolled": c["enrolled"],
            "visit_to_deposit_rate": pct(c["deposit"], c["visit"]),
            "visit_to_enrolled_rate": pct(c["enrolled"], c["visit"]),
            "deposit_to_enrolled_rate": pct(c["enrolled"], c["deposit"]),
        }
        for grade, c in merged.items()
    ]
    return sorted(result, key=lambda item: (-item["visit"], item["grade"]))


def _month_grade(rows: list[Any]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for row in rows:
        bucket = result.setdefault(_label(row.month, UNKNOWN_MONTH), {})
        grade = _label(row.grade, UNFILLED)
        bucket[grade] = bucket.get(grade, 0) + row.visit
        bucket[MONTH_TOTAL] = bucket.get(MONTH_TOTAL, 0) + row.visit
    return result


def _by_source(rows: list[Any]) -> list[dict[str, Any]]:
    merged = _merge(rows, lambda row: _label(row.source, UNFILLED))
    result = [
        {"source": source, "visit": c["visit"], "deposit": c["deposit"], "visit_to_deposit_rate": pct(c["deposit"], c["visit"])}
        for source, c in merged.items()
    ]
    return sorted(result, key=lambda item: (-item["visit"], -item["deposit"], item["source"]))


def _by_referrer(rows: list[Any]) -> list[dict[str, Any]]:
    referrers: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = _label(row.referrer, UNFILLED)
        bucket = referrers.setdefault(name, {"referrer": name, "visit": 0, "deposit": 0, "by_grade": {}})
        counts = _counts(row)
        bucket["visit"] += counts["visit"]
        bucket["deposit"] += counts["deposit"]
        cell = bucket["by_grade"].setdefault(_label(row.grade, UNFILLED), {"visit": 0, "deposit": 0})
        cell["visit"] += counts["visit"]
        cell["deposit"] += counts["deposit"]
    result = [{**bucket, "visit_to_deposit_rate": pct(bucket["deposit"], bucket["visit"])} for bucket in referrers.values()]
    return sorted(result, key=lambda item: (-item["visit"], item["referrer"]))


def _referrer_source_cross(rows: list[Any], top_source_names: list[str]) -> dict[str, Any]:
    raw: dict[str, dict[str, int]] = {}
    for row in rows:
        sources = raw.setdefault(_label(row.referrer, UNFILLED), {})
        source = _label(row.source, UNFILLED)
        sources[source] = sources.get(source, 0) + row.visit
    referrers = [
        {"referrer": name, "sources": {s: counts.get(s, 0) for s in top_source_names}, "total": sum(counts.values())}
        for name, counts in raw.items()
    ]
    referrers.sort(key=lambda item: (-item["total"], item["referrer"]))
    return {"referrers": referrers, "sources": list(top_source_names)}


def _no_deposit_reasons(rows: list[Any]) -> list[dict[str, Any]]:
    reasons: dict[str, dict[str, Any]] = {}
    for row in rows:
        reason = _label(row.no_deposit_reason, UNCLASSIFIED_REASON)
        bucket = reasons.setdefault(
            reason, {"reason": reason, "count": 0, "by_grade": {}, "priority": _REASON_PRIORITY.get(reason)}
        )
        grade = _label(row.grade, UNFILLED)
        bucket["count"] += row.visit
        bucket["by_grade"][grade] = bucket["by_grade"].get(grade, 0) + row.visit
    return sorted(reasons.values(), key=lambda item: (-item["count"], item["reason"]))


def _priority_totals(reasons: list[dict[str, Any]]) -> dict[str, int]:
    totals = {"high": 0, "medium": 0, "low": 0, "other": 0}
    for row in reasons:
        totals[row["priority"] or "other"] += row["count"]
    return totals


async def _no_deposit_summary(db: AsyncSession, filters: list[Any], now: datetime) -> dict[str, int]:
    """園務 /no-deposit-analysis 的 summary 與 alerts 的積壓數（/stats 只回數字；名單在 C2b 的 no_deposit_records）。"""
    v = RecruitmentVisit
    high = v.no_deposit_reason.in_(NO_DEPOSIT_PRIORITY["high"])
    overdue = v.created_at <= now - timedelta(days=DEFAULT_OVERDUE_DAYS)
    cold = v.created_at <= now - timedelta(days=COLD_LEAD_DAYS)
    row = (
        await db.execute(
            select(
                func.count(v.id).filter(high).label("high_potential_count"),
                func.count(v.id).filter(overdue).label("overdue_followup_count"),
                func.count(v.id).filter(cold).label("cold_count"),
                func.count(v.id).filter(and_(high, overdue)).label("high_potential_backlog_count"),
            ).where(*filters)
        )
    ).one()
    return {name: int(getattr(row, name) or 0) for name in _SUMMARY_FIELDS}


async def _find_source_imbalance(db: AsyncSession, filters: list[Any], window_start: datetime) -> dict[str, Any] | None:
    """園務 shared.py:494-534：近 90 天占比 >= 40% 且預繳率低於整體（各自先 round 一位再比）。
    同占比時取標籤升序的第一個（園務取 SQL 回傳順序）。"""
    rows = await _grouped(db, [*filters, RecruitmentVisit.created_at >= window_start], RecruitmentVisit.source)
    merged = _merge(rows, lambda row: _label(row.source, UNFILLED))
    total_visit = sum(c["visit"] for c in merged.values())
    if not total_visit:
        return None
    total_deposit = sum(c["deposit"] for c in merged.values())
    overall_rate = round(total_deposit / total_visit * 100, 1)
    candidate: dict[str, Any] | None = None
    for source in sorted(merged):
        visit, deposit = merged[source]["visit"], merged[source]["deposit"]
        if not visit:
            continue
        share = round(visit / total_visit * 100, 1)
        deposit_rate = round(deposit / visit * 100, 1)
        if share >= SOURCE_IMBALANCE_SHARE_THRESHOLD and deposit_rate < overall_rate:
            if candidate is None or share > candidate["share"]:
                candidate = {
                    "source": source, "visit": visit, "deposit": deposit,
                    "share": share, "deposit_rate": deposit_rate, "overall_rate": overall_rate,
                }
    return candidate


def _ytd_snapshot(reference_month: str | None, monthly_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not reference_month:
        return metric_snapshot()
    ref_year, ref_month = _month_parts(reference_month)
    totals = dict.fromkeys(COUNT_FIELDS, 0)
    for label, row in monthly_map.items():
        try:
            year, month = _month_parts(label)
        except InvalidReferenceMonth:
            continue
        if year != ref_year or month > ref_month:
            continue
        for name in COUNT_FIELDS:
            totals[name] += row[name]
    return metric_snapshot(**totals)


def _month_over_month(
    current_month: str | None, previous_month: str | None, monthly_map: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    empty = metric_snapshot()
    current = monthly_map.get(current_month, empty) if current_month else empty
    previous = monthly_map.get(previous_month, empty) if previous_month else empty
    result: dict[str, Any] = {"current_month": current_month, "previous_month": previous_month}
    for name in _MOM_COUNT_FIELDS:
        result[name] = {"current": current[name], "previous": previous[name], "delta": current[name] - previous[name]}
    for name in RATE_FIELDS:
        cur, prev = current[name], previous[name]
        delta = round(cur - prev, 1) if cur is not None and prev is not None else None
        result[name] = {"current": cur, "previous": prev, "delta": delta}
    return result


def _points(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f}"


def _alerts(
    month_over_month: dict[str, Any], backlog: int, imbalance: dict[str, Any] | None, reference_month: str | None
) -> list[dict[str, Any]]:
    """園務 shared.py:377-439，文案逐字照抄（含「占比 x% ，」的半形空格與全形句號）。"""
    alerts: list[dict[str, Any]] = []
    to_deposit = month_over_month["visit_to_deposit_rate"]["delta"]
    to_enrolled = month_over_month["visit_to_enrolled_rate"]["delta"]
    dropped = [delta for delta in (to_deposit, to_enrolled) if delta is not None and delta <= -FUNNEL_DROP_THRESHOLD]
    if dropped and reference_month:
        alerts.append({
            "code": "FUNNEL_DROP",
            "level": "warning",
            "title": "本月漏斗轉換下滑",
            "message": f"{reference_month} 參觀轉預繳 {_points(to_deposit)} 個百分點，參觀轉註冊 {_points(to_enrolled)} 個百分點。",
            "target_tab": "records",
            "target_filter": {"month": reference_month},
        })
    if backlog >= HIGH_POTENTIAL_BACKLOG_THRESHOLD:
        alerts.append({
            "code": "HIGH_POTENTIAL_BACKLOG",
            "level": "danger",
            "title": "高潛力未預繳名單堆積",
            "message": f"超過 {DEFAULT_OVERDUE_DAYS} 天仍未預繳的高潛力名單有 {backlog} 筆。",
            "target_tab": "nodeposit",
            "target_filter": {"priority": "high", "overdue_days": DEFAULT_OVERDUE_DAYS},
        })
    if imbalance:
        alerts.append({
            "code": "SOURCE_IMBALANCE",
            "level": "info",
            "title": "來源結構失衡",
            "message": (
                f"{imbalance['source']} 近 90 天占比 {imbalance['share']:.1f}% ，"
                f"預繳率 {imbalance['deposit_rate']:.1f}% 低於整體 {imbalance['overall_rate']:.1f}%。"
            ),
            "target_tab": "source",
            "target_filter": {"source": imbalance["source"]},
        })
    return alerts


def _action_queue(current_month: str | None, backlog: int, imbalance: dict[str, Any] | None) -> list[dict[str, Any]]:
    """園務 shared.py:442-491。官網不做行政區，AREA_OPPORTUNITY 改成 REVIEW_SOURCE。"""
    actions: list[dict[str, Any]] = []
    if backlog:
        actions.append({
            "code": "FOLLOW_HIGH_POTENTIAL",
            "title": "查看高風險未預繳",
            "description": f"目前有 {backlog} 筆高潛力名單逾期未追。",
            "target_tab": "nodeposit",
            "target_filter": {"priority": "high", "overdue_days": DEFAULT_OVERDUE_DAYS},
        })
    if current_month:
        actions.append({
            "code": "REVIEW_CURRENT_MONTH",
            "title": "查看本月明細",
            "description": f"切換到 {current_month} 明細，檢查本月漏斗掉點。",
            "target_tab": "records",
            "target_filter": {"month": current_month},
        })
    if imbalance:
        actions.append({
            "code": "REVIEW_SOURCE",
            "title": "查看來源結構",
            "description": f"{imbalance['source']} 近 90 天占比 {imbalance['share']:.1f}%，預繳率低於整體，先看這個來源的後續追蹤。",
            "target_tab": "source",
            "target_filter": {"source": imbalance["source"]},
        })
    return actions[:ACTION_QUEUE_LIMIT]


async def query_stats(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    reference_month: str | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """單校統計。school_year／semester 為 None 時不篩（同園務）；沒填入學學期的訪視在有篩選時不算。"""
    now = now or now_utc()
    requested_month = normalize_roc_month(reference_month)
    filters = _base_filters(campus_key, school_year, semester)
    v = RecruitmentVisit

    kpi = await _aggregate(db, filters)
    unique_visit, unique_deposit = await _unique_counts(db, filters)
    monthly = _monthly(await _grouped(db, filters, v.month))
    by_source = _by_source(await _grouped(db, filters, v.source))
    top_source_names = [row["source"] for row in by_source[:TOP_SOURCES_COUNT]]

    # 未預繳母體排除已退出（園務 stats.py:395-435）：退預繳／退註冊會清 has_deposit，
    # 不排除的話會把「預繳過又退掉」算成從未預繳，舊的高潛力原因也會灌進積壓數。
    no_deposit_filters = [*filters, v.has_deposit.is_(False), v.withdrawn_at.is_(None)]
    no_deposit_reasons = _no_deposit_reasons(await _grouped(db, no_deposit_filters, v.no_deposit_reason, v.grade))
    summary = await _no_deposit_summary(db, no_deposit_filters, now)

    monthly_map = {(_safe_normalize(row["month"]) or row["month"]): row for row in monthly}
    resolved_month = requested_month or (_safe_normalize(monthly[-1]["month"]) if monthly else None)
    previous_month = _previous_month(resolved_month)
    current_row = monthly_map.get(resolved_month) if resolved_month else None
    current_snapshot = metric_snapshot(**{name: current_row[name] for name in COUNT_FIELDS}) if current_row else metric_snapshot()
    month_over_month = _month_over_month(resolved_month, previous_month, monthly_map)
    imbalance = await _find_source_imbalance(db, filters, now - timedelta(days=ROLLING_LONG_DAYS))
    backlog = summary["high_potential_backlog_count"]

    return {
        "as_of": now,
        "filters": {
            "campus_key": campus_key, "school_year": school_year, "semester": semester, "reference_month": requested_month,
        },
        "reference_month": resolved_month,
        "kpi": {**kpi, "unique_visit": unique_visit, "unique_deposit": unique_deposit},
        "decision_summary": {
            "current_month": current_snapshot,
            # 近 30／90 天依 created_at（園務 stats.py:502-507），不看 month 欄。
            "rolling_30d": await _aggregate(db, [*filters, v.created_at >= now - timedelta(days=ROLLING_SHORT_DAYS)]),
            "rolling_90d": await _aggregate(db, [*filters, v.created_at >= now - timedelta(days=ROLLING_LONG_DAYS)]),
            "ytd": _ytd_snapshot(resolved_month, monthly_map),
        },
        "funnel_snapshot": {name: current_snapshot[name] for name in _FUNNEL_FIELDS},
        "month_over_month": month_over_month,
        "alerts": _alerts(month_over_month, backlog, imbalance, resolved_month),
        "top_action_queue": _action_queue(resolved_month, backlog, imbalance),
        "monthly": monthly,
        "by_year": _by_year(monthly),
        "by_grade": _by_grade(await _grouped(db, filters, v.grade)),
        "month_grade": _month_grade(await _grouped(db, filters, v.month, v.grade)),
        "by_source": by_source,
        "top_source_names": top_source_names,
        "by_referrer": _by_referrer(await _grouped(db, filters, v.referrer, v.grade)),
        "referrer_source_cross": _referrer_source_cross(await _grouped(db, filters, v.referrer, v.source), top_source_names),
        "no_deposit_reasons": no_deposit_reasons,
        "no_deposit_total": sum(row["count"] for row in no_deposit_reasons),
        "no_deposit_priority": _priority_totals(no_deposit_reasons),
        "no_deposit_summary": summary,
    }
```

- [ ] **Step 5：端點**

`backend/app/admissions/routes.py` import 區補上（已有的不重複）：

```python
from fastapi import HTTPException, Query, status
from app.admissions import stats as stats_service
from app.admissions.schemas import AdmissionsStatsOut
from app.auth.permissions import ScopeDenied, require_scope
from app.campuses.models import CAMPUS_KEYS
```

檔尾加：

```python
@router.get("/admin/admissions/stats", response_model=AdmissionsStatsOut)
async def get_admissions_stats(
    campus_key: str,
    school_year: int | None = Query(default=None, ge=1, le=999),
    semester: int | None = Query(default=None, ge=1, le=2),
    reference_month: str | None = Query(default=None, max_length=10, description="民國月份，例：115.09；不帶＝最新有資料的月份"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdmissionsStatsOut:
    """統計分析（規格第 9 節）。只讀，不寫稽核。"""
    require_scope(current_user, "admissions.read", campus_keys=[campus_key])
    if campus_key not in CAMPUS_KEYS:
        raise ScopeDenied()
    try:
        result = await stats_service.query_stats(
            db, campus_key, school_year=school_year, semester=semester, reference_month=reference_month
        )
    except stats_service.InvalidReferenceMonth as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_REFERENCE_MONTH", "message": str(exc)},
        ) from exc
    return AdmissionsStatsOut.model_validate(result)
```

- [ ] **Step 6：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q tests/test_admissions_stats.py
```

Expected: `10 passed`。若 `test_stats_matches_ivy_semantics` 某一段不同，先對照該段註解裡的手算過程找出是資料還是公式錯，不要改期望值去湊。

- [ ] **Step 7：重產契約**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm run contract:generate
npm run contract:check
grep -c "AdmissionsStatsOut" contracts/generated/website-api.d.ts
```

Expected: `contract:check` 無差異；最後一行 >= 1。

- [ ] **Step 8：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/stats.py backend/app/admissions/schemas.py backend/app/admissions/routes.py \
  backend/tests/test_admissions_stats.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 統計分析查詢（移植園務 _query_stats，分母 0 回 null）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C2：五校比較 `compare` 與 `GET /admin/admissions/compare`

**Files:**
- Modify: `backend/app/admissions/stats.py`（import 區＋檔尾加 `compare`）
- Modify: `backend/app/admissions/schemas.py`（檔尾加 `AdmissionsRate`、`AdmissionsCompareRow`）
- Modify: `backend/app/admissions/routes.py`（import 區＋檔尾加端點）
- Test: `backend/tests/test_admissions_stats.py`（檔尾追加）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes：`app.admissions.intake.intake_plan(db, campus_key, school_year, semester) -> dict`（A5；`rows[*]` 有 `grade`、`target_seats: int | None`、`reserved`、`enrolled`、`remaining: int | None`）、`app.admissions.models.GradeIntakeTarget`（A2）、C1 的 `pct`、`_metric_cases`／`_count_columns`／`_counts`、`app.auth.permissions.covers_campus`。
- Produces：
  - `async def compare(db, campus_keys: list[str], *, school_year: int, semester: int) -> list[dict]`：依傳入順序每校一列。
  - `AdmissionsRate`：`{value: float | None, numerator: int, denominator: int}`
  - `AdmissionsCompareRow`：`campus_key`、`visit`、`deposit`、`enrolled`、`transfer_term`、`effective_deposit`、`pending_deposit`、四個比率（`AdmissionsRate`）、`target_seats: int | None`、`remaining_seats: int | None`、`grades_with_target: int`
  - API：`GET /api/website/v1/admin/admissions/compare?school_year=&semester=` → `list[AdmissionsCompareRow]`；`admissions.read`；列出 `CAMPUS_KEYS` 中使用者涵蓋的校區（super_admin 五校、分校帳號只有自己的）；兩個參數必填。

名額規則（規格 9.3）：`remaining_seats` 只加總「有計畫名額列」的年級的 `remaining`（計畫 0 也算有設定）；一個都沒有就是 `None`。`target_seats` 同理。計數與比率的母體是 `target_school_year == school_year AND target_semester == semester`，比率帶分子分母，畫面寫「招生案件數」（不是跨校去重後的孩子數）。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_stats.py` 的 import 區加：

```python
from app.admissions.models import GradeIntakeTarget
```

檔尾追加：

```python
def add_target(db, *, campus_key: str, grade: str, seats: int, school_year: int = 115, semester: int = 1) -> None:
    db.add(GradeIntakeTarget(
        id=uuid.uuid4(), campus_key=campus_key, grade=grade, school_year=school_year, semester=semester,
        target_seats=seats, created_at=NOW, updated_at=NOW, updated_by=None,
    ))


def rate(value, numerator, denominator) -> dict:
    return {"value": value, "numerator": numerator, "denominator": denominator}


NO_RATE = rate(None, 0, 0)


async def seed_compare(db) -> None:
    # 義華 115 上：小班已保留 1、中班已註冊 1、大班已保留 1（大班沒計畫）、小班未預繳 1；另 1 筆是下學期。
    add_visit(db, grade="小班", has_deposit=True, provisional_grade="小班")
    add_visit(db, grade="中班", has_deposit=True, enrolled=True, provisional_grade="中班")
    add_visit(db, grade="大班", has_deposit=True, provisional_grade="大班")
    add_visit(db, grade="小班")
    add_visit(db, grade="小班", has_deposit=True, target_semester=2)
    add_target(db, campus_key="yihua", grade="小班", seats=10)
    add_target(db, campus_key="yihua", grade="中班", seats=0)   # 設成 0 也算「有設定」
    # 明華 115 上：1 筆未預繳，沒有任何計畫名額。
    add_visit(db, campus_key="minghua", grade="中班")
    await db.commit()


async def test_compare_rows_and_seats(db_session):
    await seed_compare(db_session)

    rows = await stats.compare(db_session, ["yihua", "minghua", "renwu"], school_year=115, semester=1)

    assert [row["campus_key"] for row in rows] == ["yihua", "minghua", "renwu"]
    # 義華：4 筆、預繳 3、註冊 1、有效預繳 3、預繳未註冊 2（小班、大班保留中）
    # → 3/4＝75.0、1/4＝25.0、1/3＝33.3、1/3＝33.3。
    # 剩餘：小班 10－1－0＝9，中班 0－0－1＝－1，大班沒計畫不算 → 8；計畫合計 10＋0＝10。
    assert rows[0] == {
        "campus_key": "yihua", "visit": 4, "deposit": 3, "enrolled": 1, "transfer_term": 0,
        "effective_deposit": 3, "pending_deposit": 2,
        "visit_to_deposit_rate": rate(75.0, 3, 4), "visit_to_enrolled_rate": rate(25.0, 1, 4),
        "deposit_to_enrolled_rate": rate(33.3, 1, 3), "effective_to_enrolled_rate": rate(33.3, 1, 3),
        "target_seats": 10, "remaining_seats": 8, "grades_with_target": 2,
    }


async def test_compare_without_targets(db_session):
    """Review Focus 5：沒設計畫名額＝未設定（None），不是 0；沒資料的比率是 None。"""
    await seed_compare(db_session)

    rows = await stats.compare(db_session, ["minghua", "renwu"], school_year=115, semester=1)

    # 明華：1 筆未預繳 → 0/1＝0.0；預繳 0 → 後兩個比率分母 0＝None。
    assert rows[0] == {
        "campus_key": "minghua", "visit": 1, "deposit": 0, "enrolled": 0, "transfer_term": 0,
        "effective_deposit": 0, "pending_deposit": 0,
        "visit_to_deposit_rate": rate(0.0, 0, 1), "visit_to_enrolled_rate": rate(0.0, 0, 1),
        "deposit_to_enrolled_rate": NO_RATE, "effective_to_enrolled_rate": NO_RATE,
        "target_seats": None, "remaining_seats": None, "grades_with_target": 0,
    }
    # 仁武：沒有任何訪視。
    assert rows[1]["visit"] == 0
    assert rows[1]["visit_to_deposit_rate"] == NO_RATE
    assert (rows[1]["target_seats"], rows[1]["remaining_seats"]) == (None, None)


async def test_compare_endpoint_scope(admin_client, minghua_client, reception_client, editor_client, db_session):
    await seed_compare(db_session)
    path = f"{API}/admin/admissions/compare?school_year=115&semester=1"

    everyone = await admin_client.get(path)
    assert everyone.status_code == 200, everyone.text
    assert [row["campus_key"] for row in everyone.json()] == ["yihua", "minghua", "chongde", "international", "renwu"]
    assert everyone.json()[0]["remaining_seats"] == 8

    # 分校帳號只看到自己的校區（規格 9.3、第 7 節）。
    assert [row["campus_key"] for row in (await minghua_client.get(path)).json()] == ["minghua"]
    assert [row["campus_key"] for row in (await reception_client.get(path)).json()] == ["yihua"]
    assert (await editor_client.get(path)).status_code == 403
    # 學期必填：名額剩餘要對到單一學期。
    assert (await admin_client.get(f"{API}/admin/admissions/compare?school_year=115")).status_code == 422
```

- [ ] **Step 2：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q tests/test_admissions_stats.py -k compare
```

Expected: FAIL，`AttributeError: module 'app.admissions.stats' has no attribute 'compare'`（端點測試 404）。

- [ ] **Step 3：schema**

`backend/app/admissions/schemas.py` 檔尾加：

```python
class AdmissionsRate(BaseModel):
    # 百分比到小數一位；分母 0 為 None。五校比較同時顯示分子與分母（規格 9.3）。
    value: float | None
    numerator: int
    denominator: int


class AdmissionsCompareRow(BaseModel):
    """五校比較的一列：所選學年學期的「招生案件數」，不是跨校去重後的孩子數。"""

    campus_key: str
    visit: int
    deposit: int
    enrolled: int
    transfer_term: int
    effective_deposit: int
    pending_deposit: int
    visit_to_deposit_rate: AdmissionsRate
    visit_to_enrolled_rate: AdmissionsRate
    deposit_to_enrolled_rate: AdmissionsRate
    effective_to_enrolled_rate: AdmissionsRate
    # 只加總有計畫名額列的年級（計畫 0 也算有設定）；一個都沒有＝None（畫面「未設定」）。
    target_seats: int | None
    remaining_seats: int | None
    grades_with_target: int
```

- [ ] **Step 4：`compare`**

`backend/app/admissions/stats.py` import 區加 `from app.admissions import intake`，檔尾加：

```python
def _rate(numerator: int, denominator: int) -> dict[str, Any]:
    return {"value": pct(numerator, denominator), "numerator": numerator, "denominator": denominator}


async def compare(db: AsyncSession, campus_keys: list[str], *, school_year: int, semester: int) -> list[dict[str, Any]]:
    """五校比較（官網延伸，規格 9.3）。依 campus_keys 的順序每校一列；呼叫端負責只傳授權範圍內的校區。"""
    v = RecruitmentVisit
    rows = (
        await db.execute(
            select(v.campus_key, *_count_columns())
            .where(v.campus_key.in_(campus_keys), v.target_school_year == school_year, v.target_semester == semester)
            .group_by(v.campus_key)
        )
    ).all()
    counts_by_campus = {row.campus_key: _counts(row) for row in rows}
    result: list[dict[str, Any]] = []
    for campus_key in campus_keys:
        c = counts_by_campus.get(campus_key, dict.fromkeys(COUNT_FIELDS, 0))
        plan = await intake.intake_plan(db, campus_key, school_year, semester)
        configured = [row for row in plan["rows"] if row["target_seats"] is not None]
        result.append({
            "campus_key": campus_key,
            **c,
            "visit_to_deposit_rate": _rate(c["deposit"], c["visit"]),
            "visit_to_enrolled_rate": _rate(c["enrolled"], c["visit"]),
            "deposit_to_enrolled_rate": _rate(c["enrolled"], c["deposit"]),
            "effective_to_enrolled_rate": _rate(c["enrolled"], c["effective_deposit"]),
            "target_seats": sum(row["target_seats"] for row in configured) if configured else None,
            "remaining_seats": sum(row["remaining"] for row in configured) if configured else None,
            "grades_with_target": len(configured),
        })
    return result
```

- [ ] **Step 5：端點**

`backend/app/admissions/routes.py` import 區補 `from app.admissions.schemas import AdmissionsCompareRow`、`from app.auth.permissions import covers_campus`（併入既有的 import 行），檔尾加：

```python
@router.get("/admin/admissions/compare", response_model=list[AdmissionsCompareRow])
async def get_admissions_compare(
    school_year: int = Query(ge=1, le=999),
    semester: int = Query(ge=1, le=2),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[AdmissionsCompareRow]:
    """五校比較：只列使用者授權範圍內的校區（super_admin 為五校）。只讀，不寫稽核。"""
    require_scope(current_user, "admissions.read")
    campus_keys = [key for key in CAMPUS_KEYS if covers_campus(current_user, key)]
    rows = await stats_service.compare(db, campus_keys, school_year=school_year, semester=semester)
    return [AdmissionsCompareRow.model_validate(row) for row in rows]
```

- [ ] **Step 6：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q tests/test_admissions_stats.py
```

Expected: `13 passed`。

- [ ] **Step 7：重產契約**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm run contract:generate
npm run contract:check
grep -c "AdmissionsCompareRow" contracts/generated/website-api.d.ts
```

Expected: `contract:check` 無差異；最後一行 >= 1。

- [ ] **Step 8：後端全套（主 session 背景跑，subagent 不跑）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q
```

Expected: 全部 PASS（含 `test_audit_coverage.py`：兩個新端點是 GET，不在稽核掃描範圍）。

- [ ] **Step 9：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/stats.py backend/app/admissions/schemas.py backend/app/admissions/routes.py \
  backend/tests/test_admissions_stats.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 五校比較（只列授權校區，名額剩餘只加總有設定的年級）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C2b：未預繳明細 `no_deposit_records` 與 `GET /admin/admissions/no-deposit-records`

2026-10-01 使用者裁定統計頁要列名單：照園務 `GET /no-deposit-analysis`（`api/recruitment/stats.py:938-1005`）回未預繳明細，給 C3b 的 `NoDepositList.vue` 用。`/stats` 仍只回數字（本檔調整表規格 7 那一列）。

**Files:**
- Modify: `backend/app/admissions/stats.py`（import 區＋檔尾加 `no_deposit_records`）
- Modify: `backend/app/admissions/schemas.py`（檔尾加 `NoDepositSummaryOut`、`NoDepositRecordOut`、`NoDepositRecordsOut`）
- Modify: `backend/app/admissions/routes.py`（import 區＋檔尾加端點）
- Test: `backend/tests/test_admissions_stats.py`（檔尾追加）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes：C1 的 `_base_filters`、`roc_month_sort_key`、`_REASON_PRIORITY`、`DEFAULT_OVERDUE_DAYS`、`COLD_LEAD_DAYS`、`query_stats`（測試對口徑）；`app.admissions.constants.NO_DEPOSIT_PRIORITY`（A1，`{"high": (...), "medium": (...), "low": (...)}`）；`app.admissions.models.RecruitmentVisit`（A2）；`app.common.timezones.now_utc`；`app.auth.permissions.require_scope`／`ScopeDenied`；`app.campuses.models.CAMPUS_KEYS`；本檔 C1 測試的 `add_visit`、`days_ago`、`NOW`、`HIGH`、`reception_client`、`readonly_client`，`tests.conftest` 的 `admin_client`、`minghua_client`、`editor_client`。
- Produces（`app/admissions/stats.py`）：
  - `def seq_sort_key(seq_no: str | None) -> tuple[int, int, str]`
  - `async def no_deposit_records(db, campus_key: str, *, school_year: int | None, semester: int | None, reason: str | None, grade: str | None, priority: str | None, overdue_days: int | None, cold_only: bool | None, page: int, page_size: int, now: datetime | None = None) -> dict`：`{"total", "page", "page_size", "summary", "records"}`
- Produces（schemas）：`NoDepositSummaryOut`（`high_potential_count`、`overdue_followup_count`、`cold_count`；C1 的 `AdmissionsNoDepositSummary` 多一個 `high_potential_backlog_count`、逾期天數固定 14，形狀不同，不沿用）、`NoDepositRecordOut`、`NoDepositRecordsOut`
- Produces（API）：`GET /api/website/v1/admin/admissions/no-deposit-records?campus_key=&school_year=&semester=&reason=&grade=&priority=&overdue_days=&cold_only=&page=&page_size=` → `NoDepositRecordsOut`；`admissions.read`；越權或不存在的校區 404；`priority` 只收 `high`／`medium`／`low`，`overdue_days` 1–365，`page` ≥ 1（預設 1），`page_size` 1–500（預設 100），其餘 422。

口徑（照園務，官網差異另標）：

| 項目 | 規則 |
|---|---|
| 母體 | `campus_key`＋`target_school_year`／`target_semester`（null＝不篩，同 C1）＋`has_deposit = false AND withdrawn_at IS NULL`，與 C1 `no_deposit_total` 同一群 |
| `reason`、`grade` | 等值篩選，名單與 `summary` 都套（園務 `base_query`） |
| `summary` | `high_potential_count`（原因屬高潛力）、`overdue_followup_count`（`created_at <= now − overdue_days`，沒給用 14）、`cold_count`（`created_at <= now − 90 天`）；不受 `priority`、`cold_only` 影響 |
| `priority`、`overdue_days`、`cold_only` | 只篩名單；`overdue_days` 有給才篩，`cold_only` 只有 `true` 才篩（同園務） |
| 排序（官網調整） | `roc_month_sort_key(month)` 降序 → `seq_sort_key(seq_no)` 升序 → `created_at` 升序 → `id` 字串升序；Python 排好再切頁 |
| 每列欄位 | `id`、`month`、`seq_no`、`child_name`、`grade`、`no_deposit_reason`、`no_deposit_reason_detail`、`source`、`referrer`、`parent_response`、`created_at`、`priority`（`high`／`medium`／`low`／`null`，「未註明／待追蹤」與沒填原因是 `null`）、`cold`（建檔滿 90 天）；不含電話、地址、生日 |

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_stats.py` 檔尾追加（import 區不用改：`uuid`、`date`、`timedelta`、`RecruitmentVisit`、`stats` 在 C1 已 import）：

```python
# ── 未預繳明細（C2b）：園務 GET /no-deposit-analysis（stats.py:938-1005）──

EVALUATING = "課程／環境仍在評估"
COST = "費用考量"
OTHER_SCHOOL = "已有其他就學選項／比較他校"
UNSPECIFIED = "未註明／待追蹤"
RECORD_KEYS = {
    "id", "month", "seq_no", "child_name", "grade", "no_deposit_reason", "no_deposit_reason_detail",
    "source", "referrer", "parent_response", "created_at", "priority", "cold",
}
# seed_no_deposit 的 N1–N7 依「月份降序、序號數字升序」排好的順序。
ALL_SEVEN = ["陳小魚", "林小安", "黃小雨", "王小樹", "李小美", "周小宇", "鄭小芸"]


def add_numbered(db, seq_no: str | None, **kwargs) -> RecruitmentVisit:
    """add_visit 不配序號（seq_no=None）；名單要驗排序，這裡補上。"""
    visit = add_visit(db, **kwargs)
    visit.seq_no = seq_no
    return visit


async def seed_no_deposit(db) -> uuid.UUID:
    """未預繳明細的合成資料：義華 115 學年上學期 N1–N7 在母體內，X1–X4 不在。回傳 N1 的 id。

    | 筆 | 參觀日 → 月份 | 序號 | 姓名 | 年級 | 未預繳原因（潛力） | 建檔 |
    | N1 | 09-03 → 115.09 | 2 | 林小安 | 小班 | 時程未到／仍在觀望（高） | 20 天前 |
    | N2 | 09-05 → 115.09 | 10 | 黃小雨 | 幼幼班 | 費用考量（中） | 剛好 14 天前 |
    | N3 | 09-08 → 115.09 | 1 | 陳小魚 | 中班 | 課程／環境仍在評估（高） | 14 天前再晚 1 秒 |
    | N4 | 08-20 → 115.08 | 5 | 王小樹 | 大班 | （NULL，未分類） | 3 天前 |
    | N5 | 07-02 → 115.07 | 3 | 周小宇 | 小班 | 已有其他就學選項／比較他校（低） | 剛好 90 天前 |
    | N6 | 07-03 → 115.07 | 1 | 李小美 | 中班 | 未註明／待追蹤（—） | 90 天前再晚 1 秒 |
    | N7 | 2025-12-15 → 114.12 | 4 | 鄭小芸 | 大班 | 時程未到／仍在觀望（高） | 290 天前 |

    X1 已預繳、X2 退預繳（殘留高潛力原因）、X3 下學期、X4 明華。
    """
    y = 2026
    n1 = add_numbered(db, "2", visit_date=date(y, 9, 3), child_name="林小安", birthday=date(2022, 6, 4), grade="小班",
                      source="Facebook", referrer="林老師", no_deposit_reason=HIGH, created_at=days_ago(20))
    n1.no_deposit_reason_detail = "想等明年再決定"
    n1.parent_response = "下週再電訪"
    n1.phone = "0912345678"
    n1.address = "高雄市三民區測試路 1 號"
    n1_id = n1.id  # commit 後再讀屬性會觸發 lazy refresh，先記下來
    add_numbered(db, "10", visit_date=date(y, 9, 5), child_name="黃小雨", grade="幼幼班", no_deposit_reason=COST,
                 created_at=days_ago(14))
    add_numbered(db, "1", visit_date=date(y, 9, 8), child_name="陳小魚", grade="中班", no_deposit_reason=EVALUATING,
                 created_at=days_ago(14) + timedelta(seconds=1))
    add_numbered(db, "5", visit_date=date(y, 8, 20), child_name="王小樹", grade="大班", created_at=days_ago(3))
    add_numbered(db, "3", visit_date=date(y, 7, 2), child_name="周小宇", grade="小班", no_deposit_reason=OTHER_SCHOOL,
                 created_at=days_ago(90))
    add_numbered(db, "1", visit_date=date(y, 7, 3), child_name="李小美", grade="中班", no_deposit_reason=UNSPECIFIED,
                 created_at=days_ago(90) + timedelta(seconds=1))
    add_numbered(db, "4", visit_date=date(2025, 12, 15), child_name="鄭小芸", grade="大班", no_deposit_reason=HIGH,
                 created_at=days_ago(290))
    add_numbered(db, "3", visit_date=date(y, 9, 10), child_name="何小森", grade="小班", has_deposit=True,
                 created_at=days_ago(30))
    add_numbered(db, "4", visit_date=date(y, 9, 12), child_name="許小樂", grade="小班", no_deposit_reason=HIGH,
                 withdrawn_at=days_ago(2), created_at=days_ago(30))
    add_numbered(db, "5", visit_date=date(y, 9, 15), child_name="蘇小晨", grade="小班", no_deposit_reason=HIGH,
                 target_semester=2, created_at=days_ago(30))
    add_numbered(db, "1", campus_key="minghua", visit_date=date(y, 9, 3), child_name="楊小禾", grade="小班",
                 no_deposit_reason=HIGH, created_at=days_ago(30))
    await db.commit()
    return n1_id


async def no_deposit(db, campus_key: str = "yihua", **changes) -> dict:
    params = {
        "school_year": 115, "semester": 1, "reason": None, "grade": None, "priority": None,
        "overdue_days": None, "cold_only": None, "page": 1, "page_size": 100, **changes,
    }
    return await stats.no_deposit_records(db, campus_key, now=NOW, **params)


def names(result: dict) -> list[str]:
    return [row["child_name"] for row in result["records"]]


async def test_no_deposit_records_population_order_and_fields(db_session):
    """母體同 C1 的 no_deposit（未預繳且未退出、篩入學學年學期）；月份降序、序號依數字升序。"""
    n1_id = await seed_no_deposit(db_session)

    result = await no_deposit(db_session)

    # X1 已預繳、X2 已退出、X3 下學期、X4 明華都不在。
    # 115.09 的序號 1、2、10（字串排序會是 1、10、2）→ 115.08 → 115.07 的 1、3 → 114.12（跨民國年照月份降序）。
    assert names(result) == ALL_SEVEN
    assert (result["total"], result["page"], result["page_size"]) == (7, 1, 100)
    # 高潛力 N1 N3 N7＝3；建檔 <= now－14 天：N1 N2 N5 N6 N7＝5（N3 晚 1 秒不算）；<= now－90 天：N5 N7＝2（N6 晚 1 秒不算）。
    assert result["summary"] == {"high_potential_count": 3, "overdue_followup_count": 5, "cold_count": 2}
    # 與 /stats 同口徑：統計寫幾筆，名單就是幾筆；三個數字也對得起來。
    overall = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)
    assert result["total"] == overall["no_deposit_total"]
    assert {key: overall["no_deposit_summary"][key] for key in result["summary"]} == result["summary"]

    lin = result["records"][1]
    assert set(lin) == RECORD_KEYS  # 不含電話、地址、生日
    assert lin == {
        "id": n1_id, "month": "115.09", "seq_no": "2", "child_name": "林小安", "grade": "小班",
        "no_deposit_reason": HIGH, "no_deposit_reason_detail": "想等明年再決定", "source": "Facebook",
        "referrer": "林老師", "parent_response": "下週再電訪", "created_at": days_ago(20), "priority": "high", "cold": False,
    }
    # 潛力：「未註明／待追蹤」與沒填原因（未分類）都是 None；冷名單＝建檔滿 90 天。
    assert [(row["priority"], row["cold"]) for row in result["records"]] == [
        ("high", False), ("high", False), ("medium", False), (None, False), (None, False), ("low", True), ("high", True),
    ]


async def test_no_deposit_records_filters_keep_summary(db_session):
    """潛力、冷名單只篩名單，summary 不變；逾期天數同園務：篩名單，也決定 summary 的逾期筆數；原因與班別兩邊都篩。"""
    await seed_no_deposit(db_session)
    base = (await no_deposit(db_session))["summary"]

    high = await no_deposit(db_session, priority="high")
    assert (names(high), high["total"], high["summary"]) == (["陳小魚", "林小安", "鄭小芸"], 3, base)
    assert names(await no_deposit(db_session, priority="medium")) == ["黃小雨"]
    assert names(await no_deposit(db_session, priority="low")) == ["周小宇"]

    # 畫面的「逾 14 天」開關：summary 的逾期本來就用 14 天，所以不變。
    overdue = await no_deposit(db_session, overdue_days=14)
    assert (names(overdue), overdue["summary"]) == (["林小安", "黃小雨", "李小美", "周小宇", "鄭小芸"], base)
    # 逾 25 天：名單只剩 N5 N6 N7；summary 只有逾期筆數跟著天數變（園務 effective_overdue_days）。
    overdue_25 = await no_deposit(db_session, overdue_days=25)
    assert names(overdue_25) == ["李小美", "周小宇", "鄭小芸"]
    assert overdue_25["summary"] == {**base, "overdue_followup_count": 3}

    cold = await no_deposit(db_session, cold_only=True)
    assert (names(cold), cold["total"], cold["summary"]) == (["周小宇", "鄭小芸"], 2, base)
    assert names(await no_deposit(db_session, cold_only=False)) == ALL_SEVEN  # 園務只在 true 時篩
    assert names(await no_deposit(db_session, priority="high", overdue_days=14)) == ["林小安", "鄭小芸"]

    # 原因、班別：名單與 summary 都只算符合的（園務 base_query）。
    by_reason = await no_deposit(db_session, reason=HIGH)
    assert names(by_reason) == ["林小安", "鄭小芸"]
    assert by_reason["summary"] == {"high_potential_count": 2, "overdue_followup_count": 2, "cold_count": 1}
    by_grade = await no_deposit(db_session, grade="小班")
    assert names(by_grade) == ["林小安", "周小宇"]
    assert by_grade["summary"] == {"high_potential_count": 1, "overdue_followup_count": 2, "cold_count": 1}


async def test_no_deposit_records_cutoff_is_inclusive(db_session):
    """建檔剛好滿 14／90 天就算逾期／冷名單（<=，同園務）；晚 1 秒就不算。"""
    await seed_no_deposit(db_session)

    overdue = names(await no_deposit(db_session, overdue_days=14))
    assert "黃小雨" in overdue      # 剛好 14 天前
    assert "陳小魚" not in overdue  # 14 天前再晚 1 秒
    cold = {row["child_name"]: row["cold"] for row in (await no_deposit(db_session))["records"]}
    assert (cold["周小宇"], cold["李小美"]) == (True, False)  # 剛好 90 天前／晚 1 秒
    assert names(await no_deposit(db_session, cold_only=True)) == ["周小宇", "鄭小芸"]


async def test_no_deposit_records_pagination(db_session):
    await seed_no_deposit(db_session)

    pages = [await no_deposit(db_session, page=page, page_size=3) for page in (1, 2, 3, 4)]

    # 排序固定，換頁不重複、不漏；超過最後一頁回空陣列，total 照算。
    assert [names(result) for result in pages] == [ALL_SEVEN[0:3], ALL_SEVEN[3:6], ALL_SEVEN[6:], []]
    assert {(result["total"], result["page_size"]) for result in pages} == {(7, 3)}
    assert [result["page"] for result in pages] == [1, 2, 3, 4]


async def test_no_deposit_records_empty_campus(db_session):
    await seed_no_deposit(db_session)

    result = await no_deposit(db_session, "renwu", priority="high")

    assert result == {
        "total": 0, "page": 1, "page_size": 100,
        "summary": {"high_potential_count": 0, "overdue_followup_count": 0, "cold_count": 0},
        "records": [],
    }


async def test_no_deposit_records_endpoint(admin_client, db_session):
    await seed_no_deposit(db_session)
    path = f"{API}/admin/admissions/no-deposit-records?campus_key=yihua&school_year=115&semester=1"

    response = await admin_client.get(path)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["total"], body["page"], body["page_size"]) == (7, 1, 100)
    assert [row["child_name"] for row in body["records"]] == ALL_SEVEN
    assert set(body["records"][1]) == RECORD_KEYS
    # 電話、地址、生日不在回應裡（N1 三個都有填）。
    for secret in ("0912345678", "測試路", "2022-06-04"):
        assert secret not in response.text, secret

    filtered = await admin_client.get(path + "&priority=high&page=1&page_size=2")
    assert filtered.status_code == 200, filtered.text
    assert (filtered.json()["total"], [row["child_name"] for row in filtered.json()["records"]]) == (3, ["陳小魚", "林小安"])

    base = f"{API}/admin/admissions/no-deposit-records?campus_key=yihua"
    for bad in ("priority=urgent", "overdue_days=0", "overdue_days=366", "page=0", "page_size=0", "page_size=501", "semester=3"):
        assert (await admin_client.get(f"{base}&{bad}")).status_code == 422, bad


async def test_no_deposit_records_permissions(reception_client, readonly_client, minghua_client, editor_client, admin_client):
    """名單含孩子姓名：權限同統計（admissions.read＋校區範圍；越權 404、editor／readonly 403）。"""
    path = f"{API}/admin/admissions/no-deposit-records?campus_key="
    assert (await reception_client.get(path + "yihua")).status_code == 200
    assert (await reception_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await minghua_client.get(path + "minghua")).status_code == 200
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404
```

- [ ] **Step 2：跑測試確認失敗**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q tests/test_admissions_stats.py -k no_deposit_records
```

Expected: FAIL，7 項都失敗——服務層是 `AttributeError: module 'app.admissions.stats' has no attribute 'no_deposit_records'`，端點與權限測試拿到 404（路由還沒有）。

- [ ] **Step 3：schema**

`backend/app/admissions/schemas.py` 檔尾加（`uuid`、`datetime`、`Literal`、`BaseModel` 檔頭已有）：

```python
# ── 未預繳明細（C2b）：園務 GET /no-deposit-analysis（stats.py:938-1005）。
# 名單含孩子姓名（2026-10-01 使用者裁定統計頁要列名單），只放畫面要的欄位，不含電話、地址、生日。


class NoDepositSummaryOut(BaseModel):
    """只受 reason／grade 篩選影響（園務 base_query）；潛力、冷名單篩選不改這三個數字。"""

    high_potential_count: int
    # 建檔滿 overdue_days 天（沒給用 14）仍未預繳。
    overdue_followup_count: int
    # 建檔滿 90 天仍未預繳。
    cold_count: int


class NoDepositRecordOut(BaseModel):
    id: uuid.UUID
    month: str
    seq_no: str | None
    child_name: str
    grade: str | None
    no_deposit_reason: str | None
    no_deposit_reason_detail: str | None
    source: str | None
    referrer: str | None
    parent_response: str | None
    created_at: datetime
    # 「未註明／待追蹤」與沒填原因是 None（畫面寫「—」）。
    priority: Literal["high", "medium", "low"] | None
    # 建檔滿 90 天（園務 COLD_LEAD_DAYS）。
    cold: bool


class NoDepositRecordsOut(BaseModel):
    total: int
    page: int
    page_size: int
    summary: NoDepositSummaryOut
    records: list[NoDepositRecordOut]
```

- [ ] **Step 4：`no_deposit_records`**

`backend/app/admissions/stats.py`：

1. import 區最上面（`from __future__ import annotations` 之後、`from datetime import …` 之前）加 `import re`。
2. 檔尾加：

```python
_LEADING_DIGITS = re.compile(r"\d+")
_NO_DEPOSIT_SUMMARY_FIELDS = ("high_potential_count", "overdue_followup_count", "cold_count")


def seq_sort_key(seq_no: str | None) -> tuple[int, int, str]:
    """序號依開頭數字升序（「2」在「10」前面）；沒有開頭數字的排在有數字的後面，沒有序號的排最後。"""
    if seq_no is None:
        return (2, 0, "")
    digits = _LEADING_DIGITS.match(seq_no)
    if digits is None:
        return (1, 0, seq_no)
    return (0, int(digits.group()), seq_no)


async def no_deposit_records(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    reason: str | None,
    grade: str | None,
    priority: str | None,
    overdue_days: int | None,
    cold_only: bool | None,
    page: int,
    page_size: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    """未預繳明細（園務 GET /no-deposit-analysis，stats.py:938-1005）。只讀。

    母體同 query_stats 的未預繳：篩校區與入學學年學期、未預繳且未退出（退預繳會清 has_deposit，
    不排除的話統計寫 N 筆、名單會多出已退出的）。reason／grade 名單與 summary 都套；
    priority／overdue_days／cold_only 只篩名單，其中 overdue_days 也決定 summary 的逾期天數（沒給用 14）。
    排序與園務不同：園務 ORDER BY month DESC, seq_no 是字串排序（同月「10」在「2」前面），
    官網用 roc_month_sort_key 降序、seq_sort_key 升序，再以 created_at、id 收尾，換頁結果可重現。
    """
    now = now or now_utc()
    v = RecruitmentVisit
    filters = [*_base_filters(campus_key, school_year, semester), v.has_deposit.is_(False), v.withdrawn_at.is_(None)]
    if reason:
        filters.append(v.no_deposit_reason == reason)
    if grade:
        filters.append(v.grade == grade)
    overdue_cutoff = now - timedelta(days=overdue_days or DEFAULT_OVERDUE_DAYS)
    cold_cutoff = now - timedelta(days=COLD_LEAD_DAYS)

    summary_row = (
        await db.execute(
            select(
                func.count(v.id).filter(v.no_deposit_reason.in_(NO_DEPOSIT_PRIORITY["high"])).label("high_potential_count"),
                func.count(v.id).filter(v.created_at <= overdue_cutoff).label("overdue_followup_count"),
                func.count(v.id).filter(v.created_at <= cold_cutoff).label("cold_count"),
            ).where(*filters)
        )
    ).one()
    summary = {name: int(getattr(summary_row, name) or 0) for name in _NO_DEPOSIT_SUMMARY_FIELDS}

    list_filters = list(filters)
    if priority:
        list_filters.append(v.no_deposit_reason.in_(NO_DEPOSIT_PRIORITY[priority]))
    if overdue_days is not None:
        list_filters.append(v.created_at <= overdue_cutoff)
    if cold_only:
        list_filters.append(v.created_at <= cold_cutoff)
    rows = (
        await db.execute(
            select(
                v.id, v.month, v.seq_no, v.child_name, v.grade, v.no_deposit_reason, v.no_deposit_reason_detail,
                v.source, v.referrer, v.parent_response, v.created_at,
            ).where(*list_filters)
        )
    ).all()
    # Python 的排序是穩定的（reverse=True 也是）：先排最次要的鍵，最後排月份。
    ordered = sorted(rows, key=lambda row: (row.created_at, str(row.id)))
    ordered.sort(key=lambda row: seq_sort_key(row.seq_no))
    ordered.sort(key=lambda row: roc_month_sort_key(row.month), reverse=True)
    start = (page - 1) * page_size
    records = [
        {
            "id": row.id,
            "month": row.month,
            "seq_no": row.seq_no,
            "child_name": row.child_name,
            "grade": row.grade,
            "no_deposit_reason": row.no_deposit_reason,
            "no_deposit_reason_detail": row.no_deposit_reason_detail,
            "source": row.source,
            "referrer": row.referrer,
            "parent_response": row.parent_response,
            "created_at": row.created_at,
            "priority": _REASON_PRIORITY.get(row.no_deposit_reason) if row.no_deposit_reason else None,
            "cold": row.created_at <= cold_cutoff,
        }
        for row in ordered[start : start + page_size]
    ]
    return {"total": len(ordered), "page": page, "page_size": page_size, "summary": summary, "records": records}
```

- [ ] **Step 5：端點**

`backend/app/admissions/routes.py` import 區補上（已有的不重複；`from typing import Literal` 放在 `import uuid` 下一行）：

```python
from typing import Literal

from app.admissions.schemas import NoDepositRecordsOut
```

（`NoDepositRecordsOut` 併入既有的 `from app.admissions.schemas import (...)` 清單，照字母序。）檔尾加：

```python
@router.get("/admin/admissions/no-deposit-records", response_model=NoDepositRecordsOut)
async def get_admissions_no_deposit_records(
    campus_key: str,
    school_year: int | None = Query(default=None, ge=1, le=999),
    semester: int | None = Query(default=None, ge=1, le=2),
    reason: str | None = Query(default=None, max_length=60),
    grade: str | None = Query(default=None, max_length=20),
    priority: Literal["high", "medium", "low"] | None = Query(default=None),
    overdue_days: int | None = Query(default=None, ge=1, le=365),
    cold_only: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> NoDepositRecordsOut:
    """未預繳明細（園務 /no-deposit-analysis）。含孩子姓名，權限同統計；只讀，不寫稽核。"""
    require_scope(current_user, "admissions.read", campus_keys=[campus_key])
    if campus_key not in CAMPUS_KEYS:
        raise ScopeDenied()
    result = await stats_service.no_deposit_records(
        db,
        campus_key,
        school_year=school_year,
        semester=semester,
        reason=reason,
        grade=grade,
        priority=priority,
        overdue_days=overdue_days,
        cold_only=cold_only,
        page=page,
        page_size=page_size,
    )
    return NoDepositRecordsOut.model_validate(result)
```

- [ ] **Step 6：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q tests/test_admissions_stats.py
```

Expected: `20 passed`（C1 10、C2 3、C2b 7）。若排序那一段不同，先看 `seq_sort_key` 與兩次 `sort` 的順序（月份要最後排），不要改期望值去湊。

- [ ] **Step 7：重產契約**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm run contract:generate
npm run contract:check
grep -c "NoDepositRecordsOut" contracts/generated/website-api.d.ts
```

Expected: `contract:check` 無差異；最後一行 >= 1。

- [ ] **Step 8：後端全套（主 session 背景跑，subagent 不跑）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q
```

Expected: 全部 PASS（新端點是 GET，不在 `test_audit_coverage.py` 的稽核掃描範圍）。

- [ ] **Step 9：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add backend/app/admissions/stats.py backend/app/admissions/schemas.py backend/app/admissions/routes.py \
  backend/tests/test_admissions_stats.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 未預繳明細名單（移植園務 /no-deposit-analysis，排序可重現）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C3：統計分頁（總覽、班別、來源、接待、未預繳原因）

**Files:**
- Create: `admin/src/admissions/statsFormat.ts`
- Create: `admin/src/components/admissions/StatsDimensionTable.vue`、`admin/src/components/admissions/StatsOverview.vue`
- Rewrite: `admin/src/components/admissions/StatsTab.vue`（取代 B1 的空狀態佔位）
- Modify: `admin/src/api/admissions.ts`（加 `getStats`）、`admin/src/api/types.ts`（加 `AdmissionsStats`）
- Modify: `admin/src/views/AdmissionsView.vue`（`<StatsTab …>` 那一個標籤＋`openRecords`，見 Step 11）
- Test: `admin/src/__tests__/statsFormat.test.ts`、`admin/src/__tests__/statsTab.test.ts`（新檔）；`admin/src/__tests__/admissionsView.test.ts`（B1 的檔，改「統計分析」那一組，見 Step 11）

**Interfaces:**
- Consumes：C1 的 `GET /admin/admissions/stats`（`AdmissionsStatsOut`）；B1 的 `admin/src/admissions/constants.ts`（`GRADES`）、`admin/src/admissions/academic.ts`（`termLabel`）、`admin/src/api/labels.ts`（`campusLabel`、`formatDateTime`）、`admin/src/admissions/constants.ts`（`SEMESTER_LABELS`）、`admin/src/composables/useRequestSequence.ts`、`admin/src/__tests__/admissionsTestKit.ts`（`mountWith`、`cleanup`、`mockGet`、`deferred`、`pathsTo`、`queryOf`、`button`、`superAdmin`、`reception`）。
- Produces：
  - `admin/src/api/admissions.ts`：`export function getStats(params: { campus_key: string; school_year: number | null; semester: number | null; reference_month: string | null }): Promise<AdmissionsStats>`
  - `admin/src/api/types.ts`：`export type AdmissionsStats = components['schemas']['AdmissionsStatsOut']`
  - `admin/src/admissions/statsFormat.ts`：`NO_VALUE`、`formatRate(value)`、`ratio(num, den)`、`formatPoints(value)`、`Trend`、`trendOf(value)`、`TREND_MARK`、`RateLevel`、`rateLevel(value)`、`barWidth(value, max)`、`alertLevelLabel(level)`、`priorityLabel(priority)`、`gradeColumns(labels)`、`StatsTarget`
  - `StatsDimensionTable.vue`：`props { title: string; rows: readonly Record<string, unknown>[]; columns: readonly StatsColumn[]; rowKey: string; emptyText: string; numbered?: boolean; caption?: string }`；`export interface StatsColumn { key: string; label: string; kind?: 'text' | 'count' | 'rate' | 'bar'; sticky?: boolean }`（放在 `statsFormat.ts`，元件 import）
  - `StatsOverview.vue`：`props { stats: AdmissionsStats }`；`emits { navigate: [target: { tab: StatsTarget; filter: Record<string, string | number> }] }`
  - `StatsTab.vue`：`props { campusKey: string; schoolYear: number | null; semester: number | null; campusKeys: readonly string[] }`；`emits { 'open-records': [filter: { month: string }] }`；子分頁（`el-tab-pane` 的 name）`stats-overview`／`stats-class`／`stats-source`／`stats-staff`／`stats-nodeposit`（C4 加 `stats-compare`），測試以 `#pane-stats-*` 取各子分頁

文案來源：園務 `RecruitmentStatsPanel`／`RecruitmentOverviewTab`／`Recruitment{Class,Source,Staff,NoDeposit}Tab` 原文（表頭、空狀態、警示等級「高／中／低」、決策摘要卡名）。官網刻意不同處：圖表改成表格＋CSS 長條；不做「區域分析」「全管道彙整」「匯出 Excel」；「未預繳明細」名單由 C3b 的 `NoDepositList.vue` 掛進「未預繳原因」子分頁，本 task 先做數字卡、優先度與原因分布，名單提示暫時指到訪視明細（C3b 拿掉）；比率 `null` 顯示「—」。

- [ ] **Step 1：格式工具的失敗測試**

`admin/src/__tests__/statsFormat.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  alertLevelLabel, barWidth, formatPoints, formatRate, gradeColumns, priorityLabel, rateLevel, ratio, trendOf, TREND_MARK,
} from '../admissions/statsFormat'

describe('統計顯示格式（規格 9.2：分母 0 是 null，畫面寫「—」不寫 0）', () => {
  it('比率', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(undefined)).toBe('—')
    expect(formatRate(0)).toBe('0.0%')
    expect(formatRate(55.6)).toBe('55.6%')
    expect(formatRate(100)).toBe('100.0%')
  })

  it('前端自己算的比率（接待人員 × 年級）：一位小數、分母 0 為 null', () => {
    expect(ratio(2, 3)).toBe(66.7)
    expect(ratio(0, 4)).toBe(0)
    expect(ratio(1, 0)).toBeNull()
  })

  it('月比百分點與方向', () => {
    expect(formatPoints(-80)).toBe('-80.0pt')
    expect(formatPoints(3.25)).toBe('+3.3pt')
    expect(formatPoints(0)).toBe('0.0pt')
    expect(formatPoints(null)).toBe('—')
    expect([trendOf(2), trendOf(-0.1), trendOf(0), trendOf(null)]).toEqual(['up', 'down', 'flat', 'none'])
    expect(TREND_MARK.up + TREND_MARK.down + TREND_MARK.flat).toBe('▲▼–')
  })

  it('決策摘要上色門檻同園務：>= 60 高、>= 30 中、其餘低；沒有比率不上色', () => {
    expect([rateLevel(60), rateLevel(59.9), rateLevel(30), rateLevel(29.9), rateLevel(null)]).toEqual(['high', 'mid', 'mid', 'low', 'none'])
  })

  it('長條寬度：以該欄最大值為 100%，最大值 0 時都是 0%', () => {
    expect(barWidth(5, 5)).toBe('100%')
    expect(barWidth(1, 3)).toBe('33%')
    expect(barWidth(0, 3)).toBe('0%')
    expect(barWidth(2, 0)).toBe('0%')
  })

  it('警示等級與轉換潛力的中文（園務原文）', () => {
    expect([alertLevelLabel('danger'), alertLevelLabel('warning'), alertLevelLabel('info'), alertLevelLabel('other')]).toEqual(['高', '中', '低', '提示'])
    expect([priorityLabel('high'), priorityLabel('medium'), priorityLabel('low'), priorityLabel(null)]).toEqual(['高', '中', '低', '—'])
  })

  it('年級欄：四個年級固定在前，其他標籤（未填寫）有出現才加在後面，「合計」不算年級', () => {
    expect(gradeColumns(['小班', '合計'])).toEqual(['幼幼班', '小班', '中班', '大班'])
    expect(gradeColumns(['未填寫', '小班', '合計'])).toEqual(['幼幼班', '小班', '中班', '大班', '未填寫'])
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/statsFormat.test.ts`
Expected: FAIL，`Failed to resolve import "../admissions/statsFormat"`。

- [ ] **Step 3：實作 `admin/src/admissions/statsFormat.ts`**

```ts
import { GRADES } from './constants'

// 統計分頁的顯示格式。後端比率已算到小數一位，分母 0 回 null（規格 9.2，刻意與園務回 0 不同）：
// 畫面一律寫「—」，不寫 0，避免把「沒有資料」看成「轉換率零」。
export const NO_VALUE = '—'

export type StatsTarget = 'records' | 'nodeposit' | 'source'

export interface StatsColumn {
  key: string
  label: string
  /** text：原文；count：整數；rate：百分比（null 寫「—」）；bar：整數＋CSS 長條。 */
  kind?: 'text' | 'count' | 'rate' | 'bar'
  /** 手機橫捲時固定在左側的欄。 */
  sticky?: boolean
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? NO_VALUE : `${value.toFixed(1)}%`
}

/** 前端自己算的比率（接待人員 × 年級的格子），同後端：一位小數、分母 0 為 null。 */
export function ratio(num: number, den: number): number | null {
  return den ? Math.round((num / den) * 1000) / 10 : null
}

/** 月比的百分點（園務「+3.2pt」寫法）。 */
export function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pt`
}

export type Trend = 'up' | 'down' | 'flat' | 'none'
export const TREND_MARK: Record<Trend, string> = { up: '▲', down: '▼', flat: '–', none: '–' }

export function trendOf(value: number | null | undefined): Trend {
  if (value === null || value === undefined) return 'none'
  if (value > 0) return 'up'
  return value < 0 ? 'down' : 'flat'
}

export type RateLevel = 'high' | 'mid' | 'low' | 'none'

/** 園務 RecruitmentDecisionSummary 的上色門檻。 */
export function rateLevel(value: number | null | undefined): RateLevel {
  if (value === null || value === undefined) return 'none'
  if (value >= 60) return 'high'
  return value >= 30 ? 'mid' : 'low'
}

/** CSS 長條寬度：該欄最大值為 100%。 */
export function barWidth(value: number, max: number): string {
  if (!max || value <= 0) return '0%'
  return `${Math.min(100, Math.round((value / max) * 100))}%`
}

const ALERT_LEVEL_LABELS: Record<string, string> = { danger: '高', warning: '中', info: '低' }
export function alertLevelLabel(level: string): string {
  return ALERT_LEVEL_LABELS[level] ?? '提示'
}

const PRIORITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' }
export function priorityLabel(priority: string | null | undefined): string {
  return (priority && PRIORITY_LABELS[priority]) || NO_VALUE
}

/** 年級欄：四個年級固定順序在前，後端回來的其他標籤（「未填寫」）有出現才加；「合計」另外處理。 */
export function gradeColumns(labels: Iterable<string>): string[] {
  const fixed: readonly string[] = GRADES
  const extra = [...new Set(labels)].filter((label) => !fixed.includes(label) && label !== '合計').sort()
  return [...fixed, ...extra]
}
```

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/statsFormat.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 4：統計分頁的失敗測試**

`admin/src/__tests__/statsTab.test.ts`（資料取自 C1 `test_stats_matches_ivy_semantics` 的期望值，前後端對得起來）：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { ElSelect } from 'element-plus'
import StatsTab from '../components/admissions/StatsTab.vue'
import type { AdmissionsStats } from '../api/types'
import { button, cleanup, deferred, mockGet, mountWith, pathsTo, queryOf } from './admissionsTestKit'

afterEach(cleanup)

type Rate = number | null
const snap = (visit: number, deposit: number, enrolled: number, transfer: number, pending: number, effective: number,
  v2d: Rate, v2e: Rate, d2e: Rate, e2e: Rate) => ({
  visit, deposit, enrolled, transfer_term: transfer, pending_deposit: pending, effective_deposit: effective,
  visit_to_deposit_rate: v2d, visit_to_enrolled_rate: v2e, deposit_to_enrolled_rate: d2e, effective_to_enrolled_rate: e2e,
})
const EMPTY = snap(0, 0, 0, 0, 0, 0, null, null, null, null)
const diff = (current: number, previous: number) => ({ current, previous, delta: current - previous })
const rateDiff = (current: Rate, previous: Rate, delta: Rate) => ({ current, previous, delta })

function stats(changes: Partial<AdmissionsStats> = {}): AdmissionsStats {
  return {
    as_of: '2026-10-01T04:00:00Z',
    filters: { campus_key: 'yihua', school_year: 115, semester: 1, reference_month: null },
    reference_month: '115.09',
    kpi: { ...snap(9, 5, 2, 1, 2, 4, 55.6, 22.2, 40, 50), unique_visit: 8, unique_deposit: 4 },
    decision_summary: {
      current_month: snap(5, 1, 0, 0, 1, 1, 20, 0, 0, 0), rolling_30d: snap(6, 2, 0, 1, 1, 1, 33.3, 0, 0, 0),
      rolling_90d: snap(7, 3, 1, 1, 1, 2, 42.9, 14.3, 33.3, 50), ytd: snap(8, 4, 1, 1, 2, 3, 50, 12.5, 25, 33.3),
    },
    funnel_snapshot: { visit: 5, deposit: 1, enrolled: 0, transfer_term: 0, effective_deposit: 1, pending_deposit: 1 },
    month_over_month: {
      current_month: '115.09', previous_month: '115.08',
      visit: diff(5, 3), deposit: diff(1, 3), enrolled: diff(0, 1), effective_deposit: diff(1, 2), pending_deposit: diff(1, 1),
      visit_to_deposit_rate: rateDiff(20, 100, -80), visit_to_enrolled_rate: rateDiff(0, 33.3, -33.3),
      deposit_to_enrolled_rate: rateDiff(0, 33.3, -33.3), effective_to_enrolled_rate: rateDiff(0, 50, -50),
    },
    alerts: [{
      code: 'FUNNEL_DROP', level: 'warning', title: '本月漏斗轉換下滑',
      message: '115.09 參觀轉預繳 -80.0 個百分點，參觀轉註冊 -33.3 個百分點。', target_tab: 'records', target_filter: { month: '115.09' },
    }],
    top_action_queue: [
      { code: 'FOLLOW_HIGH_POTENTIAL', title: '查看高風險未預繳', description: '目前有 2 筆高潛力名單逾期未追。',
        target_tab: 'nodeposit', target_filter: { priority: 'high', overdue_days: 14 } },
      { code: 'REVIEW_CURRENT_MONTH', title: '查看本月明細', description: '切換到 115.09 明細，檢查本月漏斗掉點。',
        target_tab: 'records', target_filter: { month: '115.09' } },
    ],
    monthly: [
      { month: '114.12', ...snap(1, 1, 1, 0, 0, 1, 100, 100, 100, 100) },
      { month: '115.08', ...snap(3, 3, 1, 1, 1, 2, 100, 33.3, 33.3, 50) },
      { month: '115.09', ...snap(5, 1, 0, 0, 1, 1, 20, 0, 0, 0) },
    ],
    by_year: [
      { year: '114', ...snap(1, 1, 1, 0, 0, 1, 100, 100, 100, 100) },
      { year: '115', ...snap(8, 4, 1, 1, 2, 3, 50, 12.5, 25, 33.3) },
    ],
    by_grade: [
      { grade: '小班', visit: 5, deposit: 3, enrolled: 1, visit_to_deposit_rate: 60, visit_to_enrolled_rate: 20, deposit_to_enrolled_rate: 33.3 },
      { grade: '中班', visit: 2, deposit: 2, enrolled: 1, visit_to_deposit_rate: 100, visit_to_enrolled_rate: 50, deposit_to_enrolled_rate: 50 },
      { grade: '幼幼班', visit: 1, deposit: 0, enrolled: 0, visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null },
      { grade: '未填寫', visit: 1, deposit: 0, enrolled: 0, visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null },
    ],
    month_grade: {
      '114.12': { 中班: 1, 合計: 1 },
      '115.08': { 小班: 2, 中班: 1, 合計: 3 },
      '115.09': { 小班: 3, 幼幼班: 1, 未填寫: 1, 合計: 5 },
    },
    by_source: [
      { source: 'Facebook', visit: 5, deposit: 4, visit_to_deposit_rate: 80 },
      { source: '親友介紹', visit: 2, deposit: 1, visit_to_deposit_rate: 50 },
      { source: 'Google 評論', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
      { source: '未填寫', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
    ],
    top_source_names: ['Facebook', '親友介紹', 'Google 評論', '未填寫'],
    by_referrer: [
      { referrer: '林老師', visit: 5, deposit: 3, visit_to_deposit_rate: 60, by_grade: { 小班: { visit: 5, deposit: 3 } } },
      { referrer: '張老師', visit: 3, deposit: 2, visit_to_deposit_rate: 66.7,
        by_grade: { 中班: { visit: 2, deposit: 2 }, 幼幼班: { visit: 1, deposit: 0 } } },
      { referrer: '未填寫', visit: 1, deposit: 0, visit_to_deposit_rate: 0, by_grade: { 未填寫: { visit: 1, deposit: 0 } } },
    ],
    referrer_source_cross: {
      sources: ['Facebook', '親友介紹', 'Google 評論', '未填寫'],
      referrers: [
        { referrer: '林老師', sources: { Facebook: 4, 親友介紹: 1, 'Google 評論': 0, 未填寫: 0 }, total: 5 },
        { referrer: '張老師', sources: { Facebook: 1, 親友介紹: 1, 'Google 評論': 1, 未填寫: 0 }, total: 3 },
        { referrer: '未填寫', sources: { Facebook: 0, 親友介紹: 0, 'Google 評論': 0, 未填寫: 1 }, total: 1 },
      ],
    },
    no_deposit_reasons: [
      { reason: '時程未到／仍在觀望', count: 2, by_grade: { 小班: 1, 未填寫: 1 }, priority: 'high' },
      { reason: '未分類', count: 1, by_grade: { 幼幼班: 1 }, priority: null },
    ],
    no_deposit_total: 3,
    no_deposit_priority: { high: 2, medium: 0, low: 0, other: 1 },
    no_deposit_summary: { high_potential_count: 2, overdue_followup_count: 3, cold_count: 0, high_potential_backlog_count: 2 },
    ...changes,
  }
}

function emptyStats(): AdmissionsStats {
  return stats({
    reference_month: null,
    kpi: { ...EMPTY, unique_visit: 0, unique_deposit: 0 },
    decision_summary: { current_month: EMPTY, rolling_30d: EMPTY, rolling_90d: EMPTY, ytd: EMPTY },
    funnel_snapshot: { visit: 0, deposit: 0, enrolled: 0, transfer_term: 0, effective_deposit: 0, pending_deposit: 0 },
    month_over_month: {
      current_month: null, previous_month: null,
      visit: diff(0, 0), deposit: diff(0, 0), enrolled: diff(0, 0), effective_deposit: diff(0, 0), pending_deposit: diff(0, 0),
      visit_to_deposit_rate: rateDiff(null, null, null), visit_to_enrolled_rate: rateDiff(null, null, null),
      deposit_to_enrolled_rate: rateDiff(null, null, null), effective_to_enrolled_rate: rateDiff(null, null, null),
    },
    alerts: [], top_action_queue: [], monthly: [], by_year: [], by_grade: [], month_grade: {}, by_source: [],
    top_source_names: [], by_referrer: [], referrer_source_cross: { referrers: [], sources: [] }, no_deposit_reasons: [],
    no_deposit_total: 0, no_deposit_priority: { high: 0, medium: 0, low: 0, other: 0 },
    no_deposit_summary: { high_potential_count: 0, overdue_followup_count: 0, cold_count: 0, high_potential_backlog_count: 0 },
  })
}

const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, campusKeys: ['yihua'], ...changes })
const cells = (row: DOMWrapper<Element>) => row.findAll('th, td').map((cell) => cell.text())
const block = (root: VueWrapper | DOMWrapper<Element>, title: string) =>
  root.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const headers = (section: DOMWrapper<Element>) => section.findAll('thead th').map((th) => th.text())
const bodyRows = (section: DOMWrapper<Element>) => section.findAll('tbody tr').map(cells)

async function openSubTab(wrapper: VueWrapper, label: string): Promise<DOMWrapper<Element>> {
  const tab = wrapper.findAll('.stats-subtabs .el-tabs__item').find((item) => item.text() === label)!
  await tab.trigger('click')
  await flushPromises()
  return wrapper.get(`#${tab.attributes('id')!.replace(/^tab-/, 'pane-')}`)
}

describe('統計分頁：總覽', () => {
  it('依頁首校區與學期查詢；決策摘要四張卡、月比徽章、快照、月比、月度與年度表', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    expect(queryOf(pathsTo(get, '/admin/admissions/stats')[0]!).toString()).toBe('campus_key=yihua&school_year=115&semester=1')
    const overview = wrapper.get('#pane-stats-overview')
    expect(overview.get('.decision h3').text()).toBe('主管決策摘要')
    expect(overview.get('.decision .hint').text()).toBe('參考月份：115.09')
    expect(overview.get('.decision__badge').text()).toBe('▼ 月比預繳率 -80.0pt')
    expect(overview.findAll('.decision__card h4').map((n) => n.text())).toEqual(['本月', '近 30 天', '近 90 天', '年度累計'])
    expect(overview.findAll('.decision__visit').map((n) => n.text())).toEqual(['5 人次', '6 人次', '7 人次', '8 人次'])
    expect(overview.findAll('.decision__card')[2]!.text()).toContain('預繳率42.9%')
    expect(overview.findAll('.decision__foot').map((n) => n.text())[3]).toBe('預繳 4 · 註冊 1')
    // 本月漏斗快照：參觀 5 → 轉預繳 20.0% → 預繳 1 → 轉註冊 0.0% → 註冊 0；待轉換 1。
    expect(overview.get('.snapshot').text().replace(/\s+/g, '')).toBe('本月漏斗快照參觀5轉預繳20.0%預繳1轉註冊0.0%註冊0待轉換（預繳未註冊）1')
    expect(overview.get('.mom').text().replace(/\s+/g, '')).toContain('對比月份115.09/115.08')
    expect(headers(block(overview, '月度明細表'))).toEqual([
      '月份', '參觀人數', '預繳人數', '註冊人數', '轉其他學期', '有效預繳', '預繳未註冊', '參觀→預繳率', '參觀→註冊率', '排除轉期→註冊率',
    ])
    expect(bodyRows(block(overview, '月度明細表'))[1]).toEqual(['115.08', '3', '3', '1', '1', '2', '1', '100.0%', '33.3%', '50.0%'])
    expect(bodyRows(block(overview, '年度統計')).map((row) => row[0])).toEqual(['114年', '115年'])
    expect(overview.text()).toContain('有效預繳＝預繳且沒有轉其他學期')
  })

  it('比率是 null 就寫「—」，不寫 0', async () => {
    mockGet({
      '/admin/admissions/stats': stats({
        decision_summary: { ...stats().decision_summary, rolling_30d: EMPTY },
        month_over_month: { ...stats().month_over_month, visit_to_deposit_rate: rateDiff(20, null, null) },
      }),
    })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const rolling = wrapper.findAll('.decision__card')[1]!
    expect(rolling.text()).toContain('預繳率—')
    expect(rolling.text()).toContain('註冊率—')
    expect(rolling.text()).not.toContain('0.0%')
    expect(wrapper.get('.decision__badge').text()).toBe('– 月比預繳率 —')
  })

  it('警示與行動入口：統計內的跳子分頁，「訪視明細」交給頁面切分頁並帶月份', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const alert = wrapper.get('.alert-item')
    expect(alert.text().replace(/\s+/g, '')).toBe('中本月漏斗轉換下滑115.09參觀轉預繳-80.0個百分點，參觀轉註冊-33.3個百分點。')
    await alert.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ month: '115.09' }]])

    await wrapper.findAll('.action-item')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.stats-subtabs .el-tabs__item.is-active').text()).toBe('未預繳原因')
  })
})

describe('統計分頁：其他子分頁（表頭照園務原文）', () => {
  it('班別分析：班別統計與月份 × 班別', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '班別分析')

    expect(headers(block(pane, '班別統計'))).toEqual(['班別', '參觀人數', '預繳人數', '預繳率'])
    expect(bodyRows(block(pane, '班別統計'))).toEqual([
      ['小班', '5', '3', '60.0%'], ['中班', '2', '2', '100.0%'], ['幼幼班', '1', '0', '0.0%'], ['未填寫', '1', '0', '0.0%'],
    ])
    expect(headers(block(pane, '月份 × 班別分布'))).toEqual(['月份', '幼幼班', '小班', '中班', '大班', '未填寫', '合計'])
    expect(bodyRows(block(pane, '月份 × 班別分布'))[2]).toEqual(['115.09', '1', '3', '0', '0', '1', '5'])
  })

  it('來源分析：排名明細有序號，依原文分組', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '來源分析')

    expect(headers(block(pane, '來源排名明細'))).toEqual(['#', '來源', '參觀人數', '預繳人數', '預繳率'])
    expect(bodyRows(block(pane, '來源排名明細'))[0]).toEqual(['1', 'Facebook', '5', '4', '80.0%'])
    expect(pane.get('.stats-bar__fill').attributes('style')).toContain('width: 100%')
  })

  it('接待分析：接待人員統計、× 各年級、介紹者 × 來源', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '接待分析')

    expect(bodyRows(block(pane, '接待人員統計'))[1]).toEqual(['張老師', '3', '2', '66.7%'])
    expect(headers(block(pane, '接待人員 × 各年級預繳率'))).toEqual(['接待人員', '幼幼班', '小班', '中班', '大班', '未填寫'])
    expect(bodyRows(block(pane, '接待人員 × 各年級預繳率'))[1]).toEqual(['張老師', '1人 / 0.0%', '—', '2人 / 100.0%', '—', '—'])
    expect(headers(block(pane, '介紹者 × 來源 交叉分析'))).toEqual(['介紹者', 'Facebook', '親友介紹', 'Google 評論', '未填寫', '合計'])
    expect(bodyRows(block(pane, '介紹者 × 來源 交叉分析'))[0]).toEqual(['林老師', '4', '1', '0', '0', '5'])
  })

  it('未預繳原因：三張數字卡、優先度分組、原因 × 年級（名單不在 StatsTab 本身，由 C3b 的 NoDepositList 負責）', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '未預繳原因')

    expect(pane.findAll('.nodeposit-kpi').map((n) => n.text().replace(/\s+/g, ''))).toEqual(['高潛力未預繳2', '逾14天待追3', '冷名單0'])
    expect(pane.get('.nodeposit-priority').text().replace(/\s+/g, '')).toBe('高潛力2・中潛力0・低潛力0・未歸類1（共3筆）')
    expect(headers(block(pane, '未預繳原因分佈'))).toEqual(['原因分類', '轉換潛力', '筆數', '幼幼班', '小班', '中班', '大班', '未填寫'])
    expect(bodyRows(block(pane, '未預繳原因分佈'))).toEqual([
      ['時程未到／仍在觀望', '高', '2', '0', '1', '0', '0', '1'],
      ['未分類', '—', '1', '1', '0', '0', '0', '0'],
    ])
    expect(pane.text()).toContain('已退預繳、退註冊的不算未預繳；冷名單＝建檔滿 90 天仍未預繳。')
  })
})

describe('統計分頁：狀態', () => {
  it('無資料：寫出原因，不顯示假的 0；子分頁用園務的空狀態文案', async () => {
    mockGet({ '/admin/admissions/stats': emptyStats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const overview = wrapper.get('#pane-stats-overview')
    expect(overview.get('.stats-empty').text()).toBe('義華在 115 上學期還沒有招生訪視。新增訪視，或在「官網預約」確認到場後，這裡就會有統計。')
    expect(overview.find('.decision').exists()).toBe(false)
    expect(overview.text()).not.toContain('0.0%')
    expect((await openSubTab(wrapper, '班別分析')).text()).toContain('此區間尚無班別資料')
    expect((await openSubTab(wrapper, '來源分析')).text()).toContain('此區間尚無來源資料')
    expect((await openSubTab(wrapper, '接待分析')).text()).toContain('此區間尚無接待資料')
    expect((await openSubTab(wrapper, '未預繳原因')).text()).toContain('此區間尚無未預繳資料')
  })

  it('沒選學年：寫「所有學年」', async () => {
    mockGet({ '/admin/admissions/stats': emptyStats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ schoolYear: null, semester: null }) })
    expect(wrapper.get('#pane-stats-overview .stats-empty').text()).toContain('義華在所有學年還沒有招生訪視。')
  })

  it('讀取失敗：顯示錯誤與重新載入，重試成功後恢復', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/stats': () => {
        if (fail) throw new Error('network')
        return stats()
      },
    })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    expect(wrapper.get('.el-alert').text()).toContain('無法讀取統計資料，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/stats')).toHaveLength(2)
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.get('.decision__badge').text()).toBe('▼ 月比預繳率 -80.0pt')
  })

  it('快速切換校區只顯示最後一次（明華先回、義華晚回也不會蓋掉）', async () => {
    const yihua = deferred<AdmissionsStats>()
    const minghua = deferred<AdmissionsStats>()
    mockGet({ '/admin/admissions/stats': (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? yihua.promise : minghua.promise) })
    const { wrapper } = await mountWith(StatsTab, { props: props({ campusKeys: ['yihua', 'minghua'] }) })

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    minghua.resolve(stats({ reference_month: '115.08', filters: { campus_key: 'minghua', school_year: 115, semester: 1, reference_month: null } }))
    await flushPromises()
    yihua.resolve(stats())
    await flushPromises()

    expect(wrapper.get('.decision .hint').text()).toBe('參考月份：115.08')
  })

  it('參考月份：選項是有資料的月份（新到舊），選了就帶 reference_month；換校區回到最新月份', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ campusKeys: ['yihua', 'minghua'] }) })

    const select = wrapper.findComponent(ElSelect)
    expect(wrapper.findAll('.el-select-dropdown__item').map((item) => item.text())).toEqual(['115.09', '115.08', '114.12'])
    select.vm.$emit('update:modelValue', '115.08')
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/stats').at(-1)!).get('reference_month')).toBe('115.08')

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    const last = queryOf(pathsTo(get, '/admin/admissions/stats').at(-1)!)
    expect([last.get('campus_key'), last.get('reference_month')]).toEqual(['minghua', null])
  })
})
```

- [ ] **Step 5：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/statsTab.test.ts`
Expected: FAIL——B1 的佔位沒有 `#pane-stats-overview`、`.decision`，也不會呼叫 `/admin/admissions/stats`（`pathsTo(...)[0]` 是 `undefined`）。

- [ ] **Step 6：API 呼叫與型別別名**

`admin/src/api/types.ts` 檔尾（A9／B1 加的招生別名之後）加：

```ts
// 統計（C3）。AdmissionsStatsOut 在 C1 才進 OpenAPI，所以沒有跟 A9 的別名放在一起。
export type AdmissionsStats = components['schemas']['AdmissionsStatsOut']
```

`admin/src/api/admissions.ts`：

1. 檔頭註解裡的「統計（getStats、getCompare）在 C3、C4 加。」改成「統計：getStats（C3）、getCompare（C4）。」
2. `import type { … } from './types'` 那一段的型別清單加上 `AdmissionsStats`（照字母序放在 `AdmissionsOptions` 之後）。
3. 檔尾加（`toQuery` 是同檔既有的私有函式，null 與空字串不送）：

```ts
/** 統計分析（規格第 9 節）。school_year／semester 為 null＝不篩；reference_month 為 null＝最新有資料的月份。 */
export function getStats(params: {
  campus_key: string
  school_year: number | null
  semester: number | null
  reference_month: string | null
}): Promise<AdmissionsStats> {
  return api.get<AdmissionsStats>(`/admin/admissions/stats?${toQuery(params)}`)
}
```

- [ ] **Step 7：共用表格 `admin/src/components/admissions/StatsDimensionTable.vue`**

```vue
<script setup lang="ts">
import { computed, useId } from 'vue'
import { NO_VALUE, barWidth, formatRate, type StatsColumn } from '../../admissions/statsFormat'

// 統計的共用表格：標題＋表格，bar 欄在數字旁畫 CSS 長條（規格 10：不新增圖表套件，
// 長條只是輔助，數字一定寫出來）。手機寬度表格在框內橫捲，sticky 欄固定在左側，
// 頁面本身不溢出（R16）。count／bar 欄缺值寫 0（呼叫端已補齊），text 欄缺值寫「—」。
const props = withDefaults(
  defineProps<{
    title: string
    rows: readonly Record<string, unknown>[]
    columns: readonly StatsColumn[]
    rowKey: string
    emptyText: string
    numbered?: boolean
    caption?: string
  }>(),
  { numbered: false, caption: '' },
)

const headingId = useId()

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 每個 bar 欄的最大值：長條以它為 100%。
const maxima = computed(() => {
  const result: Record<string, number> = {}
  for (const column of props.columns) {
    if (column.kind === 'bar') result[column.key] = Math.max(0, ...props.rows.map((row) => toNumber(row[column.key])))
  }
  return result
})

function display(row: Record<string, unknown>, column: StatsColumn): string {
  const value = row[column.key]
  if (column.kind === 'rate') return formatRate(typeof value === 'number' ? value : null)
  if (column.kind === 'count' || column.kind === 'bar') return String(toNumber(value))
  if (value === null || value === undefined || value === '') return NO_VALUE
  return String(value)
}

const isNumeric = (column: StatsColumn) => column.kind === 'count' || column.kind === 'rate' || column.kind === 'bar'
</script>

<template>
  <section class="stats-block" :aria-labelledby="headingId">
    <h3 :id="headingId" class="stats-block__title">{{ title }}</h3>
    <p v-if="caption" class="hint stats-block__caption">{{ caption }}</p>
    <p v-if="!rows.length" class="stats-block__empty">{{ emptyText }}</p>
    <div v-else class="stats-block__scroll" role="region" tabindex="0" :aria-label="`${title}（可左右捲動）`">
      <table class="stats-table">
        <thead>
          <tr>
            <th v-if="numbered" scope="col" class="stats-table__index">#</th>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :class="{ 'stats-table__sticky': column.sticky, 'stats-table__number': isNumeric(column) }"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="String(row[rowKey])">
            <td v-if="numbered" class="stats-table__index num">{{ index + 1 }}</td>
            <template v-for="column in columns" :key="column.key">
              <th v-if="column.sticky" scope="row" class="stats-table__sticky">{{ display(row, column) }}</th>
              <td v-else-if="column.kind === 'bar'" class="stats-table__number">
                <span class="stats-bar" aria-hidden="true">
                  <span class="stats-bar__fill" :style="{ width: barWidth(toNumber(row[column.key]), maxima[column.key] ?? 0) }" />
                </span>
                <span class="num">{{ display(row, column) }}</span>
              </td>
              <td v-else :class="{ 'stats-table__number': isNumeric(column), num: isNumeric(column) }">{{ display(row, column) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.stats-block {
  min-width: 0;
}

.stats-block__title {
  margin-bottom: 8px;
  font-size: 15px;
}

.stats-block__caption {
  margin: -4px 0 8px;
}

.stats-block__empty {
  padding: 20px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-3);
  text-align: center;
}

.stats-block__scroll {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.stats-table th,
.stats-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.stats-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
}

.stats-table tbody tr:last-child > * {
  border-bottom: 0;
}

.stats-table tbody th {
  color: var(--ink);
  font-weight: 500;
}

/* 要壓過上面 `.stats-table th, .stats-table td` 的靠左，選擇器多一層。 */
.stats-table .stats-table__number {
  text-align: right;
}

.stats-table .stats-table__index {
  width: 1%;
  color: var(--ink-3);
  text-align: right;
}

.stats-table__sticky {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface);
}

.stats-table thead .stats-table__sticky {
  background: var(--surface-2);
}

.stats-bar {
  display: inline-block;
  width: 72px;
  height: 6px;
  margin-right: 8px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
  vertical-align: middle;
}

.stats-bar__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

@media (max-width: 720px) {
  .stats-table th,
  .stats-table td {
    padding: 8px 10px;
  }

  .stats-bar {
    width: 40px;
  }
}
</style>
```

`statsTab.test.ts` 還要 StatsOverview 與 StatsTab，這一步先不跑。

- [ ] **Step 8：總覽 `admin/src/components/admissions/StatsOverview.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsStats } from '../../api/types'
import {
  NO_VALUE, TREND_MARK, alertLevelLabel, formatPoints, formatRate, rateLevel, ratio, trendOf,
  type StatsColumn, type StatsTarget,
} from '../../admissions/statsFormat'

// 統計「總覽」（園務 RecruitmentOverviewTab 的區塊）：主管決策摘要 → 異常警示、行動入口 →
// 本月漏斗快照、月比變化 → 本範圍合計 → 月度明細表 → 年度統計。官網差異：園務的兩張圖
// （月度量體、轉換率走勢）由月度明細表的長條取代；「全管道彙整」是園務自家官網報名，不做；
// 「本範圍合計」是官網加的，一次列出規格 9.2 的六個計數、唯一幼生與四個比率。
// 比率 null（分母 0）一律寫「—」。
const props = defineProps<{ stats: AdmissionsStats }>()
const emit = defineEmits<{ navigate: [target: { tab: StatsTarget; filter: Record<string, string | number> }] }>()

type Snapshot = AdmissionsStats['decision_summary']['current_month']
type Target = { target_tab: StatsTarget; target_filter: Record<string, string | number> }

const cards = computed<{ key: string; title: string; snapshot: Snapshot }[]>(() => [
  { key: 'current_month', title: '本月', snapshot: props.stats.decision_summary.current_month },
  { key: 'rolling_30d', title: '近 30 天', snapshot: props.stats.decision_summary.rolling_30d },
  { key: 'rolling_90d', title: '近 90 天', snapshot: props.stats.decision_summary.rolling_90d },
  { key: 'ytd', title: '年度累計', snapshot: props.stats.decision_summary.ytd },
])

const mom = computed(() => props.stats.month_over_month)
const funnel = computed(() => props.stats.funnel_snapshot)
const badgeTrend = computed(() => trendOf(mom.value.visit_to_deposit_rate.delta))

const kpiItems = computed(() => {
  const kpi = props.stats.kpi
  return [
    { label: '參觀', value: String(kpi.visit), sub: `唯一幼生 ${kpi.unique_visit}` },
    { label: '預繳', value: String(kpi.deposit), sub: `唯一幼生 ${kpi.unique_deposit}` },
    { label: '註冊', value: String(kpi.enrolled), sub: '' },
    { label: '轉其他學期', value: String(kpi.transfer_term), sub: '' },
    { label: '有效預繳', value: String(kpi.effective_deposit), sub: '' },
    { label: '預繳未註冊', value: String(kpi.pending_deposit), sub: '' },
    { label: '參觀→預繳率', value: formatRate(kpi.visit_to_deposit_rate), sub: '' },
    { label: '參觀→註冊率', value: formatRate(kpi.visit_to_enrolled_rate), sub: '' },
    { label: '預繳→註冊率', value: formatRate(kpi.deposit_to_enrolled_rate), sub: '' },
    { label: '排除轉期→註冊率', value: formatRate(kpi.effective_to_enrolled_rate), sub: '' },
  ]
})

// 園務警示等級：danger 高、warning 中、info 低。
const TAG_TYPES: Record<string, 'danger' | 'warning' | 'info'> = { danger: 'danger', warning: 'warning', info: 'info' }

function go(item: Target) {
  emit('navigate', { tab: item.target_tab, filter: item.target_filter })
}

// 表頭照園務原文（月度明細表沒有「預繳→註冊率」，年度統計沒有「有效預繳」）。
const MONTHLY_COLUMNS: StatsColumn[] = [
  { key: 'month', label: '月份', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'enrolled', label: '註冊人數', kind: 'count' },
  { key: 'transfer_term', label: '轉其他學期', kind: 'count' },
  { key: 'effective_deposit', label: '有效預繳', kind: 'count' },
  { key: 'pending_deposit', label: '預繳未註冊', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '參觀→預繳率', kind: 'rate' },
  { key: 'visit_to_enrolled_rate', label: '參觀→註冊率', kind: 'rate' },
  { key: 'effective_to_enrolled_rate', label: '排除轉期→註冊率', kind: 'rate' },
]
const YEARLY_COLUMNS: StatsColumn[] = [
  { key: 'label', label: '年份', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'enrolled', label: '註冊人數', kind: 'count' },
  { key: 'transfer_term', label: '轉其他學期', kind: 'count' },
  { key: 'pending_deposit', label: '預繳未註冊', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '參觀→預繳率', kind: 'rate' },
  { key: 'visit_to_enrolled_rate', label: '參觀→註冊率', kind: 'rate' },
  { key: 'effective_to_enrolled_rate', label: '排除轉期→註冊率', kind: 'rate' },
]
const yearlyRows = computed(() => props.stats.by_year.map((row) => ({ ...row, label: `${row.year}年` })))
</script>

<template>
  <div class="overview">
    <section class="stats-card decision">
      <div class="decision__head">
        <div>
          <h3>主管決策摘要</h3>
          <p class="hint">參考月份：{{ stats.reference_month ?? '尚未指定' }}</p>
        </div>
        <span class="decision__badge" :class="`decision__badge--${badgeTrend}`">{{ TREND_MARK[badgeTrend] }} 月比預繳率 {{ formatPoints(mom.visit_to_deposit_rate.delta) }}</span>
      </div>
      <div class="decision__cards">
        <article v-for="card in cards" :key="card.key" class="decision__card">
          <h4>{{ card.title }}</h4>
          <p class="decision__visit"><strong class="num">{{ card.snapshot.visit }}</strong> 人次</p>
          <dl class="decision__rates">
            <div>
              <dt>預繳率</dt>
              <dd class="num" :class="`rate--${rateLevel(card.snapshot.visit_to_deposit_rate)}`">{{ formatRate(card.snapshot.visit_to_deposit_rate) }}</dd>
            </div>
            <div>
              <dt>註冊率</dt>
              <dd class="num" :class="`rate--${rateLevel(card.snapshot.visit_to_enrolled_rate)}`">{{ formatRate(card.snapshot.visit_to_enrolled_rate) }}</dd>
            </div>
          </dl>
          <p class="decision__foot">預繳 {{ card.snapshot.deposit }} · 註冊 {{ card.snapshot.enrolled }}</p>
        </article>
      </div>
    </section>

    <div class="overview__pair">
      <section class="stats-card">
        <h3>異常警示</h3>
        <ul v-if="stats.alerts.length" class="overview__list">
          <li v-for="alert in stats.alerts" :key="alert.code">
            <button type="button" class="alert-item" @click="go(alert)">
              <el-tag size="small" :type="TAG_TYPES[alert.level] ?? 'info'" disable-transitions>{{ alertLevelLabel(alert.level) }}</el-tag>
              <strong>{{ alert.title }}</strong>
              <span class="alert-item__message">{{ alert.message }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="overview__empty">目前沒有明顯異常</p>
      </section>
      <section class="stats-card">
        <h3>行動入口</h3>
        <ul v-if="stats.top_action_queue.length" class="overview__list">
          <li v-for="action in stats.top_action_queue" :key="action.code">
            <button type="button" class="action-item" @click="go(action)">
              <strong>{{ action.title }}</strong>
              <span>{{ action.description }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="overview__empty">目前沒有需要優先處理的事項</p>
      </section>
    </div>

    <div class="overview__pair">
      <section class="stats-card snapshot">
        <h3>本月漏斗快照</h3>
        <ol class="snapshot__steps">
          <li class="snapshot__step">
            <span>參觀</span>
            <strong class="num">{{ funnel.visit }}</strong>
          </li>
          <li class="snapshot__rate">
            <span>轉預繳</span>
            <span class="num">{{ formatRate(ratio(funnel.deposit, funnel.visit)) }}</span>
          </li>
          <li class="snapshot__step">
            <span>預繳</span>
            <strong class="num">{{ funnel.deposit }}</strong>
          </li>
          <li class="snapshot__rate">
            <span>轉註冊</span>
            <span class="num">{{ formatRate(ratio(funnel.enrolled, funnel.deposit)) }}</span>
          </li>
          <li class="snapshot__step">
            <span>註冊</span>
            <strong class="num">{{ funnel.enrolled }}</strong>
          </li>
        </ol>
        <p class="snapshot__pending" :class="{ 'snapshot__pending--alert': funnel.pending_deposit > 0 }">
          <span>待轉換（預繳未註冊）</span>
          <strong class="num">{{ funnel.pending_deposit }}</strong>
        </p>
      </section>
      <section class="stats-card mom">
        <h3>月比變化</h3>
        <dl class="mom__list">
          <div>
            <dt>參觀→預繳率</dt>
            <dd class="num" :class="`trend--${trendOf(mom.visit_to_deposit_rate.delta)}`">{{ TREND_MARK[trendOf(mom.visit_to_deposit_rate.delta)] }} {{ formatPoints(mom.visit_to_deposit_rate.delta) }}</dd>
          </div>
          <div>
            <dt>參觀→註冊率</dt>
            <dd class="num" :class="`trend--${trendOf(mom.visit_to_enrolled_rate.delta)}`">{{ TREND_MARK[trendOf(mom.visit_to_enrolled_rate.delta)] }} {{ formatPoints(mom.visit_to_enrolled_rate.delta) }}</dd>
          </div>
          <div>
            <dt>有效預繳</dt>
            <dd class="num">{{ mom.effective_deposit.current }}（上月 {{ mom.effective_deposit.previous }}）</dd>
          </div>
          <div>
            <dt>對比月份</dt>
            <dd class="num">{{ mom.current_month ?? NO_VALUE }} / {{ mom.previous_month ?? NO_VALUE }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="stats-card">
      <h3>本範圍合計</h3>
      <dl class="kpi">
        <div v-for="item in kpiItems" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>
            <strong class="num">{{ item.value }}</strong>
            <span v-if="item.sub" class="kpi__sub">{{ item.sub }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <StatsDimensionTable title="月度明細表" :rows="stats.monthly" :columns="MONTHLY_COLUMNS" row-key="month" empty-text="此區間尚無資料" />
    <StatsDimensionTable
      title="年度統計"
      :rows="yearlyRows"
      :columns="YEARLY_COLUMNS"
      row-key="year"
      empty-text="此區間尚無資料"
      caption="依參觀月份的民國年加總，不是入學學年。"
    />
    <p class="hint">
      口徑：有效預繳＝預繳且沒有轉其他學期；排除轉期→註冊率＝註冊 ÷ 有效預繳；預繳未註冊＝已預繳、還沒註冊、也沒轉其他學期。近 30／90 天依建檔時間，其餘依參觀月份。分母是 0 的比率寫「—」。
    </p>
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.stats-card {
  min-width: 0;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.stats-card h3 {
  margin-bottom: 12px;
  font-size: 15px;
}

.decision__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 12px;
}

.decision__head h3 {
  margin-bottom: 2px;
}

.decision__badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.decision__badge--up {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.decision__badge--down {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.decision__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.decision__card {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.decision__card h4 {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
}

.decision__visit {
  margin: 6px 0;
  color: var(--ink-2);
  font-size: 13px;
}

.decision__visit strong {
  color: var(--ink);
  font-size: 22px;
}

.decision__rates,
.mom__list {
  display: grid;
  gap: 4px;
  margin: 0;
}

.decision__rates div,
.mom__list div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.decision__rates dt,
.mom__list dt {
  color: var(--ink-3);
}

.decision__rates dd,
.mom__list dd {
  margin: 0;
  font-weight: 600;
}

.rate--high,
.trend--up {
  color: var(--el-color-success);
}

.rate--mid {
  color: var(--brand-gold-ink);
}

.rate--low,
.trend--down {
  color: var(--el-color-danger);
}

.rate--none,
.trend--none,
.trend--flat {
  color: var(--ink-3);
}

.decision__foot {
  margin-top: 8px;
  color: var(--ink-3);
  font-size: 13px;
}

.overview__pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.overview__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.overview__empty {
  color: var(--ink-3);
}

.alert-item,
.action-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.alert-item {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
}

.alert-item__message {
  grid-column: 2;
  color: var(--ink-2);
  font-size: 13px;
}

.action-item span {
  color: var(--ink-2);
  font-size: 13px;
}

.alert-item:hover,
.action-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.snapshot__steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.snapshot__step,
.snapshot__pending {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.snapshot__step strong {
  font-size: 18px;
}

.snapshot__rate {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-left: 16px;
  color: var(--ink-3);
  font-size: 13px;
}

/* 箭頭只是裝飾，用 CSS 畫，不進文字內容。 */
.snapshot__rate span:first-child::before {
  content: '↓ ';
}

.snapshot__pending {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.snapshot__pending--alert strong {
  color: var(--el-color-warning-dark-2);
}

.kpi {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin: 0;
}

.kpi dt {
  color: var(--ink-3);
  font-size: 13px;
}

.kpi dd {
  display: grid;
  margin: 0;
}

.kpi dd strong {
  font-size: 18px;
}

.kpi__sub {
  color: var(--ink-3);
  font-size: 12px;
}

@media (max-width: 720px) {
  .stats-card {
    padding: 14px 16px;
  }

  .decision__cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview__pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
```

- [ ] **Step 9：統計分頁 `admin/src/components/admissions/StatsTab.vue`（整檔覆寫 B1 的空狀態）**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import StatsOverview from './StatsOverview.vue'
import { getStats } from '../../api/admissions'
import { campusLabel, formatDateTime } from '../../api/labels'
import type { AdmissionsStats } from '../../api/types'
import { termLabel } from '../../admissions/academic'
import { SEMESTER_LABELS } from '../../admissions/constants'
import { NO_VALUE, formatRate, gradeColumns, priorityLabel, ratio, type StatsColumn, type StatsTarget } from '../../admissions/statsFormat'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 統計分析（規格 9、10）。頁首的校區與入學學年學期由 AdmissionsView 傳進來；這裡管參考月份、
// 子分頁與讀取。換校區或學期時先清空畫面再讀，只採用最後一次的回應（R15：不殘留別校的數字）。
// 子分頁順序同園務：總覽、班別分析、來源分析、接待分析、未預繳原因（園務的「區域分析」不做）。
// 警示與行動入口指到統計內的子分頁就直接切；指到訪視明細就交給頁面（open-records）。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: number | null; campusKeys: readonly string[] }>()
const emit = defineEmits<{ 'open-records': [filter: { month: string }] }>()

const SUB_TABS = ['stats-overview', 'stats-class', 'stats-source', 'stats-staff', 'stats-nodeposit'] as const
type SubTab = (typeof SUB_TABS)[number]
const subTab = ref<SubTab>('stats-overview')

function isSubTab(value: unknown): value is SubTab {
  return typeof value === 'string' && (SUB_TABS as readonly string[]).includes(value)
}
function setSubTab(name: string | number) {
  if (isSubTab(name)) subTab.value = name
}

const stats = ref<AdmissionsStats | null>(null)
const loading = ref(false)
const failed = ref(false)
// null＝跟著後端取最新有資料的月份（園務 _select_reference_month）。
const referenceMonth = ref<string | null>(null)
const requests = useRequestSequence()

async function load(options: { reset?: boolean } = {}) {
  const request = requests.begin()
  if (options.reset) stats.value = null
  failed.value = false
  if (!props.campusKey) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await getStats({
      campus_key: props.campusKey,
      school_year: props.schoolYear,
      semester: props.semester,
      reference_month: referenceMonth.value,
    })
    if (requests.isCurrent(request)) stats.value = result
  } catch {
    if (requests.isCurrent(request)) {
      stats.value = null
      failed.value = true
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 換校區或學年學期：參考月份回到「最新」，畫面清空再讀（不留舊校區的數字）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    referenceMonth.value = null
    void load({ reset: true })
  },
  { immediate: true },
)

// 換參考月份只影響本月、月比、年度累計與警示；保留畫面、蓋一層讀取中。
function setReferenceMonth(value: string | null | undefined) {
  referenceMonth.value = value || null
  void load()
}

const hasData = computed(() => (stats.value?.kpi.visit ?? 0) > 0)
// 有資料的月份，新到舊（園務參考月份選單同一份來源）。
const monthOptions = computed(() => [...(stats.value?.monthly ?? [])].reverse().map((row) => row.month))

const scopeLabel = computed(() => {
  if (props.schoolYear === null) {
    return props.semester === null ? '所有學年' : `所有學年的${SEMESTER_LABELS[props.semester === 2 ? 2 : 1]}`
  }
  return termLabel(props.schoolYear, props.semester)
})
// 規格 10：沒有資料時寫原因，不顯示假的 0。
const emptyText = computed(
  () =>
    `${campusLabel(props.campusKey)}在${props.schoolYear === null ? '' : ' '}${scopeLabel.value}還沒有招生訪視。新增訪視，或在「官網預約」確認到場後，這裡就會有統計。`,
)

function navigate(target: { tab: StatsTarget; filter: Record<string, string | number> }) {
  if (target.tab === 'records') {
    const month = target.filter.month
    if (typeof month === 'string' && month) emit('open-records', { month })
    return
  }
  setSubTab(`stats-${target.tab}`)
}

// 表頭照園務 Recruitment{Class,Source,Staff,NoDeposit}Tab 原文。
const GRADE_COLUMNS: StatsColumn[] = [
  { key: 'grade', label: '班別', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]
const SOURCE_COLUMNS: StatsColumn[] = [
  { key: 'source', label: '來源', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]
const STAFF_COLUMNS: StatsColumn[] = [
  { key: 'referrer', label: '接待人員', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
]

// 動態欄的 key 加前綴（g: 年級、s: 來源），來源或年級字面上叫 month／total 也不會撞到。
const monthGradeLabels = computed(() =>
  gradeColumns(Object.values(stats.value?.month_grade ?? {}).flatMap((cells) => Object.keys(cells))),
)
const monthGradeColumns = computed<StatsColumn[]>(() => [
  { key: 'month', label: '月份', sticky: true },
  ...monthGradeLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const monthGradeRows = computed(() =>
  (stats.value?.monthly ?? []).map((row) => {
    const cells = stats.value?.month_grade[row.month] ?? {}
    return {
      month: row.month,
      total: cells['合計'] ?? 0,
      ...Object.fromEntries(monthGradeLabels.value.map((grade) => [`g:${grade}`, cells[grade] ?? 0])),
    }
  }),
)

const staffGradeLabels = computed(() => gradeColumns((stats.value?.by_referrer ?? []).flatMap((row) => Object.keys(row.by_grade))))
const staffGradeColumns = computed<StatsColumn[]>(() => [
  { key: 'referrer', label: '接待人員', sticky: true },
  ...staffGradeLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade })),
])
// 園務 StaffTab：格內「{參觀}人 / {預繳率}」，沒有資料寫「—」。
const staffGradeRows = computed(() =>
  (stats.value?.by_referrer ?? []).map((row) => ({
    referrer: row.referrer,
    ...Object.fromEntries(
      staffGradeLabels.value.map((grade) => {
        const cell = row.by_grade[grade]
        return [`g:${grade}`, cell ? `${cell.visit}人 / ${formatRate(ratio(cell.deposit, cell.visit))}` : NO_VALUE]
      }),
    ),
  })),
)

const crossColumns = computed<StatsColumn[]>(() => [
  { key: 'referrer', label: '介紹者', sticky: true },
  ...(stats.value?.referrer_source_cross.sources ?? []).map((source): StatsColumn => ({ key: `s:${source}`, label: source, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const crossRows = computed(() =>
  (stats.value?.referrer_source_cross.referrers ?? []).map((row) => ({
    referrer: row.referrer,
    total: row.total,
    ...Object.fromEntries(Object.entries(row.sources).map(([source, count]) => [`s:${source}`, count])),
  })),
)

const noDepositLabels = computed(() =>
  gradeColumns((stats.value?.no_deposit_reasons ?? []).flatMap((row) => Object.keys(row.by_grade))),
)
const noDepositColumns = computed<StatsColumn[]>(() => [
  { key: 'reason', label: '原因分類', sticky: true },
  { key: 'priority', label: '轉換潛力' },
  { key: 'count', label: '筆數', kind: 'bar' },
  ...noDepositLabels.value.map((grade): StatsColumn => ({ key: `g:${grade}`, label: grade, kind: 'count' })),
])
const noDepositRows = computed(() =>
  (stats.value?.no_deposit_reasons ?? []).map((row) => ({
    reason: row.reason,
    priority: priorityLabel(row.priority),
    count: row.count,
    ...Object.fromEntries(noDepositLabels.value.map((grade) => [`g:${grade}`, row.by_grade[grade] ?? 0])),
  })),
)
// 園務 NoDepositTab 的三張數字卡（> 0 才上色）。
const noDepositKpis = computed(() => {
  const summary = stats.value?.no_deposit_summary
  return [
    { label: '高潛力未預繳', value: summary?.high_potential_count ?? 0 },
    { label: '逾 14 天待追', value: summary?.overdue_followup_count ?? 0 },
    { label: '冷名單', value: summary?.cold_count ?? 0 },
  ]
})
</script>

<template>
  <section class="stats" aria-label="統計分析">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取統計資料，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!stats" :rows="6" animated />
    <template v-else>
      <div class="stats-toolbar">
        <p class="hint stats-scope">
          統計範圍：{{ campusLabel(campusKey) }}・{{ scopeLabel }}（依入學學年學期）・資料時間
          <time class="num">{{ formatDateTime(stats.as_of) }}</time>
        </p>
        <div v-if="hasData" class="filter-field">
          <span>參考月份</span>
          <!-- 不 teleport：選單留在元件裡，單元測試才找得到選項；外層沒有 overflow:hidden。 -->
          <el-select
            :model-value="referenceMonth ?? undefined"
            clearable
            :placeholder="`最新（${stats.reference_month ?? NO_VALUE}）`"
            aria-label="參考月份"
            class="stats-month"
            :teleported="false"
            @update:model-value="setReferenceMonth"
          >
            <el-option v-for="month in monthOptions" :key="month" :label="month" :value="month" />
          </el-select>
        </div>
      </div>

      <el-tabs v-loading="loading" :model-value="subTab" class="stats-subtabs" @update:model-value="setSubTab">
        <el-tab-pane label="總覽" name="stats-overview">
          <StatsOverview v-if="hasData" :stats="stats" @navigate="navigate" />
          <p v-else class="stats-empty">{{ emptyText }}</p>
        </el-tab-pane>

        <el-tab-pane label="班別分析" name="stats-class">
          <div class="stats-pane">
            <StatsDimensionTable title="班別統計" :rows="stats.by_grade" :columns="GRADE_COLUMNS" row-key="grade" empty-text="此區間尚無班別資料" />
            <StatsDimensionTable
              title="月份 × 班別分布"
              :rows="monthGradeRows"
              :columns="monthGradeColumns"
              row-key="month"
              empty-text="此區間尚無班別資料"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="來源分析" name="stats-source">
          <div class="stats-pane">
            <StatsDimensionTable
              title="來源排名明細"
              :rows="stats.by_source"
              :columns="SOURCE_COLUMNS"
              row-key="source"
              numbered
              empty-text="此區間尚無來源資料"
              caption="依家長填的來源原文分組（園務會合併義華的同義字詞，官網不合併）。"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="接待分析" name="stats-staff">
          <div class="stats-pane">
            <StatsDimensionTable
              title="接待人員統計"
              :rows="stats.by_referrer"
              :columns="STAFF_COLUMNS"
              row-key="referrer"
              empty-text="此區間尚無接待資料"
              caption="接待人員＝訪視表單的「介紹者」欄。"
            />
            <StatsDimensionTable
              title="接待人員 × 各年級預繳率"
              :rows="staffGradeRows"
              :columns="staffGradeColumns"
              row-key="referrer"
              empty-text="此區間尚無接待資料"
              caption="格內寫「參觀人數 / 預繳率」。"
            />
            <StatsDimensionTable
              v-if="crossRows.length"
              title="介紹者 × 來源 交叉分析"
              :rows="crossRows"
              :columns="crossColumns"
              row-key="referrer"
              empty-text="此區間尚無接待資料"
              caption="欄位是參觀人數前 10 名的來源；合計含其他來源。"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="未預繳原因" name="stats-nodeposit">
          <div class="stats-pane">
            <template v-if="stats.no_deposit_total">
              <div class="nodeposit-summary">
                <div
                  v-for="item in noDepositKpis"
                  :key="item.label"
                  class="nodeposit-kpi"
                  :class="{ 'nodeposit-kpi--on': item.value > 0 }"
                >
                  <span>{{ item.label }}</span>
                  <strong class="num">{{ item.value }}</strong>
                </div>
              </div>
              <p class="nodeposit-priority">
                高潛力 {{ stats.no_deposit_priority.high }}・中潛力 {{ stats.no_deposit_priority.medium }}・低潛力 {{ stats.no_deposit_priority.low }}・未歸類 {{ stats.no_deposit_priority.other }}（共 {{ stats.no_deposit_total }} 筆）
              </p>
            </template>
            <StatsDimensionTable
              title="未預繳原因分佈"
              :rows="noDepositRows"
              :columns="noDepositColumns"
              row-key="reason"
              empty-text="此區間尚無未預繳資料"
            />
            <p class="hint">
              名單請到「訪視明細」用「預繳：否」與「未預繳原因」篩選。已退預繳、退註冊的不算未預繳；冷名單＝建檔滿 90 天仍未預繳。
            </p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </section>
</template>

<style scoped>
.stats {
  min-width: 0;
}

.stats-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.stats-scope {
  margin: 0;
}

.stats-month {
  width: 180px;
}

.stats-subtabs {
  min-width: 0;
}

.stats-pane {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.stats-empty {
  padding: 32px 16px;
  color: var(--ink-2);
  text-align: center;
}

.nodeposit-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.nodeposit-kpi {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-3);
}

.nodeposit-kpi strong {
  color: var(--ink-3);
  font-size: 22px;
}

.nodeposit-kpi--on strong {
  color: var(--el-color-warning-dark-2);
}

.nodeposit-priority {
  margin: 0;
  color: var(--ink-2);
}

@media (max-width: 720px) {
  .stats-month {
    width: 100%;
  }

  .nodeposit-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
```

- [ ] **Step 10：跑統計分頁的測試確認通過**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/statsFormat.test.ts src/__tests__/statsTab.test.ts`
Expected: PASS（statsFormat 7 項、statsTab 12 項）。常見落差與處理：
- 「參考月份」那一項找不到 `.el-select-dropdown__item`：確認 `<el-select>` 有 `:teleported="false"`（選單才留在元件裡）。
- 文字比對差一個空白：模板裡 `<dt>`、`<dd>` 要各自一行（同一行會被壓成一個空白，`'預繳率42.9%'` 就對不上）。
- 不要改測試的期望值去湊；期望值是 C1 `test_stats_matches_ivy_semantics` 手算出來的同一組數字。

- [ ] **Step 11：頁面接上統計分頁（`AdmissionsView.vue` 一處）並改 B1 的頁面測試**

先改 B1 的頁面測試 `admin/src/__tests__/admissionsView.test.ts`，讓它變成這一步的失敗測試：

1. `noArrivals` 改成（統計分頁自己的畫面在 `statsTab.test.ts` 測；這支只看頁面傳給它的 props 與事件，統計 API 一律回錯誤，StatsTab 顯示「無法讀取統計資料」，不會因為假資料形狀不對而丟例外）：

```ts
const noArrivals = {
  '/admin/admissions/arrivals': { awaiting: [], missing: [] },
  '/admin/admissions/stats': () => {
    throw new Error('統計不在這支測試的範圍')
  },
}
```

2. 整個 `describe('統計分析（C 階段前的空狀態）', …)` 換成：

```ts
describe('統計分析與頁面的接縫（C3）', () => {
  it('統計分頁拿到頁首的校區、學年學期與看得到的校區（決定有沒有五校比較）', async () => {
    mockGet(noArrivals)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&sy=114&sem=2&tab=stats' })
    expect(wrapper.findComponent(StatsTab).props()).toEqual({
      campusKey: 'renwu', schoolYear: 114, semester: 2, campusKeys: ['yihua', 'minghua', 'chongde', 'international', 'renwu'],
    })
  })

  it('警示或行動入口要看某月明細：切到訪視明細並帶 month；用 push，上一頁回到統計', async () => {
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats' })
    const push = vi.spyOn(router, 'push')
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { month: '115.09' })
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ query: { campus: 'yihua', tab: 'records', month: '115.09' } })
  })
})
```

3. 檔頭 import：`button` 若在檔內已沒有別的用處（`grep -n "button(" admin/src/__tests__/admissionsView.test.ts` 沒有輸出），從 `./admissionsTestKit` 的 import 拿掉（`noUnusedLocals`，typecheck 會擋）。

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsView.test.ts`
Expected: FAIL，兩項新測試失敗——`props()` 沒有 `campusKeys`；`push` 沒被呼叫（頁面還在聽 `@go`）。

再改 `admin/src/views/AdmissionsView.vue`（B2 若已經 `import { useRoute, useRouter }` 或宣告了 `route`／`router`，沿用，不要重複宣告）：

1. import 區加 `import { useRoute, useRouter } from 'vue-router'`。
2. `const { can } = usePermissions()` 之後加：

```ts
const route = useRoute()
const router = useRouter()

// 統計的警示與行動入口「查看本月明細」：切到訪視明細並帶月份（B2 的明細讀網址的 month）。
// 用 push 不用 replace：看完明細按上一頁回到統計。
function openRecords(filter: { month: string }) {
  void router.push({ query: { ...route.query, tab: 'records', month: filter.month } })
}
```

3. 模板裡 `<StatsTab …>` 那一行換成：

```vue
        <StatsTab
          v-if="tab === 'stats'"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          :campus-keys="visibleCampusKeys"
          @open-records="openRecords"
        />
```

4. `grep -n "goTab" admin/src/views/AdmissionsView.vue`：只剩函式定義（B2–B5 沒有別的元件 `@go="goTab"`）就把 `function goTab…` 整段刪掉；還有人用就保留。

Run:

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/admissionsView.test.ts src/__tests__/statsTab.test.ts src/__tests__/statsFormat.test.ts src/__tests__/a11yStructure.test.ts
npm run typecheck
```

Expected: 全部 PASS；typecheck 沒有錯誤。`admissionsView.test.ts` 其他既有測試照常通過（統計 API 回錯誤只影響 StatsTab 自己的畫面）。

- [ ] **Step 12：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/admissions/statsFormat.ts admin/src/components/admissions/StatsDimensionTable.vue \
  admin/src/components/admissions/StatsOverview.vue admin/src/components/admissions/StatsTab.vue \
  admin/src/api/admissions.ts admin/src/api/types.ts admin/src/views/AdmissionsView.vue \
  admin/src/__tests__/statsFormat.test.ts admin/src/__tests__/statsTab.test.ts admin/src/__tests__/admissionsView.test.ts
git commit -m "feat(admin): 招生統計分頁（總覽、班別、來源、接待、未預繳原因）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C3b：未預繳明細 `NoDepositList.vue`（統計「未預繳原因」子分頁的名單）

2026-10-01 使用者裁定統計頁要列名單：照園務 `RecruitmentNoDepositTab.vue` 的「未預繳明細」表做，資料來自 C2b 的 `GET /admin/admissions/no-deposit-records`。三張數字卡、優先度與原因分布仍是 C3 用 `/stats` 畫的，名單不重複顯示 `summary`（本檔調整表最後一列）。

**Files:**
- Create: `admin/src/components/admissions/NoDepositList.vue`
- Modify: `admin/src/api/admissions.ts`（加 `getNoDepositRecords`）、`admin/src/api/types.ts`（加 `NoDepositRecords`、`NoDepositRecord`）
- Modify: `admin/src/components/admissions/StatsTab.vue`（「未預繳原因」掛名單、拿掉「名單請到訪視明細篩選」，Step 7 逐處列出）
- Test: `admin/src/__tests__/noDepositList.test.ts`（新檔）；`admin/src/__tests__/statsTab.test.ts`（檔尾追加三項）

**Interfaces:**
- Consumes：C2b 的 `GET /admin/admissions/no-deposit-records`（`NoDepositRecordsOut`）；C3 的 `StatsTab.vue`、`statsFormat.ts`（`NO_VALUE`、`priorityLabel`）、`statsTab.test.ts` 的 `stats()`、`emptyStats()`、`props()`、`openSubTab()`；B1 的 `admissions/constants.ts`（`GRADES`、`NO_DEPOSIT_REASONS`）、`composables/useRequestSequence.ts`、`admissionsTestKit.ts`（`mountWith`、`cleanup`、`mockGet`、`deferred`、`pathsTo`、`queryOf`、`button`、`reception`）。
- Produces：
  - `admin/src/api/admissions.ts`：`export function getNoDepositRecords(params: { campus_key: string; school_year: number | null; semester: number | null; reason: string | null; grade: string | null; priority: 'high' | 'medium' | 'low' | null; overdue_days: number | null; cold_only: boolean | null; page: number; page_size: number }): Promise<NoDepositRecords>`
  - `admin/src/api/types.ts`：`NoDepositRecords = components['schemas']['NoDepositRecordsOut']`、`NoDepositRecord = components['schemas']['NoDepositRecordOut']`
  - `NoDepositList.vue`：`props { campusKey: string; schoolYear: number | null; semester: number | null; preset?: Record<string, string | number> | null }`；`emits { 'open-records': [filter: { month: string }] }`
  - `StatsTab.vue`：「未預繳原因」子分頁改成 `lazy`，有未預繳（`no_deposit_total > 0`）才掛 `<NoDepositList>`；指向 `nodeposit` 的警示與行動入口把 `target_filter` 當 `preset` 傳下去；名單的 `open-records` 原樣往上轉。

畫面規則（園務 `RecruitmentNoDepositTab`＋`RecruitmentStatsPanel` 的 `ndFilter`）：

| 項目 | 規則 |
|---|---|
| 篩選 | 「轉換潛力」預設「高潛力優先」（選項順序：高潛力優先、全部潛力、中潛力、低潛力；「全部潛力」不帶 `priority`）；「篩選原因」（`NO_DEPOSIT_REASONS` 八項，可清除）；「班別」（`GRADES`，可清除）；開關「逾 14 天」／「不限」（開＝`overdue_days=14`）；開關「冷名單」／「不限」（開＝`cold_only=true`，關就不帶）；任何篩選改了回第 1 頁 |
| 筆數 | `顯示 {本頁筆數} / {總數} 筆未預繳` |
| 表頭 | 月份｜姓名｜班別｜原因分類｜轉換潛力｜冷名單｜說明｜來源｜介紹者｜電訪回應｜明細（最後一欄官網加的「查看」） |
| 格子 | 轉換潛力 tag：高 `danger`、中 `warning`、低 `info`，沒有寫「—」；冷名單 tag「冷」（`info`）；原因沒填寫「未分類」；其他沒填寫「—」 |
| 空狀態 | 有潛力篩選：`目前「{潛力標籤}」篩選下沒有名單，上方表格統計的是全部原因分布`＋按鈕「改看全部潛力」；沒有：`目前篩選條件下沒有未預繳名單`（園務原文寫「上方圖表」，官網是表格） |
| 分頁 | 每頁 50（園務 `ndFilter.page_size`），`total > 50` 才顯示 |
| 查看 | `emit('open-records', { month: 該列月份 })`，由 StatsTab 轉給頁面切到訪視明細並帶 `month`（本檔調整表） |
| 讀取 | `useRequestSequence` 只採用最後一次；換校區或學年學期清空再讀；讀取失敗顯示「無法讀取未預繳名單，請重新載入。」＋「重新載入」 |

- [ ] **Step 1：名單元件的失敗測試**

`admin/src/__tests__/noDepositList.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import { ElPagination, ElSelect, ElSwitch } from 'element-plus'
import NoDepositList from '../components/admissions/NoDepositList.vue'
import type { NoDepositRecord, NoDepositRecords } from '../api/types'
import { GRADES, NO_DEPOSIT_REASONS } from '../admissions/constants'
import { button, cleanup, deferred, mockGet, mountWith, pathsTo, queryOf, reception } from './admissionsTestKit'

afterEach(cleanup)

const PATH = '/admin/admissions/no-deposit-records'

// 欄位與 C2b test_no_deposit_records_population_order_and_fields 的 N1（林小安）、N4（王小樹）、N5（周小宇）相同。
const record = (changes: Partial<NoDepositRecord> = {}): NoDepositRecord => ({
  id: '11111111-0000-4000-8000-000000000001', month: '115.09', seq_no: '2', child_name: '林小安', grade: '小班',
  no_deposit_reason: '時程未到／仍在觀望', no_deposit_reason_detail: '想等明年再決定', source: 'Facebook', referrer: '林老師',
  parent_response: '下週再電訪', created_at: '2026-09-11T04:00:00Z', priority: 'high', cold: false, ...changes,
})
const LIN = record()
const WANG = record({
  id: '11111111-0000-4000-8000-000000000004', month: '115.08', seq_no: '5', child_name: '王小樹', grade: null,
  no_deposit_reason: null, no_deposit_reason_detail: null, source: null, referrer: null, parent_response: null,
  created_at: '2026-09-28T04:00:00Z', priority: null, cold: false,
})
const ZHOU = record({
  id: '11111111-0000-4000-8000-000000000005', month: '115.07', seq_no: '3', child_name: '周小宇',
  no_deposit_reason: '已有其他就學選項／比較他校', no_deposit_reason_detail: null, source: null, referrer: null,
  parent_response: null, created_at: '2026-07-03T04:00:00Z', priority: 'low', cold: true,
})

function result(records: NoDepositRecord[], total = records.length): NoDepositRecords {
  return {
    total, page: 1, page_size: 50,
    summary: { high_potential_count: 1, overdue_followup_count: 2, cold_count: 1 },
    records,
  }
}

const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, ...changes })
const lastQuery = (get: Parameters<typeof pathsTo>[0]) => queryOf(pathsTo(get, PATH).at(-1)!)
const cells = (row: DOMWrapper<Element>) => row.findAll('th, td').map((cell) => cell.text())

describe('未預繳明細：表格（園務 RecruitmentNoDepositTab 的「未預繳明細」）', () => {
  it('表頭照園務順序，潛力與冷名單用 tag；沒填寫「—」、原因沒填寫「未分類」', async () => {
    mockGet({ [PATH]: result([LIN, WANG, ZHOU]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    expect(wrapper.get('.stats-block__title').text()).toBe('未預繳明細')
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual([
      '月份', '姓名', '班別', '原因分類', '轉換潛力', '冷名單', '說明', '來源', '介紹者', '電訪回應', '明細',
    ])
    const rows = wrapper.findAll('tbody tr')
    expect(cells(rows[0]!)).toEqual([
      '115.09', '林小安', '小班', '時程未到／仍在觀望', '高', '', '想等明年再決定', 'Facebook', '林老師', '下週再電訪', '查看',
    ])
    expect(cells(rows[1]!)).toEqual(['115.08', '王小樹', '—', '未分類', '—', '', '—', '—', '—', '—', '查看'])
    expect(cells(rows[2]!).slice(4, 6)).toEqual(['低', '冷'])
    expect(rows[0]!.get('.el-tag').classes()).toContain('el-tag--danger')
    expect(rows[2]!.findAll('.el-tag').map((tag) => tag.classes().includes('el-tag--info'))).toEqual([true, true])
    expect(wrapper.get('.nd-count').text()).toBe('顯示 3 / 3 筆未預繳')
    expect(wrapper.find('.el-pagination').exists()).toBe(false)
  })

  it('「查看」切到訪視明細並帶這筆的月份（B 的明細只吃 month，帶不到單筆）', async () => {
    mockGet({ [PATH]: result([LIN, ZHOU]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    const view = button(wrapper.findAll('tbody tr')[1]!, '查看')!
    expect(view.attributes('aria-label')).toBe('查看 115.07 的訪視明細（周小宇）')
    await view.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ month: '115.07' }]])
  })
})

describe('未預繳明細：篩選（園務 ndFilter）', () => {
  it('預設「高潛力優先」；原因、班別、換頁都帶進 query，改篩選回第 1 頁', async () => {
    const get = mockGet({ [PATH]: result([LIN], 120) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    expect(pathsTo(get, PATH)[0]).toBe(`${PATH}?campus_key=yihua&school_year=115&semester=1&priority=high&page=1&page_size=50`)
    const items = wrapper.findAll('.el-select-dropdown__item').map((item) => item.text())
    expect(items.slice(0, 4)).toEqual(['高潛力優先', '全部潛力', '中潛力', '低潛力'])
    expect(items.slice(4, 12)).toEqual([...NO_DEPOSIT_REASONS])
    expect(items.slice(12)).toEqual([...GRADES])

    // total 120 > 每頁 50 才有分頁；換頁帶 page。
    wrapper.findComponent(ElPagination).vm.$emit('current-change', 3)
    await flushPromises()
    expect(lastQuery(get).get('page')).toBe('3')

    const [, reasonSelect, gradeSelect] = wrapper.findAllComponents(ElSelect)
    reasonSelect!.vm.$emit('update:modelValue', '費用考量')
    await flushPromises()
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', reason: '費用考量', priority: 'high', page: '1', page_size: '50',
    })
    gradeSelect!.vm.$emit('update:modelValue', '小班')
    await flushPromises()
    expect(lastQuery(get).get('grade')).toBe('小班')
    // 清除（clearable 送 undefined）就不帶。
    reasonSelect!.vm.$emit('update:modelValue', undefined)
    await flushPromises()
    expect(lastQuery(get).has('reason')).toBe(false)
  })

  it('「全部潛力」不帶 priority；「逾 14 天」帶 overdue_days=14、「冷名單」帶 cold_only=true，關掉就不帶', async () => {
    const get = mockGet({ [PATH]: result([LIN]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })
    const [prioritySelect] = wrapper.findAllComponents(ElSelect)
    const [overdueSwitch, coldSwitch] = wrapper.findAllComponents(ElSwitch)

    expect([overdueSwitch!.props('activeText'), overdueSwitch!.props('inactiveText')]).toEqual(['逾 14 天', '不限'])
    expect([coldSwitch!.props('activeText'), coldSwitch!.props('inactiveText')]).toEqual(['冷名單', '不限'])

    prioritySelect!.vm.$emit('update:modelValue', 'all')
    await flushPromises()
    expect(lastQuery(get).has('priority')).toBe(false)

    overdueSwitch!.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(lastQuery(get).get('overdue_days')).toBe('14')
    coldSwitch!.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(lastQuery(get).get('cold_only')).toBe('true')
    expect(wrapper.findAllComponents(ElSwitch).map((item) => item.props('modelValue'))).toEqual([true, true])

    overdueSwitch!.vm.$emit('update:modelValue', false)
    coldSwitch!.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(lastQuery(get).has('overdue_days')).toBe(false)
    expect(lastQuery(get).has('cold_only')).toBe(false)
  })

  it('警示或行動入口帶的篩選（preset）：套上 priority 與 overdue_days，其餘回預設、回第 1 頁', async () => {
    const get = mockGet({ [PATH]: result([LIN], 120) })
    const { wrapper } = await mountWith(NoDepositList, { props: props({ preset: { priority: 'high', overdue_days: 14 } }) })

    expect(pathsTo(get, PATH)).toHaveLength(1)
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', priority: 'high', overdue_days: '14', page: '1', page_size: '50',
    })
    expect(wrapper.findAllComponents(ElSwitch)[0]!.props('modelValue')).toBe(true)

    wrapper.findAllComponents(ElSwitch)[1]!.vm.$emit('update:modelValue', true)
    wrapper.findComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.setProps({ preset: { priority: 'low' } })
    await flushPromises()
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', priority: 'low', page: '1', page_size: '50',
    })
  })
})

describe('未預繳明細：空狀態、權限與讀取', () => {
  it('有潛力篩選時寫明上方表格是全部原因，按「改看全部潛力」；沒有潛力篩選時是一般空狀態', async () => {
    const get = mockGet({ [PATH]: result([]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    expect(wrapper.get('.nd-empty').text()).toContain('目前「高潛力優先」篩選下沒有名單，上方表格統計的是全部原因分布')
    expect(wrapper.find('table').exists()).toBe(false)
    await button(wrapper, '改看全部潛力')!.trigger('click')
    await flushPromises()
    expect(lastQuery(get).has('priority')).toBe(false)
    expect(wrapper.get('.nd-empty').text()).toBe('目前篩選條件下沒有未預繳名單')
    expect(button(wrapper, '改看全部潛力')).toBeUndefined()
  })

  it('權限：接待人員（admissions.read）看得到名單與「查看」；API 拒絕時只顯示錯誤、不留上一校的名單，重新載入可恢復', async () => {
    let denied = true
    mockGet({
      [PATH]: (path: string) => {
        if (queryOf(path).get('campus_key') === 'minghua' && denied) throw new Error('403')
        return result([LIN])
      },
    })
    const { wrapper } = await mountWith(NoDepositList, { props: props(), user: reception() })

    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(button(wrapper, '查看')).toBeDefined()

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(wrapper.get('.el-alert').text()).toContain('無法讀取未預繳名單，請重新載入。')
    expect(wrapper.find('tbody tr').exists()).toBe(false)

    denied = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('快速切換校區只顯示最後一次（義華晚回也不會蓋掉明華）', async () => {
    const yihua = deferred<NoDepositRecords>()
    const minghua = deferred<NoDepositRecords>()
    mockGet({ [PATH]: (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? yihua.promise : minghua.promise) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    minghua.resolve(result([record({ child_name: '楊小禾' })]))
    await flushPromises()
    yihua.resolve(result([LIN, ZHOU]))
    await flushPromises()

    expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td')[1]!.text())).toEqual(['楊小禾'])
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/noDepositList.test.ts`
Expected: FAIL——`Failed to resolve import "../components/admissions/NoDepositList.vue"`（`NoDepositRecord` 型別也還沒有）。

- [ ] **Step 3：API 呼叫與型別別名**

`admin/src/api/types.ts` 檔尾（C3 加的 `AdmissionsStats` 之後）加：

```ts
// 未預繳明細（C3b）。NoDepositRecordsOut 在 C2b 才進 OpenAPI。
export type NoDepositRecords = components['schemas']['NoDepositRecordsOut']
export type NoDepositRecord = components['schemas']['NoDepositRecordOut']
```

`admin/src/api/admissions.ts`：

1. 檔頭註解裡 C3 改好的「統計：getStats（C3）、getCompare（C4）。」改成「統計：getStats（C3）、getNoDepositRecords（C3b）、getCompare（C4）。」
2. `import type { … } from './types'` 那一段的型別清單加上 `NoDepositRecords`（照字母序）。
3. 檔尾加：

```ts
/** 未預繳明細（園務 /no-deposit-analysis）。priority 為 null＝全部潛力；overdue_days、cold_only 為 null＝不限。 */
export function getNoDepositRecords(params: {
  campus_key: string
  school_year: number | null
  semester: number | null
  reason: string | null
  grade: string | null
  priority: 'high' | 'medium' | 'low' | null
  overdue_days: number | null
  cold_only: boolean | null
  page: number
  page_size: number
}): Promise<NoDepositRecords> {
  return api.get<NoDepositRecords>(`/admin/admissions/no-deposit-records?${toQuery(params)}`)
}
```

- [ ] **Step 4：`admin/src/components/admissions/NoDepositList.vue`**

```vue
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { getNoDepositRecords } from '../../api/admissions'
import type { NoDepositRecord } from '../../api/types'
import { GRADES, NO_DEPOSIT_REASONS } from '../../admissions/constants'
import { NO_VALUE, priorityLabel } from '../../admissions/statsFormat'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 未預繳明細（園務 RecruitmentNoDepositTab 的「未預繳明細」；2026-10-01 使用者裁定統計頁要列名單）。
// 資料來自 GET /admin/admissions/no-deposit-records（C2b），母體同統計：未預繳且未退出。
// 篩選、表頭、tag、空狀態照園務原文；園務的三張數字卡在 StatsTab（用 /stats 的數字），這裡不重複。
// 「查看」帶這筆的月份切到訪視明細：B 的明細只吃 month、vr 兩個網址參數，帶不到單筆（C 計畫調整表）。
type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type Preset = Record<string, string | number>

const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: number | null
  /** 警示或行動入口指到「未預繳原因」時的 target_filter（priority、overdue_days），同園務 applyNoDepositFilter。 */
  preset?: Preset | null
}>()
const emit = defineEmits<{ 'open-records': [filter: { month: string }] }>()

// 園務 RecruitmentStatsPanel 的 ndFilter.page_size。
const PAGE_SIZE = 50
// 畫面上只有「逾 14 天」一個開關（園務 onOverdueDaysChange）。
const OVERDUE_DAYS = 14
// 「全部潛力」在園務是空字串；官網用 'all'，el-select 才不會把它當成沒選而顯示 placeholder。
const PRIORITY_OPTIONS: readonly { label: string; value: PriorityFilter }[] = [
  { label: '高潛力優先', value: 'high' },
  { label: '全部潛力', value: 'all' },
  { label: '中潛力', value: 'medium' },
  { label: '低潛力', value: 'low' },
]
const PRIORITY_TAG_TYPES: Record<'high' | 'medium' | 'low', 'danger' | 'warning' | 'info'> = { high: 'danger', medium: 'warning', low: 'info' }

const headingId = useId()
const priority = ref<PriorityFilter>('high')
const reason = ref('')
const grade = ref('')
const overdueDays = ref<number | null>(null)
const coldOnly = ref(false)
const page = ref(1)

const records = ref<NoDepositRecord[]>([])
const total = ref(0)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()

function isPriorityFilter(value: unknown): value is PriorityFilter {
  return PRIORITY_OPTIONS.some((option) => option.value === value)
}

// 園務 applyNoDepositFilter：其餘篩選回預設，再套 target_filter，回第 1 頁。
function applyPreset(preset: Preset | null | undefined) {
  const wanted = preset?.priority
  priority.value = isPriorityFilter(wanted) ? wanted : 'high'
  const days = Number(preset?.overdue_days)
  overdueDays.value = Number.isInteger(days) && days > 0 ? days : null
  reason.value = ''
  grade.value = ''
  coldOnly.value = false
  page.value = 1
}

async function load(options: { reset?: boolean } = {}) {
  const request = requests.begin()
  if (options.reset) {
    records.value = []
    total.value = 0
  }
  failed.value = false
  if (!props.campusKey) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await getNoDepositRecords({
      campus_key: props.campusKey,
      school_year: props.schoolYear,
      semester: props.semester,
      reason: reason.value || null,
      grade: grade.value || null,
      priority: priority.value === 'all' ? null : priority.value,
      overdue_days: overdueDays.value,
      cold_only: coldOnly.value || null,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    if (!requests.isCurrent(request)) return
    // 形狀不對（例如統計分頁的測試沒 mock 這條路徑）當作空名單，不讓整個統計分頁壞掉。
    records.value = Array.isArray(result?.records) ? result.records : []
    total.value = typeof result?.total === 'number' ? result.total : records.value.length
  } catch {
    if (!requests.isCurrent(request)) return
    records.value = []
    total.value = 0
    failed.value = true
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

applyPreset(props.preset)

// 換校區或學年學期：回第 1 頁，清空再讀（不留別校的名單）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    page.value = 1
    void load({ reset: true })
  },
  { immediate: true },
)

// StatsTab 每次都給新物件，同一個入口點第二次也會重新套用。
watch(
  () => props.preset,
  (preset) => {
    applyPreset(preset)
    void load()
  },
)

// 任何篩選改了都回第 1 頁再讀（園務 onNoDepositFilterChange）。
function refilter() {
  page.value = 1
  void load()
}
function setPriority(value: unknown) {
  priority.value = isPriorityFilter(value) ? value : 'all'
  refilter()
}
function setReason(value: unknown) {
  reason.value = typeof value === 'string' ? value : ''
  refilter()
}
function setGrade(value: unknown) {
  grade.value = typeof value === 'string' ? value : ''
  refilter()
}
function setOverdue(value: string | number | boolean) {
  overdueDays.value = value ? OVERDUE_DAYS : null
  refilter()
}
function setColdOnly(value: string | number | boolean) {
  coldOnly.value = Boolean(value)
  refilter()
}
function setPage(value: number) {
  page.value = value
  void load()
}
function showAllPriority() {
  priority.value = 'all'
  refilter()
}

const priorityFilterLabel = computed(() => PRIORITY_OPTIONS.find((option) => option.value === priority.value)?.label ?? '潛力')
// 園務原文；園務上方是圖表，官網是表格（「未預繳原因分佈」）。
const emptyText = computed(() =>
  priority.value === 'all'
    ? '目前篩選條件下沒有未預繳名單'
    : `目前「${priorityFilterLabel.value}」篩選下沒有名單，上方表格統計的是全部原因分布`,
)

const orDash = (value: string | null | undefined) => value || NO_VALUE

function openRecords(row: NoDepositRecord) {
  emit('open-records', { month: row.month })
}
</script>

<template>
  <section class="stats-block nd" :aria-labelledby="headingId">
    <div class="nd-head">
      <h3 :id="headingId" class="stats-block__title">未預繳明細</h3>
      <div class="nd-filters">
        <!-- 三個選單都不 teleport：選項留在元件裡，單元測試才找得到。 -->
        <el-select
          :model-value="priority"
          aria-label="轉換潛力"
          size="small"
          class="nd-priority"
          :teleported="false"
          @update:model-value="setPriority"
        >
          <el-option v-for="option in PRIORITY_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-select
          :model-value="reason || undefined"
          placeholder="篩選原因"
          aria-label="篩選原因"
          clearable
          size="small"
          class="nd-reason"
          :teleported="false"
          @update:model-value="setReason"
        >
          <el-option v-for="item in NO_DEPOSIT_REASONS" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select
          :model-value="grade || undefined"
          placeholder="班別"
          aria-label="班別"
          clearable
          size="small"
          class="nd-grade"
          :teleported="false"
          @update:model-value="setGrade"
        >
          <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
        </el-select>
        <el-switch
          :model-value="overdueDays !== null"
          inline-prompt
          active-text="逾 14 天"
          inactive-text="不限"
          aria-label="只看逾 14 天待追"
          @update:model-value="setOverdue"
        />
        <el-switch
          :model-value="coldOnly"
          inline-prompt
          active-text="冷名單"
          inactive-text="不限"
          aria-label="只看冷名單"
          @update:model-value="setColdOnly"
        />
        <span class="nd-count">顯示 {{ records.length }} / {{ total }} 筆未預繳</span>
      </div>
    </div>
    <p class="hint nd-caption">「查看」會切到訪視明細，並篩這筆的月份。</p>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取未預繳名單，請重新載入。">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <div v-else-if="!records.length" v-loading="loading" class="nd-empty">
      <template v-if="!loading">
        <p>{{ emptyText }}</p>
        <el-button v-if="priority !== 'all'" size="small" @click="showAllPriority">改看全部潛力</el-button>
      </template>
    </div>
    <div v-else v-loading="loading" class="nd-scroll" role="region" tabindex="0" aria-label="未預繳明細（可左右捲動）">
      <table class="nd-table">
        <thead>
          <tr>
            <th scope="col">月份</th>
            <th scope="col">姓名</th>
            <th scope="col">班別</th>
            <th scope="col">原因分類</th>
            <th scope="col">轉換潛力</th>
            <th scope="col">冷名單</th>
            <th scope="col">說明</th>
            <th scope="col">來源</th>
            <th scope="col">介紹者</th>
            <th scope="col">電訪回應</th>
            <th scope="col">明細</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in records" :key="row.id">
            <td class="num">{{ row.month }}</td>
            <td>{{ row.child_name }}</td>
            <td>{{ orDash(row.grade) }}</td>
            <td>{{ row.no_deposit_reason ?? '未分類' }}</td>
            <td>
              <el-tag v-if="row.priority" :type="PRIORITY_TAG_TYPES[row.priority]" size="small">{{ priorityLabel(row.priority) }}</el-tag>
              <span v-else>{{ NO_VALUE }}</span>
            </td>
            <td><el-tag v-if="row.cold" type="info" size="small">冷</el-tag></td>
            <td class="nd-long">{{ orDash(row.no_deposit_reason_detail) }}</td>
            <td>{{ orDash(row.source) }}</td>
            <td>{{ orDash(row.referrer) }}</td>
            <td class="nd-long">{{ orDash(row.parent_response) }}</td>
            <td>
              <el-button
                link
                type="primary"
                size="small"
                :aria-label="`查看 ${row.month} 的訪視明細（${row.child_name}）`"
                @click="openRecords(row)"
              >
                查看
              </el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <el-pagination
      v-if="total > PAGE_SIZE"
      class="nd-pagination"
      :current-page="page"
      :page-size="PAGE_SIZE"
      :total="total"
      layout="prev, pager, next"
      @current-change="setPage"
    />
  </section>
</template>

<style scoped>
.nd {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.nd-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.stats-block__title {
  margin: 0;
  font-size: 15px;
}

.nd-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.nd-priority {
  width: 140px;
}

.nd-reason {
  width: 200px;
}

.nd-grade {
  width: 100px;
}

.nd-count {
  color: var(--ink-2);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.nd-caption {
  margin: 0;
}

.nd-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-height: 72px;
  padding: 20px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-2);
  text-align: center;
}

.nd-empty p {
  margin: 0;
}

.nd-scroll {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.nd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.nd-table th,
.nd-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
  vertical-align: top;
}

.nd-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
}

.nd-table tbody tr:last-child > td {
  border-bottom: 0;
}

/* 說明與電訪回應可能很長：換行，不把表格撐到無限寬。 */
.nd-table .nd-long {
  min-width: 160px;
  max-width: 280px;
  white-space: normal;
}

.nd-pagination {
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .nd-priority,
  .nd-reason,
  .nd-grade {
    width: 100%;
  }

  .nd-table th,
  .nd-table td {
    padding: 8px 10px;
  }
}
</style>
```

- [ ] **Step 5：跑名單元件的測試確認通過**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/noDepositList.test.ts`
Expected: PASS（8 tests）。常見落差與處理：
- 找不到 `.el-select-dropdown__item`：三個 `<el-select>` 都要 `:teleported="false"`。
- 空狀態文字多了空白：`.nd-empty` 裡只能有 `<p>` 與按鈕，讀取中的遮罩（`v-loading`）沒有文字，不影響 `text()`。
- 不要改測試的期望值去湊；表頭、tag、空狀態都是園務原文。

- [ ] **Step 6：統計分頁接上名單的失敗測試**

`admin/src/__tests__/statsTab.test.ts`：

1. 檔頭 import 區，`import StatsTab from '../components/admissions/StatsTab.vue'` 下一行加：

```ts
import NoDepositList from '../components/admissions/NoDepositList.vue'
```

2. 檔尾追加：

```ts
// ── C3b：未預繳明細掛進「未預繳原因」 ──
const NO_DEPOSIT_PATH = '/admin/admissions/no-deposit-records'
const noDepositRecords = {
  total: 1, page: 1, page_size: 50,
  summary: { high_potential_count: 2, overdue_followup_count: 3, cold_count: 0 },
  records: [{
    id: '11111111-0000-4000-8000-000000000001', month: '115.09', seq_no: '3', child_name: '林小安', grade: '小班',
    no_deposit_reason: '時程未到／仍在觀望', no_deposit_reason_detail: null, source: 'Facebook', referrer: '林老師',
    parent_response: null, created_at: '2026-09-03T02:00:00Z', priority: 'high', cold: false,
  }],
}

describe('統計分頁：未預繳明細（C3b）', () => {
  it('打開「未預繳原因」才掛 NoDepositList，帶頁首校區與學期；不再叫人到訪視明細篩；名單的「查看」交給頁面', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    expect(pathsTo(get, NO_DEPOSIT_PATH)).toHaveLength(0)

    const pane = await openSubTab(wrapper, '未預繳原因')
    expect(wrapper.findComponent(NoDepositList).props()).toEqual({ campusKey: 'yihua', schoolYear: 115, semester: 1, preset: null })
    expect(pathsTo(get, NO_DEPOSIT_PATH)).toHaveLength(1)
    expect(pane.text()).toContain('林小安')
    expect(pane.text()).not.toContain('名單請到「訪視明細」')

    await button(pane, '查看')!.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ month: '115.09' }]])
  })

  it('行動入口「查看高風險未預繳」把 target_filter 帶進名單（同園務 applyNoDepositFilter）', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    await wrapper.findAll('.action-item')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(NoDepositList).props('preset')).toEqual({ priority: 'high', overdue_days: 14 })
    const query = queryOf(pathsTo(get, NO_DEPOSIT_PATH).at(-1)!)
    expect([query.get('priority'), query.get('overdue_days')]).toEqual(['high', '14'])
  })

  it('沒有未預繳的訪視：不掛名單、不讀名單', async () => {
    const get = mockGet({ '/admin/admissions/stats': emptyStats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const pane = await openSubTab(wrapper, '未預繳原因')
    expect(pane.text()).toContain('此區間尚無未預繳資料')
    expect(wrapper.findComponent(NoDepositList).exists()).toBe(false)
    expect(pathsTo(get, NO_DEPOSIT_PATH)).toHaveLength(0)
  })
})
```

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/statsTab.test.ts`
Expected: FAIL，只有新加的三項失敗——`findComponent(NoDepositList)` 找不到（C3 的子分頁還沒掛名單），第一項的 `not.toContain('名單請到「訪視明細」')` 也不成立；C3 原本的 12 項照常通過。

- [ ] **Step 7：`StatsTab.vue` 掛上名單（逐處）**

1. import 區，`import StatsDimensionTable from './StatsDimensionTable.vue'` 的上一行加：

```ts
import NoDepositList from './NoDepositList.vue'
```

2. `const referenceMonth = ref<string | null>(null)` 下一行加（要宣告在下面那個 `immediate` 的 `watch` 之前，否則掛載時就讀到未初始化的變數）：

```ts
// 警示或行動入口指到「未預繳原因」時帶的 target_filter（priority、overdue_days），交給名單套用
// （同園務 applyNoDepositFilter）。每次都給新物件，同一個入口點第二次也會重新套用。
const noDepositPreset = ref<Record<string, string | number> | null>(null)
```

3. 換校區或學年學期的 `watch`，原文：

```ts
// 換校區或學年學期：參考月份回到「最新」，畫面清空再讀（不留舊校區的數字）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    referenceMonth.value = null
    void load({ reset: true })
  },
  { immediate: true },
)
```

改成：

```ts
// 換校區或學年學期：參考月份回到「最新」、名單的 preset 清掉，畫面清空再讀（不留舊校區的數字）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    referenceMonth.value = null
    noDepositPreset.value = null
    void load({ reset: true })
  },
  { immediate: true },
)
```

4. `function navigate`，原文：

```ts
  setSubTab(`stats-${target.tab}`)
}
```

改成（`setSubTab(...)` 與下一行的 `}` 保持不動，C4 Step 5 以它定位）：

```ts
  if (target.tab === 'nodeposit') noDepositPreset.value = { ...target.filter }
  setSubTab(`stats-${target.tab}`)
}
```

5. 模板，原文：

```vue
        <el-tab-pane label="未預繳原因" name="stats-nodeposit">
```

改成（`lazy`：沒打開這個子分頁就不讀名單）：

```vue
        <el-tab-pane label="未預繳原因" name="stats-nodeposit" lazy>
```

6. 模板，原文：

```vue
            <p class="hint">
              名單請到「訪視明細」用「預繳：否」與「未預繳原因」篩選。已退預繳、退註冊的不算未預繳；冷名單＝建檔滿 90 天仍未預繳。
            </p>
```

改成：

```vue
            <p class="hint">已退預繳、退註冊的不算未預繳；冷名單＝建檔滿 90 天仍未預繳。</p>
            <NoDepositList
              v-if="stats.no_deposit_total"
              :campus-key="campusKey"
              :school-year="schoolYear"
              :semester="semester"
              :preset="noDepositPreset"
              @open-records="emit('open-records', $event)"
            />
```

7. 檔頭註解「警示與行動入口指到統計內的子分頁就直接切；指到訪視明細就交給頁面（open-records）。」下一行加：

```ts
// 「未預繳原因」另有未預繳明細（NoDepositList，C3b）：警示帶的篩選以 preset 傳下去，名單的「查看」同樣交給頁面。
```

- [ ] **Step 8：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/noDepositList.test.ts src/__tests__/statsTab.test.ts src/__tests__/statsFormat.test.ts src/__tests__/admissionsView.test.ts
npm run typecheck
```

Expected: 全部 PASS（noDepositList 8 項、statsTab 15 項、statsFormat 7 項、admissionsView 全部）；typecheck 沒有錯誤。C3 原本「未預繳原因」「警示與行動入口」兩項打開子分頁時名單會讀 `/admin/admissions/no-deposit-records`，那兩項的 mock 沒有這條路徑，`mockGet` 回空陣列，名單當作空的，不影響原本的斷言。

- [ ] **Step 9：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/components/admissions/NoDepositList.vue admin/src/components/admissions/StatsTab.vue \
  admin/src/api/admissions.ts admin/src/api/types.ts \
  admin/src/__tests__/noDepositList.test.ts admin/src/__tests__/statsTab.test.ts
git commit -m "feat(admin): 統計「未預繳原因」列未預繳明細（照園務篩選與表頭）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C4：五校比較子分頁 `CompareTable.vue`

**Files:**
- Create: `admin/src/components/admissions/CompareTable.vue`
- Modify: `admin/src/components/admissions/StatsTab.vue`（加「五校比較」子分頁，Step 5 逐處列出）、`admin/src/api/admissions.ts`（加 `getCompare`）、`admin/src/api/types.ts`（加 `AdmissionsCompareRow`、`AdmissionsRate`）
- Test: `admin/src/__tests__/compareTable.test.ts`（新檔）

**Interfaces:**
- Consumes：C2 的 `GET /admin/admissions/compare?school_year=&semester=`（`list[AdmissionsCompareRow]`，依 `CAMPUS_KEYS` 順序、只含授權校區）；C3 的 `StatsDimensionTable.vue`、`statsFormat.ts`（`formatRate`、`StatsColumn`）與 `StatsTab.vue`；B1 的 `currentTerm`、`termLabel`（`admissions/academic.ts`）、`campusLabel`（`api/labels.ts`）、`admissionsTestKit.ts`。
- Produces：
  - `admin/src/api/admissions.ts`：`export function getCompare(schoolYear: number, semester: number): Promise<AdmissionsCompareRow[]>`
  - `admin/src/api/types.ts`：`AdmissionsCompareRow = components['schemas']['AdmissionsCompareRow']`、`AdmissionsRate = components['schemas']['AdmissionsRate']`
  - `CompareTable.vue`：`props { rows: readonly AdmissionsCompareRow[]; schoolYear: number; semester: number }`，純顯示。
  - `StatsTab.vue`：子分頁 `stats-compare`「五校比較」，只在 `campusKeys.length > 1` 時出現；切到它才讀；學期規則見下。

學期規則（對總覽調整第 5 條「頁首沒選學期時用目前學期並寫明」的細節）：`school_year = props.schoolYear ?? currentTerm().schoolYear`；`semester = props.semester ?? (school_year === 目前學年 ? 目前學期 : 1)`；頁首有任一個沒選，就在表格上方寫「五校比較要對到單一學期的名額：頁首沒選的部分用 115 上學期。」

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/compareTable.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import CompareTable from '../components/admissions/CompareTable.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import type { AdmissionsCompareRow, AdmissionsStats } from '../api/types'
import { button, cleanup, deferred, mockGet, mountWith, pathsTo } from './admissionsTestKit'

afterEach(cleanup)

const ALL = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const rate = (value: number | null, numerator: number, denominator: number) => ({ value, numerator, denominator })
const NO_RATE = rate(null, 0, 0)

function row(campusKey: string, changes: Partial<AdmissionsCompareRow> = {}): AdmissionsCompareRow {
  return {
    campus_key: campusKey, visit: 0, deposit: 0, enrolled: 0, transfer_term: 0, effective_deposit: 0, pending_deposit: 0,
    visit_to_deposit_rate: NO_RATE, visit_to_enrolled_rate: NO_RATE, deposit_to_enrolled_rate: NO_RATE,
    effective_to_enrolled_rate: NO_RATE, target_seats: null, remaining_seats: null, grades_with_target: 0, ...changes,
  }
}

// 義華、明華、仁武取自 C2 test_compare_rows_and_seats／test_compare_without_targets 的期望值；
// 崇德是超額：計畫 2，已保留 3。
const YIHUA = row('yihua', {
  visit: 4, deposit: 3, enrolled: 1, effective_deposit: 3, pending_deposit: 2,
  visit_to_deposit_rate: rate(75, 3, 4), visit_to_enrolled_rate: rate(25, 1, 4),
  deposit_to_enrolled_rate: rate(33.3, 1, 3), effective_to_enrolled_rate: rate(33.3, 1, 3),
  target_seats: 10, remaining_seats: 8, grades_with_target: 2,
})
const MINGHUA = row('minghua', { visit: 1, visit_to_deposit_rate: rate(0, 0, 1), visit_to_enrolled_rate: rate(0, 0, 1) })
const CHONGDE = row('chongde', {
  visit: 3, deposit: 3, effective_deposit: 3, pending_deposit: 3,
  visit_to_deposit_rate: rate(100, 3, 3), visit_to_enrolled_rate: rate(0, 0, 3),
  deposit_to_enrolled_rate: rate(0, 0, 3), effective_to_enrolled_rate: rate(0, 0, 3),
  target_seats: 2, remaining_seats: -1, grades_with_target: 1,
})
const RENWU = row('renwu')

const cells = (tr: DOMWrapper<Element>) => tr.findAll('th, td').map((cell) => cell.text())
const headers = (root: VueWrapper | DOMWrapper<Element>) => root.findAll('thead th').map((th) => th.text())
const bodyRows = (root: VueWrapper | DOMWrapper<Element>) => root.findAll('tbody tr').map(cells)
const tabTexts = (wrapper: VueWrapper) => wrapper.findAll('.stats-subtabs .el-tabs__item').map((tab) => tab.text())
const statsProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, campusKeys: ALL, ...changes })

// 統計本身不是這支測試的重點：一筆訪視的最小資料，讓子分頁出現。
function quietStats(): AdmissionsStats {
  const snap = {
    visit: 1, deposit: 0, enrolled: 0, transfer_term: 0, pending_deposit: 0, effective_deposit: 0,
    visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null, effective_to_enrolled_rate: null,
  }
  const diff = { current: 1, previous: 0, delta: 1 }
  const rateDiff = { current: null, previous: null, delta: null }
  return {
    as_of: '2026-10-01T04:00:00Z',
    filters: { campus_key: 'yihua', school_year: 115, semester: 1, reference_month: null },
    reference_month: '115.09',
    kpi: { ...snap, unique_visit: 1, unique_deposit: 0 },
    decision_summary: { current_month: snap, rolling_30d: snap, rolling_90d: snap, ytd: snap },
    funnel_snapshot: { visit: 1, deposit: 0, enrolled: 0, transfer_term: 0, effective_deposit: 0, pending_deposit: 0 },
    month_over_month: {
      current_month: '115.09', previous_month: '115.08', visit: diff, deposit: diff, enrolled: diff, effective_deposit: diff,
      pending_deposit: diff, visit_to_deposit_rate: rateDiff, visit_to_enrolled_rate: rateDiff,
      deposit_to_enrolled_rate: rateDiff, effective_to_enrolled_rate: rateDiff,
    },
    alerts: [], top_action_queue: [], monthly: [{ month: '115.09', ...snap }], by_year: [{ year: '115', ...snap }],
    by_grade: [], month_grade: {}, by_source: [], top_source_names: [], by_referrer: [],
    referrer_source_cross: { referrers: [], sources: [] }, no_deposit_reasons: [], no_deposit_total: 0,
    no_deposit_priority: { high: 0, medium: 0, low: 0, other: 0 },
    no_deposit_summary: { high_potential_count: 0, overdue_followup_count: 0, cold_count: 0, high_potential_backlog_count: 0 },
  }
}

async function openCompare(wrapper: VueWrapper): Promise<DOMWrapper<Element>> {
  const tab = wrapper.findAll('.stats-subtabs .el-tabs__item').find((item) => item.text() === '五校比較')!
  await tab.trigger('click')
  await flushPromises()
  return wrapper.get('#pane-stats-compare')
}

describe('五校比較表（規格 9.3）', () => {
  it('每校一列：招生案件數、比率寫分子分母、名額只加總有設定的年級、沒設定寫「未設定」', async () => {
    const { wrapper } = await mountWith(CompareTable, { props: { rows: [YIHUA, MINGHUA, CHONGDE, RENWU], schoolYear: 115, semester: 1 } })

    expect(wrapper.get('.stats-block__title').text()).toBe('五校比較（115 上學期）')
    expect(wrapper.text()).toContain('數字是招生案件數')
    expect(wrapper.text()).toContain('不是跨校去重後的孩子數')
    expect(headers(wrapper)).toEqual([
      '校區', '參觀', '預繳', '註冊', '有效預繳', '預繳未註冊',
      '參觀→預繳率', '參觀→註冊率', '預繳→註冊率', '排除轉期→註冊率', '計畫名額', '名額剩餘',
    ])
    expect(bodyRows(wrapper)).toEqual([
      ['義華', '4', '3', '1', '3', '2', '75.0%（3/4）', '25.0%（1/4）', '33.3%（1/3）', '33.3%（1/3）', '10（2 個年級）', '8'],
      ['明華', '1', '0', '0', '0', '0', '0.0%（0/1）', '0.0%（0/1）', '—（0/0）', '—（0/0）', '未設定', '未設定'],
      ['崇德', '3', '3', '0', '3', '3', '100.0%（3/3）', '0.0%（0/3）', '0.0%（0/3）', '0.0%（0/3）', '2（1 個年級）', '-1（超額）'],
      ['仁武', '0', '0', '0', '0', '0', '—（0/0）', '—（0/0）', '—（0/0）', '—（0/0）', '未設定', '未設定'],
    ])
  })
})

describe('統計分頁的「五校比較」子分頁', () => {
  it('只看得到一個校區：沒有這個子分頁，也不讀 compare', async () => {
    const get = mockGet({ '/admin/admissions/stats': quietStats() })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ campusKeys: ['yihua'] }) })

    expect(tabTexts(wrapper)).toEqual(['總覽', '班別分析', '來源分析', '接待分析', '未預繳原因'])
    expect(pathsTo(get, '/admin/admissions/compare')).toEqual([])
  })

  it('多校：切到五校比較才讀，帶頁首的學年學期，依後端順序每校一列', async () => {
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': [YIHUA, MINGHUA, CHONGDE, RENWU] })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps() })
    expect(tabTexts(wrapper).at(-1)).toBe('五校比較')
    expect(pathsTo(get, '/admin/admissions/compare')).toEqual([])

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare')).toEqual(['/admin/admissions/compare?school_year=115&semester=1'])
    expect(bodyRows(pane).map((tr) => tr[0])).toEqual(['義華', '明華', '崇德', '仁武'])
    expect(pane.find('.compare-note').exists()).toBe(false)
  })

  it('頁首沒選學年學期：用目前學期（台北日期）並寫明；只選了學年、不是今年就用上學期', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': [YIHUA] })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ schoolYear: null, semester: null }) })

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=115&semester=1')
    expect(pane.get('.compare-note').text()).toBe('五校比較要對到單一學期的名額：頁首沒選的部分用 115 上學期。')

    await wrapper.setProps({ schoolYear: 116 })
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=116&semester=1')
  })

  it('下學期期間只選了今年：用下學期', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-02-10T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': [YIHUA] })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ schoolYear: 115, semester: null }) })

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=115&semester=2')
    expect(pane.get('.compare-note').text()).toContain('115 下學期')
  })

  it('在五校比較時換學期：重讀，舊學期的回應晚到也不會蓋掉', async () => {
    const first = deferred<AdmissionsCompareRow[]>()
    const second = deferred<AdmissionsCompareRow[]>()
    mockGet({
      '/admin/admissions/stats': quietStats(),
      '/admin/admissions/compare': (path: string) => (path.endsWith('semester=1') ? first.promise : second.promise),
    })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps() })
    await openCompare(wrapper)

    await wrapper.setProps({ semester: 2 })
    await flushPromises()
    second.resolve([row('yihua', { visit: 7 })])
    await flushPromises()
    first.resolve([YIHUA])
    await flushPromises()

    const pane = wrapper.get('#pane-stats-compare')
    expect(pane.get('.stats-block__title').text()).toBe('五校比較（115 下學期）')
    expect(bodyRows(pane)[0]![1]).toBe('7')
  })

  it('讀取失敗：顯示錯誤，按重新載入再讀一次', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/stats': quietStats(),
      '/admin/admissions/compare': () => {
        if (fail) throw new Error('network')
        return [YIHUA]
      },
    })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps() })
    const pane = await openCompare(wrapper)

    expect(pane.get('.el-alert').text()).toContain('無法讀取五校比較，請重新載入。')
    fail = false
    await button(pane, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/compare')).toHaveLength(2)
    expect(bodyRows(wrapper.get('#pane-stats-compare'))[0]![0]).toBe('義華')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/compareTable.test.ts`
Expected: FAIL，`Failed to resolve import "../components/admissions/CompareTable.vue"`。

- [ ] **Step 3：型別別名與 API 呼叫**

`admin/src/api/types.ts`，C3 加的 `AdmissionsStats` 那一行之後：

```ts
// 五校比較（C4）。AdmissionsRate 是 {value, numerator, denominator}，畫面同時寫分子分母。
export type AdmissionsCompareRow = components['schemas']['AdmissionsCompareRow']
export type AdmissionsRate = components['schemas']['AdmissionsRate']
```

`admin/src/api/admissions.ts`：`import type { … } from './types'` 的清單加 `AdmissionsCompareRow`（字母序放在 `AdmissionsOptions` 之前），檔尾加：

```ts
/** 五校比較（規格 9.3）：後端只回授權範圍內的校區；學年學期必填（名額剩餘要對到單一學期）。 */
export function getCompare(schoolYear: number, semester: number): Promise<AdmissionsCompareRow[]> {
  return api.get<AdmissionsCompareRow[]>(`/admin/admissions/compare?${toQuery({ school_year: schoolYear, semester })}`)
}
```

- [ ] **Step 4：`admin/src/components/admissions/CompareTable.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import { campusLabel } from '../../api/labels'
import type { AdmissionsCompareRow, AdmissionsRate } from '../../api/types'
import { termLabel } from '../../admissions/academic'
import { formatRate, type StatsColumn } from '../../admissions/statsFormat'

// 五校比較（官網延伸，規格 9.3）。數字是「招生案件數」：同一個孩子在兩校各參觀一次算兩筆，
// 不是跨校去重後的孩子數。比率同時寫分子分母；名額只加總有設定計畫名額的年級，一個都沒有寫
// 「未設定」（不是 0，Review Focus 5）；剩餘是負的代表超額。
const props = defineProps<{ rows: readonly AdmissionsCompareRow[]; schoolYear: number; semester: number }>()

const COLUMNS: StatsColumn[] = [
  { key: 'campus', label: '校區', sticky: true },
  { key: 'visit', label: '參觀', kind: 'bar' },
  { key: 'deposit', label: '預繳', kind: 'count' },
  { key: 'enrolled', label: '註冊', kind: 'count' },
  { key: 'effective_deposit', label: '有效預繳', kind: 'count' },
  { key: 'pending_deposit', label: '預繳未註冊', kind: 'count' },
  { key: 'visit_to_deposit', label: '參觀→預繳率' },
  { key: 'visit_to_enrolled', label: '參觀→註冊率' },
  { key: 'deposit_to_enrolled', label: '預繳→註冊率' },
  { key: 'effective_to_enrolled', label: '排除轉期→註冊率' },
  { key: 'target', label: '計畫名額' },
  { key: 'remaining', label: '名額剩餘' },
]

function rateText(rate: AdmissionsRate): string {
  return `${formatRate(rate.value)}（${rate.numerator}/${rate.denominator}）`
}

function remainingText(value: number | null): string {
  if (value === null) return '未設定'
  return value < 0 ? `${value}（超額）` : String(value)
}

const tableRows = computed(() =>
  props.rows.map((row) => ({
    campus_key: row.campus_key,
    campus: campusLabel(row.campus_key),
    visit: row.visit,
    deposit: row.deposit,
    enrolled: row.enrolled,
    effective_deposit: row.effective_deposit,
    pending_deposit: row.pending_deposit,
    visit_to_deposit: rateText(row.visit_to_deposit_rate),
    visit_to_enrolled: rateText(row.visit_to_enrolled_rate),
    deposit_to_enrolled: rateText(row.deposit_to_enrolled_rate),
    effective_to_enrolled: rateText(row.effective_to_enrolled_rate),
    target: row.target_seats === null ? '未設定' : `${row.target_seats}（${row.grades_with_target} 個年級）`,
    remaining: remainingText(row.remaining_seats),
  })),
)
const title = computed(() => `五校比較（${termLabel(props.schoolYear, props.semester)}）`)
</script>

<template>
  <StatsDimensionTable
    :title="title"
    :rows="tableRows"
    :columns="COLUMNS"
    row-key="campus_key"
    empty-text="沒有可比較的校區"
    caption="數字是招生案件數：同一個孩子在兩校各參觀一次算兩筆，不是跨校去重後的孩子數。比率括號內是分子／分母；名額只加總有設定計畫名額的年級，負數代表超額。"
  />
</template>
```

- [ ] **Step 5：`StatsTab.vue` 加「五校比較」子分頁（逐處修改 C3 的檔案）**

1. import 區，四行換掉：

| 原文 | 改成 |
|---|---|
| `import StatsDimensionTable from './StatsDimensionTable.vue'` | `import CompareTable from './CompareTable.vue'`（新行）＋原行 |
| `import { getStats } from '../../api/admissions'` | `import { getCompare, getStats } from '../../api/admissions'` |
| `import type { AdmissionsStats } from '../../api/types'` | `import type { AdmissionsCompareRow, AdmissionsStats } from '../../api/types'` |
| `import { termLabel } from '../../admissions/academic'` | `import { currentTerm, termLabel } from '../../admissions/academic'` |

2. 子分頁清單：

```ts
const SUB_TABS = ['stats-overview', 'stats-class', 'stats-source', 'stats-staff', 'stats-nodeposit'] as const
```

改成

```ts
const SUB_TABS = ['stats-overview', 'stats-class', 'stats-source', 'stats-staff', 'stats-nodeposit', 'stats-compare'] as const
```

3. `function navigate(…) { … }` 整段之後（`setSubTab(\`stats-${target.tab}\`)` 下一行的 `}` 之後）插入：

```ts

// 五校比較（規格 9.3，官網延伸）：看得到兩校以上才有，切到這個子分頁才讀。名額剩餘要對到
// 單一學期：頁首沒選學年就用目前學期（台北日期）；只選了學年沒選學期，是今年就用目前學期，
// 否則用上學期。頁首有沒選的部分就在表格上方寫明用的是哪個學期。
const showCompare = computed(() => props.campusKeys.length > 1)
const compareTerm = computed(() => {
  const current = currentTerm()
  const schoolYear = props.schoolYear ?? current.schoolYear
  const semester = props.semester ?? (schoolYear === current.schoolYear ? current.semester : 1)
  return { schoolYear, semester, defaulted: props.schoolYear === null || props.semester === null }
})
const compareRows = ref<AdmissionsCompareRow[] | null>(null)
const compareFailed = ref(false)
const compareRequests = useRequestSequence()

async function loadCompare() {
  const request = compareRequests.begin()
  const { schoolYear, semester } = compareTerm.value
  compareRows.value = null
  compareFailed.value = false
  try {
    const rows = await getCompare(schoolYear, semester)
    if (compareRequests.isCurrent(request)) compareRows.value = rows
  } catch {
    if (compareRequests.isCurrent(request)) compareFailed.value = true
  }
}

watch([subTab, () => compareTerm.value.schoolYear, () => compareTerm.value.semester], () => {
  if (subTab.value === 'stats-compare') void loadCompare()
})
// 權限更新後只剩一校：子分頁消失，退回總覽。
watch(showCompare, (visible) => {
  if (!visible && subTab.value === 'stats-compare') subTab.value = 'stats-overview'
})
```

4. 模板：「未預繳原因」那個 `<el-tab-pane>` 的結尾與 `</el-tabs>` 之間（原文是連續兩行 `        </el-tab-pane>` 與 `      </el-tabs>`，全檔只有這一處）插入：

```vue

        <el-tab-pane v-if="showCompare" label="五校比較" name="stats-compare" lazy>
          <div class="stats-pane">
            <p v-if="compareTerm.defaulted" class="hint compare-note">
              五校比較要對到單一學期的名額：頁首沒選的部分用 {{ termLabel(compareTerm.schoolYear, compareTerm.semester) }}。
            </p>
            <el-alert v-if="compareFailed" type="error" :closable="false" show-icon title="無法讀取五校比較，請重新載入。">
              <el-button size="small" @click="loadCompare()">重新載入</el-button>
            </el-alert>
            <el-skeleton v-else-if="!compareRows" :rows="4" animated />
            <CompareTable v-else :rows="compareRows" :school-year="compareTerm.schoolYear" :semester="compareTerm.semester" />
          </div>
        </el-tab-pane>
```

5. `<style scoped>`：`.nodeposit-priority { … }` 那一段之後加：

```css
.compare-note {
  margin: 0;
}
```

- [ ] **Step 6：跑測試確認通過**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/compareTable.test.ts src/__tests__/statsTab.test.ts src/__tests__/admissionsView.test.ts
npm run typecheck
```

Expected: compareTable 7 項、statsTab 15 項（C3 12 項＋C3b 3 項）、admissionsView 全部 PASS；typecheck 沒有錯誤。statsTab 的「快速切換校區」與「參考月份」兩項傳的 `campusKeys` 有兩校，五校比較子分頁會出現但不會被點，`/admin/admissions/compare` 不會被呼叫（mock 沒設這條路徑也不影響）。

- [ ] **Step 7：B 閘門指令全套（確認 C3、C4 沒弄壞 B 的頁面）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm --prefix admin run typecheck
npm --prefix admin run test:unit -- --maxWorkers=2
```

Expected: 全部 PASS。

- [ ] **Step 8：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/components/admissions/CompareTable.vue admin/src/components/admissions/StatsTab.vue \
  admin/src/api/admissions.ts admin/src/api/types.ts admin/src/__tests__/compareTable.test.ts
git commit -m "feat(admin): 五校比較（招生案件數、比率附分子分母、名額未設定）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C5：stack e2e（R17）、1440／390 截圖與版面（R16）

**Files:**
- Create: `tests/stack/db.ts`、`tests/stack/admissions-flow.spec.ts`
- Modify: `tests/stack/a11y.spec.ts`（`ADMIN_PAGES`，`['/visit-calendar', '參觀場次'],` 之後）、`tests/stack/keyboard.spec.ts`（`ADMIN_PAGES`，同一行之後）

**Interfaces:**
- Consumes：
  - `tests/stack` 既有：`adminApi`、`findVisit`、`taipeiDate`、`SlotOut`（`api.ts`）；`openAs`、`gotoAdmin`（`pages.ts`）；`ROOT`、`DB_NAME`、`SLOTS_CAMPUS`（`stack-env.ts`）；`global.setup.ts` 已把義華切成自選場次、建好 `campus_admin`（義華）與 `super_admin` 的登入狀態。
  - B 的畫面（Step 1 核對）：B5 `ArrivalsTab.vue` 每列按鈕「已到場」；B3 `FunnelCard.vue` 可拖的卡片有 `draggable="true"`、卡片選單鈕的可及名稱含「移到」、選項是 `STAGE_LABELS` 的欄名（role `menuitem`）；B3 `TransitionDialog.vue` 標題「{起欄} → {迄欄}」、確認鈕「確認」；B4 `IntakePlanTab.vue` 用 `el-table`、表頭有「已註冊」。
  - C3：`.decision__visit`、`.decision__foot`；C4：子分頁「五校比較」。
  - `admin/src/admissions/academic.ts`（B1）的 `currentTerm`、`gradeForBirthday`：算「確認到場當天的入學學期」與挑一個一定是小班的生日。
- Produces：`tests/stack/db.ts` 的 `startVisitSlot(visitRequestId: string): void`。

做法（Global Constraints 最後一條）：不改系統時間。測試自己在義華建一個第 12 天 15:00、容量 1 的場次（`global.setup.ts` 的場次在第 7–9 天 10:00，`submitPublicRequest` 取的是最早的場次，不會選到它），家長在官網選它預約；再用 `psql` 把**這個場次**移到昨天（同後端 `tests/conftest.py::start_visit_slot`），SQL 只在那一場只有這一筆預約時才改。手機 `0912000771`、家長「招生流程家長」都沒被其他 spec 用過（`grep -rn "09120007" tests/stack` 沒有結果）。

- [ ] **Step 1：核對 B 階段畫面的定位點**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
grep -n "已到場" admin/src/components/admissions/ArrivalsTab.vue
grep -n "ElMessageBox" admin/src/components/admissions/ArrivalsTab.vue
grep -n "draggable" admin/src/components/admissions/FunnelCard.vue
grep -n "移到" admin/src/components/admissions/FunnelCard.vue
grep -n "el-dropdown-item\|menuitem" admin/src/components/admissions/FunnelCard.vue
grep -n "→\|確認" admin/src/components/admissions/TransitionDialog.vue
grep -n "<el-table\|已註冊" admin/src/components/admissions/IntakePlanTab.vue
grep -rn "09120007\|招生流程家長" tests/stack
```

Expected：前七個各至少一行（第二個例外，見下）；最後一個沒有輸出。

- 定位點文字跟上面不同時，以 B 的元件為準，改 Step 3 檔頭的 `UI` 物件（spec 裡只有那裡寫死 B 的文案），並在回報寫出差異。
- 第二個指令有輸出＝B5 的「已到場」有確認框：在 Step 3「按已到場」那一步的 `click()` 之後加一行 `await answerMessageBox(page, '<該確認框的標題>', '<確認鈕文字>')`（`answerMessageBox` 從 `./pages` import），標題與按鈕照 `ArrivalsTab.vue` 的 `ElMessageBox.confirm(…)` 原文。
- `FunnelCard.vue` 沒有 `draggable`（B3 改用別的標記）：`card()` 改用 B3 測試裡定位卡片的同一個 class。

- [ ] **Step 2：`tests/stack/db.ts`**

```ts
import { execFileSync } from 'node:child_process'
import { DB_NAME } from './stack-env'

// 直接改 E2E 拋棄式測試庫（start-api.sh 每次重建；名稱一定含 test）。只給「API 做不到、
// 也不該開 API 做」的測試前置用：場次已開始。連線吃 libpq 的環境變數（CI 的 PGHOST／PGUSER／
// PGPASSWORD，本機預設 socket），和 start-api.sh 的 createdb 一樣。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** SQL 從 stdin 給 psql，`:'name'` 由 psql 以字面值帶入（-c 不做變數代換）。回傳 -At 的輸出。 */
function psql(sql: string, vars: Record<string, string>): string {
  const args = ['-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-q', '-At']
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`)
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

/**
 * 同後端 tests/conftest.py 的 start_visit_slot：把這筆預約的場次移到昨天（台北），當成參觀已開始。
 * 公開預約只收還沒開始的場次，「已到場」又要等場次開始，所以先約未來場次再往前移。
 * 只改這筆預約獨占的場次；同一場還有別的預約就丟錯，不拖到其他測試。
 */
export function startVisitSlot(visitRequestId: string): void {
  if (!UUID.test(visitRequestId)) throw new Error(`不是預約 id：${visitRequestId}`)
  const moved = psql(
    `UPDATE visit_slots AS s
        SET slot_date = (now() AT TIME ZONE 'Asia/Taipei')::date - 1
       FROM visit_requests AS r
      WHERE r.id = :'visit_id'::uuid
        AND s.id = r.slot_id
        AND (SELECT count(*) FROM visit_requests AS other WHERE other.slot_id = s.id) = 1
  RETURNING s.id;`,
    { visit_id: visitRequestId },
  )
  if (!moved) throw new Error('場次沒有移動：預約沒有場次，或同一場還有別的預約')
}
```

- [ ] **Step 3：`tests/stack/admissions-flow.spec.ts`**

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm, gradeForBirthday } from '../../admin/src/admissions/academic'
import { adminApi, findVisit, taipeiDate, type AdminApi, type SlotOut } from './api'
import { startVisitSlot } from './db'
import { answerMessageBox, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 招生入學（規格 R17）：家長在官網自選場次預約成功 → 場次時間過了出現在「官網預約」待確認 →
// 園方按已到場 → 漏斗看板「已訪視」→ 預繳 → 註冊 → 名額規劃的「已註冊」→ 統計看得到。
// 「時間已過」用 psql 把本測試自己建的場次移到昨天（db.ts），不改系統時間、不動其他測試的場次。
// 每一步都在畫面上操作；API 只用來建場次與核對結果。後兩項是 R16：五個分頁在 1440／390 的
// 截圖（output/playwright/，給人看，不比對像素）與「頁面不橫向溢出」。

const PARENT = '招生流程家長'
const CHILD = '招生流程寶貝'
const PHONE = '0912000771'
const EMAIL = 'admissions-flow@example.com'
const SHOTS = path.join(ROOT, 'output/playwright')
const TABS = ['funnel', 'records', 'intake', 'arrivals', 'stats'] as const

// B 階段畫面的文案（Step 1 核對過）。B 改文案時只改這裡。
const UI = {
  arrived: '已到場',
  moveMenu: /移到/,
  confirm: '確認',
}

// 入學學期＝確認到場當天的台北學期（規格 6.1）；生日挑在該學年剛好滿 3 歲 → 小班（規格 6.4）。
const TERM = currentTerm(taipeiDate(0))
const BIRTHDAY = `${TERM.schoolYear + 1911 - 3}-03-15`
const GRADE = '小班'

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `頁面寬 ${scrollWidth}px，超出視窗 ${clientWidth}px`).toBeLessThanOrEqual(clientWidth)
}

/** 這個孩子的卡片在看板的哪一欄（核對用）。 */
async function boardStage(api: AdminApi): Promise<string | undefined> {
  const board = await api.get<{ columns: Record<string, { child_name: string }[]> }>(
    `/admin/admissions/board?campus_key=${SLOTS_CAMPUS}&school_year=${TERM.schoolYear}`,
  )
  return Object.entries(board.columns).find(([, cards]) => cards.some((card) => card.child_name === CHILD))?.[0]
}

const card = (page: Page) => page.locator('[draggable="true"]', { hasText: CHILD })

/** 卡片選單「移到…」→ 選目的欄 → 確認框（標題「起 → 迄」）按確認。鍵盤可完成的那條路（R15）。 */
async function moveCard(page: Page, to: string, title: string): Promise<void> {
  await card(page).getByRole('button', { name: UI.moveMenu }).click()
  await page.getByRole('menuitem', { name: to, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toContainText(CHILD)
  await dialog.getByRole('button', { name: UI.confirm, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('家長自選場次 → 時間過了出現在官網預約 → 已到場 → 看板 → 預繳 → 註冊 → 名額已註冊 → 統計', async ({ browser }) => {
  expect(gradeForBirthday(BIRTHDAY, TERM.schoolYear)).toBe(GRADE)
  const api = await adminApi('super_admin')
  const slotDate = taipeiDate(12)
  await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
    slot_date: slotDate, start_time: '15:00:00', end_time: '16:00:00', capacity: 1,
  })

  await test.step('家長在官網選第 12 天下午的場次，送出即預約成功', async () => {
    const parent = await openAs(browser, null)
    const { page } = parent
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
    await page.getByLabel('預約日期').selectOption(slotDate)
    await expect(page.locator('.visit-slot-options input[type="radio"]')).toHaveCount(1)
    await page.locator('.visit-slot-options input[type="radio"]').first().check()
    await page.getByLabel('孩子姓名').fill(CHILD)
    await page.getByLabel('孩子出生年月日').fill(BIRTHDAY)
    await page.getByLabel('家長稱呼').fill(PARENT)
    await page.getByLabel('聯絡電話').fill(PHONE)
    await page.getByLabel('參觀人數').selectOption('2')
    await page.getByLabel('聯絡 Email').fill(EMAIL)
    await page.getByRole('checkbox', { name: /我同意園方使用本次填寫的資料/ }).check()
    await page.getByRole('button', { name: /送出/ }).click()
    await expect(page.locator('#booking-result')).toContainText('預約成功')
    await parent.context.close()
  })
  const booked = await findVisit(api, PARENT)
  expect(booked.status).toBe('confirmed')
  expect(booked.slot?.slot_date).toBe(slotDate)

  startVisitSlot(booked.id)

  const staff = await openAs(browser, 'campus_admin')
  const { page } = staff

  await test.step('官網預約分頁列出時間已過、還沒確認到場的預約；按已到場', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=arrivals`, '招生入學')
    const row = page.locator('tr', { hasText: PARENT })
    await expect(row).toContainText(CHILD)
    await row.getByRole('button', { name: UI.arrived, exact: true }).click()
    // B5 的已到場有確認框（ArrivalsTab.vue：標題「標記已到場？」、按鈕「標記已到場」）。
    await answerMessageBox(page, '標記已到場？', '標記已到場')
    await expect(page.locator('tr', { hasText: PARENT })).toHaveCount(0)
  })
  expect((await findVisit(api, PARENT)).status).toBe('completed')

  await test.step('漏斗看板：卡片在「已訪視」，年級依生日換算成小班', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel`, '招生入學')
    await expect(card(page)).toContainText(GRADE)
    expect(await boardStage(api)).toBe('visited')
  })

  await test.step('「移到…」已預繳（確認框「已訪視 → 已預繳」）', async () => {
    await moveCard(page, '已預繳', '已訪視 → 已預繳')
    await expect.poll(() => boardStage(api)).toBe('deposited')
  })

  await test.step('「移到…」已註冊（確認框帶好註冊日期、年級、入學學期，直接確認）', async () => {
    await moveCard(page, '已註冊', '已預繳 → 已註冊')
    await expect.poll(() => boardStage(api)).toBe('enrolled')
  })

  await test.step('名額規劃：小班「已註冊」是 1', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=${TERM.schoolYear}&sem=${TERM.semester}&tab=intake`, '招生入學')
    const plan = page.locator('.el-table').filter({ hasText: '已註冊' }).first()
    const gradeRow = plan.locator('tbody tr').filter({ hasText: GRADE })
    await expect(gradeRow).toBeVisible()
    const headers = (await plan.locator('thead th').allInnerTexts()).map((text) => text.trim())
    const enrolledColumn = headers.indexOf('已註冊')
    expect(enrolledColumn, `名額規劃表頭：${headers.join('、')}`).toBeGreaterThanOrEqual(0)
    await expect(gradeRow.locator('td').nth(enrolledColumn)).toHaveText('1')
  })

  await test.step('統計分析：本月 1 人次、預繳 1・註冊 1', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=stats`, '招生入學')
    await expect(page.locator('.decision__visit').first()).toHaveText('1 人次')
    await expect(page.locator('.decision__foot').first()).toHaveText('預繳 1 · 註冊 1')
  })

  await Promise.all([staff.context.close(), api.dispose()])
})

const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：招生入學五個分頁與五校比較截圖，頁面不橫向溢出`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true })
    const { context, page } = await openAs(browser, 'super_admin', device)
    for (const tab of TABS) {
      await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=${tab}`, '招生入學')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.el-skeleton')).toHaveCount(0)
      await test.step(tab, () => expectNoHorizontalOverflow(page))
      await page.screenshot({ path: path.join(SHOTS, `admissions-${tab}-${name}.png`), fullPage: true })
    }
    // 目前停在統計分析；總管理者看得到五校比較。
    await page.getByRole('tab', { name: '五校比較' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.el-skeleton')).toHaveCount(0)
    await test.step('stats-compare', () => expectNoHorizontalOverflow(page))
    await page.screenshot({ path: path.join(SHOTS, `admissions-stats-compare-${name}.png`), fullPage: true })
    await context.close()
  })
}
```

- [ ] **Step 4：無障礙與版面檢查加上招生頁**

`tests/stack/a11y.spec.ts` 的 `ADMIN_PAGES`，`['/visit-calendar', '參觀場次'],` 之後插入：

```ts
    ['/admissions', '招生入學'],
    ['/admissions?tab=records', '招生入學'],
    ['/admissions?tab=intake', '招生入學'],
    ['/admissions?tab=arrivals', '招生入學'],
    ['/admissions?tab=stats', '招生入學'],
```

`tests/stack/keyboard.spec.ts` 的 `ADMIN_PAGES`，`['/visit-calendar', '參觀場次'],` 之後插入：

```ts
  ['/admissions', '招生入學'],
  ['/admissions?tab=stats', '招生入學'],
```

（其餘三個分頁的溢出檢查在 admissions-flow 的截圖測試裡，兩個寬度都有。）

- [ ] **Step 5：build 後先跑這三支**

依序跑（8GB RAM，不要同時）；埠與資料庫名稱用本 worktree 專用的，避開其他 worktree：

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
E2E_DB_NAME=ivy_website_e2e_test_admissions E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run e2e:build
E2E_DB_NAME=ivy_website_e2e_test_admissions E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run test:e2e:stack -- admissions-flow a11y keyboard
ls output/playwright/admissions-*
```

Expected：`admissions-flow.spec.ts` 3 passed（流程 1、截圖 2），`a11y.spec.ts`、`keyboard.spec.ts` 全過（a11y 多 5 項）；`output/playwright/` 有 12 張 `admissions-*-{1440,390}.png`。

失敗時：
- 流程卡在某一步：開 `test-results/stack/` 的 trace（`npx playwright show-trace <trace.zip>`）看畫面。B／C 的畫面或 API 有錯就回到對應 task 修（先寫能重現的單元測試），**不要**放寬 spec 的斷言。只有 Step 1 核對出的文案差異才改 `UI` 物件。
- `startVisitSlot` 丟「同一場還有別的預約」：代表有別的 spec 也約到第 12 天 15:00 的場次；先 `grep -rn "taipeiDate(12)" tests/stack` 找出是誰，換一個沒人用的日子，不要拿掉 SQL 的保護條件。
- axe 抓到招生頁的 serious／critical：修元件（例如 `role="region"` 的捲動框要有 `aria-label`），不要加豁免。

- [ ] **Step 6：stack e2e 全套**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
E2E_DB_NAME=ivy_website_e2e_test_admissions E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run test:e2e:stack
```

Expected：全部 passed（項數＝開工前全套的項數＋8）。已知例外：`media.spec.ts` 整套跑偶發失敗、單獨跑會過（main 既有問題）；只有它失敗時單獨重跑 `npm run test:e2e:stack -- media`（同一組環境變數）確認通過，回報兩次的輸出。

- [ ] **Step 7：看截圖（人工）**

用 Read 工具逐張看 `output/playwright/admissions-*.png`：
- 390：看板四欄直向堆疊（規格 10）；明細、名額、統計的表格在框內橫捲，頁面沒有被撐寬；分頁頭可以左右滑。
- 1440：統計總覽四張決策卡一排、警示與行動入口並排；五校比較的「未設定」沒有被寫成 0。
- 顏色只有既有 token 的色調，沒有出現陌生顏色。
發現問題就回到 C3／C4（或 B 的對應 task）修，修完重跑 Step 5。

- [ ] **Step 8：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add tests/stack/db.ts tests/stack/admissions-flow.spec.ts tests/stack/a11y.spec.ts tests/stack/keyboard.spec.ts
git commit -m "test(e2e): 招生入學端到端流程（自選場次到註冊與名額）與 1440／390 截圖

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

截圖在 `output/`（已 gitignore），不提交。

---

### Task C6：文件、驗收紀錄與回寫規格／總覽

**Files:**
- Modify: `docs/specs/2026-09-30-website-admissions-design.md`（31 處就地回寫＋新增第 17 節對照表）
- Modify: `docs/superpowers/plans/2026-10-01-admissions.md`（總覽：技術調整、檔案配置、介面、API 表、稽核代碼，31 處＋「統計分頁」一節）
- Modify: `contracts/ivy-recruitment/README.md`（「統計與園務的差異」補條目）
- Modify: `docs/website-admin/acceptance.md`（「招生入學」段落：R01–R17）
- Modify: `DESIGN.md`（檔尾新增「招生入學（2026-10-01）」）、`CLAUDE.md`（「現況容易搞錯的事」加一行）、`deploy/README.md`（檔尾新增「招生入學（未部署，草稿）」）、`README.md`（頂部日期段落）

**Interfaces:**
- Consumes：C 階段完成閘門的實際輸出（Step 1）；總覽「技術調整」1–7、A 計畫「對總覽的調整」1–17、B 計畫 1–14、本檔 1–19（本檔表格由上往下編號；17–19 是 2026-10-01 未預繳名單裁定後加的）。
- Produces：只有文件。規格與總覽的回寫用 Python 精確替換：原文必須剛好出現一次，否則中止；新文字已在檔內就略過（重跑安全）。

- [ ] **Step 1：C 階段完成閘門（依序跑，輸出存進 `output/admissions-c6/`）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
set -o pipefail
mkdir -p output/admissions-c6
(cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_admissions uv run pytest -q) 2>&1 | tee output/admissions-c6/backend.log   # 主 session 背景跑
npm run contract:check 2>&1 | tee output/admissions-c6/contract.log
npm --prefix admin run typecheck 2>&1 | tee output/admissions-c6/admin-typecheck.log
npm --prefix admin run test:unit -- --maxWorkers=2 2>&1 | tee output/admissions-c6/admin.log
npm run test:website -- --maxWorkers=2 2>&1 | tee output/admissions-c6/web.log
E2E_DB_NAME=ivy_website_e2e_test_admissions E2E_API_PORT=8731 E2E_WEB_PORT=3731 npm run test:e2e:stack 2>&1 | tee output/admissions-c6/stack.log
```

Expected：每個指令結束碼都是 0（`set -o pipefail` 讓 `tee` 不會吃掉失敗）。R12 的三邊（後端 `test_admissions_academic.py`、後台 `admissionsAcademic.test.ts`、web `admission-grade-cases.spec.ts`）都在這幾個指令裡。stack e2e 若只有 `media.spec.ts` 失敗，照 C5 Step 6 單獨重跑，輸出存 `output/admissions-c6/stack-media.log`。任何一項沒過就先修，**不要**往下寫「通過」。Step 9 的 README 段落會從這些 log 抓結果行（`output/` 已 gitignore，不提交）。

- [ ] **Step 2：核對要回寫的調整條數**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
sed -n '/^## 對總覽的調整/,/^## Global Constraints/p' docs/superpowers/plans/2026-10-01-admissions-A-backend.md | grep -c '^[0-9]\+\. '
sed -n '/^## 對總覽的調整/,/^## 檔案結構/p' docs/superpowers/plans/2026-10-01-admissions-B-admin.md | grep -c '^| [0-9]\+ |'
sed -n '/^## 對總覽的調整/,/^---/p' docs/superpowers/plans/2026-10-01-admissions-C-stats.md | grep -c '^| '
```

Expected：`30`、`28`、`20`（C 是表頭＋19 列；2026-10-01 主 session 核對，未預繳名單裁定後加 17–19 三列）。

**注意**：C6 的回寫腳本（Step 3、Step 5）與對照表（Step 4）撰寫時只涵蓋 A 第 1–17 條、B 第 1–14 列。**A 第 18–30 條、B 第 15–28 列尚未寫進腳本**，執行本步時要逐條補上：
- 照 Step 3／Step 5 腳本同樣的 `(出處, 原文, 新文字)` 格式，加進對應腳本。改的是規格與總覽的哪一節，依該條內容判斷：介面與 API 改總覽「介面」，錯誤碼與流程改規格第 6、13 節，畫面改規格第 10 節。
- 在 Step 4 的對照表各補一列。

執行時 A／B／C 若又追加調整，條數會更多，同樣照這個方式補。

- [ ] **Step 3：就地回寫規格（31 處）**

每一條的「原文」是規格現在的字，「新文字」是回寫後的字；出處對到總覽技術調整、A／B／C 計畫的調整編號。

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path

path = Path("docs/specs/2026-09-30-website-admissions-design.md")
text = path.read_text(encoding="utf-8")

# (出處, 原文, 新文字)。原文必須在檔內剛好出現一次；已回寫過（原文不在、新文字在）就略過。
REPLACEMENTS = [
    ("C 階段回寫標記",
     '狀態：草案，待使用者審閱',
     '狀態：草案，待使用者審閱；2026-10-01 實作計畫（總覽與 A／B／C 三份）的技術調整已回寫，對照表見第 17 節'),
    ("A9＋B10 帶參觀老師",
     '| `tour_guide_user_id` | uuid FK `users.id` ON DELETE SET NULL | 是 | `tour_guide_employee_id` | 延伸對應；本次畫面可選填 |',
     '| `tour_guide_user_id` | uuid FK `users.id` ON DELETE SET NULL | 是 | `tour_guide_employee_id` | 延伸對應。API 可選填：指到不存在的帳號回 422 `TOUR_GUIDE_INVALID`；只帶帳號、沒帶姓名時以該帳號顯示名稱當快照。本次後台畫面不放這個欄位 |'),
    ("技術調整 2 metadata_json",
     '| `metadata_json` | JSONB，可空 | 同 | |',
     '| `metadata_json` | JSON，可空 | 同（園務為 JSONB） | 官網慣例用 `sqlalchemy.JSON`，匯出內容相同 |'),
    ("技術調整 5 姓名截斷",
     '     - `child_name` 取孩子姓名；預約未填則寫「（未填姓名）」，在明細標示待補。',
     '     - `child_name` 取孩子姓名；預約未填則寫「（未填姓名）」，在明細標示待補。預約的孩子姓名、家長稱呼最長 64 字，招生的 `child_name`、`contact_name` 對齊園務 50 字：自動建立時截斷到 50，不報錯。'),
    ("A13 補建限制",
     '規則同第 1 點，需要 `booking.read` 與 `admissions.write`，重複呼叫回傳同一筆。',
     '規則同第 1 點，需要 `booking.read` 與 `admissions.write`，重複呼叫回傳同一筆。只接受 `completed` 且未匿名化的預約：其他狀態回 409 `VISIT_REQUEST_NOT_COMPLETED`，已匿名化回 409 `VISIT_REQUEST_ANONYMIZED`；清單也排除已匿名化的預約。'),
    ("技術調整 3＋A10 版本衝突與不允許的轉換",
     '- 以列鎖＋`expected_version` 處理並行；版本不符回 409 `VERSION_CONFLICT`，畫面重新載入看板（同園務收到 409 強制重載）。',
     '- 以列鎖＋`expected_version` 處理並行；版本不符回 409 `RECRUITMENT_VISIT_VERSION_CONFLICT`（帶 `current_version`），畫面重新載入看板（同園務收到 409 強制重載）。路由先比對版本、再判斷權限：別人剛改過的卡片一律 409，不會因為卡片已換欄而誤回 403。\n- 不允許的轉換回 422 `TRANSITION_NOT_ALLOWED`（請求內容不合法，附中文說明，visited→withdrawn 用園務原文）。預約既有的 `INVALID_TRANSITION` 是 409（狀態剛被別人改了），兩者不混用。'),
    ("技術調整 6＋B6 年級共用案例",
     '後端 pytest 與 web vitest 都讀這份案例。',
     '案例放在 `contracts/ivy-recruitment/grade-cases.json`，形狀 `{"cases": [{"name", "birthday", "today", "expected_term": [學年, 學期], "expected_grade": 年級或 null}]}`（年級用 `expected_term` 的學年換算）；後端 pytest、web vitest、admin vitest 三邊都讀這份。'),
    ("A12 超額警示的位置",
     '- 超過計畫名額只警示（`SEAT_CAPACITY_WARNING`），不阻擋。',
     '- 超過計畫名額只警示、不阻擋：回應 `SeatOut = {visit, capacity_warning, warning_code}`，超額時 `warning_code` 是 `SEAT_CAPACITY_WARNING`（在回應裡，不是錯誤）。'),
    ("A11 請求 schema 禁止多餘欄位",
     '- 編輯：狀態欄位（`has_deposit`、`enrolled`、`enrolled_on`、`withdrawn_*`）不可編輯，其餘欄位需帶 `expected_version`。',
     '- 編輯：狀態欄位（`has_deposit`、`enrolled`、`enrolled_on`、`withdrawn_*`）不可編輯，其餘欄位需帶 `expected_version`。建立、編輯、狀態轉換、座位、計畫名額的請求 schema 一律 `extra="forbid"`：送 `has_deposit`、`enrolled`、`enrolled_on`、`withdrawn_*`、`provisional_grade`、`month`、`seq_no` 得到標準 422（`loc` 指到該欄位）。'),
    ("C 調整 11：統計頁列未預繳名單（2026-10-01 使用者裁定）",
     '- editor、readonly 沒有招生權限；招生統計含孩子姓名（行動清單）與接待人員名字，不開給只有 `analytics.read` 的角色。',
     '- editor、readonly 沒有招生權限；招生統計含孩子姓名（未預繳名單）、接待人員名字與來源原文，不開給只有 `analytics.read` 的角色。統計回應（`/stats`、`/compare`）只有數字；未預繳名單由 `GET /no-deposit-records` 提供（對應園務 `/no-deposit-analysis`），權限同其他招生 API（`admissions.read`＋校區範圍），每列只回畫面要的欄位，不含電話、地址、生日。'),
    ("C 調整：月比與同票排序也記入契約",
     '這一點和第 9.3 節不移植來源別名，都記入轉移契約，併入時由園務決定是否跟進。',
     '這一點、月比任一邊是 null 時差值也是 null（園務會算成 100.0－0）、同票排序加第二鍵「標籤字串升序」（園務只有單鍵、同票順序不固定），以及第 9.3 節不移植來源別名，都記入轉移契約，併入時由園務決定是否跟進。'),
    ("C 調整：總覽多「本範圍合計」、不做兩張圖",
     '  - 月比變化、本月漏斗快照、月度明細、年度統計。',
     '  - 月比變化、本月漏斗快照、月度明細、年度統計，以及「本範圍合計」（六個計數、唯一幼生與四個比率）。園務的兩張圖（月度量體、轉換率走勢）由月度明細表的 CSS 長條取代；「全管道彙整」是園務自家官網報名，不做。'),
    ("C 調整 4：警示 target_tab 與 REVIEW_SOURCE",
     '包括逾期 14 天、冷名單 90 天、掉點 10 個百分點、高潛力積壓 5 筆、行動清單 3 筆。',
     '包括逾期 14 天、冷名單 90 天、掉點 10 個百分點、高潛力積壓 5 筆、行動清單 3 筆。官網的 `target_tab` 是 `records`（訪視明細，帶 `month`）、`nodeposit`、`source`（園務是 `detail`／`nodeposit`／`area`）；園務的「查看區域機會」（`AREA_OPPORTUNITY`）改成「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現（官網不做行政區，`district` 不填）。'),
    ("C 調整 11＋17＋19：未預繳原因母體與未預繳明細",
     '- **未預繳原因**：依 `no_deposit_reason`，含優先度分組。',
     '- **未預繳原因**：依 `no_deposit_reason`，含優先度分組。母體是「未預繳且未退出」：退預繳後 `has_deposit` 雖然是 false，殘留的高潛力原因不算。數字卡（高潛力未預繳、逾 14 天待追、冷名單）與分布來自 `/stats`。\n  - **未預繳明細**（名單，同園務 `RecruitmentNoDepositTab`）：母體同上。篩選：轉換潛力（預設「高潛力優先」，另有全部潛力、中潛力、低潛力）、原因、班別、「逾 14 天」開關、「冷名單」開關；每頁 50 筆。欄位：月份、姓名、班別、原因分類、轉換潛力（高／中／低／—）、冷名單（建檔滿 90 天標「冷」）、說明、來源、介紹者、電訪回應，另有「查看」切到訪視明細並篩該筆的月份。排序：民國月份新到舊、同月序號依數字小到大（園務是字串排序）。警示與行動入口指到未預繳原因時，帶的潛力與逾期天數套進名單（同園務）。'),
    ("C 調整 16：介紹者 × 來源放在接待分析",
     '- **來源分析**：依 `source`，另有介紹者 × 來源交叉。',
     '- **來源分析**：依 `source`；介紹者 × 來源交叉表放在「接待分析」（同園務 `RecruitmentStaffTab`，介紹者就是接待人員）。'),
    ("C 調整：五校比較的學期",
     '  - 名額剩餘合計只加總已設定計畫名額的年級；一個年級都沒設定時顯示「未設定」。',
     '  - 名額剩餘合計只加總已設定計畫名額的年級；一個年級都沒設定時顯示「未設定」。\n  - 名額要對到單一學期：頁首沒選學年就用目前學期（台北日期）；只選了學年沒選學期，是目前學年就用目前學期，否則用上學期；表格上方寫明用的是哪個學期。'),
    ("B5 側欄位置",
     '側欄新增「招生入學」（`router/nav.ts`），需要 `admissions.read`。',
     '側欄新增「招生入學」（`router/nav.ts`），放在「參觀預約」組、「參觀場次」之後，圖示 `TrendCharts`，需要 `admissions.read`。'),
    ("B2＋C 調整：網址參數",
     '篩選和分頁同步到 URL query（`campus`、`sy`、`sem`、`tab`），比照園務 `useAdmissionsTermFilter`。',
     '篩選和分頁同步到 URL query（`campus`、`sy`〔`all`＝不限學年〕、`sem`、`tab`；另有 `vr`＝只看某筆預約的招生訪視，給預約明細的連結用；`month`＝訪視明細的月份，統計的警示與行動入口會帶），比照園務 `useAdmissionsTermFilter`。'),
    ("B10＋B11 訪視明細",
     '| 訪視明細 | 篩選：月份、班別、入學學年、學期、來源、介紹者、預繳是／否、未預繳原因、關鍵字。表格每頁 50 筆。',
     '| 訪視明細 | 篩選：月份、班別、來源、介紹者、預繳是／否、未預繳原因、關鍵字；入學學年學期用頁首的共用篩選，不在明細重複，「清除篩選」連學年學期一起清（同園務）。表單與明細不放來源分類（`source_category`）、帶參觀老師、娃娃車（`rides_bus`）、地址分析同意（欄位照存、照匯出）。表格每頁 50 筆。'),
    ("C 調整：統計分頁與頁面的接縫＋C 調整 18 名單「查看」",
     '| 統計分析 | 子分頁：總覽、班別分析、來源分析、接待分析、未預繳原因；多校權限者另有「五校比較」。本次以表格加 CSS 長條呈現，不新增圖表套件。 |',
     '| 統計分析 | 子分頁：總覽、班別分析、來源分析、接待分析、未預繳原因；多校權限者另有「五校比較」。本次以表格加 CSS 長條呈現，不新增圖表套件。另有「參考月份」選單（預設最新有資料的月份）。警示與行動入口指到統計內的子分頁就直接切過去；指到訪視明細就切到「訪視明細」並帶 `month`（`router.push`，上一頁回到統計）。「未預繳原因」另列「未預繳明細」名單（第 9.3 節），每列「查看」同樣切到訪視明細並帶該筆的月份（明細只吃 `month`、`vr`，沒有單筆連結）。 |'),
    ("B9 園務文案改寫",
     '- 各區塊沿用後台既有的 loading、空資料、錯誤、衝突提示規範。沒有資料時說明原因，不顯示假的 0。',
     '- 各區塊沿用後台既有的 loading、空資料、錯誤、衝突提示規範。沒有資料時說明原因，不顯示假的 0。\n- 園務文案照抄，但提到學生檔、監護人、學號、學費管理、班級的改寫成官網的說法（官網沒有學生檔與學費模組）：事件 `converted` 寫「標記註冊」、`revert_converted` 寫「取消註冊」，並補上園務缺的 `seat_reserved`「保留座位」、`seat_released`「釋放保留」，歷程不露英文代碼。'),
    ("技術調整 7＋A15 保存政策欄位",
     '- 保存政策新增「招生訪視」類別與天數設定，匿名化時清除：',
     '- 保存政策新增「招生訪視」類別與天數設定（`retention_policies.admissions_days`，Integer，可空，NULL＝不自動清理，DB CHECK 限 30–3650；報表類別 `admissions`；符合條件 `anonymized_at IS NULL AND updated_at < now − admissions_days`；更新請求沒帶這個鍵就不動它），匿名化時清除：'),
    ("A16 匯出格式",
     '  - 讀官網資料庫，依校區輸出三張表的 JSONL，欄位形狀照園務。',
     '  - 讀官網資料庫，依校區輸出三張表的 JSONL。每列 `{"website_id": ..., "columns": {園務欄位}, "mapping": {匯入時要對應的官網值}}`；`columns` 的外鍵與年級 id（`recruitment_visit_id`、`grade_id`、`provisional_grade_id`、`tour_guide_employee_id`）留 `null`，由匯入端依 `mapping` 填入；`created` 事件不匯出。'),
    ("技術調整 1 列表分頁",
     '| GET `/records` | read | 篩選、分頁；`campus_key` 必填 |',
     '| GET `/records` | read | 篩選、分頁（`page`／`page_size`，預設 50、上限 100）；回裸 list、不回 total，前端以「回傳筆數＝page_size」判斷有下一頁；`campus_key` 必填 |'),
    ("技術調整 4 建立訪視的校區",
     '| POST `/records` | write | 手動新增 |',
     '| POST `/records` | write | 手動新增；`campus_key` 放 query（同 `POST /admin/slots`） |'),
    ("A13 補建錯誤碼",
     '| POST `/from-visit-request/{visit_request_id}` | write＋booking.read | 補建，可重複呼叫 |',
     '| POST `/from-visit-request/{visit_request_id}` | write＋booking.read | 補建，可重複呼叫；非 `completed` 回 409 `VISIT_REQUEST_NOT_COMPLETED`、已匿名化回 409 `VISIT_REQUEST_ANONYMIZED` |'),
    ("C 調整：參考月份格式錯＋C2b 未預繳明細端點",
     '| GET `/stats` | read | 第 9 節 |',
     '| GET `/stats` | read | 第 9 節；`reference_month` 格式錯回 422 `INVALID_REFERENCE_MONTH`（園務是未處理的 ValueError） |\n| GET `/no-deposit-records` | read | 未預繳明細（園務 `/no-deposit-analysis`）：`campus_key` 必填，`school_year`、`semester`、`reason`、`grade`、`priority`（high／medium／low）、`overdue_days`（1–365）、`cold_only`、`page`（預設 1）、`page_size`（1–500，預設 100）；回 `total`、`page`、`page_size`、`summary`（只受原因與班別影響）、`records`（含孩子姓名，不含電話、地址、生日） |'),
    ("C 調整 5：五校比較參數必填",
     '| GET `/compare` | read | 五校比較，只含授權校區 |',
     '| GET `/compare` | read | 五校比較，只含授權校區；`school_year`、`semester` 必填（名額剩餘要對到單一學期） |'),
    ("A17 選項",
     '| GET `/options` | read | 篩選選項：月份、來源、介紹者；列舉值文案 |',
     '| GET `/options` | read | 篩選選項：月份（新到舊）、來源、介紹者（各前 50 個）；列舉值文案，`source_categories` 是「代碼 → 園務文案」的 dict（順序同園務） |'),
    ("C 調整：R16 截圖",
     '| R16 | 1440px 桌機、390px 手機 | 看板、表格、表單、空狀態可用，頁面不溢出 |',
     '| R16 | 1440px 桌機、390px 手機 | 看板、表格、表單、空狀態可用，頁面不溢出（`tests/stack/admissions-flow.spec.ts` 五個分頁與五校比較兩種寬度截圖存 `output/playwright/`，並檢查不橫向溢出） |'),
    ("C 調整：R17 的時間做法",
     '→ 按已到場 → 看板已訪視 → 預繳 → 註冊 → 名額顯示已註冊 | 全程成立 |',
     '→ 按已到場 → 看板已訪視 → 預繳 → 註冊 → 名額顯示已註冊。「場次時間過後」用 psql 把本測試自己建的場次移到昨天（同後端 `start_visit_slot`），不改系統時間 | 全程成立 |'),
]

changed = 0
for label, old, new in REPLACEMENTS:
    # 新文字已在檔內＝之前跑過（多數新文字包含原文，要先檢查這個）。
    if new in text:
        print(f"已回寫，略過：{label}")
        continue
    count = text.count(old)
    assert count == 1, f"{label}：原文出現 {count} 次，先對照規格現況再改腳本"
    text = text.replace(old, new)
    changed += 1
path.write_text(text, encoding="utf-8")
print(f"規格：{changed} 處已回寫，共 {len(REPLACEMENTS)} 處")
PY
```

Expected：最後一行 `規格：31 處已回寫，共 31 處`。中途 `AssertionError` 表示規格在計畫寫完之後被改過：打開規格找到那一句的現況，只改腳本裡那一條的「原文」（新文字的意思不變）再重跑；已回寫的會被略過。

- [ ] **Step 4：規格新增第 17 節「實作計畫回寫對照」**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path

path = Path("docs/specs/2026-09-30-website-admissions-design.md")
text = path.read_text(encoding="utf-8")
HEADING = "## 17. 實作計畫回寫對照（2026-10-01）"
SECTION = HEADING + """

實作計畫：總覽 `docs/superpowers/plans/2026-10-01-admissions.md`，階段 A／B／C 各一份（`-A-backend`、`-B-admin`、`-C-stats`）。計畫裡「以計畫為準」的調整逐條列在下面；有規格對應的已就地改進該節，只影響程式介面的寫在總覽的「檔案配置」「介面」。

| 來源 | 調整 | 回寫位置 |
|---|---|---|
| 總覽技術調整 1 | 列表回裸 list，`page`／`page_size`，不回 total | 第 13 節 `GET /records` |
| 總覽技術調整 2 | `metadata_json` 用 JSON | 第 5.2 節 |
| 總覽技術調整 3 | 不允許的轉換 422 `TRANSITION_NOT_ALLOWED`，與預約的 409 `INVALID_TRANSITION` 分開；版本衝突碼 `RECRUITMENT_VISIT_VERSION_CONFLICT` | 第 6.3 節 |
| 總覽技術調整 4 | 建立訪視的 `campus_key` 放 query | 第 13 節 `POST /records` |
| 總覽技術調整 5 | 自動建立時姓名截斷到 50 字 | 第 6.1 節第 1 點 |
| 總覽技術調整 6 | 共用年級案例的位置 | 第 6.4 節 |
| 總覽技術調整 7 | `retention_policies.admissions_days` | 第 11 節 |
| A 調整 1 | 不設 `records.stage_of`；階段用 `funnel.derive_stage`／`stage_condition`，`funnel.py` 由 A3 先建 | 總覽「檔案配置」`funnel.py`、「介面」records.py、funnel.py |
| A 調整 2 | `RecruitmentVisit.events` 加 `passive_deletes=True` | 總覽「介面」models.py |
| A 調整 3 | `write_event` 多 `created_at` | 總覽「介面」records.py |
| A 調整 4 | `fields_from_visit_request` 多 `slot_date` | 總覽「介面」booking_link.py |
| A 調整 5 | `arrivals`、`eligible_count`、`anonymize_due` 多 `now` | 總覽「介面」booking_link.py、retention.py |
| A 調整 6 | 保存政策的 schema 在 `operations/routes.py` | 總覽「檔案配置」 |
| A 調整 7 | 新增 `test_admissions_schema.py` | 總覽「檔案配置」測試清單 |
| A 調整 8 | `FunnelColumnsOut` | 總覽「介面」Schema 名稱 |
| A 調整 9 | `TOUR_GUIDE_INVALID`、以帳號顯示名稱當姓名快照 | 第 5.1 節 `tour_guide_user_id`；總覽「介面」records.py |
| A 調整 10 | `not_allowed_reason`；先比版本再判權限 | 第 6.3 節；總覽「介面」funnel.py |
| A 調整 11 | request schema 一律 `extra="forbid"` | 第 6.6 節；總覽「介面」Schema 名稱 |
| A 調整 12 | `SeatOut` 帶 `warning_code` | 第 6.5 節；總覽「介面」Schema 名稱 |
| A 調整 13 | 補建只收 `completed` 且未匿名化 | 第 6.1 節第 2 點、第 13 節；總覽 API 表 |
| A 調整 14 | `labels.ts` 同名 metadata 鍵依 action 分開翻 | 總覽「稽核代碼」 |
| A 調整 15 | `admissions_days` 的 DB CHECK 與只在有帶鍵時寫入 | 第 11 節；總覽技術調整 7 |
| A 調整 16 | 匯出每列 `website_id`／`columns`／`mapping` | 第 12.2 節 |
| A 調整 17 | `source_categories` 是 dict | 第 13 節 `GET /options`；總覽 API 表 |
| B 調整 1 | `academic.ts` 多匯出 `taipeiToday`、`rocDate`、`schoolYearOptions`、`Term` | 總覽「檔案配置」 |
| B 調整 2 | 網址 `sy=all`、`vr` | 第 10 節；總覽「檔案配置」 |
| B 調整 3 | `StatsTab.vue` 由 B1 先放空狀態，C3 覆寫 | 總覽「檔案配置」、「統計分頁」 |
| B 調整 4 | `admissionsTestKit.ts` | 總覽「檔案配置」 |
| B 調整 5 | 側欄位置與圖示 | 第 10 節；總覽「檔案配置」 |
| B 調整 6 | `grade-cases.json` 的形狀 | 第 6.4 節；總覽技術調整 6 |
| B 調整 7 | 後台依賴的 schema 欄位 | 總覽「介面」Schema 名稱 |
| B 調整 8 | 型別別名的名稱 | 總覽「介面」後台 API 模組 |
| B 調整 9 | 園務文案改寫成官網說法（沒有學生檔、學費模組） | 第 10 節 |
| B 調整 10 | 畫面不放來源分類、帶參觀老師、娃娃車、地址分析同意 | 第 5.1 節、第 10 節訪視明細 |
| B 調整 11 | 明細用頁首的學年學期 | 第 10 節訪視明細 |
| B 調整 12 | 明細列操作分在 B2–B4 | 總覽「檔案配置」 |
| B 調整 13 | `errors.ts` 的備援文案 | 總覽「檔案配置」 |
| B 調整 14 | `RETENTION_CATEGORY_LABELS.admissions` 由 B6 核對 | 總覽「檔案配置」 |
| C 調整 1 | 統計型別別名在 C3、C3b、C4 加 | 總覽「檔案配置」、「介面」後台 API 模組 |
| C 調整 2 | `AdmissionsView.vue` 在 C3 改 `<StatsTab>` 一處 | 總覽「檔案配置」 |
| C 調整 3 | `StatsTab` 的 props 與事件 | 總覽「統計分頁」 |
| C 調整 4 | 警示與行動入口的 `target_tab`、`REVIEW_SOURCE` | 第 9.3 節；`contracts/ivy-recruitment/README.md` |
| C 調整 5 | `GET /compare` 的學年學期必填 | 第 13 節；總覽 API 表 |
| C 調整 6 | `StatsTab` 多 `campusKeys`、`go` 換成 `open-records` | 總覽「統計分頁」 |
| C 調整 7 | 統計切到訪視明細帶 `month`，用 `router.push` | 第 10 節（網址參數、統計分析） |
| C 調整 8 | 五校比較頁首沒選學年學期時用哪個學期 | 第 9.3 節；總覽「統計分頁」 |
| C 調整 9 | 同票排序加第二鍵 | 第 9.2 節；契約 README |
| C 調整 10 | 月比任一邊 null，差值也是 null | 第 9.2 節；契約 README |
| C 調整 11 | 統計回應只有數字；未預繳名單另由 `/no-deposit-records` 提供，含孩子姓名（2026-10-01 使用者裁定統計頁列名單） | 第 7 節、第 9.3 節、第 13 節；契約 README |
| C 調整 12 | 總覽另加「本範圍合計」，不做兩張圖與全管道彙整 | 第 9.3 節 |
| C 調整 13 | 參考月份格式錯 422 `INVALID_REFERENCE_MONTH` | 第 13 節；契約 README |
| C 調整 14 | R17 的「場次時間已過」用 psql 移本測試自建的場次 | 第 14 節 R17 |
| C 調整 15 | R16 的截圖與溢出檢查 | 第 14 節 R16 |
| C 調整 16 | 介紹者 × 來源交叉表放在接待分析 | 第 9.3 節 |
| C 調整 17 | 未預繳名單排序可重現：民國月份排序鍵降序、序號開頭數字升序 | 第 9.3 節；契約 README |
| C 調整 18 | 名單「查看」切到訪視明細並帶該筆月份（明細只吃 `month`、`vr`） | 第 10 節統計分析 |
| C 調整 19 | `NoDepositList` 介面；警示與行動入口的 `target_filter` 帶進名單；數字卡沿用 `/stats` | 第 9.3 節；總覽「統計分頁」 |
"""

if HEADING in text:
    print("第 17 節已存在，略過")
else:
    path.write_text(text.rstrip("\n") + "\n\n" + SECTION, encoding="utf-8")
    print("已新增第 17 節")
PY
grep -c '^| [ABC總]' docs/specs/2026-09-30-website-admissions-design.md
```

Expected：`已新增第 17 節`；最後一行是 `7＋A 條數＋B 列數＋19`。依 Step 2 的現況是 `84`（7＋30＋28＋19）；撰寫時的腳本只有 57 列，補齊 A 18–30、B 15–28 後才會到 84。

- [ ] **Step 5：回寫總覽（技術調整、檔案配置、介面、API 表、稽核代碼；31 處）**

總覽的「介面」一節是各 task 照著實作的介面；A／B／C 的調整改了介面的，都要回到這裡，日後接手的人才不會照舊介面寫。（腳本裡含一段 ts 程式碼區塊，所以外層用四個反引號。）

````bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path

path = Path("docs/superpowers/plans/2026-10-01-admissions.md")
text = path.read_text(encoding="utf-8")

STATS_SECTION = '''
### 統計分頁（C3、C3b、C4）

```ts
// admin/src/components/admissions/StatsTab.vue（B1 先放可運作的空狀態，C3 整檔覆寫）
defineProps<{ campusKey: string; schoolYear: number | null; semester: number | null; campusKeys: readonly string[] }>()
defineEmits<{ 'open-records': [filter: { month: string }] }>()
// AdmissionsView：@open-records → router.push({ query: { ...route.query, tab: 'records', month } })（上一頁回到統計）
// 子分頁 stats-overview／stats-class／stats-source／stats-staff／stats-nodeposit，campusKeys.length > 1 另有 stats-compare
// StatsOverview.vue：props { stats: AdmissionsStats }；emits navigate({ tab: 'records' | 'nodeposit' | 'source', filter })
// StatsDimensionTable.vue：props { title, rows, columns: StatsColumn[], rowKey, emptyText, numbered?, caption? }
// CompareTable.vue：props { rows: AdmissionsCompareRow[], schoolYear: number, semester: number }
// NoDepositList.vue（C3b，「未預繳原因」的未預繳明細，資料來自 GET /no-deposit-records）：
//   props { campusKey, schoolYear, semester, preset?: Record<string, string | number> | null }；emits open-records({ month })
// admin/src/admissions/statsFormat.ts：NO_VALUE、formatRate、ratio、formatPoints、trendOf、TREND_MARK、rateLevel、
//   barWidth、alertLevelLabel、priorityLabel、gradeColumns、StatsColumn、StatsTarget
```

- 警示與行動入口的 `target_tab`：`records`（切到訪視明細並帶 `month`）、`nodeposit`、`source`（切統計子分頁）；園務的 `AREA_OPPORTUNITY` 改成 `REVIEW_SOURCE`（C 計畫調整第 4 條）。
- 五校比較的學期：頁首沒選學年用目前學期；只選學年、是今年用目前學期，否則上學期；有沒選的就在表格上方寫明（C 計畫調整第 8 條）。
- 未預繳明細：「未預繳原因」子分頁 `lazy`，有未預繳才掛 `NoDepositList`；指向 `nodeposit` 的警示與行動入口把 `target_filter` 當 `preset` 傳下去；名單「查看」發 `open-records`，由 StatsTab 轉給頁面（C 計畫調整第 17–19 條）。
'''

# (出處, 原文, 新文字)。新文字已在檔內就略過（之前跑過）；否則原文必須剛好出現一次。
REPLACEMENTS = [
    ("C6 標記",
     '## 技術調整（本計畫為準，Task C6 回寫規格）',
     '## 技術調整（本計畫為準；C6 已回寫規格，對照表見規格第 17 節）'),
    ("B6 年級案例形狀",
     '6. 共用年級案例放在 `contracts/ivy-recruitment/grade-cases.json`，後端 pytest、web vitest、admin vitest 三邊都讀這份。',
     '6. 共用年級案例放在 `contracts/ivy-recruitment/grade-cases.json`，後端 pytest、web vitest、admin vitest 三邊都讀這份。形狀 `{"cases": [{"name", "birthday", "today", "expected_term": [學年, 學期], "expected_grade": 年級或 null}]}`，年級用 `expected_term` 的學年換算（A1 鎖定）。'),
    ("A15 保存政策",
     '符合條件：`anonymized_at IS NULL AND updated_at < now - admissions_days`。',
     '符合條件：`anonymized_at IS NULL AND updated_at < now - admissions_days`。另有 DB CHECK `ck_retention_policies_admissions_days`（NULL 或 30–3650）；更新請求沒帶這個鍵就不動它（`model_fields_set`）。'),
    ("A1 funnel.py 由 A3 先建",
     '| `funnel.py` | 階段推導、狀態轉換、權限對照、看板 | A4 |',
     '| `funnel.py` | 階段推導（A3 先建：`Stage`、`derive_stage`、`stage_condition`）、狀態轉換、權限對照、看板 | A3、A4 |'),
    ("A6 保存政策的 schema 位置",
     '- `backend/app/operations/{models,retention_service,routes,schemas}.py`（A7）：`admissions_days` 與報表類別。',
     '- `backend/app/operations/{models,retention_service,routes}.py`（A7）：`admissions_days` 與報表類別（保存政策的 schema 在 `routes.py`，沒有 `operations/schemas.py`）。'),
    ("A7 schema 測試檔",
     '  - `test_admissions_academic.py`（A1）、`test_admissions_records.py`（A3）、`test_admissions_funnel.py`（A4）',
     '  - `test_admissions_academic.py`（A1）、`test_admissions_schema.py`（A2：單一 head、約束建在 DB、CheckConstraint 字串與 model 一致、capability）、`test_admissions_records.py`（A3）、`test_admissions_funnel.py`（A4）'),
    ("C1／B8 types.ts",
     '| `api/types.ts` | 匯出招生 schema 型別別名 | B1 |',
     '| `api/types.ts` | 匯出招生 schema 型別別名 | A9（B1 核對）、C3（`AdmissionsStats`）、C4（`AdmissionsCompareRow`、`AdmissionsRate`） |'),
    ("B14 labels.ts",
     '| `api/labels.ts` | 稽核標籤（A 階段）、保存政策欄位標籤（A7） | A3–A7 |',
     '| `api/labels.ts` | 稽核標籤（A 階段）、保存政策欄位標籤（A7）；B6 核對 `RETENTION_CATEGORY_LABELS.admissions` | A3–A7、B6 |'),
    ("B1 academic.ts",
     '| `admissions/academic.ts` | `currentTerm`、`termLabel`、`gradeForBirthday`、`rocMonth` | B1 |',
     '| `admissions/academic.ts` | `taipeiToday`、`currentTerm`、`termLabel`、`gradeForBirthday`、`rocMonth`、`rocDate`、`schoolYearOptions`、型別 `Term` | B1 |'),
    ("B2 網址參數",
     '| `admissions/useAdmissionsFilters.ts` | 校區、學年、學期、分頁 ↔ URL query | B1 |',
     '| `admissions/useAdmissionsFilters.ts` | 校區、學年（`sy=all`＝不限學年）、學期、分頁、`vr`（某筆預約）↔ URL query；訪視明細的 `month` 由 B2 同步 | B1 |'),
    ("C2 AdmissionsView",
     '| `views/AdmissionsView.vue` | 頁首、篩選、五個分頁 | B1 |',
     '| `views/AdmissionsView.vue` | 頁首、篩選、五個分頁；C3 改 `<StatsTab>`（加 `campus-keys`，`@open-records` 切到訪視明細並帶 `month`） | B1、C3 |'),
    ("B12 明細列操作分階段",
     '| `components/admissions/RecordsTab.vue`、`RecordDialog.vue`、`EventsDrawer.vue` | 訪視明細 | B2 |',
     '| `components/admissions/RecordsTab.vue`、`RecordDialog.vue`、`EventsDrawer.vue` | 訪視明細（列操作「標記註冊」在 B3、「保留座位／變更座位」在 B4 補上） | B2–B4 |'),
    ("B3 StatsTab 先放空狀態",
     '| `components/admissions/StatsTab.vue`、`StatsOverview.vue`、`StatsDimensionTable.vue`、`CompareTable.vue` | 統計分析 | C3、C4 |',
     '| `components/admissions/StatsTab.vue`、`StatsOverview.vue`、`StatsDimensionTable.vue`、`CompareTable.vue` | 統計分析（`StatsTab.vue` 由 B1 先放可運作的空狀態，C3 整檔覆寫；另有 `admissions/statsFormat.ts`） | B1、C3、C4 |'),
    ("B4／B5／B13 測試共用檔、側欄圖示、錯誤碼",
     '| `router/index.ts`、`router/nav.ts`、`__tests__/fixtures.ts` | 路由、側欄、測試權限表 | B1 |',
     '| `router/index.ts`、`router/nav.ts`、`__tests__/fixtures.ts` | 路由、側欄、測試權限表 | B1 |\n| `components/AdminSidebar.vue` | 側欄圖示 `TrendCharts`（「參觀預約」組、「參觀場次」之後） | B1 |\n| `api/errors.ts` | `RECRUITMENT_VISIT_VERSION_CONFLICT`、`TRANSITION_NOT_ALLOWED` 的備援文案 | B1 |\n| `__tests__/admissionsTestKit.ts` | 招生測試共用：掛載、依路徑 mock `api`、假資料工廠（不是 `*.test.ts`） | B1 |'),
    ("A2 events passive_deletes",
     'cascade="all, delete-orphan", order_by=...created_at)`。',
     'cascade="all, delete-orphan", passive_deletes=True, order_by=...created_at)`（刪除交給 DB 的 `ON DELETE CASCADE`，async session 不能 lazy load 歷程）。'),
    ("A9 TourGuideNotFound",
     'class VersionConflict(Exception):\n    def __init__(self, current_version: int): ...',
     'class VersionConflict(Exception):\n    def __init__(self, current_version: int): ...\nclass TourGuideNotFound(Exception): ...     # tour_guide_user_id 指到不存在的帳號；路由轉 422 TOUR_GUIDE_INVALID'),
    ("A1 stage_of",
     'def stage_of(visit: RecruitmentVisit) -> str: ...           # 規格 6.2（定義在 funnel.py，records 從 funnel 匯入）',
     '# 不定義 stage_of：階段一律用 funnel.derive_stage(visit)（Python）與 funnel.stage_condition(stage)（SQL）；\n# RecruitmentVisitFilters.apply 在函式內匯入 stage_condition，避免 records ↔ funnel 循環匯入'),
    ("A3 write_event created_at",
     'actor_user_id, reason: str | None = None, metadata: dict | None = None) -> RecruitmentEventLog',
     'actor_user_id, reason: str | None = None, metadata: dict | None = None,\n                created_at: datetime | None = None) -> RecruitmentEventLog   # 一次寫兩筆事件時讓第二筆排在後面'),
    ("A1／A10 funnel 介面",
     'def derive_stage(visit) -> Stage\ndef transition_capability(from_stage: Stage, to_stage: Stage) -> str | None   # None＝不允許；否則 "admissions.write" 或 "admissions.convert"',
     'def derive_stage(visit) -> Stage                    # A3 先建\ndef stage_condition(stage: Stage)                   # A3 先建：列表 stage 篩選的 SQL 條件\ndef transition_capability(from_stage: Stage, to_stage: Stage) -> str | None   # None＝不允許；否則 "admissions.write" 或 "admissions.convert"\ndef not_allowed_reason(from_stage: Stage, to_stage: Stage) -> str   # 422 的中文說明；路由先比對 expected_version 再判斷權限'),
    ("A4 fields_from_visit_request slot_date",
     'def fields_from_visit_request(visit_request, *, today: date) -> dict   # 規格 6.1 的對應（純函式，截斷、補預設，不丟例外）',
     'def fields_from_visit_request(visit_request, *, today: date, slot_date: date | None = None) -> dict   # 規格 6.1 的對應（純函式，截斷、補預設，不丟例外；不碰 visit_request.slot，場次日期由 ensure_from_visit_request 用 history.load_slot 取來傳入）'),
    ("A5 arrivals now",
     'async def arrivals(db, campus_key: str) -> dict',
     'async def arrivals(db, campus_key: str, *, now: datetime | None = None) -> dict'),
    ("A5 eligible_count now",
     'async def eligible_count(db, days: int | None) -> int',
     'async def eligible_count(db, days: int | None, *, now: datetime | None = None) -> int'),
    ("A5 anonymize_due now",
     'async def anonymize_due(db, days: int | None) -> int       # days 為 None 時回 0，不動資料',
     'async def anonymize_due(db, days: int | None, *, now: datetime | None = None) -> int       # days 為 None 時回 0，不動資料'),
    ("A17 options",
     '| GET `/admin/admissions/options` | admissions.read | `campus_key` | `AdmissionsOptionsOut` | A3 |',
     '| GET `/admin/admissions/options` | admissions.read | `campus_key` | `AdmissionsOptionsOut`（`source_categories` 是「代碼 → 園務文案」的 dict） | A3 |'),
    ("A13 補建錯誤碼",
     '| POST `/admin/admissions/from-visit-request/{visit_request_id}` | admissions.write＋booking.read | — | `RecruitmentVisitOut` | A6 |',
     '| POST `/admin/admissions/from-visit-request/{visit_request_id}` | admissions.write＋booking.read | — | `RecruitmentVisitOut`；非 `completed` 409 `VISIT_REQUEST_NOT_COMPLETED`、已匿名化 409 `VISIT_REQUEST_ANONYMIZED` | A6 |'),
    ("C5 compare 參數必填",
     '| GET `/admin/admissions/compare` | admissions.read | `school_year`、`semester` | `list[AdmissionsCompareRow]` | C2 |',
     '| GET `/admin/admissions/compare` | admissions.read | `school_year`、`semester`（兩者必填） | `list[AdmissionsCompareRow]` | C2 |'),
    ("A8／A12 狀態與座位 schema",
     '- 狀態與座位：`TransitionRequest`、`SeatRequest`、`SeatOut`、`FunnelBoardOut`、`FunnelCardOut`',
     '- 狀態與座位：`TransitionRequest`、`SeatRequest`、`SeatOut`（`{visit, capacity_warning, warning_code}`，超額時 `warning_code="SEAT_CAPACITY_WARNING"`）、`FunnelBoardOut`、`FunnelColumnsOut`（四欄各 `list[FunnelCardOut]`，`FunnelBoardOut.columns` 用它，TS 才不是索引簽章）、`FunnelCardOut`'),
    ("B7／A11 後台依賴的欄位",
     '- 其他：`ArrivalsOut`、`ArrivalRowOut`、`AdmissionsOptionsOut`、`AdmissionsStatsOut`、`AdmissionsCompareRow`',
     '- 其他：`ArrivalsOut`、`ArrivalRowOut`、`AdmissionsOptionsOut`、`AdmissionsStatsOut`、`AdmissionsCompareRow`、`AdmissionsRate`\n- 建立、編輯、狀態轉換、座位、名額的 request schema 一律 `extra="forbid"`（送狀態欄位得到標準 422）。\n- 後台依賴的欄位：`SeatOut.capacity_warning: bool`；`IntakeTargetsRequest = {school_year, semester, targets: {年級: int | null}}`（null＝刪除該年級計畫，回到「未設定」）；`TransitionRequest = {to_stage, expected_version, reason, deposit_collector, enrolled_on, grade, target_school_year, target_semester}`（後六個可為 null）；`SeatRequest = {grade（null＝釋放）, target_school_year, target_semester, expected_version}`；`RecruitmentEventOut = {id, event_type, from_stage, to_stage, reason, metadata_json, created_at}`；`AdmissionsOptionsOut` 至少有 `months`、`sources`、`referrers`。'),
    ("A14 labels.ts 同名 metadata 鍵",
     '`AUDIT_FIELD_LABELS` 加 `admissions_days: \'招生訪視保留\'`（A7）。',
     '`AUDIT_FIELD_LABELS` 加 `admissions_days: \'招生訪視保留\'`（A7）。\n\n`labels.ts` 既有的 metadata 鍵 `created`（時段產生的「新增 N 場」）、`fields`（素材欄位）與招生同名：翻譯改成依 action 分開，`action.startsWith(\'recruitment_visit.\')` 走招生的寫法（A3 起）。'),
    ("B8 型別別名",
     '型別在 `admin/src/api/types.ts` 以 `components[\'schemas\'][\'RecruitmentVisitOut\']` 等別名匯出，名稱去掉 `Out`。',
     '型別在 `admin/src/api/types.ts` 以 `components[\'schemas\'][\'RecruitmentVisitOut\']` 等別名匯出，名稱去掉 `Out`（`FunnelCard`、`IntakePlanRow`、`ArrivalRow`；`SeatOut` 的別名是 `SeatResult`）。A9 加訪視與名額的別名；統計的 `AdmissionsStats`（C3）、`NoDepositRecords`、`NoDepositRecord`（C3b）、`AdmissionsCompareRow`、`AdmissionsRate`（C4）在 C1／C2b／C2 進 OpenAPI 之後才加。'),
    ("C3 統計分頁介面",
     '\n## Review Focus\n',
     STATS_SECTION + '\n## Review Focus\n'),
]

changed = 0
for label, old, new in REPLACEMENTS:
    if new in text:
        print(f"已回寫，略過：{label}")
        continue
    count = text.count(old)
    assert count == 1, f"{label}：原文出現 {count} 次，先對照總覽現況再改腳本"
    text = text.replace(old, new)
    changed += 1
path.write_text(text, encoding="utf-8")
print(f"總覽：{changed} 處已回寫，共 {len(REPLACEMENTS)} 處")
PY
````

Expected：最後一行 `總覽：31 處已回寫，共 31 處`。`AssertionError` 的處理同 Step 3。

- [ ] **Step 6：契約 README 的「統計與園務的差異」**

A8 建的 `contracts/ivy-recruitment/README.md` 若已有「## 統計與園務的差異」，只補還沒寫的條目（用每條的辨識字串判斷）；沒有這一節就整節加在檔尾。新增的是 C1 的同票排序第二鍵、警示 `target_tab`／`REVIEW_SOURCE`，以及統計其餘的刻意差異。

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path
import re

path = Path("contracts/ivy-recruitment/README.md")
text = path.read_text(encoding="utf-8")
HEADING = "## 統計與園務的差異"

# (辨識字串, 條目)。辨識字串已在該節裡就不再加（A8 寫過的、或重跑）。
BULLETS = [
    ("分母 0 回 `null`",
     "- 比率分母 0 回 `null`（園務回 0），畫面寫「—」。五校比較的比率另附分子分母。"),
    ("差值也是 `null`",
     "- 月比任一邊是 `null`，差值也是 `null`，不判定「本月漏斗轉換下滑」（園務算成 100.0－0，上月沒資料就會誤報）。"),
    ("第二鍵「標籤字串升序",
     "- 同票排序：園務的班別、接待人員、介紹者 × 來源、未預繳原因只有單鍵降序，同票順序看資料庫；官網一律加第二鍵「標籤字串升序（Python 字碼順序）」。來源分析照園務三鍵（參觀降、預繳降、來源升）。來源失衡同占比時取標籤升序的第一個（園務取 SQL 回傳順序）。"),
    ("`REVIEW_SOURCE`",
     "- 警示與行動入口的 `target_tab`：官網是 `records`（`target_filter.month`）／`nodeposit`／`source`，園務是 `detail`／`nodeposit`／`area`。行動入口「查看區域機會」（`AREA_OPPORTUNITY`）改成「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現：官網不做行政區（`district` 不填），照抄的話園務會寫出「優先檢查 未填寫 的來源分布與通勤熱區。」。"),
    ("`_SOURCE_GROUP_ALIASES`",
     "- 來源不做別名合併：園務 `_SOURCE_GROUP_ALIASES` 是義華專屬字詞，官網依原文分組。"),
    ("`/no-deposit-analysis`",
     "- 未預繳：`/stats` 只回分布與數字（`no_deposit_reasons`、`no_deposit_priority`、`no_deposit_summary`）；名單是 `GET /no-deposit-records`（對應園務 `/no-deposit-analysis`），query 與 `summary` 口徑照抄，另篩入學學年學期，每列只回畫面要的欄位（不含電話、地址、生日）。排序：園務 `ORDER BY month DESC, seq_no` 是字串排序（同月「10」排在「2」前面），官網改成民國月份排序鍵降序、序號開頭數字升序，再以 `created_at`、`id` 收尾。母體同園務：未預繳且未退出。"),
    ("`INVALID_REFERENCE_MONTH`",
     "- 參考月份格式錯回 422 `INVALID_REFERENCE_MONTH`（訊息照園務原文）；園務是未處理的 `ValueError`。"),
    ("`GET /compare`",
     "- 五校比較（`GET /compare`）是官網延伸，數字是招生案件數；併入後對應園務平台層的跨租戶報表。"),
]

match = re.search(r"^## 統計與園務的差異[^\n]*\n", text, flags=re.M)
if match:
    nxt = re.search(r"^## ", text[match.end():], flags=re.M)
    end = match.end() + (nxt.start() if nxt else len(text) - match.end())
    section = text[match.start():end]
    missing = [line for key, line in BULLETS if key not in section]
    if missing:
        body = section.rstrip("\n") + "\n" + "\n".join(missing) + "\n"
        text = text[:match.start()] + body + ("\n" if nxt else "") + text[end:]
    print(f"既有一節，補 {len(missing)} 條")
else:
    text = text.rstrip("\n") + "\n\n" + HEADING + "\n\n" + "\n".join(line for _, line in BULLETS) + "\n"
    print(f"新增一節，{len(BULLETS)} 條")
path.write_text(text, encoding="utf-8")
PY
sed -n '/^## 統計與園務的差異/,/^## /p' contracts/ivy-recruitment/README.md
```

Expected：印出「既有一節，補 N 條」或「新增一節，8 條」，再印出整節。用眼睛看一遍：A8 原本若已用別的說法寫過同一件事（例如分母 0），刪掉腳本新加的那一條，只留一條。

- [ ] **Step 7：驗收紀錄 `docs/website-admin/acceptance.md`「招生入學」段落（R01–R17）**

A9 可能已建了「## 招生入學…」段落（只有 A 的項目）；這一步整段換成 R01–R17 的完整表。**只有 Step 1 的閘門全綠才跑**；哪一項沒過，就把那一列的「通過」改成「未通過」並在證據欄寫失敗的測試名，不要寫通過。

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path
import re

path = Path("docs/website-admin/acceptance.md")
text = path.read_text(encoding="utf-8")

SECTION = """## 招生入學（2026-10-01 實作，尚未部署）

規格 `docs/specs/2026-09-30-website-admissions-design.md` 第 14 節 R01–R17；計畫 `docs/superpowers/plans/2026-10-01-admissions*.md`（A 後端、B 後台、C 統計與 e2e）。後端測試在隔離測試庫 `ivy_website_test_admissions`（先 `alembic upgrade head`），stack e2e 用 `E2E_DB_NAME=ivy_website_e2e_test_admissions`。上線前要先過規格 Q1（同意書與保存天數），見 `deploy/README.md`「招生入學（未部署，草稿）」。

| ID | 案例 | 狀態 | 證據 |
|---|---|---|---|
| R01 | 從明細或官網預約分頁標記已到場；重複標記或補建只一筆；取消、未到場不建 | 通過 | `backend/tests/test_admissions_booking_link.py`；stack `tests/stack/admissions-flow.spec.ts`（官網預約分頁按已到場） |
| R01a | 官網預約待確認清單的邊界（剛開始、已到場、未到場、已取消、他校、停止申請、沒有場次） | 通過 | `test_admissions_booking_link.py`（與 `status_groups.group_condition('past')` 去掉已到場、未到場比對） |
| R02 | 手動新增缺必填、年級或代碼不合法 | 通過 | `test_admissions_records.py`（422 指到欄位） |
| R03 | 同校同月並行新增 | 通過 | `test_admissions_records.py`（序號不重複） |
| R04 | 第 6.3 節每種轉換與不允許的組合 | 通過 | `test_admissions_funnel.py`（欄位、事件、權限；不允許的 422 `TRANSITION_NOT_ALLOWED`） |
| R05 | 兩人同時轉換或編輯 | 通過 | `test_admissions_funnel.py::test_concurrent_transition_conflict`；後台 `admissionsFunnel.test.ts`「409 時重載並還原卡片」 |
| R06 | reception 標記註冊或退註冊；editor／readonly 讀招生 API | 通過 | 各 `test_admissions_*.py` 的權限測試（403）；`test_admissions_stats.py::test_stats_permissions` |
| R07 | 分校帳號以校區、訪視 id、預約 id 存取他校 | 通過 | 各 `test_admissions_*.py` 的越權測試（404）；`test_compare_endpoint_scope` |
| R08 | 保留座位：未預繳、未給學年、超額 | 通過 | `test_admissions_intake.py`（前兩者拒絕、超額只警示） |
| R09 | 名額：已保留、已註冊、退出、轉學期、未設定；已註冊清除保留 | 通過 | `test_admissions_intake.py`（含 `test_cancel_withdraw_restores_reserved_seat`）；後台 `admissionsIntake.test.ts`「未設定與 0 分開顯示」 |
| R10 | 統計合成資料，含分母 0 | 通過 | `test_admissions_stats.py`（`test_stats_matches_ivy_semantics` 逐項手算、`test_stats_empty_campus`、`test_compare_*`）；後台 `statsTab.test.ts`、`compareTable.test.ts`（null 寫「—」、「未設定」） |
| R11 | 近 30／90 天在台北午夜邊界；參考月份與上月 | 通過 | `test_rolling_windows_cut_at_exact_instant_across_taipei_midnight`、`test_reference_month_previous_month_and_ytd_cross_year` |
| R12 | 年級換算共用案例 | 通過 | `test_admissions_academic.py`、`web/tests/admission-grade-cases.spec.ts`、`admin/src/__tests__/admissionsAcademic.test.ts`（同一份 `contracts/ivy-recruitment/grade-cases.json`） |
| R13 | 匯出程式契約測試 | 通過 | `test_admissions_contract.py` |
| R14 | 保存政策試算與執行 | 通過 | `test_admissions_retention.py`（只清規格第 11 節欄位、統計不變、預約匿名化不連動） |
| R15 | 看板拖曳與「移到…」、確認框、409 重載、快速切換校區、網址還原 | 通過 | 後台 `admissionsView.test.ts`、`admissionsFunnel.test.ts`、`statsTab.test.ts`「快速切換校區只顯示最後一次」；stack `admissions-flow.spec.ts` 在真瀏覽器用「移到…」完成預繳與註冊 |
| R16 | 1440 桌機、390 手機 | 通過 | stack `admissions-flow.spec.ts`（五個分頁＋五校比較兩種寬度截圖，存 `output/playwright/admissions-*.png`，逐頁檢查不橫向溢出）、`keyboard.spec.ts`、`a11y.spec.ts`（招生頁五個分頁沒有 serious／critical） |
| R17 | stack e2e：自選場次預約成功 → 時間過後出現在官網預約 → 已到場 → 看板已訪視 → 預繳 → 註冊 → 名額已註冊 | 通過 | `tests/stack/admissions-flow.spec.ts`（場次時間已過用 psql 移本測試自建的場次，`tests/stack/db.ts`） |

**未驗證**：Safari／iOS 實機；看板的 HTML5 原生拖曳只在單元測試以事件模擬，真瀏覽器 e2e 走的是「移到…」；正式庫 migration 與真實資料量下的統計速度。
"""

match = re.search(r"^## 招生入學[^\n]*\n", text, flags=re.M)
if match:
    nxt = re.search(r"^## ", text[match.end():], flags=re.M)
    end = match.end() + nxt.start() if nxt else len(text)
    text = text[:match.start()] + SECTION + ("\n" + text[end:] if nxt else "")
    print("已取代既有的「招生入學」段落")
else:
    text = text.rstrip("\n") + "\n\n" + SECTION
    print("已新增「招生入學」段落")
path.write_text(text, encoding="utf-8")
PY
grep -c '^| R' docs/website-admin/acceptance.md
```

Expected：印出「已新增」或「已取代既有的」「招生入學」段落；最後一行至少 `18`（R01–R17 加 R01a；檔內其他段落沒有以 `| R` 開頭的列）。段落最後一句「未驗證」照實保留。

- [ ] **Step 8：DESIGN.md 新章節、CLAUDE.md 一行、deploy/README.md 草稿**

- `DESIGN.md`：檔尾新增「## 招生入學（2026-10-01）」（家長自選場次那一章之後），寫畫面規則與不做的事。
- `CLAUDE.md`：「現況容易搞錯的事」最後一行（只有義華有 LINE／FB…）之後加一行。
- `deploy/README.md`：檔尾新增「## 招生入學（未部署，草稿）」，含 migration `4a7e2c9d1b63` 與上線前規格 Q1 閘門；**不寫「已部署」**。

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path

root = Path(".")

DESIGN = """## 招生入學（2026-10-01）

後台參觀後的招生追蹤，比照園務系統「招生入學」。規格 `docs/specs/2026-09-30-website-admissions-design.md`；與園務刻意不同的地方記在 `contracts/ivy-recruitment/README.md`。

- **頁面**：側欄「參觀預約」組、「參觀場次」之後，圖示 TrendCharts；頁首說明「參觀 → 預繳 → 註冊 ｜ 退預繳／退註冊 · 統計分析」。分頁順序同園務：漏斗看板、訪視明細、名額規劃、官網預約（園務叫「官網報名」）、統計分析。校區、入學學年（`sy=all` 不限）、學期、分頁、`vr`（某筆預約）、`month`（明細月份）都寫在網址，重新整理不變。
- **四欄**：已訪視（`--ink-3`）→ 已預繳（`--el-color-warning`）→ 已註冊（`--el-color-success`）→ 退預繳／退註冊（`--admin-accent`），各欄空狀態用園務原文。所有轉換都跳確認框，標題「起 → 迄」；退出與從已註冊往回要填原因。拖曳之外一定有卡片選單「移到…」（鍵盤可完成）。兩人同時拖同一張卡，後送者看到「狀態已被其他人變更，已自動重新載入」，卡片回到伺服器的位置。
- **官網沒有學生檔與學費模組**：園務提到學生檔、監護人、學號、學費管理、班級的文案都改寫；「轉為學生」改叫「標記註冊」，填註冊日期、年級、入學學年學期。
- **名額**：沒有計畫名額寫「未設定」、剩餘寫「—」，和「計畫 0」分開；超額只警示、不阻擋。
- **統計**：比率分母 0 寫「—」不寫 0；沒有資料時寫原因（「義華在 115 上學期還沒有招生訪視。…」），不顯示假的 0。圖一律是表格＋CSS 長條（填色 `--el-color-primary`、底 `--surface-3`），不裝圖表套件；數字一定寫出來，長條只是輔助。表格在框內橫捲、第一欄固定，頁面不被撐寬。警示等級：高（danger）、中（warning）、低（info）；決策摘要的比率上色門檻同園務：60 以上綠、30 以上金、其餘紅，沒有比率灰。
- **未預繳原因**：三張數字卡、優先度與原因分布用 `/stats` 的數字；下方「未預繳明細」名單（2026-10-01 使用者裁定要列）照園務篩選與表頭，預設「高潛力優先」，轉換潛力 tag 高 danger／中 warning／低 info、冷名單 tag「冷」；名單只回追蹤要用的欄位（不含電話、地址、生日），每列「查看」切到訪視明細並篩該筆的月份。
- **五校比較**（看得到兩校以上才有）：寫明數字是「招生案件數」（同一個孩子在兩校各參觀一次算兩筆）；比率括號附分子／分母；名額剩餘只加總有設定的年級，負數標「超額」；頁首沒選學期時寫明用的是哪個學期。
- **不做**：區域分析、全管道彙整、統計 Excel 匯出、樣本數提示、來源別名合併；來源分類、帶參觀老師、娃娃車、地址分析同意不上畫面（欄位照存、照匯出）。
"""

CLAUDE_ANCHOR = "- 只有義華有 LINE／FB，其他四校留待補，**不能拿義華的代填**。\n"
CLAUDE_LINE = "- 後台「招生入學」（`/admin/admissions`，2026-10-01，未部署）比照園務招生：預約標記「已到場」在同一交易建立招生訪視；表名沿用園務，`campus_key` 不是 tenant_id；統計比率分母 0 回 `null`（畫面「—」），與園務刻意不同之處記在 `contracts/ivy-recruitment/README.md`。上線前要先過規格 Q1（同意書與保存天數）。\n"

DEPLOY = """## 招生入學（未部署，草稿）

`feature/admissions-20261001`（疊在 `feature/parent-self-booking-20260930` 上）：後台「招生入學」。**尚未 push、尚未部署**；家長自選場次改版要先上線或一起上線，何時合併由使用者決定（push main＝正式部署）。規格 `docs/specs/2026-09-30-website-admissions-design.md`。

上線前：
1. **規格 Q1 閘門（必須先裁定）**：官網預約同意書是否涵蓋「參觀後的招生聯繫與紀錄」，以及招生訪視保存幾天。沒裁定前不上線，只在本機與測試環境使用；同意文字建議跟上一節第 3 點同一次改。
2. **Migration `4a7e2c9d1b63`**：接在 `c7d2e9f4a1b8`（家長自選場次）之後；只新建 `recruitment_visits`、`recruitment_event_log`、`grade_intake_targets` 三張表，並加 `retention_policies.admissions_days`（可為 NULL、不回填）。不改寫既有資料，依 `deploy/CICD.md` 不強制先備份；和自選場次一起上線時，那一支改寫資料的 migration 仍要先備份（上一節第 4 點）。合併前 rebase 到 main、重跑 `npm run contract:generate`，並用 `alembic heads` 確認只有一個 head。
3. **權限**：新增 `admissions.read／write／convert`，預設總管理者、分校管理者全有，接待人員有 read／write（規格 Q2 未回覆照預設）；內容編輯、唯讀沒有。不用改任何帳號。
4. **保存政策**：「招生訪視」天數預設空白（不自動清理）；業主裁定天數後由總管理者在「保存政策」設定。
5. **舊的已到場預約不會自動補建**：上線後如需要，到「招生入學 → 官網預約」下方「已到場但沒有招生訪視」逐筆按「建立招生訪視」。

上線後唯讀檢查：`/api/website/v1/health` 200；總管理者開 `/admin/admissions?tab=stats`，沒有資料時寫原因、不報錯；`GET /api/website/v1/admin/admissions/compare?school_year=115&semester=1`（115 學年上學期上線時；其他學期換成當時的學年學期）回五列。

**本節只是草稿，部署後才補「已部署」紀錄。**
"""

design = root / "DESIGN.md"
text = design.read_text(encoding="utf-8")
if "## 招生入學（2026-10-01）" in text:
    print("DESIGN.md 已有，略過")
else:
    design.write_text(text.rstrip("\n") + "\n\n" + DESIGN, encoding="utf-8")
    print("DESIGN.md 已新增章節")

claude = root / "CLAUDE.md"
text = claude.read_text(encoding="utf-8")
if CLAUDE_LINE in text:
    print("CLAUDE.md 已有，略過")
else:
    assert text.count(CLAUDE_ANCHOR) == 1, "CLAUDE.md 找不到「只有義華有 LINE／FB」那一行"
    claude.write_text(text.replace(CLAUDE_ANCHOR, CLAUDE_ANCHOR + CLAUDE_LINE), encoding="utf-8")
    print("CLAUDE.md 已加一行")

deploy = root / "deploy/README.md"
text = deploy.read_text(encoding="utf-8")
if "## 招生入學（未部署，草稿）" in text:
    print("deploy/README.md 已有，略過")
else:
    deploy.write_text(text.rstrip("\n") + "\n\n" + DEPLOY, encoding="utf-8")
    print("deploy/README.md 已新增草稿")
PY
```

Expected：三行都是「已新增／已加一行」。`CLAUDE.md 找不到…` 的 AssertionError＝那一行被改過：在「## 現況容易搞錯的事」那一節的最後一條之後手動加同一句，不要改其他行。

- [ ] **Step 9：README.md 頂部日期段落**

驗證那一句的數字由腳本從 Step 1 的 log 抓（`output/admissions-c6/*.log`），不手抄、不寫沒跑過的結果。

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
python3 - <<'PY'
from pathlib import Path
import re

path = Path("README.md")
LOGS = Path("output/admissions-c6")


def summary(name: str, pattern: str) -> str:
    """從 Step 1 的 log 抓結果行（最後一個符合的行）；找不到就中止，不寫沒跑過的數字。"""
    lines = [line.strip() for line in (LOGS / name).read_text(encoding="utf-8").splitlines() if re.search(pattern, line)]
    assert lines, f"{LOGS / name} 找不到結果行，先跑 Step 1"
    return lines[-1]


RESULTS = {
    "backend": summary("backend.log", r"\d+ passed"),
    "admin": summary("admin.log", r"^\s*Tests\s+.*passed"),
    "web": summary("web.log", r"^\s*Tests\s+.*passed"),
    "stack": "，".join(
        line.strip()
        for line in (LOGS / "stack.log").read_text(encoding="utf-8").splitlines()
        if re.search(r"^\s*\d+ (passed|failed|flaky)", line)
    ),
}
assert RESULTS["stack"], "stack.log 找不到結果行，先跑 Step 1"
media = LOGS / "stack-media.log"
if media.exists():
    media_result = summary("stack-media.log", r"^\s*\d+ passed")
    RESULTS["stack"] += "；`media.spec.ts` 單獨重跑：" + media_result

HEADING = "## 2026-10-01 招生入學模組（`feature/admissions-20261001`，尚未 push、未部署）"
ENTRY = f"""{HEADING}

比照園務系統「招生入學」，在官網後台加參觀後的招生追蹤：已訪視 → 已預繳 → 已註冊 ｜ 退預繳／退註冊、名額規劃、統計分析與五校比較。三張表沿用園務名稱（`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`），併入園務時可整批轉移。規格 `docs/specs/2026-09-30-website-admissions-design.md`（第 17 節是計畫回寫對照），計畫 `docs/superpowers/plans/2026-10-01-admissions*.md`，規則見 DESIGN.md「招生入學（2026-10-01）」。分支疊在家長自選場次改版（`feature/parent-self-booking-20260930`）上。

- **後端（階段 A）**：migration `4a7e2c9d1b63`（接 `c7d2e9f4a1b8`，三張新表＋`retention_policies.admissions_days`，只新增、不改寫既有資料）；訪視 CRUD、狀態轉換（不允許的 422、版本衝突 409）、保留座位與名額；預約標記「已到場」時在同一個交易建立招生訪視，時間已過還沒確認的預約列成待辦；保存政策新類別（預設不自動清理）；轉移契約 `contracts/ivy-recruitment/`、匯出程式與契約測試。
- **後台（階段 B）**：「招生入學」頁五個分頁（漏斗看板、訪視明細、名額規劃、官網預約、統計分析），篩選與分頁同步網址；看板可拖曳，也能用卡片選單「移到…」；預約明細的「標記已到場」加確認框並連到招生訪視；保存政策頁多「招生訪視」天數。
- **統計與驗收（階段 C）**：移植園務 `_query_stats`（KPI、四個比率、月度、年度、班別、來源、接待、未預繳原因、主管決策摘要、月比、警示、行動入口）與五校比較；分母 0 回 `null`、畫面寫「—」；「未預繳原因」列未預繳明細（`/no-deposit-records`，含孩子姓名，不含電話、地址、生日）。stack e2e 跑通「家長自選場次 → 時間過後出現在官網預約 → 已到場 → 看板 → 預繳 → 註冊 → 名額已註冊」；1440／390 截圖在 `output/playwright/admissions-*.png`。
- 刻意與園務不同、併入時要決定的：`contracts/ivy-recruitment/README.md` 的差異清單（分母 0、月比、同票排序、來源不合併、警示指向、未預繳名單的排序與欄位等）。

驗證（實際跑過）：backend pytest 全套（`ivy_website_test_admissions`，先 `alembic upgrade head`；{RESULTS['backend']}）；`npm run contract:check` 無差異；admin typecheck、vitest（{RESULTS['admin']}）；web vitest（{RESULTS['web']}）；production build 的 stack e2e 全套（`E2E_DB_NAME=ivy_website_e2e_test_admissions`；{RESULTS['stack']}）。

**未驗證**：Safari／iOS 實機；看板的原生拖曳只在單元測試以事件模擬（e2e 走「移到…」）；正式庫 migration 與真實資料量下的統計速度。**上線前必須裁定**規格 Q1（預約同意書是否涵蓋參觀後的招生聯繫與紀錄、招生訪視保存天數），在那之前只在本機與測試環境使用。上線步驟草稿在 `deploy/README.md`「招生入學（未部署，草稿）」。

"""

text = path.read_text(encoding="utf-8")
if HEADING in text:
    print("README.md 已有這一段，略過")
else:
    path.write_text(ENTRY + text, encoding="utf-8")
    print("README.md 頂部已加一段")
PY
sed -n 1,12p README.md
```

Expected：`README.md 頂部已加一段`，印出的段落裡「驗證（實際跑過）」四個括號都是 log 裡的結果行。`找不到結果行` 的 AssertionError＝Step 1 那一項沒跑或沒存 log，回去跑。

- [ ] **Step 10：自我檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git status --short
git diff --stat -- README.md DESIGN.md CLAUDE.md deploy/README.md docs/website-admin/acceptance.md \
  docs/specs/2026-09-30-website-admissions-design.md contracts/ivy-recruitment/README.md
grep -n "VERSION_CONFLICT\|TRANSITION_NOT_ALLOWED\|INVALID_REFERENCE_MONTH\|REVIEW_SOURCE" docs/specs/2026-09-30-website-admissions-design.md
grep -n "已部署" deploy/README.md | tail -3
npm run contract:check
```

Expected：
- `git status` 只多出本 task 列的檔案（加上 A–C 前面各 task 已改的），沒有 `output/` 底下的東西。
- 規格裡 409 的碼只剩 `RECRUITMENT_VISIT_VERSION_CONFLICT`（沒有單獨的 `` `VERSION_CONFLICT` ``）；其他三個碼各至少一行。
- `deploy/README.md` 的招生一節沒有寫「已部署」（最後一個「已部署」出現在別的章節）。
- `contract:check` 無差異（這個 task 只動文件）。

再用 Read 看一次規格第 6.3、9.2、9.3、10、13、14、17 節與總覽「介面」：回寫後的句子讀起來通順、沒有重複的句子；有的話就地刪掉重複的那一句（只改文字，不改意思）。

- [ ] **Step 11：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add README.md DESIGN.md CLAUDE.md deploy/README.md docs/website-admin/acceptance.md \
  docs/specs/2026-09-30-website-admissions-design.md docs/superpowers/plans/2026-10-01-admissions.md \
  contracts/ivy-recruitment/README.md
git commit -m "docs(admissions): 招生入學驗收紀錄、規則與上線草稿，計畫調整回寫規格與總覽

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

規格與總覽若還沒進版控（開工時是未追蹤檔），這一次一起加入；A／B／C 三份階段計畫要不要提交由使用者決定，不在這個 commit。**不 push、不部署。**

---

## 階段 C 完成後回報

列出：C1–C6（含 C2b、C3b）完成的 task 與 commit（若有授權）；Step 1 六個指令的結果行（`output/admissions-c6/*.log`）；截圖路徑 `output/playwright/admissions-*.png`；C5 Step 1 核對出的 B 文案差異；未驗證項（Safari／iOS、原生拖曳只在單元測試、正式 migration）；上線前使用者要做的事（規格 Q1、`deploy/README.md`「招生入學（未部署，草稿）」）。
