# 官網後台驗收表（Task 11）

依 `docs/superpowers/plans/2026-09-19-website-admin.md` Task 11；每階段結束只填該階段列，其餘標 `not-run` 並註明所屬階段。完整報告見同次交付訊息；本檔只保留可長期追蹤的結論列表。

| ID | 階段 | 驗收情境 | 狀態 | 證據 |
|---|---|---|---|---|
| A18 | A | 1440/1024/390/375px、鍵盤、降動態、無水平溢出 | 見下方階段 A 小結 | `artifacts/website-baseline/*.png`；Playwright 視覺回歸待補 |
| A19 | A | 原型快照可離線開啟；新版 Nuxt localhost／授權預覽可用，fixture 不會真實提交 | 通過 | `artifacts/prototype-baseline/preview.html`（+ sha256）已備妥；Nuxt localhost 預覽見階段 A 小結；`/preview` 私有草稿殼（見 Task 8 小結）已用 Playwright 驗證未登入拒絕、登入後見草稿、公開站不洩漏 |
| A21 | A | 五校正式路徑、直接開啟／刷新、前進後退、舊 hash 相容、未知校區 404 | 見下方階段 A 小結 | Nuxt route 測試 |
| A22 | A | 主要內容在 SSR HTML，禁用 JS 仍可讀；不靠整頁 ClientOnly | 見下方階段 A 小結 | raw HTML 檢查 |
| A24 | A | 無 hydration mismatch，進出頁清理動畫／影片；私有資產與原始碼不被靜態服務暴露 | 部分 | `web/public/`＋正式 build 輸出已人工檢查，只有素材與字型，無原始碼／env／design／versions／preview.html；**未做**系統性的 hydration mismatch 自動化檢查（僅開發/啟動 log 人工觀察未見警告） |
| A25 | A→B | 階段 A：缺字檢查報告完整 | 完成（部分缺字為已知限制） | `docs/website-admin/baseline.md` §字型缺字檢查 |
| A01 | B | 現有首頁、五校、一天影片與照片卡、探索、消息、FAQ 欄位都有 editor | 部分 | 首頁「關於常春藤」／Hero／頁尾標語三個 content kind 有真實 editor；其餘 8 種欄位仍是 fixture，尚無 editor（見階段 B 補缺口小結） |
| A02 | B | 修改一校不影響另一校；role/scope 在 API 生效 | 通過 | `test_auth_scope.py`、`test_media.py` 正負權限測試 |
| A03 | B | 草稿不可公開；發布／指定版本還原正確；預約不跟著回滾 | 部分 | 草稿不公開、發布生效、version conflict 已測試（`test_content_release.py`）；版本「還原」與預約模組都尚未實作（預約屬階段 C） |
| A04 | B | 圖片／影片／poster 替換、裁切、引用保護、私有素材、熱點複核 | 部分 | 上傳/驗證/引用保護/替換隔離已測試，**admin 素材庫 UI 已補上**（列表/預覽/上傳/刪除）；裁切焦點欄位仍無 UI；熱點複核、既有素材 dry-run importer 未做 |
| A20 | B | web/admin 共用 OpenAPI 型別，fresh setup、Nuxt build/start、admin build、測試可重現 | 通過 | `npm run contract:generate`／`contract:check` 已建立；`contracts/openapi.json` + `contracts/generated/website-api.d.ts` 已產生並委託 admin 的 `UserOut`/`CampusOut`/`MediaAssetOut`/`MediaVariantOut`/`ContentItemOut` 直接引用生成型別，不再手抄；各 kind 的 payload（home_about 等）因後端收 dict 動態驗證，暫時仍手抄，已註解說明 |
| A05 | C | 每校六模式切換，缺連結不啟用，原案件仍存在 | 部分 | 五種可啟用模式（inquiry/line/phone/external/paused）＋ slots 保留但擋啟用，皆測試；「原案件仍存在」已測（`test_mode_switch_does_not_affect_existing_requests`） |
| A07 | C | 表單成功持久化；失敗保留輸入；重送只建一案 | 通過 | 後端 API 側全過（含 10 連線真實併發只建一案）；Nuxt `VisitForm.vue` 已接上真實 `POST /public/visit-requests`（含 idempotency key、slots 選位、409/429/422 錯誤處理且失敗不清空欄位），見 Task 8 小結 |
| A08 | C | 舊 config version 被拒；成功後重播仍回原結果 | 通過 | `test_stale_config_version_rejected_then_switch_to_line`、`test_request_retry_is_same_case` |
| A09 | D | 最後一格並發只有一組；取消／改期／到期無超收 | 部分 | 最後名額真實 PostgreSQL 併發（`test_one_slot_cannot_accept_two_families`）、取消釋放、改期回滾皆已測；「逾期釋放」（占位到期自動作業）屬 Task 9 排程工作，未做 |
| A10 | D | 規則、例外日、提前時間、滿額、手動／自動確認 | 部分 | 手動建立單次時段＋容量保護、滿額拒絕已測；週期規則產生器、例外日、提前時間/開放天數驗證屬 Task 9 範圍，未做 |
| A11 | D | 人工補登、聯絡、承辦、狀態、日曆、匯出同源且有權限 | 部分 | 人工確認/取消/未到場/聯絡紀錄/CSV 匯出（含公式注入防護）皆已測並有 admin UI；日曆視覺化用簡化的清單+日期區間取代，未做真正的月曆元件 |
| A06, A16 | C | CTA 一致／SEO | 通過 | 各校 CTA（`BookingCta`／`useCampusBooking`）即時讀 booking-config，paused/line/phone/external/inquiry 五種模式皆用 e2e 驗證；SEO（canonical／OG／robots meta）依 `indexingEnabled`／`siteOrigin` 動態產生，`/visit`／`/preview` 一律 noindex，`robots.txt`／`sitemap.xml` 依索引開關切換，見 Task 8 小結 |
| A12 | D | 失敗通知可重試、無重複、案件不丟失、worker 可恢復 | 通過 | `test_notifications.py`：寄送失敗案件保留、重試後成功且只有一份對應通知、達上限標記 failed、worker 租約過期後可被其他 worker 重新認領 |
| A13 | D | 家長只讀自己的案件，安全取消／申請改期／token 過期 | 通過 | `test_parent_access.py`：token 換 session、家長間 session 互不可見、自助取消、改期申請待核准前原時段不變、無效 token 拒絕 |
| A15 | D | 審核、排程、到期下架、併發編輯與權限失效正確 | not-run（審核/排程屬 Task 10／內容審核流程，本輪未做） | — |
| A14 | D | 點擊和預約分開；Dashboard 與分析不漏校或 PII | 通過 | `test_operations.py`：偽造成效事件拒絕、點擊不影響 request_created 計數、dashboard/匯出跨校隔離、稽核紀錄不含個資 |
| A17 | D | 保存政策 dry-run／匿名化、備份還原有實測 | 通過 | dry-run 不改資料、真正執行預設關閉、對真實隔離測試 DB + 測試媒體做過備份/還原演練（見 Task 10 小結） |
| A23 | C | 發布後新 SSR／刷新／站內換頁讀新 release；hydrate 不重複讀取；無跨 request 私密資料 | 部分 | `tests/e2e/release-freshness.spec.ts` 真的發布一版新 revision，驗證新 HTTP 請求／重新整理／站內換頁都讀到新內容（過程中抓到並修掉 `usePublishedSite` 固定 key 換頁不重抓的快取缺口）；範圍限於目前僅有的 3 個 CMS content kind（home_about/home_hero/site_footer），其餘內容仍是 fixture 靜態資料，無跨 request 私密資料一項未特別測（`/preview` 走獨立 client-only 殼，SSR 不輸出任何管理端資料，已用 e2e 驗證） |

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
