# Railway 官網部署

此專案與園務系統完全分離，使用獨立 PostgreSQL。

- Railway project：`d606df61-445a-4e65-9c5f-7e94a0766572`（ivy-website-admin）
- environment：`cf5631c7-05b9-4f16-9358-c81d2650eb55`（production）
- web：`e0851ec5-3bc0-4b5c-9471-9d9131616c26`，`deploy/web.Dockerfile`
- api：`9124b9c0-4ddf-4445-bd2f-798b277f44ec`，`deploy/api.Dockerfile`
- 官網：<https://web-production-04caa.up.railway.app/>
- 後台：<https://web-production-04caa.up.railway.app/admin/>

## 組成

web 以 Node 22 建置 Nuxt SSR 及 Vue admin，後台放在同源 `/admin/`，深層路由回傳後台入口，遺失的後台 assets 維持 404。`VITE_WEBSITE_ASSET_BASE` 在 build 時設為空字串，素材使用同源路徑。web 程序使用 `node` 非 root 使用者。

api 使用 Python 3.12、lockfile 依賴及 FastAPI 0.136.1。`/data` 掛 Railway volume，素材固定 `/data/media`；啟動程式確認掛載、設定素材目錄權限，降為 UID/GID 10001 並設定該帳號的家目錄後測試讀寫，再啟動 API。API 無公開 domain，由 web 的同源代理透過 Railway 私有網路連線。

## 環境變數

所有秘密只存 Railway Variables，不寫入 repo。API 的 `WEBSITE_DATABASE_URL` 使用新建 Postgres 服務的變數參照，以 `postgresql+asyncpg://` 開頭。

| 服務 | 設定 |
| --- | --- |
| web | `PORT=3000`、`NUXT_WEBSITE_ENV=production`、`NUXT_PUBLIC_CONTENT_MODE=live` |
| web | `NUXT_WEBSITE_API_INTERNAL_BASE=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8000` |
| web | `NUXT_PUBLIC_SITE_ORIGIN=https://web-production-04caa.up.railway.app`、`NUXT_PUBLIC_INDEXING_ENABLED=false` |
| api | `PORT=8000`、`WEBSITE_ENVIRONMENT=production`、`WEBSITE_ENABLE_FIXTURE=false`、`WEBSITE_INDEXING_ENABLED=false` |
| api | `WEBSITE_SESSION_SECRET`（隨機產生的秘密）與 `WEBSITE_DATABASE_URL`（Postgres 參照） |
| api | `WEBSITE_ADMIN_ORIGIN=https://web-production-04caa.up.railway.app` |
| api | `RAILWAY_RUN_UID=0`（僅供啟動準備）、`WEBSITE_MEDIA_ROOT=/data/media` |

## 初次初始化

下列指令會寫資料庫，僅對已明確核准的新官網資料庫執行。部署本身不會自動執行 migration；後續 schema 更新也需另行確認。

```sh
railway ssh --service api --environment production -- python -m alembic upgrade head
railway ssh --service api --environment production -- python -m app.cli seed --dry-run
railway ssh --service api --environment production -- python -m app.cli initialize-content /app/content/site-fixture.json
railway ssh --service api --environment production -- python -m app.cli bootstrap-admin
```

`initialize-content` 驗證所有 payload 後，僅補 `latest_version=0` 的空白項目。重跑不覆蓋既有草稿、不多建版本。現行來源共初始化 18 筆：7 種共用內容、五校介紹、五校 FAQ、義華巡覽；其他四校巡覽仍保留待補狀態。來源文案原樣保留，包含尚未改成正式用語的原型說明。

初始五校預約維持 `paused`，搜尋索引關閉。既有通知 adapter 僅供本機測試，未部署寄信 worker；正式寄信需另外接上 provider。

## 更新部署

先跑 web 型別／測試／build、admin build／測試及本次修改相關 backend 測試。上傳範圍只包含 `web/ admin/ backend/ content/ contracts/ deploy/ .dockerignore`，排除 `.env*`、本機依賴、快取與 `backend/var/`。不要把本機資料庫、素材或帳密交付檔上傳。

```sh
railway up <已檢查的程式快照目錄> --path-as-root --project d606df61-445a-4e65-9c5f-7e94a0766572 --environment production --service api --detach
railway up <同一份快照目錄> --path-as-root --project d606df61-445a-4e65-9c5f-7e94a0766572 --environment production --service web --detach
```

