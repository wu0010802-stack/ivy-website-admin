# 官網後台：本機啟動與測試命令（階段 A）

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
uv run python -m app.cli content-seed-from-fixture ../content/site-fixture.json
  # 一次性：把 fixture 現有「關於常春藤」文案灌成第一筆已發布內容
```

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
npm run test:website   # 轉呼叫 web 的 Vitest
npm run test:e2e       # Playwright，四視口設定見 playwright.config.ts
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
- 素材上傳／驗證／引用保護／替換（Task 4，admin 尚無素材庫 UI，只有 API）
- 首頁「關於常春藤」文字草稿／發布，Nuxt 讀取已發布內容（Task 5，範圍縮小到單一內容項，見 `docs/website-admin/acceptance.md` 階段 B 小結）

## 尚未涵蓋

其餘 10 種內容欄位的 editor、素材庫 UI、六種預約模式、通知 worker、統計與備份還原，均屬階段 C–D，本文件屆時會補上對應命令。
