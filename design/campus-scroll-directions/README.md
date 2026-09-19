# 分校資訊：六輪比稿紀錄（2026-09-18）— 定案 e3 底板卡，已併進站內

> **2026-09-18 23:20 已併站**：e3（底板 d1）成為首頁預設，`?campus=` 參數、`campus-scroll.css` 的動態載入、滿版捲動與示意地圖程式碼都已從 `app.js` 移除；本目錄的比稿頁連結已失效，只留截圖與取捨作紀錄。定案規則見 DESIGN.md「五校底板卡 e3」。改前快照 `versions/before-campus-board-e3-20260918-231737/`。

使用者要求：分校資訊區塊改成和上方「孩子的一天」一樣滿版，往下滑會切換分校。**不是另做的 mock-up**：三個方向都直接跑在主站首頁的真實區塊上，站上預設（不帶參數）仍是現在的「五校分區輪播」。

## 開啟

```sh
python3 -m http.server 8886 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

- 比稿頁（三方向截圖並排＋取捨）：<http://127.0.0.1:8886/design/campus-scroll-directions/>
- a 全幅顯影：<http://127.0.0.1:8886/index.html?campus=a#/home>
- b 疊相片：<http://127.0.0.1:8886/index.html?campus=b#/home>
- c 地圖引路：<http://127.0.0.1:8886/index.html?campus=c#/home>

開了之後從首屏一路往下捲到「孩子的一天」之後即是。

## 三個方向

| | 做法 | 好處 | 代價 |
|---|---|---|---|
| **a 全幅顯影** | 照片鋪滿視窗、深綠底暖黃點綴，文字左下、五校清單靠右、右下半透明小地圖；切校交叉淡入＋緩慢推近 | 和「孩子的一天」同一語彙、最有氣勢；手機不用另外設計 | 每校只有 640px 外觀照，鋪滿會軟；首頁下半段連兩段暗底 |
| **b 疊相片** | 左欄標題、五校清單、01/05、示意地圖固定；右欄每校一張大相片卡從下方蓋上來，舊卡縮小變暗疊在後面 | 淺色底有喘息；五校名稱永遠可見；資訊區實底可讀性最穩 | 疊卡是連續動畫，快捲會閃；矮視窗要先收社群列 |
| **c 地圖引路** | 左半整面示意地圖，鏡頭平移到目前校區並逐段畫出路線；右半校名底線指示＋相片資訊像底片橫向滑過 | 唯一講清楚地理位置的；橫向與上方直向堆疊形成對比 | 示意地圖放大後「不是真地圖」更明顯；手機地圖只剩 26vh |

## 檔案

- `campus-scroll.css`：三方向樣式，`app.js` 在 `?campus=` 有值時才動態 `<link>` 進來，不碰 `styles.css`／`studio.css`。
- `app.js`：`CAMPUS_SCROLL` 參數解析（檔頭）、`campusScrollSection(v)`（DOM，三方向共用）、`setupCampusScroll()`／`disposeCampusScroll()`（捲動進度→ `--t`／`--d`、清單與圖釘點擊、鍵盤、aria-live、c 的地圖鏡頭）。首頁模板與 `render()` 各一處 `CAMPUS_SCROLL?…:…` 分流。
- `shoot.cjs`：`node shoot.cjs [a b c]` 產 `shots/`（桌機 1440×900：t=0／1／1.5／2／4＋簾幕掀一半；手機 390×844：t=0／2／4），並印出 `--t`、當前校與 aria-live 文字、console 錯誤與水平溢出。
- `index.html`：比稿頁。

## 2026-09-18 使用者選 A，要求保留建築線稿

已加回：`.cs-stage` 裡放 `campusArtwork()`，線稿原稿是白底深綠線（無 alpha），在深色照片上用 `filter:invert(1) brightness(1.35)` ＋ `mix-blend-mode:screen` 變成白線浮水印（白底反相成黑、screen 之下等於透明），右上角照片陰影另加一塊 `radial-gradient` 暗角當底，否則亮天空上完全看不見。層級要放在照片面板之上（`z-index:2`，第一次做成 1 被 `.is-active` 面板蓋掉）。切校時 `setupCampusScroll()` 先加 `.is-swapping` 淡出、預載新線稿再換上淡入。手機縮成 300px、暗角改成橫向。b／c 仍不顯示線稿。

### 第二輪：右上角白線版被判「太怪」，改出三種放法（`?campus=a1|a2|a3`，比稿頁 `line-art.html`）

每個 `.cs-panel` 內多一張 `<img class="cs-art">`（該校線稿），不再用共用的 `.campus-artwork`；`campusScrollSection()` 依 `v` 決定要不要輸出，section 同時掛 `cs-a` 與 `cs-a1` 等 class。

| | 做法 | 好處 | 代價 |
|---|---|---|---|
| **a1 藍圖板** | 左 46% 墨綠板子：線稿反相成米金線（`invert+sepia`＋screen）放上半、資訊放下半；右 54% 照片 | 線稿有自己的底、文字在實底上 | 照片只剩半邊；手機變上照片下板子 |
| **a2 米白資訊帶** | 上 60% 照片，下 40% 米白帶；線稿原樣（深綠 multiply）放帶子右側，淺色地圖、資訊一列 | 線稿與地圖都是站上現況；深淺分開 | 照片切成 2.4:1；矮視窗收社群列 |
| **a3 素描顯影** | 停下是乾淨照片；捲動中照片褪掉、白線線稿浮在墨綠底上，下一校線稿接手再顯影。全靠 `--d`：照片 `1 − |d|×2.4`、線稿 `min(|d|×2.6, 1.7 − |d|×2.1)` | 和拍立得顯影同一個動作、靜止最乾淨 | 線稿只在捲動中出現 |

踩坑：a3 的 `.cs-a .is-active .cs-body` 特異性高於 `.cs-a3 .cs-body`，所以捲動中當前校的文字仍會顯示（結果像藍圖標題，先保留）；a1 手機版 `.cs-body` 的 `bottom` 要重寫回 `pad-y + 52px`，否則按鈕壓到底部的號碼列。

### 第三輪：選定 a1，指定四項修改＋更多版面（`?campus=a1|a1b|a1c`，比稿頁 `a1-layouts.html`）

使用者指定：地圖換 Google 地圖、線稿不要佔那麼大、拿掉「認識Ｘ校」、換更好看的粉絲團圖示。a1 系列（`/^a1/`）共同做法：

- **Google 地圖**：每校面板各一個 `campusMapFrame(c,'cs-gmap')`（`data-src` 延遲）。`setupCampusScroll()` 用 IntersectionObserver 在區塊接近視窗後才「武裝」，且只載當前校那一個 iframe（`loadMap()`），已載過的保留；非當前面板 `visibility:hidden`。理由同站內：Google 嵌入載入會搶焦點把頁面捲走。手機不放地圖，`.cs-actions` 裡多一顆 `.cs-maplink`「在 Google 地圖開啟 ↗」（桌機隱藏）。
- **線稿章**：`.cs-art` 縮到 `min(板寬×.42, 270px)`、放板子右上角標題旁；`right` 要寫成 `calc(100% − var(--plate) + …)`，因為面板是全寬、板子只是 `::before`（第一次寫成 `right:pad-x` 跑到照片那側去了）。
- **社群徽章**：40px 單色細圈（`.cs-a1 .campus-link .campus-link-badge`，特異性要壓過 `styles.css` 的 `.campus-link.line .campus-link-badge` 品牌色）、hover 轉金、待補帳號用虛線圈；手機縮 32px 並藏第二行小字。
- **不留「認識Ｘ校」**：`campusScrollSection()` 在 a1 系列改輸出只有預約按鈕＋（手機）地圖連結。

| | 版面 | 好處 | 代價 |
|---|---|---|---|
| **a1** | 側板＋照片；Google 地圖是照片右下的 320×210 玻璃卡 | 板子最乾淨 | 地圖卡壓掉一角照片、白底在深色上跳 |
| **a1b** | 側板：資訊在上半、底部 32% 整塊 Google 地圖；照片全高乾淨 | 照片完整、地圖最大 | 板子上半滿，矮視窗收社群列 |
| **a1c** | 照片上 58% 全幅、下 42% 橫向墨綠板：資訊｜線稿章｜地圖 | 照片全幅、一列讀完 | 照片 2.4:1 易裁塔樓 |

### 第四輪：d 底板卡（`?campus=d`）——站上外框＋a1c 舞台，不滿版、不放地圖

使用者要「結合原本右上角線稿的位置，採用 a1c 底板，不堅持滿版與地圖」。做法：`campusBoardSection()` 輸出和站上輪播版**一模一樣的外框**（`campus-panorama` 的置中標題、`campusArtwork()` 右上線稿、`.campus-picker` 軌道），舞台換成 `.board-stage`：2.4:1 全寬照片（24px 圓角卡）＋ `.board-plate` 墨綠底板（校名＋地區｜地址、專線｜單色圈社群｜右側預約鈕＋「在 Google 地圖開啟 ↗」）。切換**直接沿用 `setupCampusShowcase()`**（同一組 class／id 鉤子：`.campus-track`、`#campus-stage`、`.campus-stage-photo`、`.campus-stage-info`、`.campus-stage-actions`、`.campus-art-building`、`#campus-live`），只補了兩處：地圖相關的 `svg`／`route` 允許為 null，`apply()` 依 `data-variant="d"` 改用 `boardInfo()`／`boardActions()`。手機：照片 4:3、上一／下一校浮在照片右上、底板單欄。

