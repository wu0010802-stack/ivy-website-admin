// 預約設定、同意版本與表單（2026-09-25 缺口 B04）：不可啟用原因、切換前的
// 影響範圍、稽核修改前後、隱私說明編輯、參觀人數與同意紀錄的顯示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, type VNode } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import BookingContentView from '../views/BookingContentView.vue'
import DashboardView from '../views/DashboardView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import PoliciesView from '../views/PoliciesView.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import { api, ApiError } from '../api/client'
import {
  AUDIT_REASON_LABELS,
  auditChangeSummary,
  configChangeLines,
  consentRecordLabel,
  partySizeLabel,
} from '../api/labels'
import { fieldReasons, impactLines, modeReasons, reasonAction } from '../composables/bookingReadiness'
import { PRIVACY_SAMPLE_MARKER, privacyHasSample, privacySampleSections } from '../composables/privacyNotice'
import type { BookingReadinessOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountAt(
  component: unknown,
  path: string,
  routePath = '/:pathMatch(.*)*',
  user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] }),
) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: routePath, component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const impact = { open_requests: 3, new_requests: 1, contacting: 0, pending_confirmation: 1, upcoming_confirmed: 1, past_confirmed: 0, bookable_slots: 4, weekly_rules: 0 }

function readiness(overrides: Partial<BookingReadinessOut> = {}): BookingReadinessOut {
  return {
    campus_key: 'yihua',
    current_mode: 'inquiry',
    consent: { revision_id: 'rev-1', version: 3, has_privacy_notice: false },
    blockers: {
      inquiry: [], slots: [{ code: 'NO_SLOTS_OR_RULES', message: '目前沒有官網可預約的場次，也沒有每週開放規則' }],
      line: [], phone: [], external: [], paused: [],
    },
    impact,
    ...overrides,
  }
}

function config(mode = 'inquiry', message: string | null = '請先填表') {
  return { campus_key: 'yihua', version: 4, mode, line_url: null, phone: null, external_url: null, message, slots_auto_confirm: false, parent_change_deadline_hours: 24 }
}

function mockBookingApi(ready: BookingReadinessOut | null = readiness(), saved = config()) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.endsWith('/readiness')) return ready as never
    if (path.startsWith('/admin/booking-config/')) return saved as never
    if (path.startsWith('/admin/campuses/')) return { key: 'yihua', name: '義華', active: true } as never
    return [] as never
  })
}

function saveButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find((button) => button.text() === '儲存並套用到官網')!
}

function textOf(node: unknown): string {
  const holder = mount(defineComponent({ render: () => (typeof node === 'string' ? h('div', node) : (node as VNode)) }))
  const text = holder.text()
  holder.unmount()
  return text
}

