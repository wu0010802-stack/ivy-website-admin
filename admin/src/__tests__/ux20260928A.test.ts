// 2026-09-28 後台外框、登入與帳號的 UX 修正（A 組：shell）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import AdminLayout from '../layouts/AdminLayout.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import LoginView from '../views/LoginView.vue'
import AccountView from '../views/AccountView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import { authGuard, reloadAfterChunkError, routes } from '../router'
import { landingPath, NAV_GROUPS, safeRedirectPath, SEARCH_ONLY_GROUP } from '../router/nav'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useAuthStore } from '../stores/auth'
import { api, ApiError, setUnauthorizedHandler } from '../api/client'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

// 正式站用 VITE_WEBSITE_ASSET_BASE= 空字串建置（後台和官網同網域）。
vi.mock('../config', () => ({
  WEBSITE_ASSET_BASE: '',
  websiteAssetUrl: (key: string) => `/assets/${key}.webp`,
}))

// 這個 jsdom 環境的 localStorage／sessionStorage 沒有 Storage 的方法，補最小實作。
function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  }
}
// 整個檔案共用一份，每個測試結束時清空（見 afterEach），不在個別測試裡 stubGlobal：
// restoreAllMocks 不會還原 stubGlobal，換掉的物件會一路留到後面的測試。
if (typeof (globalThis.localStorage as Storage | undefined)?.getItem !== 'function') vi.stubGlobal('localStorage', memoryStorage())
if (typeof (globalThis.sessionStorage as Storage | undefined)?.getItem !== 'function') vi.stubGlobal('sessionStorage', memoryStorage())

beforeAll(() => {
  // AdminLayout 用 matchMedia 判斷手機版、換頁時捲回頂端；jsdom 兩個都沒有。
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
  })
  Element.prototype.scrollIntoView = () => {}
})

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  setUnauthorizedHandler(null)
  localStorage.clear()
  sessionStorage.clear()
  document.body.innerHTML = ''
})

function user(role: UserOut['role'], overrides: Partial<UserOut> = {}): UserOut {
  return testUser(role, { email: 'staff@ivy.example', campus_keys: role === 'super_admin' ? [] : ['yihua'], ...overrides })
}

/** 用正式的路由表與 beforeEach 建一個 memory router。 */
function appRouter(signedIn?: UserOut) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore(pinia)
  if (signedIn) auth.user = signedIn
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.beforeEach(authGuard)
  return { pinia, auth, router }
}

// ----------------------------------------------------------------- 查看官網
describe('頁首「查看官網」（shell-1）', () => {
  it('正式站 base 是空字串時開官網首頁，不是 href="" 開回目前這頁後台', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = user('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: AdminLayout, children: [{ path: ':rest(.*)*', component: { render: () => h('div') } }] },
      { path: '/login', name: 'login', component: { render: () => h('div') } },
    ] })
    await router.push('/media')
    await router.isReady()
    const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    const link = wrapper.get('a.top__site')
    expect(link.attributes('href')).toBe('/')
    expect(link.attributes('target')).toBe('_blank')
    // 「草稿不會出現」原本只在 title，觸控與報讀器都讀不到。
    const note = wrapper.get(`#${link.attributes('aria-describedby')}`)
    expect(note.text()).toContain('草稿不會出現')
    // 滑鼠提示與報讀說明同一句，報讀器不會念兩種說法。
    expect(link.attributes('title')).toBe(note.text())
  })
})

// --------------------------------------------------------------- 找不到頁面
describe('網址不存在時（shell-3）', () => {
  it('留在後台外框裡顯示找不到頁面，不是整頁空白', async () => {
    const { router } = appRouter(user('super_admin'))
    await router.push('/content/old-page-name')
    expect(router.currentRoute.value.name).toBe('not-found')
    expect(router.currentRoute.value.matched[0]?.components?.default).toBe(AdminLayout)
    expect(router.currentRoute.value.meta.title).toBe('找不到頁面')
  })

  it('明確的路徑仍然優先，總覽不會被萬用路由搶走', async () => {
    const { router } = appRouter(user('super_admin'))
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('沒登入時照舊先登入，登入後回到原本的網址', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, '未登入'))
    const { router } = appRouter()
    await router.push('/no-such-page')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/no-such-page')
  })

  it('按鈕回到這個角色的起始頁（編輯沒有總覽）', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = user('editor')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
    await router.push('/typo')
    await router.isReady()
    const wrapper = mount(NotFoundView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    expect(wrapper.text()).toContain('找不到這個頁面')
    // 是連結不是按鈕：可以中鍵開新分頁，報讀器念「連結」。
    const home = wrapper.get('[data-test="not-found-home"]')
    expect(home.element.tagName).toBe('A')
    expect(home.attributes('href')).toBe(landingPath('editor'))
    await home.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(landingPath('editor'))
  })
})

