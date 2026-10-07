// 2026-10-06 方向 D（Task 12 fix round 1）：右側預覽要跟著「最後一次載入完成的校區」，不是校區選單。
// 表單有未存修改時換校，useCampusContent 會先問「放棄修改？」：這段時間選單已經是下一校、
// 表單還是上一校的內容，load() 還沒跑。預覽用選單的值就會把上一校的草稿標成下一校送出。
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

function faqItem(campus: string, title: string) {
  return {
    id: `i-${campus}`, kind: 'campus_faq', campus_key: campus, latest_version: 1, current_published_revision_id: null,
    latest_revision: { id: `r-${campus}`, version: 1, created_at: '2026-10-06T02:00:00Z', payload: { title, note: '' }, review_status: 'draft', review_note: null },
  }
}

interface Deferred { resolve: (value: unknown) => void; reject: (reason: unknown) => void }

// 各校的內容 GET 由測試決定何時回；其他請求（排程、版本）回空。
function mockCampusApi() {
  const pending = new Map<string, Deferred[]>()
  vi.spyOn(api, 'get').mockImplementation(((path: string) => {
    if (path.includes('/schedules') || path.includes('/revisions')) return Promise.resolve([])
    const campus = /campus_key=(\w+)/.exec(path)?.[1] ?? ''
    return new Promise<unknown>((resolve, reject) => {
      pending.set(campus, [...(pending.get(campus) ?? []), { resolve, reject }])
    })
  }) as typeof api.get)
  return {
    answer: async (campus: string, title: string, index = 0) => { pending.get(campus)![index]!.resolve(faqItem(campus, title)); await flushPromises() },
    fail: async (campus: string, index = 0) => { pending.get(campus)![index]!.reject(new ApiError(500, '讀取失敗')); await flushPromises() },
    count: (campus: string) => pending.get(campus)?.length ?? 0,
  }
}

function mountFaq(campus: Ref<string>): () => Editor {
  let editor!: Editor
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const wrapper = mount(defineComponent({
    setup() {
      editor = useContentItem<Faq>('campus_faq', { title: '', note: '' }, campus)
      return () => h('div')
    },
  }), { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  return () => editor
}

describe('useContentItem.loadedCampusKey', () => {
  it('載入完成才記；校區選單先換、load 還沒跑（確認框開著）時還是上一校', async () => {
    const campus = ref('yihua')
    const server = mockCampusApi()
    const editor = mountFaq(campus)
    expect(editor().loadedCampusKey.value).toBeNull()
    void editor().load()
    expect(editor().loadedCampusKey.value).toBeNull()
    await server.answer('yihua', '義華')
    expect(editor().loadedCampusKey.value).toBe('yihua')
    // 選單已經是下一校，但還沒載入：預覽要繼續跟著義華
    campus.value = 'minghua'
    await flushPromises()
    expect(editor().campusKey.value).toBe('minghua')
    expect(editor().loadedCampusKey.value).toBe('yihua')
    expect((editor().form.value as Faq).title).toBe('義華')
    // 載入開始、還沒回來：還是上一校；回來才換
    void editor().load()
    await flushPromises()
    expect(editor().loadedCampusKey.value).toBe('yihua')
    await server.answer('minghua', '明華')
    expect(editor().loadedCampusKey.value).toBe('minghua')
    expect((editor().form.value as Faq).title).toBe('明華')
  })

  it('載入失敗不記；被新的載入取代的舊回應不記', async () => {
    const campus = ref('yihua')
    const server = mockCampusApi()
    const editor = mountFaq(campus)
    void editor().load()
    await server.answer('yihua', '義華')
    campus.value = 'minghua'
    void editor().load()
    await server.fail('minghua')
    expect(editor().loadedCampusKey.value).toBe('yihua')
    // 明華先送出又被崇德取代：明華的回應晚到也不能記成明華
    void editor().load()
    campus.value = 'chongde'
    void editor().load()
    await flushPromises()
    await server.answer('chongde', '崇德')
    expect(editor().loadedCampusKey.value).toBe('chongde')
    await server.answer('minghua', '明華', 1)
    expect(editor().loadedCampusKey.value).toBe('chongde')
    expect((editor().form.value as Faq).title).toBe('崇德')
  })

  it('記的是送出請求當下的校區：載入途中選單被換掉，回來的還是那一校的內容', async () => {
    const campus = ref('yihua')
    const server = mockCampusApi()
    const editor = mountFaq(campus)
    void editor().load()
    campus.value = 'minghua'
    await server.answer('yihua', '義華')
    expect(editor().loadedCampusKey.value).toBe('yihua')
  })

  it('共用內容（沒有校區）一直是 null', async () => {
    vi.spyOn(api, 'get').mockImplementation((() => Promise.resolve({
      id: 'i1', kind: 'site_footer', campus_key: null, latest_version: 1, current_published_revision_id: null,
      latest_revision: { id: 'r1', version: 1, created_at: '2026-10-06T02:00:00Z', payload: { tagline: '標語' }, review_status: 'draft', review_note: null },
    })) as typeof api.get)
    let editor!: ReturnType<typeof useContentItem<{ tagline: string }>>
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    wrappers.push(mount(defineComponent({
      setup() {
        editor = useContentItem('site_footer', { tagline: '' })
        return () => h('div')
      },
    }), { global: { plugins: [pinia] } }))
    await editor.load()
    expect(editor.loadedCampusKey.value).toBeNull()
    expect(editor.latestRevisionId.value).toBe('r1')
  })
})