describe('啟用條件與影響範圍（純函式）', () => {
  it('欄位類條件看表單目前的值；資料類條件只在切換成該方式時算', () => {
    const blank = { line_url: '', phone: '', external_url: '', message: '' }
    expect(fieldReasons('line', blank)).toEqual(['請填寫 LINE 官方帳號連結'])
    expect(fieldReasons('paused', { ...blank, message: '  ' })[0]).toContain('暫停說明')
    expect(fieldReasons('paused', { ...blank, message: '暑假暫停' })).toEqual([])
    expect(fieldReasons('inquiry', blank)).toEqual([])
    const ready = readiness()
    expect(modeReasons('slots', blank, 'inquiry', ready).map((r) => r.code)).toEqual(['NO_SLOTS_OR_RULES'])
    // 已經在用 slots 的校區改其他設定不被擋（和後端一致）。
    expect(modeReasons('slots', blank, 'slots', ready)).toEqual([])
    // 讀不到 readiness 時只剩欄位類條件，存檔時後端仍會擋。
    expect(modeReasons('slots', blank, 'inquiry', null)).toEqual([])
  })

  it('影響範圍列出進行中的案件與場次', () => {
    const lines = impactLines(impact, 'paused')
    expect(lines[0]).toBe('進行中的案件 3 件（待處理 1、待園方確認 1、已確認、還沒參觀 1）：不會被修改，照常在「參觀案件」處理。')
    expect(lines.join('')).toContain('官網目前可預約的場次 4 個')
    expect(lines.join('')).toContain('待園方確認的 1 件仍占著名額')
    expect(impactLines({ ...impact, open_requests: 0, new_requests: 0, pending_confirmation: 0, upcoming_confirmed: 0, bookable_slots: 0 }, 'phone')).toEqual(['目前沒有進行中的案件。'])
    expect(impactLines(null, 'phone')[0]).toContain('無法讀取')
  })

  it('已過參觀時間、還沒結案的已確認案件另外列，細項加總等於進行中件數（B04-R4）', () => {
    const lines = impactLines({ ...impact, open_requests: 5, past_confirmed: 2 }, 'phone')
    expect(lines[0]).toBe('進行中的案件 5 件（待處理 1、待園方確認 1、已確認、還沒參觀 1、已過參觀時間、尚未結案 2）：不會被修改，照常在「參觀案件」處理。')
    // 舊版 API 沒有這個欄位時照舊顯示。
    const { past_confirmed: _omitted, ...legacy } = impact
    expect(impactLines(legacy as typeof impact, 'phone')[0]).not.toContain('尚未結案')
  })

  it('處理連結只給進得去的人，其他人看到要找誰（B04-R5）', () => {
    const superAdmin = testUser('super_admin')
    const campusAdmin = testUser('campus_admin', { campus_keys: ['yihua'] })
    const grantedCampusAdmin = testUser('campus_admin', { campus_keys: ['yihua'], capabilities: ['content.shared'] })
    expect(reasonAction('CONSENT_NOT_PUBLISHED', superAdmin)).toEqual({ to: '/content/booking-content', label: '到預約文案發布同意文字' })
    expect(reasonAction('CONSENT_NOT_PUBLISHED', grantedCampusAdmin)).toEqual({ to: '/content/booking-content', label: '到預約文案發布同意文字' })
    expect(reasonAction('CONSENT_NOT_PUBLISHED', campusAdmin)).toEqual({ note: '請聯絡總管理者到「預約文案」發布同意條款。' })
    expect(reasonAction('NO_SLOTS_OR_RULES', campusAdmin)).toEqual({ to: '/slots', label: '到時段與容量新增場次' })
    expect(reasonAction('FIELD', superAdmin)).toBeNull()
  })

  it('稽核修改前後與中文標籤', () => {
    expect(configChangeLines({ mode: 'paused', message: null, slots_auto_confirm: false }, { mode: 'inquiry', message: '歡迎', slots_auto_confirm: false })).toEqual([
      '預約方式：暫停預約 → 線上表單（收到需求後由園方聯絡）',
      '給家長的說明：（空白） → 歡迎',
    ])
    expect(auditChangeSummary({ mode: 'inquiry', before: { parent_change_deadline_hours: 24 }, after: { parent_change_deadline_hours: 72 } })).toBe('家長線上異動期限：參觀前 24 小時 → 參觀前 3 天')
    expect(auditChangeSummary({ mode: 'inquiry' })).toBe('')
    expect(AUDIT_REASON_LABELS.formal_consent_migration).toBeTruthy()
  })

  it('參觀人數與同意紀錄的顯示', () => {
    expect(partySizeLabel(3)).toBe('3 位')
    expect(partySizeLabel(null)).toBe('未填')
    expect(consentRecordLabel({ source: 'web', consent_given: true, consent_revision_id: 'r', consent_revision_version: 5, consent_accepted_at: '2026-09-25T02:00:00Z' })).toBe('家長勾選同意（預約文案第 5 版）・2026/09/25 10:00')
    expect(consentRecordLabel({ source: 'phone', consent_given: true, consent_revision_id: null, consent_accepted_at: null })).toBe('人員說明後代為勾選')
    expect(consentRecordLabel({ source: 'web', consent_given: true, consent_revision_id: null })).toContain('尚未記錄版本')
  })

  it('示意段落都帶標記，後台可以提早提醒不能發布', () => {
    const sample = privacySampleSections()
    expect(sample.length).toBeGreaterThan(0)
    expect(sample.every((s) => s.heading.includes(PRIVACY_SAMPLE_MARKER) && s.body.includes(PRIVACY_SAMPLE_MARKER))).toBe(true)
    expect(privacyHasSample({ privacy_title: '', privacy_sections: sample })).toBe(true)
    expect(privacyHasSample({ privacy_title: '個資使用說明', privacy_sections: [{ heading: '', body: '正式內容' }] })).toBe(false)
  })
})

