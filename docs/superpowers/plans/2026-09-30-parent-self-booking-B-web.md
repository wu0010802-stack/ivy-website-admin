# 階段 B：公開官網 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 官網預約表單只剩自選場次、Email 必填；送出後顯示「預約成功」、修改連結與寄信說明；管理頁可以直接改場次、修改資料、取消。

**Architecture:** 純函式放 `web/app/utils/`（好測），元件只接線。契約型別來自階段 A 重產的 `contracts/generated/website-api.d.ts`（`ParentVisitRequestOut` 已有新欄位）。

**Tech Stack:** Nuxt 4、Vue 3、TS、vitest（`web/tests/*.spec.ts`，多數測純函式與 composable；頁面用讀原始碼字串斷言）。

**Spec:** §4.1–§4.4。**前置：** 階段 A 閘門已過。

**先讀：** 總覽的 Global Constraints、Review Focus 第 3、4 條。視覺改動遵守 `DESIGN.md`、`PRODUCT.md`、記憶「避免 AI 感設計」：用品牌字、直白標題、實際資訊；顏色只用 token。

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `web/app/utils/visit-session.ts` | 新增 | 場次名稱（上午場／下午場）與時段文字 |
| `web/app/utils/visit-result.ts` | 新增 | 送出結果的狀態、文案、遮罩 Email |
| `web/app/utils/visit-form.ts` | 修改 | Email 必填；422 欄位錯誤對應；移除接電話時段選項 |
| `web/app/utils/booking-action.ts` | 修改 | 移除 inquiry；型別加 `parent_email_enabled` |
| `web/app/components/VisitForm.vue` | 修改 | 表單欄位、結果頁 |
| `web/app/composables/useParentVisit.ts` | 修改 | 直接改期、改資料、版本衝突 |
| `web/app/pages/visit/manage.vue` | 修改 | 管理頁內容與三個操作 |
| `web/tests/*.spec.ts` | 新增／修改 | 見各 task |

---

### Task B1：場次名稱與送出結果的純函式

**Files:**
- Create: `web/app/utils/visit-session.ts`、`web/app/utils/visit-result.ts`
- Modify: `web/app/utils/visit-form.ts`（`validateVisitContact` 約 83 行；`CONTACT_TIME_OPTIONS` 保留給舊資料顯示，不刪）
- Test: `web/tests/visit-session.spec.ts`、`web/tests/visit-result.spec.ts`、`web/tests/visit-form.spec.ts`（加案例）

**Interfaces:**
- Produces:
  - `sessionLabel(startTime: string): string` → `"上午場 10:00"`
  - `slotRange(slot: { start_time: string; end_time: string }): string` → `"上午場 10:00–11:00"`
  - `slotWhen(slot: { slot_date: string; start_time: string; end_time: string }): string` → `"${visitDateLabel(date)} 上午場 10:00–11:00"`
  - `type VisitResultKind = 'booked' | 'closed'`；`visitResultKind(status: string | null | undefined): VisitResultKind`
  - `maskEmail(email: string): string`
  - `visitResultCopy(kind, { emailEnabled: boolean; email: string }): { eyebrow: string; title: string; body: string }`
  - `apiFieldErrors(detail: unknown): VisitErrors`（422 的 `detail[].loc[1]` → 表單欄位）
  - `validateVisitContact` 在 `email` 欄位有傳（非 `undefined`）時要求必填

- [ ] **Step 1：寫失敗的測試**

`web/tests/visit-session.spec.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { sessionLabel, slotRange, slotWhen } from '../app/utils/visit-session'

describe('場次名稱', () => {
  it('12:00 以前是上午場，12:00 起是下午場', () => {
    expect(sessionLabel('09:59:00')).toBe('上午場 09:59')
    expect(sessionLabel('12:00:00')).toBe('下午場 12:00')
    expect(sessionLabel('14:30')).toBe('下午場 14:30')
  })

  it('時段文字帶場次名稱與起訖', () => {
    expect(slotRange({ start_time: '10:00:00', end_time: '11:00:00' })).toBe('上午場 10:00–11:00')
    expect(slotWhen({ slot_date: '2026-10-02', start_time: '14:30:00', end_time: '15:30:00' })).toMatch(/2026\/10\/2.*週五.* 下午場 14:30–15:30$/)
  })
})
```

`web/tests/visit-result.spec.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { maskEmail, visitResultCopy, visitResultKind } from '../app/utils/visit-result'

describe('送出結果', () => {
  it('只有 confirmed 才算預約成功；重送拿到已取消的案件要照實說', () => {
    expect(visitResultKind('confirmed')).toBe('booked')
    expect(visitResultKind('cancelled')).toBe('closed')
    expect(visitResultKind(null)).toBe('closed')
  })

  it('寄信開著才說信已寄出，Email 要遮罩', () => {
    expect(maskEmail('wang.mama@gmail.com')).toBe('w***@gmail.com')
    expect(visitResultCopy('booked', { emailEnabled: true, email: 'wang.mama@gmail.com' }).body).toContain('確認信已寄到 w***@gmail.com')
    const off = visitResultCopy('booked', { emailEnabled: false, email: 'wang.mama@gmail.com' })
    expect(off.eyebrow).toBe('預約成功')
    expect(off.body).not.toContain('已寄到')
    expect(off.body).toContain('收藏')
    expect(visitResultCopy('closed', { emailEnabled: true, email: 'a@b.co' }).eyebrow).toBe('預約已取消')
  })
})
```

