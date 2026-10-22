import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import VisitDetailView from '../views/VisitDetailView.vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { button, cleanup, mockGet, mockPost, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'
import { testUser } from './fixtures'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import { api } from '../api/client'
import { contentFieldLabelFor } from '../api/contentFieldLabels'
import { useAuthStore } from '../stores/auth'
import router from '../router'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountDetail(data: Record<string, unknown>, routes: Record<string, unknown> = {}, user?: never) {
  mockGet({ ...caseRoutes(data), ...routes })
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })).wrapper
}
const labels = (wrapper: Awaited<ReturnType<typeof mountDetail>>) => wrapper.findAll('.case-facts dt').map((dt) => dt.text())

describe('家長資料表（方向 C）', () => {
  it('官網送單：電話、孩子（姓名，生日）、Email、得知管道；電話與 Email 可點', async () => {
    const wrapper = await mountDetail(visitCase())
    expect(labels(wrapper)).toEqual(['電話', '孩子', 'Email', '得知管道'])
    expect(wrapper.get('.case-facts').text()).toContain('小安，2022/05/01')
    expect(wrapper.find('.case-facts a.detail__link[href="tel:0912000001"]').exists()).toBe(true)
    expect(wrapper.find('.case-facts a[href="mailto:p1@example.com"]').exists()).toBe(true)
    expect(wrapper.get('.case-facts .panel__head').text()).toContain('家長填寫的資料')
  })

  it('孩子一行：只有生日也列出來；姓名與生日都沒有才寫未填寫', async () => {
    const child = (wrapper: Awaited<ReturnType<typeof mountDetail>>) => wrapper.findAll('.case-facts dt').find((dt) => dt.text() === '孩子')!.element.nextElementSibling!.textContent!.trim()
    const onlyBirthdate = await mountDetail(visitCase({ child_name: null, child_birthdate: '2022-05-01' }))
    expect(child(onlyBirthdate)).toBe('2022/05/01')
    cleanup()
    const onlyName = await mountDetail(visitCase({ child_birthdate: null }))
    expect(child(onlyName)).toBe('小安')
    cleanup()
    const neither = await mountDetail(visitCase({ child_name: null, child_birthdate: null }))
    expect(child(neither)).toBe('未填寫')
  })

  it('舊資料才有的欄位有值才列', async () => {
    const wrapper = await mountDetail(visitCase({ party_size: 4, questions: '娃娃車到不到鼎金', preferred_time: 'weekday_morning' }))
    expect(labels(wrapper)).toEqual(expect.arrayContaining(['參觀人數', '方便接電話時段', '想了解的事']))
  })
})

describe('設定列（方向 C）', () => {
  it('依序是場次、家長管理連結、最底的取消預約', async () => {
    const wrapper = await mountDetail(visitCase())
    const settings = wrapper.get('.case-settings')
    expect(settings.get('.detail__actions > .reschedule--collapsed').text()).toBe('改到其他場次…')
    expect(settings.text()).toContain('家長管理連結')
    const children = settings.element.children
    expect(children[children.length - 1]!.classList.contains('detail__danger')).toBe(true)
    expect(button(settings, '取消預約')).toBeDefined()
  })

  it('收合時的說明接在連結後面（連結那一格只有連結）', async () => {
    const wrapper = await mountDetail(visitCase())
    const collapsed = wrapper.get('.case-settings .reschedule--collapsed').element
    expect(collapsed.nextElementSibling?.textContent).toBe('改好後原場次的名額會空出來。')
  })

  it('產生連結後的「複製連結」是淺色鈕：設定列裡沒有實心主色鈕', async () => {
    const wrapper = await mountDetail(visitCase())
    mockPost({ '/admin/visit-requests/case-a/access-link': { manage_url: 'https://www.ivy.example/visit/manage#token=abc', manage_url_fragment: '/visit/manage#token=abc', expires_at: '2026-10-09T00:00:00Z', replaced_previous: false } })
    await button(wrapper.get('.case-settings'), '產生連結')!.trigger('click')
    await flushPromises()
    const copy = button(wrapper.get('.case-settings'), '複製連結')!
    expect(copy.classes()).toContain('is-plain')
    expect(wrapper.findAll('.case-settings .el-button--primary:not(.is-plain):not(.is-link):not(.is-text)')).toHaveLength(0)
  })

  it('只能查看：看得到連結狀態，沒有改期、產生連結、取消', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const wrapper = await mountDetail(visitCase(), {}, viewer as never)
    const settings = wrapper.get('.case-settings')
    expect(settings.text()).toContain('還沒有產生連結')
    expect(settings.find('.reschedule').exists()).toBe(false)
    expect(button(settings, '產生連結')).toBeUndefined()
    expect(settings.find('.detail__danger').exists()).toBe(false)
  })

  it('已取消、已到場沒有設定列', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-02T02:00:00Z' }))
    expect(wrapper.find('.case-settings').exists()).toBe(false)
  })
})

