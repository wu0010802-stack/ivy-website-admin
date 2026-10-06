# 官網後台招生入學模組設計（比照園務系統）

日期：2026-09-30
狀態：草案，待使用者審閱；2026-10-01 實作計畫（總覽與 A／B／C 三份）的技術調整已回寫，對照表見第 17 節
對象：業主、接手實作的 Claude
基準：

| 系統 | repo | 讀取版本 |
|---|---|---|
| 官網 | `/Users/yilunwu/Desktop/ivy-website-admin` | `origin/main` `392a41c` |
| 官網預約改版 | 同上，分支 `feature/parent-self-booking-20260930` | `0be93ea`（已完成，尚未併入 main） |
| 園務後端 | `/Users/yilunwu/Desktop/ivy-backend` | `main` `dfd230c3` |
| 園務前端 | `/Users/yilunwu/Desktop/ivy-frontend` | `main` `150aae9c` |

本文件只規劃官網後台這一側的招生模組與轉移契約；不修改園務系統、不連園務資料庫。引用的園務行號以上表版本為準，實作時以當下內容為準。

**前置依賴**：本規格建立在「家長自選場次預約」改版之上（`docs/specs/2026-09-30-parent-self-booking-design.md`，分支 `feature/parent-self-booking-20260930`，`0be93ea`，2026-10-01 已完成實作、尚未併入 main）。該改版之後：
- 官網只剩家長自選場次、送出即預約成功（`confirmed`）。
- 後台只顯示預約正常、時間已過、已取消。
- 「標記已到場／未到場」改為場次結束後的次要按鈕。

本模組的分支疊在該改版分支上開發，不必等它併入 main（第 16 節）。

## 1. 背景與目標

官網後台是過渡系統，之後會併入 ivyManageSystem（園務系統）。園務系統已有「招生入學」（`#/students/admissions`）：參觀 → 預繳 → 註冊，退預繳／退註冊，名額規劃與統計分析。官網目前只有參觀之前的預約流程：家長自選場次，送出即預約成功，之後可能改期、取消、到場或未到。官網沒有參觀之後的招生追蹤。

目標：在官網後台做一套**招生流程與統計都比照園務設計邏輯**的招生模組，技術沿用官網既有架構（Nuxt／Vue 3 後台、FastAPI async、官網獨立 PostgreSQL），並讓將來併入園務系統時，招生資料可以幾乎逐欄轉移。

### 1.1 成功標準

1. 五校人員可在官網後台記錄參觀後的招生進度（已訪視、已預繳、已註冊、退預繳／退註冊），操作邏輯與園務招生入學一致。
2. 官網預約確認「已到場」後，自動出現在招生漏斗，不需人工重打；時間已過、還沒確認到場的預約，在招生頁有待辦清單，不會漏掉。
3. 可設定各校各學年學期、各年級的計畫名額，看到已保留、已註冊與剩餘。
4. 統計分析的指標定義與園務 `_visit_metric_cases` 一致；另有官網才需要的五校比較。
5. 官網 repo 內有一份對齊園務特定 commit 的轉移契約、匯出程式與 CI 檢查；匯出結果除「校區→租戶」「年級名稱→園務年級」「已註冊孩子接學生檔」三項對應外，不需人工改寫。

## 2. 已裁定事項

| 日期 | 裁定 | 來源 |
|---|---|---|
| 2026-09-30 | 目的：官網預約自動進漏斗、五校都能管招生、官網看得到招生成果、為併入先統一資料模型 | 使用者 |
| 2026-09-30 | 官網後台是過渡系統，招生流程與統計比照園務設計邏輯，不必用相同技術，但併入時資料要能快速轉移 | 使用者 |
| 2026-09-30 | 義華、仁武正式環境尚未使用園務招生入學；五校都從官網後台開始，併入時整批轉移 | 使用者 |
| 2026-09-30 | 第一版只做四塊核心：訪視明細、漏斗看板、名額規劃、統計分析；周邊功能先不做，但欄位照園務保留 | 使用者 |
| 2026-09-30 | 做法 A：照抄園務資料模型與統計公式，另建轉移契約＋匯出程式＋CI 檢查；園務端匯入程式併入時再寫 | 使用者 |
| 2026-09-30 | 表名直接沿用園務名稱；年級固定四個：幼幼班、小班、中班、大班 | 使用者 |
| 2026-09-30 | 預約改為家長自選場次、送出即成功；後台狀態精簡；資料庫七種預約狀態保留（另案規格 `2026-09-30-parent-self-booking-design.md` §1） | 業主 |
| 2026-10-06 | 招生訪視明細與未預繳名單開放含個資匯出（CSV），沿用 `booking.export` 授權，取代 3.2「任何含個資的匯出」不做；操作紀錄匯出不另寫稽核 | 使用者 |

## 3. 範圍

### 3.1 本次要做

- 招生資料表三張（第 5 節）與 Alembic migration。
- 招生狀態轉換、保留座位、名額計算、統計查詢（第 6–9 節）。
- 官網預約確認「已到場」時自動建立招生訪視；時間已過、尚未確認到場的預約列成待辦；既有已到場的預約可補建（第 6.1 節）。
- 後台「招生入學」頁：漏斗看板、訪視明細、名額規劃、官網預約、統計分析（第 10 節），分頁順序比照園務。
- 新 capability 與校區範圍授權（第 7 節）。
- 轉移契約、匯出程式、契約測試（第 12 節）。

### 3.2 本次不做

- Excel 匯入舊名單、區域熱點地圖與附近園所、競爭園所、招生獎金計算（2026-09-30 裁定延後）。
- 園務的月份登記表 `recruitment_months`、半年期統計快取 `recruitment_periods`、`expected_start_label` 自動解析、童年綠地專區統計（`chuannian_*`）、行政區統計。
- 統計 Excel 匯出、任何含個資的匯出。（**2026-10-06 起「任何含個資的匯出」已被使用者裁定取代**，見本節末註記；原文保留供追溯。）
- 園務端匯入程式、官網預約／CMS／帳號權限併入園務（併入另訂規格）。
- 過渡期與園務系統串接或同步；官網仍用獨立資料庫，不連 `ivymanagement`（沿用 `docs/specs/2026-09-19-website-admin.md` 第 17、39–40 行）。

> **2026-10-06 更新（使用者裁定，取代上面「任何含個資的匯出」）**：招生訪視明細與未預繳名單開放含個資匯出（後端產生的 CSV，含孩子姓名、電話、地址），沿用「匯出個資」授權 `booking.export`（另需 `admissions.read` 與校區範圍）、每次匯出寫稽核、一次最多 10,000 筆；統計表改提供 CSV，仍不做 Excel（.xlsx）。招生開關 `WEBSITE_ADMISSIONS_ENABLED` 關閉時兩個匯出端點一樣 404，Q1 裁定前正式站不會用到。規則見 DESIGN.md「後台匯出擴充（2026-10-06）」；這份 CSV 和第 12 節給園務匯入程式的 JSONL 匯出（`app/admissions/export.py`）是兩回事，後者不變。

### 3.3 與既有文件的關係

- `docs/analysis/2026-09-30-enrollment-analytics-report.md` 的**階段 2（附屬招生紀錄、招生目標、同批案件與來源成果）由本規格取代**，不另做。該報告的階段 1（整理既有預約資料）與階段 3（UTM 與表單成效）仍有效，但階段 1 需先套用 2026-09-30 審查意見（「待聯絡」定義、行號、交接工作樹與驗收紀錄位置等）。
- 本模組不串接園務，未違反 `docs/specs/2026-09-19-website-admin.md` 第 258、445 行「未來若串接需另訂 tenant 對應」「本輪不含園務招生整合」；併入時的 tenant 對應在第 12.4 節只列規劃，不實作。
- 與 `docs/specs/2026-09-30-parent-self-booking-design.md`：預約的建立、改期、取消、寄信、場次都以該規格為準，本模組只讀預約資料，並在「已到場」時建立招生訪視。本模組依賴它保留的 `completed`（已到場）與 `no_show`（未到場）兩個狀態。

## 4. 概念對照

| 概念 | 園務系統 | 官網（本規格） |
|---|---|---|
| 隔離單位 | 租戶 `tenant_id`＋RLS，一個租戶＝一間學校 | `campus_key`（五校）＋`user_campus_scopes`；併入時一校對應一個租戶 |
| 招生案件 | `recruitment_visits` 一筆＝一個孩子的一次參觀 | 同名同義；可連回一筆官網預約 `visit_requests` |
| 參觀前段 | 無（只有舊站 ivykids.tw 爬取同步，再人工「轉為訪視」） | `visit_requests`：家長自選場次、送出即成功；到場後轉為招生訪視 |
| 預約轉訪視的入口 | 「官網報名」分頁，每列「轉為訪視」 | 「官網預約」分頁，每列「已到場」「未到場」 |
| 已註冊 | 有學生檔（`students.recruitment_visit_id`），同步 `enrolled` 旗標 | 只有 `enrolled` 旗標＋註冊日期；沒有學生檔 |
| 年級 | `class_grades` 表（每租戶） | 固定四個名稱：幼幼班、小班、中班、大班 |
| 帶參觀老師 | `employees` 外鍵 | 官網後台帳號外鍵＋姓名快照 |
| 權限 | `RECRUITMENT_READ／WRITE／CONVERT` | `admissions.read／write／convert` |
| 跨校比較 | 無（單租戶） | 五校比較；併入後對應園務平台層跨租戶報表 |

## 5. 資料模型

新增模組 `backend/app/admissions/`（`models.py`、`schemas.py`、`service.py`、`stats.py`、`routes.py`），與既有 `booking/` 分開。三張表名稱與園務相同。欄位型別依官網慣例（uuid 主鍵、`timestamptz`），語意與園務一致。

