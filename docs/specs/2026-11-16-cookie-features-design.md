# 官網 cookie 六項功能（2026-11-16）

使用者 2026-11-16 看完「有什麼可以用 cookie 但還沒用」的盤點後說「都幫我做」。六項依盤點排序；第 4～6 項只動前台，另一個分支（`feature/cookie-web-prefs-20261116`）做，本規格一併記錄。沿用 2026-10-03 的裁定：**不做 cookie 同意橫幅**，揭露放隱私權政策，追蹤類一律尊重 DNT／GPC。

| # | 功能 | cookie | 性質 | DNT／GPC |
|---|---|---|---|---|
| 1 | 跨次造訪的來源歸因 | `ivy_src`（HttpOnly，90 天，每次進站延長） | 分析 | 開了就不寫、已有的清掉 |
| 2 | 到場、預繳回傳廣告平台 | 讀既有的 `_ga`、`_fbc`、`_fbp`、`__obref`，和 `ivy_src` 裡的點擊代碼 | 廣告 | 開了就不記 |
| 3 | 這台裝置記住預約 | `ivy_visit_remember`（HttpOnly，正式站 `__Host-`，到修改連結到期為止） | 必要／功能 | 不看 |
| 4 | 記住看過的校區 | `ivy_campus`（180 天） | 功能 | 不看 |
| 5 | 開場動畫回訪不重播 | `ivy_seen_entrance`、`ivy_seen_anni_intro`（30 天） | 功能 | 不看 |
| 6 | LINE Tag | LINE 自己的 cookie | 廣告 | 開了就不載 |

## 1. 跨次造訪的來源歸因

**問題**：第一方統計的「這次造訪」只活在一個分頁（sessionStorage）。家長週一點廣告進站、週四自己打網址回來預約，預約只記得家長自己勾的「如何知道常春藤」（選填），後台看不出廣告有沒有帶來真的預約、到場、預繳。GA4 會跨次歸因，但看不到後台的到場與預繳。

**寫入（web，`server/middleware/01.attribution.ts`）**
- 只處理公開頁的整頁載入（GET、要 HTML、`publicPage(path)` 認得的頁面）；`/admin`、`/api`、`/preview`、`/visit/manage`、靜態檔不處理。站內 SPA 換頁不會打到伺服器，所以只在「進站」那一刻判斷。
- 閘：部署開關 `NUXT_PUBLIC_TELEMETRY_ENABLED`（和第一方統計同一個）；請求帶 `DNT: 1` 或 `Sec-GPC: 1` 時不寫，已有的 `ivy_src` 回 `Max-Age=0` 清掉。
- 來源判斷沿用第一方統計的 `classifySource`（搬到 `shared/engagement-source.ts`，前後端共用）：廣告參數 → utm_source → fbclid → 來源網站（伺服器端 Referer 只有 origin，夠判斷）→ App 內建瀏覽器 → 直接進站。活動代碼沿用 `campaignOf`（utm_campaign 正規化）。
- 內容（base64url JSON，`v:1`）：
  - `f` 第一次進站：來源、活動代碼、日期（第一次就算是直接進站也記）。
  - `l` 最後一次「不是直接進站」的進站：來源、活動代碼、日期。直接進站不蓋掉。
  - `o` 最後一次落地網址上的 OpenAI 點擊代碼 `oppref`＋時間（第 2 項用）。
  - `b` 最後一次的 `fbclid`＋時間（第 2 項組 Meta 的 `fbc` 用；Meta Pixel 沒載入時的後備）。
- 屬性：HttpOnly、Path=/、SameSite=Lax、https 下 Secure、Max-Age 90 天（每次進站重設，等於「最後一次造訪後 90 天」）。伺服器發的 HttpOnly cookie 不受 Safari 對 JS cookie 的 7 天上限影響。
- 不存來源網址、query 原文、IP 或任何家長資料。

**讀取（backend，送出預約時）**
- 代理白名單加 `dnt`、`sec-gpc`（`web/server/utils/api-proxy.ts`），後端才知道訪客開了 DNT／GPC。
- `POST /public/visit-requests` 新建案件時解析 `ivy_src`（格式不符整個忽略，個別欄位不合規則就丟），寫進 `visit_requests` 新欄位：`first_touch_source／campaign／on`、`last_touch_source／campaign／on`。重播不改。不進 payload 雜湊（冪等比對只看家長填的內容）。
- DNT／GPC 開著就不記。