describe('明細版面（方向 C）', () => {
  it('兩欄：主欄是時間線，右欄是家長資料與設定列；家庭版面右欄先放處理區、主欄先放招生資料', async () => {
    const plain = await mountDetail(visitCase())
    expect(plain.get('.detail__main').find('.case-timeline').exists()).toBe(true)
    expect(plain.get('.detail__side').find('.case-facts').exists()).toBe(true)
    expect(plain.get('.detail__side').find('.case-settings').exists()).toBe(true)
    cleanup()
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    const family = await mountDetail(
      visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }),
      { '/admin/admissions/records': [linked], '/admin/admissions/records/v-1': [] },
    )
    expect(family.get('.detail__side').element.firstElementChild!.classList.contains('detail__family-actions')).toBe(true)
    expect(family.get('.detail__main').element.firstElementChild!.classList.contains('family-data')).toBe(true)
    expect(family.get('.case-facts').text()).toContain('展開')
  })

  it('1100px 以下一欄，順序：處理區 → 招生資料 → 時間線 → 家長資料 → 設定列 → 排除入口', () => {
    const source = readFileSync(join(__dirname, '..', 'views/VisitDetailView.vue'), 'utf8')
    const narrow = source.slice(source.indexOf('@media (max-width: 1100px)'))
    expect(narrow).toMatch(/\.detail__main,\s*\.detail__side\s*{\s*display: contents;/)
    const order = (cls: string) => Number(new RegExp(`\\.${cls} {\\s*order: (\\d+);`).exec(narrow)?.[1])
    expect([order('detail__family-actions'), order('detail__family-data'), order('detail__notes'), order('case-facts'), order('case-settings'), order('exclusion-action')]).toEqual([1, 2, 3, 4, 5, 6])
  })
})

