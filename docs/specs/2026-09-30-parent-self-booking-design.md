# 家長自選場次預約（預約成功＋修改連結＋確認信）設計

- 日期：2026-09-30
- 狀態：草案，待使用者審閱
- 基準：origin/main `0a00625`
- 分支：`feature/parent-self-booking-20260930`（worktree `/private/tmp/ivy-website-self-booking-20260930`）

## 1. 業主裁定（2026-09-30）

以下裁定取代規格 `2026-09-19-website-admin.md` 的 §5、§6.1 成功文案三語意、§6.2 狀態流程，以及 handoff「預約不可違反的規則」第 1 條與全域限制「不發真實家長通知」中相關的部分：

1. **只有一條預約路徑：家長自選後台開放的場次，送出即預約成功。** 拿掉「填表後由園方聯絡、再排時間」（`inquiry`），也拿掉「自選場次但園方人工確認」（`slots_auto_confirm=false`）。家長若打電話來需要協助，由園方在後台「補登」時直接選場次。
2. **不要「聯絡中」。** 後台狀態參考義華舊後台：預約正常、預約已取消（附誰取消與時間）、預約時間已過。
3. **送出後家長看到「預約成功」、修改連結，並收到確認信。** Email 必填。
4. **修改連結可做三件事：改場次（立即生效、不用園方核准）、改資料、取消。** 都受「參觀前 N 小時截止」限制（`booking_configs.parent_change_deadline_hours`）。
5. **後台月曆可直接停止或恢復某天某一場**（參考義華行事曆）。
6. 資料庫的 7 種 `VisitRequestStatus` 不刪除、不合併。精簡只發生在後台畫面，並停止產生 `contacting`、`pending_confirmation`。原因是分析漏斗、未來併入園務的轉移契約（見 `docs/specs/2026-09-30-website-admissions-design.md`）與既有測試都依賴這 7 種狀態。
7. 修改連結採「伺服器重算」做法（§3.2），不採「畫面與信件各一條」或「加密存原始連結」。
8. 上線切換：各校先在正式後台設好每週規則；migration 把已有規則或場次的校切成自選場次，其餘切成暫停（§5.1）。
9. **場次設定與月曆合成一頁「參觀場次」**（§4.8）：以「場次」為單位設定每週固定場次，儲存即補好場次；「停止申請」只代表不收新預約、已約好的照常參觀（取代 2026-09-28「關閉時段三選一」）；整天不開放用「整天休假」。原「時段與容量」頁移除。

仍然有效、不因本案改變的規則：模式切換不取消既有案件；同一把 Idempotency-Key 重送回原結果、不同 payload 回 409；最後一個名額並發只能一方成功，必須用真 PostgreSQL 驗證；通知失敗不影響案件；outbox 在交易提交後才對外發送；LINE／電話／外部網址的點擊不算預約；內容還原不回復預約狀態。

## 2. 範圍

**要做**
- 公開官網：預約表單（Email 必填、拿掉「方便接電話時段」）、結果頁（預約成功＋修改連結＋寄信文案）、管理頁（改場次／改資料／取消）。
- 後端：送出即成立、送單時發修改連結、家長直接改期與改資料 API、三種寄給家長的信、列表分組篩選、`cancel_reason`、補登必選場次、預約模式移除 `inquiry`。
- 後台：案件列表分頁與狀態欄、案件明細、各校預約方式、「參觀場次」頁（固定場次設定＋月曆，取代「時段與容量」與「接待月曆」兩頁）、補登對話框。
- 一支 migration（改寫正式資料，上線前備份）。

**不做**
- 參觀前一天的提醒信（之後有需求再加）。
- 場次命名自訂（「上午場／下午場」由開始時間推導，§4.4）。
- 刪除資料庫中的 `inquiry`、`contacting`、`pending_confirmation` 值或相關歷史資料。
- 移除 LINE／電話／外部網址／暫停四種模式（不產生案件，不影響狀態）。
- SMTP 帳號申請、DNS 設定、正式站場次設定（上線前人工步驟，§7）。

## 3. 後端

### 3.1 預約模式與送單

- `BookingMode`（`backend/app/booking/models.py:14`）保留 enum 值 `inquiry`，但：
  - `PATCH /admin/booking-config/{campus_key}`（`routes.py:112`）拒絕切到 `inquiry`，回 400 `BOOKING_MODE_RETIRED`。
  - `readiness.py` 不再列 `inquiry` 為可選模式。
  - 公開端 `GET /public/booking-config/{campus_key}`（`routes.py:212`）若讀到 `inquiry`（只可能在 migration 前），一律回 `paused`。
