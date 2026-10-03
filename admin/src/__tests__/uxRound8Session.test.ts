// 2026-10-03 第八輪：登入逾時時未儲存的修改（稽核 09-28）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, type VNode } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError, setUnauthorizedHandler } from '../api/client'
import { redirectToLoginOnUnauthorized, resetUnauthorizedForTests } from '../router/unauthorized'
import { registerUnsavedChanges } from '../composables/useUnsavedChanges'
import { announceSignedIn, setSessionChannelFactory, type SessionChannelLike } from '../composables/sessionChannel'
import SessionLimitNotice from '../components/SessionLimitNotice.vue'
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
    expect(await auth.refreshSession()).toBe(true)
    expect(auth.sessionMaxExpiresAt).toBe('2026-10-03T12:00:00Z')
    auth.clearSession()
    expect(auth.sessionMaxExpiresAt).toBeNull()
  })
})
