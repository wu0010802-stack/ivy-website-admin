import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import LoginView from '../views/LoginView.vue'
import { ApiError, api, setUnauthorizedHandler } from '../api/client'
import { redirectToLoginOnUnauthorized } from '../router/unauthorized'
import { registerUnsavedChanges, useUnsavedChanges } from '../composables/useUnsavedChanges'
import { KEEPALIVE_INTERVAL_MS, startSessionKeepAlive } from '../composables/sessionKeepAlive'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 2026-09-29 起 session 閒置 120 分鐘就失效（後端回 401）。用到一半被登出時，
// 登入頁要講清楚原因，不能看起來像系統壞掉。

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  setUnauthorizedHandler(null)
})

const Blank = defineComponent({ template: '<div />' })

async function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: Blank },
      { path: '/:pathMatch(.*)*', name: 'any', component: Blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  return router
}

function respond401() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
}

describe('用到一半收到 401：導回登入頁並標示閒置逾時', () => {
  it('清掉登入狀態，帶原本的路徑與 reason=expired', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('super_admin', { id: 'u1', email: 'admin@example.invalid', campus_keys: [] })
    const router = await routerAt('/visit-requests?status=pending')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    respond401()

    await expect(api.get('/admin/visit-requests')).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/visit-requests?status=pending', reason: 'expired' })
  })

  it('首頁被登出時不帶 redirect，仍標示 reason=expired', async () => {
    setActivePinia(createPinia())
    useAuthStore().user = testUser('super_admin', { id: 'u1', email: 'admin@example.invalid', campus_keys: [] })
    const router = await routerAt('/')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    respond401()

    await expect(api.post('/admin/media/x/replace', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ reason: 'expired' })
  })

  it('本來就沒登入（第一次載入的 /auth/me）不導向、不標示', async () => {
    setActivePinia(createPinia())
    const router = await routerAt('/media')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    respond401()

    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/media')
  })
})

describe('登入頁的閒置逾時說明（reason=expired，與 PR #15 的 reason 提示共用）', () => {
  async function mountLogin(path: string) {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/:rest(.*)', name: 'dashboard', component: Blank },
      ],
    })
    await router.push(path)
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [createPinia(), router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('reason=expired 時說明登入已逾時，重新送出登入失敗時改顯示帳密錯誤', async () => {
    const wrapper = await mountLogin('/login?redirect=%2Fmedia&reason=expired')
    expect(wrapper.get('[data-test="login-reason"]').text()).toContain('登入已逾時')
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(401, '帳號或密碼錯誤'))
    await wrapper.find('input[type="email"]').setValue('staff@ivy.example')
    await wrapper.find('input[type="password"]').setValue('wrong-password-xx')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-test="login-reason"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('帳號或密碼錯誤')
  })

  it('一般進入登入頁不顯示', async () => {
    const wrapper = await mountLogin('/login?redirect=%2Fmedia')
    expect(wrapper.find('[data-test="login-reason"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('登入已逾時')
  })

  it('OAuth 錯誤優先顯示，不同時疊兩個提示', async () => {
    const wrapper = await mountLogin('/login?oauth_error=line_failed&reason=expired')
    expect(wrapper.text()).toContain('LINE 登入未完成或已逾時')
    expect(wrapper.find('[data-test="login-reason"]').exists()).toBe(false)
  })

  it('Google／LINE 登入連結只帶 redirect，不把 reason 帶進去', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/login', name: 'login', component: LoginView }, { path: '/:rest(.*)', component: Blank }],
    })
    await router.push('/login?redirect=%2Fmedia&reason=expired')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [createPinia(), router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('a[href*="/auth/google/login"]').attributes('href')).toBe('/api/website/v1/auth/google/login?redirect=%2Fmedia')
  })
})

describe('有未儲存的修改時收到 401：留在原頁，重新登入後再儲存', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup())
  })

  function dirtyPage() {
    const dirty = ref(true)
    cleanups.push(registerUnsavedChanges(dirty))
    return dirty
  }

  it('不清登入狀態、不換頁；按「我已重新登入」後取回新的 CSRF token', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('editor', { id: 'u1', email: 'editor@example.invalid', campus_keys: ['yihua'] })
    auth.csrfToken = 'old-token'
    const router = await routerAt('/content/campus-profile?campus=yihua')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    dirtyPage()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'new-token', user: auth.user }), { status: 200 }) as never)

    await expect(api.post('/admin/content-items/campus_profile/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(confirm).toHaveBeenCalledTimes(1)
    const message = confirm.mock.calls[0]![0]
    expect(typeof message === 'string' ? message : mount(defineComponent({ render: () => message as never })).text()).toContain('修改還沒儲存')
    expect(router.currentRoute.value.fullPath).toBe('/content/campus-profile?campus=yihua')
    expect(auth.user).not.toBeNull()
    expect(auth.csrfToken).toBe('new-token')
  })

  it('選「放棄修改並重新登入」才導去登入頁，而且不再問一次放棄修改', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('editor', { id: 'u1', email: 'editor@example.invalid', campus_keys: ['yihua'] })
    const Editor = defineComponent({
      setup() {
        useUnsavedChanges(ref(true))
        return {}
      },
      template: '<div />',
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: defineComponent({ template: '<div />' }) },
        { path: '/content/news', name: 'news', component: Editor },
      ],
    })
    await router.push('/content/news')
    await router.isReady()
    const wrapper = mount(defineComponent({ template: '<router-view />' }), { global: { plugins: [router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    respond401()

    await expect(api.post('/admin/content-items/news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/content/news', reason: 'expired' })
  })

  it('沒有未儲存的修改時照原本直接導去登入頁', async () => {
    setActivePinia(createPinia())
    useAuthStore().user = testUser('super_admin', { id: 'u1', email: 'admin@example.invalid', campus_keys: [] })
    const clean = ref(false)
    cleanups.push(registerUnsavedChanges(clean))
    const router = await routerAt('/content/news')
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    respond401()

    await expect(api.get('/admin/content-items')).rejects.toBeInstanceOf(ApiError)
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('login')
  })
})

describe('操作中自動延長閒置期限', () => {
  it('有輸入時最多每 10 分鐘打一次 /auth/me；沒登入或沒輸入不打', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    let now = 1_000_000
    const target = new EventTarget()
    const refresh = vi.spyOn(auth, 'refreshSession').mockResolvedValue('ok')
    const stop = startSessionKeepAlive({ now: () => now, target: target as unknown as Window })
    try {
      now += KEEPALIVE_INTERVAL_MS
      target.dispatchEvent(new Event('keydown'))
      expect(refresh).not.toHaveBeenCalled() // 沒登入

      auth.user = testUser('editor', { id: 'u1', email: 'editor@example.invalid', campus_keys: ['yihua'] })
      target.dispatchEvent(new Event('keydown'))
      await flushPromises()
      expect(refresh).toHaveBeenCalledTimes(1)

      now += KEEPALIVE_INTERVAL_MS - 1
      target.dispatchEvent(new Event('input'))
      target.dispatchEvent(new Event('pointerdown'))
      await flushPromises()
      expect(refresh).toHaveBeenCalledTimes(1) // 10 分鐘內不再打

      now += 1
      target.dispatchEvent(new Event('pointerdown'))
      await flushPromises()
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally {
      stop()
    }
    now += KEEPALIVE_INTERVAL_MS
    target.dispatchEvent(new Event('keydown'))
    expect(refresh).toHaveBeenCalledTimes(2) // 停止後不再監聽
  })
})
