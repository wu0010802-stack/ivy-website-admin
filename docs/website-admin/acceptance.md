# 官網後台驗收表（Task 11）

依 `docs/superpowers/plans/2026-09-19-website-admin.md` Task 11；每階段結束只填該階段列，其餘標 `not-run` 並註明所屬階段。完整報告見同次交付訊息；本檔只保留可長期追蹤的結論列表。

| ID | 階段 | 驗收情境 | 狀態 | 證據 |
|---|---|---|---|---|
| A18 | A | 1440/1024/390/375px、鍵盤、降動態、無水平溢出 | 通過（2026-09-26 更新） | 48 項 Playwright e2e（4 視口 × SSR 內容/舊路由）全過；`tests/stack/keyboard.spec.ts` 檢查官網與後台在 390／1440px 下 `scrollWidth ≤ clientWidth`，並涵蓋選單/膠囊/dialog 的 Tab／Enter／Escape／焦點返回；`tests/stack/visual.spec.ts` 對後台 5 個關鍵頁面建立像素級 `toHaveScreenshot`（macOS 基準，其他平台略過比對） |
| A19 | A | 原型快照可離線開啟；新版 Nuxt localhost／授權預覽可用，fixture 不會真實提交 | 通過 | `artifacts/prototype-baseline/preview.html`（+ sha256）已備妥；Nuxt localhost 預覽見階段 A 小結；`/preview` 私有草稿殼（見 Task 8 小結）已用 Playwright 驗證未登入拒絕、登入後見草稿、公開站不洩漏 |
| A21 | A | 五校正式路徑、直接開啟／刷新、前進後退、舊 hash 相容、未知校區 404 | 通過 | `tests/e2e/nuxt-rendering.spec.ts`（五校＋首頁 SSR）、`tests/e2e/legacy-routes.spec.ts`（5 項舊 hash 轉址）皆過；未知校區與未知 visit key 均 404 |
| A22 | A | 主要內容在 SSR HTML，禁用 JS 仍可讀；不靠整頁 ClientOnly | 通過 | `javaScriptEnabled:false` 情境下五校＋首頁 heading/內文可讀，`tests/e2e/nuxt-rendering.spec.ts` 6 項通過 |
| A24 | A | 無 hydration mismatch，進出頁清理動畫／影片；私有資產與原始碼不被靜態服務暴露 | 通過（2026-09-26 更新） | `web/public/`＋正式 build 輸出已人工檢查，只有素材與字型，無原始碼／env／design／versions／preview.html；**`tests/stack/hydration.spec.ts` 已建立系統性檢查**：對 10 個公開頁跑 production build 與 `nuxt dev` 兩種模式，斷言 console 沒有 hydration 訊息與 pageerror，並用竄改 SSR HTML 的方式驗證這個檢查真的抓得到 mismatch（不是空測試） |
| A25 | A→B | 階段 A：缺字檢查報告完整 | 完成（部分缺字為已知限制） | `docs/website-admin/baseline.md` §字型缺字檢查 |
| A01 | B | 現有首頁、五校、一天影片與照片卡、探索、消息、FAQ 欄位都有 editor | 通過（2026-09-25 更新） | ContentItem 已有 14 種 kind，涵蓋首頁、五校介紹、一天照片卡（含新增卡與刪卡）、校園探索（視覺化熱點編輯器，可排序）、各校消息與活動（結構化內文）、全站共用常見問題與各校常見問題（逐題啟用）、預約文案、頁尾／網站設定／主選單。影片／照片素材已接媒體庫（見 A04），仍留在 fixture、CMS 沒有對應欄位的只剩品牌名稱與 Logo（2026-09-19 核可鎖定）。詳見各批小結與 `backend/app/content/registry.py` |
| A02 | B | 修改一校不影響另一校；role/scope 在 API 生效 | 通過 | `test_auth_scope.py`、`test_media.py`、`test_permission_table.py` 正負權限測試；2026-09-25 起改為 capability 表＋逐人授權（`booking.export`／`content.shared`），見 `docs/website-admin/operations.md`「權限」 |
| A03 | B | 草稿不可公開；發布／指定版本還原正確；預約不跟著回滾 | 通過（2026-09-25／26 更新） | 單一內容項目版本紀錄與還原（`test_content_revisions.py`）之外，**全站 release 層級的一鍵還原已完成**（`POST /admin/releases/{id}/restore`，限總管理者 `content.release_restore`，寫成新的一筆 release、不刪歷史；有更新版本不能還原時逐項列出原因，不整站部分還原）。送審／核准／退回、過期待審版自動標記已被取代，也已完成（見 A15） |
| A04 | B | 圖片／影片／poster 替換、裁切、引用保護、私有素材、熱點複核 | 部分（2026-09-25／26 更新） | 素材庫已支援：引用記錄版本與欄位路徑（`GET /admin/media/{id}/usages`）、批次替換（先列影響範圍再對每個受影響內容產生新草稿，不自動發布）、封存與待清理（刪除不再立即硬刪檔，定期工作延後清理）、批次上傳（同時最多 2 個）、影片 metadata（時長／寬高／上傳者）、縮圖／大圖／poster 衍生檔路由、版位裁切焦點（0–100，`FocusPicker`）。首屏影片／關於照片／孩子的一天／分校封面與線稿／手機版活動影片等版位已接進 CMS（選填，未設定用內建素材）。既有素材 importer 已做（`import-site-assets`，dry-run 預設）。**熱點複核仍未做**：替換場景圖片後只在 UI 提醒人工重新複核座標，沒有強制流程 |
| A20 | B | web/admin 共用 OpenAPI 型別，fresh setup、Nuxt build/start、admin build、測試可重現 | 通過 | `npm run contract:generate`／`contract:check` 已建立；`contracts/openapi.json` + `contracts/generated/website-api.d.ts` 已產生並委託 admin 的 `UserOut`/`CampusOut`/`MediaAssetOut`/`MediaVariantOut`/`ContentItemOut` 直接引用生成型別，不再手抄；各 kind 的 payload（home_about 等）因後端收 dict 動態驗證，暫時仍手抄，已註解說明 |
| A05 | C | 每校六模式切換，缺連結不啟用，原案件仍存在 | 通過（2026-09-25 更新） | 六種模式（inquiry/line/phone/external/paused/**slots**）皆可啟用；啟用條件擴充為欄位類（LINE／電話／外部網址／暫停說明）與資料類（inquiry／slots 需已發布同意文字，slots 另需可訂場次或每週規則），不符回 `BOOKING_MODE_NOT_READY` 並附原因；切換模式前顯示影響範圍（未結案／待確認／已確認案件數等）並要求二次確認；「原案件仍存在」已測 |
| A07 | C | 表單成功持久化；失敗保留輸入；重送只建一案 | 通過 | 後端 API 側全過（含 10 連線真實併發只建一案）；Nuxt `VisitForm.vue` 接上真實 `POST /public/visit-requests`（idempotency key、slots 選位、同意版本、參觀人數 1–10、409/429/422 錯誤處理且失敗不清空欄位） |
| A08 | C | 舊 config version 被拒；成功後重播仍回原結果 | 通過 | `test_stale_config_version_rejected_then_switch_to_line`、`test_request_retry_is_same_case` |
| A09 | D | 最後一格並發只有一組；取消／改期／到期無超收 | 通過（2026-09-25 更新） | 最後名額真實 PostgreSQL 併發（`test_one_slot_cannot_accept_two_families`）、取消釋放、改期回滾皆已測；**占位到期自動釋放已由 API 內建定期工作觸發**（`app/workers/maintenance.py`，production 每 60 秒一輪），不需另外排程；`completed`／`no_show` 也保留已占用名額，不能再排進已開始的場次 |
| A10 | D | 規則、例外日、提前時間、滿額、手動／自動確認 | 通過（2026-09-25 更新） | 每週規則、休假例外日、依規則自動延展時段（定期工作每天補到最遠開放天數，跳過休假與已開始場次）、取消休假重開時段並補上當天場次、滿額拒絕、容量下限保護皆已測；手動／自動確認（`slots_auto_confirm`）沿用既有機制 |
| A11 | D | 人工補登、聯絡、承辦、狀態、日曆、匯出同源且有權限 | 通過 | 人工確認/取消/未到場/聯絡紀錄/CSV 匯出（含公式注入防護，且改依畫面篩選匯出）；人工補登（phone/line/walk_in/external，idempotency）、指派承辦人與「我的案件」篩選、接待月曆、完成參觀；2026-09-25 起接待人員可處理案件（`booking.handle`），CSV 匯出改逐人授權（`booking.export`） |
| A06, A16 | C | CTA 一致／SEO | 部分 | 各校 CTA（`BookingCta`／`useCampusBooking`）即時讀 booking-config；`resolveBookingAction` 六種模式的判斷邏輯有 Vitest 單元測試全覆蓋（`web/tests/booking-action.spec.ts`），但**瀏覽器 e2e 目前只涵蓋 paused 與未知校區**（`tests/e2e/public-site.spec.ts`）＋ `tests/stack/booking-flow.spec.ts` 端到端跑過 slots／inquiry 兩種模式的完整送出流程；line/phone/external 三種模式沒有專門的瀏覽器 e2e，這點原表過度宣稱，此處更正。SEO（canonical／OG／robots meta）依 `indexingEnabled`／`siteOrigin`**及後台「網站標題與電話」的收錄開關（`allow_indexing`，2026-09-26 起才真的生效）**動態產生，`/visit`／`/preview` 一律 noindex，`robots.txt`／`sitemap.xml`／`llms.txt` 依索引條件切換 |
| A12 | D | 失敗通知可重試、無重複、案件不丟失、worker 可恢復 | 通過（2026-09-25 更新） | `test_notifications.py`：寄送失敗案件保留、重試後成功且只有一份對應通知、達上限標記 failed、worker 租約過期後可被其他 worker 重新認領；**新增後台「站內通知 → 寄送失敗」區塊與 `POST /admin/notification-outbox/{id}/retry`／`/retry`（批次）可人工重試**，以及 CLI `requeue-notifications`；另新增「即將參觀」「逾期未處理」兩種提醒，寄送當下重新判斷是否仍成立 |
| A13 | D | 家長只讀自己的案件，安全取消／申請改期／token 過期 | 通過 | `test_parent_access.py`：token 換 session、家長間 session 互不可見、自助取消、改期申請待核准前原時段不變、無效 token 拒絕；後台可產生／複製／重新產生／撤銷家長管理連結（`/visit/manage#token=…`），家長取消／改期期限改為各校可設定（1–336 小時，預設 24） |
| A15 | D | 審核、排程、到期下架、併發編輯與權限失效正確 | 通過（2026-09-25／26 更新） | 消息／活動上下架（`test_home_news.py`）之外，**內容送審／核准／退回已完成**（過期待審版自動標記 `superseded`，送審通知可核准的人、核准或退回通知送審者）；**整份內容排程發布已完成**，到期時若官網已是更新版本會標成「已略過」而不蓋回舊內容，失敗或略過都通知排程者並列在總覽；全站 release 還原見 A03 |
| A14 | D | 點擊和預約分開；Dashboard 與分析不漏校或 PII | 通過（2026-09-25 更新） | `test_operations.py`：偽造成效事件拒絕、點擊不影響 request_created 計數、dashboard/匯出跨校隔離、稽核紀錄不含個資；成效漏斗新增 `visit_cancelled`（含原因）、日期區間、依來源／「從哪裡知道我們」分組；公開點擊事件改用 `event_id` 去重＋入口代碼白名單 |
| A17 | D | 保存政策 dry-run／匿名化、備份還原有實測 | 通過（2026-09-25／26 更新） | dry-run 不改資料、真正執行預設關閉、對真實隔離測試 DB + 測試媒體做過備份/還原演練；**保存政策已改為後台可設定天數並持久化**（`retention_policies`，依結案時間起算，未結案案件一律不清），有清理紀錄與定期工作自動清理開關（兩個開關都要開才會自動跑） |
| A23 | C | 發布後新 SSR／刷新／站內換頁讀新 release；hydrate 不重複讀取；無跨 request 私密資料 | 部分（2026-09-25／26 更新） | `tests/e2e/release-freshness.spec.ts` 真的發布一版新 revision，驗證新 HTTP 請求／重新整理／站內換頁都讀到新內容；CMS content kind 已擴充到 14 種（見 A01），新鮮度機制對所有 kind 一致（同一個 `usePublishedSite`／`applyContentOverlay`）；`/preview` 走獨立 client-only 殼，SSR 不輸出任何管理端資料，`tests/stack/hydration.spec.ts`（2026-09-26 新增）用竄改 SSR HTML 驗證能抓到 mismatch，並對 10 個公開頁檢查 console 無 hydration 訊息 |

## 階段 A 小結（2026-09-19）

| 項目 | 狀態 | 備註 |
|---|---|---|
| A18 四視口/鍵盤/降動態/無水平溢出 | 部分 | 48 項 Playwright e2e（4 視口 × SSR 內容/舊路由）全過；**尚未**建立 `toHaveScreenshot` 像素回歸測試（門檻 maxDiffPixelRatio 0.01），僅人工截圖比對 |
| A19 原型快照離線可開 + Nuxt 預覽可用 | 部分 | `preview.html` 快照與 checksum 已備妥；Nuxt `npm run dev`/`start` 本機可用且已驗證；私有登入草稿預覽屬 Task 8（階段 C），此階段未做 |
| A21 五校正式路徑/前進後退/舊 hash/未知 404 | 通過 | `/campuses/{key}` 五校皆可達；未知校區與未知 visit key 均 404；舊 hash 白名單轉址 5 項 e2e 全過 |
| A22 SSR 主要內容禁用 JS 可讀 | 通過 | `javaScriptEnabled:false` 情境下五校＋首頁 heading/內文可讀，6 項 e2e 通過 |
| A24 無 hydration mismatch / 私有資產不外洩 | 部分 | dev/start log 未見 hydration 警告；**未做**「原始碼/私有素材不可被靜態服務讀到」的邊界測試 |
| A25 缺字檢查（階段 A 範圍） | 通過 | 見上方「字型缺字檢查」，已知限制已記錄，未默默退回系統字（沿用子集現況） |

**原型凍結點**：commit `63a0c05`（2026-09-19，`feat(website-admin): 階段 A - Nuxt 官網骨架、後台殼、獨立 API 基礎`）。根目錄 vanilla 檔案（`index.html`/`app.js`/`styles.css`/`studio.css`/`preview.html`）未修改。

**使用者親自看過同意**：**已同意**（2026-09-19，使用者確認進入階段 B）。之後所有設計迭代改在 `web/`，不再回寫根目錄。

## 階段 B 小結（2026-09-19，Task 3–5）

### Task 3 帳號與分校作用範圍 — 完成並測試

cookie session（hash 存庫）、bcrypt 密碼雜湊、CSRF double-submit、Origin 檢查、登入限流（10 次/5 分鐘）、`require_scope()` 權限助手（capability + campus scope，越權物件統一回 404，同一路由 super_admin 可讀已用 `test_super_admin_can_read_any_campus` 覆蓋，不是靠「所有人都 404」假通過）。互動式 `bootstrap-admin`（密碼不進 log/argv）、`seed --dry-run`（重跑不覆寫）。admin 前端登入頁與使用者管理頁完成，並修掉一個真的會擋住操作的 bug：重新整理頁面後 CSRF token 遺失導致所有變更請求 403，現在 `/auth/me` 一併回傳目前 session 的 csrf_token。

**13 項 pytest 全過**：`cd backend && uv run pytest tests/test_auth_scope.py -q`（執行前不要 `source .env.example` 進同一個 shell，會把 `WEBSITE_ENABLE_FIXTURE=true` 等值污染進測試環境，導致與情境無關的 3 個測試假失敗——這是本機殼層環境變數外洩，不是程式碼問題，已記錄避免下次誤判）。

### Task 4 素材庫 — 完成並測試（缺同步字型置換）

本機 storage adapter（隨機 key，不信任原始檔名／路徑）、真實解碼驗證（Pillow `verify()`+`load()`，MP4 magic bytes，擋偽裝副檔名攻擊）、大小限制、跨校隔離（含共用素材 campus_key=null 對所有角色可見）、usage 引用保護（`MEDIA_IN_USE` 409）、替換一律產生新 asset、舊版不變、其他引用者不受影響。ffmpeg 抽 PNG 影格＋Pillow 轉 WebP 產生 poster（本機 ffmpeg 8.x 無 libwebp，未假設 ffmpeg 能直接輸出 webp）。**10 項 pytest 全過**：`uv run pytest tests/test_media.py -q`。

**未完成**：完整 LINE Seed TW Bold／ExtraBold 轉 woff2（規格 3.1.1 要求的階段 B 前置）——原始 OTF 不在本機，無法自行補字，這是外部依賴阻擋項，需使用者提供字型檔案。裁切焦點（crop_focus_x/y）欄位已在 API／DB 但沒有 admin UI 可操作。既有素材（logo、五校照片、hero/day 影片）的 dry-run importer 未實作。

### Task 5 內容編輯與發布 — 範圍縮減到單一內容示範，端到端跑通

只實作了 `home_about`（首頁「關於常春藤」文字：標題／SINCE 標籤／內文／說明文字）一種 ContentItem kind，這是刻意縮小的範圍，用來把「草稿→版本衝突檢查→發布→SiteRelease 原子切換→公開 API→Nuxt 讀到」整條路徑做扎實，而不是把 11 種內容都做成半成品。**8 項 pytest 全過**（草稿不影響公開站、發布後 release 穩定、之後編輯不影響已發布版本、`expected_version` 衝突回 409、分校不能編共用內容回 403、`javascript:` 網址 schema 拒絕）。

發布交易：鎖 `site_state` 單列 → 讀目前 release 的 manifest → 只替換這個 content item 的 entry → 建新 `site_release` → 原子切換指標，其他內容項完全不受影響（其餘尚未實作 content kind 不影響此機制的正確性）。

**Nuxt 接線（階段 B 展示用最小版，非 Task 8 完整規格）**：`web/app/composables/usePublishedSite.ts` 仍以 fixture 為主要來源，但 `home.about` 的四個文字欄位改讀 `GET /api/website/v1/public/site`（經 `web/server/api/public-site.get.ts` 代理），讀不到或後端未發布時安靜退回 fixture。已用 Playwright 實際跑過：admin UI 登入 → 「首頁內容」頁編輯標題 → 儲存草稿 → 發布 → 不重啟 Nuxt、直接重新整理首頁就看到新文字；改完立即改回原文，未留下示範文字在資料庫裡。這**滿足階段 B 閘門「園方能在本機後台改一段文案並發布到 Nuxt 站」的字面要求**，但不是 Task 8 要求的完整 CMS 接線——沒有 SSR 新鮮度多請求測試、沒有私有草稿預覽、其餘 10 種內容仍是靜態 fixture，這些留給 Task 8（階段 C）。

已用 `python -m app.cli content-seed-from-fixture ../content/site-fixture.json` 把 fixture 現有文案灌成第一筆已發布 revision，避免部署後首頁文字整段消失。

### 本機驗證指令（實際跑過，非僅列出）

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 39 passed
cd web && npm run typecheck && npm run test:unit                 # nuxt typecheck 過；12 passed
cd admin && npm run typecheck && npm run build                   # 都過
```

### 尚缺／已知限制（誠實列出，不算已完成）

- 完整字型檔（階段 B 前置，規格 3.1.1）：需使用者提供 LINE Seed TW 原始檔，本機無法自行生成，**外部阻擋項，仍未解決**。
- 除 `home_about`／`home_hero`／`site_footer` 外的其餘 8 種內容（五校介紹、一天照片卡、探索熱點、FAQ、消息/活動、siteMeta、預約設定文案）仍是 Nuxt 端靜態 fixture，沒有 admin editor，也沒有寫進 typed content 系統。
- 審核流程／排程發布／版本還原：階段 D 範圍，未做。
- 素材庫裁切焦點（crop_focus_x/y）與既有素材 dry-run importer 未做。
- 沒有對外發送任何通知、沒有 push、沒有部署；所有資料庫操作都在隔離的 `ivy_website_dev`/`ivy_website_test`。

## 階段 B 補缺口小結（2026-09-19，使用者要求「先補階段 B 缺口，再進 Task 6」）

- **內容系統通用化**：`backend/app/content` 從硬編碼 `home-about` 改成 `CONTENT_KIND_REGISTRY` 註冊表驅動的通用路由（`/admin/content-items/{kind}`），新增 `home_hero`（首頁 Hero 文案）、`site_footer`（頁尾標語）兩個 kind，皆為純文字欄位、無網址（避免 XSS 風險欄位）。發布交易機制不變，其他內容項不受影響。12 項 content 測試全過（含新 kind 的 roundtrip 與 `home_hero.copy_lines` 行數上限驗證）。
- **素材庫 admin UI**：新增 `admin/src/views/MediaLibraryView.vue`（列表、縮圖預覽、上傳對話框、刪除，含引用中素材禁止刪除的前端提示）與 `admin/src/api/client.ts` 的 `upload()`／`mediaFileUrl()`。已用 Playwright 對真實後端跑過上傳→縮圖顯示→刪除→列表清空的完整流程。
- **共用 OpenAPI 型別（A20）**：`backend/scripts/export_openapi.py` 匯出 schema、根目錄 `npm run contract:generate`／`contract:check`（用 `openapi-typescript` 產生 `contracts/generated/website-api.d.ts`）。admin 的 `UserOut`/`CampusOut`/`MediaAssetOut`/`MediaVariantOut`/`ContentItemOut` 已改為直接引用生成型別。
- **修掉一個真的會讓後台看起來像英文站的 bug**：Element Plus 預設語系是英文，`el-message-box` 的確認對話框顯示「OK」/「Cancel」，跟全站繁體中文不一致；已在 `main.ts` 掛上 `zh-tw` locale，Playwright 實測確認對話框已變成「確定」/「取消」。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 43 passed
cd web && npm run typecheck && npm run test:unit                 # 過；12 passed
cd admin && npm run typecheck && npm run build                   # 都過
npm run contract:check                                           # 契約與型別皆一致
```

**仍未解決**：完整字型檔（外部阻擋，需使用者提供原始檔）、裁切焦點 UI、既有素材 dry-run importer、其餘 8 種內容 editor、版本還原、審核流程——這些留給階段 C/D 或使用者決定是否要在階段 B 再補。

## Task 6 小結（2026-09-19，階段 C 起點：各校預約模式與真實需求提交）

依計畫 Task 6 範圍（不含 slots）：

- `backend/app/booking`：`BookingConfig`（每校一列，樂觀鎖 `version`）、`VisitRequest`（`(campus_key, idempotency_key)` 唯一鍵 + `payload_hash` 判斷重播內容是否相同）、`VisitRequestEvent`（歷程，目前只寫 created）、`OutboxMessage`（本階段只寫入，不發送）。
- 模式驗證：`line`/`phone`/`external` 分別要求對應聯絡欄位非空才能啟用；`slots` enum 保留但更新時一律拒絕（`BOOKING_MODE_FIELD_MISSING`），符合「階段 C 不含 slots」。
- 公開提交交易：查重播 → 鎖 `booking_config` 列 → 重驗 `config_version`（不符回 `BOOKING_CONFIG_CHANGED`）→ 重驗模式是否為 `inquiry`（其餘模式回 `BOOKING_UNAVAILABLE`）→ 寫入案件/歷程/outbox → commit。
- **抓到並修一個真的會在正式流量下爆炸的併發 bug**：idempotency 的「查重播」與「鎖設定列」之間有時間差，兩個真正同時的請求都可能通過「查無既有案件」檢查，接著各自嘗試 INSERT 同一組 `(campus_key, idempotency_key)`，其中一個會撞唯一鍵約束丟 `IntegrityError`。原本這個例外沒有被接住，會讓其中一個請求收到 500。已加上 catch：撞到唯一鍵時 rollback 並重新查詢既有案件，安全地當成重播處理。用 10 個獨立連線真的同時送出同一個 idempotency key 驗證過，只有 1 筆 `201`、其餘 `200`，且只有一個 `receipt_id`。
- `web/app/utils/booking-action.ts`：型別化 `resolveBookingAction(campusKey, config)`，涵蓋未選校／inquiry／line／phone／external／paused／slots（視同尚未開放），不寫死任何校的聯絡方式；11 項 Vitest 全過。
- `admin/src/views/BookingSettingsView.vue`：各校預約模式切換畫面，依模式動態顯示對應欄位，樂觀鎖衝突會提示並自動重新載入。已用 Playwright 對真實後端跑過切換模式並儲存成功的流程。

**22 項 pytest 全過**（`test_booking_modes.py` 21 項 + `test_booking_concurrency.py` 2 項，含上述真實 PostgreSQL 併發驗證）。

**本次刻意不做（屬 Task 8／Task 7 範圍，避免跨越任務邊界搶做）**：
- Nuxt `VisitForm.vue` 尚未接上真實 `POST /public/visit-requests`，目前仍是階段 A 就有的純前端示範表單；把所有站內 CTA 接上 `resolveBookingAction` 與真實設定 API 是 Task 8「先接公開內容...再接所有 CTA」的範圍。
- `slots` 容量／時段、接待工作台、狀態機（取消/改期/到期）屬 Task 7（階段 D），開工前計畫要求先跟園方確認是否要用 slots。
- 通知 worker 真的寄送 outbox 訊息屬 Task 9（階段 D）；本階段 outbox 只保證交易內寫入正確。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 66 passed
cd web && npm run typecheck && npm run test:unit                 # 過；23 passed
cd admin && npm run typecheck && npm run build                   # 都過
npm run contract:check                                           # 契約與型別皆一致
```

## Task 7 小結（2026-09-21，容量、時段、狀態機與接待工作台；使用者確認要啟用 slots）

範圍依計畫 Task 7，但排除自動排程（週期規則產生器、占位到期釋放——屬 Task 9 worker）：

- `backend/app/booking`：新增 `VisitSlot`（單次時段，分校管理者手動建立）、`VisitContactNote`（每次聯絡獨立一筆，不覆寫歷史）；`VisitRequest` 增加 `slot_id`／`assigned_staff_id`／`confirmed_at`／`cancelled_at`／`follow_up_at`。名額用「即時 COUNT 目前 confirmed 案件數」而非可變計數器計算，取消重試天然不會重複釋放名額。
- `slot_service.py`：建立時段、依日期區間查詢（限制最多 62 天，過寬回 `QUERY_RANGE_TOO_WIDE`）、降低容量時若已低於目前確認數則拒絕（`CAPACITY_BELOW_BOOKED`，不自動取消任何案件）。
- `workflow_service.py`：`confirm_with_slot`（inquiry 人工確認進時段，confirmed 必須有 slot）、`cancel`（冪等，重複呼叫安全）、`mark_no_show`／`mark_completed`（狀態機檢查，非法轉換回 `INVALID_TRANSITION`）、`reschedule`（固定用 UUID 字串排序鎖新舊時段避免 deadlock，新時段滿額則整筆回滾、原時段完全不受影響）。
- `submit_visit_request` 擴充：`mode=slots` 時公開提交直接帶 `slot_id`，同一支交易鎖住時段列、即時計算已確認數、滿額回 `SLOT_FULL`，不足才建立為 `confirmed` 狀態案件——跟 `mode=inquiry` 共用同一套 idempotency／config_version 重驗邏輯，沒有另外複製一份判斷。
- **真實 PostgreSQL 併發驗證（計畫明確要求）**：`test_one_slot_cannot_accept_two_families` 用兩個獨立連線同時對容量為 1 的時段送出不同 idempotency key 的請求，斷言只有一個 201、一個 409 `SLOT_FULL`，且資料庫查詢確認只有一筆真的佔用；另外 Task 6 遺留的併發安全網（IntegrityError 恢復）在此情境下不會被觸發，因為時段列的 `FOR UPDATE` 鎖本身就正確序列化了兩個請求的容量檢查。
- CSV 匯出：`_safe_cell()` 對開頭是 `= + - @` 的欄位加前導單引號，防公式注入；權限與校區 filter 沿用既有 `require_scope`。
- admin UI 三個新畫面：`VisitSlotsView`（時段建立／容量調整／關閉重開，用日期區間查詢取代真正的月曆元件）、`VisitRequestsView`（列表、校區/狀態篩選、分頁、匯出按鈕）、`VisitDetailView`（詳情、選時段確認、取消、標記未到場、聯絡紀錄）。已用 Playwright 對真實三個服務跑過：建立時段 → API 送出 inquiry → 列表看到案件 → 詳情頁選時段確認 → 狀態變成 confirmed。

**15 項新增 pytest 全過**（`test_visit_workflow.py` 14 項 + `test_booking_concurrency.py` 新增 1 項最後名額併發測試），backend 累計 **81 項全過**。

**本次刻意不做（屬 Task 8／Task 9 範圍）**：
- 週期規則自動產生時段、例外日（國定假日等）、占位到期自動釋放——這些是 Task 9 排程 worker 的工作，計畫明講「各自使用相同 service,不複製業務判斷」，屬於在既有 `slot_service`/`workflow_service` 之上加排程觸發，暫不提前做。
- 真正的月曆視覺化元件（目前是清單 + 日期區間篩選）。
- Nuxt 端仍未接上 slots 模式的公開預約 UI（選時段、送出）——屬 Task 8。
- 通知（確認/取消/改期發信或站內通知）：outbox 機制已就緒但實際寄送屬 Task 9。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 81 passed
cd admin && npm run typecheck && npm run build                   # 都過
npm run contract:check                                           # 契約與型別皆一致
```

## Task 8 小結（2026-09-21，Nuxt CMS 接線、SSR 更新與私有預覽；接在 Task 9/10 之後補做）

依計畫 Task 8，範圍受限於目前後端 `CONTENT_KIND_REGISTRY` 只有 `home_about`/`home_hero`/`site_footer` 三種 kind 真的接了 CMS（其餘內容仍是 fixture，如實反映在下列各項）：

- **同源 proxy 從 dev-only 改成正式路由**：原本靠 `nitro.devProxy` 轉發 `/api/website/v1/**`，但那個設定只在 `nuxt dev` 生效，正式 `build`/`start` 完全不會用到，等於上線後所有站內 API 呼叫都會 404。已改成 `web/server/routes/api/website/v1/[...].ts`（`proxyRequest()` catch-all），並用真的 production build 在 8000/8010/3010/3011 等埠實測驗證 dev/build 兩種模式行為一致。
- **CTA 真實接線**：`BookingCta.vue`／`useCampusBooking.ts` 讓各校 CTA 即時讀後端 `booking-config`（`useAsyncData` 依 key 切換自動取消切校時的舊請求），涵蓋 inquiry/line/phone/external/paused 五種模式；LINE/電話/外部連結點擊會回報 `cta_click_*` 分析事件（失敗安靜忽略，不擋原本要做的事）。`VisitForm.vue` 全面重寫成真的 `POST /public/visit-requests`（含 idempotency key、slots 模式選位、`BOOKING_CONFIG_CHANGED`/`SLOT_FULL`/429/422 錯誤處理，失敗不清空已填欄位）。**抓到並修一個會誤導家長的舊文案**：表單原本沿用階段 A 的示範文字（「不會送出/不會建立預約」「示範完成，尚未送出預約」），現在表單已經打真的後端，這段話會讓家長誤以為沒真的預約成功——已移除，改成依模式（inquiry/slots）動態顯示「已收到需求」／「預約成立」。
- **SEO／sitemap／robots**：首頁與分校頁加 `useSeoMeta`（canonical／OG／robots meta），依 `NUXT_PUBLIC_INDEXING_ENABLED`＋`NUXT_PUBLIC_SITE_ORIGIN` 動態開關；新增 `server/routes/{robots.txt,sitemap.xml}.get.ts`，索引未啟用時全站 `Disallow: /`、sitemap 回 404，啟用時才列出五校網址；`/visit`、`/preview` 一律 noindex 跟索引開關無關。**抓到一個會洩漏索引的舊檔**：`web/public/robots.txt` 是一個內容為「全站放行」的靜態檔，會蓋掉上述動態路由（Nitro 靜態檔優先）——已刪除。
- **`/preview` 私有草稿殼**：client-only、先打 `/auth/me` 確認管理 session（401 視為未授權，不嘗試繞過），再讀 `/admin/content-items/{kind}` 的最新（可能未發布）revision，疊在 fixture 上顯示；回應帶 `Cache-Control: private, no-store`＋`X-Robots-Tag: noindex, nofollow`。疊資料邏輯抽成純函式 `applyContentOverlay`（`web/app/utils/content-overlay.ts`），`usePublishedSite`／`useDraftPreview` 共用，也讓它能脫離 Nuxt runtime直接單元測試。
- **503／無假資料 fallback**：原本 `usePublishedSite`／`server/api/public-site.get.ts` 把後端錯誤（尚無可用內容的 503、或後端直接連不上）吞掉改回傳 `null`，公開頁面因此安靜退回 fixture、用 HTTP 200 假裝正常——**這是一個真的違反計畫「無假資料 fallback」規則的問題，已修**：`contentMode=fixture`（本機示範）才單純讀 fixture 不打後端，其他模式後端出錯就丟出對應狀態碼，頁面用新的 `assertPublishedSite()` 轉成 fatal error，SSR 真的回 503。401 這條原本就有做（`/preview` 的 `auth/me` 檢查），不需額外補。
- **SSR 發布新鮮度**：`tests/e2e/release-freshness.spec.ts` 真的發布一版新 `home_hero` revision，驗證新 HTTP 請求／重新整理／站內換頁都讀到新內容。**過程中抓到一個真的快取缺口**：`usePublishedSite` 的 `useAsyncData` 用固定字串當 key，站內換頁不會重新抓資料，會卡在舊內容——已補上 `watch: [route.fullPath]` 讓每次換頁都重新抓。

**新增測試**：`web/tests/content.spec.ts`（`applyContentOverlay` 純函式，6 案例）；`tests/e2e/{public-site,release-freshness,private-preview,service-unavailable}.spec.ts`（共 15 案例，含用獨立 Nuxt instance 指向不存在後端驗證 503、不影響其他平行測試共用的 8000/3000 埠）。三支需要登入的 e2e 都用 CLI 互動式 `bootstrap-admin`（走 stdin，不繞過密碼不接命令列參數的安全設計）建測試帳號，afterAll 復原內容版本並刪除測試帳號。

**本次刻意不做（誠實列出）**：
- 後端 `CONTENT_KIND_REGISTRY` 仍只有 3 種 kind，五校介紹／FAQ／孩子的一天等內容尚未搬進 CMS，`/preview` 與新鮮度驗證的範圍因此也只涵蓋這 3 項——這是後端目前的真實能力邊界，不是本輪漏做。
- hydration mismatch 沒有自動化檢查（僅人工看 log）。
- 沒有像素級視覺回歸測試（`toHaveScreenshot`），沿用既有的人工截圖比對慣例。

**本機驗證（實際跑過）**：
```bash
cd web && npm run typecheck && npm run test:unit    # 過；29 passed
cd web && npm run build                             # production build 成功
# 手動起 backend(8000/8010) + Nuxt production build(3000/3010/3011) 反覆驗證
npx playwright test --project=desktop-1440          # 27 passed（含既有 12 項）
```

## Task 9 小結（2026-09-21，通知 worker、家長安全管理；避開使用者正在動的 web/）

依使用者要求本輪只動 `backend/`／`admin/`，不碰 `web/`（使用者當時正在做首頁優化）：

- **outbox worker（真正可執行，不只是概念）**：擴充既有 `OutboxMessage` 加 `status/attempts/next_attempt_at/error_code/leased_by/leased_until`。`app/workers/lease_service.py` 用 `SELECT ... FOR UPDATE SKIP LOCKED` 認領工作（pending 或租約已過期的 leased，後者就是 worker crash 恢復機制）；失敗記 attempt 並用固定退避表計算下次重試時間，達 `MAX_ATTEMPTS=5` 才標記 `failed` 供人工重試。`python -m app.cli process-notifications` 是可以真的跑的 worker 指令（單次批次，非常駐 daemon——8GB RAM 機器上避免額外常駐程序）。
- **Email adapter**：`LocalSinkEmailAdapter` 沒設定 `WEBSITE_NOTIFICATION_EMAIL_SINK_DIR` 時建構直接拋 `EmailNotConfigured`，CLI 如實印「尚未設定」並跳過，不假裝寄出。實測用真的本機資料夾當 sink，`process-notifications` 執行後檢查資料夾真的生出一份 JSON 信件檔。
- **站內通知＋收件人即時計算**：`get_notification_recipients()` 每次都即時查目前啟用中的 super_admin／該校 campus_admin，不在建立通知時就把收件人清單寫死——帳號停權或改 scope 後自然收不到後續通知，已用 `test_inactive_user_excluded_from_recipients` 驗證。
- **家長安全連結**：`ParentAccessToken` 只存 hash，原始 token 只在 admin 產生連結那一刻回傳一次。`exchange` 換發獨立的 `ParentSession`（跟員工登入 session 完全分開的 cookie），家長只能讀/取消自己的案件（用 `test_parent_session_isolated_between_families` 驗證兩個家長互相看不到對方）。改期走「先建待核准紀錄，不動時段，園方核准才真的呼叫 `workflow_service.reschedule`」——避免家長自助改期繞過容量鎖。
- **admin UI**：新增 `NotificationsView.vue`（站內通知列表、標記已讀、待核准改期申請的核准/退回）。已用 Playwright 對真實三個服務（backend + admin + 本機 mail sink）跑過完整鏈路：送出案件 → CLI 跑 worker → 本機信件檔真的生成 → admin 通知列表看到 → 標記已讀。

**11 項新增 pytest 全過**（`test_notifications.py` 6 項、`test_parent_access.py` 5 項），backend 累計 **92 項全過**。

**本次刻意不做**：
- 週期性排程觸發（cron/常駐 daemon 呼叫 `process-notifications`）——指令本身可用，但排程本身交給部署環境的 cron，不在這裡內建常駐 worker process。
- Nuxt 端 `/visit/manage` 頁面（讀 token、`replaceState` 清除、顯示取消/改期表單）——這是 `web/` 範圍，使用者當下在做首頁優化，本輪明確避開。
- 內容審核流程與排程發布（屬 Task 10／內容模組階段 D 範圍，非通知 worker 範圍）。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 92 passed
cd admin && npm run typecheck && npm run build                   # 都過
npm run contract:check                                           # 契約與型別皆一致
# 真實 worker 執行（本機 mail sink）：
WEBSITE_NOTIFICATION_EMAIL_SINK_DIR=/tmp/xxx uv run python -m app.cli process-notifications
```

## Task 10 小結（2026-09-21，營運、統計、維護與完整契約）

依計畫 Task 10（僅動 `backend/`／`admin/`，避開使用者的 `web/` 工作）：

- **成效統計防偽造**：`AnalyticsEventType` 分兩類——點擊類（`cta_click_line/phone/external`）可由公開端點回報且有限流（60 秒 20 次）；成效類（`request_created`/`visit_confirmed`/`visit_completed`）只能由 `submit_visit_request`/`confirm_with_slot`/`mark_completed` 內部呼叫，公開端點直接送這幾種事件會被 `EventTypeNotAllowed` 拒絕（400）。已用測試驗證偽造請求不會改變統計數字。
- **Dashboard／匯出跨校隔離**：`get_dashboard_summary()` 依呼叫者的 `campus_scopes` 決定範圍，super_admin 才看得到全部；CSV 匯出沿用既有 `require_scope`，非授權校區一律 404。
- **稽核紀錄（部分覆蓋，誠實標註）**：`AuditLogEntry` 記錄 `booking_config.update`／`user.set_active`／`content.publish`／`site_settings.update` 四種操作，`metadata_json` 主動過濾 `phone`/`parent_name`/`password`/`email`/`questions` 等欄位，測試驗證電話號碼不會出現在稽核紀錄裡。**其餘管理操作（素材刪除、時段調整等）目前沒有寫入稽核**，見 `docs/website-admin/operations.md`。
- **保存政策**：只清理 `cancelled`/`no_show` 且超過天數的案件（`new`/`confirmed` 不會被動到，即使案件很舊），改成匿名化文字，不動狀態/時段/預約設定。`POST /admin/retention/run` 預設回 403，需設定 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true` 才會真的執行——避免意外清掉個資。
- **備份／還原（真實演練，非紙上談兵）**：`scripts/backup_website.py`／`scripts/restore_website.py` 用 `pg_dump`/`psql`，還原前檢查 `WEBSITE_ENVIRONMENT=test` 且 DSN 通過既有隔離驗證。已對 `ivy_website_test`（含真實媒體檔）備份，還原到全新的 `ivy_website_test_restore_check` 資料庫並確認 schema／五校資料正確，之後已清掉這個臨時資料庫。
- **共用型別契約**：`contract:generate`/`contract:check` 持續維護，Task 10 結束時再次確認一致。
- admin 新增 `DashboardView`（今日參觀/待跟進/待發布/通知失敗/缺設定校區）、`AnalyticsView`（成效漏斗）、`AuditView`（操作紀錄）、`PoliciesView`（SEO 設定＋保存政策 dry-run/執行）；登入後導向頁改成新的「總覽」（原本寫死導去使用者管理，屬本輪抓到的 bug，已修並重新驗證）。

**14 項新增 pytest 全過**（`test_operations.py`），backend 累計 **106 項全過**。

**刻意不做**：內容審核流程（送審/核准/退回）與排程發布（屬階段 D 擴充範圍，非「營運維護」核心）；週期性 cron 排程本身（已交付可執行指令，排程留給部署環境）；全面稽核覆蓋（只涵蓋 4 種高風險操作）。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 106 passed
cd admin && npm run typecheck && npm run build                   # 都過
npm run contract:check                                           # 契約與型別皆一致
# 備份還原演練：
uv run python scripts/backup_website.py /tmp/xxx
WEBSITE_ENVIRONMENT=test WEBSITE_TEST_DATABASE_URL=... uv run python scripts/restore_website.py /tmp/xxx/website-db-*.sql
```

## CMS 擴展與素材裁切 UI 小結（2026-09-21，Task 11 完成後追加，補 A01/A04 缺口）

使用者要求「先把剩下 8 種內容欄位搬進 CMS」＋「素材裁切 UI」。過程中再次發現使用者在 `web/` 有新的進行中工作（`CampusBoard.vue` 未提交修改＋新的 `versions/before-campus-contact-b-*` 快照），本輪維持一貫作法：只精準 `git add` 自己動的檔案，`CampusBoard.vue`／`DESIGN.md`／`README.md`／`studio.css`／`NewsDialog.vue`／`useNewsSweep.ts`／`design/`／`versions/` 全部不碰。

- **素材裁切 UI**：`MediaLibraryView.vue` 新增「編輯焦點」對話框，點圖片指定 `crop_focus_x/y`（0~1 相對座標），同時可編輯 alt 文字與來源標註，走既有 `PATCH /admin/media/{id}`（欄位早就在 API/DB，只是沒有 UI）。已用 Playwright 對真實 backend+admin 驗證：上傳→點焦點 (0.2, 0.8)→儲存→API 讀回數值正確持久化。
- **CMS 擴展**：`CONTENT_KIND_REGISTRY` 從 3 種擴充到 9 種，新增 `site_meta`／`home_campus_board`／`booking_content`／`day_experience`／`campus_profile`（分校）／`campus_faq`（分校）；`site_footer` 從只有 `tagline` 擴充成含 `copyright`/`bottom_note`/`campus_list_label`。全部走既有的 content-items/revisions/publish 通用路由與 `require_scope` 權限模型，沒有另外複製一套機制。
- **抓到並修一個真的會弄丟資料的 bug**：`get_public_content()` 原本用扁平的 `content[kind] = payload` 存放發布內容，`campus_profile`／`campus_faq` 這種每校各一份的 kind 一旦有多校資料，後面查到的校會直接覆蓋前面的，`/public/site` 只會回其中一校的資料。已改成非共用 kind 用 `content[kind][campus_key]` 兩層結構，新增 `test_campus_scoped_content_kind_isolated_per_campus` 用兩校真實發布資料驗證不再互相覆蓋。
- **前端疊資料**：`applyContentOverlay` 擴充涵蓋全部 9 種 kind；`day_experience` 的疊資料筆數上限是 fixture 既有照片卡數量（`photo`/`tint` 尚未接媒體庫，後台多新增的時刻卡文字不會顯示，避免破圖），畫面上也加了對應提示；`campus_profile.line` 空字串在疊資料時轉成 `null`，跟 fixture 原本 `line: string | null` 的「尚未提供」語意一致。
- **驗證**：backend 新增 4 項 pytest 全過（越權編輯拒絕、多校資料隔離、moments 陣列邊界 1~12 筆與 key 不可重複），累計 **110 項全過**；web 新增 4 項單元測試（累計 **33 項**）；既有 **27 項 e2e 全過**；用真實 production build＋backend 對 9 個 kind 逐一跑過「編輯→發布→公開頁面顯示」全流程（首頁 hero/about/campusBoard、五校介紹、各校 FAQ、孩子的一天時刻卡、頁尾、網站標題全部驗證過真的顯示在渲染出的 HTML 裡）；測試資料驗證後已改回符合 fixture 語意的真實內容，不留「測試xxx」字樣，測試帳號已刪除。

**刻意不做（誠實列出）**：
- 消息（news）——直接跟使用者當時在 `web/` 的進行中工作重疊，本輪完全不碰（含 backend／admin／web 三層都沒動）。
- 探索（tourScenes）——每個場景含多個帶 x/y 座標的熱點，結構遠比其他 kind複雜，需要專門的視覺化編輯器，未在本輪範圍內。
- 影片／照片素材本身仍是路徑字串，CMS 內容 kind 尚未接媒體庫做「選圖」；`day_experience` 因此只能編輯文字，不能換照片。
- 首頁五校排序（`campusOrder`）與預設校區（`defaultCampus`）維持程式碼設定，不當一般文字內容開放編輯（改動風險較高，容易讓 carousel 邏輯壞掉）。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 110 passed
cd admin && npm run typecheck && npm run build                   # 都過
cd web && npm run typecheck && npm run test:unit                 # 過；33 passed
npm run contract:check                                           # 契約與型別皆一致（payload 走通用 dict 路由，OpenAPI 無變化）
npx playwright test --project=desktop-1440                       # 27 passed
# 9 個 content kind 逐一編輯→發布→用 production build 直接 curl 驗證公開頁面內容
```

## 校園探索（tourScenes）視覺化編輯器小結（2026-09-21，補 A01 最後一項缺口）

新增 `campus_tour` content kind（campus_key 分校，1~6 個場景、每場景 1~8 個熱點、x/y 限制在 0~100、場景 key 不可重複），走既有 content-items 通用路由與權限模型，沒有另外複製一套機制。

- **admin 視覺化編輯器**（`CampusTourView.vue`）：選校區→選/新增場景→在圖片上點擊新增熱點、拖曳圖釘調整位置、編輯熱點名稱/說明/提問。圖片預覽讀官網現有素材（尚未接媒體庫，新增 `admin/src/config.ts` 的 `WEBSITE_ASSET_BASE` 指向 Nuxt 官網的靜態資產，本機預設 `http://127.0.0.1:3000`，可用 `VITE_WEBSITE_ASSET_BASE` 覆蓋）。
- **web 端疊資料**：`applyContentOverlay` 新增 `campus_tour`，整組取代該校 `tourScenes`——包含把目前 4 校（明華/崇德/國際/仁武）仍在用的 `GeneratedTourScenes` 通用佔位樣板換成真正逐校撰寫的內容；義華校原本的 3 場景手寫內容也可以被後台覆蓋（一次整組取代，不是逐場景合併）。
- **驗證**：用 Playwright 對真實 backend+admin+production build 跑過完整流程：在圖片上點擊新增熱點，驗證回存座標與點擊位置吻合；拖曳圖釘重新定位，驗證座標正確更新（例如拖到畫面右上角後回存 x=80.0, y=14.8，跟拖曳終點一致）；儲存草稿→發布→公開頁面（義華校）點擊圖釘，驗證顯示的標題/說明/提問正確對應剛剛編輯的內容。backend 新增 2 項 pytest（`test_campus_tour_scene_and_spot_bounds` 涵蓋場景數量上限、重複 key、熱點數量上限、x/y 超出範圍四種情境；`test_campus_tour_isolated_per_campus` 驗證兩校資料不互相覆蓋），累計 **112 項全過**；web 新增 1 項單元測試，累計 **34 項**；既有 **27 項 e2e 全過**。測試資料驗證後已還原成義華校原本的 3 場景真實內容，測試帳號已刪除。

**已知限制**：場景圖片欄位仍是素材代號字串（例如 `campus`），管理者需要知道官網目前有哪些素材代號才能正確填寫；跟其他 kind 一樣尚未接媒體庫做「選圖」。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 112 passed
cd admin && npm run typecheck && npm run build                   # 都過
cd web && npm run typecheck && npm run test:unit                 # 過；34 passed
npm run contract:check                                           # 契約與型別皆一致
npx playwright test --project=desktop-1440                       # 27 passed
```

## 素材庫接上媒體選圖小結（2026-09-21，取代 campus_tour 的路徑字串）

`campus_tour` 場景圖片原本只能手動輸入官網現有素材代號字串（例如 `campus`），素材庫上傳的圖片完全接不進來——這輪把它真的接上，過程中發現並補上兩塊原本缺的基礎設施：

- **公開唯讀媒體路由**：新增 `GET /api/website/v1/public/media/{id}/file`（無需登入，只服務 `status=ready` 的素材，帶長效 `Cache-Control`）。**這是先前一直沒補的缺口**：既有的 `/admin/media/{id}/file` 要求管理員登入，CMS 內容引用的圖片完全沒有辦法給匿名訪客的瀏覽器載入——不是這輪才產生的問題，而是素材庫模組從階段 B 完成以來就一直缺這塊，只是先前的 content kind 都沒有圖片欄位，沒有暴露出來。
- **引用保護真的串接**：`MediaUsage`／`add_usage()` 這套資料模型與函式從階段 B 就存在，但從來沒有被 content 模組實際呼叫過（只有測試手動呼叫驗證機制本身正確）。新增 `sync_content_item_usages()`，在每次儲存新版 revision 時依 kind 設定的 `extract_media_ids` 重新同步引用，讓「這張圖還被草稿或已發布內容引用中，不能刪除」對 campus_tour 真的生效，不再是備而不用的機制。
- **相容既有內容**：`image` 欄位同時接受媒體庫 UUID 與舊的 fixture 素材代號字串，透過是否符合 UUID 格式判斷來源；已發布內容（例如義華校原本的 3 場景）完全不受影響，不需要遷移。
- **admin**：新增 `MediaPickerDialog.vue`（瀏覽/上傳/選取），`CampusTourView.vue` 的圖片欄位改成縮圖預覽＋「選擇圖片」按鈕，保留手動輸入代號的欄位相容既有內容。**web**：新增 `resolveTourImageSrc()` 依字串判斷來源，媒體庫圖片複用既有的 Nitro catch-all proxy（沒有新增 web 端路由）。

**驗證**：用 Playwright 對真實 backend+admin+production build 跑過完整流程——上傳圖片→選取→加熱點→儲存→發布→公開頁面透過同源代理真的載入素材庫圖片且不需登入；刪除仍被引用的素材回 `409 MEDIA_IN_USE`，移除引用（換回舊代號字串）後可正常刪除。backend 新增 3 項 pytest，累計 **115 項全過**；web 新增 4 項單元測試，累計 **38 項**；既有 **27 項 e2e 全過**。測試素材、內容、帳號皆已清除還原（含直接刪除測試建立的 `content_items`/`media_usages` 資料庫列，讓明華校恢復成從未客製化過的狀態，重新退回原本的 `GeneratedTourScenes` 通用樣板）。

**已知限制**：只有 `campus_tour` 的場景圖片接上媒體庫；其餘尚未有圖片欄位的 content kind（`campus_profile` 的校園照片、`day_experience` 的時刻卡照片等仍是 fixture 靜態資料）未受影響，也不在本輪範圍內——這些欄位目前根本不在 CMS payload 裡（刻意排除，見前面的 CMS 擴展小結），不是漏接媒體庫。

**本機驗證（實際跑過）**：
```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" uv run pytest -q   # 115 passed
cd admin && npm run typecheck && npm run build                   # 都過
cd web && npm run typecheck && npm run test:unit                 # 過；38 passed
npm run contract:check                                           # 契約與型別皆一致
npx playwright test --project=desktop-1440                       # 27 passed
```

## 後台 UI/UX 改版小結（2026-09-21）

**做了什麼**：`admin/` 全部 21 個頁面與版型重做，不動 API 與資料模型。新增 `src/api/labels.ts`（校區／狀態／角色／通知／稽核中文，`formatDateTime` 走 Asia/Taipei）、`src/router/nav.ts`（側欄結構＝路由 meta，含角色限制，`users`／`policies` 只有 super_admin 看得到，其他人進入會轉回總覽）、`src/composables/useCampusScope.ts`（取代九個頁面各自複製的可見校區邏輯）、`useCampusContent.ts`（分校內容切校前確認未儲存修改）、`useContentItem` 補 `isDirty`／`latestRevisionAt`／`neverPublished`／`saveAndPublish`／`reset`／`loadError`，以及 `ContentEditor`／`PageHeader`／`CampusSelect`／`StatusTag` 四個共用元件。登入頁支援 `?redirect=`。

**實際驗證**：`npm run typecheck`、`npm run build`、`npm run test:unit`（7 passed）；Playwright 對真實後端（本機 8000）以臨時 super_admin 與 campus_admin（仁武）帳號登入，1440×900 與 390×844 各截 19 頁、無水平溢出、無 JS 錯誤（只有校園探索頁向未啟動的 Nuxt 3000 埠要內建圖片的連線失敗），並實測：編輯欄位→狀態列變「有未儲存的修改」、「儲存草稿」啟用、發布鈕改成「儲存並發布」；點側欄離開跳出攔截並可留在本頁；「還原修改」回到載入值；校區帳號在只有一校時校區選單退成唯讀標籤、進 `/users` 被導回總覽；手機時段表格可橫向捲動、案件明細的「處理」面板排最前。示範資料（3 筆需求、3 個時段、1 張素材）與臨時帳號已刪除，義華預約模式已改回 paused（版本 2→4）；`audit_log_entries` 留下 2 筆 actor 為 null 的預約設定更新紀錄。

**未做**：dashboard 的「未發布草稿」連到首頁首屏文字而非清單（API 沒有列出哪些 kind 未發布）；素材庫沒有分頁；通知「全部標記已讀」是逐筆呼叫；未做 e2e 測試。

## 後台營運補強小結（2026-09-24）

依使用者要求補齊五項：內容版本紀錄與還原、人工補登案件、指派承辦人、接待月曆、消息排程上下架。

| 項目 | API | 後台 | 測試 |
|---|---|---|---|
| 版本紀錄與還原 | `GET /admin/content-items/{kind}/revisions`、`GET …/revisions/{id}`、`POST …/revisions/{id}/restore`（`publish` 選填） | 所有內容編輯頁狀態列的「版本紀錄」抽屜：列出最近 50 版、選一版看會改變的欄位、還原成草稿或還原並發布 | `test_content_revisions.py` 8 項、admin `receptionAndHistory.test.ts` |
| 人工補登 | `POST /admin/visit-requests`（`Idempotency-Key` 必填，與官網 key 分開命名空間） | 參觀案件頁「補登案件」對話框 | `test_visit_manual_and_assign.py` |
| 指派承辦人 | `PATCH /admin/visit-requests/{id}/assignee`、`GET /admin/visit-staff`、列表 `assignee=me|none|<id>`、`source=` | 列表承辦人欄與篩選、明細頁承辦人選單 | 同上 |
| 接待月曆 | `GET /admin/visit-calendar?date_from&date_to[&campus_key]`（最多 62 天） | 側欄「接待月曆」 | 同上 |
| 完成參觀 | `POST /admin/visit-requests/{id}/complete`（狀態機原本就有，只缺路由） | 明細頁參觀日當天起出現「完成參觀」 | 同上 |
| 消息排程 | `home_news` 的 articles／events 加 `show_from`／`show_until`（選填，台北日期，含當天）；公開 API 過濾並拿掉這兩個欄位 | 最新消息與活動頁每則加上架／下架日期與狀態標籤 | `test_home_news.py` |

設計決定：
- 還原是「把舊版複製成新的一版」，不改寫歷史，也不會把其他人尚未發布的草稿帶上官網。舊版用目前的欄位規則重新驗證，不合格回 `CONTENT_REVISION_OUTDATED`；引用的素材已刪除則回 `MEDIA_NOT_FOUND`。
- 補登不看官網預約模式（暫停線上收件時仍要能登錄來電），狀態從 `new` 開始；要當場排時段就走與一般確認相同的容量檢查，額滿則整筆不建立。補登者預設為承辦人。補登不寫「新需求」通知、不計入官網成效統計。人員必須勾選「已向家長說明並取得同意留存資料」。
- 新增 migration `d3a8f1c5b742`：`visit_requests.source`（既有資料回填 `web`）、`visit_requests.created_by`，以及承辦人索引。
- 確認預約時，已經指派過的承辦人會保留（原本一律改成按確認的人）。
- 只能指派給啟用中、具 `booking.manage` 且有該校權限的人員；分校管理者看人員名單時只看得到總管理者與共同校區的同事。
- 排程靠讀取時過濾，不需要背景工作；草稿預覽 `/preview` 仍顯示全部消息（含尚未上架的）。

未做（2026-09-24 當時；**四項已在下方「2026-09-25／26 小結」全部補上，不再是未做**）：全站 release 層級還原、內容審核流程、整份內容的排程發布、每週固定時段規則。

## 2026-09-25／26 小結（`feature/admin-gaps-20260925` 分支，B01–B14 共 14 批＋合併 `main`）

第一輪盤點（`docs.json`）列出的文件落後與缺口，經逐項核對 HEAD 後：多數在本分支的 B01–B12 已補上功能與測試；B13 補完標題字型；B14 補上端到端測試、無障礙與鍵盤自動化、像素回歸；本文件（B15）同步文件現況。以下只列**本分支實際修好的東西**，逐項細節、API／欄位變動見各批次 commit 與下方「本機驗證」；沒看到成功輸出的項目已標未驗證。

### 修了什麼（依主題彙整）

- **權限精修**：新增 `booking.handle`（處理案件：聯絡紀錄、確認排入時段、補登、取消、未到場、完成、後台改期、核准／退回家長改期、產生／撤銷家長連結、通知已讀）；`booking.manage` 收斂為設定面（時段、每週規則、休假日、預約設定、指派承辦人）。個資匯出（`booking.export`）與全站共用內容（`content.shared`）改為總管理者逐人授權，不再是依角色自動給。後台按鈕一律讀 `effective_capabilities`（`usePermissions`），不會出現「按了才 403」。
- **案件處理完整**：後台改期（接上原子改期 API，擋已開始的時段）、`completed`／`no_show` 保留已占用名額、家長管理連結（產生／複製／重新產生／撤銷，只顯示一次）、案件歷程（操作人／異動前後／原因＋時間軸 UI）、家長線上申請改期（站內通知＋核准／退回）、待人工處理清單（時段關閉或分校停用但家長仍要來）、CSV 匯出改依畫面篩選、送出日期區間篩選、各校可設定家長線上取消／改期期限（1–336 小時）、每週規則自動往後延展＋取消休假重開時段。
- **預約規則**：家長同意記錄綁定當時發布的文案版本（`consent_revision_id`）、隱私說明本文可在後台編輯並有 dialog、預約模式啟用條件擴充（欄位類＋資料類，不符列出原因）、切換模式前顯示影響範圍並二次確認、參觀人數 1–10（必填）、問題上限改 500 字。
- **通知**：寄送失敗可在後台或 CLI 人工重新寄送；新增「即將參觀」「逾期未處理」兩種提醒（寄送當下重新判斷是否仍成立）；補齊中文標籤並有靜態測試比對後端稽核動作／通知 kind。
- **內容管理**：排程發布不會蓋回較新版本（到期時官網已是更新版本會標「已略過」）；送審／核准／退回，過期待審版自動標記已被取代；全站發布紀錄與一鍵還原（限總管理者）；總覽新增待發布清單與缺素材提示；版本紀錄顯示曾上線／審核狀態並列出逐項差異摘要；`content-seed-from-fixture` 加保護與 dry-run，`initialize-content` 加 dry-run。
- **消息與 FAQ**：消息與活動改結構化內文（五種區塊）、適用範圍（全校／指定校區）、首頁推薦與顯示筆數、活動時間地點與相關連結；各校可編輯自己的消息與活動；新增全站共用常見問題，各校可逐題啟用、覆寫或不顯示。
- **官網內容細節**：停用分校現在是官網整校下架（404、五校區塊／頁尾／選單／sitemap 不列）；首頁五校順序與預設校區可在後台調整；主選單與頁尾連結可編輯（站內或 https 外部連結）；分校地圖連結可獨立編輯；標題缺字提示擴及所有標題欄位；校園探索場景／熱點可排序並直接輸入座標；孩子的一天新增第 7 張以後的卡片與刪卡會生效；首屏按鈕文字欄位退場。
- **素材庫**：引用記錄版本與欄位路徑、批次替換（先列影響範圍再產生草稿）、刪除保護涵蓋可還原的舊版本與已排程版本、封存與待清理（延後刪檔，不再上傳就立即硬刪）、批次上傳、影片 metadata、上傳格式收斂（不再收 GIF）、上傳大小上限改為部署設定、縮圖／大圖／poster 衍生檔路由、版位裁切焦點（0–100）、首屏影片等版位進 CMS（選填）、既有素材 dry-run importer。
- **統計與 SEO**：後台收錄開關真的接上 `robots.txt`／`sitemap.xml`／`llms.txt`；成效漏斗新增取消與取消原因、日期區間、依來源／「從哪裡知道我們」分組；公開點擊事件改用 `event_id` 去重與入口代碼白名單，`environment`／`curriculum` 兩個新頁的預約鈕也補上入口代碼。
- **稽核與資料治理**：稽核範圍從 4 種擴大到約 30 種動作，並有靜態測試擋漏寫；個資保存政策改為後台可設定天數並持久化（依結案時間起算，未結案一律不清），有清理紀錄與雙開關（部署變數＋後台）；樂觀鎖涵蓋時段、案件承辦人／下次聯絡時間、每週規則、全站設定、素材說明；統一 `X-Request-ID` 與更細的錯誤碼（`SLOT_CLOSED`／`SLOT_NOT_FOUND`／`MEDIA_NOT_READY` 等）；`/public/site` 加 ETag／304。
- **登入**：後台新增 Google 登入（可解除綁定、成功／失敗寫稽核）；沿用既有 LINE 登入。
- **字型**：`web/` 標題字型從 737 字子集換成完整 LINE Seed TW（Bold／ExtraBold 各 13,915 字），首屏只預載 Bold critical（13,852 bytes，原 27,860 bytes）；根目錄凍結原型不受影響。
- **測試基礎設施**：新增 `tests/stack/`（真後端＋真官網＋隔離 DB 的端到端測試：預約全流程、內容送審發布、素材選圖、每週規則、角色限制）、`tests/stack/hydration.spec.ts`、`tests/stack/a11y.spec.ts`（axe，10 公開頁＋13 後台頁）、`tests/stack/keyboard.spec.ts`、`tests/stack/visual.spec.ts`（像素回歸），CI 新增 `e2e` job（不擋部署）。過程中修掉兩個會讓 e2e／CI 失敗的既有問題：`web/app/utils/cta-analytics.ts` 相對路徑引用 `shared/` 讓 production build 失敗（改用 `#shared` 別名）；全新資料庫一次套完 migration 時 `ALTER TYPE ADD VALUE` 新增的 enum 值不能在同一串後續 migration 當常數使用。
- **合併 `origin/main`**：併入常春藤環境頁、特色教學頁、四校校園探索實景、義華家長分享、各校 IG／YouTube、手機活動影片換義華 YouTube 等其他 session 的工作（合併到 main 的 `3fe0c18`），並補上新頁面的 CTA 入口代碼。

### 本機驗證（各批次實際跑過，彙整自 commit 訊息；本次 B15 為文件批次未重跑全套）

```bash
# 各批次結束前跑過的指令（詳見各 commit）：
cd backend && uv run pytest -q -p no:cacheprovider   # 各批次皆全過，B12 結束時計入樂觀鎖／稽核測試
npm --prefix admin run typecheck && npm --prefix admin run test:unit
npm --prefix web run typecheck && npm --prefix web run test:unit
npm run contract:check
# B14 新增，非每批都跑（8GB RAM，一次一組）：
npm run e2e:build && npm run test:e2e:stack
```

本次 B15（文件同步）**沒有重跑上述全套測試**，因為只改了 Markdown、`CLAUDE.md`、`backend/.env.example` 與兩處程式內註解（不影響邏輯）；已對改到的 Python 檔案跑語法檢查（`python -m py_compile`）確認沒有壞掉，並用 `git diff`／`grep` 逐項核對文件描述與目前程式碼（`backend/app/auth/permissions.py`、`backend/app/operations/models.py`、`backend/app/notifications/service.py`、`web/tests/booking-action.spec.ts`、`tests/stack/`、`tests/e2e/` 等）是否一致，而不是直接照抄各批次的自述。

### 仍未做／需要使用者或業主處理

- **熱點複核**（A04）：校園探索場景換照片後只有 UI 提醒，沒有強制複核流程。
- **A06／A16 的 e2e 覆蓋不足**：line/phone/external 三種預約模式沒有專門的瀏覽器 e2e（見上方表格更正）。
- **背景轉檔佇列**未做：素材上傳仍在同一個請求內處理完，沒有多尺寸圖／影片轉碼工作表。
- **錯誤格式 envelope**（規格 L335）維持 `{detail:{code,message}}` 而非整體改格式，這是刻意保留現狀，若要改屬破壞性契約變更，需業主裁定。
- **LINE 登入未寫稽核**（裁定只要求 Google）；帳密登入本來就沒有登入稽核。
- **家長端沒有通知管道**：核准／退回改期、園方改期都不會通知家長；家長管理頁看不到退回原因。
- 需要使用者處理、本分支明確沒做（不可逆或需登入正式環境）：簡訊驗證（付費）、正式庫與媒體備份／PITR（需登入 Railway，可能付費）、斷開 Railway 原生部署、正式站執行 `initialize-content`（會建立並發布 `shared_faq`）、SMTP／Google／LINE／S3 正式環境變數、四校正式內容（園方提供）、CI 的 `e2e` job 是否要擋部署（目前只檢查）。
- 各批次 followups 累積的細項（例如：接待人員能否標記通知已讀、個資匯出能否授予櫃台、待核准改期不會自己過期、`booking_configs.version` 因為改家長異動期限也會跳號、Google 解除綁定後同 Email 帳號登入會自動重新綁定等）散在各 commit 訊息，尚未整併成單一清單，需要時可以逐一搜尋 commit log。
