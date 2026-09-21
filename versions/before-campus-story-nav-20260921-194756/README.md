# 2026-09-21 分校滿版捲動三方向 mock-up

使用者要求：目前首頁分校資訊改成滿版，捲動切換五校，先提供三個不同 mock-up。**後續已選定 B 左右分景；建築線稿位置接續在 `../campus-b-lineart-20260921/` 比較，尚未併入 `web/`。**

- A 全景換幕：滿寬橫景照片＋深綠三欄資訊帶，完整場景由下往上換幕。
- B 左右分景：暖白資訊側欄留在原位，右側滿高校園照片向上更替；手機改上下配置。
- C 橫向校園長廊：直向捲動驅動整組圖文橫移，校名跨接照片；手機保留橫移，但資訊重排在照片下方。

開啟 `http://127.0.0.1:8781/design/campus-fullscreen-20260921/` 比較；每款有 `stage.html?direction=a|b|c` 獨立滿版網址。比較頁可切桌機／手機。若預覽伺服器未啟動，在 repo 根目錄執行 `python3 -m http.server 8781 --bind 127.0.0.1`。

互動：原生頁面捲動，不攔截 wheel／touch；每校有停留區間，五校後自然接下一段。校名按鈕可直接跳到對應進度，支援方向鍵、Home／End。`prefers-reduced-motion:reduce` 變成五校普通直向列表，不把內容藏在動畫裡。

CSS view timeline 驅動場景 transform，`@supports` 同時檢查 animation-timeline／animation-range；不支援時使用 passive scroll＋requestAnimationFrame。加上 `?direction=a&fallback=1` 可比較備援行為。JS 僅更新目前校區、inert／aria-hidden、連結可及性及進度。

資料來自 `web/server/data/site-fixture.json` 的五校核心欄位，快照於 `campuses.js`；照片與字型沿用根目錄 `assets/`，图示擷取自既有 `IconSprite.vue`。LINE 未提供時維持待補；保留 fixture 中既有 Facebook URL，不自行推測其他帳號。預約沿用當前畫面的暫停狀態，沒有接預約送出或寫入 API。

驗證：Chrome／Playwright 在 1440×900、390×844、320×740 檢查三款五校的正向／反向切換，共 63 組狀態，無水平溢出、無圖片載入失敗或 JavaScript runtime error。另驗證非原生動畫備援、點選五校／Home 鍵、減少動態下五校皆可存取，以及比較頁切換方案／手機寬度。B 版手機已修正未啟用照片遮住聯絡資訊的裁切問題。

桌機／手機各三張與切換中截圖在 `shots/`，`comparison.png` 為三款並排。檢查結果在 `checks.json`，可重跑腳本 `output/playwright/campus-fullscreen-check.cjs`。校名字型子集包含五校用字；比較頁方案標題使用完整系統字型，避免「幕／右／橫」混用字型。本輪不修改正式首頁、資料或凍結原型；Safari／Firefox 未實機驗證。