describe('各校預約方式：不可啟用原因與切換確認', () => {
  it('選項下方列出不可啟用原因，選了就不能儲存並附上處理連結', async () => {
    mockBookingApi()
    const patch = vi.spyOn(api, 'patch')
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    const slotsOption = wrapper.get('input[type="radio"][value="slots"]').element.closest('label')!
    expect(slotsOption.textContent).toContain('不可啟用：目前沒有官網可預約的場次')
    await wrapper.get('input[type="radio"][value="slots"]').setValue(true)
    await nextTick()
    expect(wrapper.get('.blocked-reasons').text()).toContain('還不能使用「時段預約（家長自選場次）」')
    expect(wrapper.get('.blocked-reasons a').attributes('href')).toBe('/slots')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await saveButton(wrapper).trigger('click')
    expect(patch).not.toHaveBeenCalled()
  })

  it('沒有共用內容授權的分校管理者不會拿到進不去的預約文案連結（B04-R5）', async () => {
    const blocked = readiness({
      current_mode: 'paused',
      consent: null,
      blockers: {
        inquiry: [{ code: 'CONSENT_NOT_PUBLISHED', message: '「預約文案」還沒有發布同意條款文字' }],
        slots: [], line: [], phone: [], external: [], paused: [],
      },
    })
    mockBookingApi(blocked, config('paused', '暑假暫停'))
    const campusAdmin = testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] })
    const wrapper = await mountAt(BookingSettingsView, '/booking', '/:pathMatch(.*)*', campusAdmin)
    await wrapper.get('input[type="radio"][value="inquiry"]').setValue(true)
    await nextTick()
    const reasons = wrapper.get('.blocked-reasons')
    expect(reasons.find('a[href="/content/booking-content"]').exists()).toBe(false)
    expect(reasons.text()).toContain('請聯絡總管理者到「預約文案」發布同意條款。')
  })

  it('暫停預約要填暫停說明', async () => {
    mockBookingApi(readiness(), config('inquiry', null))
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    await wrapper.get('input[type="radio"][value="paused"]').setValue(true)
    await nextTick()
    expect(wrapper.get('.blocked-reasons').text()).toContain('暫停說明')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('暑假暫停，9 月恢復')
    expect(wrapper.find('.blocked-reasons').exists()).toBe(false)
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('切換方式前列出影響範圍，取消就不送出', async () => {
    const get = mockBookingApi()
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...config('phone'), phone: '07-000-0000', version: 5 } as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    await wrapper.get('input[type="radio"][value="phone"]').setValue(true)
    await nextTick()
    await wrapper.get('input[placeholder="07-000-0000"]').setValue('07-000-0000')
    const readinessLoads = () => get.mock.calls.filter((call) => String(call[0]).endsWith('/readiness')).length
    const before = readinessLoads()

    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    // 按下儲存時重讀影響範圍，不用頁面載入時的數字。
    expect(readinessLoads()).toBe(before + 1)
    const [message, title] = confirm.mock.calls[0]!
    expect(title).toBe('切換預約方式？')
    const text = textOf(message)
    expect(text).toContain('會從「線上表單（收到需求後由園方聯絡）」改成「電話洽詢」')
    expect(text).toContain('進行中的案件 3 件')
    expect(text).toContain('洽詢電話：（空白） → 07-000-0000')
    expect(patch).not.toHaveBeenCalled()

    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/booking-config/yihua', expect.objectContaining({ mode: 'phone', phone: '07-000-0000' }))
  })

  it('沒有換方式的存檔不跳切換確認', async () => {
    mockBookingApi()
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...config(), message: '新說明', version: 5 } as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    await wrapper.get('textarea').setValue('新說明')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledOnce()
  })

  it('後端擋下時顯示原因並保留輸入', async () => {
    mockBookingApi(null)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(400, {
      code: 'BOOKING_MODE_NOT_READY',
      message: '「預約文案」還沒有發布同意條款文字',
      reasons: [{ code: 'CONSENT_NOT_PUBLISHED', message: '「預約文案」還沒有發布同意條款文字' }],
    }))
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    await wrapper.get('input[type="radio"][value="slots"]').setValue(true)
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('還不能使用「時段預約（家長自選場次）」：「預約文案」還沒有發布同意條款文字')
    expect((wrapper.get('input[type="radio"][value="slots"]').element as HTMLInputElement).checked).toBe(true)
  })
})

