# 導覽收合：三個方向（2026-09-17）→ 定案 B，2026-09-18 已上站

首頁導覽列在**離開首屏（hero）之後**把四個導覽項目收進漢堡選單的三種互動 mock-up。首屏頁首三個方向完全相同（透明底、白字、雙語導覽、細框預約鈕，與 2026-09-17 主站一致），差別都在離開首屏之後。獨立提案，**沒有改主站任何檔案**。

## 開啟

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

- 比較頁：<http://127.0.0.1:8770/design/header-collapse-directions/>（切 A／B／C、桌面／手機，按「首屏／離開首屏／打開選單／重播收合」跳狀態，可勾「減少動態」）
- 單版：`view.html?direction=a`（a／b／c；加 `&reduced=1` 模擬減少動態）
- 分享用 Artifact（私密連結，同一頁面含 view.html 與截圖）：<https://claude.ai/artifact/KwzBCVQSYgew8XB5cmbGhm>

## 三個方向

| 方向 | 離開首屏後的頁首 | 選單 | 取捨 |
|---|---|---|---|
| **A 同組收合**（建議先做） | 四個項目由右往左依序淡出、滑進三條線；三條線與「預約參觀」併成同一組（左細框、右綠底）；頁首 72px 米白底加陰影，Logo 轉回綠字 | 右上下拉小卡：四個雙語項目直排＋五校膠囊 | 最接近現有主站與上一輪 `design/header-collapse-mockup/`，改動最小；下拉卡容量有限 |
| **B 浮動膠囊** | 整條頁首淡出讓位，置頂居中米白膠囊：校徽＋校名、「選單」、綠底「預約參觀」；內容從膠囊兩側流過 | 從膠囊下緣長出同寬卡片（項目兩欄、五校一列、電話），膠囊圓角同步變成只圓上緣 | 品牌感最強、最現代；頁首不再是一條安全帶，深色區塊上會跳，多一組元件要維護 |
| **C 極簡列＋全幕選單** | 頁首 64px 半透明米白毛玻璃；字標收掉只留校徽，右邊綠底預約膠囊＋圓形漢堡 | 深綠全幕，從漢堡位置圓形擴散；左四個大字項目依序浮出，右五校清單、預約、電話；漢堡變 ✕ | 最乾淨、手機桌機一致、選單能長大；多一次全幕切換，導覽不再一眼可見 |

## 共用規則

- **觸發點**：`.hero-sentinel` 放在首屏底緣往上「頁首高度＋40px」處，用 `IntersectionObserver` 觀察；哨兵離開視窗頂端 → `data-state="compact"`，回來 → `hero`。不綁 scroll 事件。
- **首屏中途**：`scrollY > 8` 時頁首套 `rgb(18 29 24 / .5)`＋`backdrop-filter`，避免白字壓在淺色照片上（`hero-scrolled-desktop.png`）。
- **動態**：只動 transform／opacity 與少量寬高；`prefers-reduced-motion` 與 `?reduced=1` 都會把過場縮到 0。
- **選單**：Esc、點外面、點連結、回到首屏（A／B）都會關閉；開啟時焦點進第一個連結、關閉回到按鈕；C 開啟時 `main` 設 `inert`、`body` 鎖捲動。
- **手機（≤900px）**：首屏就有漢堡；A 收合後仍併成一組、B 膠囊撐滿左右 16px、C 相同。手機首屏比照主站改為照片在上、深綠面板在下。

## 檔案

- `index.html`／`compare.css`／`compare.js`：比較頁（用 `postMessage` 遙控 iframe 裡的 `view.html`）。
- `view.html`／`header.css`／`header.js`：假首頁＋三方向頁首；`body[data-direction]` 切換。
- `assets/`：從主站複製的 logo、首屏靜態圖、品牌字型（Noto Sans TC 600 子集、Source Sans 3 400 子集、LINE Seed TW 700 子集）。
- `shoot.cjs`：`node shoot.cjs` 產 `shots/*.png` 並跑狀態檢查（用 npx 快取的 playwright-core＋系統 Chrome）；結果在 `shots/report.json`。
- 2026-09-17 檢查結果：三方向×桌機 1440／手機 390 共六組，首屏→收合→開選單→Esc→回首屏皆正確，無水平溢出、無 console 錯誤。

## B 的大小與顏色（2026-09-17 晚，使用者選定 B 後）

使用者選 B，要求依網頁內容給合適的大小與顏色。做法：把真實首頁的頁首藏起來，在 1440／390 寬各截六段背景條（`strips/`：首屏底部、淡綠關於、米白孩子的一天、米黃分校城堡照、米黃消息、頁尾），用 `pill-sample.html` 把同一份 `header.css` 的膠囊原尺寸疊上去，組成 `b-tuning.html`；對比度用 WCAG 相對亮度離線算（token → sRGB）。

- `view.html?direction=b` 多兩個參數：`size=s|m|l`、`tone=paper|white|sage|deep`；比較頁選 B 時會出現尺寸／色調下拉。**目前預設＝建議值 deep × m。**
- 尺寸：S 控制項 40／膠囊 52；M 48／60（手機 44／56）；L 56／68。
- 色調：米白＋ink 14% 細框、純白、淡綠 `--studio-sage`、深綠 `--green`（預約改 `--yellow` 底 `--deep` 字、校徽放白圓徽章、選單卡同色）。
- 關鍵數字：淺色三種膠囊對淺色區塊的邊界對比只有 1.0–1.4（全靠陰影）；深綠對五段背景 7.1–9.6；深綠上米白字 9.87、mint 英文 7.13、黃底深綠字 9.66。
- **定案深綠 × M，2026-09-18 已套進主站首頁**（`index.html`／`studio.css`／`app.js`，規則見 repo `DESIGN.md`「離開首屏的浮動膠囊」）。規格表在 `b-tuning.html` 底部。

## 膠囊放在哪裡（2026-09-18 → 定案「整顆靠右」，已上站）

園方回饋「放在正中間太突兀」。`placement.html` 把五種擺法疊在首頁真實截圖上比較（`place/*.jpg`，由 Playwright 對 `index.html?pill=…` 逐段拍出來）：置中（現況）、整顆靠左、整顆靠右、左右分離・帶校名、左右分離・只留校徽。五種只影響 901px 以上，900px 以下都是滿版膠囊。

- 切換：主站 `index.html?pill=center|left|right|split|split-mini#/home`（預覽參數，與既有 `?hero=quiet` 同一個模式）。
- 我原本建議左右分離・只留校徽，**園方選定「整顆靠右」**，2026-09-18 已套成主站預設；其餘四種仍可用 `?pill=` 預覽。理由與取捨寫在 `placement.html` 底部。
- 重產截圖：啟動 8770 伺服器後跑對話紀錄裡的 `shoot-place.cjs`（輸出到 `place/`）。
- 補充提案已做：**向下捲收起、向上捲出現** → `autohide.html`（並排即時預覽＋桌機／手機對照 GIF，動畫在 `autohide/*.gif`）。主站參數 `index.html?autohide=1#/home`，可與任何一種擺法組合。尚未套成預設。
  - 重錄動畫：啟動 8770 伺服器後跑對話紀錄裡的 `record-autohide.cjs`（逐格截圖）＋ PIL 合成 GIF（桌機縮 720、手機 390、96 色、72ms）。

## 狀態

B（深綠 × M）已於 2026-09-18 套進主站首頁並打包進 `preview.html`；A 與 C 只是比較用的提案，沒有進站。Safari／Firefox 實機尚未驗證。本目錄的 `view.html` 仍是獨立 mock-up，與主站檔案互不影響。
