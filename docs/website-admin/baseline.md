## 內容 fixture 對照（2026-09-19）

抽取來源：`app.js`（完整讀取，739 行，單行高度壓縮）與 `index.html`（51 行）。輸出：`content/site-fixture.json`（約 29.8KB，`node -e "JSON.parse(...)"` 驗證為合法 JSON）。

### fixture 涵蓋的 app.js 頂層資料結構

| app.js 資料 | fixture 對應 | 備註 |
|---|---|---|
| `campuses`（5 校物件） | `campuses[]` | 逐校完整搬入：name/district/address/phone/image/photoPos/panoramaPos/heroPhotoPos/intro/description/line/facebook/fbNote |
| `dayMoments`（6 張拍立得卡） | `dayExperience.moments[]` | 欄位比照 key/time/label/tint/photo/alt/caption/title/story/question/answer 全數保留，`title` 保留原始 `\n` 換行 |
| `faq(key)` | `campuses[].faq.items[]` | 函式回傳固定 4 題，第 3 題文字內插校名；fixture 對每校各展開一份（第 3 題已代入該校校名），並標 `template: "generic-4-item"` 註明本質是同一模板 |
| `homepageNews`（IIFE 內 `articles`／`events`） | `news.articles[]` / `news.events[]` | 完整搬入，含 `sampleNote` 示意文字 |
| `tourScenes`（義華校專屬三場景）＋ `scenesFor(key)` 對其他四校的通用產生邏輯 | `campuses.yihua.tourScenes[]`（逐場景逐熱點）；其餘四校 `tourScenes._generated: true` + `template`（模板＋插值規則） | 未把其他四校的「產生後」場景展開成假資料，避免看起來像是四校各自有專屬熱點文案——實際上 app.js 對非義華校是即時字串插值產生單一場景 |
| `home()` 內 hero 文案 | `home.hero` | 標題拆成 before/punct/middle/growingWord 以還原 `<span class="growing-word">` 結構；影片來源 `HERO_VIDEO_SRC` 一併收錄 |
| `home()` 內「關於常春藤」區塊 | `home.about` | 含 belief watermark（`關於`/`常春藤`）、SINCE 1997、完整內文、兩張照片與 caption |
| `campusBoardSection()` | `home.campusBoard` | 僅收版位設定（首頁預設顯示義華校、五校切換順序），視覺是輪播程式邏輯，非逐校資料，故不重複展開 |
| 頁首 `index.html` 品牌／導覽／頁尾 | `siteMeta` / `footer` | title、meta description、theme-color、logo、primaryNav、頁首選單固定電話（義華校） |
| 預約表單（`visitPage()` + `setupBooking()`） | `booking` | 步驟、欄位（含 pattern／maxlength／options）、demo 提示文字、consent 文案；`isDemo: true` 明示不送出不存庫 |

### 沒有收進 fixture 的內容（判斷為程式邏輯／樣式，非內容資料）

- `mapURL`/`embedURL`/`dirURL`：由 `address` 即時算出的 Google 地圖網址生成函式，不是靜態資料，故 fixture 只留 `mapQueryAddress`（即 `address` 本身）讓後台自行組網址。
- 捲動特效、簾幕轉場、拍立得翻面互動、頁首膠囊收合等所有 `setup*()`／`dispose*()` 行為程式碼——純前端互動邏輯，與內容資料無關。
- `?seam=`、`?pill=`、`?autohide=`、`?anni=`、`?hero=quiet`、`?study=1` 等預覽用 query 參數與其對應的 A/B 版面（例如接縫效果、頁首膠囊擺法、30 週年品牌版）——這些是尚未拍板或已否決的比稿分支，不是常態內容，故未收進 fixture。
- `HERO_VIDEO_SRC` 的來源片段細節（design/hero-video/build.sh 產出邏輯）：只收了最終路徑，未深入該建置腳本。

### 待確認 / 待補事項

- **LINE 官方帳號**：僅義華校有（`https://lin.ee/gwl8fnA`）。明華、崇德、國際、仁武四校在 app.js 中皆為 `line:null`，fixture 已標記 `"line": null` 並在 `_todo` 註明「LINE 官方帳號待園方提供」。
- **Facebook 粉專**：僅義華校有自己的粉專（`https://www.facebook.com/ivy.kids.fb/`）。其餘四校目前共用機構粉專 `ORG_FACEBOOK`（`https://www.facebook.com/ivykid`），app.js 註解明講「暫時指向這裡…不用義華帳號冒充」；fixture 已在 `_todo` 標註「借用常春藤機構粉絲專頁，非該校自有粉專」。
- **午休（rest）情境照片待補**：`dayMoments` 的 `rest` 卡片使用 `classroom`（教室空間參考照）而非實際午休照片，app.js 的 `caption` 本身已寫「午休照片待補」，fixture 對應加了 `_todo` 欄位。
- **頁首選單固定電話**：`index.html` 頁首選單面板寫死 `07-392-8366`（義華校），其餘四校沒有對應的頁首快撥號；已在 `siteMeta.headerPhone._todo` 註明，後台若要做成全站共用元件需另外設計「無電話時顯示什麼」的邏輯，不能直接沿用義華號碼。
- **五校的非義華校巡覽場景（tourScenes）本質是模板產生，不是逐校撰寫的內容**：若後台要讓其他四校也擁有像義華校一樣的多熱點導覽內容，需要規劃「園方后續逐校補內容」的欄位與流程，目前 fixture 只原樣保留模板與插值規則，避免誤植為既有內容。
- **不確定是否該收進 fixture 的資料**：`tourScenes` 中的義華校三個場景座標（`x`/`y` 百分比）屬於熱點在特定照片上的像素位置，與該張照片的裁切／版位高度綁定；若之後照片來源或裁切方式改變，這些座標可能需要重新標定，暫時原樣收錄但提醒後台開發者留意。
- **未讀取範圍**：本次僅完整讀取 `app.js` 與 `index.html`，未讀取 `styles.css`／`studio.css`（樣式，非內容）與 `design/`、`versions/` 下的比稿工作檔（依規則僅在需要追溯來源時讀取，本次任務不需要）。