- 送單 `POST /public/visit-requests`（`routes.py:335`，`service.py`）：
  - `slot_id` 必填（schema 層），缺少回 422 `SLOT_REQUIRED`。
  - `email` 必填，缺少回 422 `EMAIL_REQUIRED`。
  - 有時段一律建立為 `confirmed`、`confirmed_at=now`，不再讀 `slots_auto_confirm`（取代 `service.py:385-396` 的分支）。不再寫 `hold_expires_at`。
  - `preferred_time`：官網不再送出；schema 維持選填以相容舊前端，DB 欄位保留。
  - 其餘順序（限流、重播、Turnstile、上限、鎖 `booking_configs` 與時段列）不變。
- `slots_auto_confirm` 欄位保留不刪，由 migration 設為 true（回滾到舊程式時也會自動確認）。後台與 API schema 不再暴露此欄位。

### 3.2 修改連結（parent access token）

- 原始 token 由伺服器重算：
  - `key = HMAC-SHA256(WEBSITE_SESSION_SECRET, "ivy-parent-access-v1")`
  - `raw = base64url(HMAC-SHA256(key, token_row.id.bytes))`，去掉尾端 `=`
  - DB 照舊只存 `sha256(raw)`（`parent_access_tokens.token_hash`），**不新增欄位**。`token_row.id` 是 uuid4，只有 DB 沒有密鑰算不出 raw。
  - 既有以 `secrets.token_urlsafe` 產生的舊 token 仍以 hash 查找，照常可兌換。
- `access_service`（`access_service.py:38`）新增：
  - `issue_access_token(db, visit_request)`：撤銷該案既有 token 與 session，建新列，回傳 raw 與到期時間。
  - `current_manage_url(db, visit_request, origin)`：找該案未撤銷、未到期的 token，重算 raw，組 `{origin}/visit/manage#token=<raw>`；沒有則回 None。
- 有效期：`expires_at = max(now + 14 天, 參觀開始 + 7 天)`。改場次時依新場次重算（只會延長或維持，不縮短已發出的連結）。
- 發放時機：
  - 公開送單成功時（同一交易內）。
  - 後台補登且案件成為 `confirmed` 時。
  - 後台「重新產生連結並寄出」時（撤銷舊的、發新的、排一封 `parent_visit_changed`）。
  - 舊案件（本案上線前建立、沒有 token）在後台「排入場次」時。
- 撤銷：沿用 `revoke_access_for_visit_request`，在取消、完成、未到場時由 `workflow_service._close`（`workflow_service.py:139`）呼叫。
- 送單回應 `VisitRequestOut`（`schemas.py:387`）新增 `manage_url: str | None`。新建與重播都用 `current_manage_url` 取得，同一筆永遠是同一條。回應加 `Cache-Control: no-store`。
- 更換 `WEBSITE_SESSION_SECRET` 會讓所有已發出的連結失效（寫進 `deploy/README.md`）。

### 3.3 家長端 API（`access_routes.py`）

全部沿用現有 session cookie、`require_parent_request`（`X-Ivy-Parent: 1`、擋 cross-site、每分鐘 30 次）、`_require_same_visit_request`（`access_routes.py:74`）與截止檢查 `require_change_window`（`parent_policy.py`）。

- `GET /public/visit-manage/me`：`ParentVisitRequestOut`（`schemas.py:504`）新增 `parent_name`、`phone`、`email`、`child_name`、`child_birthdate`、`party_size`、`questions`、`version`，以及 `can_edit`（與 `can_reschedule` 同條件）。移除 `phone_masked`（改顯示完整電話）。
- `POST /public/visit-manage/reschedule`（新）：body `{visit_request_id, slot_id}`。
  - 條件：案件 `confirmed`、分校啟用、在截止前、新時段 `is_publicly_bookable`、與原時段不同。
  - 呼叫 `workflow_service.reschedule(actor=PARENT)`（`workflow_service.py:270`），沿用「新舊時段依字串排序上鎖」與容量檢查。
  - 成功後重算 token 有效期。寄信由 `workflow_service.reschedule` 統一排（§3.4），給園方的 `visit_request_rescheduled` 照舊。
  - 錯誤碼：`SLOT_FULL`、`SLOT_CLOSED`、`SLOT_NOT_FOUND`、`SLOT_NOT_BOOKABLE`、`SAME_SLOT`、`CHANGE_DEADLINE_PASSED`、`INVALID_TRANSITION`、`BOOKING_UNAVAILABLE`、`PARENT_SESSION_CHANGED`。
