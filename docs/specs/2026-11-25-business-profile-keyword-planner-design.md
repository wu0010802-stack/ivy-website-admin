# Google 商家檔案與 Keyword Planner 搜尋量（設計，2026-11-25）

- 狀態：已實作（`claude/sleepy-carson-d23zr2`，未合併、未部署）。合併部署後**預設關閉**：沒設變數就和現在一樣，只有後台多兩個「尚未設定」的區塊。
- 基準：`origin/main` `e4dbd3c`
- 來源：廣告成效規格 `2026-11-16-ad-roi-design.md` §10（階段二：商家檔案）、§11（階段三：Keyword Planner）。該規格寫「等 Google 核准後各自另寫計畫」；使用者 11-25 要先把程式做好，等核准下來設變數即可開。
- Google 文件已在 2026-11-25 查證（下面標「查證」的都附來源）。

## 1. 為什麼要做

業主 11-16 要的四項外部資料，階段一（GA4 花費、手填花費、各里結婚對數）已上線；剩下兩項：

1. **Google 商家檔案（義華）**：地圖與搜尋結果右側的店家卡片被看到幾次、被按電話／路線／網站幾次、民眾用哪些字搜尋到它。官網的 Search Console 只看得到「官網」本身，看不到店家卡片。
2. **Keyword Planner 搜尋量**：「三民區 幼兒園」這類字在高雄每個月有多少人搜尋，看需求的季節變化與各區差異。

## 2. 目標、非目標

**目標**
- 商家檔案：每天同步每日指標、每月同步搜尋字詞；成效統計「怎麼來、怎麼逛」接在 Google 搜尋後面，按月顯示，加上最近一個整月的前 25 個搜尋字詞。
- Keyword Planner：總管理者在後台維護關鍵字（最多 50 個）；每週同步最近 48 個整月的每月搜尋量；招生統計「廣告成效」最下面「搜尋需求」顯示最近 12 個整月的關鍵字 × 月份表，地區可切。
- 沒核准、沒設定、授權失效時，畫面照實說，並告訴園方該怎麼做。

**非目標**
- 不寫回 Google（不改商家資訊、不回覆評論、不建廣告或關鍵字計畫）。
- 不讀評論、照片、貼文（Business Profile 的其他 API）。
- 不把商家檔案的點擊對到官網預約（Google 沒有給個別使用者資料，也不該有）。
- Keyword Planner 不給出價建議、不預測、不推薦新關鍵字（`GenerateKeywordIdeas`）。只看園方自己列的字。
- 不在後台提供 OAuth 授權流程（refresh token 由業主用 OAuth Playground 取得、設到 Railway，見 §7）。

## 3. 驗證與設定

**查證**：
- 商家檔案 Performance API 只寫了使用者 OAuth（scope `https://www.googleapis.com/auth/business.manage`），沒有服務帳戶的官方做法；社群回報服務帳戶被邀請成管理員後一直停在「已邀請」。存取要申請「Application for Basic API Access」（用商家檔案的擁有者或管理員帳號），沒核准前配額是 0 QPM、核准後 300 QPM。來源：developers.google.com/my-business/content/implement-oauth、…/basic-setup、…/prereqs。
- Google Ads API：scope `https://www.googleapis.com/auth/adwords`；**2026-09-09 起開發者權杖不再生效**（「optional and ignored by the API servers」），存取等級綁在 OAuth 用戶端所屬的 Google Cloud 專案。Keyword Planner（`KeywordPlanIdeaService`）要 **Basic** 以上，Explorer 不能用；Test 等級只能讀測試帳戶。Basic 要先做 Cloud 專案的品牌驗證，再到 Cloud Console → Google Ads API Overview 申請。來源：developers.google.com/google-ads/api/docs/api-policy/developer-token、…/access-levels。
- 目前最新版本 v26（2026-10-14 發布，2027-11 停用）；v23 2027-02 停用。來源：…/google-ads/api/docs/sunset-dates。

**做法**：兩者都用 Google 帳號的 OAuth refresh token（`app/insights/google_token.RefreshTokenAuth`）。共用一組 OAuth 用戶端（ID＋密鑰），各自一把 refresh token（管商家檔案的帳號和能讀廣告帳戶的帳號不一定同一個）。access token 放程序記憶體、過期前 5 分鐘換新；401 時丟掉重換。

