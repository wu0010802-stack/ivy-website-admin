# 首頁到分校內頁的視覺銜接 mock-up

2026-09-22。獨立視覺提案，未整合 Nuxt、未部署。

方向：延續首頁已定案的 Noto Serif TC 校名、石墨藍灰、暖瓷白、大幅圓角校園照片與香檳金行動入口。保留 LINE Seed 內容標題、既有 d9 頁首預約樣式。校名與介紹移出照片，讓校園本身保持明亮。

範圍：五校共用內頁 mock-up，桌機與手機自適應，包含首屏、地址與電話、介紹、照片切換、FAQ、聯絡與五校導覽。比較頁可以切換目前本機 Nuxt 內頁。這是視覺提案，既有互動校園導覽以連結開啟，不在 mock-up 重製導覽工具；不建立表單或提交資料。預約入口導向現有本機預約頁，由原頁顯示實際開放狀態。

從 repo 根目錄啟動：python3 -m http.server 8782 --bind 127.0.0.1

- 比較入口：http://127.0.0.1:8782/design/campus-continuity-mockup-20260922/
- 獨立提案：preview.html?campus=yihua
- 可用校區：yihua、minghua、chongde、international、renwu。
- 「目前內頁」與「首頁參考」需既有 Nuxt 預覽 http://127.0.0.1:3010。

內容是 web/server/data/site-fixture.json 的本機快照，並套用 web/app/utils/public-copy.ts 的已知 FAQ 文案整理。保留五校各自地址、電話與照片；只有義華使用既有 LINE / Facebook，其餘聯絡資料不代填。可執行 python3 design/campus-continuity-mockup-20260922/build_data.py 更新資料。

照片使用 web/public/assets/ 原素材；沒有生成或修飾校舍照片，原始解析度限制仍存在。字型與圖示沿用專案現有資產，不新增套件。未將探索方向寫成已定案的 DESIGN.md 規則。

驗證：本機 Chromium，320／390／768／1024／1440／1920px × 五校，共 30 組版面均無水平溢出，主照片與明體載入成功、頁內錨點存在，沒有 JavaScript runtime error。手機選單開啟與 Esc 關閉、照片選擇、FAQ 展開，以及比較頁的五校／目前版／提案／尺寸切換通過。LINE Seed 內容標題與明體校名逐字 cmap 檢查無缺字。

語法檢查：node --check mockup.js、node --check data.js、node --check app.js 通過。python3 package_preview.py 通過，根目錄 preview.html 無差異。Safari／iOS 實機未驗證。

截圖：desktop.jpg、mobile.jpg 為首屏；desktop-full.jpg、mobile-full.jpg 為完整提案。current-desktop.jpg、current-mobile.jpg 是本輪擷取的 Nuxt 內頁對照，comparison.jpg 是比較工具畫面。所有截图為瀏覽器實際渲染。
