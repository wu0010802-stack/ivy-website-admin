// 2026-10-03 第八輪：登入逾時時未儲存的修改（稽核 09-28）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, type VNode } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from '../api/client'
import { redirectToLoginOnUnauthorized, resetUnauthorizedForTests } from '../router/unauthorized'
import { registerUnsavedChanges } from '../composables/useUnsavedChanges'
import { announceSignedIn, setSessionChannelFactory, type SessionChannelLike } from '../composables/sessionChannel'
import SessionLimitNotice from '../components/SessionLimitNotice.vue'
import { startSessionKeepAlive, KEEPALIVE_INTERVAL_MS } from '../composables/sessionKeepAlive'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const cleanups: (() => void)[] = []
afterEach(() => {
  resetUnauthorizedForTests()
  cleanups.splice(0).forEach((c) => c())
  setSessionChannelFactory(null)
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

// 同一個測試程序裡的假頻道：一個分頁 postMessage，其他頻道物件收到（自己收不到，跟 BroadcastChannel 一樣）。
function fakeBus() {
  const channels = new Set<SessionChannelLike>()
  setSessionChannelFactory(() => {
    const channel: SessionChannelLike = {
      onmessage: null,
      postMessage(message) { for (const other of channels) if (other !== channel) other.onmessage?.({ data: message }) },
      close() { channels.delete(channel) },
    }
    channels.add(channel)
    return channel
  })
}

const textOf = (message: unknown) => (typeof message === 'string' ? message : mount(defineComponent({ render: () => message as VNode })).text())

async function dirtyEditorAt(path: string) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = testUser('editor', { id: 'u1', email: 'editor@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: defineComponent({ template: '<div />' }) },
    { path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) },
  ] })
  await router.push(path); await router.isReady()
  setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
  cleanups.push(registerUnsavedChanges(ref(true)))
  return { auth, router }
}

describe('登入已逾時：一鍵開新分頁、別的分頁登入就自動接續', () => {
  it('對話框有「在新分頁打開登入頁」連結；別的分頁登入同一個帳號後自動接續，提醒再按一次儲存', async () => {
    fakeBus()
    const { auth, router } = await dirtyEditorAt('/content/news')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    const close = vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'new-token', user: auth.user, features: { admissions: false } }), { status: 200 }) as never)

    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()
    const message = textOf(confirm.mock.calls[0]![0])
    expect(message).toContain('修改還沒儲存')
    expect(message).toContain('在新分頁打開登入頁')

    announceSignedIn()
    await flushPromises()
    expect(close).toHaveBeenCalled()
    expect(auth.csrfToken).toBe('new-token')
    expect(success).toHaveBeenCalledWith('已恢復登入，請再按一次儲存。')
    expect(router.currentRoute.value.fullPath).toBe('/content/news')
  })

  it('新分頁登入的是別的帳號：不接續，提醒用原本的帳號登入', async () => {
    fakeBus()
    const { auth } = await dirtyEditorAt('/content/news')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const other = testUser('editor', { id: 'u2', email: 'other@example.invalid' })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'other-token', user: other, features: { admissions: false } }), { status: 200 }) as never)

    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()
    announceSignedIn()
    await flushPromises()
    expect(success).not.toHaveBeenCalled()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('登入的是另一個帳號')
    // 對話框重新出現，等原本的帳號登入；別人的 CSRF token 不留在這一頁，什麼都存不出去。
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(auth.user?.id).toBe('u1')
    expect(auth.csrfToken).toBeNull()
    expect(auth.sessionMaxExpiresAt).toBeNull()
  })

  it('別的帳號登入後，store 與 api client 都沒有對方的 CSRF token；原本的帳號之後登入仍會接續', async () => {
    fakeBus()
    setCsrfToken(null)
    const { auth } = await dirtyEditorAt('/content/news')
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const other = testUser('editor', { id: 'u2', email: 'other@example.invalid' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '未登入' }), { status: 401 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'other-token', user: other, features: { admissions: false }, session_max_expires_at: '2099-01-01T00:00:00Z' }), { status: 200 }) as never)
    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()
    announceSignedIn()
    await flushPromises()
    expect(auth.user?.id).toBe('u1')
    expect(auth.csrfToken).toBeNull()
    expect(auth.sessionMaxExpiresAt).toBeNull()

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'x' }), { status: 400 }) as never)
    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    const init = fetchSpy.mock.calls.at(-1)![1] as RequestInit
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBeNull()

    // 原本的帳號在新分頁登入（第二次廣播）：接續。
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: 'u1-token', user: auth.user, features: { admissions: false } }), { status: 200 }) as never)
    announceSignedIn()
    await flushPromises()
    expect(auth.csrfToken).toBe('u1-token')
    expect(success).toHaveBeenCalledWith('已恢復登入，請再按一次儲存。')
  })

  it('refreshSession 帶期望帳號：/auth/me 回別人就什麼都不寫（keepalive 也走這條）', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('editor', { id: 'u1' })
    vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 'x', user: testUser('editor', { id: 'u2' }), features: { admissions: true }, session_max_expires_at: '2099-01-01T00:00:00Z' } as never)
    expect(await auth.refreshSession('u1')).toBe('other-user')
    expect(auth.user?.id).toBe('u1')
    expect(auth.csrfToken).toBeNull()
    expect(auth.features.admissions).toBe(false)
    expect(auth.sessionMaxExpiresAt).toBeNull()
  })
})

