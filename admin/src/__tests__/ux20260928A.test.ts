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
import NotFoundView from '../views/NotFoundView.vue'
import { authGuard, reloadAfterChunkError, routes } from '../router'
import { landingPath, NAV_GROUPS, safeRedirectPath } from '../router/nav'
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
if (typeof (globalThis.localStorage as Storage | undefined)?.getItem !== 'function') vi.stubGlobal('localStorage', memoryStorage())

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
    await wrapper.get('[data-test="not-found-home"]').trigger('click')
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
    vi.stubGlobal('sessionStorage', memoryStorage())
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
