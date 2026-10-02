// 2026-10-02 內容編輯 CMS 稽核修正：存檔錯誤寫出位置並可跳過去（cms-1）、狀態列寫
// 草稿是誰存的（cms-2）、消息與時刻卡收合（cms-3）、版本衝突保留修改（cms-6）、
// 原型原文提示（cms-7）、離頁時可以先存草稿（cms-8）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import HomeNewsView from '../views/HomeNewsView.vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, contentFieldErrors, contentSaveErrorMessage } from '../api/errors'
import { contentPathLabel } from '../api/contentFieldLabels'
import { legacyCopyHint, LEGACY_FAQ_BOOKING, LEGACY_SITE_DESCRIPTION } from '../composables/contentHints'
import { useContentItem, type ContentEditorState, type RevisionSummary } from '../composables/useContentItem'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function setup(path = '/content/home-news') {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  return { router, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } }
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((b) => b.text().trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found
}

const article = (id: string, title: string) => ({
  id, date: '2026-09-01', category: '', title, description: '', body: [], image: '', alt: '', scope: 'global', campus_keys: [], featured: false,
})

function newsItem() {
  return {
    id: 'news', kind: 'home_news', campus_key: null, latest_version: 1, current_published_revision_id: 'rev-1',
    latest_revision: {
      id: 'rev-1', version: 1, created_at: '2026-09-24T00:00:00Z', review_status: 'draft',
      payload: { sample_note: '', articles: [article('a1', '開學'), article('a2', '親子日'), article('a3', '運動會')], events: [], home_display_count: null, films: null },
    },
  }
}

describe('存檔被擋下時寫出哪一則哪一欄（cms-1）', () => {
  it('422 的 loc 寫成中文位置、pydantic 英文訊息翻成中文；共用的 apiErrorMessage 不變', () => {
    const err = new ApiError(422, [
      { loc: ['articles', 3, 'title'], msg: 'String should have at least 1 character', type: 'string_too_short' },
      { loc: ['events', 0, 'title'], msg: 'String should have at most 60 characters', type: 'string_too_long' },
    ])
    expect(contentFieldErrors(err, 'home_news').map((e) => `${e.label}：${e.message}`)).toEqual([
      '最新消息第 4 則・標題：不能空白',
      '近期活動第 1 筆・活動名稱：不能超過 60 字',
    ])
    expect(contentSaveErrorMessage(err, 'home_news', '儲存失敗')).toBe('最新消息第 4 則・標題：不能空白；近期活動第 1 筆・活動名稱：不能超過 60 字')
    expect(apiErrorMessage(err, '儲存失敗')).toBe('String should have at least 1 character；String should have at most 60 characters')

    const facebook = new ApiError(422, [{ loc: ['facebook'], msg: 'Value error, 網址必須以 https://、http://、mailto: 或 tel: 開頭', type: 'value_error' }])
    expect(contentSaveErrorMessage(facebook, 'campus_profile', '儲存失敗')).toBe('Facebook 粉絲專頁網址：網址必須以 https://、http://、mailto: 或 tel: 開頭')
    // 不是 422 照舊
    expect(contentSaveErrorMessage(new ApiError(409, { code: 'MEDIA_NOT_READY', message: '素材還沒處理好' }), 'home_news', 'x')).toBe('素材還沒處理好')
  })

  it('巢狀清單的位置：消息內文第幾段、時刻卡第幾張', () => {
    expect(contentPathLabel('home_news', ['articles', 0, 'body', 2, 'text'])).toBe('最新消息第 1 則・內文第 3 段・文字')
    expect(contentPathLabel('home_news', ['articles', 1, 'description'])).toBe('最新消息第 2 則・摘要')
    expect(contentPathLabel('day_experience', ['moments', 5, 'story'])).toBe('時刻卡第 6 張・翻面後的故事')
  })

  it('存檔失敗：toast 不自動消失；狀態列下方列出錯誤，點了展開那一則並聚焦欄位', async () => {
    const { global } = await setup()
    vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/schedules') || path.includes('/revisions') ? [] : newsItem())) as typeof api.get)
    const post = vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(422, [{ loc: ['articles', 1, 'title'], msg: 'String should have at least 1 character', type: 'string_too_short' }]),
    )
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = mount(HomeNewsView, { global, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()

    // 預設收合，欄位用 v-show 藏著
    const toggles = wrapper.findAll('.news-item .repeat-item__toggle')
    expect(toggles.map((t) => t.attributes('aria-expanded'))).toEqual(['false', 'false', 'false'])

    await wrapper.findAll('.news-item__title input')[1]!.setValue('')
    await button(wrapper, '儲存草稿').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: '最新消息第 2 則・標題：不能空白', showClose: true, duration: 0 }))

    const list = wrapper.get('.editor__errors')
    expect(list.text()).toContain('存檔沒有成功，有 1 個地方要修改')
    await list.get('.editor__error-link').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.news-item .repeat-item__toggle')[1]!.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(wrapper.findAll('.news-item__title input')[1]!.element)
  })

  it('新增一則消息：收合中的清單也會展開新的那一則並聚焦標題', async () => {
    const { global } = await setup()
    vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/schedules') || path.includes('/revisions') ? [] : newsItem())) as typeof api.get)
    const wrapper = mount(HomeNewsView, { global, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    await button(wrapper, '新增一則消息').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.news-item .repeat-item__toggle')[0]!.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(wrapper.findAll('.news-item__title input')[0]!.element)
    // 全部展開
    await button(wrapper, '全部展開').trigger('click')
    expect(wrapper.findAll('.news-item .repeat-item__toggle').every((t) => t.attributes('aria-expanded') === 'true')).toBe(true)
  })
})