// ------------------------------------------------------------ 沒權限的深連結
describe('沒有權限的深連結（shell-4）', () => {
  it('編輯登入後經過 / 被送到起始頁，不算被拒、不提示', async () => {
    const { router } = appRouter(user('editor'))
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    await router.push('/')
    expect(router.currentRoute.value.path).toBe(landingPath('editor'))
    expect(router.currentRoute.value.query.denied).toBeUndefined()
  })

  it('明確連到沒權限的頁面時帶 denied，外框提示一次後清掉', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    const { pinia, router } = appRouter(user('editor'))
    await router.push('/visit-requests/abc')
    expect(router.currentRoute.value.path).toBe(landingPath('editor'))
    expect(router.currentRoute.value.query.denied).toBe('visit-detail')

    const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0]?.[0]).toMatchObject({ message: expect.stringContaining('「案件明細」的權限') })
    expect(router.currentRoute.value.query.denied).toBeUndefined()
    expect(router.currentRoute.value.path).toBe(landingPath('editor'))
  })

  it('校區管理者開 /users 也會說明', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const { router } = appRouter(user('campus_admin'))
    await router.push('/users')
    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.query.denied).toBe('users')
  })
})

// --------------------------------------------------------------- 分頁載入
describe('頁面點進去才下載（shell-9／cc-8）', () => {
  it('登入頁與外框直接打包，其餘頁面都是延遲載入', () => {
    expect(routes[0]?.component).toBe(LoginView)
    expect(routes[1]?.component).toBe(AdminLayout)
    const children = routes[1]?.children ?? []
    expect(children.length).toBeGreaterThan(25)
    expect(children.every(child => typeof child.component === 'function')).toBe(true)
  })

  it('部署換掉舊檔時整頁重載一次；10 秒內同一頁再失敗就請使用者自己重新整理', () => {
    const navigate = vi.fn()
    const error = vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    const chunkError = new TypeError('Failed to fetch dynamically imported module: https://x/admin/assets/UsersView-abc.js')
    expect(reloadAfterChunkError(new Error('別的錯誤'), '/admin/users', navigate)).toBe(false)
    expect(reloadAfterChunkError(chunkError, '/admin/users', navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/admin/users')
    expect(reloadAfterChunkError(chunkError, '/admin/users', navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('頁面的樣式檔載入失敗（Vite 的 Unable to preload CSS）也重載', () => {
    const navigate = vi.fn()
    const cssError = new Error('Unable to preload CSS for https://x/admin/assets/UsersView-abc.css')
    expect(reloadAfterChunkError(cssError, '/admin/users', navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/admin/users')
  })

  it('每個側欄項目都有圖示（圖示改成逐一 import）', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = user('super_admin')
    localStorage.setItem('ivy-admin-nav-expanded', JSON.stringify({ overview: true, visits: true, home: true, campus: true, site: true, system: true }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
    await router.push('/media')
    await router.isReady()
    const wrapper = mount(AdminSidebar, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    const links = wrapper.findAll('.sidebar__link')
    expect(links).toHaveLength(NAV_GROUPS.flatMap(group => group.items).length)
    expect(links.every(link => link.find('.el-icon svg').exists())).toBe(true)
  })
})

// ------------------------------------------------------------- 被導回登入頁
describe('被導回登入頁時說明原因（shell-2c）', () => {
  it('從連結進來但沒登入：帶 redirect 與 reason=signin；直接開首頁不帶', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, '未登入'))
    const { router } = appRouter()
    await router.push('/visit-requests/abc?from=line')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/visit-requests/abc?from=line', reason: 'signin' })

    const fresh = appRouter()
    await fresh.router.push('/')
    expect(fresh.router.currentRoute.value.name).toBe('login')
    expect(fresh.router.currentRoute.value.query).toEqual({})
  })

  async function mountLogin(path: string) {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/:rest(.*)*', component: { render: () => h('div') } },
    ] })
    await router.push(path)
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, router, auth: useAuthStore(pinia) }
  }

  it.each([
    ['expired', 'info', '登入已逾時，請重新登入；登入後會回到剛才的頁面'],
    ['signin', 'info', '請先登入'],
    ['offline', 'warning', '連不上伺服器'],
  ])('reason=%s 顯示 %s 提示，不是紅色的帳密錯誤', async (reason, type, text) => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper } = await mountLogin(`/login?redirect=%2Fmedia&reason=${reason}`)
    expect(wrapper.get('[data-test="login-reason"]').text()).toContain(text)
    expect(wrapper.find(`.el-alert--${type}`).exists()).toBe(true)
    expect(wrapper.find('.el-alert--error').exists()).toBe(false)
  })

  it('不認得的 reason 不顯示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper } = await mountLogin('/login?reason=<script>')
    expect(wrapper.find('[data-test="login-reason"]').exists()).toBe(false)
  })
})

