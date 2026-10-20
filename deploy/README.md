# Railway 官網部署

此專案與園務系統完全分離，使用獨立 PostgreSQL。

GitHub Actions 的 `main` 分支 CI/CD 設定與啟用步驟見 [CICD.md](./CICD.md)。2026-09 的部署紀錄（60 段）在 [docs/changelog/deploy-2026-09.md](../docs/changelog/deploy-2026-09.md)；之後每到新的月份，把上個月的日期段落移過去，參考章節（環境變數、初始化、公開資料同步等）留在本檔。`main` push 通過 CI 後會自動正式部署；下方保留手動部署與歷次快照紀錄。

Google OAuth 的 API 變數、公開 callback、管理員資格及 migration 順序見 [google-oauth.md](./google-oauth.md)。2026-09-24 起 API 每次啟動會自動 `alembic upgrade head`，合併進 `main` 的 migration 會在部署時套到正式 DB；撰寫規則與失敗行為見 [CICD.md](./CICD.md)。刪除或改寫既有資料的 migration，合併前仍要先手動備份。

- Railway project：`d606df61-445a-4e65-9c5f-7e94a0766572`（ivy-website-admin）
- environment：`cf5631c7-05b9-4f16-9358-c81d2650eb55`（production）
- web：`e0851ec5-3bc0-4b5c-9471-9d9131616c26`，`deploy/web.Dockerfile`
- api：`9124b9c0-4ddf-4445-bd2f-798b277f44ec`，`deploy/api.Dockerfile`
- 官網：<https://web-production-04caa.up.railway.app/>
- 後台：<https://web-production-04caa.up.railway.app/admin/>

## 2026-10-20 招生潛力第二、三波：停辦釋出、現有的里、新建案（main CI 部署，沒有 migration）

- **提交**：使用者要求部署，使用者自己執行 `git push origin HEAD:main`（`3358c0a0..8f5a7a0c`，fast-forward、沒有開 PR；第一次推送因另一個 session 剛推部署紀錄被拒，rebase 後重推）。分支 `feature/admissions-potential2-20261020` 33 個提交：停辦回補檔延伸到 2022-08（`kindergarten-closures-20261020.csv`，94 筆；移除 10-15 檔）、同步時補寫回補停辦事件、異動保留 24 → 72 個月、`backend/app/admissions/potential.py` 三個來源、`GET /admin/admissions/potential` 多 `potential`、後台卡片／來源表／停辦標記。規格 §11。沒有 migration、沒有新環境變數，沒有先備份（只新增停辦園所列與事件，不改寫既有資料）。
- **回退**：直接切回上一版映像。舊映像保留 24 個月，下一輪幼兒園同步會清掉 24 個月前的回補事件；再切回新映像會由回補檔補回。
- **推送前閘門**（本機，Node 22，worktree `admissions-potential2-20261020`）：後端全套 4518 passed／1 skipped（獨立庫 `ivy_website_test_potential2`）；admin 全套 184 檔 3098 passed／1 skipped（另兩次全套各有 3 個與本分支無關的招生入學頁測試在機器負載 38 時逾時，單獨重跑 66 passed）、typecheck 通過；契約一致；stack 用獨立庫 `ivy_website_e2e_test_potential2`、埠 8732／3732，全套 155 passed。rebase 到 `3358c0a0` 後聚焦測試 294 passed、admin potential 92 passed、契約一致。
- **CI**：main run 39401354610（`8f5a7a0c`），Frontend web／admin、Backend 三組、E2E／Playwright、Deploy Railway production 全部 success。
- **正式 `release.json`**：base commit `8f5a7a0cc2786a01490ee00a140eb48e0164b2d6`，snapshot `b927e019…`，created `2026-10-20T09:39:34Z`。`/api/website/v1/health` `status: ok`、`last_failed_steps` 為空。
- **部署後**：剛部署時來源一是 0（回補事件只在幼兒園名單同步時寫入，正式站每 7 天一輪）。使用者用 `!` 跑 `railway ssh … --service api -- python -m app.cli geo-sync --force`：門牌 ConnectTimeout（已知，高雄市資料平台擋境外 IP）、幼兒園評鑑 ConnectTimeout，總結行沒印出、結束碼 255；但幼兒園名單那一步已完成並補寫停辦事件。
- **線上檢查**（使用者已登入的瀏覽器，義華）：市佔率 1.93%；每年還能多招約 24 位（8～63），目前空位 18 位；附近園所停辦釋出 5／19／55（和本機驗證一致）、現有的里還沒招到 3／4／7（報告 B-11 是 1.2／5.2／11.3）、新建案搬進來 1／1／1；走勢圖 112–115 學年有停辦標記。
- **未驗證**：評鑑 ConnectTimeout 是偶發還是被擋（下一輪自動同步再看系統狀態）；手機實機畫面。

## 2026-10-20 首屏影片與封面調亮（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `feature/hero-brighten-20261020` 到 main（`87ec0d95..1c0475eb`，fast-forward、沒有開 PR）。內容見 README 與 DESIGN.md 同日「首屏影片調亮」：從園方原片重做首屏影片，壓縮前加白色 soft-light 亮度曲線（強度 .6）＋色度 ×1.06；首屏封面與消息「一起跑向前」封面套同一條曲線。影片雜湊網址換成 `hero-desktop-a29a608cdd4d.mp4`（5,434,804 bytes）／`hero-mobile-01773132b829.mp4`（2,152,348 bytes），封面衍生圖換成 `-d4f9f61b23bf-*`，舊檔刪除。重製腳本與說明在 `design/hero-video-grade-20261020/`。沒有 migration、沒有新環境變數、依賴檔沒有變動、遮罩與版面沒改。
- **回退**：直接切回上一版映像即可（純前端素材）。
- **推送前閘門**（本機，Node 22，分支從 main `87ec0d95` 開）：web typecheck 0 錯、vitest 108 檔 1,321 passed；dev server（fixture）Chrome 1440／1280／1024／390 截圖版面與文字位置前後相同、桌機與手機都播到新檔；12 幀＋封面離線量白字對比最差 4.67（原 4.66）、新爆白 0%。只換素材，本機 stack e2e 沒跑。
- **CI**：main run 39398513281（`1c0475eb`）09:08:38Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 09:16:00Z–09:22:48Z success。
- **正式 `release.json`**：base commit `1c0475ebdc0678c533d1ffad9e21757a6157efb1`，snapshot `d6e71916…`，created `2026-10-20T09:16:23Z`。
- **線上唯讀檢查**（擋掉 POST 與遙測）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；兩支新影片、封面（母檔與 1080w）、活動影片封面、分享圖都回 200 且大小與本機相同，舊 `hero-desktop-7dd03551eb53.mp4` 回 404；首頁 1440 播 `hero-desktop-a29a608cdd4d.mp4`、封面 `-d4f9f61b23bf-1080.webp`，390 播 `hero-mobile-01773132b829.mp4`、封面 `-800.webp`，沒有頁面錯誤與 hydration 警告。headless 要覆寫 `navigator.connection`（它估的頻寬 1.75 Mbps 會讓首屏只留封面）。
- **未驗證**：Safari、Firefox、iOS 實機（只換素材，沒有新的瀏覽器特效）。

## 2026-10-20 招生統計新分頁「招生潛力與市佔率」第一波（main CI 部署，1 支 migration）

- **提交**：使用者要求部署，使用者自己執行 `git push origin HEAD:main`（`dfd0a195..4c90ef58`，fast-forward、沒有開 PR）。分支 `feature/admissions-potential-20261020`，24 個提交：規格與計畫、三張新表、目標執行統計表解析與 extract／import 指令、每年九月底人口（舊里代碼換碼、九月補漏）、國小一年級人數同步、市佔率與國小對帳服務、`GET /admin/admissions/potential`、後台新子分頁與總審查修正。規格 `docs/specs/2026-10-20-admissions-potential-share-design.md`（§10 實作紀錄）。migration `76c4bf84b907`（接 `a6c2e9f4b8d1`）只新增 `campus_term_enrollment`、`geo_village_ages_september`、`geo_elementary_grade1` 三張表並讓 `ck_geo_dataset_status_dataset` 多收 `elementary`，沒有先備份。沒有新環境變數（`WEBSITE_GEO_ELEMENTARY_URL_TEMPLATE` 有預設值）。
- **回退**：切回上一版映像前先 `alembic downgrade a6c2e9f4b8d1`（刪 `elementary` 狀態列、還原約束、刪三張表；歷年註冊與兩種公開資料要重新匯入）。
- **推送前閘門**（本機，Node 22，worktree `admissions-potential-20261020`）：後端全套 4307 passed／1 skipped（11 分 10 秒，獨立庫 `ivy_website_test_potential`）；admin 全套 183 檔 3042 passed／1 skipped、typecheck 通過；契約一致；stack 用獨立庫 `ivy_website_e2e_test_potential`、埠 8731／3731，`e2e:build` 後全套 155 passed（5.5 分鐘）。
- **CI**：main run 39374305069（`4c90ef58`），Frontend web／admin、Backend 三組、E2E／Playwright、Deploy Railway production 全部 success。
- **正式 `release.json`**：base commit `4c90ef58d924706533c45dada9aa68c090902534`，snapshot `69fe5a94…`，created `2026-10-20T05:27:23Z`。
- **部署後匯入**：agent 用 `railway volume … upload` 上傳 18 個檔到 api volume（歷年註冊 JSON 1、九月底人口 `september-10709-1.json`～`september-11509-1.json` 9、國小 `107_basec.csv`～`114_basec.csv` 8）；使用者用 `!` 跑 `geo-sync --september-file …×9 --elementary-file …×8` → 「九月底人口：updated（這次寫入 9 年）；國小一年級人數：updated（最新 114 學年，這次寫入 8 學年）」；`enrollment-history-import --file /data/enrollment-history-yihua-20261020.json` → 「匯入 yihua：132 列（99上～115上）」加 3 條總人數注意（104下、105上、114下）。歷年註冊 JSON 是本機 extract 產生（原始 xls 沒上傳）。
- **線上檢查**：`/api/website/v1/health` `status: ok`、`last_failed_steps` 為空；未登入 `GET /admin/admissions/potential?campus_key=yihua` 回 401；使用者已登入的瀏覽器開義華新分頁：115 學年市佔率 1.93%（189 ÷ 9,788 位）、歷年最高 1.94%（108 學年）、走勢 107～115 學年、國小對帳 29 所 3,869 位、比值 0.94（歷年 0.92–0.98），和本機驗證一致。
- **未驗證**：Railway 自動同步連不連得到 `stats.moe.gov.tw`（下一學年才會抓）；手機實機畫面。volume 上 18 個匯入檔待使用者刪。

## 2026-10-20 資安與 bug 稽核 14 條修正（main CI 部署，1 支 migration）

- **提交**：使用者要求部署，使用者自己執行 `git push origin HEAD:main`（`ba1030b5..c8424306`，fast-forward、沒有開 PR）。五個提交：`998fab53` 預約與通知、`fb40c86e` 認證／招生／個資清理、`e96ada04` 素材、`f8d9210b` 官網、`c8424306` README。內容見 README 同日一節。migration `a6c2e9f4b8d1`（`media_variants.size_bytes`，接 `b8e2d6a4f931`）只加可為空的欄位、不回填，沒有先備份。沒有新環境變數。
- **回退**：切回上一版映像前先 `alembic downgrade b8e2d6a4f931`（只刪 `size_bytes` 欄位）。
- **推送前閘門**（本機，Node 22，worktree `audit-fixes-20261020`）：後端全套 4062 passed／1 skipped（9 分 4 秒，獨立庫 `ivy_website_auditfix_test`）；admin 全套 3002 passed、typecheck 與 build 通過；web 全套 1321 passed、typecheck 與 build 通過；契約一致；`check_schema.py` 通過；`deploy/tests` 22 項 OK；stack 用獨立庫 `ivy_website_e2e_auditfix_test`、埠 8731／3731，全套 155 passed（5.8 分鐘）。
- **CI**：main run 39370492539（`c8424306`），Frontend web／admin、Backend 三組、E2E／Playwright、Deploy Railway production 全部 success。
- **正式 `release.json`**：base commit `c84243061974dbf14164fd633ca777c3824d4489`，snapshot `328cde23…`，created `2026-10-20T04:44:00Z`。
- **線上唯讀檢查**：`/api/website/v1/health` `status: ok`、`fixture_enabled: false`；`/`、`/visit` 200；義華 `GET /public/slots` 從今天查到 365 天後回 200（伺服器截到開放範圍，82 場）；未登入 `POST /admin/retention/run` 回 401；後台 `PoliciesView` chunk 含新的版本衝突文案。
- **未驗證**：登入後的畫面、停課日家長信實際寄送、轉檔配額（要等下一支影片上傳）、場次使用情況上限是否影響真實統計。

## 2026-10-20 場次使用情況小修＋預售建案＋附近幼兒園裁罰與評鑑（main CI 部署，2 支 migration）

- **提交**：agent 經使用者同意推 `feature/admissions-data-20261020` 到 main（`817d516d..a5ac4998`，fast-forward、沒有開 PR）。內容：場次使用情況審查延後 8 條＋手機判讀欄提前、預約設定／場次列表控制字元回 500 修正；預售建案（規格 `docs/specs/2026-10-20-admissions-presale-design.md`）；附近幼兒園裁罰明細與評鑑（`docs/specs/2026-10-20-peer-penalties-evaluations-design.md`）。migration `a3d7f1c9b5e2`（預售兩張表）→ `b8e2d6a4f931`（裁罰、評鑑兩張表；`geo_dataset_status.dataset` 放寬到 32 字），只新增、不改寫既有資料，沒有先備份。沒有新環境變數；新增評鑑用的公開中繼憑證 `backend/app/admissions/geo/certs/twca-secure-ssl-2023g3.pem`（到期 2030-10-16）。
- **回退**：切回上一版映像前先 `alembic downgrade d4a8f2c6e913`（四張新表與 dataset 約束會刪掉，都是公開資料、可重抓）。
- **推送前閘門**（本機，Node 22，從 main `817d516d` 開的 worktree）：後端全套 4019 passed／1 skipped（8 分 55 秒，獨立庫 `ivy_website_admdata1020_test`）；admin 全套 2988 passed／1 skipped、typecheck 0 錯；契約 `export_openapi.py --check`＋`check-contract-types.mjs` 一致；stack 用獨立庫 `ivy_website_e2e_admdata1020_test`、埠 8761／3761，`e2e:build` 後全套 155 passed（6.3 分鐘）。
- **CI**：main run 39361821538（`a5ac4998`）02:58:43Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright、Deploy Railway production 全部 success。
- **正式 `release.json`**：base commit `a5ac499826cc262bcb7c47e9d175d14eb1acc7ee`，snapshot `15dce4bd…`，created `2026-10-20T03:05:10Z`。
- **線上唯讀檢查**：`/api/website/v1/health` `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空（背景工作 03:13:30Z 跑完一輪）；未登入 `GET /admin/admissions/area/presale`、`/admin/admissions/area/kindergartens/<id>/records` 回 401。
- **地號座標**：使用者 10-20 在本機跑 `fetch_presale_parcels.py`（649 地號，646 有座標）；661 案 655 案（99.1%）可點入里。檔案在 worktree `output/presale/presale_parcels.csv`（gitignored），要上傳 api volume 後 `geo-sync --presale-parcels-file` 匯入（見下方「預售建案」段）。
- **部署後匯入（使用者用 `!` 跑）**：地號座標 `geo-sync --presale-parcels-file` → 匯入 654 列、預售建案重比改變 655 案；裁罰正式站自動同步已寫入（標籤 2026-10-20），評鑑仍「尚未匯入」。本機 `fetch_geo_bundle.py --kindergarten-only`（裁罰 571 筆／238 檔、評鑑 689 所／69 頁／1556 筆，換頁在真站正常）→ `geo-sync --bundle` → 裁罰 updated 534 筆、評鑑 updated 1556 筆。
- **未驗證**：正式站評鑑自動同步為什麼沒寫入（看後台「系統狀態」該列 `last_error`；可能是 TLS、限時或還沒輪到）；GitHub API 在 Railway 會不會被限流；登入後的畫面。volume 上的 `/presale_parcels.csv`、`/geo-bundle-kindergartens.zip` 待使用者刪。

## 2026-10-19 關於頁手機版改成上翻畫冊（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `feature/about-mobile-flipbook-20261019` 到 main（`89b0f65b..72a6064c`，fast-forward、沒有開 PR）。內容見 README 與 DESIGN.md 同日「關於頁手機版：上翻畫冊」：900px 以下 `/about` 換成頂端線圈裝訂的畫冊（`AboutFlipBook.vue`、`AboutFlipMap.vue`、`about-flipbook.css`、`utils/about-flipbook.ts`），第一章五校改成高雄立體地圖（`scripts/build-about-map.mjs` → `web/app/generated/about-map.ts`）；桌機立體書包在 `.abk`、`about-popup` 只在 901px 以上建立。沒有 migration、沒有新環境變數、依賴檔沒有變動。
- **回退**：直接切回上一版映像即可（純前端）。
- **推送前閘門**（本機，Node 22，分支從 main `89b0f65b` 開）：web typecheck 0 錯、vitest 106 檔 1,313 passed、`nuxt build` 通過；stack 用獨立庫 `ivy_website_e2e_flipbook_test`、埠 8710／3710，`e2e:build` 後全套 155 passed（6.1 分鐘），測試庫跑完已刪；dev server 與 build 產物（fixture）Playwright 多尺寸、axe 0 項、CLS 0、`page-copy-stress.cjs /about` 通過。
- **CI**：main run 39210993053（`72a6064c`）06:37:32Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 06:43:01Z–06:49:14Z success。
- **正式 `release.json`**：base commit `72a6064ce6140dbc5bd5984d5609f2331999e996`，snapshot `cff8c65a…`，created `2026-10-19T06:43:39Z`。
- **線上唯讀檢查**（擋掉 POST 與遙測）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；`/about` 390×844 與 375×667 畫冊整本釘住（`.afb[data-fit]=pinned`、14 頁），封面、五校地圖（房子一頁多一間、虛線、紀念章一頁翻一年）、六圈、蠟筆畫、家長、封底書籤都正常；1440 立體書照舊（`is-live`）、畫冊隱藏；三個尺寸都沒有頁面錯誤、hydration 警告與橫向捲動。
- **未驗證**：Safari、Firefox、iOS 實機（3D 翻頁、`backface-visibility`、`scroll-snap` 與 sticky、`svh`）。

## 2026-10-19 常春藤環境頁加蠟筆塗鴉（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `feature/environment-doodles-20261019` 到 main（`52e99730..140b52ad`，fast-forward、沒有開 PR）。內容見 README 與 DESIGN.md 同日「常春藤環境頁加蠟筆塗鴉」：`/environment` 九個蠟筆塗鴉（aria-hidden、不可聚焦，手繪層畫完才動態載入 `utils/environment-doodles.ts`）、第四章校舍塗色（新增 `web/public/assets/tour-paint-<校>(-roof).png` 十張，由 `scripts/environment-tour-paint.py` 產生）、03 太陽改塗橘黃。沒有 migration、沒有新環境變數、依賴檔沒有變動。
- **回退**：直接切回上一版映像即可（純前端加靜態遮罩圖）。
- **推送前閘門**（本機，Node 22，分支從 main `52e99730` 開）：web typecheck 0 錯、vitest 105 檔 1,297 passed；stack 用獨立庫 `ivy_website_doodles1019_e2e_test`、埠 8761／3761，`e2e:build` 後全套 155 passed（7.0 分鐘），測試庫跑完已刪；dev server（fixture）Playwright 1440／390／減少動態都畫出九個塗鴉、沒有 console 錯誤與 hydration 警告。
- **CI**：main run 39202462786（`140b52ad`）05:02:13Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 05:08:35Z–05:13:49Z success。
- **正式 `release.json`**：base commit `140b52adf81b89b0898cc319faaa4b1ec3507df5`，snapshot `7f56925b…`，created `2026-10-19T05:08:59Z`。
- **線上唯讀檢查**（擋掉 POST 與遙測）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；`/environment` 1440 與 390 九個塗鴉都畫出、選中的義華校舍塗上兩層、`/assets/tour-paint-yihua.png`／`-roof.png` 回 200、塗鴉不可聚焦，沒有頁面錯誤或 hydration 警告。
- **未驗證**：Safari、Firefox、iOS 實機（SVG 濾鏡、CSS `mask`）。

## 2026-10-19 入學頁拿掉訂位金 5,000 元（main CI 部署，沒有 migration）

- **提交**：agent 經使用者同意，把 `fix/admission-deposit-20261019` 推到 main（`7efc441a..ba4f9033`，fast-forward、沒有開 PR）。內容見 README 頂部「入學頁拿掉訂位金 5,000 元」：只改 `web/server/data/site-fixture.json` 入學流程第 3 格一句文案（改成「跟園所確認，就幫寶貝留下名額。」）和兩份 overlay 測試資料。沒有 migration、沒有新環境變數、依賴檔沒有變動。
- **回退**：直接切回上一版映像即可（只差 fixture 文案）。
- **推送前閘門**（本機，Node 22，獨立測試庫 `ivy_website_test_deposit1019`，跑完已刪）：web typecheck 0 錯、vitest 103 檔 1,272 passed；後端 `test_admission_content.py` 16 passed；dev server（fixture）1440／390 Playwright 看第 3 格。stack 沒跑：涵蓋 `/admission` 的只有 a11y／keyboard／hydration，不比對文字，視覺基準只有後台頁。
- **CI**：main run 39192194259（`ba4f9033`）02:55:03Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 03:01:58Z–03:09:51Z success。
- **正式 `release.json`**：base commit `ba4f9033f6b35708fdd08adc2a213c62dc6064e9`，snapshot `a557dc8c…`，created `2026-10-19T03:02:20Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；`/admission` HTML 裡「訂位金」0 次，新句出現。
- **待園方**：同頁第 1 格「以電話或親友介紹，確認名額並預約參觀時間。」和線上預約矛盾，這次沒動。

## 2026-10-17 首頁近期活動與最新消息改版（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `feature/news-next-20261017` 到 main（`4a2d4912..2668f61a`，fast-forward、沒有開 PR；分支先 rebase 到 `4a2d4912`，沒有衝突）。內容見 README 與 DESIGN.md 同日「首頁近期活動與最新消息」：桌機方向 1（活動放大、加入行事曆、校區篩選、不輪播）、手機方向 3（動態卡列取代活動影片色帶），這一區不放參觀入口；後台只改文案。
- **回退**：直接切回上一版映像即可（純前端加後台文案）。
- **推送前閘門**（本機，Node 22，rebase 後的 `2668f61a`，stack 用獨立庫 `ivy_website_news_e2e_test`、預設埠 8710／3710）：`e2e:build` 後 stack 全套 155 passed（5.9 分鐘）；web typecheck 0 錯、vitest 103 檔 1,272 passed；admin typecheck 0 錯、vitest 整套 3 項招生測試在本機負載 43 時逾時，兩檔單獨重跑 66 passed。
- **CI**：main run 38988742565（`2668f61a`）00:57:38Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 01:03:21Z–01:07:43Z success。
- **正式 `release.json`**：base commit `2668f61ab73da82c37e76c43dec924bc51557b7e`，snapshot `6ea1692b…`，created `2026-10-17T01:03:43Z`。
- **線上唯讀檢查**（擋掉 POST 與遙測）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`；首頁 1440 顯示新版兩欄（活動卡、六個校區篩選、一大三列、沒有輪播倒數），390 顯示動態卡列 12 張與六個校區圈，點卡片打開全螢幕檢視；兩個尺寸都沒有頁面錯誤或 hydration 警告。
- **正式內容現況**：後台示意說明欄仍有值，所以照樣標「示意內容」，唯一的活動（10/17）顯示「日期未定」、沒有倒數與加入行事曆；10/18 起這個活動過期，桌機左欄不出現、消息改整寬。清空示意說明欄、填真實活動後才會看到倒數與加入行事曆。

## 2026-10-17 區域分析改成地圖工作台（main CI 部署，沒有 migration）

- **提交**：agent 經使用者同意，把 `feature/area-workbench-20261016` 推到 main（`60a9684c..6bf64d1c`，fast-forward、沒有開 PR）。分支先併入 main（merge `6bf64d1c`，只有 README 衝突、兩段都保留）。內容見 README「區域分析改成地圖工作台」與規格 `docs/specs/2026-10-16-admissions-area-workbench-design.md`：只改後台前端（`admin/src` 區域分析元件、`useAdmissionsFilters` 的 `map`／`village`／`table` 網址參數）與 stack e2e。沒有 migration、沒有後端或 API 改動、沒有新環境變數；admin 依賴檔沒變（web／backend 的鎖檔變動來自併入的 main）。
- **回退**：直接切回上一版映像即可（純前端）。網址多出的 `map=`／`village=`／`table=` 在舊版會被當成認不得的參數拿掉，不影響其他頁。
- **推送前閘門**（本機，Node 22，合併後的 `6bf64d1c`，stack 用獨立庫 `ivy_website_workbench1017_e2e_test`、埠 8731／3731）：admin typecheck 0 錯；`e2e:build` 後 stack 全套 155 passed（5.9 分鐘）；web vitest 103 檔 1,258 passed；admin vitest 174／175 檔、2,925 passed、1 skipped，唯一失敗是 `admissionsView` (h) 的 5 秒逾時（當時別的 session 在跑 pytest，load 10→91；和基準 `d196036b` 交替比較耗時沒有差別，單獨跑會過）。後端 pytest 本機沒跑（後端沒改，交給 CI）。
- **CI**：main run 38985934548（`6bf64d1c`）00:20:43Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success（admin 那支在 CI 上也過了），Deploy Railway production 00:26:11Z–00:30:25Z success。
- **正式 `release.json`**：base commit `6bf64d1ca067c6649d385c3ec853a554303f2498`，snapshot `3fddaa16…`，created `2026-10-17T00:26:32Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；`/api/website/v1/admin/admissions/area?campus_key=yihua` 回 401。
- **待使用者**：登入正式後台看 `/admin/admissions-stats?campus=yihua&sub=area`（在籍學生點、里卡片、六個表格分頁；本機只拍測試庫）；「近 12 個月全範圍淨遷入」那句新版沒有顯示，要不要放回待決定。

## 2026-10-17 入學頁拿掉過時的補助券（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `fix/admission-subsidy-20261017` 到 main（`9db0fe48..877c9453`，fast-forward、沒有開 PR）。內容見 README 頂部「入學頁拿掉過時的補助券」：只改 `web/server/data/site-fixture.json` 的入學頁文案（清空三張補助券、收退費說明拿掉「補助款撥到園再轉發」）和對應的測試資料。沒有 migration、沒有新環境變數、依賴檔沒有變動。
- **回退**：直接切回上一版映像即可（只差 fixture 文案）。
- **推送前閘門**（本機，Node 22，獨立測試庫 `ivy_website_admsub_test`／`_e2e_test`，跑完已刪）：讀 fixture 的後端測試 272 passed；web typecheck 0 錯、vitest 103 檔 1,258 passed；`e2e:build` 後 stack 的 `hydration`、`a11y`、`keyboard` 三支（涵蓋 `/admission`）49 passed，stack 全套沒跑。
- **CI**：main run 38983323139（`877c9453`）23:48:21Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 23:54:25Z–23:58:38Z success。
- **正式 `release.json`**：base commit `877c9453b50b26c3836c39b945bc63d6cf3cbfb5`，snapshot `b7cc7b2e…`，created `2026-10-16T23:54:47Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；`/admission` 回 200，HTML 裡「教育部補助」「15,000」「高雄市政府補助」「特殊家庭」「撥款到園」「補助券」「政府補助」都是 0 次、`ap-coupon` 0 個；「私立幼兒園 2–6 歲育兒津貼」表、新的收退費說明、退費規定都在。
- **待使用者／園方**：同頁「預先繳交訂位金 5,000 元」超過「高雄市教保服務機構收退費辦法」預收學費 1,500 元上限，這次沒動。

## 2026-10-17 後台第 3 波：預約表單預計入學時間＋預約案件排除標記（main CI 部署，migration 只新增）

- **提交**：使用者在本機推 `feature/admin-wave3-20261015` 到 main，兩次都是 fast-forward、沒有開 PR。內容見 README 頂部「預約表單預計入學時間、預約案件排除標記」、DESIGN.md 同名兩節、規格 `docs/specs/2026-10-15-visit-expected-start-design.md`、`docs/specs/2026-10-15-visit-exclusion-design.md`（各有 §7 實作紀錄）。
  - 第一次 `f80c304c..df8cf21c`（10-16 15:39Z）：run 38925681075 的 Frontend (web) 紅，Deploy 被跳過，正式站留在 `f411c53a`。原因是第 3 波新增的 `web/tests/visit-expected-start-manage.spec.ts` import `@vue/test-utils`，main 同一天在 `fecb3b33` 已把它從 web 依賴拿掉；worktree 的 `web/node_modules` 還留著舊套件，所以本機全套是綠的。
  - 第二次 `df8cf21c..718a127b`：`718a127b` 把那支測試改成 `createApp` 掛載（斷言不變，突變驗證過），web 重新 `npm ci` 後全套 103 檔通過。
- **migration**：`b7e3c1a9d5f2`（接 `5c8e1f3a9d27` 第 2 波退出原因分類）在 `visit_requests` 加可空欄位 `expected_start` 與格式 CHECK；`d4a8f2c6e913` 加 `excluded_at`、`excluded_by`（→ users，SET NULL）、`exclude_reason`、`exclude_note` 與兩條 CHECK。只加可空欄位，升級不改既有資料，所以沒有備份。沒有新環境變數；依賴檔沒有變動。
- **回退**：舊映像不認得 `d4a8f2c6e913`，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade 5c8e1f3a9d27`（預計入學時間與排除標記的欄位會一起刪掉），再切舊映像。
- **推送前閘門**（本機，Node 22，獨立測試庫 `ivy_website_wave3_1015_test`／`_e2e_test`）：`707951e2` 後端全套 3,736 passed／1 skipped、admin vitest 168 檔 2,704 passed／1 skipped、web vitest 103 檔 1,258 passed、admin 與 web typecheck 無錯誤、契約 `--check` 兩項一致、stack 全套 151 passed（視覺基準不用更新）；alembic 單一 head `d4a8f2c6e913`。之後 `a2db0f98` 重跑排除相關的後端 54 項與 admin 24 項；`718a127b` web 重新 `npm ci` 後全套 1,258 passed、typecheck 0 錯。
- **CI**：main run 38978661677（`718a127b`）22:56:23Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 23:01:48Z–23:06:29Z success，E2E 23:07:26Z 結束。
- **正式 `release.json`**：base commit `718a127b8dedf9ec8bc726c0f3332eff1714ebfa`，snapshot `6252e220…`，created `2026-10-16T23:02:14Z`。
- **線上唯讀檢查**（未登入，2026-10-16T23:08Z）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空（`last_completed_at` 23:07:17Z；API 有起來代表 schema 已到 `d4a8f2c6e913`）；首頁、`/admin/`、`/visit`、`/visit/manage` 都回 200；`POST /admin/visit-requests/{id}/exclude` 與 `GET /admin/visit-requests?excluded=hide` 未登入回 401；官網 `/visit` 的 chunk 有「預計入學時間」；後台 lazy chunk 裡 `VisitDetailView-*.js` 有「標記為排除（測試或重複）」與匿名化案件的提示、`VisitRequestsView-*.js` 有「已排除・」「隱藏已排除」、`AdmissionsStatsView-*.js` 有「筆測試或重複的預約已排除」、`PrivacyPolicyView-*.js` 有「預計入學時間」。
- **待使用者／園方**：登入正式後台看一次案件明細的排除入口與橫幅、列表的「隱藏已排除」；已發布的隱私權政策要在後台補「預計入學時間」一項再發布（後台草稿已補）；家長只改預計入學時間也會寄「預約已變更」信（目前和改其他欄位一致，可推翻）。

## 2026-10-16 密碼雜湊改直接用 bcrypt、九月的日期紀錄移到 docs/changelog（main CI 部署，沒有 migration）

- **提交**：`feature/passlib-docs-20261016` 三個 commit（`17382f43`..`f411c53a`），從 main `585d3fc2` 開出、期間 main 沒有前進，使用者推 main（fast-forward `585d3fc2..f411c53a`，沒有開 PR）。內容見 README 頂部「密碼雜湊改直接用 bcrypt、九月的日期紀錄移到 docs/changelog」。
- **migration**：沒有。依賴變動：拿掉 `passlib`、`bcrypt` 4.0.1→5.0.0（`backend/uv.lock` 用 uv 0.8.22 重產）。雜湊格式相同，既有帳號不用重設密碼；沒有新環境變數，沒有備份。回退可直接切回上一個映像（舊映像的 passlib 讀得了新程式產生的雜湊）。
- **推送前閘門**：本機後端全套 3579 passed／1 skipped（`ivy_website_passlib1016_test`）、`deploy/tests` 22 項通過；feature 分支 CI run 38910202999（`f411c53a`）Frontend web／admin、Backend 三組、E2E 全部 success，pip-audit「No known vulnerabilities found」。
- **CI**：main run 38911854207（`f411c53a`）13:57:09Z 開跑，全部 success；Deploy Railway production 14:02:24Z–14:07:17Z。
- **正式 `release.json`**：base commit `f411c53a`，snapshot `666bb7c88c3e…`，created `2026-10-16T14:02:47Z`，`web+api`。
- **線上檢查**（2026-10-16T14:09Z）：health `status: ok`、`environment: production`、`fixture_enabled: false`、`last_failed_steps` 為空（API 能啟動代表 import 時的 bcrypt `hashpw` 正常）；`/`、`/admin/login` 回 200；以不存在的帳號 `smoke-test-20261016@example.com` 打一次 `POST /api/website/v1/auth/login` 回 401「帳號或密碼錯誤」、0.68 秒（走過一次 rounds 12 的 `checkpw`），操作紀錄因此多一筆登入失敗（日常登入預設不顯示）。
- **未在線上驗證**：沒有用真實帳號登入（沒有帳密）；請使用者登入後台一次確認既有密碼照常可用。Google／LINE 登入不經密碼雜湊，沒有影響。

## 2026-10-16 清掉 web 的死 CSS 與比稿殘留（main CI 部署，沒有 migration）

- **提交**：`feature/web-deadcode-20261016` 四個 commit（`c21c8e92`..`fcf4a1b0`），推之前 rebase 到 main `d196036b`（招生統計獨立頁先上；衝突只有 README.md 頂部；那個提交沒有動 `web/`），使用者推 main（fast-forward `d196036b..fcf4a1b0`，沒有開 PR）。內容見 README 頂部「清掉 web 的死 CSS 與比稿殘留」。
- **migration**：沒有。只刪 CSS、死函式、兩個沒用的測試套件（`web/package-lock.json` 變動）與後台兩個範本 SVG；沒有新環境變數，沒有備份。回退可直接切回上一個映像。
- **推送前閘門**：feature 分支 CI run 38879238782（`0bf3e44d`）Frontend web／admin、Backend 三組、E2E 全部 success；最後一次 rebase 後 `web/` 與它完全相同。本機：web vitest 101 檔 1227 passed、web／admin typecheck 0 錯、admin vitest 165 檔 2599 passed／1 skipped、`nuxt build` 成功；dev server 75 個狀態的 computed style 刪前刪後一致（方法見 README）。
- **CI**：main run 38881531499（`fcf4a1b0`）09:35:45Z 開跑（前一個 run 38879353923 剛結束），全部 success；Deploy Railway production 09:42:02Z–09:49:14Z。
- **正式 `release.json`**：base commit `fcf4a1b0`，snapshot `3419ddb9970b…`，created `2026-10-16T09:42:24Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-16T09:49Z）：health `status: ok`、`environment: production`、`fixture_enabled: false`、`last_failed_steps` 為空；`/`、`/about`、`/admission`、`/visit`、`/environment`、`/curriculum`、`/anniversary`、`/news`、`/admin/login` 都回 200。每頁內嵌 CSS（`<style>` 合計）：`/` 169→138.3 KB、`/about` 164→133.0、`/admission` 162→131.0、`/visit` 162→130.9；gzip 後首頁 HTML 66→60.5 KB。首頁與常春藤環境頁桌機、手機首屏與捲動後截圖目視正常（頁首、膠囊、手繪版面）。
- **未在線上驗證**：沒有逐頁做 computed style 比對（正式站是 CMS 內容，fixture 上做過）；選單打開、對話框等互動狀態只在 dev server 比過。

## 2026-10-16 招生統計抽成獨立側欄頁、只給總管理者（main CI 部署，沒有 migration）

- **提交**：`feature/admissions-stats-page-20261016` 一個 commit `d196036b`，使用者推 main（fast-forward `c4524ed5..d196036b`，沒有開 PR）。內容見 README 頂部「招生統計抽成獨立側欄頁、只給總管理者」、DESIGN.md「後台：招生統計抽成獨立頁、只給總管理者」。
- **migration**：沒有。權限改在 `backend/app/auth/permissions.py`：新增 `admissions.stats`（只給 super_admin），18 支統計 API 改用它；刪除 `analytics.read`（`/auth/me` 的 `effective_capabilities` 少這一項）。沒有新環境變數、沒有依賴檔變動，沒有備份。回退可直接切回上一個映像（分校管理者、接待會重新看得到統計）。
- **推送前閘門**（本機，Node 22，從 main `c4524ed5` 開、推送前 main 沒有新提交）：後端全套 3,568 passed／1 skipped（獨立測試庫 `ivy_website_admstats1016_test`）；admin `vue-tsc` 無錯誤、vitest 全套 166 檔 2,634 passed／1 skipped；契約 `--check` 兩項一致；stack 全套 147 passed（含視覺基準）。web 沒有改動，沒跑 web 測試。
- **CI**：main run 38879353923（`d196036b`）09:16:42Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 09:22:45Z–09:29:23Z。
- **正式 `release.json`**：base commit `d196036b49a65ce246af0bb30a92060047500bac`，snapshot `652b040b…`，created `2026-10-16T09:23:31Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-16T09:30Z）：`/api/website/v1/health` 回 `status: ok`、`environment: production`、`fixture_enabled: false`、`last_failed_steps` 為空；`/admin/admissions-stats` 回 200；`/api/website/v1/admin/admissions/stats` 未登入回 401；後台入口 bundle `index-r-YYHJt9.js` 有 `admissions-stats` 路由與舊連結 `tab=stats` 的轉址，lazy chunk `AdmissionsStatsView-DFdKGD98.js` 存在。
- **待使用者**：登入正式後台看側欄「招生統計」與舊連結轉址；分校管理者、接待帳號會看不到統計（含未預繳名單），這是這次的裁定。

## 2026-10-16 後台第 2 波：招生歷程兩種事件＋退出原因分類（main CI 部署，migration 只新增）

- **提交**：使用者在本機推 `feature/admin-wave2-20261015` 到 main（fast-forward `5a08b3dc..c3c6498d`，沒有開 PR）。內容見 README 頂部「招生歷程兩種事件＋退出原因分類」、DESIGN.md「招生入學：招生歷程兩種事件與退出原因分類」、規格 `docs/specs/2026-10-15-admissions-history-events-design.md`、`docs/specs/2026-10-15-withdraw-reason-category-design.md`（各有 §7 實作紀錄）。
- **migration**：`5c8e1f3a9d27`（接在 `f2b8c4d1e7a9` 附近同業比較之後）只在 `recruitment_visits` 加可空欄位 `withdraw_reason_category` 與兩條 CHECK（值在八項內、有分類必須已退出），升級不改既有資料，所以沒有備份。沒有新環境變數、沒有依賴檔變動。轉給園務的 JSONL：`columns` 鍵集合不變，`withdraw_reason` 組成「分類」或「分類：說明」，分類另放 `extensions.withdraw_reason_category`；兩種新歷程事件是官網專用、不轉。
- **回退**：舊映像不認得 `5c8e1f3a9d27`，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade f2b8c4d1e7a9`（分類欄位會一起刪掉），再切舊映像。
- **推送前閘門**（本機，Node 22）：合併第 1 波、small-fixes、ci-speed 後，`bafcf434` 後端全套 3,568 passed／1 skipped、stack 全套 147 passed；`068ee7a0` admin vitest 全套 165 檔 2,623 passed／1 skipped；admin、web typecheck 無錯誤；契約 `--check` 兩項與園務漂移檢查（`dfd230c3`）一致；alembic 單一 head。
- **CI**：main run 38857284556（`c3c6498d`）05:43:45Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production success，整個 run 05:58:35Z 結束。
- **正式 `release.json`**：base commit `c3c6498d5f619df35b576a574367bd27ad52fc7e`，snapshot `a57022a2…`，created `2026-10-16T05:49:38Z`。
- **線上唯讀檢查**（未登入，2026-10-16T05:59Z）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空（`last_completed_at` 05:58:50Z；API 有起來代表 schema 已到 `5c8e1f3a9d27`）；首頁、`/admin/`、`/visit` 都回 200；`/api/website/v1/admin/admissions/stats` 未登入回 401；後台 lazy chunk 裡 `StatsTab-*.js` 有「未預繳與退出原因」「退出原因分佈」、`constants-*.js` 有八項分類、`TransitionDialog-*.js` 有「退出原因」。
- **待使用者／園方**：既有的退出紀錄全部是「未分類」，請到招生入學 → 訪視明細篩「未分類（舊資料）」逐筆補分類；登入正式後台看一次退出對話框與「未預繳與退出原因」分頁。

## 2026-10-16 後端測試提速、後台場次 N+1、文件更正（main CI 部署，沒有 migration）

- **提交**：`feature/ci-speed-20261016` 六個 commit（`0e57b9d1`..`702e5178`），途中兩次 rebase 到 main（第 1 波、延後小問題一批與兩筆部署紀錄先上；衝突只有 README.md 頂部、`deploy/README.md` 家長自選場次標題、`docs/website-admin/operations.md` 提醒段，都是文件），使用者推 main（fast-forward `a908d815..702e5178`，沒有開 PR）。內容見 README 頂部「後端測試提速、後台場次 N+1、文件更正」。
- **migration**：沒有。正式程式只改 `GET /admin/slots` 的已占名額查法（回應形狀不變）與一行註解；其餘是測試、CI 設定與文件。沒有新環境變數、沒有依賴檔變動，沒有備份。回退可直接切回上一個映像。
- **推送前閘門**：本機後端全套在合併第 1 波後 3533 passed／1 skipped（5 分 23 秒，獨立測試庫 `ivy_website_cispeed1016_test`），之後只多了延後小問題的 `journey.py`，受影響兩檔 69 passed。feature 分支 CI run 38853918244（`de5fd51e`）Frontend web／admin、Backend 三組、E2E 全部 success；最後一次 rebase 與它只差 `deploy/README.md`。沒有在本機跑前端與 stack e2e（沒改 web、admin）。
- **CI**：main run 38854910359（`702e5178`）05:16:24Z 開跑，全部 success；Backend 三組 pytest 235／232／174 秒（前幾次 main 是 554–853 秒），Deploy Railway production 05:21:37Z–05:26:40Z。push 到開始部署 5.2 分鐘（以前 12.7–15.5）、到部署完成 10.3 分鐘（以前 18–21）；現在最長的是 E2E（11.1 分鐘，不擋部署），擋部署的是 Frontend（admin）約 4 分鐘與 Backend 約 5 分鐘。
- **正式 `release.json`**：base commit `702e5178bc6b7f76cf801506220d20737523997a`，snapshot `37ccd1152f50…`，created `2026-10-16T05:21:59Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-16T05:29Z）：`/api/website/v1/health` 回 `status: ok`、`environment: production`、`fixture_enabled: false`、`background_jobs.last_failed_steps` 為空；`/`、`/admission`、`/about`、`/visit/yihua`、`/admin/`、`/admin/login` 都回 200；`/api/website/v1/admin/slots` 未登入回 401。
- **未在線上驗證**：沒有登入後台看接待月曆的已占名額數字（行為由新測試 `test_admin_slots_uses_constant_number_of_queries` 驗）；concurrency 群組要等下一次同分支 push＋PR 才看得到效果。

## 2026-10-16 延後小問題一批修正（預約全程、參觀場次、預約完成頁、驗收 A23）（main CI 部署，沒有 migration）

- **提交**：`fix/small-fixes-20261016` 五個 commit（`f0ef179f`..`23ab4a5c`）從 `263fea2a` 開出；第一次推 main 時第 1 波剛好先上（`4f1e0603`），被拒後合併 main 成 `2d56b439`（只有 README.md 衝突、兩段都留，程式檔不重疊），使用者推 main（fast-forward `4f1e0603..2d56b439`，沒有開 PR）。內容見 README 頂部「延後小問題一批修正＋文件校正」、DESIGN.md「招生入學：預約全程漏斗」與「參觀場次」兩節。
- **migration**：沒有。API 回應形狀沒變（只改 `journey.py` 的批次條件），沒有新環境變數、沒有依賴檔變動，沒有備份。
- **推送前閘門**（本機，Node 22）：合併 main 前在 `23ab4a5c` 跑 stack 整套 145 passed；合併後在 `2d56b439` 重跑：admin、web typecheck 無錯誤，admin vitest 165 檔 2,599 passed／1 skipped，web vitest 101 檔 1,229 passed，重新 `e2e:build` 後 stack 整套 146 passed。後端只跑了受影響的三檔 53 passed，全套交給 CI。
- **CI**：main run 38851560588（`2d56b439`）04:37:16Z 排進、等第 1 波的 run 38850358405 跑完，04:47:14Z 開跑；Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 05:03:46Z–05:09:12Z success。
- **正式 `release.json`**：base commit `2d56b4390981059f09adcb95f8f5a41f0ed20955`，snapshot `31b6977e…`，created `2026-10-16T05:04:10Z`，`web+api`。這一版也一起帶上第 1 波（`4f1e0603` 之前的提交）。
- **線上唯讀檢查**（未登入，2026-10-16T05:10Z）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`background_jobs.last_failed_steps` 為空；首頁、`/admission`、`/visit`、`/about`、`/admin/` 都回 200；`/api/website/v1/admin/admissions/journey` 未登入回 401。
- **未在線上驗證**：沒有登入後台看預約全程的摘要、匯出 CSV、接待月曆的「不在開放規則內」與網址換校的詢問；沒有在正式站重送預約看完成頁文案。

## 2026-10-16 後台第 1 波：系統狀態頁＋家長參觀提醒信（main CI 部署，無 migration）

- **提交**：使用者在本機推 `feature/admin-wave1-20261015` 到 main（fast-forward `263fea2a..4f1e0603`，沒有開 PR）。內容見 README 頂部「後台第 1 波」、DESIGN.md「後台：系統狀態頁」「預約：參觀前 24 小時家長提醒信」、規格 `docs/specs/2026-10-15-admin-system-status-design.md`、`docs/specs/2026-10-15-parent-visit-reminder-design.md`（各有 §7 實作紀錄）。同一次推送也帶進第 2、3 波的規格與計畫（只有文件）。
- **migration**：無；沒有新環境變數、沒有依賴檔變動。新權限 `system.status` 只給總管理者。
- **回退**：沒有 schema 變動，可直接切回上一個映像。
- **推送前閘門**（本機，Node 22；合併 `origin/main` `e420e9f2`／`263fea2a` 後在 `4205463d`）：後端全套 3,518 passed／1 skipped，另 14 個 error 全是本機 PostgreSQL「too many clients」（同時間別的 session 在用），所在 12 個檔案單獨重跑 247 passed；admin vitest 全套 165 檔 2,593 passed／1 skipped；admin、web typecheck 無錯誤；契約 `--check` 兩項一致；stack 全套 145 passed。
- **CI**：main run 38850358405（`4f1e0603`）04:23:20Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production success，整個 run 04:47:11Z 結束。
- **正式 `release.json`**：base commit `4f1e060381c2c2d9f9284752daed46ee3aabcedc`，snapshot `c29c58eb…`，created `2026-10-16T04:40:54Z`。
- **線上唯讀檢查**（未登入，2026-10-16T04:48Z）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空（`last_completed_at` 04:47:51Z）；首頁、`/admin/`、`/visit` 都回 200；新端點 `/api/website/v1/admin/system-status` 未登入回 401（路由已掛）。
- **待使用者**：登入正式後台看「系統 → 系統狀態」，確認寄信（SMTP）、Turnstile 等列的實況；寄信已設定的話自己按一次「寄一封測試信給我」（會寄真信到自己的帳號）。正式站沒設 SMTP 之前，家長提醒信一律 skipped。

## 2026-10-16 區域分析：附近同業收費（main CI 部署，migration 只新增）

- **提交**：使用者在本機先推 `feature/peer-fees-20261015`（CI run 38841989719 全綠、部署照設計跳過），再推到 main（fast-forward `303df4bf..e420e9f2`，24 個 commit，沒有開 PR）。內容見 README 頂部「區域分析：附近同業收費」、DESIGN.md「附近同業收費」、規格 `docs/specs/2026-10-15-peer-comparison-design.md`。
- **migration**：`f2b8c4d1e7a9`（接在 `f2a7c1e9d4b3` 之後）只新增 `geo_kindergarten_fees` 表、`geo_kindergartens` 四欄、`geo_babycare` 五欄，並放寬 `ck_geo_dataset_status_dataset` 多收 `kindergarten_fees`；升級不改既有資料，所以沒有備份。沒有依賴檔變動、沒有新環境變數。
- **回退**：舊映像不認得 `f2b8c4d1e7a9`，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade f2a7c1e9d4b3`，再切舊映像（見下方「幼兒園收費與托嬰明細」）。
- **推送前閘門**（本機，Node 22，`db80b1f5`；rebase 到 `303df4bf` 後和測過的版本只差 main 那份 `deploy/README.md`）：後端全套 3,446 passed／1 skipped；admin vitest 全套 164 檔 2,571 passed／1 skipped；admin typecheck 無錯誤；契約 `--check` 兩項一致；alembic 單一 head；重新 `e2e:build` 後 stack 整套 144 passed。真實資料閘門（本機完整網路同步）：收費 114 學年 603 所、托嬰明細 152 所，義華 3 公里數字和規格 §2 一致，五校都對到本校。
- **CI**：main run 38842036783（`e420e9f2`）02:45:13Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright 全部 success，Deploy Railway production 03:01:11Z–03:07:33Z success。
- **正式 `release.json`**：base commit `e420e9f28676436f6c29a7bf678f96800eb5af25`，snapshot `203a14a9…`，created `2026-10-16T03:01:34Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-16T03:08Z）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；首頁、`/admission`、`/visit`、`/admin/` 都回 200；新端點 `/api/website/v1/admin/admissions/area/fees` 未登入回 401「未登入」。
- **還沒確認**：第一輪背景同步的結果。收費與托嬰明細「從沒匯入過」，api 重新部署後的第一輪背景同步就會抓（不用 `--force`），全域同步鎖內多約 5–6 分鐘。請在 Railway Postgres 的 Database 分頁跑：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset in ('kindergartens','kindergarten_fees','babycare');`、`select age, count(*) from geo_kindergarten_fees group by age order by age;`、`select count(*), count(monthly_fee), count(evaluation_grade), count(quasi_public) from geo_babycare where is_active;`。預期 `kindergarten_fees` 的 label 是 `114`、各年齡約 600 列（2 歲約 490）、托嬰營業中幾乎每所都有 `quasi_public`。
- **幽靈園所**：上一筆的名單修正要等下一輪幼兒園同步（約 10-21）才下架 47 所；在那之前同業統計可能混進那幾所停辦園所，名單同步後自動消失。
- **未在線上驗證**：登入後的「附近同業收費」區塊、附近清單的收費與托嬰月費。這裡沒有讀 Railway 的權限，沒看 Railway 日誌。

## 2026-10-16 幼兒園營業中改以教育部名單判斷（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `fix/kindergarten-registry-20261015` 到 main（fast-forward `9dbf413f..54031d7c`，14 個 commit，含併入當時 main「在籍學生分布」的 merge `51bd6710`，沒有開 PR）。內容見 README 頂部「幼兒園營業中改以教育部名單判斷」、DESIGN.md「停辦怎麼知道」、規格 `docs/specs/2026-10-15-kindergarten-registry-design.md`、`backend/app/admissions/geo_data/README.md`「幼兒園停辦回補」。
- **migration**：無；alembic head 仍是 `f2a7c1e9d4b3`（在籍學生那一輪帶進來的）；沒有依賴檔變動；沒有備份。新增設定 `WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`（有預設值，正式站不用設）。
- **回退**：可直接切回前一個映像（只改同步邏輯、CLI 參數與後台小字，沒有新表、新欄位）。但第一輪新邏輯同步之後寫進 `geo_provider_events` 的停辦事件與下架的 `is_active` 不會因回退而復原。
- **推送前閘門**（本機，Node 22，合併 main 後在 `51bd6710`）：後端全套 3,316 passed／1 skipped；admin vitest 全套 161 檔 2,532 passed／1 skipped；admin typecheck 無錯誤；重新 `e2e:build` 後 stack `admissions-area.spec.ts` 15 passed。
- **CI**：main run 38825639162（`54031d7c`）23:47:12Z 開跑，Frontend web／admin、Backend 三組、E2E／Playwright、Deploy Railway production 全部 success。
- **正式 `release.json`**：base commit `54031d7ce571fe0e398cfaf87a4f1d924c13c07e`，snapshot `3ce5715a…`，created `2026-10-16T00:03:07Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-16T00:31Z）：`/api/website/v1/health` 回 `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；首頁、`/admission`、`/visit`、`/admin/` 都回 200；`/api/website/v1/admin/admissions/area/changes` 未登入回 401。
- **還沒生效**：新判斷要等下一輪幼兒園同步（每 7 天；上一輪推測 10-14，所以約 10-21，未查正式庫確認）。要立刻生效：先確認名單筆數正常（`curl -s https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv | wc -l` 約 690），再在 api 跑 `python -m app.cli geo-sync --force`（會連門牌一起強制重抓，連不到高雄市資料平台時門牌 failed、結束碼 1，幼兒園照樣更新）。預期與查法見上方 README 與本檔「公開地理資料同步」的轉換輪說明：營業中約 689、停辦事件 16、依回補檔下架 33、改名下架 14。
- **未在線上驗證**：登入後的區域分析畫面（附近幼兒園少掉幽靈園所、變化列表出現停辦、新小字）；第一輪同步結果。這裡沒有讀 Railway 的權限，沒看 Railway 日誌。

## 2026-10-15 在籍學生分布（main CI 部署，migration 只新增兩張表）

- **提交**：使用者在本機推 `feature/enrolled-map-20261015` 到 main（fast-forward `1ca98981..9dbf413f`，24 個 commit，含合併 origin/main `1ca98981` 的 merge `42984079`，沒有開 PR）。內容見 README 頂部「在籍學生分布」、規格 `docs/specs/2026-10-15-admissions-enrolled-map-design.md`、DESIGN.md「招生入學：區域分析」。
- **migration**：`f2a7c1e9d4b3`（接在 `c6a9e3f15d27` 後），只新增 `enrolled_rosters`、`enrolled_student_points` 兩張表，不改既有資料，沒有備份；API 啟動時自動套用。
- **回退**：可直接切回前一個映像（舊程式不讀新表）；要連資料一起拿掉就 `enrolled-import --clear --campus yihua`，或 `alembic downgrade c6a9e3f15d27`（刪兩張表）。
- **推送前閘門**（本機，Node 22；合併 origin/main 後的 `42984079`）：後端全套 3,256 passed／1 skipped；admin vitest 全套 161 檔 2,531 passed／1 skipped；admin 與 web typecheck 無錯誤；契約檢查一致；完整 stack 套件（重新 build）142 passed。
- **CI**：main run 38821712749（`9dbf413f`）23:08:10Z 開跑，23:27:36Z 完成（19.4 分），全綠：Frontend web 1.6 分、admin 5.9 分；Backend 三組 14.1／12.2／15.0 分；E2E／Playwright 9.9 分；Deploy Railway production 4.3 分（23:23:16Z 開始）。
- **正式 `release.json`**：base commit `9dbf413ff27e296ca4c46132502117e0127d8494`，snapshot `1804b6b9…`，created `2026-10-15T23:23:39Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`fixture_enabled: false`、`last_failed_steps` 為空；首頁與 `/admin/` 回 200；`/admin/admissions/area/enrolled` 未登入回 401（路由已掛）。
- **在籍學生匯入**（照上方「在籍學生匯入」步驟，2026-10-16 台北時間）：義華清冊在本機比對（門牌 115-10）產生去識別 JSON（34,322 bytes），agent 用 `railway volume -p d606df61-… -e production files -v api-volume upload` 上傳到 `/enrolled-yihua-20261015.json`（`-p` 要用專案 ID，寫專案名稱會回 Project not found）；使用者用 `!` 執行 `railway ssh … --service api -- python -m app.cli enrolled-import --file /data/enrolled-yihua-20261015.json`，輸出「匯入 yihua：192 位（有點 180 位），清冊日期 2026-10-15」，沒有門牌版本提醒（正式站仍是 115-10）。volume 上的 JSON 由使用者自行刪除。
- **未在線上驗證**：登入後的「在籍學生」畫面（本機用真資料與真底圖看過 1440／390）。其他四校尚未匯入，按鈕停用並寫「尚未匯入在籍名冊。」。

## 2026-10-15 區域分析驗證後的修正：國小學區整里／部分、招生機會沒填地址（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `fix/area-data-fixes-20261015` 到 main（fast-forward `aae0debc..15a81e60`，3 個 commit：`1cebdae8` 學區、`c8b42478` 招生機會文案、`15a81e60` 文件，沒有開 PR）。內容見 README 頂部「區域分析驗證後的修正」、`backend/app/admissions/geo_data/README.md`、兩份規格的 10-15 更正。
- **migration**：無；alembic head 仍是 `c6a9e3f15d27`；沒有依賴檔變動；沒有備份。學區對照檔隨程式提交，部署後就生效。
- **回退**：可直接切回前一個映像（API 只多一個回應欄位 `no_address_visit`，沒有新表、新欄位）。
- **推送前閘門**（本機，Node 22）：後端全套 3,158 passed／1 skipped；admin vitest 全套 161 檔 2,507 passed／1 skipped；admin typecheck、契約檢查一致；stack `admissions-area.spec.ts` 13 passed。
- **CI**：main run 38766809138（`15a81e60`）16:10:58Z 開跑，16:28:52Z 完成（17.9 分），全綠：Frontend web 2.0 分、admin 6.2 分；Backend 三組 12.5／12.2／11.3 分；E2E／Playwright 12.5 分；Deploy Railway production 5.2 分（16:23:37Z 開始）。
- **正式 `release.json`**：base commit `15a81e603378c67d596d261bf13cfb71364caae9`，snapshot `4b00863c…`，created `2026-10-15T16:24:02Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`fixture_enabled: false`；首頁、`/admission`、`/visit`、`/admin/` 都回 200；`/area/opportunity` 未登入回 401；後台 lazy chunk（121 個）裡 `areaFormat-*.js` 有「參觀率不到 0.1%」與 `no_address_visit`、`StatsTab-*.js` 有「沒填地址、只到區、未定位的訪視」。
- **同日的正式資料操作**（不依賴這次部署）：使用者重匯 114S4–115S3 新成屋，七賢一路 63 筆重比，`unplaced` 63 → 0（見下方「公開地理資料同步」的跨區界道段落）。
- **未在線上驗證**：登入後的畫面與 `/area/opportunity`、`/area/trends` 的新值（推送後讀時登入 session 已過期，被導到登入頁）。預期：義華招生機會寫「另有 3 位沒填地址」、「參觀率不到 0.1%」；依國小學區新甲國小「9 里＋部分 1 里」、大東國小「5 里」。

## 2026-10-15 預約全程漏斗與退出時點（main CI 部署，沒有 migration）

- **提交**：使用者在本機直接推 `feature/booking-journey-20261015` 到 main（fast-forward `7ae6de45..59f4d2a1`，17 個 commit，沒有開 PR）。feature 分支先推過一次，CI run 38675440483 六個 job 全 success，Deploy 照預期 skipped。內容見 README 頂部「預約全程漏斗與退出時點」、DESIGN.md「招生入學：預約全程漏斗與退出時點」、規格 `docs/specs/2026-10-15-booking-journey-design.md`（§8 是實作中的裁定）、計畫 `docs/superpowers/plans/2026-10-15-booking-journey.md`。
- **migration**：無；alembic head 仍是 `c6a9e3f15d27`；沒有依賴檔變動；沒有備份。
- **回退**：可直接切回前一個映像（新增的是唯讀 API 端點與後台畫面，沒有新表、新欄位）。
- **推送前閘門**（本機，Node 22）：
  - 後端全套 3,136 passed／1 skipped（跑在 `975bad7a`；其後 `backend/app` 與契約沒有變動，只改兩個預約全程測試檔，那兩檔在 `6e040835` 另跑 44 passed）；`ruff` 無錯誤。
  - 後台 vitest 全套 161 檔 2,506 passed／1 skipped；admin 與 web typecheck、契約檢查（不經 `uv run`）一致。
  - 完整 stack 套件（重新 build）140 passed，含新增的 2 個預約全程案例。
- **CI**：main run 38677552289（`59f4d2a1`）03:41:14Z 開跑，04:01:54Z 完成（20.7 分），全綠：
  - Frontend web 1.5 分、admin 6.6 分；Backend 三組 15.2／12.5／10.5 分；E2E／Playwright 10.6 分；Deploy Railway production 5.3 分（03:56:36Z 開始）。
- **正式 `release.json`**：base commit `59f4d2a1bdbbf52a2a01d87a0a9dd04cb6e1e603`，snapshot `5f6aa0a6…`，created `2026-10-15T03:56:58Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-15T04:03Z）：
  - `/api/website/v1/health` 回 `status: ok`，`fixture_enabled: false`，`last_failed_steps` 為空（背景工作 04:01:30Z 完成一輪）。
  - 首頁、`/admission`、`/visit`、`/about`、`/anniversary`、`/admin/` 都回 200（0.15–0.60 秒）。
  - `GET /api/website/v1/admin/admissions/journey` 未登入回 401（路由已掛）。
- **未在線上驗證**：
  - **登入後的畫面**（招生入學 → 統計分析 → 預約全程）：只有本機 Playwright 截圖與 CI 的 E2E，沒有登入正式後台看過，也沒看手機 390px 的正式畫面。
  - **正式資料的連結率**：招生訪視連到預約的比例沒查，所以漏斗後半段的數字在正式資料上是否可信未驗證（招生功能關閉期間到場、事後沒補建的案件會讓後半段偏低）。查法（Railway Postgres 的 Database 分頁，尚未執行）：`select count(*) filter (where visit_request_id is not null) as linked, count(*) as total from recruitment_visits where visit_date >= current_date - 90;`；已到場的預約有幾成有訪視：`select count(*) filter (where exists (select 1 from recruitment_visits v where v.visit_request_id = r.id)) as with_visit, count(*) as completed from visit_requests r where r.status = 'completed' and r.created_at >= now() - interval '90 days';`。
  - 這裡沒有讀 Railway 的權限，沒看 Railway 日誌。

## 2026-10-14 多年出生數走勢（main CI 部署，沒有 migration）

- **提交**：使用者在本機直接推 `feature/birth-series-20261014` 到 main（fast-forward `c13f2c88..ad7352d5`，16 個 commit，沒有開 PR），其中 `2054facd` 是併入 main 當時「里的變化 B2」的 merge commit。內容見 README 頂部「多年出生數走勢」、DESIGN.md「招生入學：多年出生數走勢」、規格 `docs/specs/2026-10-14-birth-series-design.md`。
- **migration**：無。`geo_village_births` 結構不變，只改保留月數；alembic head 仍是 `c6a9e3f15d27`。沒有備份。
- **回退**：可直接切回前一個映像（沒有 migration）。舊程式下一次寫入出生時會把多出的月份裁回 25 個月，資料不會壞；舊程式仍抓 ODRP010，ODRP010 缺的月份照舊缺。
- **推送前閘門**（本機，合併 main 之後）：
  - 後端全套 3,093 passed／1 skipped；後台 vitest 全套 159 檔 2,468 passed／1 skipped；admin 與 web typecheck、`contract:check` 一致。
  - 完整 stack 套件（重新 build）138 passed，含新增的 2 個出生走勢案例。
- **CI**：main run 38653363933（`ad7352d5`）2026-10-14T23:19:34Z 開跑，23:37:20Z 部署完成（17.8 分），全綠：
  - Frontend web 1.4 分、admin 6.0 分；Backend 三組 10.8／8.7／13.8 分；E2E／Playwright 10.6 分；Deploy Railway production 3.9 分（23:33:28Z 開始）。
- **正式 `release.json`**：base commit `ad7352d5dc26dddc888741d3980d98afb25b1401`，snapshot `3705095a…`，created `2026-10-14T23:33:56Z`，`web+api`。
- **線上唯讀檢查**（未登入，2026-10-15 00:25Z）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空（背景工作 00:25:31Z 完成一輪）。
  - 首頁、入學、預約、`/admin/` 都回 200（0.17–0.79 秒）。
  - `GET /api/website/v1/admin/admissions/area/trends` 未登入回 401（路由已掛）。
- **未在線上驗證**：
  - **出生回補第一輪**：正式站出生表原本 21 個月（見上一段紀錄），`WEBSITE_GEO_AUTO_SYNC=true` 已開，部署後第一輪應回補到視窗起點 109-10（預估約 50 個請求、5～8 分鐘、約 55 MB，**實際沒看到**：這裡沒有讀 Railway 的權限）。Railway 連得到 ris.gov.tw 已在 10-14 第一輪同步實測；72 個月回補的請求數、時間與用量沒實測。
  - 查法（Railway Postgres 的 Database 分頁）：`select min(month), max(month), count(distinct month) from geo_village_births;`，補完後預期 `109-10`／最新月份／`71`（111-03 兩個資料集都查無，是永久缺月）；`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset in ('births', 'migration');`，births 的 `checked_at` 在補完那一輪才更新、`last_error` 應為空。第一輪若 `last_error` 寫「同步超過 20 分鐘」或「可能被來源擋下」，隔天看 `min(month)` 有往前推就不必手動介入。
  - 另查 `select min(month) from geo_village_migration;`：確認正式站遷入遷出是 25 個月齊全；若比視窗短，每天會多問缺的月份（每個月份一個請求）。
  - 登入後的畫面（「近幾年的出生數」）：只有本機 Playwright 截圖與 CI 的 E2E。
  - 20 位門檻同時套到「比前一年同期」那句：1 公里這類小半徑原本顯示的百分比可能變成不顯示，沒有正式資料可算會不會發生。

## 2026-10-14 里的變化 B2：新屋交屋上畫面與跨區界道比對（main CI 部署，沒有 migration）

- **提交**：使用者在本機推 `feature/village-new-homes-b2-20261014` 到 main（fast-forward `03eaa872..eb5779bf`，5 個 commit）：`e1b058f1` 跨區界道比對、`34bc5084` B2 本體、`69cca639` 合併組在地圖上依各里自己的筆數上色（和規格 §5.6 的刻意差異，可單獨還原）、`314492a9` 文件、`eb5779bf` 併入 main 當時的托嬰部署紀錄 `03eaa872`。內容見 README 頂部 10-14「B2 段」、DESIGN.md「招生入學：里的變化」、規格 §18。
- **migration**：沒有，不改既有資料，所以沒有先備份。要退可直接切回前一個映像（沒有新表、新欄位；API 新增的是回應欄位）。**已存的新成屋列與訪視是用舊規則比對的，新規則要等下一次門牌換版（或重匯新成屋）才會重比**，所以線上七賢一路 61–95 號那 63 筆目前仍是「只到區」。
- **推送前閘門**（本機，Node 22；各數字跑在哪個 commit 見 README 頂部驗證條）：
  - 後端 geo／招生／稽核／權限相關 1232 passed（`69cca639`；不是後端全套，全套由 CI 跑）。
  - 後台 vitest 全套 157 檔、2456 passed、1 skipped（`--testTimeout=60000`）；`typecheck` 無錯誤；契約 `export_openapi.py --check` 與 `check-contract-types.mjs` 一致。
  - stack 端到端只跑區域分析：`admissions-area.spec.ts` 11 passed（含 1440／390 不橫向溢出）。
- **CI**：main run 38575188946（`eb5779bf`）13:50:17Z 開跑，14:10:33Z 部署完成（20.3 分），全綠：
  - Frontend web 1.6 分、admin 5.8 分；Backend 三組 9.2／12.1／14.2 分；E2E／Playwright 10.7 分；Deploy Railway production 5.9 分（14:04:39Z 開始）。
- **正式 `release.json`**：base commit `eb5779bf2d5a57387f6c2e0fe4ae67aafb33fd81`，snapshot `723f817d…`，created `2026-10-14T14:05:04Z`，`web+api`。
- **線上唯讀檢查**（未登入，約 14:15Z）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空（背景工作 14:11:27Z 完成一輪）。
  - 後台 lazy chunk（`AreaMap`、`areaFormat`、`StatsTab`）含「近 4 季新屋」「新屋交屋」「新成屋資料尚未匯入」「0 筆或在半徑外」與 `new_homes_by_code`。
  - **沒驗到**：登入後的實際畫面與 `/area/trends` 的回應欄位（要登入）。請使用者登入後台看「統計分析 → 區域分析」的「里的變化」表（多「近 4 季新屋」欄）與地圖第五個著色「新屋交屋」。

## 2026-10-14 托嬰中心與園所異動（main CI 部署，1 支 migration）

- **提交**：使用者在本機直接推 `feature/provider-changes-20261014` 到 main（fast-forward `3fb67463..1f472d15`，28 個 commit，沒有開 PR）；其中 `fc404ff7` 是併入「里的變化」的 merge commit，`1f472d15` 併入 main 當時的部署紀錄 PR #46。內容見 README 頂部 10-14「托嬰中心與園所異動」、DESIGN.md「招生入學：托嬰中心與園所異動」、規格 `docs/specs/2026-10-14-provider-changes-design.md`。
- **migration**：`c6a9e3f15d27`（接在 `e4f1a8c6b203` 之後，alembic 單一 head）：新增 `geo_babycare`、`geo_provider_events`，`geo_kindergartens` 加 `registered_on`，`geo_dataset_status` 加 `baseline_on` 並放寬 `ck_geo_dataset_status_dataset`（多收 `babycare`）。不改既有資料，所以沒有先備份。API 啟動時自動 `alembic upgrade head`；部署成功表示已套用，**沒有直接查 `alembic_version`**。
- **回退**：舊映像不認得 `c6a9e3f15d27`，`check_schema.py` 會擋（見 CICD.md）。要退先用新映像跑 `alembic downgrade e4f1a8c6b203`（刪兩張新表與兩個新欄位、約束改回、刪掉 `babycare` 狀態列，已記的異動一併消失），再切舊映像。
- **推送前閘門**（本機；各數字跑在哪個 commit 見 README 頂部驗證條）：
  - 後端全套（`fc404ff7`）3,067 passed／1 skipped。
  - 後台 vitest 全套 157 檔：第一次 6 檔共 11 個案例在高負載下逾時（`Test timed out in 5000ms`），改 `--testTimeout=60000` 重跑 182 passed；admin 與 web typecheck、`contract:check` 一致。
  - 完整 stack 套件 130 passed、6 項逾時（27.7 分，當時別的專案同時在跑測試）；那 6 項重跑後都通過，沒有在乾淨負載下一次跑完整套。
- **CI**：main run 38535057966（`1f472d15`）08:25:58Z 開跑，08:48:43Z 部署完成（22.8 分），全綠：
  - Frontend web 1.3 分、admin 5.6 分；Backend 三組 16.4／12.1／13.7 分；E2E／Playwright 8.6 分；Deploy Railway production 6.2 分（08:42:31Z 開始）。
- **正式 `release.json`**：base commit `1f472d152b6ab31014d8175063cfb487759d7d7d`，snapshot `83fdd913…`，created `2026-10-14T08:42:54Z`，`web+api`。
- **線上唯讀檢查**（未登入，08:50Z）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空（背景工作 08:48:40Z 完成一輪）。
  - 首頁、入學、預約、`/admin/` 都回 200（0.24–0.46 秒）。
  - `GET /api/website/v1/admin/admissions/area/babycare`、`/area/changes` 未登入回 401（路由已掛）。
- **未在線上驗證**：
  - **自動同步第一輪**：使用者已在 api 開 `WEBSITE_GEO_AUTO_SYNC=true`（見下一段紀錄）。api 啟動約 30 秒後第一輪會把幼兒園補上設立日、建立基準日（`baseline_on` 空算到期，第一次只建基準、不寫事件），並第一次匯入托嬰名單（高雄約 160 筆、營業 151）。Railway 連不連得到來源沒實測（這裡沒有讀 Railway 的權限）；連不到時各自寫 `last_error`。看狀態的 SQL 在下方「托嬰名單與園所異動」。
  - 登入後的畫面（切換托嬰名單、「附近園所的變化」、地圖托嬰菱形圖層）：只有本機 Playwright 截圖與 CI 的 E2E；托嬰菱形與「孩子增減」減少色疊在一起的畫面沒有實際看到（fixture 沒有孩子增減資料）。
  - 規格 P7（準公共續約護欄）的取捨、`--force` 一旗兩義、殘缺檔檢查只比淨數量，都在等使用者裁定，見 README 頂部 10-14 段與規格。

## 2026-10-14 招生區域「里的變化」A、C、D、B1 段（main CI 部署，3 支 migration）

- **提交**：使用者要求合併，06:36–06:38Z 依序把 PR #40（A 段：各里出生、遷入遷出、孩子增減，`d2f75ea8`）、#43（C 段：各里所得，`ae192c76`）、#44（D 段：國小學區，`0e7fdf39`）、#45（B1 段：新成屋同步與比對、不上畫面，`1cddfc3a`）以 merge commit 併入 main（`5fe246ba..1cddfc3a`）。內容見 README 頂部 10-14 四段、規格 `docs/specs/2026-10-14-admissions-village-trends-design.md` §14–§17。
- **migration**：`c5e9a1f3b7d2`（`geo_village_births`／`geo_village_migration`／`geo_village_ages`）、`d8b3f6a2c914`（`geo_village_income`）、`e4f1a8c6b203`（`geo_new_home_sales`），三支都只新增表、把 `ck_geo_dataset_status_dataset` 放寬成多收 `births`、`migration`、`income`、`new_homes`，不動既有資料，沒有備份（`deploy/CICD.md` 只要求刪改既有資料的 migration 先備份）。
- **回退**（2026-10-14 托嬰那次部署時更正）：**不能**直接切回 `5fe246ba` 的映像——舊映像不認得 `c5e9a1f3b7d2`、`d8b3f6a2c914`、`e4f1a8c6b203`，`check_schema.py` 會擋、停站（見 CICD.md）。要退先用新映像 `alembic downgrade b4d7e1a92c58`（刪掉這三支建的新表、約束改回，已匯入的資料消失、同步會重抓），再切舊映像。
- **推送前閘門**（各分支，本機）：
  - C 段後端全套 2,835 passed／2 failed，失敗的是 `test_geo_sync` 兩項（假網站缺所得來源），已在 `f7525dbc` 修正。
  - 後台 vitest 全套 156 檔 2,385 passed、typecheck；`contract:check` 一致；三支 migration upgrade／downgrade／upgrade 與 `deploy/check_schema.py` 通過。
  - 四個 PR 的 CI（後端三組、前端兩組、E2E）在合併前的最後 head 上都是綠的。
- **CI**：
  - main run 38523210483（`d2f75ea8`，只有 A 段）06:36:34Z 開跑，06:54:07Z 部署完成：Backend 三組 13.1／11.3／12.6 分、Frontend web 1.5 分、admin 4.9 分、E2E 10.3 分、Deploy Railway production 4.4 分，全綠。
  - #43、#44 的 run（38523291089、38523339788）在排隊時被較新的 run 取代（`main` 的 concurrency 不取消執行中的 run，只取代排隊中的），沒有部署。
  - main run 38523432261（`1cddfc3a`，四段全部）06:54:10Z 開跑，07:10:09Z 部署完成：Backend 三組 10.0／11.2／11.3 分、Frontend web 1.5 分、admin 5.9 分、E2E 10.6 分、Deploy Railway production 4.7 分，全綠。
- **正式 `release.json`**：base commit `1cddfc3a70636e5821163cdcd768f129e4b006dd`，snapshot `330f5680…`，created `2026-10-14T07:05:54Z`，`web+api`。
- **線上唯讀檢查**（未登入，07:2x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空（背景工作 07:20:42Z 完成一輪）。
  - 首頁、入學、特色教學、關於、環境、預約、義華預約、`/admin/` 都回 200（0.38–0.76 秒）。
  - `GET /api/website/v1/admin/admissions/area/trends` 未登入回 401（路由已掛；招生開關沒開時會是 404）。
- **未在線上驗證**：
  - **公開資料自動同步**：使用者 10-14 約 07:40Z 回報已在 api 設好 `WEBSITE_GEO_AUTO_SYNC=true`（10-12 紀錄只看到變數名稱；10-14 深度掃描那段寫「仍是關閉的」，以這次回報為準；變數的值當時沒看到；下面第一輪的結果證明 api 已重新部署、同步迴圈有跑）。api 重新部署後約 30 秒跑第一輪：門牌、幼兒園 10-12 已匯入，30 天內不重抓；新表是空的，會去抓各里出生、遷入遷出、一年前的年齡、所得、新成屋 8 季。**第一輪結果（10-14，使用者在 Railway Postgres 查 `geo_dataset_status` 與各表筆數貼回）：全部成功、八列 `last_error` 都是空的，不需要打包匯入**——births／migration 115-09（06:52Z，出生 21 個月有資料、遷入遷出 25 個月）、population 115-09（893 里，年齡歷史 2 個月）、income 112（879 列）、new_homes 115S3（26,035 列，07:08Z）、doorplates 115-10、kindergartens 2026-10-12（10-12 匯入）。**ris.gov.tw、www.fia.gov.tw、plvr.land.moi.gov.tw 從 Railway 都連得到**（只有 `data.kcg.gov.tw` 擋境外 IP，門牌仍要每月手動）。國小學區是隨程式提交的對照檔，部署後就有。**看結果要看資料庫，不要只靠日誌**：日誌只看得到最新那次部署的容器（出生、遷入遷出在較早的 deploy 就跑完，07:08Z 的容器日誌只剩所得「各里所得已更新」與新成屋「新成屋已更新」兩行）；背景迴圈的總結行「公開地理資料同步：」只有門牌、幼兒園、人口三項至少一項真的做了事才印（`workers/geo_loop.py`），三項都 skipped（30 天內不重抓）時不會有，沒看到不是異常。查法：Railway Postgres 的 **Database** 分頁（Console 分頁是容器裡的 bash，不是 SQL 視窗；要在 Console 用 `psql "$DATABASE_URL"`）跑 `select dataset, label, synced_at, checked_at, last_error from geo_dataset_status order by 1;`，另可看 `select count(distinct month) from geo_village_births;`、`select count(*) from geo_new_home_sales;`。日誌：`railway logs -p <project> -e production -s api -d --since 3h -n 3000 -f 'admissions.geo'`（`-n` 上限比 20000 小，3000 可用；`-f` 是伺服器端文字篩選，Python 日誌走 stderr，別用 `@level`）；auto 模式會擋 agent 讀正式環境日誌，要使用者用 `!` 跑。
  - Railway 能不能連上面三個來源：沒實測。
  - 登入後的畫面（里的變化表、所得欄、依國小學區表、地圖「孩子增減」）：只有本機 Playwright 截圖與 CI 的 E2E。
  - B2（新成屋上畫面）要先在台灣網路跑 `geo_match_report.py --new-homes` 量命中率（到里 ≥ 90%）。

## 2026-10-14 深度掃描 14 項中的 13 項（main CI 部署，沒有 migration）

- **提交**：`abc994ce`（`fix/security-scan-20261013`，base 為 main `2a4710c6`）由使用者推上 main，`2a4710c6..abc994ce`。內容見 README 頂部 10-13「深度掃描 14 項」段落；第 14 項（編輯直接改已發布素材的替代文字與裁切）等業主決定，沒改。
- **migration**：無。API 介面與契約都沒動。沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **推送前閘門**（合併後的樹，本機）：
  - 受影響的後端測試 1182 passed；對假日休園新進程式碼重跑交集 171 passed；`export_openapi.py --check` 與 `check-contract-types.mjs` 一致。
  - admin `vue-tsc -b --noEmit` 通過、`authGuardSwitchUser.test.ts` 20 passed。
  - 後端全套、stack e2e、web 單元測試沒在本機重跑，交給 CI。
- **CI**：main run 38508036535（`abc994ce`），03:47:10Z 排進佇列（前一個 run `2a4710c6` 還在跑），03:53:11Z 開跑，04:07Z 結束。Backend 三組 9.1／7.3／8.8 分、Frontend web 1.3 分、admin 4.9 分、Deploy Railway production 4.6 分，都成功；**E2E／Playwright 失敗 1 條**（133 passed），Deploy 不等 E2E，所以部署照常完成：
  - `editor-live-preview.spec.ts:413`「資安（真瀏覽器）：草稿不進預覽網址、storage…」斷言 `sessionStorage` 必須是空的，而第 6 項新增的 `ivy-visit-note-draft-owner`（只存登入者編號，不含任何草稿文字）讓它多出一個 key。是本次改動造成的測試斷言過嚴，不是功能問題。
  - 修正：斷言改成排除這個 key（草稿文字的 token 比對照舊）。本機 `npm run e2e:build` 後只跑這條（加 setup）2 passed；storage 實測只有 `ivy-visit-note-draft-owner` 一個 session key。其餘 133 條在 CI 上已通過。
- **正式 `release.json`**：base commit `abc994ceb9e530fc4a65dd5c2b4eea4f24b89ed2`，snapshot `59728a56…`，created `2026-10-14T04:02:53Z`，`web+api`。
- **線上唯讀檢查**（未登入，04:1x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`fixture_enabled: false`，`last_failed_steps` 為空（背景工作 04:09:53Z 完成一輪、無失敗步驟）。
  - 首頁、入學、特色教學、關於、環境、預約、義華預約、`/admin/` 都回 200（0.15–0.48 秒）。
- **未在線上驗證**：
  - 預約連結／session、改密碼、Google／LINE 綁定的競態：都需要真並發與登入，只有本機真並發測試。
  - 保存政策清理（第 8 項）下次排程才會碰到正式資料；清理會順手補清「已標記匿名化卻還有個資」的舊案。
  - 公開資料同步的大小與時間上限（第 12、13 項）：自動同步在正式站仍是關閉的，沒用真實來源實測；正式資料若超過上限，同步會失敗並把原因寫進狀態列。
  - 備份／還原（第 9 項）：只有手動執行，下次備份時 DSN 若帶了不認得的參數，腳本會拒絕執行。
- **測試斷言修正的第二次部署**：`025f502d` 與本紀錄 `c056b2c9` 由使用者推上 main（`abc994ce..c056b2c9`）。動到 `tests/`，所以又跑一次完整 CI 並重新部署同一份應用程式碼（內容沒變）：
  - main run 38512541226（`c056b2c9`），04:39:47Z 開跑，04:57:41Z 部署完成，**全綠，含 E2E／Playwright 8.0 分**（上一個 run 失敗的那條已通過）。
  - Backend 三組 12.6／7.4／9.0 分、Frontend web 1.5 分、admin 4.4 分、Deploy Railway production 5.2 分。
  - 正式 `release.json`：base commit `c056b2c92866f417c2d0258259fbdf793c06f797`，snapshot `633034ef…`，created `2026-10-14T04:52:52Z`，`web+api`。`/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。

## 2026-10-14 bug 盤點兩條修正：站內換頁回首頁的布幕蓋層、排程發布與退回審核死結（main CI 部署，沒有 migration）

- **合併**：PR #41（`feature/fix-entrance-publish-lock-20261014`，head `d6162142`）由 GitHub 以 merge commit 併入 main `3a047c29..93ddc9b1`。內容：
  - `web/app/utils/entrance-policy.ts`：開場 bootstrap 只有 SSR 解析中的那一份能啟動。
  - `backend/app/content/publish_jobs.py`：排程先拿站台鎖，再鎖排程列。
  - 對應測試。
  - 細節見 README 頂部 10-14 段落、DESIGN.md 最上方一節。
- **migration**：無。API 介面與契約都沒動。沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **推送前閘門**：本機結果見 README 頂部同名段落。PR 上的 CI 全綠：web、admin、後端三組、stack e2e。
- **CI**：main run 38498704758（`93ddc9b1`），02:00:00Z 開跑，02:20:17Z 部署完成，全綠：
  - Frontend web 1.5 分、admin 6.0 分。
  - Backend 三組 10.0／9.0／11.2 分。
  - E2E／Playwright 8.1 分。
  - Deploy Railway production 9.0 分。
- **正式 `release.json`**：base commit `93ddc9b1406243a6fc360a2bb4b8536c75c6ad74`，snapshot `298e3608…`，created `2026-10-14T02:11:43Z`，`web+api`。
- **線上唯讀檢查**（未登入，02:2x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`fixture_enabled: false`，`last_failed_steps` 為空。
  - 首頁、入學、特色教學、關於、環境、消息、30 週年、預約八頁都回 200（0.43–0.81 秒）。首頁 HTML 已帶新的 `document.readyState!=='loading'` 判斷。
  - Chromium headless，1440 與 390 兩種寬度：
    - 先進 `/admission` 再點校徽回首頁：不再出現布幕蓋層，`data-ivy-entrance` 維持空值。
    - 首次進首頁：開場照常播。把網路估計固定成 4g 時，標記 4 ms 設成 pending，約 1 秒開出布幕對話框；手機 5.7 秒收掉，桌機 11.0 秒收掉。
    - 同一工作階段再從內頁回首頁也沒有蓋層。
  - 沒固定網路估計時，Chromium 偶爾把這條連線估成 3g，這時開場本來就不播（既有的慢網路判斷），與這次修正無關。
- **未在線上驗證**：
  - 排程發布與退回審核的死結需要真並發，線上沒有重現；以真 PostgreSQL 並發測試為準（舊程式 `DeadlockDetectedError`，修正後連跑 5 次都過）。
  - Safari／iOS 實機。

## 2026-10-13 全站精修：以國際設計獎的完成度逐頁檢查（main CI 部署，沒有 migration）

- **合併**：PR #37（`claude/award-polish-20261013`，head `cda82b6c`）由 GitHub 以 merge commit 併入 main `ca6d2132..25b166b9`。只改官網 `web/`（各頁版面、文字換行、圖片 sizes、30 週年開場動畫、特色教學水彩上色方式）與 README／DESIGN。內容見 README 頂部 10-13「全站精修」、DESIGN.md 最上方一節。
- **migration**：無。後端、API、契約都沒動。沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **推送前閘門**（合入 `ca6d2132` 之後）：web typecheck 通過、vitest 101 檔 1225 過；PR 上每一批的 CI 全綠（web、admin、後端三組、stack e2e）。改版前後同機 Lighthouse A/B 沒有退步（數字見 README）。
- **CI**：main run 38478756505（`25b166b9`），22:35:03Z 開跑，22:51:27Z 部署完成，全綠：
  - Frontend web 1.2 分、admin 4.4 分；Backend 三組 9.7／10.0／11.5 分；E2E／Playwright 10.7 分；Deploy Railway production 4.8 分。
- **正式 `release.json`**：base commit `25b166b912cbe62bce1935495521c3da691a3a3f`，snapshot `1f87d461…`，created `2026-10-13T22:47:08Z`，`web+api`。
- **線上唯讀檢查**（未登入，23:0x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`fixture_enabled: false`，`last_failed_steps` 為空。
  - 首頁、入學、特色教學、關於、環境、消息、30 週年、預約八頁都回 200（0.44–0.65 秒）；Chromium 1440 開過八頁，沒有 console 錯誤、沒有水平溢出。
  - 八頁都載到新的 `::selection` 規則；入學頁有補助券直排編號（`.ap-tcy`）與 `.ap .ap-slots` 間距規則。
- **未在線上驗證**：
  - 特色教學水彩的新顏色只在本機與截圖看過，**待業主確認**。
  - Safari／iOS 實機、真機 GPU 下的首頁開場效能。
  - 正式站的消息是園方發布的內容（有 campusKeys），校區篩選的修正主要影響示意消息，線上沒有逐校點過。

## 2026-10-13 審查四條修正：招生機會缺人口資料／舊月份人口檔、預約取鎖後重讀場次（main CI 部署，沒有 migration）

- **提交**：直接推 main，`fbed245a..d3486cac` 兩個 commit（`4fd5f3b0` 招生、`d3486cac` 預約）。內容見 README 頂部 10-13「審查四條修正」。
- **migration**：無。API 回應只新增 `no_population_villages[]`（契約已重新產生），資料表沒動。沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **推送前閘門**：
  - 兩條招生在 `8c4ec20a` 上：後端全套 2584（2494 passed、1 skipped；另 89 個先前因 sparse worktree 缺 `web`／`deploy` 目錄而 `FileNotFoundError`，補檔後全過）、admin vitest 2306 passed、`vue-tsc` 無錯、`contract:check` 一致。
  - 兩條預約在 `8c4ec20a` 上：後端全套 2582（2581 passed、1 skipped、1 failed）。唯一失敗是 `test_referral_text_matches_admin_labels`，原因是該 worktree 沒有 `admin/src/api/labels.ts`；補檔後單獨跑 14 passed。新增 `test_booking_stale_reads.py` 5 個（真並發），撤掉修正時 5 個全紅、套回後連跑 8 次全過。
  - 接上 `fbed245a`（含別的 session 併入的場次使用情況與新 migration `b4d7e1a92c58`）後：測試庫升到 head，預約／場次／招生機會／門牌相關 379 passed；`contract:check` 一致；`areaFormat`、`areaMap` vitest 71 passed；`vue-tsc` 無錯。接上 `72d0f933` 時另跑過招生與預約相關 44 個檔共 1085 passed。
- **CI**：main run 38419719691（`d3486cac`），建立 15:10:15Z，排在 run 38418981759（`fbed245a`）之後，15:22:38Z 開跑，15:39:55Z 部署完成，全綠：
  - Frontend web 1.9 分、admin 10.1 分；Backend 三組 9.8／7.9／11.6 分；E2E／Playwright 8.9 分；Deploy Railway production 5.6 分。
- **正式 `release.json`**：base commit `d3486cac876b819d5d9175ca62e917a1b7214591`，snapshot `4dcc468f…`，created `2026-10-13T15:34:43Z`，`web+api`。
- **線上唯讀檢查**（未登入，15:4x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。
  - 後台 `areaFormat-BVrl5a8-.js` 含「沒有人口資料」「沒算進去」；`AreaMap-DPtlKTyX.js` 含「沒有算進附近平均」。
- **未在線上驗證**：
  - 預約兩條的競態需要真並發，線上沒有重現；以上述真 PostgreSQL 並發測試為準。
  - 沒登入後台看地圖畫面；正式站的人口資料有沒有缺里也沒查。
  - 舊月份人口檔的擋下只在測試庫驗證過，正式站下一次匯入時才會碰到。

## 2026-10-13 場次使用情況（main CI 部署，migration 只新增一張表）

- **合併**：使用者在本機直接推 `feature/visit-slot-usage-20261013` 到 main（fast-forward `b6cc2f4d..fbed245a`，15 個 commit，沒有開 PR）。內容見 README 頂部 10-13「場次使用情況」、DESIGN.md「參觀場次：場次使用情況」、規格 `docs/specs/2026-10-13-visit-slot-usage-design.md`。
- **migration**：`f3c8a2d47b19` → `b4d7e1a92c58`，新增 `slot_lookup_daily`（日×校×五區間→次數）。不改既有資料，所以沒有先備份。API 啟動時自動 `alembic upgrade head`；部署成功表示已套用，**沒有直接查 `alembic_version`**。
- **回退**：舊映像不認得 `b4d7e1a92c58`，`check_schema.py` 會擋（見 CICD.md）。要退先用新映像跑 `alembic downgrade f3c8a2d47b19`（刪掉 `slot_lookup_daily`，已記的次數一併消失），再切舊映像。
- **推送前閘門**：本機結果見 README 頂部同名段落。對齊 main `72d0f933` 後：完整 stack 套件 134 passed、後端相關檔 191 passed、admin 相關 116 passed、web 相關 70 passed、`contract:check` 一致。後端全套 2626 passed 是對齊前、最終審查修正前跑的。
- **CI**：main run 38418981759（`fbed245a`），建立到部署完成 17.5 分鐘，全綠：
  - Frontend web 1.4 分、admin 5.5 分；Backend 三組 11.4／10.2／12.2 分；E2E／Playwright 11.0 分。
  - Deploy Railway production 5.1 分，成功。
- **正式 `release.json`**：base commit `fbed245a8d1d176a7f289d9cfbb9ad4beda64f01`，snapshot `9f265c6e…`，created `2026-10-13T15:17:52Z`，`web+api`。
- **線上唯讀檢查**（未登入，15:3x UTC；刻意不帶 `purpose=new_booking`，避免在正式庫多記一筆）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。
  - `GET /public/slots?campus_key=yihua&date_from=…&date_to=…`（不帶 `purpose`）回 200 與場次清單；`purpose=bogus` 回 422（`Input should be 'new_booking'`）。
  - 未登入 `GET /admin/visit-slot-usage?campus_key=yihua&weeks=4` 回 401，路由已上線。
  - 後台 chunk：`VisitCalendarView-CjgI1sJp.js` 有「場次使用情況」「最早能約哪天」與 `SlotUsagePane`。
- **未做**：沒有登入正式後台看「場次使用情況」頁籤的實際畫面；沒有查 `slot_lookup_daily` 的列數（新預約表單要有家長打開才會開始累積，剛上線是空的，頁面會寫還沒有記錄）；沒有讀 Railway log。
  - 唯讀查法：`select day, campus_key, bucket, lookups from slot_lookup_daily order by day desc, campus_key, bucket limit 20;`（一天一校一區間一列）。

## 2026-10-13 效能第五輪（main CI 部署，沒有 migration）

- **合併**：PR #36（`feature/perf-20261013`，head `3390d6ae`）由 GitHub 以 merge commit 併入 main `8c4ec20a..72d0f933`。內容見 README 頂部 10-13「效能第五輪」、DESIGN.md 最上方一節。
- **migration**：無。後端只改可能範圍的快取與門牌／幼兒園同步的解析位置，API 與契約沒改。沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **推送前閘門**：本機結果見 README 頂部同名段落（web unit 1170、admin 2306 passed、後端全套 2578 passed、`contract:check` 一致、stack e2e 以 Chromium 跑）。PR 上的 CI（`3390d6ae`）全綠。
- **CI**：main run 38410820917（`72d0f933`），建立到部署完成 22.8 分鐘，全綠：
  - Frontend web 1.3 分、admin 5.9 分；Backend 三組 9.7／9.6／12.1 分；E2E／Playwright 8.1 分。
  - Deploy Railway production 約 10.5 分，成功；其中 checkout 一步就花了 6.1 分，比前幾次慢。
- **正式 `release.json`**：base commit `72d0f9339b77c25a95eb4e4f81fe04efa3dd3e63`，snapshot `60a52996…`，created `2026-10-13T14:27:05Z`，`web+api`。
- **線上唯讀檢查**（未登入，14:3x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。
  - `/`、`/about` 的 HTML 帶 `content-encoding: br`（SSR 壓縮改非同步後照常）。
  - 代理壓縮 JSON：`/api/website/v1/public/site` 帶 `Accept-Encoding: gzip` 回 `content-encoding: gzip`、`vary: Accept-Encoding`，4,438 bytes（不壓 9,479），解壓後和不壓的內容逐位元組相同。
  - 後台：`/admin/` 多了 `vue-C-Nk7iAn.js`、`labels-BeXPTfd5.js` 兩個 chunk。`DashboardView-b_2XoL6Y.js` 只動態載入 RecordDialog；`AdmissionsView-COPbQE1j.js` 動態載入 RecordsTab、StatsTab（RecordDialog 仍是漏斗看板的靜態依賴）。
  - `/about` 的 motion chunk `BHDyLS79.js` 原始 68,562 bytes（原本約 135 KB），以 brotli 送。
- **未做**：沒有登入正式後台實際操作總覽標記到場、區域分析換著色；沒有讀 Railway log；門牌同步改執行緒解析要等下次換月或 `--force` 才會跑到。

## 2026-10-13 招生機會地圖（main CI 部署，migration 只新增表並放寬一個約束）

- **合併**：PR #34（`claude/amazing-cannon-0cqnpc`，head `ad66341e`，其中 `ee3170ff` 已合入 PR #33 的 main `00428c2f`）由 GitHub 以 merge commit 併入 main `00428c2f..58ec755d`。內容見 README 頂部 10-13「招生機會地圖」、DESIGN.md 最上方一節、規格 `docs/specs/2026-10-13-admissions-opportunity-design.md`。
- **migration**：`ad783510900a` → `f3c8a2d47b19`。
  - 新增 `geo_village_population`；把 `geo_dataset_status` 的 dataset 約束重建成多收 `population`。
  - 不改既有資料，所以沒有先備份。API 啟動時自動 `alembic upgrade head`；部署成功表示已套用，**沒有直接查 `alembic_version`**。
- **回退**：舊映像不認得 `f3c8a2d47b19`，`check_schema.py` 會擋（見 CICD.md）。要退先用新映像跑 `alembic downgrade ad783510900a`（刪掉人口表與 `population` 狀態列、約束改回），再切舊映像；匯入過的各里人口一併消失，下次同步重抓。
- **推送前閘門**：本機結果見 README 頂部同名段落（合入 `00428c2` 後重跑：後端 geo 與招生 876 passed、admin vitest 2304 passed、web unit 1157 passed、`contract:check` 一致、stack 20 passed）。PR 上的 CI（`ad66341e`）全綠。
- **CI**：main run 38352283382（`58ec755d`），建立到部署完成 17.8 分鐘，全綠：
  - Frontend web 1.5 分、admin 6.2 分；Backend 三組 12.9／9.3／11.4 分；E2E／Playwright 10.3 分（含 `admissions-area` 新加的兩支與 `exports`）。
  - Deploy Railway production 4.7 分，成功。
- **正式 `release.json`**：base commit `58ec755d2814406fc3cac5b6e8f96837bd1e2483`，created `2026-10-13T05:50:14Z`，`web+api`。
- **線上唯讀檢查**（未登入，05:5x UTC）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空；`/admin/` 200。
  - 未登入 `GET /admin/admissions/area/opportunity?campus_key=yihua&radius_km=3` 回 401（同前綴不存在的路徑回 404），路由已上線。
  - 後台 chunk：`AdmissionsView-DM-6aJgy.js` 有「招生機會」「各里人口」「照附近應有」「顯示全部」；`AreaMap-D4WkKVFh.js` 有「2–5 歲孩子」「明顯偏少」「招生機會讀取中」；`AreaMap-Bz_tNl_i.css`、`index-6Kj4RtFR.css` 有 `--area-chance`。
- **各里人口同步**：正式 api 已設 `WEBSITE_GEO_AUTO_SYNC`（見 10-12「招生入學區域分析」紀錄），所以這次部署後，背景迴圈第一輪（api 啟動約 30 秒後）會因為人口表是空的而立刻去抓內政部 API。**結果還沒看**：沒有讀 Railway log，也沒有登入後台看狀態列。
  - 狀態列寫「各里人口 115 年 9 月」＝成功；寫「各里人口尚未匯入」多半是內政部也擋境外 IP，照下方「公開地理資料同步 → 各里人口」的手動退路匯入。
  - 唯讀查法：`select dataset, label, synced_at, last_error from geo_dataset_status where dataset = 'population';`
- **未做**：沒有登入正式後台看招生機會的實際畫面；正式站目前多是測試參觀資料，判讀多半會寫「附近參觀還不到 10 位，先不判斷」。

## 2026-10-13 參觀預約統計搬到招生入學＋桌機側欄收合（main CI 部署，沒有 migration）

- **合併**：`feature/booking-stats-move-20261013` 的 `da61c64c` 從 `9cb26f26` 開。合入 origin/main `60332d8f`（另一個 session 的桌機側欄收合，README 頂部兩段都留）成 `e1a995b0`，再加 `a5d790cf`（web 偶發測試修正），快轉推 main `60332d8f..a5d790cf`。
  - 這次 run 同時部署兩件：參觀預約統計搬移（README／DESIGN 頂部 10-13「參觀預約統計搬到招生入學」）與桌機側欄收合 `60332d8f`（README／DESIGN 頂部 10-13「後台側欄可以收合」）。
  - 側欄收合自己的 run 38330629293 紅在 web 偶發測試、Deploy 被略過，那個 run 沒有重跑部署，改由這次一起上線。
- **migration**：無。只改後台畫面、測試與文件，後端 API 與契約沒改。沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **web 偶發測試**：`web/tests/about-voices-preview.spec.ts`「影片還在原位時」本機約三成紅。
  - 原因：`vi.mock` 換掉 about-popup 攔不住 `AboutContent.vue` 的動態 `import('~/utils/about-popup')`。async 工廠（`await importOriginal`）還沒跑完時再載入一次，會拿到原模組（側欄 session 查到）。真的立體書動畫在測試等待的 20ms 內載入時，選片被延後。
  - 修法 `a5d790cf`：改走元件本來就有的強制色彩模式，`onMounted` 不載入動畫。本機連跑 10 次全過；拿掉重設邏輯時另外兩項照樣紅。
- **推送前本機閘門**（合入 `60332d8f` 之後）：
  - admin：typecheck 通過，相關 16 檔 223 passed。全套在負載 20–60 下只有逾時，失敗檔逐一單獨重跑全過。
  - web：typecheck 通過，vitest 95 檔 1152 passed。
  - stack：55 passed，含 booking-stats、keyboard、a11y、sidebar-collapse、admissions-flow、visual。
- **CI**：main run 38332211341（`a5d790cf`），建立到完成 17.6 分鐘。
  - 通過：Frontend admin 5.1 分、web 1.4 分；Backend 三組 12.1／9.2／11.2 分；Deploy 5.3 分成功。
  - **E2E／Playwright 紅 1 條**（10.8 分，124 passed、1 failed）：`roles.spec.ts:17`「接待人員…」的 beforeAll 送公開預約拿到 429 `BOOKING_LIMIT`。
  - 原因是新的 `booking-stats.spec.ts` 也從預設來源替義華送了一筆，整套超過同來源、同校每小時 5 筆的上限；本機推前只跑了部分 spec，沒抓到。
  - 修正：那支 spec 改用自己的 `X-Forwarded-For`（198.51.100.41），和這份紀錄同一個提交。E2E 不擋部署，線上不受影響。
  - 修正後本機跑完整 stack 套件兩輪：
    - 第一輪 126 passed、1 failed：`booking-flow.spec.ts:217` 送單時「yihua 沒有可預約的場次」，逾時。義華只開 3 場 × 3 位，整套共用。這支排在 booking-stats 之前，CI 上也過，判斷為既有的偶發。
    - 第二輪 127 passed。
- **正式 `release.json`**：base commit `a5d790cf`，created `2026-10-13T01:40:04Z`，`web+api`。
- **線上唯讀檢查**（未登入）：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。未登入 `GET /admin/analytics/funnel` 回 401。
  - `AnalyticsView-DbirriHs.js` 有「官網的瀏覽量與網頁速度」，沒有「預約流程」「查看校區」。
  - `AdmissionsView-D7-6-tzD.js` 有「參觀預約」「這個分頁不分入學學年學期」「預約流程」「預約孩子的班別」與 `stats-booking`。
  - 側欄（側欄 session 檢查）：`index-Hxbjo34A.js` 有「收合側邊欄」「展開側邊欄」與 `ivy-admin-sidebar-collapsed`，CSS 有 `--side-w-collapsed:64px`。
- **未做**：沒有登入正式後台實際看參觀預約子分頁與側欄收合。

## 2026-10-13 後台與官網內容一批補強（main CI 部署，migration 只新增表）

- **合併**：
  - `feature/admin-batch-20261012` 從 `371b0e99` 開。
  - 中途合入 origin/main（預繳速度、區域分析定位、門牌檔案匯入、手機 UX），沒有衝突。
  - 使用者快轉推 main `e144bb78..a13fc430`。
  - 內容見 README 頂部 10-12 同名段落、規格 `docs/specs/2026-10-12-admin-batch-design.md`、計畫 `docs/superpowers/plans/2026-10-12-admin-batch.md`。
- **migration**：
  - `ad783510900a` 只新增 `contact_phrase_sets`，並插入 `key='default'` 的 6 句預設片語（`ON CONFLICT DO NOTHING`）。
  - 不改既有資料，所以沒有先備份。
  - API 啟動時自動 `alembic upgrade head`。
- **回退**：
  - 可直接切回前一個映像。舊程式不讀這張新表，留著無害。
  - `site_meta` 新存的版本不再帶 `admission_title／description`，而是寫進 `page_seo.admission`。
  - 回退後，舊程式讀不到新結構，入學頁搜尋標題會顯示內建文字。正式站目前沒設過這兩欄，所以實際沒有差別。
- **打包變更**：
  - `content/` 已刪，`deploy/api.Dockerfile` 改成把 `web/server/data/site-fixture.json` 複製到 `/app/content/site-fixture.json`，正式站指令路徑不變。
  - `railway_ci.py` 的 `SOURCE_PATHS` 已拿掉 `content`。
  - 環境頁字型目錄從 8.2 MB 增為 14 MB。
- **推送前本機閘門**（10-13，HEAD `a13fc430`）：
  - 後端全套 2503 passed、1 skipped。
  - web unit 1152 passed；admin unit 2250 passed、1 skipped；兩邊 typecheck 通過。
  - `contract:check` 一致；deploy tests 通過。
  - stack e2e 全套 117 passed。
- **CI**：main run 38320751399（`a13fc430`）全綠，從建立到完成 17.3 分鐘。各 job 耗時：
  - Frontend：admin 5.7 分、web 1.3 分。
  - Backend 三組：11.8／8.0／11.1 分。
  - E2E／Playwright：10.0 分。
  - Deploy：5.4 分。
- **正式 `release.json`**：base commit `a13fc430`，created `2026-10-12T23:23:22Z`，`web+api`。
- **線上唯讀檢查**（10-13 07:30 左右，台北）：
  - **健康檢查**：`/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。
  - **頁面**：`/`、`/about`、`/admission`、`/environment`、`/curriculum`、`/news`、`/anniversary` 都 200，`<title>` 是內建值。
    - 已發布的 `site_meta` 只有初始化的四欄，沒有 `page_seo`。
    - `/privacy` 仍是 404，因為隱私權政策還沒發布，和部署前相同。
  - **環境頁與關於頁**：
    - `/environment` 第四章新句子「空間配置各校不同…各校的教室」已上線，舊的「取自各分校頁」已不見，五校分頁在。
    - `/about` 有 `#voices`。
    - `/assets/fonts/chars-environment.txt` 回 200。
  - **新端點未登入一律回 401**：`GET /admin/contact-phrases`、`GET /admin/admissions/area/boundaries`、`PATCH /admin/visit-requests/{id}/details`。
  - **後台 chunk**：
    - `ContactPhrasesView` 有「聯絡片語」「新增一句」。
    - `EnvironmentPageView` 有「首屏大標」。
    - `SiteMetaView` 有「各頁搜尋與分享」「機構社群」。
    - `CampusProfileView` 有「家長分享影片」。
- **未做**：
  - 沒有登入正式後台實測：改家長資料、片語、各頁搜尋設定、里界 gzip 都要登入才看得到。
  - LINE 通知連結沒有在真的 LINE 裡點過。
  - 正式站 `environment_page` 沒有已發布版本，官網用內建內容；第一次在後台存檔發布後才會有。
  - Railway api 上殘留的 `WEBSITE_INDEXING_ENABLED` 不擋啟動，可自行刪除。

## 2026-10-12 招生統計：預繳速度與可能範圍（main CI 部署，沒有 migration）

- **合併**：`feature/admissions-deposit-pace-20261012` 從 `f09ad269` 開，推前兩次合入 origin/main（`cb26e52b` 區域分析後續、`b56d5ee1` 其部署紀錄；衝突只在 README 頂部段落，兩邊都留，契約重產後與自動合併一致），快轉推 main `b56d5ee1..ee62f74b`。內容見 README 頂部同日段落、DESIGN.md「招生統計：預繳速度與可能範圍」、規格 `docs/specs/2026-10-12-admissions-deposit-pace-design.md`。
- **migration**：無。API 只新增欄位（`/stats` 的 `deposit_timing`、`deposit_pace`，各統計列的 `visit_to_deposit_range`），「本月漏斗轉換下滑」「來源結構失衡」兩個警示的判斷與文案改了（轉移契約第 19 點）。只讀計算、不改資料，沒有備份。
- **回退**：可直接切回前一個映像，資料不受影響。
- **推送前本機閘門**：合入 `cb26e52b` 後，後端全套 2012 passed、1 skipped，另有 2 個媒體測試因共用暫存目錄與筆電睡眠失敗，單獨重跑 47 passed；admin typecheck、build 通過，vitest 全套只有負載逾時，單獨重跑 63 passed；web typecheck、vitest 934 passed；`contract:check` 一致；stack 招生三支 14 passed。`b56d5ee1` 只動文件。
- **CI**：main run 38238777687（`ee62f74b`）全綠，建立到完成 14.3 分鐘。各 job：Frontend admin 3.8 分、web 1.1 分；Backend 三組 9.6／7.6／8.2 分；E2E／Playwright 9.7 分；Deploy 4.5 分。
- **正式 `release.json`**：base commit `ee62f74b`，created `2026-10-12T11:00:05Z`，`web+api`。
- **線上唯讀檢查**：
  - `/api/website/v1/health` 回 `status: ok`，`last_failed_steps` 為空。
  - 未登入 `GET /admin/admissions/stats?campus_key=yihua` 回 401。
  - 後台 chunk `AdmissionsView-CUj_IBAC.js` 有「怎麼看可能範圍與預繳速度」「預繳速度」「實際預繳過」「還沒有家長參觀滿」「往這張表的全體平均靠」與 `visit_to_deposit_range`。
  - 共用表格所在的 `AnalyticsExplainer-DTvLhzyW.js` 有 CSV 的「下限」「上限」。
- **未做**：沒有登入正式後台實際看統計。正式庫目前是測試資料，預繳速度卡應顯示「預繳過的家長還不到 10 位」，兩個警示暫時不判斷。

## 2026-10-12 區域分析打開就定位在分校、文案與手機表格小修（main CI 部署）

- **合併**：`feature/admissions-area-locate-20261012` 的 `cb26e52b` 從 `371b0e99` 開，快轉推 main `371b0e99..cb26e52b`。內容與驗證見 README 頂部同日段落。
- **migration**：無（API 只多 `campus.district`）。沒有備份。
- **CI**：main run 38207828613（`cb26e52b`）全綠，建立到完成 14.8 分鐘：Frontend admin 3.9／web 1.1 分鐘，Backend 三組 7.3／7.5／9.0 分鐘，E2E／Playwright 9.8 分鐘，Deploy 5.7 分鐘。本機因高負載沒跑完的後端全套由這次 CI 補上。
- **正式 `release.json`**：base commit `cb26e52b`，created `2026-10-12T05:34:30Z`，`web+api`。
- **線上唯讀檢查**：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；未登入 `GET /admin/admissions/area?campus_key=yihua` 401。後台 chunk：`AreaMap-Cn_5H0uS.js` 有「地圖先顯示」、`AdmissionsView-MI8_9Ojh.js` 有「算不出距離；匯入後自動補上」「幼兒園名單尚未匯入」、`StatsDimensionTable-BHDqJOdV.js` 有 `stats-table__name-link`；舊文案「匯入後會自動比對」「幼兒園資料尚未匯入」掃 98 個 chunk 都沒有。用使用者已登入的瀏覽器讀義華區域分析：圖例下「本校位置未標示（門牌資料尚未匯入），地圖先顯示三民區。」，底圖 zoom 13、893 個里界。
- **地理同步**：使用者已在 api 設 `WEBSITE_GEO_AUTO_SYNC`（只看變數名稱、沒看值）。部署後 05:36 第一輪：幼兒園匯入成功（狀態列「幼兒園名單 10/12 更新」）；**門牌失敗「下載或匯入失敗：ConnectTimeout」**——api 連 `data.kcg.gov.tw` 15 秒內連不上（同時間從本機連 0.19 秒、200）。門牌沒有使用中版本時每一輪都會重試，但背景迴圈一天才一輪。是偶發還是平台擋境外 IP 待查，本校座標、里與距離要等門牌匯入。
- **門牌改用檔案匯入**（台北 19:02 另一個 session 部署讓 api 重啟，自動同步又試一次，仍是 ConnectTimeout；兩次都失敗，判斷是平台擋 Railway 的境外 IP、不是偶發）：使用者依序執行 `railway volume … files -v api-volume upload <本機 115-10 CSV，107,127,922 bytes> /doorplates-115-10.csv`（volume 根目錄＝容器 `/data`，上傳後 `files list` 大小相符）、`railway ssh … --service api -- python -m app.cli geo-sync --doorplates-file /data/doorplates-115-10.csv`，輸出「門牌：updated（使用中 115-10）；幼兒園：skipped；重算訪視 2 筆」。用使用者已登入的瀏覽器讀義華區域分析：狀態列「門牌資料 115 年 10 月版・幼兒園名單 10/12 更新」，本校星號在地圖正中央（681×520 的 341, 260）、3 公里圈 340px、zoom 13，附近幼兒園列 20 所，原本待比對的那筆訪視到里、距離分布有數字。使用者誤把匯入指令再跑一次，輸出相同（新批次取代舊批次、舊批次自動刪，無重複）。CSV 用完後刪除：Railway CLI 拒絕由 agent 執行 `files … delete`（「agents cannot delete files」），由使用者在自己的終端機刪；之後 `files list` 只剩 `lost+found`、`media`。
- **未做**：沒有在正式站實際點換半徑、手機排行的名稱連結（本機真瀏覽器驗過）；Safari／iOS 實機。

## 2026-10-12 參觀案件可以提早完成參觀（main CI 部署，沒有 migration）

- **合併**：`feature/visit-complete-early-20261012` 的 `f09ad269`（從 origin/main 開，推前兩次 rebase 接上 `c7cbe1bc` 區域分析與 `6fcd3911` 其部署紀錄，衝突只在 README、DESIGN 頂部段落，兩邊都保留），快轉推 main `6fcd3911..f09ad269`。內容與規則見 README 頂部 2026-10-12 段落、DESIGN.md「提早完成參觀」。
- **migration**：沒有。提早到、約在之後日子的案件把 `slot_id` 設成 NULL（資料表只要求「已確認」有場次），不改結構。
- **回退**：可直接切回前一個映像；已用新端點標記的案件仍是一般的「已到場」，舊版照常顯示（釋出場次的那幾筆列表寫「沒有場次」）。
- **推送前本機閘門**：rebase 前後端全套 1704 passed、1 skipped，admin vitest 全套 1862 passed（2 項負載逾時，單獨重跑過），web vitest 933 passed、typecheck；接上 `c7cbe1bc` 後重跑 `contract:check`、admin typecheck、後端受影響 7 檔 63 passed、admin 相關 7 檔 87 passed，重新 build 後 stack 新 spec＋`visual.spec` 5 張基準 8 passed（admin 全套在本機負載 109 時有 73 項逾時，改由 CI 判定）。`6fcd3911` 只動文件，程式與已驗證的 `1d1670f8` 相同。
- **CI**：main run 38191155223（`f09ad269`）全綠，建立到完成 14.5 分鐘：Frontend web 1.4／admin 4.9 分鐘，Backend 三組 9.8／5.7／9.4 分鐘，E2E／Playwright 8.6 分鐘，Deploy 4.5 分鐘。
- **正式 `release.json`**：base commit `f09ad269132e5e97df40920802c67f7d6b169c85`，created `2026-10-12T01:25:23Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 為空；`POST /admin/visit-requests/<uuid>/complete-early` 401（對照 `/complete` 401、不存在的路徑 404，路由已掛）；後台 bundle 的 `VisitCaseTimeline-*.js` 含「家長提早到了」與 `complete-early`，`labels-*.js` 含「提早標記已到場」。
- **未做**：沒有登入後台實際按過（正式站預約都是測試資料，要試請挑測試案件）；部署期間開著的舊後台分頁要重新整理；Safari／iOS 實機。

## 2026-10-12 招生入學區域分析（main CI 部署，含 1 支只新增表的 migration；自動同步仍關）

- **合併**：`feature/admissions-area-20261008`（44 個 commit，含 `a85aecba` 合入後台工程清理）快轉推 main `41345e1a..c7cbe1bc`。內容、設計與驗證見 README 頂部 2026-10-08 段落與 `docs/specs/2026-10-08-admissions-area-design.md`；延後項目在 `docs/superpowers/plans/2026-10-08-admissions-area-followups.md`。
- **migration**：正式庫 `a9e11038c869` → `e7a1c4d9b2f6`（只新增 `recruitment_visit_geo`、`geo_doorplates`、`geo_kindergartens`、`geo_dataset_status` 四張表，不改既有資料，所以這次沒做備份閘門）。API 啟動時自動 `alembic upgrade head`；部署成功表示已套用，**沒有直接查 `alembic_version`**。
- **回退**：舊映像不認得新 revision，不能直接切回；要回退先用新映像跑 `alembic downgrade a9e11038c869`（刪掉四張表，區域分析的比對結果與公開資料一併消失）再切舊映像。
- **推送前本機閘門**（合入 origin/main 之後重跑，皆本機結果）：後端全套 1964 passed、1 skipped；admin vitest 144 檔 1960 passed、1 skipped；web vitest 85 檔 934 passed；`contract:check`、admin typecheck 通過；`alembic heads` 單一，降級再升級成功；stack e2e 完整套件 107 passed（專屬庫與 port）。
- **CI**：main run 38189062589（`c7cbe1bc`）全綠：Frontend web 1.0／admin 4.0 分鐘，Backend 三組 8.6／10.9／6.8 分鐘，E2E／Playwright 9.9 分鐘，Deploy Railway production 成功。
- **正式 `release.json`**：base commit `c7cbe1bc0dc77d80c29ebee9a31c0353ef0d4764`，created `2026-10-12T00:54:35Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/admin/` 200，其 CSP 的 `img-src` 含 `https://wmts.nlsc.gov.tw`、公開首頁的 CSP 不含；`/api/website/v1/health` `status: ok`、`background_jobs.last_failed_steps` 為空；`/admin/admissions/area`、`/area/boundaries`、`/options` 皆 401，路由存在，也代表正式站招生功能開關是開的（開關關閉時是 404）。
- **目前狀態**：沒有設 `WEBSITE_GEO_AUTO_SYNC`（預設關），所以區域分析預期顯示「門牌資料尚未匯入」，地圖與距離分布要等門牌匯入後才有內容。**沒有登入後台實測、沒看過實際畫面**。要開同步：照下方「公開地理資料同步」，先確認 Railway PG 剩餘空間 ≥ 500MB，再設 `WEBSITE_GEO_AUTO_SYNC=true` 並重新部署。
- **2026-10-12 補**（區域分析定位那一輪）：用使用者已登入的瀏覽器看了正式站義華的區域分析：門牌、幼兒園都沒匯入，本校沒座標，地圖框住整個高雄（畫面是嘉義到台東）。`railway volume list` 顯示 Postgres volume 1133MB／50000MB，空間條件（≥ 500MB）已滿足；同步仍未開。

## 2026-10-09 後台工程清理：刪改期申請／FAQ／site_settings、素材分頁、一次標完已讀（main CI 部署，含 3 支刪表刪資料 migration）

- **合併**：`chore/admin-cleanup-20261008` 的 `826b78fe`（程式與測試）、`9e89b8ff`（文件）從 `82937a9f` 開，快轉推 main `82937a9f..9e89b8ff`。內容、上線前步驟與驗證見 README 頂部 2026-10-08 段落。
- **migration**：正式庫 `c4e8a2f61b97` → `304dd12e96bc`（drop `site_settings`）→ `e48a3ccedcd8`（drop `reschedule_requests`）→ `a9e11038c869`（刪 FAQ 內容，downgrade 不還原）。**使用者 10-09 裁定正式庫資料都是測試資料，這次不備份**，也沒有先查正式庫的待核准改期申請與 FAQ 筆數。API 啟動時以 `check=True` 跑 `alembic upgrade head`（`deploy/api-start.py:46`），失敗就不會啟動；部署後 health 正常，表示三支已套用（沒有直接查 `alembic_version`）。
- **回退**：舊映像不認得新 revision，不能直接切回；要回退先用新映像跑 `alembic downgrade c4e8a2f61b97`（重建兩張空表，FAQ 資料回不來）再切舊映像。
- **推送前本機閘門**：後端 pytest 全套 1695 passed、1 skipped、1 failed（寫死 head 的測試，修正後該檔 8 passed）；admin vitest 138 檔 1855 passed、1 skipped，typecheck、build；web vitest 85 檔 933 passed，typecheck、build；`contract:check`、`deploy/check_schema.py`、`deploy/tests` 通過；stack 104 項 103 passed，唯一失敗是 `admissions-follow-up.spec.ts` 的台北 00–01 點時間相依，01:08 單獨重跑 passed。台北週五當天先跑過 `test_booking_consent_readiness`、`test_booking_concurrency`（31 passed），沒有擋部署。
- **CI**：main run 37854413799（`9e89b8ff`）全綠，建立到完成 13.6 分鐘：Frontend admin 3.8／web 1.4 分鐘，Backend 三組 8.2／7.3／6.4 分鐘，E2E／Playwright 7.1 分鐘，Deploy 5.3 分鐘。
- **正式 `release.json`**：base commit `9e89b8ff`，created `2026-10-08T22:44:00Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/`、`/visit`、`/about`、`/environment`、`/admission`、`/curriculum`、`/anniversary`、`/admin/login`、`/sitemap.xml` 皆 200；`/api/website/v1/health` `status: ok`、`media_jobs.enabled: true`。`POST /admin/notifications/read-all`、`GET /admin/media` 401（端點存在）；`/admin/reschedule-requests`、`/admin/site-settings`、`/admin/content-kinds` 404；`/admin/visit-requests/group-counts` 401（被 `/admin/visit-requests/{id}` 接住、先擋登入，端點已刪）；公開 `reschedule-request` 410。`/public/site` 沒有 `shared_faq`／`campus_faq`，`booking_content` 沒有同意文字與橫幅三欄、`campus_profile` 沒有簡介／詳細介紹／FB 備註。線上後台 `NotificationsView` chunk 有 `notifications/read-all`、沒有 `reschedule-requests`；`MediaLibraryView` 有 `state_total`；`MediaPickerDialog` 有「載入更多」。
- **未做**：沒有登入後台實際操作（全部標記已讀、素材分頁與選圖器、匯出、即時預覽欄高）；部署期間開著的舊後台分頁要重新整理；Safari／iOS 實機。

## 2026-10-07 後台匯出擴充、參觀案件明細時間線與列表行程清單（C、B）、內容編輯三欄＋即時預覽（D）（main CI 部署）

- **合併**：整合分支 `merge/admin-bcd-20261007` 從 `feature/admin-exports-20261006`（`bfe9b924`）開，依序合入 origin/main（`2510dcfe`）、`feature/admin-visit-ux-20261006`（`983015a1`）、`feature/admin-editor-preview-20261006`（`f1c22e49`），成 `6408063d`，快轉推 main `2510dcfe..6408063d`。衝突只在 README／DESIGN.md／`docs/website-admin/acceptance.md`（各段都保留）與 `backend/app/booking/routes.py`（保留 C、B 的 `GET /admin/visit-requests/view-counts`，刪掉已搬到 `app/common/csv_export.py` 的舊 `_safe_cell`）；`npm run contract:generate` 後契約無變化。內容與各分支驗證見 README 頂部三個 2026-10-06 段落。
- **migration**：無（三個分支都沒有 alembic 版本）。沒有備份。
- **推送前本機閘門**（`6408063d`）：後端 pytest 全套 1681 passed、1 skipped（9 分 54 秒）；admin vitest 136 檔 1798 passed、1 skipped，`npm run typecheck` 無錯；`npm run test:website` 85 檔 931 passed，`npm --prefix web run typecheck` 0 WARN；`npm run contract:check` 一致；`deploy/tests` 通過；`npm run e2e:build` 後 stack 全套 101 passed（4.5 分鐘，`E2E_DB_NAME=ivy_website_mergebcd1007_e2e_test`）。
- **CI**：main run 37617750110（`6408063d`）全綠，建立到完成 14.4 分鐘：Frontend admin 3.9／web 1.4 分鐘，Backend 三組 7.4／7.5／7.9 分鐘，E2E／Playwright 9.0 分鐘，Deploy 6.3 分鐘。
- **正式 `release.json`**：base commit `6408063d`，created `2026-10-07T12:07:07Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/`、`/visit`、`/about`、`/admin/login`、`/sitemap.xml`、`/preview` 皆 200；`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/admin/` 的 CSP 有 `frame-src 'self'`、`frame-ancestors 'self'`；`/preview?embed=1&live=1` 有 `X-Frame-Options: SAMEORIGIN`、`frame-ancestors 'self'`、`Cache-Control: private, no-store`、`X-Robots-Tag: noindex, nofollow`；`/admin/visit-requests/view-counts`、帶 `created_from`／`limit` 的 `/admin/audit-log` 未登入皆 401。線上後台 chunk 找得到 `records/export`、`no-deposit-records/export`、`created_from`、`view-counts`、`visit_asc`、「接下來」「匯出範圍」「草稿有」「和官網不同」「預覽的是還沒存的修改」、`allow-scripts allow-same-origin`、`visit-preview`。
- **未做**：沒有登入後台實際操作（匯出下載、行程清單、右側預覽、即時預覽往返都只在本機 stack 驗過）；正式站招生開關沒查（關閉時兩個招生匯出端點 404，屬預期）；Safari／iOS 實機。

## 2026-10-07 公開資料拿掉維護備註 `_todo`、更正分校頁過時文件（main CI 部署）

- **合併**：`fix/public-todo-strip-20261007` 的 `471966fc` 從 `f82471f0` 開，快轉推 main `f82471f0..471966fc`。內容與驗證見 README 頂部同日段落。
- **migration**：無（只改 `web/app/utils/public-copy.ts`、測試與文件）。沒有備份。
- **CI**：main run 37547289806（`471966fc`）全綠，建立到完成 10.1 分鐘：Frontend admin 4.2／web 1.5 分鐘，Backend 三組 6.2／6.8／5.2 分鐘，E2E／Playwright 5.9 分鐘，Deploy 3.1 分鐘。
- **正式 `release.json`**：base commit `471966fc`，created `2026-10-06T23:41:40Z`，`web+api`。
- **部署前後對照**（未登入，打 `/api/published-site`）：部署前有 7 處 `_todo`（`home.hero`、五校、`siteMeta.headerPhone`），回應還帶著 `design/hero-video-restoration…` 內部路徑；部署後 0 處、不含該路徑，首頁 SSR 內容也沒有。五校 key、頁首電話、hero 圖照舊。
- **線上唯讀檢查**：`/`、`/visit`、`/about`、`/admin/login`、`/sitemap.xml` 皆 200；`/campuses/yihua` 301 回首頁；`/api/website/v1/health` `status: ok`、`last_failed_steps` 空。
- **未做**：沒有登入後台看內容；fixture 沒改，`_todo` 仍留在 repo 供後端初始化與維護者使用，只是不再進公開資料。

## 2026-10-06 成效統計改三個頁籤、五校表置頂、說明收合（main CI 部署）

- **合併**：`feature/analytics-ux-20261006` 的 `dd9da598` 從 `0ae1f089` 開，合入 `1cefe5cd`（招生 nodeposit 部署紀錄；README 一個標題衝突）成 `3d50e0a1`，推 main `1cefe5cd..3d50e0a1`。內容與驗證見 README 頂部同日段落、DESIGN.md「成效統計：三個頁籤與兩欄格線」。
- **migration**：無（只改後台畫面與測試）。沒有備份。
- **CI**：main run 37473874441（`3d50e0a1`）全綠，建立到完成 13.4 分鐘：Frontend admin 4.2／web 1.8 分鐘，Backend 三組 8.2／6.9／8.5 分鐘，E2E／Playwright 5.8 分鐘，Deploy 4.8 分鐘。
- **正式 `release.json`**：base commit `3d50e0a1`，created `2026-10-06T13:58:39Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/admin/` 的 `AnalyticsView-C3d0lBwg.js` 有「官網瀏覽與速度」「預約孩子的班別」「這些數字怎麼算」。
- **未做**：沒有登入正式後台實際切三個頁籤、看五校表與「現在」兩欄的連結。

## 2026-10-06 招生：未預繳口徑對齊、逾期看參觀日、拿掉待追蹤分頁（main CI 部署，第一次 Deploy 卡在 waiting）

- **合併**：`feature/admissions-nodeposit-20261006` 的 `fc24889c` 從 `7a8d19e4` 開；期間 main 先上了訪視紀錄表單四區展開＋來源分類六項、參觀案件拿掉承辦人、總覽今天的行程板，合入三次成 `72f8a574`（README、DESIGN.md 兩段並存；`DashboardView` 取行程板新版面，再拿掉它重新加回的「參觀後該聯絡的家長」卡），推 main `8bac33d4..72f8a574`。內容與驗證見 README 頂部同日段落、DESIGN.md「招生：未預繳口徑對齊、逾期看參觀日、拿掉待追蹤分頁」。
- **migration**：無。沒有備份。
- **CI**：`72f8a574` 的 run 37446846614 測試全綠，但 Deploy job 停在 GitHub environment 的 `waiting` 超過 12 分鐘（平常 1–3 秒就排進去；production 環境只有 main 分支規則、沒有審核人與等待時間，設定 09-22 後沒改過，GitHub 狀態頁全部正常）。使用者同意後取消這個 run。排在後面的 run 37447384176（`0ae1f089`，含 `72f8a574` 與另一個 session 的 `169dac9e`、兩筆部署紀錄）接著跑、全綠，建立到完成 29 分鐘（前面約 16 分鐘在排隊）：Frontend admin 3.3／web 1.5 分鐘，Backend 三組 8.4／7.0／6.4 分鐘，E2E／Playwright 5.6 分鐘，Deploy 3.9 分鐘。之後再遇到 Deploy 卡 `waiting`，先查 `pending_deployments` 與環境規則，沒有閘門就取消讓下一個 run 接手（或重跑）。
- **正式 `release.json`**：base commit `0ae1f089`，created `2026-10-06T10:30:36Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/admin/` 的 `AdmissionsView-*.js` 有「開啟後這裡會出現漏斗看板、訪視明細與統計分析。」與「逾 14 天待追、冷名單＝參觀滿 14、90 天仍未預繳」，沒有 `followups`、`follow-ups`；`DashboardView-*.js` 沒有「參觀後該聯絡的家長」與 `admissions_follow_up_due`；未登入 `GET /admin/admissions/records?has_deposit=false` 回 401。
- **未做**：沒有登入正式後台看明細「預繳：否」、統計的逾期與冷名單數字、舊連結 `tab=followups` 退回看板。

## 2026-10-06 總覽改成「今天的行程板」（main CI 部署）

- **合併**：`design/admin-mockup-20261006` 的 `87937429` 從 `b7675b2a` 開，期間 main 先上了拿掉承辦人（`7706a7a6`）與來源分類收斂（`0909491c`），合入成 `8bac33d4`（DashboardView、README 衝突：以行程板版面為底，拿掉名單的承辦人欄與 API 的 `assignee_*` 欄位），推 main `7706a7a6..8bac33d4`。內容與驗證見 README 頂部同日段落、DESIGN.md「官網後台總覽：今天的行程板」。
- **migration**：無（只多回傳欄位與 `week_campuses` 彙總）。沒有備份。
- **CI**：main run 37441837401（`8bac33d4`）全綠，建立到完成 19 分鐘（排在拿掉承辦人的 run 之後）：Frontend admin 4.4／web 1.4 分鐘，Backend 三組 8.0／5.7／7.4 分鐘，E2E／Playwright 6.4 分鐘，Deploy 3.7 分鐘。
- **正式 `release.json`**：base commit `8bac33d4`，created `2026-10-06T09:32:21Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`；`/admin/` 的 `DashboardView-*.js` 已有「今天的參觀」「本週五校」「要處理」與 `week_campuses`。
- **未做**：沒有登入正式後台實際看今天的名單與本週五校的數字。

## 2026-10-06 參觀案件拿掉承辦人（main CI 部署）

- **合併**：`feature/remove-assignee-20261006` 從 `7a8d19e4` 開；期間 main 先上了訪視紀錄表單（`ee086b4d`＋紀錄 `b7675b2a`）與來源分類（`0909491c`＋紀錄 `01b1a8d9`），rebase 三次都只有 README 頂部衝突。rebase 後重跑 `vue-tsc -b`、後台 vitest 109 檔 1378 項、招生與案件相關後端 323 項、stack e2e 相關 21 項（招生流程、家庭版面、預約流程、角色、畫面基準）都過；契約重產與合併結果一致。推 main `01b1a8d9..7706a7a6`。內容與驗證見 README 頂部同日段落、DESIGN.md「參觀案件拿掉承辦人」。
- **migration**：無（`visit_requests.assigned_staff_id` 欄位與舊值保留，程式不再讀寫）。沒有備份。
- **CI**：main run 37441120295（`7706a7a6`）全綠，建立到完成 13 分 33 秒：Frontend admin 4.0／web 1.4 分鐘，Backend 三組 9.0／7.2／7.4 分鐘，E2E／Playwright 5.9 分鐘，Deploy 4.3 分鐘。
- **正式 `release.json`**：base commit `7706a7a6`，created `2026-10-06T09:19:51Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`GET /admin/visit-requests/<id>/assignee` 回 404（路由已刪），`/admin/visit-staff` 未登入回 401（仍在）；`/admin/` 的 `VisitDetailView`、`VisitRequestsView`、`DashboardView`、`VisitCalendarView`、`UsersView` chunk 都沒有「承辦」「visit-assignee」「我承辦的案件」，月曆 chunk 用的是 `calendar__visit-source`。
- **之後**：另一個 session 把總覽「今天的行程板」（`87937429`）合入成 `8bac33d4`（run 37441837401），已確認合併後沒有加回承辦人。線上 chunk 發現 `VisitDetailView`「下一筆」沿用列表條件的 `LIST_KEYS` 還留著 `assignee`（後端已忽略，結果不受影響），以 `169dac9e` 清掉並補測試，和這筆紀錄一起推。
- **未做**：沒有登入正式後台實際操作；資料表欄位之後要不要刪待使用者決定（要刪先備份）。

## 2026-10-06 招生來源分類收斂成六項（main CI 部署）

- **合併**：`feature/source-category-choices-20261006` 的 `b99e9f43` 從 `7a8d19e4` 開，期間 main 先上了訪視紀錄表單四區展開（`ee086b4d`＋紀錄 `b7675b2a`），合入成 `0909491c`（RecordDialog、admissionsRecords 測試、README 三處衝突，以 main 版面為底套上來源分類那一行），推 main `b7675b2a..0909491c`。內容與驗證見 README 頂部同日段落、DESIGN.md「來源分類收斂」。
- **migration**：無（資料仍是園務九類代碼，只改後台下拉與顯示）。沒有備份。
- **CI**：main run 37438706672（`0909491c`）全綠，建立到完成 11 分 57 秒：Frontend admin 2.7／web 1.6 分鐘，Backend 三組 6.0／7.0／7.2 分鐘，E2E／Playwright 6.2 分鐘，Deploy 4.6 分鐘。
- **正式 `release.json`**：base commit `0909491c`，created `2026-10-06T08:57:15Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/admin/` 的 `RecordDialog-*.js` 有六項清單（在校生弟妹、畢業生弟妹、家長介紹／社區招生、自報生（廣告、鄰居、網路、活動）、邀約來園、舊生復學），`AdmissionsView-*.js`、`VisitDetailView-*.js` 都從它匯入；未登入 `GET /admin/admissions/options` 回 401。
- **未做**：沒有登入正式後台實際打開下拉、看選過不列類別的舊資料。

## 2026-10-06 訪視紀錄表單：四區展開、帶參觀老師多位、家長介紹（main CI 部署）

- **合併**：`feature/record-dialog-20261006` 的 `ee086b4d` 從 `7a8d19e4` 開、期間 main 沒前進，直接快轉，推 main `7a8d19e4..ee086b4d`。內容與驗證見 README 頂部同日段落、DESIGN.md「訪視紀錄表單：四區展開、帶參觀老師多位、家長介紹」。
- **migration**：無（多位帶參觀老師仍存 `tour_guide_name` 一欄）。沒有備份。
- **CI**：main run 37435632035（`ee086b4d`）全綠，建立到完成 15 分 10 秒：Frontend admin 4.1／web 1.3 分鐘，Backend 三組 7.4／7.6／6.8 分鐘，E2E／Playwright 6.2 分鐘，Deploy 7.4 分鐘。
- **正式 `release.json`**：base commit `ee086b4d`，created `2026-10-06T08:30:12Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/admin/` 的 `RecordDialog-*.js` 有「打名字按 Enter，可加多位」「哪位家長介紹來的」，`AdmissionsView-*.js` 有 `by_tour_guide`、`tour_guide_source_cross` 與接待人員口徑；未登入 `GET /admin/admissions/options` 回 401。
- **未做**：沒有登入正式後台實際新增一筆、加多位帶參觀老師、看接待分析。

## 2026-10-06 Google 登入改成在「我的帳號」綁定（main CI 部署）

- **合併**：`fix/google-self-link-20261006` 的 `4437174d` 直接疊在 `d4d8a08c` 上，推 main `d4d8a08c..4437174d`。內容與驗證見 README 頂部同日段落、DESIGN.md「Google 登入改成在『我的帳號』綁定」。
- **migration**：無。
- **CI**：main run 37429465171（`4437174d`）全綠，建立到完成 15 分 17 秒：Frontend admin 4.3／web 1.3 分鐘，Backend 三組 5.4／7.1／8.2 分鐘，E2E／Playwright 5.8 分鐘，Deploy 5.0 分鐘。
- **正式 `release.json`**：base commit `4437174d`，created `2026-10-06T07:35:09Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/auth/providers` 回 `google:true`、`line:true`；`/auth/google/login` 302 到 accounts.google.com，`scope=openid`（舊版會多要 email）、`code_challenge_method=S256`；未登入 `POST /auth/google/link` 回 401；`/admin/` 的 `AccountView-*.js` 有「綁定 Google」與 `google_link`。
- **注意**：README 那段寫「正式站 Google 登入沒開」是實作當時；使用者 15:09 已在 Railway 開了 Google 登入，所以 15:09 到這次部署（約 15:39）之間線上跑的是舊版 Email 自動綁定，這段期間若有人用 Google 登入，綁定會留著。部署後沒綁定的後台帳號要先到「我的帳號」按「綁定 Google」才能用 Google 登入。
- **未做**：沒有本人真實 Google 往返（綁定→登出→Google 登入、未綁定帳號被拒、取消授權、手機）；沒查正式庫這段期間有沒有自動綁定。

## 2026-10-06 標記已到場後接著填招生資料（main CI 部署）

- **合併**：`feature/arrival-admissions-form-20261006`（`d4d8a08c`）從 `0c521a95` 開，commit 前 main 前進到 `39f48c9e`（拿掉 inquiry `da749b97`＋其部署紀錄），rebase 只有 README 衝突（兩段都留）。推 main `39f48c9e..d4d8a08c`。內容與驗證見 README 頂部同日段落、DESIGN.md「標記已到場後接著填招生資料」。沒有 migration，沒有備份。
- **推前發現正式 api 部署卡住**：`da749b97` 的 main run 37425274473 測試全綠，但 Deploy 的 api 狀態 `FAILED`（14:49 起連 3 次）。`railway logs -d` 看到啟動時 `alembic upgrade head` 讀設定失敗：「Google OAuth 必須同時設定 CLIENT_ID、CLIENT_SECRET 與 REDIRECT_URI」；api 服務的變數名拼成 `WEBSITE_GOOGLE_CLIENT_SECERT`。使用者在 Railway 改名後，api 15:07 的重新部署成功；這段期間線上一直是 14:40 那版。
- **推前本機**（rebase 到 `39f48c9e` 後）：admin `vue-tsc -b` 通過；vitest 整套在負載 59–85 下有 14 檔 5 秒逾時，`--testTimeout=30000` 重跑那 14 檔 222 項全過（rebase 前整套 107 檔 1356 項全過）。stack e2e 只跑受影響的 `admissions-flow`、`admissions-follow-up`、`visit-family-page`（6 項全過）。
- **CI**：main run 37428220783（`d4d8a08c`）全綠，建立到完成 13 分 31 秒：Frontend admin 3.2／web 1.0 分鐘，Backend 三組 8.6／7.0／7.8 分鐘，E2E／Playwright 5.2 分鐘，Deploy 4.8 分鐘。`da749b97`（拿掉 inquiry，migration `c4e8a2f61b97`）隨這次一起經 CI 部署。
- **正式 `release.json`**：base commit `d4d8a08c`，created `2026-10-06T07:21:25Z`，`web+api`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`；`/admin/` 的 `useArrivalAdmissionsForm-*.js` 有「之後再填」「招生資料可以現在填」「招生資料表單打不開」，`RecordDialog-*.js` 有「接著打開招生資料表單」。
- **之後**：別的 session 緊接著推了 `4437174d`（Google 登入改自行綁定），由它自己的 run 部署。
- **未做**：沒登入正式後台實際按一次「到了」。

## 2026-10-06 預約方式拿掉 inquiry（main CI 部署，含 14:49–15:07 API 停擺）

- **合併**：`feature/no-inquiry-20261006` rebase 到 main（操作紀錄 IP 與裝置 `bb10a5b4` 先進，migration `c4e8a2f61b97` 改接它的 `a3c7e9d1f5b2`），使用者推 main `0c521a95..da749b97`。內容與驗證見 README 頂部同日段落、DESIGN.md「拿掉舊狀態程式」。
- **migration**：`c4e8a2f61b97`（down `a3c7e9d1f5b2`），殘留 INQUIRY 切 PAUSED 後重建 `booking_mode` 型別；正式站五校 10-01 起都不是 inquiry。
- **API 停擺（不是這次程式造成）**：14:49 有人在 Railway api 新增 Google OAuth 變數，把 `WEBSITE_GOOGLE_CLIENT_SECRET` 打成 `WEBSITE_GOOGLE_CLIENT_SECERT`；改變數觸發 Railway 自動重部署（deployment `6ba5946e`），`api-start.py` 跑 alembic 前 Settings 驗證「Google OAuth 必須同時設定 CLIENT_ID、CLIENT_SECRET 與 REDIRECT_URI」失敗，舊容器已停，API 回 502。這次 main run 37425274473（`da749b97`）測試全綠，Deploy 的 api deployment `7cf68e0f` 同一個原因 FAILED。查法：`railway logs -s api -d <deployment id>` 看 traceback，`railway variables --json` 只列名稱比對（不印值）。使用者 15:03 前後改正變數名稱，Railway 重部署 `96b4fca5` 成功（用的是 `da749b97` 的映像，log：`Running upgrade a3c7e9d1f5b2 -> c4e8a2f61b97`、`Database schema ready: c4e8a2f61b97`），15:07 起 API 恢復。
- **web 補上**：main 已有更新的 run 37428220783（`d4d8a08c`，另一個 session，包含 `da749b97`），所以沒重跑失敗的 Deploy（舊 snapshot 會蓋掉新版）；該 run 全綠並部署 api＋web。
- **正式 `release.json`**：base commit `d4d8a08c`，created `2026-10-06T07:21:25Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；五校公開預約設定為 yihua `slots`、minghua／chongde／international／renwu `paused`；`/api/website/v1/auth/google/login` 302 到 accounts.google.com（OAuth 變數修正後生效）。
- **未做**：沒登入正式後台送一次 inquiry 驗 422（測試涵蓋）；Google 登入沒有實際往返。

## 2026-10-06 操作紀錄多記 IP 與裝置（main CI 部署）

- **合併**：`feature/audit-ip-device-20261006` 從 `0c534043` 開，期間 main 前進兩次：先 rebase 到 `5fb9edbb`（拿掉舊狀態程式第二版），migration 由接 `d65fa082ff87` 改接 `e870893fac95`；再 rebase 到 `1c9d3e19`（後台 bug 稽核修正，只有 README 衝突）。等 `1c9d3e19` 部署完，使用者推 main `1c9d3e19..bb10a5b4`。內容與驗證見 README 頂部同日段落、DESIGN.md「操作紀錄記 IP 與裝置」。
- **migration**：`a3c7e9d1f5b2`（down `e870893fac95`），`audit_log_entries` 加 `ip_address` String(64)、`user_agent` String(512)，可為 NULL、不回填；只改目錄、不重寫資料，部署前沒有備份。之後 `da749b97` 的 `c4e8a2f61b97` 接在它後面。
- **推前本機**（rebase 到 `5fb9edbb` 後）：後端整套 pytest 1558 passed、1 skipped；admin `vue-tsc -b`、vitest 102 檔 1298 過、2 項逾時（負載 22，`admissionsRecords.test.ts` 單獨重跑 34 項全過）；web typecheck、`test:website` 829 項；`contract:check`；stack e2e 整套 76 項全過；測試庫從零升到 head、downgrade／upgrade 各一次。rebase 到 `1c9d3e19` 後：稽核與 bug 稽核相關後端 90 項、admin 73 項、`vue-tsc -b`、`contract:check`、stack e2e 整套 76 項全過。
- **CI**：main run 37424272105（`bb10a5b4`）全綠，建立到完成 12 分 41 秒：Frontend admin 3.9／web 1.3 分鐘，Backend 三組 8.0／6.9／7.2 分鐘，E2E／Playwright 6.5 分鐘，Deploy 4.6 分鐘。
- **正式 `release.json`**：base commit `bb10a5b4`，created `2026-10-06T06:40:35Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`（API 啟動會 `alembic upgrade head` 並核對 revision，起得來＝migration 已套用）；`/admin/` 的 `AuditView-*.js` 已有 `audit-source` 與 UA 解析；未登入 `GET /admin/audit-log` 仍 401。
- **未做**：沒登入正式後台看一筆新紀錄，正式站經 Railway edge 帶進來的 IP 是否為真實位址待使用者確認。

## 2026-10-06 後台 bug 稽核修正（main CI 部署）

- **合併**：`fix/admin-bug-audit-20261006`（`a781413e` 修正、`20933258` media.spec 時序）合進 main 兩次（舊狀態程式第二版 `5fb9edbb`、其部署紀錄 `a11e840b`；衝突在 README、`VisitDetailView.vue`、`workflow_service.py`），使用者推 main `a11e840b..1c9d3e19`。內容與驗證見 README 頂部同日段落、DESIGN.md「後台 bug 稽核修正」。
- **migration**：沒有新的；正式庫已在 `e870893fac95`，不用備份。
- **推前本機**（合併 main 後）：後端整套 pytest 1582 passed、1 skipped；admin vitest 105 檔 1327 項、`vue-tsc -b`；官網 829 項與 typecheck；`contract:check`；stack e2e 74 過＋`media.spec` 修正後單獨重跑通過。
- **CI**：main run 37423023653（`1c9d3e19`）全綠，建立到完成 11 分 30 秒：Frontend admin 4.1／web 1.0 分鐘，Backend 三組 5.3／6.7／7.0 分鐘，E2E／Playwright 6.0 分鐘，Deploy 4.3 分鐘。
- **正式 `release.json`**：base commit `1c9d3e19`，created `2026-10-06T06:26:14Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；後台 lazy chunk 有新文案（`UsersView` 的「確認是你本人」、內容編輯的「這一版已被退回，請修改後重新儲存。」）。
- **未做**：沒登入正式後台實際操作（帳號頁重新驗證、招生鎖學期、加開重複場次）。

## 2026-10-06 拿掉參觀預約的舊狀態程式，第二版（main CI 部署）

- **合併**：`feature/visit-legacy-drop-20261006` 的 `5fb9edbb` 疊在第一版 `0c534043` 上（main 期間沒有其他提交），使用者推 main `0c534043..5fb9edbb`。內容與驗證見 README 頂部同日段落、DESIGN.md「拿掉舊狀態程式」。
- **migration**：`e870893fac95`（down `d65fa082ff87`），drop `visit_requests.hold_expires_at`（含索引）、`booking_configs.slots_auto_confirm`，加 CHECK `ck_visit_requests_status`、`ck_visit_requests_confirmed_slot`。使用者確認正式庫預約資料都是測試資料，部署前沒有備份；兩個欄位在第一版之後沒有有意義的值。API 起得來＝migration 已到 head（約束建立沒有違反的列）。
- **推前本機**：後端整套 pytest 1544 passed、1 skipped（另 3 項在負載 31 時逾時，負載降下後重跑 63 項全過）；admin `vue-tsc -b`、`analyticsOutcomes` 12 項；`contract:check`；stack e2e 從零跑到 `e870893fac95` 整套 75 項全過；本機測試庫 downgrade／upgrade 各一次。
- **CI**：main run 37421150198（`5fb9edbb`）全綠，建立到完成 14 分 16 秒：Frontend admin 2.4／web 1.1 分鐘，Backend 三組 8.0／6.4／6.9 分鐘，E2E／Playwright 6.1 分鐘，Deploy 5.6 分鐘。
- **正式 `release.json`**：base commit `5fb9edbb`，created `2026-10-06T06:06:34Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；義華公開預約設定 `slots`、明華 `paused`；義華未來 30 天公開場次 38 個、剩餘名額正常（讀案件表算名額）。
- **未做**：沒登入正式後台實際補登、取消；`inquiry` 預約方式仍在（改公開設定端點被 auto 模式擋下，待使用者決定）。

## 2026-10-06 拿掉參觀預約的舊狀態程式，第一版（main CI 部署）

- **合併**：`feature/visit-legacy-cleanup-20261006` rebase 到 main `d70bce03`（只多兩個文件提交，沒有衝突），使用者推 main `d70bce03..0c534043`。內容與驗證見 README 頂部同日段落、DESIGN.md「拿掉舊狀態程式」。
- **migration**：`d65fa082ff87`（down `3fe1cfb2dbf7`），只清資料：再刪舊狀態與「已確認卻沒有場次」的案件、舊流程通知未寄或失敗的標 skipped；downgrade 不還原。使用者確認正式庫預約資料都是測試資料，部署前沒有備份。實際刪幾筆、標幾筆沒有查（auto 模式擋 railway ssh 讀正式庫；部署前 10-05 晚以總管理者看過五校沒有舊狀態案件）。
- **推前本機**：後端整套 pytest 1549 passed、1 skipped；admin vitest 101 檔 1279 項、`vue-tsc -b`；web typecheck、`test:website` 829 項；`contract:check`；stack e2e 整套 75 項全過。
- **CI**：main run 37399019336（`0c534043`）全綠，建立到完成 10 分 55 秒：Frontend admin 4.4／web 1.4 分鐘，Backend 三組 7.0／4.7／5.2 分鐘，E2E／Playwright 5.4 分鐘，Deploy 3.7 分鐘（這次沒有卡 INITIALIZING）。
- **正式 `release.json`**：base commit `0c534043`，created `2026-10-06T01:32:19Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空（定期工作已沒有 expire_holds 步驟）；`POST /admin/visit-requests/{id}/confirm` 回 404；義華公開預約設定 `mode: slots`；後台 `VisitDetailView` chunk 沒有「確認這個場次」「排入場次」「取消這筆需求」「舊需求」，有「取消預約」。
- **未做**：沒登入正式後台實際補登一筆、取消一筆；Safari／iOS 實機。第二版（drop `hold_expires_at`、`slots_auto_confirm`，加 status CHECK）另外推。

## 2026-10-05 預約明細當家庭頁（main CI 部署）

- **合併**：`feature/visit-family-page-20261005`。分支先疊在紙本補欄位 `5c6c1424` 上，再兩次合 origin/main（`4f9de0b6`、`4140145d`；README 兩段都留），HEAD `9299bd7f`，使用者推 main `4140145d..9299bd7f`。內容見 README 頂部同日段落、DESIGN.md「預約明細當家庭頁」，規格 `docs/specs/2026-10-05-visit-family-page-design.md`。
- **migration**：無。後端只在看板卡片（`FunnelCardOut`）與待追蹤列（`FollowUpRowOut`）多回 `visit_request_id`，屬於加欄位；轉移契約 `contracts/ivy-recruitment` 不變。部署前沒有備份。
- **推前本機**：
  - 後端整套 pytest 1544 passed、1 skipped（`ivy_website_familypage_test`）。
  - admin vitest 101 檔 1282 項、`vue-tsc -b`、`contract:check` 一致。
  - 整套 stack e2e 75 項全過（埠 8797／3797，`ivy_website_e2e_familypage_test`，跑完已刪庫）。刻意在台北 01:01 之後跑：`admissions-follow-up` 的「甲到期」斷言「今天」，在台北 00:00–01:00 會跨日變成「逾 1 天」，是 main 既有的時間相依問題。
- **CI**：main run 37385758336（`9299bd7f`）全綠，建立到完成 12 分 33 秒。各 job：
  - Frontend：admin 4.1、web 1.1 分鐘。
  - Backend 三組：7.3／5.5／6.7 分鐘。
  - E2E／Playwright 6.0 分鐘。
  - Deploy 5.0 分鐘。
- **正式 `release.json`**：base commit `9299bd7f`，created `2026-10-05T23:06:40Z`。
- **線上唯讀檢查**（未登入）：
  - `/api/website/v1/health` `status: ok`；`/admin/login` 200。
  - `VisitDetailView` lazy chunk 有「家長預約時填寫的資料」「參觀前記在預約」「招生資料讀不到」。
- **未做**：
  - 沒登入正式後台實際點一次家庭版面（正式站義華目前沒有已到場的預約，需要有一筆到場才看得到）。
  - Safari／iOS 實機。
  - axe 掃描補家庭頁、唯讀帳號與開關關閉的截圖。

## 2026-10-05 招生訪視照紙本補欄位、官網得知管道加兩項（main CI 部署）

- **合併**：`feature/admissions-paper-fields-20261005` 的 `a4ffeafc` 合 origin/main 兩次（`8b0efde2` 參觀案件拿掉待處理、`4f9de0b6` 校園探索改由總部控制；DESIGN／README 各段都留）成 `9ab739ae`，使用者要求後推 main `4f9de0b6..9ab739ae`。內容與驗證見 README 頂部同日段落、DESIGN.md「招生訪視照紙本補欄位」。
- **migration**：`3fe1cfb2dbf7`，原本接 `4373bcc82d9d`，合併時改接 `8b0efde2` 的 `1e5612e187ff`（維持單一 head）。只在 `recruitment_visits` 加三個可空欄位、重建 `ck_recruitment_contact_logs_channel` 放行 `revisit`，不改既有資料，部署前沒有另外備份（同一批的 `1e5612e187ff` 刪舊案，已隨 `8b0efde2` 那次部署）。
- **推前本機**（第二次合併後）：後端整套 pytest 1537 passed、1 skipped；admin vitest 94 檔 1207 項、`vue-tsc -b`；web typecheck、`test:website` 829 項；`contract:check` 一致；stack e2e 整套 74 項全過。第三次合併（`4f9de0b6`，沒有 migration、不碰招生）後重跑 admin vitest 95 檔 1213 項、web 829 項、`contract:check`，以及校園探索、素材庫、招生、得知管道、總覽相關的後端 270 項，全過；整套 pytest 與 stack 沒再重跑，交給 CI。
- **CI**：main run 37334783908（`9ab739ae`）全綠，建立到完成 25 分 36 秒（含排在 `4f9de0b6` 那次後面）：Frontend admin 3.5／web 1.4 分鐘，Backend 三組 8.0／5.8／7.3 分鐘，E2E／Playwright 5.8 分鐘，Deploy 8.0 分鐘。
- **正式 `release.json`**：base commit `9ab739ae`，created `2026-10-05T15:58:51Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空（API 起得來代表 migration 已到 head）；`/admin/login` 200；`/visit/yihua` SSR 有「哥哥姊姊讀過或正在讀」「傳單／DM」；`AdmissionsView` lazy chunk 有「來源備註」「帶參觀老師」「父親職業」「搭娃娃車」，`labels` chunk 有「再參觀」。
- **未做**：沒登入正式後台實際新增一筆訪視、記錄一次再參觀；正式站招生開關開或關沒確認（關閉時後台看不到招生入學，官網兩個新選項不受影響）；Safari／iOS 實機。

## 2026-10-05 校園探索改由總部帳號直接控制（main CI 部署）

- **合併**：`feature/admin-no-campus-tour-20261005` rebase 到 main `8b0efde2`（衝突只在 README.md 頂部，兩段都保留），使用者快轉推 main `8b0efde2..4f9de0b6`。內容與驗證見 README 頂部同日段落、DESIGN.md「校園探索改由總部管理」。
- **migration**：無；API 契約不變，已存的校園探索內容與素材不動。
- **推前本機**（rebase 後）：後端整套 pytest 1538 passed、1 skipped；admin vitest 95 檔 1209 項、`vue-tsc -b`、`contract:check` 通過；stack e2e 整套 74 項全過。
- **CI**：main run 37332419460（`4f9de0b6`）排在 `8b0efde2` 的 run 37326517800 之後。測試（Frontend admin／web、Backend 三組、E2E／Playwright）第一次就全綠，但 Deploy 第一步 `railway up`（api）6 秒就失敗；Railway 的錯誤訊息在 `--json` 模式下被 `railway_ci.py` 接走，log 只有 `CalledProcessError`，正式站維持 `8b0efde2`。確認 main 沒有更新的 run 後 `gh run rerun 37332419460 --failed`，第 2 次 Deploy 成功。
- **正式 `release.json`**：base commit `4f9de0b6`，created `2026-10-05T15:38:11Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；後台 entry chunk 的 `campus-tour` 側欄項目為 `roles:['super_admin'], shared:!0`、關鍵字含「五所校園」；`CampusTourView` chunk 有「由總部統一管理」；公開 `/environment` 第四章仍是 5 個校的分頁。
- **未做**：沒登入正式後台實際操作（總部編輯、分校帳號被擋只在 stack e2e 與拋棄式測試庫驗過）；有授權但非總管理者的真帳號；Safari／iOS 實機。

## 2026-10-05 參觀案件拿掉「待處理」、刪除舊案（main CI 部署）

- **合併**：`feature/visit-no-pending-20261005` rebase 到 main `e0819f3a`（README 兩邊都留），使用者推 main `e0819f3a..8b0efde2`。內容與驗證見 README 頂部同日段落、DESIGN.md「拿掉「待處理」」。
- **migration**：`1e5612e187ff`（down `4373bcc82d9d`），刪除 new／contacting／pending_confirmation 的案件與指向它們的站內通知，downgrade 不還原。使用者確認正式庫預約資料都是測試資料、可以刪，**部署前沒有備份**。
- **推前本機**：後端整套 pytest 1532 passed、1 skipped；admin vitest 94 檔 1203 項、`vue-tsc -b`、`contract:check`；web typecheck、`test:website` 829 項；stack e2e 整套 74 項全過。
- **CI**：main run 37326517800（`8b0efde2`）測試全綠：Frontend admin 3.5／web 1.3 分鐘，Backend 三組 5.8／6.6／7.0 分鐘，E2E／Playwright 4.6 分鐘。**第一次 Deploy 失敗**：Railway api deployment `e50ed018` 停在 INITIALIZING 約 15 分鐘（同名額規劃那次），`railway_ci.py` 等待逾時，正式站維持 `51332515`；main 沒有更新的 run，`gh run rerun --failed` 重跑 Deploy 成功（20.7 分鐘，attempt 2）。
- **正式 `release.json`**：base commit `8b0efde2`，created `2026-10-05T15:07:47Z`。
- **線上檢查**（登入總管理者，瀏覽器唯讀）：`?group=pending` 導回全部，頁籤「全部／預約正常 5 件／時間已過／已取消 1 件」；側欄沒有 `.sidebar__badge`；`group=pending` API 回 422；`/admin/dashboard` 沒有 `new_requests`／`awaiting_confirmation`／`next_hold_expires_at`；09-24 舊案（義華 `e048dc79`）回 404。五校剩 5 筆預約正常、1 筆崇德已取消（10-01），沒有任何舊狀態案件；部署前五校原有幾筆舊案沒有查（總管理者部署前沒看，校區管理者只看得到義華 1 筆）。
- **未做**：Safari／iOS 實機。

## 2026-10-05 招生入學拿掉名額規劃、官網預約兩個分頁（main CI 部署）

- **合併**：`feature/admissions-no-arrivals-20261005` 的 `51332515` 疊在 main `55c9d68f`（拿掉名額規劃）上，使用者快轉推 main `55c9d68f..51332515`。內容與驗證見 README 頂部同日兩段、DESIGN.md「拿掉官網預約分頁」「拿掉名額規劃」。
- **名額規劃那次的 run 37315727803**：測試全綠，但第一次 Deploy 失敗——Railway api deployment `46b5a802` 停在 INITIALIZING 15 分鐘、沒有 build（`railway logs --build` 回「Deployment does not have an associated build」），`railway_ci.py` 等待逾時；Railway 狀態頁無事件，正式站維持 `982af30d`。重跑 Deploy 時這次的 `51332515` 已在跑，重跑排在它後面會用較舊的 snapshot 把它回退，所以手動取消重跑（因此顯示 cancelled）；`55c9d68f` 隨這次部署一起上線。`46b5a802` 在這次部署後變成 REMOVED，沒有手動處理。再遇到 INITIALIZING 卡住：先看 main 有沒有更新的 run，有的話別重跑舊的。
- **migration**：無。後端刪掉 `GET /admin/admissions/arrivals`（只有後台在用），補建端點 `POST /admin/admissions/from-visit-request/{id}` 保留；名額 API 與資料不動。
- **推前本機**：後端整套 pytest 1531 passed、1 skipped；admin vitest 94 檔 1203 項、`vue-tsc -b`、`contract:check` 通過；stack e2e 整套 74 項全過。
- **CI**：main run 37319156480（`51332515`）全綠，建立到完成 25 分 42 秒（含等前一個 run 被取代）：Frontend admin 2.9／web 1.4 分鐘，Backend 三組 8.9／6.1／6.7 分鐘，E2E／Playwright 5.8 分鐘，Deploy 5.3 分鐘。
- **正式 `release.json`**：base commit `51332515`，created `2026-10-05T14:05:25Z`。
- **線上唯讀檢查**（未登入，只抓後台靜態檔）：`/api/website/v1/health` `status: ok`、`last_failed_steps` 空；`/admin/login` 200；`AdmissionsView` lazy chunk 有「去標記到場」，沒有「官網預約有」與 `admissions/arrivals`；`VisitRequestsView` chunk 有「勾選後一次標記已到場」「位標記已到場」。
- **未做**：沒登入正式後台操作（案件列表批次標記、看板提示只在 stack e2e 與拋棄式測試庫驗過）；部署前請使用者先在舊分頁補建「已到場但沒有招生訪視」，有沒有補、補了幾筆未確認；Safari／iOS 實機。

## 2026-10-05 通知顯示家長稱呼、點開就算已讀（main CI 部署）

- **合併**：`feature/admin-notify-names-20261005` 的 `ebdb4b46` 合 origin/main 兩次（招生入學＋側欄的程式、側欄部署紀錄；README／DESIGN 頂部衝突兩段並存）成 `982af30d`，推 main `f0b9a2e4..982af30d`。內容與驗證見 README 頂部同日段落、DESIGN.md「通知顯示家長稱呼、點開就算已讀」。
- **migration**：無（`parent_name` 讀取時 join 案件，不寫進 payload）。
- **推前本機**（合併後）：`vue-tsc -b`、`contract:check` 通過；vitest 8 項在 load 90 時 5 秒逾時，單獨重跑全過；stack e2e 75 項全過。
- **CI**：main run 37310178152（`982af30d`）success，總長 11 分 43 秒：Frontend admin 2.6／web 1.2 分鐘，Backend 三組 6.0／5.1／7.0 分鐘，E2E／Playwright 5.2 分鐘，Deploy 4.4 分鐘。
- **正式 `release.json`**：當時沒讀；之後名額規劃那次第一次 Deploy 失敗期間，線上維持 `982af30d`（見上一段）。
- **線上唯讀檢查**（10-06 補，未登入）：`/admin/` 的 `NotificationsView-*.js` 有 `parent_name`。
- **紀錄補寫**：當晚部署後沒補紀錄，10-06 與 inquiry 部署紀錄一起推。
- **未做**：沒登入正式後台點一次通知看已讀；真的 LINE 群組推播沒看；園方隱私權政策第 6 段待補 LINE。

## 2026-10-05 招生入學 UI/UX（main CI 部署）

- **合併**：`feature/admissions-ux-20261005` 的 `288e9dc7` 合 origin/main 三次（站內通知頁、它的部署紀錄、側欄改版；`style.css` 的淺色主色鈕規則兩邊一字不差、採 main 註解，DESIGN／README 各段都留）成 `6e0fdf8c`，使用者快轉推 main `0f68dd15..6e0fdf8c`（第一次推時側欄剛進 main 被拒，再合一次）。內容與驗證見 README 頂部同日段落、DESIGN.md「招生入學 UI/UX」。
- **migration**：無（只改後台前端、測試與文件，沒動 API）。
- **推前本機**（合併側欄後）：stack e2e 75 項全過（含招生六個分頁 a11y、招生流程、參觀後追蹤、視覺基準）；`vue-tsc -b`、`vite build` 通過；admin vitest 整套在另一個 session 跑 pytest（load 約 80）時有 5 秒逾時，逾時的兩檔單獨重跑 51 項全過，合併側欄前整套 1216 項全過。
- **CI**：main run 37304344486（`6e0fdf8c`）全綠，總長 16 分 17 秒：Frontend admin 3.7／web 1.4 分鐘，Backend 三組 8.0／7.1／5.7 分鐘，E2E／Playwright 4.9 分鐘，Deploy 4.2 分鐘。
- **正式 `release.json`**：base commit `6e0fdf8`，created `2026-10-05T11:52:04Z`。
- **線上唯讀檢查**（未登入，只抓後台靜態檔）：`/api/website/v1/health` `status: ok`；`AdmissionsView` lazy chunk 有「這個分頁不分入學學年學期」「找幼生姓名」「標記預繳」「勾選後一次標記已到場」「依各欄目前張數相除」「更多篩選」「去確認到場」「移到已預繳」「進行中」「超額」；共用 chunk 有「還不能記下」「上次：」（記錄聯絡）與「個百分點」（統計）；入口 CSS 有 `.el-button--primary.is-plain{--el-button-text-color:var(--admin-accent-hover)}`。
- **未做**：沒確認正式站招生入學功能開關（`WEBSITE_ADMISSIONS_ENABLED`）現在開或關（未登入時 API 先回 401；10-02 上線時是關閉），畫面只在拋棄式測試庫與 stack e2e 驗過；沒登入正式後台操作；Safari／iOS 實機。

## 2026-10-05 官網後台側欄 UI/UX（main CI 部署）

- **合併**：`feature/admin-sidebar-20261005` 的 `bf00586e` 合 origin/main 兩次（站內通知頁 `75caffa1`、它的部署紀錄 `6721b29d`；README／DESIGN 頂部衝突皆兩段並存）成 `0f68dd15`，使用者快轉推 main `6721b29d..0f68dd15`。內容與驗證見 README 頂部同日段落、DESIGN.md「官網後台側欄：層級、尺寸與鍵盤」。
- **migration**：無（只改後台前端、測試、視覺基準與文件）。
- **推前本機**（合併後）：stack e2e 75 項全過（含重拍的 4 張後台視覺基準與 a11y）；admin vitest 94 檔 1174 項、`vue-tsc -b`、`vite build` 通過。
- **CI**：main run 37303528997（`0f68dd15`）success，總長 11 分 36 秒。
- **正式 `release.json`**：base commit `0f68dd1`，created `2026-10-05T11:40:02Z`。
- **線上唯讀檢查**（未登入，只抓後台靜態檔）：`/api/website/v1/health` `status: ok`；入口 JS 有 `aria-keyshortcuts` 的 `Meta+K Control+K`、`sidebar__kbd`、`has-current`，側欄圖示是 `House`／`PieChart`／`Film`／`Memo`（沒有 `HomeFilled`／`TrendCharts`／`Grid`／`List`）；入口 CSS 有 `--sidebar-scroll-shadow`、`--nav-row:36px`／`44px`、`content:"↵" / ""`。
- **未做**：沒登入正式後台實際操作（⌘K、↓↑、Esc、捲動陰影只在拋棄式測試庫與 stack e2e 驗過）；Safari／iOS 實機、Windows 的 Ctrl+K。

## 2026-10-05 官網後台站內通知頁 UI/UX（main CI 部署）

- **合併**：`feature/admin-notifications-20261005` 的 `75caffa1` 直接接在 `23c6aa2e` 後，快轉推 main `23c6aa2e..75caffa1`。內容與驗證見 README 頂部同日段落、DESIGN.md「官網後台站內通知頁」。
- **migration**：無（只改後台前端、測試與文件）。
- **推前本機**：stack e2e 75 項全過（含視覺基準與 a11y）；admin vitest、`vue-tsc -b`、`vite build` 通過。
- **CI**：main run 37299477016（`75caffa1`）success，總長 13 分 4 秒。
- **正式 `release.json`**：base commit `75caffa`，created `2026-10-05T11:03:29Z`。
- **線上唯讀檢查**（未登入，只抓後台靜態檔）：`/api/website/v1/health` `status: ok`；`NotificationsView` lazy chunk 有新文案與結構（「顯示哪些通知」頁籤、「今天／昨天」分組、`notice__main` 整列連結、「未讀：」、`unread` 網址參數）；入口 CSS 有 `.el-button--primary.is-plain{--el-button-text-color:var(--admin-accent-hover)}`。
- **未做**：沒登入正式後台實際操作（頁籤、點進案件再返回、標記已讀都只在拋棄式測試庫與 stack e2e 驗過）；Safari／iOS 實機。

## 2026-10-05 官網後台第九輪 UI/UX（main CI 部署）

- **合併**：`feature/admin-ux9-20261005` 的 `e8d7e261` 合 origin/main（只多部署紀錄，README 頂部衝突已解）成 `54048545`，使用者快轉推 main `f83bdd3..54048545`。內容與驗證見 README 頂部同日段落、DESIGN.md「官網後台第九輪 UX」。
- **migration**：無（只改後台前端、文件與兩張 stack 視覺基準）。
- **CI**：main run 37278508988（`54048545`）全綠：Frontend admin 3.7／web 1.2 分鐘，Backend 三組 7.9／6.3／6.7 分鐘，E2E／Playwright 6.0 分鐘，Deploy 4.4 分鐘。
- **正式 `release.json`**：base commit `5404854`，created `2026-10-05T07:43:01Z`。
- **線上唯讀檢查**（未登入，只抓後台靜態檔）：`/api/website/v1/health` `status: ok`；後台 lazy chunk 有新文案與樣式——`VisitRequestsView`（「到了」、「拿掉這個條件」）、`DashboardView`（`summary-cols`、`today__attendance`）、`PageHeader`（「收起說明」）、`UsersView`（「停用帳號」）、`VisitDetailView`（「新場次剛好額滿」）、內容編輯共用 chunk（「存草稿並預覽」）；入口 CSS 有 `--text-base:14px` 等字級 token。
- **未做**：沒登入正式後台實際操作（接待「到了／沒來」、篩選標籤、存草稿並預覽都只在拋棄式測試庫與 stack e2e 驗過）；Safari／iOS 實機。

## 2026-10-05 效能第四輪：字型依頁面分組、圖片 1600w、後台按需引入、後端熱路徑、CI 分三組（main CI 部署）

- **合併**：`feature/perf-20261005` 七個提交接在 `126093f` 後，使用者快轉推 main `126093f..bcf6005`。內容與驗證見 README 頂部同日段落、DESIGN.md「效能第四輪」。
- **migration**：`e5b9c3a7d214 → 4373bcc82d9d`，只建索引（預約案件建立時間／同校同手機、時段校＋日期、稽核紀錄時間排序）、不改資料，依 `deploy/CICD.md` 規則部署前沒有另外備份。
- **CI**：main run 37273689299（`bcf6005`）全綠。後端第一次分三組平行（pytest-split）：三組 job 9.0／7.6／7.3 分鐘、其中 pytest 7.4／6.2／6.3 分鐘（之前單一 job 12–20 分鐘），推送到開始部署約 9 分鐘；Frontend web／admin、E2E／Playwright、Deploy 都過。
- **正式 `release.json`**：base commit `bcf6005`，created `2026-10-05T06:50:50Z`。
- **線上唯讀檢查**（未登入、擋非 GET）：`/api/website/v1/health` `status: ok`；`/api/website/v1/public/site` 200 帶 ETag，同 ETag 重送回 304；`/public/booking-config/yihua` 200；後台入口 `index-*.js` brotli 48.7 KB（原 218 KB），CSS 仍是 `index-BId_xDU5.css`；`/about` 的 inline 字型宣告是新分片。
- **線上手機實測**（`output/playwright/perf-audit-20261005/lab.cjs`，1.6 Mbps／150 ms／CPU 4×、DPR3，與早上同條件）：LCP `/visit` 6.1→3.5 s、`/about` 6.5→4.8 s、`/environment` 7.2→5.3 s、`/admission` 3.8→2.6 s、`/curriculum` 3.9→2.9 s、`/` 2.7→2.3 s；各頁總傳輸少 23–42%（`/about` 1168→798 KB、`/visit` 1204→671 KB），LINE Seed 每頁 185–529 KB → 37–77 KB。單次量測，有波動。
- **未做**：沒登入後台實際操作（按需引入只靠單元測試、stack e2e 與視覺基準）；Safari／iOS 實機。

## 2026-10-05 素材背景轉檔＋特色教學頁、關於常春藤頁開放後台編輯（main CI 部署）

- **合併**：`merge/wave3-20261004` 整合 `feature/page-cms-20261004`（`1381a82`）與 `feature/media-jobs-20261003`（`799d884`），期間 main 前進三次都再合進來（README／DESIGN／deploy 文件衝突兩邊都留；`contentHints.ts`、`useDraftPreview.ts`、`content-overlay.ts`、`media-slots.spec.ts` 的程式衝突保留 main 拿掉的舊欄位、留下新的兩個內容種類與轉檔版本），使用者 push main `ba32b9b..11ccc8e`。
- **migration**：`d2b7f4c9e1a3 → b8e3f1a6c4d7（參觀後追蹤）→ e5b9c3a7d214（素材背景轉檔）`，單一 head；只新增 `media_jobs` 表與 `media_variant_kind` 三個 enum 值、不改既有資料，依 `deploy/CICD.md` 規則部署前沒有另外備份。
- **CI**：main run 37247647686（`11ccc8e`）Frontend web／admin、Backend／PostgreSQL／contracts（1527 passed、0 skipped——HLG 轉色調整合測試在 CI 的 ffmpeg 有 zscale，實跑通過）、E2E／Playwright（含新的影片轉檔 spec 與 `/about` hydration／axe）、Deploy 全綠。緊接著別的 session 推 `7d132eb`（含 `11ccc8e`），run 37248705351 也全綠並再部署一次。
- **正式 `release.json`**：base commit `7d132eb`（含本次），created `2026-10-05T01:25:42Z`。
- **線上唯讀檢查**（未登入）：`/api/website/v1/health` `status: ok`、`media_jobs.enabled: true`（`last_processed_at` 為 null，還沒有轉過影片）；`/curriculum`、`/about`、`/` 都 200（約 0.33–0.36 秒），內建文字在；後台 bundle 有 `AboutPageView`、`CurriculumPageView` chunk，素材庫 chunk 有「轉檔中」「重新處理」，關於頁 chunk 有沿革順序提醒與紀念章說明。
- **待使用者（auto 模式擋 `railway ssh`）**：
  1. 查 api 服務 `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`（建議 ≥ 35）：`! railway variables --service api --environment production | grep DRAINING`
  2. 查正式映像有沒有 zscale（CI 有不代表 Debian 映像有）：`! railway ssh --service api --environment production -- sh -c 'ffmpeg -hide_banner -filters | grep -E " (zscale|tonemap) "'`
  3. 後台上傳一支短影片，看卡片「轉檔中」→可用，並在 Railway metrics 看 api 記憶體與 CPU 峰值。
  4. 既有影片回補、既有圖片補中圖（先備份媒體 volume、看剩餘空間，見上方「素材背景轉檔上線步驟」第 5、6 點）。
  5. 園方確認義華創校年份（1997／1998），要改就在後台「關於常春藤頁」改沿革第一站與首屏介紹；30 週年頁與 llms.txt 要另外改程式。（2026-10-08 註：業主 10-03 已裁定 1997，這步不用做。）
- **未做**：沒登入看兩個新編輯頁與素材庫；沒上傳影片實測轉檔與記憶體；iOS Safari 實機。

## 2026-10-05 官網公開輸出再拿掉原型預約示範資料（main CI 部署）

使用者要求「booking.fields 也幫我清掉」。盤點時同一個 `booking` 物件另有 `demoNote`（「這是官網互動提案…」）、`steps`（含「示範完成，尚未送出預約」）、`isDemo` 也沒被讀，一併在公開輸出拿掉（`web/app/utils/public-copy.ts`），型別只留 `privacyNotice`、`ctaLabel`、`ctaLabelEn`。只動 web；fixture、後端、後台、契約、DB 都不動，沒有 migration。`feature/booking-demo-fields-20261005` 兩個提交接在 `4423e29` 後，等 wave3（`11ccc8e`，run 37247647686）開始跑之後才推（避免在 main 的 concurrency 群組把它的 pending run 取代掉），由使用者快轉推成 `7d132eb`。

- **CI**：main run 37248705351（`7d132eb`）E2E／Playwright、Backend／PostgreSQL／contracts、Frontend web／admin、Deploy Railway production 全部 success（2026-10-05 01:05–01:28 UTC）。
- **正式 `release.json`**：base commit `7d132eb`，created `2026-10-05T01:25:42Z`；`/api/website/v1/health` 200。
- **線上唯讀檢查**（未登入）：`/`、`/environment`、`/visit`、`/visit/yihua`、`/about`、`/curriculum`、`/admission`、`/news`、`/anniversary` 都 200，HTML 沒有「這是官網互動提案」「示範完成」「demo-consent」「consentText」「demoNote」；`ctaLabel` 照常（頁首預約按鈕）。
- **未做**：Safari／iOS 實機。

## 2026-10-05 30 週年分頁 v2：高雄蠟筆地圖、結尾畫成 30、吹蠟燭（main CI 部署）

使用者看過預覽、要求拿掉頁面上的開發輔助用字後說「commit 和推上線」。`feature/anniversary-v2-20261004` 一個提交，rebase 到 main `135b03fe`（中途 main 前進兩次：分校頁殘留清理、資安掃描補修，都沒動到 web 的這幾個檔）後由使用者自推成 `ba32b9ba`。規則見 DESIGN.md「30 週年分頁 v2」。

- **內容**：時間軸旁黏住的孩子畫的高雄地圖（內政部區界＋OSM 湖河地標＋門牌座標，跟著年份長出校園與路線）、結尾線畫成 30 與校徽印在 0 裡、「幫常春藤吹蠟燭」（按住／劃過／麥克風）、畫板復原重播分享、2027「滿 30 年」、拿掉頁面上的操作說明與狀態字。
- **資安標頭**：只有 `/anniversary` 文件是 `microphone=(self)`，其他頁維持 `microphone=()`（使用者推送即同意）。
- **沒有 migration**，只動 web。
- **CI**：main run 37246768321（`ba32b9ba`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-05 00:27–00:44 UTC，排在另一個 session 的 run 之後）；同時排隊的資安掃描 run 37246594548 被這次取代（cancelled），它的提交在 `ba32b9ba` 的歷史裡，一起部署。
- **正式 `release.json`**：base commit `ba32b9ba`，created `2026-10-05T00:40:57Z`。
- **線上唯讀檢查**（Playwright，擋 `POST /api/telemetry`）：`/anniversary` 標頭 `microphone=(self)`、`/` 與 `/about` 仍是 `microphone=()`；HTML 有地圖卡、結尾舞台、蠟燭段落與地圖署名，沒有已拿掉的說明字；1440×900、390×844 第一次進站開場自動播放→略過→整頁往下往回捲，沒有 pageerror、沒有橫向捲動（console 只有被我擋下的兩個 telemetry 請求）；按住吹氣 3.5 秒 30 支全熄、出現「再點一次蠟燭」。
- **之後**：main 接著有 wave3 合併（背景轉檔＋頁面 CMS）等提交，都包含 `ba32b9ba`、沒動到 30 週年的檔案。
- **未做**：iOS Safari／Android 實機與真人對麥克風吹氣、聲音實際聽感。

## 2026-10-05 資安掃描複核補三處殘留（main CI 部署）

使用者交來 Codex Security 掃描報告（15 項）。報告掃的是落後 main 655 個 commit 的 `feature/website-admin`（`d11d7e79`），逐條對 main 複核後 13 項已修，補其餘 3 處；細節見 README 2026-10-04「資安掃描複核」。`fix/security-scan-20261004` 的 `f29dddb` 兩度合併 main（只有 README 頂部衝突），由使用者推成 `135b03f`。

- **內容**：資料庫錯誤堆疊遮掉 PostgreSQL DETAIL 與參數編碼錯誤裡的值（`backend/app/logging_config.py`，掛在 root 與 uvicorn handler）；已匿名化案件新增聯絡紀錄回 409 `VISIT_REQUEST_ANONYMIZED`；`design/entrance-curtain-a-velvet-20260922/render-posters.cjs` 本機伺服器改用 `path.relative` 判斷路徑。沒有 migration、API 契約不變。
- **CI**：`135b03f` 的 run 37246594548 排隊時被下一個 push（`ba32b9b`，30 週年分頁）取代而 cancelled（main 的 concurrency 只保留最新一個 pending）；`ba32b9b` 包含本次提交，它的 run 37246768321 E2E／Playwright、Backend／PostgreSQL／contracts、Frontend web／admin、Deploy Railway production 全部 success（2026-10-05 00:27–00:44 UTC，部署 00:40–00:44）。
- **正式 `release.json`**：base commit `ba32b9b`，created `2026-10-05T00:40:57Z`。
- **線上唯讀檢查**（00:5x UTC，未登入）：`/api/website/v1/health` 200；未登入 POST 聯絡紀錄 401。
- **未做**：正式站沒有登入驗證 409（要有已匿名化的案件）；沒有在正式站觸發資料庫錯誤看日誌（遮罩以本機 uvicorn `LOGGING_CONFIG` 實測）。


## 2026-10-05 後台拿掉首屏小標與校園探索熱點、官網公開輸出去舊欄位（main CI 部署）

使用者確認範圍（後台＋後端規則＋官網死碼）後要求 commit 併入 main。`feature/admin-legacy-fields-20261004` 的 4 個提交 rebase 到 `1069193`（只有 README 頂部衝突），由使用者執行 `git push origin HEAD:main` 快轉成 `5f6a0e8`。內容與本機驗證見 README 同日段落，規則見 DESIGN.md「後台欄位要對得上官網」。

- **內容**：後台拿掉首頁大圖標語的小標欄位、校園探索的整套熱點編輯與「熱點待複核」；後端小標與熱點改選填、拿掉換照片的熱點複核發布擋；官網刪除 `CampusTour`／`CampusFaq`／`CampusTestimonials` 與死 CSS，公開輸出（`public-copy.ts`）不帶已退場欄位。**沒有 migration**、不改寫已存資料，照 `deploy/CICD.md` 不需事先備份。
- **CI**：main run 37246311312（`5f6a0e8`）Backend／PostgreSQL／contracts、Frontend web／admin、Deploy Railway production success（2026-10-05 00:08–00:27 UTC）。E2E／Playwright 在 `uv sync` 從 PyPI 下載 `websockets==17.1` 連續 3 次失敗（測試未開始，與程式無關）；重跑（attempt 2）在 main 的 concurrency 群組排隊時被較新的 pending run 取代而取消。之後包含本批提交的 main run 37246768321（`ba32b9b`）E2E／Playwright success（00:27–00:32 UTC）。
- **正式 `release.json`**：base commit `5f6a0e8`，created `2026-10-05T00:23:24Z`；`/api/website/v1/health` 200。
- **線上唯讀檢查**（未登入）：後台 `assets/CampusTourView-*.js`、`HomeHeroView-*.js`、`MediaLibraryView-*.js`（含素材替換對話框）都沒有「熱點」「待複核」「標語上方的小標」，CampusTourView 有新的「原比例」說明。官網 `/`、`/environment`、`/visit`、`/about`、`/curriculum`、`/admission` 200，HTML 沒有 `faq`、`fbNote`、`heroPhotoPos`、原型的「僅示範流程」「我了解這是操作示範」；`/environment` 校園場景照常渲染。剩下的 `consentText` 字樣來自 fixture 的 `booking.fields`（舊原型表單欄位清單，官網沒有讀，不在本次範圍），`/admission` 的 `spots` 是 SVG 濾鏡名稱。
- **之後**：wave3（`merge/wave3-20261004`，page-cms＋media-jobs）在 `11ccc8e` 合進 main 時已含本批，查過 `content-overlay.ts`／`public-copy.ts`／`site-content.ts`／後台兩頁沒有把拿掉的欄位加回去。
- **未做**：正式站登入後台實際操作校園探索與首屏標語；Safari／iOS 實機。

## 公開地理資料同步（招生區域分析）

招生區域分析（後台「招生入學 → 統計分析 → 區域分析」）需要多種公開資料（以下四種是起頭的，「里的變化」另有出生、遷入遷出、所得、新成屋，各段在下方）：高雄市門牌坐標（比對家長地址的里與距離）、全國教保資訊網的高雄市幼兒園（附近幼兒園清單）、內政部各里人口（招生機會，2026-10-13，見下方「各里人口」）與托嬰中心名單（2026-10-14，見下方「托嬰名單與園所異動」）。這一段說明怎麼開自動同步、以及自動抓不到時的手動退路。**這是操作說明，不是部署紀錄**；部署後會另在上方補一段帶日期的紀錄（日期、commit、實際開關狀態）。規格 `docs/specs/2026-10-08-admissions-area-design.md` §7、§13，程式在 `backend/app/admissions/geo/sync.py`、`backend/app/workers/geo_loop.py`。

**六個環境變數**（api 服務，全部選填；沒設就用預設）：

| 變數 | 預設 | 作用 |
| --- | --- | --- |
| `WEBSITE_GEO_AUTO_SYNC` | `false`（所有環境） | 自動同步總開關。`true` **且** `WEBSITE_ADMISSIONS_ENABLED` 也是 `true` 時，api 啟動約 30 秒後開始背景同步迴圈；關著時迴圈不啟動，後台區域分析（從未匯入過資料時）顯示「門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。」，本校沒有座標，地圖先框住校址所在的行政區。手動指令 `geo-sync` 不看這個開關 |
| `WEBSITE_GEO_DOORPLATE_URL` | 空 | 空＝自動在高雄市政府資料開放平台找最新年度、最新月份的門牌檔。指定時必須是 `https://` 的檔案直連網址（平台改版、自動找不到時的退路），月份標籤改用同步當天的民國年月 |
| `WEBSITE_GEO_KINDERGARTENS_URL` | `https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json` | 幼兒園資料（kiang 每日整理全國教保資訊網）。必須是 `https://` |
| `WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL` | `https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv` | 教育部高雄市幼兒園名單（kiang 每日從全國教保資訊網爬下，約 200KB）。營業中以它為準；抓不到時幼兒園整輪不換版。必須是 `https://` |
| `WEBSITE_GEO_BABYCARE_URL` | `https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json` | 托嬰名單（kiang 每日整理衛福部社家署公開資料，約 1.4MB）。必須是 `https://` |
| `WEBSITE_GEO_SYNC_CHECK_SECONDS` | `86400` | 背景迴圈多久醒來檢查一次，允許 300 到 604800 秒。醒來後門牌、各里人口距上次確認超過 30 天、幼兒園與托嬰超過 7 天才真的去看來源（門牌先找最新月份，和使用中的一樣就不下載） |

設定都在 api 啟動時讀取，只改變數不重新部署不會生效。

**開啟前**：

- 確認 Railway PG 剩餘空間 **≥ 500MB**。門牌一版（775,772 列）含索引約 185MB（表 94MB＋索引 91MB）；每月換版時新舊兩版並存約 370MB，換完才刪舊版。`DELETE` 不會把空間還給檔案系統（只是讓 autovacuum 之後的新批次重用），所以第一次換版之後 `geo_doorplates` 在磁碟上會一直維持約兩版，穩態約 **370–400MB**（另加膨脹），不會回到 185MB。幼兒園只有幾百筆，可忽略。在 Railway Postgres 服務看 volume 用量與上限。
- 背景自動同步只在 `WEBSITE_ADMISSIONS_ENABLED=true` 時才會啟動；手動指令 `geo-sync` 不檢查這個開關，也不看 `WEBSITE_GEO_AUTO_SYNC`。
- 同步期間有一條專用連線握著 advisory lock，所以 `WEBSITE_GEO_AUTO_SYNC=true` 時連線池要能多借一條：`WEBSITE_DB_POOL_SIZE` ≥ 2，或 `WEBSITE_DB_MAX_OVERFLOW` ≥ 1（預設 10＋10 沒問題）；兩者都不符時 api 啟動直接報錯。同步的下載只跟 https 轉址。
- 匯入只用 `INSERT`／`DELETE`（`COPY` 寫入、清批次用 `DELETE`，不用 `TRUNCATE`），已改用只有 DML 權限的執行期角色時不需要額外權限。
- 首次匯入要下載約 100MB 的 CSV 並串流寫入（不落地、不整檔讀進記憶體）。本機從檔案匯入 77.6 萬列約 25 秒；Railway 上含下載的耗時與記憶體沒有量過，第一次開要看 api 的記憶體與 CPU。

**開啟步驟**：

1. Railway api 服務 Variables 設 `WEBSITE_GEO_AUTO_SYNC=true`（`WEBSITE_ADMISSIONS_ENABLED` 需已是 `true`）。
2. 重新部署 api。
3. 看 api log：啟動約 30 秒後開始同步。成功會有「門牌資料已更新：115-10，775772 筆」、「幼兒園資料已更新：N 所…」與「托嬰名單已更新：N 所…」；失敗是「門牌資料同步失敗：…」、「幼兒園資料同步失敗：…」或「托嬰名單同步失敗：…」；另一個副本正在同步時是「公開地理資料同步：另一個同步正在進行，這一輪跳過」。log 只記等級與原因，不含地址。
4. 後台「招生入學 → 統計分析 → 區域分析」狀態列應寫「門牌資料 115 年 10 月版・幼兒園名單 MM/DD 更新・托嬰名單 MM/DD 更新・各里人口 115 年 9 月」，原本「待比對」的訪視在同步結束時重算成到里或未定位。後台畫面不顯示失敗原因，要看原因查資料庫（只讀）：`select dataset, label, synced_at, checked_at, last_attempt_at, last_error from geo_dataset_status;`，`last_error` 只記原因、不含地址。
5. 確認舊批次已清掉：`select dataset_version, count(*) from geo_doorplates group by 1;` 只剩一個批次標記（列數每月略有不同，約 77 萬）。看 PG 空間時要有心理準備：換過一次版之後磁碟用量不會掉回 185MB，穩態約 370–400MB（見上面「開啟前」）。

**手動退路**（平台改版抓不到、想立刻更新、或想離線匯入）：

```bash
python -m app.cli geo-sync [--force] [--doorplates-file <CSV>] [--doorplates-version 115-10] [--kindergartens-file <JSON> --kindergartens-registry-file <CSV>] [--babycare-file <JSON>] [--population-file <JSON> ...]
```

Railway 上在 api 容器內跑（auto 模式會擋 `railway ssh`，自己在終端機執行）：`! railway ssh --service api --environment production -- python -m app.cli geo-sync`。

- 不帶參數＝和背景迴圈同一套（門牌、各里人口超過 30 天、幼兒園與托嬰超過 7 天才下載），結束時檢查「各校已發布校址＋使用中門牌批次」有沒有變、有變才重算訪視。`--force` 略過到期天數（30／7 天）與「月份相同」的判斷，立刻重抓；對幼兒園與托嬰也同時略過殘缺檔檢查（見下方「托嬰名單與園所異動」）。
- 指定任一個檔案＝完全不連外，沒指定檔案的那一種跳過，也不檢查門牌筆數下限。幼兒園檔案要和名單檔（kiang `docs/data/高雄市.csv`）一起給，只給一個會報錯。只帶一種檔案時另一種不會匯入：同時帶 `--kindergartens-file` 與 `--kindergartens-registry-file`（或 `--doorplates-file`），或之後再跑一次不帶檔案的 `geo-sync`；幼兒園資料沒匯入前，後台附近幼兒園清單寫「幼兒園資料尚未匯入」，不是附近沒有園所；托嬰同理，沒匯入前寫「托嬰名單尚未匯入」。檔案路徑是執行指令的那個容器裡的路徑（例如先放到 `/data` volume）。`--doorplates-version` 省略時從檔名找「115-10」「115_10」，找不到用今天的民國年月。
- 自動找不到門牌檔時：設 `WEBSITE_GEO_DOORPLATE_URL` 指到直連網址，或下載 CSV 後用 `--doorplates-file`。
- **正式站連不到高雄市資料平台**（2026-10-12 實測：api 自動下載兩次都 `ConnectTimeout`，同時間從台灣連 0.19 秒；判斷是擋境外 IP）：門牌的背景同步每次都會失敗（幼兒園與托嬰來源在 GitHub Pages，照常更新），畫面繼續用已匯入的版本；上次成功滿 30 天後，每一輪都會記一次「門牌資料同步失敗」WARNING。要換新月份就手動：在本機下載當月 CSV（資料平台搜尋「門牌坐標資料」，或用 `app.admissions.geo.sync.discover_doorplate_source` 找 `File/DirectDownload/<guid>`）→ `! railway volume -p <project> -e <env> files -v api-volume upload <本機 CSV> /doorplates-115-11.csv`（volume 根目錄＝容器 `/data`；檔名帶月份，`--doorplates-version` 就能省略）→ `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli geo-sync --doorplates-file /data/doorplates-115-11.csv` → 刪掉 CSV：`railway volume -p <project> -e <env> files -v api-volume delete /doorplates-115-11.csv`。auto 模式會擋前兩條，用 `!` 由使用者執行；刪檔連 `!` 都會被 Railway CLI 拒絕（偵測到 agent 環境），要在自己的終端機視窗或 Railway 網頁版的 volume 檔案頁刪。
- **結束碼 1**：另一個同步正在進行（會印「另一個公開資料同步正在進行，稍後再試」，什麼都沒做），或門牌、幼兒園、托嬰、各里人口、里的變化各種資料（出生、遷入遷出、所得、新成屋）任一種同步失敗（原因在 `geo_dataset_status.last_error`）。同一時間只允許一個同步，背景迴圈、CLI、多個副本共用同一把資料庫 advisory lock。

**各里人口（招生機會，2026-10-13）**：同一套同步多了第三種資料，給「區域分析」的招生機會用。規格 `docs/specs/2026-10-13-admissions-opportunity-design.md` §4。

- 來源：內政部戶政司 ODRP014「村里戶數、單一年齡人口」API，帶 `COUNTY=高雄市` 只回高雄 893 里（`https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/<民國年月>?COUNTY=高雄市&page=1`，一頁約 4.4MB、回應約 7 秒）；只留 0–6 歲人數與全里人口，寫進 `geo_village_population`（893 列，空間可忽略；本機解析峰值約 22MB）。不需要新的環境變數。
- 自動：和門牌、幼兒園同一個背景迴圈與開關（`WEBSITE_GEO_AUTO_SYNC`）。資料表空時立刻抓，之後超過 30 天才再看；從上個月往回最多找 4 個月，月份和使用中的一樣就只讀第一頁、不寫入。log：成功「各里人口已更新：115-09，893 個里，略過 0 列」，失敗「各里人口同步失敗：…」。驗證不過（月份不一致、數字不是整數、少於 850 個里、代碼重複）就不換版，畫面繼續用舊月份。
- 手動退路（正式站連不到內政部時；和門牌一樣可能被擋境外 IP，**還沒在 Railway 實測過**）：在本機下載 `curl -sSG "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11509" --data-urlencode "COUNTY=高雄市" --data-urlencode "page=1" -o population-11509.json`（`totalPage` 不是 1 時其餘頁照樣各存一檔）→ 上傳到 api volume（同門牌的 `railway volume … files -v api-volume upload`）→ `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli geo-sync --population-file /data/population-11509.json`（多頁就重複 `--population-file`）→ 刪掉上傳的檔案。指定人口檔時同樣完全不連外、門牌與幼兒園跳過；月份取資料本身的 `statistic_yyymm`。
- 看狀態：`select dataset, label, synced_at, last_error from geo_dataset_status where dataset = 'population';`；後台區域分析狀態列最後一段寫「各里人口 115 年 9 月」或「各里人口尚未匯入」。

**各里出生、遷入遷出與一年前的年齡（里的變化，2026-10-14，A 段）**：同一套同步再多兩種資料，給「區域分析」的「里的變化」表與地圖的「孩子增減」。規格 `docs/specs/2026-10-14-admissions-village-trends-design.md` §4。**尚未部署**。

- 來源：內政部戶政司 ODRP061（各里出生；2026-10-14 起取代 ODRP010：逐里數字相同、含 ODRP010 缺的月份、109-09 起連續）、ODRP011（遷入遷出），網址同 ODRP014，只把代碼換掉；帶 `COUNTY=高雄市` 一個月一頁（約 1.15 MB、1.2 MB）。寫進 `geo_village_births`（留最新月份往回 72 個月，約 6.4 萬列，給「近幾年的出生數」）、`geo_village_migration`（25 個月，約 2.2 萬列）。人口同步換月份時順便寫一份到 `geo_village_ages`，並補抓一年前那個月（約 4.4 MB），給「這一年淨增」比同一批孩子。不需要新的環境變數。
- migration `c5e9a1f3b7d2` 只新增三張表、放寬 `ck_geo_dataset_status_dataset`（多收 `births`、`migration`），不動既有資料。回退：舊映像不認得 `c5e9a1f3b7d2`，`check_schema.py` 會擋（見 CICD.md）；要退先用新映像跑 `alembic downgrade b4d7e1a92c58`（三張表刪掉、約束改回），再切舊映像。
- 自動：同一個背景迴圈與開關。表空時立刻回補到視窗起點：出生 72 個月、遷入遷出 25 個月，一個月一個請求，ris.gov.tw 每個請求隔 3 秒（連抓約 70 次曾回 HTML 擋頁，2026-10-14 實測）。一個月份一個交易：中途失敗已寫的保留，下一輪（隔天）從缺的接著補；整輪做完才記確認時間，之後 30 天看一次。出生表的視窗是 72 個月：表裡最舊月份比視窗起點晚 2 個月以上（例如部署前正式站只有 21 個月）就算到期，不管確認時間，隔天接著補，補到頭才回到 30 天一次（預估約 50 個請求、5～8 分鐘、約 55 MB；111-03 兩個資料集都查無，是永久缺月，畫面寫「缺 111 年 3 月」）。Railway 連得到 ris.gov.tw（10-14 第一輪同步實測，見上方 2026-10-14「里的變化」A、C、D、B1 段的部署紀錄）；72 個月回補的請求數、時間與用量正式站還沒實測，失敗才走下面的「一次打包」。來源查無資料的月份不記錄（出生改抓 ODRP061 後只缺 111-03），下次再問。log：成功「各里出生已更新：最新 115-09，這一輪寫入 N 個月份」，失敗「各里出生同步失敗：…」；一年前的年齡失敗寫在 `population` 的 `last_error`（開頭「一年前的人口：」），不影響使用中的人口。
- 手動：`--births-file <JSON>`、`--migration-file <JSON>` 可重複（一個月一檔，月份取資料本身）。`--population-file` 給比使用中舊的月份時改成只寫進年齡歷史（結果 `history`），不再當錯誤；使用中的人口照樣不倒退。
- **一次打包（正式站連不到內政部時）**：在台灣的電腦 `cd backend && uv run python scripts/fetch_geo_bundle.py --out geo-bundle-11509.zip`（不需要資料庫與環境變數；出生抓 72 個月後約 106 個檔，時間與 zip 大小打包時量，2026-10-14 A 段實測 48 個檔、2.4 MB 是出生 25 個月的版本）→ `! railway volume -p <project> -e <env> files -v api-volume upload geo-bundle-11509.zip /geo-bundle-11509.zip` → `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli geo-sync --bundle /data/geo-bundle-11509.zip` → 在自己的終端機刪掉 volume 上的 zip（同門牌）。zip 裡有 `manifest.json`（每個檔的種類、期間、來源、sha256），manifest 不對或 sha256 不符整包不匯入、exit 1。門牌 CSV 不進打包檔。
- 看狀態：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset in ('births', 'migration', 'population');`、`select count(distinct month) from geo_village_births;`（補完後預期 71 個月：109-10 到最新月份，缺 111-03；`select min(month), max(month) from geo_village_births;`）、`select month, count(*) from geo_village_ages group by 1;`（應有使用中月份與一年前兩個月）。

**各里所得（里的變化 C 段，2026-10-14）**：同一套同步再多一種資料，給「里的變化」表的「所得中位數」欄。規格 `docs/specs/2026-10-14-admissions-village-trends-design.md` §4.4。**尚未部署**（要在 A 段之後）。

- 來源：財政部財政資訊中心「綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市」（`https://www.fia.gov.tw/WEB/fia/ias/ias112/112_165-E.csv`，約 90 KB）；新年度從 data.gov.tw 資料集 17971（`https://data.gov.tw/api/v2/rest/dataset/17971`）的檔案清單找，每年約 8 月出新年度。寫進 `geo_village_income`（只存最新一個年度、879 列）。不需要新的環境變數。
- migration `d8b3f6a2c914` 只新增一張表、放寬 `ck_geo_dataset_status_dataset`（多收 `income`），不動既有資料。回退：舊映像不認得 `d8b3f6a2c914`，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade c5e9a1f3b7d2`，再切舊映像。
- 自動：表空時立刻抓，之後 30 天看一次有沒有新年度；data.gov.tw 讀不到時直接試下一個年度（404＝還沒出，只記確認時間）。`www.fia.gov.tw` 常 reset 連線（2026-10-14 實測約一半），下載間隔 2、4、8 秒最多重試三次。log：成功「各里所得已更新：112 年度，879 個里，略過 11 列」，失敗「各里所得同步失敗：…」。
- 手動：`--income-file <CSV>`，年度取檔名（`112_165-E.csv`）或 `--income-year 112`；比使用中舊的年度要加 `--force`。打包檔（`fetch_geo_bundle.py`）也會帶最新年度的所得。
- 看狀態：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset = 'income';`、`select year, count(*) from geo_village_income group by 1;`（112 年度應有 879 列）。

**新成屋交屋（里的變化 B1 段，2026-10-14）**：同一套同步再多一種資料。B1 只同步與比對；**B2（2026-10-14）起「里的變化」表多「近 4 季新屋」欄、地圖多「新屋交屋」著色**（API 欄位與實作差異見規格 §18）。規格 `docs/specs/2026-10-14-admissions-village-trends-design.md` §4.3。B1 已隨 main 部署（正式站 10-14 同步第一輪已寫入 8 季、26,035 列）；**B2 尚未部署**。

- 來源：內政部實價登錄高雄市買賣季檔 `https://plvr.land.moi.gov.tw/DownloadSeason?season=<115S3>&fileName=e_lvr_land_a.csv`（一季約 3.5 MB）。寫進 `geo_new_home_sales`，留最新季往回 8 季（約 2.6 萬列、5 MB）。不需要新的環境變數。
- migration `e4f1a8c6b203` 只新增一張表、放寬 `ck_geo_dataset_status_dataset`（多收 `new_homes`），不動既有資料。回退：舊映像不認得 `e4f1a8c6b203`，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade d8b3f6a2c914`，再切舊映像。
- 自動：表空時立刻抓——從今天所在的季往回試三季找最新季，再回補 8 季（約 30 MB）；之後 30 天看一次有沒有下一季。HTTP 200 的錯誤頁＝那一季還沒出。每季一個交易，中途失敗隔天接著補。同步結束時，比對時門牌月份和使用中不同的列整批重比（門牌換版、或匯入時門牌還沒進來）。log：「新成屋已更新：最新 115S3，這一輪寫入 N 季」、「新成屋同步失敗：…」。
- 手動：`--new-homes-file 115S3_e_lvr_land_a.csv`（可重複，季別取檔名；檔名沒有季別時配 `--new-homes-season 115S3`，只能一個檔）；打包檔也帶 8 季。
- **命中率報告（B2 閘門，2026-10-14 已量、已過）**：在台灣網路下載門牌後跑（雲端與正式站連不到 `data.kcg.gov.tw`）：`WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=… WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/<庫名要含 geo 與 test> WEBSITE_SESSION_SECRET=… uv run python scripts/geo_match_report.py <門牌.csv> <preschools.json> --new-homes 115S3_e_lvr_land_a.csv --season 115S3`（腳本自己匯入門牌，不必先 `geo-sync`；不會自動下載，三個檔案要先備好；庫要先 `alembic upgrade head`、用完 `dropdb`）。到里（exact＋nearby＋street）≥ 90% 才做 B2。**結果：98.9%（3,805 筆裡 exact 3,765），補跨區界道後 99.9%（exact 3,801）**，寫在規格 §2.2；幼兒園地址 97.6%。
- **跨區界道修正的部署注意（B2 分支）**：不需要 migration、不需要備份。已存在表裡的新成屋列與訪視是用舊規則比對的，要等下一次門牌換版（每月手動匯入 115-11 之後的 `geo-sync` 結尾會重比）才會補上；七賢一路 61–95 號那 63 筆目前存的是「苓雅區、只到區」。想立刻補：用打包檔或 `--new-homes-file` 重匯新成屋（檔案模式會整季重比，不連外）。
  - **2026-10-15 已補**：使用者在本機下載 114S4–115S3 四季 `e_lvr_land_a.csv`、上傳到 api volume 根目錄，跑 `geo-sync --new-homes-file /data/114S4_e_lvr_land_a.csv …（四個）`，輸出「新成屋：updated（最新 115S3，這次寫入 4 季，重比 0 筆）」（重比 0 是結尾「門牌月份不同」那一段；四季本身由檔案匯入重新比對），其他資料全部 skipped。之後讀義華 `/area/trends`（3 公里）：`sources.new_homes.unplaced` 63 → 0，有新屋的里仍 17 個、近 4 季 1,524 筆、最新季 469 筆；里的變化不再寫「範圍內的區另有…只到區」。volume 上的四個 CSV 要由使用者在自己的終端機刪（Railway CLI 拒絕 agent 刪檔）。
- 看狀態：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset = 'new_homes';`、`select season, count(*) from geo_new_home_sales group by 1 order by 1;`、`select match_level, count(*) from geo_new_home_sales group by 1;`。

**預售建案（2026-10-20，`feature/admissions-data-20261020`，10-20 已部署 main `a5ac4998`）**：同一套同步再多一種資料，給區域分析的「在建預售」模式、「各里」表的「在建預售（戶）」欄與「預售建案」分頁用。規格 `docs/specs/2026-10-20-admissions-presale-design.md`（§8 實作紀錄）。

- 來源：內政部實價登錄「預售屋建案備查」高雄市單檔 `https://plvr.land.moi.gov.tw/Download?PayType=saleremark&fileName=e_lvr_buildcase.csv`（約 180 KB，每月 1 日重產、自 110-07 起累計）。寫進 `geo_presale_buildcases`（約 660 案）。**不存起造人**（整欄不讀）。不需要新的環境變數。
- migration `a3d7f1c9b5e2`：只新增 `geo_presale_buildcases`、`geo_parcel_points` 兩張表、放寬 `ck_geo_dataset_status_dataset`（多收 `presale_buildcases`），不動既有資料，不需要先備份。回退：先用新映像跑 `alembic downgrade d4a8f2c6e913`（先刪 `presale_buildcases` 狀態列、再還原約束、刪兩張表），再切舊映像。
- 自動：表空時立刻抓，之後 30 天一次；內容 sha256 沒變只記確認時間。換版以新檔為準（不在新檔裡的案刪掉）；高雄筆數少於上次的 80%（上次 ≥ 100 案）不換、原因寫進 `last_error`，確定來源真的縮小才用檔案模式加 `--force`。log：「預售建案已更新：N 案（115-10），壞行 …」、「預售建案同步失敗：…」。
- **地號座標只能手動**（正式站同步不連國土測繪中心）。街名法本機實測只有約 6 成的案到里（真門牌 115-10 加真檔：到里 407／661，只到區 254），地號座標補上才準：
  1. 在台灣的電腦：`cd backend && uv run python scripts/fetch_presale_parcels.py --out presale_parcels.csv`（不需要資料庫與環境變數；第一次約 660 次查詢、每次間隔 ≥ 1 秒、至少 11 分鐘，每 25 個存檔一次，中斷重跑會接著做；查無的寫空座標、下次不重查，要重查加 `--retry-missing`；`--limit 50` 可以先試跑）。國土測繪中心的地號查詢沒有公開文件與授權（使用者 10-20 選擇照用），只在本機、低頻、不帶任何帳號。
  2. 打包：`uv run python scripts/fetch_geo_bundle.py --presale-parcels presale_parcels.csv --out geo-bundle-11510.zip`（會連同出生、遷入遷出、人口、所得、新成屋與預售建案檔一起抓）。只想補預售建案時也可以不打包，直接把兩個檔上傳。
  3. 上傳匯入（同上面「一次打包」；agent 不能刪 volume 檔，刪檔用自己的終端機）：`! railway volume -p <project> -e <env> files -v api-volume upload geo-bundle-11510.zip /geo-bundle-11510.zip` → `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli geo-sync --bundle /data/geo-bundle-11510.zip`；單檔用 `--presale-file /data/presale-buildcases-115-10.csv --presale-parcels-file /data/presale_parcels.csv`（版本月份取檔名「115-10」，沒有就用今天）。輸出會有「預售建案：updated（使用中 115-10，這次寫入 N 案，重比改變 M 案）；地號座標：updated（匯入 K 列）」。
  4. 匯入地號座標後整批重比；之後每月把新建案的地號補查一次（只查輸出檔裡還沒有的）。
- 看狀態：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset = 'presale_buildcases';`、`select match_level, count(*) from geo_presale_buildcases group by 1;`、`select count(*), count(lon) from geo_parcel_points;`。後台「系統狀態」頁的資料集清單多「預售建案」。
- 注意：已登記的建案不再算在建；建照超過 6 年還沒登記的歸「不明」，不進任何統計（規格 P3）。預計交屋是依建照日與規模的粗估（P4），畫面一律標「粗估」。

**幼兒園裁罰與評鑑（2026-10-20，`feature/admissions-data-20261020`，10-20 已部署 main `a5ac4998`）**：同一套同步再多兩種資料，給「區域分析 → 附近幼兒園」清單的「近 3 年裁罰 N 件」、最近一次評鑑小字與展開的明細用。規格 `docs/specs/2026-10-20-peer-penalties-evaluations-design.md`（§8 實作紀錄）。

- 裁罰來源：kiang 的 `ap.ece.moe.edu.tw` 整理（`kiang.github.io/ap.ece.moe.edu.tw/data/punish/高雄市/<園名>.json`，約 240 檔、570 筆），檔名清單走 GitHub API `contents/docs/data/punish/高雄市`。寫進 `geo_kindergarten_penalties`。**來源每筆的「負責人／行為人：姓名」只取標籤轉成對象類別（`operator`／`staff`），姓名不進資料庫、API、日誌與狀態列錯誤訊息。**評鑑來源：教保資訊網公開搜尋 `https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx`（ASP.NET 表單，高雄約 689 所、69 頁、沒有驗證碼），只讀評鑑表的學年度、完成日、結果，同一區塊的負責人、電話一律不讀；寫進 `geo_kindergarten_evaluations`（只存名稱對得到園所的列）。不需要新的環境變數。
- migration `b8e2d6a4f931`（接 `a3d7f1c9b5e2`）：只新增兩張表（各一個 `source_id` 索引）、放寬 `ck_geo_dataset_status_dataset`，並把 `geo_dataset_status.dataset` 欄由 20 字放寬到 32 字（新資料集名稱 22、24 字；PostgreSQL 放寬 varchar 長度不重寫資料表）。不動既有資料，不需要先備份。回退：先用新映像跑 `alembic downgrade a3d7f1c9b5e2`（先刪兩個新狀態列、還原約束與欄寬、刪兩張表），再切舊映像。
- 自動（`WEBSITE_GEO_AUTO_SYNC` 開著、幼兒園名單這一輪沒失敗時，跟在幼兒園同步之後）：從沒匯入過就第一輪抓，之後裁罰每 7 天、評鑑每 30 天整表替換。log：「幼兒園裁罰已更新：N 筆（M 所），略過 …、下載錯誤 K 檔（保留舊列）」「幼兒園評鑑已更新：N 筆（對到園所 M 所），搜尋結果 … 所、69 頁」「…同步失敗：原因」。
  - 裁罰：單檔 256 KB、請求間隔 0.2 秒、整輪 10 分鐘（外層另有 12 分鐘硬性逾時）；404 不算錯誤。換版門檻：檔名清單少於表內園所數的 80%（表內至少 50 所）、或下載錯誤超過一成就不換、原因寫進 `last_error`、保留舊資料；沒抓成功的那幾所保留舊列。**GitHub API 對共用 IP 的未驗證請求限流（60 次／小時），Railway 出口 IP 可能被限**：清單讀不到時自動退回「營業中園所名稱＋表裡已有的名稱」逐一試（約 700 個請求，log 會寫「裁罰檔名清單讀不到（…），改用已知園所名稱逐一試」）；退回時漏掉的新檔下次清單讀得到再補。
  - 評鑑：單頁 2 MB、請求間隔 1 秒、整輪 15 分鐘（外層 17 分鐘）；GET 表單頁 → POST 搜尋 → 逐頁 POST 換頁，每頁回來檢查頁碼，對不上就中止（「換頁後頁碼對不上」）。換版門檻：抓到的園所少於 600 所或頁數少於 60 就不換。**第一次對真站走完 69 頁是上線後第一輪**（開發時只對真站做過一次 GET 加一次 POST 的第 1 頁），換頁行為若和假站不同，會在這一輪以上述訊息失敗、不會寫壞資料。
  - **TLS**：教保資訊網伺服器只送葉憑證、沒送 TWCA 中繼憑證，Python 驗證會失敗。**不關閉驗證**：用 certifi 的根憑證加上隨程式提交的 `backend/app/admissions/geo/certs/twca-secure-ssl-2023g3.pem`（TWCA Secure SSL Certification Authority，檔頭註明來源、指紋、**有效期間至 2030-10-16**）。TWCA 改簽發鏈時驗證會失敗，`last_error` 是「憑證驗證失敗（TLS）」：換新的中繼憑證檔重新部署，或改用下面的本機打包。
- 看狀態（Railway Postgres 的 Database 分頁）：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset in ('kindergarten_penalties','kindergarten_evaluations');`、`select kind, subject, count(*) from geo_kindergarten_penalties group by 1,2 order by 1,2;`、`select count(*), count(source_id), count(distinct school_name) from geo_kindergarten_penalties;`、`select count(*), count(distinct source_id), max(school_year) from geo_kindergarten_evaluations;`。預期：裁罰約 530 列（本機真檔實測 534 列，對到園所 441 列、194 所）、label 是上線當天；評鑑約 1,200–1,800 列（第 1 頁每所 2–3 筆推估，沒有實測）。後台「系統狀態」頁的資料集清單多「幼兒園裁罰」「幼兒園評鑑」。CLI `geo-sync` 會多印一行「幼兒園裁罰：updated（2026-10-20，這次寫入 N 筆）；幼兒園評鑑：…」，失敗時 stderr 印「幼兒園裁罰同步失敗：…」並以結束碼 1 結束。
- **手動退路（正式站連不到來源、或評鑑 TLS 失敗時）**：在台灣的電腦 `cd backend && uv run python scripts/fetch_geo_bundle.py --kindergarten-only --out geo-bundle-kindergartens.zip`（不需要資料庫與環境變數；抓 238 個裁罰檔約 1 分鐘、評鑑 69 頁約 2–3 分鐘，轉成我們自己的 CSV：裁罰沒有人名欄、評鑑只有名稱／學年度／完成日／結果，下載有失敗或評鑑少於 600 所／60 頁就不打包），上傳到 api volume 後 `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli geo-sync --bundle /data/geo-bundle-kindergartens.zip`（單檔用 `--kindergarten-penalties-file`、`--kindergarten-evaluations-file`）；匯入整表替換、不檢查筆數下限；用完在自己的終端機刪 volume 上的檔。不加 `--kindergarten-only` 則連同人口、出生、所得、新成屋、預售建案一起打包。
- 人工放行殘缺門檻（`--force` 不會略過）：裁罰在資料庫 `delete from geo_kindergarten_penalties; delete from geo_dataset_status where dataset = 'kindergarten_penalties';` 下一輪當作從沒匯入、整批重抓；評鑑同理（表與 `kindergarten_evaluations`）。
- 注意：表裡的同一件（同園所、裁處日、文號）在畫面算一件，件數是「近 3 年」（含三年前的同月同日）；3 年前的另外標「3 年前有裁罰」。裁罰對象為教保人員個人（行為人）時畫面寫「教保人員個人受罰」，不代表園方受罰。

**每年九月底人口與國小一年級人數（2026-10-20，`feature/admissions-potential-20261020`，10-20 已部署 main `4c90ef58`）**：同一套同步再多兩種資料，給招生統計新分頁「招生潛力與市佔率」算市佔率的分母與國小對帳。規格 `docs/specs/2026-10-20-admissions-potential-share-design.md`（§10 是第一波實作紀錄），來源與檔案細節在 `backend/app/admissions/geo_data/README.md` 最後一節。

- migration `76c4bf84b907`（接 `a6c2e9f4b8d1`）：新增 `campus_term_enrollment`（歷年註冊，見下方「歷年註冊匯入」）、`geo_village_ages_september`、`geo_elementary_grade1` 三張表，放寬 `ck_geo_dataset_status_dataset`（多收 `elementary`）。只新增表與放寬約束，不動既有資料，**不需要先備份**；上一版程式不讀新表也不寫 `elementary` 狀態列，先跑 migration 再換程式也相容。回退：先用新映像跑 `alembic downgrade a6c2e9f4b8d1`（先刪 `elementary` 狀態列、再還原約束、刪三張表；已匯入的歷年註冊與這兩種公開資料一併消失），再切舊映像。
- 來源：九月底人口是內政部戶政司 ODRP014（和各里人口同一支 API，**107 年起**每年九月底一批，不刪舊年）；國小一年級人數是教育部統計處「國民小學校別學生數」`https://stats.moe.gov.tw/files/detail/<學年>/<學年>_basec.csv`（一學年一檔，107～114 學年；115 學年 2026-10-20 實測還沒公布）。唯一的新環境變數是選填的 `WEBSITE_GEO_ELEMENTARY_URL_TEMPLATE`（預設就是上面的網址，必須是含 `{year}` 的 `https://`）。
- 自動（`WEBSITE_GEO_AUTO_SYNC` 開著）：人口同步寫到九月時直接寫進九月表，另外每次寫完年齡歷史會把年齡歷史裡有、九月表沒有的九月補進去（九月表的寫入用 SAVEPOINT 包住，失敗只記 WARNING「九月底人口 … 寫入失敗，不影響人口與年齡歷史」「九月底人口從年齡歷史補漏失敗，下一輪再補」，不會拖累人口更新）；國小每 30 天看一次，從表內最新學年＋1 抓到「目前學年 − 1」（空表從 107 抓起），404 視為還沒公布。**Railway 連不連得到 `stats.moe.gov.tw` 沒實測過**，而且九月底人口要一次補 107～115 共九個月，所以第一次匯入建議走下面的打包。
- **第一次匯入（打包，建議）**：在台灣的電腦 `cd backend && uv run python scripts/fetch_geo_bundle.py --out geo-bundle-11510.zip`（不需要資料庫與環境變數；會連同其他資料一起抓。九月底人口抓 107 年起到人口最新月份以前最後一個九月，已抓過的月份不重抓，檔名 `september-<民國年月>-<頁>.json`、種類 `september`；國小抓 107 學年起到前一學年共 8 個檔，404 跳過、先驗證再打包，檔名 `<學年>_basec.csv`、種類 `elementary`）→ 上傳與匯入同上面「一次打包」：`! railway volume -p <project> -e <env> files -v api-volume upload geo-bundle-11510.zip /geo-bundle-11510.zip` → `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli geo-sync --bundle /data/geo-bundle-11510.zip` → 在自己的終端機刪掉 volume 上的 zip。輸出會多「九月底人口：updated（這次寫入 N 年）；國小一年級人數：…（最新 114 學年，這次寫入 N 學年）」，預期 N 分別是 9（107～115）與 8（107～114）。
- **單檔手動**：`--september-file <JSON>`（可重複，一頁一檔；**只收統計月份是九月的檔**，收到其他月份整批不匯入、印原因、exit 1；只寫九月底人口表，不動使用中的人口月份與年齡歷史）、`--elementary-file <NNN_basec.csv>`（可重複，學年取檔名，檔名不是 `<三位數學年>_basec.csv` 整批不匯入；每學年整批取代）。指定任一個檔就完全不連外。下載：`curl -sSG "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/10709" --data-urlencode "COUNTY=高雄市" --data-urlencode "page=1" -o september-10709-1.json`（`totalPage` 不是 1 時其餘頁各存一檔；10709、10809、10901 這幾個月的回應每列第一個鍵帶 BOM，程式會剝掉）、`curl -sSLo 114_basec.csv https://stats.moe.gov.tw/files/detail/114/114_basec.csv`。上傳到 api volume、`geo-sync` 帶檔案路徑（`/data/…`）、刪檔的做法同上面「手動退路」。
- 看狀態：`select year, count(*), sum(age_2 + age_3 + age_4 + age_5) from geo_village_ages_september group by 1 order by 1;`（預期 107～115 九年；本機實測 107、108 年各 891 列、115 年 893 列，107、108 年的舊里代碼寫入時已換成現行代碼）、`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset = 'elementary';`、`select school_year, count(*), sum(grade1) from geo_elementary_grade1 group by 1 order by 1;`（預期 107～114 學年，每學年高雄市約 246～249 所）。後台「系統狀態」頁的資料集清單多「國小一年級人數」，過期門檻是 400 天（一學年才更新一次），不是其他資料的 30 天。
- 匯入後打開後台「招生統計 → 招生潛力與市佔率」：還沒匯入歷年註冊的校區只寫一句「尚未匯入歷年註冊。」，匯入後義華最新學年（115）應是 189 ÷ 9,788 位、1.93%。

**國小學區（里的變化 D 段，2026-10-14）**：對照檔隨程式提交（`backend/app/admissions/geo_data/school-districts-115.csv` 等），沒有同步、沒有 migration、不需要環境變數；部署就生效。每學年（約 1 月）教育局公告新一覽表後要改程式重新部署，步驟在 `backend/app/admissions/geo_data/README.md`「換學年」。**尚未部署**（要在 A、C 段之後）。

**托嬰名單與園所異動（2026-10-14）**：同一套同步再多一種資料，給「區域分析」的托嬰清單與「附近園所的變化」用。規格 `docs/specs/2026-10-14-provider-changes-design.md` §4。

- 來源：`https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json`（kiang 每天用 GitHub Actions 整理，與幼兒園同一個 `kiang.github.io`，Railway 連得到；本機下載曾花 70 秒，正式站逾時預算 120 秒、整種資料上限 5 分鐘、檔案上限 8MB）。只留高雄市營業中的機構，寫進 `geo_babycare`。
- 自動：和門牌、幼兒園同一個背景迴圈與開關（`WEBSITE_GEO_AUTO_SYNC`）。**幼兒園與托嬰每 7 天看一次來源**（門牌、各里人口與里的變化各種資料仍是 30 天）；`geo_dataset_status.baseline_on` 還是空的（還沒用異動比對的程式同步過）也算到期，所以部署後第一輪背景同步就會補上幼兒園設立日、建立托嬰名單與基準日。
- 異動：同步不再刪光重寫，改成依 `source_id` 比對；名單裡不見的標停辦（`is_active` 假、列留著），新設、停辦、類型變動寫進 `geo_provider_events`。第一次同步只建立基準、不寫事件。停辦後 30 天內又出現的視為來源漏收，撤掉停辦事件。新名單營業中的數量少於上次的 80%（上次 ≥ 20 所才檢查）不換版，原因寫進 `last_error`；確定來源真的大幅縮減才用 `geo-sync --force`。
- 手動退路（正式站連不到時）：本機下載 `curl -sSLo babycare.json https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json`，上傳到 api volume 後 `python -m app.cli geo-sync --babycare-file /data/babycare.json`（刪檔用自己的終端機，agent 不能刪 volume 檔）。
- **放行殘缺檔檢查要用檔案模式**：單獨 `geo-sync --force` 會同時強制重抓門牌、各里人口與里的變化各種資料（Railway 連不到高雄市資料平台時門牌會 failed、結束碼 1），而且 `--force` 同時也是略過殘缺檔檢查。只想放行托嬰或幼兒園（確定來源真的縮小）時，先把檔案下載到本機、上傳到 api volume，再跑 `geo-sync --babycare-file <JSON> --force`（或 `--kindergartens-file <JSON> --kindergartens-registry-file <名單 CSV> --force`；幼兒園的 JSON 和名單 CSV 要成對給，名單也要先下載、上傳）——單一種資料、不連外。
- 看狀態：`select dataset, label, synced_at, baseline_on, last_error from geo_dataset_status where dataset in ('kindergartens', 'babycare');`；看異動：`select provider, change, occurred_on, count(*) from geo_provider_events group by 1, 2, 3 order by 3 desc limit 20;`。後台區域分析狀態列會寫「托嬰名單 MM/DD 更新」或「托嬰名單尚未匯入」。
- 回退：舊映像不認得新 revision，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade e4f1a8c6b203`（刪新表與新欄位、約束改回，已記的異動一併消失）再切舊映像。不 downgrade 就切舊映像會被 `check_schema.py` 擋下（停站）；若有人繞過檢查硬啟動舊版，舊版同步是「刪光重寫」，會把已停辦（`is_active` 假）的列一併刪掉，已記的 `closed` 事件變成孤兒（畫面讀取時 join 不到、直接忽略），之後再上線新版也補不回來，要重新建立基準與事件就先 downgrade 再 upgrade。

**幼兒園營業中改以教育部名單判斷（2026-10-15）**：幼兒園的營業中不再看 kiang `preschools.json` 的 `is_active`（一旦是 1 就不會變回 0），改以教育部名單（`WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`，kiang `docs/data/高雄市.csv`）為準；規格 `docs/specs/2026-10-15-kindergarten-registry-design.md`。名單抓不到或格式不對，幼兒園整輪不換版。不新增 migration、不需要新環境變數（名單網址有預設值）。

- **回補檔（同步每一輪都會讀，不要刪）**：`backend/app/admissions/geo_data/kindergarten-closures-20261015.csv` 隨程式提交，47 筆；檔不在或格式不對時幼兒園整輪不換版、原因寫進 `last_error`。只有某所「這一輪要下架」時才用到其中一列。說明與重產指令在 `backend/app/admissions/geo_data/README.md`。**（2026-10-20 起這份檔由 `kindergarten-closures-20261020.csv`（94 筆）取代並已移除，換版與預期值見下面「招生潛力第二、三波」一節；下面「轉換輪的預期值」以 10-15 檔為準，若轉換輪在換版之後才跑，停辦事件會是 33 而不是 16。）**
- **轉換輪的預期值**（部署後第一輪幼兒園同步，把 kiang 還標營業中、但已不在名單的 47 所一次下架）：api 日誌（背景同步迴圈才印 INFO，手動 `geo-sync` 不印；Railway 日誌 auto 模式會擋，要使用者用 `!` 跑：`railway logs -p <project> -e production -s api -d --since 3h -n 3000 -f 'admissions.geo'`）會有一行「幼兒園資料已更新：689 所，略過 … 筆、名單有但沒有座標 … 筆；停辦事件 16、依回補檔下架 33、改名下架 14、重新營業 0、類型變動 0」，以 2026-10-15 的回補檔為準：
  - 營業中約 **689**（名單 689 所，之後名單增減會跟著變）。
  - 停辦事件＝回補檔有日期的停辦 **16**（日期介於 2025-08-22 與 2026-10-13），另加 10-15 之後才離開名單的（不在回補檔裡，日期記同步當天）。
  - 依回補檔下架＝回補檔 `closed` 列數 **33**（其中 17 筆沒日期，只下架不寫事件）。
  - 改名下架＝回補檔 `renamed` 列數 **14**，另加規則（同地址、同設立日）認出的新改名。
  - 重新營業、類型變動通常是 0，不是 0 就逐筆看。
  - 以資料庫為準（Railway Postgres 的 Database 分頁）：`select change, occurred_on, count(*) from geo_provider_events where provider = 'kindergarten' group by 1, 2 order by 2;` 與 `select count(*) from geo_kindergartens where is_active;`。
- **立刻生效要手動 `geo-sync --force`**：它會同時略過 80% 殘缺護欄，跑之前先確認名單筆數正常（`curl -s 'https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv' | wc -l` 約 690 行，含標頭）；名單歷史出現過只有一半的殘缺版本（2025-07-09 只有 351 列）。不想等也可以用成對的檔案模式（見上方「放行殘缺檔檢查要用檔案模式」）。

**幼兒園收費與托嬰明細（2026-10-15，附近同業比較）**：給「區域分析 → 附近同業收費」、附近幼兒園的公告收費與空間服務、附近托嬰的月費與評鑑用。規格 `docs/specs/2026-10-15-peer-comparison-design.md` §4、§10。migration `f2b8c4d1e7a9`（接在在籍學生 `f2a7c1e9d4b3` 之後）只新增 `geo_kindergarten_fees` 表與幾個欄位，不改既有資料，不需要備份閘門。

- **收費來源**：kiang 整理的全國教保資訊網收費檔 `https://kiang.github.io/ap.ece.moe.edu.tw/data/slip{學年}/高雄市/<園名>.json`（一所一檔，約 37 KB；和幼兒園名單同一台主機，Railway 連得到）。**目前停在 114 學年**：115 學年在教保資訊網的驗證碼後面，kiang 的爬蟲寫死 114，我們不繞過驗證碼；kiang 一更新就會自動換新。只讀每檔的 `slip`（收費表），不讀 `meta`。
- **收費時機**：幼兒園名單這一輪更新成功（每 7 天）就接著做；**收費從沒匯入過時不等名單到期**（部署後第一輪背景同步就會抓，不必 `--force`）。名單同步失敗時不做（避免拿舊名單補收費）。檔案匯入模式（`--kindergartens-file` 等）不抓收費，不支援收費檔匯入。
- **收費做法**：從目前學年往回試三年找最新學年（探測 5 所：已有收費的園所，沒有就挑私立與準公共）。學年換新、距上次全量 30 天或 `--force` 時全量（約 690 檔、0.2 秒間隔，本機實測約 5 分鐘），否則只補沒有收費的園所。全量抓到的園所少於上次 80%（上次 ≥ 20 所才檢查）、或下載錯誤超過一成就不換版；找到的學年比使用中的舊也不換版；原因都寫進 `last_error`。單檔 512 KB、整輪 20 分鐘上限（外層另有 22 分鐘硬性逾時）。404＝這所沒公布收費，不算錯誤。狀態列 `kindergarten_fees`（label＝學年）。**`--force` 不會略過上面三道門檻**（規格沒給放行）；kiang 真的大幅減檔時，人工放行的做法是在資料庫 `delete from geo_kindergarten_fees; delete from geo_dataset_status where dataset = 'kindergarten_fees';`，下一輪就當作從沒匯入、整批重抓。
- **托嬰明細**：托嬰名單這一輪更新成功就逐所抓 `https://kiang.github.io/ncwisweb.sfaa.gov.tw/data/高雄市/<id>.json`（高雄營業中約 150 所、每所約 5 KB、0.2 秒間隔）；名單沒更新時只補還沒有明細的那幾所。只存平均月費（日間托育「托育費」）、費用說明、評鑑等級與年度、準公共，不存負責人、電話、違規與退費說明。單所失敗保留舊值；整段 5 分鐘硬性上限；這一段怎麼失敗都只寫 WARNING，不改托嬰名單的結果、不中斷後面的資料種類。`--babycare-file` 匯入時不抓明細。
- **部署後第一輪的預期**（本機 2026-10-16 對真實資料跑過一次完整同步）：幼兒園收費 updated、114 學年、約 603 所有收費（2 歲 494 列、3–5 歲各 603 列）；托嬰明細全部抓到（152 所，有月費 145、有評鑑 111）。全域同步鎖內多出約 5–6 分鐘；之後每週約 90 個補缺請求＋150 個托嬰明細，每 30–37 天一次收費全量。
- **注意幽靈園所**：教保資訊網名單修正（`54031d7c`）要等正式站下一輪幼兒園同步才會下架那 47 所。若收費比名單修正先跑，那幾所停辦園所會出現在同業統計，名單同步下架後自動消失（統計只看營業中的園所）。介意的話上線前先確認 `kindergartens` 的 `checked_at` 晚於 `54031d7c` 的部署時間。
- **上線驗收 SQL**（Railway Postgres 的 Database 分頁）：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset in ('kindergartens','kindergarten_fees','babycare');`、`select age, count(*) from geo_kindergarten_fees group by age order by age;`、`select count(*), count(monthly_fee), count(evaluation_grade), count(quasi_public) from geo_babycare where is_active;`、`select count(*) filter (where indoor_m2 is not null), count(*) filter (where has_shuttle) from geo_kindergartens where is_active;`。CLI `geo-sync` 會多印一段「幼兒園收費：updated（114 學年，這次 N 所）」，失敗時 stderr 印「幼兒園收費同步失敗：…」並以結束碼 1 結束。
- **回退**：舊映像不認得 `f2b8c4d1e7a9`，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade f2a7c1e9d4b3`（刪 `geo_kindergarten_fees` 與新欄位、`kindergarten_fees` 狀態列），再切舊映像。

**本校改址後**：不存家長座標，距離無法即時重算。校區地址在後台改過並發布後，已存的距離仍是以舊校址算的，要等下一次同步發現校址指紋變了才會重算（自動同步開著時最久約等一個 `WEBSITE_GEO_SYNC_CHECK_SECONDS`，預設一天），要立刻更新就手動跑一次 `geo-sync`（不必加 `--force`）。新校址比對不到門牌時，區域分析的距離分組會立刻全部歸「無距離」。

**上線前就存在的訪視**：這些訪視沒有 `recruitment_visit_geo` 列，`recruitment_visits.district` 也是空的。`district` 只在新建訪視、改地址、或重算時寫入，而重算只在 `geo-sync`（背景迴圈或 CLI）結束時觸發，沒有別的入口。在第一次同步之前，它們在區域分析歸「待比對」，**不會出現在行政區排行**。第一次同步時資料庫沒有 `campuses` 那一列指紋，程式視為「有變」，會重算所有未匿名化的訪視；不論是背景迴圈第一輪（api 啟動約 30 秒後）、不帶參數的 CLI、或檔案模式的 CLI 都一樣，下載失敗的那一輪也一樣，不需要 `--force`。所以啟用自動同步後第一輪結束，行政區排行就會含舊訪視；想在啟用前先補，就在 api 容器內跑一次 `geo-sync`（`! railway ssh --service api --environment production -- python -m app.cli geo-sync`）。若那時門牌還沒匯入成功，舊訪視先得到行政區與 `pending`，等門牌匯入完成（指紋含使用中門牌批次，會變）會自動再重算一次補上里與距離。已匿名化的舊訪視不補建。重算每 100 筆一個交易。

**回滾再上線**：回滾到舊版程式的期間，舊版改地址不會更新 `recruitment_visit_geo` 與 `district`，新建的訪視也沒有比對列，舊版的匿名化也不清比對列裡的里與距離。再上線時重算只在指紋（各校已發布校址＋使用中門牌批次）變了才觸發，回滾期間沒變就不會自動補。做法：

1. 在資料庫刪掉指紋列，下一次同步就會視為「有變」而重算：`delete from geo_dataset_status where dataset = 'campuses';`（只刪這一列，`doorplates`、`kindergartens`、`babycare`、`population` 等其他列不能動；先用 `select dataset, active_version from geo_dataset_status;` 確認）。
2. 立刻跑一次 `! railway ssh --service api --environment production -- python -m app.cli geo-sync`（不帶參數時門牌、各里人口未滿 30 天、幼兒園與托嬰未滿 7 天會跳過、不下載，只做重算）；自動同步開著的話等下一輪也行，最久約一個 `WEBSITE_GEO_SYNC_CHECK_SECONDS`。這會重算所有未匿名化訪視，回滾期間改過地址或新建的都補上。
3. **重算跳過已匿名化的訪視**，所以回滾期間被舊版匿名化的訪視，比對列的里與距離還在。區域分析的統計不受影響（已匿名化的不進里表與距離分布），但資料留著；用下面的 SQL 清掉（規則同 `retention.py` 的匿名化：里與距離清空、有行政區退到 `district`、沒有退到 `unlocated`，原因 `anonymized`）：

```sql
update recruitment_visit_geo g
   set village = null, distance_m = null,
       match_level = case when coalesce(v.district, '') <> '' then 'district' else 'unlocated' end,
       unlocated_reason = 'anonymized'
  from recruitment_visits v
 where v.id = g.visit_id and v.anonymized_at is not null
   and (g.village is not null or g.distance_m is not null);
```

**資料來源更新頻率**：高雄市資料平台每年一個新資料集（「高雄市115年門牌坐標資料-TWD97」）、每月一個新檔案（檔案網址的 guid 每月不同），所以網址不能寫死，程式每次找最新月份；年初新資料集還沒有資源時會退回前一年度。頁面格式改版時會失敗並保留舊版（`last_error`：「找不到高雄市門牌坐標資料的下載檔」）。kiang 的幼兒園與托嬰資料每日更新，官網每 7 天抓一次。里界檔隨程式提交、不同步，換版見 `backend/app/admissions/geo_data/README.md`。

**關閉**：把 `WEBSITE_GEO_AUTO_SYNC` 改回 `false`（或移除）並重新部署。已匯入的門牌與幼兒園、已寫好的比對結果都保留，不會刪除；要釋放空間得另外處理。

### 在籍學生匯入（2026-10-15）

清冊地址只在本機比對，正式站只收去識別 JSON（規格 `docs/specs/2026-10-15-admissions-enrolled-map-design.md`）。

1. 本機：照規格 §3.1 建比對庫（門牌版本要和正式站使用中的一樣；庫名要含 `test`），先 `cd backend`，再用下面這組環境變數跑（兩行都是一般的 shell 指令，不加 `!`；`WEBSITE_ENVIRONMENT=test` 時，兩個資料庫連線都要指向名稱含 `test` 的本機庫）：

   ```
   cd backend
   WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/<比對庫，名稱含 test> WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/<同一個庫> WEBSITE_SESSION_SECRET=<隨機字串，至少 16 字元> uv run python -m app.cli enrolled-match --roster <清冊 xls> --campus <key> --out <JSON>
   ```

   有點比例不到 90% 不會寫檔（結束碼 2，報告仍會印出；確認後才加 `--allow-low-hit`）。
2. `! railway volume -p <project> -e <env> files -v api-volume upload <JSON> /enrolled-<key>-<日期>.json`
3. `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli enrolled-import --file /data/enrolled-<key>-<日期>.json`
   （輸出「匯入 <key>：N 位（有點 M 位），清冊日期 …」；同一校整批取代。如果多印一行「注意：比對用的門牌版本…」，代表正式站的門牌已經換版：點的位置不受影響，只有里名可能和現行門牌不一致；要完全一致，就用新門牌重跑一次本機比對再匯入。）
4. 在自己的終端機或 Railway 網頁刪掉 volume 上的 JSON（agent 刪不了；檔內有取整座標）。

刪除整校（正式站）：`! railway ssh --project <project> --environment <env> --service api -- python -m app.cli enrolled-import --clear --campus <key>`。在本機跑只會清本機庫。migration `f2a7c1e9d4b3` 只新增兩張表，不需要備份。

### 歷年註冊匯入（2026-10-20，10-20 已部署，義華已匯入）

園方「目標執行統計表」xls 只在本機讀，正式站只收只有數字的 JSON（格式名 `ivy-enrollment-history/1`；規格 `docs/specs/2026-10-20-admissions-potential-share-design.md` §3.1）。**原始 xls 的第 9 列以後是寫著幼生姓名的備註：不進 repo、不上傳、不交給 subagent。** extract 只讀第 0 欄是「大班／中班／小班／幼幼班／總人數」的年級列，備註列不讀、不存、不印。migration 見上面「每年九月底人口與國小一年級人數」（`76c4bf84b907`，要先跑）。

1. 本機（一次）：`cd backend && uv sync --group extract`（xlrd 只在 `extract` 依賴群組，正式站映像不裝）。以下三條都在 `backend` 跑，是一般 shell 指令、不加 `!`、**不需要資料庫與環境變數**。
2. 先確認表頭都認得：`uv run python -m app.cli enrollment-history-extract --headers-only --file <xls>`（每張工作表印第 2、3 列的表頭文字與第 0 欄，非年級列的文字一律遮成「…」；義華真檔預期 33 張表 `99上`～`115上` 全部列出）。
3. 抽數字：`uv run python -m app.cli enrollment-history-extract --file <xls> --campus yihua --out <JSON>`（印「已寫出 <JSON>：132 列（99上～115上）」與每條「注意：…」警告。警告是表名加數字、照樣輸出，義華真檔有 3 條：`104下`、`105上`、`114下` 的「總人數」列既不等於年級加總、也不等於加上重讀保留生，不影響市佔率。輸出前先用匯入的驗證器驗過，所以寫得出來的檔一定收得下；`cat` 看一眼只有年級、數字與警告字串）。
4. `! railway volume -p <project> -e <env> files -v api-volume upload <JSON> /enrollment-history-<key>-<日期>.json`
5. `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli enrollment-history-import --file /data/enrollment-history-<key>-<日期>.json`（輸出「匯入 yihua：132 列（99上～115上）」再逐條「注意：…」；同一校整批取代、別校不動；多一個欄位或任何值不合就整份拒絕、舊資料不動，印「檔案格式不對，沒有匯入：…」並 exit 1）。
6. 在自己的終端機或 Railway 網頁刪掉 volume 上的 JSON（agent 刪不了）。

每學期園方更新表（9/15、3/15 之後）重跑 2–6 即可整批取代。其他校區有同格式的表時改 `--campus`。公開資料（九月底人口、國小）要先匯入，後台才算得出市佔率；歷年註冊先匯入而人口還沒有時，各學年的市佔率寫「—」。

### 招生潛力第二、三波：停辦回補檔換版與部署後檢查（2026-10-20，`feature/admissions-potential2-20261020`，尚未部署）

規格 `docs/specs/2026-10-20-admissions-potential-share-design.md` §11。**沒有 migration、沒有新環境變數、沒有新依賴**，所以部署本身沒有人工步驟，也不需要先備份（資料上只有背景同步會新增停辦園所列與停辦事件，不改、不刪既有列）。推 main＝部署，要使用者同意。

- **回補檔換版**：`backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`（47 筆）→ `kindergarten-closures-20261020.csv`（**94 筆**：停辦 62、改名 32，全部有離開日 `left_on`，最早 2022-09-20、最晚 2026-10-13；欄位多了名稱、核定、座標、類型）。舊檔 47 筆全保留、有日期的 29 筆日期不變，原本沒日期的 18 筆現在都有日期。舊檔已從 repo 移除。這份檔**同步每一輪都會讀，不要刪**；檔不在或格式不對時幼兒園整輪不換版、原因寫進 `last_error`。
- **事件保留期 24 → 72 個月**（`providers.EVENT_RETENTION_MONTHS`，幼兒園與托嬰共用），不然下一輪同步就會把 24 個月前的回補事件刪掉。畫面其他地方仍只看近 12 個月，不受影響。
- **部署後第一次幼兒園同步會補寫停辦事件**：每輪幼兒園同步成功後，把檔裡 `closed` 且有離開日的園所補寫成停辦事件；資料表沒有的園所先補一列 `is_active=false`（名稱、核定、座標、類型取自檔；`district`、`address` 是空字串）。已有任何 `closed` 事件的園所略過，營業中的園所不碰，重跑不重複。
  - 時機：幼兒園每 7 天看一次來源，部署後第一輪背景同步未必到期。要立刻補，用上面「立刻生效要手動 `geo-sync --force`」那段的做法與警語（`--force` 會同時略過殘缺檔檢查、重抓全部資料；不想全抓就用該段的檔案模式）。
  - 日誌（背景同步才印 INFO；Railway 日誌 auto 模式會擋，要使用者用 `!` 跑，指令同上面轉換輪那段）會多一個「回補檔補寫停辦事件 N」。N 看正式站當下的狀態，**依程式推算、沒有在正式站驗證**：10-15 轉換輪已經跑過（已替 16 筆有日期的停辦寫過事件）約 **46**；轉換輪還沒跑（這一輪同時處理 10-15 的 47 所舊筆）約 **29**，此時前面那一段「幼兒園資料已更新」的停辦事件會是 33、依回補檔下架 33、改名下架 14。N 不是驗收數字，驗收看下面的 SQL。
- **驗收 SQL**（Railway Postgres 的 Database 分頁）：
  - `select count(*), min(occurred_on), max(occurred_on) from geo_provider_events where provider = 'kindergarten' and change = 'closed' and occurred_on >= '2022-09-01';`：至少 **62**（回補檔的停辦全數），最早 **2022-09-20**；10-13 之後又離開名單的停辦用同步當天的日期，會多出幾筆。
  - `select count(*) from geo_kindergartens where not is_active and district = '';`：補進來的列（`district` 空字串），最多 62，約 29 上下。
  - `select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset = 'kindergartens';`：`synced_at` 是最近一次同步、`last_error` 空白。
- **後台檢查**（總管理者，義華）：招生統計 → 招生潛力與市佔率（`/admin/admissions-stats?sub=potential`）。
  1. 右邊那張卡「每年還能多招」有「約 N 位」「低～高 位」，下一行「目前空位 18 位」（核定 210 − 在籍 192）；三個來源都有數字時不寫「只含：…」。
  2. 三個來源表都是「有數字」：來源一約 **5～55 位**（本機驗證庫 5.3／19.0／55.3，那個庫沒有收費資料，價格係數全為 1，正式站有收費資料的園所會被打折，可能略低）；來源二、三本機沒有真資料可比，**第一次在正式站看**，量級對報告 B-11 的 1.2／5.2／11.3 與 B-06 的 1.0／1.6／2.5（來源三只算一年內交屋，應更小）。某個來源是「沒有資料」就看畫面上的原因（沒有在籍清冊、在籍人數太少、附近有孩子的里太少、算不出距離曲線、沒有預售資料）。
  3. 展開來源一「怎麼算」：參數照列，最下面「沒有收費資料 N 所」（本機 35 所）。裡面的停辦事件表是 **8 公里內、只含已結束學年窗口**（2022-10 到 2026-09）的事件，所以會比 3 公里的 11 所多（只載入回補檔的本機驗證庫，8 公里內到 2026-09 共 37 所，核定沒填的略過不列），而且**不含**進行中窗口的 2026-10-13 愛爾蘭。表裡的數量與合計核定不要拿去對 3 公里的數字。
  4. 走勢圖 x 軸下方有停辦三角形（懸停看園名與核定），只畫 **3 公里內、且落在圖上學年範圍內**的事件；停辦標在該停辦學年的**下一個**學年（童年綠地 2026-09 → 115 學年）。愛爾蘭（2026-10-13）標在 116 學年，不在圖上，所以圖上的三角形至少比 3 公里的 11 所少這一所。
  5. 3 公里內的停辦**用 SQL 驗**（Railway Postgres 的 Database 分頁；回補檔的停辦在義華 3 公里內、2022-10 起共 **11 所、核定合計 1,578 席**，含愛爾蘭；正式站會因為 10-13 之後才離開名單的園所多幾所，以此為準，不要數畫面）：

```sql
select count(*) as schools, sum(k.approved_capacity) as seats
from geo_provider_events e join geo_kindergartens k on k.source_id = e.source_id
where e.provider = 'kindergarten' and e.change = 'closed' and e.occurred_on >= '2022-10-01'
  and 2 * 6371008.8 * asin(sqrt(power(sin(radians(k.lat - 22.6424556) / 2), 2)
      + cos(radians(22.6424556)) * cos(radians(k.lat)) * power(sin(radians(k.lng - 120.3437133) / 2), 2))) <= 3000;
```

  6. 窄螢幕（≤720px）兩張卡上下排、來源表一個來源一張卡，沒有橫向捲動。
- **系統狀態**：幼兒園名單那一列的同步時間是最近一次、沒有錯誤。回補檔讀不了時整輪不換版，`last_error` 會寫「kindergarten-closures-20261020.csv 第 N 列不對」之類的原因。
- **回退**：沒有 migration，不需要 `alembic downgrade`，直接切回舊映像即可。舊映像的事件保留期是 24 個月，下一輪同步會刪掉 24 個月前的事件（2022～2024 年的回補事件）；再切回新映像後下一輪同步會補回來（補寫是冪等的）。這兩句是依程式推得，沒有實測。
- **重產回補檔**（通常不必：kiang 的名單歷史不會改，之後的停辦由同步當下偵測）：只有要把窗口往前推、或發現某筆日期掃錯時才重產。需要已登入的 `gh`，在 `backend/`：

```bash
uv run --frozen python scripts/build_kindergarten_closures.py --since 2022-08-31 \
    --merge app/admissions/geo_data/kindergarten-closures-20261020.csv \
    --out app/admissions/geo_data/kindergarten-closures-<新日期>.csv --cache /tmp/closures-cache
```

  `--merge` 以舊檔的 `left_on`、`reason`、名稱為準，`--cache` 讓重跑不重抓（請求數依窗口內的離開區間而定）。產出後改 `closure_backfill.BACKFILL_FILE` 與 `tests/test_geo_closure_backfill.py` 裡的檔名斷言、刪掉舊檔再提交。欄位與規則見 `backend/app/admissions/geo_data/README.md`「幼兒園停辦回補」。

## 素材背景轉檔上線步驟（2026-10-04，10-05 已部署 main `11ccc8e`，`feature/media-jobs-20261003`）

migration `e5b9c3a7d214`（接在參觀後追蹤的 `b8e3f1a6c4d7` 之後）只新增 `media_jobs` 表與 `media_variant_kind` 的 enum 值，不改既有資料。API 啟動時自動 upgrade。

部署前：

- 照慣例先備份正式 DB 與媒體 volume（或 S3 bucket），做法見下方「部署後（必做）」第 1 點，由使用者本人執行。
- 確認 `alembic heads` 仍只有一個；push 後確認 CI 的 HLG 整合測試是 pass 而不是 skip（本機 ffmpeg 沒有 zscale，只有 CI 會跑）。
- 轉檔與 API 在同一個容器。本機實測（Apple 8 核，轉檔限 2 執行緒）：25 秒 720p 影片桌機版 10.1 秒、峰值記憶體約 235 MB；合成 4K60 6 秒來源約 524 MB。HDR（zscale）本機量不到。正式站 api 容器的記憶體與 CPU 上限要本人在 Railway 看；2 vCPU 的話轉檔期間 API 只分到很少 CPU（已 nice 10）。不夠就升級方案或另開 worker 服務，後者是付費服務，需本人同意。

部署後（auto 模式會擋 `railway ssh`，以下請自己在終端機跑）：

1. `curl -s https://<正式網域>/api/website/v1/health | python3 -m json.tool`：`media_jobs.enabled` 為 `true`。
2. 查 `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`（SIGTERM 到 SIGKILL 的寬限秒數）：Railway api 服務 Variables，或 `railway variables --service api --environment production | grep DRAINING`。為 0 或很短時，部署碰上轉檔都算一次嘗試（最多 3 次）；抽 poster 的 ffmpeg 最多 30 秒不可中止，建議寬限不要低於 35 秒。
3. 查正式映像有沒有 HDR 需要的 `zscale`：`! railway ssh --service api --environment production -- sh -c 'ffmpeg -hide_banner -filters | grep -E " (zscale|tonemap) "'`。沒有 zscale 時 HDR 影片帶 tonemap 的轉檔會失敗並退回不轉色調，顏色偏灰，要另外決定是否換 ffmpeg 來源。
4. 後台上傳一支短影片：卡片先顯示「轉檔中」，幾十秒內變可用；同時在 Railway metrics 看 api 記憶體與 CPU 峰值，對照上面的本機數字。再用一支手機直拍影片確認方向，並用 iOS Safari 播放轉檔版本。
5. 既有影片補轉檔（**先備份媒體 volume 或 S3 bucket，並看 volume 剩餘空間**；每支影片多兩個衍生檔）：
   - `! railway ssh --service api --environment production -- python -m app.cli transcode-media-videos`（dry-run，確認清單）
   - `! railway ssh --service api --environment production -- python -m app.cli transcode-media-videos --apply`（排入，API 逐支轉；進度看素材庫或 health 的 `media_jobs`）
   - 已是可直接播的 H.264 且轉完不小於原檔 90% 的影片，會沿用原檔、不寫衍生檔。沒有 `--force`；之後改轉檔參數，要手動清 `media_jobs` 對應的 done 工作才會重列。
6. 既有圖片補中圖：`! railway ssh --service api --environment production -- python -m app.cli regenerate-media-variants`（dry-run）→ 加 `--apply`。因「缺中圖」會把每張圖的縮圖／中圖／大圖全部重產，**全站圖片網址會換一次，瀏覽器與 CDN 快取失效一次**，建議挑離峰時間；有 Cloudflare 之類的 CDN 可順便 purge `/api/website/v1/public/media/*`。
7. 部署紀錄補在下方：health 結果、draining 秒數、zscale 有無、記憶體峰值、回補的各項數量。

## 特色教學頁、關於常春藤頁開放後台編輯（`feature/page-cms-20261004`，10-05 已部署 main `11ccc8e`）

不需要 migration、不需要改環境變數。上線後**不必**跑 `initialize-content`：官網沒發布過這兩份內容（`curriculum_page`、`about_page`）時顯示內建內容，後台打開編輯頁會帶出同一份。若要跑，先加 `--dry-run`，確認清單只有 `curriculum_page`、`about_page` 再跑（指令由使用者用 `! railway ssh …` 執行）；它會連帶補建其他從未建立的項目。

（2026-10-08 註：業主 10-03 已裁定 1997，以下只在日後改年份時參考；llms.txt 的 1997 實際在 `web/app/utils/seo.ts` :294、:298。）若園方確認義華創校年份是 1998：在後台「關於常春藤頁」改沿革第一站的年份，並檢查首屏介紹與其他段落文字裡的「1997」一起改；`/about` 的搜尋標題、描述與首頁 JSON-LD 會跟著沿革年份。30 週年頁（`web/app/utils/anniversary/timeline.ts` 等）與 `llms.txt`（`web/app/utils/seo.ts` 約 :266）的 1997 不會跟著改，要另外請工程師改。

## 2026-10-04 參觀後追蹤：參觀案件與招生入學接成一條流程（main CI 部署）

使用者看過 PR #31 後要求合併進 main。`feature/admissions-follow-up-20261004` 合併前已同步 main 到 `bdab2ec`（`33fa709`，只有 README 頂部衝突），以 merge commit 併成 `bd22112`。規格 `docs/specs/2026-10-04-admissions-follow-up-design.md`，規則見 DESIGN.md「參觀後追蹤」，驗收 F01–F19 見 `docs/website-admin/acceptance.md`。

- **內容**：招生入學「待追蹤」分頁、記錄聯絡（新表 `recruitment_contact_logs`）、改期與追蹤負責人、歷程抽屜合併參觀前後紀錄、批次標記到場、預約明細「參觀後追蹤」、總覽待辦「參觀後該聯絡的家長」；轉移契約多一個延伸匯出檔（`contracts/ivy-recruitment/README.md`）。
- **migration `b8e3f1a6c4d7`**（接 `d2b7f4c9e1a3`）：`recruitment_visits` 加三個可空欄位與 CHECK `ck_recruitment_visits_follow_up_open`、新表與索引，只新增、不改寫資料，照 `deploy/CICD.md` 不需事先備份。這次 Actions log 看不到 api 容器輸出；`deploy/api-start.py` 是 `alembic upgrade head`（`check=True`）→ `check-schema.py` 比對 DB revision 必須等於映像的 head，不符就不啟動，api 部署 SUCCESS 且 smoke 打到 live API，等同正式庫已在 `b8e3f1a6c4d7`。
- **CI**：main run 37201630298（`bd22112`）E2E／Playwright、Backend／PostgreSQL／contracts、Frontend web／admin、Deploy Railway production 全部 success（2026-10-04 12:18–12:39 UTC；部署 12:36–12:39，api 12:37:27、web 12:39:25 SUCCESS，public smoke passed）。
- **正式 `release.json`**：base commit `bd22112`，created `2026-10-04T12:36:10Z`。
- **線上唯讀檢查**（12:5x UTC，未登入）：`/api/website/v1/health` 200；`/admin/admissions/options`、`/admin/admissions/follow-ups` **401**，對照 `/admin/admissions/nope-xyz`、`/admin/definitely-not-a-route-xyz` 404。招生路由只在 `WEBSITE_ADMISSIONS_ENABLED=true` 時掛上（`backend/app/main.py:217`），401＝路由已掛，**正式站開關實測是開的**；10-02 部署時同一端點是 404。repo 與 `deploy/`、`.github/` 都沒有設這個變數，是在 Railway 直接設的，本 repo 沒有開啟紀錄。
- **與上線前提不符**：`/privacy` 仍 404（隱私權政策尚未發布），追蹤規格附錄 A.5 的 ①（發布含招生用途與 730 天保存的政策）還沒做；保存政策「招生訪視」天數無法在未登入下確認。是否維持開啟、或先關掉補完 ①–③，由使用者決定；本次沒有改任何正式站設定。
- **未做**：正式站沒有登入看「待追蹤」分頁與總覽待辦；Safari／iOS 實機。

## 2026-10-04 官網預約成功只通知園方一則（main CI 部署）

使用者回報預約成功後校區 LINE 群組收到「新的參觀需求」與「參觀預約已確認」兩則，要求修正後 commit 並推上 main。`fix/booking-notify-once-20261004` 先 rebase 到 `59a06d8`（main 期間前進 3 個只動 web／文件的提交，只有 README 頂部衝突），再快轉推成 `bdab2ec`。這是 10-01 起待裁定的「送單兩則通知」，規則見 DESIGN.md 後台第七輪 UX 的待裁定項。

- **內容**：送單只排 `visit_request_created`，標題改「新的參觀預約」（後端 `_KIND_LABELS`、後台 `NOTIFICATION_KIND_LABELS`）；`visit_request_confirmed` 只留給園方確認補登。沒有 migration，API 只改一行 schema 說明。
- **CI**：main run 37200341757（`bdab2ec`）E2E、Backend／PostgreSQL／contracts、Frontend web／admin、Deploy Railway production 全部 success（2026-10-04 11:55–12:17 UTC）。
- **正式 `release.json`**：base commit `bdab2ec`，created `2026-10-04T12:13:52Z`。之後別的 session 合併 #31（`bd22112`，已含本提交）又觸發一次部署。
- **線上唯讀檢查**：正式後台 `/admin/assets/labels-*.js` 已是「新的參觀預約」。
- **未做**：正式站真實預約一筆看 LINE 群組實收（會發真實通知、寄家長信，留給使用者自己送測試預約確認）。

## 2026-10-04 預約頁背景大字不再被選校區蓋掉（main CI 部署）

使用者回報 `/visit` 背景大字「參觀」被切掉，要求修正後 commit 並推上 main。`fix/visit-ghost-fit-20261004` 先 rebase 到別的 session 剛推的部署紀錄 `8195372`（只有 README 頂部衝突，那筆只動文件），再快轉推成 `503ec36`。規則見 DESIGN.md「預約頁 UI／UX 優化（2026-10-02）」的迎賓區收短。

- **內容**：`.visit-ghost` 移進 `.visit-welcome`，改成 `container-type:size`，字級取 `min(原尺寸, 100cqh / 2.08)`。只改 CSS 與 DOM 位置，沒有 migration，也沒動 API。
- **CI**：main run 37199039953（`503ec36`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-04 11:31–11:46 UTC）。
- **正式 `release.json`**：base commit `503ec36`，created `2026-10-04T11:44:10Z`。
- **線上唯讀檢查**（Playwright，擋 telemetry）：在 12 種視窗量「參觀」的行框底與內容區上緣，涵蓋 1920×1080 到 320×568，含 720×450 橫拿手機。部署前正式站有 9 組被蓋 15–241px，部署後 12 組都是 0，也沒有水平溢出；1000×800 截圖兩行完整。
- **未做**：iOS Safari／Firefox 實機。

## 2026-10-04 30 週年改成正式分頁：主選單、頁尾、sitemap（main CI 部署）

使用者說「幫我做成一個分頁沒關係」、看過 PR #30 後要求合併到 main。PR #30（`feature/anniversary-nav-20261004`）以 rebase 合併成 `f935801`（main 沒有前進、沒有其他部署在跑）。規則見 DESIGN.md「30 週年分頁」。

- **內容**：fixture 主選單第五項「30 週年 / Anniversary」與頁尾連結（後台 `DEFAULT_PRIMARY_NAV`／`DEFAULT_FOOTER_LINKS` 同步）；`anniversarySeo`、sitemap、llms.txt，頁面改走 `usePageSeo`；telemetry `page` 與 `CTA_ENTRIES` 加 `anniversary`（後端、web、後台標籤，重產契約）；`studio.css` 1101–1180px 選單間距 32→20px。
- **沒有 migration**：telemetry 的 page、CTA entry 都是字串欄位。正式站後台沒存過主選單與頁尾連結（公開 API 的 `site_meta`、`site_footer` 都沒有這兩欄），官網讀 fixture，不必到後台改。
- **CI**：PR 全綠；main run 37197924853（`f935801`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-04 11:12–11:28 UTC）。
- **正式 `release.json`**：base commit `f935801`，created `2026-10-04T11:24:31Z`。
- **線上唯讀檢查**（Playwright，擋 `POST /api/telemetry`）：`/`、`/about`、`/anniversary` 頁首都是五項、第五項「30 週年→/anniversary」（在 /anniversary 有 `aria-current`）、頁尾有「30 週年」；`/anniversary` canonical 正確、robots 照全站設定為 noindex（`NUXT_PUBLIC_INDEXING_ENABLED=false`，sitemap 仍是空的，開放收錄後才會列）；頁首 1440／1280／1180／1126／1110／1101／1100／1000／901 都一列、預約鈕不超出、沒有橫向捲動；390 手機選單面板第 05 項「30 週年」；沒有 pageerror。
- **未做**：iOS Safari／Android 實機；後台成效頁要等有人瀏覽後才看得到「30 週年」這列。

## 2026-10-04 30 週年分頁 `/anniversary`（main CI 部署，不公開）

使用者轉達業主同意：先以不公開方式上線（noindex、不進主選單與 sitemap），30 週年校徽可以用在這頁。PR #29（`feature/anniversary-page-20261004`）rebase 到 main `d559cae`（重設密碼連結，另一個 session）之後以 rebase 方式合併成 `9068de8`；等 `d559cae` 那次部署跑完才合併，兩次部署沒有疊在一起。規則見 DESIGN.md「30 週年分頁」。

- **內容**：`pages/anniversary.vue`、`AnniversaryContent.vue`、`AnniversaryIntro.vue`、`utils/anniversary/*`、`assets/css/anniversary.css`；頁首 `PILL_PAGES` 加 `/anniversary`；素材 `web/public/assets/anniversary/*`（影片桌機 11.6MB、手機 6.0MB，其餘約 0.6MB，`scripts/build-anniversary-media.py` 產生）。
- **沒有 migration**：只動 `web/`、`scripts/` 與文件。
- **CI**：PR run 37168723849／37168721696（`16dd36a`）全綠；main run 37169637468（`9068de8`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-04 01:59–02:13 UTC）。
- **正式 `release.json`**：base commit `9068de8`，created `2026-10-04T02:10:22Z`。
- **線上唯讀檢查**（Playwright，擋 `POST /api/telemetry`）：1440×900 與 390×844 都是 200、標題「常春藤 30 週年｜1997—2027｜常春藤教育機構」、`robots: noindex, nofollow`；開場自動播放（桌機 `film-desktop`、手機 `film-mobile`），略過後飛進首屏海報；時間軸五張卡片都立起、終點校徽、拼圖、畫板可用；兩種寬度都沒有橫向捲動、沒有 pageerror 與失敗請求。影片 Range 206 `video/mp4`。預約按鈕顯示各校實際設定（義華「選擇參觀日期與場次」、崇德「線上預約即將開放」）。
- **未做**：iOS Safari／Android 實機；真人聽開場配樂。

## 2026-10-04 官網後台總管理者寄重設密碼連結（main CI 部署）

使用者要求合進本機 main 後自行 push。本機 main 先快轉到 origin/main `fb3757c`，再 `--no-ff` 合入 `feature/admin-password-reset-20261003`（`fe88466`）成 `d559cae`，推送 `fb3757c4..d559cae6`（快轉）。規則見 DESIGN.md「官網後台重設密碼連結」。

- **合併衝突**：只有 README 頂部（新段落在上，第八輪 UX 標題保留已部署版本）；`docs/website-admin/acceptance.md` 自動合併。合併結果與已驗證的 `fe88466` 只差 `fb3757c` 的三個文件檔，程式碼相同。
- **Migration**：`d2b7f4c9e1a3`（新表 `password_reset_tokens`，只新增表、不改既有資料），down_revision `4a7e2c9d1b63`；只新增表，部署前不需先備份正式 DB。第三波背景轉檔 `e5b9c3a7d214` 合併前要改接 `d2b7f4c9e1a3`（已通知該 session）。
- **本機驗證**（分支 `abd244d` 程式）：後端 pytest 全套 1363 passed；admin typecheck 0 錯、vitest 1054 passed（`admissionsRecords.test.ts` 2 項 5 秒逾時，單獨重跑 24 passed）；web typecheck 0 錯、753 passed；`contract:check` 一致；stack e2e 全套 69 passed（含新 `password-reset.spec.ts`）。
- **CI**：run 37168565117（`d559cae`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-04 01:37–01:57 UTC）。
- **正式 `release.json`**：base commit `d559cae`，created `2026-10-04T01:54:20Z`。
- **線上唯讀檢查**：`/`、`/about`、`/visit`、`/admin/`、`/admin/reset-password` 200；`POST /auth/password-reset/verify` 帶假 token 回 410 `RESET_LINK_INVALID`／`link_unknown`（路由在線、新表可查，migration 已跑）；`/auth/me` 與寄出端點未登入回 401；後台主程式有「設定新密碼」「密碼已更新，請用新密碼登入」，`UsersView` chunk 有「寄重設連結到」「尚未設定寄信，不能寄重設連結」「這個帳號已停用，不能寄重設連結」。
- **部署即生效的行為改變**（使用者 10-04 確認）：總管理者「直接設定新密碼」也會解除對方的密碼登入暫停。
- **未做**：正式站沒有設定 `WEBSITE_SMTP_*`，「寄重設連結」目前顯示為停用並附說明；設定後才會實際寄信（尚未實寄驗證）。沒登入看後台畫面；iOS Safari／Gmail／LINE 內建瀏覽器實機未驗證。

## 2026-10-04 官網後台成效統計補強＋第八輪 UX（main CI 部署）

使用者要求合併並部署。`feature/admin-analytics-phase1-20261003`（`937502c`）與 `feature/admin-ux8-20261003`（`eb1aeed`）依序合進 `merge/admin-wave1-20261004`；驗證期間 main 前進到 `e3a7600`（關於頁紀念章，另一個 session），再合 origin/main 成 `b4bb570`，快轉推上 main。

- **合併衝突**：`backend/app/operations/dashboard_service.py` 的 import 區（保留 `open_condition` 與 `User`，拿掉已無人使用的 `group_condition`）；README 與 `docs/website-admin/acceptance.md` 兩邊新增的段落都保留。`npm run contract:generate` 重產後沒有差異。
- **沒有 migration**：alembic head 仍是 `4a7e2c9d1b63`，不需要先備份正式 DB。
- **本機驗證**（`b312c43`，合 origin/main 之前；之後只多 web 與文件）：後端 pytest 1334 passed；admin typecheck 0 錯、vitest 84 檔 1038 passed、build 成功；web typecheck 0 錯、748 passed；`contract:check` 一致；stack e2e keyboard 10 passed、整套 67／68——失敗的 `media.spec` 是 main 既有的測試時序問題（e2e 庫 `home_about` 第 2 版的 `photo.media_id` 正確）。合 origin/main 後 web typecheck 0 錯 0 警告、753 passed。
- **CI**：run 37161427628（`b4bb570`）E2E、Frontend web／admin、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-03 23:19–23:40 UTC）。
- **正式 `release.json`**：base commit `b4bb570`，created `2026-10-03T23:37:05Z`。
- **線上唯讀檢查**：後台 lazy chunk 有新字樣——`AnalyticsView`「五校比較」「預約孩子的班別」「每日變化」「樣本較少」、`DashboardView`「我承辦的案件」「承辦人已停用」、`VisitDetailView`「最後處理」「這筆案件剛有更新」、`index`「登入帳號已改變」；三支新統計 API 與 `/auth/me` 未登入回 401（路由存在）；`/`、`/about`、`/visit`、`/admin/` 200。
- **未做**：正式站沒登入看後台畫面；Safari／iOS 實機。待使用者確認（都先照預設上線）：到場率分母、班別預設學年與是否含已取消、唯讀角色看「我承辦的案件」、停用帳號不清承辦人、到期前 15 分鐘提醒、家長端錯誤訊息改中文狀態名。已知限制（沒有未儲存修改的分頁，在別的分頁換成另一個帳號登入後會直接以那個帳號回到原頁）**已修（2026-10-12）**：被登出導來時先記住原本的帳號（auth store 的 `previousUserId`），登入頁的 `authGuard` 在 reason 為 `session-changed`／`other-user` 時用 `restoreSession({ expectUserId })` 先比對 `/auth/me`，不同人就不寫進 store、停在登入頁說明「這個瀏覽器已改用其他帳號登入」，同一人才恢復並導回原頁；沒有 `previousUserId`（書籤、重新整理）維持原行為。測試 `admin/src/__tests__/authGuardSwitchUser.test.ts`。

## 2026-10-04 關於頁第一章：紀念章取代「拉拉看」、正反交替（main CI 部署）

使用者要求上線 `feature/about-medal-20261003` 的兩個提交：`3c9e1fd`（章名旁紀念章跟著捲動翻面，取代拉紙條）與 `e3a76001`（正反交替，2001／2020 落在米白正面）。推送 `66a77a1c..e3a76001`（快轉）。規則見 DESIGN.md「關於頁第一章：紀念章取代『拉拉看』」。

- **內容**：新元件 `AboutMedal.vue`（CSS 3D，不載 three）；`about-popup.ts` 紙條段改成紀念章捲動（`medalSequence`／`medalTurn`／`medalFaces`／`medalShown`／`medalPinTop`），第一章外包 `.abk-track` 釘住；面圖 `web/public/assets/about-medal/{front,label,back}.webp` 共 63KB（`scripts/about-medal/build.py`）。義華創校 1997 為業主 10-03 裁定。
- **沒有 migration**：只動 `web/`、`scripts/` 與文件。
- **CI**：run 37160587018（`e3a76001`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-03 23:04–23:19 UTC）。
- **正式 `release.json`**：base commit `e3a76001`，created `2026-10-03T23:17:13Z`；health 200；三張面圖 200 `image/webp`。
- **本機驗證**（推送前，Node 22）：web typecheck 0 錯 0 警告、`test:website` 75 檔 753 項、`npm run build` 成功（postcss「Lexical error」警告是首頁 hero 既有的 `--motion-vh` 寫法，非本次）。
- **線上唯讀檢查**（Playwright，擋 `POST /api/telemetry`，唯一失敗請求就是它）：1440×900 釘住（pin top 52）、1440×780 往上推 8px 釘住、1366×650 不釘（經過時走完五站）、390×844 與 375×667 釘右頁；各捲動點紀念章步數與正反面、卡紙 `--up`、沿革上色一致，往回捲倒著翻；都沒有橫向捲動、沒有 pageerror。
- **未做**：iOS Safari／Android 實機（sticky 與網址列收合）；減少動態只在本機驗過。

## 2026-10-03 404 頁立體書校徽，連同上一批未部署的分支（main CI 部署）

使用者要求部署 `aa7b380`（feat(web): 404 頁加立體書校徽）。推送前查到 main `15fd9a5` 的 run 37088224504 是紅的：Frontend (admin) `ux20260928E`「刪除場景後選旁邊那一個」間歇失敗（找不到確認鈕：刪除），Deploy 被略過，正式站還停在 `899196b`。所以 `15fd9a5` 那一批（關於頁五校卡紙等大、拍立得捲動不再飄動、後台拿掉官網已沒有頁面顯示的編輯頁、CI 的 bcrypt rounds 4 與 paths-ignore）這次才第一次上線。推送 `15fd9a5..c8d2e33`。

- **404 立體書校徽**：`CrestPopup`（純 CSS 3D，不載 three），只有 404 放、503 不放；素材 `web/public/assets/crest-popup/*.webp` 五張共 54KB。
- **測試修正 `c8d2e33`**：popconfirm 由計時器延後打開，負載高時一輪 `flushPromises` 還沒渲染出確認鈕（本機加診斷證實：失敗當下 `.el-popconfirm` 為 0，200ms 後兩顆按鈕都在）；`confirmPop` 改用 `vi.waitFor`。修正前整檔 7 次失敗 3 次，修正後連跑 8 次全過。上一節記的「admin 957／958 間歇失敗」就是這一項。
- **沒有 migration**：`899196b..c8d2e33` 後端只動 `backend/tests/conftest.py`，不需要先備份正式 DB。
- **CI**：run 37130938511（`c8d2e33`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-03 14:48–15:05 UTC）；Backend job 12.5 分鐘（先前約 22 分）。
- **正式 `release.json`**：base commit `c8d2e33`，created `2026-10-03T15:01:29Z`。
- **本機驗證**（`c8d2e33`，Node 22）：admin typecheck 0 錯、946 passed；web typecheck 0 錯 0 警告、748 passed、`npm run build` 成功且 `.output/public/assets/crest-popup/` 五張都在。沒有重跑 stack e2e（CI 的 E2E job 有過）。
- **線上唯讀檢查**（Playwright，擋 telemetry）：不存在的網址回 404，桌機 1440 校徽 220px 在文字欄右側外、手機 390 132px 在 404 字樣上方，五張紙片都載入、`aria-hidden="true"`、兩種寬度都沒有橫向捲動；五張 webp 直接取 200 `image/webp`；`/`、`/about`、`/visit`、`/environment` 200；後台入口 bundle 沒有 `SharedFaqView`／`CampusFaqView`，`CampusTourView`、`PrivacyPolicyView` 仍在。
- **未做**：Safari／iOS 實機；正式站沒登入看後台畫面；滑鼠轉向與點擊闔上再打開沒有在正式站操作驗證（單元測試 `web/tests/crest-popup.spec.ts` 有涵蓋）。

## 2026-10-03 隱私權政策頁與一批已完成分支（main CI 部署）

使用者要求先把隱私權政策頁併入 main 部署，接著把「已完成的分支」一起併入部署。兩次推送：`60240c1`（隱私權政策頁，含同步 main 的「拿掉各校分校資訊頁」）與 `a749480`（下列分支）。`60240c1` 的 CI 在排隊時被 `a749480` 的 run 取代而取消，內容由 `a749480` 一起部署。

- **隱私權政策頁**：後端共用內容 `privacy_policy`（沒有 migration）、後台「全站與素材 → 隱私權政策」、官網 `/privacy`、頁尾連結取代個資使用說明按鈕、預約表單對話框加完整政策連結。**園方還沒發布，所以正式站 `/privacy` 目前是 404、頁尾沒有連結。**
- **一起併入的分支**：`feature/remove-map-hint-20261003`（首頁分校地址旁「地圖 ↗」字樣拿掉）、`feature/visit-no-party-size-20261003`（預約表單拿掉參觀人數與想先了解的事，得知管道改四選項；後端 `party_size` 維持選填、舊代碼照收）、`feature/website-admin` 上的 `4cb2835`（明華、崇德、仁武、國際校改用各自的 FB 粉專連結）、`feature/admin-ux-20261002` 的部署紀錄（純文件）。
- **刻意沒併**：`cb9bc89`（預約頁背景大字修正，寫在舊版面上，和 main 已重排的預約頁衝突）、`fix/visit-consent-blur-20260930`（同意勾選已拿掉）、舊的 deploy／wip／renovate／merge-attempt 分支。
- **衝突處理**：隱私頁併 main 時，`usePageSeo`、`sitemapXml`、`draft-preview.ts`、`preview.vue`、`sitemap.xml.get.ts` 對齊 main 新簽章（拿掉校區參數）；預約表單改版與政策入口並存（`VisitForm.vue` 拿掉「想先了解」區塊、保留政策入口）。隱私政策初稿同步改成「不再蒐集參觀人數與想了解的事、得知管道四選項」。沒有 migration。
- **CI**：run 37082027328（`a749480`）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（2026-10-03 00:32–01:00 UTC）。
- **正式 `release.json`**：base commit `a749480`，created `2026-10-03T00:57:08Z`。
- **本機驗證**（`a749480`，Node 22）：`contract:check` 一致；web／admin typecheck 0 錯、web 754 passed；後端相關 90 passed、先前隱私頁分支全套 1293 passed；`e2e:build` 成功、stack 整套 67 passed、`media.spec.ts` 間歇失敗單獨重跑通過。admin 單元 957／958：`ux20260928E`「刪除場景後選旁邊那一個」間歇失敗（找不到確認鈕：刪除，連跑兩次一次過一次失敗），隱私頁分支與前一次整合時也出現過，疑為時序不穩定，不是這批改動造成。
- **線上唯讀檢查**：health 200；`/privacy` 404；首頁頁尾沒有 `/privacy` 連結；`/visit` 200 且表單沒有「參觀人數」；`/campuses/yihua` 301（分校頁已拿掉）；後台 bundle 有 `PrivacyPolicyView`。
- **未做**：正式站沒登入看後台畫面；Safari／iOS 實機。
- **園方接下來**：後台補完隱私權政策的【待確認】（9 處標記、8 項事項）、填最後更新日期、發布；保存天數要在保存政策設定並開啟自動清理，政策文字才算與實際一致。

## 隱私權政策頁（`feature/privacy-policy-20261003`，已併入並部署，見上一節）

後台「全站與素材 → 隱私權政策」編輯，發布後官網多 `/privacy` 頁、頁尾多「隱私權政策」連結、預約表單的個資使用說明對話框多「完整隱私權政策」連結。**沒有 migration、沒有新環境變數、沒有新端點。**

- 部署後，政策在園方發布之前**官網沒有這一頁**（`/privacy` 回 404、頁尾與 sitemap 都沒有）。
- 園方上線步驟：後台打開「隱私權政策」會看到初稿 → 補完 9 處【待確認】（8 項事項：登記名稱、招生用途寫法、Turnstile 是否啟用、寄信服務商、主機地區、預約與招生訪視保存天數、聯絡 Email）→ 填最後更新日期 → 發布。含【待確認】或沒填日期時發布鈕會被擋。
- 政策第 7 段寫的保存天數要和實際設定一致：保存政策預設不自動清理，要在後台設天數、開啟自動清理，部署設定也要有 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true`。
- 本頁沒有 cookie 橫幅（2026-10-03 使用者裁定）。之後上線 GA4、廣告像素或第一方歸因 cookie 之前，要先改寫政策第 5 段並發布，同時改 `docs/website-admin/seo-performance.md:33` 的承諾。
- 上線後唯讀檢查：`/privacy` 發布前 404；發布後 200、頁尾有連結；`/sitemap.xml`（開放索引後）有 `/privacy`。

**本節尚未部署，部署後才補部署紀錄。**

## 2026-10-02 後台補登也拿掉同意勾選（main CI 部署）

使用者追加拿掉補登的「已向家長說明，並取得同意留存聯絡資料」，要求併入 main 並部署（PR #27，`feature/manual-no-consent-20261002`）。

- **合併**：GitHub merge commit `4f9ba57`。
  - 內容：`163113f` 補登拿掉同意勾選（後台、後端、契約、測試）；`4acbd50` 同步 main（後台第七輪 UX）；README 驗證紀錄。
  - 沒有 migration。
- **CI**：run 37029295379 的 Frontend web／admin、E2E、Backend／PostgreSQL／contracts（24 分鐘）、Deploy Railway production 全部 success（10-02 23:46 – 10-03 00:17 台灣時間）。
- **正式 `release.json`**：base commit `4f9ba57f54d1c281550fca088c8b7a60591c7425`，snapshot `121f938e9805bbfdf8525d16f304f0133db5515a3a14acf2144d848221d3827f`，created 10-03 00:11 台灣時間。
- **線上驗證**：補登要後台登入，所以只用 GET 抓正式站 `/admin/` 的 71 個 JS 檔比對：
  - 「並取得同意留存聯絡資料」「還沒勾選同意」「manual__consent」都是 0 檔。
  - 「補登不需勾選同意」「官網預約不需勾選同意」各 1 檔。
  - 補登對話框在 `ManualVisitDialog-B01mISEz.js`。
  - 沒有實際補登案件。

## 2026-10-02 官網後台第七輪 UI／UX（main CI 部署）

使用者要求「commit 並同步 main」後「push 上線」。分支 `feature/admin-ux-20261002` 的功能提交 `d237737`，合併 main 的 PR #25（拿掉同意勾選）。衝突在 `AdminSidebar.vue` 與 README，已解。之後再合兩次 main 的部署紀錄，最後 `dbf7b4f` 推上 main。這次沒有 migration：API 改了 dashboard 的 `awaiting_attendance`、audit-log 游標、通知加 `slot`、CSV 改中文欄名，契約已同步，部署前不需要備份正式庫。

- **推送前本機驗證**（Node 22）：
  - admin typecheck 通過，vitest 74 檔 952 項通過。
  - 後端全套 pytest 1270 passed，用獨立測試庫。
  - `npm run contract:check` 一致。
  - stack e2e 跑兩輪：第一輪 64 項通過，案件明細的視覺基準因為文案改動失敗（預期內），另一項是連帶失敗。重拍案件明細、五校介紹兩張基準（`022d52f`），重跑 visual 6 項通過。
- **CI**：run 37024872322，Backend／PostgreSQL／contracts、Frontend admin／web、E2E、Deploy Railway production 全部 success。
- **正式 `release.json`**：base commit `dbf7b4f`，created `2026-10-02T15:38:53Z`。
- **線上驗證**（唯讀）：API health 200。後台 lazy chunk 已有新文案：`DashboardView` 有「看今天的名單」「還沒標記到場」，`AuditView` 有「載入更早的紀錄」，`VisitDetailView` 有「家長到了嗎」。沒有用正式帳號登入操作。

## 2026-10-02 關於常春藤頁立體書精修＋第四章「家長怎麼說」（main CI 部署）

使用者要求「直接併入 main」。分支 `feature/about-refine-20261002` 從 origin/main `c01fb24` 開出，提交 `c893b4c` rebase 到 `ac79a03`（衝突只在 README.md，兩邊段落都保留）後推上 main。只動 `web/`（`AboutContent.vue`、`AboutWholePerson.vue`、`about.css`、`utils/about-popup.ts`、`tests/about.spec.ts`），沒有 migration、API 或 schema 變更，部署前不需要備份正式庫。

- **推送前本機驗證**（rebase 後，Node 22）：web typecheck 0 錯 0 WARN；`npm run test:website` 74 檔 743 項通過。rebase 前另在 dev server＋fixture 用 Playwright 驗 1440×900、390×844、減少動態，量 320／390／600／768／844×390／1280×720／1440×900 卡紙都在舞台內，axe（WCAG 2.1 AA）無違規。
- **CI**：`c893b4c` 的 run 37011280568 前端、E2E 都 success，Backend 跑到第 30 分鐘時被 PR #25（預約拿掉同意勾選）推上 main 觸發的新 run 取消（concurrency）。新 run 37015343286（`a2ed829`，已含 `c893b4c`，/about 相關檔案與 `c893b4c` 相同）Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（22:12–22:17 台灣時間部署）。
- **正式 `release.json`**：base commit `a2ed829`，created `2026-10-02T14:12:45Z`。
- **線上驗證**（Playwright，只放行 GET，統計回報 POST 一律擋下；唯一失敗的請求是被擋的 `POST /api/telemetry`）：

  | 項目 | 1440×900 | 390×844 |
  |---|---|---|
  | 四章翻開、卡紙站好、常春藤長好 | 通過 | 通過 |
  | 目次「一路走來 3／全人教育 5／我們的期許 7／家長怎麼說 9／五所校園 書籤」、頁碼 1–10 | 通過 | 通過 |
  | 紙槽示範拉到第 5 站、左頁沿革同步；鍵盤 Home → →→ 停在 2005 崇德校 | 通過 | 通過 |
  | 第四章點第二位：清單與大卡紙換成榕榕媽咪、後排小卡換成其他三位、影片在畫面內；按播放插入 `youtube-nocookie.com/embed/U5kRPt7By90` | 通過 | 通過 |
  | 水平溢出、console／page error | 無 | 無 |
  | axe（WCAG 2.1 AA，`#main`） | 無違規 | 無違規 |

- **注意**：axe 那兩次載入沒有擋統計回報，正式庫的瀏覽次數多記了 2 筆 /about（2026-10-02 約 22:30 台灣時間）。
- **未做**：iPhone Safari／Android 實機的 3D 翻頁；1280×720 首屏跨頁下緣約 68px 在視窗外（已記在 DESIGN.md）。

## 2026-10-02 官網預約拿掉同意勾選、手機場次卡一張一列（main CI 部署）

業主裁定拿掉同意勾選，使用者要求併入 main 並部署（PR #25，`feature/no-consent-20261002`）。

- **合併**：GitHub merge commit `a2ed829`。
  - 內容：`cc6233a` 拿掉同意勾選（官網、後端、後台、契約、測試）；`d2f0121` 同步 main。
  - 沒有 migration。
  - 這次部署也帶上了 `c893b4c`（關於頁立體書精修）。它自己的 run 37011280568 因 Backend job 超過 30 分鐘被取消、沒有部署。
- **CI**：run 37015343286 的 Frontend web／admin、E2E、Backend／PostgreSQL／contracts（24 分鐘）、Deploy Railway production 全部 success（10-02 21:47–22:16 台灣時間）。
- **正式 `release.json`**：base commit `a2ed829eb62be1d35dd4dd00e8e789d4bd4eb710`，snapshot `62143148d6d81ed24c5f4dab9aa2d36699629e187190cc261a619c8cbbd38cd4`，created 10-02 22:12 台灣時間。
- **線上驗證**：Playwright Chromium，1440×900 與 390×844。非 GET 一律擋下（只擋到 `POST /api/telemetry`），沒有送出預約。

  | 項目 | 結果 |
  |---|---|
  | `GET /public/booking-config/yihua` | 欄位只剩 campus_key、mode、version、line_url、phone、external_url、message、parent_email_enabled、privacy_notice、turnstile_site_key（沒有 consent_*） |
  | `/visit/yihua` 同意勾選框 | 0 個 |
  | 場次卡 | 390 寬一欄（350px）；1440 寬在月曆右側一欄 |
  | 送出列頂線 | 0px（只剩選填區底線） |
  | 「閱讀個資使用說明」 | 0 個（正式站沒有發布個資說明） |
  | 橫向溢出、pageerror | 兩種寬度都是 0 |

- **部署後待園方**：預約文案還沒有個資使用說明，表單與頁尾都沒有入口。補登仍要人員勾選「已向家長說明」，要不要一起拿掉待決定。

## 2026-10-02 預約頁 UI／UX 優化：日期月曆、確認預約摘要、選校卡標參觀方式（main CI 部署）

使用者要求把 PR #23（`feature/visit-ux-20261002`）併入 main 並部署。

- **合併**：GitHub merge commit `c01fb24`。
  - 內容：`a6753a2` 預約頁與管理頁改版；`0399fff` 同步 main（招生入學）；`ecd6080` 招生入學 stack 測試改用月曆；`8ab3a4b` README 驗證紀錄。
  - 只動 `web/` 與 stack 測試，沒有 migration、沒有後端程式改動。
- **CI**：run 37003438291 的 Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（10-02 19:52–20:45 台灣時間）。它排在前一次部署（37001162130）之後才開始。
- **正式 `release.json`**：base commit `c01fb24e0ef9186629edf300efe6afaa9d132141`，snapshot `e8f415915165bec7ac584d0a066374ec594f2c4e76758bdc82fc5c7be2cf8dbb`，created 10-02 20:42 台灣時間。
- **線上驗證**：Playwright Chromium，1440×900 與 390×844。非 GET 請求一律擋下（只擋到 `POST /api/telemetry`），沒有送出預約。

  | 項目 | 結果 |
  |---|---|
  | `/visit` 選校卡 | 義華「可線上預約」，其他四校「來電洽詢」；眉標「預約校園參觀」 |
  | `/visit` 第一屏 | 步驟列頂端 1440 寬 671px、390 寬 398px（部署前截圖量約 890px，正好在 1440×900 第一屏下緣） |
  | `/visit/yihua` 日期 | 月曆 20 個開放日，沒有 `select#visit-date`；選第一天出現 2 個場次 |
  | 送出列 | 「確認預約」，摘要「義華校 10 月 5 日（週一）・上午場 10:00–10:30」 |
  | Email 說明 | 「園所會用這個 Email 聯絡你；修改連結會顯示在預約完成頁。」（正式站 `parent_email_enabled` 為 false） |
  | `/visit/minghua` | 步驟第二格「參觀方式」 |
  | 橫向溢出、pageerror | 兩種寬度都是 0 |

- **未在線上驗證**：`/visit/manage` 改場次要真的預約連結，只在本機假 API 與 stack e2e 驗過。
- **部署後待園方**：後台「預約文案」的同意文字仍寫「送出需求後，仍須由園方確認參觀時間」，和自選場次矛盾，要發布新版。

## 2026-10-02 手機版第三輪優化：分校線稿墨線版、首頁 CLS、關於頁卡紙（main CI 部署）

使用者要求把 PR #20（`feature/mobile-ux-20261002`）併入 main 並部署。

- **合併**：GitHub merge commit `f520031`。內容：
  - `622d192`：五校線稿小圖改透明底墨線版。
  - `f75bfd7`：手機版第三輪審查修正。
  - `31e4482`：同步 main（#19 SEO）。
  - 沒有 migration、沒有後端程式改動。
- **CI**：run 36998071531 的 Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（10-02 18:54–19:18 台灣時間）。
- **正式 `release.json`**：base commit `f520031099017c92782fe0fe59b46371e9d016ae`，snapshot `e7fa236a438a7e0a43382f1b646ec5c8a81346f62b799bb22a6dd190f3dab1e2`，created 10-02 19:15 台灣時間。
- **線上驗證**：Playwright Chromium，非 GET 請求一律擋下（只擋到 `POST /api/telemetry`）。

  | 項目 | 結果 |
  |---|---|
  | 首頁分校分頁線稿 | 五張都是 `-ink` 墨線版（390 寬 240w、1440 寬 160w），`mix-blend-mode:normal`、無 filter |
  | 環境頁五校分頁 | 五張都是 `-ink`，無混合模式 |
  | 首頁捲完 CLS | 390 寬 0.0014、1440 寬 0.0005（部署前 390 寬實測 0.29，全來自拍立得畫布） |
  | 關於頁卡紙與舞台 | 844×390、768×1024 卡紙頂端都在舞台內（距離 13–22px），390 與 1440 跟部署前相同 |
  | 「拉拉看」紙條字色 | `rgb(17, 42, 33)`（`--ink`） |
  | `/news` 麵包屑「首頁」 | 透明偽元素左右各補 8px（28→44） |
  | 12 頁 × 390／1440 | 全部 200，沒有水平溢出、沒有 pageerror |

- **之後的部署**：部署完成前，另一個 session 已把招生入學併入 main（`71820a4`），並同步了本次修正（`2eafc1b`）。那次 CI（run 36999602663）會再部署一次，招生入學的說明見下節；本次改動的檔案在 `2eafc1b` 與 `f520031` 相同。
- **未驗證**：iPhone Safari 實機的方塊底，本機只有 Chromium。

## 招生入學（2026-10-02 已部署 `2eafc1b`，後續修正隨 `a2ed829` 上線；原規劃開關關閉，10-04 實測正式站已開，見頂部紀錄）

`feature/admissions-20261001`：後台「招生入學」，階段 A（後端與轉移契約）、B（後台畫面）、C（統計、五校比較、stack e2e）。2026-10-02 使用者要求併入 main 並部署（合併提交 `71820a4`，同步 main 後 `2eafc1b`）；正式站**開關仍關閉**。規格 `docs/specs/2026-09-30-website-admissions-design.md`。

- **開關** `WEBSITE_ADMISSIONS_ENABLED`（api，預設 `false`）。關閉時：後台側欄與側欄搜尋不列「招生入學」（`/auth/me` 的 `features.admissions`）；`/api/website/v1/admin/admissions/*`（含 `stats`、`compare`、`no-deposit-records`）不掛路由、一律 404，後台「招生入學」頁顯示「招生入學尚未啟用」；預約「標記已到場」照常，但不建招生訪視；保存政策的招生類別照常顯示（沒資料就是 0 筆）。
- **規格 §15 Q1 裁定前不可在正式站開啟**：預約同意書是否涵蓋參觀後的招生聯繫與紀錄、招生訪視保存幾天。同意文字建議跟家長自選場次改版的同意文字同一次改。
- **開啟方式**：Q1 裁定、同意文字改版發布後，先在保存政策設好招生訪視天數（預設空白＝不自動清理，業主裁定天數後由總管理者設定），再到 Railway api 服務 Variables 設 `WEBSITE_ADMISSIONS_ENABLED=true` 並重新部署 api（設定在啟動時讀、路由在建立 app 時決定，只改變數不重啟不會生效）。
  - 2026-10-04 起官網預約已不勾選同意，Q1 改由隱私權政策告知。擬稿與順序見 `docs/specs/2026-10-04-admissions-follow-up-design.md` 附錄 A：① 後台「隱私權政策」換上附錄 A.2 的三處、補完其他【待確認】後發布；② （選做）預約文案的個資使用說明加一段；③ 保存政策「招生訪視」設 730 天（建議值）；④ 才打開開關。
- **參觀後追蹤（`feature/admissions-follow-up-20261004`，10-04 隨 main `bd22112` 部署，見頂部紀錄）**：migration `b8e3f1a6c4d7`（接 `d2b7f4c9e1a3`）只在 `recruitment_visits` 加三個可空欄位與一個 CHECK、新增 `recruitment_contact_logs`，不改寫既有資料，可隨程式上線；開關關著時一樣不會有資料。開啟後已到場的新案件只帶負責人，不自動排聯絡。
- **舊的已到場預約不會自動補建**：開啟後，關閉期間（或本功能上線前）已到場的預約會列在後台「招生入學 → 官網預約」下方「已到場但沒有招生訪視」，逐筆按「建立招生訪視」。
- **權限不用改帳號**：新增 `admissions.read／write／convert`，預設總管理者、分校管理者全有，接待人員有 read／write（規格 Q2 未回覆照預設）；內容編輯、唯讀沒有。
- **Migration `4a7e2c9d1b63`**（`backend/migrations/versions/4a7e2c9d1b63_admissions.py`，接在 `c7d2e9f4a1b8`〔家長自選場次〕之後）：新建 `recruitment_visits`、`recruitment_event_log`、`grade_intake_targets` 三張表，`retention_policies` 加可為 NULL 的 `admissions_days` 與 CHECK；不改寫既有資料，可以安全隨程式上線（API 啟動時自動 upgrade），開關關著時三張表維持空的。和家長自選場次一起上線時，那一支改寫資料的 migration 仍要先備份。合併前 rebase 到 main、重跑 `npm run contract:generate`，並用 `alembic heads` 確認只有一個 head。
- 端到端測試（`tests/stack/start-api.sh`）設 `WEBSITE_ADMISSIONS_ENABLED=true`；pytest 的測試設定（`backend/tests/conftest.py`）也預設開啟。

上線後唯讀檢查：
- `/api/website/v1/health` 200。
- 開關關著時，`/admin/admissions/*` 一律 404、後台頁面顯示尚未啟用。
- 開關開啟後，總管理者開 `/admin/admissions?tab=stats`，沒有資料時寫原因、不報錯。
- `GET /api/website/v1/admin/admissions/compare?school_year=115`（換成當時的學年；不帶 `semester`＝件數算整學年、名額剩餘用上學期，回應 `seat_semester: 1`）回物件，`rows` 有五列。

### 2026-10-02 部署紀錄（main `2eafc1b`）

- **合併**：整合分支 `merge/admissions-20261002` 從 origin/main `6270d3c` 開出，`--no-ff` 併入招生分支（`71820a4`，衝突只在 README.md、deploy/README.md 兩份文件，兩邊段落都保留）；推送前 main 被推進到 `f520031`（手機版第三輪修正、五校線稿、預約測試星期），再同步一次（`2eafc1b`，衝突只在 README.md）。alembic 單一 head `4a7e2c9d1b63`。
- **推送前本機驗證**（`2eafc1b`，Node 22）：`contract:check` 一致；web typecheck 0 錯 0 WARN、web vitest 720 passed；後端 `test_booking_consent_readiness.py`＋`test_admissions_stats.py` 46 passed（`71820a4` 時另跑招生全部測試檔＋預約 196 passed）；`e2e:build` 成功、stack e2e 整套 68 passed。admin 在合併中沒有變動，沿用招生分支 886 passed。
- **CI**：run 36999602663 的 Backend／PostgreSQL／contracts、E2E／Playwright、Frontend web／admin、Deploy Railway production 全部 success（2026-10-02 19:11–19:47 台灣時間；Backend 19:18–19:42）。
- **正式 `release.json`**：base commit `2eafc1b`，created `2026-10-02T11:43:34Z`。
- **migration**：api 部署 log「Running upgrade c7d2e9f4a1b8 -> 4a7e2c9d1b63」、「Database schema ready: 4a7e2c9d1b63」。只新增表與欄位，照 `deploy/CICD.md` 不需事先備份。
- **線上唯讀檢查**：`/api/website/v1/health` 200；`/api/website/v1/admin/admissions/options` 404（開關關閉、路由未掛）、`/api/website/v1/admin/visit-requests` 401（對照：路由有掛）；後台 bundle 有 `AdmissionsView` chunk。
- **未做**：正式站沒有登入看畫面（開關關閉時頁面只會顯示尚未啟用）；Safari／iOS 實機。
- **之後的修正**：`feature/admissions-followups-20261002`（頁首學年 +3…−2、統計子分頁 `sub` 進網址、390px 名額欄寬、開關關閉時側欄不顯示招生入學、五校比較件數跟頁首學期）隨 `a2ed829` 上線，紀錄見下一段。

### 2026-10-02 後續修正部署紀錄（推送 `ac79a03`，隨 main `a2ed829` 部署）

使用者裁定 1A–5A 並要求做完一起推 main。
- **內容**：`e572fb3`（頁首學年選項 +3…−2；統計子分頁寫進網址 `sub`，未預繳名單「查看」後上一頁回到名單）、`7053d5f`（390px 名額規劃「計畫名額」欄 min-width 152，不再截出省略號）、`b246839`（`/auth/me` 與登入回應帶 `features.admissions`，開關關閉時側欄與側欄搜尋不列「招生入學」，直接開網址仍到「尚未啟用」頁）、`978004f`（`/compare` 的 `semester` 選填：不帶時件數算整學年、名額剩餘用上學期，回應多 `seat_semester`；說明句依回應組）、`3c76cee`（README）。沒有 migration。
- **推送前本機驗證**：`3c76cee` 時 `contract:check` 一致、admin typecheck 0、admin vitest 69 檔／897 passed、admin build 成功、後端 `test_admissions_*.py`＋`test_auth*.py`＋`test_permission*.py` 193 passed；同步 main `c01fb24`（預約頁 UI／UX）後 `adad9cd`：web typecheck 0 錯 0 WARN、web vitest 732 passed、`e2e:build` 成功、stack e2e 整套 68 passed（`E2E_DB_NAME=ivy_website_e2e_test_admfollow`、埠 8741／3741，因 8731 被另一個 session 占用）。再同步只改 `deploy/README.md` 的 `182ee2e` 後推 `ac79a03`。
- **CI**：`ac79a03` 的 run 37009424665 排隊時被後到的 run 取代（main 不取消進行中、只保留最新排隊）；`c893b4c`（另一個 session，含 `ac79a03`）的 run 37011280568 Backend 在「Install uv and media test dependency」異常花 13.8 分、pytest 23 分，撞 `timeout-minutes: 30` 被取消（pytest 62% 時零失敗），Deploy 略過；`a2ed829`（含 `ac79a03`）的 run 37015343286 全部 success（Backend 13:47–14:12 UTC，Deploy 14:12–14:16 UTC）。
- **正式 `release.json`**：base commit `a2ed829`，created `2026-10-02T14:12:45Z`。
- **線上唯讀檢查**：health 200；`/api/website/v1/admin/admissions/compare?school_year=115` 404（開關關閉）；後台 bundle：`AdmissionsView` chunk 有「同名額規劃」、`seat_semester`、`[3,2,1,0,-1,-2]`、計畫名額欄 `152`、`nodeposit` 子分頁網址；`auth` chunk 有 `features`。
- **未做**：正式站沒登入看側欄（要帳號；以 bundle 確認）；開關開啟後的 `/compare` 實際回應。
- **提醒**：後端 pytest 在 CI 約 23 分，`timeout-minutes: 30` 只剩約 7 分餘裕，安裝步驟一慢就逾時；可考慮放寬到 45 或拆分。

## 2026-10-01 品質檢查後續：書籤對比、點擊範圍、後台確認率與流量說明（main CI 部署）

使用者要求把 `fix/report-followups-20261001` 併入 main 並部署。分支從 `origin/main` `b216133` 開出，所以這次是 fast-forward 推上 main。

- **提交**：`c5aaf04`（兩份報告與截圖）、`d97fe9a`（唯讀檢查腳本）、`2dea316`（web：書籤字色、點擊範圍）、`1ea1ce8`（admin：確認率、流量說明）、`6b76f11`（README／DESIGN 紀錄）。沒有 migration，也沒有 API 或 schema 變更，所以部署前不需要備份正式庫。
- **CI**：run 36866196528 的 Frontend web／admin、E2E、Backend／PostgreSQL／contracts、Deploy Railway production 全部 success（10-01 21:05–21:29 台灣時間）。
- **正式 `release.json`**：base commit `6b76f112adfbbf748874a9979db8b6273879eeaf`，snapshot `e4d4324181107dc9b04ad2c8c537db541d35fde410c1dc743a13c8f4e5f1e8a8`，created 10-01 21:25 台灣時間。
- **線上驗證**：所有檢查都只發 GET，非 GET 請求一律擋下。

  | 項目 | 結果 |
  |---|---|
  | `/about` 五校書籤對比（390、1440 寬） | 仁武 5.22:1，其餘 ≥10:1 |
  | 校區連結可點範圍 | 70×44 |
  | `/visit` 與 `/campuses/yihua` 麵包屑「首頁」可點範圍 | 44×44（桌機 44×48），「五所校園」點擊不受影響 |
  | 後台 `AnalyticsView` chunk | 有「不計確認率」與「2026/09/30 起也計入」，沒有舊的「還沒有計入」 |
  | `scripts/audit-public-site.mjs routes` | 36 組 HTTP 200，沒有溢出、破圖或 pageerror |

- **本機驗證**（Node 22.23.2）：

  | 項目 | 結果 |
  |---|---|
  | web typecheck | 通過 |
  | web vitest | 69 檔 689 項通過 |
  | admin typecheck | 通過 |
  | admin vitest | 54 檔 700 項通過 |
  | admin build | 成功 |

- **未做**：stack e2e 沒在本機跑。它的視覺基準只涵蓋後台的案件明細、預約方式、五校介紹、使用者、登入頁，而且 e2e 沒有碰到分析頁、關於頁或麵包屑；CI 的 E2E 是通過的。後台分析頁要登入才能看，所以線上只核對了 bundle 內容，沒有登入看畫面。Safari／iOS 實機也沒驗。

## 2026-10-01 全人教育 A2 六圈、移除操作鈕（web-only，已部署）

使用者定案採用 A2，保留全人教育左頁原樣，並要求移除「再看一次」按鈕及部署。右頁由紙轉盤換成六張透明圓片；進場播放一次，完成停住，沒有下方控制鈕。

- 僅部署 web：`f24d6e9b-cf09-4e5c-9fd6-7e4ecd88fe69`，Railway `SUCCESS`（2026-10-01 10:41 台灣時間）。
- 正式 `release.json` 已核對：snapshot `6100d899f5c94f68a6cdf12a26f486c349c599b18a0024259c67ed4b62eee40a`；base commit `392a41c6f52b1d12cd9a692e56e89e54d4df9dc4`。
- 基底從該 commit 重建，hash 與當時正式快照 `ed106ef4566b8b595bbb1847c48eeb73b5c9f59d0cf40d6d732eafcbdcadb9b0` 完全相同。只疊入 AboutContent／AboutWholePerson、about.css／tokens.css、about-popup.ts／about.spec.ts 六個檔案。
- API 維持 `544f5966-244f-43df-b87f-e2fd6042b86b`；Postgres 維持 `be22e502-02ad-41b3-8559-0ce90ae03043`。沒有 API 部署、migration、CMS 寫入或其他設定異動。
- 本機 Node 22：typecheck、65 檔 665 項單元測試、production build 全部通過。五種寬度左頁 DOM／尺寸／位置比對一致；無 JS、減少動態、離屏暫停與恢復通過。
- 線上 Playwright 1440／390px：左頁 DOM／元素尺寸／相對位置與部署前一致，右頁無按鈕、無橫向溢出、無 page error；一般動態播放一次後停止。公開唯讀 smoke：release、production/live API、CMS、首頁、about、五校頁及 admin 登入入口全部通過。
- 原始碼快照 `/private/tmp/ivy-website-whole-person-a2-release-20261001`；證據在工作目錄的 `output/railway-whole-person-a2-20261001/`；工作目錄 `/private/tmp/ivy-website-whole-person-a2-20261001`。Safari／iOS 實機未驗。
- **Git 狀態**：部署當時以核准的限定快照直接部署 web，尚未 commit／push／合併；`origin/main` 為 `392a41c`。本次依使用者要求將已上線的六檔差異與紀錄提交，供 main 整合；Git 同步與正式部署為不同步驟。可復原 patch 與交接：Desktop 工作區的 `design/whole-person-circles-20261001/integration-a2.patch`、`integration-a2.md`。

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
| api | `WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS`（選填，production 預設 60；0＝關閉 api 內建定期工作） |
| api | `WEBSITE_LINE_MESSAGING_CHANNEL_SECRET`、`WEBSITE_LINE_MESSAGING_ACCESS_TOKEN`（選填，兩個一起設才啟用 LINE 群組推播，見下方） |
| api | `WEBSITE_MEDIA_STORAGE`（`local`｜`s3`，預設 local）與 `WEBSITE_S3_*`（選填，見下方「素材改存 S3」） |
| web | `NUXT_TRUSTED_PROXY_HOPS`（選填，預設 1；訪客與 web 之間的可信代理層數，見下方） |
| api | `WEBSITE_SMTP_HOST`／`WEBSITE_SMTP_PORT`／`WEBSITE_SMTP_SECURITY`（`starttls`｜`ssl`，production 不允許 `none`）／`WEBSITE_SMTP_USERNAME`／`WEBSITE_SMTP_PASSWORD`／`WEBSITE_SMTP_FROM`（選填，設 HOST 就必填 FROM；不設定就只寫本機 sink 檔＋站內通知） |
| api | `WEBSITE_GOOGLE_CLIENT_ID`／`WEBSITE_GOOGLE_CLIENT_SECRET`／`WEBSITE_GOOGLE_REDIRECT_URI`（選填，三項都留空就不顯示 Google 登入入口；redirect_uri 需與 `WEBSITE_ADMIN_ORIGIN` 同源） |
| api | `WEBSITE_LINE_CHANNEL_ID`／`WEBSITE_LINE_CHANNEL_SECRET`／`WEBSITE_LINE_REDIRECT_URI`（選填，員工「用 LINE 登入」，與上面的 LINE Messaging API 群組推播是不同的 LINE channel） |
| api | `WEBSITE_RETENTION_ALLOW_REAL_RUN`（選填，預設 false；同時控制手動個資清理與定期工作的自動清理，兩邊都要靠這個開關） |
| api | `WEBSITE_ADMISSIONS_ENABLED`（選填，預設 false；招生入學模組開關，規格 §15 Q1 裁定前不可開，見上方「招生入學（未部署）」） |
| api | `WEBSITE_GEO_AUTO_SYNC`（預設 false）／`WEBSITE_GEO_DOORPLATE_URL`／`WEBSITE_GEO_KINDERGARTENS_URL`／`WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`／`WEBSITE_GEO_BABYCARE_URL`／`WEBSITE_GEO_SYNC_CHECK_SECONDS`（86400）（皆選填；招生區域分析的公開門牌、幼兒園與托嬰資料同步，開之前先看上方「公開地理資料同步（招生區域分析）」） |
| api | `WEBSITE_MEDIA_MAX_IMAGE_MB`（預設 15）／`WEBSITE_MEDIA_MAX_VIDEO_MB`（預設 150）／`WEBSITE_MEDIA_PURGE_DELAY_DAYS`（預設 7，待清理素材保留幾天才真的刪檔） |
| web | `NUXT_MEDIA_MAX_UPLOAD_MB`（選填，預設 150；請設成上面兩個 MEDIA_MAX 較大的值，否則後台大檔上傳會先被 web 代理擋掉） |
| api | 2026-09-29 起 production 啟動硬性檢查：`WEBSITE_ENVIRONMENT` 必須有值；`WEBSITE_ADMIN_ORIGIN` 必須是不含路徑的 `https://` 網址；`WEBSITE_SESSION_SECRET` 不得含 `change-me`／`changeme`／`change_me`／`example`／`placeholder`。任一不符 API 拒絕啟動，見下方「2026-09-29 資安稽核修正」 |
| api | `WEBSITE_MIGRATION_DATABASE_URL`（選填；schema owner 連線，只給 alembic 與啟動時的 schema 核對用，設定後 `WEBSITE_DATABASE_URL` 可改成只有 DML 權限的角色） |
| api | `WEBSITE_DB_POOL_SIZE`（10）／`WEBSITE_DB_MAX_OVERFLOW`（10）／`WEBSITE_DB_POOL_TIMEOUT_SECONDS`（10）／`WEBSITE_DB_LOCK_TIMEOUT_MS`（10000）／`WEBSITE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`（300000，0＝不設）（皆選填） |
| api | `WEBSITE_TURNSTILE_SITE_KEY`／`WEBSITE_TURNSTILE_SECRET_KEY`（選填，兩個一起設才啟用公開預約的 Cloudflare Turnstile；site key 經公開預約設定 API 給官網，web 不必另設） |
| api | `WEBSITE_SESSION_IDLE_MINUTES`（120）、`WEBSITE_BOOKING_SLOT_HOLDS_PER_SOURCE_PER_DAY`（5）、`WEBSITE_BOOKING_SUBMISSIONS_PER_CAMPUS_PER_HOUR`（30）、`WEBSITE_TELEMETRY_GLOBAL_PER_MINUTE`（600）／`_DAILY_CAP`（20000）、`WEBSITE_ANALYTICS_CLICKS_GLOBAL_PER_MINUTE`（120）／`_DAILY_CAP`（5000）（皆選填） |

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
  （2026-09-29 起改為：同帳號 5 分鐘錯 10 次就在驗密碼之前鎖住該帳號的密碼登入
  15 分鐘，正確密碼也擋，Google／LINE 登入不受影響，見上方「2026-09-29 資安稽核修正」。）

2026-09-24 起限流計數存在 PostgreSQL 的 `rate_limit_counters`（migration
`7f0680b2eb47`），不再放在各 process 記憶體：多個 uvicorn worker 或 api 副本共用
同一組上限，重新部署也不會歸零。key（手機、email、訪客 IP）以
`WEBSITE_SESSION_SECRET` 做 HMAC 後才存，不留明文；換 session secret 等於
所有限流計數歸零。過期的列由 api 內建背景工作清除（見下一節）。

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

**2026-09-24 起 api 自己定期跑這些工作**（`app/workers/maintenance.py`，production
預設每 60 秒一輪），不需要 Railway cron：repo 與部署設定裡從來沒有呼叫這個指令
的排程，排程發布與通知在正式站上其實都沒有動過。部署後確認
`/api/website/v1/health` 的 `background_jobs.enabled` 為 true、`last_completed_at`
有在更新。要關掉時設 `WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS=0`。若 Railway
後台另外設過 cron 也無妨：同一時間只會有一輪（advisory lock），後到者跳過。
上線後第一輪會把累積在 outbox 的舊訊息處理掉：一律寫站內通知，但超過 24 小時的舊訊息
不寄信（`EXTERNAL_DELIVERY_STALE_AFTER`），不會一次把幾天前的通知寄給所有人。

### LINE 群組推播（2026-09-24）

參觀案件通知可以推到各校員工的 LINE 群組（LINE Notify 已停止服務，改用官方帳號
的 Messaging API）。migration `9b2b0ebc14ae` 新增 `line_groups`、`line_campus_targets`。
啟用步驟（全部在 LINE 與 Railway 後台操作，程式不會自己建任何東西）：

1. LINE Developers → 官方帳號的 Messaging API channel：取得 **Channel secret** 與
   **Channel access token（long-lived）**，存進 Railway api 的
   `WEBSITE_LINE_MESSAGING_CHANNEL_SECRET`、`WEBSITE_LINE_MESSAGING_ACCESS_TOKEN`。
   這是 Messaging API channel，與「用 LINE 登入」的 LINE Login channel 不同。
2. Webhook URL 設為 `https://<官網網域>/api/website/v1/line/webhook`（後台「LINE 通知」頁
   也會顯示），開啟 Use webhook。webhook 驗 `X-Line-Signature`，簽章不符一律 401。
3. LINE Official Account Manager：允許加入群組，關閉自動回應。
4. 把官方帳號拉進各校員工群組。
5. 後台「系統 → LINE 通知」按「產生驗證碼」，把驗證碼貼到要綁定的群組（10 分鐘內有效、
   只能用一次），回後台按「重新整理」，群組顯示「已驗證」後再替該校選群組 → 送測試訊息。
   2026-09-29 起未驗證的群組不能被選為新的推播目標（任何人都能把官方帳號拉進自己取名的
   群組）；修補前已綁定的群組照常推播，但建議找時間也貼一次驗證碼。

群組訊息只有通知類型、校區、案件編號與後台連結，不含家長或孩子資料。推播會用掉官方
帳號的每月訊息則數；每則通知每個群組只推一次（`X-Line-Retry-Key` 與
`notification_deliveries` 去重）。webhook 只記錄群組 ID 與名稱，不存任何訊息內容。

### 素材改存 S3 相容物件儲存（2026-09-24，尚未切換）

目前素材存在 api 的 Railway volume（`/data/media`）：檔案只在那一顆 volume 上，api 只能
單一實例，repo 裡也沒有備份機制。程式已支援 S3 相容物件儲存（Cloudflare R2、AWS S3 等）：
`WEBSITE_MEDIA_STORAGE=s3` 時上傳、讀取、刪除都走 bucket，api 啟動不再要求 volume。
讀檔仍經 API 串流（網址、權限、快取標頭不變，Range 轉給儲存服務，iOS 影片可播）。

| 變數 | 說明 |
| --- | --- |
| `WEBSITE_S3_BUCKET` | bucket 名稱（建議私有，不要開公開存取） |
| `WEBSITE_S3_ENDPOINT_URL` | R2 為 `https://<account id>.r2.cloudflarestorage.com`；AWS S3 留空 |
| `WEBSITE_S3_REGION` | R2 填 `auto`；AWS 填 bucket 所在區域 |
| `WEBSITE_S3_ACCESS_KEY_ID`、`WEBSITE_S3_SECRET_ACCESS_KEY` | 只授權這個 bucket 讀寫的金鑰，存 Railway Variables |
| `WEBSITE_S3_PREFIX` | 選填，物件 key 前綴（例如 `media`） |

切換步驟（bucket 與金鑰由園方自己建，程式不會建任何外部服務）：

1. 先只設 `WEBSITE_S3_*`，**不要**設 `WEBSITE_MEDIA_STORAGE`，部署。此時仍讀寫 volume。
2. 預覽：`railway ssh --service api --environment production -- python -m app.cli media-copy-to-s3 --dry-run`
3. 複製：同上去掉 `--dry-run`。只讀 volume、只寫 bucket、不動 DB；bucket 已有同大小的檔案
   會跳過，可以重跑；上傳後核對大小，失敗的檔案列在最後且指令以非 0 結束。
4. 設 `WEBSITE_MEDIA_STORAGE=s3` 並重新部署；部署後**再跑一次第 3 步**，補上複製到切換
   之間新上傳的檔案。
5. 抽查官網圖片、影片與後台素材庫。volume 先保留一段時間當備份，確認無誤後再卸下。

## `feature/admin-gaps-20260925` 累積變更（尚未部署，2026-09-25／26）

此分支到 `84e9c41`（B10）為止已合併進 `main` 並部署（正式庫在 2026-09-25 已上線狀態那次同步升到 `c4d8e2f6a913`）；`84e9c41` 之後（B11–B14＋B15 這次文件同步）**尚未合併進 `main`、尚未部署**。之後部署這個分支或把它併回 `main` 時要注意：

- **Migration**：目前分支唯一 head 是 `de61f57ec77d`，從 `c4d8e2f6a913` 之後新增的 revision 全部只加欄位／新表／enum 值，皆有 `nullable`／`server_default` 或只新建表，可安全套用在有資料的正式庫；API 啟動時的 `alembic upgrade head` 會自動套用，不需手動介入。其中 `e5b1c7a9d402`（個資匯出逐人授權）會回填「目前啟用中的分校管理者」補上 `booking.export`；`31eb94190b1c` 會在正式站發布一版與官網現有文字相同的 `booking_content`（同意版本追蹤上線用）；其餘（例如 `a8c3e5f7b219` 樂觀鎖版本欄位、B09／B10 的素材封存與衍生檔欄位）都只加欄位，不回填或只回填衍生尺寸。
- **新環境變數**（見上方環境變數表）：`WEBSITE_SMTP_*`（真實寄信，選填）、`WEBSITE_GOOGLE_*`（後台 Google 登入，選填）、`WEBSITE_LINE_CHANNEL_ID`／`_SECRET`／`_REDIRECT_URI`（後台 LINE 登入，與群組推播是不同 channel）、`WEBSITE_RETENTION_ALLOW_REAL_RUN`（同時控制手動與定期自動清理）、`WEBSITE_MEDIA_MAX_IMAGE_MB`／`_MAX_VIDEO_MB`／`_PURGE_DELAY_DAYS`、`NUXT_MEDIA_MAX_UPLOAD_MB`。全部選填、留空時退回舊行為（不寄真實信、不顯示 Google 登入入口等），不會因為沒設定而報錯。
- **部署後要跑一次 `initialize-content`**（2026-10-08 註：FAQ 已整個拿掉，現在不會再建立 `shared_faq`，以下 FAQ 部分只是當時紀錄）：會建立並發布 `shared_faq`（全站共用常見問題），並把「目前發布版仍是原型匯入、之後沒有新版本」的各校常見問題改用共用題目（先加 `--dry-run` 確認影響範圍）；也會補上之前就存在但還沒發布過的內容項。
- **CI**：`website.yml` 新增 `e2e` job（`tests/stack/`，postgres service＋系統 Chrome），目前不在 `deploy` 的 `needs` 裡，不會擋部署；第一次在 GitHub runner 跑之前，建議先觀察幾次 feature 分支的結果。
- **Google／LINE 登入**：三個 `WEBSITE_GOOGLE_*` 都留空就不顯示 Google 登入入口；後台「我的帳號」可自行解除 Google 綁定。這些是選填功能，不影響現有帳密登入。
- 詳細清單、逐項驗證見 `docs/website-admin/acceptance.md` 底部「2026-09-25／26 小結」。

## 初次初始化

下列指令會寫資料庫，僅對已明確核准的新官網資料庫執行。2026-09-24 起 API 啟動時會自動 `alembic upgrade head`，第一行只在需要手動介入時用；CMS 初始化與管理員建立仍需另行執行。

```sh
railway ssh --service api --environment production -- python -m alembic upgrade head
# 2026-09-22 正式 head 為 8cf3e2b5a641，新增孩子／聯絡資料欄位。
# 前置 a1c4f7e92b30 含唯一索引、占位及通知去重；會封存重複 Email 帳號，
# 執行前先確認影響範圍。本次正式 runner 額外檢查零重複，否則停止。
railway ssh --service api --environment production -- python -m app.cli seed --dry-run
railway ssh --service api --environment production -- python -m app.cli initialize-content /app/content/site-fixture.json
railway ssh --service api --environment production -- python -m app.cli bootstrap-admin
```

`initialize-content` 驗證所有 payload 後，僅補 `latest_version=0` 的空白項目。重跑不覆蓋既有草稿、不多建版本。2026-10-12 起來源是官網用的 `web/server/data/site-fixture.json`（映像把它複製到 `/app/content/site-fixture.json`，所以上面的指令路徑不變；原本另有一份 `content/site-fixture.json`，已刪除），共初始化 21 筆：11 種共用內容、五校介紹、五校校園探索（FAQ 已於 2026-10-08 拿掉）。正式站早已初始化過，重跑只補還沒有版本的項目：明華、崇德、國際、仁武四校的校園探索以前讀舊 fixture 時是待補樣板、沒建過，現在會用 fixture 的真實場景建立並發布，內容與官網內建的相同。（以下為 2026-09 首次初始化當時的紀錄：共 20 筆，其他四校巡覽保留待補狀態，來源文案原樣保留，包含尚未改成正式用語的原型說明。）

**官網瀏覽量與速度上線步驟（2026-09-24）**：新增 migration `b7d2e4f1a903`（只建 `page_view_daily`、`web_vital_samples` 兩張表，不動既有資料）。（2026-09-24 更正：「schema 檢查擋下時正式站維持舊版」不成立。api 掛 volume，Railway 先停舊容器，檢查擋下就是停站；現已改為啟動時自動 upgrade。）

**home_news 上線步驟（2026-09-24）**：不需要 migration，但部署後要再跑一次上面的 `initialize-content`，才會建立並發布 `home_news`（只補這一筆，其餘 18 筆已有版本不會動）。沒跑之前官網仍顯示程式內建的示意消息，畫面與現在相同；跑完後由後台「首頁 → 最新消息與活動」編輯，示意說明清空後首頁才拿掉「示意內容」標示。

**admission_content 上線步驟（2026-09-24）**：不需要 migration。部署後再跑一次上面的 `initialize-content`，只會補建並發布 `admission_content` 這一筆（其餘已有版本不會動）。沒跑之前 `/admission` 顯示程式內建的同一份內容，畫面相同；跑完後由後台「全站與素材 → 入學資訊頁」編輯。頁面上方的提醒（「金額與補助依各校公告…」）在園方確認金額後可於後台清空。

初始五校預約維持 `paused`，搜尋索引關閉。通知寄送已支援真正的 SMTP adapter（見上方環境變數表的 `WEBSITE_SMTP_*`）；正式站要不要寄真實 email，由使用者決定要不要在 Railway api 設定這幾個變數——沒設定時 outbox 只寫站內通知，不會報錯也不會累積等日後補設定。

## 更新部署

先跑 web 型別／測試／build、admin build／測試及本次修改相關 backend 測試。上傳範圍只包含 `web/ admin/ backend/ content/ contracts/ deploy/ .dockerignore`，排除 `.env*`、本機依賴、快取與 `backend/var/`。不要把本機資料庫、素材或帳密交付檔上傳。

```sh
railway up <已檢查的程式快照目錄> --path-as-root --project d606df61-445a-4e65-9c5f-7e94a0766572 --environment production --service api --detach
railway up <同一份快照目錄> --path-as-root --project d606df61-445a-4e65-9c5f-7e94a0766572 --environment production --service web --detach
```

CLI 上傳部署包含工作目錄變更，不等於 Git commit 部署；記錄快照 SHA-256，並在快照內產生 `web/public/release.json` 供線上版本驗證。上線後需確認 Railway SUCCESS、API live health、CMS release、五校 SSR、後台登入及素材持久磁碟，而非僅看 build 成功。

## 2026-10-03 拿掉各校分校資訊頁（`feature/remove-campus-pages`，main CI 部署）

- main `26eb29d`（拿掉分校頁）＋`27b2fa2`（併發測試場次日期改台北日期）；部署 run 37080768171。第一次 Backend job 紅（`test_booking_concurrency` 在 UTC 跑、台北已跨日時差一天，Deploy 被跳過），改測試後 Frontend（admin）的 `ux20260928E`「刪除場景」偶發失敗，重跑失敗 job 後全綠、Deploy Railway production success。
- 未執行 migration、未寫入業務資料。
- 線上核對（唯讀）：`/`、`/about`、`/environment`、`/visit`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health`、`/sitemap.xml` 皆 200；`/campuses/yihua`、`/campuses/renwu`、不存在的校區皆 301 轉 `/`；首頁 HTML 沒有 `/campuses` 連結，JSON-LD 只有 EducationalOrganization 與 WebSite。未做瀏覽器檢查。
- 後台分校簡介、常見問題、環境導覽、預約橫幅文案仍可編輯，但公開站已沒有頁面顯示。

## 家長自選場次（上線前草稿；10-01 已部署 main `b216133`，下列人工步驟仍適用）

**2026-10-16 補註**：上線當天只有義華開放場次、其他四校顯示「即將開放」；文末「送單兩則通知」已在 2026-10-04 改成一則（`bdab2ec`，見上方紀錄）。

`feature/parent-self-booking-20260930`：官網預約只剩自選場次、送出即預約成功。2026-10-01 已隨 main `b216133` 上線（10-16 補註）。規格 `docs/specs/2026-09-30-parent-self-booking-design.md` §7。

上線前人工步驟：
1. **寄信帳號**：Railway api 設 `WEBSITE_SMTP_HOST／PORT／SECURITY／USERNAME／PASSWORD／FROM`（Gmail／Google Workspace 應用程式密碼最省事；用學校網域寄件要先設 SPF／DKIM）。不設也能上線，家長只在畫面上看到修改連結（`parent_email_enabled=false`）。
2. **各校設定場次**：上線後各校到後台「參觀場次」按「套用常用場次」→ 調整 →「儲存並開放線上預約」。上線時沒設場次的校先顯示暫停；上線前若已有每週規則，migration 會直接切成自選場次。
3. **同意文字**：確認各校已發布的預約同意文字提到 Email 用於寄送預約確認與修改連結（參觀後的招生用途寫法由業主裁定）。
4. 依備份閘門備份正式 DB（改寫資料的 migration）；用 `railway` MCP 或使用者自己的終端機執行，不要在 auto 模式跑 railway ssh。
5. **web 與 api 必須同一次上線**：舊官網表單送出會先收到 422（缺 `slot_id`／`email`）或 `BOOKING_CONFIG_CHANGED`。
6. 更換 `WEBSITE_SESSION_SECRET`：已發出的修改連結仍可用到到期，但系統無法再重算（重送、寄信拿不到連結），園方可按「重新產生連結並寄出」。
7. 家長端每案每日上限：改期 5 次、改資料 10 次；每個來源 24 小時最多占 5 個場次名額（`WEBSITE_BOOKING_SLOT_HOLDS_PER_SOURCE_PER_DAY`）。

上線前用 SQL **唯讀**查兩件事：(1) 哪些 inquiry 校已有每週規則或未來場次（預先確認 migration 會把五校各切成 slots 或 paused）；(2) 未來、`closed_source IS NULL` 的已關閉場次上有沒有 confirmed 案件（這些不再列入待人工處理）。

上線後唯讀檢查：對五校 `GET /api/website/v1/public/booking-config/{yihua,minghua,chongde,international,renwu}`，看 `mode` 與 `parent_email_enabled` 是否符合預期；smoke 逾時先查 `release.json` 與 railway http log。

待業主決定：每筆官網預約同時通知園方「新的參觀需求」與「參觀預約已確認」兩則（LINE 群組一筆兩則推播），要不要合併成一則。

合併前：origin/main 已前進（審查時為 392a41c，動到 `contracts/openapi.json` 與 `operations/routes.py`），先 rebase 並重跑 `npm run contract:generate` 與後端全套。**本節只是草稿，部署後才補部署紀錄。**
