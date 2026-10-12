# 後台與官網內容一批補強 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 10-12 盤點挑出的第 2、4、5、6、7、8 項與收尾技術債（規格第 2–9 節）。

**Architecture:** 同一分支分四階段（A 收尾、B 後台案件、C 內容與預覽、D 區域分析），每階段結束跑閘門。後端 FastAPI＋SQLAlchemy＋Alembic（唯一 migration 只新增 `contact_phrase_sets`）；公開官網 Nuxt 4 透過 `content-overlay.ts` 疊後台內容；後台 Vue 3＋Element Plus，內容編輯沿用 `ContentEditor`＋即時預覽協定。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async、Alembic、PostgreSQL、pytest；Nuxt 4／Vue 3／TS、Vitest；Vue 3＋Pinia＋Element Plus＋Vite、Vitest；Playwright stack e2e。

**Spec:** `docs/specs/2026-10-12-admin-batch-design.md`（各任務的「規格」欄指到節次；實作者兩份都要讀）

## Global Constraints

- worktree：`~/Repositories/ivy-website-wt/admin-batch-20261012`，分支 `feature/admin-batch-20261012`。所有指令在這個目錄跑，不碰 `~/Desktop/ivy-website-admin`。
- Node 22：`source ~/.nvm/nvm.sh; nvm use 22`（source 會 exit 3，一律用分號串接，不要用 `&&`）。
- 後端測試：`cd backend; export WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_batch1012_test WEBSITE_SESSION_SECRET=test-secret-0123456789abcdef0123456789abcdef WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_batch1012_test; uv run pytest tests/<檔>.py -q`（設定的 env 前綴是 `WEBSITE_`）。**subagent 只跑單檔前景**；全套由主 session 背景跑。
- 同時只跑一組測試（8GB RAM）。Vitest 跑單檔：`npm --prefix admin exec vitest run src/__tests__/<檔>`、`npm --prefix web exec vitest run tests/<檔>`。
- FastAPI 0.136.1 釘版，勿升；不新增 Python／npm 依賴。
- 權限一律走 `backend/app/auth/permissions.py` 的 capability 表，路由不寫角色判斷。
- 動到 API schema 後：`npm run contract:generate` 再 `npm run contract:check`。
- 顏色走 token，不寫 rgba／oklch 字面值；圖示只用 Phosphor Regular。
- 官網不寫開發輔助用字（操作說明、載入／狀態字）；後台文案直白、繁體中文台灣用語。
- 歷程不放個資：只記欄位名，不記內容。
- git：只 `git add <明確路徑>`，不用 `git add .`／`-A`／`commit -a`，不 stash、不 reset。commit 用 Conventional Commit、繁體中文，結尾空一行加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 改到 `web/server/data/site-fixture.json` 一定要再跑 `backend/tests/test_media_slots.py`、`test_content_initialize.py`。
- 不發真實通知、不連外部服務。

## Review Focus

- 後台改家長資料時，家長同時用修改連結改：兩邊共用 `details_version`，後送者要 409，不可覆蓋（Task B1 測試）。
- 招生那筆在招生端改過某欄、又在官網後台改同一欄：招生那欄不可被蓋掉，回應要列在 `admissions_skipped_fields`（Task B1 測試）。
- 環境頁草稿形狀不符（少一張卡、多一個 meal、時間倒序）：官網整份退回內建，不可半套破版（Task C6 測試）。
- 片語含「javascript:」、換行、重複、超過 20 句：PUT 回 422，不寫入（Task B4 測試）。
- 自訂家長影片清空成 `[]`：關於頁該校不出影片；設回 `None` 恢復內建（Task C4 測試）。

---

## 階段 0：環境

### Task 0: 建測試庫

- [ ] `createdb ivy_website_batch1012_test`
- [ ] 帶上 Global Constraints 的後端環境變數，`cd backend; uv run alembic upgrade head`
- [ ] 跑一支小測試確認可用：`uv run pytest tests/test_health.py -q`（帶上面的測試庫環境變數）。

---

## 階段 A：收尾（規格 §2、§8、T1–T8、T10）

### Task A1: LINE 通知網址外開瀏覽器（§2）

**Files:**
- Modify: `backend/app/notifications/service.py:129-165`
- Test: `backend/tests/test_line_notifications.py`

**Interfaces:**
- Produces: `admin_visit_url(admin_origin, receipt_id, *, external_browser: bool = False) -> str | None`；`line_text` 內部改呼叫 `external_browser=True`。Email（`service.py:236`）維持預設 False。

- [ ] **Step 1: 寫失敗測試**（加在 `test_line_notifications.py`）

```python
from app.notifications.service import admin_visit_url, line_text

def test_line_text_url_opens_external_browser():
    text = line_text("新的參觀預約", "義華校", "V-ABC123", "https://admin.example.com/")
    assert text.splitlines()[-1] == "https://admin.example.com/admin/visit-requests/V-ABC123?openExternalBrowser=1"

def test_email_url_has_no_line_param():
    assert admin_visit_url("https://admin.example.com", "V-ABC123") == "https://admin.example.com/admin/visit-requests/V-ABC123"
```

另外找既有 Email 內文測試（`test_notification_email.py` 裡組出後台網址的那條），補一行 `assert "openExternalBrowser" not in body`。

- [ ] **Step 2:** 跑 `tests/test_line_notifications.py`，新測試 FAIL。
- [ ] **Step 3: 實作**

```python
def admin_visit_url(admin_origin: str | None, receipt_id: str | None, *, external_browser: bool = False) -> str | None:
    if not admin_origin or not receipt_id:
        return None
    url = f"{admin_origin.rstrip('/')}/admin/visit-requests/{receipt_id}"
    # LINE 內建瀏覽器擋 Google 登入：openExternalBrowser=1 是 LINE 官方參數，點開改用手機預設瀏覽器。
    return f"{url}?openExternalBrowser=1" if external_browser else url
```

`line_text` 裡改成 `admin_visit_url(admin_origin, receipt_id, external_browser=True)`。

- [ ] **Step 4:** 跑 `test_line_notifications.py`、`test_notification_email.py`、`test_notifications.py` 全 PASS（既有斷言若比對整段 LINE 文字，跟著改）。
- [ ] **Step 5:** commit `fix(notifications): LINE 通知的案件連結改開外部瀏覽器`

### Task A2: 提早完成的案件在列表顯示到場日（§8）

**Files:**
- Modify: `backend/app/booking/` 中 `list_visit_requests` 所在檔（`grep -rn "def list_visit_requests" backend/app`）與 `VisitRequestDetailOut`（`backend/app/booking/schemas.py`）
- Modify: `admin/src/` 的 `groupVisitsByDay`（`grep -rn "groupVisitsByDay" admin/src`）、`VisitListRow.vue`
- Modify: `contracts/`（`npm run contract:generate`）
- Test: `backend/tests/test_visit_complete_early.py`、admin 端 `groupVisitsByDay` 所在的測試檔

**Interfaces:**
- Produces: API 欄位 `VisitRequestDetailOut.visited_on: date | None`（有場次＝場次日期；無場次且 completed＝最後一筆 `completed` 歷程的台北日期；其餘 None）。admin 型別 `visited_on?: string | null`。

- [ ] **Step 1: 後端失敗測試**（`test_visit_complete_early.py`，沿用該檔既有 helper 建一筆提早完成的案件）

```python
async def test_list_shows_visited_on_for_early_completed(admin_client, ...):
    # 建兩筆：A 正常場次在 today+3；B 原本 today+5，今天提早完成（slot 釋出）
    ...
    rows = (await admin_client.get("/api/website/v1/admin/visit-requests?status=completed&sort=visit_asc")).json()["items"]
    b = next(r for r in rows if r["id"] == b_id)
    assert b["slot"] is None
    assert b["visited_on"] == today_local().isoformat()
    a_row = ...  # 有場次的那筆
    assert a_row["visited_on"] == a_row["slot"]["slot_date"]
    # visit_asc：B（今天）排在 A（today+3）前面
    assert [r["id"] for r in rows if r["id"] in (a_id, b_id)] == [b_id, a_id]
```

