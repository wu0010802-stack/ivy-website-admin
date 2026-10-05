# 預約明細當家庭頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已到場、有招生訪視的家庭，在 `/visit-requests/:id` 一頁看完並處理從預約到註冊的所有事；招生入學點有預約的家庭會開這一頁。

**Architecture:** 只改後台畫面，後端只在看板卡片與待追蹤列多回 `visit_request_id`。預約明細的招生部分抽成 `useFamilyAdmissions` composable（查招生訪視、補建、讀事件／參觀後聯絡／負責人／選項）。合併與判斷邏輯放純函式 `admissions/family.ts`。畫面拆成三個元件：`FamilyAdmissionsData`、`FamilyContactNotes`、`FamilyActions`，另外擴充 `VisitHistoryTimeline`。`VisitDetailView` 只負責組裝。招生三個入口共用 `visitRequestPath()` 決定開頁面或開抽屜。

**Tech Stack:** Vue 3 + TypeScript + Element Plus + Vue Router（admin）、Vitest + @vue/test-utils、FastAPI 0.136.1（釘版）+ Pydantic + SQLAlchemy async、pytest（asyncio_mode=auto）、Playwright stack e2e。

**Spec:** `docs/specs/2026-10-05-visit-family-page-design.md`（同一個 worktree）。Mock-up：`~/Desktop/ivy-website-admin/design/visit-family-page-mockup-20261005/`。

## Global Constraints

- 介面文字一律繁體中文（台灣用語）；不寫操作說明、製作過程或「載入中」這類開發輔助用字，只留內容、按鈕、必要回饋。
- 字級只能用 `admin/src/style.css` 的 `--text-xs`…`--text-5xl` token，不寫 `font-size: Npx`（`ux20261005.test.ts` 守門）。
- 不寫 2px 以上的彩色左右邊框或 inset 側條；`transition` 不動 width／height／max-height（同上守門）。
- 錯誤與警告一律用 `notifyError`／`notifyWarning`（`composables/notify.ts`），不直接呼叫 `ElMessage.error`／`ElMessage.warning`（`crossUx20261002.test.ts`）；`ElMessage.success` 可以用。
- 每個 `<el-switch>` 都要有 `aria-label`（`a11yStructure.test.ts`）。
- 不新增 npm／Python 套件；FastAPI 維持 0.136.1。
- 不新增 migration、不改資料表、不改轉移契約 `contracts/ivy-recruitment`、不改轉換規則與權限表。
- 招生開關關閉、沒有 `admissions.read`、已到場但沒有招生訪視，三種情況的畫面必須與改版前相同。
- 沒有預約（手動新增）的招生訪視、沒有 `booking.read` 的帳號，點卡片時照舊開「參觀→入學 歷程」抽屜；抽屜本身的行為不變。
- Node 22：指令前先 `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null;`（`source` 會回傳 3，所以用分號串，不用 `&&`）。
- 後端測試庫用 `ivy_website_familypage_test`（名稱含 test），不連開發庫或正式庫。
- 機器只有 8GB RAM：同時只跑一組測試；後端全套 pytest 與 stack e2e 由主 session 執行（subagent 超過 10 分鐘沒有輸出會被中止）。
- commit 只做在本機分支 `feature/visit-family-page-20261005`，Conventional Commit、繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**不 push、不合 main**（push main＝正式部署，由使用者執行）。
- 計畫中的行號以 `e0819f3a` 為準。rebase 之後行號會位移，一律用計畫給的搜尋字串定位。

## Review Focus

1. **打到一半的參觀前聯絡草稿遇上家庭版面**：家庭版面看不到文字框，但草稿還在 `newNote`。離開頁面時不能跳出「放棄修改」詢問，問的是使用者看不到的東西。（Task 7 測試）
2. **快速按「下一筆」**：從家庭案件切到另一筆時，前一筆較晚回來的事件或聯絡紀錄不能出現在新案件上。（Task 7 測試）
3. **招生訪視已匿名化**：家庭版面要唯讀（沒有編輯、記錄聯絡、移到…、負責人下拉），撥號鈕不撥匿名化後的假電話。（Task 4、6、7 測試）
4. **沒有 `booking.read`、只有招生權限的帳號點有預約的卡片**：開抽屜，不是跳到 404 的預約頁。（Task 8 測試）
5. **改負責人時別人剛改過（409）**：提示並重讀，不蓋掉別人的修改。（Task 6 測試）

---

## 開工前置（不 commit）

這一段由主 session 執行，完成後才開始 Task 1。

- [x] **P1／P2：分支基準（2026-10-05 實際做法）**

使用者要求計畫寫完直接實作，不等「紙本補欄位」上線。`8b0efde2`（拿掉待處理）已在 main；`feature/admissions-paper-fields-20261005`（`5c6c1424`，migration `3fe1cfb2dbf7` 已改接 `1e5612e187ff`）只在本機。所以本分支 `git reset --keep 5c6c1424` 後合併 `origin/main`（`4f9de0b6`），得到 `e7f60008`（README 衝突兩段都留）。`alembic heads` 只有 `3fe1cfb2dbf7`。

**合併前提醒**：本分支含紙本補欄位的提交，要等它先進 main（或一起進），進 main 前再 rebase 或 merge 一次 origin/main。

- [ ] **P3：裝依賴、建測試庫**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm ci; npm --prefix admin ci; npm --prefix web ci
cd backend && uv sync && cd ..
createdb ivy_website_familypage_test 2>/dev/null; true
```

- [ ] **P4：基準全綠**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run typecheck; npm --prefix admin run test:unit
npm run contract:check
```

預期：typecheck 0 錯誤、vitest 全過、contract 一致。任何一項紅燈就先回報，不要開工。

- [ ] **P5：提交規格與計畫**

```bash
git add docs/specs/2026-10-05-visit-family-page-design.md docs/superpowers/plans/2026-10-05-visit-family-page.md
git commit -m "docs(admin): 預約明細當家庭頁的規格與實作計畫

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1：後端：看板卡片與待追蹤列帶 `visit_request_id`

**Files:**
- Modify: `backend/app/admissions/schemas.py`（`class FunnelCardOut`、`class FollowUpRowOut`）
- Modify: `backend/app/admissions/funnel.py`（`def _card`）
- Modify: `backend/app/admissions/follow_up.py`（`follow_up_list` 組 `rows` 的 dict）
- Create: `backend/tests/test_admissions_family_page_fields.py`
- Modify: `backend/tests/test_admissions_funnel.py`（`test_board_groups_cards_by_stage_and_term` 的 `set(card)`）
- Modify（產生）：`contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Produces：`FunnelCardOut.visit_request_id: uuid.UUID | None`、`FollowUpRowOut.visit_request_id: uuid.UUID | None`（必填欄位，值可為 null）。前端產生的型別 `FunnelCard.visit_request_id: string | null`、`FollowUpRow.visit_request_id: string | null`（Task 8 用）。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_family_page_fields.py`：

```python
"""看板卡片與待追蹤列帶 visit_request_id（2026-10-05 預約明細當家庭頁規格第 7 節）：
招生入學點有預約的卡片時，前端用它開那筆預約明細；手動新增的訪視是 null。"""

from __future__ import annotations

import pytest

from app.admissions import academic
from app.common.timezones import today_local
from tests.admissions_helpers import ADMISSIONS, complete, create_record, started_booking


@pytest.mark.asyncio
async def test_board_and_follow_ups_carry_visit_request_id(admin_client, public_client, db_session):
    booking = await started_booking(admin_client, public_client, db_session, child_name="家庭頁寶貝")
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    school_year, semester = academic.current_term(today_local())
    await create_record(admin_client, child_name="手動寶貝", target_school_year=school_year, target_semester=semester)

    board = await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year={school_year}")
    assert board.status_code == 200, board.text
    cards = {card["child_name"]: card for card in board.json()["columns"]["visited"]}
    assert cards["家庭頁寶貝"]["visit_request_id"] == booking["id"]
    assert cards["家庭頁寶貝"]["has_visit_request"] is True
    assert cards["手動寶貝"]["visit_request_id"] is None

    # 預約轉來的不自動排聯絡、手動新增也沒排：兩筆都在「未排定」。
    follow_ups = await admin_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua&scope=unscheduled&page_size=100")
    assert follow_ups.status_code == 200, follow_ups.text
    rows = {row["child_name"]: row for row in follow_ups.json()["rows"]}
    assert rows["家庭頁寶貝"]["visit_request_id"] == booking["id"]
    assert rows["手動寶貝"]["visit_request_id"] is None
```

- [ ] **Step 2：跑測試，確認失敗**

```bash
cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_familypage_test uv run pytest -q -p no:cacheprovider tests/test_admissions_family_page_fields.py
```

預期：FAIL，`KeyError: 'visit_request_id'`。

- [ ] **Step 3：實作**

`backend/app/admissions/schemas.py`：在 `class FunnelCardOut` 的 `has_visit_request: bool` 下一行加：

```python
    # 由哪一筆官網預約建立；招生入學點卡片時開那筆預約明細（2026-10-05 家庭頁規格 6.1）。
    visit_request_id: uuid.UUID | None
```

在 `class FollowUpRowOut` 的 `has_visit_request: bool` 下一行加同樣兩行。

`backend/app/admissions/funnel.py` 的 `_card()`：在 `"has_visit_request": visit.visit_request_id is not None,` 下一行加：

```python
        "visit_request_id": visit.visit_request_id,
```

`backend/app/admissions/follow_up.py` 的 `follow_up_list()`：在 rows dict 的 `"has_visit_request": visit.visit_request_id is not None,` 下一行加同一行。

- [ ] **Step 4：更新既有測試寫死的欄位集合**

`backend/tests/test_admissions_funnel.py` 的 `test_board_groups_cards_by_stage_and_term`，把 `assert set(card) == {...}` 改成：

```python
    assert set(card) == {
        "id", "child_name", "grade", "provisional_grade", "target_school_year", "target_semester",
        "visit_date", "has_visit_request", "visit_request_id", "withdrawn_from", "follow_up_at", "version",
    }
    assert card["visit_request_id"] is None
```

再找其他寫死欄位集合的地方：

```bash
grep -rn "has_visit_request" backend/tests | grep -E "set\(|==\s*\{" 
```

有斷言完整鍵集合的，一併加入 `"visit_request_id"`。

- [ ] **Step 5：跑相關測試**

```bash
cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_familypage_test uv run pytest -q -p no:cacheprovider tests/test_admissions_family_page_fields.py tests/test_admissions_funnel.py tests/test_admissions_follow_up.py tests/test_admissions_follow_up_schema.py
```

預期：全部 PASS。

- [ ] **Step 6：重產契約型別**

```bash
cd ~/Repositories/ivy-website-wt/visit-family-page-20261005
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:generate; npm run contract:check
grep -n "visit_request_id" contracts/generated/website-api.d.ts | head
npm --prefix admin run typecheck
```

預期：`contract:check` 通過；`FunnelCardOut` 與 `FollowUpRowOut` 底下都有 `visit_request_id: string | null;`；typecheck 0 錯誤。

- [ ] **Step 7：Commit**

```bash
git add backend/app/admissions/schemas.py backend/app/admissions/funnel.py backend/app/admissions/follow_up.py backend/tests/test_admissions_family_page_fields.py backend/tests/test_admissions_funnel.py contracts/openapi.json contracts/generated/website-api.d.ts
git add -u backend/tests   # Step 4 若改了其他測試
git commit -m "feat(admissions): 看板卡片與待追蹤列帶 visit_request_id

招生入學點有預約的卡片時要開那筆預約明細（家庭頁規格第 7 節）。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2：純函式 `admissions/family.ts`，以及共用的 `stageMeta`

**Files:**
- Create: `admin/src/admissions/family.ts`
- Modify: `admin/src/admissions/constants.ts`（新增 `stageMeta`）
- Modify: `admin/src/components/admissions/RecordsTab.vue`（刪掉本地的 `STAGE_TONES`、`stageMeta`，改 import）
- Modify: `admin/src/components/admissions/EventsDrawer.vue`（`stageChange`／`seatDetail` 改用 `recruitmentEventChanges`）
- Test: `admin/src/__tests__/familyPage.test.ts`

**Interfaces:**
- Consumes：`lastHandled`、`LastHandled`（`api/visitHistory.ts`）；`staffLabel`、`staffOf`、`StatusMeta`、`TagTone`（`api/labels.ts`）；`channelLabel`（`admissions/followUp.ts`）；`eventLabel`、`stageLabel`、`isStage`、`WITHDRAWN_FROM_LABELS`（`admissions/constants.ts`）；`termLabel`（`admissions/academic.ts`）。
- Produces（後面的 Task 都用這些名字）：
  - `constants.ts`：`stageMeta(visit: { stage: string; withdrawn_at?: string | null; withdrawn_from?: string | null }): StatusMeta`
  - `family.ts`：
    - `arrivedAt(history: readonly VisitHistoryOut[]): string | null`
    - `arrivedLabel(visitDate: string): string`（`'2026-10-06'` → `'10/06 到場'`）
    - `interface FamilyNote { key: string; kind: 'booking' | 'admissions'; at: string; phase: 'before' | 'after'; author: string; note: string; headline: string; nextFollowUpAt: string | null }`
    - `familyNotes(bookingNotes: readonly VisitContactNoteOut[], logs: readonly ContactLog[], arrived: string | null): FamilyNote[]`
    - `interface FamilyHistoryRow { key: string; source: 'booking' | 'admissions'; at: string; booking?: VisitHistoryOut; admissions?: RecruitmentEvent }`
    - `familyHistory(history: readonly VisitHistoryOut[], events: readonly RecruitmentEvent[]): FamilyHistoryRow[]`
    - `recruitmentEventChanges(event: RecruitmentEvent): string[]`
    - `personLabel(name: string | null | undefined): string`
    - `familyLastHandled(history: readonly VisitHistoryOut[], events: readonly RecruitmentEvent[], logs: readonly ContactLog[], selfId: string | null): LastHandled | null`
    - `latestContact(logs: readonly ContactLog[]): ContactLog | null`
    - `visitRequestPath(visitRequestId: string | null | undefined, can: (capability: string) => boolean): string | null`
    - `type DetailOrigin = 'admissions' | 'visit-list' | 'other'`；`detailOrigin(back: unknown): DetailOrigin`

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/familyPage.test.ts`：

```ts
// 預約明細當家庭頁的純函式（docs/specs/2026-10-05-visit-family-page-design.md 5.2、5.4、5.5、6）。
import { describe, expect, it } from 'vitest'
import type { ContactLog, RecruitmentEvent, VisitContactNoteOut, VisitHistoryOut } from '../api/types'
import { stageMeta } from '../admissions/constants'
import {
  arrivedAt, arrivedLabel, detailOrigin, familyHistory, familyLastHandled, familyNotes, latestContact, personLabel,
  recruitmentEventChanges, visitRequestPath,
} from '../admissions/family'

const history = (changes: Partial<VisitHistoryOut> = {}): VisitHistoryOut => ({
  id: 'h1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null,
  before: null, after: null, reason: null, created_at: '2026-10-01T02:12:00Z', ...changes,
})
const recruitmentEvent = (changes: Partial<RecruitmentEvent> = {}): RecruitmentEvent => ({
  id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' },
  actor_user_id: 'desk', actor_name: 'desk@example.invalid', created_at: '2026-10-06T02:35:00Z', ...changes,
})
const note = (changes: Partial<VisitContactNoteOut> = {}): VisitContactNoteOut => ({
  id: 'n1', note: '提醒參觀時間', created_at: '2026-10-03T06:05:00Z', created_by: 'desk',
  created_by_display_name: '櫃台小美', created_by_email: 'desk@example.invalid', ...changes,
})
const log = (changes: Partial<ContactLog> = {}): ContactLog => ({
  id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-08T08:20:00Z', channel: 'phone', reached: true,
  note: '下週一前回覆', next_follow_up_at: '2026-10-13T02:00:00Z', created_by: 'desk', created_by_name: '櫃台小美',
  created_at: '2026-10-08T08:21:00Z', ...changes,
})

describe('stageMeta（訪視明細與家庭版面共用）', () => {
  it('階段文字與色調；退出寫從哪一段退', () => {
    expect(stageMeta({ stage: 'visited' })).toEqual({ label: '已訪視', tone: 'info' })
    expect(stageMeta({ stage: 'deposited' })).toEqual({ label: '已預繳', tone: 'warning' })
    expect(stageMeta({ stage: 'enrolled' })).toEqual({ label: '已註冊', tone: 'success' })
    expect(stageMeta({ stage: 'withdrawn', withdrawn_from: 'enrolled', withdrawn_at: '2026-10-09T00:00:00Z' })).toEqual({ label: '已退註冊', tone: 'danger' })
  })
})

describe('到場時間與頁首', () => {
  it('取最後一次標記已到場；沒有就是 null', () => {
    expect(arrivedAt([history(), history({ id: 'h2', event_type: 'completed', created_at: '2026-10-06T02:35:00Z' })])).toBe('2026-10-06T02:35:00Z')
    expect(arrivedAt([history()])).toBeNull()
  })
  it('到場日寫 MM/DD', () => {
    expect(arrivedLabel('2026-10-06')).toBe('10/06 到場')
  })
})

