// 「我的帳號」的手機通知（2026-11-05）：composables/usePushNotifications.ts 的狀態判斷與訂閱流程，
// 以及 AccountView 的「手機通知」區塊在各狀態的畫面與按鈕。瀏覽器環境（Service worker、Notification、
// PushManager）一律用 pushEnv 換成假的；API 用 vi.spyOn(api, …)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import AccountView from '../views/AccountView.vue'
import { api, ApiError } from '../api/client'
import { PUSH_STATE_TEXT, pushEnv, urlBase64ToUint8Array } from '../composables/usePushNotifications'
import { registerPushWorker } from '../utils/pushWorker'
import { describeItem, itemLink, ITEM_LABELS } from '../utils/systemStatusFormat'
import { useAuthStore } from '../stores/auth'
import type { PushDeviceOut, Role, UserOut } from '../api/types'
import { testUser } from './fixtures'

const PUBLIC_KEY = `B${'A'.repeat(86)}` // 87 字元 base64url＝65 bytes，第一個 byte 是 0x04
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-device'
const originalEnv = { ...pushEnv }

const wrappers: VueWrapper[] = []
beforeEach(() => vi.spyOn(ElMessage, 'success').mockImplementation((() => ({ close() {} })) as never))
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  Object.assign(pushEnv, originalEnv)
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

interface FakeSubscription {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
  unsubscribe: ReturnType<typeof vi.fn>
}

function fakeSubscription(endpoint = ENDPOINT, key: Uint8Array | null = urlBase64ToUint8Array(PUBLIC_KEY)): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: key ? (key.buffer as ArrayBuffer) : null },
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256DH-KEY', auth: 'AUTH-KEY' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

function fakeRegistration(existing: FakeSubscription | null = null) {
  const current = { subscription: existing }
  const subscribe = vi.fn(async (_options: unknown) => (current.subscription = fakeSubscription()))
  const registration = { pushManager: { getSubscription: vi.fn(async () => current.subscription), subscribe } }
  return { registration, current, subscribe }
}

/** 預設是「一般桌機瀏覽器、還沒有訂閱、尚未決定權限」。 */
function browser(overrides: Partial<typeof pushEnv> = {}, existing: FakeSubscription | null = null) {
  const calls: string[] = []
  const fake = fakeRegistration(existing)
  Object.assign(pushEnv, {
    isApple: () => false,
    isStandalone: () => false,
    isSupported: () => true,
    permission: () => 'default' as NotificationPermission,
    requestPermission: vi.fn(async () => {
      calls.push('permission')
      return 'granted' as NotificationPermission
    }),
    registration: async () => fake.registration as unknown as ServiceWorkerRegistration,
    worker: vi.fn(async () => {
      calls.push('worker')
      return fake.registration as unknown as ServiceWorkerRegistration
    }),
    ...overrides,
  })
  return { ...fake, calls }
}

const device = (id: string, overrides: Partial<PushDeviceOut> = {}): PushDeviceOut => ({
  id,
  device_label: 'iPhone（主畫面）',
  created_at: '2026-11-05T02:00:00+00:00',
  last_success_at: null,
  ...overrides,
})

interface ApiState {
  config: { enabled: boolean; public_key: string | null } | Error
  devices: PushDeviceOut[]
  subscribeResult: PushDeviceOut | Error
  test: { sent: number; failed: number } | Error
  removeFails: boolean
}

function mockApi(overrides: Partial<ApiState> = {}) {
  const state: ApiState = {
    config: { enabled: true, public_key: PUBLIC_KEY },
    devices: [],
    subscribeResult: device('this-device'),
    test: { sent: 1, failed: 0 },
    removeFails: false,
    ...overrides,
  }
  const get = vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path === '/auth/providers') return { google: false, line: false }
    if (path === '/admin/push/config') {
      if (state.config instanceof Error) throw state.config
      return state.config
    }
    if (path === '/admin/push/subscriptions') return state.devices
    throw new Error(`unexpected GET ${path}`)
  }) as never)
  const post = vi.spyOn(api, 'post').mockImplementation((async (path: string, _body?: unknown) => {
    if (path === '/admin/push/subscriptions') {
      if (state.subscribeResult instanceof Error) throw state.subscribeResult
      return state.subscribeResult
    }
    if (path === '/admin/push/subscriptions/remove') {
      if (state.removeFails) throw new ApiError(500, 'boom')
      return undefined
    }
    if (path === '/admin/push/test') {
      if (state.test instanceof Error) throw state.test
      return state.test
    }
    throw new Error(`unexpected POST ${path}`)
  }) as never)
  const remove = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
  return { state, get, post, remove }
}

