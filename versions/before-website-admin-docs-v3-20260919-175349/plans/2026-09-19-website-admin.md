# 官網後台與分校預約 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. If available and independently useful, superpowers:subagent-driven-development may be used with one owner per module and no concurrent test runs. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留目前官網設計，交付可管理五校內容、素材、發布與六種預約方式的真實後台。

**Architecture:** 同 repo 的 web/ 採 Nuxt 4 SSR，將現行原型逐區遷移為 Vue 元件並保留視覺／互動；admin/ 採 Vue + Vite，backend/ 採獨立 FastAPI API。官網只讀已發布 release，預約、權限與排程由 FastAPI/PostgreSQL 統一處理。

**Tech Stack:** Nuxt 4（SSR）、Vue 3、TypeScript；管理端另用 Pinia、Vue Router、Element Plus、Vite；FastAPI 0.136.1、SQLAlchemy 2.0、Alembic、PostgreSQL；pytest、Vitest、Playwright。

**Revision:** v2，使用者已選定 Nuxt；共 11 個實作任務、A01–A24 驗收。舊版 vanilla adapter 與正式單 HTML 打包要求已被本版取代。

**Spec:** [2026-09-19-website-admin.md](../../specs/2026-09-19-website-admin.md)。規格與本計畫必須一起閱讀。

## Global Constraints

- 全部使用繁體中文（台灣用語）。
- FastAPI 0.136.1（已釘版，勿升）。
- 公開官網採 Nuxt 4 + Vue 3 + TypeScript，SSR 為預設。
- 保留現有官網版型、動畫、RWD 與無障礙互動；正式網址改為路徑路由，舊 hash 連結提供相容轉址。
- 只修改本 repo，不連接或修改 ivy-backend、ivy-frontend、ivyManageSystem 的業務資料。
- 官網資料使用獨立資料庫；不得使用 `ivymanagement` 或任何既有 staging/production DB。
- 開發 migration 與整合測試只可用明確標示為本任務專用的隔離資料庫。
- 不自動部署、push、對外發布、發送真實家長通知或建立付費服務。
- 不復原、不丟棄、不夾帶提交工作目錄原有未提交變更。
- 缺漏校區聯絡資料保留待補，不借用其他校的 LINE、電話或預約網址。
- 憑證只透過環境變數；不寫入 repo、範例資料、前端 bundle 或執行紀錄。
- 機器為 8GB RAM；測試與影片轉檔依序執行，不同代理不得同時跑測試。

---

## 執行方式與目錄責任

本任務涵蓋 Nuxt 官網遷移、內容與素材、預約與接待、權限與營運。先用 fixture 完成 Nuxt 首頁與校區的視覺／SSR 基礎，再做 API 接線，避免先重構一套 vanilla CMS。依下面依賴順序完成，不把第一批完成視為整體完成；不必每個任務重新詢問許可。

所有下列檔案除明列 Modify 外均為**預計新增**；執行時若已有其他工作建立，先讀取並整合，不能覆蓋。

```text
backend/
  pyproject.toml                 # 依賴、pytest；產生對應 lockfile
  alembic.ini, migrations/       # 獨立官網 schema
  app/
    main.py, config.py, db.py    # 工廠、明確環境、session/transaction
    auth/                       # models schemas routes service permissions
    campuses/                   # 五校、active、membership scope
    content/                    # typed schema、revision、審核、release、排程
    media/                      # metadata、storage adapter、變體、引用
    booking/                    # config、rules、slots、requests、狀態機
    notifications/              # inbox、outbox、Email adapter
    operations/                 # audit、analytics、policy、retention
    workers/                    # jobs、claim/lease/retry、排程
    cli.py                      # bootstrap-admin、seed、備份/還原入口
  tests/
    conftest.py                 # 隔離 PG、真實登入 client、測試 factories
    test_auth_scope.py
    test_media.py
    test_content_release.py
    test_booking_modes.py
    test_booking_concurrency.py
    test_visit_workflow.py
    test_notifications.py
    test_operations.py
admin/
  package.json                  # lockfile、dev/build/typecheck/test scripts
  src/
    api/                        # 使用共用 generated types + 管理端 API client
    stores/auth.ts
    router/index.ts
    layouts/AdminLayout.vue
    views/                      # 各任務列出的頁面
    components/                 # 共用欄位、素材選擇器、預覽與錯誤狀態
  tests/                        # 關鍵互動 Vitest
web/
  package.json, nuxt.config.ts   # SSR、dev/build/start/typecheck/test:unit
  app/
    app.vue                     # Nuxt 根元件，不載入舊 app.js
    pages/                      # index、campuses/[key]、visit/index/[key]/manage、preview
    components/                 # 現有官網各版位 Vue 元件
    composables/                # usePublishedSite、useCampusBooking、useDraftPreview
    utils/booking-action.ts     # 型別化純函式 resolver
    plugins/legacy-hash.client.ts
    assets/css/                 # 沿用目前 CSS，再逐區整理
  server/routes/                # sitemap.xml、robots.txt
  public/                       # 僅允許公開的字型與原型素材
  tests/                        # Vitest，含 resolver 與 composables
content/site-fixture.json        # 僅供開發／測試的單一內容 fixture
contracts/openapi.json           # 後端生成的正式契約
contracts/generated/website-api.d.ts # web/admin 共用生成型別
scripts/                        # seed snapshot、契約、驗證、備份腳本
tests/e2e/                      # 跨前後端 Playwright
docs/website-admin/             # 啟動、權限、素材、接待、維運與驗收報告
```

