# 官網後台與分校參觀預約規格

日期：2026-09-19。修訂：v3。v2 使用者已選定 Nuxt 前台；v3 依同日審查結論加入分階段執行、第一版範圍縮減（角色、審核流程、`slots` 延後）、標題字型子集處理、原型凍結點、開發代理與 Node 版本限制。產品程式尚未實作。

本文件以 `/Users/yilunwu/Desktop/ivy-website-prototype` 的現行工作目錄為準，包含未提交的設計修改。配套：[實作計畫](../superpowers/plans/2026-09-19-website-admin.md)、[Claude 執行提示詞](../handoff/2026-09-19-claude-website-admin.md)。

## 1. 目標、架構與授權範圍

建立一個管理五所分校的官網後台，讓園方更新現有畫面內容及素材，分別切換各校預約方式，並處理實際收到的參觀需求。

執行基準：同 repo 新增 `web/`、`admin/` 與 `backend/`。公開官網採 **Nuxt 4 + Vue 3 + TypeScript，SSR 為預設**；現行 vanilla 原型作為視覺、互動與內容基準，逐區遷移為 Vue 元件。後台採 Vue 3 + TypeScript + Pinia + Vue Router + Element Plus + Vite；API 採 FastAPI **0.136.1（已釘版，勿升）**、SQLAlchemy 2.0、Alembic、PostgreSQL。實作時確認 Nuxt 4 的受支援穩定 patch 與 Node 相容版本，寫入版本檔及 lockfile，不使用 beta 或 nightly。

公開官網與後台共用生成的 API 型別及業務 enum，UI 各自維持用途。公開官網不載入 Element Plus；Nuxt 不另建預約／授權／容量的業務後端，統一呼叫 FastAPI。

「獨立官網後台」是本次建議的執行預設，不表示使用者已決定正式部署供應商或核准連接既有園務系統。五個官網分校 key 為 `yihua`、`minghua`、`chongde`、`international`、`renwu`，不等同園務系統 tenant_id。

### 分階段執行

本規格描述完整目標，但實作分四個階段，一次 session 只做一個階段，階段之間有硬閘（細節與閘門條件見實作計畫「階段與閘門」）：

| 階段 | 內容 | 第一版範圍限制 |
|---|---|---|
| A | Nuxt 以 fixture 重現現站，正式路徑與舊 hash 相容 | 不接 API；通過閘門的 commit 為原型凍結點 |
| B | 帳號、素材庫、內容編輯與發布 | 只做總管理者、分校管理者兩種角色；內容狀態只有草稿與已發布 |
| C | 預約 `inquiry`／`line`／`phone`／`external`／`paused`、真實送單、Nuxt 接 CMS | 不做 `slots` |
| D | `slots` 容量與時段、家長自助管理、通知 worker、統計、保存政策、備份還原、其餘角色與審核流程 | 開工前先向園方確認 `slots` 是否需要；每一塊可再拆或延後 |

本文件後續章節凡標註「階段 D」者，A–C 不實作，但 A–C 的資料模型與 API 不得阻擋其後補上（例如 `VisitRequest.slot_id` 可先為 nullable 欄位，`mode` enum 仍含 `slots` 但後台第一版不可啟用）。

### 全域限制

- 全部使用繁體中文（台灣用語）。
- FastAPI 0.136.1（已釘版，勿升）。
- 公開官網採 Nuxt 4 + Vue 3 + TypeScript，SSR 為預設。
- 保留現有官網版型、動畫、RWD 與無障礙互動；正式網址改為路徑路由，舊 hash 連結提供相容轉址。
- 只修改本 repo，不連接或修改 ivy-backend、ivy-frontend、ivyManageSystem 的業務資料。
- 官網資料使用獨立資料庫；不得使用 `ivymanagement` 或任何既有 staging/production DB。
- 開發 migration 與整合測試只可用明確標示為本任務專用的隔離資料庫。
- 不自動部署、push、對外發布、發送真實家長通知或建立付費服務。
- 不復原、不丟棄、不夾帶提交工作目錄原有未提交變更。
- 缺漏校區聯絡資料保留待補，不借用其他校的 LINE、電話或預約網址。
- 憑證只透過環境變數；不寫入 repo、範例資料、前端 bundle 或執行紀錄。
- 機器為 8GB RAM；測試與影片轉檔依序執行，不同代理不得同時跑測試。
- Node 釘 22 LTS（`.nvmrc` 與 `engines`），本機 25.x 不使用。PostgreSQL 本機為 14.x；文件註明測過的版本，部署版本不同時重跑並發測試。
- 開工前使用者已 commit 現有設計修改為 baseline，實作在 `feature/website-admin` worktree 進行；agent 發現工作樹不乾淨時停下回報。

正式環境、物件儲存服務與通知供應商尚未選定，不影響本機實作；提供介面與可驗證的本機替代實作，將外部整合狀態如實記錄。

正式前台使用 Nuxt build 的 Node server 與 `.output/public` 靜態資產；只將官網必要且已公開素材放入 `web/public/`。不得把整個 repo 當 production 靜態根目錄；`backend/`、`web/app/`、`admin/src/`、`.env`、備份、私有上傳、docs、design、versions 與原型 preview 不可透過官網讀取。開發服務只綁 localhost；正式同源入口為 `/admin/` → Vite 管理端、`/api/website/v1/` → FastAPI、其他官網路徑 → Nuxt。開發代理也需覆蓋登入、草稿預覽與預約 API，不能以關閉權限或開放任意 CORS 代替。開發環境不安裝 caddy／nginx：Nuxt 以 `nitro.devProxy` 把 `/api/website/v1/` 轉到 FastAPI，Vite 以 `server.proxy` 做同樣的事並以 `base: '/admin/'` 服務；兩份設定的責任檔列於計畫 Task 1。

## 2. 已核對的現況

