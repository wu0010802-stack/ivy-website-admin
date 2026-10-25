# 孩子的一天影片補 sRGB 色彩標記（2026-10-25）

接著首屏影片（`../hero-video-polish-20261024/`）的發現：沒有色彩標記的影片，在 macOS 的 Chrome（硬體解碼）與 Safari 會被當 BT.601／SMPTE 170M 解，中間調再抬高約 11/255。「孩子的一天」背景影片也沒有標記。使用者要求補 sRGB 標記，亮度以正式站螢幕實測對齊。對照頁：`index.html`（repo 根目錄 `python3 -m http.server 8796 --bind 127.0.0.1`，開 <http://127.0.0.1:8796/design/day-film-color-20261025/>）。

## 做法：把「螢幕上現在的樣子」燒進像素，再標 sRGB

只補標記的話，畫面會照檔案值顯示：12 格螢幕實測 L50 53.9 → 48.7、平均 53.4 → 48.9，等於整段暗約 5 L*。這支是彩色的舞台表演，暗部本來就不灰（最暗 0.5% 的 L* 11.7），所以不像首屏那樣重調，而是**原樣重現正式站螢幕上的畫面**：

1. `measure/make.py` 產 17³ 色票測試片（1440×810、24fps、High profile、沒有標記，跟正式站檔同格式；小片 Chrome 會改走軟體解碼、量不到這個效果）。
2. `measure/frames.cjs` 在 Chrome 與 WebKit 原尺寸播放、停格截圖，`measure/read.py` 讀每格中心：兩個瀏覽器平均差 0.38/255，中灰 128 → 139、洋紅 (239,48,143) → (255,82,155)。
3. 兩者平均寫成 `screen-17.cube`（輸入是 BT.601 解出的 R'G'B'，輸出是螢幕上的 sRGB）。拿它預測正式站 12 格螢幕截圖，平均差 0.60/255、p99 3.0（不轉換是 10.89）。單純「gamma 1.96＋3×3 矩陣」模型平均也有 1.05，但飽和色會差到 20 以上，所以改用實測。
4. `build.py`：原片以 BT.601 解 → 套 LUT → BT.709 矩陣 10-bit FFV1 中間檔 → 各壓一次，標 BT.709 原色／矩陣＋sRGB 轉換函數；封面取中間檔第 0 格。

## 交付檔

| 檔案 | 編碼 | 大小 | VMAF（對中間檔） | 用途 |
|---|---|---|---|---|
| `day-desktop.mp4` | x264 High CRF 22、slow | 9,635,511（舊 9,333,850） | 95.21（最低 89.88） | 桌機；也是 `web/media-src/day-film.mp4` |
| `day-mobile.mp4` | x264 High CRF 25 | 7,302,624（舊 7,488,249） | 92.82（最低 84.68） | 手機、橫拿手機 |

舊桌機檔就是母帶本身，新檔多重壓一次。CRF 18 要 13.2 MB（VMAF 97.07），放大兩倍跟 CRF 22 看不出差別（原片已經偏軟），取大小相當的 CRF 22。手機檔跟以前一樣是從母帶重壓一次的 CRF 25。`scripts/optimize-site-videos.py` 認得這份母帶時，手機檔直接採用這裡壓好的，不再從母帶壓第二次。

## 驗證

| 12 格螢幕實測 | 最暗 0.5% L* | L50 | 平均 L* | 平均彩度 | 與正式站平均差 |
|---|---|---|---|---|---|
| 正式站（Chrome） | 11.7 | 53.9 | 53.4 | 27.8 | — |
| 新版桌機（Chrome） | 11.8 | 54.0 | 53.5 | 27.6 | 1.59/255 |
| 新版桌機（WebKit） | 11.7 | 54.0 | 53.4 | 27.3 | 1.71/255 |
| 新版手機（Chrome） | 11.8 | 54.0 | 53.4 | 27.6 | 2.01/255（對正式站手機檔） |

- 封面接第一格：正式站平均差 11.21/255（影片開播時偏亮偏綠，有 0.8 秒淡入蓋著），新版 2.05，平均偏移 ≤0.3。**封面因此比舊的亮一點**（現在跟影片一樣），減少動態、影片載入前或失敗時看到的就是它。
- fixture dev server、Playwright：Chrome 1440 與 WebKit 1440 載入新桌機檔、Chrome 390 手機模擬載入新手機檔，都有淡入、沒有 console 錯誤；同捲動位置、同一格的 Chrome 桌機整頁截圖與正式站平均差 0.89/255。
- web `typecheck`、`test:website` 1361 passed；後端 `test_media_slots.py` 21 passed（獨立測試庫，已刪）。
- 疊在影片上的深綠紗、時段光、白字都沒動；畫面與正式站相同，所以字的對比也不變。

## 重製

```sh
python3 design/day-film-color-20261025/build.py
cp design/day-film-color-20261025/day-desktop.mp4 web/media-src/day-film.mp4
python3 scripts/optimize-site-videos.py
python3 scripts/optimize-site-images.py --only day-poster
```

來源是 `design/day-timeline-mockup/media/day-film.mp4`（正式站換掉前的 day-desktop，`build.py` 會核對雜湊）；4K 原片已不在本機。換封面後手動刪掉沒被 `image-manifest.json` 引用的那組衍生圖。

## 沒驗證

iOS／Android 實機、Firefox、Windows：舊檔在這些環境原本就不一定被抬亮，新檔照原值顯示後，在那些環境可能比以前亮。
