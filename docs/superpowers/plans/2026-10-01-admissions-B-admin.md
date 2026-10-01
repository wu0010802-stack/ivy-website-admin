# 官網招生入學模組 Implementation Plan — 階段 B：後台畫面

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後台新增「招生入學」頁（`/admissions`）：漏斗看板、訪視明細、名額規劃、官網預約、統計分析五個分頁（統計先放可運作的空狀態，C3 取代），預約明細的「標記已到場」加確認框並連到招生訪視，保存政策加「招生訪視」天數。文案與規則比照園務招生入學。

**Architecture:** 純邏輯放 `admin/src/admissions/`（階段與事件文案、學年學期換算、篩選與網址同步），API 呼叫集中在 `admin/src/api/admissions.ts`（只包 `api` 物件，型別取自 A9 產生的 `api/types.ts` 別名），畫面拆成 `components/admissions/*` 各分頁元件，由 `views/AdmissionsView.vue` 依 `tab` 只掛載目前分頁。每個分頁元件自己讀資料、用 `useRequestSequence` 擋舊回應；權限一律 `usePermissions().can(...)`。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Pinia、Vue Router、Element Plus 2.14、vitest 4＋@vue/test-utils＋jsdom。不新增 npm 套件（拖曳用原生 HTML5 drag and drop）。

**Spec:** `docs/specs/2026-09-30-website-admissions-design.md` 第 6.1、6.3、6.5、10、11 節。

**先讀：** 總覽 `docs/superpowers/plans/2026-10-01-admissions.md` 的「工作環境」「Global Constraints」「技術調整」「介面」（API 表、`admin/src/api/admissions.ts` 簽章、Schema 名稱）「Review Focus」。

**前置：** 階段 A 閘門已過；A9 已跑 `npm run contract:generate`，`admin/src/api/types.ts` 已有招生型別別名（見 Task B1 Step 1 的核對清單）。

**本階段閘門（全部通過才進 C）：**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm --prefix admin run typecheck
npm --prefix admin run test:unit -- --maxWorkers=2
```

## Global Constraints

見總覽「Global Constraints」。本階段另外：

1. 只改 `admin/`，不動 `backend/`、`web/`、`contracts/`。後端回應形狀以 A9 產生的 `contracts/generated/website-api.d.ts` 為準；發現跟本計畫假設的欄位不同（見「對總覽的調整」第 7 條），以產生檔為準修正呼叫端並回報，不要回頭改後端。
2. 測試只 mock `api` 物件（`vi.spyOn(api, 'get' | 'post' | 'patch' | 'put' | 'delete')`，依路徑前綴回資料），不 mock `fetch`、不 spy ES module 命名空間。每支測試檔用 `admissionsTestKit.ts` 的 `mountWith()` 掛載（memory router＋Pinia＋Element Plus）。subagent 一次只跑一支測試檔：`cd admin && npx vitest run src/__tests__/<檔名>`。
3. `<style scoped>` 只用 `admin/src/style.css` 既有的 token（`--ink*`、`--line*`、`--surface*`、`--el-color-*`、`--admin-accent*`、`--brand-gold*`、`--status-live*`），不寫 hex／rgb／oklch 字面值；手機斷點 `@media (max-width: 720px)`。每個 `<el-switch>` 都要有 `aria-label`（`a11yStructure.test.ts` 會掃）。

## Review Focus（本階段負責）

- **Review Focus 3「兩人同時在看板拖同一張卡」的前端半邊**：後送者收到 409 → 顯示「狀態已被其他人變更，已自動重新載入」→ 重讀看板，卡片落在伺服器回傳的欄（不是使用者拖到的欄）。測試：B3 `admissionsFunnel.test.ts`「409 時重載並還原卡片」。
- **Review Focus 2 的前端半邊**：`currentTerm()` 在 7/31、8/1、1/31、2/1 的邊界與後端一致，年級換算讀同一份 `contracts/ivy-recruitment/grade-cases.json`。測試：B1 `admissionsAcademic.test.ts`。
- **Review Focus 5 的前端半邊（名額）**：沒設計畫名額的年級顯示「未設定」、剩餘顯示「—」，不顯示 0。測試：B4 `admissionsIntake.test.ts`「未設定與 0 分開顯示」。

## 對總覽的調整

| # | 原本 | 改成 | 理由 |
|---|---|---|---|
| 1 | `admissions/academic.ts` 只列 `currentTerm`、`termLabel`、`gradeForBirthday`、`rocMonth` | 另匯出 `taipeiToday()`、`rocDate()`、`schoolYearOptions()` 與型別 `Term` | 表單提示「民國：115.09.30（月份：115.09）」要民國日期；學年下拉在頁首、表單、保留座位三處共用；「今天」一律台北日期 |
| 2 | URL query 只有 `campus`、`sy`、`sem`、`tab` | 另加 `vr`（`visit_request_id`），`sy=all` 代表「不限學年」 | 預約明細的「招生訪視」連結要直接篩到那一筆；不限學年要能寫進網址，重新整理才不會回到預設學年 |
| 3 | `StatsTab.vue` 在 C3 新增 | B1 先建同名檔，內容是可運作的空狀態（兩顆按鈕切到漏斗看板／名額規劃），C3 覆寫同一檔 | `AdmissionsView.vue` 的 import 與 props 在 C 階段不必再改 |
| 4 | 檔案表沒有測試共用檔 | 新增 `admin/src/__tests__/admissionsTestKit.ts`（掛載、mock、資料工廠；不是 `*.test.ts`，vitest 不會當測試跑） | 十支招生測試共用同一套掛載與假資料 |
| 5 | 檔案表沒寫側欄位置與圖示 | `招生入學` 放在 `visits`（參觀預約）組、「參觀場次」之後，圖示 `TrendCharts`，同步加進 `components/AdminSidebar.vue` 的 `icons` | `ux20260928A.test.ts`「每個側欄項目都有圖示」會檢查；`receptionAndHistory.test.ts` 要求參觀場次緊接參觀案件，所以放在它後面 |
| 6 | `grade-cases.json` 形狀未鎖定 | 沿用 A1 鎖定的形狀：`{"cases": [{"name", "birthday", "today", "expected_term": [學年, 學期], "expected_grade": 年級或 null}]}`；年級用 `expected_term` 的學年換算 | admin vitest 與後端、web 讀同一份（2026-10-01 主 session 對齊 A1） |
| 7 | 總覽只列 schema 名稱 | B 依賴的欄位：`SeatOut.capacity_warning: boolean`；`IntakeTargetsRequest = {school_year, semester, targets: {[grade]: number \| null}}`（null＝刪除該年級計畫，回到「未設定」）；`TransitionRequest = {to_stage, expected_version, reason, deposit_collector, enrolled_on, grade, target_school_year, target_semester}`（後六個可為 null）；`SeatRequest = {grade (null＝釋放), target_school_year, target_semester, expected_version}`；`RecruitmentEventOut = {id, event_type, from_stage, to_stage, reason, metadata_json, created_at}`；`AdmissionsOptionsOut` 至少有 `months`、`sources`、`referrers` | 這些欄位直接來自總覽的 service 簽章與規格 5.2；A 若命名不同，依 Global Constraints 第 1 條處理 |
| 8 | 型別別名舉例沒列卡片、名額列、預約列 | 依同一規則用 `FunnelCard`、`IntakePlanRow`、`ArrivalRow`、`SeatResult`（`SeatOut`） | B1 Step 1 核對；A9 漏了就在 B1 補 |
| 9 | 園務文案照抄 | 提到學生檔、監護人、學號、學費管理、班級的文案改寫成官網的說法（逐條列在各元件旁的註解）；`converted` 事件「註冊（轉學生）」→「標記註冊」、`revert_converted`「取消註冊（刪學生）」→「取消註冊」；補上園務缺的 `seat_reserved`「保留座位」、`seat_released`「釋放保留」 | 官網沒有學生檔與學費模組；規格第 10 節要求歷程不露英文代碼 |
| 10 | 規格 5.1「帶參觀老師本次畫面可選填」 | 本階段表單與明細表**不放**來源分類（`source_category`）、帶參觀老師、娃娃車（`rides_bus`）、地址分析同意；欄位照樣存在、照樣匯出 | 園務摘要標為獎金／地圖用途，第一版不做（規格 3.2）；列入「待決定」第 1 條 |
| 11 | 明細篩選列含「入學學年、學期」 | 明細直接用頁首的入學學年學期篩選，不在明細工具列重複；「清除篩選」連學年學期一起清（同園務） | 規格第 10 節：學年學期是頁首共用篩選 |
| 12 | 明細列操作「標記註冊」「保留座位」在 B2 | B2 先做編輯、歷程、退出、刪除；B3 建好 `TransitionDialog` 後在明細加「標記註冊」；B4 建好 `SeatDialog` 後在「更多」加「保留座位／變更座位」 | 元件歸屬照總覽（TransitionDialog 屬 B3、SeatDialog 屬 B4），每個 task 結束都能編譯 |
| 13 | `api/errors.ts` 不在檔案表 | B1 在 `ERROR_CODE_MESSAGES` 加 `RECRUITMENT_VISIT_VERSION_CONFLICT`、`TRANSITION_NOT_ALLOWED` 的備援文案 | 後端 detail 沒帶 message 時才用得到 |
| 14 | 保存政策標籤由 A7 加 | B6 核對 `RETENTION_CATEGORY_LABELS` 有沒有 `admissions: '招生訪視'`，沒有就補 | 規格第 11 節，預覽與清理紀錄要寫出招生訪視筆數 |
| 15 | URL query 只有 `campus`、`sy`、`sem`、`tab`、`vr` | 另加 `month`（民國月份 `115.09`，格式不對就丟掉），放在 `useAdmissionsFilters` 的狀態裡；訪視明細的月份篩選與網址雙向同步，「清除篩選」連 `month`、`vr`、學年學期一起清 | C3 統計分頁的 `open-records` 由 `AdmissionsView` 做 `router.push({ query: { ...route.query, tab: 'records', month } })`；月份若只放在 `RecordsTab`，`syncUrl()` 依 `stateQuery()` 寫回網址時會把它洗掉 |
| 16 | 總覽沒定 `RecordsTab` 介面 | 只吃 props（`campusKey`、`schoolYear`、`semester`、`month`、`visitRequestId`），用 `update:month`、`update:visitRequestId`、`clear-term` 往上改 | `useAdmissionsFilters` 一頁只能有一份（兩份會互相改寫網址）；同 C3 的 `StatsTab` 只吃值 |
| 17 | 表單送出的欄位未定 | 新增不送狀態欄位與 `month`、`seq_no`、`provisional_grade`；編輯只送改過的欄位＋`expected_version`；生日只在新增時必填；收預繳人員只在已預繳時可改，未預繳原因只在未預繳時出現 | A 調整第 11 條 `extra="forbid"`；後端以 `model_fields_set` 區分沒送與清空；預約到場自動建立的訪視可能沒有生日，改備註不能被擋 |
| 18 | 看板、名額規劃直接用頁首學年學期 | 頁首「不限學年」時看板與名額規劃用目前學年；名額規劃在頁首沒選學期時用上學期；兩者都在畫面寫明 | `GET /board` 要學年、`GET /intake-plan` 要學年與學期；園務名額面板父層未指定學期時也是上學期 |
| 19 | 新增訪視的入口沒寫 | 看板工具列（右上角）與明細面板頭都有「新增訪視」，共用 `RecordDialog` | 看板「已訪視」空欄文案（園務原文）叫使用者用右上角的「新增訪視」 |
| 20 | 摘要列三個比率 | 照園務用各欄目前張數相除：預繳率＝已預繳 ÷ 已訪視、註冊率＝已註冊 ÷ 已預繳、退費率＝退出 ÷ 已註冊（名稱照抄，滑鼠移上去寫公式）；分母 0 顯示「—」（園務顯示 0） | 規格 9.2「沒有資料不顯示成 0」；「退費率」易誤讀，列入「待決定」第 3 條 |
| 21 | 官網預約標籤筆數只在切校區時讀 | `ArrivalsTab` 每次讀完清單 emit `count`，頁面更新標籤；`AdmissionsView` 原本的讀取保留（在其他分頁也要有數字） | 標記到場後標籤要立刻少一筆 |
| 22 | 預約明細的「招生訪視」連結只帶 `vr` | 連結是 `/admissions?campus=…&tab=records&vr=…&sy=all` | 到場當下寫入的入學學期不一定是頁首預設學年（例如 7 月到場是上一學年下學期），不帶 `sy=all` 會被學年篩掉 |
| 23 | `api/errors.ts` 只補兩個碼（第 13 條） | B5 再補 `VISIT_REQUEST_NOT_COMPLETED`、`VISIT_REQUEST_ANONYMIZED` 的備援文案 | A 調整第 13 條的兩個 409，後端可能只回 code |
| 24 | 超額照園務只有整列淡紅 | 名額規劃另加「超過計畫名額」標籤；保留座位成功但 `capacity_warning` 為真時跳提醒框（文案自擬，列入「待決定」第 5 條） | 園務前端沒用 `capacity_warning`；規格第 10 節要「超額警示」 |
| 25 | 保存政策欄位位置未定 | 「招生訪視」放在「未結案提醒」之後、「每天自動清理」之前；試算與清理紀錄只在回應有 `admissions` 時列出；自動清理開著時從留空改成有天數當成「縮短」要確認 | 既有 `policiesUx` 測試以索引取前三欄；A 調整第 15 條舊紀錄文字不變；開始清理等於縮短保存期 |
| 26 | 歷程照園務 | 標題「參觀→入學 歷程」；座位事件不寫「已預繳 → 已預繳」，改寫 metadata 的年級與學期（有才寫）；建立訪視不寫「— → 已訪視」；回應有 `actor_name` 才寫操作者 | 園務摘要第 10 節陷阱 ②；規格第 10 節「歷程不露英文代碼」 |
| 27 | 明細日期格式未定 | 「參觀日期」顯示民國 `115.09.08`（同園務），月份篩選同為民國 | 與園務表格、月份欄、匯出格式一致 |
| 28 | 409 提示只寫看板 | 狀態轉換一律用園務原文「狀態已被其他人變更，已自動重新載入」；編輯、刪除、保留座位用「這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作」（表單另說「你的修改沒有儲存」）；都自動重讀、不顯示錯誤 | 官網既有慣例：樂觀鎖衝突用 warning／info 並重讀，不顯示錯誤（VisitDetailView `reportError`） |

## 檔案結構

| 檔案 | 動作 | 責任 | Task |
|---|---|---|---|
| `admin/src/admissions/constants.ts` | 新增 | 年級、階段、事件文案與顏色 token 名稱；轉換權限、確認框模式與警示文字；`TransitionCard`／`TransitionTarget` 型別 | B1 |
| `admin/src/admissions/academic.ts` | 新增 | 台北今天、學期、年級換算、民國月份與日期、學年選項 | B1 |
| `admin/src/admissions/useAdmissionsFilters.ts` | 新增（B2 加 `month`） | 校區、學年、學期、分頁、預約、月份篩選 ↔ URL query | B1、B2 |
| `admin/src/api/admissions.ts` | 新增 | 招生 API 呼叫 | B1 |
| `admin/src/api/types.ts` | 核對（A9 已加） | 招生型別別名 | B1 |
| `admin/src/api/errors.ts` | 修改 | 招生錯誤碼備援文案 | B1、B5 |
| `admin/src/views/AdmissionsView.vue` | 新增（B2–B5 逐步接上分頁） | 頁首、篩選、五個分頁 | B1–B5 |
| `admin/src/components/admissions/StatsTab.vue` | 新增（C3 覆寫） | 統計分頁的空狀態 | B1 |
| `admin/src/router/index.ts`、`router/nav.ts`、`components/AdminSidebar.vue` | 修改 | 路由、側欄、圖示 | B1 |
| `admin/src/__tests__/fixtures.ts` | 核對（A2 已改） | 測試權限表含 `admissions.*` | B1 |
| `admin/src/__tests__/admissionsTestKit.ts` | 新增 | 測試共用掛載、mock、資料工廠 | B1 |
| `admin/src/components/admissions/RecordsTab.vue`、`RecordDialog.vue`、`EventsDrawer.vue` | 新增（B3、B4 再加列操作） | 訪視明細、表單、歷程 | B2 |
| `admin/src/components/admissions/FunnelBoard.vue`、`FunnelCard.vue`、`TransitionDialog.vue` | 新增 | 漏斗看板 | B3 |
| `admin/src/components/admissions/IntakePlanTab.vue`、`SeatDialog.vue` | 新增 | 名額規劃、保留座位 | B4 |
| `admin/src/components/admissions/ArrivalsTab.vue` | 新增 | 官網預約待確認與補建 | B5 |
| `admin/src/views/VisitDetailView.vue` | 修改 | 已到場確認框、招生訪視連結與補建 | B5 |
| `admin/src/views/PoliciesView.vue`、`admin/src/api/labels.ts` | 修改 | `admissions_days` 欄位、報表類別 | B6 |
| `admin/src/__tests__/admissions*.test.ts` | 新增 | 見各 task | B1–B5 |
| `admin/src/__tests__/visitDetails.test.ts`、`caseHandling.test.ts`、`policiesUx.test.ts` | 修改 | 見 B5、B6 | B5、B6 |

---

### Task B1：API 模組、常數、學期工具、篩選、頁面骨架、路由與側欄

**Files:**
- Create: `admin/src/api/admissions.ts`、`admin/src/admissions/constants.ts`、`admin/src/admissions/academic.ts`、`admin/src/admissions/useAdmissionsFilters.ts`、`admin/src/views/AdmissionsView.vue`、`admin/src/components/admissions/StatsTab.vue`、`admin/src/__tests__/admissionsTestKit.ts`
- Modify: `admin/src/api/errors.ts`（`ERROR_CODE_MESSAGES`，第 9–29 行）、`admin/src/router/index.ts`（`visit-calendar` 那一行之後，第 58 行）、`admin/src/router/nav.ts`（`visits` 組，第 62–63 行之後）、`admin/src/components/AdminSidebar.vue`（圖示 import 第 4–9 行、`icons` 第 51–55 行）
- Verify: `admin/src/api/types.ts`、`admin/src/__tests__/fixtures.ts`
- Test: `admin/src/__tests__/admissionsAcademic.test.ts`、`admissionsConstants.test.ts`、`admissionsApi.test.ts`、`admissionsView.test.ts`

**Interfaces:**
- Consumes：A9 的 `admin/src/api/types.ts` 別名；`contracts/ivy-recruitment/grade-cases.json`（A1）；`backend/app/admissions/constants.py`（A1，測試以原始碼比對）；API 見總覽 API 表。
- Produces：
  - `admin/src/api/admissions.ts`：總覽列的 14 個函式（`getStats`、`getCompare` 留給 C3、C4），另有 `export type RecordFilters`、`export function transitionRequest(toStage: Stage, expectedVersion: number, fields?: Partial<Omit<TransitionRequest, 'to_stage' | 'expected_version'>>): TransitionRequest`。
  - `admin/src/admissions/constants.ts`：`GRADES`、`Grade`、`STAGES`、`Stage`、`isStage()`、`STAGE_LABELS`、`stageLabel()`、`STAGE_TOKENS`、`STAGE_EMPTY_TEXT`、`WITHDRAWN_FROM_LABELS`、`SEMESTER_LABELS`、`NO_DEPOSIT_REASONS`、`EVENT_LABELS`、`eventLabel()`、`transitionCapability()`、`transitionBlockedText()`、`transitionMode()`、`transitionWarning()`、`canDragFrom()`、`moveTargets()`、型別 `TransitionCapability`、`TransitionMode`、`TransitionCard`、`TransitionTarget`。
  - `admin/src/admissions/academic.ts`：`taipeiToday(now?)`、`Term`、`currentTerm(today?)`、`termLabel(sy, sem, style?)`、`gradeForBirthday(birthday, sy)`、`rocMonth(iso)`、`rocDate(iso)`、`schoolYearOptions(base, offsets)`。
  - `admin/src/admissions/useAdmissionsFilters.ts`：`ADMISSIONS_TABS`、`AdmissionsTab`、`Semester`、`useAdmissionsFilters()` 回傳 `{ campus, schoolYear, semester, tab, visitRequestId, visibleCampusKeys, defaultYear, clearTerm }`。
  - 路由 `name: 'admissions'`、path `admissions`；nav 項目 `{ name: 'admissions', path: '/admissions', title: '招生入學', icon: 'TrendCharts', roles: VISITS }`。

- [ ] **Step 1：核對 A 階段帶來的型別與測試權限表**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
grep -nE "export type (RecruitmentVisit|RecruitmentVisitCreate|RecruitmentVisitUpdate|RecruitmentEvent|TransitionRequest|SeatRequest|SeatResult|FunnelBoard|FunnelCard|IntakePlan|IntakePlanRow|IntakeTargetsRequest|Arrivals|ArrivalRow|AdmissionsOptions) =" admin/src/api/types.ts
grep -n "admissions\." admin/src/__tests__/fixtures.ts
grep -n "admissions_days" contracts/generated/website-api.d.ts | head -3
```

Expected：第一個指令列出 15 行。缺的就在 `admin/src/api/types.ts` 檔尾（`DisplayNameUpdateRequest` 那一行之後）補上，名稱一律是去掉 `Out` 的 schema 名：

```ts
// 招生入學（/admin/admissions/*）。schema 名稱見 backend/app/admissions/schemas.py。
export type RecruitmentVisit = components['schemas']['RecruitmentVisitOut']
export type RecruitmentVisitCreate = components['schemas']['RecruitmentVisitCreate']
export type RecruitmentVisitUpdate = components['schemas']['RecruitmentVisitUpdate']
export type RecruitmentEvent = components['schemas']['RecruitmentEventOut']
export type TransitionRequest = components['schemas']['TransitionRequest']
export type SeatRequest = components['schemas']['SeatRequest']
export type SeatResult = components['schemas']['SeatOut']
export type FunnelBoard = components['schemas']['FunnelBoardOut']
export type FunnelCard = components['schemas']['FunnelCardOut']
export type IntakePlan = components['schemas']['IntakePlanOut']
export type IntakePlanRow = components['schemas']['IntakePlanRowOut']
export type IntakeTargetsRequest = components['schemas']['IntakeTargetsRequest']
export type Arrivals = components['schemas']['ArrivalsOut']
export type ArrivalRow = components['schemas']['ArrivalRowOut']
export type AdmissionsOptions = components['schemas']['AdmissionsOptionsOut']
```

第二個指令要看到 `super_admin`、`campus_admin` 有 `'admissions.convert', 'admissions.read', 'admissions.write'`，`reception` 有 `'admissions.read', 'admissions.write'`。A2 沒改到就照下面改 `admin/src/__tests__/fixtures.ts`（只動這三個陣列）：

```ts
  super_admin: [
    ...CAMPUS_READ, 'admissions.convert', 'admissions.read', 'admissions.write', 'audit.read_all', 'booking.cross_campus', 'booking.export', 'booking.handle', 'booking.manage',
    'booking.read', 'campuses.activate', 'campuses.manage', 'content.manage', 'content.publish', 'content.release_restore', 'content.shared',
    'media.manage', 'notifications.manage', 'retention.manage', 'site_settings.manage', 'users.manage',
  ],
  campus_admin: [
    ...CAMPUS_READ, 'admissions.convert', 'admissions.read', 'admissions.write', 'booking.handle', 'booking.manage', 'booking.read', 'campuses.manage', 'content.manage',
    'content.publish', 'media.manage',
  ],
  editor: [...CAMPUS_READ, 'content.manage', 'media.manage'],
  reception: [...CAMPUS_READ, 'admissions.read', 'admissions.write', 'booking.handle', 'booking.read'],
```

第三個指令有輸出代表 A7 的保存政策欄位已進契約（B6 會用到）。

- [ ] **Step 2：測試共用檔 `admin/src/__tests__/admissionsTestKit.ts`**

```ts
// 招生入學測試共用：掛載（memory router＋Pinia＋Element Plus）、依路徑前綴 mock api、
// 假資料工廠。檔名不是 *.test.ts，vitest 不會把它當測試跑。
import { vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

export const wrappers: VueWrapper[] = []

/** afterEach 用：卸載、還原 mock 與計時器、清掉掛在 body 的彈出層。 */
export function cleanup(): void {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
}

export const superAdmin = () => testUser('super_admin', { id: 'admin', email: 'admin@example.invalid' })
export const campusAdmin = () => testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] })
export const reception = () => testUser('reception', { id: 'desk', email: 'desk@example.invalid', campus_keys: ['yihua'] })
/** 只能看招生、不能改（例如日後的查看角色）。 */
export const admissionsViewer = () =>
  testUser('reception', { id: 'viewer', email: 'viewer@example.invalid', campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] })

export async function mountWith(
  component: unknown,
  options: { path?: string; user?: UserOut; props?: Record<string, unknown> } = {},
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  useAuthStore(pinia).user = options.user ?? superAdmin()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(options.path ?? '/admissions')
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props: options.props,
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

type Handler = (path: string, body?: unknown) => unknown
type Routes = Record<string, unknown>

/** 多個前綴都對得上時取最長的，`/records/x/events` 不會被 `/records` 吃掉。 */
function pick(routes: Routes, path: string): { found: boolean; value: unknown } {
  const key = Object.keys(routes).filter((prefix) => path.startsWith(prefix)).sort((a, b) => b.length - a.length)[0]
  return key === undefined ? { found: false, value: undefined } : { found: true, value: routes[key] }
}

async function respond(routes: Routes, path: string, body: unknown, fallback: unknown): Promise<unknown> {
  const { found, value } = pick(routes, path)
  if (!found) return fallback
  return typeof value === 'function' ? (value as Handler)(path, body) : value
}

/** GET：值可以是資料，或 `(path) => 資料`（丟例外就是 API 失敗）。對不上的路徑回空陣列。 */
export function mockGet(routes: Routes) {
  return vi.spyOn(api, 'get').mockImplementation((async (path: string) => respond(routes, path, undefined, [])) as never)
}
export function mockPost(routes: Routes = {}) {
  return vi.spyOn(api, 'post').mockImplementation((async (path: string, body?: unknown) => respond(routes, path, body, {})) as never)
}
export function mockPatch(routes: Routes = {}) {
  return vi.spyOn(api, 'patch').mockImplementation((async (path: string, body?: unknown) => respond(routes, path, body, {})) as never)
}
export function mockPut(routes: Routes = {}) {
  return vi.spyOn(api, 'put').mockImplementation((async (path: string, body?: unknown) => respond(routes, path, body, {})) as never)
}
export function mockDelete(routes: Routes = {}) {
  return vi.spyOn(api, 'delete').mockImplementation((async (path: string) => respond(routes, path, undefined, undefined)) as never)
}

/** 先不回應的請求：測「快速切換只顯示最後一次」。 */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type Spy = { mock: { calls: unknown[][] } }
export const pathsTo = (spy: Spy, prefix: string): string[] => spy.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith(prefix))
export const queryOf = (path: string): URLSearchParams => new URLSearchParams(path.split('?')[1] ?? '')
export const bodyOf = (spy: Spy, prefix: string): unknown => spy.mock.calls.find((call) => String(call[0]).startsWith(prefix))?.[1]

export const button = (wrapper: VueWrapper | DOMWrapper<Element>, text: string) => wrapper.findAll('button').find((b) => b.text() === text)
export const hasButton = (wrapper: VueWrapper | DOMWrapper<Element>, text: string) => button(wrapper, text) !== undefined

export const VR_ID = '11111111-2222-4333-8444-555555555555'
export const VR_ID_2 = '66666666-7777-4888-9999-000000000000'

export const visit = (changes: Record<string, unknown> = {}) => ({
  id: 'v-1', campus_key: 'yihua', visit_request_id: null, month: '115.09', seq_no: '1', visit_date: '2026-09-08',
  child_name: '王小安', birthday: '2023-03-02', grade: '小班', phone: '0912345678', contact_name: '王媽媽', address: null,
  district: null, source: '親友介紹', referrer: null, deposit_collector: null, tour_guide_user_id: null, tour_guide_name: null,
  source_category: null, has_deposit: false, rides_bus: false, notes: null, parent_response: null, geocoding_consent_at: null,
  no_deposit_reason: null, no_deposit_reason_detail: null, enrolled: false, enrolled_on: null, transfer_term: false,
  provisional_grade: null, target_school_year: 115, target_semester: 1, withdrawn_at: null, withdrawn_from: null,
  withdraw_reason: null, version: 1, created_at: '2026-09-08T02:00:00Z', updated_at: '2026-09-08T02:00:00Z',
  stage: 'visited', has_visit_request: false, ...changes,
})

export const card = (changes: Record<string, unknown> = {}) => ({
  id: 'v-1', child_name: '王小安', grade: '小班', provisional_grade: null, target_school_year: 115, target_semester: 1,
  visit_date: '2026-09-08', has_visit_request: false, withdrawn_from: null, version: 1, ...changes,
})

type StageKey = 'visited' | 'deposited' | 'enrolled' | 'withdrawn'
export const board = (columns: Partial<Record<StageKey, unknown[]>> = {}, extra: Record<string, unknown> = {}) => ({
  columns: { visited: [], deposited: [], enrolled: [], withdrawn: [], ...columns },
  unscoped_count: 0, school_year: 115, semester: null, ...extra,
})

export const intakeRow = (grade: string, changes: Record<string, unknown> = {}) => ({
  grade, target_seats: null, reserved: 0, enrolled: 0, remaining: null, over_capacity: false, ...changes,
})
export const intakePlan = (rows: unknown[] = ['幼幼班', '小班', '中班', '大班'].map((grade) => intakeRow(grade)), totals: Record<string, unknown> = {}) => ({
  school_year: 115, semester: 1, rows, totals: { target_seats: null, reserved: 0, enrolled: 0, remaining: null, ...totals },
})

export const arrivalRow = (changes: Record<string, unknown> = {}) => ({
  visit_request_id: VR_ID, slot_date: '2026-09-26', start_time: '10:00:00', parent_name: '陳媽媽', child_name: '陳小寶',
  party_size: 2, status: 'confirmed', ...changes,
})

export const options = () => ({ months: ['115.09', '115.08'], sources: ['親友介紹', 'Facebook'], referrers: ['林老師'] })
```

- [ ] **Step 3：學期與年級工具的失敗測試 `admin/src/__tests__/admissionsAcademic.test.ts`**