`web/tests/visit-form.spec.ts` 加：

```ts
import { apiFieldErrors, validateVisitContact } from '../app/utils/visit-form'

describe('Email 必填與 422 欄位對應', () => {
  const base = { parentName: '王媽媽', phone: '0912345678', consent: true, childName: '小安', childBirthdate: '2022-05-01', partySize: '2' }

  it('表單有 Email 欄位時必填', () => {
    expect(validateVisitContact({ ...base, email: '' }, '2026-09-30')).toHaveProperty('email')
    expect(validateVisitContact({ ...base, email: 'a@b.co' }, '2026-09-30')).toEqual({})
    expect(validateVisitContact(base, '2026-09-30')).not.toHaveProperty('email')
  })

  it('後端 422 的欄位位置轉成表單欄位錯誤', () => {
    const errors = apiFieldErrors([
      { loc: ['body', 'slot_id'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'email'], msg: 'Field required', type: 'missing' }
    ])
    expect(Object.keys(errors).sort()).toEqual(['email', 'slotId'])
    expect(apiFieldErrors({ code: 'X' })).toEqual({})
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npm --prefix web run test:unit -- visit-session visit-result visit-form`
Expected: FAIL（模組不存在、`apiFieldErrors` 未匯出）。

- [ ] **Step 3：實作**

`web/app/utils/visit-session.ts`：

```ts
import { visitDateLabel } from './visit-form'

// 場次名稱由開始時間推導（2026-09-30 業主裁定）：12:00 以前上午場，其餘下午場。
export function sessionLabel(startTime: string): string {
  const hhmm = startTime.slice(0, 5)
  return `${Number(hhmm.slice(0, 2)) < 12 ? '上午場' : '下午場'} ${hhmm}`
}

export function slotRange(slot: { start_time: string; end_time: string }): string {
  return `${sessionLabel(slot.start_time)}–${slot.end_time.slice(0, 5)}`
}

export function slotWhen(slot: { slot_date: string; start_time: string; end_time: string }): string {
  return `${visitDateLabel(slot.slot_date)} ${slotRange(slot)}`
}
```

`web/app/utils/visit-result.ts`：

```ts
export type VisitResultKind = 'booked' | 'closed'

export function visitResultKind(status: string | null | undefined): VisitResultKind {
  return status === 'confirmed' ? 'booked' : 'closed'
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  if (!name || !domain) return email
  return `${name.slice(0, 1)}***@${domain}`
}

export function visitResultCopy(kind: VisitResultKind, mail: { emailEnabled: boolean; email: string }) {
  if (kind === 'closed') {
    return {
      eyebrow: '預約已取消',
      title: '這筆預約已經取消',
      body: '若想再參觀，請重新選擇場次，或直接聯絡園所。'
    }
  }
  return {
    eyebrow: '預約成功',
    title: '已經幫你排好參觀時間',
    body: mail.emailEnabled && mail.email
      ? `確認信已寄到 ${maskEmail(mail.email)}，沒收到請看垃圾信件匣。之後要改時間、修改資料或取消，都從信裡或下方的連結進入。`
      : '請收藏下方的修改連結，之後要改時間、修改資料或取消，都從這裡進入。'
  }
}
```

`web/app/utils/visit-form.ts`：
1. `validateVisitContact` 的 Email 規則改成：

```ts
  // 新版表單一律帶 email 欄位（2026-09-30 起必填：確認信與修改連結寄到這裡）；舊呼叫端不帶。
  if (contact.email !== undefined) {
    const email = contact.email.trim()
    if (!email) errors.email = '請填寫 Email，確認信與修改連結會寄到這裡。'
    else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '請填寫有效的 Email，例如 name@example.com。'
  }
```

2. 檔尾加：