行號是本次盤點的定位提示，執行前須以函式／欄位名稱重新定位。

| 目前功能 | 現況／定位 | 後台管理範圍 |
|---|---|---|
| 品牌、導覽、頁尾 | `index.html:19–48` | Logo、中英文名稱、導覽標籤、連結、頁尾、預約文案 |
| 首頁主視覺 | `app.js:17–20`、`home():264` | 影片、海報、主副標、CTA |
| 關於常春藤 | `home():264–286` | 品牌文字、年份、大小照片及圖說 |
| 孩子的一天 | `dayMoments:70`、`dayExperience():97`、`setupDayExperience():105` | 六張照片卡、時間、背面故事／問答、桌機／手機影片與海報 |
| 分校基本資料 | `campuses:23–29` | 五校名稱、地區、地址、電話、簡介、照片裁切、社群 |
| 首頁分校展示 | `boardInfo/boardActions/campusBoardSection:726–733` | 新版墨綠底板卡，保留校名軌道切換與互動 |
| 分校內頁 | `campusPage():330` | 封面、介紹、探索、FAQ、交通與聯絡、預約入口 |
| 校園探索 | `tourScenes:288`、`scenesFor():301`、`campusTour():302` | 平面照片場景、熱點、說明、參觀提問 |
| 消息、活動 | `homepageNews:196–209`、dialog:228–244 | 各校／全校新聞、活動、首頁排序、內文 |
| 預約 | `bookingLink():48`、`visitPage():335`、`setupBooking():465` | 現在只驗證及顯示示範結果，尚無 API 或保存 |
| 單檔預覽 | `package_preview.py:25–67` | 遷移前保存為可離線開啟的原型快照；新版 Nuxt 另以服務預覽 |

### 新設計必須保留

- 孩子的一天已不是舊分頁：現在是影片背景、六張捲動顯影且可翻面的拍立得；桌機交錯、手機單欄。
- 欄位為 `key,time,label,tint,photo,alt,caption,title,story,question,answer`；六張的 key 與順序先保留，第一版不開放任意增刪張數。
- 影片常數為 `DAY_FILM`、`DAY_FILM_MOBILE`；目前 **760px 以下**選手機版。保留進入才載入、離開暫停、reduced-motion 不自播。
- 午休仍使用暫代照片。時間、招生資訊、活動等示範文字不能宣稱已經園方核定。
- 首頁分校為新版 e3 墨綠底板卡，首頁已移除嵌入地圖；分校內頁仍保留地圖。
- 頁首預約為金色滿高按鈕；不回復舊版 pill 樣式。
- 30 週年目前只是設計提案，不新增週年後台或啟用該提案。
- 最新消息和活動用 dialog 展示，沒有獨立文章網址；本輪保留此行為。
- 不把 `design/`、`versions/` 或文件中的舊版敘述當成目前正式功能。

## 3. 後台功能與內容模型

後台導航：總覽、首頁內容、分校管理、孩子的一天、校園探索、消息與活動、FAQ、素材庫、參觀預約、預約設定、發布紀錄、帳號權限、網站設定。

### 3.1 全站與首頁

- 全站：品牌名稱、英文名稱、Logo、選單與頁尾、聯絡文字、預約按鈕標籤。首頁通用預約先選校，不固定跳義華。
- Hero：標題、副文、桌機影片、poster、載入失敗替代圖片、按鈕文字與站內目的地。
- 關於：創立年份、標題、介紹、雙照片、alt 與圖說。以現在版位為準，不重新加入已移除的連結。
- 一天：區塊標題、補充文案、桌機與手機影片、共同 poster、字幕、六張卡片各欄位；`tint` 用既有允許色票，不能輸入 CSS。
- 首頁消息／活動：推薦與排序、顯示筆數（遵守現有版型上限）、自動到期下架。
- 文案長度、圖片比例在欄位旁提示，提供桌機與手機預覽，不做任意 HTML／CSS 頁面編輯器。

### 3.1.1 標題與品牌字型（v3 新增）

現站標題字型 LINE Seed TW 與頁首品牌字 Noto Sans TC 600 都只以**子集**進站（`assets/fonts/lineseed-bd.woff` 全站標題用字、`lineseed-eb.woff` h1 用字、`noto-sans-tc-600-brand.woff` 只含「常春藤教育機構」、`noto-sans-tc-600-anni.woff` 只含「週年」），原始 OTF 不在本機。後台一旦開放編輯標題或品牌名稱，缺字會退回 PingFang，標題風格整段崩壞。處理原則：

- 階段 A 沿用子集，但 Task 2 必須跑缺字檢查（fontTools 取 cmap 聯集比對 fixture 全部標題欄位），缺字列入報告；不得默默退回系統字。
- 階段 B 開工前取得 LINE Seed TW 完整字型檔（Bold、ExtraBold）轉 woff2 放進 `web/`，並以 `unicode-range` 或 `font-display: swap` 控制載入成本；品牌字改用完整 Noto Sans TC 600 的 woff2 或維持子集但把品牌名稱欄位鎖為不可編輯。此為使用者 2026-09-19 核可的預設，若改採「發布時重切子集」需另補 job 與測試。
- 後台標題類欄位保存時即時提示目前字型是否涵蓋全部字元；完整字型到位後此提示只作資訊。
- 原型的 `package_preview.py` 與子集不動，它們只服務凍結後的原型快照。

### 3.2 分校

