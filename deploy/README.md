# Railway 官網部署

此專案與園務系統完全分離，使用獨立 PostgreSQL。

GitHub Actions 的 `production` 分支 CI/CD 設定與啟用步驟見 [CICD.md](./CICD.md)。設定發布並完成 environment secret 後才會生效；下方保留手動部署與歷次快照紀錄。

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
| api | `WEBSITE_TRUSTED_CLIENT_IP_HEADER=x-website-client-ip`（預設值，見下方「公開端點限流」） |

### 公開端點限流與訪客 IP（2026-09-22）

公開 API 一律經 web 的同源代理透過私有網路連進 api，所以 api 看到的
`request.client.host` 恆為代理的位址。限流若直接綁這個值，全站訪客會共用
同一個桶，正常流量就會互相擠掉（analytics 的 CTA 點擊原本就是這樣被靜默
丟棄的）。

api 改成優先採信 `WEBSITE_TRUSTED_CLIENT_IP_HEADER` 指定的 header，
`web/server/routes/api/website/v1/[...].ts` 則用
`getRequestIP(event, { xForwardedFor: true })` 把訪客 IP 放進去，並**顯式
覆寫**該 header（不覆寫的話任何人都能自己帶一個來偽造訪客身分）。

限流另外刻意設計成不會因為這層設定失準就誤傷正常流量：

- 公開送單以「校區＋手機號碼」為主要限流鍵（10 分鐘 5 次），完全不依賴
  代理設定；來源桶放寬到 10 分鐘 60 次，只擋單一來源換號碼狂灌。
- 後台登入的帳號桶只在密碼錯誤時累計，且正確密碼一律放行，任何人都無法
  用連續錯誤密碼把管理者鎖在門外；來源桶 5 分鐘 100 次。

**這個 header 只有在 api 不直接對外時才可信任**（目前 api 無公開 domain，
符合此前提）。若日後把 api 直接暴露到公網，必須先拿掉這個設定或改成解析
可信任的 `X-Forwarded-For` 尾段，否則任何人都能偽造訪客 IP 繞過限流。

### 通知 worker 與逾期占位（2026-09-22）

`python -m app.cli process-notifications` 現在會**先**釋放逾期的時段占位
（規格 222：人工待確認的 slot 案件占位 24 小時，到期轉 cancelled、記
`hold_expired`、釋放名額並通知園方），再處理 outbox。這個指令需要由排程
定期呼叫；沒有排程的話逾期占位不會自動釋放，名額會一直被佔住。

## 初次初始化

下列指令會寫資料庫，僅對已明確核准的新官網資料庫執行。部署本身不會自動執行 migration；後續 schema 更新也需另行確認。

