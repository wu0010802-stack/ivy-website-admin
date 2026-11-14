# ChatGPT 廣告轉換追蹤：OpenAI 評估像素

日期：2026-11-15　分支：`feature/openai-ads-pixel-20261115`　範圍：只動 `web/`

## 為什麼做

園方在 ChatGPT 廣告管理平台（ads.openai.com）開了第一檔廣告「常春藤幼兒園｜認識高雄五所校園」，目標是點擊、到達頁是官網首頁。平台只看得到點擊，看不到點進來的家長有沒有預約。使用者要求把轉換追蹤接起來。

## 做法

沿用 2026-11-12 GA4／Meta Pixel 的架構（`docs/specs/2026-11-12-external-integrations-design.md` 第 1 節）加第三家，不另開一套：

- 新的執行期變數 `NUXT_PUBLIC_OPENAI_PIXEL_ID`（`runtimeConfig.public.openaiPixelId`），預設空白＝關。
- `web/shared/third-party-analytics.ts`：`AnalyticsIds` 多 `openaiPixelId`、`normalizeOpenaiPixelId`、CSP 來源。
- `web/app/utils/third-party-analytics.ts`：官方 snippet 的 queue stub 用 JS 建（公開頁 CSP 不允許沒登記雜湊的 inline script）、`oaiq('init', { pixelId, oppref? })`、延後載入 `oaiq.min.js`；`reportBookingLead` 多送 `oaiq('measure', 'appointment_scheduled', { type: 'customer_action' })`。
- 既有規則全部沿用：DNT／GPC 不載、第一頁是 `/visit/manage`、`/admin`、`/preview` 不載、這些頁面不送事件、預約成功只在伺服器回 `confirmed` 時送。

## 和另外兩家不同的地方

| 項目 | GA4／Meta Pixel | OpenAI 像素 | 理由 |
| --- | --- | --- | --- |
| 頁面瀏覽 | 每次換頁送 | 不送 | 只需要轉換；少送一種資料 |
| 預約成功的參數 | `campus_key`、`entry` | 沒有 | 標準事件的資料格式不收自訂欄位 |
| 進不送事件的頁面 | 先暫停再進去 | 沒有暫停動作 | SDK 只有程式呼叫才送，事件網址只有 origin＋pathname；唯一的開關 `consent(false)` 會刪掉廣告點擊代碼 cookie |
| 廣告點擊代碼 | GA 從清洗過的 `page_location` 讀 | 進站當下讀網址的 `oppref` 傳給 `init` | SDK 延後載入，之前站內換頁就讀不到 |

## 查證過的 SDK 行為（2026-11-15 的 `oaiq.min.js`）

- 事件的 `source_url`、`referrer_url` 只取 `origin＋pathname`，不含 query 與 hash。
- 沒有 `pushState`／`popstate` 掛鉤，不自動送頁面瀏覽。
- `init` 接受 `oppref`，會寫進 `__oppref` cookie（30 天）。
- 「自動進階比對」由 `https://bzrcdn.openai.com/pixel-config/v1/<PIXEL_ID>.json` 的 `automatic_advanced_matching_enabled` 決定，瀏覽器端沒有開關；開著會掃 `input, select, textarea`（Email、電話、姓名），雜湊後跟事件一起送。
- `opt_out: true` 會改變傳送路徑的判斷，所以不設（文件說它只影響未來的個人化，但程式裡還牽涉傳送方式）。

## 沒做、要使用者決定的

- 平台上建立資料來源（要同意《轉換條款》）、關自動進階比對、建轉換事件、掛到行銷活動。
- 隱私權政策第 5 段補第三項工具並發布。
- Railway 設變數。

步驟在 `deploy/README.md`「ChatGPT 廣告」。

## 驗證

`web/tests/openai-ads-pixel.spec.ts`（24 項）：ID 驗證、CSP、載入時機、廣告點擊代碼、預約成功事件、外掛掛載條件。暫時拿掉 init 的 oppref、SDK 載入、measure 三處時 12 項會紅。平台是否收得到事件要在正式站實測。