// ------------------------------------------------------------------- 登出
describe('登出前先問未儲存的修改（shell-2b）', () => {
  const DirtyPage = defineComponent({
    setup() {
      useUnsavedChanges(ref(true))
      return () => h('p', '有未儲存的修改')
    },
  })

  async function mountShell() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore(pinia)
    auth.user = user('super_admin')
    const records: RouteRecordRaw[] = [
      { path: '/login', name: 'login', component: { render: () => h('div', '登入頁') } },
      { path: '/', component: AdminLayout, children: [
        { path: 'content/home-about', component: DirtyPage },
        { path: ':rest(.*)*', component: { render: () => h('div') } },
      ] },
    ]
    const router = createRouter({ history: createMemoryHistory(), routes: records })
    router.beforeEach(authGuard)
    // 正式 router 有 onError（處理分頁檔載入失敗），登出失敗的錯誤也會經過它。
    router.onError(() => {})
    await router.push('/content/home-about')
    await router.isReady()
    const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, router, auth }
  }

  it('選「留在這頁」就不登出，仍是登入狀態、留在原頁', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { wrapper, router, auth } = await mountShell()
    await wrapper.get('button[aria-label="登出"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(post).not.toHaveBeenCalledWith('/auth/logout')
    expect(auth.user).not.toBeNull()
    expect(auth.logoutPending).toBe(false)
    expect(router.currentRoute.value.path).toBe('/content/home-about')
    expect(wrapper.find('.sidebar__user').exists()).toBe(true)
  })

  it('選「放棄修改」才呼叫登出，只問一次', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper, router, auth } = await mountShell()
    await wrapper.get('button[aria-label="登出"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/auth/logout')
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('連按兩下登出只問一次、只送一次', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper, router } = await mountShell()
    const button = wrapper.get('button[aria-label="登出"]')
    await button.trigger('click')
    await button.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('登出請求失敗時留在原頁、保持登入並提示再按一次', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never)
    vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const error = vi.spyOn(ElMessage, 'error')
    const { wrapper, router, auth } = await mountShell()
    await wrapper.get('button[aria-label="登出"]').trigger('click')
    await flushPromises()
    expect(auth.user).not.toBeNull()
    expect(router.currentRoute.value.path).toBe('/content/home-about')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('請再按一次登出'))
  })

  it('登出還沒回應時點了別的連結：登出完成後仍回到登入頁，不停在沒有登入者的頁面', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, '未登入'))
    let finishLogout!: () => void
    vi.spyOn(api, 'post').mockReturnValue(new Promise<never>(resolve => { finishLogout = () => resolve(undefined as never) }))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper, router, auth } = await mountShell()
    await wrapper.get('button[aria-label="登出"]').trigger('click')
    await flushPromises()
    await router.push('/media')
    expect(router.currentRoute.value.path).toBe('/media')
    finishLogout()
    await flushPromises()
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('登出端點回 401（session 早就失效）不再觸發全域導向', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
    await expect(api.post('/auth/logout')).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ 登入頁
describe('登入頁（shell-10／shell-11／jr-login-back）', () => {
  async function mountLogin(path = '/login') {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/:rest(.*)*', component: { render: () => h('div') } },
    ] })
    await router.push(path)
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, router, auth: useAuthStore(pinia) }
  }

  async function submit(wrapper: VueWrapper) {
    await wrapper.get('input[type="email"]').setValue('staff@ivy.example')
    await wrapper.get('input[type="password"]').setValue('password-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
  }

  it('登入成功用 replace 回到原頁，登入頁不留在瀏覽紀錄裡', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper, router, auth } = await mountLogin('/login?redirect=%2Fvisit-requests%2Fabc')
    vi.spyOn(auth, 'login').mockResolvedValue()
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    await submit(wrapper)
    expect(replace).toHaveBeenCalledWith('/visit-requests/abc')
    expect(push).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/visit-requests/abc')
  })

  it.each([
    [new ApiError(502, { statusCode: 502, statusMessage: 'Bad Gateway', message: 'fetch failed' }), '伺服器暫時無法回應', '502'],
    [new ApiError(500, { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'abcdef1234567890' }), '（錯誤編號 abcdef12）', '500'],
    [new ApiError(403, 'Forbidden'), '登入沒有完成', '403'],
  ])('其他錯誤不顯示狀態碼：%s', async (error, expected, status) => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper, auth } = await mountLogin()
    vi.spyOn(auth, 'login').mockRejectedValue(error)
    await submit(wrapper)
    expect(wrapper.text()).toContain(expected)
    expect(wrapper.text()).not.toContain(status)
    expect(wrapper.text()).not.toContain('fetch failed')
  })

  it('用書籤開登入頁時 session 還有效：直接恢復並前往目的頁，不必再登入', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 't', user: user('super_admin') } as never)
    const { router, auth } = appRouter()
    await router.push('/login?redirect=%2Fmedia')
    expect(get).toHaveBeenCalledWith('/auth/me')
    expect(auth.user?.role).toBe('super_admin')
    expect(router.currentRoute.value.path).toBe('/media')

    const plain = appRouter()
    await plain.router.push('/login')
    expect(plain.router.currentRoute.value.path).toBe(landingPath('super_admin'))
  })

  it('session 已失效時照常顯示登入頁，不會因為 /auth/me 回 401 繞圈', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, '未登入'))
    const { router } = appRouter()
    await router.push('/login?redirect=%2Fmedia')
    expect(router.currentRoute.value.name).toBe('login')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('逾時後在別的分頁重新登入，回到這一頁重新整理就直接回到原頁', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 't', user: user('editor') } as never)
    const { router } = appRouter()
    await router.push('/login?redirect=%2Fmedia&reason=expired')
    expect(router.currentRoute.value.path).toBe('/media')
  })

  it('連不上伺服器不當成已登出：帶 reason=offline，登入頁提供重新整理', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    const { router, auth } = appRouter()
    await router.push('/media')
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/media', reason: 'offline' })

    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper } = await mountLogin('/login?redirect=%2Fmedia&reason=offline')
    expect(wrapper.get('[data-test="login-reason"]').text()).toContain('重新整理')
  })

  it('伺服器恢復後重新整理、session 已失效：拿掉「連不上伺服器」，改成請先登入', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, '未登入'))
    const { router } = appRouter()
    await router.push('/login?redirect=%2Fmedia&reason=offline')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/media', reason: 'signin' })

    // 直接開首頁時沒有 redirect，也就不必說明。
    const plain = appRouter()
    await plain.router.push('/login?reason=offline')
    expect(plain.router.currentRoute.value.name).toBe('login')
    expect(plain.router.currentRoute.value.query).toEqual({})
  })

  it('還是連不上伺服器時保留 reason=offline', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('Failed to fetch'))
    const { router } = appRouter()
    await router.push('/login?redirect=%2Fmedia&reason=offline')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/media', reason: 'offline' })
  })

  it('restoreSession 只有 401 視為沒登入，斷線要丟出去', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(401, '未登入'))
    await expect(auth.restoreSession()).resolves.toBeUndefined()
    vi.spyOn(api, 'get').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(auth.restoreSession()).rejects.toThrow('Failed to fetch')
    expect(auth.user).toBeNull()
  })

  it('redirect 只接受站內路徑', () => {
    expect(safeRedirectPath('/visit-requests/abc?x=1')).toBe('/visit-requests/abc?x=1')
    expect(safeRedirectPath('//evil.example')).toBeNull()
    expect(safeRedirectPath('https://evil.example')).toBeNull()
    expect(safeRedirectPath('/login')).toBeNull()
    expect(safeRedirectPath('/%2e%2e/x')).toBeNull()
    expect(safeRedirectPath(['/media'])).toBeNull()
  })
})