### 5.1 `recruitment_visits`

「園務」欄為園務 `models/recruitment.py:29-121` 的欄位；「延伸」表示園務沒有、轉移契約另行處理。

| 欄位 | 型別 | 空值 | 園務 | 規則 |
|---|---|---|---|---|
| `id` | uuid PK | 否 | `id` Integer | 轉移時重新配發，歷程外鍵隨之重接 |
| `campus_key` | String(32) FK `campuses.key` | 否 | `tenant_id` | 校區範圍授權的依據 |
| `visit_request_id` | uuid FK `visit_requests.id` ON DELETE SET NULL，唯一 | 是 | 延伸 | 自動建立或補建時填入；一筆預約最多一筆招生訪視 |
| `month` | String(10) | 否 | `month` | 民國月份 `115.09`，由後端依 `visit_date`（台北日期）計算，不接受前端直送 |
| `seq_no` | String(10) | 是 | `seq_no` | 同校同月份內序號，後端遞增；同校同月鎖定後配號，（`campus_key`,`month`,`seq_no`）唯一 |
| `visit_date` | Date | 否 | `visit_date` String(50) | 官網存真正日期；匯出轉民國字串 `115.09.08` |
| `child_name` | String(50) | 否 | 同 | |
| `birthday` | Date | 是 | 同 | 手動新增時表單必填（同園務畫面），自動建立可缺 |
| `grade` | String(20) | 是 | 同 | 適讀班級；只接受四個年級名稱 |
| `phone` | String(100) | 是 | 同 | |
| `contact_name` | String(50) | 是 | 同 | 主要聯絡人（不一定是家長） |
| `address` | String(200) | 是 | 同 | |
| `district` | String(30) | 是 | 同 | 本次不填、不顯示；保留給之後的區域分析 |
| `source` | String(50) | 是 | 同 | 幼生來源，自由文字 |
| `referrer` | String(50) | 是 | 同 | 園務表單稱「介紹者」、統計稱「接待人員」，兩處沿用園務文案 |
| `deposit_collector` | String(50) | 是 | 同 | 收預繳人員 |
| `tour_guide_user_id` | uuid FK `users.id` ON DELETE SET NULL | 是 | `tour_guide_employee_id` | 延伸對應。API 可選填：指到不存在的帳號回 422 `TOUR_GUIDE_INVALID`；只帶帳號、沒帶姓名時以該帳號顯示名稱當快照。本次後台畫面不放這個欄位 |
| `tour_guide_name` | String(50) | 是 | 延伸 | 帶參觀老師姓名快照，轉移時用來對應園務員工 |
| `source_category` | String(30) | 是 | 同 | 只接受園務九類代碼（第 5.4 節）；NULL＝待歸類 |
| `has_deposit` | Boolean | 否，預設 false | 同 | 只能由狀態轉換改變 |
| `rides_bus` | Boolean | 否，預設 false | 同 | |
| `notes` | Text | 是 | 同 | |
| `parent_response` | Text | 是 | 同 | 電訪後家長回應 |
| `geocoding_consent_at` | timestamptz | 是 | 同 | 本次不提供勾選；保留給之後的熱點分析 |
| `no_deposit_reason` | String(60) | 是 | 同 | 只接受園務八類（第 5.4 節） |
| `no_deposit_reason_detail` | Text | 是 | 同 | |
| `enrolled` | Boolean | 否，預設 false | 同 | 只能由狀態轉換改變 |
| `enrolled_on` | Date | 是 | 延伸 | 註冊日期；`enrolled=true` 時必填（CHECK） |
| `transfer_term` | Boolean | 否，預設 false | 同 | 轉到其他學期 |
| `provisional_grade` | String(20) | 是 | `provisional_grade_id` | 保留座位的年級名稱；轉移時對應園務 `class_grades.id` |
| `target_school_year` | Integer | 是 | 同 | 民國學年 |
| `target_semester` | Integer | 是 | 同 | 1＝上、2＝下（CHECK） |
| `withdrawn_at` | timestamptz | 是 | 同 | 非空即落在「退預繳／退註冊」 |
| `withdrawn_from` | String(20) | 是 | 同 | CHECK `IN ('deposited','enrolled')` |
| `withdraw_reason` | Text | 是 | 同 | |
| `version` | Integer | 否，預設 1 | 延伸 | 樂觀鎖；每次編輯、轉換、保留座位都遞增 |
| `anonymized_at` | timestamptz | 是 | 延伸 | 保存政策用（第 11 節） |
| `created_at`／`updated_at` | timestamptz | 否 | 同（台北 naive） | 匯出轉台北時間 naive |

園務有、官網不建的欄位：`expected_start_label`（園務由備註 regex 衍生，轉移後由園務重算）。

索引：`(campus_key, month)`、`(campus_key, target_school_year, target_semester, provisional_grade)`、`(campus_key, has_deposit)`、`(campus_key, grade)`、`withdrawn_at`、`visit_request_id` 唯一、`(campus_key, month, seq_no)` 唯一。

### 5.2 `recruitment_event_log`

| 欄位 | 型別 | 園務 | 規則 |
|---|---|---|---|
| `id` | uuid PK | Integer | 轉移時重配 |
| `recruitment_visit_id` | uuid FK ON DELETE CASCADE | 同 | |
| `event_type` | String(40) | 同 | 第 5.4 節清單 |
| `from_stage` | String(20)，可空 | 同 | |
| `to_stage` | String(20) | 同 | |
| `reason` | Text，可空 | 同 | |
| `actor_user_id` | uuid FK `users.id` ON DELETE SET NULL | 同（園務 users） | 轉移時官網帳號沒有對應園務帳號，改記入 `metadata_json.website_actor` |
| `metadata_json` | JSON，可空 | 同（園務為 JSONB） | 官網慣例用 `sqlalchemy.JSON`，匯出內容相同 |
| `created_at` | timestamptz | 同 | |

不建 `student_id`（官網沒有學生檔）。

### 5.3 `grade_intake_targets`

| 欄位 | 型別 | 園務 | 規則 |
|---|---|---|---|
| `id` | uuid PK | Integer | |
| `campus_key` | String(32) FK | （經 `class_grades` 推導租戶） | |
| `grade` | String(20) | `grade_id` | 四個年級名稱 |
| `school_year` | Integer | 同 | 民國學年 |
| `semester` | Integer，預設 1 | 同 | CHECK `IN (1,2)` |
| `target_seats` | Integer，預設 0 | 同 | CHECK `>= 0` |
| `created_at`／`updated_at` | timestamptz | 同 | |
| `updated_by` | uuid FK `users.id`，可空 | 延伸 | |

唯一：（`campus_key`,`grade`,`school_year`,`semester`）。沒有列＝「未設定」，與「計畫名額 0」分開顯示。

### 5.4 列舉值（照園務原文，契約測試鎖定）

- 年級：`幼幼班`、`小班`、`中班`、`大班`（園務 `GRADES_ORDER`；官網班別對照的「小一」不列入）。
- 未預繳原因（園務 `api/recruitment/shared.py:43-52`）：`時程未到／仍在觀望`、`已有其他就學選項／比較他校`、`未註明／待追蹤`、`距離／地點因素`、`家庭照顧安排考量`、`特殊需求／名額限制`、`課程／環境仍在評估`、`費用考量`。優先度分組同 `shared.py:59-75`。
- 來源分類代碼（園務 `models/recruitment_bonus.py:51-61`）：`sibling_current`、`sibling_split`、`sibling_graduate`、`self_report`、`referral`、`invite_success`、`invite_origin`、`home_deposit`、`returning`；顯示文案同園務。
- 事件類型：
  - 園務現有：`deposit_added`、`deposit_removed`、`converted`、`revert_converted`、`withdrawn`、`withdraw_cancelled`、`seat_reserved`、`seat_released`（`services/recruitment_funnel.py`、`services/recruitment_intake_plan.py:231`）。
  - 官網延伸：`created`（`metadata_json.origin` 為 `visit_request` 或 `manual`）。匯出時不轉，建立時間以 `recruitment_visits.created_at` 為準。
- 階段：`visited`、`deposited`、`enrolled`、`withdrawn`。

## 6. 流程與狀態

### 6.1 建立招生訪視

> 2026-10-05 更新：招生入學的「官網預約」分頁已拿掉，確認到場改在參觀案件列表（DESIGN.md「拿掉官網預約分頁」）；已到場家庭的參觀後處理改在預約明細的家庭版面（`docs/specs/2026-10-05-visit-family-page-design.md`）。下面描述的分頁不再存在。

預約改版後，大部分預約會停在 `confirmed`，場次時間一過就顯示「預約時間已過」。「標記已到場」只是次要按鈕，沒人按就永遠不會變成 `completed`。所以招生模組不能只被動等「已到場」，要主動列出待確認的預約。