- `PATCH /public/visit-manage/me`（新）：body `{visit_request_id, expected_version, parent_name?, phone?, email?, child_name?, child_birthdate?, party_size?, questions?}`。
  - 欄位驗證與公開送單相同（`schemas.py:231-317`）；`email` 不可清空。
  - 鎖案件列，`version` 不符回 409 `VISIT_VERSION_CONFLICT`。
  - 條件同改期（`confirmed`、截止前）。沒有實際變更時直接回目前資料，不寫歷程、不寄信。
  - 歷程事件 `details_updated`（actor=PARENT，before／after 只列有變的欄位）。不通知園方。
  - 有變更時排 `parent_visit_changed`，寄到**新的** Email。
- `POST /public/visit-manage/cancel`：不變；另外寫 `cancel_reason=parent`。寄信由 `workflow_service.cancel` 統一排（§3.4）。
- `POST /public/visit-manage/reschedule-request`：停用，回 410 `ENDPOINT_RETIRED`。既有 pending 的 `reschedule_requests` 仍可在後台核准或退回（`access_routes.py:378`、`:433`）。

### 3.4 寄給家長的信

- 新 outbox kind：`parent_visit_booked`、`parent_visit_changed`、`parent_visit_cancelled`。payload 只有 `{campus_key, receipt_id}`，**不含原始連結**。
- `notifications/service.py` 的 `dispatch_outbox_message`（`:232`）遇到 `parent_*` kind：
  - 只走 Email，不寫站內通知、不推 LINE。
  - 收件者：案件目前的 `email`；delivery 去重鍵 `parent:<visit_request_id>`（沿用 `notification_deliveries` 的唯一鍵）。
  - 寄件當下用 `current_manage_url` 重算連結；已撤銷（取消後）就不放連結，改放重新預約網址 `{origin}/visit/{campus_key}`。
  - 沒有 Email、或 adapter 為 None（沒設 SMTP 也沒設 sink），標為 `skipped`，不重試。
  - 沿用 `EXTERNAL_DELIVERY_STALE_AFTER`（超過 24 小時的舊訊息不寄）與既有重試退避。
- 信件內容（`notifications/parent_email.py`，純文字＋簡單 HTML 的 multipart；若 `SmtpEmailAdapter` 只支援純文字，就先寄純文字，HTML 列為後續）：
  - 主旨：`【常春藤{校名}】參觀預約成功：10/02（五）上午場 10:00`；變更寫「參觀預約已變更」；取消寫「參觀預約已取消」。
  - 內文：家長稱呼（沿用 `parent_salutation`）、校名、日期與場次、參觀人數、分校地址與電話、修改連結與「{截止時間}前可以線上修改或取消」、取消信寫明「由您取消／由園方取消」。
  - 不放孩子生日、電話全碼、提問內容。
- 觸發點：

| 事件 | 位置 | 家長信 |
|---|---|---|
| 公開送單成功 | `service.py` 建案處 | `parent_visit_booked` |
| 後台補登（有 Email） | `service.py:492` `create_manual_visit_request` | `parent_visit_booked` |
| 後台排入場次（舊案件） | `workflow_service.confirm_with_slot` | `parent_visit_booked` |
| 家長或園方改場次 | `workflow_service.reschedule`（不分 actor） | `parent_visit_changed` |
| 家長改資料 | §3.3 `PATCH /public/visit-manage/me` | `parent_visit_changed` |
| 後台重寄確認信 | 新端點 §3.6 | `parent_visit_booked`（新 outbox 列，不受去重影響） |
| 後台重新產生連結並寄出 | 新端點 §3.6 | `parent_visit_changed` |
| 家長或園方取消（案件有場次時） | `workflow_service.cancel`（actor=parent／staff） | `parent_visit_cancelled` |
| 舊的待確認占位逾期釋放 | `workflow_service.expire_holds` | 不寄 |

- 公開 `GET /public/booking-config/{campus_key}` 新增 `parent_email_enabled: bool`（`get_email_adapter()` 會回傳 `SmtpEmailAdapter` 時為 true；本機 sink 不算）。
- `_KIND_LABELS`（`notifications/service.py:26`）與後台 `labels.ts` 補三個 kind 的中文，讓 `labelCoverage` 測試與 outbox 重試頁看得懂。

### 3.5 後台列表的分組與取消來源

- `visit_requests.cancel_reason`：`String(16)`、nullable，值沿用 `app/operations/models.py` 的 `parent`／`staff`／`hold_expired`（不另訂 `system`）。取消時寫入：家長取消 `parent`、後台取消 `staff`、占位逾期 `hold_expired`（`workflow_service.expire_holds`，`:348`）。
- 列表 `GET /admin/visit-requests` 新增 `group` 參數（與既有 `status` 參數擇一，`status` 保留相容）：