```ts
/// <reference types="node" />
// 讀 repo 根目錄的共用案例（node:fs／__dirname）。app 的 tsconfig 只開 vite/client，
// 這裡明確引用 Node 型別（同 siteStructure.test.ts）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentTerm, gradeForBirthday, rocDate, rocMonth, schoolYearOptions, taipeiToday, termLabel } from '../admissions/academic'

// 形狀由 A1 鎖定：年級一律用 expected_term 的學年換算。
interface GradeCases {
  cases: { name: string; birthday: string; today: string; expected_term: [number, 1 | 2]; expected_grade: string | null }[]
}
const cases = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/ivy-recruitment/grade-cases.json'), 'utf8')) as GradeCases

describe('年級與學期：與後端、官網讀同一份共用案例（規格 6.4、R12）', () => {
  it('生日換算適讀班級', () => {
    expect(cases.cases.length).toBeGreaterThan(0)
    for (const c of cases.cases) expect(gradeForBirthday(c.birthday, c.expected_term[0]), c.name).toBe(c.expected_grade)
  })

  it('台北日期換算目前學期', () => {
    expect(cases.cases.length).toBeGreaterThan(0)
    for (const c of cases.cases) expect(currentTerm(c.today), c.name).toEqual({ schoolYear: c.expected_term[0], semester: c.expected_term[1] })
  })
})

describe('學期邊界（Review Focus 2）', () => {
  it('7/31 還是上一學年下學期，8/1 換新學年上學期；1/31 仍是上學期，2/1 換下學期', () => {
    expect(currentTerm('2026-07-31')).toEqual({ schoolYear: 114, semester: 2 })
    expect(currentTerm('2026-08-01')).toEqual({ schoolYear: 115, semester: 1 })
    expect(currentTerm('2027-01-31')).toEqual({ schoolYear: 115, semester: 1 })
    expect(currentTerm('2027-02-01')).toEqual({ schoolYear: 115, semester: 2 })
  })

  it('「今天」用台北時間：UTC 7/31 16:00 已經是台北 8/1', () => {
    expect(taipeiToday(new Date('2026-07-31T16:00:00Z'))).toBe('2026-08-01')
    expect(taipeiToday(new Date('2026-07-31T15:59:59Z'))).toBe('2026-07-31')
  })
})

describe('園務 gradeForBirthday 的規則', () => {
  it('9/1 含當天以前出生算足歲；範圍外與格式錯誤回 null（不硬帶）', () => {
    expect(gradeForBirthday('2023-09-01', 115)).toBe('小班')
    expect(gradeForBirthday('2023-09-02', 115)).toBe('幼幼班')
    expect(gradeForBirthday('2021-01-15', 115)).toBe('大班')
    expect(gradeForBirthday('2025-01-15', 115)).toBeNull()
    expect(gradeForBirthday('2019-05-05', 115)).toBeNull()
    expect(gradeForBirthday('2023/09/01', 115)).toBeNull()
    expect(gradeForBirthday(null, 115)).toBeNull()
    expect(gradeForBirthday('2023-09-01', null)).toBeNull()
  })
})

describe('顯示用的寫法', () => {
  it('入學學期：明細「115 上學期」、卡片「115上」，缺值不硬湊', () => {
    expect(termLabel(115, 1)).toBe('115 上學期')
    expect(termLabel(115, 2, 'short')).toBe('115下')
    expect(termLabel(115, null)).toBe('115 學年')
    expect(termLabel(null, 1)).toBe('—')
    expect(termLabel(115, null, 'short')).toBe('')
  })

  it('民國月份與日期（園務表單「民國：115.09.08（月份：115.09）」）', () => {
    expect(rocMonth('2026-09-08')).toBe('115.09')
    expect(rocDate('2026-09-08')).toBe('115.09.08')
    expect(rocMonth('2026-01-31')).toBe('115.01')
    expect(rocMonth('')).toBe('')
    expect(rocDate(null)).toBe('')
  })

  it('學年選項依偏移排列', () => {
    expect(schoolYearOptions(115, [1, 0, -1, -2])).toEqual([116, 115, 114, 113])
  })
})
```

- [ ] **Step 4：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsAcademic.test.ts`
Expected: FAIL，`Failed to resolve import "../admissions/academic"`。若錯誤是 `ENOENT … grade-cases.json`，代表 A1 還沒完成，停下來回報，不要自己建這份檔。

- [ ] **Step 5：實作 `admin/src/admissions/academic.ts`**

```ts
import type { Grade } from './constants'

// 招生的「今天」一律用台北日期（後端 app.common.timezones.today_local 同一條規則）。
const TAIPEI_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function taipeiToday(now: Date = new Date()): string {
  return TAIPEI_DATE.format(now)
}

export interface Term {
  schoolYear: number
  semester: 1 | 2
}

// 同後端 academic.current_term：8/1–12/31 →（西元−1911，上）；1/1–1/31 →（西元−1912，上）；
// 2/1–7/31 →（西元−1912，下）。7 月仍算上一學年下學期（同園務），暑假新增的訪視
// 要自己改成新學年；表單提示「預設當前學期，可改」。
export function currentTerm(today: string = taipeiToday()): Term {
  const [year = 0, month = 0] = today.split('-').map(Number)
  if (month >= 8) return { schoolYear: year - 1911, semester: 1 }
  if (month === 1) return { schoolYear: year - 1912, semester: 1 }
  return { schoolYear: year - 1912, semester: 2 }
}

/** 明細用 long：「115 上學期」；卡片用 short：「115上」（同園務卡片的入學學期標籤）。 */
export function termLabel(
  schoolYear: number | null | undefined,
  semester: number | null | undefined,
  style: 'long' | 'short' = 'long',
): string {
  const half = semester === 1 ? '上' : semester === 2 ? '下' : ''
  if (style === 'short') return schoolYear && half ? `${schoolYear}${half}` : ''
  if (!schoolYear) return '—'
  return half ? `${schoolYear} ${half}學期` : `${schoolYear} 學年`
}

const AGE_GRADES: Record<number, Grade> = { 2: '幼幼班', 3: '小班', 4: '中班', 5: '大班' }

// 園務 constants/recruitment.ts gradeForBirthday：學年 N 以西元 (N+1911)/9/1（含）為足歲
// 基準；2 歲幼幼班、3 小班、4 中班、5 大班，範圍外回 null（不強帶）。
export function gradeForBirthday(birthday: string | null | undefined, schoolYear: number | null | undefined): Grade | null {
  if (!birthday || !schoolYear) return null
  const match = ISO_DATE.exec(birthday)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  let age = schoolYear + 1911 - year
  if (month > 9 || (month === 9 && day > 1)) age -= 1
  return AGE_GRADES[age] ?? null
}

/** 「2026-09-08」→「115.09」（園務 month 欄位格式）。 */
export function rocMonth(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? '')
  return match ? `${Number(match[1]) - 1911}.${match[2]}` : ''
}

/** 「2026-09-08」→「115.09.08」（園務 visit_date 字串格式）。 */
export function rocDate(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? '')
  return match ? `${Number(match[1]) - 1911}.${match[2]}.${match[3]}` : ''
}

export function schoolYearOptions(base: number, offsets: readonly number[]): number[] {
  return offsets.map((offset) => base + offset)
}
```

`constants.ts` 還沒建，這一步先不跑；Step 8 建好後一起跑。

- [ ] **Step 6：常數與轉換規則的失敗測試 `admin/src/__tests__/admissionsConstants.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  EVENT_LABELS, GRADES, NO_DEPOSIT_REASONS, STAGES, STAGE_LABELS, STAGE_TOKENS, canDragFrom, eventLabel, moveTargets,
  stageLabel, transitionBlockedText, transitionCapability, transitionMode, transitionWarning, type Stage,
} from '../admissions/constants'

// 後端列舉值的唯一來源是 backend/app/admissions/constants.py（A1）；前端的文案表要對得上。
// vitest.config.ts 已放行 ../backend/app 的 ?raw 讀取（labelCoverage 同一招）。
const backend = import.meta.glob('../../../backend/app/admissions/constants.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = Object.values(backend)[0] ?? ''

function tuple(name: string): string[] {
  const start = source.indexOf(`${name}:`)
  expect(start, `constants.py 找不到 ${name}`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('(', start)
  const close = source.indexOf(')', open)
  return [...source.slice(open, close).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!)
}

describe('與後端 constants.py 對齊', () => {
  it('年級、階段、未預繳原因逐字相同', () => {
    expect([...GRADES]).toEqual(tuple('GRADES'))
    expect([...STAGES]).toEqual(tuple('STAGES'))
    expect([...NO_DEPOSIT_REASONS]).toEqual(tuple('NO_DEPOSIT_REASONS'))
  })

  it('每一種事件都有中文，歷程不會露英文代碼', () => {
    const types = tuple('EVENT_TYPES')
    expect(types).toContain('seat_reserved')
    expect(types.filter((type) => !EVENT_LABELS[type])).toEqual([])
  })
})

describe('階段與事件文案（照園務，官網沒有學生檔的改寫）', () => {
  it('四欄標題與顏色 token', () => {
    expect(STAGES.map((stage) => STAGE_LABELS[stage])).toEqual(['已訪視', '已預繳', '已註冊', '退預繳／退註冊'])
    for (const stage of STAGES) expect(STAGE_TOKENS[stage]).toMatch(/^--/)
    expect(stageLabel(null)).toBe('—')
    expect(stageLabel('mystery')).toBe('mystery')
  })

  it('事件：補上園務缺的保留座位；建立訪視寫出來源', () => {
    expect(eventLabel('seat_reserved')).toBe('保留座位')
    expect(eventLabel('seat_released')).toBe('釋放保留')
    expect(eventLabel('created', { origin: 'visit_request' })).toBe('建立訪視（官網預約到場）')
    expect(eventLabel('created', { origin: 'manual' })).toBe('建立訪視（手動新增）')
    expect(eventLabel('created', null)).toBe('建立訪視')
    expect(eventLabel('converted')).toBe('標記註冊')
    expect(eventLabel('unknown_event')).toBe('unknown_event')
  })
})

describe('狀態轉換（規格 6.3）', () => {
  const ALLOWED: [Stage, Stage, string][] = [
    ['visited', 'deposited', 'admissions.write'], ['deposited', 'visited', 'admissions.write'],
    ['deposited', 'enrolled', 'admissions.convert'], ['enrolled', 'deposited', 'admissions.convert'],
    ['enrolled', 'visited', 'admissions.convert'], ['deposited', 'withdrawn', 'admissions.write'],
    ['enrolled', 'withdrawn', 'admissions.convert'], ['withdrawn', 'visited', 'admissions.write'],
    ['withdrawn', 'deposited', 'admissions.write'],
  ]
  const BLOCKED: [Stage, Stage][] = [['visited', 'enrolled'], ['visited', 'withdrawn'], ['withdrawn', 'enrolled']]

  it('權限對照同後端 transition_capability；不允許的三種回 null 並說明原因', () => {
    for (const [from, to, capability] of ALLOWED) expect(transitionCapability(from, to), `${from}→${to}`).toBe(capability)
    for (const [from, to] of BLOCKED) {
      expect(transitionCapability(from, to)).toBeNull()
      expect(transitionBlockedText(from, to)).not.toBe('')
    }
    expect(transitionBlockedText('visited', 'withdrawn')).toBe('已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」')
    expect(transitionCapability('visited', 'visited')).toBeNull()
  })

  it('確認框模式：預繳記收預繳人員、註冊填日期年級學期、退出與從已註冊往回要原因、其他只確認', () => {
    expect(transitionMode('visited', 'deposited')).toBe('deposit')
    expect(transitionMode('deposited', 'enrolled')).toBe('enroll')
    expect(transitionMode('deposited', 'withdrawn')).toBe('destructive')
    expect(transitionMode('enrolled', 'deposited')).toBe('destructive')
    expect(transitionMode('enrolled', 'visited')).toBe('destructive')
    expect(transitionMode('withdrawn', 'visited')).toBe('confirm')
    expect(transitionMode('deposited', 'visited')).toBe('confirm')
  })

  it('警示文字（園務 warningText 的順序；學生檔與學費管理改成官網的說法）', () => {
    expect(transitionWarning('enrolled', 'withdrawn')).toBe('將標記退註冊，註冊日期會清除，招生紀錄保留')
    expect(transitionWarning('deposited', 'withdrawn')).toBe('將標記退預繳。若已實際收款，退款要另外處理')
    expect(transitionWarning('enrolled', 'visited')).toBe('將取消註冊並取消預繳，註冊日期會清除')
    expect(transitionWarning('enrolled', 'deposited')).toBe('將取消註冊，註冊日期會清除')
    expect(transitionWarning('withdrawn', 'deposited')).toBe('將取消這筆退預繳／退註冊的標記，卡片回到前一個階段')
    expect(transitionWarning('deposited', 'visited')).toBe('將取消預繳標記，卡片退回「已訪視」')
    expect(transitionWarning('visited', 'deposited')).toBe('')
  })

  it('拖曳權限看卡片原本的欄；「移到…」只列有權限、允許的目的欄', () => {
    const receptionCan = (capability: string) => ['admissions.read', 'admissions.write'].includes(capability)
    const viewerCan = (capability: string) => capability === 'admissions.read'
    const adminCan = () => true
    expect(canDragFrom('visited', receptionCan)).toBe(true)
    expect(canDragFrom('enrolled', receptionCan)).toBe(false)
    expect(canDragFrom('withdrawn', receptionCan)).toBe(true)
    expect(canDragFrom('visited', viewerCan)).toBe(false)
    expect(moveTargets('deposited', receptionCan)).toEqual(['visited', 'withdrawn'])
    expect(moveTargets('deposited', adminCan)).toEqual(['visited', 'enrolled', 'withdrawn'])
    expect(moveTargets('enrolled', receptionCan)).toEqual([])
    expect(moveTargets('visited', adminCan)).toEqual(['deposited'])
    expect(moveTargets('withdrawn', receptionCan)).toEqual(['visited', 'deposited'])
  })
})
```

- [ ] **Step 7：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsConstants.test.ts`
Expected: FAIL，`Failed to resolve import "../admissions/constants"`。

- [ ] **Step 8：實作 `admin/src/admissions/constants.ts`**

```ts
// 招生入學的文案與規則（比照園務 constants/recruitmentFunnel.ts、recruitment.ts）。
// 列舉值以後端 backend/app/admissions/constants.py 為準，admissionsConstants.test.ts 逐字比對。
import { RECRUITMENT_STAGE_LABELS } from '../api/labels'

export const GRADES = ['幼幼班', '小班', '中班', '大班'] as const
export type Grade = (typeof GRADES)[number]

export const STAGES = ['visited', 'deposited', 'enrolled', 'withdrawn'] as const
export type Stage = (typeof STAGES)[number]

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}

// 階段文案只維護一份：A3 在 labels.ts 匯出 RECRUITMENT_STAGE_LABELS（操作紀錄也用它）。
export const STAGE_LABELS: Record<Stage, string> = {
  visited: RECRUITMENT_STAGE_LABELS.visited!,
  deposited: RECRUITMENT_STAGE_LABELS.deposited!,
  enrolled: RECRUITMENT_STAGE_LABELS.enrolled!,
  withdrawn: RECRUITMENT_STAGE_LABELS.withdrawn!,
}

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—'
  return isStage(stage) ? STAGE_LABELS[stage] : stage
}

// 欄位顏色（園務：灰 → 橙 → 綠 → 藍）。只給 token 名稱，元件用 `var(...)` 套上，不寫色值。
export const STAGE_TOKENS: Record<Stage, string> = {
  visited: '--ink-3',
  deposited: '--el-color-warning',
  enrolled: '--el-color-success',
  withdrawn: '--admin-accent',
}

// 各欄空狀態（園務 FunnelColumn.vue:44-49 原文）。
export const STAGE_EMPTY_TEXT: Record<Stage, string> = {
  visited: '還沒有訪視紀錄，用右上角的「新增訪視」建立第一筆。',
  deposited: '家長完成預繳後，把「已訪視」的卡片拖到這一欄。',
  enrolled: '家長完成註冊後，把「已預繳」的卡片拖到這一欄。',
  withdrawn: '退預繳或退註冊的紀錄會落在這一欄。',
}

export const WITHDRAWN_FROM_LABELS: Record<string, string> = { deposited: '退預繳', enrolled: '退註冊' }

export const SEMESTER_LABELS: Record<1 | 2, string> = { 1: '上學期', 2: '下學期' }

// 未預繳原因（園務 api/recruitment/shared.py:43-52，順序照抄）。
export const NO_DEPOSIT_REASONS = [
  '時程未到／仍在觀望', '已有其他就學選項／比較他校', '未註明／待追蹤', '距離／地點因素',
  '家庭照顧安排考量', '特殊需求／名額限制', '課程／環境仍在評估', '費用考量',
] as const

// 歷程事件（園務 FUNNEL_EVENT_LABELS）。官網沒有學生檔：converted／revert_converted
// 拿掉「轉學生／刪學生」；園務漏掉的 seat_reserved／seat_released 在這裡補上。
export const EVENT_LABELS: Record<string, string> = {
  created: '建立訪視',
  deposit_added: '加上預繳',
  deposit_removed: '取消預繳',
  converted: '標記註冊',
  revert_converted: '取消註冊',
  withdrawn: '退預繳／退註冊',
  withdraw_cancelled: '取消退費',
  seat_reserved: '保留座位',
  seat_released: '釋放保留',
}

const CREATED_ORIGIN_LABELS: Record<string, string> = { visit_request: '官網預約到場', manual: '手動新增' }

/** 查不到的事件顯示原字串（園務同樣做法），建立訪視依 metadata.origin 補來源。 */
export function eventLabel(eventType: string, metadata?: unknown): string {
  const label = EVENT_LABELS[eventType] ?? eventType
  if (eventType !== 'created' || !metadata || typeof metadata !== 'object') return label
  const origin = CREATED_ORIGIN_LABELS[String((metadata as { origin?: unknown }).origin)]
  return origin ? `${label}（${origin}）` : label
}

export type TransitionCapability = 'admissions.write' | 'admissions.convert'

// 規格 6.3（後端 funnel.transition_capability 同一張表）。沒列的＝不允許。
const TRANSITIONS: Partial<Record<`${Stage}>${Stage}`, TransitionCapability>> = {
  'visited>deposited': 'admissions.write',
  'deposited>visited': 'admissions.write',
  'deposited>enrolled': 'admissions.convert',
  'enrolled>deposited': 'admissions.convert',
  'enrolled>visited': 'admissions.convert',
  'deposited>withdrawn': 'admissions.write',
  'enrolled>withdrawn': 'admissions.convert',
  'withdrawn>visited': 'admissions.write',
  'withdrawn>deposited': 'admissions.write',
}

export function transitionCapability(from: Stage, to: Stage): TransitionCapability | null {
  return TRANSITIONS[`${from}>${to}`] ?? null
}

const BLOCKED_TEXT: Partial<Record<`${Stage}>${Stage}`, string>> = {
  // 園務 recruitment_funnel.py:610 原文。
  'visited>withdrawn': '已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」',
  'visited>enrolled': '請先把卡片移到「已預繳」，再標記註冊',
  'withdrawn>enrolled': '請先取消退出、回到「已預繳」，再標記註冊',
}

export function transitionBlockedText(from: Stage, to: Stage): string {
  return BLOCKED_TEXT[`${from}>${to}`] ?? '不支援這個轉換'
}

export type TransitionMode = 'deposit' | 'enroll' | 'destructive' | 'confirm'

// 園務 TransitionConfirmDialog 的模式；官網沒有班級，註冊改填註冊日期、年級、入學學年學期。
export function transitionMode(from: Stage, to: Stage): TransitionMode {
  if (from === 'visited' && to === 'deposited') return 'deposit'
  if (from === 'deposited' && to === 'enrolled') return 'enroll'
  if (to === 'withdrawn' || (from === 'enrolled' && STAGES.indexOf(to) < STAGES.indexOf(from))) return 'destructive'
  return 'confirm'
}

// 園務 warningText（順序照抄）；「刪除學生檔案」「學費管理」改成官網實際發生的事。
export function transitionWarning(from: Stage, to: Stage): string {
  if (to === 'withdrawn' && from === 'enrolled') return '將標記退註冊，註冊日期會清除，招生紀錄保留'
  if (to === 'withdrawn') return '將標記退預繳。若已實際收款，退款要另外處理'
  if (from === 'enrolled') return to === 'visited' ? '將取消註冊並取消預繳，註冊日期會清除' : '將取消註冊，註冊日期會清除'
  if (from === 'withdrawn') return '將取消這筆退預繳／退註冊的標記，卡片回到前一個階段'
  if (from === 'deposited' && to === 'visited') return '將取消預繳標記，卡片退回「已訪視」'
  return ''
}

type Can = (capability: string) => boolean

// 園務 FunnelBoard.vue:136-150：以卡片「原本所在的欄」決定能不能拖。官網沒有學生檔，
// 從已註冊拖出只要 admissions.convert（園務另要 STUDENTS_WRITE）。
export function canDragFrom(stage: Stage, can: Can): boolean {
  if (stage === 'enrolled') return can('admissions.convert')
  if (stage === 'withdrawn') return can('admissions.write')
  return can('admissions.write') || can('admissions.convert')
}

/** 卡片選單「移到…」的選項：允許、而且這個人有權限的目的欄。 */
export function moveTargets(from: Stage, can: Can): Stage[] {
  return STAGES.filter((to) => {
    const capability = transitionCapability(from, to)
    return capability !== null && can(capability)
  })
}

/** 確認框需要的卡片欄位：看板卡片（FunnelCard）與明細列（RecruitmentVisit）都符合。 */
export interface TransitionCard {
  id: string
  child_name: string
  grade?: string | null
  provisional_grade?: string | null
  target_school_year?: number | null
  target_semester?: number | null
  version: number
}

export interface TransitionTarget {
  card: TransitionCard
  from: Stage
  to: Stage
}
```

- [ ] **Step 9：跑兩支測試確認通過**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsAcademic.test.ts src/__tests__/admissionsConstants.test.ts`
Expected: PASS。

- [ ] **Step 10：API 模組的失敗測試 `admin/src/__tests__/admissionsApi.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import * as admissions from '../api/admissions'
import { apiErrorMessage, isVersionConflict } from '../api/errors'

afterEach(() => { vi.restoreAllMocks() })

describe('招生 API 路徑（總覽 API 表）', () => {
  it('列表只帶有值的篩選，分頁固定帶 page 與 page_size', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    await admissions.listRecords({ campus_key: 'yihua', month: '115.09', grade: null, has_deposit: false, q: '', page: 2, page_size: 50 })
    const path = String(get.mock.calls[0]![0])
    expect(path.startsWith('/admin/admissions/records?')).toBe(true)
    expect(Object.fromEntries(new URLSearchParams(path.split('?')[1]))).toEqual({
      campus_key: 'yihua', month: '115.09', has_deposit: 'false', page: '2', page_size: '50',
    })
  })

  it('建立訪視的 campus_key 放 query（同 POST /admin/slots）；刪除帶 expected_version', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const remove = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    await admissions.createRecord('renwu', { child_name: '小明', visit_date: '2026-09-08' } as never)
    expect(post).toHaveBeenCalledWith('/admin/admissions/records?campus_key=renwu', { child_name: '小明', visit_date: '2026-09-08' })
    await admissions.deleteRecord('v-1', 3)
    expect(remove).toHaveBeenCalledWith('/admin/admissions/records/v-1?expected_version=3')
  })

  it('看板不選學期時不帶 semester；名額、預約、選項都帶校區', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    await admissions.getBoard('yihua', 115, null)
    await admissions.getIntakePlan('yihua', 115, 2)
    await admissions.getArrivals('yihua')
    await admissions.getOptions('yihua')
    await admissions.getRecord('v-1')
    await admissions.listEvents('v-1')
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/admissions/board?campus_key=yihua&school_year=115',
      '/admin/admissions/intake-plan?campus_key=yihua&school_year=115&semester=2',
      '/admin/admissions/arrivals?campus_key=yihua',
      '/admin/admissions/options?campus_key=yihua',
      '/admin/admissions/records/v-1',
      '/admin/admissions/records/v-1/events',
    ])
  })

  it('狀態轉換送齊所有欄位（沒用到的是 null）；座位、補建、名額、編輯的路徑', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    await admissions.transition('v-1', admissions.transitionRequest('deposited', 2, { deposit_collector: '林老師' }))
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/records/v-1/transition', {
      to_stage: 'deposited', expected_version: 2, reason: null, deposit_collector: '林老師',
      enrolled_on: null, grade: null, target_school_year: null, target_semester: null,
    })
    await admissions.setSeat('v-1', { grade: '小班', target_school_year: 115, target_semester: 1, expected_version: 2 } as never)
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/records/v-1/seat', expect.objectContaining({ grade: '小班' }))
    await admissions.createFromVisitRequest('vr-9')
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/from-visit-request/vr-9')
    await admissions.saveIntakeTargets('yihua', { school_year: 115, semester: 1, targets: { 小班: 20 } } as never)
    expect(put).toHaveBeenCalledWith('/admin/admissions/intake-targets?campus_key=yihua', { school_year: 115, semester: 1, targets: { 小班: 20 } })
    await admissions.updateRecord('v-1', { notes: '再聯絡', expected_version: 2 } as never)
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { notes: '再聯絡', expected_version: 2 })
  })
})

describe('招生錯誤碼', () => {
  it('版本衝突認得出來；後端沒帶 message 時有中文備援', () => {
    const conflict = new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 4 })
    expect(isVersionConflict(conflict)).toBe(true)
    expect(apiErrorMessage(conflict, '失敗')).toBe('這筆招生訪視剛被其他人修改，請重新載入後再操作')
    expect(apiErrorMessage(new ApiError(422, { code: 'TRANSITION_NOT_ALLOWED' }), '失敗')).toBe('這個階段不能直接移過去')
  })
})
```

- [ ] **Step 11：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsApi.test.ts`
Expected: FAIL，`Failed to resolve import "../api/admissions"`。

- [ ] **Step 12：實作 `admin/src/api/admissions.ts`，並在 `admin/src/api/errors.ts` 加備援文案**

`admin/src/api/admissions.ts`：

```ts
// 招生入學 API（/admin/admissions/*）。型別取自契約產生檔（api/types.ts 的別名）。
// 統計（getStats、getCompare）在 C3、C4 加。「已到場／未到場」沿用預約既有的
// /admin/visit-requests/{id}/complete、/no-show，不在這裡另包。
import { api } from './client'
import type {
  AdmissionsOptions, Arrivals, FunnelBoard, IntakePlan, IntakeTargetsRequest, RecruitmentEvent, RecruitmentVisit,
  RecruitmentVisitCreate, RecruitmentVisitUpdate, SeatRequest, SeatResult, TransitionRequest,
} from './types'
import type { Stage } from '../admissions/constants'

/** 訪視明細的篩選（後端 RecruitmentVisitFilters）。空字串與 null 不送。 */
export type RecordFilters = {
  campus_key: string
  month?: string | null
  grade?: string | null
  target_school_year?: number | null
  target_semester?: number | null
  source?: string | null
  referrer?: string | null
  has_deposit?: boolean | null
  no_deposit_reason?: string | null
  stage?: string | null
  visit_request_id?: string | null
  q?: string | null
}

type QueryValue = string | number | boolean | null | undefined

function toQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

export function listRecords(params: RecordFilters & { page: number; page_size: number }): Promise<RecruitmentVisit[]> {
  return api.get<RecruitmentVisit[]>(`/admin/admissions/records?${toQuery(params)}`)
}

export function createRecord(campusKey: string, body: RecruitmentVisitCreate): Promise<RecruitmentVisit> {
  return api.post<RecruitmentVisit>(`/admin/admissions/records?${toQuery({ campus_key: campusKey })}`, body)
}

export function getRecord(id: string): Promise<RecruitmentVisit> {
  return api.get<RecruitmentVisit>(`/admin/admissions/records/${id}`)
}

export function updateRecord(id: string, body: RecruitmentVisitUpdate): Promise<RecruitmentVisit> {
  return api.patch<RecruitmentVisit>(`/admin/admissions/records/${id}`, body)
}

export function deleteRecord(id: string, expectedVersion: number): Promise<void> {
  return api.delete<void>(`/admin/admissions/records/${id}?${toQuery({ expected_version: expectedVersion })}`)
}

export function listEvents(id: string): Promise<RecruitmentEvent[]> {
  return api.get<RecruitmentEvent[]>(`/admin/admissions/records/${id}/events`)
}

export function transition(id: string, body: TransitionRequest): Promise<RecruitmentVisit> {
  return api.post<RecruitmentVisit>(`/admin/admissions/records/${id}/transition`, body)
}

type TransitionFields = Omit<TransitionRequest, 'to_stage' | 'expected_version'>

/** 轉換請求一律送齊欄位，沒用到的是 null（後端各轉換只讀自己需要的欄位）。 */
export function transitionRequest(toStage: Stage, expectedVersion: number, fields: Partial<TransitionFields> = {}): TransitionRequest {
  return {
    to_stage: toStage,
    expected_version: expectedVersion,
    reason: null,
    deposit_collector: null,
    enrolled_on: null,
    grade: null,
    target_school_year: null,
    target_semester: null,
    ...fields,
  }
}

export function setSeat(id: string, body: SeatRequest): Promise<SeatResult> {
  return api.post<SeatResult>(`/admin/admissions/records/${id}/seat`, body)
}

export function getBoard(campusKey: string, schoolYear: number, semester: number | null): Promise<FunnelBoard> {
  return api.get<FunnelBoard>(`/admin/admissions/board?${toQuery({ campus_key: campusKey, school_year: schoolYear, semester })}`)
}

export function getIntakePlan(campusKey: string, schoolYear: number, semester: number): Promise<IntakePlan> {
  return api.get<IntakePlan>(`/admin/admissions/intake-plan?${toQuery({ campus_key: campusKey, school_year: schoolYear, semester })}`)
}

export function saveIntakeTargets(campusKey: string, body: IntakeTargetsRequest): Promise<IntakePlan> {
  return api.put<IntakePlan>(`/admin/admissions/intake-targets?${toQuery({ campus_key: campusKey })}`, body)
}

export function getArrivals(campusKey: string): Promise<Arrivals> {
  return api.get<Arrivals>(`/admin/admissions/arrivals?${toQuery({ campus_key: campusKey })}`)
}

export function createFromVisitRequest(visitRequestId: string): Promise<RecruitmentVisit> {
  return api.post<RecruitmentVisit>(`/admin/admissions/from-visit-request/${visitRequestId}`)
}

export function getOptions(campusKey: string): Promise<AdmissionsOptions> {
  return api.get<AdmissionsOptions>(`/admin/admissions/options?${toQuery({ campus_key: campusKey })}`)
}
```

`admin/src/api/errors.ts` 的 `ERROR_CODE_MESSAGES`，在 `INTERNAL_ERROR` 那一行之前插入：

```ts
  RECRUITMENT_VISIT_VERSION_CONFLICT: '這筆招生訪視剛被其他人修改，請重新載入後再操作',
  TRANSITION_NOT_ALLOWED: '這個階段不能直接移過去',
```

- [ ] **Step 13：跑測試確認通過**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsApi.test.ts`
Expected: PASS。

- [ ] **Step 14：頁面骨架、網址同步、側欄的失敗測試 `admin/src/__tests__/admissionsView.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import AdmissionsView from '../views/AdmissionsView.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { routes } from '../router'
import { canSeeNavItem, NAV_GROUPS, navItem } from '../router/nav'
import { testUser } from './fixtures'
import { arrivalRow, button, cleanup, deferred, mockGet, mountWith, pathsTo, VR_ID_2 } from './admissionsTestKit'

afterEach(cleanup)

// 2026-10-01（台北）＝115 學年上學期。
function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
}
const noArrivals = { '/admin/admissions/arrivals': { awaiting: [], missing: [] } }
const tabTexts = (wrapper: VueWrapper) => wrapper.findAll('.el-tabs__item').map((tab) => tab.text().replace(/\s+/g, ''))

describe('側欄與路由', () => {
  it('「招生入學」在參觀預約組、參觀場次之後；總管理、分校管理、接待看得到，編輯與唯讀看不到', () => {
    const visits = NAV_GROUPS.find((group) => group.key === 'visits')!.items.map((item) => item.name)
    expect(visits.indexOf('admissions')).toBe(visits.indexOf('visit-calendar') + 1)
    const item = navItem('admissions')!
    expect(item).toMatchObject({ path: '/admissions', title: '招生入學', icon: 'TrendCharts' })
    for (const role of ['super_admin', 'campus_admin', 'reception']) expect(canSeeNavItem(item, { role })).toBe(true)
    for (const role of ['editor', 'readonly']) expect(canSeeNavItem(item, { role })).toBe(false)
    const children = routes.find((route) => route.path === '/')!.children!
    expect(children.find((route) => route.name === 'admissions')).toMatchObject({ path: 'admissions', meta: { title: '招生入學' } })
  })
})

describe('招生入學頁：篩選與分頁跟網址雙向同步（規格第 10 節）', () => {
  it('網址上的校區、學年、學期、分頁掛載時讀回來', async () => {
    freezeToday()
    mockGet(noArrivals)
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?campus=renwu&sy=114&sem=2&tab=stats' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('統計分析')
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', schoolYear: 114, semester: 2 })
  })

  it('沒帶參數：第一個可見校區、目前學年、整學年、漏斗看板；改條件用 replace 寫回網址，不限學年寫成 sy=all', async () => {
    freezeToday()
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
    const [, year, semester] = wrapper.findAllComponents({ name: 'ElSelect' })
    year!.vm.$emit('update:modelValue', undefined)
    semester!.vm.$emit('update:modelValue', 2)
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'stats')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', sem: '2', tab: 'stats' })
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'yihua', schoolYear: null, semester: 2 })
  })

  it('網址被改（上一頁、從其他頁連進來）時畫面跟著換', async () => {
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=stats' })
    await router.push('/admissions?campus=renwu&tab=stats&sem=1')
    await flushPromises()
    expect(wrapper.findComponent(StatsTab).props()).toMatchObject({ campusKey: 'renwu', semester: 1 })
  })

  it('看不到的校區、亂寫的學期與分頁一律退回預設', async () => {
    mockGet(noArrivals)
    const user = testUser('campus_admin', { campus_keys: ['renwu'] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&sem=9&tab=hack', user })
    expect(router.currentRoute.value.query).toEqual({ campus: 'renwu' })
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('漏斗看板')
  })
})

