# 預約表單加「預計入學時間」（2026-10-15）設計

日期：2026-10-15
狀態：設計 10-15 經使用者核可（只加這一題、選填，不加「目前就托狀況」，由使用者逐題選定）；規格待使用者審閱
基準：`origin/main` `aae0debc`（migration head `c6a9e3f15d27`；**本案新增一支 migration**）
分支（實作）：`feature/visit-expected-start-20261015`
上游：10-15 後台功能盤點，使用者選定六項之一（第 3 波，與「預約案件排除」同波、都動 `visit_requests`，照順序做）。10-08 使用者把「預約表單加『預計入學時間』『目前就托狀況』」延後（`README.md:541,561`）；10-15 決定只做前者。

## 1. 背景與目標

招生訪視有必填的「入學學期」（`recruitment_visits.target_school_year`／`target_semester`），但到場自動建立訪視時一律填「今天所在的學期」（`backend/app/admissions/booking_link.py:77-102`），接待還要再問一次、手動改。家長預約時就知道大概什麼時候想入學，表單問一題就能直接帶過去。

園務的 `expected_start_label`（預計就讀月份）是從備註用正規表示式抓出來的衍生欄位（`ivy-backend/api/recruitment/shared.py:107-127`），官網契約一律送 null、由園務重算（`contracts/ivy-recruitment/README.md:44`）。本案寫進的是結構化的入學學期，和那個衍生欄位無關，契約不用改。

### 1.1 成功標準

1. 官網預約表單在孩子生日下面多一題「預計入學時間（選填）」，單選；不填照樣能送出。
2. 案件明細、匯出 CSV、後台補登與修改家長資料、家長管理頁都看得到（後台與家長都能改）。
3. 家長有填時，到場建立的招生訪視直接帶入對應的入學學期。
4. 舊版頁面（沒有這一題）送單、重送照常；防重複送出不受影響。

### 1.2 裁定

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| X1 ✔ | 範圍 | 只加「預計入學時間」，**選填**；不加「目前就托狀況」 | 使用者 10-15 選定 |
| X2 ✔ | 選項 | 「盡快（這學期）」＋接下來四個學期的開學月份＋「還不確定」，依台北今天動態算。例：2026-10-15 → 盡快（這學期）／2027 年 2 月／2027 年 9 月／2028 年 2 月／2028 年 9 月／還不確定 | 家長用月份想，比「115 學年下學期」好懂；學期規則沿用 `academic.current_term`（8/1 起上學期、2/1 起下學期，1 月仍屬上學期） |
| X3 ✔ | 樣式與位置 | 「孩子資料」區塊、生日下面，單選膠囊（和「如何知道常春藤」同款，但只能選一個；再點一次取消選取）；手機一樣換行排列 | 使用者 10-15 核可 |
| X4 ✔ | 帶進招生 | 到場建立訪視時：選了月份 → 對應學期；選「盡快」→ 參觀日所在學期；沒填或「還不確定」→ 照現在的做法（今天所在學期）。選的學期比參觀日所在學期還早（家長很晚才來）→ 用參觀日所在學期。之後預約資料再改，**不會**同步改招生的入學學期（「比參觀日還早」與「不同步」兩句是寫規格時補的細節） | 接待改過的入學學期不能被預約端蓋掉（同步只同步聯絡資料，`booking_link.py:143`） |
| X5 ✔ | 誰能改 | 後台「修改家長資料」、後台補登、家長管理頁都可以改 | 家長可能改變主意；接待電話問到也要能填 |
| X6 | 儲存格式 | `visit_requests.expected_start String(8) NULL`：`asap`、`unsure`，或 `<民國學年>-<學期>`（例 `115-2`） | 一欄就能表達三種情況；「盡快」保留原意，顯示時再換算 |
| X7 | 公開端驗證 | 學期必須介於「今天所在學期」到「之後第 5 個學期」（含），超出 → 422 `expected_start`；多留一學期給跨學期仍開著的舊頁面 | 擋亂填，又不讓快取頁面在換學期時送不出去 |
| X8 | 後台驗證 | 格式正確、學年 100–199 即可 | 補登舊案件可能要填過去的學期 |
| X9 | 防重複比對 | `_canonical_payload` 在值為空時不放這個鍵（同 `child_name` 等選填欄位） | 舊頁面送的單與重送的雜湊不變 |
| X10 | 匿名化 | 不清 | 單獨一個學期無法識別人，比照 `age`、`preferred_time` 也不清（`retention_service.py:179-185`） |
| X11 | 隱私說明 | 後台內建的隱私說明與政策草稿（`admin/src/composables/privacyNotice.ts:14`、`privacyPolicyDraft.ts:28-37`）的「蒐集項目」加「預計入學時間」；正式站已發布的文字由園方在後台改 | 收了就要寫明 |

### 1.3 不做

- 「目前就托狀況」。
- 預計入學時間的分布統計（先收一段時間資料）。
- 必填、寫進確認信或通知、改年級換算（`grade` 仍依現行規則）。
- 園務契約與 `expected_start_label` 的改動。

## 2. 現況（`origin/main` `aae0debc`）