```sh
railway ssh --service api --environment production -- python -m alembic upgrade head
# 2026-09-22 起 head 為 a1c4f7e92b30（email 不分大小寫唯一索引、共用內容
# partial unique、slots 人工確認占位欄位、通知去重表）。這支 migration 會
# 把既有大小寫重複的 email 帳號停權並改名封存，執行前先確認影響範圍。
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

## 2026-09-22 最新版分校控制器部署

- 程式 commit：`9a0150ef57f1d406a02817f4a3af89f96d872c51`，部署前工作目錄乾淨。與前次線上快照逐檔比對，產品差異只有 `web/app/components/CampusBoard.vue`：控制器首次可見時的水滴進場、邊框出現時機，以及滑鼠停留時繼續自動輪播。
- 僅更新 web，deployment：`8c6de5c1-c82e-4b9e-a2c5-8ba328cff1f4`，SUCCESS。API 仍為 `f8b105cf-2431-4041-8f00-90c70e15613f`，Postgres 仍為 `be22e502-02ad-41b3-8559-0ce90ae03043`，皆已即時核對。
- 固定快照：`/private/tmp/ivy-website-latest-20260922-111514`。以 `git archive HEAD` 取部署允許的七個路徑，排除 `backend/.env.example`；347 個檔案、31,978,018 bytes，不含後寫入的 release。上傳前後逐檔雜湊一致。
- Snapshot SHA-256：`2dd78d5c2761774e5fcd30125e73a5c0cb4769c3cae6d10eb7e858794c3ff329`；線上 `/release.json` 已核對。雜湊算法沿用排序路徑的 `sha256  ./path` 清單再取 SHA-256。
- Node 22.23.2：web typecheck、72 項測試及 production/live build；admin 16 項測試及 build 均通過。既有 Hero calc／clamp 與大型 chunk 建置警告仍在；backend 無程式差異，未重跑 backend tests。
- 線上 HTTP smoke 33 項通過：版本、production API、CMS release、五校 SSR、索引關閉、五校 paused、後台路由／assets、登入／Secure HttpOnly cookie、內容讀取、測試素材上傳／讀取／刪除、登出失效。測試圖片已刪除，驗證 session 已登出。
- Chrome 共 56 筆瀏覽器檢查通過：既有前台／後台回歸 40 筆、水滴進場 6 筆、自動輪播 10 筆。涵蓋 1440／390／320px 首次進場只播一次、回捲不重播、減少動態／強制色彩、鍵盤聚焦、自動切校、hover 持續播放、手動暫停／恢復、離屏暫停與手機觸控；零 runtime error、無水平溢出。已檢視桌機／手機分校截圖；Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-latest-20260922-111514/` 的 manifest、建置 logs、smoke.json、Railway status；`output/playwright/railway-latest-20260922-111514/` 的驗證結果及截圖。
- 未執行 migration、CMS 初始化／發布或管理員初始化；五校預約維持 paused、索引與寄信未啟用。本次未 commit／push，僅補本部署紀錄。

## 2026-09-22 分校 B 置中標題與明體校名部署

- 僅更新 web，deployment：`80d4dfd3-3944-434e-beda-c89cf65cd3ac`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 均維持原部署，已即時核對。
- 以前次線上 commit `9a0150ef57f1d406a02817f4a3af89f96d872c51` 的允許路徑 `git archive` 為基底，先確認 347 檔與前次線上 manifest 完全一致，再僅疊入本次五個檔案：`CampusBoard.vue`、字型 README、Noto Serif TC WOFF／OFL／來源 JSON。工作區另有未提交消息卡 hover 配色修改及 mock-up，未納入本次快照。
- 固定快照：`/private/tmp/ivy-website-campus-b-20260922-115106`，350 個原始檔、31,990,117 bytes，不含後寫的 release。SHA-256：`7ef5e0d81c4f39e996e4fec6c1ca3354f77eac39f49449129311505b5b5b78c1`；線上 `/release.json` 與字型檔 SHA-256 已逐一核對，上傳前後來源 manifest 完全一致。
- 在獨立 `-build` 副本使用 Node 22.23.2 驗證，依賴連結本機既有 node_modules，正式上傳快照不含依賴／建置產物／環境檔。web typecheck、72 項測試、production/live build，admin 16 項測試及 build 全數通過；沿用既有 Hero calc／clamp 與大型 chunk 建置警告。Railway Docker 建置依 lockfile 執行 npm ci。backend 無程式差異，未重跑 backend tests。
- 線上 HTTP smoke 31 項通過：版本、字型、production API、CMS release、五校 SSR、404、robots、五校 paused、後台路由／assets、登入／Secure HttpOnly cookie／內容讀取／登出失效。未執行素材上傳／刪除；驗證 session 已登出。
- Chrome 320／390／768／1024／1440／1920px × 五校，以及鍵盤、照片與預約連結，共 32 筆驗證通過；標題與選校列置中、無數字、大校名字體正確、無水平溢出或 runtime error，已檢視線上桌機／手機截圖。Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-campus-b-20260922-115106/` 的 manifest、build-results／logs、upload、services-status、smoke；`output/playwright/railway-campus-b-20260922-115106/` 的 checks 與截圖。
- 未執行 migration、CMS 初始化／發布、管理員初始化、commit 或 push；原有五校預約 paused、索引及寄信設定維持。

## 2026-09-22 分校控制器首次捲至照片下方才進場

- 僅更新 web，deployment：`eec927c9-839d-48cd-b703-7151db30485f`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以線上分校 B 快照 `7ef5e0d8…` 的 350 個原始檔為基底，逐檔核對後只替換 `web/app/components/CampusBoard.vue`：改觀察照片下方控制區的自然位置，首次至少 80% 可見才彈出，回捲不重播。其他進行中的 Hero、活動卡、頁尾及線稿 mock-up 修改未納入。
- 固定快照：`/private/tmp/ivy-website-control-trigger-20260922-131503`；350 檔、31,990,562 bytes，不含後寫入的 release。SHA-256：`40e85c5125610a6e3b4c6bd2ee2804e7f2d1d4b2e27af0296bda6837ad2a3098`；雜湊沿用前次 manifest 的路徑順序與 `sha256  ./path` 格式。上傳前後逐檔一致，線上 `/release.json` 已核對。
- 獨立 `-build` 副本以 Node 22.23.2 執行 web typecheck、72 項單元測試、admin 16 項單元測試及前後台正式建置，全數通過。保留既有 Hero calc／clamp 與大型 chunk 建置警告。backend 無程式差異，未重跑 backend tests。
- 正式站 31 項 smoke 通過：版本與字型、production/live API、CMS、五校 SSR、404、robots、預約 paused、後台路由／assets、登入／Secure HttpOnly cookie／內容讀取及登出失效。驗證 session 已登出，沒有素材寫入。
- Chrome 1440／390／320px 的首次進場、回捲不重播、暫停／繼續、切校及無水平溢出三組檢查完成；進入偏好模式測試時遇一次 30 秒導航逾時，僅補跑減少動態／高對比／鍵盤三組並通過。已檢視線上桌機、手機自然位置截圖。Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-control-trigger-20260922-131503/` 的 manifest、build-results／logs、upload、services-status、smoke；`output/playwright/railway-control-trigger-20260922-131503/` 的桌機／手機截圖及 preferences.json。
- 未執行 migration、CMS 初始化／發布、管理員初始化、commit 或 push；五校預約 paused、索引及寄信設定維持。