**後台**
- 案件明細多一行「網站來源」：第一次進站、預約前最後一次（沒有就不顯示）。
- 招生統計「參觀預約」（和預約孩子的班別同一欄）新增「網站來源」表：期間內送出的官網案件依來源（可切第一次／最後一次）分組，欄位：預約、已到場、未到場、預繳、到場率、預繳率；活動代碼展開成子列。預繳讀招生訪視（`recruitment_visits.has_deposit`，經 `visit_request_id`）。排除的測試／重複案件不算。權限同「預約結果」。
- 案件匯出 CSV 加四欄：第一次來源、第一次活動、最後來源、最後活動。

## 2. 到場、預繳回傳廣告平台（預設全關）

**目的**：讓 GA4（再匯入 Google Ads）、Meta、ChatGPT 廣告學到「真的來參觀、真的預繳」的人，而不只是填單的人。

**記錄點擊識別碼**：新建案件時，只有「該平台已設定伺服器端金鑰」才記，存進 `visit_requests.ad_click_ids`（JSON）：
- GA4：`_ga` cookie 的 client_id（`GA1.1.<a>.<b>` → `<a>.<b>`）。
- Meta：`_fbc`（沒有就用 `ivy_src` 的 fbclid 組 `fb.1.<毫秒>.<fbclid>`）、`_fbp`。
- OpenAI：`ivy_src` 的 `oppref`（30 天內的點擊才算，同平台的點擊後歸因期間）、`__obref` cookie。Meta 自己組 `fbc` 用的 fbclid 同樣只收 30 天內的。
- DNT／GPC 開著就不記。案件匿名化時清掉。

**觸發與送出**
- 「標記已到場」（`workflow_service.mark_completed`，含提早到）→ 事件 `visit_attended`；招生訪視從未預繳變成已預繳（`admissions/funnel.py`）→ 事件 `deposit_paid`。同一個交易寫進新表 `ad_conversion_jobs`（每案件×事件×平台唯一，重複標記不重送）。資料匯入、補建不觸發。
- API 內建定期工作每輪送出到期的工作；失敗重試 5 次（1 分、5 分、30 分、2 時、6 時），4xx（429 除外）直接記失敗。超過平台時限的不送、記 skipped（GA4 72 小時、Meta 與 OpenAI 7 天）。
- 不送任何個資或個資雜湊（業主 11-15 才把 OpenAI 自動進階比對擋掉，同一原則）。

| 平台 | 端點 | 事件 | 識別 | 變數 |
|---|---|---|---|---|
| GA4 | `https://www.google-analytics.com/mp/collect` | `visit_attended`、`deposit_paid` | `client_id` | `WEBSITE_GA4_MEASUREMENT_ID`、`WEBSITE_GA4_API_SECRET` |
| Meta | `https://graph.facebook.com/<版本>/<pixel>/events` | 自訂 `VisitAttended`、`DepositPaid`，`action_source=physical_store` | `user_data.fbc`、`fbp` | `WEBSITE_META_PIXEL_ID`、`WEBSITE_META_CAPI_TOKEN`、`WEBSITE_META_GRAPH_VERSION`（預設 `v26.0`） |
| OpenAI | `https://bzr.openai.com/v1/events?pid=<pixel>` | `type=custom`、`custom_event_name` 同 GA4，`action_source=physical_store`／`offline` | `oppref`、`user.obref` | `WEBSITE_OPENAI_PIXEL_ID`、`WEBSITE_OPENAI_CAPI_KEY` |

事件 id 一律 `<案件 id>:<事件>`，平台端去重。各家參數都帶 `campus_key`。

## 3. 這台裝置記住預約

**問題**：2026-11-13 起 Email 選填。沒留 Email 的家長只能在結果頁按「修改或取消預約」或複製連結；加入日曆的內容不含連結。關掉分頁之後只能打電話。

**做法**
- 送單成立（新建或重播，有修改連結時）後端回 `Set-Cookie: ivy_visit_remember=<修改連結的 token>`，HttpOnly、SameSite=Lax、Path=/，Max-Age 到 token 到期；正式站由 `host_cookies` 加 `__Host-` 前綴。token 就是信裡那條連結的 token，園方「重新產生連結」、案件取消／完成時撤銷，cookie 也跟著失效。
- `GET /public/visit-remembered`（`X-Ivy-Parent`）：cookie 有效且案件仍是已確認 → 回校區、日期、場次時間（不回姓名電話）；無效就清 cookie、回 204。
- `POST /public/visit-remembered/open`：用 cookie 的 token 換 2 小時家長 session（同 `exchange`），前端整頁導向 `/visit/manage`（manage 頁沒有 hash 時用既有 session 載入）。
- `DELETE /public/visit-remembered`：清 cookie（「不是我」）。
- 前端：預約頁 SSR 看得到 cookie 才在 client 端查一次，查到就在頁面上方顯示一列「您已預約 ○月○日（○）○○:○○ ○○校參觀」＋「修改或取消」「不是我」。只顯示日期場次校區，共用裝置看到的也只有這些；要看姓名電話得按進去。