- 表單 `web/app/components/VisitForm.vue`：`form` :22-30；孩子資料 :598-604（姓名 :601、生日 :602）；得知管道膠囊 :615；payload :385-399（帶 `Idempotency-Key`）；成功頁清單 :662（文案 `web/app/utils/visit-result.ts:13-24`）。驗證與選項 `web/app/utils/visit-form.ts`（`REFERRAL_OPTIONS` :12-22、`validateVisitContact` :86-108、`API_FIELDS` :110-113）。樣式 `web/app/assets/css/visit-booking.css`（`.visit-referrals` :157-163、手機 :290-332）。
- 公開 API `POST /public/visit-requests`（`backend/app/booking/routes.py:344`）；schema `_VisitRequestFields`（`schemas.py:232-257`）、`VisitRequestCreate`（:301）；寫入 `service.submit_visit_request`（`service.py:355-392`）；雜湊 `_canonical_payload`（:156-180）。
- 後台：補登 `admin/src/components/ManualVisitDialog.vue`（body :215-239；重新預約帶入 :64-72）；修改家長資料 `components/visit/VisitDetailsDialog.vue`（`FIELDS` :16-17）＋後端 `AdminDetailsUpdate`（`schemas.py:580-596`）、`EDITABLE_BY_STAFF`（`workflow_service.py:432`）；明細 `components/visit/VisitCaseFacts.vue:15-35`；CSV `booking/routes.py:1099-1114`＋`booking/export_labels.py:14-18`。
- 家長管理頁 `web/app/pages/visit/manage.vue`（顯示 :200-209、編輯 :262-272）；後端 `ParentDetailsUpdate`（`schemas.py:522-533`）、`EDITABLE_BY_PARENT`（`workflow_service.py:332`）、`ParentVisitRequestOut`（:638-）。
- 建訪視 `booking_link.fields_from_visit_request`（:77-102，`target_school_year/semester` ＝ `academic.current_term(today)`）。
- 學期規則 `backend/app/admissions/academic.py:32-49`（`current_term`、`term_bounds`）。

## 3. 設計

### 3.1 後端

- migration：`visit_requests.expected_start String(8) NULL`，CHECK `expected_start IS NULL OR expected_start IN ('asap','unsure') OR expected_start ~ '^1[0-9]{2}-[12]$'`。
- 共用小模組 `backend/app/booking/expected_start.py`：`parse(value) -> ('asap'|'unsure'|(year, semester))`、`public_choices(today)`（X2，給測試對照前端）、`validate_public(value, today)`（X7）、`resolve_term(value, visit_date, today)`（X4）。
- schema：`_VisitRequestFields` 加 `expected_start: str | None`（格式驗證）；公開送單另跑 X7；`AdminDetailsUpdate`、`ParentDetailsUpdate`、補登 schema 都收；`EDITABLE_BY_STAFF`、`EDITABLE_BY_PARENT` 加入；`VisitRequestDetailOut`、`ParentVisitRequestOut` 回傳。
- `_canonical_payload`：空值不放（X9）。
- `fields_from_visit_request`：入學學期改用 `resolve_term`。
- CSV：加「預計入學」欄（顯示文字同 §3.3）。
- 契約重新產生（`openapi.json`、`website-api.d.ts`）。

### 3.2 官網

- `web/app/utils/visit-form.ts` 加 `expectedStartOptions(today)`，規則與後端 `public_choices` 相同；前後端各有一組相同的日期邊界測試案例（1/31、2/1、7/31、8/1）。今天以台北日期計。
- `VisitForm.vue`：`form.expectedStart`（預設空）；生日下方加 `role="radiogroup"` 的單選膠囊，標題「預計入學時間（選填）」；再點已選的那一個取消選取；payload 有值才帶 `expected_start`。
- `API_FIELDS` 加 `expected_start`，422 時錯誤顯示在這一題下面（「這個入學時間已過期，請重新選擇」）。
- 成功頁有選才列「預計入學」。
- `manage.vue`：顯示與編輯都加這一題（同款膠囊，選項依今天重算；原值不在新選項裡時保留顯示原值）。

### 3.3 後台

- 顯示文字（`admin/src/api/labels.ts` 加一個格式函式）：`115-2` → 「2027 年 2 月（115 學年下學期）」；`asap` → 「盡快（送單時是 115 學年上學期）」（依案件送出日換算）；`unsure` → 「還不確定」；空 → 不列。
- `VisitCaseFacts.vue`：有值才列「預計入學」。
- `VisitDetailsDialog.vue`、`ManualVisitDialog.vue`：下拉（後台選項範圍：前兩個學期到之後六個學期＋盡快＋還不確定＋清空）；重新預約帶入舊值。
- 隱私說明草稿（X11）。

## 4. 測試

- 後端：
  - migration CHECK：合法與不合法值。
  - 公開送單：不帶、帶 `asap`、帶 `unsure`、帶範圍內學期 → 成功；範圍外、格式錯 → 422 `expected_start`。
  - 防重複：不帶這個欄位的兩次送單雜湊與改版前相同；帶值的重送回同一案。
  - 後台與家長修改、補登都能寫；家長端改值後明細回傳正確。
  - `resolve_term` 各情況；到場建訪視帶入正確學期；預約之後再改不同步到招生。
  - CSV 欄位。
  - `public_choices` 的日期邊界（與前端同一組案例）。
- web vitest：選項邊界、單選與取消、payload 有值才帶、422 對應。
- admin vitest：顯示文字、兩個對話框。
- stack e2e：在既有「官網預約」spec 選一個入學時間 → 後台明細看得到 → 標到場後招生訪視的入學學期正確；手機 390px 這一題不溢出。

## 5. 部署與風險

- 一支 migration（只加可空欄位），不需先備份。`down_revision` 串接規則同「退出原因分類」規格 §5；本案與「預約案件排除」都動 `visit_requests`，先合併本案。
- 公開表單改動要在桌機與手機實機看過（Playwright 截圖）。
- 正式站隱私權政策若已發布，要請園方在後台補上這一項。

## 6. 與其他工作的關係

- 「預約案件排除」：同表不同欄，同波後做。
- 「招生歷程兩種事件」動 `booking_link.sync_from_visit_request`，本案動同檔的 `fields_from_visit_request`，合併時注意。
