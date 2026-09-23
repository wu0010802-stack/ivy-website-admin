# CLAUDE.md — 常春藤官網 prototype

本檔是本 repo 對所有 AI agent（Claude Code、Codex 等）的**單一權威規則**；`AGENTS.md` 只是指向這裡的入口。全域規則（語言、模型調度、安全）另見 `~/.claude/CLAUDE.md`，本檔只寫這個 repo 才有的事。文件互相矛盾時：**有日期的較新業主裁定 ＞ 本檔 ＞ DESIGN.md／README ＞ 舊的 design/、versions/ 工作檔**。

## 這個 repo 是什麼

常春藤教育機構（五校：義華、明華、崇德、國際、仁武）官網互動提案。目標與反參考見 `PRODUCT.md`。**與園務系統三個 repo（ivy-backend／ivy-frontend／ivyManageSystem）無程式關聯**，接到任務先確認不是要動那三個；五個 campus key **不是** tenant_id。

## 檔案地圖

| 路徑 | 角色 | 動它前要知道 |
|---|---|---|
| `index.html` `styles.css` `studio.css` `app.js` `assets/` | 可維護版主站，**零依賴** vanilla | 提案階段不加 npm 套件、不引框架 |
| `app.js` | hash 路由（`#/頁面/子路徑`，`render()` 在檔尾）＋所有內容資料：`campuses`、`dayMoments`、`faq()`、`homepageNews` | 高度壓縮成單行函式、無分節註解；切片刪除前**先印出行號範圍再刪**（已兩次多刪共用宣告） |
| `studio.css` | 工作室主題與頁首／膠囊／斷點 | container 斷點以此檔第 16 行為準（1100），不是 `styles.css` 的 1150 |
| `preview.html` | `package_preview.py` 打包出的單檔，**刻意進版控**、可離線開 | 改任何原始檔後必重打包，見下 |
| `DESIGN.md` | 設計規則與每輪定案／否決紀錄 | 改版前先讀相關章節，否決過的方案不要再主動提 |
| `README.md` | 日期 changelog（前 200 行）＋預覽／打包／限制說明 | 每次改版在頂部加一段日期紀錄 |
| `design/<主題>-directions|mockup|demo[-YYYYMMDD]/` | 比稿工作檔、截圖、對照頁 | 只在需要追溯來源時讀；**不要把舊方案套回主站** |
| `versions/before-<主題>-YYYYMMDD-HHMMSS/` | 改版前快照 | 大改前先建一份 |
| `output/` `.playwright-*` `.impeccable/` `.codex/` | 本機截圖與工具狀態，已 gitignore | 暫存物放這裡，不要散在根目錄 |
| `docs/specs|superpowers/plans|handoff/2026-09-19-website-admin*` | 官網後台（web/ admin/ backend/）規格、計畫、執行提示 | 尚未實作；見「官網後台任務」 |

## 每次改版必做的流程

1. 動手前 `git status --short`：本 repo 長期有大量未提交設計修改，**全部視為使用者工作**。不 reset／checkout 還原／stash／clean，不 `git add .`、`-A`、`commit -a`。
2. 大改前快照到 `versions/before-<主題>-$(date +%Y%m%d-%H%M%S)/`。
3. 改完：`node --check app.js` → `python3 package_preview.py` → 確認 `preview.html` 有更新。
4. 本機預覽：`python3 -m http.server 8765 --bind 127.0.0.1`，結束 `pkill -f "http.server 8765"`。
5. 記錄：README 頂部加日期段落；定案或否決的規則寫進 DESIGN.md 對應章節；比稿參數（`?xxx=`）在定案後從 `app.js` 移除。
6. 未經要求不 commit。使用者要求時原始檔與 `preview.html` 一起提交，Conventional Commit、繁體中文。

## 打包器 `package_preview.py` 的地雷

- 靠**精確字串比對**替換（`photoSrc`、`DAY_FILM`／`DAY_FILM_MOBILE`、`url(assets/fonts/*.woff)`），對不上會 `assert` 失敗。改這些常數的寫法、或想跑 Prettier 之類的格式化，**先改打包器**。
- 只內嵌 `day-film-mobile.mp4`，桌機母帶不內嵌（否則檔案翻倍）；兩個常數共用同一份 data URI，保留這個機制。
- 新增 CSS 或字型檔要同步加進打包器（曾漏掉 `studio.css` 導致 preview 沒有主題）。

## 字型子集

- 標題字型 LINE Seed TW 只有子集（`assets/fonts/lineseed-bd.woff` 全站用字、`lineseed-eb.woff` h1 用字），**原始 OTF 不在本機無法補字**。寫新的 h1／h2／h3 文案前先用 fontTools 算 cmap 聯集查缺字，缺字會退回 PingFang 很突兀。
- 頁首品牌字分三個 woff：`noto-sans-tc-600-brand.woff`（中文品牌名）、`source-sans-3-400-brand.woff`（英文）、`noto-sans-tc-600-anni.woff`（只有「週年」，用 `unicode-range` 分流）。要補字走 Google Fonts 可變字型 → instancer 定 wght → pyftsubset，**另切新檔、不動既有 brand 子集**。指令在 `assets/fonts/README.md`。
- `halt`／`palt` 對子集無效，標點收緊只能用負邊距。

