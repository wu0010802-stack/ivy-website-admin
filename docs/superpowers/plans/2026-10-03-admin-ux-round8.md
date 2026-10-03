# 官網後台第八輪 UX（09-28 稽核殘項）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2026-09-28 後台稽核「還沒處理、需要決定的」表格裡使用者選的六項做完：長編輯頁段落目錄、選圖元件統一、（錯誤定位已完成）、兩人同時處理同一案、「我承辦的未結案」、登入逾時接續。

**Architecture:** 前端以 `admin/` 的共用元件收斂：`ContentEditor` 多一個 `sections` 目錄、選圖統一成 `MediaFieldCard`（外觀）＋`MediaSlotField`／`MediaRefField`（資料）。後端只做小改動、不加 migration：狀態轉換錯誤訊息改中文、案件清單加「未結案」與「承辦人已停用」篩選、總覽回兩個計數、`/auth/me` 帶登入上限時間。

**Tech Stack:** Vue 3 + Pinia + Element Plus + Vite + Vitest（admin）；FastAPI 0.136.1 + SQLAlchemy 2.0 + pytest（backend）；openapi-typescript 契約（contracts）。

**Spec:** 沒有獨立規格。來源是 `docs/analysis/2026-09-28-admin-uiux-audit.md:106-123`（「還沒處理、需要決定的」表格），規則依 `DESIGN.md`「官網後台全面盤點與修正（2026-09-28）」「官網後台第七輪 UX（2026-10-02）」「官網後台第六輪 UX」「第五輪」「第四輪」。執行前兩份都要讀。

## 設計決定

| # | 決定 | 理由 |
|---|---|---|
| D1 | 使用者 2026-10-03 選做的六項是：段落導覽、選圖統一、錯誤定位、同時處理、我承辦的未結案、登入逾時。表格其他項目不做。 | 使用者裁定。 |
| D2 | **第 3 項（錯誤指出哪一則哪一欄）已完成，不排任務**。第 1 項只剩「段落目錄」；第 6 項只剩「一鍵開新分頁、自動接續、到期前提醒」。 | 10-02 第七輪與 09-29 已做，見下方「已完成、不做」。 |
| D3 | 段落目錄由頁面明確傳 `sections`（id＋字），不掃 DOM。≥1280px 是表單右側的黏住目錄，較窄時是表單上方一排可橫捲的膠囊。至少兩段才顯示。 | 標題文字會即時變（隱私權政策小標），用 computed 傳最簡單、可測；不另做 MutationObserver。 |
| D4 | 選圖統一成一個外觀元件 `MediaFieldCard`（縮圖、「目前用…」、兩顆按鈕、素材狀態），兩個資料元件：`MediaSlotField`（存 `{media_id, focus}`，API 不變）與新的 `MediaRefField`（存素材 id 字串）。四種舊寫法（消息封面、內文圖片、分享圖、校園探索場景）全部改用 `MediaRefField`。 | 稽核原話「統一縮圖、『目前用…』與兩顆按鈕」。值的形狀不同（物件 vs 字串），所以資料層分兩個、外觀共用一個。 |
| D5 | `MediaFieldCard`／`MediaRefField` 預留 `status` prop 與 `#status` slot，素材不是 `ready` 時標「處理中」「失敗」。這一輪不實作轉檔。 | 給「背景轉檔」計畫（`docs/superpowers/plans/2026-10-03-media-background-jobs.md`）接；`MediaSlotField` 已經讀得到素材，直接傳 `asset.status`。 |
| D6 | 「兩人同時處理」**不做線上狀態**（誰正在看），只做三件事：狀態轉換衝突（`INVALID_TRANSITION`）時重讀並寫出現在的狀態；頁首加「最後處理：誰・何時・做了什麼」（從案件歷程算，不改後端）；切回分頁時超過 30 秒就靜默重讀，同事剛改過就提示。 | 稽核建議就是這三件；線上狀態要心跳 API，範圍大、成本高。 |
| D7 | 後端 `InvalidTransition` 訊息裡的英文狀態代碼（`狀態 cancelled 不能取消`）改成中文狀態名，沿用 `booking/export_labels.py` 的 `STATUS_LABELS`。 | 稽核寫「翻中文」；前端不靠訊息字串判斷，只看 code。 |
| D8 | 「未結案」定義：狀態是待處理、聯絡中、待園方確認、預約正常（含時間已過還沒標記到場）。案件清單加 `open=true`（網址 `?open=1`），承辦人篩選加 `inactive`（承辦人帳號已停用）。總覽回 `my_open_cases`、`inactive_assignee_open_cases`（後者只給有 `booking.manage` 的人）。 | DESIGN 第四輪：總覽數字要有同定義的入口；兩者共用 `status_groups.open_condition()`。 |
| D9 | 「我承辦的案件」放在總覽「今天的參觀」下方的獨立一區（最多 5 筆＋「查看全部」），**不算待辦**；「承辦人已停用、還沒結案」才算待辦（給校區管理者以上）。 | 自選場次後多數案件是「預約正常」，算待辦會讓總覽永遠不能說「目前沒有待處理事項」（第五輪規則）。 |
| D10 | 停用帳號**不自動改指派**。停用成功後若對方還有未結案件，提示件數並請到列表用「承辦人已停用」篩出來重新指派。 | 自動清掉承辦人會悄悄改資料、歷程多一堆系統事件；交給人判斷。 |
| D11 | 登入逾時：不做本機暫存（規格 L202）。改進現有「留在原頁」對話框：多一個「在新分頁打開登入頁 ↗」連結；別的分頁登入成功時用 `BroadcastChannel` 通知，這一頁自動接續（取新的 CSRF token），仍提示「請再按一次儲存」；接續前比對帳號，**不是同一人就不接續**。 | 現有流程要使用者自己開分頁、回來按鈕；「不得假裝已儲存」所以不自動存。 |
| D12 | 登入滿 12 小時是硬上限（`auth/service.py:24` `SESSION_TTL`），閒置延長救不了。`/auth/me` 多回 `session_max_expires_at`，剩 15 分鐘時頁首下方出現提醒「請先儲存」。**不做「延長登入」按鈕**。 | 重新登入會撤銷舊 session（`auth/routes.py` login 的 `revoke_session`），而且登入頁看到還有效的 session 會直接導走（`router/index.ts` `authGuard`），延長要另做後端流程，不在本輪範圍。 |
| D13 | 本計畫**沒有 migration**。 | 新欄位都是查詢或回應欄位。 |

## 已完成、不做（開工前已對 origin/main `15fd9a5` 核對）

- **第 3 項全部**（存檔被擋指出哪一則哪一欄、中文原因、點了捲到欄位並展開收合項目）：
  - 解析 422 `loc`、翻中文：`admin/src/api/errors.ts:107-178`（`contentFieldErrors`、`validationMessage`、`contentSaveErrorMessage`）。
  - 錯誤清單與跳轉：`admin/src/components/ContentEditor.vue:415-420`（`jumpToError`）、`:589-599`（清單）。
  - 先展開收合的項目再捲過去：`admin/src/composables/newsContent.ts:219-252`（`revealContentPath`）。
  - 規則紀錄：`DESIGN.md:797`、`README.md:125`（10-02 第七輪）。
- **第 1 項的「項目預設收合、錯誤或新增的自動展開」**：`newsContent.ts:254-275`（`useCollapsibleItems`）、`NewsEntriesEditor.vue:57-64`、`DayExperienceView.vue:105-108`；`DESIGN.md:798`。本計畫只補段落目錄。
- **第 6 項的「留在原頁、請本人在新分頁重新登入、按『我已重新登入』取回 CSRF」**：`admin/src/router/unauthorized.ts:44-95`（`recoverInPlace`）、閒置延長 `admin/src/composables/sessionKeepAlive.ts`；測試 `admin/src/__tests__/sessionExpiry.test.ts:145-233`。
- **第 4 項的「承辦人／下次聯絡時間樂觀鎖衝突時重讀」**：`admin/src/views/VisitDetailView.vue:292-299`。本計畫補「狀態轉換」這一類衝突。
- **承辦人篩選 me／none 與總覽待辦框架**已有：`backend/app/booking/routes.py:856-914`、`admin/src/views/VisitRequestsView.vue:36-37,75-76`。

## Review Focus

1. **1280–1439px 寬＋隱私權政策 60 字小標**：開了目錄後表單不能被擠窄、頁面不能橫捲；390px 手機的目錄是一排可橫捲的膠囊，不能撐寬頁面。→ Task 1 的 CSS 靜態檢查＋Task 12 用 Playwright 量 `document.documentElement.scrollWidth`。
2. **狀態沒變的 `INVALID_TRANSITION`**（例如場次還沒開始就按「標記未到場」被後端擋）：要顯示後端給的原因，不能說「被其他人處理過」。→ Task 6 測試「狀態沒變時照後端原因提示」。
3. **櫃台打聯絡紀錄打到一半切走再切回來**：靜默重讀不能清掉草稿與「下次聯絡」的選擇。→ Task 6 測試「切回分頁重讀不動草稿」。
4. **逾時對話框等到的「別的分頁登入」是另一個帳號**：不能自動接續，修改不能用別人的名義存。→ Task 10 測試「新分頁登入的是別的帳號就不接續」。
5. **停用帳號後查未結案件數失敗**：停用照樣成功、照樣提示「已停用」，不多跳錯誤。→ Task 8 測試「查件數失敗不影響停用」。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `admin/src/composables/editorSections.ts` | 新增 | `EditorSection` 型別、`MIN_NAV_SECTIONS`、`jumpToSection()` |
| `admin/src/components/EditorSectionNav.vue` | 新增 | 段落目錄（桌機右側黏住、窄螢幕膠囊列、目前段落 `aria-current`） |
| `admin/src/components/ContentEditor.vue` | 修改 | 新 prop `sections`、目錄版面 |
| `admin/src/style.css` | 修改 | `[data-section-anchor]` 捲動留白與焦點框 |
| `admin/src/composables/newsContent.ts` | 修改 | `NEWS_SECTION_IDS` |
| `admin/src/components/NewsEntriesEditor.vue` | 修改 | 兩個 h2 加錨點；封面改 `MediaRefField` |
| `admin/src/views/HomeNewsView.vue`、`CampusNewsView.vue`、`AdmissionContentView.vue`、`DayExperienceView.vue`、`PrivacyPolicyView.vue` | 修改 | 傳 `sections`、標題加錨點 |
| `admin/src/composables/mediaThumbs.ts` | 修改 | `MediaFieldState` 型別 |
| `admin/src/components/MediaFieldCard.vue` | 新增 | 選圖欄位共用外觀 |
| `admin/src/components/MediaRefField.vue` | 新增 | 存 id 字串的選圖欄位 |
| `admin/src/components/MediaSlotField.vue` | 修改 | 改用 `MediaFieldCard`，API 不變 |
| `admin/src/components/NewsBodyEditor.vue`、`views/SiteMetaView.vue`、`views/CampusTourView.vue` | 修改 | 改用 `MediaRefField` |
| `backend/app/booking/workflow_service.py` | 修改 | 轉換錯誤訊息中文 |
| `admin/src/api/visitHistory.ts` | 修改 | `lastHandled()` |
| `admin/src/views/VisitDetailView.vue` | 修改 | 衝突重讀、最後處理、切回分頁重讀 |
| `backend/app/booking/status_groups.py` | 修改 | `OPEN_STATUSES`、`open_condition()` |
| `backend/app/booking/routes.py` | 修改 | `open`、`assignee=inactive` 篩選 |
| `backend/app/operations/dashboard_service.py`、`operations/routes.py` | 修改 | 兩個計數 |
| `admin/src/views/VisitRequestsView.vue`、`DashboardView.vue`、`UsersView.vue` | 修改 | 篩選、總覽一區與待辦、停用提示 |
| `backend/app/auth/schemas.py`、`auth/service.py`、`auth/routes.py` | 修改 | `session_max_expires_at` |
| `admin/src/composables/sessionChannel.ts` | 新增 | 分頁間「有人登入了」通知 |
| `admin/src/stores/auth.ts`、`router/unauthorized.ts` | 修改 | 記上限時間、廣播、自動接續 |
| `admin/src/components/SessionLimitNotice.vue`、`layouts/AdminLayout.vue` | 新增／修改 | 到期前提醒 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | Task 7、Task 9 |
| 測試：`admin/src/__tests__/uxRound8Nav.test.ts`、`mediaField.test.ts`、`uxRound8Cases.test.ts`、`uxRound8Session.test.ts`（新增）；`mediaSlots.test.ts`、`ux20260928E.test.ts`、`sessionExpiry.test.ts`（修改）；`backend/tests/test_visit_workflow.py`（修改）、`backend/tests/test_dashboard_my_cases.py`、`backend/tests/test_auth_session_limit.py`（新增） | | |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md` | 修改 | Task 11 |

**和其他計畫重疊的共用檔**（平行開工要協調，後合的一邊處理衝突並重跑 `npm run contract:generate`）：`contracts/*`、`admin/src/views/UsersView.vue` 與 `backend/app/auth/*`（「重設密碼寄連結」計畫也會動）、`admin/src/components/MediaSlotField.vue`／`MediaPickerDialog.vue`（「背景轉檔」計畫）、`admin/src/components/ContentEditor.vue`（「/about、/curriculum 開放編輯」計畫會新增頁面用它）、`README.md`／`DESIGN.md`／`acceptance.md`。

---

### Task 0: 開工準備

**Files:** 無（只建 worktree 與測試庫）

- [ ] **Step 1: 確認沒有別的 session 在動同一批檔案**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin
git fetch origin
git worktree list
git log origin/main --oneline -8
```
Expected：看清 origin/main 最新提交；若有其他 `ivy-website-*` worktree 正在改 `admin/src/components/MediaSlotField.vue`、`ContentEditor.vue`、`UsersView.vue`、`backend/app/auth/`，先問使用者再開工。

- [ ] **Step 2: 從 origin/main 開 sparse worktree（放 Desktop，不放 /private/tmp）**

```bash
git -C /Users/yilunwu/Desktop/ivy-website-admin worktree add --no-checkout -b feature/admin-ux8-20261003 /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003 origin/main
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003
git sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git checkout
git log --oneline -1
```
Expected：HEAD 與 `origin/main` 相同。

- [ ] **Step 3: 安裝依賴**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix admin ci; npm --prefix web ci
cd backend; uv sync --frozen
```
Expected：都成功；`node -v` 為 v22.23.2。

- [ ] **Step 4: 建自己的測試庫並 migrate**

```bash
createdb ivy_website_ux8_test
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test WEBSITE_SESSION_SECRET=local-ux8-session-secret uv run --frozen alembic upgrade head
uv run --frozen alembic heads
```
Expected：upgrade 成功；`heads` 只有一行（本計畫不加 migration，只是確認基準）。

- [ ] **Step 5: 基準測試（單檔、前景）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003/admin
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/mediaSlots.test.ts src/__tests__/ux20260928E.test.ts src/__tests__/sessionExpiry.test.ts src/__tests__/receptionUx20261002.test.ts src/__tests__/shellDashboard20261002.test.ts
cd ../backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_visit_workflow.py tests/test_visit_manual_and_assign.py
```
Expected：全部 PASS。紅了先停下來對照 main CI（`gh run list --branch main --limit 1`），不是本計畫造成的不要修。

---

### Task 1: 段落目錄元件與 ContentEditor 版面

**Files:**
- Create: `admin/src/composables/editorSections.ts`
- Create: `admin/src/components/EditorSectionNav.vue`
- Modify: `admin/src/components/ContentEditor.vue`（props、模板 `editor__body` 外包一層、樣式）
- Modify: `admin/src/style.css`（檔尾加錨點規則）
- Test: `admin/src/__tests__/uxRound8Nav.test.ts`

**Interfaces:**
- Produces:
  - `export interface EditorSection { id: string; label: string; note?: string }`（`composables/editorSections.ts`）
  - `export const MIN_NAV_SECTIONS = 2`
  - `export function jumpToSection(id: string): boolean`
  - `ContentEditor` 新 prop：`sections?: EditorSection[]`。頁面的段落標題元素要有 `:id="<section.id>"`、`data-section-anchor`、`tabindex="-1"`。
  - `EditorSectionNav` props：`{ sections: EditorSection[] }`；根元素 `<nav class="section-nav" aria-label="這一頁的段落">`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/uxRound8Nav.test.ts`：

```ts
// 2026-10-03 第八輪：長編輯頁的段落目錄（稽核 09-28「超長編輯頁沒有段落導覽」）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import EditorSectionNav from '../components/EditorSectionNav.vue'
import { jumpToSection } from '../composables/editorSections'

const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const wrappers: VueWrapper[] = []
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalScroll
  document.body.innerHTML = ''
})

describe('段落目錄', () => {
  it('列出每一段；點一下捲到那一段的標題、焦點移過去、標成目前這段', async () => {
    document.body.innerHTML = '<h2 id="sec-a" data-section-anchor tabindex="-1">最新消息</h2><h2 id="sec-b" data-section-anchor>近期活動</h2>'
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as never
    const wrapper = mount(EditorSectionNav, {
      props: { sections: [{ id: 'sec-a', label: '最新消息', note: '3 則' }, { id: 'sec-b', label: '近期活動' }] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    expect(wrapper.get('nav').attributes('aria-label')).toBe('這一頁的段落')
    const links = wrapper.findAll('a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['#sec-a', '#sec-b'])
    expect(links[0]!.get('.section-nav__label').text()).toBe('最新消息')
    expect(links[0]!.get('.section-nav__note').text()).toBe('3 則')
    expect(links[1]!.find('.section-nav__note').exists()).toBe(false)

    await links[1]!.trigger('click')
    expect(scrolled).toEqual(['sec-b'])
    expect(document.activeElement?.id).toBe('sec-b')
    // 原本沒有 tabindex 的標題補上 -1，焦點才移得過去。
    expect(document.getElementById('sec-b')!.getAttribute('tabindex')).toBe('-1')
    expect(links[1]!.attributes('aria-current')).toBe('location')
    expect(links[0]!.attributes('aria-current')).toBeUndefined()
  })

  it('找不到標題時不動、回 false', () => {
    expect(jumpToSection('no-such-section')).toBe(false)
  })

  it('ContentEditor：至少兩段才放目錄；桌機 1280 以上表單右側一欄，窄螢幕在表單上方', () => {
    const editor = readSource('../components/ContentEditor.vue')
    expect(editor).toContain("import EditorSectionNav from './EditorSectionNav.vue'")
    expect(editor).toMatch(/hasNav = computed\(\(\) => navSections\.value\.length >= MIN_NAV_SECTIONS\)/)
    expect(editor).toMatch(/<EditorSectionNav v-if="hasNav" :sections="navSections" class="editor__nav" \/>/)
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(editor)![0]
    expect(desktop).toContain('grid-template-columns: minmax(0, 1fr) 184px')
    expect(desktop).toContain('.editor--with-nav:not(.editor--wide) { max-width: 928px; }')
    const nav = readSource('../components/EditorSectionNav.vue')
    // 窄螢幕膠囊列自己橫捲，不撐寬頁面；觸控 44px。
    expect(nav).toMatch(/\.section-nav ol \{[^}]*overflow-x: auto;/)
    expect(nav).toMatch(/\.section-nav a \{[^}]*min-height: 44px;/)
    const css = readSource('../style.css')
    expect(css).toMatch(/\[data-section-anchor\] \{ scroll-margin-top: 80px; \}/)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run（在 worktree 的 `admin/`）：`source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/uxRound8Nav.test.ts`
Expected：FAIL，`Failed to resolve import "../components/EditorSectionNav.vue"`。

- [ ] **Step 3: 寫 `composables/editorSections.ts`**

```ts
// 長編輯頁的段落目錄（2026-10-03 第八輪，稽核 09-28「超長編輯頁沒有段落導覽」）。
// 頁面把每一段的標題元素放上 id、data-section-anchor、tabindex="-1"，再把
// sections 傳給 ContentEditor。目錄點一下就捲到那個標題、焦點移過去，鍵盤與
// 報讀軟體跟著到那一段；捲動時留給頁首的空間在 style.css 的 [data-section-anchor]。

export interface EditorSection {
  /** 標題元素的 id（同一頁唯一） */
  id: string
  /** 目錄上的字，和標題同一句 */
  label: string
  /** 目錄項目後面的小字，例如「12 則」；沒有就不顯示 */
  note?: string
}

