# 官網後台：本機啟動與測試命令（已上線，A–D 四階段全部實作）

所有 Node 指令需先確保使用 Node 22（本機系統預設是 25.x，不符 `.nvmrc`）：

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
node -v   # 應輸出 v22.23.2
```

## 後端 API（FastAPI，backend/）

隔離資料庫已建立：`ivy_website_dev`（開發）、`ivy_website_test`（測試），皆為本機 PostgreSQL 14.15，與 `ivymanagement` 完全獨立。

```bash
cd backend
uv sync                      # 安裝依賴（見 uv.lock）
uv run pytest -q             # 8 項測試：config 隔離檢查 + health check

# 啟動開發伺服器（需先設定環境變數，範例見 .env.example；
# WEBSITE_SESSION_SECRET 請自行產生，不要用 repo 裡的範例值）
set -a && source .env.example && set +a
export WEBSITE_SESSION_SECRET="<自行產生的隨機值，至少16字元>"
uv run uvicorn app.main:app --port 8000 --host 127.0.0.1
curl http://127.0.0.1:8000/api/website/v1/health
```

管理者帳號（階段 B 起可用）：

```bash
uv run python -m app.cli bootstrap-admin   # 互動輸入 email/密碼，密碼不進 log
uv run python -m app.cli seed --dry-run    # 檢查五校 seed 是否需要補
uv run python -m app.cli initialize-content ../content/site-fixture.json --dry-run
  # 新環境的啟動步驟：驗證後只補「從未發布過」的內容項（現在共 21 筆，含 shared_faq）；
  # 重跑不覆蓋既有草稿、不多建版本。--dry-run 只列出會補哪些，不寫入。
