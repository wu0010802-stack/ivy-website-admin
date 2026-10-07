<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, Filter, Plus, Search } from '@element-plus/icons-vue'
import { api, BASE_URL } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { VisitRequestDetailOut } from '../api/types'
import { campusLabel, VISIT_SOURCE_LABELS } from '../api/labels'
import { DEFAULT_TAB, LIST_TABS, LIST_TAB_LABELS, groupsByDay, listApiOrder, listApiParams, listStateQuery, parseListQuery, type ListOrder, type ListState, type ListTab } from '../api/visitListQuery'
import { useCampusScope } from '../composables/useCampusScope'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import { usePermissions } from '../composables/usePermissions'
import { useOpenRequestsStore } from '../stores/openRequests'
import { useAuthStore } from '../stores/auth'
import { notifyError, notifyWarning } from '../composables/notify'
import {
  attendanceChanged, attendanceDue, confirmAttendance, confirmBatchArrival, markArrivedInOrder, submitAttendance, type AttendanceKind, type BatchFailure,
} from '../composables/visitAttendance'
import { ARRIVAL_FORM_CANCEL_TEXT, useArrivalAdmissionsForm } from '../composables/useArrivalAdmissionsForm'
import { groupVisitsByDay, nextInList, taipeiDay, type DayBucket, type DayGroup } from '../utils/visitSchedule'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import VisitListRow from '../components/visit/VisitListRow.vue'
import VisitPreviewPanel from '../components/visit/VisitPreviewPanel.vue'

const router = useRouter()
const route = useRoute()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const { can } = usePermissions()
// 補登要能處理案件（booking.handle，含櫃台）；匯出個資要總管理者另外授權。
const canHandle = computed(() => can('booking.handle'))
const canExport = computed(() => can('booking.export'))
const manualOpen = ref(false)
const openRequests = useOpenRequestsStore()

// 只負責一校的帳號（櫃台、單校管理者）：校區欄每列都一樣、校區下拉只有一個
// 選項，表格拿掉校區欄，篩選改成唯讀標籤，把寬度留給家長與送出時間。
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)

const campusFilter = ref('')
// 接待頁籤（網址的 group）：是導覽，不算篩選；沒寫就是「接下來」（api/visitListQuery.ts）。
const activeTab = ref<ListTab>(DEFAULT_TAB)
// 總覽「到期待追蹤」點進來帶 ?due=1，只列已到預定聯絡時間的案件。
const dueOnly = ref(false)
// 只看還沒結案的（預約正常，含時間已過還沒標記到場）。原本是總覽「我承辦的案件」帶
// ?open=1 進來；2026-10-06 拿掉承辦人後只剩舊連結會帶。
const openOnly = ref(false)
const sourceFilter = ref('')
// 送出日期區間（台灣日期，含頭尾）。櫃台會在手機上篩：窄螢幕的日期面板只顯示
// 一個月，雙月面板約 646px 會超出 390px 螢幕。
const createdRange = ref<[string, string] | null>(null)
const narrow = useNarrowScreen()
// 待人工處理：場次已關閉（含休假日）但家長仍要來，或分校已停用但尚未結案。
const attentionOnly = ref(false)
// 「時間已過」裡還沒標記到場的（status=confirmed）。後端 status 與 view 可以疊加，
// 網址寫成 ?group=past&status=confirmed；切到其他頁籤就自動取消。
const attendanceOnly = ref(false)
// 預設依參觀時間（行程清單）；選了送出時間才寫進網址（舊連結的 ?order=oldest 仍有效）。
const order = ref<ListOrder>('visit')
const page = ref(1)
const pageSize = 20
const requests = ref<VisitRequestDetailOut[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadVersion = 0
const search = ref('')

// 目前畫面上的條件，網址、清單、匯出、件數都從這一份算（api/visitListQuery.ts）。
const listState = computed<ListState>(() => ({
  tab: activeTab.value, attendanceOnly: attendanceOnly.value, q: search.value, campus: campusFilter.value,
  open: openOnly.value, source: sourceFilter.value, created: createdRange.value, due: dueOnly.value,
  attention: attentionOnly.value, order: order.value, page: page.value,
}))

// 時鐘每 30 秒更新：列上的接待狀態（進行中、還沒標記）、「到了／沒來」按鈕與日期分組都跟著它走。
const clockNow = ref(Date.now())
const clock = window.setInterval(() => { clockNow.value = Date.now() }, 30_000)

// 依參觀時間排序時，這一頁照台北日期切成今天、明天、本週、之後（時間已過等頁籤往回：今天、昨天、本週稍早、更早）；
// 照送出時間排就是一條不分組的清單。
const grouped = computed(() => groupsByDay(listState.value))
const today = computed(() => taipeiDay(clockNow.value))
const DAY_ONLY: ReadonlySet<DayBucket> = new Set(['today', 'tomorrow', 'yesterday'])
const dayGroups = computed<DayGroup<VisitRequestDetailOut>[]>(() =>
  grouped.value ? groupVisitsByDay(requests.value, today.value) : [{ key: 'flat', bucket: 'none', label: '', rows: requests.value }],
)

// ── 篩選與網址雙向同步 ──
// 所有條件與頁數都寫進網址（router.replace，不堆歷史）：點進案件再返回、重新整理，
// 列表維持原來的頁籤、搜尋與頁數；側欄、總覽與各種提示（?attention=1&campus=…、
// ?due=1、?status=…&order=oldest）改網址時再讀回來。兩邊都先比對，一樣就不動。
const LIST_PATH = route.path

function applyQuery(query: LocationQuery) {
  const next = parseListQuery(query, { campusKeys: visibleCampusKeys.value, multiCampus: multiCampus.value })
  activeTab.value = next.tab
  attendanceOnly.value = next.attendanceOnly
  search.value = next.q
  campusFilter.value = next.campus
  dueOnly.value = next.due
  openOnly.value = next.open
  sourceFilter.value = next.source
  if (next.created?.join() !== createdRange.value?.join()) createdRange.value = next.created
  attentionOnly.value = next.attention
  order.value = next.order
  page.value = next.page
}

// 目前的條件 → 網址。預設值不寫，網址保持乾淨；搜尋照使用者打的字寫。
const stateQuery = (): Record<string, string> => listStateQuery(listState.value)

function queryKey(query: LocationQuery | Record<string, string>): string {
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') entries.push([key, item])
  }
  return new URLSearchParams(entries.sort(([a], [b]) => a.localeCompare(b))).toString()
}

