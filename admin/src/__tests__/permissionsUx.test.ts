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
import DashboardView from '../views/DashboardView.vue'
import AuditView from '../views/AuditView.vue'
import { api } from '../api/client'
import { AUDIT_ACTION_LABELS, ROLE_DESCRIPTIONS, auditChangeSummary, auditMetadataSummary, auditReasonLabel } from '../api/labels'
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

  it('櫃台可以核准或退回改期，但標記已讀（全校共用的狀態）等業主確認前不開放', async () => {
    mockApi()
    const post = vi.spyOn(api, 'post')
    const { wrapper } = await mountAs(NotificationsView, desk(), '/notifications')
    expect(wrapper.text()).toContain('新的時段申請（待園方確認）')
    expect(buttonTexts(wrapper)).toContain('核准')
    expect(buttonTexts(wrapper)).toContain('退回')
    expect(buttonTexts(wrapper)).not.toContain('全部標記已讀')
    expect(buttonTexts(wrapper)).not.toContain('標記已讀')
    expect(post).not.toHaveBeenCalled()
  })

  it('校區管理者可以標記已讀', async () => {
    mockApi()
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const { wrapper } = await mountAs(NotificationsView, campusAdmin(), '/notifications')
    expect(buttonTexts(wrapper)).toContain('全部標記已讀')
    await wrapper.findAll('button').find(button => button.text() === '標記已讀')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/notifications/n1/read')
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

  it('唯讀時狀態列只說現況，不叫人修改或送審', async () => {
    const reader = testUser('readonly', { campus_keys: ['yihua'] })
    vi.spyOn(api, 'get').mockResolvedValue({
      ...item, current_published_revision_id: null,
      latest_revision: { ...item.latest_revision, review_status: 'pending_review' },
    } as never)
    const pending = await mountAs(CampusProfileView, reader, '/content/campus-profile')
    expect(pending.wrapper.text()).toContain('已送審，等待核准')
    expect(pending.wrapper.text()).toContain('送審的版本核准後才會出現在官網')
    expect(pending.wrapper.text()).not.toContain('可以繼續修改')
    pending.wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()

    vi.spyOn(api, 'get').mockResolvedValue({ id: 'c1', latest_version: 0, current_published_revision_id: null, latest_revision: null } as never)
    const empty = await mountAs(CampusProfileView, reader, '/content/campus-profile')
    expect(empty.wrapper.text()).toContain('這份內容還沒有草稿')
    expect(empty.wrapper.text()).not.toContain('先儲存草稿')
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

  it('換角色時匯出授權跟著清掉並說明，要保留得重新勾選', async () => {
    const mover = testUser('campus_admin', { id: 'mv', email: 'mv@ivy.example', campus_keys: ['yihua'], capabilities: ['booking.export'] })
    vi.spyOn(api, 'get').mockResolvedValue([mover] as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async path => {
      if (String(path).endsWith('/role')) return { ...mover, role: 'reception', capabilities: [] } as never
      return mover as never
    })
    const { wrapper } = await mountAs(UsersView, testUser('super_admin', { id: 'me' }), '/users')
    await wrapper.findAll('button').find(button => button.text() === '角色與校區')!.trigger('click')
    await flushPromises()
    const exportBox = () => wrapper.findAllComponents({ name: 'ElCheckbox' }).find(box => box.text().includes('匯出負責校區的家長個資'))!
    expect(exportBox().props('modelValue')).toBe(true)
    expect(wrapper.find('[data-test="export-dropped"]').exists()).toBe(false)

    const receptionRadio = wrapper.findAllComponents({ name: 'ElRadio' }).find(radio => radio.text() === '櫃台')!
    await receptionRadio.find('input').setValue(true)
    await flushPromises()
    expect(exportBox().props('modelValue')).toBe(false)
    expect(wrapper.get('[data-test="export-dropped"]').text()).toContain('換角色會收回原本的個資匯出授權')

    await wrapper.findAll('button').find(button => button.text() === '儲存')!.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/users/mv/role', { role: 'reception', campus_keys: ['yihua'] })
    expect(patch).not.toHaveBeenCalledWith('/admin/users/mv/capabilities', expect.anything())
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

  it('已綁定但 Google 登入關閉時，不說可以用 Google 登入，仍可解除', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper } = await mountAs(AccountView, testUser('reception', { campus_keys: ['yihua'], google_linked: true, line_linked: true }), '/account')
    expect(wrapper.text()).not.toContain('可以在登入頁用 Google 直接登入')
    expect(wrapper.get('[data-test="google-disabled-linked"]').text()).toContain('Google 登入目前未開放，綁定仍保留')
    expect(wrapper.find('[data-test="google-unlink"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('可以在登入頁用 LINE 直接登入')
    expect(wrapper.get('[data-test="line-disabled-linked"]').text()).toContain('LINE 登入目前未開放')
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

describe('營運總覽只放點得進去的連結（第 27 條）', () => {
  const summary = {
    today_visits: 0, pending_follow_up: 0, failed_notifications: 0,
    campuses_without_active_booking: ['yihua'], campuses_slots_without_openings: ['yihua'],
    pending_publish: 2, pending_publish_kinds: ['campus_faq', 'home_about'],
    pending_publish_items: [
      { kind: 'home_about', campus_key: null, latest_version: 5, published_version: 4, updated_at: '2026-09-25T02:00:00Z' },
      { kind: 'campus_faq', campus_key: 'yihua', latest_version: 1, published_version: null, updated_at: '2026-09-24T02:00:00Z' },
    ],
    content_media_issues: [{ kind: 'campus_tour', campus_key: 'yihua', missing: 1, not_ready: 0, live: true }],
    failed_publish_jobs: [{ id: 'j1', kind: 'home_news', campus_key: null, revision_version: 3, publish_at: '2026-09-25T01:00:00Z', error: '素材還沒處理好' }],
    pending_review: 2,
  }
  const reviews = [
    { kind: 'home_hero', campus_key: null, revision_id: 'rv1', submitted_by_email: 'ed@ivy.example' },
    { kind: 'campus_profile', campus_key: 'yihua', revision_id: 'rv2', submitted_by_email: 'ed@ivy.example' },
  ]
  function mockApi() {
    return vi.spyOn(api, 'get').mockImplementation(async path => (
      path === '/admin/dashboard' ? summary : path === '/admin/content-reviews' ? reviews : []
    ) as never)
  }
  const hrefs = (wrapper: VueWrapper) => wrapper.findAll('a').map(a => a.attributes('href') ?? '')

  it('櫃台：沒有內容提醒、預約方式不給連結、時段只能查看', async () => {
    const get = mockApi()
    const { wrapper } = await mountAs(DashboardView, desk(), '/')
    const text = wrapper.text()
    expect(text).toContain('校區尚未開放預約')
    expect(text).toContain('預約方式由校區管理者設定')
    expect(text).toContain('新增場次或每週開放規則由校區管理者處理')
    expect(text).toContain('查看參觀時段')
    expect(text).toContain('查看接待月曆')
    for (const hidden of ['安排參觀時段', '草稿尚未公開', '內容缺少素材', '排程發布沒有執行', '內容等你審核', '更新首頁文字', '修改各校資料', '整理照片與影片', '管理使用者', '整理官網內容']) {
      expect(text).not.toContain(hidden)
    }
    const links = hrefs(wrapper)
    expect(links).toContain('/slots')
    expect(links).toContain('/visit-calendar')
    for (const blocked of ['/booking', '/media', '/releases', '/users']) expect(links.some(href => href.startsWith(blocked))).toBe(false)
    expect(links.some(href => href.startsWith('/content/'))).toBe(false)
    expect(get).not.toHaveBeenCalledWith('/admin/content-reviews')
  })

  it('沒有全站共用內容授權的分校管理者：只列本校內容，不列共用內容', async () => {
    mockApi()
    const { wrapper } = await mountAs(DashboardView, campusAdmin(), '/')
    const text = wrapper.text()
    const links = hrefs(wrapper)
    expect(links).toContain('/booking')
    expect(text).toContain('安排參觀時段')
    expect(links).toContain('/content/campus-faq?campus=yihua')
    expect(links).toContain('/content/campus-tour?campus=yihua')
    expect(links).toContain('/content/campus-profile?campus=yihua')
    expect(links).not.toContain('/content/home-about')
    expect(links).not.toContain('/content/home-hero')
    expect(text).not.toContain('排程發布沒有執行')
    expect(text).not.toContain('更新首頁文字')
    expect(text).toContain('修改各校資料')
    expect(text).not.toContain('管理使用者')
    const draftTask = wrapper.findAll('.task').find(task => task.text().includes('草稿尚未公開'))!
    expect(draftTask.find('.task__number').text()).toBe('1')
  })

  it('有全站共用內容授權就列出共用內容與首頁入口', async () => {
    mockApi()
    const shared = campusAdmin(['content.shared'])
    const { wrapper } = await mountAs(DashboardView, { ...shared, capabilities: ['content.shared'] }, '/')
    const links = hrefs(wrapper)
    expect(links).toContain('/content/home-about')
    expect(links).toContain('/content/home-hero')
    expect(wrapper.text()).toContain('排程發布沒有執行')
    const draftTask = wrapper.findAll('.task').find(task => task.text().includes('草稿尚未公開'))!
    expect(draftTask.find('.task__number').text()).toBe('2')
  })
})

describe('操作紀錄看得出授權變更', () => {
  it('授予或收回哪一項、改角色時收回了什麼都轉成中文', () => {
    expect(auditChangeSummary({ before: [], after: ['booking.export'] })).toBe('授予：匯出個資')
    expect(auditChangeSummary({ before: ['booking.export', 'content.shared'], after: ['content.shared'] })).toBe('收回：匯出個資')
    expect(auditChangeSummary({ before: ['content.shared'], after: ['content.shared'] })).toBe('沒有變更（全站內容）')
    const setRole = auditMetadataSummary({
      before: { role: 'campus_admin', campus_keys: ['yihua'] },
      after: { role: 'reception', campus_keys: ['yihua', 'renwu'] },
      capabilities_removed: ['booking.export'],
    })
    expect(setRole).toContain('因改角色收回授權：匯出個資')
    expect(setRole).toContain('角色：校區管理者 → 櫃台')
    expect(setRole).toContain('負責校區：義華 → 義華、仁武')
    expect(auditMetadataSummary({ role: 'reception', campus_keys: ['yihua'], capabilities: [] })).toBe('角色：櫃台，負責校區：義華，授權：無')
    // 原本就顯示的純值不受影響。
    expect(auditMetadataSummary({ before: true, after: false, reason: 'inactive' })).toBe('before=true，after=false，原因=帳號已停用')
  })

  it('操作紀錄頁顯示授權變更的內容', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      { id: 'a1', actor_user_id: 'me', action: 'user.set_capabilities', target_type: 'user', target_id: 'u1', campus_key: null, metadata: { before: [], after: ['booking.export'] }, created_at: '2026-09-25T02:00:00Z' },
      { id: 'a2', actor_user_id: 'me', action: 'user.set_role', target_type: 'user', target_id: 'u2', campus_key: null, metadata: { before: { role: 'campus_admin', campus_keys: ['yihua'] }, after: { role: 'reception', campus_keys: ['yihua'] }, capabilities_removed: ['booking.export'] }, created_at: '2026-09-25T03:00:00Z' },
    ] as never)
    const { wrapper } = await mountAs(AuditView, testUser('super_admin', { id: 'me' }), '/audit')
    const text = wrapper.text()
    expect(text).toContain('修改：授予：匯出個資')
    expect(text).toContain('因改角色收回授權：匯出個資')
    expect(text).toContain('角色：校區管理者 → 櫃台')
  })
})
