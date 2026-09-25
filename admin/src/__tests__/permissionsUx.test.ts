import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import CampusFaqView from '../views/CampusFaqView.vue'
import UsersView from '../views/UsersView.vue'
import AccountView from '../views/AccountView.vue'
import { api } from '../api/client'
import { AUDIT_ACTION_LABELS, ROLE_DESCRIPTIONS, auditReasonLabel } from '../api/labels'
import type { UserOut } from '../api/types'
import { hasCapability } from '../composables/usePermissions'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountAs(component: unknown, user: UserOut, path = '/') {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, auth }
}

const buttonTexts = (wrapper: VueWrapper) => wrapper.findAll('button').map(button => button.text())
const desk = () => testUser('reception', { id: 'desk', email: 'desk@ivy.example', campus_keys: ['yihua'] })
const campusAdmin = (extra: string[] = []) => testUser('campus_admin', {
  id: 'ca', email: 'ca@ivy.example', campus_keys: ['yihua'],
  effective_capabilities: [...testUser('campus_admin').effective_capabilities, ...extra],
})

describe('依 effective_capabilities 判斷權限', () => {
  it('只看後端算好的清單，不看角色', () => {
    expect(hasCapability(testUser('reception'), 'booking.handle')).toBe(true)
    expect(hasCapability(testUser('reception'), 'booking.manage')).toBe(false)
    expect(hasCapability(testUser('super_admin', { effective_capabilities: [] }), 'booking.manage')).toBe(false)
    expect(hasCapability(null, 'booking.read')).toBe(false)
  })

  it('櫃台的角色說明與新權限一致，新的稽核動作有中文', () => {
    expect(ROLE_DESCRIPTIONS.reception).toContain('聯絡紀錄')
    expect(ROLE_DESCRIPTIONS.reception).not.toContain('只能查看')
    expect(ROLE_DESCRIPTIONS.campus_admin).toContain('匯出家長個資要另外授權')
    for (const action of ['user.unlink_google', 'user.login_google', 'user.login_google_failed', 'user.set_capabilities']) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy()
    }
    expect(auditReasonLabel('unsupported_account')).toBe('不是 Gmail 或 Google Workspace 帳號')
  })
})

describe('時段與容量', () => {
  const futureSlot = { id: 's1', campus_key: 'yihua', slot_date: '2099-01-05', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, closed: false, booked_count: 1 }
  function mockApi() {
    vi.spyOn(api, 'get').mockImplementation(async path => (String(path).startsWith('/admin/visit-schedule')
      ? { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [] }
      : [futureSlot]) as never)
  }

  it('櫃台看得到時段，但沒有新增、調整名額與關閉', async () => {
    mockApi()
    const { wrapper } = await mountAs(VisitSlotsView, desk(), '/slots')
    expect(wrapper.text()).toContain('新增時段、調整名額或關閉由校區管理者處理')
    expect(buttonTexts(wrapper)).not.toContain('新增時段')
    expect(buttonTexts(wrapper)).not.toContain('關閉')
    expect(buttonTexts(wrapper)).not.toContain('新增規則')
    const capacity = wrapper.findAllComponents({ name: 'ElInputNumber' }).filter(input => input.props('modelValue') === 3)
    expect(capacity.length).toBeGreaterThan(0)
    expect(capacity.every(input => input.props('disabled'))).toBe(true)
  })

  it('校區管理者可以新增、調整與關閉', async () => {
    mockApi()
    const { wrapper } = await mountAs(VisitSlotsView, campusAdmin(), '/slots')
    expect(buttonTexts(wrapper)).toContain('新增時段')
    expect(buttonTexts(wrapper)).toContain('關閉')
    expect(wrapper.text()).not.toContain('由校區管理者處理')
  })
})