/** 至少兩段才值得放目錄。 */
export const MIN_NAV_SECTIONS = 2

export function jumpToSection(id: string): boolean {
  const target = document.getElementById(id)
  if (!target) return false
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  return true
}
```

- [ ] **Step 4: 寫 `components/EditorSectionNav.vue`**

```vue
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { jumpToSection, type EditorSection } from '../composables/editorSections'

// 長編輯頁的段落目錄：桌機（1280 以上）在表單右側黏住，窄螢幕是表單上方一排
// 可以橫捲的膠囊。捲動時用 IntersectionObserver 標出目前這段（jsdom 沒有這個
// API，沒有就只在點選時標）。
const props = defineProps<{ sections: EditorSection[] }>()

const active = ref<string | null>(null)
let observer: IntersectionObserver | null = null
const inView = new Set<string>()

function observe() {
  observer?.disconnect()
  inView.clear()
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target.id)
        else inView.delete(entry.target.id)
      }
      const first = props.sections.find((section) => inView.has(section.id))
      if (first) active.value = first.id
    },
    // 頁首約 64px；標題進到視窗上半部才算「目前這段」。
    { rootMargin: '-80px 0px -55% 0px' },
  )
  for (const section of props.sections) {
    const el = document.getElementById(section.id)
    if (el) observer.observe(el)
  }
}

onMounted(observe)
watch(() => props.sections.map((s) => s.id).join('|'), () => void nextTick(observe))
onBeforeUnmount(() => observer?.disconnect())

function go(section: EditorSection) {
  if (jumpToSection(section.id)) active.value = section.id
}
</script>

<template>
  <nav class="section-nav" aria-label="這一頁的段落">
    <p class="section-nav__title" aria-hidden="true">這一頁</p>
    <ol>
      <li v-for="section in sections" :key="section.id">
        <a :href="`#${section.id}`" :aria-current="active === section.id ? 'location' : undefined" @click.prevent="go(section)">
          <span class="section-nav__label">{{ section.label }}</span>
          <span v-if="section.note" class="section-nav__note num">{{ section.note }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.section-nav { margin: -8px 0 16px; min-width: 0; }
.section-nav__title { display: none; }
.section-nav ol { display: flex; gap: 8px; margin: 0; padding: 0 0 4px; list-style: none; overflow-x: auto; scrollbar-width: none; }
.section-nav a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2); font-size: 14px; white-space: nowrap; text-decoration: none; }
.section-nav a[aria-current] { border-color: var(--admin-accent); color: var(--admin-accent-hover); font-weight: 600; }
.section-nav__note { color: var(--ink-3); font-size: 12px; font-weight: 400; }

@media (min-width: 1280px) {
  .section-nav { position: sticky; top: 88px; margin: 0; }
  .section-nav__title { display: block; margin: 0 0 6px; font-size: 12px; color: var(--ink-3); }
  .section-nav ol { flex-direction: column; gap: 2px; overflow: visible; padding: 0; }
  .section-nav a { display: flex; min-height: 36px; padding: 6px 10px; border: 0; border-left: 2px solid var(--line); border-radius: 0; background: none; white-space: normal; }
  .section-nav a[aria-current] { border-left-color: var(--admin-accent); }
}
</style>
```

- [ ] **Step 5: 改 `ContentEditor.vue`**

在 `<script setup>` 的 import 區加：

```ts
import { MIN_NAV_SECTIONS, type EditorSection } from '../composables/editorSections'
import EditorSectionNav from './EditorSectionNav.vue'
```

props 改成：

```ts
const props = defineProps<{
  editor: ContentEditorState
  /** 尚未選校區等情況：不顯示表單，改顯示這段提示 */
  placeholder?: string
  /** 表單寬度，預設 640 */
  width?: 'narrow' | 'wide'
  /** 長頁面的段落目錄（composables/editorSections.ts）；少於兩段不顯示 */
  sections?: EditorSection[]
}>()
```

在 `const busy = computed(...)` 下面加：

```ts
// 段落目錄：頁面傳進來的段落（標題元素的 id 與字）。至少兩段才顯示。
const navSections = computed(() => props.sections ?? [])
const hasNav = computed(() => navSections.value.length >= MIN_NAV_SECTIONS)
```

模板根元素改成：

```html
  <div class="editor" :class="{ 'editor--wide': width === 'wide', 'editor--with-nav': hasNav }">
```

把原本的

```html
      <div ref="body" class="editor__body panel" :inert="locked || undefined" :aria-busy="locked">
        <div class="panel__body">
          <!-- 唯讀時欄位由各頁的 el-form 綁 editor.readOnly 停用；表單外的新增、
               刪除、拖曳等操作由頁面自己隱藏。 -->
          <slot />
        </div>
      </div>
```

換成：

```html
      <div class="editor__layout" :class="{ 'has-nav': hasNav }">
        <!-- 目錄在表單外面：處理中表單 inert 時目錄仍可用來捲動。 -->
        <EditorSectionNav v-if="hasNav" :sections="navSections" class="editor__nav" />
        <div ref="body" class="editor__body panel" :inert="locked || undefined" :aria-busy="locked">
          <div class="panel__body">
            <!-- 唯讀時欄位由各頁的 el-form 綁 editor.readOnly 停用；表單外的新增、
                 刪除、拖曳等操作由頁面自己隱藏。 -->
            <slot />
          </div>
        </div>
      </div>
```

`<style scoped>` 裡 `.editor--wide { max-width: 1200px; }` 之後加：

```css
/* 段落目錄：1280 以上放在表單右側（表單仍是 720 寬），較窄時目錄在表單上方。 */
@media (min-width: 1280px) {
  .editor--with-nav:not(.editor--wide) { max-width: 928px; }
  .editor__layout.has-nav { display: grid; grid-template-columns: minmax(0, 1fr) 184px; gap: 24px; align-items: start; }
  .editor__layout.has-nav .editor__nav { grid-column: 2; grid-row: 1; }
  .editor__layout.has-nav .editor__body { grid-column: 1; grid-row: 1; min-width: 0; }
}
```

- [ ] **Step 6: `style.css` 檔尾加錨點規則**

```css
/* 長編輯頁的段落標題（composables/editorSections.ts）：目錄捲過去時留出頁首高度；
   程式移過去的焦點不畫框，鍵盤操作才畫。 */
[data-section-anchor] { scroll-margin-top: 80px; }
[data-section-anchor]:focus { outline: none; }
[data-section-anchor]:focus-visible { outline: 2px solid var(--admin-accent); outline-offset: 4px; }
```

- [ ] **Step 7: 跑測試確認通過**

Run：`npx vitest run src/__tests__/uxRound8Nav.test.ts`
Expected：3 passed。

- [ ] **Step 8: Commit**

```bash
git add admin/src/composables/editorSections.ts admin/src/components/EditorSectionNav.vue admin/src/components/ContentEditor.vue admin/src/style.css admin/src/__tests__/uxRound8Nav.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 內容編輯外殼加段落目錄（桌機右側黏住、窄螢幕膠囊列）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 五個長編輯頁接上段落目錄

**Files:**
- Modify: `admin/src/composables/newsContent.ts`（加 `NEWS_SECTION_IDS`）
- Modify: `admin/src/components/NewsEntriesEditor.vue:113-116, 242-245`
- Modify: `admin/src/views/HomeNewsView.vue`、`CampusNewsView.vue`、`AdmissionContentView.vue:98-101,131-134,190-193`、`DayExperienceView.vue:153,187-190`、`PrivacyPolicyView.vue`
- Test: `admin/src/__tests__/uxRound8Nav.test.ts`（加一個 describe）

**Interfaces:**
- Consumes：Task 1 的 `EditorSection`、`ContentEditor` 的 `sections` prop。
- Produces：`export const NEWS_SECTION_IDS = { articles: 'section-news-articles', events: 'section-news-events' } as const`（`newsContent.ts`）。各頁段落 id：
  - 首頁消息：`section-news-articles`、`section-news-events`、`section-news-films`
  - 各校消息：`section-news-articles`、`section-news-events`
  - 入學資訊：`section-admission-steps`、`section-admission-phases`、`section-admission-fees`
  - 孩子的一天：`section-day-film`、`section-day-moments`
  - 隱私權政策：每一段 `policy-section-<index>`

- [ ] **Step 1: 寫失敗的測試**（加在 `uxRound8Nav.test.ts` 檔尾；檔頭補 import）

檔頭 import 補上：

```ts
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import HomeNewsView from '../views/HomeNewsView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
```

檔尾加：

```ts
function contentItem(kind: string, payload: unknown, campusKey: string | null = null) {
  return {
    id: `${kind}-item`, kind, campus_key: campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', payload, review_status: 'draft' },
  }
}

async function mountView(component: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('長編輯頁接上目錄', () => {
  it('首頁消息：最新消息（則數）、近期活動（場數）、手機版活動影片；點了焦點到那一段標題', async () => {
    Element.prototype.scrollIntoView = () => {}
    vi.spyOn(api, 'get').mockResolvedValue(contentItem('home_news', {
      sample_note: '', home_display_count: null, films: null,
      articles: [{ id: 'a1', date: '2026-10-01', category: '', title: '菜園', description: '', image: '', alt: '', scope: 'global', campus_keys: [], featured: false, body: [] }],
      events: [],
    }) as never)
    const wrapper = await mountView(HomeNewsView)
    const nav = wrapper.get('nav[aria-label="這一頁的段落"]')
    expect(nav.findAll('.section-nav__label').map((s) => s.text())).toEqual(['最新消息', '近期活動', '手機版活動影片'])
    expect(nav.findAll('.section-nav__note').map((s) => s.text())).toEqual(['1 則', '0 場'])
    for (const id of ['section-news-articles', 'section-news-events', 'section-news-films']) {
      expect(document.getElementById(id)?.hasAttribute('data-section-anchor')).toBe(true)
    }
    await nav.findAll('a')[1]!.trigger('click')
    expect(document.activeElement?.id).toBe('section-news-events')
  })

  it('隱私權政策：每一段一個目錄項目，小標改了目錄跟著改；空白小標寫「第 N 段」', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => (
      path.startsWith('/admin/content-items/') ? contentItem('privacy_policy', {
        title: '隱私權政策', updated_on: '2026-10-03',
        sections: [{ heading: '蒐集的資料', body: '內文' }, { heading: '', body: '內文' }],
      }) : []
    ) as never)
    const wrapper = await mountView(PrivacyPolicyView)
    const labels = () => wrapper.get('nav[aria-label="這一頁的段落"]').findAll('.section-nav__label').map((s) => s.text())
    expect(labels()).toEqual(['蒐集的資料', '第 2 段'])
    await wrapper.findAll('input').find((i) => (i.element as HTMLInputElement).value === '蒐集的資料')!.setValue('使用目的')
    expect(labels()).toEqual(['使用目的', '第 2 段'])
    expect(document.getElementById('policy-section-1')?.hasAttribute('data-section-anchor')).toBe(true)
  })

  it('入學資訊、孩子的一天、各校消息都傳了 sections', () => {
    expect(readSource('../views/AdmissionContentView.vue')).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    expect(readSource('../views/DayExperienceView.vue')).toMatch(/<ContentEditor :editor="editor" :sections="navSections">/)
    expect(readSource('../views/CampusNewsView.vue')).toMatch(/:sections="navSections"/)
    for (const id of ['section-admission-steps', 'section-admission-phases', 'section-admission-fees']) {
      expect(readSource('../views/AdmissionContentView.vue')).toContain(`id="${id}" data-section-anchor tabindex="-1"`)
    }
    for (const id of ['section-day-film', 'section-day-moments']) {
      expect(readSource('../views/DayExperienceView.vue')).toContain(`id="${id}" data-section-anchor tabindex="-1"`)
    }
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run src/__tests__/uxRound8Nav.test.ts`
Expected：FAIL，`找不到 nav[aria-label="這一頁的段落"]`（`get` 找不到元素）。

- [ ] **Step 3: `newsContent.ts` 加段落 id**（放在 `NEWS_LIMITS` 下面）

```ts
/** 消息清單兩段的標題 id（段落目錄用，composables/editorSections.ts）。一頁只有一個 NewsEntriesEditor。 */
export const NEWS_SECTION_IDS = { articles: 'section-news-articles', events: 'section-news-events' } as const
```

- [ ] **Step 4: `NewsEntriesEditor.vue` 兩個 h2 加錨點**

import 從 `'../composables/newsContent'` 的清單補上 `NEWS_SECTION_IDS`。模板：

```html
    <h2>最新消息</h2>
```
改成
```html
    <h2 :id="NEWS_SECTION_IDS.articles" data-section-anchor tabindex="-1">最新消息</h2>
```
以及
```html
    <h2>近期活動</h2>
```
改成
```html
    <h2 :id="NEWS_SECTION_IDS.events" data-section-anchor tabindex="-1">近期活動</h2>
```

- [ ] **Step 5: `HomeNewsView.vue`**

import 補：`import type { EditorSection } from '../composables/editorSections'`，並在 `from '../composables/newsContent'` 那行補 `NEWS_SECTION_IDS`。`isSample` 下面加：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: NEWS_SECTION_IDS.articles, label: '最新消息', note: `${editor.form.value.articles.length} 則` },
  { id: NEWS_SECTION_IDS.events, label: '近期活動', note: `${editor.form.value.events.length} 場` },
  { id: 'section-news-films', label: '手機版活動影片' },
])
```

模板 `<ContentEditor :editor="editor">` 改 `<ContentEditor :editor="editor" :sections="navSections">`；`<h3 class="films-section">手機版活動影片</h3>` 改 `<h3 id="section-news-films" class="films-section" data-section-anchor tabindex="-1">手機版活動影片</h3>`。

- [ ] **Step 6: `CampusNewsView.vue`**

import 改 `import { computed, ref, useTemplateRef } from 'vue'`，補 `import type { EditorSection } from '../composables/editorSections'`，newsContent 那行補 `NEWS_SECTION_IDS`。`useCampusContent` 那行下面加：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: NEWS_SECTION_IDS.articles, label: '最新消息', note: `${editor.form.value.articles.length} 則` },
  { id: NEWS_SECTION_IDS.events, label: '近期活動', note: `${editor.form.value.events.length} 場` },
])
```

