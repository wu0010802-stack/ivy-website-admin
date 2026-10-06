<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyError, notifyWarning } from '../composables/notify'
import { ArrowLeft, ArrowRight, Phone } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'
import { lastHandled } from '../api/visitHistory'
import { useAuthStore } from '../stores/auth'
import type { RecruitmentVisit, VisitContactNoteOut, VisitRequestDetailOut, VisitRequestFullOut, VisitSlotOut } from '../api/types'
import { ageLabel, campusLabel, consentRecordLabel, contactTimeLabel, formatDateTime, formatSlotWhen, maskEmail, partySizeLabel, referralSourceLabels, slotStarted, staffEmail, staffEmailById, staffLabel, staffLabelById, staffOf, visitDisplay, visitDisplayStatus, visitSourceLabel, visitStatus } from '../api/labels'
import { groupSlotsByDay, slotChoiceTime } from '../utils/sessions'
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
import { useFamilyAdmissions } from '../composables/useFamilyAdmissions'
import { ARRIVAL_FORM_CANCEL_TEXT, arrivalFormLead } from '../composables/useArrivalAdmissionsForm'
import { arrivalAdmissionsNote } from '../composables/visitAttendance'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { stageMeta } from '../admissions/constants'
import { arrivedAt, arrivedLabel, detailOrigin, familyLastHandled, familyNotes, latestContact } from '../admissions/family'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import FamilyContactNotes from '../components/visit/FamilyContactNotes.vue'

const route = useRoute()
const authStore = useAuthStore()
const openRequests = useOpenRequestsStore()
const router = useRouter()
const id = computed(() => route.params.id as string)

const detail = ref<VisitRequestFullOut | null>(null)
// 招生部分（招生規格第 10 節、2026-10-05 家庭頁規格 5.10）：composables/useFamilyAdmissions.ts。
const family = useFamilyAdmissions(detail, { reloadDetail: () => load({ quiet: true }) })
const { canRead: canReadAdmissions, canWrite: canCreateAdmissions, visit: admissionsVisit, available: admissionsAvailable, creating: creatingAdmissions } = family
const createAdmissionsVisit = family.create
const { isFamily, events: familyEvents, contactLogs: familyLogs, staff: familyStaff, options: familyOptions, extrasFailed, lookupFailed } = family
// 家庭版面時的招生訪視；不是家庭版面就是 null（模板用它切換版面）。
const familyVisit = computed(() => (isFamily.value ? admissionsVisit.value : null))
// 家長預約時填的資料在家庭版面收合（家庭頁規格 5.3）；換案件時收回去。
const bookingDataOpen = ref(false)
// 頁首「最後處理」：同事最近一次動這筆案件（api/visitHistory.ts）；家庭版面再併入招生事件與參觀後聯絡。
const handled = computed(() => {
  const current = detail.value
  if (!current) return null
  const selfId = authStore.user?.id ?? null
  return familyVisit.value
    ? familyLastHandled(current.history ?? [], familyEvents.value, familyLogs.value, selfId)
    : lastHandled(current.history ?? [], selfId)
})
const notes = ref<VisitContactNoteOut[]>([])
const availableSlots = ref<VisitSlotOut[]>([])
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
// 選擇器帶入時的伺服器值與案件版本（基準）。切回分頁靜默重讀時，選擇器沒動就跟著換成新值；
// 動過而同事也改了，就保留自己的選擇、送出時帶基準版本，讓後端回 409 走衝突處理，
// 不會把同事改好的時間用舊值蓋回去。
let followUpBase: { picker: string | null; version: number } | null = null
// 同校還沒處理完的其他案件，讓櫃台能一筆接一筆處理，不必每次回列表。
// 從列表點進來時跟著那份列表的條件與順序（list）；沒有來源時照下方 loadNextCases 的處理優先序。
interface NextCount { count: number; more: boolean }
const nextQueue = ref<{ id: string; attendance: NextCount; due: NextCount; list?: { count: number } } | null>(null)
// 哪一個動作正在處理：只有按下去的那顆按鈕轉圈，其他按鈕只停用，
// 不會讓人以為自己按到了別顆。
type DetailAction = 'cancel' | 'no_show' | 'complete' | 'reschedule' | 'note' | RescheduleAction
const pendingAction = ref<DetailAction | null>(null)
const busy = computed(() => pendingAction.value !== null)
const rebookOpen = ref(false)
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const loading = ref(true)
const { can } = usePermissions()
// 處理案件（聯絡紀錄、確認、取消、改期…）含櫃台；新增時段仍是校區管理者以上
// （booking.manage）。
const canHandle = computed(() => can('booking.handle'))
const canManage = computed(() => can('booking.manage'))
const { staff, load: loadStaff } = useVisitStaff()

