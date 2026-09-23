# 標題字型：LINE Seed TW（SIL OFL 1.1）

來源 https://seed.line.me/index_tw.html ，LINE 與華康共同製作，可商用。頁尾已註明出處。

- `lineseed-bd.woff`：Bold（700），子集為 `chars-bd.txt`，即 index.html 與 app.js 出現的所有非 ASCII 字元加 ASCII，供 h1/h2/h3、頁尾品牌名、大字電話使用。
- `lineseed-eb.woff`：ExtraBold（800），子集為 `chars-eb.txt`，只含 h1 用字（hero 標語、五校名、預約頁標題）。
- 內文維持系統字（PingFang TC / 微軟正黑體 / Noto Sans CJK），引言不用標題字型。

文案新增了子集裡沒有的字時，缺字會退回系統字顯示，不會壞；重新產生子集：

```sh
pyftsubset LINESeedTW_OTF_Bd.otf --text-file=chars-bd.txt --flavor=woff --no-hinting --desubroutinize --layout-features='*' --output-file=lineseed-bd.woff
```

正式上線改用 WOFF2（需 brotli）可再省約三成，或改用 cn-font-split 依 unicode-range 切片。

## Nuxt 首屏字型分包（2026-09-22）

`python3 scripts/subset-critical-fonts.py`（需 fontTools 與 Brotli）從現有 `lineseed-bd.woff` 產生帶內容 hash 的兩個 WOFF2、`app/generated/font-manifest.json` 及 `app/assets/css/font-subsets.css`。首屏包依 fixture 的首頁主標與五校名稱取字，目前 24 字／6,680 bytes；其餘 701 字／152,960 bytes 由互斥的 `unicode-range` 按需載入。程式會核對字形聯集與每字字寬，保留原字型全部 725 字；不擴充原本未涵蓋的字形。

Nuxt 只預載首屏包，不再預載整個 Bold 與尚未使用的 ExtraBold。其他字仍可能因頁面下方標題而下載，因此這是減少搶先下載量，不代表全頁只需 6.7 KB 字型。新檔使用一年 immutable 快取；更新文案時可重跑，不必改名稱。CMS 若出現未列入首屏但原本已有的字，會由 remaining 包顯示；原本就缺的字維持系統字 fallback。原始 WOFF、ExtraBold、品牌字型與 OFL 授權保留，凍結原型不受影響。

## 明體改為全站共用（2026-09-23）

- `Ivy Campus Serif` 的 `@font-face` 從 `CampusBoard.vue` 移到 `web/app/assets/css/typography.css`，改成全站宣告；首頁分校資訊、分校頁校名、預約頁大標共用 `--font-serif`。
- 新增 `noto-serif-tc-500-visit.woff`（3.9 KB，9 字：帶著好奇來園走，。），來源同樣是 Google Fonts CSS API 的 `text=`，紀錄在 `noto-serif-tc-500-visit.json`，授權同 `noto-serif-tc-500-campus-OFL.txt`。兩個子集用互斥的 `unicode-range` 分流，不動既有 campus 子集。
- 預約頁大標原本吃系統字 `Songti TC → Noto Serif TC → PMingLiU`，Windows 會落到新細明體；改用自託管子集後各平台一致。改預約頁大標文案時要同步擴充此子集並驗證 cmap。

## LINE Seed TW 原始檔與標點（2026-09-23 查證）

- 原始檔可從 `https://seed.line.me/src/images/fonts/LINE_Seed_TW.zip` 下載（ver02，OFL 1.1，含 OTF／TTF／WOFF2）；與本目錄 725 字子集逐字比對字寬 0 差異，可直接拿來補字重切。
- 原始字型的 `halt` 只涵蓋「」『』（），「，」「。」是置中字形（墨色約 0.40–0.59em），換原始檔也無法靠字型收逗號句號。括號的 halt 值：「 XPlacement −320／XAdvance −500、（ −283／−500；`web/app/utils/paperPrints.ts` 的 canvas 標題照這組數值收行首括號，換標題字型時要重查。

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
