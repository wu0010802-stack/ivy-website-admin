import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { button, cleanup, mockGet, mockPost, pathsTo, queryOf, visit as admissionsVisit } from './admissionsTestKit'
import { api } from '../api/client'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import VisitPreviewPanel from '../components/visit/VisitPreviewPanel.vue'
import { futureSlot, mountRoutes, pastSlot, visitCase } from './visitCaseKit'

const names: Record<string, string> = { r1: '吳先生', r2: '張小姐', r3: '李媽媽' }
const listRow = (id: string, slot = futureSlot) => ({ ...visitCase({ id, parent_name: names[id] ?? id, slot, slot_id: slot.id }), history: undefined })
let rows: unknown[] = []
// 每一筆案件目前在伺服器上的樣子；測試改它，就等於「別處改過、或動作做完」。
let details: Record<string, Record<string, unknown>> = {}

// 1280 以上才有預覽；resizeTo 模擬使用者縮放視窗。
let viewportListeners: Array<(event: { matches: boolean }) => void> = []
function stubViewport(wide: boolean) {
  viewportListeners = []
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query === '(min-width: 1280px)', media: query, onchange: null,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { if (query === '(min-width: 1280px)') viewportListeners.push(listener) },
    removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}
const resizeTo = (wide: boolean) => viewportListeners.forEach((listener) => listener({ matches: wide }))
beforeEach(() => stubViewport(true))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.sessionStorage.clear() })

interface WideOptions {
  slot?: typeof futureSlot
  notes?: unknown[]
  path?: string
  admissions?: boolean
  /** 列表 API 的回應（預設就是 rows）；翻頁的情境用它看 page 參數。 */
  list?: (path: string) => unknown
  extra?: Record<string, unknown>
  /** 蓋在案件上的欄位（例如 status）。 */
  caseExtra?: Record<string, unknown>
}
async function mountWide(ids: string[], options: WideOptions = {}) {
  const slot = options.slot ?? futureSlot
  rows = ids.map((id) => ({ ...listRow(id, slot), ...options.caseExtra }))
  details = Object.fromEntries(ids.map((id) => [id, visitCase({ id, parent_name: names[id] ?? id, slot, slot_id: slot.id, ...options.caseExtra })]))
  const detailRoutes = Object.assign({}, ...ids.map((id) => ({
    [`/admin/visit-requests/${id}`]: () => details[id],
    [`/admin/visit-requests/${id}/contact-notes`]: options.notes ?? [],
  })))
  mockGet({
    '/admin/visit-requests': (path: string) => (options.list ? options.list(path) : rows),
    '/admin/visit-requests/view-counts': { upcoming: ids.length, past_unmarked: 0 },
    ...detailRoutes,
    ...options.extra,
  })
  return mountRoutes(options.path ?? '/visit-requests', { list: VisitRequestsView, detail: VisitDetailView }, { admissions: options.admissions })
}
const rowLink = (wrapper: { findAll: (s: string) => { trigger: (e: string, o?: object) => Promise<void> }[] }, index: number) => wrapper.findAll('a.visit-row__main')[index]!
const previewTitle = (wrapper: { get: (s: string) => { text: () => string } }) => wrapper.get('.visit-preview h2.detail__title').text()
const detailReads = (id: string) => (api.get as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => call[0] === `/admin/visit-requests/${id}`).length

