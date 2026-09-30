# 階段 C：官網後台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後台列表精簡成預約正常／時間已過／已取消，明細拿掉聯絡中，補登必選場次，預約設定拿掉填表與自動確認，「時段與容量」併進改版的「參觀場次」頁（固定場次卡＋月曆）。

**Architecture:** 純邏輯放 `admin/src/utils/`（場次換算、月曆色塊、狀態顯示），元件只接線。月曆頁拆三個元件：`VisitCalendarView.vue`（頁面）、`components/sessions/WeeklySessionsCard.vue`（固定場次）、`components/sessions/DayPanel.vue`（當天清單與操作）。

**Tech Stack:** Vue 3、Pinia、Element Plus、vitest＋@vue/test-utils（jsdom）。測試掛載沿用 `src/__tests__/ux20260928B1.test.ts` 的 `mountAt` 寫法。

**Spec:** §4.5–§4.9。**前置：** 階段 A、B 閘門已過（契約型別已含新欄位）。

**先讀：** 總覽的 Global Constraints、Review Focus 第 1、2、5 條；`DESIGN.md` 2026-09-28「官網後台全面盤點與修正」一節（用詞、網址帶校區、按鈕主色給真正的下一步、確認框「先不要」）。

## 本階段對規格的調整

- 當天清單沿用現在「月曆下方」的位置（規格寫右側）；桌機 1440 寬放右側會把月曆壓得太窄。
- 「參觀場次」頁一次看一個校區（沒選校區時預設第一個可見校區），不再有「全部校區」月曆。

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `admin/src/utils/sessions.ts` | 新增 | 每週規則⇄場次換算、場次名稱、星期摘要、常用場次、驗證 |
| `admin/src/utils/calendarChips.ts` | 新增 | 月曆格子的色塊與朗讀文字 |
| `admin/src/api/labels.ts` | 修改 | `visitDisplay()`、分組標籤、時間窗標籤；移除聯絡中相關用字 |
| `admin/src/views/VisitRequestsView.vue` | 修改 | group 分頁、狀態欄 |
| `admin/src/views/VisitDetailView.vue` | 修改 | 拿掉聯絡中；寄信說明；到場標記降為次要 |
| `admin/src/components/ParentAccessLinkPanel.vue` | 修改 | 重寄確認信、重新產生並寄出 |
| `admin/src/components/ManualVisitDialog.vue` | 修改 | 場次必選 |
| `admin/src/views/BookingSettingsView.vue` | 修改 | 拿掉填表與自動確認、寄信狀態 |
| `admin/src/components/sessions/WeeklySessionsCard.vue` | 新增 | 固定場次摘要／編輯／常用場次／儲存並開放 |
| `admin/src/components/sessions/DayPanel.vue` | 新增 | 當天各場次、停止申請／恢復、名額、休假、加開 |
| `admin/src/views/VisitCalendarView.vue` | 改寫 | 參觀場次頁 |
| `admin/src/router/index.ts`、`router/nav.ts` | 修改 | 移除 `/slots`、改名、轉址、搜尋關鍵字 |
| `admin/src/views/VisitSlotsView.vue`、`components/VisitSchedulePanel.vue` | 刪除 | 併入參觀場次頁 |
| `admin/src/__tests__/*` | 新增／修改／刪除 | 見各 task |

---

### Task C1：狀態顯示與列表分組

**Files:**
- Modify: `admin/src/api/labels.ts`（`VISIT_STATUS` 46–70 行附近）
- Modify: `admin/src/views/VisitRequestsView.vue`（script 1–361、分頁 373–379、狀態欄 440–444、參觀時間欄 456–462）
- Test: 新增 `admin/src/__tests__/visitGroups.test.ts`；修改 `ux20260928B1.test.ts`（「網址上的條件…」「畫面上改條件…」「側欄或總覽連結…」三個 it）、`listUx.test.ts`（前兩個 it）、`adminUx.test.ts`（「案件快速切換篩選…」）、`uxRound6.test.ts`（「從列表點進來…」）

**Interfaces:**
- Consumes: API `GET /admin/visit-requests?group=`、`GET /admin/visit-requests/group-counts`；`VisitRequestDetailOut.display_status`、`cancel_reason`。
- Produces（labels.ts）：
  - `export const VISIT_GROUPS = ['pending', 'upcoming', 'past', 'cancelled'] as const`；`export type VisitGroup = typeof VISIT_GROUPS[number]`
  - `export const VISIT_GROUP_LABELS: Record<VisitGroup, string>` = `{ pending: '待處理', upcoming: '預約正常', past: '時間已過', cancelled: '已取消' }`
  - `export function legacyStatusGroup(status: string): VisitGroup | ''`
  - `export function visitDisplay(row: { status: string; display_status: string; cancel_reason?: string | null; cancelled_at?: string | null }): { label: string; tone: TagTone; sub: string }`

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/visitGroups.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { legacyStatusGroup, visitDisplay } from '../api/labels'

describe('案件狀態顯示（參考義華舊後台）', () => {
  it('四組各自的寫法', () => {
    expect(visitDisplay({ status: 'confirmed', display_status: 'upcoming' })).toMatchObject({ label: '預約正常', tone: 'success', sub: '' })
    expect(visitDisplay({ status: 'completed', display_status: 'past' })).toMatchObject({ label: '預約時間已過', sub: '已到場' })
    expect(visitDisplay({ status: 'no_show', display_status: 'past' }).sub).toBe('未到場')
    expect(visitDisplay({ status: 'contacting', display_status: 'pending' })).toMatchObject({ label: '待處理', sub: '聯絡中' })
  })

  it('取消寫出是誰、什麼時候', () => {
    const parent = visitDisplay({ status: 'cancelled', display_status: 'cancelled', cancel_reason: 'parent', cancelled_at: '2026-09-28T10:45:00Z' })
    expect(parent.label).toBe('預約已取消')
    expect(parent.tone).toBe('danger')
    expect(parent.sub).toMatch(/^家長取消：.*18:45/)
    expect(visitDisplay({ status: 'cancelled', display_status: 'cancelled', cancel_reason: 'hold_expired', cancelled_at: '2026-09-28T10:45:00Z' }).sub).toMatch(/^逾期未確認：/)
    expect(visitDisplay({ status: 'cancelled', display_status: 'cancelled', cancel_reason: null, cancelled_at: '2026-09-28T10:45:00Z' }).sub).toMatch(/^取消時間：/)
  })

  it('舊的 ?status= 書籤轉成分組', () => {
    expect(legacyStatusGroup('contacting')).toBe('pending')
    expect(legacyStatusGroup('confirmed')).toBe('upcoming')
    expect(legacyStatusGroup('no_show')).toBe('past')
    expect(legacyStatusGroup('cancelled')).toBe('cancelled')
    expect(legacyStatusGroup('bogus')).toBe('')
  })
})
```

把 `ux20260928B1.test.ts`、`listUx.test.ts`、`adminUx.test.ts`、`uxRound6.test.ts` 裡點 `.status-tab` 的斷言改成新分頁：
- 分頁文字改為「全部／預約正常／時間已過／已取消」（有待處理時多「待處理」）。
- 網址斷言 `{ status: 'confirmed', … }` 改成 `{ group: 'upcoming', … }`；後端查詢斷言 `lastListQuery(get).get('status')` 改 `get('group')`。
- 這些測試的 `api.get` mock 要能回應兩種路徑：列表回陣列，`/admin/visit-requests/group-counts` 回 `{ pending: 0, upcoming: 0, past: 0, cancelled: 0 }`。在各檔共用的 mock 加：

```ts
vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
  (path.startsWith('/admin/visit-requests/group-counts') ? { pending: 0, upcoming: 0, past: 0, cancelled: 0 } : rows) as never)
```
- `uxRound6` 的 `status=contacting` 改 `group=pending`。
- fixture `request()` 加 `display_status: 'pending'`、`cancel_reason: null`（依 status 給對應值）。

加一個接線測試到 `visitGroups.test.ts`：

```ts
import { flushPromises, mount } from '@vue/test-utils'
// …沿用 ux20260928B1.test.ts 的 mountAt、request 工廠（複製進來，不要跨檔 import 測試檔）

