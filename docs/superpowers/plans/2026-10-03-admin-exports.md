# 後台匯出擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓後台除了參觀案件之外，也能把招生訪視明細、未預繳名單、招生統計表、操作紀錄（以及之後的成效統計表）下載成 Excel 直接能開的 CSV。

**Architecture:** 含孩子姓名、電話、地址的名單走後端匯出（權限、稽核、筆數上限都在伺服器），抽出共用的 `app/common/csv_export.py`，參觀案件匯出也改用它（輸出不變）。畫面上已經算好的去識別統計表和操作紀錄在後台前端組 CSV，共用 `admin/src/utils/csv.ts`，中文標籤只維護在 `labels.ts` 一份。兩邊的公式注入防護是同一條規則，各有測試。

**Tech Stack:** FastAPI 0.136.1（釘版）＋SQLAlchemy 2.0（async）＋PostgreSQL；Vue 3＋Element Plus＋Vitest（jsdom）；Playwright stack e2e。

**Spec:** 沒有獨立規格。來源：使用者 2026-10-03 在「後台還有什麼可以做」清單選的第 4 項「擴充匯出：整個後台只有預約案件能匯出 CSV（`booking/routes.py:1064`），招生明細、統計、操作紀錄都不能匯出；之後招生資料要併進園務系統時也用得到」。相關既有文件：`DESIGN.md`「官網後台第七輪 UX」的 CSV 規則（第 795 行）、「招生入學（2026-10-01）」；`docs/specs/2026-09-30-website-admissions-design.md` 第 3.2、11、12 節。

## 2026-10-06 修訂（以本節為準；和下方任何 Task 文字衝突時照這裡做）

本計畫寫於 10-03（基準 `15fd9a5`），10-06 才開工，程式已經變了。實作時**下方 Task 的程式片段只當參考**：先讀現在的檔案，照本節調整，不要整段照貼。

**基準與環境：** origin/main `1cefe5cd`；分支 `feature/admin-exports-20261006`；worktree `~/Repositories/ivy-website-wt/admin-exports-20261006`（sparse checkout，admin 已 `npm ci`、backend 已 `uv sync`，web 尚未安裝，Task 9 需要時再 `npm ci`）。後端測試庫 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_exports1006_test`（已建立，**每次跑 pytest 都要帶這個環境變數**，不要用預設的 `ivy_website_test`，那是別的 session 共用的）。

**使用者 10-06 裁定（取代最後「待決定」）：** 三項都照預設——招生明細與未預繳名單開放含個資匯出（取代招生規格 3.2 的「不做含個資匯出」）、沿用 `booking.export` 授權、操作紀錄匯出不另寫稽核。

**實作者的測試規則：** 只在前景跑單一測試檔（各檔 1 分鐘內）；不跑後端或前端全套、不把測試丟背景再等。全套由 controller 在 Task 11 背景跑。

### 各 Task 的修訂

**Task 0：** 不用建 worktree（已建好），只做「計畫檔提交」。HEAD 是 `1cefe5cd`，不是 `15fd9a5`。

**Task 1：參觀案件匯出保留串流。** `booking/routes.py` 的匯出已是串流版（約 991–1111 行：`_SAFE_FILENAME_PART`、`_safe_cell`、`_export_row`、`_EXPORT_BATCH = 500`、`_stream_export_csv`、`export_visit_requests` 用 REPEATABLE READ 快照先數筆數、寫稽核再回 `StreamingResponse`）。**不要換成計畫裡一次載入的同步版。** 只做：
- 把公式注入規則與檔名清理搬到 `app/common/csv_export.py`（`safe_cell`、`filename_part`），參觀案件匯出的 `_export_row` 與檔名改用它們；其餘串流、快照、稽核、`_EXPORT_BATCH` 原封不動。
- 共用模組仍提供 `EXPORT_ROW_LIMIT`、`too_many_rows`、`csv_attachment`（給招生那兩支在記憶體組檔的匯出用）。
- 只刪真的沒用到的 import。
- 必須維持綠燈：`backend/tests/test_visit_attention_export.py` 的 `test_export_streams_in_batches_and_audit_count_matches_output`（它 monkeypatch `booking_routes._EXPORT_BATCH`）、`backend/tests/test_security_hardening.py` 第 95–113 行的公式注入測試。

**Task 3：**
- `StatsTab.vue` 約 269 行的 `<StatsOverview …>` 現在是多行、裡面有 `<template #reference-month>` 具名 slot：只在開頭標籤加 `:csv-name="csvName"`，slot 保留。
- 第七張表的標題現在是「接待人員 × 來源 交叉分析」（約 338 行），不是「介紹者 × 來源」。
- `taipeiToday` 從 `../../admissions/academic` import。`statsTab.test.ts` 第 1 行已經 import `vi`。

**Task 4：**
- `admissions/routes.py` 第 20 行現在是 `from app.admissions import academic, booking_link, constants, follow_up, funnel, intake, records`：在這行加 `download`，**保留 `follow_up`**。
- 一定要 `filters.apply(select(RecruitmentVisit), current_user_id=current_user.id)`（`records.py:299`；`owner=me` 靠它，漏傳會靜默多匯出別人負責的案件）。排序同列表端點。
- `RecruitmentVisitFilters`（`records.py:257-348`）現在多了 `follow_up`（due／upcoming／unscheduled）與 `owner`（me／none／帳號 id）。匯出一樣套用；稽核 metadata 要記：`follow_up` 記值本身，`owner` 只記類別 `me`／`none`／`staff`（**不記帳號 id**）。兩個新鍵與值都要在 `labels.ts` 有中文、`labelCoverage.test.ts` 要過。
- `has_deposit=false` 已排除退出者（`records.py:322`，10-06 口徑），沿用 filters 即可。
- **欄位改成和現在的畫面一致**（10-05「畫面放回已有的欄位」已把來源分類、帶參觀老師、娃娃車放回畫面，設計決定 3 那句「不進 CSV」作廢；只有地址分析同意仍不進 CSV）。`RECORD_HEADERS` 依序為：
  `校區、月份、序號、參觀日期、幼生姓名、英文名字、生日、班別、入學學年、入學學期、階段、預繳、已註冊、聯絡人、電話、地址、父親職業、母親職業、來源、來源分類、家長介紹、帶參觀老師、搭娃娃車、收預繳人員、未預繳原因、未預繳說明、保留座位、註冊日期、轉學期、退出原因、下次聯絡、負責人、最近聯絡、官網預約、電訪回應、備註、建檔時間`（37 欄）。
  - 階段：文字同後台 `stageMeta`（`admin/src/admissions/constants.ts:56`）：退出時依 `withdrawn_from` 寫「已退預繳」或「已退註冊」（沒有值當 deposited），其餘「已訪視／已預繳／已註冊」。
  - 地址：`address` 空就用 `district`（同畫面）。
  - 來源分類：六個代碼用後台 `SOURCE_CATEGORY_CHOICES`（`admin/src/admissions/sourceCategories.ts`）的短文字，其他代碼用 `constants.SOURCE_CATEGORIES`，都沒有就寫代碼本身，NULL 空白。後端在 `download.py` 放一份短文字對照，另寫一支後台 vitest 讀 `backend/app/admissions/download.py` 原始碼，比對它和 `SOURCE_CATEGORY_CHOICES` 一致（照 `labelCoverage.test.ts` 讀後端原始碼的寫法）。
  - 搭娃娃車：true「要搭」、false「不搭」、NULL 空白。保留座位：`provisional_grade` 原文。
  - 下次聯絡、最近聯絡：照欄位型別，日期寫 `YYYY/MM/DD`，時間戳寫台北 `YYYY/MM/DD HH:MM`。
  - 負責人：`follow_up_owner_id` 對到的同仁名稱（規則同後台 `ownerLabel`：顯示名稱，沒有就 email；查不到空白），一次查完不要逐列查。
  - 官網預約：有 `visit_request_id` 寫「是」，否則「否」。
  - 家長介紹＝`referrer`、收預繳人員＝原計畫的收預繳人。
- `test_admissions_booking_link.py` 的開關關閉清單在約 295–305 行（`no-deposit-records` 在 300），不是 361–371。`main.py` 掛招生路由在 238–240。
- `labels.ts`：`AUDIT_ACTION_LABELS` 從 396 行起；`AUDIT_METADATA_FORMATTERS` 從 1232 起（`grades:` 在 1370）；`labelCoverage.test.ts` 的 `METADATA_HELPERS` 在 325–346。

**Task 5：**
- 欄名「介紹者」改「家長介紹」；「原因分類」空值寫「未分類」（同畫面），其他空值照計畫寫空白。
- `stats.no_deposit_records` 在 `stats.py:626`。
- **測試不能用固定的 `visit_date="2026-09-08"` 斷言冷名單或轉換潛力**：冷名單看參觀日 90 天（`stats.py:335-338`），約 2026-12-07 之後會翻轉。改用相對於 `today_local()` 的日期（例如 20 天前），要測冷名單就用 100 天前。

**Task 6：**
- `RecordsTab.vue` **不要整段換 import**：第 5 行 icons 現在有 `ArrowDown, ArrowRight, Filter, Plus, Search`，第 6 行 api import 有 `listAdmissionsStaff`、`type FollowUpScope`，第 18 行已 import `notifyError, notifyWarning`。只補缺的（`Download`、`taipeiToday`、`recordsExportPath`、csv 工具）。
- 匯出的篩選要和 `load()`（約 111–127 行）完全一樣，**包含 `follow_up` 與 `owner`**。做法：抽出一個 `currentFilters()` 讓 `load()` 和匯出共用，不要各寫一份；測試要驗設了追蹤與負責人篩選時匯出網址帶這兩個參數。
- `apiErrorMessage` 在 `api/errors.ts:73`。

**Task 7：**
- `list_recent` 在 `audit_service.py:93`；`get_audit_log` 在 `operations/routes.py:475-518`。只加 `created_from`／`created_to`／`limit` 參數並傳給 `list_recent` 的 `since`／`until`。**保留** `show_ip = has_capability(current_user, "audit.read_all")` 與回傳的 `ip_address`（只給總部）、`user_agent`，不要整段換掉函式。
- `test_operations.py`：`_audit` 在 324、游標測試在 336、`test_audit_log_can_hide_routine_logins` 在 365。

**Task 8：**
- `AuditView.vue` 現在有 `sourceText(entry)`（55–57 行，裝置・IP，用 `describeUserAgent`）。抽出的 `auditSearchText` **要包含 sourceText**，`auditClientInfo.test.ts`「可以用 IP 或裝置搜尋」必須維持綠燈。
- CSV 欄位在原計畫最後加「裝置」（`describeUserAgent` 的結果）；**總部（`isSuperAdmin`）再加「IP」欄**，非總部不輸出 IP 欄（他們本來就拿不到 IP，不要出一整欄空白）。
- 行號參考：`AUDIT_LIMIT` 16、`visibleEntries` 86–92、`auditPath` 121–130、`load` 132、`watch` 175、`.filter-bar` 190–195。

**Task 9：** 不變。需要時在 worktree 的 `web/` 跑 `npm ci`。stack 測試庫用自己的名稱（例如 `ivy_website_exports1006_e2e_test`），不要沿用別人的。

**Task 10：** `DESIGN.md` 第七輪 CSV 規則現在在 1184 行；「招生入學（2026-10-01）」在 1940，「不做」那行在 1960，改寫時順手更新「來源分類等不上畫面」為 10-05 後的現況。README 頂部現在是 10-06 的段落，新段落加在最上面，分支名寫 `feature/admin-exports-20261006`。`UsersView.vue` 那句授權說明現在在 655／702；參觀案件 `window.open` 在 `VisitRequestsView.vue:418-420`。

**Task 11：** 後端全套 pytest 由 controller 用背景跑（帶上面的測試庫變數），實作者不跑。

**Task 12：** 只在另一個 session 的成效統計改版（worktree `analytics-ux-20261006`，正在大改 `AnalyticsView.vue`）已進 origin/main 後才做：先 `git fetch`，`git log 1cefe5cd..origin/main -- admin/src/views/AnalyticsView.vue` 有新提交才開工，並先把 origin/main 合進本分支。還沒進 main 就跳過，在報告裡註明。做的時候測試要照 `analyticsFunnel.test.ts` stub 各面板，假資料要有契約必填欄位（`as_of`、`campus_key`、`date_from`、`date_to`）；取消率畫面的「—」在 CSV 寫空白。

## 設計決定

1. **兩條路徑。** 含個資的名單（訪視明細、未預繳名單）在後端產生：權限、稽核、上限都在伺服器，前端繞不過去。去識別的統計表與操作紀錄在前端產生：資料已經在畫面上、使用者本來就看得到；操作紀錄的白話化（`labels.ts` 第 387–1400 行，動作、對象、metadata 格式器）只有前端有，不在 Python 再抄一份。
2. **招生名單沿用「匯出個資」授權 `booking.export`。** 使用者頁的文字本來就是「可以匯出負責校區的家長個資（CSV）」（`admin/src/views/UsersView.vue:594`），不另開新授權，也就不用改使用者頁或寫 migration。另需 `admissions.read` 與校區範圍。
3. **後台下載和園務轉移分開。** `app/admissions/export.py`（規格 12，JSONL、園務欄位名、台北 naive 時間，給匯入程式讀）不動也不重用。後台 CSV 給人看：中文欄名、只放畫面上有的欄位。來源分類、帶參觀老師、娃娃車、地址分析同意依 DESIGN「不上畫面」，也不進 CSV。
4. **日期。** 參觀日期、生日、註冊日期用西元 `YYYY/MM/DD`，建檔時間用台北時間 `YYYY/MM/DD HH:MM`，和參觀案件匯出一致，Excel 能排序、篩選。「月份」欄保留民國 `115.09`，這是園務的分組鍵，畫面也這樣寫。
5. **統計表的空值。** 比率沒有值時寫空白，不寫「—」（Excel 會把「—」當文字，算平均時出錯）。計數缺值寫 0（同畫面）。數字以數字輸出，負數不補單引號。
6. **操作紀錄匯出不另寫稽核。** 紀錄本身不含家長個資（`backend/app/operations/audit_service.py:18-21` 寫入時就擋掉），同一個人在畫面上也能用「載入更早的紀錄」逐頁看完全部。要改成寫稽核的話，需要使用者決定（見最後「待決定」）。
7. **招生規格 3.2「本次不做：統計 Excel 匯出、任何含個資的匯出」由 2026-10-03 的使用者選擇取代。** 招生開關 `WEBSITE_ADMISSIONS_ENABLED` 關閉時新端點一樣 404，正式站在 Q1 裁定前不會用到。仍列入「待決定」請使用者確認。
8. **一次匯出的上限。** 伺服器端 10,000 筆，超過回 422 `EXPORT_TOO_LARGE`，請使用者縮小篩選，不默默截斷（截斷的名單會被當成完整的）。操作紀錄由前端逐頁讀（每次 500 筆），超過 5,000 筆就停下提示、不產生檔案。參觀案件匯出維持原樣、不加上限（行為不變）。
9. **新的伺服器匯出用 `fetch` 取文字再存檔**（`downloadServerCsv`），403／422 才能用 `notifyError` 寫成中文提示，不會在新分頁露出 JSON。參觀案件匯出維持 `window.open`（`admin/src/views/VisitRequestsView.vue:334-336`），本計畫不改。
10. **成效統計匯出（Task 12）等「成效統計補強」計畫（`docs/superpowers/plans/2026-10-03-admin-analytics-phase1.md`）合併後再做**，因為那份會改 `AnalyticsView.vue` 與 analytics API。

