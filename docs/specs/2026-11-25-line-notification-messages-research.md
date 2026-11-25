# LINE 通知型訊息（用電話號碼推給家長）研究與套用評估（2026-11-25）

使用者已完成官方帳號認證，想用「LINE 通知型訊息」（官方英文名 LINE notification messages，業界俗稱 PNP／LON）把預約通知直接用電話號碼送到家長的 LINE。本文是研究結論與套進本專案的做法。

**2026-11-25 已實作（預設關閉）**，做法見 §6；§3 是實作前的規劃，和實作不同處以 §6 為準。

## 0. 一句話結論

做得到，而且正好補上現在最大的缺口：**沒留 Email、也沒按「用 LINE 接收通知」的家長，現在完全收不到預約成功通知**（`backend/app/booking/outbox.py:63`）。官網預約手機是必填（`09` 開頭 10 碼，`backend/app/booking/schemas.py:91`），開通後沒留 Email 的家長也能在 LINE 收到預約成功、提醒、取消，不必先加好友、不必綁定（有留 Email 的照舊只收信，見 §5）。台灣有現成的「預約完成／預約取消／預約提醒」官方範本，可以不用自己設計版面送審。

卡關的不是程式，是**申請**：這個 API 不是認證完就能用，要另外向 LINE 申請開通（§2）。

## 1. 查證過的規則

來源：developers.line.biz 的 overview、technical-specs、template、API reference、delivery webhook 五頁，與 tw.linebiz.com 通知型訊息頁、專欄（2022-10-18）。2026-11-25 讀取。標「第三方」的是代理商部落格，沒有官方佐證。

### 1.1 是什麼、誰能用

- 用電話號碼指定收件人，**對方沒加好友也收得到**；訊息出現在家長和官方帳號的一對一聊天室，標「重要通知」（LINE 15.9.0 以上）。
- 只限日本、泰國、**台灣**建立的官方帳號，電話也要是這三國門號。
- 台灣官方：「需為認證（藍盾）／企業（綠盾）官方帳號」。
- **要另外申請**：「Only corporate users who have submitted the required applications can use the functions」。沒開通時範本 API 回 403 `Access to this API is not available for your account`。
- 內容只能是通知（預約、帳單、出貨、OTP…），**不能有行銷、促銷**；tw.linebiz.com：「內容需經由 LINE 官方審核」。

### 1.2 兩種版本

| | 範本型（template） | 彈性型（flexible） |
|---|---|---|
| 端點 | `POST https://api.line.me/v2/bot/message/pnp/templated/push` | `POST https://api.line.me/bot/pnp/push`（沒有 `/v2`） |
| 成功 | 202 `{}` | 200 `{}` |
| 內容 | 指定 `templateKey`＋項目＋最多 2 個網址按鈕；標題、說明、頁首頁尾 LINE 固定 | 最多 5 則 Messaging API 訊息（文字、Flex），**不能有圖片、影片、聲音** |
| 審核 | 文件沒寫要另外審版面 | **要先過 LINE 的 UX 審查**才能送 |
| 本案 | **建議先用這個** | 停課通知等範本對不上的情況再考慮 |

2025-06-02 推出範本型，原本的版本改名「彈性型」。

### 1.3 台灣可用的範本（實際把官方頁的「Taiwan」分頁跑出來抓的，共 30 個）

本案用得到的：

| 範本 key | 標題 | 固定說明文字 |
|---|---|---|
| `reservation_completed_zh` | 預約完成通知 | 您好，已成功為您完成預約。 |
| `reservation_cancellation_zh` | 預約取消通知 | 您好，您的預約已為您取消。 |
| `reservation_reminder_zh` | 行程預約提醒 | 您好，提醒您即將到來的預約行程。 |
| `inquiry_contact_guidance_zh` | 顧客服務管道引導 | 謝謝您的來電。提醒您，您可以將我們加入好友，並直接透過此官方帳號聊天室傳送您的諮詢內容。 |

沒有通用的「預約變更」範本（只有交通業的 `reservation_changed_transport_zh`），也沒有「停課」範本。

可用的項目（label 由 LINE 固定）：`reservation_date_time_zh`（預約日期/時間：）、`reservation_detail_zh`（預約內容：）、`reservation_count_zh`（預約人數：）、`contact_phone_zh`（聯絡電話：）、`service_name_zh`（服務公司：）等 39 個。按鈕：`check_details_zh`（查看詳情）、`inquiry_by_line_zh`（透過 LINE Call 諮詢）等 9 個。