## 設計硬規則（細節與理由在 DESIGN.md）

- 遮罩、文字、錯誤、時間軸顏色一律走 token，不寫 rgba／oklch 字面值。
- hero 遮罩對比要對**實際照片像素**量，桌機與手機分開量；手機首屏不做滿版壓字。
- 頁首貼視窗右緣的做法是 `.header-top` 滿版＋補 gutter，包在 `@media(min-width:901px)`；**禁止**用 `.header-book` 負邊距（自訂屬性裡的 % 在使用端解析）。
- 膠囊內任何 `span` 規則要明寫 `width/height/background`，否則被站內選擇器壓成白條。
- 五校底板卡地圖抽屜桌機固定 `order:99`，不要改成插在被點卡片下方（Grid 斷行整批跑版，已實測）。
- 已否決、勿再主動提：孩子的一天大標鏤空／白框、logo 雙濾鏡疊圖去背、`.paper-sun`／`.hero-sprout` 等已刪死碼。
- 圖示只用 Phosphor Regular，sprite 內嵌 `index.html`；英文只留 `lang="en"` 副標與外部連結 ↗。
- `ui-ux-pro-max` 之類的通用 UI 套件對本案不適用（會撞 PRODUCT.md 的反參考）。

## 現況容易搞錯的事（2026-09-19）

- 「孩子的一天」是背景影片（760px 分界切桌／手機檔）＋六張可翻面拍立得，不是舊分頁；`dayMoments` 欄位 `key,time,label,tint,photo,alt,caption,title,story,question,answer`。
- 首頁五校是 e3 墨綠底板卡，首頁沒有嵌入地圖；分校內頁才有，且只載當前校。
- 頁首預約鈕全站只有一種：金色滿高色塊（d9），手機退回膠囊。
- 首頁捲過 40px 頁首收成靠右的深綠膠囊（2026-09-23 起分校頁與預約頁在 900px 以下也收，桌機內頁不收）；`?pill=`、`?autohide=1`、`?anni=a|b|c` 仍是預覽參數，**30 週年版尚未拍板**，不能順便上線。
- 預約表單只是前端示範，不送出、不存庫；localStorage 只放動效偏好。
- 只有義華有 LINE／FB，其他四校留待補，**不能拿義華的代填**。

## 驗證工具的本機繞法

- chrome-devtools MCP 的 `resize_page` 無效，用 `emulate` 指定 viewport（`1440x900x2`、`390x844x3,mobile,touch`）；手機截圖逾時就改跑 Playwright。
- Playwright 未裝在 repo，用 npx 快取 `~/.npm/_npx/*/node_modules/playwright-core` ＋ `chromium.launch({channel:'chrome'})`；範例在 `output/playwright/*.cjs`。
- ffmpeg 沒有 libwebp：先抽 PNG 再用 PIL 轉 WebP。
- 對比度不要在瀏覽器 seek 影片取樣，改 ffmpeg 抽幀後離線算。
- `npx impeccable detect --json <url>` 可用；`impeccable live` 這版跑不起來。
- 機器只有 8GB RAM：同時只跑一組測試或重型轉檔。

## 官網後台任務（web/ admin/ backend/，尚未開工）

- 入口：`docs/handoff/2026-09-19-claude-website-admin.md`，規格 `docs/specs/…`，計畫（11 個任務分 A–D 四階段，一次 session 只做一階段、階段間有硬閘）與 A01–A25 驗收表 `docs/superpowers/plans/…` Task 11。三份文件 2026-09-19 已修訂為 v3。
- **技術棧以規格 v2 為準**（規格、計畫、handoff 三份已於 2026-09-19 同步為 v2）：公開官網 Nuxt 4 + Vue 3 + TS（SSR）、後台 Vue 3 + Pinia + Element Plus + Vite、API FastAPI **0.136.1 釘版**＋SQLAlchemy 2.0＋Alembic＋PostgreSQL。選型背景在 `docs/analysis/2026-09-19-frontend-stack-assessment.md`，不要再重開框架選型。
- 官網用獨立 DB，不連 `ivymanagement`、staging 或 prod；不部署、不 push、不發真實通知、不建付費服務。
- 預約語意（inquiry「已收到需求」／slots 人工確認「待確認」／只有已確認才叫「預約成立」）、idempotency、最後名額並發要用真 PostgreSQL 驗證等不可違反規則，逐條見規格第 17–30 行與 handoff「預約不可違反的規則」。
- 現行 vanilla 站在階段 A 閘門通過前仍是設計基準，`preview.html` 機制要保留；閘門通過的 commit 為原型凍結點，之後設計迭代改在 `web/`。
- 標題與品牌字型是子集（見上節），CMS 開放編輯標題前必須先處理，規則在規格 3.1.1。

## 委派與回報

- 唯讀盤點用 `scout`（sonnet）；比稿類任務常同時開多個 `?param=` 方向，記得在定案後清掉。
- 回報只給結論、`檔案:行號`、實際跑過的指令與結果、未驗證項；沒看到成功輸出不宣稱通過。
- 不可逆或對外的動作（發布、刪對話、rotate token）先講不做。
