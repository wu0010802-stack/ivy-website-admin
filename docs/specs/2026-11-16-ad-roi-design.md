# 廣告成效與成本、各里結婚對數、Google 商家檔案、關鍵字搜尋量（設計）

- 日期：2026-11-16
- 狀態：階段一已實作（feature/ad-roi-20261116，未合併、未部署）
- 基準：`origin/main` `7b4ad4ed`
- 工作分支：`feature/ad-roi-20261116`（worktree `~/Repositories/ivy-website-wt/ad-roi-20261116`，sparse）
- 相關規格：cookie 六項 `2026-11-16-cookie-features-design.md`（§1 跨次來源、§2 回傳廣告平台）、外部服務五項 `2026-11-12-external-integrations-design.md`（§3 Search Console）、出生走勢 `2026-10-14-birth-series-design.md`、里的變化 `2026-10-14-admissions-village-trends-design.md`、地圖工作台 `2026-10-16-admissions-area-workbench-design.md`

## 1. 為什麼要做

業主 11-16：想知道**廣告的效益與成本、值不值得**，沒有其他特定要做的決定。

現況：
- Google 搜尋廣告「搜尋-五校招生-202611」11-16 開跑（每日 NT$300，帳戶 582-345-1021），ChatGPT 廣告 11-16 開跑。Meta、LINE 目前沒投，但像素／Tag 已備好。
- 官網送單時已記下「第一次進站」與「預約前最後一次不是直接進站」的來源代碼（`visit_requests.first_touch_*`／`last_touch_*`，11-16 起），後台已有「網站來源 → 預約、到場、預繳」（`GET /admin/analytics/booking-attribution`，`BookingAttributionPanel.vue`）。
- **缺的是花費**，而且「廣告」只有一個來源代碼 `ads`，分不出是 Google 還是 ChatGPT（`web/shared/engagement-source.ts` 的 `classifySource` 看到 `gclid`／`gbraid`／`wbraid` 或付費 `utm_medium` 就歸 `ads`；ChatGPT 的 `oppref`、LINE 的 `ldtag_cl` 目前根本不會歸成 `ads`）。

業主同時要的另外三項外部資料：各里結婚對數、Google 商家檔案（地圖上的電話／路線）、Keyword Planner 搜尋量。後兩項要等 Google 核准存取，分到後面的階段。

## 2. 目標、非目標、反目標

**目標**
1. 招生統計多一個子分頁「廣告成效」：選月份區間，看每個廣告平台的花費、點擊、官網預約、到場、預繳，以及每筆預約、每位到場、每位預繳各花多少。
2. Google 廣告花費每天自動從 GA4 抓；其他平台（ChatGPT、Meta、LINE、其他）由總管理者每月手填一個金額。
3. 官網進站時記下是哪個廣告平台帶來的，預約案件存下平台。
4. 各里每月結婚對數（戶政 ODRP060）同步進來，區域分析看得到。
5. 階段二：義華的 Google 商家檔案每日曝光、電話、路線、網站點擊與每月搜尋字詞。
6. 階段三：Keyword Planner 每月搜尋量（關鍵字清單由後台維護）。

**非目標**
- 不把花費分攤到各校（目前一個活動跨五校，分攤只會製造假精確）。各校只看廣告帶來的預約、到場、預繳筆數。
- 不換算學費收入、不算投資報酬率（ROAS）；畫面只給「每位預繳花多少」，值不值得由業主判斷。（寫稿者決定，業主要的話之後再加。）
- 不做關鍵字層級的花費（方案 A 的取捨）。
- 不自動調整出價或預算，不寫回任何廣告平台。
- 結婚對數只描述，不拿來預測、不進招生潛力或市佔率的計算。

**反目標（做了也算失敗）**
- 任何家長個資或案件層級資料送到外部（GA4 Data API 只讀彙總報表）。
- 分校管理者或接待看得到花費（全部走 `admissions.stats`，只有總管理者）。
- 把 Google 自己回報的轉換數當主要數字；主數字一律是後台自己的預約、到場、預繳。
- 「平台不明」的廣告預約被默默算進某個平台。
- 同一筆 Google 花費被自動抓一次又手填一次（重複計算）。