模板 `<ContentEditor` 的屬性加一行 `:sections="navSections"`（放在 `:editor="editor"` 下面）。

- [ ] **Step 7: `AdmissionContentView.vue`**

import 改 `import { computed, onMounted, useTemplateRef } from 'vue'`，補 `import type { EditorSection } from '../composables/editorSections'`。`const form = editor.form` 下面加：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-admission-steps', label: '入學流程', note: `${form.value.steps.length} 步` },
  { id: 'section-admission-phases', label: '新生入園須知', note: `${form.value.phases.length} 個階段` },
  { id: 'section-admission-fees', label: '收退費辦法' },
])
```

模板：`<ContentEditor :editor="editor">` → `<ContentEditor :editor="editor" :sections="navSections">`；三個 h2：

```html
        <h2 id="section-admission-steps" data-section-anchor tabindex="-1">入學流程</h2>
        <h2 id="section-admission-phases" data-section-anchor tabindex="-1">新生入園須知</h2>
        <h2 id="section-admission-fees" data-section-anchor tabindex="-1">收退費辦法</h2>
```

- [ ] **Step 8: `DayExperienceView.vue`**

import 已有 `computed`；補 `import type { EditorSection } from '../composables/editorSections'`。在 `const allMomentsOpen` 附近加：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-day-film', label: '背景影片' },
  { id: 'section-day-moments', label: '時刻卡', note: `${editor.form.value.moments.length} 張` },
])
```

模板：`<ContentEditor :editor="editor">` → `<ContentEditor :editor="editor" :sections="navSections">`；`<h3 class="form-section">背景影片</h3>` → `<h3 id="section-day-film" class="form-section" data-section-anchor tabindex="-1">背景影片</h3>`；`<h2>時刻卡</h2>` → `<h2 id="section-day-moments" data-section-anchor tabindex="-1">時刻卡</h2>`。

- [ ] **Step 9: `PrivacyPolicyView.vue`**

補 `import type { EditorSection } from '../composables/editorSections'`。`const sections = computed(...)` 下面加：

```ts
// 段落目錄：每一段一項，小標空白時寫「第 N 段」（和清單標題同一個寫法）。
const navSections = computed<EditorSection[]>(() =>
  sections.value.map((section, index) => ({ id: `policy-section-${index}`, label: section.heading.trim() || `第 ${index + 1} 段` })),
)
```

模板 `<ContentEditor :editor="editor">` → `<ContentEditor :editor="editor" :sections="navSections">`；每一段的外層

```html
        <div v-for="(section, index) in sections" :key="index" class="repeat-item" :data-list-item="index">
```
改成
```html
        <div v-for="(section, index) in sections" :id="`policy-section-${index}`" :key="index" class="repeat-item" :data-list-item="index" data-section-anchor tabindex="-1">
```

- [ ] **Step 10: 跑測試確認通過，並跑受影響的舊測試**

Run：`npx vitest run src/__tests__/uxRound8Nav.test.ts src/__tests__/homeNews.test.ts src/__tests__/privacyPolicy.test.ts src/__tests__/admissionContent.test.ts src/__tests__/ux20260928E.test.ts`
Expected：全部 PASS。

- [ ] **Step 11: Commit**

```bash
git add admin/src/composables/newsContent.ts admin/src/components/NewsEntriesEditor.vue admin/src/views/HomeNewsView.vue admin/src/views/CampusNewsView.vue admin/src/views/AdmissionContentView.vue admin/src/views/DayExperienceView.vue admin/src/views/PrivacyPolicyView.vue admin/src/__tests__/uxRound8Nav.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 消息、入學資訊、孩子的一天、隱私權政策編輯頁加段落目錄

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 選圖共用外觀 `MediaFieldCard` 與 `MediaRefField`，`MediaSlotField` 改用

**Files:**
- Modify: `admin/src/composables/mediaThumbs.ts`（加型別）
- Create: `admin/src/components/MediaFieldCard.vue`
- Create: `admin/src/components/MediaRefField.vue`
- Modify: `admin/src/components/MediaSlotField.vue`（模板與 import；props／emits 不變）
- Modify: `admin/src/__tests__/mediaSlots.test.ts:226,253,264`（`.slot__thumb` → `.media-field__thumb`）
- Test: `admin/src/__tests__/mediaField.test.ts`

**Interfaces:**
- Produces（**「/about、/curriculum 開放編輯」計畫要用，名字與型別不要改**）：
  - `export type MediaFieldState = 'empty' | 'builtin' | 'legacy' | 'media' | 'broken' | 'missing'`（`composables/mediaThumbs.ts`）
  - `MediaRefField.vue`
    - props：`modelValue: string`（`''`＝沒選、UUID＝素材庫、其他＝官網內建代號）、`kind?: 'image' | 'video'`（預設 `image`）、`campusKey?: string`、`noun?: '照片' | '圖片' | '影片'`（預設依 kind）、`builtin?: string`（沒選時「目前用{builtin}」；不給＝沒有內建）、`builtinSrc?: string`、`clearable?: boolean`（預設 true）、`clearLabel?: string`（預設：有 builtin「改回官網內建」，沒有「移除{noun}」）、`required?: boolean`、`status?: 'processing' | 'ready' | 'failed' | null`（預留給背景轉檔）、`thumb?: boolean`（預設 true）、`layout?: 'row' | 'stack'`、`ratio?: string`（CSS aspect-ratio，預設 `'4 / 3'`）、`size?: 'sm' | 'md'`、`disabled?: boolean`
    - emits：`update:modelValue(value: string)`、`picked(asset: MediaAssetOut, previousId: string | null)`（先 update 再 picked）、`cleared()`
    - slots：`#hint`（按鈕下方的說明）
  - `MediaFieldCard.vue`（外觀，給兩個資料元件用）
    - props：`state: MediaFieldState`、`noun`、`src?`、`name?`、`meta?`、`builtinText?`、`status?`、`thumb?`、`layout?`、`ratio?`、`size?`、`clearable?`、`clearLabel?`（預設「改回官網內建」）、`required?`、`disabled?`
    - emits：`pick()`、`clear()`、`thumbError()`
    - slots：`#status="{ status }"`（預設畫 StatusTag）、`#hint`
    - class：根 `.media-field`、縮圖 `.media-field__thumb`、按鈕列 `.media-field__actions`

- [ ] **Step 1: 寫失敗的測試** `admin/src/__tests__/mediaField.test.ts`

```ts
// 2026-10-03 第八輪：選照片／影片統一成 MediaFieldCard＋MediaSlotField／MediaRefField
// （稽核 09-28「選照片／影片有四種元件」）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h, ref } from 'vue'
import ElementPlus from 'element-plus'
import MediaRefField from '../components/MediaRefField.vue'
import { api } from '../api/client'
import type { MediaAssetOut } from '../api/types'
import { resetUploadLimits } from '../composables/mediaUpload'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetUploadLimits()
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mediaAsset(overrides: Partial<MediaAssetOut> = {}): MediaAssetOut {
  return {
    id: ID, campus_key: null, kind: 'image', status: 'ready', original_filename: 'garden.jpg',
    content_type: 'image/jpeg', size_bytes: 2048, width: 2000, height: 1500, duration_seconds: null,
    created_at: '2026-09-20T02:00:00Z', created_by_email: null, archived_at: null, deleted_at: null,
    purge_after: null, replaces_media_id: null, alt_text: '菜園', source_attribution: null, caption: null,
    license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null, processing_error: null,
    usage_count: 0, used_in: [], version: 1,
    variants: [{ id: 'v1', kind: 'thumbnail', content_type: 'image/webp', width: 480, height: 360 }],
    ...overrides,
  }
}

function mountRef(props: Record<string, unknown>) {
  const value = ref(String(props.modelValue ?? ''))
  const events: { picked: [string, string | null][]; cleared: number } = { picked: [], cleared: 0 }
  const wrapper = mount(() => h(MediaRefField, {
    ...props,
    modelValue: value.value,
    'onUpdate:modelValue': (v: string) => (value.value = v),
    onPicked: (asset: MediaAssetOut, previous: string | null) => events.picked.push([asset.id, previous]),
    onCleared: () => (events.cleared += 1),
  }), { global: { plugins: [ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, value, events }
}

const buttonTexts = (wrapper: VueWrapper) => wrapper.findAll('.media-field__actions button').map((b) => b.text())

describe('MediaRefField', () => {
  it('沒選、有內建：寫「目前用…」，按鈕是「從素材庫選…」，沒有清除鈕', () => {
    const { wrapper } = mountRef({ modelValue: '', noun: '圖片', builtin: '首頁大圖', clearLabel: '改回首頁大圖' })
    expect(wrapper.text()).toContain('目前用首頁大圖')
    expect(buttonTexts(wrapper)).toEqual(['從素材庫選圖片'])
    expect(wrapper.get('.media-field__thumb').classes()).toContain('is-builtin')
  })

  it('沒選、沒有內建、必填：寫「請從素材庫選一張照片」並標成錯誤', () => {
    const { wrapper } = mountRef({ modelValue: '', required: true, clearable: false })
    const help = wrapper.get('.media-field__info .field-help')
    expect(help.text()).toBe('請從素材庫選一張照片')
    expect(help.classes()).toContain('is-error')
  })

  it('素材庫照片：載縮圖，讀不到退回原檔，原檔也讀不到請重選；按鈕「更換照片」「移除照片」', async () => {
    const { wrapper, value, events } = mountRef({ modelValue: ID })
    const img = () => wrapper.find('.media-field__thumb img')
    expect(img().attributes('src')).toBe(`/api/website/v1/admin/media/${ID}/variants/thumbnail`)
    expect(buttonTexts(wrapper)).toEqual(['更換照片', '移除照片'])
    await img().trigger('error')
    expect(img().attributes('src')).toBe(`/api/website/v1/admin/media/${ID}/file`)
    await img().trigger('error')
    expect(img().exists()).toBe(false)
    expect(wrapper.text()).toContain('讀不到這張照片，請重新選擇')

    await wrapper.findAll('.media-field__actions button')[1]!.trigger('click')
    expect(value.value).toBe('')
    expect(events.cleared).toBe(1)
  })

  it('舊示意內容的官網內建代號：寫「目前用官網內建的照片」', () => {
    const { wrapper } = mountRef({ modelValue: 'campus' })
    expect(wrapper.text()).toContain('目前用官網內建的照片')
    expect(wrapper.get('.media-field__thumb img').attributes('src')).toMatch(/\/assets\/campus\.webp$/)
  })

  it('素材還在處理或處理失敗：標出狀態（給背景轉檔用）', () => {
    expect(mountRef({ modelValue: ID, status: 'processing' }).wrapper.get('.media-field__status').text()).toBe('處理中')
    expect(mountRef({ modelValue: ID, status: 'failed' }).wrapper.get('.media-field__status').text()).toBe('失敗')
    expect(mountRef({ modelValue: ID, status: 'ready' }).wrapper.find('.media-field__status').exists()).toBe(false)
  })

  it('從選圖器選一張：先更新值、再回報 picked（附上選之前的值）', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
      return [mediaAsset({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', original_filename: 'new.jpg' })] as never
    })
    const { wrapper, value, events } = mountRef({ modelValue: ID })
    await wrapper.findAll('.media-field__actions button')[0]!.trigger('click')
    await flushPromises()
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('new.jpg'))!.click()
    await flushPromises()
    expect(value.value).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(events.picked).toEqual([['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ID]])
  })

  it('唯讀：不顯示按鈕；不要縮圖時只留文字與按鈕', () => {
    expect(mountRef({ modelValue: ID, disabled: true }).wrapper.find('.media-field__actions').exists()).toBe(false)
    expect(mountRef({ modelValue: ID, thumb: false }).wrapper.find('.media-field__thumb').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run src/__tests__/mediaField.test.ts`
Expected：FAIL，`Failed to resolve import "../components/MediaRefField.vue"`。

- [ ] **Step 3: `mediaThumbs.ts` 檔尾加型別**

```ts
/**
 * 選圖欄位的狀態（components/MediaFieldCard.vue）：
 * empty＝沒選也沒有內建、builtin＝沒選、官網用內建素材、legacy＝舊示意內容的內建代號、
 * media＝素材庫的素材、broken＝素材庫的素材但縮圖與原檔都讀不到、missing＝讀不到素材資料
 * （已刪除或沒有權限）。
 */
export type MediaFieldState = 'empty' | 'builtin' | 'legacy' | 'media' | 'broken' | 'missing'
```

- [ ] **Step 4: 寫 `components/MediaFieldCard.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { mediaStatus } from '../api/labels'
import type { MediaAssetOut } from '../api/types'
import type { MediaFieldState } from '../composables/mediaThumbs'
import StatusTag from './StatusTag.vue'

/**
 * 選照片／影片欄位共用的外觀（2026-10-03 第八輪；原本消息封面、內文圖片、分享圖、
 * 校園探索、素材版位各寫一套）：縮圖、「目前用…」或檔名、素材狀態、兩顆按鈕
 * （從素材庫選／更換、清除）。不自己讀素材、不開選圖器：MediaSlotField（存
 * {media_id, focus}）與 MediaRefField（存素材 id 字串）決定 state、縮圖與狀態再交給這裡。
 *
 * status 是素材處理狀態（media_assets.status）。選圖器只列 ready 的素材，但已經用進
 * 內容的素材之後可能被重新處理（背景轉檔），不是 ready 時在這裡標出來。
 */
const props = withDefaults(defineProps<{
  state: MediaFieldState
  noun: '照片' | '圖片' | '影片'
  src?: string
  name?: string
  meta?: string
  builtinText?: string
  status?: MediaAssetOut['status'] | null
  thumb?: boolean
  layout?: 'row' | 'stack'
  ratio?: string
  size?: 'sm' | 'md'
  clearable?: boolean
  clearLabel?: string
  required?: boolean
  disabled?: boolean
}>(), {
  src: '', name: '', meta: '', builtinText: '', status: null, thumb: true, layout: 'row', ratio: '4 / 3', size: 'md',
  clearable: true, clearLabel: '改回官網內建', required: false, disabled: false,
})

const emit = defineEmits<{ pick: []; clear: []; thumbError: [] }>()

const unit = computed(() => (props.noun === '影片' ? '支' : '張'))
const chosen = computed(() => props.state !== 'empty' && props.state !== 'builtin')
const pickLabel = computed(() => (chosen.value ? `更換${props.noun}` : `從素材庫選${props.noun}`))
const statusMeta = computed(() => (props.status && props.status !== 'ready' ? mediaStatus(props.status) : null))
const showImage = computed(() => Boolean(props.src) && (props.state === 'media' || props.state === 'legacy' || props.state === 'builtin'))
const placeholder = computed(() => {
  if (props.state === 'builtin') return '內建'
  if (props.state === 'broken' || props.state === 'missing') return '讀不到'
  return props.noun
})
</script>

<template>
  <div class="media-field" :class="[`media-field--${layout}`, `media-field--${size}`]" :style="{ '--media-field-ratio': ratio }">
    <div
      v-if="thumb"
      class="media-field__thumb"
      :class="{ 'is-builtin': state === 'builtin' || state === 'empty', 'is-broken': state === 'broken' || state === 'missing' }"
    >
      <img v-if="showImage" :src="src" alt="" loading="lazy" @error="emit('thumbError')" />
      <span v-else class="media-field__placeholder">{{ placeholder }}</span>
    </div>
    <div class="media-field__info">
      <template v-if="state === 'media' || state === 'broken'">
        <strong class="media-field__name" :title="name || undefined">{{ name || `素材庫的${noun}` }}</strong>
        <span v-if="meta" class="field-help">{{ meta }}</span>
      </template>
      <span v-else-if="state === 'legacy'" class="field-help">目前用官網內建的{{ noun }}</span>
      <span v-else-if="state === 'builtin'" class="field-help">目前用{{ builtinText }}</span>
      <span v-else-if="state === 'empty'" class="field-help" :class="{ 'is-error': required }">{{ required ? `請從素材庫選一${unit}${noun}` : `尚未選擇${noun}` }}</span>
      <span v-if="state === 'broken'" class="media-field__warn">讀不到這{{ unit }}{{ noun }}，請重新選擇</span>
      <span v-if="state === 'missing'" class="media-field__warn">讀不到這個素材（可能已刪除或沒有權限），請重新選擇</span>
      <slot name="status" :status="status">
        <StatusTag v-if="statusMeta" :meta="statusMeta" size="small" class="media-field__status" />
      </slot>
      <div v-if="!disabled" class="media-field__actions">
        <el-button size="small" @click="emit('pick')">{{ pickLabel }}</el-button>
        <el-button v-if="clearable && chosen" size="small" text @click="emit('clear')">{{ clearLabel }}</el-button>
      </div>
      <slot name="hint" />
    </div>
  </div>
</template>

<style scoped>
.media-field { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; width: 100%; min-width: 0; }
.media-field--stack { flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 8px; }
.media-field__thumb {
  flex: 0 0 auto;
  width: 160px;
  max-width: 100%;
  aspect-ratio: var(--media-field-ratio, 4 / 3);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}
.media-field--sm .media-field__thumb { width: 120px; }
.media-field--stack .media-field__thumb { width: 100%; }
.media-field__thumb.is-builtin { border-style: dashed; }
.media-field__thumb.is-broken { border-color: var(--el-color-danger-light-5); }
.media-field__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.media-field__placeholder { display: grid; place-items: center; height: 100%; color: var(--ink-3); font-size: 12px; }
.media-field__info { display: grid; gap: 4px; flex: 1 1 180px; min-width: 0; }
.media-field--stack .media-field__info { flex: none; }
.media-field__name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.media-field__warn { color: var(--el-color-danger); font-size: 12px; }
.media-field__status { justify-self: start; }
.media-field__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.media-field__actions .el-button + .el-button { margin-left: 0; }
@media (pointer: coarse) {
  .media-field__actions .el-button { min-height: 44px; }
}
</style>
```

