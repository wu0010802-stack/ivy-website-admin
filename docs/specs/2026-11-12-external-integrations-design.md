# 外部服務串接五項（2026-11-12）

使用者 11-12 挑的五項：GA4＋Meta Pixel、Google Search Console API、Instagram Graph API（先做義華）、外部存活監測、CrUX API。
共同原則：

- **全部預設關**：沒設環境變數就跟現在完全一樣（不載腳本、不打外部 API、後台顯示「尚未設定」）。上線不需要先有帳號。
- 外部請求的 User-Agent 只寫 `Mozilla/5.0 (compatible; ivy-website-<用途>/1.0)`，不帶帳號、email。
- 金鑰只走環境變數（`repr=False`），不進網址、log、例外訊息、API 回應。
- 不新增依賴（JWT 簽章用既有的 authlib／joserfc）。

## 1. GA4＋Meta Pixel（前台 web/）

依 10-03 裁定：有 cookie、不做同意橫幅、尊重 DNT／GPC，揭露放隱私權政策。只做 GA4 與 Meta Pixel（Google Ads、LINE Tag 這次不做）。

- runtimeConfig.public：`gaMeasurementId`（`NUXT_PUBLIC_GA_MEASUREMENT_ID`，格式 `G-XXXXXXXX`）、`metaPixelId`（`NUXT_PUBLIC_META_PIXEL_ID`，純數字）。格式不符視同未設定。執行期變數（Nuxt 依鍵名對應），改了重啟即可。
- 新外掛 `plugins/third-party-analytics.client.ts`：
  - 條件：ID 有設、`trackingAllowed()`（同既有 telemetry：DNT／GPC 就不載）、目前不是後台、不是 `/visit/manage`（token 在 hash）。
  - 不用 GTM、不用 inline script：用 `document.createElement('script')` 載 `https://www.googletagmanager.com/gtag/js?id=…` 與 `https://connect.facebook.net/en_US/fbevents.js`，`gtag`／`fbq` 的 queue stub 在外掛裡用 JS 建。
  - GA：`gtag('config', id, { send_page_view: false })`，換頁時自己送 `page_view`，`page_location` 自組為 `origin + pathname + 只保留 utm_* 與 gclid/fbclid 的 query`，不帶 hash；`page_title` 用 document.title。
  - Pixel：`fbq('init', id)`、每次換頁 `fbq('track', 'PageView')`。
  - 預約成功：只在 `created.status === 'confirmed'` 送 GA `generate_lead`、Pixel `Lead`，參數只用白名單 `campus_key`（五校之一）與 `entry`，不送 receipt、manage path、任何個資。若現有程式有「預約成功」的 telemetry 事件位置，掛在同一處。
  - 進入 `/visit/manage`、`/admin` 時不送事件（SPA 換頁到那裡也一樣）。
- CSP（`web/server/utils/security-headers.ts`、`script-csp.ts`）：只有在對應 ID 有設定時才加來源，未設定時 CSP 字串與現在完全相同。
  - GA：script-src `https://www.googletagmanager.com`；connect-src `https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`；img-src `https://*.google-analytics.com https://www.googletagmanager.com`。
  - Pixel：script-src `https://connect.facebook.net`；connect-src `https://www.facebook.com https://connect.facebook.net`；img-src `https://www.facebook.com`。
  - 後台 CSP 不動。
- 文件：`docs/website-admin/seo-performance.md:33` 的「未新增 Cookie／外部分析服務」改寫成現況；後台隱私權政策初稿 `admin/src/composables/privacyPolicyDraft.ts` 第 5 段（Cookie／分析）寫進 GA4、Meta Pixel 用途、DNT／GPC 不載、可用瀏覽器設定拒絕。
- 測試：外掛的條件判斷與 page_location 清洗寫成可單測的純函式；CSP 在有／無 ID 兩種情況各一個測試。

## 2. Instagram 貼文 → 同一個收件匣（backend/、admin/）

沿用 FB 粉專同步（`docs/specs/2026-10-28-facebook-news-sync-design.md`）：同一把 Page token、同一個收件匣、同一套「轉成消息草稿」。

- 開關：`WEBSITE_INSTAGRAM_ENABLED`（預設 false）。開了才在每校 FB 同步之後多做 IG。不另設 IG 帳號 ID：用 `GET /{page_id}?fields=instagram_business_account` 從粉專找到 IG 專業帳號；沒連結就在同步狀態記「粉專沒有連結 Instagram 專業帳號」。
- 讀 `GET /{ig_user_id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}&limit=25`（Authorization header 帶 Page token）。
  - IMAGE／CAROUSEL_ALBUM：照片＝media_url（相簿取第一張圖片的 children）；VIDEO（含 Reels）：影片＝media_url、照片＝thumbnail_url。
  - caption 對應 message、timestamp 對應 posted_at、permalink 對應 permalink_url。