```

`content-seed-from-fixture` 仍存在，但只在 `home_about`／`home_hero`／`site_footer` 都還沒有任何版本時才會執行（有版本就整批拒絕，要覆蓋得加 `--force`），一般啟動請用 `initialize-content`，不要再把 `content-seed-from-fixture` 當標準啟動步驟。

## 管理後台殼（Vue + Vite，admin/）

```bash
cd admin
npm install
npm run typecheck
npm run build
npm run dev -- --port 5173   # http://localhost:5173/admin/，經 vite proxy 轉 /api/website/v1/ 到 backend
```

需先啟動 backend（見上）才能讓開發殼的健康檢查頁面顯示成功。

## 公開官網（Nuxt 4 SSR，web/）

```bash
cd web
npm install
npm run typecheck
npm run build
npm run dev            # http://localhost:3000
npm run start          # 驗證 production 輸出（需先 build）
npm run test:unit
```

## 根目錄整合腳本

```bash
npm run test:website       # 轉呼叫 web 的 Vitest
npm run test:e2e           # Playwright，四視口設定見 playwright.config.ts
npm run contract:generate  # 匯出 backend OpenAPI → contracts/openapi.json，再產生 contracts/generated/website-api.d.ts
npm run contract:check     # 檢查上述兩個產物是否與目前 API 一致（CI 用，非零表示 drift）
```

Playwright 使用系統已安裝的 Google Chrome（`channel: 'chrome'`），不需另外下載瀏覽器二進位。

## 基準資料

- `artifacts/website-baseline/`：現行原型 1440/1024/390/375px 首頁與五校頁截圖（gitignore，本機用）。
- `artifacts/prototype-baseline/preview.html` 與其 `.sha256`：`package_preview.py` 產出的離線快照備份。
- `content/site-fixture.json`：從 `app.js`／`index.html` 抽出的內容 fixture，Nuxt 階段 A 用它渲染頁面（尚未接 FastAPI）。
- `scripts/check-font-coverage.py`：字型缺字檢查（`python3 scripts/check-font-coverage.py`）。
- `scripts/capture-baseline.mjs`：重新拍攝基準截圖用（需先跑 `python3 -m http.server 8765` 服務根目錄原型）。

## 階段 B 起已涵蓋

- 帳號登入、CSRF、重新整理後恢復登入狀態、使用者管理、分校 scope（Task 3）
- 素材庫：上傳／驗證／引用保護／替換 API + admin UI（列表、縮圖、上傳對話框、刪除）（Task 4）
- 內容草稿／發布：`home_about`／`home_hero`／`site_footer` 三個 content kind，Nuxt 讀取已發布內容（Task 5，其餘內容項見 `docs/website-admin/acceptance.md` 階段 B 小結）
- 共用 OpenAPI 型別：`contracts/openapi.json` + `contracts/generated/website-api.d.ts`，admin 主要型別已改為引用生成檔（見上方 `contract:generate`/`contract:check`）
- Element Plus 介面語系已設為 `zh-tw`（原本對話框按鈕會顯示英文 OK/Cancel）
- 各校預約模式設定（`inquiry`/`line`/`phone`/`external`/`paused`/`slots`）+ 公開需求提交 API（idempotency、真實 PostgreSQL 併發驗證）（Task 6）
- 時段容量、確認/取消/未到場/改期狀態機、接待工作台（案件列表/詳情/聯絡紀錄/CSV 匯出）（Task 7，含最後名額真實 PostgreSQL 併發驗證）
- 通知 worker（DB lease、重試退避、crash 恢復）、本機 Email sink、站內通知、家長安全連結（token 只存 hash）與自助取消/改期申請（Task 9）

```bash
# 跑一次通知 worker（單次批次，非常駐；排程交給部署環境的 cron）
export WEBSITE_NOTIFICATION_EMAIL_SINK_DIR=./var/mail-sink
uv run python -m app.cli process-notifications
```

- 營運總覽 Dashboard、成效統計（防偽造）、操作稽核、全站設定與保存政策 dry-run、備份/還原指令（Task 10，見 `docs/website-admin/operations.md`）

```bash
# 備份 / 還原（詳見 operations.md）
uv run python scripts/backup_website.py ./var/backups
WEBSITE_ENVIRONMENT=test uv run python scripts/restore_website.py ./var/backups/website-db-*.sql
```

## 現況（2026-09-25，`feature/admin-gaps-20260925` 分支已完成）

以下項目原本列在「尚未涵蓋」，已全部補上，細節與測試證據見 `docs/website-admin/acceptance.md` 底部「2026-09-25 小結」：

- 既有素材 dry-run importer（`python -m app.cli import-site-assets`）。
- 週期時段規則自動往後延展、休假例外日、取消休假重開時段。
- 內容審核流程（送審／核准／退回，過期待審版自動標記已被取代）與整份內容的排程發布（到期時官網已是更新版本會略過、不蓋回舊內容）。
- 全站 release 層級的一鍵還原（`content.release_restore`，限總管理者）。
- 稽核範圍大幅擴大（素材、時段、案件狀態轉換、聯絡紀錄、改期核准／退回等），並有 `test_audit_coverage.py` 靜態檢查擋漏寫。
- 個資保存政策改為可在後台設定天數並持久化（`retention_policies`），依結案時間起算，有清理紀錄與定期工作開關。
- 素材庫：引用記錄版本與欄位路徑、批次替換、封存與待清理（不再上傳就立即硬刪檔）、批次上傳、影片 metadata、縮圖／大圖／poster 衍生檔路由、版位裁切焦點（0–100）。
- 首屏影片／關於照片／孩子的一天照片與影片／分校封面與線稿／手機版活動影片等素材版位已接進 CMS（選填，未設定時官網用內建素材）。
- 樂觀鎖（`expected_version`）涵蓋時段、案件承辦人與下次聯絡時間、每週規則、全站設定、素材說明；統一錯誤碼（`X-Request-ID`、`SLOT_CLOSED`／`SLOT_NOT_FOUND`／`MEDIA_NOT_READY` 等）。
- 端到端測試（`tests/stack/`）、無障礙（axe）與鍵盤操作自動化檢查、像素回歸，CI 新增 `e2e` job（不擋部署）。
- `web/` 標題字型已換上完整 LINE Seed TW（見 `web/public/assets/fonts/README.md`），CMS 開放編輯標題不再受子集缺字限制。

仍待辦（需使用者或業主處理，詳見 acceptance.md 小結的 followups）：簡訊驗證（付費）、正式庫與媒體備份／PITR、斷開 Railway 原生部署、正式站執行 `initialize-content`、SMTP／Google／LINE／S3 正式環境變數、四校正式內容（園方提供）、錯誤格式 envelope 是否要做破壞性變更（待業主裁定）。
