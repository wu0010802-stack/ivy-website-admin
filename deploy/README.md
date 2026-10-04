# Railway 官網部署

此專案與園務系統完全分離，使用獨立 PostgreSQL。

GitHub Actions 的 `main` 分支 CI/CD 設定與啟用步驟見 [CICD.md](./CICD.md)。`main` push 通過 CI 後會自動正式部署；下方保留手動部署與歷次快照紀錄。

Google OAuth 的 API 變數、公開 callback、管理員資格及 migration 順序見 [google-oauth.md](./google-oauth.md)。2026-09-24 起 API 每次啟動會自動 `alembic upgrade head`，合併進 `main` 的 migration 會在部署時套到正式 DB；撰寫規則與失敗行為見 [CICD.md](./CICD.md)。刪除或改寫既有資料的 migration，合併前仍要先手動備份。

- Railway project：`d606df61-445a-4e65-9c5f-7e94a0766572`（ivy-website-admin）
- environment：`cf5631c7-05b9-4f16-9358-c81d2650eb55`（production）
- web：`e0851ec5-3bc0-4b5c-9471-9d9131616c26`，`deploy/web.Dockerfile`
- api：`9124b9c0-4ddf-4445-bd2f-798b277f44ec`，`deploy/api.Dockerfile`
- 官網：<https://web-production-04caa.up.railway.app/>
- 後台：<https://web-production-04caa.up.railway.app/admin/>

## 特色教學頁、關於常春藤頁開放後台編輯（`feature/page-cms-20261004`，未部署）

不需要 migration、不需要改環境變數。上線後**不必**跑 `initialize-content`：官網沒發布過這兩份內容（`curriculum_page`、`about_page`）時顯示內建內容，後台打開編輯頁會帶出同一份。若要跑，先加 `--dry-run`，確認清單只有 `curriculum_page`、`about_page` 再跑（指令由使用者用 `! railway ssh …` 執行）；它會連帶補建其他從未建立的項目。

若園方確認義華創校年份是 1998：在後台「關於常春藤頁」改沿革第一站的年份，並檢查首屏介紹與其他段落文字裡的「1997」一起改；`/about` 的搜尋標題、描述與首頁 JSON-LD 會跟著沿革年份。30 週年頁（`web/app/utils/anniversary/timeline.ts` 等）與 `llms.txt`（`web/app/utils/seo.ts` 約 :266）的 1997 不會跟著改，要另外請工程師改。

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
- **未做**：正式站沒登入看後台畫面；Safari／iOS 實機。待使用者確認（都先照預設上線）：到場率分母、班別預設學年與是否含已取消、唯讀角色看「我承辦的案件」、停用帳號不清承辦人、到期前 15 分鐘提醒、家長端錯誤訊息改中文狀態名。已知限制：沒有未儲存修改的分頁，在別的分頁換成另一個帳號登入後會直接以那個帳號回到原頁（同舊行為）。

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

## 招生入學（2026-10-02 已部署 `2eafc1b`，後續修正隨 `a2ed829` 上線，功能開關關閉）

`feature/admissions-20261001`：後台「招生入學」，階段 A（後端與轉移契約）、B（後台畫面）、C（統計、五校比較、stack e2e）。2026-10-02 使用者要求併入 main 並部署（合併提交 `71820a4`，同步 main 後 `2eafc1b`）；正式站**開關仍關閉**。規格 `docs/specs/2026-09-30-website-admissions-design.md`。

- **開關** `WEBSITE_ADMISSIONS_ENABLED`（api，預設 `false`）。關閉時：後台側欄與側欄搜尋不列「招生入學」（`/auth/me` 的 `features.admissions`）；`/api/website/v1/admin/admissions/*`（含 `stats`、`compare`、`no-deposit-records`）不掛路由、一律 404，後台「招生入學」頁顯示「招生入學尚未啟用」；預約「標記已到場」照常，但不建招生訪視；保存政策的招生類別照常顯示（沒資料就是 0 筆）。
- **規格 §15 Q1 裁定前不可在正式站開啟**：預約同意書是否涵蓋參觀後的招生聯繫與紀錄、招生訪視保存幾天。同意文字建議跟家長自選場次改版的同意文字同一次改。
- **開啟方式**：Q1 裁定、同意文字改版發布後，先在保存政策設好招生訪視天數（預設空白＝不自動清理，業主裁定天數後由總管理者設定），再到 Railway api 服務 Variables 設 `WEBSITE_ADMISSIONS_ENABLED=true` 並重新部署 api（設定在啟動時讀、路由在建立 app 時決定，只改變數不重啟不會生效）。
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
- **部署後要跑一次 `initialize-content`**：會建立並發布 `shared_faq`（全站共用常見問題），並把「目前發布版仍是原型匯入、之後沒有新版本」的各校常見問題改用共用題目（先加 `--dry-run` 確認影響範圍）；也會補上之前就存在但還沒發布過的內容項。
- **CI**：`website.yml` 新增 `e2e` job（`tests/stack/`，postgres service＋系統 Chrome），目前不在 `deploy` 的 `needs` 裡，不會擋部署；第一次在 GitHub runner 跑之前，建議先觀察幾次 feature 分支的結果。
- **Google／LINE 登入**：三個 `WEBSITE_GOOGLE_*` 都留空就不顯示 Google 登入入口；後台「我的帳號」可自行解除 Google 綁定。這些是選填功能，不影響現有帳密登入。
- 詳細清單、逐項驗證見 `docs/website-admin/acceptance.md` 底部「2026-09-25／26 小結」。

## 2026-09-29 資安稽核修正：部署前後人工步驟（已於 2026-09-29 部署，部署後步驟待做）

白箱資安稽核的修正在分支 `fix/security-audit-20260929`（已合併 main `576672c`，含已上線的 PR #13–#17；與 PR #14 重複的機制只留一份，下面「這次改了什麼」照合併後的狀態寫）。併進 `main` 就會正式部署；**api 掛 volume，Railway 先停舊容器再起新容器，新版啟動失敗＝停站**（見 2026-09-24 PR #9），所以「部署前」每一項都要先確認。

### 部署前（必做）

1. **核對 api 變數，新增的啟動檢查任一不符 API 就起不來**：
   - `WEBSITE_ENVIRONMENT` 有值（正式站 `production`）。沒設時 `deploy/api-start.py` 在跑 migration 前就結束。
   - `WEBSITE_ADMIN_ORIGIN` 是不含路徑的 `https://` 網址（本檔記載為 `https://web-production-04caa.up.railway.app`）。
   - `WEBSITE_SESSION_SECRET` 不含 `change-me`／`changeme`／`change_me`／`example`／`placeholder`（不分大小寫）；長度下限仍是 16，沒有提高。
   在自己的終端機跑（只印環境、origin 與秘密的長度，不印秘密本身）：

   ```sh
   railway variables --service api --environment production --kv | python3 -c 'import re,sys; v=dict(l.rstrip("\n").split("=",1) for l in sys.stdin if "=" in l); s=v.get("WEBSITE_SESSION_SECRET",""); print("ENVIRONMENT", v.get("WEBSITE_ENVIRONMENT")); print("ADMIN_ORIGIN", v.get("WEBSITE_ADMIN_ORIGIN")); print("SESSION_SECRET length", len(s), "PLACEHOLDER!" if re.search("change-?me|change_me|example|placeholder", s, re.I) else "ok")'
   ```

   秘密不合格時先換（`python3 -c "import secrets;print(secrets.token_urlsafe(32))"`，在 Railway 網頁貼上）。換 session secret 會讓所有後台登入與限流計數失效，是預期行為。
2. **Migration**：本次附一支新的 additive migration `e4c1a7f3b862`（LINE 群組驗證：`line_groups.verified_at` 可為 NULL＋新表 `line_group_verification_codes`，不回填、不改寫既有資料，與上一版程式相容）。API 啟動時自動套用；依「改寫資料才強制先備份」的規則不強制先備份，但本次一併開 PITR（見下）後再部署最安全。
3. **確認 api／web 已斷開 Railway 的 GitHub 原生 autodeploy**（Settings → Source）。CICD.md 記錄 2026-09-24 時仍綁著：沒斷的話 `main` push 當下 Railway 就直接部署（不等 CI），migration 會在 CI 跑完前套到正式 DB。

### 這次改了什麼（部署相關）

- **存取紀錄**：沿用 PR #14 已上線的做法，只有 uvicorn 的 access log 一份，查詢字串由 `backend/app/logging_config.py` 拿掉（後台案件搜尋的 `?q=` 常是家長姓名或手機）；本分支原本的 `--no-access-log`＋API 自記 `app.access` 在合併時移除，不會有兩份。這次的差別只有：`app.*` 等 logger 的 INFO 改走 stdout、WARNING 以上走 stderr（PR #14 原本全部走 stderr，Railway 會把每一行 INFO 標成錯誤）。
- **production 關閉 `/docs`、`/redoc`、`/openapi.json`**：PR #14 已上線，這次沒有變動。契約匯出（`backend/scripts/export_openapi.py`、`npm run contract:check`）直接呼叫 `app.openapi()`，不受影響；CI smoke 不用這幾個路徑。
- **後台與登入回應 `Cache-Control: private, no-store`**：`/api/website/v1/admin/*` 與 `/api/website/v1/auth/*` 一律加上，路由自己已設的（素材縮圖 `private, max-age=86400`、OAuth 的 `no-store`）不覆寫。
- **連線池**：請求池改依 `WEBSITE_DB_*` 設定（預設與 PR #14 寫死的 10＋10、等 10 秒相同）；限流獨立小池沿用 PR #14（3＋2 條、等 5 秒），不和送單請求互等。這次新增：限流池拿不到連線時，放行判斷一律當作超限（回 429，Retry-After 5 秒），事後記帳只記 warning。每條執行期連線除了 PR #14 的 `statement_timeout`（30 秒），再帶 `lock_timeout`（10 秒）與 `idle_in_transaction_session_timeout`（5 分鐘）；alembic 自建 engine，三個都不套用。SQLAlchemy 例外不再把綁定參數（家長個資）寫進 log。
- **限流鍵 IPv6 聚合到 /64**（IPv4 不變、IPv4-mapped 視同 IPv4）。上線後既有 IPv6 訪客的限流計數等於歸零一次。
- **base image 以 digest 釘版**（`deploy/api.Dockerfile`、`deploy/web.Dockerfile`，CI 的 `postgres:16` service 也是）。更新方式：讀 Docker Hub 的 multi-arch index digest 後把 `tag@sha256:…` 一起換掉：

  ```sh
  repo=library/python tag=3.12-slim   # 或 library/node 22-alpine、library/postgres 16
  token=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repo:pull" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
  curl -fsSI -H "Authorization: Bearer $token" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" "https://registry-1.docker.io/v2/$repo/manifests/$tag" | grep -i docker-content-digest
  ```

  釘版後不會自動吃到上游安全更新，至少每月更新一次（或設定 Renovate／Dependabot 的 docker 更新）。