## 已完成、不做

- 參觀案件 CSV：`backend/app/booking/routes.py:990-1066`。已有 BOM、中文欄名（`backend/app/booking/export_labels.py:14-18`）、台北時間、手機寫成 `0912-345-601`（`export_labels.py:69-76`）、依畫面篩選（`routes.py:845-950`）、稽核 `visit_request.export`（`routes.py:1047-1055`）、`no-store`（`routes.py:1058-1066`）。
- 公式注入防護：`backend/app/booking/routes.py:1002-1015`，測試在 `backend/tests/test_security_hardening.py:123-138`。本計畫只把它搬到共用模組，規則不改。
- 匯出個資逐人授權：`backend/app/auth/permissions.py:55-58,78`，`backend/tests/test_export_grant.py`。
- 招生 → 園務轉移匯出（CLI、JSONL）：`backend/app/admissions/export.py:1-10`、`contracts/ivy-recruitment/README.md`。不碰。
- 不做 Excel（.xlsx）。

## Global Constraints

- Node 22（`.nvmrc`）。Node 指令一律 `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; <指令>`（用分號，不用 `&&`：nvm.sh 會回 3）。
- FastAPI 0.136.1 釘版，不升級。不新增任何 npm／Python 套件。
- CSV 格式：UTF-8 開頭加 BOM、中文欄名、台北時間、`\r\n` 換行、每欄只出現一次；儲存格開頭是 `=` `+` `-` `@`，或開頭是空白、控制字元時，前面補一個單引號（後端 `safe_cell`、前端 `safeCell` 同一條規則）。
- 含孩子姓名、電話、地址的匯出：要 `admissions.read`＋校區範圍＋`booking.export`，每次寫稽核；metadata 只記套用了哪些篩選，搜尋字、介紹者、來源原文只記「有篩選」。
- 招生端點只在 `WEBSITE_ADMISSIONS_ENABLED=true` 時掛載（`backend/app/main.py:215-217`）。新端點放在同一個 `admissions_router`。
- 後端檔名只用 `[a-z0-9_-]`；前端中文檔名一律經 `csvFilename()` 清掉 `\ / : * ? " < > |` 與控制字元。
- 錯誤提示一律走 `admin/src/composables/notify.ts`（`notifyError`／`notifyWarning`），不直接呼叫 `ElMessage.error／warning`。
- 新稽核動作與 metadata 鍵都要在 `admin/src/api/labels.ts` 有中文，`admin/src/__tests__/labelCoverage.test.ts` 會讀後端原始碼比對。
- 不 push、不部署、不碰正式庫。機器 8GB：同時只跑一組測試。

## Review Focus

1. **名單的自由文字有換行、逗號、雙引號**（備註、電訪回應常見）：CSV 仍是一列一筆、一格一欄，Excel 開起來不錯位。測試在 Task 2（`buildCsv`）與 Task 4（備註含換行與逗號）。
2. **家長或同事輸入的文字以 `=` `+` `-` `@`、空白或控制字元開頭**：一律補單引號，不被試算表當成公式。測試在 Task 1、2、4（備註 `=HYPERLINK`、地址 `@SUM`）。
3. **篩選後 0 筆**：伺服器回只有表頭的檔案，不是錯誤；統計表沒有資料時不顯示匯出鈕。測試在 Task 3、4。
4. **權限邊界**：開關關閉回 404、沒授權回 403、別校回 404，和其他招生端點一致。測試在 Task 4、5。
5. **資料量超過上限**：伺服器回 422 中文訊息、不出半份檔；操作紀錄超過 5,000 筆不產生檔案並提示縮短期間。另外台北日期邊界（23:59／00:00）不能差一天。測試在 Task 4、7、8。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/common/csv_export.py` | 新增 | `safe_cell`、`filename_part`、`too_many_rows`、`csv_attachment`、`EXPORT_ROW_LIMIT` |
| `backend/app/booking/routes.py` | 修改 990–1066 | 參觀案件匯出改用共用模組，輸出不變；拿掉沒用到的 `csv`／`io`／`re` |
| `backend/app/admissions/download.py` | 新增 | 招生 CSV 欄名、每列轉換、稽核 metadata（和 `export.py` 分開） |
| `backend/app/admissions/routes.py` | 修改 | `GET /admin/admissions/records/export`（放在 `/records/{visit_id}` 之前）、`GET /admin/admissions/no-deposit-records/export` |
| `backend/app/operations/audit_service.py` | 修改 `list_recent` | 加 `since`／`until` |
| `backend/app/operations/routes.py` | 修改 302–343 | `/admin/audit-log` 加 `created_from`／`created_to`／`limit` |
| `backend/tests/test_csv_export.py` | 新增 | 共用模組單元測試 |
| `backend/tests/test_admissions_download.py` | 新增 | 兩個招生匯出端點 |
| `backend/tests/test_admissions_booking_link.py` | 修改 361–371 | 開關關閉清單加兩個路徑 |
| `backend/tests/test_operations.py` | 修改 | 操作紀錄日期與筆數 |
| `admin/src/utils/csv.ts` | 新增 | `safeCell`、`buildCsv`、`withBom`、`csvFilename`、`downloadCsv`、`downloadServerCsv` |
| `admin/src/utils/auditFormat.ts` | 新增 | 從 `AuditView.vue` 抽出操作者／對象／校區文字，加搜尋字串與 CSV 列 |
| `admin/src/api/admissions.ts` | 修改 | `recordsExportPath`、`noDepositExportPath` |
| `admin/src/api/labels.ts` | 修改 | 兩個稽核動作、11 個 metadata 鍵的中文 |
| `admin/src/components/admissions/StatsDimensionTable.vue` | 修改 | 選配 `exportFilename` → 「匯出 CSV」 |
| `admin/src/components/admissions/StatsTab.vue`、`StatsOverview.vue`、`CompareTable.vue` | 修改 | 傳檔名 |
| `admin/src/components/admissions/RecordsTab.vue`、`NoDepositList.vue` | 修改 | 「匯出 CSV」鈕 |
| `admin/src/views/AuditView.vue` | 修改 | 期間篩選、「匯出 CSV」 |
| `admin/src/__tests__/csvUtil.test.ts`、`statsDimensionCsv.test.ts`、`admissionsDownload.test.ts`、`auditExport.test.ts` | 新增 | 前端測試 |
| `admin/src/__tests__/statsTab.test.ts`、`labelCoverage.test.ts` | 修改 | 統計表都能匯出、新 metadata 解析 |
| `tests/stack/exports.spec.ts` | 新增 | 瀏覽器真的下載到檔案 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | Task 4、5、7 |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md` | 修改 | Task 10 |
| `admin/src/views/AnalyticsView.vue` | 修改（Task 12，等 analytics 計畫合併） | 兩張表的匯出鈕 |

---

### Task 0: 開工準備

**Files:** 無（只建環境）

- [ ] **Step 1: 開 sparse worktree**

```bash
cd ~/Desktop/ivy-website-admin
git fetch origin
git worktree add --no-checkout -b feature/admin-exports-20261003 ~/Desktop/ivy-website-exports-20261003 origin/main
cd ~/Desktop/ivy-website-exports-20261003
git sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git checkout
git log --oneline -1
```

Expected: HEAD 是 origin/main 最新的提交（撰寫時是 `15fd9a5`）。

- [ ] **Step 2: 確認沒有別的 session 正在改同一批檔案**

```bash
git -C ~/Desktop/ivy-website-admin worktree list
git log origin/main --oneline -10 -- backend/app/admissions backend/app/operations admin/src/views/AuditView.vue admin/src/components/admissions
```

Expected: 列出其他 worktree。若有 `analytics`、`ux` 類 worktree，先 `git -C <它> status --short` 看是否動到 `AuditView.vue`、`StatsTab.vue`、`labels.ts`；有的話這三個檔案的修改留到最後再 rebase。

- [ ] **Step 3: 安裝依賴、建測試庫**

```bash
cd ~/Desktop/ivy-website-exports-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix admin ci; npm --prefix web ci
cd backend && uv sync && cd ..
createdb ivy_website_exports_test
cd backend
WEBSITE_ENVIRONMENT=test \
WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_exports_test \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_exports_test \
WEBSITE_SESSION_SECRET=local-only-session-secret \
uv run --frozen alembic upgrade head
uv run --frozen alembic heads
cd ..
```

Expected: `alembic heads` 只有一行。本計畫不加 migration。

- [ ] **Step 4: 基準綠燈**

```bash
cd backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_exports_test uv run --frozen pytest -q tests/test_visit_attention_export.py tests/test_security_hardening.py tests/test_operations.py
cd ..
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/labelCoverage.test.ts src/__tests__/auditUx.test.ts src/__tests__/statsTab.test.ts
```

Expected: 全部 PASS。之後所有 pytest 指令都帶 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_exports_test`，下文簡寫為 `$TESTDB`（先 `export TESTDB=postgresql+asyncpg://localhost/ivy_website_exports_test`，指令寫成 `WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest …`）。

---

### Task 1: 後端共用 CSV 模組，參觀案件匯出改用（輸出不變）

**Files:**
- Create: `backend/app/common/csv_export.py`
- Modify: `backend/app/booking/routes.py:1-8`（imports）、`:985-1066`
- Test: `backend/tests/test_csv_export.py`

**Interfaces:**
- Produces:
  - `EXPORT_ROW_LIMIT: int = 10_000`
  - `safe_cell(value: object) -> str`
  - `filename_part(value: str | None, fallback: str = "all") -> str`
  - `too_many_rows() -> HTTPException`（422，`detail={"code": "EXPORT_TOO_LARGE", "message": ...}`）
  - `csv_attachment(header: Sequence[object], rows: Iterable[Sequence[object]], filename: str) -> Response`（每格都過 `safe_cell`、BOM、`text/csv; charset=utf-8`、`attachment`、`private, no-store`）
  - 呼叫端一律寫 `csv_export.EXPORT_ROW_LIMIT`（執行時讀模組屬性），測試才能 monkeypatch。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_csv_export.py`：

```python
"""後台 CSV 下載共用模組（2026-10-03 匯出擴充）：公式注入防護、BOM、附件回應。"""

from __future__ import annotations

import pytest

from app.common import csv_export


@pytest.mark.parametrize(
    "value, expected",
    [
        ("=1+1", "'=1+1"),
        ("+886912345678", "'+886912345678"),
        ("-3", "'-3"),
        ("@SUM(A1)", "'@SUM(A1)"),
        # 試算表會先略過開頭的空白與控制字元再判斷是不是公式。
        ('\t=HYPERLINK("http://x")', '\'\t=HYPERLINK("http://x")'),
        (" +1+1", "' +1+1"),
        ("\r@SUM(A1)", "'\r@SUM(A1)"),
        ("王小明", "王小明"),
        ("0912-345-601", "0912-345-601"),
        ("2026/10/03 14:30", "2026/10/03 14:30"),
        ("", ""),
        (None, ""),
        (3, "3"),
    ],
)
def test_safe_cell_neutralises_formula_starts(value, expected):
    assert csv_export.safe_cell(value) == expected


def test_csv_attachment_writes_bom_crlf_quotes_and_no_store():
    resp = csv_export.csv_attachment(
        ("姓名", "備註"),
        [("王小明", "第一行\n第二行，有逗號"), ("=1+1", None), ('李"小"華', "a,b")],
        "x-all-20261003.csv",
    )
    assert resp.body.decode("utf-8") == (
        "﻿姓名,備註\r\n"
        '王小明,"第一行\n第二行，有逗號"\r\n'
        "'=1+1,\r\n"
        '"李""小""華","a,b"\r\n'
    )
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="x-all-20261003.csv"'
    assert resp.headers["cache-control"] == "private, no-store"


def test_filename_part_only_keeps_safe_keys():
    assert csv_export.filename_part("yihua") == "yihua"
    assert csv_export.filename_part(None) == "all"
    assert csv_export.filename_part("") == "all"
    assert csv_export.filename_part('yihua"; x') == "all"
    assert csv_export.filename_part("YIHUA") == "all"