CLI 上傳部署包含工作目錄變更，不等於 Git commit 部署；記錄快照 SHA-256，並在快照內產生 `web/public/release.json` 供線上版本驗證。上線後需確認 Railway SUCCESS、API live health、CMS release、五校 SSR、後台登入及素材持久磁碟，而非僅看 build 成功。

## 2026-09-21 首次部署紀錄

- web deployment：`fee260ee-b768-48c7-9923-a65e1bb14f6a`，SUCCESS。
- API deployment：`7722aa78-e1c6-4a79-a3cb-74d1ce53ad31`，SUCCESS。
- 基底 commit：`5bc67b1d0fccefa42f32f2372010d77b1c1bfd03`，包含當時工作目錄的未提交修改。
- web snapshot：`65a0989c1535fe9a8568c2e65243cf2e30293a156946ff60992d742d5e4e1c69`，可由 `/release.json` 核對。
- API snapshot：`121ed579fbf2bb0951d1d1aa73eff2de4fb51753d2c179a0810cdeb94e50cc61`，額外修正降權後的家目錄。
- Migration head：`ce3082c9bf69`。五校 dry-run 確認齊全，CMS 初始化 18 筆；初始管理者已建立，帳密未納入 Git 或部署快照。
- 本機檢查：web typecheck／38 tests／build、admin 乾淨 npm ci／7 tests／build、backend 初始化及內容發布 20 tests 通過。
- 線上 33 項檢查：HTTPS、部署版本、production/live health、CMS release、五校 SSR、404、索引關閉、五校 paused、後台直接路由／assets、登入／Secure HttpOnly cookie、已登入內容讀取、上傳／讀取／刪除測試圖片、登出失效。
- API 實際程序 UID/GID 為 10001；volume 媒體目錄 owner/group 10001、mode 750。
- 官網桌機及 390px 手機、後台登入及內容編輯頁經 Chrome 驗證，未發現 JavaScript runtime error，手機無水平溢出。
- 部署過程有其他工作修改本機來源；較晚的變更未併入本次固定快照，差異清單在 `output/railway-worktree-drift.txt`。未 commit、未 push。

## 2026-09-21 第二次部署紀錄

- web deployment：`02bd8339-d5ae-4c26-87c6-8ddfa6d15f5a`，SUCCESS。
- API deployment：`f8b105cf-2431-4041-8f00-90c70e15613f`，SUCCESS。
- 基底 commit：`dc87b16747bb971beb3ece3fc9b14f509fd92f96`。工作目錄乾淨，快照以 `git archive HEAD` 取 `web/ admin/ backend/ content/ contracts/ deploy/ .dockerignore` 產生，沒有未提交差異。
- 快照 SHA-256：`cd3630f6b6b22142a26fbcbbab1b1985a98dd1e6627f5e51f39c926262681e95`，web 與 api 上傳同一份，可由 `/release.json` 核對。雜湊算法為快照內所有檔案（不含後寫入的 `web/public/release.json`）依路徑排序後的 `shasum -a 256` 清單再取一次 SHA-256。
- Migration head 仍為 `ce3082c9bf69`，本次未跑 alembic、未執行 `initialize-content` 或 `bootstrap-admin`。
- 本機檢查：Node 22.23.2 下 web typecheck／57 tests／build、admin 16 tests／build 通過；backend `.venv`（Python 3.12）122 tests 通過。
- 線上 33 項檢查沿用首次部署清單，全數通過：`output/railway-smoke.json`（首次部署結果備份為 `output/railway-smoke-20260921-first.json`）。
- 瀏覽器驗證：桌機 1440 與手機 390px 首頁 200、無水平溢出，後台登入與內容編輯頁正常，0 個 runtime error，截圖 `output/playwright/railway2-*.png`。
- 未 commit、未 push；預約仍 paused，索引與寄信未啟用。

## 2026-09-22 第三次部署紀錄