限制：`emphasizedItem` 1 個、內容 **15 字**；`items` 最多 15 個、各 300 字；`buttons` 最多 2 個、網址 1000 字；同一個項目不能用兩次。

### 1.4 電話號碼怎麼送

- `to` 是 **E.164 格式再 SHA-256、小寫十六進位**，不能有連字號。台灣：`0912345678` → `+886912345678` → `1315ec4a…271be0`。
- 官方範例 `+818000001234` 的雜湊我用 Python 算過，和文件一致，確認是小寫十六進位。
- 一次只能送一個號碼，不能送群組。

### 1.5 家長那端會發生什麼

- 送得到的條件（全部要成立）：電話和家長 LINE 綁的電話相同、這支電話近期通過 LINE 的簡訊認證、家長同意接收通知型訊息、沒封鎖這個官方帳號、同意 LINE 2022-03 版隱私權政策。
- 同意狀態有三種：同意、拒絕、未設定。**未設定的人第一次收到時 LINE 會先問要不要接收，24 小時內沒同意就丟掉**。家長隨時可到 LINE「設定 → 隱私設定 → 提供使用資料 → LINE 通知型訊息」關掉。
- 每次送達，名為「LINE」的系統帳號會另外傳一則「已收到通知型訊息」，我們關不掉。
- 收到後家長可以直接在聊天室回話（沒加好友也能），webhook 會收到非好友的 message／postback；也可能收到「從沒 follow 過的人的 unfollow」。

### 1.6 送達確認與錯誤

- **回 200／202 不代表送到**。真的送到時，官方帳號的 webhook 會收到 `type: "delivery"` 事件，`delivery.data` 是我們送出時帶的 `X-Line-Delivery-Tag`（16–100 字元；沒帶就是電話雜湊）。**24 小時內沒收到＝沒送到**（封鎖、沒同意、沒認證）。
- 422 `Failed to send messages`：這支電話沒有 LINE、不是台日泰門號、家長拒收、或沒同意 LINE 隱私權政策。不必重試。
- **不支援 `X-Line-Retry-Key`**。現在推播靠 retry key 防重複（`backend/app/notifications/line.py:142`），通知型訊息沒有這層保護：逾時後重送可能讓家長收到兩則、付兩次錢。
- 速率上限每秒 2,000 次，本案用不到。
- 每天送達幾則：`GET https://api.line.me/v2/bot/message/delivery/pnp/templated?date=yyyyMMdd`（彈性型去掉 `/templated`），日期以 UTC+9 計，通常隔天才算好。

### 1.7 費用

- tw.linebiz.com：**每則 0.2 元**（對照簡訊 0.8–2 元）。官方技術文件：**只有真的送到的才計費**。
- 月費、開通費、最低消費、自行串接和找代理商價格差多少：官方沒寫。代理商常見「串接費＋訊息服務費」（第三方：開通 6,000、月租 5,000 起、每則 0.45，**這是代理商價，不是 LINE 的**）。
- 和官方帳號每月推播額度是否分開計：第三方說分開，官方沒寫清楚。
- 估算：只送沒留 Email 的家長（§5），這類預約一筆約 2–3 則（預約成功＋前一天提醒，偶爾變更或取消），約 0.4–0.6 元。

## 2. 申請（使用者要做，程式做不了）

1. tw.linebiz.com「廣告方案洽詢」表單（`/contact-us/inquiry-ad/`）：產品選「LINE 通知型訊息」，開發團隊選「**自行開發**」（我們自己串 API，不必找技術夥伴）。要填公司名稱、統一編號。LINE 註明不保證回覆所有申請；審核時間、要準備的文件官方沒寫。
2. 和業務確認：
   - 開通哪個（些）官方帳號（見 §5 決策 1）。
   - 能用範本型嗎（台灣範本是否全開、`reservation_*_zh` 能不能用）。
   - 計價（每則 0.2 是否適用自行串接、有沒有月費或預付）、帳單怎麼開。
   - 用途說明：幼兒園家長預約參觀的「預約完成／取消／前一天提醒」，不含任何招生行銷。
3. 開通後**不必換金鑰**：用的是同一個 Messaging API channel 的 access token。

