// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, Suspense, watch } from 'vue'
import Manage from '../app/pages/visit/manage.vue'
import { expectedStartOptions, taipeiDate } from '../app/utils/visit-form'

// 2026-10-15 家長管理頁的預計入學時間：直接把 manage.vue 掛起來測（真的 useParentVisit，$fetch 換成依呼叫順序回應的替身）。
// Nuxt 的自動匯入與區塊元件換成最小的替身。
vi.stubGlobal('usePublishedSite', async () => ({ data: ref(null) }))
vi.stubGlobal('useRoute', () => ({ path: '/visit/manage', query: {}, hash: '' }))
vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
vi.stubGlobal('useHead', vi.fn())
for (const [name, fn] of Object.entries({ computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch })) vi.stubGlobal(name, fn)

// 送單時選的是已經過去的學期（110 學年上學期）：不在今天的公開選項裡，管理頁要保留顯示。
const visit = {
  id: 'visit-1', campus_key: 'minghua', status: 'confirmed',
  parent_name: '王媽媽', phone: '0999000001', email: 'wang@example.com', child_name: '小安', child_birthdate: '2022-05-01',
  party_size: null, questions: null, version: 3, can_edit: true, expected_start: '110-1',
  campus_name: '明華校', campus_active: true, campus_phone: '07-3000000',
  slot: { id: 'slot-1', slot_date: '2026-10-10', start_time: '10:00:00', end_time: '11:00:00' },
  confirmed_at: null, cancelled_at: null, created_at: '2026-09-23T00:00:00Z',
  change_deadline: '2026-10-09T02:00:00Z', change_deadline_hours: 24, can_cancel: true, can_reschedule: false
}
const conflict = { response: { status: 409 }, data: { detail: { code: 'VISIT_REQUEST_VERSION_CONFLICT' } } }
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

type Reply = Record<string, unknown> | { fail: unknown }
let wrapper: VueWrapper | null = null
let calls: { url: string; options: { method?: string; body?: Record<string, unknown> } }[] = []

// replies 依 $fetch 呼叫順序回應；第一個一定是頁面載入時讀 /me。
function fetchReplies(...replies: Reply[]) {
  calls = []
  const queue = [...replies]
  vi.stubGlobal('$fetch', vi.fn(async (url: string, options: { method?: string; body?: Record<string, unknown> } = {}) => {
    calls.push({ url, options })
    const reply = queue.shift()
    if (!reply) throw new Error(`沒有預備的回應：${url}`)
    if ('fail' in reply) throw reply.fail
    return reply
  }))
}

