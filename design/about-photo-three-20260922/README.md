# 關於常春藤：三款照片構圖 mock-up

2026-09-22，依使用者提供的照片區塊截圖製作獨立比稿。未選定、未整合至 Nuxt 或凍結的 vanilla 原型。

## 開啟

- 並排比較：`http://127.0.0.1:8784/design/about-photo-three-20260922/`
- A 輕盈交疊：`index.html?variant=a`
- B 錯位雙景：`index.html?variant=b`
- C 一頁童年：`index.html?variant=c`
- 各方向可切換「完整區塊／照片細節」。手機保留照片構圖，介紹可展開。

使用 repo 根目錄的靜態 HTTP server；不能直接以 file:// 開啟。未開啟 server 時，從 repo 根目錄執行 `python3 -m http.server 8784 --bind 127.0.0.1`。

## 設計差異

- A：主圖還原 4:3，副圖寬 54%，只在下緣少量重疊；細米白框與淡陰影。
- B：去框、兩圖錯位且留有空隙；主圖靠右、副圖靠左下。
- C：共用米白相紙，主圖下方並列探索照片與原有圖說。

三款共用原有 `#c5ded0` 背景、LINE Seed TW 標題字型與現行文案；完整區塊保留背景大字。mock-up 工具列僅供比較，不屬於官網設計。

## 素材

- `web/public/assets/about-curious.webp`：760×570。
- `web/public/assets/learning.webp`：1000×402。
- `about.json`：建立本次比稿時，擷取 `web/server/data/site-fixture.json` 的 `home.about`，避免後續其他工作影響比較。
- 照片未重建、未修復、未替換人物。原始素材的清晰度限制仍然存在。

## 驗證

瀏覽器截圖與版面檢查保存在 `output/playwright/about-photo-three-20260922/`。

- Chrome 320／390／768／1024／1440／1920px × A／B／C，共 18 個版面通過，無水平溢出、破圖、圖說遮住照片或 runtime error。
- 並排比較連結、A／B／C 切換、完整區塊／照片細節切換、手機介紹展開收合通過。
- 11 張截圖含桌機／手機各三款、三款照片細節、桌機／手機比較頁。
- `node --check app.js`、`node --check design/about-photo-three-20260922/mockup.js`、`python3 package_preview.py` 通過；凍結的 `preview.html` 重打包前後 SHA-256 相同。
- 主標字型子集包含原有標題與背景大字。此次僅以本機 Chrome 驗證，未做 Safari／iOS 實機驗證。