各後端 domain 子目錄採 `models.py/schemas.py/service.py/routes.py` 起步，只有責任需要時再拆。每個 route 處理輸入與權限，業務交易放 service；不可在 router、worker、CLI 各自寫一套建單邏輯。

共享介面：

- API base `/api/website/v1`，細部路由與 enums 依規格第 8 節。
- `create_app(settings)` 位於 `backend/app/main.py`，可注入隔離測試設定；不得 import 時連真實 DB。
- `require_scope(user, capability, campus_ids)` 位於 `auth/permissions.py`，所有 route/service/export/job 共用。
- `web/app/utils/booking-action.ts` 具名匯出 `resolveBookingAction(campusKey, config)`，回 `{kind,href,label,message}`；kind 僅 `choose_campus|form|line|phone|external|paused`。paused 的 href 為 null；站內 href 使用新正式路徑。
- `usePublishedSite()` 以 Nuxt SSR payload 取得含 schema_version/release_id/content 的公開資料；每次頁面導航更新，一次渲染只用一份 release。
- `useCampusBooking(campusKey)` 取得即時公開設定／時段，校區切換取消過期請求。`useDraftPreview()` 只在已授權 `/preview` 使用，不能與公開內容 cache 共用。
- server 的固定 API 來源使用 `NUXT_WEBSITE_API_INTERNAL_BASE`；瀏覽器固定同源 `/api/website/v1/`。`NUXT_PUBLIC_SITE_ORIGIN` 控制 canonical、OG、sitemap。
- web 的 `dev/build/start/typecheck/test:unit` scripts 必須可用；Node 與 Nuxt 4 穩定版本在實作時核對相容性後鎖定。
- `BookingConfig.mode` 僅 `inquiry|slots|line|phone|external|paused`；前端生成同一 enum，不另手抄。
- 所有可同時編輯的 command 接受 `expected_version`；衝突不得 last-write-wins。

## Task 1：保留現況，建立可重現開發基礎

**Files:** Create `docs/website-admin/baseline.md`、`backend/pyproject.toml`、`backend/app/{main,config,db}.py`、`backend/tests/conftest.py`、`web/{package.json,nuxt.config.ts}`、`admin/package.json`、root `package.json`、`playwright.config.ts`；Modify `.gitignore`（保留既有規則）。

**Consumes:** 現行官網工作目錄、規格與五校內容。

**Produces:** 啟動／測試 scripts、明確隔離 DB、before 畫面、測試 fixture 契約。

- [ ] 記錄 `git status --short`、目前 commit、已修改檔案與現用路由；只記狀態不輸出敏感檔案內容。
- [ ] 建立本機 HTTP 預覽，拍攝首頁與五校頁的 1440/1024/390/375px 畫面，另記錄一天翻面、分校切換、地圖、預約、新聞 dialog 互動。存入忽略版控的 `artifacts/website-baseline/`。
- [ ] 遷移前執行原 `python3 package_preview.py`，保存產出的離線 preview 到 `artifacts/prototype-baseline/preview.html` 並記 checksum；只作原型快照，不放進 Nuxt production public。
- [ ] 建立 Nuxt SSR 殼、最小 API、管理後台殼與健康檢查。後端環境變數為 `WEBSITE_DATABASE_URL`、`WEBSITE_TEST_DATABASE_URL`、`WEBSITE_MEDIA_ROOT`、`WEBSITE_SESSION_SECRET`；Nuxt 的五個 runtimeConfig 環境變數依規格第 9.3 節實作，不提供真實秘密預設值。
- [ ] 測試 Nuxt production + fixture 組合啟動失敗、indexingEnabled 字串 false 不會啟用索引、私有 API base 不出現在瀏覽器 payload；dev/test 可明確啟用 fixture 並保留示範標記。
- [ ] 建立 config 測試，對未設定 DB、指向 `ivymanagement`、測試 DSN 非明確測試資料庫，應拒絕啟動並顯示不含密碼的錯誤。
- [ ] 設定獨立開發 DB 名稱 `ivy_website_dev`、測試 `ivy_website_test` 或任務專用臨時 PG。若服務不存在，完成啟動配方與離線工作，集中回報環境阻擋，不偷用其他 DB。
- [ ] 根 scripts 建立 `test:website`（轉呼叫 web Vitest）、`test:e2e`；web scripts 建立 `dev`、`build`、`start`、`typecheck`、`test:unit`；admin scripts 建立 `dev`、`build`、`typecheck`、`test:unit`；pytest 設定 tests/。測試指令必須實際執行 runner。

