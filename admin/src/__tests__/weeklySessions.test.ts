import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import WeeklySessionsCard from '../components/sessions/WeeklySessionsCard.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); document.body.innerHTML = '' })

async function mountCard(props: { canManage: boolean; canConfigureBooking: boolean }) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('campus_admin', { campus_keys: ['yihua'] })
  const wrapper = mount(WeeklySessionsCard, { props: { campusKey: 'yihua', ...props }, global: { plugins: [pinia, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const buttonByText = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text() === text)!

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