def test_too_many_rows_says_the_limit_in_chinese():
    exc = csv_export.too_many_rows()
    assert exc.status_code == 422
    assert exc.detail["code"] == "EXPORT_TOO_LARGE"
    assert "10,000" in exc.detail["message"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_csv_export.py`
Expected: FAIL，`ImportError: cannot import name 'csv_export' from 'app.common'`

- [ ] **Step 3: 實作共用模組**

`backend/app/common/csv_export.py`：

```python
"""後台 CSV 下載共用：公式注入防護、BOM、附件回應（2026-10-03 匯出擴充抽出）。

給園方用 Excel 直接開：開頭加 BOM，Excel 才認得是 UTF-8，不然中文整份亂碼。
中文欄名、代碼對照與台北時間由各模組先轉好；這裡讓每個儲存格都過 safe_cell，
呼叫端不用（也不會忘了）自己包。後台前端 admin/src/utils/csv.ts 的 safeCell
是同一條規則，改一邊另一邊一起改。"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterable, Sequence

from fastapi import HTTPException, Response, status

# 一次下載的上限：超過就請使用者縮小篩選範圍，不默默截斷（截斷的名單會被當成完整的）。
EXPORT_ROW_LIMIT = 10_000

_SAFE_FILENAME_PART = re.compile(r"[a-z0-9_-]{1,32}")


def safe_cell(value: object) -> str:
    """CSV 公式注入防護：儲存格開頭若是 = + - @ 這些會被試算表當成公式執行的
    字元，前面補一個單引號讓它變成純文字。試算表會略過開頭的空白與控制字元
    （TAB、CR、LF…）再判斷是不是公式，所以要看去掉這些字元後的第一個字，不能
    只看 text[0]；控制字元本身開頭也一併視為危險，一律補單引號。"""
    text = "" if value is None else str(value)
    if text and (
        text[0].isspace()
        or not text[0].isprintable()
        or text.lstrip()[:1] in ("=", "+", "-", "@")
    ):
        return "'" + text
    return text


def filename_part(value: str | None, fallback: str = "all") -> str:
    """檔名只放安全字元，篩選值不直接進 header。"""
    return value if value and _SAFE_FILENAME_PART.fullmatch(value) else fallback


def too_many_rows() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "EXPORT_TOO_LARGE",
            "message": f"符合條件的資料超過 {EXPORT_ROW_LIMIT:,} 筆，請縮小篩選範圍再匯出。",
        },
    )


def csv_attachment(header: Sequence[object], rows: Iterable[Sequence[object]], filename: str) -> Response:
    """一律當附件下載，且不進瀏覽器快取：共用櫃台電腦上，含家長姓名與手機的 CSV
    不能留在磁碟快取或上一頁紀錄裡（稽核 admin-booking-api-no-store-missing）。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([safe_cell(cell) for cell in header])
    for row in rows:
        writer.writerow([safe_cell(cell) for cell in row])
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_csv_export.py`
Expected: PASS（16 passed）

- [ ] **Step 5: 參觀案件匯出改用共用模組**

`backend/app/booking/routes.py`：

1. 檔頭刪掉 `import csv`、`import io`、`import re`（只有匯出用到，改完就沒人用；改完後 `grep -n -E '\bcsv\.|\bio\.|\bre\.' backend/app/booking/routes.py` 應該沒有輸出）。
2. 在 `from app.common import ratelimit` 那行改成 `from app.common import csv_export, ratelimit`。
3. 刪掉第 987 行 `_SAFE_FILENAME_PART = re.compile(...)`。
4. 把 `export_visit_requests` 整個函式換成：

```python
@router.get("/admin/visit-requests/export")
async def export_visit_requests(
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """依畫面上目前的篩選條件匯出（不分頁）。"""
    require_scope(current_user, "booking.export")
    stmt = filters.apply(select(VisitRequest).options(selectinload(VisitRequest.slot)), current_user, "booking.export")
    stmt = stmt.order_by(VisitRequest.created_at.desc())
    result = await db.execute(stmt)

    # 給園方用 Excel 直接開：中文欄名與代碼對照、台北時間（BOM 與公式注入防護在
    # csv_export）。每個欄位只出現一次（同名欄位在樞紐分析或匯入其他系統時會混淆）。
    rows = [
        [
            export_labels.campus_label(r.campus_key),
            export_labels.status_label(r.status),
            export_labels.source_label(r.source),
            r.parent_name,
            export_labels.format_phone(r.phone),
            r.created_at.astimezone(OPERATING_TZ).strftime("%Y/%m/%d %H:%M"),
            r.child_name,
            r.child_birthdate.strftime("%Y/%m/%d") if r.child_birthdate else "",
            r.email,
            export_labels.referral_label(r.referral_sources),
            # 舊案件沒有人數，留空。
            str(r.party_size) if r.party_size is not None else "",
            r.slot.slot_date.strftime("%Y/%m/%d") if r.slot else "",
            r.slot.start_time.strftime("%H:%M") if r.slot else "",
            r.slot.end_time.strftime("%H:%M") if r.slot else "",
        ]
        for r in result.scalars()
    ]

    # 個資批次外流一定要留痕：誰、什麼時候、用什麼條件匯出了哪個校區的幾筆。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.export",
        target_type="visit_request",
        target_id=filters.campus_key or "all",
        campus_key=filters.campus_key,
        metadata={"row_count": len(rows), **filters.audit_metadata()},
    )
    await db.commit()
    filename = f"visit-requests-{csv_export.filename_part(filters.campus_key)}-{today_local():%Y%m%d}.csv"
    return csv_export.csv_attachment(export_labels.EXPORT_HEADERS, rows, filename)
```

- [ ] **Step 6: 跑既有匯出測試，確認輸出沒變**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_csv_export.py tests/test_visit_attention_export.py tests/test_security_hardening.py tests/test_export_grant.py`
Expected: PASS（`test_export_header_has_each_column_once`、`test_export_applies_screen_filters_and_audits_them`、`test_csv_export_neutralises_formula_after_leading_control_chars` 都過）

- [ ] **Step 7: Commit**

```bash
git add backend/app/common/csv_export.py backend/app/booking/routes.py backend/tests/test_csv_export.py
git commit -m "$(cat <<'EOF'
refactor(backend): 參觀案件匯出改用共用 CSV 模組

公式注入防護、BOM、附件與 no-store 搬到 app/common/csv_export.py，
輸出不變；之後招生名單匯出共用同一套。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 後台前端共用 CSV 工具

**Files:**
- Create: `admin/src/utils/csv.ts`
- Test: `admin/src/__tests__/csvUtil.test.ts`

**Interfaces:**
- Consumes: `api.get` from `admin/src/api/client.ts`
- Produces:
  - `export const CSV_BOM = '﻿'`
  - `export type CsvCell = string | number | boolean | null | undefined`
  - `export function safeCell(value: CsvCell): string`
  - `export function buildCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string`（含 BOM、`\r\n`、結尾換行）
  - `export function withBom(text: string): string`
  - `export function csvFilename(...parts: (string | null | undefined)[]): string`（以 `-` 串接、補 `.csv`）
  - `export function downloadCsv(filename: string, csv: string): void`
  - `export function downloadServerCsv(path: string, filename: string): Promise<void>`（錯誤原樣丟出 `ApiError`）

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/csvUtil.test.ts`：

```ts
// 後台前端組的 CSV（2026-10-03 匯出擴充）：規則和後端 app/common/csv_export.py 相同。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { CSV_BOM, buildCsv, csvFilename, downloadCsv, downloadServerCsv, safeCell, withBom } from '../utils/csv'

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('safeCell：和後端 safe_cell 同一條規則', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+886912345678', "'+886912345678"],
    ['-3', "'-3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=HYPERLINK("x")', '\'\t=HYPERLINK("x")'],
    [' +1+1', "' +1+1"],
    ['\r@SUM(A1)', "'\r@SUM(A1)"],
    ['王小明', '王小明'],
    ['0912-345-601', '0912-345-601'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(safeCell(input)).toBe(expected)
  })

  it('數字照寫（負數不補單引號）、布林寫是／否、空值寫空白', () => {
    expect(safeCell(-3)).toBe('-3')
    expect(safeCell(12)).toBe('12')
    expect(safeCell(Number.NaN)).toBe('')
    expect(safeCell(true)).toBe('是')
    expect(safeCell(false)).toBe('否')
    expect(safeCell(null)).toBe('')
    expect(safeCell(undefined)).toBe('')
  })
})

describe('buildCsv', () => {
  it('開頭 BOM、CRLF 換行；含逗號、雙引號、換行的格子加引號', () => {
    const csv = buildCsv(['姓名', '備註'], [['王小明', '第一行\n第二行，有逗號'], ['李"小"華', 'a,b'], ['=1+1', null]])
    expect(csv).toBe(`${CSV_BOM}姓名,備註\r\n王小明,"第一行\n第二行，有逗號"\r\n"李""小""華","a,b"\r\n'=1+1,\r\n`)
  })

  it('只有表頭也是合法的檔案', () => {
    expect(buildCsv(['校區'], [])).toBe(`${CSV_BOM}校區\r\n`)
  })
})

it('withBom 不重複加', () => {
  expect(withBom('a')).toBe(`${CSV_BOM}a`)
  expect(withBom(`${CSV_BOM}a`)).toBe(`${CSV_BOM}a`)
})

it('csvFilename 以「-」串接、略過空值、清掉檔名不能用的字元', () => {
  expect(csvFilename('招生統計', '月度明細表', '義華', '115 上學期', '2026-10-03')).toBe('招生統計-月度明細表-義華-115 上學期-2026-10-03.csv')
  expect(csvFilename('成效統計', null, '', '2026/09/04–2026/10/03')).toBe('成效統計-2026_09_04–2026_10_03.csv')
  expect(csvFilename('a:b*c?"d<e>f|g\\h')).toBe('a_b_c_d_e_f_g_h.csv')
  expect(csvFilename()).toBe('export.csv')
})

function stubDownload() {
  const blobs: Blob[] = []
  const clicks: { href: string; download: string }[] = []
  URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test' }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
  return { blobs, clicks }
}

it('downloadCsv 用 Blob 連結下載，檔名照給，之後釋放網址', () => {
  vi.useFakeTimers()
  const { blobs, clicks } = stubDownload()
  downloadCsv('招生統計.csv', buildCsv(['a'], [[1]]))
  expect(blobs[0]!.type).toBe('text/csv;charset=utf-8')
  expect(clicks).toEqual([{ href: 'blob:test', download: '招生統計.csv' }])
  expect(document.querySelector('a[download]')).toBeNull()
  vi.runAllTimers()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
})

it('downloadServerCsv 以 API 讀文字後存檔；API 錯誤原樣丟出，不產生檔案', async () => {
  const { clicks } = stubDownload()
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce('校區,月份\r\n' as never)
  await downloadServerCsv('/admin/admissions/records/export?campus_key=yihua', '招生訪視明細.csv')
  expect(get).toHaveBeenCalledWith('/admin/admissions/records/export?campus_key=yihua')
  expect(clicks.map((c) => c.download)).toEqual(['招生訪視明細.csv'])

  get.mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: '沒有權限' }))
  await expect(downloadServerCsv('/x', 'x.csv')).rejects.toBeInstanceOf(ApiError)
  expect(clicks).toHaveLength(1)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/csvUtil.test.ts`
Expected: FAIL，`Failed to resolve import "../utils/csv"`

- [ ] **Step 3: 實作**

`admin/src/utils/csv.ts`：

```ts
// 後台前端組 CSV 的共用工具（2026-10-03 匯出擴充）。給園方用 Excel 直接開：開頭 BOM、
// 中文欄名、CRLF。公式注入防護和後端 backend/app/common/csv_export.py 的 safe_cell 是
// 同一條規則，改一邊另一邊一起改。含個資的名單一律由後端產生（downloadServerCsv），
// 這裡自己組的只有畫面上已經有的去識別資料與操作紀錄。
import { api } from '../api/client'

export const CSV_BOM = '﻿'

export type CsvCell = string | number | boolean | null | undefined

const FORMULA_STARTS = new Set(['=', '+', '-', '@'])
// 試算表會先略過開頭的空白與控制字元再判斷是不是公式（同後端 isspace／isprintable）。
const LEADING_SPACE_OR_CONTROL = /^[\s\p{C}]/u

export function safeCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  // 數字是我們自己算的計數與比率，負數也不是公式，照寫。
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  const text = String(value)
  if (!text) return ''
  if (LEADING_SPACE_OR_CONTROL.test(text) || FORMULA_STARTS.has(text.trimStart().charAt(0))) return `'${text}`
  return text
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((row) => row.map((cell) => quote(safeCell(cell))).join(','))
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`
}

/** fetch 的 response.text() 會吃掉開頭的 BOM（後端有加），存檔前補回來，Excel 才認得 UTF-8。 */
export function withBom(text: string): string {
  return text.startsWith(CSV_BOM) ? text : `${CSV_BOM}${text}`
}

const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\p{Cc}]+/gu

export function csvFilename(...parts: (string | null | undefined)[]): string {
  const name = parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .map((part) => part.replace(UNSAFE_FILENAME_CHARS, '_'))
    .join('-')
  return `${name || 'export'}.csv`
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([withBom(csv)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 等瀏覽器接手下載再釋放；同步 revoke 在 Safari 會下載失敗。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 後端產生的 CSV（含個資的名單）：用 API 讀成文字再存檔，403／422 才能寫成中文提示，
 *  不會像 window.open 那樣在新分頁露出 JSON。錯誤原樣丟給呼叫端。 */
export async function downloadServerCsv(path: string, filename: string): Promise<void> {
  const text = await api.get<string>(path)
  downloadCsv(filename, typeof text === 'string' ? text : '')
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/csvUtil.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/utils/csv.ts admin/src/__tests__/csvUtil.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 後台前端共用 CSV 工具（BOM、公式注入防護、下載）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 招生統計表匯出 CSV（去識別，前端組）

**Files:**
- Modify: `admin/src/components/admissions/StatsDimensionTable.vue`
- Modify: `admin/src/components/admissions/StatsTab.vue:288-396`
- Modify: `admin/src/components/admissions/StatsOverview.vue:15,204-212`
- Modify: `admin/src/components/admissions/CompareTable.vue:9,58-66`
- Test: `admin/src/__tests__/statsDimensionCsv.test.ts`（新）、`admin/src/__tests__/statsTab.test.ts`（加一個 describe）

**Interfaces:**
- Consumes: `buildCsv`、`downloadCsv`、`csvFilename`、`CsvCell`（Task 2）
- Produces: `StatsDimensionTable` 新 prop `exportFilename?: string`（有值且有資料才顯示「匯出 CSV」，`data-test="stats-csv"`）；`StatsOverview` 新 prop `csvName?: (title: string) => string`；`CompareTable` 新 prop `exportFilename?: string`

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/statsDimensionCsv.test.ts`：

```ts
// 招生統計表匯出（2026-10-03）：欄名同畫面；比率沒有值寫空白（不寫「—」）、計數缺值寫 0。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import StatsDimensionTable from '../components/admissions/StatsDimensionTable.vue'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => vi.mocked(downloadCsv).mockClear())

const base = {
  title: '來源排名明細',
  rows: [{ source: '=親友', visit: 3, rate: null }, { source: '網路', rate: 40 }],
  columns: [
    { key: 'source', label: '來源', sticky: true },
    { key: 'visit', label: '參觀', kind: 'bar' as const },
    { key: 'rate', label: '預繳率', kind: 'rate' as const },
  ],
  rowKey: 'source',
  emptyText: '此區間尚無來源資料',
}

describe('StatsDimensionTable 匯出 CSV', () => {
  it('給了檔名才有按鈕；匯出的欄名、編號與數字同畫面', async () => {
    const wrapper = mount(StatsDimensionTable, { props: { ...base, numbered: true, exportFilename: '招生統計-來源排名明細.csv' }, global: { plugins: [ElementPlus] } })
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-來源排名明細.csv')
    expect(csv.split('\r\n')).toEqual(['﻿#,來源,參觀,預繳率', "1,'=親友,3,", '2,網路,0,40.0%', ''])
    wrapper.unmount()
  })

  it('沒給檔名、或沒有資料時不顯示按鈕', () => {
    const noName = mount(StatsDimensionTable, { props: base, global: { plugins: [ElementPlus] } })
    expect(noName.find('[data-test="stats-csv"]').exists()).toBe(false)
    const empty = mount(StatsDimensionTable, { props: { ...base, rows: [], exportFilename: 'x.csv' }, global: { plugins: [ElementPlus] } })
    expect(empty.find('[data-test="stats-csv"]').exists()).toBe(false)
    noName.unmount()
    empty.unmount()
  })
})
```

在 `admin/src/__tests__/statsTab.test.ts`：第 1 行 import 加上 `vi`（`import { afterEach, describe, expect, it, vi } from 'vitest'`），import 區塊後面加：

```ts
vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'
```

檔尾加：

```ts
describe('統計表匯出 CSV（2026-10-03）', () => {
  const tables = (root: VueWrapper | Dom) => root.findAll('.stats-block').filter((section) => section.find('table').exists())

  it('總覽與班別、來源、接待分析的每張表都能匯出，檔名含校區、學期與日期', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const overview = wrapper.get('#pane-stats-overview')
    expect(tables(overview).length).toBeGreaterThan(0)
    expect(tables(overview).every((section) => section.find('[data-test="stats-csv"]').exists())).toBe(true)
    for (const label of ['班別分析', '來源分析', '接待分析']) {
      const pane = await openSubTab(wrapper, label)
      expect(tables(pane).every((section) => section.find('[data-test="stats-csv"]').exists()), label).toBe(true)
    }
    await block(wrapper.get('#pane-stats-overview'), '月度明細表').get('[data-test="stats-csv"]').trigger('click')
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![0]).toMatch(/^招生統計-月度明細表-義華-115 上學期-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/statsDimensionCsv.test.ts src/__tests__/statsTab.test.ts`
Expected: FAIL，找不到 `[data-test="stats-csv"]`

- [ ] **Step 3: `StatsDimensionTable.vue` 加匯出**

`<script setup>`：import 區加

```ts
import { buildCsv, downloadCsv, type CsvCell } from '../../utils/csv'
```

`defineProps` 型別加 `exportFilename?: string`，`withDefaults` 加 `exportFilename: ''`。在 `isNumeric` 之後加：

