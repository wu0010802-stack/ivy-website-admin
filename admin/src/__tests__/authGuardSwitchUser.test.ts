// 2026-10-12：同一個瀏覽器在別的分頁換了帳號（甲登出、改登乙）後，甲的分頁做任何動作會被導到
// 登入頁；登入頁的 authGuard 原本會拿 cookie 裡乙的 session 直接登回原本的頁面，甲以為自己
// 還在用自己的帳號。這裡註冊真的 authGuard，確認被登出導來的這一次不會自動換成別人。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import LoginView from '../views/LoginView.vue'
import { ApiError, api, setUnauthorizedHandler, triggerUnauthorized } from '../api/client'
import { authGuard } from '../router'
import { redirectToLoginOnUnauthorized, resetUnauthorizedForTests } from '../router/unauthorized'
import { registerUnsavedChanges } from '../composables/useUnsavedChanges'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
const cleanups: (() => void)[] = []
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  cleanups.splice(0).forEach(cleanup => cleanup())
  resetUnauthorizedForTests()
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const Blank = defineComponent({ template: '<div />' })
const userA = testUser('super_admin', { id: 'user-a', email: 'a@example.invalid', campus_keys: [] })
const userB = testUser('super_admin', { id: 'user-b', email: 'b@example.invalid', campus_keys: [] })
const meOf = (user: typeof userA) => ({ csrf_token: `csrf-${user.id}`, user, features: { admissions: false } })

/** 真的 authGuard ＋ 最小的路由表（不載入各頁面）；登入頁用真的 LoginView，才看得到顯示的文字。 */
function appRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/visit-requests', name: 'visit-requests', component: Blank },
      { path: '/:pathMatch(.*)*', name: 'any', component: Blank },
    ],
  })
  router.beforeEach(authGuard)
  return router
}

/** /auth/me 回 me、/auth/providers 都沒開；回傳的 spy 可以數 /auth/me 被打了幾次。 */
function mockApi(me: ReturnType<typeof meOf> | ApiError) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/auth/providers') return { google: false, line: false } as never
    if (me instanceof ApiError) throw me
    return me as never
  })
}
const meCalls = (spy: ReturnType<typeof mockApi>) => spy.mock.calls.filter(([path]) => path === '/auth/me').length

/** 甲正在 /visit-requests 做事，API 回 403「CSRF token 無效」（cookie 已被別的分頁換成乙的 session）。 */
async function aTabAfterSwitch(me: ReturnType<typeof meOf> | ApiError) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore(pinia)
  auth.user = userA
  auth.csrfToken = meOf(userA).csrf_token
  const router = appRouter()
  await router.push('/visit-requests')
  await router.isReady()
  setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
  const get = mockApi(me)
  const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: 'CSRF token 無效' }), { status: 403 }) as never,
  )
  await expect(api.post('/admin/visit-requests/x/arrived', {})).rejects.toBeInstanceOf(ApiError)
  await flushPromises()
  return { auth, router, wrapper, get }
}

