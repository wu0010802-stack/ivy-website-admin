# Hero 影片清晰修復版（2026-09-22）

從使用者提供的 `~/Downloads/常春藤廣告+配音 (1).mp4` 重製首頁既有七個片段。
來源為 1080×1080、30fps、55 秒，SHA-256 與各輸出雜湊保存在 `manifest.json`。
使用者確認後已整合 Nuxt，於 2026-09-22 部署至[正式官網](https://web-production-04caa.up.railway.app/)。
Hero web deployment：`1812fc8a-c8f4-4a3e-aed6-15ecfa08f14c`（SUCCESS）；後續活動卡部署亦已逐檔確認保留全部 Hero 更新。

[新舊版預覽](http://127.0.0.1:8794/design/hero-video-restoration-20260922/)

## 交付檔案

三版均為 11.7 秒、30fps、351 幀、H.264／yuv420p、無音軌，MP4 已開啟 faststart。

| 檔案 | 尺寸 | 約略大小 | 用途 |
|---|---|---|---|
| `hero-restored-master.mp4` | 1080×800 | 5.95 MB | 高畫質短片，CRF 18 |
| `hero-restored-desktop.mp4` | 1080×800 | 4.17 MB | 桌機網頁版，CRF 21 |
| `hero-restored-mobile.mp4` | 720×534 | 2.05 MB | 手機網頁版，CRF 22 |
| `hero-restored-still.webp` | 1080×800 | — | 黃衣女孩首幀封面 |
| `hero-before.mp4` | 1080×800 | 2.32 MB | 本次修復前的網站桌機影片，供比較 |

## 處理方式

- 保留既有鏡頭順序、0.5× 慢速、1080×800 裁切及右上校徽的 `delogo` 處理；避開 31.6–32.4 秒「VIETNAM」衣服字樣。
- 使用輕度 `hqdn3d` 去噪、亮度通道 `cas` 0.18 銳化；不提高飽和度、不改膚色、不放大成 4K。
- 每個鏡頭先輸出 FFV1 無損中間檔，三種交付版各自從中間檔壓縮一次，避免從已壓縮的網站影片再轉碼。
- 第 5 鏡大幅揮手、第 7 鏡跳躍在光流補幀時出現手腳重影；這兩段改保留原始影格、以重複影格維持半速，動態更新為 15fps、封裝仍為 30fps。其餘五段沿用動態補幀。
- 裁切點與總幀數維持原版，保留最後不同鏡頭接回開頭的循環方式。
- 改善來源細節的保存與輸出壓縮，不是生成式影片超解析；原片本身的失焦、運動模糊仍存在。

| 鏡頭 | 原檔區間（秒） | 內容 |
|---|---|---|
| 1 | 29.9–30.64 | 黃衣女孩笑容 |
| 2 | 30.7–31.55 | 戶外活動男孩 |
| 3 | 0.15–1.0 | 跑步 |
| 4 | 1.0–1.7 | 滑步車 |
| 5 | 2.333–3.6 | 戶外遊戲 |
| 6 | 4.833–5.767 | 滑步車女孩 |
| 7 | 5.767–6.567 | 跳躍 |

## 重製

在 repo 根目錄執行（需 FFmpeg／FFprobe）：

```sh
python3 design/hero-video-restoration-20260922/build.py \
  "$HOME/Downloads/常春藤廣告+配音 (1).mp4"
```

鏡頭逐一處理，限制 2 threads；無損中間檔在 `output/hero-video-restoration-20260922/lossless/`。
腳本輸出三種 MP4 與 manifest；比較用舊影片及 WebP 封面另行保留。

## 驗證

- FFprobe 確認三版尺寸／351 幀／11.7 秒／30fps／僅一條視訊串流，逐幀完整解碼無錯誤，MP4 `moov` 位於 `mdat` 前。
- 已檢視七鏡頭中段抽幀、修復前後笑臉細節與跳躍重影；證據在 `output/hero-video-restoration-20260922/`。
- Chrome 1440／390／320px 預覽與三版各一輪完整循環，共 6 組檢查通過；無水平溢出、runtime／資源錯誤。桌機／手機網頁版各輪 0 dropped frames；高畫質版首輪 356 個總幀中 dropped 5 幀。結果與截圖位於 `output/playwright/hero-video-restoration-20260922/`，Safari／iOS 實機未驗證。
- 部署版通過 web typecheck、web 72／admin 27 項測試與正式建置；線上 56 項 HTTP 檢查（含影片／封面逐檔 SHA-256）及 15 組瀏覽器檢查通過，涵蓋桌機／手機自動播放、完整循環、暫停／恢復、離屏暫停及減少動態／省流量／慢速連線／無 JS 封面。證據：`output/railway-hero-restored-20260922-142744/`。
- `node --check app.js`、`python3 package_preview.py` 通過；凍結的 vanilla `preview.html` 無差異。

## Nuxt 採用方式

Nuxt 透過 `web/app/generated/video-manifest.json` 播放雜湊命名的 optimized 檔；只覆蓋 `hero-campus.mp4` 不會更新頁面實際播放內容。
`scripts/optimize-site-videos.py` 會辨識確認版母檔，驗證桌機／手機交付檔的 SHA-256 後直接複製成新雜湊檔名。封面、responsive 圖片 manifest 與來源紀錄已同步，避免再套舊 CRF 26／27 轉碼造成第三次壓縮。
