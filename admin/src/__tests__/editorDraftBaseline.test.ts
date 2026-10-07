// 2026-10-06 方向 D：動作列「草稿有 N 處修改」與段落目錄打點要一直知道和官網差在哪。
// useContentItem 載入後就備好官網那一版（補過預設值）當基準；從沒發布過、讀不到時各有退路。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import { createPinia } from 'pinia'
import { api, ApiError } from '../api/client'
import { useContentItem } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

interface Faq { title: string; note: string }
type Editor = ReturnType<typeof useContentItem<Faq>>

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

function faqItem(overrides: Record<string, unknown> = {}, revision: Record<string, unknown> = {}) {
  return {
    id: 'i1', kind: 'campus_faq', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1',
    latest_revision: { id: 'r2', version: 2, created_at: '2026-10-06T02:00:00Z', payload: { title: '新標題', note: '' }, review_status: 'draft', review_note: null, ...revision },
    ...overrides,
  }
}

// revisions 的值可以是 Promise（模擬晚到的回應）。
function mockApi(items: (path: string) => unknown, revisions: Record<string, unknown> = {}) {
  return vi.spyOn(api, 'get').mockImplementation(((path: string) => {
    if (path.includes('/schedules')) return Promise.resolve([])
    const revision = path.match(/\/revisions\/([^?]+)/)
    if (revision) {
      const id = revision[1]!
      return id in revisions
        ? Promise.resolve(revisions[id]).then((payload) => ({ payload }))
        : Promise.reject(new ApiError(404, '找不到這一版'))
    }
    if (path.includes('/revisions')) return Promise.resolve([])
    return Promise.resolve(items(path))
  }) as typeof api.get)
}

function mountFaq(campus: Ref<string> = ref('yihua')): () => Editor {
  let editor!: Editor
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const wrapper = mount(defineComponent({
    setup() {
      editor = useContentItem<Faq>('campus_faq', { title: '', note: '' }, campus)
      void editor.load()
      return () => h('div')
    },
  }), { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  return () => editor
}

describe('動作列與目錄的比對基準（官網那一版）', () => {
  it('官網就是最新一版：不另外讀，改一欄就列一欄', async () => {
    const get = mockApi(() => faqItem({ current_published_revision_id: 'r2' }))
    const editor = mountFaq()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('live')
    expect(editor().draftChanges.value).toEqual([])
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value.map((c) => c.key)).toEqual(['note'])
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('草稿還沒發布：載入時讀一次官網那一版，沒動表單也列出草稿和官網不同的欄位；發布前比對不再重讀', async () => {
    const get = mockApi(() => faqItem(), { r1: { title: '舊標題' } })
    const editor = mountFaq()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')
    // 舊版缺 note：先補預設值才比，不會多出一筆「（空白）→（空白）」。
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '舊標題', note: '' } })
    expect(editor().draftChanges.value.map((c) => [c.key, c.before, c.after])).toEqual([['title', '舊標題', '新標題']])
    await editor().compareWithLive()
    expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
  })

  it('從沒發布過：基準是 first，不列差異也不讀版本', async () => {
    const get = mockApi(() => faqItem({ current_published_revision_id: null }))
    const editor = mountFaq()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('first')
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value).toEqual([])
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('讀不到官網版：退回和上次儲存比', async () => {
    mockApi(() => faqItem())
    const editor = mountFaq()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('saved')
    expect(editor().draftChanges.value).toEqual([])
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value.map((c) => c.key)).toEqual(['note'])
  })

  it('換校後，上一校晚到的官網版不會變成這一校的基準', async () => {
    let finish!: (payload: unknown) => void
    const slow = new Promise((resolve) => { finish = resolve })
    mockApi((path) => (path.includes('campus_key=minghua')
      ? faqItem({ campus_key: 'minghua', current_published_revision_id: 'm1' }, { id: 'm1', payload: { title: '明華', note: '' } })
      : faqItem()), { r1: slow })
    const campus = ref('yihua')
    const editor = mountFaq(campus)
    await flushPromises()
    campus.value = 'minghua'
    await editor().load()
    await flushPromises()
    finish({ title: '義華舊標題' })
    await flushPromises()
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '明華', note: '' } })
    expect(editor().campusKey.value).toBe('minghua')
  })
})