## 3. 業主已定的事（11-16）

- 方案 A：Google 花費自動抓（GA4），其他平台每月手填，Keyword Planner 等權杖下來再補。
- 四項都要做；商家檔案先做義華，等 API 開通；Keyword Planner 等開發者權杖。
- 招生統計的東西只給總管理者（10-16 起的既有規則）。

## 4. 做法比較

| 項目 | 選項 | 取捨 | 採用 |
|---|---|---|---|
| 花費來源 | A GA4 自動＋其他手填 / B Google Ads API 全部 / C 全部手填 | A 不需開發者權杖、最快可用，但只有活動層級；B 細到關鍵字與地區但要等審核，期間看不到；C 最簡單但只有月總數、靠人記得填 | A（業主選） |
| GA4 數字怎麼拿 | 即時查＋快取 / 每天同步存庫 | 即時查沿用 Search Console 的做法（`app/insights/`），不用新表與排程；存庫的好處是 GA4 連結拿掉後還有歷史 | 即時查＋6 小時快取（寫稿者決定；GA4 標準報表的彙總資料不受資料保留期限影響） |
| 廣告平台記在哪 | 拆來源代碼（`ads_google`…）/ 另加平台欄位 | 拆代碼會動到既有六類來源、互動統計與所有來源表；另加欄位只影響 `ads` 這一類 | 另加欄位（寫稿者決定） |
| 期間單位 | 日期區間 / 月份區間 | 手填花費是月總數，用日期區間就得按天攤；月份區間兩邊口徑一致 | 月份區間（寫稿者決定） |
| 歸因 | 第一次進站 / 最後一次非直接進站 | 沿用 `booking-attribution` 既有的切換，預設最後一次 | 兩種都給、預設最後一次（沿用） |

## 5. 進站時記下廣告平台

### 5.1 判斷規則（`web/shared/engagement-source.ts`）

新增 `adPlatformOf(search)`，依序：

| 落地網址參數 | 平台代碼 |
|---|---|
| `gclid`、`gbraid`、`wbraid` 任一 | `google` |
| `oppref` | `openai` |
| `ldtag_cl` | `line` |
| `utm_medium` 是付費（現有 `PAID_MEDIUM`）且 `utm_source` 以 facebook／fb／meta／instagram／ig 開頭 | `meta` |
| `utm_medium` 是付費且 `utm_source` 以 chatgpt／openai 開頭（沒有 `oppref` 時的後備） | `openai` |
| `utm_medium` 是付費且 `utm_source` 以 line 開頭 | `line` |
| 其他付費 `utm_medium` | `other`（其他網路廣告） |

`classifySource` 判 `ads` 的條件同步加上 `oppref`、`ldtag_cl`：有平台代碼就是 `ads`。
- 影響：ChatGPT 廣告點擊原本多半歸 `other`（來源網站 chatgpt.com）或 `direct`，LINE 廣告點擊原本歸 `line`，改了以後歸 `ads`。這個函式也用在第一方互動統計，該處的來源分布會跟著變，屬於修正而非退步，README 記一筆。
- Meta 的 `fbclid` 在一般貼文外連也會出現，**單靠 `fbclid` 不算廣告**；之後投 Meta 廣告時，廣告網址要帶 `utm_medium=paid&utm_source=facebook`（業主操作說明寫進 `docs/website-admin/operations.md`）。

### 5.2 cookie 與資料庫