it('分頁數字來自 group-counts；有舊案才出現待處理', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-requests/group-counts') ? { pending: 2, upcoming: 5, past: 9, cancelled: 1 } : []) as never)
  const { wrapper, router } = await mountAt(VisitRequestsView, '/visit-requests?status=contacting')

  const tabs = wrapper.findAll('.status-tab').map(tab => tab.text().replace(/\s+/g, ''))
  expect(tabs).toEqual(['全部', '待處理2件', '預約正常5件', '時間已過9件', '已取消1件'])
  expect(router.currentRoute.value.query.group).toBe('pending')
  expect(get.mock.calls.some(([path]) => String(path).includes('group=pending'))).toBe(true)
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin && npx vitest run src/__tests__/visitGroups.test.ts src/__tests__/ux20260928B1.test.ts src/__tests__/listUx.test.ts src/__tests__/adminUx.test.ts src/__tests__/uxRound6.test.ts`
Expected: FAIL。

- [ ] **Step 3：labels.ts**

在 `VISIT_STATUS` 附近加（`formatDateTime` 若不在同檔就用既有的日期格式函式；時區固定台北）：

```ts
// 列表分組（2026-09-30 業主裁定，參考義華舊後台）：資料庫狀態不變，只在顯示上歸組。
export const VISIT_GROUPS = ['pending', 'upcoming', 'past', 'cancelled'] as const
export type VisitGroup = typeof VISIT_GROUPS[number]
export const VISIT_GROUP_LABELS: Record<VisitGroup, string> = { pending: '待處理', upcoming: '預約正常', past: '時間已過', cancelled: '已取消' }

const LEGACY_STATUS_GROUP: Record<string, VisitGroup> = {
  new: 'pending', contacting: 'pending', pending_confirmation: 'pending',
  confirmed: 'upcoming', completed: 'past', no_show: 'past', cancelled: 'cancelled',
}
export function legacyStatusGroup(status: string): VisitGroup | '' {
  return LEGACY_STATUS_GROUP[status] ?? ''
}

const CANCEL_REASON_LABELS: Record<string, string> = { parent: '家長取消', staff: '園方取消', hold_expired: '逾期未確認' }
const PENDING_SUB: Record<string, string> = { contacting: '聯絡中', pending_confirmation: '待確認' }
const PAST_SUB: Record<string, string> = { completed: '已到場', no_show: '未到場' }

export function visitDisplay(row: { status: string; display_status: string; cancel_reason?: string | null; cancelled_at?: string | null }): { label: string; tone: TagTone; sub: string } {
  switch (row.display_status) {
    case 'upcoming':
      return { label: '預約正常', tone: 'success', sub: '' }
    case 'past':
      return { label: '預約時間已過', tone: 'info', sub: PAST_SUB[row.status] ?? '' }
    case 'cancelled': {
      const who = (row.cancel_reason && CANCEL_REASON_LABELS[row.cancel_reason]) || '取消時間'
      return { label: '預約已取消', tone: 'danger', sub: row.cancelled_at ? `${who}：${formatDateTime(row.cancelled_at)}` : '' }
    }
    default:
      return { label: '待處理', tone: 'warning', sub: PENDING_SUB[row.status] ?? '' }
  }
}
```
（`formatDateTime` 需輸出含 `HH:mm` 的台北時間；若既有函式格式不同，測試的正則跟著它的實際格式調整，不要另寫一個格式函式。）

- [ ] **Step 4：VisitRequestsView**

script：
1. import 換成 `VISIT_GROUPS, VISIT_GROUP_LABELS, legacyStatusGroup, visitDisplay`（刪 `VISIT_STATUS_ORDER`；`VISIT_STATUS`／`visitStatus` 若別處仍用就保留）。
2. `statusFilter` 改名 `groupFilter`；讀網址：

```ts
const group = queryText(query.group)
groupFilter.value = (VISIT_GROUPS as readonly string[]).includes(group) ? group : legacyStatusGroup(queryText(query.status))
```
   寫回網址時用 `group`，並刪掉 `status`。
3. `filterParams()` 把 `status` 換成 `group`。新增 `countParams()`＝同一組條件但不含 `group`。
4. 分頁資料：

```ts
const groupCounts = ref<Record<string, number>>({})
async function loadCounts() {
  try {
    groupCounts.value = await api.get<Record<string, number>>(`/admin/visit-requests/group-counts?${countParams()}`)
  } catch {
    groupCounts.value = {}
  }
}
const statusTabs = computed(() => [
  { value: '', label: '全部', count: 0 },
  ...VISIT_GROUPS
    .filter(value => value !== 'pending' || (groupCounts.value.pending ?? 0) > 0 || groupFilter.value === 'pending')
    .map(value => ({ value, label: VISIT_GROUP_LABELS[value], count: groupCounts.value[value] ?? 0 })),
])
```
   `load()` 裡與列表一起 `void loadCounts()`（用同一個 request sequence 防舊回應覆蓋，沿用該檔既有做法）。
5. `holdLabel` 保留（舊的待確認案件仍會顯示確認期限）。

template：
- 分頁 `v-for` 綁 `groupFilter`。
- 狀態欄換成：

```html
<el-table-column label="狀態" width="150">
  <template #default="{ row }: { row: VisitRequestDetailOut }">
    <span class="visit-state" :data-tone="visitDisplay(row).tone">{{ visitDisplay(row).label }}</span>
    <span v-if="visitDisplay(row).sub" class="cell-sub visit-state__sub">{{ visitDisplay(row).sub }}</span>
  </template>
</el-table-column>
```
- 手機卡片（`mobile-records` 區塊）若也顯示 `StatusTag`，同樣換成上面兩個 span。
- style 加（token 皆定義在 `admin/src/style.css`）：

```css
.visit-state { font-weight: 600; }
.visit-state[data-tone='success'] { color: var(--status-live-ink); }
.visit-state[data-tone='danger'] { color: var(--el-color-danger); }
.visit-state[data-tone='warning'] { color: var(--el-color-warning-dark-2); }
.visit-state[data-tone='info'] { color: var(--ink-3); }
.visit-state__sub { display: block; }
```

- [ ] **Step 5：跑測試**

Run: 同 Step 2。Expected: PASS。

- [ ] **Step 6：Commit（需授權）**

```bash
git add admin/src/api/labels.ts admin/src/views/VisitRequestsView.vue admin/src/__tests__/visitGroups.test.ts \
  admin/src/__tests__/ux20260928B1.test.ts admin/src/__tests__/listUx.test.ts admin/src/__tests__/adminUx.test.ts \
  admin/src/__tests__/uxRound6.test.ts
git commit -m "feat(admin): 參觀案件依預約正常、時間已過、已取消分頁

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C2：案件明細、家長連結面板、補登必選場次

**Files:**
- Modify: `admin/src/views/VisitDetailView.vue`（`DetailAction` 51 行、`confirm` 288–328、`markContacting` 421–446、動作區 786–905、`cancel` 334、`reschedule` 457）
- Modify: `admin/src/components/ParentAccessLinkPanel.vue`
- Modify: `admin/src/components/ManualVisitDialog.vue`（`form.slot_id` 36 行、送出 169–203、模板 244–250）
- Test: `admin/src/__tests__/visitDetails.test.ts`（刪「新需求可以先標為聯絡中；待確認可退回聯絡中」）、新增 `admin/src/__tests__/selfBookingDetail.test.ts`

**Interfaces:**
- Consumes: `POST /admin/visit-requests/{id}/resend-confirmation`（202）、`POST …/access-link`（回 `emailed`）。
- Produces: `ParentAccessLinkPanel` props 加 `status: string`、`email: string | null`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/selfBookingDetail.test.ts`（掛載方式複製 `visitDetails.test.ts` 的 helper 與 `details()` 工廠，fixture 加 `display_status`、`cancel_reason: null`、`email: 'wang@example.com'`、`access_link: { created_at: '2026-09-30T00:00:00Z', expires_at: '2026-10-20T00:00:00Z' }`）：

```ts
it('舊的新需求只剩「排入場次」與取消，沒有聯絡中', async () => {
  const wrapper = await mountDetail(details({ status: 'new', display_status: 'pending', slot: null, slot_id: null }))
  const text = wrapper.text()
  expect(text).not.toContain('聯絡中')
  expect(wrapper.findAll('button').some(b => b.text() === '排入場次')).toBe(true)
})

it('已確認的案件：取消前說明會寄信給家長', async () => {
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming' }))
  await wrapper.findAll('button').find(b => b.text() === '取消預約')!.trigger('click')
  expect(String(confirm.mock.calls[0]?.[0])).toContain('會寄信通知家長（w***@example.com）')
})

it('家長連結區可以重寄確認信', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ queued: true } as never)
  const wrapper = await mountDetail(details({ status: 'confirmed', display_status: 'upcoming' }))
  await wrapper.findAll('button').find(b => b.text() === '重寄確認信')!.trigger('click')
  await flushPromises()
  expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/resend-confirmation')
})
```

`ManualVisitDialog` 的測試加到同檔：

```ts
it('補登一定要選場次', async () => {
  vi.spyOn(api, 'get').mockResolvedValue([] as never)
  const wrapper = mount(ManualVisitDialog, { props: { campusKeys: ['yihua'], modelValue: true }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await flushPromises()
  expect(document.body.textContent).toContain('參觀場次')
  expect(document.body.textContent).not.toContain('還沒談好時間就留空')
  wrapper.unmount()
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin && npx vitest run src/__tests__/selfBookingDetail.test.ts src/__tests__/visitDetails.test.ts`
Expected: FAIL。

- [ ] **Step 3：VisitDetailView**

1. `DetailAction` 刪 `'contacting'`；刪 `markContacting` 函式。
2. 加：

```ts
const parentMailNote = computed(() => {
  const email = detail.value?.email
  return email ? `會寄信通知家長（${maskEmail(email)}）。` : '這筆沒有 Email，請電話通知家長。'
})
```
   `maskEmail` 放 `labels.ts`（與官網同規則：`w***@domain`），一併 export。
3. `confirm()` 的確認文字改 `` `將把 ${detail.value?.parent_name} 排入 ${formatSlotWhen(slot)}，案件變成「預約正常」。${parentMailNote.value}` ``，標題「排入這個場次？」，按鈕「排入場次」；成功訊息 `已排入 ${formatSlotWhen(slot)}`；刪掉「記得告知家長」與自動帶入「已致電家長…」的聯絡紀錄草稿。
4. `cancel()`、`reschedule()` 的 `ElMessageBox.confirm` 訊息字串尾端接 `parentMailNote.value`（只在 `detail.status === 'confirmed'` 時接；舊需求取消不寄信）。
5. 模板：
   - `new`／`contacting` 分支：刪「開始聯絡（標為聯絡中）」按鈕；提示改「這是改版前的舊需求。選一個場次排入就成立，有 Email 會寄確認信給家長。」；主按鈕文字「排入場次」。
   - `pending_confirmation` 分支：刪「家長要改時間：退回聯絡中」按鈕；主按鈕文字改「確認這個場次」。
   - `confirmed` 分支的「完成參觀」「標記未到場」：改成 `text` 樣式按鈕、文字「標記已到場」「標記未到場」，放在改期與取消之後。
   - `ParentAccessLinkPanel` 加 `:status="detail.status" :email="detail.email ?? null"`。

- [ ] **Step 4：ParentAccessLinkPanel**

- props 加 `status: string`、`email: string | null`。
- 說明文字 `:98` 改：`家長送出預約時已收到這條連結{{ email ? '（也寄到信箱）' : '' }}，可以改場次、修改資料或取消（{{ deadlineHours ? `${parentDeadlineLabel(deadlineHours)}截止` : '截止時間依本校預約設定' }}）。`
- 有 `accessLink` 時顯示「目前連結有效到 {{ formatDateTime(accessLink.expires_at) }}」。
- 按鈕：`重寄確認信`（`v-if="canHandle && status === 'confirmed' && email"`），`重新產生連結並寄出`（取代原「產生連結」／「重新產生」文字）。
- 新函式：

```ts
async function resend() {
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${props.visitId}/resend-confirmation`)
    ElMessage.success('已排入寄送，約一分鐘內寄到家長信箱')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '重寄失敗，請稍後再試'))
  } finally {
    busy.value = false
  }
}
```
- `generate()` 的確認文字改「重新產生後，舊連結會立即失效，新連結會寄到家長信箱。」；成功後若 `created.value.emailed` 為 true，`ElMessage.success('新連結已寄到家長信箱')`。

- [ ] **Step 5：ManualVisitDialog**

- `el-form-item label="直接排入時段（選填）"` 改 `label="參觀場次" required`；`el-select` 去掉 `clearable`，placeholder「選擇場次」。
- 送出按鈕 `:disabled` 加 `|| !form.slot_id`；送出前若沒選場次 `ElMessage.warning('請選擇參觀場次')` 並 return。
- 成功訊息固定 `` `已補登，參觀時間 ${formatSlotWhen(created.slot)}` ``。
- Email 欄位下方加 `<span class="field-help">有填會寄確認信與修改連結給家長。</span>`。
- `bookingConsentReadiness.test.ts`、`receptionAndHistory.test.ts`、`ux20260928B2.test.ts` 若斷言「還沒談好時間就留空」或未選場次也能送出，改成先選場次。

- [ ] **Step 6：跑測試**

Run: `cd admin && npx vitest run src/__tests__/selfBookingDetail.test.ts src/__tests__/visitDetails.test.ts src/__tests__/ux20260928B2.test.ts src/__tests__/uxRound6.test.ts src/__tests__/receptionAndHistory.test.ts src/__tests__/bookingConsentReadiness.test.ts`
Expected: PASS。

- [ ] **Step 7：Commit（需授權）**

```bash
git add admin/src/views/VisitDetailView.vue admin/src/components/ParentAccessLinkPanel.vue \
  admin/src/components/ManualVisitDialog.vue admin/src/api/labels.ts admin/src/__tests__/selfBookingDetail.test.ts \
  admin/src/__tests__/visitDetails.test.ts admin/src/__tests__/ux20260928B2.test.ts \
  admin/src/__tests__/receptionAndHistory.test.ts admin/src/__tests__/bookingConsentReadiness.test.ts
git commit -m "feat(admin): 明細拿掉聯絡中、可重寄確認信，補登必選場次

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C3：各校預約方式

**Files:**
- Modify: `admin/src/views/BookingSettingsView.vue`（`form` 50–67、`MODES` 76–83、`load` 166–182、`save` 229–271、模板 295–318）
- Test: `admin/src/__tests__/settingsUx.test.ts`（「可啟用日期場次並以人工確認作為預設」）、`bookingConsentReadiness.test.ts`、`attentionExportDeadline.test.ts`（預約方式頁三個 it 與「家長線上取消／改期期限」describe）

**Interfaces:** Consumes `BookingConfigOut.parent_email_enabled`；`BookingConfigUpdateRequest` 已無 `slots_auto_confirm`。

- [ ] **Step 1：改測試**

- `settingsUx.test.ts` 那個 it 改名「自選場次沒有人工確認開關，並顯示確認信狀態」，斷言：頁面沒有「送出後自動確認預約」、沒有「線上表單（收到需求後由園方聯絡）」；fixture `parent_email_enabled: false` 時出現「尚未設定寄信，家長只會在畫面上看到修改連結」，`true` 時出現「確認信：已啟用」；PATCH body 不含 `slots_auto_confirm`。
- 其他檔 fixture 的 `mode: 'inquiry'` 改 `'slots'` 或 `'paused'`，刪 `slots_auto_confirm`；斷言「時段與容量」字樣改「參觀場次」。

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin && npx vitest run src/__tests__/settingsUx.test.ts src/__tests__/bookingConsentReadiness.test.ts src/__tests__/attentionExportDeadline.test.ts`
Expected: FAIL。

- [ ] **Step 3：實作**

- `form` 刪 `slots_auto_confirm`；`load` 與 `save` 的 body 同步刪。
- `MODES` 刪 inquiry 那一項；slots 放第一個：

```ts
{ value: 'slots', label: BOOKING_MODE_LABELS.slots!, help: '家長看得到你開放的場次，選好送出即預約成功，並收到確認信與修改連結。場次在「參觀場次」設定。' },
```
- `labels.ts` 的 `BOOKING_MODE_LABELS.slots` 改 `'自選場次（家長線上預約）'`；`inquiry` 保留（歷史稽核紀錄仍會顯示），改成 `'線上表單（已停用）'`。
- 刪 `場次確認方式` 那個 `el-form-item`；在模式 radio 下方加：

```html
<p v-if="form.mode === 'slots'" class="hint">
  {{ config.parent_email_enabled ? '確認信：已啟用。家長送出後會收到確認信與修改連結。' : '尚未設定寄信，家長只會在畫面上看到修改連結。' }}
  <router-link :to="sessionsPath">設定參觀場次</router-link>
</p>
```
- `slotsPath` 改名 `sessionsPath`，值 `` `/visit-calendar?campus=${encodeURIComponent(selectedCampus.value)}` ``。
- 家長修改期限的說明改「參觀前幾小時內，家長不能再線上改場次、修改資料或取消」。

- [ ] **Step 4：跑測試**

Run: 同 Step 2。Expected: PASS。

- [ ] **Step 5：Commit（需授權）**

```bash
git add admin/src/views/BookingSettingsView.vue admin/src/api/labels.ts admin/src/__tests__/settingsUx.test.ts \
  admin/src/__tests__/bookingConsentReadiness.test.ts admin/src/__tests__/attentionExportDeadline.test.ts
git commit -m "feat(admin): 預約方式拿掉填表待聯絡與人工確認，顯示確認信狀態

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C4：每週規則⇄場次換算（純函式）

**Files:**
- Create: `admin/src/utils/sessions.ts`
- Test: `admin/src/__tests__/sessions.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RuleRow { weekday: number; start_time: string; end_time: string; slot_minutes: number; capacity: number }
export interface Session { start: string; minutes: number; capacity: number; weekdays: number[] }  // start 'HH:MM'；weekdays 0＝週一（同後端 Python weekday）
export const WEEKDAY_NAMES: readonly string[]            // ['一','二','三','四','五','六','日']
export const COMMON_SESSIONS: readonly Session[]         // 上午場 10:00、下午場 14:30，週一到週五，每場 1 組，60 分鐘
export function ruleWindows(rule: RuleRow): { start: string; end: string }[]
export function rulesToSessions(rules: RuleRow[]): Session[]
export function sessionsToRules(sessions: Session[]): RuleRow[]
export function sessionName(start: string): string       // '上午場 10:00'
export function weekdaySummary(weekdays: number[]): string
export function sessionProblems(sessions: Session[]): string[]
```

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/sessions.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { COMMON_SESSIONS, ruleWindows, rulesToSessions, sessionName, sessionProblems, sessionsToRules, weekdaySummary, type RuleRow } from '../utils/sessions'

const rule = (weekday: number, start: string, end: string, slot_minutes = 60, capacity = 1): RuleRow =>
  ({ weekday, start_time: `${start}:00`, end_time: `${end}:00`, slot_minutes, capacity })

function windows(rules: RuleRow[]) {
  return rules.flatMap(r => ruleWindows(r).map(w => `${r.weekday} ${w.start}-${w.end} ×${r.capacity}`)).sort()
}

describe('每週規則與場次互換', () => {
  it('weekday 0 is Monday（與後端 Python weekday 相同）', () => {
    const sessions = rulesToSessions([rule(0, '10:00', '11:00')])
    expect(sessions[0]!.weekdays).toEqual([0])
    expect(weekdaySummary([0])).toBe('週一')
    expect(weekdaySummary([6])).toBe('週日')
  })

  it('同時間同名額的規則合併成一個場次', () => {
    const rules = [0, 1, 2, 3, 4].flatMap(d => [rule(d, '10:00', '11:00'), rule(d, '14:30', '15:30')])
    expect(rulesToSessions(rules)).toEqual([
      { start: '10:00', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
      { start: '14:30', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
    ])
  })

  it('round-trips a range rule whose length is not a multiple of the slot length', () => {
    const legacy = [rule(2, '09:30', '11:00', 40, 2)]  // 後端只產生 09:30–10:10、10:10–10:50
    expect(ruleWindows(legacy[0]!)).toEqual([{ start: '09:30', end: '10:10' }, { start: '10:10', end: '10:50' }])
    const sessions = rulesToSessions(legacy)
    expect(sessions.map(s => s.start)).toEqual(['09:30', '10:10'])
    expect(windows(sessionsToRules(sessions))).toEqual(windows(legacy))
  })

  it('重疊的規則以先排的名額為準（同後端 rule_window_map）', () => {
    const rules = [rule(0, '10:00', '11:00', 60, 3), rule(0, '10:00', '11:00', 60, 1)]
    expect(rulesToSessions(rules)).toEqual([{ start: '10:00', minutes: 60, capacity: 3, weekdays: [0] }])
  })

  it('星期摘要：連續寫區間，不連續用頓號，七天寫每天', () => {
    expect(weekdaySummary([0, 1, 2, 3, 4])).toBe('週一–週五')
    expect(weekdaySummary([0, 2, 4])).toBe('週一、週三、週五')
    expect(weekdaySummary([0, 1, 2, 3, 4, 5, 6])).toBe('每天')
    expect(weekdaySummary([])).toBe('未選星期')
  })

  it('場次名稱 12:00 起是下午場', () => {
    expect(sessionName('11:30')).toBe('上午場 11:30')
    expect(sessionName('12:00')).toBe('下午場 12:00')
  })

  it('常用場次是上午場 10:00、下午場 14:30，週一到週五，每場 1 組', () => {
    expect(COMMON_SESSIONS).toEqual([
      { start: '10:00', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
      { start: '14:30', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
    ])
  })

  it('檢查：沒選星期、同一天時間重疊、超過午夜', () => {
    expect(sessionProblems([{ start: '10:00', minutes: 60, capacity: 1, weekdays: [] }])).toContain('上午場 10:00 還沒選星期')
    expect(sessionProblems([
      { start: '10:00', minutes: 60, capacity: 1, weekdays: [0] },
      { start: '10:30', minutes: 60, capacity: 1, weekdays: [0, 1] },
    ])).toContain('週一的上午場 10:00 與上午場 10:30 時間重疊')
    expect(sessionProblems([{ start: '23:30', minutes: 60, capacity: 1, weekdays: [0] }])).toContain('下午場 23:30 會超過午夜')
    expect(sessionProblems(COMMON_SESSIONS as never)).toEqual([])
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin && npx vitest run src/__tests__/sessions.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3：實作**

`admin/src/utils/sessions.ts`：

```ts
// 「參觀場次」頁以場次為單位設定每週固定場次；後端仍存每週規則（visit_rules）。
// 換算必須和後端 schedule_service.rule_windows／rule_window_map 產生完全相同的時段，
// 否則存檔時 sync_rule_slots 會刪建場次。weekday 0＝週一（Python weekday）。

export interface RuleRow { weekday: number; start_time: string; end_time: string; slot_minutes: number; capacity: number }
export interface Session { start: string; minutes: number; capacity: number; weekdays: number[] }

export const WEEKDAY_NAMES: readonly string[] = ['一', '二', '三', '四', '五', '六', '日']
export const COMMON_SESSIONS: readonly Session[] = [
  { start: '10:00', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
  { start: '14:30', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
]

function toMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number)
  return h! * 60 + m!
}
function toClock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function ruleWindows(rule: RuleRow): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = []
  const end = toMinutes(rule.end_time)
  if (rule.slot_minutes <= 0) return out
  for (let cursor = toMinutes(rule.start_time); cursor + rule.slot_minutes <= end; cursor += rule.slot_minutes) {
    out.push({ start: toClock(cursor), end: toClock(cursor + rule.slot_minutes) })
  }
  return out
}

export function rulesToSessions(rules: RuleRow[]): Session[] {
  // 先排的規則優先（後端 list_rules 依 weekday, start_time 排序，rule_window_map 用 setdefault）。
  const ordered = [...rules].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
  const windows = new Map<string, number>()
  for (const rule of ordered) {
    for (const w of ruleWindows(rule)) {
      const key = `${rule.weekday}|${w.start}|${w.end}`
      if (!windows.has(key)) windows.set(key, rule.capacity)
    }
  }
  const sessions = new Map<string, Session>()
  for (const [key, capacity] of windows) {
    const [weekday, start, end] = key.split('|')
    const minutes = toMinutes(end!) - toMinutes(start!)
    const id = `${start}|${minutes}|${capacity}`
    const session = sessions.get(id) ?? { start: start!, minutes, capacity, weekdays: [] }
    session.weekdays.push(Number(weekday))
    sessions.set(id, session)
  }
  return [...sessions.values()]
    .map(s => ({ ...s, weekdays: [...new Set(s.weekdays)].sort((a, b) => a - b) }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.minutes - b.minutes || a.capacity - b.capacity)
}

export function sessionsToRules(sessions: Session[]): RuleRow[] {
  return sessions
    .flatMap(s => s.weekdays.map(weekday => ({
      weekday,
      start_time: `${s.start}:00`,
      end_time: `${toClock(toMinutes(s.start) + s.minutes)}:00`,
      slot_minutes: s.minutes,
      capacity: s.capacity,
    })))
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
}

export function sessionName(start: string): string {
  const hhmm = start.slice(0, 5)
  return `${Number(hhmm.slice(0, 2)) < 12 ? '上午場' : '下午場'} ${hhmm}`
}

export function weekdaySummary(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  if (!days.length) return '未選星期'
  if (days.length === 7) return '每天'
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1]! + 1)
  if (contiguous && days.length >= 3) return `週${WEEKDAY_NAMES[days[0]!]}–週${WEEKDAY_NAMES[days[days.length - 1]!]}`
  return days.map(d => `週${WEEKDAY_NAMES[d]}`).join('、')
}

export function sessionProblems(sessions: Session[]): string[] {
  const problems: string[] = []
  for (const s of sessions) {
    if (!s.weekdays.length) problems.push(`${sessionName(s.start)} 還沒選星期`)
    if (toMinutes(s.start) + s.minutes > 24 * 60) problems.push(`${sessionName(s.start)} 會超過午夜`)
  }
  for (let day = 0; day < 7; day++) {
    const today = sessions.filter(s => s.weekdays.includes(day)).sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < today.length; i++) {
      const prev = today[i - 1]!
      if (toMinutes(prev.start) + prev.minutes > toMinutes(today[i]!.start)) {
        problems.push(`週${WEEKDAY_NAMES[day]}的${sessionName(prev.start)} 與${sessionName(today[i]!.start)} 時間重疊`)
      }
    }
  }
  return [...new Set(problems)]
}
```

注意：`sessionProblems` 的重疊訊息格式要與測試一致——`週一的上午場 10:00 與上午場 10:30 時間重疊`（`與` 前有空格、後無空格）。實作若調整字串，測試一起改，但兩邊要一致。

- [ ] **Step 4：跑測試**

Run: `cd admin && npx vitest run src/__tests__/sessions.test.ts`
Expected: PASS。

- [ ] **Step 5：Commit（需授權）**

```bash
git add admin/src/utils/sessions.ts admin/src/__tests__/sessions.test.ts
git commit -m "feat(admin): 每週規則與參觀場次的互相換算

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C5：固定場次卡（WeeklySessionsCard）

**Files:**
- Create: `admin/src/components/sessions/WeeklySessionsCard.vue`
- Modify: `admin/src/api/labels.ts`（`leadLabel`、`advanceLabel`、`LEAD_OPTIONS`、`ADVANCE_OPTIONS`；`slotSyncLines` 加 `created`）
- Test: `admin/src/__tests__/weeklySessions.test.ts`

**Interfaces:**
- Consumes: C4 全部；API `GET/PUT /admin/visit-schedule/{campus}`（`VisitScheduleOut`、`slot_sync.created`）、`GET/PATCH /admin/booking-config/{campus}`。
- Produces（元件）：props `{ campusKey: string; canManage: boolean; canConfigureBooking: boolean }`；emits `saved`（存檔後父層重讀月曆）；`defineExpose({ confirmLeave })`。
- Produces（labels.ts）：`LEAD_OPTIONS = [2, 12, 24, 48, 72]`、`ADVANCE_OPTIONS = [14, 30, 60, 90]`、`leadLabel(hours: number): string`（24→`參觀前 1 天`、2→`參觀前 2 小時`）、`advanceLabel(days: number): string`（60→`2 個月內`、14→`2 週內`）。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/weeklySessions.test.ts`（掛載用 `mount(WeeklySessionsCard, { props, global: { plugins: [createPinia(), ElementPlus] }, attachTo: document.body })`，登入者用 `testUser('campus_admin', { campus_keys: ['yihua'] })` 放進 auth store）：

```ts
const schedule = (rules: unknown[] = []) => ({ campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules, exceptions: [], version: 4 })

it('沒有場次時提供「套用常用場次」，帶入後可存', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-schedule') ? schedule() : { mode: 'slots', version: 2, parent_email_enabled: false }) as never)
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...schedule(), slot_sync: { created: 86, removed: 0, closed: 0, reopened: 0, capacity_updated: 0, kept_booked: 0 } } as never)
  const wrapper = await mountCard({ canManage: true, canConfigureBooking: true })

  await buttonByText(wrapper, '套用常用場次').trigger('click')
  await buttonByText(wrapper, '儲存').trigger('click')
  await flushPromises()

  expect(put.mock.calls[0]![1]).toMatchObject({ expected_version: 4, min_lead_hours: 24, max_advance_days: 60 })
  expect((put.mock.calls[0]![1] as { rules: unknown[] }).rules).toHaveLength(10)
  expect(document.body.textContent).toContain('已排出 86 場')
  expect(get).toHaveBeenCalled()
})

