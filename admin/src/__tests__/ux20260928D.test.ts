// 2026-09-28 內容編輯外殼 UX 修正：狀態點依狀態上色、發布與核准列出和官網的
// 差異、動作列主色給真正的下一步、兩段動作只跳一則 toast、放棄修改要確認、
// 校區留在網址、排程說明、版本紀錄主次，以及發布紀錄的手機還原鈕與初始化標籤。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref, type VNode } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, isNavigationFailure, matchedRouteKey, NavigationFailureType } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import CampusSelect from '../components/CampusSelect.vue'
import RevisionHistoryDrawer from '../components/RevisionHistoryDrawer.vue'
import PublishHistoryView from '../views/PublishHistoryView.vue'
import editorSource from '../components/ContentEditor.vue?raw'
import publishHistorySource from '../views/PublishHistoryView.vue?raw'
import { api, ApiError } from '../api/client'
import { contentFieldLabelFor } from '../api/contentFieldLabels'
import { releaseSourceLabel } from '../api/labels'
import { useContentItem, type ContentEditorState, type FieldChange, type PublishJob, type RevisionHistoryHandle } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  sessionStorage.clear()
  document.body.innerHTML = ''
})

async function setup(path = '/content/campus-faq', user: UserOut = testUser('super_admin')) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  return { router, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } }
}

type Global = Awaited<ReturnType<typeof setup>>['global']

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((b) => b.text().trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found
}

function bodyButton(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found as HTMLButtonElement
}

// 確認框的內容是 VNode：掛起來讀文字。
function messageText(message: unknown): string {
  if (typeof message === 'string') return message
  const wrapper = mount(defineComponent({ render: () => message as VNode }))
  const text = wrapper.text()
  wrapper.unmount()
  return text
}

function confirmYes() {
  return vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
}

function editorState(overrides: Partial<ContentEditorState> = {}): ContentEditorState {
  return {
    loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
    isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-09-25T02:00:00Z'),
    load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
    ...overrides,
  }
}