### 第五輪：d 的三種比例（`?campus=d1|d2|d3`）

| | 照片 | 底板 |
|---|---|---|
| **d1 寬幅細板** | 2.8:1 | 一列：校名｜地址電話｜社群直排（左細線）｜預約鈕＋地圖連結；`.campus-stage-info{display:contents}` 讓子元素直接進 grid |
| **d2 標準大板** | 2.2:1 | 加高：校名 3rem、地址專線直排、社群 44px 圈＋第二行、56px 預約鈕 |
| **d3 高照片窄板** | 1.85:1 | 最窄一列：社群只留 40px 圓圈（文字視覺隱藏、手機還原） |

手機三版都退回 4:3 照片＋單欄底板。`shoot-d.cjs` 在 scratchpad（`node shoot-d.cjs d2`），產 `shots/d{n}-{desktop,phone}-{yihua,chongde,section}.png`。

### 第六輪：卡片相對米白背景的比例（`?campus=e1|e2|e3`，底板同 d1）

使用者澄清「比例」指的是卡片相對背景。三版都掛 `board-d1 board-e{n}`：**e1** 卡片 `min(1180px,100%)` 置中；**e2** `.container` 撐滿、標題與軌道另設 1560px 欄、卡片無圓角、照片 3:1、底板內距用 `max(36px, (100% − 1560px)/2 + 48px)` 對齊欄；**e3** section 背景改成 `linear-gradient` 上米白下墨綠（`--band-top: calc(100% − 300px)`，手機 420px），卡片 1320px、照片自己帶 24px 圓角、底板去背景落在色帶裡。