| group | 條件 |
|---|---|
| `pending` | status ∈ {new, contacting, pending_confirmation}（只剩舊資料） |
| `upcoming` | status = confirmed 且 場次開始時間 > now |
| `past` | (status = confirmed 且 場次開始時間 ≤ now) 或 status ∈ {completed, no_show} |
| `cancelled` | status = cancelled |

  - 場次開始時間用 `slot_start_utc`（Asia/Taipei 的日期＋開始時間）在 SQL 端計算，join `visit_slots`。
  - 新增 `GET /admin/visit-requests/group-counts`（套用同一組其他篩選，回四組筆數），供分頁數字使用。
- `VisitRequestOut`（後台列表與明細）新增 `cancel_reason` 與 `display_status`（`pending`／`upcoming`／`past`／`cancelled`，同上表規則，由後端計算，前端不自行推導）。

### 3.6 後台端點調整

- 移除 `POST .../contacting`（`routes.py:1517`）：回 410 `ENDPOINT_RETIRED`。`workflow_service.mark_contacting` 刪除。
- `POST .../confirm`（`routes.py:1314`）保留，語意改為「排入場次」，只用於 pending 組的舊案件；成功後發修改連結（若無）並排 `parent_visit_booked`（有 Email 時）。
- 補登 `POST /admin/visit-requests`（`routes.py:1036`）：`slot_id` 必填（422 `SLOT_REQUIRED`）；時段可在 24 小時預約窗內，但不可已關閉、已滿、已開始（與 `ManualVisitDialog.vue:103` 的 `openSlots` 一致）；成功即 `confirmed`、發修改連結、有 Email 時排 `parent_visit_booked`。
- 新增 `POST /admin/visit-requests/{id}/resend-confirmation`（`booking.handle`）：案件須為 `confirmed` 且有 Email，否則 409。若沒有有效 token 先發一條。
- 既有 `POST .../access-link`（`access_routes.py:229`）改為「重新產生並寄出」：撤銷舊連結、發新連結、有 Email 時排 `parent_visit_changed`；回應仍附新連結供園方複製。
- 後台取消與改期的回應不變；寄信在 §3.4 觸發。

### 3.7 場次設定與停止申請

- `PUT /admin/visit-schedule/{campus_key}`（`schedule_routes.py:64`）：寫入規則、`sync_rule_slots` 之後，**在同一個請求內接著呼叫 `extend_from_rules`**（`schedule_service.py:413`），把場次補到最遠開放天數，回應附補了幾場。不再依賴下一輪定期工作。
- 規則資料格式（`visit_rules`）不變。畫面以「場次」為單位，換算規則見 §4.8；因為 `sync_rule_slots` 以（星期、開始、結束）比對時段，換算前後產生的時段相同，不會刪建既有時段。
- **停止申請的語意**：園方手動關閉（`closed_source=manual`）只代表不收新預約，已占名額的案件照常有效，**不再列入「待人工處理」**。`attention.py:35` 的 `closed_upcoming_slots` 改為只看 `closed_source='exception'`（休假日）。休假日關閉仍會把當天已預約的案件列入待人工處理。
- `POST /admin/visit-schedule/{campus_key}/generate`（`schedule_routes.py:185`）保留給 CLI 與相容，後台不再有按鈕。
- 手動加開一場沿用 `POST /admin/slots`（`routes.py:588`），名額調整與停止／恢復沿用 `PATCH /admin/slots/{id}`（`routes.py:618`）。

## 4. 前端

### 4.1 官網預約表單（`web/app/components/VisitForm.vue`）

- 只剩自選場次。`resolveBookingAction`（`web/app/utils/booking-action.ts:30`）移除 inquiry 分支；CTA 一律「選擇參觀日期與場次」。
- Email 改必填，說明「確認信與修改連結會寄到這裡」。
- 拿掉「方便接電話的時段」欄位（`VisitForm.vue:584`）。
- 新錯誤碼文案：`SLOT_REQUIRED`、`EMAIL_REQUIRED`（422 時聚焦對應欄位）。

### 4.2 結果頁