it('摘要一行一個場次', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-schedule') ? schedule([0, 1, 2, 3, 4].map(weekday => ({ weekday, start_time: '10:00:00', end_time: '11:00:00', slot_minutes: 60, capacity: 1 }))) : { mode: 'slots', version: 2 }) as never)
  const wrapper = await mountCard({ canManage: true, canConfigureBooking: true })

  expect(wrapper.text()).toContain('上午場 10:00・每場 1 組・週一–週五')
  expect(wrapper.text()).toContain('家長最晚參觀前 1 天預約，可預約 2 個月內的場次')
})

it('分校還沒開放線上預約：存檔鈕寫「儲存並開放線上預約」，存完切成自選場次', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-schedule') ? schedule() : { mode: 'paused', version: 7, message: '暫停' }) as never)
  vi.spyOn(api, 'put').mockResolvedValue({ ...schedule(), slot_sync: { created: 10 } } as never)
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ mode: 'slots', version: 8 } as never)
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const wrapper = await mountCard({ canManage: true, canConfigureBooking: true })

  await buttonByText(wrapper, '套用常用場次').trigger('click')
  await buttonByText(wrapper, '儲存並開放線上預約').trigger('click')
  await flushPromises()

  expect(patch).toHaveBeenCalledWith('/admin/booking-config/yihua', expect.objectContaining({ expected_version: 7, mode: 'slots' }))
})