function mountShell(global: Global, editor: ContentEditorState) {
  const wrapper = mount(ContentEditor, { props: { editor }, global, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

// ---------------------------------------------------------------------------
// 真的 useContentItem＋ContentEditor（API 用 mock）
// ---------------------------------------------------------------------------

interface Faq { title: string; note: string }

function faqItem(overrides: Record<string, unknown> = {}, revision: Record<string, unknown> = {}) {
  return {
    id: 'i1', kind: 'campus_faq', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1',
    latest_revision: { id: 'r2', version: 2, created_at: '2026-09-25T02:00:00Z', payload: { title: '新標題', note: '' }, review_status: 'draft', review_note: null, ...revision },
    ...overrides,
  }
}

function mockContentApi(item: unknown, revisions: Record<string, unknown> = {}, schedules: unknown[] = []) {
  return vi.spyOn(api, 'get').mockImplementation(((path: string) => {
    if (path.includes('/schedules')) return Promise.resolve(schedules)
    const revision = path.match(/\/revisions\/([^?]+)/)
    if (revision) {
      const id = revision[1]!
      return id in revisions ? Promise.resolve({ payload: revisions[id] }) : Promise.reject(new ApiError(404, '找不到這一版'))
    }
    return Promise.resolve(item)
  }) as typeof api.get)
}

function mountPage(global: Global) {
  let editor!: ReturnType<typeof useContentItem<Faq>>
  const Page = defineComponent({
    setup() {
      editor = useContentItem<Faq>('campus_faq', { title: '', note: '' }, 'yihua')
      void editor.load()
      return () => h(ContentEditor, { editor: editor as unknown as ContentEditorState }, { default: () => h('input', { 'aria-label': '標題' }) })
    },
  })
  const wrapper = mount(Page, { global, attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, editor: () => editor }
}

const scheduledJob = (overrides: Partial<PublishJob> = {}): PublishJob => ({
  id: 'j1', revision_id: 'r2', revision_version: 2, publish_at: '2026-10-01T01:00:00Z', status: 'scheduled',
  error: null, created_by_email: 'amy@ivy.example', finished_at: null, ...overrides,
})

describe('狀態點依狀態上色（綠＝已上線、暖黃＝草稿或待注意、灰＝沒有內容）', () => {
  it('狀態列帶 data-tone，樣式依 tone 給圓點顏色，沒有會蓋掉它的無條件規則', async () => {
    const { global } = await setup()
    const live = mountShell(global, editorState({ isPublished: ref(true) }))
    expect(live.get('.editor__status').attributes('data-tone')).toBe('success')
    expect(live.get('.editor__status').text()).toContain('官網顯示的是這一版')
    expect(mountShell(global, editorState()).get('.editor__status').attributes('data-tone')).toBe('warning')
    expect(mountShell(global, editorState({ latestRevisionAt: computed(() => null) })).get('.editor__status').attributes('data-tone')).toBe('info')

    const style = editorSource.slice(editorSource.indexOf('<style'))
    expect(style).toMatch(/\.editor__status\[data-tone='success'\] \.editor__dot \{\s*background: var\(--status-live\);/)
    expect(style).toMatch(/\.editor__status\[data-tone='warning'\] \.editor__dot \{\s*background: var\(--brand-gold\);/)
    // 不限定 tone 的 .editor__dot 只剩一條（預設灰），不會再被後面的金色蓋掉。
    const unscoped = [...style.matchAll(/(?:^|\n)\.editor__dot \{([^}]*)\}/g)]
    expect(unscoped).toHaveLength(1)
    expect(unscoped[0]![1]).toContain('var(--ink-3)')
    expect(style).not.toContain('.editor__history')
    expect(style).not.toMatch(/\.is-dirty \{\s*border-top-color/)
  })
})

describe('發布與核准的確認框列出和官網目前版本的差異', () => {
  it('發布已存的草稿：讀官網版比對（先補預設值），標題寫出內容與校區', async () => {
    const { global } = await setup()
    const get = mockContentApi(faqItem(), { r1: { title: '舊標題' } })
    const post = vi.spyOn(api, 'post').mockResolvedValue(faqItem({ current_published_revision_id: 'r2' }) as never)
    const confirm = confirmYes()
    const { wrapper } = mountPage(global)
    await flushPromises()
    // 2026-10-06 方向 D：載入時就讀官網版（動作列要列出和官網不同的欄位），開確認框不再重讀。
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')

    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
    const [message, title] = confirm.mock.calls[0]!
    expect(title).toBe('發布「各校常見問題（義華）」到官網？')
    const text = messageText(message)
    // 2026-10-06 方向 D：動作列已列出欄位，確認框只寫欄位名，不再列改前→改後。
    expect(text).toContain(`和官網目前的內容相比，會更新 1 個欄位：${contentFieldLabelFor('campus_faq', 'title')}。`)
    expect(text).not.toContain('舊標題')
    // 舊版缺的 note 先補預設值才比，不會多出「（空白）→（空白）」。
    expect(text).not.toContain('（空白）')
    // 發布帶上載入時官網的版本（樂觀鎖，main 的 PR #14）。
    expect(post).toHaveBeenCalledWith('/admin/content-items/campus_faq/publish?campus_key=yihua', {
      revision_id: 'r2',
      expected_published_revision_id: 'r1',
    })
  })

  it('已存草稿又有新修改：和官網比，已存與未存的修改都算進去；只跳最後一則 toast', async () => {
    const { global } = await setup()
    mockContentApi(faqItem(), { r1: { title: '舊標題', note: '' } })
    const saved = faqItem({ latest_version: 3 }, { id: 'r3', version: 3, payload: { title: '新標題', note: '補充說明' } })
    const post = vi.spyOn(api, 'post').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/publish') ? { ...saved, current_published_revision_id: 'r3' } : saved)) as typeof api.post)
    const success = vi.spyOn(ElMessage, 'success')
    const confirm = confirmYes()
    const { wrapper, editor } = mountPage(global)
    await flushPromises()
    editor().form.value.note = '補充說明'
    await flushPromises()
    // 動作列和官網比：已存與未存的修改都算，共 2 處（2026-10-06 方向 D）。
    expect(wrapper.text()).toContain('草稿有 2 處修改：')

    await button(wrapper, '儲存並發布到官網').trigger('click')
    await flushPromises()
    const [message, , options] = confirm.mock.calls[0]!
    expect(messageText(message)).toContain('會更新 2 個欄位')
    expect(options).toMatchObject({ confirmButtonText: '儲存並發布', cancelButtonText: '先不要' })
    expect(post).toHaveBeenLastCalledWith('/admin/content-items/campus_faq/publish?campus_key=yihua', {
      revision_id: 'r3',
      expected_published_revision_id: 'r1',
    })
    expect(success).not.toHaveBeenCalledWith('已儲存草稿，官網尚未更新')
  })

  it('從沒發布過就說是第一次上線，不拿空白比；有排程時提醒排程會略過', async () => {
    const { global } = await setup()
    const get = mockContentApi(faqItem({ current_published_revision_id: null }), {}, [scheduledJob()])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { wrapper } = mountPage(global)
    await flushPromises()
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    const text = messageText(confirm.mock.calls[0]![0])
    expect(text).toContain('這是第一次上線')
    expect(text).toContain('已排定 2026/10/01 09:00 自動發布；現在發布後，這個排程到時會略過。')
    expect(text).not.toContain('（空白）')
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('讀不到官網版時退回講官網現在是哪一版', async () => {
    const { global } = await setup()
    mockContentApi(faqItem())
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { wrapper } = mountPage(global)
    await flushPromises()
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('官網目前顯示的是上一版')
  })

  it('核准送審：列出送審版本和官網的差異，附預覽，標題寫出內容與校區', async () => {
    const { global } = await setup('/content/campus-faq', testUser('campus_admin', { campus_keys: ['yihua'] }))
    mockContentApi(faqItem({}, { review_status: 'pending_review' }), { r1: { title: '舊標題', note: '' } })
    const post = vi.spyOn(api, 'post').mockResolvedValue(faqItem({ current_published_revision_id: 'r2' }, { review_status: 'approved' }) as never)
    const confirm = confirmYes()
    const { wrapper } = mountPage(global)
    await flushPromises()
    await button(wrapper, '核准並發布').trigger('click')
    await flushPromises()
    const [message, title] = confirm.mock.calls[0]!
    expect(title).toBe('核准並發布「各校常見問題（義華）」？')
    const text = messageText(message)
    expect(text).toContain('和官網目前的內容相比，會更新 1 個欄位，核准後家長立刻看到')
    expect(text).toContain('舊標題')
    expect(text).toContain('預覽送審的內容 ↗')
    expect(post).toHaveBeenCalledWith('/admin/content-items/campus_faq/review?campus_key=yihua', { revision_id: 'r2', decision: 'approve', note: null })
  })
})

describe('儲存並發布／送審／排程只跳最後結果那一則 toast', () => {
  async function loaded(user: UserOut = testUser('super_admin')) {
    const { global } = await setup('/content/campus-faq', user)
    mockContentApi(faqItem())
    const page = mountPage(global)
    await flushPromises()
    page.editor().form.value.title = '改過的標題'
    return page.editor()
  }
  const savedItem = faqItem({ latest_version: 3 }, { id: 'r3', version: 3, payload: { title: '改過的標題', note: '' } })

  it('存好但發布失敗：講明草稿已經存了', async () => {
    const editor = await loaded()
    vi.spyOn(api, 'post').mockImplementation(((path: string) =>
      path.includes('/publish')
        ? Promise.reject(new ApiError(409, { code: 'MEDIA_NOT_READY', message: '素材還沒處理好' }))
        : Promise.resolve(savedItem)) as typeof api.post)
    const success = vi.spyOn(ElMessage, 'success')
    const error = vi.spyOn(ElMessage, 'error')
    expect(await editor.saveAndPublish()).toBe(false)
    expect(success).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: '已存成草稿，但發布失敗：素材還沒處理好', showClose: true, duration: 0 }))
    expect(editor.isDirty.value).toBe(false)
  })

  it('儲存並送審只跳「已送審」；排程失敗時也講明草稿已存', async () => {
    const editor = await loaded(testUser('editor', { campus_keys: ['yihua'] }))
    vi.spyOn(api, 'post').mockResolvedValue(savedItem as never)
    const success = vi.spyOn(ElMessage, 'success')
    expect(await editor.submitForReview()).toBe(true)
    expect(success.mock.calls).toEqual([['已送審，校區管理者核准後才會出現在官網']])

    editor.form.value.title = '再改一次'
    vi.spyOn(api, 'post').mockImplementation(((path: string) =>
      path.endsWith('/schedules?campus_key=yihua')
        ? Promise.reject(new ApiError(422, '時間要在現在之後'))
        : Promise.resolve(savedItem)) as typeof api.post)
    const error = vi.spyOn(ElMessage, 'error')
    success.mockClear()
    expect(await editor.schedule('2026-10-01T09:00:00+08:00')).toBe(false)
    expect(success).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: '已存成草稿，但排程失敗：時間要在現在之後', showClose: true, duration: 0 }))
  })

  it('單純儲存草稿仍會提示官網尚未更新', async () => {
    const editor = await loaded()
    vi.spyOn(api, 'post').mockResolvedValue(savedItem as never)
    const success = vi.spyOn(ElMessage, 'success')
    expect(await editor.save()).toBe(true)
    expect(success).toHaveBeenCalledWith('已儲存草稿，官網尚未更新')
  })
})

describe('動作列的主色給真正的下一步', () => {
  const primary = (wrapper: VueWrapper) => wrapper.findAll('.editor__actions .el-button--primary').map((b) => b.text().trim())

  it('能發布的人：有修改→儲存草稿；草稿待發布→發布到官網；已上線沒修改→沒有主色鈕', async () => {
    const { global } = await setup()
    expect(primary(mountShell(global, editorState({ isDirty: computed(() => true) })))).toEqual(['儲存草稿'])
    expect(primary(mountShell(global, editorState()))).toEqual(['發布到官網'])
    const live = mountShell(global, editorState({ isPublished: ref(true) }))
    expect(primary(live)).toEqual([])
    // 按鈕還在（改一般樣式、停用），版面不跳動。
    expect(button(live, '儲存草稿').attributes('disabled')).toBeDefined()
    expect(button(live, '發布到官網').attributes('disabled')).toBeDefined()
  })

  it('內容編輯：草稿待送審→送審是主色；已送審→沒有主色鈕', async () => {
    const { global } = await setup('/content/campus-faq', testUser('editor', { campus_keys: ['yihua'] }))
    expect(primary(mountShell(global, editorState()))).toEqual(['送審'])
    expect(primary(mountShell(global, editorState({ reviewStatus: computed(() => 'pending_review') })))).toEqual([])
  })
})

describe('內容編輯看到的是送審說明', () => {
  it('草稿還沒送審、動作列講送審核准；共用內容寫總管理者核准', async () => {
    const { global } = await setup('/content/shared-faq', testUser('editor', { campus_keys: ['yihua'] }))
    const wrapper = mountShell(global, editorState({ approver: '總管理者' }))
    expect(wrapper.get('.editor__status').text()).toContain('草稿還沒送審')
    expect(wrapper.get('.editor__status').text()).toContain('按「送審」後總管理者才看得到')
    expect(wrapper.get('.editor__actions').text()).toContain('送審核准後才會公開')
    expect(wrapper.text()).not.toContain('發布後才會公開')
  })
})

describe('放棄修改', () => {
  it('改名為「放棄修改」，先問「放棄 N 個欄位的修改？」，確認才清掉', async () => {
    const { global } = await setup()
    const reset = vi.fn()
    const changes = computed<FieldChange[]>(() => [
      { key: 'title', label: '標題', before: '舊', after: '新' },
      { key: 'note', label: '說明文字', before: '', after: '補充' },
    ])
    const wrapper = mountShell(global, editorState({ isDirty: computed(() => true), changes, reset, contextLabel: computed(() => '各校常見問題（義華）') }))
    expect(wrapper.findAll('button').some((b) => b.text().trim() === '還原修改')).toBe(false)
    // 不和儲存、發布擠在同一組按鈕裡。
    expect(wrapper.find('.editor__buttons .editor__discard').exists()).toBe(false)

    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '放棄修改').trigger('click')
    await flushPromises()
    expect(reset).not.toHaveBeenCalled()
    const [message, title, options] = confirm.mock.calls[0]!
    expect(title).toBe('放棄 2 個欄位的修改？')
    expect(String(message)).toContain('「各校常見問題（義華）」還沒儲存的修改會清掉')
    expect(options).toMatchObject({ confirmButtonText: '放棄修改', cancelButtonText: '先不要' })

    await button(wrapper, '放棄修改').trigger('click')
    await flushPromises()
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('分校內容的校區留在網址並記住', () => {
  function probe(global: Global, dirty = false, confirmLeave = async () => true) {
    const campus = ref('')
    const load = vi.fn(async () => {})
    const Probe = defineComponent({
      setup() {
        // saving／publishing：處理中不換校（2026-10-06）會讀這兩個。
        const state = { load, isDirty: computed(() => dirty), saving: ref(false), publishing: ref(false) } as unknown as ContentEditorState
        const shell = ref({ confirmLeave }) as unknown as Parameters<typeof useCampusContent>[2]
        useCampusContent(state, campus, shell)
        return () => null
      },
    })
    wrappers.push(mount(Probe, { global }))
    return { campus, load }
  }

  it('切校寫回 ?campus=；換到另一個分校內容頁沿用上次的校區；已在頁面上時跟著網址換校', async () => {
    const { global, router } = await setup('/content/campus-faq')
    const faq = probe(global)
    await flushPromises()
    expect(faq.campus.value).toBe('yihua')
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-faq?campus=yihua')

    faq.campus.value = 'renwu'
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-faq?campus=renwu')
    expect(faq.load).toHaveBeenCalledTimes(2)

    await router.push('/content/campus-faq?campus=minghua')
    await flushPromises()
    expect(faq.campus.value).toBe('minghua')

    await router.push('/content/campus-tour')
    const tour = probe(global)
    await flushPromises()
    expect(tour.campus.value).toBe('minghua')
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-tour?campus=minghua')
    // 前一頁（還掛著）不會跟著別頁的網址換校。
    expect(faq.campus.value).toBe('minghua')
    await router.push('/content/campus-tour?campus=chongde')
    await flushPromises()
    expect(tour.campus.value).toBe('chongde')
    expect(faq.campus.value).toBe('minghua')
  })

  it('有未儲存修改又選擇留下：取消這次換頁，校區和網址都不動、也不多一筆上一頁紀錄', async () => {
    const { global, router } = await setup('/content/campus-faq?campus=renwu')
    const confirmLeave = vi.fn(async () => false)
    const page = probe(global, true, confirmLeave)
    await flushPromises()
    expect(page.campus.value).toBe('renwu')
    const replace = vi.spyOn(router, 'replace')
    const result = await router.push('/content/campus-faq?campus=minghua')
    await flushPromises()
    expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
    expect(confirmLeave).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
    expect(page.campus.value).toBe('renwu')
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-faq?campus=renwu')
  })

  it('有未儲存修改但同意放棄：只問一次就換校', async () => {
    const { global, router } = await setup('/content/campus-faq?campus=renwu')
    const confirmLeave = vi.fn(async () => true)
    const page = probe(global, true, confirmLeave)
    await flushPromises()
    await router.push('/content/campus-faq?campus=minghua')
    await flushPromises()
    expect(confirmLeave).toHaveBeenCalledOnce()
    expect(page.campus.value).toBe('minghua')
    expect(page.load).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-faq?campus=minghua')
  })

  it('從側欄再點同一頁（網址沒帶校區）：畫面停在目前的校區，網址補回 ?campus=', async () => {
    const { global, router } = await setup('/content/campus-faq?campus=renwu')
    const page = probe(global)
    await flushPromises()
    await router.push('/content/campus-faq')
    await flushPromises()
    expect(page.campus.value).toBe('renwu')
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-faq?campus=renwu')
  })

  it('內容編輯頁工具列裡的多校下拉也寫出「校區」；其他頁面外面已有標籤就不加', async () => {
    const { global } = await setup()
    const inEditor = mount(ContentEditor, {
      props: { editor: editorState() },
      slots: { toolbar: () => h(CampusSelect, { modelValue: 'yihua', keys: ['yihua', 'renwu'] }) },
      global,
    })
    wrappers.push(inEditor)
    expect(inEditor.get('.toolbar .campus-single__label').text()).toBe('校區')
    const plain = mount(CampusSelect, { props: { modelValue: 'yihua', keys: ['yihua', 'renwu'] }, global })
    wrappers.push(plain)
    expect(plain.find('.campus-single__label').exists()).toBe(false)
  })
})

describe('排程說明', () => {
  it('排程列不寫版本號與帳號；之後又存了新草稿時講明；取消前先確認', async () => {
    const { global } = await setup()
    const latestId = ref('r2')
    const cancelSchedule = vi.fn(async () => true)
    const wrapper = mountShell(global, editorState({
      schedules: ref([scheduledJob()]),
      loadSchedules: async () => {},
      cancelSchedule,
      latestRevisionId: computed(() => latestId.value),
      // 名稱本身有引號時不再多包一層。
      contextLabel: computed(() => '首頁「關於常春藤」'),
    }))
    await flushPromises()
    const line = () => wrapper.get('.editor__schedules').text()
    expect(line()).toContain('已排定 2026/10/01 09:00 自動發布這份草稿。')
    expect(line()).not.toContain('第 2 版')
    expect(line()).not.toContain('amy@ivy.example')

    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '取消排程').trigger('click')
    await flushPromises()
    expect(cancelSchedule).not.toHaveBeenCalled()
    expect(confirm.mock.calls[0]![1]).toBe('取消首頁「關於常春藤」的排程？')
    expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '取消排程', cancelButtonText: '先不要' })
    await button(wrapper, '取消排程').trigger('click')
    await flushPromises()
    expect(cancelSchedule).toHaveBeenCalledWith('j1')

    // 之後又存了新草稿、還不知道官網是哪一版：講明不含之後的修改，不斷言一定會發布。
    latestId.value = 'r3'
    await flushPromises()
    expect(line()).toContain('自動發布較早儲存的草稿（不含之後存的修改）；到時官網若已經是更新的內容就會略過。')
  })

  // 後端 skip_reason：到期時官網已經是排定的那一版或更新的內容就略過，排程列要先看官網。
  it('先看官網是哪一版：已是這一版或更新就講到時會略過，官網較舊才講會發布較早的草稿', async () => {
    const { global } = await setup()
    const line = (overrides: Partial<ContentEditorState>) =>
      mountShell(global, editorState({ schedules: ref([scheduledJob()]), loadSchedules: async () => {}, ...overrides })).get('.editor__schedules').text()
    const newer = { latestRevisionId: computed(() => 'r3') }

    // 排 r2 之後發布了 r3：官網就是最新一版，排程到時會略過（不能說會發布較舊的內容）。
    const publishedNewer = line({ ...newer, isPublished: ref(true), liveVersion: computed(() => 3) })
    expect(publishedNewer).toContain('已排定 2026/10/01 09:00 自動發布較早儲存的草稿，但官網已經是更新的內容，到時會略過。')
    expect(publishedNewer).not.toContain('仍會發布')
    expect(line({ latestRevisionId: computed(() => 'r2'), isPublished: ref(true) })).toContain('自動發布這份內容，但官網已經是這一版，到時會略過。')
    // 排 r2、發布 r3、又存了 r4 草稿：官網 r3 比排定的新，一樣會略過。
    expect(line({ latestRevisionId: computed(() => 'r4'), liveVersion: computed(() => 3) })).toContain('較早儲存的草稿，但官網已經是更新的內容，到時會略過。')
    // 排 r2 之後直接發布了 r2、又存了 r3：排定的那一份已經在官網上。
    expect(line({ ...newer, liveVersion: computed(() => 2) })).toContain('較早儲存的草稿，但這份已經在官網上，到時會略過。')
    // 官網還是比排定的舊（r1），或從沒發布過：到時會發布較早的草稿。
    expect(line({ ...newer, liveVersion: computed(() => 1) })).toContain('自動發布較早儲存的草稿，不含之後存的修改。')
    expect(line({ ...newer, neverPublished: computed(() => true) })).toContain('自動發布較早儲存的草稿，不含之後存的修改。')
    expect(line({ latestRevisionId: computed(() => 'r2'), liveVersion: computed(() => 1), isDirty: computed(() => true) })).toContain('自動發布上次儲存的草稿，不含還沒儲存的修改。')
  })

  it('真的載入時：排的不是最新一版、官網也不是最新一版，才另外讀官網那一版的版本號', async () => {
    const { global } = await setup()
    // 排 r2、發布 r3、又存了 r4：官網 r3 不是最新一版，要讀它才知道比排定的新。
    const item = faqItem({ latest_version: 4, current_published_revision_id: 'r3' }, { id: 'r4', version: 4, payload: { title: '草稿', note: '' } })
    const get = vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path.includes('/schedules')) return Promise.resolve([scheduledJob()])
      if (path.includes('/revisions/r3')) return Promise.resolve({ id: 'r3', version: 3, payload: { title: '官網', note: '' } })
      return Promise.resolve(item)
    }) as typeof api.get)
    const { wrapper, editor } = mountPage(global)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r3?campus_key=yihua')
    expect(editor().liveVersion.value).toBe(3)
    expect(wrapper.get('.editor__schedules').text()).toContain('較早儲存的草稿，但官網已經是更新的內容，到時會略過。')

    // 讀過的官網版不重抓：開發布確認框比對時直接用。
    get.mockClear()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('排 r2 後在這頁發布 r3：排程列改講到時會略過，和發布前的提醒一致', async () => {
    const { global } = await setup()
    const item = faqItem({ latest_version: 3, current_published_revision_id: 'r1' }, { id: 'r3', version: 3, payload: { title: '新標題', note: '' } })
    const get = mockContentApi(item, { r1: { title: '舊標題', note: '' } }, [scheduledJob()])
    vi.spyOn(api, 'post').mockResolvedValue({ ...item, current_published_revision_id: 'r3' } as never)
    const confirm = confirmYes()
    const { wrapper } = mountPage(global)
    await flushPromises()
    // 官網 r1 讀不到版號（mock 沒給）：不斷言一定會發布。
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')
    expect(wrapper.get('.editor__schedules').text()).toContain('到時官網若已經是更新的內容就會略過')

    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('現在發布後，這個排程到時會略過。')
    const text = wrapper.get('.editor__schedules').text()
    expect(wrapper.get('.editor__status').text()).toContain('官網顯示的是這一版')
    expect(text).toContain('較早儲存的草稿，但官網已經是更新的內容，到時會略過。')
    expect(text).not.toContain('仍會發布')
  })

  it('排程對話框先擋已經過去的時間，並提供「明天 09:00」', async () => {
    const { global } = await setup()
    const schedule = vi.fn(async () => true)
    const wrapper = mountShell(global, editorState({ schedule }))
    await button(wrapper, '排程發布').trigger('click')
    await flushPromises()
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    expect((picker.props('shortcuts') as { text: string }[]).map((s) => s.text)).toEqual(['明天 09:00'])
    picker.vm.$emit('update:modelValue', '2020-01-01T09:00:00+08:00')
    await flushPromises()
    expect(document.body.textContent).toContain('這個時間已經過了')
    expect(bodyButton('排程').disabled).toBe(true)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('選好時間後停在對話框裡等到時間過了：按「排程」會顯示提示，不會沒反應', async () => {
    const { global } = await setup()
    const schedule = vi.fn(async () => true)
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-01T08:58:00+08:00').getTime())
    const wrapper = mountShell(global, editorState({ schedule }))
    await button(wrapper, '排程發布').trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', '2026-10-01T09:00:00+08:00')
    await flushPromises()
    expect(document.body.textContent).not.toContain('這個時間已經過了')
    expect(bodyButton('排程').disabled).toBe(false)

    now.mockReturnValue(new Date('2026-10-01T09:01:00+08:00').getTime())
    bodyButton('排程').click()
    await flushPromises()
    expect(schedule).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('這個時間已經過了')
    expect(bodyButton('排程').disabled).toBe(true)
  })
})

describe('預覽入口與報讀', () => {
  // 2026-10-05 第九輪：有修改時改給「存草稿並預覽」，不再並列改之前的已存草稿（見 ux20261005.test.ts）。
  it('官網就是這一版時給「查看官網此頁」；有修改時給「存草稿並預覽」', async () => {
    const { global } = await setup()
    const live = mountShell(global, editorState({ isPublished: ref(true), publicUrl: computed(() => 'https://example.test/campuses/yihua') }))
    expect(live.get('.editor__tools a').text()).toBe('查看官網此頁 ↗')
    expect(live.get('.editor__tools a').attributes('href')).toBe('https://example.test/campuses/yihua')

    const dirty = mountShell(global, editorState({ isDirty: computed(() => true), previewUrl: computed(() => 'https://example.test/preview') }))
    expect(dirty.findAll('.editor__tools a')).toHaveLength(0)
    expect(dirty.get('.editor__save-preview').text()).toBe('存草稿並預覽 ↗')
  })

  it('狀態列不是即時區；只有隱藏的 status 唸狀態名稱，欄位數不當即時區', async () => {
    const { global } = await setup()
    const publishing = ref(false)
    const wrapper = mountShell(global, editorState({ isDirty: computed(() => true), publishing }))
    expect(wrapper.get('.editor__status').attributes('role')).toBe('group')
    expect(wrapper.get('.editor__status').attributes('aria-labelledby')).toBe(wrapper.get('.editor__status strong').attributes('id'))
    expect(wrapper.get('.visually-hidden[role="status"]').text()).toBe('有未儲存的修改')
    expect(wrapper.get('.editor__actions-state').attributes('role')).toBeUndefined()
    // 按下發布之後到結果出來前，報讀「正在處理」。
    publishing.value = true
    await flushPromises()
    expect(wrapper.get('.visually-hidden[role="status"]').text()).toBe('正在處理，請稍候…')
  })

  it('手機按鈕只寫「發布」，報讀仍是「發布到官網」（不是 display: none）', () => {
    const mobile = editorSource.slice(editorSource.indexOf('@media (max-width: 720px)'))
    const rule = mobile.match(/\.editor__wide-only \{([^}]*)\}/)![1]!
    expect(rule).not.toContain('display: none')
    expect(rule).toContain('clip-path: inset(50%)')
  })

  it('開確認框前讀官網版的那段時間，表單與儲存草稿也先鎖住', async () => {
    const { global } = await setup()
    let finish!: (value: null) => void
    const compareWithLive = vi.fn(() => new Promise<null>((resolve) => { finish = resolve }))
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const wrapper = mountShell(global, editorState({ isDirty: computed(() => true), compareWithLive }))
    expect(wrapper.get('.editor__body').attributes('inert')).toBeUndefined()
    await button(wrapper, '儲存並發布到官網').trigger('click')
    await flushPromises()
    expect(wrapper.get('.editor__body').attributes('inert')).toBeDefined()
    expect(button(wrapper, '儲存草稿').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '放棄修改').attributes('disabled')).toBeDefined()
    finish(null)
    await flushPromises()
    expect(wrapper.get('.editor__body').attributes('inert')).toBeUndefined()
    expect(button(wrapper, '儲存草稿').attributes('disabled')).toBeUndefined()
  })
})

