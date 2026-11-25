# LINE 通知型訊息 Runbook（2026-11-25）

程式已在 2026-11-25 併入 `main`，**預設關閉**：沒設變數、後台沒打開時，行為和上線前完全一樣。這份是「等 LINE 核准之後」要照著做的事，分成使用者做的（§1–§4）與之後要繼續開發的（§5）。

- 研究、LINE 規則、使用者的決定與實作細節：`docs/specs/2026-11-25-line-notification-messages-research.md`（§1 規則、§5 決定、§6 實作）
- 部署變數：`deploy/README.md`「2026-11-25 LINE 通知型訊息」
- 程式：`backend/app/notifications/line_pnp.py`（範本與內容）、`notifications/service.py` `_send_pnp`（送出與重試）、`notifications/line_routes.py` `_handle_pnp_deliveries`（送達事件）、`admin/src/views/LineNotificationsView.vue`（開關）

已定的事（使用者 2026-11-25）：總部／品牌帳號（帳號鍵 `hq`）發；只送**沒留 Email、也沒綁 LINE** 的家長；「查看詳情」按鈕放修改連結；用範本型。

---

## 1. 申請（使用者）

1. tw.linebiz.com →「廣告方案洽詢」表單：產品選「LINE 通知型訊息」，開發團隊選「**自行開發**」。要公司名稱、統一編號。
2. 和 LINE 業務確認下面每一項，答案記在本節最後的表格：

| # | 要問的 | 為什麼 |
|---|---|---|
| Q1 | 總部帳號（藍盾）能開通嗎？要準備什麼文件、多久？ | 申請本身 |
| Q2 | 能用範本型嗎？台灣範本 `reservation_completed_zh`、`reservation_cancellation_zh`、`reservation_reminder_zh` 都能用嗎？ | 程式只用這三個；不能用會回 400 |
| Q3 | 範本型要不要另外審內容？「幼兒園參觀預約的完成、取消、前一天提醒」這個用途可以嗎？ | 官方技術文件沒寫範本要審，台灣官網說內容要審 |
| Q4 | 價格：自行串接也是每則 0.2 元嗎？有沒有月費、開通費、預付？只對送達計費嗎？ | 官網只寫 0.2 元／則 |
| Q5 | 通知型訊息和官方帳號每月推播額度是分開算的嗎？ | 影響系統狀態的額度警示 |
| Q6 | 停課通知（請家長改約）有沒有合適的範本？沒有的話，彈性型要怎麼送審？ | 目前停課不送（§5 第 3 項） |
| Q7 | `X-Line-Delivery-Tag` 可以用哪些字元？ | 程式用 32 位小寫十六進位（文件只寫 16–100 字元） |

| # | 答案（日期、誰回的） |
|---|---|
| Q1 | |
| Q2 | |
| Q3 | |
| Q4 | |
| Q5 | |
| Q6 | |
| Q7 | |

## 2. 開通前就可以先做（使用者）

1. **隱私權政策**：補研究文件附錄 A 的段落並在後台發布。**一定要在打開任何一校之前**。
2. **總部帳號接上專案**：LINE Developers → 總部帳號的 Messaging API channel：
   - 取 Channel secret 與長效 channel access token，在 Railway `api` 服務設 `WEBSITE_LINE_HQ_CHANNEL_SECRET`、`WEBSITE_LINE_HQ_ACCESS_TOKEN`（兩個一起設，只設一個 API 會拒絕啟動）。
   - Webhook URL 貼 `https://www.ivykidschool.com/api/website/v1/line/webhook/hq`（後台 LINE 通知頁「官方帳號與本月額度」也會列），按 Verify，打開「Use webhook」。送達事件靠它。
   - 回應模式若是「聊天」，確認「Use webhook」沒被關掉。
3. 部署後到後台「LINE 通知」頁確認：帳號清單出現「總部官方帳號」、有名稱與 LINE ID、額度查得到（查不到且寫金鑰失效＝token 貼錯）。
4. 這時候**還不要**設 `WEBSITE_LINE_PNP_ACCOUNTS`。總部帳號此時已經可以選來做「家長 LINE 通知」（傳代碼綁定那種），不選就沒有任何影響。

## 3. LINE 開通之後（使用者）