describe('官網預約分頁標籤與權限', () => {
  it('標籤顯示待確認筆數；沒有 booking.read 的人看不到這個分頁，網址帶 tab=arrivals 退回看板', async () => {
    mockGet({ '/admin/admissions/arrivals': { awaiting: [arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })], missing: [] } })
    const { wrapper } = await mountWith(AdmissionsView)
    expect(tabTexts(wrapper)).toEqual(['漏斗看板', '訪視明細', '名額規劃', '官網預約2', '統計分析'])
    cleanup()

    const get = mockGet({})
    const noBooking = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read'] })
    const second = await mountWith(AdmissionsView, { path: '/admissions?tab=arrivals', user: noBooking })
    expect(tabTexts(second.wrapper)).toEqual(['漏斗看板', '訪視明細', '名額規劃', '統計分析'])
    expect(second.router.currentRoute.value.query.tab).toBeUndefined()
    expect(pathsTo(get, '/admin/admissions/arrivals')).toEqual([])
  })

  it('快速切換校區：標籤只採用最後一次的待確認筆數', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/arrivals': (path: string) => (path.includes('campus_key=yihua') ? slow.promise : { awaiting: [arrivalRow()], missing: [] }),
    })
    const { wrapper } = await mountWith(AdmissionsView)
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    slow.resolve({ awaiting: [arrivalRow(), arrivalRow(), arrivalRow()], missing: [] })
    await flushPromises()
    expect(wrapper.get('.admissions__count').text()).toBe('1')
  })

  it('沒有負責校區的帳號看到說明，不送任何招生請求', async () => {
    const get = mockGet({})
    const { wrapper } = await mountWith(AdmissionsView, { user: testUser('campus_admin', { campus_keys: [] }) })
    expect(wrapper.text()).toContain('你的帳號還沒有負責的校區')
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
  })
})

describe('統計分析（C 階段前的空狀態）', () => {
  it('說明還在準備中，按鈕切到名額規劃或漏斗看板', async () => {
    mockGet(noArrivals)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=stats' })
    expect(wrapper.text()).toContain('統計分析還在準備中')
    await button(wrapper, '看名額規劃')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('intake')
  })
})
```

- [ ] **Step 15：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsView.test.ts`
Expected: FAIL，`Failed to resolve import "../views/AdmissionsView.vue"`。

- [ ] **Step 16：實作 `admin/src/admissions/useAdmissionsFilters.ts`**

```ts
import { ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { useCampusScope } from '../composables/useCampusScope'
import { currentTerm } from './academic'

export const ADMISSIONS_TABS = ['funnel', 'records', 'intake', 'arrivals', 'stats'] as const
export type AdmissionsTab = (typeof ADMISSIONS_TABS)[number]
export type Semester = 1 | 2

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function isAdmissionsTab(value: unknown): value is AdmissionsTab {
  return typeof value === 'string' && (ADMISSIONS_TABS as readonly string[]).includes(value)
}

function queryKey(query: LocationQuery | Record<string, string>): string {
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') entries.push([key, item])
  }
  return new URLSearchParams(entries.sort(([a], [b]) => a.localeCompare(b))).toString()
}

/**
 * 招生入學頁的篩選與分頁 ↔ 網址（比照園務 useAdmissionsTermFilter）：
 * - campus：校區，沿用 useCampusScope 的可見範圍；沒指定或看不到就用第一校（同參觀場次頁）。
 * - sy：入學學年，預設目前學年（台北日期）；all＝不限學年。
 * - sem：入學學期 1／2；不帶＝整學年（同園務看板）。
 * - tab：分頁；vr：只看某筆預約的招生訪視（預約明細的連結用）。
 * 畫面改條件用 replace 寫回網址，不堆瀏覽紀錄；網址被改（上一頁、連結）時讀回畫面。
 */
export function useAdmissionsFilters() {
  const route = useRoute()
  const router = useRouter()
  const PATH = route.path
  const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
  const defaultYear = currentTerm().schoolYear

  const campus = ref('')
  const schoolYear = ref<number | null>(defaultYear)
  const semester = ref<Semester | null>(null)
  const tab = ref<AdmissionsTab>('funnel')
  const visitRequestId = ref('')

  function pickCampus(wanted: string): string {
    const keys = visibleCampusKeys.value
    if (keys.includes(wanted)) return wanted
    if (keys.includes(campus.value)) return campus.value
    return keys[0] ?? ''
  }

  function apply(query: LocationQuery) {
    campus.value = pickCampus(text(query.campus))
    const sy = text(query.sy)
    schoolYear.value = sy === 'all' ? null : /^\d{2,3}$/.test(sy) ? Number(sy) : defaultYear
    const sem = text(query.sem)
    semester.value = sem === '1' ? 1 : sem === '2' ? 2 : null
    tab.value = isAdmissionsTab(query.tab) ? query.tab : 'funnel'
    const vr = text(query.vr)
    visitRequestId.value = UUID.test(vr) ? vr : ''
  }

  function stateQuery(): Record<string, string> {
    const query: Record<string, string> = {}
    if (campus.value) query.campus = campus.value
    if (schoolYear.value === null) query.sy = 'all'
    else if (schoolYear.value !== defaultYear) query.sy = String(schoolYear.value)
    if (semester.value) query.sem = String(semester.value)
    if (tab.value !== 'funnel') query.tab = tab.value
    if (visitRequestId.value) query.vr = visitRequestId.value
    return query
  }

  // 自己寫出去、還在路上的網址：回來時不要讀回畫面，快速連點才不會被前一次的網址蓋回去
  // （同 VisitRequestsView 的 writingQueries）。
  const writing = new Set<string>()
  function syncUrl() {
    if (route.path !== PATH) return
    const query = stateQuery()
    const key = queryKey(query)
    if (key === queryKey(route.query)) return
    writing.add(key)
    void router.replace({ query }).catch(() => {}).finally(() => writing.delete(key))
  }

  apply(route.query)
  watch([campus, schoolYear, semester, tab, visitRequestId], syncUrl, { immediate: true })
  watch(() => route.query, (query) => {
    if (route.path !== PATH) return
    const key = queryKey(query)
    if (writing.has(key) || key === queryKey(stateQuery())) return
    apply(query)
  })
  // 換帳號或權限更新：選的校區不在範圍內就換成第一校。
  watch(visibleCampusKeys, () => { campus.value = pickCampus(campus.value) })

  /** 清掉入學學年學期（「另有 N 筆沒有填入學學期」與明細的「清除篩選」用）。 */
  function clearTerm() {
    schoolYear.value = null
    semester.value = null
  }

  return { campus, schoolYear, semester, tab, visitRequestId, visibleCampusKeys, defaultYear, clearTerm }
}
```

- [ ] **Step 17：統計空狀態 `admin/src/components/admissions/StatsTab.vue` 與頁面 `admin/src/views/AdmissionsView.vue`**

`admin/src/components/admissions/StatsTab.vue`（C3 會整檔覆寫成統計分頁，props 與 emits 保持一樣）：

```vue
<script setup lang="ts">
import type { AdmissionsTab, Semester } from '../../admissions/useAdmissionsFilters'

// 統計分頁在階段 C（C3）完成；在那之前給一個可用的空狀態，不顯示假的 0。
defineProps<{ campusKey: string; schoolYear: number | null; semester: Semester | null }>()
const emit = defineEmits<{ go: [tab: AdmissionsTab] }>()
</script>

<template>
  <section class="panel stats-pending">
    <div class="panel__head"><h2>統計分析</h2></div>
    <div class="panel__body">
      <el-empty description="統計分析還在準備中。各階段數量先看「漏斗看板」，各年級名額看「名額規劃」。">
        <el-button type="primary" @click="emit('go', 'funnel')">看漏斗看板</el-button>
        <el-button @click="emit('go', 'intake')">看名額規劃</el-button>
      </el-empty>
    </div>
  </section>
</template>
```

`admin/src/views/AdmissionsView.vue`（B2–B5 會在 `<div class="admissions__body">` 裡、`<StatsTab` 那一行之前逐一插入各分頁元件）：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { getArrivals } from '../api/admissions'
import { usePermissions } from '../composables/usePermissions'
import { useRequestSequence } from '../composables/useRequestSequence'
import { schoolYearOptions } from '../admissions/academic'
import { SEMESTER_LABELS } from '../admissions/constants'
import { isAdmissionsTab, useAdmissionsFilters, type AdmissionsTab, type Semester } from '../admissions/useAdmissionsFilters'

// 招生入學（規格第 10 節）：頁首放校區與入學學年學期，五個分頁順序比照園務。
// 只掛載目前分頁，切回來時重新讀資料；各分頁自己用 useRequestSequence 擋舊回應。
const { campus, schoolYear, semester, tab, visibleCampusKeys, defaultYear } = useAdmissionsFilters()
const { can } = usePermissions()
// 官網預約分頁讀 /admin/admissions/arrivals，需要 booking.read。
const canSeeArrivals = computed(() => can('booking.read'))
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)
// 園務看板的學年選項：明年、今年、前一年、前兩年。
const yearOptions = computed(() => schoolYearOptions(defaultYear, [1, 0, -1, -2]))

// 「官網預約」分頁標籤上的待確認筆數；切校時只採用最後一次的結果。
const arrivalsCount = ref<number | null>(null)
const arrivalsRequests = useRequestSequence()
async function loadArrivalsCount() {
  arrivalsCount.value = null
  if (!campus.value || !canSeeArrivals.value) return
  const request = arrivalsRequests.begin()
  try {
    const result = await getArrivals(campus.value)
    if (arrivalsRequests.isCurrent(request)) arrivalsCount.value = result.awaiting.length
  } catch {
    // 數字只是提醒；讀不到就不顯示，分頁裡會再顯示錯誤。
  }
}
watch(campus, loadArrivalsCount, { immediate: true })

// 沒有 booking.read 的人從網址帶 tab=arrivals 進來：退回漏斗看板。
watch([tab, canSeeArrivals], () => {
  if (tab.value === 'arrivals' && !canSeeArrivals.value) tab.value = 'funnel'
}, { immediate: true })

function setTab(name: string | number) {
  if (isAdmissionsTab(name)) tab.value = name
}
function setYear(value: number | null | undefined) {
  schoolYear.value = value ?? null
}
function setSemester(value: Semester | null | undefined) {
  semester.value = value ?? null
}
function goTab(next: AdmissionsTab) {
  tab.value = next
}
</script>

<template>
  <div class="page admissions">
    <PageHeader lead="參觀 → 預繳 → 註冊 ｜ 退預繳／退註冊 · 統計分析" />

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號還沒有負責的校區，請總管理者到「使用者」設定負責校區。" />
    <template v-else>
      <div class="toolbar admissions__filters">
        <div class="filter-field">
          <span v-if="multiCampus">校區</span>
          <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
        </div>
        <div class="filter-field">
          <span>入學學年</span>
          <el-select :model-value="schoolYear ?? undefined" clearable placeholder="不限學年" aria-label="入學學年" @update:model-value="setYear">
            <el-option v-for="year in yearOptions" :key="year" :label="`${year} 學年`" :value="year" />
          </el-select>
        </div>
        <div class="filter-field">
          <span>入學學期</span>
          <el-select :model-value="semester ?? undefined" clearable placeholder="整學年" aria-label="入學學期" @update:model-value="setSemester">
            <el-option :value="1" :label="SEMESTER_LABELS[1]" />
            <el-option :value="2" :label="SEMESTER_LABELS[2]" />
          </el-select>
        </div>
      </div>

      <el-tabs :model-value="tab" class="admissions__tabs" @update:model-value="setTab">
        <el-tab-pane label="漏斗看板" name="funnel" />
        <el-tab-pane label="訪視明細" name="records" />
        <el-tab-pane label="名額規劃" name="intake" />
        <el-tab-pane v-if="canSeeArrivals" name="arrivals">
          <template #label>官網預約<span v-if="arrivalsCount" class="admissions__count num">{{ arrivalsCount }}</span></template>
        </el-tab-pane>
        <el-tab-pane label="統計分析" name="stats" />
      </el-tabs>

      <div class="admissions__body">
        <StatsTab v-if="tab === 'stats'" :campus-key="campus" :school-year="schoolYear" :semester="semester" @go="goTab" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.admissions__filters .el-select {
  width: 140px;
}

.admissions__tabs {
  margin-bottom: 8px;
}

/* 分頁頭只當切換用，內容由下方各分頁元件自己畫。 */
.admissions__tabs :deep(.el-tabs__content) {
  display: none;
}

.admissions__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--el-color-warning-light-8);
  color: var(--brand-gold-ink);
  font-size: 12px;
  font-weight: 600;
}

.admissions__body {
  min-width: 0;
}
</style>
```

- [ ] **Step 18：路由、側欄、圖示**

`admin/src/router/nav.ts`，`visits` 組裡 `visit-calendar` 那一項之後插入一行：

```ts
      { name: 'admissions', path: '/admissions', title: '招生入學', icon: 'TrendCharts', roles: VISITS, keywords: ['招生', '漏斗', '預繳', '註冊', '退預繳', '名額規劃', '訪視明細', '轉換率'] },
```

`admin/src/router/index.ts`，`page('visit-calendar', …)` 那一行之後插入：

```ts
      page('admissions', 'admissions', () => import('../views/AdmissionsView.vue')),
```

`admin/src/components/AdminSidebar.vue`：

1. 圖示 import 第 8 行 `SwitchButton, Tickets, Timer, User,` 改成 `SwitchButton, Tickets, Timer, TrendCharts, User,`。
2. `icons` 物件最後一行 `Postcard, Reading, School, Setting, Sunny, Switch, Tickets, Timer, User,` 改成 `Postcard, Reading, School, Setting, Sunny, Switch, Tickets, Timer, TrendCharts, User,`。

- [ ] **Step 19：跑 B1 全部測試、會受側欄影響的舊測試與型別檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/admissionsAcademic.test.ts src/__tests__/admissionsConstants.test.ts src/__tests__/admissionsApi.test.ts src/__tests__/admissionsView.test.ts
npx vitest run src/__tests__/ux20260928A.test.ts src/__tests__/receptionAndHistory.test.ts src/__tests__/bugfixRegressions.test.ts src/__tests__/ownerMisc20260929.test.ts
npm run typecheck
```

Expected: 全部 PASS；typecheck 沒有錯誤。typecheck 若報 `transitionRequest` 的物件字面值有多餘屬性，或 `TransitionRequest` 缺欄位，代表 A 的 schema 跟「對總覽的調整」第 7 條不同：以 `contracts/generated/website-api.d.ts` 為準修正 `transitionRequest()` 與 `admissionsApi.test.ts` 的預期本文，並在回報裡寫出差異。

- [ ] **Step 20：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/api/admissions.ts admin/src/api/errors.ts admin/src/admissions/constants.ts admin/src/admissions/academic.ts \
  admin/src/admissions/useAdmissionsFilters.ts admin/src/views/AdmissionsView.vue admin/src/components/admissions/StatsTab.vue \
  admin/src/router/index.ts admin/src/router/nav.ts admin/src/components/AdminSidebar.vue \
  admin/src/__tests__/admissionsTestKit.ts admin/src/__tests__/admissionsAcademic.test.ts admin/src/__tests__/admissionsConstants.test.ts \
  admin/src/__tests__/admissionsApi.test.ts admin/src/__tests__/admissionsView.test.ts
# Step 1 若補了型別別名或測試權限表，另外加上：admin/src/api/types.ts admin/src/__tests__/fixtures.ts
git commit -m "feat(admin): 招生入學頁骨架、篩選與網址同步、學期與年級工具

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2：訪視明細（列表、篩選、表單、歷程、退出、刪除）與月份網址同步

**Files:**
- Create: `admin/src/components/admissions/RecordsTab.vue`、`admin/src/components/admissions/RecordDialog.vue`、`admin/src/components/admissions/EventsDrawer.vue`
- Modify: `admin/src/admissions/useAdmissionsFilters.ts`（加 `month`，見本檔調整第 15 條）、`admin/src/views/AdmissionsView.vue`（掛上訪視明細）
- Test: `admin/src/__tests__/admissionsRecords.test.ts`、`admin/src/__tests__/admissionsRecordDialog.test.ts`

**Interfaces:**
- Consumes：B1 的 `api/admissions.ts`（`listRecords`、`getOptions`、`createRecord`、`getRecord`、`updateRecord`、`deleteRecord`、`listEvents`、`transition`、`transitionRequest`）、`admissions/constants.ts`、`admissions/academic.ts`、`useAdmissionsFilters`、`admissionsTestKit.ts`；`api/labels.ts` 的 `campusLabel`、`formatDateTime`；`composables/useNarrowScreen`、`useRequestSequence`、`usePermissions`。
- Produces：
  - `useAdmissionsFilters()` 回傳值多一個 `month: Ref<string>`（民國月份 `115.09`，空字串＝不限），與 URL query `month` 雙向同步。
  - `RecordsTab.vue`：`props { campusKey: string; schoolYear: number | null; semester: Semester | null; month: string; visitRequestId: string }`；`emits { 'update:month': [value: string]; 'update:visitRequestId': [value: string]; 'clear-term': [] }`。
  - `RecordDialog.vue`：`v-model`（boolean）；`props { mode: 'add' | 'edit'; campusKey: string; record?: RecruitmentVisit | null; options?: AdmissionsOptions | null }`；`emits { saved: [visit: RecruitmentVisit]; stale: [] }`。B3 的看板「新增訪視」沿用。
  - `EventsDrawer.vue`：`v-model`（boolean）；`props { visitId: string | null; childName?: string }`。B3 的看板點卡片沿用。
  - 給 C3：`AdmissionsView` 收到 `open-records` 時 `router.push({ query: { ...route.query, tab: 'records', month } })` 即可，明細會以該月份查詢（本 task 的測試鎖定）。

- [ ] **Step 1：明細分頁的失敗測試 `admin/src/__tests__/admissionsRecords.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, bodyOf, button, cleanup, deferred, hasButton, mockDelete, mockGet, mockPost, mountWith, options,
  pathsTo, queryOf, reception, visit, VR_ID,
} from './admissionsTestKit'

afterEach(cleanup)

type Spy = Parameters<typeof pathsTo>[0]
const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '', ...changes })
const listPaths = (get: Spy) => pathsTo(get, '/admin/admissions/records?')
const lastQuery = (get: Spy) => queryOf(listPaths(get).at(-1)!)
const rowTexts = (wrapper: VueWrapper) => wrapper.findAll('.records-table .el-table__body tr').map((row) => row.text())
const selectByPlaceholder = (wrapper: VueWrapper, placeholder: string) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === placeholder)!

// 列的「更多」選單掛在 body 底下，每一列有自己的 popper-class，打開後從 document 找選項。
async function moreItems(wrapper: VueWrapper, id: string): Promise<HTMLElement[]> {
  await wrapper.get(`[data-more="${id}"]`).trigger('click')
  await vi.waitFor(() => expect(document.body.querySelector(`.records-more-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
  return [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)]
}
const labelsOf = (items: HTMLElement[]) => items.map((item) => item.textContent?.trim() ?? '')
async function chooseMore(wrapper: VueWrapper, id: string, label: string) {
  const item = (await moreItems(wrapper, id)).find((element) => element.textContent?.trim() === label)
  expect(item, `更多選單裡要有「${label}」`).toBeDefined()
  item!.click()
  await flushPromises()
}

describe('訪視明細：載入、空資料、錯誤（規格第 10 節）', () => {
  it('以校區、入學學年學期、月份查詢，每頁 50 筆；列出民國參觀日期、入學學期、預繳與官網預約', async () => {
    const get = mockGet({
      '/admin/admissions/records': [
        visit({ visit_request_id: VR_ID, has_visit_request: true }),
        visit({ id: 'v-2', child_name: '李小樂', has_deposit: true, stage: 'deposited', target_semester: 2 }),
        visit({ id: 'v-3', child_name: '張小晴', withdrawn_at: '2026-09-20T02:00:00Z', withdrawn_from: 'deposited', stage: 'withdrawn' }),
        visit({ id: 'v-4', child_name: '（未填姓名）' }),
      ],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ semester: 1, month: '115.09' }) })
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', month: '115.09', target_school_year: '115', target_semester: '1', page: '1', page_size: '50',
    })
    const rows = rowTexts(wrapper)
    for (const text of ['115.09.08', '王小安', '小班', '115 上學期', '官網預約', '否']) expect(rows[0]).toContain(text)
    expect(rows[1]).toContain('115 下學期')
    expect(rows[1]).toContain('是')
    expect(rows[2]).toContain('已退預繳')
    expect(rows[3]).toContain('待補')
    // 有 booking.read 才看得到預約明細的連結。
    expect(wrapper.find(`a[href="/visit-requests/${VR_ID}"]`).text()).toBe('查看預約')
  })

  it('沒有資料時說明原因；有篩選時改說篩選下沒有', async () => {
    mockGet({ '/admin/admissions/records': [], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.text()).toContain('義華在 115 學年還沒有招生訪視。')
    expect(wrapper.text()).not.toContain('0 筆')
    await wrapper.setProps({ month: '115.09' })
    await flushPromises()
    expect(wrapper.text()).toContain('目前篩選條件下沒有訪視紀錄。')
  })

  it('讀取失敗顯示錯誤，按重新載入再讀一次', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/records': () => {
        if (fail) throw new Error('offline')
        return [visit()]
      },
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    expect(wrapper.text()).toContain('載入明細失敗')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(listPaths(get)).toHaveLength(2)
    expect(rowTexts(wrapper)[0]).toContain('王小安')
  })

  it('快速切換校區：先送出的義華較晚回來，也只顯示仁武', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/records': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : [visit({ id: 'v-r', campus_key: 'renwu', child_name: '林小美' })],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve([visit()])
    await flushPromises()
    const rows = rowTexts(wrapper)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('林小美')
  })
})

describe('篩選、分頁與權限', () => {
  it('班別、預繳「否」送到 API 並回第一頁；滿 50 筆才有下一頁', async () => {
    const full = Array.from({ length: 50 }, (_, index) => visit({ id: `v-${index}` }))
    const get = mockGet({
      '/admin/admissions/records': (path: string) => (queryOf(path).get('page') === '1' ? full : [visit({ id: 'v-last' })]),
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await button(wrapper, '下一頁')!.trigger('click')
    await flushPromises()
    expect(lastQuery(get).get('page')).toBe('2')
    expect(button(wrapper, '下一頁')!.attributes('disabled')).toBeDefined()

    selectByPlaceholder(wrapper, '全部班別').vm.$emit('update:modelValue', '小班')
    selectByPlaceholder(wrapper, '不限').vm.$emit('update:modelValue', 'no')
    await flushPromises()
    const query = lastQuery(get)
    expect(query.get('grade')).toBe('小班')
    expect(query.get('has_deposit')).toBe('false')
    expect(query.get('page')).toBe('1')
  })

  it('月份選項來自 options，選了就往上更新（由頁面寫進網址）', async () => {
    mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const month = selectByPlaceholder(wrapper, '全部月份')
    expect(wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toEqual(expect.arrayContaining(['115.09', '115.08']))
    month.vm.$emit('update:modelValue', '115.08')
    expect(wrapper.emitted('update:month')).toEqual([['115.08']])
  })

  it('從預約明細連進來（vr）只看那一筆；「顯示全部」清掉', async () => {
    const get = mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ schoolYear: null, visitRequestId: VR_ID }) })
    expect(lastQuery(get).get('visit_request_id')).toBe(VR_ID)
    expect(lastQuery(get).has('target_school_year')).toBe(false)
    expect(wrapper.text()).toContain('只顯示這筆官網預約建立的招生訪視。')
    await button(wrapper, '顯示全部')!.trigger('click')
    expect(wrapper.emitted('update:visitRequestId')).toEqual([['']])
  })

  it('只能看招生的帳號：沒有新增、編輯、更多，仍可看歷程', async () => {
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props(), user: admissionsViewer() })
    expect(hasButton(wrapper, '新增訪視')).toBe(false)
    expect(hasButton(wrapper, '編輯')).toBe(false)
    expect(hasButton(wrapper, '更多')).toBe(false)
    expect(hasButton(wrapper, '歷程')).toBe(true)
  })

  it('櫃台（沒有 admissions.convert）：已註冊的列不能退註冊，已預繳的列可以退預繳', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-e', has_deposit: false, enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled' }),
        visit({ id: 'v-d', has_deposit: true, stage: 'deposited' }),
      ],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props(), user: reception() })
    const enrolled = labelsOf(await moreItems(wrapper, 'v-e'))
    expect(enrolled).toContain('刪除')
    expect(enrolled).not.toContain('退註冊')
    expect(labelsOf(await moreItems(wrapper, 'v-d'))).toContain('退預繳')
  })

  it('新增、編輯都開同一個表單；編輯帶入那一列', async () => {
    mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    const dialog = wrapper.getComponent(RecordDialog)
    await button(wrapper, '新增訪視')!.trigger('click')
    expect(dialog.props()).toMatchObject({ modelValue: true, mode: 'add', campusKey: 'yihua' })
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    await button(wrapper, '編輯')!.trigger('click')
    expect(dialog.props('mode')).toBe('edit')
    expect(dialog.props('record')).toMatchObject({ id: 'v-1', child_name: '王小安' })
  })
})

describe('退出與刪除', () => {
  it('已預繳的列「更多 → 退預繳」要填原因，送狀態轉換並重新整理', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '  家長搬家  ', action: 'confirm' } as never)
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', version: 3 })], '/admin/admissions/options': options() })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'withdrawn' }) })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '退預繳')
    expect(prompt.mock.calls[0]![1]).toBe('退預繳')
    expect(String(prompt.mock.calls[0]![0])).toBe('將標記退預繳。若已實際收款，退款要另外處理。')
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toEqual({
      to_stage: 'withdrawn', expected_version: 3, reason: '家長搬家', deposit_collector: null,
      enrolled_on: null, grade: null, target_school_year: null, target_semester: null,
    })
    expect(success).toHaveBeenCalledWith('已退預繳')
    expect(listPaths(get)).toHaveLength(2)
  })

  it('退出時別人剛改過狀態：照園務提示並重新整理，不顯示錯誤', async () => {
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '家長搬家', action: 'confirm' } as never)
    const info = vi.spyOn(ElMessage, 'info')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({
      '/admin/admissions/records/v-1/transition': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 2 })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '退預繳')
    expect(info).toHaveBeenCalledWith('狀態已被其他人變更，已自動重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(listPaths(get)).toHaveLength(2)
  })

  it('刪除先確認、帶版本；別人剛改過就提示並重新整理', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const info = vi.spyOn(ElMessage, 'info')
    const get = mockGet({ '/admin/admissions/records': [visit({ version: 2 })], '/admin/admissions/options': options() })
    const remove = mockDelete({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 3 })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(String(confirm.mock.calls[0]![0])).toContain('確定刪除此筆記錄？')
    expect(remove).toHaveBeenCalledWith('/admin/admissions/records/v-1?expected_version=2')
    expect(info).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    expect(listPaths(get)).toHaveLength(2)
  })

  it('刪除成功提示並重新整理；按取消不送出', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({ '/admin/admissions/records': [visit()], '/admin/admissions/options': options() })
    const remove = mockDelete()
    const { wrapper } = await mountWith(RecordsTab, { props: props() })
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(remove).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await chooseMore(wrapper, 'v-1', '刪除')
    expect(remove).toHaveBeenCalledOnce()
    expect(success).toHaveBeenCalledWith('刪除成功')
  })
})

describe('月份篩選與網址（C3 統計分頁跳到明細的接縫，本檔調整第 15 條）', () => {
  const pageRoutes = () => ({
    '/admin/admissions/arrivals': { awaiting: [], missing: [] },
    '/admin/admissions/records': [visit()],
    '/admin/admissions/options': options(),
  })

  it('網址帶 tab=records&month=115.09 時明細以該月份查詢', async () => {
    const get = mockGet(pageRoutes())
    const { router } = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=115.09' })
    expect(lastQuery(get).get('month')).toBe('115.09')
    expect(router.currentRoute.value.query.month).toBe('115.09')
  })

  it('網址上格式不對的月份不採用，也從網址拿掉', async () => {
    const get = mockGet(pageRoutes())
    const { router } = await mountWith(AdmissionsView, { path: '/admissions?tab=records&month=2026-09' })
    expect(lastQuery(get).has('month')).toBe(false)
    expect(router.currentRoute.value.query.month).toBeUndefined()
  })

  it('統計分頁用 router.push 帶 month 切過來（C3 的做法）；清除篩選連月份、學年學期一起清', async () => {
    const get = mockGet(pageRoutes())
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=stats&sem=1' })
    await router.push({ query: { ...router.currentRoute.value.query, tab: 'records', month: '115.08' } })
    await flushPromises()
    expect(lastQuery(get).get('month')).toBe('115.08')
    expect(lastQuery(get).get('target_semester')).toBe('1')
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'records', month: '115.08', sem: '1' })

    await button(wrapper, '清除篩選')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', tab: 'records' })
    const cleared = lastQuery(get)
    expect(cleared.has('month')).toBe(false)
    expect(cleared.has('target_school_year')).toBe(false)
    expect(cleared.has('target_semester')).toBe(false)
  })

  it('明細裡選月份會寫回網址', async () => {
    mockGet(pageRoutes())
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=records' })
    selectByPlaceholder(wrapper, '全部月份').vm.$emit('update:modelValue', '115.09')
    await flushPromises()
    expect(router.currentRoute.value.query.month).toBe('115.09')
  })
})
```

- [ ] **Step 2：表單與歷程的失敗測試 `admin/src/__tests__/admissionsRecordDialog.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import { ApiError } from '../api/client'
import { cleanup, mockGet, mockPatch, mockPost, mountWith, options, visit } from './admissionsTestKit'

afterEach(cleanup)

// 對話框與抽屜都 append-to-body：內容從 document 找，元件用 findAllComponents 找。
const bodyText = () => document.body.textContent ?? ''
const field = <T extends HTMLInputElement | HTMLTextAreaElement>(selector: string) => document.body.querySelector<T>(selector)!
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input'))
}
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)
const byPlaceholder = (wrapper: VueWrapper, name: 'ElSelect' | 'ElDatePicker', placeholder: string) =>
  wrapper.findAllComponents({ name }).find((component) => component.props('placeholder') === placeholder)!

async function openDialog(props: Record<string, unknown>) {
  const mounted = await mountWith(RecordDialog, { props: { modelValue: false, campusKey: 'renwu', options: options(), ...props } })
  await mounted.wrapper.setProps({ modelValue: true })
  await flushPromises()
  return mounted
}

