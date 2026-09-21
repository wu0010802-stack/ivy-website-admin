# 分校資訊三種 layout mock-up

2026-09-21，依使用者要求製作三種不同結構的高擬真比稿，未整合至正式 Nuxt 元件。

- A「上圖下資訊」：橫幅照片＋墨綠三欄資訊帶。
- B「左圖右資訊」：左側照片＋右側深綠資訊面板。
- C「側欄選校」：直向五校選單＋右側照片與浮疊資訊卡；手機改成原生校區選單。

預覽比較頁：`http://127.0.0.1:8766/design/campus-layout-three-20260921/`

互動版：`preview.html?layout=a|b|c&campus=yihua&state=paused|open`。

`capture=1` 只隱藏比稿工具列，用於產生乾淨截圖。預約狀態是獨立示意，沒有呼叫後台 API；主行動僅顯示預覽提示，不送出資料。電話、地圖與已確認的社群連結使用專案資料。

校區資料取自 `web/server/data/site-fixture.json` 的公開內容，截取本比稿需要的欄位。其他四校的機構 Facebook 借用值未當作分校帳號呈現，LINE／Facebook 保留待補。

素材沿用 `assets/` 原圖、LINE Seed TW Bold 與 Source Sans；「分校資訊」標題整段使用系統中文字型，避免既有 LINE Seed 子集缺少「訊」而產生單字跳字型。

本次只新增獨立比稿頁與瀏覽器截圖，未修改 `web/`、凍結的 vanilla 原型或 `preview.html`。

截圖與檢查紀錄：`output/playwright/campus-layout-three-20260921/`。

已完成 Chromium 驗證：三版各有 1440px 桌機與 390px 手機實際截圖；五校資料、圖片與聯絡連結同步，鍵盤選校、預約狀態切換及示意提示正常。另檢查 320／768／1024px 的國際校內容，無水平溢出。共 28 項檢查通過，沒有 JavaScript 錯誤；Safari／Firefox 未驗證。
