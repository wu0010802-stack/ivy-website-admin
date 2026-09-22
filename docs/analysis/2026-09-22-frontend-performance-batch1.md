# 前台載入效能第一批 — 2026-09-22

狀態：已依部署指示補完固定快照的整合建置及瀏覽器驗收，Railway 部署 SUCCESS，線上公開檢查與互動驗收通過。先前 `ENOSPC` 已透過 APFS clone 與減少本輪重複輸出暫時排除；未 commit 或 push。

## 修改

- `CampusTour.vue` 接近視窗 200px 時才開始載圖；靜態圖片提供 responsive 候選，160px 新增版本供小縮圖使用。展開或放大改用原圖，CMS 媒體 UUID 維持原 API 路徑。
- `performance.css` 在 hydration 前預留理念／日常簾幕的軌道、負 margin 與拍立得間距。減少動態與無 JS 保留靜態模式。
- `DayExperience.vue` 的封面等實際捲入閱讀範圍才載入，與是否允許自動播放分開。
- LINE Seed 700 切成 24 字／6,680 bytes 的首屏包與 701 字／152,960 bytes 的其餘包。只預載首屏包；字形覆蓋與字寬已逐字檢查。其餘包仍可能因下方標題而下載，不宣稱全站只下載 6.7 KB 字型。
- 無 JS 備用圖片改用經 attribute 跳脫的 `noscript` HTML，避免 Vue 對 noscript 文字節點做錯誤 hydration。已補上特殊字元安全測試；部署快照的五尺寸與無 JS 瀏覽器驗收通過，沒有 hydration 警告。

## 受控量測

本機 Nuxt production build、development fixture、gzip proxy；Chrome 390×844／DPR 3、下載 1.6 Mbps、延遲 150ms、CPU 4 倍限速、停用快取。每頁三次，觀察初始 12 秒。以修改前隔離副本為基礎套上效能變更比較，不拿較舊正式站與目前本機設計直接計算改善率。

| 指標 | 修改前 | 修改後 |
| --- | --- | --- |
| 首頁 LCP，三次（ms） | 2052／2808／2128 | 1808／1952／1856 |
| 首頁 LCP 中位數 | 2.128 秒 | 1.856 秒，約減少 13% |
| 義華 LCP，三次（ms） | 4832／4800／4792 | 3188／3200／3016 |
| 義華 LCP 中位數 | 4.800 秒 | 3.188 秒，約減少 34% |
| 首頁初始圖片傳輸量 | 278,803 bytes | 168,889 bytes，約減少 39% |
| 義華初始圖片傳輸量 | 549,984 bytes | 216,851 bytes，約減少 61% |
| 首頁 CLS，三次相同 | 0.000524 | 0 |
| 義華 CLS，三次相同 | 0 | 0.000302 |
| 首頁 FCP 中位數 | 1.316 秒 | 1.308 秒 |
| 義華 FCP 中位數 | 1.148 秒 | 1.256 秒 |

圖片傳輸量包含 HTTP headers，不含影片；不能把觀察期間未下載的影片誤算為永久節省。義華 LCP 仍高於 2.5 秒目標，FCP 沒有改善；這是少量實驗室樣本，不是真實訪客 p75 或正式站成效。此受控比較完成後另修正 noscript hydration；最終部署版本已完成下方線上量測與驗收。

## 已完成的驗證

- `npm --prefix web run test:unit -- --maxWorkers=2 --minWorkers=1`：15 檔、91 tests 通過，包含圖片來源／原圖放大與 HTML attribute 跳脫。
- 最後 noscript 修正前的整合版本：Nuxt build 與 typecheck 通過。
- `geometry.cjs final`：320／375／390／768／1440px 凍結 JavaScript、等字型完成再放行，理念、日常、拍立得及消息區塊位置與高度前後一致。修改前 390／1440px 的日常區塊曾分別上移 844／900px。
- `node --check app.js` 與 `python3 package_preview.py` 通過；原型產物內容沒有 diff。
- 字型產生器已驗證 725 字聯集與每字 metrics；圖片 manifest 僅改 campus／garden／classroom 三筆。