（查詢參數與回應形狀以該路由現況為準；先讀 `test_visit_complete_early.py` 與列表路由。）

- [ ] **Step 2:** 跑該檔，FAIL（沒有 `visited_on`）。
- [ ] **Step 3: 後端實作**
  - 在列表查詢加 scalar subquery：

```python
completed_on = (
    select(func.max(func.timezone("Asia/Taipei", VisitRequestEvent.created_at)))
    .where(VisitRequestEvent.visit_request_id == VisitRequest.id, VisitRequestEvent.event_type == "completed")
    .correlate(VisitRequest)
    .scalar_subquery()
)
visited_on = func.coalesce(VisitSlot.slot_date, cast(completed_on, Date))
```

  （`created_at` 欄名、slot join 方式以現有程式為準；`timezone()` 對 timestamptz 回傳台北當地時間。）
  - `visit_asc`／`visit_desc` 排序改用 `visited_on`，第二鍵仍是場次開始時間，`nulls_last()`。
  - `VisitRequestDetailOut` 加 `visited_on: date | None = None`，列表組回應時填入。
- [ ] **Step 4:** 跑該檔 PASS；`npm run contract:generate; npm run contract:check`。
- [ ] **Step 5: 前端失敗測試**（`groupVisitsByDay` 測試檔）：一筆 `slot: null, visited_on: '2026-10-12'` 要分在 10-12 那組，不是「沒有場次」。
- [ ] **Step 6: 前端實作**
  - `groupVisitsByDay` 取日期改 `row.slot?.slot_date ?? row.visited_on ?? null`。
  - `VisitListRow.vue` 時間欄：沒有 slot、有 `visited_on` 時顯示「提早到場」（第二行顯示 `M/D`，沿用該元件既有日期格式函式）。
- [ ] **Step 7:** 跑該測試檔＋`VisitListRow` 相關測試 PASS；`npm --prefix admin run typecheck`。
- [ ] **Step 8:** commit `fix(admin): 提早完成的案件在列表依到場日分組`

### Task A3: 官網收尾（T1、T2、T8）

**Files:**
- Modify: `web/app/components/HeroVideo.vue:60-82`
- Modify: `web/app/types/site-content.ts`（`HeroContent.ctaLabel/ctaHref`、`FooterContent.titleFontCredit/orgSiteLink`、`GeneratedTourScenes`、`isGeneratedTourScenes`）
- Modify: `web/app/components/EnvironmentContent.vue:11,62`、`web/app/utils/public-copy.ts`（`grep -n GeneratedTour web/app/utils/public-copy.ts`）、`web/app/utils/content-overlay.ts:804` 註解
- Modify: `web/server/data/site-fixture.json`（刪 `home.hero.ctaLabel/ctaHref`、`footer.titleFontCredit/orgSiteLink`）、`web/tests/fixtures/overlay-baseline-20260925.json` 同欄位
- Modify: `web/tests/content.spec.ts`、`campus-old-site-content.spec.ts`、`environment.spec.ts`、`site-structure.spec.ts:149`
- Modify: `web/server/middleware/preview-headers.ts`；Test: 該 middleware 既有測試（`grep -rln preview-headers web/tests`）
- **注意**：`booking.ctaLabel／ctaLabelEn` 有人用（SiteHeader），**不要刪**。只刪 `home.hero` 的 `ctaLabel／ctaHref`。

- [ ] **Step 1 (T8) 失敗測試**：在 preview-headers 測試加 `/Visit/Manage`、`/VISIT/manage/`、`/Preview`、`/Admin/x` 四個路徑，斷言分別帶 `Cache-Control: private, no-store`、`X-Robots-Tag: noindex, nofollow`，`/Visit/Manage` 另有 `Referrer-Policy: no-referrer`。跑測試 FAIL。
- [ ] **Step 2 (T8) 實作**：`const path = (event.path.split('?')[0] ?? '/').toLowerCase()`，註解一行說明 Nuxt 路由不分大小寫。跑 PASS。
- [ ] **Step 3 (T1)**：刪 `copyDrafts`、`useRoute`、`HeroText` 型別與 2026-09-23 比稿註解；改成 `const heroText = computed(() => props.hero)`（保留 `heroText` 名稱，`web/tests/hero-brush-20260930.spec.ts` 用字串比對它）。`grep -rn "copy=" web/app web/tests` 確認無殘留。
- [ ] **Step 4 (T2)**：刪型別欄位與 `GeneratedTourScenes`／`isGeneratedTourScenes`；`Campus.tourScenes` 改 `TourScene[]`；`EnvironmentContent.vue:62` 改 `scenes: campus.tourScenes`；`public-copy.ts` 的 GeneratedTourScenes 分支刪掉；兩份 web JSON 刪欄位；測試裡對這些欄位的斷言與 fixture 物件刪掉（`content.spec.ts:271` 的測試名改成「campus_tour 整組取代 tourScenes；舊熱點不帶」，內容去掉佔位樣板那段）。
- [ ] **Step 5:** `npm --prefix web run typecheck`；`npm --prefix web exec vitest run tests/content.spec.ts tests/campus-old-site-content.spec.ts tests/environment.spec.ts tests/site-structure.spec.ts tests/public-copy.spec.ts tests/hero-brush-20260930.spec.ts` 加 preview-headers 測試檔，全 PASS。
- [ ] **Step 6:** 因為改了 web fixture：跑後端 `test_media_slots.py`、`test_content_initialize.py` PASS（`ctaLabel` 斷言是 booking 的，不受影響）。
- [ ] **Step 7:** commit `chore(web): 拿掉 ?copy= 比稿參數與沒人讀的欄位，預覽標頭路徑不分大小寫`

### Task A4: 後端沒人讀的欄位（T3）

**Files:**
- Modify: `backend/app/config.py:40`、`backend/.env.example:9`、`backend/tests/test_config_isolation.py:81`
- Modify: `backend/app/content/schemas.py:1172-1176`（`hero_focus` 改 `Field(default=None, exclude=True)`），campus_profile 公開輸出確認經 `_public_without_retired` 剔除（`grep -n _public_without_retired backend/app`）
- Modify: `backend/app/media/site_import.py:176`（不再寫 `hero_focus`）
- Modify: `admin/src/views/CampusProfileView.vue:33,55`、`admin/src/api/types.ts:355`、`admin/src/api/labels.ts:756`、`admin/src/api/contentFieldLabels.ts:64`、`admin/src/__tests__/mediaSlots.test.ts:337,346`
- Test: `backend/tests/test_media_slots.py:220,399,462`、`backend/tests/test_campus_status_media_tags.py` 或公開輸出測試

- [ ] **Step 1: 失敗測試**：在 `test_media_slots.py` 加一條：已發布 campus_profile revision 的 JSON 含 `hero_focus` 時，公開輸出（published-site 的該校）不含 `hero_focus` 鍵。`site_import` 的斷言（399、462 行）改成不含 `hero_focus`。FAIL。
- [ ] **Step 2: 實作**（照上列檔案）。`hero_focus` 欄位保留在 schema 以吃舊 revision，不再輸出、不再寫入。
- [ ] **Step 3:** 刪 `indexing_enabled`、`.env.example` 該行、`test_config_isolation.py:81` 斷言。`grep -rn indexing_enabled backend/app backend/tests` 為空。
- [ ] **Step 4:** 跑 `test_media_slots.py`、`test_config_isolation.py`、`test_campus_status_media_tags.py` PASS；admin `mediaSlots.test.ts` PASS、admin typecheck；`npm run contract:generate; npm run contract:check`。
- [ ] **Step 5:** commit `chore(backend): 拿掉 indexing_enabled 與分校頁首屏焦點舊欄位`

