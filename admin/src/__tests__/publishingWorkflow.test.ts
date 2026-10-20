// 發布與審核（2026-09-25 補齊）：版本紀錄的曾上線與審核狀態、巢狀差異摘要、
// 全站發布紀錄與整站還原、全站排程、給自己的內容通知、總覽的待發布與素材
// 提示、建議字數，以及後端新代碼都有中文標籤。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref, render, h, type VNode } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, isNavigationFailure, NavigationFailureType } from 'vue-router'
import ElementPlus, { ElMessageBox, ElMessage } from 'element-plus'
import RevisionHistoryDrawer from '../components/RevisionHistoryDrawer.vue'
import ContentEditor from '../components/ContentEditor.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import PublishHistoryView from '../views/PublishHistoryView.vue'
import DashboardView from '../views/DashboardView.vue'
import { api, ApiError } from '../api/client'
import { contentEditorPath, contentItemLabel, contentPreviewPath, PUBLISH_JOB_STATUS, RELEASE_SOURCE_LABELS, REVIEW_STATUS_LABELS, USER_NOTIFICATION_LABELS, releaseSourceLabel } from '../api/labels'
import { diffPayload, nestedChangeDetail, useContentItem, type ContentEditorState, type RevisionHistoryHandle, type FieldChange, type PublishJob } from '../composables/useContentItem'
import { lengthHintText, LENGTH_HINTS, textLength } from '../composables/contentHints'
import { useCampusContent } from '../composables/useCampusContent'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { navItem } from '../router/nav'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'
import CampusSelect from '../components/CampusSelect.vue'
import editorSource from '../components/ContentEditor.vue?raw'
import publishHistorySource from '../views/PublishHistoryView.vue?raw'
import { contentFieldLabelFor } from '../api/contentFieldLabels'

if (typeof (globalThis.localStorage as Storage | undefined)?.getItem !== 'function') {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  })
}

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function setup(path = '/', user: UserOut = testUser('super_admin', { campus_keys: ['yihua', 'renwu'] })) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  return { pinia, router, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } }
}