const matchesRoute = () => queryKey(route.query) === queryKey(stateQuery())
// 自己寫出去、還在路上的網址；回來時不必再讀回畫面（否則慢一步的舊網址會蓋掉剛改的條件）。
const writingQueries = new Set<string>()
function syncUrl() {
  if (route.path !== LIST_PATH || matchesRoute()) return
  const query = stateQuery()
  const key = queryKey(query)
  writingQueries.add(key)
  void router.replace({ query }).catch(() => {}).finally(() => writingQueries.delete(key))
}

applyQuery(route.query)

// 頁籤是導覽、不算篩選；「只看尚未確認到場」會多送 status=confirmed，算篩選。
const hasFilters = computed(() => Boolean(campusFilter.value || search.value.trim() || dueOnly.value || sourceFilter.value || createdRange.value || attentionOnly.value || openOnly.value || attendanceOnly.value))
function clearFilters() {
  campusFilter.value = ''
  attendanceOnly.value = false
  search.value = ''
  dueOnly.value = false
  openOnly.value = false
  sourceFilter.value = ''
  createdRange.value = null
  attentionOnly.value = false
}

// 頁籤上的數字（GET view-counts，套用頁籤以外的條件）：接下來寫全部件數；時間已過只寫還沒標記到場的，
// 和總覽同一個數字；已到場、已取消、全部不寫（只會一直變大）。
const viewCounts = ref<{ upcoming?: number; past_unmarked?: number }>({})
const statusTabs = computed(() => LIST_TABS.map(value => ({
  value,
  label: LIST_TAB_LABELS[value],
  count: value === 'upcoming' ? (viewCounts.value.upcoming ?? 0) : value === 'past' ? (viewCounts.value.past_unmarked ?? 0) : 0,
  countLabel: value === 'past' ? ' 件還沒標記到場' : ' 件',
})))
// 篩選欄位攤開有十幾個控制項，把案件清單推到很下面（2026-10-05 第九輪起桌機也收）：
// 搜尋、狀態頁籤常駐，多校帳號的校區在桌機也常駐；其餘收進「更多篩選」，有套用時
// 按鈕上顯示件數，收起時另列成可以逐一拿掉的條件，從總覽點進來也看得到套了什麼。
const moreFiltersOpen = ref(false)
// 手機版的校區也收進更多篩選（寬度只夠搜尋＋按鈕）。
const campusInMore = computed(() => narrow.value || !multiCampus.value)
interface ActiveFilter { key: string; label: string; clear: () => void }
const hiddenFilters = computed<ActiveFilter[]>(() => {
  const list: ActiveFilter[] = []
  if (campusInMore.value && campusFilter.value) list.push({ key: 'campus', label: `${campusLabel(campusFilter.value)}校`, clear: () => { campusFilter.value = '' } })
  if (attendanceOnly.value) list.push({ key: 'attendance', label: '尚未確認到場', clear: () => { attendanceOnly.value = false } })
  if (dueOnly.value) list.push({ key: 'due', label: '到期待追蹤', clear: () => { dueOnly.value = false } })
  if (attentionOnly.value) list.push({ key: 'attention', label: '待人工處理', clear: () => { attentionOnly.value = false } })
  if (openOnly.value) list.push({ key: 'open', label: '未結案', clear: () => { openOnly.value = false } })
  if (sourceFilter.value) list.push({ key: 'source', label: `來源：${VISIT_SOURCE_LABELS[sourceFilter.value] ?? sourceFilter.value}`, clear: () => { sourceFilter.value = '' } })
  if (createdRange.value) list.push({ key: 'created', label: `送出 ${createdRange.value[0].slice(5).replace('-', '/')}–${createdRange.value[1].slice(5).replace('-', '/')}`, clear: () => { createdRange.value = null } })
  if (order.value !== 'visit') list.push({ key: 'order', label: order.value === 'oldest' ? '最早送出在前' : '最新送出在前', clear: () => { order.value = 'visit' } })
  return list
})
const moreFilterCount = computed(() => hiddenFilters.value.length)

