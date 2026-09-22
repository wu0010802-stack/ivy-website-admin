> 2026-09-22 定案：使用者選擇 A，已整合正式 Nuxt 並繼續優化；[目前 A 版預覽](http://127.0.0.1:3021/visit)。下列三案保留為原始比稿紀錄，未部署。

# 預約校園參觀 · 三款獨立 mock-up

日期：2026-09-22。使用範圍：獨立常春藤官網五個 campus；與園務系統 tenant 無關。未整合 Nuxt、未修改 API、未發布。

啟動：在 repo 根目錄執行 `python3 -m http.server 8786 --bind 127.0.0.1`，開啟 <http://127.0.0.1:8786/design/visit-booking-mockups-20260922/>。

- `index.html`：互動比較工具，切換 A／B／C 及桌面／手機。
- `compare.html`：三案桌面與手機並排截圖。
- `preview.html?direction=a|b|c`：單一完整提案。
- 加上 `&campus=renwu`：示範由分校頁帶入校區。
- 加上 `&campus=renwu&state=paused`：示範暫停預約的替代聯絡方式。
- `screenshots/`：桌面、手機、選校前／後、表單與暫停情境。

## 三個方向

| 方向 | 設計 | 對家長的幫助 | 取捨 |
|---|---|---|---|
| A 一步一步，安心預約 | 墨綠歡迎區、校園照片、兩步式短表單 | 一次只處理選校或聯絡資料；五校照片與地址可掃讀 | 比單頁多一次下一步；推薦作為共用預約入口 |
| B 一頁完成，快速聯絡 | 五校照片並列，下方短表單，桌面右側流程摘要 | 同頁比較並填寫，已決定校區的家長容易完成 | 手機需要較多捲動 |
| C 先逛校園，再約見面 | 明體大標、校園大圖、側邊表單；手機改底部展開 | 保留官網形象，填寫時仍知道所選校區 | 適合從校園內容延伸預約，直接填寫的路徑比 B 長 |

## 共通設計與既有約束

- 通用頁不預選任何校區。C 的初始義華照片標示「校園一瞥」，並非預選校區；選校後才提供預約入口。
- 必填僅家長稱呼、手機、同意；沿用現行欄位，選填年齡、接電話時段與問題收合。
- 「方便接電話」不代表參觀時間；送出的是 inquiry，園所聯繫後再確認，不能宣稱預約已成立。
- 切換校區、往返步驟、關閉／重開表單保留輸入；重新整理清除。不使用 localStorage、cookie 或網路請求儲存資料。
- CSP `connect-src 'none'; form-action 'none'`，JS 本地模擬結果。完成畫面明示資料未送出，不發通知。
- 原生 radio、label、表單輸入及 dialog；錯誤有文字、ARIA 與焦點引導，支援鍵盤與 reduced motion。
- 暫停情境使用所選校的電話，只有義華有 LINE。真實開放狀態由未來正式版的 resolver 提供；不修改現行 slots 閘門。
- 五校照片、地址、電話由 `web/server/data/site-fixture.json` 提取至 `campuses.js`；影像引用現行 `web/public/assets/`。既有增強圖不在本次重新生成。
- 桌面截圖 1440px，手機 390px；示意資料為「測試家長」與測試手機。

## 外部參考（2026-09-22 查閱）

1. [EtonHouse · Book a Tour](https://www.etonhouse.edu.sg/etonhouse-bookatour/)：列出分校、選擇欲先參觀的校區，再由所選學校聯絡。用於 A 的選校優先與期待管理；未複製促銷資訊。
2. [MindChamps · PreSchool](https://www.mindchamps.org/preschool/)：集中式表單含 Preferred Centre 與家長聯絡資訊。用於 B 的同頁選校＋短表單；未搬入額外行銷欄位。
3. [BrightPath · Locations](https://brightpathkids.com/us/locations)：地址與範圍探索、分校資訊入口。用於 C 的先認識地點再行動；五校數量少，因此沒有加入地圖、定位權限或搜尋門檻。

上述為流程參考與本案的設計推論；頁面視覺重新依常春藤品牌製作，未使用其他學校照片。

## 驗證紀錄

檢查腳本與結果：`output/playwright/visit-booking-mockups-20260922/check.cjs`、`verification.json`。
範圍：三案 × 1440／1024／768／390／320px，五校切換、必填錯誤、輸入保留、示範送出與返回、深連結、暫停電話／LINE、鍵盤、比較頁裝置切換、圖片載入、無水平溢出與無網路 mutation。僅 Chromium；未做 Safari／iOS 實機驗證。
