// 2026-09-28 後台外框、登入與帳號的 UX 修正（A 組：shell）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import AdminLayout from '../layouts/AdminLayout.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import LoginView from '../views/LoginView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import { authGuard, reloadAfterChunkError, routes } from '../router'
import { landingPath, NAV_GROUPS } from '../router/nav'
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
