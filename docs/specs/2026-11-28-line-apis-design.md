# 再接六個 LINE API（2026-11-28）

使用者看完「LINE 還有什麼 API 可以接」的 10 項盤點後挑了 1、2、3、4、5、9，說「先做這個」。本文是設計，同日施工。
前幾輪：`2026-11-16-line-integrations-design.md`（多帳號、家長綁定）、`2026-11-17`／`2026-11-25`／`2026-11-26`／`2026-11-27`（群組互動、通知型訊息、報表、卡片按鈕）。

| 盤點編號 | 項目 | 對象 | 則數 | 預設 | 章節 |
|---|---|---|---|---|---|
| 1 | 檢查 webhook 連線 | 後台 | 0 | 按了才查 | §2 |
| 2 | 已讀＋等待動畫 | 家長一對一 | 0 | 部署即生效 | §3 |
| 3 | 圖文選單（程式建立、已預約的家長換一版、點擊統計） | 家長一對一 | 0 | 每個帳號後台選了才建 | §4 |
| 4 | 群組成員名單、按鈕是誰按的 | 後台、稽核 | 0 | 名單按了才查；按的人部署即記 | §5 |
| 5 | 好友輪廓 | 成效統計 | 0 | 開面板才查 | §6 |
| 9 | 在 LINE 裡預約，預約當下就綁 LINE（LIFF／LINE MINI App） | 官網預約頁 | 0 | 兩個變數都設才開 | §7 |

共同原則（沿用前幾輪）：不存訊息內容；LINE userId 不進平台日誌；查 LINE 之前先結束資料庫交易、不握著列鎖等外部 API；
LINE 失敗不影響已寫入的資料；所有 LINE 呼叫測試一律用 `httpx.MockTransport`，不連真的 LINE。

## 1. 查證過的 LINE 規則（2026-11-28，developers.line.biz）

- **Webhook 設定**：`GET /v2/bot/channel/webhook/endpoint` → `{endpoint, active}`，沒填網址回 404。`POST /v2/bot/channel/webhook/test`
  （可帶 `endpoint`，不帶＝測已填的那個；每小時 60 次）→ `{success, timestamp, statusCode, reason, detail}`，
  `reason` 是 `OK`／`COULD_NOT_CONNECT`／`REQUEST_TIMEOUT`／`ERROR_STATUS_CODE`／`UNCLASSIFIED`。測試送的是 `{"destination": …, "events": []}`，要回 200。
- **已讀**：`POST /v2/bot/chat/markAsRead`，body `{"markAsReadToken": …}`，成功 200。token 在訊息事件的 `message.markAsReadToken`，不會過期。
  效果是「這則**之前**的訊息全部標成已讀」。帳號要開著聊天才有意義（沒開聊天時 LINE 自動已讀）。`GET /v2/bot/info` 多回
  `chatMode`（`chat`／`bot`）、`markAsReadMode`（`auto`／`manual`）。
- **等待動畫**：`POST /v2/bot/chat/loading/start`，body `{chatId: userId, loadingSeconds: 5–60 的 5 倍數}`，成功 202；只限一對一；
  對方沒開著聊天室、不是好友都回 202 但不顯示；官方帳號的新訊息一到就消失。
- **圖文選單**：
  - 建立 `POST /v2/bot/richmenu` → `{richMenuId}`（每小時 100 次、每帳號上限 1,000 個）；圖片 `POST https://api-data.line.me/v2/bot/richmenu/{id}/content`
    （JPEG／PNG、寬 800–2500、高 ≥250、寬高比 ≥1.45、≤1 MB，**上傳後不能換**）；刪除 `DELETE /v2/bot/richmenu/{id}`（每小時 100 次）。
  - 預設選單：設 `POST /v2/bot/user/all/richmenu/{id}`、清 `DELETE /v2/bot/user/all/richmenu`。
  - 個人選單：綁 `POST /v2/bot/user/{userId}/richmenu/{id}`（不是好友回 200 但沒綁上）、解 `DELETE /v2/bot/user/{userId}/richmenu`。
  - 顯示優先序：個人選單（API）＞預設選單（API）＞ LINE Official Account Manager 設的預設選單。**用 API 設預設選單會蓋掉 OA Manager 的那個。**
  - 統計（2026-07 新增）：`GET /v2/bot/insight/richmenu/{id}/summary?from=yyyyMMdd&to=yyyyMMdd`（UTC+9、每小時 60 次、隔天才算好）
    → `impression.metrics{count, uniqueUsers}`、`clicks[]{bounds, metrics{count, uniqueUsers}}`；**整段期間點的人不到 20 位只回 `richMenuId`**；剛建好還沒統計回 404。
    只有 API 建的選單查得到。
  - 區塊動作可用 `uri`（http／https／line／tel）、`message`、`postback`。