// 打好還沒按「新增紀錄」的聯絡紀錄：返回、下一筆、側欄換頁前都先問，
// 不然同事接手時看不到這段聯絡過程。處理中（例如正在新增紀錄）先請使用者稍候。
// 家庭版面沒有文字框：看不到的草稿不擋離開（家庭頁規格 Review Focus 1）。
// 已到場、還在等招生查詢的空檔：先不畫改版前的版面，免得查完整頁跳成家庭版面（也看不到的草稿同樣不擋離開）。
const familyPending = computed(() =>
  detail.value?.status === 'completed' && Boolean(authStore.features.admissions) && canReadAdmissions.value && admissionsAvailable.value === 'unknown' && !lookupFailed.value,
)
const noteDirty = computed(() => canHandle.value && !familyVisit.value && !familyPending.value && newNote.value.trim() !== '')
const { confirmLeave } = useUnsavedChanges(noteDirty, busy)
// 「下一筆」只換 :id，不會觸發離頁守衛，要另外攔。
onBeforeRouteUpdate((to, from) => (to.params.id !== from.params.id ? confirmLeave() : true))

const error = ref<string | null>(null)

// 「下一筆」換 id 時元件不重新掛載：換案件就加一，舊案件較晚回來的
// 回應不能蓋掉畫面（否則畫面是家長 A、送出卻寫到案件 B）。
let generation = 0
// 上次讀到案件的時間：切回分頁時超過 DETAIL_STALE_MS 才靜默重讀（不做固定輪詢）。
let loadedAt = 0
const DETAIL_STALE_MS = 30_000

// 日期選擇器用台灣時間的字串（value-format），案件上的是 UTC ISO。
function toPickerValue(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00'
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return new Date(a).getTime() === new Date(b).getTime()
}

// 讀到案件後同步「下次聯絡」。reset：換案件或剛存好，選擇器直接換成伺服器的值；
// quiet：背景重讀，選擇器沒動才跟著換，動過就只在伺服器上的值沒變時更新版本；
// rebase：送出遇到版本衝突、已經提示過，以最新版本為基準（自己動過的選擇照樣保留）。
function syncFollowUp(loaded: VisitRequestFullOut, mode: 'reset' | 'quiet' | 'rebase') {
  const server = toPickerValue(loaded.follow_up_at)
  const base = followUpBase
  const untouched = !base || sameInstant(followUpAt.value, base.picker)
  if (mode === 'reset' || untouched) followUpAt.value = server
  if (mode !== 'quiet' || untouched || sameInstant(server, base?.picker)) followUpBase = { picker: server, version: loaded.version }
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
    loadedAt = Date.now()
    notes.value = notesResult.value
    syncFollowUp(loaded, options.quiet ? 'quiet' : 'reset')
    void loadNextCases(loaded.campus_key)
    // 改期（已確認）從同校未來 60 天的場次挑。
    let slots: VisitSlotOut[] = []
    if (loaded.status === 'confirmed') {
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
    if (options.quiet) {
      // 靜默重讀失敗不能換掉整個畫面（正在打的聯絡紀錄草稿會消失），保留現況並提醒。
      notifyWarning('無法更新案件，畫面可能不是最新。')
      return
    }
    error.value = err instanceof ApiError && err.status === 404 ? '找不到這筆案件，可能已被移除或不在你的校區範圍。' : '無法讀取案件'
  } finally {
    if (gen === generation) loading.value = false
  }
}

// 動作完成後只更新案件本身（含歷程），不切回骨架畫面：家長連結剛產生的
// 網址還顯示在頁面上，重新掛載就看不到了。
async function refreshDetail(followUp: 'quiet' | 'rebase' = 'quiet') {
  const gen = generation
  try {
    const loaded = await api.get<VisitRequestFullOut>(`/admin/visit-requests/${id.value}`)
    if (gen !== generation) return
    detail.value = loaded
    syncFollowUp(loaded, followUp)
  } catch {
    /* 下次重新整理再讀 */
  }
}

// 下一筆的清單上限；回傳剛好這麼多筆時，件數寫「N+」，不假裝是全部。
const NEXT_LIMIT = 100

// 排序用的時間：沒有值的排在最後。
function timeOf(value: string | null | undefined): number {
  const at = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}
const visitTime = (request: VisitRequestDetailOut) =>
  timeOf(request.slot ? `${request.slot.slot_date}T${request.slot.start_time.slice(0, 8)}+08:00` : null)
const byTime = (key: (r: VisitRequestDetailOut) => number) => (a: VisitRequestDetailOut, b: VisitRequestDetailOut) => {
  const x = key(a)
  const y = key(b)
  return x === y ? 0 : x < y ? -1 : 1
}

// 列表帶進來的條件只收這些鍵，其餘忽略；分頁與每頁筆數由這裡自己決定。
const LIST_KEYS = ['campus_key', 'group', 'status', 'open', 'q', 'follow_up_due', 'source', 'created_from', 'created_to', 'needs_attention', 'order', 'page', 'page_size']
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

const NONE: NextCount = { count: 0, more: false }
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
    ? { id: next.id, attendance: NONE, due: NONE, list: { count: others.length } }
    : null
}