- 保留五個穩定 key，正式網址為 `/campuses/{key}`，原有 hash 網址依第 9 節相容轉址；名稱、地區、地址、電話、intro、description、社群、顯示順序、封面與建築線稿可修改。
- 各版位獨立焦點：`panoramaPos`、`photoPos`、`heroPhotoPos` 正規化成 0–100 的 x/y；不要把任意 CSS 字串存入新 API。
- 可停用／封存分校，保留歷史預約、素材引用與操作紀錄；不硬刪分校。
- 停用需同時停止公開預約。已確認案件列入「待人工處理」，不得自動取消。
- 地址與地圖可分別編輯；只有驗證後的地圖／社群網址可公開。不接受 iframe HTML 或任意 script。
- FAQ 可使用全站共用項目，另加各校項目；局部修改不改動其他校共用答案。
- 招生年齡、名額、費用、課程及師資目前沒有獨立功能。本輪以既有介紹／FAQ 管理已核定內容，不新增招生 ERP 或師資履歷系統。

### 3.3 校園探索

- 場景：`key,name,image,intro,sort_order`。
- 熱點：`name,x,y,text,question,sort_order`，x/y 為照片上的百分比座標。
- 後台可在照片上點選位置、拖動熱點、檢查標籤；鍵盤可輸入座標與操作排序。
- 更換場景圖時標記熱點待複核，複核完成才能發布該場景。
- 保留平面照片縮放、拖曳／方向鍵平移、展開檢視與場景切換，不改建 360 導覽。

### 3.4 消息、活動與 FAQ

- 消息：id、日期、分類、標題、摘要、結構化內文、封面、alt、適用校區、首頁推薦、排序、發布／下架時間。
- 活動：id、標題、描述、開始／結束時間、地點、適用校區、相關連結、發布／下架時間；月份顯示由日期衍生。
- `scope=global` 表示全校；`scope=campus` 必須有指定校區清單。分校人員只能編輯單一自己授權校的內容；跨校內容由總部管理。
- 內文只支援段落、標題、清單、圖片與驗證後連結；存結構化資料，不直接插入使用者 HTML。
- FAQ：問題、答案、排序、啟用狀態、共用或指定校區。
- 已發布的隱私／同意說明可從頁尾及表單開啟可讀的 dialog，保留鍵盤操作與焦點返回；表單提交綁定當時顯示的說明版本。
- 活動報名、付款、票券、獨立文章路由不在本輪。

## 4. 素材庫與發布

### 素材庫

- 支援 JPEG、PNG、WebP 圖片和 MP4 影片；先不接受上傳 SVG、HTML 或執行檔。既有受控程式圖示不經上傳流程。
- 可分校／共用分類、標籤搜尋、批次上傳；記錄 alt、圖說、來源、授權註記、上傳者、檔案大小、實際格式、尺寸／時長。
- 上傳端檢查實際內容、限制大小、隨機儲存 key、解碼驗證；不相信副檔名或客戶端 MIME。原檔保留，衍生縮圖另存。
- 初始上限：圖片 15 MB、影片 150 MB，可由部署設定調整；大型轉檔在背景工作依序執行，未完成不可發布。
- 桌機／手機影片為不同 asset 引用，poster 為獨立圖片；允許沿用同一支影片，但不得強迫所有版位共用裁切設定。
- 每個引用記錄內容 revision 與欄位路徑。替換預設只改目前版位；批次替換需先列出影響範圍，產生草稿。
- 仍被草稿、現行發布或可還原版本引用的素材不可硬刪。未使用素材可封存；實體清理採獨立工作。
- 新上傳的草稿素材需授權才能取得，公開發布後才提供公開 URL；瀏覽器不能直接列舉私有 bucket。現有 assets 中已公開的圖檔不宣稱能因匯入素材庫而變回私密。
- 開發提供本機儲存 adapter；正式儲存 provider 未設定時清楚列為部署待辦，不假裝已串接。

上傳處理依循 [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) 的 allowlist、內容驗證與儲存隔離原則。

### 草稿、預覽與發布

- 編輯不直接影響官網。每次保存形成 revision。**第一版（階段 B）狀態只有草稿與已發布**；待審核、已核准、退回原因與排程發布屬階段 D，資料模型先預留狀態欄位但 API 第一版只接受兩種值。
- 總管理者／授權分校管理者可發布自己權限範圍內容；內容編輯只能送審（階段 D，隨該角色一起啟用）。
- 預覽須經登入且校區範圍驗證，回應 `Cache-Control: no-store`；不得使用任意 query 參數繞過權限。
- 發布使用不可變 `SiteRelease` manifest，原子切換現行版本；不能混用舊照片與新文案。
- 發布／還原只套用指定內容 revision，不順帶發布他人草稿。全站還原限總管理者；分校人員只能還原自己校區的內容。
- 排程發布（階段 D）綁定明確 revision 與時區；執行時重新驗證權限、素材就緒及分校狀態。
- 同時編輯以 revision/version 偵測衝突，回 409 並提示重新載入，不覆蓋別人的修改。
- 官網每次 SSR 請求讀取一份當前已發布快照，所有區塊使用同一 release_id。瀏覽器已顯示的頁面可保留原快照並提示更新失敗；首次 SSR 無法取得內容則回 503，不回空白 200 或以示範資料替代。
- 第一版不啟用公開 HTML 與當前 release 查詢的跨請求共用快取。發布成功後的新 SSR 請求、重新整理與站內換頁必須讀到新 release；已開啟頁面不要求即時推送。若後續加快取，需先完成版本化、失效及多程序一致性測試。
- 正式模式 `live` 只讀 API；`fixture` 僅限開發／測試，顯示示範標記並禁止真實提交。production 啟動若設定 fixture 必須失敗。授權草稿預覽是另一條私有資料流程，不屬於公開內容 fallback。
- 內容版本還原不回復預約設定、時段、案件或通知狀態。

## 5. 分校預約設定

每校唯一一筆 `BookingConfig`，包含 `mode`、`version`、主要按鈕文案、說明、輔助聯絡入口、負責人、通知對象、表單設定與時段規則。

