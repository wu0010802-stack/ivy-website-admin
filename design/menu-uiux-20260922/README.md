# 導覽選單三款 mock-up

2026-09-22。使用者已選 B，並指定深綠「探索常春藤＋細線」頂部及機構社群。B 已整合 Nuxt，機構 Facebook 沿用專案既有的 https://www.facebook.com/ivykid；其他平台未提供，不猜填。最新依使用者要求，由 `polish-b.css` 改用一般乳白毛玻璃與深灰文字，保留精修字級、單列五校、較輕的社群入口；Nuxt 樣式同步。尚未部署。以下保留最初三款提案說明。

- [本機互動比較](http://127.0.0.1:8786/design/menu-uiux-20260922/)
- [A 墨綠精簡](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=a)：雙欄導覽、附行政區的五校捷徑，以及整塊可點的義華專線。推薦作為現有選單的延續。
- [B 米白目錄](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)：暖紙色、單欄順讀、固定順序與墨綠聯絡底欄。閱讀清楚，但選單高度較長。
- [C 校園優先](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=c)：先選校、看照片與聯絡，再看品牌導覽。選校同步更新電話、校園內頁與參觀路徑；其他主導覽位置較低。

`index.html` 支援桌機／手機比較；`screenshots/` 保存三款桌機、手機、頁面情境，以及兩張並排比較圖。手機預覽內容自然垂直捲動；不鎖頁面高度。頁首膠囊只作位置與色彩情境示意，本次提案主體為展開選單。

互動包含關閉／重開、Escape 返回開關、點外部關閉、鍵盤 Tab；C 校園分頁支援左右方向鍵、Home、End、選取狀態與動態讀屏提示。主要操作目標至少 44 × 44px。導覽連結另開現有官網，電話使用 `tel:`；驗證不會撥打電話或送出預約。

## 資料與整合界線

`data.js` 為目前 `web/server/data/site-fixture.json` 的五校欄位快照，圖片沿用 repo 已有的修復版素材；圖示擷取現有 Phosphor Regular sprite。A、B 的電話明標義華校，沒有暗示為五校統一專線。`original.png` 是使用者提供的比較截圖。

整合 C 時應改用正式的 `BookingCta`、已發布 CMS 校園與聯絡資料，保留目前依校區設定解析 LINE／電話／外連／表單／暫停的行為；本提案僅展示 `/visit/{campusKey}` 表單方向，未連 CMS 或新增預約功能。根目錄凍結原型未改；B 已整合 `web/app/components/SiteHeader.vue` 與 `studio.css`，社群由 `siteMeta.socialLinks` 設定。目前只接前台 fixture 設定，未擴充後台 CMS 社群編輯欄位。

## 驗證

檢查腳本：`output/playwright/menu-uiux-20260922/check.cjs`；結果：同目錄 `results.json`。Chrome 3 款 × 320／390／568／768／1440px，檢查水平溢出、操作尺寸、缺圖、導覽數量、選單開關與焦點返回；另檢查 C 五校資料、鍵盤循環與桌機／手機比較畫面裁切。

`node --check app.js`、兩個提案 JS 語法檢查與 `python3 package_preview.py`。既有 `preview.html` 重打包無差異。Safari／iOS 實機未驗證。

B 整合驗證：`output/playwright/menu-directory-b-20260922/results.json`。Chrome 六尺寸、實際四項錨點導覽、Facebook 新分頁（外站回應由本機替代）、手機首屏與收合膠囊、Escape 焦點返回均通過；修復原先面板繼承 `pointer-events:none` 導致點擊穿透，以及導覽使用舊 hash 的問題。

## 分校／機構順序修正

使用者要求分校資訊在上、機構在下；B 版電話深綠區加入 IG／FB／YouTube／LINE 四平台。義華沿用原有 Facebook 與 LINE；IG／YouTube 尚未提供，顯示非連結的「待提供」。圖示使用 Phosphor Regular；新增 Instagram 與 YouTube 來自官方 core/assets/regular。

Nuxt 由 `getCampusSocials` 排除重複的機構帳號，缺少電話對應校區不產生分校社群。資料欄位新增 `Campus.instagram`／`Campus.youtube`（目前皆 null）；前台設定支援，尚未擴充後台 CMS 編輯欄位。驗證與最新截圖在 `output/playwright/menu-campus-socials-20260922/`。

## 色彩與字級精修

最新分校區由深綠改為內縮淺綠，電話 22px；導覽桌機 20px／手機 18px、校名 14px、輔助文字 12px。移除社群厚框與重複的「前往」，保留有效入口的箭頭和未知帳號的「待提供」。實際 Nuxt 六尺寸、44px 點擊尺寸、鍵盤與連結目的地、文字對比及 200% 文字放大紀錄在 `output/playwright/menu-polish-20260922/`，最低文字對比 5.55:1，無選單橫向溢出或 runtime error。Nuxt typecheck 通過。Safari／iOS 實機未驗證。

## 毛玻璃更新

依使用者要求，整張 B 選單改為 80% 墨綠透底、24px 背景模糊、1.2 saturation、米白／淡綠文字與淡亮邊框。所有內部底色同步透光，保留上一輪的尺寸與資訊順序；減少透明度、不支援濾鏡與強制色彩模式提供實色備援。最新驗證與實站截圖在 `output/playwright/menu-glass-20260922/`。

## 一般淺色毛玻璃（最新修正）

使用者明確要求移除墨綠染色。最新版使用 72% 中性乳白透底、24px blur／1.1 saturation、深灰文字；內部色層與電話圖示同步改成中性色。保留精修字級、社群與資訊順序。最新截圖及驗證在 `output/playwright/menu-neutral-glass-20260922/`，此前墨綠毛玻璃僅為歷史版本。