- **`.gitignore` 排除 `backend/var/`、`var/`**（本機素材與 mail sink 含兒童照片、家長個資）。
- **後台登入**：session 改成閒置逾時（`WEBSITE_SESSION_IDLE_MINUTES`，預設 120 分鐘，可設 5–720；有活動自動延長），登入滿 12 小時一律失效；`ivy_admin_session` 改成瀏覽器 session cookie（不帶 Max-Age，關瀏覽器就清掉）。上線前發出的 12 小時 session 第一次使用時就拉回閒置窗口，不需額外處理。密碼登入：同一帳號 5 分鐘內錯 10 次，**該帳號的密碼登入暫停 15 分鐘**（連正確密碼也擋、不跑 bcrypt；同時灌進來的一批請求最多驗 10 次，排隊中開始鎖定的一樣擋），Google／LINE 登入與已登入的 session 不受影響；失敗與開始鎖定都寫稽核。驗密碼時同時最多 4 件、排隊最多 16 件，再多直接 429；查完帳號就歸還 DB 連線，登入洪泛不會佔住主連線池。429 的 `detail.code` 分成 `LOGIN_LOCKED`（帳號鎖定中，Retry-After 900 秒）與 `LOGIN_RATE_LIMITED`（來源限流、排隊已滿、限流池忙碌），後台依此顯示不同訊息。session 延長時拿不到第二條連線就這次不延長，不讓請求 500。後台在有鍵盤／滑鼠輸入時每 10 分鐘最多打一次 `/auth/me` 延長閒置期限；有未儲存修改的頁面收到 401 時不導頁，改請本人在新分頁重新登入後回原頁按「我已重新登入」再儲存。綁定／解除 LINE、解除 Google 時，登入超過 10 分鐘要輸入目前的密碼（後台會跳出輸入框）。總管理者可在「使用者」替別人「解除綁定並登出」；停權也會一併解除 Google／LINE 綁定。密碼欄位一律最多 128 字（超過回 422）；新設定的密碼另限 UTF-8 最多 72 bytes（英數字 72 個、中文約 24 字，bcrypt 超過的部分不會生效）。
- **公開預約**：每個來源 24 小時內最多占 5 個時段（`WEBSITE_BOOKING_SLOT_HOLDS_PER_SOURCE_PER_DAY`，只算時段模式）、同一來源對同一校每小時最多 5 筆（所有模式，含不占時段的 inquiry）、每校每小時最多 30 筆官網送單（`WEBSITE_BOOKING_SUBMISSIONS_PER_CAMPUS_PER_HOUR`，所有模式），超過回 429 `BOOKING_LIMIT`。**每校上限是灌單時的斷路器，觸發時會連真實家長一起擋**（API log 有「官網送單達每小時上限」warning）；有前面的每來源上限，單一來源最多用掉預設額度的 1/6。同一支手機每 10 分鐘 5 筆另在校區設定列鎖內核對已建立的筆數（併發送單不會一起越過；同一把 Idempotency-Key 的併發重送仍拿回同一張收據）。**每來源上限靠 `WEBSITE_TRUSTED_CLIENT_IP_HEADER` 與官網代理帶的 `x-website-client-ip` 分辨來源**（IPv6 以 /64 計），代理沒帶這個 header 時不套用，以免全站共用同一個桶。台灣行動網路常見 CGNAT，有家長反映「這個網路近 24 小時送出的時段預約已達上限」時調高前者。`GET /public/slots` 每來源每分鐘 60 次。新建案件的 payload hash 改用 HMAC；匿名化會一併清掉 hash 與 Idempotency-Key。後台 CSV 匯出改成下載檔案（`Content-Disposition: attachment`）。
- **Cloudflare Turnstile（公開預約的機器人驗證，選填）**：`WEBSITE_TURNSTILE_SITE_KEY` 與 `WEBSITE_TURNSTILE_SECRET_KEY` 兩個都設才啟用，只設一個 API 拒絕啟動。**要等官網的 Turnstile 元件上線（本次部署）後才能設**：順序反過來，所有官網送單都會被擋成 400 `BOT_CHECK_FAILED`。步驟：本次部署上線 → Cloudflare 後台建立 Turnstile widget（hostname 填正式網域，換自訂網域時要一起加）→ Railway api service 設兩個變數（secret 只放 Railway 變數，不進 repo）→ 用真的瀏覽器送一筆預約確認元件出現且能送出 → **查 api log 確認這筆送單沒有 `Turnstile` 開頭的 warning／error**（secret 設錯時 Cloudflare 回 `invalid-input-secret`，API 為了不讓整站停收仍會放行，只記一筆 error，光看「送得出去」驗不出來）。web service 不需要新變數（site key 由預約設定 API 帶出）。只有 Cloudflare 本身故障（連線錯誤、逾時、5xx、`internal-error`）時 API 放行並記 warning；其他 4xx、回應不是 JSON、驗證沒過一律 400 `BOT_CHECK_FAILED`。不比對 siteverify 回傳的 hostname：能產生 token 的網域由 Cloudflare widget 的 hostname 清單管制（換自訂網域時記得加）。日後若收緊公開站 CSP，`script-src`、`frame-src`、`connect-src` 都要放行 `https://challenges.cloudflare.com`。
- **公開 telemetry／CTA 點擊**：資料照留、不清除（業主裁定），改用全站上限封住寫入量：telemetry 每分鐘 600、每日 20,000（瀏覽量與 Web Vitals 合計），點擊每分鐘 120、每日 5,000，每日以 UTC 日界線（台北 08:00）計、每天各自計數（前一天灌滿不影響隔天）。全站每日上限之前另有每來源每日上限（telemetry 500、點擊 200，代理有帶訪客 IP 才套用），少數來源用不光全站額度。超過時安靜丟棄、仍回 204，但每個窗口第一次開始丟棄時 API log 會記一筆 warning（`公開事件…上限已滿`）；看到這筆代表後台「數據」頁那段時間少算。可用 `WEBSITE_TELEMETRY_GLOBAL_PER_MINUTE`／`WEBSITE_TELEMETRY_DAILY_CAP`／`WEBSITE_ANALYTICS_CLICKS_GLOBAL_PER_MINUTE`／`WEBSITE_ANALYTICS_CLICKS_DAILY_CAP` 調整，請對照後台「數據」頁的實際流量。官網代理對 `/api/website/v1/public/telemetry` 一律回 404（只接受經 `/api/telemetry` 轉送）。
- **LINE 群組驗證**：新增 migration `e4c1a7f3b862`（見部署前第 2 點）。部署後既有群組的 `verified_at` 都是 NULL，已綁定的校區照常推播；要改到另一個群組時，先在那個群組貼後台產生的驗證碼（見上方「LINE 群組推播」第 5 步）。
- **素材**：Pillow 升到 12.3.0。圖片原檔去中繼資料沿用 PR #14 的無損做法（只留拍攝方向，像素不動），這次收緊成白名單：JPEG 其他 APPn（MPF、C2PA…）、多次掃描之間的區段與 EOI 之後的附加資料，PNG／WebP 不認得的 chunk 也拿掉；影片的地點與建立時間也去除（ffmpeg 不轉碼重新封裝）；清理寫到暫存複本，不再就地改寫來源檔。Pillow 與 ffmpeg 只解讀白名單格式，處理並行數限制為 2，送檔前先釋放 DB 連線。同校（共用素材全站一把）的配額鎖在交易內把 `lock_timeout` 放寬到 300 秒（沿用 PR #14 的 5 分鐘排隊上限）、`statement_timeout` 放寬到 330 秒，不受一般的 10 秒／30 秒限制；等鎖逾時一定先到，等不到回 409 `MEDIA_BUSY`（請稍後重傳），不是 500。**既有素材要在部署後手動處理一次**，見下方「部署後」。
- **官網（web）**：資安標頭改在 nitro request hook 套用（涵蓋靜態資源與後台入口 `/admin/`），後台頁面加上嚴格 CSP（`script-src 'self'`）；API 代理在 PR #14 的 `..`／`%2e%2e` 檢查之外，再拒絕前綴內的 `..`、`.` 區段、編碼斜線、反斜線與控制字元（合併後同一支 `escapesApiPrefix`，一律回 PR #14 的 404；原本前綴內的 `..` 會照常轉送，現在也擋），素材改走有背壓的串流並在客戶端斷線時中止上游；`/assets/**/*.mp4` 改成串流並支援 Range；公開站資料加 3 秒程序內快取（ETag 重新驗證），疊在 PR #14 的 8 秒逾時與「API 暫時失敗時退回上一份成功內容」之上，發布後最多 3 秒才出現在官網。這層快取只保護正常的 SSR／換頁：通用 API 代理的 `GET /api/website/v1/public/site` 與 `GET /api/public-site`（CI smoke 在用）仍每次叫後端重組內容，刻意洪泛要靠後端快取才擋得住，列為後續工作。後台 CSP 是後台頁面本身的縱深防禦；稽核 `admin-same-origin-as-public-site`（公開頁 XSS 可同源呼叫後台 API）**仍未關閉**，要等後台移到獨立 origin 或公開站導入 nonce 型 `script-src`。
- **保持不變**：`/api/website/v1/health` 仍回 `environment`、`fixture_enabled`、定期工作時間，`/release.json` 仍含 commit SHA——CI 部署後的 smoke（`deploy/railway_ci.py`）靠這些欄位確認 production／live，所以不收斂（稽核 `public-release-health-metadata` 列為 info、可接受）。

### 新環境變數（全部選填，沒設定就維持舊行為）

見上方環境變數表：`WEBSITE_TURNSTILE_SITE_KEY`／`WEBSITE_TURNSTILE_SECRET_KEY`（兩個一起設才啟用，只設一個會拒絕啟動；要等官網元件上線後才能設）、`WEBSITE_MIGRATION_DATABASE_URL`、`WEBSITE_DB_*`、`WEBSITE_SESSION_IDLE_MINUTES`（120，5–720）、`WEBSITE_BOOKING_SLOT_HOLDS_PER_SOURCE_PER_DAY`（5，需代理帶 trusted client IP header 才套用）、`WEBSITE_BOOKING_SUBMISSIONS_PER_CAMPUS_PER_HOUR`（30）、telemetry 與點擊的全站上限（600／20000／120／5000）。範例與預設值在 `backend/.env.example`。

### 部署後（必做）

1. **既有素材去除拍攝資訊**（PR #14 上線（2026-09-29 03:36 UTC）以前上傳的圖片原檔是原樣保存的；之後的只拿掉 EXIF／XMP／IPTC／註解，其他 APPn 與 EOI 之後的附加資料還在；影片一直沒處理，拍攝地點會跟著公開）。依「改寫資料先備份」的規則，**先備份正式 DB 與媒體 volume（或 S3 bucket）**，再在 Railway api 服務執行（auto 模式會擋 `railway ssh`，請自己在終端機跑）：

   ```sh
   python -m app.cli strip-media-metadata          # dry-run：只列出會處理哪些、各項數量
   python -m app.cli strip-media-metadata --apply  # 確認數量後才真的改寫
   ```

   `--apply` 把去除後的檔案存成新的 storage key、在同一個交易更新素材記錄，commit 成功才刪舊檔；可重跑（已乾淨的不動）。把兩次輸出的各項數量記到下方部署紀錄。已被瀏覽器或 CDN 快取的舊原檔清不掉（公開原檔帶一年的 `immutable` 快取，網址不變）；前面若有 Cloudflare 之類的 CDN，`--apply` 後手動 purge `/api/website/v1/public/media/*/file`。