`slots` 模式整體屬**階段 D**：現站 FAQ 目前寫「實際參觀請直接致電園所」，園方是否需要線上選時段尚未確認。階段 C 的 enum 仍含 `slots`，但後台不可啟用（顯示「尚未開放」而非缺件原因），公開 API 對 `slots` 提交回 `BOOKING_UNAVAILABLE`。第 6.3、6.4 節與 `VisitRule/VisitException/VisitSlot`、`RescheduleRequest`、`VisitAccessToken` 模型同屬階段 D。

| mode | 家長行為 | 啟用條件 |
|---|---|---|
| `inquiry` | 填寫需求，待園方聯繫 | 已配置接待窗口、有效同意文字、表單設定 |
| `slots` | 選時段填資料 | 上述設定及有效開放時段規則；可設人工或自動確認 |
| `line` | 開啟該校 LINE | 該校有效 HTTPS LINE 連結 |
| `phone` | 手機撥號；桌機顯示電話與服務時間 | 該校有效電話 |
| `external` | 前往外部預約網站 | 驗證後 HTTPS URL，顯示外部服務提示 |
| `paused` | 顯示暫停說明與可用諮詢入口 | 暫停文字；不接受公開站內提交 |

- 主要預約方式單選；電話／LINE 等輔助聯絡方式可並存。
- 缺漏資料的模式在後台顯示不可啟用原因；不推測真實 LINE 或其他校資料。
- 所有 CTA 共用 `resolveBookingAction(campusKey, config)`；未選校先出選校流程。純電話／LINE 聯絡按鈕仍保留原有聯絡目的。
- 設定切換採立即生效且有修改前後紀錄；先顯示受影響範圍預覽，不修改既有案件。
- 公開表單帶 `config_version`；送出交易重新驗證模式與版本。過期回 `BOOKING_CONFIG_CHANGED`，保留尚未送出的表單輸入，提示新方式。
- 已成功建立案件的相同 idempotency 重試，先回傳原結果，不因後來切換模式而回錯誤。
- 設定更新與建單在 DB 以相同設定列鎖定規則序列化，避免檢查後設定已變仍建單。
- 舊案可由授權人員繼續確認、聯絡、完成、取消；模式切換不重寫當時的來源與設定版本。
- 外部連結僅做驗證及前端跳轉，API 不主動抓取任意網址。

## 6. 表單、案件與時段

### 6.1 表單與回應

保留目前欄位：分校必填、家長稱呼 1–40 字、台灣手機 09 開頭共 10 碼（先移除空格與連字號）、孩子年齡選項、方便聯絡時間、問題最多 500 字、同意勾選。API 的 age 固定為 `unknown|under_2|2-3|3-4|4-5|5-6`；contact_time 固定為 `flexible|weekday_morning|weekday_afternoon|other`，前端以目前繁體中文標籤顯示。

依模式增加 `slot_id`、參觀人數（1–10）與選填 Email。Email 只有啟用家長 Email 通知時才設必填。預設不蒐集兒童姓名、證號或生日。方便聯絡時間不等於參觀時間。

- 同意紀錄保存 `consent_revision_id`、伺服器接受時間與同意結果，不自行宣稱法律合規；正式文案可從後台維護。
- 開發 seed 的同意／活動資料標註示範，不可直接當成正式公開收件已就緒。
- 真實持久化成功才顯示成功；API 失敗保留表單並可安全重試。不得用 localStorage 假裝正式後端。
- `inquiry` 成功為「已收到參觀需求，園方將聯繫確認」；`slots` 人工確認模式為「已收到時段申請，待園方確認」；自動確認成功才稱「預約已成立」。
- 回應只含隨機 receipt id（即 VisitRequest.id 的 UUID）、狀態、分校及必要參觀資訊，不回傳其他家長資料，也不提供用流水號查詢個資的公開端點。receipt id 本身不是家長管理授權憑證。
- `Idempotency-Key` 同一表單嘗試使用同一 key；相同 key 不同 payload 回 409。限流回 429，前端顯示可重試提示。

### 6.2 案件狀態與操作

狀態：`new`、`contacting`、`pending_confirmation`、`confirmed`、`completed`、`cancelled`、`no_show`。

- inquiry 建立為 `new`；slots 人工模式建立為 `pending_confirmation`；slots 自動模式建立為 `confirmed`。
- `new/contacting` 可進入 contacting、pending_confirmation、confirmed、cancelled；pending_confirmation 與 confirmed 都必須已有有效時段配置，尚未選時段則保持 contacting。
- pending_confirmation 可確認、退回 contacting（釋放占位並清除 slot_id/hold_expires_at）、取消；confirmed 可完成、未到場、取消或改期。確認成功需清除 hold_expires_at，保留有效 slot_id。
- completed、cancelled、no_show 為結案，不可任意改回；需重新預約時建立新案並關聯舊案。
- 改期保留案件 id、增加歷程，舊時段釋放與新時段占位在同一交易完成；失敗保留原預約。
- 人工補登支援 phone、line、walk_in、external 來源，記錄建立人；不得憑外連點擊自動建預約。
- 預約可指派承辦人、記錄聯絡紀錄、內部備註、下次跟進時間；內部備註不進公開回應或通知。
- 清單支援日期、分校、狀態、來源、承辦人、稱呼／手機搜尋及分頁；接待日曆與清單讀同一資料來源。
- 匯出需獨立權限並記錄稽核，CSV 防公式注入；僅匯出已授權校區，不把個資放入普通 log。
- 不默默將案件搬到另一校。換校由原校結案、目的校另建案；跨校關聯須總管理者權限。

### 6.3 時段與容量（階段 D）

