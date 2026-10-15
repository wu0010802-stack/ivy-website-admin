# 預約案件「排除」標記（測試／重複）（2026-10-15）設計

日期：2026-10-15
狀態：設計 10-15 經使用者核可（「只標預約案件」由使用者逐題選定）；規格待使用者審閱
基準：`origin/main` `aae0debc`（migration head `c6a9e3f15d27`；**本案新增一支 migration**）
分支（實作）：`feature/visit-exclusion-20261015`
上游：10-15 後台功能盤點，使用者選定六項之一（第 3 波，排在「預計入學時間」之後；兩案都動 `visit_requests`）。招生分析報告 §3.1 寫「測試或重複的案件，可以人工標示後排除。標記時要留原因、操作者，以及稽核紀錄」（`docs/analysis/2026-09-30-enrollment-analytics-report.md:96`）；成效統計第一期計畫把它列為「不在本計畫，要新欄位＋migration」（`docs/superpowers/plans/2026-10-03-admin-analytics-phase1.md:38`）。

## 1. 背景與目標

預約案件（`visit_requests`）沒有任何刪除功能，只能取消或等保存政策匿名化。同仁測試官網表單、家長重複送單留下的案件，會一直算進營運總覽、參觀預約統計、預約全程、場次使用情況。招生訪視本來就能刪除（`DELETE /admin/admissions/records/{id}`），所以這次只處理預約案件。

### 1.1 成功標準

1. 總管理者與校區管理者可以把一筆預約案件標為「排除」（原因：測試、重複、其他），也可以取消排除；案件時間線與操作紀錄都有記錄。
2. 被排除的案件不再算進 §3.3 列的統計與待辦數字，各統計的說明寫「已排除 N 筆」。
3. 案件列表照常看得到，加「已排除」標籤，可以篩掉。
4. 名額占用不變；被排除的案件不寄提醒。

### 1.2 裁定

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| E1 ✔ | 對象 | 只標預約案件；招生端不加 | 使用者 10-15 選定；招生訪視已能刪除 |
| E2 ✔ | 誰能標 | `booking.manage`（總管理者、校區管理者）＋校區範圍；櫃台不能 | 排除會改變統計，屬管理動作 |
| E3 ✔ | 原因 | 必選 `test`（測試）、`duplicate`（重複）、`other`（其他）；選「其他」要寫說明（≤200 字），前兩者說明選填 | 報告 §3.1 要求留原因 |
| E4 ✔ | 可以取消 | 「取消排除」把四個欄位清空，回到原本的統計 | 誤標要能回復 |
| E5 ✔ | 紀錄 | 案件時間線寫 `excluded`／`exclusion_removed` 事件（`after` 帶原因類別，說明放事件的 `reason`）；操作紀錄 `visit_request.exclude`／`visit_request.include`，metadata 只記原因類別 | 說明可能有人名，操作紀錄不放 |
| E6 ✔ | 不影響名額 | 排除不改狀態、不釋出名額；已確認且還沒到的案件，對話框提示「排除不會釋出名額；如果是測試預約，請一併取消」 | 名額是實際被占住的，靜默釋出會超賣 |
| E7 ✔ | 列表 | 照常顯示並加灰色「已排除・測試」標籤；篩選多「隱藏已排除」（網址參數 `excluded=hide`），預設不隱藏；CSV 加「已排除」欄 | 避免誤標的案件憑空消失 |
| E8 ✔ | 提醒 | 被排除的案件不排、不寄員工「即將參觀」與家長參觀提醒 | 測試預約常用同仁自己的 Email |
| E9 | 共用條件 | 新模組 `backend/app/booking/exclusion.py` 提供 `not_excluded()`（SQL 條件）與 `is_excluded(visit)`；§3.3 每一處都用它，不各自寫 `excluded_at IS NULL` | 預約端沒有共用 base query（約 15 處各寫 where），集中才不會漏 |
| E10 | 關聯的招生訪視 | 不動；明細頁對已排除且有招生訪視的案件顯示「這筆預約已排除，但招生訪視仍會算進招生統計；如果是測試資料，請到招生入學刪除訪視」 | E1 |
| E11 | 匿名化 | 原因類別保留；說明（`exclude_note`）隨保存政策清掉 | 說明是自由文字 |

