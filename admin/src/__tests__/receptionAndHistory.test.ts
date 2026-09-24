import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import RevisionHistoryDrawer from '../components/RevisionHistoryDrawer.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { api } from '../api/client'
import { staffLabel, visitSourceLabel } from '../api/labels'
import { NAV_GROUPS } from '../router/nav'
import type { RevisionHistoryHandle } from '../composables/useContentItem'
import { resetVisitStaff } from '../composables/useVisitStaff'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetVisitStaff()
  document.body.innerHTML = ''
})

function confirmYes() {
  return vi
    .spyOn(ElMessageBox, 'confirm')
    .mockReturnValue(Promise.resolve({ value: '', action: 'confirm' }) as unknown as ReturnType<typeof ElMessageBox.confirm>)
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found as HTMLButtonElement
}

describe('標籤與側欄', () => {
  it('接待月曆排在參觀案件後面', () => {
    const visits = NAV_GROUPS.find((g) => g.key === 'visits')!
    const names = visits.items.map((i) => i.name)
    expect(names.indexOf('visit-calendar')).toBe(names.indexOf('visit-requests') + 1)
  })

  it('承辦人顯示 email 帳號名，未指派與已移除分開講', () => {
    const staff = [{ id: 'u1', email: 'amy@ivy.example' }]
    expect(staffLabel('u1', staff)).toBe('amy')
    expect(staffLabel(null, staff)).toBe('未指派')
    expect(staffLabel('gone', staff)).toBe('已移除的帳號')
  })

  it('來源標籤', () => {
    expect(visitSourceLabel('walk_in')).toBe('親自到園')
    expect(visitSourceLabel(undefined)).toBe('官網表單')
  })
})

describe('版本紀錄抽屜', () => {
  function history(overrides: Partial<RevisionHistoryHandle> = {}): RevisionHistoryHandle {
    return {
      list: vi.fn(async () => [
        { id: 'r2', version: 2, created_at: '2026-09-24T02:00:00Z', created_by_email: 'amy@ivy.example', is_published: true },
        { id: 'r1', version: 1, created_at: '2026-09-23T02:00:00Z', created_by_email: null, is_published: false },
      ]),
      payloadOf: vi.fn(async () => ({ title: '舊標題', body_text: '同樣' })),
      savedPayload: () => ({ title: '新標題', body_text: '同樣' }),
      restore: vi.fn(async () => true),
      ...overrides,
    }
  }

  async function mountDrawer(handle: RevisionHistoryHandle, dirty = false) {
    const wrapper = mount(RevisionHistoryDrawer, {
      props: { history: handle, dirty, busy: false, modelValue: false },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  it('列出版本、標出官網目前版本，選舊版顯示會改變的欄位', async () => {
    const handle = history()
    await mountDrawer(handle)
    const text = document.body.textContent ?? ''
    expect(text).toContain('第 2 版・amy@ivy.example')
    expect(text).toContain('官網目前版本')
    expect(text).toContain('系統匯入或已刪除的帳號')

    ;[...document.body.querySelectorAll('.history__item')][1]!.dispatchEvent(new Event('click'))
    await flushPromises()
    expect(handle.payloadOf).toHaveBeenCalledWith('r1')
    expect(document.body.textContent).toContain('還原後會改變 1 個欄位')
    expect(document.body.textContent).toContain('舊標題')
  })

  it('確認後依選擇還原成草稿或直接發布', async () => {
    const confirm = confirmYes()
    const handle = history()
    await mountDrawer(handle, true)
    ;[...document.body.querySelectorAll('.history__item')][1]!.dispatchEvent(new Event('click'))
    await flushPromises()

    buttonByText('還原並發布').click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    // 表單有未儲存修改時要講清楚會被捨棄。
    expect(String(confirm.mock.calls[0]![0])).toContain('還沒儲存的修改會被捨棄')
    expect(handle.restore).toHaveBeenCalledWith('r1', true)
  })
})

describe('補登案件對話框', () => {
  async function mountDialog() {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const wrapper = mount(ManualVisitDialog, {
      props: { campusKeys: ['yihua'], modelValue: false },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  function fill(placeholder: string, value: string) {
    const input = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
    input.value = value
    input.dispatchEvent(new Event('input'))
  }

  it('沒勾同意前不能送出；送出時帶 Idempotency-Key 並正規化手機', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'new-case', status: 'new', slot: null } as never)
    const wrapper = await mountDialog()
    fill('例如：王媽媽', '王媽媽')
    fill('0912345678', '0912-345-678')
    await nextTick()
    expect(buttonByText('補登案件').disabled).toBe(true)

    const consent = document.body.querySelector<HTMLInputElement>('.manual__consent input')!
    consent.click()
    await nextTick()
    buttonByText('補登案件').click()
    await flushPromises()

    expect(post).toHaveBeenCalledOnce()
    const [path, body, options] = post.mock.calls[0]!
    expect(path).toBe('/admin/visit-requests')
    expect(body).toMatchObject({ campus_key: 'yihua', source: 'phone', parent_name: '王媽媽', phone: '0912345678', consent_given: true, slot_id: null })
    expect(options?.headers?.['Idempotency-Key']).toBeTruthy()
    expect(wrapper.emitted('created')?.[0]?.[0]).toMatchObject({ id: 'new-case' })
  })
})

describe('接待月曆', () => {
  it('把時段裡的家長排進對應日期，點日期列出當天名單', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/visit-calendar')) {
        return [
          {
            id: 's1', campus_key: 'yihua', slot_date: today, start_time: '10:00:00', end_time: '10:30:00',
            capacity: 3, closed: false, booked_count: 1,
            visits: [{ id: 'v1', status: 'confirmed', parent_name: '林爸爸', child_name: null, phone: '0911222333', source: 'phone', assigned_staff_id: null }],
          },
        ] as never
      }
      return [] as never
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/visit-calendar')
    await router.isReady()
    const wrapper = mount(VisitCalendarView, { global: { plugins: [createPinia(), router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()

    const calendarCall = get.mock.calls.find(([p]) => String(p).startsWith('/admin/visit-calendar'))
    expect(calendarCall).toBeTruthy()
    const todayCell = wrapper.find('.calendar__day.is-today')
    expect(todayCell.text()).toContain('10:00')
    expect(todayCell.text()).toContain('林爸爸')
    expect(todayCell.text()).toContain('可約 2 位')

    // 今天預設就是選取的日期，下方列出名單與電話補登來源。
    const detail = wrapper.find('.calendar__detail')
    expect(detail.text()).toContain('已排 1／3 位')
    expect(detail.find('a[href="/visit-requests/v1"]').exists()).toBe(true)
    expect(detail.text()).toContain('電話補登')
  })
})