## 3. 套進專案的做法

### 3.1 跟現有家長 LINE 通知的關係

11-16 已經做了「家長傳代碼綁定 → 用一般推播送卡片」（`docs/specs/2026-11-16-line-integrations-design.md` §4–§5）。通知型訊息是**補位**，不取代它：

| 家長狀態 | 現在 | 加上通知型訊息後 |
|---|---|---|
| 有綁 LINE | 一般推播卡片 | **不變**（卡片資訊較完整，也已經通了） |
| 沒綁、有 Email | 只有 Email | **不變**，只有 Email（使用者 11-25 決定） |
| 沒綁、沒 Email | **什麼都收不到** | 通知型訊息 |

同一則通知對同一位家長，LINE 只送一種，不重複。判斷用送出當下的案件：家長後來補了 Email，之後的通知就改走 Email。

### 3.2 各種家長通知對應的範本

| 通知（`booking/outbox.py`） | 範本 | 強調項目（≤15 字） | 其他項目 | 按鈕 |
|---|---|---|---|---|
| 預約成功 `parent_visit_booked` | `reservation_completed_zh` | 日期/時間：`12月3日（三）09:30` | 預約內容：`常春藤義華 校園參觀 09:30–10:30／地址…`；預約人數：`2 位`；聯絡電話 | 查看詳情 → 修改連結（使用者 11-25 決定要放；修改期限過了就不放按鈕，同 Email） |
| 已變更 `parent_visit_changed` | `reservation_completed_zh`（說明文字「已成功為您完成預約」，用在改期也說得通） | 新的日期/時間 | 同上 | 同上 |
| 已取消 `parent_visit_cancelled` | `reservation_cancellation_zh` | 原本的日期/時間 | 預約內容；聯絡電話 | 查看詳情 → 重新預約頁（分校停用就不放） |
| 參觀提醒 `parent_visit_reminder` | `reservation_reminder_zh` | 日期/時間 | 預約內容（含地址）；聯絡電話 | 查看詳情 → 修改連結（期限內） |
| 停課 `parent_visit_day_closed` | **沒有合適範本**：「取消」說明文字會說預約已取消，但停課是請家長改約 | — | — | 先維持現狀（園方來電）；要的話走彈性型送審 |

內容不放家長姓名、孩子資料（範本也沒有稱呼欄位）。

### 3.3 要改的地方（預設關，沒設變數＝行為和現在一樣）

1. **設定**（`backend/app/config.py:518` 附近）：哪些帳號開通了通知型訊息，例如 `WEBSITE_LINE_<帳號>_PNP=template`。未開通的帳號照舊。後台 LINE 通知頁顯示每個帳號是否開通、昨天送達幾則。
2. **用哪個帳號送**：使用者認證的帳號**目前還沒接上專案**（11-25）。接法要看它是哪個帳號：是 `main` 或五校之一，就設好那組 `WEBSITE_LINE_<帳號>_*` 金鑰、webhook 貼後台列的網址；是另一個帳號，就要新增一組帳號鍵與 webhook 路由（`delivery` 事件和非好友家長的回話都送到那個帳號的 webhook）。各校通知型訊息用哪個帳號，比照「家長 LINE 通知」在後台每校選。
3. **LINE client**（`backend/app/notifications/line.py`）：加 `pnp_templated_push(phone_hash, template_key, body, delivery_tag)`、`pnp_delivered_count(date)`、`tw_phone_hash("09…") → sha256("+8869…")`。httpx 日誌比照 `_HideUserIdUrls` 確認不會印出電話雜湊。
4. **排入**（`booking/outbox.py:63`、提醒）：「沒 Email 也沒綁 LINE 就不排」改成「…而且這校也沒開通知型訊息才不排」。停課通知不走通知型訊息（§3.2），不改。狀態機登記表的 guard 文字（`state_machines.py:71`）跟著改，再 `npm run contract:generate`。
5. **送出**（`notifications/service.py:315` `_dispatch_parent_email`）：**案件沒有 Email**、沒有有效綁定（`:344`）、這校帳號有開通時，才走第三個管道 `line_pnp`，`notification_deliveries` 記 `line_pnp`／`parent:<id>`。有 Email 的家長一律不送通知型訊息。
   - 422 → 記「這支電話收不到」，**不重試**，也不讓整筆重試。
   - **逾時、連線中斷 → 不自動重送**（沒有 retry key，重送可能重複又重複計費）。只有「確定沒送出去」（連不上、429）才重試。