### 1.3 不做

- 招生訪視的排除標記。
- 依電話或姓名自動判定重複（報告 :94 禁止只依電話自動合併）。
- 刪除預約案件、批次排除、排除時自動取消。
- 公開官網的任何改動。

## 2. 現況（`origin/main` `aae0debc`）

- 表 `visit_requests`（`backend/app/booking/models.py:97-`）：沒有排除類欄位；狀態 CHECK 只有 confirmed／completed／no_show／cancelled（:107-111）；招生訪視以 `recruitment_visits.visit_request_id` 連結（SET NULL）。
- 案件動作的寫法：`POST /admin/visit-requests/{id}/cancel` 等（`booking/routes.py:1508-`）用 `_lock_for_transition` 鎖列、`workflow_service` 執行、`_audit_transition` 寫操作紀錄；時間線 `booking/history.py:64` `record_event`（`event_type`、`before`、`after`、`reason`，`event_type` 是 String(32)、無 CHECK）。
- 保存政策 `operations/retention_service.py`：:179-185 清個資欄，:209 清時間線事件的 `reason`。
- 讀 `visit_requests` 算數字的地方（沒有共用 base query）：
  - 營運總覽 `operations/dashboard_service.py`：今天參觀 :53-76、待標記到場 :92、追蹤到期 :98、要處理 `needs_attention` :106（條件 `booking/attention.py:22`）、本週五校 `_week_campuses` :226-262。
  - 參觀預約統計 `operations/booking_outcomes_service.py`：`booking_outcomes` :75-151、班別 :154-175。
  - 預約全程 `admissions/journey.py` `load_cases` :228-270。
  - 場次使用情況 `booking/slot_usage.py:34-39`（用 `slot_service.occupying_condition`）。
  - 案件列表／頁籤數字／CSV：`booking/routes.py` `VisitRequestFilters.apply` :957-1000、列表 :1016、`view-counts` :1081-1096、匯出 :1151；頁籤條件 `booking/status_groups.py:22,47,71`、待處理 `booking/pending_kinds.py:28`。
  - 提醒 `notifications/reminders.py:93-116`。
  - 名額：`booking/slot_service.py:127` `occupying_condition`（送單容量、接待月曆、場次產生都用）。
  - 其他：停用分校的未結案件（`campuses/routes.py:76-80`）、切換預約方式前的確認數（`booking/readiness.py:128-133`）。

## 3. 設計

### 3.1 資料

- migration（`visit_requests`）：
  - `excluded_at TIMESTAMPTZ NULL`、`excluded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`、`exclude_reason VARCHAR(16) NULL`、`exclude_note VARCHAR(200) NULL`。
  - CHECK `exclude_reason IS NULL OR exclude_reason IN ('test','duplicate','other')`。
  - CHECK `(excluded_at IS NULL) = (exclude_reason IS NULL)`。
  - 不加索引（排除筆數極少，統計查詢以校區與日期篩選為主）。
- 保存政策匿名化時清 `exclude_note`（E11）。

### 3.2 API

- `POST /admin/visit-requests/{id}/exclude`：body `{reason, note?}`；`require_scope(user, "booking.manage")`＋校區範圍；已排除 → 409 `ALREADY_EXCLUDED`；`other` 沒有說明 → 422。鎖列方式同其他案件動作。寫時間線與操作紀錄（E5）。回 `VisitRequestDetailOut`。
- `POST /admin/visit-requests/{id}/include`：取消排除；未排除 → 409 `NOT_EXCLUDED`。
- `VisitRequestDetailOut`、列表項目加 `excluded_at`、`exclude_reason`、`exclude_note`（列表不回說明）。
- 列表與 CSV 篩選加 `excluded`（`hide`｜`only`｜不帶＝全部）；CSV 加「已排除」欄（空／測試／重複／其他）。

