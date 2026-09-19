# 給 Claude：Nuxt 官網、後台與五校預約完整實作

以下內容可直接交給 Claude Code；搭配同 repo 的規格與實作計畫使用。這是實作任務，不是再產出另一份提案。

版本：v2，2026-09-19。使用者已選定 Nuxt 前台；本版取代先前「公開站維持 vanilla」的交接要求，不需要再次詢問是否採用 Nuxt。

---

你要在 `/Users/yilunwu/Desktop/ivy-website-prototype` 實作常春藤官網後台。請全程使用繁體中文（台灣用語）。

請先閱讀：

1. 適用的 `AGENTS.md`、`CLAUDE.md` 與相關專案 skills；以使用者明確指示及專案權威規則為準。
2. `docs/specs/2026-09-19-website-admin.md`：功能、資料模型、API、權限、預約語意與範圍。
3. `docs/superpowers/plans/2026-09-19-website-admin.md`：11 個任務、檔案責任、測試與 A01–A24 驗收。
4. 現行 `index.html`、`app.js`、`styles.css`、`studio.css`、`package_preview.py`，以及 README／DESIGN 中與現行程式相符的說明。

## 執行目標

在保留現在官網設計的前提下，完成可實際操作的獨立官網後台、API、資料庫、素材管理與參觀預約。五所分校能各自切換預約方式，園方能更新官網內容並管理接待案件。

本次依「Nuxt 公開官網＋獨立官網後台」執行：同 repo 新增 `web/`、`admin/`、`backend/`。公開前台使用 **Nuxt 4 + Vue 3 + TypeScript，SSR 為預設**，將原型逐區遷移為元件並保留目前版型及互動；正式網址採路徑路由，舊 hash 連結須相容轉址。

後台使用 Vue 3 + TypeScript + Pinia + Vue Router + Element Plus + Vite；後端使用 FastAPI **0.136.1，不得升版**、SQLAlchemy 2.0、Alembic、PostgreSQL。官網使用獨立 DB，不連接既有園務系統。五個 campus key 不是 tenant_id。

Nuxt 與 Node 選用相容的穩定版本並鎖定；公開官網不載入 Element Plus，也不另寫一套 Nuxt 預約／權限／名額後端，這些業務仍由 FastAPI 統一處理。

請按計畫完成所有任務，包含實作、測試、API 型別、文件與驗收。常規實作選擇自行判斷，不要每完成一小段就停下詢問。遇到外部設定缺漏時先完成其他可做部分，集中列出阻擋項目。

## 開始前必做

- 確認 git root、分支與工作目錄。這個 repo 已有大量未提交設計修改，全部視為使用者工作。
- 記錄基準，不 reset、checkout 還原、clean、stash 或覆蓋這些修改。不要 `git add .` 夾帶其他工作。
- 先檢查目前程式是否又有更新，規格行號僅為定位提示；如已變動，以最新設計保留為原則，更新文件中的證據。
- 不讀取舊 design/versions 後就把舊設計套回現行頁面。只在理解來源確有需要時讀。
- 保留本機測試與視覺 before 證據，任何敏感內容不得寫進紀錄。

## 最容易做錯的現況

1. 「孩子的一天」現在是桌機／手機背景影片、六張捲動出現且可翻面的拍立得，不是舊版分頁。欄位是 `key,time,label,tint,photo,alt,caption,title,story,question,answer`。
2. `DAY_FILM` 與 `DAY_FILM_MOBILE` 在 760px 分界；保留延遲載入、離開暫停與 reduced-motion。封面另有 poster。
3. 首頁分校現在是 e3 墨綠底板卡，首頁不再有嵌入示意地圖；分校內頁仍有地圖。
4. 頁首預約為金色滿高按鈕。不要恢復舊樣式。
5. 新聞／活動以 dialog 顯示；目前沒有獨立文章路由。30 週年還是提案，不能順便上線。
6. 現在預約只是前端示範，尚未真的送出。localStorage 僅用於動效偏好，不能當正式預約資料庫。
7. 四校 LINE 未填，要保留待補，不能用義華 LINE 代填。
8. 遷移前保存 `preview.html` 為原型離線快照，保留單份較小 day 影片與禁止真實提交。新版改以 Nuxt localhost／登入草稿預覽驗收，不要求把 Nuxt build 壓成單 HTML，也不把舊快照宣稱為新版 CMS 預覽。

## Nuxt 遷移必須遵守

- 依計畫先保存基準，以單一 fixture 遷移首頁與義華一校，確認視覺／互動／SSR，再展開其他校及 API 接線。不要先建立 vanilla CMS adapter。
- 拆出 SiteHeader、HeroVideo、AboutSection、DayExperience、DayMomentCard、CampusBoard、CampusTour、NewsDialog、CampusFaq、VisitForm、SiteFooter。
- 原 app.js 不載入 Nuxt；不以 v-html 或 main.innerHTML 掛舊整站，不同時重設計或更換 CSS／動畫套件。
- SSR 要有真正的主要內容；window、document、影片播放與 observer 放在瀏覽器掛載後處理，卸載時清理。禁止整頁 ClientOnly 或全站 ssr:false。
- 新路徑為 `/`、`/campuses/{key}`、`/visit`、`/visit/{key}`、`/visit/manage`、`/preview`。正常校區回 200、未知／停用校區 404、首次內容取得失敗 503。
- 舊 hash 由只處理根路徑 `#/` 的 client plugin replace 轉址，不攔截正常錨點及 `/visit/manage#token=...`。
- 第一版不啟用共享 HTML 快取、SWR、ISR 或固定 prerender 內容；一次 SSR 只用同一 release，發布後的新請求、刷新及站內換頁讀新版本，hydrate 不重複載入相同內容。
- 公開 SSR 只讀公開 DTO，不轉送登入 cookie／家長 token。草稿與家長案件不得進公開 HTML／payload／共享快取。
- 完成 SSR title、description、canonical、Open Graph、sitemap、robots 與 noindex 開關；新聞仍保留 dialog，不新增文章頁。
- 正式模式必須使用 API；fixture 只限明確開發／測試環境且不可真實提交。production 設定 fixture 必須拒絕啟動。
- 正式服務以 Nuxt build/start、admin Vite 靜態檔、FastAPI／worker 分工；不能把 repo 或 Nuxt server 原始碼當公開靜態根目錄。