- [ ] **Step 5: 寫 `components/MediaRefField.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MediaAssetOut } from '../api/types'
import { isMediaId, useMediaThumbs, type MediaFieldState } from '../composables/mediaThumbs'
import MediaFieldCard from './MediaFieldCard.vue'
import MediaPickerDialog from './MediaPickerDialog.vue'

/**
 * 存「素材 id 字串」的選圖欄位：消息封面、內文圖片、分享圖、校園探索場景，之後
 * /about、/curriculum 的照片也用這個。值有三種：''＝沒選；素材庫的 UUID；舊示意
 * 內容的官網內建代號（例如 "campus"）。縮圖先載素材縮圖、讀不到退回原檔、都讀不到
 * 請使用者重選（composables/mediaThumbs）。存 {media_id, 焦點} 的版位用 MediaSlotField。
 *
 * 選好後先 emit update:modelValue 再 emit picked（附上選之前的值，沒有為 null），頁面
 * 用 altAfterPick 帶入或換掉圖片說明；按清除鈕 emit update:modelValue('') 與 cleared。
 * status 預留給背景轉檔：頁面知道素材處理狀態時傳進來，不是 ready 就標出來。
 */
const props = withDefaults(defineProps<{
  modelValue: string
  kind?: 'image' | 'video'
  campusKey?: string
  noun?: '照片' | '圖片' | '影片'
  builtin?: string
  builtinSrc?: string
  clearable?: boolean
  clearLabel?: string
  required?: boolean
  status?: MediaAssetOut['status'] | null
  thumb?: boolean
  layout?: 'row' | 'stack'
  ratio?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}>(), {
  kind: 'image', campusKey: undefined, noun: undefined, builtin: '', builtinSrc: '', clearable: true, clearLabel: undefined,
  required: false, status: null, thumb: true, layout: 'row', ratio: '4 / 3', size: 'md', disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  picked: [asset: MediaAssetOut, previousId: string | null]
  cleared: []
}>()

const thumbs = useMediaThumbs()
const pickerVisible = ref(false)
const nounText = computed(() => props.noun ?? (props.kind === 'video' ? '影片' : '照片'))
const state = computed<MediaFieldState>(() => {
  const value = props.modelValue
  if (!value) return props.builtin ? 'builtin' : 'empty'
  if (!isMediaId(value)) return 'legacy'
  return thumbs.isBroken(value) ? 'broken' : 'media'
})
const src = computed(() => {
  if (state.value === 'builtin') return props.builtinSrc
  if (state.value === 'media' || state.value === 'legacy') return thumbs.src(props.modelValue)
  return ''
})
const clearText = computed(() => props.clearLabel ?? (props.builtin ? '改回官網內建' : `移除${nounText.value}`))

function choose(asset: MediaAssetOut) {
  const previous = props.modelValue || null
  // 重新選了同一張（例如之前讀失敗）：清掉失敗紀錄再試一次。
  thumbs.forget(asset.id)
  emit('update:modelValue', asset.id)
  emit('picked', asset, previous)
}

function clear() {
  emit('update:modelValue', '')
  emit('cleared')
}
</script>

<template>
  <div class="media-ref">
    <MediaFieldCard
      :state="state"
      :noun="nounText"
      :src="src"
      :builtin-text="builtin"
      :status="status"
      :thumb="thumb"
      :layout="layout"
      :ratio="ratio"
      :size="size"
      :clearable="clearable"
      :clear-label="clearText"
      :required="required"
      :disabled="disabled"
      @pick="pickerVisible = true"
      @clear="clear"
      @thumb-error="thumbs.onError(modelValue)"
    >
      <template #hint><slot name="hint" /></template>
    </MediaFieldCard>
    <MediaPickerDialog v-model="pickerVisible" :kind="kind" :campus-key="campusKey" @select="choose" />
  </div>
</template>
```

- [ ] **Step 6: `MediaSlotField.vue` 改用 `MediaFieldCard`**

script：import 加 `import MediaFieldCard from './MediaFieldCard.vue'` 與 `import type { MediaFieldState } from '../composables/mediaThumbs'`；`noun` 那行改型別、並在 `previewUrl` 下面加：

```ts
const noun = computed<'照片' | '影片'>(() => (props.kind === 'video' ? '影片' : '照片'))
```

```ts
const cardState = computed<MediaFieldState>(() => (!props.modelValue ? 'builtin' : missing.value ? 'missing' : 'media'))
const cardSrc = computed(() => (props.modelValue ? previewUrl.value : props.builtinSrc))
// 檔名下面那行：影片寫長度與尺寸，照片寫尺寸。
const cardMeta = computed(() => {
  const a = asset.value
  if (!a) return ''
  const size = a.width && a.height ? `${a.width}×${a.height}` : ''
  if (props.kind === 'video') return [formatDuration(a.duration_seconds), size].filter(Boolean).join('・')
  return size
})
```

模板裡整段 `<div class="slot__main">…</div>` 換成：

```html
    <MediaFieldCard
      :state="cardState"
      :noun="noun"
      :src="cardSrc"
      :name="asset?.original_filename ?? ''"
      :meta="cardMeta"
      :builtin-text="builtin"
      :status="asset?.status ?? null"
      :disabled="disabled"
      @pick="pickerVisible = true"
      @clear="clearSlot"
    />
```

`<style scoped>` 只留 `.slot { display: grid; gap: 10px; width: 100%; min-width: 0; }`，其餘 `.slot__*` 規則刪掉。

- [ ] **Step 7: 舊測試選擇器跟著改**

`admin/src/__tests__/mediaSlots.test.ts` 三處 `.slot__thumb img` 改 `.media-field__thumb img`（約第 226、253、264 行；用 `grep -n "slot__thumb" admin/src/__tests__/mediaSlots.test.ts` 找）。

- [ ] **Step 8: 跑測試確認通過**

Run：`npx vitest run src/__tests__/mediaField.test.ts src/__tests__/mediaSlots.test.ts src/__tests__/ux20260928E.test.ts`
Expected：全部 PASS（`ux20260928E` 的首屏影片封面「更換照片」仍過，因為 `MediaSlotField` API 不變）。

- [ ] **Step 9: Commit**

```bash
git add admin/src/composables/mediaThumbs.ts admin/src/components/MediaFieldCard.vue admin/src/components/MediaRefField.vue admin/src/components/MediaSlotField.vue admin/src/__tests__/mediaField.test.ts admin/src/__tests__/mediaSlots.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 選圖欄位共用外觀 MediaFieldCard，新增存素材 id 的 MediaRefField

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 消息封面、內文圖片、分享圖、校園探索改用 `MediaRefField`

**Files:**
- Modify: `admin/src/components/NewsEntriesEditor.vue`（封面 `:176-192`、script 的 `pickImage`／`onPickMedia`／`pickerVisible`／`pickingIndex`／`thumbs`、`MediaPickerDialog`、樣式 `.news-item__thumb*`）
- Modify: `admin/src/components/NewsBodyEditor.vue`（圖片區塊 `:89-112`、script 同類、`add()` 的聚焦選擇器、樣式 `.news-body__thumb*`）
- Modify: `admin/src/views/SiteMetaView.vue:42-58,86-97`（與 `.share*` 樣式）
- Modify: `admin/src/views/CampusTourView.vue:118-130,338-346`
- Modify: `admin/src/__tests__/ux20260928E.test.ts:411-418,519`
- Test: `admin/src/__tests__/mediaField.test.ts`（加一個 describe）

**Interfaces:**
- Consumes：Task 3 的 `MediaRefField`（props／emits 見上）、`altAfterPick`、`BUILTIN_PHOTO`（`composables/mediaThumbs.ts`）。
- Produces：`MediaPickerDialog.vue` 之後只由 `MediaSlotField.vue` 與 `MediaRefField.vue` 引用（靜態測試守門）。

- [ ] **Step 1: 寫失敗的測試**（加在 `mediaField.test.ts` 檔尾；檔頭補 import）

檔頭補：

```ts
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import CampusTourView from '../views/CampusTourView.vue'
import HomeNewsView from '../views/HomeNewsView.vue'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
```

檔尾：

```ts
const sources = import.meta.glob(['../views/*.vue', '../components/*.vue'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function contentItem(kind: string, payload: unknown, campusKey: string | null = null) {
  return {
    id: `${kind}-item`, kind, campus_key: campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', payload, review_status: 'draft' },
  }
}

async function mountView(component: unknown, path = '/') {
  resetTitleFontCoverage()
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function mockLibrary(item: ReturnType<typeof contentItem>, library: MediaAssetOut[]) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/content-items/')) return item as never
    if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
    if (path.startsWith('/admin/media')) return library as never
    return [] as never
  })
}