// 下一筆的順序（2026-09-30 家長自選場次之後）：先是參觀時間已過、還沒標記到場的預約，
// 參觀時間早的先；再來是到期待追蹤，預定聯絡時間早的先。後端列表只能依送出時間排序，
// 這裡自己排；同一筆同時符合兩段時只算在前一段。
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
  const fetchList = (params: Record<string, string>) =>
    api.get<VisitRequestDetailOut[]>(
      `/admin/visit-requests?${new URLSearchParams({ ...params, campus_key: campusKey, order: 'oldest', page_size: String(NEXT_LIMIT) })}`,
    )
  try {
    const [attendance, due] = await Promise.all([
      fetchList({ group: 'past', status: 'confirmed' }),
      fetchList({ follow_up_due: 'true' }),
    ])
    if (gen !== generation) return
    const rows = (list: unknown) => (Array.isArray(list) ? (list as VisitRequestDetailOut[]) : [])
    const seen = new Set([id.value])
    const take = (list: VisitRequestDetailOut[]) => list.filter((r) => !seen.has(r.id) && seen.add(r.id))
    const attendanceOthers = take(rows(attendance).sort(byTime(visitTime)))
    const dueOthers = take(rows(due).sort(byTime((r) => timeOf(r.follow_up_at))))
    const first = attendanceOthers[0] ?? dueOthers[0]
    const full = (list: unknown) => rows(list).length >= NEXT_LIMIT
    nextQueue.value = first
      ? {
          id: first.id,
          attendance: { count: attendanceOthers.length, more: full(attendance) },
          due: { count: dueOthers.length, more: full(due) },
        }
      : null
  } catch {
    if (gen === generation) nextQueue.value = null
  }
}

// 按鈕上寫清楚算的是什麼：同校待標記到場幾件、到期追蹤幾件（不含這一筆）。
const nextCount = (c: NextCount) => `${c.count}${c.more ? '+' : ''}`
const nextLabel = computed(() => {
  const q = nextQueue.value
  if (!q) return ''
  if (q.list) return `下一筆（這份列表還有 ${q.list.count} 件）`
  const parts = [
    q.attendance.count ? `待標記到場 ${nextCount(q.attendance)}` : '',
    q.due.count ? `到期追蹤 ${nextCount(q.due)}` : '',
  ].filter(Boolean)
  return `下一筆（${parts.join('・')}）`
})

const nextTitle = computed(() => {
  const q = nextQueue.value
  if (!q || !detail.value) return ''
  if (q.list) return '照剛才案件列表的篩選條件與排序往下'
  return `${campusLabel(detail.value.campus_key)}還有參觀時間已過、尚未確認到場 ${q.attendance.count} 件，到期待追蹤 ${q.due.count} 件（不含這一筆）；參觀時間早的排最前面`
})

function reportError(err: unknown, fallback: string) {
  if (isVersionConflict(err)) {
    // 別人剛改過下次聯絡時間：不蓋掉，重讀案件讓畫面顯示最新的。
    // 已經自動重讀，所以不接後端「請重新載入後再操作」的訊息。
    notifyWarning('這筆案件的下次聯絡時間剛被其他人修改，已載入最新的內容，請確認後再操作')
    void refreshDetail('rebase')
    return
  }
  if (apiErrorCode(err) === 'INVALID_TRANSITION') {
    void reloadAfterTransitionConflict(err, fallback)
    return
  }
  notifyError(apiErrorMessage(err, fallback))
}

// 狀態轉換被擋：多半是同事剛處理過（兩人同時開著同一筆）。重讀後狀態真的變了就寫
// 現在是什麼、誰在什麼時候做的；狀態沒變（例如場次還沒開始就標記未到場）照後端原因講。
async function reloadAfterTransitionConflict(err: unknown, fallback: string) {
  const before = detail.value?.status
  const handledBefore = handled.value?.at ?? null
  await load({ quiet: true })
  const current = detail.value
  if (!current || !before || current.status === before) {
    notifyError(apiErrorMessage(err, fallback))
    return
  }
  // 只有同事有比重讀前更新的動作才點名；狀態是家長（修改連結）或系統改的就用中性說法。
  const latest = handled.value
  const newer = latest !== null && (handledBefore === null || Date.parse(latest.at) > Date.parse(handledBefore))
  const label = statusDisplay.value?.label ?? visitStatus(current.status).label
  if (newer && !latest.self) {
    notifyWarning(`這筆案件剛被處理過：${latest.who}在 ${formatDateTime(latest.at)} ${latest.what}，現在是「${label}」。已載入最新內容，請確認後再操作。`)
  } else {
    notifyWarning(`這筆案件剛被更新，現在是「${label}」。已載入最新內容，請確認後再操作。`)
  }
}