describe('新增訪視（規格 6.1 第 3 點）', () => {
  it('四個必填、生日帶出適讀班級、民國日期提示；送出不帶預繳註冊等欄位；儲存並新增下一筆沿用入學學期', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const success = vi.spyOn(ElMessage, 'success')
    const post = mockPost({ '/admin/admissions/records': (_path: string, body?: unknown) => visit({ ...(body as object), id: 'v-new' }) })
    const { wrapper } = await openDialog({ mode: 'add', record: null })

    expect(bodyText()).toContain('新增訪視紀錄')
    expect(bodyText()).toContain('自動產生')
    expect(bodyText()).toContain('民國：115.10.01（月份：115.10）')
    expect(bodyButton('儲存')!.disabled).toBe(true)
    expect(bodyText()).toContain('還不能儲存：還沒填幼生姓名、生日')

    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    const grade = byPlaceholder(wrapper, 'ElSelect', '請選擇班別')
    expect(grade.props('modelValue')).toBe('小班')
    expect(bodyText()).toContain('✓ 已依生日 × 115 學年自動判定，可手動修改')

    // 改成明年入學：上次是自動帶入，跟著改；手動選過就不再覆寫。
    const year = byPlaceholder(wrapper, 'ElSelect', '學年')
    year.vm.$emit('update:modelValue', 116)
    await flushPromises()
    expect(grade.props('modelValue')).toBe('中班')

    bodyButton('儲存並新增下一筆')!.click()
    await flushPromises()
    expect(post.mock.calls[0]![0]).toBe('/admin/admissions/records?campus_key=renwu')
    const body = post.mock.calls[0]![1] as Record<string, unknown>
    expect(body).toMatchObject({
      child_name: '陳小寶', birthday: '2023-03-02', visit_date: '2026-10-01', grade: '中班', target_school_year: 116, target_semester: 1,
      contact_name: null, phone: null, transfer_term: false,
    })
    for (const key of ['has_deposit', 'enrolled', 'enrolled_on', 'withdrawn_at', 'provisional_grade', 'month', 'seq_no', 'source_category', 'rides_bus', 'tour_guide_user_id', 'geocoding_consent_at']) {
      expect(body, key).not.toHaveProperty(key)
    }
    expect(success).toHaveBeenCalledWith('已儲存，可繼續新增下一筆')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(field<HTMLInputElement>('input[aria-label="幼生姓名"]').value).toBe('')
    expect(year.props('modelValue')).toBe(116)
    expect(grade.props('modelValue')).toBeNull()
  })

  it('手動選過的適讀班級，改生日也不覆寫', async () => {
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    const grade = byPlaceholder(wrapper, 'ElSelect', '請選擇班別')
    grade.vm.$emit('update:modelValue', '大班')
    grade.vm.$emit('change', '大班')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    expect(grade.props('modelValue')).toBe('大班')
    expect(bodyText()).not.toContain('自動判定')
  })

  it('後端拒絕時錯誤寫在對話框裡，不關閉', async () => {
    mockPost({
      '/admin/admissions/records': () => {
        throw new ApiError(422, [{ loc: ['body', 'grade'], msg: 'Value error, 年級只能是幼幼班、小班、中班、大班', type: 'value_error' }])
      },
    })
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(bodyText()).toContain('年級只能是幼幼班、小班、中班、大班')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('編輯訪視（規格 6.6）', () => {
  it('帶入原值，只送改過的欄位與版本；自動建立、沒有生日的也能存', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const record = visit({ birthday: null, grade: null, notes: '家長想了解：午睡', version: 4, has_visit_request: true, seq_no: '7' })
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ notes: '已電訪，下週回覆', version: 5 }) })
    const { wrapper } = await openDialog({ mode: 'edit', record })
    expect(bodyText()).toContain('編輯訪視紀錄')
    expect(bodyText()).toContain('序號 7')
    expect(field<HTMLInputElement>('input[aria-label="幼生姓名"]').value).toBe('王小安')
    expect(bodyText()).not.toContain('還不能儲存')

    typeInto(field('textarea[aria-label="備註"]'), '已電訪，下週回覆')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { notes: '已電訪，下週回覆', expected_version: 4 })
    expect(success).toHaveBeenCalledWith('更新成功')
    expect(wrapper.emitted('saved')![0]).toEqual([expect.objectContaining({ version: 5 })])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('預繳狀態只顯示、不能在表單改；已預繳才可以填收預繳人員', async () => {
    await openDialog({ mode: 'edit', record: visit({ has_deposit: true, stage: 'deposited' }) })
    expect(bodyText()).toContain('目前階段：已預繳')
    expect(bodyText()).toContain('預繳、註冊與退出請在漏斗看板拖曳卡片，或用明細列的按鈕')
    expect(document.body.querySelector('input[aria-label="收預繳人員"]')).not.toBeNull()
    // 已預繳就不問未預繳原因。
    expect(bodyText()).not.toContain('未預繳原因')
  })

  it('別人剛改過：提示、載入最新內容、通知列表重新整理，不關閉', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockGet({ '/admin/admissions/records/v-1': visit({ notes: '別人改的', version: 5 }) })
    mockPatch({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 5 })
      },
    })
    const { wrapper } = await openDialog({ mode: 'edit', record: visit({ version: 4 }) })
    typeInto(field('textarea[aria-label="備註"]'), '我的修改')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已載入最新的內容；你的修改沒有儲存，請確認後再改')
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(field<HTMLTextAreaElement>('textarea[aria-label="備註"]').value).toBe('別人改的')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('有改動時關閉要先確認；按先不要就留著', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const { wrapper } = await openDialog({ mode: 'edit', record: visit() })
    typeInto(field('textarea[aria-label="備註"]'), '還沒存')
    await flushPromises()
    bodyButton('取消')!.click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![1]).toBe('放棄這次修改？')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('歷程抽屜（規格第 10 節：歷程不露英文代碼）', () => {
  const events = [
    { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, created_at: '2026-09-08T02:00:00Z' },
    { id: 'e2', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, created_at: '2026-09-10T02:00:00Z' },
    { id: 'e3', event_type: 'seat_reserved', from_stage: 'deposited', to_stage: 'deposited', reason: null, metadata_json: { grade: '小班', school_year: 115, semester: 1 }, created_at: '2026-09-11T02:00:00Z' },
    { id: 'e4', event_type: 'withdrawn', from_stage: 'deposited', to_stage: 'withdrawn', reason: '家長搬家', metadata_json: null, created_at: '2026-09-12T02:00:00Z' },
  ]

  it('事件中文、階段變化、原因；座位事件寫年級學期，不寫「已預繳 → 已預繳」', async () => {
    const get = mockGet({ '/admin/admissions/records/v-1/events': events })
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1', childName: '王小安' } })
    expect(get).not.toHaveBeenCalled()
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const text = bodyText()
    for (const expected of ['參觀→入學 歷程', '幼生：王小安', '建立訪視（官網預約到場）', '加上預繳', '已訪視 → 已預繳', '保留座位', '小班・115 上學期', '已預繳 → 退預繳／退註冊', '家長搬家']) {
      expect(text).toContain(expected)
    }
    expect(text).not.toContain('已預繳 → 已預繳')
    expect(text).not.toContain('seat_reserved')
    expect(text).not.toContain('— → 已訪視')
  })

  it('沒有事件時說明；讀不到時顯示錯誤，可以重新載入', async () => {
    let fail = true
    mockGet({
      '/admin/admissions/records/v-1/events': () => {
        if (fail) throw new Error('offline')
        return []
      },
    })
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1' } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(bodyText()).toContain('無法讀取歷程')
    fail = false
    bodyButton('重新載入')!.click()
    await flushPromises()
    expect(bodyText()).toContain('尚無歷程事件')
  })
})
```

- [ ] **Step 3：跑兩支測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsRecords.test.ts`
Expected: FAIL，`Failed to resolve import "../components/admissions/RecordsTab.vue"`。

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsRecordDialog.test.ts`
Expected: FAIL，`Failed to resolve import "../components/admissions/RecordDialog.vue"`。

- [ ] **Step 4：`admin/src/admissions/useAdmissionsFilters.ts` 加 `month`**

月份一定要放進這支 composable 的狀態：只放在 `RecordsTab` 的話，網址改變時 `apply()` 讀回、`syncUrl()` 依 `stateQuery()` 寫回，`month` 會被當成多餘的參數洗掉（C3 的 `router.push({ query: { ...route.query, tab: 'records', month } })` 就沒有效果）。

1. `const UUID = …` 那一行之後加：

```ts
// 民國月份「115.09」（園務 ROC_MONTH_PATTERN 允許兩到三位數年份）。
const ROC_MONTH = /^\d{2,3}\.(0[1-9]|1[0-2])$/
```

2. `const visitRequestId = ref('')` 之後加：

```ts
  const month = ref('')
```

3. `apply()` 最後（`visitRequestId.value = …` 之後）加：

```ts
    const roc = text(query.month)
    month.value = ROC_MONTH.test(roc) ? roc : ''
```

4. `stateQuery()` 裡 `if (visitRequestId.value) query.vr = visitRequestId.value` 之後加：

```ts
    if (month.value) query.month = month.value
```

5. 寫回網址的 watch 改成同時看 `month`：

```ts
  watch([campus, schoolYear, semester, tab, visitRequestId, month], syncUrl, { immediate: true })
```

6. 檔頭說明的 `- tab：分頁；vr：…` 那一行之後補一行：

```ts
 * - month：訪視明細的參觀月份（民國 115.09）；統計分頁的「查看本月明細」帶這個切過來。
```

7. `return` 改成：

```ts
  return { campus, schoolYear, semester, tab, visitRequestId, month, visibleCampusKeys, defaultYear, clearTerm }
```

- [ ] **Step 5：歷程抽屜 `admin/src/components/admissions/EventsDrawer.vue`**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { listEvents } from '../../api/admissions'
import type { RecruitmentEvent } from '../../api/types'
import { formatDateTime } from '../../api/labels'
import { termLabel } from '../../admissions/academic'
import { eventLabel, stageLabel } from '../../admissions/constants'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 參觀→入學歷程（園務 JourneyTimeline／RecruitmentTimelineList）。明細的「歷程」與看板點卡片共用。
// 園務的坑不照抄：座位事件的起訖階段相同（已預繳 → 已預繳），改寫年級與學期；
// 建立訪視沒有起始階段，不寫「— → 已訪視」。
const props = defineProps<{ visitId: string | null; childName?: string }>()
const open = defineModel<boolean>({ required: true })

const events = ref<RecruitmentEvent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  if (!props.visitId) return
  const request = requests.begin()
  loading.value = true
  error.value = null
  events.value = []
  try {
    const result = await listEvents(props.visitId)
    if (requests.isCurrent(request)) events.value = Array.isArray(result) ? result : []
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取歷程'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 打開時才讀；開著換另一筆（看板連點兩張卡）也重讀，舊的回應不蓋掉新的。
watch([open, () => props.visitId], ([value]) => {
  if (value) void load()
})

function metadataOf(event: RecruitmentEvent): Record<string, unknown> {
  const metadata = event.metadata_json as unknown
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
}

function stageChange(event: RecruitmentEvent): string {
  if (!event.from_stage || !event.to_stage || event.from_stage === event.to_stage) return ''
  return `${stageLabel(event.from_stage)} → ${stageLabel(event.to_stage)}`
}

function seatDetail(event: RecruitmentEvent): string {
  if (event.event_type !== 'seat_reserved' && event.event_type !== 'seat_released') return ''
  const metadata = metadataOf(event)
  const grade = typeof metadata.grade === 'string' ? metadata.grade : ''
  const year = typeof metadata.school_year === 'number' ? metadata.school_year : null
  const semester = typeof metadata.semester === 'number' ? metadata.semester : null
  return [grade, year ? termLabel(year, semester) : ''].filter(Boolean).join('・')
}

// A 階段若在歷程帶了操作者名字（actor_name）才顯示；園務不顯示操作者。
function actorOf(event: RecruitmentEvent): string {
  const name = (event as { actor_name?: unknown }).actor_name
  return typeof name === 'string' ? name : ''
}
</script>

<template>
  <el-drawer v-model="open" title="參觀→入學 歷程" size="min(460px, 100vw)" append-to-body class="events-drawer">
    <p v-if="childName" class="hint events__lead">幼生：{{ childName }}</p>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" :rows="4" animated />
    <p v-else-if="events.length === 0" class="hint">尚無歷程事件</p>
    <ol v-else class="events">
      <li v-for="event in events" :key="event.id" class="events__item">
        <p class="events__meta">
          <time class="num">{{ formatDateTime(event.created_at) }}</time>
          <span v-if="actorOf(event)">・{{ actorOf(event) }}</span>
        </p>
        <p class="events__title">{{ eventLabel(event.event_type, event.metadata_json) }}</p>
        <p v-if="stageChange(event)" class="events__detail">{{ stageChange(event) }}</p>
        <p v-if="seatDetail(event)" class="events__detail">{{ seatDetail(event) }}</p>
        <p v-if="event.reason" class="events__reason">{{ event.reason }}</p>
      </li>
    </ol>
  </el-drawer>
</template>

<style scoped>
.events__lead {
  margin: 0 0 16px;
}

.events {
  margin: 0;
  padding: 0;
  list-style: none;
}

.events__item {
  display: grid;
  gap: 2px;
  padding: 12px 0 12px 14px;
  border-left: 2px solid var(--line);
}

.events__item p {
  margin: 0;
  overflow-wrap: anywhere;
}

.events__meta {
  color: var(--ink-3);
  font-size: 13px;
}

.events__title {
  color: var(--ink);
  font-weight: 600;
}

.events__detail {
  color: var(--ink-2);
  font-size: 13px;
}

.events__reason {
  color: var(--ink-2);
  font-style: italic;
  white-space: pre-wrap;
}
</style>
```

- [ ] **Step 6：訪視表單 `admin/src/components/admissions/RecordDialog.vue`**

```vue
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createRecord, getRecord, updateRecord } from '../../api/admissions'
import { apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsOptions, RecruitmentVisit, RecruitmentVisitCreate, RecruitmentVisitUpdate } from '../../api/types'
import { currentTerm, gradeForBirthday, rocDate, rocMonth, schoolYearOptions, taipeiToday } from '../../admissions/academic'
import { GRADES, NO_DEPOSIT_REASONS, SEMESTER_LABELS, stageLabel, type Grade } from '../../admissions/constants'

// 訪視表單（園務 RecruitmentRecordDialog，分區同園務：基本資料、聯絡與來源、預繳狀態、備註）。
// 官網第一版不放來源分類、帶參觀老師、娃娃車、地址分析同意（本檔調整第 10 條）。
// 預繳、註冊、退出只能走狀態轉換（園務 stateLocked）；這些欄位一律不送，後端 extra="forbid"。
// 生日只有新增時必填：預約到場自動建立的訪視可能沒有生日，編輯時不擋（本檔調整第 17 條）。
const props = defineProps<{
  mode: 'add' | 'edit'
  campusKey: string
  record?: RecruitmentVisit | null
  options?: AdmissionsOptions | null
}>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

type Semester = 1 | 2
// 年級與未預繳原因用列舉型別：後端 schema 若是 Literal，產生的 TS 型別就是字面值聯集。
type NoDepositReason = (typeof NO_DEPOSIT_REASONS)[number]

interface FormState {
  child_name: string
  birthday: string | null
  contact_name: string
  phone: string
  visit_date: string | null
  target_school_year: number | null
  target_semester: Semester | null
  grade: Grade | null
  address: string
  source: string
  referrer: string
  deposit_collector: string
  transfer_term: boolean
  no_deposit_reason: NoDepositReason | null
  no_deposit_reason_detail: string
  notes: string
  parent_response: string
}

function blank(term?: { year: number | null; semester: Semester | null }): FormState {
  const now = currentTerm()
  return {
    child_name: '', birthday: null, contact_name: '', phone: '',
    // 園務：參觀日期預設今天（九成是當天登記）；入學學期預設當前學期，可改。
    visit_date: taipeiToday(),
    target_school_year: term ? term.year : now.schoolYear,
    target_semester: term ? term.semester : now.semester,
    grade: null, address: '', source: '', referrer: '', deposit_collector: '', transfer_term: false,
    no_deposit_reason: null, no_deposit_reason_detail: '', notes: '', parent_response: '',
  }
}

function fromRecord(record: RecruitmentVisit): FormState {
  return {
    child_name: record.child_name,
    birthday: record.birthday ?? null,
    contact_name: record.contact_name ?? '',
    phone: record.phone ?? '',
    visit_date: record.visit_date,
    target_school_year: record.target_school_year ?? null,
    target_semester: record.target_semester === 1 || record.target_semester === 2 ? record.target_semester : null,
    grade: (record.grade as Grade | null | undefined) ?? null,
    address: record.address ?? '',
    source: record.source ?? '',
    referrer: record.referrer ?? '',
    deposit_collector: record.deposit_collector ?? '',
    transfer_term: record.transfer_term,
    no_deposit_reason: (record.no_deposit_reason as NoDepositReason | null | undefined) ?? null,
    no_deposit_reason_detail: record.no_deposit_reason_detail ?? '',
    notes: record.notes ?? '',
    parent_response: record.parent_response ?? '',
  }
}

const form = reactive<FormState>(blank())
const current = ref<RecruitmentVisit | null>(null)
const initial = ref('')
const autoGrade = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const sections = ref<string[]>([])

function reset(state: FormState) {
  Object.assign(form, state)
  initial.value = JSON.stringify(form)
  autoGrade.value = false
  error.value = null
}

watch(open, (value) => {
  if (!value) return
  current.value = props.mode === 'edit' ? (props.record ?? null) : null
  reset(current.value ? fromRecord(current.value) : blank())
  sections.value = []
})

const hasDeposit = computed(() => Boolean(current.value?.has_deposit))
const defaultYear = currentTerm().schoolYear
// 園務表單的學年選項：今年 +3、+2、+1、今年、−1；編輯舊資料時把它原本的學年也放進來。
const yearChoices = computed(() => {
  const years = schoolYearOptions(defaultYear, [3, 2, 1, 0, -1])
  const own = form.target_school_year
  return own && !years.includes(own) ? [...years, own].sort((a, b) => b - a) : years
})

// 生日 × 入學學年自動判定適讀班級：只在班級空著、或上次是自動帶入時覆寫（園務 :405-422）。
function autoFillGrade() {
  const grade = gradeForBirthday(form.birthday, form.target_school_year)
  if (!grade) return
  if (!form.grade || autoGrade.value) {
    form.grade = grade
    autoGrade.value = true
  }
}
function setBirthday(value: string | null | undefined) {
  form.birthday = value || null
  autoFillGrade()
}
function setYear(value: number | null | undefined) {
  form.target_school_year = value ?? null
  autoFillGrade()
}
function onGradeChange() {
  autoGrade.value = false
}

const visitDateHint = computed(() => (form.visit_date ? `民國：${rocDate(form.visit_date)}（月份：${rocMonth(form.visit_date)}）` : ''))

const missing = computed(() => [
  form.child_name.trim() ? '' : '幼生姓名',
  props.mode === 'add' && !form.birthday ? '生日' : '',
  form.visit_date ? '' : '參觀日期',
  form.target_school_year && form.target_semester ? '' : '入學學期',
].filter(Boolean))

const filled = (values: unknown[]) => values.filter((value) => typeof value === 'string' && value.trim()).length
const contactSummary = computed(() => {
  const count = filled([form.address, form.source, form.referrer])
  return count ? `已填 ${count} 項` : '未填'
})
const notesSummary = computed(() => {
  const count = filled([form.notes, form.parent_response])
  return count ? `已填 ${count} 項` : '未填'
})

const text = (value: string) => value.trim() || null

// 新增與編輯共用的欄位（不含狀態欄位）；編輯時拿原值也跑一次，比對出真的改過的欄位。
function payload(state: FormState) {
  return {
    child_name: state.child_name.trim(),
    birthday: state.birthday,
    contact_name: text(state.contact_name),
    phone: text(state.phone),
    visit_date: state.visit_date ?? '',
    target_school_year: state.target_school_year,
    target_semester: state.target_semester,
    grade: state.grade,
    address: text(state.address),
    source: text(state.source),
    referrer: text(state.referrer),
    transfer_term: state.transfer_term,
    no_deposit_reason: state.no_deposit_reason || null,
    no_deposit_reason_detail: text(state.no_deposit_reason_detail),
    notes: text(state.notes),
    parent_response: text(state.parent_response),
  }
}

function changes(record: RecruitmentVisit): Record<string, unknown> {
  const before: Record<string, unknown> = { ...payload(fromRecord(record)) }
  const after: Record<string, unknown> = { ...payload(form) }
  // 收預繳人員只在已預繳時可改；未預繳原因只在未預繳時顯示，已預繳就不動它。
  if (record.has_deposit) {
    before.deposit_collector = record.deposit_collector ?? null
    after.deposit_collector = text(form.deposit_collector)
    delete before.no_deposit_reason
    delete before.no_deposit_reason_detail
    delete after.no_deposit_reason
    delete after.no_deposit_reason_detail
  }
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => (before[key] ?? null) !== (value ?? null)))
}

async function save(next = false) {
  if (missing.value.length || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    if (props.mode === 'add') {
      // missing 已擋下空值，這裡收窄型別（新增時這三欄必填，schema 可能不接受 null）。
      const body: RecruitmentVisitCreate = {
        ...payload(form), birthday: form.birthday!, target_school_year: form.target_school_year!, target_semester: form.target_semester!,
      }
      const created = await createRecord(props.campusKey, body)
      emit('saved', created)
      if (next) {
        // 儲存並新增下一筆：不關窗，換空白表單，沿用上一筆的入學學年學期（園務 FunnelAddVisit）。
        ElMessage.success('已儲存，可繼續新增下一筆')
        reset(blank({ year: form.target_school_year, semester: form.target_semester }))
      } else {
        ElMessage.success('新增成功')
        open.value = false
      }
      return
    }
    const record = current.value
    if (!record) return
    const changed = changes(record)
    if (Object.keys(changed).length === 0) {
      open.value = false
      return
    }
    // 只送改過的欄位：後端以 model_fields_set 區分「沒送」與「清空」。
    const body = { ...changed, expected_version: record.version } as RecruitmentVisitUpdate
    const updated = await updateRecord(record.id, body)
    ElMessage.success('更新成功')
    open.value = false
    emit('saved', updated)
  } catch (err) {
    if (isVersionConflict(err) && current.value) {
      ElMessage.warning('這筆招生訪視剛被其他人修改，已載入最新的內容；你的修改沒有儲存，請確認後再改')
      emit('stale')
      try {
        current.value = await getRecord(current.value.id)
        reset(fromRecord(current.value))
      } catch {
        open.value = false
      }
    } else {
      error.value = apiErrorMessage(err, '儲存失敗')
    }
  } finally {
    submitting.value = false
  }
}

const dirty = computed(() => open.value && JSON.stringify(form) !== initial.value)

// 邊講電話邊填，誤按 Esc、右上角 X 或「取消」不能讓整筆消失；送出中不能關（同 ManualVisitDialog）。
async function beforeClose(done: () => void) {
  if (submitting.value) return
  if (!dirty.value) {
    done()
    return
  }
  try {
    await ElMessageBox.confirm('已經填的內容會清掉。', props.mode === 'add' ? '放棄這筆訪視紀錄？' : '放棄這次修改？', {
      confirmButtonText: '放棄填寫',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  done()
}

function requestClose() {
  void beforeClose(() => {
    open.value = false
  })
}

function disableFuture(date: Date): boolean {
  return date.getTime() > Date.now()
}

function suggest(list: readonly string[] | undefined) {
  return (query: string, callback: (items: { value: string }[]) => void) => {
    const keyword = query.trim()
    callback((list ?? []).filter((item) => !keyword || item.includes(keyword)).map((value) => ({ value })))
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="record-dialog"
    width="min(680px, calc(100vw - 32px))"
    top="5vh"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    :before-close="beforeClose"
  >
    <template #header>
      <div class="record-dialog__head">
        <h2 class="record-dialog__title">{{ mode === 'add' ? '新增訪視紀錄' : '編輯訪視紀錄' }}</h2>
        <!-- 序號由後端依同校同月份配號，不是輸入欄（園務同樣只顯示）。 -->
        <span class="record-dialog__seq">序號 {{ mode === 'add' ? '自動產生' : current?.seq_no || '—' }}</span>
      </div>
    </template>

    <p class="hint record-dialog__lead">* 為必填，其餘可日後補。</p>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="record-dialog__alert" />

    <el-form label-position="top" :disabled="submitting" @submit.prevent>
      <div class="record-dialog__row">
        <el-form-item label="幼生姓名" required>
          <el-input v-model="form.child_name" maxlength="50" aria-label="幼生姓名" />
        </el-form-item>
        <el-form-item label="生日" :required="mode === 'add'">
          <el-date-picker :model-value="form.birthday" type="date" value-format="YYYY-MM-DD" placeholder="選擇生日" :disabled-date="disableFuture" aria-label="生日" style="width: 100%" @update:model-value="setBirthday" />
        </el-form-item>
      </div>
      <div class="record-dialog__row">
        <el-form-item label="聯絡人姓名">
          <el-input v-model="form.contact_name" maxlength="50" placeholder="家長或主要照顧者" aria-label="聯絡人姓名" />
        </el-form-item>
        <el-form-item label="電話">
          <el-input v-model="form.phone" maxlength="100" inputmode="tel" aria-label="電話" />
          <span class="field-help">例：0912-345-678</span>
        </el-form-item>
      </div>
      <div class="record-dialog__row">
        <el-form-item label="參觀日期" required>
          <el-date-picker v-model="form.visit_date" type="date" value-format="YYYY-MM-DD" placeholder="選擇參觀日期（年月日）" aria-label="參觀日期" style="width: 100%" />
          <span v-if="visitDateHint" class="field-help num">{{ visitDateHint }}</span>
        </el-form-item>
        <el-form-item label="入學學期" required>
          <div class="record-dialog__term">
            <el-select :model-value="form.target_school_year ?? undefined" placeholder="學年" aria-label="入學學年" @update:model-value="setYear">
              <el-option v-for="year in yearChoices" :key="year" :label="`${year} 學年`" :value="year" />
            </el-select>
            <el-radio-group v-model="form.target_semester" aria-label="入學學期">
              <el-radio-button :value="1">{{ SEMESTER_LABELS[1] }}</el-radio-button>
              <el-radio-button :value="2">{{ SEMESTER_LABELS[2] }}</el-radio-button>
            </el-radio-group>
          </div>
          <span class="field-help">小孩預計入學的學期（預設當前學期，可改）。</span>
        </el-form-item>
      </div>
      <el-form-item label="適讀班級">
        <el-select v-model="form.grade" clearable placeholder="請選擇班別" aria-label="適讀班級" @change="onGradeChange">
          <el-option v-for="grade in GRADES" :key="grade" :label="grade" :value="grade" />
        </el-select>
        <span v-if="autoGrade" class="field-help record-dialog__auto">✓ 已依生日 × {{ form.target_school_year }} 學年自動判定，可手動修改</span>
      </el-form-item>

      <el-collapse v-model="sections" class="record-dialog__sections">
        <el-collapse-item name="contact">
          <template #title>
            <span class="record-dialog__section">聯絡與來源</span><span class="record-dialog__summary">{{ contactSummary }}</span>
          </template>
          <el-form-item label="地址">
            <el-input v-model="form.address" maxlength="200" aria-label="地址" />
          </el-form-item>
          <div class="record-dialog__row">
            <el-form-item label="幼生來源">
              <el-autocomplete v-model="form.source" :fetch-suggestions="suggest(options?.sources)" maxlength="50" placeholder="例如：親友介紹、Facebook" aria-label="幼生來源" style="width: 100%" />
            </el-form-item>
            <el-form-item label="介紹者">
              <el-autocomplete v-model="form.referrer" :fetch-suggestions="suggest(options?.referrers)" maxlength="50" aria-label="介紹者" style="width: 100%" />
              <span class="field-help">統計分析的「接待人員」看的就是這一欄。</span>
            </el-form-item>
          </div>
        </el-collapse-item>

        <el-collapse-item name="deposit">
          <template #title><span class="record-dialog__section">預繳狀態</span></template>
          <p class="record-dialog__stage">目前階段：{{ stageLabel(current?.stage ?? 'visited') }}</p>
          <p class="field-help record-dialog__locked">預繳、註冊與退出請在漏斗看板拖曳卡片，或用明細列的按鈕，才會留下紀錄與原因。</p>
          <div class="record-dialog__row">
            <el-form-item v-if="hasDeposit" label="收預繳人員">
              <el-input v-model="form.deposit_collector" maxlength="50" placeholder="預繳時填寫" aria-label="收預繳人員" />
            </el-form-item>
            <el-form-item label="轉其他學期">
              <el-switch v-model="form.transfer_term" active-text="是" inactive-text="否" aria-label="轉其他學期" />
            </el-form-item>
          </div>
          <template v-if="!hasDeposit">
            <el-form-item label="未預繳原因">
              <el-select v-model="form.no_deposit_reason" clearable placeholder="請選擇原因" aria-label="未預繳原因" style="width: 100%">
                <el-option v-for="reason in NO_DEPOSIT_REASONS" :key="reason" :label="reason" :value="reason" />
              </el-select>
            </el-form-item>
            <el-form-item label="原因說明">
              <el-input v-model="form.no_deposit_reason_detail" type="textarea" :rows="2" maxlength="2000" placeholder="詳細說明（選填）" aria-label="原因說明" />
            </el-form-item>
          </template>
        </el-collapse-item>

        <el-collapse-item name="notes">
          <template #title>
            <span class="record-dialog__section">備註</span><span class="record-dialog__summary">{{ notesSummary }}</span>
          </template>
          <el-form-item label="備註">
            <el-input v-model="form.notes" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="2000" aria-label="備註" />
          </el-form-item>
          <el-form-item label="電訪回應" class="record-dialog__last">
            <el-input v-model="form.parent_response" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="2000" aria-label="電訪回應" />
          </el-form-item>
        </el-collapse-item>
      </el-collapse>
    </el-form>

    <template #footer>
      <div class="record-dialog__footer">
        <p class="record-dialog__missing" aria-live="polite">{{ missing.length ? `還不能儲存：還沒填${missing.join('、')}` : '' }}</p>
        <div class="record-dialog__buttons">
          <el-button :disabled="submitting" @click="requestClose">取消</el-button>
          <el-button v-if="mode === 'add'" :disabled="missing.length > 0 || submitting" @click="save(true)">儲存並新增下一筆</el-button>
          <el-button type="primary" :loading="submitting" :disabled="missing.length > 0" @click="save()">儲存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.record-dialog__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.record-dialog__title {
  font-size: 17px;
}

.record-dialog__seq {
  padding: 2px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
}

.record-dialog__lead {
  margin: 0 0 12px;
}

.record-dialog__alert {
  margin-bottom: 16px;
}

.record-dialog__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.record-dialog__term {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.record-dialog__term .el-select {
  width: 120px;
}

.record-dialog__auto {
  color: var(--el-color-success);
}

.record-dialog__sections {
  margin-top: 8px;
}

.record-dialog__section {
  font-weight: 600;
}

.record-dialog__summary {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: 13px;
  font-weight: 400;
}

.record-dialog__stage {
  margin: 0;
  color: var(--ink);
  font-weight: 500;
}

.record-dialog__locked {
  margin: 0 0 12px;
}

.record-dialog__last {
  margin-bottom: 0;
}

.record-dialog__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 12px;
  width: 100%;
}

.record-dialog__missing {
  flex: 1 1 200px;
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
  text-align: left;
}

.record-dialog__missing:empty {
  flex-basis: 0;
}

.record-dialog__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.record-dialog__buttons .el-button + .el-button {
  margin-left: 0;
}

@media (max-width: 720px) {
  .record-dialog__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .record-dialog__missing {
    font-size: 14px;
  }
}
</style>

<style>
/* 對話框本體掛在 body 下，scoped 碰不到：內容區自己捲動，按鈕固定在下緣（同 manual-dialog）。 */
.record-dialog.el-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100svh - 10vh);
  margin-bottom: 5vh;
}

.record-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.record-dialog .el-dialog__footer {
  flex: none;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
</style>
```

- [ ] **Step 7：訪視明細 `admin/src/components/admissions/RecordsTab.vue`**

B3、B4 會在這支檔案加「標記註冊」與「保留座位／變更座位」，下面標了插入點。

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Plus, Search } from '@element-plus/icons-vue'
import { deleteRecord, getOptions, listRecords, transition, transitionRequest } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsOptions, RecruitmentVisit } from '../../api/types'
import { campusLabel, type TagTone } from '../../api/labels'
import { rocDate, termLabel } from '../../admissions/academic'
import { GRADES, NO_DEPOSIT_REASONS, SEMESTER_LABELS, WITHDRAWN_FROM_LABELS, transitionWarning } from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import RecordDialog from './RecordDialog.vue'
import EventsDrawer from './EventsDrawer.vue'