## 2026-09-22 後台 UI／UX 部署

- 僅更新 web，deployment：`1e3b1147-edc6-487c-a144-6b3a6bdb9515`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以前次線上 `40e85c51…` 快照的 350 個原始檔為基底，逐檔驗證後只疊入本輪 `admin/` 的 22 檔差異：手機清單、篩選與重試、未儲存／版本衝突保護、批次通知與操作互斥、觸控探索圖釘及回歸測試。官網沿用線上版本，工作區其他設計修改不在此快照。
- 固定快照：`/private/tmp/ivy-website-admin-uiux-20260922-133447`，357 個原始檔、32,033,918 bytes，不含後寫的 release。SHA-256：`1a5f8456d13197a0c3a00610164face7ae46400ddbf0cf1ce4a7cc1698b14e5a`；按路徑排序的 `sha256  ./path` 清單再取 SHA-256。上傳前後 source hash 一致，線上 `/release.json` 已核對。
- 獨立 `-build` 副本以 Node 22.23.2 執行 web typecheck、72 項 web 測試、27 項 admin 測試，以及 admin／production-live web 建置，全數通過。既有 Hero calc／clamp 與大型 chunk 警告維持；backend 無程式差異，未重跑 backend 測試。
- 正式站 39 項 HTTP smoke 全過：版本、字型、production/live API、CMS、五校 SSR、robots／404、五校 paused、後台路由／assets、真實登入／Secure HttpOnly cookie、8 組管理資料唯讀讀取及登出失效。
- Chrome 32 項驗證全過：8 個後台頁面 × 1440／390／320px、登入、未儲存取消與放棄、兩種手機尺寸導覽、admin JS／CSS 與本機正式建置逐檔 SHA-256 相同及登出。0 runtime error、無水平溢出、0 業務寫入；已檢視正式站桌機／手機截圖。此輪沒有寫入合成業務資料；Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-admin-uiux-20260922-133447/` 的 manifest、build-results／logs、upload、services-status、smoke.json、browser.json 與線上截圖。Python 3.14 系統 CA 驗證曾失敗，改以正常 TLS 驗證的 curl 核對當時線上基底仍未變；未停用 TLS 驗證。
- 未執行 migration、CMS 初始化／發布、帳號或素材異動、commit 或 push。驗證 session 已登出；既有 paused／索引及寄信設定維持。

## 2026-09-22 五校校園修復圖部署

- 僅更新 web，deployment：`2f074707-e2a7-47c2-99fc-005d1bc47c52`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以當時線上後台 UI／UX 快照 `1a5f8456…` 的 357 個原始檔為基底，逐檔驗證後疊入本次 23 檔：五張確認的修復版 WebP、15 張響應式衍生圖、image manifest、五校 `image` 設定與內頁「校園圖像」圖說。沿用線上既有前台版面與後台；其他進行中的設計／backend 修改未納入。
- 固定快照：`/private/tmp/ivy-website-campus-photos-20260922-134539`；377 個原始檔、35,899,600 bytes，不含後寫的 release。SHA-256：`45467a20ebd86b008aebbd4cc2e2e36ac315795cedc1f678e64ffb0fc2e3095c`。雜湊為按路徑排序的 `sha256  ./path` 清單再取 SHA-256；上傳前後來源一致，線上 `/release.json` 已核對。
- 獨立 `-build` 副本以 Node 22.23.2 執行 web typecheck、72 項 web 測試、27 項 admin 測試，以及 admin／production-live web 正式建置，全數通過。保留既有 Hero calc／clamp 與大型 chunk 警告；backend 無程式差異，未重跑 backend tests。
- 線上 HTTP smoke 64 項通過：部署版本、20 張新版圖片 SHA-256、五校 SSR／分享圖／preload、production/live API、CMS、字型、robots／404、五校 paused、後台路由／assets、真實登入／Secure HttpOnly cookie、管理資料唯讀查詢與登出失效。未寫入業務資料或上傳／刪除素材。
- Chrome 320／390／1440／1920px 的五校首頁輪播，加上 1440／390px 的五校內頁，共 30 組圖片與版面檢查通過；驗證 srcset 選圖、裁切、鍵盤切校、對應連結，無水平溢出及 runtime error。已檢視正式站桌機／手機截圖；Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-campus-photos-20260922-134539/` 的 summary／manifest、build-results／logs、upload、services-status、source-verification、smoke.json、checks.json 與 20 張線上截圖。快照準備程式為 `output/prepare-campus-photo-deploy.py`。
- 未執行 migration、CMS 初始化／發布、帳號異動、commit 或 push；驗證 session 已登出，預約 paused／索引及寄信設定維持。

