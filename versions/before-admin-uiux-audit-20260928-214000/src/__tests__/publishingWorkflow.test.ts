// 發布與審核（2026-09-25 補齊）：版本紀錄的曾上線與審核狀態、巢狀差異摘要、
// 全站發布紀錄與整站還原、全站排程、給自己的內容通知、總覽的待發布與素材
// 提示、建議字數，以及後端新代碼都有中文標籤。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import RevisionHistoryDrawer from '../components/RevisionHistoryDrawer.vue'
import ContentEditor from '../components/ContentEditor.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import PublishHistoryView from '../views/PublishHistoryView.vue'
import DashboardView from '../views/DashboardView.vue'
import { api, ApiError } from '../api/client'
import {
  contentEditorPath,
  contentItemLabel,
  contentPreviewPath,
  PUBLISH_JOB_STATUS,
  RELEASE_SOURCE_LABELS,
  REVIEW_STATUS_LABELS,
  USER_NOTIFICATION_LABELS,
} from '../api/labels'
import { diffPayload, nestedChangeDetail, useContentItem, type ContentEditorState, type RevisionHistoryHandle } from '../composables/useContentItem'
import { lengthHintText, LENGTH_HINTS, textLength } from '../composables/contentHints'
import { useCampusContent } from '../composables/useCampusContent'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { navItem } from '../router/nav'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

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

  it('沒有 id 的清單依位置比，用問題或標題當名字；只換順序也講出來', () => {
    expect(nestedChangeDetail([{ q: '幾歲入園？', a: '2 歲' }], [{ q: '幾歲入園？', a: '3 歲' }, { q: '有校車嗎？', a: '有' }]))
      .toBe('新增「有校車嗎？」；修改「幾歲入園？」')
    expect(nestedChangeDetail([{ id: 'x', title: 'X' }, { id: 'y', title: 'Y' }], [{ id: 'y', title: 'Y' }, { id: 'x', title: 'X' }]))
      .toBe('調整了順序')
    expect(nestedChangeDetail([], [{}])).toBe('新增 第 1 項')
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
    const { global } = await setup('/content/campus-faq')
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

  it('之後又成功發布過，就不再提舊的失敗', async () => {
    const { global } = await setup('/content/campus-faq')
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
    const { global } = await setup('/content/campus-faq')
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
    const { global } = await setup('/content/campus-faq')
    const wrapper = mount(ContentEditor, { props: { editor: editorState({ schedules, loadSchedules: async () => {}, acknowledgeSchedule }) }, global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('的排程沒有發布：分校已停用，內容不會發布')
    await button(wrapper, '知道了').trigger('click')
    await flushPromises()
    expect(acknowledgeSchedule).toHaveBeenCalledWith('j1')
    expect(wrapper.text()).not.toContain('分校已停用')

    const editor = await setup('/content/campus-faq', testUser('editor', { campus_keys: ['yihua'] }))
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
    const { global } = await setup('/content/campus-faq')
    const item = { id: 'i1', kind: 'campus_faq', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1', latest_revision: { id: 'r2', version: 2, created_at: '2026-09-25T02:00:00Z', payload: { title: '' } } }
    const get = vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      Promise.resolve(path.includes('/schedules') ? [] : item)) as typeof api.get)
    const post = vi.spyOn(api, 'post').mockImplementation(((path: string) =>
      Promise.resolve(path.endsWith('/publish?campus_key=yihua') ? { ...item, current_published_revision_id: 'r2' } : {})) as typeof api.post)
    let editor!: ReturnType<typeof useContentItem<{ title: string }>>
    const Harness = defineComponent({ setup() { editor = useContentItem('campus_faq', { title: '' }, 'yihua'); return () => null } })
    wrappers.push(mount(Harness, { global }))
    await editor.load()
    get.mockClear()
    expect(await editor.publish()).toBe(true)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/schedules?campus_key=yihua')

    get.mockClear()
    expect(await editor.acknowledgeSchedule('j1')).toBe(true)
    expect(post).toHaveBeenLastCalledWith('/admin/content-items/campus_faq/schedules/j1/acknowledge?campus_key=yihua')
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/schedules?campus_key=yihua')
  })

  it('預約文案可以預覽預約頁；內容連結帶校區', () => {
    expect(contentPreviewPath('booking_content')).toBe('/preview?page=visit')
    expect(contentEditorPath('campus_faq', 'yihua')).toBe('/content/campus-faq?campus=yihua')
    expect(contentEditorPath('admission_content')).toBe('/content/admission')
    expect(contentItemLabel('campus_faq', 'yihua')).toBe('各校常見問題（義華）')
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
    id, kind: 'content_review_rejected', campus_key: 'yihua', content_kind: 'campus_faq', revision_version: 3,
    note: '請補電話', error: null, publish_at: null, actor_email: 'amy@ivy.example', created_at: '2026-09-25T02:00:00Z', read_at: null,
    ...overrides,
  }
}

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, kind: 'campus_faq', campus_key: 'yihua', revision_id: 'r1', revision_version: 2, publish_at: '2026-09-26T01:00:00Z',
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
        { content_item_id: 'i2', kind: 'campus_faq', campus_key: 'yihua', revision_id: 'r9', revision_version: 1, previous_revision_version: null },
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
    expect(text).toContain('第 2 版 → 第 1 版')
    expect(text).toContain('核准送審並發布')
    expect(text).toContain('第一次上線（第 1 版）')
    expect(wrapper.find('a[href="/content/campus-faq?campus=yihua"]').exists()).toBe(true)
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
    expect(del).toHaveBeenCalledWith('/admin/content-items/campus_faq/schedules/j1?campus_key=yihua')
  })

  it('給自己的通知：顯示退回原因與連結，標記已讀後側欄數字跟著減', async () => {
    mockPublishingApi({ notices: [notice('n1'), notice('n2', { kind: 'content_schedule_failed', note: null, error: '素材還沒處理好', publish_at: '2026-09-25T01:00:00Z', actor_email: null, read_at: '2026-09-25T03:00:00Z' })] })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...notice('n1'), read_at: '2026-09-25T04:00:00Z' } as never)
    const { global, pinia } = await setup('/releases', testUser('editor', { campus_keys: ['yihua'] }))
    useOpenRequestsStore(pinia).apply({ my_unread_notifications: 1 })
    const wrapper = mount(PublishHistoryView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('給你的通知（1 則未讀）')
    expect(text).toContain('你送審的內容被退回')
    expect(text).toContain('退回原因：請補電話')
    expect(text).toContain('排程發布沒有執行')
    expect(text).toContain('素材還沒處理好')
    expect(wrapper.find('a[href="/content/campus-faq?campus=yihua"]').exists()).toBe(true)
    await button(wrapper, '標記已讀').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/my-notifications/n1/read')
    expect(useOpenRequestsStore(pinia).myNotices).toBe(0)
    expect(wrapper.text()).not.toContain('則未讀')
  })

  it('側欄「發布紀錄」旁顯示未讀的內容通知數', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ my_unread_notifications: 3 } as never)
    const { global, pinia } = await setup('/', testUser('editor', { campus_keys: ['yihua'] }))
    useOpenRequestsStore(pinia).apply({ my_unread_notifications: 3 })
    const wrapper = mount(AdminSidebar, { global })
    wrappers.push(wrapper)
    await flushPromises()
    const link = wrapper.findAll('a').find((a) => a.text().includes('發布紀錄'))!
    expect(link.find('.sidebar__badge').text()).toContain('3')
  })
})

