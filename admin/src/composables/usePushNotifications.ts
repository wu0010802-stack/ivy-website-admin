// 「我的帳號」的手機通知（2026-11-05，Web Push）：狀態判斷、訂閱與取消、測試通知、我的裝置。
//
// 後端：GET /admin/push/config、/admin/push/subscriptions；POST /admin/push/subscriptions、
// /admin/push/subscriptions/remove、/admin/push/test；DELETE /admin/push/subscriptions/{id}
// （backend/app/notifications/push_routes.py）。伺服器不回傳 endpoint 與金鑰，所以「這一台是哪一列」靠
// 訂閱成功時回的 id 認；只有具 booking.handle 的人（含總管理者）會收到推播，畫面端另外用權限決定要不要顯示。
//
// 瀏覽器的環境判斷都收在 pushEnv：測試直接換掉它，不必在 jsdom 裡假裝出 Service worker。
// iPhone／iPad 一定要先加到主畫面、從主畫面打開才能訂閱（iOS 16.4 起的限制），一般 Safari 分頁連
// PushManager 都沒有，所以「要先加到主畫面」的判斷在「不支援」之前。
import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { PushConfigOut, PushDeviceOut, PushTestOut } from '../api/types'
import { notifyError, notifyWarning } from './notify'
import { PUSH_WORKER_SCOPE, PUSH_WORKER_URL } from '../utils/pushWorker'

export type PushState = 'loading' | 'unavailable' | 'needs-install' | 'unsupported' | 'blocked' | 'on' | 'off'

export const PUSH_STATE_TEXT: Record<Exclude<PushState, 'loading' | 'on' | 'off'>, string> = {
  unavailable: '尚未開放',
  'needs-install': 'iPhone 要先在 Safari 按分享 →「加入主畫面」，再從主畫面打開後台開啟通知。',
  unsupported: '這個瀏覽器不支援通知。',
  blocked: '通知已被瀏覽器封鎖，請到瀏覽器設定允許。',
}

/** 等 Service worker 就緒的上限；超過就請人重試，不讓按鈕轉圈轉到天荒地老。 */
const WORKER_READY_TIMEOUT_MS = 10_000

/** applicationServerKey 要 Uint8Array；設定裡的公鑰是 base64url。 */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

function sameBytes(left: ArrayBuffer | null | undefined, right: Uint8Array): boolean {
  if (!left) return false
  const view = new Uint8Array(left)
  return view.length === right.length && view.every((byte, index) => byte === right[index])
}

/** 訂閱用的是別把金鑰（伺服器重新設定過 VAPID）：舊訂閱已經送不到了。瀏覽器沒回報金鑰時當作沒問題。 */
function isStale(subscription: PushSubscription, key: Uint8Array): boolean {
  const used = subscription.options?.applicationServerKey
  return used != null && !sameBytes(used, key)
}

/** 瀏覽器環境。測試用 Object.assign(pushEnv, {...}) 換掉；用完要還原。 */
export const pushEnv = {
  /** iPhone、iPod、iPad（iPadOS 13 起 UA 假裝成 Mac，用觸控點數分辨）。 */
  isApple: (): boolean =>
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  /** 從主畫面打開（iOS 的 navigator.standalone，其他瀏覽器是 display-mode: standalone）。 */
  isStandalone: (): boolean =>
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches),
  isSupported: (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  permission: (): NotificationPermission => Notification.permission,
  requestPermission: (): Promise<NotificationPermission> => Notification.requestPermission(),
  /** 目前已註冊的 Service worker（只看，不補註冊）。 */
  registration: (): Promise<ServiceWorkerRegistration | undefined> => navigator.serviceWorker.getRegistration(PUSH_WORKER_SCOPE),
  /** 已註冊（沒有就補註冊）且已啟用的 Service worker。 */
  async worker(): Promise<ServiceWorkerRegistration> {
    const container = navigator.serviceWorker
    if (!(await pushEnv.registration())) {
      await container.register(PUSH_WORKER_URL, { scope: PUSH_WORKER_SCOPE })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('worker-timeout')), WORKER_READY_TIMEOUT_MS)
    })
    try {
      return await Promise.race([container.ready, timeout])
    } finally {
      clearTimeout(timer)
    }
  },
}

function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) throw new Error('subscription-incomplete')
  return { endpoint: json.endpoint, keys: { p256dh, auth } }
}

export interface PushNotifications {
  state: Ref<PushState>
  devices: Ref<PushDeviceOut[]>
  /** 這一台在 devices 裡的 id（訂閱成功或同步時才知道）。 */
  currentDeviceId: Ref<string | null>
  busy: Ref<boolean>
  testing: Ref<boolean>
  load: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  sendTest: () => Promise<void>
  removeDevice: (id: string) => Promise<void>
}