describe('四種舊寫法改用 MediaRefField', () => {
  it('其他頁面與元件不直接開選圖器，一律經 MediaSlotField／MediaRefField', () => {
    const users = Object.entries(sources)
      .filter(([, src]) => src.includes("MediaPickerDialog.vue'"))
      .map(([path]) => path.split('/').pop())
      .sort()
    expect(users).toEqual(['MediaRefField.vue', 'MediaSlotField.vue'])
  })

  it('消息封面：展開後是共用欄位，可以移除照片；換照片帶入新照片的說明', async () => {
    mockLibrary(contentItem('home_news', {
      sample_note: '', home_display_count: null, films: null, events: [],
      articles: [{ id: 'a1', date: '2026-10-01', category: '', title: '菜園', description: '', image: ID, alt: '舊說明', scope: 'global', campus_keys: [], featured: false, body: [] }],
    }), [mediaAsset({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', original_filename: 'new.jpg', alt_text: '新照片的說明' })])
    const wrapper = await mountView(HomeNewsView)
    await wrapper.get('.news-item .repeat-item__toggle').trigger('click')
    const field = wrapper.get('.news-item .media-field')
    expect(field.findAll('.media-field__actions button').map((b) => b.text())).toEqual(['更換照片', '移除照片'])
    await field.findAll('.media-field__actions button')[0]!.trigger('click')
    await flushPromises()
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('new.jpg'))!.click()
    await flushPromises()
    const alt = wrapper.findAll('.news-item textarea').map((t) => (t.element as HTMLTextAreaElement).value)
    expect(alt).toContain('新照片的說明')
  })

  it('校園探索：換了照片，這個場景的熱點標成要重新確認', async () => {
    mockLibrary(contentItem('campus_tour', {
      scenes: [{ key: 'gate', name: '大門', image: ID, intro: '', spots_reviewed: true, spots: [{ name: '警衛室', x: 10, y: 10, text: '', question: '' }] }],
    }, 'yihua'), [mediaAsset({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', original_filename: 'new.jpg', campus_key: 'yihua' })])
    const wrapper = await mountView(CampusTourView, '/content/campus-tour?campus=yihua')
    expect(wrapper.text()).not.toContain('熱點位置都確認過了')
    const field = wrapper.get('.tour__side .media-field')
    expect(field.find('.media-field__thumb').exists()).toBe(false)
    await field.findAll('.media-field__actions button')[0]!.trigger('click')
    await flushPromises()
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.picker__item')).find((b) => b.textContent?.includes('new.jpg'))!.click()
    await flushPromises()
    expect(wrapper.text()).toContain('熱點位置都確認過了')
  })
})
```

> 「熱點位置都確認過了」按鈕只在 `spots_reviewed === false` 時出現（`CampusTourView.vue:323`）；`.tour__side` 是右側表單欄的容器（`CampusTourView.vue:313`）。

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run src/__tests__/mediaField.test.ts`
Expected：FAIL，第一個測試列出 `['CampusTourView.vue', 'MediaRefField.vue', 'MediaSlotField.vue', 'NewsBodyEditor.vue', 'NewsEntriesEditor.vue', 'SiteMetaView.vue']`。

- [ ] **Step 3: `NewsEntriesEditor.vue`**

script：刪掉 `MediaPickerDialog` import、`Picture` icon（只剩封面用到時）、`useMediaThumbs`／`isMediaId` import、`const thumbs = useMediaThumbs()`、`pickerVisible`、`pickingIndex`、`pickImage()`、`onPickMedia()`；加 `import MediaRefField from './MediaRefField.vue'`，保留 `altAfterPick` import。`.news-item__photo` 內容換成：

```html
      <div class="news-item__photo">
        <MediaRefField
          v-model="article.image"
          :campus-key="campusKey"
          layout="stack"
          ratio="1.55"
          :disabled="readOnly"
          @picked="(asset, previous) => (article.alt = altAfterPick(article.alt, previous, asset))"
        >
          <template #hint><span class="field-help">{{ IMAGE_HINTS.news }}</span></template>
        </MediaRefField>
      </div>
```

刪掉模板最後的 `<MediaPickerDialog v-model="pickerVisible" … @select="onPickMedia" />`，以及樣式裡 `.news-item__thumb`、`.news-item__thumb img`、`.news-item__thumb-empty`、`.news-item__thumb.is-broken`、`.news-item__thumb-broken` 與手機斷點裡對應的規則（`.news-item__photo` 本身保留）。

- [ ] **Step 4: `NewsBodyEditor.vue`**

script：刪 `MediaPickerDialog`、`Picture`、`useMediaThumbs`、`thumbs`、`pickerVisible`、`pickingIndex`、`pickImage()`、`onPick()`；加 `import MediaRefField from './MediaRefField.vue'`，保留 `altAfterPick`。`add()` 的聚焦選擇器 `'textarea, input:not([type=checkbox]), .news-body__thumb'` 改 `'textarea, input:not([type=checkbox]), .media-field__actions button'`。圖片區塊的 `<button class="news-body__thumb" …>…</button>` 整段換成：

```html
        <MediaRefField
          v-model="block.image"
          :campus-key="campusKey"
          noun="圖片"
          layout="stack"
          ratio="1.55"
          :clearable="false"
          required
          :disabled="readOnly"
          @picked="(asset, previous) => (block.alt = altAfterPick(block.alt, previous, asset))"
        />
```

刪掉 `.news-body__image-fields` 裡的 `<span v-if="!block.image" class="field-help is-error">請從素材庫選一張圖片</span>`（`required` 已顯示同一句）、模板最後的 `<MediaPickerDialog …>`、樣式 `.news-body__thumb*` 規則。

- [ ] **Step 5: `SiteMetaView.vue`**

script：刪 `MediaPickerDialog` import、`pickerVisible`、`thumbs`、`clearShareImage()`、`shareImage`；import 加 `MediaRefField`；`onPickShareImage` 改成：

```ts
// 換成另一張時換成新照片在素材庫的說明（沒填就清空），不留舊照片的說明。說明欄
// 只在設了分享圖時出現，沒設時留著的字是舊版本改回首頁大圖後留下的，一樣換掉。
function onPickShareImage(asset: MediaAssetOut, previousId: string | null) {
  const form = editor.form.value
  form.share_image_alt = altAfterPick(form.share_image_alt, previousId ?? BUILTIN_PHOTO, asset)
}
```

模板 `<div class="share">…</div>` 與下面那行 `field-help` 換成：

```html
        <MediaRefField
          v-model="editor.form.value.share_image"
          noun="圖片"
          builtin="首頁大圖"
          clear-label="改回首頁大圖"
          ratio="1200 / 630"
          :disabled="editor.readOnly.value"
          @picked="onPickShareImage"
          @cleared="editor.form.value.share_image_alt = ''"
        >
          <template #hint><span class="field-help">建議 1200×630 的橫式 JPG。沒設定時用首頁大圖。</span></template>
        </MediaRefField>
```

刪掉模板最後的 `<MediaPickerDialog …>` 與 `.share`、`.share__img`、`.share__broken`、`.share__actions` 樣式。

- [ ] **Step 6: `CampusTourView.vue`**

`onPickMedia` 改成（保留給場景分頁縮圖用的 `thumbs`）：

```ts
// 換了照片，原本的熱點座標可能對不上：伺服器存檔時也會這樣標，這裡先標，畫面上
// 立刻看得到要複核。值本身由 MediaRefField 的 v-model 換好了。
function onPickMedia(asset: MediaAssetOut, previousId: string | null) {
  const scene = currentScene.value
  if (scene && previousId && previousId !== asset.id) scene.spots_reviewed = false
  thumbs.forget(asset.id)
  imageBroken.value = false
}
```

刪 `const pickerVisible = ref(false)` 與模板最後的 `<MediaPickerDialog …>`、`MediaPickerDialog` import；import 加 `MediaRefField`。「照片」那個 `el-form-item` 的內容換成：

```html
              <el-form-item label="照片">
                <MediaRefField
                  v-model="currentScene.image"
                  :campus-key="campus"
                  :thumb="false"
                  :clearable="false"
                  :disabled="editor.readOnly.value"
                  @picked="onPickMedia"
                >
                  <template #hint><span class="field-help">{{ IMAGE_HINTS.tour }}</span></template>
                </MediaRefField>
              </el-form-item>
```

刪掉 `.tour__image-row` 樣式。

- [ ] **Step 7: 舊測試跟著改**

`admin/src/__tests__/ux20260928E.test.ts`：
- 第 411 行 `wrapper.find('.news-item__thumb img')` → 先 `await wrapper.get('.news-item .repeat-item__toggle').trigger('click')` 展開，再 `wrapper.find('.news-item .media-field__thumb img')`。
- 第 418 行 `wrapper.get('.news-item__thumb').text()` → `wrapper.get('.news-item .media-field').text()`。
- 第 519 行 `button(wrapper, '從素材庫選擇')` → `button(wrapper, '從素材庫選圖片')`。

- [ ] **Step 8: 跑測試確認通過**

Run：`npx vitest run src/__tests__/mediaField.test.ts src/__tests__/ux20260928E.test.ts src/__tests__/homeNews.test.ts src/__tests__/newsFaqEditors.test.ts src/__tests__/siteStructure.test.ts src/__tests__/mediaSlots.test.ts`
Expected：全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add admin/src/components/NewsEntriesEditor.vue admin/src/components/NewsBodyEditor.vue admin/src/views/SiteMetaView.vue admin/src/views/CampusTourView.vue admin/src/__tests__/mediaField.test.ts admin/src/__tests__/ux20260928E.test.ts
git commit -m "$(cat <<'EOF'
refactor(admin): 消息封面、內文圖片、分享圖、校園探索改用共用選圖欄位

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 後端：狀態轉換錯誤訊息改中文

**Files:**
- Modify: `backend/app/booking/workflow_service.py:13`（import）、`:71`、`:179`、`:498`
- Test: `backend/tests/test_visit_workflow.py`（檔尾加一個測試）

**Interfaces:**
- Consumes：`app.booking.export_labels.status_label(value: str) -> str`（既有）。
- Produces：`INVALID_TRANSITION` 的 `message` 形如「這筆案件現在是「已取消」，不能排入場次」；`code` 不變。

- [ ] **Step 1: 寫失敗的測試**（`test_visit_workflow.py` 檔尾）

```python
@pytest.mark.asyncio
async def test_invalid_transition_message_names_status_in_chinese(admin_client, db_session):
    """兩位櫃台同時處理：另一位已經結案時，錯誤訊息寫中文狀態，不寫 cancelled 之類的代碼。"""
    done = await legacy_request(db_session, status="completed", parent_name="陳媽媽", phone="0912000801")
    resp = await admin_client.post(f"/api/website/v1/admin/visit-requests/{done}/cancel")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "INVALID_TRANSITION"
    assert resp.json()["detail"]["message"] == "這筆案件現在是「已到場」，不能取消"

    cancelled = await legacy_request(db_session, status="cancelled", parent_name="林媽媽", phone="0912000802")
    slot = await _create_slot(admin_client)
    resp = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{cancelled}/confirm", json={"slot_id": slot["id"]}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["message"] == "這筆案件現在是「已取消」，不能排入場次"
```

- [ ] **Step 2: 跑測試確認失敗**

Run（`backend/`）：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_visit_workflow.py -k chinese`
Expected：FAIL，`assert '狀態 completed 不能取消' == '這筆案件現在是「已到場」，不能取消'`。

- [ ] **Step 3: 改 `workflow_service.py`**

import 區（`from app.booking.exceptions import …` 下面）加：

```python
from app.booking.export_labels import status_label
```

三處改成：

```python
        raise InvalidTransition(f"這筆案件現在是「{status_label(visit_request.status)}」，不能排入場次")
```
```python
        raise InvalidTransition(f"這筆案件現在是「{status_label(visit_request.status)}」，不能取消")
```
```python
        raise InvalidTransition(f"這筆案件現在是「{status_label(visit_request.status)}」，不能修改資料")
```

- [ ] **Step 4: 跑測試確認通過**

Run：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_visit_workflow.py tests/test_visit_case_handling.py tests/test_visit_details.py tests/test_parent_access.py`
Expected：全部 PASS（舊測試只比 code，不比訊息）。若有舊測試比到舊字串，改成新字串。

- [ ] **Step 5: Commit**

```bash
git add backend/app/booking/workflow_service.py backend/tests/test_visit_workflow.py
git commit -m "$(cat <<'EOF'
fix(booking): 狀態轉換錯誤訊息寫中文狀態名，不寫英文代碼

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 案件明細：衝突重讀、最後處理、切回分頁更新

**Files:**
- Modify: `admin/src/api/visitHistory.ts`（加 `lastHandled`）
- Modify: `admin/src/views/VisitDetailView.vue`（import、`reportError` `:292-301`、`load()` 記讀取時間、`onMounted`／`onBeforeUnmount`、頁首模板 `:791-803`、樣式）
- Test: `admin/src/__tests__/uxRound8Cases.test.ts`

**Interfaces:**
- Consumes：Task 5 的中文訊息（前端不靠字串判斷，只看 `apiErrorCode(err) === 'INVALID_TRANSITION'`）。
- Produces：
  - `export interface LastHandled { who: string; at: string; what: string; self: boolean }`
  - `export function lastHandled(history: VisitHistoryOut[], selfId: string | null): LastHandled | null`（`api/visitHistory.ts`；聯絡紀錄也會寫 `contact_logged` 歷程，所以只看歷程）

- [ ] **Step 1: 寫失敗的測試** `admin/src/__tests__/uxRound8Cases.test.ts`

```ts
// 2026-10-03 第八輪：兩位櫃台同時處理同一案件（稽核 09-28）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { api, ApiError } from '../api/client'
import { lastHandled } from '../api/visitHistory'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })

const future = { id: 'slot-f', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const event = (extra: Record<string, unknown>) => ({
  id: `e-${Math.random()}`, event_type: 'contact_logged', source: 'staff', actor_user_id: 'u-wang', actor_email: 'wang@ivy.example',
  actor_display_name: '王老師', before: null, after: null, reason: null, created_at: '2026-10-03T02:00:00Z', ...extra,
})
const caseOf = (extra: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: future.id, slot: future, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: null, confirmed_at: '2026-09-22T00:00:00Z', cancelled_at: null, source: 'web', display_status: 'upcoming',
  history: [], pending_reschedule: null, access_link: null, version: 1, ...extra,
})

async function mountDetail(responses: () => Record<string, unknown>) {
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    const url = String(path)
    if (url.endsWith('/contact-notes')) return [] as never
    if (url.startsWith('/admin/booking-config/')) return { parent_email_enabled: false } as never
    if (url.startsWith('/admin/slots') || url.startsWith('/admin/visit-requests?') || url.startsWith('/admin/visit-staff')) return [] as never
    return responses() as never
  })
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/case-a'); await router.isReady()
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('lastHandled', () => {
  it('取最近一筆後台同事的歷程；家長與系統的不算；自己做的寫「你」', () => {
    const history = [
      event({ created_at: '2026-10-03T01:00:00Z', event_type: 'assigned' }),
      event({ created_at: '2026-10-03T03:00:00Z', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, event_type: 'details_updated' }),
      event({ created_at: '2026-10-03T02:00:00Z' }),
    ]
    expect(lastHandled(history as never, 'me')).toEqual({ who: '王老師', at: '2026-10-03T02:00:00Z', what: '新增聯絡紀錄', self: false })
    expect(lastHandled([event({ actor_user_id: 'me' })] as never, 'me')).toMatchObject({ who: '你', self: true })
    expect(lastHandled([], 'me')).toBeNull()
  })
})

describe('案件明細：同時處理', () => {
  it('頁首寫最後處理：誰・何時・做了什麼', async () => {
    const wrapper = await mountDetail(() => caseOf({ history: [event({})] }))
    expect(wrapper.get('.detail__handled').text()).toMatch(/^最後處理：王老師・.+・新增聯絡紀錄$/)
  })

  it('按取消時別人已經結案：重讀明細，寫出現在的狀態與是誰處理的', async () => {
    let current = caseOf()
    const wrapper = await mountDetail(() => current)
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    vi.spyOn(api, 'post').mockImplementation(async () => {
      current = caseOf({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-03T02:00:00Z', history: [event({ event_type: 'cancelled' })] })
      throw new ApiError(409, { code: 'INVALID_TRANSITION', message: '這筆案件現在是「已取消」，不能取消' })
    })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    await wrapper.get('.detail__cancel').trigger('click')
    await flushPromises()
    const message = String((warning.mock.calls[0]![0] as { message: string }).message)
    expect(message).toContain('剛被處理過')
    expect(message).toContain('王老師')
    expect(message).toContain('已取消')
    expect(wrapper.get('.detail__status').text()).toContain('已取消')
  })

  it('狀態沒變的 INVALID_TRANSITION：照後端原因提示，不說被別人處理', async () => {
    const wrapper = await mountDetail(() => caseOf())
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'INVALID_TRANSITION', message: '參觀還沒開始，不能標記' }))
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation((() => undefined) as never)
    await wrapper.get('.detail__cancel').trigger('click')
    await flushPromises()
    expect(warning).not.toHaveBeenCalled()
    expect(String((error.mock.calls[0]![0] as { message: string }).message)).toBe('參觀還沒開始，不能標記')
  })

  it('切回分頁超過 30 秒靜默重讀；同事剛改過就提示；打到一半的聯絡紀錄不被清掉', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'))
    let current = caseOf()
    const wrapper = await mountDetail(() => current)
    const note = wrapper.get('textarea')
    await note.setValue('家長說下週再約')
    current = caseOf({ history: [event({ event_type: 'assigned', created_at: '2026-10-03T03:00:20Z' })] })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)

    vi.setSystemTime(new Date('2026-10-03T03:00:10Z'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(warning).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-10-03T03:00:40Z'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toBe('王老師剛剛指派承辦人，畫面已更新。')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('家長說下週再約')
  })
})
```

> 頁面上第一個 textarea 就是聯絡紀錄框（`VisitDetailView.vue:854-856`，`ref="noteInput"`）。

- [ ] **Step 2: 跑測試確認失敗**

Run（`admin/`）：`npx vitest run src/__tests__/uxRound8Cases.test.ts`
Expected：FAIL，`lastHandled is not a function`／`.detail__handled` 找不到。

- [ ] **Step 3: `visitHistory.ts` 加 `lastHandled`**（檔尾）

```ts
export interface LastHandled {
  /** 誰：同事的顯示名稱（沒設時 Email 前段），自己是「你」 */
  who: string
  at: string
  /** 做了什麼，和歷程列表同一個詞（visitEventTitle） */
  what: string
  self: boolean
}

/**
 * 案件頁首的「最後處理」：後台同事最近一次動這筆案件（歷程裡 source=staff 的事件）。
 * 新增聯絡紀錄也會寫一筆 contact_logged 歷程，所以只看歷程就夠。家長自己改、系統排程
 * 的不算——櫃台要知道的是「同事是不是剛處理過」。
 */
export function lastHandled(history: VisitHistoryOut[], selfId: string | null): LastHandled | null {
  let best: LastHandled | null = null
  let bestAt = Number.NEGATIVE_INFINITY
  for (const event of history) {
    if (event.source !== 'staff') continue
    const at = Date.parse(event.created_at)
    if (Number.isNaN(at) || at <= bestAt) continue
    const self = Boolean(selfId) && event.actor_user_id === selfId
    best = { who: self ? '你' : visitEventActor(event), at: event.created_at, what: visitEventTitle(event), self }
    bestAt = at
  }
  return best
}
```

- [ ] **Step 4: `VisitDetailView.vue`**

import：`import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'`；`import { lastHandled } from '../api/visitHistory'`；`import { useAuthStore } from '../stores/auth'`；labels 那行補 `visitStatus`（已有就不用）。

`const route = useRoute()` 附近加：

```ts
const authStore = useAuthStore()
// 頁首「最後處理」：同事最近一次動這筆案件（api/visitHistory.ts）。
const handled = computed(() => (detail.value ? lastHandled(detail.value.history, authStore.user?.id ?? null) : null))
```

`let generation = 0` 下面加：

```ts
// 上次讀到案件的時間：切回分頁時超過 DETAIL_STALE_MS 才靜默重讀（不做固定輪詢）。
let loadedAt = 0
const DETAIL_STALE_MS = 30_000
```

`load()` 裡 `detail.value = loaded` 下一行加 `loadedAt = Date.now()`。

`reportError` 改成：

```ts
function reportError(err: unknown, fallback: string) {
  if (isVersionConflict(err)) {
    // 別人剛改過承辦人或下次聯絡時間：不蓋掉，重讀案件讓畫面顯示最新的。
    // 已經自動重讀，所以不接後端「請重新載入後再操作」的訊息。
    notifyWarning('這筆案件的承辦人或下次聯絡時間剛被其他人修改，已載入最新的內容，請確認後再操作')
    void refreshDetail()
    return
  }
  if (apiErrorCode(err) === 'INVALID_TRANSITION') {
    void reloadAfterTransitionConflict(err, fallback)
    return
  }
  notifyError(apiErrorMessage(err, fallback))
}

// 狀態轉換被擋：多半是同事剛處理過（兩人同時開著同一筆）。重讀後狀態真的變了就寫
// 現在是什麼、誰在什麼時候做的；狀態沒變（例如場次還沒開始就標記未到場）照後端原因講。
async function reloadAfterTransitionConflict(err: unknown, fallback: string) {
  const before = detail.value?.status
  await load({ quiet: true })
  const current = detail.value
  if (!current || !before || current.status === before) {
    notifyError(apiErrorMessage(err, fallback))
    return
  }
  const by = handled.value && !handled.value.self ? `${handled.value.who}在 ${formatDateTime(handled.value.at)} ${handled.value.what}，` : ''
  const label = statusDisplay.value?.label ?? visitStatus(current.status).label
  notifyWarning(`這筆案件剛被處理過：${by}現在是「${label}」。已載入最新內容，請確認後再操作。`)
}

// 切回這個分頁或視窗：距上次讀取超過 30 秒就靜默重讀（不閃骨架、不動聯絡紀錄草稿與
// 「下次聯絡」的選擇），同事剛處理過就提示一句。
function activityKey(): string {
  const d = detail.value
  return d ? `${d.status}|${d.slot_id ?? ''}|${d.assigned_staff_id ?? ''}|${d.history.length}` : ''
}
async function refreshIfStale() {
  if (document.visibilityState === 'hidden' || loading.value || busy.value || !detail.value) return
  if (Date.now() - loadedAt < DETAIL_STALE_MS) return
  const before = activityKey()
  const gen = generation
  await load({ quiet: true })
  if (gen !== generation) return
  const latest = handled.value
  if (before && activityKey() !== before && latest && !latest.self) notifyWarning(`${latest.who}剛剛${latest.what}，畫面已更新。`)
}
```

（`statusDisplay` 是之後才宣告的 computed；`reloadAfterTransitionConflict` 執行時已存在，不受宣告順序影響。）

`onMounted` 改成：

```ts
onMounted(() => {
  load()
  void loadStaff()
  document.addEventListener('visibilitychange', refreshIfStale)
  window.addEventListener('focus', refreshIfStale)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', refreshIfStale)
  window.removeEventListener('focus', refreshIfStale)
})
```

頁首模板：在 `<p v-if="detail.related_request_id" …>` 前面加：

```html
          <p v-if="handled" class="hint detail__handled">最後處理：{{ handled.who }}・{{ formatDateTime(handled.at) }}・{{ handled.what }}</p>
```

- [ ] **Step 5: 跑測試確認通過**

Run：`npx vitest run src/__tests__/uxRound8Cases.test.ts src/__tests__/receptionUx20261002.test.ts src/__tests__/caseHandling.test.ts src/__tests__/visitDetails.test.ts src/__tests__/selfBookingDetail.test.ts src/__tests__/crossUx20261002.test.ts`
Expected：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add admin/src/api/visitHistory.ts admin/src/views/VisitDetailView.vue admin/src/__tests__/uxRound8Cases.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 案件明細寫出最後處理的人，狀態衝突時重讀並說明，切回分頁自動更新

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 後端：未結案篩選、承辦人已停用篩選、總覽兩個計數

**Files:**
- Modify: `backend/app/booking/status_groups.py`（`OPEN_STATUSES`、`open_condition`）
- Modify: `backend/app/booking/routes.py:844-950`（`VisitRequestFilters`）
- Modify: `backend/app/operations/dashboard_service.py`（兩個計數函式）
- Modify: `backend/app/operations/routes.py:179-205`（`get_dashboard`）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Test: `backend/tests/test_dashboard_my_cases.py`

**Interfaces:**
- Produces：
  - `status_groups.OPEN_STATUSES: tuple[str, ...]`、`status_groups.open_condition()`
  - 清單、分組計數、匯出共用的查詢參數：`open=true`（只列未結案）、`assignee=inactive`（承辦人帳號已停用）
  - `dashboard_service.count_open_cases_assigned_to(db, user_id, campus_keys) -> int`、`dashboard_service.count_open_cases_with_inactive_assignee(db, campus_keys) -> int`
  - `/admin/dashboard` 回應多兩鍵：`my_open_cases: int`（每個人都有）、`inactive_assignee_open_cases: int`（只有 `booking.manage`）

- [ ] **Step 1: 寫失敗的測試** `backend/tests/test_dashboard_my_cases.py`

```python
"""總覽「我承辦的案件」與「承辦人已停用、還沒結案」（2026-10-03 第八輪）。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import update

from app.auth.models import Role
from app.booking.models import VisitRequest
from tests.conftest import _create_user, _logged_in_client, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1/admin"


@pytest.mark.asyncio
async def test_my_open_cases_and_inactive_assignee(app, admin_client, minghua_client, db_session):
    colleague = await _create_user(
        db_session, "yihua-staff@ivy.example", "yihua-staff-password-123", Role.CAMPUS_ADMIN, ["yihua"]
    )
    await db_session.commit()
    open_case = await legacy_request(db_session, status="new", parent_name="王媽媽", phone="0912000901")
    closed_case = await legacy_request(db_session, status="cancelled", parent_name="李媽媽", phone="0912000902")
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id.in_([uuid.UUID(open_case), uuid.UUID(closed_case)]))
        .values(assigned_staff_id=colleague.id)
    )
    await db_session.commit()

    colleague_client = await _logged_in_client(app, "yihua-staff@ivy.example", "yihua-staff-password-123")
    try:
        dashboard = (await colleague_client.get(f"{BASE}/dashboard")).json()
        assert dashboard["my_open_cases"] == 1
        mine = await colleague_client.get(f"{BASE}/visit-requests?assignee=me&open=true")
        assert [row["id"] for row in mine.json()] == [open_case]
    finally:
        await colleague_client.aclose()

    admin_dashboard = (await admin_client.get(f"{BASE}/dashboard")).json()
    assert admin_dashboard["my_open_cases"] == 0
    assert admin_dashboard["inactive_assignee_open_cases"] == 0

    colleague.is_active = False
    await db_session.commit()

    assert (await admin_client.get(f"{BASE}/dashboard")).json()["inactive_assignee_open_cases"] == 1
    inactive = await admin_client.get(f"{BASE}/visit-requests?assignee=inactive&open=true")
    assert [row["id"] for row in inactive.json()] == [open_case]
    counts = (await admin_client.get(f"{BASE}/visit-requests/group-counts?assignee=inactive&open=true")).json()
    assert sum(counts.values()) == 1
    # 別校的校區管理者看不到義華的件數。
    assert (await minghua_client.get(f"{BASE}/dashboard")).json()["inactive_assignee_open_cases"] == 0


@pytest.mark.asyncio
async def test_inactive_assignee_count_only_for_booking_managers(app, db_session):
    await _create_user(db_session, "desk@ivy.example", "desk-password-1234567", Role.RECEPTION, ["yihua"])
    await db_session.commit()
    desk = await _logged_in_client(app, "desk@ivy.example", "desk-password-1234567")
    try:
        dashboard = (await desk.get(f"{BASE}/dashboard")).json()
        assert dashboard["my_open_cases"] == 0
        assert "inactive_assignee_open_cases" not in dashboard
    finally:
        await desk.aclose()
```

> `Role.RECEPTION` 名稱以 `backend/app/auth/models.py` 為準；`minghua_client` 是 conftest 既有 fixture（明華校區管理者）。

- [ ] **Step 2: 跑測試確認失敗**

Run（`backend/`）：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_dashboard_my_cases.py`
Expected：FAIL，`KeyError: 'my_open_cases'`。

- [ ] **Step 3: `status_groups.py`**（`_DONE_STATUSES` 下面）

```python
# 還沒結案：待處理、聯絡中、待園方確認、預約正常（含時間已過還沒標記到場）。
# 總覽「我承辦的案件」「承辦人已停用」與清單的 open=true 用同一個定義。
OPEN_STATUSES = (*PENDING_STATUSES, VisitRequestStatus.CONFIRMED.value)


def open_condition():
    return VisitRequest.status.in_(OPEN_STATUSES)
```

- [ ] **Step 4: `routes.py` 的 `VisitRequestFilters`**

`__init__` 參數 `group` 後面加：

```python
        open_only: bool = Query(
            default=False,
            alias="open",
            description="只列還沒結案的：待處理、待園方確認、預約正常（含時間已過還沒標記到場）",
        ),
```

`assignee` 的 description 改成 `"承辦人：me＝我承辦的、none＝尚未指派、inactive＝承辦人帳號已停用，或承辦人的使用者 id"`。`self.group = group` 下面加 `self.open_only = open_only`。

`apply()` 裡 `if self.group:` 區塊後面加：

```python
        if self.open_only:
            stmt = stmt.where(status_groups.open_condition())
```

承辦人分支 `elif self.assignee == "none":` 後面加：

```python
        elif self.assignee == "inactive":
            # 承辦人帳號已停用、案件還掛在他名下：要有人重新指派。
            stmt = stmt.where(VisitRequest.assigned_staff_id.in_(select(User.id).where(User.is_active.is_(False))))
```

`audit_metadata()` 的 `applied` 加一行 `"open": True if self.open_only else None,`。

- [ ] **Step 5: `dashboard_service.py`**

import 補 `from app.auth.models import User` 與 `from app.booking.status_groups import group_condition, open_condition`（取代原本只 import `group_condition` 那行）。檔尾加：

```python
def _scoped_count(campus_keys: list[str] | None, *conditions):
    stmt = select(func.count()).select_from(VisitRequest).where(open_condition(), *conditions)
    if campus_keys is not None:
        stmt = stmt.where(VisitRequest.campus_key.in_(campus_keys))
    return stmt


async def count_open_cases_assigned_to(db: AsyncSession, user_id: uuid.UUID, campus_keys: list[str] | None) -> int:
    """總覽「我承辦的案件」：指派給這個人、還沒結案的件數。和清單 ?assignee=me&open=true 同一批。"""
    return (await db.execute(_scoped_count(campus_keys, VisitRequest.assigned_staff_id == user_id))).scalar_one()


async def count_open_cases_with_inactive_assignee(db: AsyncSession, campus_keys: list[str] | None) -> int:
    """承辦人帳號已停用、還沒結案的件數。和清單 ?assignee=inactive&open=true 同一批。"""
    inactive = select(User.id).where(User.is_active.is_(False))
    return (await db.execute(_scoped_count(campus_keys, VisitRequest.assigned_staff_id.in_(inactive)))).scalar_one()
```

- [ ] **Step 6: `operations/routes.py` 的 `get_dashboard`**

在 `summary["my_unread_notifications"] = …` 那段之後、`return summary` 之前加：

```python
    # 總覽「我承辦的案件」（2026-10-03 第八輪）；不算待辦，只是讓承辦人找得到自己的案件。
    summary["my_open_cases"] = await dashboard_service.count_open_cases_assigned_to(db, current_user.id, campus_keys)
    # 承辦人停用後案件沒人管：只給能重新指派的人（booking.manage）。
    if has_capability(current_user, "booking.manage"):
        summary["inactive_assignee_open_cases"] = await dashboard_service.count_open_cases_with_inactive_assignee(
            db, campus_keys
        )
```

- [ ] **Step 7: 跑測試確認通過**

Run：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_dashboard_my_cases.py tests/test_visit_manual_and_assign.py tests/test_visit_attention_export.py`
Expected：全部 PASS。

- [ ] **Step 8: 重產契約**

Run（worktree 根目錄）：`source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate; git diff --stat contracts`
Expected：`contracts/openapi.json` 與 `contracts/generated/website-api.d.ts` 有變動，只多了 `open` 參數與 `assignee` 說明。

- [ ] **Step 9: Commit**

```bash
git add backend/app/booking/status_groups.py backend/app/booking/routes.py backend/app/operations/dashboard_service.py backend/app/operations/routes.py backend/tests/test_dashboard_my_cases.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "$(cat <<'EOF'
feat(booking): 案件清單加未結案與承辦人已停用篩選，總覽回我承辦與停用承辦的件數

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 前端：案件篩選、總覽「我承辦的案件」、停用帳號提示

**Files:**
- Modify: `admin/src/views/VisitRequestsView.vue`（篩選狀態、網址同步、參數、清除、件數、空清單文字、模板）
- Modify: `admin/src/views/DashboardView.vue`（型別、讀取、模板、樣式）
- Modify: `admin/src/views/UsersView.vue:275-290`（`toggleActive`）
- Test: `admin/src/__tests__/uxRound8Cases.test.ts`（加 describe）

**Interfaces:**
- Consumes：Task 7 的 `open=true`、`assignee=inactive`、`my_open_cases`、`inactive_assignee_open_cases`。
- Produces：網址 `/visit-requests?assignee=me&open=1`、`/visit-requests?assignee=inactive&open=1`；`DashboardSummary` 多 `my_open_cases?: number`、`inactive_assignee_open_cases?: number`。

- [ ] **Step 1: 寫失敗的測試**（加在 `uxRound8Cases.test.ts` 檔尾；檔頭補 import）

檔頭補：

```ts
import DashboardView from '../views/DashboardView.vue'
import UsersView from '../views/UsersView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import UserActions from '../components/UserActions.vue'
```

檔尾：

```ts
describe('我承辦的未結案', () => {
  it('列表 ?assignee=inactive&open=1：送 assignee=inactive 與 open=true，勾著「只看未結案」', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests', component: VisitRequestsView }, { path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/visit-requests?assignee=inactive&open=1'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    const list = get.mock.calls.map(([p]) => String(p)).find((p) => p.startsWith('/admin/visit-requests?') && p.includes('page='))!
    expect(list).toContain('assignee=inactive')
    expect(list).toContain('open=true')
    expect(router.currentRoute.value.query).toMatchObject({ assignee: 'inactive', open: '1' })
    expect(wrapper.text()).toContain('沒有承辦人已停用、還沒結案的案件')
  })

  async function mountDashboard(summary: Record<string, unknown>, rows: unknown[] = [], role: 'super_admin' | 'reception' = 'super_admin') {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
      const url = String(path)
      if (url === '/admin/dashboard') return { today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0, ...summary } as never
      if (url.startsWith('/admin/visit-requests?')) return rows as never
      return [] as never
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser(role)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper); await flushPromises()
    return { wrapper, get }
  }

  it('總覽：有我承辦的案件時列最多 5 筆＋查看全部；不算待辦', async () => {
    const { wrapper, get } = await mountDashboard({ my_open_cases: 7 }, [caseOf({ id: 'c1', parent_name: '周美玲' })])
    const section = wrapper.get('.dash__mine')
    expect(section.get('h2').text()).toBe('我承辦的案件')
    expect(section.text()).toContain('周美玲')
    expect(section.get('a.dash__mine-all').attributes('href')).toBe('/visit-requests?assignee=me&open=1&order=oldest')
    expect(section.get('a.dash__mine-all').text()).toContain('查看全部 7 件')
    expect(get.mock.calls.map(([p]) => String(p))).toContain('/admin/visit-requests?assignee=me&open=true&order=oldest&page_size=5')
    expect(wrapper.text()).toContain('目前沒有待處理事項')
  })

  it('總覽：承辦人已停用還沒結案的算待辦，連到篩好的列表', async () => {
    const { wrapper } = await mountDashboard({ inactive_assignee_open_cases: 2 })
    const task = wrapper.get('a.task[href="/visit-requests?assignee=inactive&open=1"]')
    expect(task.text()).toContain('承辦人已停用，案件還沒結案')
    expect(task.get('.task__number').text()).toBe('2')
  })

  it('停用帳號：對方還有未結案件時提示件數；查件數失敗時照樣只說已停用', async () => {
    const colleague = testUser('campus_admin', { id: 'u-wang', email: 'wang@ivy.example', display_name: '王老師', campus_keys: ['yihua'] })
    let countsFail = false
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      const url = String(path)
      if (url === '/admin/users') return [colleague] as never
      if (url.startsWith('/admin/visit-requests/group-counts')) {
        if (countsFail) throw new ApiError(500, {})
        return { pending: 0, upcoming: 2, past: 1, cancelled: 0 } as never
      }
      return [] as never
    })
    vi.spyOn(api, 'patch').mockResolvedValue({ ...colleague, is_active: false } as never)
    vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation((() => undefined) as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: UsersView }] })
    await router.push('/users'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()

    wrapper.findComponent(UserActions).vm.$emit('toggle', colleague)
    await flushPromises()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toBe('王老師還有 3 件沒結案的參觀案件：到「參觀案件」的承辦人篩選選「承辦人已停用」，重新指派給其他同事。')

    warning.mockClear()
    countsFail = true
    wrapper.findComponent(UserActions).vm.$emit('toggle', { ...colleague, is_active: true })
    await flushPromises()
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
```

> `UsersView` 若在桌機與手機各畫一份 `UserActions`，`findComponent` 拿第一個即可。

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run src/__tests__/uxRound8Cases.test.ts`
Expected：FAIL（`open=true` 沒送、`.dash__mine` 找不到、沒有停用提示）。

- [ ] **Step 3: `VisitRequestsView.vue`**

- `const assigneeFilter = ref('')` 上面的註解改「承辦人：''＝全部、me＝我承辦的、none＝尚未指派、inactive＝承辦人已停用。」，並在下面加：
  ```ts
  // 只看還沒結案的（待處理、待園方確認、預約正常），總覽「我承辦的案件」帶 ?open=1 進來。
  const openOnly = ref(false)
  ```
- `applyQuery`：`assigneeFilter.value = assignee === 'me' || assignee === 'none' ? assignee : ''` 改成 `assigneeFilter.value = ['me', 'none', 'inactive'].includes(assignee) ? assignee : ''`；下面加 `openOnly.value = query.open === '1'`。
- `stateQuery`：`if (assigneeFilter.value) query.assignee = assigneeFilter.value` 下面加 `if (openOnly.value) query.open = '1'`。
- `filterParams`：`if (assigneeFilter.value) params.set('assignee', assigneeFilter.value)` 下面加 `if (openOnly.value) params.set('open', 'true')`。
- `hasFilters` 的條件加 `|| openOnly.value`；`clearFilters()` 加 `openOnly.value = false`；`moreFilterCount` 的陣列加 `openOnly.value`；`watch([campusFilter, …])` 的陣列加 `openOnly`。
- `emptyText`：`if (assigneeFilter.value === 'me') …` 前面加
  ```ts
  if (assigneeFilter.value === 'inactive') return '沒有承辦人已停用、還沒結案的案件'
  ```
  並把 me 那行改成 `if (assigneeFilter.value === 'me') return openOnly.value ? '目前沒有你承辦、還沒結案的案件' : '目前沒有你承辦的案件'`。
- 模板承辦人選單加 `<el-option label="承辦人已停用" value="inactive" />`；勾選框區塊在「只看待人工處理」後面加 `<el-checkbox v-model="openOnly" class="filter-due">只看未結案</el-checkbox>`。

- [ ] **Step 4: `DashboardView.vue`**

- import 補 `formatShortSlotWhen, visitDisplay`（labels）與 `import type { VisitRequestDetailOut } from '../api/types'`。
- `DashboardSummary` 介面加：
  ```ts
  // 指派給我、還沒結案的件數（2026-10-03 第八輪，和列表 ?assignee=me&open=1 同一批）。
  my_open_cases?: number
  // 承辦人帳號已停用、還沒結案的件數；只有能重新指派的人（booking.manage）才有。
  inactive_assignee_open_cases?: number
  ```
- `summary` 宣告附近加：
  ```ts
  // 我承辦的案件：最多列 5 筆（最早送出的在前），其餘點「查看全部」。不算待辦。
  const MINE_LIMIT = 5
  const MINE_LIST_PATH = '/visit-requests?assignee=me&open=1&order=oldest'
  const mine = ref<VisitRequestDetailOut[]>([])
  const myOpenCases = computed(() => summary.value?.my_open_cases ?? 0)
  const inactiveAssigneeCases = computed(() => summary.value?.inactive_assignee_open_cases ?? 0)
  async function loadMine() {
    if (!(myOpenCases.value > 0 && can('booking.read'))) {
      mine.value = []
      return
    }
    try {
      mine.value = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?assignee=me&open=true&order=oldest&page_size=${MINE_LIMIT}`)
    } catch {
      // 讀不到名單時這一區不顯示；總覽其他部分照常。
      mine.value = []
    }
  }
  ```
- `load()` 裡 `void loadReviews()` 下面加 `void loadMine()`。
- `hasTodo` 的條件加 `|| inactiveAssigneeCases.value > 0`。
- 模板：`</section>`（今天的參觀）之後、`<div class="dash__workspace">` 之前加：
  ```html
      <section v-if="mine.length" class="dash__mine" aria-labelledby="mine-title">
        <div class="section__title">
          <h2 id="mine-title">我承辦的案件</h2>
          <router-link class="dash__mine-all" :to="MINE_LIST_PATH">查看全部 {{ myOpenCases }} 件 <span aria-hidden="true">→</span></router-link>
        </div>
        <ol class="panel today mine">
          <li v-for="row in mine" :key="row.id">
            <router-link :to="`/visit-requests/${row.id}`">
              <strong class="today__name">{{ row.parent_name }}</strong>
              <span class="today__campus">{{ visitDisplay(row).label }}<template v-if="row.slot"><span aria-hidden="true">・</span>{{ formatShortSlotWhen(row.slot) }}</template></span>
              <span class="today__go" aria-hidden="true">→</span>
            </router-link>
          </li>
        </ol>
      </section>
  ```
- 待辦清單：在「參觀時間過了，還沒標記到場」那個 `router-link` 後面加：
  ```html
            <router-link v-if="inactiveAssigneeCases > 0" class="task" to="/visit-requests?assignee=inactive&open=1" v-bind="taskAria('orphaned')">
              <span id="task-orphaned-n" class="task__number">{{ inactiveAssigneeCases }}</span>
              <div><h3 id="task-orphaned-t">承辦人已停用，案件還沒結案</h3><p id="task-orphaned-d">這些案件的承辦人帳號已經停用，沒有人會收到提醒。請點進去重新指派給其他同事。</p><span id="task-orphaned-a" class="task__action">查看要重新指派的案件 <span aria-hidden="true">→</span></span></div>
            </router-link>
  ```
- 樣式（`.dash__today` 那幾行旁邊）：
  ```css
  .dash__mine { margin-bottom: 28px; }
  .dash__mine-all { font-size: 13px; text-decoration: underline; }
  .mine a { grid-template-columns: minmax(0, 1fr) auto auto; }
  ```

- [ ] **Step 5: `UsersView.vue` 的 `toggleActive`**

`ElMessage.success(…)` 那行下面加：

```ts
    if (!updated.is_active) void warnOpenCases(updated)
