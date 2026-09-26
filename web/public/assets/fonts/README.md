# 標題字型：LINE Seed TW（SIL OFL 1.1，`web/` 已是完整字型，2026-09-25 起）

來源 https://seed.line.me/index_tw.html ，LY Corporation 與華康共同製作，可商用。頁尾已註明出處，授權全文
在 `lineseed-tw-OFL.txt`。

**`web/`（正式官網／後台）用的是完整字型**（Bold 700、ExtraBold 800 各 13,915 字），不再是子集；官方
zip 為 `LINE_Seed_TW.zip`（ver02，Version 1.400），sha256 記在 `web/app/generated/font-manifest.json` 的
`source.sha256`。OFL 第 3 條不允許修改版（子集、轉檔都算）沿用保留名稱，字型檔內部名稱已改為
`Ivy Heading TW`，保留著作權／版本／OFL 網址（name ID 0、5、14）；CSS 的 `font-family` 仍叫
`'LINE Seed TW'`（這是呈現給使用者的樣式名稱，不是字型內部名稱，不影響授權）。

**凍結原型**（根目錄 `index.html`／`app.js`／`styles.css`，`63a0c05` 之後不再修改）仍用舊的 737 字子集
`lineseed-bd.woff`（Bold）／`lineseed-eb.woff`（ExtraBold）；那 737 字的清單現在只留在
`scripts/data/lineseed-site-chars.txt`（給 `web/` 的 site 分片用，見下），不再是 `chars-bd.txt`／
`chars-eb.txt`——後兩者已改成 `web/` 完整字型的 cmap（見下）。原型檔本身不受這次改動影響，也不會再補字。

- `chars-bd.txt`／`chars-eb.txt`：`web/` 完整字型的 cmap 字表（各 13,915 字，內容相同），後台
  `useTitleFontCoverage` 的缺字提示讀這兩份——因為是完整字型，能提示到的缺字只剩罕見字（Ext-B 區）與
  emoji，一般中文字不會再缺。
- `chars-serif.txt`：跟 LINE Seed 無關，是明體（Noto Serif TC）子集聯集，31 字，見下方「分校區塊明體」。
- 內文維持系統字（PingFang TC / 微軟正黑體 / Noto Sans CJK），引言不用標題字型。

## 100 片切法與首屏預載（`scripts/subset-critical-fonts.py`）

兩個字重各切成 100 片互斥 `unicode-range` 分片，聯集＝完整字型 cmap（不含空白字元，見下）：

1. **critical**：首屏用字（fixture 首頁主標＋五校名保底 ∪ `web/app/generated/first-screen-chars.json`
   實際量到的首屏用字），只有首屏真的用到的字重才預載——2026-09-25 現況是 h1 最終被壓成 700
   （`studio.css` 的 `.studio-hero h1` 被後續規則蓋成 `font-weight:700`），所以**只預載 Bold critical
   （13,852 bytes）**，ExtraBold 不預載。
2. **site**：`scripts/data/lineseed-site-chars.txt`（以 `854e410` 為準的 737 字舊子集用字）扣掉
   critical，依字頻切片，inline 進 `web/app/assets/css/font-subsets.css`。
3. **其餘**：完整字型剩下的字依 Google Fonts 繁中字頻層級（`scripts/data/noto-sans-tc-frequency-tiers.json`，
   常用到罕用）排序切片，每片目標約 40 KB、上限 60 KB，寫進帶內容雜湊的
   `subsets/lineseed-extended-<hash>.css`，由 `web/app/plugins/title-font-slices.client.ts`
   在瀏覽器執行時掛上（不阻塞渲染，也不讓每頁 HTML 多幾十 KB 的 unicode-range）。

**LINE Seed 的 `@font-face` 只有這兩個來源**：`web/app/assets/css/font-subsets.css`（inline，700
critical＋site 4 片）與 `web/public/assets/fonts/subsets/lineseed-extended-<hash>.css`（其餘 700 全部
與全部 800，共約 195 個 `@font-face`）。`styles.css`／任何其他檔案不能再另外宣告 LINE Seed 的
`@font-face`（`web/tests/title-fonts.spec.ts` 會擋；兩份都留瀏覽器會重複下載同一批字）。
`web/app/generated/font-manifest.json` 記錄來源、`preload[]`（目前只有 Bold critical）與各字重的片數／
位元組數，`nuxt.config.ts` 用 `...fontManifest.preload` 預載。