it('開放失敗時場次已存好，並列出還缺什麼', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-schedule') ? schedule() : { mode: 'paused', version: 7, message: '暫停' }) as never)
  vi.spyOn(api, 'put').mockResolvedValue({ ...schedule(), slot_sync: { created: 10 } } as never)
  vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(400, { code: 'BOOKING_MODE_NOT_READY', reasons: [{ code: 'CONSENT_NOT_PUBLISHED', message: '預約同意文字尚未發布' }] }))
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const wrapper = await mountCard({ canManage: true, canConfigureBooking: true })

  await buttonByText(wrapper, '套用常用場次').trigger('click')
  await buttonByText(wrapper, '儲存並開放線上預約').trigger('click')
  await flushPromises()

  expect(document.body.textContent).toContain('場次已儲存')
  expect(document.body.textContent).toContain('預約同意文字尚未發布')
})

it('只有場次權限（不能改預約方式）時只存場次並提示找校區管理者', async () => {
  vi.spyOn(api, 'get').mockImplementation(async () => schedule() as never)
  const wrapper = await mountCard({ canManage: true, canConfigureBooking: false })

  await buttonByText(wrapper, '套用常用場次').trigger('click')
  expect(wrapper.text()).toContain('儲存')
  expect(wrapper.text()).not.toContain('儲存並開放線上預約')
})

it('接待人員只看摘要，沒有修改鈕', async () => {
  vi.spyOn(api, 'get').mockImplementation(async () => schedule([{ weekday: 0, start_time: '10:00:00', end_time: '11:00:00', slot_minutes: 60, capacity: 1 }]) as never)
  const wrapper = await mountCard({ canManage: false, canConfigureBooking: false })

  expect(wrapper.findAll('button').some(b => b.text() === '修改場次')).toBe(false)
})
```
（`mountCard`、`buttonByText` 寫在該測試檔頂端：`buttonByText = (w, text) => w.findAll('button').find(b => b.text() === text)!`；按鈕若渲染在 teleport 的 dialog 內，改用 `document.body.querySelectorAll('button')`。）

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin && npx vitest run src/__tests__/weeklySessions.test.ts`
Expected: FAIL。

- [ ] **Step 3：labels.ts**

```ts
export const LEAD_OPTIONS = [2, 12, 24, 48, 72] as const
export const ADVANCE_OPTIONS = [14, 30, 60, 90] as const
export function leadLabel(hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? `參觀前 ${hours / 24} 天` : `參觀前 ${hours} 小時`
}
export function advanceLabel(days: number): string {
  if (days === 14) return '2 週內'
  if (days % 30 === 0) return `${days / 30} 個月內`
  return `${days} 天內`
}
```
`SlotSyncResult` 加 `created?: number`；`slotSyncLines` 第一行加 `sync.created ? \`已排出 ${sync.created} 場\` : ''`。

- [ ] **Step 4：元件**

