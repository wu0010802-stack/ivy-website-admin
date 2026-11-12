# 常春藤 30 週年紀念影片《長成自己喜歡的樣子》

2026-11-10。企劃、分鏡與配樂提示點見 [`TREATMENT.md`](TREATMENT.md)；配樂的結構與授權見 [`music/README.md`](music/README.md)。

主片 16:9、1920×1080、30 fps、2 分 24 秒（4320 格）；配樂原創、90 BPM，畫面剪接全部對在拍點上（一拍 20 格、一小節 80 格）。

## 預覽（進版控）

- `preview/poster-16x9.jpg`、`preview/poster-9x16.jpg`：封面（校徽＋「常春藤 30 週年」那一格）。
- `preview/contact-sheet-16x9.jpg`：主片每 2 秒一格的總表（左上角是秒數與小節）。

## 交付檔

成品不進版控（太大），在 `output/anniversary-film/final/`（已 gitignore）：

| 檔案 | 用途 |
|---|---|
| `ivy-30th-film-1080p-master.mp4` | 存檔、活動現場播放（H.264 High CRF 16、AAC 320k） |
| `ivy-30th-film-1080p-web.mp4` | LINE、Facebook、官網（H.264 High CRF 20、AAC 192k） |
| `ivy-30th-film-vertical-master.mp4`、`-vertical-web.mp4` | 9:16 直式（IG Reels、限時動態、Shorts），同一條時間軸重新排版 |

規格、貼文說明與使用前要園方確認的事見 [`DELIVERY.md`](DELIVERY.md)。

## 怎麼做的

整支片是程式算出來的，每一格都能單獨重算：

1. **素材**（`scripts/`，輸出都在 `output/anniversary-film/`）
   - `prepare_footage.py`：園方雲端「官網素材／影片」的兩支 4K 直式影片（明華〈寶貝的快樂城堡〉、2026 畢業典禮宣傳片）
     裁成 16:9 鏡頭。每個鏡頭的框避開燒入字幕與校徽；慢動作用 RIFE 4.26 補幀（`rife.py`，網路結構自己重寫、
     權重只載入張量）。剪接點以影格精確計算，算完自動掃描是否跨到別的鏡頭。
   - `make_sky.py`：第一、二幕〈星圖〉的夜空底圖（domain-warp fbm 的深綠星雲、稜線雜訊的近景塵埃）與五校實景照。
   - `make_map.mjs`：第 18 小節圈裡那張高雄地圖的線條（區界、愛河、湖），從官網 30 週年頁地圖的同一份資料換成星空座標，
     寫到 `film/map-data.js`（已進版控；官網那份資料沒變就不用重跑）。
   - `build_crest_layers.py`：30 週年校徽去背後拆成皇冠、六顆星、左右月桂、兩個孩子、IVY KIDS、30th 緞帶共 12 層。
   - `make_paper.py`：第五幕的米白紙紋。
2. **畫面**（`film/`）：`index.html`＋`film.js` 是一個 1920×1080 的舞台，`window.seek(frame)` 依格數決定所有東西的位置
   （沒有 CSS 動畫、沒有計時器）。`sky.js` 是第一、二幕〈星圖〉：canvas 加色合成的視差星空、星點亮、寬銀幕光窗、
   依五校真實位置連成的星座、星軌與記憶光球、圍著星座一年亮一顆的「三十年的星環」，以及星環合起來時圈裡浮出的高雄地圖（設計見 TREATMENT.md 最後三節）；`film.js` 是影片段的字卡、
   逐字浮現的字、第五幕校徽逐層組裝與片尾。
3. **算圖**：`scripts/render.mjs` 起本機靜態伺服器、用無頭 Chromium 逐格截圖，送進 ffmpeg 存成近無損分段（BT.709）。
4. **配樂**：`music/`，見該資料夾 README。**音效**：`scripts/foley.py` 依〈星圖〉的格數合成光與空氣的聲音
   （聚光的氣聲、點亮的鐘聲、光窗掃頻、鏡頭移動的「咻」、星軌的氣流、星環合起來的上行鐘聲與閃光、流星、衝進明華的風聲；
   比配樂小 13–27 dB，只補質感）；`scripts/mix_final.py` 和配樂相加（音效的音頭撞到配樂峰值的地方閃避 20 毫秒）後
   重新確認 −14 LUFS、真峰值 ≤ −1 dBTP。
