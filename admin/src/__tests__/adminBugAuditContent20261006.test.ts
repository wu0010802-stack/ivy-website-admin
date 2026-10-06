// 2026-10-06 後台 bug 稽核（前端）：內容編輯（第 14–21 條）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import HomeAboutView from '../views/HomeAboutView.vue'
import CampusNewsView from '../views/CampusNewsView.vue'
import CampusTourView from '../views/CampusTourView.vue'
import AdmissionContentView from '../views/AdmissionContentView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'
import ContentEditor from '../components/ContentEditor.vue'
import { ApiError, api } from '../api/client'
import { useContentItem } from '../composables/useContentItem'
import { revealContentPath } from '../composables/newsContent'
import { ROLE_CAPABILITIES, testUser } from './fixtures'
import { cleanup, deferred, mockGet, mountWith, wrappers } from './admissionsTestKit'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const bodyText = () => document.body.textContent ?? ''
const buttonByText = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)
const buttonByLabel = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find((b) => b.attributes('aria-label') === label)

type Payload = Record<string, unknown>
function contentItem(payload: Payload | null, changes: Record<string, unknown> = {}, revision: Record<string, unknown> = {}) {
  return {
    id: 'item-1', kind: 'home_about', campus_key: null, latest_version: payload ? 1 : 0, current_published_revision_id: null,
    latest_revision: payload ? { id: 'rev-1', version: 1, created_at: '2026-10-01T00:00:00Z', payload, review_status: 'draft', review_note: null, ...revision } : null,
    ...changes,
  }
}
const about = (title = '關於常春藤') => ({ title, since_label: '', body_text: '', caption: '', photo: null, photo_alt: '' })

function harness<T extends object>(kind: string, empty: T, campus?: ReturnType<typeof ref<string>>) {
  let editor!: ReturnType<typeof useContentItem<T>>
  const Harness = defineComponent({ setup() { editor = useContentItem<T>(kind, empty, campus as never); return () => null } })
  wrappers.push(mount(Harness))
  return editor
}

// ------------------------------------------------------------------ 14
describe('14. 處理中切校區：舊校的回應不蓋掉新校', () => {
  it('發布處理中：校區選單停用；硬換也撥回原校並提示，不讀新校', async () => {
    const pending = deferred<unknown>()
    const get = mockGet({
      '/admin/content-items/campus_news/schedules': [],
      '/admin/content-items/campus_news/revisions': [],
      '/admin/content-items/campus_news': (path: string) => contentItem({ articles: [], events: [] }, { id: `item-${new URLSearchParams(path.split('?')[1]).get('campus_key')}`, kind: 'campus_news' }),
    })
    vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountWith(CampusNewsView, { path: '/content/campus-news?campus=yihua' })
    await buttonByLabel(wrapper, '發布到官網')!.trigger('click')
    await flushPromises()
    const select = wrapper.findComponent({ name: 'CampusSelect' })
    expect(select.props('disabled')).toBe(true)
    const reads = () => get.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/admin/content-items/campus_news?campus_key=minghua'))
    select.vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    expect(select.props('modelValue')).toBe('yihua')
    expect(reads()).toEqual([])
    pending.resolve(contentItem({ articles: [], events: [] }, { id: 'item-yihua', kind: 'campus_news', current_published_revision_id: 'rev-1' }))
    await flushPromises()
    expect(select.props('disabled')).toBe(false)
  })

  it('存檔途中換了校：舊校的存檔回應丟掉，畫面仍是新校', async () => {
    const campus = ref('yihua')
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => contentItem({ title: `${new URLSearchParams(path.split('?')[1]).get('campus_key')}` }, { id: `item-${new URLSearchParams(path.split('?')[1]).get('campus_key')}` }) as never)
    const pending = deferred<unknown>()
    vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    const editor = harness('campus_profile', { title: '' }, campus)
    await editor.load()
    editor.form.value.title = '義華改到一半'
    const saving = editor.save()
    campus.value = 'minghua'
    await editor.load()
    pending.resolve(contentItem({ title: '義華改到一半' }, { id: 'item-yihua', latest_version: 2 }))
    expect(await saving).toBe(false)
    expect(editor.item.value?.id).toBe('item-minghua')
    expect(editor.form.value.title).toBe('minghua')
    expect(editor.isDirty.value).toBe(false)
  })

  it('還原途中換了校：舊校的還原內容不寫進新校的表單', async () => {
    const campus = ref('yihua')
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => contentItem({ title: `${new URLSearchParams(path.split('?')[1]).get('campus_key')}` }, { id: `item-${new URLSearchParams(path.split('?')[1]).get('campus_key')}` }) as never)
    const pending = deferred<unknown>()
    vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    const editor = harness('campus_profile', { title: '' }, campus)
    await editor.load()
    const restoring = editor.history.restore('rev-0', false)
    campus.value = 'minghua'
    await editor.load()
    pending.resolve(contentItem({ title: '義華舊版' }, { id: 'item-yihua', latest_version: 2 }))
    expect(await restoring).toBe(false)
    expect(editor.form.value.title).toBe('minghua')
  })

  it('排程清單只採用最後一次讀取', async () => {
    const first = deferred<unknown>()
    const job = (id: string) => ({ id, revision_id: 'rev-1', revision_version: 1, publish_at: '2099-01-01T01:00:00Z', status: 'scheduled', error: null, created_by_email: null, finished_at: null })
    vi.spyOn(api, 'get')
      .mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce([job('new')] as never)
    const editor = harness('campus_profile', { title: '' }, ref('yihua'))
    const older = editor.loadSchedules()
    await editor.loadSchedules()
    first.resolve([job('old')])
    await older
    expect(editor.schedules.value.map((j) => j.id)).toEqual(['new'])
  })
})

