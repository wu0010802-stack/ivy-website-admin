# 字體角色 mock-up

2026-09-22。延續使用者要求「字體角色更清楚」，提供目前字體與分工提案的相同內容、配色、照片與版型對照。尚未改動正式 Nuxt，也未套用上一輪分校內頁提案。

入口：http://127.0.0.1:8782/design/typography-roles-20260922/

獨立預覽：preview.html?variant=current 或 preview.html?variant=proposal，片段可接 #hero、#about、#campuses、#news。

使用 repo 根目錄既有本機 HTTP server 8782；若未啟動，執行 python3 -m http.server 8782 --bind 127.0.0.1。

## 提案的角色

- 品牌標語：LINE Seed TW 700。首頁標語維持 60px／手機34px；理念大標從1440px寬時約66px收為約48px，手機32px。
- 分校名稱與分校資訊：沿用已定案 Noto Serif TC 500 子集；不擴大到正文或消息標題。
- 區塊資訊標題與消息標題：系統黑體600，桌機32px／20px，手機28px／18px。
- 內文：系統黑體400，理念正文桌機18px、手機16px，行距1.95。
- 日期與一般英文小標：沿用 Source Sans 3 400。分校 Campuses 的 Georgia italic 與品牌字標保留。
- 操作：系統黑體500；手機消息入口提高至14px。

這是首頁内容節錄比較，省略影片播放、捲動轉場與拍立得；「目前字體」採 web/ 現行 CSS 的字型、字重、字級規則套用於同一節錄版型，不是完整官網截圖。消息與活動維持 fixture 範例標示，點擊可開詳情；沒有表單提交。

content.js 為 web/server/data/site-fixture.json 的公開設計資料快照。素材沿用現有資產，不新增字型、不生成照片。所有變更限於此探索目錄與 README 紀錄。

## 驗證

- Chromium：320／390／768／1024／1440／1920px × 目前／提案，無水平溢出或缺圖；互動測試無 runtime error。
- 320／1440px 的 200% 文字縮放無水平溢出，頁首可隨品牌文字增高。
- 比較切換、區塊跳轉、手機預覽、角色表、消息與活動詳情、清單、Escape 關閉與焦點返回通過。
- 保留的 LINE Seed 品牌標語、五校明體、提案英文與日期的本機字型 cmap 覆蓋通過。現有 LINE Seed 範例資訊文字中的「・丁季消秋」原本依賴 fallback；提案的資訊角色改用系統黑體，未修改既有子集。
- 附桌機 1440px／手機 390px 的理念、消息截圖各兩版，以及 compare.html 並排頁；截圖等字型與圖片完成載入後擷取。
- `node --check preview.js`、`node --check content.js`、`node --check ../../app.js` 與根目錄 `python3 package_preview.py` 通過，根目錄 preview.html 無差異。
- Safari／iOS 實機未驗證；此為獨立 mock-up，未整合、部署或提交。