// -------------------------------------------------------------- 側欄搜尋
describe('側欄搜尋比對員工自己的說法（v-shell-07／shell-8）', () => {
  async function sidebar(role: UserOut['role'], path = '/media') {
    const pinia = createPinia()
    useAuthStore(pinia).user = user(role)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
    await router.push(path)
    await router.isReady()
    const wrapper = mount(AdminSidebar, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    const search = async (text: string) => {
      await wrapper.get('input').setValue(text)
      return wrapper.findAll('.sidebar__nav a').map(link => link.text())
    }
    return { wrapper, router, search }
  }

  it('搜「預約」帶出參觀案件、接待月曆、時段與容量，不只名稱有預約的兩項', async () => {
    const { search } = await sidebar('super_admin')
    const results = await search('預約')
    expect(results).toEqual(expect.arrayContaining(['參觀案件', '接待月曆', '時段與容量', '各校預約方式', '預約文案']))
  })

  it('照片、名額、FAQ（全形也可）、小寫 line 都找得到', async () => {
    const { search } = await sidebar('super_admin')
    expect(await search('照片')).toContain('素材庫')
    expect(await search('名額')).toEqual(['時段與容量'])
    expect(await search('ＦＡＱ')).toEqual(['各校常見問題', '共用常見問題'])
    expect(await search('line')).toEqual(expect.arrayContaining(['LINE 通知', '我的帳號']))
  })

  it('完全相同的說法排第一，按 Enter 開的就是它；同分維持側欄順序', async () => {
    const { wrapper, router, search } = await sidebar('super_admin')
    expect(await search('預約')).toEqual(['參觀案件', '接待月曆', '時段與容量', '各校預約方式', '預約文案'])
    expect(await search('line')).toEqual(['LINE 通知', '我的帳號'])
    await search('密碼')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/account')
  })

  it('我的帳號只在搜尋時出現；搜「密碼」照角色給結果', async () => {
    const admin = await sidebar('super_admin')
    expect(admin.wrapper.find('.sidebar__nav a[href="/account"]').exists()).toBe(false)
    // 「密碼」跟我的帳號的關鍵字完全相同，排在「使用者」（重設密碼）前面。
    expect(await admin.search('密碼')).toEqual(['我的帳號', '使用者'])
    expect(admin.wrapper.find('.sidebar__nav a[href="/account"] .el-icon svg').exists()).toBe(true)
    expect(SEARCH_ONLY_GROUP.items.map(item => item.path)).toEqual(['/account'])
    const reception = await sidebar('reception')
    expect(await reception.search('密碼')).toEqual(['我的帳號'])
    expect(await reception.search('預約')).toEqual(['參觀案件', '接待月曆', '時段與容量'])
  })

  it('按 Enter 前往第一筆結果，選字中的 Enter 不算', async () => {
    const { wrapper, router, search } = await sidebar('super_admin')
    await search('名額')
    const input = wrapper.get('input')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/media')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/slots')
    expect(input.element.value).toBe('')
  })

  it('搜尋框是空的時按 Enter 不換頁', async () => {
    const { wrapper, router, search } = await sidebar('super_admin')
    const push = vi.spyOn(router, 'push')
    const input = wrapper.get('input')
    await input.trigger('keydown', { key: 'Enter' })
    // 打了字又清掉（手機鍵盤的「前往」）也一樣。
    await search('名額')
    await search('  ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/media')
  })
})

