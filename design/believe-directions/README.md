# 「我們相信」區塊方向畫布（2026-09-15）

首頁 hero 之後的「我們相信」區塊，三個設計方向的 mock-up，供園方／使用者挑選後再實作。

- `gen.py`：產生三個畫板（`Main.dc.html` 方向 A、`DirectionB.dc.html`、`DirectionC.dc.html`）、`canvas.json`、四張示意照片與標題字型子集 `lineseed-canvas.woff`。照片從 `~/Downloads/常春藤廣告+配音.mp4` 抽幀並避開校徽與字幕；影片不在時沿用既有 jpg。
- 三個方向共同點：拿掉裝飾葉子、把「我們相信」eyebrow 收回標題上方；差別在：A 左文右圖作證、B 三個信念沿一條往右上長的黃線排列、C 每個信念配一張直式照片錯落排列。
- 色彩、字級、間距皆對照 `styles.css` / `studio.css` 的實際值（container 1280、section padding 96/88、h2 40px LINE Seed TW Bold、h3 20px、內文 15/14px）。
- 畫布連結：https://claude.ai/artifact/HRJyjdbVqoFT2TNGXNMFKM （第一頁為採用的「關於常春藤」左文右圖版，第二頁為未採用的方向 B、C）。
- 2026-09-15 已依採用版實作進 `app.js` 的 `home()` 與 `studio.css`，決策記錄在 DESIGN.md「關於常春藤區塊」節。