- 只有一種成功狀態：標題「預約成功」＋綠勾（取代 `resultCopy` 的 confirmed「預約成立」與另外兩種語意，`VisitForm.vue:177-198`）。
- 摘要清單：校區、日期、場次（`10/02（五）上午場 10:00`）、參觀人數、孩子姓名與生日、家長稱呼、電話、Email、得知管道、想了解的事。
- 主按鈕「修改或取消預約」→ `manage_url`；次按鈕「複製連結」；提示「請收藏這條連結」。
- `parent_email_enabled` 為 true：「確認信已寄到 w***@gmail.com，沒收到請看垃圾信件匣」。為 false：「請收藏上方連結，之後要改時間或取消都從這裡進入」。
- 加入行事曆與導航（`VisitCalendarActions.vue`）保留；行程內仍不放孩子資料、電話與管理連結（2026-09-26 裁定）。

### 4.3 管理頁（`web/app/pages/visit/manage.vue`、`composables/useParentVisit.ts`）

- 顯示：校區名稱、地址、電話；日期與場次；參觀人數；家長稱呼、電話、Email；孩子姓名與生日；想了解的事；「{截止時間}前可以線上修改」。
- 改場次：沿用現有場次下拉（公開 `/public/slots` 今天起 60 天），送出直接呼叫 §3.3 reschedule，成功後頁面刷新並提示「已改到 10/05（一）下午場 14:30，確認信已寄出」。
- 修改資料：表單帶目前值，送 `PATCH`；版本衝突提示重新載入。
- 取消預約：二次確認（「取消後這條連結會失效」），成功後顯示「預約已取消」與「重新預約」。
- 截止後三個操作都隱藏，改顯示「距離參觀不到 {N} 小時，要更改請來電 {分校電話}」。
- 舊案件（沒有場次）只有「取消這筆需求」。
- 頁面維持 `noindex`、`no-referrer`、`Cache-Control: no-store`，token 讀完即從網址移除（現行做法）。

### 4.4 場次名稱

- 共用函式：開始時間 < 12:00 為「上午場」，否則「下午場」，格式 `上午場 10:00`。
- 用在：官網結果頁與管理頁、家長信件、後台月曆與列表。官網選場次時的清單也加上前綴。
- 後端（信件）與前端（web、admin）各有一份實作，用同一組測試案例（09:59→上午、12:00→下午）。

### 4.5 後台：參觀案件列表（`admin/src/views/VisitRequestsView.vue`）

- 分頁：全部、預約正常、時間已過、已取消。`pending` 組筆數 > 0 時多一個「待處理（N）」分頁，排在「全部」之後。
- 分頁數字來自 `group-counts`；網址參數改用 `?group=`，舊的 `?status=` 連結轉成對應的 group。
- 狀態欄（依 `display_status`）：
  - `upcoming`：綠字「預約正常」。
  - `pending`：暖黃「待處理」；舊的 contacting 顯示「待處理・聯絡中」，pending_confirmation 顯示「待處理・待確認」。
  - `past`：灰字「預約時間已過」；completed 加一行「已到場」，no_show 加一行「未到場」，仍是 confirmed（還沒標記）的加一行「尚未確認到場」。之後的招生入學模組（`docs/specs/2026-09-30-website-admissions-design.md` §6.1）要靠「標記已到場」建立招生訪視，這行提示讓園方知道還有待確認的預約。
  - `cancelled`：紅字「預約已取消」，第二行小字「家長取消：09-28 18:45」／「園方取消：…」／「逾期未確認：…」（`cancel_reason`＋`cancelled_at`；舊資料無來源時只寫「取消時間：…」）。
- 「下一筆」與側欄數字只算 `pending` 組（舊資料清完就是 0）。
- 顏色走既有 token，不寫字面值。

### 4.6 後台：案件明細（`admin/src/views/VisitDetailView.vue`）

- 移除「開始聯絡」（`:791`）、「退回聯絡中」（`:820`）。
- pending 組舊案件：只有「排入場次」與「取消這筆需求」。
- `confirmed`：「改期」、「取消預約」。兩個確認框都寫出「會寄信通知家長（w***@gmail.com）」；沒有 Email 時寫「這筆沒有 Email，請電話通知家長」。
- 場次結束後才出現次要按鈕「標記已到場」「標記未到場」（沿用 `/complete`、`/no-show`）。
- 家長連結區（`ParentAccessLinkPanel.vue`）：顯示連結有效期限，兩個按鈕「重寄確認信」「重新產生連結並寄出」。
- 改期申請核准區只在該案有 pending 的舊 `reschedule_requests` 時出現。

### 4.7 後台：各校預約方式（`admin/src/views/BookingSettingsView.vue`）

- 模式選項：自選場次、暫停線上預約、LINE、電話、外部網址（移除「填表待聯絡」）。
- 移除「自動確認」開關。自選場次說明：「家長看得到你開放的場次，選好送出即預約成功，並收到確認信與修改連結。」
- 新增唯讀一行：「確認信：已啟用」或「尚未設定寄信，家長只會在畫面上看到修改連結」（讀 `parent_email_enabled`）。
- 家長修改期限（`parent_change_deadline_hours`）說明改為「參觀前幾小時內，家長不能再線上改場次、改資料或取消」。