2. **影片方向**：正式映像的 ffmpeg 版本與本機不同，用一支手機直拍的影片上傳一次，確認官網播放方向與 poster 正常。
3. **後台 CSP 與 Range**：用真的瀏覽器打開 `/admin/` 看 console 沒有 CSP 違規，Google／LINE 登入、素材上傳預覽、影片預覽正常；iOS Safari 播放首頁與孩子的一天影片。
4. **LINE 群組**：把正在用的各校員工群組各貼一次驗證碼，後台清單就能分辨哪些群組是別人拉官方帳號進去的。
5. **告知園方同仁**：密碼錯 10 次該帳號的密碼登入暫停 15 分鐘（可改用 Google／LINE）；綁定或解除 LINE／Google 時，登入超過 10 分鐘要輸入目前的密碼；後台閒置 2 小時要重新登入。

### 建立只有 DML 權限的執行期角色（建議，未執行）

目前 API 執行期與 migration 共用 `WEBSITE_DATABASE_URL`，執行期因此有 DDL 權限；若沿用 Railway Postgres 範本，角色很可能是 superuser `postgres`。拆開後，任何 SQL injection 都只剩資料層權限。**需要本人登入 Railway 操作，以下不會自動執行。**

1. 以目前的 owner 連線（`WEBSITE_DATABASE_URL` 那組）進官網 DB，建立執行期角色（密碼用隨機英數字，連線字串就不必 URL 編碼）：

   ```sql
   CREATE ROLE website_app LOGIN PASSWORD '<隨機英數字>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
   GRANT CONNECT ON DATABASE <官網資料庫名稱> TO website_app;
   GRANT USAGE ON SCHEMA public TO website_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO website_app;
   GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO website_app;
   -- 之後 migration（由 owner 執行）新建的表與序列自動授權
   ALTER DEFAULT PRIVILEGES FOR ROLE <owner 角色> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO website_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE <owner 角色> IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO website_app;
   ```

2. Railway api 變數：`WEBSITE_MIGRATION_DATABASE_URL` 設成原本的 owner 連線（`postgresql+asyncpg://…`），`WEBSITE_DATABASE_URL` 改成 `website_app` 的連線。alembic、啟動時的 schema 核對與 `backend/scripts/backup_website.py` 用 migration 連線，API 請求與定期工作用執行期連線。
3. 部署後確認：後台登入、公開送單、素材上傳各一次成功；`SELECT rolsuper FROM pg_roles WHERE rolname = current_user` 在執行期連線回 `false`。
4. 進一步（選做）：owner 本身也改成非 superuser（新建 `website_owner`，把 public schema 內所有表、序列、enum 型別與 `alembic_version` 的 owner 轉過去，再讓 `WEBSITE_MIGRATION_DATABASE_URL` 用它）。這步要逐一 `ALTER … OWNER TO`，請先在測試庫演練。

### 基礎設施待辦（需本人在 Railway／Cloudflare 操作）

- **備份不在同一個故障域**：開啟 Railway Postgres 的備份／PITR（`CICD.md` 記載目前未開）；另外定期把加密後的 `pg_dump` 與素材 volume 同步到異地（例如私有 R2 bucket、只給寫入權的金鑰），並做一次還原演練。現有 `/var/lib/postgresql/data/ivy-website-backups/*.dump` 和 DB 在同一顆 volume，volume 壞掉會一起消失。
- **拆 DB 角色**：見上一節。
- **Railway edge 的 IPv6**：`%2e%2e` 已由 PR #14 部署紀錄實測（edge 原樣轉送，部署前 200 回完整 OpenAPI，PR #14 起 web 代理擋下、production API 也關了文件，部署後 404），不必再查；剩下確認 Railway 是否接受 IPv6 進站，以及 `X-Forwarded-For` 裡的 IPv6 形式（決定 /64 聚合是否生效）。
- **GitHub 原生 autodeploy**：確認 api、web 兩個服務都已斷開（見部署前第 3 點）。
- **Postgres 是否開了公開 TCP proxy**：Railway Postgres 服務 → Settings → Networking，若有 TCP Proxy（`*.proxy.rlwy.net`）且沒有在用就移除；要留就確保密碼強度並只給必要的人。
- **Railway CLI 供應鏈**：CD 仍以 `npm install --global @railway/cli@$RAILWAY_CLI_VERSION` 安裝（版本固定，但沒有 lockfile 的 integrity，安裝腳本會另外下載 binary）。之後改成下載官方 release binary 並核對 SHA-256，或放進有 lockfile 的 `package.json` 以 `npm ci` 安裝。

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

`initialize-content` 驗證所有 payload 後，僅補 `latest_version=0` 的空白項目。重跑不覆蓋既有草稿、不多建版本。現行來源共初始化 20 筆：9 種共用內容（2026-09-24 起含 `home_news` 最新消息與活動、`admission_content` 入學資訊）、五校介紹、五校 FAQ、義華巡覽；其他四校巡覽仍保留待補狀態。來源文案原樣保留，包含尚未改成正式用語的原型說明。

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

## 2026-09-23 首頁手機版活動影片輪播＋最新消息直列（main CI 部署，CI 等待逾時但已上線）

- 使用者要求提交後部署，選「把 D 接進網站、影片先用現有素材剪段」。feature 提交 `9ff466b`（`README.md`／`DESIGN.md` 只暫存自己那段）＋快照 `0e0a5d2`。當下另一 session 的 feature→main 合併 `e0a50e5` 已建置未推，deploy worktree 直接建在 `e0a50e5` 上 cherry-pick 為 `c674eb3`（README 衝突只留自己那段，其他改動與原 commit 相同）；worktree 內 Node 22 `nuxt typecheck` 0 錯誤、`vitest` 24 檔 185 項、`nuxt build` 通過，本機起 `.output` 確認首頁有影片區、海報與 `/assets/day-film-mobile.mp4` 200。
- 等 `e0a50e5` 的 CI（run `35872555552`）部署完、線上 `base_commit` == `origin/main` 才推；`push ...:main` 被 auto 模式擋，由使用者執行。
- CI run `35873790445`：三個測試 job 全綠、api 部署 SUCCESS，**deploy job 失敗**：web deployment `7b581397` 在 Railway `INITIALIZING` 約 9 分鐘、`BUILDING` 約 6 分鐘，超過 `railway_ci.py` `wait_for_deployment` 的 900 秒上限。Railway 端沒有中斷，14:27:51Z 的快照照常上線：`/release.json` snapshot `2eadd48291555b184ff364a8df5851450f744600fb8b69f9c93f94df65cbaf5a`、`base_commit` `c674eb3`。**GitHub 上這次 run 顯示失敗，但線上已是新版，不必重跑。**
- 線上 Playwright（`output/playwright/home-films-prod-20260923.cjs`）390×844：近期活動隱藏、鼠尾草綠色帶、消息三列、無水平溢出；只有當前影片下載並播放，點右側露出的影片換到第 2 支（`day-film-mobile.mp4`）並播放、第 1 支暫停；圓點、最後一支往後滑回第 1 支、暫停鍵、減少動態不播通過；1440 桌機近期活動與三欄卡不變、不下載海報與影片；0 console error。截圖 `output/playwright/home-films-prod-20260923/`。Safari／iOS 實機未驗證。

## 2026-09-24 孩子的一天 iPhone 捲動抖動修正（搭頁尾校徽的 main CI 部署上線）

- 使用者要求部署。feature 提交 `83e65ca`（只有 `styles.css` 與 README 自己那段，別的 session 未提交的 README 段落沒帶）；deploy worktree 建在 `origin/main`（`2284ee4`，== 線上 `base_commit`）cherry-pick 為 `258c912`，改動與原 commit 逐行相同、無衝突。worktree 內 Node 22 `nuxt typecheck` 0 錯誤、`vitest` 24 檔 185 項、`nuxt build` 通過；本機 `.output` 以 WebKit 真滾輪錄影量測：按鈕偏移 87/153 → 0、暫停後背景 108/153 → 0，11 種寬度卡片位置與頁高新舊一致、無水平溢出。
- `push ...:main` 被 auto 模式擋，交給使用者執行時被拒（non-fast-forward）：另一個 session 已把疊在 `258c912` 之上的「頁尾拿掉畢業版校徽」`5be72ac` 推上 main，`258c912` 因此已在 main，不必再推。
- CI run `35938730503` 全綠（含 deploy job）。`/release.json` snapshot `73611de83034cb8a09e1c4d3eb365f979b1ce7c1dfcca33397b2aaecd2494b3f`、`base_commit` `5be72ac`、`created_at` 2026-09-24T00:33:33Z；首頁 SSR 內嵌 CSS 已是新 `.day-prints`／`.section.day-experience` 規則。
- 線上 WebKit（402×874）重跑：按鈕偏移 0/153、暫停後背景 0/153、捲完整段水平溢出 0。iPhone 實機未驗證。

## 2026-09-24 頁尾改用 R「燕麥＋深綠底列」（main CI 部署）

- 使用者選定比稿 R 後要求「commit 後併入 main」。feature 提交 `85f59de`（快照）、`eda8d77`（比稿頁）、`516aa57`（`SiteFooter.vue`＋DESIGN／README 自己那段，別的 session 未提交的 README 段落沒帶）。deploy worktree 建在 `origin/main`（`15e3c9d`）只 cherry-pick `516aa57` 為 `33ca882`；DESIGN.md 頂部衝突只留頁尾那段（feature 上未上 main 的「背景影片畫質」段落沒帶），改動與原 commit 逐行相同。worktree 內 Node 22 `nuxt typecheck` 無輸出、`vitest` 24 檔 185 項通過。
- 等 `15e3c9d` 的 CI（run `35940230302`）部署完、線上 `base_commit` == `origin/main` 才推；`push ...:main` 被 auto 模式擋，由使用者執行。
- CI run `35940950892` 全綠（含 deploy job）。`/release.json` snapshot `cbb2d0bd526148fdc21ecb435ffafeaef9fcebf1280e3b9a8189da2b3d609300`、`base_commit` `33ca882`、`created_at` 2026-09-24T01:03:36Z。
- 線上 Playwright（`output/playwright/footer-colour-r-prod-20260924/verify.cjs`，`BASE` 指向正式站）首頁／義華分校／預約 × 1440／390：主體 `rgb(239,232,218)`、底列 `rgb(36,72,63)` 且滿版、無水平溢出、連結 ≥44px、最低對比 5.11／底列 7.63，強制色彩補回 1px 分隔線，0 page error。截圖同目錄。Safari／iOS 實機未驗證。

## 2026-09-24 分校線稿按鈕 iPhone 閃白框修正（main CI 部署）

- 使用者要求提交後部署。feature 提交 `0620470`（`CampusBoard.vue`、明華淡彩素材／腳本／manifest，README 只暫存自己那段，別的 session 未提交的 OAuth 段落沒帶）；deploy worktree 建在 `origin/main`（`33ca882`，== 線上 `base_commit`）cherry-pick 為 `d6a1879`，改動與原 commit 逐行相同、無衝突，manifest 無重複鍵。worktree 內 Node 22 `nuxt typecheck` 0 錯誤、`vitest` 24 檔 185 項、`nuxt build` 通過（三個 `@property` 保留）；本機 `.output` 以 WebKit 錄影逐幀量測：手機輪播白框 舊寫法 13 幀 → 新 0、桌機 hover 0。
- 第一次量測在 main 版本得到 3 幀「白框」，查出是頁籤被捲到畫面外（y=-6）、取樣帶落到畫面外的量測失誤；腳本改成捲動後確認頁籤在畫面中段再量，重測如上。
- `push ...:main` 這次沒有被 auto 模式擋。CI run `35943562324` 全綠（含 deploy job）。`/release.json` snapshot `af0139ed1c64fcd06843c100e1f494976c54cd5330fd1daf9644072502709226`、`base_commit` `d6a1879`、`created_at` 2026-09-24T01:38:49Z；首頁 SSR CSS 含三個 `@property`，明華新小圖 `56f214277928-480` 200。
- 線上 WebKit 重跑：手機（402×874）自動輪播＋點按白框 0/404 幀（上線前 20）、桌機（1440×900）hover 淡入淡出 0/245 幀（上線前 54）。iPhone 實機未驗證。