```ts
// 匯出（2026-10-03）：欄名、編號同畫面；計數缺值寫 0，比率沒有值寫空白（Excel 會把「—」
// 當文字），長條欄只輸出數字。
function csvValue(row: Record<string, unknown>, column: StatsColumn): CsvCell {
  const value = row[column.key]
  if (column.kind === 'rate') return typeof value === 'number' ? formatRate(value) : ''
  if (column.kind === 'count' || column.kind === 'bar') return toNumber(value)
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

function exportCsv() {
  if (!props.exportFilename) return
  const header = [...(props.numbered ? ['#'] : []), ...props.columns.map((column) => column.label)]
  const rows = props.rows.map((row, index) => [...(props.numbered ? [index + 1] : []), ...props.columns.map((column) => csvValue(row, column))])
  downloadCsv(props.exportFilename, buildCsv(header, rows))
}
```

`<template>`：把 `<h3 :id="headingId" class="stats-block__title">{{ title }}</h3>` 換成

```vue
    <div class="stats-block__head">
      <h3 :id="headingId" class="stats-block__title">{{ title }}</h3>
      <el-button v-if="exportFilename && rows.length" size="small" text data-test="stats-csv" :aria-label="`把「${title}」匯出 CSV`" @click="exportCsv">匯出 CSV</el-button>
    </div>
```

`<style scoped>` 加

```css
.stats-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
```

- [ ] **Step 4: 各表傳檔名**

`StatsTab.vue`：import 區加

```ts
import { csvFilename } from '../../utils/csv'
import { taipeiToday } from '../../composables/newsContent'
```

`props` 之後加：

```ts
// 統計表的匯出檔名：招生統計-表名-校區-學期-日期（沒選學年寫「全部學年」）。
const csvName = (title: string) =>
  csvFilename('招生統計', title, campusLabel(props.campusKey), props.schoolYear ? termLabel(props.schoolYear, props.semester) : '全部學年', taipeiToday())
```

模板裡每個 `<StatsDimensionTable>` 加 `:export-filename="csvName('<同一個 title>')"`，共七處：`班別統計`、`月份 × 班別分布`、`來源排名明細`、`接待人員統計`、`接待人員 × 各年級預繳率`、`介紹者 × 來源 交叉分析`、`未預繳原因分佈`。第 289 行改成 `<StatsOverview v-if="hasData" :stats="stats" :csv-name="csvName" @navigate="navigate" />`。第 394 行改成：

```vue
            <CompareTable
              v-else
              :rows="compareResult.rows"
              :school-year="compareResult.school_year"
              :semester="compareResult.semester"
              :export-filename="csvFilename('招生統計', '五校比較', termLabel(compareResult.school_year, compareResult.semester), taipeiToday())"
            />
```

`StatsOverview.vue`：第 15 行改成 `const props = defineProps<{ stats: AdmissionsStats; csvName?: (title: string) => string }>()`。第 204 行的「月度明細表」加 `:export-filename="csvName?.('月度明細表')"`，「年度統計」加 `:export-filename="csvName?.('年度統計')"`。

`CompareTable.vue`：第 9 行改成 `const props = defineProps<{ rows: readonly AdmissionsCompareRow[]; schoolYear: number; semester: number | null; exportFilename?: string }>()`，`<StatsDimensionTable>` 加 `:export-filename="exportFilename"`。

- [ ] **Step 5: 跑測試確認通過**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/statsDimensionCsv.test.ts src/__tests__/statsTab.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯誤

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/admissions/StatsDimensionTable.vue admin/src/components/admissions/StatsTab.vue admin/src/components/admissions/StatsOverview.vue admin/src/components/admissions/CompareTable.vue admin/src/__tests__/statsDimensionCsv.test.ts admin/src/__tests__/statsTab.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 招生統計每張表可以匯出 CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 招生訪視明細匯出 API

**Files:**
- Create: `backend/app/admissions/download.py`
- Modify: `backend/app/admissions/routes.py:20,40-46`（imports）；在 `list_recruitment_visits`（`:118-134`）之後、`create_recruitment_visit`（`:137`）之前插入新端點
- Modify: `backend/tests/test_admissions_booking_link.py:361-371`
- Modify: `admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS` 第 473 行之後；`AUDIT_METADATA_FORMATTERS` 第 1328 行 `grades:` 之後）
- Modify: `admin/src/__tests__/labelCoverage.test.ts:328-344`（`METADATA_HELPERS`）
- Test: `backend/tests/test_admissions_download.py`（新）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes: `csv_export.*`（Task 1）；`records.RecruitmentVisitFilters`（`backend/app/admissions/records.py:220`）；`funnel.derive_stage`（`funnel.py:62`）；`booking.export_labels.campus_label`／`format_phone`
- Produces:
  - `download.RECORD_HEADERS: tuple[str, ...]`、`download.record_row(visit) -> list[str]`、`download.records_audit_metadata(filters) -> dict`
  - `download.NO_DEPOSIT_HEADERS`、`download.no_deposit_row(campus_key, record) -> list[str]`、`download.no_deposit_audit_metadata(**filters) -> dict`（Task 5 使用；這個 Task 一起建好）
  - `GET /api/website/v1/admin/admissions/records/export`：query 同 `/records`（不含 page），回 CSV
  - 稽核：`action="recruitment_visit.export"`、`target_type="recruitment_visit"`、`target_id=<campus_key>`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_admissions_download.py`：

```python
"""招生訪視明細與未預繳名單的 CSV 匯出（2026-10-03 匯出擴充）。

含孩子姓名、電話、地址：要 admissions.read＋校區範圍＋「匯出個資」授權（booking.export），
每次寫稽核，metadata 只記套用了哪些篩選。開關關閉時 404（test_admissions_booking_link.py）。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import download
from app.admissions.constants import ANONYMIZED_TEXT
from app.admissions.models import RecruitmentVisit
from app.common import csv_export
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    campus_admin_yihua_client,
    create_record,
    reception_yihua_client,
    record_at_stage,
)

RECORDS_EXPORT = f"{ADMISSIONS}/records/export"


def _csv(resp) -> tuple[list[str], list[dict]]:
    assert resp.status_code == 200, resp.text
    assert resp.content.startswith("﻿".encode())
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["cache-control"] == "private, no-store"
    text = resp.content.decode("utf-8-sig")
    return next(csv.reader(io.StringIO(text))), list(csv.DictReader(io.StringIO(text)))


@pytest.mark.asyncio
async def test_records_export_has_chinese_columns_and_follows_list_filters(admin_client):
    await create_record(
        admin_client, child_name="王小明", phone="0912345601", contact_name="王媽媽",
        notes="第一行\n第二行，有逗號", address="高雄市三民區",
    )
    await create_record(admin_client, child_name="李小華", grade="中班")
    await record_at_stage(admin_client, "deposited", child_name="陳小美")

    resp = await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")
    header, rows = _csv(resp)
    assert header == list(download.RECORD_HEADERS)
    assert len(set(header)) == len(header)
    assert 'filename="admissions-records-yihua-' in resp.headers["content-disposition"]
    by_name = {row["幼生姓名"]: row for row in rows}
    assert set(by_name) == {"王小明", "李小華", "陳小美"}
    ming = by_name["王小明"]
    assert ming["校區"] == "義華"
    assert ming["月份"] == "115.09"
    assert ming["參觀日期"] == "2026/09/08"
    assert ming["生日"] == "2023/03/02"
    assert ming["入學學年"] == "115"
    assert ming["入學學期"] == "上學期"
    assert ming["階段"] == "已訪視"
    assert ming["電話"] == "0912-345-601"
    assert ming["聯絡人"] == "王媽媽"
    assert ming["備註"] == "第一行\n第二行，有逗號"
    assert ming["預繳"] == "否"
    assert by_name["陳小美"]["階段"] == "已預繳"
    assert by_name["陳小美"]["預繳"] == "是"

    # 和明細列表同一組篩選：畫面上篩好什麼，匯出的就是那一批。
    _, middle = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&grade=中班"))
    assert [row["幼生姓名"] for row in middle] == ["李小華"]
    _, deposited = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&stage=deposited"))
    assert [row["幼生姓名"] for row in deposited] == ["陳小美"]
    # 0 筆是只有表頭的檔案，不是錯誤。
    header_only, none = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&grade=大班"))
    assert header_only == list(download.RECORD_HEADERS)
    assert none == []


@pytest.mark.asyncio
async def test_records_export_neutralises_formulas_and_keeps_anonymized_text(admin_client, db_session):
    await create_record(admin_client, child_name="公式寶貝", notes='=HYPERLINK("http://x")', address=" @SUM(A1)")
    anonymized = await create_record(admin_client, child_name="要匿名的寶貝", phone="0912000999")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(anonymized["id"]))
        .values(child_name=ANONYMIZED_TEXT, phone=None, anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()

    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    by_name = {row["幼生姓名"]: row for row in rows}
    assert by_name["公式寶貝"]["備註"] == '\'=HYPERLINK("http://x")'
    assert by_name["公式寶貝"]["地址"].startswith("'")
    assert by_name[ANONYMIZED_TEXT]["電話"] == ""


@pytest.mark.asyncio
async def test_records_export_needs_export_grant_and_campus_scope(
    admin_client, campus_admin_yihua_client, reception_yihua_client  # noqa: F811
):
    await create_record(admin_client, child_name="授權測試寶貝")
    # 看得到明細不等於可以批次匯出：分校管理者、櫃台都要總管理者另外授權。
    assert (await campus_admin_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")).status_code == 403
    assert (await reception_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")).status_code == 403

    me = (await reception_yihua_client.get(f"{API}/auth/me")).json()["user"]
    granted = await admin_client.patch(f"{API}/admin/users/{me['id']}/capabilities", json={"capabilities": ["booking.export"]})
    assert granted.status_code == 200, granted.text
    _, rows = _csv(await reception_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    assert [row["幼生姓名"] for row in rows] == ["授權測試寶貝"]
    # 授權不擴大校區範圍。
    assert (await reception_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=minghua")).status_code == 404


@pytest.mark.asyncio
async def test_records_export_audits_filters_without_search_text(admin_client, db_session):
    await create_record(admin_client, child_name="稽核寶貝", grade="中班", referrer="林老師", source="親友介紹")
    _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&grade=中班&q=稽核寶貝&referrer=林老師&source=親友介紹&has_deposit=false"))
    entry = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "recruitment_visit.export"))
    ).scalar_one()
    assert entry.target_type == "recruitment_visit"
    assert entry.target_id == "yihua"
    assert entry.campus_key == "yihua"
    assert entry.metadata_json == {
        "row_count": 1,
        "grade": "中班",
        "has_source": True,
        "has_referrer": True,
        "has_deposit": False,
        "has_search": True,
    }
    # 搜尋字、介紹者、來源原文可能是人名，只記「有篩選」。
    assert "稽核寶貝" not in str(entry.metadata_json)
    assert "林老師" not in str(entry.metadata_json)


@pytest.mark.asyncio
async def test_records_export_refuses_more_than_the_limit(admin_client, monkeypatch):
    await create_record(admin_client, child_name="上限一")
    await create_record(admin_client, child_name="上限二")
    monkeypatch.setattr(csv_export, "EXPORT_ROW_LIMIT", 1)
    resp = await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXPORT_TOO_LARGE"
```

`backend/tests/test_admissions_booking_link.py` 第 368 行 `("GET", f"{ADMISSIONS}/no-deposit-records?campus_key=yihua"),` 之後加兩行：

```python
            ("GET", f"{ADMISSIONS}/records/export?campus_key=yihua"),
            ("GET", f"{ADMISSIONS}/no-deposit-records/export?campus_key=yihua"),
```

> 若 `create_record` 對 `notes` 的換行有驗證擋下（422），改用 `notes="第一行，第二行"`，並把換行的情境留給 Task 1、2 的單元測試；不要放寬 API 驗證。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_admissions_download.py`
Expected: FAIL，`ImportError: cannot import name 'download' from 'app.admissions'`

- [ ] **Step 3: 欄名與每列轉換**

`backend/app/admissions/download.py`：

```python
"""招生入學的後台 CSV 下載（2026-10-03 匯出擴充）：訪視明細與未預繳名單。

給園方用 Excel 看：中文欄名、西元日期、台北時間；只放畫面上有的欄位（來源分類、帶參觀
老師、娃娃車、地址分析同意依 DESIGN「不上畫面」，也不進 CSV）。和 export.py（轉給園務
匯入程式的 JSONL、園務欄位名）是兩回事，不要混用。BOM 與公式注入防護在
app/common/csv_export.py。

稽核 metadata 只記套用了哪些篩選；搜尋字、介紹者、來源原文可能是人名，只記「有篩選」。
鍵要在 admin/src/api/labels.ts 有中文（labelCoverage.test.ts 會解析下面的 applied）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from app.admissions import constants, funnel
from app.booking.export_labels import campus_label, format_phone
from app.common.timezones import OPERATING_TZ

if TYPE_CHECKING:
    from app.admissions.models import RecruitmentVisit
    from app.admissions.records import RecruitmentVisitFilters

RECORD_HEADERS: tuple[str, ...] = (
    "校區", "月份", "序號", "參觀日期", "幼生姓名", "生日", "班別", "入學學年", "入學學期", "階段",
    "聯絡人", "電話", "地址", "來源", "介紹者", "預繳", "收預繳人", "未預繳原因", "未預繳說明",
    "已註冊", "註冊日期", "轉學期", "退出原因", "備註", "電訪回應", "建檔時間",
)

NO_DEPOSIT_HEADERS: tuple[str, ...] = (
    "校區", "月份", "序號", "姓名", "班別", "原因分類", "轉換潛力", "冷名單",
    "說明", "來源", "介紹者", "電訪回應", "建檔時間",
)

SEMESTER_LABELS = {1: "上學期", 2: "下學期"}
PRIORITY_LABELS = {"high": "高", "medium": "中", "low": "低"}


def _day(value: date | None) -> str:
    return value.strftime("%Y/%m/%d") if value else ""


def _when(value: datetime | None) -> str:
    return value.astimezone(OPERATING_TZ).strftime("%Y/%m/%d %H:%M") if value else ""


def _yes_no(value: bool) -> str:
    return "是" if value else "否"


def record_row(visit: RecruitmentVisit) -> list[str]:
    return [
        campus_label(visit.campus_key),
        visit.month,
        visit.seq_no or "",
        _day(visit.visit_date),
        visit.child_name,
        _day(visit.birthday),
        visit.grade or "",
        str(visit.target_school_year) if visit.target_school_year is not None else "",
        SEMESTER_LABELS.get(visit.target_semester, ""),
        constants.STAGE_LABELS[funnel.derive_stage(visit)],
        visit.contact_name or "",
        format_phone(visit.phone) if visit.phone else "",
        visit.address or "",
        visit.source or "",
        visit.referrer or "",
        _yes_no(visit.has_deposit),
        visit.deposit_collector or "",
        visit.no_deposit_reason or "",
        visit.no_deposit_reason_detail or "",
        _yes_no(visit.enrolled),
        _day(visit.enrolled_on),
        _yes_no(visit.transfer_term),
        visit.withdraw_reason or "",
        visit.notes or "",
        visit.parent_response or "",
        _when(visit.created_at),
    ]


def no_deposit_row(campus_key: str, record: dict[str, Any]) -> list[str]:
    """record 是 stats.no_deposit_records 回傳的一筆（NoDepositRecordOut 的欄位）。"""
    return [
        campus_label(campus_key),
        record["month"],
        record["seq_no"] or "",
        record["child_name"],
        record["grade"] or "",
        record["no_deposit_reason"] or "",
        PRIORITY_LABELS.get(record["priority"] or "", ""),
        _yes_no(record["cold"]),
        record["no_deposit_reason_detail"] or "",
        record["source"] or "",
        record["referrer"] or "",
        record["parent_response"] or "",
        _when(record["created_at"]),
    ]