// ---------------------------------------------------------------------------

interface Faq { title: string; note: string }

function faqItem(version: number, payload: Faq) {
  return {
    id: 'i1', kind: 'campus_faq', campus_key: 'yihua', latest_version: version, current_published_revision_id: 'r1',
    latest_revision: { id: `r${version}`, version, created_at: '2026-09-25T02:00:00Z', payload, review_status: 'draft', review_note: null },
  }
}

function mountFaqPage(global: Awaited<ReturnType<typeof setup>>['global']) {
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

describe('版本衝突保留自己的修改（cms-6）', () => {
  it('衝突時持續提示、停用儲存；看對方改了什麼；載入最新後可以只套回自己改的欄位', async () => {
    const { global } = await setup('/content/campus-faq')
    let current = faqItem(2, { title: '原標題', note: '原說明' })
    vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/schedules') || path.includes('/revisions') ? [] : current)) as typeof api.get)
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'CONTENT_VERSION_CONFLICT', message: '內容已被其他人更新' }))
    const error = vi.spyOn(ElMessage, 'error')
    const page = mountFaqPage(global)
    await flushPromises()

    page.editor().form.value.title = '我改的標題'
    expect(await page.editor().save()).toBe(false)
    await flushPromises()
    expect(error).not.toHaveBeenCalled()
    const alert = page.wrapper.get('.editor__conflict')
    expect(alert.text()).toContain('你的修改還在畫面上')
    expect(button(page.wrapper, '儲存草稿').attributes('disabled')).toBeDefined()
    expect(page.editor().form.value.title).toBe('我改的標題')

    // 對方改的是說明
    current = faqItem(3, { title: '原標題', note: '對方的說明' })
    await button(page.wrapper, '看對方改了什麼').trigger('click')
    await flushPromises()
    expect(page.wrapper.get('.editor__conflict').text()).toContain('原說明 → 對方的說明')

    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await button(page.wrapper, '載入最新內容').trigger('click')
    await flushPromises()
    expect(page.editor().conflict.value).toBe(false)
    expect(page.editor().form.value).toEqual({ title: '原標題', note: '對方的說明' })
    expect(page.wrapper.text()).toContain('你剛才的修改還沒套回')

    await button(page.wrapper, '套回我的修改').trigger('click')
    // 只套回自己改的標題，對方改的說明保留；套回後是未儲存的修改
    expect(page.editor().form.value).toEqual({ title: '我改的標題', note: '對方的說明' })
    expect(page.editor().isDirty.value).toBe(true)
  })
})

describe('狀態列寫草稿是誰存的（cms-2）', () => {
  it('從版本紀錄找最新一版的編輯者；讀不到就只寫時間', async () => {
    const { global } = await setup('/content/campus-faq')
    const revisions: RevisionSummary[] = [
      { id: 'r2', version: 2, created_at: '2026-09-25T02:00:00Z', created_by_email: 'amy@ivy.example', created_by_display_name: '王園長', is_published: false },
    ]
    const state = (list: () => Promise<RevisionSummary[]>): ContentEditorState => ({
      loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
      isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-09-25T02:00:00Z'),
      latestRevisionId: computed(() => 'r2'),
      history: { list, payloadOf: async () => ({}), savedPayload: () => ({}), restore: async () => true },
      load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
    })
    const named = mount(ContentEditor, { props: { editor: state(async () => revisions) }, global })
    wrappers.push(named)
    await flushPromises()
    expect(named.get('.editor__status').text()).toContain('王園長 於 2026/09/25 10:00 存的草稿，官網仍是上一版。')

    const unknown = mount(ContentEditor, { props: { editor: state(() => Promise.reject(new Error('x'))) }, global })
    wrappers.push(unknown)
    await flushPromises()
    expect(unknown.get('.editor__status').text()).toContain('草稿儲存於 2026/09/25 10:00，官網仍是上一版。')
  })
})