- `ivy_src` 的 touch 物件（`web/shared/attribution-cookie.ts`）多一個選填欄位 `p`，只在 `s === 'ads'` 時寫，值限上表五個代碼；解碼時不合規則就丟掉 `p`、其他欄位照收。`v` 維持 1（舊 cookie 沒有 `p` 一樣可讀）。web 與 backend 的共用測試樣本要補有 `p` 的案例。
- `visit_requests` 加 `first_touch_ad_platform`、`last_touch_ad_platform`（`String(8)`、可為 NULL），`backend/app/booking/attribution.py` 解析後寫入，規則同既有 touch 欄位（重播不改、不進冪等雜湊、匿名化不清、DNT／GPC 不記）。
- 上線前已存在的 `ads` 案件平台是 NULL，畫面列為「廣告（平台不明）」，不回填。
- 隱私權政策第 4 節已寫「來源類別、活動代碼與日期，以及廣告平台附在連結上的點擊代碼」，平台代碼在這個範圍內，**不必改政策**。

## 6. 花費

### 6.1 Google：GA4 Data API

- 端點：`POST https://analyticsdata.googleapis.com/v1beta/properties/{WEBSITE_GA4_PROPERTY_ID}:runReport`，scope `https://www.googleapis.com/auth/analytics.readonly`。
- 驗證：沿用 Search Console 那組服務帳戶（`WEBSITE_GOOGLE_SC_SERVICE_ACCOUNT_JSON`），簽 JWT 換 token 的程式從 `insights/search_console.py` 抽成共用、scope 參數化。新變數 `WEBSITE_GA4_PROPERTY_ID`（純數字；正式站是 `563982090`）。兩個都有才算設定好。
- 查詢：期間＝所選月份區間的第一天到最後一天（不超過今天），維度 `yearMonth`、`sessionGoogleAdsCampaignId`、`sessionGoogleAdsCampaignName`，指標 `advertiserAdCost`、`advertiserAdClicks`、`advertiserAdImpressions`。另取 `keyEvents:generate_lead`（Google 自己算的預約轉換）當對照；若和花費指標不相容就分兩次查。
- 幣別：讀回應 `metadata.currencyCode`，畫面照實標示；不是 TWD 時照樣顯示但加註，不自行換匯。實作時先確認 GA4 資源幣別是新台幣。
- 快取與失敗：同 Search Console，依「期間＋查詢」快取 6 小時、同一份同時只向 Google 要一次；沒設定回 `{configured: false}`，失敗回 `{configured: true, error: "<步驟>（HTTP n）"}`，不帶 Google 回應內容。
- 時間差：Google Ads 花費進 GA4 約晚一天，當月是進行中的數字，畫面註明。

### 6.2 其他平台：每月手填

- 新表 `ad_spend_entries`：`id`、`month`（該月 1 日的 date）、`platform`（`openai`／`meta`／`line`／`other`（其他網路廣告）／`offline`（傳單、看板等）；**不收 `google`**，避免和 GA4 重複）、`amount`（整數新台幣，0 到 10,000,000）、`note`（選填，100 字內）、`updated_by`、`created_at`、`updated_at`；`(month, platform)` 唯一。
- API（都要 `admissions.stats`）：`GET /admin/admissions/ad-spend?from=&to=`、`PUT /admin/admissions/ad-spend/{month}/{platform}`（新增或改）、`DELETE` 同路徑。寫入記操作紀錄，新稽核鍵在 `admin/src/api/auditLabels.ts` 歸類。
- `other` 和 §5.1 的平台代碼同義（帶付費參數、但不是上面四家的網路廣告），有預約也有花費時照算成本。`offline` 是傳單、看板等非網路花費，官網記不到它帶來的預約，畫面只列花費、成本欄顯示「—」。（寫稿者決定，審閱時發現 `other` 原本一碼兩義。）

## 7. 成效計算

純函式放 `backend/app/admissions/ad_roi.py`（查庫與計算分開，同 `journey.py` 的分層），端點 `GET /admin/admissions/ad-roi?from=YYYY-MM&to=YYYY-MM&touch=last|first`。

