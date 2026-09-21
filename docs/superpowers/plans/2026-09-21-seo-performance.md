# 官網 SEO、GEO 與效能 Implementation Plan

> 依 2026-09-21 使用者「都幫我做」執行；主代理分批實作，scout 唯讀盤點。

**Goal:** 補齊公開頁分享／結構化資料、降低非必要下載、完成可檢查的效能與招生事件追蹤。
**Architecture:** 沿用 Nuxt SSR 與已發布 release。SEO 與 sitemap 共用公開內容；圖片衍生尺寸有 manifest；效能事件走同源 Nuxt 驗證後輸出結構化日誌，原有招生成功事件仍由後端記錄。
**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Vitest / Playwright / Pillow / ffmpeg。
**Spec:** 本次對話核可的五項方向，以及 `docs/specs/2026-09-19-website-admin.md` 的發布一致性與招生內容邊界。

## 約束

- 保留全部既有修改，不 commit、push、部署或更改正式資料。
- 正式網域未確認前保持 noindex；預覽、案件／預約與後台不索引。
- 不新增共享 HTML 快取、SWR 或 ISR；不把 fixture 偽裝為已發布資料。
- 不杜撰年齡、時段、學費、課程、評論或社群帳號。
- 不修改後端 API contract 或資料表；事件不含姓名、電話、token、完整 URL。

## 執行項目

- [x] SEO：測試 canonical origin、JSON-LD 注入防護、校區資料、sitemap 發布來源與上游錯誤；補共用 SEO 工具、頁面 metadata／分享圖片／Breadcrumb／Preschool，正式索引設定驗證。
- [x] 公開內容：整併公開資料讀取，移除頁面連續 fixture/live fetch；sitemap 使用同一資料來源。清理可安全替換的原型文案，保留示意消息標示與未核定資訊，整理五校待補表。
- [x] 媒體：產生有雜湊檔名的響應式 WebP、實際寬高 manifest；首圖按頁預載、下方 lazy；影片省流量保護、首圖完成後才啟動 hero；生成手機 hero 與壓縮 day 影片，保留原檔。
- [x] 追蹤：測試事件白名單／欄位清理；加入 web-vitals 與同源收集端點；補頁面／預約入口與電話、LINE 點擊，保留後端成功事件權威；提供日誌彙整工具。
- [x] 驗證：依序跑單元測試、typecheck、build、SSR／SEO／404／瀏覽器手機桌機檢查；圖片／影片尺寸與大小比較；`node --check app.js`、`python3 package_preview.py`；寫入 README 與交付文件。

## 驗收

1. HTML 直接取得正確 canonical、OG 圖片及可解析 JSON-LD，CMS 中特殊字元不能逃出 script。
2. 索引關閉時 robots 與 sitemap 維持關閉；正式 origin 不接受路徑、帳密或非 HTTPS。
3. 下方影片不在首屏下載，校區頁沒有首頁封面 preload，responsive 圖片無破圖。
4. 新 SSR 與換頁仍取得當前 release；後端失敗保持 503。
5. 事件只收固定欄位，私有路徑不追蹤；指標依首頁進入路徑歸屬，不將 SPA 換頁冒充 CWV。
6. 外部帳號工作與內容待補項集中在交付文件；不宣稱正式收錄／排名或真實 CWV 已達標。