describe('聯絡紀錄合併（5.4）', () => {
  it('新的在上；依到場時間標參觀前／參觀後；參觀後聯絡有管道與結果', () => {
    const rows = familyNotes([note(), note({ id: 'n2', note: '到場後補記', created_at: '2026-10-07T01:00:00Z' })], [log()], '2026-10-06T02:35:00Z')
    expect(rows.map((row) => [row.key, row.phase])).toEqual([
      ['admissions-l1', 'after'], ['booking-n2', 'after'], ['booking-n1', 'before'],
    ])
    expect(rows[0]).toMatchObject({ headline: '電話・聯絡到了', author: '櫃台小美', note: '下週一前回覆', nextFollowUpAt: '2026-10-13T02:00:00Z' })
    expect(rows[2]).toMatchObject({ headline: '', author: '櫃台小美', note: '提醒參觀時間', nextFollowUpAt: null })
  })
  it('同一時間參觀後排前面；沒有到場時間時預約紀錄都算參觀前', () => {
    const at = '2026-10-08T08:20:00Z'
    expect(familyNotes([note({ created_at: at })], [log({ contacted_at: at })], null).map((row) => [row.kind, row.phase])).toEqual([
      ['admissions', 'after'], ['booking', 'before'],
    ])
  })
})

describe('案件歷程合併（5.5）', () => {
  it('新的在上；同一時間招生事件在預約事件上面', () => {
    const rows = familyHistory(
      [history(), history({ id: 'h2', event_type: 'completed', source: 'staff', created_at: '2026-10-06T02:35:00Z' })],
      [recruitmentEvent(), recruitmentEvent({ id: 'e2', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', created_at: '2026-10-14T01:30:00Z' })],
    )
    expect(rows.map((row) => row.key)).toEqual(['admissions-e2', 'admissions-e1', 'booking-h2', 'booking-h1'])
  })
  it('招生事件的變更行：階段變化與保留座位', () => {
    expect(recruitmentEventChanges(recruitmentEvent({ event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited' }))).toEqual(['已訪視 → 已預繳'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'seat_reserved', from_stage: 'deposited', to_stage: 'deposited', metadata_json: { grade: '小班', school_year: 115, semester: 1 },
    }))).toEqual(['小班・115 上學期'])
    expect(recruitmentEventChanges(recruitmentEvent())).toEqual([])
  })
})

describe('最後處理與最近聯絡', () => {
  it('取預約歷程、招生事件、參觀後聯絡裡最新的一筆園方操作；自己寫「你」', () => {
    const handled = familyLastHandled(
      [history({ id: 'h2', event_type: 'completed', source: 'staff', actor_user_id: 'desk', actor_display_name: '櫃台小美', created_at: '2026-10-06T02:35:00Z' })],
      [recruitmentEvent()],
      [log()],
      'desk',
    )
    expect(handled).toEqual({ who: '你', at: '2026-10-08T08:21:00Z', what: '記錄聯絡', self: true })
    const other = familyLastHandled([], [recruitmentEvent({ actor_user_id: 'ca', actor_name: 'ca@example.invalid' })], [], 'desk')
    expect(other).toMatchObject({ who: 'ca', what: '建立訪視（官網預約到場）', self: false })
  })
  it('到場與建立訪視同一時間時，維持預約的「標記已到場」', () => {
    const at = '2026-10-06T02:35:00Z'
    const handled = familyLastHandled(
      [history({ event_type: 'completed', source: 'staff', actor_user_id: 'desk', created_at: at })], [recruitmentEvent({ created_at: at })], [], null,
    )
    expect(handled?.what).toBe('標記已到場')
  })
  it('最近聯絡取聯絡時間最新的一筆', () => {
    expect(latestContact([log({ id: 'old', contacted_at: '2026-10-01T00:00:00Z' }), log()])?.id).toBe('l1')
    expect(latestContact([])).toBeNull()
  })
  it('名字是 Email 時只寫 @ 前面', () => {
    expect(personLabel('amy@ivy.example')).toBe('amy')
    expect(personLabel('林老師')).toBe('林老師')
    expect(personLabel(null)).toBe('')
  })
})

describe('招生入口與返回（第 6 節）', () => {
  const canAll = () => true
  const noBooking = (capability: string) => capability !== 'booking.read'
  it('有預約且看得到預約：開預約明細；否則 null（開抽屜）', () => {
    expect(visitRequestPath('vr-1', canAll)).toBe('/visit-requests/vr-1')
    expect(visitRequestPath(null, canAll)).toBeNull()
    expect(visitRequestPath('vr-1', noBooking)).toBeNull()
  })
  it('上一頁是招生入學、案件列表或其他', () => {
    expect(detailOrigin('/admissions?campus=yihua&tab=funnel')).toBe('admissions')
    expect(detailOrigin('/visit-requests?group=past')).toBe('visit-list')
    expect(detailOrigin('/visit-requests/abc')).toBe('other')
    expect(detailOrigin(undefined)).toBe('other')
  })
})
```

- [ ] **Step 2：跑測試，確認失敗**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyPage.test.ts
```

預期：FAIL，`Failed to resolve import "../admissions/family"`。

- [ ] **Step 3：`constants.ts` 加 `stageMeta`**

在 `admin/src/admissions/constants.ts` 頂端的 import 改成：

```ts
import { RECRUITMENT_STAGE_LABELS, type StatusMeta, type TagTone } from '../api/labels'
```

在 `export const WITHDRAWN_FROM_LABELS` 那一行下面加：

```ts
// 招生階段的標籤（訪視明細「階段」欄、預約明細家庭版面頁首共用）：色系同看板欄（灰 → 橙 → 綠），
// 退出後 has_deposit 已清成 false，寫清楚從哪一段退的（園務總覽第 6 點）。
const STAGE_TONES: Record<Stage, TagTone> = { visited: 'info', deposited: 'warning', enrolled: 'success', withdrawn: 'danger' }

export function stageMeta(visit: { stage: string; withdrawn_at?: string | null; withdrawn_from?: string | null }): StatusMeta {
  if (visit.withdrawn_at || visit.stage === 'withdrawn') {
    return { label: `已${WITHDRAWN_FROM_LABELS[visit.withdrawn_from ?? 'deposited'] ?? '退預繳'}`, tone: 'danger' }
  }
  return { label: stageLabel(visit.stage), tone: isStage(visit.stage) ? STAGE_TONES[visit.stage] : 'info' }
}
```

`RecordsTab.vue`：刪掉 `const STAGE_TONES …` 與 `function stageMeta(row: RecruitmentVisit) {…}` 兩段（搜尋 `const STAGE_TONES`），在 `admissions/constants` 的 import 裡加入 `stageMeta`。如果 `TagTone` 已經沒人用，從 `../../api/labels` 的 import 拿掉。

- [ ] **Step 4：寫 `family.ts`**

`admin/src/admissions/family.ts`：

```ts
// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md）的純函式：合併參觀前後的
// 聯絡紀錄與歷程、頁首「最後處理」、招生入學點列時要去哪、返回鍵的來源。
import type { ContactLog, RecruitmentEvent, VisitContactNoteOut, VisitHistoryOut } from '../api/types'
import { staffLabel, staffOf } from '../api/labels'
import { lastHandled, type LastHandled } from '../api/visitHistory'
import { termLabel } from './academic'
import { eventLabel, stageLabel } from './constants'
import { channelLabel } from './followUp'

/** 預約歷程裡最後一次「標記已到場」的時間；沒有就是 null。 */
export function arrivedAt(history: readonly VisitHistoryOut[]): string | null {
  let latest: string | null = null
  for (const event of history) {
    if (event.event_type !== 'completed') continue
    if (latest === null || Date.parse(event.created_at) > Date.parse(latest)) latest = event.created_at
  }
  return latest
}

/** 頁首狀態下方的「10/06 到場」：日期取招生訪視的參觀日期（YYYY-MM-DD）。 */
export function arrivedLabel(visitDate: string): string {
  const [, month = '', day = ''] = visitDate.split('-')
  return `${month}/${day} 到場`
}

/** 招生事件、參觀後聯絡帶的名字是顯示名稱或 Email；Email 只寫 @ 前面（同 staffLabel）。 */
export function personLabel(name: string | null | undefined): string {
  if (!name) return ''
  return staffLabel(name.includes('@') ? { email: name } : { display_name: name }, '')
}

export interface FamilyNote {
  key: string
  kind: 'booking' | 'admissions'
  at: string
  phase: 'before' | 'after'
  author: string
  note: string
  /** 參觀後聯絡才有：「電話・聯絡到了」；預約的聯絡紀錄是空字串。 */
  headline: string
  /** 參觀後聯絡當時排的下次聯絡（ISO）；沒有是 null。 */
  nextFollowUpAt: string | null
}

/**
 * 聯絡紀錄合併（規格 5.4）：參觀前記在預約、參觀後記在招生，這裡一起列，新的在上。
 * 預約的紀錄依時間標：早於標記已到場的是參觀前，之後補記的也算參觀後。同一時間參觀後排前面。
 */
export function familyNotes(
  bookingNotes: readonly VisitContactNoteOut[],
  logs: readonly ContactLog[],
  arrived: string | null,
): FamilyNote[] {
  const cut = arrived ? Date.parse(arrived) : Number.POSITIVE_INFINITY
  const items: FamilyNote[] = [
    ...bookingNotes.map((note): FamilyNote => ({
      key: `booking-${note.id}`,
      kind: 'booking',
      at: note.created_at,
      phase: Date.parse(note.created_at) < cut ? 'before' : 'after',
      author: note.created_by ? staffLabel(staffOf(note, 'created_by')) : '',
      note: note.note,
      headline: '',
      nextFollowUpAt: null,
    })),
    ...logs.map((log): FamilyNote => ({
      key: `admissions-${log.id}`,
      kind: 'admissions',
      at: log.contacted_at,
      phase: 'after',
      author: personLabel(log.created_by_name),
      note: log.note ?? '',
      headline: `${channelLabel(log.channel)}・${log.reached ? '聯絡到了' : '沒聯絡到'}`,
      nextFollowUpAt: log.next_follow_up_at,
    })),
  ]
  const rank = { admissions: 0, booking: 1 }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || rank[a.kind] - rank[b.kind])
}

export interface FamilyHistoryRow {
  key: string
  source: 'booking' | 'admissions'
  at: string
  booking?: VisitHistoryOut
  admissions?: RecruitmentEvent
}

/**
 * 案件歷程合併（規格 5.5）：預約歷程與招生事件（兩邊 API 都是舊到新）一起列，新的在上。
 * 同一時間（到場與建立訪視同一個交易）招生事件排上面；同來源同時間照原順序倒過來。
 */
export function familyHistory(history: readonly VisitHistoryOut[], events: readonly RecruitmentEvent[]): FamilyHistoryRow[] {
  const rank = { admissions: 0, booking: 1 }
  return [
    ...history.map((event, index) => ({ index, row: { key: `booking-${event.id}`, source: 'booking' as const, at: event.created_at, booking: event } })),
    ...events.map((event, index) => ({ index, row: { key: `admissions-${event.id}`, source: 'admissions' as const, at: event.created_at, admissions: event } })),
  ]
    .sort((a, b) => Date.parse(b.row.at) - Date.parse(a.row.at) || rank[a.row.source] - rank[b.row.source] || b.index - a.index)
    .map(({ row }) => row)
}

/** 招生事件的變更行：階段變化（「已訪視 → 已預繳」）與保留座位的年級學期。歷程抽屜與預約明細共用。 */
export function recruitmentEventChanges(event: RecruitmentEvent): string[] {
  const lines: string[] = []
  if (event.from_stage && event.to_stage && event.from_stage !== event.to_stage) {
    lines.push(`${stageLabel(event.from_stage)} → ${stageLabel(event.to_stage)}`)
  }
  if (event.event_type === 'seat_reserved' || event.event_type === 'seat_released') {
    const metadata = (event.metadata_json && typeof event.metadata_json === 'object' ? event.metadata_json : {}) as Record<string, unknown>
    const grade = typeof metadata.grade === 'string' ? metadata.grade : ''
    const year = typeof metadata.school_year === 'number' ? metadata.school_year : null
    const semester = typeof metadata.semester === 'number' ? metadata.semester : null
    const seat = [grade, year ? termLabel(year, semester) : ''].filter(Boolean).join('・')
    if (seat) lines.push(seat)
  }
  return lines
}

/**
 * 家庭版面頁首的「最後處理」（規格 5.2）：預約歷程（園方操作）、招生事件、參觀後聯絡三者取最新一筆。
 * 只算有操作者的；時間相同時維持先找到的（預約那筆），到場與建立訪視才不會寫成「建立訪視」。
 */
export function familyLastHandled(
  history: readonly VisitHistoryOut[],
  events: readonly RecruitmentEvent[],
  logs: readonly ContactLog[],
  selfId: string | null,
): LastHandled | null {
  let best = lastHandled([...history], selfId)
  const consider = (at: string, actorId: string | null | undefined, name: string | null | undefined, what: string) => {
    const time = Date.parse(at)
    if (!actorId || Number.isNaN(time) || (best && time <= Date.parse(best.at))) return
    const self = Boolean(selfId) && actorId === selfId
    best = { who: self ? '你' : personLabel(name) || '同事', at, what, self }
  }
  for (const event of events) consider(event.created_at, event.actor_user_id, event.actor_name, eventLabel(event.event_type, event.metadata_json))
  for (const log of logs) consider(log.created_at, log.created_by, log.created_by_name, '記錄聯絡')
  return best
}

/** 最新一筆參觀後聯絡（依聯絡時間，不假設 API 的順序）。 */
export function latestContact(logs: readonly ContactLog[]): ContactLog | null {
  return logs.reduce<ContactLog | null>(
    (best, log) => (!best || Date.parse(log.contacted_at) > Date.parse(best.contacted_at) ? log : best),
    null,
  )
}

/** 招生入學點一筆訪視時要開的預約明細（規格 6.1）；沒有預約或看不到預約時回 null，照舊開抽屜。 */
export function visitRequestPath(visitRequestId: string | null | undefined, can: (capability: string) => boolean): string | null {
  return visitRequestId && can('booking.read') ? `/visit-requests/${visitRequestId}` : null
}

export type DetailOrigin = 'admissions' | 'visit-list' | 'other'

/** 預約明細的上一頁（router history.state.back）是招生入學、案件列表或其他（規格 6.2）。 */
export function detailOrigin(back: unknown): DetailOrigin {
  if (typeof back !== 'string') return 'other'
  const path = back.split(/[?#]/)[0]!.replace(/\/+$/, '')
  if (path === '/admissions') return 'admissions'
  if (path === '/visit-requests') return 'visit-list'
  return 'other'
}
```

- [ ] **Step 5：`EventsDrawer.vue` 改用共用的變更行**

在 `admin/src/components/admissions/EventsDrawer.vue`：

1. import 加 `import { recruitmentEventChanges } from '../../admissions/family'`。
2. 刪掉 `function metadataOf`、`function stageChange`、`function seatDetail`（搜尋這三個名字，先確認沒有別處用到）。
3. 模板裡這兩行：

```vue
            <p v-if="stageChange(item.event)" class="events__detail">{{ stageChange(item.event) }}</p>
            <p v-if="seatDetail(item.event)" class="events__detail">{{ seatDetail(item.event) }}</p>
```

換成：

```vue
            <p v-for="line in recruitmentEventChanges(item.event)" :key="line" class="events__detail">{{ line }}</p>
```

4. `termLabel` 若已沒人用，從 import 拿掉。

- [ ] **Step 6：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyPage.test.ts src/__tests__/admissionsRecords.test.ts src/__tests__/admissionsFunnel.test.ts src/__tests__/admissionsFollowUp.test.ts
npm --prefix admin run typecheck
```

預期：全部 PASS，typecheck 0 錯誤。

- [ ] **Step 7：Commit**

```bash
git add admin/src/admissions/family.ts admin/src/admissions/constants.ts admin/src/components/admissions/RecordsTab.vue admin/src/components/admissions/EventsDrawer.vue admin/src/__tests__/familyPage.test.ts
git commit -m "feat(admin): 家庭頁的合併與判斷純函式，階段標籤與事件變更行改共用

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3：抽出 `useFamilyAdmissions`（行為不變）

**Files:**
- Create: `admin/src/composables/useFamilyAdmissions.ts`
- Modify: `admin/src/views/VisitDetailView.vue`（`// ---- 招生訪視（規格第 10 節）----` 那一段、`markCompleted`、import）

**Interfaces:**
- Consumes：`listRecords`、`createFromVisitRequest`（`api/admissions.ts`）；`useRequestSequence`；`usePermissions`。
- Produces：

```ts
export type AdmissionsAvailability = 'yes' | 'no' | 'unknown'
export function useFamilyAdmissions(
  detail: Ref<VisitRequestFullOut | null>,
  hooks: { reloadDetail: () => Promise<void> },
): {
  canRead: ComputedRef<boolean>; canWrite: ComputedRef<boolean>
  visit: Ref<RecruitmentVisit | null>; available: Ref<AdmissionsAvailability>; creating: Ref<boolean>
  lookup: () => Promise<void>; settled: () => Promise<void> | null; create: () => Promise<void>
}
```

（Task 7 會再加 `isFamily`、`events`、`contactLogs`、`staff`、`options`、`extrasFailed`、`lookupFailed`、`loadExtras`、`replaceVisit`。）

- [ ] **Step 1：確認基準測試是綠的**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/admissionsVisitDetail.test.ts src/__tests__/visitDetails.test.ts
```

預期：PASS。這一個 Task 是純搬移，這兩檔就是它的測試。

- [ ] **Step 2：寫 composable**

`admin/src/composables/useFamilyAdmissions.ts`：

```ts
import { computed, ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createFromVisitRequest, listRecords } from '../api/admissions'
import { ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { RecruitmentVisit, VisitRequestFullOut } from '../api/types'
import { notifyError } from './notify'
import { usePermissions } from './usePermissions'
import { useRequestSequence } from './useRequestSequence'

export type AdmissionsAvailability = 'yes' | 'no' | 'unknown'

// 預約明細的招生部分（招生規格第 10 節；2026-10-05 家庭頁規格 5.10 從 VisitDetailView 搬出來）。
// 有 admissions.read 才查；查詢成功＝招生可用、404＝招生未啟用、其他錯誤或沒查＝不確定（標記已到場照舊）。
// 已到場但還沒有招生訪視（上線前的舊預約、或招生訪視被刪掉）時，有 admissions.write 的人可以補建。
// 換案件或狀態變了（例如剛標記已到場）才重查；只是重讀明細不重查。
export function useFamilyAdmissions(detail: Ref<VisitRequestFullOut | null>, hooks: { reloadDetail: () => Promise<void> }) {
  const { can } = usePermissions()
  const canRead = computed(() => can('admissions.read'))
  const canWrite = computed(() => can('admissions.write'))
  const visit = ref<RecruitmentVisit | null>(null)
  const available = ref<AdmissionsAvailability>('unknown')
  const creating = ref(false)
  const requests = useRequestSequence()
  // 進行中的查詢：標記已到場要等它（只在查完仍是 unknown 才沿用舊行為）。
  let pending: Promise<void> | null = null

  async function fetchVisit() {
    const current = detail.value
    const request = requests.begin()
    visit.value = null
    available.value = 'unknown'
    if (!current || !canRead.value) return
    try {
      const rows = await listRecords({ campus_key: current.campus_key, visit_request_id: current.id, page: 1, page_size: 1 })
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      visit.value = Array.isArray(rows) ? (rows[0] ?? null) : null
      available.value = 'yes'
    } catch (err) {
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      // 404：招生入學未啟用，整區不顯示；其他錯誤讀不到也不影響處理案件。
      if (err instanceof ApiError && err.status === 404) available.value = 'no'
    }
  }

  function lookup(): Promise<void> {
    const run = fetchVisit().finally(() => {
      if (pending === run) pending = null
    })
    pending = run
    return run
  }

  /** 標記已到場前要等的查詢；沒有在查就是 null。 */
  const settled = (): Promise<void> | null => pending

  async function create() {
    const current = detail.value
    if (!current || creating.value) return
    creating.value = true
    try {
      const created = await createFromVisitRequest(current.id)
      if (detail.value?.id !== current.id) return
      visit.value = created
      ElMessage.success('已建立招生訪視')
    } catch (err) {
      notifyError(apiErrorMessage(err, '建立招生訪視失敗'))
      // 409：預約已不是已到場或已匿名化，重讀讓畫面跟上。
      if (err instanceof ApiError && err.status === 409) await hooks.reloadDetail()
    } finally {
      creating.value = false
    }
  }

  watch(() => `${detail.value?.id ?? ''}|${detail.value?.status ?? ''}`, () => void lookup())

  return { canRead, canWrite, visit, available, creating, lookup, settled, create }
}
```

- [ ] **Step 3：`VisitDetailView.vue` 改用 composable**

1. import：拿掉 `import { createFromVisitRequest, listRecords } from '../api/admissions'`，加 `import { useFamilyAdmissions } from '../composables/useFamilyAdmissions'`。
2. 緊接在 `const detail = ref<VisitRequestFullOut | null>(null)` **下一行**加入（放在最前面，Task 7 的 `noteDirty` 會用到它，避免暫時性死區）：

```ts
// 招生部分（招生規格第 10 節、2026-10-05 家庭頁規格 5.10）：composables/useFamilyAdmissions.ts。
const family = useFamilyAdmissions(detail, { reloadDetail: () => load({ quiet: true }) })
const { canRead: canReadAdmissions, canWrite: canCreateAdmissions, visit: admissionsVisit, available: admissionsAvailable, creating: creatingAdmissions } = family
const loadAdmissionsVisit = family.lookup
const createAdmissionsVisit = family.create
```

3. 刪掉 `// ---- 招生訪視（規格第 10 節）----` 開始，到 `async function createAdmissionsVisit() {…}` 結束的整段，但**保留** `const admissionsLink = computed(...)`（Task 7 才拿掉）。被刪的包括 `canReadAdmissions`、`canCreateAdmissions`、`admissionsVisit`、`admissionsAvailable`、`creatingAdmissions`、`admissionsLookup`、`loadAdmissionsVisit`、`fetchAdmissionsVisit`、watch，以及 `createAdmissionsVisit`。
4. `markCompleted()` 第一行：

```ts
  if (canReadAdmissions.value && admissionsLookup) await admissionsLookup
```

換成：

```ts
  const lookupInFlight = canReadAdmissions.value ? family.settled() : null
  if (lookupInFlight) await lookupInFlight
```

- [ ] **Step 4：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/admissionsVisitDetail.test.ts src/__tests__/visitDetails.test.ts src/__tests__/ux20260928B2.test.ts
npm --prefix admin run typecheck
```

預期：全部 PASS，typecheck 0 錯誤，測試檔一行都沒改。

- [ ] **Step 5：Commit**

```bash
git add admin/src/composables/useFamilyAdmissions.ts admin/src/views/VisitDetailView.vue
git commit -m "refactor(admin): 預約明細的招生查詢與補建抽成 useFamilyAdmissions

行為不變，為家庭版面鋪路（家庭頁規格 5.10）。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4：`FamilyAdmissionsData.vue`（招生資料面板）

**Files:**
- Create: `admin/src/components/visit/FamilyAdmissionsData.vue`
- Test: `admin/src/__tests__/familyAdmissionsData.test.ts`

**Interfaces:**
- Consumes：`RecordDialog`（props `mode`、`campusKey`、`record`、`options`，emits `saved: [visit]`、`stale: []`）；`termLabel`；`MISSING_CHILD_NAME`、`ANONYMIZED_CONFLICT_TEXT`；`useNarrowScreen()`。
- Produces：`<FamilyAdmissionsData :visit="RecruitmentVisit" :options="AdmissionsOptions | null" :editable="boolean" @saved="(visit: RecruitmentVisit) => …" @stale="() => …" />`，根元素 class `panel family-data`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/familyAdmissionsData.test.ts`：

```ts
// 家庭版面的招生資料面板（docs/specs/2026-10-05-visit-family-page-design.md 5.3）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { button, cleanup, hasButton, mockGet, mountWith, visit } from './admissionsTestKit'

// 編輯表單打開時可能讀選項或名單：一律走 mock（對不上的路徑回空陣列），不打真的 API。
beforeEach(() => { mockGet({}) })
afterEach(cleanup)

const options = {
  months: [], sources: [], referrers: [], grades: [], no_deposit_reasons: [], contact_channels: {},
  source_categories: { referral: '有緣名單（家長介紹／社區招生）' },
}
const paper = { english_name: null, father_occupation: null, mother_occupation: null }
const labels = (wrapper: VueWrapper) => wrapper.findAll('.el-descriptions__label').map((cell) => cell.text())
const valueOf = (wrapper: VueWrapper, label: string) => {
  const cells = wrapper.findAll('.el-descriptions__label')
  const index = cells.findIndex((cell) => cell.text() === label)
  return wrapper.findAll('.el-descriptions__content')[index]?.text()
}

describe('招生資料面板', () => {
  it('固定列依序列出；有值才列的只列有值的；來源分類用選項文字、電話可撥', async () => {
    const record = visit({ ...paper, english_name: 'Hana', source_category: 'referral', rides_bus: true, tour_guide_name: 'Amy', father_occupation: '工程師' })
    const { wrapper } = await mountWith(FamilyAdmissionsData, { props: { visit: record, options, editable: true } })
    expect(labels(wrapper)).toEqual([
      '幼生姓名', '英文名字', '生日', '適讀班級', '聯絡人', '電話', '入學學期', '搭娃娃車', '帶參觀老師', '來源分類', '來源備註', '介紹者', '父親職業',
    ])
    expect(valueOf(wrapper, '來源分類')).toBe('有緣名單（家長介紹／社區招生）')
    expect(valueOf(wrapper, '入學學期')).toBe('115 上學期')
    expect(valueOf(wrapper, '搭娃娃車')).toBe('要搭')
    expect(valueOf(wrapper, '介紹者')).toBe('—')
    expect(wrapper.get('a[href="tel:0912345678"]').text()).toBe('0912345678')
  })

  it('預繳、未預繳原因、退出原因依階段才列', async () => {
    const deposited = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, stage: 'deposited', has_deposit: true, deposit_collector: 'Amy' }), options, editable: true } })
    expect(valueOf(deposited.wrapper, '收預繳人員')).toBe('Amy')
    cleanup()
    const visited = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, no_deposit_reason: '時程未到／仍在觀望', no_deposit_reason_detail: '等爸爸決定' }), options, editable: true } })
    expect(valueOf(visited.wrapper, '未預繳原因')).toBe('時程未到／仍在觀望：等爸爸決定')
    cleanup()
    const withdrawn = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, stage: 'withdrawn', withdrawn_at: '2026-10-09T00:00:00Z', withdrawn_from: 'deposited', withdraw_reason: '改送他校' }), options, editable: true } })
    expect(valueOf(withdrawn.wrapper, '退出原因')).toBe('改送他校')
  })

  it('沒填姓名寫「待補」', async () => {
    const { wrapper } = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, child_name: '（未填姓名）' }), options, editable: true } })
    expect(valueOf(wrapper, '幼生姓名')).toBe('待補')
  })

  it('編輯開招生的編輯表單；存檔往上傳', async () => {
    const record = visit({ ...paper })
    const { wrapper } = await mountWith(FamilyAdmissionsData, { props: { visit: record, options, editable: true } })
    await button(wrapper, '編輯')!.trigger('click')
    const dialog = wrapper.getComponent(RecordDialog)
    expect(dialog.props()).toMatchObject({ modelValue: true, mode: 'edit', campusKey: 'yihua', record })
    dialog.vm.$emit('saved', { ...record, version: 2 })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ version: 2 })
  })

  it('不能寫入或已匿名化：沒有編輯；匿名化說明、不給撥號', async () => {
    const readonly = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper }), options, editable: false } })
    expect(hasButton(readonly.wrapper, '編輯')).toBe(false)
    cleanup()
    const anonymized = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, anonymized_at: '2026-10-01T00:00:00Z' }), options, editable: true } })
    expect(hasButton(anonymized.wrapper, '編輯')).toBe(false)
    expect(anonymized.wrapper.text()).toContain('這筆招生訪視已依保存政策匿名化')
    expect(anonymized.wrapper.find('a[href^="tel:"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2：跑測試，確認失敗**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyAdmissionsData.test.ts
```

預期：FAIL，找不到 `../components/visit/FamilyAdmissionsData.vue`。

- [ ] **Step 3：實作**

`admin/src/components/visit/FamilyAdmissionsData.vue`：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdmissionsOptions, RecruitmentVisit } from '../../api/types'
import { termLabel } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, MISSING_CHILD_NAME } from '../../admissions/constants'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import RecordDialog from '../admissions/RecordDialog.vue'

// 家庭版面的招生資料（2026-10-05 家庭頁規格 5.3）：園方維護的那份。固定列一律列（沒填寫「—」），
// 依階段或有值才列的放後面；欄位與文字同「招生訪視照紙本補欄位」之後的 RecordDialog。
const props = defineProps<{ visit: RecruitmentVisit; options: AdmissionsOptions | null; editable: boolean }>()
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

const narrow = useNarrowScreen()
const editOpen = ref(false)
const canEdit = computed(() => props.editable && !props.visit.anonymized_at)
const missingName = computed(() => props.visit.child_name === MISSING_CHILD_NAME)

interface Row { label: string; value: string; href?: string }

const rows = computed<Row[]>(() => {
  const v = props.visit
  const dash = (value: string | null | undefined) => value || '—'
  const category = v.source_category ? (props.options?.source_categories?.[v.source_category] ?? v.source_category) : '未選'
  const fixed: Row[] = [
    { label: '幼生姓名', value: missingName.value ? '' : v.child_name },
    { label: '英文名字', value: dash(v.english_name) },
    { label: '生日', value: dash(v.birthday) },
    { label: '適讀班級', value: dash(v.grade) },
    { label: '聯絡人', value: dash(v.contact_name) },
    { label: '電話', value: dash(v.phone), href: v.phone && !v.anonymized_at ? `tel:${v.phone}` : undefined },
    { label: '入學學期', value: termLabel(v.target_school_year, v.target_semester) },
    { label: '搭娃娃車', value: v.rides_bus ? '要搭' : '不搭' },
    { label: '帶參觀老師', value: dash(v.tour_guide_name) },
    { label: '來源分類', value: category },
    { label: '來源備註', value: dash(v.source) },
    { label: '介紹者', value: dash(v.referrer) },
  ]
  const optional: [string, string | null | undefined][] = [
    ['收預繳人員', v.has_deposit ? v.deposit_collector : null],
    ['未預繳原因', v.stage === 'visited' ? [v.no_deposit_reason, v.no_deposit_reason_detail].filter(Boolean).join('：') : null],
    ['退出原因', v.stage === 'withdrawn' ? v.withdraw_reason : null],
    ['地址', [v.district, v.address].filter(Boolean).join(' ')],
    ['父親職業', v.father_occupation],
    ['母親職業', v.mother_occupation],
    ['備註', v.notes],
    ['家長回應', v.parent_response],
  ]
  return [...fixed, ...optional.filter(([, value]) => Boolean(value)).map(([label, value]) => ({ label, value: value as string }))]
})
</script>

<template>
  <section class="panel family-data">
    <div class="panel__head">
      <h2>招生資料</h2>
      <el-button v-if="canEdit" size="small" @click="editOpen = true">編輯</el-button>
    </div>
    <p v-if="visit.anonymized_at" class="hint family-data__anonymized">{{ ANONYMIZED_CONFLICT_TEXT }}。</p>
    <el-descriptions :column="narrow ? 1 : 2" border label-width="104" class="family-data__desc">
      <el-descriptions-item v-for="row in rows" :key="row.label" :label="row.label">
        <el-tag v-if="row.label === '幼生姓名' && missingName" size="small" type="warning" effect="plain" round>待補</el-tag>
        <a v-else-if="row.href" :href="row.href" class="num family-data__link">{{ row.value }}</a>
        <template v-else>{{ row.value }}</template>
      </el-descriptions-item>
    </el-descriptions>
    <RecordDialog
      v-if="canEdit"
      v-model="editOpen"
      mode="edit"
      :campus-key="visit.campus_key"
      :record="visit"
      :options="options"
      @saved="(saved: RecruitmentVisit) => emit('saved', saved)"
      @stale="emit('stale')"
    />
  </section>
</template>

<style scoped>
.family-data__anonymized {
  margin: 0;
  padding: 10px 18px 0;
}

.family-data__desc {
  padding: 12px 18px 16px;
}

.family-data__link {
  color: var(--el-color-primary);
  text-decoration: none;
}
</style>
```

> 「待補」測試用 `valueOf(...).toBe('待補')`：`el-descriptions__content` 只有標籤文字，所以文字就是「待補」。

- [ ] **Step 4：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyAdmissionsData.test.ts src/__tests__/ux20261005.test.ts src/__tests__/a11yStructure.test.ts
npm --prefix admin run typecheck
```

預期：PASS。若 typecheck 說 `english_name`／`father_occupation`／`mother_occupation` 不存在，代表前置 P1 的紙本補欄位沒進 main，停下回報。

- [ ] **Step 5：Commit**

```bash
git add admin/src/components/visit/FamilyAdmissionsData.vue admin/src/__tests__/familyAdmissionsData.test.ts
git commit -m "feat(admin): 預約明細家庭版面的招生資料面板

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5：`FamilyContactNotes.vue` 與 `VisitHistoryTimeline` 合併招生事件

**Files:**
- Create: `admin/src/components/visit/FamilyContactNotes.vue`
- Modify: `admin/src/components/VisitHistoryTimeline.vue`
- Test: `admin/src/__tests__/familyNotesHistory.test.ts`

**Interfaces:**
- Consumes：`FamilyNote`、`familyHistory`、`recruitmentEventChanges`、`personLabel`（Task 2）；`eventLabel`；`formatDateTime`。
- Produces：
  - `<FamilyContactNotes :notes="readonly FamilyNote[]" :logs-failed="boolean" @reload="() => …" />`，根元素是 `<section>`，父層加 `class="section detail__notes"`。
  - `VisitHistoryTimeline` 新增選填 prop `recruitmentEvents?: readonly RecruitmentEvent[]`；沒傳時輸出與改版前相同；有傳時每列多一個 `.timeline__source`（「預約」／「招生」）。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/familyNotesHistory.test.ts`：

```ts
// 家庭版面的聯絡紀錄與合併歷程（docs/specs/2026-10-05-visit-family-page-design.md 5.4、5.5）。
import { afterEach, describe, expect, it } from 'vitest'
import FamilyContactNotes from '../components/visit/FamilyContactNotes.vue'
import VisitHistoryTimeline from '../components/VisitHistoryTimeline.vue'
import type { FamilyNote } from '../admissions/family'
import { button, cleanup, mountWith } from './admissionsTestKit'

afterEach(cleanup)

const after: FamilyNote = {
  key: 'admissions-l1', kind: 'admissions', at: '2026-10-08T08:20:00Z', phase: 'after', author: '櫃台小美',
  note: '下週一前回覆', headline: '電話・聯絡到了', nextFollowUpAt: '2026-10-13T02:00:00Z',
}
const before: FamilyNote = {
  key: 'booking-n1', kind: 'booking', at: '2026-10-03T06:05:00Z', phase: 'before', author: '櫃台小美',
  note: '提醒參觀時間', headline: '', nextFollowUpAt: null,
}

describe('合併後的聯絡紀錄', () => {
  it('照傳進來的順序列；標參觀前／參觀後；參觀後有管道結果與排下次聯絡', async () => {
    const { wrapper } = await mountWith(FamilyContactNotes, { props: { notes: [after, before], logsFailed: false } })
    const items = wrapper.findAll('.family-notes__item')
    expect(items.map((item) => item.attributes('data-phase'))).toEqual(['after', 'before'])
    expect(items[0]!.text()).toContain('參觀後')
    expect(items[0]!.text()).toContain('電話・聯絡到了')
    expect(items[0]!.text()).toContain('排下次聯絡 2026/10/13 10:00')
    expect(items[1]!.text()).toContain('參觀前')
    expect(items[1]!.text()).not.toContain('排下次聯絡')
    expect(wrapper.text()).toContain('參觀前記在預約、參觀後記在招生，這裡一起列')
  })

  it('沒有紀錄時說明；參觀後讀不到時提示並能重新載入', async () => {
    const { wrapper } = await mountWith(FamilyContactNotes, { props: { notes: [], logsFailed: true } })
    expect(wrapper.text()).toContain('還沒有聯絡紀錄')
    expect(wrapper.text()).toContain('參觀後的聯絡紀錄讀不到')
    await button(wrapper, '重新載入')!.trigger('click')
    expect(wrapper.emitted('reload')).toHaveLength(1)
  })
})

describe('案件歷程合併招生事件', () => {
  const booking = [
    { id: 'h1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, before: null, after: null, reason: null, created_at: '2026-10-01T02:12:00Z' },
    { id: 'h2', event_type: 'completed', source: 'staff', actor_user_id: 'desk', actor_email: 'desk@example.invalid', actor_display_name: '櫃台小美', before: null, after: null, reason: null, created_at: '2026-10-06T02:35:00Z' },
  ]
  const recruitment = [
    { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, actor_user_id: 'desk', actor_name: 'desk@example.invalid', created_at: '2026-10-06T02:35:00Z' },
    { id: 'e2', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-14T01:30:00Z' },
  ]

  it('沒傳招生事件：跟改版前一樣，沒有來源小標', async () => {
    const { wrapper } = await mountWith(VisitHistoryTimeline, { props: { events: booking, staff: [] } })
    expect(wrapper.findAll('.timeline__item strong').map((el) => el.text())).toEqual(['標記已到場', '家長從官網送出'])
    expect(wrapper.find('.timeline__source').exists()).toBe(false)
  })

  it('有傳：新的在上、同時間招生在上，標來源，招生事件寫階段變化與操作者', async () => {
    const { wrapper } = await mountWith(VisitHistoryTimeline, { props: { events: booking, staff: [], recruitmentEvents: recruitment } })
    const items = wrapper.findAll('.timeline__item')
    expect(items.map((item) => item.get('strong').text())).toEqual(['加上預繳', '建立訪視（官網預約到場）', '標記已到場', '家長從官網送出'])
    expect(items.map((item) => item.get('.timeline__source').text())).toEqual(['招生', '招生', '預約', '預約'])
    expect(items[0]!.text()).toContain('已訪視 → 已預繳')
    expect(items[0]!.get('.timeline__actor').text()).toBe('櫃台小美')
    expect(items[1]!.get('.timeline__actor').text()).toBe('desk')
  })
})
```

> 若「家長從官網送出」與 `visitEventTitle` 對 `created` 的實際文字不同，以 `api/visitHistory.ts` 的 `visitEventTitle` 為準，改測試的期望字串，不要改實作。

- [ ] **Step 2：跑測試，確認失敗**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyNotesHistory.test.ts
```

預期：FAIL，找不到 `FamilyContactNotes.vue`；歷程那一組則因為沒有 `.timeline__source` 而失敗。

- [ ] **Step 3：寫 `FamilyContactNotes.vue`**

```vue
<script setup lang="ts">
import { formatDateTime } from '../../api/labels'
import type { FamilyNote } from '../../admissions/family'

// 家庭版面的聯絡紀錄（2026-10-05 家庭頁規格 5.4）：參觀前（預約）與參觀後（招生）合在一起，
// 順序由父層 familyNotes() 決定。新增一律用處理區的「記錄聯絡」，這裡沒有輸入框。
defineProps<{ notes: readonly FamilyNote[]; logsFailed: boolean }>()
const emit = defineEmits<{ reload: [] }>()
</script>

<template>
  <section class="family-notes">
    <div class="section__title">
      <h2>聯絡紀錄</h2>
      <span class="hint">參觀前記在預約、參觀後記在招生，這裡一起列</span>
    </div>
    <p v-if="logsFailed" class="hint family-notes__error">
      參觀後的聯絡紀錄讀不到。
      <el-button link type="primary" @click="emit('reload')">重新載入</el-button>
    </p>
    <ol v-if="notes.length" class="family-notes__list">
      <li v-for="item in notes" :key="item.key" class="family-notes__item" :data-phase="item.phase">
        <span class="family-notes__meta">
          <el-tag size="small" :type="item.phase === 'after' ? 'primary' : 'info'" effect="plain" round>
            {{ item.phase === 'after' ? '參觀後' : '參觀前' }}
          </el-tag>
          <strong v-if="item.headline" class="family-notes__headline">{{ item.headline }}</strong>
          <time class="family-notes__time num">{{ formatDateTime(item.at) }}</time>
          <span v-if="item.author" class="family-notes__author">{{ item.author }}</span>
        </span>
        <p v-if="item.note" class="family-notes__text">{{ item.note }}</p>
        <p v-if="item.nextFollowUpAt" class="family-notes__next num">排下次聯絡 {{ formatDateTime(item.nextFollowUpAt) }}</p>
      </li>
    </ol>
    <p v-else class="hint">還沒有聯絡紀錄。每次致電或傳訊後用「記錄聯絡」記一筆，同事接手時才知道談到哪裡。</p>
  </section>
</template>

<style scoped>
/* 同預約明細原本聯絡紀錄的排法（VisitDetailView 的 .notes），子元件拿不到父層 scoped 樣式，這裡另寫一份。 */
.family-notes__error {
  margin: 0 0 8px;
}

.family-notes__list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}

.family-notes__item {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.family-notes__item:first-child {
  border-top: 0;
  padding-top: 0;
}

.family-notes__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-bottom: 2px;
  font-size: var(--text-xs);
}

.family-notes__headline {
  color: var(--ink);
  font-size: var(--text-sm);
}

.family-notes__time {
  color: var(--ink-3);
}

.family-notes__author {
  color: var(--ink-2);
}

.family-notes__text {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.family-notes__next {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-size: var(--text-xs);
}
</style>
```

- [ ] **Step 4：擴充 `VisitHistoryTimeline.vue`**

把 `<script setup>` 整段換成：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { RecruitmentEvent, VisitHistoryOut } from '../api/types'
import { formatDateTime, type StaffPerson, staffEmail, staffOf } from '../api/labels'
import { visitEventActor, visitEventChanges, visitEventRelatedId, visitEventTitle } from '../api/visitHistory'
import { eventLabel } from '../admissions/constants'
import { familyHistory, personLabel, recruitmentEventChanges } from '../admissions/family'

// 案件歷程（規格 L299）：誰、什麼時候、做了什麼、前後差在哪、為什麼。
// 最新的在上面，跟聯絡紀錄同一個方向。
// 家庭版面（2026-10-05 家庭頁規格 5.5）另傳招生事件，合併後每列標「預約」或「招生」；沒傳時跟改版前一模一樣。
const props = defineProps<{
  events: readonly VisitHistoryOut[]
  staff: readonly (StaffPerson & { id: string })[]
  recruitmentEvents?: readonly RecruitmentEvent[]
}>()

interface Row {
  key: string
  at: string
  title: string
  actor: string
  actorEmail: string
  changes: string[]
  reason: string | null
  related: string | null
  source: '' | '預約' | '招生'
}

function bookingRow(event: VisitHistoryOut, source: Row['source']): Row {
  return {
    key: event.id,
    at: event.created_at,
    title: visitEventTitle(event),
    actor: visitEventActor(event),
    // 園方人員的名字滑過去看得到完整 Email（同前綴的同事靠這個分辨）。
    actorEmail: event.source === 'staff' ? staffEmail(staffOf(event, 'actor')) : '',
    changes: visitEventChanges(event, props.staff),
    reason: event.reason,
    related: visitEventRelatedId(event),
    source,
  }
}

function admissionsRow(event: RecruitmentEvent): Row {
  return {
    key: `admissions-${event.id}`,
    at: event.created_at,
    title: eventLabel(event.event_type, event.metadata_json),
    actor: personLabel(event.actor_name),
    actorEmail: event.actor_name?.includes('@') ? event.actor_name : '',
    changes: recruitmentEventChanges(event),
    reason: event.reason,
    related: null,
    source: '招生',
  }
}

const rows = computed<Row[]>(() => {
  if (!props.recruitmentEvents) return [...props.events].reverse().map((event) => bookingRow(event, ''))
  return familyHistory(props.events, props.recruitmentEvents).map((row) =>
    row.booking ? bookingRow(row.booking, '預約') : admissionsRow(row.admissions!),
  )
})
</script>
```

模板換成：

```vue
<template>
  <ol v-if="rows.length" class="timeline" aria-label="案件歷程">
    <li v-for="row in rows" :key="row.key" class="timeline__item">
      <div class="timeline__head">
        <strong>{{ row.title }}</strong>
        <span v-if="row.source" class="timeline__source">{{ row.source }}</span>
        <span v-if="row.actor" class="timeline__actor" :title="row.actorEmail || undefined">{{ row.actor }}</span>
        <time class="timeline__time num">{{ formatDateTime(row.at) }}</time>
      </div>
      <p v-for="line in row.changes" :key="line" class="timeline__change">{{ line }}</p>
      <p v-if="row.reason" class="timeline__reason">原因：{{ row.reason }}</p>
      <router-link v-if="row.related" :to="`/visit-requests/${row.related}`" class="timeline__link">查看關聯案件</router-link>
    </li>
  </ol>
  <p v-else class="hint">還沒有歷程紀錄。</p>
</template>
```

在 `<style scoped>` 的 `.timeline__actor {…}` 前面加：

```css
.timeline__source {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink-3);
  font-size: var(--text-xs);
}
```

- [ ] **Step 5：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyNotesHistory.test.ts src/__tests__/visitDetails.test.ts src/__tests__/admissionsVisitDetail.test.ts src/__tests__/ux20261005.test.ts
npm --prefix admin run typecheck
```

預期：全部 PASS。

- [ ] **Step 6：Commit**

```bash
git add admin/src/components/visit/FamilyContactNotes.vue admin/src/components/VisitHistoryTimeline.vue admin/src/__tests__/familyNotesHistory.test.ts
git commit -m "feat(admin): 家庭版面的合併聯絡紀錄，案件歷程可一起列招生事件

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6：`FamilyActions.vue`（家庭版面的處理區）

**Files:**
- Create: `admin/src/components/visit/FamilyActions.vue`
- Test: `admin/src/__tests__/familyActions.test.ts`

**Interfaces:**
- Consumes：`ContactLogDialog`（`target: ContactTarget | null`；emits `saved: [visit, log]`、`stale`）、`FollowUpDialog`（`target`、`campusKey`；emits `saved: [visit]`、`stale`）、`TransitionDialog`（`target: TransitionTarget | null`；emits `done: [visit]`、`stale`）；`updateFollowUp(id, { expected_version, follow_up_owner_id })`；`stageMeta`、`moveTargets`、`STAGE_LABELS`、`isStage`；`followUpText`、`isDue`、`isOpenStage`、`lastContactText`、`ownerLabel`；`isVersionConflict`、`apiErrorMessage`；`notifyError`、`notifyWarning`。
- Produces：`<FamilyActions :visit="RecruitmentVisit" :staff="readonly AdmissionsStaff[]" :latest="ContactLog | null" @changed="(visit) => …" @stale="() => …" @rebook="() => …" />`，根元素 class `family-actions`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/familyActions.test.ts`：

```ts
// 家庭版面的處理區（docs/specs/2026-10-05-visit-family-page-design.md 5.6；Review Focus 3、5）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import FamilyActions from '../components/visit/FamilyActions.vue'
import ContactLogDialog from '../components/admissions/ContactLogDialog.vue'
import FollowUpDialog from '../components/admissions/FollowUpDialog.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import { ApiError } from '../api/client'
import { STAGE_LABELS } from '../admissions/constants'
import { admissionsViewer, button, cleanup, hasButton, mockGet, mockPatch, mountWith, reception, visit } from './admissionsTestKit'

// 對話框打開時可能讀上次聯絡或名單：一律走 mock，不打真的 API。
beforeEach(() => { mockGet({}) })
afterEach(cleanup)

const staff = [{ id: 'desk', display_name: '櫃台小美', email: 'desk@example.invalid' }, { id: 'ca', display_name: null, email: 'ca@example.invalid' }]
const latest = {
  id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-08T08:20:00Z', channel: 'phone', reached: true, note: '下週回覆',
  next_follow_up_at: null, created_by: 'desk', created_by_name: '櫃台小美', created_at: '2026-10-08T08:21:00Z',
}
const mountActions = (record = visit(), user = undefined as never, last: unknown = latest) =>
  mountWith(FamilyActions, { props: { visit: record, staff, latest: last }, user })

async function menuItems() {
  document.body.querySelector<HTMLButtonElement>('.family-actions__move')!.click()
  await vi.waitFor(() => expect(document.body.querySelector('.family-move-menu .el-dropdown-menu__item')).not.toBeNull())
  return [...document.body.querySelectorAll<HTMLElement>('.family-move-menu .el-dropdown-menu__item')]
}

describe('摘要', () => {
  it('階段、下次聯絡（到期警示）、最近聯絡', async () => {
    const { wrapper } = await mountActions(visit({ follow_up_at: '2020-01-01T02:00:00Z', follow_up_owner_id: 'desk' }))
    const facts = wrapper.get('.family-actions__facts')
    expect(facts.text()).toContain('已訪視')
    expect(facts.get('.is-due').text()).toMatch(/^逾 \d+ 天$/)
    expect(facts.text()).toContain('10/08・電話・聯絡到了')
  })
  it('沒有參觀後聯絡寫「還沒聯絡過」；已註冊的下次聯絡寫破折號', async () => {
    const { wrapper } = await mountActions(visit({ stage: 'enrolled', enrolled: true }), undefined as never, null)
    expect(wrapper.get('.family-actions__facts').text()).toContain('還沒聯絡過')
    expect(wrapper.get('.family-actions__next').text()).toBe('—')
  })
})

describe('按鈕與權限', () => {
  it('能寫入：記錄聯絡帶齊聯絡人電話年級；儲存往上傳', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '記錄聯絡')!.trigger('click')
    const dialog = wrapper.getComponent(ContactLogDialog)
    expect(dialog.props('target')).toMatchObject({ id: 'v-1', version: 1, child_name: '王小安', stage: 'visited', grade: '小班', contact_name: '王媽媽', phone: '0912345678' })
    dialog.vm.$emit('saved', visit({ version: 2 }), latest)
    expect(wrapper.emitted('changed')?.[0]?.[0]).toMatchObject({ version: 2 })
  })

  it('排下次聯絡／改期：沒排寫「排下次聯絡」，有排寫「改期／負責人」', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '排下次聯絡')!.trigger('click')
    expect(wrapper.getComponent(FollowUpDialog).props()).toMatchObject({ modelValue: true, campusKey: 'yihua' })
    cleanup()
    const scheduled = await mountActions(visit({ follow_up_at: '2099-01-01T02:00:00Z' }))
    expect(hasButton(scheduled.wrapper, '改期／負責人')).toBe(true)
  })

  it('移到…：選項照轉換規則與權限；選了開確認框', async () => {
    const { wrapper } = await mountActions(visit({ stage: 'deposited', has_deposit: true }))
    const items = await menuItems()
    expect(items.map((item) => item.textContent?.trim())).toEqual(['visited', 'enrolled', 'withdrawn'].map((stage) => STAGE_LABELS[stage as 'visited']))
    items.find((item) => item.textContent?.trim() === STAGE_LABELS.enrolled)!.click()
    await flushPromises()
    expect(wrapper.getComponent(TransitionDialog).props('target')).toMatchObject({ from: 'deposited', to: 'enrolled', card: { id: 'v-1' } })
  })

  it('櫃台（沒有 admissions.convert）在已預繳看不到「已註冊」', async () => {
    await mountActions(visit({ stage: 'deposited', has_deposit: true }), reception() as never)
    const items = await menuItems()
    expect(items.map((item) => item.textContent?.trim())).toEqual([STAGE_LABELS.visited, STAGE_LABELS.withdrawn])
  })

  it('只能看招生：沒有任何按鈕，負責人是文字', async () => {
    const { wrapper } = await mountActions(visit({ follow_up_owner_id: 'desk' }), admissionsViewer() as never)
    for (const label of ['記錄聯絡', '排下次聯絡']) expect(hasButton(wrapper, label)).toBe(false)
    expect(wrapper.find('.family-actions__move').exists()).toBe(false)
    expect(wrapper.find('.family-actions__owner .el-select').exists()).toBe(false)
    expect(wrapper.get('.family-actions__owner').text()).toContain('櫃台小美')
  })

  it('已匿名化：唯讀（Review Focus 3）', async () => {
    const { wrapper } = await mountActions(visit({ anonymized_at: '2026-10-01T00:00:00Z', stage: 'deposited' }))
    expect(hasButton(wrapper, '記錄聯絡')).toBe(false)
    expect(wrapper.find('.family-actions__move').exists()).toBe(false)
    expect(wrapper.find('.family-actions__owner .el-select').exists()).toBe(false)
  })

  it('重新預約往上傳', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '重新預約（另建新案）')!.trigger('click')
    expect(wrapper.emitted('rebook')).toHaveLength(1)
  })
})

describe('負責人', () => {
  it('改負責人送版本與新負責人，成功往上傳', async () => {
    const patch = mockPatch({ '/admin/admissions/records/v-1/follow-up': visit({ follow_up_owner_id: 'ca', version: 2 }) })
    const { wrapper } = await mountActions(visit({ follow_up_owner_id: 'desk' }))
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('change', 'ca')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1/follow-up', { expected_version: 1, follow_up_owner_id: 'ca' })
    expect(wrapper.emitted('changed')?.[0]?.[0]).toMatchObject({ follow_up_owner_id: 'ca' })
  })

  it('別人剛改過（409）：提示並要求重讀，不往上傳舊資料（Review Focus 5）', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockPatch({ '/admin/admissions/records/v-1/follow-up': () => { throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT' }) } })
    const { wrapper } = await mountActions(visit({ follow_up_owner_id: 'desk' }))
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('change', 'ca')
    await flushPromises()
    expect(warning).toHaveBeenCalled()
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('記錄聯絡對話框開著時重讀到新版本：交回新版本（內容保留）', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '記錄聯絡')!.trigger('click')
    await wrapper.setProps({ visit: visit({ version: 5, stage: 'deposited' }) })
    expect(wrapper.getComponent(ContactLogDialog).props('target')).toMatchObject({ version: 5, stage: 'deposited' })
  })
})
```

> `notifyWarning` 內部是否呼叫 `ElMessage.warning`：先看 `composables/notify.ts`。如果它用的是 `ElNotification`，把 409 測試的 spy 換成 `vi.spyOn(notify, 'notifyWarning')`（`import * as notify from '../composables/notify'`）。
> `ApiError` 的建構參數照 `admissionsVisitDetail.test.ts` 的用法（`new ApiError(409, { code: … })`）；`isVersionConflict` 認的是結尾 `_VERSION_CONFLICT` 的 code。

- [ ] **Step 2：跑測試，確認失敗**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyActions.test.ts
```

預期：FAIL，找不到 `FamilyActions.vue`。

- [ ] **Step 3：實作**

`admin/src/components/visit/FamilyActions.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { updateFollowUp } from '../../api/admissions'
import { apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsStaff, ContactLog, RecruitmentVisit } from '../../api/types'
import { STAGE_LABELS, isStage, moveTargets, stageMeta, type Stage, type TransitionTarget } from '../../admissions/constants'
import { followUpText, isDue, isOpenStage, lastContactText, ownerLabel } from '../../admissions/followUp'
import { notifyError, notifyWarning } from '../../composables/notify'
import { usePermissions } from '../../composables/usePermissions'
import StatusTag from '../StatusTag.vue'
import ContactLogDialog, { type ContactTarget } from '../admissions/ContactLogDialog.vue'
import FollowUpDialog, { type FollowUpTarget } from '../admissions/FollowUpDialog.vue'
import TransitionDialog from '../admissions/TransitionDialog.vue'

// 預約明細家庭版面的處理區（2026-10-05 家庭頁規格 5.6）：招生階段、下次聯絡、最近聯絡；
// 記錄聯絡／排下次聯絡／移到…（同看板與歷程抽屜的對話框與權限）；招生負責人；重新預約。
const props = defineProps<{ visit: RecruitmentVisit; staff: readonly AdmissionsStaff[]; latest: ContactLog | null }>()
const emit = defineEmits<{ changed: [visit: RecruitmentVisit]; stale: []; rebook: [] }>()

const { can } = usePermissions()
const editable = computed(() => !props.visit.anonymized_at && can('admissions.write'))
const tracking = computed(() => isOpenStage(props.visit.stage))
const ownerEditable = computed(() => editable.value && tracking.value)
const moveOptions = computed<Stage[]>(() =>
  props.visit.anonymized_at || !isStage(props.visit.stage) ? [] : moveTargets(props.visit.stage, can),
)
const ownerMissing = computed(() => Boolean(props.visit.follow_up_owner_id) && !props.staff.some((person) => person.id === props.visit.follow_up_owner_id))

// ---- 記錄聯絡、排下次聯絡、移到… ----
const contactOpen = ref(false)
const contactTarget = ref<ContactTarget | null>(null)
const followUpOpen = ref(false)
const followUpTarget = ref<FollowUpTarget | null>(null)
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function openContact() {
  const v = props.visit
  contactTarget.value = { id: v.id, version: v.version, child_name: v.child_name, stage: v.stage, grade: v.grade, contact_name: v.contact_name, phone: v.phone }
  contactOpen.value = true
}

function openFollowUp() {
  const v = props.visit
  followUpTarget.value = { id: v.id, version: v.version, child_name: v.child_name, stage: v.stage, follow_up_at: v.follow_up_at ?? null, follow_up_owner_id: v.follow_up_owner_id ?? null }
  followUpOpen.value = true
}

function openTransition(to: Stage) {
  const v = props.visit
  if (!isStage(v.stage)) return
  transitionTarget.value = { card: v, from: v.stage, to }
  transitionOpen.value = true
}

// 對話框遇到 409 時父層重讀；還開著的記錄聯絡對話框換成新版本（內容保留，同歷程抽屜）。
watch(() => props.visit, (v) => {
  if (contactOpen.value && contactTarget.value?.id === v.id) contactTarget.value = { ...contactTarget.value, version: v.version, stage: v.stage }
})

// ---- 招生負責人（只改負責人，下次聯絡不動）----
const savingOwner = ref(false)
async function setOwner(ownerId: string | null) {
  if (savingOwner.value || ownerId === (props.visit.follow_up_owner_id ?? null)) return
  savingOwner.value = true
  try {
    emit('changed', await updateFollowUp(props.visit.id, { expected_version: props.visit.version, follow_up_owner_id: ownerId }))
  } catch (err) {
    if (isVersionConflict(err)) {
      notifyWarning('這筆招生訪視剛被其他人修改，已載入最新的內容，請確認後再改負責人')
      emit('stale')
    } else {
      notifyError(apiErrorMessage(err, '改負責人失敗'))
    }
  } finally {
    savingOwner.value = false
  }
}
</script>

<template>
  <div class="family-actions">
    <dl class="family-actions__facts">
      <div><dt>招生階段</dt><dd><StatusTag :meta="stageMeta(visit)" /></dd></div>
      <div>
        <dt>下次聯絡</dt>
        <dd class="num family-actions__next" :class="{ 'is-due': tracking && isDue(visit.follow_up_at) }">{{ tracking ? followUpText(visit.follow_up_at) : '—' }}</dd>
      </div>
      <div>
        <dt>最近聯絡</dt>
        <dd class="num">{{ latest ? lastContactText(latest.contacted_at, latest.channel, latest.reached) : lastContactText(null) }}</dd>
      </div>
    </dl>
    <el-button v-if="editable" type="primary" class="family-actions__record" @click="openContact">記錄聯絡</el-button>
    <div v-if="(editable && tracking) || moveOptions.length" class="family-actions__row">
      <el-button v-if="editable && tracking" @click="openFollowUp">{{ visit.follow_up_at ? '改期／負責人' : '排下次聯絡' }}</el-button>
      <el-dropdown v-if="moveOptions.length" trigger="click" :persistent="false" popper-class="family-move-menu" @command="(to: Stage) => openTransition(to)">
        <el-button class="family-actions__move">移到…<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="to in moveOptions" :key="to" :command="to">{{ STAGE_LABELS[to] }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div class="family-actions__owner">
      <label for="family-owner">負責人</label>
      <el-select
        v-if="ownerEditable"
        id="family-owner"
        :model-value="visit.follow_up_owner_id ?? ''"
        :loading="savingOwner"
        :disabled="savingOwner"
        placeholder="未指派"
        clearable
        style="width: 100%"
        @change="(value: string) => setOwner(value || null)"
      >
        <el-option v-if="ownerMissing" :value="visit.follow_up_owner_id!" :label="ownerLabel(visit.follow_up_owner_id, staff)" disabled />
        <el-option v-for="person in staff" :key="person.id" :value="person.id" :label="person.display_name || person.email" />
      </el-select>
      <span v-else>{{ ownerLabel(visit.follow_up_owner_id, staff) }}</span>
    </div>
    <div class="family-actions__rebook">
      <span class="hint">家長想再約別的時間？</span>
      <el-button link type="primary" @click="emit('rebook')">重新預約（另建新案）</el-button>
    </div>

    <ContactLogDialog v-model="contactOpen" :target="contactTarget" @saved="(saved: RecruitmentVisit) => emit('changed', saved)" @stale="emit('stale')" />
    <FollowUpDialog v-model="followUpOpen" :target="followUpTarget" :campus-key="visit.campus_key" @saved="(saved: RecruitmentVisit) => emit('changed', saved)" @stale="emit('stale')" />
    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="(done: RecruitmentVisit) => emit('changed', done)" @stale="emit('stale')" />
  </div>
</template>

<style scoped>
.family-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.family-actions__facts {
  display: grid;
  gap: 6px;
  margin: 0;
  font-size: var(--text-sm);
}

.family-actions__facts > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.family-actions__facts dt {
  color: var(--ink-3);
}

.family-actions__facts dd {
  margin: 0;
  color: var(--ink);
}

.family-actions__facts .is-due {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}

.family-actions__record {
  width: 100%;
}

.family-actions__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 8px;
}

.family-actions__row .el-button,
.family-actions__row .el-dropdown,
.family-actions__row .family-actions__move {
  width: 100%;
  margin-left: 0;
}

.family-actions__owner,
.family-actions__rebook {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
}

.family-actions__owner label {
  color: var(--ink-2);
}

.family-actions__rebook .el-button {
  align-self: flex-start;
}
</style>
```

- [ ] **Step 4：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyActions.test.ts src/__tests__/ux20261005.test.ts src/__tests__/crossUx20261002.test.ts
npm --prefix admin run typecheck
```

預期：PASS。

- [ ] **Step 5：Commit**

```bash
git add admin/src/components/visit/FamilyActions.vue admin/src/__tests__/familyActions.test.ts
git commit -m "feat(admin): 預約明細家庭版面的處理區（記錄聯絡、排聯絡、移到…、招生負責人）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7：`VisitDetailView` 組裝家庭版面

**Files:**
- Modify: `admin/src/composables/useFamilyAdmissions.ts`（加讀取家庭版面需要的資料）
- Modify: `admin/src/views/VisitDetailView.vue`
- Modify: `admin/src/__tests__/admissionsVisitDetail.test.ts`（`預約明細的招生訪視連結` 第一、二個案例；`參觀後追蹤區塊` 整個 describe）
- Modify: `admin/src/__tests__/ux20261005.test.ts`（`手機版：聯絡紀錄…` 那個案例）
- Create: `admin/src/__tests__/visitFamilyPage.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `familyNotes`、`familyLastHandled`、`latestContact`、`arrivedAt`、`arrivedLabel`、`stageMeta`；Task 4–6 的三個元件；Task 5 的 `VisitHistoryTimeline` `recruitmentEvents` prop；`listEvents`、`listContactLogs`、`listAdmissionsStaff`、`getOptions`。
- Produces：composable 多回 `isFamily: ComputedRef<boolean>`、`events: Ref<RecruitmentEvent[]>`、`contactLogs: Ref<ContactLog[]>`、`staff: Ref<AdmissionsStaff[]>`、`options: Ref<AdmissionsOptions | null>`、`extrasFailed: Ref<{ events: boolean; logs: boolean }>`、`lookupFailed: Ref<boolean>`、`loadExtras(): Promise<void>`、`replaceVisit(visit: RecruitmentVisit): void`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/visitFamilyPage.test.ts`：

```ts
// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md 第 5 節；Review Focus 1、2、3）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import { ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { writeVisitNoteDraft } from '../composables/visitNoteDraft'
import { testUser } from './fixtures'
import { button, cleanup, deferred, hasButton, mockGet, mockPost, pathsTo, superAdmin, visit, VR_ID, VR_ID_2, wrappers } from './admissionsTestKit'

afterEach(cleanup)

const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const detail = (changes: Record<string, unknown> = {}) => ({
  id: VR_ID, campus_key: 'yihua', status: 'completed', parent_name: '陳媽媽', phone: '0911000111', child_name: '陳小寶',
  child_birthdate: '2023-03-02', email: 'chen@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: 'desk', confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web', pending_reschedule: null,
  access_link: null, version: 1,
  history: [
    { id: 'h1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, before: null, after: null, reason: null, created_at: '2026-09-22T00:00:00Z' },
    { id: 'h2', event_type: 'completed', source: 'staff', actor_user_id: 'desk', actor_email: 'desk@example.invalid', actor_display_name: '櫃台小美', before: null, after: null, reason: null, created_at: '2026-10-06T02:35:00Z' },
  ],
  ...changes,
})
const linked = (changes: Record<string, unknown> = {}) =>
  visit({ visit_request_id: VR_ID, has_visit_request: true, visit_date: '2026-10-06', phone: '0912345678', english_name: null, father_occupation: null, mother_occupation: null, ...changes })
const staffList = [{ id: 'desk', display_name: '櫃台小美', email: 'desk@example.invalid' }]
const visitStaff = [{ id: 'desk', email: 'desk@example.invalid', display_name: '櫃台小美', role: 'reception', is_active: true, campus_keys: ['yihua'] }]

function mockFamily(options: {
  data?: Record<string, unknown>
  records?: unknown[] | (() => unknown)
  events?: unknown
  logs?: unknown
  notes?: unknown[]
  extra?: Record<string, unknown>
} = {}) {
  return mockGet({
    [`/admin/visit-requests/${VR_ID}/contact-notes`]: options.notes ?? [
      { id: 'n1', note: '提醒參觀時間', created_at: '2026-10-03T06:05:00Z', created_by: 'desk', created_by_display_name: '櫃台小美', created_by_email: 'desk@example.invalid' },
    ],
    [`/admin/visit-requests/${VR_ID}`]: () => options.data ?? detail(),
    '/admin/visit-requests?': [],
    '/admin/slots': [],
    '/admin/visit-staff': visitStaff,
    '/admin/booking-config': {},
    '/admin/admissions/records/v-1/events': options.events ?? [
      { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-06T02:35:00Z' },
    ],
    '/admin/admissions/records/v-1/contact-logs': options.logs ?? [
      { id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-08T08:20:00Z', channel: 'phone', reached: true, note: '下週一前回覆', next_follow_up_at: null, created_by: 'desk', created_by_name: '櫃台小美', created_at: '2026-10-08T08:21:00Z' },
    ],
    '/admin/admissions/records': options.records ?? [linked()],
    '/admin/admissions/staff': staffList,
    ...options.extra,
  })
}

async function mountDetail(user: UserOut = superAdmin(), back?: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
      { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
    ],
  })
  // memory history 不記 state.back：要測「從哪裡來」就直接給（VisitDetailView 讀 router.options.history.state）。
  if (back) Object.defineProperty(router.options.history, 'state', { configurable: true, get: () => ({ back }) })
  await router.push(`/visit-requests/${VR_ID}`)
  await router.isReady()
  const { mount } = await import('@vue/test-utils')
  const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('家庭版面（5.1–5.7）', () => {
  it('頁首是招生階段與到場日、承辦人小字；撥號用招生電話', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
    expect(wrapper.get('.detail__status').text()).toContain('10/06 到場')
    expect(wrapper.get('.detail__head').text()).toContain('・預約承辦 櫃台小美')
    expect(wrapper.get('.detail__call').attributes('href')).toBe('tel:0912345678')
  })

  it('招生資料在上、預約資料收合；展開後看得到家長填的內容', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(true)
    const booking = wrapper.get('.detail__data')
    expect(booking.get('h2').text()).toBe('家長預約時填寫的資料')
    expect(booking.find('.el-descriptions').isVisible()).toBe(false)
    await button(booking, '展開')!.trigger('click')
    expect(booking.find('.el-descriptions').isVisible()).toBe(true)
    expect(booking.text()).toContain('chen@example.org')
  })

  it('聯絡紀錄合併參觀前後；沒有輸入框；歷程合併招生事件', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.findAll('.family-notes__item').map((item) => item.attributes('data-phase'))).toEqual(['after', 'before'])
    expect(wrapper.find('.notes__form').exists()).toBe(false)
    const titles = wrapper.findAll('.timeline__item strong').map((el) => el.text())
    expect(titles).toEqual(['建立訪視（官網預約到場）', '標記已到場', '家長從官網送出'])
  })

  it('處理區換成招生動作；舊的參觀後追蹤、招生入學連結、承辦人下拉都不在了', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.findComponent(FamilyActions).exists()).toBe(true)
    expect(hasButton(wrapper, '記錄聯絡')).toBe(true)
    expect(wrapper.find('.detail__after').exists()).toBe(false)
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
    expect(wrapper.find('#visit-assignee').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('在招生入學查看')
  })

  it('最後處理含參觀後聯絡', async () => {
    mockFamily()
    const { wrapper } = await mountDetail(testUser('super_admin', { id: 'desk' }))
    expect(wrapper.get('.detail__handled').text()).toContain('最後處理：你・2026/10/08 16:21・記錄聯絡')
  })

  it('處理區往上傳變更：換掉訪視並重讀事件與聯絡紀錄', async () => {
    const get = mockFamily()
    const { wrapper } = await mountDetail()
    const before = pathsTo(get, '/admin/admissions/records/v-1/contact-logs').length
    wrapper.getComponent(FamilyActions).vm.$emit('changed', linked({ stage: 'deposited', has_deposit: true, version: 2 }))
    await flushPromises()
    expect(wrapper.get('.detail__status').text()).toContain('已預繳')
    expect(pathsTo(get, '/admin/admissions/records/v-1/contact-logs').length).toBe(before + 1)
  })
})