1. Railway `api` 設 `WEBSITE_LINE_PNP_ACCOUNTS=hq`，重新部署。列了沒設金鑰的帳號會拒絕啟動，看部署紀錄。
2. 後台 LINE 通知頁：「總部官方帳號」旁邊出現「已開通通知型訊息」。
3. **先只開一校**：「家長 LINE 通知」那一校選「總部官方帳號」，打開「通知型訊息」開關。
4. 照 §4 用真機驗。
5. 一週後看送達率（§4 的 SQL），沒問題再開其他校。

### 回退（任何時候）

- 只關一校：後台把那校的「通知型訊息」關掉。已排隊的通知送出當下會再檢查，關了就不送。
- 全部停：Railway 拿掉 `WEBSITE_LINE_PNP_ACCOUNTS`，重新部署。已排隊的通知會變成「已略過」，不會失敗重試。
- 不必動資料庫；`line_pnp_messages` 留著當紀錄。

## 4. 真機驗收

用園方自己的手機號碼（這支號碼要綁在一個 LINE 帳號上），在已打開的那一校官網預約，**不要填 Email**。

| # | 做什麼 | 應該看到 |
|---|---|---|
| V1 | 預約前看表單 Email 欄說明 | 多一句「沒填的話，預約確認、提醒與修改連結會用 LINE 通知型訊息傳到綁定這支手機號碼的 LINE。」 |
| V2 | 送出預約，等 1–2 分鐘（定期工作每 60 秒一輪） | LINE 收到「預約完成通知」，寄件者是總部帳號，標「重要通知」；第一次會先問要不要接收，按同意。另有一則「LINE」系統帳號的提醒（關不掉，正常） |
| V3 | 看內容 | 強調的日期時間、預約內容（校名、時段、地址、修改期限）、人數、園所電話；沒有家長姓名、孩子資料 |
| V4 | 按「查看詳情」 | 開到這筆預約的修改頁 |
| V5 | 在修改頁取消預約 | 收到「預約取消通知」，按鈕開重新預約頁 |
| V6 | 再約一筆隔天的場次，等參觀前的提醒時間 | 收到「行程預約提醒」 |
| V7 | 填一個**有 Email** 的預約 | 只收到信，LINE 沒有 |
| V8 | 用一支 09 開頭、但沒有綁 LINE 的手機號碼預約 | LINE 那邊什麼都沒有；資料庫記 `rejected_at`（422） |
| V9 | 封鎖總部帳號後再預約 | 收不到；`accepted_at` 有值但 24 小時後 `delivered_at` 仍是空的 |

資料庫確認（Railway → Postgres → Query，或 `psql`）：

```sql
-- 最近的通知型訊息：送出、收下、收不到、送達
SELECT p.attempted_at, p.template_key, p.accepted_at, p.rejected_at, p.delivered_at, v.campus_key
FROM line_pnp_messages p JOIN visit_requests v ON v.id = p.visit_request_id
ORDER BY p.attempted_at DESC LIMIT 20;
```

```sql
-- 過去 7 天的送達率（送出超過 24 小時的才算）
SELECT count(*) AS sent,
       count(delivered_at) AS delivered,
       count(rejected_at) AS rejected,
       count(*) FILTER (WHERE accepted_at IS NULL AND rejected_at IS NULL) AS unknown
FROM line_pnp_messages
WHERE attempted_at > now() - interval '7 days' AND attempted_at < now() - interval '24 hours';
```

把驗收結果（哪幾項通過、截圖、日期）記在 `deploy/README.md`。

## 5. 還沒做的開發項目（申請通過後繼續）

依建議順序。每一項做完都照 CLAUDE.md 的流程驗證（後端 pytest、admin／web typecheck 與 unit、`contract:check`）。

### 5.1 真機驗收後的修正（必做，視 §4 結果）

- V2–V6 有任何一項和預期不同（例如範本不能用、項目文字被截斷、`X-Line-Delivery-Tag` 被拒）：改 `backend/app/notifications/line_pnp.py` 的範本與項目，或 `line.py` 的 `pnp_delivery_tag`；`tests/test_line_pnp.py` 跟著改。
- Q2 若有範本不能用：`template_for` 對應改掉；完全不能用的種類回 `None`（不送）。

### 5.2 後台案件頁顯示送達狀態（建議做）