- **群組成員**：人數 `GET /v2/bot/group/{groupId}/members/count`；名單 `GET …/members/ids`（一頁 100 個、`next` 換頁，**只給認證／進階帳號**，
  其他帳號 403）；單一成員 `GET …/member/{userId}` → `displayName`（不限帳號等級；不在群組裡 404）。多人聊天室把 `group` 換成 `room`。
- **好友輪廓**：`GET /v2/bot/insight/demographic`（每小時 60 次）→ `available`＋`genders`／`ages`／`areas`／`appTypes`／`subscriptionPeriods`，
  每項 `{…, percentage}`。好友（可觸及）滿 20 人才有；約晚 3 天。台灣帳號的 `areas` 是縣市中文名（台北市、高雄市…）與 `unknown`。
- **LIFF**：
  - `liff.init({liffId})` 要在 Endpoint URL 或其下層路徑執行；Promise 完成前不能改網址。LIFF 網址帶路徑時先轉到
    `Endpoint URL?liff.state=…`（第一次轉址），`liff.init()` 再轉到「Endpoint URL＋路徑」（第二次轉址），兩個網址都要執行 `liff.init()`。
  - 在 LINE 的 LIFF 瀏覽器裡 `liff.init()` 自動登入；`liff.getIDToken()` 要勾 `openid` scope。ID token 發出後 1 小時有效。
  - 伺服器驗證：`POST https://api.line.me/oauth2/v2.1/verify`（form：`id_token`、`client_id`＝LIFF 所屬 channel 的 ID）→ `sub`（userId）、`aud`、`exp`；
    失敗回 `error_description`。
  - **userId 依 provider 發**：同一個 provider 底下的 LINE Login channel 與 Messaging API channel 拿到的 userId 相同，不同 provider 不同。
    → LIFF 所屬的 channel 必須和各校官方帳號的 Messaging API channel **在同一個 provider**，否則綁了也推不到。
  - SDK：npm `@line/liff`（2026-11 最新 2.32.0；2.20.0–2.31.0 因 XSS 弱點已被 LINE 限制，要 ≥2.31.1）。
  - LINE 建議新的 LIFF app 建成 LINE MINI App；台灣 2026-03-11 起可建未認證的 MINI App（未認證不能發服務通知、沒有自訂路徑）。SDK 呼叫相同。
  - `liff.getFriendship()` 只能查 LIFF channel 連結的那一個官方帳號，五校各有帳號用不上；改用各帳號的 `GET /v2/bot/profile/{userId}`（404＝不是好友）。

## 2. 檢查 webhook 連線（項目 1）

`POST /api/website/v1/admin/line/accounts/{account_key}/webhook-check`（`notifications.manage`）。帳號沒設金鑰回 404。每人 10 分鐘 10 次（429 `RATE_LIMITED`）。

```
LineWebhookCheckOut {
  account_key: str
  expected_url: str | None      # 這個帳號該填的網址（line_accounts.webhook_url；沒設 WEBSITE_ADMIN_ORIGIN 為 None）
  endpoint: str | None          # LINE 後台現在填的；None＝還沒填（LINE 回 404）
  active: bool | None           # LINE 後台「使用 Webhook」開關
  matches: bool | None          # endpoint 與 expected_url 去掉結尾斜線後相同；任一個是 None 就是 None
  test: { success: bool, status_code: int | None, reason: str } | None   # 沒填網址不測；測試打的是 LINE 後台填的那個網址
  error_status: int | None      # 查 LINE 失敗：HTTP 狀態碼（401＝金鑰失效），連不上是 0
}
```

