// 2026-09-25 缺口 68、69：送出時帶 expected_version、別人先改過（409 *_VERSION_CONFLICT）
// 就提示並重新載入；新錯誤碼（SLOT_CLOSED、MEDIA_NOT_READY…）顯示後端的中文原因，
// 系統錯誤附上錯誤編號。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import DayPanel from '../components/sessions/DayPanel.vue'
import WeeklySessionsCard from '../components/sessions/WeeklySessionsCard.vue'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict, contentFieldErrors, contentSaveErrorMessage } from '../api/errors'
import { AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser, ROLE_CAPABILITIES } from './fixtures'
import HomeAboutView from '../views/HomeAboutView.vue'
import CampusNewsView from '../views/CampusNewsView.vue'
import CampusTourView from '../views/CampusTourView.vue'
import AdmissionContentView from '../views/AdmissionContentView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'
import ContentEditor from '../components/ContentEditor.vue'
import { useContentItem, type ContentEditorState, type RevisionSummary } from '../composables/useContentItem'
import { revealContentPath } from '../composables/newsContent'
import { cleanup, deferred, mockGet, mountWith, wrappers as wrappersFromKit } from './admissionsTestKit'
import HomeNewsView from '../views/HomeNewsView.vue'
import { contentPathLabel } from '../api/contentFieldLabels'
import { legacyCopyHint, LEGACY_SITE_DESCRIPTION } from '../composables/contentHints'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountAt(component: unknown, path: string, props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const conflict = (code: string, message: string) => new ApiError(409, { code, message, current_version: 2, request_id: 'abcdef0123456789' })

describe('API 錯誤解析', () => {
  it('新代碼顯示後端的中文原因，只有 *_VERSION_CONFLICT 算「別人先改過」', () => {
    const closed = new ApiError(409, { code: 'SLOT_CLOSED', message: '這個時段已關閉', request_id: 'r1' })
    expect(apiErrorCode(closed)).toBe('SLOT_CLOSED')
    expect(apiErrorMessage(closed, '失敗')).toBe('這個時段已關閉')
    expect(isVersionConflict(closed)).toBe(false)
    expect(isVersionConflict(new ApiError(409, { code: 'MEDIA_NOT_READY', message: 'x' }))).toBe(false)
    expect(isVersionConflict(conflict('SLOT_VERSION_CONFLICT', 'x'))).toBe(true)
    expect(isVersionConflict(new ApiError(422, { code: 'SLOT_VERSION_CONFLICT' }))).toBe(false)
  })

  it('沒有訊息時用代碼對照；系統錯誤附錯誤編號；422 陣列與字串照舊', () => {
    expect(apiErrorMessage(new ApiError(409, { code: 'MEDIA_NOT_READY' }), '失敗')).toBe('引用的素材還沒處理完成或已被刪除')
    expect(apiErrorMessage(new ApiError(409, { code: 'UNKNOWN_CODE' }), '失敗')).toBe('失敗')
    expect(
      apiErrorMessage(new ApiError(500, { code: 'INTERNAL_ERROR', message: '系統發生未預期的錯誤，請稍後再試', request_id: '0123456789abcdef' }), '失敗'),
    ).toBe('系統發生未預期的錯誤，請稍後再試（錯誤編號 01234567）')
    expect(apiErrorMessage(new ApiError(422, [{ loc: ['body', 'x'], msg: 'Value error, 天數至少 30', type: 'value_error' }]), '失敗')).toBe('天數至少 30')
    expect(apiErrorMessage(new ApiError(404, '找不到這個項目'), '失敗')).toBe('找不到這個項目')
    expect(apiErrorMessage(new TypeError('Failed to fetch'), '失敗')).toBe('失敗')
  })

  it('新的稽核動作、對象與歷程都有中文', () => {
    for (const action of ['visit_request.confirm', 'visit_request.cancel', 'visit_slot.update', 'media.upload', 'media.update', 'media.replace', 'retention_policy.update']) {
      expect(AUDIT_ACTION_LABELS[action], action).toBeTruthy()
    }
    expect(AUDIT_TARGET_LABELS.visit_slot).toBe('參觀場次')
  })
})

describe('場次：帶版本送出，別人先改過就重新讀取', () => {
  const slot = { id: 's1', campus_key: 'yihua', slot_date: '2099-01-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false, closed_source: null, version: 4, visits: [] }
  const panelProps = { day: '2099-01-06', campusKey: 'yihua', slots: [slot], holiday: null, canManage: true }

  it('停止申請帶 expected_version；409 版本衝突時提示並請父層重讀', async () => {
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(conflict('SLOT_VERSION_CONFLICT', '這個時段剛被其他人修改（或因休假日關閉），請重新載入後再調整'))
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAt(DayPanel, '/', panelProps)
    await wrapper.findAll('button').find(button => button.text() === '停止申請')!.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/slots/s1', { closed: true, expected_version: 4 })
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這一場剛被其他人修改，已重新載入' }))
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('改每週場次後停用的場次寫「不在開放規則內」，不寫「已停止申請」', async () => {
    const wrapper = await mountAt(DayPanel, '/', { ...panelProps, slots: [{ ...slot, closed: true, closed_source: 'rule' }] })
    expect(wrapper.text()).toContain('不在開放規則內')
    expect(wrapper.text()).not.toContain('已停止申請')
  })

  it('調整名額遇到版本衝突也提示並請父層重讀', async () => {
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(conflict('SLOT_VERSION_CONFLICT', 'x'))
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAt(DayPanel, '/', panelProps)
    wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.classes().includes('day-panel__capacity'))!.vm.$emit('update:modelValue', 5)
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/slots/s1', { capacity: 5, expected_version: 4 })
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這一場剛被其他人修改，已重新載入' }))
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})

describe('每週固定場次：整份替換要帶版本，衝突時不蓋掉別人', () => {
  const schedule = { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [], version: 5 }

  it('儲存帶 expected_version；衝突時提示並重新載入最新設定', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(schedule as never)
    const put = vi.spyOn(api, 'put').mockRejectedValue(conflict('VISIT_SCHEDULE_VERSION_CONFLICT', '開放規則剛被其他人修改，請重新載入後再編輯'))
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAt(WeeklySessionsCard, '/', { campusKey: 'yihua', canManage: true, canConfigureBooking: false })
    await wrapper.findAll('button').find(button => button.text() === '套用常用場次')!.trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/visit-schedule/yihua', expect.objectContaining({ expected_version: 5 }))
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '場次剛被其他人修改，已重新載入最新設定' }))
    // 重新載入後再讀一次規則。
    expect(get.mock.calls.filter(([path]) => String(path).startsWith('/admin/visit-schedule/')).length).toBeGreaterThanOrEqual(2)
  })
})

// ---- 併自 adminBugAuditContent20261006.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-10-06 後台 bug 稽核（前端）：內容編輯（第 14–21 條）。
describe('2026-10-06 後台 bug 稽核：內容編輯（第 14–21 條）', () => {
  const wrappers = wrappersFromKit
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
})

// ---- 併自 cmsUx20261002.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-10-02 內容編輯 CMS 稽核修正：存檔錯誤寫出位置並可跳過去（cms-1）、狀態列寫
// 草稿是誰存的（cms-2）、消息與時刻卡收合（cms-3）、版本衝突保留修改（cms-6）、
// 原型原文提示（cms-7）、離頁時可以先存草稿（cms-8）。
describe('2026-10-02 內容編輯 CMS 稽核修正', () => {
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

  interface CampusDoc { title: string; note: string }

  function campusItem(version: number, payload: CampusDoc) {
    return {
      id: 'i1', kind: 'campus_news', campus_key: 'yihua', latest_version: version, current_published_revision_id: 'r1',
      latest_revision: { id: `r${version}`, version, created_at: '2026-09-25T02:00:00Z', payload, review_status: 'draft', review_note: null },
    }
  }

  function mountCampusPage(global: Awaited<ReturnType<typeof setup>>['global']) {
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

  describe('版本衝突保留自己的修改（cms-6）', () => {
    it('衝突時持續提示、停用儲存；看對方改了什麼；載入最新後可以只套回自己改的欄位', async () => {
      const { global } = await setup('/content/campus-news')
      let current = campusItem(2, { title: '原標題', note: '原說明' })
      vi.spyOn(api, 'get').mockImplementation(((path: string) =>
        Promise.resolve(path.includes('/schedules') || path.includes('/revisions') ? [] : current)) as typeof api.get)
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'CONTENT_VERSION_CONFLICT', message: '內容已被其他人更新' }))
      const error = vi.spyOn(ElMessage, 'error')
      const page = mountCampusPage(global)
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
      current = campusItem(3, { title: '原標題', note: '對方的說明' })
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
      const { global } = await setup('/content/campus-news')
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
      const { global } = await setup('/content/campus-news')
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
      const { global } = await setup('/content/campus-news')
      const saveDraft = vi.fn(async () => true)
      const guard = mountGuard(global, saveDraft)
      const confirm = pressInDialog('confirm')
      expect(await guard().confirmLeave()).toBe(true)
      expect(saveDraft).not.toHaveBeenCalled()
      expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '放棄修改', cancelButtonText: '留在這頁' })
    })
  })
})