## 2026-09-24 關於→孩子的一天接力：「關於」落下上線後改回原樣（15e3c9d → 48d92c2）

- **上線 15e3c9d**：使用者要求 commit 並併入 main。feature 提交 `ba6a03e`，在 `origin/main`（`5be72ac`，等於線上 `base_commit`）的 deploy worktree cherry-pick 成 `15e3c9d`；README／DESIGN 衝突以 main 為準，只插入自己的段落，web 改動與原 commit 逐行相同。worktree 內 Node 22 跑 `nuxt typecheck` 0 錯誤、`vitest` 24 檔 185 項、`nuxt build` 通過，本機 `.output` 以 Playwright 驗證落下、逐字與減少動態。`push ...:main` 被 auto 模式擋，由使用者執行。CI run `35940230302` 全綠。之後的頁尾 R（`33ca882`）、分校線稿（`d6a1879`）部署疊在它之上。上一個 session 在上線驗證前就結束了，沒有做線上實測。
- **改回 48d92c2**：使用者看過後要求「改回沒有接力動畫的樣子」，回到 09-18 seam=2 原樣。feature 提交 `acd60ce`：`studio.css`、`DayExperience.vue`、`useCurtain.ts`、`pages/index.vue` 還原成 `ba6a03e` 之前的內容，刪除 `useRelayDrop.ts`（`ba6a03e` 之後沒有別的 commit 動過這些檔）。在 `origin/main`（`d6a1879`，等於線上）的 deploy worktree cherry-pick 成 `48d92c2`，只有 DESIGN.md 衝突；這 5 個檔案與 `5be72ac` 逐字相同。worktree 驗證同上，都通過。`push ...:main` 交由使用者執行。
- CI run `35945980160` 全綠（含 deploy job）。`/release.json` snapshot `9828f3dc4a05d7c3d89cd9cddabab93110ae7d44fcadc85df8bef79333b6709e`、`base_commit` `48d92c2`、`created_at` 2026-09-24T02:12:33Z。首頁 SSR 已無 `.day-lead`／`.t-day-ch`，內嵌 CSS 的簾幕距離是 `.85`／`.55`。
- 線上 Playwright（1440×900、390×844）：
  - 簾幕距離 765／464px，與改之前相同。
  - 「的一天」整組淡入。
  - 大標無 transform。
  - 減少動態時完整顯示。
  - 無 page error。
  - iPhone 實機未驗證。

## 2026-09-24 PR #9 部署停擺，部署流程改為 API 啟動時自動 migration

- PR #9（`fef0dc6`）帶 `d3a8f1c5b742`，正式 DB 停在 `c6e4a2b9d810`。11:22 UTC push 當下 Railway 原生 GitHub 部署（api `08490c80`、web `245f61e6`）先起新 API；因 api 掛 volume，舊 API `6fab9890` 於 11:23:52 UTC（台灣 19:23）被停，新容器 schema 檢查失敗，CD 的 `0e3ff17f` 也同樣失敗。結果 API 0/1 running，`/`、`/api/public-site` 503，`/admin/login`、`/release.json` 仍 200。
- 使用者選擇不回滾，改做自動 migration 後推 `main` 恢復。`deploy/api-start.py` 啟動時先 `alembic upgrade head` 再唯讀核對；`backend/migrations/env.py` 加 advisory lock；`check_schema.py` 錯誤訊息改成對應新流程；新增 `deploy/tests/test_api_start.py`；規則寫進 [CICD.md](./CICD.md)。
- 本機驗證見 CICD.md 2026-09-24 段。`d3a8f1c5b742` 只加 `visit_requests.source`（NOT NULL，預設 `web`）、nullable `created_by` 外鍵與承辦人索引。
- 查到的其他狀態：api／web 仍綁 GitHub repo（原生部署不等 CI）；Railway Postgres PITR 未開；api healthcheck `/api/website/v1/health` 120 秒、restart ON_FAILURE 3 次、單一 replica、無 pre-deploy command。
- 使用者執行 push：`fef0dc6..6afca86`。Railway 原生部署 api `2be159b5`（commit `6afca86`）容器內 log：`Running upgrade c6e4a2b9d810 -> d3a8f1c5b742`、`Database schema ready: d3a8f1c5b742`、uvicorn 啟動；11:47:15 UTC（台灣 19:47）首頁恢復 200，停站約 23 分鐘。
- CI run `35994898100` 四個 job 全綠（deploy job 3 分 28 秒）。CD 部署 api `202345f5`：alembic 沒有 `Running upgrade`（已在 head，no-op）、`Database schema ready: d3a8f1c5b742`；web `10b2ed9b` SUCCESS，公開 smoke 通過。`/release.json` snapshot `7d1e277a1b1cae0482f5a51f3013b3daf8658d1c99f2e4099036f799280a2843`、`base_commit` `6afca86`、`web+api`。
- 另以公開 GET 核對 `/`、`/api/website/v1/health`、`/api/public-site`、`/campuses/yihua`、`/campuses/renwu`、`/visit/yihua`、`/admin/login` 皆 200。未做瀏覽器檢查、未登入後台或寫入業務資料。
- 待使用者處理：Railway api／web 斷開 GitHub source（否則 migration 不等 CI 就套到正式 DB）；Postgres PITR 是否開啟。

## 2026-09-24 拍立得 F「第一張翻開進場」（main CI 部署）

- 使用者選定 F 後要求提交並部署。feature 提交 `9df9008`（feat；`README.md` 只暫存自己那段，別的 session 未提交的 Google OAuth 段落沒帶）、`2315a5b`（比稿頁）、`0574fce`（快照）。部署前在 main 的 build 實測，發現「自己翻開途中被點會原路翻回背面」，補 `dc8dd79`（fix，途中點擊不算、讓它翻完）。
- 建 deploy worktree 與 cherry-pick 被 auto 模式判為正式部署擋下，由使用者執行：`/private/tmp/ivy-website-flip-opener-20260924`（`origin/main` `912da33`，等於線上 `base_commit`）cherry-pick 為 `a88e936`、`7dd7207`，無衝突，改動行與原 commit 逐行相同。main 比 feature 多 `paper-budget.ts`（手機 WebGL 名額）與顯影預畫格；F 的狀態留在 DOM，重新掛載由 `flipped`／`developed` 接手，實測相容。
- worktree 內 Node 22 `nuxt typecheck` 0 錯誤、`vitest` 30 檔 222 項、`nuxt build` 通過；本機 `.output`（fixture）以 `output/playwright/flip-opener-20260924/check.cjs` 跑桌機 WebGL／強制 CSS／手機／減少動態／工作階段／錨點，另以 `midtap.cjs` 驗翻開途中點擊。
- `push ...:main`（`912da33..7dd7207`）由使用者執行。CI run `36006127423` 全綠（含 deploy job）。`/release.json` snapshot `95a762aa9d0dcfa542c128105d2b707df60a07fb90c80f13e9b6c69bafd77c6a`、`base_commit` `7dd7207`、`created_at` 2026-09-24T13:35:33Z。
- 線上 Playwright（`output/playwright/flip-opener-prod-20260924/`）：
  - 桌機 WebGL：載入後第一張背面朝上、第二張不受影響；只露出約 20% 不翻；置中 700ms 仍是背面，之後翻開並顯影；同工作階段重新整理直接正面。
  - 強制 CSS 版約 0.79 秒翻開；手機 390 背面→照片、無橫向溢出。
  - 減少動態停在背面、點擊切換；讀者先點停在照片；翻開途中點擊（WebGL／CSS）翻完停在照片，之後再點照常翻面；`#day-hello` 直達維持正面。
  - 0 page error。Safari／iOS 實機未驗證。

## 2026-09-25 全部分支併入 main（ops-hardening／admin-gaps、website-admin、auto-migrate；main CI 部署）

- 使用者要求把所有分支併進 main 並直接 push。整合分支 `merge/all-branches-20260925`（base `d4fcce4`）依序合併 `feature/ops-hardening-20260924`（＝`feature/admin-gaps-20260925`）、`feature/website-admin`、`deploy/auto-migrate-20260924`。其餘分支已在 main 或已被取代（`deploy/flip-wind-corner-20260923`、遠端舊版 `deploy/campus-tab-colour-20260923`、本機 `main` 的 `03fc267`＝main `8cdf785`、`merge-attempt1-84de061`）；`origin/renovate/configure` 刻意不併。
- 合併後才出現的問題：`7f0680b2eb47` 改接 `d41e6c2a9f58`（否則雙 head）；LINE 登入仍呼叫舊同步限流 → `9277209`；admin LINE 通知頁測試缺 `line_linked` → `2d21833`。本機獨立測試庫 backend 493 passed、admin typecheck／127 tests／build、`contract:check`、deploy tests 15 項通過。
- 第一次 push `d4fcce4..acc687a`：CI run `36070711409` backend 失敗、deploy skipped。原因是既有時區問題：`test_dashboard_lists_today_visits_and_draft_kinds` 用 `date.today()`，服務用台北 `today_local()`，UTC 16–24 點跑必紅。Railway 沒有原生部署（api／web 最新部署仍是 09-24 22:05），正式站未受影響。
- 修正 `0d503cd`（`TZ=UTC` 重現後修，全套 493 passed），push `acc687a..0d503cd`。CI run `36072004265` 四個 job 全綠。api `bdda2150` log：`Running upgrade d41e6c2a9f58 -> 7f0680b2eb47`、`7f0680b2eb47 -> 9b2b0ebc14ae`、`Database schema ready: 9b2b0ebc14ae`，啟動後 4 分鐘內無 ERROR；web `d1d96f2b` SUCCESS。`/release.json` snapshot `2bbf77e1ddb418a77b7f560a5e5fb2b1435b0ac1fd8e15119e750b47d1b9788f`、`base_commit` `0d503cd`、`web+api`。
- 公開 GET `/`、`/api/website/v1/health`、`/api/public-site`、`/campuses/yihua`、`/campuses/renwu`、`/visit/yihua`、`/admission`、`/admin/login` 皆 200。未做瀏覽器檢查、未登入後台、未寫入業務資料。
- 這次 push 沒觸發 Railway 原生部署，看起來 GitHub source 已斷開，但沒進 Railway 設定頁確認。未檢查正式站是否已設定新功能的選用變數（`WEBSITE_LINE_MESSAGING_*`、`WEBSITE_MEDIA_STORAGE`／`WEBSITE_S3_*`）；定期工作在 production 預設每 60 秒執行。

## 2026-09-25 官網後台缺口補齊併入 main（main CI 部署，含 9 支 migration）