describe('預約文案：隱私說明本文', () => {
  it('舊版內容沒有隱私欄位也能開；帶入示意段落後提醒不能發布', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/content-items/booking_content')) {
        return {
          id: 'item', kind: 'booking_content', campus_key: null, latest_version: 2, current_published_revision_id: 'rev-2',
          latest_revision: { id: 'rev-2', version: 2, created_at: '2026-09-24T00:00:00Z', payload: { cta_label: '預約參觀', cta_label_en: 'Book', consent_text: '我同意', banner_title_template: 't', banner_body: 'b', banner_button_label: 'l' } },
        } as never
      }
      return [] as never
    })
    const wrapper = await mountAt(BookingContentView, '/content/booking-content')
    expect(wrapper.text()).toContain('隱私／個資使用說明')
    expect(wrapper.findAll('.repeat-item')).toHaveLength(0)
    expect(wrapper.find('.privacy__alert').exists()).toBe(false)

    await wrapper.findAll('button').find((button) => button.text() === '帶入示意段落')!.trigger('click')
    expect(wrapper.findAll('.repeat-item').length).toBe(privacySampleSections().length)
    expect(wrapper.get('.privacy__alert').text()).toContain(`還有「${PRIVACY_SAMPLE_MARKER}」示意文字`)
    expect(wrapper.findAll('button').some((button) => button.text() === '帶入示意段落')).toBe(false)

    await wrapper.findAll('.repeat-item')[0]!.findAll('button').find((button) => button.text() === '移除')!.trigger('click')
    expect(wrapper.findAll('.repeat-item').length).toBe(privacySampleSections().length - 1)
  })
})