```ts
const API_FIELDS: Record<string, VisitField> = {
  slot_id: 'slotId', email: 'email', phone: 'phone', parent_name: 'parentName', child_name: 'childName',
  child_birthdate: 'childBirthdate', party_size: 'partySize', consent_given: 'consent'
}
const API_FIELD_MESSAGES: Partial<Record<VisitField, string>> = {
  slotId: '請選擇這一天的參觀場次。',
  email: '請填寫有效的 Email，確認信與修改連結會寄到這裡。',
  phone: '請填寫 09 開頭的 10 碼手機號碼。',
  parentName: '請填寫家長稱呼。',
  childName: '請填寫孩子姓名。',
  childBirthdate: '請填寫完整的出生年月日，且不能晚於今天。',
  partySize: '請選擇參觀人數。',
  consent: '請勾選同意。'
}

// 後端 422 是 FastAPI 的標準格式：detail 是陣列，loc[1] 是欄位名稱。
export function apiFieldErrors(detail: unknown): VisitErrors {
  if (!Array.isArray(detail)) return {}
  const errors: VisitErrors = {}
  for (const item of detail) {
    const field = API_FIELDS[String((item as { loc?: unknown[] })?.loc?.[1] ?? '')]
    if (field && !errors[field]) errors[field] = API_FIELD_MESSAGES[field] ?? '請檢查這個欄位。'
  }
  return errors
}
```

- [ ] **Step 4：跑測試**

Run: `npm --prefix web run test:unit -- visit-session visit-result visit-form`
Expected: PASS。

- [ ] **Step 5：Commit（需授權）**

```bash
git add web/app/utils/visit-session.ts web/app/utils/visit-result.ts web/app/utils/visit-form.ts \
  web/tests/visit-session.spec.ts web/tests/visit-result.spec.ts web/tests/visit-form.spec.ts
git commit -m "feat(web): 場次名稱、送出結果文案與 Email 必填的共用函式

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2：預約表單與結果頁

**Files:**
- Modify: `web/app/utils/booking-action.ts`（型別 5–19 行、`resolveBookingAction` 37 行起）
- Modify: `web/app/components/VisitForm.vue`
- Test: `web/tests/booking-action.spec.ts`、`web/tests/ux-critique-20260929.spec.ts`、`web/tests/turnstile.spec.ts`、`web/tests/privacy-consent.spec.ts`、新增 `web/tests/visit-form-result.spec.ts`

**Interfaces:**
- Consumes: B1 全部函式；API `VisitRequestOut.manage_path`、`PublicBookingConfigOut.parent_email_enabled`。
- Produces: `BookingConfig.parent_email_enabled?: boolean`；`BookingMode` 不含 `'inquiry'`。

- [ ] **Step 1：寫失敗的測試**

`web/tests/booking-action.spec.ts`：刪掉「inquiry 模式導向站內表單頁…」那個 `it`；把其他 fixture 的 `mode: 'inquiry'` 改成 `'slots'`。加：

```ts
it('只有自選場次會帶到站內表單', () => {
  expect(resolveBookingAction('yihua', { mode: 'slots', version: 1 }).kind).toBe('form')
  expect(resolveBookingAction('yihua', { mode: 'paused', version: 1, message: '暫停' }).kind).toBe('paused')
})
```

`web/tests/ux-critique-20260929.spec.ts` 約 32 行「送出結果：只有預約成立用打勾…」改成斷言：結果區塊的狀態圖示一律 `#i-check` 只在 `resultKind === 'booked'`，否則不用時鐘：

```ts
it('送出結果：預約成功用打勾，已取消用叉號，不再有時鐘', () => {
  const source = readFileSync(resolve(__dirname, '../app/components/VisitForm.vue'), 'utf8')
  expect(source).toContain(":href=\"resultKind === 'booked' ? '#i-check' : '#i-x'\"")
  expect(source).not.toContain('#i-clock')
})
```
（`readFileSync`、`resolve` 沿用該檔既有的 import；`#i-check`、`#i-x` 都是 sprite 內既有的 Phosphor 圖示。）

`web/tests/turnstile.spec.ts`、`web/tests/privacy-consent.spec.ts`：fixture 的 `mode: 'inquiry'` 改 `'slots'`，其餘不動。

新增 `web/tests/visit-form-result.spec.ts`（讀原始碼確認接線）：

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../app/components/VisitForm.vue'), 'utf8')