- **期間**：月份區間、兩端都含，最多 24 個月，預設 2026-11 到本月。
- **案件批次**：官網送出的預約（`VisitRequest.source == web`），`created_at` 落在期間內（台北日界線），排除已標記排除的，五校合計。到場、預繳的判定與 `booking_outcomes_service.attribution_outcomes` 相同（`_outcome`、`_deposited` 直接共用）。
- **平台歸屬**：依所選 touch 的來源；是 `ads` 時看同一個 touch 的平台欄位，NULL 歸「平台不明」。最後一次 touch 沿用既有規則（沒有最後一次但有第一次時算 `direct`）。
- **每個平台一列**：花費（Google 用 GA4，其他用手填，期間內加總）、點擊（只有 Google）、預約、到場、未到場、預繳；每筆預約成本＝花費 ÷ 預約，每位到場成本＝花費 ÷ 到場，每位預繳成本＝花費 ÷ 預繳；分母 0 回 `null`（畫面「—」，同招生統計慣例）。
- **列出哪些平台**（寫稿者決定）：Google 一定列；其他平台在期間內有花費或有預約才列；「平台不明」有預約才列；離線花費有填才列。順序：Google、ChatGPT、Meta、LINE、其他網路廣告、平台不明、離線花費、非廣告來源。
- **沒填花費**（寫稿者決定）：手填的平台在期間內有預約、但一個月都沒填，花費顯示「未填」、成本欄「—」；部分月份有填就照加總顯示，旁邊註「缺 N 個月」。「未填」和「填了 0」要分得出來。
- **時區**：GA4 用 `yearMonth` 依 GA4 資源的時區切月，實作時確認資源時區是台北；若改用 `date` 自己加總，同樣以資源時區為準，註腳寫明。
- **對照列**：非廣告來源合計一列（搜尋、直接進站、社群等），只有筆數沒有花費，讓業主比較「廣告帶來的」佔多少。
- **手填平台的成本分母**（最終審查 11-16）：顯示的預約、到場、預繳仍是整段期間，但三個成本只除以「有填花費的月份」的案件（月份依台北時間的 `created_at`），沒填的月份不拉低成本；有缺月的列 `cost_partial` 為 true，成本後加「＊」並註明「只算有填花費的月份」。Google 一律不套用（GA4 涵蓋整段）。
- **還沒定案的數**：同一批案件裡還沒到參觀日、或已到場但仍在考慮的筆數另外回傳，畫面寫「廣告帶來的預約中，另有 N 筆還沒到參觀日、M 筆還沒標記到場、K 筆到場後還在考慮。」，提醒預繳數還會變。
- **各校**：平台 × 校區的預約、到場、預繳筆數，沒有花費。
- **Google 活動明細**：GA4 回來的每個活動一列（活動名稱、花費、點擊、曝光、單次點擊成本、Google 回報的預約轉換）。官網這邊目前不分 Google 活動（自動標記不帶 `utm_campaign`），所以活動列沒有後台的到場與預繳；業主日後若在 Google Ads 的追蹤範本加上 `utm_campaign={campaignid}`，官網就會記到活動代碼，屆時可再對起來（本期不做）。
- **「沒有來源紀錄」列**（實作時加，規格外）：沒有來源 cookie 的預約（開了 DNT／GPC、2026-11-16 之前送出的）另列一行 `unrecorded`，不混進「非廣告來源」；補登的預約本來就不在案件批次內。「預約」數含之後被取消的預約。
- **已知的低估或高估**：開了「不要追蹤」的訪客、看到廣告後直接打電話或走進來的，都不會算到廣告，所以成本會偏高；畫面一行註腳寫明。

## 8. 畫面

- 招生統計新增子分頁 `ads`「廣告成效」，加在 `STATS_SUBS` 最後（官網延伸的子分頁都排最後的既有規則）。像「五校比較」一樣看五校合計，不受頁面校區選擇影響。
- 頁首：月份區間、歸因切換（最後一次／第一次），沿用招生統計現有元件。
- 版面草圖：

