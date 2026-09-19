# 官網後台驗收表（Task 11）

依 `docs/superpowers/plans/2026-09-19-website-admin.md` Task 11；每階段結束只填該階段列，其餘標 `not-run` 並註明所屬階段。完整報告見同次交付訊息；本檔只保留可長期追蹤的結論列表。

| ID | 階段 | 驗收情境 | 狀態 | 證據 |
|---|---|---|---|---|
| A18 | A | 1440/1024/390/375px、鍵盤、降動態、無水平溢出 | 見下方階段 A 小結 | `artifacts/website-baseline/*.png`；Playwright 視覺回歸待補 |
| A19 | A | 原型快照可離線開啟；新版 Nuxt localhost／授權預覽可用，fixture 不會真實提交 | 部分 | `artifacts/prototype-baseline/preview.html`（+ sha256）已備妥；Nuxt localhost 預覽見階段 A 小結 |
| A21 | A | 五校正式路徑、直接開啟／刷新、前進後退、舊 hash 相容、未知校區 404 | 見下方階段 A 小結 | Nuxt route 測試 |
| A22 | A | 主要內容在 SSR HTML，禁用 JS 仍可讀；不靠整頁 ClientOnly | 見下方階段 A 小結 | raw HTML 檢查 |
| A24 | A | 無 hydration mismatch，進出頁清理動畫／影片；私有資產與原始碼不被靜態服務暴露 | not-run | 待 Playwright E2E |
| A25 | A→B | 階段 A：缺字檢查報告完整 | 完成（部分缺字為已知限制） | `docs/website-admin/baseline.md` §字型缺字檢查 |
| A01 | B | 現有首頁、五校、一天影片與照片卡、探索、消息、FAQ 欄位都有 editor | 部分 | 首頁「關於常春藤」／Hero／頁尾標語三個 content kind 有真實 editor；其餘 8 種欄位仍是 fixture，尚無 editor（見階段 B 補缺口小結） |
| A02 | B | 修改一校不影響另一校；role/scope 在 API 生效 | 通過 | `test_auth_scope.py`、`test_media.py` 正負權限測試 |
| A03 | B | 草稿不可公開；發布／指定版本還原正確；預約不跟著回滾 | 部分 | 草稿不公開、發布生效、version conflict 已測試（`test_content_release.py`）；版本「還原」與預約模組都尚未實作（預約屬階段 C） |
| A04 | B | 圖片／影片／poster 替換、裁切、引用保護、私有素材、熱點複核 | 部分 | 上傳/驗證/引用保護/替換隔離已測試，**admin 素材庫 UI 已補上**（列表/預覽/上傳/刪除）；裁切焦點欄位仍無 UI；熱點複核、既有素材 dry-run importer 未做 |
| A20 | B | web/admin 共用 OpenAPI 型別，fresh setup、Nuxt build/start、admin build、測試可重現 | 通過 | `npm run contract:generate`／`contract:check` 已建立；`contracts/openapi.json` + `contracts/generated/website-api.d.ts` 已產生並委託 admin 的 `UserOut`/`CampusOut`/`MediaAssetOut`/`MediaVariantOut`/`ContentItemOut` 直接引用生成型別，不再手抄；各 kind 的 payload（home_about 等）因後端收 dict 動態驗證，暫時仍手抄，已註解說明 |
| A05 | C | 每校六模式切換，缺連結不啟用，原案件仍存在 | 部分 | 五種可啟用模式（inquiry/line/phone/external/paused）＋ slots 保留但擋啟用，皆測試；「原案件仍存在」已測（`test_mode_switch_does_not_affect_existing_requests`） |
| A07 | C | 表單成功持久化；失敗保留輸入；重送只建一案 | 部分 | 後端 API 側全過（含 10 連線真實併發只建一案）；Nuxt 端表單尚未接上真實 API（見下方 Task 6 小結，Nuxt CTA 接線屬 Task 8） |
| A08 | C | 舊 config version 被拒；成功後重播仍回原結果 | 通過 | `test_stale_config_version_rejected_then_switch_to_line`、`test_request_retry_is_same_case` |
| A09 | D | 最後一格並發只有一組；取消／改期／到期無超收 | not-run（slots／Task 7 範圍） | — |
| A06, A16 | C | CTA 一致／SEO | not-run | 屬 Task 8 |
| A10–A15, A17, A23 | C/D | — | not-run（屬後續階段） | — |

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