### 3.3 套用 `not_excluded()` 的地方

| 地方 | 套用 | 說明 |
|---|---|---|
| 營運總覽：今天參觀、待標記到場、追蹤到期、要處理 | 是 | 測試案件不該變成待辦 |
| 營運總覽：本週五校「已約／可約」 | **否**（**與 10-15 核可的設計摘要不同**：摘要把它列在排除範圍內，寫規格時改掉，待使用者確認） | 這兩個數字講的是名額；排除不釋出名額（E6），已約若扣掉會和可約對不起來 |
| 參觀預約統計（結果、班別） | 是 | 回應加 `excluded_count`，說明寫「已排除 N 筆」 |
| 預約全程 | 是 | 涵蓋說明加「已排除 N 筆」 |
| 場次使用情況 | 是 | 看的是家長需求；說明加「已排除 N 筆」 |
| 員工即將參觀提醒、家長參觀提醒 | 是（排入與寄出前都檢查） | E8 |
| 案件列表、頁籤數字、CSV | 否（用 `excluded` 篩選） | E7 |
| 名額占用（送單容量、接待月曆、場次產生） | **否** | E6 |
| 停用分校的未結案件、切換預約方式前的確認數 | 否 | 這兩處是營運安全檢查，看實際狀態 |

`exclusion.py` 的模組說明列出這張表；測試對每一處各寫一條（§4）。

### 3.4 畫面

- 案件明細：處理區的「更多」選單加「標記為排除…」，對話框選原因（單選三項）＋說明；已確認且未到的案件顯示 E6 提示。已排除時頁首下方一條灰色橫幅「已排除：測試（〇〇〇 10/15 標記）・取消排除」，有關聯招生訪視時加 E10 那句。
- 列表：灰色標籤；篩選列加「隱藏已排除」開關（寫進網址）。
- 時間線：`excluded`「標記為排除：測試」＋說明；`exclusion_removed`「取消排除」。
- 統計頁與預約全程的說明文字加「已排除 N 筆」（0 筆不顯示）。
- 中文對照（事件、操作紀錄動作、原因）放 `labels.ts`，`labelCoverage.test.ts` 比對。
- 櫃台看得到標籤與橫幅，但沒有「標記為排除」與「取消排除」。

## 4. 測試

- 後端：
  - migration CHECK：原因值、`excluded_at` 與原因同有同無。
  - 權限：櫃台 403；校區管理者只能標自己校區；總管理者可跨校。
  - 標記與取消：時間線、操作紀錄 metadata 不含說明；`other` 沒說明 422；重複標記 409。
  - §3.3 每一處各一條：建一筆一般案件與一筆排除案件，「是」的地方只算一筆、「否」的地方兩筆都在；取消排除後恢復。
  - 提醒：排除案件不排；排入後才排除的，寄出前 skipped。
  - 名額：排除一筆已確認案件後，同場次剩餘名額不變。
  - 列表 `excluded=hide|only`、CSV 欄位。
  - 匿名化清說明、保留原因。
- admin vitest：對話框（原因必選、其他要說明、E6 提示）、橫幅、標籤、篩選寫進網址、櫃台看不到按鈕。
- stack e2e：校區管理者把一筆案件標為測試 → 參觀預約統計少一筆、列表有標籤、隱藏後不見 → 取消排除後恢復。

## 5. 部署與風險

- 一支 migration（只加可空欄位與 CHECK），不需先備份。串接規則同「退出原因分類」規格 §5；排在「預計入學時間」之後合併。
- 風險：日後新增讀 `visit_requests` 的統計若忘了套 `not_excluded()`，數字會不一致；`exclusion.py` 的說明與測試是唯一防線，新統計的規格要寫明要不要套。

## 6. 與其他工作的關係

- 「參觀提醒信」（第 1 波）：若已合併，本案補上家長提醒的排除條件（E8）；若本案先合併，由提醒信那案補。
- 「預計入學時間」：同表不同欄，先做它。