```
廣告成效   2026-11 ～ 2026-12   ○最後一次進站 ●第一次進站

平台        花費     點擊   預約  到場  預繳   每筆預約   每位到場   每位預繳
Google     9,000    310     6     4     1     1,500     2,250     9,000
ChatGPT    3,000      —     1     0     0     3,000        —         —
平台不明       —      —     1     1     0         —        —         —
非廣告來源     —      —    18    12     5         —        —         —
另有 3 筆還沒到參觀日、2 筆到場後還在考慮。

Google 活動            花費    點擊   曝光   單次點擊   Google 回報預約
搜尋-五校招生-202611   9,000   310   4,120     29          5

各校（廣告帶來的）  義華  明華  崇德  國際  仁武
  預約               4     1     0     1     0
  …

其他平台花費（每月手填）            [新增]
2026-11  ChatGPT  3,000  備註…     編輯 刪除
```

- GA4 沒設定時，Google 那列花費顯示「未設定」並在表下一行說明；其他照常算。
- 文案遵守既有規則：不放操作說明式的長段落、不放開發輔助字；說明收進表下註腳。

## 9. 各里結婚對數（戶政 ODRP060）

- 實測（2026-11-16）：`/api/v1/datastore/ODRP060/<民國年月>?COUNTY=高雄市` 一頁、約 390 KB；115-09 有 893 里，109-09 有 891 里，109-08 回「查無資料」，所以**從 109 年 9 月開始**（和出生的 ODRP061 一樣）。欄位有 `marry_pair_OppositeSex`、`marry_pair_SameSex`（另有出生、死亡、離婚，本期只取結婚）。
- 實作：`village_series.py` 新增一組 `Series`（`"marriages"`、`ODRP060`、「各里結婚」，`marriages = marry_pair_OppositeSex + marry_pair_SameSex`，留 72 個月同出生）；新表 `geo_village_marriages`（同 `_VillageMonth` 結構）；`geo_dataset_status` 多收 `marriages`，同步週期與回補規則同出生；後台系統狀態頁 `DATASET_LABELS` 補「各里結婚」；`fetch_geo_bundle.py` 與 CLI 的 `--marriages-file` 比照出生。
- 畫面：區域分析的里表多一欄「近 12 個月結婚（對）」；出生走勢（`BirthSeries`）每一期多一欄同期結婚對數。口徑一句話註腳：「依戶政登記的里，只描述、不推估之後的出生」。
- 口徑風險：戶政結婚對數依登記的戶籍里計，兩人戶籍不同里時算在哪一里官方沒寫；本期照實呈現並在規格記下，不另外處理。

## 10. 階段二：Google 商家檔案（義華）

> 2026-11-25：階段二、三已依 `2026-11-25-business-profile-keyword-planner-design.md` 實作，與下面原稿不同之處以那份為準（OAuth refresh token、開發者權杖 2026-09-09 起不再需要、`BUSINESS_CONVERSATIONS` 已移除、鳥松與仁武沒有區層級的地區代碼）。

**前置（業主）**：用管理義華商家檔案的 Google 帳號申請 Business Profile API 存取（Google 表單，要填 Google Cloud 專案編號；沒核准前額度是 0）；核准後在同一專案開啟 Business Profile Performance API。

- 授權：商家檔案的管理員只能是 Google 帳號，預期要用 OAuth 使用者授權（scope `business.manage`）一次取得 refresh token，存成 Railway 變數；服務帳戶能不能直接加成管理員，實作時先驗證，能的話改用服務帳戶。
- 資料：`fetchMultiDailyMetricsTimeSeries` 每日指標（搜尋／地圖曝光的桌機與手機、電話、網站點擊、路線、訊息），每天同步存庫（新表，地點 × 日期 × 指標），同步時重抓最近 7 天；`searchkeywords/impressions/monthly` 每月關鍵字曝光存另一張表。Google 能回溯多久沒查到，第一次同步盡量往回抓。
- 畫面：成效統計頁 Search Console 區塊旁「Google 商家檔案」：按月的曝光、電話、路線、網站點擊，與最近一個月前 25 個搜尋字詞。
- 其他四校：明華、仁武由別人管理，崇德、國際未認領；認領並加入同一個管理帳號後，在變數加地點 ID 即可，不改程式。

