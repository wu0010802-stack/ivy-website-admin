# 五校介紹：三個呈現方向（2026-09-15）

首頁「五校介紹」區塊的替代方案比較。三個方向都內嵌真實 Google 地圖，並替每校留出電話、LINE 官方帳號、Facebook 的位置。

## 開啟

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

- 比較頁：http://127.0.0.1:8765/design/campus-directions/
- 單一方向（手機預覽或截圖用）：加 `?only=a`、`?only=b`、`?only=c`
- 頁面依賴站內 `styles.css`、`studio.css`（token、字型、`.container`、`.button`），必須走 HTTP，不能用 file://（字型 CORS）。

## 三個方向

| | A 地圖清單 | B 卡片加地圖抽屜 | C 校區分頁 |
|---|---|---|---|
| 主角 | 地圖 | 校園照片 | 單一校區 |
| 五校一眼看完 | 是（示意圖五個標記＋清單） | 是（五張卡） | 否（要切分頁） |
| Google 地圖 | 固定在左側，點校區切換 | 按「地圖」展開抽屜 | 與照片、聯絡同框 |
| LINE／Facebook | 每列右側圓形圖示 | 卡片圓形圖示＋抽屜內大按鈕 | 品牌色圓標大按鈕 |
| 手機 | 地圖在上、清單在下 | 列表卡片，抽屜接在被點的卡下面 | 分頁橫向捲動，內容往下排 |
| 改動幅度 | 中 | 小 | 中 |

### 建議：B 卡片加地圖抽屜

- 守住 PRODUCT.md「真實校園影像優先」與「五校資訊清楚可比較」：五張校園照仍在第一眼，聯絡方式與地圖是第二層。
- 使用者要的三件事（地圖、Google 地圖、各校 LINE／Facebook）全部有位置，桌面預設展開義華校的地圖，不用點就看得到地圖資訊。
- 最容易搬進站內：`campus-card` 只加一列動作，抽屜是 grid 裡一個 `grid-column:1/-1` 的元素，手機靠 `order` 接在被點的卡片後面，不用另寫版型。
- 若之後想要「五校位置一張圖」，A 的示意圖（或含五個標記的 Google 地圖）可以獨立成一個「五校位置」入口，不必推翻 B。

若園方更在意社群導流（LINE 加好友、粉專），C 的品牌色大按鈕最顯眼；若接送距離是家長決策核心，A 的地圖清單最直接。

## 資料狀態

- 已查到：義華校 LINE `https://lin.ee/gwl8fnA`、Facebook `facebook.com/ivy.kids.fb`（來源 ivykids.tw 頁尾）；機構 Facebook `facebook.com/ivykid`（來源 ivykidschool.com）。
- 未查到：明華、崇德、國際、仁武的 LINE 官方帳號與各校粉絲專頁。比較頁把 LINE 標成虛線「待補」、Facebook 先指向機構粉專，不拿義華帳號冒充。**請園方提供四校 LINE ID 或 lin.ee 連結、各校粉專網址。**
- 五校座標：Nominatim 查「路名 區 高雄市」的道路節點（非門牌），只用於示意圖。

## Google 地圖接法

1. **單點嵌入（本頁採用）**：`https://www.google.com/maps?q=<地址>&z=16&hl=zh-TW&output=embed`，免金鑰、可上線；一次一個地點。
2. **五校同圖**：園方用 Google「我的地圖」建「常春藤五校」再取嵌入碼（免金鑰）；或申請 Maps JavaScript API 金鑰自訂標記（需綁 Google Cloud 帳單，每月有免費額度）。
3. **規劃路線／開啟地圖**：Maps URLs（`maps/dir/?api=1&destination=`、`maps/search/?api=1&query=`），手機會直接開地圖 App。

**踩坑**：`output=embed` 的 iframe 載入時會把焦點移進地圖的搜尋框，若 iframe 在畫面外載入，整頁會被捲到那個 iframe。本頁改成 `data-src` + IntersectionObserver，iframe 進到視口附近 160px 才指定 `src`；也順便避免三個方向的地圖一次全部下載。搬進站內時要保留這個做法。

## 檔案

- `index.html`：比較頁（外框、三個方向、手機預覽、備註）。
- `campus.css`：`cd-` 前綴的元件樣式，不與站內 `.campus-*` 互相覆蓋。
- `campus.js`：五校資料（含 `line`、`facebook`）、三個方向的渲染與互動。
- `icons.js`：Iconify 取得的 Phosphor 圖示＋ Simple Icons 的 LINE、Facebook 標誌（品牌標誌是全站 Phosphor 規則的唯一例外）。
- `map-data.js`：北高雄行政區 SVG 路徑與五校座標；由 `gen-map.py` 從 `geo-source/*.json`（Nominatim polygon_geojson）產生。
- `shots/`：桌面 1440 與手機 390 截圖。

## 驗證（2026-09-15）

- 1440×900：三個方向無 console 錯誤；A 點列／點標記切換、B 抽屜展開／收合並把焦點還給按鈕、C 分頁點選與方向鍵切換皆通過。
- 390×844：見 `shots/mobile-*.jpeg`。