describe('版本紀錄的標籤與按鈕主次', () => {
  function handle(): RevisionHistoryHandle {
    return {
      list: vi.fn(async () => [
        { id: 'r2', version: 2, created_at: '2026-09-24T02:00:00Z', created_by_email: 'amy@ivy.example', is_published: true },
        { id: 'r1', version: 1, created_at: '2026-09-23T02:00:00Z', created_by_email: 'amy@ivy.example', is_published: false },
      ]),
      payloadOf: vi.fn(async () => ({ title: '舊標題' })),
      savedPayload: () => ({ title: '新標題' }),
      restore: vi.fn(async () => true),
    }
  }

  async function open(props: Record<string, unknown>) {
    const history = handle()
    const wrapper = mount(RevisionHistoryDrawer, {
      props: { history, dirty: false, busy: false, modelValue: false, ...props },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    ;[...document.body.querySelectorAll('.history__item')][1]!.dispatchEvent(new Event('click'))
    await flushPromises()
    return history
  }

  it('官網目前的版本不再標「最新草稿」；還原成草稿是主按鈕、還原並發布一般樣式', async () => {
    await open({})
    const first = document.body.querySelector('.history__item')!.textContent ?? ''
    expect(first).toContain('官網目前版本')
    expect(first).not.toContain('最新草稿')
    expect(bodyButton('還原成草稿').classList.contains('el-button--primary')).toBe(true)
    expect(bodyButton('還原並發布').classList.contains('el-button--primary')).toBe(false)
  })

  it('內容編輯還原成草稿時，說明要再送審、由誰核准', async () => {
    const confirm = confirmYes()
    const history = await open({ canPublish: false, approver: '總管理者' })
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent?.trim() === '還原並發布')).toBe(false)
    bodyButton('還原成草稿').click()
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('要再送審，總管理者核准後官網才會更新')
    expect(history.restore).toHaveBeenCalledWith('r1', false)
  })
})

