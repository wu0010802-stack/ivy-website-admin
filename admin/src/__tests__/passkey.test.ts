import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { api, ApiError } from '../api/client'
import {
  assertionToJSON, authenticator, creationOptions, fromBase64Url, PasskeyError, registrationToJSON, requestOptions, toBase64Url,
} from '../api/passkey'
import PasskeyPanel from '../components/PasskeyPanel.vue'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 2026-11-27：指紋／臉部辨識登入（Passkey）。瀏覽器的 WebAuthn 用 authenticator 這層替換。

const wrappers: VueWrapper[] = []
beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const bytes = (...values: number[]) => new Uint8Array(values).buffer
const domError = (name: string) => Object.assign(new Error(name), { name })

describe('WebAuthn 參數與結果的轉換', () => {
  it('base64url 來回不掉資料（含 +／ 與沒有補 = 的長度）', () => {
    for (const sample of [[], [251, 255, 190], [1, 2, 3, 4], [0, 255, 62, 63, 64]]) {
      const encoded = toBase64Url(bytes(...sample))
      expect(encoded).not.toMatch(/[+/=]/)
      expect([...new Uint8Array(fromBase64Url(encoded))]).toEqual(sample)
    }
  })

  it('建立與取得參數的二進位欄位轉成 ArrayBuffer，其餘原樣', () => {
    const creation = creationOptions({
      challenge: toBase64Url(bytes(9, 9)), rp: { id: 'localhost', name: '後台' }, user: { id: toBase64Url(bytes(7)), name: 'a@b.c', displayName: 'A' },
      excludeCredentials: [{ id: toBase64Url(bytes(5, 6)), type: 'public-key' }], authenticatorSelection: { residentKey: 'required' },
    })
    expect([...new Uint8Array(creation.challenge as ArrayBuffer)]).toEqual([9, 9])
    expect([...new Uint8Array(creation.user.id as ArrayBuffer)]).toEqual([7])
    expect([...new Uint8Array(creation.excludeCredentials![0]!.id as ArrayBuffer)]).toEqual([5, 6])
    expect(creation.authenticatorSelection).toEqual({ residentKey: 'required' })
    const request = requestOptions({ challenge: toBase64Url(bytes(1)), rpId: 'localhost', userVerification: 'required' })
    expect(request.allowCredentials).toEqual([])
    expect(request.rpId).toBe('localhost')
  })

  it('結果轉回 JSON 給後端', () => {
    const base = { id: 'abc', rawId: bytes(1, 2), type: 'public-key', getClientExtensionResults: () => ({}), authenticatorAttachment: 'platform' }
    const created = registrationToJSON({ ...base, response: { clientDataJSON: bytes(3), attestationObject: bytes(4), getTransports: () => ['internal'] } } as unknown as PublicKeyCredential)
    expect(created).toMatchObject({ id: 'abc', rawId: 'AQI', response: { clientDataJSON: 'Aw', attestationObject: 'BA', transports: ['internal'] } })
    const asserted = assertionToJSON({ ...base, response: { clientDataJSON: bytes(3), authenticatorData: bytes(5), signature: bytes(6), userHandle: null } } as unknown as PublicKeyCredential)
    expect(asserted.response).toEqual({ clientDataJSON: 'Aw', authenticatorData: 'BQ', signature: 'Bg', userHandle: undefined })
  })
})

const CREATION = { challenge: 'AQ', rp: { id: 'localhost', name: '後台' }, user: { id: 'Bw', name: 'a@b.c', displayName: 'A' } }
const fakeCredential = { id: 'abc', rawId: bytes(1), type: 'public-key', response: { clientDataJSON: bytes(3), attestationObject: bytes(4), authenticatorData: bytes(5), signature: bytes(6), userHandle: null } } as unknown as Credential

