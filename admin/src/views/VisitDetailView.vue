<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, Phone } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import type { RecruitmentVisit, VisitContactNoteOut, VisitRequestDetailOut, VisitRequestFullOut, VisitSlotOut } from '../api/types'
import { ageLabel, campusLabel, consentRecordLabel, contactTimeLabel, formatDateTime, formatHoldRemaining, formatSlotWhen, holdIsUrgent, maskEmail, partySizeLabel, visitStatus, referralSourceLabels, slotStarted, staffEmail, staffEmailById, staffLabel, staffLabelById, staffOf, visitSourceLabel } from '../api/labels'
import { useOpenRequestsStore } from '../stores/openRequests'
import { usePermissions } from '../composables/usePermissions'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useVisitStaff } from '../composables/useVisitStaff'
import { confirmRescheduleDecision, submitRescheduleDecision, type RescheduleAction } from '../composables/rescheduleDecision'
import StatusTag from '../components/StatusTag.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import VisitHistoryTimeline from '../components/VisitHistoryTimeline.vue'
import { useCampusScope } from '../composables/useCampusScope'
import { readVisitNoteDraft, writeVisitNoteDraft } from '../composables/visitNoteDraft'
import { createFromVisitRequest, listRecords } from '../api/admissions'
import { stageLabel } from '../admissions/constants'

const route = useRoute()
const openRequests = useOpenRequestsStore()
const router = useRouter()
const id = computed(() => route.params.id as string)

const detail = ref<VisitRequestFullOut | null>(null)
const notes = ref<VisitContactNoteOut[]>([])
const availableSlots = ref<VisitSlotOut[]>([])
const selectedSlotId = ref('')
// 已確認案件改期：選新場次、原因選填（記在案件歷程）。
const rescheduleSlotId = ref('')
const rescheduleReason = ref('')
// 家長已經申請改期時，該做的是核准或退回；手動改期先收起來，要用再展開。
const manualRescheduleOpen = ref(false)
const rescheduleSelect = ref<{ focus: () => void } | null>(null)
const rescheduleTitle = ref<HTMLElement | null>(null)
// 聯絡紀錄草稿：被打斷時存在這個分頁，回到同一筆帶回（composables/visitNoteDraft.ts）。
const newNote = ref(readVisitNoteDraft(route.params.id as string))
watch(newNote, (text) => writeVisitNoteDraft(id.value, text))
// 「下次聯絡」跟著這一筆紀錄一起送；家長說「下週再打」時才有地方記，
// 總覽的「到期待追蹤」也才會有來源。預先填案件目前的追蹤時間：不動就沿用，
// 清空就是「不用再追」。
const followUpAt = ref<string | null>(null)
const noteInput = ref<{ focus: () => void } | null>(null)
// 同校還沒處理完的其他案件，讓櫃台早上能一筆接一筆處理，不必每次回列表。
// 從列表點進來時跟著那份列表的條件與順序（list）；沒有來源時照下方 loadNextCases 的處理優先序。
const nextQueue = ref<{ id: string; held: number; fresh: number; heldMore: boolean; freshMore: boolean; list?: { count: number; label: string } } | null>(null)
// 哪一個動作正在處理：只有按下去的那顆按鈕轉圈，其他按鈕只停用，
// 不會讓人以為自己按到了別顆。
type DetailAction = 'confirm' | 'cancel' | 'no_show' | 'complete' | 'reschedule' | 'note' | RescheduleAction
const pendingAction = ref<DetailAction | null>(null)
const busy = computed(() => pendingAction.value !== null)
const rebookOpen = ref(false)
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const loading = ref(true)
const { can } = usePermissions()
// 處理案件（聯絡紀錄、確認、取消、改期…）含櫃台；指派承辦人與新增時段
// 仍是校區管理者以上（booking.manage）。
const canHandle = computed(() => can('booking.handle'))
const canManage = computed(() => can('booking.manage'))
const { staff, load: loadStaff } = useVisitStaff()
const assignable = computed(() =>
  staff.value.filter(
    (s) => s.is_active && (s.role === 'super_admin' || (detail.value ? s.campus_keys.includes(detail.value.campus_key) : false)),
  ),
)
const assigning = ref(false)

// 打好還沒按「新增紀錄」的聯絡紀錄：返回、下一筆、側欄換頁前都先問，
// 不然同事接手時看不到這段聯絡過程。處理中（例如正在新增紀錄）先請使用者稍候。
const noteDirty = computed(() => canHandle.value && newNote.value.trim() !== '')
const { confirmLeave } = useUnsavedChanges(noteDirty, busy)
// 「下一筆」只換 :id，不會觸發離頁守衛，要另外攔。
onBeforeRouteUpdate((to, from) => (to.params.id !== from.params.id ? confirmLeave() : true))

async function assign(staffId: string | null) {
  if (!detail.value) return
  assigning.value = true
  try {
    await api.patch<VisitRequestDetailOut>(`/admin/visit-requests/${id.value}/assignee`, {
      assigned_staff_id: staffId || null,
      expected_version: detail.value.version,
    })
    await refreshDetail()
    ElMessage.success(staffId ? `已指派給 ${staffLabelById(staffId, staff.value)}` : '已取消指派')
  } catch (err) {
    reportError(err, '指派失敗')
  } finally {
    assigning.value = false
  }
}
const error = ref<string | null>(null)

// 「下一筆」換 id 時元件不重新掛載：換案件就加一，舊案件較晚回來的
// 回應不能蓋掉畫面（否則畫面是家長 A、送出卻寫到案件 B）。
let generation = 0

// 日期選擇器用台灣時間的字串（value-format），案件上的是 UTC ISO。
function toPickerValue(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00'
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return new Date(a).getTime() === new Date(b).getTime()
}