## Task 1：前置條件確認（2026-09-19）

- `git status --short` 於開工時為乾淨；`git worktree list` 確認本目錄為 `feature/website-admin`（另一份 `main` worktree在 `ivy-website-prototype`，留給使用者比稿）。
- 起始 commit：`8417864`（chore: 官網原型 baseline）。
- `node -v` 起始為 `v25.9.0`（不符 22 LTS 要求）；已用 `nvm install 22` 裝 `v22.23.2`，`.nvmrc`（root/web/admin）已釘此版本。之後所有 node/npm 指令都需前綴 `PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`，因為此 Bash 工具不保留 shell 狀態，系統預設 node 仍是 25.x。
- PostgreSQL 本機為 14.15（符合文件註明的測過版本）；已 `createdb ivy_website_dev` 與 `ivy_website_test`，未使用 `ivymanagement`。
- 現用路由（現行原型，非 Nuxt）：hash 格式為 `#/home`（首頁）、`#/<campusKey>`（義華 yihua／明華 minghua／崇德 chongde／國際 international／仁武 renwu，例如 `#/yihua`）、`#/visit`、`#/visit/<campusKey>`；`#/home/about`、`#/home/life`、`#/home/campuses`、`#/home/latest-news` 是首頁內錨點導覽（非獨立頁）。此路由格式已寫進 `web/app/plugins/legacy-hash.client.ts` 的白名單。
- 1440/1024/390/375px 的首頁與五校頁基準截圖已存於 `artifacts/website-baseline/`（24 張 PNG，共約 46MB，已 gitignore）；`package_preview.py` 重跑後 `preview.html` 與工作樹既有版本位元組相同（`git status` 未顯示變更），離線快照複製到 `artifacts/prototype-baseline/preview.html`，SHA-256 見同目錄 `.sha256` 檔。
- 後端骨架：`backend/app/{config,db,main}.py` 已完成 `create_app(settings)` 工廠與 `/api/website/v1/health`；`backend/tests/test_config_isolation.py`（7 項）與 `test_health.py`（1 項）共 8 項 `uv run pytest -q` 全數通過，涵蓋拒絕連 `ivymanagement`、拒絕非明確標示的測試 DSN、拒絕過短/缺漏 session secret、production 禁用 fixture、錯誤訊息不外洩密鑰等；`uvicorn app.main:app` 對真實 `ivy_website_dev` 開發庫可正常啟動並回應 health check。

## Task 2：字型缺字檢查（2026-09-19，`scripts/check-font-coverage.py`）

用 fontTools 讀 `lineseed-bd.woff`／`lineseed-eb.woff`／`noto-sans-tc-600-brand.woff` 的 cmap，比對 `content/site-fixture.json` 中所有「標題類」欄位（title/eyebrow/sectionTitle/name/label/caption/question/watermark 等）去重後的 338 個非 ASCII 字元：

| 字型 | 結果 |
|---|---|
| `lineseed-bd`（全站用字子集） | 缺 9 字：`・ 丁 勾 品 季 消 秋 訊 非` |
| `lineseed-eb`（h1 用字子集） | 缺 275 字（子集僅含目前實際出現的 h1 文案，遠小於 fixture 全部標題欄位範圍） |
| `noto-sans-tc-600-brand`（品牌名子集） | 缺 300 字（子集僅含「常春藤教育機構」六字＋既有頁首英文，非任意標題文字） |
| `lineseed-bd ∪ lineseed-eb` 合併涵蓋 | 缺 9 字（與 bd 單獨結果相同：`・ 丁 勾 品 季 消 秋 訊 非`） |

**結論**：這是預期中的已知限制，不是程式錯誤——`lineseed-eb`／`noto-sans-tc-600-brand` 本來就只子集化了「目前網站實際用到」的字，不是任意 CMS 可編輯標題的完整字庫。規格 3.1.1／計畫 Task 4 已排定「階段 B 前取得完整 LINE Seed TW Bold／ExtraBold 轉 woff2」；階段 A 沿用子集，但**後台若在階段 A 就開放任意標題輸入，遇到上表缺字會靜默退回 PingFang**，這點在 Task 2／Task 5 checklist 已標記為必須顯示涵蓋率提示、不得默默退回系統字。目前 Nuxt 首頁與義華校元件對「已存在於子集內」的文字（bd 子集只缺 9 個生僻字）風險低；`lineseed-bd` 缺的 9 字建議一併排入階段 B 完整字型置換時修掉，避免子集切換後仍缺這幾字。