### Task A5: 兩份 fixture 合一（T4、T5）

**Files:**
- Delete: `content/site-fixture.json`
- Modify: `deploy/api.Dockerfile`（`COPY content /app/content` → `COPY web/server/data/site-fixture.json /app/content/site-fixture.json`）
- Modify: `tests/stack/start-api.sh:62`（`../web/server/data/site-fixture.json`）、`scripts/check-font-coverage.py:18`
- Modify: `backend/tests/test_content_initialize.py:10`、`test_curriculum_page_content.py:22-23`、`test_site_structure_content.py:305`、`test_admission_content.py:15-16`、`test_about_page_content.py:23-24`、`test_home_news.py:12`、`test_content_publishing_workflow.py:28`
- Modify: `web/server/data/site-fixture.json` 的 `_todo`（四校「FB 借用機構粉專」→「LINE 官方帳號待園方提供」；第四章段落文字留給 C6）
- Modify: `docs/website-admin/README.md`、`deploy/README.md:1078` 若有提到舊路徑的說明（正式站指令路徑 `/app/content/site-fixture.json` 不變）
- Test: `deploy/tests/`（`python3 -m unittest discover -s deploy/tests`）

- [ ] **Step 1:** 先記錄現況：`python3 - <<'EOF'` 比較兩份 JSON 哪些鍵不同（只供自己判斷，不進 repo）。
- [ ] **Step 2:** 後端測試裡 `FIXTURE` 一律指向 `web/server/data/site-fixture.json`；「兩份 fixture 相同」的三支測試（about、curriculum、admission）改成「初始化後的 revision 內容＝web fixture 對應段落」。刪 `WEB_FIXTURE` 重複變數。
- [ ] **Step 3:** 刪 `content/site-fixture.json`（`git rm content/site-fixture.json`），改 Dockerfile、start-api.sh、check-font-coverage.py。
- [ ] **Step 4:** 跑 `test_content_initialize.py`，依實際結果更新初始化筆數（四校 campus_tour 會多建；在測試註解寫明原因：web fixture 是營運版）。再跑其餘六支改過路徑的測試檔 PASS。
- [ ] **Step 5:** `python3 -m unittest discover -s deploy/tests` PASS（若有測試檢查 Dockerfile 的 COPY 行，跟著改）；`python3 scripts/check-font-coverage.py` 能跑完（結果與改前一致或只多出 web fixture 本來就有的字）。
- [ ] **Step 6:** `_todo` 文字更新；跑 `test_media_slots.py`。
- [ ] **Step 7:** commit `chore(content): 內容 fixture 只留 web 那份`

### Task A6: 跨日測試（T6）

**Files:**
- Modify: `backend/tests/test_booking_concurrency.py:186-190`
- Modify: `tests/stack/db.ts:41-51`

- [ ] **Step 1:** `_last_slot_payload`：`slot_date` 改從建好的場次讀（`_open_slot` 回傳或用 slot_id 查 `/admin/slots`），不再另外呼叫 `today_local()`。若 `_open_slot` 內部已算好日期，讓它一起回傳。
- [ ] **Step 2:** `makeFollowUpDue` 的 SQL 改：

```sql
UPDATE recruitment_visits
   SET follow_up_at = GREATEST(now() - interval '1 hour',
                               (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei')) AT TIME ZONE 'Asia/Taipei')
 WHERE child_name = :'child' AND follow_up_at IS NOT NULL
RETURNING id;
```

註解寫明：台北 00–01 點時 now()-1h 落在昨天，招生「今天要聯絡」會漏掉。
- [ ] **Step 3:** 跑 `test_booking_concurrency.py` PASS；`npx tsc --noEmit -p tests/stack`（若無 tsconfig 則跳過，stack 測試留到閘門跑）。
- [ ] **Step 4:** commit `test: 修兩支跨日會紅的測試`

### Task A7: 換帳號不自動登回（T7）

**Files:**
- Modify: `admin/src/router/unauthorized.ts`（`redirectToLoginOnUnauthorized`）、`admin/src/stores/auth.ts`（`previousUserId`、`restoreSession`）、`admin/src/router/index.ts:103-136`
- Modify: `admin/src/views/LoginView.vue`（顯示原因：換了帳號）
- Modify: `deploy/README.md:550`（已知限制改成已修，附 commit）
- Test: 新增 `admin/src/__tests__/authGuardSwitchUser.test.ts`（以真的 `authGuard` 建 router）

**Interfaces:**
- Produces: auth store `previousUserId: string | null`；`restoreSession(options?: { expectUserId?: string | null }) => Promise<'restored' | 'other-user' | 'none'>`（若現有簽名不同，保留舊呼叫相容）。

- [ ] **Step 1: 失敗測試**：
  1. store 有 user A → `redirectToLoginOnUnauthorized` 觸發（reason `session-changed`）→ store 記 `previousUserId='A'`、user 清空。
  2. mock `/auth/me` 回 user B → 導到 `login?reason=session-changed&redirect=/visit-requests` → guard 回 `true`（停在登入頁），user 仍為 null，`previousUserId` 保留，登入頁顯示「這個瀏覽器已改用其他帳號登入」。
  3. 同樣情境 `/auth/me` 回 user A → guard 導回 `/visit-requests`。
  4. 沒有 `previousUserId`（直接開登入頁書籤）→ 照舊恢復任何人的 session（行為不變）。
- [ ] **Step 2:** 跑 FAIL。
- [ ] **Step 3: 實作**：清 session 前存 `previousUserId`；guard 的 login 分支在 `reason` 為 `session-changed`／`other-user` 且 `previousUserId` 有值時，取得 `/auth/me` 的 user，id 不同就不設進 store、回 `true` 並帶 `reason=other-user`；同人才恢復。登入成功後清掉 `previousUserId`。
- [ ] **Step 4:** 跑新測試＋既有 router／auth 測試（`grep -rln "authGuard\|restoreSession" admin/src/__tests__`）PASS；admin typecheck。
- [ ] **Step 5:** 改 `deploy/README.md:550`。commit `fix(admin): 別的分頁換了帳號時不再自動以新帳號登回原頁`

### Task A8: 文件（T10，不含要等 C 階段才成立的註解）

**Files:**
- Modify: `docs/website-admin/acceptance.md`（A18、A19、A21、A22、A23、A24、第 269 行）、`docs/website-admin/baseline.md:13`
- Modify: `web/app/components/SiteHeader.vue:10-14` 註解、`CLAUDE.md:70`

- [ ] **Step 1:** 讀 `acceptance.md` A18–A24 與 269 行；A21、A22 證據改成現存的測試檔名（`ls backend/tests tests/stack web/tests admin/src/__tests__` 對照）；重複列合併；A23 寫明缺什麼或改通過（依現況判斷，寫出判斷依據）。
- [ ] **Step 2:** `baseline.md:13` 改寫四校已有真場景；`SiteHeader.vue` 註解與 `CLAUDE.md:70` 依 `PILL_PAGES` 現況（五個頁面捲過 40px 收、900px 以下全站收）改寫。先讀 `SiteHeader.vue` 的 `PILL_PAGES` 確認頁面清單。
- [ ] **Step 3:** commit `docs: 更新驗收表與頁首收合說明`

### 閘門 A（主 session）

- [ ] `npm --prefix web run typecheck; npm --prefix web run test:unit`
- [ ] `npm --prefix admin run typecheck; npm --prefix admin run test:unit`
- [ ] 後端全套 pytest（背景）
- [ ] `npm run contract:check; python3 -m unittest discover -s deploy/tests`
- [ ] stack e2e：起 stack 跑 `admin-visit*`、`admissions-follow-up` 相關 spec；Playwright 截 1440／390 列表「提早到場」。

---

## 階段 B：後台案件（規格 §3、§4）

### Task B1: 後台修改家長資料 API＋招生同步（§3.1、§3.2）