// quiet：動作完成後的重讀不切回骨架畫面，頁面上的狀態（例如剛產生、只顯示
// 一次的家長連結）才不會因為元件重新掛載而消失。
async function load(options: { quiet?: boolean } = {}) {
  const gen = generation
  const requestId = id.value
  if (!options.quiet) loading.value = true
  error.value = null
  try {
    // 案件與聯絡紀錄互不相依，一起送出，手機網路少等一次往返。兩個都等回來
    // 再看結果：案件本身讀不到（例如找不到）優先說明，不被聯絡紀錄的錯誤蓋掉。
    const [caseResult, notesResult] = await Promise.allSettled([
      api.get<VisitRequestFullOut>(`/admin/visit-requests/${requestId}`),
      api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${requestId}/contact-notes`),
    ])
    if (caseResult.status === 'rejected') throw caseResult.reason
    if (notesResult.status === 'rejected') throw notesResult.reason
    if (gen !== generation) return
    const loaded = caseResult.value
    detail.value = loaded
    notes.value = notesResult.value
    if (!options.quiet) followUpAt.value = toPickerValue(loaded.follow_up_at)
    void loadNextCases(loaded.campus_key)
    // 排入時段（新需求、聯絡中）與改期（已確認）都從同校未來 60 天的時段挑。
    let slots: VisitSlotOut[] = []
    if (['new', 'contacting', 'confirmed'].includes(loaded.status)) {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      slots = await api.get<VisitSlotOut[]>(
        `/admin/slots?campus_key=${loaded.campus_key}&date_from=${today}&date_to=${future}`,
      )
    }
    if (gen !== generation) return
    availableSlots.value = slots
  } catch (err) {
    if (gen !== generation) return
    error.value = err instanceof ApiError && err.status === 404 ? '找不到這筆案件，可能已被移除或不在你的校區範圍。' : '無法讀取案件'
  } finally {
    if (gen === generation) loading.value = false
  }
}

// 動作完成後只更新案件本身（含歷程），不切回骨架畫面：家長連結剛產生的
// 網址還顯示在頁面上，重新掛載就看不到了。
async function refreshDetail() {
  const gen = generation
  try {
    const loaded = await api.get<VisitRequestFullOut>(`/admin/visit-requests/${id.value}`)
    if (gen === generation) detail.value = loaded
  } catch {
    /* 下次重新整理再讀 */
  }
}

// 下一筆的清單上限；回傳剛好這麼多筆時，件數寫「N+」，不假裝是全部。
const NEXT_LIMIT = 100

// 確認期限：沒有期限的排在最後。
function holdTime(request: VisitRequestDetailOut): number {
  const at = request.hold_expires_at ? Date.parse(request.hold_expires_at) : Number.NaN
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}

// 列表帶進來的條件只收這些鍵，其餘忽略；分頁與每頁筆數由這裡自己決定。
const LIST_KEYS = ['campus_key', 'group', 'status', 'q', 'follow_up_due', 'assignee', 'source', 'created_from', 'created_to', 'needs_attention', 'order', 'page', 'page_size']
function sourceListParams(): URLSearchParams | null {
  const raw = route.query.list
  if (typeof raw !== 'string' || !raw) return null
  const incoming = new URLSearchParams(raw)
  const params = new URLSearchParams()
  for (const key of LIST_KEYS) {
    const value = incoming.get(key)
    if (value) params.set(key, value)
  }
  // 從列表第 1 頁來就一次抓 50 筆；第 2 頁以後照列表的頁碼與每頁筆數抓同一段。
  if (!params.has('page_size')) params.set('page_size', '50')
  return params
}

const NEXT_LABELS: Record<string, string> = { pending_confirmation: '下一筆待確認', new: '下一筆待處理' }
// 目前這筆在來源列表的第幾位；處理完離開列表（例如狀態變了）後，
// 接手它位置的那一筆就是下一筆。
let queuePosition = 0

// 從列表點進來：下一筆照那份列表的條件與順序走。
async function loadListNext(source: URLSearchParams, gen: number) {
  const list = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${source}`)
  if (gen !== generation) return
  const rows = Array.isArray(list) ? list : []
  const index = rows.findIndex((r) => r.id === id.value)
  const others = rows.filter((r) => r.id !== id.value)
  if (index >= 0) queuePosition = index
  const next = index >= 0 ? (rows[index + 1] ?? others[0]) : others[Math.min(queuePosition, others.length - 1)]
  nextQueue.value = next
    ? { id: next.id, held: 0, fresh: 0, heldMore: false, freshMore: false, list: { count: others.length, label: NEXT_LABELS[next.status] ?? '下一筆' } }
    : null
}

// 下一筆的順序：待園方確認有期限（逾期名額會釋出），排在前面、期限最早的先；
// 再來是待處理，最早送出的先。後端列表只能依送出時間排序，確認期限在這裡排。
async function loadNextCases(campusKey: string) {
  const gen = generation
  const source = sourceListParams()
  if (source) {
    try {
      await loadListNext(source, gen)
    } catch {
      if (gen === generation) nextQueue.value = null
    }
    return
  }
  const fetchStatus = (status: string) =>
    api.get<VisitRequestDetailOut[]>(
      `/admin/visit-requests?${new URLSearchParams({ status, campus_key: campusKey, order: 'oldest', page_size: String(NEXT_LIMIT) })}`,
    )
  try {
    const [held, fresh] = await Promise.all([fetchStatus('pending_confirmation'), fetchStatus('new')])
    if (gen !== generation) return
    const others = (list: unknown) => (Array.isArray(list) ? (list as VisitRequestDetailOut[]) : []).filter((r) => r.id !== id.value)
    // 期限已過、系統還沒來得及取消的待確認（排程約一分鐘跑一次）已經不能確認，不排進下一筆。
    const now = Date.now()
    const heldOthers = others(held).filter((r) => holdTime(r) > now).sort((a, b) => {
      const x = holdTime(a)
      const y = holdTime(b)
      return x === y ? 0 : x < y ? -1 : 1
    })
    const freshOthers = others(fresh)
    const first = heldOthers[0] ?? freshOthers[0]
    nextQueue.value = first
      ? {
          id: first.id,
          held: heldOthers.length,
          fresh: freshOthers.length,
          heldMore: Array.isArray(held) && held.length >= NEXT_LIMIT,
          freshMore: Array.isArray(fresh) && fresh.length >= NEXT_LIMIT,
        }
      : null
  } catch {
    if (gen === generation) nextQueue.value = null
  }
}

// 按鈕上寫清楚算的是什麼：同校、待確認幾件、待處理幾件（不含這一筆）。
const nextLabel = computed(() => {
  const q = nextQueue.value
  if (!q) return ''
  if (q.list) return `${q.list.label}（這份列表還有 ${q.list.count} 件）`
  const parts = [
    q.held ? `待確認 ${q.held}${q.heldMore ? '+' : ''}` : '',
    q.fresh ? `待處理 ${q.fresh}${q.freshMore ? '+' : ''}` : '',
  ].filter(Boolean)
  return `下一筆（${parts.join('・')}）`
})

const nextTitle = computed(() => {
  const q = nextQueue.value
  if (!q || !detail.value) return ''
  if (q.list) return '照剛才案件列表的篩選條件與排序往下'
  return `${campusLabel(detail.value.campus_key)}還有待園方確認 ${q.held} 件、待處理 ${q.fresh} 件（不含這一筆）；確認期限最早的排最前面`
})

function reportError(err: unknown, fallback: string) {
  if (isVersionConflict(err)) {
    // 別人剛改過承辦人或下次聯絡時間：不蓋掉，重讀案件讓畫面顯示最新的。
    // 已經自動重讀，所以不接後端「請重新載入後再操作」的訊息。
    ElMessage.warning('這筆案件的承辦人或下次聯絡時間剛被其他人修改，已載入最新的內容，請確認後再操作')
    void refreshDetail()
    return
  }
  ElMessage.error(apiErrorMessage(err, fallback))
}

// 已經開始的場次不能再排人（後端也會拒絕），名額滿或關閉的也不列。
const openSlots = computed(() =>
  availableSlots.value.filter((s) => !s.closed && s.booked_count < s.capacity && !slotStarted(s)),
)
const rescheduleSlots = computed(() => openSlots.value.filter((s) => s.id !== detail.value?.slot_id))

// 名額以「組家庭」計，一組幾個人都只占一個名額。
function slotLabel(slot: VisitSlotOut): string {
  const left = slot.capacity - slot.booked_count
  return `${formatSlotWhen(slot)}，剩 ${left} 組`
}

// 取消與改期會寄信給家長（有 Email 時）；說明寫在確認框裡，櫃台才知道不必再打電話。
// 寄信是否啟用要看該校的預約設定；讀不到（沒有權限）時不保證，提醒自行確認。
const emailEnabled = ref<boolean | null>(null)
watch(() => detail.value?.campus_key, async (campus) => {
  emailEnabled.value = null
  if (!campus) return
  try {
    const config = await api.get<{ parent_email_enabled?: boolean }>(`/admin/booking-config/${campus}`)
    if (detail.value?.campus_key === campus && typeof config?.parent_email_enabled === 'boolean') emailEnabled.value = config.parent_email_enabled
  } catch {
    emailEnabled.value = null
  }
}, { immediate: true })
const parentMailNote = computed(() => {
  const email = detail.value?.email
  if (!email) return '這筆沒有 Email，請電話通知家長。'
  if (emailEnabled.value === true) return `會寄信通知家長（${maskEmail(email)}）。`
  if (emailEnabled.value === false) return '尚未設定寄信，請電話通知家長。'
  return `有 Email（${maskEmail(email)}），但無法確認系統是否會寄信，請確認是否需要另外通知家長。`
})
// 取消與改期的信只在案件有場次時才會寄（後端依有沒有場次與 Email 決定）。
const mailNoteIfConfirmed = computed(() => (detail.value?.slot ? parentMailNote.value : '這筆還沒排場次，不會通知家長。'))

async function confirm() {
  if (!selectedSlotId.value && detail.value?.status !== 'pending_confirmation') {
    ElMessage.warning('請先選擇一個時段')
    return
  }
  const slot = detail.value?.status === 'pending_confirmation' ? detail.value.slot : openSlots.value.find((s) => s.id === selectedSlotId.value)
  if (!slot) {
    ElMessage.warning('這個時段已經不能選了，請重新選擇')
    return
  }
  try {
    await ElMessageBox.confirm(
      `將把 ${detail.value?.parent_name} 排入 ${formatSlotWhen(slot)}，案件變成「預約正常」。${parentMailNote.value}`,
      '排入這個場次？',
      { confirmButtonText: '排入場次', cancelButtonText: '先不要', type: 'info' },
    )
  } catch {
    return
  }
  pendingAction.value = 'confirm'
  try {
    await api.post(`/admin/visit-requests/${id.value}/confirm`, { slot_id: slot.id })
    ElMessage.success(`已排入 ${formatSlotWhen(slot)}`)
    openRequests.refresh(true)
    await load({ quiet: true })
    await focusNoteOrShowTop()
  } catch (err) {
    reportError(err, '確認失敗')
  } finally {
    pendingAction.value = null
  }
}

// 還沒排時段（待處理、聯絡中）只是「參觀需求」，不叫預約；只有排了場次的才是
// 「取消預約」。案件狀態、按鈕、對話框與歷程用同一組詞。
const cancelsRequest = computed(() => detail.value?.status === 'new' || detail.value?.status === 'contacting')

async function cancel() {
  const request = cancelsRequest.value
  const released = detail.value?.status === 'pending_confirmation' ? '家長選的場次名額會釋出。' : detail.value?.status === 'confirmed' ? '原參觀時段的名額會釋出。' : ''
  let reason: string | null = null
  try {
    const result = await ElMessageBox.prompt(
      `${released}案件會結案。${mailNoteIfConfirmed.value}家長之後想再約，可以在這一頁用「重新預約（另建新案）」接續，不必請家長重新送出。`,
      request ? '取消這筆參觀需求？' : '取消這筆預約？',
      {
        confirmButtonText: request ? '取消需求' : '取消預約',
        confirmButtonClass: 'el-button--danger',
        cancelButtonText: '先不要',
        inputPlaceholder: '取消原因（選填，會記在案件歷程）',
        inputValidator: (value: string) => !value || value.length <= 500 || '原因最多 500 字',
        type: 'warning',
      },
    )
    const value = (result as { value?: string }).value ?? ''
    reason = value.trim() || null
  } catch {
    return
  }
  pendingAction.value = 'cancel'
  try {
    await api.post(`/admin/visit-requests/${id.value}/cancel`, { reason })
    ElMessage.success('已取消')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '取消失敗')
  } finally {
    pendingAction.value = null
  }
}

async function markNoShow() {
  try {
    await ElMessageBox.confirm('標記後這筆案件會結案。這一場的名額仍算已使用，不會再開放給別人。', '標記為未到場？', {
      confirmButtonText: '標記未到場',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  pendingAction.value = 'no_show'
  try {
    await api.post(`/admin/visit-requests/${id.value}/no-show`)
    ElMessage.success('已標記未到場')
    // 結案時家長待核准的改期申請跟著失效，側欄的待核准數要一起更新。
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    pendingAction.value = null
  }
}

// 參觀時段開始後才出現「完成參觀」與「標記未到場」（後端也會拒絕）：兩者都會
// 保留這一場的名額，提早按下去未來那一場就永遠排不進人；家長事先說不來要取消。
// 櫃台常開著案件頁等家長來，時間每 30 秒重算一次，場次一開始按鈕就出現；
// 待確認的「還剩多久」、下次聯絡是否已過也跟著這個時鐘更新。
const clockNow = ref(Date.now())
const clock = window.setInterval(() => { clockNow.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(clock))
const visitStarted = computed(() => {
  const slot = detail.value?.slot
  return slot ? slotStarted(slot, clockNow.value) : false
})

// 桌機游標直接進紀錄框；觸控裝置聚焦會彈出鍵盤，還把頁面捲到紀錄框、
// 狀態標籤跑出畫面，所以只把頁面捲回頂端，狀態與「處理」面板都看得到。
async function focusNoteOrShowTop() {
  await nextTick()
  if (window.matchMedia?.('(pointer: coarse)').matches) window.scrollTo({ top: 0 })
  else noteInput.value?.focus()
}

// 待確認的占位過了期限：後端不會再接受確認，系統排程會自動取消並釋出名額。
const holdExpired = computed(() => {
  const at = detail.value?.status === 'pending_confirmation' ? detail.value.hold_expires_at : null
  if (!at) return false
  const expires = Date.parse(at)
  return !Number.isNaN(expires) && expires <= clockNow.value
})

// 展開手動改期時，按下的連結會被表單換掉；把焦點移進表單（能選時段就放在
// 時段選單，沒有時段可選就放在標題），鍵盤與報讀軟體才知道表單出現在哪裡。
async function openManualReschedule() {
  manualRescheduleOpen.value = true
  await nextTick()
  if (rescheduleSlots.value.length > 0 && rescheduleSelect.value) rescheduleSelect.value.focus()
  else rescheduleTitle.value?.focus()
}

async function reschedule() {
  const current = detail.value
  const target = rescheduleSlots.value.find((s) => s.id === rescheduleSlotId.value)
  if (!current || !target) {
    ElMessage.warning('請先選擇新的參觀時段')
    return
  }
  try {
    await ElMessageBox.confirm(
      `${current.parent_name} 的參觀時間會從 ${formatSlotWhen(current.slot)} 改到 ${formatSlotWhen(target)}，原時段名額釋出。${parentMailNote.value}`,
      '改期？',
      { confirmButtonText: '確認改期', cancelButtonText: '先不要', type: 'info' },
    )
  } catch {
    return
  }
  pendingAction.value = 'reschedule'
  try {
    await api.post(`/admin/visit-requests/${id.value}/reschedule`, {
      new_slot_id: target.id,
      reason: rescheduleReason.value.trim() || null,
    })
    ElMessage.success(`已改到 ${formatSlotWhen(target)}`)
    rescheduleSlotId.value = ''
    rescheduleReason.value = ''
    manualRescheduleOpen.value = false
    // 家長先前的改期申請在直接改期時失效，側欄的待核准數要一起更新。
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '改期失敗')
    // 名額或時段可能剛被別人用掉，重讀一次讓選單反映現況。
    await load({ quiet: true })
  } finally {
    pendingAction.value = null
  }
}

async function decideReschedule(action: RescheduleAction) {
  const request = detail.value?.pending_reschedule
  if (!request) return
  const decision = await confirmRescheduleDecision(request, action)
  if (!decision) return
  pendingAction.value = action
  try {
    await submitRescheduleDecision(request.id, action, decision.reason)
    ElMessage.success(action === 'approve' ? `已核准，改到 ${formatSlotWhen(request.requested_slot)}。記得告知家長。` : '已退回改期申請，家長維持原時段')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
    await load({ quiet: true })
  } finally {
    pendingAction.value = null
  }
}

async function onRebooked(created: VisitRequestDetailOut) {
  openRequests.refresh(true)
  const failure = await router.push(`/visit-requests/${created.id}`)
  // 紀錄框還有沒新增的紀錄、使用者選擇留在這頁：新案件已經建好了，告訴他之後去哪裡開。
  if (failure) ElMessage.info('新案件已建立，記完這筆紀錄後可以到參觀案件列表開啟')
}

// 招生入學可用時，標記已到場會在同一個交易裡建立招生訪視（規格 6.1），所以先確認（規格第 10 節原文）。
// 招生未啟用（招生 API 404）或還不確定時，維持改版前的行為：沒有確認框、原本的訊息。
async function markCompleted() {
  const withAdmissions = admissionsAvailable.value === 'yes'
  if (withAdmissions) {
    try {
      await ElMessageBox.confirm('會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？', {
        confirmButtonText: '標記已到場',
        cancelButtonText: '先不要',
        type: 'info',
      })
    } catch {
      return
    }
  }
  pendingAction.value = 'complete'
  try {
    await api.post(`/admin/visit-requests/${id.value}/complete`)
    ElMessage.success(withAdmissions ? '已標記已到場，招生訪視已建立' : '已標記完成參觀')
    openRequests.refresh(true)
    await load({ quiet: true })
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    pendingAction.value = null
  }
}

// ---- 招生訪視（規格第 10 節）----
// 有 admissions.read 才查；已到場但還沒有招生訪視（上線前的舊預約、或招生訪視被刪掉）時，
// 有 admissions.write 的人可以補建（後端另要 booking.read，能看到這頁就有）。
// 查詢成功＝招生可用；404＝招生未啟用；其他錯誤或沒查＝不確定（markCompleted 照舊）。
const canReadAdmissions = computed(() => can('admissions.read'))
const canCreateAdmissions = computed(() => can('admissions.write'))
const admissionsVisit = ref<RecruitmentVisit | null>(null)
const admissionsAvailable = ref<'yes' | 'no' | 'unknown'>('unknown')
const creatingAdmissions = ref(false)

async function loadAdmissionsVisit() {
  const current = detail.value
  admissionsVisit.value = null
  admissionsAvailable.value = 'unknown'
  if (!current || !canReadAdmissions.value) return
  const gen = generation
  try {
    const rows = await listRecords({ campus_key: current.campus_key, visit_request_id: current.id, page: 1, page_size: 1 })
    if (gen !== generation || detail.value?.id !== current.id) return
    admissionsVisit.value = Array.isArray(rows) ? (rows[0] ?? null) : null
    admissionsAvailable.value = 'yes'
  } catch (err) {
    if (gen !== generation || detail.value?.id !== current.id) return
    // 404：招生入學未啟用，整區不顯示；其他錯誤讀不到也不影響處理案件。
    if (err instanceof ApiError && err.status === 404) admissionsAvailable.value = 'no'
  }
}

// 換案件或狀態變了（例如剛標記已到場）才重查；只是重讀明細不重查。
watch(() => `${detail.value?.id ?? ''}|${detail.value?.status ?? ''}`, () => void loadAdmissionsVisit())

// 帶 sy=all：到場當下寫入的入學學期不一定是招生頁預設的學年（本檔調整第 22 條）。
const admissionsLink = computed(() => ({
  path: '/admissions',
  query: { campus: detail.value?.campus_key ?? '', tab: 'records', vr: detail.value?.id ?? '', sy: 'all' },
}))

async function createAdmissionsVisit() {
  const current = detail.value
  if (!current || creatingAdmissions.value) return
  creatingAdmissions.value = true
  try {
    const created = await createFromVisitRequest(current.id)
    if (detail.value?.id !== current.id) return
    admissionsVisit.value = created
    ElMessage.success('已建立招生訪視')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '建立招生訪視失敗'))
    // 409：預約已不是已到場或已匿名化，重讀讓畫面跟上。
    if (err instanceof ApiError && err.status === 409) await load({ quiet: true })
  } finally {
    creatingAdmissions.value = false
  }
}

async function addNote() {
  // 畫面上的案件（detail）才是要寫的那一筆；還在載入下一筆時不送。
  if (!newNote.value.trim() || !detail.value || detail.value.id !== id.value || busy.value) return
  const gen = generation
  const current = detail.value
  const nextFollowUp = followUpAt.value || null
  // 改或清下次聯絡時間會蓋掉案件上的值，要帶版本；沒動就只記一筆紀錄。
  const followUpChanged = !sameInstant(nextFollowUp, current.follow_up_at)
  pendingAction.value = 'note'
  try {
    await api.post(`/admin/visit-requests/${current.id}/contact-notes`, {
      note: newNote.value.trim(),
      ...(followUpChanged ? { follow_up_at: nextFollowUp, expected_version: current.version } : {}),
    })
    if (gen !== generation) return
    newNote.value = ''
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${current.id}/contact-notes`)
    // 追蹤時間存在案件上、歷程也多一筆；重讀一次頁首與歷程。
    await refreshDetail()
    if (gen !== generation) return
    followUpAt.value = toPickerValue(detail.value?.follow_up_at)
    if (followUpChanged) ElMessage.success(nextFollowUp ? '已記下，到時會出現在總覽的「到期待追蹤」' : '已清除下次聯絡時間，不會再出現在「到期待追蹤」')
  } catch (err) {
    reportError(err, '新增紀錄失敗')
  } finally {
    pendingAction.value = null
  }
}

// 上一頁是案件列表（保留篩選與捲動位置）才用瀏覽器返回；從通知連結、登入頁
// 或別的頁面進來時，返回會回到不相干的地方，改成直接開案件列表。
function cameFromVisitList(): boolean {
  const back = (router.options.history.state as { back?: unknown } | null)?.back
  if (typeof back !== 'string') return false
  const path = back.split(/[?#]/)[0]!.replace(/\/+$/, '')
  return path === '/visit-requests'
}

function goBack() {
  if (cameFromVisitList()) router.back()
  else router.push('/visit-requests')
}

// 用 replace：一筆接一筆處理完，按返回直接回列表，不必一筆筆倒退。
// 從列表來的把列表條件一起帶到下一筆，下一筆的「下一筆」才會照同一份列表走。
function goNext() {
  if (!nextQueue.value) return
  const path = `/visit-requests/${nextQueue.value.id}`
  const list = route.query.list
  void router.replace(typeof list === 'string' && list ? { path, query: { list } } : path)
}

// 會列進總覽「到期待追蹤」的案件：與後端同一個定義，已取消、已完成的不算
// （結案不會清掉下次聯絡時間，所以不能只看時間）。
const followUpTracked = computed(() => !!detail.value && !['cancelled', 'completed'].includes(detail.value.status))

// 追蹤時間已過、案件還沒結案：頁首用警示色提醒。
const followUpDue = computed(() => {
  const at = detail.value?.follow_up_at
  if (!at || !followUpTracked.value) return false
  return new Date(at).getTime() <= Date.now()
})

// 紀錄框旁預填的下次聯絡已經過了：不動就沿用（測試規範），但提醒送出後
// 這筆仍會留在「到期待追蹤」。已確認的案件也可能是刻意設的提醒，只提示不擋；
// 已取消、已完成的不會列進去，不提示。
const followUpPast = computed(() => {
  if (!followUpAt.value || !followUpTracked.value) return false
  const at = Date.parse(followUpAt.value)
  return !Number.isNaN(at) && at <= clockNow.value
})

// 日期選擇器不給過去的時間：「下次聯絡」記在昨天沒有意義。
function disablePast(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

// 家長常說「明天再打」「過幾天」「下週」：一鍵帶入，時間都放上午 10 點。
function daysLaterAtTen(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(10, 0, 0, 0)
  return date
}

const followUpShortcuts = [
  { text: '明天 10:00', value: () => daysLaterAtTen(1) },
  { text: '3 天後', value: () => daysLaterAtTen(3) },
  // 週日按「下週一」是明天；週一按是七天後。
  { text: '下週一', value: () => daysLaterAtTen((8 - new Date().getDay()) % 7 || 7) },
]

onMounted(() => {
  load()
  void loadStaff()
})
// 「下一筆」是同一個元件換 id，router 不會重新掛載。
watch(id, () => {
  generation += 1
  detail.value = null
  notes.value = []
  nextQueue.value = null
  newNote.value = readVisitNoteDraft(id.value)
  followUpAt.value = null
  selectedSlotId.value = ''
  rescheduleSlotId.value = ''
  rescheduleReason.value = ''
  manualRescheduleOpen.value = false
  load()
})

// 還在流程中的案件才需要家長連結；結案時後端已經撤銷。
const linkApplicable = computed(() =>
  ['new', 'contacting', 'pending_confirmation', 'confirmed'].includes(detail.value?.status ?? ''),
)

// 官網送出的才是家長自己填的；園方補登的是櫃台代填。
const isWebCase = computed(() => !detail.value?.source || detail.value.source === 'web')
</script>

<template>
  <div class="page detail">
    <div class="detail__nav">
      <el-button text :icon="ArrowLeft" class="detail__back" @click="goBack">參觀案件</el-button>
      <el-button v-if="nextQueue" text class="detail__next" :title="nextTitle" @click="goNext">
        {{ nextLabel }}<el-icon><ArrowRight /></el-icon>
      </el-button>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-skeleton v-else-if="loading" animated :rows="6" />

    <template v-else-if="detail">
      <div class="detail__head">
        <div>
          <h2 class="detail__title">{{ detail.parent_name }}</h2>
          <p class="hint">
            {{ campusLabel(detail.campus_key) }}・{{ formatDateTime(detail.created_at) }}
            {{ detail.source && detail.source !== 'web' ? `${visitSourceLabel(detail.source)}補登` : '官網送出' }}<template v-if="detail.created_by">（<span :title="staffEmailById(detail.created_by, staff) || undefined">{{ staffLabelById(detail.created_by, staff) }}</span> 登錄）</template>
          </p>
          <p v-if="detail.related_request_id" class="hint">
            重新預約自 <router-link :to="`/visit-requests/${detail.related_request_id}`">先前的案件</router-link>
          </p>
          <p v-if="detail.slot" class="detail__when">參觀時間 {{ formatSlotWhen(detail.slot) }}</p>
          <p v-if="detail.follow_up_at" class="detail__follow" :class="{ 'is-due': followUpDue }">
            {{ followUpDue ? '已到預定聯絡時間' : '預定聯絡' }} {{ formatDateTime(detail.follow_up_at) }}
          </p>
        </div>
        <StatusTag :meta="visitStatus(detail.status)" size="large" />
      </div>
      <!-- 手機處理面板排在最前面，電話會被擠到下面；打電話是處理案件的第一步，頁首直接給一顆撥號鈕。 -->
      <el-button tag="a" :href="`tel:${detail.phone}`" type="primary" plain :icon="Phone" class="detail__call">
        撥電話給家長 {{ detail.phone }}
      </el-button>

      <div class="detail__grid">
        <div class="detail__main">
          <div class="panel">
            <div class="panel__head"><h2>{{ isWebCase ? '家長填寫的資料' : '案件資料' }}</h2></div>
            <el-descriptions :column="1" border label-width="128" class="detail__desc">
              <el-descriptions-item label="電話">
                <a :href="`tel:${detail.phone}`" class="num detail__link">{{ detail.phone }}</a>
              </el-descriptions-item>
              <el-descriptions-item label="孩子姓名">{{ detail.child_name || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="出生年月日">{{ detail.child_birthdate || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="Email"><a v-if="detail.email" :href="`mailto:${detail.email}`" class="detail__link">{{ detail.email }}</a><span v-else>未填寫</span></el-descriptions-item>
              <el-descriptions-item label="參觀人數">{{ detail.party_size ? partySizeLabel(detail.party_size) : '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="得知管道">{{ referralSourceLabels(detail.referral_sources) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.age" label="家長填的年齡">{{ ageLabel(detail.age) }}</el-descriptions-item>
              <el-descriptions-item label="方便接電話時段">{{ contactTimeLabel(detail.preferred_time) }}</el-descriptions-item>
              <el-descriptions-item label="想了解的事">
                <span class="detail__pre">{{ detail.questions || '未填寫' }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="同意紀錄">{{ consentRecordLabel(detail) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.confirmed_at" label="確認時間">{{ formatDateTime(detail.confirmed_at) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.cancelled_at" label="取消時間">{{ formatDateTime(detail.cancelled_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <!-- 聯絡紀錄每天都在用，排在很少用的家長管理連結前面。 -->
          <section class="section">
            <div class="section__title"><h2>聯絡紀錄</h2></div>
            <ol class="notes" v-if="notes.length > 0">
              <li v-for="n in notes" :key="n.id" class="notes__item">
                <span class="notes__meta">
                  <time class="notes__time num">{{ formatDateTime(n.created_at) }}</time>
                  <span v-if="n.created_by" class="notes__author" :title="staffEmail(staffOf(n, 'created_by')) || undefined">{{ staffLabel(staffOf(n, 'created_by')) }}</span>
                </span>
                <p class="detail__pre">{{ n.note }}</p>
              </li>
            </ol>
            <p v-else class="hint">{{ canHandle ? '還沒有聯絡紀錄。每次致電或傳訊後記一筆，同事接手時才知道談到哪裡。' : '還沒有聯絡紀錄。' }}</p>
            <div v-if="canHandle" class="notes__form">
              <el-input
                ref="noteInput"
                v-model="newNote"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 6 }"
                placeholder="例如：已致電，家長希望週六上午，下週回覆"
                aria-label="新增聯絡紀錄"
                @keydown.meta.enter="addNote"
                @keydown.ctrl.enter="addNote"
              />
              <div class="notes__row">
                <label class="notes__follow">
                  <span>下次聯絡</span>
                  <el-date-picker
                    v-model="followUpAt"
                    type="datetime"
                    value-format="YYYY-MM-DDTHH:mm:ss+08:00"
                    format="MM/DD HH:mm"
                    placeholder="不用再追"
                    :disabled-date="disablePast"
                    :default-time="new Date(2000, 0, 1, 10, 0, 0)"
                    :shortcuts="followUpShortcuts"
                    popper-class="notes__follow-popper"
                    clearable
                    style="width: 160px"
                  />
                </label>
                <el-button :loading="pendingAction === 'note'" :disabled="!newNote.trim() || busy" @click="addNote">新增紀錄</el-button>
                <span class="hint notes__hint">按 ⌘／Ctrl＋Enter 也能送出</span>
              </div>
              <!-- 報讀區一直留在頁面上，提示出現或消失時報讀軟體才會念出來。 -->
              <div class="notes__status" role="status">
                <p v-if="followUpPast" class="field-help notes__past">
                  下次聯絡的時間已經過了：不改的話，記完這筆紀錄後案件仍會列在「到期待追蹤」。要再追就選新時間，不用再追就清空。
                </p>
              </div>
            </div>
          </section>

          <ParentAccessLinkPanel
            v-if="linkApplicable"
            :visit-id="detail.id"
            :access-link="detail.access_link"
            :can-handle="canHandle"
            :status="detail.status"
            :email="detail.email ?? null"
            :deadline-hours="detail.parent_change_deadline_hours"
            @changed="refreshDetail"
          />

          <section class="section">
            <div class="section__title"><h2>案件歷程</h2><span class="hint">誰在什麼時候改了什麼</span></div>
            <VisitHistoryTimeline :events="detail.history ?? []" :staff="staff" />
          </section>
        </div>

        <aside class="detail__side">
          <div class="panel">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body detail__actions">
              <p v-if="!canHandle" class="hint">你的帳號只能查看案件，狀態由負責處理案件的同事更新。</p>
              <template v-else-if="detail.status === 'new' || detail.status === 'contacting'">
                <p class="hint">這是改版前的舊需求。選一個場次排入就成立，有 Email 會寄確認信給家長。</p>
                <el-select v-model="selectedSlotId" placeholder="選擇參觀時段" :disabled="openSlots.length === 0" style="width: 100%">
                  <el-option v-for="slot in openSlots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id" />
                </el-select>
                <p v-if="openSlots.length === 0" class="hint">
                  <template v-if="canManage">未來 60 天沒有可用時段。先到 <router-link to="/visit-calendar">參觀場次</router-link> 新增。</template>
                  <template v-else>未來 60 天沒有可用時段，請校區管理者到「參觀場次」新增。</template>
                </p>
                <el-button type="primary" :loading="pendingAction === 'confirm'" :disabled="!selectedSlotId || busy" style="width: 100%" @click="confirm">
                  排入場次
                </el-button>
              </template>

              <template v-else-if="detail.status === 'pending_confirmation'">
                <p class="hint">家長已選擇場次，名額暫時保留。確認後預約才會成立。</p>
                <template v-if="detail.hold_expires_at">
                  <!-- 期限在頁面開著時過了要念出來：報讀區先留在頁面上，只放過期說明，每分鐘變的倒數不放進來。 -->
                  <div class="hold-status" role="status">
                    <p v-if="holdExpired" class="hold-deadline is-urgent">
                      確認期限 <strong class="num">{{ formatDateTime(detail.hold_expires_at) }}</strong> 已過，不能再確認，系統會自動取消這筆並釋出名額。請重新讀取看最新狀態。
                    </p>
                  </div>
                  <p v-if="!holdExpired" class="hold-deadline" :class="{ 'is-urgent': holdIsUrgent(detail.hold_expires_at, clockNow) }">
                    請於 <strong class="num">{{ formatDateTime(detail.hold_expires_at) }}</strong> 前確認（{{ formatHoldRemaining(detail.hold_expires_at, clockNow) }}），逾期名額會自動釋出。
                  </p>
                </template>
                <el-button v-if="holdExpired" :disabled="busy" style="width: 100%" @click="load({ quiet: true })">重新讀取案件</el-button>
                <el-button type="primary" :loading="pendingAction === 'confirm'" :disabled="!detail.slot || holdExpired || busy" style="width: 100%; margin-left: 0" @click="confirm">確認這個場次</el-button>
              </template>

              <template v-else-if="detail.status === 'confirmed'">
                <div v-if="detail.pending_reschedule" class="reschedule-request" role="group" aria-label="家長的改期申請">
                  <p class="reschedule-request__title">家長申請改期<span class="num">（{{ formatDateTime(detail.pending_reschedule.created_at) }}）</span></p>
                  <p class="reschedule-request__slots">
                    {{ formatSlotWhen(detail.pending_reschedule.current_slot) }}<br />→ <strong>{{ formatSlotWhen(detail.pending_reschedule.requested_slot) }}</strong>
                  </p>
                  <p class="hint">
                    {{ detail.pending_reschedule.requested_slot_available
                      ? `新時段剩 ${detail.pending_reschedule.requested_slot_remaining} 組。原時段在核准前仍有效。`
                      : '新時段已額滿、關閉或已開始，無法核准；請退回並聯絡家長另約。' }}
                  </p>
                  <div class="reschedule-request__actions">
                    <el-button type="primary" :loading="pendingAction === 'approve'" :disabled="!detail.pending_reschedule.requested_slot_available || busy" @click="decideReschedule('approve')">核准改期</el-button>
                    <el-button :loading="pendingAction === 'reject'" :disabled="busy" @click="decideReschedule('reject')">退回申請</el-button>
                  </div>
                </div>
                <div v-if="!detail.pending_reschedule || manualRescheduleOpen" class="reschedule" role="group" aria-labelledby="visit-reschedule-title">
                  <p id="visit-reschedule-title" ref="rescheduleTitle" class="reschedule__title" tabindex="-1">改期（換時段）</p>
                  <el-select ref="rescheduleSelect" v-model="rescheduleSlotId" placeholder="選擇新的參觀時段" :disabled="rescheduleSlots.length === 0" aria-label="改期的新時段" style="width: 100%">
                    <el-option v-for="slot in rescheduleSlots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id" />
                  </el-select>
                  <p v-if="rescheduleSlots.length === 0" class="hint">
                    <template v-if="canManage">未來 60 天沒有其他可用時段。先到 <router-link to="/visit-calendar">參觀場次</router-link> 新增。</template>
                    <template v-else>未來 60 天沒有其他可用時段，請校區管理者到「參觀場次」新增。</template>
                  </p>
                  <el-input v-model="rescheduleReason" maxlength="500" placeholder="改期原因（選填）" aria-label="改期原因" />
                  <el-button :loading="pendingAction === 'reschedule'" :disabled="!rescheduleSlotId || busy" style="width: 100%; margin-left: 0" @click="reschedule">改到這個時段</el-button>
                  <p class="hint">案件編號與紀錄不變，原時段名額在同一步釋出；新時段滿了會整筆不改。</p>
                </div>
                <div v-else class="reschedule reschedule--collapsed">
                  <el-button link type="primary" class="reschedule__toggle" aria-expanded="false" @click="openManualReschedule">不照申請，改到其他時段…</el-button>
                </div>
                <p v-if="!visitStarted" class="hint">參觀時段開始後可以標記已到場或未到場；家長事先說不來，請用下方的「取消預約」。</p>
                <div v-else class="detail__attendance">
                  <p class="hint">家長來參觀後標記；沒有出現請標記未到場。</p>
                  <el-button text type="primary" :loading="pendingAction === 'complete'" :disabled="busy" @click="markCompleted">標記已到場</el-button>
                  <el-button text :loading="pendingAction === 'no_show'" :disabled="busy" @click="markNoShow">標記未到場</el-button>
                </div>
              </template>

              <template v-else>
                <p class="hint">這筆案件已結案。家長想再約，請另建新案，舊案會保留原紀錄。</p>
                <el-button :disabled="busy" style="width: 100%" @click="rebookOpen = true">重新預約（另建新案）</el-button>
              </template>
            </div>
            <div v-if="canReadAdmissions && admissionsAvailable === 'yes' && (admissionsVisit || detail.status === 'completed')" class="detail__admissions">
              <span class="detail__admissions-label">招生訪視</span>
              <router-link v-if="admissionsVisit" :to="admissionsLink">{{ stageLabel(admissionsVisit.stage) }}・在招生入學查看</router-link>
              <template v-else-if="canCreateAdmissions">
                <span class="hint">已到場，但還沒有招生訪視。</span>
                <el-button size="small" :loading="creatingAdmissions" :disabled="busy" @click="createAdmissionsVisit">建立招生訪視</el-button>
              </template>
              <span v-else class="hint">已到場，但還沒有招生訪視；請有招生權限的同事建立。</span>
            </div>
            <div class="detail__assignee">
              <label for="visit-assignee">承辦人</label>
              <!-- 選項寫名字，下面一行小字是完整 Email：同名或同 Email 前綴的同事才分得出來。 -->
              <el-select
                v-if="canManage"
                id="visit-assignee"
                :model-value="detail.assigned_staff_id ?? ''"
                :loading="assigning"
                :disabled="assigning"
                :title="staffEmailById(detail.assigned_staff_id, staff) || undefined"
                placeholder="未指派"
                clearable
                popper-class="assignee-popper"
                style="width: 100%"
                @change="(value: string) => assign(value || null)"
              >
                <el-option
                  v-if="detail.assigned_staff_id && !assignable.some((s) => s.id === detail!.assigned_staff_id)"
                  :value="detail.assigned_staff_id"
                  :label="staffLabelById(detail.assigned_staff_id, staff)"
                  disabled
                />
                <el-option v-for="s in assignable" :key="s.id" :value="s.id" :label="staffLabel(s)">
                  <span class="assignee-option" data-test="assignee-option">
                    <span class="assignee-option__name">{{ staffLabel(s) }}</span>
                    <span class="assignee-option__email">{{ s.email }}</span>
                  </span>
                </el-option>
              </el-select>
              <span v-else :title="staffEmailById(detail.assigned_staff_id, staff) || undefined">{{ staffLabelById(detail.assigned_staff_id, staff) }}</span>
            </div>
            <div
              v-if="canHandle && ['new', 'contacting', 'pending_confirmation', 'confirmed'].includes(detail.status)"
              class="detail__danger"
            >
              <span class="hint">家長不來了？</span>
              <el-button text type="danger" :loading="pendingAction === 'cancel'" :disabled="busy" class="detail__cancel" @click="cancel">{{ cancelsRequest ? '取消這筆需求' : '取消預約' }}</el-button>
            </div>
          </div>
        </aside>
      </div>
      <ManualVisitDialog v-model="rebookOpen" :campus-keys="visibleCampusKeys" :related-from="detail" @created="onRebooked" />
    </template>
  </div>
</template>

<style scoped>
.hold-deadline { margin: 0; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); color: var(--ink-2); font-size: 13px; line-height: 1.6; }
.hold-deadline strong { color: var(--ink); font-weight: 600; }
.hold-deadline.is-urgent { background: var(--el-color-warning-light-9); color: var(--brand-gold-ink); }
.detail__nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail__back {
  margin-left: -8px;
}

.detail__next {
  margin-right: -8px;
}

.detail__follow {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ink-2);
}

.detail__follow.is-due {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

/* 桌機的電話在資料表第一列、旁邊就是滑鼠；撥號鈕只在手機版面出現。 */
.detail__call {
  display: none;
}

.notes__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.notes__follow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
}

.notes__hint {
  font-size: 12px;
}

.notes__past {
  margin: 0;
}

/* 報讀區沒有內容時不占位置：抵掉外層 flex 的間距（不能用 display: none，否則報讀軟體看不到它）。 */
.notes__status:empty {
  margin-top: -8px;
}

.hold-status:empty {
  margin-top: -12px;
}

/* 承辦人、取消與上方處理區塊用同一條左右內距，文字左緣才對齊。 */
.detail__assignee {
  display: grid;
  gap: 6px;
  padding: 16px 24px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-2);
}

/* 招生訪視：與承辦人同一種分隔與留白。 */
.detail__admissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-2);
}

.detail__admissions-label {
  flex-basis: 100%;
  font-weight: 500;
}

.detail__admissions a {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 取消預約與主動作隔開一段，並用分隔線宣告它是另一類動作，減少誤觸。 */
.detail__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 24px 6px;
  border-top: 1px solid var(--line);
}

.detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.detail__title {
  font-size: 22px;
}

.detail__when {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-color-primary);
}

.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}

.detail__pre {
  white-space: pre-wrap;
}

.notes {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}

.notes__item {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.notes__item:first-child {
  border-top: 0;
  padding-top: 0;
}

.notes__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-bottom: 2px;
  font-size: 12px;
}

.notes__time {
  color: var(--ink-3);
}

.notes__author {
  color: var(--ink-2);
}

.reschedule,
.reschedule-request {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.reschedule--collapsed {
  justify-items: start;
}

.reschedule-request {
  padding: 12px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: var(--radius);
  background: var(--el-color-warning-light-9);
}

.reschedule__title,
.reschedule-request__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.reschedule-request__title .num {
  font-weight: 400;
  color: var(--ink-3);
}

.reschedule-request__slots {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-2);
}

/* 新時段整段一行，不會把「10:00–」和「11:00」拆到兩行。 */
.reschedule-request__slots strong {
  color: var(--ink);
  white-space: nowrap;
}

.reschedule-request__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reschedule-request__actions .el-button + .el-button {
  margin-left: 0;
}

.notes__form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.detail__side {
  position: sticky;
  top: calc(var(--top-h) + 16px);
}

.detail__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail__cancel {
  margin-right: -8px;
}

/* 觸控裝置沒有 ⌘／Ctrl 鍵，不顯示快捷鍵提示；電話、Email 連結放大到 44px 好點。 */
@media (hover: none), (pointer: coarse) {
  .notes__hint {
    display: none;
  }

  .detail__link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}

@media (max-width: 900px) {
  .detail__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail__side {
    position: static;
    order: -1;
  }

  .detail__call {
    display: inline-flex;
    width: 100%;
    min-height: 44px;
    margin: -8px 0 16px;
  }

  /* 下一筆的件數比較長，窄螢幕允許換行，不擠出畫面。 */
  .detail__next {
    min-width: 0;
    height: auto;
    white-space: normal;
    text-align: right;
  }
}

@media (max-width: 720px) {
  .detail__assignee,
  .detail__admissions {
    padding: 12px 16px;
  }

  .detail__danger {
    padding: 10px 16px 6px;
  }
}
</style>

<style>
/* 承辦人選單：名字一行、完整 Email 一行小字。Element Plus 的選項預設固定一行高，
   這裡改成自動高度；選單掛在 body 下，scoped 樣式碰不到，用 popper-class 限定。 */
.assignee-popper .el-select-dropdown__item {
  height: auto;
  min-height: 44px;
  padding-top: 6px;
  padding-bottom: 6px;
  line-height: 1.4;
}

.assignee-option {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.assignee-option__name,
.assignee-option__email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignee-option__email {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 400;
}

/* 下次聯絡的快捷選項預設排在日曆左側，面板會比手機畫面寬；窄螢幕改排在日曆上方一列。
   選擇面板掛在 body 下，scoped 樣式碰不到，用 popper-class 限定。 */
/* 觸控裝置（含平板）的快捷選項放大到 44px 高，手指點得到。 */
@media (pointer: coarse) {
  .notes__follow-popper .el-picker-panel__shortcut {
    min-height: 44px;
  }
}

@media (max-width: 480px) {
  .notes__follow-popper .el-date-picker.has-sidebar {
    width: 322px;
  }

  .notes__follow-popper .el-picker-panel__sidebar {
    position: static;
    display: flex;
    flex-wrap: wrap;
    width: auto;
    padding: 4px 8px;
    border-right: 0;
    border-bottom: 1px solid var(--el-datepicker-inner-border-color);
  }

  .notes__follow-popper .el-picker-panel__shortcut {
    width: auto;
    min-height: 44px;
    padding: 0 10px;
  }

  .notes__follow-popper .el-picker-panel__sidebar + .el-picker-panel__body {
    margin-left: 0;
  }
}
</style>