// 訪視明細（園務 RecruitmentDetailTab＋AdmissionsRecordsPanel）。入學學年學期用頁首的篩選，
// 這裡不重複（本檔調整第 11 條）；月份與 vr 由頁面寫進網址（第 15、16 條），其餘篩選只在分頁內。
const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: Semester | null
  month: string
  visitRequestId: string
}>()
const emit = defineEmits<{ 'update:month': [value: string]; 'update:visitRequestId': [value: string]; 'clear-term': [] }>()

const PAGE_SIZE = 50
// 預約沒填孩子姓名時，自動建立的訪視寫這個字串（後端 MISSING_CHILD_NAME），明細標示待補。
const MISSING_NAME = '（未填姓名）'
const CONFLICT_TEXT = '這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作'
// 園務收到 409 的原文（FunnelBoard.vue:240-292）；狀態轉換一律用這句。
const TRANSITION_CONFLICT_TEXT = '狀態已被其他人變更，已自動重新載入'

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const canConvert = computed(() => can('admissions.convert'))
const canSeeBooking = computed(() => can('booking.read'))
// 手機不固定操作欄（同園務），整張表在面板裡受控橫捲。
const narrow = useNarrowScreen()

const grade = ref('')
const source = ref('')
const referrer = ref('')
const hasDeposit = ref('')
const noDepositReason = ref('')
const search = ref('')
const keyword = ref('')
const page = ref(1)

const rows = ref<RecruitmentVisit[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const pendingId = ref<string | null>(null)
const requests = useRequestSequence()

const options = ref<AdmissionsOptions | null>(null)
const optionRequests = useRequestSequence()

// 分頁內的篩選（不含頁首學年學期）：決定空狀態的說法。
const filtered = computed(() =>
  Boolean(props.month || props.visitRequestId || grade.value || source.value || referrer.value || hasDeposit.value || noDepositReason.value || keyword.value),
)
// 「清除篩選」連學年學期一起清（同園務），所以有選學年或學期也算有篩選。
const hasFilters = computed(() => filtered.value || props.schoolYear !== null || props.semester !== null || Boolean(search.value))
const hasNext = computed(() => rows.value.length === PAGE_SIZE)

const monthOptions = computed(() => {
  const months = options.value?.months ?? []
  return props.month && !months.includes(props.month) ? [props.month, ...months] : months
})

const emptyText = computed(() => {
  if (filtered.value) return '目前篩選條件下沒有訪視紀錄。'
  const campus = campusLabel(props.campusKey)
  if (props.schoolYear) return `${campus}在 ${termLabel(props.schoolYear, props.semester)}還沒有招生訪視。`
  if (props.semester) return `${campus}在各學年的${SEMESTER_LABELS[props.semester]}還沒有招生訪視。`
  return `${campus}還沒有招生訪視。`
})

async function load() {
  if (!props.campusKey) return
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await listRecords({
      campus_key: props.campusKey,
      month: props.month || null,
      grade: grade.value || null,
      target_school_year: props.schoolYear,
      target_semester: props.semester,
      source: source.value || null,
      referrer: referrer.value || null,
      has_deposit: hasDeposit.value === 'yes' ? true : hasDeposit.value === 'no' ? false : null,
      no_deposit_reason: noDepositReason.value || null,
      visit_request_id: props.visitRequestId || null,
      q: keyword.value || null,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    if (!requests.isCurrent(request)) return
    rows.value = Array.isArray(result) ? result : []
  } catch {
    if (!requests.isCurrent(request)) return
    rows.value = []
    error.value = '載入明細失敗'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

async function loadOptions() {
  if (!props.campusKey) return
  const request = optionRequests.begin()
  try {
    const result = await getOptions(props.campusKey)
    if (optionRequests.isCurrent(request)) options.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
  } catch {
    // 選項讀不到只少了下拉建議，列表照常。
    if (optionRequests.isCurrent(request)) options.value = null
  }
}

// 換校：來源、介紹者是各校自己的選項，一起清掉。
watch(() => props.campusKey, () => {
  options.value = null
  source.value = ''
  referrer.value = ''
  void loadOptions()
}, { immediate: true })

// 搜尋 300ms 防抖（同參觀案件列表）。
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    keyword.value = value.trim()
  }, 300)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

// 條件一變就回第一頁；已經在第一頁就直接重讀（避免同一次變動讀兩次）。
const filterKey = computed(() => JSON.stringify([
  props.campusKey, props.schoolYear, props.semester, props.month, props.visitRequestId,
  grade.value, source.value, referrer.value, hasDeposit.value, noDepositReason.value, keyword.value,
]))
watch(filterKey, () => {
  if (page.value !== 1) page.value = 1
  else void load()
})
watch(page, () => void load())
onMounted(load)

function setMonth(value: string | null | undefined) {
  emit('update:month', value ?? '')
}

function clearFilters() {
  grade.value = ''
  source.value = ''
  referrer.value = ''
  hasDeposit.value = ''
  noDepositReason.value = ''
  clearTimeout(searchTimer)
  search.value = ''
  keyword.value = ''
  emit('update:month', '')
  emit('update:visitRequestId', '')
  emit('clear-term')
}

function depositMeta(row: RecruitmentVisit): { label: string; tone: TagTone } {
  // 退出後 has_deposit 已清成 false，跟「從沒預繳」長得一樣，要另外標（園務總覽第 6 點）。
  if (row.withdrawn_at) return { label: `已${WITHDRAWN_FROM_LABELS[row.withdrawn_from ?? 'deposited'] ?? '退預繳'}`, tone: 'danger' }
  return row.has_deposit ? { label: '是', tone: 'success' } : { label: '否', tone: 'info' }
}

function rowClass({ row }: { row: RecruitmentVisit }): string {
  return row.has_deposit ? 'records-row--deposit' : ''
}

// ---- 表單與歷程 ----
const dialogOpen = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const editing = ref<RecruitmentVisit | null>(null)
const eventsOpen = ref(false)
const eventsFor = ref<RecruitmentVisit | null>(null)

function openAdd() {
  dialogMode.value = 'add'
  editing.value = null
  dialogOpen.value = true
}

function openEdit(row: RecruitmentVisit) {
  dialogMode.value = 'edit'
  editing.value = row
  dialogOpen.value = true
}

function openEvents(row: RecruitmentVisit) {
  eventsFor.value = row
  eventsOpen.value = true
}

function onSaved() {
  void load()
  // 新的月份、來源、介紹者要出現在篩選選項裡。
  void loadOptions()
}

// ---- 列操作：更多（B4 在 withdraw 前面加 seat）----
type MoreCommand = 'withdraw' | 'delete'

function moreCommands(row: RecruitmentVisit): { command: MoreCommand; label: string }[] {
  const items: { command: MoreCommand; label: string }[] = []
  // 退預繳要 write、退註冊要 convert（規格 6.3）；已訪視沒有可退的款項（園務 :610）。
  if (row.stage === 'deposited' && canWrite.value) items.push({ command: 'withdraw', label: '退預繳' })
  if (row.stage === 'enrolled' && canConvert.value) items.push({ command: 'withdraw', label: '退註冊' })
  if (canWrite.value) items.push({ command: 'delete', label: '刪除' })
  return items
}

function onMore(row: RecruitmentVisit, command: MoreCommand) {
  if (command === 'withdraw') void withdraw(row)
  else void remove(row)
}

function reportError(err: unknown, fallback: string, conflictText = CONFLICT_TEXT) {
  if (isVersionConflict(err)) {
    ElMessage.info(conflictText)
    void load()
    return
  }
  ElMessage.error(apiErrorMessage(err, fallback))
  // 找不到（別人刪掉了）：重讀，讓那一列消失。
  if (err instanceof ApiError && err.status === 404) void load()
}

// 退出（園務 AdmissionsRecordsPanel.vue:128-166 的 prompt；文案依本檔調整第 9 條改寫）。
async function withdraw(row: RecruitmentVisit) {
  const from = row.stage === 'enrolled' ? 'enrolled' : 'deposited'
  const title = from === 'enrolled' ? '退註冊' : '退預繳'
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(`${transitionWarning(from, 'withdrawn')}。`, title, {
      confirmButtonText: '確認退出',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '請說明原因（必填）',
      inputValidator: (value: string) => Boolean(value && value.trim()) || '請填寫原因',
      type: 'warning',
    })
    reason = ((result as { value?: string }).value ?? '').trim()
  } catch {
    return
  }
  pendingId.value = row.id
  try {
    await transition(row.id, transitionRequest('withdrawn', row.version, { reason }))
    ElMessage.success(from === 'enrolled' ? '已退註冊' : '已退預繳')
    await load()
  } catch (err) {
    reportError(err, '退出失敗', TRANSITION_CONFLICT_TEXT)
  } finally {
    pendingId.value = null
  }
}

async function remove(row: RecruitmentVisit) {
  try {
    await ElMessageBox.confirm(`確定刪除此筆記錄？「${row.child_name}」的歷程會一起刪除，無法復原。`, '確認', {
      confirmButtonText: '刪除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    })
  } catch {
    return
  }
  pendingId.value = row.id
  try {
    await deleteRecord(row.id, row.version)
    ElMessage.success('刪除成功')
    await load()
  } catch (err) {
    reportError(err, '刪除失敗')
  } finally {
    pendingId.value = null
  }
}
</script>

<template>
  <section class="records">
    <div class="toolbar records__filters">
      <div class="filter-field">
        <span>月份</span>
        <el-select :model-value="month || undefined" clearable filterable placeholder="全部月份" aria-label="月份" @update:model-value="setMonth">
          <el-option v-for="item in monthOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>班別</span>
        <el-select v-model="grade" clearable placeholder="全部班別" aria-label="班別">
          <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>來源</span>
        <el-select v-model="source" clearable filterable placeholder="全部來源" aria-label="來源">
          <el-option v-for="item in options?.sources ?? []" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>介紹者</span>
        <el-select v-model="referrer" clearable filterable placeholder="全部介紹者" aria-label="介紹者">
          <el-option v-for="item in options?.referrers ?? []" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>預繳</span>
        <el-select v-model="hasDeposit" clearable placeholder="不限" aria-label="預繳">
          <el-option label="是" value="yes" />
          <el-option label="否" value="no" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>未預繳原因</span>
        <el-select v-model="noDepositReason" clearable placeholder="全部原因" aria-label="未預繳原因">
          <el-option v-for="item in NO_DEPOSIT_REASONS" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field records__search">
        <span>搜尋</span>
        <el-input v-model="search" clearable :prefix-icon="Search" placeholder="姓名/地址/備註搜尋..." aria-label="搜尋訪視" />
      </div>
      <el-button v-if="hasFilters" text class="records__clear" @click="clearFilters">清除篩選</el-button>
    </div>

    <el-alert v-if="visitRequestId" type="info" :closable="false" show-icon class="records__notice" title="只顯示這筆官網預約建立的招生訪視。">
      <el-button size="small" @click="emit('update:visitRequestId', '')">顯示全部</el-button>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="records__notice">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div v-else class="panel" :aria-busy="loading">
      <div class="panel__head">
        <h2>訪視明細</h2>
        <div class="records__head-actions">
          <!-- 沒資料時不寫「本頁 0 筆」：空狀態已經說明原因，不顯示假的 0。 -->
          <span v-if="loading || rows.length" class="hint num">{{ loading ? '載入中…' : `本頁 ${rows.length} 筆` }}</span>
          <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openAdd">新增訪視</el-button>
        </div>
      </div>
      <el-table v-loading="loading" :data="rows" class="records-table" :row-class-name="rowClass" :empty-text="loading ? '' : emptyText">
        <template #empty>
          <div v-if="!loading" class="records__empty">
            <strong>{{ emptyText }}</strong>
            <span v-if="!filtered" class="hint">手動新增，或在「官網預約」標記家長已到場後，訪視會出現在這裡。</span>
          </div>
        </template>
        <el-table-column label="參觀日期" width="100">
          <template #default="{ row }: { row: RecruitmentVisit }"><span class="num">{{ rocDate(row.visit_date) || row.month || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="姓名" min-width="150">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <span class="records__name">{{ row.child_name }}</span>
            <el-tag v-if="row.child_name === MISSING_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
            <el-tag v-if="row.has_visit_request" size="small" type="primary" effect="plain" round>官網預約</el-tag>
            <router-link v-if="row.visit_request_id && canSeeBooking" :to="`/visit-requests/${row.visit_request_id}`" class="cell-sub records__link">查看預約</router-link>
          </template>
        </el-table-column>
        <el-table-column label="班別" width="80">
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.grade || '—' }}</template>
        </el-table-column>
        <el-table-column label="入學學期" width="108">
          <template #default="{ row }: { row: RecruitmentVisit }"><span class="num">{{ termLabel(row.target_school_year, row.target_semester) }}</span></template>
        </el-table-column>
        <el-table-column label="預繳" width="96">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <el-tag :type="depositMeta(row).tone" size="small" effect="light" round>{{ depositMeta(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="地址" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.address || row.district || '—' }}</template>
        </el-table-column>
        <el-table-column label="來源" min-width="120" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.source || '—' }}</template>
        </el-table-column>
        <el-table-column label="介紹者" width="100" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.referrer || '—' }}</template>
        </el-table-column>
        <el-table-column label="已註冊" width="80">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <el-tag v-if="row.enrolled" type="success" size="small" effect="light" round>是</el-tag><span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="轉學期" width="80">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <el-tag v-if="row.transfer_term" type="warning" size="small" effect="light" round>是</el-tag><span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="未預繳原因" min-width="150" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.no_deposit_reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="備註" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.notes || '—' }}</template>
        </el-table-column>
        <el-table-column label="電訪回應" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.parent_response || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" :fixed="narrow ? false : 'right'">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <div class="cell-actions records__actions">
              <el-button v-if="canWrite" size="small" text type="primary" :disabled="pendingId === row.id" @click="openEdit(row)">編輯</el-button>
              <el-button size="small" text @click="openEvents(row)">歷程</el-button>
              <!-- B3：標記註冊 -->
              <el-dropdown
                v-if="moreCommands(row).length"
                trigger="click"
                placement="bottom-end"
                :persistent="false"
                :popper-class="`records-more-menu records-more-menu--${row.id}`"
                @command="(command: MoreCommand) => onMore(row, command)"
              >
                <el-button size="small" text :data-more="row.id" :disabled="pendingId === row.id" :aria-label="`${row.child_name} 的更多動作`">
                  更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-for="item in moreCommands(row)"
                      :key="item.command"
                      :command="item.command"
                      :divided="item.command === 'delete' && moreCommands(row).length > 1"
                      :class="{ 'records-more__danger': item.command === 'delete' }"
                    >{{ item.label }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="page > 1 || hasNext" class="records__pager">
        <el-button :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint num">第 {{ page }} 頁</span>
        <el-button :disabled="!hasNext || loading" @click="page += 1">下一頁</el-button>
      </div>
    </div>

    <RecordDialog v-model="dialogOpen" :mode="dialogMode" :campus-key="campusKey" :record="editing" :options="options" @saved="onSaved" @stale="load" />
    <EventsDrawer v-model="eventsOpen" :visit-id="eventsFor?.id ?? null" :child-name="eventsFor?.child_name ?? ''" />
    <!-- B3：TransitionDialog；B4：SeatDialog -->
  </section>
</template>

<style scoped>
.records__filters {
  align-items: flex-end;
}

.records__search .el-input {
  width: 220px;
}

.records__clear {
  margin-bottom: 2px;
}

.records__notice {
  margin-bottom: 16px;
}

.records__head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.records__name {
  margin-right: 6px;
  overflow-wrap: anywhere;
}

.records__name + .el-tag,
.records__name + .el-tag + .el-tag {
  margin-right: 4px;
}

.records__link {
  display: block;
  margin-top: 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.records__actions {
  flex-wrap: wrap;
}

.records__actions .el-button + .el-button {
  margin-left: 0;
}

/* 有預繳的列淡綠底（園務 deposit-row）。 */
.records-table :deep(.records-row--deposit) td.el-table__cell {
  background: var(--el-color-success-light-9);
}

.records__empty {
  display: grid;
  gap: 6px;
  padding: 24px 16px;
  color: var(--ink-2);
  line-height: 1.6;
  text-align: center;
}

.records__pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

@media (max-width: 720px) {
  .records__search,
  .records__search .el-input {
    width: 100%;
  }

  .records__pager {
    justify-content: space-between;
  }
}
</style>

<style>
/* 「更多」選單掛在 body 下：刪除用危險色。 */
.records-more-menu .records-more__danger {
  color: var(--el-color-danger);
}
</style>
```

表格放在 `.panel` 裡（`overflow: hidden`），欄寬總和超過面板時由 `el-table` 自己的捲動區橫捲，頁面不會整體溢出（規格第 10 節「表格受控橫捲」）。

- [ ] **Step 8：把訪視明細接上 `admin/src/views/AdmissionsView.vue`**

1. script 的 import 區，`import StatsTab …` 那一行之前加：

```ts
import RecordsTab from '../components/admissions/RecordsTab.vue'
```

2. `useAdmissionsFilters()` 那一行改成：

```ts
const { campus, schoolYear, semester, tab, visitRequestId, month, visibleCampusKeys, defaultYear, clearTerm } = useAdmissionsFilters()
```

3. template 的 `<div class="admissions__body">` 裡、`<StatsTab` 那一行之前加：

```vue
        <RecordsTab
          v-if="tab === 'records'"
          v-model:month="month"
          v-model:visitRequestId="visitRequestId"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          @clear-term="clearTerm"
        />
```

- [ ] **Step 9：跑 B2 測試、B1 頁面測試與型別檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/admissionsRecords.test.ts
npx vitest run src/__tests__/admissionsRecordDialog.test.ts
npx vitest run src/__tests__/admissionsView.test.ts
npx vitest run src/__tests__/a11yStructure.test.ts
npm run typecheck
```

Expected：全部 PASS；typecheck 沒有錯誤。typecheck 若報 `RecruitmentVisitCreate`／`RecruitmentVisitUpdate` 沒有某個欄位（例如 `transfer_term`、`no_deposit_reason_detail`），以 `contracts/generated/website-api.d.ts` 為準，從 `RecordDialog.vue` 的 `payload()` 拿掉該欄位並在回報寫出差異；不要回頭改後端。

- [ ] **Step 10：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/components/admissions/RecordsTab.vue admin/src/components/admissions/RecordDialog.vue admin/src/components/admissions/EventsDrawer.vue \
  admin/src/admissions/useAdmissionsFilters.ts admin/src/views/AdmissionsView.vue \
  admin/src/__tests__/admissionsRecords.test.ts admin/src/__tests__/admissionsRecordDialog.test.ts
git commit -m "feat(admin): 招生訪視明細、表單與歷程，月份篩選寫進網址

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3：漏斗看板（拖曳、鍵盤「移到…」、確認框、409 重載）與明細「標記註冊」

**Files:**
- Create: `admin/src/components/admissions/FunnelBoard.vue`、`admin/src/components/admissions/FunnelCard.vue`、`admin/src/components/admissions/TransitionDialog.vue`
- Modify: `admin/src/components/admissions/RecordsTab.vue`（「標記註冊」）、`admin/src/views/AdmissionsView.vue`（掛上看板、「到訪視明細處理」）
- Test: `admin/src/__tests__/admissionsFunnel.test.ts`

**Interfaces:**
- Consumes：B1 `getBoard`、`transition`、`transitionRequest`、`getOptions`；`constants.ts` 的 `STAGES`、`STAGE_LABELS`、`STAGE_TOKENS`、`STAGE_EMPTY_TEXT`、`WITHDRAWN_FROM_LABELS`、`transitionCapability`、`transitionBlockedText`、`transitionMode`、`transitionWarning`、`canDragFrom`、`moveTargets`、`TransitionTarget`；B2 的 `RecordDialog`、`EventsDrawer`。A 的 `FunnelBoardOut.columns` 是 `FunnelColumnsOut`（四個 list，A 調整第 8 條）。
- Produces：
  - `FunnelBoard.vue`：`props { campusKey: string; schoolYear: number | null; semester: Semester | null }`；`emits { 'show-unscoped': [] }`。
  - `FunnelCard.vue`：`props { card: FunnelCard; stage: Stage; draggable: boolean; targets: readonly Stage[] }`；`emits { open: []; move: [to: Stage]; dragstart: []; dragend: [] }`。
  - `TransitionDialog.vue`：`v-model`（boolean）；`props { target: TransitionTarget | null }`；`emits { done: [visit: RecruitmentVisit]; stale: [] }`。409 時自己顯示「狀態已被其他人變更，已自動重新載入」並 emit `stale`，由呼叫端重讀。

- [ ] **Step 1：失敗測試 `admin/src/__tests__/admissionsFunnel.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, board, bodyOf, button, card, cleanup, deferred, hasButton, mockGet, mockPost, mountWith, options, pathsTo,
  queryOf, reception, visit,
} from './admissionsTestKit'

afterEach(cleanup)

const boardProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, ...changes })
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)
const column = (wrapper: VueWrapper, stage: string) => wrapper.get(`.funnel__column[data-stage="${stage}"]`)

async function drag(wrapper: VueWrapper, id: string, to: string) {
  await wrapper.get(`.funnel-card[data-id="${id}"]`).trigger('dragstart')
  await column(wrapper, to).trigger('dragover')
  await column(wrapper, to).trigger('drop')
  await flushPromises()
}

// 卡片的「移到…」選單掛在 body 底下，每張卡有自己的 popper-class。
async function moveItems(wrapper: VueWrapper, id: string): Promise<HTMLElement[]> {
  await wrapper.get(`[data-move="${id}"]`).trigger('click')
  await vi.waitFor(() => expect(document.body.querySelector(`.funnel-move-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
  return [...document.body.querySelectorAll<HTMLElement>(`.funnel-move-menu--${id} .el-dropdown-menu__item`)]
}
async function moveTo(wrapper: VueWrapper, id: string, label: string) {
  const item = (await moveItems(wrapper, id)).find((element) => element.textContent?.trim() === label)
  expect(item, `移到…選單裡要有「${label}」`).toBeDefined()
  item!.click()
  await flushPromises()
}

describe('看板：四欄、摘要列、卡片（規格第 10 節）', () => {
  it('四欄標題與張數；摘要比率用各欄目前張數相除，分母 0 顯示「—」', async () => {
    mockGet({
      '/admin/admissions/board': board({
        visited: [card(), card({ id: 'v-2', child_name: '李小樂', has_visit_request: true })],
        deposited: [card({ id: 'v-3', child_name: '張小晴', provisional_grade: '中班' })],
      }),
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(wrapper.findAll('.funnel__column h3').map((title) => title.text())).toEqual(['已訪視', '已預繳', '已註冊', '退預繳／退註冊'])
    expect(column(wrapper, 'visited').get('.funnel__count').text()).toBe('2')
    const rates = wrapper.get('.funnel__rates').text()
    expect(rates).toContain('50.0% 預繳率')
    expect(rates).toContain('0.0% 註冊率')
    expect(rates).toContain('— 退費率')
    // 空欄寫園務原文，不是空白。
    expect(column(wrapper, 'enrolled').text()).toContain('家長完成註冊後，把「已預繳」的卡片拖到這一欄。')
    const second = wrapper.get('.funnel-card[data-id="v-2"]').text()
    for (const text of ['李小樂', '小班', '115上', '官網預約', '115.09.08']) expect(second).toContain(text)
    expect(wrapper.get('.funnel-card[data-id="v-3"]').text()).toContain('保留 中班')
  })

  it('退出欄的卡片標出退預繳或退註冊', async () => {
    mockGet({ '/admin/admissions/board': board({ withdrawn: [card({ withdrawn_from: 'enrolled' })] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(column(wrapper, 'withdrawn').text()).toContain('退註冊')
  })

  it('讀不到看板顯示錯誤，可以重新載入', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/board': () => {
        if (fail) throw new Error('offline')
        return board({ visited: [card()] })
      },
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    expect(wrapper.text()).toContain('無法讀取看板，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
    expect(column(wrapper, 'visited').text()).toContain('王小安')
  })

  it('頁首選「不限學年」：看板用目前學年並說明；學期不選就不帶', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/board': board() })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps({ schoolYear: null }) })
    expect(pathsTo(get, '/admin/admissions/board')).toEqual(['/admin/admissions/board?campus_key=yihua&school_year=115'])
    expect(wrapper.text()).toContain('頁首選了「不限學年」，這裡先顯示 115 學年')
  })

  it('快速切換校區：義華的看板較晚回來也不蓋掉仁武', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/board': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : board({ visited: [card({ id: 'v-r', child_name: '林小美' })] }),
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve(board({ visited: [card()] }))
    await flushPromises()
    expect(column(wrapper, 'visited').text()).toContain('林小美')
    expect(column(wrapper, 'visited').text()).not.toContain('王小安')
  })

  it('點卡片（或 Enter）開歷程抽屜', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await wrapper.get('.funnel-card[data-id="v-1"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.getComponent(EventsDrawer).props()).toMatchObject({ modelValue: true, visitId: 'v-1', childName: '王小安' })
  })
})

describe('換欄：拖曳與確認框（規格 6.3）', () => {
  it('已訪視拖到已預繳：確認框記收預繳人員，確認後送轉換並重讀看板', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/board': board({ visited: [card({ version: 2 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'deposited' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'deposited')
    expect(bodyText()).toContain('已訪視 → 已預繳')
    expect(bodyText()).toContain('幼生：王小安')
    expect(bodyText()).toContain('實際收款與收據照園內原本的方式處理')
    expect(bodyText()).not.toContain('學費管理')
    const collector = document.body.querySelector<HTMLInputElement>('input[aria-label="收預繳人員"]')!
    collector.value = ' 林老師 '
    collector.dispatchEvent(new Event('input'))
    bodyButton('確認')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toEqual({
      to_stage: 'deposited', expected_version: 2, reason: null, deposit_collector: '林老師',
      enrolled_on: null, grade: null, target_school_year: null, target_semester: null,
    })
    expect(success).toHaveBeenCalledWith('已更新階段')
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
  })

  it('409 時重載並還原卡片：兩人同時拖同一張卡，後送者提示並重讀看板，卡片落在伺服器的欄（Review Focus 3）', async () => {
    const info = vi.spyOn(ElMessage, 'info')
    const error = vi.spyOn(ElMessage, 'error')
    let serverBoard = board({ visited: [card()] })
    const get = mockGet({ '/admin/admissions/board': () => serverBoard })
    mockPost({
      '/admin/admissions/records/v-1/transition': () => {
        // 另一個人剛把這張卡推到已註冊。
        serverBoard = board({ enrolled: [card({ version: 3 })] })
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 3 })
      },
    })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'deposited')
    bodyButton('確認')!.click()
    await flushPromises()
    expect(info).toHaveBeenCalledWith('狀態已被其他人變更，已自動重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/board')).toHaveLength(2)
    expect(column(wrapper, 'enrolled').text()).toContain('王小安')
    expect(column(wrapper, 'deposited').text()).not.toContain('王小安')
    expect(column(wrapper, 'visited').text()).not.toContain('王小安')
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('不允許的轉換不開確認框，說明原因（已訪視拖到退出欄用園務原文）', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const post = mockPost()
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await drag(wrapper, 'v-1', 'withdrawn')
    expect(warning).toHaveBeenCalledWith('已訪視階段沒有可退的款項，不可移入「退預繳／退註冊」')
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('鍵盤「移到…」：櫃台只列有權限的目的欄；退預繳要填原因才能確認', async () => {
    mockGet({ '/admin/admissions/board': board({ deposited: [card({ version: 4 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'withdrawn' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: reception() })
    expect((await moveItems(wrapper, 'v-1')).map((item) => item.textContent?.trim())).toEqual(['已訪視', '退預繳／退註冊'])
    await moveTo(wrapper, 'v-1', '退預繳／退註冊')
    expect(bodyText()).toContain('已預繳 → 退預繳／退註冊')
    expect(bodyText()).toContain('將標記退預繳。若已實際收款，退款要另外處理')
    expect(bodyButton('確認')!.disabled).toBe(true)
    const reason = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="原因"]')!
    reason.value = '家長決定不讀'
    reason.dispatchEvent(new Event('input'))
    await flushPromises()
    bodyButton('確認')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toMatchObject({ to_stage: 'withdrawn', expected_version: 4, reason: '家長決定不讀' })
  })

  it('標記註冊：預設今天、卡片的保留年級與入學學期，可改', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    mockGet({ '/admin/admissions/board': board({ deposited: [card({ provisional_grade: '中班', target_semester: 2, version: 5 })] }) })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'enrolled' }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps() })
    await moveTo(wrapper, 'v-1', '已註冊')
    expect(bodyText()).toContain('已預繳 → 已註冊')
    expect(bodyText()).not.toContain('學生檔案')
    bodyButton('確認')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toEqual({
      to_stage: 'enrolled', expected_version: 5, reason: null, deposit_collector: null,
      enrolled_on: '2026-10-01', grade: '中班', target_school_year: 115, target_semester: 2,
    })
  })
})

describe('看板權限與提示', () => {
  it('只能看招生的帳號：沒有新增訪視、卡片不能拖、沒有「移到…」', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: admissionsViewer() })
    expect(hasButton(wrapper, '新增訪視')).toBe(false)
    expect(wrapper.get('.funnel-card[data-id="v-1"]').attributes('draggable')).toBe('false')
    expect(wrapper.find('[data-move="v-1"]').exists()).toBe(false)
  })

  it('櫃台不能拖已註冊的卡（要 admissions.convert），拖了也不開確認框', async () => {
    mockGet({ '/admin/admissions/board': board({ enrolled: [card()] }) })
    const { wrapper } = await mountWith(FunnelBoard, { props: boardProps(), user: reception() })
    expect(wrapper.get('.funnel-card[data-id="v-1"]').attributes('draggable')).toBe('false')
    await drag(wrapper, 'v-1', 'deposited')
    expect(wrapper.getComponent(TransitionDialog).props('modelValue')).toBe(false)
  })

  it('「另有 N 筆沒有填入學學期」：按「到訪視明細處理」切到明細並清掉入學學年學期', async () => {
    mockGet({
      '/admin/admissions/arrivals': { awaiting: [], missing: [] },
      '/admin/admissions/board': board({}, { unscoped_count: 3 }),
      '/admin/admissions/records': [],
      '/admin/admissions/options': options(),
    })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?sem=1' })
    expect(wrapper.text()).toContain('另有 3 筆訪視沒有填入學學期，不會出現在任何學年的看板。')
    await button(wrapper, '到訪視明細處理')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: 'all', tab: 'records' })
  })
})