describe('總覽的待發布、素材與排程失敗（第 54、58 條）', () => {
  it('列出最新版比官網新的內容、缺少素材與沒有執行的排程，連結帶校區', async () => {
    const { global } = await setup('/')
    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (String(url) === '/admin/dashboard') {
        return Promise.resolve({
          today_visits: 0, pending_follow_up: 0, campuses_without_active_booking: [], failed_notifications: 0,
          pending_publish: 2, pending_publish_kinds: ['campus_faq', 'home_about'],
          pending_publish_items: [
            { kind: 'home_about', campus_key: null, latest_version: 5, published_version: 4, updated_at: '2026-09-25T02:00:00Z' },
            { kind: 'campus_faq', campus_key: 'renwu', latest_version: 1, published_version: null, updated_at: '2026-09-24T02:00:00Z' },
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
    expect(text).toContain('官網第 4 版，最新第 5 版')
    expect(text).toContain('從未發布')
    expect(wrapper.find('a[href="/content/campus-faq?campus=renwu"]').exists()).toBe(true)
    expect(text).toContain('內容缺少素材或素材還沒處理好')
    expect(text).toContain('官網上1 個已刪除')
    expect(wrapper.find('a[href="/content/campus-tour?campus=yihua"]').exists()).toBe(true)
    expect(text).toContain('排程發布沒有執行')
    expect(text).toContain('第 3 版：素材還沒處理好')
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
      const { global } = await setup(`/content/campus-faq?campus=${query}`, testUser('campus_admin', { campus_keys: ['renwu', 'yihua'] }))
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
