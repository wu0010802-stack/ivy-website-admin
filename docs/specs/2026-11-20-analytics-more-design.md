# 成效統計補強七項（2026-11-20）

使用者 11-20 問「`/admin/analytics` 還有什麼更多的統計可以做」，看完盤點後說「這些都做」。七項都是全站匿名計數，沿用既有的閘（`NUXT_PUBLIC_TELEMETRY_ENABLED`、DNT／GPC、`statsAllowed` 排除自動化瀏覽器與後台人員）與成效統計起算日（`analytics_stats_start`，2026-11-13）。

| # | 項目 | 後台位置 | 資料來源 |
|---|---|---|---|
| 1 | 每月比較（年對年） | 成效統計第五類「每月比較」 | 新表 `engagement_monthly`＋既有 `page_view_daily`、`visit_requests` |
| 2 | 統計健康檢查 | 成效統計頁頂端；總部 LINE 群組（要開） | 既有表＋GA4 Data API（有設才查） |
| 3 | AI 助理來源 | 所有來源表 | 來源代碼多一個 `ai` |
| 4 | 找不到的網址（404） | 瀏覽與速度 | 新表 `not_found_daily` |
| 5 | Google 搜尋字詞分群、曝光多點擊少 | 怎麼來、怎麼逛 → Google 搜尋 | Search Console（字詞多抓到 500 個） |
| 6 | 電話、LINE 的點擊時段 | 走到預約 | 既有 `analytics_events`（cta_click_phone／line） |
| 7 | 搜尋引擎與 AI 爬蟲 | 瀏覽與速度 | 新表 `crawler_hits_daily` |

migration `a6c3e9f2d417`：四張新表、`visit_requests.first/last_touch_source` 的 CHECK 加 `ai`。只放寬與新增，不改既有資料，不需要先備份正式庫。

## 1. 每月比較

- `engagement_visits` 只留 90 天；明年招生季要和今年同月比，得把每個月的數字留下來。
- 定期工作每天跑一次 `monthly_service.rollup`：**整個月的紀錄都還在**（月初不早於清除界線）的月份刪掉重算；紀錄開始被清之後就不再動，留下的是那個月完整時的數字。本月一路累計到昨天。
- 存：造訪、頁面瀏覽、送出預約的造訪、停留中位數（total）；各裝置、各來源、回訪分類（造訪數與預約）；各頁（瀏覽與停留中位數，各校頁併成一列）；預約表單走到哪一步。沒有任何訪客資料，不清。
- 讀的時候接上永久保存的每日瀏覽量與官網預約案件（和招生統計同一個口徑；限 `admissions.stats` 且在校區範圍內，否則 `null`）。
- 後台一列一個月；有去年同月時每一格下面寫「去年 ±x%」（只比次數，不比比例）。

## 2. 統計健康檢查

`app/operations/stats_health.py`，檢查昨天（GA4 看前天，資料晚一天才齊）：

| key | 條件 |
|---|---|
| `traffic_zero` | 昨天瀏覽 0，前幾天（起算日之後、至少 3 天）平均每天 ≥ 5 |
| `engagement_low` | 昨天瀏覽 ≥ 20，內容興趣不到瀏覽的兩成 |
| `attribution_missing` | 近 7 天官網預約 ≥ 3 筆，沒有一筆記到網站來源 |
| `ga4_silent` | 有設 GA4 資源編號；前天瀏覽 ≥ 20，GA4 事件數 0（讀不到 GA4 不報） |

門檻為這個站的流量（一天幾十次）定，故意抓寬。後台頁頂端顯示（沒有異常或讀不到就不顯示）。LINE：群組通知種類多一個 `stats_health`（不在 `STAFF_KINDS`、**預設不開**），只在總部群組顯示開關；09:00–12:00 推一次，`stats_health_runs` 記錄同一天每群組只推一次。

## 3. AI 助理來源