describe('參觀案件列表', () => {
  it('櫃台可以補登；沒有匯出授權就不顯示匯出 CSV', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([])
    const { wrapper } = await mountAs(VisitRequestsView, desk(), '/visit-requests')
    expect(buttonTexts(wrapper)).toContain('補登案件')
    expect(buttonTexts(wrapper)).not.toContain('匯出 CSV')
  })

  it('被授權匯出的人才看得到匯出 CSV', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([])
    const { wrapper } = await mountAs(VisitRequestsView, campusAdmin(['booking.export']), '/visit-requests')
    expect(buttonTexts(wrapper)).toContain('匯出 CSV')
    wrapper.unmount(); wrappers.length = 0
    const plain = await mountAs(VisitRequestsView, campusAdmin(), '/visit-requests')
    expect(buttonTexts(plain.wrapper)).not.toContain('匯出 CSV')
  })
})

describe('站內通知', () => {
  const notification = { id: 'n1', campus_key: 'yihua', kind: 'visit_request_pending_confirmation', payload: {}, created_at: '2026-09-22T00:00:00Z', read_at: null }
  const reschedule = {
    id: 'r1', visit_request_id: 'v1', campus_key: 'yihua', status: 'pending', parent_name: '陳媽媽',
    current_slot: { id: 's1', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' },
    requested_slot: { id: 's2', slot_date: '2099-10-02', start_time: '14:00:00', end_time: '15:00:00' },
    requested_slot_remaining: 2, requested_slot_available: true, created_at: '2026-09-22T00:00:00Z',
  }
  function mockApi() {
    vi.spyOn(api, 'get').mockImplementation(async path => (String(path).includes('notification-outbox') ? [] : String(path).includes('reschedule-requests') ? [reschedule] : [notification]) as never)
  }

  it('櫃台可以標記已讀、核准或退回改期', async () => {
    mockApi()
    const { wrapper } = await mountAs(NotificationsView, desk(), '/notifications')
    expect(wrapper.text()).toContain('新的時段申請（待園方確認）')
    expect(buttonTexts(wrapper)).toContain('全部標記已讀')
    expect(buttonTexts(wrapper)).toContain('標記已讀')
    expect(buttonTexts(wrapper)).toContain('核准')
  })

  it('沒有處理權的帳號只看清單', async () => {
    mockApi()
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const { wrapper } = await mountAs(NotificationsView, viewer, '/notifications')
    expect(wrapper.text()).toContain('查看案件')
    for (const label of ['全部標記已讀', '標記已讀', '核准', '退回']) expect(buttonTexts(wrapper)).not.toContain(label)
  })
})

describe('分校內容唯讀模式', () => {
  const item = { id: 'c1', latest_version: 1, current_published_revision_id: 'r1', latest_revision: { id: 'r1', created_at: '2026-09-22T00:00:00Z', payload: { name: '義華校', items: [{ q: '幾歲入園？', a: '兩歲' }] }, review_status: 'approved' } }

  it('唯讀帳號看得到內容，但欄位停用、沒有儲存與送審', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(item as never)
    const reader = testUser('readonly', { campus_keys: ['yihua'] })
    const { wrapper } = await mountAs(CampusProfileView, reader, '/content/campus-profile')
    expect(wrapper.text()).toContain('唯讀')
    expect(wrapper.findAllComponents({ name: 'ElInput' }).length).toBeGreaterThan(0)
    expect(wrapper.findAll('input').every(input => input.attributes('disabled') !== undefined)).toBe(true)
    for (const label of ['儲存草稿', '送審', '發布到官網']) expect(buttonTexts(wrapper)).not.toContain(label)
    expect(wrapper.find('.editor__actions').exists()).toBe(false)
  })

  it('常見問題的排序、刪除與新增在唯讀時不出現', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(item as never)
    const reader = testUser('readonly', { campus_keys: ['yihua'] })
    const { wrapper } = await mountAs(CampusFaqView, reader, '/content/campus-faq')
    expect(wrapper.findAll('input').some(input => (input.element as HTMLInputElement).value === '幾歲入園？')).toBe(true)
    for (const label of ['上移', '下移', '移除', '新增一題']) expect(buttonTexts(wrapper)).not.toContain(label)
  })

  it('內容編輯可以編輯並送審', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(item as never)
    const editor = testUser('editor', { campus_keys: ['yihua'] })
    const { wrapper } = await mountAs(CampusProfileView, editor, '/content/campus-profile')
    expect(wrapper.text()).not.toContain('唯讀：')
    expect(buttonTexts(wrapper)).toContain('儲存草稿')
    expect(buttonTexts(wrapper)).toContain('送審')
    expect(wrapper.findAll('input').some(input => input.attributes('disabled') === undefined)).toBe(true)
  })
})