describe('明細的「標記註冊」（本檔調整第 12 條）', () => {
  const recordsProps = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }

  it('有 admissions.convert 且已預繳未註冊才顯示；開註冊確認框，完成後重新整理明細', async () => {
    const get = mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', provisional_grade: '中班', version: 2 }), visit({ id: 'v-2', child_name: '李小樂' })],
      '/admin/admissions/options': options(),
    })
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'enrolled' }) })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    expect(wrapper.findAll('button').filter((element) => element.text() === '標記註冊')).toHaveLength(1)
    await button(wrapper, '標記註冊')!.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('已預繳 → 已註冊')
    bodyButton('確認')!.click()
    await flushPromises()
    const body = bodyOf(post, '/admin/admissions/records/v-1/transition') as Record<string, unknown>
    expect(body).toMatchObject({ to_stage: 'enrolled', expected_version: 2, grade: '中班', target_school_year: 115, target_semester: 1 })
    expect(String(body.enrolled_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('櫃台（沒有 admissions.convert）看不到標記註冊', async () => {
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps, user: reception() })
    expect(hasButton(wrapper, '標記註冊')).toBe(false)
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsFunnel.test.ts`
Expected: FAIL，`Failed to resolve import "../components/admissions/FunnelBoard.vue"`。

- [ ] **Step 3：確認框 `admin/src/components/admissions/TransitionDialog.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { transition, transitionRequest } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import type { RecruitmentVisit } from '../../api/types'
import { currentTerm, schoolYearOptions, taipeiToday } from '../../admissions/academic'
import { GRADES, SEMESTER_LABELS, STAGE_LABELS, transitionMode, transitionWarning, type Grade, type TransitionTarget } from '../../admissions/constants'

// 狀態轉換確認框（園務 TransitionConfirmDialog）。標題「{起} → {迄}」、首行幼生姓名、四種模式：
// 預繳記收預繳人員；註冊填註冊日期、年級、入學學年學期（官網沒有班級，取代園務的選班）；
// 退出與從已註冊往回要原因；其餘只確認。提到學費管理、學生檔的文案改寫（本檔調整第 9 條）。
const props = defineProps<{ target: TransitionTarget | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [visit: RecruitmentVisit]; stale: [] }>()

const collector = ref('')
const reason = ref('')
const enrolledOn = ref<string | null>(null)
const grade = ref<Grade | null>(null)
const year = ref<number | null>(null)
const semester = ref<1 | 2>(1)
const submitting = ref(false)

const mode = computed(() => (props.target ? transitionMode(props.target.from, props.target.to) : 'confirm'))
const warning = computed(() => (props.target ? transitionWarning(props.target.from, props.target.to) : ''))
const title = computed(() => (props.target ? `${STAGE_LABELS[props.target.from]} → ${STAGE_LABELS[props.target.to]}` : ''))
const defaultYear = currentTerm().schoolYear
const yearChoices = computed(() => {
  const years = schoolYearOptions(defaultYear, [1, 0, -1])
  return year.value && !years.includes(year.value) ? [...years, year.value].sort((a, b) => b - a) : years
})

watch(open, (value) => {
  const card = props.target?.card
  if (!value || !card) return
  collector.value = ''
  reason.value = ''
  enrolledOn.value = taipeiToday()
  // 註冊年級預設保留座位的年級，沒有就用適讀班級（名額規劃的已註冊以 COALESCE(provisional_grade, grade) 歸列）。
  grade.value = ((card.provisional_grade ?? card.grade) as Grade | null | undefined) ?? null
  year.value = card.target_school_year ?? defaultYear
  semester.value = card.target_semester === 2 ? 2 : 1
})

const ready = computed(() => {
  if (mode.value === 'enroll') return Boolean(enrolledOn.value && grade.value && year.value)
  if (mode.value === 'destructive') return reason.value.trim() !== ''
  return true
})

function fields() {
  if (mode.value === 'deposit') return { deposit_collector: collector.value.trim() || null }
  if (mode.value === 'enroll') {
    return { enrolled_on: enrolledOn.value, grade: grade.value, target_school_year: year.value, target_semester: semester.value }
  }
  if (mode.value === 'destructive') return { reason: reason.value.trim() }
  return {}
}

async function submit() {
  const target = props.target
  if (!target || !ready.value || submitting.value) return
  submitting.value = true
  try {
    const visit = await transition(target.card.id, transitionRequest(target.to, target.card.version, fields()))
    ElMessage.success('已更新階段')
    open.value = false
    emit('done', visit)
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // 後端先比對版本再判權限（A 調整第 10 條）：別人剛改過一律 409。園務同樣強制重載看板。
      ElMessage.info('狀態已被其他人變更，已自動重新載入')
      open.value = false
      emit('stale')
    } else if (err instanceof ApiError && err.status === 403) {
      ElMessage.warning('無權限執行此操作')
    } else {
      ElMessage.error(apiErrorMessage(err, '操作失敗，請稍後再試'))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="transition-dialog"
    :title="title"
    width="min(480px, calc(100vw - 32px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <p class="transition__child">幼生：{{ target?.card.child_name }}</p>
    <el-alert v-if="warning" :type="mode === 'destructive' ? 'warning' : 'info'" :closable="false" show-icon :title="warning" class="transition__warning" />
    <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
      <el-form-item v-if="mode === 'deposit'" label="收預繳人員">
        <el-input v-model="collector" maxlength="50" placeholder="誰收的（選填）" aria-label="收預繳人員" />
        <span class="field-help">這裡只記錄招生端的預繳狀態，實際收款與收據照園內原本的方式處理。</span>
      </el-form-item>
      <template v-else-if="mode === 'enroll'">
        <el-form-item label="註冊日期" required>
          <el-date-picker v-model="enrolledOn" type="date" value-format="YYYY-MM-DD" placeholder="選擇註冊日期" aria-label="註冊日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="年級" required>
          <el-select v-model="grade" placeholder="請選擇年級" aria-label="年級" style="width: 100%">
            <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="入學學期" required>
          <div class="transition__term">
            <el-select v-model="year" placeholder="學年" aria-label="入學學年">
              <el-option v-for="item in yearChoices" :key="item" :label="`${item} 學年`" :value="item" />
            </el-select>
            <el-radio-group v-model="semester" aria-label="入學學期">
              <el-radio-button :value="1">{{ SEMESTER_LABELS[1] }}</el-radio-button>
              <el-radio-button :value="2">{{ SEMESTER_LABELS[2] }}</el-radio-button>
            </el-radio-group>
          </div>
          <span class="field-help">標記後會算進這個學期名額規劃的「已註冊」。官網沒有學生資料，學號與編班等併入園務系統後再處理。</span>
        </el-form-item>
      </template>
      <el-form-item v-else-if="mode === 'destructive'" label="原因（必填）">
        <el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" placeholder="請說明退回原因" aria-label="原因" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="submitting" @click="open = false">取消</el-button>
      <el-button :type="mode === 'destructive' ? 'danger' : 'primary'" :loading="submitting" :disabled="!ready" @click="submit">確認</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.transition__child {
  margin: 0 0 12px;
  color: var(--ink);
  font-weight: 500;
}

.transition__warning {
  margin-bottom: 16px;
}

.transition__term {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.transition__term .el-select {
  width: 120px;
}
</style>
```

- [ ] **Step 4：卡片 `admin/src/components/admissions/FunnelCard.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { FunnelCard as BoardCard } from '../../api/types'
import { rocDate, termLabel } from '../../admissions/academic'
import { STAGE_LABELS, WITHDRAWN_FROM_LABELS, type Stage } from '../../admissions/constants'

// 看板卡片（園務 FunnelCard.vue:14-37）：姓名＋退出類型、年級、入學學期、官網預約標記。
// 官網沒有學號、預繳金對帳，那兩種徽章不做。整張卡可點、Enter、空白鍵開歷程；
// 「移到…」是拖曳的鍵盤替代（規格第 10 節），只列允許且有權限的目的欄。
const props = defineProps<{ card: BoardCard; stage: Stage; draggable: boolean; targets: readonly Stage[] }>()
const emit = defineEmits<{ open: []; move: [to: Stage]; dragstart: []; dragend: [] }>()

const term = computed(() => termLabel(props.card.target_school_year, props.card.target_semester, 'short'))

function onDragStart(event: DragEvent) {
  if (!props.draggable) {
    event.preventDefault()
    return
  }
  // Firefox 沒有 setData 不會開始拖曳；看板自己記住拖的是哪張卡，不從 dataTransfer 讀。
  event.dataTransfer?.setData('text/plain', props.card.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('dragstart')
}
</script>

<template>
  <article
    class="funnel-card"
    :class="{ 'is-locked': !draggable }"
    :data-id="card.id"
    :draggable="draggable ? 'true' : 'false'"
    role="button"
    tabindex="0"
    :aria-label="`${card.child_name}（${STAGE_LABELS[stage]}），按 Enter 看歷程`"
    @click="emit('open')"
    @keydown.enter.self.prevent="emit('open')"
    @keydown.space.self.prevent="emit('open')"
    @dragstart="onDragStart"
    @dragend="emit('dragend')"
  >
    <div class="funnel-card__head">
      <strong class="funnel-card__name">{{ card.child_name }}</strong>
      <el-dropdown
        v-if="targets.length"
        trigger="click"
        placement="bottom-end"
        :persistent="false"
        :popper-class="`funnel-move-menu funnel-move-menu--${card.id}`"
        @command="(to: Stage) => emit('move', to)"
      >
        <el-button size="small" text class="funnel-card__move" :data-move="card.id" :aria-label="`把 ${card.child_name} 移到其他階段`" @click.stop>
          移到…<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="to in targets" :key="to" :command="to">{{ STAGE_LABELS[to] }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div class="funnel-card__tags">
      <el-tag v-if="card.withdrawn_from" type="danger" size="small" effect="light">{{ WITHDRAWN_FROM_LABELS[card.withdrawn_from] ?? card.withdrawn_from }}</el-tag>
      <el-tag v-if="card.grade" type="info" size="small" effect="light">{{ card.grade }}</el-tag>
      <el-tag v-if="term" type="warning" size="small" effect="light">{{ term }}</el-tag>
      <el-tag v-if="card.has_visit_request" type="primary" size="small" effect="plain">官網預約</el-tag>
    </div>
    <p class="funnel-card__meta">
      <span class="num">參觀 {{ rocDate(card.visit_date) || '—' }}</span>
      <span v-if="card.provisional_grade">・保留 {{ card.provisional_grade }}</span>
    </p>
  </article>
</template>

<style scoped>
.funnel-card {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--stage-color, var(--line-strong));
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: grab;
}

.funnel-card.is-locked {
  cursor: pointer;
}

.funnel-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.funnel-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.funnel-card__name {
  min-width: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.funnel-card__move {
  flex: none;
}

.funnel-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.funnel-card__meta {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}

@media (pointer: coarse) {
  .funnel-card__move {
    min-height: 44px;
  }
}
</style>
```

- [ ] **Step 5：看板 `admin/src/components/admissions/FunnelBoard.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { getBoard, getOptions } from '../../api/admissions'
import type { AdmissionsOptions, FunnelBoard as BoardData, FunnelCard as BoardCard } from '../../api/types'
import { currentTerm } from '../../admissions/academic'
import {
  STAGES, STAGE_EMPTY_TEXT, STAGE_LABELS, STAGE_TOKENS, canDragFrom, moveTargets, transitionBlockedText, transitionCapability,
  type Stage, type TransitionTarget,
} from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import FunnelCard from './FunnelCard.vue'
import TransitionDialog from './TransitionDialog.vue'
import RecordDialog from './RecordDialog.vue'
import EventsDrawer from './EventsDrawer.vue'

// 漏斗看板（園務 FunnelBoard／FunnelColumn／FunnelSummaryBar）。以入學學年學期圈範圍：
// 學年必填（API 需要），頁首選「不限學年」時用目前學年並說明（本檔調整第 18 條）；學期不選＝整學年。
// 換欄一律先跳確認框（園務 needsDialog 等於所有合法轉換），所以不做樂觀移動：
// 409 時重讀看板，卡片就停在伺服器的欄（Review Focus 3）。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: Semester | null }>()
const emit = defineEmits<{ 'show-unscoped': [] }>()

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const defaultYear = currentTerm().schoolYear
const boardYear = computed(() => props.schoolYear ?? defaultYear)

const board = ref<BoardData | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

// keep：動作後重讀，不切回骨架；換校或換學期時先清空，不讓上一校的卡片留在畫面上。
async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) board.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getBoard(props.campusKey, boardYear.value, props.semester)
    if (!requests.isCurrent(request)) return
    board.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
  } catch {
    if (!requests.isCurrent(request)) return
    board.value = null
    error.value = '無法讀取看板，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => [props.campusKey, boardYear.value, props.semester], () => void load(), { immediate: true })

function cardsOf(stage: Stage): BoardCard[] {
  return board.value?.columns?.[stage] ?? []
}
const count = (stage: Stage) => cardsOf(stage).length

// 摘要列三個比率：園務用「各欄目前張數」相除（不是累積漏斗）；分母 0 顯示「—」，不顯示 0（本檔調整第 20 條）。
function rate(numerator: number, denominator: number): string {
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—'
}
const summaryRates = computed(() => [
  { label: '預繳率', value: rate(count('deposited'), count('visited')), title: '已預繳 ÷ 已訪視（各欄目前張數）' },
  { label: '註冊率', value: rate(count('enrolled'), count('deposited')), title: '已註冊 ÷ 已預繳（各欄目前張數）' },
  { label: '退費率', value: rate(count('withdrawn'), count('enrolled')), title: '退預繳／退註冊 ÷ 已註冊（各欄目前張數，同園務）' },
])

function stageStyle(stage: Stage): Record<string, string> {
  return { '--stage-color': `var(${STAGE_TOKENS[stage]})` }
}

const canDrag = (stage: Stage) => canDragFrom(stage, can)
const targetsFor = (stage: Stage) => moveTargets(stage, can)

// ---- 拖曳（原生 HTML5 drag and drop）----
const dragging = ref<{ card: BoardCard; from: Stage } | null>(null)
const dropTarget = ref<Stage | null>(null)

function onDragStart(card: BoardCard, from: Stage) {
  dragging.value = { card, from }
}
function onDragEnd() {
  dragging.value = null
  dropTarget.value = null
}
function onDragOver(stage: Stage, event: DragEvent) {
  if (!dragging.value) return
  event.preventDefault()
  dropTarget.value = stage
}
function onDragLeave(stage: Stage) {
  if (dropTarget.value === stage) dropTarget.value = null
}
function onDrop(stage: Stage) {
  const current = dragging.value
  onDragEnd()
  if (current) requestMove(current.card, current.from, stage)
}

// ---- 換欄 ----
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function requestMove(card: BoardCard, from: Stage, to: Stage) {
  if (from === to) return
  const capability = transitionCapability(from, to)
  if (!capability) {
    ElMessage.warning(transitionBlockedText(from, to))
    return
  }
  if (!can(capability)) {
    ElMessage.warning('無權限執行此操作')
    return
  }
  transitionTarget.value = { card, from, to }
  transitionOpen.value = true
}

function onTransitioned() {
  void load({ keep: true })
}

// ---- 新增訪視、歷程 ----
const addOpen = ref(false)
const options = ref<AdmissionsOptions | null>(null)
async function openAdd() {
  addOpen.value = true
  // 來源、介紹者的建議清單（園務 FunnelAddVisit 先 fetchOptions）；讀不到不影響新增。
  if (options.value) return
  try {
    const result = await getOptions(props.campusKey)
    options.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
  } catch {
    options.value = null
  }
}
watch(() => props.campusKey, () => {
  options.value = null
})

const eventsOpen = ref(false)
const eventsFor = ref<BoardCard | null>(null)
function openEvents(card: BoardCard) {
  eventsFor.value = card
  eventsOpen.value = true
}
</script>

<template>
  <section class="funnel">
    <div class="toolbar funnel__toolbar">
      <p v-if="schoolYear === null" class="hint funnel__note">看板一次看一個學年：頁首選了「不限學年」，這裡先顯示 {{ defaultYear }} 學年。</p>
      <span class="toolbar__spacer" />
      <el-button :loading="loading" @click="load({ keep: true })">重新整理</el-button>
      <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openAdd">新增訪視</el-button>
    </div>

    <!-- 園務 FunnelBoard.vue:36-47：沒有入學學期的訪視不在任何看板，空看板不能謊稱「還沒有訪視紀錄」。 -->
    <el-alert
      v-if="board?.unscoped_count"
      type="info"
      :closable="false"
      show-icon
      class="funnel__notice"
      :title="`另有 ${board.unscoped_count} 筆訪視沒有填入學學期，不會出現在任何學年的看板。`"
    >
      <el-button link type="primary" @click="emit('show-unscoped')">到訪視明細處理</el-button>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="funnel__notice">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!board" :rows="6" animated />

    <template v-else>
      <div class="funnel__summary">
        <dl class="funnel__stats">
          <div v-for="stage in STAGES" :key="stage" class="funnel__stat" :style="stageStyle(stage)">
            <dt>{{ STAGE_LABELS[stage] }}</dt>
            <dd class="num">{{ count(stage) }}</dd>
          </div>
        </dl>
        <p class="funnel__rates">
          <span v-for="item in summaryRates" :key="item.label" :title="item.title"><strong class="num">{{ item.value }}</strong> {{ item.label }}</span>
        </p>
      </div>

      <div class="funnel__columns" :aria-busy="loading">
        <section
          v-for="stage in STAGES"
          :key="stage"
          class="funnel__column"
          :class="{ 'is-drop-target': dropTarget === stage }"
          :data-stage="stage"
          :style="stageStyle(stage)"
          :aria-label="`${STAGE_LABELS[stage]}，${count(stage)} 張`"
          @dragover="onDragOver(stage, $event)"
          @dragleave="onDragLeave(stage)"
          @drop.prevent="onDrop(stage)"
        >
          <header class="funnel__column-head">
            <span class="funnel__dot" aria-hidden="true" />
            <h3>{{ STAGE_LABELS[stage] }}</h3>
            <span class="funnel__count num">{{ count(stage) }}</span>
          </header>
          <p v-if="!count(stage)" class="hint funnel__empty">{{ STAGE_EMPTY_TEXT[stage] }}</p>
          <div v-else class="funnel__cards">
            <FunnelCard
              v-for="card in cardsOf(stage)"
              :key="card.id"
              :card="card"
              :stage="stage"
              :draggable="canDrag(stage)"
              :targets="targetsFor(stage)"
              :style="stageStyle(stage)"
              @open="openEvents(card)"
              @move="(to: Stage) => requestMove(card, stage, to)"
              @dragstart="onDragStart(card, stage)"
              @dragend="onDragEnd"
            />
          </div>
        </section>
      </div>
    </template>

    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="onTransitioned" @stale="onTransitioned" />
    <RecordDialog v-model="addOpen" mode="add" :campus-key="campusKey" :options="options" @saved="load({ keep: true })" />
    <EventsDrawer v-model="eventsOpen" :visit-id="eventsFor?.id ?? null" :child-name="eventsFor?.child_name ?? ''" />
  </section>
</template>

<style scoped>
.funnel__toolbar {
  justify-content: flex-end;
}

.funnel__note {
  margin: 0;
}

.funnel__notice {
  margin-bottom: 16px;
}

.funnel__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-bottom: 16px;
}

.funnel__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}

.funnel__stat {
  display: grid;
  gap: 2px;
  min-width: 96px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--stage-color);
  border-radius: var(--radius);
  background: var(--surface);
}

.funnel__stat dt {
  color: var(--ink-3);
  font-size: 13px;
}

.funnel__stat dd {
  margin: 0;
  color: var(--ink);
  font-size: 20px;
  font-weight: 600;
}

.funnel__rates {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  color: var(--ink-2);
}

.funnel__rates strong {
  color: var(--ink);
}

/* 桌機四欄並排；中寬兩欄；手機（390px）四欄直向堆疊（規格第 10 節）。 */
.funnel__columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.funnel__column {
  display: grid;
  gap: 8px;
  min-width: 0;
  min-height: 160px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
}

.funnel__column.is-drop-target {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.funnel__column-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.funnel__column-head h3 {
  flex: 1;
  margin: 0;
  font-size: 14px;
}

.funnel__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--stage-color);
}

.funnel__count {
  min-width: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
  text-align: center;
}

.funnel__empty {
  margin: 0;
  line-height: 1.6;
}

.funnel__cards {
  display: grid;
  gap: 8px;
}

@media (max-width: 1100px) {
  .funnel__columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .funnel__columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .funnel__column {
    min-height: 0;
  }

  .funnel__stat {
    flex: 1 1 calc(50% - 8px);
    min-width: 0;
  }
}
</style>
```

- [ ] **Step 6：明細加「標記註冊」（`admin/src/components/admissions/RecordsTab.vue`）**

1. import 區 `import EventsDrawer from './EventsDrawer.vue'` 之後加：

```ts
import TransitionDialog from './TransitionDialog.vue'
```

並把 constants 的 import 改成：

```ts
import { GRADES, NO_DEPOSIT_REASONS, SEMESTER_LABELS, WITHDRAWN_FROM_LABELS, transitionWarning, type TransitionTarget } from '../../admissions/constants'
```

2. `function onSaved() {…}` 之後加：

```ts
// ---- 標記註冊（有 admissions.convert，且已預繳、未註冊、未退出；園務「轉為學生」的位置）----
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function canEnroll(row: RecruitmentVisit): boolean {
  return canConvert.value && row.stage === 'deposited'
}

function openEnroll(row: RecruitmentVisit) {
  transitionTarget.value = { card: row, from: 'deposited', to: 'enrolled' }
  transitionOpen.value = true
}
```

3. template 操作欄的 `<!-- B3：標記註冊 -->` 換成：

```vue
              <el-button v-if="canEnroll(row)" size="small" text type="success" :disabled="pendingId === row.id" @click="openEnroll(row)">標記註冊</el-button>
```

4. template 最後的 `<!-- B3：TransitionDialog；B4：SeatDialog -->` 換成：

```vue
    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="load" @stale="load" />
    <!-- B4：SeatDialog -->
```

- [ ] **Step 7：把看板接上 `admin/src/views/AdmissionsView.vue`**

1. import 區 `import RecordsTab …` 之前加：

```ts
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
```

2. `function goTab(next: AdmissionsTab) {…}` 之後加：

```ts
// 看板「另有 N 筆沒有填入學學期」→ 到訪視明細，並清掉學年學期篩選（園務 showUnscopedVisits）。
function showUnscoped() {
  clearTerm()
  tab.value = 'records'
}
```

3. template 的 `<div class="admissions__body">` 裡第一行（`<RecordsTab` 之前）加：

```vue
        <FunnelBoard v-if="tab === 'funnel'" :campus-key="campus" :school-year="schoolYear" :semester="semester" @show-unscoped="showUnscoped" />
```

- [ ] **Step 8：跑 B3 測試、受影響的 B1／B2 測試與型別檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/admissionsFunnel.test.ts
npx vitest run src/__tests__/admissionsRecords.test.ts
npx vitest run src/__tests__/admissionsView.test.ts
npm run typecheck
```

Expected：全部 PASS；typecheck 沒有錯誤。`admissionsView.test.ts` 預設分頁是看板，B1 的 mock 對 `/admin/admissions/board` 回空陣列：`FunnelBoard` 把非物件回應當成沒有看板，只顯示骨架，不會丟例外。typecheck 若報 `board.value?.columns?.[stage]` 的型別不是 `FunnelCard[]`，代表 A 沒照 A 調整第 8 條產生 `FunnelColumnsOut`，停下回報。

- [ ] **Step 9：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/components/admissions/FunnelBoard.vue admin/src/components/admissions/FunnelCard.vue admin/src/components/admissions/TransitionDialog.vue \
  admin/src/components/admissions/RecordsTab.vue admin/src/views/AdmissionsView.vue admin/src/__tests__/admissionsFunnel.test.ts
git commit -m "feat(admin): 招生漏斗看板（拖曳、鍵盤移到、確認框、衝突重載）與明細標記註冊

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B4：名額規劃與保留座位

**Files:**
- Create: `admin/src/components/admissions/IntakePlanTab.vue`、`admin/src/components/admissions/SeatDialog.vue`
- Modify: `admin/src/components/admissions/RecordsTab.vue`（「更多」加「保留座位／變更座位」）、`admin/src/views/AdmissionsView.vue`（掛上名額規劃）
- Test: `admin/src/__tests__/admissionsIntake.test.ts`

**Interfaces:**
- Consumes：B1 `getIntakePlan`、`saveIntakeTargets`、`setSeat`；`IntakePlan`（`{school_year, semester, rows: IntakePlanRow[], totals}`）、`IntakePlanRow`（`{grade, target_seats: number | null, reserved, enrolled, remaining: number | null, over_capacity}`）、`IntakeTargetsRequest`（`targets` 的 null＝刪除該年級計畫）、`SeatRequest`、`SeatResult`（A 調整第 12 條：`{visit, capacity_warning, warning_code}`）。
- Produces：
  - `IntakePlanTab.vue`：`props { campusKey: string; schoolYear: number | null; semester: Semester | null }`。
  - `SeatDialog.vue`：`v-model`（boolean）；`props { record: RecruitmentVisit | null }`；`emits { saved: [visit: RecruitmentVisit]; stale: [] }`。

- [ ] **Step 1：失敗測試 `admin/src/__tests__/admissionsIntake.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import IntakePlanTab from '../components/admissions/IntakePlanTab.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import { ApiError } from '../api/client'
import {
  admissionsViewer, bodyOf, button, cleanup, deferred, hasButton, intakePlan, intakeRow, mockGet, mockPost, mockPut, mountWith,
  options, pathsTo, queryOf, visit,
} from './admissionsTestKit'

afterEach(cleanup)

const planProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, ...changes })
const cells = (wrapper: VueWrapper) =>
  wrapper.findAll('.intake-table .el-table__body tr').map((row) => row.findAll('td').map((cell) => cell.text().trim()))
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)

// 小班設了 0 名額又有 1 個保留：要顯示 0 與超額；幼幼班、大班沒設：顯示「未設定」與「—」。
const mixedPlan = () => intakePlan(
  [
    intakeRow('幼幼班'),
    intakeRow('小班', { target_seats: 0, reserved: 1, remaining: -1, over_capacity: true }),
    intakeRow('中班', { target_seats: 20, reserved: 3, enrolled: 2, remaining: 15 }),
    intakeRow('大班'),
  ],
  { target_seats: 20, reserved: 4, enrolled: 2, remaining: 14 },
)

describe('名額規劃（規格第 8 節）', () => {
  it('未設定與 0 分開顯示；超額標出來；合計只算有設定的（Review Focus 5）', async () => {
    const get = mockGet({ '/admin/admissions/intake-plan': mixedPlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    expect(pathsTo(get, '/admin/admissions/intake-plan')).toEqual(['/admin/admissions/intake-plan?campus_key=yihua&school_year=115&semester=1'])
    const [baby, small, middle] = cells(wrapper)
    expect(baby![0]).toBe('幼幼班')
    expect(baby![1]).toBe('未設定')
    expect(baby![4]).toBe('—')
    expect(small![1]).toBe('0')
    expect(small![4]).toContain('-1')
    expect(small![4]).toContain('超過計畫名額')
    expect(middle!.slice(1)).toEqual(['20', '3', '2', '15'])
    expect(wrapper.findAll('.intake-table .el-table__body tr')[1]!.classes()).toContain('intake-row--over')
    expect(wrapper.get('.intake__totals').text()).toMatch(/計畫\s*20.*保留\s*4.*註冊\s*2.*剩餘\s*14/)
  })

  it('後端沒回的年級補成「未設定」列，四個年級都在', async () => {
    mockGet({ '/admin/admissions/intake-plan': intakePlan([intakeRow('中班', { target_seats: 10, remaining: 10 })], { target_seats: 10, remaining: 10 }) })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    expect(cells(wrapper).map((row) => [row[0], row[1]])).toEqual([['幼幼班', '未設定'], ['小班', '未設定'], ['中班', '10'], ['大班', '未設定']])
  })

  it('一個年級都沒設定：說明還沒設定，合計也寫未設定', async () => {
    mockGet({ '/admin/admissions/intake-plan': intakePlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    expect(wrapper.text()).toContain('115 上學期還沒有設定計畫名額')
    expect(wrapper.get('.intake__totals').text()).toMatch(/計畫\s*未設定/)
    expect(wrapper.get('.intake__totals').text()).toMatch(/剩餘\s*—/)
  })

  it('可編輯的帳號：空白是未設定、0 照樣顯示 0；只送改過的年級，清空＝刪除計畫', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({ '/admin/admissions/intake-plan': mixedPlan() })
    const put = mockPut({ '/admin/admissions/intake-targets': intakePlan([intakeRow('幼幼班', { target_seats: 12, remaining: 12 })], { target_seats: 12, remaining: 12 }) })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    const inputs = wrapper.findAll('.intake-table input')
    expect(inputs.map((input) => (input.element as HTMLInputElement).value)).toEqual(['', '0', '20', ''])
    expect(inputs[0]!.attributes('placeholder')).toBe('未設定')
    expect(button(wrapper, '儲存計畫名額')!.attributes('disabled')).toBeDefined()

    const numbers = wrapper.findAllComponents({ name: 'ElInputNumber' })
    numbers[0]!.vm.$emit('update:modelValue', 12)
    numbers[2]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    expect(wrapper.text()).toContain('有修改還沒儲存')
    await button(wrapper, '儲存計畫名額')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/admissions/intake-targets?campus_key=yihua', {
      school_year: 115, semester: 1, targets: { 幼幼班: 12, 中班: null },
    })
    expect(success).toHaveBeenCalledWith('已儲存計畫名額')
    expect(cells(wrapper)[0]![4]).toBe('12')
    expect(wrapper.text()).not.toContain('有修改還沒儲存')
  })

  it('只能看的帳號沒有輸入框與儲存鈕', async () => {
    mockGet({ '/admin/admissions/intake-plan': mixedPlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    expect(wrapper.findAll('.intake-table input')).toHaveLength(0)
    expect(hasButton(wrapper, '儲存計畫名額')).toBe(false)
  })

  it('頁首沒選學期或選了不限學年：用目前學年、上學期，並說明', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/intake-plan': intakePlan() })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps({ schoolYear: null, semester: null }) })
    expect(pathsTo(get, '/admin/admissions/intake-plan')).toEqual(['/admin/admissions/intake-plan?campus_key=yihua&school_year=115&semester=1'])
    expect(wrapper.text()).toContain('頁首選了「不限學年」，先顯示 115 學年')
    expect(wrapper.text()).toContain('頁首沒選入學學期，先顯示上學期')
  })

  it('讀取失敗顯示錯誤，可以重新載入；儲存失敗顯示後端原因', async () => {
    let fail = true
    mockGet({
      '/admin/admissions/intake-plan': () => {
        if (fail) throw new Error('offline')
        return mixedPlan()
      },
    })
    const error = vi.spyOn(ElMessage, 'error')
    mockPut({ '/admin/admissions/intake-targets': () => { throw new ApiError(422, { code: 'VALIDATION_ERROR', message: '計畫名額不能小於 0' }) } })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps() })
    expect(wrapper.text()).toContain('無法讀取名額規劃，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!.vm.$emit('update:modelValue', 3)
    await flushPromises()
    await button(wrapper, '儲存計畫名額')!.trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith('計畫名額不能小於 0')
  })

  it('快速切換校區只顯示最後一次的名額', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/intake-plan': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : intakePlan([intakeRow('小班', { target_seats: 8, remaining: 8 })], { target_seats: 8, remaining: 8 }),
    })
    const { wrapper } = await mountWith(IntakePlanTab, { props: planProps(), user: admissionsViewer() })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve(mixedPlan())
    await flushPromises()
    expect(cells(wrapper)[1]![1]).toBe('8')
    expect(cells(wrapper)[2]![1]).toBe('未設定')
  })
})

describe('保留座位（規格 6.5，明細「更多」）', () => {
  const recordsProps = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }

  async function moreLabels(wrapper: VueWrapper, id: string): Promise<string[]> {
    await wrapper.get(`[data-more="${id}"]`).trigger('click')
    await vi.waitFor(() => expect(document.body.querySelector(`.records-more-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
    return [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)].map((item) => item.textContent?.trim() ?? '')
  }
  async function chooseMore(wrapper: VueWrapper, id: string, label: string) {
    await moreLabels(wrapper, id)
    const item = [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)].find((element) => element.textContent?.trim() === label)
    expect(item, `更多選單裡要有「${label}」`).toBeDefined()
    item!.click()
    await flushPromises()
  }

  it('只有已預繳的列有；已保留過的寫「變更座位」', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-a' }),
        visit({ id: 'v-b', has_deposit: true, stage: 'deposited' }),
        visit({ id: 'v-c', has_deposit: true, stage: 'deposited', provisional_grade: '小班' }),
        visit({ id: 'v-d', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled', provisional_grade: '小班' }),
      ],
      '/admin/admissions/options': options(),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    expect(await moreLabels(wrapper, 'v-a')).not.toContain('保留座位')
    expect(await moreLabels(wrapper, 'v-b')).toContain('保留座位')
    expect(await moreLabels(wrapper, 'v-c')).toContain('變更座位')
    // 已註冊不能清除保留，要改年級請先取消註冊（規格 6.5）。
    const enrolled = await moreLabels(wrapper, 'v-d')
    expect(enrolled).not.toContain('保留座位')
    expect(enrolled).not.toContain('變更座位')
  })

  it('保留：預設適讀班級與入學學期，送出帶版本；成功後重新整理', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', version: 6 })], '/admin/admissions/options': options() })
    const post = mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit({ provisional_grade: '小班' }), capacity_warning: false, warning_code: null } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    expect(bodyText()).toContain('幼生：王小安')
    expect(bodyButton('釋放保留')).toBeUndefined()
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/seat')).toEqual({ grade: '小班', target_school_year: 115, target_semester: 1, expected_version: 6 })
    expect(success).toHaveBeenCalledWith('已保留座位')
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('超過計畫名額只提醒、不擋（後端回 capacity_warning）', async () => {
    const alert = vi.spyOn(ElMessageBox, 'alert').mockResolvedValue('confirm' as never)
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit({ provisional_grade: '小班' }), capacity_warning: true, warning_code: 'SEAT_CAPACITY_WARNING' } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(alert).toHaveBeenCalledOnce()
    expect(alert.mock.calls[0]![1]).toBe('已保留，但超過計畫名額')
    expect(String(alert.mock.calls[0]![0])).toContain('小班（115 上學期）的已保留加已註冊超過計畫名額')
  })

  it('變更座位可以釋放保留（年級送 null，學年學期不動）', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', provisional_grade: '中班', target_semester: 2, version: 3 })],
      '/admin/admissions/options': options(),
    })
    const post = mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit(), capacity_warning: false, warning_code: null } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '變更座位')
    bodyButton('釋放保留')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/seat')).toEqual({ grade: null, target_school_year: 115, target_semester: 2, expected_version: 3 })
    expect(success).toHaveBeenCalledWith('已釋放保留')
  })

  it('後端拒絕（例如未預繳）顯示原因；版本衝突提示並重新整理', async () => {
    const error = vi.spyOn(ElMessage, 'error')
    const info = vi.spyOn(ElMessage, 'info')
    let conflict = false
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })], '/admin/admissions/options': options() })
    mockPost({
      '/admin/admissions/records/v-1/seat': () => {
        if (conflict) throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 2 })
        throw new ApiError(422, { code: 'SEAT_NOT_ALLOWED', message: '未預繳的訪視不可保留座位' })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(error).toHaveBeenCalledWith('未預繳的訪視不可保留座位')
    conflict = true
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(info).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsIntake.test.ts`
Expected: FAIL，`Failed to resolve import "../components/admissions/IntakePlanTab.vue"`。

- [ ] **Step 3：名額規劃 `admin/src/components/admissions/IntakePlanTab.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getIntakePlan, saveIntakeTargets } from '../../api/admissions'
import { apiErrorMessage } from '../../api/errors'
import type { IntakePlan, IntakePlanRow } from '../../api/types'
import { currentTerm, termLabel } from '../../admissions/academic'
import { GRADES } from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 名額規劃（園務 IntakePlanPanel；規格第 8 節）。條件是校區 × 學年 × 學期，取頁首的篩選；
// 頁首「不限學年」用目前學年、沒選學期用上學期（園務父層未指定時也是上學期），並說明（本檔調整第 18 條）。
// 沒有計畫列＝「未設定」，與 0 分開；剩餘在未設定時是「—」。超額園務只有紅底，官網另加文字（本檔調整第 24 條）。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: Semester | null }>()

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const defaultYear = currentTerm().schoolYear
const planYear = computed(() => props.schoolYear ?? defaultYear)
const planSemester = computed<Semester>(() => props.semester ?? 1)
const term = computed(() => termLabel(planYear.value, planSemester.value))