// ------------------------------------------------------------- 側欄帳號區
describe('側欄帳號區（v-shell-13／shell-12）', () => {
  async function sidebar(signedIn: UserOut, mobile = false) {
    const pinia = createPinia()
    useAuthStore(pinia).user = signedIn
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
    await router.push('/media')
    await router.isReady()
    const wrapper = mount(AdminSidebar, { props: { mobile }, global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    return wrapper
  }

  it.each([
    ['reception', '櫃台・義華'],
    ['editor', '編輯・義華'],
    ['readonly', '唯讀・義華'],
    ['campus_admin', '校區管理者・義華'],
    ['super_admin', '總管理者'],
  ] as const)('%s 顯示「%s」，完整 Email 放在 title', async (role, line) => {
    const wrapper = await sidebar(user(role))
    expect(wrapper.get('.sidebar__user-text span').text()).toBe(line)
    expect(wrapper.get('a.sidebar__account').attributes('title')).toContain('staff@ivy.example')
  })

  it('手機抽屜的更改密碼與登出直接寫字', async () => {
    const wrapper = await sidebar(user('reception'), true)
    const labels = wrapper.findAll('.sidebar__user-actions button').map(button => button.text())
    expect(labels).toEqual(['更改密碼', '登出'])
    await wrapper.findAll('.sidebar__user-actions button')[1]!.trigger('click')
    expect(wrapper.emitted('logout')).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ 我的帳號
describe('我的帳號：密碼與登入方式（v-shell-08／shell-7）', () => {
  async function account(signedIn: UserOut, providers: { google: boolean; line: boolean }) {
    vi.spyOn(api, 'get').mockResolvedValue(providers as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = signedIn
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
    await router.push('/account')
    await router.isReady()
    const wrapper = mount(AccountView, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('有更改密碼的入口，打開既有的更改密碼對話框', async () => {
    const wrapper = await account(user('reception'), { google: true, line: true })
    await wrapper.get('[data-test="change-password"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.el-dialog__title')?.textContent).toBe('更改密碼')
  })

  it('寫出角色能做什麼與額外授權（不印代碼）', async () => {
    const wrapper = await account(user('campus_admin', { capabilities: ['booking.export', 'unknown.code'] }), { google: true, line: true })
    expect(wrapper.text()).toContain('處理指定校區的內容')
    expect(wrapper.text()).toContain('額外授權匯出個資')
    expect(wrapper.text()).not.toContain('unknown.code')
  })

  it('兩種都沒開放：收成一行，不留「尚未綁定」標籤與 LINE 隱私說明', async () => {
    const wrapper = await account(user('editor'), { google: false, line: false })
    expect(wrapper.get('[data-test="password-only"]').text()).toBe('目前只開放 Email 與密碼登入。')
    expect(wrapper.text()).not.toContain('尚未綁定')
    expect(wrapper.text()).not.toContain('Google 登入')
    expect(wrapper.text()).not.toContain('LINE 登入')
    expect(wrapper.text()).not.toContain('不讀取暱稱')
  })

  it('只有一種沒開放：那張卡不掛標籤、不寫隱私說明', async () => {
    const wrapper = await account(user('editor'), { google: true, line: false })
    const panels = wrapper.findAll('section.panel')
    const line = panels.find(panel => panel.text().startsWith('LINE 登入'))!
    expect(line.text()).toContain('LINE 登入尚未啟用')
    expect(line.find('.el-tag').exists()).toBe(false)
    expect(line.text()).not.toContain('不讀取暱稱')
    const google = panels.find(panel => panel.text().startsWith('Google 登入'))!
    expect(google.get('.el-tag').text()).toBe('尚未綁定')
    expect(wrapper.find('[data-test="password-only"]').exists()).toBe(false)
  })

  it('沒開放但已綁定 LINE：保留卡片讓人解除，隱私說明照樣顯示', async () => {
    const wrapper = await account(user('editor', { line_linked: true }), { google: false, line: false })
    expect(wrapper.get('[data-test="line-disabled-linked"]').text()).toContain('LINE 登入目前未開放')
    expect(wrapper.text()).toContain('不讀取暱稱')
    expect(wrapper.text()).not.toContain('Google 登入')
  })
})