// ------------------------------------------------------------------ 15
describe('15. 衝突後「載入最新內容」讀取失敗，修改不能無聲遺失', () => {
  it('讀取失敗：離頁保護仍有效；按「重新載入」成功後提供套回我的修改', async () => {
    let fail = false
    let title = '原本的標題'
    mockGet({
      '/admin/content-items/home_about/schedules': [],
      '/admin/content-items/home_about/revisions': [],
      '/admin/content-items/home_about': () => {
        if (fail) throw new ApiError(500, { code: 'INTERNAL_ERROR', message: '系統錯誤' })
        return contentItem(about(title))
      },
    })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'CONTENT_VERSION_CONFLICT', message: '衝突' }))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountWith(HomeAboutView, { path: '/content/home-about' })
    await wrapper.get('input').setValue('我的標題')
    await buttonByText(wrapper, '儲存草稿')!.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('其他人已經更新這項內容')

    fail = true
    await buttonByText(wrapper, '載入最新內容')!.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('系統錯誤')

    confirm.mockClear()
    confirm.mockRejectedValueOnce('cancel')
    const shell = wrapper.findComponent(ContentEditor).vm as unknown as { confirmLeave: () => Promise<boolean> }
    expect(await shell.confirmLeave()).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)

    fail = false
    title = '同事的標題'
    await buttonByText(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('已載入最新內容，你剛才的修改還沒套回')
    await buttonByText(wrapper, '套回我的修改')!.trigger('click')
    await flushPromises()
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('我的標題')
  })
})

// ------------------------------------------------------------------ 16, 17
describe('16. 被退回的版本不能直接發布或排程', () => {
  it('最新版被退回、沒有修改：發布與排程發布停用並說明；改了之後可以儲存並發布', async () => {
    mockGet({
      '/admin/content-items/home_about/schedules': [],
      '/admin/content-items/home_about/revisions': [],
      '/admin/content-items/home_about': contentItem(about(), {}, { review_status: 'rejected', review_note: '照片要換' }),
    })
    const { wrapper } = await mountWith(HomeAboutView, { path: '/content/home-about' })
    expect(buttonByLabel(wrapper, '發布到官網')!.attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, '排程發布')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('這一版已被退回，請修改後重新儲存')
    await wrapper.get('input').setValue('改過的標題')
    expect(buttonByLabel(wrapper, '儲存並發布到官網')!.attributes('disabled')).toBeUndefined()
  })
})

describe('17. 已上線、沒有修改的內容不能送審', () => {
  it('內容編輯（有共用內容授權）：官網就是這一版時「送審」停用；改了之後可以儲存並送審', async () => {
    mockGet({
      '/admin/content-items/home_about/schedules': [],
      '/admin/content-items/home_about/revisions': [],
      '/admin/content-items/home_about': contentItem(about(), { current_published_revision_id: 'rev-1' }),
    })
    const editorUser = testUser('editor', { id: 'ed', email: 'ed@example.invalid', effective_capabilities: [...ROLE_CAPABILITIES.editor, 'content.shared'] })
    const { wrapper } = await mountWith(HomeAboutView, { path: '/content/home-about', user: editorUser })
    expect(buttonByText(wrapper, '送審')!.attributes('disabled')).toBeDefined()
    await wrapper.get('input').setValue('改過的標題')
    expect(buttonByText(wrapper, '儲存並送審')!.attributes('disabled')).toBeUndefined()
  })
})