const plan = ref<IntakePlan | null>(null)
const drafts = ref<Record<string, number | null>>({})
const loading = ref(false)
const error = ref<string | null>(null)
const saving = ref(false)
const requests = useRequestSequence()

function emptyRow(grade: string): IntakePlanRow {
  return { grade, target_seats: null, reserved: 0, enrolled: 0, remaining: null, over_capacity: false } as IntakePlanRow
}

// 以四個年級為主軸，後端沒回的年級補「未設定」列（園務補 0 列；官網補未設定，不顯示假的 0）。
const rows = computed<IntakePlanRow[]>(() => GRADES.map((grade) => plan.value?.rows?.find((row) => row.grade === grade) ?? emptyRow(grade)))
const anyTarget = computed(() => rows.value.some((row) => row.target_seats !== null && row.target_seats !== undefined))

function resetDrafts() {
  drafts.value = Object.fromEntries(rows.value.map((row) => [row.grade, row.target_seats ?? null]))
}

const changedGrades = computed(() => rows.value.map((row) => row.grade).filter((grade) => (drafts.value[grade] ?? null) !== (rows.value.find((row) => row.grade === grade)?.target_seats ?? null)))
const dirty = computed(() => changedGrades.value.length > 0)

async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) plan.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getIntakePlan(props.campusKey, planYear.value, planSemester.value)
    if (!requests.isCurrent(request)) return
    plan.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
    resetDrafts()
  } catch {
    if (!requests.isCurrent(request)) return
    plan.value = null
    error.value = '無法讀取名額規劃，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => [props.campusKey, planYear.value, planSemester.value], () => void load(), { immediate: true })

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  try {
    const targets = Object.fromEntries(changedGrades.value.map((grade) => [grade, drafts.value[grade] ?? null]))
    const result = await saveIntakeTargets(props.campusKey, { school_year: planYear.value, semester: planSemester.value, targets })
    plan.value = result
    resetDrafts()
    ElMessage.success('已儲存計畫名額')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '儲存招生名額計畫失敗'))
  } finally {
    saving.value = false
  }
}

const seats = (value: number | null | undefined) => (value === null || value === undefined ? '未設定' : String(value))
const remainingText = (value: number | null | undefined) => (value === null || value === undefined ? '—' : String(value))

function rowClass({ row }: { row: IntakePlanRow }): string {
  return row.over_capacity ? 'intake-row--over' : ''
}
</script>

<template>
  <section class="intake">
    <div v-if="schoolYear === null || semester === null" class="intake__notes">
      <p v-if="schoolYear === null" class="hint">名額規劃一次看一個學期：頁首選了「不限學年」，先顯示 {{ defaultYear }} 學年。</p>
      <p v-if="semester === null" class="hint">頁首沒選入學學期，先顯示上學期；要看下學期請在上方選「下學期」。</p>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!plan" :rows="5" animated />

    <div v-else class="panel" :aria-busy="loading">
      <div class="panel__head">
        <h2>{{ term }}的計畫名額</h2>
        <div v-if="canWrite" class="intake__actions">
          <span v-if="dirty" class="dirty-note">有修改還沒儲存，剩餘會在儲存後重算</span>
          <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">儲存計畫名額</el-button>
        </div>
      </div>
      <p v-if="!anyTarget" class="hint intake__empty">
        {{ term }}還沒有設定計畫名額。{{ canWrite ? '在「計畫名額」欄填人數後按「儲存計畫名額」；留空代表未設定。' : '請校區管理者設定。' }}
      </p>
      <el-table :data="rows" class="intake-table" :row-class-name="rowClass">
        <el-table-column label="年級" min-width="96" prop="grade" />
        <el-table-column label="計畫名額" min-width="140">
          <template #default="{ row }: { row: IntakePlanRow }">
            <el-input-number
              v-if="canWrite"
              v-model="drafts[row.grade]"
              :min="0"
              :max="999"
              :step="1"
              :value-on-clear="null"
              :disabled="saving"
              controls-position="right"
              size="small"
              placeholder="未設定"
              :aria-label="`${row.grade}計畫名額`"
              class="intake__input"
            />
            <span v-else class="num" :class="{ muted: row.target_seats === null }">{{ seats(row.target_seats) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="已保留" min-width="88">
          <template #default="{ row }: { row: IntakePlanRow }"><span class="num">{{ row.reserved }}</span></template>
        </el-table-column>
        <el-table-column label="已註冊" min-width="88">
          <template #default="{ row }: { row: IntakePlanRow }"><span class="num">{{ row.enrolled }}</span></template>
        </el-table-column>
        <el-table-column label="剩餘" min-width="150">
          <template #default="{ row }: { row: IntakePlanRow }">
            <span class="num" :class="{ 'intake__negative': (row.remaining ?? 0) < 0 }">{{ remainingText(row.remaining) }}</span>
            <el-tag v-if="row.over_capacity" type="danger" size="small" effect="light" class="intake__over">超過計畫名額</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <p class="intake__totals">
        <strong>合計</strong>
        <span>計畫 <b class="num">{{ seats(plan.totals?.target_seats) }}</b></span>
        <span>保留 <b class="num">{{ plan.totals?.reserved ?? 0 }}</b></span>
        <span>註冊 <b class="num">{{ plan.totals?.enrolled ?? 0 }}</b></span>
        <span>剩餘 <b class="num" :class="{ 'intake__negative': (plan.totals?.remaining ?? 0) < 0 }">{{ remainingText(plan.totals?.remaining) }}</b></span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.intake__notes {
  margin-bottom: 12px;
}

.intake__notes p {
  margin: 0 0 4px;
}

.intake__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 12px;
}

.intake__empty {
  margin: 0;
  padding: 12px 24px 0;
}

.intake__input {
  width: 120px;
}

/* 超額整列淡紅底（園務 over-capacity），剩餘負數紅字加粗。 */
.intake-table :deep(.intake-row--over) td.el-table__cell {
  background: var(--el-color-danger-light-9);
}

.intake__negative {
  color: var(--el-color-danger);
  font-weight: 600;
}

.intake__over {
  margin-left: 8px;
}

.intake__totals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: 0;
  padding: 12px 24px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}

.intake__totals b {
  color: var(--ink);
  font-weight: 600;
}

@media (max-width: 720px) {
  .intake__empty,
  .intake__totals {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
```

- [ ] **Step 4：保留座位 `admin/src/components/admissions/SeatDialog.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { setSeat } from '../../api/admissions'
import { apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { RecruitmentVisit } from '../../api/types'
import { currentTerm, schoolYearOptions, termLabel } from '../../admissions/academic'
import { GRADES, SEMESTER_LABELS, type Grade } from '../../admissions/constants'

// 保留座位（園務 ReserveSeatDialog；規格 6.5）。只有已預繳、未註冊、未退出的訪視會開到這裡
// （明細「更多」只在已預繳列出現）。超過計畫名額只提醒不擋：後端回 capacity_warning（A 調整第 12 條），
// 園務前端沒有顯示這個警示，官網用提醒框講清楚（本檔調整第 24 條，文案自擬）。
const props = defineProps<{ record: RecruitmentVisit | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

const grade = ref<Grade | null>(null)
const year = ref<number | null>(null)
const semester = ref<1 | 2>(1)
const pending = ref<'reserve' | 'release' | null>(null)

const defaultYear = currentTerm().schoolYear
const yearChoices = computed(() => {
  const years = schoolYearOptions(defaultYear, [1, 0, -1])
  return year.value && !years.includes(year.value) ? [...years, year.value].sort((a, b) => b - a) : years
})
const hasSeat = computed(() => Boolean(props.record?.provisional_grade))

watch(open, (value) => {
  const record = props.record
  if (!value || !record) return
  grade.value = ((record.provisional_grade ?? record.grade) as Grade | null | undefined) ?? null
  year.value = record.target_school_year ?? defaultYear
  semester.value = record.target_semester === 2 ? 2 : 1
})

function handleError(err: unknown, fallback: string) {
  if (isVersionConflict(err)) {
    ElMessage.info('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    open.value = false
    emit('stale')
    return
  }
  // 後端的拒絕原因（例如「未預繳的訪視不可保留座位」）直接顯示。
  ElMessage.error(apiErrorMessage(err, fallback))
}

async function reserve() {
  const record = props.record
  if (!record || !grade.value || !year.value || pending.value) return
  pending.value = 'reserve'
  const chosen = { grade: grade.value, year: year.value, semester: semester.value }
  try {
    const result = await setSeat(record.id, {
      grade: chosen.grade, target_school_year: chosen.year, target_semester: chosen.semester, expected_version: record.version,
    })
    open.value = false
    emit('saved', result.visit)
    if (result.capacity_warning) {
      await ElMessageBox.alert(
        `已保留座位，但 ${chosen.grade}（${termLabel(chosen.year, chosen.semester)}）的已保留加已註冊超過計畫名額。超收是否可行請與園長確認；計畫名額可在「名額規劃」調整。`,
        '已保留，但超過計畫名額',
        { type: 'warning', confirmButtonText: '知道了' },
      ).catch(() => undefined)
    } else {
      ElMessage.success('已保留座位')
    }
  } catch (err) {
    handleError(err, '保留座位失敗')
  } finally {
    pending.value = null
  }
}

// 釋放只清年級，入學學年學期不動（園務：否則卡片會從看板消失）。
async function release() {
  const record = props.record
  if (!record || pending.value) return
  pending.value = 'release'
  try {
    const result = await setSeat(record.id, {
      grade: null,
      target_school_year: record.target_school_year ?? year.value,
      target_semester: record.target_semester ?? semester.value,
      expected_version: record.version,
    })
    ElMessage.success('已釋放保留')
    open.value = false
    emit('saved', result.visit)
  } catch (err) {
    handleError(err, '釋放保留名額失敗')
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="seat-dialog"
    title="保留座位"
    width="min(420px, calc(100vw - 32px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="pending === null"
    :show-close="pending === null"
  >
    <p class="seat__child">幼生：{{ record?.child_name }}</p>
    <p class="hint seat__lead">保留後算進名額規劃的「已保留」。超過計畫名額只會提醒，不會擋。</p>
    <el-form label-position="top" :disabled="pending !== null" @submit.prevent>
      <el-form-item label="暫定年級" required>
        <el-select v-model="grade" placeholder="請選擇年級" aria-label="暫定年級" style="width: 100%">
          <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="目標學年（民國）" required>
        <el-select v-model="year" placeholder="學年" aria-label="目標學年" style="width: 100%">
          <el-option v-for="item in yearChoices" :key="item" :label="`${item} 學年`" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="目標學期">
        <el-radio-group v-model="semester" aria-label="目標學期">
          <el-radio-button :value="1">{{ SEMESTER_LABELS[1] }}</el-radio-button>
          <el-radio-button :value="2">{{ SEMESTER_LABELS[2] }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="seat__footer">
        <el-button v-if="hasSeat" type="warning" plain :loading="pending === 'release'" :disabled="pending !== null" @click="release">釋放保留</el-button>
        <span class="seat__spacer" />
        <el-button :disabled="pending !== null" @click="open = false">取消</el-button>
        <el-button type="primary" :loading="pending === 'reserve'" :disabled="!grade || !year || pending !== null" @click="reserve">確認保留</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.seat__child {
  margin: 0 0 4px;
  color: var(--ink);
  font-weight: 500;
}

.seat__lead {
  margin: 0 0 16px;
}

.seat__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.seat__footer .el-button + .el-button {
  margin-left: 0;
}

.seat__spacer {
  flex: 1;
}
</style>
```

- [ ] **Step 5：明細「更多」加保留座位（`admin/src/components/admissions/RecordsTab.vue`）**

1. import 區 `import TransitionDialog from './TransitionDialog.vue'` 之後加：

```ts
import SeatDialog from './SeatDialog.vue'
```

2. `// ---- 列操作：更多（B4 在 withdraw 前面加 seat）----` 到 `function onMore(…) {…}` 整段換成：

```ts
// ---- 列操作：更多 ----
type MoreCommand = 'seat' | 'withdraw' | 'delete'

function moreCommands(row: RecruitmentVisit): { command: MoreCommand; label: string }[] {
  const items: { command: MoreCommand; label: string }[] = []
  // 保留座位只給已預繳、未註冊、未退出（規格 6.5）；已註冊不能清除保留，要改年級請先取消註冊。
  if (row.stage === 'deposited' && canWrite.value) items.push({ command: 'seat', label: row.provisional_grade ? '變更座位' : '保留座位' })
  // 退預繳要 write、退註冊要 convert（規格 6.3）；已訪視沒有可退的款項（園務 :610）。
  if (row.stage === 'deposited' && canWrite.value) items.push({ command: 'withdraw', label: '退預繳' })
  if (row.stage === 'enrolled' && canConvert.value) items.push({ command: 'withdraw', label: '退註冊' })
  if (canWrite.value) items.push({ command: 'delete', label: '刪除' })
  return items
}

const seatOpen = ref(false)
const seatFor = ref<RecruitmentVisit | null>(null)

function onMore(row: RecruitmentVisit, command: MoreCommand) {
  if (command === 'seat') {
    seatFor.value = row
    seatOpen.value = true
  } else if (command === 'withdraw') {
    void withdraw(row)
  } else {
    void remove(row)
  }
}
```

3. template 最後的 `<!-- B4：SeatDialog -->` 換成：

```vue
    <SeatDialog v-model="seatOpen" :record="seatFor" @saved="load" @stale="load" />
```

- [ ] **Step 6：把名額規劃接上 `admin/src/views/AdmissionsView.vue`**

1. import 區 `import StatsTab …` 之前加：

```ts
import IntakePlanTab from '../components/admissions/IntakePlanTab.vue'
```

2. template 的 `<RecordsTab … />` 之後、`<StatsTab` 之前加：

```vue
        <IntakePlanTab v-if="tab === 'intake'" :campus-key="campus" :school-year="schoolYear" :semester="semester" />
```

- [ ] **Step 7：跑 B4 測試、B2 明細測試與型別檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/admissionsIntake.test.ts
npx vitest run src/__tests__/admissionsRecords.test.ts
npx vitest run src/__tests__/admissionsView.test.ts
npm run typecheck
```

Expected：全部 PASS；typecheck 沒有錯誤。B1 的「統計分析（C 階段前的空狀態）」測試按「看名額規劃」後會掛上 `IntakePlanTab`，mock 對 `/admin/admissions/intake-plan` 回空陣列：元件當成沒有資料只顯示骨架，不會丟例外。

- [ ] **Step 8：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/components/admissions/IntakePlanTab.vue admin/src/components/admissions/SeatDialog.vue \
  admin/src/components/admissions/RecordsTab.vue admin/src/views/AdmissionsView.vue admin/src/__tests__/admissionsIntake.test.ts
git commit -m "feat(admin): 招生名額規劃與保留座位，未設定與 0 分開顯示

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B5：官網預約分頁與預約明細的到場確認框、招生訪視連結

**Files:**
- Create: `admin/src/components/admissions/ArrivalsTab.vue`
- Modify: `admin/src/views/VisitDetailView.vue`（`markCompleted` 第 513–525 行加確認框；處理面板加「招生訪視」區塊）、`admin/src/views/AdmissionsView.vue`（掛上官網預約、標籤筆數跟著更新）、`admin/src/api/errors.ts`（補建的兩個 409 備援文案）
- Modify（既有測試）：`admin/src/__tests__/visitDetails.test.ts`（「已確認的案件可以標記完成，也保留未到場」）、`admin/src/__tests__/caseHandling.test.ts`（「完成參觀後也重抓側欄的待核准數」）
- Test: `admin/src/__tests__/admissionsArrivals.test.ts`、`admin/src/__tests__/admissionsVisitDetail.test.ts`

**Interfaces:**
- Consumes：B1 `getArrivals`、`createFromVisitRequest`、`listRecords`；`ArrivalRow = {visit_request_id, slot_date, start_time, parent_name, child_name, party_size, status}`；預約既有 `POST /admin/visit-requests/{id}/complete`、`/no-show`（`booking.handle`，不另包）；`utils/sessions.ts` 的 `sessionName`；`labels.ts` 的 `formatDate`、`formatWeekday`、`partySizeLabel`；`stores/openRequests` 的 `refresh(true)`。A 調整第 13 條：補建只接受 completed 且未匿名化，否則 409 `VISIT_REQUEST_NOT_COMPLETED`／`VISIT_REQUEST_ANONYMIZED`。
- Produces：
  - `ArrivalsTab.vue`：`props { campusKey: string }`；`emits { count: [awaiting: number] }`（每次讀完待確認清單都回報筆數，頁面拿來更新分頁標籤，本檔調整第 21 條）。
  - `VisitDetailView.vue`：招生訪視連結 `{ path: '/admissions', query: { campus, tab: 'records', vr, sy: 'all' } }`（本檔調整第 22 條）。

- [ ] **Step 1：官網預約分頁的失敗測試 `admin/src/__tests__/admissionsArrivals.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import ArrivalsTab from '../components/admissions/ArrivalsTab.vue'
import { ApiError } from '../api/client'
import { testUser } from './fixtures'
import {
  arrivalRow, button, cleanup, deferred, hasButton, mockGet, mockPost, mountWith, pathsTo, queryOf, VR_ID, VR_ID_2,
} from './admissionsTestKit'

afterEach(cleanup)

const rows = (wrapper: VueWrapper, table: string) => wrapper.findAll(`.${table} .el-table__body tr`).map((row) => row.text())
const arrivals = (awaiting: unknown[] = [arrivalRow()], missing: unknown[] = []) => ({ awaiting, missing })
const confirmOk = () => vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

describe('官網預約：待確認到場（規格 6.1 第 2 點）', () => {
  it('列出場次（上午場 10:00 格式）、家長、孩子、人數與查看預約', async () => {
    mockGet({
      '/admin/admissions/arrivals': arrivals(
        [arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2, start_time: '14:00:00', child_name: null, party_size: null })],
        [arrivalRow({ visit_request_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', parent_name: '林爸爸', status: 'completed' })],
      ),
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    const [first, second] = rows(wrapper, 'arrivals-table')
    for (const text of ['2026/09/26（週六）上午場 10:00', '陳媽媽', '陳小寶', '2 位']) expect(first).toContain(text)
    expect(second).toContain('下午場 14:00')
    expect(second).toContain('未填寫')
    expect(wrapper.find(`a[href="/visit-requests/${VR_ID}"]`).text()).toBe('查看預約')
    expect(rows(wrapper, 'missing-table')[0]).toContain('林爸爸')
    expect(wrapper.emitted('count')).toEqual([[2]])
  })

  it('沒有待確認時說明；沒有要補建的就不顯示下方區塊', async () => {
    mockGet({ '/admin/admissions/arrivals': arrivals([], []) })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('目前沒有待確認到場的預約。')
    expect(wrapper.text()).not.toContain('已到場但沒有招生訪視')
    expect(wrapper.emitted('count')).toEqual([[0]])
  })

  it('讀取失敗顯示錯誤，可以重新載入', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/arrivals': () => {
        if (fail) throw new Error('offline')
        return arrivals()
      },
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('無法讀取官網預約，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
    expect(rows(wrapper, 'arrivals-table')[0]).toContain('陳媽媽')
  })

  it('已到場：先確認（同預約明細的文案），送既有 /complete，提示並重新整理；按先不要不送', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    let remaining = [arrivalRow()]
    const get = mockGet({ '/admin/admissions/arrivals': () => arrivals(remaining) })
    const post = mockPost({
      [`/admin/visit-requests/${VR_ID}/complete`]: () => {
        remaining = []
        return {}
      },
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]!.slice(0, 2)).toEqual(['會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？'])
    expect(post).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(success).toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
    expect(wrapper.emitted('count')!.at(-1)).toEqual([0])
  })

  it('未到場：照預約明細的確認框，送既有 /no-show，不建立招生訪視', async () => {
    const confirm = confirmOk()
    const post = mockPost()
    mockGet({ '/admin/admissions/arrivals': arrivals() })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '未到場')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]![1]).toBe('標記為未到場？')
    expect(String(confirm.mock.calls[0]![0])).toContain('名額仍算已使用')
    expect(post.mock.calls.map((call) => call[0])).toEqual([`/admin/visit-requests/${VR_ID}/no-show`])
  })

  it('別人剛處理過這筆（409）：提示並重新整理，不顯示錯誤', async () => {
    confirmOk()
    const info = vi.spyOn(ElMessage, 'info')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({ '/admin/admissions/arrivals': arrivals() })
    mockPost({ [`/admin/visit-requests/${VR_ID}/complete`]: () => { throw new ApiError(409, { code: 'INVALID_TRANSITION', message: '案件狀態已變更' }) } })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(info).toHaveBeenCalledWith('這筆預約的狀態剛被其他人更新，已重新載入')
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
  })
})

describe('官網預約：已到場但沒有招生訪視', () => {
  const missingId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('建立招生訪視：送補建，提示並重新整理', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/arrivals': arrivals([], [arrivalRow({ visit_request_id: missingId, status: 'completed' })]) })
    const post = mockPost({ [`/admin/admissions/from-visit-request/${missingId}`]: { id: 'v-9' } })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    expect(wrapper.text()).toContain('已到場但沒有招生訪視')
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/admissions/from-visit-request/${missingId}`)
    expect(success).toHaveBeenCalledWith('已建立招生訪視')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
  })

  it('預約已不是「已到場」或已匿名化（409）：說明原因並重新整理', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const get = mockGet({ '/admin/admissions/arrivals': arrivals([], [arrivalRow({ visit_request_id: missingId, status: 'completed' })]) })
    mockPost({ [`/admin/admissions/from-visit-request/${missingId}`]: () => { throw new ApiError(409, { code: 'VISIT_REQUEST_ANONYMIZED' }) } })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆預約已依保存政策匿名化，不能再建立招生訪視')
    expect(pathsTo(get, '/admin/admissions/arrivals')).toHaveLength(2)
  })
})

describe('官網預約：權限與切換校區', () => {
  it('只有 booking.read：看得到清單與查看預約，沒有已到場、未到場、建立招生訪視', async () => {
    mockGet({ '/admin/admissions/arrivals': arrivals([arrivalRow()], [arrivalRow({ visit_request_id: VR_ID_2, status: 'completed' })]) })
    const viewer = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' }, user: viewer })
    for (const text of ['已到場', '未到場', '建立招生訪視']) expect(hasButton(wrapper, text), text).toBe(false)
    expect(wrapper.findAll('a').filter((link) => link.text() === '查看預約')).toHaveLength(2)
    expect(wrapper.text()).toContain('你的帳號只能查看')
  })

  it('快速切換校區：義華較晚回來也只顯示仁武，筆數也只回報仁武', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/admissions/arrivals': (path: string) =>
        queryOf(path).get('campus_key') === 'yihua' ? slow.promise : arrivals([arrivalRow({ parent_name: '林媽媽' })]),
    })
    const { wrapper } = await mountWith(ArrivalsTab, { props: { campusKey: 'yihua' } })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    slow.resolve(arrivals([arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })]))
    await flushPromises()
    expect(rows(wrapper, 'arrivals-table')).toHaveLength(1)
    expect(rows(wrapper, 'arrivals-table')[0]).toContain('林媽媽')
    expect(wrapper.emitted('count')).toEqual([[1]])
  })

  it('頁面上的分頁標籤跟著更新筆數', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    let remaining = [arrivalRow(), arrivalRow({ visit_request_id: VR_ID_2 })]
    mockGet({ '/admin/admissions/arrivals': () => arrivals(remaining) })
    mockPost({
      [`/admin/visit-requests/${VR_ID}/complete`]: () => {
        remaining = [arrivalRow({ visit_request_id: VR_ID_2 })]
        return {}
      },
    })
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?tab=arrivals' })
    expect(wrapper.get('.admissions__count').text()).toBe('2')
    await button(wrapper, '已到場')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.admissions__count').text()).toBe('1')
  })
})
```

- [ ] **Step 2：預約明細的失敗測試 `admin/src/__tests__/admissionsVisitDetail.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { button, cleanup, hasButton, mockGet, mockPost, pathsTo, queryOf, superAdmin, visit, VR_ID, wrappers } from './admissionsTestKit'

afterEach(cleanup)

// 已開始的場次：標記已到場只在這種場次出現。
const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const detail = (changes: Record<string, unknown> = {}) => ({
  id: VR_ID, campus_key: 'yihua', status: 'confirmed', parent_name: '陳媽媽', phone: '0912345678', child_name: '陳小寶',
  child_birthdate: '2023-03-02', email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: null, confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web', history: [],
  pending_reschedule: null, access_link: null, version: 1, ...changes,
})

function mockDetail(data: Record<string, unknown>, records: unknown[] | (() => unknown[]) = []) {
  return mockGet({
    [`/admin/visit-requests/${VR_ID}/contact-notes`]: [],
    [`/admin/visit-requests/${VR_ID}`]: () => data,
    '/admin/visit-requests?': [],
    '/admin/slots': [],
    '/admin/visit-staff': [],
    '/admin/booking-config': {},
    '/admin/dashboard': {},
    '/admin/admissions/records': () => (typeof records === 'function' ? records() : records),
  })
}

async function mountDetail(user: UserOut = superAdmin()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
      { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
    ],
  })
  await router.push(`/visit-requests/${VR_ID}`)
  await router.isReady()
  const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('標記已到場的確認框（規格第 10 節）', () => {
  it('先確認，文案寫出會建立招生訪視；按先不要就不送', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail())
    const post = mockPost()
    const { wrapper } = await mountDetail()
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]!.slice(0, 2)).toEqual(['會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？'])
    expect(post).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(success).toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
  })
})

describe('預約明細的招生訪視連結', () => {
  it('有連結的招生訪視：顯示階段與連結，帶校區、vr 與不限學年', async () => {
    const get = mockDetail(detail({ status: 'completed' }), [visit({ visit_request_id: VR_ID, has_visit_request: true, has_deposit: true, stage: 'deposited' })])
    const { wrapper } = await mountDetail()
    const lookup = pathsTo(get, '/admin/admissions/records?')
    expect(lookup).toHaveLength(1)
    expect(Object.fromEntries(queryOf(lookup[0]!))).toEqual({ campus_key: 'yihua', visit_request_id: VR_ID, page: '1', page_size: '1' })
    const link = wrapper.get('.detail__admissions a')
    expect(link.text()).toBe('已預繳・在招生入學查看')
    const href = new URL(link.attributes('href')!, 'http://admin.invalid')
    expect(href.pathname).toBe('/admissions')
    expect(Object.fromEntries(href.searchParams)).toEqual({ campus: 'yihua', tab: 'records', vr: VR_ID, sy: 'all' })
  })

  it('已到場但沒有招生訪視：可以建立，建立後換成連結', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail({ status: 'completed' }), [])
    const post = mockPost({ [`/admin/admissions/from-visit-request/${VR_ID}`]: visit({ visit_request_id: VR_ID, stage: 'visited' }) })
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__admissions').text()).toContain('已到場，但還沒有招生訪視。')
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/admissions/from-visit-request/${VR_ID}`)
    expect(success).toHaveBeenCalledWith('已建立招生訪視')
    expect(wrapper.get('.detail__admissions a').text()).toBe('已訪視・在招生入學查看')
  })

  it('補建被拒（例如已匿名化）顯示原因', async () => {
    const error = vi.spyOn(ElMessage, 'error')
    mockDetail(detail({ status: 'completed' }), [])
    mockPost({ [`/admin/admissions/from-visit-request/${VR_ID}`]: () => { throw new ApiError(409, { code: 'VISIT_REQUEST_ANONYMIZED' }) } })
    const { wrapper } = await mountDetail()
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith('這筆預約已依保存政策匿名化，不能再建立招生訪視')
  })

  it('還沒到場、也沒有招生訪視：不顯示這一區', async () => {
    mockDetail(detail(), [])
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
  })

  it('能看招生、不能建立的帳號只看到說明；沒有 admissions.read 不查招生 API', async () => {
    mockDetail(detail({ status: 'completed' }), [])
    const viewer = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] })
    const { wrapper } = await mountDetail(viewer)
    expect(wrapper.get('.detail__admissions').text()).toContain('請有招生權限的同事建立')
    expect(hasButton(wrapper, '建立招生訪視')).toBe(false)
    cleanup()

    const get = mockDetail(detail({ status: 'completed' }), [])
    const bookingOnly = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['booking.read', 'booking.handle'] })
    const second = await mountDetail(bookingOnly)
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
    expect(second.wrapper.find('.detail__admissions').exists()).toBe(false)
  })
})
```

- [ ] **Step 3：跑兩支新測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsArrivals.test.ts`
Expected: FAIL，`Failed to resolve import "../components/admissions/ArrivalsTab.vue"`。

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/admissionsVisitDetail.test.ts`
Expected: FAIL：確認框那一則因為目前 `markCompleted` 沒有確認框、直接送出而失敗（`confirm.mock.calls[0]` 是 undefined）；連結那幾則找不到 `.detail__admissions`。

- [ ] **Step 4：`admin/src/api/errors.ts` 補建的備援文案**

`ERROR_CODE_MESSAGES` 裡 B1 加的 `TRANSITION_NOT_ALLOWED` 那一行之後加：

```ts
  VISIT_REQUEST_NOT_COMPLETED: '這筆預約不是「已到場」，不能建立招生訪視',
  VISIT_REQUEST_ANONYMIZED: '這筆預約已依保存政策匿名化，不能再建立招生訪視',