const hasNext = computed(() => requests.value.length === pageSize)

// 清單、匯出與件數送同一組篩選（api/visitListQuery.ts）：畫面上篩好什麼，匯出的就是那一批。
const filterParams = (options: { counts?: boolean } = {}) => listApiParams(listState.value, options)

async function loadCounts(version: number) {
  try {
    const counts = await api.get<{ upcoming: number; past_unmarked: number }>(`/admin/visit-requests/view-counts?${filterParams({ counts: true })}`)
    if (version === loadVersion) viewCounts.value = counts
  } catch {
    if (version === loadVersion) viewCounts.value = {}
  }
}

// 上一次讀清單的時間：切回分頁時據此判斷要不要重抓。
let loadedAt = 0

// 按「下一頁」翻到的空頁是真的到底了（上一頁剛好 20 件）：講明沒有更多，不跳回第一頁，
// 否則「下一頁」又能按，會在兩頁之間來回。
let pagedForward = false
function nextPage() {
  pagedForward = true
  page.value += 1
}

// quiet：切回分頁時的背景重抓，保留目前的清單、不閃載入狀態；失敗就維持原樣。
async function load(options: { quiet?: boolean } = {}) {
  const version = ++loadVersion
  loadedAt = Date.now()
  const byNextButton = pagedForward
  pagedForward = false
  syncUrl()
  void loadCounts(version)
  if (!options.quiet) {
    loading.value = true
    error.value = null
  }
  // 這一頁已經空了、改查第一頁：載入狀態留給接手的那次查詢收尾，中間不閃「沒有案件」。
  let fallingBack = false
  try {
    const params = filterParams()
    params.set('page', String(page.value))
    params.set('page_size', String(pageSize))
    params.set('order', listApiOrder(listState.value))
    const result = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`)
    if (version !== loadVersion) return
    // 網址記著頁數：處理完第 2 頁最後一件再返回、或切回分頁時案件已移走，那一頁會是空的，
    // 但前面幾頁還有案件。不能說「沒有待處理的案件」，回第一頁重查（頁數監聽會重抓並改網址）。
    if (!result.length && page.value > 1 && !byNextButton) {
      fallingBack = true
      page.value = 1
      return
    }
    requests.value = result
    error.value = null
  } catch {
    if (version === loadVersion && !options.quiet) {
      error.value = '無法讀取案件列表，請重新載入。'
      requests.value = []
    }
  } finally {
    if (version === loadVersion && !fallingBack) loading.value = false
  }
}

// 同一輪裡條件和頁數一起變（改條件會回第一頁）時只送一次查詢。
let loadQueued = false
let unmounted = false
function queueLoad() {
  if (loadQueued) return
  loadQueued = true
  void nextTick(() => {
    loadQueued = false
    if (!unmounted) void load()
  })
}

watch(activeTab, (tab) => { if (tab !== 'past') attendanceOnly.value = false })
function toggleAttendance(on: boolean) {
  attendanceOnly.value = on
  if (on) activeTab.value = 'past'
}

watch([campusFilter, activeTab, dueOnly, order, sourceFilter, createdRange, attentionOnly, attendanceOnly, openOnly], () => {
  // 畫面上改條件回第一頁；網址帶來的條件（連結、返回列表）連頁數原樣套用。
  if (!matchesRoute()) page.value = 1
  queueLoad()
})
// 邊打字邊查會連發請求，停下來再送；過時的回應由 loadVersion 擋掉。
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  if (matchesRoute()) {
    queueLoad()
    return
  }
  searchTimer = setTimeout(() => {
    page.value = 1
    queueLoad()
  }, 300)
})
watch(page, queueLoad)
// 開著過台北午夜：今天／明天換了，「接下來」的內容也換了，重讀一次（同總覽的換日重讀）。
watch(today, () => { void load({ quiet: true }) })
watch(() => route.query, query => {
  // 點進案件時網址先換成明細頁，這裡不跟著清掉條件。
  if (route.path !== LIST_PATH) return
  const key = queryKey(query)
  if (writingQueries.has(key) || key === queryKey(stateQuery())) return
  applyQuery(query)
})

// 櫃台常整個早上開著列表：切回這個分頁或視窗時，距上次讀取超過 60 秒就靜靜重抓
// 一次，頁首的通知數字一起更新。不做定時輪詢。
const STALE_MS = 60_000
function refreshIfStale() {
  if (document.visibilityState === 'hidden' || loading.value || Date.now() - loadedAt < STALE_MS) return
  void load({ quiet: true })
  void openRequests.refresh(true)
}
onBeforeUnmount(() => {
  unmounted = true
  window.clearInterval(clock)
  clearTimeout(searchTimer)
  loadVersion++
  document.removeEventListener('visibilitychange', refreshIfStale)
  window.removeEventListener('focus', refreshIfStale)
})

// ── 列表上直接標記到場（2026-10-05 第九輪）──
// 參觀當天幾組家長陸續到，不必一筆筆點進明細。時鐘每 30 秒更新，場次一開始按鈕就出現（同明細）。
const authStore = useAuthStore()
const attendanceBusy = ref<string | null>(null)
const showAttendance = (row: VisitRequestDetailOut) => canHandle.value && attendanceDue(row, clockNow.value)
// 標記已到場後接著打開招生資料表單（2026-10-06）：表單上方寫出已到場，所以不另跳成功訊息。
const arrival = useArrivalAdmissionsForm()
const { open: arrivalOpen, record: arrivalRecord, options: arrivalOptions, lead: arrivalLead } = arrival
// 已到場的列「填招生資料」（2026-10-06 R18）：同一份表單，不是剛標記到場，所以不寫「已標記…已到場」、取消鈕維持「取消」。
const canFillAdmissions = computed(() => arrival.opensForm.value)
// 剛標記到場才有說明，取消鈕寫「之後再填」；從「填招生資料」打開的維持「取消」（同明細的 VisitCaseDialogs）。
const arrivalCancelText = computed(() => (arrivalLead.value ? ARRIVAL_FORM_CANCEL_TEXT : undefined))

async function markAttendance(row: VisitRequestDetailOut, kind: AttendanceKind) {
  // 招生入學開著時，標記已到場會同時建立招生訪視（後端看部署開關，不看個人權限）。
  const withAdmissions = kind === 'complete' && Boolean(authStore.features.admissions)
  const opensForm = withAdmissions && arrival.opensForm.value
  if (attendanceLocked.value || !(await confirmAttendance(kind, row, withAdmissions, opensForm))) return
  attendanceBusy.value = row.id
  try {
    await submitAttendance(row.id, kind)
    if (opensForm) void arrival.openFor(row)
    else ElMessage.success(kind === 'no_show' ? `已標記 ${row.parent_name} 未到場` : `已標記 ${row.parent_name} 已到場${withAdmissions ? '，招生訪視已建立' : ''}`)
  } catch (err) {
    // 同事剛處理過同一筆（兩人都開著列表）：後端拒絕轉換，重讀後列表就是現在的狀態。
    notifyError(attendanceChanged(err) ? `${row.parent_name} 這筆剛被其他人處理過，列表已更新` : apiErrorMessage(err, '操作失敗'))
  } finally {
    attendanceBusy.value = null
    void openRequests.refresh(true)
    await load({ quiet: true })
  }
}

// ── 批次標記已到場（2026-10-05 從招生入學「官網預約」分頁搬來）──
// 只在「只看尚未確認到場」時出現勾選欄：一天的場次結束後，把來了的家長一次勾起來。
// 只勾這一頁；依序呼叫 /complete，失敗的逐筆列在清單上方，清單重讀。
const batchMode = computed(() => canHandle.value && attendanceOnly.value)
const selected = ref<VisitRequestDetailOut[]>([])
const batch = ref<{ done: number; total: number } | null>(null)
const batchFailures = ref<BatchFailure[]>([])
const attendanceLocked = computed(() => Boolean(attendanceBusy.value) || batch.value !== null)
const canSelect = (row: VisitRequestDetailOut) => !attendanceLocked.value && showAttendance(row)
const isSelected = (row: VisitRequestDetailOut) => selected.value.some(item => item.id === row.id)
const selectableRows = computed(() => requests.value.filter(canSelect))
const allSelected = computed(() => selectableRows.value.length > 0 && selectableRows.value.every(isSelected))
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value)
function selectAll(on: boolean) {
  selected.value = on ? [...selectableRows.value] : []
}
function toggleSelected(row: VisitRequestDetailOut, on: boolean) {
  selected.value = on ? [...selected.value, row] : selected.value.filter(item => item.id !== row.id)
}
watch(requests, () => { selected.value = [] })
watch(attendanceOnly, () => { batchFailures.value = [] })

async function markSelectedArrived() {
  const rows = [...selected.value]
  const withAdmissions = Boolean(authStore.features.admissions)
  if (!rows.length || attendanceLocked.value || !(await confirmBatchArrival(rows.length, withAdmissions))) return
  batchFailures.value = []
  batch.value = { done: 0, total: rows.length }
  const { succeeded, failures } = await markArrivedInOrder(rows, (done) => { batch.value = { done, total: rows.length } })
  batch.value = null
  batchFailures.value = failures
  if (succeeded) ElMessage.success(`已標記 ${succeeded} 位已到場${withAdmissions ? '，招生訪視已建立' : ''}`)
  if (failures.length) notifyWarning(`有 ${failures.length} 筆沒有標記成功，原因列在清單上方`)
  void openRequests.refresh(true)
  await load({ quiet: true })
}

// 匯出不分頁：符合目前篩選的全部案件。按鈕旁講清楚範圍，避免以為只匯出這一頁，
// 或沒注意到沒篩選時會匯出可見校區的全部案件。頁籤不算篩選、但匯出會送 view=，所以範圍要把頁籤寫進去
// （「全部」頁籤不送 view，仍是可見校區的全部案件）。
const exportScope = computed(() => {
  const tab = activeTab.value === 'all' ? '' : `「${LIST_TAB_LABELS[activeTab.value]}」`
  if (hasFilters.value) return `匯出範圍：${tab ? `${tab}頁籤、` : ''}目前篩選的全部結果（不只本頁）`
  return tab ? `匯出範圍：${tab}的全部結果` : '匯出範圍：可見校區的全部案件'
})
function exportCsv() {
  window.open(`${BASE_URL}/admin/visit-requests/export?${filterParams()}`, '_blank')
}

// 點進案件時把目前的條件與排序帶過去，案件頁的「下一筆」才會照這份清單往下。只有「全部」而且沒有
// 到期、待人工處理時不帶（那份清單夾著已結案的案件，「下一筆」改用固定的處理優先序）。
function detailTo(id: string) {
  const state = listState.value
  if (state.tab === 'all' && !state.due && !state.attention) return `/visit-requests/${id}`
  const params = filterParams()
  params.set('order', listApiOrder(state))
  // 第 2 頁以後要連每頁筆數一起帶，案件頁才會查到同一段列表（案件頁預設一次抓 50 筆）。
  if (page.value > 1) {
    params.set('page', String(page.value))
    params.set('page_size', String(pageSize))
  }
  return { path: `/visit-requests/${id}`, query: { list: params.toString() } }
}

// 1280 以上：點一列在右側預覽（2026-10-06 方向 B），⌘／Ctrl／中鍵照常開新分頁（VisitListRow）；較窄時點列照舊進明細。
// 一開始不自動選第一筆（換頁籤不必多打 API）；選取不寫進網址，返回列表時回到沒選的狀態。
const wide = useNarrowScreen('(min-width: 1280px)')
const selectedId = ref<string | null>(null)
// 選中的那筆在這一頁的位置：它離開清單（剛取消、標未到場）後，「下一筆」由接手這個位置的那筆遞補。
let selectedIndex = 0
const preview = ref<InstanceType<typeof VisitPreviewPanel> | null>(null)
const rowIds = computed(() => requests.value.map(row => row.id))
const nextId = computed(() => nextInList(rowIds.value, selectedId.value, selectedIndex))

// 預覽裡有打了一半的聯絡紀錄就先問；選「留在這頁」回 false，不換。
async function select(id: string): Promise<boolean> {
  if (id === selectedId.value) return true
  if (preview.value && !(await preview.value.confirmLeave())) return false
  selectedId.value = id
  selectedIndex = Math.max(0, rowIds.value.indexOf(id))
  return true
}

async function selectNext() {
  if (nextId.value) await select(nextId.value)
}

// 點列選取後，焦點移進預覽（鍵盤按 Enter 開的，才知道內容出現在哪裡）；「下一筆」留在按鈕上，不搶焦點。
async function openPreview(id: string) {
  if (!(await select(id))) return
  await nextTick()
  preview.value?.focus()
}

// 清單重讀後，選中的那筆還在就記下它的新位置；不在了就留著原位置讓「下一筆」遞補。
watch(requests, () => {
  const index = selectedId.value ? rowIds.value.indexOf(selectedId.value) : -1
  if (index >= 0) selectedIndex = index
})

// 預覽裡標了到場、改期、取消或記了一筆：清單與頁首的改期申請數一起更新。
function onPreviewChanged() {
  void load({ quiet: true })
  void openRequests.refresh(true)
}

function openDetail(row: VisitRequestDetailOut) {
  if (wide.value) void openPreview(row.id)
  else void router.push(detailTo(row.id))
}

function onManualCreated(created: VisitRequestDetailOut) {
  router.push(`/visit-requests/${created.id}`)
}

const listTitle = computed(() => {
  if (attendanceOnly.value) return '尚未確認到場'
  if (dueOnly.value) return '到期待追蹤'
  if (attentionOnly.value) return '待人工處理'
  return activeTab.value === 'all' ? '全部案件' : LIST_TAB_LABELS[activeTab.value]
})

const emptyText = computed(() => {
  if (page.value > 1) return '後面沒有更多案件了'
  if (search.value.trim()) return `找不到符合「${search.value.trim()}」的案件`
  if (attentionOnly.value) return '沒有待人工處理的案件'
  if (attendanceOnly.value) return '沒有尚未確認到場的案件'
  if (dueOnly.value) return '沒有到期待追蹤的案件'
  if (activeTab.value === 'upcoming') return '接下來沒有參觀'
  if (activeTab.value !== 'all') return `沒有「${LIST_TAB_LABELS[activeTab.value]}」的案件`
  return '還沒有任何參觀案件'
})

// 空狀態的第二行。「清除篩選」只清條件、不換頁籤，所以說清楚清完看到的是哪個範圍；
// 只是這個頁籤沒有案件（沒有任何條件）時，不能說「家長送出需求後會顯示在這裡」。
const clearScope = computed(() => (activeTab.value === 'all' ? '全部案件' : `「${LIST_TAB_LABELS[activeTab.value]}」的全部案件`))
function emptyHint(fallback: string): string {
  if (page.value > 1) return '前面的頁數還有案件。'
  if (hasFilters.value) return `試試其他條件，或清除篩選查看${clearScope.value}。`
  return activeTab.value === 'all' ? fallback : '可以切換上方的頁籤，查看其他案件。'
}

onMounted(() => {
  load()
  document.addEventListener('visibilitychange', refreshIfStale)
  window.addEventListener('focus', refreshIfStale)
})
</script>

<template>
  <div class="page">
    <PageHeader lead="每一筆參觀預約；需要時改場次、標記到場或取消。" more="家長在官網選好場次送出，就是預約成功，不用再確認。電話、LINE 或現場約的，用「補登案件」記下來。">
      <template #actions>
        <el-button v-if="canHandle" type="primary" :icon="Plus" @click="manualOpen = true">補登案件</el-button>
        <el-button v-if="canExport" :icon="Download" aria-describedby="export-scope" @click="exportCsv">匯出 CSV</el-button>
        <span v-if="canExport" id="export-scope" class="export-scope hint">{{ exportScope }}</span>
      </template>
    </PageHeader>

    <div class="status-tabs" role="group" aria-label="案件狀態">
      <button v-for="item in statusTabs" :key="item.value" type="button" class="status-tab" :class="{ 'is-active': activeTab === item.value }" :data-group="item.value"
        :aria-pressed="activeTab === item.value" @click="activeTab = item.value">
        {{ item.label }}<span v-if="item.count" class="status-tab__count num">{{ item.count }}<span class="visually-hidden">{{ item.countLabel }}</span></span>
      </button>
    </div>

    <div class="toolbar requests-filters" :class="{ 'is-open': moreFiltersOpen }">
      <div class="filter-field filter-field--search"><span>搜尋</span>
      <el-input v-model="search" placeholder="姓名、電話或 Email" clearable :prefix-icon="Search" aria-label="搜尋家長／孩子姓名、電話或 Email" />
      </div>
      <!-- 多校帳號在桌機常駐校區；手機與單校帳號收進更多篩選（單校時 CampusSelect 自己帶「校區」字樣）。 -->
      <div v-if="multiCampus" class="filter-field filter-field--campus"><span>校區</span>
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" />
      </div>
      <button type="button" class="more-filters" :aria-expanded="moreFiltersOpen" aria-controls="requests-more-filters" @click="moreFiltersOpen = !moreFiltersOpen">
        <el-icon aria-hidden="true"><Filter /></el-icon>更多篩選<span v-if="moreFilterCount" class="filter-count num">{{ moreFilterCount }}</span>
      </button>
      <el-button v-if="hasFilters" text class="clear-filters" @click="clearFilters">清除篩選</el-button>
      <div id="requests-more-filters" class="requests-filters__more">
        <div v-if="!multiCampus" class="filter-field">
        <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" />
        </div>
        <div class="filter-field"><span>排序</span>
        <el-select v-model="order" aria-label="排序" class="order-select">
          <el-option label="參觀時間" value="visit" />
          <el-option label="最新送出在前" value="newest" />
          <el-option label="最早送出在前" value="oldest" />
        </el-select>
        </div>
        <div class="filter-field"><span>來源</span>
        <el-select v-model="sourceFilter" aria-label="來源" placeholder="全部來源" clearable class="order-select">
          <el-option v-for="(label, key) in VISIT_SOURCE_LABELS" :key="key" :label="label" :value="key" />
        </el-select>
        </div>
        <div class="filter-field created-range"><span>送出日期</span>
        <el-date-picker v-model="createdRange" type="daterange" value-format="YYYY-MM-DD" format="YYYY/MM/DD" unlink-panels :single-panel="narrow"
          start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="送出日期區間" />
        </div>
        <el-checkbox :model-value="attendanceOnly" class="filter-due" @update:model-value="(on: string | number | boolean) => toggleAttendance(Boolean(on))">只看尚未確認到場</el-checkbox>
        <el-checkbox v-model="dueOnly" class="filter-due">只看到期待追蹤</el-checkbox>
        <el-checkbox v-model="attentionOnly" class="filter-due">只看待人工處理</el-checkbox>
        <el-checkbox v-model="openOnly" class="filter-due">只看未結案</el-checkbox>
      </div>
    </div>
    <ul v-if="!moreFiltersOpen && hiddenFilters.length" class="filter-chips" aria-label="已套用的篩選">
      <li v-for="chip in hiddenFilters" :key="chip.key">
        <button type="button" class="filter-chip" @click="chip.clear()">{{ chip.label }}<span aria-hidden="true" class="filter-chip__x">×</span><span class="visually-hidden">，拿掉這個條件</span></button>
      </li>
      <!-- 手機的清除篩選放在這一列：放在搜尋那一列會把搜尋框擠到只剩幾個字。 -->
      <li class="filter-chips__clear"><el-button text @click="clearFilters">清除篩選</el-button></li>
    </ul>

    <el-alert v-if="attentionOnly" class="attention-note" type="warning" :closable="false" show-icon title="待人工處理的案件">
      <p>排入的場次已關閉（含休假日）但家長還要來，或分校已停用、案件還沒結案。請聯絡家長改期到其他場次，或取消預約；處理完就會從這裡消失。那一場其實照常接待的話，到參觀場次頁恢復開放，並把名額調成已占用的組數（不再收新預約）。</p>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>

    <div class="visit-split" :class="{ 'has-preview': wide && !error }">
      <div v-if="!error" class="visit-list" :aria-busy="loading">
        <!-- 頁首已經是「參觀案件」，這裡寫目前看的是哪個頁籤或子篩選，不重複頁名。 -->
        <div class="visit-list__head"><h2>{{ listTitle }}</h2><span class="hint">{{ loading ? '載入中…' : `本頁 ${requests.length} 件` }}</span></div>
        <div v-if="batchMode && requests.length" class="requests-batch">
          <el-checkbox :model-value="allSelected" :indeterminate="someSelected" :disabled="attendanceLocked || !selectableRows.length" @update:model-value="(on: string | number | boolean) => selectAll(Boolean(on))">全選這一頁</el-checkbox>
          <el-button type="primary" plain :disabled="!selected.length || attendanceLocked" :loading="batch !== null" class="requests-batch__button" @click="markSelectedArrived">
            {{ batch ? `標記中 ${batch.done}／${batch.total}` : selected.length ? `${selected.length} 位標記已到場` : '勾選後一次標記已到場' }}
          </el-button>
          <span class="hint">一天的場次結束後，可以把來了的家長一次勾起來標記。</span>
        </div>
        <el-alert
          v-if="batchFailures.length"
          type="warning"
          show-icon
          :title="`有 ${batchFailures.length} 筆沒有標記成功`"
          class="requests-batch__failures"
          @close="batchFailures = []"
        >
          <ul class="requests-batch__failure-list">
            <li v-for="item in batchFailures" :key="item.id">{{ item.name }}：{{ item.reason }}</li>
          </ul>
        </el-alert>
        <el-skeleton v-if="loading" animated :rows="4" class="visit-list__skeleton" />
        <template v-else-if="requests.length">
          <section v-for="group in dayGroups" :key="group.key" class="visit-day" :class="{ 'visit-day--today': group.bucket === 'today' }">
            <h3 v-if="group.label" class="visit-day__title">{{ group.label }}<span class="visit-day__count">{{ group.rows.length }} 組</span></h3>
            <ul class="visit-rows">
              <VisitListRow
                v-for="row in group.rows"
                :key="row.id"
                :row="row"
                :now="clockNow"
                :to="detailTo(row.id)"
                :day-only="DAY_ONLY.has(group.bucket)"
                :show-created="!grouped"
                :multi-campus="multiCampus"
                :selected="row.id === selectedId"
                :previewable="wide"
                :can-handle="canHandle"
                :can-fill-admissions="canFillAdmissions"
                :batch="batchMode"
                :checked="isSelected(row)"
                :busy="attendanceBusy === row.id"
                :locked="attendanceLocked"
                @activate="openDetail(row)"
                @attendance="(kind: AttendanceKind) => markAttendance(row, kind)"
                @fill="arrival.openFor(row, { justArrived: false })"
                @toggle="(on: boolean) => toggleSelected(row, on)"
              />
            </ul>
          </section>
        </template>
        <!-- 翻到最後一頁之後（page > 1）是到底了，不是篩不到：引導回上一頁，不叫人清除篩選。 -->
        <div v-else class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ emptyHint('家長送出需求後會顯示在這裡，可查看聯絡資訊並安排參觀。') }}</p><el-button v-if="page > 1" @click="page -= 1">回上一頁</el-button><el-button v-else-if="hasFilters" @click="clearFilters">清除篩選</el-button></div>

        <div class="pager" v-if="page > 1 || hasNext">
          <el-button size="small" :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
          <span class="hint">第 {{ page }} 頁</span>
          <el-button size="small" :disabled="!hasNext || loading" @click="nextPage">下一頁</el-button>
        </div>
      </div>
      <template v-if="wide && !error">
        <VisitPreviewPanel
          v-if="selectedId"
          ref="preview"
          :id="selectedId"
          :full-to="detailTo(selectedId)"
          :has-next="Boolean(nextId)"
          @next="selectNext"
          @changed="onPreviewChanged"
        />
        <aside v-else class="visit-preview-empty panel" aria-label="案件預覽">
          <p class="hint">點一筆就會在這裡看到重點、聯絡紀錄與處理按鈕。</p>
        </aside>
      </template>
    </div>

    <ManualVisitDialog
      v-if="canHandle"
      v-model="manualOpen"
      :campus-keys="visibleCampusKeys"
      :default-campus="campusFilter"
      @created="onManualCreated"
    />
    <!-- 一直掛著：RecordDialog 在打開的那一刻（open 變 true）才把 record 帶進表單。 -->
    <RecordDialog
      v-if="canFillAdmissions"
      v-model="arrivalOpen"
      mode="edit"
      :campus-key="arrivalRecord?.campus_key ?? ''"
      :record="arrivalRecord"
      :options="arrivalOptions"
      :lead="arrivalLead"
      :cancel-text="arrivalCancelText"
    />
  </div>
</template>

<style scoped>
.toolbar { align-items: flex-end; }
/* 狀態頁籤的基本樣式在 style.css（站內通知共用）。分頁數字只是件數，一律中性灰，選中時照共用樣式。 */
.status-tab.is-active .status-tab__count { background: var(--surface); color: var(--admin-accent-hover); }
.requests-filters__more { display: none; flex-basis: 100%; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding-top: 4px; }
.requests-filters.is-open .requests-filters__more { display: flex; }
.more-filters { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--ink-2); font: inherit; font-size: var(--text-base); cursor: pointer; }
.more-filters:hover { border-color: var(--el-color-primary-light-5); color: var(--ink); }
.requests-filters.is-open .more-filters { border-color: var(--el-color-primary); color: var(--admin-accent-strong); }
.filter-count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); font-size: var(--text-xs); font-weight: 600; line-height: 20px; text-align: center; }
/* 和輸入框底線對齊：篩選欄位上方有標籤，置中會比輸入框高半格。 */
.clear-filters { align-self: flex-end; height: var(--control-h); }
.filter-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 16px; padding: 0; list-style: none; }
.filter-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px 0 12px; border: 1px solid var(--el-color-primary-light-7); border-radius: 999px; background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); font: inherit; font-size: var(--text-sm); cursor: pointer; }
.filter-chip:hover { border-color: var(--el-color-primary); }
.filter-chip__x { font-size: var(--text-lg); line-height: 1; }
.filter-chips__clear { display: none; }
.requests-batch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.requests-batch__failures { margin: 12px 0 0; width: auto; }
.requests-batch__failure-list { margin: 4px 0 0; padding-left: 18px; }
.order-select { width: 150px; }
.created-range :deep(.el-date-editor) { width: 260px; }
/* 寬度跟著按鈕列走，不把整個動作區撐寬去擠左邊的說明文字。 */
.export-scope { flex-basis: 100%; width: 0; min-width: 100%; font-size: var(--text-xs); text-align: right; }
.attention-note { margin-bottom: 16px; }
.attention-note p { margin: 0; }
.filter-field { display: grid; gap: 6px; font-size: var(--text-sm); color: var(--ink-2); }
.filter-due { align-self: center; padding-bottom: 6px; }
/* 單校的唯讀校區標籤跟旁邊的下拉一樣高，底線對齊。 */
.requests-filters :deep(.campus-single) { min-height: var(--control-h); }
.requests-empty { text-align: center; color: var(--ink-2); }
.requests-empty strong { font-size: var(--text-lg); color: var(--ink); }
.requests-empty p { margin: 8px auto 16px; max-width: 50ch; }
.filter-field--search { flex: 1 1 240px; max-width: 320px; }
/* 行程清單（2026-10-06 方向 B）：依參觀日分組，每組一張白底圓角卡，列在 components/visit/VisitListRow.vue。 */
.visit-list { container: visit-list / inline-size; }
/* 1280 以上右側預覽（2026-10-06 方向 B）：清單一欄、預覽 400px 黏在視窗右側。 */
.visit-split.has-preview { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 20px; align-items: start; }
.visit-preview-empty { position: sticky; top: calc(var(--top-h) + 16px); margin-top: 32px; padding: 24px 20px; }
.visit-list__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.visit-list__head h2 { font-size: var(--text-lg); }
.visit-day { margin-top: 16px; }
.visit-day__title { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; font-size: var(--text-lg); font-weight: 700; }
.visit-day--today .visit-day__title { color: var(--admin-accent-hover); }
.visit-day__count { font-size: var(--text-sm); font-weight: 400; color: var(--ink-3); }
.visit-rows { list-style: none; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.visit-list__skeleton, .requests-empty { margin-top: 12px; padding: 24px 16px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; }
@media (max-width: 720px) {
  .filter-field { flex: 1 1 130px; min-width: 0; font-size: var(--text-base); }
  /* 搜尋是手機上最常用的入口，給整行才放得下提示文字 */
  .filter-field--search { flex: 1 1 0; max-width: none; }
  /* 八個頁籤在 360–390px 排成兩列、各列撐滿，全部一眼看得到。 */
  .status-tab { flex: 1 1 auto; justify-content: center; min-height: 44px; padding: 0 8px; }
  .filter-field--campus { display: none; }
  .requests-filters.is-open .filter-field--campus { display: grid; order: 2; flex-basis: 100%; }
  .requests-filters__more { order: 3; }
  .filter-chip { min-height: 44px; }
  .requests-filters:not(.is-open) .clear-filters { display: none; }
  .filter-chips__clear { display: block; }
  .filter-chips__clear .el-button { min-height: 44px; }
  .requests-filters__more .filter-field { flex: 1 1 140px; }
  .requests-filters__more .el-select, .created-range :deep(.el-date-editor) { width: 100%; }
  .requests-filters__more .created-range { flex-basis: 100%; }
  .export-scope { text-align: left; }
  .requests-batch { padding: 12px; }
  .requests-batch__button { min-height: 44px; }
}
</style>