- 先查 endpoint；查到才打 test（不帶 `endpoint`）。test 失敗（LINE 回非 200 或連不上）時 `test` 為 None、`error_status` 帶狀態碼。
- 不寫稽核（沒有改任何設定）。
- 後台「官方帳號與本月額度」每個帳號一顆「檢查連線」，結果顯示在那一列下面：
  - 全部正常：「webhook 網址正確，LINE 連得到。」
  - `endpoint` 空：「LINE 後台還沒填 webhook 網址。」
  - `matches === false`：「LINE 後台填的是另一個網址：…」
  - `active === false`：「LINE 後台的「使用 Webhook」沒有打開，收不到任何事件。」
  - `test.success === false`：「LINE 連不到這個網址（連不上／逾時／回了錯誤 500／其他）。」
  - `error_status`：401「金鑰失效，請重新設定」、其他「LINE 查詢失敗（狀態 N）」、0「連不上 LINE」。

## 3. 已讀＋等待動畫（項目 2）

只動一對一的家長事件（`line_routes._handle_user_events`），群組不動。

- **等待動畫**：綁定代碼、「我的預約」、卡片按鈕這三種會回覆的事件，通過限流後、處理前先送 `loading/start`（5 秒）。失敗只記 log。
- **已讀**：上面三種裡的**訊息事件**（代碼、我的預約）回覆送出後，拿事件的 `markAsReadToken` 標已讀。條件全部成立才標：
  1. 事件有 token；
  2. 這個帳號的 `markAsReadMode` 是 `manual`（`bot_info` 快取一小時；查不到當作不是）；
  3. 這個人近 7 天沒有「程式沒處理的訊息」。
- 第 3 點的理由：LINE 的已讀是「這則之前全部已讀」。家長先問了「請問學費多少」、園方還沒看，接著按「我的預約」，如果照標，那句問題也會變成已讀、
  從園方的未讀清單消失。做法：一對一收到程式不處理的訊息（任何類型）時，用限流表記一筆 7 天的標記（`line_unhandled_message`，鍵是
  `帳號:userId` 的雜湊，不存 userId 本身、不存內容）；有標記就不標已讀。7 天後視為園方已處理。
- 稽核、資料表都不動。

## 4. 圖文選單（項目 3）

### 4.1 內容

每個官方帳號兩版選單，2500×843（三格橫排）。圖片是 repo 內建的四張 PNG（`backend/app/notifications/richmenu/`）。

| 帳號 | 版本 | 左 | 中 | 右 |
|---|---|---|---|---|
| 校區帳號（有電話、有地址） | 一般 | 預約參觀 | 園所位置 | 撥打電話 |
| 校區帳號 | 已預約 | 我的預約 | 園所位置 | 撥打電話 |
| main／hq，或缺電話、地址的校區帳號 | 一般 | 預約參觀 | 校園環境 | 官方網站 |
| 同上 | 已預約 | 我的預約 | 校園環境 | 官方網站 |

- 預約參觀：`uri`。有設 LIFF（§7）→ `https://liff.line.me/{liffId}`（校區帳號再接 `/{校區鍵}`）；沒設 → `{官網}/visit`（校區帳號 `/visit/{校區鍵}`）。
- 我的預約：`message`，文字「我的預約」（既有指令，回覆不計則數）。
- 園所位置：`uri`，同家長卡片的導航（`service.campus_map_url`）。原本想寫「導航到園所」，但「航」不在官網的 LINE Seed TW 子集裡（原始字型不在本機、補不了字），改用子集裡有的字。圖由 `scripts/build-line-rich-menu-images.py` 產生。撥打電話：`uri` `tel:`。校園環境 `{官網}/environment`、官方網站 `{官網}/`。
- `chatBarText`：一般「預約參觀」、已預約「我的預約」。`selected: true`。
- 官網網址用 `settings.parent_origin`；沒設不能建（409 `LINE_RICH_MENU_UNAVAILABLE`）。

### 4.2 模式

每個帳號三選一：

- `null` 不使用（預設）。
- `booked` 只給已預約的家長：只建「已預約」版、逐人綁。其他好友照舊看 OA Manager 設的選單（或沒有選單）。
- `all` 所有好友：再建「一般」版並設成 API 預設選單——**會蓋掉 OA Manager 的預設選單**，後台要寫清楚。

### 4.3 資料表（migration，只新增空表）

- `line_rich_menus`：`account_key`（PK）、`mode`（`all`／`booked`）、`default_menu_id`（可空）、`booked_menu_id`、`spec_hash`、`created_at`、`created_by`。
- `line_rich_menu_users`：`account_key`＋`line_user_id`（PK）、`linked_at`。記「我們替誰綁了已預約版」，之後才知道要替誰解。