function confirmYes() {
  return vi
    .spyOn(ElMessageBox, 'confirm')
    .mockReturnValue(Promise.resolve({ value: '', action: 'confirm' }) as unknown as ReturnType<typeof ElMessageBox.confirm>)
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((b) => b.text().trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found
}

describe('巢狀內容的差異摘要（第 59 條）', () => {
  it('有 id 的清單分得出新增、刪除與修改的是哪幾項', () => {
    const before = [
      { id: 'a', title: '開學典禮', description: '舊' },
      { id: 'b', title: '親子日', description: '同' },
    ]
    const after = [
      { id: 'a', title: '開學典禮', description: '新' },
      { id: 'c', title: '畢業典禮', description: '' },
    ]
    expect(nestedChangeDetail(before, after)).toBe('新增「畢業典禮」；刪除「親子日」；修改「開學典禮」')
    const [change] = diffPayload({ articles: before }, { articles: after })
    expect(change).toMatchObject({ label: '最新消息', before: '2 項', after: '2 項', detail: '新增「畢業典禮」；刪除「親子日」；修改「開學典禮」' })
  })

  it('沒有 id 的清單依位置比，用標題當名字；只換順序也講出來', () => {
    expect(nestedChangeDetail([{ title: '幾歲入園？', note: '2 歲' }], [{ title: '幾歲入園？', note: '3 歲' }, { title: '有校車嗎？', note: '有' }]))
      .toBe('新增「有校車嗎？」；修改「幾歲入園？」')
    expect(nestedChangeDetail([{ id: 'x', title: 'X' }, { id: 'y', title: 'Y' }], [{ id: 'y', title: 'Y' }, { id: 'x', title: 'X' }]))
      .toBe('調整了順序')
    expect(nestedChangeDetail([], [{}])).toBe('新增 第 1 項')
  })

  describe('沒有 id 的清單用標題對應同一項（隱私權政策的段落，T8b）', () => {
    const section = (heading: string, body = `${heading}的內容`) => ({ heading, body })
    const three = [section('蒐集的資料'), section('利用方式'), section('您的權利')]

    it('刪掉中間一段：只標被刪的那一段，後面的段落不會因為位置前移被標成修改', () => {
      const after = [three[0], three[2]]
      expect(nestedChangeDetail(three, after)).toBe('刪除「利用方式」')
      const [change] = diffPayload({ sections: three }, { sections: after })
      expect(change).toMatchObject({ before: '3 項', after: '2 項', detail: '刪除「利用方式」' })
    })

    it('在中間插入一段、刪掉第一段、刪掉最後一段，都只標動到的那一段', () => {
      expect(nestedChangeDetail(three, [three[0], section('保存期間'), three[1], three[2]])).toBe('新增「保存期間」')
      expect(nestedChangeDetail(three, [three[1], three[2]])).toBe('刪除「蒐集的資料」')
      expect(nestedChangeDetail(three, [three[0], three[1]])).toBe('刪除「您的權利」')
    })

    it('改某一段的內文只標那一段；改標題算修改（夾在對得上的段落之間依順序對應），不是新增加刪除', () => {
      expect(nestedChangeDetail(three, [three[0], section('利用方式', '改過的內文'), three[2]])).toBe('修改「利用方式」')
      expect(nestedChangeDetail(three, [three[0], section('資料的利用', three[1]!.body), three[2]])).toBe('修改「資料的利用」')
    })

    it('刪掉一段的同時改另一段的內文：各自標出來', () => {
      const four = [...three, section('聯絡我們')]
      expect(nestedChangeDetail(four, [four[0], four[2], section('聯絡我們', '新的聯絡方式')])).toBe('刪除「利用方式」；修改「聯絡我們」')
    })

    it('只調換順序：講調整了順序，不是每一段都改了', () => {
      expect(nestedChangeDetail(three, [three[2], three[0], three[1]])).toBe('調整了順序')
    })

    it('標題重複（分不出是哪一段）或沒有標題：退回依順序對應（原本的行為）', () => {
      const dup = [section('說明', '甲'), section('說明', '乙'), section('說明', '丙')]
      // 刪掉中間那段，但標題都一樣：只能依位置比，第二段變成「丙」、最後一段不見了
      expect(nestedChangeDetail(dup, [dup[0], dup[2]])).toBe('刪除「說明」；修改「說明」')
      const untitled = [{ body: 'a' }, { body: 'b' }, { body: 'c' }]
      expect(nestedChangeDetail(untitled, [untitled[0], untitled[2]])).toBe('刪除 第 3 項；修改 第 2 項')
    })

    it('有 id 的項目不和別項配對：對不上就是新增與刪除', () => {
      expect(nestedChangeDetail([{ id: 'a', heading: 'X' }, { id: 'b', heading: 'Y' }], [{ id: 'a', heading: 'X' }, { id: 'c', heading: 'Z' }])).toBe('新增「Z」；刪除「Y」')
    })
  })

  it('超過三項時列前三項加總數；物件列出改了哪些欄位；純文字清單不另外摘要', () => {
    const many = ['一', '二', '三', '四'].map((title, i) => ({ id: String(i), title }))
    expect(nestedChangeDetail([], many)).toBe('新增「一」、「二」、「三」 等 4 項')
    expect(nestedChangeDetail({ title: 'a', note: 'b' }, { title: 'a', note: 'c' })).toBe('修改 說明文字')
    const [lines] = diffPayload({ copy_lines: ['a'] }, { copy_lines: ['b'] })
    expect(lines!.detail).toBeUndefined()
  })
})

describe('版本紀錄抽屜顯示曾上線與審核狀態（第 59 條）', () => {
  it('標出官網目前版本、曾上線（含最後上線時間）、待審核、已退回與原因', async () => {
    const handle: RevisionHistoryHandle = {
      list: vi.fn(async () => [
        { id: 'r4', version: 4, created_at: '2026-09-25T02:00:00Z', created_by_email: 'ed@ivy.example', is_published: false, ever_published: false, last_published_at: null, review_status: 'rejected', review_note: '請補電話' },
        { id: 'r3', version: 3, created_at: '2026-09-24T02:00:00Z', created_by_email: 'ed@ivy.example', is_published: false, ever_published: false, last_published_at: null, review_status: 'superseded', review_note: null },
        { id: 'r2', version: 2, created_at: '2026-09-23T02:00:00Z', created_by_email: 'amy@ivy.example', is_published: true, ever_published: true, last_published_at: '2026-09-23T03:00:00Z', review_status: 'approved', review_note: null },
        { id: 'r1', version: 1, created_at: '2026-09-20T02:00:00Z', created_by_email: 'amy@ivy.example', is_published: false, ever_published: true, last_published_at: '2026-09-21T01:00:00Z', review_status: 'draft', review_note: null },
      ]),
      payloadOf: vi.fn(async () => ({})),
      savedPayload: () => ({}),
      restore: vi.fn(async () => true),
    }
    const wrapper = mount(RevisionHistoryDrawer, {
      props: { history: handle, dirty: false, busy: false, modelValue: false },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const items = [...document.body.querySelectorAll('.history__item')].map((el) => el.textContent ?? '')
    expect(items[0]).toContain('已退回')
    expect(items[0]).toContain('退回原因：請補電話')
    expect(items[0]).toContain('最新草稿')
    expect(items[1]).toContain('已被新版取代')
    expect(items[2]).toContain('官網目前版本')
    expect(items[2]).toContain('上線於 2026/09/23')
    expect(items[3]).toContain('曾上線')
    expect(items[3]).toContain('最後上線 2026/09/21')
    expect(items[3]).not.toContain('官網目前版本')
  })
})

describe('內容編輯頁的排程結果與預覽（第 54、57 條）', () => {
  function editorState(overrides: Partial<ContentEditorState> = {}): ContentEditorState {
    return {
      loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
      isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-09-25T02:00:00Z'),
      previewUrl: computed(() => 'https://example.test/preview?page=campus&campus=yihua'),
      load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
      ...overrides,
    }
  }

  it('最近一次排程略過時寫出原因與全站排程連結；提供手機版預覽連結', async () => {
    const { global } = await setup('/content/campus-news')
    const schedules = ref([
      { id: 'j2', revision_id: 'r1', revision_version: 1, publish_at: '2026-09-25T01:00:00Z', status: 'skipped' as const, error: '排好之後官網已經發布過較新的第 2 版，不會把第 1 版蓋回去', created_by_email: null, finished_at: '2026-09-25T01:00:10Z' },
      { id: 'j1', revision_id: 'r1', revision_version: 1, publish_at: '2026-09-20T01:00:00Z', status: 'done' as const, error: null, created_by_email: null, finished_at: '2026-09-20T01:00:10Z' },
    ])
    const wrapper = mount(ContentEditor, { props: { editor: editorState({ schedules, loadSchedules: async () => {} }) }, global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('的排程已略過：排好之後官網已經發布過較新的第 2 版')
    expect(wrapper.find('.editor__schedules-all').attributes('href')).toBe('/releases?tab=schedules')
    const mobile = wrapper.findAll('a').find((a) => a.text() === '手機版 ↗')!
    expect(mobile.attributes('href')).toBe('https://example.test/preview?page=campus&campus=yihua&viewport=mobile')
  })

  it('核准送審版先列出和官網目前版本的欄位差異，欄位名和表單一致', async () => {
    const { global } = await setup('/content/campus-profile')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const review = vi.fn(async () => true)
    // 差異清單的欄位名依內容種類對應表單（intro 在分校介紹叫「一句話簡介」，不是通用的「前言」）。
    const compareWithLive = vi.fn(async () => ({ firstPublish: false, changes: diffPayload({ intro: '舊簡介', description: '同' }, { intro: '新簡介', description: '同' }, 'campus_profile') }))
    const wrapper = mount(ContentEditor, {
      props: { editor: editorState({ reviewStatus: computed(() => 'pending_review'), review, compareWithLive }) },
      global,
    })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '核准並發布')!.trigger('click')
    await flushPromises()
    expect(compareWithLive).toHaveBeenCalledOnce()
    const [message, title, options] = confirm.mock.calls[0]!
    const body = document.createElement('div')
    render(message as never, body)
    expect(title).toContain('核准並發布')
    expect(body.textContent).toContain('一句話簡介')
    expect(body.textContent).toContain('舊簡介')
    expect(body.textContent).toContain('新簡介')
    expect(body.textContent).not.toContain('前言')
    expect(options).toMatchObject({ confirmButtonText: '核准並發布', cancelButtonText: '先不要' })
    expect(review).not.toHaveBeenCalled()
  })

  it('之後又成功發布過，就不再提舊的失敗', async () => {
    const { global } = await setup('/content/campus-news')
    const schedules = ref([
      { id: 'j2', revision_id: 'r2', revision_version: 2, publish_at: '2026-09-25T01:00:00Z', status: 'done' as const, error: null, created_by_email: null, finished_at: null },
      { id: 'j1', revision_id: 'r1', revision_version: 1, publish_at: '2026-09-20T01:00:00Z', status: 'failed' as const, error: '素材還沒處理好', created_by_email: null, finished_at: null },
    ])
    const wrapper = mount(ContentEditor, { props: { editor: editorState({ schedules, loadSchedules: async () => {} }) }, global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).not.toContain('素材還沒處理好')
  })

  it('排程失敗之後官網換過版本或有人按了「知道了」（resolved），就不再提示（B06-5）', async () => {
    const { global } = await setup('/content/campus-news')
    const schedules = ref([
      { id: 'j1', revision_id: 'r1', revision_version: 1, publish_at: '2026-09-20T01:00:00Z', status: 'failed' as const, error: '分校已停用，內容不會發布', created_by_email: null, finished_at: '2026-09-20T01:00:10Z', resolved: true },
    ])
    const wrapper = mount(ContentEditor, { props: { editor: editorState({ schedules, loadSchedules: async () => {} }) }, global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).not.toContain('分校已停用')
  })

  it('能發布的人可以把沒有發布的排程標成「知道了」；內容編輯看不到按鈕（B06-6）', async () => {
    const failed = { id: 'j1', revision_id: 'r1', revision_version: 1, publish_at: '2026-09-20T01:00:00Z', status: 'failed' as const, error: '分校已停用，內容不會發布', created_by_email: null, finished_at: '2026-09-20T01:00:10Z', resolved: false }
    const schedules = ref([failed])
    const acknowledgeSchedule = vi.fn(async (jobId: string) => {
      schedules.value = schedules.value.map((job) => (job.id === jobId ? { ...job, resolved: true } : job))
      return true
    })
    const { global } = await setup('/content/campus-news')
    const wrapper = mount(ContentEditor, { props: { editor: editorState({ schedules, loadSchedules: async () => {}, acknowledgeSchedule }) }, global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('的排程沒有發布：分校已停用，內容不會發布')
    await button(wrapper, '知道了').trigger('click')
    await flushPromises()
    expect(acknowledgeSchedule).toHaveBeenCalledWith('j1')
    expect(wrapper.text()).not.toContain('分校已停用')

    const editor = await setup('/content/campus-news', testUser('editor', { campus_keys: ['yihua'] }))
    const readOnlyView = mount(ContentEditor, {
      props: { editor: editorState({ schedules: ref([failed]), loadSchedules: async () => {}, acknowledgeSchedule }) },
      global: editor.global,
    })
    wrappers.push(readOnlyView)
    await flushPromises()
    expect(readOnlyView.text()).toContain('分校已停用')
    expect(readOnlyView.findAll('button').some((b) => b.text().trim() === '知道了')).toBe(false)
  })

  it('發布成功後重讀排程，已處理的失敗提示跟著消失；「知道了」打對的 API（B06-5、B06-6）', async () => {
    const { global } = await setup('/content/campus-news')
    const item = { id: 'i1', kind: 'campus_news', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1', latest_revision: { id: 'r2', version: 2, created_at: '2026-09-25T02:00:00Z', payload: { title: '' } } }
    const get = vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/schedules') ? [] : item)) as typeof api.get)
    const post = vi.spyOn(api, 'post').mockImplementation(((path: string) =>
      Promise.resolve(path.endsWith('/publish?campus_key=yihua') ? { ...item, current_published_revision_id: 'r2' } : {})) as typeof api.post)
    let editor!: ReturnType<typeof useContentItem<{ title: string }>>
    const Harness = defineComponent({ setup() { editor = useContentItem('campus_news', { title: '' }, 'yihua'); return () => null } })
    wrappers.push(mount(Harness, { global }))
    await editor.load()
    get.mockClear()
    expect(await editor.publish()).toBe(true)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_news/schedules?campus_key=yihua')
    // 樂觀鎖：帶上載入時官網的版本，別人之後發布過就會被後端 409 擋下。
    expect(post).toHaveBeenCalledWith('/admin/content-items/campus_news/publish?campus_key=yihua', {
      revision_id: 'r2',
      expected_published_revision_id: 'r1',
    })

    get.mockClear()
    expect(await editor.acknowledgeSchedule('j1')).toBe(true)
    expect(post).toHaveBeenLastCalledWith('/admin/content-items/campus_news/schedules/j1/acknowledge?campus_key=yihua')
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_news/schedules?campus_key=yihua')
  })

  // 2026-10-13：後端存的是正規化過的內容（去掉前後空白）。快照要用它，不然發布後一直顯示「1 處修改」。
  it('儲存後表單與快照換成後端存下的內容；送出後又改的不蓋掉', async () => {
    const { global } = await setup('/content/campus-news')
    const item = { id: 'i1', kind: 'campus_news', campus_key: 'yihua', latest_version: 1, current_published_revision_id: null, latest_revision: { id: 'r1', version: 1, created_at: '2026-10-13T02:00:00Z', payload: { title: '舊' } } }
    vi.spyOn(api, 'get').mockImplementation(((path: string) => Promise.resolve(path.includes('/schedules') ? [] : item)) as typeof api.get)
    const trimmed = (version: number, title: string) => ({ ...item, latest_version: version, latest_revision: { ...item.latest_revision, id: `r${version}`, version, payload: { title } } })
    let editor!: ReturnType<typeof useContentItem<{ title: string }>>
    const Harness = defineComponent({ setup() { editor = useContentItem('campus_news', { title: '' }, 'yihua'); return () => null } })
    wrappers.push(mount(Harness, { global }))
    await editor.load()

    vi.spyOn(api, 'post').mockResolvedValueOnce(trimmed(2, '樂樂媽咪') as never)
    editor.form.value = { title: '樂樂媽咪 ' }
    expect(await editor.save({ silent: true })).toBe(true)
    expect(editor.form.value).toEqual({ title: '樂樂媽咪' })
    expect(editor.isDirty.value).toBe(false)

    // 回應回來之前又改了：保留新改的字，算未儲存的修改
    let resolve!: (value: unknown) => void
    vi.spyOn(api, 'post').mockImplementationOnce((() => new Promise<unknown>((r) => { resolve = r })) as typeof api.post)
    editor.form.value = { title: '新稱呼 ' }
    const saving = editor.save({ silent: true })
    editor.form.value = { title: '又改了' }
    resolve(trimmed(3, '新稱呼'))
    expect(await saving).toBe(true)
    expect(editor.form.value).toEqual({ title: '又改了' })
    expect(editor.isDirty.value).toBe(true)
  })

  // 2026-10-08：已拿掉的欄位（例如五校介紹的簡介）還原時後端會丟掉，版本紀錄不能列成「還原後會改回舊值」。
  it('版本紀錄的差異兩邊都先經過 normalize：已拿掉的欄位不列成會改變', async () => {
    const { global } = await setup('/content/campus-profile')
    const item = { id: 'i1', kind: 'campus_profile', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r2', latest_revision: { id: 'r2', version: 2, created_at: '2026-10-08T02:00:00Z', payload: { name: '義華校', phone: '07-1' } } }
    vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/revisions/r1')
        ? { id: 'r1', version: 1, payload: { name: '義華校', phone: '07-0', intro: '舊簡介' } }
        : path.includes('/schedules') ? [] : item)) as typeof api.get)
    const dropIntro = (payload: { name: string; phone: string; intro?: string }) => {
      const { intro: _retired, ...rest } = payload
      return rest
    }
    let editor!: ReturnType<typeof useContentItem<{ name: string; phone: string }>>
    const Harness = defineComponent({ setup() { editor = useContentItem('campus_profile', { name: '', phone: '' }, 'yihua', { normalize: dropIntro }); return () => null } })
    wrappers.push(mount(Harness, { global }))
    await editor.load()
    const changes = diffPayload(editor.history.savedPayload(), await editor.history.payloadOf('r1'), 'campus_profile')
    expect(changes.map((change) => change.key)).toEqual(['phone'])
  })

  it('預約文案可以預覽預約頁；內容連結帶校區', () => {
    expect(contentPreviewPath('booking_content')).toBe('/preview?page=visit')
    expect(contentEditorPath('campus_news', 'yihua')).toBe('/content/campus-news?campus=yihua')
    expect(contentEditorPath('admission_content')).toBe('/content/admission')
    expect(contentItemLabel('campus_news', 'yihua')).toBe('各校消息與活動（義華）')
  })
})

function release(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, created_at: '2026-09-25T02:00:00Z', created_by_email: 'amy@ivy.example', source: 'publish',
    restored_from_release_id: null, is_current: false, changes: [], ...overrides,
  }
}

function notice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, kind: 'content_review_rejected', campus_key: 'yihua', content_kind: 'campus_news', revision_version: 3,
    note: '請補電話', error: null, publish_at: null, actor_email: 'amy@ivy.example', created_at: '2026-09-25T02:00:00Z', read_at: null,
    ...overrides,
  }
}

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, kind: 'campus_news', campus_key: 'yihua', revision_id: 'r1', revision_version: 2, publish_at: '2026-09-26T01:00:00Z',
    status: 'scheduled', error: null, created_by_email: 'amy@ivy.example', created_at: '2026-09-25T01:00:00Z', finished_at: null,
    can_cancel: true, ...overrides,
  }
}

function mockPublishingApi(data: { releases?: unknown[]; nextBefore?: string | null; jobs?: unknown[]; notices?: unknown[] } = {}) {
  return vi.spyOn(api, 'get').mockImplementation((url) => {
    const path = String(url)
    if (path.startsWith('/admin/releases')) return Promise.resolve({ items: data.releases ?? [], next_before: data.nextBefore ?? null }) as Promise<never>
    if (path.startsWith('/admin/publish-jobs')) return Promise.resolve(data.jobs ?? []) as Promise<never>
    if (path.startsWith('/admin/my-notifications')) return Promise.resolve(data.notices ?? []) as Promise<never>
    return Promise.resolve({}) as Promise<never>
  })
}

describe('發布紀錄頁（第 56 條）', () => {
  it('側欄在官網內容區有「發布紀錄」，看得到內容的角色都能進', () => {
    const item = navItem('releases')!
    expect(item.path).toBe('/releases')
    expect(item.roles).toEqual(['super_admin', 'campus_admin', 'editor', 'readonly'])
  })

  it('列出每次發布換掉的內容與版本；總管理者可以整站還原，帶上目前版本', async () => {
    const releases = [
      release('now', { is_current: true, source: 'release_restore', restored_from_release_id: 'old', changes: [
        { content_item_id: 'i1', kind: 'home_about', campus_key: null, revision_id: 'r1', revision_version: 1, previous_revision_version: 2 },
      ] }),
      release('mid', { source: 'review', changes: [
        { content_item_id: 'i1', kind: 'home_about', campus_key: null, revision_id: 'r2', revision_version: 2, previous_revision_version: 1 },
      ] }),
      release('old', { created_at: '2026-09-20T02:00:00Z', source: 'initialize', changes: [
        { content_item_id: 'i2', kind: 'campus_news', campus_key: 'yihua', revision_id: 'r9', revision_version: 1, previous_revision_version: null },
      ] }),
    ]
    mockPublishingApi({ releases })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ release: releases[0], changed_count: 1, kept_count: 2 } as never)
    const confirm = confirmYes()
    const { global } = await setup('/releases')
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('官網目前版本')
    expect(text).toContain('還原成 2026/09/20 10:00 那次發布的內容')
    expect(text).toContain('內容已更新')
    expect(text).not.toContain('第 2 版')
    expect(text).toContain('核准送審並發布')
    expect(text).toContain('第一次上線')
    expect(wrapper.find('a[href="/content/campus-news?campus=yihua"]').exists()).toBe(true)
    // 目前這一筆沒有還原鈕，其他兩筆有。
    expect(wrapper.findAll('button').filter((b) => b.text() === '整站還原到這次')).toHaveLength(2)

    await wrapper.findAll('button').filter((b) => b.text() === '整站還原到這次')[1]!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledWith('/admin/releases/old/restore', { expected_current_release_id: 'now' })
  })

  it('分校管理者看不到整站還原', async () => {
    mockPublishingApi({ releases: [release('now', { is_current: true }), release('old')] })
    const { global } = await setup('/releases', testUser('campus_admin', { campus_keys: ['yihua'] }))
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).not.toContain('整站還原到這次')
    expect(wrapper.text()).toContain('你只看得到自己負責的校區與共用內容')
  })

  it('還原不了時列出哪幾項不能發布，並重新讀取紀錄', async () => {
    const get = mockPublishingApi({ releases: [release('now', { is_current: true }), release('old')] })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, {
      code: 'RELEASE_NOT_RESTORABLE',
      message: '有些內容的舊版本現在不能發布，整站沒有變動',
      items: [{ kind: 'campus_tour', campus_key: 'yihua', message: '這一版的欄位格式已經過時，請到編輯頁手動修改後再發布' }],
    }))
    confirmYes()
    const alert = vi.spyOn(ElMessageBox, 'alert').mockResolvedValue({ action: 'confirm' } as never)
    const { global } = await setup('/releases')
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    await button(wrapper, '整站還原到這次').trigger('click')
    await flushPromises()
    expect(String(alert.mock.calls[0]![0])).toContain('校園探索（義華）：這一版的欄位格式已經過時')
    expect(get.mock.calls.filter(([url]) => String(url).startsWith('/admin/releases'))).toHaveLength(2)
  })

  it('載入更早的紀錄時帶 before', async () => {
    const get = mockPublishingApi({ releases: [release('a')], nextBefore: '2026-09-01T00:00:00Z' })
    const { global } = await setup('/releases')
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    await button(wrapper, '載入更早的紀錄').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/releases?limit=30&before=2026-09-01T00%3A00%3A00Z')
  })

  it('排程分頁列出等待中與已結束的排程，取消時帶校區', async () => {
    mockPublishingApi({ jobs: [
      job('j1'),
      job('j2', { can_cancel: false, kind: 'home_about', campus_key: null }),
      job('j3', { status: 'skipped', error: '官網已經是這一版，不需要再發布' }),
      job('j4', { status: 'failed', error: '分校已停用，內容不會發布' }),
    ] })
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    confirmYes()
    const { global } = await setup('/releases?tab=schedules')
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('等待發布（2）')
    expect(text).toContain('已略過')
    expect(text).toContain('沒有發布')
    expect(text).toContain('分校已停用，內容不會發布')
    // 沒有發布權限的那一筆沒有取消鈕。
    expect(wrapper.findAll('button').filter((b) => b.text() === '取消排程')).toHaveLength(1)
    await button(wrapper, '取消排程').trigger('click')
    await flushPromises()
    expect(del).toHaveBeenCalledWith('/admin/content-items/campus_news/schedules/j1?campus_key=yihua')
  })

  it('給自己的通知：顯示退回原因與連結，標記已讀後未讀數跟著減', async () => {
    mockPublishingApi({ notices: [notice('n1'), notice('n2', { kind: 'content_schedule_failed', note: null, error: '素材還沒處理好', publish_at: '2026-09-25T01:00:00Z', actor_email: null, read_at: '2026-09-25T03:00:00Z' })] })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...notice('n1'), read_at: '2026-09-25T04:00:00Z' } as never)
    const { global } = await setup('/releases', testUser('editor', { campus_keys: ['yihua'] }))
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('給你的通知（1 則未讀）')
    expect(text).toContain('你送審的內容被退回')
    expect(text).toContain('退回原因：請補電話')
    expect(text).toContain('排程發布沒有執行')
    expect(text).toContain('素材還沒處理好')
    expect(wrapper.find('a[href="/content/campus-news?campus=yihua"]').exists()).toBe(true)
    await button(wrapper, '標記已讀').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/my-notifications/n1/read')
    expect(wrapper.text()).not.toContain('則未讀')
  })

  it('側欄「發布紀錄」不掛數字：未讀的內容通知看這一頁（側欄只有參觀案件掛數字）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ my_unread_notifications: 3 } as never)
    const { global, pinia } = await setup('/', testUser('editor', { campus_keys: ['yihua'] }))
    useOpenRequestsStore(pinia).apply({ my_unread_notifications: 3 } as never)
    const wrapper = mount(AdminSidebar, { global })
    wrappers.push(wrapper)
    await flushPromises()
    const link = wrapper.findAll('a').find((a) => a.text().includes('發布紀錄'))!
    expect(link.text()).toBe('發布紀錄')
    expect(wrapper.find('.sidebar__badge').exists()).toBe(false)
  })
})