- 所有已確認參觀均綁定 `VisitSlot`。inquiry 由園方安排單次時段；slots 模式開放家長選擇規則產生的時段。
- 每校設定每週開放日、時間區間、每格長度、每格容量；以「家庭組數」計，每案占一組。參觀人數另存。
- 規則含最短提前時間、最遠開放天數、例外休假日及臨時封鎖。DB 儲存 UTC，營運時區 `Asia/Taipei`。
- 初始規則建議提前 24 小時、最遠 60 天、每格 30 分鐘、每格 1 組；正式啟用前由園方在後台確認。未確認不得自動開放公開 slots。
- 人工待確認的 slot 案件占位 24 小時，期限不得超過參觀開始。過期轉 cancelled、記錄 `hold_expired`，釋放名額並通知園方。
- new/contacting 不占名額；pending_confirmation/confirmed 占名額。completed/no_show 保留已使用名額，防止對歷史時段重新出售。
- 取消／退回 contacting 只釋放一次；重試不得造成負名額。
- 設定規則修改只影響未來未被使用的時段。已占位時段不可縮小到低於已占數；關閉時段停止新申請，既有案件另列待處理。
- 使用 PostgreSQL 交易鎖住時段列後檢查容量、建案、寫歷程與 outbox。改期按固定 slot id 順序鎖住兩個時段以降低死鎖。
- 公開可用時段只是當下資訊，提交仍重新判定。最後一格有兩人同時提交時，只能一人成功，另一人收到 `SLOT_FULL`。
- 背景過期工作及同時提交採同一鎖定規則；僅有前端按鈕 disabled 或 mock 測試不能證明不超收。

容量控制參考 [PostgreSQL Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)，實際以 PostgreSQL 併發整合測試驗證。

### 6.4 家長自行管理（階段 D）

- 在案件成功建立後，可提供不包含 PII 的安全管理連結；無登入系統，不開放以電話查詢任意案件。
- 使用高熵隨機 token，資料庫只存 hash、有期限、可撤銷；不得放進 analytics／access log，頁面 no-store、noindex、no-referrer。
- 開啟後只顯示該案必要資訊及遮罩手機；依後台設定期限允許取消或申請改期。預設截止為參觀前 24 小時。
- 自行改期提交是申請，原確認時段仍有效，不提前釋放；園方核准時原子換時段。自行取消成功才釋放。
- token 過期顯示園方聯絡方式；不得藉不存在／存在差異洩漏家長名單。

## 7. 帳號、權限、通知與統計

### 權限

| 角色 | 範圍 |
|---|---|
| 總管理者 | 全站、全部分校、帳號、發布、預約設定與案件 |
| 分校管理者 | 被授權校區內容、審核發布、預約設定、時段與案件 |
| 內容編輯 | 被授權校區／全站內容與素材，送審；不讀家長個資、不改預約方式 |
| 接待人員 | 被授權校區案件、聯絡紀錄、可用時段與日曆；不改官網、不管理帳號 |
| 唯讀 | 被授權內容與去識別統計；不自動擁有案件個資權限 |

**第一版（階段 B、C）只實作總管理者與分校管理者**；內容編輯、接待人員、唯讀三種角色屬階段 D。角色 enum 與 capability 檢查從一開始就設計成可擴充，但後台帳號畫面第一版只提供兩種選項。理由：五校幼兒園實際操作者多半是每校一位行政加總部一人，五角色加審核流程會多出約三成的後端與後台頁面卻無人使用。

- Role 與 campus membership 在伺服器檢查；涵蓋 list、detail、update、export、upload、preview、statistics、job。
- 全站內容編輯與個資匯出為明確授權 capability，預設不因擁有任一校 membership 而取得；只有總管理者可授予。管理端輸入不得自行升權。
- 本站是單一機構五校範圍隔離，不自建園務多租戶 mapping；未來若串接，需另訂 tenant 對應及 API 授權。
- 無公開註冊。第一位管理者以本機 CLI 安全互動建立，沒有預設密碼；密碼雜湊、登入限流、登出撤銷 session、停權立即失效。
- 使用 HttpOnly cookie session，production Secure、SameSite，寫入操作驗證 CSRF 與 Origin；不將管理者 token 存入 localStorage。
- 帳號新增、重設、停用及角色異動需稽核；不能停用最後一個有效總管理者。

CSRF 實作參考 [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)，不能把 SameSite 視為唯一防線。

### 通知

- 通知 outbox 與 worker 屬階段 D；階段 C 的送單交易仍必須寫 outbox 列（保證日後接上 worker 不改交易），但不啟動發送。
- 第一層是可持久化的後台站內通知，包含新案、改期、取消、即將參觀、逾期未處理及占位到期。
- 外部 Email 提供 adapter，開發使用捕捉信件的本機 sink；可配置後才啟用真實寄送。LINE／SMS 自動發送不在本輪供應商整合範圍，LINE 預約跳轉仍須實作。
- 建單與 outbox 在同一交易，commit 後由 worker 發送；網路失敗不回滾預約。
- 記錄 pending/sent/failed、重試次數、下次嘗試、最後錯誤碼；同一事件同一收件人去重，重試不重建案件。
- 通知內容使用當時必要資料，避免帶出內部備註；更動時段後尚未發送的提醒需重新判斷。

### 統計、SEO、資料維護

- 總覽：今日參觀、待聯絡、逾期跟進、待發布、缺少素材／聯絡設定及失敗通知。
- 事件區分 `booking_cta_clicked`、`contact_link_clicked`、`request_created`、`visit_confirmed`、`visit_completed`、`visit_cancelled`；後四者由伺服器案件事件產生。
- 依校區、日期、來源統計；點擊次數不等於預約數，不能宣稱追蹤到 LINE 內的成交。
- analytics 不記家長姓名、手機、問題文字或完整管理 URL；重送事件以 event id 去重。
- 管理各頁 title、description、分享圖片、robots；本輪輸出各校 SSR metadata、canonical、Open Graph 及 sitemap。開發／預覽預設 noindex，只有明確啟用正式索引設定才輸出可索引模式。
- 校區正式路徑、伺服器 404、舊 hash 相容納入本輪；新聞仍採 dialog，不增加文章頁或文章 sitemap，也不承諾搜尋排名。
- 個資保存期限可設定。預設保守不啟用自動刪除；上線前需完成政策設定。清理先 dry-run、匿名化已到期個資且保留不含 PII 的統計，外鍵不可破壞。
- 備份／還原包含 DB、素材、release manifest 與引用；在隔離環境做一次還原演練，不對真實環境操作。