describe('被登出導來登入頁時，不自動換成別人的身分', () => {
  it('被登出前先記住是誰（previousUserId），再清掉登入狀態', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = userA
    auth.csrfToken = 'csrf-a'
    // 只有導頁、沒有 authGuard：這個測試只看 store 的記錄。
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/login', name: 'login', component: Blank }, { path: '/:p(.*)*', component: Blank }],
    })
    await router.push('/visit-requests')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))

    triggerUnauthorized('session-changed')
    await flushPromises()

    expect(auth.previousUserId).toBe('user-a')
    expect(auth.user).toBeNull()
    expect(auth.csrfToken).toBeNull()
  })

  it('cookie 現在是乙：停在登入頁說明已改用其他帳號，store 不寫入乙的身分與 CSRF token', async () => {
    const { auth, router, wrapper } = await aTabAfterSwitch(meOf(userB))

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/visit-requests', reason: 'other-user' })
    expect(auth.user).toBeNull()
    expect(auth.csrfToken).toBeNull()
    expect(auth.previousUserId).toBe('user-a')
    expect(wrapper.get('[data-test="login-reason"]').text()).toContain('這個瀏覽器已改用其他帳號登入')
  })

  it('停在說明頁後按上一頁、或直接改網址到後台頁面：仍回登入頁，不拿 cookie 裡乙的身分進後台', async () => {
    const { auth, router, wrapper, get } = await aTabAfterSwitch(meOf(userB))
    expect(router.currentRoute.value.name).toBe('login')
    const before = meCalls(get)

    await router.push('/visit-requests')
    await flushPromises()

    expect(meCalls(get)).toBeGreaterThan(before)
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/visit-requests', reason: 'other-user' })
    expect(auth.user).toBeNull()
    expect(auth.csrfToken).toBeNull()
    expect(auth.previousUserId).toBe('user-a')
    expect(wrapper.get('[data-test="login-reason"]').text()).toContain('這個瀏覽器已改用其他帳號登入')
  })

  it('停在說明頁後 cookie 又換回甲：開後台頁面照舊恢復，並清掉 previousUserId', async () => {
    const { auth, router, get } = await aTabAfterSwitch(meOf(userB))
    get.mockImplementation(async (path: string) => {
      if (path === '/auth/providers') return { google: false, line: false } as never
      return meOf(userA) as never
    })

    await router.push('/visit-requests')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/visit-requests')
    expect(auth.user?.id).toBe('user-a')
    expect(auth.previousUserId).toBeNull()
  })

  it('cookie 還是甲（例如另一個分頁重新登入了同一個帳號）：照舊恢復並回到原本的頁面', async () => {
    const { auth, router } = await aTabAfterSwitch(meOf(userA))

    expect(router.currentRoute.value.fullPath).toBe('/visit-requests')
    expect(auth.user?.id).toBe('user-a')
    expect(auth.previousUserId).toBeNull()
  })

  it('reason=other-user 本身（keepalive 發現換帳號）同樣不自動換成別人', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore(pinia)
    auth.user = userA
    const router = appRouter()
    await router.push('/visit-requests')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    mockApi(meOf(userB))

    triggerUnauthorized('other-user')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('other-user')
    expect(auth.user).toBeNull()
  })

  it('停在登入頁後用密碼登入：登入成功就清掉 previousUserId', async () => {
    const { auth } = await aTabAfterSwitch(meOf(userB))
    vi.spyOn(api, 'post').mockResolvedValue({ csrf_token: 'csrf-b', user: userB, features: { admissions: false } } as never)

    await auth.login('b@example.invalid', 'pw')

    expect(auth.user?.id).toBe('user-b')
    expect(auth.previousUserId).toBeNull()
  })

  it('沒有 previousUserId（書籤直接開登入頁、重新整理）：行為不變，恢復 cookie 裡任何人的 session', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore(pinia)
    const router = appRouter()
    mockApi(meOf(userB))

    await router.push('/login?reason=session-changed&redirect=%2Fvisit-requests')
    await flushPromises()

    expect(auth.previousUserId).toBeNull()
    expect(auth.user?.id).toBe('user-b')
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests')
  })

  it('previousUserId 有值但 reason 不是換帳號（閒置逾時）：行為不變', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore(pinia)
    auth.previousUserId = 'user-a'
    const router = appRouter()
    mockApi(meOf(userB))

    await router.push('/login?reason=expired&redirect=%2Fvisit-requests')
    await flushPromises()

    expect(auth.user?.id).toBe('user-b')
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests')
  })

  it('cookie 裡沒有登入（/auth/me 回 401）：留在登入頁，不誤判成別人', async () => {
    const { auth, router } = await aTabAfterSwitch(new ApiError(401, '未登入'))

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('session-changed')
    expect(auth.user).toBeNull()
  })

  it('留在原頁的對話框選「放棄修改並重新登入」：同樣先記住是誰，導去登入頁後不自動換成別人', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore(pinia)
    auth.user = userA
    const router = appRouter()
    await router.push('/visit-requests')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    cleanups.push(registerUnsavedChanges(ref(true)))
    mockApi(meOf(userB))
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')

    triggerUnauthorized('session-changed')
    await flushPromises()

    expect(auth.previousUserId).toBe('user-a')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('other-user')
    expect(auth.user).toBeNull()
  })
})

describe('restoreSession 的 expectUserId', () => {
  it('回來的是別人：什麼都不寫、回 other-user；同一人與沒傳時照舊恢復', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    const get = mockApi(meOf(userB))

    expect(await auth.restoreSession({ expectUserId: 'user-a' })).toBe('other-user')
    expect(auth.user).toBeNull()
    expect(auth.csrfToken).toBeNull()

    expect(await auth.restoreSession({ expectUserId: 'user-b' })).toBe('restored')
    expect(auth.user?.id).toBe('user-b')

    auth.clearSession()
    expect(await auth.restoreSession()).toBe('restored')
    expect(auth.user?.id).toBe('user-b')
    expect(meCalls(get)).toBe(3)
  })

  it('401 回 none；斷線照舊丟出去', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(401, '未登入'))
    expect(await auth.restoreSession({ expectUserId: 'user-a' })).toBe('none')
    vi.spyOn(api, 'get').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(auth.restoreSession({ expectUserId: 'user-a' })).rejects.toThrow('Failed to fetch')
  })
})
