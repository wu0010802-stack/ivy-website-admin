import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { button, cleanup, mockGet, mockPost, pathsTo } from './admissionsTestKit'
import { api } from '../api/client'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import VisitPreviewPanel from '../components/visit/VisitPreviewPanel.vue'
import { caseRoutes, futureSlot, mountRoutes, pastSlot, visitCase } from './visitCaseKit'

const names: Record<string, string> = { r1: '吳先生', r2: '張小姐', r3: '李媽媽' }
const listRow = (id: string, slot = futureSlot) => ({ ...visitCase({ id, parent_name: names[id], slot, slot_id: slot.id }), history: undefined })
let rows: unknown[] = []

function stubViewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query === '(min-width: 1280px)', media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}
beforeEach(() => stubViewport(true))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.sessionStorage.clear() })

async function mountWide(ids: string[], options: { slot?: typeof futureSlot; notes?: unknown[] } = {}) {
  rows = ids.map((id) => listRow(id, options.slot))
  const detailRoutes = Object.assign({}, ...ids.map((id) => caseRoutes(visitCase({ id, parent_name: names[id], slot: options.slot ?? futureSlot, slot_id: (options.slot ?? futureSlot).id }), options.notes ?? [])))
  mockGet({ '/admin/visit-requests': () => rows, '/admin/visit-requests/view-counts': { upcoming: ids.length, past_unmarked: 0 }, ...detailRoutes })
  return mountRoutes('/visit-requests', { list: VisitRequestsView, detail: VisitDetailView })
}
const rowLink = (wrapper: { findAll: (s: string) => { trigger: (e: string, o?: object) => Promise<void> }[] }, index: number) => wrapper.findAll('a.visit-row__main')[index]!
const previewTitle = (wrapper: { get: (s: string) => { text: () => string } }) => wrapper.get('.visit-preview h2.detail__title').text()

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