基礎測試程式：

```python
def test_reject_existing_business_database():
    from app.config import Settings
    import pytest
    with pytest.raises(ValueError, match="獨立"):
        Settings(database_url="postgresql://localhost/ivymanagement",
                 environment="test", session_secret="test-only-secret")
```

後續 fixture 固定契約（Task 3/6/7 逐步實作）：`public_client` 與 `second_public_client` 是同一隔離 PG 上的兩個獨立 httpx AsyncClient；`admin_client` 是已透過真實登入 API 登入的總管理者；`minghua_client` 只管明華；`editor_client` 只能編輯義華內容。登入 client 具有合法 CSRF header。`inquiry_payload` 是 seeded 義華 inquiry body；`slot_payload` 是 seeded 義華 slots body、其時段容量為 1。情境 fixture 彼此隔離，不在同一共享交易上假測併發。

`db_session` fixture 為同一隔離測試資料庫的獨立 SQLAlchemy AsyncSession，可查詢 API 已提交的資料；不得用它的外層 rollback transaction 包住 API 的所有請求。

**Validation:** config tests、健康檢查、前後端各自可啟動；記錄實際命令與輸出。

## Task 2：先完成 Nuxt 官網元件、正式路徑與視覺基準

**Files:** Create `web/app/{app.vue,pages/index.vue,pages/campuses/[key].vue,pages/visit/index.vue,pages/visit/[key].vue}`、`web/app/components/{SiteHeader,HeroVideo,AboutSection,DayExperience,DayMomentCard,CampusBoard,CampusTour,NewsDialog,CampusFaq,VisitForm,SiteFooter}.vue`、`web/app/composables/usePublishedSite.ts`、`web/app/plugins/legacy-hash.client.ts`、`web/app/assets/css/`、`content/site-fixture.json`、`tests/e2e/{nuxt-rendering,legacy-routes}.spec.ts`。

**Consumes:** 目前原型、截圖／互動基準、Nuxt 殼、五校內容及已公開素材。

**Produces:** 可用 fixture 展示的 Nuxt 首頁／五校／預約 UI、穩定 SSR HTML、正式路徑與舊 hash 相容。此階段尚不對正式 API 建單。

- [ ] 精準擷取現用資料到單一 fixture，保留六張照片卡、桌手機影片、e3 分校卡、熱點及 dialog；標註示範內容。固定型別與 schema_version，API 完成時以生成契約驗證，不維護兩份正式內容。
- [ ] 先完成首頁與義華一校的 Vue 元件遷移；以原型相同 viewport／狀態比較，解決版位、字型、影片與捲動差異後再展開其他四校。
- [ ] 將其餘五校共用頁、選校與表單拆成 props/state；原 app.js 不載入 Nuxt，不用 v-html 或 main.innerHTML 掛舊整站。
- [ ] 把 observer、timer、scroll、video 操作分別放入 onMounted/onUnmounted；禁止 setup 讀瀏覽器 API。保留 760px 分界、降動態、離開暫停、鍵盤與 dialog 焦點。
- [ ] SSR 先輸出可讀內容、圖片與 poster；動態隱藏樣式在掛載後才啟用。測試禁用 JS 時 main 的校名、介紹、地址與照片可見。
- [ ] 完成 `/`、`/campuses/{key}`、`/visit`、`/visit/{key}`，不認識的校區與路徑回真正 404。預留靜態 `/visit/manage`，不得被 `[key]` 誤判校區。
- [ ] legacy-hash plugin 只處理根路徑的 `#/` 白名單，使用 replace；涵蓋舊 home／五校／visit 及現行頁內錨點，不干擾 `#about` 或 `/visit/manage#token=...`。
- [ ] 使用頁面 metadata composable 輸出初始 title/description/canonical/OG。先以 fixture 驗證；production/live 接線在後續 CMS 任務完成。
- [ ] 確認點擊五校、上一頁／下一頁、重新整理不重複註冊事件、不重複播放影片；console 無 hydration mismatch。不得把整個首頁改成 ClientOnly 迴避問題。

Playwright 範例（真 Nuxt server，fixture 僅在 test 環境）：