### 4.4 API

`PUT /api/website/v1/admin/line/accounts/{account_key}/rich-menu`（`notifications.manage`），body `{ "mode": "all" | "booked" | null }`，回 `LineSettingsOut`。
每人 10 分鐘 6 次。

套用（mode 不是 null）：
1. 讀校區資料、組出兩版的選單物件（§4.1），結束交易。
2. 向 LINE 建選單、傳圖；`all` 再設預設選單。任何一步失敗：把這次建的刪掉，回 502 `LINE_RICH_MENU_FAILED`，資料庫不動。
3. 寫 `line_rich_menus`（覆蓋舊列）；從 `all` 改成 `booked` 時清掉 API 預設選單；刪掉舊的選單（失敗只記 log）。
4. 清空這個帳號的 `line_rich_menu_users`，馬上跑一次對齊（§4.5）把已預約的家長綁到新選單。
5. 稽核 `line.rich_menu.update`，metadata `{before, after}`（模式）。

停用（null）：逐人解綁（`line_rich_menu_users` 裡的每一位）、清 API 預設選單（原本是 `all` 才清）、刪選單、刪兩張表的列。LINE 失敗只記 log，資料庫照清
（留著 LINE 那邊的殘餘選單不影響功能，下次套用會重建）。

`LineAccountOut` 多 `rich_menu: { mode, created_at, outdated } | None`。`outdated`＝現在算出來的 `spec_hash` 和建立時不同（校區改了電話、地址、
LIFF 開關變了、內建圖換了）→ 後台顯示「內容有更新，請按重新套用」。計算 `outdated` 不查 LINE。

`GET /api/website/v1/admin/line/accounts/{account_key}/rich-menu/insight?days=28`（`notifications.manage`，days 7–90）：

```
LineRichMenuInsightOut {
  from_date: date, to_date: date        # UTC+9；to＝昨天
  menus: [ {
    kind: "default" | "booked"
    available: bool                      # False＝LINE 沒給數字（點的人不到 20 位、或剛建好還沒統計）
    impressions: int | None, impression_users: int | None
    areas: [ { label: str, clicks: int, users: int } ]   # 依左中右；label 是 §4.1 的字
  } ]
  error_status: int | None
}
```
每個（選單, 期間）快取 6 小時。

### 4.5 對齊（誰該看已預約版）

`line_rich_menus.reconcile(db, clients, account_key=None)`：

- 該綁的人＝綁在這個帳號、沒封鎖、預約已確認、沒匿名化、場次還沒結束的 `line_parent_links.line_user_id`（同 `linked_upcoming_visits` 的條件），
  而且那筆預約的校區目前的家長通知帳號就是這個帳號。
- 已綁的人＝`line_rich_menu_users`。該綁沒綁 → 綁、寫列；已綁不該綁 → 解、刪列。一次最多各 200 人。LINE 回錯的那一位跳過、下次再試。
- 帳號金鑰拿掉了：不呼叫 LINE，留著列（金鑰回來再對齊）。
- 何時跑：維護週期每一輪（步驟名 `line_rich_menus`，失敗進 `failed_steps`）；套用選單之後立刻跑一次。參觀結束、取消、解除綁定、匿名化都靠下一輪對齊，
  不另外在各處掛勾。新綁定的家長最慢一輪後換選單。
- 沒有任何 `line_rich_menus` 列時這一步只做一次查詢就結束。

## 5. 群組成員（項目 4）

### 5.1 名單

`GET /api/website/v1/admin/line/groups/{target_id}/members`（`notifications.manage`）。群組不存在或已離開回 404。

```
LineGroupMembersOut {
  count: int | None                 # 不含官方帳號；查不到為 None
  names: list[str] | None           # 成員的 LINE 顯示名稱，排序後回；None＝拿不到名單
  names_unavailable: "unverified" | "error" | None   # unverified＝LINE 回 403（帳號不是認證／進階帳號）
  truncated: bool                   # 超過 200 人只列前 200
}
```

- 即時向 LINE 查（main 帳號），每個群組快取 10 分鐘；**不存資料庫、不回 userId**。逐一查名稱時同時最多 5 個請求。
- 後台「官方帳號所在的群組」每個群組一顆「看成員」，開對話框列人數與名稱；拿不到名單時說明原因、只顯示人數。

### 5.2 按鈕是誰按的

