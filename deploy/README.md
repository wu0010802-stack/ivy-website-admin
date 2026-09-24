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
| api | `WEBSITE_MEDIA_QUOTA_BYTES_PER_CAMPUS`（選填，預設 5 GiB；每校與共用素材各一份的原檔累計上限） |
| web | `NUXT_TRUSTED_PROXY_HOPS`（選填，預設 1；訪客與 web 之間的可信代理層數，見下方） |

### 公開端點限流與訪客 IP（2026-09-22）

公開 API 一律經 web 的同源代理透過私有網路連進 api，所以 api 看到的
`request.client.host` 恆為代理的位址。限流若直接綁這個值，全站訪客會共用
同一個桶，正常流量就會互相擠掉（analytics 的 CTA 點擊原本就是這樣被靜默
丟棄的）。

api 改成優先採信 `WEBSITE_TRUSTED_CLIENT_IP_HEADER` 指定的 header，
`web/server/routes/api/website/v1/[...].ts` 則把訪客 IP 放進去，並**顯式
覆寫**該 header（不覆寫的話任何人都能自己帶一個來偽造訪客身分）。

2026-09-24 起訪客 IP 由 `web/server/utils/client-ip.ts` 取得：從
`X-Forwarded-For` **右邊**數 `NUXT_TRUSTED_PROXY_HOPS` 層（Railway edge
一層，預設 1），不是最左段——最左段是訪客自己能填的，原本用
`getRequestIP(event, { xForwardedFor: true })` 取第一段，換一個值就換一個
限流桶。前面多加一層 CDN／反向代理時要把層數調成實際值。

同日另加本文上限：web 代理只轉送有 `Content-Length` 的本文（素材上傳 205 MB、
其他 1 MB，超過 413、chunked 沒有長度 411），素材上傳改串流轉送；api 端
`BodySizeLimitMiddleware` 在解析前再擋一次，素材上傳路徑先驗證後台 session。

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
定期呼叫；沒有排程的話逾期占位不會被標成 cancelled。

2026-09-24 起：釋放占位不再依賴寄信設定（未設定
`WEBSITE_NOTIFICATION_EMAIL_SINK_DIR` 時仍會釋放，只是不處理 outbox）；
容量計算本身也排除已到期的待確認占位，所以排程沒跑時名額也不會被卡住。

2026-09-24 起同一個指令也負責**排程發布**（到期才發布，執行前重新檢查排程人
權限、分校是否啟用、素材是否就緒），並可用 `WEBSITE_SMTP_*` 設定真實寄信
（細節見 `docs/website-admin/operations.md`）。本次改動沒有碰正式站設定；
正式站是否已有 cron 呼叫這個指令、是否要設 SMTP secret，需上線前在 Railway 確認。

## 初次初始化

下列指令會寫資料庫，僅對已明確核准的新官網資料庫執行。部署本身不會自動執行 migration；後續 schema 更新也需另行確認。

```sh
railway ssh --service api --environment production -- python -m alembic upgrade head
# 2026-09-22 正式 head 為 8cf3e2b5a641，新增孩子／聯絡資料欄位。
# 前置 a1c4f7e92b30 含唯一索引、占位及通知去重；會封存重複 Email 帳號，
# 執行前先確認影響範圍。本次正式 runner 額外檢查零重複，否則停止。
railway ssh --service api --environment production -- python -m app.cli seed --dry-run
railway ssh --service api --environment production -- python -m app.cli initialize-content /app/content/site-fixture.json
railway ssh --service api --environment production -- python -m app.cli bootstrap-admin
```

`initialize-content` 驗證所有 payload 後，僅補 `latest_version=0` 的空白項目。重跑不覆蓋既有草稿、不多建版本。現行來源共初始化 20 筆：9 種共用內容（2026-09-24 起含 `home_news` 最新消息與活動、`admission_content` 入學資訊）、五校介紹、五校 FAQ、義華巡覽；其他四校巡覽仍保留待補狀態。來源文案原樣保留，包含尚未改成正式用語的原型說明。

**官網瀏覽量與速度上線步驟（2026-09-24）**：新增 migration `b7d2e4f1a903`（只建 `page_view_daily`、`web_vital_samples` 兩張表，不動既有資料）。合併後 API 啟動前的 schema 檢查會擋下新版，直到正式 DB 用既有的核准流程跑完 `alembic upgrade head`；在那之前正式站維持舊版，不會壞。

**home_news 上線步驟（2026-09-24）**：不需要 migration，但部署後要再跑一次上面的 `initialize-content`，才會建立並發布 `home_news`（只補這一筆，其餘 18 筆已有版本不會動）。沒跑之前官網仍顯示程式內建的示意消息，畫面與現在相同；跑完後由後台「首頁 → 最新消息與活動」編輯，示意說明清空後首頁才拿掉「示意內容」標示。

**admission_content 上線步驟（2026-09-24）**：不需要 migration。部署後再跑一次上面的 `initialize-content`，只會補建並發布 `admission_content` 這一筆（其餘已有版本不會動）。沒跑之前 `/admission` 顯示程式內建的同一份內容，畫面相同；跑完後由後台「全站與素材 → 入學資訊頁」編輯。頁面上方的提醒（「金額與補助依各校公告…」）在園方確認金額後可於後台清空。

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


## 2026-09-22 前台效能第一批部署