| 變數（api 服務） | 必填 | 說明 |
|---|---|---|
| `WEBSITE_GOOGLE_API_CLIENT_ID`、`WEBSITE_GOOGLE_API_CLIENT_SECRET` | 兩者任一啟用就要 | OAuth 用戶端（網頁應用程式類型），建在商家檔案 API 已核准的 Google Cloud 專案；兩個成對 |
| `WEBSITE_GBP_REFRESH_TOKEN` | 商家檔案 | 管理員帳號授權 `business.manage` 的 refresh token |
| `WEBSITE_GBP_LOCATIONS` | 商家檔案 | `校區=地點ID` 逗號分隔（也收 `locations/<ID>`），例 `yihua=12345678901234567890`；校區要是五校代號 |
| `WEBSITE_GOOGLE_ADS_REFRESH_TOKEN` | Keyword Planner | 能讀廣告帳戶的帳號授權 `adwords` 的 refresh token |
| `WEBSITE_GOOGLE_ADS_CUSTOMER_ID` | Keyword Planner | 廣告帳戶編號，可寫 `582-345-1021` |
| `WEBSITE_GOOGLE_ADS_LOGIN_CUSTOMER_ID` | 選填 | 經管理員帳戶存取時，管理員帳戶的編號 |
| `WEBSITE_GOOGLE_ADS_DEVELOPER_TOKEN` | 選填 | Google 已不看；只有把 `WEBSITE_GOOGLE_ADS_API_VERSION` 調回舊版時才需要，設了才送 |
| `WEBSITE_GOOGLE_ADS_API_VERSION` | 選填 | 預設 `v26`；Google 停用舊版前改這裡即可 |
| `WEBSITE_GOOGLE_SYNC_SECONDS` | 選填 | 背景迴圈多久醒來一次，預設 3600（600–86400） |

成對檢查（`app/config.py`，錯誤訊息不帶值）：refresh token 與地點成對；廣告的 refresh token 與帳戶編號成對；任一組有設就要有 OAuth 用戶端；只設 login customer id 或開發者權杖而沒有另外兩個會拒絕啟動。

## 4. 商家檔案

### 4.1 Google 的 API（查證，Performance API v1，discovery revision 20261123）

- 每日指標：`GET https://businessprofileperformance.googleapis.com/v1/locations/{id}:fetchMultiDailyMetricsTimeSeries`，`dailyMetrics` 重複帶、`dailyRange.startDate.year|month|day`、`dailyRange.endDate.…`。回應 `multiDailyMetricTimeSeries[].dailyMetricTimeSeries[].timeSeries.datedValues[]`，`value` 是字串，**值為 0 時不出現**。
- 要的指標（存成短代碼，`app/insights/models.GBP_METRICS`）：搜尋曝光（電腦、手機）、地圖曝光（電腦、手機）、`CALL_CLICKS`、`BUSINESS_DIRECTION_REQUESTS`、`WEBSITE_CLICKS`、`MESSAGING_CLICKS`（2026-10-14 新增）。`BUSINESS_CONVERSATIONS` 已在 2026-01-31 移除，不要。曝光是同一人同一天只算一次。
- 搜尋字詞：`GET …/locations/{id}/searchkeywords/impressions/monthly`，`monthlyRange.startMonth.year|month`、`monthlyRange.endMonth.…`，`pageSize` 最多 100、`pageToken`。期間是**整段加總**（沒有每月欄位），所以一個月叫一次。每列 `insightsValue` 只有 `value`（確切）或 `threshold`（少於這個數）其中一個。
- 保留多久、晚幾天：官方沒寫。

### 4.2 同步（`app/insights/business_profile.py`）

