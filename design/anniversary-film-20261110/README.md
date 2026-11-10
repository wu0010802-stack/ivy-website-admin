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
| `ivy-30th-film-1080p-master.mp4` | 存檔、活動現場播放（H.264 High CRF 14、AAC 320k） |
| `ivy-30th-film-1080p-web.mp4` | LINE、Facebook、官網（H.264 High CRF 20、AAC 192k） |

## 怎麼做的

整支片是程式算出來的，每一格都能單獨重算：

1. **素材**（`scripts/`，輸出都在 `output/anniversary-film/`）
   - `prepare_footage.py`：園方雲端「官網素材／影片」的兩支 4K 直式影片（明華〈寶貝的快樂城堡〉、2026 畢業典禮宣傳片）
     裁成 16:9 鏡頭。每個鏡頭的框避開燒入字幕與校徽；慢動作用 RIFE 4.26 補幀（`rife.py`，網路結構自己重寫、
     權重只載入張量）。剪接點以影格精確計算，算完自動掃描是否跨到別的鏡頭。
   - `align_lineart.py`：官網的五校線稿是照實景照描的，但裁切比例不同。先用水彩版做多尺度遮罩模板比對、
     再用 ECC 仿射細修，把線稿與水彩對位到實景照上，「線稿 → 水彩 → 實景」才能原地溶接。
   - `build_crest_layers.py`：30 週年校徽去背後拆成皇冠、六顆星、左右月桂、兩個孩子、IVY KIDS、30th 緞帶共 12 層。
   - `make_paper.py`：米白紙紋。
2. **畫面**（`film/`）：`index.html`＋`film.js` 是一個 1920×1080 的舞台，`window.seek(frame)` 依格數決定所有東西的位置
   （沒有 CSS 動畫、沒有計時器）。逐字浮現的字卡、里程表式的年份滾輪、canvas 畫的常春藤藤蔓與葉子、
   每站的線稿揭露圖（雜訊遮罩）、校徽逐層組裝都在這裡。
3. **算圖**：`scripts/render.mjs` 起本機靜態伺服器、用無頭 Chromium 逐格截圖，送進 ffmpeg 存成近無損分段（BT.709）。
4. **配樂**：`music/`，見該資料夾 README。**擬音**：`scripts/foley.py` 依畫面格數合成鉛筆描線的沙沙聲、
   相片飛到時間軸的紙張聲、翻頁聲（比配樂小 16–27 dB，只補質感）；`scripts/mix_final.py` 和配樂相加後
   重新確認 −14 LUFS、真峰值 ≤ −1 dBTP。
5. **合成**：`scripts/assemble.py` 接分段、加底片顆粒與很輕的暗角、配上聲音，輸出交付檔並量響度。

```bash
cd design/anniversary-film-20261110/scripts
python3 prepare_footage.py build
python3 align_lineart.py && python3 build_crest_layers.py && python3 make_paper.py
node render.mjs range 0 4320 --workers=3
python3 foley.py && python3 mix_final.py
python3 assemble.py
# 直式 9:16：prepare_footage.py build --vertical、render.mjs ... --fmt=v、foley.py --vertical、mix_final.py --vertical、assemble.py --vertical
```

需要：ffmpeg、Python（numpy、scipy、Pillow、opencv-python-headless、torch CPU）、Node 22＋Playwright、
LINE Seed TW（官方 zip）與 Source Sans 3 字型檔放在 `output/anniversary-film/fonts/`。
園方影片要先下載到 `output/anniversary-film/src/minghua.mp4`、`graduation.mp4`。

## 內容規則（沿用官網）

- 年份、沿革、標語全部取自官網已上線的文字：`web/app/utils/anniversary/timeline.ts` 的沿革、
  `site-fixture.json` 的「孩子的第一所學校，也是第二個家。」「在遊戲裡，慢慢長大。」「每一天都有新發現」
  「把每個孩子，放在心上。」「從一間幼兒園，長成五所校園。」頁尾「陪伴每一個孩子，長成自己喜歡的樣子。」、
  30 週年頁的「從義華的第一間，到現在高雄的五所校園。」。
- 影像全部是常春藤自己的照片與影片；不寫人數、活動、故事；外師特寫等以大人為主角的鏡頭不用。
- 顏色只用品牌色；片尾字標依品牌規範（中文 Noto Sans TC 600 Logo 綠、英文 Source Sans 3 400 Logo 藍、與中文等寬）。

## 授權與出處

- 影片素材：常春藤明華校〈寶貝的快樂城堡〉、〈2026 畢業典禮宣傳片〉（園方提供）。
- 照片、線稿、30 週年校徽：常春藤官網素材（30 週年校徽依業主 2026-10-04 同意用於 30 週年內容）。
- 字型：LINE Seed TW（SIL OFL 1.1）、Source Sans 3（SIL OFL 1.1）、Noto Sans TC 品牌子集（SIL OFL 1.1）。
- 鋼琴取樣：Salamander Grand Piano V3，Alexander Holm，CC BY 3.0。
- 其他樂器：MuseScore General SoundFont（MIT）。
- 補幀：RIFE 4.26（hzwer，MIT）。