async function mountPage() {
  wrapper = mount(defineComponent({ render: () => h(Suspense, null, { default: () => h(Manage) }) }), {
    global: { stubs: { NuxtLink: true, SiteHeader: true, SiteFooter: true, VisitCalendarActions: true, VisitDatePicker: true } }
  })
  await flushPromises()
  return wrapper
}
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
async function openEdit(page: VueWrapper) {
  await button(page, '修改資料').trigger('click')
  await flushPromises()
}
const startLabels = (page: VueWrapper) => page.findAll('.parent-visit-start label').map(item => item.text())
const startRadios = (page: VueWrapper) => page.findAll<HTMLInputElement>('input[name="editExpectedStart"]')
const checkedLabel = (page: VueWrapper) => page.findAll('.parent-visit-start label').find(item => item.find<HTMLInputElement>('input').element.checked)?.text()

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('家長管理頁：預計入學時間', () => {
  it('明細顯示已選的值（學期換成月份）；沒選的案件不列這一行', async () => {
    fetchReplies(visit)
    const page = await mountPage()
    expect(page.find('.parent-visit-details').text()).toContain('預計入學2021 年 9 月')
    wrapper!.unmount()
    fetchReplies({ ...visit, expected_start: null })
    const blank = await mountPage()
    expect(blank.find('.parent-visit-details').text()).toContain('家長稱呼')
    expect(blank.find('.parent-visit-details').text()).not.toContain('預計入學')
  })

  it('原值已不在今天的選項：編輯表單把原值放在最前面並勾選，其後是今天的選項', async () => {
    fetchReplies(visit)
    const page = await mountPage()
    await openEdit(page)
    const labels = startLabels(page)
    expect(labels[0]).toBe('2021 年 9 月')
    expect(labels).toContain('盡快（這學期）')
    expect(labels.at(-1)).toBe('還不確定')
    expect(checkedLabel(page)).toBe('2021 年 9 月')
  })

  it('版本衝突重載後，保留原值那個選項換成最新的值（W3-9）', async () => {
    fetchReplies(visit, { fail: conflict }, { ...visit, version: 4, expected_start: '111-1' })
    const page = await mountPage()
    await openEdit(page)
    expect(startLabels(page)[0]).toBe('2021 年 9 月')
    await page.find('input[type="tel"]').setValue('0922333444')
    await page.find('form.parent-visit-edit').trigger('submit')
    await flushPromises()
    expect(calls.map(call => call.options.method ?? 'GET')).toEqual(['GET', 'PATCH', 'GET'])
    const labels = startLabels(page)
    expect(labels[0]).toBe('2022 年 9 月')
    expect(labels).not.toContain('2021 年 9 月')
    expect(checkedLabel(page)).toBe('2022 年 9 月')
  })

  it('關掉表單、頁面重新載入、再打開：選項跟著新的原值（W3-9）', async () => {
    fetchReplies(visit, { ...visit, version: 4, expected_start: '111-1' })
    const page = await mountPage()
    await openEdit(page)
    expect(startLabels(page)[0]).toBe('2021 年 9 月')
    await button(page, '返回預約').trigger('click')
    await button(page, '重新載入預約').trigger('click')
    await flushPromises()
    await openEdit(page)
    expect(startLabels(page)[0]).toBe('2022 年 9 月')
    expect(startLabels(page)).not.toContain('2021 年 9 月')
  })

  it('再點一次已選的那個就取消，儲存時送 null（不是空字串）', async () => {
    fetchReplies(visit, { ...visit, version: 4, expected_start: null })
    const page = await mountPage()
    await openEdit(page)
    await startRadios(page)[0]!.trigger('click')
    await nextTick()
    expect(checkedLabel(page)).toBeUndefined()
    await page.find('form.parent-visit-edit').trigger('submit')
    await flushPromises()
    const patch = calls.find(call => call.options.method === 'PATCH')!
    expect(patch.options.body).toMatchObject({ visit_request_id: 'visit-1', expected_version: 3, expected_start: null })
  })

  it('改選另一個月份，儲存時只送這一欄的新值（月份取自今天的選項，不寫死學期）', async () => {
    const option = expectedStartOptions(taipeiDate()).find(item => item.value !== 'asap' && item.value !== 'unsure')!
    fetchReplies(visit, { ...visit, version: 4, expected_start: option.value })
    const page = await mountPage()
    await openEdit(page)
    const target = startRadios(page).find(radio => radio.element.value === option.value)!
    await target.trigger('click')
    await nextTick()
    expect(checkedLabel(page)).toBe(option.label)
    await page.find('form.parent-visit-edit').trigger('submit')
    await flushPromises()
    const patch = calls.find(call => call.options.method === 'PATCH')!
    expect(patch.options.body).toEqual({ visit_request_id: 'visit-1', expected_version: 3, expected_start: option.value })
  })

  it('鍵盤：已選的那個按 Space 取消，未選的按 Space 選取（已勾選的 radio 按 Space 不會觸發 click）', async () => {
    fetchReplies(visit)
    const page = await mountPage()
    await openEdit(page)
    const original = startRadios(page)[0]!
    const other = startRadios(page).find(radio => radio.element.value === 'unsure')!
    expect(checkedLabel(page)).toBe('2021 年 9 月')
    await original.trigger('keydown', { key: ' ' })
    await nextTick()
    expect(checkedLabel(page)).toBeUndefined()
    await original.trigger('keydown', { key: ' ' })
    await nextTick()
    expect(checkedLabel(page)).toBe('2021 年 9 月')
    await other.trigger('keydown', { key: ' ' })
    await nextTick()
    expect(checkedLabel(page)).toBe('還不確定')
    expect(startRadios(page).filter(radio => radio.element.checked)).toHaveLength(1)
  })

  it('鍵盤：按其他鍵不會改選取', async () => {
    fetchReplies(visit)
    const page = await mountPage()
    await openEdit(page)
    await startRadios(page)[0]!.trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(checkedLabel(page)).toBe('2021 年 9 月')
  })

  it('什麼都不改直接儲存：不送這個欄位', async () => {
    fetchReplies(visit)
    const page = await mountPage()
    await openEdit(page)
    await page.find('form.parent-visit-edit').trigger('submit')
    await flushPromises()
    expect(calls.filter(call => call.options.method === 'PATCH')).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })
})

describe('家長管理頁：單選膠囊的樣式（W3-7）', () => {
  const manage = read('../app/pages/visit/manage.vue')

  it('既有的 .parent-visit-fields input 規則原樣保留（mobile-ux-20261012 逐字釘住）', () => {
    expect(manage).toContain('.parent-visit-fields input{display:block;width:100%;min-width:0;min-height:54px;')
  })

  it('另有優先度更高的 radio 規則把尺寸、邊框還原成一般單選鈕，膠囊本身用 var(--line) 的邊框', () => {
    const rule = manage.match(/\.parent-visit-fields \.parent-visit-start input\[type="radio"\]\s*\{([^}]*)\}/)
    expect(rule?.[1]).toContain('width:18px')
    expect(rule?.[1]).toContain('min-height:0')
    expect(rule?.[1]).toContain('padding:0')
    const pill = manage.match(/\.parent-visit-fields \.parent-visit-start label\s*\{([^}]*)\}/)
    expect(pill?.[1]).toContain('display:flex')
    expect(pill?.[1]).toContain('border:1px solid var(--line)')
    expect(manage).not.toMatch(/\.parent-visit-start[^{]*\{[^}]*(#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\()/)
  })
})