群組按鈕的稽核（`line.group.visit_attend`／`visit_no_show`／`recruitment_field`／`stats_health_mute`）原本只記 `line_user_id`。
現在在處理按鈕**之前**（還沒鎖任何列）用 `GET /v2/bot/group/{groupId}/member/{userId}` 查顯示名稱（每個（群組, 人）快取一小時、逾時 3 秒），
查得到就在 metadata 多記 `line_display_name`（最多 100 字）。查不到、事件沒帶 userId 都照舊不記。

- `line_display_name` 是園方員工在群組裡的名字，看得到這筆紀錄的人都看得到（不放進 `LINE_GROUP_PRIVATE_KEYS`），也加進 `LINE_GROUP_SEARCH_KEYS` 可搜尋。
- 後台操作紀錄顯示「按的人：王老師」。
- httpx 的日誌過濾（`_HideUserIdUrls`）要一起擋 `/member/` 與 `/v2/bot/user/` 的網址。

## 6. 好友輪廓（項目 5）

`GET /api/website/v1/admin/line-insights/demographics`（`admissions.stats_site`）。

```
LineDemographicsOut {
  configured: bool
  accounts: [ {
    key: str, display_name: str | None
    available: bool                      # False＝好友不到 20 位
    error_status: int | None             # 查 LINE 失敗（連不上 0）
    genders: [ { key, percentage } ]     # male／female／unknown
    ages: [ { key, percentage } ]        # from0to14 … from70／unknown
    areas: [ { key, percentage } ]       # 縣市中文名／unknown，依百分比由大到小
    subscription_periods: [ { key, percentage } ]
  } ]
}
```

- 每個帳號快取 12 小時（資料本來就晚 3 天）；查失敗不快取。百分比為 0 的不回。
- `ages`：LINE 同時有舊的 `from50`（50 歲以上合計）和細分的 `from50to54`…`from70`；細分的任何一項有值時丟掉 `from50`，免得重複算。
- 面板在成效統計的 LINE 區塊（`LineInsightsPanel`）多一段「好友輪廓」：每個帳號四組橫條（性別、年齡、地區前 8 名＋其他、加好友多久），
  註明「LINE 的估計值，約晚 3 天；好友不到 20 位時沒有資料」。標籤在前端對照（`from20to24` → 20–24 歲…，`unknown` → 不明）。

## 7. 在 LINE 裡預約，預約當下就綁 LINE（項目 9）

### 7.1 設定

- API：`WEBSITE_LINE_LIFF_ID`（格式 `數字-英數`，例 `1234567890-AbcdEfgh`）；`WEBSITE_LINE_LIFF_CHANNEL_ID` 可省略，預設取 LIFF ID「-」前面那段。
- 官網：`NUXT_PUBLIC_LINE_LIFF_ID`（同一個值）。兩邊都設才生效；只設一邊＝沒開（只設官網：token 送出但 API 不看；只設 API：官網不載 SDK）。
- LIFF app（或 LINE MINI App）由使用者在 LINE Developers 建：Endpoint URL `https://<官網>/visit`、Size Full、Scope 只勾 `openid`、
  **和各校官方帳號同一個 provider**。步驟寫在 `deploy/README.md`。

### 7.2 官網

- `web/app/utils/line-liff.ts`：只有「有設 LIFF ID」而且「User-Agent 是 LINE 的 App 內瀏覽器（含 `Line/`）」才動態載入 `@line/liff`、`liff.init()`。
  其他瀏覽器完全不載。完成後 `liff.isInClient() && liff.isLoggedIn()` 才取 `liff.getIDToken()`。任何錯誤都當作沒有 LIFF，預約流程照舊。
- 預約頁（`VisitForm`）掛載時啟動；`liff.init()` 完成前不動網址。完成後如果網址和目前路由不同（LIFF 的第二次轉址沒有整頁重新載入時），用 `navigateTo(…, {replace: true})` 對齊。
- 送單時多帶 `line_id_token`（送出當下再取一次）。
- 這校 `line_liff_enabled`（公開預約設定新欄位＝API 有設 LIFF 而且這校有開家長 LINE 通知）而且拿得到 token 時，Email 欄說明多一句
  「預約通知也會傳到您的 LINE。」
