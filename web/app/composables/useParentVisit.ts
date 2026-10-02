import { ref, shallowRef } from 'vue'
import type { components } from '../../../contracts/generated/website-api'
import { apiFieldErrors, taipeiDate, type VisitErrors } from '../utils/visit-form'
import { slotWhen } from '../utils/visit-session'

export type ParentVisit = components['schemas']['ParentVisitRequestOut']
export type ParentDetailChanges = Partial<Pick<ParentVisit, 'parent_name' | 'phone' | 'email' | 'child_name' | 'child_birthdate'>>
export interface ParentVisitSlot { id: string; slot_date: string; start_time: string; end_time: string; remaining: number }
const base = '/api/website/v1/public/visit-manage'
const requestOptions = { credentials: 'same-origin', cache: 'no-store', retry: 0, timeout: 15000 } as const

function failureInfo(error: unknown) {
  const failure = error as { response?: { status?: number }; data?: { detail?: unknown } }
  const detail = failure?.data?.detail as { code?: string; message?: string } | undefined
  return { status: failure?.response?.status, code: detail?.code, message: detail?.message, detail: failure?.data?.detail }
}

export function useParentVisit() {
  const visit = shallowRef<ParentVisit | null>(null)
  const pending = ref(true)
  const busy = ref(false)
  const unavailable = ref(false)
  const error = ref('')
  const notice = ref('')
  const slots = ref<ParentVisitSlot[]>([])
  const slotsPending = ref(false)
  const slotsError = ref('')
  // 後端 422 依欄位位置對應回表單欄位（顯示自己的中文訊息，不用 Pydantic 的 msg）。
  const detailErrors = ref<VisitErrors>({})
  // 不放入 Nuxt payload、URL query 或瀏覽器儲存空間；暫時斷線仍可重試。
  let linkToken: string | null = null
  let disposed = false
  let loading = false
  let revision = 0
  let controller = new AbortController()

  // withoutLink：一開始就沒帶連結、也沒有有效登入（直接打網址進來），不是「失效」，
  // 改用中性說明告訴家長連結從哪來（2026-09-29 評析：原本一進來就紅字寫已失效）。
  function expire(withoutLink = false) {
    linkToken = null
    visit.value = null
    slots.value = []
    unavailable.value = true
    if (withoutLink) {
      error.value = ''
      notice.value = '這一頁要從園所傳給你的「管理參觀預約」連結開啟。還沒收到連結，或連結打不開，請直接聯絡園所。'
    } else {
      error.value = '管理連結已失效或登入時間已到，請使用園所提供的有效連結，或聯絡園所重新取得。'
    }
  }

  async function reload() {
    if (disposed || loading || busy.value || unavailable.value) return
    loading = true
    const request = revision
    const usedLink = Boolean(linkToken)
    const firstLoad = !visit.value
    pending.value = true
    error.value = ''
    try {
      const record = linkToken
        ? await $fetch<ParentVisit>(`${base}/exchange`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { token: linkToken } })
        : await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal })
      if (disposed || request !== revision) return
      linkToken = null
      visit.value = record
      notice.value = ''
    } catch (cause) {
      if (disposed || request !== revision) return
      if (failureInfo(cause).status === 401) expire(!usedLink && firstLoad)
      else {
        visit.value = null
        error.value = failureInfo(cause).status === 429
          ? '操作太頻繁，請稍候一分鐘再重新載入。'
          : '暫時無法讀取預約，請重新載入，或直接聯絡園所。'
      }
    } finally {
      if (!disposed && request === revision) { loading = false; pending.value = false }
    }
  }

  async function initialize(token?: string | null) {
    if (disposed) return
    revision++
    controller.abort()
    controller = new AbortController()
    loading = false
    busy.value = false
    slotsPending.value = false
    unavailable.value = false
    visit.value = null
    slots.value = []
    slotsError.value = ''
    notice.value = ''
    linkToken = token || null
    await reload()
  }

  async function loadSlots() {
    if (!visit.value?.can_reschedule || disposed || slotsPending.value) return
    slotsPending.value = true
    const request = revision
    slotsError.value = ''
    try {
      const result = await $fetch<ParentVisitSlot[]>('/api/website/v1/public/slots', {
        ...requestOptions,
        signal: controller.signal,
        query: { campus_key: visit.value.campus_key, date_from: taipeiDate(), date_to: taipeiDate(new Date(Date.now() + 60 * 86400000)) }
      })
      if (disposed || unavailable.value || request !== revision) return
      slots.value = result.filter(slot => slot.remaining > 0 && slot.id !== visit.value?.slot?.id)
        .sort((a, b) => `${a.slot_date} ${a.start_time}`.localeCompare(`${b.slot_date} ${b.start_time}`))
    } catch {
      if (!disposed && request === revision) slotsError.value = '暫時無法讀取其他場次，請重新載入場次，或聯絡園所。'
    } finally {
      if (!disposed && request === revision) slotsPending.value = false
    }
  }

  async function operationFailed(cause: unknown, request: number) {
    const { status, code, message, detail } = failureInfo(cause)
    if (status === 401) { expire(); return }
    if (status === 422) {
      detailErrors.value = apiFieldErrors(detail)
      error.value = Object.keys(detailErrors.value).length ? '有幾個欄位需要修正，請看標示的地方。' : '資料格式有誤，請檢查後再送出。'
      return
    }
    if (code === 'PARENT_SESSION_CHANGED') {
      // 同一個瀏覽器的分頁共用登入：別的分頁開了另一筆預約的連結，這一頁顯示的已不是
      // 目前登入的那一筆，後端拒絕異動、兩筆都沒動。不自動換成另一筆，請家長重開連結。
      expire()
      error.value = '這個瀏覽器剛在其他分頁開啟了另一筆預約的管理連結，這一頁的預約沒有任何變更。要管理這一筆，請重新點開它的管理連結。'
      return
    }
    if (code === 'VISIT_REQUEST_VERSION_CONFLICT') {
      try {
        const record = await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal })
        if (disposed || request !== revision) return
        visit.value = record
      } catch (refreshError) {
        if (disposed || request !== revision) return
        if (failureInfo(refreshError).status === 401) { expire(); return }
      }
      error.value = '這筆預約剛被修改過，已重新載入最新資料，請再確認一次。'
      return
    }
    if (code === 'CHANGE_DEADLINE_PASSED' || code === 'INVALID_TRANSITION' || code === 'BOOKING_UNAVAILABLE') {
      // 截止時間／狀態／分校停用可能在頁面開啟後改變，更新可操作項目。
      try {
        const record = await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal })
        if (disposed || request !== revision) return
        visit.value = record
      } catch (refreshError) {
        if (disposed || request !== revision) return
        if (failureInfo(refreshError).status === 401) { expire(); return }
        visit.value = null
      }
      error.value = code === 'BOOKING_UNAVAILABLE' && message ? message : '目前已無法線上異動這筆預約，請直接聯絡園所。'
    } else if (['SLOT_FULL', 'SLOT_CLOSED', 'SLOT_NOT_BOOKABLE', 'SLOT_NOT_FOUND', 'SAME_SLOT'].includes(code || '')) {
      error.value = '選擇的場次已無法預約，請重新選擇其他場次。'
      await loadSlots()
    } else if (status === 429) error.value = message || '操作太頻繁，請稍候一分鐘再試。'
    else error.value = '暫時無法完成操作，請重新載入確認最新狀態，或直接聯絡園所。'
  }

  async function cancelVisit() {
    if (!visit.value?.can_cancel || busy.value || pending.value || disposed) return
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    try {
      // 帶畫面上的案件：別的分頁換了登入的案件時，後端對不上就拒絕，不會取消到另一筆。
      const result = await $fetch<ParentVisit>(`${base}/cancel`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { visit_request_id: visit.value.id } })
      if (disposed || request !== revision) return
      // 取消會撤銷 session；保留回執，不立刻呼叫 /me 將成功畫面變成 401。
      visit.value = result
      slots.value = []
      // 停用的分校沒有預約頁，不叫家長「重新預約」。
      notice.value = result.campus_active === false
        ? '預約已取消，原時段已釋出。若想再次參觀，請直接聯絡園所。'
        : '預約已取消，原時段已釋出。若想再次參觀，請重新預約或聯絡園所。'
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
    } finally {
      if (!disposed && request === revision) busy.value = false
    }
  }

  async function reschedule(slotId: string): Promise<boolean> {
    if (!visit.value?.can_reschedule || !slotId || busy.value || pending.value || disposed) return false
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    try {
      const result = await $fetch<ParentVisit>(`${base}/reschedule`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { visit_request_id: visit.value.id, slot_id: slotId } })
      if (disposed || request !== revision) return false
      visit.value = result
      slots.value = []
      notice.value = result.slot ? `已改到 ${slotWhen(result.slot)}。` : '已更新參觀時間。'
      return true
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
      return false
    } finally {
      if (!disposed && request === revision) busy.value = false
    }
  }

  async function updateDetails(changes: ParentDetailChanges): Promise<boolean> {
    if (!visit.value?.can_edit || busy.value || pending.value || disposed) return false
    if (!Object.keys(changes).length) { notice.value = '資料沒有變更。'; return true }
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    detailErrors.value = {}
    try {
      const result = await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal, method: 'PATCH', headers: { 'X-Ivy-Parent': '1' }, body: { visit_request_id: visit.value.id, expected_version: visit.value.version, ...changes } })
      if (disposed || request !== revision) return false
      visit.value = result
      notice.value = '資料已更新。'
      return true
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
      return false
    } finally {
      if (!disposed && request === revision) busy.value = false
    }
  }

  function dispose() {
    disposed = true
    revision++
    controller.abort()
    linkToken = null
    visit.value = null
    slots.value = []
  }
  return { visit, pending, busy, unavailable, error, notice, slots, slotsPending, slotsError, detailErrors, initialize, reload, loadSlots, cancelVisit, reschedule, updateDetails, dispose }
}
