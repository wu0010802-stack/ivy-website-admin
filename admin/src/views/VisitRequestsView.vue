<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { Download, Filter, Plus, Search } from '@element-plus/icons-vue'
import { api, BASE_URL } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { campusLabel, formatHoldRemaining, formatShortDateTime, formatShortSlotWhen, holdIsUrgent, staffEmailById, staffLabelById, VISIT_SOURCE_LABELS, VISIT_GROUPS, VISIT_GROUP_LABELS, legacyStatusGroup, visitSourceLabel, visitDisplay, contactTimeLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import { useVisitStaff } from '../composables/useVisitStaff'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import { usePermissions } from '../composables/usePermissions'
import { useOpenRequestsStore } from '../stores/openRequests'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'

const router = useRouter()
const route = useRoute()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const { can } = usePermissions()
// 補登要能處理案件（booking.handle，含櫃台）；匯出個資要總管理者另外授權。
const canHandle = computed(() => can('booking.handle'))
const canExport = computed(() => can('booking.export'))
const { staff, load: loadStaff } = useVisitStaff()
const manualOpen = ref(false)
const openRequests = useOpenRequestsStore()

// 只負責一校的帳號（櫃台、單校管理者）：校區欄每列都一樣、校區下拉只有一個
// 選項，表格拿掉校區欄，篩選改成唯讀標籤，把寬度留給送出時間與承辦人。
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)

