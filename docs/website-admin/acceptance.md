# 官網後台驗收表（Task 11）

依 `docs/superpowers/plans/2026-09-19-website-admin.md` Task 11；每階段結束只填該階段列，其餘標 `not-run` 並註明所屬階段。完整報告見同次交付訊息；本檔只保留可長期追蹤的結論列表。

| ID | 階段 | 驗收情境 | 狀態 | 證據 |
|---|---|---|---|---|
| A18 | A | 1440/1024/390/375px、鍵盤、降動態、無水平溢出 | 見下方階段 A 小結 | `artifacts/website-baseline/*.png`；Playwright 視覺回歸待補 |
| A19 | A | 原型快照可離線開啟；新版 Nuxt localhost／授權預覽可用，fixture 不會真實提交 | 部分 | `artifacts/prototype-baseline/preview.html`（+ sha256）已備妥；Nuxt localhost 預覽見階段 A 小結 |
| A21 | A | 五校正式路徑、直接開啟／刷新、前進後退、舊 hash 相容、未知校區 404 | 見下方階段 A 小結 | Nuxt route 測試 |
| A22 | A | 主要內容在 SSR HTML，禁用 JS 仍可讀；不靠整頁 ClientOnly | 見下方階段 A 小結 | raw HTML 檢查 |
| A24 | A | 無 hydration mismatch，進出頁清理動畫／影片；私有資產與原始碼不被靜態服務暴露 | not-run | 待 Playwright E2E |
| A25 | A→B | 階段 A：缺字檢查報告完整 | 完成（部分缺字為已知限制） | `docs/website-admin/baseline.md` §字型缺字檢查 |
| A01–A17, A20, A23 | B/C/D | — | not-run（屬後續階段） | — |

## 階段 A 小結（2026-09-19）

| 項目 | 狀態 | 備註 |
|---|---|---|
| A18 四視口/鍵盤/降動態/無水平溢出 | 部分 | 48 項 Playwright e2e（4 視口 × SSR 內容/舊路由）全過；**尚未**建立 `toHaveScreenshot` 像素回歸測試（門檻 maxDiffPixelRatio 0.01），僅人工截圖比對 |
| A19 原型快照離線可開 + Nuxt 預覽可用 | 部分 | `preview.html` 快照與 checksum 已備妥；Nuxt `npm run dev`/`start` 本機可用且已驗證；私有登入草稿預覽屬 Task 8（階段 C），此階段未做 |
| A21 五校正式路徑/前進後退/舊 hash/未知 404 | 通過 | `/campuses/{key}` 五校皆可達；未知校區與未知 visit key 均 404；舊 hash 白名單轉址 5 項 e2e 全過 |
| A22 SSR 主要內容禁用 JS 可讀 | 通過 | `javaScriptEnabled:false` 情境下五校＋首頁 heading/內文可讀，6 項 e2e 通過 |
| A24 無 hydration mismatch / 私有資產不外洩 | 部分 | dev/start log 未見 hydration 警告；**未做**「原始碼/私有素材不可被靜態服務讀到」的邊界測試 |
| A25 缺字檢查（階段 A 範圍） | 通過 | 見上方「字型缺字檢查」，已知限制已記錄，未默默退回系統字（沿用子集現況） |

**原型凍結點**：尚未建立（未經使用者要求不 commit；根目錄 vanilla 檔案本階段未被觸碰，仍是目前 HEAD `8417864`）。

**使用者親自看過同意**：**尚未**——此為進入階段 B 的硬性閘門。已具備可看的方式：`cd web && npm run dev`（需先啟動 `backend/`，見 `docs/website-admin/README.md`）。
