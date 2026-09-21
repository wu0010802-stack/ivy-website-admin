# 官網搜尋、GEO 與效能維護

## 交付範圍

此輪只修改本機官網程式，未部署、未開啟正式索引、未更動正式 CMS 或 Google 帳號。五校招生內容仍須園方確認。SEO 改善不等同已被收錄或取得特定排名。

### 搜尋與分享

- 首頁與五校共用 `usePageSeo`，SSR 輸出 title、description、canonical、OG／Twitter 分享圖與圖片 alt。
- JSON-LD：首頁機構／網站，分校 Preschool／BreadcrumbList；只引用頁面既有名稱、地址、電話、說明及照片。不生成評論、招生年齡、營業時間或地理座標。
- Sitemap 由與頁面相同的當前 release 建立，只列已發布 profile 的校區；沒有可靠發布時間，故不捏造 `lastmod`。
- CMS 既有的少數原型原文由 `publicCopy` 精確比對修正；園方自訂文案保持原樣，示意消息／活動及待補資料繼續明確標示。
- `/admin`、`/preview`、`/visit` 使用 noindex 與 private/no-store。公開頁使用 no-cache，不增加 SWR／ISR／共享 HTML 快取。

### 圖片、影片與字型

原始素材保留。響應式圖片與影片衍生檔使用內容雜湊檔名及 immutable 快取；新增或更新母檔後重新產生，不覆寫相同 URL 的內容。

```sh
python3 scripts/optimize-site-images.py
python3 scripts/optimize-site-videos.py
python3 scripts/optimize-site-fonts.py
```

工具需要 Pillow、ffmpeg、fontTools 與 Brotli。影片順序執行、限制兩個執行緒；保留長度／比例，移除背景片音軌。兩個字型 WOFF2 與原 WOFF 字形完全相同，仍是既有子集；新 CMS 標題缺字問題仍需取得完整授權字型，不能用壓縮取代。

- 首頁與分校只 preload 自己首屏圖片，並與 `<img srcset/sizes>` 一致。
- 下方圖 lazy；影片進畫面才播放，離屏／背景暫停。首屏影片等待封面完成；省流量／慢速網路不自動播放。
- WebGL 模組靠近視窗才 import；省流量不啟動 WebGL，CSS 翻面仍可用。

### 量測管道

`NUXT_PUBLIC_TELEMETRY_ENABLED` 預設於 production 開啟、development 關閉，可明確設 false。尊重 DNT 與 Global Privacy Control。未新增 Cookie、localStorage 識別碼或外部分析服務。

- `web-vitals` 標準版收集 LCP、INP、CLS；依 document 進入路徑及 mobile／desktop 分組，SPA 換頁不被誤認為新 CWV。
- `/api/telemetry` 僅接受固定公開頁型、五校 key、裝置分類、事件、指標數值及暫時隨機 UUID。拒絕多餘欄位、跨站來源、超大請求與超額事件，每程序每分鐘上限 600 次。
- 事件寫成 `website_telemetry` JSON 日誌，未新增 DB／migration。平台可能另外保存基礎 HTTP 存取日誌；這不在本程式事件欄位內。
- 頁面與預約入口計數為 `page_view`／`visit_click`，不是唯一訪客或成功率。
- 電話／LINE 點擊沿用既有後端 analytics；`request_created`／`visit_confirmed`／`visit_completed` 仍只能由後端真實流程記錄。既有後台 funnel 可看這些計數。
- 新增 CWV 與 page_view 的檢視方式是下列日誌報表，尚未新增後台圖表。平台日誌保存期間依部署方案而定，需定期匯出相同期間資料；指標是客戶端觀測，不作財務或業務完成權威。

```sh
node scripts/summarize-web-vitals.mjs < exported-web-logs.jsonl
```

報表按 metric ID 去重後算 p75。目標：LCP ≤ 2500ms、INP ≤ 200ms、CLS ≤ 0.1；樣本數不足時不宣稱達標。不同裝置分開觀察，固定期間追蹤。

## 正式上線前需使用者完成的外部項目

1. 確認正式網域、DNS／TLS 與所有舊正式 URL。Railway 臨時網域目前仍保持 noindex；不同 hostname 轉址需知道正式網域後設定。
2. 園方在 CMS 審閱／發布五校最新資料；空白、範例與待補內容不應當成核定資訊。現有有用資訊由程式整理，不寫回正式 DB。
3. 正式網址與內容確認後，在部署環境設定下列值並重新驗證。此輪尚未執行：