### 4.8 後台：參觀場次（合併「時段與容量」與「接待月曆」）

一頁完成場次設定與每天的停開。路由沿用 `/visit-calendar`，側欄名稱改為「參觀場次」；`/slots` 轉址到 `/visit-calendar?campus=…`。`VisitSlotsView.vue` 與 `VisitSchedulePanel.vue` 移除，改寫 `VisitCalendarView.vue` 並拆出子元件（固定場次卡、月曆格、當天清單）。頁面一次看一個校區（校區選單寫進網址，沿用 2026-09-28 規則）。

**上方：每週固定場次卡**
- 平常是摘要：每個場次一行「上午場 10:00・每場 1 組・週一–週五」，下面一行「家長可預約：明天起 2 個月內」，右側「修改場次」（需 `booking.manage`）。
- 按「修改場次」在原地展開編輯，每個場次一列：
  - 場次時間（下拉，30 分鐘一格，07:00–18:00）。場次名稱依 §4.4 自動顯示「上午場／下午場」。
  - 每場組數（下拉 1–10，另可輸入更大值）。
  - 開放星期（七顆可切換的按鈕，新場次預設週一到週五）。
  - 刪除這一列。
  - 「＋新增場次」。
- 「進階」收合區（預設收起）：
  - 每場參觀約多久：30／45／60／90／120 分鐘，預設 60。所有場次共用；舊規則若長度不一致，改在每一列顯示長度。
  - 家長最晚何時預約：參觀前 2 小時／12 小時／1 天／2 天／3 天（對應 `min_lead_hours`，預設 1 天）。
  - 最多可預約多久以後：2 週／1 個月／2 個月／3 個月（對應 `max_advance_days` 14／30／60／90，預設 2 個月；舊值不在選項內時照原值顯示）。
- 存檔：
  - 每個（場次 × 勾選的星期）換成一條 `visit_rules`：`start_time`＝場次時間、`end_time`＝開始＋長度、`slot_minutes`＝長度、`capacity`＝組數。
  - 讀取時反向換算：每條規則依 `slot_minutes` 展開成各場開始時間，以（開始時間、長度、組數）分組、合併星期。舊的多場區間規則（例如 09:30–11:00 每 30 分鐘）會展開成三個場次，存回後產生的時段相同。
  - 按「儲存」後立即補場次（§3.7），成功訊息「已儲存，已排出 10/01–11/30 的場次」。
  - 規則變更後，仍有家長預約、但已不在新規則裡的場次，照舊保留，並提示「10/08 上午場 10:00 已有家長預約，不在新的固定場次內，仍照常接待；不想再收新預約，請在月曆按停止申請」。
- **第一次設定（還沒有任何場次）**：卡片改為引導，主按鈕「套用常用場次」，內容是上午場 10:00、下午場 14:30，週一到週五，每場 1 組，每場 60 分鐘。按下後展開編輯並帶入這些值，可以修改後再存。
- **分校還沒開放線上預約時**（模式不是 `slots`，且使用者有 `booking.manage` 與預約設定權限）：存檔按鈕寫「儲存並開放線上預約」，確認框寫「家長從現在起可以在官網預約這些場次」。確認後依序存規則、把模式切成 `slots`（`PATCH /admin/booking-config`，照常檢查 readiness）。readiness 不過時，規則仍會存好，並顯示還缺什麼（例如「預約同意文字尚未發布」＋連結）。只有場次權限時只存規則，並提示「請校區管理者到各校預約方式開放」。

**下方：月曆**（資料來自既有 `GET /admin/visit-calendar`，`routes.py:680`；休假日來自 `GET /admin/visit-schedule/{campus_key}` 的 exceptions）
- 月曆格內每場一個色塊：
  - 有預約：`上午場 王小明`，每位預約一塊，超過三塊收成「＋N」。
  - 已停止申請：紅色 `上午場停止申請`。
  - 開放中、沒人預約：淡色 `下午場 可約 2`。
  - 休假日：整格淡灰底、寫休假原因。
  - 已過的日期灰階。