- 合併提交 `a07c852`：`5baeb3a`（main）＋`feature/admin-gaps-20260925` 到 `84e9c41`（27 個 commit）。內容有接待人員處理案件、後台改期、家長管理連結、案件歷程、同意說明版本與參觀人數、寄送失敗重寄與提醒、發布紀錄與整站還原、消息／FAQ 結構化、主選單與頁尾、素材引用／替換／封存／版位焦點。衝突在 `SiteHeader.vue`、`usePageSeo.ts`、`test_operations.py`；另把後台預設主選單、頁尾連結與 `media-slots` 基準快照同步成 main 的「頁首只留常春藤環境、入學資訊」。
- 部署前驗證：同一提交推 `feature/merge-admin-gaps-20260925` 跑 CI run `36149629447` 全綠（backend pytest 720 passed、schema guard、contract check；web 301 項、admin 前端），deploy job 依設計略過。本機 web／admin 單元測試、typecheck、`contract:check` 通過；alembic 單一 head `c4d8e2f6a913`。
- migration：正式庫 `9b2b0ebc14ae` → `c4d8e2f6a913`，共 9 支，含改寫既有資料（發布正式同意文字、`review_status` 回填、分校管理者補授 `booking.export`、outbox `skipped`→`sent`、`media_usages` 重建）。依 `CICD.md` 先備份：`/var/lib/postgresql/data/ivy-website-backups/pre-admin-gaps-20260925.dump`（custom format、`pg_restore --list` 通過），SHA-256 `ad3d80b4e552b09dc43ab69b9edc24532efe5140c19437a15e588e81e671d0f4`，留在 Postgres 服務內、未下載個資。
- 備份、`push a07c852:main`（`5baeb3a..a07c852`）與查 CI 都被 auto 模式擋下，由使用者執行。使用者以 `gh run watch` 看到的 main run `36154984701` 全綠，含 deploy job「Deploy API then web, verify release」；這個 run 對應哪個 commit 沒有另外核對（之後別的 session 在 `a07c852` 上推了 `8be201d`…`709f871`）。
- 未驗證：部署後正式庫實際的 alembic 版本、後台新頁面的線上操作、Safari／iOS。`feature/admin-gaps-20260925` 在 `84e9c41` 之後的提交（成效統計與收錄開關 `dc2b69a`、`54af17d`、`c5e1b24`，以及在途的樂觀鎖）尚未上線，之後合併時同樣要先備份。

## 2026-09-25 手機活動影片換義華 YouTube、各校 IG／YouTube 進後台（main CI 部署）

- 使用者要求 push 上 main。feature 分支 `feature/social-films-20260925`（從 `5baeb3a` 開）三個提交；push 前 `origin/main` 已到 `a07c852`（admin-gaps 合併，含後台活動影片清單、素材版位、地圖連結），所以從 `a07c852` 開 `deploy/social-films-20260925` cherry-pick：
  - `8be201d` 活動影片。`campusFilms.ts` 檔頭註解衝突，兩邊都留，內建清單改成「後台沒設定時的預設」。
  - `dfa4cd4` IG／YouTube。`schemas.py`、`types.ts`、`CampusProfileView.vue`、`content-overlay.ts` 衝突，main 新增的 `map_url`、封面、線稿欄位都保留，IG／YouTube 接在後面，`content-overlay.ts` 的 `...campusMedia()` 維持在最後。後台測試改用 `testUser()`，因為 main 的權限模型下原本的寫法是唯讀。
  - `17d9b40` 文件，無衝突。
  - 另補 `709f871`：main 的 `media-slots.spec.ts` 比對基準裡義華 IG／YouTube 是 null，更新這兩欄，其他欄位不變。
- deploy 分支本機驗證：
  - backend 727 項通過（`ivy_website_social_test` migrate 到 `c4d8e2f6a913`）。
  - web `nuxt typecheck` 結束碼 0、vitest 36 檔 304 項。
  - admin `vue-tsc` 結束碼 0、vitest 33 檔 264 項。
  - `contract:check` 一致。
  - e2e `home-films`、`campus-board-socials` 在 1440／390 共 3 項通過、1 項桌機跳過。
- `push deploy/social-films-20260925:main`（`a07c852..709f871`）。CI run `36154984701` 四個 job 全綠（含 deploy）。`/release.json` snapshot `cbdc204ad6e9693de7e3d0d88a9916e8680da2446441b75d6fbc3202c7b1ac57`、`base_commit` `709f871`、`created_at` 2026-09-25T15:44:54Z。
- 部署前後正式站 `home_news.films` 都沒設定，所以活動影片走內建清單；義華 `campus_profile` 還是舊版本，沒有 `instagram` 欄位，所以沿用 fixture。
- 線上 Playwright（`output/playwright/social-films-prod-20260925/`、`campus-board-socials-prod-20260925/`）：
  - 手機 390：5 個圓點，4 張海報都載入。點「迎財神」播放鍵後 iframe 留在原位，YouTube 播放器載入影片、沒有「無法播放」；點左右兩側會翻頁。
  - 選單：義華 IG／FB／YouTube／LINE 四個都是連結，明華都是待提供。
  - 五校卡：1440／1024 排一行、390 排兩行，義華四個連結、明華兩個，無橫向溢出，0 console error。
  - 桌機不下載活動影片海報。
- **未做**：後台還沒把義華 IG／YouTube 填進去發布，要由使用者在「五校介紹 → 義華校」完成；原因見 README 同日段落。iOS 實機播放 YouTube 未驗證。

## 2026-09-26 特色教學頁、四校校園探索實景、義華家長分享、內頁 hero 手機 sizes（main CI 部署）

- 使用者要求一起 commit 並 push 上 main。分支 `feature/old-site-content-20260926`，從 `0cdd29a` 開的 sparse worktree（跳過 design/、versions/，見本機磁碟空間問題）。共 4 個提交：
  - `a9c8595` 午夜不穩定測試
  - `fd3428f` 舊官網內容
  - `b1ffc62` hero sizes
  - `f487409` 文件
- `responsive-image.ts`、`usePageSeo.ts`、`CurriculumContent.vue` 同時含第 2、3 個提交的改動，第 2 個提交暫用不含 `pageHeroImage` 的中間版本，每個提交都是可運作的狀態。
- push 前 `origin/main` 仍是 `0cdd29a`，直接 fast-forward（`0cdd29a..f487409`）。沒有 migration。
- 本機驗證（同一份內容）：
  - web：`nuxt typecheck` 結束碼 0、vitest 39 檔 351 項。
  - admin：`vue-tsc` 結束碼 0、vitest 33 檔 264 項。
  - backend：`test_visit_details`、`test_content_initialize` 24 項。
  - `contract:check` 一致。
  - e2e `old-site-content` 在 1440／390 通過。
- CI run `36200909343` 四個 job 全綠（含 deploy）。`/release.json` snapshot `8d03b6a92c14d1f504de22f76272b1256783584520f81a5a999d67cf645152be`、`base_commit` `f487409`、`created_at` 2026-09-25T23:37:25Z。
- 線上 Playwright（`output/playwright/old-site-content-prod-20260926/`）：
  - `/curriculum` 在 1440／1024／390 回應 200：4 個年段、7 個課程方向、5 張拍立得，無破圖、無橫向捲動，桌機選單三項。
  - 明華 2 個、崇德 3 個、國際 3 個、仁武 3 個場景，沒有模板提示，照片捲到畫面內都載入成功（延遲載入）。
  - 義華：4 支家長分享，點了之後 YouTube 播放器在正式網域開始播放；其他四校沒有家長分享段落。
  - 手機 390@2 的三頁 hero：入學選到 `1080w`、環境 `1960w`、特色教學 `2000w`；`<img>` 與預載的 imagesizes 一致，每頁只下載一張首屏圖。
  - 0 console error。
- **未做**：
  - 義華的新場景（花花世界、藝術走廊）要由園方在後台加，見 `docs/website-admin/handoff-yihua-tour-20260926.md`。
  - 上一批要在後台補義華 IG／YouTube 的步驟仍待處理。
  - 線上 Lighthouse 未量：hero 手機首屏圖變大，LCP 影響待確認。
  - Safari／iOS 實機未驗證。

## 2026-09-27 09-25／09-26 在途分支全部併入 main（main CI 部署）