describe('預約表單接線', () => {
  it('不再有方便接電話時段與選填 Email', () => {
    expect(source).not.toContain('contact-time')
    expect(source).not.toContain('preferred_time')
    expect(source).toMatch(/聯絡 Email<small>必填<\/small>/)
  })

  it('結果頁有修改連結與複製按鈕，文案由 visitResultCopy 決定', () => {
    expect(source).toContain('visitResultCopy(')
    expect(source).toContain('managePath')
    expect(source).toContain('修改或取消預約')
    expect(source).toContain('複製連結')
  })

  it('422 依欄位標出錯誤', () => {
    expect(source).toContain('apiFieldErrors(detail)')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npm --prefix web run test:unit -- booking-action ux-critique-20260929 visit-form-result turnstile privacy-consent`
Expected: FAIL。

- [ ] **Step 3：booking-action**

`BookingMode` 刪 `'inquiry'`；`BookingConfig` 加 `parent_email_enabled?: boolean`（若有 `slots_auto_confirm?` 就刪）；`switch` 刪 `case 'inquiry'` 整段。

- [ ] **Step 4：VisitForm script**

1. import：刪 `CONTACT_TIME_OPTIONS`、`contactTimeLabel`；加 `apiFieldErrors`；加 `import { slotRange } from '~/utils/visit-session'`、`import { visitResultCopy, visitResultKind } from '~/utils/visit-result'`。
2. `form` 刪 `time: ''`；刪 `const timeOptions = CONTACT_TIME_OPTIONS`。
3. `const slotTime = ...` 改成 `const slotTime = (slot: PublicVisitSlot) => slotRange(slot)`（模板其他用到 `slotTime` 的地方不必改）。
4. 結果狀態：把 `resultStatus`／`resultCopy` 區塊換成

```ts
const submitted = ref(false)
const resultStatus = ref<string | null>(null)
const receiptId = ref('')
const managePath = ref<string | null>(null)
const linkCopied = ref(false)
const resultKind = computed(() => visitResultKind(resultStatus.value))
const resultCopy = computed(() => visitResultCopy(resultKind.value, {
  emailEnabled: Boolean(bookingConfig.value?.parent_email_enabled),
  email: form.email
}))

async function copyManageLink() {
  if (!managePath.value) return
  try {
    await navigator.clipboard.writeText(new URL(managePath.value, window.location.origin).href)
    linkCopied.value = true
  } catch {
    linkCopied.value = false
  }
}
```
5. `onSubmit`：
   - `if (bookingConfig.value?.mode === 'slots') { … }` 的日期／場次檢查改成無條件執行（只剩 slots）。
   - `$fetch` 的型別改 `{ receipt_id: string; status: string; manage_path: string | null }`；body 刪 `preferred_time`；`email: form.email`（不再 `|| null`）；`slot_id: selectedSlotId.value`。
   - 成功後加 `managePath.value = created?.manage_path ?? null; linkCopied.value = false`。
   - `catch` 的 422 分支換成：

```ts
    } else if (err?.response?.status === 422) {
      const fields = apiFieldErrors(detail)
      if (Object.keys(fields).length) {
        fieldErrors.value = { ...fieldErrors.value, ...fields }
        submitError.value = '有幾個欄位需要修正，請看標示的地方。'
      } else {
        submitError.value = '部分資料格式有誤，請檢查孩子生日、Email、聯絡電話與必填欄位。'
      }
```
   - `IDEMPOTENCY_CONFLICT` 的文案改成「你先前那一次其實已經送出成功了，請查看確認信或聯絡園所。如果要用修改後的內容再預約一筆，請再按一次送出。」（不再說「園所會用第一次填的資料與你聯繫」）。

- [ ] **Step 5：VisitForm template**

1. 場次區塊的 `v-if="bookingConfig?.mode === 'slots'"` 保留（mode 可能是 line／phone 等，此時表單不顯示）。
2. Email 欄（約 576 行）：`<small>選填</small>` 改 `<small>必填</small>`，`<input` 加 `required`，欄位下方加一行 `<p class="visit-field-hint">確認信與修改連結會寄到這裡。</p>`（放在錯誤訊息 `<p>` 之前）。
3. 刪除「方便接電話的時段」整個 `<div class="visit-field visit-full">`（約 584 行）。
4. 結果頁（約 602–612 行）：
   - 狀態圖示那行換成

```html
<span class="visit-result-status" :data-status="resultKind === 'booked' ? 'confirmed' : 'closed'"><svg class="icon" aria-hidden="true"><use :href="resultKind === 'booked' ? '#i-check' : '#i-x'" /></svg>{{ resultCopy.eyebrow }}</span>
```
   - `<dl class="visit-result-list">` 內刪掉 `<div v-if="form.time">…接電話時段…</div>`；`聯絡 Email` 那列改成不需 `v-if`。
   - `VisitCalendarActions` 的 `v-if` 改 `resultKind === 'booked' && submittedSlot && selectedCampus`。
   - 把 `<div class="visit-result-next">…</div>` 換成：

```html
<div v-if="resultKind === 'booked' && managePath" class="visit-result-next">
  <h3>之後要改時間或取消</h3>
  <p>用這個連結就能改場次、修改資料或取消預約，請收藏起來，不要轉給其他人。</p>
  <div class="visit-contact-actions">
    <NuxtLink class="button primary" :to="managePath">修改或取消預約</NuxtLink>
    <button type="button" class="button outline" @click="copyManageLink">{{ linkCopied ? '已複製連結' : '複製連結' }}</button>
  </div>
</div>
<div v-else class="visit-result-next">
  <h3>需要協助？</h3>
  <p>請直接聯絡{{ selectedCampus?.name }}。</p>
  <div class="visit-contact-actions"><a v-if="selectedCampus?.phone" class="button primary" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}</a><NuxtLink v-if="selectedCampus" class="visit-inline-link" :to="`/visit/${selectedCampus.key}`">重新選擇場次</NuxtLink></div>
</div>
```
5. `visit-booking.css`：`.visit-result-status[data-status="waiting"]` 的規則改名 `closed`（顏色 token 不變）；若無此規則則略過。

- [ ] **Step 6：跑測試與型別檢查**

```bash
npm --prefix web run test:unit
npm --prefix web run typecheck
```
Expected: 全部 PASS、typecheck 0 錯（`manage.vue` 與 `useParentVisit.ts` 若因 `phone_masked` 移除而報錯，屬 B3 範圍，先記下、B3 一起修；本 task 只要求自己改的檔案沒有型別錯誤）。

- [ ] **Step 7：Commit（需授權）**

```bash
git add web/app/utils/booking-action.ts web/app/components/VisitForm.vue web/app/assets/css/visit-booking.css \
  web/tests/booking-action.spec.ts web/tests/ux-critique-20260929.spec.ts web/tests/turnstile.spec.ts \
  web/tests/privacy-consent.spec.ts web/tests/visit-form-result.spec.ts
git commit -m "feat(web): 預約表單只剩自選場次，送出後顯示預約成功與修改連結

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3：管理頁（直接改場次、修改資料、取消）

**Files:**
- Modify: `web/app/composables/useParentVisit.ts`
- Modify: `web/app/pages/visit/manage.vue`
- Test: `web/tests/parent-visit.spec.ts`

**Interfaces:**
- Consumes: API `POST /public/visit-manage/reschedule`（body `{visit_request_id, slot_id}` → `ParentVisit`）、`PATCH /public/visit-manage/me`（body `{visit_request_id, expected_version, ...changes}` → `ParentVisit`）；B1 `slotWhen`、`validateVisitContact`。
- Produces（composable 回傳值）：移除 `requestReschedule`、`reschedulePending`；新增 `reschedule(slotId: string): Promise<boolean>`、`updateDetails(changes: ParentDetailChanges): Promise<boolean>`；`export type ParentDetailChanges = Partial<Pick<ParentVisit, 'parent_name' | 'phone' | 'email' | 'child_name' | 'child_birthdate' | 'party_size' | 'questions'>>`。

- [ ] **Step 1：寫失敗的測試**

`web/tests/parent-visit.spec.ts`：
1. 檔頭 `visit` fixture：刪 `phone_masked`，加 `parent_name: '王媽媽', phone: '0999000001', email: 'wang@example.com', child_name: '小安', child_birthdate: '2022-05-01', party_size: 2, questions: null, version: 3, can_edit: true`。
2. 刪除所有測 `requestReschedule`／`reschedule-request`／`reschedulePending` 的 `it`。
3. 加：

```ts
it('直接改場次：成功後換成新的預約內容', async () => {
  const moved = { ...visit, slot: { id: 'slot-2', slot_date: '2026-10-12', start_time: '14:30:00', end_time: '15:30:00' } }
  const fetch = vi.fn().mockResolvedValueOnce(visit).mockResolvedValueOnce(moved)
  vi.stubGlobal('$fetch', fetch)
  const state = useParentVisit()
  await state.initialize('link')

  expect(await state.reschedule('slot-2')).toBe(true)

  expect(fetch.mock.calls[1]?.[0]).toBe('/api/website/v1/public/visit-manage/reschedule')
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { visit_request_id: 'visit-1', slot_id: 'slot-2' } })
  expect(state.visit.value?.slot?.id).toBe('slot-2')
  expect(state.notice.value).toContain('下午場 14:30')
})

it('修改資料只送有改的欄位並帶版本', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(visit).mockResolvedValueOnce({ ...visit, phone: '0922333444', version: 4 })
  vi.stubGlobal('$fetch', fetch)
  const state = useParentVisit()
  await state.initialize('link')

  expect(await state.updateDetails({ phone: '0922333444' })).toBe(true)

  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: { visit_request_id: 'visit-1', expected_version: 3, phone: '0922333444' } })
  expect(state.visit.value?.version).toBe(4)
})

it('沒有改任何欄位就不送出', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(visit)
  vi.stubGlobal('$fetch', fetch)
  const state = useParentVisit()
  await state.initialize('link')

  expect(await state.updateDetails({})).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('停在頁面上跨過截止時間：重抓資料、收起操作並說明', async () => {
  const closed = { ...visit, can_cancel: false, can_reschedule: false, can_edit: false }
  const fetch = vi.fn()
    .mockResolvedValueOnce(visit)
    .mockRejectedValueOnce(failure(409, 'CHANGE_DEADLINE_PASSED'))
    .mockResolvedValueOnce(closed)
  vi.stubGlobal('$fetch', fetch)
  const state = useParentVisit()
  await state.initialize('link')

  expect(await state.updateDetails({ party_size: 3 })).toBe(false)

  expect(fetch.mock.calls[2]?.[0]).toBe('/api/website/v1/public/visit-manage/me')
  expect(state.visit.value?.can_edit).toBe(false)
  expect(state.error.value).toContain('已無法線上異動')
})

it('版本衝突時重新載入最新資料', async () => {
  const fresh = { ...visit, phone: '0911111111', version: 5 }
  const fetch = vi.fn()
    .mockResolvedValueOnce(visit)
    .mockRejectedValueOnce(failure(409, 'VISIT_REQUEST_VERSION_CONFLICT'))
    .mockResolvedValueOnce(fresh)
  vi.stubGlobal('$fetch', fetch)
  const state = useParentVisit()
  await state.initialize('link')

  expect(await state.updateDetails({ party_size: 3 })).toBe(false)

  expect(state.visit.value?.version).toBe(5)
  expect(state.error.value).toContain('剛被修改過')
})
```
4. 頁面字串斷言（沿用該檔讀 `manage.vue` 的寫法）加：

```ts
it('管理頁有改場次、修改資料、取消三個操作，改期不再寫「申請」', () => {
  const page = readFileSync(resolve(__dirname, '../app/pages/visit/manage.vue'), 'utf8')
  expect(page).toContain('>改場次</button>')
  expect(page).toContain('>修改資料</button>')
  expect(page).toContain('>取消預約</button>')
  expect(page).not.toContain('申請改期')
  expect(page).not.toContain('phone_masked')
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npm --prefix web run test:unit -- parent-visit`
Expected: FAIL。

- [ ] **Step 3：composable**

`web/app/composables/useParentVisit.ts`：
1. import 加 `import { slotWhen } from '../utils/visit-session'`；匯出型別：

```ts
export type ParentDetailChanges = Partial<Pick<ParentVisit, 'parent_name' | 'phone' | 'email' | 'child_name' | 'child_birthdate' | 'party_size' | 'questions'>>
```
2. 刪 `reschedulePending` ref 與所有讀寫它的地方（`reload` 內的 `reschedulePending.value = …`、`notice.value = record.reschedule_pending ? … : ''` 改成 `notice.value = ''`；`initialize` 內那行；`operationFailed` 的 `RESCHEDULE_PENDING` 分支；`cancelVisit` 內那行）。
3. `operationFailed` 在 `CHANGE_DEADLINE_PASSED` 分支之前加：

```ts
    if (code === 'VISIT_REQUEST_VERSION_CONFLICT') {
      try {
        const record = await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal })
        if (disposed || request !== revision) return
        visit.value = record
      } catch (refreshError) {
        if (disposed || request !== revision) return
        if (failureInfo(refreshError).status === 401) { expire(); return }
      }
      error.value = '這筆預約剛被修改過，已重新載入最新資料，請再確認一次。'
      return
    }
```
   並把 slot 類錯誤的文案改成「選擇的場次已無法預約，請重新選擇其他場次。」
4. `loadSlots` 的條件 `!visit.value?.can_reschedule` 保留。
5. `requestReschedule` 整個換成：

```ts
  async function reschedule(slotId: string): Promise<boolean> {
    if (!visit.value?.can_reschedule || !slotId || busy.value || pending.value || disposed) return false
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    try {
      const result = await $fetch<ParentVisit>(`${base}/reschedule`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { visit_request_id: visit.value.id, slot_id: slotId } })
      if (disposed || request !== revision) return false
      visit.value = result
      slots.value = []
      notice.value = result.slot ? `已改到 ${slotWhen(result.slot)}。` : '已更新參觀時間。'
      return true
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
      return false
    } finally {
      if (!disposed && request === revision) busy.value = false
    }
  }

  async function updateDetails(changes: ParentDetailChanges): Promise<boolean> {
    if (!visit.value?.can_edit || busy.value || pending.value || disposed) return false
    if (!Object.keys(changes).length) { notice.value = '資料沒有變更。'; return true }
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    try {
      const result = await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal, method: 'PATCH', headers: { 'X-Ivy-Parent': '1' }, body: { visit_request_id: visit.value.id, expected_version: visit.value.version, ...changes } })
      if (disposed || request !== revision) return false
      visit.value = result
      notice.value = '資料已更新。'
      return true
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
      return false
    } finally {
      if (!disposed && request === revision) busy.value = false
    }
  }
```
6. `return` 物件：拿掉 `reschedulePending`、`requestReschedule`，加 `reschedule`、`updateDetails`。

- [ ] **Step 4：管理頁**

`web/app/pages/visit/manage.vue`（style 區塊保留，只在最後加下面的 CSS）：

1. script：
   - 解構改成 `visit, pending, busy, unavailable, error, notice, slots, slotsPending, slotsError, initialize, reload, loadSlots, cancelVisit, reschedule, updateDetails, dispose`。
   - import 加 `import { slotWhen } from '~/utils/visit-session'`、`import { normalizeVisitPhone, PARTY_SIZE_OPTIONS, taipeiDate, validateVisitContact, type VisitErrors } from '~/utils/visit-form'`（與既有 `changeDeadlineRule, visitDateLabel` 合併）、`import type { ParentDetailChanges } from '~/composables/useParentVisit'`。
   - `statusLabels.confirmed` 改 `'預約成功'`；`slotLabel` 改用 `slotWhen`（`const slotLabel = slotWhen`）。
   - `rescheduleOpen` 改 `showReschedule.value && Boolean(visit.value?.can_reschedule)`；新增 `showEdit`、`editOpen = computed(() => showEdit.value && Boolean(visit.value?.can_edit))`；`openCancel`／`openReschedule` 內各加 `showEdit.value = false`；`consumeLink` 內加 `showEdit.value = false`。
   - `changeClosed` 保留；新增 `campusPhone = computed(() => visitCampus.value?.phone || visit.value?.campus_phone || '')`。
   - 修改資料表單：

```ts
const editForm = reactive({ parentName: '', phone: '', email: '', childName: '', childBirthdate: '', partySize: '', questions: '' })
const editErrors = ref<VisitErrors>({})
const editPanel = ref<HTMLElement | null>(null)

async function openEdit() {
  if (!visit.value) return
  Object.assign(editForm, {
    parentName: visit.value.parent_name, phone: visit.value.phone, email: visit.value.email ?? '',
    childName: visit.value.child_name ?? '', childBirthdate: visit.value.child_birthdate ?? '',
    partySize: visit.value.party_size ? String(visit.value.party_size) : '', questions: visit.value.questions ?? ''
  })
  editErrors.value = {}
  showEdit.value = true
  showCancel.value = false
  showReschedule.value = false
  await nextTick()
  editPanel.value?.querySelector<HTMLElement>('input')?.focus()
}

function editedChanges(): ParentDetailChanges {
  const current = visit.value!
  const next = {
    parent_name: editForm.parentName.trim(), phone: normalizeVisitPhone(editForm.phone), email: editForm.email.trim(),
    child_name: editForm.childName.trim(), child_birthdate: editForm.childBirthdate,
    party_size: Number(editForm.partySize), questions: editForm.questions.trim() || null
  }
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => value !== (current[key as keyof typeof current] ?? (key === 'questions' ? null : '')))
  ) as ParentDetailChanges
}

async function submitEdit() {
  editErrors.value = validateVisitContact({ ...editForm, consent: true }, taipeiDate())
  if (Object.keys(editErrors.value).length) {
    await nextTick()
    editPanel.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  const done = await updateDetails(editedChanges())
  if (done) showEdit.value = false
  await focusFeedback()
}
```
   - `submitReschedule` 的 `await requestReschedule(selectedSlotId.value)` 改成 `const done = await reschedule(selectedSlotId.value); if (done) showReschedule.value = false`，刪掉 `if (!rescheduleOpen.value) showReschedule.value = false`；錯誤文案「請選擇希望改期的場次。」改「請選擇新的場次。」

2. template（`<template v-if="visit">` 內）：
   - `<dl class="parent-visit-details">` 換成：

```html
<dl class="parent-visit-details">
  <div><dt>{{ visit.status === 'cancelled' ? '原參觀場次' : '參觀場次' }}</dt><dd>{{ visit.slot ? slotLabel(visit.slot) : '尚未排定，請聯絡園所' }}</dd></div>
  <div v-if="visit.party_size"><dt>參觀人數</dt><dd>{{ visit.party_size }} 位</dd></div>
  <div><dt>家長稱呼</dt><dd>{{ visit.parent_name }}</dd></div>
  <div><dt>聯絡手機</dt><dd>{{ visit.phone }}</dd></div>
  <div v-if="visit.email"><dt>Email</dt><dd>{{ visit.email }}</dd></div>
  <div v-if="visit.child_name"><dt>孩子姓名</dt><dd>{{ visit.child_name }}</dd></div>
  <div v-if="visit.child_birthdate"><dt>出生年月日</dt><dd>{{ visit.child_birthdate }}</dd></div>
  <div v-if="visit.questions"><dt>想了解的事</dt><dd>{{ visit.questions }}</dd></div>
</dl>
```
   - 刪 `pending_confirmation` 與 `new／contacting` 那兩行 `<p class="parent-visit-muted">`，換成一行 `<p v-if="['new', 'contacting', 'pending_confirmation'].includes(visit.status)" class="parent-visit-muted">這筆需求還沒排定場次，園所會與你聯繫；也可以取消後重新選擇場次。</p>`。
   - `changeClosed` 那行文案改：`已超過線上修改時間{{ deadlineRule ? `（${deadlineRule}截止）` : '' }}。要更改請來電<template v-if="campusPhone"> <a :href="`tel:${campusPhone}`">{{ campusPhone }}</a></template><template v-else>聯絡園所</template>。`
   - 截止說明那行改 `線上修改截止：{{ deadlineLabel }}（台灣時間）。`
   - 操作列：

```html
<div v-if="!cancelOpen && !rescheduleOpen && !editOpen" class="parent-visit-actions">
  <button v-if="visit.can_reschedule" type="button" class="button primary" :disabled="busy" @click="openReschedule">改場次</button>
  <button v-if="visit.can_edit" type="button" class="button outline" :disabled="busy" @click="openEdit">修改資料</button>
  <button v-if="visit.can_cancel" type="button" class="button outline" :disabled="busy" @click="openCancel">取消預約</button>
  <button v-if="visit.status !== 'cancelled'" type="button" class="button outline" :disabled="busy" @click="reload">重新載入預約</button>
  <NuxtLink v-if="visit.status === 'cancelled' && visitCampus?.listed" class="button primary" :to="`/visit/${visit.campus_key}`">重新預約</NuxtLink>
</div>
```
   - 取消面板說明改「取消後這個場次會釋出給其他家長，這條連結也會失效。」
   - 改期表單：標題「選擇新的場次」、說明「按下確認就會改好，原本的場次會釋出。」、`label` 改「新的場次」、`option` 文字用 `slotLabel(slot)`、送出鈕文字 `{{ busy ? '正在改…' : '確認改到這個場次' }}`、空清單文案「目前沒有其他可選的場次，請直接聯絡園所。」
   - 在改期表單後面加修改資料表單：

```html
<form v-if="editOpen" ref="editPanel" class="parent-visit-confirm parent-visit-edit" novalidate @submit.prevent="submitEdit">
  <h3>修改預約資料</h3>
  <div class="parent-visit-fields">
    <label>家長稱呼<input v-model="editForm.parentName" autocomplete="name" maxlength="40" :aria-invalid="Boolean(editErrors.parentName)"></label>
    <p class="parent-visit-error">{{ editErrors.parentName }}</p>
    <label>聯絡手機<input v-model="editForm.phone" type="tel" inputmode="tel" autocomplete="tel" :aria-invalid="Boolean(editErrors.phone)"></label>
    <p class="parent-visit-error">{{ editErrors.phone }}</p>
    <label>Email<input v-model="editForm.email" type="email" inputmode="email" autocomplete="email" maxlength="254" :aria-invalid="Boolean(editErrors.email)"></label>
    <p class="parent-visit-error">{{ editErrors.email }}</p>
    <label>孩子姓名<input v-model="editForm.childName" maxlength="64" :aria-invalid="Boolean(editErrors.childName)"></label>
    <p class="parent-visit-error">{{ editErrors.childName }}</p>
    <label>孩子出生年月日<input v-model="editForm.childBirthdate" type="date" :max="taipeiDate()" :aria-invalid="Boolean(editErrors.childBirthdate)"></label>
    <p class="parent-visit-error">{{ editErrors.childBirthdate }}</p>
    <label>參觀人數<select v-model="editForm.partySize" :aria-invalid="Boolean(editErrors.partySize)"><option v-for="n in PARTY_SIZE_OPTIONS" :key="n" :value="String(n)">{{ n }} 位</option></select></label>
    <p class="parent-visit-error">{{ editErrors.partySize }}</p>
    <label>想了解的事<textarea v-model="editForm.questions" maxlength="500" rows="3" /></label>
  </div>
  <div class="parent-visit-actions">
    <button class="button primary" type="submit" :disabled="busy">{{ busy ? '正在儲存…' : '儲存修改' }}</button>
    <button class="button outline" type="button" :disabled="busy" @click="showEdit = false">返回預約</button>
  </div>
</form>
```
   - 聯絡區塊的說明改「若連結失效，或需要其他協助，請直接與園所聯繫。」
3. style 區塊最後加：

```css
.parent-visit-fields{display:grid;gap:4px}
.parent-visit-fields label{display:grid;gap:6px}
.parent-visit-fields .parent-visit-error:empty{display:none}
```

- [ ] **Step 5：跑測試與型別檢查**

```bash
npm --prefix web run test:unit
npm --prefix web run typecheck
```
Expected: 全部 PASS、typecheck 0 錯。

- [ ] **Step 6：本機畫面檢查**

依記憶「web dev server 不開 backend」：`NUXT_WEBSITE_ENV=development` ＋ fixture 啟動 web；用 Playwright（`channel:'chrome'`）在 1440×900 與 390×844 截表單、結果頁、管理頁。沒有後端時結果頁與管理頁用 `page.route` 回假資料（送單回 `{receipt_id, status:'confirmed', manage_path:'/visit/manage#token=t'}`；exchange 回 fixture）。截圖存 `output/playwright/self-booking-20260930/`，回報時附路徑。

- [ ] **Step 7：Commit（需授權）**

```bash
git add web/app/composables/useParentVisit.ts web/app/pages/visit/manage.vue web/tests/parent-visit.spec.ts
git commit -m "feat(web): 管理頁可以直接改場次、修改資料與取消

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 階段 B 閘門

```bash
npm --prefix web run typecheck
npm run test:website
```
兩者成功輸出貼進回報。
