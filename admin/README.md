# 常春藤官網後台（admin/）

Vue 3 + TypeScript + Pinia + Element Plus + Vite。API 走 `/api/website/v1`，dev server 會 proxy 到 `ADMIN_API_INTERNAL_BASE`（預設 `http://127.0.0.1:8000`）。

```bash
npm run dev          # http://localhost:5173/admin/
npm run typecheck
npm run test:unit    # vitest（jsdom），測 src/**/*.test.ts
npm run build
```

## 結構

- `src/router/nav.ts`：側欄分組與每頁標題、角色限制；路由 meta 從這裡帶入，不要在兩處各寫一份。
- `src/api/labels.ts`：校區、狀態、角色等代碼的中文與時間格式化；畫面上不要直接印 API 代碼。
- `src/composables/useUnsavedChanges.ts`：內容與設定共用未儲存攔截、處理中離頁保護。
- `src/composables/useRequestSequence.ts`：忽略過時與卸載後的清單／內容回應。
- `src/stores/openRequests.ts`：側欄「參觀案件」的待處理數字（與總覽同源，換頁更新、30 秒快取，案件狀態變更後強制重抓）。
- `src/composables/useCampusScope.ts`：登入者可見校區與預設選取。
- `src/composables/useContentItem.ts` + `src/components/ContentEditor.vue`：內容編輯頁的資料層與外殼（草稿／發布狀態、未儲存攔截、黏底動作列）；新增內容 kind 時只要寫欄位。
- `src/composables/useCampusContent.ts`：分校內容切校前確認未儲存修改。
- `src/style.css`：全域 token 與 Element Plus 主題覆寫（品牌深綠 primary、淡綠色調中性色）。

驗收紀錄見 `../docs/website-admin/acceptance.md`。

## 介面驗證（2026-09-21 第二輪）

- `AdminSidebar.vue` 共用桌機與手機導覽；搜尋結果先經角色限制，分組收合不影響路由授權。手機外殼由 `AdminLayout.vue` 的 Element Plus drawer 管理焦點與關閉。
- `adminUx.test.ts` 驗證搜尋的權限與分組、內容處理中鎖定、案件篩選過時回應。低記憶體環境使用 `npm run test:unit -- --maxWorkers=1 --minWorkers=1`。
- 本機官網若使用其他埠，可在未版控的 `.env.local` 設定 `VITE_WEBSITE_ASSET_BASE`；例如此輪官網運行於 `http://localhost:3010`。
- 瀏覽器實測：桌機總覽、390px 手機總覽／編輯／案件／素材搜尋、320px 上傳對話框、1024px 編輯與取消離開。沒有執行發布、儲存、上傳或預約寫入；有資料清單與其他瀏覽器留待後續驗收。

## 介面驗證（2026-09-22）

- 手機直向清單涵蓋時段、通知、使用者與操作紀錄；新增有標籤的篩選、清單摘要、錯誤重試及局部搜尋。
- 27 項單元測試涵蓋通知批次與回應順序、設定切校取消／放棄、儲存衝突、空 HTTP 錯誤、個資清理報告失效、重新整理期間的帳號操作鎖定。`npm run build` 含型別檢查通過。
- Chrome 10 個頁面 × 1440／390／320px 共 30 組版面，加上載入失敗重試、未儲存保護、手機操作與圖釘觸控／鍵盤。證據在 `../output/playwright/admin-uiux-20260922/`。
- 瀏覽器資料由本機測試腳本攔截 API 回應；僅驗證 UI，未重新驗證真實後端授權／寫入，也未部署或執行真實個資清理。

### 正式部署驗證

2026-09-22 已部署 `1e3b1147-edc6-487c-a144-6b3a6bdb9515`（web / SUCCESS）。39 項 HTTP 與 32 項 Chrome 驗證通過，含正式後台登入、8 頁 × 3 尺寸、未儲存取消／放棄、手機導覽及 JS／CSS 逐檔 hash。唯讀驗證，未修改帳號、預約、CMS 或素材；session 已登出。紀錄：`../output/railway-admin-uiux-20260922-133447/`。
