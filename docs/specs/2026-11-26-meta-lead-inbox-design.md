# Meta 名單型廣告（即時表單）→ 後台「廣告名單」收件匣（設計）

- 日期：2026-11-26
- 狀態：使用者 11-26 決定「廣告名單收件匣、人員確認後轉案件」「後端每分鐘主動拉取」「收件匣＋回傳名單編號」；分支 `feature/meta-lead-inbox`
- 基準：`origin/main` `a24df7f4`

## 1. 為什麼要做

義華 12/19 假日參觀日開始投 Facebook／Instagram 名單型廣告（即時表單）。家長在 Meta 裡填完表單，名單只存在 Meta 的「潛在顧客中心」，櫃檯要另外登入下載、再一筆一筆打進後台補登。目標是名單自動進官網後台，櫃檯打電話確認後一鍵轉成參觀案件；轉成的案件到場、預繳時，回傳 Meta 的事件帶上名單編號，日後才能用 Meta 的「轉換名單最佳化」。

## 2. 目標、非目標、反目標

**目標**
- 後端每分鐘向 Meta 拉各校粉專即時表單的新名單，存進收件匣（`meta_leads`）。
- 後台「參觀預約」→「廣告名單」：選校、看名單（姓名、電話、表單作答、表單名稱、收到時間），按「轉成參觀案件」或「略過」。
- 轉成案件：打開原本的「補登案件」對話框並帶入家長資料與作答，人員選場次送出；同一個交易把名單標成已轉案件、記下案件 id。案件的網站來源寫 `ads`、廣告平台寫 `meta`，`ad_click_ids` 寫 `meta_lead_id`。
- 案件之後「標記已到場」「已預繳」時，既有的廣告回傳（`ad_conversions`）對 Meta 多送 `user_data.lead_id`（CRM 名單事件格式），不必另外排工作。
- 新名單進來時推一則文字訊息到該校的 LINE 群組（有綁才推），每筆名單只推一次。

**非目標**
- 自動建案（規格 6.2：不得憑外連點擊自動建案，只能由人員確認後補登；而且案件一建立就占場次名額）。
- Meta webhook 即時推送（要建 Meta App、開公開端點、驗簽章；之後要秒到再加）。
- 自動對應場次：表單的「希望時段」只是作答文字，由人員在補登對話框選場次。
- 新的案件來源值：`source` 仍用補登的四種（預設 `phone`），Meta 來源由網站來源欄位與名單關聯表達。`source` 也送給 ivy 管理系統（`integrations/ivy_management`），加值會牽動外部系統。

**反目標**
- token、名單內容出現在日誌、錯誤訊息、操作紀錄或 `meta_lead_sync.last_error`。
- 名單個資在收件匣裡無限期保存（見 §6）。
- 回傳 Meta 時送姓名、電話或其雜湊（只送 Meta 自己發的 `lead_id`）。

## 3. 設定（環境變數，Railway Secrets）

沿用粉專貼文同步的 token 與粉專清單（`WEBSITE_FACEBOOK_ACCESS_TOKEN`、`WEBSITE_FACEBOOK_PAGES`），另加：

| 變數 | 說明 |
|---|---|
| `WEBSITE_META_LEADS_ENABLED` | 預設 `false`。開了才拉名單；要先有 Facebook 粉專同步設定，否則拒絕啟動。 |
| `WEBSITE_META_LEADS_SYNC_SECONDS` | 預設 60（60–3600）。 |
| `WEBSITE_META_LEADS_RETENTION_DAYS` | 預設 90（30–365）。沒轉成案件的名單收到幾天後刪除。 |

token 需要的權限：原本的 `pages_show_list`、`pages_read_engagement`，再加 `leads_retrieval`、`pages_manage_ads`（讀表單清單）。粉專若在「潛在顧客存取權管理員」限制了存取，要把產生 token 的使用者或系統使用者加進去。義華目前是單一粉專的長效 Page token，要重新產生一把含上述權限的 token。