重切指令（需 fontTools 4.63.0＋Brotli；預設讀 `output/fonts-src/LINE_Seed_TW.zip`——`output/` 已
gitignore，沒有就下載，也可用 `--zip` 指定已下載的檔案）：

```sh
uv run --no-project --with 'fonttools[woff]==4.63.0' python scripts/subset-critical-fonts.py [--zip PATH]
```

重跑會核對每片 cmap、每字字寬與 halt 值跟官方 OTF 一致，並拿凍結原型的 `assets/fonts/lineseed-bd.woff`／
`lineseed-eb.woff`（737 字子集，`app.js`／`index.html` 專用，未受這次影響）逐字比對；完成後刪掉
`subsets/` 裡沒用到的舊雜湊檔。空白字元刻意不放進字形（避免改變既有標題行寬），critical 的
unicode-range 仍含 `U+20`，讓它成為 CSS 的 first available font（決定行框高度）。

**已刪除**：舊的 737 字子集 `lineseed-bd.woff(2)`／`lineseed-eb.woff(2)`（`subsets/lineseed-bd-critical-*`／
`lineseed-bd-remaining-*`）與 `scripts/optimize-site-fonts.py`。`scripts/check-font-coverage.py` 是給
凍結原型用的舊工具，不受這次改動影響。

## 明體改為全站共用（2026-09-23）

- `Ivy Campus Serif` 的 `@font-face` 從 `CampusBoard.vue` 移到 `web/app/assets/css/typography.css`，改成全站宣告；首頁分校資訊、分校頁校名、預約頁大標共用 `--font-serif`。
- 新增 `noto-serif-tc-500-visit.woff`（3.9 KB，9 字：帶著好奇來園走，。），來源同樣是 Google Fonts CSS API 的 `text=`，紀錄在 `noto-serif-tc-500-visit.json`，授權同 `noto-serif-tc-500-campus-OFL.txt`。兩個子集用互斥的 `unicode-range` 分流，不動既有 campus 子集。
- 預約頁大標原本吃系統字 `Songti TC → Noto Serif TC → PMingLiU`，Windows 會落到新細明體；改用自託管子集後各平台一致。改預約頁大標文案時要同步擴充此子集並驗證 cmap。
- `chars-serif.txt`（2026-09-25）＝三個明體子集 JSON 的 `characters` 聯集，後台「校名」「首頁五校區塊標題」的缺字提示讀這份（`chars-bd.txt`／`chars-eb.txt` 同理）。擴充明體子集時一併更新，`web/tests/site-structure.spec.ts` 會檢查兩邊一致。

## LINE Seed TW 原始檔與標點（2026-09-23 查證；ver02 已於 2026-09-25 取得並換上完整字型，見上）

- 原始檔取自 `https://seed.line.me/src/images/fonts/LINE_Seed_TW.zip`（ver02，OFL 1.1，含 OTF／TTF／WOFF2）。2026-09-23 查證時先與當時的 737 字子集逐字比對字寬 0 差異；2026-09-25 已直接用它產出上方的完整字型（100 片切法），這個歷史查證紀錄保留供追溯。
- 原始字型的 `halt` 只涵蓋「」『』（），「，」「。」是置中字形（墨色約 0.40–0.59em），完整字型也一樣無法靠字型收逗號句號。括號的 halt 值：「 XPlacement −320／XAdvance −500、（ −283／−500；`web/app/utils/paperPrints.ts` 的 canvas 標題照這組數值收行首括號，換標題字型時要重查。

## 入學資訊頁補字（2026-09-24；此節描述的 737 字子集已於 2026-09-25 由上方完整字型取代）