## 2026-09-22 首頁字體分工部署

- 僅更新 web，deployment：`8eb936b3-343a-4e0e-9d00-886ddd0fa607`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持既有部署，已即時核對。
- 以當時線上校園圖片快照 `45467a20…` 的 377 檔為基底，逐檔驗證後只新增 `web/app/assets/css/typography.css`，並在基底 `web/nuxt.config.ts` 的 CSS 清單註冊。工作區其他設計、預約、後台及 API 變更未納入。
- 固定快照：`/private/tmp/ivy-website-typography-20260922-141925`；378 檔、35,902,319 bytes，不含後寫的 release。SHA-256：`ebad700792a6e5c5aac90ba3500d8b6a8ec923af8ee2b05fa9aa737b727868d9`。上傳前後逐檔核對一致；上傳前再次確認線上基底未變。
- 獨立 `-build` 副本使用 Node 22.23.2：web typecheck、72 項 web 測試、27 項 admin 測試、admin／production-live web 建置通過。首次 web build 遇本機 ENOSPC；確認磁碟可用空間恢復後，僅重跑該步並成功。未刪除使用者檔案。既有 Hero calc／clamp 與大型 chunk 警告維持。
- 正式站 47 項 HTTP 檢查通過：release、字型、CSS 與本機正式建置 SHA-256 相同、production/live API、CMS、五校 SSR／校園圖片、robots／404、預約 paused、後台路由與 assets、登入／Secure HttpOnly cookie／管理資料唯讀查詢及登出失效。
- Playwright Chrome 六尺寸（320／390／768／1024／1440／1920px）的字級、字重、字型及水平溢出，加上桌機／手機消息清單／詳情、Escape、焦點返回及正常捲動模式共 10 組檢查通過；0 runtime／console error。已檢視線上桌機理念與手機消息截圖。Safari／Firefox／iOS 實機未驗證；先前記錄的 320px＋200% 文字放大既有頁首限制仍留待獨立處理。
- 證據：`output/railway-typography-20260922-141925/` 的 manifest、build-results／logs、upload、services-status、source-verification、smoke.json；`output/playwright/railway-typography-20260922-141925/` 的 checks 與截圖。準備腳本：`output/prepare-typography-deploy.py`。
- 未執行 migration、CMS 初始化／發布、素材或帳號異動、commit 或 push。驗證登入 session 已登出。