describe('右側預覽（2026-10-06 方向 B）', () => {
  it('點一列在右邊看重點，不換頁；「打開完整案件頁」帶著列表條件', async () => {
    const { wrapper, router } = await mountWide(['r1', 'r2'])
    expect(wrapper.get('.visit-preview-empty').text()).toContain('點一筆')
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests')
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
    expect(wrapper.findAll('.visit-row')[0]!.classes()).toContain('is-selected')
    const open = wrapper.get('.visit-preview__open')
    expect(open.attributes('href')).toContain('/visit-requests/r1')
    expect(decodeURIComponent(open.attributes('href')!)).toContain('view=upcoming')
  })

  it('「下一筆」沿清單往下，最後一筆停用', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await button(wrapper.get('.visit-preview__foot'), '下一筆')!.trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
    expect(button(wrapper.get('.visit-preview__foot'), '下一筆')!.attributes('disabled')).toBeDefined()
  })

  it('⌘／Ctrl／中鍵照常交給瀏覽器開新分頁，不選取', async () => {
    const { wrapper, router } = await mountWide(['r1'])
    // 我們沒擋下的點擊，瀏覽器才會開新分頁；jsdom 不會導覽，在 document 記下結果後自己擋掉。
    const prevented: boolean[] = []
    const record = (event: Event) => { prevented.push(event.defaultPrevented); event.preventDefault() }
    document.addEventListener('click', record)
    try {
      await rowLink(wrapper, 0).trigger('click', { metaKey: true })
      await rowLink(wrapper, 0).trigger('click', { ctrlKey: true })
      await rowLink(wrapper, 0).trigger('click', { button: 1 })
    } finally {
      document.removeEventListener('click', record)
    }
    await flushPromises()
    expect(prevented).toEqual([false, false, false])
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/visit-requests')
  })

  it('1280 以下沒有預覽：點一列照舊進案件明細', async () => {
    stubViewport(false)
    const { wrapper, router } = await mountWide(['r1'])
    expect(wrapper.find('.visit-preview-empty').exists()).toBe(false)
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/r1')
  })

  it('預覽是有名稱的區塊；點列後焦點移進預覽，「下一筆」按到最後一筆時焦點回到預覽、並唸出現在看的是誰', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    expect(wrapper.get('aside.visit-preview-empty').attributes('aria-label')).toBe('案件預覽')
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    const aside = wrapper.get('aside.visit-preview')
    expect(aside.attributes('aria-label')).toBe('案件預覽')
    expect(document.activeElement).toBe(aside.element)
    expect(aside.get('[role="status"]').text()).toBe('正在看 吳先生')
    const next = button(wrapper.get('.visit-preview__foot'), '下一筆')!
    ;(next.element as HTMLElement).focus()
    expect(document.activeElement).toBe(next.element)
    await next.trigger('click')
    await flushPromises()
    expect(aside.get('[role="status"]').text()).toBe('正在看 張小姐')
    expect(document.activeElement).toBe(aside.element)
  })

  it('預覽裡打了一半的聯絡紀錄就換一筆：先問，選「留在這頁」就不換', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await wrapper.get('.visit-preview textarea').setValue('打到一半')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    await rowLink(wrapper, 1).trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
    confirm.mockResolvedValueOnce('confirm' as never)
    await rowLink(wrapper, 1).trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
  })

  it('在預覽裡取消、那筆離開清單：列表重讀，面板留著，下一筆由接手位置的那筆遞補', async () => {
    const { wrapper } = await mountWide(['r1', 'r2', 'r3'])
    mockPost()
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '', action: 'confirm' } as never)
    await rowLink(wrapper, 1).trigger('click')
    await flushPromises()
    rows = rows.filter((row) => (row as { id: string }).id !== 'r2')
    await button(wrapper.get('.visit-preview'), '取消預約')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.visit-row')).toHaveLength(2)
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
    await button(wrapper.get('.visit-preview__foot'), '下一筆')!.trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('李媽媽・小安')
  })

  it('預覽的按鈕一律淺色（實心主鈕只有補登案件）；時間線只列最新 3 筆', async () => {
    const note = (id: string, at: string) => ({ id, note: `紀錄${id}`, created_at: at, created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君' })
    const notes = [note('n1', '2026-10-01T01:00:00Z'), note('n2', '2026-10-02T01:00:00Z'), note('n3', '2026-10-03T01:00:00Z'), note('n4', '2026-10-04T01:00:00Z')]
    const { wrapper } = await mountWide(['r1'], { slot: pastSlot, notes })
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    const preview = wrapper.get('.visit-preview')
    expect(button(preview, '家長到了')!.classes()).toContain('is-plain')
    expect(preview.findAll('.el-button--primary:not(.is-plain):not(.is-link):not(.is-text)')).toHaveLength(0)
    expect(preview.findAll('.timeline__item')).toHaveLength(3)
    expect(preview.get('.case-timeline__more').text()).toBe('還有 1 筆，打開完整案件頁')
  })

  it('預覽裡重新預約建好、紀錄框還有字而選擇留在這頁：說明新案件已建立，列表重讀', async () => {
    const { wrapper, router } = await mountWide(['r1'], { slot: pastSlot })
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await wrapper.get('.visit-preview textarea').setValue('家長說下個月再來')
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const info = vi.spyOn(ElMessage, 'info')
    const listReads = () => pathsTo(api.get as never, '/admin/visit-requests?').length
    const before = listReads()
    wrapper.findComponent(VisitPreviewPanel).findComponent(ManualVisitDialog).vm.$emit('created', visitCase({ id: 'case-new' }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests')
    expect(info).toHaveBeenCalledWith('新案件已建立，記完這筆紀錄後可以到參觀案件列表開啟')
    expect(listReads()).toBeGreaterThan(before)
  })
})

describe('換條件時清掉預覽選取（controller 裁定 10-06）', () => {
  // 列表 API 收到過的 view 參數（頁籤）。
  const viewsRequested = () => pathsTo(api.get as never, '/admin/visit-requests?').map((path) => queryOf(path).get('view'))

  it('換頁籤：右側回到「點一筆」，選取清掉', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
    await wrapper.get('.status-tab[data-group="past"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
    expect(wrapper.find('.visit-preview-empty').exists()).toBe(true)
    expect(viewsRequested()).toContain('past')
  })

  it('翻頁、改篩選、打搜尋（防抖之後）也清掉選取', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'], { path: '/visit-requests?page=2' })
    const select = async () => {
      await rowLink(wrapper, 0).trigger('click')
      await flushPromises()
      expect(wrapper.find('.visit-preview').exists()).toBe(true)
    }
    await select()
    await button(wrapper, '上一頁')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)

    await select()
    const openOnly = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((box) => box.text() === '只看未結案')!
    await openOnly.find('input').setValue(true)
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)

    await select()
    await wrapper.get('.filter-field--search input').setValue('吳')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
  })

  it('預覽裡打了一半的紀錄就換頁籤：先問；選「留在這頁」頁籤退回、清單不重讀，確定放棄才換', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await wrapper.get('.visit-preview textarea').setValue('打到一半')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    await wrapper.get('.status-tab[data-group="past"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
    expect((wrapper.get('.visit-preview textarea').element as HTMLTextAreaElement).value).toBe('打到一半')
    expect(wrapper.get('.status-tab.is-active').text()).toContain('接下來')
    expect(viewsRequested()).not.toContain('past')

    confirm.mockResolvedValueOnce('confirm' as never)
    await wrapper.get('.status-tab[data-group="past"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
    expect(wrapper.get('.status-tab.is-active').text()).toContain('時間已過')
    expect(viewsRequested()).toContain('past')
  })

  it('在預覽裡取消、那一頁剩空而退回第一頁：選取留著，「下一筆」由原位置遞補', async () => {
    const pages: Record<string, unknown[]> = { '2': [listRow('r2')], '1': [listRow('r1'), listRow('r3')] }
    const { wrapper } = await mountWide(['r1', 'r2', 'r3'], { path: '/visit-requests?page=2', list: (path) => pages[queryOf(path).get('page') ?? '1'] })
    mockPost()
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '', action: 'confirm' } as never)
    expect(wrapper.findAll('.visit-row')).toHaveLength(1)
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    pages['2'] = []
    await button(wrapper.get('.visit-preview'), '取消預約')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.visit-row')).toHaveLength(2)
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
    await button(wrapper.get('.visit-preview__foot'), '下一筆')!.trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
  })

  it('網址上的條件變了（瀏覽器上一頁、側欄連結）也清掉選取', async () => {
    const { wrapper, router } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(true)
    await router.push('/visit-requests?group=cancelled')
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
    expect(wrapper.get('.status-tab.is-active').text()).toContain('已取消')
  })

  it('縮到 1280 以下：預覽收起，列不再顯示選取', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.visit-row.is-selected')).toHaveLength(1)
    resizeTo(false)
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
    expect(wrapper.findAll('.visit-row.is-selected')).toHaveLength(0)
    expect(wrapper.findAll('a.visit-row__main[aria-current]')).toHaveLength(0)
  })
})