describe('不是家庭版面的情況維持原樣（5.9）', () => {
  it('招生開關關閉：沒有招生區塊，聯絡紀錄輸入框還在', async () => {
    mockFamily({ records: () => { throw new ApiError(404, { code: 'NOT_FOUND' }) } })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(false)
    expect(wrapper.find('.notes__form').exists()).toBe(true)
    expect(wrapper.get('.detail__data h2').text()).toBe('家長填寫的資料')
  })

  it('沒有 admissions.read：不查招生 API，畫面同改版前', async () => {
    const get = mockFamily()
    const { wrapper } = await mountDetail(testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['booking.read', 'booking.handle'] }))
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
    expect(wrapper.find('.family-data').exists()).toBe(false)
  })

  it('已到場但沒有招生訪視：補建後直接切成家庭版面', async () => {
    let records: unknown[] = []
    mockFamily({ records: () => records })
    mockPost({ [`/admin/admissions/from-visit-request/${VR_ID}`]: () => { records = [linked()]; return linked() } })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(false)
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.family-data').exists()).toBe(true)
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
  })

  it('招生訪視讀取失敗（非 404）：提示並能重新載入', async () => {
    let fail = true
    mockFamily({ records: () => { if (fail) throw new ApiError(500, { code: 'INTERNAL' }); return [linked()] } })
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__admissions').text()).toContain('招生資料讀不到')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.family-data').exists()).toBe(true)
  })
})