describe('總覽、案件明細、補登與全站設定', () => {
  it('開放選時段卻沒有場次的校區列入待辦', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/dashboard') {
        return { today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], campuses_slots_without_openings: ['yihua', 'renwu'], failed_notifications: 0 } as never
      }
      return [] as never
    })
    const wrapper = await mountAt(DashboardView, '/')
    expect(wrapper.text()).toContain('開放選時段，但沒有可預約的場次')
    expect(wrapper.text()).toContain('義華、仁武官網顯示「目前沒有開放的參觀場次」')
    expect(wrapper.text()).not.toContain('目前沒有待處理事項')
  })

  it('開放線上表單卻沒有發布同意條款的校區列入待辦，連結只給進得去的人（B04-R1）', async () => {
    const summary = { today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], campuses_slots_without_openings: [], campuses_form_without_consent: ['yihua'], failed_notifications: 0 }
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path === '/admin/dashboard' ? summary : []) as never)
    let wrapper = await mountAt(DashboardView, '/')
    expect(wrapper.text()).toContain('開放線上表單，但沒有發布同意條款')
    expect(wrapper.text()).toContain('義華的預約方式是線上表單')
    expect(wrapper.find('a[href="/content/booking-content"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('目前沒有待處理事項')
    wrapper.unmount()

    const campusAdmin = testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] })
    wrapper = await mountAt(DashboardView, '/', '/:pathMatch(.*)*', campusAdmin)
    expect(wrapper.text()).toContain('開放線上表單，但沒有發布同意條款')
    expect(wrapper.text()).toContain('請聯絡總管理者到「預約文案」發布同意條款')
    expect(wrapper.find('a[href="/content/booking-content"]').exists()).toBe(false)
  })

  it('案件明細顯示參觀人數與同意紀錄；舊案顯示未填', async () => {
    const base = { id: 'case', campus_key: 'yihua', status: 'new', source: 'web', parent_name: '陳媽媽', phone: '0912345678', child_name: null, child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, slot_id: null, slot: null, assigned_staff_id: null, confirmed_at: null, cancelled_at: null, follow_up_at: null, hold_expires_at: null, created_at: '2026-09-25T02:00:00Z', history: [], pending_reschedule: null, access_link: null, parent_change_deadline_hours: 24 }
    const detail = { ...base, party_size: 4, consent_given: true, consent_revision_id: 'rev', consent_revision_version: 7, consent_accepted_at: '2026-09-25T02:00:00Z' }
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path.startsWith('/admin/visit-requests/case') && !path.endsWith('/contact-notes') ? detail : []) as never)
    let wrapper = await mountAt(VisitDetailView, '/visit-requests/case', '/visit-requests/:id')
    expect(wrapper.text()).toContain('參觀人數4 位')
    expect(wrapper.text()).toContain('家長勾選同意（預約文案第 7 版）')
    wrapper.unmount()

    vi.restoreAllMocks()
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path.startsWith('/admin/visit-requests/case') && !path.endsWith('/contact-notes') ? { ...base, party_size: null, consent_given: true, consent_revision_id: null, consent_accepted_at: null } : []) as never)
    wrapper = await mountAt(VisitDetailView, '/visit-requests/case', '/visit-requests/:id')
    expect(wrapper.text()).toContain('參觀人數未填')
    expect(wrapper.text()).toContain('尚未記錄版本')
  })

  it('補登可以填參觀人數，問題上限 500 字', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'new-case', status: 'new', slot: null } as never)
    const wrapper = mount(ManualVisitDialog, { props: { campusKeys: ['yihua'], modelValue: false }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    for (const [placeholder, value] of [['例如：王媽媽', '王媽媽'], ['0912345678', '0912345678']] as const) {
      const input = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
      input.value = value
      input.dispatchEvent(new Event('input'))
    }
    const partySelect = wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '選填，含大人與孩子')!
    partySelect.vm.$emit('update:modelValue', 3)
    expect(document.body.querySelector('textarea[maxlength="500"]')).not.toBeNull()
    document.body.querySelector<HTMLInputElement>('.manual__consent input')!.click()
    await nextTick()
    ;[...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === '補登案件')!.click()
    await flushPromises()
    expect(post.mock.calls[0]![1]).toMatchObject({ party_size: 3 })
  })

  it('全站設定頁說明家長同意記錄的是預約文案的版本，不再有沒作用的隱私政策版本欄位', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ content: { site_meta: { description: '', share_image: '', allow_indexing: true } } } as never)
    const wrapper = await mountAt(PoliciesView, '/policies')
    expect(wrapper.text()).toContain('案件會記錄當時發布中的')
    expect(wrapper.text()).not.toContain('隱私政策版本')
    expect(wrapper.text()).not.toContain('改版後家長送出表單時會記錄同意的是哪一版')
    expect(wrapper.find('a[href="/content/booking-content"]').exists()).toBe(true)
  })
})