1. **確認已到場時自動建立**：預約從任何入口標成 `completed`（案件明細「標記已到場」，或招生頁「官網預約」分頁的「已到場」），`workflow_service.mark_completed` 都在同一個交易內建立一筆招生訪視；該預約已有招生訪視則略過。
   - 交易邊界：`mark_completed`（預約改版 `workflow_service.py:227`）只 `flush`，由路由 `routes.py:1502-1522` commit。招生 service 在 `_close` 之後、`flush` 之前呼叫，不得自行 commit。招生建立失敗時整個「標記已到場」回滾，不會出現已到場卻沒有招生訪視的半套狀態。
   - 後端已限制「場次開始後才能標記」（`_require_visit_started`，`workflow_service.py:201`）。
   - 這是確認到場的附帶效果，操作者只需要既有的 `booking.handle`，不另外檢查招生權限。
   - 欄位對應如下：
     - `campus_key`、`visit_request_id`：取自預約。
     - `visit_date`：場次日期。後端對沒有場次的案件不擋標記，萬一遇到，取確認當天的台北日期；但後台畫面對沒有場次的案件不顯示到場按鈕，正常操作不會走到。
     - `child_name` 取孩子姓名；預約未填則寫「（未填姓名）」，在明細標示待補。預約的孩子姓名、家長稱呼最長 64 字，招生的 `child_name`、`contact_name` 對齊園務 50 字：自動建立時截斷到 50，不報錯。
     - `birthday` 取孩子生日；`phone`、`contact_name` 取家長手機與稱呼。
     - `source`：家長勾選的「從哪裡知道我們」（`referral_sources`），照後台顯示文案（Facebook、Google 評論、媽媽社團、親友介紹、其他）以「、」串接，最長約 31 字；保留 50 字截斷作防線。
     - `grade`：有生日時依第 6.4 節規則，按目標學年換算。
     - `target_school_year`／`target_semester`：填入確認當下的台北學期，同園務建立時補當前學期的做法（`api/recruitment/records.py:245` 起）。
     - `notes`：預約的「想了解的事」（`questions`，最長 500 字），前綴「家長想了解：」。
     - 寫一筆 `created` 事件。
   - 預約改版後，家長可以在截止前自行修改孩子姓名、生日等資料。確認到場一定在場次開始之後，已經過了修改截止時間，所以複製的是最後版本，之後不需要同步。
   - 家長 Email 不複製：園務招生沒有 Email 欄位，保持逐欄對齊。需要時從連結的預約查看；預約依保存政策匿名化後就不再保留。
2. **官網預約待確認清單**（新分頁，比照園務「官網報名」分頁）：
   - 列出授權校區中，`confirmed` 且場次已開始、還沒確認到場的預約。直接複用預約改版 `backend/app/booking/status_groups.py` 的 `group_condition('past')`，再排除 `completed`、`no_show`；不要另寫一套「已開始」判斷。
   - `confirmed` 但沒有場次的案件不在 `past`，本清單也不列（見第 16 節，預約改版的已知小問題）。
   - 每列兩個動作：
     - 「已到場」：呼叫既有 `/complete`，觸發第 1 點。
     - 「未到場」：呼叫既有 `/no-show`，不建立招生訪視。
   - 兩者都需要 `booking.handle`。
   - 另列「已到場但沒有招生訪視」的舊預約（本模組上線前已標 `completed`，或招生訪視被刪除），每列「建立招生訪視」。規則同第 1 點，需要 `booking.read` 與 `admissions.write`，重複呼叫回傳同一筆。只接受 `completed` 且未匿名化的預約：其他狀態回 409 `VISIT_REQUEST_NOT_COMPLETED`，已匿名化回 409 `VISIT_REQUEST_ANONYMIZED`；清單也排除已匿名化的預約。舊預約可能沒有場次（`slot_date`、`start_time` 為 null），補建時訪視日期用補建當天（台北）。
3. **手動新增**：沒有預約的現場參觀，從招生頁新增。
   - 電話來問的家長，照預約改版由園方在後台「補登」並選場次，到場後走第 1 點。
   - 補登不能選已開始的場次，所以已經到場的現場參觀只能在這裡手動新增。
   - 必填：參觀日期、幼生姓名、生日、入學學年學期（同園務表單）。
   - 提供「儲存並新增下一筆」，入學學年學期沿用上一筆。
   - 預繳、註冊、退出不在表單內設定，只能走狀態轉換（同園務 `stateLocked`）。

已取消、未到場的預約不建立招生訪視，漏斗從「已訪視」開始，與園務一致。

### 6.2 階段推導

與園務 `derive_stage`（`services/recruitment_funnel.py:70-81`）相同，只把「有學生檔」換成 `enrolled` 旗標：

1. `withdrawn_at` 非空 → `withdrawn`
2. `enrolled = true` → `enrolled`
3. `has_deposit = true` → `deposited`
4. 其他 → `visited`

### 6.3 狀態轉換

單一端點處理，依起訖階段檢查權限與必填（對照園務 `api/recruitment/funnel.py:158-172`、`services/recruitment_funnel.py:235-580`）。

| 起 → 迄 | 畫面動作 | 權限 | 必填 | 欄位變化 | 事件 |
|---|---|---|---|---|---|
| visited → deposited | 標記預繳 | write | 收預繳人員選填 | `has_deposit=true` | `deposit_added` |
| deposited → visited | 取消預繳 | write | 確認 | `has_deposit=false` | `deposit_removed` |
| deposited → enrolled | 標記註冊 | convert | 註冊日期（預設今天）、年級、目標學年學期 | `enrolled=true`、`enrolled_on`、未保留座位時寫入 `provisional_grade` 與目標學年學期 | `converted`（`metadata_json.website_manual=true`） |
| enrolled → deposited | 取消註冊 | convert | 原因 | `enrolled=false`、`enrolled_on=NULL` | `revert_converted` |
| enrolled → visited | 取消註冊並取消預繳 | convert | 原因 | 上列＋`has_deposit=false` | `revert_converted`＋`deposit_removed` |
| deposited → withdrawn | 退預繳 | write | 原因 | `has_deposit=false`、`withdrawn_*` | `withdrawn` |
| enrolled → withdrawn | 退註冊 | convert | 原因 | `enrolled=false`、`enrolled_on=NULL`、`has_deposit=false`、`withdrawn_*` | `withdrawn` |
| withdrawn → visited／deposited | 取消退出 | write | 確認 | 清空 `withdrawn_*`，`has_deposit` 依目標階段 | `withdraw_cancelled` |
| visited → enrolled、visited → withdrawn、withdrawn → enrolled | 不允許 | — | — | 回 422 `TRANSITION_NOT_ALLOWED` | — |

- 以列鎖＋`expected_version` 處理並行；版本不符回 409 `RECRUITMENT_VISIT_VERSION_CONFLICT`（帶 `current_version`），畫面重新載入看板（同園務收到 409 強制重載）。路由先比對版本、再判斷權限：別人剛改過的卡片一律 409，不會因為卡片已換欄而誤回 403。
- 不允許的轉換回 422 `TRANSITION_NOT_ALLOWED`（請求內容不合法，附中文說明，visited→withdrawn 用園務原文）。同階段轉換（X→X）也是這個碼（園務是 409 `STAGE_ALREADY`；版本先比對，只有同版本送同階段才會走到）。預約既有的 `INVALID_TRANSITION` 是 409（狀態剛被別人改了），兩者不混用。
- 缺必填欄位回 422 `TRANSITION_FIELDS_REQUIRED`（帶 `fields`，值是 `reason`、`grade`、`target_school_year`）。
- 已匿名化的訪視（`anonymized_at` 有值）不能編輯、轉換狀態、保留座位，一律回 409 `RECRUITMENT_VISIT_ANONYMIZED`；刪除可以。
- 標記註冊：`grade`、`target_school_year` 沒給時用保留座位與訪視上的值，都沒有才回 `TRANSITION_FIELDS_REQUIRED`；給了就覆寫 `provisional_grade` 與 `target_*`（註冊的年級為準，同園務以班級年級為準）；學期沒給用訪視上的、再沒有用 1；`enrolled_on` 沒給用台北今天，民國年須在 100–200（同參觀日期）。`converted` 事件 `metadata_json` 是 `{"website_manual": true, "grade", "school_year", "semester"}`。取消註冊與退註冊不清 `provisional_grade`；取消退出回已預繳時，保留座位仍在。
- 園務退註冊還需要 `STUDENTS_WRITE`，並會刪除學生檔；官網沒有學生檔，只需 `convert`。
- 園務的預繳對帳警示（`active_prepayment_needs_refund`）與同名同生日學生檢查不適用，不移植。

### 6.4 年級換算

新增後端 helper，規則與兩邊現有實作等價：

- 園務 `ivy-frontend/src/constants/recruitment.ts:23-32`：學年 N 以西元 (N+1911)/9/1（含）為足歲基準，2 歲幼幼班、3 歲小班、4 歲中班、5 歲大班。
- 官網 `web/app/utils/admission-classes.ts`：屆別 Y＝民國 Y/9/2～Y+1/9/1 出生，學年度減屆別 3＝幼幼班。

兩者在 9/1、9/2 等邊界結果相同。用一份共用的 JSON 測試案例鎖定：9/1、9/2 生日，學年切換日 7/31、8/1，以及範圍外生日。案例放在 `contracts/ivy-recruitment/grade-cases.json`，形狀 `{"cases": [{"name", "birthday", "today", "expected_term": [學年, 學期], "expected_grade": 年級或 null}]}`（年級用 `expected_term` 的學年換算）；後端 pytest、web vitest、admin vitest 三邊都讀這份。只在表單的「適讀班級」為空、或上次是自動帶入時才覆寫，並提示「已依生日 × N 學年自動判定，可手動修改」（同園務）。

學期規則同園務 `utils/academic.py::term_bounds`：上學期 8/1～隔年 1/31，下學期 2/1～7/31，一律以台北日期判斷。

### 6.5 保留座位

同園務 `services/recruitment_intake_plan.py:200-235`：