describe('Review Focus', () => {
  it('1：家庭版面不因看不到的草稿擋離開', async () => {
    writeVisitNoteDraft(VR_ID, '打到一半的參觀前紀錄')
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    mockFamily()
    const { router } = await mountDetail()
    await router.push('/admissions')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/admissions')
    writeVisitNoteDraft(VR_ID, '')
  })

  it('2：切到下一筆後，前一筆較晚回來的招生事件不會出現', async () => {
    const slow = deferred<unknown[]>()
    mockFamily({
      events: () => slow.promise,
      extra: {
        [`/admin/visit-requests/${VR_ID_2}/contact-notes`]: [],
        [`/admin/visit-requests/${VR_ID_2}`]: () => detail({ id: VR_ID_2, status: 'confirmed', history: [] }),
      },
    })
    const { wrapper, router } = await mountDetail()
    await router.push(`/visit-requests/${VR_ID_2}`)
    await flushPromises()
    slow.resolve([{ id: 'late', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-14T01:30:00Z' }])
    await flushPromises()
    expect(wrapper.text()).not.toContain('加上預繳')
    expect(wrapper.find('.family-data').exists()).toBe(false)
  })

  it('3：已匿名化的招生訪視：唯讀，撥號退回預約電話', async () => {
    mockFamily({ records: [linked({ anonymized_at: '2026-10-01T00:00:00Z', phone: '0900000000' })] })
    const { wrapper } = await mountDetail()
    expect(hasButton(wrapper, '記錄聯絡')).toBe(false)
    expect(hasButton(wrapper, '編輯')).toBe(false)
    expect(wrapper.get('.detail__call').attributes('href')).toBe('tel:0911000111')
  })
})
```

> 若 `button(booking, '展開')` 找不到：`button()` 比對的是完整按鈕文字，確認模板只放「展開」「收起」兩個字。`.detail__call` 是 `<el-button tag="a">`，`href` 在根元素上。

- [ ] **Step 2：跑測試，確認失敗**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/visitFamilyPage.test.ts
```

預期：大部分 FAIL（找不到 `.family-data`、`.detail__status` 不是招生階段…）。

- [ ] **Step 3：擴充 composable**

`admin/src/composables/useFamilyAdmissions.ts`：

1. import 改成：

```ts
import { computed, ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createFromVisitRequest, getOptions, listAdmissionsStaff, listContactLogs, listEvents, listRecords } from '../api/admissions'
import { ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { AdmissionsOptions, AdmissionsStaff, ContactLog, RecruitmentEvent, RecruitmentVisit, VisitRequestFullOut } from '../api/types'
```

2. 在 `const requests = useRequestSequence()` 下面加：

```ts
  // 家庭版面（2026-10-05 家庭頁規格 5.1）：已到場、招生可用、查得到招生訪視、有 admissions.read。
  const isFamily = computed(() => detail.value?.status === 'completed' && available.value === 'yes' && visit.value !== null && canRead.value)
  const lookupFailed = ref(false)
  const events = ref<RecruitmentEvent[]>([])
  const contactLogs = ref<ContactLog[]>([])
  const staff = ref<AdmissionsStaff[]>([])
  const options = ref<AdmissionsOptions | null>(null)
  const extrasFailed = ref({ events: false, logs: false })
  const extraRequests = useRequestSequence()
```

3. `fetchVisit()`：在 `available.value = 'unknown'` 下一行加 `lookupFailed.value = false`；`catch` 區塊改成：

```ts
    } catch (err) {
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      // 404：招生入學未啟用，整區不顯示；其他錯誤在已到場的案件上提示讀不到、可以重讀（家庭頁規格 5.9）。
      if (err instanceof ApiError && err.status === 404) available.value = 'no'
      else lookupFailed.value = true
    }
```

4. 在 `async function create()` 前面加：

```ts
  /** 家庭版面要的招生事件、參觀後聯絡、負責人名單、選項（家庭頁規格 5.4–5.6）。各自失敗互不影響。 */
  async function loadExtras() {
    const current = visit.value
    const request = extraRequests.begin()
    if (!current) return
    const [eventRows, logRows, staffRows, optionRows] = await Promise.allSettled([
      listEvents(current.id),
      listContactLogs(current.id),
      listAdmissionsStaff(current.campus_key),
      getOptions(current.campus_key),
    ])
    if (!extraRequests.isCurrent(request) || visit.value?.id !== current.id) return
    events.value = eventRows.status === 'fulfilled' && Array.isArray(eventRows.value) ? eventRows.value : []
    contactLogs.value = logRows.status === 'fulfilled' && Array.isArray(logRows.value) ? logRows.value : []
    staff.value = staffRows.status === 'fulfilled' && Array.isArray(staffRows.value) ? staffRows.value : []
    options.value = optionRows.status === 'fulfilled' ? optionRows.value : null
    extrasFailed.value = { events: eventRows.status === 'rejected', logs: logRows.status === 'rejected' }
  }

  /** 對話框存檔回傳的新版本；換了一筆（例如下一筆）就不套用。 */
  function replaceVisit(next: RecruitmentVisit) {
    if (visit.value?.id === next.id) visit.value = next
  }

  // 進入家庭版面、或換了一筆招生訪視才讀；離開家庭版面就清掉，下一筆不會看到上一筆的紀錄。
  watch(() => (isFamily.value ? (visit.value?.id ?? '') : ''), (visitId) => {
    if (visitId) {
      void loadExtras()
      return
    }
    extraRequests.begin()
    events.value = []
    contactLogs.value = []
    extrasFailed.value = { events: false, logs: false }
  })
```

5. return 改成：

```ts
  return {
    canRead, canWrite, visit, available, creating, lookup, settled, create,
    isFamily, lookupFailed, events, contactLogs, staff, options, extrasFailed, loadExtras, replaceVisit,
  }
```

- [ ] **Step 4：`VisitDetailView.vue` 的 script**

1. import 調整：
   - 加 `import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'`、`import FamilyActions from '../components/visit/FamilyActions.vue'`、`import FamilyContactNotes from '../components/visit/FamilyContactNotes.vue'`。
   - 加 `import { arrivedAt, arrivedLabel, familyLastHandled, familyNotes, latestContact } from '../admissions/family'`。
   - `import { stageLabel } from '../admissions/constants'` 改成 `import { stageMeta } from '../admissions/constants'`。
   - 刪掉 `import { followUpText, isDue, isOpenStage, lastContactText } from '../admissions/followUp'`、`import ContactLogDialog, …`、`import FollowUpDialog, …`。
   - `import type { … } from '../api/types'` 保留 `RecruitmentVisit`（`onFamilyChanged` 用）。

2. 緊接在 Task 3 加的 `const createAdmissionsVisit = family.create` 下面加：

```ts
const { isFamily, events: familyEvents, contactLogs: familyLogs, staff: familyStaff, options: familyOptions, extrasFailed, lookupFailed } = family
// 家庭版面時的招生訪視；不是家庭版面就是 null（模板用它切換版面）。
const familyVisit = computed(() => (isFamily.value ? admissionsVisit.value : null))
// 家長預約時填的資料在家庭版面收合（家庭頁規格 5.3）；換案件時收回去。
const bookingDataOpen = ref(false)
```

3. `handled` 改成：

```ts
const handled = computed(() => {
  const current = detail.value
  if (!current) return null
  const selfId = authStore.user?.id ?? null
  return familyVisit.value
    ? familyLastHandled(current.history ?? [], familyEvents.value, familyLogs.value, selfId)
    : lastHandled(current.history ?? [], selfId)
})
```

   （`handled` 要移到 `familyVisit` 定義**之後**，否則會有暫時性死區。）

4. `noteDirty` 改成（Review Focus 1）：

```ts
// 家庭版面沒有文字框：看不到的草稿不擋離開（家庭頁規格 Review Focus 1）。
const noteDirty = computed(() => canHandle.value && !familyVisit.value && newNote.value.trim() !== '')
```

5. 刪掉整段 `// ---- 參觀後追蹤（2026-10-04 規格 7.6）----`：`followUpVisit`、`followUpEditable`、`followUpOwnerName`、`contactLogOpen`、`contactLogTarget`、`followUpDialogOpen`、`followUpDialogTarget`、`openContactLog`、`openFollowUpDialog`、`onFollowUpSaved`、`onFollowUpStale`。同時刪掉 `const admissionsLink = computed(...)`。

6. 新增：

```ts
// ---- 家庭版面（2026-10-05 家庭頁規格第 5 節）----
const familyNoteList = computed(() => familyNotes(notes.value, familyLogs.value, arrivedAt(detail.value?.history ?? [])))
const latestFamilyContact = computed(() => latestContact(familyLogs.value))
// 撥號：園方改過以招生那筆為準；匿名化的不撥（Review Focus 3）。
const callPhone = computed(() => {
  const v = familyVisit.value
  return v?.phone && !v.anonymized_at ? v.phone : (detail.value?.phone ?? '')
})
const bookingDataTitle = computed(() => {
  if (familyVisit.value) return isWebCase.value ? '家長預約時填寫的資料' : '補登時的案件資料'
  return isWebCase.value ? '家長填寫的資料' : '案件資料'
})

function onFamilyChanged(next: RecruitmentVisit) {
  family.replaceVisit(next)
  void family.loadExtras()
}
```

   （`isWebCase` 定義在檔尾，computed 是用到時才算，所以沒問題。）

7. `watch(id, () => { … })` 裡加一行 `bookingDataOpen.value = false`。

8. `notes__untracked` 的文字原本是 `{{ followUpVisit ? '…' : '已到場或已取消的案件不會列入到期待追蹤。' }}`，改成固定文字 `已到場或已取消的案件不會列入到期待追蹤。`。

- [ ] **Step 5：`VisitDetailView.vue` 的模板**

1. 頁首狀態（搜尋 `<div v-if="statusDisplay" class="detail__status">`），前面加一個分支：

```vue
        <div v-if="familyVisit" class="detail__status">
          <StatusTag :meta="stageMeta(familyVisit)" size="large" />
          <span class="detail__status-sub num">{{ arrivedLabel(familyVisit.visit_date) }}</span>
        </div>
        <div v-else-if="statusDisplay" class="detail__status">
```

   （原本的 `<div v-if="statusDisplay" …>` 改成上面最後一行的 `v-else-if`，內容不動。）

2. 頁首第一行小字（`官網送出' }}<template v-if="detail.created_by">…</template>` 那個 `<p class="hint">`），在 `</p>` 前加：

```vue
<template v-if="familyVisit && detail.assigned_staff_id">・預約承辦 {{ staffLabelById(detail.assigned_staff_id, staff) }}</template>
```

3. 撥號鈕：`:href="`tel:${detail.phone}`"` 改成 `:href="`tel:${callPhone}`"`；文字 `撥電話給家長 {{ detail.phone }}` 改成 `撥電話給家長 {{ callPhone }}`。

4. 主欄最前面（`<div class="detail__main">` 的下一行）加：

```vue
          <FamilyAdmissionsData
            v-if="familyVisit"
            :visit="familyVisit"
            :options="familyOptions"
            :editable="canCreateAdmissions"
            @saved="family.replaceVisit"
            @stale="family.lookup"
          />
```

5. 預約資料面板（`<div class="panel detail__data">`）：
   - 標題列 `<div class="panel__head"><h2>{{ isWebCase ? '家長填寫的資料' : '案件資料' }}</h2></div>`（一整行）換成：

```vue
            <div class="panel__head">
              <h2>{{ bookingDataTitle }}</h2>
              <el-button
                v-if="familyVisit"
                link
                type="primary"
                :aria-expanded="bookingDataOpen ? 'true' : 'false'"
                aria-controls="visit-booking-data"
                @click="bookingDataOpen = !bookingDataOpen"
              >{{ bookingDataOpen ? '收起' : '展開' }}</el-button>
            </div>
```

   - `<el-descriptions :column="1" border label-width="128" class="detail__desc">` 加上 `v-show="!familyVisit || bookingDataOpen"` 與 `id="visit-booking-data"`。

6. 刪掉整個 `<section v-if="followUpVisit" class="section detail__after">…</section>`。

7. 聯絡紀錄：`<section class="section detail__notes">` 改成 `<section v-if="!familyVisit" class="section detail__notes">`，並在這個 section 的 `</section>` 後面加：

```vue
          <FamilyContactNotes
            v-else
            class="section detail__notes"
            :notes="familyNoteList"
            :logs-failed="extrasFailed.logs"
            @reload="family.loadExtras"
          />
```

8. 案件歷程：

```vue
            <VisitHistoryTimeline :events="detail.history ?? []" :staff="staff" :recruitment-events="familyVisit ? familyEvents : undefined" />
            <p v-if="familyVisit && extrasFailed.events" class="hint">
              招生的歷程讀不到。<el-button link type="primary" @click="family.loadExtras">重新載入</el-button>
            </p>
```

9. 處理區：在 `<template v-else>`（內容是「這筆案件已結案。家長想再約…」）**前面**加：

```vue
              <FamilyActions
                v-else-if="familyVisit"
                :visit="familyVisit"
                :staff="familyStaff"
                :latest="latestFamilyContact"
                @changed="onFamilyChanged"
                @stale="family.lookup"
                @rebook="rebookOpen = true"
              />
```

10. 招生訪視區塊（`class="detail__admissions"`）整個換成：

```vue
            <div
              v-if="canReadAdmissions && !familyVisit && detail.status === 'completed' && (admissionsAvailable === 'yes' || lookupFailed)"
              class="detail__admissions"
            >
              <span class="detail__admissions-label">招生訪視</span>
              <template v-if="lookupFailed">
                <span class="hint">招生資料讀不到。</span>
                <el-button size="small" :disabled="busy" @click="family.lookup">重新載入</el-button>
              </template>
              <template v-else-if="canCreateAdmissions">
                <span class="hint">已到場，但還沒有招生訪視。</span>
                <el-button size="small" :loading="creatingAdmissions" :disabled="busy" @click="createAdmissionsVisit">建立招生訪視</el-button>
              </template>
              <span v-else class="hint">已到場，但還沒有招生訪視；請有招生權限的同事建立。</span>
            </div>
```

11. 承辦人區塊 `<div class="detail__assignee">` 加 `v-if="!familyVisit"`。

12. 刪掉模板尾端的 `<ContactLogDialog …/>` 與 `<FollowUpDialog …/>`。

13. 樣式：刪掉 `@media (max-width: 900px)` 裡的 `.detail__after { order: -2; }`，也刪掉其他 `.detail__after` 開頭的規則（用 `grep -n "detail__after" admin/src/views/VisitDetailView.vue` 確認沒有剩）。在 `.detail__desc` 規則附近加：

```css
.detail__data .panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

- [ ] **Step 6：更新既有測試**

`admin/src/__tests__/admissionsVisitDetail.test.ts`：

1. `mockDetail` 的路由加三條（家庭版面會讀）：

```ts
    '/admin/admissions/records/v-1/events': [],
    '/admin/admissions/records/v-1/contact-logs': [],
    '/admin/admissions/staff': [],
```

2. `describe('預約明細的招生訪視連結'…)` 的第一個案例（「有連結的招生訪視：顯示階段與連結…」）換成：

```ts
  it('有招生訪視：查一次招生 API（帶校區與預約 id），換成家庭版面', async () => {
    const get = mockDetail(detail({ status: 'completed' }), [visit({ visit_request_id: VR_ID, has_visit_request: true, has_deposit: true, stage: 'deposited' })])
    const { wrapper } = await mountDetail()
    const lookup = pathsTo(get, '/admin/admissions/records?')
    expect(lookup).toHaveLength(1)
    expect(Object.fromEntries(queryOf(lookup[0]!))).toEqual({ campus_key: 'yihua', visit_request_id: VR_ID, page: '1', page_size: '1' })
    expect(wrapper.get('.detail__status').text()).toContain('已預繳')
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
  })
```

3. 第二個案例（「已到場但沒有招生訪視：可以建立，建立後換成連結」）最後一行 `expect(wrapper.get('.detail__admissions a').text()).toBe('已訪視・在招生入學查看')` 改成：

```ts
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
```

4. 整個 `describe('參觀後追蹤區塊（2026-10-04 參觀後追蹤規格 7.6）'…)` 刪掉（由 `visitFamilyPage.test.ts` 取代）。

`admin/src/__tests__/ux20261005.test.ts` 的 `手機版：聯絡紀錄（已到場的是參觀後追蹤）排在家長資料前面`，改成：

```ts
  it('手機版：聯絡紀錄排在家長資料前面（家庭版面的聯絡紀錄沿用同一個 class）', () => {
    const mobile = detailSource.slice(detailSource.indexOf('@media (max-width: 900px)'))
    expect(mobile).toMatch(/\.detail__main \{\s*display: flex;\s*flex-direction: column;/)
    expect(mobile).not.toContain('.detail__after')
    expect(mobile).toMatch(/\.detail__notes \{\s*order: -1;/)
    expect(detailSource).toContain('class="section detail__notes"')
  })
```

- [ ] **Step 7：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/visitFamilyPage.test.ts src/__tests__/admissionsVisitDetail.test.ts src/__tests__/visitDetails.test.ts src/__tests__/ux20261005.test.ts src/__tests__/ux20260928B2.test.ts
npm --prefix admin run typecheck
npm --prefix admin run test:unit
```

預期：全部 PASS，typecheck 0 錯誤。

- [ ] **Step 8：Commit**

```bash
git add admin/src/composables/useFamilyAdmissions.ts admin/src/views/VisitDetailView.vue admin/src/__tests__/visitFamilyPage.test.ts admin/src/__tests__/admissionsVisitDetail.test.ts admin/src/__tests__/ux20261005.test.ts
git commit -m "feat(admin): 預約明細在已到場、有招生訪視時改成家庭版面

招生資料、合併聯絡紀錄與歷程、招生處理區；拿掉參觀後追蹤區塊與招生入學連結（家庭頁規格第 5 節）。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8：招生入學的入口與預約明細的返回

**Files:**
- Modify: `admin/src/components/admissions/FunnelBoard.vue`（`function openEvents(card: BoardCard)`）
- Modify: `admin/src/components/admissions/RecordsTab.vue`（`function openEvents(row: RecruitmentVisit)`、兩個「查看預約」連結）
- Modify: `admin/src/components/admissions/FollowUpsTab.vue`（`function openEvents(row: FollowUpRow)`）
- Modify: `admin/src/views/VisitDetailView.vue`（`cameFromVisitList`／`goBack`、返回鍵文字）
- Modify: `admin/src/__tests__/admissionsTestKit.ts`（`card()` 加 `visit_request_id: null`）
- Modify: `admin/src/__tests__/admissionsFollowUp.test.ts`（`followRow` 加 `visit_request_id: null`）
- Modify: `admin/src/__tests__/admissionsRecords.test.ts`（第 69 行附近的「查看預約」斷言）
- Create: `admin/src/__tests__/familyEntryPoints.test.ts`

**Interfaces:**
- Consumes：`visitRequestPath`、`detailOrigin`（Task 2）；`FunnelCard.visit_request_id`、`FollowUpRow.visit_request_id`（Task 1）；`RecruitmentVisit.visit_request_id`。
- Produces：無新介面。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/familyEntryPoints.test.ts`：

```ts
// 招生入學點有預約的家庭開預約明細；返回鍵依來源（docs/specs/2026-10-05-visit-family-page-design.md 第 6 節；Review Focus 4）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import FollowUpsTab from '../components/admissions/FollowUpsTab.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { board, card, cleanup, mockGet, mountWith, superAdmin, visit, VR_ID, wrappers } from './admissionsTestKit'

afterEach(cleanup)

// 只有招生權限、沒有 booking.read（Review Focus 4）。
const admissionsOnly = () => testUser('reception', { id: 'adm', campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'admissions.write'] })
const followRow = (changes: Record<string, unknown> = {}) => ({
  visit_id: 'v-1', child_name: '王小安', grade: '小班', stage: 'visited', visit_date: '2026-10-01', contact_name: '王媽媽',
  phone: '0912345678', follow_up_at: '2020-01-01T02:00:00Z', follow_up_owner_id: null, follow_up_owner_name: null,
  follow_up_owner_active: null, last_contacted_at: null, last_contact_channel: null, last_contact_reached: null,
  has_visit_request: true, visit_request_id: VR_ID, version: 3, ...changes,
})
const followList = (rows: unknown[]) => ({ as_of: '2026-10-05T02:00:00Z', campus_key: 'yihua', scope: 'due', totals: { due: 1, upcoming: 0, unscheduled: 0 }, total: rows.length, page: 1, page_size: 50, rows })

describe('漏斗看板點卡片', () => {
  it('有預約：開預約明細，不開抽屜', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card({ has_visit_request: true, visit_request_id: VR_ID })] }) })
    const { wrapper, router } = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null } })
    await wrapper.get('.funnel-card[data-id="v-1"] button.funnel-card__open').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${VR_ID}`)
    expect(wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(false)
  })
  it('手動新增或沒有 booking.read：照舊開抽屜', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const manual = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null } })
    await manual.wrapper.get('button.funnel-card__open').trigger('click')
    expect(manual.wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
    cleanup()
    mockGet({ '/admin/admissions/board': board({ visited: [card({ has_visit_request: true, visit_request_id: VR_ID })] }) })
    const noBooking = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null }, user: admissionsOnly() })
    await noBooking.wrapper.get('button.funnel-card__open').trigger('click')
    expect(noBooking.router.currentRoute.value.path).toBe('/admissions')
    expect(noBooking.wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
  })
})