export function usePushNotifications(): PushNotifications {
  const state = ref<PushState>('loading')
  const devices = ref<PushDeviceOut[]>([])
  const currentDeviceId = ref<string | null>(null)
  const busy = ref(false)
  const testing = ref(false)
  let publicKey = ''

  async function refreshDevices() {
    try {
      const rows = await api.get<PushDeviceOut[]>('/admin/push/subscriptions')
      devices.value = Array.isArray(rows) ? rows : []
    } catch {
      devices.value = []
    }
  }

  async function localSubscription(): Promise<PushSubscription | null> {
    try {
      const registration = await pushEnv.registration()
      return (await registration?.pushManager.getSubscription()) ?? null
    } catch {
      return null
    }
  }

  async function load() {
    state.value = 'loading'
    let config: PushConfigOut | null = null
    try {
      config = await api.get<PushConfigOut>('/admin/push/config')
    } catch {
      config = null
    }
    publicKey = config?.enabled === true && typeof config.public_key === 'string' ? config.public_key : ''
    if (!publicKey) {
      state.value = 'unavailable'
      return
    }
    if (pushEnv.isApple() && !pushEnv.isStandalone()) state.value = 'needs-install'
    else if (!pushEnv.isSupported()) state.value = 'unsupported'
    else if (pushEnv.permission() === 'denied') state.value = 'blocked'
    else {
      let subscription = pushEnv.permission() === 'granted' ? await localSubscription() : null
      // 伺服器換過金鑰：舊訂閱送不到了，當作沒開，請本人重新按「開啟通知」（enable 會換掉舊訂閱）。
      if (subscription && isStale(subscription, urlBase64ToUint8Array(publicKey))) subscription = null
      state.value = subscription ? 'on' : 'off'
      if (subscription) {
        // 伺服器那一列可能因為推播服務回報失效而被刪掉：補送一次（同一個 endpoint 只會有一列），
        // 順便得知「這一台」是清單裡的哪一列。失敗不打擾使用者。
        try {
          currentDeviceId.value = (await api.post<PushDeviceOut>('/admin/push/subscriptions', subscriptionBody(subscription))).id
        } catch {
          currentDeviceId.value = null
        }
      }
    }
    if (state.value !== 'needs-install' && state.value !== 'unsupported') await refreshDevices()
  }

  async function enable() {
    if (busy.value || !publicKey) return
    busy.value = true
    let created: PushSubscription | null = null
    try {
      // 權限對話框要在使用者點擊的同一個事件裡要求（Safari 尤其嚴），所以第一個 await 就是它。
      const permission = await pushEnv.requestPermission()
      if (permission === 'denied') {
        state.value = 'blocked'
        return
      }
      if (permission !== 'granted') {
        notifyWarning('沒有允許通知，這台還沒有開啟。')
        return
      }
      const registration = await pushEnv.worker()
      const key = urlBase64ToUint8Array(publicKey)
      let subscription = await registration.pushManager.getSubscription()
      // 金鑰換過（重新設定 VAPID）之後，舊的訂閱不能沿用，瀏覽器也不准用不同的金鑰再訂一次。
      if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe()
        subscription = null
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        created = subscription
      }
      const device = await api.post<PushDeviceOut>('/admin/push/subscriptions', subscriptionBody(subscription))
      created = null
      currentDeviceId.value = device.id
      state.value = 'on'
      await refreshDevices()
      ElMessage.success('這台裝置已開啟通知')
    } catch (error) {
      // 伺服器沒收下的訂閱不留在瀏覽器：不然這一台以為開了、其實永遠收不到。
      if (created) await created.unsubscribe().catch(() => false)
      notifyError(apiErrorMessage(error, '通知沒有開啟成功，請再試一次'))
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    if (busy.value) return
    busy.value = true
    try {
      const subscription = await localSubscription()
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        try {
          await api.post('/admin/push/subscriptions/remove', { endpoint })
        } catch {
          notifyWarning('這台已關閉通知，但伺服器那邊還沒更新；之後會自動清除。')
        }
      }
      state.value = pushEnv.permission() === 'denied' ? 'blocked' : 'off'
      currentDeviceId.value = null
      await refreshDevices()
    } catch (error) {
      notifyError(apiErrorMessage(error, '通知沒有關閉成功，請再試一次'))
    } finally {
      busy.value = false
    }
  }

  async function sendTest() {
    if (testing.value) return
    testing.value = true
    try {
      const result = await api.post<PushTestOut>('/admin/push/test')
      if (result.sent > 0) ElMessage.success('已送出測試通知，手機會跳出來')
      else if (result.failed > 0) notifyError('測試通知沒有送到，這台可能已失效，請先關閉再重新開啟。')
      else notifyWarning('沒有可以送的裝置，請先開啟通知。')
      // 送不到的裝置後端會記錄或移除，清單跟著更新。
      await refreshDevices()
    } catch (error) {
      notifyError(apiErrorMessage(error, '測試通知沒有送出，請再試一次'))
    } finally {
      testing.value = false
    }
  }

  async function removeDevice(id: string) {
    // 這一台要連瀏覽器的訂閱一起取消，不然清單沒有它、手機卻還以為開著。
    if (id === currentDeviceId.value) {
      await disable()
      return
    }
    try {
      await api.delete(`/admin/push/subscriptions/${id}`)
    } catch (error) {
      notifyError(apiErrorMessage(error, '沒有移除成功，請再試一次'))
    }
    await refreshDevices()
  }

  return { state, devices, currentDeviceId, busy, testing, load, enable, disable, sendTest, removeDevice }
}