6. **送達回報**：`X-Line-Delivery-Tag` 帶 outbox 訊息 id 的 32 位十六進位（符合 16–100 字元）。webhook（`notifications/line_routes.py`，`_SEEN_EVENTS` 在 `:64`）加處理 `delivery` 事件，記送達時間。要存「已送出／已送達／收不到」就是新的 `status` 欄位，**先登記 `backend/app/state_machines.py`**（`tests/test_state_machines.py` 會擋）。
7. **後台案件頁**：通知紀錄顯示「LINE 通知型訊息：已送達／24 小時未送達／這支電話收不到」，讓園方知道要不要打電話。停課對話框的「要來電人數」可以扣掉已送達的人（之後再做）。
8. **官網預約表單**：手機欄位下加一行說明（擬稿見附錄 A）。
9. **個資**：電話雜湊只在送出時算、不存；匿名化不必多清什麼（`notification_deliveries` 只有案件 id）。
10. **測試**：比照 `tests/test_line_notifications.py` 的假 LINE transport，涵蓋 202、422、403、逾時不重送、有綁定不送通知型訊息、delivery webhook 簽章與對應。

### 3.4 風險

- **電話打錯**：通知會送到別人的 LINE（只要那支電話真的有人用 LINE）。使用者 11-25 決定按鈕放修改連結，所以拿到的人能看到預約內容、改期或取消，和 Email 打錯一樣。補救：家長來電說沒收到或被改，園方用現有的「撤銷連結」「重新產生連結」作廢舊連結。
- **被拿來騷擾**：有人可以填別人的電話預約，讓對方收到我們官方帳號的訊息，每則 0.2 元。預約本來就有限流，加上一個電話一天最多送幾則就擋得住。
- **重複送**：見 3.3 第 5 點。
- **審核**：範本型文件沒寫要審版面，但台灣官方說內容要審；送出前要和業務確認「參觀預約」這個用途可以。

## 4. 上線步驟（程式做完後）

1. 隱私權政策補附錄 A 的段落並發布（招生用途的隱私權政策目前還沒發布，見 `deploy/README.md`）。
2. 在 Railway 設開通的帳號變數，**先只開一校**，用園方自己的手機預約一筆，看 LINE 收到的樣子、webhook 有沒有收到 `delivery`。
3. 一週後看「送達率」（delivery 事件數 ÷ 送出數），再決定其他校要不要開。

## 5. 使用者的決定（2026-11-25）

| 問題 | 決定 |
|---|---|
| 認證的是哪個官方帳號 | **另一個總部／品牌帳號**，還沒接上這個專案 → 新增帳號鍵 `hq` |
| 現在寫還是等核准 | **現在寫，預設關閉**；LINE 核准後設變數、後台打開才會送 |
| 範本型還是彈性型 | 沒另外指定，照建議先用範本型 |
| 有留 Email 的家長要不要也送 | **不送**，只送沒留 Email、也沒綁 LINE 的家長 |
| 「查看詳情」按鈕放不放修改連結 | **放** |
| 補登電話預約時送「客服管道引導」 | 沒提，不做 |

## 附錄 A：擬稿

**官網預約表單手機欄位下的說明**

> 沒有留 Email 的話，我們會用這支手機號碼，透過 LINE 通知型訊息傳送預約確認與參觀提醒（您的 LINE 須綁定這支號碼）。不想收到可在 LINE 設定中關閉。

**隱私權政策第 2 段加一項**

> **LINE 通知型訊息**：您預約參觀時沒有留 Email，我們會將您留下的手機號碼轉成無法還原的雜湊值交給 LINE（LY Corporation），由 LINE 比對是否為您 LINE 帳號綁定的號碼，比對後即刪除；相符時，您會在 LINE 收到這筆預約的確認、提醒與取消通知，通知中附有查看或修改預約的連結。您可以在 LINE「設定 → 隱私設定 → 提供使用資料 → LINE 通知型訊息」關閉，或封鎖我們的官方帳號。

## 附錄 B：沒查證到的

