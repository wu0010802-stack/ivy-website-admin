# 頁尾配色提案・2026-09-22

使用者提供共用頁尾截圖，要求配色 mock-up。三案保留目前 `SiteFooter.vue` 的文案、字型、欄位與響應式斷點；備註依使用者截圖為「參觀時間與入學資訊，請向各校確認。」

| 方案 | 底色 | 主要文字 | 點綴 | 方向 |
| --- | --- | --- | --- | --- |
| A 深森林綠（推薦） | `#24483F` | `#F5F2E7` | `#E3C77B` | 品牌收尾鮮明、米白與暖金 |
| B 鼠尾草綠 | `#E4EADB` | `#294B3D` | `#537047` | 柔和、自然 |
| C 奶油暖黃 | `#F3E6BF` | `#354B3E` | `#77592D` | 明亮、親切 |

入口 `index.html`，可切換桌機／手機。`preview.html?v=a|b|c|original` 為原尺寸預覽；導覽為同頁定位示意，不是完整官網。

本機預覽：<http://127.0.0.1:8797/design/footer-colour-directions-20260922/>。服務若未啟動，在 repo 根目錄執行 `python3 -m http.server 8797 --bind 127.0.0.1`。

使用者已選定 A，整合至 Nuxt `web/app/components/SiteFooter.vue` 並於同日部署正式官網。首頁消息區繼續漸退至暖白，再接 A 深綠頁尾；凍結的 vanilla 原型不回寫。本目錄保留三案比較與原始 mock-up 截圖。

正式部署 `2b928a25-1865-47ee-90a1-dfbee3b9dc53`，release `87efef1ebe8118ace30cc39a54fac7907b65a815bfee91f3af357106129d7c3f`。39 項公開 HTTP 與 9 組瀏覽器驗證通過；自動核准審查未授權正式帳密及私有管理資料存取，故未執行後台登入驗證。證據與線上截圖：`output/railway-footer-a-20260922-150539/`。

整合後驗證：Node 22 typecheck、三路由 HTTP／scoped CSS、Chromium 九組頁面／尺寸（320–1920px）、鍵盤焦點／hover／強制色彩／減少動態皆通過，無 console warning 或 runtime error。結果為 `output/playwright/footer-colour-directions-20260922/integration-results.json`，實際 Nuxt 畫面為同目錄 `integrated-*.png`；Safari／iOS 實機未驗證。[查看本機 Nuxt 頁尾](http://127.0.0.1:3016/#footer-campuses)。

Chromium 桌機／手機截圖在 `screenshots/`；驗證腳本與結果在 `output/playwright/footer-colour-directions-20260922/`。

驗證結果：原色及三案 × 320／390／768／1440px 共 16 筆無橫向溢出，10 個導覽連結均保留至少 44px 高度；字型載入成功，桌機／手機切換正常，無頁面錯誤或資源載入失敗。三案文字最低對比分別為 A 6.13:1、B 4.53:1、C 4.70:1。Safari／iOS 實機未驗證。

`node --check app.js`、比較頁 JS 語法檢查及 `python3 package_preview.py` 均通過；重打包後根目錄 `preview.html` 無 Git 差異。