## 4. 資料

`meta_leads`（一筆名單一列）：`id`、`campus_key`、`lead_id`（Meta 名單編號，唯一）、`form_id`、`form_name`、`ad_id`、`campaign_id`、`platform`（`fb`／`ig`）、`is_organic`、`created_at`（Meta 收到的時間）、`fetched_at`、`parent_name`、`phone`（台灣手機轉成 `09` 開頭）、`answers`（JSON：`[{question, answer}]`，不含姓名電話）、`status`（`new`／`converted`／`dismissed`）、`visit_request_id`、`handled_by`、`handled_at`、`notified_at`。

`meta_lead_sync`（每校一列）：最近一次拉取的時間、結果、讀到幾筆、錯誤（只有步驟、HTTP 狀態、Meta 錯誤代碼）、`cursor_at`（已拉到哪個建立時間，下一輪從這裡往前重疊 10 分鐘再拉，靠 `lead_id` 唯一鍵去重）。

## 5. 流程

1. 拉取（`app/meta_leads/sync.py`，獨立迴圈 `app/workers/meta_leads_loop.py`，比照 `FacebookSyncLoop`；過期刪除在 `app/workers/maintenance.py`）：每校換 Page token → 讀粉專的即時表單清單 → 每張表單讀 `cursor_at` 之後的名單（分頁跟到底，單校單輪上限 500 筆）→ 一校一個短交易 upsert（同 `lead_id` 不覆蓋狀態與已清掉的個資）。網路請求都在交易外。
2. 通知：寫完後挑這校 `notified_at IS NULL` 的名單，推一則「新的廣告名單」卡片到該校 LINE 群組（2026-11-28 起是 Flex 卡片：整條 Meta 藍標題列、白字，和白底的官網參觀通知分開；內容只有校區與筆數，一顆「開啟廣告名單」按鈕；原本是純文字＋網址），成功才寫 `notified_at`（失敗下一輪再試；第一次啟用時只通知 24 小時內收到的，舊的直接標已通知）。
3. 轉案件（`POST /admin/visit-requests` 多帶 `meta_lead_id`）：鎖名單列、核對同校與狀態（`new` 或 `dismissed`），建案時帶網站來源欄位；建好（不是重播）就把名單標 `converted`、記 `visit_request_id`，並清掉名單上的姓名、電話、作答。
4. 略過／放回：只在 `new`、`dismissed` 之間切換。
5. 回傳：`PLATFORM_KEYS["meta"]` 加 `meta_lead_id`。送 Meta 時案件有 `meta_lead_id` 就送 CRM 名單格式：`action_source=system_generated`、`user_data.lead_id`、`custom_data.event_source=crm`、`lead_event_source=ivy-website`。

權限沿用參觀案件：看名單 `booking.read`，轉案件、略過、立即同步 `booking.handle`，都受校區範圍限制。

## 6. 個資

- 轉成案件時清掉名單上的姓名、電話、作答（資料已在案件裡，之後跟著案件的保存政策走）。
- 沒轉的名單（新的、略過的）收到 `WEBSITE_META_LEADS_RETENTION_DAYS` 天後由 maintenance 每輪刪除（不看功能開關，關掉後照刪）；Meta 自己也只保留 90 天可下載。
- 匿名化案件時 `ad_click_ids` 整欄清掉（既有行為），`meta_lead_id` 一起消失，還沒送的回傳記 skipped。

## 7. 上線步驟（使用者在正式站做）

1. 在 Meta 產生含 §3 權限的 token，更新 `WEBSITE_FACEBOOK_ACCESS_TOKEN`。
2. 設 `WEBSITE_META_LEADS_ENABLED=true`。
3. 後台「廣告名單」按「立即同步」確認讀得到；有錯誤時頁面顯示步驟與 Meta 錯誤代碼。