describe('原型原文提示（cms-7）', () => {
  it('只認一字不差的原文，改過就不提示；不認「示意」關鍵字', () => {
    expect(legacyCopyHint('siteDescription', LEGACY_SITE_DESCRIPTION)).toContain('官網目前顯示替換後的正式描述')
    expect(legacyCopyHint('siteDescription', `${LEGACY_SITE_DESCRIPTION} `)).toBe('')
    expect(legacyCopyHint('faqAnswer', LEGACY_FAQ_BOOKING)).toContain('原型留下的回答')
    expect(legacyCopyHint('faqAnswer', '招生年齡、名額與費用依校區與學年度而異。請向明華校確認；這份提案不提供即時招生名額或費用報價。')).not.toBe('')
    expect(legacyCopyHint('faqAnswer', '入園情境示意')).toBe('')
    // 預約那一題改掉之後，官網不再替換這一校的費用回答，就不提示。
    const fee = '招生年齡、名額與費用依校區與學年度而異。請向明華校確認；這份提案不提供即時招生名額或費用報價。'
    expect(legacyCopyHint('faqAnswer', fee, [fee, '已改寫的預約回答'])).toBe('')
    expect(legacyCopyHint('faqAnswer', fee, [fee, LEGACY_FAQ_BOOKING])).not.toBe('')
  })
})

describe('離頁時可以先存草稿（cms-8）', () => {
  function mountGuard(global: Awaited<ReturnType<typeof setup>>['global'], saveDraft: () => Promise<boolean>) {
    let guard!: ReturnType<typeof useUnsavedChanges>
    const Page = defineComponent({
      setup() {
        guard = useUnsavedChanges(ref(true), ref(false), { saveDraft })
        return () => h('div')
      },
    })
    wrappers.push(mount(Page, { global }))
    return () => guard
  }

  // 模擬按下對話框的某個鈕：先跑 beforeClose，再照 Element Plus 的規則 resolve／reject。
  function pressInDialog(action: 'confirm' | 'cancel' | 'close') {
    return vi.spyOn(ElMessageBox, 'confirm').mockImplementation(((_message: unknown, _title: unknown, options: { beforeClose?: (a: string, i: Record<string, unknown>, done: () => void) => void }) =>
      new Promise((resolve, reject) => {
        const finish = () => (action === 'confirm' ? resolve('confirm' as never) : reject(action))
        if (options?.beforeClose) options.beforeClose(action, {}, finish)
        else finish()
      })) as never)
  }

  it('離開路由：存草稿成功才放行，失敗留在原頁；放棄修改放行；關掉對話框留下', async () => {
    const { global } = await setup('/content/campus-faq')
    const saveDraft = vi.fn(async () => true)
    const guard = mountGuard(global, saveDraft)

    const confirm = pressInDialog('confirm')
    expect(await guard().confirmLeave({ allowSave: true })).toBe(true)
    expect(saveDraft).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '儲存草稿並離開', cancelButtonText: '放棄修改', distinguishCancelAndClose: true })

    saveDraft.mockResolvedValueOnce(false)
    expect(await guard().confirmLeave({ allowSave: true })).toBe(false)

    vi.restoreAllMocks()
    pressInDialog('cancel')
    expect(await guard().confirmLeave({ allowSave: true })).toBe(true)
    vi.restoreAllMocks()
    pressInDialog('close')
    expect(await guard().confirmLeave({ allowSave: true })).toBe(false)
  })

  it('切校（不帶 allowSave）維持兩個選項，不存草稿', async () => {
    const { global } = await setup('/content/campus-faq')
    const saveDraft = vi.fn(async () => true)
    const guard = mountGuard(global, saveDraft)
    const confirm = pressInDialog('confirm')
    expect(await guard().confirmLeave()).toBe(true)
    expect(saveDraft).not.toHaveBeenCalled()
    expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '放棄修改', cancelButtonText: '留在這頁' })
  })
})