5. **合成**：`scripts/assemble.py` 接分段、加底片顆粒與很輕的暗角、配上聲音，輸出交付檔並量響度。

```bash
cd design/anniversary-film-20261110/scripts
python3 prepare_footage.py build
python3 make_sky.py && python3 build_crest_layers.py && python3 make_paper.py
node make_map.mjs   # 官網的地圖資料有變才需要
node render.mjs range 0 4320 --workers=3
python3 foley.py && python3 mix_final.py
python3 assemble.py
# 直式 9:16：prepare_footage.py build --vertical、render.mjs ... --fmt=v、foley.py --vertical、mix_final.py --vertical、assemble.py --vertical
```

放上官網（2026-11-11）：`python3 scripts/build-anniversary-film.py`（repo 根目錄的 scripts/）從這裡的分段與聲音重壓網頁版，連同無聲預告、封面、縮圖輸出到 `web/public/assets/anniversary-film/`；頁面是 `web/app/components/AnniversaryFilm.vue`。

需要：ffmpeg、Python（numpy、scipy、Pillow、opencv-python-headless、torch CPU）、Node 22＋Playwright、
LINE Seed TW（官方 zip）與 Source Sans 3 字型檔放在 `output/anniversary-film/fonts/`。
園方影片要先下載到 `output/anniversary-film/src/minghua.mp4`、`graduation.mp4`。

## 內容規則（沿用官網）

- 年份、區名、標語全部取自官網已上線的內容：`web/app/utils/anniversary/timeline.ts` 的沿革（年份與區名）、
  `site-fixture.json` 的「孩子的第一所學校，也是第二個家。」「在遊戲裡，慢慢長大。」「每一天都有新發現」
  「把每個孩子，放在心上。」「從一間幼兒園，長成五所校園。」頁尾「陪伴每一個孩子，長成自己喜歡的樣子。」、
  30 週年頁的「從義華的第一間，到現在高雄的五所校園。」。
  新寫的字只有：星軌那段的「一年，又一年。」，以及五校各一行的說明（2026-11-12 使用者同意改成接力的一句話，
  只用成立年份的間隔與區名，見 TREATMENT.md 最後一節）。
- 影像全部是常春藤自己的照片與影片；不寫人數、活動、故事；外師特寫等以大人為主角的鏡頭不用。
- 顏色只用品牌色；片尾字標依品牌規範（中文 Noto Sans TC 600 Logo 綠、英文 Source Sans 3 400 Logo 藍、與中文等寬）。

## 授權與出處

- 影片素材：常春藤明華校〈寶貝的快樂城堡〉、〈2026 畢業典禮宣傳片〉（園方提供）。
- 照片、30 週年校徽：常春藤官網素材（30 週年校徽依業主 2026-10-04 同意用於 30 週年內容）。
- 五校位置與第 18 小節圈裡的高雄地圖：官網週年頁的地圖資料（`web/app/utils/anniversary/map-data.ts`）。
  區界＝內政部國土測繪中心鄉鎮市區界線（政府資料開放授權條款）；湖泊、愛河＝© OpenStreetMap 貢獻者（ODbL）。
  **公開發布時影片說明要標這一行出處**（DELIVERY.md 的貼文說明已經帶上）。
- 字型：LINE Seed TW（SIL OFL 1.1）、Source Sans 3（SIL OFL 1.1）、Noto Sans TC 品牌子集（SIL OFL 1.1）。
- 鋼琴取樣：Salamander Grand Piano V3，Alexander Holm，CC BY 3.0。
- 其他樂器：MuseScore General SoundFont（MIT）。
- 補幀：RIFE 4.26（hzwer，MIT）。
