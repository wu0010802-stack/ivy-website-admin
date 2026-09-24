# 頁尾文字配色・2026-09-24

使用者看完頁尾配色第三批（`design/footer-colour-directions-20260924/` 的 R 與 U–Z）後決定「走 A」：底色回到 09-22 的 A 深森林綠 `#24483F`，並要求探索文字顏色，其中一版保留全白文字。本輪只換文字色；底色、分隔線 `#526D61`、文案、字型、欄位、斷點都照目前 Nuxt `SiteFooter.vue`（六個導覽連結、無底列備註）。**結果：使用者選 1 全白，同日套用到 Nuxt `SiteFooter.vue`（A 底色＋全部文字 `#FFFFFF`，見 DESIGN.md 最上方）。**

| 案 | 名稱 | 主文字 | 點綴（英文品牌名、「我們的大家庭」） | 小字（標語、版權） | 品牌中文 | 最低對比 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 現行 A：米白＋暖金（基準） | `#F5F2E7` | `#E3C77B` | `#C2D0C5` | `#FFF9E9` | 6.13 |
| 1 | 全白（使用者指定保留） | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | 10.13 |
| 2 | 白字＋暖金 | `#FFFFFF` | `#E3C77B` | `#FFFFFF` | `#FFFFFF` | 6.13 |
| 3 | 白字＋淡綠小字 | `#FFFFFF` | `#B7D2C2` | `#B7D2C2` | `#FFFFFF` | 6.27 |
| 4 | 米白＋薄荷點綴 | `#F2F6EF` | `#A6DCB6` | `#BDD2C5` | `#FBFDF8` | 6.36 |
| 5 | 米白＋暖黃點綴 | `#FBF7EC` | `#FFD66B` | `#C9D5CB` | `#FFFBF0` | 6.69 |
| 6 | 米白＋杏桃點綴 | `#F8F1E8` | `#F4BE98` | `#CCD5CB` | `#FFF8F0` | 6.11 |
| 7 | 米白＋天藍點綴 | `#F2F5F0` | `#9ED5E6` | `#BFD1CC` | `#FBFCF8` | 6.32 |
| 8 | 奶油黃字 | `#F4E6C1` | `#F2C65F` | `#D2CDA9` | `#FFF4D6` | 6.28 |
| 9 | 淡綠同色 | `#D8E9DD` | `#9FD4B0` | `#A9C4B4` | `#F1F8F2` | 5.42 |

最低對比＝四種文字色對 `#24483F` 的 WCAG 比值。1 全白依使用者要求用純 `#FFFFFF`（本案其他地方的白都帶暖色偏移）。

## 預覽

- 入口 `index.html`，右上切換桌機／手機，可篩「白字／換點綴色／整體換色／候選」；候選存在 localStorage `ivy-footer-text-a-20260924-picks`，讀寫失敗只在當頁記住。`preview.html?v=t0…t9` 為原尺寸單頁。
- 本機：<http://127.0.0.1:8797/design/footer-text-colour-a-20260924/>。服務沒開就在 repo 根目錄執行 `python3 -m http.server 8797 --bind 127.0.0.1`，結束 `pkill -f "http.server 8797"`。
- 版面 CSS 從上一輪 `footer-colour-directions-20260924/preview.css` 複製，只換色票區塊。

## 驗證（2026-09-24，Chrome via Playwright）

- 10 案 × 320／390／768／1440px 共 40 筆：無橫向溢出、LINE Seed 載入、導覽與五校連結高度皆 ≥44px、無頁面錯誤或資源載入失敗、底色皆為 `#24483F`；1 全白的品牌名、英文、導覽、標語、標籤、版權六處實際計算色皆為 `rgb(255,255,255)`。
- 對照頁「白字」篩選只剩 1、2、3，無高度為 0 的預覽框。
- 腳本 `output/playwright/footer-text-colour-a-20260924/shoot.cjs`；截圖在 `screenshots/`（`desktop-comparison.png`、各案 `t*-390.png`／`t*-1440.png`）。Safari／iOS 實機未驗證。