```typescript
import { test, expect } from '@playwright/test';

test('直接進入校區時，停用 JS 仍有可讀內容', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const response = await page.goto('/campuses/yihua');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main').getByRole('heading', { level: 1 }))
    .toContainText('義華');
  await expect(page.locator('main').getByRole('heading', { level: 1 }))
    .toBeVisible();
  await context.close();
});

test('舊分校連結相容', async ({ page }) => {
  await page.goto('/#/renwu');
  await expect(page).toHaveURL(/\/campuses\/renwu$/);
});
```

**Validation:** web typecheck／build、Nuxt HTTP 200/404、上述 E2E 及 before/after 截圖。對一致 fixture 測試 SSR 與 hydrate，不以 mock HTML 取代 Nuxt。

## Task 3：帳號與分校作用範圍

**Files:** Create `backend/app/auth/*`、`backend/app/campuses/*`、首版 migration、`backend/app/cli.py`、`backend/tests/test_auth_scope.py`、`admin/src/{api,stores,router,layouts}`、`admin/src/views/{LoginView,UsersView}.vue`。

**Consumes:** create_app、DB session、五校 key。

**Produces:** cookie session、CSRF、permission helper、membership、bootstrap CLI、後台登入與導航。

- [ ] 先寫真實登入／登出、停權立即失效、最後總管理者保護、未登入拒絕，以及明華不能讀義華資料的測試。
- [ ] 建立 schema/migration 與五校 seed；`seed --dry-run` 可列出將新增的 key，重跑不覆寫修改過的資料。
- [ ] 實作密碼安全雜湊、session 撤銷、CSRF、Origin 檢查與登入限流，明確 production cookie 設定。
- [ ] 實作互動式 bootstrap CLI；密碼不放 command argument、log、README 或預設資料。
- [ ] 完成登入畫面、登入狀態恢復、登出、帳號管理、角色與校區設定；路由隱藏不能取代 API 授權。
- [ ] 未登入 API 回 401；登入但無 capability 回 403；無權限的特定物件讀取統一 404，避免存在性洩漏。

```python
async def test_minghua_cannot_read_yihua_booking_config(minghua_client):
    response = await minghua_client.get(
        "/api/website/v1/admin/campuses/yihua/booking")
    assert response.status_code == 404
```

此測試於 Task 6 建立設定路由後必須再次確認：同一路由總管理者可成功讀取，不能靠所有人都 404 假通過。

**Validation:** `cd backend && uv run pytest tests/test_auth_scope.py -q`；admin 登入互動測試。缺 uv 可選同等鎖版工具，須更新所有命令。

## Task 4：素材庫與安全引用

**Files:** Create `backend/app/media/*`、migration、`backend/tests/test_media.py`、`admin/src/views/MediaLibraryView.vue`、`admin/src/components/{MediaPicker,MediaCropEditor}.vue`、`admin/tests/media.spec.ts`。

**Consumes:** scope、storage config、登入。

**Produces:** media id、variant URL、processing state、usage graph、可重用素材選擇器。

- [ ] 寫入真圖片上傳／解碼、偽裝副檔名拒絕、超過大小限制、跨校存取、被引用素材不可刪等測試。
- [ ] 實作本機 storage adapter、metadata、縮圖與非同步影片處理；檔名轉隨機 key，關閉原始路徑存取。
- [ ] 完成列表、標籤、搜尋、預覽、批次上傳、alt／來源／授權、裁切焦點、版本替換與引用清單。
- [ ] 圖片替換先產生草稿；測試另一校仍引用原素材且未被覆蓋。
- [ ] 將既有 Logo、五校照片／線稿、hero／day 影片、poster 以 dry-run importer 列出，缺檔立即報錯；正式執行只寫隔離開發資料。

```python
async def test_active_media_cannot_be_deleted(admin_client, referenced_media_id):
    response = await admin_client.delete(
        f"/api/website/v1/admin/media/{referenced_media_id}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MEDIA_IN_USE"
```

`referenced_media_id` fixture 建立真實 asset、content revision 與 usage，而非 mock repository。

**Validation:** `cd backend && uv run pytest tests/test_media.py -q`；`cd admin && npm run test:unit -- media.spec.ts`。

## Task 5：全部內容欄位、審核與發布

**Files:** Create `backend/app/content/*`、migration、`backend/tests/test_content_release.py`、`admin/src/views/{HomeContent,DayStory,CampusContent,CampusTour,NewsEvents,Faq,PublishHistory,SiteSettings}View.vue`、`admin/src/components/{ContentEditor,PublishPreview,HotspotEditor}.vue`；Create importer，沿用並驗證 `content/site-fixture.json`。

**Consumes:** 權限、media references；規格第 2–4 節全部內容欄位。

**Produces:** typed content CRUD、draft/review/publish、SiteRelease、只讀公開 site endpoint、排程工作記錄。