- 每個地點各自同步、各自記狀態（`google_sync_status`，key `gbp:<校區>`）；一校失敗不影響別校。
- **每天一次**：上次成功的台北日期早於今天才同步；失敗後 3 小時內不再試。
- 每日指標：第一次往回抓 18 個月，每段最多 3 個月、由新到舊；較舊的段落回 400 就當作 Google 只有到那裡（最新那段回 400 照樣算失敗）。之後每天從已存的最後一天往前 7 天重抓到昨天（晚到的數字會補上）。Google 沒給值的日子存 0。
- 搜尋字詞：最近兩個整月每天重抓（整月替換），更早的抓過就不再抓（`gbp_keyword_months`）。比最近兩個整月舊的月份回 400 也當作超出範圍，記成抓過、沒有字詞。每月最多 10 頁（1,000 個字詞）。字詞空白合併、截到 200 字；撞名時確切值優先、數字大的優先。
- 全部抓完才寫進資料庫（同一個交易）：中途失敗不會留下半套資料。

### 4.3 資料表（migration `c4e7b2a91f63`）

- `gbp_daily_metrics`（校區, 日, 指標代碼）→ 值。
- `gbp_monthly_keywords`（校區, 月, 字詞）→ `impressions` 或 `below`（恰好一個有值，CHECK）。
- `gbp_keyword_months`（校區, 月）→ 抓的時間。

都只有 Google 給的彙總數字，沒有訪客或家長資料，不進個資保存清理。

### 4.4 後台（`GET /admin/business-profile`，admissions.stats）

成效統計「怎麼來、怎麼逛」，接在「Google 搜尋」後面（`BusinessProfilePanel.vue`）：

- 每月表（本月與前 12 個月，有資料的月份，由新到舊）：搜尋曝光、地圖曝光、手機占、電話、路線、網站、訊息。本月或最後一天不是月底時寫「（到 11/22）」。
- 最近一個抓過字詞的整月：前 25 個字詞（確切值依曝光由多到少，接著「少於 N」），寫「前 25 個，共 N 個字詞」。
- 不隨頁首期間變動（同 CrUX）；有兩校以上時可切校區。
- 同步失敗時顯示原因與建議（`syncErrorHint`：refresh token 400＝授權失效或同意畫面還在測試、403＝API 沒核准或帳號不是管理員、404＝地點 ID 不對、429＝用量上限），舊資料照樣顯示。

## 5. Keyword Planner

### 5.1 Google 的 API（查證，v26）

- `POST https://googleads.googleapis.com/v26/customers/{帳戶}:generateKeywordHistoricalMetrics`；標頭 `Authorization`、選填 `login-customer-id`。
- 本文：`keywords`（上限 10,000）、`language`、`geoTargetConstants`（上限 10，多個是合併計算）、`keywordPlanNetwork`、`historicalMetricsOptions.yearMonthRange`（年是字串、月是 `JANUARY` 這類列舉，兩端都含）。
- 回應 `results[].text`、`closeVariants`、`keywordMetrics.monthlySearchVolumes[] {year, month, monthlySearches}`；int64 都是字串。**`monthlySearches` 是 null＝那個月沒有數字**。近似字詞會併成一列，所以列數可能比送出的少。最多回過去 4 年。每個帳戶每秒 1 次。

### 5.2 查什麼

- 語言：繁體中文 `languageConstants/1018`。網路：只算 Google 搜尋（`GOOGLE_SEARCH`，預設會含搜尋夥伴）。
- 地區（geotargets-2026-10-06.csv）：高雄市 `9040314`、三民區 `9215426`（義華）、左營區 `9239360`（明華、崇德）。**鳥松區（國際）、仁武區（仁武）在 Google 的清單裡只有郵遞區號（833 `9227880`、814 `9241625`），沒有區的層級，不加**；Keyword Planner 收不收郵遞區號層級的地區官方沒寫。
- 一個地區一次請求，請求之間隔 1.1 秒。期間：最近 48 個整月。

### 5.3 同步（`app/insights/search_demand.py`）