園方要知道「這位家長收到了沒、要不要打電話」。

- 後端：案件詳情（`backend/app/booking/schemas.py` `VisitRequestDetailOut` 與它的組裝處）加 `line_pnp: list[...]`，每筆是這個案件的 `line_pnp_messages`（範本、送出、收下、收不到、送達時間）。只讀，不加狀態欄（目前刻意只有時間欄，不必登記狀態機）。
- 畫面：後台案件詳情的聯絡資訊附近加一行，四種情況：
  - `delivered_at` 有值 →「LINE 通知已送達（時間）」
  - `rejected_at` 有值 →「這支電話收不到 LINE 通知，請來電」
  - `accepted_at` 有值、超過 24 小時沒有 `delivered_at` →「LINE 通知沒有送達（可能封鎖或沒同意），請來電」
  - 其他 →「LINE 通知已送出，等待送達」
- 改完 `npm run contract:generate`；admin 補 vitest。

### 5.3 停課通知（依 Q6 的答案）

- 目前停課（以及停課日的預約成功／變更）**不送**通知型訊息，沒 Email 也沒綁 LINE 的家長要園方來電；停課對話框的「要來電人數」本來就包含他們，不用改。
- 若 LINE 有合適範本：`line_pnp.template_for` 加對應，`booking/outbox.py` `enqueue_day_closed_email` 與 `booking/closure_service.py` 的計數要把這些家長從「要來電」改成「用 LINE 通知」（比照 `with_line`）。
- 若要用彈性型：要另外送 UX 審查，程式要加 `POST /bot/pnp/push`（沒有 `/v2`、回 200）並用不含圖片的 Flex；可以參考 `line_flex.parent_card`，但要先過審。

### 5.4 每日送達則數（可選）

- `GET https://api.line.me/v2/bot/message/delivery/pnp/templated?date=yyyyMMdd`（日期是 UTC+9；`status` 為 `ready` 才有 `success`，通常隔天才算好）。
- 放在後台 LINE 通知頁帳號那一列（「昨天送達 N 則」），比照 `line_accounts.quota` 的快取與失敗暫停；或只靠 §4 的 SQL 就好。

### 5.5 雜項

- 新增測試後重產 `backend/.test_durations`（`uv run pytest --store-durations`），CI 三組才會平均。
- Q5 若通知型訊息也算進每月額度：系統狀態的額度說明要改。

### 給下一個 session 的開頭提示（可直接貼）

> 讀 `docs/website-admin/line-pnp-runbook.md` 與 `docs/specs/2026-11-25-line-notification-messages-research.md` §6。LINE 已核准通知型訊息，§1 的答案已填。真機驗收結果：（貼 §4 的結果）。請做 runbook §5.1（若有）與 §5.2，§5.3 依 Q6 的答案處理。

## 6. 疑難排解

| 現象 | 原因 | 處理 |
|---|---|---|
| API 啟動失敗：`WEBSITE_LINE_PNP_ACCOUNTS 列了 hq，但…還沒設定` | 金鑰沒設或只設一個 | 補 `WEBSITE_LINE_HQ_*` 兩個 |
| 後台開關是灰的 | 這校選的帳號不是已開通的帳號，或沒設 `WEBSITE_LINE_PNP_ACCOUNTS` | 選「總部官方帳號」；確認變數 |
| 通知一直「寄送失敗」，日誌 `LINE_HTTP_403` | LINE 還沒開通這個帳號 | 先關開關，問 LINE；開通後在後台「站內通知 → 寄送失敗」重新寄送 |
| 日誌 `LINE_HTTP_400` | 範本或項目不能用（Q2） | 照 §5.1 改程式 |
| `rejected_at` 很多 | 家長的號碼沒綁 LINE、拒收、或沒同意 LINE 隱私權政策 | 正常現象，這些家長要來電 |
| `accepted_at` 有值但都沒有 `delivered_at` | webhook 沒設或「Use webhook」沒開、或簽章不符 | 照 §2 第 2 點重設，用 LINE Developers 的 Verify 測 |
| 家長說收到兩則 | 送出後逾時的情況不會重送；若仍重複，查 `line_pnp_messages` 同一案件同一範本有幾列 | 每則 outbox 只會有一列（唯一鍵）；兩列代表排了兩則通知，查 `outbox_messages` |
