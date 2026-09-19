# 官網前台技術選型評估

日期：2026-09-19。範圍：現行官網與已規劃 CMS／分校預約。**決策更新：使用者已採用 Nuxt，規格／計畫／Claude 提示詞已同步為 v2；同日再修訂為 v3（分四階段執行、第一版範圍縮減、字型子集處理、原型凍結點），產品程式尚未遷移。**下列比較保留作為決策背景；執行以 [v2 規格](../specs/2026-09-19-website-admin.md) 及其配套計畫為準。

## 建議

若目標是正式經營、持續更新內容的五校官網，建議前台採 **Nuxt + Vue 3 + TypeScript**，管理端沿用規劃中的 **Vue 3 + Vite + Element Plus**，業務 API 與資料庫維持 **FastAPI + PostgreSQL**。

React／Next.js 技術上可滿足需求；以目前已知的 Vue 技術棧、內容型官網與後台整合需求判斷，Nuxt 的學習及維護方向較一致。若接手團隊明確以 React 為主，Next.js 會成為合理替代方案。

上一份規格選 vanilla，是以保留原型、減少改動為優先；本次改以正式官網的網址、HTML 輸出、長期維護及 CMS 更新為評估基準。兩者優先順序不同，不表示現在原型不能使用或已證明有效能問題。

## 1. 本次實際看到的結構

| 現況 | 證據 | 對正式網站的影響 |
|---|---|---|
| `app.js` 739 行、82,154 bytes，混合資料、模板、路由與互動 | `app.js` | 需要拆責任；大小本身不足以證明效能不佳 |
| 主內容由模板字串產生，路由以 `main.innerHTML` 替換頁面 | `app.js:264`、`:330`、`:335`、`:736` | CMS 狀態、載入與錯誤處理加入後，維護責任會增加 |
| 五校與預約使用 hash 路由 | `app.js:736–739` | 正式分校網址、分享與搜尋資訊需另外處理 |
| 初始 main 空白，主要內容依賴 JS | `index.html:47–50` | 初始 HTML 沒有完整校區介紹；不能只改 title 就當 SEO 完成 |
| 共用 description，只有 title 隨路由改變 | `index.html:5–8`、`app.js:736` | 尚無各校伺服器輸出的 canonical／分享資訊 |
| 80 處事件註冊、4 個 IntersectionObserver、4 個 ResizeObserver | `app.js` 搜尋結果 | 有明確可拆元件的互動邊界，但計數不代表存在漏記憶體 |
| 已有多組清理函式，由路由統一執行 | `app.js:185–191`、`:326–327`、`:505–509`、`:553–557`、`:656–660`、`:716–722`、`:736` | 遷移時要保留行為並改放元件生命週期，不可直接丟掉 |
| 單檔預覽依賴固定檔名與精確字串替換 | `package_preview.py:22–67` | 不支援框架建置後的 chunk／hash 檔名，需另設預覽策略 |

目前 `noindex,nofollow` 符合原型用途，不視為 bug；正式上線才調整。新聞與活動仍是 dialog，30 週年只是提案，本次選型不擴大這些功能。

## 2. 選項比較

下表為依本專案條件作出的工程判斷，不是跨框架效能跑分。