def records_audit_metadata(filters: RecruitmentVisitFilters) -> dict:
    applied = {
        "month": filters.month,
        "grade": filters.grade,
        "school_year": filters.target_school_year,
        "semester": filters.target_semester,
        "has_source": True if filters.source else None,
        "has_referrer": True if filters.referrer else None,
        "has_deposit": filters.has_deposit,
        "no_deposit_reason": filters.no_deposit_reason,
        "funnel_stage": filters.stage,
        "has_visit_request": True if filters.visit_request_id else None,
        "has_search": True if filters.q else None,
    }
    return {key: value for key, value in applied.items() if value is not None}


def no_deposit_audit_metadata(
    *,
    school_year: int | None,
    semester: int | None,
    reason: str | None,
    grade: str | None,
    priority: str | None,
    overdue_days: int | None,
    cold_only: bool | None,
) -> dict:
    applied = {
        "school_year": school_year,
        "semester": semester,
        "no_deposit_reason": reason,
        "grade": grade,
        "priority": priority,
        "overdue_days": overdue_days,
        "cold_only": True if cold_only else None,
    }
    return {key: value for key, value in applied.items() if value is not None}
```

- [ ] **Step 4: 端點**

`backend/app/admissions/routes.py`：

1. 第 20 行改成 `from app.admissions import academic, booking_link, constants, download, funnel, intake, records`。
2. `from app.auth.models import User` 改成 `from app.auth.models import BOOKING_EXPORT, User`。
3. 在 `from app.campuses.models import CAMPUS_KEYS` 之後加 `from app.common import csv_export`。
4. 在 `list_recruitment_visits`（第 118–134 行）之後、`create_recruitment_visit` 之前插入：

```python
@router.get("/admin/admissions/records/export")
async def export_recruitment_visits(
    filters: records.RecruitmentVisitFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """訪視明細 CSV（2026-10-03）：條件與排序同明細列表，不分頁。含孩子姓名、電話與地址，
    除了 admissions.read 還要「匯出個資」授權（booking.export，與參觀案件匯出同一項）。
    必須排在 /records/{visit_id} 之前，否則 "export" 會被當成 visit_id、回 422。"""
    _require_campus(current_user, "admissions.read", filters.campus_key)
    require_scope(current_user, BOOKING_EXPORT, campus_keys=[filters.campus_key])
    stmt = filters.apply(select(RecruitmentVisit)).order_by(
        RecruitmentVisit.visit_date.desc(), RecruitmentVisit.created_at.desc(), RecruitmentVisit.id.desc()
    )
    visits = list((await db.execute(stmt.limit(csv_export.EXPORT_ROW_LIMIT + 1))).scalars())
    if len(visits) > csv_export.EXPORT_ROW_LIMIT:
        raise csv_export.too_many_rows()
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.export",
        target_type="recruitment_visit",
        target_id=filters.campus_key,
        campus_key=filters.campus_key,
        metadata={"row_count": len(visits), **download.records_audit_metadata(filters)},
    )
    await db.commit()
    filename = f"admissions-records-{csv_export.filename_part(filters.campus_key)}-{today_local():%Y%m%d}.csv"
    return csv_export.csv_attachment(download.RECORD_HEADERS, [download.record_row(visit) for visit in visits], filename)
```

- [ ] **Step 5: 跑後端測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_admissions_download.py tests/test_admissions_booking_link.py tests/test_audit_coverage.py`
Expected: `test_admissions_download.py` 的 records 測試 PASS；`test_admissions_booking_link.py::test_admissions_disabled_skips_visit_and_hides_endpoints` PASS（no-deposit export 的路徑在開關關閉時本來就 404，Task 5 加端點後仍 404）

- [ ] **Step 6: 後台中文標籤（labelCoverage 會讀後端原始碼）**

`admin/src/api/labels.ts`，`AUDIT_ACTION_LABELS` 的 `'recruitment_visit.create_from_booking': …,` 之後加：

```ts
  'recruitment_visit.export': '匯出招生訪視明細',
  'recruitment_visit.export_no_deposit': '匯出未預繳名單',
```

`AUDIT_METADATA_FORMATTERS` 的 `grades: …,` 之後（`}` 之前）加：

```ts
  // 招生名單匯出（2026-10-03）：套用了哪些篩選。來源、介紹者、搜尋字只記有沒有篩。
  month: (v) => `篩選月份：${String(v)}`,
  grade: (v) => `篩選班別：${String(v)}`,
  has_source: (v) => (v ? '有篩選來源' : null),
  has_referrer: (v) => (v ? '有篩選介紹者' : null),
  has_deposit: (v) => `篩選預繳：${v ? '是' : '否'}`,
  no_deposit_reason: (v) => `篩選未預繳原因：${String(v)}`,
  funnel_stage: (v) => `篩選階段：${RECRUITMENT_STAGE_LABELS[String(v)] ?? String(v)}`,
  has_visit_request: (v) => (v ? '只匯出某筆官網預約建立的訪視' : null),
  priority: (v) => `篩選轉換潛力：${({ high: '高', medium: '中', low: '低' } as Record<string, string>)[String(v)] ?? String(v)}`,
  overdue_days: (v) => `只匯出建檔滿 ${countOf(v)} 天仍未預繳`,
  cold_only: (v) => (v ? '只匯出冷名單' : null),
```

`admin/src/__tests__/labelCoverage.test.ts`，`METADATA_HELPERS` 陣列最後（`[/^unlinked$/, …],` 之後）加：

```ts
  // 招生名單匯出（2026-10-03）：只記套用了哪些篩選。
  [/^download\.records_audit_metadata\(/, () => returnedKeys(functionBody(source('admissions/download.py'), 'def records_audit_metadata('))],
  [/^download\.no_deposit_audit_metadata\(/, () => returnedKeys(functionBody(source('admissions/download.py'), 'def no_deposit_audit_metadata('))],
```

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/labelCoverage.test.ts`
Expected: PASS（「每一種稽核動作都有中文」「每個鍵都有中文寫法」都過）

- [ ] **Step 7: 重產契約**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate; git diff --stat contracts`
Expected: `contracts/openapi.json` 多出 `/api/website/v1/admin/admissions/records/export`；`contracts/generated/website-api.d.ts` 跟著變

- [ ] **Step 8: Commit**

```bash
git add backend/app/admissions/download.py backend/app/admissions/routes.py backend/tests/test_admissions_download.py backend/tests/test_admissions_booking_link.py admin/src/api/labels.ts admin/src/__tests__/labelCoverage.test.ts contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "$(cat <<'EOF'
feat(admissions): 招生訪視明細匯出 CSV（需匯出個資授權、寫稽核）

條件同明細列表、不分頁，超過 10,000 筆請縮小篩選；稽核只記套用了
哪些篩選，搜尋字、介紹者、來源原文只記有沒有篩。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 未預繳名單匯出 API

**Files:**
- Modify: `backend/app/admissions/routes.py`（在 `get_admissions_no_deposit_records` 之後，檔尾）
- Test: `backend/tests/test_admissions_download.py`（加測試）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes: `stats_service.no_deposit_records`（`backend/app/admissions/stats.py:611`，回 `{"total", "records", ...}`）；`download.no_deposit_row`、`download.no_deposit_audit_metadata`、`download.NO_DEPOSIT_HEADERS`（Task 4）
- Produces: `GET /api/website/v1/admin/admissions/no-deposit-records/export`（query 同 `/no-deposit-records`，不含 page／page_size）；稽核 `action="recruitment_visit.export_no_deposit"`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_admissions_download.py` 檔尾加：

```python
NO_DEPOSIT_EXPORT = f"{ADMISSIONS}/no-deposit-records/export"


@pytest.mark.asyncio
async def test_no_deposit_export_follows_screen_filters(admin_client, campus_admin_yihua_client, db_session):  # noqa: F811
    await create_record(admin_client, child_name="林小安", no_deposit_reason="費用考量", parent_response="下週再聯絡")
    await create_record(admin_client, child_name="周小樂", no_deposit_reason="時程未到／仍在觀望")
    await record_at_stage(admin_client, "deposited", child_name="已預繳不列")

    header, rows = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua"))
    assert header == list(download.NO_DEPOSIT_HEADERS)
    by_name = {row["姓名"]: row for row in rows}
    assert set(by_name) == {"林小安", "周小樂"}
    assert by_name["林小安"]["轉換潛力"] == "中"
    assert by_name["林小安"]["電訪回應"] == "下週再聯絡"
    assert by_name["周小樂"]["轉換潛力"] == "高"
    assert by_name["周小樂"]["冷名單"] == "否"

    _, high = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&priority=high"))
    assert [row["姓名"] for row in high] == ["周小樂"]
    _, cold = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&priority=high&cold_only=true"))
    assert cold == []

    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "recruitment_visit.export_no_deposit")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert [entry.metadata_json for entry in entries] == [
        {"row_count": 2},
        {"row_count": 1, "priority": "high"},
        {"row_count": 0, "priority": "high", "cold_only": True},
    ]

    # 名單有孩子姓名：沒有匯出個資授權的分校管理者 403。
    assert (await campus_admin_yihua_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua")).status_code == 403


@pytest.mark.asyncio
async def test_no_deposit_export_refuses_more_than_the_limit(admin_client, monkeypatch):
    await create_record(admin_client, child_name="未預繳一", no_deposit_reason="費用考量")
    await create_record(admin_client, child_name="未預繳二", no_deposit_reason="費用考量")
    monkeypatch.setattr(csv_export, "EXPORT_ROW_LIMIT", 1)
    resp = await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua")
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXPORT_TOO_LARGE"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_admissions_download.py -k no_deposit`
Expected: FAIL，回 404（端點還不存在）

- [ ] **Step 3: 端點**

`backend/app/admissions/routes.py` 檔尾加：

```python
@router.get("/admin/admissions/no-deposit-records/export")
async def export_admissions_no_deposit_records(
    campus_key: str,
    school_year: int | None = Query(default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX),
    semester: int | None = Query(default=None, ge=1, le=2),
    reason: str | None = Query(default=None, max_length=60),
    grade: str | None = Query(default=None, max_length=20),
    priority: Literal["high", "medium", "low"] | None = Query(default=None),
    overdue_days: int | None = Query(default=None, ge=1, le=365),
    cold_only: bool | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """未預繳名單 CSV（2026-10-03）：篩選同畫面、不分頁。含孩子姓名與電訪回應，要「匯出個資」
    授權（booking.export）。"""
    _require_campus(current_user, "admissions.read", campus_key)
    require_scope(current_user, BOOKING_EXPORT, campus_keys=[campus_key])
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
        page=1,
        page_size=csv_export.EXPORT_ROW_LIMIT,
    )
    if result["total"] > csv_export.EXPORT_ROW_LIMIT:
        raise csv_export.too_many_rows()
    rows = [download.no_deposit_row(campus_key, record) for record in result["records"]]
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.export_no_deposit",
        target_type="recruitment_visit",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={
            "row_count": len(rows),
            **download.no_deposit_audit_metadata(
                school_year=school_year,
                semester=semester,
                reason=reason,
                grade=grade,
                priority=priority,
                overdue_days=overdue_days,
                cold_only=cold_only,
            ),
        },
    )
    await db.commit()
    filename = f"admissions-no-deposit-{csv_export.filename_part(campus_key)}-{today_local():%Y%m%d}.csv"
    return csv_export.csv_attachment(download.NO_DEPOSIT_HEADERS, rows, filename)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_admissions_download.py tests/test_admissions_booking_link.py tests/test_admissions_stats.py`
Expected: PASS

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/labelCoverage.test.ts`
Expected: PASS（`recruitment_visit.export_no_deposit` 與 `priority`／`overdue_days`／`cold_only` 在 Task 4 已有中文）

- [ ] **Step 5: 重產契約並 Commit**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate
git add backend/app/admissions/routes.py backend/tests/test_admissions_download.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "$(cat <<'EOF'
feat(admissions): 未預繳名單匯出 CSV（篩選同畫面、需匯出個資授權）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 後台訪視明細、未預繳名單的匯出鈕

**Files:**
- Modify: `admin/src/api/admissions.ts`（`listRecords` 之後、`getNoDepositRecords` 之後）
- Modify: `admin/src/components/admissions/RecordsTab.vue`（script 的 `load()`、template 的 `.records__head-actions`）
- Modify: `admin/src/components/admissions/NoDepositList.vue`（script 的 `load()`、template 的 `.nd-head`）
- Test: `admin/src/__tests__/admissionsDownload.test.ts`（新）

**Interfaces:**
- Consumes: `downloadServerCsv`、`csvFilename`（Task 2）；`apiErrorMessage`（`admin/src/api/errors.ts:59`）；`notifyError`（`admin/src/composables/notify.ts`）
- Produces:
  - `recordsExportPath(params: RecordFilters): string`
  - `type NoDepositFilters = Omit<Parameters<typeof getNoDepositRecords>[0], 'page' | 'page_size'>`、`noDepositExportPath(params: NoDepositFilters): string`

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/admissionsDownload.test.ts`：

```ts
// 招生名單匯出鈕（2026-10-03）：有「匯出個資」授權才顯示；送出和畫面相同的篩選、不帶分頁；
// 失敗時寫成中文提示，不產生檔案。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import NoDepositList from '../components/admissions/NoDepositList.vue'
import { ApiError } from '../api/client'
import { button, cleanup, hasButton, mockGet, mountWith, queryOf, reception, visit } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadServerCsv: vi.fn(() => Promise.resolve()) }))
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))
import { downloadServerCsv } from '../utils/csv'
import { notifyError } from '../composables/notify'

afterEach(() => {
  cleanup()
  vi.mocked(downloadServerCsv).mockClear()
  vi.mocked(notifyError).mockClear()
})

const recordProps = { campusKey: 'yihua', schoolYear: 115, semester: 1, month: '115.09', visitRequestId: '' }
const noDepositProps = { campusKey: 'yihua', schoolYear: 115, semester: 1 }
const noDeposit = { total: 0, page: 1, page_size: 50, summary: { high_potential_count: 0, overdue_followup_count: 0, cold_count: 0 }, records: [] }

describe('訪視明細匯出 CSV', () => {
  it('總管理者看得到；送出和列表相同的篩選、不帶分頁，檔名含校區與日期', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    const [path, filename] = vi.mocked(downloadServerCsv).mock.calls.at(-1)!
    expect(path.startsWith('/admin/admissions/records/export?')).toBe(true)
    const query = queryOf(path)
    expect(query.get('campus_key')).toBe('yihua')
    expect(query.get('month')).toBe('115.09')
    expect(query.get('target_school_year')).toBe('115')
    expect(query.get('target_semester')).toBe('1')
    expect(query.has('page')).toBe(false)
    expect(query.has('page_size')).toBe(false)
    expect(filename).toMatch(/^招生訪視明細-義華-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('沒有匯出個資授權的櫃台看不到按鈕', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps, user: reception() })
    expect(hasButton(wrapper, '匯出 CSV')).toBe(false)
  })

  it('筆數太多（422）時用後端的中文訊息提示', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    vi.mocked(downloadServerCsv).mockRejectedValueOnce(new ApiError(422, { code: 'EXPORT_TOO_LARGE', message: '符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。' }))
    const { wrapper } = await mountWith(RecordsTab, { props: recordProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。')
  })
})

describe('未預繳名單匯出 CSV', () => {
  it('送出目前的潛力、原因、班別篩選（預設高潛力優先）', async () => {
    mockGet({ '/admin/admissions/no-deposit-records': noDeposit })
    const { wrapper } = await mountWith(NoDepositList, { props: noDepositProps })
    await button(wrapper, '匯出 CSV')!.trigger('click')
    await flushPromises()
    const [path, filename] = vi.mocked(downloadServerCsv).mock.calls.at(-1)!
    expect(path.startsWith('/admin/admissions/no-deposit-records/export?')).toBe(true)
    const query = queryOf(path)
    expect(query.get('campus_key')).toBe('yihua')
    expect(query.get('school_year')).toBe('115')
    expect(query.get('priority')).toBe('high')
    expect(query.has('page')).toBe(false)
    expect(filename).toMatch(/^未預繳名單-義華-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('沒有匯出個資授權的櫃台看不到按鈕', async () => {
    mockGet({ '/admin/admissions/no-deposit-records': noDeposit })
    const { wrapper } = await mountWith(NoDepositList, { props: noDepositProps, user: reception() })
    expect(hasButton(wrapper, '匯出 CSV')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/admissionsDownload.test.ts`