- 使用者要求把適合的分支併入 main。整合分支 `merge/all-branches-20260927`（base `443f53b`）依序合併 `feature/news-page-20260926`（含 `feature/about-page-20260926`）、`feature/home-effects-20260926`、`feature/visit-calendar-20260926`、`fix/media-publish-races-20260926`、`fix/slot-rule-sync-20260926`、`perf/mobile-scroll-20260925`、兩筆漏記的部署紀錄（`docs/deploy-admin-gaps-20260925`、`merge/all-branches-20260925`，依時間插入本檔 09-25 段落）與 `origin/claude/website-storytelling-bilingual-design-uda0iw`（只加 `design/storytelling-a-mockup-20260925/`）。衝突只在 README／DESIGN／本檔的日期段落，保留雙方。都沒有 migration，不需先備份正式 DB。
- 不併：同標題已在 main 的 `deploy/flip-wind-corner-20260923`、`feature/social-films-20260925`、遠端 `deploy/campus-tab-colour-20260923`、本機 `main` 的 `03fc267`；`feature/admin-seo-analytics-retention-20260925`（收錄開關已由 main 的 `crawlerIndexable` 取代，wip 提交自註不合併）；`merge-attempt1-84de061`；`origin/renovate/configure`（FastAPI 釘版）。
- 本機驗證（Node 22）：web typecheck 0 錯、vitest 51 檔 446 項；admin typecheck、vitest 37 檔 338 項；backend 獨立測試庫 820 passed＋下列 2 項；`contract:check` 通過；alembic 單一 head `de61f57ec77d`。
- 第一次 push `443f53b..f05c702`：CI run `36280067098` backend 2 failed（`test_audit_coverage.py` 的 `create_app()` 沒帶設定、CI 的 pytest 步驟不注入 `WEBSITE_*`），deploy skipped。這是 main 自 `443f53b`（run `36245308691`）起就存在的問題，不是合併造成。
- 修正 `0f79741`（測試改傳入測試設定），push `f05c702..0f79741`。CI run `36280309154` 五個 job 全綠含 deploy，部署 job 公開 smoke 通過。`/release.json` snapshot `9d748148d780ba3baba19bf00622ae830e4141e39c0ed9fe94ab9d9da48b5858`、`base_commit` `0f79741`、`web+api`、`created_at` 2026-09-27T00:07:22Z。
- 部署後 GET `/`、`/about`、`/news`、`/admission`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health` 皆 200。未做瀏覽器畫面檢查、未登入後台、未寫入業務資料；Safari／iOS 未驗證。

## 2026-09-27 後台常春藤徽章 logo、登入頁改版、狀態色對比部署

- 使用者要求合進 main 並上線。分支 `feature/admin-ui-20260927`，從 origin/main `0f79741` 開 sparse worktree，1 個提交 `e4dd4e0`；push 前 `origin/main` 仍是 `0f79741`，直接 fast-forward（`0f79741..e4dd4e0`，由使用者執行 push）。只改 `admin/`、README、stack 畫面基準；沒有 migration、沒有 API 或契約變更。
- 內容：後台 logo（登入頁、側欄、favicon、apple-touch-icon）改用 IVY KIDS 城堡徽章；登入頁比照園務系統版型、標題「官網後台登入」、欄位錯誤顯示在欄位下方；側欄品牌列連回角色起始頁；手機選單鈕改三條線；Element Plus error／success／info 與 warning toast 對齊深色 token。細節見 README 2026-09-27。
- 本機驗證：admin `vue-tsc` 通過、vitest 37 檔 340 項；stack e2e 56 項 55 過，`media.spec.ts` 整套跑失敗、單獨跑通過（失敗在 `home_about` 內容資料，不在這次改的畫面）；5 張後台畫面基準在 macOS 重拍。
- CI run `36329989829` 五個 job 全綠（Backend、web、admin、E2E、Deploy Railway production）。`/release.json` snapshot `ca819fb0efc6ecf4050b22b424e5f96b92ff9db93a2922b0717845eb42086782`、`base_commit` `e4dd4e0`、`created_at` 2026-09-27T15:48:01Z。
- 線上核對：`/admin/favicon-32.png`、`favicon-48.png`、`apple-touch-icon.png` 200 image/png，index 的 icon 連結已換；admin bundle 引用 `ivy-crest-Ci3w_GGc.webp`、`ivy-crest-mark-BJKUxDOr.webp`。Playwright 開正式站 `/admin/login`（1440、390@2）：標題「登入｜常春藤官網後台」、h1「官網後台登入」、徽章載入（naturalWidth 714）、輸入 `admin` 送出顯示欄位下方的 Email 格式提示、無水平溢出、0 console error。
- **未做**：沒有登入正式站，所以登入後的側欄徽章、抽屜與 toast 顏色只在本機與 CI 驗證；Safari／iOS 實機未驗證。

## 2026-09-28 09-27／09-28 完成分支全部併入 main（main CI 部署）

- 使用者要求把已完成的分支併入 main。整合分支 `merge/all-branches-20260928`（base `2abf4ec`）依序合併 `merge/all-branches-20260927`（09-27 合併的部署紀錄，當時沒推上 main）、`feature/home-ux-20260927`、`feature/mobile-ux-20260927`、`feature/curriculum-watercolor-20260928`、`feature/environment-gsap-20260928`（含 `feature/environment-rough-20260928`）。
- 衝突：README／DESIGN／本檔的日期段落保留雙方；`styles.css` 手機 UX 的 `@media` 與特色教學換頁 keyframes 兩段都留；`usePageSeo.ts`、`responsive-image.ts`、`page-hero.spec.ts` 兩邊各自把自己的頁面移出 `pageHeroImage`，合併後環境頁用 `environmentHeroImage()`、特色教學用 `CURRICULUM_HERO_SIZES`，只剩入學與關於走 `pageHeroImage`。另加 `c2feee4`：`watercolor.ts` 與 `rough-sketch.ts` 都匯出 `Box`，Nuxt 自動匯入撞名，水彩那支改名 `WashBox`。
- 不併：同標題已在 main 的 `deploy/flip-wind-corner-20260923`、`feature/social-films-20260925`、遠端 `deploy/campus-tab-colour-20260923`、本機 `main` 的 `03fc267`；`feature/admin-seo-analytics-retention-20260925`（已由 main 取代）；`merge-attempt1-84de061`；`origin/renovate/configure`（FastAPI 釘版）；未提交的 `feature/entrance-sound-20260927`、`feature/admission-ux-20260928`。沒動 backend／admin／contracts、沒有 migration，不需先備份正式 DB。
- 本機驗證（Node 22）：web typecheck 0 錯、vitest 53 檔 502 項；`npm run build` 通過（唯一警告是 main 既有的 `studio.css:405` postcss）。fixture production build 以 Playwright 量 1440／390 七頁皆 200、零 console 錯誤與警告，特色教學與環境頁 `<img sizes>` 與預載一致，環境頁腳印桌機 54、手機 59，從環境頁點頁首連結進特色教學有暈開（`startViewTransition` 1 次）。
- push `2abf4ec..c2feee4`：CI run `36361960741` 五個 job 全綠（Backend、web、admin、E2E、Deploy Railway production）。`/release.json` snapshot `1f5cc05474c0ed2da7c30c8f2498b108c644bbbe2ba1eb8f999779f188cb79f8`、`base_commit` `c2feee4`、`web+api`、`created_at` 2026-09-28T00:36:21Z。
- 部署後 GET `/`、`/curriculum`、`/environment`、`/admission`、`/about`、`/news`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health` 皆 200；線上同一套 Playwright 檢查結果與本機相同（零錯誤、sizes 一致、腳印 54／59、換頁暈開 1 次）。未登入後台、未寫入業務資料；Safari／iOS 實機未驗證。

## 2026-09-29 入學資訊頁「入學護照」部署（main CI 部署）

- 使用者要求 commit 後部署。分支 `feature/admission-passport-20260928`（base `5263d0e`），提交 `c0ebf87`（改版前快照）、`64c3d87`（入學護照）。只動 `web/`（`AdmissionContent.vue` 重寫、`PassportStamp.vue`、`guilloche.ts`、`passport-stamp.ts`、`admission-motion.ts`、`admission-passport.css`、`tokens.css` 第 14 節、明體分片 `web/public/assets/fonts/admission/` 3.4MB）與兩支字型腳本；沒動 backend／admin／contracts、沒有 migration，不需先備份正式 DB。舊的未提交分支 `feature/admission-ux-20260928`（A 成長軌道版）已被這次取代，沒有併。
- 本機驗證（Node 22）：web typecheck 0 錯、無 Duplicated imports 警告；vitest 55 檔 528 項；`npm run build` 通過（唯一警告是 main 既有的 `studio.css` postcss），入學頁 chunk 10.6KB（gzip），gsap（27KB）另一支，只在沒開減少動態時 `import()`。
- push `5263d0e..64c3d87`（fast-forward）：CI run `36502355312` 五個 job 全綠（Backend、web、admin、E2E、Deploy Railway production）。`/release.json` snapshot `2ca8c45829f913958a6e8b1d79a63c13bf2aa98bf45d10e2516fc5d195b3b9b6`、`base_commit` `64c3d87`、`web+api`、`created_at` 2026-09-29T00:30:45Z；push 到上線約 17 分鐘。
- 部署後 GET `/`、`/curriculum`、`/environment`、`/admission`、`/about`、`/news`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health` 皆 200；明體 critical 分片 `serif-600`（56,780 B）、`serif-900`（54,472 B）皆 200。線上 Playwright 1440／390：hero 照片挑 800w（顯示 483／304px）、六格簽證章捲到後都蓋上、2022/3/15 → 115 學年度中班（大章、「寶貝」小章、出生區間標示正確）、2025/5/1 → 116 學年度幼幼班、勾兩項蓋兩枚「已備」、明體 600／900 載入、`main` 文字對比全數達標、無水平溢出、零 console 錯誤與警告；減少動態時章一載入就在紙上；關掉 JS 時標題、6 步、5 條退費、3 張補助券、對照表都在。未登入後台、未寫入業務資料；Safari／iOS 實機、螢幕報讀器未驗證。

## 2026-09-29 系統設計審查第一批修正部署（PR #14，main CI 部署）

- 使用者要求併入 main。PR #14（`claude/system-design-review-rdqjzh`：`10f823b` 修正、`01a08d8` 合併 main、`16dc7ce` E2E 時段測試）以 merge commit `6d690b7` 併入；當時 `origin/main` 是 `144c2ff`，與 PR 最後一次 CI 的 base 相同，merge commit 的樹與 `16dc7ce` 完全相同。改動在 backend／web／admin／contracts／tests（內容見 README 2026-09-29）；沒有 migration，不需先備份正式 DB。
- PR CI run `36512418073` 四個 job 全綠。合併後 main CI run `36514823871` 第一次 backend 失敗：`test_traffic.py::test_rate_limited_per_source` 預期 429 得到 204，deploy skipped，正式站沒動。原因是限流的固定窗口加權近似加上測試用真實時鐘：121 次請求跨過整分鐘時，前一窗次數被打折而放行（本機以可控時鐘重現：同窗第 121 次 429、跨窗第 121 次 204），與這次改動無關。merge commit 程式碼與 PR 上全綠的 `16dc7ce` 相同，所以重跑失敗 job 一次（attempt 2），五個 job 全綠含 Deploy Railway production。測試本身的修正（五支數到上限的測試改用凍結時鐘）另開後續 PR。
- `/release.json` snapshot `180140f77de9e4081e886dd772b5cf91ea5d81a2005c8025bc103d7fdc14ff8a`、`base_commit` `6d690b7`、`web+api`、`created_at` 2026-09-29T03:33:06Z。
- 部署期間約每 4 秒打一次 `/`：03:34:08 前後（api 換容器）有一次請求 10 秒逾時，其餘全部 200；web 換版時 `/release.json` 有一次讀不到、`/` 仍 200；03:36:02 起為新版。這次沒有 migration，api 起得快；比取樣間隔短的中斷量不到。
- 部署後 GET `/`、`/about`、`/curriculum`、`/environment`、`/admission`、`/news`、`/campuses/yihua`、`/campuses/renwu`、`/visit/yihua`、`/api/public-site`、`/admin/login`、`/sitemap.xml`、`/robots.txt` 皆 200。`/api/website/v1/health` 多了 `last_clean_at`、`last_failed_steps`（部署後第一輪定期工作為空陣列）。同源代理跳出前綴：`/api/website/v1/%2e%2e/%2e%2e/%2e%2e/openapi.json`（未編碼的 `../` 亦同）部署前 200 回完整 OpenAPI，部署後 404。
- **未做**：沒有登入後台、沒有在正式站寫入業務資料（送單、點擊、上傳都沒試），所以限流獨立連線池、LINE／email 分開重試、發布樂觀鎖、EXIF 清理只在本機與 CI 驗證。正式 DB 的 PITR／排程備份與素材備份仍待使用者在 Railway 處理。

## 2026-09-29 官網後台全面盤點與修正部署（PR #15，main CI 部署）

- 使用者要求處理完併入 main。PR #15（`claude/backend-ui-ux-optimization-y5ndf4` → main），合併提交 `4c47c45`。改動是 `admin/` 9 區 UI/UX 修正與路由分塊、後端 `booking/service.py` 的 `get_or_create_config` 併發修正（`INSERT … ON CONFLICT DO NOTHING`）、三支 `tests/stack` 的預期與文件；沒有 migration、沒有 API／契約變動、不改寫既有資料，不需先備份正式 DB。盤點與改動細節見 `docs/analysis/2026-09-28-admin-uiux-audit.md`、README 2026-09-28／29 段落。
- PR 開之前 main 進了 PR #14（發布樂觀鎖），已併進分支並把兩個斷言補上 `expected_published_revision_id`；PR CI（Frontend admin／web、Backend、E2E）四個 job 全綠。
- main CI run `36517969412` 五個 job 全綠（含 Deploy Railway production，03:52:09–03:55:13）。`/release.json` snapshot `ec0eb4cac6ff0d534e26ace479d80602cb0c3a1fc553d04856bc20a876cf9da7`、`base_commit` `4c47c45`、`web+api`、`created_at` 2026-09-29T03:52:09Z；合併到上線約 18 分鐘。PR #16（`4193292`）的 main run 接在後面（concurrency 在 main 不取消，排隊執行）。
- 部署後（唯讀、未登入）GET `/`、`/about`、`/admission`、`/news`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health` 皆 200；後台入口 `index-BBJbRF_K.js` 239,085 B（原本單一 JS 約 1.6 MB），入口引用的 30 個頁面分塊逐一 GET 皆 200。
- **未做**：沒有登入後台、沒有在正式站寫入資料；本容器的 Chromium 不信任出口代理的憑證，沒有關掉 TLS 驗證硬跑，所以正式站畫面沒有在瀏覽器裡看過（同一份 build 在 CI 的 E2E 以 Google Chrome 全過）。Safari／iOS 實機未驗證。
- **上線後請園方做一次**：校園探索的後台畫布改成和官網相同的 8:5 整張顯示，舊熱點在官網上的位置不變，但後台現在看到的才是官網實際位置；請各校打開「校園探索」複核熱點，偏掉的拖回去再發布。