describe('訪視明細點姓名', () => {
  const props = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }
  it('有預約：開預約明細；「查看預約」連結拿掉了', async () => {
    mockGet({ '/admin/admissions/records': [visit({ visit_request_id: VR_ID, has_visit_request: true })] })
    const { wrapper, router } = await mountWith(RecordsTab, { props })
    expect(wrapper.text()).not.toContain('查看預約')
    await wrapper.get('button.records__name').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${VR_ID}`)
  })
  it('沒有預約：開抽屜', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props })
    await wrapper.get('button.records__name').trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
  })
})

describe('待追蹤的「歷程」', () => {
  it('有預約：開預約明細；沒有預約：開抽屜', async () => {
    mockGet({ '/admin/admissions/follow-ups': followList([followRow(), followRow({ visit_id: 'v-2', child_name: '手動寶貝', has_visit_request: false, visit_request_id: null })]), '/admin/admissions/staff': [] })
    const { wrapper, router } = await mountWith(FollowUpsTab, { props: { campusKey: 'yihua', scope: 'due', owner: '' } })
    const historyButtons = () => wrapper.findAll('.follow-ups-table button').filter((b) => b.text() === '歷程')
    await historyButtons()[1]!.trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props()).toMatchObject({ modelValue: true, visitId: 'v-2' })
    await historyButtons()[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${VR_ID}`)
  })
})

