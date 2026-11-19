# 後台與 LINE 的串聯（2026-11-16）

使用者看完「後台還可以跟 LINE 串聯什麼」的盤點後，挑了七項說「這些都幫我做」：

| 盤點編號 | 項目 | 本文章節 |
|---|---|---|
| 1 | 系統狀態頁顯示每月訊息額度 | §3 |
| 3 | 群組推播改成卡片訊息，附「開啟案件」按鈕 | §3 |
| 5 | 家長在預約完成頁開「用 LINE 接收通知」 | §4、§5 |
| 6 | 「我的預約」（圖文選單） | §6 |
| 8 | 開 LINE Tag | §9（只差使用者的帳號與變數） |
| 9 | 到場、預繳回傳 LINE 廣告 | §8 |
| 10 | 好友數放進成效統計 | §7 |

所有新功能**預設關**：沒有設新變數、後台沒替任何校區打開家長 LINE 通知時，行為和上線前一樣；唯一立即可見的改變是群組推播從純文字變成卡片（§3）。

## 1. 查證過的 LINE 規則（2026-11-16，developers.line.biz／tw.linebiz.com）

- 推到群組的訊息「有幾個人收到就算幾則」；reply（回覆使用者剛傳的訊息）不計則數。推給沒加好友或已封鎖的人回 200 但收不到、也不計。
- 每月額度用完 push 回 429（`You have reached your monthly limit.`）。台灣方案 2026-11-01 起：輕用量 200 則／月免費；中用量 3,000 則 1,000 元；高用量 6,000 則 1,400 元可加購。
- 一個 LINE Login channel 只能連結一個官方帳號；userId 依 provider 不同。
- LINE URL scheme（`line.me/R/oaMessage/…`）只支援手機 LINE；LINE ID 與預填文字都要 percent-encode（`@`→`%40`）。
- insight followers：某一天（UTC+9）的累計加好友數、封鎖數，隔天才算好，每小時限 60 次。
- Conversion API：`POST https://conversion-api.tr.line.me/v1/{LINE Tag ID}/events`，標頭 `X-Line-TagAccessToken`（企業管理平台發），成功 202；文件沒寫台灣能不能用。

## 2. 多個官方帳號

- `main`＝原本園方群組推播的帳號（`WEBSITE_LINE_MESSAGING_*`），只有它推群組。
- 各校自己的帳號：`WEBSITE_LINE_<YIHUA|MINGHUA|CHONGDE|INTERNATIONAL|RENWU>_CHANNEL_SECRET`／`_ACCESS_TOKEN`，兩個都設才算有（只設一個拒絕啟動）。webhook 是 `/api/website/v1/line/webhook/<校>`，只處理一對一的家長事件。
- 帳號名稱與 LINE ID（`@xxxx`）用 `GET /v2/bot/info` 查，快取一小時；不另外設定。
- 為什麼家長綁定不用 LINE Login：一個 Login channel 只能連一個官方帳號（五校各有帳號），還要另外申請上架；傳代碼只要 Messaging API，和 09-29 的群組驗證碼同一套作法。代價是家長要多按一次「傳送」。

## 3. 額度監看與群組卡片

- `line_accounts.account_status`：每個帳號本月用量（`quota`＋`quota/consumption`，5 分鐘快取，失敗不快取）。用到 80% 或查不到（401＝金鑰失效）→ 系統狀態「LINE 官方帳號」一列算要注意，也算進營運總覽的「N 項要注意」。
- 後台 LINE 通知頁多「官方帳號與本月額度」：每個帳號一條進度、快用完的後果、各校帳號的 webhook 網址。
- 群組推播改成 Flex 卡片：標題、校區、參觀時段、家長稱呼（同 10-05 裁定，先拿掉網址、限 20 字），「開啟案件」按鈕（帶 `openExternalBrowser=1`）。`altText`（手機通知與聊天列表看到的）只有類型、校區、時段，**不帶家長稱呼與網址**。沒設 `WEBSITE_ADMIN_ORIGIN` 時改放案件編號。電話、Email、孩子資料照舊不放。

## 4. 家長綁定