- 有關鍵字、而且（從沒成功、距上次成功 7 天以上、或有還沒同步過的新關鍵字）才同步；失敗後 3 小時內不再試（就算有新關鍵字）。
- 比對：兩邊都轉小寫、空白合併；`closeVariants` 裡的字詞也對到同一份數字。Google 沒回的字不存任何月份（畫面「量太少」）。
- 高雄市失敗整輪算失敗；區失敗只記在 `last_error`（`左營區：查詢 Keyword Planner（HTTP 400）`），成功的地區照寫、`last_success_at` 照記。
- 每個地區在 48 個月範圍內整段替換；最後把這輪送出的關鍵字 `synced_at` 設成這輪時間。同步期間被刪掉的關鍵字不寫。
- 資料表：`search_keywords`（字詞唯一、`synced_at`）、`search_keyword_volumes`（關鍵字, 地區, 月）→ `searches`（可為 NULL＝量太少，不補 0）。

### 5.4 後台

- `GET /admin/search-demand`：地區清單、最近 12 個整月、每個關鍵字每個地區 12 格（`available`＝Google 有回這個月；`available` 而 `searches` 是 null＝量太少）、同步狀態。沒設定時照樣列關鍵字（可以先加好）。
- `POST /admin/search-demand/keywords {text}`：空白合併、1–80 字、最多 10 個詞；不分大小寫不能重複（409 `SEARCH_KEYWORD_EXISTS`）；最多 50 個（422 `SEARCH_KEYWORD_LIMIT`）；數量與重複在同一個 advisory lock 裡檢查。稽核 `search_keyword.create`。
- `DELETE /admin/search-demand/keywords/{id}`：連同搜尋量一起刪（外鍵 CASCADE）。稽核 `search_keyword.delete`。
- 全部要 `admissions.stats`（總管理者）。
- 畫面（`SearchDemandSection.vue`，招生統計 → 廣告成效最下面，不受月份區間影響）：地區切換、新增欄位與「N / 50」、關鍵字 × 12 個月的表（關鍵字欄左右捲動時黏在左邊）、「量太少」與「—」分開、還沒同步的整列寫「還沒同步，一小時內會抓到」（沒設定時寫「設定好之後會抓」）、刪除要確認。

## 6. 背景迴圈與 CLI

- `app/workers/google_loop.GoogleSyncLoop`：比照 Facebook 同步，自己一個 asyncio task，商家檔案或 Keyword Planner 任一個設定好才啟動；啟動後 90 秒第一輪，之後每 `WEBSITE_GOOGLE_SYNC_SECONDS`。要不要真的向 Google 要資料由兩個同步自己判斷。全部是 upsert／整段替換，多個程序同時跑只是多寫一次一樣的值，不加 advisory lock。
- `uv run python -m app.cli google-sync`：立即同步兩者（不看今天同步過沒、不看失敗後的等待），印出每校幾天、幾個月、幾個關鍵字或錯誤步驟；有失敗 exit 1。設好變數後用它確認授權與存取。

## 7. 業主要做的事（上線步驟寫在 `deploy/README.md`，操作說明在 `docs/website-admin/operations.md`）

| 時機 | 事項 |
|---|---|
| 現在 | 用管理義華商家檔案的帳號申請 Business Profile API 存取（Google 表單，填 Cloud 專案編號）；核准後在同一專案開啟 Business Profile Performance API |
| 現在 | 同一個 Cloud 專案開啟 Google Ads API，做品牌驗證後申請 Basic 存取（免費試用的帳單帳戶會被拒） |
| 核准後 | 在同一專案建 OAuth 用戶端、同意畫面設成「正式版」（「測試」狀態的 refresh token 7 天就失效），用 OAuth Playground 各取一把 refresh token |
| 核准後 | 找出義華的地點 ID，Railway api 設變數，`google-sync` 確認 |
| 之後 | 在「搜尋需求」維護關鍵字 |

## 8. 測試

- 後端：`tests/test_google_data_config.py`（設定）、`tests/test_business_profile.py`、`tests/test_search_demand.py`（假 Google 照官方格式：refresh token 換權杖、值為 0 不出現、int64 字串、分頁、近似字詞、量太少、各種 HTTP 錯誤；檢查 log 與錯誤不含密鑰）。
- 後台：`admin/src/__tests__/googleData.test.ts`。
- 沒驗：真的 Google（沒有核准的專案與權杖）、OAuth Playground 取 token 的實際畫面、商家檔案資料實際保留多久與晚幾天、Keyword Planner 是否接受區層級的地區（三民區、左營區失敗時只會在畫面註明，高雄市照常）。