- [ ] 寫草稿不公開、版本衝突、分校不能改共用內容、發行只套指定 revision、還原不碰預約設定的測試。
- [ ] 定義每一 ContentItem.kind 的 Pydantic payload，從目前 root 檔案抽出精確內容；不匯入 design/ 與 versions/。
- [ ] 建立每項內容的 editor；一天維持六張卡、桌／手機影片；校園場景圖替換後熱點需複核。
- [ ] 訊息內文使用結構化 blocks 與允許清單，網址驗證拒絕 javascript:；測試惡意輸入不執行。
- [ ] 完成版本／審核／排程／發布／局部還原。發布交易鎖定現行 release 指標後組合 manifest，切換原子完成。
- [ ] 排程綁定指定 revision；到期下架同樣產生新 release；權限失效、素材未就緒時記失敗，不默默發布。
- [ ] 後台預覽需權限且 no-store；未登入不能由 media URL 或 preview endpoint 讀草稿。

測試最小示例：

```python
async def test_editor_save_does_not_change_public_release(
    editor_client, public_client, yihua_content_edit
):
    before = (await public_client.get("/api/website/v1/public/site")).json()
    content_id, body = yihua_content_edit
    result = await editor_client.post(
        f"/api/website/v1/admin/content-items/{content_id}/revisions", json=body)
    assert result.status_code == 201
    after = (await public_client.get("/api/website/v1/public/site")).json()
    assert after["release_id"] == before["release_id"]
    assert after["content"] == before["content"]
```

`yihua_content_edit` fixture 回傳既有 content id 與合法 expected_version/payload；修改文字必須與現行公開內容不同。

**Validation:** backend content tests；admin 欄位保存／版本衝突／審核權限測試；對照規格內容表逐格確認有 editor。

## Task 6：各校預約模式與真實需求提交

**Files:** Create `backend/app/booking/{models,schemas,config_service,request_service,routes}.py`、migration、`backend/tests/test_booking_modes.py`、`web/app/utils/booking-action.ts`、`admin/src/views/BookingSettingsView.vue`、`web/tests/booking-action.spec.ts`。

**Consumes:** 校區 scope、已發布同意 revision、DB 交易、typed schema。

**Produces:** 六種模式設定、CTA resolver、公開設定、inquiry 建單、idempotency、限流。

- [ ] 先寫六模式／五校隔離／缺 LINE 不可啟用／config 過期／重複提交／API 失敗保留表單等測試。
- [ ] 建立 BookingConfig version、欄位及聯絡來源驗證。預設正式環境 paused；隔離 dev seed 可啟用 inquiry 並標示示範。
- [ ] 實作型別化 `resolveBookingAction`，涵蓋未選校、disabled campus、LINE、電話、外部與新路徑站內連結；不寫死任何校聯絡方式。
- [ ] 實作公開需求提交：驗證 → idempotency → 設定列鎖 → 重驗模式／version → 存案件／同意／歷程／outbox → commit → 回應。
- [ ] idempotency 紀錄與案件同交易、unique 約束；相同 key 並發時安全重播，payload 不同回 IDEMPOTENCY_CONFLICT。
- [ ] 完成設定畫面及受影響入口預覽；mode 改變不批次更新既有 request。

```python
async def test_request_retry_is_same_case(public_client, inquiry_payload):
    headers = {"Idempotency-Key": "test-inquiry-01"}
    first = await public_client.post("/api/website/v1/public/visit-requests",
                                     json=inquiry_payload, headers=headers)
    second = await public_client.post("/api/website/v1/public/visit-requests",
                                      json=inquiry_payload, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["receipt_id"] == second.json()["receipt_id"]
```

另測：建立成功後切換為 LINE，再以同 key 重播仍回原案件；未成功過的舊 version 提交回 BOOKING_CONFIG_CHANGED。

**Validation:** booking_modes pytest、resolver Vitest；API 直接越權修改 config 需拒絕。

## Task 7：容量、時段、狀態機與接待工作台

**Files:** Create `backend/app/booking/{slot_service,workflow_service}.py`、migration、`backend/tests/{test_booking_concurrency,test_visit_workflow}.py`、`admin/src/views/{VisitRequests,VisitDetail,VisitCalendar,VisitRules}View.vue`。

**Consumes:** BookingConfig、VisitRequest、scope、idempotency。

**Produces:** VisitSlot、規則與例外、容量交易、狀態機、歷程、人工補登、日曆、export。

- [ ] 為最後一個名額、不同 idempotency keys 的並發提交先寫真 PG 測試；使用獨立連線，不共用測試 transaction。
- [ ] 建立 slot 規則／單次時段、例外日、Asia/Taipei 轉換、查詢區間限制、提前時間與開放天數驗證。
- [ ] 以時段列鎖保護容量；從有占位的案件計算用量，過期占位在鎖內處理。建案、狀態、紀錄、outbox 同交易。
- [ ] 實作規格狀態機、人工補登、承辦人、聯絡紀錄、跟進時間、改期、取消與未到場；confirmed 必須有 slot。
- [ ] inquiry 確認時可選既有單次時段；分校管理者可建立單次時段，接待人員只能選可用時段。
- [ ] 改期固定次序鎖住新舊時段，新格不足時整筆回滾；取消重試不重複釋放。
- [ ] 完成清單／詳情／日曆／規則 editor、篩選與分頁；CSV 匯出權限、校區 filter、防公式注入與稽核。
- [ ] 手動關閉或降低時段容量時列出受影響案件；占位以上容量禁止降低，禁止自動取消。