describe('登入滿 12 小時前提醒', () => {
  function mountNotice(expiresInMinutes: number) {
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = testUser('editor')
    auth.sessionMaxExpiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
    return mount(SessionLimitNotice, { global: { plugins: [pinia, ElementPlus] } })
  }

  it('剩 15 分鐘內才出現，寫幾點到期、請先儲存', () => {
    const soon = mountNotice(10)
    expect(soon.text()).toContain('登入會在')
    expect(soon.text()).toContain('到期（每次登入最長 12 小時）')
    expect(soon.text()).toContain('還沒儲存的修改請先儲存')
    expect(mountNotice(30).find('.session-limit').exists()).toBe(false)
    expect(mountNotice(-1).find('.session-limit').exists()).toBe(false)
  })

  it('/auth/me 回的上限時間記進 store', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 't', user: testUser('editor'), features: { admissions: false }, session_max_expires_at: '2026-10-03T12:00:00Z' } as never)
    expect(await auth.refreshSession()).toBe('ok')
    expect(auth.sessionMaxExpiresAt).toBe('2026-10-03T12:00:00Z')
    auth.clearSession()
    expect(auth.sessionMaxExpiresAt).toBeNull()
  })
})

async function keepAliveOtherUser(dirty: boolean) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = testUser('editor', { id: 'u1', email: 'editor@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: defineComponent({ template: '<div />' }) },
    { path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) },
  ] })
  await router.push('/content/news'); await router.isReady()
  setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
  if (dirty) cleanups.push(registerUnsavedChanges(ref(true)))
  vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 'x', user: testUser('editor', { id: 'u2' }), features: { admissions: false } } as never)
  const target = new EventTarget()
  let now = 1_000_000
  const stop = startSessionKeepAlive({ now: () => now, target: target as unknown as Window })
  cleanups.push(stop)
  now += KEEPALIVE_INTERVAL_MS
  target.dispatchEvent(new Event('keydown'))
  await flushPromises()
  return { auth, router }
}

describe('同一台電腦換了帳號：舊分頁走集中處理', () => {
  it('keepalive 發現換帳號、沒有未儲存修改：清登入狀態、導登入頁並說明', async () => {
    const { auth, router } = await keepAliveOtherUser(false)
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('other-user')
    expect(router.currentRoute.value.query.redirect).toBe('/content/news')
  })

  it('keepalive 發現換帳號、有未儲存修改：留在原頁、顯示接續對話框，不寫入對方身分', async () => {
    fakeBus()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    const { auth, router } = await keepAliveOtherUser(true)
    expect(auth.user?.id).toBe('u1')
    expect(router.currentRoute.value.fullPath).toBe('/content/news')
    expect(textOf(confirm.mock.calls[0]![0])).toContain('這台電腦已經換成別的帳號登入')
  })

  it('API 回 403「CSRF token 無效」、有未儲存修改：留在原頁走接續流程，不是只顯示原字', async () => {
    fakeBus()
    const { auth, router } = await dirtyEditorAt('/content/news')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise(() => {}) as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'CSRF token 無效' }), { status: 403 }) as never)
    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toMatchObject({ status: 403 })
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(textOf(confirm.mock.calls[0]![0])).toContain('登入狀態已經改變')
    expect(auth.user?.id).toBe('u1')
    expect(router.currentRoute.value.fullPath).toBe('/content/news')
  })

  it('API 回 403「CSRF token 無效」、沒有未儲存修改：清登入狀態並導登入頁', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = testUser('editor', { id: 'u1' })
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/login', name: 'login', component: defineComponent({ template: '<div />' }) },
      { path: '/:p(.*)*', component: defineComponent({ template: '<div />' }) },
    ] })
    await router.push('/content/news'); await router.isReady()
    setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'CSRF token 無效' }), { status: 403 }) as never)
    await expect(api.post('/admin/content-items/home_news/revisions', {})).rejects.toBeInstanceOf(ApiError)
    await flushPromises()
    expect(auth.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('session-changed')
  })

  it('其他 403（沒權限、Origin 不符）：行為不變，不觸發登入處理', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '沒有權限' }), { status: 403 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Origin 不符' }), { status: 403 }) as never)
    await expect(api.post('/x', {})).rejects.toMatchObject({ status: 403, detail: '沒有權限' })
    await expect(api.post('/x', {})).rejects.toMatchObject({ status: 403, detail: 'Origin 不符' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('登入成功會廣播給別的分頁', () => {
  function spyChannel() {
    const postMessage = vi.fn()
    setSessionChannelFactory(() => ({ onmessage: null, postMessage, close: () => undefined }))
    return postMessage
  }

  it('login() 成功', async () => {
    const postMessage = spyChannel()
    setActivePinia(createPinia())
    vi.spyOn(api, 'post').mockResolvedValue({ csrf_token: 't', user: testUser('editor'), features: { admissions: false } } as never)
    await useAuthStore().login('a@example.invalid', 'pw')
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('restoreSession() 成功', async () => {
    const postMessage = spyChannel()
    setActivePinia(createPinia())
    vi.spyOn(api, 'get').mockResolvedValue({ csrf_token: 't', user: testUser('editor'), features: { admissions: false } } as never)
    await useAuthStore().restoreSession()
    expect(postMessage).toHaveBeenCalledTimes(1)
  })
})