1. 後台 LINE 通知頁「家長 LINE 通知」：每校選「不開放／園方群組推播帳號／本校官方帳號」（`line_parent_campus_accounts`）。別校的帳號不能選（`LINE_ACCOUNT_UNAVAILABLE`）。選的帳號金鑰拿掉就當沒開。
2. 公開預約設定多 `line_notify_enabled`；預約完成頁（有修改連結時）與修改頁（已確認、不是停課日）顯示「用 LINE 接收通知」。
3. 按下去：完成頁先用修改連結的 token 換家長 session（同點開連結），再 `POST /public/visit-manage/line-notify/code` 取一次性代碼 `LN-XXXXXXXX`（30 分鐘、只存 HMAC、同一筆再取會作廢舊的、每筆 10 分鐘最多 10 次）。
4. 手機：按鈕開 `line.me/R/oaMessage/%40<帳號>/?我要用 LINE 接收參觀通知 LN-…`，家長按傳送。桌機：列「加好友（line.me 的加好友頁有 QR code）」與可複製的那句話（加 QR 套件被權限擋下，見附錄 B）。
5. webhook 收到一對一訊息裡的代碼：代碼要是這個帳號發的、沒過期、沒用過，預約要還是已確認、沒匿名化 → 寫 `line_parent_links`（一筆預約一個 LINE，換人綁就覆蓋），回覆「已開啟 LINE 通知」；查 profile 是 404（沒加好友）就多一句提醒加好友。失效代碼回覆「已失效，請重新取得」。同一個 LINE 一分鐘最多處理 10 則。
6. 頁面每 4 秒查一次狀態，綁好自動變成「已用 LINE 接收通知」，可按「不再用 LINE 接收」（`DELETE`）。
7. 加好友／封鎖（follow／unfollow）更新 `unfollowed_at`；封鎖期間不推。
8. 稽核：`line.parent_account.update`、`line.parent.link`、`line.parent.unlink`（家長端的 actor 為空）。不存任何訊息內容。

## 5. 家長通知走 LINE

- 排入：`enqueue_parent_email`、參觀提醒、停課通知原本「沒有 Email 就不排」，改成「沒有 Email 也沒綁 LINE 才不排」。
- 送出（`_dispatch_parent_email`）：同一則內容（`parent_email.parent_notice`）Email 照原本的純文字，LINE 排成卡片（標題、開頭、明細、說明、按鈕：修改／改約／重新預約＋撥打電話）。兩個管道各自記 `notification_deliveries`（`email`／`line` × `parent:<id>`），重試只補沒送成的那個；LINE 失敗在信寄完後丟出讓整筆重試。
- 推得到的條件：有綁、沒封鎖、這校目前的家長通知帳號就是綁的那個、金鑰還在。後台換帳號或關閉，舊綁定就不推。
- 沒留 Email 的家長在綁定前不會有「預約成功」通知（那時還沒有任何管道）；綁定時的回覆就是確認。
- Email 變更通知（寄舊信箱）只走 Email。
- 停課：`VisitClosureCampusOut.with_line`＝沒有 Email 但會走 LINE 的人數；對話框在正式站沒設寄信但有 LINE 家長時也能勾通知，要來電的人數扣掉他們。
- 個資：案件匿名化時刪掉 `line_parent_links` 與沒用掉的代碼。

## 6. 我的預約

家長在官方帳號傳「我的預約」（也認「查詢預約」「查預約」）：回覆綁在這個 LINE、還沒結束的已確認預約（輪播卡，每筆有「查看或修改」連結）；沒有就說明怎麼綁。回覆不計則數。圖文選單由園方在 LINE Official Account Manager 自己加（動作「文字」，內容「我的預約」），程式不建圖文選單。

## 7. 成效統計的 LINE

`GET /admin/line-insights?start&end`（`admissions.stats`）：每個帳號比較「開始日前一天」與「結束日（今天的隔天才算好就用昨天）」兩天的 followers 與 blocks → 新增好友、封鎖增減；加上同期間官網 LINE 按鈕點擊（`cta_click_line`，分校區）與綁定 LINE 通知的預約數。每個（帳號, 日期）快取 6 小時，還沒算好的不留。面板在成效統計「怎麼來、怎麼逛」。

## 8. LINE 廣告轉換回傳

- 新變數 `WEBSITE_LINE_TAG_ID`（UUID，和官網 `NUXT_PUBLIC_LINE_TAG_ID` 同一個）＋`WEBSITE_LINE_CAPI_TOKEN`，兩個都設才把 `line` 加進 `ad_conversion_platforms`；`WEBSITE_LINE_CAPI_TEST=true` 時事件帶 `test_flag`。
- 官網進站 middleware 把落地網址的 `ldtag_cl` 記進 `ivy_src` 的 `n`；送單時記 `line_click_id`（90 天內的點擊）與 LINE Tag 的瀏覽器 cookie `__lt__cid`（`line_browser_id`）。
- 送出：`event_type: conversion`、`event_name: visit_attended／deposit_paid`、`source_type: web`、`deduplication_key: <案件>:<事件>`、`user: {click_id, browser_id}`。不送電話、Email 或其雜湊。期限比照 Meta 7 天。
- migration 把 `ad_conversion_jobs.platform` 的檢查加上 `'line'`。

## 9. 上線前要做的事（使用者）

