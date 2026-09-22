# 分校資訊圓角影像輪播提案

2026-09-22，獨立預覽，尚未定案或整合 Nuxt。

設計參考為使用者提供的 Apple 產品重點照片輪播。以現有米白底、深綠文字、暖黃行動按鈕與 LINE Seed TW 校名，呈現中央照片、左右預告與獨立控制列。桌機照片 28px 圓角、手機 24px；地址／電話移到下方，不壓在照片上。

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

- 移除照片下方的上一／下一校圓形按鈕；以校名、膠囊圓點與滑動切換。LINE／Facebook 使用現有網站的品牌圖示，移除社群文字後的外連箭頭。
- 五校資料與照片直接取既有 fixture／public assets。四校缺少 LINE 的狀態保留「待園方提供」。
- 依本輪指示，移除圖片圖說／張數及「認識○○校」，常態顯示「預約參觀○○校」入口並帶入所選校區。這是預覽顯示，沒有修改正式 CMS 的預約開放狀態；整合時應接回 `BookingCta`。
- 支援每 4 秒輪播、暫停／續播、滑鼠閱讀與鍵盤聚焦暫停、左右方向鍵、Home／End、照片橫向滑動及減少動態。
- 這是獨立區塊預覽，尚未驗證與首頁捲動接力／sticky 的整合。
- 義華原圖只有 590×388，其他四校為 1000×522。最終大圖效果需要園方提供高解析原照；沒有生成或放大假素材。

驗證腳本與桌機／手機截圖位於 `output/playwright/campus-rounded/`。整合時沿用現有 Vue 元件、responsiveImage 與 carouselClock，不直接搬入預覽的 JavaScript。