- 只有已預繳、未註冊、未退出的訪視可以保留。
- 保留時必須指定年級與目標學年，學期預設上學期。
- 寫 `seat_reserved`；清除保留寫 `seat_released`。釋放沒有保留的訪視回 422 `SEAT_NOT_ALLOWED`（「這筆訪視目前沒有保留座位」）。兩種事件的 `from_stage`／`to_stage` 寫當下的階段（園務固定寫 `deposited`），`metadata_json` 是 `{"grade", "school_year", "semester"}`，年級存名稱、不是 id。
- 已註冊的訪視不可清除保留，要改年級或學期請先取消註冊。
- 超過計畫名額只警示、不阻擋：回應 `SeatOut = {visit, capacity_warning, warning_code}`，超額時 `warning_code` 是 `SEAT_CAPACITY_WARNING`（在回應裡，不是錯誤）。

### 6.6 編輯與刪除

- 編輯：狀態欄位（`has_deposit`、`enrolled`、`enrolled_on`、`withdrawn_*`）不可編輯，其餘欄位需帶 `expected_version`。建立、編輯、狀態轉換、座位、計畫名額的請求 schema 一律 `extra="forbid"`：送 `has_deposit`、`enrolled`、`enrolled_on`、`withdrawn_*`、`provisional_grade`、`month`、`seq_no` 得到標準 422（`loc` 指到該欄位）。
- 建立與編輯不收 `district`、`geocoding_consent_at`（本次不填）；編輯不能把 `child_name`、`visit_date`、`target_school_year`、`target_semester` 清成 null（422）；生日不能晚於今天。編輯把參觀日期改到別的月份時，`month` 跟著換，並在新月份的鎖內重新配 `seq_no`（舊序號在新月份可能已被用掉）。
- 刪除：需要 `admissions.write`，歷程一併刪除（同園務）。刪除「已註冊」或「從已註冊退出」的訪視另需 `admissions.convert`（官網沒有學生檔，刪除等於撤銷註冊紀錄；缺權限回 403）。另寫一筆官網稽核紀錄 `audit_log_entries`：記動作、操作者、校區、訪視 id，不記姓名電話。
- 自動建立的訪視被刪除後，可從預約詳情再補建。

## 7. 權限

新增 capability（`backend/app/auth/permissions.py` 的 `_CAPABILITY_ROLES`，同步 `test_permission_table.py`）：

| capability | 預設角色 | 用途 | 對應園務 |
|---|---|---|---|
| `admissions.read` | super_admin、campus_admin、reception | 看招生頁、統計、名額 | `RECRUITMENT_READ` |
| `admissions.write` | super_admin、campus_admin、reception | 新增／編輯／刪除訪視、預繳與退預繳、保留座位、設定計畫名額 | `RECRUITMENT_WRITE` |
| `admissions.convert` | super_admin、campus_admin | 標記註冊、取消註冊、退註冊 | `RECRUITMENT_CONVERT` |

- 每個 API 都用 `require_scope(user, capability, [campus_key])`：capability 不符回 403，越權校區回 404。以訪視 id、預約 id 直接存取時也照此檢查。`campus_key` 不在五校內時，總管理者也回 404（不是空清單或外鍵錯誤）。
- editor、readonly 沒有招生權限；招生統計含孩子姓名（未預繳名單）、接待人員名字與來源原文，不開給只有 `analytics.read` 的角色。統計回應（`/stats`、`/compare`）只有數字；未預繳名單由 `GET /no-deposit-records` 提供（對應園務 `/no-deposit-analysis`），權限同其他招生 API（`admissions.read`＋校區範圍），每列只回畫面要的欄位，不含電話、地址、生日。
- 五校比較只列使用者授權範圍內的校區；super_admin 為五校。
- 前端一律用 `usePermissions().can(...)`，不抄角色表。

## 8. 名額規劃

依園務 `compute_intake_plan`（`services/recruitment_intake_plan.py:64` 起）逐項比照。條件：校區 × 學年 × 學期。每個年級一列：

- **計畫名額**：`grade_intake_targets.target_seats`；沒有列顯示「未設定」。
- **已保留**：`has_deposit=true`、`enrolled=false`、`provisional_grade` 為該年級，且目標學年學期相符。退出時 `has_deposit` 已清為 false，所以不會被算入。
- **已註冊**：`enrolled=true`，年級取 `COALESCE(provisional_grade, grade)`，且目標學年學期相符。這對應園務的「未編班」路徑；官網沒有班級，所以沒有「已編班」路徑。
- **剩餘**：計畫名額 − 已保留 − 已註冊；計畫未設定時不算剩餘。
- **超額**：已保留＋已註冊 > 計畫名額時標示，只警示。
- **合計**：回應另有 `totals`：計畫名額與剩餘只加總有設定計畫的年級（一個都沒設定是 null，畫面「未設定」；計畫 0 也算有設定），已保留、已註冊加總全部年級。`transfer_term` 不影響名額（同園務 `compute_intake_plan`）。

標記註冊時必填年級與目標學年學期（第 6.3 節），所以已註冊的訪視一定歸得進某一列。園務在未保留座位也未編班時，會因 inner join 少算，官網沒有這個情況。

## 9. 統計分析

依園務 `api/recruitment/stats.py::_query_stats` 與 `shared.py::_visit_metric_cases` 移植。

### 9.1 篩選

- 校區：單校；有多校權限者另可進五校比較。
- 入學學年、學期：篩 `target_school_year`、`target_semester`，同園務。
- 參考月份：預設最新有資料的月份，同園務 `_select_reference_month`。

### 9.2 指標

| 指標 | 定義 |
|---|---|
| 參觀 `visit` | 筆數（含已退出） |
| 預繳 `deposit` | `has_deposit=true` |
| 註冊 `enrolled` | `enrolled=true` |
| 轉學期 `transfer_term` | `transfer_term=true` |
| 有效預繳 `effective_deposit` | 預繳且未轉學期 |
| 預繳未註冊 `pending_deposit` | 預繳、未註冊、未轉學期 |
| 唯一幼生 `unique_visit`／`unique_deposit` | 以「姓名｜生日」去重；已匿名化的列以列 id 計（匿名化後姓名與生日都被清掉，照「姓名｜生日」會把不同孩子併成同一個），所以同一個孩子的一筆訪視匿名化後，唯一幼生會由 1 變 2 |
| 參觀→預繳率 | deposit ÷ visit |
| 參觀→註冊率 | enrolled ÷ visit |
| 預繳→註冊率 | enrolled ÷ deposit |
| 有效預繳→註冊率 | enrolled ÷ effective_deposit |

比率計算到小數一位。**與園務不同**：分母為 0 時回 `null`，畫面顯示「—」。園務會回 0，會把「沒有資料」誤看成「轉換率零」。這一點、月比任一邊是 null 時差值也是 null（園務會算成 100.0－0）、同票排序加第二鍵「標籤字串升序」（園務只有單鍵、同票順序不固定）、唯一幼生對匿名化的列以列 id 計，以及第 9.3 節不移植來源別名，都記入轉移契約，併入時由園務決定是否跟進。

### 9.3 維度與區塊

- **總覽**：
  - 主管決策摘要：本月看參考月份；近 30 天、近 90 天依 `created_at` 計算，同園務 `stats.py:502-507`；年度累計同園務。
  - 月比變化、本月漏斗快照、月度明細、年度統計，以及「本範圍合計」（六個計數、唯一幼生與四個比率）。園務的兩張圖（月度量體、轉換率走勢）由月度明細表的 CSS 長條取代；「全管道彙整」是園務自家官網報名，不做。
  - 異常警示與行動入口：逐條移植園務 `shared.py` 的規則與門檻，包括逾期 14 天、冷名單 90 天、掉點 10 個百分點、高潛力積壓 5 筆、行動清單 3 筆。官網的 `target_tab` 是 `records`（訪視明細，帶 `month`）、`nodeposit`、`source`（園務是 `detail`／`nodeposit`／`area`）；園務的「查看區域機會」（`AREA_OPPORTUNITY`）改成「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現（官網不做行政區，`district` 不填）。
- **班別分析**：依 `grade`，含月份 × 班別。
- **來源分析**：依 `source`；介紹者 × 來源交叉表放在「接待分析」（同園務 `RecruitmentStaffTab`，介紹者就是接待人員）。園務的來源別名合併表 `_SOURCE_GROUP_ALIASES` 是義華專屬字詞，本次不移植，改依原文分組。
- **接待分析**：依 `referrer`，同園務 `RecruitmentStaffTab`。
- **未預繳原因**：依 `no_deposit_reason`，含優先度分組。母體是「未預繳且未退出」：退預繳後 `has_deposit` 雖然是 false，殘留的高潛力原因不算。數字卡（高潛力未預繳、逾 14 天待追、冷名單）與分布來自 `/stats`。
  - **未預繳明細**（名單，同園務 `RecruitmentNoDepositTab`）：母體同上。篩選：轉換潛力（預設「高潛力優先」，另有全部潛力、中潛力、低潛力）、原因、班別、「逾 14 天」開關、「冷名單」開關；每頁 50 筆。欄位：月份、姓名、班別、原因分類、轉換潛力（高／中／低／—）、冷名單（參觀滿 90 天標「冷」；2026-10-06 起逾期與冷名單都看參觀日，園務看建檔時間）、說明、來源、介紹者、電訪回應，另有「查看」切到訪視明細並篩該筆的月份。排序：民國月份新到舊、同月序號依數字小到大（園務是字串排序）。警示與行動入口指到未預繳原因時，帶的潛力與逾期天數套進名單（同園務）。已匿名化的列不另標示（姓名欄已是「（已依保存政策匿名化）」），列為已知限制。