- 回應多 `line_notify`（見 §7.3）。有它時結果頁的 `VisitLineNotify` 直接顯示「已用 LINE 接收通知」，不用再傳代碼；`friend === false` 時多一段
  「還沒加入好友」＋加好友連結（加了之後 LINE 才送得到）。「不再用 LINE 接收」在結果頁要先用修改連結換 session（同原本的「用 LINE 接收通知」）。
- CSP：有設 LIFF ID 時 `connect-src` 多放行 SDK 需要的 LINE 網域（實測決定，至少 `https://api.line.me`）；沒設時字串和現在一字不差。SDK 用 npm 打包、
  不從 CDN 載，`script-src` 不動。

### 7.3 API

- `VisitRequestCreate.line_id_token: str | None`（最長 4096；不算進 idempotency 的 payload hash）。
- 驗證（`notifications/line_liff.verify_id_token`）：`POST https://api.line.me/oauth2/v2.1/verify`，5 秒逾時；200 而且 `aud`＝channel ID、`exp` 沒過、
  `sub` 是 `U`＋32 位十六進位才算。放在 Turnstile 之後、鎖校區設定列之前（那時不握資料庫連線）。**驗證失敗、逾時、LIFF 沒開都只是不綁，預約照常成立。**
- 綁定：新建案件時（重播不綁）這校有開家長 LINE 通知 → 在同一個交易裡、排家長通知**之前**寫 `line_parent_links`（帳號＝這校目前的家長通知帳號）。
  和傳代碼不同的是**不限已確認**：待確認的預約也綁，之後「預約成立」的通知才送得到 LINE（推播端本來就只看有沒有綁，不看狀態）。
  稽核 `line.parent.link`，metadata 多 `via: "liff"`。
- `VisitRequestOut.line_notify: { linked: true, friend: bool | None, account_name: str | None, add_friend_url: str | None } | None`：
  這筆預約有綁才回（新建、重播都回）。`friend` 在 commit 之後用該帳號查 profile（5 秒逾時，查不到 None）。
- `ParentLineNotifyOut` 多 `friend: bool | None`（已綁時查）。修改頁同樣顯示「還沒加入好友」。
- `PublicBookingConfigOut.line_liff_enabled: bool`。
- 沒加好友時第一則「預約成功」LINE 會送不到（LINE 回 200 但不送）；有留 Email 的照樣收信。加好友之後的提醒、改期、取消都收得到。不補送。

### 7.4 個資

- 多收一項：在 LINE 裡預約時的 LINE userId（和原本「用 LINE 接收通知」存的是同一欄）。匿名化、後台換帳號時的清除規則不變。
- 隱私權政策要在開啟前補一句（附錄 A）。

## 8. 不做

- 圖文選單的圖由後台上傳、每校不同版面、選單分頁切換（richmenuswitch）。
- 群組成員存資料庫、成員異動通知、頭像。
- 好友輪廓的歷史趨勢（LINE 只給當下）。
- LIFF 在外部瀏覽器登入（`liff.login()`）、`liff.getFriendship()`、分享好友（shareTargetPicker）、LINE MINI App 服務通知。
- 第一則 LINE 沒送到時補送。

## 9. 施工結果（和上面不同或補充的地方）

- **§3 已讀**：回覆送成功才標（回覆失敗就不標，免得把家長沒得到回覆的訊息從園方未讀裡消掉）。代碼夾在別的文字裡
  （「LN-… 沒辦法用，請問怎麼辦？」）照樣處理代碼，但那則記成「要人回」、不標已讀（`line_parent.is_plain_code_message`）。
  標記用限流表的新方法 `RateLimiter.set_marker`（每次重新計時 7 天），到期由既有的清理帶走。等待動畫的呼叫逾時 3 秒。
- **§4.1**：中間那格是「園所位置」（原因見該節）。預約參觀那格只有「有設 LIFF、而且這校（校區帳號）或任何一校（main／hq）有開家長 LINE 通知」才用 LIFF 網址，
  否則直接開官網——沒開通知的校區走 LIFF 只會多一個同意畫面。
- **§4.5**：家長重新加好友（follow）時刪掉他在 `line_rich_menu_users` 的列，下一輪對齊再綁一次——不是好友時 LINE 的綁定呼叫回 200 但其實沒綁上。
  定期工作的步驟名 `line_rich_menus`，後台系統狀態顯示「圖文選單換上與換回（已預約的家長）」。