```

函式下面加：

```ts
// 停用不會自動改指派（2026-10-03 第八輪 D10）：對方還有沒結案的案件就提醒件數，請人到
// 列表用「承辦人已停用」篩出來重新指派。查不到件數時不另外跳錯，停用本身已經成功。
async function warnOpenCases(target: UserOut) {
  try {
    const counts = await api.get<Record<string, number>>(`/admin/visit-requests/group-counts?assignee=${target.id}&open=true`)
    const total = Object.values(counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
    if (total > 0) {
      notifyWarning(`${staffLabel(target)}還有 ${total} 件沒結案的參觀案件：到「參觀案件」的承辦人篩選選「承辦人已停用」，重新指派給其他同事。`)
    }
  } catch {
    /* 停用已成功；件數查不到就不提醒 */
  }
}
```

（`staffLabel` 從 `../api/labels` import；`notifyWarning` 已 import 就不用重複。）

- [ ] **Step 6: 跑測試確認通過**

Run：`npx vitest run src/__tests__/uxRound8Cases.test.ts src/__tests__/shellDashboard20261002.test.ts src/__tests__/listUx.test.ts src/__tests__/usersUx.test.ts src/__tests__/visitGroups.test.ts src/__tests__/crossUx20261002.test.ts`
Expected：全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add admin/src/views/VisitRequestsView.vue admin/src/views/DashboardView.vue admin/src/views/UsersView.vue admin/src/__tests__/uxRound8Cases.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 總覽列我承辦的案件與承辦人已停用的待辦，停用帳號時提醒重新指派

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 後端：`/auth/me` 帶登入上限時間

**Files:**
- Modify: `backend/app/auth/service.py:24` 附近（加 `session_max_expiry`）
- Modify: `backend/app/auth/schemas.py:83-86`（`MeResponse`）
- Modify: `backend/app/auth/routes.py:199-210`（`me`）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Test: `backend/tests/test_auth_session_limit.py`

**Interfaces:**
- Produces：`service.session_max_expiry(session: Session) -> datetime`；`MeResponse.session_max_expires_at: datetime | None`（登入滿 12 小時的時間，不含閒置逾時）。

- [ ] **Step 1: 寫失敗的測試** `backend/tests/test_auth_session_limit.py`

```python
"""/auth/me 帶登入上限時間（2026-10-03 第八輪：到期前提醒先儲存）。"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.auth import service
from app.auth.models import Session


@pytest.mark.asyncio
async def test_me_reports_twelve_hour_limit(admin_client, db_session):
    response = await admin_client.get("/api/website/v1/auth/me")
    assert response.status_code == 200
    session = (await db_session.execute(select(Session).where(Session.revoked_at.is_(None)))).scalars().one()
    reported = datetime.fromisoformat(response.json()["session_max_expires_at"].replace("Z", "+00:00"))
    assert reported == session.created_at + service.SESSION_TTL
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_auth_session_limit.py`
Expected：FAIL，`KeyError: 'session_max_expires_at'`。

- [ ] **Step 3: 改三個檔**

`auth/service.py`，`SESSION_TTL` 定義下面：

```python
def session_max_expiry(session: Session) -> datetime:
    """登入滿 12 小時的時間：閒置延長推不過這個上限（_sliding_expiry）。"""
    return session.created_at + SESSION_TTL
```

`auth/schemas.py` 的 `MeResponse`：

```python
class MeResponse(BaseModel):
    csrf_token: str
    user: "UserOut"
    features: FeatureFlags
    # 這次登入最晚到什麼時候（登入滿 12 小時，不含閒置逾時）；後台剩 15 分鐘時提醒先儲存。
    session_max_expires_at: datetime | None = None
```

（檔頭沒有 `from datetime import datetime` 就補上。）

`auth/routes.py` 的 `me()`：

```python
    return MeResponse(
        csrf_token=session.csrf_token,
        user=_user_out(current_user),
        features=_features(settings),
        session_max_expires_at=service.session_max_expiry(session),
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run：`WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test uv run --frozen pytest -q tests/test_auth_session_limit.py tests/test_secfix_auth.py tests/test_session_schedule.py tests/test_auth_scope.py`
Expected：全部 PASS。

- [ ] **Step 5: 重產契約並 Commit**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate
git add backend/app/auth/service.py backend/app/auth/schemas.py backend/app/auth/routes.py backend/tests/test_auth_session_limit.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "$(cat <<'EOF'
feat(auth): /auth/me 回這次登入的 12 小時上限時間

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 前端：逾時對話框一鍵開新分頁＋自動接續、到期前提醒

**Files:**
- Create: `admin/src/composables/sessionChannel.ts`
- Modify: `admin/src/stores/auth.ts`（`sessionMaxExpiresAt`、廣播）
- Modify: `admin/src/router/unauthorized.ts:73-95`（`recoverInPlace`）
- Create: `admin/src/components/SessionLimitNotice.vue`
- Modify: `admin/src/layouts/AdminLayout.vue:134`（放提醒）
- Modify: `admin/src/__tests__/sessionExpiry.test.ts:157-180`（訊息改成 VNode 後的取字方式）
- Test: `admin/src/__tests__/uxRound8Session.test.ts`

**Interfaces:**
- Consumes：Task 9 的 `MeResponse.session_max_expires_at`。
- Produces：
  - `sessionChannel.ts`：`announceSignedIn(): void`、`waitForSignIn(): { promise: Promise<void>; cancel: () => void }`、`setSessionChannelFactory(factory: (() => SessionChannelLike | null) | null): void`、`export interface SessionChannelLike { postMessage(message: unknown): void; close(): void; onmessage: ((event: { data: unknown }) => void) | null }`
  - auth store 多 `sessionMaxExpiresAt: Ref<string | null>`

- [ ] **Step 1: 寫失敗的測試** `admin/src/__tests__/uxRound8Session.test.ts`

```ts
// 2026-10-03 第八輪：登入逾時時未儲存的修改（稽核 09-28）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, type VNode } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError, setUnauthorizedHandler } from '../api/client'
import { redirectToLoginOnUnauthorized } from '../router/unauthorized'
import { registerUnsavedChanges } from '../composables/useUnsavedChanges'
import { announceSignedIn, setSessionChannelFactory, type SessionChannelLike } from '../composables/sessionChannel'
import SessionLimitNotice from '../components/SessionLimitNotice.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  setSessionChannelFactory(null)
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

// 同一個測試程序裡的假頻道：一個分頁 postMessage，其他頻道物件收到（自己收不到，跟 BroadcastChannel 一樣）。
function fakeBus() {
  const channels = new Set<SessionChannelLike>()
  setSessionChannelFactory(() => {
    const channel: SessionChannelLike = {
      onmessage: null,
      postMessage(message) { for (const other of channels) if (other !== channel) other.onmessage?.({ data: message }) },
      close() { channels.delete(channel) },
    }
    channels.add(channel)
    return channel
  })
}

const textOf = (message: unknown) => (typeof message === 'string' ? message : mount(defineComponent({ render: () => message as VNode })).text())

async function dirtyEditorAt(path: string) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = testUser('editor', { id: 'u1', email: 'editor@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: defineComponent({ template: '<div />' }) },
    { path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) },
  ] })
  await router.push(path); await router.isReady()
  setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
  cleanups.push(registerUnsavedChanges(ref(true)))
  return { auth, router }
}

describe('登入已逾時：一鍵開新分頁、別的分頁登入就自動接續', () => {
  it('對話框有「在新分頁打開登入頁」連結；別的分頁登入同一個帳號後自動接續，提醒再按一次儲存', async () => {
    fakeBus()
    const { auth, router } = await dirtyEditorAt('/content/news')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    const close = vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'new-token', user: auth.user, features: { admissions: false } }), { status: 200 }) as never)

    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()
    const message = textOf(confirm.mock.calls[0]![0])
    expect(message).toContain('修改還沒儲存')
    expect(message).toContain('在新分頁打開登入頁')

    announceSignedIn()
    await flushPromises()
    expect(close).toHaveBeenCalled()
    expect(auth.csrfToken).toBe('new-token')
    expect(success).toHaveBeenCalledWith('已恢復登入，請再按一次儲存。')
    expect(router.currentRoute.value.fullPath).toBe('/content/news')
  })

  it('新分頁登入的是別的帳號：不接續，提醒用原本的帳號登入', async () => {
    fakeBus()
    const { auth } = await dirtyEditorAt('/content/news')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const other = testUser('editor', { id: 'u2', email: 'other@example.invalid' })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'other-token', user: other, features: { admissions: false } }), { status: 200 }) as never)

    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()
    announceSignedIn()
    await flushPromises()
    expect(success).not.toHaveBeenCalled()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('登入的是另一個帳號')
    // 對話框重新出現，等原本的帳號登入；別人的 CSRF token 不留在這一頁，什麼都存不出去。
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(auth.user?.id).toBe('u1')
    expect(auth.csrfToken).toBeNull()
  })
})

describe('登入滿 12 小時前提醒', () => {
  function mountNotice(expiresInMinutes: number) {
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = testUser('editor')
    auth.sessionMaxExpiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
    return mount(SessionLimitNotice, { global: { plugins: [pinia, ElementPlus] } })
  }

  it('剩 15 分鐘內才出現，寫幾點到期、請先儲存', () => {
    const soon = mountNotice(10)
    expect(soon.text()).toContain('登入會在')
    expect(soon.text()).toContain('到期（每次登入最長 12 小時）')
    expect(soon.text()).toContain('還沒儲存的修改請先儲存')
    expect(mountNotice(30).find('.session-limit').exists()).toBe(false)
    expect(mountNotice(-1).find('.session-limit').exists()).toBe(false)
  })

  it('/auth/me 回的上限時間記進 store', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 't', user: testUser('editor'), features: { admissions: false }, session_max_expires_at: '2026-10-03T12:00:00Z' } as never)
    expect(await auth.refreshSession()).toBe(true)
    expect(auth.sessionMaxExpiresAt).toBe('2026-10-03T12:00:00Z')
    auth.clearSession()
    expect(auth.sessionMaxExpiresAt).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run src/__tests__/uxRound8Session.test.ts`
Expected：FAIL，`Failed to resolve import "../composables/sessionChannel"`。

- [ ] **Step 3: 寫 `composables/sessionChannel.ts`**

```ts
// 同一個瀏覽器的分頁之間說「有人登入了」（2026-10-03 第八輪）。用途：這一頁登入
// 逾時又有沒儲存的修改時（router/unauthorized.ts），使用者在新分頁重新登入後，這一頁
// 自動接續，不用回來按「我已重新登入」。只傳 { type: 'signed-in' }，不帶任何登入資料；
// 收到的分頁自己打 /auth/me 取新的 CSRF token。沒有 BroadcastChannel 的瀏覽器就沒有
// 自動接續，照舊按按鈕。

const CHANNEL_NAME = 'ivy-admin-session'

export interface SessionChannelLike {
  postMessage(message: unknown): void
  close(): void
  onmessage: ((event: { data: unknown }) => void) | null
}

type ChannelFactory = () => SessionChannelLike | null

const defaultFactory: ChannelFactory = () =>
  typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(CHANNEL_NAME) as unknown as SessionChannelLike)

let factory: ChannelFactory = defaultFactory
let announcer: SessionChannelLike | null = null

/** 測試用：換成假的頻道；傳 null 還原。 */
export function setSessionChannelFactory(next: ChannelFactory | null): void {
  factory = next ?? defaultFactory
  announcer?.close()
  announcer = null
}

/** 登入成功（密碼登入、或 Google／LINE 登入後回到後台）時通知其他分頁。 */
export function announceSignedIn(): void {
  announcer ??= factory()
  announcer?.postMessage({ type: 'signed-in' })
}

/** 等別的分頁登入。不再等的時候呼叫 cancel 關掉頻道。 */
export function waitForSignIn(): { promise: Promise<void>; cancel: () => void } {
  const channel = factory()
  const promise = new Promise<void>((resolve) => {
    if (!channel) return
    channel.onmessage = (event) => {
      if ((event.data as { type?: string } | null)?.type === 'signed-in') resolve()
    }
  })
  return {
    promise,
    cancel: () => {
      if (!channel) return
      channel.onmessage = null
      channel.close()
    },
  }
}
```

- [ ] **Step 4: `stores/auth.ts`**

import 加 `import { announceSignedIn } from '../composables/sessionChannel'`。`const isLoading = ref(false)` 下面加：

```ts
  // 這次登入最晚到什麼時候（登入滿 12 小時；/auth/me 的 session_max_expires_at）。
  // 密碼登入的回應沒有這個值，之後第一次 /auth/me（閒置延長最多 10 分鐘一次）才補上。
  const sessionMaxExpiresAt = ref<string | null>(null)
```

- `login()`：`setCsrfToken(result.csrf_token)` 下面加 `announceSignedIn()`。
- `clearSession()`：加 `sessionMaxExpiresAt.value = null`。
- `restoreSession()` 成功分支：`setCsrfToken(result.csrf_token)` 下面加 `sessionMaxExpiresAt.value = result.session_max_expires_at ?? null` 與 `announceSignedIn()`（Google／LINE 登入回到後台走這裡）；失敗分支加 `sessionMaxExpiresAt.value = null`。
- `refreshSession()` 成功分支：`setCsrfToken(result.csrf_token)` 下面加 `sessionMaxExpiresAt.value = result.session_max_expires_at ?? null`（不廣播）。
- return 物件加 `sessionMaxExpiresAt`。

- [ ] **Step 5: `router/unauthorized.ts` 的 `recoverInPlace`**

import 加 `import { h } from 'vue'`、`import { setCsrfToken } from '../api/client'`、`import { waitForSignIn } from '../composables/sessionChannel'`（其餘照舊）。`recoverInPlace` 整個換成：

```ts
async function recoverInPlace(router: Router): Promise<void> {
  if (recovering) return
  recovering = true
  const authStore = useAuthStore()
  // 逾時前登入的是誰：別的分頁登入的若不是同一人，不能接續（修改會用別人的名義存）。
  const expectedUserId = authStore.user?.id ?? null
  let signIn = waitForSignIn()
  try {
    for (;;) {
      const loginHref = router.resolve({ name: 'login', query: { reason: 'expired' } }).href
      const dialog = ElMessageBox.confirm(
        h('div', null, [
          h('p', null, '登入已逾時，這一頁的修改還沒儲存。請在新分頁重新登入：登入後這裡會自動接續，再按一次儲存。'),
          h('p', null, [h('a', { href: loginHref, target: '_blank', rel: 'noopener' }, '在新分頁打開登入頁 ↗')]),
        ]),
        '登入已逾時',
        {
          confirmButtonText: '我已重新登入',
          cancelButtonText: '放棄修改並重新登入',
          type: 'warning',
          showClose: false,
          closeOnClickModal: false,
          closeOnPressEscape: false,
        },
      ).then(() => 'confirm' as const, () => 'cancel' as const)
      // 使用者按按鈕，或別的分頁登入成功（sessionChannel），哪個先到就照哪個走。
      const outcome = await Promise.race([dialog, signIn.promise.then(() => 'signed-in' as const)])
      if (outcome === 'cancel') {
        const route = loginRoute(router)
        authStore.clearSession()
        await leaveWithoutAsking(() => router.replace(route))
        return
      }
      if (outcome === 'signed-in') {
        // 對話框還開著：關掉它（之後它的 promise 結果已經沒人等，不影響）。
        ElMessageBox.close()
        signIn.cancel()
        signIn = waitForSignIn()
      }
      const previousUser = authStore.user
      if (await authStore.refreshSession()) {
        if (expectedUserId && authStore.user?.id !== expectedUserId) {
          // 這個瀏覽器現在登入的是別人：先把畫面上的登入者換回原本的人，繼續等。
          // 對方的 session 已經存在 cookie 裡，按儲存會被當成對方，所以不接續；
          // 也清掉剛拿到的對方 CSRF token，這一頁什麼都送不出去，直到原本的人登入。
          authStore.user = previousUser
          authStore.csrfToken = null
          setCsrfToken(null)
          notifyWarning('新分頁登入的是另一個帳號。這一頁的修改要用原本的帳號儲存，請先登出那個帳號，再用原本的帳號登入。')
          continue
        }
        ElMessage.success('已恢復登入，請再按一次儲存。')
        return
      }
      notifyWarning('還沒有重新登入：請先在新分頁登入後台，再回來按「我已重新登入」。')
    }
  } finally {
    signIn.cancel()
    recovering = false
  }
}
```

檔頭的說明註解（`recoverInPlace` 上方那段）補一句：「別的分頁登入成功時（composables/sessionChannel.ts）自動接續；登入的不是同一個帳號就不接續。」

- [ ] **Step 6: 寫 `components/SessionLimitNotice.vue`**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

// 登入滿 12 小時的硬上限（後端 SESSION_TTL）：閒置延長推不過去。剩 15 分鐘時在頁首
// 下方提醒先儲存（2026-10-03 第八輪 D12）。不提供「延長登入」：重新登入會撤銷這個
// session，要另做後端流程。到期之後由 router/unauthorized.ts 的「登入已逾時」接手。
const WARN_BEFORE_MS = 15 * 60 * 1000
const auth = useAuthStore()
const now = ref(Date.now())
const timer = window.setInterval(() => { now.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(timer))

const expiresAt = computed(() => (auth.sessionMaxExpiresAt ? Date.parse(auth.sessionMaxExpiresAt) : Number.NaN))
const shown = computed(() => {
  if (!auth.user || Number.isNaN(expiresAt.value)) return false
  const left = expiresAt.value - now.value
  return left > 0 && left <= WARN_BEFORE_MS
})
const clock = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' })
const until = computed(() => (Number.isNaN(expiresAt.value) ? '' : clock.format(new Date(expiresAt.value))))
</script>

<template>
  <el-alert
    v-if="shown"
    class="session-limit"
    type="warning"
    :closable="false"
    show-icon
    role="status"
    :title="`登入會在 ${until} 到期（每次登入最長 12 小時）`"
  >
    <p>還沒儲存的修改請先儲存。到期後要重新登入；這一頁的修改會留在畫面上，重新登入後再按一次儲存。</p>
  </el-alert>
</template>

<style scoped>
.session-limit { margin-bottom: 16px; }
.session-limit p { margin: 4px 0 0; }
</style>
```

- [ ] **Step 7: `AdminLayout.vue` 放提醒**

import 加 `import SessionLimitNotice from '../components/SessionLimitNotice.vue'`；

```html
      <main id="main" ref="main" class="main" tabindex="-1"><router-view /></main>
```
改成
```html
      <main id="main" ref="main" class="main" tabindex="-1"><SessionLimitNotice /><router-view /></main>
```

- [ ] **Step 8: 既有測試跟著改**

`admin/src/__tests__/sessionExpiry.test.ts` 第 176 行附近：

```ts
    expect(String(confirm.mock.calls[0]![0])).toContain('修改還沒儲存')
```
改成
```ts
    const message = confirm.mock.calls[0]![0]
    expect(typeof message === 'string' ? message : mount(defineComponent({ render: () => message as never })).text()).toContain('修改還沒儲存')
```

- [ ] **Step 9: 跑測試確認通過**

Run：`npx vitest run src/__tests__/uxRound8Session.test.ts src/__tests__/sessionExpiry.test.ts src/__tests__/sessions.test.ts src/__tests__/logout.test.ts src/__tests__/loginUx.test.ts src/__tests__/shellDashboard20261002.test.ts`
Expected：全部 PASS。

- [ ] **Step 10: Commit**

```bash
git add admin/src/composables/sessionChannel.ts admin/src/stores/auth.ts admin/src/router/unauthorized.ts admin/src/components/SessionLimitNotice.vue admin/src/layouts/AdminLayout.vue admin/src/__tests__/uxRound8Session.test.ts admin/src/__tests__/sessionExpiry.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 登入逾時可一鍵開新分頁登入並自動接續，登入滿 12 小時前提醒先儲存

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 文件

**Files:**
- Modify: `README.md`（頂部加日期段落）
- Modify: `DESIGN.md`（「官網後台第七輪 UX」段落之前加新段落）
- Modify: `docs/website-admin/acceptance.md`（檔尾加一節）
- Modify: `docs/analysis/2026-09-28-admin-uiux-audit.md`（「還沒處理、需要決定的」表格後補一段處理結果）

- [ ] **Step 1: README 頂部**（第 1 行前，日期用實際完成日）

```markdown
## 2026-10-0X 官網後台第八輪 UX（`feature/admin-ux8-20261003`，未部署）

09-28 稽核「還沒處理、需要決定的」表格裡使用者選的六項。錯誤定位（哪一則哪一欄）10-02 第七輪已做，這輪不動。規則見 DESIGN.md 同名段落。

- **長編輯頁段落目錄**：首頁消息、各校消息、入學資訊、孩子的一天、隱私權政策。1280 以上在表單右側黏住，較窄時是表單上方一排膠囊。
- **選圖統一**：`MediaFieldCard` 外觀＋`MediaSlotField`／新的 `MediaRefField`。消息封面、內文圖片、分享圖、校園探索都改用；消息封面多了「移除照片」。素材不是 ready 時標「處理中」「失敗」（給背景轉檔用）。
- **兩人同時處理同一案**：頁首「最後處理：誰・何時・做了什麼」；狀態轉換被擋時重讀並寫出現在的狀態；切回分頁超過 30 秒自動更新、同事剛改過就提示。後端錯誤訊息改寫中文狀態名。
- **我承辦的案件**：總覽列最多 5 筆＋查看全部（不算待辦）；承辦人帳號已停用、還沒結案的算待辦（校區管理者以上）。列表加「只看未結案」與承辦人「承辦人已停用」。停用帳號時若對方還有未結案件，提醒件數。
- **登入逾時**：對話框有「在新分頁打開登入頁」；新分頁登入同一個帳號後這頁自動接續（仍要再按一次儲存），登入的是別的帳號就不接續。登入滿 12 小時前 15 分鐘提醒先儲存。

**後端與契約**：`InvalidTransition` 訊息中文化；案件清單、分組計數、匯出加 `open=true`、`assignee=inactive`；`/admin/dashboard` 加 `my_open_cases`、`inactive_assignee_open_cases`；`/auth/me` 加 `session_max_expires_at`。沒有 migration。已跑 `npm run contract:check`。

**驗證**：（填 Task 12 實際跑的指令與結果）

**未驗證**：（填）
```

- [ ] **Step 2: DESIGN.md 新段落**（放在 `## 官網後台第七輪 UX（2026-10-02…` 之前）

```markdown
## 官網後台第八輪 UX（2026-10-0X，`feature/admin-ux8-20261003`）

09-28 稽核殘項，使用者 2026-10-03 選做。以下是之後要照著做的：

- **長編輯頁要有段落目錄**：頁面把段落傳給 `ContentEditor` 的 `sections`（`composables/editorSections.ts`），標題元素放 `id`、`data-section-anchor`、`tabindex="-1"`。至少兩段才顯示；1280 以上在表單右側黏住（表單維持 720 寬），較窄時在表單上方一排可橫捲的膠囊。新增長頁面時一併接上。
- **選照片／影片一律用共用欄位**：存 `{media_id, focus}` 的版位用 `MediaSlotField`，存素材 id 字串的用 `MediaRefField`，外觀都是 `MediaFieldCard`（縮圖、「目前用…」或檔名、兩顆按鈕：從素材庫選／更換、清除）。頁面不直接開 `MediaPickerDialog`（`mediaField.test.ts` 守門）。素材不是 ready 時欄位標「處理中」「失敗」。
- **案件頁首寫「最後處理」**：同事最近一次動這筆案件（歷程 source=staff），自己做的寫「你」。狀態轉換被擋（`INVALID_TRANSITION`）時重讀：狀態變了就寫「剛被處理過：誰在何時做了什麼，現在是「…」」，沒變就照後端原因。案件明細切回分頁超過 30 秒靜默重讀，不動聯絡紀錄草稿。不做「誰正在看」的線上狀態。
- **未結案**＝待處理、聯絡中、待園方確認、預約正常（含時間已過還沒標記到場），後端 `status_groups.open_condition()` 一處定義。總覽「我承辦的案件」不算待辦；「承辦人已停用、還沒結案」算待辦，只給校區管理者以上。停用帳號不自動改指派，只提醒件數。
- **登入逾時不做本機暫存**（規格 L202）。「登入已逾時」對話框給新分頁登入連結，別的分頁登入同一個帳號就自動接續，仍要本人再按一次儲存；不是同一個帳號不接續。登入滿 12 小時前 15 分鐘提醒先儲存，不提供延長登入。
```

- [ ] **Step 3: acceptance.md 檔尾**

```markdown
## 後台第八輪 UX（2026-10-0X 實作，尚未部署）

| 項目 | 狀態 | 驗證 |
|---|---|---|
| 長編輯頁段落目錄（5 頁） | 通過 | `uxRound8Nav.test.ts`；Playwright 1440／1280／390 無橫捲 |
| 選圖統一（MediaFieldCard／MediaRefField，4 處改用） | 通過 | `mediaField.test.ts`、`mediaSlots.test.ts`、`ux20260928E.test.ts` |
| 存檔錯誤定位到哪一則哪一欄 | 已於 10-02 第七輪完成 | `ContentEditor.vue:415-420,589-599` |
| 兩人同時處理（最後處理、衝突重讀、切回更新、中文訊息） | 通過 | `uxRound8Cases.test.ts`、`test_visit_workflow.py` |
| 我承辦的未結案、承辦人已停用 | 通過 | `uxRound8Cases.test.ts`、`test_dashboard_my_cases.py` |
| 登入逾時接續、12 小時前提醒 | 通過 | `uxRound8Session.test.ts`、`sessionExpiry.test.ts`、`test_auth_session_limit.py` |

未驗證：Safari／iOS 實機；正式站（未部署）。BroadcastChannel 在 LINE 內建瀏覽器是否可用未查（沒有時退回手動按「我已重新登入」）。
```

- [ ] **Step 4: 稽核報告補處理結果**（`2026-09-28-admin-uiux-audit.md` 的「2026-09-29 業主裁定與處理」段落之後）

```markdown
## 2026-10-0X 第八輪處理（使用者 2026-10-03 選做六項）

- 超長編輯頁：補段落目錄（收合與錯誤展開 10-02 已做）。
- 四種選圖元件：統一成 MediaFieldCard＋MediaSlotField／MediaRefField。
- 存檔錯誤指出哪一則哪一欄：10-02 第七輪已完成。
- 兩位櫃台同時處理：最後處理、狀態衝突重讀、切回分頁更新、後端訊息中文化；不做線上狀態。
- 「我承辦的未結案」：總覽一區＋停用承辦人待辦＋停用提醒；不自動改指派。
- 登入逾時：新分頁登入連結、自動接續（同帳號才接續）、12 小時前提醒；不做本機暫存。
- 範圍外（仍未做）：側欄「站內通知」「發布紀錄」數字（09-29 已裁定拿掉）、LINE 內建瀏覽器 Google 登入、送審前先檢查能否發布、審核者改字通知送審者。
```

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md docs/analysis/2026-09-28-admin-uiux-audit.md
git commit -m "$(cat <<'EOF'
docs(admin): 記錄後台第八輪 UX 的規則、驗收與稽核處理結果

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 驗證閘門

> 全套測試由**主 session 用 `run_in_background` 跑**，subagent 不跑全套（watchdog 10 分鐘會中止）。同一時間只跑一組（機器 8GB）；別的 session 正在跑測試時先等。

**Files:** 無（只驗證；發現問題回到對應 Task 修）

- [ ] **Step 1: 確認沒有 migration、只有一個 head、分支跟上 main**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo "已包含 main" || echo "要先合 main"
cd backend; uv run --frozen alembic heads
git diff origin/main --stat -- backend/alembic
```
Expected：`alembic heads` 一行；`backend/alembic` 沒有差異。不包含 main 就 `git merge origin/main`（不 rebase），衝突處理後重跑 `npm run contract:generate`。

- [ ] **Step 2: admin typecheck 與全套 vitest（背景）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run typecheck; npm --prefix admin run test:unit
```
Expected：typecheck 0 error；vitest 全過。負載高時若有幾項 5 秒逾時，單獨重跑那幾個檔確認。

- [ ] **Step 3: 後端全套 pytest（背景、另一個時段）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_ux8_test PYTHONUNBUFFERED=1 uv run --frozen pytest -q -o faulthandler_timeout=240
```
Expected：全過。已知假失敗：台北時間週五 `test_booking_consent_readiness` 的場次同步（main 既有，與本計畫無關）。

- [ ] **Step 4: 契約與 web**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:check; npm --prefix web run typecheck; npm run test:website
```
Expected：`契約型別與 openapi.json 一致`；web typecheck 與單元測試全過（web 沒改，確認契約變動沒影響）。

- [ ] **Step 5: stack e2e（自訂庫與埠）**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin-ux8-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_ux8_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run test:e2e:stack
```
Expected：全過。`tests/stack/media.spec.ts` 間歇失敗是 main 既有問題：單獨重跑 `-- media` 確認。後台截圖基準若因目錄或選圖欄位改版而不同，確認畫面正確後才 `-u`，並在 README 寫明更新了哪些基準。

- [ ] **Step 6: 畫面檢查（Playwright，本機 dev server）**

依 `docs/website-admin/README.md` 起 backend（測試庫）、admin vite。用臨時腳本（`output/playwright/*.cjs` 範例，`chromium.launch({channel:'chrome'})`）在 1440×900、1280×800、390×844 檢查：
- 首頁消息、隱私權政策：目錄位置、點了捲到標題；`document.documentElement.scrollWidth <= innerWidth`。
- 消息封面、分享圖、校園探索的選圖欄位外觀一致；手機按鈕 44px。
- 案件明細頁首「最後處理」；總覽「我承辦的案件」。
- 截圖放 `output/ux8/`（gitignore），結果寫進 README「驗證」。

- [ ] **Step 7: 回報**

只給結論、`檔案:行號`、實際跑過的指令與結果、未驗證項。**不 push、不部署**：合併上線由使用者決定（push main＝正式部署，`.github/workflows/website.yml`）。合併前若別的計畫（重設密碼、背景轉檔）已先合，處理 `UsersView.vue`、`backend/app/auth/*`、`MediaSlotField.vue`、`contracts/*` 的衝突並重跑 Step 2–5。

---

## 範圍外

稽核表格其他項目（側欄數字、LINE 內建瀏覽器 Google 登入、送審前先檢查能否發布、審核者改字通知送審者、表單對話框按鈕字全面統一、全站設定頁名）不在本計畫；側欄數字與頁名已在 09-29 裁定處理。

## 需要使用者決定（不擋開工，預設照「設計決定」做）

1. 「我承辦的案件」放總覽是否也要給**沒有承辦權限的唯讀角色**看自己的件數？預設不給（`can('booking.read')` 才顯示名單）。
2. 停用帳號時要不要**改成自動清掉承辦人**？預設不要（D10）。
3. 12 小時前提醒的門檻 15 分鐘是否合適？預設 15 分鐘。