- **五校比較**（官網延伸）：授權範圍內每校一列，列出參觀、預繳、註冊、有效預繳、預繳未註冊、四個比率，以及名額剩餘合計。
  - 名額剩餘合計只加總已設定計畫名額的年級；一個年級都沒設定時顯示「未設定」。
  - 學年跟頁首，沒選學年用目前學年（台北日期）。件數跟頁首學期：沒選學期就算整學年（和總覽對得起來）。名額規劃是逐學期設定，名額剩餘要對到單一學期：頁首有選學期用該學期，沒選用上學期（同「名額規劃」，第 6.5 節的預設），實際用的學期由回應的 `seat_semester` 告知。表格上方依回應寫明，例如「件數為 115 學年整學年；名額剩餘為 115 上學期（同名額規劃）。」「件數與名額剩餘都是 115 下學期。」；頁首沒選學年時句首加「頁首沒選學年，用目前的 115 學年。」。
  - 比率同時顯示分子與分母。
  - 標示這是「招生案件數」，不是跨校去重後的孩子數。

不做：區域分析、童年綠地專區、預計就讀月份（依賴未移植欄位）、Excel 匯出。

### 9.4 與 `/admin/analytics` 的關係

招生統計放在新的招生入學頁，現有分析頁不變。之後依招生分析報告階段 1 再決定是否在分析頁放摘要與連結。

## 10. 後台畫面

路由 `/admin/admissions`，側欄新增「招生入學」（`router/nav.ts`），放在「參觀預約」組、「參觀場次」之後，圖示 `TrendCharts`，需要 `admissions.read`。功能開關（`WEBSITE_ADMISSIONS_ENABLED`）關閉時側欄與側欄搜尋不列出這項：`/auth/me` 與登入回應帶 `features.admissions`，`nav.ts` 項目的 `feature` 欄位對應；路由守衛不擋，直接開網址仍到「招生入學尚未啟用」說明頁。頁首放校區選擇（沿用 `CampusSelect`）與入學學年學期篩選。篩選和分頁同步到 URL query（`campus`、`sy`〔`all`＝不限學年〕、`sem`、`tab`；另有 `vr`＝只看某筆預約的招生訪視，給預約明細的連結用；`month`＝訪視明細的月份〔民國月份 `115.09`，格式不對就丟掉〕，統計的警示與行動入口會帶；`sub`＝統計分頁的子分頁〔`class`／`source`／`staff`／`nodeposit`／`compare`，只在統計分頁使用，總覽不寫進網址，不合法或看不到就退回總覽〕），比照園務 `useAdmissionsTermFilter`。切換校區或學期時，用既有的 `useRequestSequence` 忽略舊回應。

| 分頁 | 內容 |
|---|---|
| 漏斗看板 | 已訪視、已預繳、已註冊、退預繳／退註冊四欄，上方摘要列顯示各欄數量與三個比率。卡片顯示幼生姓名、年級、入學學期、來自官網預約的標記。拖曳換欄，也能用鍵盤：卡片選單「移到…」。各轉換跳對應確認框（第 6.3 節）。另提示「另有 N 筆沒有填入學學期」，可跳到明細。點卡片開歷程抽屜。 |
| 訪視明細 | 篩選：月份、班別、來源、介紹者、預繳是／否、未預繳原因、關鍵字；入學學年學期用頁首的共用篩選，不在明細重複，「清除篩選」連學年學期一起清（同園務）。表單與明細不放來源分類（`source_category`）、帶參觀老師、娃娃車（`rides_bus`）、地址分析同意（欄位照存、照匯出）。**2026-10-05 裁定**：照園方紙本「幼兒基本資料」把來源分類、帶參觀老師（只打名字，不選帳號）、娃娃車放回表單（明細表格仍不列欄，放進展開列），另加英文名字、父親職業、母親職業（官網延伸，園務沒有）；地址分析同意仍不放。表格每頁 50 筆。列操作：編輯、歷程、標記註冊（有 convert 且已預繳未註冊才顯示）、更多（保留座位、退出、刪除）。編輯表單分區同園務：基本資料、聯絡與來源、預繳狀態、備註。有連結預約的，顯示「查看預約」。 |
| 名額規劃 | 選學年學期；每個年級可編輯計畫名額，顯示已保留、已註冊、剩餘、超額警示。 |
| 官網預約 | 第 6.1 節第 2 點的待確認清單。欄位：場次（「上午場 10:00」格式，import 預約改版的 `admin/src/utils/sessions.ts`，不另寫一份）、家長稱呼、孩子姓名、參觀人數。每列「已到場」「未到場」「查看預約」。分頁標籤顯示待確認筆數。下方另一區是「已到場但沒有招生訪視」，每列「建立招生訪視」。 |
| 統計分析 | 子分頁：總覽、班別分析、來源分析、接待分析、未預繳原因；多校權限者另有「五校比較」。本次以表格加 CSS 長條呈現，不新增圖表套件。另有「參考月份」選單（預設最新有資料的月份）。警示與行動入口指到統計內的子分頁就直接切過去；指到訪視明細就切到「訪視明細」並帶 `month`（`router.push`，上一頁回到統計）。「未預繳原因」另列「未預繳明細」名單（第 9.3 節），每列「查看」同樣切到訪視明細並帶該筆的月份（明細只吃 `month`、`vr`，沒有單筆連結）。 |

- 預約詳情頁：已連結招生訪視時顯示連結；已到場但尚未建立的，顯示「建立招生訪視」。「標記已到場」目前沒有確認框（預約改版 `VisitDetailView.vue:513` 直接送出），新增一個確認框：「標記已到場？會同時建立一筆招生訪視，之後在招生入學頁追蹤。」
- 各區塊沿用後台既有的 loading、空資料、錯誤、衝突提示規範。沒有資料時說明原因，不顯示假的 0。
- 園務文案照抄，但提到學生檔、監護人、學號、學費管理、班級的改寫成官網的說法（官網沒有學生檔與學費模組）：事件 `converted` 寫「標記註冊」、`revert_converted` 寫「取消註冊」，並補上園務缺的 `seat_reserved`「保留座位」、`seat_released`「釋放保留」，歷程不露英文代碼。其餘畫面細節見第 10.1 節。
- 手機 390px：看板四欄改成直向堆疊，表格可受控橫捲，頁面不能整體溢出。

## 10.1 畫面細節（實作回寫，2026-10-01）

實作計畫 B 階段對第 10 節的補充與調整；每條對應第 17 節的一列。

- **篩選與網址**（B15、B16）：訪視明細的月份篩選與網址 `month` 雙向同步；「清除篩選」連 `month`、`vr`、學年學期一起清。`useAdmissionsFilters` 一頁只能有一份（兩份會互相改寫網址），所以 `RecordsTab` 只吃 props（`campusKey`、`schoolYear`、`semester`、`month`、`visitRequestId`），用 `update:month`、`update:visitRequestId`、`clear-term` 往上改。
- **表單送出**（B17）：新增不送狀態欄位與 `month`、`seq_no`、`provisional_grade`；編輯只送改過的欄位與 `expected_version`（後端以 `model_fields_set` 區分沒送與清空）；生日只在新增時必填（預約到場自動建立的訪視可能沒有生日，改備註不能被擋）；收預繳人員只在已預繳時可改，未預繳原因只在未預繳時出現。
- **看板與名額規劃的學年學期**（B18）：頁首「不限學年」時，兩者都用目前學年；名額規劃在頁首沒選學期時用上學期；兩者都在畫面寫明。
- **新增訪視的入口**（B19）：看板工具列（右上角）與明細面板頭都有「新增訪視」，共用同一個表單；看板「已訪視」空欄文案（園務原文）叫使用者用右上角的「新增訪視」。
- **看板摘要列的三個比率**（B20）：照園務用各欄目前張數相除：預繳率＝已預繳 ÷ 已訪視、註冊率＝已註冊 ÷ 已預繳、退費率＝退出 ÷ 已註冊（名稱照抄，滑鼠移上去寫公式）；分母 0 顯示「—」（園務顯示 0）。「退費率」易誤讀，列入待決定。
- **官網預約分頁**（B21、B22、B32）：每次讀完清單就把筆數交給頁面更新分頁標籤（標記到場後標籤立刻少一筆）；標籤數字用 `awaiting_total`；超過 200 筆時清單上方寫「只列最近 200 筆，共 N 筆」。預約明細的「招生訪視」連結是 `/admissions?campus=…&tab=records&vr=…&sy=all`：到場當下寫入的入學學期不一定是頁首預設學年（例如 7 月到場是上一學年下學期），不帶 `sy=all` 會被學年篩掉。
- **名額規劃的超額**（B24）：整列淡紅之外另加「超過計畫名額」標籤；保留座位成功但 `capacity_warning` 為真時跳提醒框（文案自擬，列入待決定）。
- **保存政策欄位**（B25）：「招生訪視」放在「未結案提醒」之後、「每天自動清理」之前；試算與清理紀錄只在回應有 `admissions` 時列出（舊紀錄的文字不變）；自動清理開著時，把天數從留空改成有值視同「縮短」，要確認。
- **歷程**（B26）：標題「參觀→入學 歷程」；座位事件不寫「已預繳 → 已預繳」，改寫 metadata 的年級與學期（有才寫）；建立訪視不寫「— → 已訪視」；回應有 `actor_name` 才寫操作者。
- **日期格式**（B27）：明細的「參觀日期」顯示民國 `115.09.08`（同園務），月份篩選同為民國。
- **409 提示**（B28）：狀態轉換一律用園務原文「狀態已被其他人變更，已自動重新載入」；編輯、刪除、保留座位用「這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作」（表單另說「你的修改沒有儲存」）；都自動重讀、不顯示錯誤（官網既有慣例：樂觀鎖衝突用 warning／info 並重讀）。
- **功能未啟用**（B29）：頁面在 options 回 404 時顯示「招生入學尚未啟用」空狀態，不顯示錯誤（開關見第 11 節）。
- **已匿名化的訪視**（B30、B31）：明細與表單對已匿名化的列顯示唯讀並標示「已匿名化」，不顯示編輯、註冊、保留座位按鈕。看板拖曳或「移到…」收到 409 `RECRUITMENT_VISIT_ANONYMIZED` 時，提示「這筆招生訪視已依保存政策匿名化，不能再變更」並重載看板，不當成一般錯誤。
- **刪除按鈕**（B34）：「更多」裡的刪除，對「已註冊」與「從已註冊退出」的列只在有 `admissions.convert` 時顯示。
- **註冊日期**（B35）：日期選擇器限制民國 100–200 年（後端同範圍，第 6.3 節）。
- **「（未填姓名）」**（B36）：後端 `constants.MISSING_CHILD_NAME`；後台 `constants.ts` 以原始碼比對方式取得同一字串（同 `admissionsConstants.test.ts` 對其他列舉的做法），卡片與明細遇到時加「待補」標示。
- **資料時間**（B33）：看板與名額規劃可顯示「資料時間 HH:MM」（回應的 `as_of`），並用回應的 `campus_key` 確認沒有跨校殘留。