**Files:**
- Modify: `backend/app/admissions/booking_link.py`（抽出轉換函式）
- Modify: `backend/app/booking/schemas.py`（`AdminDetailsUpdate`、回應 `AdminDetailsUpdateOut`）
- Modify: `backend/app/booking/workflow_service.py`（`update_details_by_staff`）
- Modify: 後台案件路由檔（`grep -rn '"/{visit_request_id}/no-show"\|no-show' backend/app/booking/*routes*.py`）
- Modify: `backend/app/audit/`（若有 action 白名單）與 `test_audit_actions.py`
- Create: `backend/tests/test_admin_visit_details.py`

**Interfaces:**
- Consumes: `details_version(db, id)`、`VersionConflict`、`history.record_event`、`enqueue_parent_email(db, vr, PARENT_VISIT_CHANGED)`、`normalize_phone`、`_reject_control_chars`。
- Produces:
  - `booking_link.contact_fields(parent_name, phone, child_name, child_birthdate, *, today) -> dict` 回傳 `{"contact_name","phone","child_name","birthday","grade"}`；`fields_from_visit_request` 改呼叫它（行為不變）。
  - `PATCH /api/website/v1/admin/visit-requests/{id}/details`，body `AdminDetailsUpdate{expected_version:int, parent_name?, phone?, email?: EmailStr|""|None, child_name?: str|None, child_birthdate?: date|None}`（用 `model_fields_set` 判斷有送的欄位；`email/child_name/child_birthdate` 送 `null` 或 `""` 表示清空；`parent_name/phone` 送 null 或空字串 422）。
  - 回應 `AdminDetailsUpdateOut(VisitRequestFullOut)`：多 `changed_fields: list[str]`、`admissions_synced_fields: list[str]`、`admissions_skipped_fields: list[str]`、`email_notified: bool`。
  - 歷程 `details_updated`（actor＝staff），稽核 `visit_request.update_details`、`recruitment_visit.synced_from_visit_request`。

- [ ] **Step 1: 失敗測試**（`test_admin_visit_details.py`，沿用 `test_parent_self_service.py`／`test_admissions_booking_link.py` 的 fixture 建案與建招生）：
  1. 改電話：200，`changed_fields == ["phone"]`，`details_version` +1，歷程有 `details_updated` 且 `after == {"fields": ["phone"]}`、actor 是 staff；稽核有 `visit_request.update_details`。
  2. 沒有變化：200，`changed_fields == []`，沒有新歷程、沒有排信。
  3. `expected_version` 舊：409 `VISIT_REQUEST_VERSION_CONFLICT`。
  4. 家長先用 `PATCH /public/visit-manage/me` 改過一次，後台拿舊版本送：409。
  5. 已匿名化：409。
  6. `parent_name: ""` → 422；`phone: "0212345678"` → 422；`email: null` → 200 且 email 清空；`child_birthdate` 未來日 → 422。
  7. Email 改成新值：排了一封 `PARENT_VISIT_CHANGED` 給新信箱，`email_notified` True；只改電話不排信；Email 清空不排信。
  8. 狀態 completed／no_show 也能改。
  9. 招生同步：案件到場後建了招生（`ensure_from_visit_request`），後台改電話與孩子生日 → 招生 phone、birthday、grade 跟著改，`version` +1，`admissions_synced_fields == ["phone","birthday","grade"]`，稽核 `recruitment_visit.synced_from_visit_request`。
  10. 招生端先把 phone 改成別的，再從後台改 phone → 招生 phone 不變，`admissions_skipped_fields == ["phone"]`，版本不變（若沒有任何同步）。
  11. 招生 grade 被手動改過、後台改生日 → birthday 同步、grade 不動、`grade` 在 skipped。
  12. `admissions_enabled` 關閉 → 不同步，兩個清單都空。
  13. 權限：只有 `booking.read` 沒有 `booking.handle` → 403；別校帳號 → 404（同其他案件動作）。
- [ ] **Step 2:** 跑 FAIL。
- [ ] **Step 3: 實作重點**

```python
# booking_link.py
def contact_fields(parent_name, phone, child_name, child_birthdate, *, today: date) -> dict:
    school_year, _ = academic.current_term(today)
    return {
        "contact_name": _cut(parent_name, constants.LEN_CONTACT),
        "phone": _cut(phone, constants.LEN_PHONE),
        "child_name": _cut(child_name, constants.LEN_CHILD_NAME) or constants.MISSING_CHILD_NAME,
        "birthday": child_birthdate,
        "grade": academic.grade_for_birthday(child_birthdate, school_year) if child_birthdate else None,
    }

async def sync_from_visit_request(db, visit_request_id, old: dict, new: dict, *, today, actor) -> tuple[list[str], list[str]]:
    """old/new 是預約的五欄（parent_name, phone, child_name, child_birthdate）。招生那欄仍等於 old 轉換結果才改。"""
    before, after = contact_fields(**old, today=today), contact_fields(**new, today=today)
    rv = 鎖住 recruitment_visits where visit_request_id=… and anonymized_at is null
    if rv is None: return [], []
    synced, skipped = [], []
    for field in ("contact_name", "phone", "child_name", "birthday", "grade"):
        if before[field] == after[field]:
            continue
        if getattr(rv, field) == before[field]:
            setattr(rv, field, after[field]); synced.append(field)
        else:
            skipped.append(field)
    if synced:
        rv.version += 1
        寫稽核 recruitment_visit.synced_from_visit_request metadata={"fields": synced}
    return synced, skipped
```

  `update_details_by_staff`：`db.refresh(vr, attribute_names=[...], with_for_update=True)` → 匿名化 409 → 比版本 → 逐欄比對 → 寫入 → 歷程（actor staff）→ 稽核 → Email 改成非空才排信 → `admissions_enabled` 時呼叫 `sync_from_visit_request`（today＝`today_local()`）。路由走 capability `booking.handle`＋campus scope（照 `/no-show` 的寫法）。
- [ ] **Step 4:** 跑新測試＋`test_admissions_booking_link.py`、`test_parent_self_service.py`、`test_audit_actions.py`、`test_audit_coverage.py`、`test_permission_table.py` PASS。
- [ ] **Step 5:** `npm run contract:generate; npm run contract:check`。
- [ ] **Step 6:** commit `feat(booking): 後台可以修改家長資料，招生資料仍是原值的一起改`

### Task B2: 預約明細「修改」對話框（§3.3）

**Files:**
- Create: `admin/src/components/visit/VisitDetailsDialog.vue`（目錄以 `VisitCaseFacts.vue` 所在處為準）
- Modify: `VisitCaseFacts.vue`（面板頭「修改」）、案件頁（掛對話框、完成後重新載入）
- Modify: `admin/src/api/`（`updateVisitDetails(id, body)`）、`admin/src/api/labels.ts`（`AUDIT_ACTION_LABELS` 加兩個 action；歷程「資料已更新」依 actor 顯示）
- Test: `admin/src/__tests__/visitDetailsDialog.test.ts`、`labelCoverage.test.ts`（自動掃）

- [ ] **Step 1: 失敗測試**：
  1. 開對話框帶入現值；沒改按儲存 → 不呼叫 API、直接關。
  2. 改電話成 `0912` → 顯示「手機號碼要是 09 開頭的 10 碼」，儲存鈕不送。
  3. 改 Email 後送出 → body 只含 `email` 與 `expected_version`。
  4. API 回 `admissions_synced_fields: ['phone']` → 成功訊息含「招生資料已一起更新：電話」；`admissions_skipped_fields: ['phone']` → 提示「招生資料的電話另外改過，沒有跟著改」。
  5. `email_notified: true` → 另提示「已寄變更通知到新信箱」。
  6. 409 → 顯示「家長或同事剛改過資料，已重新載入」並 emit `reload`。
  7. 匿名化或無 `canHandle` 時 `VisitCaseFacts` 不顯示「修改」。