async function mountPanel(existing: unknown[] = []) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser('reception')
  vi.spyOn(authenticator, 'supported').mockReturnValue(true)
  vi.spyOn(api, 'get').mockResolvedValue(existing as never)
  const wrapper = mount(PasskeyPanel, { props: { enabled: true }, global: { plugins: [pinia, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, auth }
}

describe('我的帳號：指紋／臉部辨識登入', () => {
  it('登記這台裝置：要參數→瀏覽器驗證→送回，清單與件數跟著更新', async () => {
    const { wrapper, auth } = await mountPanel()
    expect(wrapper.text()).toContain('尚未登記')
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => (
      path.endsWith('/register/options') ? { public_key: CREATION } : { id: 'p1', name: 'iPhone', backed_up: true, created_at: '2026-11-27T03:00:00Z', last_used_at: null }
    ) as never)
    const create = vi.spyOn(authenticator, 'create').mockResolvedValue(fakeCredential)
    await wrapper.get('[data-test="passkey-add"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledOnce()
    expect(post.mock.calls.map(([path]) => path)).toEqual(['/auth/passkeys/register/options', '/auth/passkeys/register/verify'])
    expect((post.mock.calls[1]![1] as { credential: { id: string } }).credential.id).toBe('abc')
    expect(wrapper.findAll('[data-test="passkey-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('已登記 1 台')
    expect(wrapper.text()).toContain('已同步到雲端')
    expect(auth.user?.passkey_count).toBe(1)
  })

  it('登入超過 10 分鐘：先問目前的密碼，帶著重送；自己取消指紋視窗不跳錯誤', async () => {
    const { wrapper } = await mountPanel()
    const reauthNeeded = new ApiError(403, { code: 'REAUTH_REQUIRED', message: '為了安全，請輸入目前的密碼' })
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(reauthNeeded).mockResolvedValueOnce({ public_key: CREATION } as never)
    vi.spyOn(authenticator, 'create').mockRejectedValue(domError('NotAllowedError'))
    await wrapper.get('[data-test="passkey-add"]').trigger('click')
    await flushPromises()
    const form = document.querySelector('[data-test="passkey-reauth-form"]') as HTMLFormElement
    expect(form).not.toBeNull()
    const input = form.querySelector('input[type="password"]') as HTMLInputElement
    input.value = 'my-current-password'
    input.dispatchEvent(new Event('input'))
    form.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(post.mock.calls[1]).toEqual(['/auth/passkeys/register/options', { current_password: 'my-current-password' }])
    expect(wrapper.findAll('[data-test="passkey-row"]')).toHaveLength(0)
    expect(document.querySelector('.el-message--error')).toBeNull()
  })

  it('瀏覽器不支援時不給按鈕，說明改用哪些瀏覽器；已登記的仍列得出來', async () => {
    const { wrapper } = await mountPanel([{ id: 'p1', name: 'Mac', backed_up: false, created_at: '2026-11-20T03:00:00Z', last_used_at: '2026-11-26T03:00:00Z' }])
    expect(wrapper.find('[data-test="passkey-add"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="passkey-row"]').text()).toContain('Mac')
    wrapper.unmount()
    wrappers.length = 0
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('reception')
    vi.spyOn(authenticator, 'supported').mockReturnValue(false)
    const plain = mount(PasskeyPanel, { props: { enabled: true }, global: { plugins: [pinia, ElementPlus] } })
    wrappers.push(plain)
    await flushPromises()
    expect(plain.find('[data-test="passkey-add"]').exists()).toBe(false)
    expect(plain.get('[data-test="passkey-unsupported"]').text()).toContain('Safari')
  })
})

async function mountLogin(providers: Record<string, boolean>, supported = true) {
  vi.spyOn(authenticator, 'supported').mockReturnValue(supported)
  vi.spyOn(api, 'get').mockResolvedValue(providers as never)
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', name: 'dashboard', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/login?redirect=%2Fvisit-requests')
  await router.isReady()
  const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, auth: useAuthStore(pinia) }
}

describe('登入頁：用指紋或臉部辨識登入', () => {
  it('後端有開、瀏覽器支援才有按鈕', async () => {
    expect((await mountLogin({ google: false, line: false, passkey: false })).wrapper.find('[data-test="login-passkey"]').exists()).toBe(false)
    expect((await mountLogin({ google: false, line: false, passkey: true }, false)).wrapper.find('[data-test="login-passkey"]').exists()).toBe(false)
    expect((await mountLogin({ google: false, line: false, passkey: true })).wrapper.find('[data-test="login-passkey"]').exists()).toBe(true)
  })

  it('按下後帶著「記住這台裝置」登入，成功就進後台原本要去的頁面', async () => {
    const { wrapper, router, auth } = await mountLogin({ google: false, line: false, passkey: true })
    const login = vi.spyOn(auth, 'loginWithPasskey').mockResolvedValue()
    await wrapper.get('[data-test="login-remember"] input').setValue(true)
    await wrapper.get('[data-test="login-passkey"]').trigger('click')
    await flushPromises()
    expect(login).toHaveBeenCalledWith(true)
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests')
  })

  it('自己取消不顯示錯誤；後台沒有這組時請改用密碼', async () => {
    const { wrapper, auth } = await mountLogin({ google: false, line: false, passkey: true })
    const login = vi.spyOn(auth, 'loginWithPasskey').mockRejectedValueOnce(new PasskeyError('cancelled'))
    await wrapper.get('[data-test="login-passkey"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    login.mockRejectedValueOnce(new ApiError(401, '沒辦法用這組指紋或臉部辨識登入，請改用密碼登入'))
    await wrapper.get('[data-test="login-passkey"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('請改用密碼登入')
    expect(wrapper.get('[data-test="login-passkey"]').attributes('disabled')).toBeUndefined()
  })
})