## 2026-09-22 活動卡片 A「蜜糖日光」部署

- 僅更新 web，deployment：`cd51dbeb-4f59-4e76-91bc-5d5a392fb7c9`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持既有部署，已即時核對。
- 以最新已上線 Hero 修復影片快照 `f3a85bc5e8f7324835f08544bde09bb421d1f2d291cd7c78c00b31bd1e19f542`（Hero deployment `1812fc8a-c8f4-4a3e-aed6-15ecfa08f14c`）為基底，逐檔驗證後只套用 commit `8adf2a1270bd85a0bdbc86f7606be7372b360a8f` 的 `web/app/assets/css/studio.css` 差異。保留現行 Hero、字體、校園圖片、後台，工作區其他設計／預約／API 修改未納入。
- 固定快照：`/private/tmp/ivy-website-event-hover-a-20260922-143225`；383 檔、45,703,472 bytes，不含後寫入的 release。SHA-256：`0d8237902391866c562747b53bda8e6833cc73e816d54959f4f871a1d826f162`。上傳前後及部署後逐檔 hash 一致，線上 `/release.json` 已核對；上傳前確認 production 基底未變且無其他進行中部署。
- 獨立 `-build` 副本以 Node 22.23.2 執行 web typecheck、72 項 web 測試、27 項 admin 測試、admin／production-live web build，全數通過。保留既有 Hero calc／clamp 與大型 chunk 警告；backend 無差異，未重跑 backend tests。
- 正式站 48 項 HTTP smoke 全過：release、A 三色 token、正式 CSS 與本機建置 hash、字型、production/live API、CMS、五校 SSR／照片、robots／404、預約 paused、後台路由／assets、登入／Secure HttpOnly cookie、管理資料唯讀查詢及登出失效。驗證 session 已登出，沒有業務或素材寫入。
- Chrome 1440px 桌機與 390／320px 手機共 8 組互動檢查通過：三張卡片向下填色／移出還原、快速反向、文字及版面不動、活動詳情與 Escape／焦點還原、鍵盤、減少動態、高對比與觸控。逐卡中間幀及完成幀像素均對上 A 色碼，無水平溢出或 runtime error；已檢視線上桌機／手機截圖。Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-event-hover-a-20260922-143225/` 的 manifest、approved.patch、build-results／logs、upload、services-status、source-verification、smoke.json 與 browser/ 截圖／verification.json；準備程式為 `output/prepare-event-hover-deploy.py`。
- 未執行 migration、CMS 初始化／發布、素材或帳號異動；本輪未新增 commit 或 push。五校預約 paused、索引與寄信設定維持。


## 2026-09-22 Hero 清晰修復影片部署

- Hero web deployment：`1812fc8a-c8f4-4a3e-aed6-15ecfa08f14c`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以最新線上字體快照 `ebad7007…` 的 378 檔為基底，逐檔驗證後疊入 10 個 Hero 相關檔案：母檔、桌機／手機已確認的 MP4、封面及兩種 responsive 衍生圖、影片／圖片 manifest、Hero 圖片設定與來源紀錄。其他進行中的預約、選單、後台及 API 變更未納入。
- 固定快照：`/private/tmp/ivy-website-hero-restored-20260922-142744`；383 檔、45,702,356 bytes，不含後寫的 release。SHA-256：`f3a85bc5e8f7324835f08544bde09bb421d1f2d291cd7c78c00b31bd1e19f542`。上傳前後逐檔核對一致，部署前再次確認線上基底未變。
- 影片皆為 11.7 秒、30fps、無音軌；桌機 1080×800／4,167,704 bytes，手機 720×534／2,054,696 bytes。直接複製確認的輸出並以內容雜湊命名，避免再次壓縮；新版封面使用新檔名。保留播放控制、離屏暫停與減少動態／省流量／慢速連線的靜態封面。
- Node 22.23.2：web typecheck、72 項 web 測試、27 項 admin 測試、admin／production-live web 建置全過；既有 Hero calc／clamp 與大型 chunk 警告維持。準備建置副本時遇 ENOSPC，僅刪除本輪可重建的 FFV1 暫存中間檔後完成，未刪使用者原檔。
- 正式站 56 項 HTTP 檢查通過：release、7 個 Hero 素材 SHA-256、SSR 新版封面、影片 MIME／immutable 快取、production/live API、CMS、五校圖片／SSR、robots／404、五校 paused、後台路由與 assets、登入／Secure HttpOnly cookie／管理資料唯讀查詢及登出失效。既有與新版影片的 Range 請求皆回完整 HTTP 200，已核對完整檔案內容；沒有宣稱支援 206 部分回應。
- Chrome 1440／390／320px 的實際選檔與封面、桌機／手機完整循環、暫停／恢復、離屏暫停、reduced-motion／save-data／3g／無 JS 封面，共 15 組檢查通過；本機隔離建置另通過同 15 組。0 runtime error、無水平溢出，已檢視線上桌機／手機截圖。Safari／Firefox／iOS 實機未驗證。
- 驗證期間另有活動卡 deployment `cd51dbeb-4f59-4e76-91bc-5d5a392fb7c9` 上線（SUCCESS），其基底為本次 Hero 快照。最新 release `0d8237902391866c562747b53bda8e6833cc73e816d54959f4f871a1d826f162` 已逐檔確認保留全部 10 個 Hero 更新與字體；最終 56 項 HTTP 驗證以此最新版本為準，未重新覆蓋活動卡部署。
- 證據：`output/railway-hero-restored-20260922-142744/` 的 manifest、build-results／logs、upload、services-status、source-verification、subsequent-release-verification、smoke.json、local／online-browser.json 與截圖。準備腳本：`output/prepare-hero-video-deploy.py`；素材與重製脚本：`design/hero-video-restoration-20260922/`。
- 本輪未執行 migration、CMS 初始化／發布、帳號或素材庫異動、commit 或 push；驗證 session 已登出，預約 paused／索引及寄信設定維持。


## 2026-09-22 頁尾 A「深森林綠」部署

- 僅更新 web，deployment：`2b928a25-1865-47ee-90a1-dfbee3b9dc53`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以最新活動卡 A／Hero 線上快照 `0d8237902391866c562747b53bda8e6833cc73e816d54959f4f871a1d826f162` 的 383 檔為基底，逐檔驗證後只替換 `web/app/components/SiteFooter.vue`，採用深綠／米白／暖金配色及已確認的精簡底列。其他進行中的選單、預約、照片文字、API／後台修改均未納入。
- 固定快照：`/private/tmp/ivy-website-footer-a-20260922-150539`，383 檔、45,704,088 bytes，不含後寫入的 release。SHA-256：`87efef1ebe8118ace30cc39a54fac7907b65a815bfee91f3af357106129d7c3f`。上傳前後及部署後來源 hash 完全一致，線上 `/release.json` 已核對；上傳前確認 production 基底未變且無其他進行中的部署。
- 獨立 `-build` 副本使用 Node 22.23.2：web typecheck、72 項 web tests、27 項 admin tests、admin／production-live web build 全數通過。保留既有 Hero calc／clamp 與大型 chunk 建置警告。backend 無程式差異，未重跑 backend tests。
- 正式站 39 項公開 GET-only HTTP 檢查通過：release、A 頁尾與字體 CSS 的 production SHA-256、已確認色票與精簡底列、production/live API、CMS、五校 SSR／圖片、robots／404、五校 paused、後台公開路由／靜態 assets 與匿名 401。
- Chromium 九組首頁／分校／預約頁、320–1920px 檢查通過：頁尾色碼、全域暖白不變、消息暖白覆色完成、連結 44px 觸控高度、hover／鍵盤焦點、強制色彩與減少動態。無水平溢出、runtime error 或 console warning；已檢視正式桌機／手機截圖。Safari／Firefox／iOS 實機未驗證。
- 原定登入後台與讀取私有管理資料的 smoke 被自動核准審查拒絕，原因是部署指令未授權正式帳密使用與私有資料存取。未執行該腳本，改用不讀帳密、不登入、僅公開 GET 的 `smoke-public.py`；後台登入／私有資料驗證尚未執行。
- 證據：`output/railway-footer-a-20260922-150539/` 的 manifest、approved.patch、build-results／logs、upload、services-status、source-verification、smoke-public.json、final-verification.json 及 browser/。準備腳本 `output/prepare-footer-colour-deploy.py`。
- 未執行 migration、CMS 初始化／發布、素材或帳號異動、commit 或 push；原有 paused、索引與寄信設定維持。

## 2026-09-22 移除常春藤的一天照片補充字部署

- 僅更新 web，deployment `7817ce31-4423-43df-9163-d6aca236645f`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以最新線上頁尾 A 快照 `87efef1ebe8118ace30cc39a54fac7907b65a815bfee91f3af357106129d7c3f` 為基底，逐檔核對後只刪除 `DayMomentCard.vue`、`paperPrints.ts`、`styles.css` 的照片補充字呈現，共三檔、21 行刪除。保留線上頁尾、Hero、字體、校園圖片及後台；其他本機修改未納入。
- 固定快照 `/private/tmp/ivy-website-day-caption-20260922-151539`；383 個原始檔、45,702,998 bytes，不含後寫入的 release。SHA-256 `52c0092371b0902c9838a4859fa5d48f8ef9f518814ef0f378efee97a12dd5e8`，沿用排序路徑的 `sha256  ./path` 清單再取 SHA-256。上傳前後來源一致，線上 `/release.json` 已核對。
- Node 22.23.2 隔離建置：web typecheck、72 項 web 測試、27 項 admin 測試、admin／production-live web build 通過。初次後台測試因 ENOSPC 中斷，恢復可用空間後從該步重跑成功；保留中斷 log，未調整產品程式或刪使用者檔案。
- 正式站 41 項公開 GET 檢查通過：版本、六張照片無圖說且保留時間戳、production API、CMS release、五校 SSR／修復圖片、字型、robots／404、預約 paused、後台深層路由與靜態 assets、未登入 401、既有字體／活動配色／頁尾 CSS 及建置 hash。沒有登入或讀取私有管理資料。
- Chrome 1440px 桌機完成照片／翻面檢查並保存截圖；390px WebGL 與 320px 減少動態確認六張圖說皆為零，六組時間戳／標題／故事保留、鍵盤翻面與 inert 正常、無水平溢出或 runtime error。首次手機截圖寫入因 ENOSPC 中斷，只刪除本輪 build 中 43,649,892 bytes 的重複靜態資產輸出（原始快照保留），改 JPEG 補跑手機成功。已檢視線上桌機／手機截圖，Safari／Firefox／iOS 實機未驗證。
- 證據：`output/railway-day-caption-20260922-151539/` 的 manifest、approved.patch、build-results／logs、upload、source-verification、services-status、smoke-public.json、final-verification.json 與 browser/。準備腳本 `output/prepare-day-caption-deploy.py`；快照／建置來源用 APFS clone，node_modules 只連入建置副本。
- 未執行 migration、CMS 初始化／發布、素材庫或帳號異動、commit 或 push；五校預約 paused、索引及寄信設定維持。