## 4～6（前台分支）

- 4：`ivy_campus`，訪客主動選校（頁首選單五校、首頁五校卡、預約頁選校卡）時寫；SSR 用它決定選單參觀專線與五校卡的起始校區。預約流程不變。`/admin`、`/preview` 不寫。
- 5：首頁 30 週年布幕、`/anniversary` 開場播過就寫 cookie，30 天內 SSR 直接不輸出開場；sessionStorage 判斷保留當後備。
- 6：`NUXT_PUBLIC_LINE_TAG_ID`，照 GA4／Meta／OpenAI 同一套（DNT／GPC、排除頁、換頁 pv、預約成功 cv、沒設時 CSP 一字不差），不開任何個資比對。

## 上線前要做的事（使用者）

- 隱私權政策第 5 段改寫並發布（擬稿在 README 當天段落）：新增 `ivy_src`、`ivy_visit_remember`、`ivy_campus`、開場 cookie、LINE Tag；第 2 項開啟前補「到場、預繳會以點擊識別碼回傳廣告平台」。
- 第 2、6 項要自己到各平台取得金鑰／ID 再設 Railway 變數（步驟在 `deploy/README.md`）。
- `docs/website-admin/seo-performance.md:33`「第一方量測不設 Cookie」改寫。

## 附錄 A：隱私權政策改寫擬稿（上線前由使用者在後台改、發布）

正式站的政策存在資料庫（11-15 已改成 GA4、Meta、OpenAI 三項），以下只列**要新增或改掉的句子**，其他照現行版本。

**第 4 節（網站使用統計）**，「不使用 cookie 識別您」那句改成：

> 這些統計不記錄您的 IP。為了知道您是從哪裡來到本網站，本網站會在您的瀏覽器記下「第一次」與「最近一次從其他網站點進來」的來源類別（例如搜尋引擎、Facebook、廣告）與日期，不記錄來源網址；您送出預約時，這兩筆來源會和預約一起保存，讓我們知道各管道帶來的參觀成效。您的瀏覽器若開啟「不要追蹤」（Do Not Track）或 Global Privacy Control，本網站就不會記錄。

**第 5 節（Cookie 與類似技術）**，必要 cookie 清單補一項：

> - __Host-ivy_visit_remember：您在這台裝置預約成功後設定，讓您之後回到預約頁時可以直接修改或取消預約；預約修改連結失效時一併失效。只能由本網站的伺服器讀取。

「瀏覽器分頁暫存三項…」那段改成：

> 此外，本網站使用下列不含個人資料的 cookie 與瀏覽器暫存：
> - ivy_src：記錄您第一次與最近一次從其他網站點進來的來源類別、活動代碼與日期，以及廣告平台附在連結上的點擊代碼（見第 4 節）；最後一次造訪後保存 90 天。
> - ivy_campus：記住您最近選看的校區，下次開啟網站時直接顯示該校的參觀專線；保存 180 天。
> - ivy_seen_entrance、ivy_seen_anni_intro：記住您看過開場動畫，30 天內不再重播。
> - 瀏覽器分頁暫存：首頁「孩子的一天」照片翻面動畫是否播過，以及第 4 節所說、用來統計同一次造訪的隨機代碼，關閉分頁後就會清除。

第三方工具清單（若開啟 LINE Tag）補一項，「兩項／三項」等字樣改成實際數量：

> - LINE Tag（LY Corporation）：計算 LINE 廣告帶來多少人造訪與預約。LINE 會在您的瀏覽器設定 cookie（名稱為 __lt__cid、__lt__sid）。

**開啟「到場、預繳回傳廣告平台」前**，在第三方工具那段之後補一段：

> 您若是點選廣告來到本網站並預約參觀，當您實際到校參觀或完成預繳時，我們會告訴該廣告平台（Google、Meta 或 OpenAI）「這次廣告點擊帶來了一次參觀（或預繳）」，傳送的只有廣告平台自己的點擊代碼或瀏覽器代碼與校區，不會傳送您的姓名、電話、Email 或孩子的資料。

**第 7 節（保存期間）**補一句：

> - 預約時記下的廣告點擊代碼，在預約資料依保存政策匿名化時一併刪除。