- 資料表：`facebook_page_posts` 加 `source`（`facebook`／`instagram`，預設 facebook，加 CHECK）；post_id 存 `ig_<media id>` 避免和 FB 撞。同步狀態 `facebook_page_sync` 加 `ig_last_error`、`ig_last_success_at`、`ig_last_count`（或等價設計），IG 失敗不影響 FB 那一列。migration 只加欄位。
- 下載白名單：IG 的 media_url 主機是 `*.cdninstagram.com` 或 `*.fbcdn.net`，把 `is_facebook_cdn` 擴成同時接受 cdninstagram.com（只接受 https、不跟轉址的規則不變）。
- 後台收件匣：每則貼文標示來源（Facebook／Instagram），可用來源篩選；同步狀態顯示 IG 那一行。轉成消息的流程完全共用。學校常同一篇 FB、IG 都發，收件匣會出現兩則，由人略過一則，不做自動去重。
- 權限：Page token 需要再加 `instagram_basic`（＋已有的 pages_show_list、pages_read_engagement）。沒權限時 Graph 回 code 10／200，狀態記「權杖沒有 Instagram 權限」。重新授權由使用者做（見 deploy/README.md 新增段落）。
- 先做義華：`WEBSITE_FACEBOOK_PAGES` 已經只有義華，所以開開關就只同步義華的 IG（`ivy.kids.school.ig`）。

## 3. Google Search Console（backend/、admin/）

- 變數：`WEBSITE_GOOGLE_SC_SERVICE_ACCOUNT_JSON`（服務帳戶金鑰整份 JSON，repr=False）、`WEBSITE_GOOGLE_SC_PROPERTY`（例如 `sc-domain:ivykidschool.com`）。兩個要同時設（同 FB 的成對驗證）。
- 驗證：服務帳戶 JWT（RS256，scope `https://www.googleapis.com/auth/webmasters.readonly`）換 access token，token 存在程序記憶體到過期前 5 分鐘。
- 查詢：`POST https://searchconsole.googleapis.com/webmasters/v3/sites/{property}/searchAnalytics/query`，不存資料庫；結果在記憶體快取 6 小時（key＝期間＋維度）。
- 後台 API（權限同成效統計 `admissions.stats`，只限總管理者能看全站）：`GET /admin/search-insights?start=&end=`，回
  - 總計：點擊、曝光、CTR、平均排名；
  - 前 25 個搜尋字詞（點擊、曝光、CTR、排名）；
  - 前 25 個頁面（路徑，不含網域）；
  - 裝置別（手機／桌機／平板）。
  - 未設定回 `{configured:false}`；Google 失敗回 `{configured:true, error:"…"}`（只帶 HTTP 狀態，不帶回應內容）。
- 後台成效統計頁加一區「Google 搜尋」：期間跟著整頁那一組期間；資料有 2–3 天延遲要寫在區塊小字。

## 4. CrUX 真實使用者數據（backend/、admin/）

- 變數：`WEBSITE_CRUX_API_KEY`（repr=False）。origin 用既有的公開站網址設定（`https://www.ivykidschool.com`）。
- 查詢：CrUX History API `POST https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=…`（key 只能放網址：例外與 log 一律不印網址），origin 層級，formFactor PHONE 與 DESKTOP 各一次，metrics LCP／INP／CLS 的 p75 與好／需改善／差比例，最近 25 週。不存資料庫，快取 12 小時。
- 回 404（資料量不足）時顯示「Chrome 使用者數量還不夠，Google 尚未提供這個網站的數據」。
- 後台 API `GET /admin/crux`（同上權限），回兩種裝置的週序列。
- 後台成效統計的網頁速度區（既有第一方 CWV 旁）加「Chrome 真實使用者（28 天滾動，每週更新）」的 p75 與走勢；註明網域 11-11 才從 Wix 換過來，前幾週混有舊站資料。

## 5. 外部存活監測（不寫程式）

`deploy/README.md` 新增「外部存活監測」段落：建議 UptimeRobot 免費方案（5 分鐘一次、email／LINE 通知可選），要建的監測：

| 名稱 | 網址 | 期望 |
|---|---|---|
| 官網首頁 | `https://www.ivykidschool.com/` | 200 |
| API 健康 | `https://www.ivykidschool.com/api/website/v1/health` | 200、內容含 `ok` |
| 後台 | `https://www.ivykidschool.com/admin/` | 200 |

帳號由使用者建立（不能由 agent 代辦），通知收件人由使用者決定。

## 上線後由使用者做

1. GA4：建資源→取得 `G-…`；Meta Pixel：沿用舊站 `ivykids.tw` 的 Pixel 或新建（使用者決定）→ Railway web 設 `NUXT_PUBLIC_GA_MEASUREMENT_ID`／`NUXT_PUBLIC_META_PIXEL_ID`。**隱私權政策要先發布**再開。
2. IG：義華 IG 轉專業帳號並連結義華粉專 → 重新授權加 `instagram_basic` → 換 Page token → 設 `WEBSITE_INSTAGRAM_ENABLED=true`。
3. Search Console：GCP 建服務帳戶與金鑰、啟用 Search Console API → 在 Search Console 把服務帳戶加成「受限」使用者 → 設兩個變數。
4. CrUX：GCP 啟用 Chrome UX Report API、建 API key（限制只能用這支 API）→ 設變數。
5. UptimeRobot 建帳號與三個監測。