| 選項 | 適合之處 | 本專案需付出的成本 | 判斷 |
|---|---|---|---|
| 保留 vanilla，拆模組 | 最少搬動、延續單檔預覽、沒有框架 runtime | 路由、資料流程、生命週期及預先輸出 HTML 要自行維護 | 若近期只需完成示範／簡單官網，可用 |
| Vue + Vite 純 SPA | 元件化、與後台一致、開發結構清楚 | 單純 SPA 不會自動補上完整首份 HTML 和正式 SEO 渲染策略 | 相較 Nuxt，不能同時解決本次主要需求 |
| React + Vite 純 SPA | 元件與狀態管理成熟 | 同樣需要另處理渲染／SEO，另增加 React 技術棧 | 此專案不優先 |
| Next.js + React | 有伺服器與客戶端元件、頁面路由與內容渲染方案 | 要遷移到 JSX、掌握 server/client 邊界並增加 React 維護面 | React 團隊接手時合理 |
| Nuxt + Vue | Vue 元件、頁面路由、SSR／預先渲染選擇，與現有技術方向一致 | 要處理 hydration、Node 渲染部署與內容快取 | **目前整體推薦** |
| Astro + Vue islands | 內容先輸出 HTML，只讓需要互動的區塊載入 Vue | 要維護 Astro 與 Vue 兩層，跨區塊互動及 CMS 發布仍需設計 | 若優先追求內容站少量 JS，可列第二候選 |

