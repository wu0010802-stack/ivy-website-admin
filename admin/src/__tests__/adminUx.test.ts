import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, ref, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminSidebar from '../components/AdminSidebar.vue'
import ContentEditor from '../components/ContentEditor.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import type { ContentEditorState } from '../composables/useContentItem'
import type { UserOut } from '../api/types'

// 這個 jsdom 環境下的 localStorage 只是個空物件，沒有 Storage 的方法；
// 側欄的收合記憶要驗，就自己補一個最小實作。
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
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks(); localStorage.clear() })
async function setup(path = '/', role: UserOut['role'] = 'super_admin') {
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role, is_active: true, campus_keys: ['renwu'] }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  return { router, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } }
}

describe('後台導覽與編輯操作', () => {
  it('API 尚未提供新清單欄位時，總覽仍能顯示摘要與提醒', async () => {
    const { global } = await setup()
    vi.spyOn(api, 'get').mockResolvedValueOnce({ today_visits: 2, pending_follow_up: 1, pending_publish: 1, campuses_without_active_booking: ['renwu'], failed_notifications: 0 })
    const wrapper = mount(DashboardView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.find('.el-skeleton').exists()).toBe(false)
    expect(wrapper.text()).toContain('到期待追蹤')
    expect(wrapper.text()).toContain('校區尚未開放預約')
    expect(wrapper.text()).toContain('仁武')
  })

  it('搜尋展開相符功能，但不會讓校區管理者看到帳號管理入口', async () => {
    const { global } = await setup('/', 'campus_admin')
    const wrapper = mount(AdminSidebar, { global, attachTo: document.body })
    wrappers.push(wrapper)
    await wrapper.get('input').setValue('素材')
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['素材庫'])
    expect(wrapper.get('#nav-site').isVisible()).toBe(true)
    await wrapper.get('input').setValue('使用者')
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain('找不到符合的功能')
  })

  it('從捷徑前往內容頁時自動展開目前分組並清除搜尋', async () => {
    const { global, router } = await setup()
    const wrapper = mount(AdminSidebar, { global, attachTo: document.body })
    wrappers.push(wrapper)
    expect(wrapper.get('#nav-home').isVisible()).toBe(false)
    await wrapper.get('input').setValue('素材')
    await router.push('/content/home-hero')
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('')
    expect(wrapper.get('#nav-home').isVisible()).toBe(true)
    expect(wrapper.get('[aria-current="page"]').text()).toBe('首頁首屏文字')
  })

  it('官網內容分成三個子組共用一個區段標題，收合狀態記在瀏覽器', async () => {
    const { global } = await setup()
    const wrapper = mount(AdminSidebar, { global, attachTo: document.body })
    wrappers.push(wrapper)
    // 區段標題只有一個，底下是首頁／分校頁／全站與素材三個可收合子組
    expect(wrapper.findAll('.sidebar__section').map(el => el.text())).toEqual(['官網內容'])
    expect(wrapper.findAll('.sidebar__group.is-nested')).toHaveLength(3)
    expect(wrapper.get('#nav-home').isVisible()).toBe(false)

    await wrapper.get('[aria-controls="nav-home"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#nav-home').isVisible()).toBe(true)
    expect(JSON.parse(localStorage.getItem('ivy-admin-nav-expanded')!).home).toBe(true)

    // 重新掛載後沿用上次的開合
    const again = mount(AdminSidebar, { global, attachTo: document.body })
    wrappers.push(again)
    expect(again.get('#nav-home').isVisible()).toBe(true)
  })

  it('搜尋功能名優先於分組名，搜「素材」只給素材庫', async () => {
    const { global } = await setup()
    const wrapper = mount(AdminSidebar, { global, attachTo: document.body })
    wrappers.push(wrapper)
    await wrapper.get('input').setValue('素材')
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['素材庫'])
    // 分組名仍可搜：沒有功能叫「分校頁」，但該組三項要全出來
    await wrapper.get('input').setValue('分校頁')
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['五校介紹', '各校常見問題', '校園探索'])
  })

  it('載入期間不誤報未儲存，儲存期間禁止編輯及重複發布', async () => {
    const { global } = await setup('/content/home-hero')
    const editor: ContentEditorState = {
      loading: ref(true), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
      isDirty: computed(() => true), neverPublished: computed(() => true), latestRevisionAt: computed(() => null),
      load: vi.fn(async () => {}), save: vi.fn(async () => true), saveAndPublish: vi.fn(async () => true), reset: vi.fn(),
    }
    const wrapper = mount(ContentEditor, { props: { editor }, global, slots: { default: '<input aria-label="內容" />' } })
    wrappers.push(wrapper)
    expect(wrapper.find('.editor__status').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
    editor.loading.value = false
    editor.saving.value = true
    await flushPromises()
    expect(wrapper.get('.editor__body').attributes('inert')).toBeDefined()
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    editor.saving.value = false
    await flushPromises()
    expect(wrapper.get('.editor__body').attributes('inert')).toBeUndefined()
    const save = wrapper.findAll('button').find(button => button.text() === '儲存草稿')!
    await save.trigger('click')
    expect(editor.save).toHaveBeenCalledOnce()
  })

  it('搜尋停止輸入後才查詢，並把關鍵字帶進 q 參數', async () => {
    const { global } = await setup('/visit-requests')
    const get = vi.spyOn(api, 'get').mockResolvedValue([])
    const wrapper = mount(VisitRequestsView, { global })
    wrappers.push(wrapper)
    await flushPromises()
    get.mockClear()

    await wrapper.get('input[aria-label="搜尋家長／孩子姓名、電話或 Email"]').setValue('陳')
    await flushPromises()
    expect(get).not.toHaveBeenCalled()

    await new Promise(resolve => setTimeout(resolve, 350))
    await flushPromises()
    expect(get).toHaveBeenCalledOnce()
    expect(String(get.mock.calls[0]![0])).toContain('q=%E9%99%B3')
    expect(wrapper.text()).toContain('找不到符合「陳」的案件')
  })

  it('案件快速切換篩選時，舊回應不會蓋掉較新的結果', async () => {
    const { global } = await setup('/visit-requests')
    let resolveOld!: (value: unknown[]) => void
    const oldRequest = new Promise<unknown[]>(resolve => { resolveOld = resolve })
    vi.spyOn(api, 'get').mockImplementationOnce(() => oldRequest as Promise<never>).mockResolvedValueOnce([])
    const wrapper = mount(VisitRequestsView, { global })
    wrappers.push(wrapper)
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', 'new')
    await flushPromises()
    expect(wrapper.text()).toContain('沒有「待處理」的案件')
    resolveOld([{ id: 'old-result', parent_name: '過時的篩選結果', status: 'confirmed', campus_key: 'renwu', phone: '000', created_at: '2026-09-21T00:00:00Z' }])
    await flushPromises()
    expect(wrapper.text()).not.toContain('過時的篩選結果')
    expect(wrapper.text()).toContain('本頁 0 件')
  })
})