describe('預約明細的返回鍵（6.2）', () => {
  async function mountDetailFrom(back: string | undefined) {
    mockGet({
      [`/admin/visit-requests/${VR_ID}/contact-notes`]: [],
      [`/admin/visit-requests/${VR_ID}`]: () => ({
        id: VR_ID, campus_key: 'yihua', status: 'confirmed', parent_name: '陳媽媽', phone: '0912345678', child_name: '陳小寶',
        child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, slot_id: null, slot: null,
        created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, assigned_staff_id: null, confirmed_at: null,
        cancelled_at: null, source: 'web', history: [], pending_reschedule: null, access_link: null, version: 1,
      }),
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = superAdmin()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
        { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
      ],
    })
    if (back) Object.defineProperty(router.options.history, 'state', { configurable: true, get: () => ({ back }) })
    await router.push(`/visit-requests/${VR_ID}`)
    await router.isReady()
    const { mount } = await import('@vue/test-utils')
    const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } } as never)
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, router }
  }

  it('從招生入學來：寫「招生入學」，按下去瀏覽器返回', async () => {
    const { wrapper, router } = await mountDetailFrom('/admissions?campus=yihua&tab=funnel')
    const back = vi.spyOn(router, 'back').mockImplementation(() => undefined)
    expect(wrapper.get('.detail__back').text()).toBe('招生入學')
    await wrapper.get('.detail__back').trigger('click')
    expect(back).toHaveBeenCalledOnce()
  })
  it('從案件列表來：寫「參觀案件」並瀏覽器返回；其他來源直接開案件列表', async () => {
    const fromList = await mountDetailFrom('/visit-requests?group=past')
    const back = vi.spyOn(fromList.router, 'back').mockImplementation(() => undefined)
    expect(fromList.wrapper.get('.detail__back').text()).toBe('參觀案件')
    await fromList.wrapper.get('.detail__back').trigger('click')
    expect(back).toHaveBeenCalledOnce()
    cleanup()
    const direct = await mountDetailFrom(undefined)
    await direct.wrapper.get('.detail__back').trigger('click')
    await flushPromises()
    expect(direct.router.currentRoute.value.path).toBe('/visit-requests')
  })
})
```

> `FollowUpsTab` 手機卡片也有一顆「歷程」：jsdom 沒有 `matchMedia`，所以會顯示桌機表格（`useNarrowScreen` 回 false），只要找 `.follow-ups-table` 裡的按鈕。若實際是用別的方式切換桌機或手機，照 `admissionsFollowUp.test.ts` 的寫法找按鈕。

- [ ] **Step 2：跑測試，確認失敗**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyEntryPoints.test.ts
```