`admin/src/components/sessions/WeeklySessionsCard.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../../api/client'
import { isVersionConflict } from '../../api/errors'
import { ADVANCE_OPTIONS, LEAD_OPTIONS, advanceLabel, leadLabel, slotSyncLines, type SlotSyncResult } from '../../api/labels'
import { useUnsavedChanges } from '../../composables/useUnsavedChanges'
import { COMMON_SESSIONS, WEEKDAY_NAMES, rulesToSessions, sessionName, sessionProblems, sessionsToRules, weekdaySummary, type RuleRow, type Session } from '../../utils/sessions'

interface Schedule { campus_key: string; min_lead_hours: number; max_advance_days: number; rules: RuleRow[]; version: number; slot_sync?: Partial<SlotSyncResult> | null }
interface BookingConfig { mode: string; version: number }
interface Reason { code: string; message: string }

const props = defineProps<{ campusKey: string; canManage: boolean; canConfigureBooking: boolean }>()
const emit = defineEmits<{ saved: [] }>()

const TIME_OPTIONS = Array.from({ length: 23 }, (_, i) => {
  const total = 7 * 60 + i * 30
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})
const MINUTE_OPTIONS = [30, 45, 60, 90, 120]
const CAPACITY_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)

const schedule = ref<Schedule | null>(null)
const bookingConfig = ref<BookingConfig | null>(null)
const loadError = ref('')
const editing = ref(false)
const saving = ref(false)
const sessions = ref<Session[]>([])
const leadHours = ref(24)
const advanceDays = ref(60)
const snapshot = ref('')
const notReady = ref<Reason[]>([])

const savedSessions = computed(() => rulesToSessions(schedule.value?.rules ?? []))
const uniformMinutes = computed(() => new Set(sessions.value.map(s => s.minutes)).size <= 1)
const problems = computed(() => sessionProblems(sessions.value))
const isDirty = computed(() => editing.value && JSON.stringify([sessions.value, leadHours.value, advanceDays.value]) !== snapshot.value)
const opensBooking = computed(() => props.canConfigureBooking && bookingConfig.value !== null && bookingConfig.value.mode !== 'slots')
const { confirmLeave } = useUnsavedChanges(isDirty, saving)
defineExpose({ confirmLeave })

async function load() {
  loadError.value = ''
  try {
    schedule.value = await api.get<Schedule>(`/admin/visit-schedule/${props.campusKey}`)
    bookingConfig.value = props.canConfigureBooking ? await api.get<BookingConfig>(`/admin/booking-config/${props.campusKey}`) : null
  } catch {
    loadError.value = '讀不到這個校區的場次設定，請重新載入。'
  }
}
watch(() => props.campusKey, () => { editing.value = false; notReady.value = []; void load() }, { immediate: true })

function startEdit(preset?: readonly Session[]) {
  sessions.value = (preset ?? savedSessions.value).map(s => ({ ...s, weekdays: [...s.weekdays] }))
  leadHours.value = schedule.value?.min_lead_hours ?? 24
  advanceDays.value = schedule.value?.max_advance_days ?? 60
  snapshot.value = preset ? '' : JSON.stringify([sessions.value, leadHours.value, advanceDays.value])
  notReady.value = []
  editing.value = true
}
function addSession() {
  const last = sessions.value[sessions.value.length - 1]
  sessions.value.push({ start: last ? '14:30' : '10:00', minutes: last?.minutes ?? 60, capacity: last?.capacity ?? 1, weekdays: last ? [...last.weekdays] : [0, 1, 2, 3, 4] })
}
function toggleDay(session: Session, day: number) {
  session.weekdays = session.weekdays.includes(day) ? session.weekdays.filter(d => d !== day) : [...session.weekdays, day].sort((a, b) => a - b)
}
function setAllMinutes(minutes: number) {
  sessions.value.forEach(s => { s.minutes = minutes })
}
function timeOptions(current: string) {
  return TIME_OPTIONS.includes(current) ? TIME_OPTIONS : [...TIME_OPTIONS, current].sort()
}

async function save() {
  if (!schedule.value || problems.value.length || saving.value) return
  if (opensBooking.value) {
    try {
      await ElMessageBox.confirm('家長從現在起可以在官網預約這些場次。', '儲存並開放線上預約？', { confirmButtonText: '儲存並開放', cancelButtonText: '先不要', type: 'info' })
    } catch { return }
  }
  saving.value = true
  notReady.value = []
  try {
    const result = await api.put<Schedule>(`/admin/visit-schedule/${props.campusKey}`, {
      expected_version: schedule.value.version,
      min_lead_hours: leadHours.value,
      max_advance_days: advanceDays.value,
      rules: sessionsToRules(sessions.value),
    })
    schedule.value = result
    editing.value = false
    const lines = slotSyncLines(result.slot_sync)
    ElMessage.success(lines.length ? `已儲存，${lines.join('，')}` : '已儲存')
    emit('saved')
    if (opensBooking.value) await openBooking()
  } catch (err) {
    if (isVersionConflict(err)) {
      ElMessage.warning('場次剛被其他人修改，已重新載入最新設定')
      await load()
      startEdit()
    } else {
      ElMessage.error('儲存失敗，請稍後再試')
    }
  } finally {
    saving.value = false
  }
}

async function openBooking() {
  try {
    const config = await api.get<BookingConfig>(`/admin/booking-config/${props.campusKey}`)
    bookingConfig.value = await api.patch<BookingConfig>(`/admin/booking-config/${props.campusKey}`, { expected_version: config.version, mode: 'slots' })
    ElMessage.success('已開放線上預約')
  } catch (err) {
    const detail = err instanceof ApiError ? (err.detail as { code?: string; reasons?: Reason[] } | null) : null
    notReady.value = detail?.code === 'BOOKING_MODE_NOT_READY' ? detail.reasons ?? [] : [{ code: 'UNKNOWN', message: '開放線上預約失敗，請到「各校預約方式」再試一次' }]
  }
}
</script>

<template>
  <section class="panel sessions-card" aria-labelledby="sessions-card-title">
    <div class="panel__head">
      <h2 id="sessions-card-title">每週固定場次</h2>
      <el-button v-if="canManage && !editing && savedSessions.length" @click="startEdit()">修改場次</el-button>
    </div>
    <div class="panel__body">
      <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError"><el-button size="small" @click="load">重新載入</el-button></el-alert>

      <template v-else-if="!editing">
        <template v-if="savedSessions.length">
          <ul class="sessions-card__summary">
            <li v-for="s in savedSessions" :key="`${s.start}-${s.minutes}-${s.capacity}`">{{ sessionName(s.start) }}・每場 {{ s.capacity }} 組・{{ weekdaySummary(s.weekdays) }}</li>
          </ul>
          <p class="hint">家長最晚{{ leadLabel(schedule?.min_lead_hours ?? 24) }}預約，可預約 {{ advanceLabel(schedule?.max_advance_days ?? 60) }}的場次。</p>
        </template>
        <div v-else-if="schedule" class="sessions-card__empty">
          <p>還沒有固定場次。常用的是上午場 10:00、下午場 14:30，週一到週五，每場 1 組。</p>
          <el-button v-if="canManage" type="primary" @click="startEdit(COMMON_SESSIONS)">套用常用場次</el-button>
          <el-button v-if="canManage" @click="startEdit([])">自己設定</el-button>
          <p v-else class="hint">場次由校區管理者設定。</p>
        </div>
        <el-alert v-if="notReady.length" type="warning" :closable="false" show-icon title="場次已儲存，但還不能開放線上預約">
          <ul><li v-for="r in notReady" :key="r.code">{{ r.message }}</li></ul>
          <router-link :to="`/booking?campus=${encodeURIComponent(campusKey)}`">到各校預約方式查看 →</router-link>
        </el-alert>
      </template>

      <form v-else class="sessions-card__edit" @submit.prevent="save">
        <div v-for="(s, index) in sessions" :key="index" class="session-row">
          <label class="session-row__field"><span>場次時間</span>
            <el-select v-model="s.start" class="session-row__time" :aria-label="`第 ${index + 1} 個場次的時間`">
              <el-option v-for="t in timeOptions(s.start)" :key="t" :label="t" :value="t" />
            </el-select>
            <span class="session-row__name">{{ sessionName(s.start).split(' ')[0] }}</span>
          </label>
          <label class="session-row__field"><span>每場組數</span>
            <el-select v-model="s.capacity" class="session-row__capacity" :aria-label="`第 ${index + 1} 個場次每場幾組`">
              <el-option v-for="n in (CAPACITY_OPTIONS.includes(s.capacity) ? CAPACITY_OPTIONS : [...CAPACITY_OPTIONS, s.capacity])" :key="n" :label="`${n} 組`" :value="n" />
            </el-select>
          </label>
          <div class="session-row__days" role="group" :aria-label="`第 ${index + 1} 個場次開放的星期`">
            <button v-for="(name, day) in WEEKDAY_NAMES" :key="day" type="button" class="day-toggle" :aria-pressed="s.weekdays.includes(day)" @click="toggleDay(s, day)">{{ name }}</button>
          </div>
          <label v-if="!uniformMinutes" class="session-row__field"><span>每場多久</span>
            <el-select v-model="s.minutes"><el-option v-for="m in MINUTE_OPTIONS" :key="m" :label="`${m} 分鐘`" :value="m" /></el-select>
          </label>
          <el-button text :aria-label="`刪除${sessionName(s.start)}`" @click="sessions.splice(index, 1)">刪除</el-button>
        </div>
        <el-button @click="addSession">＋新增場次</el-button>

        <details class="sessions-card__advanced">
          <summary>進階設定</summary>
          <label v-if="uniformMinutes && sessions.length"><span>每場參觀約多久</span>
            <el-select :model-value="sessions[0]!.minutes" @update:model-value="setAllMinutes"><el-option v-for="m in MINUTE_OPTIONS" :key="m" :label="`${m} 分鐘`" :value="m" /></el-select>
          </label>
          <label><span>家長最晚何時預約</span>
            <el-select v-model="leadHours"><el-option v-for="h in (LEAD_OPTIONS as readonly number[]).includes(leadHours) ? LEAD_OPTIONS : [...LEAD_OPTIONS, leadHours]" :key="h" :label="leadLabel(h)" :value="h" /></el-select>
          </label>
          <label><span>最多可預約多久以後</span>
            <el-select v-model="advanceDays"><el-option v-for="d in (ADVANCE_OPTIONS as readonly number[]).includes(advanceDays) ? ADVANCE_OPTIONS : [...ADVANCE_OPTIONS, advanceDays]" :key="d" :label="advanceLabel(d)" :value="d" /></el-select>
          </label>
        </details>

        <ul v-if="problems.length" class="sessions-card__problems" role="alert"><li v-for="p in problems" :key="p">{{ p }}</li></ul>
        <div class="sessions-card__actions">
          <el-button @click="editing = false">取消</el-button>
          <el-button type="primary" native-type="submit" :loading="saving" :disabled="Boolean(problems.length) || !sessions.length">{{ opensBooking ? '儲存並開放線上預約' : '儲存' }}</el-button>
          <span v-if="!canConfigureBooking" class="hint">要讓家長在官網預約，請校區管理者到「各校預約方式」開放。</span>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.sessions-card__summary { margin: 0 0 8px; padding-left: 1.2em; }
.sessions-card__empty { display: grid; gap: 8px; justify-items: start; }
.session-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.session-row__field { display: grid; gap: 4px; }
.session-row__time { width: 110px; }
.session-row__capacity { width: 96px; }
.session-row__days { display: flex; gap: 4px; }
.day-toggle { min-width: 36px; min-height: 36px; border: 1px solid var(--line-strong); border-radius: 18px; background: var(--surface); color: var(--ink); }
.day-toggle[aria-pressed='true'] { background: var(--admin-accent); color: var(--surface); border-color: var(--admin-accent); }
.sessions-card__advanced { margin-top: 12px; }
.sessions-card__advanced label { display: grid; gap: 4px; margin-top: 8px; max-width: 240px; }
.sessions-card__problems { color: var(--el-color-danger); }
.sessions-card__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
</style>
```
（token 皆定義在 `admin/src/style.css`；不要新增字面顏色。按鈕高度至少 36px，手機可點。）