## 8. 持久化模型與 API 契約

下列名稱為新設計，不表示 repo 已有這些模型。可調整內部檔案組織，但對外 enum、錯誤碼與語意需保持一致。

| 模型 | 主要欄位／關聯 |
|---|---|
| `Campus` | id、固定 key、名稱、active、sort_order；可編輯展示內容指向 content item |
| `AdminUser/Session/CampusMembership` | 帳號、密碼 hash、角色、明確 capability、作用校區、session hash／到期／撤銷 |
| `ContentItem/ContentRevision` | kind、scope、campus_ids、version、schema_version、typed payload、審核狀態／人／時間 |
| `SiteRelease/PublishJob` | 不可變內容 manifest、asset 引用、revision ids、發行人、時間、排程與執行結果 |
| `MediaAsset/MediaVariant/MediaUsage` | 儲存 key、格式／尺寸、scope、處理狀態、衍生檔、內容引用及版本 |
| `BookingConfig` | campus_id unique、mode、version、CTA、channel 設定、欄位設定、通知收件人、規則與同意 revision |
| `VisitRule/VisitException/VisitSlot` | campus_id、有效週期／例外、starts_at、ends_at、capacity、open、版本 |
| `VisitRequest` | UUID、campus_id、source、status、parent_name、phone、age、contact_time、questions、email、party_size、slot_id、hold_expires_at、config_version、consent、assignee、version |
| `VisitHistory/ContactLog/RescheduleRequest` | 案件、操作、異動前後、操作者、原因、跟進時間／申請新時段 |
| `IdempotencyRecord` | 公開提交 key hash unique、payload hash、request_id、必要回應；不得重放建立第二案 |
| `VisitAccessToken` | request_id、token hash、有效期、撤銷狀態 |
| `Notification/NotificationOutbox` | 事件、收件對象、通道、template、dedupe_key unique、狀態、重試 |
| `AuditEvent/AnalyticsEvent` | actor、action、scope、object、必要遮罩差異／去識別事件 |

`ContentItem.kind` 僅允許 site_settings、home、day_story、campus_profile、campus_tour、news、event、faq、legal_page；每種有獨立 Pydantic schema，不使用無限制 JSON 萬用表單。

API base：`/api/website/v1`。管理端 base：`/api/website/v1/admin`；所有管理端需登入與作用範圍驗證。

| API | 契約 |
|---|---|
| `GET /public/site` | 只回當前 release 與公開內容，含 schema_version/release_id；ETag |
| `GET /public/campuses/{key}/booking` | 即時公開模式、config_version、允許欄位、同意版本、公開聯絡方式；排除內部收件人 |
| `GET /public/campuses/{key}/slots?from=&to=` | 可申請時段，限制查詢區間；無個資 |
| `POST /public/analytics-events` | 只收允許的 CTA／聯絡點擊、event id、校區與入口代碼，限流與去重；不接受客戶端宣稱預約成立 |
| `POST /public/visit-requests` | Idempotency-Key；驗證校區、模式、版本、同意、容量，201 建立／200 重播 |
| `POST /public/visit-access/exchange` | 以管理 token 換短期受限 session；不得在 URL 查詢參數帶 token |
| `GET /public/my-visit` | 受限 session 下只回該案必要資訊 |
| `POST /public/my-visit/cancel`、`/reschedule-requests` | 遵守截止時間與狀態；CSRF/Origin 防護及限流 |
| `POST /admin/auth/login`、`POST /admin/auth/logout`、`GET /admin/auth/me` | Session／CSRF；登入失敗不區分帳號是否存在 |
| `/admin/users`、`/admin/campuses` | 帳號及五校管理；停用採明確 action |
| `/admin/content-items`、`/{id}/revisions` | typed 內容編輯、版本、作用範圍；version 衝突 409 |
| `/admin/content-items/{id}/submit-review`、`/approve`、`/reject` | 審核與原因 |
| `POST /admin/releases`、`GET /admin/releases`、`POST /admin/releases/{id}/restore` | 指定 revision 發布／還原，不帶入其他草稿 |
| `/admin/publish-jobs`、`GET /admin/preview` | 排程與授權預覽 |
| `/admin/media`、`/{id}/usages`、`/{id}/archive` | 上傳、搜尋、處理狀態、引用與封存 |
| `DELETE /admin/media/{id}` | 仍被引用時回 MEDIA_IN_USE；未引用可標記待清理，實體清理由背景工作執行 |
| `GET/PUT /admin/campuses/{key}/booking` | 校區設定與 version |
| `/admin/campuses/{key}/visit-rules`、`/visit-exceptions`、`/slots` | 週期、例外與人工單次時段 |
| `/admin/visit-requests`、`/{id}`、`/{id}/transitions`、`/{id}/reschedule`、`/{id}/contact-logs` | 案件、受控狀態機、原子改期、聯絡歷程 |
| `GET /admin/visit-calendar`、`/visit-requests/export` | 相同作用範圍與日期查詢；export 另需權限 |
| `/admin/notifications`、`/notification-outbox`、`/{id}/retry` | 站內通知、失敗發送及重試 |
| `GET /admin/dashboard`、`/analytics`、`/audit-events` | 去識別統計、作用範圍與稽核 |
| `/admin/site-policies`、`/retention-runs` | 通知／保存政策、清理 dry-run 與授權執行 |