## 必須完整交付的功能

- 全站品牌、首頁、關於、孩子的一天、五校資料、分校介紹、探索場景與熱點、FAQ、消息、活動、聯絡與網站 meta 的後台編輯。
- 素材上傳、分類、預覽、裁切焦點、桌／手機影片、poster、alt／來源、使用位置追蹤、版本與刪除保護。
- 草稿、審核、預覽、發布、排程、下架、版本還原、併發編輯衝突與稽核。
- 各校六種模式：`inquiry`、`slots`、`line`、`phone`、`external`、`paused`；所有預約 CTA 統一取設定。
- 真實表單保存、同意紀錄、idempotency、限流、明確成功／失敗畫面與設定版本檢查。
- 預約清單、詳情、人工補登、承辦、聯絡紀錄、跟進、狀態、取消、改期、日曆與受權限保護的匯出。
- 可預約時段、容量、例外日期、提前時間、人工／自動確認、占位期限、並發防超收。
- 帳號、角色、分校作用範圍、cookie session、CSRF、操作紀錄及私人素材保護。
- 站內通知、outbox、Email adapter 與本機驗證、失敗重試、排程工作恢復；缺供應商時如實列未配置。
- 家長安全管理連結、取消與改期申請；不以電話或流水號公開查詢個資。
- 去識別統計、Dashboard、保存政策、dry-run 清理、隔離備份還原及操作文件。
- web/admin 共用 OpenAPI 型別、聚焦單元與整合測試、真 PG 併發測試、桌手機 E2E、Nuxt SSR／路由／發布新鮮度測試，以及原型離線快照與新版服務預覽。

## 預約不可違反的規則

- inquiry 送出只稱「已收到需求」，slots 人工確認稱「待確認」，只有已確認才稱「預約成立」。
- 模式切換不能取消或清除既有案件。舊案保留原校區、來源與設定版本。
- 未成功的舊版本表單回 BOOKING_CONFIG_CHANGED 並保留輸入；已成功建立的同 key 重播回原結果。
- 重複點擊／網路重試不能建立第二筆；同 key 不同 body 要拒絕。
- 最後一個名額的兩個並發請求只能一個成功，要用真 PostgreSQL 驗證，不能只測 UI disabled。
- 取消、改期、逾期釋放與新建案都必須遵守相同的 DB 鎖與交易規則。
- 通知失敗不丟案件；outbox 不得在交易提交前對外發送。
- LINE／電話／外部網址點擊不算成功預約，不憑點擊自動建案。
- API 權限需涵蓋查詢、詳細資料、修改、匯出、素材、預覽、統計與背景工作。
- 內容還原不可回復預約、容量、模式或通知狀態。

## 範圍與執行限制

- 只操作本 repo 與本任務隔離開發／測試資料，不修改 ivy-backend、ivy-frontend、ivyManageSystem。
- 不連 `ivymanagement`、共享 staging 或 production；不對真實資料庫套 migration。
- 不部署、不 push、不對外發布、不建立付費服務、不發真實家長通知。部署配方可以完成並交付。
- 不把測試同意文案、暫代午休照片、示範活動或未核定資料說成已經園方核可。
- 不新增招生 ERP、學費、師資系統、活動報名付款、360 導覽、任意 HTML 編輯器或週年改版。
- 不放真實秘密、預設管理者密碼、明文憑證進 repo；bootstrap 採安全互動輸入。
- 可獨立的唯讀盤點可用輕量 subagent。實作若平行，明確指定不同模組所有權，不互相覆蓋；同時只能一組測試／重型轉檔工作，機器只有 8GB RAM。
- 如工具、服務或憑證缺失，先完成不依賴它們的程式、測試配方與文件，集中回報確實未驗證的項目，不能跳過必要驗收後宣稱完成。

## 驗收與回報

依計畫完成 11 個任務及 A01–A24，記錄測試名稱、實際命令與結果，包含正面成功與負面拒絕情境。不要只提供截圖或只跑 build 就說整個系統完成。

交付報告請包含：

1. 已完成功能與 A01–A24 的 pass/fail/not-run 狀態。
2. Nuxt 官網／管理後台本機入口、啟動 API／worker／web／admin 的實際命令與建立管理者方式；不提供密碼。
3. 主要檔案、DB schema/migration、OpenAPI／型別與依賴 lockfile。
4. web/admin 的 typecheck／build、契約檢查、測試、桌手機視覺、SSR／hydrate／新網址、發布更新、原型快照及 Nuxt 預覽驗證結果。
5. 曾操作的資料庫是否均為隔離開發／測試；是否有外發通知、push、部署。
6. 尚缺的真實分校資料、通知／儲存供應商設定、未執行驗收與限制。
7. `docs/website-admin/acceptance.md` 及維運文件位置。

請現在開始實作，不要把任務停在重新列功能清單或只建立空白後台畫面。
