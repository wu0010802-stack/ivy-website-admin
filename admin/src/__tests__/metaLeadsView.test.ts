// 廣告名單收件匣（docs/specs/2026-11-26-meta-lead-inbox-design.md）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import MetaLeadsView from '../views/MetaLeadsView.vue'
import type { MetaLeadListOut, MetaLeadOut } from '../api/types'
import { notifyWarning } from '../composables/notify'
import { canListNavItem, navItem } from '../router/nav'
import { api } from '../api/client'
import { cleanup, deferred, mockGet, mockPost, mountWith } from './admissionsTestKit'
import { testUser } from './fixtures'

vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.mocked(notifyWarning).mockClear()
})

function lead(overrides: Partial<MetaLeadOut> = {}): MetaLeadOut {
  return {
    id: 'l1',
    campus_key: 'yihua',
    form_name: '義華參觀表單',
    platform: 'fb',
    is_organic: false,
    created_at: '2026-11-26T02:30:00Z',
    parent_name: '王媽媽',
    phone: '0912345678',
    answers: [{ question: '孩子幾歲', answer: '3 歲' }],
    status: 'new',
    visit_request_id: null,
    handled_at: null,
    ...overrides,
  }
}

function list(overrides: Partial<MetaLeadListOut> = {}): MetaLeadListOut {
  return {
    configured: true,
    sync_seconds: 3600,
    sync: { last_attempt_at: '2026-11-26T01:00:00Z', last_success_at: '2026-11-26T01:00:00Z', last_error: null, last_count: 2 },
    counts: { new: 1, converted: 1, dismissed: 1 },
    leads: [lead()],
    ...overrides,
  }
}

const button = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find((b) => b.text() === label)