- 範本型要不要另外審核、審多久；台灣 30 個範本是否全部開放給每個帳號。
- 自行串接的實際價格、月費、和官方帳號每月推播額度是否分開計。
- 申請要準備哪些文件、要多久；幼兒園參觀預約是不是一定核准。
- `X-Line-Delivery-Tag` 允許哪些字元（文件只寫長度，範例都是英數字，所以只用十六進位）。
- 401、429 在這幾個端點的意思（文件只連到 Messaging API 的通用說明）。
- 全部沒有真的呼叫過 LINE；以上都要開通後用真機驗證。

## 6. 實作（2026-11-25，`claude/happy-meitner-lkejg1`）

| 項目 | 做法 | 位置 |
|---|---|---|
| 總部帳號 | 帳號鍵 `hq`，`WEBSITE_LINE_HQ_CHANNEL_SECRET`／`_ACCESS_TOKEN`；和 `main` 一樣每校都能選；webhook `/api/website/v1/line/webhook/hq`（一對一事件＋送達事件） | `backend/app/config.py`、`notifications/line_routes.py` |
| 開通與開關 | 兩層：`WEBSITE_LINE_PNP_ACCOUNTS` 列 LINE 已開通的帳號（列了沒設金鑰拒絕啟動）；後台 LINE 通知頁每校一個「通知型訊息」開關（`line_parent_campus_accounts.pnp_enabled`，選的帳號已開通才能開，否則 409 `LINE_PNP_UNAVAILABLE`）。用的帳號就是這校「家長 LINE 通知」選的帳號 | `config.py`、`line_routes.py`、`admin/src/views/LineNotificationsView.vue` |
| 誰會收到 | 送出當下：案件沒有 Email、沒有有效 LINE 綁定、電話是 `09` 開頭 10 碼、這校開關打開而且帳號仍開通 | `notifications/service.py` `_dispatch_parent_email` |
| 排信 | 沒 Email 的案件：有綁 LINE，或這校開關打開（只看資料庫）就排；送出當下帳號沒開通就 skipped | `booking/outbox.py`、`notifications/reminders.py` |
| 範本與內容 | §3.2 的對應；強調項目「12/03（四）09:30」；預約內容含校名、時段、地址、修改期限；人數、園所電話；按鈕「查看詳情」 | `notifications/line_pnp.py` |
| 電話 | `+886` ＋去掉開頭 0 → SHA-256 小寫十六進位；只在送出時算，不存電話也不存雜湊 | `notifications/line.py` `pnp_phone_hash` |
| 不重複送 | 先寫 `line_pnp_messages` 並 commit 再呼叫 LINE。連不上（連線前失敗）或 LINE 回 422 以外的 4xx／5xx → 刪掉這列、整筆重試；422 → 記 `rejected_at`、不重試；送出後逾時或斷線 → 留著、不重送 | `service.py` `_send_pnp` |
| 送達 | `X-Line-Delivery-Tag`＝outbox 訊息 id（32 位十六進位）；webhook `type: delivery` 對到就記 `delivered_at`，對不到的忽略 | `line_routes.py` `_handle_pnp_deliveries`、`line_pnp.mark_delivered` |
| 寄送紀錄 | LINE 收下時記 `notification_deliveries`（`line`／`pnp:<案件>`），寄送紀錄頁顯示已推 LINE | `service.py` |
| 官網 | 公開預約設定多 `line_pnp_enabled`；Email 欄說明多一句沒填會傳到 LINE | `booking/config_routes.py`、`web/app/components/VisitForm.vue` |
| 稽核 | `line.parent_account.update` 的 metadata 多 `pnp_before`／`pnp_after` | `line_routes.py`、`admin/src/api/auditLabels.ts` |
| 資料表 | migration `f2b7c4e9a1d3`：`pnp_enabled` 欄、`line_pnp_messages`（只有時間欄，沒有 status 欄，不必登記狀態機） | `backend/migrations/versions/` |

和 §3 規劃不同或沒做的：

- 5xx 當成「確定沒送出」重試（LINE 5xx 通常沒處理請求；寧可極少數重複，也不要漏掉預約確認）。只有送出後逾時、斷線才當不知道。
- 後台案件頁還看不到單筆送達狀態（`line_pnp_messages` 有資料，畫面沒接）；每日送達則數 API 沒接。
- 停課通知不送通知型訊息（沒有合適範本），停課對話框的「要來電人數」沒有扣掉通知型訊息的家長。
- 全部只用 httpx MockTransport 模擬 LINE；沒有真的呼叫過 LINE。