## 2026-09-29 首頁水彩：五校淡彩速寫＋孩子的一天→五校水彩滲接部署（main CI 部署）

- 使用者要求 commit 並推到 main。分支 `feature/home-watercolor-20260929`（rebase 到 `4193292`），提交 `d9ce738`（改版前快照）、`68dea6c`（首頁水彩）。只動 `web/`（`CampusBoard.vue`、`DayExperience.vue`、`useCurtain.ts`、`watercolor.ts`、`studio.css`，新增 `campusSketch.ts`、`useWatercolorSeep.ts`、`tests/home-watercolor.spec.ts`）與 DESIGN／README；沒動 backend／admin／contracts、沒有 migration，不需先備份正式 DB。
- 本機驗證（Node 22、fixture）：web typecheck 0 錯、無 Duplicated imports 警告；vitest 56 檔 547 項；`npm run build` 通過（唯一警告是 main 既有的 `studio.css` postcss）。Playwright 以 Chrome＋WebKit、1440／390 在 dev 與 production server 實測兩個效果、點擊穿透、減少動態與強制色彩退回。e2e `campus-board-socials.spec.ts` 四個專案通過（第一次在 dev server 剛重啟時四個都失敗、原因未擷取，之後單一 worker 與平行各重跑一次都全過）。
- push `4193292..68dea6c`（fast-forward）。自己的 run `36519446572` 排隊時被隨後推上的 PR #17 取消（main 的 concurrency 只留一個排隊中的 run），改由 PR #17 的 run `36520215333` 部署，五個 job 全綠；`/release.json` `base_commit` `3a26a0f`、created_at 2026-09-29T04:29:09Z。之後 PR #13（手機版體驗優化，也動到 `CampusBoard.vue`／`DayExperience.vue`／`studio.css`，合併時保留了水彩程式與「畫的期間暫停輪播」）由 run `36521592972` 部署，五個 job 全綠；snapshot `6c962415c8e3f2c2140f2ff2dffa9edbf5fe05fa70cb35f17051bdb1f05bb675`、`base_commit` `576672c`、created_at 2026-09-29T04:44:43Z。
- 部署後（`576672c`，唯讀、未登入）GET `/`、`/curriculum`、`/environment`、`/admission`、`/about`、`/news`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health`、線稿 480w 與淡彩層皆 200。線上 Playwright Chrome＋WebKit 1440：水彩滲接生效、進度 40% 起已露出的五校分頁點得到（濕邊以下 clip-path 生效）、照片中央露出（進度約 80%）才開始畫、照片暈開 `mask-size` 轉場 1.7 秒後以 `transitionend` 收尾；減少動態兩者都不播；零 console 錯誤。390 手機（Chrome 模擬）：義華第一次畫完回到照片、自動輪播換明華不重播、點國際校 0.3 秒後開始畫；手機模擬下收尾走 2.6 秒的保險計時（`transitionend` 沒到，畫面在 1.7 秒已完整，只是輪播多停約 0.9 秒）。未驗：iOS／Android 實機、Firefox、螢幕報讀器。

## 2026-09-29 手機版體驗優化部署（PR #13，main CI 部署）

- 使用者要求驗證完、CI 綠了就併入 main。PR #13（`claude/mobile-experience-optimization-60rfw2`）以 merge commit `576672c` 併入；PR 最後一次 CI（head `5d1bccb`，run `36520389457`）四個 job 全綠。合併前兩度把 main 併進分支：入學護照與 PR #14–#16 無衝突；首頁水彩（`68dea6c`）與 `CampusBoard.vue` 衝突，輪播暫停條件同時保留觸控拖曳與淡彩速寫，README／DESIGN 兩邊的條目都保留。
- 只動 `web/`（另有 `scripts/optimize-site-images.py` 與五校線稿 240w 圖檔、`image-manifest.json`）；沒有 migration、沒有後端或環境變數改動。
- main CI run `36521592972` 五個 job 全綠（Deploy Railway production 04:44:43–04:47:28）。`/release.json` snapshot `6c962415c8e3f2c2140f2ff2dffa9edbf5fe05fa70cb35f17051bdb1f05bb675`、`base_commit` `576672c`、`web+api`、`created_at` 2026-09-29T04:44:43Z；04:25 合併，排在 PR #17 的 run 之後，約 22 分鐘上線。
- 部署後（唯讀、未登入，curl）GET `/`、`/about`、`/admission`、`/curriculum`、`/environment`、`/news`、`/news/garden`、`/campuses/yihua`、`/campuses/minghua`、`/campuses/renwu`、`/visit`、`/visit/yihua`、`/visit/manage`、`/admin/login`、`/sitemap.xml`、`/robots.txt`、`/api/website/v1/health` 皆 200。抽查新改動：`/campuses/minghua` 頁首預約鈕 `href="/visit/minghua"`；分校頁「查看地圖與路線」兩處；「LINE 聯絡義華校」只出現在義華，其他四校 0 筆；`/news` 示意活動顯示「日期未定」；頁面樣式含 `.menu-scrim`；`/visit` 迎賓照片的 `<source media>` 是新條件（760 以下，或 960 以下的橫拿手機）。
- **未做**：正式站畫面沒有在瀏覽器裡看（本容器的 Chromium 不信任出口代理的憑證，沒有關掉 TLS 驗證硬跑）；同一份 build 在 CI 的 E2E 全過，上線前也在本機 production build（fixture）做過桌機像素比對與手機回歸。iPhone Safari／Android 實機未驗證；沒有在正式站寫入資料。
- 待業主決定的項目（分校輪播暫停、布幕點一下結束、分校頁選單顯示當校、分頁校名字級、消息標題句號孤行、分校 hero 對比、需實機的三項）見 DESIGN.md「手機版體驗優化第二輪（2026-09-29）」。

## 2026-09-29 白箱資安稽核修正部署（`fix/security-audit-20260929`，main CI 部署）

- 使用者要求推上 main。分支先兩度併入 main（`576672c`、`cdac49e`），與 PR #14 重複的機制只留一份；以 fast-forward 推上 main。推之前用正式 api 的實際 `WEBSITE_*` 跑新的 `Settings` 驗證（值不落地、只看通過與否）：`SETTINGS_OK`（production、admin origin 為 https）。migration `e4c1a7f3b862` 只新增欄位與表，依規則未強制先備份。
- 第一次 main CI run `36559914931`（`a4b48e9`）：E2E 23 個後台測試失敗，deploy 被擋下（正式站維持 `cdac49e`）。原因是 e2e 的 `adminApi` 在 `test.use({ storageState })` 的檔案裡登入時，繼承了預存的 super_admin cookie，而本次起密碼登入會撤銷請求帶來的舊 session；修測試工具（`tests/stack/api.ts` 明寫空的 storageState，`4cc93c2`），正式行為不變。
- 第二次 run `36562527040`（`4cc93c2`）：E2E 全過，後端 1 個併發測試失敗（1000 passed）。是真實的競態：同一把 Idempotency-Key 的重送在不上鎖的重播查詢時錯過另一個尚未 commit 的請求，走到手機桶預檢被回 429。修正：四個上限分支擋下前再查一次重播（`d151dd1`），另加確定性回歸測試；本機併發測試連跑 25 次 0 失敗。
- 第三次 run `36565006263`（`d151dd1`）五個 job 全綠，Deploy Railway production 約 4 分鐘。`/release.json` snapshot `cdb0623824ab042a7f80d20e37007730507031d17c2c58af4f49a9114ed32fb7`、`base_commit` `d151dd1`、`web+api`、`created_at` 2026-09-29T12:16:49Z。push 後到 CI 失敗期間正式站一直是 `cdac49e`，可見 Railway 沒有在 push 當下原生部署（部署前第 3 點成立）。
- 部署後（唯讀、未登入）：`/api/website/v1/health` 200、`background_jobs` 正常；`/admin/`、`/admin/login` 帶嚴格 CSP（`script-src 'self'`）、`X-Frame-Options: SAMEORIGIN`、`nosniff`、`no-store`；Playwright（Chrome）載入 `/admin/login` 桌機與手機 0 筆 CSP 違規、登入表單正常；代理 `/api/website/v1/%2e%2e/…/openapi.json`、`/public/..%2f..%2fhealth`、`/public/telemetry` 皆 404；`/assets/day-film-mobile.mp4` Range 回 206；`/public/booking-config/yihua` 的 `turnstile_site_key` 為 null（未設 key，表單不變）。
- **未做（見上方「2026-09-29 資安稽核修正」的部署後步驟）**：既有素材 `strip-media-metadata`（需先備份，本人以 `railway ssh` 執行）、Turnstile key、各校 LINE 群組貼驗證碼、告知同仁新規則、DB 角色拆分與 PITR；正式站沒有登入或寫入資料，iOS Safari 與 Google／LINE 登入往返未在正式站實測。


## 2026-09-30 已完成分支併入 main 部署（`merge/branches-20260930`，main CI 部署）

- 使用者要求把已完成的分支併入 main。併入 `feature/sketch-preview-20260929`、`claude/backend-ui-ux-optimization-y5ndf4`（PR #17 之後 16 個提交）、`feature/ux-admin-20260929`，取捨見 README 2026-09-30 段落。以 fast-forward 推上 main（`f11e87c..7861fc6`）。migration `e9c3a7d5f214` 只新增可為 NULL 的 `users.display_name`、不回填，改接 main head `e4c1a7f3b862`；依規則未強制先備份。
- 推之前本機跑過：admin typecheck／vitest 679 項、web typecheck／663 項、backend pytest 1029 項＋schema guard、contract:check、admin／web build、stack e2e 56 項。
- 第一次 main CI run `36654096211`（`7861fc6`）：後端 1 個測試失敗（1028 passed），deploy 被跳過，正式站維持 `f11e87c`。`test_queued_burst_cannot_outrun_the_lock` 驗了 11 次（上限 10）：限流的固定窗口加權在一批請求跨過 5 分鐘交界時會多放行一次，以跨交界時鐘重現得到 11 次；測試時機問題，不是這次合併造成。比照 PR #16，`test_secfix_auth.py` 改用凍結的限流時鐘（`2dfd269`）。正式行為不變：跨交界時最多多驗一次，之後帳號鎖照常生效。
- 第二次 run `36655799635`（`2dfd269`）五個 job 全綠。`/release.json` snapshot `f94eb90c8db59b7ad3deb13069bf0825aaca43a0e515a90f6162610033bf68ca`、`base_commit` `2dfd269`、`created_at` 2026-09-30T01:54:26Z。
- 部署後（唯讀、未登入）：`/api/website/v1/health` 200、`background_jobs` 正常、`last_failed_steps` 空；`/`、`/campuses/yihua`、`/admin/`、`/admin/login` 皆 200；分校頁有預約橫幅（`data-cta-entry="campus_banner"`）。正式站沒有登入後台或寫入資料，顯示名稱、頁首未讀連結、下一筆跟著列表走等後台功能未在正式站實測。

## 2026-09-30 義華外觀照 v2（`feature/yihua-photo-20260930`，main CI 部署）

- 使用者要求提交並推上 main。分支從 `f11e87c` 開，`merge/branches-20260930` 先上了 main，rebase 兩次（README 頂部衝突，兩段都保留；`campusSketch.ts` 自動合併，只有對位表那一行）後 fast-forward 推上：`242b9b0..8f2253c`（`610ed57` 快照、`8f2253c` feat）。沒有 migration、沒有後端程式改動。
- 第一次 run `36657936746`（`8f2253c`）：後端 2 個測試失敗（1027 passed），deploy 被跳過，正式站維持 `242b9b0`。`site_import` 讀 web 的 `site-fixture.json`，`test_media_slots.py` 寫死義華舊焦點 50/12、85/8；改成 50/36、85/16（`46379ee`），本機專用測試庫 `test_media_slots.py` 19 passed，並補跑 CI 沒跑到的 `deploy/tests`（20 OK）與 `contract:check`。
- 第二次 run `36660936323`（`46379ee`）五個 job 全綠，Deploy Railway production 02:57:45–03:01:46 UTC。`/release.json` snapshot `b9fc3603d8534533eb46d3dafae6a5b655bde9a10ea78172855f7bd9f1f551b0`、`base_commit` `46379ee`、`web+api`、`created_at` 2026-09-30T02:58:07Z。
- 部署後（唯讀、未登入）：`/`、`/campuses/yihua`、`/api/website/v1/health`、`/assets/yihua-exterior-v2.webp`、`/assets/og/yihua-exterior-v2.jpg`、2400w 衍生檔皆 200。Playwright（Chrome）1440（DPR2）／1920／390：首頁義華卡 `center 36%`、分校頁封面 `85% 16%`、`og:image` 為 `yihua-exterior-v2.jpg`，選到的衍生檔依序 2400／1600／1200（封面 2820／2000／1200），0 page error；畫面從塔尖露到遊具與草地。正式站用的是 fixture 內建封面，後台沒有已發布的義華封面或焦點覆寫。
- **未做**：Safari／iOS／Android 實機；後台素材庫若有 `import-site-assets --write-drafts` 產生的舊義華草稿（`enhanced-v1`、焦點 50/12），發布會蓋回舊圖，未查正式 DB。

## 2026-09-30 參觀報名兩輪 E2E 修正（`fix/visit-e2e-20260930`，main CI 部署）

- 使用者要求上線。分支從 origin/main 開，rebase 兩次（README 頂部衝突，兩段都保留）後 fast-forward 推上：`96e3f02..b74f525`（`5998ffc` 同意框／送出第一次點擊落空、`b74f525` 家長管理頁多分頁錯筆＋同 key 重送誤報額滿＋截止後操作列）。沒有 migration，依 `deploy/CICD.md` 不需先備份正式 DB。
- API 相容：CD 先部署 API 再部署 web。家長取消／改期的 `visit_request_id` 做成選填（有帶才比對），部署前開著的舊版家長頁與 web 上線前的空窗照常可用。
- 推送前本機驗證：backend pytest 1034 項全過；web typecheck、vitest 64 檔 663 項；admin typecheck、vitest 49 檔 679 項；`contract:check`；production build 的 stack e2e 61 項全過。
- run `36664641812`（`b74f525`）五個 job 全綠，Deploy Railway production 03:48:52–03:52:14 UTC。`/release.json` snapshot `03c857670339f4ac38c2913f985a57e29d2e05ec937330a39f5936c223f6d1f3`、`base_commit` `b74f525`、`web+api`、`created_at` 2026-09-30T03:49:14Z。
- 部署後（唯讀、未登入）：`/api/website/v1/health` 200、`background_jobs` 正常、`last_failed_steps` 空；`/`、`/visit/minghua`、`/visit/manage`、`/admin/login` 皆 200；正式站 `/visit/manage` 與 `/visit/minghua` 引用的 JS 含 `PARENT_SESSION_CHANGED`、多分頁提示文字、`visit_request_id` 與同意框的 `contextmenu` 釋放處理，確認是新版前端。
- **未做**：Safari／iOS 實機；正式站沒有送出預約、沒有開家長管理連結，多分頁與截止情境只在本機 stack 驗過。

## 2026-09-30 首屏「新發現」金色乾刷色塊（`feature/hero-brush-20260930`，main CI 部署；部署後驗證逾時）

- 使用者要求上線。分支從 origin/main `0a00625` 開，fast-forward 推上 `0a00625..7a9a1f2`（`37422e1` 改版前快照、`7a9a1f2` 首屏改版：拿掉小標與「找校區」、主標不加標點、重點詞改金色乾刷色塊）。沒有 migration、沒有 API 變更，依 `deploy/CICD.md` 不需先備份正式 DB。
- 推送前本機驗證：web typecheck（0 警告）、vitest 65 檔 668 項；admin typecheck、vitest 49 檔 679 項；production build 的 stack e2e 62 項全過（含首頁 a11y／hydration／keyboard）。後端只匯入 `home_hero` 的小標／說明／按鈕文字，主標五段不進後端，未另跑 pytest（CI 的 Backend job 已全綠）。
- run `36683022871`（`7a9a1f2`）：Backend／E2E／Frontend (web)／Frontend (admin) 四個 job 全綠；**Deploy Railway production 失敗在最後的 smoke**。API 先部署、web deployment `82299e25-053f-471a-be63-39b3e2b406d0` 於 07:40:33 UTC 回報 SUCCESS，之後 `GET /release.json?commit=7a9a1f2…` 連續三次 30 秒讀取逾時（07:41:03–07:42:06），腳本判定失敗；沒有回滾。
- 事後查證（唯讀）：`/release.json` snapshot `4f94ccc47e70e73cf4450f63b7795e185d5aa83cc06809e9920848ead9642703`、`base_commit` `7a9a1f2`、`web+api`、`created_at` 2026-09-30T07:37:25Z，新版已在線上；Railway web 只剩 `82299e25` 一個部署（舊的都 REMOVED）。本機連打 `/`、`/release.json`、`/api/website/v1/health` 約每 10 次有 1 次卡滿 35 秒（`x-railway-edge: hkg1`），其餘 0.1–0.7 秒；`railway logs --http` 裡**沒有**這些卡住的請求（服務端最慢 98ms，只有兩筆瀏覽器取消的 499），判斷是 Railway 邊緣網路偶發未轉送，不是應用程式。web 執行 log 只有啟動訊息、沒有錯誤。
- 正式站首頁（Playwright Chrome 1440／390）：`h1` 為「在常春藤每一天都有新發現」、`.hero-key` `rotate:-2deg`、沒有小標與 `.hero-campus-link`；HTML 含 `hero-swatch`／`hero-brush`、不含 `hero-underline`。
- 這筆紀錄的 docs 提交推上後會再跑一次同內容部署，順便重跑 smoke；若邊緣偶發逾時還在，那次也可能紅燈，要再看 `railway logs --http` 分辨。
- **未做**：Safari／iOS 實機；Railway 邊緣逾時的根因（未開 Railway 支援單、未查 status 頁）。

## 2026-09-30 下午已完成分支併入 main 部署（`merge/branches-20260930b`，main CI 部署）

- 使用者要求把已完成的分支併入 main。併入 `feature/tassels-five-20260930`（開場布幕流蘇固定五顆）、`feature/height-ruler-20260930`（首頁拿掉桌機章節指示）、`feature/mobile-perf-20260930`（手機效能第三輪），取捨與沒併的分支見 README 同日段落。從 main `7189998` 合併，使用者以 fast-forward 推上 `7189998..392a41c`。沒有 migration（alembic 單一 head `e9c3a7d5f214`），依 `deploy/CICD.md` 不需先備份正式 DB。
- 推之前本機跑過：web typecheck（0 警告）／vitest 65 檔 668 項、admin typecheck／vitest 679 項、backend pytest 1037 項、contract:check、production build 的 stack e2e 61 項。
- run `36688512301` 第一次嘗試：Frontend／E2E 全綠，**Backend 在 20 分鐘 `timeout-minutes` 被取消**（pytest 跑到 83%、零失敗；這台 runner 的 pytest 約需 21 分鐘，前幾次整個 job 17–19 分鐘），Deploy 因而略過，正式站維持 `7189998`。以 `gh run rerun --failed` 重跑：第二次嘗試 Backend 16 分 19 秒通過，Deploy Railway production 09:06:16–09:11:04 UTC 成功（含 smoke）。同批另提交 `ci:` 把 Backend job 上限放寬到 30 分鐘。
- `/release.json` snapshot `ed106ef4566b8b595bbb1847c48eeb73b5c9f59d0cf40d6d732eafcbdcadb9b0`、`base_commit` `392a41c`、`web+api`、`created_at` 2026-09-30T09:06:38Z。
- 部署後（唯讀、未登入）：`/api/website/v1/health` 200、`background_jobs` 正常、`last_failed_steps` 空；`/`、`/environment`、`/about`、`/curriculum`、`/admission`、`/campuses/yihua`、`/admin/login` 皆 200。首頁 HTML 不含 `home-chapters`、流蘇海報是新版號（`entrance-poster-wide.webp?v=5184d415`，舊版號不見）、首屏 12 個 prefetch／modulepreload 都不含 three。Playwright（Chrome，1440×900 與 390×844）開 `/`、`/environment`、`/about`：零 page error、沒有章節指示；遙測請求在瀏覽器端攔下不送出（不寫正式庫），三頁分別帶 `page` `home`／`environment`／`about`，確認內頁回報已上線。
- **未做**：Safari／iOS 實機；開場流蘇數只以海報版號確認，未在正式站實跑 WebGL 開場；慢速網路下首屏留靜態封面、環境頁載入中點選單的 INP 未在正式站量測（數字見 README mobile-perf 段落，為本機 production build）。

## 2026-10-03 拿掉各校分校資訊頁（`feature/remove-campus-pages`，main CI 部署）

- main `26eb29d`（拿掉分校頁）＋`27b2fa2`（併發測試場次日期改台北日期）；部署 run 37080768171。第一次 Backend job 紅（`test_booking_concurrency` 在 UTC 跑、台北已跨日時差一天，Deploy 被跳過），改測試後 Frontend（admin）的 `ux20260928E`「刪除場景」偶發失敗，重跑失敗 job 後全綠、Deploy Railway production success。
- 未執行 migration、未寫入業務資料。
- 線上核對（唯讀）：`/`、`/about`、`/environment`、`/visit`、`/visit/yihua`、`/admin/login`、`/api/website/v1/health`、`/sitemap.xml` 皆 200；`/campuses/yihua`、`/campuses/renwu`、不存在的校區皆 301 轉 `/`；首頁 HTML 沒有 `/campuses` 連結，JSON-LD 只有 EducationalOrganization 與 WebSite。未做瀏覽器檢查。
- 後台分校簡介、常見問題、環境導覽、預約橫幅文案仍可編輯，但公開站已沒有頁面顯示。

## 家長自選場次（未部署，草稿）

`feature/parent-self-booking-20260930`：官網預約只剩自選場次、送出即預約成功。**尚未 push、尚未部署**；B–D 完成後由使用者決定何時合併上線（push main＝正式部署）。規格 `docs/specs/2026-09-30-parent-self-booking-design.md` §7。

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