describe('廣告名單', () => {
  it('列出名單：電話是 tel 連結、來源與作答都顯示、頁籤帶數量', async () => {
    const get = mockGet({ '/admin/meta-leads': list() })
    const { wrapper, router } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    expect(get).toHaveBeenCalledWith('/admin/meta-leads?campus_key=yihua&status=new')
    expect(wrapper.text()).toContain('王媽媽')
    expect(wrapper.get('a[href="tel:0912345678"]').text()).toBe('0912345678')
    expect(wrapper.text()).toContain('表單：義華參觀表單')
    expect(wrapper.text()).toContain('Facebook')
    expect(wrapper.text()).toContain('孩子幾歲')
    expect(wrapper.text()).toContain('3 歲')
    expect(wrapper.text()).toContain('新名單 1')
    expect(wrapper.text()).toContain('已轉案件 1')
    expect(wrapper.text()).toContain('每 1 小時自動同步')
    expect(router.currentRoute.value.query.campus).toBe('yihua')
  })

  it('網址 ?campus= 有給就預選那一校', async () => {
    const get = mockGet({ '/admin/meta-leads': list() })
    const user = testUser('super_admin', { id: 'admin', email: 'admin@example.invalid' })
    await mountWith(MetaLeadsView, { path: '/meta-leads?campus=renwu', user })
    expect(get).toHaveBeenCalledWith('/admin/meta-leads?campus_key=renwu&status=new')
  })

  it('快速切換頁籤：較晚回來的舊頁籤回應不會蓋掉目前頁籤的清單', async () => {
    const slow = deferred<MetaLeadListOut>()
    const dismissed = list({ leads: [lead({ id: 'l9', status: 'dismissed', parent_name: '已略過的那位' })] })
    mockGet({
      '/admin/meta-leads': (path: string) =>
        path.includes('status=converted') ? slow.promise : path.includes('status=dismissed') ? dismissed : list(),
    })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    const tabs = wrapper.get('[aria-label="名單狀態"]').findAll('input')
    await tabs[1]!.setValue(true)
    await tabs[2]!.setValue(true)
    await flushPromises()
    expect(wrapper.text()).toContain('已略過的那位')
    slow.resolve(list({ leads: [lead({ id: 'l5', status: 'converted', parent_name: null, phone: null, answers: [], visit_request_id: 'v1' })] }))
    await flushPromises()
    expect(wrapper.text()).toContain('已略過的那位')
    expect(wrapper.text()).not.toContain('已轉成參觀案件')
  })

  it('略過：送 dismiss 後重新讀這一頁', async () => {
    const get = mockGet({ '/admin/meta-leads': list() })
    const post = mockPost({ '/admin/meta-leads/l1/dismiss': lead({ status: 'dismissed' }) })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    get.mockClear()
    await button(wrapper, '略過')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/meta-leads/l1/dismiss')
    expect(get).toHaveBeenCalledWith('/admin/meta-leads?campus_key=yihua&status=new')
  })

  it('已略過：放回送 restore，也還能轉成參觀案件', async () => {
    mockGet({ '/admin/meta-leads': list({ leads: [lead({ status: 'dismissed' })] }) })
    const post = mockPost({ '/admin/meta-leads/l1/restore': lead() })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    const tabs = wrapper.get('[aria-label="名單狀態"]').findAll('input')
    await tabs[2]!.setValue(true)
    await flushPromises()
    expect(button(wrapper, '轉成參觀案件')).toBeDefined()
    expect(button(wrapper, '略過')).toBeUndefined()
    await button(wrapper, '放回')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/meta-leads/l1/restore')
  })

  it('已轉案件：個資已清，只顯示連到案件頁的說明', async () => {
    mockGet({
      '/admin/meta-leads': list({
        leads: [lead({ status: 'converted', parent_name: null, phone: null, answers: [], visit_request_id: 'v1', handled_at: '2026-11-26T03:00:00Z' })],
      }),
    })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    const tabs = wrapper.get('[aria-label="名單狀態"]').findAll('input')
    await tabs[1]!.setValue(true)
    await flushPromises()
    expect(wrapper.text()).toContain('家長資料已移到案件')
    expect(wrapper.get('a[href="/visit-requests/v1"]').text()).toBe('到案件頁')
    expect(wrapper.find('a[href^="tel:"]').exists()).toBe(false)
    expect(button(wrapper, '略過')).toBeUndefined()
  })

  it('還沒接上：說明請總管理者設定，不顯示同步鈕', async () => {
    mockGet({ '/admin/meta-leads': list({ configured: false, sync: null, leads: [] }) })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    expect(wrapper.text()).toContain('還沒接上 Meta 名單型廣告，請總管理者設定')
    expect(button(wrapper, '立即同步')).toBeUndefined()
  })

  it('同步失敗：警示顯示原因與權限提示，不當成沒事', async () => {
    mockGet({
      '/admin/meta-leads': list({
        sync: { last_attempt_at: '2026-11-26T01:00:00Z', last_success_at: null, last_error: '讀取名單（HTTP 403、code 200）', last_count: null },
      }),
    })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    expect(wrapper.text()).toContain('最近一次同步失敗')
    expect(wrapper.text()).toContain('讀取名單（HTTP 403、code 200）')
    expect(wrapper.text()).toContain('leads_retrieval')
    expect(wrapper.text()).toContain('還沒同步成功過')
  })

  it('立即同步：用回應取代清單；回應帶 last_error 時提示警告', async () => {
    mockGet({ '/admin/meta-leads': list() })
    const post = mockPost({
      '/admin/meta-leads/sync': list({
        sync: { last_attempt_at: '2026-11-26T04:00:00Z', last_success_at: null, last_error: '讀取名單（HTTP 403、code 200）', last_count: null },
      }),
    })
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    await button(wrapper, '立即同步')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/meta-leads/sync', { campus_key: 'yihua' })
    expect(notifyWarning).toHaveBeenCalledWith('同步失敗：讀取名單（HTTP 403、code 200）')
  })

  it('轉成參觀案件：開補登對話框並帶入名單，建立後重新讀這一頁', async () => {
    const get = mockGet({
      '/admin/meta-leads': list(),
      '/admin/slots': [{ id: 'slot-1', campus_key: 'yihua', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false }],
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'v1', status: 'confirmed', slot: { slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' } } as never)
    const { wrapper } = await mountWith(MetaLeadsView, { path: '/meta-leads' })
    await button(wrapper, '轉成參觀案件')!.trigger('click')
    await flushPromises()
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="例如：王媽媽"]')!.value).toBe('王媽媽')
    wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '選擇場次')!.vm.$emit('update:modelValue', 'slot-1')
    await flushPromises()
    get.mockClear()
    ;[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '補登案件')!.click()
    await flushPromises()
    expect(post.mock.calls[0]![1]).toMatchObject({ meta_lead_id: 'l1', campus_key: 'yihua' })
    expect(get).toHaveBeenCalledWith('/admin/meta-leads?campus_key=yihua&status=new')
  })

  it('側欄「參觀預約」群組有廣告名單，三種有權限的角色看得到', () => {
    const item = navItem('meta-leads')!
    expect(item.path).toBe('/meta-leads')
    for (const role of ['super_admin', 'campus_admin', 'reception'] as const) {
      expect(canListNavItem(item, testUser(role, { campus_keys: ['yihua'] }), {})).toBe(true)
    }
  })
})