Expected: FAIL，找不到「匯出 CSV」按鈕（`button(...)` 回 undefined）

- [ ] **Step 3: API 路徑**

`admin/src/api/admissions.ts`，`listRecords` 之後加：

```ts
/** 訪視明細 CSV（2026-10-03）：條件同列表、不分頁；要「匯出個資」授權。 */
export function recordsExportPath(params: RecordFilters): string {
  return `/admin/admissions/records/export?${toQuery(params)}`
}
```

`getNoDepositRecords` 之後加：

```ts
export type NoDepositFilters = Omit<Parameters<typeof getNoDepositRecords>[0], 'page' | 'page_size'>

/** 未預繳名單 CSV（2026-10-03）：篩選同畫面、不分頁；要「匯出個資」授權。 */
export function noDepositExportPath(params: NoDepositFilters): string {
  return `/admin/admissions/no-deposit-records/export?${toQuery(params)}`
}
```

- [ ] **Step 4: `RecordsTab.vue`**

script 的 import 改／加：

```ts
import { Download, ArrowDown, Plus, Search } from '@element-plus/icons-vue'
import { deleteRecord, getOptions, listRecords, recordsExportPath, transition, transitionRequest, type RecordFilters } from '../../api/admissions'
import { notifyError } from '../../composables/notify'
import { taipeiToday } from '../../composables/newsContent'
import { csvFilename, downloadServerCsv } from '../../utils/csv'
```

（`ArrowDown, Plus, Search` 原本就有，只加 `Download`；`apiErrorMessage` 已從 `../../api/errors` 匯入。）

`canConvert` 之後加 `const canExport = computed(() => can('booking.export'))`。把 `load()` 裡 `listRecords({ ... })` 的參數物件抽成函式，放在 `load()` 之前：

```ts
// 列表與 CSV 匯出送同一組篩選：畫面上篩好什麼，匯出的就是那一批（同參觀案件）。
function currentFilters(): RecordFilters {
  return {
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
  }
}
```

`load()` 改成 `const result = await listRecords({ ...currentFilters(), page: page.value, page_size: PAGE_SIZE })`。再加：

```ts
const exporting = ref(false)
async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    await downloadServerCsv(recordsExportPath(currentFilters()), csvFilename('招生訪視明細', campusLabel(props.campusKey), taipeiToday()))
  } catch (err) {
    notifyError(apiErrorMessage(err, '匯出失敗，請再試一次。'))
  } finally {
    exporting.value = false
  }
}
```

template 的 `.records__head-actions` 裡，`新增訪視` 按鈕之前加：

```vue
          <template v-if="canExport">
            <el-button :icon="Download" :loading="exporting" aria-describedby="records-export-scope" @click="exportCsv">匯出 CSV</el-button>
            <span id="records-export-scope" class="hint">匯出範圍：目前篩選的全部結果（不只本頁）</span>
          </template>
```

- [ ] **Step 5: `NoDepositList.vue`**

script import 加：

```ts
import { Download } from '@element-plus/icons-vue'
import { getNoDepositRecords, noDepositExportPath, type NoDepositFilters } from '../../api/admissions'
import { apiErrorMessage } from '../../api/errors'
import { campusLabel } from '../../api/labels'
import { notifyError } from '../../composables/notify'
import { taipeiToday } from '../../composables/newsContent'
import { usePermissions } from '../../composables/usePermissions'
import { csvFilename, downloadServerCsv } from '../../utils/csv'
```

（原本的 `import { getNoDepositRecords } from '../../api/admissions'` 換成上面那行；其餘若已匯入就不重複。）

`load()` 之前加：

```ts
const { can } = usePermissions()
const canExport = computed(() => can('booking.export'))

function currentFilters(): NoDepositFilters {
  return {
    campus_key: props.campusKey,
    school_year: props.schoolYear,
    semester: props.semester,
    reason: reason.value || null,
    grade: grade.value || null,
    priority: priority.value === 'all' ? null : priority.value,
    overdue_days: overdueDays.value,
    cold_only: coldOnly.value || null,
  }
}

const exporting = ref(false)
async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    await downloadServerCsv(noDepositExportPath(currentFilters()), csvFilename('未預繳名單', campusLabel(props.campusKey), taipeiToday()))
  } catch (err) {
    notifyError(apiErrorMessage(err, '匯出失敗，請再試一次。'))
  } finally {
    exporting.value = false
  }
}
```

`load()` 裡的 `getNoDepositRecords({ ... })` 改成 `getNoDepositRecords({ ...currentFilters(), page: page.value, page_size: PAGE_SIZE })`。template 的 `<div class="nd-filters">` 最後一個子元素之後加：

```vue
        <el-button v-if="canExport" size="small" :icon="Download" :loading="exporting" @click="exportCsv">匯出 CSV</el-button>
```

- [ ] **Step 6: 跑測試確認通過**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/admissionsDownload.test.ts src/__tests__/admissionsRecords.test.ts src/__tests__/statsTab.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯誤

- [ ] **Step 7: Commit**

```bash
git add admin/src/api/admissions.ts admin/src/components/admissions/RecordsTab.vue admin/src/components/admissions/NoDepositList.vue admin/src/__tests__/admissionsDownload.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 訪視明細與未預繳名單加「匯出 CSV」（有匯出個資授權才顯示）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 操作紀錄 API 加期間與每次筆數

**Files:**
- Modify: `backend/app/operations/audit_service.py:89-112`（`list_recent`）
- Modify: `backend/app/operations/routes.py:302-326`（`get_audit_log`）與 imports
- Test: `backend/tests/test_operations.py`（加一個測試）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Produces:
  - `list_recent(db, campus_key, limit=100, *, before=None, exclude_login=False, since: datetime | None = None, until: datetime | None = None)`（`since` 含、`until` 不含，UTC）
  - `GET /admin/audit-log` 新 query：`created_from: date`、`created_to: date`（台北日期，含頭含尾）、`limit: int = 100`（1–500）；`created_from > created_to` 回 422 `INVALID_DATE_RANGE`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_operations.py`，在 `test_audit_log_can_hide_routine_logins` 之後加：

```python
@pytest.mark.asyncio
async def test_audit_log_filters_by_taipei_dates_and_limit(admin_client, db_session):
    from app.operations.models import AuditLogEntry
    from sqlalchemy import delete

    await db_session.execute(delete(AuditLogEntry))
    # 台北 10/1 是 UTC 9/30 16:00 到 10/1 16:00（不含）。
    for when in (
        datetime(2026, 9, 30, 15, 59, tzinfo=timezone.utc),
        datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc),
        datetime(2026, 10, 1, 15, 59, tzinfo=timezone.utc),
        datetime(2026, 10, 1, 16, 0, tzinfo=timezone.utc),
    ):
        await _audit(db_session, action="site_settings.update", created_at=when, campus_key=None)
    await db_session.commit()

    def parsed(resp) -> list[datetime]:
        assert resp.status_code == 200, resp.text
        return [datetime.fromisoformat(e["created_at"].replace("Z", "+00:00")) for e in resp.json()]

    url = "/api/website/v1/admin/audit-log"
    oct1 = parsed(await admin_client.get(url, params={"created_from": "2026-10-01", "created_to": "2026-10-01"}))
    assert oct1 == [datetime(2026, 10, 1, 15, 59, tzinfo=timezone.utc), datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc)]
    assert len(parsed(await admin_client.get(url, params={"created_from": "2026-10-01"}))) == 3
    assert len(parsed(await admin_client.get(url, params={"created_to": "2026-09-30"}))) == 1
    assert len(parsed(await admin_client.get(url, params={"limit": 1}))) == 1

    assert (await admin_client.get(url, params={"limit": 501})).status_code == 422
    backwards = await admin_client.get(url, params={"created_from": "2026-10-02", "created_to": "2026-10-01"})
    assert backwards.status_code == 422
    assert backwards.json()["detail"]["code"] == "INVALID_DATE_RANGE"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_operations.py -k taipei_dates`
Expected: FAIL（`created_from` 被忽略，回 4 筆）

- [ ] **Step 3: 實作**

`backend/app/operations/audit_service.py` 的 `list_recent` 簽名改成：

```python
async def list_recent(
    db: AsyncSession,
    campus_key: str | None,
    limit: int = 100,
    *,
    before: tuple[datetime, uuid.UUID] | None = None,
    exclude_login: bool = False,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[AuditRow]:
    """新的在前，一次 limit 筆。before 是上一頁最後一筆的 (created_at, id)，
    傳了就接著往更早的讀；同一時間的多筆用 id 排出固定順序，不會漏也不會重複。
    since（含）、until（不含）是 UTC，路由先把台北日期換好。"""
```

在 `if exclude_login:` 那段之後加：

```python
    if since is not None:
        stmt = stmt.where(AuditLogEntry.created_at >= since)
    if until is not None:
        stmt = stmt.where(AuditLogEntry.created_at < until)
```

`backend/app/operations/routes.py`：imports 加 `from app.common.timezones import local_day_bounds_utc`（若已經從 `app.common.timezones` 匯入別的名字，就加在同一行）。`get_audit_log` 換成：

```python
@router.get("/admin/audit-log", response_model=list[AuditLogEntryOut])
async def get_audit_log(
    campus_key: str | None = None,
    before: datetime | None = Query(None, description="上一頁最後一筆的 created_at；和 before_id 一起傳，讀更早的紀錄"),
    before_id: uuid.UUID | None = Query(None, description="上一頁最後一筆的 id"),
    exclude_login: bool = Query(False, description="不列例行的登入登出（登入失敗、帳號鎖定照列）"),
    created_from: date | None = Query(None, description="紀錄日期起（含），台灣日期"),
    created_to: date | None = Query(None, description="紀錄日期迄（含），台灣日期"),
    limit: int = Query(100, ge=1, le=500, description="一次幾筆；後台匯出時用 500 減少來回"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[AuditLogEntryOut]:
    """新的在前，一次最多 limit 筆；要更早的就帶上一頁最後一筆的 before／before_id。"""
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
    else:
        require_scope(current_user, "audit.read_all")
    if (before is None) != (before_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_CURSOR", "message": "before 與 before_id 要一起傳"},
        )
    if created_from and created_to and created_from > created_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_DATE_RANGE", "message": "開始日期不能晚於結束日期"},
        )
    rows = await audit_service.list_recent(
        db,
        campus_key,
        limit=limit,
        before=(_as_utc(before), before_id) if before is not None and before_id is not None else None,
        exclude_login=exclude_login,
        since=local_day_bounds_utc(created_from)[0] if created_from else None,
        until=local_day_bounds_utc(created_to)[1] if created_to else None,
    )
```

（`return [...]` 那段不動。）

- [ ] **Step 4: 跑測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=$TESTDB uv run --frozen pytest -q tests/test_operations.py tests/test_bugfix_regressions.py`
Expected: PASS（含既有的 `test_audit_log_pages_older_entries_with_cursor`）

- [ ] **Step 5: 重產契約並 Commit**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate
git add backend/app/operations/audit_service.py backend/app/operations/routes.py backend/tests/test_operations.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "$(cat <<'EOF'
feat(operations): 操作紀錄可依台北日期篩選、一次最多讀 500 筆

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 操作紀錄期間篩選與匯出 CSV（前端組）

**Files:**
- Create: `admin/src/utils/auditFormat.ts`
- Modify: `admin/src/views/AuditView.vue`（script 第 1–60、81–89、115–125、170–176 行附近；template 的 `.filter-bar`、`.list-summary`）
- Test: `admin/src/__tests__/auditExport.test.ts`（新）

**Interfaces:**
- Consumes: `buildCsv`、`downloadCsv`、`csvFilename`、`CsvCell`（Task 2）；`auditMetadataDetails`、`auditActionLabel`、`auditTargetLabel`、`campusLabel`、`staffLabel`、`staffEmail`、`staffOf`（`admin/src/api/labels.ts`）；API 的 `created_from`／`created_to`／`limit`（Task 7）
- Produces（`admin/src/utils/auditFormat.ts`）：
  - `auditCampusText(entry)`、`auditActorText(entry)`、`auditActorEmail(entry)`、`auditTargetPerson(entry): StaffPerson | null`、`auditTargetText(entry)`（從 `AuditView.vue` 原樣搬出）
  - `auditSearchText(entry, details: AuditDetails): string`（已轉小寫）
  - `AUDIT_CSV_HEADER: readonly string[]`、`auditCsvTime(iso: string): string`、`auditCsvRow(entry, details): CsvCell[]`

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/auditExport.test.ts`：