## 11. 個資與保存

- 招生訪視複製了預約的孩子姓名、生日、家長手機與稱呼，並可另記地址、電訪回應。
- 官網現行保存政策（`operations/retention_service.py`）會在預約結案後一段時間匿名化預約本身；招生訪視是另一個用途的紀錄，**不隨預約匿名化**。
- 保存政策新增「招生訪視」類別與天數設定（`retention_policies.admissions_days`，Integer，可空，NULL＝不自動清理，DB CHECK 限 30–3650；報表類別 `admissions`；符合條件 `anonymized_at IS NULL AND updated_at < now − admissions_days`；更新請求沒帶這個鍵就不動它），匿名化時清除：
  - 姓名、生日、電話、聯絡人、地址、備註、電訪回應、未預繳原因說明、退出原因。
  - 歷程裡的自由文字原因。

  保留統計欄位與 `anonymized_at`。**預設不自動執行**，天數由業主裁定。
- 稽核紀錄與分析事件不寫入孩子或家長個資。

**上線前必須裁定**：官網預約的同意書是否涵蓋「參觀後續招生聯繫與紀錄」，以及招生訪視的保存天數（第 15 節）。在此之前，本功能只在本機與測試環境使用。

程式層的保險是開關 `WEBSITE_ADMISSIONS_ENABLED`（預設關）：關閉時 `/admin/admissions/*`（含統計的三個 GET）一律 404，預約標記已到場也不建招生訪視，後台頁面顯示「招生入學尚未啟用」；本機與 stack e2e 要設為 true。Q1 裁定前正式環境不可開，避免合併進 main 後自動複製個資。

## 12. 轉移契約

### 12.1 位置與內容

`contracts/ivy-recruitment/`：

- `README.md`：
  - 對齊的園務 commit（`ivy-backend` `dfd230c3`）。
  - 表對表、欄對欄的對應與轉換規則，含延伸欄位的去向（第 12.3 節）。
  - 刻意與園務不同之處：分母 0 回 null、來源不做別名合併、uuid、UTC、`enrolled` 旗標取代學生檔。
- `ivy-schema.json`：園務三張表的欄位名稱、型別、可否為空、長度，以及第 5.4 節列舉值的快照。

### 12.2 匯出程式與檢查

- `backend/scripts/export_ivy_recruitment.py`：
  - 讀官網資料庫，依校區輸出三張表的 JSONL。每列 `{"website_id": ..., "columns": {園務欄位}, "mapping": {匯入時要對應的官網值}}`；`columns` 的外鍵與年級 id（`recruitment_visit_id`、`grade_id`、`provisional_grade_id`、`tour_guide_employee_id`）留 `null`，由匯入端依 `mapping` 填入；`created` 事件不匯出。
  - 校區→租戶對照由命令列參數提供，不寫死，因為三校的租戶尚未存在。
  - 延伸欄位另輸出一份 `extensions.jsonl`。
  - 只讀，不改資料：連線設成 `default_transaction_read_only=on`，每條連線一建立就是唯讀，不靠交易裡第一句的順序。
- **契約測試**（backend pytest，進 CI）：用合成資料跑匯出，逐列驗證：
  - 欄位齊全。
  - 型別可轉換、長度不超過園務欄位、NOT NULL 成立。
  - 列舉值合法；民國月份、民國日期字串格式正確。
  - 事件外鍵都能接回。
- **漂移檢查**（手動，不進 CI；CI 讀不到園務 repo）：`backend/scripts/check_ivy_recruitment_contract.py --ivy-backend ../ivy-backend` 比對快照與園務現行 model。準備併入前、或園務招生模組有改動時執行；不一致就更新契約並評估官網要不要跟進。

### 12.3 延伸欄位的去向

| 官網欄位 | 併入時 |
|---|---|
| `campus_key` | 換成該校的 `tenant_id` |
| `visit_request_id` | 隨官網預約模組併入時對應新 id；在那之前寫入 `metadata_json` |
| `enrolled_on` | 建立或連結學生檔時作為入學日期依據 |
| `tour_guide_user_id`／`tour_guide_name` | 依姓名對應園務員工 `tour_guide_employee_id`；對不上留空並列入報告 |
| `provisional_grade`、`grade_intake_targets.grade` | 依名稱對應該租戶的 `class_grades.id` |
| `actor_user_id` | 寫入 `metadata_json.website_actor`（`{"user_id", "name"}`），園務欄位留空 |
| `version`、`anonymized_at`、`created` 事件 | 不轉 |

### 12.4 併入時的轉移順序（規劃，不在本次實作）

1. 建立該校租戶與年級資料。
2. 匯入該校既有學生。
3. 匯入 `recruitment_visits`，重新配 id，填入 `tenant_id`，對應年級與帶參觀老師。
4. 匯入 `recruitment_event_log` 並重接外鍵。
5. 匯入 `grade_intake_targets`。
6. `enrolled=true` 的訪視依「姓名＋生日」唯一比對學生，設定 `students.recruitment_visit_id`；比對不到或多筆的列入人工清單，不自動建學生。
7. 園務依 `notes` 重算 `expected_start_label`。

## 13. API

前綴 `/api/website/v1/admin/admissions`；回應與錯誤格式沿用官網既有格式。

| 方法與路徑 | 權限 | 說明 |
|---|---|---|
| GET `/records` | read | 篩選、分頁（`page`／`page_size`，預設 50、上限 100）；回裸 list、不回 total，前端以「回傳筆數＝page_size」判斷有下一頁；`campus_key` 必填 |
| POST `/records` | write | 手動新增；`campus_key` 放 query（同 `POST /admin/slots`） |
| GET `/records/{id}` | read | |
| PATCH `/records/{id}` | write | 帶 `expected_version`；不可改狀態欄位 |
| DELETE `/records/{id}` | write（已註冊或從已註冊退出的另需 convert） | 帶 `expected_version` |
| GET `/records/{id}/events` | read | 歷程，舊到新；每筆帶 `actor_user_id`、`actor_name`（讀取時 join users，顯示名稱沒有就用 Email；帳號刪除或自動建立時為 null） |
| POST `/records/{id}/transition` | 依第 6.3 節 | `to_stage`、`expected_version`，以及各轉換的必填欄位 |
| POST `/records/{id}/seat` | write | 保留或清除座位 |
| GET `/arrivals` | booking.read | 官網預約待確認清單與「已到場但沒有招生訪視」；`campus_key` 必填。兩份清單各最多 200 筆（待確認依場次新到舊；缺訪視依場次〔無場次用建立時間〕新到舊），另回 `awaiting_total`、`missing_total`；`slot_date`、`start_time` 可為 null |
| POST `/from-visit-request/{visit_request_id}` | write＋booking.read | 補建，可重複呼叫；非 `completed` 回 409 `VISIT_REQUEST_NOT_COMPLETED`、已匿名化回 409 `VISIT_REQUEST_ANONYMIZED` |

「已到場」「未到場」不另開端點，沿用預約既有的 `POST /admin/visit-requests/{id}/complete`、`/no-show`（`booking.handle`）。
| GET `/board` | read | 四欄看板與未填入學學期筆數；`school_year` 預設台北今天所在學年，`semester` 不帶＝整學年；回應帶 `campus_key`、`as_of` |
| GET `/intake-plan` | read | `semester` 預設 1（上學期）；回應帶 `campus_key`、`as_of`、`totals`（第 8 節） |
| PUT `/intake-targets` | write | 同校同學期一次送多個年級 |
| GET `/stats` | read | 第 9 節；`reference_month` 必須是三位數民國年月（`115.09`），格式錯（含 `99.12`）回 422 `INVALID_REFERENCE_MONTH`（訊息照園務原文；園務是未處理的 ValueError） |
| GET `/no-deposit-records` | read | 未預繳明細（園務 `/no-deposit-analysis`）：`campus_key` 必填，`school_year`、`semester`、`reason`、`grade`、`priority`（high／medium／low）、`overdue_days`（1–365）、`cold_only`、`page`（預設 1）、`page_size`（1–500，預設 100）；回分頁名單（同 `/records`，不帶 `as_of`）：`total`、`page`、`page_size`、`summary`（只受原因與班別影響）、`records`（含孩子姓名，不含電話、地址、生日） |
| GET `/compare` | read | 五校比較，只含授權校區；`school_year` 必填、`semester` 選填（沒帶＝件數算整學年；名額剩餘用上學期，`seat_semester` 標明實際學期）；回物件 `{as_of, school_year, semester, seat_semester, rows}`，`semester` 照請求回（可為 null），`rows` 每個授權校區一列（super_admin 為五列） |
| GET `/options` | read | 篩選選項：月份（新到舊）、來源、介紹者（各前 50 個）；列舉值文案，`source_categories` 是「代碼 → 園務文案」的 dict（順序同園務）；另有 `grades`、`no_deposit_reasons`（`{value, priority}`，priority 是 `high`／`medium`／`low`，「未註明／待追蹤」為 null） |