describe('發布紀錄', () => {
  it('初始化的來源寫「網站初始內容」；手機上整站還原不是滿寬按鈕', () => {
    expect(releaseSourceLabel('initialize')).toBe('網站初始內容')
    const mobile = publishHistorySource.slice(publishHistorySource.indexOf('@media (max-width: 720px)'))
    const rule = mobile.match(/\.release__actions \.el-button \{([^}]*)\}/)![1]!
    expect(rule).toContain('min-height: 44px')
    expect(rule).not.toContain('width: 100%')
  })

  it('整站還原的確認框列出預計換回的內容；之後才上線與換回同一版的不列', async () => {
    const change = (id: string, kind: string, campus: string | null, to: number, from: number | null) =>
      ({ content_item_id: id, kind, campus_key: campus, revision_id: `${id}-${to}`, revision_version: to, previous_revision_version: from })
    const release = (id: string, changes: unknown[], extra: Record<string, unknown> = {}) =>
      ({ id, created_at: '2026-09-25T02:00:00Z', created_by_email: 'amy@ivy.example', source: 'publish', restored_from_release_id: null, is_current: false, changes, ...extra })
    const releases = [
      release('now', [change('faq', 'campus_faq', 'yihua', 5, 4), change('news', 'home_news', null, 2, null)], { is_current: true }),
      release('mid', [change('faq', 'campus_faq', 'yihua', 4, 3), change('hero', 'home_hero', null, 7, 6)]),
      release('back', [change('about', 'home_about', null, 3, 2)]),
      release('undo', [change('about', 'home_about', null, 2, 3)]),
      release('target', [change('faq', 'campus_faq', 'yihua', 3, 2)], { source: 'initialize' }),
    ]
    vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path.startsWith('/admin/releases')) return Promise.resolve({ items: releases, next_before: null })
      return Promise.resolve([])
    }) as typeof api.get)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { global } = await setup('/releases')
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('網站初始內容')
    const restoreButtons = wrapper.findAll('button').filter((b) => b.text() === '整站還原到這次')
    await restoreButtons[restoreButtons.length - 1]!.trigger('click')
    await flushPromises()
    const message = String(confirm.mock.calls[0]![0])
    expect(message).toContain('預計換回 2 項：各校常見問題（義華）、首頁大圖標語。')
    expect(message).not.toContain('最新消息與活動')
    expect(message).not.toContain('關於常春藤')
    expect(message).toContain('實際換回哪些以還原後的訊息為準')
  })
})
