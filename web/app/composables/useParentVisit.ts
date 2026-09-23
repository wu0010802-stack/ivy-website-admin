import { ref, shallowRef } from 'vue'
import type { components } from '../../../contracts/generated/website-api'
import { taipeiDate } from '../utils/visit-form'

export type ParentVisit = components['schemas']['ParentVisitRequestOut']
export interface ParentVisitSlot { id: string; slot_date: string; start_time: string; end_time: string; remaining: number }
const base = '/api/website/v1/public/visit-manage'
const requestOptions = { credentials: 'same-origin', cache: 'no-store', retry: 0, timeout: 15000 } as const

function failureInfo(error: unknown) {
  const failure = error as { response?: { status?: number }; data?: { detail?: { code?: string } } }
  return { status: failure?.response?.status, code: failure?.data?.detail?.code }
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
  const reschedulePending = ref(false)
  // 不放入 Nuxt payload、URL query 或瀏覽器儲存空間；暫時斷線仍可重試。
  let linkToken: string | null = null
  let disposed = false
  let loading = false
  let revision = 0
  let controller = new AbortController()

  function expire() {
    linkToken = null
    visit.value = null
    slots.value = []
    unavailable.value = true
    error.value = '管理連結已失效或登入時間已到，請使用園所提供的有效連結，或聯絡園所重新取得。'
  }

  async function reload() {
    if (disposed || loading || busy.value || unavailable.value) return
    loading = true
    const request = revision
    pending.value = true
    error.value = ''
    try {
      const record = linkToken
        ? await $fetch<ParentVisit>(`${base}/exchange`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { token: linkToken } })
        : await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal })
      if (disposed || request !== revision) return
      linkToken = null
      visit.value = record
      reschedulePending.value = Boolean(record.reschedule_pending)
      notice.value = record.reschedule_pending ? '已有改期申請待園所確認；核准前原時段仍保留。' : ''
    } catch (cause) {
      if (disposed || request !== revision) return
      if (failureInfo(cause).status === 401) expire()
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
    reschedulePending.value = false
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
    const { status, code } = failureInfo(cause)
    if (status === 401) { expire(); return }
    if (code === 'RESCHEDULE_PENDING') {
      reschedulePending.value = true
      notice.value = '已有改期申請待園所確認；核准前原時段仍保留。'
      return
    }
    if (code === 'CHANGE_DEADLINE_PASSED' || code === 'INVALID_TRANSITION') {
      // 截止時間／狀態可能在頁面開啟後改變，更新可操作項目。
      try {
        const record = await $fetch<ParentVisit>(`${base}/me`, { ...requestOptions, signal: controller.signal })
        if (disposed || request !== revision) return
        visit.value = record
      } catch (refreshError) {
        if (disposed || request !== revision) return
        if (failureInfo(refreshError).status === 401) { expire(); return }
        visit.value = null
      }
      error.value = '目前已無法線上異動這筆預約，請直接聯絡園所。'
    } else if (['SLOT_FULL', 'SLOT_NOT_BOOKABLE', 'SLOT_NOT_FOUND', 'SAME_SLOT'].includes(code || '')) {
      error.value = '選擇的場次已無法申請，請重新選擇其他場次。'
      await loadSlots()
    } else if (status === 429) error.value = '操作太頻繁，請稍候一分鐘再試。'
    else error.value = '暫時無法完成操作，請重新載入確認最新狀態，或直接聯絡園所。'
  }

  async function cancelVisit() {
    if (!visit.value?.can_cancel || busy.value || pending.value || disposed) return
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    try {
      const result = await $fetch<ParentVisit>(`${base}/cancel`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' } })
      if (disposed || request !== revision) return
      // 取消會撤銷 session；保留回執，不立刻呼叫 /me 將成功畫面變成 401。
      visit.value = result
      slots.value = []
      reschedulePending.value = false
      notice.value = '預約已取消，原時段已釋出。若想再次參觀，請重新預約或聯絡園所。'
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
    } finally {
      if (!disposed && request === revision) busy.value = false
    }
  }

  async function requestReschedule(slotId: string) {
    if (!visit.value?.can_reschedule || !slotId || reschedulePending.value || busy.value || pending.value || disposed) return
    busy.value = true
    const request = revision
    error.value = ''
    notice.value = ''
    try {
      await $fetch(`${base}/reschedule-request`, { ...requestOptions, signal: controller.signal, method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { new_slot_id: slotId } })
      if (disposed || request !== revision) return
      reschedulePending.value = true
      notice.value = '改期申請已送出，待園所確認；核准前原時段仍保留。'
    } catch (cause) {
      if (!disposed && request === revision) await operationFailed(cause, request)
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
  return { visit, pending, busy, unavailable, error, notice, slots, slotsPending, slotsError, reschedulePending, initialize, reload, loadSlots, cancelVisit, requestReschedule, dispose }
}