- [ ] **Step 5：跑測試**

Run: `cd admin && npx vitest run src/__tests__/weeklySessions.test.ts`
Expected: PASS。

- [ ] **Step 6：Commit（需授權）**

```bash
git add admin/src/components/sessions/WeeklySessionsCard.vue admin/src/api/labels.ts admin/src/__tests__/weeklySessions.test.ts
git commit -m "feat(admin): 固定場次卡，以場次為單位設定並可一鍵開放線上預約

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C6：參觀場次頁（月曆與當天清單）、路由與移除時段頁

**Files:**
- Create: `admin/src/utils/calendarChips.ts`、`admin/src/components/sessions/DayPanel.vue`
- Rewrite: `admin/src/views/VisitCalendarView.vue`
- Modify: `admin/src/router/index.ts`（58–66 行）、`admin/src/router/nav.ts`（59–65 行）
- Delete: `admin/src/views/VisitSlotsView.vue`、`admin/src/components/VisitSchedulePanel.vue`、`admin/src/__tests__/scheduleRuleSync.test.ts`
- Test: 新增 `admin/src/__tests__/calendarChips.test.ts`、`admin/src/__tests__/visitSessionsPage.test.ts`；修改 `ux20260928B1.test.ts`（月曆兩個 it）、`attentionExportDeadline.test.ts`（休假日三個 it）、`editVersionsUx.test.ts`（三個 it）、`listUx.test.ts`（「同一天的場次共用一個日期…」）、`permissionsUx.test.ts`（「時段與容量」describe 與「櫃台：…時段只能查看」）、`workflowFeatures.test.ts`（「新增規則後儲存…」）、`ux20260928A.test.ts`（搜尋 538–583 行）

**Interfaces:**
- Consumes: C4、C5；API `GET /admin/visit-calendar`（`CalendarSlotOut` 含 `version`、`closed_source`）、`GET /admin/visit-schedule/{campus}`（`exceptions`）、`PATCH /admin/slots/{id}`（`{closed?, capacity?, expected_version}`）、`POST /admin/slots?campus_key=`、`POST/DELETE /admin/visit-schedule/{campus}/exceptions[/{id}]`。
- Produces（calendarChips.ts）：

```ts
export interface CalendarVisit { id: string; status: string; parent_name: string; child_name: string | null; phone: string; source: string; assigned_staff_id: string | null; party_size?: number | null }
export interface CalendarSlot { id: string; campus_key: string; slot_date: string; start_time: string; end_time: string; capacity: number; closed: boolean; closed_source?: string | null; version: number; booked_count: number; visits: CalendarVisit[] }
export type ChipKind = 'visit' | 'stopped' | 'open'
export interface Chip { key: string; kind: ChipKind; text: string; ended: boolean; status?: string }
export function dayChips(slots: CalendarSlot[], now?: number): Chip[]
export function dayAriaLabel(day: string, slots: CalendarSlot[], holidayReason: string | null, now?: number): string
```

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/calendarChips.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { dayAriaLabel, dayChips, type CalendarSlot } from '../utils/calendarChips'

const NOW = new Date('2026-10-05T09:00:00+08:00').getTime()
const slot = (changes: Partial<CalendarSlot> = {}): CalendarSlot => ({
  id: 's1', campus_key: 'yihua', slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00',
  capacity: 2, closed: false, closed_source: null, version: 1, booked_count: 0, visits: [], ...changes,
})
const visit = (id: string, parent_name: string, status = 'confirmed') =>
  ({ id, status, parent_name, child_name: null, phone: '0911222333', source: 'web', assigned_staff_id: null })

describe('月曆格子的色塊（參考義華行事曆）', () => {
  it('有預約：每位一塊，寫場次名稱與家長', () => {
    const chips = dayChips([slot({ booked_count: 1, visits: [visit('v1', '王小明')] })], NOW)
    expect(chips).toEqual([{ key: 'v1', kind: 'visit', text: '上午場 王小明', ended: false, status: 'confirmed' }])
  })

  it('停止申請：紅色；已約的家長仍列出', () => {
    const chips = dayChips([slot({ closed: true, closed_source: 'manual', booked_count: 1, visits: [visit('v1', '王小明')] })], NOW)
    expect(chips.map(c => [c.kind, c.text])).toEqual([['visit', '上午場 王小明'], ['stopped', '上午場停止申請']])
  })

  it('開放中沒人約：寫可約幾組；休假日關閉的場次不另外畫', () => {
    expect(dayChips([slot({ start_time: '14:30:00', end_time: '15:30:00' })], NOW)).toEqual([{ key: 's1-open', kind: 'open', text: '下午場 可約 2', ended: false }])
    expect(dayChips([slot({ closed: true, closed_source: 'exception' })], NOW)).toEqual([])
  })

  it('已結束的場次標 ended，不再寫可約', () => {
    const chips = dayChips([slot({ slot_date: '2026-10-04' })], NOW)
    expect(chips).toEqual([])
    expect(dayChips([slot({ slot_date: '2026-10-04', booked_count: 1, visits: [visit('v1', '王小明', 'completed')] })], NOW)[0]!.ended).toBe(true)
  })

  it('朗讀文字說出預約、停止申請與休假', () => {
    expect(dayAriaLabel('2026-10-06', [slot({ booked_count: 1, visits: [visit('v1', '王小明')] })], null, NOW)).toContain('排入 1 組，可約 1 組')
    expect(dayAriaLabel('2026-10-06', [slot({ closed: true, closed_source: 'manual' })], null, NOW)).toContain('1 場停止申請')
    expect(dayAriaLabel('2026-10-06', [], '教師研習', NOW)).toContain('休假：教師研習')
  })
})
```

`admin/src/__tests__/visitSessionsPage.test.ts`（掛載用 `mountAt(VisitCalendarView, '/visit-calendar?campus=yihua', campusAdmin())`，`api.get` 依路徑回 calendar、schedule、booking-config）：

```ts
it('停止申請直接生效並帶版本；已約的家長照常參觀', async () => {
  const booked = slot({ id: 's1', booked_count: 1, visits: [visit('v1', '王小明')] })
  mockGets({ calendar: [booked] })
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...booked, closed: true, version: 2 } as never)
  const { wrapper } = await mountPage()
  await selectDay(wrapper, '2026-10-06')

  await buttonByText(wrapper, '停止申請').trigger('click')
  await flushPromises()

  expect(patch).toHaveBeenCalledWith('/admin/slots/s1', { closed: true, expected_version: 1 })
  expect(document.body.textContent).toContain('已約好的 1 組家長照常參觀')
})

it('已停止的場次可以恢復開放；休假日關閉的場次要先取消休假', async () => {
  mockGets({ calendar: [slot({ id: 's1', closed: true, closed_source: 'manual' }), slot({ id: 's2', start_time: '14:30:00', end_time: '15:30:00', closed: true, closed_source: 'exception' })] })
  const { wrapper } = await mountPage()
  await selectDay(wrapper, '2026-10-06')

  expect(buttonsByText(wrapper, '恢復開放')).toHaveLength(1)
})

it('整天休假：有預約時先說明不會自動取消', async () => {
  mockGets({ calendar: [slot({ booked_count: 1, visits: [visit('v1', '王小明')] })] })
  const confirm = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '研習', action: 'confirm' } as never)
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'e1' } as never)
  const { wrapper } = await mountPage()
  await selectDay(wrapper, '2026-10-06')

  await buttonByText(wrapper, '整天休假').trigger('click')
  await flushPromises()

  expect(String(confirm.mock.calls[0]?.[0])).toContain('這天還有 1 組家長預約，設為休假後不會自動取消')
  expect(post).toHaveBeenCalledWith('/admin/visit-schedule/yihua/exceptions', { exception_date: '2026-10-06', reason: '研習' })
})

it('加開一場', async () => {
  mockGets({ calendar: [] })
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 's9' } as never)
  const { wrapper } = await mountPage()
  await selectDay(wrapper, '2026-10-06')

  await buttonByText(wrapper, '＋加開一場').trigger('click')
  await buttonByText(wrapper, '加開').trigger('click')
  await flushPromises()

  expect(post).toHaveBeenCalledWith('/admin/slots?campus_key=yihua', { slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 1 })
})

it('接待人員看得到名單，沒有停止申請、休假、加開', async () => {
  mockGets({ calendar: [slot({ booked_count: 1, visits: [visit('v1', '王小明')] })] })
  const { wrapper } = await mountPage(reception())
  await selectDay(wrapper, '2026-10-06')

  expect(wrapper.text()).toContain('王小明')
  for (const text of ['停止申請', '整天休假', '＋加開一場']) expect(buttonsByText(wrapper, text)).toHaveLength(0)
})

it('/slots 轉到參觀場次並保留校區', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/slots?campus=renwu')
  expect(router.currentRoute.value.fullPath).toBe('/visit-calendar?campus=renwu')
})
```
（`mockGets`、`mountPage`、`selectDay`、`buttonByText`、`buttonsByText`、`slot`、`visit`、`campusAdmin`、`reception` 寫在檔頂；`selectDay` 找 `aria-label` 以 `2026/10/06` 開頭的 `.calendar__day` 並 click；`vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T09:00:00+08:00'))`。`routes` 從 `../router` 匯入；若 `router/index.ts` 沒有匯出 `routes`，就 export 它。）