- 僅更新 web，deployment `d07e2cc6-4805-44d5-94b7-26efe45b3bde`，SUCCESS。API `f8b105cf-2431-4041-8f00-90c70e15613f` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` deployment 維持原版，已即時核對。
- 基底為線上 day-caption 快照 `52c0092371b0902c9838a4859fa5d48f8ef9f518814ef0f378efee97a12dd5e8`；只套 17 個 web 效能檔案差異：巡覽／日常圖片按需載入、responsive 縮圖、理念與日常簾幕 hydration 幾何預留、首屏字型分包及安全 noscript fallback。保留已部署的 Hero、活動、頁尾、照片文字與後台版本；工作區其他設計／預約／API／CI 修改未納入。
- 固定快照 `/private/tmp/ivy-website-performance-20260922-153019`，392 檔／45,892,723 bytes，不含後寫入的 release；SHA-256 `794731a2ae254d422ee2ba2a9c8051ea16d225e71b8f08918a7f5f09d1428646`。逐檔核對基底、建置來源與上傳前後內容，線上 `/release.json` 已驗證。
- APFS clone 製作快照／建置副本，僅清除本輪建置產生的重複 assets 輸出並連回固定快照。Node 22.23.2：web typecheck、77 項 web tests、27 項 admin tests、admin／production-live web build 通過；既有 Hero calc/clamp 與延後 Three chunk 警告保留。backend 無差異，未重跑 backend tests。
- 線上 51 項公開 GET-only 檢查及 18 組 Chrome 情境通過；涵蓋 release、五校 SSR／素材 hash、production API／CMS、robots／404、paused、admin 公開路由與匿名 401、字型預載／immutable 快取、圖片延後載入、五尺寸巡覽／zoom／熱點／dialog、首頁影片與靜態封面、無 JS、減少動態、暖快取。零 runtime error／hydration warning。隔離建置五尺寸 hydration 位置一致，正式桌機／手機畫面已檢視。
- 首頁與五校各三次限速冷載入共 18 次：首頁 LCP 中位數 2.332 秒、CLS 全為 0；五校 LCP 中位數 2.876–3.404 秒，最大 CLS 0.000302。實驗室資料不等於真實訪客 p75，分校仍未達 2.5 秒目標。Safari／iOS 實機、正式登入後台及影片 Range 第二批尚未驗證／實作。
- 證據：`output/railway-performance-20260922-153019/`（manifest、approved.patch、build-results、preflight、upload、source-verification、smoke-public、acceptance、geometry、performance-summary、JPEG）。準備腳本：`output/prepare-performance-deploy.py`。
- 本輪未執行 migration、CMS 發布／初始化、正式帳密登入、資料寫入、commit 或 push；五校預約 paused、索引設定維持。

## 2026-09-22 預約 A 與孩子／聯絡欄位部署

- 使用者明確確認先備份、更新正式資料庫再部署。API deployment `69880c2d-77d0-457d-a051-90f80464b7c4`、web deployment `c801bed3-689e-416d-b057-6ad75d8ed891` 均 SUCCESS；Postgres deployment `be22e502-02ad-41b3-8559-0ce90ae03043` 未更換。
- 固定快照 `/private/tmp/ivy-website-visit-20260922-151800`，403 檔／46,062,672 bytes，不含後寫入的 release；SHA-256 `da604b8c36bd8d8fd7646d34780cd3e26fa5503ac57e4616d1b48fb72bdb7d61`。基底為已上線效能版 `794731a2…`，保留 Hero、字體、照片、活動、頁尾及圖片／字型效能調整；API 使用 commit `21d99e3` 的相依修正加本輪預約資料，未帶入後續 CI/CD 與其他未部署設計。
- 部署 A 選校／資料兩步驟、依各校模式載入真實場次、孩子姓名／生日、Email、得知管道，以及後台詳情／搜尋／CSV／人工確認。正式建置驗收發現分校直達頁 SSR 先顯示空場次、hydration 先顯示載入中；改為掛載後讀場次並共用首次載入狀態，三尺寸完整流程重驗通過。
- 備份位於官網 Postgres volume：`/var/lib/postgresql/data/ivy-website-backups/pre-visit-20260922-151800.dump`，custom-format，已用 `pg_restore --list` 核對，SHA-256 `863dff233061603f3aa7ee14452ddac6da1f3d84c5247577b98dc6bb0ae22a8c`。備份保留在服務內，未下載個資；本次沒有執行還原演練。
- 正式 schema 從 `ce3082c9bf69` 經 `a1c4f7e92b30` 更新至 `8cf3e2b5a641`。使用已核對的 Alembic 離線 SQL，在同一交易設定 lock／statement timeout，鎖住帳號與內容並先確認零重複。若出現重複會停止；本次重複帳號／共用內容皆 0，沒有改名或停權帳號。新欄位及索引／通知去重表已唯讀核對。
- Node 22.23.2 隔離驗證：web typecheck、88 web tests、30 admin tests、前後台正式 build；專用本機 PostgreSQL 完整 API 171 tests 通過。磁碟 ENOSPC 中斷及重跑有保留紀錄，只清理核對過且未使用的舊暫存建置產物，原始快照／manifest／logs／使用者程式碼保留。
- 線上 39 項公開 GET 驗證通過：release、production/live health、CMS、五校 SSR／照片、robots／404、預約模式、後台公開路由與資產、匿名 401 及既有設計 CSS hash。另核對後台 JS／CSS 兩檔與正式建置一致；API 容器 97 個來源檔 hash、migration、新欄位、UID 10001 與 `/data/media` volume／owner／750 權限通過。
- Chrome 1440／390／320px 共 6 組正式選校／paused／分校直達驗證通過，無水平溢出、runtime 或 hydration error；已檢視桌機／手機截圖。所有 API 寫入由測試攔截，沒有登入後台、讀取私人案件或建立正式預約。完整場次送出與新欄位 payload 在同份本機正式建置及合成 API 驗證；Safari／iOS 實機未驗證。
- 證據：`output/railway-visit-20260922-151800/` 的 manifest、build-results、backend-results、backup-record、migration-result、upload-api／web、api-verified、smoke-public、admin-assets-verified、browser-online-results、最終驗收及截圖。部署 runner 為同目錄 `rollout.py`，每階段檢查 snapshot／前置狀態與線上基底。
- 五校預約維持 `paused`，未建立場次、啟用寄信／索引、CMS 初始化／發布、commit 或 push。新 schema 保留相容空值；回復程式應先回退 API／web 並保留新欄位，不盲目 downgrade 刪除已收集資料。

## 2026-09-22 後台深色側欄與青藍風格部署

- 僅更新 web，deployment `ac70c670-ff0f-45b7-8764-81cb67e1e34b`，SUCCESS。API `69880c2d-77d0-457d-a051-90f80464b7c4`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 基底為最新線上預約版 `da604b8c…`，403 檔逐一核對後，只覆蓋本輪 9 個 `admin/src` 樣式檔。這九檔的修改前快照與線上基底完全一致，Vue script／template 無差異；公開 `web/`、backend、contracts、content 與部署設定均保留。
- 固定快照 `/private/tmp/ivy-website-admin-style-20260922-162716`；403 個來源檔、46,064,996 bytes，不含後寫入的 release。SHA-256 `fc5638c3c41c460936a7599bc939481bfcb1ee967c2670f2c897fc06811f82fb`，雜湊算法沿用排序的 `sha256  ./path` 清單再取 SHA-256。上傳前後與部署後來源 hash 一致，線上 `/release.json` 已核對。
- Node 22.23.2 隔離建置：web typecheck、88 web tests、30 admin tests、admin 與 production/live web build 全數通過；套件及 lockfile 與依賴來源一致，正式 Railway build 依 lockfile 執行 npm ci。沿用既有大型 chunk／Hero CSS 建置提醒；backend 無差異，未重跑 backend tests。
- 線上 39 項公開 GET 通過，含 production API、CMS、五校 SSR／照片、paused、robots、404、後台公開路由與匿名 401、既有首頁字體／活動／頁尾 CSS。後台 JS／CSS 兩檔與固定快照成品 SHA-256 相符。
- Chrome 1440／390／320px 共 14 組線上檢查通過，包含匿名登入頁、新配色、總覽、案件、編輯頁及手機功能搜尋／Escape／焦點返回；無整頁水平溢出或 runtime error。後台內頁用正式資產搭配合成 API，沒有登入真實帳號、讀取私人案件或 API 寫入。已檢視正式登入頁及合成資料總覽截圖；Safari／iOS 實機未驗證。
- 證據：`output/railway-admin-style-20260922/` 的 manifest、summary、build-results／logs、upload、final-status、smoke-public、admin-assets-verified、browser-online-results、acceptance 與截圖。
- 未執行 migration、CMS 發布／初始化、通知／索引啟用、commit／push。回復時可重部署前一個 web deployment，API 與 schema 無須調整。


## 2026-09-22 首頁五校線稿切換列放大部署

- 僅更新 web，deployment `47f3ca84-a257-441a-8723-54ebff31bff3`，SUCCESS。API `c3f5a19f-ff76-4638-9a16-78bef516c124` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 部署未變，已即時核對。
- 最新線上基底是 GitHub Actions 的 commit `4466afa9fed642138f29aafea11b6733c8e9ba5a`，不是較早的 admin-style 快照。依 `railway_ci.py` 重建 436 檔，SHA-256 精確吻合 `f368174585024cbca40780a57e71d5b92c6a3f3b15c9fd3358154b3f32fb3fc9`。只套用 `CampusBoard.vue` 四行尺寸差異：圖片 sizes、選校列寬、按鈕／字級、線稿尺寸。保留正式 `cardImage()` 延後載圖與手機照片原高度；並行中的手機構圖、消息與樣式修改未納入。
- 固定快照 `/private/tmp/ivy-website-campus-size-20260922-174531`，436 檔、47,936,334 bytes，不含 release；SHA-256 `4045a4b4d20036103799f2225e5a257701bf07622bfbf549e184a2eb5248651b`。上傳前後來源一致、線上 release 已核對。回復參考為前版 web deployment `988bbd93-c8d7-4d63-89cb-bb0ab23bf4b6`；API 與 schema 無須調整。
- Node 22.23.2 隔離建置通過 web typecheck、92 項 web tests、42 項 admin tests、admin build 與 production/live web build。沿用既有 Hero CSS calc/clamp 與 chunk 警告；backend 未更動，未重跑其測試。
- 線上 43 項公開檢查通過：release、production/live API、CMS、五校 SSR、插畫 sizes、產品 CSS 與 admin JS／CSS hash、預約公開設定、robots、404、匿名 401、來源 hash 及服務 deployment。Nuxt 內建 404／500 CSS 因本機 node_modules 連結與 Docker 路徑不同而 scope ID 不同，已核对除 scope ID 外內容逐位元組一致；產品 CSS 仍嚴格核對原始 SHA-256。初次核對紀錄保留。
- Chrome 1440／768／390／320px 實際五校點選、左右方向鍵循環與圖片載入通過，0 runtime error、無水平溢出。桌機實測列寬 1040px、線稿 160px、校名 17px。已檢視正式桌機與手機截圖；Safari／iOS 實機未驗證。
- 正式預約已不是五校全部 paused；本次唯讀觀察義華／崇德為 inquiry、明華為 slots、國際／仁武為 paused。本輪沒有更改預約設定、CMS、資料庫或寄信／索引；初版 smoke 沿用舊 paused 假設，改為按現行 API 契約驗證並記錄實際模式。
- 證據：`output/railway-campus-size-20260922-174531/` 的 summary、manifest、approved.patch、build-results／logs、preflight、upload、smoke-public、browser-results、scope-comparison 與 online 截圖。未執行 migration、帳密登入、私人資料讀寫、commit 或 push。

## 2026-09-22 手機版保留桌機構圖部署

- 僅更新 web，deployment `81f2ce4e-0722-4fbe-bc5d-125196351034`，SUCCESS。API `c3f5a19f-ff76-4638-9a16-78bef516c124` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 部署未變，已即時核對。
- 以最新正式校區線稿快照 `4045a4b4d20036103799f2225e5a257701bf07622bfbf549e184a2eb5248651b` 為基底，逐檔驗證後只套入 `studio.css`、`styles.css`、`CampusBoard.vue`、`NewsDialog.vue` 的手機構圖差異。由修改前備份產生精準 patch，避免用本機整檔覆蓋正式版的 Hero reveal、版本化字型、圖片延後載入及桌機線稿放大；獨立唯讀審查通過。
- 固定快照 `/private/tmp/ivy-website-mobile-composition-20260922-175717`，436 檔、47,937,226 bytes，不含 release；SHA-256 `050b9d12a8dada89c13c8e97261503cbe713a35544f07fc0061a390b580c0852`。上傳前確認線上基底與服務部署未變，上傳後來源 hash 及線上 release 一致。回復參考為前版 web deployment `47f3ca84-a257-441a-8723-54ebff31bff3`，API 與 schema 無須調整。
- Node 22.23.2 隔離建置通過 web typecheck、92 項 web tests、42 項 admin tests、admin build 與 production/live web build。沿用既有 Hero CSS calc/clamp 與 chunk 警告；backend 未更動，未重跑其測試。
- 線上 45 項公開 GET 檢查通過：release、production/live API、CMS、五校與預約 SSR、手機橫滑／拍立得及桌機尺寸 CSS、產品樣式與 admin assets SHA-256、預約公開設定、robots、404、匿名 401、來源 hash 及服務 deployment。Nuxt 內建 404／500 CSS 延續前次核對方式，確認除了依建置路徑產生的 scope ID 外內容完全一致；產品 CSS 嚴格核對原始 SHA-256。
- 同一正式建置以本機 fixture 驗證，正式站再使用已發布 CMS 內容驗證：Chrome 320／390／430／640／768／1024／1440px、鍵盤與對話框焦點返回、觸控橫滑、六張 WebGL 翻卡、CSS 備援、減少動態、200% 拍立得文字放大、橫直轉向與五校圖片載入／置中全部通過。各自保存 10 組驗證結果，無整頁水平溢出、runtime error 或 hydration warning；已檢視正式手機消息、翻面與校區截圖。Safari／iOS 實機未驗證。
- 本機儲存正式站截圖一度因 ENOSPC 中斷；清除已核對無程序使用的舊建置產物，並將本輪重複輸出素材改連回原始快照後，接續未完成的互動檢查成功。所有來源快照、manifest、logs 保留；沒有因本機磁碟問題重部署正式站。
- 五校預約唯讀觀察為義華／崇德 inquiry、明華 slots、國際／仁武 paused。瀏覽器攔截 API 寫入，未登入正式帳號或建立預約；未執行 migration、CMS 發布、通知／索引啟用、commit 或 push。
- 證據：`output/railway-mobile-composition-20260922-175717/` 的 summary、manifest、approved.patch、independent-review、build-results／logs、preflight／pre-upload、upload、services-status、smoke-public、scope-comparison、browser-local／browser-online 與 final-verification。準備程式為 `output/prepare-mobile-composition-deploy.py`。

## 2026-09-22 修復一天照片裁切回歸部署

- 僅更新 web，deployment `3a94c291-e100-435b-ad34-8531a5370b9b`，SUCCESS。API `c3f5a19f-ff76-4638-9a16-78bef516c124`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 以正式手機構圖快照 `050b9d12a8dada89c13c8e97261503cbe713a35544f07fc0061a390b580c0852` 為基底，逐檔驗證後只刪除 `web/app/components/DayMomentCard.vue` 的 figcaption 一行。效能分支合併 `c0b949d` 帶回標籤，但 CSS／WebGL caption 支援已刪，造成 figure 比 img 多 29px，WebGL 依 figure 高度裁切時照片被放大；本輪恢復已定案的無補充字版本。
- 固定快照 `/private/tmp/ivy-website-day-photo-fix-20260922-204153`，436 個來源檔、47,937,166 bytes，不含後寫入的 release；SHA-256 `a2a3230720fa0c4ed3e8d21719b649176d819fc04f7c8c358fb8672837188107`。上傳前後來源 hash 一致，線上 release 已核對。回復參考為前版 web deployment `81f2ce4e-0722-4fbe-bc5d-125196351034`。
- Node 22.23.2 隔離建置通過 web typecheck、92 web tests、42 admin tests、admin build、production/live web build；既有 Hero 巢狀 calc/clamp 與大型 chunk 警告保留。`node --check app.js` 與原型打包通過，preview.html 無差異。backend 無差異，未重跑其測試。
- 46 項公開 GET 檢查通過，包括版本、production/live API、CMS、五校與預約／後台 SSR、照片說明未回歸、正式 CSS／admin 資產 hash、預約設定、robots、404、匿名 401、來源 hash 與三服務 deployment。Nuxt 內建錯誤頁 CSS 延續既有 scope ID 正規化比對；產品 CSS 維持逐位元組 hash 核對。
- 部署前正式站確認六張 figure 為 386×415、img 386×386。修補建置及線上均通過四種情境：1440px 桌機 WebGL、390px 手機 WebGL、320px 減少動態、390px CSS 備援。每組六張皆成功載圖、正方形比例、可翻面及正確 inert/aria-expanded，無整頁溢出、runtime／hydration error。實測照片尺寸分別為 386×386、253×253、214×214。已檢視本機及線上截圖；Safari／iOS 實機未驗證。
- 初次線上驗收第一張 WebGL 初始化等待 25 秒逾時；獨立診斷確認圖片與動態模組正常、WebGL 已啟動，只有測試刻意阻擋的 telemetry 請求失敗。未再修改產品來源或重部署，增加診斷紀錄後重新完整四組通過。首次逾時原因未確定，保留原結果，未宣稱已定位或修復另一項初始化問題。
- 證據：`output/railway-day-photo-fix-20260922-204153/` 的 summary、manifest、approved.patch、build-results／logs、preflight／pre-upload、upload、smoke-public、online-diagnostic、browser-online-first-attempt、final-verification；截圖與回歸结果在 `output/playwright/day-photo-fix-20260922-204153-{baseline,local,online-recheck}/`。準備程式為 `output/prepare-day-photo-fix-deploy.py`。
- 本機 checkout 的 DayMomentCard 原本已無該標籤，故未用本機整檔覆蓋正式效能版本。此輪手動部署未 commit／push，main 後續同步見下節。未執行 migration、CMS 發布、正式帳號登入、案件寫入或通知／索引啟用。本輪本機預覽服務已停止。

## 2026-09-22 main 同步正式快照與 CI 部署

- 使用者要求同步 main；在隔離 checkout 從最新 `origin/main`（`4466afa`）建立 commit `89235d2796c017f619d4146ee7fdbbfcfb101e20`，已正常 fast-forward 推送遠端 main，未 force push。同步五個產品檔：`DayMomentCard.vue`、`studio.css`、`styles.css`、`CampusBoard.vue`、`NewsDialog.vue`，另更新根目錄 README／DESIGN。
- main push 會重新部署完整來源，因此保留先前已上線的手機消息／活動橫滑、84% 拍立得與雙面高度、五校線稿大小及手機照片 3:2。逐檔核對 436 個部署來源，CI 重建快照 SHA-256 與手動正式版完全相同：`a2a3230720fa0c4ed3e8d21719b649176d819fc04f7c8c358fb8672837188107`；根目錄說明文件不在部署範圍。
- 本機 Node 22 typecheck、92 web tests、`node --check app.js`、原型打包與 diff 檢查通過，preview.html 無差異。GitHub Actions [35740635299](https://github.com/wu0010802-stack/ivy-website-admin/actions/runs/35740635299) 的 web、admin、Backend／PostgreSQL／contracts 及 Deploy Railway production 四項 job 全部成功。
- CI web deployment `a56f09f9-a491-498c-b5e7-2c5bfda0f9ef`、API deployment `fc224986-4a89-46c9-8baf-920b921c3d16`。正式 `/release.json` 已核對 base_commit `89235d2…`、snapshot `a2a32307…`；CI 公開 smoke 通過。API 來源與前版相同，Postgres deployment 維持 `be22e502-02ad-41b3-8559-0ce90ae03043`。
- 本機 `/Users/yilunwu/Desktop/ivy-website-prototype` 的 main 已安全快轉至同一提交；先确认同步檔案與使用者未提交路徑不重疊，再比對 9 個檔案 hash 與 git status，均完全保留。`ivy-website-admin` 仍在原 feature 分支，未合併或整理其未提交修改。
- 證據：`output/main-sync-20260922/` 的 CI watch log、verification.json、local-main-verification.json；隔離 checkout `/private/tmp/ivy-website-main-sync-20260922-photos`、提交快照 `/private/tmp/ivy-website-main-sync-20260922-committed`。未執行正式資料 migration、CMS 發布或業務資料寫入。

## 2026-09-23 手機關於背景與大字接力部署

- 僅更新 web，deployment `2bb67300-f755-4ef7-8787-ac02a14ef4a4`，SUCCESS。API `9d04a2b6-9f0e-4f5e-ab23-7e9d49c525f4`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 最新正式基底為 CI commit `9813f34b66143297aff9835ad91d17b3322ffa7f`，重建 437 檔 snapshot 與線上 `14952c0eda3dd103dcd3f322cbd9b76afbeb30a472cc7f2a1fb8fd68946f4f39` 完全一致。只套入本輪 `web/app/assets/css/studio.css` 兩段差異：單欄介紹尾背景、手機大字寬度／透明度及副標排版；保留已發布字型、效能與其他設計。
- 固定快照 `/private/tmp/ivy-website-about-mobile-20260923-093354`，437 檔、47,943,677 bytes；SHA-256 `8a3dd98d82f1b03ab7392fa7d92190db057c3c3b98757b8d4a399da9f803b858`。上傳前核對線上 release 與三服務狀態，上傳後來源逐檔 hash 不變，線上 `/release.json` 已核對。回復參考為前版 web deployment `73741e40-e9fe-4cfc-8c3d-c4e5590936bc`。
- Node 22.23.2 隔離建置：web typecheck、92 web tests、42 admin tests、admin build、production/live web build 通過。既有 Hero calc/clamp 與 chunk 建置提醒保留；backend 無差異，未重跑其測試。
- 正式 42 項公開 GET 檢查通過，涵蓋 release、production/live API、CMS、五校／預約／後台入口、booking-config 契約、robots、404、匿名 401 及服務版本。13 段 SSR 內嵌產品 CSS、外連樣式及 admin assets 均與隔離建置 SHA-256 相符。舊 smoke 僅收集外連 CSS 的不足已補正，詳見 validation-notes。
- 同份建置及正式站各通過 24 組 Chrome 驗證，涵蓋八尺寸 320–1440px、照片與浮水印間距、文字對位、介紹展開／收合、正反捲動、橫直旋轉、網址列高度、200% 文字、減少動態及無 JS。零水平溢出、runtime／hydration error；已檢視正式 390px 畫面。Safari／iOS 實機未驗證。
- 證據：`output/railway-about-mobile-20260923-093354/` 的 summary、manifest、approved.patch、build-results／logs、preflight／pre-upload、upload、railway-success、smoke-public、browser-local／browser-online 與 final-verification。準備程式 `output/prepare-about-mobile-deploy.py`。
- 瀏覽器阻擋 API 寫入；未執行 migration、CMS 發布／初始化、正式帳號登入、案件寫入、通知／索引啟用、commit 或 push。其他進行中的未提交設計不納入本次快照。


## 2026-09-23 常春藤的一天照片畫質部署（等待 Railway 初始化）

- 使用者已授權部署，僅上傳 web；deployment `28ce210a-4ad8-4be1-92ea-689da4348224` 於 09:55:28（台灣）建立。截至 10:11:36，仍為 `INITIALIZING`，15 分鐘等待逾時；`snapshotId`、`diagnosis`、`statusUpdatedAt` 均為 null，CLI 建置紀錄回報尚無 associated build。**尚未上線，未完成正式照片驗收。**
- 正式站仍為 commit `75058da726f03845b54f645164daf41a6549da63`、snapshot `00d0bdab005db252d7c79611ab56cc904e62a164ecce9142337fc959c7c30346`，API production/live health 為 ok。API `0b2c7267-b160-4b2d-b434-2e58b63c919f`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 均維持原部署且 SUCCESS。
- 最終待上線快照 `/private/tmp/ivy-website-day-photo-quality-20260923-094939`，459 檔／49,128,762 bytes，SHA-256 `6b82fc18babbcfc54e157b0cba3188ea6f5ddfafed413e3e6c9c5d25f252af15`。精確重建當前正式基底，再只修改 3 個 web 程式／manifest 檔與 25 個照片素材；保留正式 renderer 的顯影快取、延後載入及其他已部署改動。上傳前後 hash 一致，沒有攜帶其他未提交設計。
- 五張照片原生 1080×800、WebP quality 94，響應式小圖 quality 92；原生尺寸另以內容雜湊網址直接複製，避免正式原圖網址一天快取。桌機／手機選圖納入橫圖裁成正方形的像素需求，renderer／貼圖／顯示 Canvas 同步支援最高 3× DPR。教室圖保留現行正式素材。
- 隔離 Node 22 typecheck、102 web tests、42 admin tests、admin build 與 production/live web build 通過；同份建置本機 24 組 Chrome 驗證通過，含桌機／手機各六張 WebGL 與兩組六張 CSS 備援。核對新版本化網址、來源尺寸、Canvas 像素密度、翻面與無水平溢出，無 runtime error；Safari／iOS 實機未驗證。
- 證據：`output/railway-day-photo-quality-20260923-094939/` 的 summary、manifest、approved.patch、build-results／logs、browser-local、preflight／pre-upload、upload、uploaded、initialization-diagnostic、final-status 與 validation-notes。重建腳本 `output/prepare-day-photo-quality-deploy.py`；後續線上檢查指令在 validation-notes。
- 保留此筆等待中的部署，未重複上傳。未執行 migration、CMS 發布、正式帳號登入、業務資料寫入、通知／索引啟用、commit 或 push；只停止本次隔離預覽 3157／3158，未停止使用者開發服務。

## 2026-09-23 選單五校 hover 切換部署

- 僅更新 web，deployment `e5ea1c35-ce8f-4b2b-9705-317294f76830`，SUCCESS。API `0b2c7267-b160-4b2d-b434-2e58b63c919f`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。
- 開工時確認上節照片畫質部署 `28ce210a…` 已 SUCCESS，正式 release 為 `6b82fc18…`。依其 459 檔 manifest 逐一驗證後，只套入 `SiteHeader.vue` 的滑鼠／焦點切校及電話社群同步、`studio.css` 的選中底色；其他正式來源逐位元組保留，未納入並行開場及其他本機改動。
- 固定快照 `/private/tmp/ivy-website-menu-hover-20260923-115855`，459 檔／49,129,759 bytes，不含 release。SHA-256 `01bdec18c3e5fea982c98ca329d9ff299465b2b67b06fea6a4abd61ea9d3f392`；上傳前核對線上基底、上傳後來源 hash 與正式 `/release.json` 一致。回復參考為前版 web deployment `28ce210a-4ad8-4be1-92ea-689da4348224`。
- Node 22.23.2 隔離建置通過 web typecheck、102 web tests、42 admin tests、admin build 與 production/live web build。既有 Hero CSS calc/clamp 與 chunk 提醒保留；backend 無差異，未重跑其測試。
- 39 項公開唯讀檢查通過，包括 release、production/live API、CMS、五校／預約／後台 SSR、公開預約設定、robots、404／匿名 401、產品 CSS 與 admin assets SHA-256，以及快照來源未漂移。初次 health GET 逾時後自動重試成功；沿用腳本的一項舊 about-mobile 公式假設與正式基底不符，確認基底本就無該公式、CSS 只增加本次 selector 後移除該過時斷言，未改產品或重部署。
- 同份建置及正式站均通過 1440px 五校 hover／電話／四平台社群、移出保留選擇、不搶焦點、Tab／Escape／校名導頁及 390px 手機點選；無 runtime error，手機無水平溢出。已檢視正式桌機選單截圖；Safari／iOS 實機未驗證。
- 證據 `output/railway-menu-hover-20260923-115855/`：summary、manifest、approved.patch、build-results／logs、pre-upload、upload、railway-success、smoke-public、validation-notes、browser-local／browser-online。準備程式 `output/prepare-menu-hover-deploy.py`。
- 未執行 migration、CMS 發布、登入／業務資料寫入、通知或索引啟用、commit／push；驗證瀏覽器阻擋業務 API 寫入，只停止本輪隔離預覽 3163。

## 2026-09-23 彩色校徽置中／321 圓框布幕部署

- 最終 web deployment `367a3133-0ab1-43fa-9c2a-dfaee064d8a5`，SUCCESS。正式 `/release.json` snapshot `f17220a71ac74d29c60c62de39a3e00e161b84c867a0484d4d1f92b2dd0b6bbe`；API `b3361602-92f0-4945-8c9e-3658b9d8e0ba`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 均維持原部署，已即時核對。
- 開工時正式站已由 GitHub Actions 更新至 commit `9d838f0bb61d3cfbea7997f317ffd6a95ab7bb24`、snapshot `6f792cc0c0c699e017607e15ce3e79da533d955b03db00cb99625e7d4467e36a`，並非前節選單部署快照。以 git archive 精確重建且 hash 符合的正式來源，只更新 `entranceCurtain.ts` 並移除舊 `entrance-film.ts`。既有 entrance integration／timeline／asset／dependencies 沿用正式版。
- 彩色人物、暖金週年緞帶與 A/13 人物校徽置中；桌機投影圓框倒數，手機延用暖金圓盤樣式。此輪未納入工作區並行的 iris／flash／flare、新材質、字型或後台修改。
- 首次部署 `85734ccf-f924-4f0c-9bc5-e2ef21c539c1` 已 SUCCESS，但正式冷載入曾因先編譯空白幀、Logo 過晚下載而觸發 2800ms 初始化略過。已補上素材就緒前不繪製空白幀，並提早啟動圖片請求。800ms 圖片延遲對照確認修正後請求先於 shader 編譯發出；保留原有所有逾時與偏好保護，未延長倒數。
- 最終快照 `/private/tmp/ivy-website-entrance-load-20260923-135034`，470 檔／70,119,022 bytes（不含 release）；上傳前核對正式基底與三服務部署未變，上傳後來源 hash 保持一致。初次核准布幕快照為 `63a6463d4d4d3722a6a1c2937e08342724c4689dc39495baed17e27131f2814b`，最終在其上只套用首幀載入修正。
- Node 22.23.2 隔離 web typecheck、120 web tests、42 admin tests、admin build、production/live web build 通過。最後只改 renderer 的階段，重跑 web 三項；admin 來源／lockfile 未變，沿用同份成功結果。原型語法與重打包通過，preview.html 雜湊不變。既有 CSS calc 與 bundle 大小警告保留。
- 本機 9 組流程涵蓋 1440／390px 全程播放、一次播放、清理、無溢出、skip／Escape／context loss／中途減少動態與強制色彩／錨點略過。正式 Chrome 1440×900 DPR2、390×844 DPR3 完整播放、清理、無溢出與重新整理不重播均通過，無 runtime／shader／hydration error；實測每段倒數 998.7–1006.2ms。線上計時移除倒數中的高解析截圖干擾，保留原始至少 850ms 斷言。Safari／Firefox／iOS 實機未驗證。
- 51 項公開唯讀檢查通過：release、production/live API、CMS、五校／visit／admin SSR、預約契約、robots、404／匿名 401、產品 CSS／admin asset hash、Logo 原圖 hash、正式 renderer 的五段 GLSL 精確比對與無 SSR prefetch。一次公開 GET 連線逾時後重試成功。Docker／本機 import 排序導致 minifier 識別符與 JS chunk hash 不同，未宣稱整份 JS hash 相同，詳見 renderer-comparison.json。
- 證據 `output/railway-entrance-20260923-133533/` 與最終 `output/railway-entrance-load-20260923-135034/`，包含 summary／manifest／approved.patch／build-results／browser-local／browser-online／load-order／pre-upload／upload／railway-success／smoke-public／validation-notes。未執行 migration、CMS 發布、帳號登入、業務寫入、通知、索引啟用、commit 或 push。


## 2026-09-23 iPhone 背景控制鈕捲動相容性部署

- 僅更新 web，deployment `6ca094b6-1fdf-40a4-a9de-c7cad13c62f7`，SUCCESS。API `b3361602-92f0-4945-8c9e-3658b9d8e0ba` 與 Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 保持原部署，已即時核對。
- 以正式開場載入修正版 `f17220a71ac74d29c60c62de39a3e00e161b84c867a0484d4d1f92b2dd0b6bbe` 為基底，只在 `web/app/assets/css/styles.css` 加入觸控裝置 `.day-film-ui` 的 `translateZ(0)` 與註解。470 檔逐一核對，唯一產品差異為此兩行 CSS，保留已上線開場、照片、字型及後台版本。
- 固定快照 `/private/tmp/ivy-website-day-button-20260923-140119`，470 檔／70,119,202 bytes，不含後寫入的 release；SHA-256 `cd2d806f10eea31f3204d04055184b0a32162ae7c21f522798a9b72025376972`。上傳前後來源一致，線上 `/release.json` 已核對。回復參考為 web deployment `367a3133-0ab1-43fa-9c2a-dfaee064d8a5`。
- 首次候選 `135644` 在上傳前偵測到正式基底由 `63a6463d…` 更新為 `f17220a7…`，自動停止且沒有上傳；重新以最新正式快照疊入同一修正。保留重建與中止證據，沒有回退並行的開場更新。
- Node 22.23.2：web typecheck、120 web tests、production/live build 通過。42 admin tests 與 admin build 在本輪初次候選通過；重建基底時逐檔確認 admin／contracts 完全一致，沿用其結果與成品並記錄來源。backend 無變更，未重跑其測試。既有 CSS calc/clamp 與 chunk 建置提醒保留。
- 34 項公開 GET 檢查通過：版本、production/live API、已發布 CMS、五校／預約／後台 SSR、所有 SSR inline CSS 及外連產品 CSS、admin JS／CSS hash、booking-config、robots／404／匿名 401、來源 hash 與按鈕 CSS。
- 同份建置與正式站各通過五組瀏覽器檢查：Chrome 390／320px 觸控、1440px 桌機，WebKit 390px 一般／減少動態。版位不變、上下捲動位置穩定、播放／暫停、純高度改變及離開區塊後不攔截點擊均通過，零 runtime error、無水平溢出。iPhone Chrome 實機是否消除抖動仍待使用者確認，不以桌機 WebKit 代替實機證據。
- 證據：`output/railway-day-button-20260923-140119/` 的 summary、manifest、approved.patch、build-results／logs、pre-upload、upload、railway-success、smoke-public、browser-local／browser-online、rebase-notes。準備程式 `output/prepare-day-button-deploy.py`。
- 未執行 migration、CMS 發布、正式帳號登入、預約或通知寫入、commit／push。瀏覽器阻擋所有非 GET／HEAD／OPTIONS 請求；僅停止本輪隔離預覽程序。

## 2026-09-23 關於常春藤單張圓角照片部署

- 使用者要求換成新照片並部署。僅更新 web，deployment `061fd0b4-7198-458e-bc8b-812c6ab0ed6b`，SUCCESS。API `b3361602-92f0-4945-8c9e-3658b9d8e0ba`、Postgres `be22e502-02ad-41b3-8559-0ce90ae03043` 維持原部署，已即時核對。回復參考為前版 web deployment `6ca094b6-1fdf-40a4-a9de-c7cad13c62f7`。
- 等 iPhone 背景控制鈕部署（day-button）上線後才準備，以當下正式 release `cd2d806f…`（快照 `/private/tmp/ivy-website-day-button-20260923-140119`）為基底，manifest digest 重算相符。只精準替換 4 個檔：`AboutSection.vue` 單張照片（保留正式版 `fetchpriority="low"`）、`studio.css` 照片框 3:2／16px 圓角／無白邊陰影（圖說沿用正式 11px／10px）、`site-fixture.json` 換成 `about-together`、`image-manifest.json` 追加一筆；新增 `about-together` 母檔與 4 個響應式檔。其他 470 個正式來源逐位元組保留，未納入本機未部署的字級 token 等修改。
- 固定快照 `/private/tmp/ivy-website-about-photo-20260923-140608`，475 檔／70,424,111 bytes，SHA-256 `a6bb8f44bb91fcec51bc8b7b60f12c0528a2e94003d8e13e13032c5717070b87`；上傳前核對線上基底與三服務最新部署未變，上傳後來源 hash 不變，正式 `/release.json` 已核對。
- Node 22.23.2 隔離建置：web typecheck、120 web tests、42 admin tests、admin build、production web build 通過（已 grep 輸出，不只看 exit code）。同份建置與正式站各以 1440／1024／390 驗證：照片 1 張、圓角 16px、無邊框陰影、載入 about-together 480w／800w、無水平溢出與 runtime error；已檢視正式 1440px 畫面。Safari／iOS 實機未驗證。
- 證據 `output/railway-about-photo-20260923-140608/`（summary、manifest、approved.patch、build-results／logs、browser-local／browser-online、pre-upload、upload），截圖在 `output/playwright/about-single-photo-20260923/`（before／after／photo／build／online）。準備程式 `output/prepare-about-photo-deploy.py`（自動以線上 release 為基底），上傳程式 `output/upload-about-photo.py`。
- 未執行 migration、CMS 發布、正式帳號登入、業務資料寫入、commit／push；只停止本輪隔離預覽 3171。

## 2026-09-23 後台第四輪 UX 經 main CI 部署（含手動快照併回 git）

- 正式站原為 main `9d838f0` ＋四次手動快照（校徽置中投影、日常影片控制列合成、關於單張圓角照片），最後一次 release `a6bb8f44…`（快照 `/private/tmp/ivy-website-about-photo-20260923-140608`）。推 main 前先以該快照逐檔比對 `9d838f0`，把 6 個變更檔、5 個新 webp 與刪除的 `entrance-film.ts` 併成 commit `16ade52`（工作樹與快照逐位元組一致，僅 `release.json` 不同），再合併 `feature/website-admin`（`863e5ed` 後台第四輪 UX、字級 token 批次）為 `dacbdbe`。衝突只在 `styles.css`／`studio.css`（線上單張照片結構＋feature 的 `--fs-*` token 都保留）與 DESIGN.md。
- 合併後於 Node 22.23.2 乾淨工作樹通過 web typecheck、120 web tests、admin typecheck、48 admin tests、Nuxt production build（既有 clamp postcss 警告不變）。
- GitHub Actions run `35826104444`（main push）四個 job 全綠，Deploy Railway production 成功；正式 `/release.json` `base_commit` 為 `dacbdbe…`、snapshot `49d1ce08…`、`source: GitHub Actions: committed production snapshot`、web+api 同批。
- 線上核對：`/`、`/campuses/yihua`、`/visit/yihua`、`/admin/`、`/api/website/v1/health` 200；`/admin/visit-requests?follow_up_due=true` 匿名 401（新參數已上線）。未執行 migration（本輪無 schema 變更，正式 head 仍 8cf3e2b5a641）、未寫入業務資料。
- 之後任何手動快照部署必須以 `dacbdbe` 為基底；再推 main 前照本節做法先把線上快照差異併回 git。

## 2026-09-23 修正錯誤頁 gzip 損毀（第二次 main CI 部署）

- 上一節部署後用 httpx／Chrome 驗證發現：`/campuses/不存在校區` 的 404 HTML 頁自 09-22 `41468b3` 起就壞（`web/server/plugins/compress-html.ts` 在 `render:response` 壓縮，Nuxt 錯誤處理器內部 fetch `/__nuxt_error` 後以 `.text()` 讀 Buffer，gzip 的 `0x8b` 變 U+FFFD），Chrome 直接 `ERR_HTTP_RESPONSE_CODE_FAILURE`。curl UA 會拿到 JSON 404，所以先前所有 smoke 都看不到。以本機正式 build 確認 `9d838f0` 與 `dacbdbe` 皆重現，非本輪引入。
- 修正 `f023bd0`：`/__nuxt_error` 或 status ≥ 400 不壓縮，其餘頁面照舊 gzip／br。GitHub Actions run `35827967602` 四個 job 全綠；正式 `/release.json` `base_commit` `f023bd0`、snapshot `4e5b46e5…`。
- 線上驗證：Chrome 開 `/campuses/not-a-campus` 回 404 並正常顯示錯誤頁（目前是 Nuxt 預設樣式，尚無自訂 `error.vue`）；`output/railway-smoke-20260923-admin-r4.py` 33 項全通過（原腳本「五校皆 paused」的斷言已過時，正式站現為 yihua inquiry、minghua slots、chongde inquiry、international／renwu paused，改為只驗設定可讀）。
- 未執行 migration、未變更 CMS 或預約設定。`fix/error-page-compression` 只在 main；`feature/website-admin` 下次合併 main 時會帶到。

## 2026-09-23 官網報名修復與家長管理頁部署

- 使用者明確要求部署本輪修復。API `756fb199-0f0b-4b57-952a-b4c71ca79116` 與 web `89f666de-fdf2-46c1-b929-6d690dfdf748` 皆 SUCCESS；正式 `/release.json` snapshot `20800ce32b86ee63a8a0d8551b0fe7cc2266c60241dced6afd6007315154841f`，服務 `web+api`。只部署程式，未執行 migration、CMS 發布／初始化、正式帳號登入、正式報名／通知寫入、commit 或 push。
- 最初以 CI `dacbdbe`／snapshot `49d1ce08…` 建好候選快照；API 上傳前偵測其他 CI 已更新，前置檢查自動停止，未上傳舊候選。最新基底改為 `f023bd0e7290c55d10353f1579e17fe931e166ee`／snapshot `4e5b46e5…`，保留其錯誤頁 gzip 修正，再疊入這次 20 個報名相關檔案。未納入並行布幕、翻角及其他設計。
- 固定快照 `/private/tmp/ivy-website-visit-repair-20260923-145157`，483 檔／70,502,268 bytes（不含後寫 release）。原有一般 `/visit` 的 no-cache 返回行為保留；只對 `/visit/manage` 加 no-store／noindex／no-referrer。前台、API、契約一同上線；管理頁支援狀態與遮罩手機、申請改期、確認取消、24 小時截止、失效連結及同頁切換。載入失敗可重試，全形連字號手機可正規化。
- Node 22.23.2 隔離驗證：180 backend 真 PostgreSQL tests、140 web tests、48 admin tests、web typecheck、API 契約、admin build、production/live Nuxt build 通過。重建候選只多正式 gzip 修正一檔；逐檔 hash 確認 backend/admin/contracts 不變，沿用本輪已通過的後端與後台結果，重跑 web 型別／測試／build。
- 線上 36 項公開檢查通過：release、production/live API、已發布 CMS、首頁／五校／報名／管理／後台入口、後台 assets SHA-256、五校預約設定、robots、404、匿名 401 與隱私標頭。透過 SSH 唯讀核對 API 四個修復檔 SHA-256，與快照一致；`/data/media` owner/group/mode 為 `10001:10001:750`。
- Chrome 15 項線上檢查通過：1440／390／320px 管理頁、失效連結、無水平溢出、電話正規化；同分頁連結交換 401 與 Secure/HttpOnly 清除 cookie；瀏覽器注入 502 後顯示重試並恢復。0 runtime／hydration error，已檢視正式手機截圖。除不存在的測試 token 交換外，瀏覽器阻擋 API POST，沒有建立正式報名。完整送單／改期／取消先前已在獨立本機 PostgreSQL 驗證；Safari／iOS 實機未驗證。
- 證據 `output/railway-visit-repair-20260923-145157/`：summary、manifest、approved.patch、build-results/logs、rebase-notes、pre-upload-api/web、upload-api/web、api/web-success、api-source-verification、smoke-public、browser-online、final-verification。
- 後續手動部署須以本次線上快照為基底；推 main 前須先併回本次 20 檔差異，避免 CI 覆蓋尚未提交的報名修復。回復參考：API `1c85e5ae-73aa-423d-a26f-7c251ad9e390`、web `2b48f1e1-2488-42c1-85ae-437be348b504`。

## 2026-09-23 首屏拿掉按鈕、文字上移、小標 fixture（main CI 部署）

- 使用者要求部署。推前確認線上 `base_commit` == `origin/main`（`1f805e2`，無未併回手動快照）。feature 上只暫存首屏相關段落提交 `8adebfb`（同檔其他 session 的改動與 `?copy=` 預覽不帶），在 `origin/main` worktree cherry-pick 為 `5d41836`；`studio.css` 衝突保留 main 的底線擦出動畫、不帶回 `hero-draw`。`push ...:main` 被 auto 模式擋下，由使用者執行。
- CI run `35834805983` 四個 job 全綠（7m8s）。`/release.json`：snapshot `e5bac3d922249fd1240b468f68ebbc3947b2fb423c6ae69bf4d3120bce3ef5ea`、`base_commit` `5d41836`、`web+api`。
- 線上 Chrome 檢查（`output/hero-copy-20260923/verify-prod.cjs`）：1440×900 首屏 0 顆按鈕、眉標 y 286、文字塊中心 440；390px「找校區」顯示；無水平溢出、無 page error。截圖 `prod-d1440.png`／`prod-m390.png`。
- 正式站小標仍是「常春藤幼兒園 · 高雄五校」：取自已發布的 CMS，需到後台「首頁主視覺」改為「常春藤幼兒園 · 陪高雄孩子近三十年」再發布；本次只改 fixture，未動 CMS。

## 2026-09-23 開場首屏遮罩改用新版布幕海報（main CI 部署）

- 使用者要求提交並推 main。feature 提交 `35e3dcf`（README 只暫存自己那段；另一 session 的 Google OAuth 段落未帶），在 `origin/main`（`f454f39`，當時線上同 sha）worktree cherry-pick 為 `059363b`，無衝突、改動與原 commit 一致；worktree 內 Node 22 `vitest` 21 檔 163 項、`nuxt typecheck` 0 錯誤。`push ...:main` 被 auto 模式擋，由使用者執行。
- CI run `35839445777` 四個 job 全綠。`/release.json`：snapshot `997432e772890f0ace58d225601977807aa0117b5f43d14ca09038e7f01906cc`、`base_commit` `059363b`、`web+api`。五張 `entrance-poster-*.webp` 皆 200 `image/webp`。
- 線上檢查（`output/entrance-poster-20260923/`）：1440×900 首屏 0.4 秒即新版深紅帷幔海報（`before-prod-1440.png` 為修正前的舊條紋），接校徽、倒數正常；計時腳本 `timing.cjs` 手機 390×844×3 與桌機各數次皆進入播放（0.85～1.9 秒），擋掉海報與否無差異。手機逐格截圖在本機會拖慢主執行緒導致開場被放棄，屬量測誤差。
- 推送當下另有 Google OAuth 手動快照部署在準備（`output/railway-google-oauth-20260923-164133/`，基底 `3b496ff`），其 rollout 會比對線上 release 後中止，需以 `059363b` 為基底重建；OAuth 改動尚未進 git，之後推 main 會蓋掉。

## 2026-09-23 首頁最新消息 C「原地換片」自動輪播（main CI 部署）

- 使用者要求提交後部署。feature 提交 `8c834ee`（`README.md`／`DESIGN.md`／`studio.css` 只暫存自己那幾段，其他 session 的頁首膠囊、手機首訪等未提交改動未帶），在 `origin/main`（`a273915`）worktree cherry-pick 為 `c461429`，無衝突、改動與原 commit 一致；worktree 內 Node 22 `nuxt typecheck` 0 錯誤、`vitest` 22 檔 166 項、`nuxt build` 成功。
- 推前等另一 session 的預約頁 CI（run `35864979739`）部署完，確認線上 `base_commit` == `origin/main` == `a273915`、無新的手動快照上傳。`push ...:main` 被 auto 模式擋，由使用者執行。
- CI run `35867868942` 四個 job 全綠（10 分鐘）。`/release.json`：snapshot `d8dbdc7d7ee434dcb65146d38655099b65a47393e13626563b8f3f39193748fc`、`base_commit` `c461429`。正式 CMS 已發布 6 則消息，輪播有啟動。
- 線上 Playwright（`output/news-carousel-c-site/verify-prod.cjs`、`verify-prod-focus.cjs`）：1440／1024 由第一組換到第二組、倒數 01→02；滑鼠停 8 秒不換、對話框開著暫停；滑鼠關對話框後換組焦點交給新標題；390px 與減少動態 8.5 秒不換、倒數不顯示；無水平溢出、0 console error。截圖 `output/news-carousel-c-site/prod/`。Safari／iOS 實機未驗證。

## 2026-09-23 手機首訪布幕與影片、手機內頁膠囊頁首（main CI 部署）

- 使用者要求提交、推 feature 後部署。feature 提交 `d2fda6e`（布幕資源預載、無損 WebP 投影貼圖、首屏影片讓路、手機影片 CRF 26）與 `a9aff42`（手機內頁膠囊頁首、選單鎖捲動、預約頁藏預約鈕、小字 14px、theme-color）；`README.md`／`DESIGN.md`／`styles.css` 只暫存自己那幾段。在 `origin/main`（`c461429`，線上同 sha）worktree cherry-pick 為 `892d091`、`bfd7c5c`，無衝突、變更行與原 commit 完全相同；worktree 內 Node 22 `nuxt typecheck` 0 錯誤、`vitest` 22 檔 169 項、`nuxt build` 通過。
- 推送當下另一 session 的 `deploy/flip-wind-corner-20260923`（`1f463e8`）尚未推；另備疊在其上的分支（README 衝突已解、180 項測試通過），由推送指令依 `origin/main` 自動選擇。實際 main 仍為 `c461429`，推的是 `bfd7c5c`；拍立得那支之後推送需 rebase，README 會衝突。`push ...:main` 由使用者執行。
- CI run `35869678705` 四個 job 全綠，約 7 分鐘上線。`/release.json`：snapshot `2c627ae4a3beaeab7ef490bf3b0bfba6586fd561b4488ced0806984c677671fe`、`base_commit` `bfd7c5c`、`web+api`。
- 線上檢查（`output/playwright/mobile-audit-20260923/prod-smoke.cjs`、`waterfall.cjs`）：`theme-color` `#fdfcf6`、手機首屏影片 `hero-mobile-ba791e4aa97c.mp4`；390 分校頁／預約頁捲動後收成膠囊、選單開啟 `menu-locked` 且捲動位置不動、Esc 解鎖，預約頁頁首與膠囊皆無預約鈕。一般 4G（9 Mbps）首訪 3 次布幕皆開演（1.49～1.55 秒就緒；部署前 0 次），投影貼圖 1.6 秒內到齊，首屏影片布幕開演後才載。Safari／iOS 實機未驗證。