React 官方建議新應用從框架開始；因此要評估 React 路線，應比較 Next.js 等完整方案，而非只把原程式換成 React 語法。[React 官方文件](https://react.dev/learn/creating-a-react-app)

Next.js 可在伺服器元件中取得內容，互動與瀏覽器 API 則交由客戶端元件。[Next.js 官方文件](https://nextjs.org/docs/app/getting-started/server-and-client-components)

Astro 的 islands 模式可把互動限縮在個別區塊，並支援 Vue；這符合此站部分內容靜態、部分需要互動的特性，但不是自動較快的保證。[Astro 官方文件](https://docs.astro.build/en/concepts/islands/)

## 3. 採用 Nuxt 後的分工

```text
公開官網 web/：Nuxt + Vue 3 + TypeScript
  首頁／校區介紹／FAQ／消息顯示
  影片、照片卡、校區切換、校園探索、預約畫面

管理後台 admin/：Vue 3 + Vite + Element Plus
  內容、素材、發布、預約設定與接待

業務 API backend/：FastAPI + PostgreSQL
  授權、已發布內容、案件、容量交易、通知與稽核
```

- 前台與後台共用 API 型別、業務 enum 與品牌 token；不要求共用所有 UI 元件。
- 公開官網維持客製視覺，不把 Element Plus 後台外觀套入首頁。
- Nuxt 只處理頁面輸出與必要資料取得；名額、預約狀態、權限及資料寫入仍由 FastAPI 統一判斷，不另寫一套 Nuxt 預約後端。
- 第一版公開內容採 SSR，先確保發布後能讀到最新已發布 release，再依量測加入快取。公開 HTML 可短暫快取，但須有發布後失效／版本驗證機制。
- 預約設定、剩餘時段與實際提交要即時向 API 驗證；家長資料、後台及草稿預覽不得進共享 HTML 快取。
- Nuxt SSR 增加一個 Node 渲染服務。若改用純靜態產生，可省去該渲染服務，但 CMS 發布時要重建並部署對應內容；不能假設資料庫更新後靜態頁會自行更新。

Nuxt 支援 universal、client-side 及混合渲染；部署與快取方式需依選定模式配置。[Nuxt rendering 文件](https://nuxt.com/docs/4.x/guide/concepts/rendering)

## 4. 對目前功能的具體改善

### 元件邊界

建議拆成 SiteHeader、HeroVideo、AboutSection、DayExperience、DayMomentCard、CampusBoard、CampusTour、NewsDialog、CampusFaq、VisitForm、SiteFooter。這些對應目前已有功能，不是新增畫面。

內容 props 與互動狀態分開。每個元件只管理自己需要的 observer、timer、影片與事件；跨頁卸載時統一釋放。CSS animation、native dialog、IntersectionObserver 仍可沿用，無須為換框架增加大型動畫套件。

### 網址與初始 HTML

建議網址：`/`、`/campuses/yihua`、`/campuses/minghua`、`/campuses/chongde`、`/campuses/international`、`/campuses/renwu`、`/visit`、`/visit/yihua` 等。

各校 HTML 包含該校介紹、地址、標題、description、canonical、分享圖；可索引頁加入 sitemap。預約管理、預覽、後台保持 noindex。

Google 指引建議用可爬取的網址及 History API，而非以 fragment 載入不同主內容。使用框架只是實作工具，正確 HTML、網址、索引設定仍需驗收。[Google JavaScript SEO 文件](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)

舊 `#/yihua` 等連結要保留瀏覽器端相容轉址。fragment 不會送到伺服器，不能只寫伺服器 301 就宣稱舊 hash 連結已處理。

新聞／活動本輪仍可保留 dialog；要做每篇文章 SEO，再另外決定文章路由，不能順便擴大需求。

### 影片與捲動互動

- 保留目前六張照片卡、墨綠分校卡、金色頁首 CTA、影片與層疊捲動效果。
- 伺服器先輸出穩定的文字、圖片、poster 與版位；viewport、video.play、ResizeObserver、window/document 在瀏覽器掛載後處理。
- 桌機／手機 760px 分界、降動態、離開暫停、延遲載入均保留；不能用 SSR 時猜螢幕寬度造成兩端 DOM 不一致。
- 不把整個首頁包成 client-only 以迴避 hydration，否則失去預先輸出主要內容的目的。

Nuxt 文件要求妥善處理伺服器與瀏覽器環境差異，瀏覽器 API 及副作用應在合適生命週期執行。[Nuxt hydration 文件](https://nuxt.com/docs/4.x/guide/best-practices/hydration)

## 5. 必須接受或另行決定的成本

1. 遷移不是把 app.js 放進一個 Vue 元件：模板、狀態、事件與清理需要逐區搬移。
2. 原 CSS 可先保留，再依元件整理；不要同時改版、換 CSS 框架、換動畫套件，否則難以判斷視覺差異來源。
3. 本輪已採用「單檔原型快照＋Nuxt 本機／受控預覽網址」。不要求每次新版產出單 HTML；若未來追加此需求，需另做 exporter，框架 build 不能直接取代現有 Python 打包器。
4. 新增建置與 Node 運行環境，且需測試直接進校區 URL、重新整理、404、快取失效及 hydration。
5. 此次未執行效能測試；不能承諾換框架後更快。影片、照片、字型、DOM 與動畫仍需獨立量測及優化。

## 6. 已同步到 v2 的規格修訂

原三份交接文件已一起修訂，以下為修改對照：

| 原規格 | 應修訂 |
|---|---|
| 公開站維持 vanilla、hash 路由 | 改為 web/ Nuxt，保留視覺與互動，採正式路徑與舊 hash 相容 |
| website-api.js／website-content.js 全域 adapter | 改為 Nuxt data fetching/composables 與 typed API client |
| 沿用 main.innerHTML 渲染 | 改成對應 Vue 元件；禁止重新掛載舊整站 renderer |
| 固定字串替換產出 preview | 保留原型快照；新版採 Nuxt 服務與授權預覽，本輪不做新版單 HTML |
| 靜態 allowlist build-public.py | 改成 Nuxt 正式 build／靜態資產部署，仍禁止公開 repo 私有檔案 |
| hash SEO 留作後續 | 本輪完成校區 URL、SSR metadata、canonical、sitemap 與 404 |
| 只驗證客戶端呈現 | 加入原始 HTML、禁 JS 基本內容、直接進路由、無 hydration 錯誤與 CMS 發布新鮮度 |

建議順序：固定目前視覺基準 → 遷移首頁及一所分校、驗證動畫／SSR → 完成五校與預約元件 → 接 CMS 與六種模式 → 完整功能、視覺及發布驗收。尚未有正式後端接線，現在決定比接完 vanilla CMS 後再改框架少一次資料流程搬遷。

原本的 FastAPI 資料模型、各校預約模式、容量交易、角色與大部分後台驗收仍適用；需要修訂的是公開站實作及相依的部署／預覽／SEO 驗收。