1. 合併、部署（migration `b3e8d1c4f9a7` 只新增三張表、放寬一個檢查，不必先備份）。
2. 隱私權政策補附錄 A 兩段並發布，**再**替任何一校打開家長 LINE 通知、或設 LINE 廣告變數。
3. 家長 LINE 通知：決定用哪個帳號。各校帳號要在 LINE Developers 開 Messaging API、取 Channel secret 與長效 access token，設 `WEBSITE_LINE_<校>_*`，webhook 貼後台列出的網址並開「Use webhook」；回應模式若是「聊天」要確認 webhook 沒被關掉（附錄 B）。在後台「LINE 通知」選帳號，用自己的手機預約一筆測試。
4. 「我的預約」圖文選單：OA Manager → 圖文選單 → 動作「文字」→「我的預約」；不要另設同字的關鍵字回應。
5. LINE Tag：照 `deploy/README.md`「LINE Tag」第 2–5 步。
6. LINE 廣告轉換回傳：在 LINE 企業管理平台確認台灣帳號能發 Conversion API token；先設 `WEBSITE_LINE_CAPI_TEST=true` 驗，看得到測試事件再拿掉。

## 10. 審查後補的規則（2026-11-16，獨立審查 10 條全數修正）

- **切斷外流連結也切斷 LINE**：園方「撤銷連結」「重新產生連結」「更正 Email」會一併刪掉這筆預約的 LINE 綁定與沒用掉的代碼（拿外流連結綁了 LINE 的人，否則會一直收到新連結、用「我的預約」拿到連結）。家長自己改 Email 不動他的 LINE；結案（取消、完成、未到場）也不動，取消通知要送得到。
- **換帳號或關閉＝舊綁定作廢**：後台改了某校的家長通知帳號，綁在其他帳號上的綁定與代碼一起刪（稽核 metadata `dropped_links`）；綁定時也再確認這校目前用的就是發代碼的帳號。家長頁的「已開啟」、停課計數、送出都只認目前帳號的綁定。
- **停課計數**：`with_line` 不看這次勾不勾通知（取消勾選後才知道有幾位要改成來電）；正式站沒設寄信時，有 Email 又綁了 LINE 的家長算 `with_line`。
- **家長端點比對案件**：三個 LINE 端點都收 `visit_request_id`（畫面上的案件），對不上目前 session 回 409 `PARENT_SESSION_CHANGED`（同其他家長端點）。
- **兩個管道互不阻擋**：信寄不出去照樣推 LINE，反之亦然；最後丟出第一個錯誤讓整筆重試，重試只補沒送成的。
- **日誌不留 userId**：httpx 記錄 `GET /v2/bot/profile/<userId>` 的那行被過濾掉。
- **頁面查 LINE 不卡**：各帳號同時查、逾時 5 秒，查失敗記 1 分鐘不重查。
- **電話按鈕**：只取分機前的半形數字，少於 6 碼就不放按鈕。
- **家長頁**：代碼過期或傳錯可以「重新取得」；預約變成不能開（例如取消）時停止輪詢。
- 沒處理：LINE webhook 重送（預設關）時，同一則代碼第二次處理會回「已失效」。

## 附錄 A：隱私權政策擬稿（使用者在後台改、發布）

第 2 段（蒐集的資料）加一項：

> **LINE 通知（選用）**：您在預約完成頁或修改頁選擇「用 LINE 接收通知」並傳送代碼給我們的 LINE 官方帳號後，我們會記下 LINE 提供的使用者識別碼（一串代碼，不含您的 LINE 名稱、電話或好友名單），用來把這筆預約的確認、提醒、改期、取消與停課通知傳到您的 LINE，以及在您傳「我的預約」時回覆您的預約。您可以隨時在修改頁按「不再用 LINE 接收」，或封鎖官方帳號；這筆預約依保存期限清理時，識別碼會一併刪除。

第 5 段（第三方工具）加一項（開 LINE Tag 或 LINE 轉換回傳時）：

> **LINE Tag 與 LINE 轉換 API（LINE 廣告）**：計算 LINE 廣告帶來多少人瀏覽、預約、到場參觀與完成預繳。LINE 會在您的瀏覽器設定 cookie（名稱以 `__lt__` 開頭）；我們回傳到場、預繳時只附 LINE 廣告的點擊代碼與這個 cookie 的代碼，不附姓名、電話或 Email。

## 附錄 B：沒驗證到的

- 家長還沒加好友時，能不能先傳代碼、webhook 收不收得到、能不能 reply——官方文件沒寫；程式照「收得到就綁、提醒加好友」寫，要真機測。
- 回應模式「聊天」時 webhook 會不會被關（第三方說會）。
- Conversion API 在台灣能不能用、`source_type` 對線下事件該填什麼、`ldtag_cl` 是不是 API 的 `click_id`、`__lt__cid` 是不是 `browser_id`——文件沒寫，`test_flag` 先驗。
- 桌機沒有 QR code：加 `uqr` 套件被自動權限擋下，要使用者同意加依賴。
- 所有 LINE API 都只用模擬回應測過；沒有真的推過卡片、真的綁定過。