- 點某一天，右側（手機是下方）列出當天清單：
  - 每一場：`上午場 10:00・已約 1/2 組`，接著列出預約家長（家長稱呼、孩子姓名、人數，點了進案件）。
  - 每一場的按鈕（需 `booking.manage`；接待人員只能看）：開放中顯示「停止申請」，已停止顯示「恢復開放」，另有名額下拉（不能低於已約組數）。停止申請直接生效、不跳選項；已有預約時提示「已約好的 N 組家長照常參觀」。
  - 當天按鈕：「整天休假」（填原因，選填），已休假則顯示「取消休假」。當天還有預約時，確認框寫「這天還有 N 組家長預約，設為休假後不會自動取消，請逐筆改期或取消（會寄信通知家長）」，確認後把那幾筆列在清單最上方。
  - 「＋加開一場」：選時間與組數，沿用 `POST /admin/slots`。
- 版本衝突（`SLOT_VERSION_CONFLICT`）時重新讀取當天，並提示「這一場剛被其他人修改」。

### 4.9 後台：補登（`admin/src/components/ManualVisitDialog.vue`）

- 「直接排入時段（選填）」（`:244`）改為必選「參觀場次」，placeholder「選擇場次」。
- 家長 Email 欄位說明「有填會寄確認信與修改連結」。
- 成功訊息固定「已補登，參觀時間 …」（移除「案件狀態為待處理」分支）。

## 5. 資料遷移與相容

### 5.1 Migration（一支，接在 main 的 alembic head 之後）

上線前依 `deploy/README.md` 備份閘門先備份正式 DB。

1. `booking_configs`：
   - `mode='inquiry'` 的分校：若有任一 `visit_rules` 列，或有未來、未關閉的 `visit_slots`，改為 `slots`；否則改為 `paused`，且 `message` 為空時填入「線上預約即將開放，請來電 {campuses.phone}」（沒有電話時只寫前半句）。
   - 所有列 `slots_auto_confirm = true`。
   - 有改動的列 `version = version + 1`，讓還開著舊表單的家長送出時收到 `BOOKING_CONFIG_CHANGED`。
   - 每一校的改動寫一筆 `audit_logs`（actor 為 system、action `booking_config.migrate_self_booking`，metadata 有 before／after）。
2. `visit_requests.cancel_reason` 新增欄位；從 `visit_request_events` 回填：取每案最後一筆取消類事件，`hold_expired` → `hold_expired`，source=parent → `parent`，source=staff → `staff`；舊歷程沒有 `source` 的回填為 NULL。
3. downgrade：只刪 `cancel_reason`；不把模式改回 `inquiry`（無法還原哪些是 migration 改的以外，也不應讓官網退回舊流程）。

### 5.2 相容與上線順序

- web 與 api 在同一次部署上線。舊版前台在空窗期送出沒有 `slot_id` 的表單會收到 422 `SLOT_REQUIRED`（或因 `version` 遞增收到 `BOOKING_CONFIG_CHANGED`），前台顯示「預約方式已更新，請重新整理」。
- 既有 new／contacting／pending_confirmation 案件保留原狀態，出現在「待處理」分頁；pending_confirmation 仍由 `expire_holds` 在逾期時釋放。
- 既有 token（隨機產生）可照常兌換直到到期；本案上線前建立的案件沒有 `manage_url`，後台可按「重新產生連結並寄出」補發。
- 既有 pending 的改期申請照常在後台處理。

## 6. 測試

**後端（pytest，真 PostgreSQL）**
- 送單：一律 `confirmed`；缺 `slot_id` 422；缺 Email 422；`inquiry` 設定下公開端回 paused。
- 修改連結：新建與重播的 `manage_url` 相同；raw 可兌換；撤銷後 `current_manage_url` 為 None；更換密鑰後舊連結失效；有效期計算與改期延長；舊隨機 token 仍可兌換。
- 家長改期：成功、截止後 409、同時段、非公開可訂；**最後一個名額「家長改期」與「新預約」並發只一方成功**（沿用 `test_booking_concurrency.py` 的做法）。
- 家長改資料：版本衝突、欄位驗證、Email 不可清空、無變更不寫歷程、截止後 409、`PARENT_SESSION_CHANGED`。
- 寄信：三種 kind 各自的觸發點（§3.4 表）；payload 不含 raw token；取消信沒有修改連結；無 Email／無 adapter 標 `skipped`；去重；sink adapter 內容含正確場次文字與連結。
- 後台：補登必選場次並寄信；排入場次發連結與寄信；`/contacting` 410；`resend-confirmation`；`access-link` 重新產生並寄出；`BOOKING_MODE_RETIRED`。
- 列表：`group` 四組條件（含場次剛好開始的邊界）、`group-counts`、`display_status`、`cancel_reason` 寫入。
- 場次：`PUT visit-schedule` 後同一請求內已補好場次；園方手動停止申請的場次上的案件不列待人工處理、休假日的仍列。
- Migration：inquiry→slots（有規則）／→paused（無規則，含訊息填入與不覆蓋既有訊息）、`version` 遞增、`cancel_reason` 回填。
- 既有測試中依賴 inquiry、`slots_auto_confirm=false`、`mark_contacting`、`reschedule-request` 的案例改寫或移除，並在 PR 說明列出。

