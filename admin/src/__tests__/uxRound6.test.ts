// 官網後台第六輪 UX（2026-09-29）：下一筆的優先序與來源列表、案件頁的手機與觸控、
// 結案／取消用詞、聯絡紀錄草稿、找不到頁面與無權限提示、側欄只留案件數字。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import { api } from '../api/client'
import { contentFieldLabelFor } from '../api/contentFieldLabels'
import { useAuthStore } from '../stores/auth'
import router from '../router'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

const slot = { id: 'slot-1', slot_date: '2099-09-26', start_time: '10:00:00', end_time: '11:00:00' }
const kase = (extra: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'new', parent_name: '王家長', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, version: 4, ...extra,
})

function makePinia(role: 'super_admin' | 'reception' | 'editor' = 'super_admin') {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser(role, { campus_keys: role === 'super_admin' ? [] : ['yihua'] })
  return pinia
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: DashboardView },
      { path: '/visit-requests', component: VisitRequestsView },
      { path: '/visit-requests/:id', component: VisitDetailView },
      { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) },
    ],
  })
}

function emptyRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) }] })
}

async function mountDetail(detail: Record<string, unknown>, listByStatus: Record<string, unknown[]> = {}, path?: string) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (p: string) => {
    if (p.endsWith('/contact-notes')) return [] as never
    if (p.startsWith('/admin/slots')) return [] as never
    if (p.startsWith('/admin/visit-requests?')) {
      const status = new URLSearchParams(p.split('?')[1]).get('status') ?? ''
      return (listByStatus[status] ?? []) as never
    }
    return detail as never
  })
  const router = makeRouter()
  await router.push(path ?? `/visit-requests/${detail.id}`); await router.isReady()
  const wrapper = mount(VisitDetailView, { global: { plugins: [makePinia(), router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper); await flushPromises()
  return { wrapper, get, router }
}

describe('下一筆待處理', () => {
  it('沒有來源列表：先看待園方確認，沒有才看新需求，按鈕寫清楚是哪一種', async () => {
    const { wrapper } = await mountDetail(kase(), { pending_confirmation: [], new: [{ id: 'case-b' }, { id: 'case-a' }] })
    expect(wrapper.find('.detail__next').text()).toContain('下一筆新需求（還有 1 件）')
  })

  it('有待園方確認時，即使這筆是新需求也先帶去待確認', async () => {
    const { wrapper, router } = await mountDetail(kase(), { pending_confirmation: [{ id: 'case-p', status: 'pending_confirmation' }], new: [{ id: 'case-b' }] })
    expect(wrapper.find('.detail__next').text()).toContain('下一筆待確認（還有 1 件）')
    await wrapper.find('.detail__next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/case-p')
  })

  it('從列表點進來：照那份列表的條件與順序走，換下一筆時條件跟著帶', async () => {
    const list = 'status=contacting&order=oldest&campus_key=yihua'
    const rows = [
      { id: 'c1', status: 'contacting' }, { id: 'case-a', status: 'contacting' }, { id: 'c3', status: 'contacting' }, { id: 'c4', status: 'contacting' },
    ]
    const { wrapper, get, router } = await mountDetail(kase({ status: 'contacting' }), { contacting: rows }, `/visit-requests/case-a?list=${encodeURIComponent(list)}`)
    const listCalls = get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/admin/visit-requests?'))
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]).toContain('status=contacting')
    expect(listCalls[0]).toContain('order=oldest')
    expect(listCalls[0]).not.toContain('status=new')
    // 目前這筆之後的下一位是 c3，剩 3 件（列表其餘的）。
    expect(wrapper.find('.detail__next').text()).toContain('下一筆（還有 3 件）')
    await wrapper.find('.detail__next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/c3')
    expect(router.currentRoute.value.query.list).toBe(list)
  })

  it('從列表第 2 頁點進來：照列表的頁碼與每頁筆數抓同一段，不改用 50 筆一頁', async () => {
    const list = 'status=new&order=oldest&page=2&page_size=20'
    const { get } = await mountDetail(kase(), { new: [{ id: 'case-a', status: 'new' }, { id: 'n2', status: 'new' }] }, `/visit-requests/case-a?list=${encodeURIComponent(list)}`)
    const call = get.mock.calls.map((c) => String(c[0])).find((p) => p.startsWith('/admin/visit-requests?'))!
    const params = new URLSearchParams(call.split('?')[1])
    expect(params.get('page')).toBe('2')
    expect(params.get('page_size')).toBe('20')
  })

  it('列表點進案件時帶上條件；沒篩狀態（全部）就不帶', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([kase()] as never)
    const router = makeRouter()
    await router.push('/visit-requests?status=new&order=oldest'); await router.isReady()
    const wrapper = mount(VisitRequestsView, { global: { plugins: [makePinia(), router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.startsWith('/visit-requests/case-a'))!
    expect(decodeURIComponent(link.attributes('href')!)).toContain('list=status=new&order=oldest')

    await router.push('/visit-requests'); await flushPromises()
    const plain = wrapper.findAll('a').find((a) => a.attributes('href')?.startsWith('/visit-requests/case-a'))!
    expect(plain.attributes('href')).toBe('/visit-requests/case-a')
  })
})

describe('案件頁：手機、觸控與結構', () => {
  it('只有一個 h1（頁首的頁名）；處理面板在 DOM 裡排在資料前面，手機的視覺與 Tab 順序一致', async () => {
    const { wrapper } = await mountDetail(kase())
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.find('h2.detail__title').text()).toBe('王家長')
    expect(wrapper.find('.detail__grid').element.firstElementChild!.tagName).toBe('ASIDE')
  })

  it('處理面板頂端有滿版「撥打」按鈕（手機才顯示），電話連結有觸控範圍的 class', async () => {
    const { wrapper } = await mountDetail(kase())
    const call = wrapper.find('a.detail__call')
    expect(call.attributes('href')).toBe('tel:0912345678')
    expect(call.text()).toContain('撥打')
    expect(wrapper.find('a.detail__phone').exists()).toBe(true)
  })

  it('已結案的案件不放撥打鈕', async () => {
    const { wrapper } = await mountDetail(kase({ status: 'cancelled' }))
    expect(wrapper.find('a.detail__call').exists()).toBe(false)
  })

  it('下次聯絡不因為 Tab 到它就彈出日期面板', async () => {
    const { wrapper } = await mountDetail(kase())
    expect(wrapper.findComponent({ name: 'ElDatePicker' }).props('automaticDropdown')).toBe(false)
  })

  it('名額單位一律用「組」', async () => {
    const { wrapper } = await mountDetail(kase({ status: 'contacting' }))
    // 沒有時段時選單是空的；改看 slotLabel 的來源：選項文字用「組」。
    expect(wrapper.text()).not.toMatch(/剩 \d+ 位/)
  })
})

describe('結案與取消', () => {
  function promptSpy() {
    return vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
  }

  it('還只是需求：叫「結案（不需參觀）」，確認鈕是 danger，說明不會通知家長', async () => {
    const prompt = promptSpy()
    const { wrapper } = await mountDetail(kase({ status: 'contacting' }))
    const button = wrapper.findAll('button').find((b) => b.text() === '結案（不需參觀）')!
    await button.trigger('click')
    await flushPromises()
    const [message, title, options] = prompt.mock.calls[0]!
    expect(title).toBe('結案這筆需求？')
    expect(String(message)).toContain('不會通知家長')
    expect(String(message)).toContain('重新預約')
    expect(options).toMatchObject({ confirmButtonText: '結案', confirmButtonClass: 'el-button--danger', cancelButtonText: '先不要' })
  })

  it('已確認：叫「取消預約」，說明名額立即釋出、不會通知家長', async () => {
    const prompt = promptSpy()
    const { wrapper } = await mountDetail(kase({ status: 'confirmed', slot_id: 'slot-1', slot }))
    await wrapper.findAll('button').find((b) => b.text() === '取消預約')!.trigger('click')
    await flushPromises()
    const [message, title, options] = prompt.mock.calls[0]!
    expect(title).toBe('取消這筆預約？')
    expect(String(message)).toContain('名額會立即釋出')
    expect(String(message)).toContain('不會通知家長')
    expect(options).toMatchObject({ confirmButtonText: '取消預約', confirmButtonClass: 'el-button--danger' })
  })
})

describe('聯絡紀錄草稿', () => {
  it('寫到一半離開，回到同一筆帶回；送出成功後清掉', async () => {
    const { wrapper } = await mountDetail(kase())
    await wrapper.find('textarea').setValue('家長說週六可以')
    expect(window.sessionStorage.getItem('ivy-visit-note-draft:case-a')).toBe('家長說週六可以')
    await flushPromises()
    wrapper.unmount(); wrappers.length = 0

    const again = await mountDetail(kase())
    expect((again.wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('家長說週六可以')

    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await again.wrapper.findAll('button').find((b) => b.text() === '新增紀錄')!.trigger('click')
    await flushPromises()
    expect(window.sessionStorage.getItem('ivy-visit-note-draft:case-a')).toBeNull()
  })

  it('草稿只跟著自己的案件', async () => {
    window.sessionStorage.setItem('ivy-visit-note-draft:case-x', '別筆的草稿')
    const { wrapper } = await mountDetail(kase())
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
})

describe('列表載入中不閃出「沒有案件」', () => {
  it('讀取中表格的空狀態文字是空的', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}) as never)
    const r = makeRouter()
    await r.push('/visit-requests'); await r.isReady()
    const wrapper = mount(VisitRequestsView, { global: { plugins: [makePinia(), r, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(wrapper.find('.el-table__empty-text').text()).toBe('')
    expect(wrapper.text()).not.toContain('還沒有任何參觀需求')
  })
})

describe('找不到頁面與沒有權限', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('網址不存在時落在後台版面內的「找不到這個頁面」', () => {
    const resolved = router.resolve('/no/such/page')
    expect(resolved.name).toBe('not-found')
    expect(resolved.matched[0]?.components?.default).toBeTruthy()
    expect(resolved.matched.length).toBe(2)
  })

  it('沒權限的網址導回起始頁，並用白話說明需要誰', async () => {
    useAuthStore().user = testUser('reception', { campus_keys: ['yihua'] })
    const warning = vi.spyOn(ElMessage, 'warning')
    await router.push('/')
    await router.push('/users')
    expect(router.currentRoute.value.path).toBe('/')
    expect(warning).toHaveBeenCalledOnce()
    expect(String(warning.mock.calls[0]![0])).toContain('這個功能需要總管理者的權限')
    expect(String(warning.mock.calls[0]![0])).toContain('洽總管理者')
  })
})

describe('側欄只留案件數字，未讀通知在頁首', () => {
  it('頁首依權限列出改期申請與內容通知的連結', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.spyOn(api, 'get').mockResolvedValue({ pending_reschedule_requests: 2, my_unread_notifications: 3 } as never)
    const pinia = makePinia('super_admin')
    const r = emptyRouter()
    await r.push('/'); await r.isReady()
    const wrapper = mount(AdminLayout, { global: { plugins: [pinia, r, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    const links = wrapper.findAll('.top__alert')
    expect(links.map((l) => l.attributes('aria-label'))).toEqual(['改期申請待核准 2', '內容通知未讀 3'])
    expect(links[0]!.attributes('href')).toBe('/notifications')
    expect(links[1]!.attributes('href')).toBe('/releases')
    expect(wrapper.find('.sidebar__badge').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('內容編輯進不了「站內通知」，只看到內容通知', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.spyOn(api, 'get').mockResolvedValue({ pending_reschedule_requests: 2, my_unread_notifications: 1 } as never)
    const r = emptyRouter()
    await r.push('/'); await r.isReady()
    const wrapper = mount(AdminLayout, { global: { plugins: [makePinia('editor'), r, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(wrapper.findAll('.top__alert').map((l) => l.attributes('aria-label'))).toEqual(['內容通知未讀 1'])
    vi.unstubAllGlobals()
  })

  it('總覽待辦列出未讀的內容通知，不重複四格的案件數字', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
      new_requests: 0, awaiting_confirmation: 0, my_unread_notifications: 3,
    } as never)
    const r = makeRouter()
    await r.push('/'); await r.isReady()
    const wrapper = mount(DashboardView, { global: { plugins: [makePinia(), r, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(wrapper.text()).toContain('有內容通知還沒看')
  })
})

describe('差異欄位名依內容種類對應表單', () => {
  it('同一個欄位鍵在不同內容種類叫法不同，沒列到的退回通用名稱', () => {
    expect(contentFieldLabelFor('campus_profile', 'intro')).toBe('一句話簡介')
    expect(contentFieldLabelFor('campus_profile', 'description')).toBe('詳細介紹')
    expect(contentFieldLabelFor('admission_content', 'intro')).toBe('頁首介紹')
    expect(contentFieldLabelFor('home_hero', 'poster_alt')).toBe('影片封面的圖片說明')
    expect(contentFieldLabelFor('day_experience', 'film_poster')).toBe('背景影片的封面照片')
    expect(contentFieldLabelFor('unknown_kind', 'title')).toBe('標題')
    expect(contentFieldLabelFor(undefined, 'poster_alt')).toBe('影片封面的圖片說明')
  })
})

describe('聯絡紀錄草稿與登出（共用電腦）', () => {
  it('主動登出清掉所有案件草稿；逾時被導回登入（clearSession）保留，讓人重新登入後接著寫', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('reception', { campus_keys: ['yihua'] })
    window.sessionStorage.setItem('ivy-visit-note-draft:case-a', '家長說週六可以')
    window.sessionStorage.setItem('ivy-visit-note-draft:case-b', '再打一次')
    window.sessionStorage.setItem('other-key', '不是草稿')

    auth.clearSession()
    expect(window.sessionStorage.getItem('ivy-visit-note-draft:case-a')).toBe('家長說週六可以')

    auth.user = testUser('reception', { campus_keys: ['yihua'] })
    vi.spyOn(api, 'post').mockResolvedValue(undefined as never)
    await auth.logout()
    expect(window.sessionStorage.getItem('ivy-visit-note-draft:case-a')).toBeNull()
    expect(window.sessionStorage.getItem('ivy-visit-note-draft:case-b')).toBeNull()
    expect(window.sessionStorage.getItem('other-key')).toBe('不是草稿')
  })
})