- [ ] **Step 2:** 跑 FAIL。
- [ ] **Step 3:** 實作（Element Plus `el-dialog`、`el-form`、`el-date-picker`；欄位標籤用 `labels.ts` 既有家長欄位文字；招生欄位名對照 `contact_name→家長稱呼、phone→電話、child_name→孩子姓名、birthday→生日、grade→年級`）。歷程「資料已更新」：actor 是家長顯示「家長改了 電話、Email」，是員工顯示「○○改了 …」（○○＝顯示名稱）。
- [ ] **Step 4:** 跑新測試、`labelCoverage.test.ts`、`VisitCaseFacts`／timeline 相關測試 PASS；admin typecheck。
- [ ] **Step 5:** commit `feat(admin): 預約明細可以修改家長資料`

### Task B3: 批次標記沒來（§4.1）

**Files:**
- Modify: `admin/src/` 的 `visitAttendance.ts`（`markArrivedInOrder` → 通用 `markInOrder`）、`VisitRequestsView.vue`
- Test: `visitAttendance` 既有測試檔、`VisitRequestsView` 批次測試

**Interfaces:**
- Produces: `markInOrder(ids: string[], kind: 'arrived' | 'no-show', deps) => Promise<{ done: string[]; failures: BatchFailure[] }>`；`markArrivedInOrder` 保留為 `markInOrder(ids, 'arrived')` 的包裝，避免動到其他呼叫者。

- [ ] **Step 1: 失敗測試**：`markInOrder(['a','b','c'], 'no-show')` 依序打 `/no-show`；b 回 409 → failures 含 b 且訊息「狀態剛被其他人更新」，c 仍會送。View：attendanceOnly 批次模式勾兩筆 → 有「標記沒來」→ 確認框文字「把 2 筆標成沒來？會結案、停用家長的修改連結，名額不會釋出。」→ 確認後清單重新整理。非 attendanceOnly 不出現這個鈕。
- [ ] **Step 2:** FAIL。
- [ ] **Step 3:** 實作（確認框用專案現有的確認元件／`ElMessageBox.confirm`，危險色）。
- [ ] **Step 4:** PASS；typecheck。
- [ ] **Step 5:** commit `feat(admin): 時間已過的案件可以一次標記沒來`

### Task B4: 聯絡片語後端（§4.2 資料與 API）

**Files:**
- Create: `backend/app/contact_phrases/{__init__,models,schemas,routes,service}.py`（或依專案慣例放進既有模組；先看 `backend/app` 結構，與 `password_reset` 類似的小模組同樣式）
- Create: `backend/alembic/versions/<rev>_contact_phrase_sets.py`（`down_revision` 接目前 head：`cd backend; uv run alembic heads`）
- Modify: `backend/app/auth/permissions.py`（`contact_phrases.manage` 只給總管理者）、app router 註冊、`backend/tests/conftest.py`（TRUNCATE 清單若列舉表名要加；預設列由 migration 插，測試前要回復預設——照 conftest 現有作法）
- Create: `backend/tests/test_contact_phrases.py`

**Interfaces:**
- Produces:
  - `GET /api/website/v1/admin/contact-phrases` → `{phrases: list[str], version: int, updated_at, updated_by_name: str | None}`；`booking.read` 或 `admissions.read` 任一即可讀。
  - `PUT /api/website/v1/admin/contact-phrases` body `{phrases: list[str], expected_version: int}` → 同上；版本不符 409（錯誤碼沿用專案命名，例如 `CONTACT_PHRASES_VERSION_CONFLICT`）。
  - 預設 6 句（規格 §4.2）。

- [ ] **Step 1: 失敗測試**：讀到預設 6 句與 version 1；總管理者 PUT 成功 version 2、稽核 `contact_phrases.update` metadata `{"count": n}`；分校管理者 PUT 403；只有 admissions.read 的帳號 GET 200；422：21 句、空字串、61 字、含 `\n`、重複、含 `javascript:`、控制字元；PUT 會先 strip 每句；舊版本 409。
- [ ] **Step 2:** FAIL。
- [ ] **Step 3:** 實作 model（`key String(16) PK`、`phrases JSON`、`version Integer default 1`、`updated_at DateTime(timezone=True)`、`updated_by UUID FK users ON DELETE SET NULL`）＋ migration（create_table＋`op.bulk_insert` 預設列）＋ service（鎖列、比版本、寫入、稽核）＋ routes。
- [ ] **Step 4:** `alembic upgrade head` 在測試庫跑過；新測試＋`test_permission_table.py`、`test_audit_coverage.py`、`test_audit_actions.py` PASS；`alembic downgrade -1; alembic upgrade head` 來回一次。
- [ ] **Step 5:** contract generate／check。commit `feat(backend): 總部統一管理的聯絡片語`

### Task B5: 聯絡片語後台頁與輸入框 chip（§4.2 前端）

**Files:**
- Create: `admin/src/views/ContactPhrasesView.vue`、`admin/src/components/ContactPhraseChips.vue`、`admin/src/composables/useContactPhrases.ts`（模組層快取：同一頁多個輸入框共用一次請求）
- Modify: router（`/contact-phrases`，meta 權限 `contact_phrases.manage`）、側欄「系統」分組、`labels.ts`（`AUDIT_ACTION_LABELS['contact_phrases.update']`）、capability 型別
- Modify: `VisitCaseTimeline.vue`、招生 `ContactLogDialog.vue`
- Test: `admin/src/__tests__/contactPhraseChips.test.ts`、`contactPhrasesView.test.ts`、側欄／路由權限測試

**Interfaces:**
- Produces: `appendPhrase(current: string, phrase: string): string`（空白→phrase；結尾是 `，。、！？；：,.!?;:` 之一→直接接；否則補「，」）。`<ContactPhraseChips @pick="(p) => text = appendPhrase(text, p)" />`，插入後 `nextTick` 把游標移到結尾並 focus。

- [ ] **Step 1: 失敗測試**：`appendPhrase('', 'A')==='A'`；`appendPhrase('已致電','A')==='已致電，A'`；`appendPhrase('已致電。','A')==='已致電。A'`；`appendPhrase('  ','A')==='A'`。chips：API 失敗時不渲染；兩個元件同時掛只發一次 GET。View：新增、刪除、上移、下移、儲存送出 `{phrases, expected_version}`；409 提示並重新載入；超過 20 句時新增鈕停用；每句輸入框 maxlength 60。非總管理者看不到側欄項目、直接開網址被擋。
- [ ] **Step 2:** FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** PASS；admin typecheck；`labelCoverage.test.ts`。
- [ ] **Step 5:** commit `feat(admin): 聯絡紀錄輸入框上方加片語，總管理者在系統裡維護`

### 閘門 B（主 session）

- [ ] admin typecheck＋unit；後端全套（背景）；contract:check；deploy/tests
- [ ] stack e2e：新增 `tests/stack/admin-batch-20261012.spec.ts`：①後台改家長電話 → 招生資料同步可見；②attendanceOnly 批次標記沒來；③總管理者改片語 → 案件頁 chip 點了帶入。跑這支＋既有 `admin-visit*` spec。
- [ ] Playwright 截 1440／390：修改對話框、片語 chip、片語管理頁。

---

## 階段 C：內容與預覽（規格 §5–7＋字型）

### Task C1: site_meta 的 page_seo 與 social_links（後端）（§5.1、§6.2）

**Files:**
- Modify: `backend/app/content/schemas.py`（`SiteMetaPayload`、`PageSeoPayload`、`SocialLinkPayload`、`PAGE_SEO_KEYS`、`admission_title/admission_description` 改 `exclude=True`、site_meta 的 `public_view`）
- Modify: `_extract_site_meta_media_refs`（`grep -rn _extract_site_meta_media_refs backend/app`）
- Test: `backend/tests/test_site_meta_seo.py`（新增）、既有 `test_admission_content.py`

**Interfaces:**
- Produces: 公開輸出 site_meta 帶 `page_seo: {key: {title, description, share_image, share_image_alt}} | null`、`social_links: [{platform,label,url}] | null`；沒有 `admission_title/description`。