describe('總覽的待發布、素材與排程失敗（第 54、58 條）', () => {
  it('列出最新版比官網新的內容、缺少素材與沒有執行的排程，連結帶校區', async () => {
    const { global } = await setup('/')
    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (String(url) === '/admin/dashboard') {
        return Promise.resolve({
          today_visits: 0, pending_follow_up: 0, campuses_without_active_booking: [], failed_notifications: 0,
          pending_publish: 2, pending_publish_kinds: ['campus_news', 'home_about'],
          pending_publish_items: [
            { kind: 'home_about', campus_key: null, latest_version: 5, published_version: 4, updated_at: '2026-09-25T02:00:00Z' },
            { kind: 'campus_news', campus_key: 'renwu', latest_version: 1, published_version: null, updated_at: '2026-09-24T02:00:00Z' },
          ],
          content_media_issues: [{ kind: 'campus_tour', campus_key: 'yihua', missing: 1, not_ready: 0, live: true }],
          failed_publish_jobs: [{ id: 'j1', kind: 'home_news', campus_key: null, revision_version: 3, publish_at: '2026-09-25T01:00:00Z', error: '素材還沒處理好' }],
        }) as Promise<never>
      }
      return Promise.resolve([]) as Promise<never>
    })
    const wrapper = mount(DashboardView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    const text = wrapper.text()
    // 不寫版本號：只說有沒有發布過、什麼時候存的（台北時間）。
    expect(text).toContain('有修改尚未發布・09/25 10:00 儲存')
    expect(text).toContain('從未發布・09/24 10:00 儲存')
    expect(text).not.toMatch(/第 \d+ 版/)
    expect(wrapper.find('a[href="/content/campus-news?campus=renwu"]').exists()).toBe(true)
    expect(text).toContain('內容缺少素材或素材還沒處理好')
    expect(text).toContain('官網上1 個已刪除')
    expect(wrapper.find('a[href="/content/campus-tour?campus=yihua"]').exists()).toBe(true)
    expect(text).toContain('排程發布沒有執行')
    expect(text).toContain('排定 09/25 09:00 發布的草稿沒有執行：素材還沒處理好')
    expect(text).not.toContain('目前沒有待處理事項')
  })
})