// ------------------------------------------------------------------ 18
describe('18. 發布衝突後成功還原成草稿，衝突狀態清掉', () => {
  it('還原成功後 conflict 是 false', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(contentItem(about()) as never)
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(409, { code: 'CONTENT_VERSION_CONFLICT', message: '衝突' }))
    const editor = harness('home_about', about(''))
    await editor.load()
    expect(await editor.publish()).toBe(false)
    expect(editor.conflict.value).toBe(true)
    post.mockResolvedValueOnce(contentItem(about('舊版標題'), { latest_version: 3 }) as never)
    expect(await editor.history.restore('rev-0', false)).toBe(true)
    expect(editor.conflict.value).toBe(false)
  })
})

// ------------------------------------------------------------------ 19
describe('19. 校園探索：場景選取與讀圖失敗狀態跟著表單換', () => {
  const scene = (key: string, name: string) => ({ key, name, image: `media-${key}`, intro: '' })

  it('放棄修改後場景變少：選取夾回範圍內；讀圖失敗狀態清掉', async () => {
    mockGet({
      '/admin/content-items/campus_tour/schedules': [],
      '/admin/content-items/campus_tour/revisions': [],
      '/admin/content-items/campus_tour': contentItem({ scenes: [scene('a', '大門'), scene('b', '教室'), scene('c', '遊戲場')] }, { kind: 'campus_tour', campus_key: 'yihua' }),
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountWith(CampusTourView, { path: '/content/campus-tour?campus=yihua' })
    await buttonByText(wrapper, '新增場景')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('場景 4 / 4')
    await buttonByText(wrapper, '放棄修改')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('場景 3 / 3')

    await wrapper.get('.tour__stage img').trigger('error')
    expect(wrapper.text()).toContain('無法載入這張圖片')
    await wrapper.find('.tour__side input').setValue('改了名字')
    await buttonByText(wrapper, '放棄修改')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法載入這張圖片')
    expect(wrapper.find('.tour__stage img').exists()).toBe(true)
  })
})

// ------------------------------------------------------------------ 20
describe('20. 存檔錯誤清單點了跳到對的那一欄', () => {
  it('消息內文區塊也帶 data-list-item：只找清單外框的直接子項目', async () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-list="articles">
        <div data-list-item="0">
          <div class="news-body">
            <div data-list-item="0"><textarea></textarea></div>
            <div data-list-item="1"><textarea id="body-1"></textarea></div>
          </div>
          <input data-field="title" id="article-0-title" />
        </div>
        <div data-list-item="1"><input data-field="title" id="article-1-title" /></div>
      </div>`
    document.body.appendChild(root)
    expect(await revealContentPath(root, ['articles', 1, 'title'])).toBe(true)
    expect(document.activeElement?.id).toBe('article-1-title')
  })

  it('入學資訊頁四份清單都有 data-list 外框', async () => {
    mockGet({ '/admin/content-items/admission_content': contentItem(null, { kind: 'admission_content' }) })
    const { wrapper } = await mountWith(AdmissionContentView, { path: '/content/admission' })
    for (const list of ['steps', 'phases', 'subsidies', 'refunds']) expect(wrapper.find(`[data-list="${list}"]`).exists(), list).toBe(true)
  })
})

// ------------------------------------------------------------------ 21
describe('21. 隱私權政策初稿在重新載入與放棄修改後一樣帶入', () => {
  const sectionCount = () => document.body.querySelectorAll('[data-section-anchor]').length

  it('第一次讀取失敗、按「重新載入」：帶入初稿', async () => {
    let fail = true
    mockGet({
      '/admin/content-items/privacy_policy/schedules': [],
      '/admin/content-items/privacy_policy/revisions': [],
      '/admin/content-items/privacy_policy': () => {
        if (fail) throw new ApiError(500, { code: 'INTERNAL_ERROR', message: '系統錯誤' })
        return contentItem(null, { kind: 'privacy_policy' })
      },
    })
    const { wrapper } = await mountWith(PrivacyPolicyView, { path: '/content/privacy-policy' })
    await flushPromises()
    fail = false
    await buttonByText(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(sectionCount()).toBe(12)
  })

  it('改了初稿再放棄修改：回到初稿，不是空白', async () => {
    mockGet({
      '/admin/content-items/privacy_policy/schedules': [],
      '/admin/content-items/privacy_policy/revisions': [],
      '/admin/content-items/privacy_policy': contentItem(null, { kind: 'privacy_policy' }),
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountWith(PrivacyPolicyView, { path: '/content/privacy-policy' })
    await flushPromises()
    expect(sectionCount()).toBe(12)
    await buttonByText(wrapper, '放棄修改')!.trigger('click')
    await flushPromises()
    expect(sectionCount()).toBe(12)
  })
})
