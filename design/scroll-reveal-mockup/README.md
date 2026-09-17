# 首屏向上揭幕 · 互動 mock-up

2026-09-17。獨立設計提案，未整合主站。

開啟本目錄 `index.html`，或啟動專案的本機靜態伺服器後瀏覽：

`http://localhost:8765/design/scroll-reveal-mockup/`

- 沿用校園影片、照片、品牌字型與首頁主標。
- 桌面：影片首屏釘住，影像淡入米白、文字縮淡；由下往上的直線裁切露出淡綠品牌區。
- 手機：保留上方影片、下方文案的結構；捲動距離由 72svh 縮至 38svh，文字只縮小 4%。
- 下方的「首屏／轉場／下一幕」是提案預覽工具，可快速切到三個捲動位置；也可直接上下捲動。
- 先使用原生 CSS view timeline；不支援時使用 passive scroll + requestAnimationFrame。`?motion=fallback` 可檢查 JavaScript 備援。
- 減少動態或高度 680px 以下時，採正常文件排列，取消釘選與縮淡。減少動態／節省資料不自動播放影片。
- 沒有 JavaScript 時，各區仍依序完整顯示。所有素材來自專案 `assets/`，未新增外部依賴。

原站參考：<https://www.wellingtoncollege.org.uk/>。借用捲動揭幕的互動方式，文案、素材及版面為常春藤提案。

## 已檢查

- Chromium：1440×900、1024×800、768×1024、390×844、320×740，無水平溢出。
- 桌面與手機的首屏、中途、完全揭開與反向還原；三個預覽按鈕及導覽錨點。
- JavaScript 備援、減少動態、720×450 短視窗、停用 JavaScript 時的完整文件排列。
- 減少動態時影片保持暫停且未載入 mp4；瀏覽器未出現 JavaScript 錯誤。
- `desktop-{start,transition,about}.png` 與 `mobile-{start,transition,about}.png` 為實際頁面截圖。

Safari／Firefox 尚未實機檢查；此版本用於視覺與互動方向確認。