預期：看板、明細、待追蹤「有預約」的案例 FAIL（還在開抽屜），返回鍵「招生入學」FAIL。

- [ ] **Step 3：三個入口**

三個檔案各自：
- import 加 `import { useRouter } from 'vue-router'`（`FunnelBoard`、`RecordsTab`、`FollowUpsTab` 原本都沒有）與 `import { visitRequestPath } from '../../admissions/family'`；
- 在 `const { can } = usePermissions()` 下面加 `const router = useRouter()`；
- `openEvents` 第一行加入規則。

`FunnelBoard.vue`：

```ts
// 有預約、看得到預約的開預約明細（家庭頁）；手動新增或沒有 booking.read 的照舊開歷程抽屜（家庭頁規格 6.1）。
function openEvents(card: BoardCard) {
  const path = visitRequestPath(card.visit_request_id, can)
  if (path) {
    void router.push(path)
    return
  }
  eventsFor.value = card
  eventsOpen.value = true
}
```

`RecordsTab.vue`（`// 桌機點姓名、手機按「歷程」（同看板點卡片）。` 那個函式）：

```ts
// 桌機點姓名、手機按「歷程」（同看板點卡片）：有預約、看得到預約的開預約明細（家庭頁規格 6.1）。
function openEvents(row: RecruitmentVisit) {
  const path = visitRequestPath(row.visit_request_id, can)
  if (path) {
    void router.push(path)
    return
  }
  eventsFor.value = row
  eventsOpen.value = true
}
```

並刪掉兩個「查看預約」連結（搜尋 `>查看預約</router-link>`，桌機與手機卡片各一個）。如果 `canSeeBooking` 已經沒人用，一併刪掉它的定義。

`FollowUpsTab.vue`：

```ts
// 有預約、看得到預約的開預約明細（家庭頁規格 6.1）；其他照舊開歷程抽屜。
function openEvents(row: FollowUpRow) {
  const path = visitRequestPath(row.visit_request_id, can)
  if (path) {
    void router.push(path)
    return
  }
  eventsRow.value = row
  eventsOpen.value = true
}
```

- [ ] **Step 4：返回鍵**

`VisitDetailView.vue`：

1. import 的 `../admissions/family` 那行加入 `detailOrigin`。
2. 把 `function cameFromVisitList()` 與 `function goBack()` 兩個函式（連同上面的註解）換成：

```ts
// 上一頁是哪裡（2026-10-05 家庭頁規格 6.2）：從招生入學或案件列表來的用瀏覽器返回（保留分頁、篩選與
// 捲動位置）；從通知連結、登入頁或別的頁面進來時，返回會回到不相干的地方，改成直接開案件列表。
const readOrigin = () => detailOrigin((router.options.history.state as { back?: unknown } | null)?.back)
const origin = ref(readOrigin())
const backLabel = computed(() => (origin.value === 'admissions' ? '招生入學' : '參觀案件'))

function goBack() {
  if (origin.value === 'other') void router.push('/visit-requests')
  else router.back()
}
```

3. `watch(id, () => { … })` 裡加 `origin.value = readOrigin()`。
4. 模板 `<el-button text :icon="ArrowLeft" class="detail__back" @click="goBack">參觀案件</el-button>` 改成 `…@click="goBack">{{ backLabel }}</el-button>`。

- [ ] **Step 5：測試資料工廠與既有斷言**

- `admissionsTestKit.ts` 的 `card()`：在 `has_visit_request: false,` 後面加 `visit_request_id: null,`。
- `admissionsFollowUp.test.ts` 的 `followRow()`：在 `has_visit_request: true,` 後面加 `visit_request_id: null,`。
- `admissionsRecords.test.ts`：刪掉這兩行