const campusFilter = ref('')
const groupFilter = ref('')
// 總覽「到期待追蹤」點進來帶 ?due=1，只列已到預定聯絡時間的案件。
const dueOnly = ref(false)
// 承辦人：''＝全部、me＝我承辦的、none＝尚未指派。
const assigneeFilter = ref('')
const sourceFilter = ref('')
// 送出日期區間（台灣日期，含頭尾）。櫃台會在手機上篩：窄螢幕的日期面板只顯示
// 一個月，雙月面板約 646px 會超出 390px 螢幕。
const createdRange = ref<[string, string] | null>(null)
const narrow = useNarrowScreen()
// 待人工處理：場次已關閉（含休假日）但家長仍要來，或分校已停用但尚未結案。
const attentionOnly = ref(false)
// 「時間已過」裡還沒標記到場的（status=confirmed）。後端 status 與 group 可以疊加，
// 網址寫成 ?group=past&status=confirmed；切到其他分頁就自動取消。
const attendanceOnly = ref(false)
// 櫃台早上要「最舊的先處理」，排序要明講，不能靠猜。總覽的待辦帶 ?order=oldest 進來。
const order = ref<'newest' | 'oldest'>('newest')
const page = ref(1)
const pageSize = 20
const requests = ref<VisitRequestDetailOut[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadVersion = 0
const search = ref('')

// ── 篩選與網址雙向同步 ──
// 所有條件與頁數都寫進網址（router.replace，不堆歷史）：點進案件再返回、重新整理，
// 列表維持原來的頁籤、搜尋與頁數；側欄、總覽與各種提示（?attention=1&campus=…、
// ?due=1、?status=…&order=oldest）改網址時再讀回來。兩邊都先比對，一樣就不動。
const LIST_PATH = route.path
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const queryText = (value: unknown): string => (typeof value === 'string' ? value : '')

function applyQuery(query: LocationQuery) {
  const campus = queryText(query.campus)
  campusFilter.value = multiCampus.value && visibleCampusKeys.value.includes(campus) ? campus : ''
  const group = queryText(query.group)
  // 舊書籤的 ?status= 轉成分組（資料庫狀態仍是七個，只有列表歸成四組）。
  groupFilter.value = (VISIT_GROUPS as readonly string[]).includes(group) ? group : legacyStatusGroup(queryText(query.status))
  attendanceOnly.value = group === 'past' && query.status === 'confirmed'
  search.value = queryText(query.q)
  dueOnly.value = query.due === '1'
  const assignee = queryText(query.assignee)
  assigneeFilter.value = assignee === 'me' || assignee === 'none' ? assignee : ''
  const source = queryText(query.source)
  sourceFilter.value = VISIT_SOURCE_LABELS[source] ? source : ''
  const from = queryText(query.created_from)
  const to = queryText(query.created_to)
  const range = DATE_RE.test(from) && DATE_RE.test(to) ? [from, to] : null
  if (range?.join() !== createdRange.value?.join()) createdRange.value = range as [string, string] | null
  attentionOnly.value = query.attention === '1'
  order.value = query.order === 'oldest' ? 'oldest' : 'newest'
  const pageNumber = Number(queryText(query.page))
  page.value = Number.isInteger(pageNumber) && pageNumber > 1 ? pageNumber : 1
}

// 目前的條件 → 網址。預設值不寫，網址保持乾淨；搜尋照使用者打的字寫。
function stateQuery(): Record<string, string> {
  const query: Record<string, string> = {}
  if (groupFilter.value) query.group = groupFilter.value
  if (attendanceOnly.value) query.status = 'confirmed'
  if (search.value.trim()) query.q = search.value.trim()
  if (campusFilter.value) query.campus = campusFilter.value
  if (assigneeFilter.value) query.assignee = assigneeFilter.value
  if (sourceFilter.value) query.source = sourceFilter.value
  if (createdRange.value) {
    query.created_from = createdRange.value[0]
    query.created_to = createdRange.value[1]
  }
  if (dueOnly.value) query.due = '1'
  if (attentionOnly.value) query.attention = '1'
  if (order.value !== 'newest') query.order = order.value
  if (page.value > 1) query.page = String(page.value)
  return query
}

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

const hasFilters = computed(() => Boolean(campusFilter.value || groupFilter.value || search.value.trim() || dueOnly.value || assigneeFilter.value || sourceFilter.value || createdRange.value || attentionOnly.value))
function clearFilters() {
  campusFilter.value = ''
  groupFilter.value = ''
  attendanceOnly.value = false
  search.value = ''
  dueOnly.value = false
  assigneeFilter.value = ''
  sourceFilter.value = ''
  createdRange.value = null
  attentionOnly.value = false
}

// 分組是最常切的條件，攤成一排頁籤一鍵切換。數字來自 group-counts，
// 套用目前其他條件（校區、搜尋…），所以和清單對得上；有舊案（待處理）才出現那一頁籤。
const groupCounts = ref<Record<string, number>>({})
const statusTabs = computed(() => [
  { value: '', label: '全部', count: 0 },
  ...VISIT_GROUPS
    .filter(value => value !== 'pending' || (groupCounts.value.pending ?? 0) > 0 || groupFilter.value === 'pending')
    .map(value => ({ value: value as string, label: VISIT_GROUP_LABELS[value], count: groupCounts.value[value] ?? 0 })),
])
// 手機上篩選欄位疊起來會把第一筆案件推到半個螢幕以下；搜尋與狀態常駐，
// 其餘收進「更多篩選」，有套用時按鈕上顯示件數。
const moreFiltersOpen = ref(false)
const moreFilterCount = computed(() => [campusFilter.value, dueOnly.value, order.value !== 'newest', assigneeFilter.value, sourceFilter.value, createdRange.value, attentionOnly.value].filter(Boolean).length)

const hasNext = computed(() => requests.value.length === pageSize)

// 家長報的電話常帶空格、連字號或國碼（0912-345-678、+886 912 345 678），資料庫存的是
// 10 碼純數字；搜尋字看起來像電話就先去掉符號再查，匯出也一樣。
// 還在打國碼或前幾碼（+886、+88、09-）時照原字查：只剩「0」「88」會查出幾乎每一筆。
function searchTerm(): string {
  const text = search.value.trim()
  if (!/^[\d\s()+-]+$/.test(text)) return text
  const digits = text.replace(/\D/g, '')
  // 國碼可能帶「+」或沒帶（886912345678）；沒帶的要夠長才算，免得把號碼片段當國碼。
  if (text.startsWith('+886') || (digits.startsWith('886') && digits.length >= 11)) {
    const local = digits.slice(3).replace(/^0/, '')
    return local.length >= 3 ? `0${local}` : text
  }
  return digits.length >= 4 ? digits : text
}

// 清單與 CSV 匯出送同一組篩選條件：畫面上篩好什麼，匯出的就是那一批。
function filterParams(options: { withGroup?: boolean } = {}): URLSearchParams {
  const params = new URLSearchParams()
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  if (groupFilter.value && options.withGroup !== false) params.set('group', groupFilter.value)
  // 分頁數字（withGroup: false）要算各組全部，不能只算還沒標記到場的。
  if (attendanceOnly.value && options.withGroup !== false) params.set('status', 'confirmed')
  if (searchTerm()) params.set('q', searchTerm())
  if (dueOnly.value) params.set('follow_up_due', 'true')
  if (assigneeFilter.value) params.set('assignee', assigneeFilter.value)
  if (sourceFilter.value) params.set('source', sourceFilter.value)
  if (createdRange.value) {
    params.set('created_from', createdRange.value[0])
    params.set('created_to', createdRange.value[1])
  }
  if (attentionOnly.value) params.set('needs_attention', 'true')
  return params
}

async function loadCounts(version: number) {
  try {
    const counts = await api.get<Record<string, number>>(`/admin/visit-requests/group-counts?${filterParams({ withGroup: false })}`)
    if (version === loadVersion) groupCounts.value = counts
  } catch {
    if (version === loadVersion) groupCounts.value = {}
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
    if (order.value !== 'newest') params.set('order', order.value)
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

watch(groupFilter, (group) => { if (group !== 'past') attendanceOnly.value = false })
function toggleAttendance(on: boolean) {
  attendanceOnly.value = on
  if (on) groupFilter.value = 'past'
}

watch([campusFilter, groupFilter, dueOnly, order, assigneeFilter, sourceFilter, createdRange, attentionOnly, attendanceOnly], () => {
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
watch(() => route.query, query => {
  // 點進案件時網址先換成明細頁，這裡不跟著清掉條件。
  if (route.path !== LIST_PATH) return
  const key = queryKey(query)
  if (writingQueries.has(key) || key === queryKey(stateQuery())) return
  applyQuery(query)
})

// 櫃台常整個早上開著列表：切回這個分頁或視窗時，距上次讀取超過 60 秒就靜靜重抓
// 一次，側欄的待處理數字一起更新。不做定時輪詢。
const STALE_MS = 60_000
function refreshIfStale() {
  if (document.visibilityState === 'hidden' || loading.value || Date.now() - loadedAt < STALE_MS) return
  void load({ quiet: true })
  void openRequests.refresh(true)
}
onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(searchTimer)
  loadVersion++
  document.removeEventListener('visibilitychange', refreshIfStale)
  window.removeEventListener('focus', refreshIfStale)
})

// 只有待園方確認的占位有期限；其他狀態不顯示倒數。
function holdLabel(row: VisitRequestDetailOut): string {
  return row.status === 'pending_confirmation' ? formatHoldRemaining(row.hold_expires_at) : ''
}

// 送出時間、預定聯絡與參觀時間：今年的省略年份（labels.ts formatShortDateTime／
// formatShortSlotWhen），表格欄位才放得下；跨年的照寫年份。

// 補登（電話、LINE、現場）才標來源；官網表單是預設，不佔字。
const manualSource = (row: VisitRequestDetailOut): string => (row.source && row.source !== 'web' ? `${visitSourceLabel(row.source)}補登` : '')

function followUpDue(row: VisitRequestDetailOut): boolean {
  if (!row.follow_up_at) return false
  if (row.status === 'cancelled' || row.status === 'completed') return false
  return new Date(row.follow_up_at).getTime() <= Date.now()
}

// 匯出不分頁：符合目前篩選的全部案件。按鈕旁講清楚範圍，避免以為只匯出這一頁，
// 或沒注意到沒篩選時會匯出可見校區的全部案件。
const exportScope = computed(() => (hasFilters.value ? '匯出範圍：目前篩選的全部結果（不只本頁）' : '匯出範圍：可見校區的全部案件'))
function exportCsv() {
  window.open(`${BASE_URL}/admin/visit-requests/export?${filterParams()}`, '_blank')
}

// 點進案件時把目前的篩選條件與排序帶過去，案件頁的「下一筆」才會照這份列表的
// 順序走。沒有篩狀態、到期或待人工處理時（例如「全部」）不帶：那份列表夾著已結案
// 的案件，「下一筆」改用固定的處理優先序。
function detailTo(id: string) {
  const actionable = groupFilter.value || dueOnly.value || attentionOnly.value
  if (!actionable) return `/visit-requests/${id}`
  const params = filterParams()
  if (order.value !== 'newest') params.set('order', order.value)
  // 第 2 頁以後要連每頁筆數一起帶，案件頁才會查到同一段列表（案件頁預設一次抓 50 筆）。
  if (page.value > 1) {
    params.set('page', String(page.value))
    params.set('page_size', String(pageSize))
  }
  return { path: `/visit-requests/${id}`, query: { list: params.toString() } }
}

function openDetail(row: VisitRequestDetailOut) {
  router.push(detailTo(row.id))
}

function onManualCreated(created: VisitRequestDetailOut) {
  router.push(`/visit-requests/${created.id}`)
}

const emptyText = computed(() => {
  if (page.value > 1) return '後面沒有更多案件了'
  if (search.value.trim()) return `找不到符合「${search.value.trim()}」的案件`
  if (attentionOnly.value) return '沒有待人工處理的案件'
  if (attendanceOnly.value) return '沒有尚未確認到場的案件'
  if (dueOnly.value) return '沒有到期待追蹤的案件'
  if (assigneeFilter.value === 'me') return '目前沒有你承辦的案件'
  if (assigneeFilter.value === 'none') return '沒有尚未指派的案件'
  if (groupFilter.value) return `沒有「${(VISIT_GROUP_LABELS as Record<string, string>)[groupFilter.value] ?? groupFilter.value}」的案件`
  return '還沒有任何參觀案件'
})

onMounted(() => {
  load()
  void loadStaff()
  document.addEventListener('visibilitychange', refreshIfStale)
  window.addEventListener('focus', refreshIfStale)
})
</script>

<template>
  <div class="page">
    <PageHeader lead="家長在官網選好場次送出，就是預約成功。這裡看每一筆預約，需要時改場次或取消。">
      <template #actions>
        <el-button v-if="canHandle" type="primary" :icon="Plus" @click="manualOpen = true">補登案件</el-button>
        <el-button v-if="canExport" :icon="Download" aria-describedby="export-scope" @click="exportCsv">匯出 CSV</el-button>
        <span v-if="canExport" id="export-scope" class="export-scope hint">{{ exportScope }}</span>
      </template>
    </PageHeader>

    <div class="status-tabs" role="group" aria-label="案件狀態">
      <button v-for="tab in statusTabs" :key="tab.value" type="button" class="status-tab" :class="{ 'is-active': groupFilter === tab.value }"
        :aria-pressed="groupFilter === tab.value" @click="groupFilter = tab.value">
        {{ tab.label }}<span v-if="tab.count" class="status-tab__count num">{{ tab.count }}<span class="visually-hidden"> 件</span></span>
      </button>
    </div>

    <div class="toolbar requests-filters" :class="{ 'is-open': moreFiltersOpen }">
      <div class="filter-field filter-field--search"><span>搜尋</span>
      <el-input v-model="search" placeholder="姓名、電話或 Email" clearable :prefix-icon="Search" aria-label="搜尋家長／孩子姓名、電話或 Email" />
      </div>
      <button type="button" class="more-filters" :aria-expanded="moreFiltersOpen" aria-controls="requests-more-filters" @click="moreFiltersOpen = !moreFiltersOpen">
        <el-icon aria-hidden="true"><Filter /></el-icon>更多篩選<span v-if="moreFilterCount" class="status-tab__count num">{{ moreFilterCount }}</span>
      </button>
      <div id="requests-more-filters" class="requests-filters__more">
        <!-- 單校時 CampusSelect 自己帶「校區」字樣，外面不再重複一次。 -->
        <div class="filter-field"><span v-if="multiCampus">校區</span>
        <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="multiCampus ? '全部校區' : undefined" />
        </div>
        <div class="filter-field"><span>排序</span>
        <el-select v-model="order" aria-label="排序" class="order-select">
          <el-option label="最新送出在前" value="newest" />
          <el-option label="最早送出在前" value="oldest" />
        </el-select>
        </div>
        <div class="filter-field"><span>承辦人</span>
        <el-select v-model="assigneeFilter" aria-label="承辦人" placeholder="全部承辦人" clearable class="order-select">
          <el-option label="我承辦的" value="me" />
          <el-option label="尚未指派" value="none" />
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
      </div>
      <el-button v-if="hasFilters" text @click="clearFilters">清除篩選</el-button>
    </div>

    <el-alert v-if="attentionOnly" class="attention-note" type="warning" :closable="false" show-icon title="待人工處理的案件">
      <p>排入的場次已關閉（含休假日）但家長還要來，或分校已停用、案件還沒結案。請聯絡家長改期到其他場次，或取消預約；處理完就會從這裡消失。那一場其實照常接待的話，到參觀場次頁恢復開放，並把名額調成已占用的組數（不再收新預約）。</p>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>

    <div v-if="!error" class="panel" :aria-busy="loading">
      <div class="panel__head"><h2>參觀案件</h2><span class="hint">{{ loading ? '載入中…' : `本頁 ${requests.length} 件` }}</span></div>
      <el-table
        :data="requests"
        v-loading="loading"
        class="el-table--clickable requests-table"
        :empty-text="loading ? '' : emptyText"
        @row-click="openDetail"
      >
        <!-- 翻到最後一頁之後（page > 1）是到底了，不是篩不到：引導回上一頁，不叫人清除篩選。 -->
        <template #empty><div v-if="!loading" class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ page > 1 ? '前面的頁數還有案件。' : hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後會顯示在這裡，可查看聯絡資訊並安排參觀。' }}</p><el-button v-if="page > 1" @click="page -= 1">回上一頁</el-button><el-button v-else-if="hasFilters" @click="clearFilters">清除篩選</el-button></div></template>
        <!-- 欄寬以 1280 寬桌機（表格約 960px）放得下為準：固定欄合計約 760px，
             其餘給家長欄。參觀時間今年的省略年份（約 180px），欄寬 210；省下的寬度給承辦人。 -->
        <el-table-column label="狀態" width="150">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span class="visit-state" :data-tone="visitDisplay(row).tone">{{ visitDisplay(row).label }}</span>
            <span v-if="visitDisplay(row).sub" class="cell-sub visit-state__sub" :data-tone="visitDisplay(row).tone">{{ visitDisplay(row).sub }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="multiCampus" label="校區" width="68">
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ campusLabel(row.campus_key) }}</template>
        </el-table-column>
        <!-- 方便接電話時段併成家長欄的灰字副行（明細與手機卡片也有），不另佔一欄。 -->
        <el-table-column label="家長／孩子" min-width="180">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <router-link :to="detailTo(row.id)" @click.stop>{{ row.parent_name }}</router-link>
            <span class="muted cell-sub">{{ row.child_name || '孩子姓名未填寫' }}<span v-if="manualSource(row)" class="source"> · {{ manualSource(row) }}</span></span>
            <span v-if="row.follow_up_at" class="cell-sub cell-sub--line num" :class="{ 'is-due': followUpDue(row) }">{{ followUpDue(row) ? '到期待追蹤' : '預定聯絡' }} {{ formatShortDateTime(row.follow_up_at) }}</span>
            <span v-if="row.preferred_time" class="muted cell-sub">方便接電話時段：{{ contactTimeLabel(row.preferred_time) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="參觀時間" width="210">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span v-if="row.slot" class="num">{{ formatShortSlotWhen(row.slot) }}</span>
            <span v-else class="muted">尚未排定</span>
            <span v-if="holdLabel(row)" class="cell-sub num hold" :class="{ 'is-due': holdIsUrgent(row.hold_expires_at) }">確認期限{{ holdLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="電話" width="116">
          <template #default="{ row }: { row: VisitRequestDetailOut }"><a class="num" :href="`tel:${row.phone}`" @click.stop>{{ row.phone }}</a></template>
        </el-table-column>
        <el-table-column label="承辦人" width="156" show-overflow-tooltip>
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span :class="{ muted: !row.assigned_staff_id }" :title="staffEmailById(row.assigned_staff_id, staff) || undefined">{{ staffLabelById(row.assigned_staff_id, staff) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="送出時間" width="112">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span class="num date-cell">{{ formatShortDateTime(row.created_at) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="requests-mobile">
        <el-skeleton v-if="loading" animated :rows="4" class="panel__body" />
        <ul v-else-if="requests.length" class="request-list">
          <li v-for="request in requests" :key="request.id">
            <div class="request-list__head"><router-link :to="detailTo(request.id)">{{ request.parent_name }}<span aria-hidden="true"> →</span></router-link><span class="visit-state" :data-tone="visitDisplay(request).tone">{{ visitDisplay(request).label }}</span></div>
            <p v-if="visitDisplay(request).sub" class="hint visit-state__sub" :data-tone="visitDisplay(request).tone">{{ visitDisplay(request).sub }}</p>
            <p v-if="request.slot" class="request-list__when">參觀時間 {{ formatShortSlotWhen(request.slot) }}</p>
            <p v-if="holdLabel(request)" class="request-list__follow hold" :class="{ 'is-due': holdIsUrgent(request.hold_expires_at) }">確認期限{{ holdLabel(request) }}</p>
            <p v-if="request.follow_up_at" class="request-list__follow" :class="{ 'is-due': followUpDue(request) }">{{ followUpDue(request) ? '到期待追蹤' : '預定聯絡' }} {{ formatShortDateTime(request.follow_up_at) }}</p>
            <p><template v-if="multiCampus">{{ campusLabel(request.campus_key) }}校 · </template>{{ request.child_name || '孩子姓名未填寫' }} · 承辦：{{ staffLabelById(request.assigned_staff_id, staff) }}<template v-if="manualSource(request)"> · {{ manualSource(request) }}</template></p>
            <div class="request-list__contact">
              <a class="request-list__phone" :href="`tel:${request.phone}`">{{ request.phone }}</a>
              <span v-if="request.preferred_time" class="request-list__time">方便接電話時段：{{ contactTimeLabel(request.preferred_time) }}</span>
            </div>
            <span class="hint">{{ formatShortDateTime(request.created_at) }} 送出</span>
          </li>
        </ul>
        <div v-else class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ page > 1 ? '前面的頁數還有案件。' : hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後，可在這裡聯絡並安排參觀。' }}</p><el-button v-if="page > 1" @click="page -= 1">回上一頁</el-button><el-button v-else-if="hasFilters" @click="clearFilters">清除篩選</el-button></div>
      </div>

      <div class="pager" v-if="page > 1 || hasNext">
        <el-button size="small" :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint">第 {{ page }} 頁</span>
        <el-button size="small" :disabled="!hasNext || loading" @click="nextPage">下一頁</el-button>
      </div>
    </div>

    <ManualVisitDialog
      v-if="canHandle"
      v-model="manualOpen"
      :campus-keys="visibleCampusKeys"
      :default-campus="campusFilter"
      @created="onManualCreated"
    />
  </div>
</template>

<style scoped>
.visit-state { font-weight: 600; }
.visit-state[data-tone='success'] { color: var(--status-live-ink); }
.visit-state[data-tone='danger'] { color: var(--el-color-danger); }
.visit-state[data-tone='warning'] { color: var(--el-color-warning-dark-2); }
.visit-state[data-tone='info'] { color: var(--ink-3); }
.visit-state__sub { display: block; }
/* 尚未確認到場是接待要處理的事：副行跟著暖黃、加粗，和已到場、未到場的灰字分開。 */
.visit-state__sub[data-tone='warning'] { color: var(--el-color-warning-dark-2); font-weight: 600; }
.toolbar { align-items: flex-end; }
/* 頁籤放不下就換行，不藏在看不見的橫向捲動裡（手機上後四個狀態會被忽略）。 */
.status-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.status-tab { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border: 0; border-radius: calc(var(--radius) - 2px); background: transparent; color: var(--ink-2); font: inherit; font-size: 14px; white-space: nowrap; cursor: pointer; transition: background-color 150ms var(--ease-out), color 150ms var(--ease-out); }
.status-tab:hover { background: var(--surface-2); color: var(--ink); }
/* 淺藍底上的字用深一階的操作色：--el-color-primary 在 light-9 底只有 4.4:1。 */
.status-tab.is-active { background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); font-weight: 600; }
.status-tab__count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--brand-gold); color: var(--ink); font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; }
.requests-filters__more { display: contents; }
.more-filters { display: none; }
.order-select { width: 150px; }
.created-range :deep(.el-date-editor) { width: 260px; }
/* 寬度跟著按鈕列走，不把整個動作區撐寬去擠左邊的說明文字。 */
.export-scope { flex-basis: 100%; width: 0; min-width: 100%; font-size: 12px; text-align: right; }
.attention-note { margin-bottom: 16px; }
.attention-note p { margin: 0; }
.filter-field { display: grid; gap: 6px; font-size: 13px; color: var(--ink-2); }
.filter-due { align-self: center; padding-bottom: 6px; }
/* 單校的唯讀校區標籤跟旁邊的下拉一樣高，底線對齊。 */
.requests-filters :deep(.campus-single) { min-height: var(--control-h); }
.cell-sub { display: block; font-size: 12px; line-height: 1.4; }
/* 「到期待追蹤 09/27 15:00」在家長欄最窄時也是一行；跨年多了年份放不下時只在空白處換行，
   不在日期中間折斷，也不截掉時間。 */
.cell-sub--line { word-break: keep-all; }
/* 跨年的送出時間在空白處換行（日期／時間各一行），不在數字中間斷開。 */
.date-cell { word-break: keep-all; }
.cell-sub.is-due, .request-list__follow.is-due { color: var(--brand-gold-ink); font-weight: 600; }
.request-list__follow { font-size: 13px; }
.hold { color: var(--ink-2); }
.source { color: var(--ink-2); }
.requests-empty { padding: 32px 16px; text-align: center; color: var(--ink-2); }
.requests-empty strong { font-size: 16px; color: var(--ink); }
.requests-empty p { margin: 8px auto 16px; max-width: 50ch; }
.requests-mobile { display: none; }
.request-list { list-style: none; margin: 0; padding: 0; }
.request-list li { padding: 20px 16px; }
.request-list li + li { border-top: 1px solid var(--line); }
.request-list__head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 4px; }
.request-list__head a { display: inline-flex; align-items: center; min-height: 44px; font-size: 17px; font-weight: 600; }
.request-list p { color: var(--ink-2); margin-bottom: 6px; overflow-wrap: anywhere; }
.request-list__when { color: var(--el-color-primary); font-weight: 500; }
.filter-field--search { flex: 1 1 240px; max-width: 320px; }
.request-list > li > .hint { display: block; }
.request-list__contact { display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; margin-bottom: 2px; }
.request-list__phone { display: inline-flex; min-height: 44px; align-items: center; text-decoration: underline; font-variant-numeric: tabular-nums; }
.request-list__time { color: var(--ink-2); font-size: 14px; }
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}
@media (max-width: 720px) {
  .requests-table { display: none; }
  .requests-mobile { display: block; }
  .filter-field { flex: 1 1 130px; min-width: 0; font-size: 14px; }
  /* 搜尋是手機上最常用的入口，給整行才放得下提示文字 */
  .filter-field--search { flex: 1 1 0; max-width: none; }
  /* 八個頁籤在 360–390px 排成兩列、各列撐滿，全部一眼看得到。 */
  .status-tab { flex: 1 1 auto; justify-content: center; min-height: 44px; padding: 0 8px; }
  .more-filters { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--ink-2); font: inherit; font-size: 14px; cursor: pointer; }
  .requests-filters__more { display: none; }
  .requests-filters.is-open .requests-filters__more { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; width: 100%; }
  .requests-filters__more .filter-field { flex: 1 1 140px; }
  .requests-filters__more .el-select, .created-range :deep(.el-date-editor) { width: 100%; }
  .requests-filters__more .created-range { flex-basis: 100%; }
  .export-scope { text-align: left; }
}
</style>