錯誤統一為 `{error:{code,message,field_errors?,request_id}}`。業務碼：`BOOKING_CONFIG_CHANGED`、`BOOKING_UNAVAILABLE`、`SLOT_FULL`、`SLOT_CLOSED`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`MEDIA_IN_USE`、`MEDIA_NOT_READY`、`INVALID_TRANSITION`。未授權物件存取不洩漏其他校物件存在性。

例：公開需求 body：

```json
{
  "campus_key": "yihua",
  "config_version": 1,
  "parent_name": "測試家長",
  "phone": "0900000000",
  "age": "3-4",
  "contact_time": "weekday_afternoon",
  "questions": "",
  "party_size": 2,
  "consent_revision_id": "11111111-1111-4111-8111-111111111111",
  "consent_accepted": true
}
```

上述值只用於隔離測試；範例 consent id 必須由測試 fixture 建立，真實表單使用公開設定提供的有效 revision id。slot 模式再提供 slot_id。客戶端不能指定任意 status、assignee、capacity、source=admin 或其他校 scope。

## 9. Nuxt 官網遷移、渲染與預覽

### 9.1 元件與資料責任

- `web/app/` 採 Nuxt 4 目錄：`pages/`、`components/`、`composables/`、`utils/`、`plugins/`、`assets/`；Nuxt config、server routes 與 public 位於 `web/` 對應目錄。
- 元件至少包含 SiteHeader、HeroVideo、AboutSection、DayExperience、DayMomentCard、CampusBoard、CampusTour、NewsDialog、CampusFaq、VisitForm、SiteFooter。
- 先使用已盤點的內容 fixture 遷移首頁與一所分校並驗證，再完成其他頁及接 API；不先建一套 vanilla CMS adapter 再重寫。
- 保留現有 CSS token、class、版位、比例與必要 data attribute。可先搬現有樣式再拆分，不同時引入新 CSS 框架或重設計。
- 元件以 props 接內容、局部 state 管互動；`usePublishedSite()` 取得公開內容，`useCampusBooking()` 管即時校區設定／時段，`utils/booking-action.ts` 提供純函式 resolver。
- 原 app.js 不作為 Nuxt runtime 載入，不以 v-html 掛整頁，不在 Vue 管理的子樹用 innerHTML 全面重畫。
- header/footer 與 SEO 一併接入相同快照；不要遺漏目前寫在 index.html 的品牌與導覽。
- 開發 seed 從現有資料精準擷取、提供 dry-run；重跑不得覆寫後台已編輯內容。共用 fixture 存在 `content/site-fixture.json`，不形成第二套可編輯正式資料來源。

### 9.2 正式路徑與相容

| 路徑 | 行為 |
|---|---|
| `/` | 首頁，SSR |
| `/campuses/{key}` | 五校公開內頁，SSR；未知／停用校區回真正 404 |
| `/visit` | 選校與預約入口，noindex |
| `/visit/{key}` | 該校入口，依即時 mode 決定畫面，不因直接進網址繞過設定；noindex |
| `/visit/manage` | 家長受限案件管理，no-store/noindex；未授權不輸出個資 |
| `/preview` | 已登入管理者的草稿預覽殼，no-store/noindex；內容由授權 API 取得 |
| `/sitemap.xml`、`/robots.txt` | 根據正式 public origin、索引開關及已發布有效校區輸出 |

- 舊首頁 `/#/home` 轉 `/`；`/#/yihua` 等轉 `/campuses/yihua`；`/#/visit`、`/#/visit/yihua` 轉對應 `/visit` 路徑，保留白名單頁內區塊位置。
- fragment 不會送到伺服器，舊 hash 轉址在 client plugin 使用 replace 完成。只解析根路徑的 `#/` 格式，不攔截正常 `#about` 或家長管理頁的 `#token=...`。
- 測試直接開啟、重新整理、前進／後退與未知路徑 404；FastAPI 或內容服務失敗屬 503，不誤報為「校區不存在」。
- sitemap 只列首頁及可索引的已發布有效校區；排除 visit、preview、admin、草稿及尚無獨立網址的新聞／活動。
- canonical／分享網址由部署設定 `NUXT_PUBLIC_SITE_ORIGIN` 建立，不直接信任請求 Host；缺少正式 origin 時不得啟用 production 索引。

### 9.3 SSR、API 與更新一致性

Nuxt runtimeConfig 宣告與環境變數對應如下；啟動時嚴格驗證 enum、URL 與布林值，不把字串 `false` 當成 true：

| 環境變數 | runtimeConfig key | 規則 |
|---|---|---|
| `NUXT_WEBSITE_API_INTERNAL_BASE` | `websiteApiInternalBase` | 私有；live 模式必填，指向固定 FastAPI API base |
| `NUXT_WEBSITE_ENV` | `websiteEnv` | 私有；development/test/production，預設 production |
| `NUXT_PUBLIC_CONTENT_MODE` | `public.contentMode` | live/fixture，預設 live；production 禁止 fixture |
| `NUXT_PUBLIC_SITE_ORIGIN` | `public.siteOrigin` | 官網絕對 origin，不含路徑；啟用正式索引時必填 HTTPS |
| `NUXT_PUBLIC_INDEXING_ENABLED` | `public.indexingEnabled` | 預設 false；只在 production 可設 true |

