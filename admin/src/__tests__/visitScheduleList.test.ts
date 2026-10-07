import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitListRow from '../components/visit/VisitListRow.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { ApiError } from '../api/client'
import { button, cleanup, mockGet, mockPost, pathsTo, mountWith, reception, visit as admissionsVisit } from './admissionsTestKit'
import { mountRoutes } from './visitCaseKit'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

function row(slot_date: string, start: string, extra: Record<string, unknown> = {}) {
  const hour = start.slice(0, 2)
  return {
    id: `${slot_date}-${hour}`, campus_key: 'yihua', status: 'confirmed', display_status: 'upcoming', source: 'web',
    parent_name: `家長${slot_date.slice(8)}-${hour}`, child_name: '小安', phone: '0912000001', email: null,
    follow_up_at: null, preferred_time: null, created_at: '2026-10-01T00:00:00Z', cancel_reason: null, cancelled_at: null,
    slot_id: `s-${slot_date}-${hour}`, slot: { slot_date, start_time: `${start}:00`, end_time: `${String(Number(hour) + 1).padStart(2, '0')}:00:00` },
    ...extra,
  }
}
const titles = (wrapper: { findAll: (s: string) => { element: Element }[] }) =>
  wrapper.findAll('.visit-day__title').map((h) => h.element.firstChild?.textContent?.trim())

async function mountList(path: string, rows: unknown[], options: { admissions?: boolean } = {}, extra: Record<string, unknown> = {}) {
  const get = mockGet({ '/admin/visit-requests': rows, '/admin/visit-requests/view-counts': { upcoming: rows.length, past_unmarked: 0 }, ...extra })
  const { wrapper, router } = await mountRoutes(path, { list: VisitRequestsView }, options)
  return { wrapper, router, get }
}