async function mountAccount(role: Role = 'reception', overrides: Partial<UserOut> = {}) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/account', name: 'account', component: AccountView },
      { path: '/:rest(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push('/account')
  await router.isReady()
  useAuthStore(pinia).user = testUser(role, { email: 'staff@ivy.example', campus_keys: ['yihua'], ...overrides })
  const wrapper = mount(AccountView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const panel = (wrapper: VueWrapper) => wrapper.find('[data-test="push-panel"]')

// ----------------------------------------------------------------------------- 誰看得到

describe('手機通知區塊：誰看得到', () => {
  it.each<Role>(['super_admin', 'campus_admin', 'reception'])('%s（具 booking.handle）看得到', async (role) => {
    browser()
    mockApi()
    const wrapper = await mountAccount(role)
    expect(panel(wrapper).exists()).toBe(true)
    expect(panel(wrapper).find('h2').text()).toBe('手機通知')
  })

  it.each<Role>(['editor', 'readonly'])('%s（沒有推播）看不到，也不會去讀推播設定或裝置', async (role) => {
    browser()
    const { get } = mockApi()
    const wrapper = await mountAccount(role)
    expect(panel(wrapper).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('手機通知')
    expect(get.mock.calls.map(([path]) => path).filter((path) => String(path).startsWith('/admin/push'))).toEqual([])
  })
})

// ----------------------------------------------------------------------------- 各狀態

describe('手機通知區塊：狀態', () => {
  it('推播未設定（config.enabled=false）：只寫「尚未開放」，沒有任何按鈕', async () => {
    browser()
    mockApi({ config: { enabled: false, public_key: null } })
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-state-text"]').text()).toBe('尚未開放')
    expect(panel(wrapper).findAll('button')).toHaveLength(0)
  })

  it('讀不到推播設定（API 失敗）也當成尚未開放，不讓整頁壞掉', async () => {
    browser()
    mockApi({ config: new ApiError(500, 'boom') })
    const wrapper = await mountAccount()
    expect(panel(wrapper).text()).toContain('尚未開放')
  })

  it('iPhone 沒有從主畫面開啟：說明先加入主畫面（即使這個分頁沒有 PushManager），不顯示開啟按鈕', async () => {
    browser({ isApple: () => true, isStandalone: () => false, isSupported: () => false })
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-state-text"]').text()).toBe('iPhone 要先在 Safari 按分享 →「加入主畫面」，再從主畫面打開後台開啟通知。')
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(false)
  })

  it('iPhone 從主畫面開啟：可以開啟通知', async () => {
    browser({ isApple: () => true, isStandalone: () => true })
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-enable"]').text()).toBe('開啟通知')
  })

  it('瀏覽器不支援：「這個瀏覽器不支援通知。」', async () => {
    browser({ isSupported: () => false })
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-state-text"]').text()).toBe('這個瀏覽器不支援通知。')
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(false)
  })

  it('權限已被封鎖（denied）：請到瀏覽器設定允許，沒有開啟按鈕', async () => {
    browser({ permission: () => 'denied' })
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-state-text"]').text()).toBe('通知已被瀏覽器封鎖，請到瀏覽器設定允許。')
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(false)
  })

  it('還沒開啟：只有一顆「開啟通知」按鈕，沒有測試與關閉', async () => {
    browser()
    mockApi()
    const wrapper = await mountAccount()
    const buttons = panel(wrapper).findAll('button').map((button) => button.text())
    expect(buttons).toEqual(['開啟通知'])
    expect(panel(wrapper).text()).toContain('有新的參觀預約時，手機會跳通知。')
  })

  it('這台已開啟（權限已允許、瀏覽器有訂閱）：「這台裝置已開啟」＋「傳送測試通知」「關閉」', async () => {
    const { subscribe } = browser({ permission: () => 'granted' }, fakeSubscription())
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-on"]').text()).toBe('這台裝置已開啟')
    expect(panel(wrapper).findAll('button').map((button) => button.text())).toEqual(['傳送測試通知', '關閉'])
    expect(panel(wrapper).find('.el-tag').text()).toBe('已開啟')
    expect(subscribe).not.toHaveBeenCalled() // 載入時不會自己重新訂閱
  })

  it('權限允許但瀏覽器沒有訂閱（例如被清掉）：回到「開啟通知」', async () => {
    browser({ permission: () => 'granted' }, null)
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
    expect(panel(wrapper).find('[data-test="push-on"]').exists()).toBe(false)
  })

  it('瀏覽器的訂閱是用舊金鑰訂的（伺服器換過 VAPID）：當作沒開，不補送、請重新開啟', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription(ENDPOINT, new Uint8Array(65).fill(7)))
    const { post } = mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
    expect(panel(wrapper).find('[data-test="push-on"]').exists()).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('瀏覽器沒有回報訂閱用的金鑰（部分瀏覽器）：不誤判成舊金鑰', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription(ENDPOINT, null))
    mockApi()
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-on"]').exists()).toBe(true)
  })

  it('總管理者多一行：也會收到網站錯誤通知；其他角色沒有', async () => {
    browser()
    mockApi()
    const admin = await mountAccount('super_admin')
    expect(panel(admin).find('[data-test="push-errors-note"]').text()).toBe('總管理者也會收到網站出現新錯誤的通知。')
    const desk = await mountAccount('reception')
    expect(panel(desk).find('[data-test="push-errors-note"]').exists()).toBe(false)
  })

  it('狀態文字表就是畫面上的四句', () => {
    expect(PUSH_STATE_TEXT.unavailable).toBe('尚未開放')
    expect(Object.keys(PUSH_STATE_TEXT).sort()).toEqual(['blocked', 'needs-install', 'unavailable', 'unsupported'])
  })
})

// ----------------------------------------------------------------------------- 開啟

describe('開啟通知', () => {
  it('點擊的當下先要權限（第一個動作），再訂閱，把 endpoint 與金鑰送給伺服器，成功後顯示已開啟', async () => {
    const { calls, subscribe } = browser()
    const { post } = mockApi({ devices: [device('this-device')] })
    post.mockImplementationOnce((async (path: string, body: unknown) => {
      calls.push('post')
      expect(path).toBe('/admin/push/subscriptions')
      expect(body).toEqual({ endpoint: ENDPOINT, keys: { p256dh: 'P256DH-KEY', auth: 'AUTH-KEY' } })
      return device('this-device')
    }) as never)
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-enable"]').trigger('click')
    await flushPromises()

    expect(calls).toEqual(['permission', 'worker', 'post'])
    expect(subscribe).toHaveBeenCalledTimes(1)
    const options = subscribe.mock.calls[0]![0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array }
    expect(options.userVisibleOnly).toBe(true)
    expect(Array.from(options.applicationServerKey)).toEqual(Array.from(urlBase64ToUint8Array(PUBLIC_KEY)))
    expect(options.applicationServerKey).toHaveLength(65)
    expect(panel(wrapper).find('[data-test="push-on"]').text()).toBe('這台裝置已開啟')
    expect(panel(wrapper).findAll('[data-test="push-device"]')).toHaveLength(1)
    expect(panel(wrapper).find('[data-test="push-device"] .el-tag').text()).toBe('這台')
  })

  it('權限對話框按「封鎖」：顯示已被封鎖，沒有訂閱也沒有呼叫伺服器', async () => {
    const { subscribe } = browser({ requestPermission: vi.fn(async () => 'denied' as NotificationPermission) })
    const { post } = mockApi()
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-enable"]').trigger('click')
    await flushPromises()
    expect(panel(wrapper).find('[data-test="push-state-text"]').text()).toBe('通知已被瀏覽器封鎖，請到瀏覽器設定允許。')
    expect(subscribe).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('權限對話框直接關掉（default）：維持沒開啟，可以再按一次', async () => {
    const { subscribe } = browser({ requestPermission: vi.fn(async () => 'default' as NotificationPermission) })
    const { post } = mockApi()
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => ({ close() {} })) as never)
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-enable"]').trigger('click')
    await flushPromises()
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
    expect(subscribe).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '沒有允許通知，這台還沒有開啟。' }))
  })

  it('伺服器沒收下（API 失敗）：把剛訂的取消掉、顯示錯誤、維持沒開啟', async () => {
    const { current } = browser()
    mockApi({ subscribeResult: new ApiError(409, { code: 'PUSH_NOT_CONFIGURED', message: '尚未設定手機推播的金鑰' }) })
    const error = vi.spyOn(ElMessage, 'error').mockImplementation((() => ({ close() {} })) as never)
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-enable"]').trigger('click')
    await flushPromises()
    expect(current.subscription?.unsubscribe).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: '尚未設定手機推播的金鑰' }))
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
  })

  it('瀏覽器已有一份用別把金鑰訂的舊訂閱：先取消再重新訂，不然瀏覽器會拒絕', async () => {
    const stale = fakeSubscription(ENDPOINT, new Uint8Array(65).fill(9))
    const { subscribe } = browser({}, stale)
    mockApi()
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-enable"]').trigger('click')
    await flushPromises()
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('瀏覽器已有同一把金鑰的訂閱：沿用，不重訂', async () => {
    const same = fakeSubscription()
    const { subscribe } = browser({}, same)
    const { post } = mockApi()
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-enable"]').trigger('click')
    await flushPromises()
    expect(same.unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith('/admin/push/subscriptions', expect.objectContaining({ endpoint: ENDPOINT }))
  })

  it('連點只送一次', async () => {
    const { subscribe } = browser()
    mockApi()
    const wrapper = await mountAccount()
    const button = wrapper.get('[data-test="push-enable"]')
    await button.trigger('click')
    await button.trigger('click')
    await flushPromises()
    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})

// ----------------------------------------------------------------------------- 已開啟後

describe('已開啟：載入同步、測試、關閉、裝置', () => {
  it('載入時把這台的訂閱再送一次（伺服器那列可能已被清掉），並從回傳的 id 認出「這台」', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription())
    const { post } = mockApi({ devices: [device('other'), device('this-device')] })
    const wrapper = await mountAccount()
    expect(post).toHaveBeenCalledWith('/admin/push/subscriptions', { endpoint: ENDPOINT, keys: { p256dh: 'P256DH-KEY', auth: 'AUTH-KEY' } })
    const rows = panel(wrapper).findAll('[data-test="push-device"]')
    expect(rows.map((row) => row.find('.el-tag').exists())).toEqual([false, true])
  })

  it('傳送測試通知：呼叫 /admin/push/test，有送到就說送出了', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription())
    const { post } = mockApi({ test: { sent: 1, failed: 0 } })
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-test"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/push/test')
    expect(ElMessage.success).toHaveBeenCalledWith(expect.stringContaining('已送出測試通知'))
  })

  it('測試通知沒送到：請先關閉再重新開啟；被限流（429）顯示後端的說明', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription())
    const { state } = mockApi({ test: { sent: 0, failed: 1 } })
    const error = vi.spyOn(ElMessage, 'error').mockImplementation((() => ({ close() {} })) as never)
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-test"]').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('沒有送到') }))
    state.test = new ApiError(429, { code: 'RATE_LIMITED', message: '測試通知送太多次了，請稍後再試' })
    await wrapper.get('[data-test="push-test"]').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ message: '測試通知送太多次了，請稍後再試' }))
  })

  it('關閉：取消瀏覽器訂閱、通知伺服器移除這個 endpoint、回到「開啟通知」', async () => {
    const subscription = fakeSubscription()
    browser({ permission: () => 'granted' }, subscription)
    const { post } = mockApi()
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-disable"]').trigger('click')
    await flushPromises()
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/admin/push/subscriptions/remove', { endpoint: ENDPOINT })
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
    expect(panel(wrapper).find('[data-test="push-on"]').exists()).toBe(false)
  })

  it('關閉時伺服器沒回應：瀏覽器那邊照樣關掉，提醒伺服器稍後會清', async () => {
    const subscription = fakeSubscription()
    browser({ permission: () => 'granted' }, subscription)
    mockApi({ removeFails: true })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => ({ close() {} })) as never)
    const wrapper = await mountAccount()
    await wrapper.get('[data-test="push-disable"]').trigger('click')
    await flushPromises()
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('已關閉通知') }))
  })

  it('我的裝置：名稱、開啟日期、最後送達（沒收過寫「尚未送達」）；沒有 endpoint 或金鑰', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription())
    mockApi({
      devices: [
        device('this-device', { device_label: 'Mac Chrome', created_at: '2026-11-05T02:00:00+00:00' }),
        device('phone', { device_label: 'iPhone（主畫面）', created_at: '2026-10-01T02:00:00+00:00', last_success_at: '2026-11-04T09:30:00+00:00' }),
      ],
    })
    const wrapper = await mountAccount()
    const rows = panel(wrapper).findAll('[data-test="push-device"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Mac Chrome')
    expect(rows[0]!.text()).toContain('開啟於 2026/11/05')
    expect(rows[0]!.text()).toContain('尚未送達')
    expect(rows[1]!.text()).toContain('iPhone（主畫面）')
    expect(rows[1]!.text()).toContain('最後送達 2026/11/04 17:30')
    expect(panel(wrapper).html()).not.toContain('fcm.googleapis.com')
  })

  it('移除別台裝置：DELETE /admin/push/subscriptions/{id}，清單重新讀取', async () => {
    browser({ permission: () => 'granted' }, fakeSubscription())
    const { state, remove } = mockApi({ devices: [device('this-device'), device('phone')] })
    const wrapper = await mountAccount()
    state.devices = [device('this-device')]
    await panel(wrapper).findAll('[data-test="push-device-remove"]')[1]!.trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('/admin/push/subscriptions/phone')
    expect(panel(wrapper).findAll('[data-test="push-device"]')).toHaveLength(1)
  })

  it('移除「這台」等於關閉通知（連瀏覽器訂閱一起取消）', async () => {
    const subscription = fakeSubscription()
    browser({ permission: () => 'granted' }, subscription)
    const { post, remove } = mockApi({ devices: [device('this-device')] })
    const wrapper = await mountAccount()
    await panel(wrapper).find('[data-test="push-device-remove"]').trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith('/admin/push/subscriptions/remove', { endpoint: ENDPOINT })
  })

  it('這台沒開、別台有開時，清單照樣列出來可以移除', async () => {
    browser()
    mockApi({ devices: [device('phone')] })
    const wrapper = await mountAccount()
    expect(panel(wrapper).find('[data-test="push-enable"]').exists()).toBe(true)
    expect(panel(wrapper).findAll('[data-test="push-device"]')).toHaveLength(1)
  })
})

