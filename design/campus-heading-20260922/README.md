# 分校資訊標題與選校列：三款置中 mock-up

**11:40 定案更新**：使用者選 B，追加移除選校編號、改明體與放大校名、重排資訊帶；修正版已整合到 `web/app/components/CampusBoard.vue`，可於 `http://127.0.0.1:3010/#campuses` 查看。此資料夾保留原三款比稿，最新截圖在 `output/playwright/campus-heading-b/`。

2026-09-22，依使用者提供五校膠囊截圖製作。沿用最新圓角照片輪播與既有校園照片，只比較標題／五校選單的配置與配色；尚未套用 Nuxt 官網。

- A「經典留白」：墨綠 `#304B40`、古銅 `#8A7047`；中文與英文上下置中，獨立五校膠囊。
- B「雅緻編排」：石墨藍灰 `#3D5057`、暖灰褐 `#786C5C`；雙語標題橫式並排、編號與細底線選校。
- C「綠金迎賓」：深松綠 `#273F36`、暖瓷白 `#FAF7ED`、香檳金 `#D7C398`；置中標頭和跨接底部的選校列。

從 repo 根目錄執行 `python3 -m http.server 8766 --bind 127.0.0.1`，開啟：

- 比較頁：`http://127.0.0.1:8766/design/campus-heading-20260922/`
- 互動預覽：`preview.html?layout=a`，可改為 b／c。
- 拍攝模式：加 `&capture=1` 隱藏比稿工具列。

所有方向預設停在仁武校，供直接比較。保留五校點按、←／→／Home／End、左右滑動，以及手動開始四秒輪播；不以滑鼠停留暫停。照片、聯絡資料來自 `web/server/data/site-fixture.json`；缺 LINE 保留「待園方提供」。校區／預約連結指向本機 Nuxt 3010，需另啟該服務。

中文延用已定案 PingFang TC／Microsoft JhengHei，避免既有 LINE Seed 子集缺「訊」；A 的英文使用 Source Sans 3，B／C 的英文改 Georgia 襯線體作為比稿差異。

## 驗證

- Chrome：3 方向 × 1440／768／390／320px，全數置中、無水平溢出；60 次選校，鍵盤循環通過，按鈕至少 44 × 44px，無 runtime error。
- 三款桌機／手機截圖與 `verification.json`：`output/playwright/campus-heading-20260922/`。
- `node --check design/campus-heading-20260922/preview.js`、`node --check app.js`、`python3 package_preview.py` 通過；凍結原型 `preview.html` 無差異。
- 尚未執行 Safari／iOS 實機驗證。本次僅設計 mock-up，未更動正式 `CampusBoard.vue` 或發布。