```python
import asyncio

async def test_one_slot_cannot_accept_two_families(
    public_client, second_public_client, slot_payload
):
    path = "/api/website/v1/public/visit-requests"
    a, b = await asyncio.gather(
        public_client.post(path, json=slot_payload,
                           headers={"Idempotency-Key": "capacity-a"}),
        second_public_client.post(path, json=slot_payload,
                                  headers={"Idempotency-Key": "capacity-b"}),
    )
    assert sorted([a.status_code, b.status_code]) == [201, 409]
    rejected = a if a.status_code == 409 else b
    assert rejected.json()["error"]["code"] == "SLOT_FULL"
```

測試同時確認 DB 只有一個有效占位；另覆蓋人工待確認到期、取消與提交競爭、設定切換與提交競爭、改期失敗保留原格、手動／自動確認。

**Validation:** 使用真 PostgreSQL 跑 concurrency/workflow tests；列出資料庫引擎與測試結果，不提供連線密碼。

## Task 8：Nuxt CMS 接線、SSR 更新與私有預覽

**Files:** Modify `web/app/composables/{usePublishedSite,useCampusBooking}.ts`、官網 Vue 元件、`web/nuxt.config.ts`；Create `web/app/{composables/useDraftPreview.ts,pages/preview.vue}`、`web/server/routes/{sitemap.xml,robots.txt}.get.ts`、`web/tests/content.spec.ts`、`tests/e2e/{public-site,release-freshness,private-preview}.spec.ts`。不把原 app.js 接成第二套 CMS。

**Consumes:** public site／booking／slots／submission API、typed resolver、已遷移 Nuxt 元件與 fixture。

**Produces:** 真實官網讀寫、SSR metadata、發布新鮮度、受授權保護的草稿預覽與 production build。

- [ ] 先測同一 SSR 頁面的 header/footer/內容使用相同 release；發布新 revision 後，HTTP 新請求、重新整理與站內換頁都讀到新內容。
- [ ] `usePublishedSite()` 從 fixture 切到公開 API，伺服器與 hydrate 共用 payload；同一頁多元件不得各發一次整站查詢。頁面導航必須更新，不能永久快取同一 key。
- [ ] 先接公開內容、header/footer 與 useSeoMeta，再接所有 CTA。直接進 `/visit/{key}` 也要即時讀 mode；表單保留輸入直到持久化成功。
- [ ] 把 API 503、401、409、429 與切校取消請求處理完整。首次 SSR 無內容回 503，未知校區回 404；無假資料 fallback，不能把伺服器錯誤轉成空白 200。
- [ ] `/preview` 採 client-only 私有殼、先確認管理 session，再讀 scoped API；回 private/no-store 與 noindex。公開 SSR 不轉送登入 cookie、token 或讀管理端 DTO。
- [ ] 依發布內容產生 metadata/canonical/OG/sitemap；網站網址用 `NUXT_PUBLIC_SITE_ORIGIN`，不信任請求 Host。noindex 開關及 visit/preview/admin 排除規則要可測。
- [ ] 第一版不開 SWR、ISR、prerender 或共享 HTML 快取；以本機 release 切換測試證明新請求不讀舊版。後續啟用快取時需另補失效與多程序測試。
- [ ] `web/public/` 與 Nuxt 正式輸出只含公開資產。測試 HTTP 無法讀 repo 原始碼、環境檔、備份、私有素材、design/versions 與原型 preview。
- [ ] production 應用環境拒絕 fixture 模式；在明確 test 環境可用 fixture 跑 Nuxt build/start 視覺驗證，畫面必有示範標記且不能真實提交。
- [ ] 以同一 Nuxt 元件完成 localhost 預覽及登入草稿預覽；重新核對原型快照仍可離線開啟。兩種預覽分開回報，不產生假稱為最新版的單 HTML。

Resolver 測試示例（`web/tests/booking-action.spec.ts`）：

```typescript
import { describe, it, expect } from 'vitest';
import { resolveBookingAction } from '../app/utils/booking-action';
describe('分校預約入口', () => {
  it('未選校先選校', () => {
    expect(resolveBookingAction(null, null).kind).toBe('choose_campus');
  });
  it('暫停不產生可送出表單連結', () => {
    const action = resolveBookingAction('renwu', {
      mode: 'paused', version: 2, message: '暫停參觀預約'
    });
    expect(action.kind).toBe('paused');
    expect(action.href).toBeNull();
  });
});
```