```ts
// 操作紀錄期間篩選與匯出（2026-10-03）：匯出依目前校區、期間與搜尋，逐頁讀完（每次 500 筆），
// 超過 5,000 筆不產生檔案、提示縮短期間。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AuditView from '../views/AuditView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { auditCsvRow, auditCsvTime, AUDIT_CSV_HEADER } from '../utils/auditFormat'
import { auditMetadataDetails } from '../api/labels'
import { testUser } from './fixtures'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))
import { downloadCsv } from '../utils/csv'
import { notifyWarning } from '../composables/notify'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.mocked(downloadCsv).mockClear()
  vi.mocked(notifyWarning).mockClear()
})

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, actor_user_id: 'me', actor_email: 'amy@ivy.example', actor_display_name: '王小美',
    action: 'visit_request.export', target_type: 'visit_request', target_id: 'yihua', target_label: null, target_exists: null,
    campus_key: 'yihua', metadata: { row_count: 3 }, created_at: '2026-09-28T06:30:00Z', ...extra,
  }
}

async function mountAudit() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/audit')
  await router.isReady()
  const wrapper = mount(AuditView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const paramsOf = (url: unknown) => new URL(String(url), 'http://x').searchParams

describe('操作紀錄 CSV 的欄位', () => {
  it('台北時間、操作者與完整 Email、動作與細節是中文', () => {
    const row = entry('a1')
    expect(auditCsvTime(row.created_at)).toBe('2026/09/28 14:30')
    expect(AUDIT_CSV_HEADER).toEqual(['日期時間', '操作者', '操作者 Email', '動作', '對象類型', '對象帳號', '校區', '細節', '其他細節'])
    const cells = auditCsvRow(row as never, auditMetadataDetails(row.metadata, row.action))
    expect(cells.slice(0, 4)).toEqual(['2026/09/28 14:30', '王小美', 'amy@ivy.example', '匯出家長個資'])
    expect(cells[6]).toBe('義華')
    expect(String(cells[7])).toContain('匯出 3 筆')
  })
})

describe('操作紀錄期間篩選', () => {
  it('選了期間就帶 created_from／created_to 重新讀取', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([entry('a1')] as never)
    const wrapper = await mountAudit()
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-30'])
    await flushPromises()
    const params = paramsOf(get.mock.calls.at(-1)![0])
    expect(params.get('created_from')).toBe('2026-09-01')
    expect(params.get('created_to')).toBe('2026-09-30')
  })
})

describe('操作紀錄匯出 CSV', () => {
  it('每次讀 500 筆、用最後一筆當游標讀到完，全部寫進檔案', async () => {
    const first = Array.from({ length: 500 }, (_, i) => entry(`a${i}`))
    const get = vi.spyOn(api, 'get').mockImplementation((url) => {
      const params = paramsOf(url)
      if (params.get('limit') !== '500') return Promise.resolve([entry('screen')]) as Promise<never>
      return Promise.resolve(params.has('before') ? [entry('last', { created_at: '2026-09-01T01:00:00Z' })] : first) as Promise<never>
    })
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const exportCalls = get.mock.calls.map((call) => paramsOf(call[0])).filter((params) => params.get('limit') === '500')
    expect(exportCalls).toHaveLength(2)
    expect(exportCalls[1]!.get('before_id')).toBe('a499')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toMatch(/^操作紀錄-全部校區-全部期間-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')).toHaveLength(1 + 501 + 1)
  })

  it('超過 5,000 筆就停下、不產生檔案，提示縮短期間', async () => {
    const page = Array.from({ length: 500 }, (_, i) => entry(`p${i}`))
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(paramsOf(url).get('limit') === '500' ? page : [entry('screen')]) as Promise<never>,
    )
    const wrapper = await mountAudit()
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(vi.mocked(notifyWarning).mock.calls.at(-1)![0]).toContain('超過 5,000 筆')
  })

  it('有搜尋字時只匯出符合的紀錄', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(
        paramsOf(url).get('limit') === '500'
          ? [entry('a1'), entry('a2', { action: 'user.create', target_type: 'user', metadata: {} })]
          : [entry('screen')],
      ) as Promise<never>,
    )
    const wrapper = await mountAudit()
    await wrapper.get('.filter-search input').setValue('新增帳號')
    await wrapper.get('[data-test="audit-export"]').trigger('click')
    await flushPromises()
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv).toContain('新增帳號')
    expect(csv).not.toContain('匯出家長個資')
  })
})
```

> `'user.create'` 的中文是「新增帳號」（`labels.ts:408`）。若實作時這個標籤已改名，測試照新文字改。

- [ ] **Step 2: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/auditExport.test.ts`
Expected: FAIL，`Failed to resolve import "../utils/auditFormat"`

- [ ] **Step 3: 抽出格式化**

`admin/src/utils/auditFormat.ts`：

```ts
// 操作紀錄一筆的文字（2026-10-03 從 AuditView.vue 抽出）：畫面、搜尋與 CSV 匯出共用，
// 中文只維護在 labels.ts 一份。
import { auditActionLabel, auditTargetLabel, campusLabel, type AuditDetails, type StaffPerson, staffEmail, staffLabel, staffOf } from '../api/labels'
import type { AuditLogEntryOut } from '../api/types'
import type { CsvCell } from './csv'

type AuditEntry = AuditLogEntryOut

export function auditCampusText(entry: AuditEntry): string {
  return entry.campus_key ? campusLabel(entry.campus_key) : '全站'
}

// 誰做的：讀取時由後端 join 帳號查出來（紀錄本身不存名字與 Email）。沒有操作者
// 是排程發布、每天清理這類系統自己做的事；有 id 卻查不到是帳號已刪除。
export function auditActorText(entry: AuditEntry): string {
  return staffLabel(staffOf(entry, 'actor'), entry.actor_user_id ? '已移除的帳號' : '系統')
}

export function auditActorEmail(entry: AuditEntry): string {
  return staffEmail(staffOf(entry, 'actor'))
}

// 對哪個帳號（新增帳號、重設密碼、改角色……）：後端給對方的顯示名稱，沒有時
// 給 Email；Email 和其他地方一樣只寫 @ 前面那段，完整的放在 title。
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+$/
export function auditTargetPerson(entry: AuditEntry): StaffPerson | null {
  const label = entry.target_label?.trim()
  if (!label) return null
  return EMAIL_LIKE.test(label) ? { email: label } : { display_name: label }
}

export function auditTargetText(entry: AuditEntry): string {
  const person = auditTargetPerson(entry)
  return person ? staffLabel(person) : ''
}

/** 搜尋用的整筆文字（已轉小寫）：畫面上的搜尋與匯出的搜尋用同一份。 */
export function auditSearchText(entry: AuditEntry, details: AuditDetails): string {
  const who = [auditActorText(entry), auditActorEmail(entry), auditTargetText(entry), staffEmail(auditTargetPerson(entry))]
  return [auditActionLabel(entry.action), auditTargetLabel(entry.target_type), ...who, ...details.lines, ...details.others, auditCampusText(entry)]
    .join(' ')
    .toLocaleLowerCase()
}

export const AUDIT_CSV_HEADER: readonly string[] = ['日期時間', '操作者', '操作者 Email', '動作', '對象類型', '對象帳號', '校區', '細節', '其他細節']

const CSV_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** 台北時間「2026/09/28 14:30」（同參觀案件匯出）。 */
export function auditCsvTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = Object.fromEntries(CSV_TIME.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

/** CSV 一列：Email 與對象帳號寫完整的（畫面只寫 @ 前面那段）。 */
export function auditCsvRow(entry: AuditEntry, details: AuditDetails): CsvCell[] {
  return [
    auditCsvTime(entry.created_at),
    auditActorText(entry),
    entry.actor_email ?? '',
    auditActionLabel(entry.action),
    auditTargetLabel(entry.target_type),
    entry.target_label ?? '',
    auditCampusText(entry),
    details.lines.join('，'),
    details.others.join('；'),
  ]
}
```

- [ ] **Step 4: `AuditView.vue` 改用、加期間與匯出**

script：

1. import 區：`import { auditActionLabel, auditMetadataDetails, auditTargetLabel, campusLabel, contentEditorPath, formatDateTime, type AuditDetails, type StaffPerson, staffEmail, staffLabel, staffOf } from '../api/labels'` 改成 `import { auditActionLabel, auditMetadataDetails, auditTargetLabel, campusLabel, contentEditorPath, formatDateTime, type AuditDetails, staffEmail } from '../api/labels'`，再加：

```ts
import { Download } from '@element-plus/icons-vue'
import { apiErrorMessage } from '../api/errors'
import { notifyError, notifyWarning } from '../composables/notify'
import { taipeiToday } from '../composables/newsContent'
import { buildCsv, csvFilename, downloadCsv } from '../utils/csv'
import {
  AUDIT_CSV_HEADER, auditActorEmail as actorEmail, auditActorText as actorText, auditCampusText as campusText,
  auditCsvRow, auditSearchText, auditTargetPerson as targetPerson, auditTargetText as targetText,
} from '../utils/auditFormat'
```

2. 刪掉原本的 `campusText`、`actorText`、`actorEmail`、`EMAIL_LIKE`、`targetPerson`、`targetText` 定義（第 36–63 行附近；名字改由上面的 alias 提供，template 不用改）。

3. `visibleEntries` 換成：

```ts
const visibleEntries = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return entries.value.filter((entry) => auditSearchText(entry, details(entry)).includes(keyword))
})
```

4. `hideLogins` 之後加：

```ts
// 期間（台灣日期，含頭含尾）：清單與匯出用同一組條件。
const period = ref<[string, string] | null>(null)
function isFutureDate(date: Date): boolean {
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return local > taipeiToday()
}
```

5. `auditPath` 換成：

```ts
function auditPath(before?: AuditEntry, limit?: number): string {
  const params = new URLSearchParams()
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  if (hideLogins.value) params.set('exclude_login', 'true')
  if (period.value) {
    params.set('created_from', period.value[0])
    params.set('created_to', period.value[1])
  }
  if (limit) params.set('limit', String(limit))
  if (before) {
    params.set('before', before.created_at)
    params.set('before_id', before.id)
  }
  const query = params.toString()
  return `/admin/audit-log${query ? `?${query}` : ''}`
}
```

6. `watch([campusFilter, hideLogins], load)` 改成 `watch([campusFilter, hideLogins, period], load)`。

7. `loadMore` 之後加：

```ts
// 匯出（2026-10-03）：照目前校區、期間與搜尋，從最新的往前逐頁讀完（每次 500 筆），不只已載入的。
// 超過 EXPORT_MAX 筆就停下、不產生半份檔案。紀錄不含家長個資，匯出本身不另寫稽核。
const EXPORT_PAGE = 500
const EXPORT_MAX = 5000
const exporting = ref(false)
async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    const all: AuditEntry[] = []
    let before: AuditEntry | undefined
    for (;;) {
      const page = await api.get<AuditEntry[]>(auditPath(before, EXPORT_PAGE))
      all.push(...page)
      if (all.length > EXPORT_MAX) {
        notifyWarning(`符合的紀錄超過 ${EXPORT_MAX.toLocaleString('zh-TW')} 筆，請縮短期間或選定校區再匯出。`)
        return
      }
      if (page.length < EXPORT_PAGE) break
      before = page[page.length - 1]
    }
    const keyword = search.value.trim().toLocaleLowerCase()
    const rows = all
      .map((entry) => ({ entry, details: auditMetadataDetails(entry.metadata, entry.action) }))
      .filter(({ entry, details: d }) => auditSearchText(entry, d).includes(keyword))
      .map(({ entry, details: d }) => auditCsvRow(entry, d))
    const campus = campusFilter.value ? campusLabel(campusFilter.value) : '全部校區'
    const range = period.value ? `${period.value[0]}至${period.value[1]}` : '全部期間'
    downloadCsv(csvFilename('操作紀錄', campus, range, taipeiToday()), buildCsv(AUDIT_CSV_HEADER, rows))
  } catch (err) {
    notifyError(apiErrorMessage(err, '匯出失敗，請再試一次。'))
  } finally {
    exporting.value = false
  }
}
```

template：

1. `.filter-bar` 裡「不列登入登出」之前加：

```vue
      <label class="filter-field"><span>期間</span><el-date-picker v-model="period" type="daterange" value-format="YYYY-MM-DD" :disabled-date="isFutureDate" start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="期間" data-test="audit-period" /></label>
```

2. `.list-summary` 的「重新整理」按鈕之後加：

```vue
      <el-button v-if="isSuperAdmin || campusFilter" :icon="Download" :loading="exporting" aria-describedby="audit-export-scope" data-test="audit-export" @click="exportCsv">匯出 CSV</el-button>
      <span v-if="isSuperAdmin || campusFilter" id="audit-export-scope" class="hint">匯出範圍：目前校區、期間與搜尋的全部紀錄（不只已載入的）</span>
```

- [ ] **Step 5: 跑測試確認通過**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/auditExport.test.ts src/__tests__/auditUx.test.ts src/__tests__/labelCoverage.test.ts; npm --prefix admin run typecheck`
Expected: PASS（`auditUx.test.ts` 既有的游標、不列登入、案件連結測試照樣過）；typecheck 0 錯誤

- [ ] **Step 6: Commit**

```bash
git add admin/src/utils/auditFormat.ts admin/src/views/AuditView.vue admin/src/__tests__/auditExport.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 操作紀錄可依期間篩選並匯出 CSV

照目前校區、期間與搜尋逐頁讀完（每次 500 筆），超過 5,000 筆不產生
檔案並提示縮短期間；格式化抽到 utils/auditFormat.ts，畫面與匯出共用。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: stack e2e：瀏覽器真的下載到檔案

**Files:**
- Create: `tests/stack/exports.spec.ts`

**Interfaces:**
- Consumes: `adminApi`、`taipeiDate`（`tests/stack/api.ts`）；`gotoAdmin`、`openAs`（`tests/stack/pages.ts`）；`SLOTS_CAMPUS`（`tests/stack/stack-env.ts:35`，義華）；`currentTerm`（`admin/src/admissions/academic.ts`）

- [ ] **Step 1: 寫測試**

`tests/stack/exports.spec.ts`：

```ts
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate } from './api'
import { gotoAdmin, openAs } from './pages'
import { SLOTS_CAMPUS } from './stack-env'

// 後台匯出擴充（2026-10-03）：在瀏覽器裡按「匯出 CSV」真的拿到檔案，Excel 要的 BOM、
// 中文欄名與公式注入防護都在檔案裡。API 只用來建一筆訪視；按鈕一律在畫面上按。
const CHILD = '匯出流程寶貝'
const TERM = currentTerm(taipeiDate(0))

