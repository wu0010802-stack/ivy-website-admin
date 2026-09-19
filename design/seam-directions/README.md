# 關於 → 孩子的一天：大字接縫（2026-09-18；同日定案 seam=2＋接力效果為預設，`?seam=0` 看舊版、`?study=1` 開效果面板）

參考 Wellington College 的區塊切換：兩個區塊的大字同字體、同字級、同左邊 x，舊區塊大字貼底邊隨區塊捲走，新區塊大字貼頂邊被掀出來，接縫像切過同一欄文字。

- 預覽：`index.html?seam=1#/home`（現況不帶參數）。
- 開關：`app.js` 的 `SEAM` → `html[data-seam="1"]`，`setupBeliefCurtain` 在 seam 模式直接跳過（不做 clip-path 簾幕）。
- 樣式：`studio.css` 結尾 `[data-seam="1"]` 區塊。共用 `--display-size` / `--display-tracking` / `--display-left`。
- 卡片延後：`.day-prints` 在 seam 模式 `margin-top: 100svh - 10svh`，讓接縫走完、大標完整露出後卡片才進場。
- 截圖：`node design/seam-directions/shoot.mjs`（Playwright 在 `~/.npm/_npx/e41f203b7505f1fb`，對應 chromium 1234）。`shots/comparison.png` 為現況 vs seam 三個瞬間。

待拍板：eyebrow「孩子的一天 A DAY AT IVY」目前放在大標下方（接縫由下往上，會比大標先露出）；大標頂邊 20svh；浮水印 opacity .5。

## ?seam=2（使用者提案，2026-09-18 晚）

保留現況簾幕（關於區塊黏住、clip-path 由下往上擦），但把浮水印拆成 `.wm-a`「關於」與 `.wm-b`「常春藤」兩個 span：「常春藤」定位到 `left:calc(50% - 3em)`、垂直 50svh，和置中的大標「常春藤的一天」前三字完全重疊；擦過去時同一位置的字從薄荷綠變白。eyebrow 改絕對定位放在大標下方。

關鍵：日常區塊要在簾幕開始前就釘在視窗頂（`margin-top` 多拉一個 `--belief-distance`），否則大標在擦的過程還在往上滑，只有一瞬間對得上；卡片 `margin-top` 相對延後同樣距離。

「關於」目前留在 container 左邊、常春藤上一行（使用者只說移常春藤）；若要整塊一起右移，把 `.wm-a` 的 `left` 改成和 `.wm-b` 一樣。

### 接力效果（?seam=2，2026-09-18 晚）

`setupCurtain` 多了 `onProgress` 回呼；`relayProgress` 把接縫掃過浮水印「常春藤」字框的進度寫成 `--relay`（頭尾夾住：簾幕未開始 0、走完 1，不然區塊捲走後字框座標會亂跑），另派生 `--relay-glow`、`--relay-day`、`--seam-inset`。頁面左下 `setupRelayStudy` 面板三個開關（localStorage `relay-study`）：

- `relay-ghost`：`.day-ghost`「關於」在影片側同位置留著，擦過後畫面讀成「關於／常春藤的一天」，隨 `--word-fade` 一起退場。
- `relay-day`：大標拆成 `.t-ivy`／`.t-day`，「的一天」在 relay .7→1 從左滑入。
- `relay-glint`：`.home-belief::after` 金線貼在 clip 邊、只跨「常春藤」寬度，relay 頭尾淡出。

截圖：`shots/relay-sheet.png`（relay .15 / .5 / .85 / 完成）。