聚合回應帶 `as_of` 與實際套用的篩選。所有 API 變更都要跑 `npm run contract:generate`，並通過 `npm run contract:check`。

## 14. 測試與驗收

後端用真 PostgreSQL（`WEBSITE_TEST_DATABASE_URL` 指向隔離測試庫），新表加入 `backend/tests/conftest.py` 的 TRUNCATE 清單（預約改版 `conftest.py:118-131`）。一次只跑一組測試（本機 8GB）。

測試資料沿用預約改版的 `book_slot`（`conftest.py:420`，只能建未來場次，Email 需自行帶入）與 `legacy_request`（`:461`，直接寫 DB，沒有孩子欄位）。到場相關案例需要「已開始的場次」，新增一個 helper：先用 `book_slot` 建案，再把該場 `visit_slots.slot_date` 改成過去日期；不要直接改系統時間。

| 編號 | 案例 | 必須成立 |
|---|---|---|
| R01 | 預約從明細或官網預約分頁標記已到場；同一預約重複標記或補建 | 只產生一筆招生訪視，欄位依第 6.1 節對應；已取消、未到場的預約不產生 |
| R01a | 官網預約待確認清單：場次剛好開始的邊界、已到場、未到場、已取消、他校、場次被停止申請、`confirmed` 但沒有場次 | 只列 `confirmed` 且場次已開始者（含已停止申請的場次）；結果與 `status_groups.group_condition('past')` 去掉已到場、未到場一致 |
| R02 | 手動新增缺必填、年級不在四個名稱內、未預繳原因或來源分類代碼不合法 | 422，錯誤指向欄位 |
| R03 | 同校同月份並行新增 | 序號不重複 |
| R04 | 第 6.3 節每一種轉換，含不允許的組合 | 欄位變化、事件、權限都符合表格；不允許的回 422 |
| R05 | 兩人同時轉換或編輯同一筆 | 後送者回 409，資料不被覆蓋 |
| R06 | reception 嘗試標記註冊或退註冊；editor／readonly 讀招生 API | 403 |
| R07 | 分校帳號改 `campus_key`、訪視 id、預約 id 存取他校 | 404 |
| R08 | 保留座位：未預繳、未給學年、超額 | 前兩者拒絕；超額只警示 |
| R09 | 名額計算：已保留、已註冊、退出、轉學期、未設定計畫；已註冊者清除保留 | 數字與第 8 節一致；未設定與 0 分開；已註冊者清除保留被拒 |
| R10 | 統計合成資料（以園務 `_visit_metric_cases` 語意手算期望值），含分母 0 | 所有指標一致；分母 0 為 null |
| R11 | 近 30／90 天在台北午夜邊界；參考月份與上月 | 近 30／90 天為瞬間比較（`created_at >= now − N 天`，同園務 `stats.py:502-507`），跨台北午夜不重不漏 |
| R12 | 年級換算共用案例（9/1、9/2、7/31、8/1、範圍外） | 後端與 web helper 結果相同 |
| R13 | 匯出程式契約測試 | 第 12.2 節各項全過 |
| R14 | 保存政策試算與執行 | 只清第 11 節欄位；統計結果不變（六個計數與比率；唯一幼生以列 id 計，匿名化後會增加，見第 9.2 節）；預約匿名化不連動 |
| R15 | 後台：看板拖曳與鍵盤「移到…」、確認框、409 重載、快速切換校區、URL 篩選還原 | 畫面只顯示最後一次選取，無跨校殘留 |
| R16 | 1440px 桌機、390px 手機 | 看板、表格、表單、空狀態可用，頁面不溢出（`tests/stack/admissions-flow.spec.ts` 五個分頁與五校比較兩種寬度截圖存 `output/playwright/`，並檢查不橫向溢出） |
| R17 | stack e2e：家長自選場次預約成功 → 場次時間過後出現在「官網預約」待確認 → 按已到場 → 看板已訪視 → 預繳 → 註冊 → 名額顯示已註冊。「場次時間過後」用 psql 把本測試自己建的場次移到昨天（同後端 `start_visit_slot`），不改系統時間 | 全程成立 |

驗證指令（Node 22）：

- `npm --prefix admin run typecheck`、`npm --prefix admin run test:unit -- --maxWorkers=2`、`npm --prefix admin run build`
- `npm --prefix web run typecheck`、`npm run test:website -- --maxWorkers=2`
- `npm run contract:generate`、`npm run contract:check`
- `backend/` 內 `uv run --frozen pytest -q`
- 必要時 `npm run test:e2e:stack`，使用自訂 E2E 資料庫名稱與埠

## 15. 待裁定

| # | 問題 | 影響 | 何時需要 |
|---|---|---|---|
| Q1 | 官網預約同意書是否涵蓋參觀後的招生聯繫與紀錄；招生訪視保存幾天 | 第 11 節；是否需改同意書文案。預約改版上線前本來就要改同意文字（該規格 §7 第 3 點，補 Email 用途），建議同一次一起加上招生用途。**2026-10-04**：官網已不勾選同意（10-02），改由隱私權政策告知；擬稿（政策補三處、保存 730 天）與開啟順序見 `docs/specs/2026-10-04-admissions-follow-up-design.md` 附錄 A，待園方發布 | 正式上線前 |
| Q2 | 接待人員（reception）可否標記預繳、退預繳、設定計畫名額（本規格照園務 `RECRUITMENT_WRITE` 預設可以；註冊與退註冊不行） | 第 7 節權限表 | 實作權限前；未回覆則照預設 |
| Q3 | 明華、崇德、國際何時成為園務租戶，校區與租戶的對照 | 第 12.4 節 | 併入前 |
| Q4 | 園務招生模組在併入前若有改動，由誰通知官網更新契約 | 第 12.2 節漂移檢查 | 持續 |

## 16. 實作分段建議

一次 session 只做一段；每段都停在可本機驗收的狀態，不 commit、不 push、不部署、不跑正式 migration，除非使用者另外要求。

1. **資料與後端**：migration、models、狀態轉換、保留座位、已到場自動建立與補建、待確認清單 API、權限、API、轉移契約與匯出程式；驗收 R01–R09、R13、R14。
2. **後台畫面**：招生入學頁的看板、明細、名額規劃、官網預約分頁，以及預約詳情連結；驗收 R15、R16 的對應部分。
3. **統計**：統計查詢、統計分頁、五校比較、e2e；驗收 R10–R12、R15–R17。

開工條件與環境：

- **預約改版已於 2026-10-01 完成（`0be93ea`），但尚未併入 main。** main 的 push 會觸發正式部署，該改版上線前還要做人工步驟：備份、SMTP、各校設定場次、同意文字。所以「併入 main」的時間點由使用者決定，招生不必等它：
  - 招生分支從 `feature/parent-self-booking-20260930` 開出（疊在它上面），migration 接在 `c7d2e9f4a1b8` 之後。
  - 預約改版併入 main 後，招生分支 rebase 到 main。只要預約改版沒有再改，rebase 不會有衝突。
  - 預約改版若在併入前又修改 `workflow_service.py`、`status_groups.py`、`conftest.py`、`VisitDetailView.vue`、`labels.ts`、`nav.ts`，招生分支要跟著 rebase。
  - 每次 rebase 後重跑 `npm run contract:generate`，再跑 `contract:check`，不要手動合併 `contracts/` 產生檔。開工時用 `alembic heads` 確認只有一個 head。
- 預約改版的已知小問題，與招生有關、但不阻擋招生：`status_groups.display_status` 把「`confirmed` 但沒有場次」算成 pending，SQL 的 `group_condition` 卻四組都不含它，所以這種案件只出現在「全部」。實際資料大概不存在（舊的排入場次一定要選場次）。建議在預約改版併入 main 前順手對齊。
- 從預約改版分支建立隔離 worktree，不要放在 `/private/tmp`（重開機會清空未 commit 的工作）。sparse checkout，backend 用自己的 venv，測試庫另建（例如 `ivy_website_test_admissions`）。把本規格複製進去（本規格目前只存在舊工作樹）。
- 每個任務在 feature 分支 commit，需使用者先授權；不 push、不部署。
- 進度與驗收狀態記在 `docs/website-admin/acceptance.md` 新增的「招生入學」段落。

## 17. 實作計畫回寫對照（2026-10-01）

實作計畫：總覽 `docs/superpowers/plans/2026-10-01-admissions.md`，階段 A／B／C 各一份（`-A-backend`、`-B-admin`、`-C-stats`）。計畫裡「以計畫為準」的調整逐條列在下面（總覽技術調整 7 條、A 30 條、B 36 列、C 19 列，共 92 列）；有規格對應的已就地改進該節，只影響程式介面的寫在總覽的「檔案配置」「介面」。另有 C 階段執行時的裁定（`/compare` 回物件、五校比較預設學期、唯一幼生對匿名化的列以列 id 計、功能關閉時統計三個 GET 也是 404），已併入上列各列的回寫位置。

