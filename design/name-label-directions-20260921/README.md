# 姓名貼的三種表情 — 2026-09-21

以使用者選定的 B「米白姓名貼、墨綠框、翹角、翻面 icon」深入三個互動方向。這是獨立 mock-up，沒有整合至 Nuxt 元件或變更現有設計裁定。

## 預覽

從 repo 根目錄執行 `python3 -m http.server 8783 --bind 127.0.0.1`，開啟：

`http://127.0.0.1:8783/design/name-label-directions-20260921/`

可以比較全部，或用 `?view=b1`、`?view=b2`、`?view=b3` 單獨查看。點姓名貼翻面、再點返回；上方可一起切換。

| 方案 | 外觀 | 實際點擊區 | 操作考量 |
| --- | --- | --- | --- |
| B1 經典綠框貼 | 米白紙、墨綠細框、純圖示、微翹紙角 | 80 × 48 CSS px | 視覺最輕；用固定提示說明純圖示 |
| B2 雙欄姓名貼 | 米白文字欄、深綠圖示欄、右下紙角 | 125 × 50 CSS px | 「看故事／看照片」隨操作改變；整張為一個按鈕，推薦優先試用 |
| B3 卡邊索引貼 | 鼠尾草綠、圓角索引耳、貼出卡邊 | 70 × 56 CSS px | 點整張貼紙即可；無需拖曳，卡邊保留安全留白 |

三款使用同一張照片、同一份文案、相同卡片尺寸，避免情境差異干擾比較。卡片與貼紙以 HTML/CSS 製作，可直接試點，並非生成式圖片。

## 互動細節

- 保留原站 Phosphor Regular 翻面 icon；背面水平鏡翻。
- 按鈕固定在原位置，不跟卡面旋轉；焦點留在同一顆按鈕。
- 正反面切換 `aria-hidden`／`inert`，集中宣告操作結果；B2 同步切換可見文案。
- 原生 button 支援 Tab、Enter、空白鍵；可見焦點框。
- 桌機滑過會浮起紙角並顯示提示；Escape 關閉浮動提示。
- 手機有持續可見的操作說明，不依賴 hover。
- `prefers-reduced-motion` 直接切換；未提供拖曳或自動翻面。
- 本 mock-up 使用 CSS 3D 展示方向，不重製正式網站的 WebGL 紙張翻頁。

## 內容來源

- `web/server/data/site-fixture.json` 的早安入園資料，保留「陪伴互動 · 入園情境示意」。
- `web/public/assets/day-hello.webp`。
- `web/app/components/IconSprite.vue` 的翻面圖示。

## 已完成驗證

本機 Chrome / Playwright：1440px 桌機、390px 與 320px 手機；照片載入、無水平溢出、三款點擊／鍵盤往返、觸控、焦點保留、隱藏面的 inert、B2 文案切換、Escape、減少動態模式通過。未實測真實手機或 VoiceOver。

可重跑：`node output/playwright/name-label-directions-20260921/check.cjs`（沿用本機既有 playwright-core 路徑）。詳見 `output/playwright/name-label-directions-20260921/verification.json`。

`node --check app.js` 與 `python3 package_preview.py` 已執行；根 prototype 打包內容沒有變更。