其他檔：
- `scheduleRuleSync.test.ts` 整檔刪除（功能移到 `sessions.test.ts`、`weeklySessions.test.ts`、`visitSessionsPage.test.ts`）。
- `attentionExportDeadline.test.ts` 休假日相關 it 改掛 `VisitCalendarView`，用 DayPanel 的「整天休假」「取消休假」；「關閉還有人排入的時段後可以直接去聯絡」刪除（停止申請已不需聯絡）。
- `editVersionsUx.test.ts`：「關閉時段帶 expected_version」「調整名額遇到版本衝突」改掛月曆頁 DayPanel；「儲存帶 expected_version…」改測 `WeeklySessionsCard` 的版本衝突（`api.put` reject `new ApiError(409, { code: 'VISIT_SCHEDULE_VERSION_CONFLICT' })` → 顯示「場次剛被其他人修改」）。
- `listUx.test.ts`「同一天的場次共用一個日期…」刪除（時段表格已移除）。
- `permissionsUx.test.ts`「時段與容量」describe 改成「參觀場次」：櫃台看得到月曆與名單、沒有修改場次／停止申請；校區管理者都有。「櫃台：…時段只能查看」的路徑改 `/visit-calendar`。
- `workflowFeatures.test.ts`「新增規則後儲存…」刪除。
- `ux20260928A.test.ts`：期望的搜尋結果把「時段與容量」拿掉、「接待月曆」改「參觀場次」；搜「名額」「場次」「每週規則」「休假」都要找到「參觀場次」；Enter 前往路徑 `/slots` 改 `/visit-calendar`。
- `ux20260928B1.test.ts` 月曆兩個 it：圖例與待確認暖色的斷言改成新圖例（見 Step 3）；`?campus=` 那個 it 路徑不變。

- [ ] **Step 2：跑測試確認失敗**

Run: `cd admin && npx vitest run src/__tests__/calendarChips.test.ts src/__tests__/visitSessionsPage.test.ts`
Expected: FAIL。

- [ ] **Step 3：calendarChips.ts**

```ts
import { formatDate } from '../api/labels'
import { sessionName } from './sessions'

export interface CalendarVisit { id: string; status: string; parent_name: string; child_name: string | null; phone: string; source: string; assigned_staff_id: string | null; party_size?: number | null }
export interface CalendarSlot { id: string; campus_key: string; slot_date: string; start_time: string; end_time: string; capacity: number; closed: boolean; closed_source?: string | null; version: number; booked_count: number; visits: CalendarVisit[] }
export type ChipKind = 'visit' | 'stopped' | 'open'
export interface Chip { key: string; kind: ChipKind; text: string; ended: boolean; status?: string }

const shortName = (start: string) => sessionName(start).split(' ')[0]!

export function slotEnded(slot: CalendarSlot, now = Date.now()): boolean {
  return new Date(`${slot.slot_date}T${slot.end_time.slice(0, 8)}+08:00`).getTime() <= now
}

export function dayChips(slots: CalendarSlot[], now = Date.now()): Chip[] {
  const chips: Chip[] = []
  for (const slot of [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    if (slot.closed && slot.closed_source === 'exception') continue
    const ended = slotEnded(slot, now)
    for (const v of slot.visits) chips.push({ key: v.id, kind: 'visit', text: `${shortName(slot.start_time)} ${v.parent_name}`, ended, status: v.status })
    if (slot.closed) chips.push({ key: `${slot.id}-stopped`, kind: 'stopped', text: `${shortName(slot.start_time)}停止申請`, ended })
    else if (!ended && !slot.visits.length && slot.capacity > slot.booked_count) {
      chips.push({ key: `${slot.id}-open`, kind: 'open', text: `${shortName(slot.start_time)} 可約 ${slot.capacity - slot.booked_count}`, ended })
    }
  }
  return chips
}

export function dayAriaLabel(day: string, slots: CalendarSlot[], holidayReason: string | null, now = Date.now()): string {
  const parts = [formatDate(day)]
  if (holidayReason !== null) parts.push(`休假：${holidayReason || '未填原因'}`)
  const booked = slots.reduce((sum, s) => sum + s.visits.length, 0)
  const seats = slots.filter(s => !s.closed && !slotEnded(s, now)).reduce((sum, s) => sum + Math.max(s.capacity - s.booked_count, 0), 0)
  const stopped = slots.filter(s => s.closed && s.closed_source !== 'exception').length
  parts.push(booked ? `排入 ${booked} 組` : '沒有排入的家長')
  if (seats) parts[parts.length - 1] += `，可約 ${seats} 組`
  if (stopped) parts.push(`${stopped} 場停止申請`)
  return parts.join('，')
}
```

- [ ] **Step 4：DayPanel.vue**

`admin/src/components/sessions/DayPanel.vue`：props `{ day: string; campusKey: string; slots: CalendarSlot[]; holiday: { id: string; reason: string | null } | null; canManage: boolean; staff: VisitStaffOut[] }`，emits `changed`。

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'
import { isVersionConflict, apiErrorMessage } from '../../api/errors'
import { formatDate, formatTime, formatWeekday, staffEmailById, staffLabelById, visitSourceLabel, visitStatus } from '../../api/labels'
import type { VisitStaffOut } from '../../api/types'
import StatusTag from '../StatusTag.vue'
import { slotEnded, type CalendarSlot } from '../../utils/calendarChips'
import { sessionName } from '../../utils/sessions'

const props = defineProps<{ day: string; campusKey: string; slots: CalendarSlot[]; holiday: { id: string; reason: string | null } | null; canManage: boolean; staff: VisitStaffOut[] }>()
const emit = defineEmits<{ changed: [] }>()

const busyId = ref('')
const adding = ref(false)
const newSlot = ref({ start: '10:00', minutes: 60, capacity: 1 })
const TIME_OPTIONS = Array.from({ length: 23 }, (_, i) => { const t = 7 * 60 + i * 30; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })
const sorted = computed(() => [...props.slots].sort((a, b) => a.start_time.localeCompare(b.start_time)))
const bookedToday = computed(() => props.slots.reduce((sum, s) => sum + s.visits.filter(v => v.status === 'confirmed').length, 0))
const dayPast = computed(() => new Date(`${props.day}T23:59:59+08:00`).getTime() < Date.now())