- [ ] **Step 1: 失敗測試**：
  1. 已發布 revision 只有舊 `admission_title="舊標題"` → 公開 `page_seo.admission.title == "舊標題"`，且沒有 `admission_title` 鍵。
  2. 新結構與舊欄位並存且新結構有值 → 用新結構。
  3. `page_seo` 用未知鍵 `visit` → 422；title 121 字 → 422。
  4. `share_image` 指到影片素材 → 422（kind image）；指到圖片 → 發布後該素材在公開素材路由可取得。
  5. `social_links`：`http://` 網址 422；`javascript:` 422；7 筆 422；同網址重複 422；platform `tiktok` 422。
- [ ] **Step 2:** FAIL → **Step 3:** 實作 → **Step 4:** PASS（含 `test_admission_content.py`、`test_media_slots.py`）。
- [ ] **Step 5:** contract generate／check；commit `feat(content): 各頁搜尋與分享設定、機構社群連結可在後台改`

### Task C2: 官網讀 page_seo／social_links（§5.2、§6.2 官網）

**Files:**
- Modify: `web/app/utils/content-overlay.ts`（site_meta guard：`pageSeo`、`socialLinks` 經 `httpsUrl()` 過濾）、`web/app/types/site-content.ts`、`web/app/utils/seo.ts`、`web/app/components/SiteHeader.vue`（社群 href 只用驗證過的、platform 四種、圖示）、`organizationSameAs()`
- Modify: sprite（若缺 instagram／youtube 的 Phosphor Regular 圖示才補；`grep -rn "ph-instagram\|ph-youtube" web/app`）
- Test: `web/tests/seo.spec.ts`（或既有 seo 測試）、`web/tests/content.spec.ts`

- [ ] **Step 1: 失敗測試**：`pageSeo.about.title` 有值 → about 頁 title 用它；空字串 → 內建；share_image 是合法 UUID → og:image 走素材網址；非 UUID → 全站分享圖。`socialLinks` 含一筆 `javascript:` 與一筆合法 → 只留合法；`null` → 內建清單。SiteHeader 只渲染驗證過的連結。
- [ ] **Step 2–4:** FAIL → 實作 → PASS（web typecheck）。
- [ ] **Step 5:** commit `feat(web): 各頁搜尋標題與機構社群改讀後台設定`

### Task C3: SiteMetaView「各頁搜尋與分享」與「機構社群」（§5.3、§6.2 後台）

**Files:**
- Modify: `admin/src/views/SiteMetaView.vue`、`admin/src/api/types.ts`、`labels.ts`／`contentFieldLabels.ts`（`KIND_FIELD_LABELS`）、`contentHints.ts`（`LENGTH_HINTS`：標題建議 32、描述建議 80）
- Test: `admin/src/__tests__/siteMetaView.test.ts`（新增或既有）、`editorSectionFields.test.ts`

- [ ] **Step 1: 失敗測試**：載入只有舊 `admission_title` 的草稿 → 「入學」頁籤標題欄顯示舊值；存檔 payload 只有 `page_seo.admission.title`、沒有 `admission_title`。七個頁籤；placeholder 顯示內建標題（內建值從 web 的 `seo.ts` 對照寫一份 `PAGE_SEO_DEFAULTS`，測試比對兩邊一致）。社群清單新增／刪除／排序，`http://` 即時錯誤。`:sections` 涵蓋所有欄位（`editorSectionFields.test.ts`）。422 `page_seo.about.title` 能定位到欄位。
- [ ] **Step 2–4:** FAIL → 實作 → PASS（admin typecheck）。
- [ ] **Step 5:** commit `feat(admin): 全站設定加各頁搜尋與分享、機構社群`

### Task C4: 家長分享影片（後端＋官網）（§6.1）

**Files:**
- Modify: `backend/app/content/schemas.py`（`TestimonialPayload`、`CampusProfilePayload.testimonials`、`extract_media_refs` 加 poster）
- Modify: `web/app/utils/content-overlay.ts`（campus_profile guard）、`web/app/types/site-content.ts`、關於頁選片（`grep -rn "testimonial" web/app`）
- Test: `backend/tests/test_campus_testimonials.py`（新增）、`web/tests/about-voices.spec.ts`（新增或併入既有 about 測試）

- [ ] **Step 1: 後端失敗測試**：youtube_url 解不出 id → 422；5 支 → 422；quote 41 字 → 422；poster 是影片素材 → 422；`None` 與 `[]` 都能存並原樣出現在公開輸出。
- [ ] **Step 2: 官網失敗測試**：
  - 輪流取：義華 3 支、明華 2 支、崇德 1 支 → 順序 義1、明1、崇1、義2（最多 4）。
  - 只有義華有影片 → 結果與改前相同（用 fixture 實際資料比對）。
  - overlay：`testimonials: []` → 該校清空；`null` → 保留 fixture；自訂一支沒有 poster、youtubeId 與 fixture 內建相同 → 用內建封面；不同 → `youtubeThumb(id)`。
- [ ] **Step 3–4:** 實作 → PASS（後端該檔＋`test_media_slots.py`；web typecheck＋該測試）。
- [ ] **Step 5:** contract；commit `feat(content): 家長分享影片可在後台改，關於頁五校輪流取`

### Task C5: 後台家長分享影片段落（§6.1 後台）

**Files:**
- Modify: `admin/src/views/CampusProfileView.vue`、`admin/src/api/types.ts`、labels（`KIND_FIELD_LABELS`、`MEDIA_SLOT_PATH_LABELS`、`LIST_UNITS`）
- Create: `admin/src/content/campusTestimonialsDraft.ts`（內建清單，從 web fixture 抄）
- Modify: `admin/src/` 的 `PREVIEW_TARGETS.campus_profile` 加 `{page:'about', block:'about-voices', label:'關於頁家長怎麼說'}`；官網 preview 的 block 對照加 `about-voices` → `#voices`
- Test: `campusTestimonials.test.ts`（比對 draft 與 `web/server/data/site-fixture.json`）、`previewProtocol.test.ts`

- [ ] **Step 1: 失敗測試**：draft 與 web fixture 一字不差；`testimonials == null` 時顯示「目前沿用內建 N 支」與「改成自訂」；按下後清單帶入 N 支；「恢復內建」→ payload `testimonials: null`；新增到 4 支後新增鈕停用。
- [ ] **Step 2–4:** FAIL → 實作 → PASS。
- [ ] **Step 5:** commit `feat(admin): 分校資料加家長分享影片`

### Task C6: 環境頁內容模型（後端＋fixture＋官網）（§6.3）

**Files:**
- Modify: `backend/app/content/page_schemas.py`（`EnvironmentPagePayload`）、content kind 註冊（`grep -rn '"about_page"' backend/app` 照抄 about_page 的每一處：kind 表、shared_only、權限、initialize 對應、media refs）
- Modify: `web/server/data/site-fixture.json`（`environmentPage`，照 `EnvironmentContent.vue` 常數原樣搬；第四章段落改掉「取自各分校頁」）
- Modify: `web/app/types/site-content.ts`（`EnvironmentPageContent`）、`web/app/utils/content-overlay.ts`（`environmentPage()`、`PAGE_COUNTS.environment`）、`web/app/components/EnvironmentContent.vue`（讀 `page` prop；`noteAt/to/t/NEXT/餐點書連結` 留在程式）、`web/app/pages/environment.vue`、`preview.vue` 的 environment 分支
- Test: `backend/tests/test_environment_page_content.py`（新增）、`web/tests/environment-page-overlay.spec.ts`（新增）、`web/tests/environment.spec.ts`

**Interfaces:**
- Produces: fixture 鍵 `environmentPage`（camelCase，欄位對照 snake_case payload）；`PAGE_COUNTS.environment = { chapterNames: 4, hearts: 5, careItems: 5, spaces: 6, meals: 5 }`。

