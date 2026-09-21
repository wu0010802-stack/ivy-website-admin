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
- `src/composables/useCampusScope.ts`：登入者可見校區與預設選取。
- `src/composables/useContentItem.ts` + `src/components/ContentEditor.vue`：內容編輯頁的資料層與外殼（草稿／發布狀態、未儲存攔截、黏底動作列）；新增內容 kind 時只要寫欄位。
- `src/composables/useCampusContent.ts`：分校內容切校前確認未儲存修改。
- `src/style.css`：全域 token 與 Element Plus 主題覆寫（品牌深綠 primary、淡綠色調中性色）。

驗收紀錄見 `../docs/website-admin/acceptance.md`。