- 僅更新 web：`deb1076d-e531-45bc-924a-928601a815d8`，SUCCESS。API 仍為 `f8b105cf-2431-4041-8f00-90c70e15613f`，Postgres 仍為 `be22e502-02ad-41b3-8559-0ce90ae03043`。
- 基底 commit：`dc87b16747bb971beb3ece3fc9b14f509fd92f96`，包含已驗證的未提交前台修改。部署圓角輪播、四秒切校／社群 icon、手機動效效能、A 拍立得折角、E 消息紙頁、A 頁尾霧藍漸退與校徽 favicon。backend／admin／content／contracts 相較 HEAD 無變更。
- 固定快照：`/private/tmp/ivy-website-release-20260922-100936`。從 `git ls-files --cached --others --exclude-standard` 取允許範圍內仍存在的檔案，排除 `.env*`、依賴、快取、`var`、日誌與舊 release；347 個檔案，共 31,968,069 bytes，不含後寫入的 release。建置及上傳前後比對來源，無程式差異。
- 快照 SHA-256：`1c000aaf0b655cc233100688f642312f1c44295537fe6af5dcabf0a5568ebaad`，`/release.json` 已線上核對。雜湊算法沿用第二次：排序路徑的 `sha256  ./path` 清單再取 SHA-256。逐檔清單、建置紀錄及結果在 `output/railway-deploy-20260922/`。
- 本機檢查：Node 22.23.2 下 web typecheck／72 tests／production-live build、admin 16 tests／build 通過。既有 Hero CSS 巢狀 calc／clamp 與大型 chunk 警告仍在；backend 無變更，未重跑 backend tests。
- 線上 33 項 smoke 通過：版本、production API、CMS release、五校 SSR、404、robots、五校 paused、admin 深層路由／assets、登入／Secure HttpOnly cookie、內容讀取、測試素材上傳／讀取／刪除、登出失效。`output/railway-deploy-20260922/smoke.py` 使用本次 hash，結果為同目錄 `smoke.json`；舊 smoke 腳本與結果保留。
- Chrome 1440／390px 共 40 筆瀏覽器檢查通過：兩種尺寸五校圓角／社群 icon／預約入口、原生正反向轉場、JS 備援、手機觸控／高度穩定、減少動態／強制色彩、拍立得翻面、頁面往返、三個圖示逐檔 hash、後台登入／編輯頁／登出；零 runtime error、無水平溢出。紀錄與截圖在 `output/playwright/railway-20260922/`。Safari／Firefox／iOS 實機未驗證。
- 未執行 migration、CMS 發布／初始化或管理員初始化；未 commit／push。首頁 CTA 常駐，實際預約維持 paused，索引與寄信未啟用。驗證用 64×64 圖片已刪除、驗證 session 已登出。

## 2026-09-22 頁首膠囊 8px 部署

- 程式 commit：`bb20ce11638de172444c5787440bc381ff076450`，僅提交內距 4px→8px 與相關 README／DESIGN 段落，保留其他未提交設計工作。
- web deployment：`d899f96e-d7a3-49e6-ac57-77f32de61932`，SUCCESS。API／Postgres deployment 維持原版。
- 固定快照：`/private/tmp/ivy-website-header-padding-20260922-102336`。以前次線上 `1c000aaf…` 的 347 檔 manifest 為基底，只替換 `web/app/assets/css/studio.css` 的 `--pill-pad`；既有已部署設計完整保留。此快照包含前次線上的未提交內容，並非只由本次 Git HEAD 產生。
- Snapshot SHA-256：`4b302127e63f3282d81ca7acd235a51b5475a367cacebe0097a8b9cac079c6c1`；線上 `/release.json` 已核對，建置前後來源逐檔 hash 一致，上傳不含依賴、建置產物、環境檔或憑證。
- Node 22.23.2：web typecheck、72 項測試及 production/live build；admin 16 項測試及 build 均通過。保留既有 Hero calc／clamp 與大型 chunk 警告。
- 線上 HTTP smoke 33 項通過，涵蓋 production/live API、CMS、五校 SSR、後台登入與測試素材上傳／讀取／刪除及登出。Chrome 1440／900／390／320px 均量到 8px，桌機高 58px、手機高 62px，選單開啟／Escape 關閉與預約連結正常，無水平溢出或 runtime error。
- 證據：`output/railway-header-padding-20260922/` 的 manifest、建置 logs、smoke.json、browser.json、railway-status.json 與線上截圖。Browser 腳本已等待選單關閉計時器更新 aria-expanded；初次立即斷言造成時序失敗，未修改產品程式。
- 未 push、未執行 migration、CMS 初始化或發布；五校預約維持 paused、索引與寄信未啟用。Safari／Firefox／iOS 實機未驗證。