- **§5.2**：名稱只在會寫稽核的動作查（確認已到場／未到場、招生欄位寫入、統計異常「知道了」），詢問卡不查。
- **§5.1**：403（帳號不是認證帳號）的結果照樣快取 10 分鐘；人數查不到或名單查詢出錯的不快取。
- **§7.2 官網**：
  - 送單前最多等 3 秒讓 LIFF 初始化完成，逾時就不帶 token。
  - **用可拆裝的 SDK**（`@line/liff/core`＋`is-in-client`、`is-logged-in`、`get-id-token` 三個模組），不用完整版 `@line/liff`。
    原因是正式建置＋真 CSP 的實測：完整版在 `liff.init()` 時會從 `static.line-scdn.net` 再載一支橋接腳本（`*-extensions_*.js`，掃碼、藍牙那類舊功能用），
    載不到就 `INIT_FAILED`；公開頁的 CSP 不放行外站腳本，那支被擋。核心版不載那支、也不含使用量統計模組，區塊約 64 KB（完整版 127 KB）。
    換成核心版後同一個實測（LINE 的 User-Agent、假 LIFF ID、對外請求全攔）沒有任何被 CSP 擋下的請求、頁面沒有錯誤。
  - CSP 只多放行 `connect-src https://api.line.me`（靜態分析 `@liff/*` 2.32.0：`liff.init()` 用到的 `contextToken`、`featureToken`、`oauth2/v2.1/token`／`verify`／`certs` 都在這個主機；
    依據寫在 `web/shared/line-liff.ts`）。`script-src` 不動。這一條只有靜態分析，實測時 SDK 還沒走到連線那一步（沒有真的憑證）。
  - SDK 的區塊不讓一般訪客預先下載：`build:manifest` 把 SDK 的進入點與只被它們引用的共用區塊關掉 prefetch（`liffOnlyManifestKeys`）；
    實測一般瀏覽器開預約頁不再請求這些檔，LINE 的 User-Agent 才載。
  - **第三方統計等網址乾淨才啟動**（`whenUrlHasNoLiffCredentials`）：LINE 把家長帶到 Endpoint URL 的那一刻，hash 帶著 access token、query 帶著 `liff.state`；
    Meta Pixel 會自己讀完整網址。外掛每 200ms 看一次，SDK 把網址清掉（或整頁轉到第二個網址）才建立統計；20 秒還沒乾淨（初始化失敗）這一頁就不啟動。
    平常的網址當下啟動，行為不變。GA、LINE Tag、OpenAI 像素本來就只送清洗過的網址；第一方的錯誤回報不存 query 與 hash。
  - LIFF ID 的格式兩邊一致：`數字 6–20 碼-英數 4–32 碼`。
- **§7.3**：官網送單一律「送出即預約成立」，所以實際上不會有「待確認又已綁」的預約；修改頁只在已確認時顯示 LINE 區塊，沒有另外改。
- **契約**：`LineAccountOut.rich_menu`、`LineWebhookCheckOut`、`LineGroupMembersOut`、`LineRichMenuInsightOut`、`LineDemographicsOut`、`VisitRequestOut.line_notify`、
  `ParentLineNotifyOut.friend`、`PublicBookingConfigOut.line_liff_enabled`、`VisitRequestCreate.line_id_token`。後台型別用產生的契約型別。

## 附錄 A：隱私權政策擬稿（開 LIFF 前由園方在後台補）

> 您在 LINE 應用程式內開啟本站預約頁並送出預約時，我們會取得您的 LINE 使用者識別碼，只用來把這筆預約的確認、提醒、改期與取消通知傳到您的 LINE。
> 您可以隨時在預約的修改頁停止用 LINE 接收通知。

## 附錄 B：沒辦法在本機驗證的事（要真的帳號）

- LIFF：真的 LIFF ID 在 LINE App 裡開啟、兩次轉址、`getIDToken()`、verify 端點的 `client_id`（MINI App channel 的 ID 是否就是 LIFF ID 前段）。
- userId 同 provider 的假設（LIFF channel 與五校帳號）。
- 圖文選單在手機上的樣子、`tel:`／地圖連結的開啟方式、統計數字的延遲。
- `markAsRead` 在「聊天開著＋webhook 開著」的帳號上的實際效果；`markAsReadMode` 的值。
- `members/ids` 在 main 帳號是否可用（要認證帳號）；群組 postback 有沒有帶 userId（11-17 起就待實測）。
