# 孩子的一天：三種 UI/UX mock-up

2026-09-16。範圍為 `ivy-website-prototype` 品牌官網的「孩子的一天」區塊，以既有常春藤／義華校素材呈現。交付為獨立設計比較頁，供園方選方向。

## 預覽

- 比較頁：<http://127.0.0.1:8766/design/day-directions/>
- A 章節故事：`view.html?direction=a`
- B 生活相簿：`view.html?direction=b`
- C 一天旅程：`view.html?direction=c`
- 比較頁可切换桌面／手機，或單獨開啟方向頁。原生 HTML/CSS/JS，無依賴、無建置。

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

## 問題與設計方向

現有區塊的時間軸、照片上短句、故事、問答、探索數量及前後控制同時出現，主次較分散。三版保留六片刻與家長問答，將照片和一段故事作為主要閱讀內容，取消「已探索幾個」的完成任務感。

使用場景：替孩子尋找幼兒園的高雄家長，在白天或晚間用手機／桌面瀏覽，想先感受校園，再了解孩子如何度過一天。沿用暖白、深綠、淡鼠尾草綠與 LINE Seed TW 標題，正文使用系統中文字型。

| 方向 | 呈現方式 | 取捨 |
| --- | --- | --- |
| A 章節故事（推薦） | 桌面左側章節、右側大照片與短故事；手機六個片刻按鈕在照片上方。點選、方向鍵、Home/End 可切換，問答依需求展開。 | 和目前首頁較容易銜接，操作明確；其餘片刻需要切換才能閱讀。 |
| B 生活相簿 | 原生橫向捲動相簿，相鄰照片露出；按鈕、手勢、方向鍵與片刻捷徑皆可使用，位置同步。 | 影像帶入感強，較依賴各片刻的照片品質；沒有自動播放。 |
| C 一天旅程 | 交錯圖文，順著頁面閱讀六個片刻；側邊目錄／手機頂部目錄提供快速跳轉，讀到哪裡就標示哪一段。 | 閱讀連貫、不需逐項切換，整體較長；適合深入認識校園。 |

## 參考網站（2026-09-16 實際查閱）

- [MoMA Magazine](https://www.moma.org/magazine/)：首頁先呈現主故事的大圖片、標題與短摘要，再呈現其他文章。A 借鏡照片與文字的層級；章節選單是本案設計。
- [Apple iPhone Air](https://www.apple.com/iphone-air/)：Highlights gallery、圖像展示與前後控制。B 借鏡大圖、相鄰內容提示與多種操作入口；不採自動播放。
- [Trinity Early Learning Centre — A Typical Day](https://trinityelc.com.au/programs/typical-day)：沿一日順序、左右分段敘述。C 改為照片與短故事交錯，未引用對方的開園時間、課程或營運承諾。
- `modern-web-guidance`：`scroll-snap-state-sync`，僅在支援時加用 `scrollsnapchange`；所有瀏覽器均有以 `scroll` + `requestAnimationFrame` 對齊計算的狀態同步方式。

## 素材與視覺草稿

- `probes/a.png`、`b.png`、`c.png`：使用內建 `imagegen` 產生的三方向視覺草稿；參考圖來自現有 `learning.webp`、`hero.webp`、`campus.webp`。完整提示詞在 `prompts.json`。
- 生成草稿供構圖討論，文案與照片標註以 `day.js` 的互動版為準。互動版直接引用原始品牌照片，未使用生成版中的人物或校園圖片。
- 用餐／午休照片尚缺，兩者顯示教室空間並標示「實拍待補」。入園／離園僅為情境示意，未宣稱影像就是交接現場。午後玩耍使用原有義華校玩泡泡照片。
- `shots/desktop-{a,b,c}.png`：1440×1000 瀏覽器實際截圖。
- `shots/mobile-{a,b,c}.png`：390×1100 瀏覽器實際截圖；C 僅截取頁首，完整六片刻可在預覽捲動。

## 已驗證

- `node --check`：`day.js`、`compare.js` 通過。
- 三方向於 1440、768、390、375px 均無文件水平溢出，全部照片正常載入；按鈕、summary、主要連結均至少 44px 高。
- A 六片刻切換、用餐素材標註、問答展開、Home/End；B 上下張、首尾禁用、片刻捷徑與 Home；C 段落跳轉、焦點及目前段落標記；比較頁方向／手機切換，均以瀏覽器操作確認。
- 桌面與手機共六张實際截圖已檢視；未見 JavaScript 例外。

## 後續採用

園方選定方向後，再整合到主站 `dayExperience()`。這次所有新頁面、照片草稿及設計資料均放在本目錄。正式採用前，建議補齊用餐、午休與實際入離園照片。