```sh
# 設定值範本，正式網域須替換；不是目前已啟用狀態。
NUXT_PUBLIC_SITE_ORIGIN=https://正式網域
NUXT_PUBLIC_INDEXING_ENABLED=true
NUXT_PUBLIC_TELEMETRY_ENABLED=true
```

4. 用下列唯讀指令驗證正式站；驗證通過後，在本人 Search Console 帳號完成網域驗證、提交 `/sitemap.xml`、抽查首頁與五校 URL 檢查。

```sh
node scripts/check-public-seo.mjs https://正式網域
```

5. 每校 Google 商家檔案由有權限的帳號核對名稱、地址、電話、時間及照片；網站連結設成 `https://正式網域/campuses/對應key`。不複製義華社群帳號到其他校。
6. 收錄後固定比較自然搜尋曝光／點擊、商家互動、校區瀏覽／聯絡與後端真實需求筆數。以相同日期範圍比較，不把不同口徑計數拼成精確轉換率。

## 五校內容待補表

| 校區 | 網址 key | 已可使用 | 尚待園方核定 |
| --- | --- | --- | --- |
| 義華 | yihua | 校名、行政區、地址、電話、既有介紹／巡覽、LINE | 年齡、班別、服務／接送／延托時間、當期名額與費用、實際課程案例 |
| 明華 | minghua | 校名、行政區、地址、電話、既有介紹 | 同上；專屬 LINE／FB、實拍巡覽 |
| 崇德 | chongde | 校名、行政區、地址、電話、既有介紹 | 同上；專屬 LINE／FB、實拍巡覽 |
| 國際 | international | 校名、行政區、地址、電話、既有介紹 | 同上；專屬 LINE／FB、實拍巡覽 |
| 仁武 | renwu | 校名、行政區、地址、電話、既有介紹 | 同上；專屬 LINE／FB、實拍巡覽 |

每項內容記錄核定人與確認日期，放入既有「分校介紹／FAQ」編輯流程。不要填推測數字。實際聯絡／參觀流程以各校目前 booking mode 為準，送出需求不等於預約成立。

GEO 以真實校區資訊、可讀 SSR、內部連結與實際教學案例為主。本輪不新增 llms.txt、虛構 FAQ rich result 或大量近似關鍵字文章。新聞維持既有 dialog，獨立新聞路由仍不在原核可範圍。

參考：[Google AI 搜尋指引](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)、[Core Web Vitals](https://web.dev/articles/vitals)、[Google 商家在地搜尋](https://support.google.com/business/answer/7091)。

## 2026-09-21 本機驗證紀錄

- Node 22.23.2：57 項 Vitest、Nuxt typecheck、正式 server build 通過。
- 7 項既有 Playwright SSR／404 測試通過；五校與首頁關閉 JavaScript 仍有內容。
- `check-public-seo.mjs` 驗證索引開啟／關閉、6 頁 metadata／JSON-LD／canonical、sitemap、私有頁 noindex。
- 390px／1440px Chrome：無水平溢出、hydration error 或素材破圖；校區換頁、電話事件、手機影片選檔、day 延後下載、save-data 及 DNT 通過。
- 本機正式 live 模式後端不可達：首頁、校區、公開資料及 sitemap 均為 503；無 fixture fallback。事件格式、額外欄位、跨站、超大 payload 與 immutable 素材快取通過。
- `node --check app.js`、`python3 package_preview.py`、`git diff --check` 通過。vanilla 原始碼未變，preview 重打包結果一致。
- 同一台 Chrome、390／1440px、減少動態、首次首頁載入到 networkidle 的 resource transferSize 合計：修改前 1,167,582 bytes，修改後約 701,112／720,164 bytes。不含 HTML 主文件、捲動後資源與自動影片；期間另有使用者輪播修改，不將差值全歸因單一程式變更。不是正式站傳輸量或 CWV 保證。
- 新量測抓出既有 hero 動效初始化造成的手機版面位移約 0.30；已加入首次繪製前的幾何預留，保留無 JS／減少動態的靜態閱讀；高度低於 760px 的手機保留靜態首屏，避免轉場因內容放不下又退回造成跳動。回歸指令：`node scripts/check-layout-stability.mjs`。
- 截圖、網路摘要、layout-shift 診斷與本機 telemetry 日誌彙整在 `output/playwright/seo-performance/`。這些全部為本機測試樣本，不代表真實家長數據。

最後四視口首屏位移回歸通過：375×812 = 0.06666、390×844 = 0.08190、390×667 = 0.00023、1440×900 = 0.00022。此為本機冷載入實驗室樣本，不等於 CrUX／真實流量的 p75。
