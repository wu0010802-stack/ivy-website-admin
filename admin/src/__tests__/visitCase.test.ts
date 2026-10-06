import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { cleanup, deferred, mockGet, mockPost, mountWith, pathsTo } from './admissionsTestKit'
import { caseRoutes, pastSlot, visitCase } from './visitCaseKit'
import { useVisitCase, type VisitCase, type VisitCaseHooks } from '../composables/useVisitCase'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountCase(initial: string, hooks: VisitCaseHooks = {}) {
  const id = ref(initial)
  let vc!: VisitCase
  const Host = defineComponent({ setup() { vc = useVisitCase(id, hooks); return () => h('p', vc.detail?.parent_name ?? '') } })
  const { wrapper } = await mountWith(Host)
  return { wrapper, id, vc: () => vc }
}

describe('useVisitCase（2026-10-06 從案件明細抽出）', () => {
  it('案件與聯絡紀錄一起讀；讀到後通知 onLoaded', async () => {
    const get = mockGet(caseRoutes(visitCase()))
    const onLoaded = vi.fn()
    const { vc } = await mountCase('case-a', { onLoaded })
    expect(pathsTo(get, '/admin/visit-requests/case-a')).toEqual(
      expect.arrayContaining(['/admin/visit-requests/case-a', '/admin/visit-requests/case-a/contact-notes']),
    )
    expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-a' }))
    expect(vc().loading).toBe(false)
    expect(vc().statusDisplay?.label).toBe('預約正常')
  })

  it('換案件時，上一筆較晚回來的回應不會蓋掉畫面', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/visit-requests/case-a': () => slow.promise,
      '/admin/visit-requests/case-a/contact-notes': [],
      ...caseRoutes(visitCase({ id: 'case-b', parent_name: '王先生' })),
    })
    const { id, vc } = await mountCase('case-a')
    id.value = 'case-b'
    await flushPromises()
    slow.resolve(visitCase())
    await flushPromises()
    expect(vc().detail?.id).toBe('case-b')
  })

  it('標記未到場成功：重讀並通知 onChanged 一次', async () => {
    mockGet(caseRoutes(visitCase({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' })))
    const post = mockPost()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const onChanged = vi.fn()
    const { vc } = await mountCase('case-a', { onChanged })
    await vc().markNoShow()
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/no-show')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