// 切回這個分頁或視窗：距上次讀取超過 30 秒就靜默重讀（不閃骨架、不動聯絡紀錄草稿與
// 「下次聯絡」的選擇），同事剛處理過就提示一句。
function activityKey(): string {
  const d = detail.value
  return d ? `${d.status}|${d.slot_id ?? ''}|${d.history?.length ?? 0}` : ''
}
// 切回時 focus 與 visibilitychange 通常連續觸發：重讀進行中就略過，只讀一次、只提示一次。
let refreshing = false
async function refreshIfStale() {
  if (refreshing || document.visibilityState === 'hidden' || loading.value || busy.value || !detail.value) return
  if (Date.now() - loadedAt < DETAIL_STALE_MS) return
  refreshing = true
  try {
    const before = activityKey()
    const handledBefore = handled.value?.at ?? null
    const gen = generation
    await load({ quiet: true })
    // 家庭版面的招生訪視、事件與聯絡紀錄不在 load 裡，同事剛在招生端動過的要一起讀回來。
    if (gen === generation && familyVisit.value) void family.reload()
    if (gen !== generation || !before || activityKey() === before) return
    const latest = handled.value
    // 只有同事有比重讀前更新的動作才點名；變動來自家長或系統就用中性說法。
    const newer = latest !== null && (handledBefore === null || Date.parse(latest.at) > Date.parse(handledBefore))
    if (newer && latest.self) return
    notifyWarning(newer ? `${latest.who}剛剛${latest.what}，畫面已更新。` : '這筆案件剛有更新，畫面已重新整理。')
  } finally {
    refreshing = false
  }
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
// 側欄窄，選單收起後的完整場次會被截斷；選好後在下面整行再寫一次。
function chosenSlotText(slots: VisitSlotOut[], slotId: string): string {
  const slot = slots.find((s) => s.id === slotId)
  return slot ? slotLabel(slot) : ''
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
async function cancel() {
  // 參觀時間已過：家長沒來要標記未到場，取消會被算成園方取消、名額也會釋出。
  const noShowNote = attendanceDue.value ? '家長沒來請改用上方的「標記未到場」。' : ''
  let reason: string | null = null
  try {
    const result = await ElMessageBox.prompt(
      `${noShowNote}原場次的名額會釋出。案件會結案。${parentMailNote.value}家長之後想再約，可以在這一頁用「重新預約（另建新案）」接續，不必請家長重新送出。`,
      '取消這筆預約？',
      {
        confirmButtonText: '取消預約',
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

// 參觀場次開始後才出現「標記已到場」與「標記未到場」（後端也會拒絕）：兩者都會
// 保留這一場的名額，提早按下去未來那一場就永遠排不進人；家長事先說不來要取消。
// 櫃台常開著案件頁等家長來，時間每 30 秒重算一次，場次一開始按鈕就出現；
// 下次聯絡是否已過也跟著這個時鐘更新。
const clockNow = ref(Date.now())
const clock = window.setInterval(() => { clockNow.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(clock))
const visitStarted = computed(() => {
  const slot = detail.value?.slot
  return slot ? slotStarted(slot, clockNow.value) : false
})
// 已確認而且場次已經開始：該做的是標記已到場／未到場，不是取消。
const attendanceDue = computed(() => detail.value?.status === 'confirmed' && visitStarted.value)
// 頁首狀態和案件列表同一種說法（預約正常／預約時間已過・尚未確認到場…）。
// 分組跟著上面的時鐘重算：開著頁面等家長來，場次一開始就換成「預約時間已過」。
const statusDisplay = computed(() => {
  const current = detail.value
  return current ? visitDisplay({ ...current, display_status: visitDisplayStatus(current.status, current.slot, clockNow.value) }) : null
})
// 手動改期表單一律先收成一個連結，要用再展開（2026-10-05 第九輪）：改期不是每筆都要做的事，
// 整個表單攤在處理面板最上面，手機上會把聯絡紀錄推到很下面。家長申請改期時先核准或退回，
// 參觀開始後先標記到場，也都是先看到那些按鈕。
const manualRescheduleShown = computed(() => manualRescheduleOpen.value)
// 確認時間和送出時間同一分鐘（官網自選場次送出即成立）時不重複列；舊流程與補登才會不同。
const confirmedAtShown = computed(() => {
  const current = detail.value
  return Boolean(current?.confirmed_at) && formatDateTime(current!.confirmed_at) !== formatDateTime(current!.created_at)
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
    notifyWarning('請先選擇新的參觀場次')
    return
  }
  try {
    await ElMessageBox.confirm(
      `${current.parent_name} 的參觀時間會從 ${formatSlotWhen(current.slot)} 改到 ${formatSlotWhen(target)}，原場次名額釋出。${parentMailNote.value}`,
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
    ElMessage.success(action === 'approve' ? `已核准，改到 ${formatSlotWhen(request.requested_slot)}。記得告知家長。` : '已退回改期申請，家長維持原場次')
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
// 能改招生資料的人標記後接著打開招生資料表單（2026-10-06，同案件列表的 useArrivalAdmissionsForm）。
async function markCompleted() {
  // 招生查詢還在跑不是錯誤：等查完再決定要不要確認框，免得開關打開時沒確認就建了招生訪視。
  const lookupInFlight = canReadAdmissions.value ? family.settled() : null
  if (lookupInFlight) await lookupInFlight
  const withAdmissions = admissionsAvailable.value === 'yes'
  const opensForm = withAdmissions && canCreateAdmissions.value
  if (withAdmissions) {
    try {
      await ElMessageBox.confirm(arrivalAdmissionsNote(opensForm), '標記已到場？', {
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
    if (!opensForm) ElMessage.success(withAdmissions ? '已標記已到場，招生訪視已建立' : '已標記已到場')
    openRequests.refresh(true)
    await load({ quiet: true })
    if (opensForm) await openArrivalForm()
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    pendingAction.value = null
  }
}

// ---- 家庭版面（2026-10-05 家庭頁規格第 5 節）----
const familyNoteList = computed(() => familyNotes(notes.value, familyLogs.value, arrivedAt(detail.value?.history ?? [])))
const latestFamilyContact = computed(() => latestContact(familyLogs.value))
// 撥號：園方改過以招生那筆為準，招生電話空的退回預約電話（規格 5.2）。
// 匿名化後預約電話也會被寫成假號碼，退回撥它沒有意義：整顆不顯示（Review Focus 3）。
const callPhone = computed(() => {
  const v = familyVisit.value
  if (!v) return detail.value?.phone ?? ''
  if (v.anonymized_at) return ''
  return v.phone || detail.value?.phone || ''
})
const bookingDataTitle = computed(() => {
  if (familyVisit.value) return isWebCase.value ? '家長預約時填寫的資料' : '補登時的案件資料'
  return isWebCase.value ? '家長填寫的資料' : '案件資料'
})

// 標記已到場後的招生資料表單：狀態變成已到場會重查招生訪視（useFamilyAdmissions），等查完、
// 查得到就打開（後面同時換成家庭版面）；表單上方寫出已到場，所以不另跳成功訊息。
const arrivalOpen = ref(false)
const arrivalLead = ref('')
async function openArrivalForm() {
  await nextTick()
  const lookup = family.settled()
  if (lookup) await lookup
  const current = detail.value
  if (current?.status === 'completed' && admissionsVisit.value) {
    arrivalLead.value = arrivalFormLead(current.parent_name)
    arrivalOpen.value = true
  } else {
    ElMessage.success('已標記已到場，招生訪視已建立')
  }
}

function onFamilyChanged(next: RecruitmentVisit) {
  family.replaceVisit(next)
  void family.loadExtras()
}

async function addNote() {
  // 畫面上的案件（detail）才是要寫的那一筆；還在載入下一筆時不送。
  if (!newNote.value.trim() || !detail.value || detail.value.id !== id.value || busy.value) return
  const gen = generation
  const current = detail.value
  const nextFollowUp = followUpAt.value || null
  // 改或清下次聯絡時間會蓋掉案件上的值，要帶版本；沒動就只記一筆紀錄。已到場、已取消的案件
  // 不列入到期待追蹤，選擇器也不顯示，不送下次聯絡（後端 FOLLOW_UP_NOT_TRACKED）。
  // 有沒有動、帶哪個版本都跟選擇器帶入時的基準比（followUpBase），不是重讀後的案件：
  // 同事在這段期間改過的話，後端會回 409，不會把同事的時間蓋掉。
  const base = followUpBase ?? { picker: toPickerValue(current.follow_up_at), version: current.version }
  const followUpChanged = followUpTracked.value && !sameInstant(nextFollowUp, base.picker)
  pendingAction.value = 'note'
  try {
    await api.post(`/admin/visit-requests/${current.id}/contact-notes`, {
      note: newNote.value.trim(),
      ...(followUpChanged ? { follow_up_at: nextFollowUp, expected_version: base.version } : {}),
    })
    if (gen !== generation) return
    newNote.value = ''
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${current.id}/contact-notes`)
    // 追蹤時間存在案件上、歷程也多一筆；重讀一次頁首與歷程。
    await refreshDetail()
    if (gen !== generation) return
    if (detail.value) syncFollowUp(detail.value, 'reset')
    if (followUpChanged) ElMessage.success(nextFollowUp ? '已記下，到時會出現在總覽的「到期待追蹤」' : '已清除下次聯絡時間，不會再出現在「到期待追蹤」')
  } catch (err) {
    reportError(err, '新增紀錄失敗')
  } finally {
    pendingAction.value = null
  }
}

// 上一頁是哪裡（2026-10-05 家庭頁規格 6.2）：從招生入學或案件列表來的用瀏覽器返回（保留分頁、篩選與
// 捲動位置）；從通知連結、登入頁或別的頁面進來時，返回會回到不相干的地方，改成直接開案件列表。
const readOrigin = () => detailOrigin((router.options.history.state as { back?: unknown } | null)?.back)
const origin = ref(readOrigin())
const backLabel = computed(() => (origin.value === 'admissions' ? '招生入學' : '參觀案件'))

function goBack() {
  if (origin.value === 'other') void router.push('/visit-requests')
  else router.back()
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
  document.addEventListener('visibilitychange', refreshIfStale)
  window.addEventListener('focus', refreshIfStale)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', refreshIfStale)
  window.removeEventListener('focus', refreshIfStale)
})
// 「下一筆」是同一個元件換 id，router 不會重新掛載。
watch(id, () => {
  generation += 1
  origin.value = readOrigin()
  detail.value = null
  notes.value = []
  nextQueue.value = null
  newNote.value = readVisitNoteDraft(id.value)
  bookingDataOpen.value = false
  followUpAt.value = null
  followUpBase = null
  rescheduleSlotId.value = ''
  rescheduleReason.value = ''
  manualRescheduleOpen.value = false
  load()
})

// 還在流程中的案件才需要家長連結；結案時後端已經撤銷。
const linkApplicable = computed(() => detail.value?.status === 'confirmed')

// 官網送出的才是家長自己填的；園方補登的是櫃台代填。
const isWebCase = computed(() => !detail.value?.source || detail.value.source === 'web')
</script>

<template>
  <div class="page detail">
    <div class="detail__nav">
      <el-button text :icon="ArrowLeft" class="detail__back" @click="goBack">{{ backLabel }}</el-button>
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
          <p v-if="handled" class="hint detail__handled">最後處理：{{ handled.who }}・{{ formatDateTime(handled.at) }}・{{ handled.what }}</p>
          <p v-if="detail.related_request_id" class="hint">
            重新預約自 <router-link :to="`/visit-requests/${detail.related_request_id}`">先前的案件</router-link>
          </p>
          <p v-if="detail.slot" class="detail__when">參觀時間 {{ formatSlotWhen(detail.slot) }}</p>
          <p v-if="detail.follow_up_at && followUpTracked" class="detail__follow" :class="{ 'is-due': followUpDue }">
            {{ followUpDue ? '已到預定聯絡時間' : '預定聯絡' }} {{ formatDateTime(detail.follow_up_at) }}
          </p>
        </div>
        <div v-if="familyPending" class="detail__status-pending" aria-hidden="true" />
        <div v-else-if="familyVisit" class="detail__status">
          <StatusTag :meta="stageMeta(familyVisit)" size="large" />
          <span class="detail__status-sub num">{{ arrivedLabel(familyVisit.visit_date) }}</span>
        </div>
        <div v-else-if="statusDisplay" class="detail__status">
          <StatusTag :meta="statusDisplay" size="large" />
          <span v-if="statusDisplay.sub" class="detail__status-sub" :data-tone="statusDisplay.tone">{{ statusDisplay.sub }}</span>
        </div>
      </div>
      <!-- 手機處理面板排在最前面，電話會被擠到下面；打電話是處理案件的第一步，頁首直接給一顆撥號鈕。 -->
      <el-button v-if="callPhone && !familyPending" tag="a" :href="`tel:${callPhone}`" type="primary" plain :icon="Phone" class="detail__call">
        撥電話給家長 {{ callPhone }}
      </el-button>

      <div class="detail__grid">
        <div class="detail__main">
          <el-skeleton v-if="familyPending" animated :rows="6" class="detail__family-pending" />
          <template v-else>
          <FamilyAdmissionsData
            v-if="familyVisit"
            :visit="familyVisit"
            :options="familyOptions"
            :editable="canCreateAdmissions"
            @saved="family.replaceVisit"
            @stale="family.reload"
          />
          <div class="panel detail__data">
            <div class="panel__head">
              <h2>{{ bookingDataTitle }}</h2>
              <el-button
                v-if="familyVisit"
                link
                type="primary"
                :aria-expanded="bookingDataOpen ? 'true' : 'false'"
                aria-controls="visit-booking-data"
                @click="bookingDataOpen = !bookingDataOpen"
              >{{ bookingDataOpen ? '收起' : '展開' }}</el-button>
            </div>
            <el-descriptions v-show="!familyVisit || bookingDataOpen" id="visit-booking-data" :column="1" border label-width="128" class="detail__desc">
              <el-descriptions-item label="電話">
                <a :href="`tel:${detail.phone}`" class="num detail__link">{{ detail.phone }}</a>
              </el-descriptions-item>
              <el-descriptions-item label="孩子姓名">{{ detail.child_name || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="出生年月日">{{ detail.child_birthdate || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="Email"><a v-if="detail.email" :href="`mailto:${detail.email}`" class="detail__link">{{ detail.email }}</a><span v-else>未填寫</span></el-descriptions-item>
              <!-- 官網 10-03 起不問參觀人數與想了解的事、10-02 起不用勾同意：只有舊案件與補登有值才列，
                   新案件不再固定出現「未填寫」「不需勾選同意」（官網沒有的欄位後台不列）。 -->
              <el-descriptions-item v-if="detail.party_size" label="參觀人數">{{ partySizeLabel(detail.party_size) }}</el-descriptions-item>
              <el-descriptions-item label="得知管道">{{ referralSourceLabels(detail.referral_sources) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.age" label="家長填的年齡">{{ ageLabel(detail.age) }}</el-descriptions-item>
              <!-- 家長自選場次之後不再問方便接電話時段，只有舊資料才有值。 -->
              <el-descriptions-item v-if="detail.preferred_time" label="方便接電話時段">{{ contactTimeLabel(detail.preferred_time) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.questions" label="想了解的事">
                <span class="detail__pre">{{ detail.questions }}</span>
              </el-descriptions-item>
              <el-descriptions-item v-if="detail.consent_given" label="同意紀錄">{{ consentRecordLabel(detail) }}</el-descriptions-item>
              <el-descriptions-item v-if="confirmedAtShown" label="確認時間">{{ formatDateTime(detail.confirmed_at) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.cancelled_at" label="取消時間">{{ formatDateTime(detail.cancelled_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <!-- 已到場、有招生訪視時是家庭版面（FamilyContactNotes），這裡是其他情況的聯絡紀錄。 -->
          <!-- 聯絡紀錄每天都在用，排在很少用的家長管理連結前面；手機上再排到家長資料前面（見樣式）。 -->
          <section v-if="!familyVisit" class="section detail__notes">
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
                v-model="newNote"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 6 }"
                placeholder="例如：已致電，家長希望週六上午，下週回覆"
                aria-label="新增聯絡紀錄"
                @keydown.meta.enter="addNote"
                @keydown.ctrl.enter="addNote"
              />
              <div class="notes__row">
                <span v-if="!followUpTracked" class="hint notes__untracked">
                  已到場或已取消的案件不會列入到期待追蹤。
                </span>
                <label v-else class="notes__follow">
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
          <FamilyContactNotes
            v-else
            class="section detail__notes"
            :notes="familyNoteList"
            :logs-failed="extrasFailed.logs"
            :can-record="canCreateAdmissions"
            @reload="family.loadExtras"
          />

          <ParentAccessLinkPanel
            v-if="linkApplicable"
            :visit-id="detail.id"
            :access-link="detail.access_link"
            :can-handle="canHandle"
            :status="detail.status"
            :email="detail.email ?? null"
            :email-enabled="emailEnabled"
            :deadline-hours="detail.parent_change_deadline_hours"
            @changed="refreshDetail"
          />

          <section class="section">
            <div class="section__title"><h2>案件歷程</h2><span class="hint">誰在什麼時候改了什麼</span></div>
            <p v-if="familyVisit && extrasFailed.events" class="hint">
              招生的歷程讀不到。<el-button link type="primary" @click="family.loadExtras">重新載入</el-button>
            </p>
            <VisitHistoryTimeline :events="detail.history ?? []" :staff="staff" :recruitment-events="familyVisit ? familyEvents : undefined" />
          </section>
          </template>
        </div>

        <aside class="detail__side">
          <div class="panel">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body detail__actions">
              <el-skeleton v-if="familyPending" animated :rows="3" />
              <FamilyActions
                v-else-if="familyVisit"
                :visit="familyVisit"
                :staff="familyStaff"
                :latest="latestFamilyContact"
                :rebookable="canHandle"
                @changed="onFamilyChanged"
                @stale="family.reload"
                @rebook="rebookOpen = true"
              />
              <p v-else-if="!canHandle" class="hint">你的帳號只能查看案件，狀態由負責處理案件的同事更新。</p>
              <template v-else-if="detail.status === 'confirmed'">
                <div v-if="detail.pending_reschedule" class="reschedule-request" role="group" aria-label="家長的改期申請">
                  <p class="reschedule-request__title">家長申請改期<span class="num">（{{ formatDateTime(detail.pending_reschedule.created_at) }}）</span></p>
                  <p class="reschedule-request__slots">
                    {{ formatSlotWhen(detail.pending_reschedule.current_slot) }}<br />→ <strong>{{ formatSlotWhen(detail.pending_reschedule.requested_slot) }}</strong>
                  </p>
                  <p class="hint">
                    {{ detail.pending_reschedule.requested_slot_available
                      ? `新場次剩 ${detail.pending_reschedule.requested_slot_remaining} 組。原場次在核准前仍有效。`
                      : '新場次已額滿、關閉或已開始，無法核准；請退回並聯絡家長另約。' }}
                  </p>
                  <div class="reschedule-request__actions">
                    <el-button type="primary" :loading="pendingAction === 'approve'" :disabled="!detail.pending_reschedule.requested_slot_available || busy" @click="decideReschedule('approve')">核准改期</el-button>
                    <el-button :loading="pendingAction === 'reject'" :disabled="busy" @click="decideReschedule('reject')">退回申請</el-button>
                  </div>
                </div>
                <!-- 參觀開始後最常做的是標記到場：排在改期前面，兩顆都是實心按鈕。 -->
                <div v-if="visitStarted" class="detail__attendance" role="group" aria-labelledby="visit-attendance-title">
                  <p id="visit-attendance-title" class="detail__attendance-title">家長到了嗎？</p>
                  <el-button type="primary" :loading="pendingAction === 'complete'" :disabled="busy" @click="markCompleted">標記已到場</el-button>
                  <el-button :loading="pendingAction === 'no_show'" :disabled="busy" @click="markNoShow">標記未到場</el-button>
                </div>
                <div v-if="manualRescheduleShown" class="reschedule" role="group" aria-labelledby="visit-reschedule-title">
                  <p id="visit-reschedule-title" ref="rescheduleTitle" class="reschedule__title" tabindex="-1">改期（換場次）</p>
                  <el-select ref="rescheduleSelect" v-model="rescheduleSlotId" placeholder="選擇新的參觀場次" filterable :disabled="rescheduleSlots.length === 0" aria-label="改期的新場次" style="width: 100%">
                    <el-option-group v-for="group in groupSlotsByDay(rescheduleSlots)" :key="group.day" :label="group.label">
                      <el-option v-for="slot in group.slots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id">{{ slotChoiceTime(slot) }}</el-option>
                    </el-option-group>
                  </el-select>
                  <p v-if="chosenSlotText(rescheduleSlots, rescheduleSlotId)" class="hint slot-chosen">已選：{{ chosenSlotText(rescheduleSlots, rescheduleSlotId) }}</p>
                  <p v-if="rescheduleSlots.length === 0" class="hint">
                    <template v-if="canManage">未來 60 天沒有其他可用場次。先到 <router-link to="/visit-calendar">參觀場次</router-link> 新增。</template>
                    <template v-else>未來 60 天沒有其他可用場次，請校區管理者到「參觀場次」新增。</template>
                  </p>
                  <el-input v-model="rescheduleReason" maxlength="500" placeholder="改期原因（選填）" aria-label="改期原因" />
                  <el-button :loading="pendingAction === 'reschedule'" :disabled="!rescheduleSlotId || busy" style="width: 100%; margin-left: 0" @click="reschedule">改到這一場</el-button>
                  <p class="hint">改好後原場次的名額會空出來；新場次剛好額滿的話不會改。</p>
                </div>
                <div v-else class="reschedule reschedule--collapsed">
                  <el-button link type="primary" class="reschedule__toggle" aria-expanded="false" @click="openManualReschedule">{{ detail.pending_reschedule ? '不照申請，改到其他場次…' : '改到其他場次…' }}</el-button>
                </div>
                <p v-if="!visitStarted" class="hint">參觀場次開始後可以標記已到場或未到場；家長事先說不來，請用下方的「取消預約」。</p>
              </template>

              <template v-else>
                <p class="hint">這筆案件已結案。家長想再約，請另建新案，舊案會保留原紀錄。</p>
                <el-button :disabled="busy" style="width: 100%" @click="rebookOpen = true">重新預約（另建新案）</el-button>
              </template>
            </div>
            <div
              v-if="canReadAdmissions && !familyVisit && !familyPending && detail.status === 'completed' && (admissionsAvailable === 'yes' || lookupFailed)"
              class="detail__admissions"
            >
              <span class="detail__admissions-label">招生訪視</span>
              <template v-if="lookupFailed">
                <span class="hint">招生資料讀不到。</span>
                <el-button size="small" :disabled="busy" @click="family.lookup">重新載入</el-button>
              </template>
              <template v-else-if="canCreateAdmissions">
                <span class="hint">已到場，但還沒有招生訪視。</span>
                <el-button size="small" :loading="creatingAdmissions" :disabled="busy" @click="createAdmissionsVisit">建立招生訪視</el-button>
              </template>
              <span v-else class="hint">已到場，但還沒有招生訪視；請有招生權限的同事建立。</span>
            </div>
            <div
              v-if="canHandle && detail.status === 'confirmed'"
              class="detail__danger"
            >
              <span class="hint">{{ attendanceDue ? '家長沒來請用上方的標記未到場' : '家長不來了？' }}</span>
              <el-button text type="danger" :loading="pendingAction === 'cancel'" :disabled="busy" class="detail__cancel" @click="cancel">取消預約</el-button>
            </div>
          </div>
        </aside>
      </div>
      <ManualVisitDialog v-model="rebookOpen" :campus-keys="visibleCampusKeys" :related-from="detail" @created="onRebooked" />
      <!-- 一直掛著：RecordDialog 在打開的那一刻（open 變 true）才把 record 帶進表單。 -->
      <RecordDialog
        v-if="canCreateAdmissions"
        v-model="arrivalOpen"
        mode="edit"
        :campus-key="detail.campus_key"
        :record="admissionsVisit"
        :options="familyOptions"
        :lead="arrivalLead"
        :cancel-text="ARRIVAL_FORM_CANCEL_TEXT"
        @saved="family.replaceVisit"
        @stale="family.reload"
      />
    </template>
  </div>
</template>

<style scoped>
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
  font-size: var(--text-sm);
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

.detail__data .panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.notes__untracked {
  flex: 1 1 200px;
}

.notes__follow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.notes__hint {
  font-size: var(--text-xs);
}

.notes__past {
  margin: 0;
}

/* 報讀區沒有內容時不占位置：抵掉外層 flex 的間距（不能用 display: none，否則報讀軟體看不到它）。 */
.notes__status:empty {
  margin-top: -8px;
}

/* 招生訪視、取消與上方處理區塊用同一條左右內距，文字左緣才對齊。 */
.detail__admissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
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
  font-size: var(--text-3xl);
}

.detail__when {
  margin-top: 6px;
  font-size: var(--text-md);
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
  font-size: var(--text-xs);
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

/* 處理面板第一個區塊上面不畫分隔線，免得標題下先出現一條空線。 */
.detail__actions > .reschedule:first-child {
  padding-top: 0;
  border-top: 0;
}

.slot-chosen {
  margin: -4px 0 0;
}

.detail__attendance {
  display: grid;
  gap: 8px;
}

.detail__attendance .el-button {
  width: 100%;
  margin-left: 0;
}

.detail__attendance-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--ink);
}

.detail__status {
  display: grid;
  justify-items: end;
  gap: 4px;
  flex: none;
}

.detail__status-sub {
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.detail__status-sub[data-tone='warning'] {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
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
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink);
}

.reschedule-request__title .num {
  font-weight: 400;
  color: var(--ink-3);
}

.reschedule-request__slots {
  margin: 0;
  font-size: var(--text-sm);
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

  /* 手機上打完電話接著就是記一筆：撥號鈕、處理面板之後先放聯絡紀錄，
     家長資料表排在後面。改成 flex 直排，兄弟間距統一用 gap，不靠 .panel + .section 的外距。 */
  .detail__main {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .detail__main > * {
    margin-top: 0;
  }

  .detail__notes {
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
  .detail__admissions {
    padding: 12px 16px;
  }

  .detail__danger {
    padding: 10px 16px 6px;
  }
}
</style>

<style>
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