歷史紀錄：`lineseed-bd.woff` 曾在 2026-09-24 從 725 字擴充到 737 字（入學資訊頁新增 12 字：二冊囉寶曲月楚註貝退遲部）。2026-09-25 起 `web/` 已改用完整字型，不再需要逐次擴充子集補字；`chars-bd.txt`／`chars-eb.txt` 已是完整 cmap。凍結原型仍停在 737 字子集（見上），不會再補。
- `noto-serif-tc-500-admission.woff`（8 字：一到參學從步觀開）給入學資訊頁 hero 大標「從參觀到開學，一步一步來。」，「，。來」由 visit 子集提供；來源記在 `noto-serif-tc-500-admission.json`，宣告在 `typography.css`（明體子集不受這次 LINE Seed 改動影響）。

## 分校區塊明體（2026-09-22）

- `noto-serif-tc-500-campus.woff`：Noto Serif TC 500，CSS 名稱為 `Ivy Campus Serif`；原本只給 `CampusBoard.vue` 的中文區塊標題和校名，2026-09-23 起分校頁校名也共用（見上節）。
- 透過 Google Fonts CSS API 的 `text=` 取得目前所需字元，轉為 5,252-byte WOFF 自行託管；使用者瀏覽時不連第三方字型服務。來源 URL、字元與 unicode range 記在 `noto-serif-tc-500-campus.json`，OFL 1.1 授權附於 `noto-serif-tc-500-campus-OFL.txt`。
- fontTools cmap 已驗證「分校資訊／義華校／明華校／崇德校／國際校／仁武校」全部涵蓋。新增校名或修改區塊標題時，需同步擴充此子集並驗證 cmap；目前 fallback 為 Noto Serif TC／Songti TC／PMingLiU／serif。
- 只使用於 Nuxt `web/`；不加入已凍結根目錄原型或其打包器。

## 開場片頭倒數數字（2026-09-23）

- `oswald-700-leader.woff2`：Oswald 700，只含 0–9（1,560 bytes），CSS 名稱 `Ivy Leader`。字形接近 Academy leader 的粗黑體，只給 `web/app/utils/entranceCurtain.ts` 用 `FontFace` 畫進倒數字表；載入失敗會退回 Helvetica Neue／Arial。
- 來源：Google Fonts CSS API `family=Oswald:wght@700&text=0123456789` 的 woff2 子集，自行託管，瀏覽時不連第三方。OFL 1.1 授權附於 `oswald-700-leader-OFL.txt`（[原始出處](https://github.com/google/fonts/tree/main/ofl/oswald)）。
- 只用於 Nuxt `web/`，不加入凍結的根目錄原型與打包器。

## 頁首品牌字型（2026-09-16）

- 中文「常春藤教育機構」使用 Noto Sans TC 600，檔案 `noto-sans-tc-600-brand.woff`。
- 30 週年版（`index.html?anni=a|b|c#/home`）的「週年」兩字另切 `noto-sans-tc-600-anni.woff`（同家族同字重，`unicode-range:U+5E74,U+9031`），來源是 Google Fonts 的 `NotoSansTC[wght].ttf` 用 fontTools instancer 定在 wght 600 後 `pyftsubset --text=週年`。
- 品牌英文與導覽英文使用 Source Sans 3 400，檔案 `source-sans-3-400-brand.woff`；2026-09-17 擴充為 ASCII U+0020–U+007E，涵蓋大小寫英文、數字與基本標點。
- 來源為 [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2)，分別指定上述 family、字重與 `text` 取得用字子集，再以 FontTools 轉為 WOFF。英文子集擴充時已確認既有品牌字元的字寬不變。
- 原始授權：[Noto Sans TC](https://github.com/google/fonts/tree/main/ofl/notosanstc)、[Source Sans 3](https://github.com/google/fonts/tree/main/ofl/sourcesans3)。OFL 授權全文保存在各字型旁的 `*-OFL.txt`。
- `python3 package_preview.py` 會將這兩個子集內嵌到 `brand-fonts.css`，供 `index.html` 使用，並一併內嵌到單檔預覽。這能避免直接開啟本機 HTML 時，字型檔請求受到 file URL 的跨來源限制。
- 中文字型只用於 `.brand-name`；英文字型用於 `.brand-english` 與 `.header-en`，其他標題繼續使用 LINE Seed TW。中文品牌文案或英文非 ASCII 用字更動時需重新產生對應子集。
