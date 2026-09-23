# 拍立得翻面暗示・第四輪 — 2026-09-23（使用者選 B，已接進 web/）

使用者附「03 一起用餐」截圖，要更不明顯、或更有創意的翻面暗示，三版 mock-up。三版都保留現行 32px 淡折角與整張可點（可用上方「現行折角」切換看 A／C 單獨效果）；首張偷看與進場掀角是現行機制，不重複示範。

| 版 | 名稱 | 做法 | 明顯度 | 手機 | 減少動態 |
|---|---|---|---|---|---|
| A | 對光透字 | 游標是紙後面的一盞燈：照到處相紙微亮，透出背面的橫線與**反向**字跡（背面內容鏡射一份，版面與 `.back` 相同才對得上） | ●○○ | 停留的那張沿下緣掃光一次 | 保留滑鼠透光，不掃光 |
| B | 捲動飄角 | 膠帶只黏上緣，捲動速度推右下折角 32→最多 52px，欠阻尼彈簧停下回彈；紙繞膠帶擺 ≤0.7° | ●●○ | 滑動一樣有效 | 不做 |
| C | 包邊貼紙 | 一枚圓形好寶寶貼紙中心壓在紙緣：正面露左半（叉子），背面左緣露右半（刀子），翻過去才湊齊 | ●●○ | 同桌機 | 不受影響 |

避開的已否決方向：角落貼籤、提示字、hover 放大折角、正反小圖示、側邊捲起（見 `../flip-button-mockup-20260921/`、`../flip-cue-directions-20260921/`、`../flip-without-copy-20260922/`）。

## 接進官網時（選定後）

- A：`paperPrints.ts` 正面貼圖多取一份背面鏡像，依現有游標點光源距離衰減混入（multiply），光斑用 screen 打亮；CSS 版就是本頁做法。手機 WebGL 在捲動停止 200ms 後才初始化，掃光要等接手後或留在 CSS 版。
- B：沿用 `DayMomentCard.vue` 的 `setEar()`（DOM `--ear` 與 `paper.setEar()` 單一時鐘）；手機捲動中本來就是 CSS 版，WebGL 只重畫角落。要和進場掀角 `runPeel()` 共用同一個彈簧，避免兩個時鐘搶 `--ear`。
- C：正反貼圖各畫半顆，位置由 DOM 量；貼紙元素放在 `.print` 內跟著翻。六枚建議圖示（Phosphor Regular）：早安 `sun`、探索 `magnifying-glass`、用餐 `fork-knife`、安靜 `moon`、玩耍 `tree`、回家 `backpack`。圖示中線要落在紙緣，兩半各自看得懂（叉／刀這組最理想）。

## 檔案與預覽

- `index.html`／`mockup.css`／`mockup.js`：CSS 3D 操作示意，翻面方向與官網一致（右緣掀起往左翻）。網址參數 `?view=a|b|c` 單版並排、`?still=1` 截圖定格（A 光停在 30%/64%、B 折角 48px）、`?ear=0` 關折角。
- `shot.cjs`：Playwright 截圖＋互動檢查（A 實際滑鼠透光、B 模擬捲動的折角曲線、手機 390 無橫向溢出、console 無錯）。
- 截圖：`desktop-comparison.png`、`still-a|b|c.png`、`still-c-back.png`、`live-a-hover.png`、`live-b-gust.png`、`mobile-a|b|c.png`。

本機：repo 根目錄 `python3 -m http.server 8769 --bind 127.0.0.1`，開 `http://127.0.0.1:8769/design/flip-hint-subtle-20260923/`；截圖 `node design/flip-hint-subtle-20260923/shot.cjs`。
