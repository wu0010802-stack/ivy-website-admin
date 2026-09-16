# 孩子的一天：第二輪 D／E／F

2026-09-16。常春藤五校品牌官網的獨立探索稿，服務正在認識園所的家長。目標是讓照片更容易被看見、日常故事更好讀，並探索比第一輪更有辨識度的互動方式。

## 預覽

- 比較頁：`http://127.0.0.1:8766/design/day-directions-round2/`
- 單一方向：`view.html?direction=d`、`e`、`f`
- 第一輪：`../day-directions/`
- 可切換桌面與手機預覽；各版另有 `shots/desktop-*.png` 與 `shots/mobile-*.png`。

## 三個方向

| 方向 | 主要入口 | 互動與手機行為 | 取捨 |
| --- | --- | --- | --- |
| D 日常照片牆 | 不規則照片，深綠底 | 六個片刻可自由點選；原生 dialog 顯示故事與問答；手機改成兩欄與跨欄混排 | 照片吸引力最強，但完整故事需要點選 |
| E 孩子的生活手帳 | 上午、午間、午後三章 | 每章兩個生活片刻；桌面雙頁、手機上下閱讀；章節可直接選擇或前後切換 | 品牌記憶點強，需接受較明顯的手帳風格 |
| F 從家長的好奇開始 | 適應、飲食休息、探索、分享四個問題 | 原生 details 摺疊問題，照片隨內容變更；手機照片放進展開答案；可再點開相關故事 | 最貼近首次來訪家長，但時間順序較弱 |

建議先比較 D 與 E；F 也可以獨立作為「家長想知道」區塊，與前兩者搭配。這是設計判斷，尚未做使用者研究或轉換成效測試。

## 官方網站參考與查證範圍

1. [Exploratorium / Explore Our Exhibits](https://www.exploratorium.edu/exhibits)：官方內容與瀏覽器檢視確認深色頁面、照片與展品名稱形成探索入口。D 借用照片導覽思路；不規則尺寸與 dialog 是本提案的延伸。
2. [Wonderbly / Where Are You?](https://www.wonderbly.com/personalized-products/where-are-you-book)：官方頁面提供跨頁書籍圖像及全書預覽資訊。E 借用書頁敘事概念，沒有複製商品頁或其客製化流程。
3. [Lovevery / Parent Resources](https://blog.lovevery.com/)：實際瀏覽器確認依年齡、Skills & Stages、Playtime & Activities 分類及大照片內容。F 將依家長需要找內容的概念改為四個提問；非聲稱對方有相同 accordion。
4. 延伸觀察：[上河内幼稚園的一日生活](https://kamikawachi.com/daily.html) 以時間、生活照與粉彩裝飾串連一天；[Winnipeg Children’s Museum](https://childrensmuseum.com/) 的 How Kids Learn Here 使用大字與傾斜活動照片；[Indianapolis 兒童博物館參觀頁](https://www.childrensmuseum.org/visit/plan-your-visit) 直接回答參觀與家庭需求。前兩個已由唯讀研究代理使用瀏覽器查證，第三個僅查證內容。

## 圖片與文字

- HTML 互動版使用原始常春藤本地素材：`learning.webp`、`hero.webp`、`campus.webp`、`classroom.webp`、`hero-campus-still.webp`，以及 `design/believe-directions/value-company.jpg`。
- 用餐與午休沒有可確認的實拍，使用教室空間參考並明確標註。入園、離園照片亦保留情境示意說明。
- 不添加未經確認的精確作息時間、餐點、照顧承諾或其他校區服務資訊。
- `moments.js` 為第一輪六個生活片刻的獨立快照；只用於本次 mock-up。
- 三張構圖草稿使用內建 imagegen 產生：`probes/d.png`、`probes/e.png`、`probes/f.png`。完整提示詞存於 `prompts.json`。草稿用於構圖比較，影像可能有生成偏差；可操作版使用原始照片，不使用生成草稿作校園實拍。
- 沒有選定單一方向作正式整合；D／E／F 都是供比較的成果。

## 互動原則與驗證

- 原生 dialog 支援 Escape、焦點限制及關閉後返回原按鈕。
- 章節 tabs 提供箭頭、Home、End 操作；第一章／最後一章停用對應翻頁按鈕。
- 原生 details 提供鍵盤操作與可搜尋內容。F 同時只開啟一個問題。
- 不自動輪播；尊重 prefers-reduced-motion。主要控制項至少 44px。
- 已檢查 1440、768、390、375px：無文件橫向溢出、可見圖片正常、主要控制項尺寸符合設定。
- 已以瀏覽器檢查六個 D 故事、FAQ、Escape、焦點返回、E 三章節與邊界、F 四問題與關聯故事，以及比較頁切換。
- `node --check` 檢查 JavaScript 語法。

所有產出位於此資料夾；目前首頁維持既有版本。這是 mock-up 驗證，非完整跨瀏覽器／螢幕閱讀器稽核。
