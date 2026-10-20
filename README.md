## 2026-10-20 全專案 bug 與資安掃描：11 項修正（`feature/security-audit-fixes`）

使用者要求「掃描專案的 bugs 以及資安」並全部處理。對 `95542b5` 分四路唯讀盤查（後端資安、後端正確性、web／admin、相依套件與部署）：沒有可直接利用的 Critical／High 漏洞，git 歷史（shallow，50 個 commit）沒有外洩密鑰，`pip-audit` 執行期套件 0 項。修正如下，每項都補了「修正前失敗、修正後通過」的回歸測試（切片測試只寫在後端與 web）。

- **招生**：提早到場清掉未來場次、事後才補建的招生訪視，參觀日期改用最後一筆 `completed` 歷程的台北日期，不再是補建當天（`admissions/booking_link.py`）。`tour_guide_user_id` 只接受這個校區啟用中的帳號，別校或停用帳號一律回 `TOUR_GUIDE_INVALID`，不回對方的顯示名稱（`admissions/records.py`）。
- **預約**：人工補登連點兩次、剛好搶最後一個名額時，拿到時段鎖後再查一次重播，回原收據而不是 `SLOT_FULL`（`booking/service.py`）。停課通知發連結前先鎖案件列重讀狀態，同時被家長取消的案件不再拿到新的修改連結（`booking/closure_service.py`）。
- **排程發布**：一筆排程丟出非預期例外時回滾、標成 failed（`UNEXPECTED_ERROR`，照常通知排程的人），後面到期的排程照樣發布，不會每輪卡在第一筆（`content/publish_jobs.py`）。
- **素材**：檔名超過 255 字截斷（保留副檔名），不再 500（`media/service.py`）。
- **帳號**：CSRF token 改用 `hmac.compare_digest`。用重設連結設定新密碼時，比照停權一併解除 LINE／Google 綁定，稽核多記 `line_unlinked`／`google_unlinked`（後台自己改密碼不動綁定）。
- **部署**：`deploy/api-start.py` 要求 `WEBSITE_ENVIRONMENT` 必須是 `production`（原本只檢查有沒有設，誤設 development 會少 Secure cookie、開 `/docs`）。
- **web**：分校社群連結（FB／LINE／IG／YouTube）在 overlay 套 `safeWebUrl`，即時預覽的草稿不經後端驗證，`javascript:` 不會被綁進 href。
- **相依套件**：web 以 `overrides` 拉高 `shell-quote` 1.12.0（Critical）、`source-map-js` 1.2.2、`serialize-javascript` 7.1.2；admin `npm audit fix` 後 0 項。內建 npm 10.9.4 的 `npm audit fix`／`npm update` 會在 peer set 當掉（`edgesOut`），npm 11 產生的 lockfile 又讓 npm 10 的 `npm ci` 報缺 `unplugin@3.4.0`，所以只用 npm 10 能處理的末端套件 overrides。**仍未修**：`simple-git`（Critical，`@nuxt/devtools` 3.4.2 帶進來，3.4.4 已拿掉，但升 devtools 會碰上同一個 npm 10 錯誤）、`braces`、`node-forge`（上游沒有修正版）；三者都只在 `nuxt dev`／建置時用，正式映像只複製 `.output`。
- **沒做**：公開頁 CSP 沒有 `script-src`、後台與公開站同源（`web/server/utils/security-headers.ts` 註解已記）。要改成後台與 API 換獨立子網域，或公開站改用 nonce CSP，牽涉 Railway 網域與全站 inline script，另案處理。限流信任 `x-website-client-ip`，api 服務要維持沒有公開網域。
- **驗證**（Node 22.22、npm 10.9.4、本機 PostgreSQL 16）：後端全套 **4530 passed**；新增的 7 個回歸測試在舊程式碼上都失敗。web `typecheck` 通過、`test:unit` 108 檔 1321 passed、`nuxt build` 成功；`deploy/tests` 22 passed；`contract:check` 一致（重設密碼的說明文字改了，契約重新產生）。admin `typecheck` 通過，`test:unit` 3098 passed，但 `admissionsView.test.ts` 的 (h) 偶爾超過 5 秒上限：新 lockfile 連跑三次有兩次逾時（5.09–5.2 秒）、一次全過，main 的 lockfile 跑一次全過。這項在迴圈裡掛載整個招生頁 7 次，本來就貼著上限，判斷是時間抖動、不是這次的改動；PR CI 的 admin job 是綠的。PR #49 CI 七項全綠（正式部署 skipped）。

## 2026-10-20 官網調亮第一層：孩子的一天、頁尾、膠囊、薄荷色帶（`feature/brighten-20261020`）

使用者覺得諾貝爾幼兒園官網比較明亮，看過比對與模擬後要求調亮。這次只拿掉不需要的暗面、版面不動；首屏影片調色另外上線（見同日「首屏影片調亮」一節），配色加入鮮豔色未做。規則與數字見 DESIGN.md「官網調亮第一層」。

- **孩子的一天**：整段墨綠紗減到大約一半；開場大標那一屏另疊一層補回舊的深度、跟著大標淡掉；底部說明字的帶加深補回。第一版只留上下緣，使用者覺得太亮，收回約一半。
- **頁尾**：深森林綠＋白字 → 淡綠底＋品牌深綠字。**浮動膠囊**：墨綠毛玻璃 → 米白毛玻璃＋深綠字。**薄荷色帶**提高彩度（首頁理念區、/about、預約頁）。
- **驗證**（Node 22，從 main `87ec0d95` 開發、rebase 到 `8f5a7a0c` 後重跑 web 驗證）：web `typecheck` 通過；web 全套 108 檔 1321 passed；e2e 公開站 6 支打 dev server 54 passed、8 failed（`public-site.spec.ts` 的 booking-config 與 robots/sitemap 兩項 × 4 個寬度，要後端與正式索引設定，未改動的 dev server 上同樣失敗）；背景影片上的字新版對比都不低於舊版（圖說與桌機眉標由未達變通過）；首頁平均 L* 桌機 61.3 → 69.0、手機 62.4 → 74.5。
- **已知問題（沿用舊版、只略改善）**：開場大標與手機金色眉標用最亮像素量不到門檻。

## 2026-10-20 招生潛力第二、三波：每年還能多招幾位的三個來源（`feature/admissions-potential2-20261020`）

接第一波的市佔率，「招生潛力與市佔率」分頁加上使用者要的第二個數字：**每年還能多招幾位**，拆成附近園所停辦釋出、現有的里還沒招到、新建案搬進來三個來源，各給低／中／高，旁邊寫「目前空位 N 位」，走勢圖標出 3 公里內的停辦。只看需求面、不受空位限制（使用者 10-20）；這個放寬只限本分頁。規格 `docs/specs/2026-10-20-admissions-potential-share-design.md`（§11 是第二、三波實作紀錄，含九條計畫裁定與執行期裁定的代價），計畫 `docs/superpowers/plans/2026-10-20-admissions-potential-share-wave23.md`；設計規則記在 DESIGN.md「招生統計：招生潛力與市佔率」。

- 資料：停辦回補檔換成 `kindergarten-closures-20261020.csv`（94 筆：停辦 62、改名 32，全部有離開日，窗口從 2025-06 延伸到 2022-08，多了名稱、核定、座標、類型），取代 10-15 的 47 筆檔；每輪幼兒園同步把檔裡的停辦補寫成事件（資料表沒有的園所補一列停辦），異動事件保留期 24 → 72 個月。產生腳本 `backend/scripts/build_kindergarten_closures.py` 重寫（每月樣本＋離開區間逐版掃描、`--merge`、`--cache`）。**沒有新 migration、沒有新依賴、沒有新環境變數。**
- 計算：新模組 `backend/app/admissions/potential.py`，參數全在檔頭常數、畫面「怎麼算」照列。來源一照報告 A-07 全式（核定 × 實收率 × (1 − 畢業比例) × 承接率 × 距離係數 × 價格係數）按學年窗口加總；來源二是 Poisson 距離模型加經驗貝氏收縮，區間用以里為單位的自助法；來源三是一年內交屋的在建預售案 × 每百戶孩子數 × 距離帶占有率。來源二只回距離帶彙總、不回逐里數字。
- API：`GET /admin/admissions/potential` 多回 `potential`（三個來源、總數、空位、3 公里內停辦事件），權限仍是 `admissions.stats`（只有總管理者）。後台：兩張大數字卡並排、三個來源表（區間條、可展開怎麼算）、走勢圖停辦三角形；手機兩張卡上下排。
- **驗證**：真資料——回補 94 筆；真回補檔 3 公里內 2022-10 起停辦 **11 所、核定 1,578 席，和報告 B-04 完全一致**；來源一在本機驗證庫（沒有收費資料，價格係數全為 1）低／中／高 **5.3／19.0／55.3**，114 學年窗口 44.1 位和童年綠地實際轉來約 42 位相近；回測愛爾蘭 8.9、童年綠地 31.5。後端全套 4,518 passed／1 skipped；admin 184 檔 3,098 passed／1 skipped，`typecheck`、`contract:check` 通過；stack e2e 全套 155 項（園所變化的斷言改依回補檔算預期後，重跑結果由主 session 補）。桌機與手機截圖：待主 session 補。
- **未驗證**：來源二、三的真資料數字（本機沒有義華在籍清冊與完整預售座標，只用合成資料測，部署後在正式站對報告的 1.2／5.2／11.3 與 1.0／1.6／2.5）、正式站、真實後台登入畫面。已知限制：來源一是過去平均，數字（中 19、高 55）比報告 A-07 的前瞻估計高很多；已停辦園所多半沒有收費資料、價格係數取 1；沒有連鎖折扣，數字偏高。**尚未 push、尚未部署**；部署與部署後檢查在 `deploy/README.md`「招生潛力第二、三波」。

## 2026-10-20 首屏影片調亮（`feature/hero-brighten-20261020`）

使用者要求首屏影片調亮一點。從園方原片重做首屏影片，沿用 09-23 平順版的七鏡頭與畫質處理，在壓縮前加一道調色：亮度走白色 soft-light 曲線（強度 .6，中間調拉亮、亮部與黑位不動）、色度 ×1.06。首屏封面與消息「一起跑向前」封面套同一條曲線。遮罩、版面、文案、播放規則都沒改。`scripts/optimize-site-videos.py` 改指向 `design/hero-video-grade-20261020/`，重產影片與封面的雜湊網址，刪掉舊的 `hero-desktop-7dd03551eb53`／`hero-mobile-ba791e4aa97c` 與封面舊衍生圖。檔案：桌機 5.67 → 5.43 MB、手機 2.26 → 2.15 MB。

驗證：12 幀＋封面依 CSS 遮罩離線合成量白字對比，最差值 1280 寬大標 4.86、內文 5.50、1024 寬導覽 4.86、手機導覽 4.67（原本 4.66），新爆白 0%；照片區 L* 57.7 → 68.2。Chrome 1440／1280／1024／390 截圖版面相同、照片區 L* 54.1 → 64.4，桌機與手機都播到新檔；封面接影片第一幀色差 1.6/255。Node 22 `nuxt typecheck` 通過、web vitest 108 檔 1321 項通過。比較過 CSS `brightness()`（亮部爆白）與疊白色 soft-light 混合層（封面載入前出現灰白、iOS 不可靠），都不採用，見 DESIGN.md。Safari／iOS 實機未驗證；凍結 vanilla 原型未改。

## 2026-10-20 資安與 bug 稽核 14 條修正（`fix/audit-fixes-20261020`）

使用者要求「檢查資安以及 bugs」：對 origin/main `817d516d` 快照做 11 個面向的盤查，每條發現由兩位獨立複核者嘗試推翻，保留 14 條（無高風險可直接利用的漏洞；權限與跨校隔離、前端注入、部署設定三個面向沒有發現），使用者要求全部處理。

- **預約與通知**：停課日的預約成功／已變更信改寫成停課內容（不再寫照常參觀與修改期限），停課前就排著的同案信由停課通知取代；寄信當下已過線上修改期限時不寫已過的期限、改請來電；重新產生家長連結／重寄確認信在鎖內重讀場次；最遠開放超過 60 天的校區，官網、家長改期、後台補登與改期都讀得到 61 天以後的場次（前端查到一年後、伺服器截到該校開放範圍）；「場次使用情況」只記從今天查到開放範圍最後一天的查詢，另加全站每分鐘、每來源每日、全站每日上限。
- **認證、招生、個資清理**：解除綁定與停權鎖住帳號列再讀；已退出的訪視不能釋放保留座位；手動新增招生訪視支援 `Idempotency-Key`（重送回原紀錄）；立即清理帶確認時的政策版本，不一致回 409；里界調整合併組的參觀率只除半徑內組員、總結句寫明合併進來的半徑外里數、里卡片距離修正。
- **素材**：`media_variants.size_bytes`（migration `a6c2e9f4b8d1`，接 `b8e2d6a4f931`，只加欄位、不回填），配額把衍生檔算進去，背景轉檔在配額鎖內重算；HDR 轉色調逾時不再退回不轉色調重跑。
- **官網**：首頁動態換活動時重新產生 .ics（NewsDialog 同型一併修）；idempotency key 在沒有 `crypto.randomUUID` 的瀏覽器退回 `getRandomValues`。
- **驗證**（Node 22，分支從 main `252585e2`）：後端全套 4062 passed／1 skipped；admin 全套 181 檔 3002 passed、`typecheck` 通過、build 通過；web 全套 108 檔 1321 passed、`typecheck` 與 build 通過；契約重產後一致；`deploy/check_schema.py` 通過、`deploy/tests` 22 項 OK；stack e2e 155 passed。
- **待決定**：既有衍生檔 `size_bytes` 要不要回填（目前已上線影片的衍生檔仍不計入配額）；背景轉檔超配額時上傳要不要直接回 409；招生聯絡紀錄 `POST /contact-notes` 也沒有 idempotency；清理只綁版本、沒綁筆數；合併組列的 2–5 歲含半徑外組員、參觀率分母只算半徑內；舊瀏覽器（iOS 15.0–15.3）整站支援要另訂 browserslist。**尚未 commit、尚未 push、尚未部署。**

## 2026-10-20 招生統計新增「招生潛力與市佔率」第一波：歷年註冊與 3 公里市佔率（`feature/admissions-potential-20261020`）

使用者看完整合判讀報告後，要後台自己算出「3 公里內的 2–5 歲孩子有幾成在義華」並看逐年走勢，不必每次重寫報告。規格 `docs/specs/2026-10-20-admissions-potential-share-design.md`（§10 是第一波實作紀錄），計畫 `docs/superpowers/plans/2026-10-20-admissions-potential-share-wave1.md`；分三波，這是第一波，**只有市佔率、沒有任何推估**。設計規則（口徑、只給總部、這次對「不做預測」的放寬只限本分頁）記在 DESIGN.md「招生統計：招生潛力與市佔率」。

- 後端：新表 `campus_term_enrollment`、`geo_village_ages_september`、`geo_elementary_grade1`（migration `76c4bf84b907`，接 `a6c2e9f4b8d1`，只新增表與放寬約束）；新 CLI `enrollment-history-extract`（本機用 xlrd 讀園方目標執行統計表 xls，只讀年級列，備註列不讀不存不印，輸出只有數字的 JSON）與 `enrollment-history-import`（正式站整批取代，多一個欄位整份拒絕）；`geo-sync` 多 `--september-file`（每年九月底各里人口，107 年起，舊三民／鳳山里代碼寫入時換成現行代碼）與 `--elementary-file`（教育部國小一年級人數，107 學年起，檔名 `NNN_basec.csv`），打包（種類 `september`、`elementary`）與自動同步都接上；`GET /admin/admissions/potential`（`admissions.stats`，只有總管理者）回傳歷年市佔率與國小對帳（`app/admissions/share.py`）。
- 後台：招生統計新子分頁「招生潛力與市佔率」（`sub=potential`）：大數字卡、手寫 SVG 走勢折線、可收合的各學年數字（可匯出 CSV）、國小對帳一行；手機（≤720px）卡片滿版、表改 2×2 小卡。
- **驗證**（Node 22）：真檔（本機，原始 xls 只由主 session 讀，不進 repo、不交給 subagent）33 張表表頭全部認得、132 列，104～115 學年秋季註冊和報告 I-9 §7 完全一致，3 條總人數警告；匯入 107～115 九月底人口後，115 學年分母 9,788（3 公里內 98 里，與報告一致），107～114 學年和報告分母差 −0.05%～−0.11%，市佔率到小數第二位與報告一致（只有 110 學年 1.32% 對 1.31%）；國小對帳 29 所、各學年比值 0.921～0.982、最新 0.937，未超過 0.05 不提醒。各任務的單項測試與逐任務審查都通過。後端全套 4,258 passed、1 skipped（總審查修正前跑的）；admin 單元 179 檔 3,027 passed、1 skipped；`typecheck`、`contract:check` 通過；桌機 1440×900、手機 390×844 截圖無 console error、無橫向捲動（`output/potential-wave1/`，未進 repo）。總審查後修正：走勢從 107 學年起、切校區不殘留、錯誤訊息不印多餘欄位名、九月檔先驗證。
- **未驗證**：正式站、Railway 連不連得到 `stats.moe.gov.tw`（第一次匯入建議走打包）、真實後台登入畫面。**10-20 已部署 main `4c90ef58`（run 39374305069），義華歷年註冊、九月底人口與國小已匯入，正式站畫面數字和本機驗證一致。** 部署後的人工步驟（歷年註冊 extract／import、九月底人口與國小的打包匯入）在 `deploy/README.md`。

## 2026-10-20 附近幼兒園加近 3 年裁罰與最近一次評鑑（`feature/admissions-data-20261020`）

使用者要把「附近同業比較」留下的 C 案做出來：附近幼兒園清單不只有「有裁罰紀錄」旗標，要看得到近 3 年裁罰件數、處分與違規內容、最近一次評鑑結果。規格 `docs/specs/2026-10-20-peer-penalties-evaluations-design.md`（§8 實作紀錄），部署與手動退路在 `deploy/README.md`「公開地理資料同步 → 幼兒園裁罰與評鑑」。

- 後端：新表 `geo_kindergarten_penalties`、`geo_kindergarten_evaluations`（migration `b8e2d6a4f931`，另把 `geo_dataset_status.dataset` 欄放寬到 32 字）；裁罰每 7 天讀 kiang 一所一檔（GitHub API 被限流時退回已知園所名稱逐一試），**「負責人／行為人：姓名」只取標籤轉成對象類別，姓名不進資料庫、API、日誌**；評鑑每 30 天走教保資訊網公開搜尋（ASP.NET 表單，約 69 頁，只用 id 白名單讀評鑑表三欄），**伺服器沒送中繼憑證，改帶 certifi 加隨程式提交的 TWCA 中繼憑證，不關閉憑證驗證**；整表替換、殘缺門檻與時間／大小上限；`fetch_geo_bundle.py --kindergarten-only` 與 `geo-sync --kindergarten-…-file`／`--bundle` 是手動退路；附近幼兒園端點每所多裁罰與評鑑摘要，新端點 `GET /admin/admissions/area/kindergartens/{source_id}/records`。
- 後台：列上「近 3 年裁罰 N 件」（只有 3 年前的寫淡色「3 年前有裁罰」）、最近一次評鑑小字、展開讀明細（裁罰對象只寫「園方受罰」「教保人員個人受罰」），清單下方加資料來源與人名不顯示的說明。
- **驗證**（Node 22）：真檔 238 檔 571 筆 0 筆略過，534 列、對到園所 441 列／194 所；教保資訊網對真站一次 GET 加一次 POST（第 1 頁：10 所、共 689 所、69 頁），內附中繼憑證驗證通過；後端單一次執行 1,445 passed（`test_geo_*.py` 全部、區域分析相關 `test_admissions_*`、系統狀態、權限表；不是後端全套）；後台全套 177 檔 2,988 passed，`typecheck` 通過；契約一致。
- **未驗證**：正式站、評鑑換頁（第 2 頁起沒有對真站試）、GitHub API 對 Railway 出口 IP 會不會限流、真資料畫面、stack e2e。**尚未部署、尚未 push。**

## 2026-10-20 招生區域加預售建案、預約設定的校區代號含控制字元不再 500（`feature/admissions-data-20261020`）

使用者要讓分校提早知道哪些里兩三年後會有一批新住戶：區域分析加內政部「預售屋建案備查」資料。規格 `docs/specs/2026-10-20-admissions-presale-design.md`（§8 實作紀錄），部署與手動匯入步驟在 `deploy/README.md`「公開地理資料同步 → 預售建案」。

- 後端：新表 `geo_presale_buildcases`、`geo_parcel_points`（migration `a3d7f1c9b5e2`）；容錯解析單檔（銷售期間含換行與逗號）、不讀起造人；在建／已登記／不明狀態與預計交屋粗估；先用地號座標點入里界、再用坐落街道比對門牌；每 30 天同步、內容沒變只記確認；`trends` 多每里在建戶數，新端點 `GET /admin/admissions/area/presale`；`fetch_presale_parcels.py` 本機查地號座標（正式站不連國土測繪中心），打包與 CLI 多兩種資料。
- 後台：「各里」表多「在建預售（戶）」欄與總結句、地圖多「在建預售」著色與建案點、完整表格多「預售建案」分頁（手機卡片、可匯出 CSV）、里卡片多一列。
- 另修：`GET/PATCH /admin/booking-config/{campus_key}`、`/readiness`、`POST /admin/slots` 的校區代號含 `%00` 回 404、`GET /admin/slots?campus_key=` 回 422（原本 500）。
- **驗證**（Node 22）：後端單一次執行 1265 passed（`test_geo_*.py`、區域分析相關 `test_admissions_*`、`test_admin_bug_audit_20261006.py`、系統狀態、權限表、稽核涵蓋、預約 readiness；不是後端全套）；後台全套 176 檔 2974 passed，`typecheck` 通過；契約一致。真檔解析 661 案 0 失敗；真門牌＋真檔本機示範庫加 Playwright 1440／390 看過畫面。
- **未驗證**：正式站、真實向國土測繪中心查地號、地號座標補上後的命中率、Safari／iOS 實機。**尚未部署、尚未 push。**

## 2026-10-19 關於頁手機版改成上翻畫冊（`feature/about-mobile-flipbook-20261019`）

使用者覺得 /about 手機版「看起來怪怪的」（桌機立體書在手機被拆成上下兩張紙），比稿 `design/about-mobile-directions-20261019/`（Desktop 工作區）選 A「上翻畫冊」，第二版把五校改成高雄立體地圖後做進 `web/`。規則見 DESIGN.md 同日一節。只動 900px 以下，桌機立體書不變。

- 手機整本換成頂端線圈裝訂的畫冊，往下捲一頁往上掀；第一章一頁一校，照片卡紙站在高雄立體地圖上，地圖一校一校長出來、虛線把五校依序連起來；封底書籤加各校小照片。放不下（小手機、橫拿）就上下排開。
- 新增 `AboutFlipBook.vue`、`AboutFlipMap.vue`、`about-flipbook.css`、`utils/about-flipbook.ts`、`utils/about-content.ts`（桌機與手機共用常數）、`scripts/build-about-map.mjs`（產生 `generated/about-map.ts`）、`tests/about-flipbook.spec.ts`（16 項）；`AboutContent.vue` 包一層 `.abk`、立體書動畫只在寬螢幕建立、蠟筆濾鏡移到 main 底下、拿掉右頁接縫紀念章；`about.css` 拿掉舊手機規則；`AboutCrayon.vue` 加畫冊的塗上／長出規則；`page-copy-stress.cjs` 加畫冊欄位；改 `about.spec.ts`、`about-crayon.spec.ts`、`mobile-ux-20261002.spec.ts` 的手機斷言。
- **驗證**（Node 22，分支從 main `89b0f65b` 開）：web `typecheck` 通過、單元測試 106 檔 1313 passed（新增 `about-flipbook.spec.ts` 16 項）；`nuxt build` 通過（postcss 的 Lexical 警告是首屏 hero 既有的）。dev server 與 build 產物（fixture）Playwright：430×932、390×844、375×812、375×667、360×740、820×1180 整本釘住翻頁，320×568、844×390 退回上下排開；1024、1440 桌機立體書照舊（`is-live`）、畫冊隱藏；各尺寸沒有橫向捲動。減少動態上下排開、`/about#voices` 翻到家長頁、平板 820↔1180 轉向互相拆建、手機首屏 CLS 0、axe（`main`，390 與 1440）0 項、Tab 每一步焦點都在最上面那頁看得到、換家長與播放影片正常、dev console 沒有錯誤與 hydration 警告。`page-copy-stress.cjs /about`（減少動態、`STRESS_MOTION=1`）全部通過，後台欄位填到上限時 390、820 仍釘住。
- **未驗證**：Safari／iOS 實機（3D 翻頁、`backface-visibility`、`scroll-snap` 與 sticky、`svh`）、Firefox；stack e2e（`tests/stack` 掃 `/about`）沒在本機跑。

## 2026-10-19 常春藤環境頁加蠟筆塗鴉（`feature/environment-doodles-20261019`）

使用者要 /environment 多一點童趣，比稿 `design/environment-playful-directions-20261019/`（Desktop 工作區）選 A「蠟筆塗鴉」、優化第二版後做進 `web/`。規則見 DESIGN.md 同日一節。

- 孩子在聯絡簿空白處畫的太陽、小鳥、彩虹、風箏、泡泡、兔子、香蕉蘋果、手印，捲到才一筆一筆畫出來，點了會動一下；第四章選到的學校把校舍塗上顏色。03 太陽弧上的太陽改塗橘黃。
- 新增 `web/app/utils/environment-doodles.ts`、`scripts/environment-tour-paint.py`（產 `web/public/assets/tour-paint-<校>(-roof).png` 十張）、`web/tests/environment-doodles.spec.ts`（10 項）；`EnvironmentContent.vue` 加空的塗鴉位置與動態載入；`environment.css` 加 `--renv-sun`、`--renv-crayon-*` 與位置；`rough-sketch.ts` 太陽改色；`environment-redraw.spec.ts` 加一項（手繪層之後建、預覽換內容跟著 refresh、卸載拆掉）；`environment-render.spec.ts` 的 `<main>` 基準多了塗鴉的空位置（可見文字基準不變）。
- **驗證**（Node 22，分支從 main `52e99730` 開）：web `typecheck` 通過、單元測試 105 檔 1297 passed。dev server（fixture）Playwright：1440／390／減少動態 9 個塗鴉都畫出、沒有 console 錯誤與 hydration 警告、塗鴉不可聚焦；小鳥的腳與曬衣繩高度差 1px（改寬到 1024 後也一樣）；方向鍵換過五所都塗上顏色；9 個塗鴉都點得到。效能數字見 DESIGN.md。mock 階段另看過 1024、820、360 寬不壓字。
- **未驗證**：Safari、Firefox、iOS 實機（SVG 濾鏡、CSS `mask`）；`nuxt build`；stack e2e（`tests/stack` 的 a11y、keyboard、hydration 掃 `/environment`）沒在本機跑。

## 2026-10-19 關於頁第三章改成孩子的蠟筆畫（`feature/about-crayon-20261019`）

使用者要 /about 第三章「我們的期許」多一點繪本感，比稿 `design/about-hope-picturebook-directions-20261019/`（Desktop 工作區）選 B。規則見 DESIGN.md 同日一節。

- 書頁上印著孩子畫的天空色帶、角落的太陽、草地（跨過書脊），房子和兩棵樹是剪下來的圖畫紙卡紙，照片用紙膠帶貼在窗上，引言「」是蠟筆畫的；翻開時色帶與草地一筆筆塗上，房子站好後藤蔓和煙畫出來。
- 新增 `scripts/about-crayon/build.mjs`（產生 `web/app/generated/about-crayon.ts`）、`AboutCrayon.vue`；拿掉向量紙房子、樹、草坡與常春藤 SVG 的模板與樣式；`about-popup.ts` 翻開時加 `is-opened`。
- **驗證**（Node 22，分支從 main `88bfd614` 開）：web `typecheck` 通過、單元測試 104 檔 1286 passed（新增 `tests/about-crayon.spec.ts` 14 項；改 `about.spec.ts` 括號、`mobile-ux-20261002.spec.ts` 舞台高度兩條斷言）；admin `aboutPage.test.ts` 20 passed。dev server（fixture）Playwright 1440×900、1366×650、1024×768、768×1024、390×844 看圖（捲動翻頁、卡紙站起、藤蔓與煙）；沒有 JS 與減少動態都是完成圖；axe（`#hope`，1440／390）沒有問題、dev console 沒有 hydration 警告；手機 CPU 降速 4 倍動畫期間 p95 16.7ms。
- **未驗證**：Safari、Firefox、iOS 實機（SVG 濾鏡與 CSS 遮罩括號）；`nuxt build`；stack e2e（`tests/stack` 的 a11y、hydration 掃 `/about`）沒在本機跑。

## 2026-10-19 入學頁拿掉訂位金 5,000 元（`fix/admission-deposit-20261019`）

使用者要求拿掉 `/admission` 入學流程第 3 格「保留名額」的「預先繳交訂位金 5,000 元，即可確定保留名額。」。10-16 招生判讀已查到這個金額超過《高雄市教保服務機構收退費辦法》第 8 條（114-04-29 修正）私立園每學期預收 1,500 元的上限，10-19 正式站仍顯示。入學頁線上讀 fixture（後台入學資訊頁從沒發布），所以改 fixture。

- 第 3 格改成「跟園所確認，就幫寶貝留下名額。」：不寫金額，也不另外寫辦理程序；長度控制在桌機與手機 390 都一行放得下（先試的「跟園所確認後，就幫寶貝把名額留下來。」會把「留下來」斷成兩行）。
- 同步 `web/tests/fixtures/overlay-initial-content.json`、`overlay-baseline-20260925.json`。全 repo 已沒有「訂位金」。
- **驗證**（Node 22，分支從 main `7efc441a` 開）：web `typecheck` 通過、單元測試 103 檔 1272 passed；後端 `test_admission_content.py` 16 passed（獨立測試庫 `ivy_website_test_deposit1019`，先 `alembic upgrade head`）；dev server（fixture）1440／390 Playwright：第 3 格新字一行、頁面「訂位金」0 次、沒有 page error。
- **沒有改**：第 1 格「以電話或親友介紹，確認名額並預約參觀時間。」和線上預約矛盾，仍等園方確認流程文字。

## 2026-10-17 首頁近期活動與最新消息改版：桌機方向 1、手機方向 3（`feature/news-next-20261017`）

使用者看了比稿 `design/news-directions-20261017/`（在 Desktop 工作區）後選「桌機方向 1、手機方向 3」，並拿掉這一區所有參觀入口。規則與細節見 DESIGN.md 同日一節。

- **桌機**：下一個活動放大（倒數、加入行事曆：Google 或 .ics），其他活動可展開；沒有活動時左欄不出現、消息整寬。消息不再自動輪播，一則大圖＋三列，可依校區篩（view transition），只看一校而不夠時補「其他校區最近」。
- **手機**：活動、消息、活動影片排成一列直式卡，取代活動影片色帶；點開是限時動態式的全螢幕檢視（進度條、點按換則、按住暫停、下拖關閉、暫停鈕）。
- **也改了**：拿掉英文眉標；`--ivy-news-muted` 調深到 5.2:1；後台「首頁最多輪播幾則」改「首頁最多放幾則」等文案；刪掉輪播、活動影片色帶的元件與測試。
- **驗證**（Node 22，分支從 main `60a9684c` 開，**未 commit、未 push、未部署**）：
  - web `typecheck` 通過、單元測試 103 檔 1272 passed（新增 `tests/news-home.spec.ts` 17 項：校區篩選、補其他校區、倒數、星期、Google 日曆 UTC 換算、.ics 跳脫與全天、動態排序與校區圈）；`nuxt build` 成功（3 個 postcss 警告是既有的首屏 calc，與這次無關）。
  - admin `typecheck` 通過、單元測試 168 檔 2704 passed、1 skipped。
  - dev server（fixture）Playwright：e2e `home-stories.spec.ts` 在 desktop-1440、mobile-390 三項通過（其餘為另一尺寸的 skip）；`nuxt-rendering.spec.ts` 通過；`public-site.spec.ts` 4 項失敗是 dev 模式沒有後端 booking-config 與索引開關，與這次無關。
  - 人工看圖 1920／1440／1024／390：桌機活動卡頂端對齊照片、篩選轉場、加入行事曆選單位置、展開其他活動；手機卡片列、校區圈、動態檢視（照片、活動、YouTube 原地播放）、Esc 關閉後焦點回卡片、看完最後一則關閉後不會被補發的 click 重開。fixture 是示意內容，非示意狀態（倒數、時間地點、行事曆）是暫時改 fixture 驗完再還原。
  - axe（`#latest-news`）：桌機、手機、動態檢視都沒有問題（修掉一個 landmark-unique）；dev console 沒有 hydration 警告。
- **未驗證**：Safari、Firefox、iOS 實機；正式站資料（正式站示意說明欄仍有值，上線後照樣顯示「示意」與「日期未定」，清空後台示意說明欄才會出現倒數與加入行事曆）；stack e2e（`tests/stack` 的 a11y、hydration 掃 `/`）沒在本機跑。

## 2026-10-17 入學頁拿掉過時的補助券（`fix/admission-subsidy-20261017`）

使用者回報 `/admission`「收退費辦法」的補助有錯誤或過時的內容。正式站後台的入學資訊頁從沒發布過（`/public/site` 沒有 `admission_content`），線上讀的是 `web/server/data/site-fixture.json`，所以改 fixture，不是改後台。

- **拿掉三張補助券**（`subsidies` 清空，頁面本來就會在沒有補助時隱藏「政府補助」）：
  - 「教育部補助 15,000 元／學期・大班學費」：這是 110 學年以前私幼 5 歲免學費的舊制。111 學年（2022-08）起，私幼 5 歲至入國小前改發「就學補助」，比照育兒津貼每月 5,000／6,000／7,000 元（教育部作業要點、高雄市教育局業務概況）。
  - 「高雄市政府補助（符合資格者）5,000 元／學期・中班、小班、幼幼班學費」：高雄市教育局現行補助裡沒有這一項。
  - 「中央或高雄市政府補助 3,000 元／月・2–5 歲特殊家庭」：現行對應的是高雄市「兒童托育津貼」，只有市府發，而且限低收入戶、單親、發展遲緩、身心障礙、原住民等七類身分；券上寫的「中央或」「2–5 歲」都不對。
- **收退費說明**拿掉「補助款皆待政府撥款到園後再轉發家長，開學後會協助辦理」：育兒津貼與就學補助是家長向戶籍地申請，不經過園所。保留「收退費依『高雄市教保服務機構收退費辦法』辦理」（現行法規，114-04-29 修正）。
- **保留**：私立幼兒園育兒津貼表（第 1／2／3 胎以上每月 5,000／6,000／7,000 元，不含公立、準公共、非營利）金額與現行一致。
- 測試資料同步：`web/tests/fixtures/overlay-initial-content.json`、`overlay-baseline-20260925.json` 換成新文案；`backend/tests/test_admission_content.py` 的「補助金額空白要擋」改成自己帶一筆補助，不再依賴 fixture 有補助券。
- **驗證**（Node 22、本機 PostgreSQL、獨立測試庫 `ivy_website_admsub_test`，分支從 main `9db0fe48` 開）：讀 fixture 的後端測試（`test_admission_content.py` 和其他讀 fixture、初始化內容的檔案）272 passed；web `typecheck` 通過、單元測試 103 檔 1258 passed；dev server（fixture）1440／390 截 `#fees`：0 張補助券、育兒津貼表與退費規定照常排版、沒有橫向捲動、沒有 console 錯誤。
- **沒有改**：後台的補助欄位與官網補助券元件都留著。但正式站後台的入學資訊頁是空表單（從沒建立內容），在後台只填補助就發布，會用這份不完整的內容蓋掉整頁；要改走後台，得先把整頁內容匯進後台。在那之前，入學頁文案照樣改 fixture。

## 2026-10-15 預約表單預計入學時間、預約案件排除標記（`feature/admin-wave3-20261015`）

後台功能第 3 波（規格 `docs/specs/2026-10-15-visit-expected-start-design.md`、`docs/specs/2026-10-15-visit-exclusion-design.md`，計畫 `docs/superpowers/plans/2026-10-15-admin-wave3-start-exclusion.md`）。

- **預計入學時間**：官網預約表單多一題選填單選（盡快、接下來四個學期的開學月份、還不確定），家長管理頁與後台都能改，到場建招生訪視時帶進入學學期。migration `b7e3c1a9d5f2`（加可空欄位，不改既有資料）。
- **排除標記**：總管理者與校區管理者可以把測試或重複的預約案件標為排除，不再算進總覽、參觀預約的結果與班別、預約全程、場次使用情況與提醒（預約流程、每日變化、依來源、預約鈕點擊讀去識別事件，扣不掉）；不釋出名額；列表可隱藏。migration `d4a8f2c6e913`。
- **使用者 10-16 確認**：總覽「本週五校」的已約／可約不扣排除的案件（排除規格 §3.3）。
- **正式站要做的事**：已發布的隱私權政策要請園方在後台補「預計入學時間」一項（後台草稿已補）。
- **驗證**（2026-10-16，Node 22、本機 PostgreSQL、獨立測試庫 `ivy_website_wave3_1015_test`／`_e2e_test`，分支從 main `c4524ed5` 開、併入 main 到 `f80c304c`，**未 push、未部署**）：
  - 最終修正後在 `707951e2`：後端全套 3736 passed、1 skipped（6 分 14 秒）；admin 168 檔 2704 passed、1 skipped；web 103 檔 1258 passed；admin、web `typecheck` 通過；`export_openapi.py --check`、`check-contract-types.mjs` 一致；`npm run e2e:build` 後 stack 全套 151 passed（含 `visit-expected-start.spec.ts`、`visit-exclusion.spec.ts`，視覺基準「案件明細」在 1% 門檻內，不用更新）。最終修正前在 `a4cf4060` 也全套跑過一輪（後端 3733、admin 2696、web 1256、stack 151，全綠）。之後的 `a2db0f98`（排除鎖內重讀拿掉 `slot_id`、一條焦點測試改成實際斷言）重跑 `test_visit_exclusion*.py` 54 passed、`visitExclusion.test.ts` 24 passed、admin `typecheck` 通過。
  - 人工看圖（`output/playwright/visit-expected-start-*.png`、`output/playwright/wave3-exclusion/*.png`，不進版控）：表單的預計入學時間膠囊在 1440／390 都整齊、不橫向捲動；排除對話框、名額提示、已排除橫幅、右欄最下方的入口（手機排在最後）、列表「已排除・重複」標籤與「隱藏已排除」、統計的「另有 N 筆已排除」都正常。
  - 鍵盤：預計入學時間按 Space 選取／再按取消，在 Chromium 與 WebKit 實測；Firefox 沒實測（`@keyup.space.prevent` 是依 Gecko 行為加的防禦）。
- **未驗證／沒做**：沒有登入正式後台看畫面；正式資料上沒有實際排除過；家長只改預計入學時間也會寄「預約已變更」信（和改其他欄位一致，使用者可推翻）。

## 2026-10-16 區域分析改成地圖工作台（`feature/area-workbench-20261016`）

區域分析 10-08 上線後陸續加了招生機會、里的變化、托嬰、園所異動、出生、新屋、學區、在籍學生、同業收費，每次都往頁面底部接一塊；10-16 在正式站量到整頁約 6,000px。使用者從三個方向選了 B「地圖工作台」：地圖上方一列決定看什麼，右欄跟著換成該模式的排行，點任何一個里右欄顯示這個里的全部數字，完整表格收進地圖下方的分頁。規則見 DESIGN.md「招生統計：區域分析地圖工作台」，規格 `docs/specs/2026-10-16-admissions-area-workbench-design.md`，計畫 `docs/superpowers/plans/2026-10-16-admissions-area-workbench.md`。

- **後台**（純前端，後端、API、資料表、契約都沒動）：工具列「看什麼」七項（在籍學生、2–5 歲孩子、孩子增減、新屋交屋、參觀、招生機會、同業）與「範圍」1／3／6 公里；有在籍清冊的校預設在籍學生，沒有的預設 2–5 歲孩子。工作台是 620px 地圖＋380px 右欄（排行、里卡片、同業清單），點里不再開 popup、改選取並畫 `--ink` 外框。「完整表格」六個分頁：各里（招生機會＋里的變化＋在籍合成一張）、國小學區、在籍學生、同業收費、出生走勢、參觀來源。頁首狀態列與摘要搬到頁尾。模式、選取的里、表格分頁寫進網址（`map`、`village`、`table`），換校區或學年學期清掉 `village`。招生機會模式在附近參觀不到 10 位時停用並寫原因。手機：看什麼橫捲、地圖半個螢幕＋「移動地圖」、選了里卡片出現在地圖下方並捲到標題。
- **測試**：新增與改寫單元測試（`villageFacts`、`areaPane`、`villageTable`、`areaView`、`admissionsStatsView` 等）；stack e2e `tests/stack/admissions-area.spec.ts` 改成新版面的選擇器，新增四則（點里＋重新整理還原＋外框＋幼兒園點仍可點、排行 `panTo`＋分頁網址＋各里表點里名＋換校區清 `village`、頁長 ≤ 1,800px、390px 卡片位置），Axe 加掃右欄、里卡片、工具列與完整表格。
- **驗證**（2026-10-17，Node 22、本機 PostgreSQL，**未 push、未部署**）：admin typecheck 0 錯誤；admin 單元測試 172／173 檔、2846 passed、1 skipped，唯一失敗是 `admissionsView` (h) 的 5 秒逾時（機器 load 30–80，和基準 `d196036b` 交替比較耗時無差異），單獨重跑通過（`de9c15a1`）；官網單元測試 101 檔、1229 passed（`7f51d3d6`）；整套 stack e2e 151 passed、8.0 分鐘（`0ec7bb42`，之後只改 e2e 與文件）；區域分析 stack e2e `tests/stack/admissions-area.spec.ts` 21 passed、2.1 分鐘（`de9c15a1`）。最終審查的修正（單欄點地圖捲到卡片、同業清單保留搜尋字、畫布名稱與停用原因的讀屏文字、e2e 加掃工具列與完整表格）之後只重跑了相關單元測試與 typecheck；admin 全套與 stack 待主控在最終版本再跑。
- **未驗證**：沒有登入正式後台看畫面（正式站的在籍學生住處不拍、不進測試，截圖只拍 stack 測試庫，存 `output/playwright/area-workbench-*.png`，不進版控）；頁長 1,800px 是種子資料的回歸防線，不代表正式站實際高度。

## 2026-10-16 密碼雜湊改直接用 bcrypt、九月的日期紀錄移到 docs/changelog（`feature/passlib-docs-20261016`）

優化盤點第三批。

- **passlib → bcrypt**：passlib 1.7.4 已停止維護，又把 bcrypt 卡在 4.0。`app/auth/service.py` 改用同介面的 `_BcryptContext`，bcrypt 升到 5.0.0（用 CI 同版 uv 0.8.22 重產 lock，只動這兩個套件）。既有雜湊格式相同：新測試 `tests/test_password_hashing.py` 用換掉前以 passlib 實際產生的 `$2b$04`、`$2b$12`、`$2a$04` 雜湊驗證。72 bytes 以上的舊密碼照 passlib 的做法截斷（bcrypt 5 本身會丟例外）；認不得的雜湊改成驗證失敗而不是 500。
- **文件封存**：README.md 的 2026-09 日期段落（206 段）移到 `docs/changelog/README-2026-09.md`（README 687→329 KB），deploy/README.md 的 2026-09 部署紀錄（60 段）移到 `docs/changelog/deploy-2026-09.md`（414→261 KB）。參考章節與原型說明留在原檔，原位置留指標；逐行比對內容守恆。CLAUDE.md 檔案地圖寫下每月封存的做法。DESIGN.md 是依主題的定案規則，沒有拆。
- **驗證**（本機，**未 push、未部署**）：後端全套 3579 passed、1 skipped（獨立測試庫 `ivy_website_passlib1016_test`）；`deploy/tests` 22 項通過。沒有改 web、admin、API 契約。

## 2026-10-16 清掉 web 的死 CSS 與比稿殘留（`feature/web-deadcode-20261016`）

優化盤點第二批。全域 CSS（tokens／styles／studio／typography）因為 `inlineStyles` 會內嵌進每一頁，線上每頁 HTML 帶 162–169 KB 的 CSS，佔六成。

- **判斷方式**：postcss 解析每條選擇器，class 在 `web/app`、`server`、`shared`（不含純註解行）找不到、也不是 `` `前綴-${}` ``／`'前綴-' +` 動態組出來的，或依賴程式從不設的屬性（`data-pill`、`data-peek`、`[data-seam="1"]`），才算不可能匹配；`:is`／`:where`／`:has` 有一個分支可能就保留，`:not` 不算。只出現在 `classList.contains` 的 `hero-quiet` 手動判定。
- **刪掉的**：`studio.css` 85.2→70.4 KB（八種膠囊擺法、捲動收起、seam=1、relay 研究面板、hero-quiet、選單 beside／above、舊分校頁線稿與聯絡區、舊新聞清單），`styles.css` 56.9→38.6 KB（原型時期 hero、新聞格、表單面板、舊 e3 五校底板卡），`typography.css` 少 0.4 KB；整個沒載入的 `admission.css`（30 KB）；只剩測試在用的 `pageHeroImage`、沒有呼叫端的 `campusHeroAttrs`；web 沒用到的 `@nuxt/test-utils`、`@vue/test-utils`；後台 Vite 範本殘留的兩個 SVG。
- **效果**：production build 每頁內嵌 CSS 少約 31 KB（`/` 169→138 KB、`/about` 164→133 KB），gzip 後每頁 HTML 少約 6 KB。
- **畫面沒變的證據**：dev server（fixture）1440／1024／390、10 頁、首屏＋捲動＋選單打開共 75 個狀態，抓每個元素含 `::before`／`::after` 的 computed style，main 與這版同時開兩個 server 交錯各跑兩次：排除自訂屬性列舉順序（Chrome 每次不同）、`blob:` 網址、兩邊埠號與路徑後 0 個屬性不同。
- **驗證**（Node 22，**未 push、未部署**）：web vitest 101 檔 1227 passed（少的 2 項是測死碼的）、web／admin typecheck 0 錯、admin vitest 165 檔 2599 passed／1 skipped、`nuxt build` 成功。build 的 `[vite:css][postcss] Lexical error`（studio.css 巢狀 `calc(clamp())`）main 本來就有。沒有跑 stack e2e。
- **沒做**：只看 class 與屬性；元素選擇器、`@keyframes` 是否還有人用沒有清。分析與比對腳本留在 session scratchpad，沒進 repo。

## 2026-10-16 招生統計抽成獨立側欄頁、只給總管理者（`feature/admissions-stats-page-20261016`）

使用者要把招生入學的「統計分析」分頁（`/admissions?tab=stats`）抽成獨立的側欄項目，並且只有最高權限看得到；確認過分校管理者、接待會連未預繳名單一起看不到。規則見 DESIGN.md「後台：招生統計抽成獨立頁、只給總管理者」。

- **後台**：側欄「參觀預約」組、「招生入學」之後新增「招生統計」（`/admin/admissions-stats`，限總管理者、招生開關關閉時不列出）。新頁 `AdmissionsStatsView` 頁首同招生入學，九個子分頁（`StatsTab`）原封不動；「查看明細」push 到招生入學的訪視明細，上一頁回到統計。招生入學只剩漏斗看板、訪視明細；舊連結 `?tab=stats` 總管理者轉到新頁、其他人退回漏斗看板。兩頁共用的頁首抽成 `AdmissionsFilterBar`、開關判定抽成 `useAdmissionsAvailability`，`useAdmissionsFilters(page)` 依頁面讀寫自己的網址參數。系統狀態「看區域分析」、成效統計說明、漏斗看板口徑說明改指招生統計。
- **後端**：新 capability `admissions.stats`（只給 `super_admin`），統計用的 18 支 API（招生統計、五校比較、區域分析整組、預約全程、未預繳名單與匯出、參觀預約統計四支）改用它，其他角色 403；`analytics.read` 已無路由使用、刪除。漏斗看板、訪視明細的 API 不變。沒有 migration；契約只有 docstring 變（已重新產生）。
- **驗證**（2026-10-16，Node 22、本機 PostgreSQL、獨立測試庫 `ivy_website_admstats1016_test`／`_e2e_test`，從 main `c4524ed5` 開，**未 commit、未 push、未部署**）：
  - 後端全套 3568 passed、1 skipped、0 failed（7 分 47 秒）；權限相關 14 個測試檔的期望值改成「總管理者 200、其他角色 403」，原本的期間、學年邊界、不含個資等斷言保留。
  - admin `vue-tsc` 通過；admin 全套 166 個檔案 2634 passed、1 skipped（`--testTimeout=60000`，機器負載高）；統計頁的網址同步、子分頁、查看明細、舊連結轉址、側欄與路由權限搬到新檔 `admissionsStatsView.test.ts`。
  - `export_openapi.py --check` 與 `check-contract-types.mjs` 一致。
  - stack 全套重新 build 後 147 passed、0 failed（含視覺基準）；新頁 1440／390 截圖人工看過（`output/playwright/admissions-stats-*.png`，不進版控）。
  - web 沒有改動，沒跑 web 測試。
- **未驗證**：沒有登入正式後台看畫面。

## 2026-10-15 招生歷程兩種事件＋退出原因分類（`feature/admin-wave2-20261015`）

後台第 2 波（10-15 盤點選定的六項之二、三）。招生歷程多記「修改招生資料」（只記欄位名）與「排下次聯絡」（只記從追蹤直接改的），兩者都是官網專用、不轉給園務；退預繳、退註冊改成必選八項退出原因分類、說明選填，舊資料歸「未分類」並可補分類，訪視明細可依分類篩選與匯出，統計分析「未預繳與退出原因」多一張退出原因分佈。規則見 DESIGN.md「招生入學：招生歷程兩種事件與退出原因分類」，計畫 `docs/superpowers/plans/2026-10-15-admin-wave2-history-withdraw.md`，兩份規格的 §7 列實作與規格的差異。

- **資料**：一支 migration `5c8e1f3a9d27`（接在附近同業比較的 `f2b8c4d1e7a9` 後面；`recruitment_visits.withdraw_reason_category`，只加可空欄位與兩條 CHECK，不改既有資料，不需先備份）；歷程事件不動資料表。
- **轉移契約**：`website_only.event_types` 多兩種；`columns.withdraw_reason` 改成「分類：說明」（匿名化後是分類本身）；延伸檔多 `withdraw_reason_category`；歷程 metadata 表補上園務 `withdrawn`／`revert_converted` 的 `deleted_student_id`（`contracts/ivy-recruitment/README.md` 第 6、20 點與歷程 metadata 一節）。
- **不做**：記欄位前後值、自動歸類、預測、「其他」選項、園務端改動。
- **驗證**（2026-10-16，Node 22、本機 PostgreSQL、獨立測試庫；程式在 `ffc7eaf7`，**未 push、未部署**）：以下是各 Task 實作時的單檔結果。
  - 後端：歷程事件 `test_admissions_history_events.py` 加預約同步 1 條，12 passed；歷程相關指定檔 150、契約／保存／學期 41、其餘招生 169 passed；schema 與 geo 48、契約 7 passed，測試庫 `alembic upgrade`、`downgrade -1`、再 `upgrade` 來回成功（單一 head `5c8e1f3a9d27`）；退出分類 API 與相關檔 163、再加相鄰 76 passed；篩選、CSV、統計、匯出、匿名化 94 passed，相鄰 114、引用統計與匯出的 115 passed。
  - 契約：`export_openapi.py --check` 與 `check-contract-types.mjs` 一致；`check_ivy_recruitment_contract.py` 與園務一致（對齊 `dfd230c3`）。
  - admin：歷程中文與變更行 80 passed（另 19）；退出對話框、補分類、明細顯示 217 passed（另 47）；篩選與統計表 246 passed；`vue-tsc` 無錯誤。
  - 全套驗證：合併 `origin/main` `e420e9f2`（附近同業比較；migration `5c8e1f3a9d27` 改接 `f2b8c4d1e7a9`，測試庫重建）後在 `1577276a`：後端全套 3480 passed、1 skipped、0 failed（21.5 分鐘）；admin 全套 164 個檔案 2595 passed、1 skipped（`--testTimeout=60000`，機器負載高）；admin、web `typecheck` 通過；`export_openapi.py --check`、`check-contract-types.mjs`、`check_ivy_recruitment_contract.py`（對齊 `dfd230c3`）一致；stack 全套重新 build 後 145 passed、0 failed（5.6 分鐘），含 `admissions-withdraw.spec.ts`（退出選分類、歷程、明細篩選、統計表、桌機與 390px 不溢出）與更新後的 `exports.spec.ts`（38 欄）。合併前在 `ffc7eaf7`／`49dae8e7`／`dd527c7c` 也各跑過一輪（後端 3349 passed＋1 個 PostgreSQL 連線數滿的環境錯誤、單檔重跑通過；admin 2556 passed；stack 143 passed）。
  - 再合併已上線的第 1 波（`4f1e0603`）與 small-fixes（`2d56b439`）、第 1 波部署紀錄（`b20ef763`）後：在 `26fd6f4a` 後端全套 3566 passed、admin 全套 165 個檔案 2617 passed、stack 全套 146 passed；在 `068ee7a0` 後端全套 3567 passed、1 skipped、0 failed（21.4 分鐘），admin 全套 165 個檔案 2623 passed、1 skipped（`--testTimeout=60000`），admin、web `typecheck` 通過，契約檢查一致，stack 全套重新 build 後 147 passed、0 failed（5.6 分鐘）。
  - 再合併 ci-speed（`702e5178`，測試準備改成路由只建一次、清表改 DELETE）後在 `bafcf434`：後端全套 3568 passed、1 skipped、0 failed（5.6 分鐘），stack 全套重新 build 後 147 passed、0 failed；admin 這次沒有被 main 動到，沿用 `068ee7a0` 的 2623 passed。
- **未驗證／沒做**：沒有登入正式後台看畫面；沒有部署、沒有 push；桌機篩選列與 390px 版面由 stack e2e 量過不溢出並截圖人工看過（`output/playwright/withdraw-*.png`，不進版控）。

## 2026-10-16 後端測試提速、後台場次 N+1、文件更正（`feature/ci-speed-20261016`）

使用者要盤點「還有哪裡可以優化」，同意先做 CI 提速＋小修正＋文件更正。從 push 到部署約 18–21 分鐘，關鍵路徑是 Backend 最慢那一組 pytest（12.5–15 分鐘）。

- **測試準備**（`backend/tests/conftest.py`、新增 `backend/tests/route_cache.py`）：本機抽 92 項實測，準備階段佔 74%（平均 394 ms，本體 141 ms）。原因是每個測試都 `create_app` 一次，FastAPI 把 850 條路由重建一遍（約 130 ms，幾乎都是 pydantic 驗證器），以及 TRUNCATE 56 張表（44 ms）。改成路由只建一次、之後的 app 重用（`dependency_overrides` 對共用路由無效，app fixture 收尾會檢查）；清表改從 `Base.metadata` 取名單，superuser 時用 `session_replication_role=replica` 的 DELETE（1.4 ms），否則照舊 TRUNCATE。同一批 92 項改前 36–40 秒、改後 16–19 秒。
- **連線外洩**：提速後全套第一次跑出 35 個 `TooManyConnectionsError`。conftest 從來沒有 dispose 每個測試的 engine，連線原本靠 GC 回收 app 才關；建 app 變快、垃圾變少後 GC 跑得少，舊連線累積。`tests/test_admissions_*.py` 548 項的連線峰值：main 11、提速未 dispose 51、加 dispose 後 3。
- **`.test_durations`**：舊檔是 10-05 的 1532 項（缺 65 個檔），CI 三組實跑 853／637／760 秒。重產後 3448 筆，pytest-split 預估三組平均。
- **後台場次列表 N+1**：`GET /admin/slots` 原本每個場次各查一次已占名額，改用公開查詢已在用的 `count_booked_by_slot`；新測試確認 1 個與 6 個場次的查詢數相同（修正前 5 對 10）。
- **CI**：同一個分支的 push 與 PR 改成同一個 concurrency 群組（分支名），後到的取消先到的；來源分支叫 `main` 的 PR（例如 fork）改用 PR 編號，不會和正式部署同組。
- **文件**：`docs/website-admin/operations.md`（逾期提醒、承辦人、舊狀態、停用分校回 404 的頁面）、`deploy/README.md`（家長自選場次已部署）、`deploy/CICD.md`（e2e 不擋部署、smoke 不檢查五校頁）、`CLAUDE.md`（README 長度、待追蹤分頁與 inquiry 已拿掉、stack e2e 與 durations 指令）等仍把已拿掉的功能寫成現況的地方。
- **驗證**（Node 22、本機 PostgreSQL 14、獨立測試庫 `ivy_website_cispeed1016_test`，**未 push、未部署**）：後端全套 3447 passed、1 skipped，本機單一程序 5 分 9 秒。沒改 API 契約、web、admin，沒跑前端與 stack e2e。CI 上實際省多少要等推上去看三組 pytest 的時間。
- **沒做、待使用者決定**：e2e 要不要擋部署；repo 是公開的（私有化會讓 Actions 計費、runner 降到 2 vCPU）；沒有前端呼叫的端點（招生 follow-ups、使用者 scope、校區清單、名額規劃兩支）要不要刪；`tests/e2e`（`playwright.config.ts`）沒有任何 workflow 在跑、還在打已 301 的 `/campuses/*`。

## 2026-10-16 延後小問題一批修正＋文件校正（`fix/small-fixes-20261016`）

使用者 10-16 要盤點「還有什麼可以做」後說「先做你可以做的」。從各次紀錄的「延後」清單挑出在 main（`263fea2a`）上仍存在、不需要業主決定的幾條，各自先寫失敗測試再改。規則寫進 DESIGN.md「招生入學：預約全程漏斗」與「參觀場次」兩節。

- **預約全程**：今天稍晚的場次被取消、還沒到參觀時間的不進批次（`journey.py`）；摘要句在來源不是全部時寫「（只看官網預約／後台補登）」；涵蓋說明補「預約案件已刪除」；匯出 CSV 時漏斗比率拆成指標、比率、分子、分母四欄，各段天數的中位數寫數字；離開預約全程後頁面收回篩選或換校區，不在背景重讀（`JourneyTab` 的 `active`）。
- **參觀場次**：改每週場次後停用的場次（`closed_source='rule'`）不再畫成紅色「停止申請」，當天清單寫「不在開放規則內」；已在接待月曆時網址換校（上一頁、帶 `?campus=` 的連結），場次卡有沒存的修改要先問，選擇留下就不換校。
- **官網預約完成頁**：重送同一筆時拿不到修改連結（`manage_path` 為 null），說明不再叫家長看「下方的連結」，沒寄信時改寫「請直接聯絡園所」。
- **驗收 A23**：`tests/stack/hydration.spec.ts` 加斷言：8 個公開頁 hydrate 時都沒有在瀏覽器再讀 `/api/published-site`，另一則反向對照證明監聽抓得到；A23 改通過。`usePublishedSite.ts` 的註解原寫「換頁重新讀」，和實測（同 key 沿用、0 次請求）不符，已更正。
- **文件校正**：`acceptance.md` 七個段落標題與一句寫「尚未部署」的已補部署 commit（都有 `deploy/README.md` 紀錄）；「招生開關在正式站仍關閉」更正為 10-04 實測已開；`deploy/README.md`「家長自選場次（未部署，草稿）」補註 10-01 已上線。
- **沒做、待決定**：加開一場不檢查和既有場次重疊（後端只擋同一開始時間；要擋重疊、只提醒還是不管，需要業主決定）；「重寄確認信」在寄信設定還沒讀到時仍顯示（讀到 SMTP 沒設就會隱藏；讀取失敗時不保證，是原設計的取捨）；結果頁 `visitResultKind` 把 completed／no_show 也當已取消（只有重送才看得到，實際幾乎碰不到）。
- **驗證**（2026-10-16，Node 22、本機 PostgreSQL、獨立測試庫 `ivy_website_smallfix_test`）：先看到新測試失敗再改。後端 `test_admissions_journey.py`、`test_admissions_journey_calc.py`、`test_analytics_booking_outcomes.py` 53 passed（期間其他 session 的測試把 PostgreSQL 連線佔滿，偶爾有一則 setup `TooManyConnectionsError`，重跑通過）；admin `vue-tsc` 通過、vitest 164 檔 2570 passed、1 skipped、7 則 5 秒逾時（系統負載 52–59；逾時的都不是這次新增或改到的測試，負載降下來後那五個檔單獨重跑全過）；web `nuxt typecheck` 通過、vitest 101 檔 1229 passed；`npm run e2e:build` 後 stack（`E2E_DB_NAME=ivy_website_smallfix_e2e_test`）hydration、admissions-journey、slot-usage、visit-schedule、schedule-flow、booking-flow 通過（hydration 改完反向對照後單獨重跑 10 passed）。API 形狀沒變，沒跑契約檢查。未驗：後端全套、stack 全套、瀏覽器目視。未 commit、未 push。

## 2026-10-15 後台第 1 波：系統狀態頁＋家長參觀提醒信（`feature/admin-wave1-20261015`）

10-15 後台功能盤點選出的六項之第 1 波。規則見 DESIGN.md「後台：系統狀態頁」「預約：參觀前 24 小時家長提醒信」；規格 `docs/specs/2026-10-15-admin-system-status-design.md`、`docs/specs/2026-10-15-parent-visit-reminder-design.md`（各自 §7 列與規格的差異）；計畫 `docs/superpowers/plans/2026-10-15-admin-wave1-status-reminder.md`。

- **系統狀態頁**（只有總管理者）：寄信、LINE 推播、Turnstile、Google／LINE 登入、素材儲存、招生與同步開關、個資自動清理有沒有設；維護排程、轉檔、公開資料同步是否在跑；各項公開資料的版本與是否過期（門牌 35 天）；寄送與排程發布失敗筆數。可寄測試信給自己；營運總覽在有「要注意」時多一行。自動同步沒開時，非門牌資料的過期只算資訊。
- **家長參觀提醒信**：參觀前 24 小時寄 Email；期限內附修改連結，過了請家長來電；改期、停課、取消、匿名化後不寄。正式站設好寄信之前一律 skipped。
- **資料**：不新增 migration、不新增環境變數；`/health` 不變。
- **已知限制**：參觀改期後又改回原場次，不會再寄第二封提醒；提醒到點時當天是停課日會照樣排入、寄送時 skipped，園方之後（24 小時內）取消停課，家長不會再收到提醒；背景迴圈狀態只反映回應請求的那個程序（正式站目前單一副本）。
- **驗證**（Node 22、PostgreSQL 獨立測試庫；程式碼從 `d5e79924` 起至 `fa2b49cc`；**未 push、未部署**）：
  - 後端單檔：`test_system_status.py` 在 Task 1 時 35 passed，Task 2 加上權限、測試信與總覽後，與 `test_permission_table.py`、`test_dashboard_today_board.py`、`test_operations.py`、`test_audit_coverage.py`、`test_audit_actions.py` 合跑 94 passed；`test_parent_visit_reminder.py` 27 passed，與提醒、寄信、維護排程相關檔合跑 81 passed。
  - admin 單檔：`systemStatus.test.ts` 22 passed、`labelCoverage.test.ts` 15 passed；`typecheck` 無錯誤；契約檢查（`export_openapi.py --check` 加 `check-contract-types.mjs`）一致。
  - stack：`system-status.spec.ts` 1 passed（連 setup 共 2 passed）；1440 與 390 截圖看過，四區載入、手機無橫向溢出。
  - 全套驗證：後端全套 3220 passed、1 skipped、0 failed（25.5 分鐘，在 `fa2b49cc`）；最終審查修正（`1e65245b`..`4ee1612e`）後重跑 `test_system_status.py` 59 passed；admin 全套在 `4ee1612e` 162 個檔案 2528 passed、1 skipped（其中 5 個檔案因機器負載 worker 啟動逾時，單獨重跑 20 passed）；admin、web `typecheck` 與兩項契約檢查通過；stack 全套在 `4ee1612e` 重新 build 後 141 passed、0 failed（5.4 分鐘）。
  - 合併 `origin/main` `9dbf413f`（在籍學生分布與區域分析修正，只有 README.md 衝突，新 migration `f2a7c1e9d4b3`）後，在 `2133b463`：契約重新產生與合併結果一致；後端受影響的 21 個檔案（系統狀態、維護排程、提醒、家長信、權限表與所有用到 `app.cli` 的測試）517 passed；admin `typecheck` 通過、相關 7 個檔案 273 passed。合併後沒有再跑三套全套。
  - 再合併 `origin/main` `54031d7c`（幼兒園名單改版，只有 README.md 衝突、沒有新 migration、`DATASETS` 不變）後，在 `425a490c`：契約檢查一致；後端受影響的 23 個檔案（加上公開資料同步與幼兒園名單相關測試）647 passed；admin `typecheck` 通過、相關 4 個檔案 181 passed。
  - 再合併 `origin/main` `e420e9f2`／`263fea2a`（附近同業比較，`DATASETS` 多 `kindergarten_fees`，系統狀態頁補中文「幼兒園收費」，週期沿用預設 30 天＝同步程式的 `FEES_REFRESH_AFTER`；新 migration `f2b8c4d1e7a9`）後，在 `4205463d` 重跑三套全套：後端 3518 passed、1 skipped，另 14 個 error 全是 PostgreSQL「too many clients」（同時間別的 session 在用本機 PG），所在 12 個檔案單獨重跑 247 passed；admin 全套 165 個檔案 2593 passed、1 skipped（`--testTimeout=60000`）；admin、web `typecheck` 通過；契約檢查一致；stack 全套重新 build 後 145 passed、0 failed（6.8 分鐘）。
  - **未驗證／沒做**：沒有登入正式後台看過系統狀態頁；正式站寄信（SMTP）是否已設未確認，測試信沒有對真的 SMTP 按過；提醒信沒有真的寄出過（只在測試用的 recording adapter 驗內容與寄送流程）；手機版沒量測試信結果段落展開後的寬度。

## 2026-10-16 區域分析：附近同業收費（`feature/peer-fees-20261015`）

使用者 10-15 要區域分析「撈更多資料去比對」，目的選附近同業比較（範圍 B：收費落點＋空間服務＋托嬰月費）、口徑選「只和私立一般比」。規格 `docs/specs/2026-10-15-peer-comparison-design.md`、計畫 `docs/superpowers/plans/2026-10-15-peer-comparison.md`。

- **畫面**：區域分析在地圖下方（在籍學生之後、招生機會之前）多「附近同業收費」：選 2–5 歲，看本校全日班一學期公告收費在半徑內**私立一般**園所裡的中位數、範圍、排名、落點條與逐項對照；準公共、公立、非營利只列公告收費當背景，註明家長另有政府補助、這是公告收費不是家長實付，不試算家長實付。各所收費表與逐項表可匯出 CSV（檔名帶年齡，未知金額留空不寫 0）。
- **附近清單**：附近幼兒園列尾改成該年齡的學期公告收費（不再顯示 kiang 估計的月費），展開看每位幼生室內／戶外面積、幼童專用車、兼辦國小課後、逐項收費與交通費原文；附近托嬰加月費、評鑑等級、準公共，摘要對照本校 2 歲班月均。
- **資料**：kiang 整理的教保資訊網收費檔（**目前 114 學年**：115 學年在驗證碼後面，不繞過）與社家署托嬰逐所明細，都在 kiang.github.io。背景同步在幼兒園／托嬰名單更新後接著抓，從沒匯入過時第一輪就抓；殘缺、下載錯誤太多、學年倒退都不換版。同業分組用收費學年的準公共期間。migration `f2b8c4d1e7a9`（接在在籍學生 `f2a7c1e9d4b3` 之後）只新增。上線與驗收見 `deploy/README.md`「幼兒園收費與托嬰明細」。
- **真實資料閘門**（2026-10-16 本機完整網路同步）：收費 114 學年 603 所、托嬰明細 152 所全抓到。義華 3 公里私立一般 23 所、19 所有收費，3 歲中位數 75,270 元（40,200–114,600），本校 89,750 元第 8 高；2 歲中位數 83,000、本校 105,950 第 4 高；準公共 25 所中位數 63,190；五校都對到本校、本機構都排除在同業之外。
- **驗證**（Node 22、本機 PostgreSQL，HEAD `db80b1f5`，**未 push、未部署**）：後端全套 3446 passed、1 skipped（獨立測試庫 `ivy_website_peerfees_test`）；後台全套 2571 passed、1 skipped，typecheck 零錯誤；契約 `--check` 兩項一致；alembic 單一 head；stack e2e 整套 144 passed（`ivy_website_peerfees_e2e_test`）。
- **合併注意**：`feature/admin-wave2-20261015` 的 migration 也接在 `f2a7c1e9d4b3`，後上 main 的那支要改 `down_revision`；`feature/admin-wave1-20261015` 系統狀態頁的資料種類中文名要補「幼兒園收費」（`kindergarten_fees`）。

## 2026-10-15 幼兒園營業中改以教育部名單判斷（`fix/kindergarten-registry-20261015`）

使用者問區域分析「附近園所的變化」會不會出現最近停業的園所（三民區的愛爾蘭、童年綠地）。查證發現 kiang `preschools.json` 的 `is_active` 一旦是 1 就不會變回 0，高雄有 47 所已不在教育部名單仍標營業中，幼兒園停辦因此從沒記過。規格 `docs/specs/2026-10-15-kindergarten-registry-design.md`。

- **判斷**：同步多抓 kiang `docs/data/高雄市.csv`（教育部名單），（立案文號、名稱）在名單上才算營業中；抓不到或格式不對，幼兒園整輪不換版。
- **改名**：同地址、同設立日的另一筆在名單上＝改名或換承辦，只下架、不記停辦。
- **回補**：`backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`（`scripts/build_kindergarten_closures.py` 從名單歷史算出，47 筆）：有離開日的停辦 16 所（其中近 12 個月 14 所）寫在實際離開名單那天；2025-06 前就離開名單、沒有日期的停辦 17 所只下架；改名或換承辦 14 筆（13 筆有離開日、近 12 個月 9 筆，日期只是紀錄）也只下架、不寫事件。腳本由新到舊逐版掃描名單歷史，不用二分搜尋（歷史有殘缺版本，有些改名是 2025-06 之後才出現在名單、之後又離開）。這份檔**同步每一輪都會讀，不要刪**。（2026-10-20 起由 `kindergarten-closures-20261020.csv` 取代並已移除，見頂部「招生潛力第二、三波」一段。）
- **畫面**：版面不變；「附近幼兒園」清單與數字少掉幽靈園所（各校見下表）；變化區塊小字改成只說類型變動與托嬰從哪天起記錄。
- **各校影響**（以 2026-10-15 為基準）：離線用 2026-10-15 的 kiang `preschools.json` 與教育部名單，以各校校址（門牌座標）算直線距離；「少」指 kiang 標營業中、但不在名單的園所數（高雄全市 736 → 689，少 47）。右欄是 3 公里內、會出現在「附近園所的變化」的近 12 個月停辦（來自回補檔，離開日 2025-10-16 之後；喬美等改名的不出現）。

  | 校 | 1 km | 3 km | 6 km | 3 km 內會出現的近 12 個月停辦 |
  |---|---|---|---|---|
  | 義華 | 2 | 9 | 18 | 聖愛、童年綠地、理幼、愛爾蘭 |
  | 明華 | 1 | 5 | 16 | 聖愛、一二三 |
  | 崇德 | 0 | 3 | 12 | 一二三 |
  | 國際 | 1 | 9 | 18 | 聖愛、童年綠地、理幼、愛爾蘭 |
  | 仁武 | 0 | 2 | 12 | 無 |

  近 12 個月視窗會隨日期往後走：2026-10-23 起理幼、一二三（2025-10-22 離開名單）掉出視窗，3 公里內的近 12 個月停辦變成義華、國際 3 所、明華 1 所、崇德 0 所。

- **上線**：不新增 migration；推 main 後下一輪幼兒園同步（每 7 天）自動套用。要立刻生效得手動 `geo-sync --force`（會連門牌一起強制重抓，Railway 連不到高雄市資料平台時門牌 failed、結束碼 1，幼兒園照樣更新）。**`--force` 會同時略過 80% 殘缺護欄**，跑之前先確認名單筆數正常（`curl -s 'https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv' | wc -l` 約 690 行，含標頭）：名單歷史出現過只有一半的殘缺版本（2025-07-09 只有 351 列）。
- **轉換輪的預期值**（上線後第一輪幼兒園同步；回補檔 47 筆，以 2026-10-15 的檔為準）：Railway api 日誌（背景同步迴圈才印 INFO，手動 `geo-sync` 不印）會有一行「幼兒園資料已更新：689 所，略過 … 筆、名單有但沒有座標 … 筆；停辦事件 16、依回補檔下架 33、改名下架 14、重新營業 0、類型變動 0」。
  - 營業中約 **689**（10-15 的名單 689 所，之後名單有增減就跟著變）。
  - 停辦事件＝回補檔有日期的停辦 **16**（日期介於 2025-08-22 與 2026-10-13），另加 10-15 之後才離開名單的（沒在回補檔裡，日期記同步當天）。
  - 依回補檔下架＝回補檔 `closed` 列數 **33**（含 17 筆沒日期、只下架不寫事件的）。
  - 改名下架＝回補檔 `renamed` 列數 **14**，另加規則（同地址、同設立日）認出的新改名。
  - 重新營業、類型變動不在這次改版的預期內，通常是 0；不是 0 就逐筆看。
  - 查資料庫（Railway Postgres 的 Database 分頁）：`select change, occurred_on, count(*) from geo_provider_events where provider = 'kindergarten' group by 1, 2 order by 2;` 與 `select count(*) from geo_kindergartens where is_active;`。
- **驗證**（2026-10-16，Node 22、本機 PostgreSQL；程式在 `94379745`，之後的總審查修正見本段最後一條；**未 push、未部署**）：
  - 後端全套 3180 passed、1 skipped、0 failed（32 分 57 秒，獨立測試庫 `ivy_website_kgreg1015_test`）。
  - admin 全套 161 檔：一次跑 143 檔通過，18 檔 71 個失敗，其中 70 個是 5 秒逾時、1 個是 `openRequestsUx` 的計數斷言（當時機器 load average 36–48，被其他 session 壓著）。這 18 檔加 `--testTimeout=60000` 重跑 428 passed。admin `typecheck` 無錯誤。
  - stack：只跑 `tests/stack/admissions-area.spec.ts`（含成對匯入與新的小字）13 passed（1.5 分，自訂 `E2E_DB_NAME`、埠 8751／3751）；沒跑 stack 整套。
  - 回補檔用 `scripts/build_kindergarten_closures.py` 實跑產生（10-15 名單 689 所、回補 47 筆），近 12 個月停辦 14 所與規格附錄 A 一致；改名或換承辦近 12 個月 9 筆（5 組）見規格附錄 A 末段。
  - API 與契約沒變，沒跑契約產生。repo 沒有 ruff 設定、CI 也不跑；改動檔案裡新增的提示（UP017、I001 之類）與既有寫法同類，沒有處理。
  - 沒有登入正式後台看畫面；正式站要等推 main 後下一輪幼兒園同步才生效。
  - 總審查修正（2026-10-16）：`scripts/build_kindergarten_closures.py` 改成由新到舊逐版掃描；重跑（kiang head `b9188e98e7`、187 版，約 2 分 20 秒）後 33 筆停辦的 `source_id`、`left_on` 與舊檔逐筆相同，改名 14 筆裡 7 筆補上日期（陽光沐夏 2025-09-12、八方 2025-09-17、中芸辦理 2025-12-31、中芸國小代管與王公國小代管 2026-01-19、碩苗代管 2026-01-31、林園郵局 2026-07-23），並用另一支獨立的逐版線性掃描對過 47 筆全部一致。同批改日誌文字、缺檔改丟 `BackfillFormatError`、文件數字。跑了 `tests/test_geo_closure_backfill.py` 25 passed、`tests/test_geo_providers.py` 44 passed、`tests/test_geo_sync.py` 72 passed、admin `nearbyProviders.test.ts` 17 passed；上面的後端全套、admin 全套與 stack 數字是這次修正前的，沒有重跑（這次動到的是回補檔 `renamed` 列的日期，同步不讀）。
  - 合併 `origin/main` `9dbf413f`（在籍學生分布、區域分析驗證後的修正；只有 README.md 衝突）後，在 `51bd6710` 重跑：後端全套 3316 passed、1 skipped、0 failed（20.9 分，測試庫升到 `f2a7c1e9d4b3`）；admin 全套 161 個檔案、2532 passed、1 skipped；admin `typecheck` 無錯誤；重新 `e2e:build` 後 stack `admissions-area.spec.ts` 15 passed。

## 2026-10-15 在籍學生分布（`feature/enrolled-map-20261015`）

招生區域分析的地圖多一個「在籍學生」模式：每位在籍學生一個點（座標取整約 100 m，同一格合併），可依班別篩選（幼幼班、小班、中班、大班；115 學年，以 9/1 足歲為基準），地圖下方有距離分布與里排行兩張表（可匯出 CSV，內容只有聚合數字）。規格 `docs/specs/2026-10-15-admissions-enrolled-map-design.md`，匯入步驟見 `deploy/README.md`「在籍學生匯入」。

- **資料**：清冊地址只在本機比對（`enrolled-match`），正式站只匯入去識別 JSON（`enrolled-import`：pydantic `extra="forbid"`、區與里白名單、座標最多 3 位小數且在高雄市範圍框內）。只存班別、區、里、比對等級、原因與取整座標；migration `f2a7c1e9d4b3` 只新增兩張表，不需備份。教保資訊網匯出的地址多半沒寫行政區：用里名或路名在門牌表找候選區，有點的候選之間，精確門牌只在不比最近的候選遠超過 1 公里時才優先；清冊常見的異體字（徳→德）只在清冊比對時對應成門牌表用字。
- **權限**：`admissions.read` 加校區範圍（總部、該校 `campus_admin`、`reception`）；`editor`、`readonly` 回 403。
- **限制**：快照固定在比對時的門牌版本（圖例寫出清冊日期與門牌版本；正式站門牌換版後再匯入，指令會印出提醒）；錯字或門牌表沒有的號碼不做模糊比對，列在「沒有點」；資料讀取中不顯示骨架，沒匯入的校會先出現再收合；目前只匯了義華。
- **不做**：後台上傳、門牌換版後自動重比、其他四校（有檔案再用同一流程）、熱力圖與聚合群集。
- **驗證**（Node 22、PostgreSQL、本機 Chrome；2026-10-15／16；程式碼在 `4f4e26dd`，`origin/main` 仍是 `aae0debc`；**未 push、未部署**）：
  - 後端全套 3235 passed、1 skipped、0 failed（26.7 分鐘，獨立測試庫）。
  - admin 全套 161 個檔案、2530 passed、1 skipped、0 failed；admin `typecheck` 無錯誤；契約檢查一致（在 worktree 自己的 venv 跑 `npm run contract:check`）；web `typecheck` 無錯誤、`test:website` 1228 passed（在 `5d02f2f8` 跑，之後 web 沒有變動）；alembic 單一 head `f2a7c1e9d4b3`。
  - 完整 stack 套件（在 `4f4e26dd` 重新 build）142 passed、0 failed（8.6 分鐘），含本案 2 個案例（點與合併格、班別篩選、圖例、距離分布、沒匯入的校按鈕停用、axe、390px 不橫向溢出）。
  - 真實清冊本機比對（主 session 執行，清冊與比對結果不進 repo）：192 位，有點 180 位（93.8%），其中推定（多區同名取近、里名對不上）29 位；沒有點 12 位（只對到里 1、只對到區 7、外縣市 1、對不到 3）。本機用真底圖截 1440／390 畫面人工看過，截圖未提交。
  - 各任務與整支分支都經過獨立審查；審查中修掉的實質問題：報告遮罩對沒有路街的地址會印出棟樓、輸出列序可能對回清冊、規格與測資帶有真清冊衍生的例子、兩則地圖測試拿掉實作也會過、換半徑後幼兒園點蓋過學生點、同名路遠處精確門牌勝過近處門牌（與整數公里分桶的邊界問題）、比對錯誤可能帶出 SQL 參數、匯入缺區里白名單、圖例沒寫門牌版本。
  - 合併 `origin/main` `1ca98981`（區域分析驗證後的修正，只有 README.md 衝突）後，在 `42984079` 重跑：後端全套 3256 passed、1 skipped、0 failed（20.7 分鐘）；admin 全套 161 個檔案、2531 passed、1 skipped；admin 與 web `typecheck` 無錯誤；契約檢查一致；完整 stack 套件（重新 build）142 passed、0 failed（6.8 分鐘）。
  - **沒做**：沒有登入正式後台看畫面；未部署（正式站匯入步驟見 `deploy/README.md`「在籍學生匯入」，匯入後要刪掉 volume 上的 JSON）。

## 2026-10-15 區域分析驗證後的修正：國小學區整里／部分、招生機會沒填地址（`fix/area-data-fixes-20261015`）

義華正式站的區域分析逐項對原始公開資料重算過，數字全部吻合（門牌、87 所幼兒園、18 所托嬰、98 個里的人口與變化、出生走勢、新屋交屋、可能範圍）；只有下面的標記與文案要修。

- **國小學區整里／部分**（`backend/scripts/build_school_districts.py` 重轉 `school-districts-115.csv`，只有 `coverage` 欄改變）：轉換腳本只認「全里」，一覽表把整個里拆成幾段鄰寫的（灣中里鼎金國小「1-8、10-24、26 鄰」＋「9、25 鄰與民族國小自由學區」、只有一所學校的前峰里「1-34 鄰」）47 列被標成部分；另外自由學區那句的正規式會跨過「鄰」，「1-8鄰與忠孝國小自由學區」整段被當成整里，隆昌里兩所、興邦里瑞祥國小、西燕里安招國小 4 列反過來誤標整里。現在一所學校列的鄰涵蓋一覽表為這個里列出的所有鄰就算整里；光明里大東國小是一覽表跳號，用新的 overrides `full`。新增選用的 `--doorplates`，拿門牌的「鄰」核對整里／部分（只出報告），115-10 全部 302 個只寫鄰的（里、學校）只剩自助里一個例外（只有永清國小、一覽表寫到 23 鄰、門牌有 24 鄰，照整里）。義華「依國小學區」受影響的是大東、文山、新甲、鼎金、正興、獅湖、民族（例：新甲「8 里＋部分 2 里」→「9＋1」）；孩子數、淨增、參觀加總不變。
- **招生機會「沒對到里」**：`/area/opportunity` 多回 `no_address_visit`（`unplaced_visit` 裡沒填地址的），總結改寫「N 位沒填地址、M 位沒對到里」（義華 3 位都是沒填地址，原本寫成沒對到里）；有參觀但參觀率四捨五入是 0.0%（1 ÷ 9,788）時寫「參觀率不到 0.1%」。距離分布註腳補上「沒填地址」。
- **新屋 63 筆只到區**：是 10-14 跨區界道修正前存的比對（七賢一路 61–95 號，門牌在新興區順昌里、3 公里外）。同日使用者用 `--new-homes-file` 重匯 114S4–115S3 四季（不需要這個分支），正式站 `unplaced` 63 → 0、3 公里內 1,524／469 筆不變，經過見 `deploy/README.md`。
- **驗證**（Node 22、PostgreSQL、本機 Chrome；2026-10-15，從 `origin/main` `aae0debc` 開）：
  - 學區：用 115 學年一覽表 PDF（sha256 與 `geo_data/README.md` 記的相同）重轉，舊腳本先重產出與 repo 完全相同的檔；新腳本只改 51 列 `coverage`、學校檔不變；另用獨立的門牌稽核腳本逐列複查，沒有「鄰都涵蓋卻標部分」的列。
  - 後端全套 3158 passed、1 skipped、0 failed（19.3 分，獨立測試庫）；admin 全套 161 個檔案、2507 passed、1 skipped；admin `typecheck` 無錯誤；`npm run contract:generate`／`contract:check` 一致（worktree 自己的 venv）；本案沒有 migration。
  - stack `admissions-area.spec.ts` 13 passed；1440px 截圖裡招生機會寫「參觀 2 位（參觀率不到 0.1%）…另有 1 位沒對到里」（那筆是臺南地址，有填地址）、距離分布註腳已含「沒填地址」。
  - 沒驗：正式站畫面（要部署後登入看）；web `typecheck` 沒跑（沒改 web）。

## 2026-10-15 預約全程漏斗與退出時點（`feature/booking-journey-20261015`）

招生判讀四個子專案的第四個（最後一個）。統計分析多一個子分頁「預約全程」：官網預約與後台補登的同一批預約案件，從預約、到場、有招生訪視、預繳、註冊各階段的人數與比率（附分子分母），各段花多久（預約提前量、參觀到預繳、預繳到註冊、預繳到退出，中位數與筆數），以及家庭離開的時點（取消距參觀日幾天、沒來、時間已過未標記、已到場但沒有訪視、參觀後未預繳的觀察中／逾期／冷名單、預繳後退出）。規格 `docs/specs/2026-10-15-booking-journey-design.md`（§8 列與規格的差異），規則見 DESIGN.md「招生入學：預約全程漏斗與退出時點」。

- **資料**：讀取時彙整，不新增 migration、不改資料表；時間取自預約事件（提早到場的到場日、是否改期過）、招生事件（`deposit_added` 的預繳日）與既有欄位（場次日期、取消、註冊、退出）。唯讀，不寫稽核。
- **涵蓋**：只含有預約案件的家庭；沒有預約案件的訪視、已到場但沒有訪視、預定參觀日算不出來的案件各自列筆數，不估算。招生功能關閉期間到場、事後沒補建的案件會讓漏斗後半段偏低。
- **權限**：`admissions.read` 加校區範圍；editor、readonly 看不到這一頁（10-13「參觀預約」搬走後留下的入口問題不能由這頁補回）。
- **限制**：預繳日取最後一次標記，補登或事後標記會讓天數偏長；退註冊時後台會清掉註冊日（funnel 轉換），所以退註冊的家庭不進「預繳到註冊」天數，列在不納入筆數；若要含退註冊者，須改讀 `converted` 事件日（規格變更，待業主決定）。單位是預約案件，不是家庭：取消或沒來後重新預約的家庭會有兩筆案件（舊案留在取消／沒來）；不另做重新預約的去重或統計（超出規格，待業主決定）。手機 390px 時漏斗「比率」欄與離開表「時點」欄要在表格框內橫向捲動；自訂區間尚未選日期時網址帶空的 `jf`／`jt`，重新整理後退回預設 90 天。沒有登入正式後台看過畫面，也沒查過正式資料的連結率。
- **不做**：預測與評分、退出原因統計（自由文字、無代碼）、首次聯絡延遲、跨校合併、補欄位。
- **驗證**（Node 22、PostgreSQL、本機 Chromium；2026-10-15；程式碼與測試在 `6e040835`，`origin/main` 仍是 `7ae6de45`；**未 push、未部署**）：
  - 後端全套 3136 passed、1 skipped、0 failed（21.7 分鐘，獨立測試庫）。全套跑在 `975bad7a`，其後 `backend/app` 與契約沒有變動，只改了兩個預約全程測試檔；那兩檔在 `6e040835` 另跑 44 passed；`ruff` 無錯誤。
  - admin 全套 161 個檔案、2506 passed、1 skipped、0 failed；admin 與 web `typecheck` 無錯誤；契約檢查（不經 `uv run` 的 `export_openapi.py --check` 加 `check-contract-types.mjs`）一致；本案沒有 migration，alembic 仍是單一 head `c6a9e3f15d27`。
  - 完整 stack 套件（`6e040835` 重新 build）140 passed、0 failed（5.4 分鐘），含本案 2 個案例（1440／390：漏斗、離開、取消時點、各段天數、涵蓋說明、axe、不橫向溢出）；與 `admissions-area.spec.ts` 同一次執行時涵蓋說明改用「同校既有訪視數」的相對基準。390px 截圖人工看過：頁面不橫向溢出，但漏斗「比率」欄與離開表「時點」欄要在表格框內橫向捲動才看得完（沿用統計表既有窄版行為）。
  - 各任務與整支分支都經過獨立審查；審查中修掉的實質問題：涵蓋說明與來源篩選的關係沒有測試釘住、取消時點「不納入」的筆數沒有顯示、匯出 CSV 檔名帶入學學年學期、窄螢幕自訂區間日期選單可能溢出、e2e 被 `admissions-area.spec.ts` 在同校留下的訪視弄紅（改相對基準）、退註冊家庭的說明寫錯且測試資料是不可能出現的形狀、「單位是預約案件」沒說明、切子分頁時背景重複讀取、規格狀態過時。
  - **沒做**：沒有登入正式後台看實際畫面；沒有查正式資料裡招生訪視連到預約的比例，所以漏斗後半段的數字在正式資料上是否可信未驗證；未部署。

## 2026-10-14 多年出生數走勢（`feature/birth-series-20261014`）

招生判讀四個子專案的第三個。「商圈出生趨勢」的主體（近 12 個月出生、前一年同月份比）早已在「里的變化」A 段上線，這次補它缺的兩件事。規格 `docs/specs/2026-10-14-birth-series-design.md`，規則見 DESIGN.md「招生入學：多年出生數走勢」。

- **補缺月**：出生改抓戶政 ODRP061（取代 ODRP010，逐里數字相同），補上 113-10、113-11、114-01，前一年同月份比滿 12 個月。111-03 兩個資料集都查無，永久缺月。
- **多年走勢**：區域分析「里的變化」多一塊「近幾年的出生數」：本校半徑每 12 個月一期、最多 6 期（109-10 起），每期出生數與和前一期的增減（只比兩期都有的月份），缺月寫出來；只描述、不預測。
- **同步**：出生表留 72 個月（其餘 25 個月）；預估約 50 個請求（5～8 分鐘、約 55 MB），正式站還沒實測；沒到頭隔天續補。沒有 migration。
- **小半徑**：前一期可比出生不到 20 位不給百分比，所以 1 公里半徑原本顯示的「比前一年同期少 N%」可能變成不顯示；3 公里以上通常不受影響。
- **不做**：預測、里層級走勢、依性別拆開、估算缺月、更早的年份、公開官網顯示。
- **驗證**（Node 22、PostgreSQL、本機 Chromium；2026-10-14／15；已併入 main `c13f2c88`〔里的變化 B2〕，程式碼在 merge commit `2054facd`，其後只有文件 commit）：
  - 後端全套 3093 passed、1 skipped、0 failed（18 分鐘，獨立測試庫）。
  - admin 全套 159 個檔案、2468 passed、1 skipped、0 failed；admin 與 web `typecheck` 無錯誤；契約檢查（不經 `uv run` 的 `export_openapi.py --check` 加 `check-contract-types.mjs`）一致；alembic 單一 head `c6a9e3f15d27`（本案沒有 migration）。
  - 完整 stack 套件（合併後重新 build）138 passed、0 failed（5.3 分鐘），含 `tests/stack/admissions-area.spec.ts` 新增的 2 個案例（6 期、缺月註明、增減只比兩期都有的月份、位置、axe、1440／390 不橫向溢出）；截圖 1440／390 人工看過。
  - 各任務、整支分支與整合 main 都經過獨立審查；審查中修掉的實質問題：手機版欄位對不齊、期間標籤在手機換行時拆開「9／月」、桌機版留白過大、兩個會空轉的位置斷言、三個門檻缺邊界測試、把預估寫成事實的文件、文件與 main 的實測紀錄矛盾。
  - **沒做**：沒有在正式站實跑 72 個月回補（請求數、時間、用量是預估；正式站目前出生表 21 個月）；沒有登入正式後台看實際畫面；部署後第一輪的結果要看 `geo_dataset_status`（見 `deploy/README.md`）。

## 2026-10-14 招生區域：里的變化 B2 段（新屋交屋上畫面）與跨區界道比對（`feature/village-new-homes-b2-20261014`）

規格 `docs/specs/2026-10-14-admissions-village-trends-design.md` §12 的 B2，實作與規格的差異見該檔 §18，規則見 DESIGN.md「招生入學：里的變化」。三個 commit，**未 push、未部署**。

- **閘門**：台灣網路實測命中率（門牌 115-10 全量 775,772 筆＋115S3 季檔）：到里 98.9%（3,805 筆裡 exact 3,765），過 90%；補下面的跨區界道後 99.9%（exact 3,801，只剩 4 筆只到區）。結果寫回規格 §2.2。
- **跨區界道比對**（獨立一個 commit）：實價登錄寫「苓雅區七賢一路 61–95 號」，門牌表整條七賢一路登在新興區，所以 31 筆新成屋（八季共 63 筆）只到區。地址的區在門牌表完全沒有這條街路段、整個門牌表只有一個別的區有，才改用那個區比對，回傳的區也跟著門牌表走；同名街路段（中山路）不猜。**已存的新成屋與訪視要等下一次門牌換版才會重比**（部署注意見 `deploy/README.md`）。
- **B2 本體**：`/area/trends` 多 `sources.new_homes`、`villages[].new_homes`／`new_homes_latest`、`baseline.new_homes*`；後台「里的變化」表多「近 4 季新屋」欄（CSV 多「最近一季新屋」）、總結多一句、地圖第五種著色「新屋交屋」。新屋交屋不等於已入住、也不等於有孩子，說明寫在表格底下。沒有 migration。
- **合併組在地圖上依各里自己的筆數上色**（和規格 §5.6 的刻意差異，獨立一個 commit，要照規格不上色就整個還原）：真資料 6 公里內新屋交屋最多的兩團（左營區 17 個里 871 筆、仁武區八卦里＋八德里 639 筆）都是合併組，不上色地圖會是空白。API 多回 `new_homes_by_code`。
- **驗證**（Node 22、PostgreSQL、本機 Chrome；2026-10-14，數字註明跑在哪個 commit）：
  - 真資料（本機示範庫：門牌 115-10 全量、`fetch_geo_bundle.py` 打包檔、kiang 幼兒園）：八季 26,035 筆，到里 25,972、只到區 63；義華 1／3／6 公里近 4 季新屋交屋 352／1,524／6,944 筆，沒對到里 0／0／1 筆；七賢一路 364 筆全對到里。Playwright 1440／390（3 與 6 公里）截圖人工看過：表格、總結、地圖與圖例，沒有橫向溢出、沒有 console 錯誤；6 公里時合併組也有顏色。
  - 後端（最終程式 `69cca639`）：geo、招生、稽核、權限相關 1232 passed（`tests/test_geo_*.py`、`test_admissions_*.py`、`test_audit_actions.py`、`test_audit_coverage.py`、`test_permission_table.py`；10 分 56 秒，獨立測試庫）。**不是後端全套**。
  - 後台（Node 22、`--testTimeout=60000`）：全套 157 檔、2456 passed、1 skipped，`typecheck` 無錯誤。第一次用預設 Node 25＋5 秒逾時有 71 個失敗（逾時與 `localStorage` 環境問題，都不在區域分析），改 Node 22 後整套重跑全過。
  - 契約：`contract:generate`；`export_openapi.py --check` 與 `check-contract-types.mjs` 一致。
  - **沒跑**：web、Playwright e2e／stack 套件、正式站。

## 2026-10-14 托嬰中心與園所異動（`feature/provider-changes-20261014`）

招生判讀四個子專案的第二個（前一個是場次使用情況）。規格 `docs/specs/2026-10-14-provider-changes-design.md`，規則見 DESIGN.md「招生入學：托嬰中心與園所異動」。

- **托嬰名單**：kiang 每天整理的衛福部社家署公開資料（`babycare.json`，高雄 160 筆、營業 151），併進公開資料同步（表 `geo_babycare`）。後台區域分析的「附近幼兒園」卡片頂端可切到「托嬰中心」，列出半徑內的托嬰中心與托育家園（核定、實際收托、距離），地圖多一個預設不勾的菱形圖層。
- **園所異動**：幼兒園與托嬰的同步從「刪光重寫」改成依 `source_id` 比對，停辦的標 `is_active` 假、列留著，新設、停辦、類型變動記在 `geo_provider_events`；卡片下方新增「附近園所的變化」（近 12 個月）。新設的幼兒園看設立日，上線第一輪同步後就有；停辦與類型變動從基準日（第一次用新程式同步成功的日子）才開始累積，畫面會寫「從 N 月 N 日起記錄」。
- **頻率**：幼兒園與托嬰改成每 7 天看一次來源（門牌、人口維持 30 天）。
- **防誤報**：8 月學年更替不產生假的類型變動；準公共期間續約或換期間（舊列與新列都是私立、兩邊都有期間字串）不算類型變動——否則續約那一輪（高雄 268 所的期間是「113-115」）三公里內會冒一串假異動，取捨與限制見規格 P7；停辦後 30 天內又出現視為來源漏收；新名單營業中數量少於上次 80% 不換版（`geo-sync --force` 略過）。
- **migration** `c6a9e3f15d27`（接在 main「里的變化」的 `e4f1a8c6b203` 之後）：新增 `geo_babycare`、`geo_provider_events`，`geo_kindergartens` 加設立日、`geo_dataset_status` 加基準日並多收 `babycare`；不改既有資料，不需要部署前備份。
- **不做**：核定人數與月費估算的異動、托嬰分配到里、收托比例與趨勢、預測、點變化列定位地圖、匯出 CSV。一年下來單一校 3 公里內新設或停辦大約各 0～1 件，所以變化區塊多數時候是空的。
- **驗證**（Node 22、PostgreSQL、本機 Chromium；2026-10-14，最後一次是併入 main `1cddfc3a` 之後；數字註明跑在哪個 commit）：
  - 後端全套（合併 commit `fc404ff7`）3067 passed、1 skipped、0 failed（24 分鐘，獨立測試庫）；之後只改兩個測試檔與文件，改過的 `test_geo_babycare_sync.py`、`test_geo_loop.py` 單獨跑 68 passed。
  - admin 全套（同上）157 個檔案：第一次 151 個檔通過、6 個檔共 11 個案例因高負載逾時（`Test timed out in 5000ms`，沒有斷言錯誤），那 6 個檔改 `--testTimeout=60000` 重跑 182 passed；admin 與 web `typecheck` 無錯誤；`contract:check`（不經 `uv run` 的等價指令：`export_openapi.py --check` ＋ `check-contract-types.mjs`）一致。
  - 完整 stack 套件（合併後重新 build）：整套 130 passed、6 個逾時（27.7 分鐘，當時 load 約 16、別的專案同時在跑 pytest／vitest；合併前同一套 136 passed 只要 5.3 分鐘）。逾時的 6 個（後台橫向溢出 ×2、素材影片、素材照片、重設密碼、場次）第一次單獨重跑 5 個通過、`media.spec` 仍失敗（公開首頁 10 秒內沒換上新照片）；`media.spec` 單獨跑 5.0 秒通過，同一組 5 個檔在較低負載下再跑 14 passed。本分支沒有改 `web/`、`backend/app/content`、`backend/app/media`，判斷為負載造成的時序問題，**但沒有在乾淨負載下把整套 136 個一次跑完**。
  - 截圖 1440／390 人工看過（合併後）：切換鈕在卡片頂端、「附近園所的變化」在正下方、下接「里的變化」與依小學區等表；手機切到托嬰後地圖出現菱形、圖例分組、無橫向溢出。fixture 沒有「孩子增減」資料，所以托嬰菱形與減少色（同為玫瑰色相）疊在一起的畫面沒有實際看到；整合審查用色彩計算判斷不混淆（菱形有白邊、畫在里界之上，OKLab ΔE 約 0.18），亮度對比約 1.9:1，醒目度是弱點。
  - 各 task、最後整支分支與整合都經過獨立審查；審查過程發現並修掉的實質問題：設立日年份極大時整批解析失敗、重新營業的幼兒園不比類型、準公共續約會冒一整批假的類型變動、切到托嬰後換校區地圖圖層沒跟著開、兩邊都沒記錄時畫面先說沒有變化。
  - **沒做**：沒有在正式站與真實資料上驗證；沒有登入正式後台看實際畫面；部署後第一輪同步的結果要看 `geo_dataset_status`（見 `deploy/README.md`）。
- **併入 main 的「里的變化」**（PR #40／#43／#44／#45，用 merge、不改寫既有 commit）：migration 改接 `e4f1a8c6b203`，`ck_geo_dataset_status_dataset` 取聯集（main 的八種再加 `babycare`）；同步（各自成敗、各自的時間上限）、CLI 參數與輸出、背景迴圈摘要（改成看全部種類）、後台區域分析（地圖「孩子增減」著色＋托嬰圖層、右欄切換名單＋附近園所的變化、里的變化與國小學區表）兩邊都留；契約重新產生。合併後跑過：geo 與招生區域相關後端測試 933 passed，權限表、稽核、招生契約、schema guard 21 passed；測試庫重建後 `alembic upgrade head`、`downgrade e4f1a8c6b203`、再 `upgrade head` 與 `deploy/check_schema.py` 都過；admin 區域分析相關 8 個檔 240 passed、`typecheck` 無錯誤；根目錄 `contract:check` 一致。合併後的全套驗證結果見上方「驗證」。

## 2026-10-14 招生區域：里的變化 B1 段（新成屋同步與門牌比對；`feature/admissions-new-homes-20261014`，疊在 D 段 PR #44 上）

照規格 §12 做 B1：只做同步與比對，**API 與畫面都不加**（業主確認命中率量完前不上畫面）。B2（`new_homes` 欄位、「近 4 季新屋」欄、「新屋交屋」著色）要先在台灣網路跑命中率報告、到里 ≥ 90% 才做。**未部署**，要等 A、C、D 段先合併。

- **資料**：內政部實價登錄高雄市買賣季檔（`https://plvr.land.moi.gov.tw/DownloadSeason?season=115S3&fileName=e_lvr_land_a.csv`，一季約 3.5 MB）併進公開資料同步，留最新季往回 8 季。季別或檔案不存在時來源回 HTTP 200 的錯誤頁，當成那一季還沒出；約一成請求被 reset，沿用 C 段的重試。
- **新成屋（V7）**：交易標的含建物、主要用途含住、建築完成年月在登記期間迄日的月份往前 12 個月內，含預售屋交屋。115S2 2,892 筆、115S3 3,805 筆，和規格實測相同。
- **比對**：沿用門牌比對（`matcher.locate_parsed`，從 `locate` 拆出），只存門牌鍵與比對結果，不存地址原文、價格、面積。門牌尚未匯入時是 pending；同步結束時，比對時門牌月份和使用中不同的列整批重比。migration `e4f1a8c6b203` 只新增 `geo_new_home_sales`、放寬一個約束。
- **順手修**：`address.py` 讀「２號之１三樓」會丟掉之號（阿拉伯數字之號接中文數字樓層），家長地址也受益。
- **CLI 與工具**：
  - `geo-sync --new-homes-file 115S3_e_lvr_land_a.csv [--new-homes-season 115S3]`。
  - 打包檔帶 8 季。
  - `geo_match_report.py --new-homes <檔> --season 115S3` 量到里（exact＋nearby＋street）的比例，門檻 90%。
- **真資料實測**：本機用 CLI 匯入 113S4～115S3 8 季共 26,035 筆、3,413 個門牌鍵，約 34 秒，表約 5 MB。本機只有 73 筆門牌樣本，比對幾乎都只到區，不代表命中率。
- **驗證**：
  - `test_geo_new_homes.py`（季別、V7 篩選與邊界、錯誤頁、回補 8 季、較新季覆蓋、reset 重試、中途失敗、比對各等級與 pending、門牌換版重比、檔案、CLI、打包）。
  - `test_geo_address.py` 加「號之１三樓」。
  - `test_geo_sync.py` 的假網站補上所得、新成屋來源。
  - geo 相關測試共 179 過。
- **未驗證**：命中率（雲端與正式站都連不到 `data.kcg.gov.tw` 下載門牌）；正式站能不能連 `plvr.land.moi.gov.tw`。

## 2026-10-14 招生區域：里的變化 D 段（國小學區；`feature/admissions-school-districts-20261014`，疊在 C 段 PR #43 上）

照規格 §12 的順序接著做 D 段。業主 10-14 確認用 115 學年版上線（V10）。**未部署**，要等 A、C 段先合併；D 段沒有 migration、沒有同步。

- **資料**：教育局「115 學年度國民小學學區劃分一覽表」PDF 用 `scripts/build_school_districts.py`（pdfplumber 只在腳本用，`uv run --with pdfplumber==0.11.4`）轉成隨程式提交的兩個 CSV：1,120 個（里、學校），893 個里全有學校；241 個學校單位（含 3 所分校），學校代碼取教育部國民小學名錄。人工處理的 34 列寫在 `school-districts-115-overrides.csv`、逐列有原因（改名改制、員工子女條件、里寫錯區、漏標自由學區、115-07 新設的 13 個里沿用調整前的里）。步驟與換學年的指令在 `backend/app/admissions/geo_data/README.md`。
- **計算**（`/area/trends`）：每列多 `schools`（對到的國小，部分鄰、自由學區另標）；另回 `schools[]`「依國小學區」——學區碰到半徑內任一個里的國小，每所合計整個學區（含半徑外的里）的 2–5 歲、這一年淨增（只加算得出的里）、參觀人數（母體同招生機會）與參觀率。`opportunity._visits_by_village` 改名 `visits_by_village` 共用。
- **後台**：「里的變化」表最後多一欄「國小學區」（「光武國小（部分）、陽明國小（部分）」）；下面新增「依國小學區」表（校名前加區、學區里數「4 里＋部分 6 里」、備註寫空間充裕／總量管制／大學區，先列 10 列、可匯出 CSV）。
- **真資料實測**：義華 1／3／6 公里碰到 5／29／77 所國小，查詢 223／143／206 ms；1440／390 截圖沒有水平溢出。
- **驗證**：`test_school_districts.py`（守門＋轉換腳本的文字解析，23 項）、`test_admissions_trends.py` 加學區（與招生機會共 46 過）；後台 typecheck、vitest 區域分析相關 5 檔 155 過；`npm run contract:generate`。

## 2026-10-14 招生區域：里的變化 C 段（各里所得；`feature/admissions-village-income-20261014`，疊在 A 段 PR #40 上）

使用者 10-14 交代「完成 A 後直接繼續」，照規格 §12 的順序做 C 段（A → C → D → B1 → B2）。規格 `docs/specs/2026-10-14-admissions-village-trends-design.md` §2.3、§3.3、§4.4、§5.8；業主 10-14 確認「所得要放」，只當背景（V9）。**未部署**，要等 A 段先合併。

- **資料**：財政部財政資訊中心「綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市」，最新 112 年度（約 90 KB）。併進公開資料同步：每 30 天讀一次 data.gov.tw 資料集 17971 找新年度，讀不到時直接試財政資訊中心的下一個年度（404＝還沒出）。`www.fia.gov.tw` 實測約一半的請求被 reset，下載連線失敗時間隔 2、4、8 秒重試。只存最新一個年度、對得到里界的里（112 年度 879 個，115-07 調整前的 11 個舊里略過）。migration `d8b3f6a2c914` 只新增 `geo_village_income`、放寬一個約束。
- **CLI 與打包**：`geo-sync --income-file 112_165-E.csv [--income-year 112]`（比使用中舊的年度要 `--force`，同一年度可重匯）；`scripts/fetch_geo_bundle.py` 的 zip 也帶所得。
- **畫面**：「里的變化」表最後多一欄「所得中位數」（「45.8 萬」），不著色、不排序、不進總結；里界在所得年度之後調整過（看遷入遷出表存著的月份）的里加「*」，里界調整合併的列不列（中位數不能相加）。說明照引財政資訊中心的顯名與附註「不宜逕作為衡量所得差距之參據」。CSV 拆成「所得中位數（千元）」「所得年度」「界線在所得年度後調整」三欄。
- **真資料實測**：本機匯入 112 年度後，義華 1 公里 12 個里都有所得、3 公里 98 列有 97 列（另一列是合併組）、6 公里 341 列有 338 列，三民區灣愛里標「*」；查詢 211 ms。109～112 年度四個檔解析都過（109 年度欄名「鄉鎮市區」、110 年度起誤標「縣市別」）。
- **驗證**：後端 geo、里的變化、schema、CLI、打包相關測試 127 過（新增 `test_geo_income.py` 35 項）；後台 typecheck、vitest 區域分析相關 5 檔 149 過；`npm run contract:generate`。全套結果見下方 PR 的紀錄。
- **未驗證**：正式站（Railway）能不能連 data.gov.tw 與 www.fia.gov.tw。

## 2026-10-14 招生區域：里的變化 A 段（出生、遷入遷出、孩子增減；`feature/admissions-village-trends-20261014`，PR #40）

使用者問「還有什麼公開資料可以串來提升招生判讀」，選了出生、遷入遷出、新成屋、所得、國小學區五項，業主確認口徑（孩子 2–5 歲、所得要放、學區用 115 學年版、新成屋量完命中率前不上畫面）後開工。規格 `docs/specs/2026-10-14-admissions-village-trends-design.md`，這次做 A 段；新成屋、所得、學區（B–D 段）另做。**未部署**。

- **資料**：內政部戶政司 ODRP010（各里出生）、ODRP011（遷入遷出）併進公開資料同步，各留 25 個月；人口同步順便存年齡歷史並補抓一年前的月份。migration `c5e9a1f3b7d2` 只新增三張表、放寬一個約束。ris.gov.tw 請求之間隔 3 秒（實測連抓會被擋）。出生 API 實際缺 113-10、113-11、114-01。
- **計算**（`app/admissions/trends.py`、`GET /admin/admissions/area/trends`）：這一年淨增＝本月 2–5 歲減一年前 1–4 歲；近 12 個月出生（半徑合計和前一年同月份比）；全年齡淨遷入（含同區換址）。115-07 高雄改里界（890→893 里），調整過的里同區合併成一列。
- **後台**：區域分析地圖第四種著色「孩子增減」（玫瑰色是減少，token `--area-down-1`／`-2`），招生機會下面新增「里的變化」表（可匯出 CSV）。
- **正式站連不到來源時**：`scripts/fetch_geo_bundle.py` 在台灣的電腦打包、`geo-sync --bundle` 一次匯入；步驟在 `deploy/README.md`「公開地理資料同步」。
- **真資料實測**：打包 3 分 10 秒、48 個檔、2.4 MB；義華 3 公里 98 個里、2–5 歲 9,788 位、這一年淨減 41 位，本揚里 +36，出生比前一年同 9 個月少 20.7%；仁武八卦里、八德里合併成一列。
- **驗證**：後端全套 2,707 過（合併 main 前，36 分鐘）；合併 main 後再跑 geo、里的變化、招生機會、權限表、契約 598 過；後台 typecheck、vitest 156 檔 2,377 過（合併 main 後）；`npm run contract:check`、`deploy/tests` 過；migration upgrade／downgrade／upgrade 與 `deploy/check_schema.py` 過；本機 API＋後台 dev server 用 Playwright 截 1440／390，兩種寬度沒有水平溢出。
- **未驗證**：正式站（Railway）能不能連 ris.gov.tw；真實後台資料（有參觀紀錄的校區）下的畫面。

## 2026-10-13 深度掃描 14 項（`fix/security-scan-20261013`）

Codex 對 `8c4ec20a` 做深度掃描（3 項 medium、11 項 low）。每項先對照現行程式確認成立再修。第 1、2、3、5、6、7、8、10、11 項的新測試用真並發（兩個連線、鎖住其中一個，不 mock 資料庫），都先退回修正確認會失敗、修好後轉綠；第 9、12、13 項是純函式與 MockTransport 測試。第 4 項（家長異動期限在案件鎖外檢查）已在 `fix/booking-stale-read-20261013` 修過、驗證過，那份修正與 `test_booking_stale_reads.py` 原樣帶進這個分支，沒有重做。第 14 項是政策取捨，沒有改程式。

- **預約家長連結與 session（第 1、5、7、10、11 項）**
  - 寄信 worker 讀案件時拿 `FOR SHARE`（`notifications/service.py`）：Email 與「目前有效連結」是同一個世代，信組好才放鎖再寄。後台更正 Email、換發連結都先拿同一列的 `FOR UPDATE`，所以舊信箱最多收到更正時已撤銷的舊連結。
  - 家長取消、改資料、改期在案件鎖內重驗 session（`access_service.parent_session_active`）；`revoke-access` 路由也先鎖案件列，撤銷才和卡在鎖上的家長異動序列化。
  - 家長自己更正 Email：舊連結與其他 session 作廢、換發新連結寄到新信箱；家長正在用的 session 留著（`keep_session_id`）。後台更正與家長更正共用 `_reset_access_after_email_change`。
  - 後台更正或清空 Email 時**無條件**撤銷案件所有連結與 session，不再看「有沒有有效連結」：連結已到期、兩小時的 session 還活著時，舊收件人原本仍讀得到更正後的資料。新 session 的效期也不超過來源連結的到期時間。
  - 送單重播的 `original_manage_path` 改成一次查出所有 token 再判斷，不再「先數筆數、再另查最新那條」。
- **登入憑證（第 2、3 項）**：`service.lock_user_for_session` 鎖帳號列後重驗帳號啟用與 session 有效。本人改密碼另外比對「驗證時的密碼雜湊」，被重設蓋過回 401／409（`CREDENTIALS_CHANGED`）；Google／LINE 綁定 callback 等鎖期間 session 被撤銷就拒絕新增 `google_sub`／`line_sub`。
- **保存政策（第 8 項）**：`retention_service.anonymize` 先鎖案件列、整列重讀，補填的 Email、孩子姓名、生日一併清除；每次清理順手補清「已標記匿名化卻還有個資」的舊案；清理筆數改算實際匿名化的。
- **備份與還原（第 9 項）**：新 `app/libpq.py` 把連線字串轉成 libpq 設定。`ssl`／`sslmode`、CA、客戶端憑證與密碼只走環境變數（不進命令列、不印出），認得的才轉、不認得的參數拒絕執行；DSN 的 TLS 要求蓋過行程環境裡較弱的設定。
- **公開資料同步（第 12、13 項）**：搜尋頁／資料集頁 2 MB、幼兒園名單 64 MB、人口每頁 32 MB、門牌 CSV 400 MB（以解壓縮後計，無 Content-Length 的串流也擋）；單行 64K 字元；匯入門牌總列數 150 萬（正常約 76 萬）；每種資料各有同步時間上限（45／10／30 分鐘），逾時取消並清掉半套批次。
- **後台草稿（第 6 項）**：草稿的主人也記在 sessionStorage（`claimVisitNoteDrafts`），逾時後重新整理、`previousUserId` 沒了，另一位登入時照樣清掉前一位的草稿；同一個人登回來保留。
- **沒改：第 14 項**（內容編輯可直接改已發布素材的替代文字與裁切）。現行行為有測試與後台操作畫面支持（`test_media_slots.py` 斷言 metadata 變動「本文要立刻換」），規格第 4 節卻寫「編輯不直接影響官網」「內容編輯只能送審」，兩者矛盾，等業主決定。
- 新測試：`test_booking_access_races.py`、`test_auth_credential_races.py`、`test_retention_races.py`、`test_libpq_dsn.py`、`test_geo_limits.py`，另在 `test_google_oauth.py`、`test_line_oauth.py`、`authGuardSwitchUser.test.ts` 各補案例。
- **部署後補修（10-14）**：main CI 的 stack e2e 有 1 條失敗——`editor-live-preview.spec.ts` 的資安測試要求 `sessionStorage` 全空，第 6 項新增的 `ivy-visit-note-draft-owner`（只存登入者編號）讓它多一個 key。斷言改成排除這個 key；本機重建 stack 後單跑該條通過。應用程式碼沒動。

## 2026-10-14 參觀場次：國定假日匯入、停班停課；操作紀錄搜尋、站內通知翻頁（`feature/holiday-closure-20261014`）

使用者從功能盤點裡選了這兩項，說「先做這些」。規格 `docs/specs/2026-10-14-holiday-closure-design.md`，規則見 DESIGN.md 最上方一節，操作步驟見 `docs/website-admin/operations.md`「國定假日與停班停課」。

- **匯入國定假日**（參觀場次 →「匯入國定假日」）：
  - 從政府資料開放平台下載人事行政總處的「行政機關辦公日曆表」（今年或明年）；連不到時上傳同一份 CSV。
  - 預覽每一天（可取消勾選）、選校區、先試算再套用。
  - 星期一到五的假日一律成為休假日；週末節日只在那校有週末場次時才建；已是休假日的不動；補行上班的週六不加開。
  - 解析器在 114（Big5 更新版）、115、116 年的真實檔案上驗過；本機實際從平台下載 116 年版，義華建了 17 天、略過 7 個週末節日。
- **停班停課**（參觀場次 →「停班停課」）：
  - 選日期（今天到 60 天內）、校區（可複選）、原因（會寫進給家長的信），先試算再確認。
  - 那天變成休假日、場次全部關閉；已約的預約不取消。
  - 有 Email 的家長收到停課通知（附修改連結），同一筆同一天只寄一次；沒有 Email 的照舊在「待人工處理」由櫃台來電。正式站沒設寄信時不排信。
  - 休假日還有已約的家長時，月曆那天的面板多一顆「寄停課通知（N 組）」。
- **停課日家長不受線上修改期限限制**：期限是讓園方來得及反應的，停課日沒有意義。家長頁寫「園方這天停課…請選擇新的時間，或取消這次預約」、狀態寫「這天停課」，不給「加入行事曆」。月曆上一般的「整天休假」也適用。
- **待人工處理**：改看「那天有沒有休假」。先「停止申請」、之後整天休假的場次（關閉來源仍是 manual），已約的家長原本不會列進來，現在會。
- **操作紀錄**：
  - 多「操作者」篩選（這個範圍出現過的人，含「系統」）。
  - 搜尋改由後端比對全部紀錄，不再只搜已載入的；後台把中文名稱展開成代碼一起送，清單與匯出用同一組條件。
- **站內通知**：
  - 「載入更早的通知」（游標翻頁），「未讀」頁籤由後端篩。
  - 頁籤數字是範圍內的真實總數；拿掉「只列出最新的 100 則」。
- **API**：
  - 新增 `POST /admin/holiday-calendar/fetch|parse|apply`、`POST /admin/visit-closures`、`GET /admin/audit-log/actors`、`GET /admin/notifications/counts`。
  - `GET /admin/audit-log` 多 `actor`、`q`；`GET /admin/notifications` 多 `before`、`before_id`、`unread_only`、`limit`（回應仍是陣列）；`ParentVisitRequestOut` 多 `day_closed`。
  - 新的家長信種類 `parent_visit_day_closed`、歷程 `closure_notice`、操作紀錄 `visit_exception.import_holidays`、`visit_closure.create`。
  - **沒有 migration**。
- **驗證**（Node 22.22、PostgreSQL 16、本機 Chromium）：
  - 後端全套分 3 組平行跑（各自的測試庫）：2680 passed、1 failed。失敗的是 `test_media_job_loop.py::test_stop_terminates_running_ffmpeg_and_requeues_job`（「停止要在 4 秒內完成」的計時斷言，三組同時跑 CPU 滿載），和本次無關，單獨重跑 9 passed。
  - 新增的後端測試：`test_holiday_calendar.py` 24、`test_visit_closure.py` 10、`test_audit_search_and_inbox_paging.py` 8。
  - admin vitest（`--maxWorkers=2`，同 CI）156 檔 2354 passed、1 skipped；web vitest 101 檔 1226 passed。
  - admin `vue-tsc -b --noEmit`、web `nuxt typecheck`、admin build、`contract:check` 都通過。
  - 解析器以 114（Big5 更新版）、115、116 年的真實檔案驗過；本機實際從開放平台下載 116 年版。
  - 本機 stack（API＋後台 dev＋官網 dev）上用 Playwright 跑桌機 1440、手機 390，都沒有水平溢出：
    - 停班停課：試算顯示 6 組（4 位寄信、2 位要來電），送出後寄出 4 封。
    - 那天面板的「寄停課通知」：4 位之前寄過、不重寄。
    - 匯入國定假日：義華新增 17 天、略過 7 個週末節日。
    - 操作紀錄：搜尋「停班」找到那一筆；操作者篩選正常。
    - 站內通知：130 則翻頁到 130、未讀頁籤 86。
    - 家長頁：把期限設成 14 天，停課日仍可改場次與取消，不顯示期限也沒有加入行事曆。
- **未驗證**：
  - 正式站（Railway）連不連得到 data.gov.tw／dgpa.gov.tw（連不到就用上傳）。
  - 真的寄出的停課信：本機沒有 SMTP，只驗了排信、信件內容與連結。
  - Safari／iOS 實機。

## 2026-10-14 全專案 bug 盤點與兩條修正（`feature/fix-entrance-publish-lock-20261014`）

使用者要「看看專案有沒有 bugs」：官網、後台、API 分五塊逐檔審查，每條候選都追到實際呼叫路徑再判斷。沒有高嚴重度問題；修了影響最大的兩條，其餘低嚴重度的列在下面待排。

- **首頁開場簾幕蓋住整頁 5.5 秒**：先進內頁（例如從搜尋結果進 `/admission`）、再點頁首校徽或麵包屑回首頁，整頁被靜態布幕圖蓋住 5.5 秒、開場也不播，點擊還會穿過去點到看不見的頁面。原因是站內換頁時 unhead 會在 `EntranceCurtain` 掛載、判斷完不播之後才重新插入 head 的 bootstrap，它又把 `data-ivy-entrance` 設成 pending。bootstrap 改成只有 SSR 解析中的那一份（`document.readyState==='loading'`）能啟動（`web/app/utils/entrance-policy.ts`）。
- **排程發布與退回審核互等成死結**：排程到期時先鎖排程列再等站台鎖，退回是站台 → 這一版 → 取消這一版的排程，順序相反。被中止的若是審核者，拿到 500 而退回的內容照樣上線；若是排程，這一輪其餘到期的排程整批延後。排程改成先拿站台鎖再鎖排程列（`backend/app/content/publish_jobs.py`），其他碰排程列的路徑（取消、標成已處理）都只鎖排程列，不會因此多出新的死結。
- **驗證**（Node 22.22、本機 PostgreSQL 16、Chromium headless）：
  - 修正前全套：web typecheck 通過、vitest 1225 過；admin typecheck 通過、vitest 2341 過 1 略過；後端 pytest 2640 過；`contract:check` 一致；部署腳本 22 過。
  - 修正後：web vitest 1227 過（新增 readyState 兩例）、typecheck 通過；後端新增 `test_reject_and_due_schedule_concurrently_does_not_deadlock`，用舊程式跑會 `DeadlockDetectedError`、修正後連跑 5 次都過；內容／排程／維護相關 236 項通過。
  - dev server（fixture）上實測 1440 與 390：首次進首頁布幕照常播；`/admission` 點校徽回首頁不再出現蓋層。
- **其餘已確認、未修**（低嚴重度，待排）：
  - 家長點管理連結與園方取消／改期同時發生可能死結，一邊 500、資料不壞（`booking/access_service.py` `exchange_token` 先鎖 token 再插 session；結案、改期先鎖案件再改 token）。
  - 「重新產生連結」「重寄確認信」用取鎖前讀到的場次算效期（`booking/access_routes.py`；`lock_status` 只重讀 status、slot_id），10-13 修過 `update_details_by_staff` 的同類問題，這兩支漏了。
  - 連結已過期後園方改期，變更信沒有管理連結（`extend_token_expiry` 只延長有效的連結，不補發）。
  - 30 週年蛋糕：權限視窗開著時離開頁面再按允許，麥克風一直開到重新整理（`anniversary/cake.ts` `startMic` await 後沒檢查已銷毀）。
  - 後台三處把部署中 502 的 HTML 原文跳給員工看（`ParentAccessLinkPanel.vue`、`PublishHistoryView.vue`、`mediaUpload.ts` 沒看 `err.json`）。
  - 後台聯絡紀錄、追蹤對話框的「取消」繞過放棄確認（`ContactLogDialog.vue`、`FollowUpDialog.vue`）。
  - 頁首「內容通知未讀」在發布紀錄頁標成已讀後最多 30 秒不更新。
  - 最早四支 migration 的 downgrade 沒刪 enum 型別，downgrade 後再 upgrade 會失敗（正式站不會自動 downgrade）。
  - `/anniversary` 的開場 head 腳本是同一種寫法；從內頁站內換頁進去實測開場照常播，沒有重現，未改。

## 2026-10-13 全站精修：以國際設計獎的完成度逐頁檢查（`claude/award-polish-20261013`，PR #37）

使用者要「以 awwwards、webby、FWA 得獎的程度為目標，自我檢查、反覆提升到達標」。只改 `web/`，已定案的方向不動，只修執行瑕疵；規則與待決定事項見 DESIGN.md 最上方一節。

- **檢查方式**：正式建置（fixture）上跑自動稽核（320–1920 八種寬度的水平溢出、標題孤字、圖片解析度、Tab 焦點可見、console、關掉 JS 內容可見、Lighthouse 手機），再逐頁人工檢查 1440／1024／768／390／320 與 hover、減少動態；每項先在靜止狀態重現，修完同視窗截圖對照。
- **全站**：選取色與原生控制改品牌色。
- **30 週年**：開場飛進相框改用 transform＋clip-path，CLS 0.39 → 0.000（Lighthouse 手機 53 → 72）；1100 以下紙偶不再壓在年份上、手機不被切邊、走在卡片前；慶祝後蛋糕底邊不再卡彩紙；結尾 30 的接點與收筆；地圖地名描邊；320 的計數列、作品標籤、蠟筆、工具列；燈箱照原比例。
- **特色教學**：水彩顏料色回到色票（原本 8 位元 canvas 疊低透明度造成偏色）；課程方向、五件事平板不再留半列空白；美術館改兩排沿中線掛；首屏上緣切線、提醒字壓色、1024 手被裁掉。
- **入學**：壓章途中捲動時章裡的字卡在縮小狀態；補助券存根數字直排；平板橢圓章壓日期、補助券縮在左邊；320 簽證欄內文太窄；退費條文斷字；三處清單間距從沒生效（`.ap ol` 重設權重較高）。
- **關於**：手機第四章大卡蓋住家長名字；901–1010 章節標題孤字；紀念章停在兩站之間會側立；沿革列顏色走錯（oklch 短色相）；全人六圈標籤重疊；房子樹木浮在山坡上。
- **常春藤環境**：換校區分頁時相框縮在左上角（桌機 10 次 8 次）；愛心與「4」看不出填色；色紙上的小字對比；平板曬衣繩說明黏在一起、便條壓封面或編號；手機底紙被視窗切平；首屏大標 901–1150 孤字。
- **首頁**：桌機「孩子的一天」圖說與暫停鍵壓在拍立得上；拍立得與背景片露出半截台標；拍立得背面橫線穿過字；影片上小字對比；消息兩欄標題不齊；社群連結孤行。
- **最新消息、預約、404**：校區篩選列出別校的示意消息；預約校卡地址壓在白色招牌上（1:1 → ≥5.7:1）；預約內容內縮 16px；讀不到參觀方式／沒有場次時按鈕主次顛倒；選校卡照片在桌機與平板發糊；消息標題手機斷詞。
- **驗證**（Node 22.22，本機 Chromium headless）：
  - web typecheck 通過；web vitest 100 檔 1207 過（開始時 97 檔 1157，新增 `award-polish-20261013`、`news-visit-polish-20261013`、`home-polish-20261013` 與各頁回歸測試）。
  - 最終建置稽核：320／390／768／1024／1440／1920 十個頁面沒有水平溢出、沒有標題孤字（入學補助券直排存根是偵測誤判）；Tab 巡過全站每個可聚焦元素都有可見焦點；Lighthouse 手機無障礙全頁 100、最佳做法 100（預約頁 96，維持原狀）。
  - 效能同機 A/B（原本 `8c4ec20` 對最終建置，各 2–3 次）：環境 57–64 對 60–64、特色教學 74–76 對 75–77、首頁 34 對 35，沒有退步；30 週年 53 → 72。
  - PR #37 每批推上去 CI（web、admin、後端三組、stack e2e）全綠。
- **未驗證**：Safari／iOS 實機、真機 GPU 下的首頁開場效能；headless Chromium 播不了 H.264，首頁與 30 週年影片相關的檢查用 ffmpeg 抽幀與海報代替。
- **待業主確認**：特色教學頁水彩顏色變柔和（色票本來的樣子）；其餘待決定事項列在 DESIGN.md。

## 2026-10-13 審查四條修正（招生機會缺人口／舊月份人口檔、預約取鎖後重讀場次）

來源是外部審查回報的四條，先用真 PostgreSQL 重現，再修。

- **招生機會：人口批次只缺一個里**：「附近」改成只看里界重心距離（規格 O2），不看人口表。過去缺的那個里（距校約 287 m）被當成半徑外，20 筆參觀算成「3 公里外」。回應新增 `no_population_villages[]`（區、里、代碼、距離、參觀數），總結小字與地圖彈出框寫明「這個里沒有人口資料」。加總式 `baseline.visit + outside_visit + Σ no_population_villages.visit + unplaced_visit` 等於統計頁的總參觀。
- **人口檔倒退**：`--population-file` 匯入比使用中更舊的月份時，當驗證不過（`failed`＋`last_error`，保留 `synced_at`／`checked_at`，CLI 會印出原因）；真的要退回舊月份加 `--force`。網路來源連 `--force` 也不降版。門牌檔案匯入本來就不擋舊版（檔案可指定月份），兩者不同：人口月份取自資料本身。
- **預約：改期與改 Email 交錯**：`update_details_by_staff` 取鎖時補重讀 `slot_id`，新連結的效期與要不要補發才照改期後的場次算（原本拿舊場次，效期只剩 14 天，原場次已開始時只撤銷不補發）。
- **預約：交錯改期後家長仍能操作**：家長取消／改資料／再改期，期限檢查原本在取鎖之前；現在取鎖後重讀場次再判斷，園方剛把預約改到 24 小時內時回 409 `CHANGE_DEADLINE_PASSED`。改期與改資料保留鎖外早期檢查（期限過了仍優先於限流 429），並在限流檢查之後補一次鎖內檢查：限流器用自己的連線池，不能握著案件鎖等它。
- **測試**：預約兩條用真並發重現（另一交易持鎖改期未 commit，請求卡在鎖上，之後才 commit），見 `backend/tests/test_booking_stale_reads.py`。驗證結果與 CI 見 `deploy/README.md` 同名段落。

## 2026-10-13 場次使用情況（`feature/visit-slot-usage-20261013`）

使用者要「更多可以做招生判讀的資料」，四項裡的第一項。規格 `docs/specs/2026-10-13-visit-slot-usage-design.md`，規則見 DESIGN.md「參觀場次：場次使用情況」。

- **記錄**：公開 `GET /public/slots` 在 `purpose=new_booking` 時記一次「最早能約哪天」（五個區間），只存每日彙總 `slot_lookup_daily`；新預約表單帶這個參數，改期管理頁不帶。不改公開頁外觀。
- **回推**：各時段（星期×起訖）過去 4／12／26 週的場次數、總名額、已約、填滿率、額滿場次，判讀「常額滿／很少人約／還不判斷」。
- **畫面**：參觀場次頁多「場次使用情況」頁籤（`?tab=usage`）。
- **migration**：`b4d7e1a92c58` 只新增表，不需備份閘門。
- **驗證**：
  - stack e2e（Node 22、專屬庫與 port；`npm run e2e:build` 後 `playwright test -c playwright.stack.config.ts tests/stack/slot-usage.spec.ts tests/stack/a11y.spec.ts tests/stack/schedule-flow.spec.ts`）36 個全過，含新增的 `slot-usage.spec.ts` 4 個（1440／390 頁籤不橫向溢出、頁籤進網址、分校管理者）與 a11y 掃描 `/admin/visit-calendar?campus=yihua&tab=usage`。
  - `slot-usage.spec.ts` 單獨跑 4 個過；請求不帶 `purpose=new_booking` 時，1440／390 兩個案例失敗（總結句不出現）。分校管理者案例含單校標籤、無校區下拉與跨校 API 404 的斷言。
  - 有表格的畫面另以測試庫的過去場次與預約檢查（三個時段，常額滿／很少人約／還不判斷各一）：axe 0 個違規（1440、390），頁面不橫向溢出；390 的表格在表內橫向捲動（時段欄固定，判讀欄要往右捲）。
  - 最終程式碼（含最終審查後的修正 commit「fix: 場次使用情況最終審查修正」）：
    - 後端全套 2626 passed、1 skipped（約 37 分鐘）。這輪跑在「test(e2e): 分校管理者那條補上…」那個 commit，也就是最終審查修正之前；修正涉及的 schema、lookup、usage 三個測試檔另在修正後跑 51 passed，ruff 通過。
    - admin vitest 全套：機器負載約 16–21 時有 35、36 個逾時失敗（`STACK_TRACE_ERROR`），分散在 13–16 個與本次無關的檔案。這些檔案逾時放寬到 60 秒、單程序重跑 392 passed、1 skipped、0 failed。本次新增的 `slotUsage.test.ts`（33 個）在全套中全過。
    - web vitest 98 個檔案、1162 passed；admin、web typecheck 通過；`contract:check` 一致。
    - stack e2e 三支（`slot-usage`、`a11y`、`schedule-flow`）在最終程式碼重新 build 後再跑一次，36 passed。
  - 重新對齊 main（效能第五輪合併後的 `72d0f933`；無新 migration、之後 main 只多一個部署紀錄 commit、只有 README／DESIGN 文字衝突）後：
    - 完整 stack 套件 134 passed、0 failed（約 9.7 分鐘，含 `slot-usage.spec.ts` 4 個與 a11y 的 `tab=usage`）。
    - 後端相關檔（場次三個、`test_geo_sync`、`test_admissions_area`、`test_admissions_estimation`）191 passed；admin 的 `slotUsage`、`areaMap` 等相關檔 116 passed、web 的 `slot-lookup-purpose`、`gzip-boundaries` 70 passed；admin、web typecheck 與 `contract:check` 通過。
    - 後端全套未在對齊後重跑：main 新增的變更只動 `estimation.py`、`geo/sync.py`，與本分支沒有重疊檔案。

## 2026-10-13 效能第五輪：後台按需載入與地圖換色、代理壓縮 JSON、後端事件迴圈（`feature/perf-20261013`）

使用者要「優化專案的效能」。官網、後台、後端分三路盤點，每一項先量再決定做不做；外觀不變。規則與「量過不改」的清單寫在 DESIGN.md 最上方一節。量測在本機 stack（真 API＋隔離測試庫＋production build），腳本放在 session 暫存，不進版控。

- **後端**
  - 可能範圍（`estimation.rate_range`）加 `lru_cache`。一次區域分析要算幾百個里，同一次請求的 prior 相同；300 次呼叫只有 21 種組合，107 ms → 8 ms。這段原本全在 event loop 上，而正式站 API 只有一個 worker。
  - 門牌同步：下載中的 CSV 收滿 5,000 行交給執行緒解析（本機檔案本來就這樣做）。幼兒園名單的 JSON 解析與篩選也丟執行緒。
    - 20 萬行實測：event loop 延遲 p99 101 → 11 ms；總耗時多約 10%。
    - 全市約 129 萬行，原本每月同步時會斷斷續續卡住官網的預約與內容請求約一分鐘。
    - `test_download_cut_off_midway_keeps_active_version` 把分塊調成 3 行，維持「斷線前已寫進半個批次」的情境。
- **官網代理**：JSON 回應對收 gzip 的客戶端壓縮（`createJsonGzip`）。
  - 1 KB 以下、HEAD、304、非 JSON 不動；CSV 匯出與素材照舊串流；里界 GeoJSON 照舊走依 ETag 快取的那支。
  - 訪視明細一頁 50 筆（測試資料）72 KB → 3.8 KB。
  - `gzip-boundaries.spec.ts` 原本「其他路徑不壓縮」那組改成新的行為，另補分塊傳輸、422、小檔、不收 gzip、304、非 JSON、HEAD、斷線 502、不快取、壓縮失敗退回原樣。
- **官網**
  - `/about` 的 motion 改在 `.then` 裡解構，打包才 tree-shake 得掉：chunk 135 → 69 KB（brotli 40 → 22 KB）。回傳型別要標 `AboutPopupDeps`，讓 TS 推導整個 motion 的型別會使 `server/api/public-site.get.ts` 跳 TS2321。
  - SSR HTML 壓縮改用非同步 zlib，brotli／gzip 移到 libuv 執行緒。
- **後台**
  - 總覽：招生資料表單（RecordDialog 連同日期、下拉元件）改成確認標記到場那一刻才下載。總覽在入口之外的 JS（gzip）70 → 12 KB。
  - 招生入學：訪視明細、統計分析兩個分頁另切 chunk，預設的漏斗看板在入口之外 166 → 101 KB（gzip）。
  - 新 `composables/lazyComponent.ts`：載入失敗比照換頁，整頁重載一次。`reloadAfterChunkError` 搬到 `router/chunkReload.ts`，`router/index.ts` 照舊匯出。
  - RecordDialog 的 open watcher 改成 immediate（掛上時已打開也帶入資料）。
  - rolldown `codeSplitting.groups`：Vue／Vue Router／Pinia 一個 chunk、`src/api/labels.ts` 一個 chunk。改標籤只讓 17 KB（gzip）的 labels 失效，不再連 Vue 一起重抓；入口總量不變（167 KB gzip）。
  - 區域分析地圖：資料重讀、換半徑、換著色只換 893 個里圖形的 class，不重建圖層。
    - 真 Leaflet、4 倍 CPU 降速，切換著色 360–750 ms → 56–96 ms；三種模式的著色分布與改前相同。
    - 里界換了、手機／桌機版面切換才重建。
- **量過、不改**（詳見 DESIGN.md）：
  - 每頁重複的阻塞樣式表：限速手機換成空檔，LCP /about 2380 vs 2408 ms、首頁 1584 vs 1576 ms，誤差內。
  - 字型其餘分片樣式表降優先權：LCP 不變。
  - 站內換頁不會重抓 `/api/published-site`。
  - 消息進度條每 50 ms 更新：profile 看不到成本。
  - 校區座標快取、招生機會預先篩里、頁首徽章輕量端點：差距在 10 ms 內。
- **驗證**（本機 Node 22.22、PostgreSQL 16）：
  - web：`nuxt typecheck` 通過；vitest 97 檔 1170 項通過；production build 通過。
  - admin：`vue-tsc -b` 通過；vitest 154 檔 2306 過、1 略過；build 通過。
  - backend：改到的測試（estimation、deposit_pace 49 項；geo sync／kindergartens／doorplates／loop／population 235 項）通過；全套 2578 passed（獨立測試庫，41 分鐘）。
  - stack e2e（本機沒有 Google Chrome，用 `/opt/pw-browsers/chromium`；暫用設定放 `output/`，不進版控）：
    - 全套 122 過、1 敗、6 未執行。失敗的是 `exports.spec` 的訪視明細下載：Chromium 給的檔名是 `download`，和 10-13 招生機會地圖那輪記錄的一樣。後台的 CSV 下載是瀏覽器端 Blob＋`a.download`，檔名由前端決定、和代理無關；檔名之前的 BOM、CRLF 檢查都通過。同一檔是 serial，後面 6 支跟著沒跑。
    - 總覽改成「到場成功後才掛表單」之後重 build，補跑 `visit-complete-early`、`roles`、`keyboard`、`sidebar-collapse`、`admissions-area`、`admissions-flow`：29 過。`exports.spec` 其餘會下載的 4 支同樣卡在 Chromium 檔名；兩支版面測試通過。
    - CI（Google Chrome）的 E2E 全綠，含 `exports.spec`。
  - `contract:check` 一致（沒有 API 變更）。
  - 瀏覽器實測（本機 Chromium）：
    - `/about` 新舊兩版捲過整頁，動畫中間狀態與最終狀態相同、沒有錯誤。
    - 後台總覽、招生入學三個分頁、區域分析地圖依序打開，各自只在需要時下載對應 chunk、沒有錯誤。
    - SSR HTML 的 br／gzip／不壓三種回應解開後與原文相同。
- **未驗證**：Safari／iOS 實機；正式站（Railway）上的實際延遲；真實家長資料的 JSON 壓縮比（測試資料重複度高，壓縮比偏樂觀）。

## 2026-10-13 招生機會地圖（`claude/amazing-cannon-0cqnpc`）

使用者要「令人驚艷、不是 AI」的功能，從四個方案選了招生機會地圖。重開區域分析 10-08 延後的「人口與機會判讀」（飽和度仍不做）。規格 `docs/specs/2026-10-13-admissions-opportunity-design.md`，規則見 DESIGN.md 最上方一節。

- **資料**：內政部戶政司 ODRP014 各里單一年齡人口，每月一版。
  - 併進既有的公開資料同步，成為第三種資料 `population`；新表 `geo_village_population`。
  - migration `f3c8a2d47b19` 只新增表，並把 `geo_dataset_status` 的 dataset 約束放寬成多收 `population`，不改資料。
  - 115 年 9 月版高雄市 893 里的代碼與名稱，和里界檔 100% 對得上。
  - 驗證不過就不換版：月份不一致、數字不是整數、少於 850 里、代碼重複。
  - 下載帶 `COUNTY=高雄市`：一頁、約 4.4MB。解析時就只留高雄的列與 0–6 歲欄位，真實 115-09 資料本機解析峰值約 22MB、0.4 秒（第一版抓全國四頁、整頁解析，峰值約 117MB）。
  - CLI `geo-sync` 新增 `--population-file`（可給多頁），正式站連不到內政部時用。
- **API**：`GET /admin/admissions/area/opportunity`。
  - 參數：校區、入學學年學期、半徑 1／3／6 公里。
  - 回應：本校半徑內各里的 2–5 歲孩子數、0–1 歲孩子數、參觀率、照附近應有的參觀人數與判讀。
  - 判讀：Poisson 單尾檢定 p ≤ 0.10，判「明顯偏少／差不多／比附近多」；附近參觀不到 10 位不判斷。
  - `/area` 的 `data_status` 多帶人口月份。
- **後台**（招生入學 → 統計分析 → 區域分析）：
  - 地圖圖例上方三段切換「參觀人數／2–5 歲孩子／招生機會」。
  - 招生機會模式：明顯偏少用新 token `--area-chance`（玫瑰色）。
  - 地圖下新增「招生機會（本校 N 公里內）」：一句總結（幾個里、多少孩子、參觀率、明顯偏少的里合計少了約幾位），加上各里排行。
  - 排行先列 10 個里，可展開全部，CSV 一律匯出全部。`StatsDimensionTable` 因此多了 `intro` 插槽與 `collapsedRows`。
  - 狀態列多一段「各里人口 115 年 9 月」。
- **驗證**（Node 22.22、本機 PostgreSQL 16；測試庫 `ivy_website_opportunity_test`）：
  - 後端新測試：招生機會 API 19、人口解析與同步 28、Poisson 4（含參數化共 7）。既有的 geo／area 測試同時跑過。
  - 後端全套 2561 passed（約 40 分鐘）。這輪跑在「只抓高雄、解析時就篩」那次修改之前；修改後，改到的 geo、area、estimation、opportunity 測試另跑 241 passed。
  - admin：vitest 2291 passed、1 skipped、1 failed。失敗的 `ux20260928F`（日期字串「9月29日 星期二」多一個空格）在改動前的 `a5d790c` 也一樣失敗：這台機器的 Node 是 22.22，`.nvmrc` 指定 22.23，兩者的 ICU 日期格式不同，和本次無關。
  - admin typecheck 通過；web typecheck 通過、unit 1152 passed。
  - `contract:check` 一致；deploy tests 22 OK。
  - stack e2e `admissions-area` 9 passed，含新加的兩支。本機沒有 Google Chrome，用 `/opt/pw-browsers/chromium` 跑（暫用設定放在 `output/`，不進版控）。
  - stack e2e 全套 119 passed、2 failed，兩支都和本次無關：
    - `roles.spec` 接待人員那支：整套連跑時撞到「這個網路近一小時送出的預約次數過多」限流，單獨重跑會過。
    - `exports.spec` 訪視明細下載：Chromium 給的檔名是 `download`，單獨跑也一樣。本次沒動明細匯出的程式與 API，推測是 Chromium 與 Chrome 的下載差異，以 CI 的 Chrome 結果為準。
  - 截圖在 `output/playwright/admissions-opportunity-*.png`（gitignore）。另用攔截 API 的方式，看過有判讀結果時的地圖配色與表格。
  - 合入 origin/main `00428c2`（PR #33）之後重跑：
    - 後端 geo 與招生測試 876 passed，alembic 單一 head `f3c8a2d47b19`。
    - admin vitest 2304 passed、1 skipped，typecheck 通過。上面那支 ICU 日期測試已由 main 的 `046eb85` 修好。
    - web typecheck 通過、unit 1157 passed；`contract:check` 一致。
    - stack `admissions-area`、`admissions-flow`、`booking-stats`、`roles` 共 20 passed。
- **未驗證**：
  - 正式站能不能連到內政部 API：門牌那邊被擋過境外 IP，連不到時照 `deploy/README.md` 的手動退路匯入。
  - 真實參觀資料下的判讀分布：正式站目前是測試資料，多半會寫「附近參觀還不到 10 位，先不判斷」。
  - 沒有在正式站登入實測；Safari／iOS 實機。
- **上線**：10-13 由 PR #34 併入 main（`58ec755`），main run 38352283382 全綠並部署到正式站，migration `f3c8a2d47b19` 隨 API 啟動套用。正式站各里人口有沒有自動抓到還沒確認，紀錄與查法見 `deploy/README.md` 10-13「招生機會地圖」。

## 2026-10-13 10-12～10-13 改動審查出的一批 bug（`claude/affectionate-maxwell-uten3y`，PR #33）

審查 `c91d939..60332d8` 找到的問題一次修掉。（同一輪找到的 `about-voices-preview.spec.ts` 偶發失敗，main 已在 `a5d790c` 另外修好，以 main 的版本為準。）

- **後台改 Email 時舊家長連結作廢**：補登或送單時 Email 打錯，連結已寄到陌生人信箱；改正後那條連結仍看得到電話、孩子資料，也能取消或改期。原本的 Email 有值又被改掉時：會寄變更信就換發新連結（新信箱收到的是新的），否則只撤銷，園方要給家長時在「家長管理連結」重新產生。原本沒有 Email 的不動。規格 `docs/specs/2026-10-12-admin-batch-design.md` 3.1 第 7 點補記；回應多 `access_link_reset`（契約已重產，沒有 migration）。
- **標記已到場**：建立招生訪視前在鎖內重讀家長資料，同事同時改好電話時不再用舊值建。
- **消息活動時間**：不再收全形數字與結尾換行（`0645aad` 漏的 `_TIME_RE`）。
- **招生地址解析**：「12之3之4號」不再被當成 3 之 4 號；「100巷，5號」「100巷(近公園)5號」這種巷弄後夾字的不再對到街上同號的別戶（巷弄讀前面乾淨的編號，號不拿去比對）。門牌來源一頁沒檔案、一頁 HTTP 錯誤時說「找不到下載檔」。
- **後台登入**：別的分頁換了帳號後在這頁按登出，再按上一頁不會變成對方（`9ac5fbf` 只擋了被動登出）；被迫登出後換另一個人登入，不帶上一位沒送出的聯絡紀錄草稿與頁首數字。
- **後台表單**：改家長電話認得 en dash 等連字號（同後端與官網表單）；存檔後快照用後端存下的內容，不再因為去掉前後空白一直顯示「1 處修改」；機構社群發布摘要分得出「沿用官網內建」與「不顯示」，恢復內建不寫成「刪除」；社群網址與主選單外部連結先擋看不見的字元、主機前的 `@`、主機裡的 `%`。
- **後台側欄與總覽**：圖示欄最上面按 ↑ 回到搜尋鈕；總覽日期不隨瀏覽器（ICU 版本）多一個空白。
- **官網預覽**：最新消息預覽點校區篩選不再丟掉預覽參數，近期活動跟著預覽日期；關於頁換片動畫播到一半影片被刪少時，預覽不再整頁畫不出來。
- 驗證：
  - 合入 main 之後：admin vitest 154 檔 2279 過、typecheck 過；web vitest 97 檔 1157 過、typecheck 過；`contract:check` 一致。
  - 後端改到的測試檔（預約修改、消息、地址、門牌同步、比對）本機 PostgreSQL 全過；新加的測試拿掉修正會失敗。

## 2026-10-13 參觀預約統計搬到招生入學（`feature/booking-stats-move-20261013`，10-13 已部署 main `a5d790cf`）

使用者要把成效統計的「各校預約」與「預約孩子的班別」整合到招生入學的統計分析，成效統計只留官網瀏覽與速度。規則寫在 DESIGN.md 最上方一節。

- **招生入學 → 統計分析 → 參觀預約**（`?tab=stats&sub=booking`，最後一個子分頁）：五校比較、預約結果、預約流程、每日變化、預約孩子的班別、依來源、預約鈕點擊都搬過來，口徑與 API 不變。校區跟頁首；入學學年學期在這個子分頁停用，期間在子分頁裡選。
- **成效統計**只剩官網瀏覽與速度，沒有頁籤。
- 參觀預約的 CSV 檔名改 `招生統計-參觀預約-…`。
- 新元件 `admin/src/components/analytics/BookingStatsPane.vue`（從 AnalyticsView 搬出），`StatsTab` 讓參觀預約不受招生統計讀取狀態影響。
- 連帶影響：editor、readonly 帳號看不到參觀預約的數字（招生入學沒開給這兩種角色）；招生開關關閉時也看不到。
- 測試：單元測試改測新元件；stack e2e 新增 `booking-stats.spec.ts`（1440／390 面板、停用條件、分校管理者、成效統計只剩瀏覽），鍵盤溢出與 axe 清單加上新子分頁與 `/analytics`。

## 2026-10-13 後台側欄可以收合（`feature/admin-layout-20261013`）

使用者在 MacBook Air（螢幕 1470px）看正式後台，右邊被切掉一截。查證不是版面問題：同一頁 1568px 寬也沒有橫向捲動（`scrollWidth`＝`clientWidth`），是 Chrome 視窗比螢幕寬約 100px，右側跑出螢幕外。把視窗調回螢幕大小就好（選單「視窗 → 填滿」或按住 Option 點綠色按鈕），程式沒改。

同一輪使用者要側欄可以收合，做法比照園務系統：

- 收合鈕在品牌列右邊。按了收成 64px 圖示欄，再按展開。
- 收合狀態記在瀏覽器裡（`ivy-admin-sidebar-collapsed`）。
- 圖示欄不畫分組標題，所有項目都列出來，分組之間用細線隔開。
- 名稱用浮動提示顯示，滑鼠滑過或鍵盤停到都會出現。連結裡仍保留名稱給報讀器。
- 搜尋框換成搜尋鈕。按它或 ⌘K 會先展開側欄，再把焦點放進搜尋框。
- 帳號區只留頭像與登出。
- 手機抽屜不變。
- 驗證：
  - admin vitest 154 檔 2261 過，typecheck／build 過。
  - stack 共 48 條全過：新的 `sidebar-collapse.spec.ts`，加上 a11y、keyboard、roles、visual。後台 4 張視覺基準已更新（品牌列多了收合鈕）。

## 2026-10-12 後台與官網內容一批補強（`feature/admin-batch-20261012`）

使用者從 10-12 盤點挑出第 2、4、5、6、7、8 項，加上收尾技術債。規格 `docs/specs/2026-10-12-admin-batch-design.md`，計畫 `docs/superpowers/plans/2026-10-12-admin-batch.md`，分 A–D 四階段，每階段跑完整閘門。已合入 origin/main `fb34d3a1`。

- **LINE 通知**：案件連結加 `?openExternalBrowser=1`，在 LINE 裡點開改用手機預設瀏覽器（Google 登入不再被擋）。Email 不變。
- **預約明細「修改」家長資料**（稱呼、手機、Email、孩子姓名與生日）：
  - 與家長修改連結共用版本號，兩邊同時改，後送的一方 409。
  - 歷程與稽核只記欄位名。Email 改成新值、案件仍是預約成立且場次未開始時，才寄變更通知到新信箱。
  - 招生訪視那欄若還是當初帶過去的值，就一起改；招生端另外改過的不動，並提示。已註冊且年級鎖定的不改年級。
- **「時間已過、還沒標記」可以一次勾多筆標記沒來。**
- **聯絡片語**：總管理者在「系統 › 聯絡片語」維護一份，五校共用。案件明細與招生記錄聯絡的輸入框上方點一下帶入，手機一列橫向捲動。新表 `contact_phrase_sets`（migration `ad783510900a` 只新增表與 6 句預設，不需先備份）。
- **全站設定**：
  - 加「各頁搜尋與分享」：入學、關於、特色教學、環境、消息、30 週年、隱私權七頁的搜尋標題、描述、分享圖。舊的入學頁兩欄退役，由 public_view 與存檔前驗證自動搬進新結構，正式站已發布的值不會不見。
  - 加「機構社群」清單：只收 https，官網再驗一次。
- **家長分享影片**改由各校「五校介紹」管理（最多 4 支，留空沿用內建、清空就不放）。關於頁改成五校輪流取。
- **常春藤環境頁前三章開放編輯**：
  - 新 kind `environment_page`，文字與照片可改；便條位置、太陽弧、結尾三張卡、餐點書連結留在程式。上限用 `page-copy-stress.cjs /environment` 實測，首屏大標每行 9 字、第四章標題每行 10 字。
  - 圓體 700／800 補常用字分片：800 只補前 3,000 字，全補 16.8 MB 超過 15 MB。字型目錄 8.2 → 14 MB。後台環境頁欄位提示「這幾個字會用系統字顯示」。
- **即時預覽補洞**：
  - 校園探索有預覽欄，會切到該校分頁。
  - 消息列表頁、關於頁的家長怎麼說可預覽。
  - 環境頁預覽換內容後會重畫手繪線條。
- **收尾**：
  - 拿掉 `?copy=` 比稿參數、官網與後端沒人讀的欄位（`indexing_enabled`、`hero_focus` 等）。
  - 內容 fixture 只留 `web/server/data/site-fixture.json`。`api.Dockerfile` 改複製這份到原路徑；CD 快照拿掉 `content/`。初始化從 17 筆變 22 筆，多四校的校園探索與環境頁。
  - 兩支跨日會紅的測試修好。
  - 別的分頁換了帳號時不再自動以新帳號登回原頁，按上一頁也一樣。
  - 預覽標頭路徑不分大小寫。
  - 列表裡提早完成的案件寫「提早到場」，並依到場日分組。
  - 驗收表與頁首收合說明已更新。
- **招生區域分析延後項目全數處理**（`docs/superpowers/plans/2026-10-08-admissions-area-followups.md` 逐條標註），依 D0 裁定不做的除外：
  - 地址解析：認得中文數字的號、之號與巷，例如二十之一號、一百零八巷。
  - 匯入：欄寬與座標不合的列略過並計數。
  - 比對與同步：nearby 改用索引，轉址只跟 https，年度頁出錯退回前一年。`_exclusive` 在取消時也會釋放鎖。
  - 里界 GeoJSON 由官網代理 gzip，約 600 KB → 130 KB。
  - 後台：999 m 顯示錯誤、地圖監聽沒解除、無障礙標籤等一併修好。
- **驗證**（10-13 最後一輪，HEAD `b68628fb`＋本段）：
  - 後端全套 2503 passed、1 skipped。
  - web unit 1152 passed、admin unit 2250 passed／1 skipped，兩邊 typecheck 通過。
  - contract:check、deploy tests 通過。
  - stack e2e 全套 117 passed，案件明細畫面基準已更新：多了片語與「修改」。
  - 整支分支審查找到 1 Important、8 Minor，都已修並補測試。
- **未驗證**：
  - 沒有在正式站登入實測。
  - LINE 外開瀏覽器沒有在真的 LINE 裡點過。
  - 兩分頁換帳號只有單元測試。
  - 正式站 Railway 上殘留的 `WEBSITE_INDEXING_ENABLED` 不擋啟動，可自行刪除。

## 2026-10-12 手機版體驗第四輪（`claude/mobile-experience-optimization-899zoz`，PR #32）

使用者要「優化手機版的體驗」。在 fixture dev server 上用 Playwright 分四區審查：預約流程、內容頁、首頁、30 週年／消息／全站。視口是 390×844、360×780、320×568、844×390，另加 Safari 實際可視高度 375×553、375×667、390×664。每區由一個唯讀審查者實測回報，再逐項重量後修正。只改 `web/`，規則見 DESIGN.md「手機版第四輪審查」。改版前快照在 `versions/before-mobile-r4-20261012-075312/`。

- **預約參觀**
  - 第一步：iPhone Safari 可視高度上，第一屏原本一張選校卡都看不到。手機黏底列只留按鈕，矮螢幕收迎賓區。375×667、390×664 變成一張完整卡；375×553 露出第一張的校名、地址與「可線上預約」。
  - 橫拿：選校卡改細條（下一步 y 1442→1081），月曆與場次上下排。
  - 送出失敗：焦點留在送出鈕，不再往上跳 1800px 以上；提示帶電話。
  - 讀場次留月曆高度：慢網路下版面位移 0.148→0。
  - 320 寬送出摘要不撐出欄外。
  - Email 錯誤字不再寫「確認信會寄到這裡」。
  - 完成頁：修改連結移到填寫內容前面（手機 y 1256→928）；複製失敗時提示並印出網址。
  - 家長修改頁：輸入框 35→54px、觸控 Enter 跳下一欄；320 寬改場次月曆格 31→33px。
- **內容頁**
  - 入學：「查寶貝讀哪一班」落在生日欄。320×568、844×390 原本選完生日答案在畫面外，現在在 247–316／271–312。「學年度」10→12px。
  - 關於：結尾校名緞帶原本都連到首頁的義華，改成點哪校就是哪校。
  - 關於、特色教學、環境、入學、30 週年內文 `text-wrap:pretty`。
  - 特色教學章節索引觸控不留 hover。
- **首頁**
  - 頁尾「五所校園」與緞帶連到 `#campuses`：一般動態下原本標題落在 −193 到 −456，看不到分頁和照片。現在標題在膠囊下方 y=77（橫拿 115，減少動態 174）。
  - 拍立得背面孤字：DOM 用 `text-wrap:pretty`，WebGL 貼圖用 `utils/cjkWrap.ts`。
  - 暫停圓鈕被卡片蓋到時沉到卡片下面。
  - 橫拿五校照片收高。
- **30 週年**
  - 五校卡電話與「地圖 ↗」可點範圍：外觀 17–19px，點擊區補到約 44px。
  - 總覽地圖校名 11→12px、年份 9→11px，補點擊範圍。
  - 非建校年份 2.7→5.9:1；開場按鈕 3.1→6.8:1。
  - 畫紙不比視窗高（橫拿原本 488px／390）；橫拿計數列不黏頂。
  - 從預約鈕離開再返回、直接開 `#anni-cake`，都落在對的段落。原本落在頁尾，或錨點在視窗下方 1739px。
  - 作品燈箱點背景關閉；開場深色蓋層 5 秒保險。
- **404 與全站**
  - 404 五校校名改成連到該校預約頁；橫拿時標題與按鈕回到第一屏。
  - 錯誤頁補 theme-color。
  - SPA 換頁加讀屏播報（NuxtRouteAnnouncer）。
  - 手機選單卡標出目前頁。
- **驗證**（Node 22）
  - `npm --prefix web run typecheck` exit 0。
  - web vitest 86 檔 974 項全過，新增 `tests/mobile-ux-20261012.spec.ts` 40 項。
  - Playwright（fixture＋攔截 API）逐項重量，數字如上。截圖在 `output/playwright/mobile-r4/`（gitignore）。
  - PR #32 第一個 commit 的 CI 綠。
- **沒做**
  - 選單與頁尾主連結改 NuxtLink：會跳過首頁簾幕補捲與特色教學水彩進場，整頁載入只多 50–200ms。
  - 拍立得橫拿縮寬：背面內文只會更高。
  - 其餘列在 DESIGN.md 同節「待業主決定」。
- **未驗證**
  - iOS Safari、LINE 內建瀏覽器實機：`type=date`、實際工具列高度、剪貼簿、`text-wrap:pretty`（iOS 26 起）。
  - 真實 API 延遲；正式站。
  - stack e2e 沒在本機跑。
  - 開場布幕與 H.264 影片：這台 Chromium 不支援，用 VP9 替身。

## 2026-10-12 招生統計：預繳速度與可能範圍（`feature/admissions-deposit-pace-20261012`，10-12 已部署 main `ee62f74b`）

使用者問招生判讀可以再加什麼演算法，選了「預繳速度」與「可能範圍」兩項。規則見 DESIGN.md「招生統計：預繳速度與可能範圍」，規格 `docs/specs/2026-10-12-admissions-deposit-pace-design.md`，計畫 `docs/superpowers/plans/2026-10-12-admissions-deposit-pace.md`。

- **警示**：「本月漏斗轉換下滑」改成「本月預繳比過去慢」、「來源結構失衡」也改看預繳速度：依過去的速度算到今天應有幾筆預繳，實際明顯偏少才報，月初與新來源不再誤報。來源失衡只和同一個 90 天窗口內的其他來源比。
- **統計總覽**：新增「預繳速度」卡（參觀後第 7／14／30／60／90 天累積預繳率）；月比卡多一行應有／實際預繳數。
- **可能範圍**：班別、來源、接待、區域、五校比較的預繳率旁加「可能範圍」（Beta 收縮 80%），CSV 拆下限、上限兩欄。
- **後端**：新增 `admissions/estimation.py`（純標準函式庫）、`admissions/deposit_pace.py`；沒有 migration。
- **口徑**：預繳時間取最後一筆 `deposit_added`（台北日期），之後退出的也算預繳過，補登舊訪視會讓天數偏長；可能範圍的事前平均用全體 (預繳+1)/(參觀+2)。
- **版面**：區域分析三張表的欄寬下限改成 36rem（多了「可能範圍」欄後，1440 時里排行實測 562px，兩欄並排會擠出表框），1440 改成一欄一張表。五校比較在 1280 有資料時要在框內橫捲約 16px，1440 放得下。
- **驗證**（Node 22；後端測試庫 `ivy_website_pace1012_test`、stack 庫 `ivy_website_pace1012_e2e_test`、埠 8796／3796，皆為本機結果）：後端全套 pytest 2012 passed／1 skipped；`contract:check` 一致；admin typecheck、vitest 145 檔 1977 passed／1 skipped、build；web nuxt typecheck、單元測試 934 passed；stack `admissions-flow`＋`admissions-area`＋`exports` 15 passed（含 1440／390 頁面不橫向溢出、預繳速度卡「目前 1 位」）。欄寬改 36rem 後重跑 `areaTab` 單元測試與 `admissions-area` stack，並實量 1440／1280 三張表都不需框內橫捲。預繳速度卡「資料夠」的狀態沒有真實資料，用攔截回應的方式截圖確認 1440／390 版面。
- **合入 origin/main 後重跑**（2026-10-12，合入區域分析後續 `cb26e52b`；README 兩段都留，契約重產後與自動合併一致）：`contract:check` 一致；admin typecheck、build，vitest 全套兩次各有 1／3 個 5 秒逾時（`admissionsView`、`admissionsRecords`，本分支沒改；機器負載 28），單獨重跑 63 passed；web typecheck、單元測試 934 passed；後端全套 2012 passed／2 failed／1 skipped，失敗的 `test_media_job_loop`、`test_media_jobs` 是共用媒體暫存目錄多出檔案（跑到一半筆電睡眠），單獨重跑 47 passed；stack 三支 14 passed。
- **未驗證**：正式站（目前是測試資料，卡片會先顯示「還不到 10 位」、兩個警示暫時不判斷）；真實資料下的誤報率（規格 §15：p ≤ 0.10，完全正常的月份或來源約一成會被報）。

## 2026-10-12 區域分析打開就定位在分校、文案與手機表格小修（`feature/admissions-area-locate-20261012`，10-12 已部署 main `cb26e52b`；正式站連不到高雄市資料平台，門牌 10-12 改以檔案匯入）

使用者看正式站義華的區域分析，要求「優化區域分析、自動把園方地址轉座標、打開時直接定位在分校」，範圍選「定位＋延後清單小修」。規則見 DESIGN.md「招生入學：區域分析」、規格 6.4／9.2／9.3／9.5 的 2026-10-12 段。

- **正式站現況**（10-12 用使用者已登入的瀏覽器看）：門牌與幼兒園公開資料從沒匯入（`WEBSITE_GEO_AUTO_SYNC` 沒開），本校沒座標，地圖框住整個高雄＝嘉義到台東。校址轉座標本來就是自動的（已發布校址在本機比對門牌），卡在資料沒匯入。Postgres volume 1133MB／50GB，開同步的空間條件已滿足。**開同步要使用者在 Railway api 設 `WEBSITE_GEO_AUTO_SYNC=true`**（步驟見 deploy/README.md「公開地理資料同步」）。
- **校址轉座標**：以 115 年 10 月真實門牌（775,772 列）比對，五校已發布校址全部 `exact`。外部地址服務都不採用：國土測繪 API `PERMISSION DENIED`（要申請）、OSM Nominatim 五校都查不到、Google 付費、TGOS 要金鑰。
- **後端**：`campus` 多 `district`（校址文字解析出的行政區，不需要門牌），區域與附近幼兒園兩支 API 都帶；契約重產。沒有 migration。
- **地圖**：視野剛好框住目前的半徑圈（四邊留 24px），換 1／3／6 公里跟著縮放；本校沒座標時框住校址所在的區，連區都不知道才看整個高雄；圖例下寫「本校位置未標示（門牌資料尚未匯入），地圖先顯示三民區。」。
- **文案**：狀態列「門牌資料 115 年 10 月版・幼兒園名單 10/12 更新」；沒匯入時「門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。」；幼兒園清單「幼兒園名單尚未匯入。」。
- **手機表格**（延後清單 C12）：行政區／里排行在 ≤720px 不多「查看明細」那一欄（原本在最右邊只露幾 px），改成 sticky 名稱欄本身是連結（讀屏名稱同按鈕）；連結用原生 button，避免 `el-button` 把每列撐高。
- **驗證**（Node 22，皆本機；機器同時有其他 session 跑測試，磁碟 I/O 滿載）：後端受影響子集（`test_geo_*`、`test_admissions_*`、`test_display_names`、`test_csv_export`、`test_logging_config`）577 passed、1 error——fixture 的 TRUNCATE 在高負載下 statement timeout，單獨重跑那個檔 27 項全過；**後端全套沒跑完**（高負載下每分鐘 2 項，中止），交給 CI。後台 vitest 145 檔 1975 passed／1 skipped，唯一失敗是 `admissionsRecords.test.ts` 一項 5 秒逾時，單獨重跑 38 項全過；`vue-tsc -b` 通過；`contract:check` 一致；stack `admissions-area.spec.ts` 4 項全過（庫 `ivy_website_arealocate1012_e2e_test`、埠 8761／3761）。真底圖目視：專用庫匯入真實門牌與幼兒園＋24 筆示範訪視，1440／390 截圖、切子分頁再切回、換 1／3／6 公里、沒門牌時框住三民區、手機點里名跳明細帶 `area`，console 沒有錯誤。
- **沒做**：里界 GeoJSON 壓縮——正式站實測 605KB 未壓縮，但後端加 gzip 沒用（web 同源代理的上游 fetch 會解壓），要在代理那層做、會影響所有 API，另開一件。

## 2026-10-12 參觀案件可以提早完成參觀（`feature/visit-complete-early-20261012`，10-12 已部署 main `f09ad269`）

使用者要一顆鈕，讓比預約早來的家長也能標記已到場；看完設計選「照設計做」。規則見 DESIGN.md「提早完成參觀」。

- **後台**：案件頁首（明細與右側預覽）在場次還沒開始時多一顆淺色「家長提早到了」，按下先確認、寫出原本約的時間；之後的流程（建立招生訪視、接著開招生資料表單）同「家長到了」。提示改成「場次開始後才能標記未到場…」。時間線把提早的到場寫成「提早標記已到場」，操作紀錄新增同名動作。
- **API**：新增 `POST /admin/visit-requests/{id}/complete-early`（`booking.handle`）。約今天的保留場次；約之後日子的不再掛場次、釋出那一場的名額，招生訪視參觀日期是今天，原場次留在歷程。場次已開始才按就是一般的標記已到場。`/complete` 照舊要等場次開始。沒有 migration。
- **驗證**（Node 22；後端測試庫 `ivy_website_test_early1012`、stack 庫 `ivy_website_e2e_early1012_test`、埠 8751／3751）：後端全套 pytest 1704 passed、1 skipped（新檔 `test_visit_complete_early.py` 8 項）；後台 typecheck 通過，vitest 全套 1862 passed、2 failed（`admissionsRecords.test.ts` 兩項在全套負載下逾時，單獨重跑連同相關 4 檔 88 項全過）；`contract:check` 一致；官網 typecheck、`test:website` 933 passed；stack e2e 新增 `visit-complete-early.spec.ts`（桌機流程含名額釋出、手機 390 按鈕 44px 不橫捲）通過，`visual` 案件明細基準因頁首多一顆按鈕重拍（差異 6%，只有頁首按鈕與提示、下方內容下移）。
- **未驗證**：正式站；iOS Safari 實機；跨午夜或場次剛開始那一刻按下（後端以鎖內判斷為準，有測試）。

## 2026-10-08 招生入學區域分析（`feature/admissions-area-20261008`，10-12 已部署 main `c7cbe1bc`；自動同步仍關）

使用者要求把園務「統計分析 → 區域分析」搬一部分過來。**使用者 10-08 裁定**：做里別來源統計、里界地圖、附近幼兒園、來源距離分布；精度到里即可、**不做地址分析同意勾選**（所以家長地址不送任何外部服務）、園所只用公開資料、地圖用 Leaflet＋國土測繪底圖。規格 `docs/specs/2026-10-08-admissions-area-design.md`，計畫 `docs/superpowers/plans/2026-10-08-admissions-area*.md`，規則見 DESIGN.md「招生入學：區域分析」，轉移契約記在 `contracts/ivy-recruitment/README.md` 第 18 點。

- **後端**：新子套件 `backend/app/admissions/geo/`——地址解析（全形／之號／樓層／舊高雄縣／缺區／外縣市）、TWD97→WGS84 轉換（不加依賴）、門牌 CSV 串流匯入（分批 COPY、批次標記、成功才切換）、幼兒園 JSON 匯入、五級比對（exact／nearby／street／district／unlocated，另有 pending）與校區座標；migration `e7a1c4d9b2f6` 新增 `geo_doorplates`、`geo_kindergartens`、`geo_dataset_status`、`recruitment_visit_geo` 四張表（`recruitment_visits` 不改結構，`district` 改由伺服器依地址填寫）；訪視建立與改地址時同交易比對，匿名化清掉里與距離、保留 `district`；同步由獨立背景迴圈（`workers/geo_loop.py`）與 CLI `python -m app.cli geo-sync` 兩條路，共用 session 級 advisory lock（搶不到就不跑）；新 API `GET /admin/admissions/area`、`/area/kindergartens`、`/area/boundaries`（ETag）；訪視明細新增 `district`／`village`／`geo=no_village` 篩選與 `geo` 回傳欄位；里界 GeoJSON（893 里，約 600KB）隨程式提交。契約重產（`contracts/openapi.json`、`website-api.d.ts`）。
- **後台**：統計分析新增「區域分析」子分頁（狀態列、地圖、附近幼兒園、行政區／里／距離三張表；行政區表與里表每列有「查看明細」）；訪視明細可依區域篩選（網址 `area`）、展開列顯示比對結果；`StatsDimensionTable` 新增可選的按鈕欄；後台 CSP 放行 `https://wmts.nlsc.gov.tw` 圖磚。Leaflet 1.9.4 只在地圖 chunk 動態載入。
- **口徑裁定**：統計以「有地址」為母數（`totals` 另有 `no_address`、`anonymized`）；本校位置未定位時所有訪視的距離一律歸「無距離」；鄰近比對同單雙號優先、號碼差 30 以內；距離分布表沒有「查看明細」。
- **部署注意**：`WEBSITE_GEO_AUTO_SYNC` 所有環境預設關閉；開啟前確認 Railway PG 剩餘空間 ≥ 500MB（門牌一版含索引約 185MB，換版時新舊並存約 370MB）。關著時區域分析顯示「門牌資料尚未匯入」。開啟步驟與手動退路寫在 `deploy/README.md`「公開地理資料同步（招生區域分析）」。本校改址後，已存的距離要等下一次同步（或手動跑 `geo-sync`）才重算。
- **驗證**（Node 22；後端用獨立測試庫 `ivy_website_area1008_test`，皆為本機結果）：A 階段閘 `test_geo_*`＋`test_csv_export` 238 passed、既有六個檔 109 passed、migration 升降升來回；完整 115 年 10 月門牌（775,772 列，略過 544 列）＋kiang 734 所高雄市營業中幼兒園地址比對：exact 708、nearby 11、street 2、district 13，精確＋鄰近 98.0%（門檻 95%），門牌表含索引 185MB。B 階段閘 後端全套 1929 passed、1 skipped，`npm run contract:check` 通過。C 階段：C8 完成時 admin 全套單元測試 1889 passed（其中一個既有的通知逾時測試在機器卡頓時失敗、單獨重跑通過）；stack e2e `admissions-area.spec.ts`＋`admissions-flow.spec.ts` 7 passed（其中 1440／390 兩條會輸出截圖供目視，斷言本身是頁面不橫向溢出、地圖里界路徑存在、沒有失敗提示，390 另斷言地圖 `touch-action`）。**最終整合驗證**（C12，同一台本機、Node 22）：`npm --prefix admin run build` 後 Leaflet 與圖磚網址只在另切的 chunk——`AreaMap-*.js`（7.8KB，與其 css）＋`leaflet-src-*.js`（148.7KB）；含 `wmts.nlsc.gov.tw` 的只有 `AreaMap-*.js`，`index-*.js` 不含，`index.html` 的 modulepreload 也沒有，`AdmissionsView-*.js` 只以動態 `import()` 引用 AreaMap。`npm --prefix admin run typecheck` 結束碼 0；admin 全套單元測試 142 檔、1900 passed、1 skipped（`editorSectionFields.test.ts` 的 `it.runIf` 條件式跳過，非本功能新增）；web 全套單元測試 85 檔、932 passed；`npm run contract:check` 通過（OpenAPI 與型別都一致）。stack e2e（`npm run e2e:build` 後分三次跑，獨立測試庫 `ivy_website_area1008_e2e_test`、埠 8781／3781，跑完已刪庫）：`admissions-area.spec.ts` 4 passed（含 setup）、`admissions-flow.spec.ts` 4 passed、`a11y.spec.ts` 28 passed（含 `/admin/admissions?tab=stats`，多一個子分頁沒有帶進 axe serious／critical 違規）。目視（`output/playwright/admissions-area-1440.png`、`-390.png`，另用臨時量測 spec 取數字，已刪、未提交）：1440 地圖在左（663px）、附近幼兒園清單在右，行政區表與里表同一列各 550px、「查看明細」欄完整在框內，距離分布表在下一列；左營區新上里上最深色；本校金色星號與 3 公里虛線圓看得到；狀態列與圖例沒被截斷。390 地圖約半個螢幕高、右下「移動地圖」鈕，清單在地圖下方，頁首篩選收成摘要鈕；頁面不橫向溢出：`documentElement.scrollWidth`＝`clientWidth`＝390（`body` 也是 390），沒有未被裁切的溢出元素——先前量到的 425 是 Leaflet 內部 SVG（427px、右緣 408px），被 `overflow:hidden` 的 `.leaflet-container` 裁掉，不會讓頁面橫捲。本機構金色（`oklch(0.88 0.14 92)`）與四種園所類型色相比，最接近的是準公共橘，OKLab 距離約 0.28（亮度差 0.26），比公立與私立兩色彼此的 0.13 大；本機構標記另有較大的圓、深金外框與星號，截圖上分得出來。跑 e2e 期間本機進了 Maintenance Sleep（`pmset -g log` 有 66 秒到 17 分鐘不等的睡眠），a11y 重跑四次各有一項剛好跨在睡眠上而逾時（`/admin/visit-requests`、`/admin/visit-requests/{visit}`、`/admin/admissions?tab=records`、`/admin/users`，每次不同頁），另有一次 API 啟動逾時；重跑單項通過，改用 `caffeinate -dimsu` 包住整個 spec 後 28 項一次全過。
- **合入 origin/main 後重跑**（2026-10-12，合入後台工程清理 `41345e1a`；本機結果）：migration `e7a1c4d9b2f6` 改接 `a9e11038c869`，`alembic heads` 單一、降級再升級成功；後端全套 1964 passed／1 skipped；admin 1960 passed／1 skipped；web 934 passed；`contract:check`、admin typecheck 通過；stack e2e **完整套件 107 passed**（專屬庫與 port，含視覺基準與 a11y）。
- **未驗證／未做**：沒有用過真實家長地址（手填錯字與寫法的比對率未知，只有幼兒園地址的 98.0%）；自動找最新月份的頁面解析只用存下來的頁面樣本測過，沒有對線上資料平台實跑同步；Railway PG 剩餘空間未確認、同步在正式環境從未跑過；e2e 的底圖圖磚被攔成透明圖，真底圖與 CSP 放行只在單元測試確認，選做的本機 dev server 真底圖目視沒做、也沒在部署環境看過；沒有手機實機操作；stack e2e 只重跑 `admissions-area`、`admissions-flow`、`a11y` 三個 spec，其餘 spec（含 `visual` 基準）沒重跑；截圖範圍內沒有私立類型的園所，私立色只從圖例與 token 確認、沒在地圖點上目視；目視發現兩處版面觀察、沒改程式：390 的里排行要在框內橫捲後才看得到「查看明細」（按鈕左緣 367px、表框右緣 374px，初始只露 7px，不像行政區表露出一截提示可橫捲），1440 里排行表比行政區排行表低約 23px（里表多一行說明）且距離分布表右側留白；併入園務時 `district` 的口徑要擇一（官網從地址文字解析、只認高雄市 38 區、外縣市留空，園務由 regex 切出「○○區」）。不做人口、飽和度、機會判讀與各校 3／6 km 競爭環。

## 2026-10-08 後台工程清理：刪殘留功能與資料表、素材分頁、一次標完已讀、補三種預約方式 e2e（`chore/admin-cleanup-20261008`，10-09 已部署 main `9e89b8ff`；使用者裁定這次不備份）

使用者 10-08 看完後台盤點，要求先做「工程清理」這一批（預約表單加「預計入學時間」「目前就托狀況」延後），並**裁定連資料表與 FAQ 資料一起刪**。規則見 DESIGN.md「後台工程清理（2026-10-08）」。

- **全部標記已讀一次標完**：新增 `POST /admin/notifications/read-all`（選填 `campus_key`），一條 UPDATE 標完範圍內資料庫裡全部未讀（不只畫面上的 100 則），通知頁改用它；權限同單筆（`booking.manage`），不寫稽核。原本的 `/admin/my-notifications/read-all` 是另一張表（內容審核通知），沒動。
- **刪掉沒人呼叫的 API**：`POST /admin/visit-schedule/{campus}/generate`、`GET /admin/visit-requests/group-counts`、`GET /admin/content-kinds`、`GET／PATCH /admin/site-settings`（連同 `site_settings` 表與 `site_settings.manage` 權限；migration `304dd12e96bc`）。
- **刪掉家長改期申請的殘留**：後台核准／退回 API、通知頁「待核准的改期申請」、總覽待辦與頁首連結、明細的「待核准」階段、`ParentVisitRequestOut.reschedule_pending`、`reschedule_requests` 表（migration `e48a3ccedcd8`）。公開的 `reschedule-request` 仍回 410。
- **刪掉 FAQ 內容類型**：`shared_faq`、`campus_faq` 的註冊、欄位規則、`initialize-content`（現在建立 17 筆）、fixture；資料 migration `a9e11038c869` 依外鍵順序清掉 FAQ 的內容、版本、發布紀錄列、排程、素材引用與通知（`site_releases` 保留）。原本若只刪程式不刪資料，整站還原與排程發布會丟 `CONTENT_KIND_UNKNOWN`。
- **預約文案與五校介紹的舊欄位**：預約文案的 `consent_text`、`banner_*` 三欄與五校介紹的 `intro`、`description`、`fb_note` 改成 `Field(default="", exclude=True)`：舊版本照常可讀可還原、新存的版本不帶、公開輸出剔除（已發布的舊版本也是）、後台載入時丟掉；版本紀錄比對兩邊都先 normalize，不再把它們列成「還原後會改回」。沒有 migration。
- **素材列表在資料庫分頁**：`GET /admin/media` 改回 `{items, total, state_total, page, page_size, tags}`，篩選（校區、種類、標籤、關鍵字、排除失敗）改在資料庫做；中文標籤用 jsonb 比對。素材庫每頁 60 張（頁碼）、選圖器每次 40 張（「載入更多」、關鍵字後端搜尋）；官網草稿預覽逐頁讀完全部素材（某一頁讀不到時保留讀到的頁）。
- **三種預約方式有瀏覽器 e2e**：`tests/stack/booking-modes.spec.ts` 把國際校依序切成 LINE／電話／外部網站，驗聯絡區、主鈕文字與連結、沒有表單、選校清單標籤，最後還原（原本是 paused 且說明為空，還原時補上官網預設的暫停說明句，因為 API 規定 paused 一定要有說明）。驗收 A06／A16 改通過。
- **匯出小修**：stack 測試改用語意定位與共用常數、公式開頭規則對齊後端、跨午夜不再紅；每日數字表頭寫明是什麼次數（畫面與 CSV）；操作紀錄搜尋欄標籤與 `role="status"`；比率空白、伺服器匯出、`taipeiToday` 各收成一份；招生兩支匯出先組好 CSV 再寫稽核；三支匯出 OpenAPI 宣告 `text/csv`；授權說明寫明含地址與父母職業。
- **案件列表與即時預覽的已知限制**：長名字換行時行首不再出現「・」；⌘／Ctrl／中鍵點列空白處開新分頁；家庭階段沒有招生寫入權限時不留空的主動作區；預覽欄高改用實際量到的頂欄、動作列與版面位置（不再被動作列蓋住、捲到底不鑽進頂欄）；讀官網版失敗先等 1.5 秒重試一次；隱私權政策等沒有 id 的段落刪中間一段時，其他段不再被標成不同（依唯一標題對齊）。
- **文件更正**：`operations.md` 的登入稽核、家長通知、背景轉檔、產生時段；驗收表 A01／A04／A05／A06／A13／A16／A25 與「仍未做」清單；DESIGN.md 的改期申請、`group-counts`、通知頁區塊；`deploy/README.md` 與 `page_schemas.py` 的義華年份（業主 10-03 已裁定 1997）；隱私權政策初稿「申請改期」改「改期」（已存的草稿要在後台自己改）。

**上線前（push main＝正式部署，先問使用者）**：
1. 三支 migration 會刪表、刪資料，依 `deploy/CICD.md` 第 68 行**部署前先手動備份正式 DB**（PITR 未開；做法同 `deploy/README.md` 先前在 Postgres volume `ivy-website-backups/` 留 custom-format dump 並用 `pg_restore --list` 核對；`railway ssh` 由本人執行）。
2. 先查正式庫有沒有還沒處理的改期申請，不是 0 筆就先請園方聯絡家長：`SELECT rr.id, vr.campus_key FROM reschedule_requests rr JOIN visit_requests vr ON vr.id = rr.visit_request_id WHERE rr.status = 'pending' AND vr.status = 'confirmed';`
3. **舊映像不能直接回退**（不認得新 revision、FAQ 資料也回不來）：要回退先用新映像跑 `alembic downgrade c4e8a2f61b97`（重建兩張空表），再切舊映像。
4. API 先換新、web 還沒換的幾分鐘，開著的舊後台分頁在素材庫與通知頁會出錯，上線後請同仁重新整理後台。

- **驗證**（Node 22；後端測試庫 `ivy_website_cleanup1008_full_test`）：後端全套 pytest 1695 passed、1 skipped、1 failed（`test_admissions_follow_up_schema` 把 head 寫死成 `c4e8a2f61b97`，補上新三支後該檔 8 passed）；之後只動了素材列表 `page` 上限，`test_media_list_paging` 12 passed。`deploy/check_schema.py` 通過、`deploy/tests` 20 項 OK、`contract:check` 一致。admin typecheck、vitest 138 檔 1854 passed／1 skipped、build 通過（之後改版本紀錄 normalize，相關 10 檔 149 passed＋typecheck）。web typecheck、vitest 85 檔 933 passed、build 通過。admin 改完版本紀錄後再跑全套 138 檔 1855 passed／1 skipped。stack e2e 全套 104 項 103 passed（4.9 分），唯一失敗是 `admissions-follow-up.spec.ts`「甲到期」預期「今天」得到「逾 1 天」：跑在台北 00:12，是這支 spec 既有的台北 00–01 點時間相依（這輪沒動它）；台北 01:08 單獨重跑 `admissions-follow-up.spec.ts`：2 passed。
- **未驗證／未做**：正式站資料（是否有 FAQ 列、未處理的改期申請）；iOS Safari 與實機；預約表單兩題（延後）。已知小限制：最新 100 則都已讀但更早還有未讀時「全部標記已讀」按鈕是停用的；段落對齊在「前面新增一段＋同時改了後面那段的標題」時會配錯（只影響差異摘要）；預覽欄在很矮的視窗仍可能被動作列蓋到一點（`min-height:420px`）。

## 2026-10-07 公開資料不再帶出維護備註 `_todo`、更正兩處分校頁過時文件（`fix/public-todo-strip-20261007`，10-07 已部署 main `471966fc`）

審查舊分支 `feature/website-admin`（落後 main 814 個 commit，三個程式 commit 都是 main 上 `26eb29d7`／`fb74e5ce`／`503ec361` 的舊版）時，查到 main 本身有三處殘留。

- **`_todo` 外洩**：fixture 的 `_todo`（維護者的待辦與來源備註，含 repo 內部路徑 `design/hero-video-restoration-20260922/build.py`）原本會經 `publicCopy` 進 `/api/published-site` 與每頁 SSR payload，共 8 處（`home.hero`、`dayExperience.moments[3]`、五校、`siteMeta.headerPhone`）。`withoutRetiredFields`（`web/app/utils/public-copy.ts`）現在遞迴拿掉任何層級的 `_todo`；fixture 本身不動，後端初始化內容仍讀得到。測試 `web/tests/public-copy.spec.ts` 走正式路徑 `publishedContent`，先確認紅燈再轉綠。
- **`CLAUDE.md`**：「分校內頁才有地圖」「分校頁與預約頁在 900px 以下也收」改成現況（分校頁已拿掉、`/campuses/**` 301 回首頁）。
- **`docs/website-admin/seo-performance.md`**：Google 商家網站連結不再指示設成 `/campuses/<key>`，改先指首頁；`/visit/<key>` 是 noindex，要不要改指預約頁由園方決定。
- 未處理：`docs/website-admin/acceptance.md` A21／A22 的通過證據仍引用已刪除的分校頁測試，要不要補註留給負責驗收紀錄的人。

## 2026-10-06 後台匯出擴充（`feature/admin-exports-20261006`，10-07 已部署 main `6408063d`）

使用者要求：後台除了參觀案件，招生明細、統計、操作紀錄、成效統計也要能匯出。**使用者 10-06 裁定**：招生訪視明細與未預繳名單開放含個資匯出（取代招生規格 3.2「任何含個資的匯出」不做）、沿用「匯出個資」授權 `booking.export`、操作紀錄匯出不另寫稽核。規則見 DESIGN.md「後台匯出擴充（2026-10-06）」。

- **招生訪視明細**（後端產生）：「匯出 CSV」照目前畫面的全部篩選（含追蹤、負責人，不只本頁）；37 欄，欄位同現在的畫面（含來源分類、帶參觀老師、娃娃車、負責人；地址分析同意不進）。**含孩子姓名、電話、地址等個資**：要 `admissions.read`＋校區範圍＋「匯出個資」授權，**每次寫一筆稽核**（`recruitment_visit.export`，只記套用了哪些篩選），上限 1 萬筆（超過回「請縮小篩選範圍」，不截斷）。
- **未預繳名單**（後端產生）：統計分析「未預繳原因」下方名單的「匯出 CSV」，13 欄；授權、稽核（`recruitment_visit.export_no_deposit`）、上限同訪視明細。
- **招生統計表**（前端組、去識別）：統計分頁每張表（含五校比較、月度明細）有「匯出 CSV」；比率沒有值寫空白、計數缺值寫 0；沒有資料的表不顯示按鈕。
- **操作紀錄**：新增「期間」篩選（台北日期、含頭尾、不能選未來日期）；「匯出 CSV」照目前校區、期間、搜尋與「不列登入登出」逐頁讀完（每次 500 筆），超過 5,000 筆不產生檔案、提示縮短期間。人人有「裝置」欄，**只有總部多一欄「IP」**。匯出本身不另寫稽核（紀錄不含家長個資）。
- **成效統計**：五校比較、依來源、預約鈕點擊、預約孩子的班別、每日數字（每日變化與每日瀏覽各一）、網頁速度各有「匯出 CSV」，比率沒有分母寫空白。各頁瀏覽排行清單也有（欄名「頁面」「瀏覽次數」，檔名寫「官網全站」）。預約流程、預約結果統計格不是表格，不匯出。
- **民國月份寫成「115年09月」**：Excel 開 CSV 會把「115.10」當數字轉成 115.1，月份就錯了；畫面仍是 115.09。適用統計表與兩份名單的「月份」欄。
- **共用**：`backend/app/common/csv_export.py`（`safe_cell`、`filename_part`、`csv_attachment`、`roc_month_csv`、`BOM`；參觀案件匯出也改用，輸出不變、仍是串流）與 `admin/src/utils/csv.ts`（`buildCsv`、`downloadCsv`、`downloadServerCsv`、`rocMonthCsv`）；兩邊的公式注入防護同一條規則。新增兩個稽核動作與 13 個 metadata 鍵的中文，`labelCoverage.test.ts` 會讀後端原始碼比對；契約新增兩個匯出端點與操作紀錄的 `created_from`／`created_to`／`limit`。
- **版面**：390px 下訪視明細標題列不再被匯出鈕擠成直排、操作紀錄的期間選擇器不超出篩選卡片（≤720px 的 CSS）；最終審查另抓到 901～1030px（側欄還在、面板只剩約 600px）標題會被擠成兩行，標題列的 `flex-wrap` 改成所有寬度都開、h2 不縮不換行。未預繳名單的匯出鈕旁補「匯出範圍：目前篩選的全部結果（不只本頁）」（`useId()`＋`aria-describedby`）。stack 測試量外框鎖住 960／905／1030、1440、390。
- **最終審查後的修正波**：原始碼裡所有實體 BOM（U+FEFF）改成跳脫寫法（admin `CSV_BOM`、兩個前端測試、後端 `test_visit_attention_export`／`test_display_names`），守門測試改成掃整個原始碼（後端 glob `app`／`tests` 的 `.py`、admin 新增 `noLiteralBom.test.ts` 掃 `src` 的 `.ts`／`.vue`）；成效統計「各頁瀏覽」補匯出；招生統計表匯出失敗補 `notifyError`；後端補「游標＋日期範圍＋limit」合併翻頁測試；訪視明細標題列 901～1030px 修正與未預繳範圍說明（見「版面」）。
- **驗證**（Node 22；單檔結果見下、全套於 2026-10-07 由 controller 跑完回填；後端測試庫 `ivy_website_exports1006_test`）：單檔：後端 `test_csv_export` 33、`test_admissions_download` 28、`test_admissions_booking_link` 14、`test_admissions_stats` 34、`test_operations` 20、`test_audit_client_info` 11、`test_visit_attention_export` 6、`test_security_hardening` 20 passed；admin vitest `csvUtil`＋`statsDimensionCsv`＋`statsTab`＋`compareTable` 67、`admissionsDownload` 10、`auditExport` 18、`analyticsExport` 17（連同 9 個既有相關檔共 10 檔 97）、`labelCoverage`＋`admissionsDownloadLabels` 17 passed，`vue-tsc` 0 錯誤，`contract:check` 一致；stack `exports.spec.ts`（`E2E_DB_NAME=ivy_website_exports1006_e2e_test`、埠 8741／3741）7 passed，真瀏覽器下載、檢查 BOM、CRLF、欄數、公式注入、權限與 1440／390 版面。修正波後的單檔：後端 `test_csv_export`（含 glob 守門）、`test_operations`（含合併翻頁 4 項）、`test_visit_attention_export`、`test_display_names` 共 90 passed；admin vitest `noLiteralBom` 1、`csvUtil` 24、`statsDimensionCsv` 7、`analyticsExport` 19、`admissionsDownload` 11、`auditExport` 18，連同 `traffic`、`noDepositList`、`statsTab`、`compareTable`、`crossUx20261002`、`labelCoverage`、`admissionsDownloadLabels` 共 13 檔 164 passed，`vue-tsc` 0 錯誤；stack `exports.spec.ts` 8 passed（新增 960／905／1030px 版面項）。**全套閘門（2026-10-07）**：後端 pytest 全套 1672 passed、1 skipped（9 分 30 秒）；後台 vitest 全套 117 檔 1470 項全過、`npm run typecheck` 無錯誤；`npm run contract:check` 一致；web 全套 80 檔 829 項全過；stack e2e 全套 81 項全過（2.8 分鐘）。明細在 `docs/website-admin/acceptance.md` 的「後台匯出擴充」。
- **未驗證／未做**：Safari／iOS 實機下載與 Excel 實機開檔；正式資料量（接近 1 萬筆）的匯出時間與記憶體；成效統計各按鈕（含各頁瀏覽）的版面只有單元測試、沒目視；操作紀錄 5,000 筆上限數的是 API 回傳筆數、不是搜尋後的筆數。不做 Excel（.xlsx）。

## 2026-10-06 參觀案件明細時間線（C）與案件列表行程清單（B）（`feature/admin-visit-ux-20261006`，10-07 已部署 main `6408063d`）

使用者看完後台結構層比稿（`design/admin-ux-directions-20261006/`）選 C 與 B，先 C 後 B。規則見 DESIGN.md「案件明細：一條時間線＋一個主動作」「參觀案件：照參觀日排的行程清單」，計畫 `docs/superpowers/plans/2026-10-06-admin-visit-ux.md`，驗收列見 `docs/website-admin/acceptance.md` 同名一節。

- **案件明細（C）**：`VisitDetailView` 拆成 `components/visit/` 的 `VisitCaseHero`、`VisitPrimaryAction`、`VisitCaseTimeline`、`VisitCaseFacts`、`VisitCaseSettings`、`VisitCaseDialogs`，資料層與動作抽到 `composables/useVisitCase.ts`（明細與列表預覽共用）。頁首寫「家長・孩子」與「還有 3 天／結束了 2 小時」（只對預約正常的案件寫、結束後暖黃），依階段只給一顆實心主鈕（家長到了／核准改期／填招生資料／建立招生訪視或重新載入／重新預約），撥號是頁首的文字鈕、桌機也有；聯絡紀錄與案件歷程合成一條時間線、輸入框固定在最上（家庭版面再併入參觀後聯絡與招生事件）；家長資料壓成一張兩欄表（孩子一行寫「姓名，生日」，補登只有生日也列出來）；改場次、家長管理連結收成設定列，取消預約在最底；兩欄 `1fr＋360px`，1100px 以下一欄（頁首 →（家庭：處理區）→ 招生資料 → 時間線 → 家長資料 → 設定列）。承辦人沒有出現（10-06 已拿掉）。
- **參觀案件列表（B）**：頁籤改成接待語意的接下來／時間已過／已到場／已取消／全部（保留第五個「全部」，舊連結與跨狀態搜尋要有落點；網址仍用 `group`，舊連結照對照表落點，預設是接下來）；預設依參觀時間排序並分成「今天／明天／本週／之後」等日期組（台北日期、週一開始，跨年的日期寫年份）；一列是時間＋接待狀態、家長・孩子、校區、電話與動作，列內有淺色「到了／沒來」，已到場的列有「填招生資料」（直接開表單，不帶「已標記已到場」那句；還沒有招生訪視的舊案改為打開案件、頁首有「建立招生訪視」，已匿名化的不開表單）；開著過台北午夜自動重讀；1280 以上點一列在右側開預覽（和明細同一組元件、按鈕一律淺色、時間線只列最新 3 筆、取消在最底），「下一筆」沿這一頁往下。預覽的選取在使用者換頁籤、篩選、搜尋、翻頁時清掉（有打一半的紀錄先問），處理案件造成的重讀則保留；列表列上處理了預覽那一筆，預覽跟著重讀。清單容器 640px 以下（1280 開預覽時約 540px）電話移到家長名字下面，長名字不從中間斷開。手機批次勾選框是 44px 觸控範圍，也不擠掉主連結。
- **後端**：`GET /admin/visit-requests` 加 `view=upcoming|past|arrived|cancelled`（接待頁籤，`status_groups.view_condition`）與 `order=visit_asc|visit_desc`（依場次日期與開始時間，沒有場次排最後），新增 `GET /admin/visit-requests/view-counts`（回 `upcoming`＝接下來件數、`past_unmarked`＝時間已過還沒標記的件數）；匯出與稽核 metadata 一併帶 `view`；舊 `group`、`group-counts` 語意不變。**沒有 migration**（`378f4dbd..HEAD` 的 diff 沒有 `backend/alembic` 檔案），`contracts/openapi.json` 與產生的型別已重新產生。
- **重構順帶**：列表與明細共用的規則只留一份：`opensForm`（標記到場後要不要開招生資料表單）在 `useVisitCase`，`followUpTracked`／`followUpDue` 與台北日期、相對時間、日期分組在 `utils/visitSchedule.ts`，`formatWeekday` 搬進該檔、`labels.ts` re-export。
- **驗證（逐 task，到 HEAD `0e169831`）**：admin vitest 逐檔前景跑，新增或改過的測試檔結果 visitCase 9、visitCaseHero 4、visitCaseTimeline 8、visitCaseLayout 10、visitPrimaryAction 22、visitTimeline 4、visitSchedule 40、visitScheduleList 21、visitListQuery 26、visitPreviewPanel 19、visitGroups 11、visitRequestsBatch 7、listUx 4，其餘掛載明細與列表的既有測試檔（每個 task 約 20–30 檔）逐檔全過；`vue-tsc -b --noEmit` 每個 task 後都無輸出。後端 `test_visit_views.py` 8 passed，相鄰的 13 個後端測試檔逐檔 passed，ruff check 通過，`contract:generate`／`contract:check` 一致（Task 6）。stack（拋棄式庫）：Task 10 修正輪整套 81 passed（2.8 分），其中 a11y 28（含開著預覽面板的 axe）、visual 5（共五張基準，含 setup 一項才是回報的「6 passed」）、新 `visit-schedule.spec.ts` 6（含 1280、1440 預覽面板區塊不被壓扁、捲到最底看得到取消預約）；`visual.spec.ts` 五張基準裡只重拍 `visit-detail` 一張，其餘四張沒變。1280／1440／1100／390 截圖在 `output/admin-visit-ux-20261006/`（gitignored）。
- **最終審查修正波（`c4fcace9` 之後）**：列表「填招生資料」遇到還沒有招生訪視的舊案不再是死路（打開案件，頁首有「建立招生訪視」），已匿名化的不開表單；手機批次勾選框回到 44×44 觸控範圍；個資保存政策頁的「參觀案件」連結改 `/visit-requests?open=1`（預設的「接下來」看不到逾期未結案的預約）；後端補「接下來以台北日期切、不是 UTC 日期」的測試（`test_visit_views.py` 9 passed）；stack spec 衛生（截圖前等動畫、共用 `expectNoHorizontalOverflow`、1100 一欄補「時間線在家長資料上面」、`searchVisitList` 比對 `q` 的值、列的電話縮排改吃時間欄變數）。逐檔 vitest 14 檔 265 項、`vue-tsc` 無輸出、stack 的 visit-schedule／a11y／visual 38 passed（含 setup）與 booking-flow 8 passed。
- **全套閘門結果**：HEAD `0e169831` 上 admin vitest 119 檔 1546 項、後端 pytest 1614 passed 1 skipped（9 分 20 秒）、`contract:check` 一致、stack 81 passed；最終版本 HEAD `3a12f82d` 上 admin vitest 119 檔 1552 項、後端 pytest 1615 passed 1 skipped（10 分 00 秒）、`contract:check` 一致、e2e:build 成功、stack 81 passed（3.1 分鐘）、alembic heads 單一 `c4e8a2f61b97` 無新 migration。
- **沒做／未驗證**：mock 的「修改資料」連結與「兄姊」「（中班）」（後台沒有改家長資料的 API、資料裡也沒有這些欄位）、常駐複製家長連結（網址只在產生當下顯示，資料庫只存 hash）；iOS Safari 與 Android 實機、正式站、真資料量下的跨頁分組（只有單元測試與小量 fixture）、真的開著跨過台北午夜（只有 fake timer 測試）。已知小瑕疵（審查時列為不阻擋）：1440＋批次勾選＋預覽時長名字換行後第二行以「・」開頭；家庭階段帳號沒有 `admissions.write` 時頁首主動作區是空的。待使用者確認：第五個頁籤「全部」。

## 2026-10-06 內容編輯三欄＋即時預覽（方向 D，`feature/admin-editor-preview-20261006`，10-07 已部署 main `6408063d`）

使用者看完後台結構層比稿（`design/admin-ux-directions-20261006/`，A–E）選了 D（`d-editor.html`），並同意改官網的 `/preview`。計畫 `docs/superpowers/plans/2026-10-06-admin-editor-preview.md`，規則見 DESIGN.md「官網後台內容編輯：三欄＋即時預覽」，驗收見 `docs/website-admin/acceptance.md`「內容編輯三欄＋即時預覽」。

- **版面**（`ContentEditor.vue`）：1280 以上、後台與官網同源、這種內容有預覽頁時，改成左段落目錄（152px、黏住）、中表單（420–560px，沒有目錄時 440–640px）、右官網預覽（至少 320px、黏住，高度扣掉黏底動作列）。目錄一律移到左側（原本 1280 以上在表單右側），和官網不同的段落旁邊打一個小點（報讀「（和官網不同）」）。五校介紹新增「基本資料／封面照片與建築線稿／社群」三段目錄；最新消息、孩子的一天、關於、特色教學、入學、隱私權政策各段落都標了它編輯哪些欄位。1280 以下與校園探索（寬版編輯器）沒有預覽欄，維持原版面與「存草稿並預覽 ↗」。
- **動作列與發布**：動作列直接寫「草稿有 N 處修改：欄位A、欄位B」（和官網目前那一版比，最多列 4 個，其餘「…」），所以載入時就先讀一次官網那一版當基準；還在讀時不寫和官網比的結果（沒修改顯示原本說明、有修改只寫「有未儲存的修改。」，不閃「沒有修改」→「N 處」）。從沒發布過依角色寫「還沒發布過，發布後／送審核准後家長才會看到這份內容。」；讀不到官網版退回「改了 N 個欄位：…」（和上次儲存比）。發布確認框只寫欄位名（「和官網目前的內容相比，會更新 2 個欄位：A、B。發布後家長立刻看到。」），不再列改前→改後；核准並發布照舊列完整差異；讀不到官網版時退回舊差異框。
- **即時預覽（後台）**：右欄是同源 iframe `/preview?embed=1&live=1&page=…`（`sandbox="allow-scripts allow-same-origin"`），上方切預覽哪裡（對照表 `previewTargets.ts`）與桌機／手機（預設手機，記在這台瀏覽器；桌機的虛擬視窗高度最多 900）。`useLivePreview.ts` 等預覽頁回 ready 後，把還沒存的表單 debounce 300ms 以 postMessage 傳進去（協定 v1，`previewProtocol.ts`），預覽接上（live）之後換預覽分頁只送訊息、不重新載入；還沒接上時換分頁照舊換網址。預覽以「最後一次載入完成的校區」為準：有未存修改換校、「放棄修改？」確認框還開著時，不會把上一校的內容標成下一校。狀態字：「正在載入預覽…」「預覽的是還沒存的修改」「預覽的是上次儲存的草稿」（20 秒沒回；從沒存過寫「預覽的是官網目前的內容」）「草稿太大，預覽沒有更新」「預覽畫不出這個修改」，沒登入蓋一層「重新載入預覽」。
- **官網（`web/`）**：`app/utils/preview-live.ts`（訊息格式與驗證）、`preview-highlight.ts`（用改到的文字找位置框起來，回報 `applied.hit` ∈ `text｜block｜none｜failed`；只捲預覽視窗，頂端留白用頁首實際高度，固定頁首與 fixed 目標不捲、sticky 的區塊照捲；框整塊時頁首底下要露出 min(區塊高, 可用視窗高的一半) 才算看得到，只露幾 px 會捲）、`pages/preview.vue` 即時模式（點連結不換頁，路由守衛也擋掉官網元件自己的 `navigateTo`，離不開 `/preview`；首頁五校「預約參觀」的 `onBookingClick` 尊重前面 handler 的 `preventDefault`，公開站行為不變）。即時預覽裡首頁五校會暫停自動輪播，切到被改的那一校後不會自己轉走。後台 CSP 明寫 `frame-src 'self'`；`/preview` 維持 `frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN`、no-store、noindex。草稿不進網址、storage、cookie、快取、SSR、telemetry。沒動 backend、contracts、API。
- **驗證**（Node 22.23.2）：逐 Task 都先寫失敗測試再實作，審查後的修正輪也補測試。最終閘門（HEAD b9529dcd）：admin vitest 120 檔 1530 項（1 skipped）、web typecheck 0 WARN 與 test 85 檔 930 項、contract:check 一致、stack 87 passed（編輯器即時預覽、內容流、隱私、無障礙、鍵盤、角色、視覺基準）。五校介紹基準已更新。逐項驗收見 acceptance.md。
- **限制**：本機 `npm run dev`（後台 5173、官網 3000 不同源）看不到預覽欄，要看用 `npm run e2e:build` 的同源建置；「改哪格亮哪格」對圖片、焦點、經過轉換的文字只框整塊；官網版讀取失敗不重試（動作列退回和上次儲存比）；桌機預覽縮到約三成看不清字（預設手機）；頁面沒捲動時預覽欄下緣被黏底動作列蓋 30–105px、捲到底時頂端被頂欄蓋約 24px；隱私權政策刪掉中間一段時，後面各段會被標成「和官網不同」（用序號比對）；五校介紹沒有「預約頁」預覽分頁（`/preview?page=visit` 只畫個資說明，沒有預約表單）。
- **未驗證**：Safari／iOS 實機、正式站（同源 iframe、CSP `frame-src` 與 Railway 上的實際行為）、手機頁首選單展開時的框選（只有單元測試）、草稿太大與 20 秒逾時的真瀏覽器路徑（只有 jsdom）。
- **待使用者確認**：發布要不要完全不跳確認框（計畫預設：保留、只寫改了哪些欄位）。合併與部署等指示。

## 2026-10-06 成效統計 UI/UX：三個頁籤、五校表置頂、說明收合（`feature/analytics-ux-20261006`，10-06 已部署 main `3d50e0a1`）

使用者指著正式站 `/admin/analytics` 說「幫我優化這塊的 ui/ux」。沿用 10-06 結構層比稿的 E 方向（`design/admin-ux-directions-20261006/e-analytics.html`）實作，規則見 DESIGN.md「成效統計：三個頁籤與兩欄格線」。

- **頁面**（`AnalyticsView.vue`）：寬度從 720px 放到 1200px；分成「各校預約／官網瀏覽與速度／預約孩子的班別」三個頁籤（`?tab=` 進網址，左右鍵可切）。校區、期間、重新整理只選一次放在頁籤右邊，瀏覽頁籤因後端只接受 7～90 天仍自己選期間。預約頁籤是 3:2 格線：五校比較橫跨整列，左欄預約結果、每日變化，右欄預約流程、依來源、預約鈕點擊；1400px 以下左右等寬，1100px 以下一欄。
- **五校比較**（`BookingOutcomesSection.vue`）改成自己的表：拿掉「預約方式」「取消原因」兩欄（方式寫在校名下面的小字，取消原因看選定校區），到場率畫小條、「樣本較少」改成比率下方小字、「現在」兩欄表頭兩行；有案件權限時這兩欄的數字直接連到該校的案件列表。預約結果 6 格縮成 4 格，「還沒到參觀日」「參觀時間過了還沒標記」併成一句。
- **說明收合**：新元件 `AnalyticsExplainer.vue`（`<details>`「這些數字怎麼算」），五段算法說明與排除規則都收進去；`AnalyticsMeta` 的期間／單位／更新一行保留。瀏覽頁籤拆成瀏覽次數（加「平均每天」）、各頁瀏覽與網頁速度三張面板並排。
- **驗證**（Node 22.23.2）：admin vitest 110 檔 1377 項全過（改 `analyticsFunnel`、`analyticsOutcomes`、`traffic` 三個測試檔對新 DOM 的斷言）、`vue-tsc -b`、`vite build` 通過。本機 stack（測試庫 `ivy_website_analyticsux_test`、API 8751、vite 5351，已關、已刪）用 `output/analytics-ux/seed.cjs` 灌兩校 18 筆案件、點擊與瀏覽，在 390／1280／1440 三個頁籤：橫向溢出 0、axe（WCAG 2.1 A／AA）serious／critical 0、鍵盤右鍵切頁籤焦點跟著走。截圖在 `design/admin-ux-directions-20261006/shots/after-e/`。
- **沒做**：匯出 CSV（mock 有、目前沒有匯出 API）；班別頁籤只換說明收合與寬度上限。未驗證：正式站。

## 2026-10-06 招生：未預繳口徑對齊、逾期看參觀日、拿掉待追蹤分頁（`feature/admissions-nodeposit-20261006`，10-06 已部署 main `0ae1f089`）

使用者問招生入學的「尚未預繳」在什麼情況下會出現。說明後，使用者要求處理兩個落差（訪視明細「預繳：否」和統計對不上、逾期從建檔時間起算），並指著 `/admin/admissions?tab=followups` 說「待追蹤 幫我拿掉」（範圍確認為只拿這個分頁）。規則見 DESIGN.md「招生：未預繳口徑對齊、逾期看參觀日、拿掉待追蹤分頁」。

- **後端**：訪視明細的 `has_deposit=false` 排除已退出的訪視（`records.py`），和統計的未預繳同一批。未預繳的逾 14 天、冷名單（90 天）從 `created_at` 改看 `visit_date`，用台北日期算（`stats.py` 的 `_visit_cutoff`，統計摘要、積壓警示、未預繳明細共用）。積壓警示文案改「參觀超過 14 天仍未預繳…」。API 形狀沒變，`contracts/` 不用重新產生；`contracts/ivy-recruitment/README.md` 補「和園務不同」第 16、17 點。沒有 migration。
- **後台**：拿掉招生入學的「待追蹤」分頁（`FollowUpsTab.vue` 刪除）和分頁標籤上的到期數字。舊連結 `tab=followups` 退回漏斗看板，`fu`、`owner` 從網址清掉。頁首學年學期不再因分頁停用。總覽的「參觀後該聯絡的家長」任務卡也拿掉。`getFollowUps` 等死碼一起刪。記錄聯絡、排下次聯絡的成功訊息不再提「待追蹤」。統計「未預繳原因」下方的說明改成「逾 14 天待追、冷名單＝參觀滿 14、90 天仍未預繳」。後端的 follow-ups API 與總覽鍵保留。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_nodeposit1006_test`，跑完已刪）：
  - 後端：新增 `test_has_deposit_false_excludes_withdrawn`（用 API 做出退預繳、退註冊）、`test_no_deposit_cutoff_uses_taipei_date`（台北午夜前後）。未預繳的合成資料改成建檔時間和參觀日刻意對不上（補登、很早建檔），逾期與冷名單的邊界改成「剛好滿 N 天／差 1 天」。改程式前 6 項失敗，改完通過。整套 pytest 1599 passed、1 skipped。`contract:check` 一致。
  - 後台：拿掉待追蹤分頁的測試改成驗「沒有這個分頁、舊連結退回看板」和「總覽不列任務卡」；`vue-tsc -b` 通過。整套 vitest 在負載 40–90（別的 session 在跑）時有 2 項 5 秒逾時，都在 `admissionsRecords.test.ts`，單獨重跑 34 項全過；其餘 107 檔通過。
  - 官網：829 項與 typecheck 通過（沒有改官網）。
  - stack e2e（`E2E_DB_NAME=ivy_website_nodeposit1006_e2e_test`、埠 8796／3796，跑完已刪庫）：`admissions-follow-up.spec.ts` 改成在預約明細排下次聯絡、記錄聯絡，到期後在訪視明細用「追蹤：已到期」找到那一筆；`admissions-flow`（三個分頁截圖）、`a11y`（拿掉兩個待追蹤網址）、`visit-family-page` 一起跑，共 31 項，第一次有 1 項失敗（下拉的佔位文字擋住點擊，改成點外框），重跑通過。整套 stack 沒跑。
  - 未驗證：正式站實際操作。

## 2026-10-06 總覽改成「今天的行程板」（`design/admin-mockup-20261006`，10-06 已部署 main `8bac33d4`）

使用者看完後台結構層比稿（`design/admin-ux-directions-20261006/`，A–E 五方向）選了 A。規則見 DESIGN.md「官網後台總覽：今天的行程板」。

- **後台**（`DashboardView.vue` 重排）：頁面主體是「今天的參觀」，上午／下午分組，一列一組家庭（時間、家長・孩子、校區、電話連結），場次開始後列內「到了／沒來」，已到場、未到場的整天留在名單上寫狀態；標題旁一句摘要「義華 3 組、明華 1 組，2 組結束了還沒標記」取代原本「今日參觀／到期待追蹤」兩格大數字。右欄「本週五校」小表（已預約、還可約、未開放的給「開放」入口、自選場次的連到該校月曆）取代「校區尚未開放預約」提醒卡（舊版 API 沒有本週表時卡片照舊）。「要處理」改成一列一件（數字、標題、查看），說明段落只留在有子清單或要講後果的項目；常用工作縮成一列文字連結（有案件處理權的人第一個是「補登案件」）。主按鈕、我承辦的案件、30 秒時鐘與換日重讀、背景重讀都不變。
- **後端**（`dashboard_service.py`）：`today_visit_list` 改列今天已確認、已到場、未到場的案件，每筆多 `child_name`、`phone`、`status`（沒有案件讀取權的角色照舊拿空名單）；`today_visits` 跟著算整天。新增 `week_campuses`：今天起七天各校 `booked`（占名額的案件，和月曆已排數一致）、`open`（只有自選場次的校有數字）、`mode`。回傳仍是 dict，OpenAPI 不變。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_mockup1006_unit_test`）：後端新增 `test_dashboard_today_board.py`，碰到總覽 API 的 14 個測試檔 194 passed；`ruff check` 過；`contract:check` 一致。後台新增 `dashboardBoard20261006.test.ts`（摘要句、分組、已到場列、本週表與入口、舊版 API 退回、要處理一列一件、空狀態），更新 6 個舊測試檔對兩格大數字、捲動連結、引導語、待辦可及名稱的斷言；整套 vitest 109 檔 1378 項、`vue-tsc -b` 通過。本機 stack（`ivy_website_board1006_test`、埠 8781／5381，已關、已刪）灌今天已結束／已到場／進行中／稍後四組，總管理者與櫃台在 1440／1280／390 截圖，axe（WCAG 2.1 A／AA）四組 0 項。
- 沒做：B–E 方向（案件列表行程清單、明細時間線、編輯三欄預覽、統計頁籤）等使用者再挑；「第二次來看」標記（mock 有、資料沒有）。
## 2026-10-06 參觀案件拿掉承辦人（`feature/remove-assignee-20261006`，10-06 已部署 main `7706a7a6`）

使用者指著預約明細右側的「承辦人：未指派」說「可以幫我把承辦人這個邏輯拿掉嗎」。規則見 DESIGN.md「參觀案件拿掉承辦人」。

- **後台**：預約明細的承辦人選單與家庭版面「預約承辦」小字、案件列表的承辦人欄／篩選／手機卡片「承辦：」、接待月曆的「承辦：」（只留「電話補登」這類來源）、總覽「我承辦的案件」與「承辦人已停用」待辦、停用帳號的未結案件數提醒都拿掉；`useVisitStaff` 拿掉 `assignableFor`。舊歷程與操作紀錄的承辦人標籤保留。
- **後端**：刪 `PATCH /admin/visit-requests/{id}/assignee`、清單／匯出的 `assignee` 篩選、總覽 `my_open_cases`／`inactive_assignee_open_cases`；明細與月曆不再回 `assigned_staff_id`；補登不再自動指派；招生負責人改成標記到場的人。**資料表欄位保留、沒有 migration**。契約已重新產生。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_test_noassignee`）：
  - 後端：改寫 `test_visit_manual_and_assign`（新增「承辦人已拿掉」回歸測試）、`test_edit_versions`（版本鎖改用下次聯絡）、`test_admissions_follow_up`（負責人＝標記的人，舊承辦人不看）、`test_reception_handling`，刪 `test_dashboard_my_cases.py`；全套 1591 過、1 略過。
  - 後台：`uxRound8Cases` 改成拿掉後的回歸測試（舊書籤不送 assignee、總覽沒有兩區、停用帳號不查件數），其餘 fixture 拿掉欄位；vitest 108 檔 1367 項全過、`vue-tsc -b` 通過；`contract:check` 通過；官網 829 項通過。
  - stack e2e（`E2E_DB_NAME=ivy_website_e2e_noassignee_test`、埠 8752／3752，跑完已刪庫）：整套 76 項全過。`visit-detail` 基準圖差異低於 1% 門檻原本會照舊通過，改用 `--update-snapshots=all` 重拍成沒有承辦人的版本。1440／390 截圖在 `output/playwright/remove-assignee-20261006/`。
  - 未驗證：正式站登入後實際操作。
- **補修**（`169dac9e`）：案件頁「下一筆」沿用列表條件的 `LIST_KEYS` 漏了 `assignee`，清掉並在 `adminBugAudit20261006.test.ts` 補一項（先紅後綠）。

## 2026-10-06 招生來源分類收斂成六項（`feature/source-category-choices-20261006`，10-06 已部署 main `0909491c`）

使用者：「訪視紀錄的來源分類幫我收斂選項」，選「六項、只改畫面」。規則見 DESIGN.md「來源分類收斂」。

- **後台**：新增 `admin/src/admissions/sourceCategories.ts`。訪視表單的來源分類下拉只列六項短標籤（在校生弟妹、畢業生弟妹、家長介紹／社區招生、自報生（廣告、鄰居、網路、活動）、邀約來園、舊生復學）；在校兄姊二人均分、邀約來園——原本招生人、到家中收預繳不再列出，舊資料選過的照樣顯示園務原文，編輯時附在下拉最後。明細展開列與預約明細家庭頁改用同一份文字。沒有後端、契約、migration 變動，資料仍是園務九類代碼。
- **驗證**（Node 22.23.2）：新增 `admissionsSourceCategories.test.ts` 6 項（先紅後綠：代碼對後端 `constants.py`、文字、下拉附加不列的代碼、表單新增／編輯、家庭頁顯示）；`admissionsRecordDialog`、`admissionsRecords`、`familyAdmissionsData` 各改一行預期文字。vitest 全套 109 檔 1374 項全過（另一個 session 同時跑 pytest，用 2 worker、逾時 20 秒）、`vue-tsc -b`、`vite build` 通過。
- **未驗證**：沒在 dev server 上用瀏覽器實際點下拉（單元測試掛的是真的 Element Plus 元件）。

## 2026-10-06 訪視紀錄表單：四區展開、帶參觀老師多位、家長介紹（`feature/record-dialog-20261006`，10-06 已部署 main `ee086b4d`）

使用者：「聯絡與來源這邊不要折疊、預繳狀態也不要折疊，然後幫我優化 UI/UX」，接著「帶參觀老師可能有多人；介紹者改成家長介紹（這個學童可能是其他家長介紹來的）」，並裁定統計的接待人員改看帶參觀老師。規則見 DESIGN.md「訪視紀錄表單：四區展開、帶參觀老師多位、家長介紹」。

- **後台表單**（`RecordDialog`，看板新增、明細編輯、標記到場後、家庭頁共用）：拿掉摺疊，四區都直接展開（區塊標題＋分隔線，拿掉「已填 N 項」）；入學學期移到生日旁、聯絡人與電話移到「聯絡與來源」、來源分類｜家長介紹同列、來源備註整列；電話範例改成 placeholder；預繳狀態用階段標籤、說明縮成一句、原因說明選了原因才出現；新增時游標停在幼生姓名。帶參觀老師改成標籤式多選（可打新名字、本校填過的老師當建議），存回 `tour_guide_name` 用「、」串起來，超過 50 字不能存。「介紹者」全後台改叫「家長介紹」（明細篩選與展開列、未預繳名單、家庭頁、操作紀錄欄名）。
- **後端**：`constants.split_tour_guides`（「、」「，」「,」「／」「/」都當分隔、去重複）；選項 `tour_guides` 逐位計數；統計 `by_referrer`／`referrer_source_cross` 改成 `by_tour_guide`／`tour_guide_source_cross`，依帶參觀老師分組、多位時每位各算一次。`contracts/` 重新產生。沒有 migration、不加欄位；匯出回園務不動。
- **後台統計**：接待人員表、接待人員 × 年級、接待人員 × 來源（原「介紹者 × 來源」）改讀新鍵，表下寫口徑。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_recdlg1006_test`）：
  - 後端：新增 `split_tour_guides` 10 組、多位老師統計、選項逐位計數測試；整套 pytest 1609 passed、1 skipped。`contract:check` 一致。
  - 後台：`admissionsRecordDialog.test.ts` 新增多位老師（拆分、去重、送出串接）、超過 50 字、四區展開與欄位位置、游標、舊分隔符不誤送、原因說明出現時機；更新統計、明細、未預繳、家庭頁、稽核修正的舊文字斷言。整套 vitest 108 檔 1373 項、`vue-tsc -b` 通過。
  - stack e2e（`E2E_DB_NAME=ivy_website_recdlg1006_e2e_test`、埠 8796／3796，跑完已刪庫）：`admissions-flow.spec.ts` 改成在表單加兩位帶參觀老師並用 API 核對「、」串接。整套第一次 75 過、1 敗：新斷言用 `fill()` 填標籤欄，`fill()` 不會打開選單、第一次 Enter 只打開選單；臨時 spec 在真瀏覽器確認聚焦後打字＋Enter、連加兩位、Esc 只關選單、點欄位再打都正常後，改成逐字輸入並等選項出現再按 Enter，`admissions-flow`／`admissions-follow-up`／`visit-family-page` 6 項全過（沒改程式，其餘 75 項沿用第一次的結果）。
  - 畫面：臨時 spec 在 1440／390 截新增與編輯表單改版前後（`output/playwright/record-dialog/before|after/`，臨時檔已刪）。
  - 未驗證：正式站實際操作。

## 2026-10-06 Google 登入改成在「我的帳號」綁定（`fix/google-self-link-20261006`，10-06 已部署 main `4437174d`）

使用者針對稽核修正「刻意沒改」的「Google 登入時用 Email 自動綁定既有帳號」說「幫我做這個」。規則見 DESIGN.md「Google 登入改成在『我的帳號』綁定」；設定見 `deploy/google-oauth.md`。正式站這時 Google 登入沒開（`/auth/providers` 回 `google:false`），沒有人受影響。

- **後端**：Google 登入只認已綁定的 `sub`，沒綁定一律拒絕（稽核原因 `not_linked`），不再用 Email 比對或自動綁定；授權範圍只剩 `openid`。新增 `POST /auth/google/link`（要登入、CSRF、重新驗證；已綁定 409、沒開 404），callback 依握手的 `mode` 分登入與綁定，綁定結果回 `/admin/account?google_link=…`；綁定要落在發起的同一位、仍啟用的 session 上，同一個 Google 帳號只能綁一個後台帳號。綁定失敗不寫登入失敗稽核。`contracts/` 重新產生（多 `GoogleLinkStart`）。沒有 migration。
- **後台**：「我的帳號」Google 卡片加「綁定 Google」（比照 LINE，含重新驗證與結果提示），解除綁定的說明改成要再綁定才能用；登入頁未綁定時說明到「我的帳號」綁定，入口旁提示改成 Google、LINE 都要先綁定；稽核原因 `not_linked` 改成 Google／LINE 共用說法，舊原因代碼保留標籤。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_googlelink1006_test`）：
  - 後端：`test_google_oauth.py` 改成先綁好再登入、拿掉 Email 相關案例，新增「同 Email 的 Gmail／Workspace 都不會自動綁定」、從「我的帳號」綁定後登入（後台 Email 與 Google 不同也能綁）、綁定要登入＋CSRF＋重新驗證、已綁定 409／沒開 404、綁定失敗回帳號頁（已被別人綁、取消、登出、換人、網路）、綁定握手不能重放，共 51 項（先紅後綠）。整套 pytest 1598 passed、1 skipped。`contract:check` 一致。
  - 後台：新增 `googleSelfLink.test.ts` 12 項（先紅後綠），更新 `googleLogin`、`permissionsUx` 的舊文案斷言；`vue-tsc -b` 通過。整套 vitest 第一次在負載 41（別的 session 在跑瀏覽器）時 76 項 5 秒逾時，單獨重跑那幾檔全過；改單一 fork、逾時 20 秒重跑整套 107 檔 1360 項全過。
  - 官網：829 項與 typecheck 通過。
  - stack e2e（`E2E_DB_NAME=ivy_website_e2e_googlelink1006_test`、埠 8726／3726，跑完已刪庫）：整套 76 項全過。另用臨時設定（假 Google client 打開 Google 登入）在 1440／390 截「我的帳號」的「綁定 Google」與登入頁未綁定提示，在 `output/playwright/google-self-link-20261006/`，臨時檔已刪。
  - 未驗證：真的 Google 往返（正式站 Google 登入沒開，也還沒有 Google Cloud 的正式 client）。

## 2026-10-06 標記已到場後接著填招生資料（`feature/arrival-admissions-form-20261006`，10-06 已部署 main `d4d8a08c`）

使用者：「家長已到場後會需要填招生資料，這邊的表單可以幫我跳出來嗎」。規則見 DESIGN.md「標記已到場後接著填招生資料」。

- **後台**：案件列表與總覽的「到了」、預約明細的「標記已到場」，確認後接著打開招生入學的訪視表單（`RecordDialog` 編輯模式，預約資料已帶入），上方寫「已標記 ○○ 已到場」，取消鈕叫「之後再填」。只在招生入學開著、帳號有 `admissions.write` 時跳；批次標記不跳。新增 `composables/useArrivalAdmissionsForm.ts`；`RecordDialog` 多 `lead`、`cancelText` 兩個選填 props，標題接上 `titleId`（對話框原本沒有無障礙名稱）。沒有後端、契約、migration 變動。
- **驗證**（Node 22.23.2）：
  - 後台：新增 `arrivalAdmissionsForm.test.ts` 8 項（先紅後綠：列表打開表單與帶入、存檔只送改過的欄位、之後再填、查不到訪視的警告、沒權限或招生沒開不跳、總覽、明細存檔更新家庭版面、明細沒權限不跳）；`admissionsVisitDetail.test.ts` 確認文字跟著改。vitest 107 檔全過、`vue-tsc -b` 通過。
  - stack e2e（`E2E_DB_NAME=ivy_website_arrivalform1006_e2e_test`、埠 8794／3794，跑完已刪庫）：`admissions-flow.spec.ts` 改成按到了之後在表單填帶參觀老師並存檔、再用 API 核對；它和 `admissions-follow-up`、`visit-family-page` 共 6 項全過，整套 stack 沒跑。另用臨時 spec 在 1440／390（櫃台帳號）與明細頁截圖目視確認，截圖在 `output/playwright/arrival-form/`，臨時 spec 已刪。
  - 未驗證：正式站實際點一次。

## 2026-10-06 預約方式拿掉 inquiry（`feature/no-inquiry-20261006`，10-06 已部署，隨 main `d4d8a08c` 上線）

接「拿掉舊狀態程式」：使用者問 inquiry 是什麼，聽完說明後裁定拿掉。規則見 DESIGN.md「拿掉舊狀態程式」。

- **後端**：刪 `BookingMode.INQUIRY`、`PATCH /admin/booking-config` 的 `BOOKING_MODE_RETIRED`（送 inquiry 改由 schema 回 422）、公開預約設定「inquiry 改顯示暫停」、readiness 的 inquiry 鍵；`contracts/` 重新產生（`BookingMode` 少一個值）。
- **migration `c4e8a2f61b97`**（down `a3c7e9d1f5b2`：同日另一個 session 的操作紀錄 IP 與裝置先進 main，改接在它後面）：殘留的 INQUIRY 列切成 PAUSED（沒有暫停說明時補「線上預約即將開放，歡迎來電洽詢。」、version 加一），再改名舊型別、建新 `booking_mode`、欄位轉過去、刪舊型別。downgrade 把 INQUIRY 加回原位置，切掉的列不還原。正式站五校 10-01 起都不是 inquiry。
- **後台**：「線上表單（已停用）」標籤保留給操作紀錄；測試改用其他預約方式。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1581 passed、1 skipped（9 分 20 秒，獨立測試庫 `ivy_website_test_noinquiry`，跑完已刪）；`test_inquiry_mode_no_longer_exists`（PATCH 422、資料庫型別只剩五個值）；本機測試庫 downgrade／upgrade 各一次，降級後塞一筆 INQUIRY 再升級會變成 PAUSED、補暫停說明、version 加一。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 105 檔 1327 項全過。
  - 官網：typecheck 通過；`test:website` 80 檔 829 項全過。
  - stack e2e（`E2E_DB_NAME=ivy_website_noinquiry1006_e2e_test`、埠 8794／3794，跑完已刪庫）：整套 75 項全過。

## 2026-10-06 操作紀錄多記 IP 與裝置（`feature/audit-ip-device-20261006`，10-06 已部署 main `bb10a5b4`）

使用者：「操作紀錄可以多更多資訊嗎，像是 IP、裝置」。裁定（見 DESIGN.md「操作紀錄記 IP 與裝置」）：裝置看得到操作紀錄的人都看得到，IP 只給總部；跟著紀錄永久保存。

- **後端**：新增 `app/common/client_info.py`（ASGI middleware＋contextvar，寫法同 request_id）：IP 只採信官網代理帶的 `x-website-client-ip`（沒有或不是 IP 記 NULL，不退回代理內網位址；IPv6 是代理聚合的 /64），User-Agent 去控制字元、截 512 字。`audit_service.log_action` 自動帶入，88 處呼叫都沒改；背景工作、CLI 兩欄 NULL。`GET /admin/audit-log` 多回 `ip_address`（非 `audit.read_all` 一律 null）、`user_agent`。`contracts/` 重新產生。
- **資料**：migration `a3c7e9d1f5b2`（接 `e870893fac95`；原本接 `d65fa082ff87`，第二版拿掉舊欄位先上 main 後改接）在 `audit_log_entries` 加 `ip_address` String(64)、`user_agent` String(512)，可為 NULL、不回填；只改目錄、不重寫資料表，部署前不用備份。
- **後台**：操作紀錄「操作者」下面多一行「iPhone・LINE・203.0.113.9」（手機版接在時間・操作者後面），完整 UA 放 title；搜尋也找得到 IP 與裝置。UA 解析在 `admin/src/utils/userAgent.ts`，不加套件；iPadOS Safari 會被認成 Mac。改版前的紀錄不多那一行。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_auditip_test`）：
  - 後端：新增 `test_audit_client_info.py` 11 項（代理 IP／IPv6／逗號／非 IP／沒帶 header、前一個請求不外漏、UA 截斷與控制字元、背景工作、只有總部看得到 IP）；`test_admissions_follow_up_schema.py` 的 head 改成 `a3c7e9d1f5b2`。整套 pytest 1554 passed、1 skipped，另有 1 failed（寫死舊 head，開跑後才改）與 4 個 setup error（同時有另外兩個 session 在跑整套 pytest）；這 5 項與相關 7 檔（75 項）重跑全過。alembic upgrade → downgrade → upgrade 通過。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 102 檔 1300 項全過（新增 `auditClientInfo.test.ts`）。
  - 官網：typecheck 通過；`test:website` 80 檔 829 項全過。
  - stack e2e（`E2E_DB_NAME=ivy_website_auditip_e2e_test`、埠 8793／3793，跑完已刪庫）：新增 `audit-client-info.spec.ts`（iPhone LINE UA＋`X-Forwarded-For` 經官網代理登入，桌機與手機版都顯示「iPhone・LINE・203.0.113.50」）與 `roles.spec.ts` 全過；整套 stack 沒跑。桌機 1440、手機 390 截圖目視確認。
  - 未驗證：正式站 Railway edge 實際帶進來的 IP（要部署後登入看一筆）。

## 2026-10-06 後台 bug 稽核修正（`fix/admin-bug-audit-20261006`，10-06 已部署 main `1c9d3e19`）

使用者要求「看看後台有沒有 bugs」，對 origin/main `d70bce03` 的 `admin/`、`backend/` 分六塊審查、逐條讀碼或用測試確認，裁定全部修正。沒有高嚴重度（名額超賣、重複建案、越權讀他校、登入繞過都沒找到）。規則見 DESIGN.md「後台 bug 稽核修正」。舊預約流程（new／contacting／pending_confirmation）的問題不在內，同日另一個 session 在刪那些程式。

- **中嚴重度（8 條）**：被退回的內容版本能靠排程上線（上線後還標著已退回）；內容頁發布或還原中切校區，舊校回應蓋掉新校（最壞把義華內容存成明華草稿）；案件頁背景重讀不同步「下次聯絡」，送聯絡紀錄會蓋回同事的設定；「加開一場」連點建出重複場次；接待能先取消退出再刪曾註冊的訪視、能直接改已註冊訪視的入學學期；別的分頁重新登入後舊分頁登出永遠 403；衝突後重讀失敗修改無聲遺失；家長改資料與園方承辦人／下次聯絡共用版本互相誤報 409。
- **低嚴重度**：發布與審核的鎖順序（同時發布可能死結）、同時核准／退回互相覆蓋、直接發布待審版不通知送審人、第一次發布兩個請求撞主鍵；家長改期每日上限同時送出可繞過、重送原始送單請求拿到重新產生後的新連結、休假日鎖場次沒排序、不存在的校區與控制字元回 500；本人解除 LINE／Google 不登出其他裝置、帳號管理寫入不用重新驗證、登入途中被重設密碼 session 仍存活、校區代號打錯回 500、`WEBSITE_ADMIN_ORIGIN` 帶結尾斜線全部寫入 403；LINE 推播家長稱呼可夾網址、補寄已過場次的預約成功信；失敗影片不計配額、上傳出錯留孤兒檔；後台月曆休假日、補登場次、「用在哪裡」、LINE 群組、待追蹤 409、歷程抽屜換筆等舊回應覆蓋，非 JSON 錯誤原文外露，案件「下一筆」漏未結案條件，退回版仍可按發布、已上線仍可送審，校園探索場景索引、存檔錯誤跳錯欄、隱私權政策初稿、素材庫預選無權校區與按鈕連按，發布衝突後還原不清衝突狀態。
- **API 契約**：帳號管理六個請求多選填 `current_password`（`contracts/` 重新產生）；新錯誤代碼 `CONTENT_REVISION_REJECTED`（排程）、`RECRUITMENT_ENROLLED_TERM_LOCKED`、`RECRUITMENT_SEAT_TERM_LOCKED`、`SLOT_DUPLICATE`。家長管理頁 `version` 改成家長資料自己的版本，形狀不變、官網不用改。沒有 migration。
- **刻意沒改（待業主）**：Google 用 Email 自動綁定、內容編輯可直接改線上素材說明與焦點、匿名化保留來源備註。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_audit1006_test`）：
  - 後端：新增 `tests/test_admin_bug_audit_20261006.py` 35 項（先紅後綠；競態用延遲或第二條連線重現，LINE 登入鎖與提交失敗清檔是拿掉修正確認會紅）。整套 pytest 第一次 1509 passed、1 skipped、1 error（`too many clients`，同時有別的 session 在跑 pytest），中斷後剩下的 5 檔補跑 70 項全過。
  - 後台：新增四個測試檔 48 項（先紅後綠）；`ux20260928D` 的編輯器替身補 `saving`／`publishing`；vitest 105 檔 1330 項全過，`vue-tsc -b` 通過。
  - 官網：typecheck 通過；`test:website` 80 檔 829 項全過。`contract:check` 一致。
  - stack e2e（`E2E_DB_NAME=ivy_website_e2e_audit1006_test`、埠 8716／3716，跑完已刪庫）：既有 75 項全過。另用臨時 spec 在 1440／390 走過登入超過 10 分鐘建帳號要輸入密碼（打錯留在對話框、打對建立成功）、已註冊訪視編輯表單鎖住學年學期、被退回的內容停用發布與排程，截圖在 `output/playwright/admin-bug-audit-20261006/`，臨時 spec 已刪。
  - 合併 main（舊狀態程式第一、二版，migration 到 `e870893fac95`）後重跑：pytest 1582 passed、1 skipped；後台 vitest 105 檔 1327 項、`vue-tsc -b`；官網 829 項與 typecheck；`contract:check` 一致；stack 74 過、`media.spec` 失敗——單獨跑也失敗，查出是 spec 時序：「發布到官網」在儲存處理中就停用，斷言提早通過、API 讀到舊版（輪詢 18 ms 後就有照片）。改成輪詢 API 直到新版寫入，單獨重跑通過；這也是 09-27 起「media 整套間歇失敗」的原因。
  - 未驗證：正式站實際點一次、Safari／iOS 實機；兩個人真的同時操作的競態只在測試裡用延遲重現。

## 2026-10-06 拿掉舊狀態程式，第二版（`feature/visit-legacy-drop-20261006`，10-06 已部署 main `5fb9edbb`）

第一版已上線（`0c534043`）後才推。規則見 DESIGN.md「拿掉舊狀態程式」。

- **migration `e870893fac95`**（down `d65fa082ff87`）：drop `visit_requests.hold_expires_at`（含索引）、`booking_configs.slots_auto_confirm`；加 CHECK `ck_visit_requests_status`、`ck_visit_requests_confirmed_slot`。downgrade 加回欄位（空值／false）、拿掉約束，資料不還原。本機測試庫降級再升級各跑一次通過。
- **成效統計**：拿掉 `unscheduled`（已確認、沒有場次），API 與後台一起，`contracts/` 重新產生。
- **測試**：新增 `test_visit_status_constraints.py`（舊狀態、已確認無場次被擋；已取消可以沒場次；兩個欄位不在了）；刪兩支要寫入舊狀態的歷史 migration 測試與 `c7d2e9f4a1b8` 切換預約方式的兩條；`analytics_fixtures.add_case` 的已確認案件自動帶場次。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1544 passed、1 skipped，另有 1 failed、2 errors（`test_media_jobs` 租約、`test_session_schedule` 補場次、`test_security_hardening` 素材鍵；當時另一個 session 的 vitest 把負載拉到 31），這三檔負載降下後重跑 63 項全過；成效統計與招生追蹤 63 項全過。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；`analyticsOutcomes.test.ts` 12 項通過（全套沒重跑：另一個 session 正在跑 vitest，這次後台只拿掉一行統計）。
  - stack e2e（`E2E_DB_NAME=ivy_website_legacydrop1006_e2e_test`、埠 8793／3793，從零跑到 `e870893fac95`，跑完已刪庫）：整套 75 項全過。
  - 未驗證：正式庫上 CHECK 建立（第一版已清過資料，理應沒有違反的列）。

## 2026-10-06 拿掉舊狀態程式，第一版（`feature/visit-legacy-cleanup-20261006`，10-06 已部署 main `0c534043`）

使用者：「把剩下的舊狀態程式也一起清掉」。規則見 DESIGN.md「拿掉舊狀態程式」；依 CICD.md 先停用、再移除，欄位與狀態約束在第二版。

- **後端**：`VisitRequestStatus` 只剩 confirmed／completed／no_show／cancelled；補登先 `slot_service.lock_for_staff_booking` 再直接建 confirmed（歷程只有一筆 created 帶場次）；刪 `confirm_with_slot`、`expire_holds`、`/confirm` 與 `/contacting` 端點、占位名額規則、定期工作的釋放占位、「新需求未處理」「占位快到期」提醒；`OPEN_STATUSES` 只剩 confirmed（列表、停用分校、保存政策共用）；`BookingImpactOut`、明細與家長端拿掉舊欄位；ORM 不再對應 `hold_expires_at`、`slots_auto_confirm`。`contracts/` 重新產生。
- **後台**：明細拿掉排入場次、確認占位與確認期限；「下一筆」只剩待標記到場與到期追蹤；取消一律「取消預約」；停用分校、切換預約方式不再列舊狀態件數；通知種類拿掉「待園方確認」。歷程、操作紀錄、舊通知需要的舊標籤保留。
- **官網**：家長管理頁只剩四種狀態文案。
- **資料**：migration `d65fa082ff87` 再刪一次舊狀態與「已確認卻沒有場次」的案件、舊流程通知未寄或失敗的標 skipped；downgrade 不還原。
- **沒做**：`inquiry` 預約方式（改公開預約設定端點被 auto 模式擋下，待使用者決定）；欄位 drop 與 CHECK 在第二版。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1549 passed、1 skipped（8 分 39 秒，獨立測試庫 `ivy_website_test_legacy`）；新增 `test_retire_legacy_visit_flow_migration.py`、補登直接成立與 409 不建案；被拿掉的流程（`/confirm`、`/contacting`、`expire_holds`、逾期提醒、impact 舊欄位）改成斷言已不存在；`legacy_request` 不再預設 new，confirmed 自動帶固定時段的場次（改固定後用到它的 17 檔 206 項重跑全過）。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 101 檔 1279 項全過。
  - 官網：typecheck 通過；`test:website` 80 檔 829 項全過。
  - stack e2e（`E2E_DB_NAME=ivy_website_legacy1006_e2e_test`、埠 8792／3792，跑完已刪庫）：整套 75 項全過。
  - 未驗證：正式庫 migration 實際刪除與標 skipped 的筆數、登入正式後台實際點一次。

## 2026-10-05 預約明細當家庭頁（`feature/visit-family-page-20261005`，10-06 已部署 main `9299bd7f`）

- 已到場、有招生訪視的預約明細改成家庭版面：招生資料、參觀前後合併的聯絡紀錄與歷程、記錄聯絡／排下次聯絡／移到…／招生負責人都在同一頁。
- 招生入學的看板、訪視明細、待追蹤點有預約的家庭會開預約明細；手動新增的仍開歷程抽屜。
- 後端看板卡片與待追蹤列多回 `visit_request_id`；沒有 migration。規格 `docs/specs/2026-10-05-visit-family-page-design.md`。

## 2026-10-05 招生訪視照園方紙本補欄位、官網得知管道加兩項（`feature/admissions-paper-fields-20261005`，10-05 已部署 main `9ab739ae`）

使用者拿帶參觀老師填的紙本「幼兒基本資料＋參觀紀錄」逐欄對照，裁定補三類。規則見 DESIGN.md「招生訪視照紙本補欄位」。

- **後台招生表單**：放回來源分類（園務九類）、帶參觀老師（只打名字，建議清單是本校填過的名字）、搭娃娃車；新增英文名字、父親職業、母親職業。「幼生來源」改叫「來源備註」。基本資料改成兩兩一列。明細表格不加欄，新欄位放進展開列（手機「其他資料」），關鍵字搜得到英文名。
- **記錄聯絡**：方式加「再參觀」。
- **官網預約**：「如何知道常春藤」加「哥哥姊姊讀過或正在讀」（`sibling`）、「傳單／DM」（`flyer`）；後端匯出、預約轉招生的來源文字、後台、成效統計排序一起改。
- **後端**：migration `3fe1cfb2dbf7`（接 `1e5612e187ff`，合併 main 時從 `4373bcc82d9d` 改接）在 `recruitment_visits` 加 `english_name`、`father_occupation`、`mother_occupation`（可空、50 字），重建 `ck_recruitment_contact_logs_channel` 放行 `revisit`；只加欄位、放寬約束，不改既有資料，部署前不用備份。`GET /options` 多 `tour_guides`。匿名化清三個新欄位；轉移契約放 `extensions`（`contracts/ivy-recruitment/README.md`）。`contracts/` 重新產生。
- **不收**：公司（紙本其實是公司電話，使用者裁定先不用）、父母姓名與各自電話、性別、預繳金額、接送雙程單程、健康與家庭狀況。
- **驗證**（Node 22.23.2，獨立測試庫 `ivy_website_paperfields1005_test`）：
  - 後端：整套 pytest 1534 passed、1 skipped、2 failed——兩項都在 `test_media_jobs.py`（比對 `/tmp/ivy-website-test-media` 的檔案數，同時有別的 session 在跑 pytest、共用該資料夾），等它跑完單獨重跑整檔 38 項全過。新增：紙本欄位新增／清空／長度、英文名搜尋、`tour_guides` 建議、再參觀（含資料庫 CHECK）、匿名化清三欄、契約延伸欄位、migration 接點與升級不改資料；`alembic downgrade -1` 再 `upgrade head` 通過。
  - 後台：`vue-tsc -b` 通過；vitest 94 檔全過（新增新增／編輯只送改過的欄位、帶參觀老師建議、展開列六欄）。`labelCoverage` 的 `ReferralSource` 解析改成可跨行。
  - 官網：typecheck 通過；`test:website` 80 檔 829 項全過。`contract:check` 一致。
  - stack e2e（`E2E_DB_NAME=ivy_website_paperfields1005_e2e_test`、埠 8793／3793，跑完已刪庫）：整套 74 項全過。另用臨時 spec 走過新增訪視填全部新欄位 → API 核對 → 記錄聯絡選再參觀 → 展開列 → 再開編輯帶回原值；官網六個選項順序、勾兄姊＋傳單送出後 `referral_sources == ["sibling", "flyer"]`；1440／390 截圖不橫向溢出（`output/playwright/paper-fields/`，臨時 spec 已刪）。
  - 未驗證：登入正式後台實際點一次、Safari／iOS 實機。

## 2026-10-05 校園探索改由總部帳號直接控制（`feature/admin-no-campus-tour-20261005`，10-05 已部署 main `4f9de0b6`）

使用者先說正式站 `/admin/content/campus-tour?campus=yihua`「可以先拿掉了」，接著改口：常春藤環境頁「五所校園」的照片「由總部帳號直接控制」，「總部帳號」裁定為總管理者＋有「全站共用內容」授權的人。規則見 DESIGN.md「校園探索改由總部管理」。

- **後端**：`ContentKindConfig.hq_managed`（`campus_tour`）＋`managed_as_shared()`；編輯／發布／核准／送審通知、讀取、發布紀錄、素材「用在哪裡」、總覽的待發布・缺素材・排程失敗・待審核都比照共用內容。沒有 migration，API 形狀不變。
- **後台**：側欄「校園探索」從「各校」移到「全站與素材」並限總部（路由守衛跟著擋）；編輯頁五校都能切換，別校素材只挑跨校共用；素材用途對沒權限的人寫「由總部管理」；發布後「查看官網」改開 `/environment#campuses`、預覽改開 `/preview?page=environment`。
- **官網**：環境頁第四章不變；草稿預覽新增 `?page=environment`。
- **驗證**（Node 22.23.2）：
  - 後端：rebase 到 main `8b0efde2` 後整套 pytest 1538 passed、1 skipped（9 分 46 秒，獨立測試庫 `ivy_website_hqtour_test`，跑完已刪庫）。新增 `test_campus_tour_hq.py` 6 項（分校帳號連本校都不能改但讀得到、總管理者五校都能發布、有授權的分校管理者能改別校並在發布紀錄看到、授權的內容編輯送審後只有共用發布者能審、總覽提醒、素材用途標題與 can_edit），把 `hq_managed` 關掉時 5 項全紅；`test_media_library.py` 兩項原本拿校園探索當分校內容的例子，改用各校消息。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 95 檔 1209 項全過（新增 `campusTourHq.test.ts`；側欄限總部、總覽與素材用途的連結跟著改）。
  - 官網：`nuxt typecheck` 通過、web 單元測試 80 檔 829 項全過（預覽頁接受 `page=environment`）。
  - stack e2e（`E2E_DB_NAME=ivy_website_hqtour_e2e_test`、埠 8796／3796，跑完已刪庫）：rebase 前後各跑一次整套，都是 74 項全過。另用臨時 spec 在真後端點過：總管理者側欄「全站與素材」有校園探索、切到明華可編輯、桌機 1440 與手機 390 不橫向溢出；義華分校管理者側欄沒有、直接開網址回總覽；`/preview?page=environment` 五校分頁、場景照片載入（截圖在 `output/playwright/hq-tour/`，臨時 spec 已刪）。
  - 未驗證：登入正式後台實際點一次、有授權但非總管理者的真帳號。

## 2026-10-05 參觀案件拿掉「待處理」，舊案刪除（`feature/visit-no-pending-20261005`，10-05 已部署 main `8b0efde2`）

使用者指著正式站 `/admin/visit-requests?group=pending` 說「把這個狀態拿掉，現在都是有預約時間的參觀」，舊案裁定直接刪除。規則見 DESIGN.md「拿掉「待處理」」。

- **後台**：案件列表分組剩預約正常／時間已過／已取消（`?group=pending` 與舊 `?status=new|contacting|pending_confirmation` 落到全部），列表不再顯示確認期限；側欄「參觀案件」不再掛數字（`NavItem.badge` 拿掉）；總覽摘要固定兩格、拿掉「場次預約等園方確認」「新的參觀需求還沒聯絡」兩個待辦；成效統計拿掉「舊資料的待處理」。
- **後端**：`status_groups` 拿掉 `pending`，還沒結案的依場次分組、沒有場次算預約正常（每筆剛好一組）；`group` 參數不收 `pending`；`pending_kinds` 剩兩種；成效統計拿掉 `pending`／`legacy_pending`；`/admin/dashboard` 拿掉 `new_requests`、`awaiting_confirmation`、`next_hold_expires_at`；`contracts/` 重新產生。
- **資料**：migration `1e5612e187ff` 刪掉 new／contacting／pending_confirmation 的案件（連帶 CASCADE 的聯絡紀錄、歷程、outbox、家長連結、改期申請）與指向它們的站內通知；downgrade 不還原。正式站義華只有 1 筆（09-24 測試案），其他四校以 migration 實際刪除數為準；使用者確認正式庫的預約資料都是測試資料、可以刪，這次部署不另外備份。
- **沒動**：資料庫七種狀態、後端舊狀態流程與提醒、案件明細的舊狀態分支、各校預約方式的影響數字、官網家長管理頁文案。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1532 passed、1 skipped（8 分 57 秒，獨立測試庫 `ivy_website_test_nopending`）；新增 `test_delete_legacy_pending_migration.py`（只刪三種舊狀態、CASCADE、related_request_id 變 NULL、只刪指到舊案的站內通知）、`group=pending` 回 422；拿掉總覽舊計數的測試。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 94 檔 1203 項全過（另一次整套有 2 項 `admissionsRecords` 逾時，當時負載 91，單獨重跑 33 項全過）。15 個測試檔改成驗證「已經沒有了」：頁籤只有四個、舊網址落到全部、側欄沒有數字、總覽固定兩格、成效統計沒有舊資料。
  - 官網：typecheck 通過；`test:website` 80 檔 829 項全過。
  - stack e2e（`E2E_DB_NAME=ivy_website_nopending1005_e2e_test`、埠 8791／3791，跑完已刪庫）：整套 74 項＋臨時截圖 spec 2 項全過；`visual.spec` 拿掉已不存在的 `.sidebar__badge` 遮罩。臨時 spec 拍 1440／390：`?group=pending` 落到全部、四個頁籤、側欄無數字、總覽兩格、手機不橫向溢出（截圖在 `output/playwright/no-pending/`，spec 已刪）。
  - 未驗證：正式庫 migration 實際刪除筆數（其他四校）、登入正式後台實際點一次。

## 2026-10-05 後台招生入學拿掉「官網預約」分頁，批次標記到場搬到案件列表（`feature/admissions-no-arrivals-20261005`，10-05 已部署 main `51332515`）

使用者指著正式站 `/admin/admissions?campus=yihua&tab=arrivals` 問用途，評估後覺得和案件列表重複，裁定「拿掉分頁，批次標記搬到案件列表」「後端 API 一起刪」。規則見 DESIGN.md「拿掉官網預約分頁」。

- **後台**：招生入學拿掉「官網預約」分頁與 `ArrivalsTab.vue`、`getArrivals`；舊連結 `tab=arrivals` 退回漏斗看板。案件列表勾「只看尚未確認到場」時（要 `booking.handle`）多出勾選欄（桌機表格、手機卡片）與「N 位標記已到場」，逐筆呼叫 `/complete`、失敗逐筆列原因；邏輯放在 `composables/visitAttendance.ts`。漏斗看板全空時，查案件列表有沒有尚未確認到場的，有才提示，「去標記到場」連到這個篩選（不寫人數）。訪視明細、統計的空狀態文案改指向參觀案件。
- **後端**：刪 `GET /admin/admissions/arrivals`、`booking_link.arrivals()`、`ArrivalsOut`／`ArrivalRowOut`，`contracts/` 重新產生；補建端點 `POST /admin/admissions/from-visit-request/{id}`（預約明細的「建立招生訪視」）保留。沒有 migration，部署前不用備份。
- **部署前**：「已到場但沒有招生訪視」的清單跟著分頁一起沒了。正式站這個分頁如果還有下半部，先補建完再部署；之後漏掉的從預約明細單筆補。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1531 passed、1 skipped（8 分 43 秒，獨立測試庫 `ivy_website_noarrivals1005_test`）；arrivals 的兩項測試刪除，權限測試改為只測補建，開關關閉測試改為開啟後從補建端點補。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 94 檔 1203 項全過。新增 `visitRequestsBatch.test.ts` 6 項（只有篩選時才有勾選、批次確認與部分失敗、招生關閉不提訪視、手機卡片勾選、點勾選格不開案件、唯讀帳號沒有）；看板提示改測連結與查詢條件、沒有 `booking.read` 不查。
  - stack e2e（`E2E_DB_NAME=ivy_website_noarrivals1005_e2e_test`、埠 8783／3783）：整套 74 項全過。`admissions-flow` 改為看板提示「去標記到場」→ 案件列表按「到了」；`admissions-follow-up` 的批次標記改在案件列表；a11y 改掃案件列表的 `group=past&status=confirmed`；截圖改漏斗看板、待追蹤、訪視明細、統計分析四頁加五校比較。
  - 另用臨時 spec 拍 1440／390：案件列表勾兩筆後批次鈕、勾選欄、手機卡片勾選框不橫向溢出；看板提示與連結（截圖在 `output/playwright/no-arrivals/`，臨時 spec 已刪）。
  - 未驗證：登入正式後台實際點一次、Safari／iOS 實機。

## 2026-10-05 後台招生入學拿掉「名額規劃」（`feature/admissions-no-intake-20261005`，10-05 隨 main `51332515` 部署）

使用者指著正式站 `/admin/admissions?campus=yihua&tab=intake` 說「這個功能幫我拿掉」，範圍裁定為「分頁＋相關畫面，後端不動」。規則見 DESIGN.md「拿掉名額規劃」。

- **後台**：拿掉「名額規劃」分頁與 `IntakePlanTab.vue`、`getIntakePlan`／`saveIntakeTargets`；舊連結 `tab=intake` 退回漏斗看板。五校比較不列計畫名額、名額剩餘；保留座位不再跳「超過計畫名額」、對話框與標記註冊、刪除確認不再提名額規劃。
- **不動**：後端名額 API、`grade_intake_targets` 表、`/compare` 回應欄位、轉移契約；沒有 migration，部署前不用備份。和園務分歧（園務有名額規劃），併入時再決定。
- **驗證**（Node 22.23.2）：
  - 後台：`vue-tsc -b` 通過；vitest 94 檔 1217 項全過（`admissionsIntake.test.ts` 改名 `admissionsSeat.test.ts`，只留保留座位；新增舊連結 `tab=intake` 退回看板、`capacity_warning` 不再提示兩項）。
  - `contract:check` 一致（API 沒動）。
  - stack e2e（`E2E_DB_NAME=ivy_website_nointake1005_e2e_test`、埠 8761／3761，跑完已刪庫）：碰到招生頁的四支 `admissions-flow`、`a11y`、`keyboard`、`admissions-follow-up` 共 41 項全過；招生流程拿掉「名額規劃已註冊」那一步，截圖改四個分頁加五校比較。看過 1440 截圖：分頁列沒有名額規劃，五校比較沒有名額兩欄。
  - 未驗證：整套 stack（沒碰招生以外的畫面）、登入正式後台實際點一次。

## 2026-10-05 通知顯示家長稱呼、點開就算已讀（`feature/admin-notify-names-20261005`，10-05 已部署 main `982af30d`）

站內通知頁上線後，使用者對兩個待裁定項目回覆：「點進案件時要不要自動標記已讀：要」「通知要不要顯示家長姓名：要，LINE 的通知也要出現」。規則見 DESIGN.md「通知顯示家長稱呼、點開就算已讀」。

- **後端**：`GET /admin/notifications` 與 `GET /admin/notification-outbox` 多回 `parent_name`（讀取時 join 案件，匿名化後為 null，不寫進 payload）；LINE 推播文字在校區後面加「家長：○○」（推播當下讀案件）。寄給園方的 Email 不變（照舊姓氏＋稱謂）。`contracts/` 重新產生。
- **後台**：通知標題後面接家長稱呼，寄送失敗清單也列出家長；點通知列打開案件時在背景標成已讀（權限照舊 booking.manage，櫃台點開不改），送不成功變回未讀。
- **待園方**：隱私權政策第 6 段要補 LINE（家長稱呼會推到 LINE 群組）。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1533 passed、1 skipped（9 分 40 秒，獨立測試庫）；通知相關新增／改寫 5 項（站內通知與寄送失敗清單回 `parent_name`、匿名化後為 null 且不在 payload；LINE 推播有「家長：陳媽媽」不帶電話；案件匿名化後推播不帶家長；`line_text` 空白稱呼不出那一行）。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 93 檔 1168 項全過。新增 3 項（家長稱呼、點開標記已讀與失敗復原、櫃台點開不標記），換回 main 版通知頁時前兩項會失敗。
  - 拋棄式測試庫 Playwright：校區管理者點開一則未讀，回到清單重新讀取後未讀 3→2；櫃台點開沒有送出標記、未讀不變；桌機與手機家長稱呼接在標題同一行。
  - stack e2e：75 項 74 過，失敗的是已知間歇的 `media.spec`（`home_about` 的 `payload.photo` 讀回 undefined），單獨重跑 3 項全過。API 準備階段同樣用暫時本機設定把等待放寬到 10 分鐘（沒有進版控）。
  - 合併 main（招生入學、側欄，沒動後端與契約）後：`vue-tsc -b`、`contract:check` 通過；vitest 94 檔 1228 項，8 項在 load 90 時 5 秒逾時（招生入學、內容編輯），負載降下來後單獨重跑 103 項全過；stack e2e 75 項全過。
  - 未驗證：真的 LINE 群組推播（測試用假 LINE 伺服器）、Safari／iOS 實機。

## 2026-10-05 招生入學 UI/UX：轉預繳不用回看板、手機可現場確認到場、數字口徑寫清楚（`feature/admissions-ux-20261005`，10-05 已部署 main `6e0fdf8`）

使用者要「看看招生入學這整個區塊怎麼優化 UI/UX」：對 origin/main 用拋棄式測試庫灌擬真資料（義華 25 筆、追蹤到期、名額超額、待確認到場），桌機 1440／手機 390 拍 56 張，評 25/40（第九輪全後台是 28）。使用者四個方向都選、裁定只做不和園務分歧的改法、手機做待追蹤／官網預約／明細三頁。規則見 DESIGN.md「招生入學 UI/UX」。

- **換階段的入口**：訪視明細每列「標記預繳」／「標記註冊」、歷程抽屜「移到…」，和看板共用確認框；確認鍵寫動作、退出標題寫來源、開啟後焦點進第一個欄位。看板加姓名搜尋。
- **打電話**：記錄聯絡抬頭帶家長、撥號、上次聯絡內容，停用時寫缺什麼；歷程抽屜摘要加聯絡人與電話。
- **手機**：頁首三個篩選收成一顆摘要鈕；官網預約、訪視明細改卡片（到了／沒來各半寬 44px）；明細卡片從約 1284px 提到約 397px。
- **官網預約跟上第九輪**：plain「到了／沒來」與案件列表同一個確認框（寫家長與場次）、參觀人數欄只在舊資料出現、日期今年省略年份；`formatSlotWhen` 的結束時間改選填。
- **減噪**：明細預設 9 欄（加階段、下次聯絡、負責人），其他收進展開列，篩選收進「更多篩選」＋標籤，1280／1440 都不橫捲；待追蹤 1280 不橫捲、「記錄聯絡」改 plain；待追蹤與官網預約停用學年學期並寫明；卡片學期 tag 改中性、hover 有回饋、「移到…」滑鼠裝置 hover 才出現。
- **數字口徑**：看板比率附分子分母與口徑說明（名稱與公式照園務）；統計參考月份移進總覽、四張卡下寫口徑、當月掛「進行中」、月比寫「個百分點」；名額在面板內切學期、合計補超額說明；未預繳明細的開關改成有字的勾選。
- **全站**：列表淺色主色鈕字色加深（約 4.45→5.4:1）；招生入學檔案的錯誤提示全改走 `notify.ts`，守門測試拿掉招生例外。
- **刻意沒改（會和園務分歧）**：比率改名或拿掉、「退費率」、預設分頁改待追蹤、退出欄改色、統計總覽合併重複區塊、月初不上紅。
- **驗證**（Node 22.23.2）：
  - admin：vitest 93 檔 1211 項通過、`vue-tsc -b` 通過、`vite build` 通過（e2e build）；合併 main（站內通知頁、側欄）後重跑 vitest、typecheck、stack 全套。
  - stack e2e（`E2E_DB_NAME=ivy_website_admux1005_e2e_test`、埠 8797／3797）：整套 75 項全過，含招生六個分頁的 axe、鍵盤、招生流程、參觀後追蹤、視覺基準。
  - 拋棄式測試庫畫面（Playwright，寫入請求全攔截）：明細與待追蹤表格 1280 寬 962/962、1440 寬 1122/1122 不橫捲；手機觸控裝置「移到…」顯示；記錄聯絡抬頭與上次內容、抽屜移到…、名額學期切換、統計參考月份位置逐張看過。
  - 沒動後端與 API 型別，沒跑 pytest、`contract:check`、`test:website`；未驗證 Safari／iOS 實機、正式站。

## 2026-10-05 官網後台側欄：標題分兩層、列高收緊、捲動提示、⌘K 搜尋（`feature/admin-sidebar-20261005`，10-05 已部署 main `0f68dd1`）

使用者附正式站側欄截圖要「優化側欄的 UI/UX」。從 origin/main `23c6aa2` 開 worktree，拋棄式測試庫（`ivy_website_sidebar1005_test`，API 8761、admin 5311）拍桌機 1440／1280、手機 390 前後對照。規則見 DESIGN.md「官網後台側欄：層級、尺寸與鍵盤」。

- **層級**：第一層（參觀預約／官網內容／系統）統一成小字灰色標題、只用間距分開；第二層子組（首頁／各校／全站與素材）改成像一列選單，箭頭占圖示欄、子項目縮排並有一條細線，三種標題不再長得一樣，左緣對齊。
- **尺寸與捲動**：桌機列高 40→36px（手機維持 44），總管理者全展開 1482→1311px；選單上下緣加捲動陰影（純 CSS），看得出上面／下面還有項目。
- **圖示**：實心的 HomeFilled／Grid／TrendCharts／List 換成線條的 House／Film／PieChart／Memo；更改密碼鑰匙改鎖頭。
- **搜尋與鍵盤**：⌘K／Ctrl+K 跳到搜尋框（框內有提示）；搜尋時先標出 Enter 會開的那一筆；Esc 清除搜尋字；↓↑ 在搜尋框與選單間移動。收起但目前頁面在裡面的分組，標題用選取色。焦點框改往內縮，不再被捲動區裁掉。
- **驗證**（Node 22.23.2）：
  - admin：`vue-tsc -b` 與 `vite build` 通過；vitest 全套 93 檔 1158 過、4 項逾時（招生紀錄、案件列表，load average 33 時 5 秒逾時，單獨重跑兩檔 42 項全過，與側欄無關）；新增 `sidebarNav20261005.test.ts` 9 項（換回 main 的元件跑是 7 紅 2 綠，綠的兩項是「對話框開著／手機抽屜不搶 ⌘K」的反向檢查）；改完後掛到側欄或 nav.ts 的 22 檔 305 項再跑全過。`npx impeccable detect` 側欄 0 筆。
  - stack e2e（`E2E_DB_NAME=ivy_website_sidebar_e2e_test`、埠 8763／3763）：visual、keyboard、roles、a11y 共 46 項全過。視覺基準重拍 4 張後台頁（`--update-snapshots=all`；預設模式只會重寫超過 1% 的五校介紹，其他三張差異在門檻內但圖上仍是舊側欄），登入頁沒變；重拍後再跑 visual 6/6 過。
  - 拋棄式測試庫 Playwright 實按（桌機 1440）：⌘K 聚焦搜尋框、↓ 到營運總覽、再 ↓ 到參觀預約、↑↑ 回搜尋框；搜「素材」標出素材庫、Esc 清空、Enter 到 /media 且搜尋字清掉；更改密碼對話框開著時 ⌘K 焦點不動；收起目前所在的「全站與素材」後標題變選取色。console 無錯誤。
  - 沒動後端與 API 型別，沒跑 pytest 與 `contract:check`；未驗證 Safari／iOS 實機、Windows 的 Ctrl+K、正式站。

## 2026-10-05 官網後台站內通知頁 UI/UX（`feature/admin-notifications-20261005`，10-05 已部署 main `75caffa`）

使用者要「優化 /admin/notifications 的 UI/UX」。用拋棄式測試庫灌三校的預約、改期、取消、提醒、寄送失敗與一筆舊的改期申請，桌機 1440／1280、手機 390 各以總管理者、單校管理者、櫃台三種帳號看過。規則見 DESIGN.md「官網後台站內通知頁」。

- **版面順序**：待核准的改期申請 → 寄送失敗 → 通知清單。原本校區選單與「只看未讀」放在整頁最上面，看起來管整頁，實際只管最下面的清單；現在校區、「全部／未讀」頁籤（同案件列表的樣式）、全部標記已讀、重新整理都在清單自己的頂列。頁首不再有整排篩選卡與摘要列。
- **通知清單**：表格改成一則一列，依「今天／昨天／10/03（週五）」分組、列上只寫時間；種類有圖示色調（新預約綠、改期藍、即將參觀暖黃、逾期紅、取消灰）；整列點了就開案件，拿掉每列重複的「查看案件」。日期一律省略今年的年份。手機每則從約 215px 降到約 90px（灌的 16 則＋3 則失敗＋1 則改期，整頁 10580→6516px），標記已讀在手機只留 44px 打勾圖示。
- **單校帳號**：不出現校區選單（原本是一整張只有「校區 義華」的卡），寄送失敗與改期申請不列校區欄，通知副行不寫校名。
- **頁籤與校區寫進網址**（`?unread=1&campus=`）：點進案件再返回會回到剛才的未讀清單。
- **切回分頁超過 60 秒在背景更新**（同案件列表），不閃骨架；讀取中改骨架，讀取失敗在清單裡給重新載入。
- **全後台**：淺色主色鈕（「到了」「核准」「全部重新寄送」「複製密碼」等）的字改深一階，原本 4.4:1 被 axe 判對比不足；頁籤樣式從案件列表搬到 `style.css` 共用。
- **刻意沒改**：點進案件自動標記已讀（已讀是同校共用狀態，要業主決定）、通知顯示家長姓名（第七輪待裁定）、通知種類篩選。
- **驗證**（Node 22.23.2）：
  - admin：`vue-tsc -b`、`vite build` 通過；vitest 93 檔 1165 項，整套跑兩次各有 1–2 項是機器高負載（load 20–48）時的 5 秒逾時（招生紀錄 2 項、案件列表電話搜尋 1 項），單獨重跑都過；其餘全過。`notificationsUx.test.ts` 新增／改寫 8 項（日期分組、種類色調、網址保留頁籤與校區、單校不列校區、背景重讀、整列連結），換回舊版通知頁時這 8 項都會失敗；`permissionsUx`、`ux20261005` 各 1 項照新結構改寫。
  - 拋棄式測試庫（`ivy_website_notif1005_test`、API 8763、admin vite 5323）Playwright 實際操作 12 項：未讀頁籤 16→8、點通知進案件、返回仍在未讀（`?unread=1`）、單則標記已讀 8→7、全部校區「全部標記已讀」先確認、切義華只剩義華、鍵盤焦點框、讀取中骨架、讀取失敗、單校帳號無校區選單與校區欄、櫃台無標記鈕、手機標記鈕 44×44。
  - axe（WCAG 2.1 A／AA）：總管理者桌機、手機與櫃台手機都是 0 個違規（改之前「核准」「全部重新寄送」淺色鈕對比不足）。案件列表頁籤搬 CSS 後計算樣式不變（桌機 34px、手機 44px）。
  - stack e2e（`E2E_DB_NAME=ivy_website_notif_e2e_test`、埠 8771／3771）：75 項全過，含視覺基準 6 張與 a11y（淺色主色鈕變色沒有讓基準超過門檻）。第一次跑時機器負載 20 以上，API 準備的 `initialize-content` 超過 180 秒被砍；用暫時的本機設定把等待放寬到 10 分鐘重跑才起來（設定檔沒有進版控）。
  - 沒動後端與 API 型別，沒跑 pytest 與 `contract:check`；未驗證 Safari／iOS 實機。

## 2026-10-05 官網後台第九輪 UI/UX：接待少點幾下、說明收起來、字級 token（`feature/admin-ux9-20261005`，10-05 已部署 main `5404854`）

使用者要「看看後台 UI/UX 還有哪裡可以優化，先給方向」：對 origin/main 用拋棄式測試庫灌資料，桌機 1440、手機 390 各拍 31 頁，加自動偵測與歷輪定案對照，評 28/40（09-29 是 26/40），給了四個方向；使用者說「都幫我處理」。規則見 DESIGN.md「官網後台第九輪 UX」。

- **接待**：案件列表與總覽「今天的參觀」名單，場次開始後直接有「到了／沒來」（先確認，寫出家長與場次；招生入學開著時講明會建立招生訪視）。案件明細的改期一律先收成連結、說明改白話；手機明細改成撥號 → 處理 → 聯絡紀錄 → 家長資料（聯絡紀錄從約 1300px 提到約 650px）。
- **篩選**：桌機也收進「更多篩選」，已套用的條件列成可以逐一拿掉的標籤（從總覽點進來也看得到套了什麼）；分頁數字改中性灰（只有舊需求「待處理」暖黃）；面板標題寫目前看哪一組；1280 寬表格原本橫捲 30px，收欄寬後不捲、參觀時間不折行。
- **減噪**：天天用的 8 個頁面頁首說明只留一句，其餘收進「說明」展開；明細不再固定列出官網已不問的參觀人數／想了解的事／同意紀錄（有值的舊資料照列）；總覽「新需求待聯絡」「待園方確認」有數字才出現（第七輪待裁定，使用者交由我決定）；招生看板拿掉和欄標題重複的數字列，欄標題對齊。
- **內容編輯**：有修改時狀態列給「存草稿並預覽 ↗」（點擊當下開分頁、存好才換成預覽頁，存不成功就關掉）。寬螢幕右側嵌即時預覽要動 web 的 `/preview`，這輪沒做。
- **視覺系統**：字級收成 `style.css` 十級 token（12–28，285 處 px 換掉；11→12、17→18、26→24），彩色側條（招生卡片、月曆有預約的色塊）改細框或拿掉，統計長條拿掉 `transition: width`；`ux20261005.test.ts` 守門。使用者列表的「停用帳號」「解除綁定並登出」收進每列「更多」，發布紀錄的「整站還原到這次」改成靠右灰色文字鈕；場次頁「自己設定」按鈕對齊。
- **刻意沒改**：案件明細「頂欄＋返回連結＋家長姓名」三層（返回連結帶著列表篩選，拿掉反而難用）；各校預約方式頁一次看五校狀態（不在這輪四個方向內）。
- **驗證**（Node 22.23.2）：
  - admin：`vue-tsc -b` 與 `vite build` 通過；vitest 93 檔 1160 項通過（新增 `ux20261005.test.ts` 29 項，含字級、側條、layout 動畫三條守門；9 項舊測試照新規則改寫）。`npx impeccable detect admin/src` 從 6 筆降到 2 筆，剩下兩筆是評析時判定的誤報（章節導覽灰軌、用邊框畫的展開三角形）。
  - stack e2e（`E2E_DB_NAME=ivy_website_ux9_e2e_test`、埠 8797／3797）：整套 71 過 2 敗，敗的是視覺基準「案件明細」（預期中的改動）與它連帶的「各校預約方式」（worker 重啟後 `beforeAll` 用同一個識別碼重送預約被擋）。重拍 `visit-detail`、`users` 兩張基準（舊的案件明細基準本來就過時：側欄還寫「分校頁」、有 10-03 已拿掉的參觀人數），再跑 `visual` 6 項全過；a11y（axe）、鍵盤、角色、接待、招生流程都過。
  - 拋棄式測試庫實際操作（Playwright，桌機 1440／1280、手機 390 櫃台帳號）：列表 3 列「到了／沒來」、按下確認後剩 2 列；1280 寬表格不再橫捲、參觀時間不折行；手機明細聯絡紀錄在 653px、家長資料在 901px；手機套用篩選時搜尋框維持 218px；「存草稿並預覽」點擊當下開分頁並導到預覽網址。
  - 沒動後端與 API 型別，沒跑 pytest 與 `contract:check`；未驗證 Safari／iOS 實機、正式站。

## 2026-10-05 效能第四輪：官網字型與圖片、後台按需引入、後端熱路徑、CI 平行（`feature/perf-20261005`，10-05 已部署 main `bcf6005`）

使用者問「專案在效能上有哪裡可以優化」，看完盤點後說「都幫我處理」。規則見 DESIGN.md「效能第四輪」；量測腳本與數字在 `output/playwright/perf-audit-20261005/`（擋非 GET，不寫正式站統計）。

- **官網字型**：LINE Seed 分片改依各頁用字分組（`scripts/page-font-chars.cjs` 從正式站收集 → `scripts/subset-critical-fonts.py` 的 `cluster()`）。每頁 LINE Seed 下載量（同一份用字）：首頁 184→50 KB、/about 387→48、/curriculum 417→59、/admission 336→60、/anniversary 525→72、/news 254→39、/visit 171→36。
- **官網圖片**：響應式圖片預設補 1600w（30 張，`--only` 更新）；預約頁校區卡在 DPR ≥ 2.5 手機挑 800w；30 週年時間軸貼圖改成線頭快走到才逐張載（桌機前 6 秒圖片 2680→1528 KB）；刪 9 支沒被引用的舊雜湊影片（約 28 MB），影片產生器之後自己清。
- **後台**：Element Plus 元件 JS 改按需引入（`unplugin-vue-components`，只解析 Element Plus、不產生 d.ts，型別狀態與原本相同）。入口 JS 849→159 KB（brotli 218→約 49 KB）。**樣式維持整包、在 `style.css` 之前載入**：先試過連樣式一起按需（CSS brotli 42→8.6 KB），元件 CSS 跟著各頁 chunk 晚到、同權重蓋掉 `style.css` 的覆寫，stack 視覺基準三頁差 2–4%（表格列高、輸入框邊框），改回後 CSS 檔與正式站同一個雜湊。
- **後端**：`/public/site` 程序內快取（讀取時用 release／停用分校／台北日期＋素材指紋判斷，命中只付兩個輕量查詢，本文與 ETag 逐位元組相同）；telemetry 與公開點擊的限流檢查合成一個交易（原本 4 個）；`GET /public/booking-config/{campus}` 改唯讀；預約 CSV 匯出改串流（REPEATABLE READ 快照，稽核筆數＝輸出筆數）；migration `4373bcc82d9d` 補預約案件、時段、稽核紀錄的索引（只建索引、不改資料）。
- **CI**：後端 pytest 用 pytest-split 依 `backend/.test_durations` 分 3 組平行；uv 改 `astral-sh/setup-uv`（v10.2.0，以 `backend/uv.lock` 快取）。
- **刻意沒改**：根層 `/assets/*` 維持一天快取（9 月有 5 批同檔名換圖）；站內換頁不會重抓 `/api/published-site`（線上實測，盤點時誤判）。
- **本機 A/B**（origin/main 與本分支各一份 production build，都讀正式站已發布內容；手機 1.6 Mbps／150 ms／CPU 4×、DPR3）：

  | 頁面 | LCP（前→後） | 總傳輸（前→後） |
  |---|---|---|
  | / | 1.70→1.60 s | 761→627 KB |
  | /about | 3.58→2.64 s | 1168→796 KB |
  | /curriculum | 2.67→2.48 s | 844→486 KB |
  | /environment | 3.73→2.57 s | 1388→1130 KB |
  | /admission | 2.36→2.17 s | 838→562 KB |
  | /visit | 5.42→3.40 s | 1203→670 KB |
  | /anniversary | 3.59→3.43 s | 1229→779 KB |
  | /news | 0.72→0.69 s | 684→468 KB |

  CLS 都是 0；本機沒有 edge 往返，LCP 絕對值比線上低，看相對差。
- **驗證**（Node 22.23.2）：
  - web：`nuxt typecheck` 通過；vitest 80 檔 829 項通過（`title-fonts.spec.ts` 新增每頁分片在 inline、每頁 100 KB 預算）。新舊兩版 8 頁 × 桌機／手機截圖逐像素比對，只有每次隨機的水彩暈染不同。30 週年頁桌機（WebGL）從頭捲到結尾：五張卡立起、校徽印進 0，與 origin/main 相同。
  - admin：`vue-tsc -b` 與 `vite build` 通過；vitest 92 檔 1131 項通過。
  - backend（獨立測試庫）：全套 1531 passed、1 skipped（本機沒有 zscale 的 HLG 測試），9 分鐘；`--store-durations` 產生 `.test_durations` 後第 2、3 組單獨跑也全過（各約 2.8 分鐘，沒有順序相依）。migration upgrade／downgrade／upgrade 與 `deploy/check_schema.py` 通過；`npm run contract:check` 一致。
  - stack e2e（`E2E_DB_NAME=ivy_website_perf1005_e2e_test`、埠 8795／3795）：74 過 1 敗，敗的是既有間歇的 `media.spec`（讀後台 API 的 `payload.photo` 時存檔還沒完成，在檢查官網之前），單獨連跑 3 次都過（含發布後官網出現新圖）。`visual.spec` 與 origin/main 對照組同條件都 6 項全過。
  - 未驗證：Safari／iOS 實機、正式站、CI 上三組平行實際耗時（本機估各約 3 分鐘）。

## 2026-10-05 官網公開輸出再拿掉原型預約示範資料（`feature/booking-demo-fields-20261005`，10-05 已部署 main `7d132eb`）

使用者看完 10-04 的回報後說「booking.fields 也幫我清掉」。盤點 `booking` 時發現同一個物件裡另外三個欄位官網也沒讀，而且是原型的示範文字，一併拿掉：

- **拿掉**（`web/app/utils/public-copy.ts` 的 `RETIRED.booking`）：`fields`（原型表單欄位清單，含已拿掉的「想先了解的事」與 `demo-consent` 同意勾選）、`demoNote`（「這是官網互動提案，請使用測試資料。資料不會送出或儲存…」）、`steps`（含「示範完成，尚未送出預約。」）、`isDemo`。這四個在正式站每一頁的 HTML 都看得到。
- **型別**：`BookingContent` 只剩 `privacyNotice`、`ctaLabel`、`ctaLabelEn`，刪除 `BookingField`。`VisitForm` 雖然收 `booking` prop 但沒讀任何欄位（家長看到的隱私說明走後端 `/booking` API），不動。
- **不動**：兩份 fixture（後端也不讀這四個欄位，只是原型抽取時原樣留下）、後端、後台、API 契約。

**驗證**（Node 22.23.2）：
- 先在 `web/tests/public-copy.spec.ts` 加斷言（公開輸出不含「這是官網互動提案」「示範完成，尚未送出預約」「demo-consent」，`booking` 只剩 `ctaLabel`、`ctaLabelEn`），在未修改版確認紅燈再改。
- web：`nuxt typecheck` 通過（沒有 WARN）；vitest 80 檔 817 項通過。
- stack e2e（`npm run e2e:build` 後整套，`E2E_DB_NAME=ivy_website_bookingdemo_e2e_test`、埠 8782／3782）：75 項全過。
- 未驗證：Safari／iOS 實機、正式站。

## 2026-10-04 30 週年分頁 v2：孩子畫的高雄地圖、畫進 0 的結尾、30 支蠟筆蠟燭（`feature/anniversary-v2-20261004`）

使用者要「依對我的了解自己找主題，優化 /anniversary 除了 30 週年影片的內容，盡量展示前端能力」。規則見 DESIGN.md「30 週年分頁 v2」，規格 `docs/superpowers/specs/2026-10-04-anniversary-v2-design.md`。

- **正式站實測到的問題**：2006–2019、2022–2027 時間軸右側約兩個畫面高只有年份；蠟筆線停在左下角，跟影片結尾「孩子跳進 0 變成校徽」沒接上；2027 顯示「第 31 年」。
- **新增**：時間軸旁黏住的「孩子畫的高雄地圖」（真實區界、湖、河與五校門牌座標，跟著年份長出校園與路線）；結尾線畫成 30、孩子跳進 0、校徽印在 0 裡；「幫常春藤吹蠟燭」（按住、劃過、麥克風三種吹法，Web Audio 音樂盒生日快樂歌）；畫板復原／重播／分享與蠟筆沙沙聲；拼圖格子彈簧。2027 改寫「滿 30 年」。
- **資安標頭**：`/anniversary` 文件改 `microphone=(self)`，其他頁不變（`tests/security-headers.spec.ts`）。
- **拿掉開發輔助用字**（使用者看完預覽後要求）：首屏海報說明、各段操作說明、「畫紙準備中」、蠟燭狀態字與麥克風說明、地圖「位置依門牌估算」；地圖只留授權要求的署名，蠟燭剩幾支只在吹到一半時出現。之後 `test:website` 78 檔 793 項、typecheck 通過，Playwright 1440／390 無 console 錯誤、無橫向捲動。
- **rebase 到 main `5f6a0e8` 之後重驗**：web typecheck 通過、`test:website` 78 檔 789 項（main 的分校頁清理刪了幾項自己的測試）、`nuxt build` 通過；production server：`/anniversary` 是 `microphone=(self)`、`/` 與 `/about` 仍是 `microphone=()`，1440／390 開場→略過→整頁往下往回捲無 console 錯誤、無橫向捲動，按住吹氣時「還有 N 支」從 28 數到 1。沒跑 stack e2e（沒有任何 e2e 涵蓋這頁或資安標頭，這次也沒動後端、後台、預約）。
- **地圖資料**：`node scripts/build-anniversary-map.mjs [--fetch]` 產生 `web/app/utils/anniversary/map-data.ts`。
- **驗證**（Node 22）：
  - `test:website` 78 檔 792 項全過（新增 `anniversary-v2.spec.ts` 20 項：地圖資料與年份→地圖、結尾路徑與版面、蠟燭風場、吹氣判斷、生日快樂歌音高、禁用字與 tokens；`security-headers.spec.ts` 加麥克風標頭）；web typecheck 通過；`nuxt build` 通過（兩則 postcss Lexical 警告是首頁 hero 既有的）。
  - production server（fixture）：`/anniversary` 200、`Permissions-Policy` 為 `microphone=(self)`，`/about` 仍是 `microphone=()`；HTML gzip 66.5KB（地圖靜態線條改成掛上後才輸出，原本 72.9KB）。
  - Playwright：1440×900、1366×650、1280×800、1100×800、768×1024、390×844 往下往回捲、減少動態、第一次進站開場自動播放→略過→飛進海報，都沒有 console 錯誤、沒有橫向捲動；axe（wcag2a/aa、best-practice）桌機與手機 0 項。
  - 蠟燭：滑鼠劃過、按住按鈕吹熄、再點一次；麥克風用 Chrome 假裝置餵自製 WAV——寬頻氣流聲約 1 秒吹熄 30 支、吹完自動關麥克風，同樣響的純音不會熄；從別頁站內換頁進來時按麥克風會重新載入 `/anniversary#anni-cake` 一次。
  - 畫板：畫三筆→⌘Z／Ctrl+Z 各復原一筆→重播→存圖與分享按鈕。
  - 未驗證：真人對手機麥克風吹氣（iOS Safari／Android Chrome）、實機 Safari 的 `<use>` 與 container query、聲音實際聽感、stack e2e。

## 2026-10-04 資安掃描複核：15 項中 13 項 main 已修，補 3 處（`fix/security-scan-20261004`，10-05 隨 main `ba32b9b` 部署）

使用者交來 Codex Security 掃描報告（15 項：中 7、低 8）。報告掃的是 `feature/website-admin` 的 `d11d7e79`，落後 `origin/main` 655 個 commit；逐條對 main `15001574` 複核：

- **main 已修（13 項）**：官網代理本文上限與串流上傳（#1 #2 #5，`web/server/routes/api/website/v1/[...].ts` 先驗 Content-Length、chunked 回 411）；訪客 IP 從 X-Forwarded-For 右邊取（#4，`web/shared/request-guard.ts`）；API 解析前限本文、素材上傳先驗 session（#7，`backend/app/common/body_limit.py`）；素材改 FileResponse／串流供檔（#3 #15）；帳號鎖在驗密碼之前（#6）；儀表板通知失敗數依校區（#8）；素材解碼丟 thread 且限 2 件（#10）；到期占位不計名額（#11）；`hide_parameters`（#12 的綁定參數部分）；換發 session 鎖 token 列（#13）；匿名化清聯絡紀錄並回補舊案、年齡與聯絡時段已是選項代碼（#14 的主要部分）。
- **這次補的 3 處**：
  - #12 殘留：asyncpg 例外字串帶 PostgreSQL 的 `DETAIL`（違反 NOT NULL／CHECK 時整列內容、唯一鍵衝突的鍵值），`hide_parameters` 管不到。`backend/app/logging_config.py` 新增 `RedactDatabaseErrorDetail`，掛在 root 與 uvicorn 的 handler 上，格式化堆疊時遮掉 DETAIL 與參數編碼錯誤裡的值；例外類別、錯誤本文、約束與資料表名稱照留。
  - #14 殘留：已匿名化的案件仍可新增聯絡紀錄（要等下一輪清理才補清）。改回 409 `VISIT_REQUEST_ANONYMIZED`；`lock_editable` 在列鎖內重讀 `anonymized_at`，與清理互斥。
  - #9：`design/entrance-curtain-a-velvet-20260922/render-posters.cjs` 本機靜態伺服器用 `startsWith(root)` 判斷，`%2e%2e%2f` 可讀到同前綴兄弟目錄。改用 `path.relative` 判斷、錯誤編碼回 403；不加 realpath 檢查（本機 worktree 常把 `web/node_modules` symlink 到別處）。
- 沒有 migration、API 契約不變（`export_openapi.py --check` 一致）、後台與官網前端沒改。
- 沒處理：`versions/before-seo-performance-20260921-203736` 快照裡的舊代理（#5 附帶，快照不部署、不修改）。
- **驗證**（本機 PostgreSQL，獨立測試庫 `ivy_website_test_secscan`）：
  - 先寫測試、在未修正版確認紅燈再修：`test_retention_policy.py::test_anonymized_case_rejects_new_contact_notes`（原本 201）；`test_secfix_platform.py` 新增 3 項（NOT NULL 違規的 `Failing row contains (…)` 原本整段進日誌、參數編碼錯誤、`configure_logging` 掛到 root 與 uvicorn handler）。
  - 後端全套 1392 passed（機器同時有別的 session 跑測試，耗時 1 小時 41 分）；`export_openapi.py --check` 一致。
  - 以 uvicorn 的 `LOGGING_CONFIG` 加 `configure_logging()` 實際記一筆，`uvicorn.error` 與 `app.*` 輸出都不含原值。
  - `render-posters.cjs`：`node --check` 通過；`resolveInRoot` 對 `%2e%2e%2f<同前綴兄弟目錄>`、`..%2f`、`%00`、錯誤編碼都回 null（舊版放行兄弟目錄），`poster.html` 與 `web/node_modules/three` 照常解析。沒有實際重產海報。
  - 未驗證：web／admin（沒改）、stack e2e、正式站。

## 2026-10-04 後台拿掉官網已不顯示的舊欄位：首屏小標、校園探索熱點（`feature/admin-legacy-fields-20261004`，10-05 已部署 main `5f6a0e8`）

使用者：「後台現在有舊的設計的欄位，可以幫我處理掉嗎」。10-03 的 `83ed17db` 已拿掉常見問題兩頁、分校頁預約橫幅與五校介紹的簡介／詳細介紹／首屏焦點；正式後台只剩兩處「官網不顯示、後台還能編」：首頁大圖標語的「標語上方的小標」（09-30 首屏改版拿掉）與校園探索的熱點（分校頁 10-03 拿掉，環境頁只用場景照片、名稱、說明）。範圍經使用者選定：後台＋後端規則＋官網死碼，後端 schema 舊欄位與已存資料不動。

- **後台**：「首頁大圖標語」拿掉小標欄位；「校園探索」拿掉圖釘、點照片加熱點、拖曳／方向鍵／座標、熱點名稱／說明／提問、上下移與「熱點待複核」，只留場景名稱、照片、說明與場景排序，預覽改成跟環境頁一樣原比例整張顯示（不再是 8:5 拉滿）。舊值（小標、舊場景的熱點）照原樣存回。素材庫替換對話框拿掉「熱點要重新複核」警告；刪掉沒人用的字數提示（小標、熱點說明、分校頁介紹、FAQ、預約橫幅）與 `bannerTitlePreview`／`BANNER_DEFAULTS`、沒人用的 `--on-photo-border`／`--on-photo-shadow`。順手修：「新增場景」按鈕原本夾在 `role="tablist"` 裡（axe critical `aria-required-children`，main 就有），移到 tablist 外。
- **後端**：`HomeHeroPayload.eyebrow` 改選填（預設空字串）；`TourScenePayload.spots` 改選填（0–8 個，舊熱點照原規則驗證）；拿掉 `_mark_tour_spots_for_review`（換照片自動標待複核）與 `_tour_publish_blocker`，上線前存下、標成待複核的草稿也能直接發布。`spots_reviewed` 欄位保留只為舊版本可讀。沒有 migration、不改已存資料；契約只有一行說明文字（已 `contract:generate`）。
- **官網**：刪掉沒人引用的 `CampusTour.vue`、`CampusFaq.vue`、`CampusTestimonials.vue` 與它們的全站 CSS（`styles.css`／`performance.css` 約 8.8KB）；`content-overlay.ts` 拿掉常見問題合併（`mergeCampusFaq`）與沒人讀的欄位轉換（小標、五校區塊說明、出處說明、分校簡介／詳細介紹／臉書備註／首屏焦點、同意文字、預約橫幅、熱點），草稿預覽不再抓 `campus_faq`／`shared_faq`。公開輸出（`public-copy.ts` 的 `withoutRetiredFields`）拿掉這些舊欄位，頁面資料不再帶原型的示範同意文字與常見問題；整份內容 JSON 少約 15.6KB（39.5%，未壓縮）。`site-fixture.json` 不動（後端初始化內容要讀）。
- **DESIGN.md**：「後台欄位要對得上官網」補 10-04；「校園探索後台畫布 8:5」「校園探索照片一定要 8:5」標作廢。

**驗證**（Node 22.23.2；本機 PostgreSQL，獨立測試庫 `ivy_website_legacyfields_test`）：
- 後端：先改 `test_content_rules.py`（沒有熱點的場景可存可發、換照片不擋發布、待複核舊草稿可發、首屏不帶小標可存），在未修正版確認 4 項紅燈再修；整套 pytest 1391 passed。
- admin：vue-tsc 通過；vitest 88 檔 1078 項通過（tablist 修正後再跑校園探索相關 7 檔 150 項通過）。
- web：`nuxt typecheck` 通過；vitest 77 檔 767 項通過（基準比對 `overlay-baseline-20260925.json` 改成先拿掉舊欄位再比，檔案本身沒動）。
- `npm run contract:check` 一致。
- 實機（`tests/stack/start-api.sh` 起拋棄式 API＋admin vite＋nuxt dev live 模式，Playwright 桌機 1440×900、手機 390×844）：兩頁都沒有熱點與小標；把義華舊場景標成待複核、再新增一個場景後發布回 200，新場景 `spots: []`、舊場景 3 個熱點照原樣保留；小標存檔後原值保留。axe：兩頁剩 moderate `heading-order`（後台共通），沒有 serious／critical。`/`、`/environment`、`/visit`、`/about` SSR 200，新場景有渲染，HTML 裡沒有 `spots`、`faq`、`fbNote`、`heroPhotoPos`、原型示範文字。
- stack e2e（`npm run e2e:build` 後整套，`E2E_DB_NAME=ivy_website_legacyfields_e2e_test`、埠 8781／3781）：72 項 71 過；`media.spec.ts`「素材庫上傳照片…發布到官網」失敗（`home_about` 的 `payload.photo` 讀回不符），單獨重跑一次仍失敗、第二次通過，是 main 既有的間歇問題（這次沒動 home_about 與素材選取）。
- 未驗證：Safari／iOS 實機、正式站。

**合併注意**：未合併的 `feature/page-cms-20261004`（`content-overlay.ts` 的 `ContentOverlay` 介面與 campus_profile 附近、`overlay-baseline` JSON、`labels.ts`）與 `feature/media-jobs-20261003`（`content-overlay.ts` 首屏與孩子的一天段落、`MediaSlotField`）改到相鄰段落，後合併的一方會有小衝突。

## 2026-10-04 素材背景轉檔（`feature/media-jobs-20261003`，10-05 已部署 main `11ccc8e`）

影片上傳改成背景轉檔（poster＋桌機／手機 H.264），官網改播轉檔版本；圖片多中圖。規則見 DESIGN.md「素材背景轉檔」。已 merge origin/main `d559cae6`。

- **後端**：新表 `media_jobs`（migration `e5b9c3a7d214`，接在參觀後追蹤的 `b8e3f1a6c4d7` 之後，只新增表與 enum 值）、`app/media/jobs.py`、`app/workers/media_loop.py`、`POST /admin/media/{id}/retry`、指令 `transcode-media-videos [--apply]`；`WEBSITE_MEDIA_VIDEO_PROCESSING`（正式站預設 background）。health 的 `media_jobs.enabled` 看迴圈是否還在跑。
- **後台**：素材庫、選影片、影片版位、上傳清單、替換流程顯示轉檔狀態；處理中可「編輯」，失敗只有「重新處理」。
- **官網**：`slotVideoSrc` 依桌機／手機選轉檔版本，沒有就用原檔；處理中的影片草稿預覽退回內建影片。
- **和計畫不同的地方**：已是可直接播的 H.264 且轉檔版本不小於原檔 90% 時沿用原檔、不寫衍生檔；回補候選排除已有 done 工作與超過 10 分鐘的影片，沒有 `--force`，之後改參數要手動清 `media_jobs`；停機時先放回工作、再中止執行中的 ffmpeg，抽 poster 的 ffmpeg／ffprobe 仍不可中止（最多約 30／15 秒）。
- **已知限制**：inline 模式（本機開發、測試、`import-site-assets`）在呼叫端交易內等 ffmpeg，長影片可能撞 idle_in_transaction 300 秒，正式站全新匯入長影片要先改設 background；`regenerate-media-variants --apply` 因「缺中圖」會把每張圖的縮圖／中圖／大圖全部重產，全站圖片網址會換一次（瀏覽器與 CDN 快取失效一次）；桌機五欄網格的失敗卡片，動作列排成兩行。
- **驗證**（2026-10-04，HEAD `096be30c`）：alembic merge 後只有一個 head `e5b9c3a7d214`，downgrade -1／upgrade 成功；後端 pytest 全套（獨立測試庫）1432 passed、1 skipped（HLG 整合測試，本機 ffmpeg 沒有 zscale）、484 秒；`npm --prefix web run typecheck` 通過、`npm run test:website` 75 檔 757 項全過；`npm --prefix admin run typecheck` 通過、`npm --prefix admin run test:unit` 88 檔 1065 項全過；`npm run contract:check` 一致；stack e2e（`E2E_DB_NAME=ivy_website_mediajobs_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751`）70 passed（2.8 分），含新的 `media-video.spec.ts`。畫面檢查（Playwright 1440×900、390×844）：上傳→處理中→約 4.5 秒自動變可用；首屏影片版位選處理中影片→說明→自動更新；失敗→「重新處理」→轉好；兩種寬度沒有橫向溢出。
- **轉檔成本**（本機 Apple 8 核，轉檔限 2 執行緒，`/usr/bin/time -l`）：孩子的一天桌機母帶（25 秒、1280×720、24fps）→ 桌機版 10.1 秒、峰值記憶體約 235 MB、CPU 約 1.8 核、輸出 7.8 MB；手機版 8.3 秒、約 237 MB、4.8 MB；合成 4K60 6 秒來源 → 桌機版 3.0 秒、約 524 MB。Railway api 容器若只有 2 vCPU，轉檔期間 API 只分到很少 CPU（已 nice 10）；記憶體要拿正式站方案上限來判斷。
- **未驗證**：正式站 ffmpeg 有沒有 zscale（HLG 整合測試本機 skip，push 後要確認 CI 是 pass 不是 skip）、Railway api 記憶體與 `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`、iOS Safari 實機播放轉檔版本、HDR 實片轉色調畫質、正式站回補。
- **需要使用者決定**：(1) 轉檔參數（預設 CRF 20／26、長邊 1920、30fps、不帶聲音、上限 10 分鐘）；(2) Railway api 容器記憶體與 CPU 夠不夠，不夠就升級方案或另開 worker 服務（付費，需本人同意）；(3) 失敗影片不計配額（預設接受）；(4) 正式站回補何時跑，指令見 `deploy/README.md`「素材背景轉檔上線步驟」，由本人執行。

## 2026-10-04 關於常春藤頁開放後台編輯（`feature/page-cms-20261004`，階段 B，10-05 已部署 main `11ccc8e`）

接在階段 A（特色教學頁）之後，同一個分支。

- **後台**：「全站與素材 → 關於常春藤頁」可改首屏、四個章名、一路走來（含沿革五站的年份與說明）、全人教育、我們的期許、結尾，以及三張照片；不開放六大領域與核心素養、家長怎麼說、卡紙位置與顏色、目次標題、紀念章樣式。內容種類 `about_page`，草稿預覽 `?page=about`。
- **官網**：`/about` 讀已發布內容，沒發布過就顯示改版前的內建內容。沿革年份可改，民國年自動換算；`/about` 的搜尋標題、描述與首頁 JSON-LD 的創立年份讀沿革第一站，預設 1997 時輸出不變。30 週年頁與 `llms.txt` 的 1997 仍寫死。
- **規則**：字數兩層（後端硬上限、後台建議值）；一路走來標題逐行上限第一行 6、第二三行 7（避開紀念章）；沿革年份要由早到晚，後台即時紅字提醒；細節見 `DESIGN.md` 最上方「關於常春藤頁」。
- **驗證**（2026-10-04，HEAD `70eb1991`，已合併 origin/main `eab7df4f`）：
  - 後端全套（獨立測試庫）1425 passed（機器負載高，16 分）。
  - 官網 `npm --prefix web run typecheck` 通過；`npm run test:website` 78 檔 792 項全過（`web/vitest.config.ts` 加了 plugin-vue 與 `~` 別名，給 AboutContent 的 SSR 渲染測試用；plugin-vue 是 Nuxt 的間接依賴，沒寫進 package.json）。
  - 後台 `npm --prefix admin run typecheck` 通過；`npm --prefix admin run test:unit` 在另一個 session 跑 ivy-backend 全套、load average 15–40 時，每次有 10–23 項 5 秒逾時，失敗的檔每次不同，單獨重跑通過；加 `--testTimeout=20000` 全套 90 檔 1100 項全過；中等負載下新測試最慢約 1.9 秒（既有 cmsUx 約 2.0 秒）。
  - `npm run contract:check` 一致。
  - 畫面零差異：`/about` 與 `/curriculum` 的 SSR `<main>` 和改版前比對為空；stack 起 API 跑 `initialize-content`（後台已發布路徑）後，兩頁的 `<main>`（去掉 scoped hash）與內建內容相同。
  - 版面硬上限：`node scripts/page-copy-stress.cjs /about` 在 390／820／901／1024／1440 通過，含「一路走來標題 vs 紀念章」重疊檢查。
  - stack e2e（`E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761`）71 passed（3.3 分），hydration 與 axe 檢查新加入 `/about`，都通過；visual 基準沒有更新。
- **未驗證**：實機 iOS／Android、正式站；後台草稿預覽 `/preview?page=about` 只有單元測試，沒在瀏覽器登入後打開看過；後台換照片後在已發布頁面的實際裁切只有單元測試。

## 2026-10-04 特色教學頁開放後台編輯（`feature/page-cms-20261004`，階段 A，10-05 已部署 main `11ccc8e`）

使用者 2026-10-03 裁定文字與照片都開放；章節數量與版面結構固定。

- **後台**：「全站與素材 → 特色教學頁」可改所有段落文字與首屏、年段、課程方向、兒童美術館作品、五件事的照片；清單項目數固定，不能新增、刪除、排序；不開放英文小字、章節編號、年段名稱與年齡、顏料與版面。內容種類 `curriculum_page`，草稿預覽 `?page=curriculum`。
- **官網**：`/curriculum` 讀已發布內容，沒發布過就顯示改版前的內建內容，照片留空也用內建圖。
- **規則**：字數兩層（後端硬上限擋存檔、後台建議值提醒）；品德培養的引言上限 10、說明 20；後台選了照片沒設焦點時官網置中；教學理念超字數時 422 指到第幾項。細節見 `DESIGN.md` 最上方。
- **驗證**（2026-10-04，HEAD `53d1890a`，已合併 origin/main `d559cae6`）：
  - 後端全套（獨立測試庫）1397 passed、1 failed：`test_content_publishing_workflow.py::test_seed_from_fixture_refuses_to_overwrite_and_validates` 因初始化多了特色教學頁而 `assert 19 == 18`，`53d1890` 已修，該檔 19 passed。
  - 官網 `npm --prefix web run typecheck` 通過；`npm run test:website` 76 檔 766 項全過。
  - 後台 `npm --prefix admin run typecheck` 通過；`npm --prefix admin run test:unit` 89 檔 1078 項全過。
  - `npm run contract:check` 一致（payload 是 dict，契約沒變）。
  - 畫面零差異：`scripts/page-ssr-snapshot.cjs` 改版前後 `/curriculum` SSR `<main>` diff 為空；stack 起 API 跑 `initialize-content`（後台已發布路徑）後，`/curriculum` 的 `<main>`（去掉 scoped hash）與內建內容相同。截圖兩次連抓像素就不同（動態、影片幀），只當人工參考。
  - 版面硬上限：`node scripts/page-copy-stress.cjs /curriculum` 在 390／820／1024／1440 全過。
  - stack e2e（`E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761`）69 passed（2.6 分），visual 基準沒有更新。
- **未驗證**：實機 iOS／Android、正式站；「後台已發布且換了照片」的頁面上，沒設焦點時置中只有單元測試，沒在瀏覽器實測；`/about` 見上方階段 B 段落。
- **分支與合併**：已合併 origin/main `d559cae6`（重設密碼連結）。與 `feature/media-jobs-20261003`（背景轉檔）合併時 `web/app/utils/media-image.ts`、`content-overlay.ts`、`admin/src/api/labels.ts` 可自動合併，後合併者重跑 `contract:generate`；`backend/tests/test_content_initialize.py` 的初始化筆數與 `web/tests/fixtures/overlay-baseline-20260925.json` 之後新增初始化 kind 的分支都會撞到。

## 2026-10-04 參觀後追蹤：參觀案件與招生入學接成一條流程（`feature/admissions-follow-up-20261004`，10-04 已部署 main `bd22112`）

使用者要「家長完成參觀後可以有後續追蹤，參觀完成後案件自動導入招生入學，形成一整個流程」。規格 `docs/specs/2026-10-04-admissions-follow-up-design.md`（F-Q1 使用者回「不一定會聯絡」→ 不自動排第一次聯絡；附錄 A 是招生規格 Q1 的隱私權政策與保存天數擬稿）；規則見 DESIGN.md「招生入學」的「參觀後追蹤」。

- **後端**：migration `b8e3f1a6c4d7`（`recruitment_visits` 加 `follow_up_at`、`follow_up_owner_id`、`last_contacted_at` 與 CHECK；新表 `recruitment_contact_logs`；只新增、不改資料）。新模組 `admissions/follow_up.py`；新 API `/follow-ups`、`/records/{id}/contact-logs`、`/records/{id}/follow-up`、`/staff`；`/records` 加 `follow_up`、`owner` 篩選；到場建檔帶負責人（承辦人 → 標記的人）與預約上還沒到的下次聯絡；註冊、退出清掉下次聯絡；保存政策清聯絡內容；預約聯絡紀錄對已到場、已取消不再收下次聯絡（`FOLLOW_UP_NOT_TRACKED`）；總覽加 `admissions_follow_up_due`。匯出多 `recruitment_contact_logs` 延伸檔與 extensions 追蹤欄位（契約 README 記去向）。
- **後台**：招生入學「待追蹤」分頁（已到期／7 天內／未排定、負責人，網址 `fu`、`owner`）；記錄聯絡與改期對話框；歷程抽屜合併參觀前紀錄、招生事件、參觀後聯絡；看板卡片與訪視明細的下次聯絡；官網預約勾選多筆一次標記已到場；預約明細「參觀後追蹤」區塊；總覽待辦「參觀後該聯絡的家長」。
- **驗證**（Node 22.22；本機 PostgreSQL 16，測試庫 `ivy_website_test_followup`）：
  - 後端：新增 `test_admissions_follow_up.py`、`test_admissions_follow_up_schema.py` 共 25 項全過；整套 pytest 第一輪只有 `test_admissions_funnel.py::test_board_groups_cards_by_stage_and_term` 失敗（看板卡片多了 `follow_up_at`，已更新期望，該檔 29 項全過）；修正後第二輪整套 **1388 passed**（14 分 44 秒）；migration 升級、降一版、再升級都成功，`alembic heads` 只有一個。
  - `npm run contract:generate`、`contract:check` 一致；`python3 -m unittest discover -s deploy/tests` 20 項 OK。
  - admin：typecheck 通過、build 成功；vitest 1078 項通過、1 項失敗（`ux20260928F.test.ts` 午夜換日的日期多一個空格，沒改過的 HEAD 一樣失敗，是這台容器 Node 22.22 的 ICU 格式，不是本次改動）。新增 `admissionsFollowUp.test.ts` 21 項。
  - stack e2e（這個容器沒有 Google Chrome，用預裝 Chromium 以本機設定覆寫 `channel`，不進 repo）：`admissions-flow`、`admissions-follow-up`、`a11y`（含待追蹤分頁兩個網址）、`keyboard`、`roles` 共 44 項全過；截圖 `output/playwright/admissions-followups-*.png`、`admissions-contact-dialog-1440.png`。
  - 未驗證：stack e2e 全套、web（本次沒動）、Safari／iOS 實機、正式庫 migration。

## 2026-10-04 官網預約成功只通知園方一則（`fix/booking-notify-once-20261004`，10-04 已部署 main `bdab2ec`）

使用者回報：官網預約成功後，校區 LINE 群組同時收到「新的參觀需求」與「參觀預約已確認」兩則。原因是自選場次（09-30）把送單改成一律預約成立時，沿用了舊「自動確認模式」的寫法：`submit_visit_request` 先排 `visit_request_created`、再排 `visit_request_confirmed`，原本只有自動確認的校才會排第二則，改版後條件被拿掉，每筆都排兩則（LINE、站內通知、園方 Email 都是兩份）。這是 10-01 起列為待裁定的「送單兩則通知」，使用者 10-04 裁定合併。

- **後端**：送單只排 `visit_request_created`，標題由「新的參觀需求」改「新的參觀預約」（案件頁的用語是「排了場次的才叫預約」）。`visit_request_confirmed` 只留給園方確認補登的案件。成效統計的 `request_created`／`visit_confirmed` 兩個事件照記，不受影響。
- **後台**：`NOTIFICATION_KIND_LABELS` 同步改字；舊的站內通知紀錄（同一個 kind）也會顯示新標題。逾期提醒「新的參觀需求超過 24 小時尚未處理」、總覽「新的參觀需求還沒聯絡」講的是還沒排場次的案件，不改。
- **契約**：只有通知 schema 說明文字一行，已 `npm run contract:generate`。
- 沒有 migration。已在 outbox 裡排隊、還沒送出的 `visit_request_confirmed` 會照舊送出（只影響部署當下那幾分鐘的預約）。
- **驗證**（Node 22）：先把 `test_line_notifications.py::test_outbox_pushes_to_campus_group_once` 改成「只推一則、標題是新的參觀預約」，在未修正版上確認紅燈（推了 2 則）再修；把「兩則」寫死的 6 個測試檔改成一則。後端全套 1363 passed（獨立測試庫 `ivy_website_test_notifyonce`）；admin typecheck、vitest 87 檔 1056 項（`--maxWorkers=2`）；`contract:check` 一致。web 沒有改。未驗證：正式站真實 LINE 群組實收。

## 2026-10-04 預約頁背景大字不再被選校區蓋掉（`fix/visit-ghost-fit-20261004`，10-04 已部署 main `503ec36`）

使用者回報 `/visit` 背景大字「參觀」被切掉。原因是 10-02 收短迎賓區後，大字仍是固定字級（`clamp(142px,14vw,208px)`、手機 30vw），而且掛在整個 `.visit-page` 上，第二行落到下方 `.visit-content`，被它的底色蓋掉。10-03 `feature/website-admin` 上的 `cb9bc89` 是在收短前的版面把色帶撐高，跟 10-02 的裁定衝突，所以沒有併進 main。規則見 DESIGN.md「預約頁 UI／UX 優化（2026-10-02）」的迎賓區收短。

- **修法**：`VisitForm.vue` 把 `.visit-ghost` 移進 `<header class="visit-welcome">`。`visit-booking.css` 的 `.visit-ghost` 改成 `inset:0`＋`container-type:size`，`span` 字級取 `min(var(--visit-ghost-size),100cqh / 2.08)`，em 字距改寫在 `span`；手機改設 `--visit-ghost-size:30vw`。不支援 cqh 的瀏覽器退回原字級。
- **驗證**（Node 22）：
  - 新增 `web/tests/visit-ghost-20261004.spec.ts`（2 項，修改前紅燈）；`test:website` 77 檔 771 項全過；web typecheck 通過，沒有 WARN。
  - dev server（fixture）＋Playwright 量「參觀」的行框底與內容區上緣，涵蓋 1920×1080、1440×900、1280×720、1000×800、1024×768、961×700、960×900、768×1024、720×450、390×844、375×667、320×568。修改前有 9 組被蓋 15–241px，修改後 12 組都是 0，也沒有水平溢出。字級變化：1440 從 202 變 195px、1280×720 從 179 變 130px、1000 從 142 變 120px、390 從 117 變 101px；960 以下單欄維持原尺寸。
  - 未驗證：Safari／Firefox 實機、stack e2e。

## 2026-10-04 30 週年改成正式分頁：進主選單、頁尾、sitemap（`feature/anniversary-nav-20261004`，10-04 已部署 main `f935801`）

使用者看完不公開上線的 `/anniversary` 後說「幫我做成一個分頁沒關係」。規則見 DESIGN.md「30 週年分頁」。

- **入口**：fixture 主選單第五項「30 週年 / Anniversary」、頁尾連結（`web/server/data/site-fixture.json`；後台 `DEFAULT_PRIMARY_NAV`／`DEFAULT_FOOTER_LINKS` 同步）。正式站後台沒存過這兩個欄位，部署後直接生效。
- **SEO**：`anniversarySeo`（canonical、麵包屑、分享圖沿用首頁）、`sitemapXml`、`llmsTxt`；頁面改走 `usePageSeo`，拿掉頁面自己的 noindex（收錄照全站設定）。
- **統計**：`contentPages`、後端 telemetry `page` 列舉、`CTA_ENTRIES`（後端、web、後台標籤）加 `anniversary`；`<main data-cta-entry="anniversary">`；`npm run contract:generate` 重產契約。都是字串欄位，不需要 migration。
- **頁首**：五項在 1101–1126px 預約鈕超出視窗，1101–1180px 選單間距 32→20px。
- **驗證**（Node 22）：web `test:website` 76 檔 769 項（`media-slots` 基準快照加兩筆、`environment.spec` 選單斷言、`anniversary.spec` 改測正式分頁）、web typecheck；admin typecheck、vitest 87 檔 1056 項（`--maxWorkers=2`；同時開 dev server 跑時，案件／篩選類有 1–6 項計時偶發，還原成 main 也會發生）；後端 `test_traffic`／`test_analytics_funnel`／`test_site_structure_content` 79 項（獨立測試庫 `ivy_website_test_anninav`，跑完刪除）；`contract:check` 一致。dev server（fixture）＋Playwright：頁首 1920／1440／1366／1280／1200／1101–1180 每幾 px／1100／1024／1000／960／920／901 都一列、不重疊、沒有橫向捲動；桌機膠囊與手機選單面板第 05 項「30 週年」、頁尾有連結。

## 2026-10-04 30 週年分頁 `/anniversary`（`feature/anniversary-page-20261004`，10-04 已部署 main `9068de8`，不公開、不進導覽）

使用者要「依對我的了解自己找主題，做一個 30 週年分頁，盡量展示前端能力，並用《手牽手，走到 30》那支 30 秒影片當進入分頁的開場」。主題定為「孩子畫出的 30」：延續影片的米白水彩紙、綠色蠟筆與立體書卡片。規則見 DESIGN.md「30 週年分頁」。

- **頁面**：`pages/anniversary.vue`（noindex、不進 sitemap 與主選單）＋`AnniversaryContent.vue`＋`AnniversaryIntro.vue`；樣式 `assets/css/anniversary.css`（只用 tokens）；程式 `utils/anniversary/*`；頁首膠囊加 `/anniversary`。
  - 開場：第一次進站自動靜音播放（桌機橫式、手機直式各一支），可開聲音、略過；29.0 秒那一格整個畫面飛進首屏右邊的海報相框（FLIP）。
  - 1997 到 2027：往下捲蠟筆線跟著畫、紙偶在線頭走、翻牌年份與校園數；五校在成立那年像立體書立起，鉛筆線沿測地時間描出、再暈水彩（共用一個 WebGL2 畫到各自的 canvas），可翻面看校舍照片，附地址電話與各校 `BookingCta`；終點把 30 週年校徽印上去。
  - 孩子的作品拼成的 30：沿用特色教學頁的 8 件作品與替代文字，品牌字「30」切格拼圖，縮圖與格子互相亮起，點開燈箱。
  - 換你畫一個 30：WebGL2 蠟筆畫板（一筆用 MAX 混合、放開才依紙紋沉積），品牌五色加深綠、影片同一組「30」虛線導引，存成圖片只在使用者裝置。
- **素材**：`scripts/build-anniversary-media.py` 從展示作輸出（repo 外 `output/ivy-30th-20261003/`）壓影片、抽海報、複製素材場，檔名帶雜湊，產生 `utils/anniversary/media.ts`。影片桌機 11.6MB（1080p 3Mbps）、手機 6.0MB（720×1280）；其餘素材合計約 0.6MB。
- **驗證**（Node 22）：
  - `test:website` 76 檔 768 項全過（rebase 到 main `fb3757c` 後）（新增 `anniversary.spec.ts` 15 項：沿革和 /about 一字不差、作品和特色教學頁一致、禁用字、noindex、素材檔存在、拼圖相鄰不重複、導引幾何）、web typecheck 通過。
  - dev server（fixture）＋Playwright：1440×900 與 390×844 開場自動播放→略過→飛進相框對齊海報、時間軸六個位置、拼圖亮起與燈箱、畫板換色／關導引／存圖、重看開場（展開後有聲播放）、減少動態（不播開場、整頁直接畫完、年份照樣跟捲動）；console 無錯誤。
  - 未驗證：stack e2e、實機 iOS／Android 與 Safari、真人聽開場配樂。
- **業主裁定（10-04）**：先以不公開方式上線（noindex、不進選單與 sitemap）；30 週年校徽同意用在這頁。

## 2026-10-04 後台重設密碼改成寄連結（`feature/admin-password-reset-20261003`，10-04 已部署 main `d559cae`）

使用者 10-03 裁定：只做「總管理者寄重設連結」，登入頁不開放自助忘記密碼。本分支接在後台第八輪 UX 之後開發，期間已把含第一波（UX8＋成效統計）的 origin/main 合入。

- **後台**：「使用者」→「重設密碼」對話框多一種方式「寄重設連結到 <Email>」，「寄重設連結」選項永遠顯示：有寄信且帳號啟用時預設選它；沒設定寄信或目標帳號已停用時是停用狀態並附說明，只能「直接設定新密碼」（原本的做法，保留）。寄出後顯示寄到哪裡、幾點前有效。停用帳號點舊連結會看到「帳號已停用」。新頁 `/admin/reset-password` 不用登入，同事在這裡設定新密碼，完成後回登入頁。
- **API**：`POST /admin/users/{id}/password-reset-link`、`POST /auth/password-reset/verify`、`POST /auth/password-reset/complete`；`/auth/me` 的 `features.password_reset_email`。新表 `password_reset_tokens`（migration `d2b7f4c9e1a3`，只新增表）。
- **規則**：連結 30 分鐘、用一次，寄新的舊的就失效，DB 只存雜湊。信同步寄出，失敗就作廢連結、當場說明原因。設好新密碼後登出所有裝置、解除密碼登入暫停。停用帳號、本人改密碼、總管理者直接設新密碼也會作廢還沒用的連結；直接設新密碼也改成會解除密碼登入暫停（行為改變）。「保留直接設定新密碼」與「直接設定新密碼也會解除密碼登入暫停」兩點是使用者 2026-10-04 確認的。
- **驗證**（Node 22，2026-10-04，HEAD `abd244d`）：後端 pytest 全套 1363 passed；admin typecheck 無錯誤、vitest 1054 passed／2 failed（`admissionsRecords.test.ts` 兩項 5 秒逾時，單獨重跑 24 passed，本分支未動招生）；web typecheck 無錯誤、`npm run test:website` 753 passed；`contract:check` 一致；stack e2e 全套 69 passed（含新的 `password-reset.spec.ts`）。alembic 只有一個 head `d2b7f4c9e1a3`。
- **上線前**：正式站要有 `WEBSITE_SMTP_*` 與 `WEBSITE_ADMIN_ORIGIN`，才能寄重設連結（沒設時該選項停用並說明）。「直接設定新密碼也會解除密碼登入暫停」不論有沒有設定寄信，部署後就生效。push main＝正式部署，由使用者決定。

## 2026-10-04 官網後台第八輪 UX（`feature/admin-ux8-20261003`，10-04 已部署 main `b4bb570`）

09-28 稽核「還沒處理、需要決定的」表格裡使用者選的六項。錯誤定位（哪一則哪一欄）10-02 第七輪已做，這輪不動。規則見 DESIGN.md 同名段落。

- **長編輯頁段落目錄**：首頁消息、各校消息、入學資訊、孩子的一天、隱私權政策。1280 以上在表單右側黏住，較窄時是表單上方一排膠囊。
- **選圖統一**：`MediaFieldCard`（外觀）＋ `MediaSlotField`／`MediaRefField`（資料）。消息封面、內文圖片、分享圖、校園探索都改用；消息封面與內文圖片一樣必填、沒有「移除照片」（後端規定每則消息一定要有照片）。素材不是 ready 時標「處理中」「失敗」，並預留 `status` prop 與 `#status` slot 給背景轉檔計畫。
- **兩人同時處理同一案**：頁首「最後處理：誰・何時・做了什麼」；狀態轉換被擋時重讀並寫出現在的狀態；切回分頁超過 30 秒自動更新、同事剛改過就提示。後端錯誤訊息改寫中文狀態名。案件明細切回分頁重讀時，`focus` 與 `visibilitychange` 連續觸發只重讀一次；只有同事在重讀前之後真的有新動作才點名「某某剛剛…」，變動來自家長或系統時寫「這筆案件剛有更新，畫面已重新整理。」；靜默重讀失敗不蓋掉畫面與草稿，只提示「無法更新案件，畫面可能不是最新。」。
- **我承辦的案件**：總覽列最多 5 筆＋查看全部（不算待辦）；承辦人帳號已停用、還沒結案的算待辦（校區管理者以上）。列表加「只看未結案」與承辦人「承辦人已停用」。停用帳號時若對方還有未結案件，提醒件數。
- **登入逾時**：對話框有「在新分頁打開登入頁」；新分頁登入同一個帳號後這頁自動接續（仍要再按一次儲存），登入的是別的帳號就不接續。登入滿 12 小時前 15 分鐘提醒先儲存。自動接續先比對帳號、相同才寫入身分與 CSRF token；別的帳號在新分頁登入時，這一頁什麼都不寫入，繼續等原帳號登入。

**後端與契約**：`InvalidTransition` 訊息中文化；案件清單、分組計數、匯出加 `open=true`、`assignee=inactive`；`/admin/dashboard` 加 `my_open_cases`、`inactive_assignee_open_cases`；`/auth/me` 加 `session_max_expires_at`。沒有 migration。已跑 `npm run contract:check`。

**驗證**：Node 22，HEAD 6f41e38：後端 pytest 1299 passed；admin typecheck 0 error、vitest 79 檔 990 passed、build 成功；web typecheck 0 error、單元 75 檔 748 passed；`contract:check` 一致；stack e2e keyboard 10 passed、整套 68 passed（截圖基準沒變）。畫面量測（`output/ux8/`）：首頁消息、隱私權政策、分享圖、總覽在 1440／1280／390 都不橫向溢出；1280 與 1366 寬、隱私權政策填 60 字小標時表單仍是 720px、目錄在右側黏住；390 寬目錄是可橫捲的膠囊列、頁面不溢出；手機選圖按鈕 44px；點目錄會把焦點移到該段標題。

**未驗證**：Safari／iOS 實機；LINE 內建瀏覽器的 BroadcastChannel；兩個分頁真的換帳號登入的實機流程（只有單元測試）；總覽「我承辦的案件」與案件明細「最後處理」只有單元測試，沒有截圖。已知限制：沒有未儲存修改的分頁，在別的分頁換成另一個帳號登入後，會直接以那個帳號的身分回到原頁，登入頁的說明不會出現（和 main 原本閒置延長會切換帳號的行為相同）。

- **待使用者確認**：沒有承辦權限的唯讀角色看不到「我承辦的案件」（目前：要有案件讀取權限才顯示）；停用帳號不自動清掉承辦人（目前：只提示件數）；登入滿 12 小時前 15 分鐘提醒。

## 2026-10-04 成效統計補強：預約結果、五校比較、每日趨勢與班別（`feature/admin-analytics-phase1-20261003`，10-04 已部署 main `b4bb570`）

依 `docs/analysis/2026-09-30-enrollment-analytics-report.md` 階段 1；計畫 `docs/superpowers/plans/2026-10-03-admin-analytics-phase1.md`。規則見 DESIGN.md「成效統計補強」。

- **後端**：`GET /admin/analytics/booking-outcomes`（同批案件的結果、到場率、未到率、取消率、現在待處理三種，只列授權校區）、`/event-trend`（每日事件，台北日期）、`/class-distribution`（生日換算班別）；funnel 與 traffic 帶 `as_of`。待處理三種集中到 `booking/pending_kinds.py`，總覽與案件列表共用。不新增資料表、沒有 migration。
- **後台**：`components/analytics/` 新增五個元件；官網瀏覽加每日趨勢與 09/30 標記。三個新面板換期間／校區時，標題與說明列標的是「目前畫面上這批資料」的期間與校區；重抓中舊數字變淡、重抓失敗只顯示錯誤，不留舊數字。
- **驗證**（Node 22，HEAD 3f0fb96）：後端 pytest 1328 passed；admin typecheck 0 error、vitest 80 檔 994 passed、build 成功；web typecheck 0 error、單元 75 檔 748 passed；`contract:check` 一致；stack e2e keyboard 10 passed（含 `/analytics` 390／1440 不溢出），整套 66 passed／2 failed——`a11y.spec` 的入學 arrivals 頁在整套時 axe 逾時（單獨重跑通過），`media.spec` 是 main 既有的間歇失敗（測試在存檔完成前讀 API，本分支沒動到相關程式）。截圖 `output/playwright/analytics-{1440,390}.png`：兩寬度都不溢出，五校比較表在框內橫捲，09/30 標記線看得到。未驗證：Safari／iOS 實機、正式站資料、期間拉到一年時手機直條的實際觀感（只有單元測試與程式審查）。
- **未做**：統計匯出（匯出擴充計畫）、測試案件人工排除（要 migration）、UTM（階段 3）。
- **待使用者確認**：到場率分母（目前：已到場＋未到場，時間已過還沒標記的另列）、班別預設學年（目前學年）、班別含已取消（目前含）。

## 2026-10-03 關於頁第一章：紀念章取代「拉拉看」（`feature/about-medal-20261003`，未部署）

使用者要拿掉第一章右頁的拉鍊時間軸、改用紀念章，比過點擊版與捲動版後選「章名旁＋連續轉」。10-04 使用者發現捲動時只剩反面、想保留正面，比過四種後選**正反交替**（像硬幣，2001／2020 落在米白正面）。規則見 DESIGN.md「關於頁第一章：紀念章取代『拉拉看』」。

- **官網**：新元件 `AboutMedal.vue`（CSS 3D，不載 three）；`AboutContent.vue` 拿掉紙條、第一章外包 `.abk-track`；`about-popup.ts` 的紙條段改成紀念章捲動（`medalTurn`／`medalFaces`／`medalShown`／`medalPinTop`），翻頁進度改量軌道；`about.css` 拿掉紙槽樣式、加紀念章位置與釘住規則。面圖 `web/public/assets/about-medal/`（大校徽、米白正面帶字、墨綠反面三張共 63KB，`scripts/about-medal/build.py` 產生）；翻面順序是 `medalSequence()`。
- **驗證**（Node 22）：
  - `npm --prefix web run typecheck` 0 錯 0 警告；`test:website` 75 檔 753 項（`about.spec.ts` 換成紀念章 10 項，拿掉紙條 4 項與 `mobile-ux-20261002` 的拉拉看字色 1 項）。
  - dev server（fixture）＋Playwright：1440×900 釘住（pin top 52）、1440×780 往上推 8px 釘住、1366×650 不釘（經過時走完五站）、390×844 與 375×667 釘右頁；各捲動點紀念章站數、正反面、卡紙 `--up`、沿革上色一致，往回捲倒著翻；都沒有橫向捲動、沒有 pageerror。減少動態：不釘、卡紙全站、紀念章停在校徽。10-04 正反交替後同一組尺寸重跑一次，並截六步確認米白正面的字在圓心內。
  - 未驗證：`nuxt build`／stack e2e、實機 iOS Safari 的 sticky 與網址列收合、Android。

## 2026-10-03 404 頁加立體書校徽（`feature/404-crest-popup-20261003`，未部署）

使用者要把 logo 做成 3D；比過全站右下角浮動三方向後，改成嵌在分頁某一段，選「404 × 立體書」先做。規則見 DESIGN.md「404 頁加立體書校徽」。

- **官網**：新元件 `CrestPopup.vue`＋`utils/crest-popup.ts`，`error.vue` 只在 404 放；503 不變。純 CSS 3D，不載 three.js；五張紙片 WebP 共 54KB（`scripts/build-crest-popup.py` 產生）。
- **驗證**（Node 22）：
  - `test:website` 76 檔 764 項（新增 `crest-popup.spec.ts` 10 項）、web typecheck 通過。
  - dev server（fixture）＋Playwright：1440／1320／1319／1200／1180／1179／900／390 都不壓字、不橫向捲動；游標靠近會轉、離開後停穩；點擊 5 段動畫跑完歸零；減少動態 0 個動畫；手機點擊可用。
  - 另開後端連不上的 dev server 打出 503：標題「網站暫時無法顯示」、沒有立體書。
  - 未驗證：`nuxt build`／stack e2e、實機 iOS／Android。

## 2026-10-03 關於頁第一章五校卡紙改成一樣大（`feature/about-equal-cards-20261003`）

使用者要求 /about「一路走來」右頁的五校照片「五間都是一樣的比例」。

- **`AboutContent.vue` 的 `STAGE`**：前排國際、仁武從寬 42% 改成和後排一樣 31%，並移到後排兩道縫的正下方（x 17.25／51.75%）；後排 y 50／56／50% → 46／52／46%，收掉卡紙變小後多出來的排間空白。CSS、動畫、左頁沿革都沒動。規則寫在 DESIGN.md 同日一節。

**驗證**（Node 22）：`npm --prefix web run typecheck` 通過；`npm run test:website` 75 檔 754 測試通過。Playwright（fixture dev server、減少動態）量 1440×900、1280×720、768×1024、844×390、390×844、320×640：五張照片框同寬同高（1440 寬約 146×111），卡紙都在舞台內；後排卡紙底到前排年份標籤 53／55／10／10／17／33px，舞台底到紙槽 19–24px。不減少動態時桌機與 390 手機紙條示範跑完五張 `--up` 都是 1、沒有 pageerror。

## 2026-10-03 「孩子的一天」拍立得捲動時不再飄動（`feature/polaroid-no-scroll-wind-20261003`）

使用者要求：拍立得不要捲動時的動畫，保留相紙的感覺；翻面提示已有 F 第一張翻開進場，不需要捲動起風。

- **拿掉**：捲動時右下角被風掀起、整張順風微擺。`DayMomentCard.vue` 不再訂閱捲動，`cornerWind.ts` 只留翻面起手與進場輕掀，`styles.css` 拿掉 `--sway`；WebGL 版折線固定 45°。
- **保留**：點下去翻面時角先捲起、顯影後輕掀一次、F 第一張翻開進場、游標傾斜、顯影。
- **驗證**（Node 22）：web typecheck 通過；`test:website` 743 項通過（`corner-wind.spec.ts` 改寫成守「捲動不動」與起手／輕掀）；dev server Playwright 桌機 1440、手機 390 快速上下捲約 180 格取樣，掀角 0 格、微擺 0 格、傾角固定，F 與點擊翻面照常、無 page error。

## 2026-10-03 後台拿掉官網已沒有頁面顯示的編輯頁（`feature/remove-campus-editors`）

接續「拿掉分校資訊頁」：公開站沒有顯示的地方，後台就不留編輯入口。

- **拿掉**：「各校常見問題」「共用常見問題」編輯頁（舊網址轉到五校介紹）、「預約文案」裡的分校頁預約橫幅欄位、「五校介紹」的一句話簡介／詳細介紹／分校頁首屏焦點；web 的草稿預覽不再附橫幅例子，刪除 `CampusVisitBanner`、`campus-banner.ts`。
- **保留**：「五校介紹」的校名、地址、電話、社群、封面（首頁五校卡、選單、頁尾與預約頁在用）；「校園探索」（常春藤環境頁在用，說明改成環境頁）。側欄分組「分校頁」改名「各校」。
- **不動後端**：campus_faq、shared_faq 等內容種類與已存資料、API 契約都沒改，沒有 migration；之後要找回只要補回後台頁面。
- **未處理**：web 的 `CampusFaq`、`CampusTestimonials`、`CampusTour` 元件目前沒有使用者；後台流量圖表仍保留歷史的分校頁入口名稱。

**驗證**（Node 22）：admin vue-tsc、vitest 75 檔 946 項；web typecheck、vitest 749 項。stack content-flow 改用「地址」欄位並以 `/api/public-site` 驗證，尚未在本機跑 stack。

## 2026-10-03 CI 加速：測試的 bcrypt 降到 rounds 4、只改文件的提交不跑 CI（`feature/ci-speed-20261003`）

使用者問：為什麼每次部署都要那麼久。

- **根因**：部署要等 Backend job，job 裡的 `pytest -q` 在 CI 上約 22.7 分鐘；其中一半花在 bcrypt（建帳號＋登入的 fixture 走正式的 rounds 12，全套 2060 次）。另外最近 25 次 main push 有 14 次是部署紀錄／文件提交，每次都完整測試＋重新部署，main 的 run 又依序排隊，緊接著推的紀錄提交會讓下一次部署多排 20–28 分鐘（最長一次總共 56 分鐘）。
- **測試**：`backend/tests/conftest.py` 把 `_pwd_context` 降到 rounds 4，查無帳號用的假雜湊跟著重算；正式環境不變。
- **workflow**：PR 與 push 加 `paths-ignore`（`**.md`、`docs/**`、`design/**`、`versions/**`），整次變更都只有文件時不跑 CI、不部署。說明補在 `deploy/CICD.md`。

**驗證**（本機、獨立測試庫）：
- 對照實驗：origin/main 全套 1021 秒 → 只降 rounds 450 秒（-56%），失敗清單相同。
- 同時段 A／B 交替（認證、招生紀錄等 4 檔 115 項）：修改後 33／37／37 秒三輪全過，rounds 12 是 141／128 秒；bcrypt 耗時 0.7 秒對 94 秒。
- 本分支全套 1293 項通過（`test_referral_text_matches_admin_labels` 首輪因 sparse checkout 沒抽 `admin/` 讀不到檔，補抽後通過）；當時機器 load 11–12，總時間不具比較性。
- workflow YAML 用 PyYAML 解析確認觸發條件；`paths-ignore` 的實際效果要推上 GitHub 後才看得到。

## 2026-10-03 官網預約拿掉「參觀人數」「想先了解的事」，得知管道改四選項（`feature/visit-no-party-size-20261003`）

使用者要求：/visit 表單拿掉參觀人數；接著也拿掉整個「想先了解的事」欄位；「如何知道常春藤幼兒園？」改成只問來源追蹤看不到的管道，留四個。

- **得知管道**：官網選項改為親友介紹（`friends_family`）、住附近／路過看到（`nearby`）、網路上看到（`online`）、其他（`other`）。媽媽社團、LINE 群組的口碑算親友介紹；網路細節之後由自建來源歸因補（後台目前沒有 referrer／UTM 紀錄）。舊代碼 facebook／google_reviews／parent_community 後端照收，後台、匯出、成效統計照樣顯示舊案件。「親友介紹」不改名：預約轉招生紀錄時來源存文字，改名會讓招生統計拆成兩列。上限從 5 改為代碼總數 7。契約重新產生。

- **官網**：預約表單拿掉人數下拉，送出列與完成頁也不再顯示人數，送單不帶 `party_size`；家長修改頁不能再改人數（舊案件有填的照樣顯示）。
- **後端**：拿掉官網送單「必須有人數」的 422（`PartySizeRequired`）；欄位維持選填 1–10，給更新前快取的舊頁面與後台補登用。
- **想先了解的事**：表單拿掉「其他想告訴我們的事」摺疊區（只裝這一格），送單不帶 `questions`；家長修改頁不能再改（舊案件有填的照樣顯示）。得知管道下方補 32px 間距給送出列。後端 `questions` 本來就選填，未動。
- **後台**：個資說明預設文字拿掉參觀人數與想先了解的事，並把過時的「Email（選填）」改掉。後台補登、案件明細、匯出的人數欄位保留（舊案件與補登仍會有）。

**驗證**（Node 22）：
- web typecheck、vitest 740 項；`contract:check` 一致；admin vue-tsc 通過。
- backend pytest 1262 passed，2 failed（`test_secfix_media` 的 Pillow 版本與 S3，借用的 venv 較舊、缺 `boto3`，與本次無關；`test_media_s3.py` 因此略過收集）。
- dev server＋攔截 API 的 Playwright：桌機 1440、手機 390 選場次後直接接孩子資料，送單不帶 `party_size`，可走到預約成功；拿掉想先了解的事後重跑，送單欄位只剩校區、版本、家長、手機、孩子、Email、得知管道、場次。
- admin vitest 951/952：`ux20260928E`「刪除場景後選旁邊那一個」間歇失敗（單檔重跑一紅一綠，與本次無關）。
- 未驗證：stack e2e（`tests/stack` 已同步拿掉選人數步驟，未實跑）。

## 2026-10-03 隱私權政策頁（`feature/privacy-policy-20261003`，未部署）

使用者決定官網改用 cookie 做行銷分析（自建歸因＋GA4＋廣告像素）、不做 cookie 橫幅；拆三部分，本段是第 1 部分：後台可編輯的隱私權政策。

- **後端**：新共用內容 `privacy_policy`（標題、最後更新日期、1–20 段）；含「【待確認」或沒填日期不能發布；沒有 migration。
- **後台**：「全站與素材 → 隱私權政策」編輯頁，第一次打開帶入初稿（12 段，9 處【待確認】、8 項事項待園方補）。
- **官網**：`/privacy` 頁（目錄、條列、https 連結，不用 `v-html`；未發布 404）、頁尾連結取代個資使用說明按鈕、預約表單對話框加完整政策連結、草稿預覽 `?page=privacy`、sitemap。
- **文件**：`docs/website-admin/seo-performance.md` 的統計儲存說明改成現況。
- **驗證**：stack e2e `privacy-policy` ＋ `keyboard` 15 項全過（含 1440／390 截圖不溢出、axe 無 serious／critical）；整套 stack 73 項，72 過，`media.spec.ts` 整套跑時間歇失敗、單獨重跑通過；`contract:check`、admin／web typecheck 通過；admin 單元 957 項、`test:website` 761 項通過（admin 單元連跑曾兩次各 1 項間歇失敗，第三次全過）；`admin build` 成功；後端整套 pytest 由主控另跑。

## 2026-10-03 拿掉各校分校資訊頁（`feature/remove-campus-pages`）

使用者裁定：不需要「首頁 / 五所校園 / 義華校」這種各校分校資訊頁；指向分校頁的連結、校區常見問題、各校結構化資料都拿掉。首頁五校輪播保留（照片、地址、電話、社群還在），只是不再連到內頁。

- **web**：刪除 `pages/campuses/[key].vue` 與 `CampusPageMain.vue`；`/campuses`、`/campuses/**` 301 轉回首頁；舊 hash `#/<校>` 轉到 `/#campuses`。輪播照片與校名、頁尾與錯誤頁校名改為不可點；選單「找到你的校園」改按鈕（只切換電話與社群）；預約頁拿掉「認識某某校」；預約管理頁改成直接撥各校電話；關於頁時間軸的校名改純文字、緞帶書籤改連到 `/#campuses`；環境頁拿掉「到某某校頁」。
- **SEO**：`pageSeo` 只輸出機構與網站，不再輸出各校 Preschool、FAQPage、麵包屑；sitemap 與 llms.txt 不列分校頁與校區常見問答；草稿預覽不再有 `?page=campus`。
- **後台**：校區內容發布後「查看官網」改開 `/#campuses`，預覽改開首頁預覽；共用常見問題沒有公開頁面，預覽連結隱藏。
- **腳本與 CI**：`deploy/railway_ci.py` 的 smoke、`audit-public-site.mjs`、`check-public-seo.mjs`、`first-screen-chars.cjs`（含產生的 json）不再檢查分校頁；check-public-seo 改驗 `/campuses/*` 為 301。
- **未處理**：後台的分校簡介、常見問題、環境導覽、預約橫幅文案仍可編輯，但公開站已沒有頁面顯示；`CampusTour`、`CampusFaq`、`CampusTestimonials` 等元件目前沒有使用者。

**驗證**（Node 22）：web typecheck、web vitest 74 檔 734 項、admin vue-tsc 通過；admin vitest 全套有 3 項在整套並行時偶發失敗、單獨跑 33 項全過；dev server（fixture）`/campuses/*` 301、首頁與內頁無 `/campuses` 連結、無 Preschool 結構化資料，桌機輪播與選單截圖確認。**未跑** stack／e2e。

## 2026-10-02 後台補登也拿掉同意勾選（`feature/manual-no-consent-20261002`）

使用者追加：補登時「已向家長說明，並取得同意留存聯絡資料」也拿掉。

- **後台**：補登對話框拿掉勾選，送出鈕只看必填欄位；送 `consent_given: false`。案件明細的同意紀錄寫「補登不需勾選同意」。「個資與搜尋設定」頁改寫「官網預約與後台補登都不用勾選同意」。
- **後端**：`_VisitRequestFields.consent_given` 預設 false，拿掉 `_require_consent`。補登沒勾時不記同意時間。
- **契約**：重新產生（`VisitRequestManualCreate` 說明與預設值）。

**驗證**（Node 22，已合併 main 的後台第七輪 UX 後重跑）：
- backend pytest 全套 1270 passed；`contract:check` 一致。
- admin typecheck、vitest 74 檔 952 項；web vitest 741 項。
- stack e2e 整套 68 項全過。
- 未驗證：線上補登（要後台登入），只在單元測試與 stack 驗過。

## 2026-10-02 官網後台第七輪 UI／UX（`feature/admin-ux-20261002`）

使用者要「優化後台整體的 UI/UX」。在拋棄式測試庫灌了示範資料（兩校場次、14 筆不同狀態的預約、三種角色、草稿與送審），把 30 個路由在 1440×900、390×844 兩種尺寸截圖，分五個面向稽核，每條發現都由另一個 agent 試著推翻，最後確認 47 條（駁回 6 條）。規則與理由見 DESIGN.md 同日段落。

**改了什麼**：
- **接待**：
  - 參觀開始後，處理區以「標記已到場／未到場」為主。
  - 狀態用詞全後台統一（預約正常、已到場、場次）。
  - 時間已過還沒標記到場的用暖黃，並能單獨篩出。
  - 改期、補登的場次選擇改善。
  - 拿掉已廢除的「方便接電話時段」。
  - 沒設定寄信時，不再承諾「會寄確認信」。
  - 月曆上同一天的多個場次分得出來，已結束的場次對比達 AA；手機電話連結 44px。
- **總覽**：
  - 「今日參觀」改成捲到今天的名單，名單上標出進行中、已結束。
  - 待辦新增「參觀時間過了，還沒標記到場」。
  - 常用工作去掉重複項，標題層級修正。
  - 側欄的「總覽」不再有空的收合標題。
- **內容編輯**：存檔錯誤定位到欄位、長清單可收合、移除前確認、版本衝突時保留自己的修改、可以「儲存草稿後離開」、分校基本資料空白不能發布（後端擋）、原型文字提示、過時說明更正。
- **設定與紀錄**：
  - 操作紀錄可以載入更早的紀錄、可以排除登入登出、可以點進案件，手機改精簡列。
  - 站內通知每列顯示參觀日期與場次。
  - CSV 匯出改 BOM、中文欄名、台北時間，手機號碼保留前導 0。
  - 停用分校、預約方式、LINE 步驟、成效漏斗、素材備註的說明更正。
- **跨頁**：錯誤提示統一用 `notifyError`（8 秒、可關閉）；危險確認框一律用紅色確定鈕、不自動聚焦；數字欄在手機隱藏微調鈕；文字連結加底線。

**後端與契約**：
- `/admin/dashboard` 加 `awaiting_attendance`。
- `/admin/audit-log` 加 `before`／`before_id` 游標與 `exclude_login`，並回 `target_exists`。
- `/admin/notifications` 改成具型別的 schema，加 `slot`。
- CSV 匯出欄名改中文（新檔 `backend/app/booking/export_labels.py`）。
- 分校基本資料發布前檢查必填。
- 沒有 migration。已跑 `npm run contract:check`。

**驗證**：`npm --prefix admin run typecheck` 通過；admin `vitest run` 73 檔、942 項全過；後端全套 `pytest` 1270 passed（獨立測試庫 `ivy_website_adminux_test`）；`npm run contract:check` 一致。`web/` 沒有改，沒跑 web typecheck。畫面用 Playwright 在本機 dev server 看過總覽（桌機、手機）、案件明細（已到場、時間已過待標記）、待標記篩選列表（手機）、站內通知、操作紀錄。

**待裁定**：總覽固定為 0 的兩格、送單兩則通知、通知是否顯示家長姓名、整站還原要不要用危險色。另外，CSV 改成中文欄名之後，若有外部流程讀英文欄名要先確認。

## 2026-10-02 官網預約拿掉同意勾選、手機場次卡一張一列（`feature/no-consent-20261002`）

業主裁定：正式站同意文字「送出需求後，仍須由園方確認參觀時間」和自選場次矛盾，**整段拿掉、不用勾選**。規則見 DESIGN.md 同日段落。

- **官網**：預約表單拿掉同意勾選框與同意版本邏輯（`utils/visit-consent.ts` 刪除）。有個資使用說明時仍保留「閱讀個資使用說明」。後台草稿預覽改成只預覽個資說明。手機場次卡一張一列。
- **後端**：
  - 公開送單不再要求勾選、不比對版本。
  - readiness、公開設定、總覽都不再因「沒發布同意文字」擋表單或列待辦。
  - 個資說明改成直接讀已發布預約文案，不綁同意文字；`consent_text` 改選填、不擋發布。
  - 補登仍要人員勾選。
- **後台**：拿掉「同意條款文字」欄位與總覽待辦；官網新案的同意紀錄寫「官網預約不需勾選同意」。
- **契約**：重新產生 `contracts/openapi.json`、`website-api.d.ts`。公開設定少了 `consent_revision_id`／`consent_text`，readiness 少了 `consent`，公開送單的 `consent_given` 預設 false。
- **stack 測試**：送單 helper 不帶同意欄位。原本「電話填錯直接點同意框」的位移回歸，改點同樣在電話下方的「親友介紹」勾選框。

**驗證**（Node 22）：
- backend pytest 全套（獨立測試庫 `ivy_website_test_noconsent`）1262 passed。
- `npm run contract:check` 一致。
- admin typecheck、vitest 69 檔 896 項；web typecheck、vitest 74 檔 730 項。
- stack e2e 整套 68 項全過；送出區分隔線修正後重 build，預約相關 5 支 spec 48 項全過。
- dev server＋假 API 390 寬：表單沒有同意勾選，不勾也能送出、結果頁「預約成功」；送單 body 不含 `consent_given`／`consent_revision_id`。場次卡一欄。
- 未驗證：iPhone Safari 實機。

## 2026-10-02 關於常春藤頁精修＋「家長怎麼說」（`feature/about-refine-20261002`）

使用者要「優化 /about 的 UI/UX、做精緻一點，先給 mock-up」，看過 `design/about-refine-mockup-20261002/` 後要「多加內容」，選了「家長怎麼說」，再說「先這樣實作」。J 立體書與 A2 六圈不換，規則與理由見 DESIGN.md 同日段落。

**改了什麼**（只動 `web/`：`AboutContent.vue`、`AboutWholePerson.vue`、`about.css`、`utils/about-popup.ts`、`tests/about.spec.ts`）：
- 首屏一屏放得下整本書、拿掉頁首下的米白縫；右頁兩張卡紙前後站；左頁下半放目次。
- 章名改中文（第一章～第四章）；右頁背面是章節封面，翻頁有背光與左頁影子；書脊改窄折痕；頁緣厚度跟著讀到哪裡變。
- 卡紙平躺時只看得到色紙；紙條改成有年份與校名的紙槽，左頁沿革跟著上色；鍵盤連按不再少走一站。
- 全人教育：領域圓點與六圈同色，滑過時那一圈亮。
- 我們的期許：引言側條改括號；紙房子加瓦片、煙囪、門把與沿牆長出來的常春藤。
- **新增第四章「家長怎麼說」**：讀各校後台的家長分享影片（目前義華 4 支），換人時卡紙倒下再站起來，按播放才載入 YouTube。
- 結尾五校書籤改成書底垂下的緞帶（含行政區），國際校的薄荷色看得見、手機一排五條。
- 首屏照片 alt 改「孩子們笑著圍在創辦人身邊」（使用者確認照片裡是創辦人）。

**驗證**（Node 22，dev server＋fixture）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 74 檔 743 項通過（`about.spec.ts` 新增 11 項）。
- Playwright 1440×900、390×844（DPR 2）與減少動態：四章翻開、卡紙站好、紙槽到第 5 站且左頁同步、常春藤長好、目次與頁碼 1–10 正確；第四章點第二位後清單與大卡紙、後排小卡正確，手機自動捲到影片，按播放插入 `youtube-nocookie.com/embed/U5kRPt7By90`；紙條 Home → →→ 停在 2005 崇德校；沒有 console error／page error、沒有水平溢出。
- 320／390／600／768／844×390／1280×720／1440×900 量卡紙都在舞台內；1440×900 首屏跨頁底 863px。
- axe（WCAG 2.1 AA，`#main`）1440、390 都沒有違規。
- 未驗證：iPhone Safari／Android 實機的 3D 翻頁與 `backface-visibility`；production build 的 LCP（首屏多一張 lazy 小圖）。
## 2026-10-02 招生入學後續修正（`feature/admissions-followups-20261002`，已部署：推送 `ac79a03`，隨 main `a2ed829` 上線）

招生入學併入 main 後使用者選定的五項後續修正，在同一分支完成（尚未部署）：

- **頁首學年選項放寬、統計子分頁寫進網址（X2a，e572fb3）**：頁首學年選項改為 [3,2,1,0,-1,-2]；統計分頁的子分頁用網址參數 `sub`（只在 `tab=stats` 且非總覽時寫入），重新整理或分享連結會停在同一個子分頁；網址帶 `sub=compare` 但只看得到一校時退回總覽。
- **名額規劃「計畫名額」欄加寬（X2a，7053d5f）**：欄寬 `min-width` 改 152，390px 輸入框不再被截成「..」。
- **功能開關關閉時側欄不顯示招生入學（X2b，b246839）**：`/auth/me` 與登入回應新增 `features.admissions`（取 `WEBSITE_ADMISSIONS_ENABLED`）；後台 auth store 存下（讀不到當關閉），側欄與側欄搜尋用 `canListNavItem` 過濾 `feature: 'admissions'` 的項目。路由守衛不擋，直接輸入網址仍看到「招生入學尚未啟用」。
- **五校比較件數跟頁首學期（X2b，978004f）**：`GET /admin/admissions/compare` 的 `semester` 改選填，沒帶＝件數算整學年（和總覽對得起來），名額剩餘用名額規劃的上學期；回應新增 `seat_semester`，表格上方依回應組說明句（例如「件數為 115 學年整學年；名額剩餘為 115 上學期（同名額規劃）。」）。

驗證（實際跑過）：

- 後端單檔 `pytest -q tests/test_auth_scope.py`（14 通過）、`tests/test_admissions_stats.py`（22 通過）。
- `npm run contract:check` 一致；`npm --prefix admin run typecheck` 無錯誤；`npm --prefix admin run test:unit -- --maxWorkers=2` 69 檔／897 測試全過。
- X2a 的 e2e:build＋admissions-flow 4 項通過、390／1440 截圖已檢視（見 X2a 報告）。

## 2026-10-02 預約頁 UI／UX 優化（`feature/visit-ux-20261002`）

使用者要「優化預約分頁（/visit）的 UI/UX」。先在正式站截 1440×900、390×844 兩種尺寸的選校、表單、聯絡方式三種畫面（沒有送出），再在本機用假 API 改版。規則與理由見 DESIGN.md 同日段落。

**改了什麼**（只動 `web/` 與 stack 測試，沒有後端與 migration）：
- **預約日期改月曆**（新元件 `VisitDatePicker.vue`、`utils/visit-month.ts`）：原本義華一次列 41 個日期的原生下拉。現在一次一個月，只有開放的日子能點，格內寫當天幾場；桌機月曆與當天場次並排。
- **參觀人數**移到「參觀安排」。
- **送出前確認**：送出鈕「送出參觀需求」改「確認預約」，旁邊寫出校區、日期、場次、人數。
- **Email 說明**：正式站沒開寄信（`parent_email_enabled: false`），原本卻寫「確認信與修改連結會寄到這裡」，現在依設定切換。
- **選校卡**標出「可線上預約」「來電洽詢」；所選校不開放線上預約時，步驟第二格寫「參觀方式」。
- **迎賓區收短**：1440×900、1280×720 的第一屏都看得到步驟列與選校卡上緣（原本整屏都是迎賓區）。
- 眉標「VISIT IVY」改「預約校園參觀」。
- 手機「下一步」黏在畫面底部。
- 結果頁標題下直接寫參觀時間與地址。
- `/visit/manage` 改場次也從「列出全部場次的下拉」換成同一個月曆＋當天場次。
- stack 測試：`tests/stack/pages.ts` 加 `pickVisitDate`／`pickVisitDay`（會自動翻月），`booking-flow`、`schedule-flow` 改用它與「確認預約」。

**待園方**：正式站同意文字「送出需求後，仍須由園方確認參觀時間」與自選場次矛盾，要在後台「預約文案」發布新版。

**驗證**（Node 22，已合併 main 的招生入學之後重跑）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 74 檔 732 項通過（新增 `visit-month.spec.ts`、`visit-ux-20261002.spec.ts`）。
- stack e2e 整套（production build＋真後端＋獨立測試庫 `ivy_website_e2e_visitux_test`）68 項全過。第一次整套是 67 過、1 敗：main 新加的 `admissions-flow.spec` 還用日期下拉，改用 `pickVisitDay` 後重跑全過。
- dev server＋假 API，1440×900／1280×720／390×844 走完選校 → 選日期場次 → 送出 → 結果頁，以及管理頁改場次：
  - 未選日期就送出，焦點到月曆第一個開放日並顯示錯誤；管理頁沒選日／沒選場次分別提示並聚焦。
  - 方向鍵換日會跳過沒開放的日子；翻月到最後一個有場次的月份為止。
  - 320／390 沒有橫向溢出；axe 只有 Nuxt devtools 工具列本身的問題；沒有 hydration 警告。
  - 選校卡標示讀進來前後 CLS 相同（0.0173，來自 dev 模式頁首）。
- 未驗證：iPhone Safari／Android 實機。

## 2026-10-02 招生入學模組（`feature/admissions-20261001`，階段 A–C 完成，2026-10-02 已部署 `2eafc1b`，功能開關關閉）

比照園務系統「招生入學」，在官網後台加參觀後的招生追蹤：已訪視 → 已預繳 → 已註冊 ｜ 退預繳／退註冊、名額規劃、統計分析與五校比較。三張表沿用園務名稱（`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`），併入園務時可整批轉移。規格 `docs/specs/2026-09-30-website-admissions-design.md`（第 17 節是計畫回寫對照），計畫 `docs/superpowers/plans/2026-10-01-admissions*.md`，規則見 DESIGN.md「招生入學（2026-10-01）」。分支疊在家長自選場次改版（`feature/parent-self-booking-20260930`）上。功能開關 `WEBSITE_ADMISSIONS_ENABLED` 預設關。

- **後端（階段 A）**：migration `4a7e2c9d1b63`（接 `c7d2e9f4a1b8`，三張新表＋`retention_policies.admissions_days`，只新增、不改寫既有資料）；訪視 CRUD、狀態轉換（不允許的 422、版本衝突 409）、保留座位與名額；預約標記「已到場」時在同一個交易建立招生訪視，時間已過還沒確認的預約列成待辦；保存政策新類別（預設不自動清理）；轉移契約 `contracts/ivy-recruitment/`、匯出程式與契約測試。
- **後台（階段 B）**：「招生入學」頁五個分頁（漏斗看板、訪視明細、名額規劃、官網預約、統計分析），篩選與分頁同步網址；看板可拖曳，也能用卡片選單「移到…」；預約明細的「標記已到場」加確認框並連到招生訪視；保存政策頁多「招生訪視」天數。
- **統計與驗收（階段 C）**：移植園務 `_query_stats`（KPI、四個比率、月度、年度、班別、來源、接待、未預繳原因、主管決策摘要、月比、警示、行動入口）與五校比較（`GET /compare` 回 `{as_of, school_year, semester, rows}`）；分母 0 回 `null`、畫面寫「—」；「未預繳原因」列未預繳明細（`/no-deposit-records`，含孩子姓名，不含電話、地址、生日）。stack e2e 跑通「家長自選場次 → 時間過後出現在官網預約 → 已到場 → 看板 → 預繳 → 註冊 → 名額已註冊 → 統計」；1440／390 截圖 12 張在 `output/playwright/admissions-*-{1440,390}.png`。
- **X1（B 留下的小項）**：testkit 預設 options 與 button 型別、轉換權限表測試改讀後端 `funnel.py`、訪視明細第 2 頁以後空狀態、保存政策「啟用後才有資料」。
- **C5 的 stack 調整**：招生流程的家長 context 帶獨立來源 IP，避開「每來源每校每小時 5 筆」的上限；「各校預約方式」截圖隱藏順序相依的通知鈕並重拍基準（含招生入學側欄）。
- 刻意與園務不同、併入時要決定的：`contracts/ivy-recruitment/README.md` 的差異清單（分母 0、月比、同票排序、來源不合併、警示指向、未預繳名單的排序與欄位、唯一幼生對匿名化的列以列 id 計等）。

驗證（實際跑過，log 在 `output/admissions-c6/`）：
- backend pytest 全套（`ivy_website_test_admissions`，先 `alembic upgrade head`）：**1 failed, 1261 passed, 163 warnings in 951.68s (0:15:51)**。唯一失敗 `tests/test_booking_consent_readiness.py::test_dashboard_lists_slots_campuses_without_openings` 是 main 既有、與招生無關的日期相依問題（2026-10-02 週五：規則 weekday=5、`max_advance_days=1`，存規則時場次同步補出明天週六的場次，未套 `min_lead_hours`；預約模組的場次同步程式與 `origin/main` 相同），本階段沒有修。
- `npm run contract:check`：契約型別與 openapi.json 一致。
- admin typecheck 與 build 通過；admin vitest：Test Files  68 passed (68)、Tests  884 passed (884)。
- web vitest（`npm run test:website`）：Test Files  70 passed (70)、Tests  707 passed (707)。
- production build 的 stack e2e 全套（`E2E_DB_NAME=ivy_website_e2e_test_admissions`）：68 passed (2.5m)；第一次整套是 64 passed (2.6m)、2 failed（roles 429、visual 各校預約方式），C5 修正後重跑全過。

**未驗證**：Safari／iOS 實機；看板的原生拖曳只在單元測試以事件模擬（e2e 走「移到…」）；正式庫 migration 與真實資料量下的統計速度。**已知小瑕疵**：390px 名額規劃「計畫名額」欄的輸入框被欄寬截出省略號（`IntakePlanTab.vue`，頁面不溢出）。**上線前必須裁定**規格 Q1（預約同意書是否涵蓋參觀後的招生聯繫與紀錄、招生訪視保存天數），在那之前只在本機與測試環境使用。上線步驟在 `deploy/README.md`「招生入學（A／B／C 完成，仍未部署）」。

## 2026-10-02 手機版第三輪審查修正（`feature/mobile-ux-20261002`，已部署 `f520031`）

使用者要「看看手機版還能怎麼優化」。

**審查範圍**：
- 唯讀審查 12 頁 × 390×844／360×780／320×568／844×390，在 dev server 上以 fixture 模式跑 Chromium。
- 另用 production build 在 390 寬、9 Mbps、CPU 4 倍降速下量載入。
- 09-29 第二輪已修或列為待決定的項目不重複列。
- 每項發現都由我重測確認後才改。只改 `web/`；規則見 DESIGN.md 同日段落。

**修正**：
- **首頁 CLS**：拍立得的 WebGL 畫布（`paperPrints.ts`）原本先停在靜態位置，場景建好才移到 -70px，被算成版面位移。改成插入前就放在最終位置。
  - 捲完首頁：390 寬 0.2947 → 0.0000，1440 寬 → 0.0001。
  - 後台「網頁速度」的 CLS 也來自這裡。
- **關於頁立體書**：寬 490–900px（橫拿手機、平板直拿）時，卡紙比固定高度的舞台還高，往上壓到左頁文字與「往下捲」連結。實測疊到的高度：
  - 844×390：首屏 174px、紙房子 143px。
  - 900 寬：首屏 203px。
  - 改法：舞台最寬 480px 置中，高度下限依舞台寬（`cqw`）長。320–430 寬數字與原本相同，桌機不變。
- **對比**：
  - 環境頁還沒到的餐點原本整列淡化，12px 小字只剩 2.97:1；改成只淡化手寫大標（仍有 4.9:1）。
  - 關於頁「拉拉看」紙條白字壓橘底 2.89:1，改用 `--ink`（5.22:1），同 10-01 書籤的做法。
- **點擊範圍**：`/news`、`/news/<id>` 麵包屑「首頁」從 28×44 補到 44×44（同 10-01 `.breadcrumb` 的做法）。
- **入學頁**：320 寬「每天穿什麼」的印章 64px 擠進 56px 欄、壓進鄰欄；360 以下印章最寬等於欄寬。
- 新增 `web/tests/mobile-ux-20261002.spec.ts`（6 項）。改前快照 `versions/before-mobile-ux-20261002-082818/`。

**沒改、待決定或之後處理**：見 DESIGN.md 同日段落最後的清單。包括：
- 國際校書籤與桌面同色（1.00:1）。
- 拍立得時間戳在亮照片上的對比。
- 內頁主執行緒長任務（環境頁 4.7 秒、首頁／教學／入學約 3.2–3.4 秒，CPU 4 倍降速）。
- 內頁字型分片 330–470 KB。

**驗證**（Node 22）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 71 檔 699 項通過；fixture 模式 `nuxt build` 通過。
- 在 production build 上：
  - 10 頁 × 320／360／390／844×390／1440 全部捲完，沒有水平溢出、沒有 page error。
  - 關於頁三個舞台在 320–1024 共 8 種寬度實測，卡紙都不再超出舞台。
  - 入學頁 320／360／390 印章都在欄內。
- 未驗證：iPhone Safari／Android 實機。

## 2026-10-02 分校分頁線稿不再露出方塊底（`feature/mobile-ux-20261002`，已部署 `f520031`）

使用者反映首頁「分校資訊」五校按鈕有方塊底圖。線稿原圖是米白紙底（約 250,248,242），靠 CSS `grayscale(1) brightness(.72) contrast(3.2)`＋`mix-blend-mode:multiply` 融掉。iPhone（WebKit）只要把圖或它的祖先移到獨立合成層，multiply 就碰不到底色，整塊紙底露出來。09-24 `0620470` 修過轉場那一段，但之後加的換校描線遮罩、環境頁選中時轉動的分頁，仍會觸發同樣狀況。改 SVG `filter:url()` 也不行：Safari 在合成層上不套參照濾鏡。

- **墨線版素材**：`scripts/optimize-site-images.py` 從五校線稿另產 `campus-line-art-<校>-ink`，黑線、透明底，濃淡放在 alpha。
  - 曲線同 CSS：v＝clamp(2.304Y − 1.1)，alpha＝1 − v。疊在任何底色上的結果都是底色 × v，和 multiply 相同，但不用混合模式。
  - 每個尺寸縮圖後才套曲線（160／240／360／480／720w）。alpha 用有損 q70：和無損最多差 5/255，240w 約 5.5 KB，和原線稿相當。
- **用到的地方**：首頁分校分頁、常春藤環境頁五校分頁、預約結果都改用墨線版，拿掉 filter＋multiply。
  - 共用 `media-image.ts` 的 `lineArtInkImage()`。
  - 後台換過線稿（`lineArtMedia`）時沒有墨線版，照舊用原圖並掛 `is-blend`。
  - 淡彩速寫改從 manifest 取原線稿，不再讀分頁鈕的 srcset。
  - 淡彩層（只在 hover 裝置）仍是 multiply。
  - 桌機 hover 未選中分頁時，線條不再額外加深一級（brightness .72→.68），只保留不透明度變 1。
- 新增 `web/tests/campus-line-ink.spec.ts`（4 項）。改前快照 `versions/before-campus-tab-ink-20261002-072912/`。

驗證（Node 22）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 70 檔 693 項通過；fixture 模式 `nuxt build` 通過。
- Chromium 逐像素比對新舊做法（五校 × 48–220px × DPR 1–3 × 不透明度 .55–1）：平均差 1.9/255。較大的差異只出現在 DPR3 的 170／220px：原線稿 800×533 與 3:2 有些微比例差，造成 2px 垂直位移，肉眼看不出。
- dev server 實頁前後截圖：首頁 390／320、環境頁 390，平均差 0.4–0.6/255。
- 手機 390 實測：分頁載 240w 墨線版；淡彩速寫照舊載原線稿 480w；四張預覽卡畫成線稿；手動換校接手上色；無 console 錯誤。
- 未驗證：iPhone Safari 實機（本機只有 Chromium）。

## 2026-10-02 SEO／GEO 結構化資料補強（`feature/seo-geo-structured-data`，未部署）

- **web**（`web/app/utils/seo.ts`，只用已發布內容，不杜撰）：
  - 分校 `Preschool` 地址拆出 `addressRegion`（高雄市）與 `addressLocality`（行政區），地址與區名對不上就不拆；後台有填 Google 地圖網址時輸出 `hasMap`。
  - 分校 `sameAs` 只列該校自己的社群（目前只有義華）；沿用機構粉專的四校不列，不拿義華代填。
  - 首頁 `EducationalOrganization` 補 `logo`、`alternateName`（英文名）、`foundingDate`（1997，同關於頁）、全站 `socialLinks` 當 `sameAs`。
  - `NewsArticle` 補 `author`，`publisher` 帶 logo。
  - `llms.txt` 逐條列出各校常見問答（與分校頁 FAQPage 同一份）。
- **刻意不做**：經緯度、營業時間、評分（沒有已發布資料）；sitemap `lastmod`（維持既有「不虛構 lastmod」規則）；AI 爬蟲個別放行（`User-agent: *` 已放行）。
- **前提**：正式站 `NUXT_PUBLIC_INDEXING_ENABLED=false`，開放索引前以上都不會被搜尋引擎看到。
- **驗證**（Node 22.22.0）：web typecheck 0 錯誤；`npm --prefix web run test:unit` 69 檔 692 項通過（新增 3 項）。

## 2026-10-01 品質檢查與招生分析報告的後續修正（`fix/report-followups-20261001`，已部署 `6b76f11`）

- **文件**：
  - `docs/analysis/2026-09-30-award-quality-report.md`：官網品質自我檢查，依線上 `b216133` 更新。截圖與數據在 `docs/analysis/assets/2026-09-30-award-quality/`。
  - `docs/analysis/2026-09-30-enrollment-analytics-report.md`：招生分析只留階段 1、3，原階段 2 改由入學規格處理。交接檔是 `docs/handoff/2026-09-30-claude-enrollment-analytics.md`。
  - 唯讀檢查腳本 `scripts/audit-public-site.mjs`：擋下所有非 GET 請求。
  - 入學規格 `docs/specs/2026-09-30-website-admissions-design.md` 沒有一起提交，由 `feature/admissions-20261001` 提交；在那之前，報告裡指向它的連結會是斷的。
- **web**（品質報告 E1、E3）：
  - 關於頁五校書籤的字色改成 `--ink`，仁武從 3.96:1 提高到 5.22:1。
  - 關於頁行內校區連結、麵包屑「首頁」用透明偽元素把點擊範圍補到 44px，外觀不變。
- **admin**（招生報告 2.3 節）：
  - 流量面板說明改成「2026/09/30 起也計入內頁」，並提醒跨過這天的期間不能直接比較。
  - 成效漏斗的期間碰到 2026/10/01 以後，就不計官網確認率：自選場次送出即確認，這個比率必為 100%。
- **規則**：寫在 DESIGN.md 同日段落。
- **驗證**（Node 22.23.2）：

  | 項目 | 結果 |
  |---|---|
  | web typecheck | 0 錯誤 |
  | `npm run test:website` | 69 檔 689 項通過 |
  | admin typecheck | 0 錯誤 |
  | admin vitest | 54 檔 700 項通過（新增 1 項 10/01 確認率測試，另外 2 項改用 9 月區間） |
  | admin build | 成功 |

  本機 fixture 用 Playwright 在 390 與 1440 寬量測，修改前後對照：

  | 項目 | 修改前 | 修改後 |
  |---|---|---|
  | 仁武書籤對比 | 3.96:1 | 5.22:1 |
  | 校區連結可點範圍 | 70×32 | 70×44 |
  | 麵包屑「首頁」可點範圍 | 24×44 | 44×44 |

  分校頁「五所校園」的點擊不受影響。

## 2026-10-01 已完成改動併入 main（`merge/all-20261001`）

使用者要求把所有已完成的改動併入 main；家長自選場次一起上線，並裁定正式庫現有的預約資料都是測試資料、不必先備份。

- 基底：本機 `main` `2b05446`，已含全人教育 A2（`f718281`，web 已先單獨部署）與分校首次線稿（`099f03a`）。`03fc267`（09-24 舊的影片畫質提交）由那次合併以 ours 保留歷史，樹不變。
- 併入 `merge/branches-20260930b` 還沒上 main 的兩個提交：`8187ccf`（CI 後端 job 逾時放寬到 30 分）、`bad55bb`（09-30 下午部署紀錄）。
- 併入 `feature/parent-self-booking-20260930`（`0be93ea`，35 個提交，A–D 四階段）。
- 衝突只有 README／deploy/README 的日期段落，兩邊都保留。兩邊都改到的程式檔只有 `web/tests/fixtures/overlay-baseline-20260925.json`（首屏標點／預約 FAQ 文案）與 `web/tests/ux-critique-20260929.spec.ts`（首屏／預約結果圖示），區塊不重疊。
- 契約重產無差異；alembic 單一 head `c7d2e9f4a1b8`。這個 migration 會改寫資料：已有每週規則的 inquiry 校切成 slots，其餘切成 paused（各校到後台「參觀場次」設好後再開放）。
- 沒併：30 週年比稿（PR #12 draft，待業主拍板）、Renovate（PR #1）、`feature/admin-seo-analytics-retention-20260925`（WIP）、Desktop 工作目錄的未提交修改（LINE／Google 登入的舊稿，正式版已在 main；分析報告與招生入學規格草稿）。

驗證（Node 22.23.2）：backend pytest 1090 項（獨立測試庫；第一次在高負載下跑到 99% 後卡住、被 40 分鐘上限中止，重跑 13 分鐘全過）、schema guard、`deploy/tests` 20 項、`contract:check`；web typecheck（0 警告）、vitest 69 檔 689 項；admin typecheck、vitest 54 檔 699 項；production build 的 stack e2e 60 項（2.6 分）。

## 2026-10-01 分校資訊首次從線稿進場（未部署）

`CampusBoard.vue` 的預設中央校與左右預覽一起預畫線稿，首次露出後接續水彩上色、暈開成照片，移除「彩色 → 線稿 → 彩色」的順序。SSR 即標記首張等待狀態，素材載入與動畫期間暫停輪播計時；素材失敗、減少動態、強制色彩及無 JavaScript 保留照片 fallback。手動切換、自動輪播節奏沿用既有設定。

修正位於獨立 worktree `/private/tmp/ivy-campus-first-sketch-20261001`，基底為 `origin/main` 的 `392a41c`；原 Desktop 工作目錄的未提交修改保持不動。

驗證：Node 22，`npm --prefix web run typecheck` 通過；`npm run test:website` 65 檔 668 項通過；Playwright Chrome 桌機 1440×900、手機 390×844、線稿延遲下載、減少動態、強制色彩、無 JavaScript、線稿下載失敗共 7 種情境通過。桌機／手機逐幀確認首次上色前沒有彩色照片閃現，回捲不重播、手動切換正常，無水平溢出或 runtime error。截圖與狀態紀錄在 `output/playwright/campus-first-sketch/`；未測 Safari／iOS 實機，未 push 或部署。

合併驗證：修正提交 `099f03a`，整合本機 `main` 的全人教育 A2 後，typecheck 與 65 檔 665 項測試通過（A2 已移除原轉盤的 3 項測試）。

## 2026-10-01 全人教育右側採用 A2（`feature/whole-person-a2-20261001`，已部署 web）

依使用者指定，只替換 `/about#whole-child` 右側紙轉盤；左頁內容、DOM、列表、來源、連結、尺寸與元素位置保持。新增 `AboutWholePerson.vue`，六個透明圓聚合成全人，8.6 秒播放一次，依最新要求移除下方操作鈕，保留離開視窗暫停；減少動態、強制色彩和無 JS 顯示完成圖。移除原轉盤的樣式、事件、角度工具與 3 項專屬測試。

- 基底：最新取得的 `origin/main` `392a41c`；隔離工作目錄 `/private/tmp/ivy-website-whole-person-a2-20261001`。本機 fixture 預覽 `http://127.0.0.1:3931/about#whole-child`，未連正式 API、未修改 CMS。
- 驗證：Node 22.23.2 typecheck 成功；`npm run test:website` 65 檔 665 項全過（修改前 668 項，差額是已移除的轉盤測試）。Playwright 1440／1024／768／390／320px 左頁 DOM、所有元素尺寸與相對位置一致，無橫向溢出；移除按鈕後已重新驗證桌機與手機自動播放、離屏暫停與續播、減少動態、無 JS，無 page error。未驗 Safari／iOS 實機。
- 本機修改前快照 `versions/before-whole-person-a2-20261001/`（不納入提交）；截圖、左頁基準、檢查腳本與結果 `output/playwright/whole-person-a2/`。已依最新要求只部署 web（`f24d6e9b-cf09-4e5c-9fd6-7e4ecd88fe69`，SUCCESS），線上 release 與桌機手機驗證完成；本次提交保存已上線的六檔差異與紀錄，未 push。API／DB 部署不變，詳細紀錄見 `deploy/README.md`。

## 更早的日期紀錄（2026-09）

2026-09 的 206 段日期紀錄在 [docs/changelog/README-2026-09.md](docs/changelog/README-2026-09.md)。之後每到新的月份，把上個月的段落移到 `docs/changelog/README-YYYY-MM.md`。下面是原型時期的說明。

## 版控

本專案使用 Git，主分支為 `main`。程式碼、素材、設計文件與 `design/` 提案均納入版控；`versions/` 保留導入 Git 前的歷史快照，之後的修改以 commit 記錄。

`preview.html` 是供直接開啟的單檔交付版，也納入版控。修改網站原始檔後，請重新打包，並把原始檔與單檔版一起提交：

```sh
node --check app.js
python3 package_preview.py
git status --short
git diff --stat
git add <本次修改的檔案> preview.html
git diff --cached --stat
git commit -m "說明本次修改"
```

`git add` 中的 `<本次修改的檔案>` 請替換為實際路徑。可用 `git log --oneline` 查看版本紀錄；開新工作前可用 `git switch -c feat/功能名稱` 建立分支。

`.gitignore` 排除本機工具設定、瀏覽器紀錄、`output/` 畫面記錄、快取與環境私密設定。初始設定為本機版控；遠端位置可用 `git remote -v` 查看。

## 已製作

- 左上完整原始 logo、右上預約入口、手機導覽。
- 影片封面、品牌介紹、孩子的一天、分校資訊、A 版近期活動與最新消息，接續頁尾。
- 影片首屏與淡綠品牌區之間的捲動揭幕；原生 CSS 動畫優先，未支援時使用 JavaScript 備援。首屏完全離開時暫停影片，回來時保留使用者的播放／暫停選擇。
- 義華、明華、崇德、國際、仁武各自的介紹頁、官方照片、地址電話、Google 地圖連結。
- 獨立預約頁，先選校、再填寫聯絡資料；從校區進入會自動帶入該校。
- 表單驗證、返回修改、更換校區、示範結果；不發送請求、不存入 localStorage。
- 照片放大，鍵盤 Esc 關閉後將焦點還給原按鈕。

## 待補內容與限制

- 使用者尚無影片。目前呈現義華校照片，並標示「影片封面示意」。不顯示假的播放按鈕。
- 要換影片：將影片放在 assets/，把 app.js 頂部 `HERO_VIDEO_SRC` 設成例如 `assets/campus-film.mp4`。已有靜音、暫停／播放、載入失敗封面，以及減少動態偏好處理。實際影片與各裝置播放相容性需在素材提供後再驗收。
- 五校基本地址、電話、外觀照片取自官方；各校詳細課程、招生名額、收費、參觀時段仍待園方提供。沒有把義華課程或照片當成其他校區資訊。
- 首頁品牌標語是設計提案文案，正式使用前請園方確認。
- 預約只顯示測試結果，不寄信、不連資料庫、不建立實際預約。
- 已於瀏覽器桌面、平板、手機尺寸驗證；尚未於實體 iPhone / Android 做裝置驗收。

## 來源

- 使用者提供：原 prototype `/Users/yilunwu/Downloads/preview.html`、完整常春藤 logo 圖片。
- 常春藤義華校：https://www.ivykids.tw/ （首頁生活照片、教育理念、活動與校園環境）
- 常春藤機構：https://www.ivykidschool.com/ （五校地址電話、明華／崇德／國際／仁武照片）
- 首頁影片呈現參考：https://seasonarts.org/ ，沒有使用其影片或品牌素材。
- 下載照片已轉為 WebP，照片來源見 assets/sources.json。

## 驗證記錄

- JavaScript 語法檢查通過。
- 首頁 375 / 390 / 768 / 1024 / 1440px 無水平溢出。
- 375 / 768 / 1440px 校區頁、選校頁、填表頁無水平溢出。
- 五校路由、各校圖片、各校自動帶入預約入口通過。
- 選校→填表→預覽→修改→更換校區流程通過。
- 無效輸入阻擋、手機空格與連字號正規化、離開後資料清除通過。
- 手機選單展開／關閉、相簿 Esc 關閉／焦點恢復通過。
- 操作檢查中未發現 JavaScript runtime error。

畫面記錄位於 output/playwright/。修改可維護版後，執行 `python3 package_preview.py` 重新產生單檔版本。

## 新增：孩子的一天

首頁「校園生活」現在會進入六片刻的互動故事。直達連結：`#/home/life`。
- 六階段：早安入園、好奇探索、一起用餐、安靜片刻、午後玩耍、帶故事回家。
- 2026-09-18 關於常春藤與孩子的一天之間加了第二道區塊簾幕：往下捲時關於區塊停住並由下往上被擦掉，露出孩子的一天（與首屏 → 關於同一種切換）。
- 2026-09-18 改為拍立得顯影版（`design/day-timeline-directions/` 比稿的 Q 版）：固定影片背景、sticky 大字「常春藤的一天」隨相片靠近淡成底紋、六張隨捲動顯影的相片，點相片或按鈕翻到背面看故事與家長提問。時刻改用官網一日流程。備份 `versions/before-day-polaroid-20260918-160145/`。
- 2026-09-16 曾為橫向文字分頁與開放式圖文雙欄（已被上一項取代）。
- 方向鍵與 Home / End 可切換分頁，Tab 進入故事內容。
- 用餐／午休使用義華教室照片作空間參考並標示待補；日常文字為情境提案，不代表已核定作息。
- 新版的照片及標題起點保持穩定；問答展開不會拉長照片。手機文字分頁可橫向滑動，選取項目會保持可見。
- 2026-09-16 驗證：320／375／390／768／1024／1440px 無橫向溢出，六個片刻面板高度差為 0；問答展開照片尺寸不變，所有主要控制項至少 44px。Home／End、方向鍵、Tab、最後一段返回早安入園正常，`preview.html` 同步重新打包。
- 改版前單檔保存在 `versions/before-day-experience.html`。
- 本次文字分頁改版前備份：`versions/before-day-editorial-20260916-104150/`。

## 字型方向提案

三個方向並排的設計畫布已儲存為私密連結，見 `design/font-directions/README.md`（含連結、子集化字型與產生器）。園方選定後再把字型接進站內。

「關於常春藤」區塊（2026-09-15）：三個方向的畫布在 `design/believe-directions/`（含連結與產生器），採用左文右圖版並已實作進首頁；未採用的方向保留在畫布第二頁。

園方於 2026-09-10 選定方向 B：標題改用 LINE Seed TW（Bold 700、hero 800），字型子集放在 `assets/fonts/`（含說明與重新產生指令），頁尾註明字型來源；`package_preview.py` 會把字型內嵌進單檔版。


## 五校介紹加地圖與社群（2026-09-15，已採用方向 B）

首頁五校卡片與各校「交通與聯絡」頁加入 Google 地圖、LINE 官方帳號、Facebook。三個呈現方向的比較頁仍留在 `design/campus-directions/`（A 地圖清單／B 卡片加地圖抽屜／C 校區分頁）供參考；使用者選定 **B 卡片加地圖抽屜**，已實作進站：

- 首頁五校卡片新增電話下方一列：LINE、Facebook 圓形圖示 + 地圖按鈕；按地圖，卡片下方展開抽屜（免金鑰的 Google 地圖單點嵌入、LINE／Facebook 大按鈕、預約入口）。桌機預設展開義華校；手機需要點擊才展開，且會插在被點的卡片正下方。
- 各校內頁「交通與聯絡」（`#/校區/contact`）從純文字連結改為內嵌 Google 地圖 + LINE／Facebook 按鈕。
- 地圖 iframe 進到視口附近才載入（IntersectionObserver + `data-src`），避免 Google 的 embed 搶走頁面焦點與捲動位置。
- **資料缺口**：只查到義華校的 LINE（`lin.ee/gwl8fnA`）與粉絲專頁（`facebook.com/ivy.kids.fb`）；明華、崇德、國際、仁武的 LINE 官方帳號與各校粉專未查到，畫面上 LINE 以虛線「帳號待補」呈現、Facebook 暫時指向常春藤機構粉專（`facebook.com/ivykid`），不冒用義華帳號。**請園方提供四校的 LINE 與粉專連結，補進 `app.js` 的 `campuses` 物件（`line`／`facebook`／`fbNote`）。**
- Google 地圖目前是免金鑰的單點嵌入，一次只顯示一所；若要五校同框，需園方用 Google「我的地圖」建圖或申請 Maps API 金鑰（見 `design/campus-directions/README.md`）。

## 五校入口重排（2026-09-16）

依設計回饋把首頁「五校介紹」從五張聯絡資料卡改成真正的校園入口；mock-up 畫布 https://claude.ai/artifact/8PpG9rz5rc5UV1VaHfoGas ，工作檔在 `design/campus-entry-mockup/`。

- 五校同寬入口只留照片（4:3、逐張決定裁切位置）＋校名＋地區，整塊是一個連結；地址、電話、社群圓鈕、地圖按鈕、短橫線全部移除，校名不加箭頭。
- 下方常駐「校區位置與聯絡資訊」：校區 tab（滑鼠、方向鍵、點地圖圖釘都能切換）、地址電話、「預約參觀Ｘ校」主鈕、LINE／Facebook 文字連結、五校位置示意地圖（選校放大該校圖釘），右上角「規劃路線」開 Google 導航。沒有收合／展開列，也沒有關閉叉叉。
- 社群圖示重做：36px 細框圓徽章＋標題＋小字說明，取代原本的彩色圓鈕與大膠囊；各校內頁「交通與聯絡」同步換用。
- 首頁的 Google 地圖 iframe 改為 SVG 示意圖（座標來源 `design/campus-directions/`，只留視窗內 14 區，約 10KB）；各校內頁仍保留 Google 單點嵌入。
- 驗證：1440px 無水平溢出、tab／方向鍵／圖釘切換與路線連結同步、無主控台錯誤；`preview.html` 已重新打包。改前快照 `versions/before-campus-directory-20260916-140939/`。規則寫在 DESIGN.md「五校入口重排」。

## 五校分區輪播上站（2026-09-16 下午）

使用者在畫布 https://claude.ai/artifact/8PpG9rz5rc5UV1VaHfoGas 第三頁先選 A3，再改為 **A2 版面＋單一長橢圓軌道**（15:34 定案），並指定照片多些圓角；已照最終版改進首頁，取代中午上站的五校目錄版。

- 標題與引言置中；「← 選校軌道 →」置中：五校在同一條淡灰米底的長橢圓軌道裡，選中的是實心綠膠囊；不分地區（15:38 拿掉地區小標與分組線）。
- 左大照片（4:3、24px 圓角、逐校裁切）＋校區介紹句；右欄先 240px 示意地圖（16px 圓角），再校名地區、地址電話、「預約參觀Ｘ校」主鈕與「認識Ｘ校」校區頁入口、LINE／Facebook 徽章。手機軌道滿版，上一／下一校改到照片圖說列右側。
- 切換：軌道 tab 鍵盤操作、上一／下一校首尾循環、點地圖圖釘；照片預載後 200ms 淡入淡出，減少動態直接換，手動切換時 aria-live 播報目前校區。每 6 秒自動循環五校，依使用者要求移除暫停／播放鈕。滑鼠停留、鍵盤焦點位於區塊內、觸控按住、離開可視範圍或背景分頁時暫停；結束操作後重新計滿 6 秒繼續。減少動態效果時不自動播放。
- 打包器改為替換 `photoSrc` 單一定義；`preview.html` 已重打包，照片、字型皆內嵌。
- 驗證：1440px 與 390px 無水平溢出、無主控台錯誤；tab／方向鍵／上一下一校／圖釘切換後照片、介紹、資訊、地圖、路線、播報全部同步。改前快照 `versions/before-campus-carousel-20260916-152420/`（目錄版）與 `versions/before-campus-a2-20260916-153422/`（A3 版）；規則在 DESIGN.md「五校分區輪播」。


## 最新消息 A 版（2026-09-16）

- 已套用到首頁 `#/home/latest-news`，位置在分校資訊後，接續頁尾；導覽列與頁尾均有最新消息入口。
- 桌面左側三個活動日期卡、右側三則圖文消息；手機改為上下排列，消息使用縮圖加標題。配色、字型與間距延續選定的 A 版。
- 點擊消息或活動會開啟詳情；「所有活動／所有最新消息」提供完整範例清單，可返回清單、Escape 關閉並還原焦點。切換路由時視窗會關閉。
- 消息、日期、活動皆為示意；既有校園圖像不代表該則消息實拍。正式資料待園方提供，沒有報名送出或後端串接。
- `app.js` 的 `homepageNews` 集中管理資料、版面與視窗；`studio.css` 的 `.home-news` / `.hn-*` 為專用樣式。圖片透過 `photoSrc` 內嵌，`preview.html` 已同步打包。
- 五方向比較仍保留於 `design/news-directions/`，首頁情境模式可繼續比較其他方向。
- 驗證：首頁與單檔版各 7 種寬度（1440、1100、1024、901、768、390、375px）皆無水平溢出、破圖或 JavaScript 例外；詳情、返回清單、Escape 焦點、路由往返均通過，單檔版無本機 assets 請求。實際截圖：`output/playwright/home-news-a-{desktop,mobile,context}.png`。

## 首頁收尾調整（2026-09-16）

依園方要求，首頁暫時移除 FAQ 與底部「親自走一趟」預約橫幅，最新消息後直接接頁尾；導覽列的「參觀須知」與頁尾的「常見問題」連結同步移除。頁首預約參觀、預約表單及各分校頁面保留原有功能。`preview.html` 已同步更新。


## 關於常春藤 B2（2026-09-17 定案）

首頁 `#/home/about` 已套用 `design/b-layout-extensions/b2.html` 的錯落雙照片版：保留 SINCE 1997、主標與加長的單段介紹，移除內容上方重複的「關於常春藤」小標。淡綠底上的裝飾大字改為「關於／常春藤」。

背景在導覽列下方固定，文字與照片跟隨頁面捲動；離開此區才一起帶走背景。依園方追加要求，內容上方再留 `32svh`（180–360px）背景，1440×900 時增加 288px；手機使用 `24svh`（160–240px）。既有首屏揭幕效果保留，單檔 `preview.html` 已同步。

驗證：Chromium 100% 視窗尺寸 1920×1080、1440×900、1280×650、1024×768、901×700、768×1024、390×844、375×667、320×568、720×450 無水平溢出、破圖或 JavaScript 例外。捲動 120px 時，背景大字位移 0、主標位移 -120px。原生及模擬不支援 scroll timeline 的 fallback、減少動態、導覽與校區連結往返皆通過；減少動態停用揭幕及背景固定，內容仍完整可讀。Hero 內容高於視窗時維持既有正常閱讀模式。Safari／Firefox 尚未實機驗證。

截圖位於 `output/playwright/home-belief-b2/`。整合前備份：`/private/tmp/ivy-before-belief-b2-20260917-105629/`。
