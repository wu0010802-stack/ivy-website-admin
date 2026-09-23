## 2026-09-23 官網報名修復已部署

報名設定失敗重試、全形連字號手機，以及家長管理頁已部署至[正式官網](https://web-production-04caa.up.railway.app/)。API 與 web 均 SUCCESS；版本 `20800ce32b86`。以最新正式 `f023bd0` 為基底，只套入本次修復，保留已部署設計與錯誤頁修正。

隔離快照 180 backend／140 web／48 admin 測試、型別、契約與正式建置通過；線上 36 項公開檢查與 Chrome 15 項 1440／390／320px 操作檢查通過，無 runtime／hydration error 或水平溢出。未建立正式測試報名、未 migration／CMS 發布／commit／push。詳見 `deploy/README.md` 與 `output/railway-visit-repair-20260923-145157/`。

## 2026-09-23 官網報名手測修復與家長管理頁

修正預約設定 API 失敗被顯示為「暫停預約」：改為錯誤提示、重新載入與聯絡園所入口；手機正規化支援全形／Unicode 連字號。新增 `/visit/manage`，提供遮罩手機與狀態查詢、改期申請、二次確認取消、失效連結處理。改期待核准時原時段保留，重新整理仍顯示待確認；同頁切換連結會清掉舊畫面與請求，失效連結不沿用上一筆 session。

管理頁使用 fragment 交換 HttpOnly cookie，移除網址 token，不把個案資料放進 SSR payload；補上 no-store／noindex／no-referrer、正式環境 Secure cookie、來源檢查與限流。預設參觀前 24 小時截止由 API 執行，並回傳可操作狀態；OpenAPI／前端型別同步，無 migration。

驗證：backend 真 PostgreSQL 180 項、web 141 項單元測試、Node 22 型別與契約檢查通過；Chrome 實際表單送出／管理連結／改期／取消／錯誤重試／截止時間與 1440／390／320px 驗證通過，無 page error 或水平溢出。證據 `output/playwright/visit-repair-20260923/REPORT.md`；臨時 API 與專用手測 DB 已清理，未發通知。`node --check app.js`、原型重新打包通過，`preview.html` 無差異。未部署、未提交；Safari／iOS 實機未驗證。

## 2026-09-23 拍立得翻面暗示：B「捲動飄角」

使用者從 `design/flip-hint-subtle-20260923/` 三版（A 對光透字／B 捲動飄角／C 包邊貼紙）選 B，已接進 Nuxt `web/`。紙膠帶只黏上緣，捲動時右下折角隨速度掀起（32→最多 52px）、整張微擺 ≤0.7°，停下回彈一次收回；只回應使用者的捲動，不自動播放，減少動態不做。新增 `web/app/utils/earGust.ts`（共用一個 scroll 監聽與 rAF 時鐘）與 11 項單元測試；`DayMomentCard.vue` 折角改為「基準＋捲動疊加」單一出口，`.print-card` 傾角改走 `--card-tilt`。

驗證：web 21 檔 152 項單元測試、Node 22 `nuxt typecheck` 0 錯誤（以故意錯誤檔確認有抓錯）；Chrome（M2 Metal）桌機 WebGL 折角掀到 47.6px、停下回 32px／擺動歸零，畫面外卡片不動，p95 幀時間 16.8ms 與無拍立得區段相同；手機 390px 掀到 55px 後收回、無水平溢出；減少動態不動；無 console 錯誤。證據 `output/playwright/ear-gust-20260923/`，快照 `versions/before-ear-gust-20260923-143901/`（本機）。未部署；Safari／iOS 實機未驗證。

## 2026-09-23 關於常春藤改為單張圓角照片

依使用者截圖，Nuxt 首頁「關於常春藤」原本的主照＋小照疊放改為單張照片，框型比照參考圖：3:2、16px 圓角、無米白框也無陰影（與 `.studio-intro-photo` 同規格）。圖說移到照片下方靠右。`sizes` 改為 `(max-width: 900px) 90vw, 42vw`。凍結原型 `app.js` 未動。

同日依使用者提供的新照片（2000×803 寬幅，長輩被孩子們圍住大笑）換掉 `about-curious`：從 x=30 裁成 3:2 母檔 `web/public/assets/about-together.webp`（1204×803，WebP q90），左側大笑的男孩完整入鏡，長輩視線朝向右側孩子；以 `scripts/optimize-site-images.py --only about-together` 產生 160／480／800／1200 衍生檔與 manifest。fixture 只留這一張（後台不編輯照片；`about-curious`、`learning` 素材保留，`learning` 仍用於消息卡）。alt 只描述畫面，不寫人物身分。

1440／1024／390 截圖與量測：照片 1 張、圓角 16px、無邊框與陰影、1440 與 390 載入 800w、無水平溢出、無 runtime error；手機照片先離開，才接「關於／常春藤」大字。`vitest run` 18 檔 120 項通過，`nuxt typecheck`（Node 22）無錯誤。快照 `versions/before-about-single-photo-20260923-135156/`，證據 `output/playwright/about-single-photo-20260923/`。部署紀錄見 `deploy/README.md`。

## 2026-09-23 官網後台第四輪 UX：追蹤到期有入口、案件一筆接一筆、發布前看差異

對 `admin/` 做 impeccable critique（LLM 審查＋自動偵測，25/40，不是 AI slop），依業主選「預約流程優先、全部處理、回上一版先做前端差異預覽」實作：

- **到期待追蹤**：總覽數字原本連到未篩選列表，且沒有任何地方能設定「預定聯絡時間」。後端 `GET /admin/visit-requests` 新增 `follow_up_due=true`（與總覽同定義）與 `order=newest|oldest`；案件詳情的聯絡紀錄旁加「下次聯絡」日期一起送出；列表加「只看到期待追蹤」與排序，頁首與列表用金色標出已到期。
- **櫃台動線**：詳情頁加「下一筆待處理（還有 N 件）」；確認預約後把「已致電家長，告知參觀時間 …」預填進紀錄框並聚焦；桌機列表電話改可撥；孩子姓名併入家長欄減成 7 欄；「取消預約」移到面板底部分隔。
- **發布安全網**：發布確認框列出「欄位：之前 → 之後」（`ContentEditor` 用 `useContentItem` 的 `changes`），成功 toast 附「查看官網」連結（依 kind／校區導到對應頁）；底部動作列不再複述狀態。回到上一版仍需後端保留已發布版本內容，未做。
- **文案**：「時段預約（尚未開放）」改「家長自選場次」（09-22 已改為校方可設定）；「首頁首屏文字」改「首頁大圖標語」並提示字型子集；「替代文字」統一為「圖片說明」；取消鈕統一「先不要」；「原填年齡」「小標（eyebrow）」「標題樣板」「目前為第 N 版」清掉；改期核准／退回加確認框；新增使用者加「產生密碼」；登入頁忘記密碼說法對齊實際流程。

驗證：`admin` typecheck 無錯、vitest 48 項（新增 `followUpUx.test.ts` 6 項）；backend pytest 172 項（新增到期篩選與排序測試）；契約 `contracts/` 已重生。真後端（8010）＋Vite（5175）以臨時帳號與示範案件跑 Playwright 1440／390px，截圖 `output/playwright/admin-ux-round4/`，無 console error、無溢出，示範資料已清。快照 `versions/before-admin-ux-round4-20260923-134519/`。未部署、未提交。

## 2026-09-23 字體審查 B 批：明體統一、標點、字級尺度

使用者看過對照頁 `design/typography-b-20260923/index.html` 後決定四項都做（細項照對照頁建議）。只改 `web/`，凍結原型不回寫；規則寫進 DESIGN.md「字體審查 B 批」。

- **B-1 預約頁大標**：改用自託管思源宋體，新增 9 字子集 `noto-serif-tc-500-visit.woff`（3.9 KB）。`Ivy Campus Serif` 的 `@font-face` 從 `CampusBoard.vue` 移到 `typography.css` 全站宣告，Windows 不再落到新細明體。
- **B-2 分校頁校名**：由 LINE Seed 800 改為明體 500，和首頁分校資訊共用 `--fs-campus-name`（63.36／54／50px），刪掉 `styles.css` 裡已失效的 `.hero h1`／`.campus-hero h1` 字級規則；分校頁校名不再用到 ExtraBold。
- **B-3 標點與斷行**：標題 `text-spacing-trim:trim-start` 收行首開括號（逗號句號維持全形），WebGL 拍立得照字型 halt 數值同步；分校頁區塊標題只在標點後換行；拍立得背面 canvas 換行補上禁則，修掉「。」「？」單獨一行。
- **B-4 字級 token**：`typography.css` 定義 `--fs-xs`～`--fs-8xl` 12 階，約 320 處字面值改用 token；頁首／選單／品牌（園方規格）、活動日期、校名、流體字級、英文裝飾小字保留原值。表單「必填／選填」、預約頁地區／地址等 10–11px 中文一併拉到 12px。

快照 `versions/before-typography-b-20260923-122514/`，證據 `output/playwright/typography-b-20260923/`。未部署。

驗證（Nuxt dev fixture 模式，另以 Playwright 攔截預約設定 API 顯示表單）：首頁、消息列表對話框、分校頁、預約頁暫停／選校／表單六種狀態 × 1440／1024／768／390／320px，改前改後逐元素比對，沒有新的溢出或橫向捲動；多換一行的 14 處都是段落自然重排。拍立得四種寬度翻面，背面文字都在紙面內；WebGL 與 DOM 的行首括號像素位置一致。CDP 確認三處明體實際使用自託管字型。Node 22 `vitest` 119 項通過、`nuxt typecheck` 無錯誤。Safari／iOS／Windows 實機未驗證。

## 2026-09-23 字體審查 A 批：字型變數與 12px 小字底線

依字體審查結果，修正不改設計決策的部分（只動 `web/`，凍結原型不回寫）：

- `studio.css` 引用了沒定義的 `var(--font-en)`，選單／膠囊的英文、編號和電話都退回 PingFang；開場「略過動畫」引用的 `var(--font-body)` 也不存在，退回通用 sans-serif。已在 `typography.css` 的 `:root` 補上兩個 token，前者指向 Source Sans 3，後者指向系統黑體。
- 低於 12px 的中文字一律提高到 12px（DESIGN.md 2026-09-10 可讀性底線）：拍立得「01 / 早安入園」（桌機原 10px）、理念照片說明（桌機 11px／手機 10px）、影片說明與「播放背景」、手機日常提案註記、分校頁「到園時，還可以聊聊」「這張照片裡」、預約頁照片說明。9px 的英文裝飾標語不變。
- 消息卡標題改為 `balance`＋`keep-all`，只在「，」後換行（原本會剩下「形狀。」「空間。」兩字一行），太長時由 `overflow-wrap:anywhere` 兜底。
- 「近期活動」原本比「最新消息」高 9px，兩欄標題現在都貼齊標題區底部。

快照 `versions/before-typography-a-20260923-114102/`，證據 `output/playwright/typography-a-20260923/`。未部署。

驗證在這個 worktree 起 Nuxt dev（fixture 模式）：首頁、義華分校頁、預約頁在 1440／390px 下都沒有小於 12px 的中文字。CDP 查到選單英文、編號與電話實際使用 Source Sans 3；兩欄標題 1440／1024px 的 top 值相同；拍立得 WebGL 紙面桌機與手機截圖正常。`tests/print-flip.spec.ts` 10 項通過。Safari／iOS／Windows 實機未驗證。

## 2026-09-23 膠卷縮成中央橫框，321 光學置中

依要求取消電腦版滿版膠卷，改為中央 16:9 橫框，四周露出紅布幕，最大寬度 880px 且依容器尺寸縮放。校徽與倒數圓圈仍共用中心與高度。框內移除向上偏移；3、2、1 的橫向依實際墨色重心校正、垂直依可見字形置中，修正「1」直筆偏右的視覺感。手機版與完整 7.9 秒流程維持原樣。

[重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[本機首頁](http://127.0.0.1:3136/)。快照 `versions/before-film-panel-20260923-111907/`，證據 `output/playwright/film-panel-20260923/`。未部署、未提交。

## 2026-09-23 首屏按鈕 ?cta= 比稿（否決，已移除）

「看看孩子的一天」白框幽靈鈕試了三個 `?cta=` 方向：a 霧面深綠膠囊、b 米白實心＋黃色圓形箭頭、c 圓形箭頭加底線文字。使用者看過後決定都不用，維持現行白框按鈕；`web/app/components/HeroVideo.vue` 已還原為提交版本（`git diff` 無差異），否決紀錄寫進 DESIGN.md。截圖保留在 `output/hero-cta-20260923/` 供追溯。

## 2026-09-23 電腦版改為參考圖的復古膠卷

電腦版（>900px）倒數依使用者截圖改成米褐色底、深褐大數字與單圈粗圓框，加上兩側齒孔、十字線、旋轉掃針與細緻底片磨損。先校徽、再完整 321、最後紅布幕拉開的 7.9 秒流程不變；900px 以下保留上一版的暖金布面投影。

[可重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[實際 Nuxt 首頁](http://127.0.0.1:3136/)。新膠卷用 Three.js 平面呈現並隨開幕退場；修正獨立預覽打包器只替換第一個 Three.js import 的問題。快照 `versions/before-desktop-film-20260923-094848/`，證據 `output/playwright/desktop-film-20260923/`。本機修改，未部署、未提交。

## 2026-09-23 Hero 活動鏡頭卡頓修正

[修正版獨立預覽](http://127.0.0.1:3147/)：Chrome 1440／390／320px 各連播 14 秒，皆為 0 掉幀、無超過 90ms 的影格呈現間隔，循環與暫停／恢復正常，無 runtime error。這是本機 Chrome 與手機模擬量測；Safari／iOS 實機未驗證。

第 5 鏡戶外遊戲與第 7 鏡跳躍原本用重複影格維持半速，封裝雖為 30fps，動作實際只有 15fps。這兩段改回原片自然速度、真實 30fps，其餘五段維持既有平順半速；七段鏡頭與 1080×800 畫質保留，總長由 11.7 秒縮短至 9.833333 秒。從園方原片重新產製，各自由無損中間檔壓縮一次，桌機 CRF 18／5.67 MB、手機 CRF 21／3.98 MB。

逐鏡相鄰影格檢查中，第 5／7 鏡的 36／22 組近重複影格皆消除；兩份新影片七鏡均為零近重複影格（108×80 灰階 MAE ≤0.35 門檻）。Typecheck、119 項單元測試、原型語法／重打包通過，`preview.html` hash 不變。產製方式見 `design/hero-video-smooth-20260923/README.md`，量測證據在 `output/hero-smooth-20260923/`；修改前快照 `versions/before-hero-smooth-20260923-094446/`。本機修改，未部署、未提交。

## 2026-09-23 Hero 小標拿掉「高雄五校」，修正首頁按鈕與頁尾連結無效

Nuxt 首頁 hero 小標改為「常春藤幼兒園」，`web/server/data/site-fixture.json` 與後端初始化用的 `content/site-fixture.json` 同步修改；vanilla 原型已凍結，未更動。正式站小標由後台 CMS 決定，需要到後台「首頁主視覺」修改後再發布。

另修正沿用原型 hash 路由的連結：「看看孩子的一天」原本是 `#/home/life`，頁尾五個連結也是 `#/home/*`、`#/visit`。`legacy-hash` 外掛只在載入時轉址，點擊後網址會改變但頁面不捲動；從分校頁點擊也不會回到首頁。現在改為 `/#life`、`/#about`、`/#campuses`、`/#latest-news`、`/visit`。這些連結不經 CMS，部署後正式站就會生效。

Chrome 1440×900 與 390×844 實測：hero 按鈕會落在「孩子的一天」區塊；從 `/campuses/yihua` 點頁尾四個連結都能到達目標區塊或頁面。Node 22 下 content／public-copy／legacy-hash／seo 四檔共 30 項測試通過。本機修改，未部署、未提交。

Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。實際首頁 1440／901／390px 的校徽→321→拉幕、工作階段一次、無水平溢出與倒數中略過／WebGL context loss／減少動態驗證通過，無 runtime／shader error。320／390／900px 各五個關鍵影格與前版像素完全一致；1440→390→1440 切換正確，尾段透明及資源釋放正常。原型語法、重打包與 diff 檢查通過，preview.html 雜湊不變。建置保留既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 校徽先行，接同位置的復古電影倒數

依最新要求，先投影校徽 1.5 秒，再由相同中心與高度的電影倒數圓盤接替，3、2、1 各一秒，最後 3.4 秒拉幕。倒數採暖金雙圓環、順時針掃針、深酒紅大數字與細緻底片顆粒；原始校徽、酒紅絨布及布面投影保留。總長 7.9 秒，取代先前校徽與小倒數同時出現的版本。

[可重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[本輪實際 Nuxt 首頁](http://127.0.0.1:3136/)。獨立建置位於 `output/film-build/`，避免覆蓋其他 session 的 `.output` 服務。修改前快照 `versions/before-film-countdown-20260923-094014/`，瀏覽器證據 `output/playwright/film-countdown-20260923/`。本機修改，未部署、未提交。

Node 22 型別檢查、119 項單元測試及獨立 Nuxt build 通過。Chrome／Apple M2 的 1440×900、768×1024、390×844、320×568 共 30 組播放／備援檢查通過，無 runtime／hydration／shader error；包含校徽先行、逐秒倒數、完整拉幕、各階段略過、同工作階段不重播，以及載入失敗放行。實際布面投影外框高度差低於 1%，圓盤與校徽共用投影中心（不同輪廓受布褶扭曲後，像素外框中心差 0.5–4.5px）。原始 PNG 雜湊相同，原型語法／重打包／diff 檢查通過，preview.html 雜湊不變。建置仍有既有 CSS calc/clamp 解析及 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 常春藤的一天照片畫質提升

Nuxt 五張影片截圖重新取自園方原始影片的同一秒數，從 810×600 回復為原生 1080×800，保留相同鏡頭、裁切與色彩；WebP 母圖 quality 94、響應式衍生圖 quality 92。完整尺寸也使用內容雜湊網址，避免回訪者沿用舊照片快取。五張完整圖片合計約 453 KiB（原本 161 KiB），沿用 lazy loading。`sizes` 納入橫圖裁成方形時的像素需求；WebGL 紙面、顯示 Canvas 與共用 renderer 支援至 3× DPR，照片縮圖在支援的瀏覽器使用高品質平滑取樣。

第六張教室照片保留既有 960×600；來源網站回傳 HTTP 500，尚無可確認的更大原圖。原片本身的失焦與運動模糊仍受來源限制，未重繪人物或場景。

重製：`python3 scripts/restore-day-photos.py '/path/to/常春藤廣告+配音.mp4'`，接著 `python3 scripts/optimize-site-images.py --only day-hello day-discover day-lunch day-outside day-home`。腳本核對來源 SHA-256，僅更新 Nuxt 素材。前後瀏覽器證據：`output/playwright/day-photo-quality-20260923/`；快照：`versions/before-day-photo-quality-20260923-093544/`。本次僅本機修改，未部署、未提交。

Node 22 typecheck、18 檔共 119 項單元測試通過。Chrome 桌機 1440px／2× 與手機 390px／3× 的 12 組 WebGL 照片載入、像素密度、翻面往返通過；320px 無 WebGL 與 390px 減少動態的 12 組 CSS 備援通過，無水平溢出或 runtime error。五張新圖均更接近原始影格（PSNR 43.2–44.4 dB，舊圖放大後為 38.0–39.8 dB；僅為來源保存比較）。原型語法、重打包與 diff 檢查通過，`preview.html` 無差異；Safari／iOS 實機尚未驗證。

已依使用者要求送出正式 web 部署，但截至 2026-09-23 10:11（台灣），Railway `28ce210a-4ad8-4be1-92ea-689da4348224` 仍停在 `INITIALIZING` 超過 15 分鐘；**照片清晰版尚未上線**。最終快照 `6b82fc18…` 的 102 項 web／42 項 admin 測試、前後台建置及本機 24 組瀏覽器檢查通過。正式站仍提供原版本，API／Postgres 正常；詳見[部署等待紀錄](deploy/README.md)。

## 2026-09-23 Hero 播放畫質提升

Nuxt 首頁桌機改用現有 1080×800、CRF 18 修復母帶（4.17 → 5.95 MB）；手機從 720×534、CRF 22 提升為 1080×800、CRF 21（2.05 → 4.17 MB），改善高密度螢幕裁切放大後的細節。素材直接複製、更新雜湊網址，避免再次轉碼；鏡頭、色調、速度、封面與版面維持原樣，減少動態／省流量／慢速連線仍不下載影片。原片失焦與運動模糊仍受來源限制。

修復前後的瀏覽器證據放在 `output/hero-quality-20260923/`。本次僅本機修改，未部署、未提交。

Node 22 typecheck 與 117 項單元測試通過；Chrome 1440／390／320px 確認實際載入新影片、暫停／恢復與完整循環正常，無水平溢出或 runtime error。減少動態／省流量／3G 三種情境皆不請求 Hero MP4。兩份輸出與來源逐位元相同，1080×800、351 幀、11.7 秒、faststart 與完整解碼通過。`node --check app.js`、原型重打包及 diff 檢查通過，`preview.html` hash 不變；Safari／iOS 實機未驗證。

## 2026-09-23 開場動態與陰影渲染優化

沿用酒紅與柔金的既有構圖，拉幕改成起步與收尾更平滑的五次緩動，下襬稍後跟上、布料擺動放慢。完整 3 秒倒數後，最後的「1」用 180ms 退光，接續校徽退光與 3.4 秒對開。預覽重播立即回首格，開幕完成就隱藏略過鈕。另修正尾段殘留約 18% 陰影造成的亮度跳動，讓陰影在移除動畫前就完全退去；預覽背景更新為本輪實際首頁截圖。

倒數期間重用靜止布面的 VSM 陰影；拉幕、拖曳與尺寸改變時重新計算。同一閉幕拖曳操作的繪圖呼叫數從 24 降至 10（兩次渲染合計，約減少 58%），拖回閉幕並恢復視窗尺寸後的 canvas 截圖完全一致；此為繪製呼叫數量測，不代表等幅 FPS／電量改善。

證據在 `output/playwright/entrance-motion-20260923/`，修改前快照 `versions/before-entrance-motion-20260923-092615/`。原校徽、倒數總時長與本機首頁版面保留；未部署、未提交。

## 2026-09-23 手機關於背景與轉場修正

加長 Nuxt 首頁手機介紹照片後方的綠色背景，讓「關於／常春藤」大字完整露出後再接到日常影片；390×844 下增加約 246px，轉場前照片與大字保留約 40px 空間。沿用原先較短的擦除距離與雙照片構圖，修正 320px 大字裁切、水平對位及副標斷行；手機浮水印恢復既定 .28 透明度。減少動態／無 JS 不增加轉場留白。

前後截圖與驗證記錄：`output/playwright/about-mobile-20260923/`；快照：`versions/before-about-mobile-20260923-092601/`。本次只修改 Nuxt CSS 與紀錄，未提交。

已部署至[正式官網](https://web-production-04caa.up.railway.app/)：web deployment `2bb67300-f755-4ef7-8787-ac02a14ef4a4` SUCCESS，release `8a3dd98d…`。以最新正式 `9813f34`／`14952c0e…` 為基底，只套入本輪 CSS；API／Postgres 部署維持原版。隔離建置通過 typecheck、92 web／42 admin tests 及前後台 build；正式站 42 項公開檢查、八尺寸 24 組版面／互動檢查通過，13 段內嵌 CSS 與建置 hash 相符。證據：`output/railway-about-mobile-20260923-093354/`，詳見[部署紀錄](deploy/README.md)。

Node 22 `npm run typecheck`、116 項單元測試、原型語法／重打包及 diff 檢查通過；`preview.html` SHA-256 不變。Chrome 八尺寸、24 組檢查涵蓋介紹展開收合、轉場正反向捲動、200% 文字放大、手機橫直旋轉、網址列高度變動、減少動態與無 JS；無水平溢出，動態頁面無 runtime error。900px 以下單欄照片與大字至少保留約 40px 間距，1440px 幾何與修改前相同。Safari／iOS 實機尚未驗證。

## 2026-09-23 孩子的一天拍立得翻面改得更自然

依使用者要求讓翻面更自然（僅 Nuxt `web/`，凍結原型不動）。翻面改為永遠右緣掀起往左翻，與右下折角、首張偷看同方向，翻到一半再點原路翻回；節奏改為 0.95 秒、點下即起步的曲線；紙改成單側懸臂微彎、停下輕輕回彈，抬升時下緣先起、影子變淡變散；紙膠帶畫進紙面跟著翻，不再停在原地。同時修掉兩個舊 bug：WebGL 紙量到旋轉後外框而大約 5% 且偏右下、翻到一半穿過接影子地板而出現假摺痕。鍵盤焦點框翻面途中先淡掉。規則見 DESIGN.md「翻面手感改得更自然」。

Node 22 typecheck 0 錯誤、單元測試 115 項通過（新增 `web/tests/print-flip.spec.ts`）；Chrome＋SwiftShader 以假時鐘逐格驗證桌機／390px 手機的 WebGL 版與停用 WebGL 的 CSS 版：翻過去、翻回、途中反轉、偷看中點擊、鍵盤焦點框、懸停，靜止後 WebGL 紙與 DOM 差異只剩 1px 邊緣。前後對照在 `output/playwright/flip-natural-20260923/`。未跑 `nuxt build`（另一個 session 的 server 正在使用 `web/.output`）；實機 GPU、Safari／iOS 未驗證。

Node 22 typecheck、117 項單元測試與最終 Nuxt build 通過。29 組進站／備援檢查通過；尾段陰影修正後，另以 1440×900、390×844、320×568 實際首頁逐秒倒數、完整開幕、重新整理不重播，以及預覽尾段透明度／重播重新確認，均無 runtime／hydration／shader error。中央 canvas alpha 實測由原先固定 46/255，改為 23→1→0；原型語法與重打包通過，preview.html hash 不變。既有拍立得變更及執行中並行修改的 studio.css 保留。Safari／iOS 實機未驗證。

## 2026-09-23 布幕協調性精修

依使用者要求繼續檢視協調性，A 版改為較沉穩的酒紅、寬厚布褶與柔和暖金光。校徽桌機約縮小 9%、手機約 16%，與倒數組成光學置中的一組；倒數改圓潤粗體並拉近校徽，金邊與略過按鈕降低視覺重量。投影改平滑淡入、提早退光，完整 3 秒倒數及 3.4 秒左右開幕保留。

新增[精修前後比較](design/entrance-curtain-a-velvet-20260922/harmony/index.html)，使用前後兩版實際 Nuxt 首頁的桌機／手機截圖；[動畫預覽](design/entrance-curtain-a-velvet-20260922/README.md)和首頁共用引擎。備份在 `versions/before-entrance-harmony-20260923-081253/`，本輪證據在 `output/playwright/entrance-harmony-20260923/`。未部署或提交。

Node 22 typecheck、105 項單元測試、Nuxt build 通過；Chrome／Apple M2 在 1440×900、768×1024、390×844、320×568 的逐秒倒數／開幕及各項備援共 29 組檢查通過，無 runtime／hydration／shader error。原型語法及重打包通過，preview.html hash 不變；五個其他未提交產品檔案 hash 保持一致。Safari／iOS 實機尚未驗證。

## 2026-09-23 A 布幕加入 30 週年校徽投影與 3、2、1 倒數

依使用者提供的週年圖，將校徽轉為暖金投影，直接照在變形後的紅絨布面；保留原圖人物、皇冠、緞帶與字樣，光線隨凹凸產生明暗。圖檔原樣複製，無白底矩形。數字同樣以光投射，完整倒數三秒後再接 3.4 秒左右開幕，總計 6.4 秒；開幕時投影退光，載入時間不壓縮倒數。手機依畫面比例縮放，保留全部校徽和數字。

已整合本機 Nuxt 首頁及[可重播預覽](design/entrance-curtain-a-velvet-20260922/README.md)。Node 22 typecheck、105 項單元測試及 Nuxt build 通過；Chrome／Apple M2 在 1440／390／320px 的逐秒倒數、開幕、略過、無溢出、同工作階段不重播、減少動態與圖檔／模組失敗等 27 組檢查通過，無 runtime／hydration／shader error。證據：`output/playwright/entrance-projection-20260923/`。備份：`versions/before-entrance-projection-20260923-080318/`。

原型語法／重打包通過，`preview.html` hash 不變；五個其他未提交產品檔案 hash 保持一致。此輪未部署、未提交；Safari／iOS 實機尚未驗證。

## 2026-09-22 首次進站採 A 並升級紅絨布質感

依使用者「走 A、質感更高更逼真」，Nuxt 首頁加入一次性的左右開幕。布料使用不規則立體垂褶、纖維 bump、MeshPhysicalMaterial 絨面反光、VSM 自身陰影與下襬滯後，預設 3.4 秒。略過／Escape、減少動態、資料節省、慢網路、首次載入逾時及 WebGL 失敗都能直接回到內容；完成即移除 dialog 並釋放圖形資源。

可重播並對照原版的[材質預覽](design/entrance-curtain-a-velvet-20260922/README.md)與實際首頁共用引擎。Node 22 typecheck、102 項單元測試與 Nuxt build 通過；瀏覽器證據在 `output/playwright/entrance-curtain-a-20260922/`。沿用使用者未提交的首頁設計；凍結原型重打包內容不變。未部署或提交，Safari／iOS 實機未驗證。

Chrome 使用 Apple M2／ANGLE Metal，20 組實際首頁／備援檢查通過，無 runtime／hydration error；1440／390／320px 最終材質、拖曳、重播與無溢出另行通過。手機摺痕密度與深度隨視窗比例降低，保留寬厚的布褶。Nuxt `build:manifest` 關閉入口引擎本體的 SSR prefetch，已看過與減少動態時不下載該模組；其他區塊原有 Three.js 載入策略保留。

## 2026-09-22 首次進站紅布幕 Three.js 三案 mock-up

新增獨立比較頁 [`design/entrance-curtain-three-20260922/`](design/entrance-curtain-three-20260922/README.md)：A 經典左右對開（3.2 秒）、B 波浪劇院升幕（3.0 秒）、C 柔弧向兩角攬幕（3.6 秒）。使用現有 Three.js 做立體布面形變、摺痕光線與金邊，提供重播、暫停、進度拖曳、略過及滿版預覽。背景沿用今日 Nuxt 首頁桌機／手機靜態截圖；此輪為比稿，未整合正式頁面、未部署或提交。

Chrome / SwiftShader 驗證桌機 1440px、手機 390／320px、三案操作、減少動態及 WebGL 備援，證據在 `output/playwright/entrance-curtain-20260922/`。mock-up JS 語法、根目錄 app.js 語法與原型重打包通過，`preview.html` SHA-256 前後一致；Safari／iOS 實機及實際 GPU 效能未驗證。

## 2026-09-22 修復正式站拍立得照片裁切回歸

後續已依使用者要求同步本機與遠端 `main`：commit `89235d2796c017f619d4146ee7fdbbfcfb101e20`。五個已部署產品差異一併帶入，避免 CI 回退手機構圖；重建 436 檔快照與既有正式 hash `a2a32307…` 完全一致。[CI 35740635299](https://github.com/wu0010802-stack/ivy-website-admin/actions/runs/35740635299) 的前台、後台、PostgreSQL／契約及正式部署全部成功，線上 release 已對應同一 commit。兩個原工作區的未提交內容保留；同步 main 時逐檔確認其 9 個使用者檔案 hash 不變。

已部署至[正式官網](https://web-production-04caa.up.railway.app/)：web deployment `3a94c291-e100-435b-ad34-8531a5370b9b` SUCCESS，release `a2a32307…`。以目前正式 `050b9d12…` 快照為基底，只移除 `DayMomentCard.vue` 被效能分支合併帶回的 figcaption，修正照片框多出 29px、WebGL 裁切與 DOM 不一致；保留既有手機構圖與效能版本。

Node 22 web typecheck、92 項 web／42 項 admin tests 與前後台 build 通過；46 項公開 GET 檢查、Chrome 桌機／手機 WebGL、320px 減少動態及 CSS 備援的六張照片比例與翻面均通過。初次線上 WebGL 等待曾逾時，獨立診斷正常後完整重驗四組通過，紀錄保留。Safari／iOS 實機未驗證。證據在 `output/railway-day-photo-fix-20260922-204153/`，詳見[部署紀錄](deploy/README.md)；API／Postgres 未變，未 commit／push。

## 2026-09-22 手機版保留桌機構圖

依使用者確認，Nuxt 首頁手機消息恢復大圖＋下方標題，消息與近期活動以原生橫向捲動呈現並露出下一張；700px 以下分校照片改為 3:2，拍立得縮至容器 84% 並保留左右錯位。正背面共同撐高，避免縮窄或放大文字時裁掉故事；首頁影片、介紹雙照片與桌機排版沿用既有定案。

Node 22 typecheck、91 項 web 單元測試、JS 語法、原型重打包與 diff 檢查通過。Chrome 320／390／430／640／768／1024／1440px、觸控橫滑、鍵盤及對話框焦點返回、六張 WebGL 翻面、CSS 備援、減少動態、橫直轉向，以及拍立得／消息 200% 文字放大通過；整頁無水平溢出，1440px 主要區塊及手機 Hero 尺寸與修改前一致。實作驗證在 `output/playwright/mobile-composition-20260922/`；Safari／iOS 實機未驗證，未提交。

已部署至[正式官網](https://web-production-04caa.up.railway.app/)：web deployment `81f2ce4e-0722-4fbe-bc5d-125196351034` SUCCESS，release `050b9d12…`。以最新校區線稿版 `4045a4b4…` 為基底，只套入這次四檔手機差異，保留正式字型、Hero 與延後載圖。固定快照通過 92 項 web／42 項 admin tests、typecheck 與前後台 build；45 項公開檢查、Chrome 七尺寸及手機互動驗證通過。部署證據在 `output/railway-mobile-composition-20260922-175717/`，詳見[部署紀錄](deploy/README.md)；API／Postgres 部署未變，未 commit／push。

## 2026-09-22 首頁五校線稿切換列放大

依使用者截圖調整 `web/app/components/CampusBoard.vue`：桌機線稿寬度 120→160px、校名 15→17px，選校列上限 820→1040px，並同步圖片 `sizes`。窄桌機插畫依可用寬度等比例縮放；手機沿用既有一列五校尺寸與短底線樣式。

Node 22 typecheck、JS 語法與原型打包通過；Chrome 在 1440／768／701／700／390／320px 的五校排列、無水平溢出、點選與方向鍵循環切換通過。截圖在 `output/playwright/campus-size-*.png`；原型打包無差異。

已部署至[正式官網](https://web-production-04caa.up.railway.app/#campuses)：web deployment `47f3ca84-a257-441a-8723-54ebff31bff3` SUCCESS，release `4045a4b4…`。以線上 CI commit `4466afa` 重建的精確快照疊加本輪四處尺寸差異，保留已部署的卡片延後載圖；未帶入其他手機版調整。固定快照通過前台 92／後台 42 tests 與前後台 build；43 項公開檢查、Chrome 1440／768／390／320px 五校點選／鍵盤／無溢出檢查通過。證據在 `output/railway-campus-size-20260922-174531/`，詳見 [部署紀錄](deploy/README.md)。未 commit／push。

## 2026-09-22 後台深色側欄與青藍風格已部署

[正式後台](https://web-production-04caa.up.railway.app/admin/) 已套用參考 `ivy-frontend` 的深藍灰側欄、青藍操作色與淺灰工作區。以目前線上快照為基底，只替換 9 個後台樣式檔，保留官網、API、資料庫與既有操作流程。

web deployment `ac70c670-ff0f-45b7-8764-81cb67e1e34b` 為 SUCCESS，release `fc5638c3…` 及後台 JS／CSS 逐檔雜湊已在線上核對。固定快照通過 web 88／admin 30 tests、typecheck 與前後台正式建置；39 項公開 GET 與 Chrome 1440／390／320px 共 14 組檢查通過。登入頁為實際匿名流程，內頁使用正式程式搭配合成 API，未登入真實帳號或讀寫私人案件。證據在 `output/railway-admin-style-20260922/`；Safari／iOS 實機未驗證。未 commit／push。

## 2026-09-22 官網後台套用園務後台風格

依使用者指定參考 `ivy-frontend`，`admin/` 改為深藍灰側欄、青藍操作色、淺灰工作區與白底面板。統一總覽、列表、表單、素材選取及登入畫面；保留兩層分組、權限、搜尋、手機抽屜與未儲存保護。

Node 22 typecheck、42 項後台單元測試與 production build 通過；Chrome 8 頁 × 5 尺寸（320–1440px）、導覽／按鈕對比及主要互動共 76 筆檢查通過，另 11 筆按鈕 hover、焦點、高對比與減少動態檢查通過。實際畫面使用合成 API 資料，未寫入正式資料；JS 語法與原型重打包通過，`preview.html` 無差異。建置保留既有大型 bundle 警告。證據在 `output/playwright/admin-reference-20260922/`，Safari／iOS 實機未驗證。僅本機整合，尚未部署或提交。

## 2026-09-22 預約 A 與孩子／聯絡資料已部署

[正式預約入口](https://web-production-04caa.up.railway.app/visit) 已更新為 A 兩步驟選校與參觀資料，支援日期／場次、孩子姓名／生日、Email 與得知管道；後台同步詳情、搜尋、CSV 及人工確認。分校直達頁的場次載入已修正 SSR hydration 不一致。五校預約模式維持 `paused`，園方開啟適當模式並設定場次後才接受表單。

依使用者確認，先備份官網獨立正式 PostgreSQL，再更新至 `8cf3e2b5a641`；沒有修改或停權帳號。API `69880c2d-77d0-457d-a051-90f80464b7c4` 與 web `c801bed3-689e-416d-b057-6ad75d8ed891` 均 SUCCESS，release `da604b8c…` 已線上核對，保留既有 Hero、照片、字體、活動卡、頁尾與效能更新。

固定快照 web 88／admin 30／真 PostgreSQL API 171 tests、前後台 build 通過；線上 39 項公開 GET、97 個 API 檔案 hash、migration／volume／非 root 程序及三尺寸 6 組 Chrome 驗證通過，無 runtime／hydration error。沒有登入正式後台、建立正式預約、啟用寄信／索引或 commit／push。[部署紀錄](deploy/README.md) 與 `output/railway-visit-20260922-151800/` 保留完整證據。

## 2026-09-22 官網 CI/CD 設定（待發布啟用）

新增 GitHub Actions：PR／開發分支執行前後台、真 PostgreSQL 與 API 契約檢查；`production` 通過後依序部署 Railway API／web，核對 deployment ID 與公開 release。API 啟動先以唯讀交易核對 schema，migration 維持另行核准。啟用需發布 workflow、設定 production 的 Railway secret，以及整理已核准的正式版 commit；現有線上快照含未提交設計，不能直接用舊 HEAD 覆蓋。詳見 [CI/CD 說明](deploy/CICD.md)。

## 2026-09-22 前台載入效能第一批已部署

校園探索圖片按需載入／responsive 縮圖、首頁 hydration 幾何預留、日常封面延後載入及首屏字型分包已部署至 Railway web。以最新正式快照疊加 17 個效能檔案差異，保留既有設計、原圖放大、CMS 媒體來源與字形；API、DB 與其他工作區功能不在本輪部署範圍。

固定快照 typecheck、前台 77 tests／後台 27 tests 與 production build 通過；線上 51 項公開 GET、18 組 Chrome 情境通過，五尺寸 hydration 幾何穩定，無 runtime error 或 hydration warning。無 JS、減少動態、縮放／場景／熱點／dialog 與暖快取皆已補驗。web deployment `d07e2cc6-4805-44d5-94b7-26efe45b3bde`，release `794731a2…`。本機受控比較與正式站限速抽測見 [量測與部署紀錄](docs/analysis/2026-09-22-frontend-performance-batch1.md)；這些數字不等同真實訪客 p75。

## 2026-09-22 分校社群移除外連箭頭

依使用者指定，移除選單分校社群列 FB／LINE 名稱旁的箭頭，保留原圖示、名稱、連結與讀屏的新視窗提示；Nuxt 和 B 互動稿同步。電話、主導覽與機構社群不在本次修改範圍。JS 語法與原型打包通過，尚未部署。

## 2026-09-22 選單改為一般淺色毛玻璃

依使用者修正，移除墨綠染色，改用中性乳白半透明底、深灰文字、24px 背景模糊及淡亮邊框；標題、五校與聯絡區同樣使用中性色。保留 B 排版、上一輪字級、分校及機構社群順序。[最新 B 預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)，[實站截圖](output/playwright/menu-neutral-glass-20260922/menu-desktop.png)。

Chromium 六尺寸、操作尺寸、鍵盤、既有連結、200% 文字放大與三種透明度／色彩備援通過，無 runtime error；深色文字以純黑最暗背景合成驗證，正常與 hover 對比皆超過 4.5:1。JS 語法、原型打包與 diff 檢查通過，`preview.html` 無差異。證據在 `output/playwright/menu-neutral-glass-20260922/`。已套用本機官網與互動稿，尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 頁尾 A「深森林綠」已部署

[查看正式官網頁尾](https://web-production-04caa.up.railway.app/#footer-campuses)。共用頁尾採深森林綠、米白文字與暖金點綴，呈現已確認的精簡底列；首頁消息區維持暖白銜接。web deployment `2b928a25-1865-47ee-90a1-dfbee3b9dc53` 為 SUCCESS，線上 release hash `87efef1ebe8118ace30cc39a54fac7907b65a815bfee91f3af357106129d7c3f` 已核對。

以當時線上的活動卡／Hero 快照為基底，產品檔案只更新 `SiteFooter.vue`，保留其他已上線內容。Node 22 typecheck、web 72／admin 27 項測試與正式建置通過；正式站 39 項公開 HTTP 檢查及 9 組 320–1920px 瀏覽器檢查通過，CSS hash／色碼、暖白轉場、焦點與高對比備援正常，零 runtime／console error。證據在 `output/railway-footer-a-20260922-150539/`；Safari／iOS 實機未驗證。

自動核准審查拒絕正式帳密使用與私有管理資料讀取，因此本次採公開 GET-only smoke，未執行後台登入／私有資料驗證。API／Postgres 未部署，未執行 migration、CMS 發布、素材或帳號異動、commit／push。

## 2026-09-22 選單 B 改為墨綠毛玻璃

依使用者要求，B 選單整體改為墨綠毛玻璃：80% 透底色、24px 背景模糊、淡亮邊框、米白／淡綠文字與淡金電話圖示。五校底列與分校聯絡區同步透光，保留上一輪排版、字級與社群資訊順序。[B 互動預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)，[實站選單截圖](output/playwright/menu-glass-20260922/menu-desktop.png)。

Chromium 六尺寸、點擊尺寸、鍵盤操作、連結目的地與 200% 選單文字放大通過；以純白作最亮底色合成驗證文字及 hover 對比皆超過 4.5:1。減少透明度、模擬不支援 blur、強制色彩備援均通過，無 runtime error。JS 語法、原型重打包及 diff 檢查通過，`preview.html` 無差異。證據在 `output/playwright/menu-glass-20260922/`；僅本機整合，尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 預約 A 補齊參觀／孩子／聯絡資料

依使用者提供的表單截圖，A 版第二步新增：可預約日期與場次、孩子姓名與出生年月日、Email、得知管道多選（Facebook／Google 評論／媽媽社團／親友介紹／其他）。保留家長稱呼、手機、同意事項與選填提問；孩子姓名／生日必填，Email／得知管道選填。桌機長表單使用可跟隨捲動的迎賓照片區，手機按資料分組順讀。[本機完整表單預覽](http://127.0.0.1:3021/visit/yihua)使用合成場次與送出回應，不建立真實案件。

新增資料以獨立欄位儲存，後台明細、孩子姓名／Email 搜尋與 CSV 同步；生日按台北日期檢查、Email 格式檢核、得知來源使用穩定值。舊客戶端可省略新增欄位，保留舊請求冪等重播；匿名化清除新個資，公開家長回應及通知 payload 不增加兒童資料。

日期與場次使用既有 VisitSlot，僅在園方將該校設為 slots 並建立開放時段時呈現，inquiry 仍由園所安排。後台可選 slots 並設定人工／自動確認，預設人工確認；新增待確認標籤、篩選與確認已選場次的操作。修正最後一組 pending 確認時重算自身占位的問題，過期占位不得確認復活。未自動更改任何校區的實際設定。

驗證：web 86 tests、admin 42 tests（含修正選擇器後的指定重跑）、backend 指定預約／通知／保存政策 89 tests 通過；web／admin typecheck、OpenAPI／TypeScript 契約檢查通過。新 migration `8cf3e2b5a641` 已在專用 PostgreSQL `ivy_website_visit_details_test` upgrade，`alembic check` 無 drift；未動開發或正式 DB。五尺寸完整表單、選校／場次、額滿重選、日期／Email 驗證、空場次／讀取失敗重試與 200% 文字放大驗證在 `output/playwright/visit-details-20260922/`；快照 `versions/before-visit-details-20260922-143833/`。正式啟用需部署配套 API／前後台、套用 migration 並由園方設定場次；本輪未部署、未發送真實通知。Safari／iOS 實機未驗證。

## 2026-09-22 常春藤的一天移除照片補充字已部署

六張拍立得照片左上角的補充字及底標已移除，DOM、WebGL 貼圖及專用 CSS 同步清除。照片、時間戳、下方標題、背面故事、翻面與區塊來源說明保留。[查看正式官網](https://web-production-04caa.up.railway.app/#life)。僅部署三個檔案差異，保留線上既有頁尾、Hero、校園圖片與後台；未更動 CMS 資料及凍結原型。

web deployment `7817ce31-4423-43df-9163-d6aca236645f` 為 SUCCESS，線上快照 `52c0092371b0902c9838a4859fa5d48f8ef9f518814ef0f378efee97a12dd5e8` 已核對。隔離版本 typecheck、web 72／admin 27 項測試及正式建置通過；正式站 41 項公開 HTTP 檢查、桌機／390／320px 照片與翻面檢查完成。證據在 `output/railway-day-caption-20260922-151539/`，API／Postgres 沿用原部署；未 commit／push。

Node 22 typecheck、JS 語法與原型重打包通過；Chrome 1440／390px WebGL、320px 減少動態確認六張皆無圖說，時間戳／標題／故事保留、鍵盤翻面正常，無 runtime error。證據在 `output/playwright/day-captions-removed-20260922/`；Safari／iOS 實機未驗證。

## 2026-09-22 選單 B 色彩與文字比例精修

依使用者截圖優化選單：暖白底與墨綠導覽、深綠標題帶；分校聯絡區改為內縮淺鼠尾草綠與淡金電話圖示。主導覽桌機 20px／手機 18px、電話 22px、校名 14px、輔助字 12px；五校整併單列淡色底，社群移除厚框與重複的「前往」。分校在上、機構在下，以及 IG／YouTube「待提供」的資訊規則保留。

[本機 B 預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)與 Nuxt 官網同步。[實際選單截圖](output/playwright/menu-polish-20260922/menu-desktop.png)。Node 22 typecheck、JS 語法、原型重新打包及 diff 檢查通過，`preview.html` 無差異。Chromium 實站六尺寸／互動稿五尺寸、有效連結至少 44×44px、鍵盤與外連目的地檢查通過，無 runtime error；文字對比最低 5.55:1，390px 的選單文字放大 200% 無水平溢出。證據在 `output/playwright/menu-polish-20260922/`；尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 頁尾 A「深森林綠」已整合

依使用者「走 A」定案，Nuxt 共用頁尾改為深森林綠底、米白文字及暖金點綴，沿用現有排版、文案與五校導覽。首頁消息區維持暖白漸退，再接深綠頁尾；色票限定在 `SiteFooter.vue`，不更動全域品牌色與凍結原型。三案比較留存於 `design/footer-colour-directions-20260922/`，已於同日部署，詳見本頁部署紀錄。

[本機預覽](http://127.0.0.1:3016/#footer-campuses)。Node 22 typecheck、JS 語法檢查與原型重打包通過，`preview.html` 無 Git 差異；首頁／分校／預約頁三路由 HTTP 200 並載入已編譯的 scoped 色票。Chromium 九組路由／尺寸檢查（320–1920px）確認 A 色碼、全域暖白不變、頁尾無橫向溢出、10 個連結保留 44px 高度；暖金鍵盤焦點、hover 底線、強制色彩與減少動態檢查通過，無 runtime error 或 console warning。證據在 `output/playwright/footer-colour-directions-20260922/integration-results.json`；Safari／iOS 實機未驗證。

## 2026-09-22 選單分校資訊移到機構社群上方

依使用者修正，B 選單先顯示分校電話與 IG／FB／YouTube／LINE，最下方才是機構社群。分校社群依頁首電話對應的已發布校區取得；目前義華 Facebook、LINE 可開啟，IG 與 YouTube 顯示「待提供」且不產生連結。未能對應校區時不猜填；舊資料借用的機構帳號不重列成分校帳號。

[更新 B 預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)，[本機官網](http://127.0.0.1:3016/)。3 項社群歸屬 Vitest、Node 22 typecheck、Chrome 六尺寸（含順序、四平台圖示、電話至社群的鍵盤順序、分校與機構連結目的地）通過，無水平溢出或 runtime error。外站回應由本機替代，未撥號或傳訊；JS 語法與原型重打包通過，`preview.html` 無差異。證據在 `output/playwright/menu-campus-socials-20260922/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 Hero 清晰修復影片已部署

首頁已採用 11.7 秒 Hero 修復片段與新版封面，桌機／手機分別載入確認的最佳化影片；保留自然膚色、慢速循環與播放控制，改善細節及快速動作重影。[查看正式官網](https://web-production-04caa.up.railway.app/)。Hero deployment `1812fc8a-c8f4-4a3e-aed6-15ecfa08f14c` 為 SUCCESS；後續活動卡 deployment 已逐檔確認保留全部 Hero 更新。

以最新線上字體版本加入 10 個 Hero 檔案差異，固定快照 SHA-256 `f3a85bc5e8f7324835f08544bde09bb421d1f2d291cd7c78c00b31bd1e19f542`。Node 22 typecheck、web 72／admin 27 項測試與正式建置通過；線上 56 項 HTTP 檢查及 15 組桌機／手機播放、控制與封面備援驗證通過，0 runtime error。證據在 `output/railway-hero-restored-20260922-142744/`，部署細節見 `deploy/README.md`。本輪未 commit／push、migration 或 CMS 發布；Safari／iOS 實機未驗證。

## 2026-09-22 活動卡片 A「蜜糖日光」已部署

commit `8adf2a1` 的三色向下填入動畫已上線：[正式官網近期活動](https://web-production-04caa.up.railway.app/#latest-news)。以最新 Hero 修復影片快照為基底，只加入活動卡片 CSS，保留已上線的字體、校園照片與後台。web deployment `cd51dbeb-4f59-4e76-91bc-5d5a392fb7c9` 為 SUCCESS，線上 `/release.json` 對上 `0d8237902391866c562747b53bda8e6833cc73e816d54959f4f871a1d826f162`。

Node 22 型別檢查、web 72 項／admin 27 項測試及前後台正式建置通過；正式站 48 項 HTTP 與 8 組桌機／手機互動檢查通過，逐卡截圖像素確認 A 色碼及向下填色，0 runtime error。證據在 `output/railway-event-hover-a-20260922-143225/`，部署細節見 `deploy/README.md`。API／Postgres 維持原部署，未執行 migration、CMS 發布或 Git push；Safari／iOS 實機未驗證。

## 2026-09-22 預約參觀 A 已整合並優化

依使用者「走 A」定案，正式 Nuxt `VisitForm.vue` 採墨綠迎賓／校園影像與兩步流程：五校照片選擇 → 聯絡與安排。通用入口不預選；分校入口直接帶入第二步。手機第二步收短介紹，選填資料預設收合；返回換校保留所有填寫資料，欄位錯誤就地顯示並移動焦點，支援手機號碼貼上空格／連字號。送出中鎖定輸入與切校，成功後以 server 狀態呈現「已收到需求／待園方確認／預約成立」，補充或更正改引導直接聯絡原校。

[本機 A 版預覽](http://127.0.0.1:3021/visit)；[桌機選校截圖](output/playwright/visit-a-20260922/desktop-select.png)、[手機表單截圖](output/playwright/visit-a-20260922/mobile-form.png)。新增樣式限於 VisitForm scoped，沿用各校即時預約設定、API 與 idempotency；LINE／電話僅使用該校既有資料，slots 模式沿用尚未開放政策。

驗證：web 單元測試 **80 passed**、隔離副本 Nuxt typecheck 通過；Chromium 1440／1024／768／390／320px、五校、鍵盤、手機觸控、200% 表單文字放大、保留輸入、錯誤重試、防重複送出、設定變更、各聯絡模式與三種成功狀態，共 19 組檢查通過。預約 POST 全部攔截為合成回應，未建立真實案件。原型 `node --check app.js`／重新打包通過，`preview.html` 無差異。快照在 `versions/before-visit-a-20260922-141058/`；驗證腳本、結果與截圖在 `output/playwright/visit-a-20260922/`。尚未部署或提交；Safari／iOS 實機未驗證。

## 2026-09-22 選單採用 B 米白目錄與機構社群

依使用者選定 B，Nuxt 選單改為米白直式目錄，頂部採深綠「探索常春藤＋細線」，底部保留明標義華校的參觀專線。「機構社群」先加入專案既有的 Facebook `facebook.com/ivykid`；其他平台待提供。分校捷徑保留行政區；矮螢幕可捲動選單。同步修正面板繼承 `pointer-events:none` 的點擊穿透，以及四項舊 hash 導覽，保留膠囊本體。

[本機首頁](http://127.0.0.1:3016/)捲動後展開右上選單；[B 互動稿](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)。Chrome 六尺寸、手機首屏／收合選單、鍵盤焦點、四項錨點實際點擊與 Facebook 新分頁（外站回應由本機替代）通過，無水平溢出或 runtime error；Node 22 typecheck、JS 語法與原型重打包通過，`preview.html` 無差異。證據在 `output/playwright/menu-directory-b-20260922/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 首頁字體分工已上線

確認的字體調整已部署至[正式官網](https://web-production-04caa.up.railway.app/#latest-news)。web deployment `8eb936b3-343a-4e0e-9d00-886ddd0fa607` 為 SUCCESS；以當時線上版本加入字體樣式與 CSS 註冊兩檔差異，快照 SHA-256 `ebad700792a6e5c5aac90ba3500d8b6a8ec923af8ee2b05fa9aa737b727868d9`。

Node 22 型別檢查、web 72／admin 27 項測試及正式建置通過。線上 47 項 HTTP 檢查（含 CSS 雜湊）與 Chrome 六尺寸／消息互動 10 組驗證通過，無水平溢出或 runtime error；Safari／iOS 實機未驗證。部署證據在 `output/railway-typography-20260922-141925/`，細節見 `deploy/README.md`。未 commit／push、migration 或 CMS 發布。

## 2026-09-22 首頁字體分工已整合

依已確認 mock-up，正式 Nuxt 首頁及消息／活動視窗採用字體分工：品牌主標與分校明體保留，理念標題收斂，資訊標題使用系統黑體600、正文400、操作500，日期與英文小標沿用 Source Sans 3 400。字體變更集中在 `web/app/assets/css/typography.css`，由 `web/nuxt.config.ts` 註冊；沿用原內容、照片與互動。

[本機預覽](http://127.0.0.1:3016/#latest-news)。Chromium 320／390／768／1024／1440／1920px 字級與版面檢查通過；桌機／手機消息清單、詳情、Escape、焦點返回與正常捲動模式通過。品牌／校名／孩子的一天字級對照一致。Nuxt typecheck、原型語法與重打包通過，根目錄 `preview.html` 無差異。截圖與計算字型紀錄在 `output/playwright/typography-roles/`，快照在 `versions/before-typography-roles-20260922-140604/`。尚未部署或提交。

文字放大200%：本次理念、消息與詳情無文字裁切，活動日期欄已修正重疊；320px時的既有頁首仍有水平溢出，停用本次樣式後同樣存在，未擴大修改頁首。Safari／iOS 實機未驗證。

## 2026-09-22 Hero 影片清晰修復片段（未替換）

從園方提供的廣告原檔重製既有七個 Hero 鏡頭，維持 11.7 秒、1080×800、半速無聲循環；輕度去噪／細節銳化並避免多次壓縮。揮手與跳躍兩鏡改保留原始影格，改善光流補幀重影。交付高畫質短片、桌機／手機網頁版及封面，素材與重製腳本在 `design/hero-video-restoration-20260922/`。

[新舊版預覽](http://127.0.0.1:8794/design/hero-video-restoration-20260922/)。三版完整解碼、351 幀／30fps／無音軌／faststart 檢查通過；Chrome 三尺寸預覽與三版完整循環共 6 組檢查通過，無溢出或 runtime error。原型語法／重打包通過，`preview.html` 無差異；尚未替換正式 Nuxt 或部署，Safari／iOS 實機未驗證。

## 2026-09-22 後台缺陷修復（backend／admin／web 契約）

針對後台（`backend/` + `admin/`）做了一輪多維度稽核，修掉 20 項實際重現過的缺陷。最嚴重的七項都有 repro 測試佐證：

- **帳號 email 大小寫**：建立時大小寫敏感、登入查詢不分大小寫，只要存在 `admin@` 與 `ADMIN@` 兩筆就整支登入端點拋 `MultipleResultsFound`（500），而且 API 沒有任何端點能救回來。改成 schema 統一正規化＋DB 端 `lower(email)` 唯一索引兜底，登入查詢改 `limit(1)` 不再炸。
- **共用素材跨校破壞**：`campus_key` 為 NULL 時權限檢查直接放行，任何分校管理者都能改寫、取代、刪除五校共用素材。manage 一律限總管理者。
- **已發布素材可被刪**：引用計數只看最新草稿，把圖從草稿移除後就能刪掉線上還在用的素材（官網當場破圖）。刪除前改成一併檢查目前生效 release 的 manifest。
- **家長管理連結可無限重放**：docstring 宣稱一次性但程式從未寫過 `revoked_at`，連結外流後 14 天內任何人都能看個資、取消預約。改成終態自動撤銷＋新增管理端撤銷端點；家長端回應同時改成遮罩手機的專用 schema（規格 6.4）。
- **公開送單零限流**：規格第 199 行要求 429，實際完全沒有。補上「校區＋手機」與來源兩層滑動窗口，冪等重播不計入。
- **家長改期申請不驗證**：亂填 slot UUID 撞 FK 變 500，別校時段會卡成永遠 pending。補上存在性、同校、可預約與重複申請檢查。
- **過去時段可被預約**：公開查詢與送單都不檢查日期，名額永久被佔住。依規格 225–226 補上最短提前 24 小時、最遠 60 天的時間窗，查詢與送單共用同一份判斷。

其餘：上傳大小限制改成串流中止（原本先把整個檔案讀進記憶體才比對）、Pillow 壓縮炸彈、URL scheme 驗證改允許清單（`java<TAB>script:` 原本可繞過並經 `CampusBoard.vue` 的 `:href` 變成公開站 stored XSS）、內容跨校讀取、素材引用驗證、內容樂觀鎖補列鎖、預約設定存檔補列鎖、CSV 匯出獨立權限＋稽核、帳號建立／授權補稽核、通知重試去重、worker 失敗補 rollback、儀表板改用台北時區、analytics 限流鍵改用訪客 IP、三支 migration 壞掉的 `downgrade()`。

**行為變更**：依規格第 197／221／222 行，`slots` 模式送出後預設是「待園方確認」（`pending_confirmation`，占名額、24 小時占位到期自動釋放），不再一律直接寫成 `confirmed`。園方要「送出即成立」需在預約設定打開 `slots_auto_confirm`。`web/` 的成功畫面改成依 server 回傳的實際狀態顯示文案，不再從 mode 推斷成「預約成立」。

**尚未處理（需另行決定）**：規格第 190 行的 `age`／`contact_time` 固定 enum 仍未強制——公開表單目前送的是 CMS 的中文標籤，收緊成 Literal 會讓現行表單全部送不出去，需要 `web/` 與 CMS 選項一起改。

同時補上 `web/server/routes/api/website/v1/[...].ts` 的訪客 IP header（並顯式覆寫，避免被偽造），公開端點限流才真的以訪客為單位——實測同一訪客連打 22 次 analytics 在第 21 次開始 429，另一個訪客仍是 204。

驗證：`backend` pytest 150 passed、`admin` vitest 39 passed、`web` vitest 72 passed、`admin` vue-tsc 乾淨、`alembic check` 無 drift、`export_openapi.py --check` 契約一致。新 migration head 為 `a1c4f7e92b30`。

## 2026-09-22 導覽選單三款 mock-up

新增獨立 `design/menu-uiux-20260922/`：A「墨綠精簡」整理雙欄導覽、分校捷徑與義華專線；B「米白目錄」以單欄順讀呈現；C「校園優先」提供五校照片、電話與參觀路徑同步切換。[三款互動比較](http://127.0.0.1:8786/design/menu-uiux-20260922/)可切換桌機／手機，保留原截圖與完整比較圖。推薦 A 延續現有選單風格；尚未定案、整合 Nuxt 或部署。

Chrome 三款 × 五尺寸共 15 組版面、C 五校資料／目的地、鍵盤與選單開關、比較頁裁切檢查通過，無水平溢出、缺圖或 runtime error；操作目標至少 44 × 44px。JS 語法、校名字型 cmap 與原型重打包通過，`preview.html` 無差異。驗證紀錄在 `output/playwright/menu-uiux-20260922/`；Safari／iOS 實機未驗證。

## 2026-09-22 預約校園參觀三案 mock-up

新增獨立 `design/visit-booking-mockups-20260922/`：[互動比較](http://127.0.0.1:8786/design/visit-booking-mockups-20260922/)與[三案並排](http://127.0.0.1:8786/design/visit-booking-mockups-20260922/compare.html)。A 為照片選校＋兩步短表單、B 為五校並列＋單頁表單、C 為校園大圖＋側邊／手機底部表單；參考 EtonHouse、MindChamps、BrightPath 的選校與參觀流程。保留校區帶入、切校後輸入、inquiry 語意及各校聯絡方式。

Chromium 三案 × 五尺寸（1440／1024／768／390／320px）互動驗證通過，無水平溢出、圖片失敗、runtime error 或網路 mutation；深連結、暫停情境、鍵盤、錯誤與返回修改通過。JS 語法與原型重打包通過，`preview.html` 無差異。本輪不傳送預約資料、不整合 Nuxt、不部署；Safari／iOS 實機未驗證。

## 2026-09-22 字體角色分工 mock-up

新增獨立 `design/typography-roles-20260922/`，以相同節錄內容、版型與照片比較目前字體與提案：品牌標語保留 LINE Seed、五校名稱保留明體，資訊標題改用系統黑體 600，內文 400，日期沿用較輕的 Source Sans 3。理念大標收斂，桌機正文與手機消息入口提高字級。[互動比較](http://127.0.0.1:8782/design/typography-roles-20260922/)與[並排截圖](http://127.0.0.1:8782/design/typography-roles-20260922/compare.html)均提供桌機／手機；尚未整合正式 Nuxt。

Chromium 六尺寸 × 兩版無水平溢出、缺圖；200% 文字縮放、比較切換、詳情與焦點返回通過。保留品牌／校名字型 cmap 覆蓋、JS 語法、原型重打包通過，`preview.html` 無差異。Safari／iOS 實機未驗證。

## 2026-09-22 五校校園修復圖已部署

已將確認的五校修復版圖片套用至[正式官網](https://web-production-04caa.up.railway.app/#campuses)的首頁輪播、分校封面與分享圖。web deployment `2f074707-e2a7-47c2-99fc-005d1bc47c52` 為 SUCCESS；以線上基底加入 23 檔圖片與設定差異，快照 SHA-256 為 `45467a20ebd86b008aebbd4cc2e2e36ac315795cedc1f678e64ffb0fc2e3095c`。

Node 22 型別、web 72 項／admin 27 項測試與正式建置通過。線上 HTTP 64 項（含 20 張圖片逐檔雜湊）及 Chrome 30 組桌機／手機圖片與版面檢查通過，無水平溢出或 runtime error。部署證據在 `output/railway-campus-photos-20260922-134539/`，細節見 `deploy/README.md`；API／資料庫沿用原部署，未 commit／push、migration 或 CMS 發布。Safari／iOS 實機未驗證。

## 2026-09-22 後台 UI／UX 已部署

後台手機清單、篩選／重試、未儲存保護、版本衝突保留輸入與觸控圖釘已上線：[正式後台](https://web-production-04caa.up.railway.app/admin/)。web deployment `1e3b1147-edc6-487c-a144-6b3a6bdb9515` 為 SUCCESS；採既有線上官網快照加 `admin/` 22 檔差異，官網及 API／資料庫沿用原版本。

快照 web 72 項／admin 27 項測試、型別與正式建置通過；線上 HTTP 39 項、Chrome 32 項檢查通過（1440／390／320px），JS／CSS 與本機正式建置雜湊一致。0 runtime error，未儲存測試未送出資料。部署證據在 `output/railway-admin-uiux-20260922-133447/`，細節見 `deploy/README.md`。未 commit／push、未執行 migration 或 CMS 發布；Safari／iOS 實機未驗證。

## 2026-09-22 首頁與分校內頁銜接 mock-up

新增獨立提案 `design/campus-continuity-mockup-20260922/`，延續首頁已定案的明體校名、暖白底、明亮圓角校園照片與香檳金入口；內容包含五校首屏、介紹、照片切換、FAQ 與聯絡區。提供[目前版／提案比較頁](http://127.0.0.1:8782/design/campus-continuity-mockup-20260922/)，可切換五校與桌機／手機，附完整截圖。僅為 mock-up，尚未整合 Nuxt 或部署。

本機 Chromium 六尺寸 × 五校 30 組版面無水平溢出、主圖與明體正確載入、無 runtime error；照片選擇、FAQ、手機選單及比較工具操作通過。標題字型 cmap、JS 語法與原型重打包通過，`preview.html` 無差異。Safari／iOS 實機未驗證。

## 2026-09-22 五校校園圖採用修復版

依使用者確認，Nuxt 首頁分校輪播、五校內頁封面及分享圖改用已選定的質感修復素材。義華為 1546×1017，其餘約 1737×906；使用新版檔名並產生 480／800／1200px 響應式 WebP，原圖、PNG 母檔與比較頁均保留。內頁圖說改為「校園圖像」。

[本機預覽](http://127.0.0.1:3010/#campuses)。Chrome 320／390／1440／1920px 首頁與桌機／手機五校內頁共 30 組檢查通過，確認新版圖片、響應式選圖、裁切、切校鍵盤操作與連結，無水平溢出或 runtime error。五張素材雜湊吻合確認版、20 個圖片尺寸檢查、Nuxt typecheck、原型語法／重打包與 diff 檢查通過；`preview.html` 無差異。證據在 `output/playwright/campus-photo-replacement-20260922/`。未部署；Safari／iOS 實機未驗證。

## 2026-09-22 後台手機清單與編輯保護

`admin/` 沿用淺色、深綠操作的既有風格，將時段、通知、使用者與操作紀錄改為桌機表格／手機直向清單。統一有標籤的篩選、筆數、載入與錯誤重試；新增使用者與操作紀錄搜尋。預約方式與全站設定加入未儲存離頁保護，版本衝突保留輸入；批次已讀、帳號操作與時段調整防止重複送出。校園探索支援觸控拖曳、44px 圖釘與鍵盤微調。

驗證：27 項 Vitest 全數通過；`npm --prefix admin run build`（含 TypeScript）通過，仍有既有主 bundle 大於 500KB 提示。Chrome 10 頁 × 1440／390／320px 共 30 組版面檢查，無水平溢出或 runtime error；另通過設定取消／放棄、7 頁錯誤重試、名額編輯、通知批次、使用者範圍與觸控／鍵盤操作。截圖及合成 API 測試腳本在 `output/playwright/admin-uiux-20260922/`。瀏覽器驗證不連真實後端，未寫入正式資料；未部署，Safari／iOS 實機未驗。

## 2026-09-22 分校線稿採用 A「留白短線」

依使用者選定 A，正式 Nuxt `CampusBoard.vue` 的五校選單加入各校建築線稿，校名下方以桌機 25px／手機 20px 短底線呈現選取。取消整列上下框線及矩形 hover 底色，保留明體標題與既有照片、聯絡資訊、輪播控制。沿用響應式線稿與 lazy loading，decorative 圖片不重複朗讀校名。

[本機預覽](http://127.0.0.1:3010/#campuses)。Chrome 六尺寸 × 五校及鍵盤／連結共 32 筆驗證、桌機／手機輪播 10 項互動檢查、Nuxt typecheck 通過；無水平溢出、缺圖或 runtime error。原型語法與重打包通過，`preview.html` 無差異。截圖與檢查在 `output/playwright/campus-lineart-a/`，改前快照在 `versions/before-campus-lineart-a-20260922/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 分校按鈕三個新方向（mock-up）

使用者否決建築輪廓描邊後，新增 `design/campus-tab-framing-20260922/`：A 留白短線、B 校名膠囊、C 輕框卡片。三款皆沿用原有五校線稿，提供桌機／手機同頁對照與完整互動預覽，尚未選定或整合 Nuxt。

[三款比較頁](http://127.0.0.1:8772/design/campus-tab-framing-20260922/)。Chrome 三款 × 四尺寸 × 五校共 60 個版面與鍵盤檢查通過，無水平溢出、缺圖或 runtime error。原型語法與重打包通過，`preview.html` 無差異。

## 2026-09-22 五校校園圖質感修復提案（未整合）

新增五校 AI 修復圖片與[原圖／新版互動比較頁](http://127.0.0.1:8772/design/campus-photo-enhancement-20260922/)。義華由 590×388 提升為 1546×1017，其餘由 1000×522 提升為約 1737×906；保留 PNG 母檔、WebP 與完整提示詞。改善材質清晰度與色偏，但窗格、招牌、人物、植栽等有生成差異，因此仍為提案，未替換 Nuxt 的官方素材。

素材與使用界線見 `design/campus-photo-enhancement-20260922/README.md`。Chrome 三尺寸 × 五校 15 組顯示與互動檢查通過，無水平溢出或 runtime error；原型語法與重打包通過，`preview.html` 無差異。未部署。

## 2026-09-22 A 版線稿按鈕改為建築輪廓框（mock-up）

依使用者截圖，A 版五校按鈕的框線改沿各校建築外緣描繪，保留雙塔、尖屋頂與仁武圓頂的差異。移除矩形 hover 底色、橫跨選校列的直線及選取底線；移入時輪廓淡顯、選取時加深，校名維持下方。只修改獨立 mock-up，B 版與正式 Nuxt 未改。

[更新版 A](http://127.0.0.1:8772/design/campus-lineart-placement-20260922/preview.html?layout=a)。Chrome 四尺寸／五校版面及鍵盤檢查通過；另確認五種輪廓、透明 hover、手機截圖與強制色彩焦點。原型語法與重打包通過，`preview.html` 無差異；框線截圖在 `design/campus-lineart-placement-20260922/screenshots/a-building-outline.png`。

## 2026-09-22 分校建築線稿兩款位置 mock-up（未整合）

新增獨立比較頁 `design/campus-lineart-placement-20260922/`，沿用目前明體標題、細線選校列、圓角輪播及五校原有線稿。A 將小線稿放在各校名稱上方；B 在區塊右上角顯示目前校區建築，與照片同步切換，手機移至標題右側。預設明華校，提供桌機／手機截圖與五校互動預覽。

[本機比較頁](http://127.0.0.1:8772/design/campus-lineart-placement-20260922/)。Chrome 兩款 × 四尺寸 × 五校共 40 個狀態與鍵盤循環通過，無水平溢出或 runtime error；原型語法檢查與重打包通過，`preview.html` 無差異。正式 Nuxt 元件未改，未部署；原始線稿未修改。驗證紀錄在 `output/playwright/campus-lineart-placement/`。

## 2026-09-22 分校控制器延後至照片下方區塊首次進場

依使用者截圖調整 Nuxt `CampusBoard.vue`：膠囊與播放鍵在首次滑到照片下方控制區、該區塊至少 80% 可見時才播放水滴進場。改以控制區原始位置的定位元素觸發，避免 sticky 提前拉入畫面就播放；保留一次性進場、回捲時的吸附位置與播放操作。

本機預覽：[首頁](http://127.0.0.1:3010/)，重新整理後向下捲至分校照片下緣。Chrome 1440／390／320px 確認提前顯示問題修復，首次進場、回捲、暫停／繼續、切校、無溢出及減少動態／高對比／鍵盤共 6 組檢查通過，無 runtime error。Node 22 Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 通過，`preview.html` 無差異；紀錄在 `output/playwright/campus-control-trigger/`。已部署正式 web（`eec927c9-839d-48cd-b703-7151db30485f`，SUCCESS），線上版本、31 項服務檢查與 6 組瀏覽器功能驗證通過；部署證據見 `deploy/README.md`。Safari／iOS 實機未驗證。

## 2026-09-22 手機 Hero 影片放大

依使用者要求讓影片佔更多版面，Nuxt 1000px 以下影片由約 43% 視窗高度提高為 60%（320–620px），影片下方留白縮為 24px。390×844 手機的影片由約 363px 增至 506px，554×620 視窗由 280px 增至 372px。保留米白文字區、完整文案與無框漢堡。

手機 Hero 採自然捲動，文字與按鈕不在閱讀途中淡出；同步取消手機首次繪製的 sticky 空間預留。桌機仍維持原有揭幕轉場。[本機預覽](http://127.0.0.1:3010/)，截圖與驗證紀錄位於 `output/playwright/hero-video-larger-20260922/`；尚未部署。

Chrome 320–1440px、橫向、減少動態與無 JavaScript 共 10 組版面檢查通過，無水平溢出、內容裁切或 runtime error；選單、影片播放／暫停、孩子的一天入口通過。Node 22 Nuxt typecheck、原型語法／重打包及 diff 檢查通過，`preview.html` 無差異；Safari／iOS 實機未驗證。

## 2026-09-22 活動卡片採用 A「蜜糖日光」

依使用者選定 A，Nuxt 首頁三張活動卡 hover 色改為金黃 `#F6CD68`、蜂蜜 `#EABC74`、燕麥 `#F5DDA3`，保留 560ms 向下填色、移開還原與原有靜止底色。六組比較頁保留提案紀錄，正式配色規則同步至 DESIGN.md。

本機預覽：[近期活動](http://127.0.0.1:3010/#latest-news)。Chrome 桌機 1440px／手機 390、320px 共 8 組互動檢查通過，三張截圖像素均對上 A 色碼及由上往下填色，無 runtime error；鍵盤、減少動態、高對比及活動視窗維持正常。`node --check app.js`、`python3 package_preview.py` 通過，凍結原型 `preview.html` 無差異；紀錄在 `output/playwright/event-hover-a/`。尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 手機 Hero 米白底與無框漢堡選單

Nuxt 手機／平板 Hero 保留上方影片，下方深綠面板改為米白底、深色文字，移除文字陰影，並同步原生／fallback 捲動動畫的字色與深色按鈕框。首頁上方漢堡移除外框、兩條線雙向置中，保留 44×44px 點擊範圍與鍵盤焦點。

Chrome 320–1440px、減少動態與 fallback 共 12 組版面驗證通過，無水平溢出或 runtime error；手機文字對比 12.72:1，漢堡置中偏差 0px。選單點擊／Enter／Escape、收合膠囊與影片播放切換通過。Node 22 Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 及 `git diff --check` 通過，凍結原型 `preview.html` 無差異。證據在 `output/playwright/hero-mobile-20260922/`；[本機預覽](http://127.0.0.1:3010/)。未部署，Safari／iOS 實機未驗證。

## 2026-09-22 移除頁尾開發輔助連結

Nuxt 共用 `SiteFooter.vue` 移除「標題字型 LINE Seed TW」與「機構原官網」兩項連結及箭頭。版權與頁尾備註依內容顯示；兩者皆空時不保留空白底列，適用首頁、分校及預約頁。

Chrome 桌機 1440px／手機 390px × 三頁共 6 項檢查通過，無水平溢出或 runtime error，首頁頁尾漸退仍完整。Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 通過，`preview.html` 無差異。截圖與紀錄在 `output/playwright/footer-helper-removal/`；尚未部署。

## 2026-09-22 分校 B 標題與大校名明體整合

依使用者選定 B 並追加的截圖調整，Nuxt `CampusBoard.vue` 改為置中雙語標題與細線五校選單，無校區編號。「分校資訊」與校名採自託管 Noto Serif TC 500，校名放大為桌機 50–66px、手機 50px；資訊帶以細分隔線、垂直對齊的三欄整理校名／聯絡／預約，平板與手機分別重排。

字型涵蓋全部目前用字並附來源／授權；六尺寸 × 五校版面、鍵盤及連結共 32 筆檢查、10 項桌機／手機自動輪播檢查、Nuxt typecheck 通過，無 runtime error。原型語法與重打包通過，`preview.html` 無差異。畫面及驗證在 `output/playwright/campus-heading-b/`。已於同日部署正式 web，部署 ID `80d4dfd3-3944-434e-beda-c89cf65cd3ac`；線上 31 項 HTTP 與 32 筆瀏覽器檢查通過，紀錄見 `deploy/README.md`。Safari／iOS 實機未驗證。

## 2026-09-22 活動卡片六組暖色探索（未整合）

新增獨立比較頁 `design/event-warm-palettes-20260922/`：A 蜜糖日光、B 杏桃果茶、C 珊瑚花園、D 玫瑰奶茶、E 陶土午後、F 奶油烘焙，共 18 種暖色。與目前三色並排，保留霧藍背景及由上往下填色，支援個別 hover／手機點擊、全部換色、播放一輪與直接連結。預覽：[B 杏桃果茶](http://127.0.0.1:8769/design/event-warm-palettes-20260922/?palette=b)。尚未套用至 Nuxt 首頁。

Chrome 六款 × 1440／768／390／320px 共 24 個版面及 6 組互動檢查通過，無水平溢出或 runtime error；18 色對深綠文字最低對比為 5.48:1。JavaScript 語法檢查、`node --check app.js` 與 `python3 package_preview.py` 通過，`preview.html` 無差異。截圖與紀錄在 `output/playwright/event-warm-palettes/`；Safari／iOS 實機未驗證，未部署。

## 2026-09-22 活動卡片暖色向下填入

Nuxt 首頁三張活動卡新增 560ms hover 動畫：蜜桃橘 `#F2B592`、杏桃金 `#F0C56F`、玫瑰奶茶 `#E8B1A4` 從上往下覆蓋原色，滑鼠移開後收回。保留深綠文字與原有尺寸；鍵盤聚焦同步換色，減少動態直接呈現結果，手機不殘留 hover，高對比沿用系統色。

本機預覽：[近期活動](http://127.0.0.1:3010/#latest-news)。Chrome 桌機 1440px／手機 390、320px 共 8 組互動檢查通過，涵蓋三色方向、快速反向、活動視窗、Escape／焦點還原、鍵盤、減少動態及高對比，零 runtime error；逐卡截圖另確認上半已換色、下半仍為原色。Node 22 Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 通過，凍結原型 `preview.html` 無差異。證據在 `output/playwright/event-hover/`；未部署，Safari／iOS 實機未驗證。

## 2026-09-22 分校標題與選校列三款置中提案

新增獨立比較頁 `design/campus-heading-20260922/`：A 墨綠古銅、上下置中；B 石墨藍灰、雙語橫式標題與細線選單；C 深松綠香檳金、整合式標頭。三款沿用現行圓角輪播照片與資訊，提供五校互動和桌機／手機截圖，尚未整合至官網。

Chrome 三款 × 1440／768／390／320px 共 12 個版面、60 次切校、鍵盤循環通過；標題與選校列置中、按鈕至少 44px、無水平溢出與 runtime error。檢查與截圖在 `output/playwright/campus-heading-20260922/`，Safari／iOS 實機未驗證。原型語法與重打包通過，`preview.html` 無差異。

## 2026-09-22 分校控制器水滴進場

參考 [Apple iPhone 官網](https://www.apple.com/iphone/) 控制器的進場順序，Nuxt 分校輪播加入 1.2 秒水滴動畫：縱向小水滴上浮、輕壓回彈，延展成進度膠囊並分離出播放鍵，最後顯示圓點與圖示。首次控制列至少 80% 可見時播放一次，回捲不重播；保留現有配色、尺寸、sticky 位置與四秒自動輪播。形變只作用於控制器及裝飾底板，不推動照片或聯絡資訊。

減少動態與高對比模式直接顯示控制列；鍵盤聚焦或進場途中 resize 也立即顯示完成狀態。Chrome 1440／390／320px 的進場、重返、減少動態、高對比及鍵盤共 6 組檢查、原自動輪播 10 項互動檢查均通過，無 runtime error；Nuxt typecheck、4 項時鐘測試與原型語法／重打包通過，`preview.html` 無差異。逐格畫面及紀錄在 `output/playwright/campus-control-droplet/`，修改前快照在 `versions/before-campus-droplet-20260922-104942/`。未部署；Safari／iOS 實機未驗證。

## 2026-09-22 分校輪播自動播放不受滑鼠位置影響

Nuxt `CampusBoard.vue` 移除滑鼠停留造成的暫停：照片進入畫面後每 4 秒自動切校，滑鼠放在照片、校名或控制膠囊上都持續播放。保留播放／暫停按鈕、鍵盤焦點暫停、離屏／分頁隱藏暫停與減少動態設定。

Chrome 桌機 1440px／手機 390px 的 10 項互動檢查通過，無 runtime error；先重現修改前照片 hover 會停止，再確認修改後持續自動切校。Node 22 Nuxt typecheck、4 項輪播計時測試、`node --check app.js` 與 `python3 package_preview.py` 通過，`preview.html` 無差異。證據在 `output/playwright/campus-autoplay-pointer/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 頁首膠囊內距調為 8px

依使用者截圖，Nuxt 首頁深綠膠囊四邊內距由 4px 改為 8px，保留校徽、選單與預約按鈕尺寸。Chrome 1440／900／390／320px 實測 padding 均為 8px，膠囊高度桌機 58px、手機 62px，無水平溢出或 runtime error。截圖與量測在 `output/playwright/header-padding/`；本機預覽 `http://127.0.0.1:3010/`，向下捲動即可看到。

原型 `node --check app.js` 與 `python3 package_preview.py` 通過，`preview.html` 無差異。已以 `bb20ce1` 的內距修改部署正式 web（`d899f96e-d7a3-49e6-ac57-77f32de61932`，SUCCESS）；線上 33 項檢查與四尺寸 8px／選單操作驗證通過，紀錄在 `output/railway-header-padding-20260922/`。

## 2026-09-22 第三次 Railway 部署：官網輪播與轉場上線

將目前確認的分校圓角輪播、四秒切校與社群 icon、手機閱讀高度／拍立得效能、A 無文字淡折角、E 消息紙頁覆疊、A 頁尾霧藍漸退及校徽 favicon 部署到 [正式官網](https://web-production-04caa.up.railway.app/)。web deployment `deb1076d-e531-45bc-924a-928601a815d8` 為 SUCCESS；`/release.json` 對上固定工作目錄快照 `1c000aaf0b655cc233100688f642312f1c44295537fe6af5dcabf0a5568ebaad`。

Node 22.23.2 下前台 typecheck／72 項單元測試／正式建置、後台 16 項單元測試／建置通過；保留既有 Hero calc／clamp 與大型 chunk 建置警告。線上 33 項檢查通過，包括版本、production/live API、CMS、五校 SSR、後台登入與素材上傳／讀取／刪除。Chrome 1440px 桌機、390px 手機模擬的輪播、正反向轉場、JS 備援、觸控、減少動態、拍立得、三個校徽圖檔與後台操作共 40 筆檢查通過，無水平溢出或 runtime error。紀錄：`output/railway-deploy-20260922/`、`output/playwright/railway-20260922/`；Safari／Firefox／iOS 實機未驗證。

本次僅更新 web 服務；API／Postgres 沿用原 deployment，未執行 migration、CMS 發布或初始化。首頁預約入口常駐，五校實際預約設定仍為 paused，搜尋索引與寄信未啟用。快照包含已驗證的未提交前台修改；未 commit、未 push，原型與其他使用者工作保留。

## 2026-09-22 頁尾採用 A「霧藍漸退」

依使用者選定 A，將消息到頁尾的轉場整合至 Nuxt 首頁：頁尾進入畫面時，消息霧藍漸退為頁尾的暖白，紙頁陰影同步消失；往上捲會還原。沿用原有內容排列，使用原生 view timeline 與 JS 備援，手機共用首頁閱讀高度；減少動態直接呈現暖白。

本機預覽：`http://127.0.0.1:3010/#latest-news`，往下捲至頁尾。Node 22 Nuxt typecheck、六項閱讀高度單元測試通過；Chrome 六尺寸 320–1920px、正反向捲動、JS 備援、手機觸控／高度變動、頁面往返與減少動態／強制色彩共 48 筆檢查通過，原有紙頁轉場另 47 筆回歸檢查通過，零 runtime error。證據在 `output/playwright/footer-fade-a/`。Safari／Firefox／iOS 實機尚未驗證，未部署。

改前快照：`versions/before-footer-fade-a-20260922-095616/`；獨立比較頁保留於 `design/footer-transition-20260922/`。原型語法檢查與重打包通過，`preview.html` 無差異；保留其他 session 的設計變更與凍結原型。

## 2026-09-22 官網分頁圖示改為常春藤校徽

Nuxt 官網以現有彩色校徽取代預設 Nuxt favicon，沿用 `SiteHeader.vue` 的 logo 裁切範圍與透明處理，原始 `assets/logo.png` 不變。提供 16／32／48px 多尺寸 `web/public/favicon.ico`、48px PNG 與 180px Apple touch icon；`web/nuxt.config.ts` 統一宣告版本化圖示網址，讓瀏覽器重新載入新圖示。設定依 [Nuxt head 文件](https://nuxt.com/docs/4.x/getting-started/seo-meta)。

驗證：Node 22 Nuxt typecheck、原型語法與重打包通過，`preview.html` 無差異。Chrome 確認首頁／義華分校頁 SSR 與 hydration 後均保留三個圖示宣告，各圖檔回傳 200、可解碼且與本機檔案一致，無 runtime error；圖檔匯出、驗證腳本與報告在 `output/playwright/favicon/`。尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 拍立得採用 A「無文字淡折角」

依使用者選定 A，移除六張拍立得的正反面翻面提示文字；折角改為常態 32px、淡橫線與輕陰影，首次輕掀 26→38→32。CSS 折角移入正反紙面，WebGL 折角畫入相同貼圖，翻轉途中不再有固定在右下的浮層。點擊會中止掀角／偷看，連點反向延續當下彎曲，CSS 改成 1.1 秒平順緩動；保留整卡觸控、鍵盤、accessible name 與減少動態。

本機預覽：`http://127.0.0.1:3010/#day-hello`；獨立 A 預覽同步更新於 `http://127.0.0.1:8768/design/flip-without-copy-20260922/?view=a`。Node 22 Nuxt typecheck、72 項單元測試、原型語法與重打包通過，`preview.html` 無差異。Chrome 桌機 WebGL、無 WebGL CSS 備援、390px 手機觸控、減少動態、鍵盤返回與快速反向皆通過；翻頁中原角落的 canvas alpha 為 0，沒有殘留。腳本與截圖在 `output/playwright/flip-a-subtle/`。Safari／iOS 實機未驗證，未部署。

改前快照：`versions/before-flip-a-subtle-20260922-0952/`。保留其他 session 的設計變更，vanilla 原型維持凍結。

## 2026-09-22 消息到頁尾三版轉場探索（未整合）

依使用者截圖，新增 `design/footer-transition-20260922/`：A 霧藍漸退（優先推薦）、B 頁尾揭幕、C 圓弧收邊，另附現況對照。沿用 Nuxt 實際渲染的消息、照片與頁尾內容，提供桌機／手機、播放、手動捲動、進度拉桿與全螢幕入口；只做獨立提案。B 參考 Olivier Larose 的 Sticky Footer／Framer 官方示範，C 參考形狀交接思路再延伸，來源與轉化界線記在該目錄 README；A 為現有配色延伸。預覽：`http://127.0.0.1:8765/design/footer-transition-20260922/`。

驗證：Chrome 五尺寸 320–2048px × 四版 × 四進度共 80 狀態，以及 JS 備援、減少動態、播放／手動中止、鍵盤進入頁尾、比較頁切換，共 103 筆檢查通過，無水平溢出、圖片失敗或 runtime error。證據在 `output/playwright/footer-transition/`；原型語法與重打包通過，`preview.html` 無差異。未整合 Nuxt、未改 CMS、未部署；Safari／Firefox／iOS 實機未驗證。

## 2026-09-22 首頁採用 E「紙頁覆疊」轉場

依使用者選定 E，新增 `HomeNewsTransition.vue`／`useNewsTransition.ts`，將現行圓角分校輪播與 News 組成連續轉場：消息紙頁從下方覆入、圓角逐漸展平，分校微微後退，暖白整面轉霧藍；往上捲反向還原。沿用正常文件流、原生 view timeline 與 JS 備援，移除舊 News 水平掃色的 composable／CSS／量測標記。保留活動、照片及 dialog，手機上方留白避開膠囊導覽，被完全蓋住的分校輪播會暫停。

預覽：`http://127.0.0.1:3010/#campuses`。Node 22 型別檢查、72 項單元測試與正式建置通過；建置仍提示既有 Hero CSS 的巢狀 calc／clamp 處理警告與大型 chunk。Chrome 六尺寸 320–1920px 共 36 個原生捲動狀態、六個備援狀態，以及觸控、手機高度變動、dialog／Escape／焦點還原、頁尾與頁面往返、減少動態／高對比、隱藏輪播暫停共 47 筆檢查通過，零 runtime error；證據在 `output/playwright/news-paper-e/`。Safari／Firefox／iOS 實機尚未驗證。

改前快照：`versions/before-news-paper-e-20260922-093121/`。本輪保留其他 session 的分校與手機動效變更，原型維持凍結；未 commit、push、部署或修改 CMS。

## 2026-09-22 分校資訊圓角輪播已整合首頁

依使用者確認的 `design/campus-rounded-20260922/`，更新 Nuxt `CampusBoard.vue`：中央大幅圓角照片與兩側預告、精簡五校選單、照片區內隨捲動停靠的進度膠囊與播放鍵，聯絡資訊排列在下方。中文採 PingFang TC 500，英文／電話採 Source Sans 3 400，搭配暖瓷白、墨綠與香檳金。移除照片解說、張數、前後圓鈕及獨立「認識○○校」；LINE／Facebook 加品牌圖示、移除外連箭頭，缺少 LINE 仍顯示待補。

每 4 秒自動切校，支援暫停、鍵盤、圓點與手機橫滑。首頁常駐「預約參觀○○校」，導向 `/visit/:key` 並預選校區；實際預約頁沿用 CMS 模式，**正式預約開放狀態未變更**。本機預覽：`http://127.0.0.1:3010/#campuses`。

驗證：Node 22 Nuxt typecheck、輪播／預約動作 15 項單元測試通過；Chrome 六尺寸 320–1920px × 五校共 30 個版面狀態無水平溢出，照片與預約頁連結、四秒首尾循環、閱讀／鍵盤／離屏暫停、減少動態、手機原生觸控、零／一／二校與恢復五校通過。照片控制列停靠／離開聯絡資訊／與同時更新的消息紙頁轉場銜接通過，0 個 JavaScript runtime error。截圖與紀錄在 `output/playwright/campus-rounded-site/`；Safari／iOS 實機尚未驗證。

修改前快照：`versions/before-campus-rounded-integration-20260922-092539/`。原型語法檢查與重打包通過，`preview.html` 無差異；未 commit、push 或部署。

## 2026-09-22 手機捲動抖動與拍立得效能修正

公開首頁 `web/` 的 Hero、關於及「常春藤的一天」統一閱讀高度，觸控裝置同寬高度變動不再切換動畫模式；保留向上揭幕與浮水印接力，減少捲動中的重複量測與透明度拖尾。手機先顯示可翻面的 CSS 拍立得，停止滑動後才逐張初始化可見卡片的 WebGL，保留紙張彎曲、折角及六張內容。同步快取紙底／文字，修正先翻背面再載入時的標籤鏡像與狀態接手。

驗證：高度 780↔720px 的卡片位移由原版約 396／422px 降為 0px；同機正式 build、手機模擬、CPU 4 倍降速的兩輪連續捲動，最長幀間隔由 150–233ms 降至 33–50ms。這是受控量測，初始化成本移到停止閱讀後，並非全面關閉 WebGL。72 項單元測試、typecheck、正式建置、五種瀏覽器模式與六張卡片翻面驗收通過；原型語法檢查與重打包通過，`preview.html` 無差異。

本機預覽：`http://127.0.0.1:3311`。詳見 [診斷與修正紀錄](docs/analysis/2026-09-22-mobile-motion-audit.md)，原始量測與截圖在 `output/playwright/mobile-motion-audit/`。尚未驗證 iPhone Safari 實機，未 commit、push 或部署；保留其他進行中的設計提案與部署文件修改。

## 2026-09-22 更多網站轉場探索（未整合）

新增獨立研究與互動頁 `design/news-transition-explore-20260922/`，整理 Motto、TrueKind、Guggenheim、Join Talent 的實站截圖與原作者資料，另附 Sweet Home Sweet、Moooi Paper Play 案例。延伸 D 留白展幅、E 紙頁覆疊、F 照片取色、G 照片接棒四款示意，可切桌機／手機、實際捲動或播放。原站觀察、歷史案例與本次轉化分別標示；沒有變更第一輪 A／B／C 或 Nuxt 主站。預覽：`http://127.0.0.1:8765/design/news-transition-explore-20260922/`。

驗證：獨立 headless Chrome 四尺寸 320–1440px × 四版 × 四進度共 64 狀態、JS 備援 12 狀態、比較頁 16 狀態與四版減少動態通過，無水平溢出／runtime error。D 的照片淡出後才顯示消息文字。證據位於 `output/playwright/news-transition-explore/`；尚未驗證 Safari／Firefox／iOS 實機。

## 2026-09-22 近期活動／消息交界三版轉場（未整合）

依截圖的深綠交界與 Wellington College 的捲動揭幕，新增獨立互動提案 `design/news-transition-20260922/`：A 直線揭幕／霧藍、B 圓弧展開／暖米、C 整面漸染／鼠尾草綠。比較頁提供桌機／手機、全螢幕、重播與進度拉桿；內容、照片沿用現行 News，深綠前段僅作截圖情境。未改 Nuxt、CMS 或五校版型。預覽：`http://127.0.0.1:8765/design/news-transition-20260922/`。

驗證：Chrome 五尺寸 320–2048px × 三版 × 四進度共 60 狀態通過，無水平溢出／runtime error；另確認 JS 備援九狀態、反向捲動、播放與手動中止、鍵盤拉桿、dialog／Esc／焦點還原、減少動態與高對比。比較頁四尺寸 × 三版 12 狀態通過。截圖與檢查摘要在 `output/playwright/news-transition/`。原型語法檢查與重打包通過，`preview.html` 無差異。未驗證 Safari／Firefox／iOS 實機，尚未整合主站捲動。

## 2026-09-22 分校資訊圓角影像輪播提案（未整合）

字體與捲動細修：中文標題／校名改為 PingFang TC 500，英文與電話沿用 Source Sans 3 400；暖瓷白、低飽和墨綠與香檳金取代較重的標題與鮮黃。照片區內的控制列改為原生 sticky 靠下，滑到聯絡資訊後隨照片離開。 捲動五種狀態與手機停靠通過；文字對比最低 5.89:1，證據在 `output/playwright/campus-rounded/scroll-style-checks.json`。

同日微調：移除「校園一隅」與照片張數、移除「認識○○校」及暫停預約訊息，改為常態顯示帶入所選校區的「預約參觀○○校」入口，輪播從 6 秒縮短為 4 秒。本輪僅更動獨立提案，正式 CMS 預約狀態未更動。 再依截圖移除左右切校圓鈕，LINE／Facebook 加入既有品牌圖示並移除社群外連箭頭。

依 Apple 產品重點輪播參考，製作獨立互動預覽 `design/campus-rounded-20260922/`：中央大幅圓角照片、兩側相鄰校園預告、上方精簡校名切換、置中膠囊進度與播放鍵，聯絡資訊移到照片下方。延續現有米白／深綠／暖黃與真實五校素材，手機採較直照片比例及左右滑動；尚未更動 Nuxt 的 `CampusBoard.vue`、CMS 或部署。預覽：`http://127.0.0.1:8765/design/campus-rounded-20260922/`，頁面提供現行版對照入口。

驗證：Chrome 六尺寸（320–1920px）× 五校共 30 個版面狀態無水平溢出；鍵盤／圓點／首尾循環、四秒播放與暫停、減少動態、手機原生觸控滑動通過；預約連結帶入所選校區、圖片說明移除後控制列仍置中，零 runtime error。截圖與結果在 `output/playwright/campus-rounded/`。原型語法檢查與重打包通過，`preview.html` 無差異。未驗證 Safari／iOS 實機及 Nuxt 首頁捲動整合。

## 2026-09-21 第二次 Railway 部署：後台改版與官網第二輪設計上線

把 `dc87b16` 的乾淨工作目錄快照部署到 Railway 專案 `ivy-website-admin`（api `f8b105cf`、web `02bd8339`，皆 SUCCESS）。相對於首次部署的基底 `5bc67b1`，本次補上後台導覽與操作體驗改版、UX 審查 P0～P3 缺口、預約與營運相關 backend 調整、手機版適配兩輪、分校資訊版面重構、拍立得折角提示第二輪及 SEO／效能整合。Migration head 仍為 `ce3082c9bf69`，未跑 alembic、未改 CMS 發布資料；五校預約維持 `paused`，搜尋索引與實際寄信未啟用。

驗證：Node 22.23.2 下 `web` typecheck／57 項單元測試／正式建置、`admin` 16 項單元測試／建置、`backend` 122 項測試通過。線上 33 項檢查全通過（`/release.json` 對上快照 `cd3630f6…`、production/live health、CMS release、五校 SSR、未知校區 404、索引關閉、五校 paused、後台直接路由與 assets、登入與 Secure HttpOnly cookie、素材上傳／讀取／刪除、登出失效），紀錄在 `output/railway-smoke.json`；桌機 1440 與手機 390px 瀏覽器檢查首頁 200、無水平溢出、後台登入與內容編輯頁正常、0 個 JavaScript runtime error，截圖在 `output/playwright/railway2-*.png`。未 commit、未 push，vanilla 原型與 `preview.html` 未動。

## 2026-09-21 拍立得翻面提示第二輪：折角做真＋首張偷看

依 `design/flip-cue-directions-20260921/` 五欄對照（現行／折角做真／文字圖示加重／合併／偷看）使用者選定第 3 欄：相紙右下角真的切掉並掀起一片背面橫線紙（CSS 版 `clip-path`、WebGL 版貼圖挖空＋`alphaTest`），顯影完成後折角自己掀一次；提示字 13px／500 加虛線底，圖示改為左右翻／U 型回頭；首張拍立得掀角後向左微翻 12° 回正一次（每次工作階段一次，減少動態不做）。相紙陰影改由 `.print::after` 承接。規則見 `DESIGN.md`「拍立得顯影」的翻面一節。

驗證：`nuxi typecheck` 通過；Playwright 在既有 dev（3013）桌機 1440 與手機 390 的 WebGL 版：提示文字／圖示隨翻面切換、`--ear` 30→44、翻面後折角換色、`sessionStorage` 旗標寫入、無 console 錯誤；關閉 WebGL 的 CSS 版 3.4 秒掀角、5 秒 `is-peeking`；`reducedMotion: reduce` 折角固定 44、無掀角無偷看。截圖與腳本在 `output/playwright/flip-cue-site/`。未驗證：Safari／iOS 實機、Firefox；手機右下「暫停背景」浮鈕與提示字距離很近是原有版面，未在本輪處理。快照 `versions/before-flip-cue-20260921-213531/`，vanilla 原型與 `preview.html` 未動，未 commit。

## 2026-09-21 分校資訊版面與閱讀優化

Nuxt 首頁沿用無線稿 B 的左右分景、五校橫列及六秒膠囊輪播。選取校區增加淡綠底與清楚底線；左側資訊欄上限 640px，校名收斂至最高 72px，地址、電話、社群及播放提示放大並提高對比。左側資訊與控制列改用正常 Grid 排列，控制列有獨立分隔與空間，內容較長時自然延伸；手動暫停的提示優先於滑鼠閱讀狀態。照片圖說改用局部深綠底、移除底部整片漸層。

900px 以下改成照片在上：761–900px 將校名與分校入口、聯絡方式分成雙欄；手機單欄，英文副標可自然換行，五校仍一列、互動高度至少 44px。保留各校圖片與裁切設定、地址地圖、電話、社群及共用 BookingCta 的預約狀態。

驗證：Nuxt typecheck、既有輪播與預約動作 15 項測試通過；Chrome 9 種視口 × 五校 45 個版面狀態、鍵盤、圓點、自動循環、暫停續播、離屏與減少動態通過。手機觸控與攔截回應的開放預約 CTA 通過，沒有真實送出。三尺寸 × 五校圖說背景像素抽樣最低對比 7.89:1，次要文字 4.84:1；這不是全站無障礙認證。證據在 `output/playwright/campus-refine/`，實際互動預覽為 `http://localhost:3013/#campuses`。原型語法檢查與重打包通過，`preview.html` 無差異；Safari／iOS 實機尚未驗證。修改前快照 `versions/before-campus-ux-refine-20260921-212956/`，未 commit、部署或修改 CMS。

## 2026-09-21 手機版第二輪：顯影提速、小字與殘留空白

以五校 fixture 在 390／320px 重拍後，補上第一輪手機動線之外的細節：拍立得手機顯影從 3 秒縮到 1 秒內（CSS 與 `paperPrints.ts` 的 WebGL 版同步，桌機不變）；拍立得 kicker、翻面提示提高到 12px、相片角落說明 11px；seam=2 手機浮水印壓淡、「閱讀完整介紹」按鈕帶底色避免被大字疊住；膠囊選單五校連結補到 44px；分校內頁「交通與聯絡」移除為不存在的線稿預留的 128px 空白。規則見 `DESIGN.md`「手機第二輪」。

驗證：`web` 型別檢查與 57 項 vitest 通過；Playwright 390／320px 首頁各區、選單、預約頁（未選校／明華暫停）、義華內頁各區共 24 張截圖，無 console 錯誤、無水平溢出、可見點擊目標無低於 40px 者；改前後對照與量測在 `output/playwright/mobile-ux2/`（`before-*`／`after-*`）。本輪與另一個 Codex session 同時改同一 checkout，動手前有先確認其寫入已停止；改前快照 `versions/before-mobile-ux-20260921-212330/`。未 commit、未動原型與 `preview.html`。

## 2026-09-21 分校 B 排版與膠囊輪播控制

依使用者參考圖，Nuxt 首頁分校輪播改為左欄底部的灰米色膠囊：目前校區展開成倒數長條，其餘為可點選圓點，旁邊獨立圓形播放／暫停鍵。上方保留水平五校名稱，移除原分段跑條；保留每校 6 秒、自動循環與減少動態設定。滑鼠／觸控切校後重新倒數，鍵盤聚焦暫停。左欄改用對齊的聯絡列與描邊分校入口，暫停預約訊息以較輕的文字樣式呈現；維持右側滿版照片、無線稿，手機與窄平板另調間距。

Chrome 五尺寸 × 五校 25 狀態、圓點／鍵盤／觸控切換、自動循環、暫停續播及開放預約狀態的排版通過；`web` typecheck 通過。截圖與檢查結果：`output/playwright/campus-capsule/`；五校互動預覽：`http://127.0.0.1:3012/#campuses`。只調整 `CampusBoard.vue` 與設計文件，沿用目前共用 BookingCta 狀態及響應式圖片，未更動 CMS 或部署。

## 2026-09-21 手機 UI/UX 第一輪

公開官網 `web/` 的預約頁改為常駐校區選擇，通用入口不再預選第一校；暫停、電話、LINE 或外部預約模式仍能更換校區，並顯示所選校區真實的聯絡方式。切校保留已填內容、清除過時錯誤與時段選取；送出與讀取中避免使用舊校設定。不可操作的預約提示改為一般狀態文字。

手機首屏新增「找校區」捷徑；關於介紹沿用 CMS 第一個完整句子作摘要，完整文字可展開，桌機仍完整顯示。缩短手機關於進場留白、接力簾幕距離、拍立得間距，保留六個片刻。沿用最新分校輪播，照片與大校名可進入對應校區，非當前照片設為 inert。

驗證：Node 22 的 Nuxt 型別檢查與 57 項單元測試通過；隔離五校預覽驗證五種預約模式、快速切校、輸入保留、送出失敗復原、摘要展開／收合、照片連結與減少動態。手機 320／375／390／430、平板 768 與桌機 1440px 檢查無水平溢出。表單送出使用瀏覽器攔截，不寫入真實資料。截圖、操作腳本與量測：`output/playwright/mobile-ux-implemented-20260921/`；Safari／iOS 實機與正式部署尚未驗證。原型語法檢查與重打包通過，`preview.html` 無差異。本輪未 commit、push、部署或修改 CMS 發布資料。

## 2026-09-21 拍立得改用折角翻面提示

Nuxt 官網移除「翻到背面」角落貼籤，改成相紙折角與無底框的「點照片，看看背面」提示；整張卡片可點，翻後提示可再點回照片。桌機 hover 微掀折角，手機常駐；原生按鈕提供 Enter／Space、整卡焦點框與正反面無障礙狀態。標題恢復完整寬度，提示另留底部空間。

驗證：`npm --prefix web run typecheck`、`node --check app.js` 通過，`python3 package_preview.py` 重打包無差異；Chrome 1440／390／320px 點擊或觸控、Enter／Space、正反面與減少動態 CSS 回退通過，無水平溢出與 pageerror。截圖與驗證腳本：`output/playwright/flip-corner/`。僅更新本機 Nuxt 版本，未部署。

## 2026-09-21 官網 SEO／GEO、載入效能與匿名量測

Nuxt 公開頁補齊分享圖片、Twitter card、機構／Preschool／麵包屑 JSON-LD；canonical origin 僅接受 HTTPS 部署設定。頁面與 sitemap 改走同一份已發布 release，保留無共享 HTML 快取及失敗 503；預約、後台與預覽維持 noindex。以精確原文比對修正舊提案的 description、FAQ、頁尾與錯誤的表單同意說明，保留 CMS 自訂內容及示意消息標示。正式網域與招生資料未確認，不開啟線上索引、不編造內容。

新增響應式 WebP／寬高、按頁首圖 preload、WOFF2 與手機影片；影片保持長度與母檔，hero 手機檔減少約 53%、day 桌機 50%、day 手機 65%。保留最新五校輪播修改，接入響應式圖片、校區連結與聯絡追蹤。WebGL 接近視窗才載入，慢速／省流量停用自動影片與 WebGL。另修正首屏動效初始化的版面位移，四視口本機檢查均低於 0.1；下方背景影片等進入主要閱讀區才載入。

新增 `web-vitals` 與同源匿名事件日誌、p75 彙整及唯讀 SEO 檢查指令；不新增 DB、migration、外部分析服務或持久訪客識別碼，既有後端需求／確認事件仍為招生計數權威。驗證、外部帳號待辦及五校待補清單：[維護與驗收文件](docs/website-admin/seo-performance.md)。本輪未 commit、push 或部署。

# 常春藤官網互動提案

2026-09-21：使用者選定無線稿 B 並要求自動播放，已整合至 Nuxt `web/app/components/CampusBoard.vue`：滿版左右圖文、上方水平五校與分段進度，每校 6 秒、最後一校回到第一校；保留圖示、地址地圖、各校 BookingCta 與既有分校內頁連結。可手動切校及暫停；滑鼠進入閱讀／校名區、鍵盤聚焦、分頁隱藏或區塊離開畫面時停止，返回後續播。減少動態預設不自動播放；只發布一校時不啟動輪播。新增 `carouselClock.ts` 與 4 項計時測試，連同預約動作共 15 項通過；Chrome 四尺寸 × 五校 20 狀態與實際自動循環／暫停／鍵盤／減少動態通過，`web` typecheck 通過。結果與截圖：`output/playwright/campus-live/`。完整五校 fixture 預覽在 `http://127.0.0.1:3012/#campuses`（獨立暫存副本）；原 3010 的 live release 目前只有明華校，未更動 CMS 發布資料。原型重打包無差異。

2026-09-21：UX 審查的 P3 收尾（`admin/` 與 `backend/`）。案件列表新增家長姓名／電話搜尋：後端 `GET /admin/visit-requests` 收 `q` 參數，姓名用 `ilike`、電話用 `like`，使用者輸入的 `%` 與 `_` 會跳脫成字面值（否則一個 `%` 就撈出整個校區），比對接在既有校區權限之後，不會變成跨校查人的後門；前端搜尋框放篩選列最前面，停止輸入 300ms 才送出，查無結果的文案帶上關鍵字，清除篩選會一起清掉。手機版案件卡補上「參觀時間」，先前只有桌機表格有這欄，已確認的案件在手機仍看不到約在哪天幾點。手機搜尋框改占整行，原本被壓到 130px 導致提示文字被截。儲存即生效的兩頁補上區分：全站設定的搜尋引擎開關從兩側都有文字的 `el-switch` 改成單一勾選「暫時不讓 Google 收錄（上線前）」，說明改排在下方與其他欄位一致，儲存鈕從「儲存」改成「儲存並套用到官網」；該頁與各校預約方式的儲存鈕旁都加上一行「沒有草稿階段，儲存後官網立即套用」，共用 `style.css` 的 `.save-row`／`.live-note`。

驗證：後端 122 項 pytest（新增搜尋命中、萬用字元當字面值、跨校不外洩三項）、前端 16 項 vitest（新增搜尋延遲送出與 `q` 參數一項）、型別檢查與 `npm run contract:check` 通過。另起 8001 後端與 5175 前端對 `ivy_website_dev` 實測四筆案件：全部 4 筆、搜姓名 1 筆、搜電話片段 1 筆、查無結果文案、兩頁的立即生效提示、手機卡片的參觀時間與整行搜尋框，無 console 錯誤、390px 無水平溢出，截圖在 `output/playwright/admin-p3/`。驗證用帳號、四筆案件、時段已刪除，義華預約模式還原為暫停。CSV 匯出沿用原本的校區篩選，未跟著帶入搜尋關鍵字；列表排序仍固定為送出時間新到舊。

2026-09-21：側欄改成兩層（`admin/`）。原本「官網內容」是一個 11 項的大組，其中「首頁五校區塊／五校介紹／校園探索」名字都帶校區，攤在一起難辨認。現在拆成首頁（4 項）、分校頁（3 項）、全站與素材（4 項）三個各自可收合的子組，共用一個「官網內容」區段標題並縮排，`NavGroup` 新增 `section` 欄位；頁首麵包屑改顯示區段名，內容頁仍標「官網內容」。收合狀態存進瀏覽器（`ivy-admin-nav-expanded`），下次進來沿用，讀寫都包 try／catch，私密視窗讀不到就回預設。搜尋改成功能名優先：搜「素材」只給素材庫，功能名都沒中時才用分組或區段名比對，讓搜「分校頁」仍能看到整組。

驗證：15 項 vitest（新增兩層結構與收合記憶、搜尋優先序兩項，並把既有兩項對齊新的分組 id）、`vue-tsc` 型別檢查通過。jsdom 這個設定下的 `localStorage` 只是空物件，測試檔自備最小 Storage 實作，`afterEach` 清掉避免互相影響。Chrome 實測 1440px 的收合、全展開、重新整理後維持展開、搜尋、從內頁自動展開對應子組與麵包屑，以及 390px 抽屜：收合後整個選單一屏放得下，原本 20 項要捲才看得到「操作紀錄」。無 console 錯誤，截圖在 `output/playwright/admin-nav2/`。驗證用帳號已刪除，未改動任何內容或預約資料。

2026-09-21：官網後台第三輪，補上 UX 審查找到的 P0／P1 缺口（`admin/` 與 `backend/`）。P0：已確認的案件先前只存 `slot_id`，明細與列表都看不到「約在哪一天幾點」，櫃台接到家長來電答不出來。後端 `VisitRequestDetailOut` 新增 `slot`（`VisitSlotBriefOut`：日期與起訖），案件查詢、家長端換 session／讀自己案件的查詢全部補 `selectinload`，確認與改期改為指派 relationship，回應當下就帶新的參觀時間；前端明細標題下方顯示「參觀時間」，列表新增該欄，家長填的偏好改名「家長方便時段」以免混淆。P1：確認預約、發布內容兩個對外且不可回退的動作補確認對話框（寫明排給誰、哪一天、會寄通知／官網目前是哪一版），停用使用者改用就地 popconfirm。總覽補「今天的參觀」清單（誰、幾點、哪一校，點進案件）與草稿直達連結，後端 dashboard 新增 `today_visit_list` 與 `pending_publish_kinds`。另修 `style.css` 對 `.el-message-box` 只覆寫 `max-width` 導致對話框在桌機撐成整行的問題，全站確認框一併回到 420px 置中。

驗證：後端 119 項 pytest（新增參觀時間展開、總覽清單兩項測試，對真 PostgreSQL）、前端 13 項 vitest、`vue-tsc` 型別檢查、`npm run contract:check` 全部通過。另起 8001 後端與 5175 前端對 `ivy_website_dev` 實測：總覽今日清單、案件列表欄位、明細參觀時間、兩個確認對話框、停用就地確認、手機 390px 版面，無 console 錯誤、無水平溢出，截圖在 `output/playwright/admin-p0p1/`。驗證用帳號、案件、時段已刪除，義華預約模式已還原為暫停。未實機驗證：草稿直達連結（dev 資料當時沒有未發布草稿，由後端測試覆蓋）。側欄與總覽版面為同日第二輪的既有工作，本輪未改動。

2026-09-21：完整官網與後台首次部署至 Railway 獨立專案 `ivy-website-admin`：官網 `https://web-production-04caa.up.railway.app/`，後台 `/admin/`。建立獨立 PostgreSQL 及 API 素材 volume，初始化五校與 18 筆 CMS 內容；四校未定巡覽維持待補。新增 Docker 部署設定、同源後台 history 路由與不覆蓋既有草稿的內容初始化工具，並修復 admin lockfile 的 esbuild 解析不一致及 API 降權後的家目錄設定。上線版本為固定工作目錄快照，部署期間新增的其他本機修改未自動併入。預約預設暫停，搜尋索引與實際寄信未啟用。維運與部署資訊見 `deploy/README.md`；線上 HTTP／登入／素材上傳清理驗證在 `output/railway-smoke.json`，瀏覽器截圖在 `output/playwright/railway-*.png`。

2026-09-21：無線稿分校 B 版改為上方水平五校，搭配 IG 限時動態式分段進度與照片短淡入；由捲動或點校名控制，手機維持五校一列。沿用 `design/campus-fullscreen-20260921/stage.html?direction=b`，僅更新此 mock-up；新增的 `b-stories.css`／`b-stories.js` 不套用到 A／C 或線稿探索頁。四種尺寸共 28 個狀態、原生／備援進度 18 個位置及鍵盤／減少動態皆通過。

2026-09-21：官網後台第二輪 UI/UX 優化（`admin/`）。側欄加入功能搜尋與分組收合，官網內容分成首頁／分校頁／全站與素材，並記住收合狀態；搜尋沿用角色限制；900px 以下改用 Element Plus 抽屜，支援 Esc 與焦點還原。總覽調整為營運摘要、待辦提醒與常用工作。內容編輯補強草稿／發布說明、處理中鎖定與載入狀態；修正取消離開時分頁標題誤變。案件列表增加清除篩選、可鍵盤開啟的家長連結、手機清單及過時回應保護；素材庫加入檔名／說明搜尋、重試與空狀態入口。全站調整文字對比、表單高度及窄螢幕對話框。未儲存的瀏覽器驗證文字均已還原。

驗證：本次提交內容以獨立副本執行 14 項單元測試、型別檢查與 production build 通過；Chrome 實測桌機、1024px、390px 與 320px 的相關畫面，包含導覽搜尋、手機抽屜、未儲存離開／取消／還原、素材搜尋重設與上傳對話框；量測的 1024／390／320px 頁面無水平溢出。沒有送出草稿、發布、上傳或改動預約資料；案件／素材庫當時為空，實際有資料列表與 Safari／Firefox 尚未驗證。build 仍提示單一 bundle 超過 500 kB。原型語法檢查與重打包通過，`preview.html` 無差異。本機 `.env.local`（不進版控）將官網連結指向當下運行中的 `http://localhost:3010`。


2026-09-21：接續 B 滿版分校提案，新增 B4「建築融景」mock-up：線稿融入米白背景並銜接照片邊緣，五校照片與線稿同時切換；手機改為上下融合。入口 `design/campus-b-blend-20260921/` 可對照原版 B，仍為探索稿，未整合至 Nuxt 首頁。

2026-09-21：Railway 部署前檢查修正 `web/app/utils/paperPrints.ts` 的 nullable three.js 型別：保留載入失敗退回 CSS 的行為，在成功載入後保存非 nullable 的模組參照供內部函式使用。Node 22.23.2 下前台型別檢查、38 項單元測試及正式建置通過；後台正式建置與 7 項單元測試通過。原型語法檢查與單檔重打包通過，`preview.html` 無差異。

2026-09-21：使用者選定分校滿版捲動的 B「左右分景」，接續提供建築線稿三款位置比較：B1 左欄底景、B2 校名標記、B3 照片下緣圖帶，位於 `design/campus-b-lineart-20260921/`。線稿跟著五校切換，含桌機／手機預覽；本輪仍為線稿位置探索，尚未整合至 Nuxt 首頁。

2026-09-21：新增首頁分校區「滿版＋捲動切校」三款獨立 mock-up：A 全景換幕、B 左右分景、C 橫向校園長廊，位於 `design/campus-fullscreen-20260921/`。比較頁可切桌機／手機，各款可獨立滿版試滑；保留目前的圖示、地址地圖與無句號校名。尚未選定或整合至 Nuxt 首頁。

2026-09-21：Nuxt 首頁分校資訊帶依截圖修正：移除校名後的黃色句號，恢復校園位置、參觀專線、LINE 與 Facebook 圖示；將 Google Maps 動作整合至地址文字（底線與外連箭頭），移除預約下方獨立的「查看位置與路線」。沿用 B 版校名大小、三欄配置與手機單欄，僅修改 `web/app/components/CampusBoard.vue`。

驗證：Playwright 1440／1024／390／320px × 五校共 20 組，圖示顯示、地址隨切校更新、無水平溢出與鍵盤焦點通過；地圖另開分頁以本機攔截外部回應驗證。截圖與結果在 `output/playwright/campus-contact-*`。`node --check app.js`、原型打包與 `git diff --check` 通過，`preview.html` 重打包後無差異；`web` 型別檢查受既有 `paperPrints.ts` 的 `three` 可能為 null 錯誤影響。

2026-09-21：修正 Nuxt 首頁「常春藤的一天」背景影片播放中卻只顯示靜態封面的問題：`DayExperience.vue` 補上獨立的影片就緒狀態，在 `playing` 後套用 CSS 既有的 `is-ready` 淡入；暫停時保留目前影格，播放失敗時仍使用封面。Chrome 實測桌機與 390px 手機版的顯示、播放、暫停／恢復、捲離／返回皆通過；38 項單元測試通過。

2026-09-21（續）：翻面鈕再縮小，三方向比稿（`design/flip-button-mockup-20260921/`：A 迷你膠囊、B 圓形圖示鈕、C 角落貼籤）後使用者選 C：28px 高、4px 圓角、微歪 2°，淺色紙感毛玻璃（米白 72%＋`blur(12px)`）＋綠字，圖示移到字前，像貼在相紙角的標籤；翻到背面轉深綠 80%、歪向另一邊、圖示鏡翻；手機 26px 並用 `::before` 補到 44px 觸控範圍。`DayMomentCard.vue` 圖示與文字順序對調。截圖 `output/playwright/flip-glass/site-c.png`、`mobile-front.png`。

2026-09-21：Nuxt 首頁拍立得翻面鈕改毛玻璃（`web/app/assets/css/styles.css` `.print-flip`）：沿用首屏影片鈕與頁首膠囊的配方——墨綠 62% 底、`blur(16px) saturate(1.3)`、白色細框、徽章改半透明白；hover 底色加深到 78%、徽章轉金；翻到背面加深到 84%。偏好減少透明度時回退實色綠／深綠。Playwright 截圖 `output/playwright/flip-glass/`。

2026-09-21：Nuxt 首頁「常春藤的一天」拍立得翻面鈕改版（`DayMomentCard.vue`＋`styles.css` `.print-flip`）：文字箭頭「↻」換成 Phosphor `i-arrow-counter-clockwise` 圓形徽章，膠囊去硬邊線改貼紙感陰影、字級 11→12px 半粗；hover 徽章轉暖黃並微抬、按下徽章縮一下；翻到背面後整顆反白成深綠＋黃徽章、圖示水平鏡翻，狀態一眼可辨。拿掉與 `aria-expanded` 重複的 `aria-pressed`。減少動態與強制色彩模式同步補上。驗證：Playwright 1440／390 三態截圖 `output/playwright/flip-btn/`，無 console 錯誤。

2026-09-21：Nuxt 首頁（`web/`）展開導覽選單套用與頁首膠囊相同的深綠毛玻璃：墨綠 74% 不透明度、16px 背景模糊與亮色細框；保留導覽、五校與電話排版。不支援背景濾鏡或使用者偏好減少透明度時，回退實色綠底。選單最大寬度保留左右各 16px，修正手機被原有 420px 最小寬度裁切的問題。

2026-09-21：Nuxt 首頁（`web/`）「孩子的一天」拍立得改用比稿 R 的 three.js 紙張翻面（`web/app/utils/paperPrints.ts`＋`DayMomentCard.vue`）：翻面時紙張彎曲抬升、光影與游標微傾、顯影在貼圖裡進行。單一 WebGL context、貼圖樣式從 DOM 取、減少動態／無 WebGL 退回 CSS 版；three 0.186 為 `web/` 新依賴、延遲載入。vanilla 原型與 `preview.html` 不動。規則見 `DESIGN.md`「Nuxt 版改用 WebGL 紙張翻面」。

2026-09-21：Nuxt 首頁（`web/`）「常春藤的一天」補回原型的捲動行為：拍立得列表靠近時大標與 kicker 淡成底紋（`--word-fade` 從 1 降到 .16，對齊 app.js 的 `fadeBehindContent()`），並標出讀者停在哪一段讓該張相片時間戳亮起（`is-active`，對齊 `markActive()`）。改在 `DayExperience.vue`／`DayMomentCard.vue`，CSS 原本就有留 `opacity:var(--word-fade,1)`。

2026-09-21：Nuxt 首頁「近期活動／最新消息」移除三張活動卡及「所有活動／所有最新消息」的斜箭頭，採純文字與細底線，保留整卡點擊、鍵盤焦點及既有捲動換色。

2026-09-21：官網後台（`admin/`）整體 UI/UX 改版。原本 `style.css` 仍是 Vite 範本（紫色強調、18px、`#app` 置中加邊線），頂欄塞了 11 個連結，校區／狀態／角色都顯示原始代碼。現在：淺色主題、品牌深綠當 Element Plus primary、暖黃只用在「有未儲存或未發布」狀態；左側分組側欄（總覽／參觀預約／官網內容／系統）＋頂欄，900px 以下收成抽屜；`admin/src/api/labels.ts` 集中中文標籤與台北時區時間格式；十個內容編輯頁共用 `ContentEditor` 外殼（狀態列、載入骨架、黏底動作列、「儲存並發布」、還原修改、未儲存離開攔截）；分校內容切校前先確認；案件列表／明細／時段／通知／統計／稽核／素材庫全部改中文狀態、空狀態與確認對話框；素材庫改網格＋拖曳上傳。單元測試 `admin/src/__tests__/`（vitest，7 案例），Playwright 截圖與互動驗證在 `output/playwright/admin-ux*`。改前快照 `versions/before-admin-ux-20260921-152825/`。根目錄 vanilla 站與 `preview.html` 未動。

2026-09-21：首頁分校資訊帶採用使用者選定 B「校名主場」：放大 LINE Seed 校名、暖黃句點、低調地區與英文副標，聯絡資訊收成一欄，社群退為文字連結，預約按鈕採暖黃膠囊；手機改單欄。保留照片、切校與 BookingCta 設定，原型不回寫。


2026-09-21：Nuxt 首頁（`web/`）的「分校資訊 → 近期活動／最新消息」改為捲動連動的垂直換色。配色採用使用者選定的 A「霧藍（#DCE7EB）＋暖白（#FAF7EF）」：霧藍由上往下滑入暖白底，搭配深綠文字；同一道水平邊界掃過活動卡時，卡片同步由上到下換成暖黃／嫩綠／霧青。往上捲時效果退回，取代先前每張卡依滑鼠方向滑動的方式。原生 CSS view timeline 優先，不支援時用 passive scroll＋requestAnimationFrame；手機亦可捲動操作，減少動態與高對比模式使用靜態版。保留照片、整卡點擊與消息視窗。根目錄 vanilla 與 `preview.html` 維持已凍結原型，這次預覽請啟動 `web/`。

2026-09-18（晚）：頁首品牌的 30 週年版三個方向比稿在 `design/anniversary-directions/`（a 印章／b 第三行年份／c 上標小籤），1997 創校、2027 滿 30 年；都跑在主站真實頁首上，用 `index.html?anni=a|b|c#/home` 切換，膠囊與手機共用校徽右下角的金色「30」小點。「週年」兩字另切了 `assets/fonts/noto-sans-tc-600-anni.woff`。

2026-09-18（晚）：首屏那顆「預約參觀」CTA 改成**金色滿高色塊、貼齊視窗右緣、左下 44px 弧**（比稿代號 d9，已上站）。原本它和四個導覽項共用同一套雙行排版、只多一個框，會被讀成第五個導覽項，圖示還用了語意相反的打勾；現在與捲動後的黃膠囊同色，整條動線只剩一種長相，圖示換成日曆勾。貼邊是把 `.header-top` 在 901px 以上改成滿版、左邊補回 gutter，900px 以下退回金色膠囊（手機右邊還有漢堡）。同日把分校頁與預約頁也換成同一顆（原本是綠色圓角鈕），全站頁首現在只有一種預約鈕；人在預約頁時該連結帶 `aria-current="page"`。兩輪比稿（a–e 選色與形制、d1–d12 形狀、可調版 dx）的截圖與取捨留在 `design/book-cta-directions/`，`?book=` 參數與調校頁已隨定案移除。單檔 `preview.html` 已同步。

2026-09-18：首頁捲過首屏後，整條頁首讓位給置頂居中的深綠膠囊（校徽＋校名、選單、暖黃預約參觀），導覽四項收進膠囊的選單卡；只作用在首頁，分校頁與預約頁維持原樣。膠囊底色選深綠是因為首頁捲過首屏後的背景全是淺色，米白膠囊的邊界對比只有 1.0–1.4。三個方向的比較與大小／顏色調校頁在 `design/header-collapse-directions/`，規則見 `DESIGN.md`。單檔 `preview.html` 已同步；改前快照 `versions/before-header-pill-20260918-083004/`。同日修正膠囊「選單」文字被站內 `.menu-toggle span` 壓成白條的跑版，並依園方「置中太突兀」的回饋做了五種擺法比較（`design/header-collapse-directions/placement.html`，`index.html?pill=…` 可切），園方選定**整顆靠右**，已套成預設（右緣貼內容欄右緣）；其餘擺法保留為 `?pill=` 預覽參數。收合時機同日再改為**往下捲第一步（40px）就收**，不再等整段首屏揭幕結束；首屏頂部為導覽字而設的暗帶同步收掉，膠囊才不會融進照片。另做了「向下捲收起、向上捲出現」的 mock-up（`design/header-collapse-directions/autohide.html`，`index.html?autohide=1` 可切，含並排即時預覽與對照 GIF），同樣尚未套成預設。

2026-09-17：首頁已套用「首屏向上揭幕」轉場與淡綠品牌介紹。依上午回饋，品牌區改為左文右圖並放大照片，修正舊有 740px 最小高度與 680px 停用門檻造成筆電 100% 縮放無動畫的問題。下滑時影片與標語縮淡，再揭開「把每個孩子，放在心上」；手機縮短轉場，減少動態或首屏內容實際超過畫面時維持一般捲動。單檔 `preview.html` 已同步更新；原提案留在 `design/scroll-reveal-mockup/`。
2026-09-17（晚）：導覽列離開首屏後收進漢堡選單的三個互動 mock-up 在 `design/header-collapse-directions/`（A 同組收合、B 浮動膠囊、C 極簡列＋全幕選單），比較頁可切桌面／手機、跳狀態、模擬減少動態；截圖在同目錄 `shots/`，可分享的 Artifact：https://claude.ai/artifact/KwzBCVQSYgew8XB5cmbGhm 。使用者選 B 後另做 `b-tuning.html`：膠囊三檔尺寸×四種色調疊在真實首頁背景條上比較（附對比度）。**深綠 × M 已於 2026-09-18 套用主站**。


2026-09-16：分校資訊已套用 B「全幅橫景」版面，上方寬幅校舍照片，下方整合校名、聯絡方式、預約與小地圖。五校線稿放在標題右上並同步切換，移除樹木圍牆裝飾；手機改為直向排列。照片與線稿已內嵌到單檔預覽。提案在 `design/campus-layout-mockups-20260916/`、線稿來源在 `design/campus-line-art/`，設計規則見 `DESIGN.md`。

直接開啟 `preview.html` 即可預覽，照片、logo、CSS 與 JavaScript 都已內嵌，不需要安裝套件。外部官網、電話與地圖連結仍依裝置及網路運作。

可維護版本為 `index.html` + `styles.css` + `app.js` + `assets/`，可直接開啟 index.html 或執行：

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

再瀏覽 http://127.0.0.1:8765/ 。這是本機預覽，尚未發布網站。

## 版控

本專案使用 Git，主分支為 `main`。程式碼、素材、設計文件與 `design/` 提案均納入版控；`versions/` 保留導入 Git 前的歷史快照，之後的修改以 commit 記錄。

`preview.html` 是供直接開啟的單檔交付版，也納入版控。修改網站原始檔後，請重新打包，並把原始檔與單檔版一起提交：

```sh
node --check app.js
python3 package_preview.py
git status --short
git diff --stat
git add <本次修改的檔案> preview.html
git diff --cached --stat
git commit -m "說明本次修改"
```

`git add` 中的 `<本次修改的檔案>` 請替換為實際路徑。可用 `git log --oneline` 查看版本紀錄；開新工作前可用 `git switch -c feat/功能名稱` 建立分支。

`.gitignore` 排除本機工具設定、瀏覽器紀錄、`output/` 畫面記錄、快取與環境私密設定。初始設定為本機版控；遠端位置可用 `git remote -v` 查看。

## 已製作

- 左上完整原始 logo、右上預約入口、手機導覽。
- 影片封面、品牌介紹、孩子的一天、分校資訊、A 版近期活動與最新消息，接續頁尾。
- 影片首屏與淡綠品牌區之間的捲動揭幕；原生 CSS 動畫優先，未支援時使用 JavaScript 備援。首屏完全離開時暫停影片，回來時保留使用者的播放／暫停選擇。
- 義華、明華、崇德、國際、仁武各自的介紹頁、官方照片、地址電話、Google 地圖連結。
- 獨立預約頁，先選校、再填寫聯絡資料；從校區進入會自動帶入該校。
- 表單驗證、返回修改、更換校區、示範結果；不發送請求、不存入 localStorage。
- 照片放大，鍵盤 Esc 關閉後將焦點還給原按鈕。

## 待補內容與限制

- 使用者尚無影片。目前呈現義華校照片，並標示「影片封面示意」。不顯示假的播放按鈕。
- 要換影片：將影片放在 assets/，把 app.js 頂部 `HERO_VIDEO_SRC` 設成例如 `assets/campus-film.mp4`。已有靜音、暫停／播放、載入失敗封面，以及減少動態偏好處理。實際影片與各裝置播放相容性需在素材提供後再驗收。
- 五校基本地址、電話、外觀照片取自官方；各校詳細課程、招生名額、收費、參觀時段仍待園方提供。沒有把義華課程或照片當成其他校區資訊。
- 首頁品牌標語是設計提案文案，正式使用前請園方確認。
- 預約只顯示測試結果，不寄信、不連資料庫、不建立實際預約。
- 已於瀏覽器桌面、平板、手機尺寸驗證；尚未於實體 iPhone / Android 做裝置驗收。

## 來源

- 使用者提供：原 prototype `/Users/yilunwu/Downloads/preview.html`、完整常春藤 logo 圖片。
- 常春藤義華校：https://www.ivykids.tw/ （首頁生活照片、教育理念、活動與校園環境）
- 常春藤機構：https://www.ivykidschool.com/ （五校地址電話、明華／崇德／國際／仁武照片）
- 首頁影片呈現參考：https://seasonarts.org/ ，沒有使用其影片或品牌素材。
- 下載照片已轉為 WebP，照片來源見 assets/sources.json。

## 驗證記錄

- JavaScript 語法檢查通過。
- 首頁 375 / 390 / 768 / 1024 / 1440px 無水平溢出。
- 375 / 768 / 1440px 校區頁、選校頁、填表頁無水平溢出。
- 五校路由、各校圖片、各校自動帶入預約入口通過。
- 選校→填表→預覽→修改→更換校區流程通過。
- 無效輸入阻擋、手機空格與連字號正規化、離開後資料清除通過。
- 手機選單展開／關閉、相簿 Esc 關閉／焦點恢復通過。
- 操作檢查中未發現 JavaScript runtime error。

畫面記錄位於 output/playwright/。修改可維護版後，執行 `python3 package_preview.py` 重新產生單檔版本。

## 新增：孩子的一天

首頁「校園生活」現在會進入六片刻的互動故事。直達連結：`#/home/life`。
- 六階段：早安入園、好奇探索、一起用餐、安靜片刻、午後玩耍、帶故事回家。
- 2026-09-18 關於常春藤與孩子的一天之間加了第二道區塊簾幕：往下捲時關於區塊停住並由下往上被擦掉，露出孩子的一天（與首屏 → 關於同一種切換）。
- 2026-09-18 改為拍立得顯影版（`design/day-timeline-directions/` 比稿的 Q 版）：固定影片背景、sticky 大字「常春藤的一天」隨相片靠近淡成底紋、六張隨捲動顯影的相片，點相片或按鈕翻到背面看故事與家長提問。時刻改用官網一日流程。備份 `versions/before-day-polaroid-20260918-160145/`。
- 2026-09-16 曾為橫向文字分頁與開放式圖文雙欄（已被上一項取代）。
- 方向鍵與 Home / End 可切換分頁，Tab 進入故事內容。
- 用餐／午休使用義華教室照片作空間參考並標示待補；日常文字為情境提案，不代表已核定作息。
- 新版的照片及標題起點保持穩定；問答展開不會拉長照片。手機文字分頁可橫向滑動，選取項目會保持可見。
- 2026-09-16 驗證：320／375／390／768／1024／1440px 無橫向溢出，六個片刻面板高度差為 0；問答展開照片尺寸不變，所有主要控制項至少 44px。Home／End、方向鍵、Tab、最後一段返回早安入園正常，`preview.html` 同步重新打包。
- 改版前單檔保存在 `versions/before-day-experience.html`。
- 本次文字分頁改版前備份：`versions/before-day-editorial-20260916-104150/`。

## 2026-09-10 技術審查與打磨

以 impeccable audit 搭配 Playwright + axe-core 掃描六個頁面（首頁、孩子的一天、義華校、仁武校、預約選校、預約填表）× 三種視口（375 / 768 / 1440）。改版前單檔保存在 `versions/before-audit-polish.html`。

修正內容：
- 預約表單「孩子年齡」少了「2 歲以下」選項（缺 `<option>` 標籤），已補上。
- hero 由固定 `height` 改為 `min-height`，文字放大或字級放大時不再被 `overflow:hidden` 裁切；各視口高度與改前一致。修正小於 400px 時校區頁 hero 被首頁規則蓋成 550px 的 cascade 問題，回到設計值 420px。
- axe：`tour-detail` 的 `<aside role="tabpanel">` 改為 `<div>`；校區頁聯絡面板的 `<aside>` 改為 `<div>`（不再是巢狀 landmark）；照片拖曳區補 `role="group"`。三項違規歸零。
- 觸控範圍補到 44px：FAQ 摺疊列、校區卡片標題與電話／認識校區連結、麵包屑、校區頁電話、頁尾原官網連結、頁尾五校連結。
- 字級底線：圖說、頁尾、麵包屑、步驟列、校區標籤、提示文字由 10–11px 提到 12–13px；小螢幕預約按鈕字級 13px。
- 首頁與校區頁 hero 圖片加 `fetchpriority="high"`，`index.html` 預載首頁 hero 圖（單檔版打包時自動移除）。
- 色彩 token：新增 `--ink`、`--mint`、`--error`、`--trail`、`--trail-visited`，取代散落的 rgba 與 oklch 字面值。
- 「孩子的一天」改用固定存在的 sr-only 即時區域播報切換結果（原本的 aria-live 隨面板重繪而失效）。
- 校區卡片改為 flex 直排，電話列固定貼底，地址換行時各卡對齊。
- 手機號碼欄位補 `title`，瀏覽器驗證提示會說明格式。

- 首次繪製時 `main` 仍是空的，頁尾會先貼在頁首下方、等 app.js 渲染後再被推開，桌機量到 CLS 0.42。`index.html` 以一行 inline script 標記 `html.js`，CSS 讓尚未渲染的 `main` 撐滿一個視口高度；無 JS 時維持原本頁首／頁尾／提示的順序。

驗證：18 個頁面／視口組合 axe 違規 0（僅剩文字疊圖的 color-contrast 需人工判讀，已目視確認）；無水平溢出；載入與滾動全頁 CLS 皆為 0；單檔 `preview.html` 以 file:// 開啟無 console 錯誤、資源全數內嵌、年齡選項 6 個。
- 中文優先：15 處英文段落小標改為中文（認識常春藤、五校介紹、教育理念、孩子的一天、校園探索、校園活動、參觀前的問題、預約參觀、參觀須知、交通與聯絡、示範結果等），導覽列英文副標移除，校區資料不再需要英文名。
- 箭頭收斂：↗ 只留給外部連結（原官網、活動頁、Google 地圖），→／← 只留給表單步驟與片刻切換；校區卡片移除重複的 ↗ 圖示連結（原本一張卡有四個連到同一頁的連結）。
- 圖示：導入 Phosphor Regular 共 24 個圖示，內嵌 SVG sprite（約 9KB），取代原本的 ↗ ↓ → ← ↺ ⛶ ✓ 等字元；電話、地圖、預約、片刻時間軸、照片探索工具列、表單步驟都有對應圖示，並統一按鈕內圖文間距。

## 字型方向提案

三個方向並排的設計畫布已儲存為私密連結，見 `design/font-directions/README.md`（含連結、子集化字型與產生器）。園方選定後再把字型接進站內。

「關於常春藤」區塊（2026-09-15）：三個方向的畫布在 `design/believe-directions/`（含連結與產生器），採用左文右圖版並已實作進首頁；未採用的方向保留在畫布第二頁。

園方於 2026-09-10 選定方向 B：標題改用 LINE Seed TW（Bold 700、hero 800），字型子集放在 `assets/fonts/`（含說明與重新產生指令），頁尾註明字型來源；`package_preview.py` 會把字型內嵌進單檔版。


## 2026-09-14 主視覺審查與優化

對首屏主視覺做了一次設計審查（兩份獨立評估：人工設計審查＋`impeccable detect` 自動掃描），啟發式合計 24/40。結論是版型沒問題，問題在「深色影片 hero」的模板反射把真實校園照壓成陰天。以下為已執行的修正，規則同步寫進 `DESIGN.md`。

**遮罩（P1）** `.studio-hero::before` 從「左側 78% 全黑橫幅」改為三條分別對應頁首、底部說明列、左側文字欄的帶，全部改用 `--ink` token。孩子所在的右側恢復全日光。桌面白字對真實照片的平均對比實測：導覽 5.78、eyebrow 4.65、預約鈕 5.01、副標 6.08、標題 5.07，全部過 4.5:1（先前導覽 4.14、eyebrow 4.08、預約鈕 3.55 未過）。

**手機（P1）** 原本 1440×578 的橫幅照被拉進 390×844 的首屏，只露出原圖寬度 19%、放大 1.46 倍，孩子的臉被切半；且白色制服正好落在文字位置，副標對比只有 2.66，加厚遮罩救不回來。改為照片佔上方一帶、下緣淡入深綠，文案與說明列落在 `--deep` 面板上：

| 指標 | 修改前 | 修改後 |
|---|---|---|
| 可見原圖寬度 | 19% | 46% |
| 照片縮放 | 放大 1.46× | 縮小 0.6× |
| 副標對比 | 2.66 | 13.8 |
| 頁首對比（壓在照片上） | 3.36–4.25 | 5.55–6.36 |

**主次（P1）** hero 主鈕改為實心暖黃配深綠字（9.65:1），文案改「預約來校園走走」，明說是預約；頁首「預約參觀」維持白框幽靈鈕當重複入口。焦點環有 5px offset，落在按鈕外的深色底上（13.97:1）。

**文案（P2）** 刪除第四句標語 `.hero-note`；底部左側從「在生活裡探索，在陪伴中成長。」改為「五所校園：三民 · 左營 · 鳥松 · 仁武」，回應想比較校區的家長；移除 `max-width:14ch`（原本在手機折成「在生活裡探索，在／陪伴中成長。」）。

**字型（P2）** `.studio-hero h1` 的 `font-weight` 從 700 改回定案的 800（`lineseed-eb.woff` 原本預載卻沒有任何規則用到），行高 1.55 收到 1.3。

**狀態（P1）** `#media-caption` 只在 `video` 的 `playing` 事件後才改成影片文案。先前海報狀態下畫面是孩子、文字卻寫「自然花草 · 示範影片」。自動播放除 `saveData` 外也擋 `effectiveType` 為 2g／3g。已實測減少動態情境：影片暫停、圖說維持「義華校 · 生活影像」、提供播放鈕。

**版面** `.studio-hero-grid` 的 `padding-block` 改 `clamp(28px,5vh,56px)`。1280×800 與 1440×900 實測 hero 皆收進一屏，暫停鈕不再被推到摺線下（先前在 y=746 與 y=777）。

**細節（P3）** 移除 eyebrow 的裝飾圓點與死碼 `.paper-sun`／`.hero-sprout`／`.studio-hero-image figcaption`；漢堡鈕線條 1px×20px 改 2px×22px 並加上與預約鈕相同的白框；頁首與底部分隔線透明度統一為 .6；hero 內的 `rgb(0 0 0 / a)` 與 `#fff` 字面值全改為 token。

**打包器** `package_preview.py` 原本只內嵌 `styles.css`，`studio.css` 完全沒進 `preview.html`，等於打包出來的單檔預覽沒有工作室主題。已修正並重新產生 `preview.html`（已實際載入驗證）。

**尚未處理（需園方素材）** 海報原圖僅 1440px 寬，正式版建議至少 2400px，並另拍一張直式校園照供手機使用；首屏影片已改用園方廣告片剪出的 `assets/hero-campus.mp4`（1080×800、11.7 秒、2.5MB），來源與剪法見 `design/hero-video/build.sh`；正式版仍建議提供無字幕、無浮水印的 1920×1080 原始素材重剪。

## 五校介紹加地圖與社群（2026-09-15，已採用方向 B）

首頁五校卡片與各校「交通與聯絡」頁加入 Google 地圖、LINE 官方帳號、Facebook。三個呈現方向的比較頁仍留在 `design/campus-directions/`（A 地圖清單／B 卡片加地圖抽屜／C 校區分頁）供參考；使用者選定 **B 卡片加地圖抽屜**，已實作進站：

- 首頁五校卡片新增電話下方一列：LINE、Facebook 圓形圖示 + 地圖按鈕；按地圖，卡片下方展開抽屜（免金鑰的 Google 地圖單點嵌入、LINE／Facebook 大按鈕、預約入口）。桌機預設展開義華校；手機需要點擊才展開，且會插在被點的卡片正下方。
- 各校內頁「交通與聯絡」（`#/校區/contact`）從純文字連結改為內嵌 Google 地圖 + LINE／Facebook 按鈕。
- 地圖 iframe 進到視口附近才載入（IntersectionObserver + `data-src`），避免 Google 的 embed 搶走頁面焦點與捲動位置。
- **資料缺口**：只查到義華校的 LINE（`lin.ee/gwl8fnA`）與粉絲專頁（`facebook.com/ivy.kids.fb`）；明華、崇德、國際、仁武的 LINE 官方帳號與各校粉專未查到，畫面上 LINE 以虛線「帳號待補」呈現、Facebook 暫時指向常春藤機構粉專（`facebook.com/ivykid`），不冒用義華帳號。**請園方提供四校的 LINE 與粉專連結，補進 `app.js` 的 `campuses` 物件（`line`／`facebook`／`fbNote`）。**
- Google 地圖目前是免金鑰的單點嵌入，一次只顯示一所；若要五校同框，需園方用 Google「我的地圖」建圖或申請 Maps API 金鑰（見 `design/campus-directions/README.md`）。

## 五校入口重排（2026-09-16）

依設計回饋把首頁「五校介紹」從五張聯絡資料卡改成真正的校園入口；mock-up 畫布 https://claude.ai/artifact/8PpG9rz5rc5UV1VaHfoGas ，工作檔在 `design/campus-entry-mockup/`。

- 五校同寬入口只留照片（4:3、逐張決定裁切位置）＋校名＋地區，整塊是一個連結；地址、電話、社群圓鈕、地圖按鈕、短橫線全部移除，校名不加箭頭。
- 下方常駐「校區位置與聯絡資訊」：校區 tab（滑鼠、方向鍵、點地圖圖釘都能切換）、地址電話、「預約參觀Ｘ校」主鈕、LINE／Facebook 文字連結、五校位置示意地圖（選校放大該校圖釘），右上角「規劃路線」開 Google 導航。沒有收合／展開列，也沒有關閉叉叉。
- 社群圖示重做：36px 細框圓徽章＋標題＋小字說明，取代原本的彩色圓鈕與大膠囊；各校內頁「交通與聯絡」同步換用。
- 首頁的 Google 地圖 iframe 改為 SVG 示意圖（座標來源 `design/campus-directions/`，只留視窗內 14 區，約 10KB）；各校內頁仍保留 Google 單點嵌入。
- 驗證：1440px 無水平溢出、tab／方向鍵／圖釘切換與路線連結同步、無主控台錯誤；`preview.html` 已重新打包。改前快照 `versions/before-campus-directory-20260916-140939/`。規則寫在 DESIGN.md「五校入口重排」。

## 五校分區輪播上站（2026-09-16 下午）

使用者在畫布 https://claude.ai/artifact/8PpG9rz5rc5UV1VaHfoGas 第三頁先選 A3，再改為 **A2 版面＋單一長橢圓軌道**（15:34 定案），並指定照片多些圓角；已照最終版改進首頁，取代中午上站的五校目錄版。

- 標題與引言置中；「← 選校軌道 →」置中：五校在同一條淡灰米底的長橢圓軌道裡，選中的是實心綠膠囊；不分地區（15:38 拿掉地區小標與分組線）。
- 左大照片（4:3、24px 圓角、逐校裁切）＋校區介紹句；右欄先 240px 示意地圖（16px 圓角），再校名地區、地址電話、「預約參觀Ｘ校」主鈕與「認識Ｘ校」校區頁入口、LINE／Facebook 徽章。手機軌道滿版，上一／下一校改到照片圖說列右側。
- 切換：軌道 tab 鍵盤操作、上一／下一校首尾循環、點地圖圖釘；照片預載後 200ms 淡入淡出，減少動態直接換，手動切換時 aria-live 播報目前校區。每 6 秒自動循環五校，依使用者要求移除暫停／播放鈕。滑鼠停留、鍵盤焦點位於區塊內、觸控按住、離開可視範圍或背景分頁時暫停；結束操作後重新計滿 6 秒繼續。減少動態效果時不自動播放。
- 打包器改為替換 `photoSrc` 單一定義；`preview.html` 已重打包，照片、字型皆內嵌。
- 驗證：1440px 與 390px 無水平溢出、無主控台錯誤；tab／方向鍵／上一下一校／圖釘切換後照片、介紹、資訊、地圖、路線、播報全部同步。改前快照 `versions/before-campus-carousel-20260916-152420/`（目錄版）與 `versions/before-campus-a2-20260916-153422/`（A3 版）；規則在 DESIGN.md「五校分區輪播」。


## 最新消息 A 版（2026-09-16）

- 已套用到首頁 `#/home/latest-news`，位置在分校資訊後，接續頁尾；導覽列與頁尾均有最新消息入口。
- 桌面左側三個活動日期卡、右側三則圖文消息；手機改為上下排列，消息使用縮圖加標題。配色、字型與間距延續選定的 A 版。
- 點擊消息或活動會開啟詳情；「所有活動／所有最新消息」提供完整範例清單，可返回清單、Escape 關閉並還原焦點。切換路由時視窗會關閉。
- 消息、日期、活動皆為示意；既有校園圖像不代表該則消息實拍。正式資料待園方提供，沒有報名送出或後端串接。
- `app.js` 的 `homepageNews` 集中管理資料、版面與視窗；`studio.css` 的 `.home-news` / `.hn-*` 為專用樣式。圖片透過 `photoSrc` 內嵌，`preview.html` 已同步打包。
- 五方向比較仍保留於 `design/news-directions/`，首頁情境模式可繼續比較其他方向。
- 驗證：首頁與單檔版各 7 種寬度（1440、1100、1024、901、768、390、375px）皆無水平溢出、破圖或 JavaScript 例外；詳情、返回清單、Escape 焦點、路由往返均通過，單檔版無本機 assets 請求。實際截圖：`output/playwright/home-news-a-{desktop,mobile,context}.png`。

## 首頁收尾調整（2026-09-16）

依園方要求，首頁暫時移除 FAQ 與底部「親自走一趟」預約橫幅，最新消息後直接接頁尾；導覽列的「參觀須知」與頁尾的「常見問題」連結同步移除。頁首預約參觀、預約表單及各分校頁面保留原有功能。`preview.html` 已同步更新。


## 關於常春藤 B2（2026-09-17 定案）

首頁 `#/home/about` 已套用 `design/b-layout-extensions/b2.html` 的錯落雙照片版：保留 SINCE 1997、主標與加長的單段介紹，移除內容上方重複的「關於常春藤」小標。淡綠底上的裝飾大字改為「關於／常春藤」。

背景在導覽列下方固定，文字與照片跟隨頁面捲動；離開此區才一起帶走背景。依園方追加要求，內容上方再留 `32svh`（180–360px）背景，1440×900 時增加 288px；手機使用 `24svh`（160–240px）。既有首屏揭幕效果保留，單檔 `preview.html` 已同步。

驗證：Chromium 100% 視窗尺寸 1920×1080、1440×900、1280×650、1024×768、901×700、768×1024、390×844、375×667、320×568、720×450 無水平溢出、破圖或 JavaScript 例外。捲動 120px 時，背景大字位移 0、主標位移 -120px。原生及模擬不支援 scroll timeline 的 fallback、減少動態、導覽與校區連結往返皆通過；減少動態停用揭幕及背景固定，內容仍完整可讀。Hero 內容高於視窗時維持既有正常閱讀模式。Safari／Firefox 尚未實機驗證。

截圖位於 `output/playwright/home-belief-b2/`。整合前備份：`/private/tmp/ivy-before-belief-b2-20260917-105629/`。