- [ ] **Step 1:** 先把 `EnvironmentContent.vue` 的文字常數逐字搬進 fixture（`environmentPage`），量出每個欄位的內建長度，上限＝1.5 倍（標題逐行），寫進 payload。
- [ ] **Step 2: 後端失敗測試**：初始化後 `environment_page` revision＝fixture；數量不符 422；meals 時間倒序 422；`hearts` 某項 5 字 422；含 `javascript:` 422；照片 refs 進 media refs；非總管理者不能存（shared_only）。
- [ ] **Step 3: 官網失敗測試**：overlay 正常草稿整份取代；少一張 care_item → 整份退回內建；照片是素材 → 用素材網址與焦點；沒選 → 內建靜態圖與 `pos`。`EnvironmentContent` 用 fixture 渲染時 DOM 文字與改前一致（快照比對首屏、四章標題）。
- [ ] **Step 4:** 實作 → PASS（後端該檔、`test_content_initialize.py`、`test_media_slots.py`；web typecheck、環境頁相關測試）。
- [ ] **Step 5:** 用 `scripts/page-copy-stress.cjs` 在 390／1440 塞滿上限截圖，破版就下修上限（三處一起改：`page_schemas.py`、admin `contentHints.ts`、DESIGN.md 上限表）。
- [ ] **Step 6:** contract；commit `feat(content): 環境頁前三章開放後台編輯（內容模型與官網）`

### Task C7: 後台環境頁編輯器（§6.3 後台）

**Files:**
- Create: `admin/src/views/EnvironmentPageView.vue`（照 `AboutPageView.vue` 結構）、`admin/src/content/environmentPageDraft.ts`
- Modify: router `content/environment-page`、側欄「全站與素材」（關於常春藤頁之後）、labels（`CONTENT_KIND_LABELS`、`contentPublicPath/PreviewPath/EditorPath`、`MEDIA_SLOT_PATH_LABELS`、`KIND_FIELD_LABELS`、`LIST_UNITS`、`LENGTH_HINTS`）、`PREVIEW_TARGETS.environment_page = [{page:'environment', block:'page-top'}]`
- Test: `environmentPageDraft.test.ts`（draft＝web fixture）、`livePreviewPane.test.ts`（EDITOR_KINDS 加 `environment_page`）、`editorSectionFields.test.ts`、`labelCoverage.test.ts`

- [ ] **Step 1–4:** 失敗測試 → 實作 → PASS（admin typecheck）。便條欄位說明「換照片後箭頭可能沒指準」。
- [ ] **Step 5:** commit `feat(admin): 環境頁編輯器`

### Task C8: 環境頁字型補常用字分片（§6.3 字型）

**Files:**
- Modify: `scripts/subset-environment-fonts.py`（其餘分片擴到圓體 700、800）
- Regenerate: 環境頁字型檔、`environment-font-manifest.json`、擴充樣式表
- Create: `admin/src/content/chars-environment.txt`（或依 GlyphHint 現有讀法的路徑），環境頁欄位的 `GlyphHint` 改讀它
- Test: 既有字型 manifest 測試（`grep -rln environment-font-manifest web/tests scripts`）

- [ ] **Step 1:** 讀腳本與 `assets/fonts/README.md`／腳本說明，確認原始字型檔在本機（不在就停下來回報，不要另外下載不明來源）。
- [ ] **Step 2:** 改腳本、重跑；量新增大小（`du -ch`），記下實數。超過 15MB → 800 只做常用 3,000 字（規格 §11）。
- [ ] **Step 3:** 產出 `chars-environment.txt`；GlyphHint 改讀；測試：輸入罕用字顯示「這幾個字會用系統字顯示」。
- [ ] **Step 4:** web 字型 manifest 測試＋admin GlyphHint 測試 PASS。commit `feat(web): 環境頁圓體粗體補常用字分片`

### Task C9: 即時預覽補洞（§7）

**Files:**
- Modify: admin `PREVIEW_TARGETS`（`campus_tour → [{page:'environment', block:'environment-tour'}]`；`home_news`、`campus_news` 加 `{page:'news', block:'page-top', label:'消息列表頁'}`）、admin `PreviewPage` 型別加 `news`、`CampusTourView.vue` 進三欄
- Modify: web preview 協定 `PreviewPage`／`PAGES` 加 `news`、block `environment-tour → .renv-tour`、`preview.vue` news 分支渲染 `NewsIndexContent`、環境頁收到 campus_tour 草稿時切到 `campusKey` 分頁
- Test: `previewProtocol.test.ts`、`livePreviewPane.test.ts`、`editorThreeColumns.test.ts`、`campusTourHq.test.ts`、`tests/stack/editor-live-preview.spec.ts`

- [ ] **Step 1–4:** 失敗測試（三處 PreviewPage 一致含 news；campus_tour 非空；CampusTourView 有預覽欄）→ 實作 → PASS。
- [ ] **Step 5:** commit `feat(admin): 校園探索與消息列表頁也能即時預覽`

### Task C10: 文件（T10 的 C 階段部分）

- [ ] `AboutPageView`、`AboutContent` 的 testimonials 註解改成事實；DESIGN.md 記：環境頁開放編輯的固定項、家長影片輪流取、片語、環境頁上限表。commit `docs: 記錄環境頁可編輯範圍與家長影片輪流規則`

### 閘門 C（主 session）

- [ ] web／admin typecheck＋unit、後端全套（背景）、contract:check、deploy/tests
- [ ] stack e2e：`editor-live-preview.spec.ts`、`media-slots.spec.ts`、環境頁／about 相關 spec；`admin-batch-20261012.spec.ts` 加：後台改 about 的 SEO 標題 → 發布 → 公開頁 `<title>` 變了；改環境頁首屏大標 → 預覽看到。
- [ ] Playwright 截 1440／390：/environment（內建與自訂）、/about 家長怎麼說、SiteMetaView、EnvironmentPageView。

---

## 階段 D：區域分析延後項目（T9）

### Task D0: 盤點仍在的項目

- [ ] 開工前 `git fetch origin main`，看 `admissions-deposit-pace-20261012` 是否已併入；確認 `~/Repositories/ivy-website-wt/admissions-area-locate-20261012` 未提交的修改動到哪些檔（只讀），避開衝突。
- [ ] 派 scout 對 `docs/superpowers/plans/2026-10-08-admissions-area-followups.md` 每一條，在目前程式查「仍在／已修」，輸出清單（檔案:行號）。不做「待業主」P1 與 C8「每次換校重建 Leaflet」。
- [x] 依結果把仍在的項目分成 D1 地址解析與匯入、D2 API 與同步、D3 後台畫面、D4 測試與文件，每組寫成本檔的子任務（失敗測試→實作→PASS→commit），逐條在 followups 文件勾掉。

D0 結果（2026-10-12，scout 對 origin/main `fb34d3a1` 逐條核對）：deposit-pace、area-locate 兩支已併入 main 並部署，worktree 已清；開工前先把 origin/main 合入本分支。
不做（取捨，回報時說明）：B1 geo relationship 全域 selectin（已註解為取捨）、C6 多邊形不可鍵盤聚焦（表格／清單有等價路徑）、C11 品牌金與暖黃辨識度（需目視，閘門 D 截圖看）、文件類措辭（A2、A7 README、A9、C11、C12、Minor 規格數字）。

### Task D1: 地址解析、匯入與比對（backend/app/admissions/geo/）