// ---- 併自 uxRound6.test.ts（2026-10-20 依功能整併測試檔）----
// 官網後台第六輪 UX（2026-09-29）：下一筆跟著來源列表、案件頁的標題層級、取消確認、
// 聯絡紀錄草稿、找不到頁面、頁首未讀連結、差異欄位名。2026-09-30 併入 main 時，與
// PR #15 平行做掉的項目（下一筆固定優先序、撥打鈕、無權限提示）改由 2026-09-28 那一輪的測試涵蓋（現併在 visitCase.test.ts）。
describe('2026-09-29 第六輪 UX：案件頁與下一筆', () => {
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

  describe('下一筆跟著來源列表', () => {

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
      expect(wrapper.find('.detail__next').text()).toContain('下一筆（這份列表還有 3 件）')
      await wrapper.find('.detail__next').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/visit-requests/c3')
      expect(router.currentRoute.value.query.list).toBe(list)
    })

    it('從接待頁籤點進來：list 的 view 與參觀時間排序原樣送給後端，下一筆照同一份往下（2026-10-06 預檢 I11）', async () => {
      const list = 'view=upcoming&order=visit_asc&campus_key=yihua'
      const rows = [{ id: 'case-a', status: 'confirmed' }, { id: 'c2', status: 'confirmed' }, { id: 'c3', status: 'confirmed' }]
      const { wrapper, get, router } = await mountDetail(kase({ status: 'confirmed' }), { '': rows }, `/visit-requests/case-a?list=${encodeURIComponent(list)}`)
      const call = get.mock.calls.map((c) => String(c[0])).find((p) => p.startsWith('/admin/visit-requests?'))!
      const params = new URLSearchParams(call.split('?')[1])
      expect(params.get('view')).toBe('upcoming')
      expect(params.get('order')).toBe('visit_asc')
      expect(params.get('campus_key')).toBe('yihua')
      expect(wrapper.find('.detail__next').text()).toContain('下一筆（這份列表還有 2 件）')
      await wrapper.find('.detail__next').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/visit-requests/c2')
      expect(router.currentRoute.value.query.list).toBe(list)
    })

    it('列表的搜尋字從瀏覽歷程的 state 帶進來：查清單放 header、不進網址，換下一筆時跟著帶（2026-10-22 資安稽核）', async () => {
      const list = 'status=contacting&order=oldest&campus_key=yihua'
      const rows = [{ id: 'case-a', status: 'contacting' }, { id: 'c2', status: 'contacting' }, { id: 'c3', status: 'contacting' }]
      const get = vi.spyOn(api, 'get').mockImplementation(async (p: string) => {
        if (p.startsWith('/admin/visit-requests?')) return rows as never
        if (p.endsWith('/contact-notes') || p.startsWith('/admin/slots')) return [] as never
        return kase({ status: 'contacting' }) as never
      })
      const router = makeRouter()
      // 舊連結夾帶的 q 不轉送。
      await router.push({ path: '/visit-requests/case-a', query: { list: `${list}&searched=1&q=0912345678` }, state: { listSearch: '0912345678' } })
      await router.isReady()
      const wrapper = mount(VisitDetailView, { global: { plugins: [makePinia(), router, ElementPlus] }, attachTo: document.body })
      wrappers.push(wrapper); await flushPromises()
      const listCall = () => get.mock.calls.filter((c) => String(c[0]).startsWith('/admin/visit-requests?')).at(-1)!
      expect(String(listCall()[0])).not.toContain('0912345678')
      const headers = (listCall()[1] as { headers: Record<string, string> }).headers
      expect(JSON.parse(decodeURIComponent(headers['X-Ivy-Search']!))).toEqual({ q: '0912345678' })

      await wrapper.find('.detail__next').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/visit-requests/c2')
      expect((router.options.history.state as { listSearch?: string }).listSearch).toBe('0912345678')
    })

    it('列表有搜尋、新分頁拿不到搜尋字（searched=1 但沒有 state）：不拿少了搜尋的清單當下一筆，改走預設佇列', async () => {
      const list = 'view=upcoming&order=visit_asc&campus_key=yihua&searched=1'
      const { get } = await mountDetail(kase({ status: 'confirmed' }), {}, `/visit-requests/case-a?list=${encodeURIComponent(list)}`)
      const calls = get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/admin/visit-requests?'))
      expect(calls.some((p) => p.includes('view=upcoming'))).toBe(false)
      expect(calls.some((p) => p.includes('group=past'))).toBe(true)
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
      await router.push('/visit-requests?group=upcoming&order=oldest'); await router.isReady()
      const wrapper = mount(VisitRequestsView, { global: { plugins: [makePinia(), router, ElementPlus] } })
      wrappers.push(wrapper); await flushPromises()
      const link = wrapper.findAll('a').find((a) => a.attributes('href')?.startsWith('/visit-requests/case-a'))!
      expect(decodeURIComponent(link.attributes('href')!)).toContain('list=view=upcoming&order=oldest')

      await router.push('/visit-requests?group=all'); await flushPromises()
      const plain = wrapper.findAll('a').find((a) => a.attributes('href')?.startsWith('/visit-requests/case-a'))!
      expect(plain.attributes('href')).toBe('/visit-requests/case-a')
    })
  })

  describe('案件頁：手機、觸控與結構', () => {
    it('只有一個 h1（頁首的頁名），家長名字用 h2', async () => {
      const { wrapper } = await mountDetail(kase())
      expect(wrapper.find('h1').exists()).toBe(false)
      expect(wrapper.find('h2.detail__title').text()).toBe('王家長')
    })

    it('名額單位一律用「組」', async () => {
      const { wrapper } = await mountDetail(kase({ status: 'contacting' }))
      // 沒有時段時選單是空的；改看 slotLabel 的來源：選項文字用「組」。
      expect(wrapper.text()).not.toMatch(/剩 \d+ 位/)
    })
  })

  describe('取消需求與取消預約', () => {
    function promptSpy() {
      return vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
    }

    it('舊的需求（聯絡中）沒有取消區：不再有「取消這筆需求」', async () => {
      const prompt = promptSpy()
      const { wrapper } = await mountDetail(kase({ status: 'contacting' }))
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).not.toContain('取消這筆需求')
      expect(labels).not.toContain('取消預約')
      expect(prompt).not.toHaveBeenCalled()
    })

    it('已確認：叫「取消預約」，說明名額會釋出、沒有 Email 時請電話通知', async () => {
      const prompt = promptSpy()
      const { wrapper } = await mountDetail(kase({ status: 'confirmed', slot_id: 'slot-1', slot }))
      await wrapper.findAll('button').find((b) => b.text() === '取消預約')!.trigger('click')
      await flushPromises()
      const [message, title, options] = prompt.mock.calls[0]!
      expect(title).toBe('取消這筆預約？')
      expect(String(message)).toContain('名額會釋出')
      expect(String(message)).toContain('請電話通知家長')
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
    it('讀取中顯示骨架，不閃出空狀態', async () => {
      vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}) as never)
      const r = makeRouter()
      await r.push('/visit-requests'); await r.isReady()
      const wrapper = mount(VisitRequestsView, { global: { plugins: [makePinia(), r, ElementPlus] } })
      wrappers.push(wrapper); await flushPromises()
      expect(wrapper.find('.visit-list__skeleton').exists()).toBe(true)
      expect(wrapper.find('.requests-empty').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('還沒有任何參觀需求')
    })
  })

  describe('找不到頁面', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })

    it('網址不存在時落在後台版面內的「找不到這個頁面」', () => {
      const resolved = router.resolve('/no/such/page')
      expect(resolved.name).toBe('not-found')
      expect(resolved.matched[0]?.components?.default).toBeTruthy()
      expect(resolved.matched.length).toBe(2)
    })
  })

  describe('側欄只留案件數字，未讀通知在頁首', () => {
    it('頁首依權限列出內容通知的連結', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
      vi.spyOn(api, 'get').mockResolvedValue({ my_unread_notifications: 3 } as never)
      const pinia = makePinia('super_admin')
      const r = emptyRouter()
      await r.push('/'); await r.isReady()
      const wrapper = mount(AdminLayout, { global: { plugins: [pinia, r, ElementPlus] } })
      wrappers.push(wrapper); await flushPromises()
      const links = wrapper.findAll('.top__alert')
      expect(links.map((l) => l.attributes('aria-label'))).toEqual(['內容通知未讀 3'])
      expect(links[0]!.attributes('href')).toBe('/releases')
      expect(wrapper.find('.sidebar__badge').exists()).toBe(false)
      vi.unstubAllGlobals()
    })

    it('內容編輯進不了「站內通知」，只看到內容通知', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
      vi.spyOn(api, 'get').mockResolvedValue({ my_unread_notifications: 1 } as never)
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
      expect(contentFieldLabelFor('day_experience', 'film_poster')).toBe('影片封面')
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
})
