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

interface CampusDoc { title: string; note: string }
type Editor = ReturnType<typeof useContentItem<CampusDoc>>

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function campusItem(overrides: Record<string, unknown> = {}, revision: Record<string, unknown> = {}) {
  return {
    id: 'i1', kind: 'campus_news', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1',
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

function mountCampus(campus: Ref<string> = ref('yihua')): () => Editor {
  let editor!: Editor
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const wrapper = mount(defineComponent({
    setup() {
      editor = useContentItem<CampusDoc>('campus_news', { title: '', note: '' }, campus)
      void editor.load()
      return () => h('div')
    },
  }), { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  return () => editor
}

describe('動作列與目錄的比對基準（官網那一版）', () => {
  it('官網就是最新一版：不另外讀，改一欄就列一欄', async () => {
    const get = mockApi(() => campusItem({ current_published_revision_id: 'r2' }))
    const editor = mountCampus()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('live')
    expect(editor().draftChanges.value).toEqual([])
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value.map((c) => c.key)).toEqual(['note'])
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('草稿還沒發布：載入時讀一次官網那一版，沒動表單也列出草稿和官網不同的欄位；發布前比對不再重讀', async () => {
    const get = mockApi(() => campusItem(), { r1: { title: '舊標題' } })
    const editor = mountCampus()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_news/revisions/r1?campus_key=yihua')
    // 舊版缺 note：先補預設值才比，不會多出一筆「（空白）→（空白）」。
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '舊標題', note: '' } })
    expect(editor().draftChanges.value.map((c) => [c.key, c.before, c.after])).toEqual([['title', '舊標題', '新標題']])
    await editor().compareWithLive()
    expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
  })

  it('從沒發布過：基準是 first，不列差異也不讀版本', async () => {
    const get = mockApi(() => campusItem({ current_published_revision_id: null }))
    const editor = mountCampus()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('first')
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value).toEqual([])
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('讀不到官網版：退回和上次儲存比', async () => {
    mockApi(() => campusItem())
    const editor = mountCampus()
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
      ? campusItem({ campus_key: 'minghua', current_published_revision_id: 'm1' }, { id: 'm1', payload: { title: '明華', note: '' } })
      : campusItem()), { r1: slow })
    const campus = ref('yihua')
    const editor = mountCampus(campus)
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
      ? campusItem({ campus_key: 'minghua', current_published_revision_id: 'm1' }, { id: 'm2', payload: { title: '明華新標題', note: '' } })
      : campusItem()), { r1: slow, m1: { title: '明華舊標題' } })
    const campus = ref('yihua')
    const editor = mountCampus(campus)
    await flushPromises()
    campus.value = 'minghua'
    await flushPromises()
    await editor().load()
    await flushPromises()
    finish({ title: '義華舊標題' })
    await flushPromises()
    const paths = get.mock.calls.map(([path]) => String(path))
    // 義華那一版（r1）只會用義華的校區去讀；明華只讀明華自己的官網版（m1）。
    expect(paths).toContain('/admin/content-items/campus_news/revisions/r1?campus_key=yihua')
    expect(paths).toContain('/admin/content-items/campus_news/revisions/m1?campus_key=minghua')
    expect(paths).not.toContain('/admin/content-items/campus_news/revisions/r1?campus_key=minghua')
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '明華舊標題', note: '' } })
  })

  it('儲存成功後，官網版沒換就一直是 live，不閃回 saved、也不重讀', async () => {
    const get = mockApi(() => campusItem(), { r1: { title: '舊標題' } })
    const post = vi.spyOn(api, 'post').mockResolvedValue(
      campusItem({ latest_version: 3 }, { id: 'r3', version: 3, payload: { title: '再新一點', note: '' } }),
    )
    const editor = mountCampus()
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
    mockApi(() => campusItem(), { r1: slow })
    const editor = mountCampus()
    await flushPromises()
    expect(editor().liveReading.value).toBe(true)
    expect(editor().draftBaseline.value.source).toBe('saved')
    finish({ title: '舊標題' })
    await flushPromises()
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value.source).toBe('live')
  })

  it('讀不到官網版：等 1.5 秒重試一次仍失敗，讀完（失敗）才回 false，基準退回 saved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockApi(() => campusItem())
    const editor = mountCampus()
    await flushPromises()
    // 第一次失敗：等著重試，還算讀取中（動作列不先寫一次「和上次儲存比」的數字）
    expect(editor().liveReading.value).toBe(true)
    expect(editor().draftBaseline.value.source).toBe('saved')
    await vi.advanceTimersByTimeAsync(1500)
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value.source).toBe('saved')
  })

  it('官網就是最新一版、從沒發布過：不用讀，載入後不是讀取中', async () => {
    mockApi(() => campusItem({ current_published_revision_id: 'r2' }))
    const live = mountCampus()
    await flushPromises()
    expect(live().liveReading.value).toBe(false)
    mockApi(() => campusItem({ current_published_revision_id: null }))
    const first = mountCampus()
    await flushPromises()
    expect(first().liveReading.value).toBe(false)
  })

  it('換校時上一校還沒讀完：以這一校為準，不會卡在讀取中', async () => {
    let finish!: (payload: unknown) => void
    const slow = new Promise((resolve) => { finish = resolve })
    mockApi((path) => (path.includes('campus_key=minghua')
      ? campusItem({ campus_key: 'minghua', current_published_revision_id: null }, { id: 'm1' })
      : campusItem()), { r1: slow })
    const campus = ref('yihua')
    const editor = mountCampus(campus)
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

// 官網版讀取失敗（網路抖一下）不立刻退回「和上次儲存比」：等約 1.5 秒自動重試一次，第二次仍失敗才退回。
describe('官網版讀取失敗的自動重試', () => {
  const revisionReads = (get: { mock: { calls: unknown[][] } }, id = 'r1') =>
    get.mock.calls.filter(([path]) => String(path).includes(`/revisions/${id}`)).length

  // 官網那一版（r1）的讀取：前 failures 次失敗，之後讀得到。
  function flaky(failures: number, extra: (path: string) => unknown = () => campusItem()) {
    let reads = 0
    return vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path.includes('/schedules')) return Promise.resolve([])
      if (path.includes('/revisions/r1')) {
        reads += 1
        return reads <= failures ? Promise.reject(new ApiError(502, '暫時連不上')) : Promise.resolve({ payload: { title: '舊標題' } })
      }
      if (path.includes('/revisions')) return Promise.resolve([])
      return Promise.resolve(extra(path))
    }) as typeof api.get)
  }

  it('第一次失敗、1.5 秒後重試成功：等待時仍是讀取中，成功後基準是官網版', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const get = flaky(1)
    const editor = mountCampus()
    await flushPromises()
    expect(revisionReads(get)).toBe(1)
    expect(editor().liveReading.value).toBe(true)
    expect(editor().draftBaseline.value.source).toBe('saved')

    await vi.advanceTimersByTimeAsync(1499)
    expect(revisionReads(get)).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(revisionReads(get)).toBe(2)
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '舊標題', note: '' } })
  })

  it('第二次仍失敗：退回和上次儲存比，不會再重試第三次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const get = flaky(2)
    const editor = mountCampus()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(revisionReads(get)).toBe(2)
    expect(editor().liveReading.value).toBe(false)
    expect(editor().draftBaseline.value.source).toBe('saved')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(revisionReads(get)).toBe(2)
  })

  it('等待重試時換了校區：舊的重試作廢，只採用新校的結果', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const get = flaky(5, (path) => (path.includes('campus_key=minghua')
      ? campusItem({ campus_key: 'minghua', current_published_revision_id: null }, { id: 'm1' })
      : campusItem()))
    const campus = ref('yihua')
    const editor = mountCampus(campus)
    await flushPromises()
    expect(revisionReads(get)).toBe(1)
    campus.value = 'minghua'
    await editor().load()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('first')
    expect(editor().liveReading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    // 義華那一版沒有再被讀、基準也沒被義華的結果改掉
    expect(revisionReads(get)).toBe(1)
    expect(editor().draftBaseline.value.source).toBe('first')
  })

  it('等待重試時元件卸載：不再重試', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const get = flaky(1)
    mountCampus()
    await flushPromises()
    expect(revisionReads(get)).toBe(1)
    wrappers.forEach((w) => w.unmount())
    wrappers.length = 0
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(revisionReads(get)).toBe(1)
  })
})