describe('使用者：匯出授權與登入綁定', () => {
  const people = [
    testUser('campus_admin', { id: 'ca', email: 'ca@ivy.example', campus_keys: ['yihua'], capabilities: ['booking.export'], google_linked: true }),
    testUser('reception', { id: 'rc', email: 'rc@ivy.example', campus_keys: ['yihua'], line_linked: true }),
  ]

  it('列表標出誰可以匯出個資、誰綁了 Google／LINE', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(people as never)
    const { wrapper } = await mountAs(UsersView, testUser('super_admin', { id: 'me' }), '/users')
    const text = wrapper.text()
    expect(text).toContain('可匯出個資')
    expect(text).toContain('Google')
    expect(text).toContain('LINE')
  })

  it('改角色時一起送出匯出授權，保留原有的授權', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(people as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (path, body) => {
      if (String(path).endsWith('/role')) return { ...people[1], capabilities: [] } as never
      return { ...people[1], capabilities: (body as { capabilities: string[] }).capabilities } as never
    })
    const { wrapper } = await mountAs(UsersView, testUser('super_admin', { id: 'me' }), '/users')
    const scopeButtons = wrapper.findAll('button').filter(button => button.text() === '角色與校區')
    await scopeButtons[1]!.trigger('click')
    await flushPromises()
    const exportBox = wrapper.findAllComponents({ name: 'ElCheckbox' }).find(box => box.text().includes('匯出負責校區的家長個資'))!
    expect(exportBox).toBeTruthy()
    await exportBox.find('input').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '儲存')!.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/users/rc/role', { role: 'reception', campus_keys: ['yihua'] })
    expect(patch).toHaveBeenCalledWith('/admin/users/rc/capabilities', { capabilities: ['booking.export'] })
  })
})

describe('我的帳號：Google 綁定', () => {
  it('已綁定時顯示狀態並可以解除', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const remove = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    const { wrapper, auth } = await mountAs(AccountView, testUser('reception', { campus_keys: ['yihua'], google_linked: true }), '/account')
    expect(wrapper.text()).toContain('Google 登入')
    expect(wrapper.text()).toContain('負責校區義華')
    expect(wrapper.find('[data-test="google-unlink"]').exists()).toBe(true)
    await wrapper.getComponent({ name: 'ElPopconfirm' }).vm.$emit('confirm', new MouseEvent('click'))
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('/auth/google/link')
    expect(auth.user?.google_linked).toBe(false)
    expect(wrapper.text()).toContain('已解除 Google 綁定')
    expect(wrapper.find('[data-test="google-unlink"]').exists()).toBe(false)
  })

  it('未綁定時說明怎麼綁；Google 未啟用時直接講', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const { wrapper } = await mountAs(AccountView, testUser('campus_admin', { campus_keys: ['yihua'] }), '/account')
    expect(wrapper.text()).toContain('相同 Email 的 Gmail 或 Google Workspace 帳號登入')
    wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()

    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const off = await mountAs(AccountView, testUser('campus_admin', { campus_keys: ['yihua'] }), '/account')
    expect(off.wrapper.text()).toContain('Google 登入尚未啟用')
  })
})
