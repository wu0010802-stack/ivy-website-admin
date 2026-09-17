# 最新消息：五種設計提案

**採用狀態（2026-09-16）：園方已選 A，現已整合至主站 `#/home/latest-news` 並更新 `preview.html`。下列為探索階段的五版比較紀錄，獨立比較頁仍可使用。**

2026-09-16。範圍是 `ivy-website-prototype` 五校品牌官網，在首頁「分校資訊」與「參觀須知」之間增加最新消息區塊的設計探索。這份交付為獨立 mock-up，主站檔案由其他工作同步調整，本次未改寫主站入口、樣式、資料或 `preview.html`。

## 開啟比較

- 比較頁：<http://127.0.0.1:8770/design/news-directions/>
- 單版：`view.html?direction=a`（可換 a / b / c / d / e）。
- 首頁銜接：`home.html?direction=a`，實際放在 `#campuses` 後、`#faq` 前。
- 比較頁可切桌面／390px 手機、五種方向，以及「放進目前首頁看」。桌面與手機截圖存於 `shots/`，比較頁下方提供連結。

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

## 方向與取捨

| 方向 | 版面 | 適用情境 |
| --- | --- | --- |
| A 活動＋新聞（推薦） | 左側三個活動、右側三則圖片消息 | 最接近使用者提供的 UC San Diego 參考；活動和消息皆有更新 |
| B 編輯選讀 | 一張主打大圖、三則短消息、下方活動提醒 | 有重點消息值得放大，照片需要定期更新 |
| C 五校動態 | 三欄卡片＋六個分校篩選按鈕 | 五校持續提供內容；首頁初始精選三則，單校顯示該校範例 |
| D 簡潔公告 | 深綠底、日期與分類、四則文字標題 | 照片少、行政公告多；第一則示範置頂 |
| E 校園手札 | 紙張色、拱形照片、三篇生活故事 | 校園日常／學習紀錄；較依賴照片，手機篇幅較長 |

## 實際查閱的參考網站

- [UC San Diego](https://ucsd.edu/)：使用者截圖來源，Events 與 News 分組；A 保留構圖並改成常春藤深綠／米白。
- [Wellington College](https://www.wellingtoncollege.org.uk/)：What's new 包含新聞主區與獨立活動區。B 借鏡主次分層，右側三則短消息與底部活動列是本案配置。
- [Nord Anglia News](https://www.nordangliaeducation.com/news)：主打消息、消息類型與更多分類篩選。C 將此概念改為五校篩選，不是原站既有分校列的複製。
- [吉的堡方圓幼兒園](https://kidcastle.topschool.tw/Bulletin/News)：以日期與標題整理活動、招生及行政公告。D 參考內容結構；深綠配色與日期版面為本案設計。
- [Stanford](https://www.stanford.edu/)：Stanford News 以圖片、類型、標題、摘要與日期呈現故事。E 參考資訊層級，紙張、拱形與錯落排版為本案設計。

皆於 2026-09-16 查閱。未複製參考站文章或照片。以 `modern-web-guidance` 的 `css-layout` 指引安排 Grid、Flexbox、圖片比例、原生 dialog 與手機排版。

## 資料與實作邊界

- 全部標題、日期、活動、分類與校別對應均是設計範例，不代表園方已公告或開放報名。
- 使用既有 `assets/*.webp`。義華學習／戶外照片、果樹情境，以及分校既有圖像均非所列消息的實拍。仁武圖像標註為外觀示意圖。
- 原生 HTML/CSS/JS、無新增套件。消息、活動與完整清單以原生 dialog 示範閱讀，可用 Escape 關閉並還原焦點；C 篩選使用原生按鈕與 `aria-pressed`，結果提供 live status。
- `home.html` 是目前 `index.html` 外殼的預覽副本，透過 `<base>` 引用主站資產、CSS 與 `app.js`，再由 `news.js` 插入本次區塊。因此主站日後更新 CSS／內容會反映在此預覽，外殼結構變動時則需重新同步副本。
- 主站沒有接上消息 API，本次沒有寫入任何租戶或營運資料，沒有對外發布。

## 驗證

- `node --check design/news-directions/news.js` 與 `compare.js`。
- `output/playwright/news-design-check.js`：五版 × 1440／768／390／375px 共 20 組尺寸，檢查水平溢出、圖片載入、標題唯一性；驗證消息視窗、Escape、活動詳情、完整清單、六個分校篩選、比較頁切換與首頁插入順序。
- `shots/desktop-{a,b,c,d,e}.png`、`shots/mobile-{a,b,c,d,e}.png` 為實際瀏覽器截圖；`shots/homepage-a.png` 呈現與分校資訊的接續。

選定方向後，可將相應 renderer 與 scoped CSS 整合到主站 `home()`，再由園方提供正式消息與活動內容。
