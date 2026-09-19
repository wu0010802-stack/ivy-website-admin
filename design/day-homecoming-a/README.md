# A：把今天背回家

獨立可操作 mock-up，接續 `../day-timeline-directions/r.html` 的六張拍立得。入口：

- `http://127.0.0.1:8886/design/day-homecoming-a/index.html#homecoming`：直接看結尾。
- `index.html#moment-home`：從 R 版的 16:30 照片銜接結尾。
- `index.html?fallback=1#homecoming`：檢查 JavaScript 動畫備援。

## 畫面與操作

六張原照片依序滑入書包，前袋遮住正在收進去的照片；書包闔上、縮小並移到孩子背上，孩子走向家人，最後停留在牽手回家的畫面。收尾文案：「把今天的新發現，帶回最愛的人身邊。」

往下捲動控制故事進度；也可按播放（全段 12.5 秒）、暫停、拖曳進度、鍵盤調整或重播。倒捲可倒放。使用者捲動／觸控操作、分頁進入背景都會停止自動播放。支援 CSS scroll timeline 時採原生動畫；備援使用暫停的 Web Animations API 依捲動進度取樣，沒有持續重繪迴圈。

減少動態偏好直接顯示完成畫面，且移除額外捲動長度與播放控制；偏好即時切換也會套用。無 JavaScript 時仍顯示靜態回家插畫。

## 檔案

- `index.html`：R 版快照加上 A 結尾，保留原照片翻面。
- `ending.html`、`ending.css`、`ending.js`：結尾的分層場景與動畫。
- `build.py`：重新組合 mock-up，執行 `python3 design/day-homecoming-a/build.py`。只寫入本目錄的 `index.html`。
- `media/family-sprites.png`：內建 imagegen 製作的透明人物示意圖，原始 PNG 1536×1024。以 SVG viewBox 分別顯示兩位人物，沒有覆寫既有校徽或照片。
- `media/prompt.md`：人物生成提示詞。
- `shots/`：桌機／手機、靜態模式截圖與 `verification.json`。

R 版原檔與主站未在本次修改。此目錄沿用 R 版的 CSS／JavaScript 與既有相片，不是可單獨搬離專案的單檔網頁。R 本身的 three.js 仍使用既有 CDN；新結尾不需新增動畫套件。

## 驗證

Chrome headless：1440×900、1024×768、768×1024、390×844、320×740；各尺寸檢查收納中、背起書包與完成畫面。播放／暫停、鍵盤 End、重播、倒回、原生與備援、減少動態、停用 JavaScript 通過。無水平溢出或 JavaScript 執行錯誤。Safari、Firefox 尚未實機驗證。

動態偏好實作參考：[MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)。