## 11. 階段三：Keyword Planner 搜尋量

**前置（業主）**：建立 Google Ads 管理員帳戶並連結 582-345-1021，申請 Google Ads API 開發者權杖（需通過審核才能讀正式帳戶），以 OAuth 取得 refresh token。

- 資料：`KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics`，語言繁體中文，地區先用高雄市（各區有沒有獨立的地區代碼實作時查 `geo_target_constants`，有就加五校所在區）。每月同步一次，存每個關鍵字的月搜尋量（API 最多回四年）。
- 關鍵字清單在後台維護（最多 50 個，例：「三民區 幼兒園」「左營 幼稚園」），只有總管理者能改。
- 量太少時 Google 回空值，畫面寫「量太少」，不補 0。
- 畫面：廣告成效子分頁下方「搜尋需求」：關鍵字 × 月份的走勢表。

## 12. 權限、隱私、設定

- 所有新端點用 `admissions.stats`（`backend/app/auth/permissions.py` 既有 capability），不在路由寫角色判斷。
- 對外只有：GA4 Data API（讀彙總）、戶政 API（公開資料）、階段二／三的 Google API（讀彙總）。不送任何案件或家長資料。
- 新變數：`WEBSITE_GA4_PROPERTY_ID`（階段一）；階段二、三的變數在各階段實作時定，寫進 `deploy/README.md`。

## 13. 資料庫、測試、部署

- **這次的實作計畫只涵蓋階段一**：§5～§9（含各里結婚對數）。階段二、三等 Google 核准後各自另寫計畫，本次不預留介面或空表。
- 階段一一支 migration：`visit_requests` 加兩欄、新表 `ad_spend_entries`、新表 `geo_village_marriages`。只新增、不改既有資料，不需備份閘門。合併前 fetch main，接在最新 head 之後。
- 測試：
  - web：`adPlatformOf`／`classifySource` 各參數組合、cookie `p` 的編解碼與壞值丟棄（web 與 backend 共用樣本）。
  - backend：attribution 解析平台、`ad_roi` 純函式（分母 0、平台不明、非廣告對照、還沒定案筆數）、GA4 client（假 transport：設定缺漏、401、幣別、快取）、手填花費 CRUD 與權限（非總管理者 403、`google` 被拒）、ODRP060 解析與同步。
  - admin：子分頁、表格格式、手填對話框、未設定狀態。
  - stack e2e：總管理者開「廣告成效」看到表、手填一筆後花費出現。
  - `npm run contract:generate`／`contract:check`。
- 階段一不需要業主先完成任何前置就能上線（GA4 沒設定時 Google 列顯示「未設定」）。

## 14. 業主要做的事

| 時機 | 事項 |
|---|---|
| 階段一上線後 | GA4 管理 → 資源存取管理：把 Search Console 那個服務帳戶的 email 加成「檢視者」；在該服務帳戶的 Google Cloud 專案開啟 Google Analytics Data API；Railway api 設 `WEBSITE_GA4_PROPERTY_ID=563982090` |
| 現在就可以開始 | 申請 Business Profile API 存取（階段二） |
| 現在就可以開始 | 開 Google Ads 管理員帳戶、申請開發者權杖（階段三） |
| 每月 | 在「廣告成效」填 ChatGPT 等平台上個月的花費 |

## 15. 留給實作者

- `keyEvents:generate_lead` 能否和 `advertiserAdCost` 同一次查；`yearMonth` 與 Google Ads 活動維度的相容性（不相容就改用 `date` 自己加總）。
- 共用 JWT 程式抽出來的位置與命名。
- GA4 回應超過單頁列數時的分頁（24 個月 × 活動數）。
- 廣告成效子分頁的元件拆法、與 `BookingAttributionPanel` 共用多少格式函式。
- 里表新增欄位在窄螢幕的排法（沿用里表既有橫捲）。
