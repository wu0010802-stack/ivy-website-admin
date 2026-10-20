# 首屏影片調亮（2026-10-20）

使用者要求首屏影片調亮一點。素材是陰天拍的、偏灰，上面又疊了文字用的墨綠遮罩；遮罩的對比餘裕已經很薄（手機導覽 4.66），亮度只能從片子本身拿。

沿用 `../hero-video-smooth-20260923/` 的七鏡頭、補幀與畫質處理，在 FFV1 中間檔壓縮前加一道調色，桌機與手機各壓一次（不是拿已上線的 mp4 再壓）。

## 調色

- 亮度：白色 soft-light 的曲線 `y + 0.6 × (D(y) − y)`（`D` 是 W3C soft-light 的 D 函式），只在 limited range 16–235 內套。中間調拉亮，0 與 1 不動：亮部不會爆白、黑位不會發灰。
- 色度：U／V 對 128 放大 1.06，補回提亮後變淡的顏色。
- 直接改 YUV 的值，不經 RGB 往返。
- 強度比較過 .5／.6／.7：.7 暗部開始發霧、頭髮少了層次，取 .6。

## 沒有採用的做法

- **CSS `filter: brightness()`**：亮部先爆白（1.06 倍就有約 5% 像素新爆白，1.15 倍 20% 以上），文字對比由最亮的像素決定，暗部反而沒怎麼變亮。
- **影片上疊白色 `mix-blend-mode: soft-light`**：曲線一樣，但封面還沒載入時混合層底下是透明的，會在墨綠底上蓋出一片灰白；iOS Safari 疊在 `<video>` 上的混合模式也有不套用的紀錄，又沒有實機可驗。

## 檔案

| 檔案 | 畫質 | 大小 |
|---|---|---|
| `hero-grade-master.mp4` | 1080×800、CRF 18，桌機用（同時是 `web/public/assets/hero-campus.mp4`） | 5,434,804 bytes（原 5,672,935） |
| `hero-grade-mobile-crf26.mp4` | 1080×800、CRF 26，手機用（也是消息裡「一起跑向前」的片源） | 2,152,348 bytes（原 2,255,989） |
| `campus-film-run-ungraded.webp` | 「一起跑向前」封面的調色前原檔 | — |

封面套同一條曲線：首屏封面 `web/public/assets/hero-campus-restored-v1-still.webp`（來源是 `../hero-video-restoration-20260922/hero-restored-still.webp`，未調色）、活動影片封面 `web/public/assets/campus-film-run.webp`（來源是本目錄的 `-ungraded`）。重跑不會疊兩次調色。

## 重製

```sh
python3 design/hero-video-grade-20261020/build.py "$HOME/Downloads/常春藤廣告+配音 (1).mp4"
cp design/hero-video-grade-20261020/hero-grade-master.mp4 web/public/assets/hero-campus.mp4
python3 scripts/optimize-site-videos.py
python3 scripts/optimize-site-images.py --only hero-campus-restored-v1-still
```

只重做封面加 `--posters-only`（仍要給原片路徑）。`optimize-site-videos.py` 以 `manifest.json` 的雜湊確認母帶，再複製這兩支到雜湊網址，不再轉碼。

## 驗證

- 兩支 295 幀／30fps／9.833333 秒、無音軌、faststart。
- 12 幀＋封面離線依 CSS 遮罩合成，量每行文字範圍內最亮背景像素的白字對比（遮罩沒改）：

  | 寬度 | 大標 | 內文 | 導覽 | 照片區 L*（無遮罩） |
  |---|---|---|---|---|
  | 1440 | 6.46 → 6.08 | 6.60 → 6.62 | 5.43 → 5.24 | 57.7 → 68.2 |
  | 1280 | 5.20 → 4.86 | 5.76 → 5.50 | 5.04 → 4.99 | 57.7 → 68.2 |
  | 1024 | 5.46 → 5.15 | 5.68 → 5.67 | 5.03 → 4.86 | 57.9 → 68.4 |
  | 390 | — | — | 4.66 → 4.67 | 58.5 → 68.7 |

  新爆白像素 0%。實際輸出與預估平均差 1.4–2.9/255（壓縮雜訊）。
- Chrome 1440／1280／1024／390 截圖：版面與文字位置前後相同；封面截圖與離線模型平均差 1.6/255；截圖照片區 L* 54.1 → 64.4。桌機、手機都播到新的雜湊檔。
- 封面接影片第一幀的色差 1.05 → 1.6/255（平均亮度差 −0.28/255），看不出跳色。
- Safari／iOS 實機未驗證（這次沒有用到瀏覽器特效，只換素材）。

量測腳本與對照圖在 `output/hero-grade-20261020/`（不進版控）。