**後台（vitest）**：列表分頁與狀態欄（四種 display_status 與取消來源）、`?status=` 轉 `?group=`、明細按鈕依狀態顯示、補登必選場次、預約設定頁無自動確認與無 inquiry、`labelCoverage` 含新 kind；參觀場次頁：規則⇄場次換算（含舊的多場區間規則來回不變、長度不一致）、套用常用場次、儲存並開放線上預約（readiness 通過與不通過、權限不足）、月曆色塊、停止／恢復／名額／整天休假／加開、接待人員唯讀、`/slots` 轉址。

**官網（vitest）**：Email 必填與錯誤碼文案、結果頁兩種寄信文案與連結、管理頁改場次／改資料／取消／截止、場次名稱推導、`resolveBookingAction` 無 inquiry。

**stack e2e（`tests/stack/booking-flow.spec.ts`）**：家長選場次 → 預約成功 → 從結果頁進管理頁 → 改場次 → 改資料 → 取消；用本機 sink 檔驗三封信的主旨與連結。`schedule-flow.spec.ts` 改寫為：參觀場次頁套用常用場次 → 儲存並開放線上預約 → 月曆停止申請一場 → 官網該場消失 → 恢復開放 → 整天休假。沿用記憶中的地雷：自訂 `E2E_DB_NAME`／埠、`submitPublicRequest` 的校區＋手機別撞號。

**畫面**：Playwright 桌機 1440、手機 390 驗結果頁、管理頁、後台列表、月曆。

**驗證指令**：`npm --prefix web run typecheck`、`npm run test:website`、`npm run contract:check`、backend pytest、stack e2e。

## 7. 上線前人工步驟（使用者執行）

1. **寄信帳號**：Railway api 設 `WEBSITE_SMTP_HOST／PORT／SECURITY／USERNAME／PASSWORD／FROM`。
   - 最省事：Gmail 或 Google Workspace 應用程式密碼（免費，每日上限約 500 封）。
   - 用學校網域寄件要先設 SPF／DKIM，否則易進垃圾信件匣。
   - 不設也能上線：家長只在畫面上看到連結，`parent_email_enabled=false`。
2. **各校設定場次**：正式站上線本案後，各校到後台「參觀場次」按「套用常用場次」→ 調整 → 「儲存並開放線上預約」，一步完成。上線時還沒設場次的校會先顯示暫停（請來電），設好就開放；上線前若已在舊的「時段與容量」頁設好規則，migration 會直接切成自選場次。
3. **同意文字**：確認各校已發布的預約同意文字提到「Email 用於寄送預約確認與修改連結」（實作時列出建議字句）。這次改版本來就要改同意文字，**建議同一次一起寫明參觀後的招生用途**：參觀後園方會依預約資料聯繫，並記錄入學意願與進度。之後的招生入學模組會把到場預約的孩子與聯絡資料複製成招生紀錄，保存期限另訂（`docs/specs/2026-09-30-website-admissions-design.md` §11、§15 Q1）。實際字句與保存天數由業主裁定；若業主決定招生用途另案處理，這一步只寫 Email。
4. 上線前依備份閘門備份正式 DB；上線後唯讀檢查五校模式。
5. 知悉：更換 `WEBSITE_SESSION_SECRET` 會讓家長的修改連結全部失效。

## 8. 文件更新（隨實作一起改）

- `DESIGN.md`：新增「家長自選場次預約（2026-09-30 業主裁定）」章節，寫 §1 裁定、後台狀態顯示規則與「參觀場次」頁規則；標註 2026-09-28「新需求／聯絡中叫取消這筆需求」只剩舊資料適用、「關閉時段三選一」與「時段頁每週規則收成摘要」由參觀場次頁取代。
- `docs/specs/2026-09-19-website-admin.md`：§5、§6.1、§6.2、§6.4 頂端加註「2026-09-30 起以 `2026-09-30-parent-self-booking-design.md` 為準」。
- `docs/handoff/2026-09-19-claude-website-admin.md`「預約不可違反的規則」第 1 條改為新語意。
- `CLAUDE.md`「官網後台任務」的預約語意那一行同步。
- `deploy/README.md`：本次部署紀錄、§7 人工步驟、密鑰更換影響。
- `README.md` 頂部加日期段落。