function endTime(start: string, minutes: number) {
  const [h, m] = start.split(':').map(Number)
  const total = h! * 60 + m! + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`
}

async function patchSlot(slot: CalendarSlot, body: { closed?: boolean; capacity?: number }, success: string) {
  busyId.value = slot.id
  try {
    await api.patch(`/admin/slots/${slot.id}`, { ...body, expected_version: slot.version })
    ElMessage.success(success)
    emit('changed')
  } catch (err) {
    if (isVersionConflict(err)) { ElMessage.warning('這一場剛被其他人修改，已重新載入'); emit('changed') }
    else ElMessage.error(apiErrorMessage(err, '更新失敗，請稍後再試'))
  } finally {
    busyId.value = ''
  }
}

function stop(slot: CalendarSlot) {
  const kept = slot.visits.filter(v => v.status === 'confirmed').length
  void patchSlot(slot, { closed: true }, kept ? `已停止申請，已約好的 ${kept} 組家長照常參觀` : '已停止申請')
}
function resume(slot: CalendarSlot) {
  void patchSlot(slot, { closed: false }, '已恢復開放')
}
function setCapacity(slot: CalendarSlot, capacity: number) {
  void patchSlot(slot, { capacity }, `名額改成 ${capacity} 組`)
}

async function setHoliday() {
  const warning = bookedToday.value ? `這天還有 ${bookedToday.value} 組家長預約，設為休假後不會自動取消，請逐筆改期或取消（會寄信通知家長）。` : '這天所有場次都會停止申請。'
  let reason = ''
  try {
    const answer = await ElMessageBox.prompt(`${warning}\n休假原因（選填）：`, `${formatDate(props.day)} 整天休假？`, { confirmButtonText: '設為休假', cancelButtonText: '先不要', inputPlaceholder: '例如：教師研習' })
    reason = (answer as { value?: string }).value?.trim() ?? ''
  } catch { return }
  try {
    await api.post(`/admin/visit-schedule/${props.campusKey}/exceptions`, { exception_date: props.day, reason: reason || null })
    ElMessage.success('已設為休假')
    emit('changed')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '設定休假失敗'))
  }
}

async function cancelHoliday() {
  if (!props.holiday) return
  try {
    await ElMessageBox.confirm('取消休假後，這天的固定場次會重新開放。', '取消休假？', { confirmButtonText: '取消休假', cancelButtonText: '先不要' })
  } catch { return }
  try {
    await api.delete(`/admin/visit-schedule/${props.campusKey}/exceptions/${props.holiday.id}`)
    ElMessage.success('已取消休假')
    emit('changed')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '取消休假失敗'))
  }
}

async function addSlot() {
  try {
    await api.post(`/admin/slots?campus_key=${encodeURIComponent(props.campusKey)}`, {
      slot_date: props.day,
      start_time: `${newSlot.value.start}:00`,
      end_time: endTime(newSlot.value.start, newSlot.value.minutes),
      capacity: newSlot.value.capacity,
    })
    ElMessage.success('已加開一場')
    adding.value = false
    emit('changed')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '加開失敗'))
  }
}
</script>

<template>
  <section class="section day-panel" aria-labelledby="day-panel-title">
    <div class="section__title day-panel__head">
      <h2 id="day-panel-title">{{ formatDate(day) }}（{{ formatWeekday(day) }}）<span v-if="holiday" class="day-panel__holiday">休假：{{ holiday.reason || '未填原因' }}</span></h2>
      <template v-if="canManage && !dayPast">
        <el-button v-if="holiday" @click="cancelHoliday">取消休假</el-button>
        <el-button v-else @click="setHoliday">整天休假</el-button>
      </template>
    </div>
    <p v-if="!sorted.length && !holiday" class="hint">這天沒有場次。</p>
    <div v-for="slot in sorted" :key="slot.id" class="panel calendar__slot" :class="{ 'is-ended': slotEnded(slot) }">
      <div class="panel__head">
        <h3 class="num">{{ sessionName(slot.start_time) }}–{{ formatTime(slot.end_time) }}</h3>
        <span class="hint">{{ slot.closed ? (slot.closed_source === 'exception' ? '休假' : '已停止申請') : `已約 ${slot.booked_count}／${slot.capacity} 組` }}</span>
        <div v-if="canManage && !slotEnded(slot)" class="day-panel__actions">
          <el-select v-if="!slot.closed" :model-value="slot.capacity" size="small" class="day-panel__capacity" :aria-label="`${sessionName(slot.start_time)}名額`" :disabled="busyId === slot.id" @update:model-value="(n: number) => setCapacity(slot, n)">
            <el-option v-for="n in Array.from({ length: 10 }, (_, i) => i + 1).filter(n => n >= slot.booked_count)" :key="n" :label="`${n} 組`" :value="n" />
          </el-select>
          <el-button v-if="!slot.closed" size="small" :loading="busyId === slot.id" @click="stop(slot)">停止申請</el-button>
          <el-button v-else-if="slot.closed_source !== 'exception'" size="small" :loading="busyId === slot.id" @click="resume(slot)">恢復開放</el-button>
        </div>
      </div>
      <ul v-if="slot.visits.length" class="calendar__visits">
        <li v-for="v in slot.visits" :key="v.id">
          <router-link :to="`/visit-requests/${v.id}`" class="calendar__visit-name">{{ v.parent_name }}</router-link>
          <span class="muted">{{ v.child_name || '孩子姓名未填寫' }}<template v-if="v.party_size"> · {{ v.party_size }} 人參觀</template></span>
          <a class="num" :href="`tel:${v.phone}`">{{ v.phone }}</a>
          <span class="muted" :title="staffEmailById(v.assigned_staff_id, staff) || undefined">承辦：{{ staffLabelById(v.assigned_staff_id, staff) }}<template v-if="v.source !== 'web'"> · {{ visitSourceLabel(v.source) }}補登</template></span>
          <StatusTag :meta="visitStatus(v.status)" size="small" />
        </li>
      </ul>
    </div>
    <template v-if="canManage && !dayPast && !holiday">
      <el-button v-if="!adding" text @click="adding = true">＋加開一場</el-button>
      <form v-else class="day-panel__add" @submit.prevent="addSlot">
        <el-select v-model="newSlot.start" aria-label="加開場次時間"><el-option v-for="t in TIME_OPTIONS" :key="t" :label="t" :value="t" /></el-select>
        <el-select v-model="newSlot.capacity" aria-label="加開場次組數"><el-option v-for="n in 10" :key="n" :label="`${n} 組`" :value="n" /></el-select>
        <el-button type="primary" native-type="submit">加開</el-button>
        <el-button @click="adding = false">取消</el-button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.day-panel__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.day-panel__holiday { margin-left: 8px; font-size: 14px; color: var(--ink-3); }
.day-panel__actions { display: flex; gap: 8px; align-items: center; margin-left: auto; }
.day-panel__capacity { width: 88px; }
.day-panel__add { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.calendar__slot.is-ended { opacity: 0.7; }
</style>
```
（`api.delete` 已存在於 client；`VisitStaffOut` 從 `../../api/types` 匯入。加開的長度固定 60 分鐘。）

- [ ] **Step 5：改寫 VisitCalendarView.vue**

保留原檔的日期工具（`parse`、`iso`、`addDays`、`gridDays`、`gridWeeks`、`shiftMonth`、`goToday`、`selectDay` 的捲動邏輯）與 `useRequestSequence`，改動如下：

1. import：加 `WeeklySessionsCard`、`DayPanel`、`dayChips`、`dayAriaLabel`、`type CalendarSlot`（刪檔內的 `CalendarVisit`／`CalendarSlot` interface、`chipsOf`、`openSeats`、`pendingCount`、`dayLabel`、`slotEnded`、`slotsLink`）；加 `usePermissions`。
2. 校區：`useCampusScope({ autoSelect: false })` 保留；`campusFilter` 預設值改成 `campusFromQuery(route.query.campus) || visibleCampusKeys.value[0] || ''`，`campusFromQuery` 不再要求 `multiCampus`（單校帳號也寫進網址無妨）；`CampusSelect` 拿掉 `all-label`（不再有全部校區）。
3. 權限：

```ts
const { can } = usePermissions()
const canManage = computed(() => can('booking.manage'))
const auth = useAuthStore()
const canConfigureBooking = computed(() => canManage.value && ['super_admin', 'campus_admin'].includes(auth.user?.role ?? ''))
```
4. 休假日：

```ts
const holidays = ref<Map<string, { id: string; reason: string | null }>>(new Map())
async function loadHolidays() {
  if (!campusFilter.value) return
  try {
    const schedule = await api.get<{ exceptions: { id: string; exception_date: string; reason: string | null }[] }>(`/admin/visit-schedule/${campusFilter.value}`)
    holidays.value = new Map(schedule.exceptions.map(e => [e.exception_date, { id: e.id, reason: e.reason }]))
  } catch {
    holidays.value = new Map()
  }
}
```
   `load()` 內與月曆一起呼叫；`watch([month, campusFilter], …)` 照舊。
5. 模板：
   - `PageHeader lead="設定每週固定的參觀場次；月曆上點一天，可以停止或恢復某一場、設休假、加開，也看得到誰要來。"`。
   - 工具列下方放 `<WeeklySessionsCard v-if="campusFilter" ref="sessionsCard" :campus-key="campusFilter" :can-manage="canManage" :can-configure-booking="canConfigureBooking" @saved="load" />`。
   - 圖例換成：`有預約`（`data-kind="visit"`）、`停止申請`（`data-kind="stopped"`）、`還可預約`（`data-kind="open"`）、`休假`（`.is-holiday` 樣本）；刪除待確認相關的兩個圖例與 `.calendar__dot.is-pending`。
   - 格子：

```html
<button v-for="day in week" :key="day" type="button" role="gridcell" class="calendar__day"
  :class="{ 'is-other': day.slice(0, 7) !== month, 'is-today': day === today, 'is-selected': day === selectedDay, 'is-holiday': holidays.has(day) }"
  :aria-selected="day === selectedDay" :aria-label="dayAriaLabel(day, slotsByDay.get(day) ?? [], holidays.get(day)?.reason ?? (holidays.has(day) ? '' : null))"
  @click="selectDay(day, $event)">
  <span class="calendar__date num">{{ Number(day.slice(8)) }}</span>
  <span v-if="holidays.has(day)" class="calendar__holiday">休假</span>
  <span v-for="chip in dayChips(slotsByDay.get(day) ?? []).slice(0, MAX_CHIPS)" :key="chip.key" class="calendar__chip" :data-kind="chip.kind" :data-status="chip.status" :class="{ 'is-ended': chip.ended }">{{ chip.text }}</span>
  <span v-if="dayChips(slotsByDay.get(day) ?? []).length > MAX_CHIPS" class="calendar__more">＋{{ dayChips(slotsByDay.get(day) ?? []).length - MAX_CHIPS }}</span>
</button>
```
   - 月曆下方的 `<section class="section calendar__detail">…</section>` 整段換成 `<DayPanel v-if="campusFilter" :day="selectedDay" :campus-key="campusFilter" :slots="selectedSlots" :holiday="holidays.get(selectedDay) ?? null" :can-manage="canManage" :staff="staff" @changed="load" />`，`detailHeading` ref 改成指向 DayPanel 根元素（`ref="dayPanel"`，`selectDay` 內用 `dayPanel.value?.$el`）。
6. style：`calendar__chip` 依 `data-kind` 上色——visit 沿用原檔已確認色塊的規則；stopped 用 `--el-color-danger`（底）＋`--surface`（字）；open 用 `--line` 邊框、`--ink-3` 字；`.is-ended` 加 `opacity: .6`；`.calendar__day.is-holiday` 用 `--surface-3` 底。沿用原檔的手機規則，刪除 `pending_confirmation` 的樣式。
7. 離開頁面前的未存修改：`onBeforeRouteLeave` 呼叫 `sessionsCard.value?.confirmLeave()`；切換校區前也先問（`watch(campusFilter)` 改成在 `CampusSelect` 的 `update:model-value` 先 `await confirmLeave()` 再改值）。

- [ ] **Step 6：路由與側欄**

`router/nav.ts`：刪 `slots` 那一項；`visit-calendar` 改成

```ts
{ name: 'visit-calendar', path: '/visit-calendar', title: '參觀場次', icon: 'Calendar', roles: VISITS, keywords: ['預約', '行事曆', '日曆', '接待月曆', '當天參觀', '場次', '時段', '名額', '參觀時間', '每週規則', '固定場次', '休假', '停止申請', '加開'] },
```
`router/index.ts`：刪 `page('slots', …)`，在同一個 children 陣列加

```ts
{ path: 'slots', redirect: to => ({ path: '/visit-calendar', query: to.query }) },
```
並確認 `routes` 有 export（測試要用）。

刪檔：`git rm admin/src/views/VisitSlotsView.vue admin/src/components/VisitSchedulePanel.vue admin/src/__tests__/scheduleRuleSync.test.ts`。`grep -rn "VisitSlotsView\|VisitSchedulePanel\|'/slots'\|\"/slots\"" admin/src` 只剩轉址那一行與測試。

`BookingSettingsView`、`VisitDetailView` 裡「時段與容量」的連結與文字改「參觀場次」、路徑 `/visit-calendar?campus=…`（`grep -rn "時段與容量" admin/src`）。

- [ ] **Step 7：跑後台全部測試與型別檢查**

```bash
cd admin && npx vitest run && npm run typecheck
```
Expected: 全部 PASS、typecheck 0 錯。

- [ ] **Step 8：本機畫面檢查**

依 `docs/website-admin/README.md` 啟動 backend（自訂 DB）與 admin dev server，用 super_admin 登入，Playwright 截 1440×900 與 390×844：參觀場次頁（空白→套用常用場次→儲存）、月曆一天（停止申請、恢復、休假、加開）、案件列表四個分頁、案件明細。截圖存 `output/playwright/self-booking-20260930/admin/`。

- [ ] **Step 9：Commit（需授權）**

```bash
git add admin/src/utils/calendarChips.ts admin/src/components/sessions/DayPanel.vue admin/src/views/VisitCalendarView.vue \
  admin/src/router/index.ts admin/src/router/nav.ts admin/src/views/BookingSettingsView.vue admin/src/views/VisitDetailView.vue \
  admin/src/__tests__/calendarChips.test.ts admin/src/__tests__/visitSessionsPage.test.ts admin/src/__tests__/ux20260928B1.test.ts \
  admin/src/__tests__/attentionExportDeadline.test.ts admin/src/__tests__/editVersionsUx.test.ts admin/src/__tests__/listUx.test.ts \
  admin/src/__tests__/permissionsUx.test.ts admin/src/__tests__/workflowFeatures.test.ts admin/src/__tests__/ux20260928A.test.ts
git rm admin/src/views/VisitSlotsView.vue admin/src/components/VisitSchedulePanel.vue admin/src/__tests__/scheduleRuleSync.test.ts
git commit -m "feat(admin): 時段與容量併進參觀場次頁，月曆直接停開場次、休假與加開

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 階段 C 閘門

```bash
cd admin && npm run typecheck && npx vitest run
```
兩者成功輸出貼進回報。