describe('在列表列上處理正在預覽的那筆：預覽跟著重讀', () => {
  const finish = (id: string) => { details[id] = { ...details[id], status: 'completed', version: 2 } }

  it('列上按「到了」', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'], { slot: pastSlot })
    mockPost({ '/admin/visit-requests/r1/complete': () => { finish('r1'); return {} } })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(button(wrapper.get('.visit-preview'), '家長到了')).toBeDefined()
    await wrapper.get('button[aria-label="標記 吳先生 已到場"]').trigger('click')
    await flushPromises()
    expect(button(wrapper.get('.visit-preview'), '家長到了')).toBeUndefined()
    expect(wrapper.get('.visit-preview').text()).toContain('已到場')
  })

  it('列上按「到了」的是別筆：預覽不必重讀', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'], { slot: pastSlot })
    mockPost({ '/admin/visit-requests/r2/complete': () => { finish('r2'); return {} } })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    const before = detailReads('r1')
    await wrapper.get('button[aria-label="標記 張小姐 已到場"]').trigger('click')
    await flushPromises()
    expect(detailReads('r1')).toBe(before)
  })

  it('批次標記含正在預覽的那筆', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'], { slot: pastSlot, path: '/visit-requests?group=past&status=confirmed' })
    const post = mockPost({
      '/admin/visit-requests/r1/complete': () => { finish('r1'); return {} },
      '/admin/visit-requests/r2/complete': () => { finish('r2'); return {} },
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(button(wrapper.get('.visit-preview'), '家長到了')).toBeDefined()
    const all = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((box) => box.text() === '全選這一頁')!
    await all.find('input').setValue(true)
    await button(wrapper, '2 位標記已到場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(button(wrapper.get('.visit-preview'), '家長到了')).toBeUndefined()
  })

  it('列上「填招生資料」存好之後', async () => {
    const linked = admissionsVisit({ visit_request_id: 'r1', has_visit_request: true })
    const { wrapper } = await mountWide(['r1'], {
      slot: pastSlot,
      admissions: true,
      caseExtra: { status: 'completed', display_status: 'past' },
      extra: { '/admin/admissions/records': [linked], '/admin/admissions/records/v-1/events': [], '/admin/admissions/records/v-1/contact-logs': [] },
    })
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="填招生資料：吳先生"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.findAllComponents(RecordDialog).find((item) => item.props('modelValue') === true)!
    const before = detailReads('r1')
    dialog.vm.$emit('saved', linked)
    await flushPromises()
    expect(detailReads('r1')).toBeGreaterThan(before)
  })
})