// ----------------------------------------------------------------------------- 工具

describe('工具與其他頁面', () => {
  it('urlBase64ToUint8Array：base64url（含 - 與 _、沒有填充）轉成位元組', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
    expect(urlBase64ToUint8Array(PUBLIC_KEY)).toHaveLength(65)
    expect(urlBase64ToUint8Array(PUBLIC_KEY)[0]).toBe(4)
  })

  it('registerPushWorker：用 /admin/sw.js、scope /admin/ 註冊；失敗與不支援都吞掉', async () => {
    const register = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { serviceWorker: { register } })
    registerPushWorker()
    expect(register).toHaveBeenCalledWith('/admin/sw.js', { scope: '/admin/' })
    register.mockRejectedValueOnce(new Error('insecure'))
    expect(() => registerPushWorker()).not.toThrow()
    await flushPromises()
    vi.stubGlobal('navigator', {})
    expect(() => registerPushWorker()).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('系統狀態頁的「手機推播」一列：中文標籤、裝置數、前往我的帳號', () => {
    const item = (configured: boolean, detail: Record<string, unknown> = {}) => ({ key: 'web_push', level: configured ? 'ok' : 'info', detail: { configured, ...detail } }) as never
    expect(ITEM_LABELS.web_push).toBe('手機推播')
    expect(describeItem(item(true, { devices: 3 }), 'services')).toBe('已設定，目前 3 台裝置開啟通知')
    expect(describeItem(item(false), 'services')).toBe('未設定金鑰，新預約與網站錯誤不會推到手機')
    expect(itemLink(item(true, { devices: 0 }), 'services')).toEqual({ to: '/account', label: '前往我的帳號開啟' })
    expect(itemLink(item(false), 'services')).toBeNull()
  })
})