describe('建議字數（第 57 條）', () => {
  it('以字元計，超過時講出在官網上的後果', () => {
    expect(textLength('孩子👋')).toBe(3)
    expect(lengthHintText('', LENGTH_HINTS.newsTitle).text).toBe('建議 24 字內')
    expect(lengthHintText('短標題', LENGTH_HINTS.newsTitle)).toEqual({ text: '3 字・建議 24 字內', over: false })
    const over = lengthHintText('字'.repeat(30), LENGTH_HINTS.newsTitle)
    expect(over.over).toBe(true)
    expect(over.text).toContain('卡片標題會被截斷')
  })
})

describe('從總覽或通知帶 ?campus= 進編輯頁', () => {
  it('在自己的範圍內就切到那一校，範圍外的忽略', async () => {
    for (const [query, expected] of [['yihua', 'yihua'], ['minghua', 'renwu']] as const) {
      // 上一輪選過的校區會記在 sessionStorage（分校內容頁共用），這裡只測網址。
      sessionStorage.clear()
      const { global } = await setup(`/content/campus-news?campus=${query}`, testUser('campus_admin', { campus_keys: ['renwu', 'yihua'] }))
      let picked = ''
      const Probe = defineComponent({
        setup() {
          const campus = ref('')
          const editorState = { load: async () => {}, isDirty: computed(() => false) } as unknown as ContentEditorState
          useCampusContent(editorState, campus, ref(null))
          picked = campus.value
          return () => null
        },
      })
      wrappers.push(mount(Probe, { global }))
      expect(picked).toBe(expected)
    }
  })
})