describe('行程清單（2026-10-06 方向 B）', () => {
  it('依參觀日分組：今天置頂、明天、本週、之後；今天的列只寫幾點與狀態', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T02:30:00Z')) // 台北週二 10:30
    const rows = [row('2026-10-06', '10:00'), row('2026-10-06', '14:00'), row('2026-10-07', '10:00'), row('2026-10-09', '14:00'), row('2026-10-13', '10:00')]
    const { wrapper } = await mountList('/visit-requests', rows)
    expect(titles(wrapper)).toEqual(['今天 10/06（週二）', '明天 10/07（週三）', '本週', '之後'])
    const first = wrapper.findAll('.visit-row')[0]!
    expect(first.get('.visit-row__time b').text()).toBe('10:00')
    expect(first.get('.visit-row__state').text()).toBe('進行中')
    expect(first.findAll('.attendance-actions button').map((b) => b.text())).toEqual(['到了', '沒來'])
    const thisWeek = wrapper.findAll('.visit-row')[3]!
    expect(thisWeek.get('.visit-row__time').text()).toContain('10/09（週五）')
    expect(thisWeek.get('.visit-row__time').text()).toContain('14:00–15:00')
    expect(thisWeek.find('.attendance-actions').exists()).toBe(false)
  })

  it('列表開著過台北午夜：重讀一次，「明天」變成「今天」', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-06T15:59:00Z')) // 台北 23:59
    const { wrapper, get } = await mountList('/visit-requests', [row('2026-10-07', '10:00')])
    expect(titles(wrapper)).toEqual(['明天 10/07（週三）'])
    const before = pathsTo(get, '/admin/visit-requests?').length
    vi.setSystemTime(new Date('2026-10-06T16:01:00Z')) // 台北 10/07 00:01
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(pathsTo(get, '/admin/visit-requests?').length).toBe(before + 1)
    expect(titles(wrapper)).toEqual(['今天 10/07（週三）'])
  })

  it('瀏覽器不在台北時區（出差、CI 是 UTC）：分組與狀態照台北日期，不錯一天', async () => {
    const originalTz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      vi.useFakeTimers({ toFake: ['Date'] })
      // 洛杉磯 10/06 09:30、UTC 10/06 16:30，台北已經是 10/07 00:30。
      vi.setSystemTime(new Date('2026-10-06T16:30:00Z'))
      const rows = [row('2026-10-07', '10:00'), row('2026-10-08', '10:00'), row('2026-10-13', '10:00')]
      const { wrapper } = await mountList('/visit-requests', rows)
      expect(titles(wrapper)).toEqual(['今天 10/07（週三）', '明天 10/08（週四）', '之後'])
      // 台北 00:30，場次 10:00 還沒開始：沒有「到了／沒來」。
      expect(wrapper.findAll('.visit-row')[0]!.find('.attendance-actions').exists()).toBe(false)
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it('同一個台北日子裡時鐘跳動不重讀', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-06T02:30:00Z'))
    const { get } = await mountList('/visit-requests', [row('2026-10-07', '10:00')])
    const before = pathsTo(get, '/admin/visit-requests?').length
    vi.advanceTimersByTime(90_000)
    await flushPromises()
    expect(pathsTo(get, '/admin/visit-requests?').length).toBe(before)
  })

  it('已到場的列有「填招生資料」，打開招生資料表單；不是剛標記，所以沒有「已標記…已到場」、取消鈕維持「取消」', async () => {
    const arrived = row('2026-01-05', '10:00', { status: 'completed', display_status: 'past' })
    const record = admissionsVisit({ visit_request_id: arrived.id, has_visit_request: true })
    const { wrapper } = await mountList('/visit-requests?group=arrived', [arrived], { admissions: true }, { '/admin/admissions/records': [record] })
    await button(wrapper.get('.visit-row'), '填招生資料')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(RecordDialog).props('modelValue')).toBe(true)
    const dialog = document.body.querySelector<HTMLElement>('.record-dialog')!
    expect(dialog.textContent).not.toContain('已標記')
    const labels = [...dialog.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).toContain('取消')
    expect(labels).not.toContain('之後再填')
  })

  it('填招生資料打不開時用中性的說法，不說「已標記已到場」', async () => {
    const arrived = row('2026-01-05', '10:00', { status: 'completed', display_status: 'past' })
    const { wrapper } = await mountList('/visit-requests?group=arrived', [arrived], { admissions: true }, {
      '/admin/admissions/records': () => { throw new ApiError(500, { code: 'INTERNAL_ERROR' }) },
    })
    const warning = vi.spyOn(ElMessage, 'warning')
    await button(wrapper.get('.visit-row'), '填招生資料')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(RecordDialog).props('modelValue')).toBe(false)
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: `${arrived.parent_name} 的招生資料表單打不開；請到招生入學查看` }))
  })

  it('填招生資料時還沒有招生訪視（開關打開前到場的舊案）：不是死路，打開案件、說明要按「建立招生訪視」', async () => {
    const arrived = row('2026-01-05', '10:00', { status: 'completed', display_status: 'past' })
    const { wrapper, router } = await mountList('/visit-requests?group=arrived', [arrived], { admissions: true }, { '/admin/admissions/records': [] })
    const warning = vi.spyOn(ElMessage, 'warning')
    await button(wrapper.get('.visit-row'), '填招生資料')!.trigger('click')
    await flushPromises()
    // 列表換成明細頁（元件已卸載），表單沒有打開過。
    expect(document.body.querySelector('.record-dialog')).toBeNull()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: `${arrived.parent_name} 已到場，但還沒有招生訪視；請在案件裡按「建立招生訪視」` }))
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${arrived.id}`)
  })

  it('填招生資料時招生訪視已匿名化：不打開表單、不換頁，說明不能再修改', async () => {
    const arrived = row('2026-01-05', '10:00', { status: 'completed', display_status: 'past' })
    const record = admissionsVisit({ visit_request_id: arrived.id, has_visit_request: true, anonymized_at: '2026-09-01T00:00:00Z' })
    const { wrapper, router } = await mountList('/visit-requests?group=arrived', [arrived], { admissions: true }, { '/admin/admissions/records': [record] })
    const warning = vi.spyOn(ElMessage, 'warning')
    await button(wrapper.get('.visit-row'), '填招生資料')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(RecordDialog).props('modelValue')).toBe(false)
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: `${arrived.parent_name} 的招生資料已依保存政策匿名化，不能再修改` }))
    expect(router.currentRoute.value.path).toBe('/visit-requests')
  })

  it('招生入學沒開、或不能改招生資料：已到場的列沒有「填招生資料」', async () => {
    const arrived = row('2026-01-05', '10:00', { status: 'completed', display_status: 'past' })
    const off = await mountList('/visit-requests?group=arrived', [arrived], { admissions: false })
    expect(button(off.wrapper.get('.visit-row'), '填招生資料')).toBeUndefined()
  })

  it('照送出時間排序時不分組，每列寫送出時間', async () => {
    const { wrapper } = await mountList('/visit-requests?group=all&order=oldest', [row('2026-10-07', '10:00')])
    expect(wrapper.find('.visit-day__title').exists()).toBe(false)
    expect(wrapper.get('.visit-row').text()).toContain('送出')
  })

  it('不是今年的場次寫年份（跨年的列看得出是哪一年），今年省略', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T02:30:00Z'))
    const rows = [row('2025-12-31', '10:00'), row('2026-10-07', '10:00'), row('2027-01-01', '10:00')]
    const { wrapper } = await mountList('/visit-requests?group=all&order=oldest', rows)
    const times = wrapper.findAll('.visit-row__time').map((t) => t.text())
    expect(times[0]).toContain('2025/12/31（週三）')
    expect(times[1]).toContain('10/07（週三）')
    expect(times[1]).not.toContain('2026/')
    expect(times[2]).toContain('2027/01/01（週五）')
  })

  it('只看尚未確認到場：每列有勾選框，全選這一頁後一次標記', async () => {
    const rows = [row('2026-01-05', '10:00', { display_status: 'past' }), row('2026-01-05', '14:00', { display_status: 'past' })]
    const { wrapper } = await mountList('/visit-requests?group=past&status=confirmed', rows)
    expect(wrapper.findAll('.visit-row .visit-row__check .el-checkbox')).toHaveLength(2)
    await wrapper.get('.requests-batch .el-checkbox').trigger('click')
    await flushPromises()
    expect(button(wrapper.get('.requests-batch'), '2 位標記已到場')).toBeDefined()
  })

  it('1280 以下點列進明細（帶著列表條件）', async () => {
    const { wrapper, router } = await mountList('/visit-requests', [row('2099-10-07', '10:00')])
    await wrapper.get('a.visit-row__main').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/2099-10-07-10')
    expect(String(router.currentRoute.value.query.list)).toContain('view=upcoming')
  })

  // 明細的「下一筆」與返回連結照這份條件走（Task 7 detailTo）：列要把頁籤、排序一起帶過去。
  describe('點進明細帶的列表條件（list=）', () => {
    async function listParamsAfterOpening(path: string) {
      const { wrapper, router } = await mountList(path, [row('2026-01-05', '10:00', { display_status: 'past' })])
      await wrapper.get('a.visit-row__main').trigger('click')
      await flushPromises()
      return new URLSearchParams(String(router.currentRoute.value.query.list))
    }
    it('預設的「接下來」：view=upcoming、參觀時間由近到遠', async () => {
      const params = await listParamsAfterOpening('/visit-requests')
      expect(params.get('view')).toBe('upcoming')
      expect(params.get('order')).toBe('visit_asc')
    })
    it('「全部」加到期待追蹤：不帶 view，由近往回', async () => {
      const params = await listParamsAfterOpening('/visit-requests?group=all&due=1')
      expect(params.get('view')).toBeNull()
      expect(params.get('follow_up_due')).toBe('true')
      expect(params.get('order')).toBe('visit_desc')
    })
    it('時間已過加只看尚未確認到場：status=confirmed、由近往回', async () => {
      const params = await listParamsAfterOpening('/visit-requests?group=past&status=confirmed')
      expect(params.get('view')).toBe('past')
      expect(params.get('status')).toBe('confirmed')
      expect(params.get('order')).toBe('visit_desc')
    })
  })

  describe('列內動作不會被當成點列', () => {
    it('到了／沒來、電話、勾選框（含它的空白處）都不進明細', async () => {
      const rows = [row('2026-01-05', '10:00', { display_status: 'past' })]
      const { wrapper, router } = await mountList('/visit-requests?group=past&status=confirmed', rows)
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
      mockPost()
      // tel: 連結在 jsdom 會試著導覽（沒實作、只印錯誤）：擋掉預設動作，只看有沒有換頁。
      const noDefault = (event: Event) => event.preventDefault()
      document.addEventListener('click', noDefault)
      await button(wrapper.get('.visit-row'), '到了')!.trigger('click')
      await wrapper.get('a.visit-row__phone').trigger('click')
      await wrapper.get('.visit-row__check').trigger('click')
      await wrapper.get('.visit-row__check .el-checkbox').trigger('click')
      await flushPromises()
      document.removeEventListener('click', noDefault)
      expect(router.currentRoute.value.path).toBe('/visit-requests')
    })
    it('點列的空白處等同點家長名字', async () => {
      const { wrapper, router } = await mountList('/visit-requests', [row('2099-10-07', '10:00')])
      await wrapper.get('.visit-row__acts').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/visit-requests/2099-10-07-10')
    })
  })

  it('每一列的主連結是真的連結（鍵盤可 Tab、Enter 開啟），標了參觀時間的接待狀態', async () => {
    const { wrapper } = await mountList('/visit-requests', [row('2099-10-07', '10:00')])
    const link = wrapper.get('a.visit-row__main')
    expect(link.attributes('href')).toContain('/visit-requests/2099-10-07-10')
    expect(wrapper.get('li.visit-row').attributes('data-phase')).toBe('upcoming')
  })

  it('沒有案件時說明目前的頁籤，不顯示載入骨架', async () => {
    const { wrapper } = await mountList('/visit-requests', [])
    expect(wrapper.find('.visit-list__skeleton').exists()).toBe(false)
    expect(wrapper.get('.requests-empty').text()).toContain('接下來沒有參觀')
  })
})

// 列元件自己的點擊規則（預覽面板會把 previewable 打開，Task 9）。
describe('VisitListRow 的點擊', () => {
  const base = row('2099-10-07', '10:00') as never
  async function mountRow(props: Record<string, unknown> = {}) {
    const { wrapper } = await mountWith(VisitListRow, {
      user: reception(),
      props: {
        row: base, now: Date.parse('2026-10-06T10:00:00+08:00'), to: '/visit-requests/x', dayOnly: false, showCreated: false, multiCampus: false,
        selected: false, previewable: false, canHandle: true, canFillAdmissions: false, batch: false, checked: false, busy: false, locked: false, ...props,
      },
    })
    return wrapper
  }

  it('可預覽時：沒按修飾鍵的左鍵點家長名字開預覽（不換頁）；按 Ctrl 照常走連結', async () => {
    const wrapper = await mountRow({ previewable: true })
    await wrapper.get('a.visit-row__main').trigger('click')
    expect(wrapper.emitted('activate')).toHaveLength(1)
    // 按著 Ctrl 的點擊交給瀏覽器開新分頁；jsdom 會試著導覽（沒實作、只印錯誤），擋掉預設動作只看有沒有開預覽。
    const noDefault = (event: Event) => event.preventDefault()
    document.addEventListener('click', noDefault)
    await wrapper.get('a.visit-row__main').trigger('click', { ctrlKey: true })
    document.removeEventListener('click', noDefault)
    expect(wrapper.emitted('activate')).toHaveLength(1)
  })

  it('勾選框所在的格子點空白、點勾選框本身都不開啟（P4）', async () => {
    const wrapper = await mountRow({
      batch: true,
      row: row('2026-01-05', '10:00', { display_status: 'past' }) as never,
      now: Date.parse('2026-10-06T10:00:00+08:00'),
    })
    await wrapper.get('.visit-row__check').trigger('click')
    await wrapper.get('.visit-row__check .el-checkbox').trigger('click')
    expect(wrapper.emitted('activate')).toBeUndefined()
  })

  it('勾選框的名稱帶家長；勾選回報 toggle', async () => {
    const wrapper = await mountRow({
      batch: true,
      row: row('2026-01-05', '10:00', { display_status: 'past' }) as never,
      now: Date.parse('2026-10-06T10:00:00+08:00'),
    })
    const box = wrapper.get('.el-checkbox input')
    expect(wrapper.get('.el-checkbox').attributes('aria-label') ?? box.attributes('aria-label')).toBe('勾選 家長05-10')
    await box.setValue(true)
    expect(wrapper.emitted('toggle')![0]).toEqual([true])
  })
})