**Validation:** `cd web && npm run typecheck`、`npm run test:unit`、`npm run build`、`npm run start`；root `npm run test:e2e` 序列執行。HTTP 驗證 release/metadata/status，再驗證 1440/1024/390/375px、reduced-motion、Tab、Escape、焦點返回及無水平溢出。

## Task 9：通知 worker、家長安全管理與排程

**Files:** Create `backend/app/notifications/*`、`backend/app/workers/*`、`backend/app/booking/access_service.py`、`backend/tests/test_notifications.py`、`admin/src/views/NotificationsView.vue`、`web/app/pages/visit/manage.vue`。

**Consumes:** 交易式 outbox、案件／時段、排程發布記錄。

**Produces:** durable jobs、站內通知、本機 Email sink、重試、占位到期、家長取消／改期申請。

- [ ] 寫 commit 後才通知、寄送失敗案件保留、去重、worker crash lease 恢復、占位到期／提醒過期等測試。
- [ ] worker claim 工作採 DB lease，成功 ack；重試記 attempt/next_attempt_at/error_code，達上限保留 failed 供管理者重試。
- [ ] Email adapter 初期接本機 sink；部署環境無配置時顯示未配置，不 fake sent。整合測試只用測試地址。
- [ ] 串接新案／改期／取消／到期／提醒與站內 inbox，依校區通知；inactive／scope 已移除人員不能收到後續個資。
- [ ] 對家長高熵 token 只存 hash。分享 URL 為 `/visit/manage#token=...`，前端讀取後立即 replaceState 清除，再以 POST exchange 換受限 cookie session。
- [ ] 管理頁 no-store/noindex/no-referrer，不載入第三方 analytics；明確截止時間、取消、申請改期。改期申請保留原格直到園方核准。
- [ ] 實作發布排程與預約規則產生器／占位到期工作，各自使用相同 service，不複製業務判斷。

```python
async def test_mail_failure_does_not_lose_request(
    public_client, inquiry_payload, run_outbox_once, failing_mail_adapter,
    db_session
):
    from uuid import UUID
    from app.booking.models import VisitRequest
    response = await public_client.post(
        "/api/website/v1/public/visit-requests", json=inquiry_payload,
        headers={"Idempotency-Key": "mail-fails"})
    assert response.status_code == 201
    result = await run_outbox_once(mail_adapter=failing_mail_adapter)
    assert result["failed"] == 1
    request = await db_session.get(VisitRequest, UUID(response.json()["receipt_id"]))
    assert request is not None
    assert request.status == "new"
```

此測試另斷言案件存在、outbox failed、重試後只有一份對應通知。家長 token 測試涵蓋竊改／過期／撤銷、其他案隔離、取消重播、改期滿額。

**Validation:** notifications tests、家長 manage E2E、worker 重啟後可恢復未完成工作；無真實訊息發出。

## Task 10：營運、統計、維護與完整契約

**Files:** Create `backend/app/operations/*`、`backend/tests/test_operations.py`、`admin/src/views/{Dashboard,Analytics,Audit,Policies}View.vue`、`contracts/openapi.json`、`scripts/{export_openapi,backup_website,restore_website}`（使用適合語言副檔名）、`docs/website-admin/{README,operations,acceptance}.md`。

**Consumes:** 已實作的內容、案件、通知、角色及 jobs。

**Produces:** 權限統計、SEO 設定、audit、retention、備份還原、型別生成、可重現命令。

- [ ] 寫外連點擊不增加預約數、跨校 dashboard 無資料、匯出不漏校、audit 遮罩、CSV 公式防護等測試。
- [ ] 收集允許 analytics 事件並在 server 產生建立／確認／完成事件；設定事件去重與無 PII 規則。
- [ ] 完成 `POST /public/analytics-events` 的點擊 allowlist 與限流；惡意提交 request_created/visit_confirmed 不得改變成效統計。
- [ ] Dashboard 列出今日參觀、待跟進、待發布、缺漏設定與通知失敗；全站設定含 title/description/分享圖/noindex、隱私文案版本。
- [ ] 加入保存政策、dry-run 清理報告、到期匿名化與 audit；預設不開啟自動真實清理。測試不破壞外鍵、統計或未結案。
- [ ] 實作備份／還原指令並對隔離測試 DB + 測試 media 做演練；還原前確認目標為隔離環境，不使用真實 DB。
- [ ] 後端生成 OpenAPI 與共用 contracts 型別，web/admin 共用型別並各自使用符合 SSR／SPA 的 client。新增 root `contract:generate` / `contract:check`；check 不變更檔案且非零表示 drift。
- [ ] 完成 web/admin build/typecheck/unit、後端測試、公開官網測試、E2E；依序執行，記錄失敗原因並修正。
- [ ] 文件列出確實跑過的啟動、migration（隔離）、seed、bootstrap、worker、測試、備份／還原命令；不混用已存在園務 repo 指令。

