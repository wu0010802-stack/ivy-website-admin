# 孩子的一天：捲動翻書 demo

獨立提案，沒有整合或修改首頁。入口為 `index.html`，相對路徑使用專案的 `assets/`，請透過本機 HTTP 預覽。

```sh
python3 -m http.server 8893 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

開啟 <http://127.0.0.1:8893/design/day-flip-demo/>。

## 體驗

- Hero 後直接接繪本。向下翻、向上倒翻；每組內容都有靜止閱讀的捲動區間。
- 桌面（901px 起）：上午、午間、午後三組雙頁，共六個生活片刻。
- 手機與直向平板：六個單頁，保留原生垂直捲動。
- 章節連結、上一頁／下一頁可直接定位；「略過，繼續瀏覽」會移動閱讀焦點到下一區。
- 「改為一般閱讀」切換成六篇完整圖文。減少動態、視窗高度小於 700px、JavaScript 關閉及列印皆使用一般圖文。
- Hero 影片離開畫面或分頁進入背景時暫停；減少動態、省流量及影片失敗時保留封面。

## 實作

- `index.html`：完整語意內容、Hero、銜接區，沒有 JavaScript 仍可閱讀。
- `book.css`：獨立樣式，書頁正反面、單一透視來源、固定閱讀區與響應式排版。
- `timeline.mjs`：由捲動位置直接推導翻頁進度，不排隊播放，快速跳頁與倒翻不累積狀態。
- `book.js`：將相同內容複製到不進入可及性樹的視覺層。原文依原始順序保留給輔助科技。
- 支援時使用原生 CSS view timeline；其他瀏覽器以 passive scroll＋requestAnimationFrame 更新 transform。`?motion=js` 可直接檢查備援路徑。
- 翻頁是硬頁繪本的 3D 旋轉，沒有軟紙彎曲模擬。不引入 GSAP、WebGL 或其他前端依賴。

## 素材與範圍

沿用既有校園影像、影片、校徽及自託管字型；用餐／午休仍使用教室空間參考並明確註記照片待補。六個片刻不是已核定的五校共同作息，也未加入具體時間。

原型內「認識五所校園」連回主站原型，不提交表單、不對外發布。

## 檢查

```sh
node --check design/day-flip-demo/book.js
node --test design/day-flip-demo/timeline.test.mjs
```

瀏覽器檢查腳本、JSON 與截圖位於 git 忽略的 `output/playwright/day-flip-*`。包含桌面／手機尺寸、翻頁中間幀、正反捲動、原生與 JS 角度比對、鍵盤、一般閱讀、略過／重播、減少動態、短橫向視窗與無 JavaScript。

本機驗證使用 Chromium；Safari／Firefox 與實體手機仍需另外驗收。

2026-09-16 驗證結果：4 個進度邏輯測試、31 組畫面／角度／備援檢查及 7 組操作流程通過。涵蓋 1440×900、1280×800、1024×768、768×1024、390×844、375×812、320×740；未發現水平溢出、書頁文字裁切或 JavaScript 執行錯誤。翻起的書頁亦檢查沒有遮住標題或控制區。