```

- [ ] **Step 5：官網預約分頁 `admin/src/components/admissions/ArrivalsTab.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createFromVisitRequest, getArrivals } from '../../api/admissions'
import { api, ApiError } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import type { ArrivalRow, Arrivals } from '../../api/types'
import { formatDate, formatWeekday, partySizeLabel } from '../../api/labels'
import { sessionName } from '../../utils/sessions'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { useOpenRequestsStore } from '../../stores/openRequests'

// 官網預約（規格 6.1 第 2 點；比照園務「官網報名」分頁的位置）。上半是場次已開始、還沒確認到場的
// 預約，每列「已到場」「未到場」沿用預約既有的 /complete、/no-show（booking.handle）；確認框文案
// 與預約明細一致。下半是「已到場但沒有招生訪視」，每列「建立招生訪視」（admissions.write＋booking.read）。
const props = defineProps<{ campusKey: string }>()
const emit = defineEmits<{ count: [awaiting: number] }>()

const { can } = usePermissions()
const canHandle = computed(() => can('booking.handle'))
const canCreate = computed(() => can('admissions.write') && can('booking.read'))
const openRequests = useOpenRequestsStore()

const data = ref<Arrivals | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const pending = ref<{ id: string; action: 'complete' | 'no_show' | 'create' } | null>(null)
const requests = useRequestSequence()

async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) data.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getArrivals(props.campusKey)
    if (!requests.isCurrent(request)) return
    data.value = { awaiting: Array.isArray(result?.awaiting) ? result.awaiting : [], missing: Array.isArray(result?.missing) ? result.missing : [] } as Arrivals
    emit('count', data.value.awaiting.length)
  } catch {
    if (!requests.isCurrent(request)) return
    data.value = null
    error.value = '無法讀取官網預約，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => props.campusKey, () => void load(), { immediate: true })

// 「2026/09/26（週六）上午場 10:00」：場次名稱用預約改版的 sessionName，不另寫一份（規格第 10 節）。
function sessionText(row: ArrivalRow): string {
  if (!row.slot_date || !row.start_time) return '—'
  // A 調整第 27 條：改版前的舊預約可能沒有場次。
  if (!row.slot_date || !row.start_time) return '沒有場次'
  return `${formatDate(row.slot_date)}（${formatWeekday(row.slot_date)}）${sessionName(row.start_time)}`
}

const isPending = (row: ArrivalRow, action: 'complete' | 'no_show' | 'create') =>
  pending.value?.id === row.visit_request_id && pending.value.action === action

function reportBookingError(err: unknown) {
  // 預約的狀態剛被別人改了（例如已在預約明細標記過）：後端回 409，重讀清單就好。
  if (err instanceof ApiError && err.status === 409) {
    ElMessage.info('這筆預約的狀態剛被其他人更新，已重新載入')
    void load({ keep: true })
    return
  }
  ElMessage.error(apiErrorMessage(err, '操作失敗'))
}

async function markArrived(row: ArrivalRow) {
  try {
    // 與預約明細「標記已到場」同一個確認框（規格第 10 節）。
    await ElMessageBox.confirm('會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？', {
      confirmButtonText: '標記已到場',
      cancelButtonText: '先不要',
      type: 'info',
    })
  } catch {
    return
  }
  pending.value = { id: row.visit_request_id, action: 'complete' }
  try {
    await api.post(`/admin/visit-requests/${row.visit_request_id}/complete`)
    ElMessage.success('已標記已到場，招生訪視已建立')
    openRequests.refresh(true)
    await load({ keep: true })
  } catch (err) {
    reportBookingError(err)
  } finally {
    pending.value = null
  }
}

async function markNoShow(row: ArrivalRow) {
  try {
    // 預約明細 markNoShow 的原文。
    await ElMessageBox.confirm('標記後這筆案件會結案。這一場的名額仍算已使用，不會再開放給別人。', '標記為未到場？', {
      confirmButtonText: '標記未到場',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  pending.value = { id: row.visit_request_id, action: 'no_show' }
  try {
    await api.post(`/admin/visit-requests/${row.visit_request_id}/no-show`)
    ElMessage.success('已標記未到場')
    openRequests.refresh(true)
    await load({ keep: true })
  } catch (err) {
    reportBookingError(err)
  } finally {
    pending.value = null
  }
}

async function createVisit(row: ArrivalRow) {
  pending.value = { id: row.visit_request_id, action: 'create' }
  try {
    await createFromVisitRequest(row.visit_request_id)
    ElMessage.success('已建立招生訪視')
    await load({ keep: true })
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // VISIT_REQUEST_NOT_COMPLETED／VISIT_REQUEST_ANONYMIZED（A 調整第 13 條）：說明後重讀，這一列會消失。
      ElMessage.warning(apiErrorMessage(err, '這筆預約現在不能建立招生訪視'))
      void load({ keep: true })
    } else {
      ElMessage.error(apiErrorMessage(err, '建立招生訪視失敗'))
    }
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <section class="arrivals">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="5" animated />

    <template v-else>
      <div class="panel" :aria-busy="loading">
        <div class="panel__head">
          <h2>待確認到場</h2>
          <span class="hint">場次已開始、還沒標記到場的官網預約</span>
        </div>
        <p v-if="!canHandle" class="hint arrivals__lead">你的帳號只能查看；已到場、未到場由負責處理案件的同事標記。</p>
        <el-table :data="data.awaiting" class="arrivals-table">
          <template #empty>
            <div class="arrivals__empty">
              <strong>目前沒有待確認到場的預約。</strong>
              <span class="hint">場次開始後，還沒標記到場的預約會列在這裡；標記已到場就會建立招生訪視。</span>
            </div>
          </template>
          <el-table-column label="場次" min-width="200">
            <template #default="{ row }: { row: ArrivalRow }"><span class="num">{{ sessionText(row) }}</span></template>
          </el-table-column>
          <el-table-column label="家長稱呼" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }">{{ row.parent_name }}</template>
          </el-table-column>
          <el-table-column label="孩子姓名" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }"><span :class="{ muted: !row.child_name }">{{ row.child_name || '未填寫' }}</span></template>
          </el-table-column>
          <el-table-column label="參觀人數" width="96">
            <template #default="{ row }: { row: ArrivalRow }">{{ partySizeLabel(row.party_size) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="240">
            <template #default="{ row }: { row: ArrivalRow }">
              <div class="cell-actions arrivals__actions">
                <template v-if="canHandle">
                  <el-button size="small" type="primary" :loading="isPending(row, 'complete')" :disabled="pending !== null" @click="markArrived(row)">已到場</el-button>
                  <el-button size="small" :loading="isPending(row, 'no_show')" :disabled="pending !== null" @click="markNoShow(row)">未到場</el-button>
                </template>
                <router-link :to="`/visit-requests/${row.visit_request_id}`" class="arrivals__link">查看預約</router-link>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="data.missing.length" class="panel arrivals__missing">
        <div class="panel__head"><h2>已到場但沒有招生訪視</h2></div>
        <p class="hint arrivals__lead">本功能上線前已標記到場、或招生訪視被刪除的預約。建立後會出現在漏斗看板的「已訪視」。</p>
        <el-table :data="data.missing" class="missing-table">
          <el-table-column label="場次" min-width="200">
            <template #default="{ row }: { row: ArrivalRow }"><span class="num">{{ sessionText(row) }}</span></template>
          </el-table-column>
          <el-table-column label="家長稱呼" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }">{{ row.parent_name }}</template>
          </el-table-column>
          <el-table-column label="孩子姓名" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }"><span :class="{ muted: !row.child_name }">{{ row.child_name || '未填寫' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="240">
            <template #default="{ row }: { row: ArrivalRow }">
              <div class="cell-actions arrivals__actions">
                <el-button v-if="canCreate" size="small" type="primary" plain :loading="isPending(row, 'create')" :disabled="pending !== null" @click="createVisit(row)">建立招生訪視</el-button>
                <router-link :to="`/visit-requests/${row.visit_request_id}`" class="arrivals__link">查看預約</router-link>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.arrivals__lead {
  margin: 0;
  padding: 12px 24px 0;
}

.arrivals__empty {
  display: grid;
  gap: 6px;
  padding: 24px 16px;
  color: var(--ink-2);
  line-height: 1.6;
  text-align: center;
}

.arrivals__actions {
  flex-wrap: wrap;
  align-items: center;
}

.arrivals__actions .el-button + .el-button {
  margin-left: 0;
}

.arrivals__link {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 4px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 720px) {
  .arrivals__lead {
    padding: 12px 16px 0;
  }

  .arrivals__link {
    min-height: 44px;
  }
}
</style>
```

- [ ] **Step 6：修改 `admin/src/views/VisitDetailView.vue`**

1. import 區：第 8 行的型別 import 改成

```ts
import type { RecruitmentVisit, VisitContactNoteOut, VisitRequestDetailOut, VisitRequestFullOut, VisitSlotOut } from '../api/types'
```

第 20 行 `import { readVisitNoteDraft, writeVisitNoteDraft } from '../composables/visitNoteDraft'` 之後加：

```ts
import { createFromVisitRequest, listRecords } from '../api/admissions'
import { stageLabel } from '../admissions/constants'
```

2. `markCompleted`（第 513–525 行）整段換成：

```ts
// 標記已到場會在同一個交易裡建立招生訪視（規格 6.1），所以先確認（規格第 10 節原文）。
async function markCompleted() {
  try {
    await ElMessageBox.confirm('會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？', {
      confirmButtonText: '標記已到場',
      cancelButtonText: '先不要',
      type: 'info',
    })
  } catch {
    return
  }
  pendingAction.value = 'complete'
  try {
    await api.post(`/admin/visit-requests/${id.value}/complete`)
    ElMessage.success('已標記已到場，招生訪視已建立')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    pendingAction.value = null
  }
}

// ---- 招生訪視（規格第 10 節）----
// 有 admissions.read 才查；已到場但還沒有招生訪視（上線前的舊預約、或招生訪視被刪掉）時，
// 有 admissions.write 的人可以補建（後端另要 booking.read，能看到這頁就有）。
const canReadAdmissions = computed(() => can('admissions.read'))
const canCreateAdmissions = computed(() => can('admissions.write'))
const admissionsVisit = ref<RecruitmentVisit | null>(null)
const admissionsChecked = ref(false)
const creatingAdmissions = ref(false)

async function loadAdmissionsVisit() {
  const current = detail.value
  admissionsVisit.value = null
  admissionsChecked.value = false
  if (!current || !canReadAdmissions.value) return
  const gen = generation
  try {
    const rows = await listRecords({ campus_key: current.campus_key, visit_request_id: current.id, page: 1, page_size: 1 })
    if (gen !== generation || detail.value?.id !== current.id) return
    admissionsVisit.value = Array.isArray(rows) ? (rows[0] ?? null) : null
    admissionsChecked.value = true
  } catch {
    // 讀不到就不顯示這一區，不影響處理案件。
  }
}

// 換案件或狀態變了（例如剛標記已到場）才重查；只是重讀明細不重查。
watch(() => `${detail.value?.id ?? ''}|${detail.value?.status ?? ''}`, () => void loadAdmissionsVisit())

// 帶 sy=all：到場當下寫入的入學學期不一定是招生頁預設的學年（本檔調整第 22 條）。
const admissionsLink = computed(() => ({
  path: '/admissions',
  query: { campus: detail.value?.campus_key ?? '', tab: 'records', vr: detail.value?.id ?? '', sy: 'all' },
}))

async function createAdmissionsVisit() {
  const current = detail.value
  if (!current || creatingAdmissions.value) return
  creatingAdmissions.value = true
  try {
    const created = await createFromVisitRequest(current.id)
    if (detail.value?.id !== current.id) return
    admissionsVisit.value = created
    admissionsChecked.value = true
    ElMessage.success('已建立招生訪視')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '建立招生訪視失敗'))
    // 409：預約已不是已到場或已匿名化，重讀讓畫面跟上。
    if (err instanceof ApiError && err.status === 409) await load({ quiet: true })
  } finally {
    creatingAdmissions.value = false
  }
}
```

3. template：處理面板裡 `<div class="panel__body detail__actions">…</div>` 結束之後、`<div class="detail__assignee">` 之前加：

```vue
            <div v-if="canReadAdmissions && (admissionsVisit || (admissionsChecked && detail.status === 'completed'))" class="detail__admissions">
              <span class="detail__admissions-label">招生訪視</span>
              <router-link v-if="admissionsVisit" :to="admissionsLink">{{ stageLabel(admissionsVisit.stage) }}・在招生入學查看</router-link>
              <template v-else-if="canCreateAdmissions">
                <span class="hint">已到場，但還沒有招生訪視。</span>
                <el-button size="small" :loading="creatingAdmissions" :disabled="busy" @click="createAdmissionsVisit">建立招生訪視</el-button>
              </template>
              <span v-else class="hint">已到場，但還沒有招生訪視；請有招生權限的同事建立。</span>
            </div>
```

4. `<style scoped>` 裡 `.detail__assignee {…}` 規則之後加：

```css
/* 招生訪視：與承辦人同一種分隔與留白。 */
.detail__admissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-2);
}

.detail__admissions-label {
  flex-basis: 100%;
  font-weight: 500;
}

.detail__admissions a {
  text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 720px) {
  .detail__admissions {
    padding: 12px 16px;
  }
}
```

- [ ] **Step 7：改寫受影響的既有預約明細測試**

加了確認框之後，沒有 stub `ElMessageBox.confirm` 的「標記已到場」測試會停在真的確認框、不會送出。兩處都只補 stub，斷言不變：

1. `admin/src/__tests__/visitDetails.test.ts`「已確認的案件可以標記完成，也保留未到場」（第 45 行起）：`const post = …` 那一行之前加

```ts
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue({ value: '', action: 'confirm' } as never)
```

2. `admin/src/__tests__/caseHandling.test.ts`「完成參觀後也重抓側欄的待核准數」（第 98 行起）：`vi.spyOn(api, 'post')…` 那一行之前加

```ts
    confirmOk()
```

其他掛載 `VisitDetailView` 的測試（`bookingConsentReadiness`、`displayNames`、`openRequestsUx`、`followUpUx`、`selfBookingDetail`、`ux20260928B2`、`uxRound6`）不必改：super_admin 會多打一次 `/admin/admissions/records?…`，各檔的 GET mock 對它回的不是陣列時，`loadAdmissionsVisit` 當成沒有招生訪視；這些測試的案件都不是 `completed`，不會顯示新區塊。各檔只用 `filter`／`find` 檢查自己關心的路徑，不受多一次請求影響（已逐檔核對 `get.mock.calls` 的用法）。

- [ ] **Step 8：把官網預約接上 `admin/src/views/AdmissionsView.vue`**

1. import 區 `import StatsTab …` 之前加：

```ts
import ArrivalsTab from '../components/admissions/ArrivalsTab.vue'
```

2. `function showUnscoped() {…}` 之後加：

```ts
// 官網預約分頁讀完清單會回報待確認筆數；標記到場後標籤上的數字跟著變。
function onArrivalsCount(count: number) {
  arrivalsCount.value = count
}
```

3. template 的 `<IntakePlanTab … />` 之後、`<StatsTab` 之前加：

```vue
        <ArrivalsTab v-if="tab === 'arrivals' && canSeeArrivals" :campus-key="campus" @count="onArrivalsCount" />
```

- [ ] **Step 9：跑 B5 測試、改過的既有測試與型別檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/admissionsArrivals.test.ts
npx vitest run src/__tests__/admissionsVisitDetail.test.ts
npx vitest run src/__tests__/visitDetails.test.ts
npx vitest run src/__tests__/caseHandling.test.ts
npx vitest run src/__tests__/selfBookingDetail.test.ts src/__tests__/ux20260928B2.test.ts src/__tests__/uxRound6.test.ts
npx vitest run src/__tests__/admissionsView.test.ts
npm run typecheck
```

Expected：全部 PASS；typecheck 沒有錯誤。

- [ ] **Step 10：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/components/admissions/ArrivalsTab.vue admin/src/views/VisitDetailView.vue admin/src/views/AdmissionsView.vue admin/src/api/errors.ts \
  admin/src/__tests__/admissionsArrivals.test.ts admin/src/__tests__/admissionsVisitDetail.test.ts \
  admin/src/__tests__/visitDetails.test.ts admin/src/__tests__/caseHandling.test.ts
git commit -m "feat(admin): 官網預約待確認到場與補建招生訪視，預約明細加到場確認框與招生連結

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B6：保存政策的「招生訪視」天數與報表類別

**Files:**
- Modify: `admin/src/views/PoliciesView.vue`（表單、試算、確認框、清理紀錄）
- Verify（必要時 Modify）：`admin/src/api/labels.ts` 的 `RETENTION_CATEGORY_LABELS`（第 544–548 行）
- Test: `admin/src/__tests__/policiesUx.test.ts`（檔尾加一個 describe，檔頭加一行 import）

**Interfaces:**
- Consumes：A7 的 `RetentionPolicyOut.admissions_days: number | null`、`RetentionPolicyUpdate.admissions_days`（只有請求帶這個鍵才寫入，A 調整第 15 條）、`RetentionReportOut.counts.admissions`、清理紀錄 `days.admissions_days`（A7 若有記）；總覽技術調整第 7 條：NULL＝不自動清理，符合條件是 `updated_at < now - admissions_days`。
- Produces：保存政策頁多一個「招生訪視」天數欄（30–3650，留空＝不自動清理）；試算與清理紀錄在回應有 `admissions` 時列出「招生訪視 N 筆」。

- [ ] **Step 1：核對 `RETENTION_CATEGORY_LABELS`**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
grep -n "admissions" admin/src/api/labels.ts
grep -n "admissions_days" contracts/generated/website-api.d.ts
```

Expected：第一個指令看得到 `admissions: '招生訪視',`（A7 加在 `RETENTION_CATEGORY_LABELS`）。沒有的話，在 `admin/src/api/labels.ts` 的 `RETENTION_CATEGORY_LABELS` 裡 `completed: '已完成參觀',` 之後加：

```ts
  admissions: '招生訪視',
```

第二個指令要看到 `RetentionPolicyOut` 與 `RetentionPolicyUpdate` 都有 `admissions_days`；沒有就停下回報（A7 未完成，不要自己改契約）。

- [ ] **Step 2：失敗測試（`admin/src/__tests__/policiesUx.test.ts`）**

檔頭 `import { testUser } from './fixtures'` 之後加：

```ts
import { RETENTION_CATEGORY_LABELS } from '../api/labels'
```

檔尾加：

```ts
describe('招生訪視的保存天數（規格第 11 節）', () => {
  // 既有測試的 policy() 沒有 admissions_days 與 counts.admissions：模擬 A7 之前的回應，畫面要照舊。
  const withAdmissions = (overrides: Record<string, unknown> = {}) =>
    policy({ admissions_days: null, preview: { ...report, counts: { ...counts, admissions: 0 } }, ...overrides })

  it('報表類別有招生訪視', () => {
    expect(RETENTION_CATEGORY_LABELS.admissions).toBe('招生訪視')
  })

  it('留空＝不自動清理；欄位放在未結案提醒之後，前三欄位置不變；試算列出招生訪視', async () => {
    const { wrapper } = await setup(undefined, withAdmissions())
    const fields = wrapper.findAll('.days-field').map((field) => field.text())
    expect(fields[2]).toContain('天仍未結案')
    expect(fields[3]).toContain('最後更新後保留')
    expect(fields[3]).toContain('留空＝不自動清理')
    const input = wrapper.findAll('.retention-form input')[3]!
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('placeholder')).toBe('不自動清理')
    expect(wrapper.get('.retention__preview').text()).toMatch(/招生訪視\s*0\s*筆/)
    expect(button(wrapper, '儲存政策')!.attributes('disabled')).toBeDefined()
  })

  it('A7 之前的回應（沒有 admissions_days）不算有修改，試算也不多列一類', async () => {
    const { wrapper } = await setup()
    expect(button(wrapper, '儲存政策')!.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.retention__preview').text()).not.toContain('招生訪視')
  })

  it('填天數就送出；輸入框限制 30–3650，清空送 null', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue(withAdmissions({ admissions_days: 365, version: 2 }) as never)
    const { wrapper } = await setup(undefined, withAdmissions())
    const number = wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!
    expect(number.props()).toMatchObject({ min: 30, max: 3650, valueOnClear: null })
    number.vm.$emit('update:modelValue', 365)
    await flushPromises()
    expect(wrapper.findAll('.days-field')[3]!.text()).toContain('（約 1 年）')
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/site-policies/retention', expect.objectContaining({ expected_version: 1, admissions_days: 365 }))

    wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/site-policies/retention', expect.objectContaining({ expected_version: 2, admissions_days: null }))
  })

  it('自動清理開著時，第一次設定招生訪視天數等於開始清理：先確認，按先不要就不儲存', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const put = vi.spyOn(api, 'put')
    const { wrapper } = await setup(undefined, withAdmissions({ auto_run_enabled: true }))
    wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!.vm.$emit('update:modelValue', 730)
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    const [message, title] = confirm.mock.calls[0]! as unknown as [string, string]
    expect(title).toBe('確定縮短保留天數？')
    expect(message).toContain('招生訪視到期會清除孩子與聯絡人的個資')
    expect(put).not.toHaveBeenCalled()
  })

  it('改成不自動清理（清空）不必確認', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const put = vi.spyOn(api, 'put').mockResolvedValue(withAdmissions({ auto_run_enabled: true, version: 2 }) as never)
    const { wrapper } = await setup(undefined, withAdmissions({ auto_run_enabled: true, admissions_days: 365 }))
    wrapper.findAllComponents({ name: 'ElInputNumber' })[3]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    await button(wrapper, '儲存政策')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledOnce()
  })

  it('清理紀錄寫出招生訪視筆數與天數；舊紀錄沒有這一類就不寫', async () => {
    const newer = { ...runs[0]!, counts: { ...counts, admissions: 2 }, days: { ...days, admissions_days: 365 } }
    const { wrapper } = await setup(undefined, withAdmissions({ admissions_days: 365 }), async () => [newer, runs[1]!])
    const items = wrapper.findAll('.retention-runs__item').map((item) => item.text())
    expect(items[0]).toMatch(/招生訪視\s*2\s*筆/)
    expect(items[0]).toContain('招生訪視 365 天')
    expect(items[1]).not.toContain('招生訪視')
  })
})
```

- [ ] **Step 3：跑測試確認失敗**

Run: `cd /Users/yilunwu/Desktop/ivy-website-admissions/admin && npx vitest run src/__tests__/policiesUx.test.ts`
Expected: FAIL：新 describe 找不到第四個 `.days-field`（`fields[3]` 是 undefined）等；「報表類別有招生訪視」在 A7 已加標籤時就會通過。既有測試仍 PASS。

- [ ] **Step 4：修改 `admin/src/views/PoliciesView.vue`**

1. 第 47–49 行（`CATEGORY_KEYS`、`RetentionForm`）換成：

```ts
// 會被清理的只有已結案的三種狀態；還沒結案的只算件數提醒。招生訪視是另一類紀錄（規格第 11 節），
// 天數可以留空＝不自動清理；試算與紀錄只在回應裡有這一類時才列（A7 之前的紀錄照舊）。
const CATEGORY_KEYS = ['cancelled', 'no_show', 'completed'] as const
type RetentionForm = Pick<RetentionPolicyOut, 'cancelled_days' | 'completed_days' | 'open_overdue_days' | 'auto_run_enabled' | 'admissions_days'>
```

2. 第 52 行 `const form = ref<RetentionForm>({…})` 換成：

```ts
const form = ref<RetentionForm>({ cancelled_days: 365, completed_days: 365, open_overdue_days: 365, auto_run_enabled: false, admissions_days: null })
```

3. `dirty`（第 63–72 行）與 `daysDirty`（第 76–84 行）整段換成：

```ts
// 舊回應沒有 admissions_days（undefined）跟 null 一樣是「不自動清理」，不算修改。
const admissionsChanged = computed(() => (policy.value?.admissions_days ?? null) !== (form.value.admissions_days ?? null))

const dirty = computed(() => {
  const p = policy.value
  if (!p) return false
  return (
    p.cancelled_days !== form.value.cancelled_days ||
    p.completed_days !== form.value.completed_days ||
    p.open_overdue_days !== form.value.open_overdue_days ||
    p.auto_run_enabled !== form.value.auto_run_enabled ||
    admissionsChanged.value
  )
})
useUnsavedChanges(dirty, busy)

// 只切「每天自動清理」、天數沒動時，下方試算仍然是準的，照常顯示。
const daysDirty = computed(() => {
  const p = policy.value
  if (!p) return false
  return (
    p.cancelled_days !== form.value.cancelled_days ||
    p.completed_days !== form.value.completed_days ||
    p.open_overdue_days !== form.value.open_overdue_days ||
    admissionsChanged.value
  )
})
```

（原本第 73 行的 `useUnsavedChanges(dirty, busy)` 已包含在上面，刪掉原本那一行，不要呼叫兩次。）

4. `applyPolicy` 的 `form.value = {…}` 換成：

```ts
  form.value = {
    cancelled_days: result.cancelled_days,
    completed_days: result.completed_days,
    open_overdue_days: result.open_overdue_days,
    auto_run_enabled: result.auto_run_enabled,
    admissions_days: result.admissions_days ?? null,
  }
```

5. `confirmAutoCleanup` 裡 `const shortened = …` 與 `const lengthened = …` 兩行換成：

```ts
  const oldAdmissions = p.admissions_days ?? null
  const newAdmissions = form.value.admissions_days ?? null
  // 招生訪視從「不自動清理」改成有天數＝開始清理，當成縮短；改回留空＝不再清理，當成延長。
  const admissionsShortened = newAdmissions !== null && (oldAdmissions === null || newAdmissions < oldAdmissions)
  const admissionsLengthened = oldAdmissions !== null && (newAdmissions === null || newAdmissions > oldAdmissions)
  const shortened = form.value.cancelled_days < p.cancelled_days || form.value.completed_days < p.completed_days || admissionsShortened
  const lengthened = form.value.cancelled_days > p.cancelled_days || form.value.completed_days > p.completed_days || admissionsLengthened
```

同一個函式裡 `await ElMessageBox.confirm(` 的第一個參數換成：

```ts
      `${when}${count}到期案件的姓名、電話、孩子資料、問題與聯絡紀錄會改成匿名文字，無法復原。${admissionsShortened ? '招生訪視到期會清除孩子與聯絡人的個資、備註、電訪回應與原因說明，統計數字保留。' : ''}`,
```

6. `countLines`（第 224–226 行）換成：

```ts
function reportKeys(report: { counts: Partial<Record<string, number>> }): string[] {
  return report.counts.admissions === undefined ? [...CATEGORY_KEYS] : [...CATEGORY_KEYS, 'admissions']
}

function countLines(report: { counts: Partial<Record<string, number>> }): string {
  return reportKeys(report).map((key) => `${RETENTION_CATEGORY_LABELS[key] ?? key} ${report.counts[key] ?? 0} 筆`).join('、')
}
```

7. `runDays`（第 254–257 行）換成：

```ts
function runDays(run: RetentionRunOut): string {
  const d = run.days
  const base = `取消／未到場 ${d.cancelled_days} 天、完成 ${d.completed_days} 天`
  if (!('admissions_days' in d)) return base
  const admissions = (d as { admissions_days?: number | null }).admissions_days
  return `${base}、招生訪視 ${admissions ? `${admissions} 天` : '不自動清理'}`
}
```

8. template：「未結案提醒」那個 `<el-form-item>`（第 294–301 行）之後、「每天自動清理」之前加：

```vue
            <el-form-item label="招生訪視">
              <div class="days-field">
                <span>最後更新後保留</span>
                <el-input-number
                  v-model="form.admissions_days"
                  :min="30"
                  :max="3650"
                  :step="30"
                  :value-on-clear="null"
                  :disabled="busy"
                  placeholder="不自動清理"
                  aria-label="招生訪視：最後更新後保留幾天（留空＝不自動清理）"
                />
                <span>天<span class="days-field__hint">（{{ form.admissions_days ? daysHint(form.admissions_days) : '留空＝不自動清理' }}）</span></span>
              </div>
              <span class="field-help">招生入學頁的訪視紀錄，不隨參觀案件清理。到期會清除孩子姓名、生日、電話、聯絡人、地址、備註、電訪回應與原因說明，保留統計需要的欄位。天數請先跟園長確認；留空就不會自動清理。</span>
            </el-form-item>
```

（放在第四欄：既有測試用 `.days-field` 與 `ElInputNumber` 的索引 0–2 取前三欄，本檔調整第 25 條。）

9. template 試算清單的 `<li v-for="key in CATEGORY_KEYS" …>` 換成：

```vue
                  <li v-for="key in reportKeys(preview)" :key="key">{{ RETENTION_CATEGORY_LABELS[key] ?? key }} <strong class="num">{{ preview.counts[key] ?? 0 }}</strong> 筆</li>
```

- [ ] **Step 5：跑測試與型別檢查**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions/admin
npx vitest run src/__tests__/policiesUx.test.ts
npx vitest run src/__tests__/labelCoverage.test.ts src/__tests__/a11yStructure.test.ts
npm run typecheck
```

Expected：全部 PASS；typecheck 沒有錯誤。typecheck 若報 `RetentionPolicyOut` 沒有 `admissions_days`，代表 A7 的契約還沒產生，停下回報。

- [ ] **Step 6：B 階段閘門（全部通過才進 C）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
npm --prefix admin run typecheck
npm --prefix admin run test:unit -- --maxWorkers=2
```

Expected：typecheck 沒有錯誤；test:unit 全綠。完整的 `test:unit` 由主 session 跑（subagent 只跑單檔）。

- [ ] **Step 7：Commit（需使用者授權）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admissions
git add admin/src/views/PoliciesView.vue admin/src/__tests__/policiesUx.test.ts
# Step 1 若補了標籤，另外加上：admin/src/api/labels.ts
git commit -m "feat(admin): 保存政策加招生訪視天數（留空不自動清理）與試算類別

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 待決定

不擋本階段實作；回覆前照本計畫的預設做。

| # | 問題 | 本計畫的預設 | 何時需要 |
|---|---|---|---|
| 1 | 來源分類（`source_category`）、帶參觀老師、娃娃車（`rides_bus`）、地址分析同意要不要開在畫面上（本檔調整第 10 條） | 不放；欄位照存、照匯出 | 決定做招生獎金或區位分析時 |
| 2 | 招生訪視保存幾天（規格 Q1） | B6 只提供欄位，預設留空＝不自動清理 | 正式上線前 |
| 3 | 看板摘要「退費率」照園務是「退出 ÷ 已註冊」，名稱與分母容易誤讀 | 照抄園務名稱與公式，滑鼠移上去寫明公式（本檔調整第 20 條） | 業主看過看板後 |
| 4 | 明細只有「本頁 N 筆」、沒有總筆數（總覽技術調整第 1 條：列表回裸 list） | 上一頁／下一頁，滿 50 筆才有下一頁 | 園方需要總數時，A 另加計數端點 |
| 5 | 保留座位超過計畫名額的提醒文案（自擬「超收是否可行請與園長確認」） | 只提醒、不擋（規格 6.5） | 業主看過文案後 |
| 6 | 歷程要不要寫操作者（園務不寫） | A 有回 `actor_name` 才寫 | 併入前 |
| 7 | 接待人員可否預繳、退預繳、設定計畫名額（規格 Q2） | 畫面只看 capability，不必改程式；照規格預設可以 | 實作權限前 |
