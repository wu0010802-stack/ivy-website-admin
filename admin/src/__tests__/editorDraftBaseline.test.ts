// 2026-10-06 方向 D：動作列「草稿有 N 處修改」與段落目錄打點要一直知道和官網差在哪。
// useContentItem 載入後就備好官網那一版（補過預設值）當基準；從沒發布過、讀不到時各有退路。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, watch, type Ref } from 'vue'
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

  it('換校途中不會拿上一校的官網版 id 搭配新校去讀版本', async () => {
    let finish!: (payload: unknown) => void
    const slow = new Promise((resolve) => { finish = resolve })
    const get = mockApi((path) => (path.includes('campus_key=minghua')
      ? faqItem({ campus_key: 'minghua', current_published_revision_id: 'm1' }, { id: 'm2', payload: { title: '明華新標題', note: '' } })
      : faqItem()), { r1: slow, m1: { title: '明華舊標題' } })
    const campus = ref('yihua')
    const editor = mountFaq(campus)
    await flushPromises()
    campus.value = 'minghua'
    await flushPromises()
    await editor().load()
    await flushPromises()
    finish({ title: '義華舊標題' })
    await flushPromises()
    const paths = get.mock.calls.map(([path]) => String(path))
    // 義華那一版（r1）只會用義華的校區去讀；明華只讀明華自己的官網版（m1）。
    expect(paths).toContain('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')
    expect(paths).toContain('/admin/content-items/campus_faq/revisions/m1?campus_key=minghua')
    expect(paths).not.toContain('/admin/content-items/campus_faq/revisions/r1?campus_key=minghua')
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '明華舊標題', note: '' } })
  })

  it('儲存成功後，官網版沒換就一直是 live，不閃回 saved、也不重讀', async () => {
    const get = mockApi(() => faqItem(), { r1: { title: '舊標題' } })
    const post = vi.spyOn(api, 'post').mockResolvedValue(
      faqItem({ latest_version: 3 }, { id: 'r3', version: 3, payload: { title: '再新一點', note: '' } }),
    )
    const editor = mountFaq()
    await flushPromises()
    const reading: boolean[] = []
    watch(() => editor().liveReading.value, (value) => reading.push(value), { flush: 'sync' })
    editor().form.value.title = '再新一點'
    expect(await editor().save()).toBe(true)
    expect(post).toHaveBeenCalledOnce()
    // 存檔回來、監看還沒跑的這一刻：基準仍然是官網版。
    expect(editor().draftBaseline.value.source).toBe('live')
    expect(editor().liveReading.value).toBe(false)
    await flushPromises()
    // 官網版沒換，不算重新讀取：動作列不會為了存檔閃成中立說明再變回來。
    expect(reading).toEqual([])
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '舊標題', note: '' } })
    expect(editor().draftChanges.value.map((c) => [c.key, c.before, c.after])).toEqual([['title', '舊標題', '再新一點']])
    expect(editor().liveReading.value).toBe(false)
    expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
  })
})

// 讀官網版期間動作列不能寫差異字樣（否則「沒有修改」→「N 處不同」會閃一下）：
// liveReading 只在這一段為 true，讀完、讀不到、不用讀都是 false。
describe('liveReading（正在讀官網那一版）', () => {
  it('讀取中是 true，讀完回 false', async () => {
    let finish!: (payload: unknown) => void
    const slow = new Promise((resolve) => { finish = resolve })
    mockApi(() => faqItem(), { r1: slow })
    const editor = mountFaq()
    await flushPromises()
    expect(editor().liveReading.value).toBe(true)
    expect(editor().draftBaseline.value.source).toBe('saved')
    finish({ title: '舊標題' })
    await flushPromises()
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value.source).toBe('live')
  })

  it('讀不到官網版：讀完（失敗）也回 false，基準退回 saved', async () => {
    mockApi(() => faqItem())
    const editor = mountFaq()
    await flushPromises()
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value.source).toBe('saved')
  })

  it('官網就是最新一版、從沒發布過：不用讀，載入後不是讀取中', async () => {
    mockApi(() => faqItem({ current_published_revision_id: 'r2' }))
    const live = mountFaq()
    await flushPromises()
    expect(live().liveReading.value).toBe(false)
    mockApi(() => faqItem({ current_published_revision_id: null }))
    const first = mountFaq()
    await flushPromises()
    expect(first().liveReading.value).toBe(false)
  })

  it('換校時上一校還沒讀完：以這一校為準，不會卡在讀取中', async () => {
    let finish!: (payload: unknown) => void
    const slow = new Promise((resolve) => { finish = resolve })
    mockApi((path) => (path.includes('campus_key=minghua')
      ? faqItem({ campus_key: 'minghua', current_published_revision_id: null }, { id: 'm1' })
      : faqItem()), { r1: slow })
    const campus = ref('yihua')
    const editor = mountFaq(campus)
    await flushPromises()
    expect(editor().liveReading.value).toBe(true)
    campus.value = 'minghua'
    await editor().load()
    await flushPromises()
    expect(editor().liveReading.value).toBe(false)
    finish({ title: '義華舊標題' })
    await flushPromises()
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value.source).toBe('first')
  })
})