// 後端新代碼都要有中文：審核狀態、排程狀態、發布來源、個人通知 kind。
const backendSources = import.meta.glob('../../../backend/app/content/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
function source(path: string): string {
  const key = Object.keys(backendSources).find((k) => k.endsWith(path))
  if (!key) throw new Error(`找不到後端檔案 ${path}`)
  return backendSources[key]!
}

describe('發布流程的代碼都有中文標籤', () => {
  it('審核狀態、發布來源、個人通知', () => {
    const statuses = source('content/models.py').match(/REVIEW_STATUSES = \(([^)]*)\)/)![1]!.match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1))
    expect(statuses.filter((s) => !REVIEW_STATUS_LABELS[s])).toEqual([])
    const releaseBlock = source('content/models.py').split('class ReleaseSource')[1]!.split('class SiteRelease')[0]!
    const sources = [...releaseBlock.matchAll(/= "([^"]+)"/g)].map((m) => m[1]!)
    expect(sources.length).toBeGreaterThan(3)
    expect(sources.filter((s) => !RELEASE_SOURCE_LABELS[s])).toEqual([])
    const kinds = [...source('content/notices.py').matchAll(/^[A-Z_]+ = "([a-z_]+)"$/gm)].map((m) => m[1]!)
    expect(kinds.length).toBe(5)
    expect(kinds.filter((k) => !USER_NOTIFICATION_LABELS[k])).toEqual([])
    for (const status of ['scheduled', 'done', 'failed', 'skipped', 'cancelled']) expect(PUBLISH_JOB_STATUS[status]).toBeDefined()
  })
})