- fixture 模式在瀏覽器換頁仍使用相同 fixture，並持續標示示範／禁止提交；不得因 hydration 或換頁意外轉成 live。這些模式只從部署設定取得，不接受 URL 參數切換。
- 首頁、校區介紹、地址、FAQ 與主要圖片的標記必須出現在原始 HTML；禁止整頁 ClientOnly 或全站 ssr:false。停用 JavaScript 時基本文字／照片仍可讀。
- 採 Nuxt useAsyncData/useFetch 的 SSR payload 機制；單次頁面載入只取得一份 release，hydrate 不重複讀同一份內容。站內換頁須明確重新取得當前 release，不能永久重用固定 key 的舊資料。
- 在 SSR request 範圍保存資料，不使用 module-global 狀態存訪客或草稿內容。公開 SSR 到 FastAPI 只讀 `/public/` DTO，不夾带登入 cookie、家長 token 或管理權限。
- `NUXT_WEBSITE_API_INTERNAL_BASE` 僅供 Nuxt server 呼叫固定 FastAPI 來源，不輸出到 public runtimeConfig；瀏覽器固定走同源 `/api/website/v1/`。
- 第一版採 Nuxt server build，不用全站 generate、SWR、ISR 或 prerender 的固定頁面取代 CMS 即時更新。日後選用快取須維持第 4 節的發布一致性。
- 公開 HTML／當前 release API 回應要求重新驗證（`Cache-Control: no-cache, max-age=0`），CDN 不覆蓋為共享長效快取；草稿、家長案件與受限 session 回 `private, no-store`。304 只可在目前 release 未改變時回傳。
- 預約方式、名額與提交採即時 API；server 對 config_version、idempotency 及容量仍是唯一判斷來源。
- `/preview` 可採 client-only 私有頁：先確認管理者 session，再讀 scoped preview API，避免 SSR 輸出草稿與誤入共享快取。這是私有頁例外，不可擴大到首頁／校區。
- client 401/409/429/網路錯誤與快速切校均有明確行為；過期請求不得覆蓋新校區畫面。

### 9.4 動畫與 hydration

- SSR 先輸出穩定的文案、圖片、poster 與版位，不在 setup 階段讀 window、document、localStorage 或 viewport 決定不同 DOM。
- 影片播放、760px 媒體切換、observer、timer 與 scroll handler 放到 onMounted；onUnmounted 釋放。保持 reduced-motion、離開暫停、焦點返回與鍵盤操作。
- 動畫隱藏狀態在成功掛載後才啟用，避免停用 JS 時文字與照片永久透明。翻面卡的內容也需有可讀替代呈現。
- 保留原 CSS 動畫及 native dialog；不得僅為遷移引入大型動畫套件，也不以忽略 hydration 警告作為修復。
- 除元件／路由測試外，加上直接載入、換頁後重新進入、影片不重複播放、事件不重複註冊與無 hydration mismatch 驗收。

### 9.5 預覽與正式建置

- 遷移前用原 `package_preview.py` 保存 `preview.html` 到忽略版控的 `artifacts/prototype-baseline/`，記錄 checksum。保留離線可開、單份較小 day 影片、無真實提交的原型特性。
- **原型凍結點**：階段 A 閘門通過的 commit 之後，根目錄 `index.html`、`app.js`、`styles.css`、`studio.css` 與 `package_preview.py` 不再修改；所有設計迭代改在 `web/`。凍結前尚未拍板的預覽參數（`?pill=`、`?autohide=`、`?anni=`、`?seam=`）由使用者決定定案或移進 `design/`，agent 不自行清理。
- 給園方看新版需要可開的網址；單檔 `preview.html` 分享方式在凍結後只代表原型。staging 主機為使用者的部署決策，agent 只交付部署配方。
- 原 root HTML/JS/CSS 與打包器保留作設計來源，本輪不把它們接成第二套正式 CMS 官網；不要每次 Nuxt 發布都回寫舊原型。
- 新版正式預覽使用 `web` 的 dev 或 build/start 服務，以及需登入的 `/preview`。範例資料模式與真實已發布模式必須明確可辨，fixture 模式不能提交預約。
- 本輪不要求將 Nuxt chunks 重新壓成單一 HTML；舊快照也不宣稱反映後續 CMS 更新。驗收要分開記錄「原型快照可離線開啟」與「新版 Nuxt 預覽可用」。
- 部署配方記錄 Nuxt Node server、Vite admin 靜態檔、FastAPI 與 worker 啟動；Nuxt `.output/server` 只用於執行，不當成靜態檔案服務。
- API 生成型別放共用 contracts，web/admin 同步檢查 drift、typecheck、build。不得混入管理端元件、私有設定或草稿至公開 bundle。

實作依 Nuxt 官方 [渲染模式](https://nuxt.com/docs/4.x/guide/concepts/rendering) 與 [hydration](https://nuxt.com/docs/4.x/guide/best-practices/hydration) 文件；本節指定採 SSR 的交付模式，不要求 Claude 再做框架選型。

## 10. 驗收與完成定義

完整驗收對照實作計畫的 A01–A25，並依階段分別驗收；每階段報告只宣稱該階段項目。必要結果：

1. 園方可更新所有現有內容版位、影片、素材及熱點；未發布不出現在官網。
2. 五校可獨立切換六種預約模式；每一入口一致，缺值不可啟用，舊案保留。
3. 站內送出可持久化、可追蹤、可安全重試；並發最後一格不超收。
4. 分校權限、草稿、素材、匯出及通知收件人均不跨校洩漏。
5. 管理者可處理案件、時段、改期、取消、通知、統計及發布還原。
6. Nuxt 桌機與手機官網仍保持目前設計；原型單檔快照可離線開啟，新版服務預覽與授權草稿預覽另行驗收。
7. 能用文件中的命令啟動與驗證；OpenAPI、前端型別、migration、測試及操作文件齊全。
8. 報告分列：已通過、未通過、未執行、外部設定待補。不把測試假資料、mock 通知或本機成功稱為正式上線完成。
9. 正式路徑、舊 hash 相容、SSR HTML／metadata、404、CMS 發布新鮮度、無 hydration 錯誤及私有內容隔離均通過。

本輪不包括：部署、真實資料庫 migration、真實通知驗收、園務招生／學費／員工整合、活動報名付款、任意頁面建構器、360 導覽、週年提案或官網重設計。