- `address.py`：前導零號碼先去零再判長度（000068 → 68）；lane／alley 長度上限 16（超過回 None）；「二十之一號」（之後接中文數字）、「六十八號之一」（之號認中文數字）、中文數字巷（含百、零：一百零八巷 → 108）轉數字字串。
- `doorplates.py`／`kindergartens.py`：解析列時檢查欄寬（門牌 street 40、village 16、lane／alley 16；幼兒園 pre_public_period 16、name 120、address 200、phone 40、reg_no 80、source_id 64——以 `geo/models.py` 實際欄寬為準）與座標（有限數、高雄範圍），不合格的列略過並計數，不讓整批 COPY 失敗；`import_doorplates` 的清理放 try/finally，清理失敗不蓋掉原例外；幼兒園版本 label 用台北日期。
- `matcher.py`：nearby 改 `number.between(n-30, n+30)` 吃索引（排序仍用距離）；active_version 與 label 一次讀；同側等距跨里的排序加確定性鍵（village 名稱）再 id。
- 測試：`test_geo_address.py`（上列每種寫法）、`test_geo_doorplates.py`／`test_geo_kindergartens.py`（超長列略過、座標超範圍略過、清理失敗保留原例外、label 台北日期、`test_load_geo_samples_is_repeatable` 補 label 斷言）、`test_geo_matcher.py`（between 結果與原本相同、refresh 後再斷言清空、併發測試補 address／district 未被覆蓋、忽略非使用中批次）、`test_geo_schema.py`（鎖 constraint 名稱集合、unlocated_reason 正反例、拆成三個測試、刪未用 import）。
- commit：`fix(admissions): 區域分析地址解析與匯入補強（延後項目 D1）`

### Task D2: 同步、API 與統計（sync.py、boundaries.py、geo_loop、routes、area.py、records.py、download.py、schemas）

- `sync.py`：轉址只跟 https（event hook 檢查每一跳）；最新年度頁 HTTP 錯誤退回前一年度；`_stream_rows` 用 aclosing；兩處失敗 log 加 `exc_info=True`；`_exclusive` 解鎖能處理 CancelledError（shield 或 BaseException＋invalidate）；頁面 regex 不依賴屬性順序；檔名月份 lookbehind 排除英數；`_file_rows` 的檔案讀取不阻塞 event loop（to_thread 或分塊）。
- `config.py`：`geo_auto_sync` 開啟時要求連線池能多借一條（pool_size ≥ 2 或 max_overflow ≥ 1），否則啟動報錯說明。
- `boundaries.py`：`_village_codes` 遇重複 (區,里) 直接 raise。
- `workers/geo_loop.py`：只要有一項不是 skipped 就記摘要；stop 逾時取消時 log warning。`main.py` 關閉時 geo 與媒體迴圈並行 stop（不疊加等待）。
- `routes.py`：If-None-Match 支援 `W/`、逗號清單與 `*`；`radius_km` 非整數也回 INVALID_RADIUS。
- `area.py`：`_data_status` 用已讀到的 label；本校 campus_point 只算一次；幼兒園排序鍵只留一份；REASON_ORDER 與 schemas 的 Literal 同一來源（`get_args`）。
- `records.py`：district／village strip；只給 village 沒給 district 時 422（避免跨區同名）。`download.py`：區域稽核同時記 district 與 village。
- `schemas.py`：MatchLevel／UnlocatedReason 與 geo 常數加 `get_args` 對照測試。
- 測試：`test_geo_sync.py`（非 https 轉址被擋、年度頁 404 退回前一年、aclosing、CancelledError 解鎖）、`test_geo_boundaries.py`（ETag 比 sha1、跨區同名、重複鍵 raise）、`test_geo_loop.py`（不用假同步的 stop-during-sync、去掉 sleep(0.3) 改事件等待、摘要規則、cli.main 分派）、`conftest.py` 釘 `geo_auto_sync=False`、`test_admissions_area.py`（ETag 反例／W／*、304 帶 Cache-Control、893 改讀實際筆數、kindergartens 欄位完整比對、readonly 與不存在校區、不寫稽核、radius_km=abc、invariants 改用不依賴建構的資料、odd-rows 註解、address=NULL 且無 geo 列）、`test_admissions_visit_geo.py`（from-visit-request 的 geo、只動到期訪視、重跑冪等、synchronize_session、匯出 row_count、district／village 長度 422、區域＋學年學期組合）。
- commit：`fix(admissions): 區域分析同步、API 與統計補強（延後項目 D2）`

### Task D3: 後台區域分析畫面（admin/src/components/admissions/）

- `areaFormat.ts`：999 m 顯示 `999 m`（≥ 995 m 改走 km 或保留整數公尺，規則寫清楚）；`shortDay` 改成不會跟其他兩個同名函式混淆的名字；geometry 型別收窄，拿掉 `AreaMap.vue` 的 `as unknown as`。
- `style.css`：註解與本機構顏色一致（說明為何用品牌金）。
- `RecordsTab.vue`：filterKey 用解析後的 area；地址欄 trim；兩顆同名「顯示全部」改成各自的文字。
- `StatsDimensionTable.vue`：名稱缺值時 aria 不寫「查看明細：—」；`action` 事件型別泛型化，拿掉 `AreaTab.vue` 的 `as` 轉型；721px 以上操作欄的橫捲提示（可視提示或固定右側，二選一，量 1024／1440 不破版）。
- `AreaMap.vue`：destroy 前 off `tileload`／`tileerror`；`remove()` 失敗後清掉容器 `_leaflet_id`；地圖容器加 aria 名稱；「完成」鈕補語境；`role=status` 改常駐容器。
- `NearbyKindergartens.vue`：搜尋比對用短名＋NFKC＋小寫；新視窗連結加 sr-only「（另開新視窗）」；展開鈕 aria-controls 對應 dl id；搜尋或 chip 變動重設「顯示更多」；others=0 時不顯示搜尋與 chip。
- `AreaTab.vue`：`.area-empty` 與 `.stats-empty` 外觀一致。
- 測試：`areaFormat.test.ts`（999、移除多出的不變式）、`admissionsTestKit.ts`（座標與 distance_m 對齊、本機構 ≤ 50 m、`satisfies` 契約型別、approved_capacity null）、`areaFilter.test.ts`（過長值）、RecordsTab（匯出帶區域參數、「顯示全部」→網址）、`statsDimensionCsv.test.ts`（nameColumn 退路與空 columns 的 aria）、`areaMap.test.ts`（narrow 切換重畫、mockRestore 放 finally、off listener）、`nearbyKindergartens.test.ts`（實際互動取代 vm.$emit）、`areaTab.test.ts`（幼兒園失敗隔離、連續換半徑丟舊回應、門牌未匯入表格照常）、`@ts-expect-error` 反向型別測試。
- commit：`fix(admin): 區域分析畫面延後項目（D3）`

### Task D4: 里界壓縮與 stack e2e

- 官網代理（`web/server/routes/api/website/v1/[...].ts`）：只對 `GET /admin/admissions/area/boundaries`，在客戶端 `Accept-Encoding` 含 gzip 時由 web 層壓縮上游回應（h3 代理不轉 accept-encoding，上游無法壓），帶 `Content-Encoding: gzip`、`Vary: Accept-Encoding`，保留 ETag／Cache-Control／304；壓縮結果依 ETag 快取一份（記憶體上限一筆）。其他路徑行為不變。測試：web 單元測試（壓縮、304 直通、不支援 gzip 時原樣、其他路徑不壓）。
- `tests/stack/admissions-area.spec.ts`：圖磚攔截補正向斷言；拿掉 networkidle；`name==='390'` 拆成獨立 test；補未定位校區（用 API 或 psql 讓某校沒有座標）的 e2e；里界回應帶 `content-encoding: gzip`。
- followups 文件逐條標註處理結果（已修／不做與理由）。
- commit：`perf(web): 里界 GeoJSON 由官網代理壓縮；區域分析 e2e 補強（D4）`

### 閘門 D（主 session）

- [ ] 後端全套、admin unit、stack `admissions-area*` spec；390 截圖「查看明細」欄。

---

## 收尾

- [ ] 整支分支審查（fresh reviewer，最強模型）：對照規格逐節確認。
- [ ] 回報使用者：完成項、實際跑過的指令與結果、未驗證項；推送與併 main 的 `!` 指令交給使用者。