// ---- 併自 ux20260928D.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-09-28 內容編輯外殼 UX 修正：狀態點依狀態上色、發布與核准列出和官網的
// 差異、動作列主色給真正的下一步、兩段動作只跳一則 toast、放棄修改要確認、
// 校區留在網址、排程說明、版本紀錄主次，以及發布紀錄的手機還原鈕與初始化標籤。
describe('2026-09-28 內容編輯外殼 UX（D）', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => {
    wrappers.forEach((wrapper) => wrapper.unmount())
    wrappers.length = 0
    vi.restoreAllMocks()
    sessionStorage.clear()
    document.body.innerHTML = ''
  })

  async function setup(path = '/content/campus-news', user: UserOut = testUser('super_admin')) {
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

  interface CampusDoc { title: string; note: string }

  function campusItem(overrides: Record<string, unknown> = {}, revision: Record<string, unknown> = {}) {
    return {
      id: 'i1', kind: 'campus_news', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1',
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
    let editor!: ReturnType<typeof useContentItem<CampusDoc>>
    const Page = defineComponent({
      setup() {
        editor = useContentItem<CampusDoc>('campus_news', { title: '', note: '' }, 'yihua')
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
      const get = mockContentApi(campusItem(), { r1: { title: '舊標題' } })
      const post = vi.spyOn(api, 'post').mockResolvedValue(campusItem({ current_published_revision_id: 'r2' }) as never)
      const confirm = confirmYes()
      const { wrapper } = mountPage(global)
      await flushPromises()
      // 2026-10-06 方向 D：載入時就讀官網版（動作列要列出和官網不同的欄位），開確認框不再重讀。
      expect(get).toHaveBeenCalledWith('/admin/content-items/campus_news/revisions/r1?campus_key=yihua')

      await button(wrapper, '發布到官網').trigger('click')
      await flushPromises()
      expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
      const [message, title] = confirm.mock.calls[0]!
      expect(title).toBe('發布「各校消息與活動（義華）」到官網？')
      const text = messageText(message)
      // 2026-10-06 方向 D：動作列已列出欄位，確認框只寫欄位名，不再列改前→改後。
      expect(text).toContain(`和官網目前的內容相比，會更新 1 個欄位：${contentFieldLabelFor('campus_news', 'title')}。`)
      expect(text).not.toContain('舊標題')
      // 舊版缺的 note 先補預設值才比，不會多出「（空白）→（空白）」。
      expect(text).not.toContain('（空白）')
      // 發布帶上載入時官網的版本（樂觀鎖，main 的 PR #14）。
      expect(post).toHaveBeenCalledWith('/admin/content-items/campus_news/publish?campus_key=yihua', {
        revision_id: 'r2',
        expected_published_revision_id: 'r1',
      })
    })

    it('已存草稿又有新修改：和官網比，已存與未存的修改都算進去；只跳最後一則 toast', async () => {
      const { global } = await setup()
      mockContentApi(campusItem(), { r1: { title: '舊標題', note: '' } })
      const saved = campusItem({ latest_version: 3 }, { id: 'r3', version: 3, payload: { title: '新標題', note: '補充說明' } })
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
      expect(post).toHaveBeenLastCalledWith('/admin/content-items/campus_news/publish?campus_key=yihua', {
        revision_id: 'r3',
        expected_published_revision_id: 'r1',
      })
      expect(success).not.toHaveBeenCalledWith('已儲存草稿，官網尚未更新')
    })

    it('從沒發布過就說是第一次上線，不拿空白比；有排程時提醒排程會略過', async () => {
      const { global } = await setup()
      const get = mockContentApi(campusItem({ current_published_revision_id: null }), {}, [scheduledJob()])
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
      mockContentApi(campusItem())
      const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
      const { wrapper } = mountPage(global)
      await flushPromises()
      await button(wrapper, '發布到官網').trigger('click')
      await flushPromises()
      expect(messageText(confirm.mock.calls[0]![0])).toContain('官網目前顯示的是上一版')
    })

    it('核准送審：列出送審版本和官網的差異，附預覽，標題寫出內容與校區', async () => {
      const { global } = await setup('/content/campus-news', testUser('campus_admin', { campus_keys: ['yihua'] }))
      mockContentApi(campusItem({}, { review_status: 'pending_review' }), { r1: { title: '舊標題', note: '' } })
      const post = vi.spyOn(api, 'post').mockResolvedValue(campusItem({ current_published_revision_id: 'r2' }, { review_status: 'approved' }) as never)
      const confirm = confirmYes()
      const { wrapper } = mountPage(global)
      await flushPromises()
      await button(wrapper, '核准並發布').trigger('click')
      await flushPromises()
      const [message, title] = confirm.mock.calls[0]!
      expect(title).toBe('核准並發布「各校消息與活動（義華）」？')
      const text = messageText(message)
      expect(text).toContain('和官網目前的內容相比，會更新 1 個欄位，核准後家長立刻看到')
      expect(text).toContain('舊標題')
      expect(text).toContain('預覽送審的內容 ↗')
      expect(post).toHaveBeenCalledWith('/admin/content-items/campus_news/review?campus_key=yihua', { revision_id: 'r2', decision: 'approve', note: null })
    })
  })

  describe('儲存並發布／送審／排程只跳最後結果那一則 toast', () => {
    async function loaded(user: UserOut = testUser('super_admin')) {
      const { global } = await setup('/content/campus-news', user)
      mockContentApi(campusItem())
      const page = mountPage(global)
      await flushPromises()
      page.editor().form.value.title = '改過的標題'
      return page.editor()
    }
    const savedItem = campusItem({ latest_version: 3 }, { id: 'r3', version: 3, payload: { title: '改過的標題', note: '' } })

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
      const { global } = await setup('/content/campus-news', testUser('editor', { campus_keys: ['yihua'] }))
      expect(primary(mountShell(global, editorState()))).toEqual(['送審'])
      expect(primary(mountShell(global, editorState({ reviewStatus: computed(() => 'pending_review') })))).toEqual([])
    })
  })

  describe('內容編輯看到的是送審說明', () => {
    it('草稿還沒送審、動作列講送審核准；共用內容寫總管理者核准', async () => {
      const { global } = await setup('/content/home-about', testUser('editor', { campus_keys: ['yihua'] }))
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
      const wrapper = mountShell(global, editorState({ isDirty: computed(() => true), changes, reset, contextLabel: computed(() => '各校消息與活動（義華）') }))
      expect(wrapper.findAll('button').some((b) => b.text().trim() === '還原修改')).toBe(false)
      // 不和儲存、發布擠在同一組按鈕裡。
      expect(wrapper.find('.editor__buttons .editor__discard').exists()).toBe(false)

      const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
      await button(wrapper, '放棄修改').trigger('click')
      await flushPromises()
      expect(reset).not.toHaveBeenCalled()
      const [message, title, options] = confirm.mock.calls[0]!
      expect(title).toBe('放棄 2 個欄位的修改？')
      expect(String(message)).toContain('「各校消息與活動（義華）」還沒儲存的修改會清掉')
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
      const { global, router } = await setup('/content/campus-news')
      const page = probe(global)
      await flushPromises()
      expect(page.campus.value).toBe('yihua')
      expect(router.currentRoute.value.fullPath).toBe('/content/campus-news?campus=yihua')

      page.campus.value = 'renwu'
      await flushPromises()
      expect(router.currentRoute.value.fullPath).toBe('/content/campus-news?campus=renwu')
      expect(page.load).toHaveBeenCalledTimes(2)

      await router.push('/content/campus-news?campus=minghua')
      await flushPromises()
      expect(page.campus.value).toBe('minghua')

      await router.push('/content/campus-tour')
      const tour = probe(global)
      await flushPromises()
      expect(tour.campus.value).toBe('minghua')
      expect(router.currentRoute.value.fullPath).toBe('/content/campus-tour?campus=minghua')
      // 前一頁（還掛著）不會跟著別頁的網址換校。
      expect(page.campus.value).toBe('minghua')
      await router.push('/content/campus-tour?campus=chongde')
      await flushPromises()
      expect(tour.campus.value).toBe('chongde')
      expect(page.campus.value).toBe('minghua')
    })

    it('有未儲存修改又選擇留下：取消這次換頁，校區和網址都不動、也不多一筆上一頁紀錄', async () => {
      const { global, router } = await setup('/content/campus-news?campus=renwu')
      const confirmLeave = vi.fn(async () => false)
      const page = probe(global, true, confirmLeave)
      await flushPromises()
      expect(page.campus.value).toBe('renwu')
      const replace = vi.spyOn(router, 'replace')
      const result = await router.push('/content/campus-news?campus=minghua')
      await flushPromises()
      expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
      expect(confirmLeave).toHaveBeenCalledOnce()
      expect(replace).not.toHaveBeenCalled()
      expect(page.campus.value).toBe('renwu')
      expect(router.currentRoute.value.fullPath).toBe('/content/campus-news?campus=renwu')
    })

    it('有未儲存修改但同意放棄：只問一次就換校', async () => {
      const { global, router } = await setup('/content/campus-news?campus=renwu')
      const confirmLeave = vi.fn(async () => true)
      const page = probe(global, true, confirmLeave)
      await flushPromises()
      await router.push('/content/campus-news?campus=minghua')
      await flushPromises()
      expect(confirmLeave).toHaveBeenCalledOnce()
      expect(page.campus.value).toBe('minghua')
      expect(page.load).toHaveBeenCalledTimes(2)
      expect(router.currentRoute.value.fullPath).toBe('/content/campus-news?campus=minghua')
    })

    it('從側欄再點同一頁（網址沒帶校區）：畫面停在目前的校區，網址補回 ?campus=', async () => {
      const { global, router } = await setup('/content/campus-news?campus=renwu')
      const page = probe(global)
      await flushPromises()
      await router.push('/content/campus-news')
      await flushPromises()
      expect(page.campus.value).toBe('renwu')
      expect(router.currentRoute.value.fullPath).toBe('/content/campus-news?campus=renwu')
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
      const item = campusItem({ latest_version: 4, current_published_revision_id: 'r3' }, { id: 'r4', version: 4, payload: { title: '草稿', note: '' } })
      const get = vi.spyOn(api, 'get').mockImplementation(((path: string) => {
        if (path.includes('/schedules')) return Promise.resolve([scheduledJob()])
        if (path.includes('/revisions/r3')) return Promise.resolve({ id: 'r3', version: 3, payload: { title: '官網', note: '' } })
        return Promise.resolve(item)
      }) as typeof api.get)
      const { wrapper, editor } = mountPage(global)
      await flushPromises()
      expect(get).toHaveBeenCalledWith('/admin/content-items/campus_news/revisions/r3?campus_key=yihua')
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
      const item = campusItem({ latest_version: 3, current_published_revision_id: 'r1' }, { id: 'r3', version: 3, payload: { title: '新標題', note: '' } })
      const get = mockContentApi(item, { r1: { title: '舊標題', note: '' } }, [scheduledJob()])
      vi.spyOn(api, 'post').mockResolvedValue({ ...item, current_published_revision_id: 'r3' } as never)
      const confirm = confirmYes()
      const { wrapper } = mountPage(global)
      await flushPromises()
      // 官網 r1 讀不到版號（mock 沒給）：不斷言一定會發布。
      expect(get).toHaveBeenCalledWith('/admin/content-items/campus_news/revisions/r1?campus_key=yihua')
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
    // 2026-10-05 第九輪：有修改時改給「存草稿並預覽」，不再並列改之前的已存草稿（見 adminUx.test.ts 的 2026-10-05 第九輪）。
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
        release('now', [change('cnews', 'campus_news', 'yihua', 5, 4), change('news', 'home_news', null, 2, null)], { is_current: true }),
        release('mid', [change('cnews', 'campus_news', 'yihua', 4, 3), change('hero', 'home_hero', null, 7, 6)]),
        release('back', [change('about', 'home_about', null, 3, 2)]),
        release('undo', [change('about', 'home_about', null, 2, 3)]),
        release('target', [change('cnews', 'campus_news', 'yihua', 3, 2)], { source: 'initialize' }),
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
      expect(message).toContain('預計換回 2 項：各校消息與活動（義華）、首頁大圖標語。')
      expect(message).not.toContain('最新消息與活動')
      expect(message).not.toContain('關於常春藤')
      expect(message).toContain('實際換回哪些以還原後的訊息為準')
    })
  })
})