| 來源 | 調整 | 回寫位置 |
|---|---|---|
| 總覽技術調整 1 | 列表回裸 list，`page`／`page_size`，不回 total | 第 13 節 `GET /records` |
| 總覽技術調整 2 | `metadata_json` 用 JSON | 第 5.2 節 |
| 總覽技術調整 3 | 不允許的轉換 422 `TRANSITION_NOT_ALLOWED`，與預約的 409 `INVALID_TRANSITION` 分開；版本衝突碼 `RECRUITMENT_VISIT_VERSION_CONFLICT` | 第 6.3 節 |
| 總覽技術調整 4 | 建立訪視的 `campus_key` 放 query | 第 13 節 `POST /records` |
| 總覽技術調整 5 | 自動建立時姓名截斷到 50 字 | 第 6.1 節第 1 點 |
| 總覽技術調整 6 | 共用年級案例的位置與形狀 | 第 6.4 節 |
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
| A 調整 10 | `not_allowed_reason`；先比對版本再判權限 | 第 6.3 節；總覽「介面」funnel.py |
| A 調整 11 | request schema 一律 `extra="forbid"` | 第 6.6 節；總覽「介面」Schema 名稱 |
| A 調整 12 | `SeatOut` 帶 `warning_code` | 第 6.5 節；總覽「介面」Schema 名稱 |
| A 調整 13 | 補建只收 `completed` 且未匿名化 | 第 6.1 節第 2 點、第 13 節；總覽 API 表 |
| A 調整 14 | `labels.ts` 同名 metadata 鍵依 action 分開翻 | 總覽「稽核代碼」 |
| A 調整 15 | `admissions_days` 的 DB CHECK 與只在有帶鍵時寫入 | 第 11 節；總覽技術調整 7 |
| A 調整 16 | 匯出每列 `website_id`／`columns`／`mapping` | 第 12.2 節 |
| A 調整 17 | `source_categories` 是 dict | 第 13 節 `GET /options`；總覽 API 表 |
| A 調整 18 | `AdmissionsOptionsOut` 另有 `grades`、`no_deposit_reasons`（`NoDepositReasonOption`） | 第 13 節 `GET /options`；總覽 API 表、Schema 名稱 |
| A 調整 19 | `RecruitmentEventOut` 多 `actor_user_id`、`actor_name`，歷程舊到新 | 第 13 節 `GET /records/{id}/events`；總覽「介面」Schema 名稱 |
| A 調整 20 | 新增錯誤碼 `TRANSITION_FIELDS_REQUIRED`、`SEAT_NOT_ALLOWED`；同階段轉換 422 | 第 6.3 節、第 6.5 節；總覽 Global Constraints |
| A 調整 21 | 標記註冊的欄位預設與 `converted` 事件 metadata | 第 6.3 節 |
| A 調整 22 | 建立與編輯不收 `district`、`geocoding_consent_at`；改日期換月份重配序號 | 第 6.6 節 |
| A 調整 23 | 保留座位：釋放無保留 422；事件階段與 metadata | 第 6.5 節 |
| A 調整 24 | 名額規劃 `totals`；`/intake-plan`、`/board` 的預設學期 | 第 8 節、第 13 節 |
| A 調整 25 | `campus_key` 不在五校內，總管理者也回 404 | 第 7 節；總覽 Global Constraints |
| A 調整 26 | `labels.ts` 匯出招生階段、來源、欄位標籤，`AUDIT_PAIRED_KEYS` 加階段 | 總覽「檔案配置」`labels.ts` |
| A 調整 27 | `ArrivalRowOut.slot_date`、`start_time` 可為 null；補建無場次用當天 | 第 6.1 節第 2 點、第 13 節；總覽「介面」booking_link.py |
| A 調整 28 | 匯出程式的簽章、`write_jsonl`、`website_actor` 形狀、唯讀連線 | 第 12.2、12.3 節；總覽「介面」export.py |
| A 調整 29 | 測試共用 fixture 都在 `admissions_helpers.py` | 總覽「檔案配置」測試清單 |
| A 調整 30 | R14 統計不變的範圍；唯一幼生對匿名化的列以列 id 計 | 第 9.2 節、第 14 節 R14；契約 README |
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
| B 調整 15 | 網址另有 `month`（格式不對就丟掉）；明細月份與網址雙向同步 | 第 10 節；第 10.1 節；總覽「檔案配置」 |
| B 調整 16 | `RecordsTab` 只吃 props，用 `update:*`、`clear-term` 往上改 | 第 10.1 節；總覽「檔案配置」 |
| B 調整 17 | 表單送出的欄位（不送狀態欄位；編輯只送改過的） | 第 10.1 節 |
| B 調整 18 | 看板、名額規劃在不限學年或沒選學期時的預設 | 第 10.1 節 |
| B 調整 19 | 新增訪視的兩個入口 | 第 10.1 節 |
| B 調整 20 | 看板摘要列三個比率的算法與分母 0 | 第 10.1 節 |
| B 調整 21 | 官網預約分頁每次讀完更新標籤筆數 | 第 10.1 節 |
| B 調整 22 | 預約明細的招生訪視連結帶 `sy=all` | 第 10.1 節 |
| B 調整 23 | `errors.ts` 補 `VISIT_REQUEST_NOT_COMPLETED`、`VISIT_REQUEST_ANONYMIZED` | 總覽「檔案配置」 |
| B 調整 24 | 超額標籤與提醒框 | 第 10.1 節 |
| B 調整 25 | 保存政策欄位位置與縮短確認 | 第 10.1 節 |
| B 調整 26 | 歷程標題與事件文案規則 | 第 10.1 節 |
| B 調整 27 | 明細日期用民國格式 | 第 10.1 節 |
| B 調整 28 | 409 提示的兩種文案 | 第 10.1 節 |
| B 調整 29 | 功能開關 `WEBSITE_ADMISSIONS_ENABLED`；頁面顯示「尚未啟用」 | 第 11 節、第 10.1 節；`deploy/README.md` |
| B 調整 30 | `anonymized_at`；已匿名化的列唯讀；409 `RECRUITMENT_VISIT_ANONYMIZED` | 第 6.3 節、第 10.1 節；總覽「介面」`RecruitmentVisitOut` |
| B 調整 31 | 看板收到匿名化 409 的提示與重載 | 第 10.1 節 |
| B 調整 32 | `ArrivalsOut` 多 `awaiting_total`、`missing_total`，各最多 200 筆 | 第 10.1 節、第 13 節；總覽「介面」booking_link.py |
| B 調整 33 | 看板與名額規劃回應多 `as_of`、`campus_key` | 第 13 節；總覽「介面」funnel.py、intake.py |
| B 調整 34 | 刪除已註冊或從已註冊退出的訪視需 `admissions.convert` | 第 6.6 節、第 13 節；總覽 API 表 |
| B 調整 35 | 註冊日期民國年限 100–200 | 第 6.3 節、第 10.1 節 |
| B 調整 36 | 「（未填姓名）」的常數與「待補」標示 | 第 10.1 節 |
| C 調整 1 | 統計型別別名在 C3、C3b、C4 加（另有 `AdmissionsCompare`） | 總覽「檔案配置」、「介面」後台 API 模組 |
| C 調整 2 | `AdmissionsView.vue` 在 C3 改 `<StatsTab>` 一處 | 總覽「檔案配置」 |
| C 調整 3 | `StatsTab` 的 props 與事件 | 總覽「統計分頁」 |
| C 調整 4 | 警示與行動入口的 `target_tab`、`REVIEW_SOURCE` | 第 9.3 節；`contracts/ivy-recruitment/README.md` |
| C 調整 5 | `GET /compare` 的學年必填、學期選填（2026-10-02 X2b 改，原為兩者必填）；回物件 `{as_of, school_year, semester, seat_semester, rows}` | 第 13 節；總覽 API 表、「介面」stats.py |
| C 調整 6 | `StatsTab` 多 `campusKeys`、`go` 換成 `open-records` | 總覽「統計分頁」 |
| C 調整 7 | 統計切到訪視明細帶 `month`，用 `router.push` | 第 10 節（網址參數、統計分析） |
| C 調整 8 | 五校比較頁首沒選學年學期時的預設：沒選學年用目前學年；沒選學期件數算整學年、名額剩餘用上學期（2026-10-02 X2b 改，原為兩者都用上學期） | 第 9.3 節；總覽「統計分頁」 |
| C 調整 9 | 同票排序加第二鍵 | 第 9.2 節；契約 README |
| C 調整 10 | 月比任一邊 null，差值也是 null | 第 9.2 節；契約 README |
| C 調整 11 | 統計回應只有數字；未預繳名單另由 `/no-deposit-records` 提供，含孩子姓名（2026-10-01 使用者裁定統計頁列名單） | 第 7 節、第 9.3 節、第 13 節；契約 README |
| C 調整 12 | 總覽另加「本範圍合計」，不做兩張圖與全管道彙整 | 第 9.3 節 |
| C 調整 13 | 參考月份格式錯 422 `INVALID_REFERENCE_MONTH`（三位數民國年月） | 第 13 節；契約 README |
| C 調整 14 | R17 的「場次時間已過」用 psql 移本測試自建的場次 | 第 14 節 R17 |
| C 調整 15 | R16 的截圖與溢出檢查 | 第 14 節 R16 |
| C 調整 16 | 介紹者 × 來源交叉表放在接待分析 | 第 9.3 節 |
| C 調整 17 | 未預繳名單排序可重現：民國月份排序鍵降序、序號開頭數字升序 | 第 9.3 節；契約 README |
| C 調整 18 | 名單「查看」切到訪視明細並帶該筆月份（明細只吃 `month`、`vr`） | 第 10 節統計分析 |
| C 調整 19 | `NoDepositList` 介面；警示與行動入口的 `target_filter` 帶進名單；數字卡沿用 `/stats` | 第 9.3 節；總覽「統計分頁」 |