```ts
    // 有 booking.read 才看得到預約明細的連結。
    expect(wrapper.find(`a[href="/visit-requests/${VR_ID}"]`).text()).toBe('查看預約')
```

  改成：

```ts
    // 2026-10-05 家庭頁：點姓名就開預約明細，不再另放「查看預約」連結。
    expect(wrapper.text()).not.toContain('查看預約')
```

- [ ] **Step 6：跑測試**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- src/__tests__/familyEntryPoints.test.ts src/__tests__/admissionsFunnel.test.ts src/__tests__/admissionsRecords.test.ts src/__tests__/admissionsFollowUp.test.ts src/__tests__/visitFamilyPage.test.ts
npm --prefix admin run typecheck
npm --prefix admin run test:unit
```

預期：全部 PASS。

- [ ] **Step 7：Commit**

```bash
git add admin/src/components/admissions/FunnelBoard.vue admin/src/components/admissions/RecordsTab.vue admin/src/components/admissions/FollowUpsTab.vue admin/src/views/VisitDetailView.vue admin/src/__tests__/familyEntryPoints.test.ts admin/src/__tests__/admissionsTestKit.ts admin/src/__tests__/admissionsFollowUp.test.ts admin/src/__tests__/admissionsRecords.test.ts
git commit -m "feat(admin): 招生入學點有預約的家庭開預約明細，返回鍵依來源

手動新增或沒有 booking.read 的照舊開歷程抽屜；拿掉訪視明細的「查看預約」（家庭頁規格第 6 節）。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9：stack e2e、畫面驗收截圖、文件

**Files:**
- Create: `tests/stack/visit-family-page.spec.ts`
- Modify: `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`
- Modify: `docs/specs/2026-09-30-website-admissions-design.md`（§6.1）、`docs/specs/2026-10-04-admissions-follow-up-design.md`（§1.1 表、§7.5、§7.6、第 491 行附近）

**Interfaces:**
- Consumes：`adminApi`、`findVisit`、`taipeiDate`、`SlotOut`（`tests/stack/api.ts`）；`startVisitSlot`（`db.ts`）；`answerMessageBox`、`expectNoHorizontalOverflow`、`gotoAdmin`、`openAs`（`pages.ts`）；`ROOT`、`SLOTS_CAMPUS`、`WEB_ORIGIN`（`stack-env.ts`）；`currentTerm`（`admin/src/admissions/academic.ts`）。

- [ ] **Step 1：寫 e2e**

`tests/stack/visit-family-page.spec.ts`（檔名排在 `admissions-*` 之後：`admissions-flow` 斷言的招生絕對數字不受影響）：

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, request, test } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, findVisit, taipeiDate, type SlotOut } from './api'
import { startVisitSlot } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md 10.1）：家長預約 → 場次時間過了、
// 標記已到場（API 準備）→ 預約明細是家庭版面「已訪視」→ 記錄聯絡 → 移到已預繳 → 招生看板卡片在「已預繳」→
// 點卡片回到同一筆預約明細、返回鍵寫「招生入學」→ 手動新增的訪視點卡片仍開歷程抽屜。
// 「時間已過」用 psql 把本測試自己的場次移到昨天（db.ts）。

const API = '/api/website/v1'
const PARENT = '家庭頁流程家長'
const CHILD = '家庭頁寶貝'
const MANUAL_CHILD = '家庭頁手動寶貝'
const PHONE = '0912000791'
const SHOTS = path.join(ROOT, 'output/playwright')
const TERM = currentTerm(taipeiDate(0))

test('家庭版面：已到場 → 記錄聯絡 → 移到已預繳 → 看板點卡片回到同一頁 → 手動訪視開抽屜', async ({ browser }) => {
  test.setTimeout(150_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const slot = await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
    slot_date: taipeiDate(16), start_time: '15:00:00', end_time: '16:00:00', capacity: 1,
  })

  // 公開預約每來源每校每小時 5 筆：用文件保留網段 IP 取得獨立額度（同 admissions-flow／follow-up）。
  const parent = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.19' } })
  const config = await (await parent.get(`${API}/public/booking-config/${SLOTS_CAMPUS}`)).json()
  const created = await parent.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `e2e-family-page-${PHONE}` },
    data: {
      campus_key: SLOTS_CAMPUS, parent_name: PARENT, phone: PHONE, child_name: CHILD, child_birthdate: '2022-05-01',
      config_version: config.version, slot_id: slot.id, email: `e2e-family-page-${PHONE}@example.com`,
    },
  })
  expect([200, 201], await created.text()).toContain(created.status())
  await parent.dispose()
  const booked = await findVisit(api, PARENT)
  startVisitSlot(booked.id)
  await api.send('POST', `/admin/visit-requests/${booked.id}/complete`)

  const staff = await openAs(browser, 'campus_admin')
  const { page } = staff

  await test.step('預約明細是家庭版面：頁首「已訪視」、招生資料、處理區有記錄聯絡', async () => {
    await gotoAdmin(page, `/visit-requests/${booked.id}`, '案件明細')
    await expect(page.locator('.detail__status')).toContainText('已訪視')
    await expect(page.locator('.family-data')).toContainText(CHILD)
    await expect(page.getByRole('button', { name: '記錄聯絡' })).toBeVisible()
    await expect(page.locator('.detail__after')).toHaveCount(0)
  })

  await test.step('記錄聯絡：聯絡到了、寫內容、不用再追 → 列在聯絡紀錄「參觀後」', async () => {
    await page.getByRole('button', { name: '記錄聯絡' }).click()
    const dialog = page.getByRole('dialog', { name: '記錄聯絡' })
    await expect(dialog).toBeVisible()
    await dialog.getByText('聯絡到了', { exact: true }).click()
    await dialog.getByLabel('聯絡內容').fill('家長下週帶預繳過來')
    await dialog.getByText('不用再追', { exact: true }).click()
    await dialog.getByRole('button', { name: '記下來' }).click()
    await expect(dialog).toBeHidden()
    const item = page.locator('.family-notes__item', { hasText: '家長下週帶預繳過來' })
    await expect(item).toContainText('參觀後')
    await expect(item).toContainText('聯絡到了')
  })

  await test.step('移到… 已預繳（確認框「已訪視 → 已預繳」）', async () => {
    await page.locator('.family-actions__move').click()
    await page.getByRole('menuitem', { name: '已預繳', exact: true }).click()
    await confirmMove()
    await expect(page.locator('.detail__status')).toContainText('已預繳')
    await expect(page.locator('.timeline__item').first()).toContainText('加上預繳')
  })

  await test.step('畫面驗收截圖（1440）', async () => {
    await page.screenshot({ path: path.join(SHOTS, 'visit-family-page-1440.png'), fullPage: true })
  })

  await test.step('招生看板：卡片在「已預繳」，點卡片回到同一筆預約明細，返回寫「招生入學」', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel&sy=${TERM.schoolYear}`, '招生入學')
    const card = page.locator('.funnel__column[data-stage="deposited"] .funnel-card', { hasText: CHILD })
    await expect(card).toBeVisible()
    await card.locator('button.funnel-card__open').click()
    await expect(page).toHaveURL(new RegExp(`/admin/visit-requests/${booked.id}`))
    await expect(page.locator('.detail__back')).toHaveText('招生入學')
    await page.locator('.detail__back').click()
    await expect(page).toHaveURL(/\/admin\/admissions\?.*tab=funnel/)
    await expect(page.locator('.funnel__column[data-stage="deposited"] .funnel-card', { hasText: CHILD })).toBeVisible()
  })

  await test.step('手動新增的訪視：點卡片照舊開歷程抽屜', async () => {
    await api.send('POST', `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}`, {
      visit_date: taipeiDate(0), child_name: MANUAL_CHILD, birthday: '2022-05-01',
      target_school_year: TERM.schoolYear, target_semester: TERM.semester,
    })
    await page.reload()
    const manual = page.locator('.funnel-card', { hasText: MANUAL_CHILD })
    await manual.locator('button.funnel-card__open').click()
    await expect(page.getByRole('dialog', { name: '參觀→入學 歷程' })).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/admissions/)
  })

  await staff.context.close()

  await test.step('手機 390：家庭版面不橫向溢出，處理區在聯絡紀錄前面', async () => {
    const mobile = await openAs(browser, 'campus_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await gotoAdmin(mobile.page, `/visit-requests/${booked.id}`, '案件明細')
    await expect(mobile.page.locator('.family-actions')).toBeVisible()
    await expectNoHorizontalOverflow(mobile.page)
    const actionsTop = await mobile.page.locator('.family-actions').evaluate((el) => el.getBoundingClientRect().top)
    const notesTop = await mobile.page.locator('.family-notes').evaluate((el) => el.getBoundingClientRect().top)
    expect(actionsTop).toBeLessThan(notesTop)
    await mobile.page.screenshot({ path: path.join(SHOTS, 'visit-family-page-390.png'), fullPage: true })
    await mobile.context.close()
  })

  await api.dispose()

  /** 換階段的確認框（TransitionDialog，不是 ElMessageBox）：照 admissions-flow 的 moveCard 用標題與動作鍵。 */
  async function confirmMove() {
    const dialog = page.getByRole('dialog', { name: '已訪視 → 已預繳' })
    await expect(dialog).toContainText(CHILD)
    await dialog.getByRole('button', { name: '移到已預繳', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
})
```

> 寫完先讀一次 `admin/src/components/admissions/ContactLogDialog.vue` 的模板，確認「不用再追」選項在已訪視階段可以選。`NextFollowUpPicker` 的 `noneLabel` 預設是「不用再追」；如果 ContactLogDialog 傳了別的 `none-label`，以它為準。

- [ ] **Step 2：跑 e2e（主 session 執行，同時不跑其他測試）**

```bash
cd ~/Repositories/ivy-website-wt/visit-family-page-20261005
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run e2e:build
E2E_DB_NAME=ivy_website_e2e_familypage_test npm run test:e2e:stack -- tests/stack/visit-family-page.spec.ts tests/stack/admissions-flow.spec.ts tests/stack/admissions-follow-up.spec.ts tests/stack/visual.spec.ts
```

預期：4 個 spec 全過。`output/playwright/visit-family-page-1440.png`、`visit-family-page-390.png` 產生後打開看，和 mock-up（`~/Desktop/ivy-website-admin/design/visit-family-page-mockup-20261005/shots/`）對照：版面順序、標籤、按鈕一致。跑完刪掉 e2e 測試庫：`dropdb ivy_website_e2e_familypage_test`。

- [ ] **Step 3：DESIGN.md**

在 `DESIGN.md` 找到 `招生入學 UI/UX（2026-10-05）` 這一節，在它**後面**新增一節，標題層級與它相同：

```markdown
## 預約明細當家庭頁（2026-10-05）

使用者要「一個家庭從頭看到尾」（規格 `docs/specs/2026-10-05-visit-family-page-design.md`）。以下是之後要照著做的：

- 預約明細在「已到場＋招生開關開＋查得到招生訪視＋有 admissions.read」時改成家庭版面；任一不成立就是原本的畫面。
- 家庭版面：頁首是招生階段（`stageMeta`，同訪視明細）與「MM/DD 到場」，預約承辦人寫在頁首小字；招生資料面板在最上面、可編輯；家長預約時填的資料收合在它下面；聯絡紀錄合併參觀前（預約）與參觀後（招生），依標記已到場的時間標「參觀前／參觀後」，沒有輸入框；案件歷程合併預約事件與招生事件，每列標來源；處理區是記錄聯絡、排下次聯絡、移到…、招生負責人、重新預約。
- 「參觀後追蹤」區塊、「到招生入學」與「○○・在招生入學查看」連結拿掉；訪視明細的「查看預約」也拿掉。
- 招生看板點卡片、訪視明細點姓名、待追蹤「歷程」：有預約而且有 booking.read 的開預約明細，其他照舊開歷程抽屜。預約明細的返回鍵從招生入學來寫「招生入學」。
- 招生事件只有建立、預繳、註冊、退出、保留座位這些階段事件；「修改招生資料」「排下次聯絡」沒有事件、不會出現在歷程（要加得新增事件類型，會動到轉移契約）。
- 和園務分歧：園務點招生卡片一律開歷程抽屜，也沒有官網預約模組；併入園務時一起決定。
```

- [ ] **Step 4：README.md**

在 `README.md` 頂部的日期紀錄區，照最上面那一段的格式（標題層級、日期寫法）新增一段：

```markdown
## 2026-10-05 預約明細當家庭頁

- 已到場、有招生訪視的預約明細改成家庭版面：招生資料、參觀前後合併的聯絡紀錄與歷程、記錄聯絡／排下次聯絡／移到…／招生負責人都在同一頁。
- 招生入學的看板、訪視明細、待追蹤點有預約的家庭會開預約明細；手動新增的仍開歷程抽屜。
- 後端看板卡片與待追蹤列多回 `visit_request_id`；沒有 migration。規格 `docs/specs/2026-10-05-visit-family-page-design.md`。
```

- [ ] **Step 5：acceptance.md**

在 `docs/website-admin/acceptance.md` 文末新增：

```markdown
## 預約明細當家庭頁（2026-10-05）

規格：`docs/specs/2026-10-05-visit-family-page-design.md` 10.4。

| # | 驗收 | 驗證 |
|---|---|---|
| F1 | 有預約、已到場的家庭，預約明細能看到招生資料、合併聯絡紀錄、合併歷程，並能記錄聯絡、排下次聯絡、編輯、移到… | `visitFamilyPage.test.ts`、`familyActions.test.ts`、stack `visit-family-page.spec.ts` |
| F2 | 招生看板、訪視明細、待追蹤點有預約的列開預約明細；手動新增的開抽屜 | `familyEntryPoints.test.ts`、stack `visit-family-page.spec.ts` |
| F3 | 從招生點進來，返回回到原分頁與篩選，看板反映剛才的變更 | `familyEntryPoints.test.ts`、stack `visit-family-page.spec.ts` |
| F4 | 開關關閉、沒有招生權限、已到場但沒有訪視三種情況，畫面與改版前相同 | `visitFamilyPage.test.ts`「不是家庭版面的情況維持原樣」、`admissionsVisitDetail.test.ts` |
| F5 | 後端新欄位、契約一致；沒有 migration | `test_admissions_family_page_fields.py`、`npm run contract:check` |
```

- [ ] **Step 6：修正過時的規格段落**

只在段首加日期註記，不改寫原文（保留歷史）：

`docs/specs/2026-09-30-website-admissions-design.md` 的 §6.1「官網預約」分頁那段（搜尋 `官網預約` 分頁的描述，約第 205 行）前面加：

```markdown
> 2026-10-05 更新：招生入學的「官網預約」分頁已拿掉，確認到場改在參觀案件列表（DESIGN.md「拿掉官網預約分頁」）；已到場家庭的參觀後處理改在預約明細的家庭版面（`docs/specs/2026-10-05-visit-family-page-design.md`）。下面描述的分頁不再存在。
```

`docs/specs/2026-10-04-admissions-follow-up-design.md`：
- §1.1 現況表格上方加：`> 2026-10-05 更新：表中的 \`ArrivalsTab.vue\` 已刪除，見 DESIGN.md「拿掉官網預約分頁」。`
- §7.5 標題下一行加：`> 2026-10-05 更新：批次標記已到場已搬到參觀案件列表「只看尚未確認到場」，這個分頁已拿掉。`
- §7.6 標題下一行加：`> 2026-10-05 更新：「參觀後追蹤」區塊已由預約明細的家庭版面取代，見 \`docs/specs/2026-10-05-visit-family-page-design.md\` 第 5 節。`
- 第 491 行附近「到『招生入學 → 官網預約』下方逐筆補建」那一句前加：`（2026-10-05 起改在預約明細按「建立招生訪視」逐筆補建。）`

- [ ] **Step 7：最後一輪檢查（主 session）**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run typecheck; npm --prefix admin run test:unit; npm run contract:check
cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_familypage_test uv run pytest -q -p no:cacheprovider
```

後端全套在背景跑。預期：全部通過。台北時間週五時，`test_booking_consent_readiness` 的場次同步是 main 既有的日期相依失敗，與本變更無關，回報時要註明。

- [ ] **Step 8：Commit**

```bash
git add tests/stack/visit-family-page.spec.ts DESIGN.md README.md docs/website-admin/acceptance.md docs/specs/2026-09-30-website-admissions-design.md docs/specs/2026-10-04-admissions-follow-up-design.md
git commit -m "test(stack): 預約明細家庭版面的端到端流程；文件與過時規格註記

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 收尾（主 session，不在任何 Task 裡）

- 回報使用者：分支 `feature/visit-family-page-20261005` 的 commit 清單、跑過的指令與結果、截圖路徑、未驗證項。
- **不 push、不合 main**。使用者說要上線時，照 `website-deploy-backup-gate` 的慣例給 `! git -C ~/Repositories/ivy-website-wt/visit-family-page-20261005 push origin HEAD:main`；這次沒有 migration，不用備份。部署後在 `deploy/README.md` 補紀錄、刪測試庫 `ivy_website_familypage_test`、清 worktree。