- `ENGAGEMENT_SOURCES` 在 `search` 後面加 `ai`（web、backend、預約案件 CHECK、匯出標籤、後台標籤）。
- 判斷：來源網站是 chatgpt.com、chat.openai.com、perplexity.ai、gemini.google.com、copilot.microsoft.com、claude.ai 等（**先於搜尋引擎**，gemini.google.com 也符合 google.*），或 `utm_source` 以 chatgpt／openai／perplexity／gemini／copilot／claude／deepseek／grok／poe 開頭（ChatGPT 的連結會自己帶 `utm_source=chatgpt.com`）。
- 付費廣告（點擊代碼或付費 `utm_medium`）一律仍算 `ads`，所以「AI 自然推薦」與「ChatGPT 廣告」分得開。
- 部署後才開始分；之前的 AI 導流已記成 `other`（或 `search`），不回補。

## 4. 找不到的網址

- 訪客：`telemetry.client.ts` 在錯誤頁 `statusCode === 404` 時送 `{event:'not_found', path, ref}`（同一路徑只送一次）。路徑解碼、小寫、去掉結尾斜線、不含 `?`／`#`、最多 160 字；`ref`＝none／internal／search／external（站內換頁一律 internal）。經 `/api/telemetry`（同一道 Origin 檢查與配額）轉 API `/public/not-found`。
- 爬蟲：官網伺服器看到搜尋引擎或 AI 爬蟲抓到 404，路徑另記為 `ref=crawler`（§7 的批次）。
- 一天最多 300 個不同網址（滿了只累加已有的），保留 90 天。
- `/public/not-found`、`/public/crawler-hits` 加進代理的 `SERVER_ONLY_PATH`，瀏覽器直接打一律 404。

## 5. Google 搜尋字詞分群

- 搜尋字詞那一次查詢 `rowLimit` 25 → 500（其他維度不變），表格照樣只列前 25 個。
- `query_group`：brand（常春藤、ivy、義華／明華／崇德＋幼）→ local（高雄、38 區名）→ category（幼兒園、托嬰、學費、補助…）→ other。
- `query_groups`：各群字詞數、點擊、曝光、點閱率、曝光加權平均排名。`missed_queries`：曝光 ≥ 20、點閱率 < 2%，曝光多的在前，最多 10 個。

## 6. 電話、LINE 的點擊時段

- 讀 `analytics_events` 的 `cta_click_phone`／`cta_click_line`（點下去當下回報，時間準到秒）。
- 上班時間暫定**週一到週五 8–18 點**（`contact_hours_service.OFFICE_*`，一般幼兒園行政時間；各校實際不同時再改）。
- 後台：上班時間外的比例、星期 × 時段（時段切在 8、18 點上，和「什麼時候有人看」不同）、各校。

## 7. 搜尋引擎與 AI 爬蟲

- `web/shared/crawlers.ts` 依 User-Agent 認 35 種（AI 即時讀取／AI 搜尋索引／AI 訓練／搜尋引擎／社群預覽／SEO 工具／監測），其他自稱爬蟲的算 `other`。自稱的、沒有反查 DNS。
- `web/server/plugins/crawler-hits.ts`：`request` 時看 User-Agent，回應 `finish` 時記（爬蟲、頁面、回應類別）。不用 `afterResponse`：它在錯誤回應（404）時不觸發，正式建置實測過，只算網頁與 robots.txt／sitemap.xml／llms.txt，`/_nuxt`、`/__nuxt_error`、`/api`、`/assets`、`/admin`、帶副檔名的不算，後台網域不算；每分鐘彙總送一次 `/public/crawler-hits`（API 另限每分鐘 10 批）。重啟會丟最後不到一分鐘的計數。
- 只有計數，不清。

## 上線後要做的事（使用者）

- 總部 LINE 群組要收「官網統計異常」：後台 LINE 通知 → 總部群組 → 打開「官網統計異常」。
- GA4 那一項要正式站設了 `WEBSITE_GA4_PROPERTY_ID`（與 Search Console 共用服務帳戶）才會查。
- 隱私權政策：沒有新增 cookie，也不新增個資；404 只記網址路徑，不必改。