**Validation:** `cd backend && uv run pytest -q`；web/admin 分別執行 `npm run typecheck`、`npm run test:unit`、`npm run build`，web 再以 `npm run start` 驗證 production 輸出；root `npm run contract:check`、`npm run test:website`、`npm run test:e2e`。只在修改／失敗／未解疑慮需要時重跑已通過檢查。

## Task 11：逐條驗收與交付

**Files:** Modify `docs/website-admin/acceptance.md`、root README（只新增本次啟動連結與必要修正，不覆蓋既有設計紀錄）。

**Consumes:** 所有任務的測試證據、baseline。

**Produces:** 下表完整結果、已完成／部分完成／未驗證清單。

| ID | 驗收情境 | 證據 |
|---|---|---|
| A01 | 現有首頁、五校、一天影片與照片卡、探索、消息、FAQ 欄位都有 editor | 後台逐頁測試與欄位對照 |
| A02 | 修改一校不影響另一校；role/scope 在 API 生效 | 正負權限整合測試 |
| A03 | 草稿不可公開；發布／指定版本還原正確；預約不跟著回滾 | release tests + E2E |
| A04 | 圖片／影片／poster 替換、裁切、引用保護、私有素材、熱點複核 | media/content tests |
| A05 | 每校六模式切換，缺連結不啟用，原案件仍存在 | booking modes tests |
| A06 | 頁首、頁尾、首頁分校、分校頁、探索等所有預約 CTA 一致 | 入口矩陣 E2E |
| A07 | 表單成功持久化；失敗保留輸入；重送只建一案 | API + public UI tests |
| A08 | 舊 config version 被拒；成功後重播仍回原結果 | transaction race tests |
| A09 | 最後一格並發只有一組；取消／改期／到期無超收 | 真 PG concurrency tests |
| A10 | 規則、例外日、提前時間、滿額、手動／自動確認 | slot/workflow tests |
| A11 | 人工補登、聯絡、承辦、狀態、日曆、匯出同源且有權限 | 接待 E2E + export tests |
| A12 | 失敗通知可重試、無重複、案件不丟失、worker 可恢復 | outbox/worker tests |
| A13 | 家長只讀自己的案件，安全取消／申請改期／token 過期 | access E2E |
| A14 | 點擊和預約分開；Dashboard 與分析不漏校或 PII | operations tests |
| A15 | 審核、排程、到期下架、併發編輯與權限失效正確 | publish job tests |
| A16 | noindex 預設、SSR title/description/OG/canonical、正式索引開關與 sitemap 排除規則 | 原始 HTML + sitemap 測試 |
| A17 | 保存政策 dry-run／匿名化、備份還原有實測 | 隔離資料演練紀錄 |
| A18 | 1440/1024/390/375px、鍵盤、降動態、無水平溢出 | before/after 截圖及 E2E |
| A19 | 原型快照可離線開啟；新版 Nuxt localhost／授權預覽可用，fixture 不會真實提交 | 快照 checksum/offline + Nuxt preview E2E |
| A20 | web/admin 共用 OpenAPI 型別，fresh setup、Nuxt build/start、admin build、測試可重現 | command log 與 dependency locks |
| A21 | 五校正式路徑、直接開啟／刷新、前進後退、舊 hash 相容、未知校區 404 | Nuxt route E2E + HTTP status |
| A22 | 主要內容在 SSR HTML，禁用 JS 仍可讀；不靠整頁 ClientOnly | raw HTML + no-JS browser |
| A23 | 發布後新 SSR／刷新／站內換頁讀新 release；hydrate 不重複讀取；無跨 request 私密資料 | release freshness 與 scope tests |
| A24 | 無 hydration mismatch，進出頁清理動畫／影片；私有資產與原始碼不被靜態服務暴露 | console/lifecycle + HTTP 邊界測試 |

- [ ] 對每一列記錄 pass/fail/not-run、測試名稱或檔案路徑；缺外部設定與已知限制另列。
- [ ] 核對變更清單，只包含授權工作。若 commit，逐檔／逐 hunk 暫存自身變更，禁止 `git add .` 夾帶舊修改。
- [ ] 收尾報告列出本機後台／官網入口、測試結果、資料庫是否操作、通知是否外發、是否部署、待園方補的真實資料。
- [ ] 未驗證的真實通知、正式儲存與部署不可寫成完成；其餘不依賴外部的功能不能以此為由停工。

本次 Codex 只產出規格與計畫，上述 checkbox 由 Claude 在實作時更新。此文件內的測試碼是待實作的契約示例，尚未在目前原型中執行；不可把它當作已通過的測試結果。
