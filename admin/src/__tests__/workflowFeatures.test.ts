import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import CampusFaqView from '../views/CampusFaqView.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { contentPreviewPath } from '../api/labels'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

type Role = 'super_admin' | 'campus_admin' | 'editor' | 'reception' | 'readonly'

async function mountWith(component: unknown, role: Role, props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'me', email: 'me@example.invalid', role, is_active: true, campus_keys: ['yihua'] }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/'); await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, { props, global: { plugins: [pinia, router, ElementPlus] } } as never)
  wrappers.push(wrapper); await flushPromises()
  return wrapper
}

const faqItem = (review_status: string, review_note: string | null = null) => ({
  id: 'item', kind: 'campus_faq', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'rev-1',
  latest_revision: { id: 'rev-2', version: 2, created_at: '2026-09-24T01:00:00Z', payload: { items: [{ q: '問', a: '答' }] }, review_status, review_note },
})

function mockContent(item: unknown) {
  return vi.spyOn(api, 'get').mockImplementation(async path => {
    if (String(path).includes('/schedules')) return [] as never
    return item as never
  })
}

function buttonTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('button').map(b => b.text())
}

describe('內容送審與審核', () => {
  it('內容編輯看不到發布，只能送審', async () => {
    mockContent(faqItem('draft'))
    const post = vi.spyOn(api, 'post').mockResolvedValue(faqItem('pending_review'))
    const wrapper = await mountWith(CampusFaqView, 'editor')
    expect(buttonTexts(wrapper)).not.toContain('發布到官網')
    await wrapper.findAll('button').find(b => b.text() === '送審')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/content-items/campus_faq/submit?campus_key=yihua', { revision_id: 'rev-2' })
  })

  it('被退回時顯示原因', async () => {
    mockContent(faqItem('rejected', '答案請寫電話'))
    const wrapper = await mountWith(CampusFaqView, 'editor')
    expect(wrapper.text()).toContain('被退回')
    expect(wrapper.text()).toContain('答案請寫電話')
  })

  it('校區管理者看到待審核的版本時可以核准或退回', async () => {
    mockContent(faqItem('pending_review'))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue({ value: '', action: 'confirm' } as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue(faqItem('approved'))
    const wrapper = await mountWith(CampusFaqView, 'campus_admin')
    expect(buttonTexts(wrapper)).toEqual(expect.arrayContaining(['退回', '核准並發布']))
    await wrapper.findAll('button').find(b => b.text() === '核准並發布')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/content-items/campus_faq/review?campus_key=yihua', { revision_id: 'rev-2', decision: 'approve', note: null })
  })

  it('可以直接發布的角色看得到排程發布與版本紀錄', async () => {
    mockContent(faqItem('draft'))
    const wrapper = await mountWith(CampusFaqView, 'campus_admin')
    expect(buttonTexts(wrapper)).toEqual(expect.arrayContaining(['排程發布', '發布到官網', '版本紀錄']))
  })
})

describe('草稿預覽網址', () => {
  it('分校內容預覽分校頁，預約文案沒有預覽', () => {
    expect(contentPreviewPath('campus_faq', 'renwu')).toBe('/preview?page=campus&campus=renwu')
    expect(contentPreviewPath('admission_content')).toBe('/preview?page=admission')
    expect(contentPreviewPath('home_hero')).toBe('/preview')
    expect(contentPreviewPath('booking_content')).toBe('')
  })
})

describe('接待日曆', () => {
  it('把已排時段的參觀放進對應日期', async () => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const get = vi.spyOn(api, 'get').mockResolvedValue([
      { id: 'v1', campus_key: 'yihua', status: 'confirmed', parent_name: '林爸爸', slot: { id: 's', slot_date: iso, start_time: '10:00:00', end_time: '10:30:00' } },
    ] as never)
    const wrapper = await mountWith(VisitCalendarView, 'reception')
    expect(String(get.mock.calls[0]![0])).toMatch(/^\/admin\/visit-calendar\?date_from=/)
    expect(wrapper.find('.cal__visit').text()).toContain('林爸爸')
    expect(wrapper.find('.cal__visit').text()).toContain('10:00')
  })
})

describe('每週開放規則', () => {
  it('新增規則後儲存會整份送出，並算出每天幾場', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [] } as never)
    const put = vi.spyOn(api, 'put').mockImplementation(async (_path, body) => ({ campus_key: 'yihua', exceptions: [], ...(body as object) }) as never)
    const wrapper = await mountWith(VisitSchedulePanel, 'campus_admin', { campusKey: 'yihua', canManage: true })
    await wrapper.findAll('button').find(b => b.text() === '新增規則')!.trigger('click')
    expect(wrapper.text()).toContain('共 3 場')
    await wrapper.findAll('button').find(b => b.text() === '儲存規則')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/visit-schedule/yihua', {
      min_lead_hours: 24,
      max_advance_days: 60,
      rules: [{ weekday: 2, start_time: '09:30:00', end_time: '11:00:00', slot_minutes: 30, capacity: 1 }],
    })
  })
})