## 實作上的幾個點

- 區塊高度 `100svh + (n−1) × 80svh`（手機 70svh），舞台 `position:sticky; top:0; height:100svh`。JS 每格只寫 `--t`（0…n−1）與各 panel 的 `--d = i − t`；a 用 `Math.round(t)` 切 `.is-active`，b／c 全靠 CSS `calc()` 拿 `--d` 算位移（`max(0,var(--d))` 是未到、`min(0,var(--d))` 是已過；`abs()` 用 `max(d, −d)` 寫以免舊 Chrome 不認）。
- **簾幕相容**：`.day-reveal[data-motion=on] .campus-panorama{margin-top:-100svh}` 讓區塊墊在「孩子的一天」底下，區塊頂到達視窗頂的那一刻＝簾幕掀完，舞台的 sticky 恰好從那時開始生效，不需要改 `setupCurtain`。保留 `campus-panorama` class 就是為了吃到這條規則。
- 右上浮動膠囊會壓到區塊右上角：b 的卡片與 c 的校名列各留 `--pill-gap`（54px，手機 64px）；a 的清單在右側垂直置中所以不衝突。
- c 的地圖鏡頭：把 `campusMap()` 產出的內容包進 `<g class="cs-pan">`，用 SVG `transform="translate(cx cy) scale(1.25) translate(−px −py)"` 把目前圖釘（相鄰兩校間線性內插）停在視窗 42% 處，右邊留給校名牌；手機不放大。路線是 `pathLength="1"` 的 polyline，用 `stroke-dashoffset = 1 − 進度` 逐段畫出。
- 校名清單／圖釘點擊＝`scrollTo(start + distance × i/(n−1))`；`prefers-reduced-motion` 時改 `instant`。aria-live 延遲 400ms 播報，第一次進場不播報。非當前 panel 設 `inert`。
- 提示「往下滑，走過五所校園」在 `t > .2` 後淡出（`.is-pinned`）。

## 驗證（2026-09-18）

`node shoot.cjs`：a／b／c × 桌機／手機皆無 console 錯誤、無水平溢出；`--t` 與 `.is-active`、aria-live 文字在 t=0／4 對得上義華／仁武。`node --check app.js` 通過。不帶參數的首頁未動（仍走 `campusShowcase()`／`setupCampusShowcase()`）。

## 拍板後要做的事

- 把選定方向的 CSS 併進 `styles.css`／`studio.css`，移除 `?campus=` 分流與動態 `<link>`，`package_preview.py` 若要內嵌 `campus-scroll.css` 要另外處理。
- 舊輪播的 6 秒自動播放、`role=tablist` 語意要退場；DESIGN.md「五校分區輪播」節改寫。
- 正式版每校至少 1400px 寬的外觀照（a 最吃這個）。