test('招生訪視明細與操作紀錄可以下載成 CSV', async ({ browser }) => {
  const api = await adminApi('super_admin')
  await api.send('POST', `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}`, {
    visit_date: taipeiDate(-1),
    child_name: CHILD,
    birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
    target_school_year: TERM.schoolYear,
    target_semester: TERM.semester,
    notes: '=HYPERLINK("http://x")',
  })
  const { context, page } = await openAs(browser, 'super_admin')
  try {
    await test.step('訪視明細', async () => {
      await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=records`, '招生入學')
      await expect(page.getByText(CHILD)).toBeVisible()
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: '匯出 CSV' }).click()
      const file = await downloading
      expect(file.suggestedFilename()).toMatch(/^招生訪視明細-義華-\d{4}-\d{2}-\d{2}\.csv$/)
      const text = await readFile((await file.path())!, 'utf8')
      expect(text.startsWith('﻿校區,月份,序號,參觀日期,幼生姓名')).toBe(true)
      expect(text).toContain(CHILD)
      expect(text).toContain(`"'=HYPERLINK(""http://x"")"`)
    })

    await test.step('操作紀錄', async () => {
      await gotoAdmin(page, '/audit', '操作紀錄')
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: '匯出 CSV' }).click()
      const file = await downloading
      const text = await readFile((await file.path())!, 'utf8')
      expect(text.split('\r\n')[0]).toBe('﻿日期時間,操作者,操作者 Email,動作,對象類型,對象帳號,校區,細節,其他細節')
      expect(text).toContain('匯出招生訪視明細')
    })
  } finally {
    await context.close()
    await api.dispose()
  }
})
```

- [ ] **Step 2: 只跑這一支**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
export E2E_DB_NAME=ivy_website_exports_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761
npm run e2e:build
npx playwright test -c playwright.stack.config.ts tests/stack/exports.spec.ts
```

Expected: setup＋1 項 PASS。8761／3761 被占用時換另一組埠，不要關別人的程序。

- [ ] **Step 3: Commit**

```bash
git add tests/stack/exports.spec.ts
git commit -m "$(cat <<'EOF'
test(stack): 招生訪視明細與操作紀錄在瀏覽器下載得到 CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 文件

**Files:**
- Modify: `README.md`（頂部加日期段落）
- Modify: `DESIGN.md`（「招生入學（2026-10-01）」的「不做」那行；檔尾新增一節）
- Modify: `docs/website-admin/acceptance.md`（檔尾新增一節）

- [ ] **Step 1: README 頂部加段落**

在 `README.md` 第一個 `## ` 標題之前加（驗證那段照 Task 11 的實際結果改寫，沒跑過的寫「未驗證」）：

```markdown
## 2026-10-03 後台匯出擴充（`feature/admin-exports-20261003`，未部署）

使用者要求：後台除了參觀案件，招生明細、統計、操作紀錄也要能匯出。規則見 DESIGN.md「後台匯出擴充（2026-10-03）」。

- **招生入學**：訪視明細、未預繳名單「匯出 CSV」（後端產生，要「匯出個資」授權，寫稽核，超過 10,000 筆請縮小篩選）；統計分頁每張表都能匯出（前端組，去識別）。招生開關關閉時一樣 404。
- **操作紀錄**：可依期間篩選；「匯出 CSV」照目前校區、期間與搜尋逐頁讀完，超過 5,000 筆不產生檔案。
- **共用**：`backend/app/common/csv_export.py`（參觀案件匯出也改用，輸出不變）、`admin/src/utils/csv.ts`；兩邊的公式注入防護同一條規則。
- **驗證**（Node 22）：後端 pytest 全套 N passed；admin vitest N passed、typecheck 0；`contract:check` 一致；stack e2e N 項（`exports.spec.ts` 通過）。
- **未做**：成效統計匯出（等成效統計補強計畫合併）、Safari／iOS 實機下載。
```

- [ ] **Step 2: DESIGN.md**

「招生入學（2026-10-01）」一節的「**不做**」那行，把「統計 Excel 匯出、」改成「統計 Excel 匯出（2026-10-03 起改提供 CSV，見「後台匯出擴充」）、」。

檔尾加：

```markdown
## 後台匯出擴充（2026-10-03）

- **兩條路徑**：含孩子姓名、電話、地址的名單（訪視明細、未預繳名單）由後端產生，要 `admissions.read`＋校區＋「匯出個資」授權（`booking.export`，和參觀案件同一項），每次寫稽核；去識別的統計表與操作紀錄在後台前端組，資料就是畫面上的。
- **格式同參觀案件**：BOM、中文欄名、`\r\n`；參觀日期、生日、註冊日期寫西元 `YYYY/MM/DD`，建檔時間寫台北 `YYYY/MM/DD HH:MM`，「月份」保留民國 `115.09`。手機 `0912-345-601`。開頭是 `= + - @`、空白或控制字元的格子補單引號（後端 `safe_cell`、前端 `safeCell` 同一條規則）。
- **欄位只放畫面上有的**：來源分類、帶參觀老師、娃娃車、地址分析同意不進 CSV。給園務轉移的格式是 `app/admissions/export.py`（JSONL），和後台下載分開。
- **統計表**：比率沒有值寫空白（不寫「—」），計數缺值寫 0；表沒有資料時不顯示「匯出 CSV」。
- **上限**：伺服器一次 10,000 筆，超過回「請縮小篩選範圍」，不截斷；操作紀錄前端逐頁讀（每次 500），超過 5,000 筆不產生檔案。
- **按鈕**：「匯出 CSV」＋「匯出範圍：目前篩選的全部結果（不只本頁）」說明；統計表用小的文字按鈕放在表名右邊。失敗用 `notifyError` 寫後端的中文訊息。
- **稽核**：metadata 只記套用了哪些篩選，搜尋字、介紹者、來源原文只記「有篩選」。操作紀錄的匯出本身不另寫稽核（紀錄不含家長個資）。
```

- [ ] **Step 3: acceptance.md 新增一節**

檔尾加（狀態欄依 Task 11 實際結果填「通過／部分／未做」，證據寫實際跑過的測試）：

```markdown
## 後台匯出擴充（2026-10-03 實作，尚未部署）

計畫 `docs/superpowers/plans/2026-10-03-admin-exports.md`。

| 編號 | 案例 | 狀態 | 證據 |
|---|---|---|---|
| E01 | 共用 CSV：BOM、CRLF、引號、公式注入 | | `backend/tests/test_csv_export.py`、`admin/src/__tests__/csvUtil.test.ts` |
| E02 | 參觀案件匯出改用共用模組，輸出不變 | | `test_visit_attention_export.py`、`test_security_hardening.py::test_csv_export_neutralises_formula_after_leading_control_chars` |
| E03 | 招生統計每張表可匯出，空比率寫空白 | | `statsDimensionCsv.test.ts`、`statsTab.test.ts`「統計表匯出 CSV」 |
| E04 | 訪視明細匯出：篩選、欄名、授權、越權、上限、稽核 | | `backend/tests/test_admissions_download.py` |
| E05 | 未預繳名單匯出 | | 同上 `test_no_deposit_export_*` |
| E06 | 招生開關關閉時兩個匯出端點 404 | | `test_admissions_booking_link.py::test_admissions_disabled_skips_visit_and_hides_endpoints` |
| E07 | 後台匯出鈕只給有授權的人、送出同畫面篩選 | | `admissionsDownload.test.ts` |
| E08 | 操作紀錄依台北日期篩選、每次最多 500 筆 | | `test_operations.py::test_audit_log_filters_by_taipei_dates_and_limit` |
| E09 | 操作紀錄匯出：逐頁讀完、搜尋、超過 5,000 筆不出檔 | | `auditExport.test.ts` |
| E10 | 瀏覽器真的下載到檔案 | | `tests/stack/exports.spec.ts` |
| E11 | 成效統計匯出 | 未做 | 等成效統計補強計畫合併（本計畫 Task 12） |
```

- [ ] **Step 4: Commit**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md
git commit -m "$(cat <<'EOF'
docs: 記錄後台匯出擴充的規則與驗收項目

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 驗證閘門

**Files:** 無新檔；依結果回填 Task 10 的 README 驗證段與 acceptance 狀態欄

> 全套由主 session 以背景執行（`run_in_background`），subagent 只跑單檔。**同時只跑一組**（8GB），跑全套前確認沒有別的 session 在跑 pytest／vitest／stack。

- [ ] **Step 1: 同步 main**

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo up-to-date || git merge origin/main
```

有衝突時以 main 已上線的做法為基底，只補本分支的功能。合併後若 `contracts/` 有衝突，重跑 `npm run contract:generate`。

- [ ] **Step 2: 後端全套（背景）**

```bash
cd backend
WEBSITE_TEST_DATABASE_URL=$TESTDB PYTHONUNBUFFERED=1 uv run --frozen pytest -q -o faulthandler_timeout=240 > ../output/exports-pytest.log 2>&1; echo "exit=$?" >> ../output/exports-pytest.log
cd ..
```

Expected: 結尾 `exit=0`。已知假失敗：台北週五 `test_booking_consent_readiness` 的場次同步（main 既有，日期相依）；若只有它紅，記在 README，不在本分支修。

- [ ] **Step 3: 後台、官網、契約**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix admin run typecheck; echo "admin typecheck exit=$?"
npm --prefix admin run test:unit; echo "admin vitest exit=$?"
npm --prefix web run typecheck; echo "web typecheck exit=$?"
npm run test:website; echo "web unit exit=$?"
npm run contract:check; echo "contract exit=$?"
```

Expected: 五個 `exit=0`。admin vitest 在別的 session 很忙時會有 5 秒逾時，單獨重跑失敗的檔案分辨。

- [ ] **Step 4: stack e2e 全套**

```bash
export E2E_DB_NAME=ivy_website_exports_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761
npm run e2e:build
npm run test:e2e:stack; echo "stack exit=$?"
```

Expected: 全過。已知間歇：`tests/stack/media.spec.ts`「素材庫上傳照片…發布到官網」整套跑時偶爾失敗，單獨重跑 `npx playwright test -c playwright.stack.config.ts tests/stack/media.spec.ts` 會過，屬 main 既有問題。

- [ ] **Step 5: 畫面檢查（桌機 1440、手機 390）**

在 stack 環境還開著時，用 Playwright 開 `/admin/admissions?campus=yihua&sy=all&tab=records`、`?tab=stats`、`/admin/audit`，各拍 1440×900 與 390×844，存 `output/playwright/exports-{records,stats,audit}-{1440,390}.png`。檢查「匯出 CSV」與範圍說明不壓字、頁面不橫向捲動（可用 `tests/stack/pages.ts` 的 `expectNoHorizontalOverflow`）。

- [ ] **Step 6: 回填文件並 Commit**

把實際數字寫進 README 的「驗證」行與 acceptance 的狀態欄。

```bash
git add README.md docs/website-admin/acceptance.md
git commit -m "$(cat <<'EOF'
docs: 後台匯出擴充驗證結果

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**合併上線由使用者決定（push main＝正式部署）。** 這個分支沒有 migration，不需要先備份正式 DB。

---

### Task 12: 成效統計匯出（等「成效統計補強」計畫合併後再做）

> **開工條件：** `git log origin/main --oneline -- admin/src/views/AnalyticsView.vue` 看得到 `2026-10-03-admin-analytics-phase1.md` 的提交已合併。還沒合併就停在這裡，不要先改 `AnalyticsView.vue`（兩邊會衝突）。

**Files:**
- Modify: `admin/src/views/AnalyticsView.vue`
- Test: `admin/src/__tests__/analyticsExport.test.ts`（新）

**Interfaces:**
- Consumes: `buildCsv`、`downloadCsv`、`csvFilename`（Task 2）；`campusLabel`（`labels.ts`）；`AnalyticsView.vue` 裡的 `dimensionRows`、`entryRows`、`periodLabel`、`dimension`（撰寫時在第 196–228 行）

- [ ] **Step 1: 盤點合併後畫面上的表格**

Run: `grep -n -E '<el-table|<table|StatsDimensionTable|<h2' admin/src/views/AnalyticsView.vue admin/src/components/SiteTrafficPanel.vue`

列出每張表、它的資料來源 computed 與欄名。撰寫時有兩張：「依來源／從哪裡知道」（`dimensionRows`）、「預約鈕點擊」（`entryRows`）。合併後若 analytics 計畫新增了表（例如五校並排、到場率），每張都照 Step 3 的寫法加一顆按鈕、欄名照畫面，並在 Step 2 的測試多加一個 `it`。

- [ ] **Step 2: 寫失敗的測試**

`admin/src/__tests__/analyticsExport.test.ts`：

```ts
// 成效統計匯出（2026-10-03 計畫 Task 12）：每張表的欄名與數字同畫面，取消率沒有值寫空白。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AnalyticsView from '../views/AnalyticsView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.mocked(downloadCsv).mockClear() })

const funnel = {
  counts: { request_created: 4, visit_confirmed: 3, visit_completed: 2, visit_cancelled: 1, booking_cta_clicked: 5, cta_click_line: 2, cta_click_phone: 1, cta_click_external: 0 },
  by_source: [{ source: 'web', counts: { request_created: 4, visit_confirmed: 3, visit_completed: 2, visit_cancelled: 1 } }, { source: 'phone', counts: { visit_confirmed: 1 } }],
  by_referral: [],
  clicks_by_entry: [{ entry: 'header', counts: { booking_cta_clicked: 5, cta_click_line: 2, cta_click_phone: 1 } }],
  unassigned_clicks: {},
  cancelled_by_reason: {},
}

async function mountAnalytics() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  const wrapper = mount(AnalyticsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('成效統計匯出 CSV', () => {
  it('「依來源」的欄名與數字同畫面；沒有送出需求的來源取消率寫空白', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) => Promise.resolve(String(url).includes('/admin/analytics/funnel') ? funnel : {}) as Promise<never>)
    const wrapper = await mountAnalytics()
    await wrapper.get('[data-test="analytics-csv-dimension"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toMatch(/^成效統計-依來源-義華-開站至今\.csv$/)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('﻿來源,送出需求,確認,完成,取消,取消率')
    expect(lines.some((line) => line.endsWith(',0,1,0,0,'))).toBe(true)
  })

  it('「預約鈕點擊」依合計排序輸出', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) => Promise.resolve(String(url).includes('/admin/analytics/funnel') ? funnel : {}) as Promise<never>)
    const wrapper = await mountAnalytics()
    await wrapper.get('[data-test="analytics-csv-entries"]').trigger('click')
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv.split('\r\n')[0]).toBe('﻿按鈕位置,預約表單,LINE,電話,外部網站,合計')
    expect(csv.split('\r\n')[1]!.endsWith(',5,2,1,0,8')).toBe(true)
  })
})
```

> `funnel` 物件要符合合併後的 `AnalyticsFunnelOut`；analytics 計畫若加了必填欄位，依它的測試 fixture 補齊。預設校區取 `useCampusScope()` 的第一個（super_admin 為義華），若合併後預設不同，檔名的正規式跟著改。

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/analyticsExport.test.ts`
Expected: FAIL，找不到 `[data-test="analytics-csv-dimension"]`

- [ ] **Step 3: 實作**

`AnalyticsView.vue` script 加：

```ts
import { campusLabel } from '../api/labels'
import { buildCsv, csvFilename, downloadCsv } from '../utils/csv'

// 匯出（2026-10-03）：只匯出畫面上這張表；取消率沒有值寫空白（不寫「—」）。
function exportDimension() {
  const title = dimension.value === 'source' ? '依來源' : '依得知管道'
  const header = [dimension.value === 'source' ? '來源' : '從哪裡知道', '送出需求', '確認', '完成', '取消', '取消率']
  const rows = dimensionRows.value.map((row) => [row.label, row.created, row.confirmed, row.completed, row.cancelled, row.cancelRate === '—' ? '' : row.cancelRate])
  downloadCsv(csvFilename('成效統計', title, campusLabel(campusKey.value), periodLabel.value), buildCsv(header, rows))
}

function exportEntries() {
  const header = ['按鈕位置', '預約表單', 'LINE', '電話', '外部網站', '合計']
  const rows = entryRows.value.map((row) => [row.label, row.form, row.line, row.phone, row.external, row.total])
  downloadCsv(csvFilename('成效統計', '預約鈕點擊', campusLabel(campusKey.value), periodLabel.value), buildCsv(header, rows))
}
```

（`campusLabel` 若已匯入就併進既有的 import。）template：「依來源」那個 `panel__head` 的 `<h2>依來源</h2>` 之後加 `<el-button v-if="dimensionRows.length" size="small" text data-test="analytics-csv-dimension" @click="exportDimension">匯出 CSV</el-button>`；「預約鈕點擊」的 `panel__head` 改成 `<div class="panel__head"><h2>預約鈕點擊</h2><el-button v-if="entryRows.length" size="small" text data-test="analytics-csv-entries" @click="exportEntries">匯出 CSV</el-button></div>`。

- [ ] **Step 4: 跑測試、更新文件、Commit**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/analyticsExport.test.ts src/__tests__/analyticsFunnel.test.ts; npm --prefix admin run typecheck`
Expected: PASS；typecheck 0 錯誤

把 acceptance 的 E11 改成實際狀態與證據，README 該段「未做」拿掉成效統計。

```bash
git add admin/src/views/AnalyticsView.vue admin/src/__tests__/analyticsExport.test.ts README.md docs/website-admin/acceptance.md
git commit -m "$(cat <<'EOF'
feat(admin): 成效統計的表格可以匯出 CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

全套驗證照 Task 11 Step 3 重跑 admin 那兩行；合併上線由使用者決定。

---

## 待決定（開工前問使用者，預設值已寫進計畫）

1. 招生明細、未預繳名單沿用「匯出個資」授權（預設），還是另開一項「匯出招生名單」授權（要改使用者頁、`GRANTABLE_CAPABILITIES`）？
2. 操作紀錄匯出要不要也寫一筆稽核（預設不寫）？要寫的話，要改成後端端點或加一個記錄用的 POST。
3. 招生規格 3.2「任何含個資的匯出不做」，確認由這次的選擇取代（預設是）。
