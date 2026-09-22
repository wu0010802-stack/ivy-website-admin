# 消息到頁尾的轉場探索

2026-09-22，使用者選定 A「霧藍漸退」，已整合至 Nuxt 首頁。此目錄保留獨立比較與設計來源；主站預覽為 <http://127.0.0.1:3010/#latest-news>。

- 比較頁：<http://127.0.0.1:8765/design/footer-transition-20260922/>
- 全螢幕：`stage.html?direction=original|a|b|c`
- `p=0..1`：起始轉場進度；`motion=fallback`：強制使用 JS 備援。

## 三個方向

| 方向 | 變化 | 設計考量 |
| --- | --- | --- |
| A 霧藍漸退（優先推薦） | 當頁尾進入，消息的霧藍色層逐漸退回暖白 | 首頁已有多段揭幕，最後透過色彩安靜收尾；文字不另淡入、不延遲連結 |
| B 頁尾揭幕 | 上層消息自然捲走，頁尾以較慢速度露出 | 提供紙張與底層的深度；位移依頁尾高度的 60%，上限 220px，避免整屏鎖住 |
| C 圓弧收邊 | 暖白的寬弧面接住消息，隨入場收平 | 呼應照片圓角；桌機弧高 80px、手機 44px，留在消息尾端留白內 |
| 現況 | 霧藍直接接暖白 | 同內容對照 |

## 研究來源

1. [Olivier Larose，Sticky Footer](https://blog.olivierlarose.com/tutorials/sticky-footer)（2024-05-21）：原作者以 fixed 或 sticky 呈現下層 footer。本次 B 借用揭露語言，改成有限位移，沒有搬用 React／Lenis。
2. [Framer Academy，Create a fixed footer reveal](https://www.framer.com/academy/lessons/fixed-footer-reveal)（2026-02-04）：官方示範頁尾位於內容後方，並提示測試高度、焦點、手機及堆疊。本次檢查對應的可操作性。
3. [Olivier Larose，Mask Section Transition](https://blog.olivierlarose.com/tutorials/mask-section-transition)（2024-06-02）：以形狀作為區塊交界。C 是本次依常春藤圓角語言重新設計的低幅度弧面，不宣稱為原作者同款效果。
4. A 是本次從現有霧藍／暖白配色延伸的設計，沒有附會特定網站。

本輪查閱作者／官方資料及示範入口；沒有宣稱對來源網站做完整實機互動驗收。

## 內容與界線

- 消息與頁尾取自本機 Nuxt fixture 模式實際渲染的 DOM；原文案、五校名稱、原有圖片與聯絡／導覽連結沿用。消息仍為網站既有示例。
- `stage.html` 讀取現行 `web/app/assets/css/styles.css`、`studio.css`，`stage.css` 只在獨立頁覆蓋轉場與研究工具，不更動主站 stylesheet。
- 擷取的是內容與排列。霧藍完成態依使用者截圖和主站 News token 設定；不把本次 reduced-motion 擷取的暖白狀態當作正常動態基準。
- News 按鈕在預覽中開啟示意說明；Footer 原連結導向本機 Nuxt 或原外站並另開分頁，不寫入 CMS。
- 原生 CSS view timeline 有完整功能偵測；不支援時使用 passive scroll＋單一 rAF 更新進度，無新套件。只有播放器啟動時連續執行 rAF，手動捲動、觸控、導覽鍵或分頁隱藏會停止。
- 減少動態／強制色彩採自然排列，不鎖捲動。鍵盤進入頁尾時立即移除位移，保證連結完整可讀。
- 探索階段只新增獨立目錄；A 獲確認後另整合至首頁與既有紙頁轉場，沒有改 CMS 或部署。主站驗證另在 `output/playwright/footer-fade-a/`。

## 驗證

檢查腳本與截圖：`output/playwright/footer-transition/`。原本首頁截圖為 `before-1440.png`；DOM 快照在同目錄 `source.json`。Safari／Firefox／iOS 實機尚未驗證。

Chrome 驗證：320／390／768／1440／2048px × 現況與三版 × 開始、45%、完成與反向 20%，共 80 個版面與捲動狀態；三版 JS 備援、三版減少動態、播放與手動中止／焦點恢復，以及四尺寸 × 四版比較頁，共 103 筆檢查通過。無水平溢出、圖片載入失敗或 JavaScript runtime error。已目視檢查三版桌機交接、手機完成畫面與比較頁。`node --check` 與原型重打包通過，`preview.html` 無差異。
