# 首次進站：Three.js 紅布幕三案

獨立動畫 mock-up，尚未整合 Nuxt，也未部署。

從 repo 根目錄執行 `python3 -m http.server 8842 --bind 127.0.0.1`，開啟：

- [三案比較](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/)
- [A 經典對開](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/?view=a)：3.2 秒，左右收束的酒紅絨幕。
- [B 劇院升幕](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/?view=b)：3.0 秒，波浪金邊向上收攏。
- [C 柔弧攬幕](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/?view=c)：3.6 秒，弧形拉向兩個上角。

切換方案即自動開幕；可重播、暫停、拖曳進度、略過及進入滿版預覽。Escape 返回比較頁。網址加 `&p=0.52` 可停在 52%，`&paused=1` 可看全閉布幕。每案包含約 12% 開場停留，時長包含停留。

## 實作與素材

- 共用一個 Three.js renderer，使用既有 `web/node_modules/three/build/three.module.js`（r186），不下載 CDN、不新增套件、不更動正式站程式。
- 分段 PlaneGeometry 搭配 vertex shader 做三種布幕形變；fragment shader 依變形法線、光線、細紋和布面摺痕上色。這是設計導向的幾何動畫，並非物理布料模擬。
- 完成後停止 animation frame 並隱藏 canvas；頁面隱藏即暫停；減少動態偏好直接顯示首頁，仍能拖曳看靜態布幕。module 載入失敗、逾時或 WebGL context loss 都露出背景。
- `homepage-desktop.png`、`homepage-mobile.png` 原樣複製自今天本機 Nuxt 的 `output/playwright/mobile-composition-20260922/after-hero-{1440,390}.png`。背景為靜態截圖，保留原有首頁設計；底部可能包含該次開發工具的小型浮標，並非正式站元素。
- 所有文字、比較操作位於 DOM；canvas 只負責裝飾動畫。此頁不接預約或其他業務操作。

## 驗證

`output/playwright/entrance-curtain-20260922/verify.cjs`：Chrome / SwiftShader，1440px、390px、320px，三案渲染、進度拖曳、暫停、略過、依時完成、滿版與 Escape 焦點返回、減少動態、WebGL context loss；截圖與結果存同目錄。未驗證 Safari／iOS 實機或真實 GPU 效能。

另執行 `node --check`（兩個 mock-up JS 及根目錄 app.js）、`python3 package_preview.py`、`git diff --check`。凍結原型重打包無內容差異。

參考：[Three.js 官方文件](https://threejs.org/docs/)。