## 部署補驗與後續

1. 固定部署快照 build／typecheck、前台 77 tests／後台 27 tests 已通過。採線上基底，未混入其他工作區測試與功能，因此數量不同於整個工作區的 91 tests。
2. 部署快照已通過上述 18 組 Chrome 情境、五尺寸 hydration 幾何及暖快取驗收。暖快取以 Resource Timing 的 transferSize=0 判定，涵蓋記憶體快取，不只 CDP fromDiskCache。同樣 18 組線上覆驗已通過。
3. 最後版本首頁及五校各三次限速冷載入已完成，共 18 次，結果如下。Safari／iOS 實機與正式訪客 CWV 尚未驗證。
4. 第二批影片 Range／進一步壓縮尚未實作；不新增共享 HTML 快取或改發布一致性。

本機證據目錄：`output/playwright/performance-proposal-20260922/`，含 before／after 原始 network、`local-comparison.json`、`geometry-final.json`、截圖及驗證腳本。最後一次義華樣本另存在 `local-after-campus-last.json`。修改前快照：`versions/before-performance-batch1-20260922-144854/`。

重跑資產：`python3 scripts/optimize-site-images.py --only campus garden classroom`；`python3 scripts/subset-critical-fonts.py`（需 fontTools／Brotli）。Node 使用 22.23.2；本機 fixture 需 `NUXT_WEBSITE_ENV=development NUXT_PUBLIC_CONTENT_MODE=fixture`。原有 Hero CSS calc/clamp 與延後載入 Three chunk 的 build warnings 仍存在。

## 部署範圍

以目前正式 day-caption release `52c0092371b0902c9838a4859fa5d48f8ef9f518814ef0f378efee97a12dd5e8` 為基底，只套本次 17 個 web 檔案差異。保留正式版 Hero 動效的 CSS 預留條件；工作區另有尚未部署的手機 Hero 自然捲動修改，沒有整檔帶入。固定快照 `794731a2ae254d422ee2ba2a9c8051ea16d225e71b8f08918a7f5f09d1428646`，392 檔／45,892,723 bytes；web deployment `d07e2cc6-4805-44d5-94b7-26efe45b3bde`。部署與後續驗證證據：`output/railway-performance-20260922-153019/`。

## 正式站驗證結果

Railway deployment `d07e2cc6-4805-44d5-94b7-26efe45b3bde` 為 SUCCESS，公開 `/release.json` 與固定快照一致。51 項公開 GET-only 檢查、18 組瀏覽器情境皆通過；未登入後台或寫入正式資料。已檢視 390／1440px 首頁與巡覽 JPEG；截圖等待完整載入與 decode，避免把尚未完成解碼的中間畫面當成空白圖。

線上限速條件與前述相同；每頁 3 次。下表是最終正式版本的實驗室抽測，與工作區改版的本機比較分開記錄。

| 頁面 | LCP 中位數 | 三次最大 CLS |
| --- | --- | --- |
| 首頁 | 2.332 秒 | 0.000000 |
| 義華 | 3.284 秒 | 0.000302 |
| 明華 | 3.404 秒 | 0.000000 |
| 崇德 | 3.124 秒 | 0.000000 |
| 國際 | 3.252 秒 | 0.000000 |
| 仁武 | 2.876 秒 | 0.000000 |

首頁 CLS 三次皆為 0；各分校 LCP 仍高於 2.5 秒目標，後續可繼續評估主圖傳輸與字型／影片競爭，不把本輪結果宣稱為全站 CWV 已達標。18 次皆無 runtime error，沒有提早載入日常影片或義華巡覽原圖。暖快取已確認兩包字型 transferSize=0。
