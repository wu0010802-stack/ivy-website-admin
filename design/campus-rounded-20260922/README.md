# 分校資訊圓角影像輪播提案

2026-09-22，使用者確認後已整合至 Nuxt 首頁 `web/app/components/CampusBoard.vue`。此目錄保留為設計參考；實作預覽為 `http://127.0.0.1:3010/#campuses`。

本輪字體與配色：中文使用 PingFang TC／Microsoft JhengHei 系統字，標題與校名為 500；英文與電話載入既有 Source Sans 3 400（ASCII 子集）。控制列採細邊暖灰底與墨綠進度。

設計參考為使用者提供的 Apple 產品重點照片輪播。以暖瓷白底、低飽和墨綠文字、香檳金行動按鈕與 PingFang TC 中等字重校名，呈現中央照片、左右預告與獨立控制列。桌機照片 28px 圓角、手機 24px；地址／電話移到下方，不壓在照片上。

從 repo 根目錄啟動：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

開啟 <http://127.0.0.1:8765/design/campus-rounded-20260922/>。頁首對照與校園介紹連結使用 `http://127.0.0.1:3010` 的既有 Nuxt 預覽，需另啟動：

```sh
PATH=/Users/yilunwu/.nvm/versions/node/v22.23.2/bin:$PATH \
NUXT_WEBSITE_ENV=development NUXT_PUBLIC_CONTENT_MODE=fixture \
npm --prefix web run dev -- --host 127.0.0.1 --port 3010
```

- 控制列以原生 `position:sticky`／`bottom` 跟隨捲動，範圍限定在照片與控制列的 `.gallery-media` 內；自然位置超出畫面下緣時靠下顯示，回到原位置後隨照片離開，不遮蓋下方聯絡資訊。保留 safe-area 間距，不加入額外捲動動畫。
- 移除照片下方的上一／下一校圓形按鈕；以校名、膠囊圓點與滑動切換。LINE／Facebook 使用現有網站的品牌圖示，移除社群文字後的外連箭頭。
- 五校資料與照片直接取既有 fixture／public assets。四校缺少 LINE 的狀態保留「待園方提供」。
- 依本輪指示，移除圖片圖說／張數及「認識○○校」，常態顯示「預約參觀○○校」入口並帶入所選校區。首頁入口已改為常駐的 NuxtLink，預約頁繼續讀取 CMS 模式；沒有修改正式 CMS 的預約開放狀態。
- 支援每 4 秒輪播、暫停／續播、滑鼠閱讀與鍵盤聚焦暫停、左右方向鍵、Home／End、照片橫向滑動及減少動態。
- 此頁為獨立區塊預覽；Nuxt 首頁整合驗證另外記錄在 `output/playwright/campus-rounded-site/`。
- 義華原圖只有 590×388，其他四校為 1000×522。最終大圖效果需要園方提供高解析原照；沒有生成或放大假素材。

驗證腳本與桌機／手機截圖位於 `output/playwright/campus-rounded/`。Nuxt 整合沿用現有 Vue 元件、responsiveImage 與 carouselClock，未直接搬入預覽的 JavaScript。

本輪驗證：六尺寸 × 五校 30 個版面狀態與輪播互動通過；短桌機、手機的下緣停靠、回到原位、離開照片區與進入前不浮出等捲動狀態通過。新配色實測標題 13.15:1、次要文字 5.89:1、預約按鈕文字 8.01:1、未選圓點 4.26:1。紀錄 `output/playwright/campus-rounded/scroll-style-checks.json`；Safari／iOS 實機尚未驗證。
