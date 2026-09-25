<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Download, Filter, Plus, Search } from '@element-plus/icons-vue'
import { api, BASE_URL } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { campusLabel, formatDateTime, formatHoldRemaining, formatSlotWhen, holdIsUrgent, staffLabel, VISIT_SOURCE_LABELS, VISIT_STATUS, VISIT_STATUS_ORDER, visitSourceLabel, visitStatus, contactTimeLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import { useVisitStaff } from '../composables/useVisitStaff'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import { usePermissions } from '../composables/usePermissions'
import { useOpenRequestsStore } from '../stores/openRequests'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import StatusTag from '../components/StatusTag.vue'
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

// 關時段、設休假日、停用分校後的提示帶 ?attention=1&campus=… 進來。
const campusFromQuery = (value: unknown): string => (typeof value === 'string' ? value : '')
const campusFilter = ref(campusFromQuery(route.query.campus))
const statusFilter = ref(typeof route.query.status === 'string' ? route.query.status : '')
// 總覽「到期待追蹤」點進來帶 ?due=1，只列已到預定聯絡時間的案件。
const dueOnly = ref(route.query.due === '1')
// 承辦人：''＝全部、me＝我承辦的、none＝尚未指派。
const assigneeFilter = ref(route.query.assignee === 'me' || route.query.assignee === 'none' ? String(route.query.assignee) : '')
const sourceFilter = ref('')
// 送出日期區間（台灣日期，含頭尾）。櫃台會在手機上篩：窄螢幕的日期面板只顯示
// 一個月，雙月面板約 646px 會超出 390px 螢幕。
const createdRange = ref<[string, string] | null>(null)
const narrow = useNarrowScreen()
// 待人工處理：時段已關閉（含休假日）但家長仍要來，或分校已停用但尚未結案。
const attentionOnly = ref(route.query.attention === '1')
// 櫃台早上要「最舊的先處理」，排序要明講，不能靠猜。總覽的待辦帶 ?order=oldest 進來。
const orderFromQuery = (value: unknown): 'newest' | 'oldest' => (value === 'oldest' ? 'oldest' : 'newest')
const order = ref(orderFromQuery(route.query.order))
const page = ref(1)
const pageSize = 20
const requests = ref<VisitRequestDetailOut[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadVersion = 0
const search = ref('')
const hasFilters = computed(() => Boolean(campusFilter.value || statusFilter.value || search.value.trim() || dueOnly.value || assigneeFilter.value || sourceFilter.value || createdRange.value || attentionOnly.value))
function clearFilters() {
  campusFilter.value = ''
  statusFilter.value = ''
  search.value = ''
  dueOnly.value = false
  assigneeFilter.value = ''
  sourceFilter.value = ''
  createdRange.value = null
  attentionOnly.value = false
}

// 狀態是最常切的條件，攤成一排頁籤一鍵切換，不必每次打開下拉。兩個
// 待處理狀態帶側欄同源的數字；數字是可見校區的總數，所以只在沒有縮小
// 範圍（校區、搜尋、到期）時顯示，避免和清單對不上。
const statusTabs = computed(() => {
  const showCounts = !campusFilter.value && !search.value.trim() && !dueOnly.value && !assigneeFilter.value && !sourceFilter.value && !createdRange.value && !attentionOnly.value
  const counts: Record<string, number> = { new: openRequests.newRequests, pending_confirmation: openRequests.awaiting }
  return [
    { value: '', label: '全部', count: 0 },
    ...VISIT_STATUS_ORDER.map(value => ({ value, label: VISIT_STATUS[value]!.label, count: showCounts ? counts[value] ?? 0 : 0 })),
  ]
})
// 手機上篩選欄位疊起來會把第一筆案件推到半個螢幕以下；搜尋與狀態常駐，
// 其餘收進「更多篩選」，有套用時按鈕上顯示件數。
const moreFiltersOpen = ref(false)
const moreFilterCount = computed(() => [campusFilter.value, dueOnly.value, order.value !== 'newest', assigneeFilter.value, sourceFilter.value, createdRange.value, attentionOnly.value].filter(Boolean).length)

const hasNext = computed(() => requests.value.length === pageSize)

// 清單與 CSV 匯出送同一組篩選條件：畫面上篩好什麼，匯出的就是那一批。
function filterParams(): URLSearchParams {
  const params = new URLSearchParams()
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (search.value.trim()) params.set('q', search.value.trim())
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

async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = null
  try {
    const params = filterParams()
    params.set('page', String(page.value))
    params.set('page_size', String(pageSize))
    if (order.value !== 'newest') params.set('order', order.value)
    const result = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${params}`)
    if (version === loadVersion) requests.value = result
  } catch {
    if (version === loadVersion) {
      error.value = '無法讀取案件列表，請重新載入。'
      requests.value = []
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

watch([campusFilter, statusFilter, dueOnly, order, assigneeFilter, sourceFilter, createdRange, attentionOnly], () => {
  page.value = 1
  load()
})
// 邊打字邊查會連發請求，停下來再送；過時的回應由 loadVersion 擋掉。
let searchTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => { clearTimeout(searchTimer); loadVersion++ })
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    load()
  }, 300)
})
watch(page, load)
watch(() => route.query.status, status => {
  statusFilter.value = typeof status === 'string' ? status : ''
})
watch(() => route.query.due, due => {
  dueOnly.value = due === '1'
})
watch(() => route.query.order, value => {
  order.value = orderFromQuery(value)
})
watch(() => route.query.attention, value => {
  attentionOnly.value = value === '1'
})
watch(() => route.query.campus, value => {
  campusFilter.value = campusFromQuery(value)
})

// 只有待園方確認的占位有期限；其他狀態不顯示倒數。
function holdLabel(row: VisitRequestDetailOut): string {
  return row.status === 'pending_confirmation' ? formatHoldRemaining(row.hold_expires_at) : ''
}

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

function openDetail(row: VisitRequestDetailOut) {
  router.push(`/visit-requests/${row.id}`)
}

function onManualCreated(created: VisitRequestDetailOut) {
  router.push(`/visit-requests/${created.id}`)
}

const emptyText = computed(() => {
  if (search.value.trim()) return `找不到符合「${search.value.trim()}」的案件`
  if (attentionOnly.value) return '沒有待人工處理的案件'
  if (dueOnly.value) return '沒有到期待追蹤的案件'
  if (assigneeFilter.value === 'me') return '目前沒有你承辦的案件'
  if (assigneeFilter.value === 'none') return '沒有尚未指派的案件'
  if (statusFilter.value) return `沒有「${VISIT_STATUS[statusFilter.value]?.label ?? statusFilter.value}」的案件`
  return '還沒有任何參觀需求'
})

onMounted(() => {
  load()
  void loadStaff()
})
</script>

<template>
  <div class="page">
    <PageHeader lead="家長從官網送出的參觀需求。狀態「待處理」代表園方尚未聯絡，確認並排入時段後才算預約成立。">
      <template #actions>
        <el-button v-if="canHandle" type="primary" :icon="Plus" @click="manualOpen = true">補登案件</el-button>
        <el-button v-if="canExport" :icon="Download" aria-describedby="export-scope" @click="exportCsv">匯出 CSV</el-button>
        <span v-if="canExport" id="export-scope" class="export-scope hint">{{ exportScope }}</span>
      </template>
    </PageHeader>

    <div class="status-tabs" role="group" aria-label="案件狀態">
      <button v-for="tab in statusTabs" :key="tab.value" type="button" class="status-tab" :class="{ 'is-active': statusFilter === tab.value }"
        :aria-pressed="statusFilter === tab.value" @click="statusFilter = tab.value">
        {{ tab.label }}<span v-if="tab.count" class="status-tab__count num">{{ tab.count }}<span class="visually-hidden"> 件</span></span>
      </button>
    </div>

    <div class="toolbar requests-filters" :class="{ 'is-open': moreFiltersOpen }">
      <div class="filter-field filter-field--search"><span>搜尋</span>
      <el-input v-model="search" placeholder="家長／孩子姓名、電話或 Email" clearable :prefix-icon="Search" aria-label="搜尋家長／孩子姓名、電話或 Email" />
      </div>
      <button type="button" class="more-filters" :aria-expanded="moreFiltersOpen" aria-controls="requests-more-filters" @click="moreFiltersOpen = !moreFiltersOpen">
        <el-icon aria-hidden="true"><Filter /></el-icon>更多篩選<span v-if="moreFilterCount" class="status-tab__count num">{{ moreFilterCount }}</span>
      </button>
      <div id="requests-more-filters" class="requests-filters__more">
        <div class="filter-field"><span>校區</span>
        <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" />
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
        <el-checkbox v-model="dueOnly" class="filter-due">只看到期待追蹤</el-checkbox>
        <el-checkbox v-model="attentionOnly" class="filter-due">只看待人工處理</el-checkbox>
      </div>
      <el-button v-if="hasFilters" text @click="clearFilters">清除篩選</el-button>
    </div>

    <el-alert v-if="attentionOnly" class="attention-note" type="warning" :closable="false" show-icon title="待人工處理的案件">
      <p>排入的時段已關閉（含休假日）但家長還要來，或分校已停用、案件還沒結案。請聯絡家長改期到其他場次，或取消預約；處理完就會從這裡消失。那一場其實照常接待的話，到參觀時段頁重新開放，並把名額調成已占用的組數（不再收新預約）。</p>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div v-if="!error" class="panel" :aria-busy="loading">
      <div class="panel__head"><h2>參觀需求</h2><span class="hint">{{ loading ? '載入中…' : `本頁 ${requests.length} 件` }}</span></div>
      <el-table
        :data="requests"
        v-loading="loading"
        class="el-table--clickable requests-table"
        :empty-text="emptyText"
        @row-click="openDetail"
      >
        <template #empty><div v-if="!loading" class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後會顯示在這裡，可查看聯絡資訊並安排參觀。' }}</p><el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button></div></template>
        <el-table-column label="狀態" width="110">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <StatusTag :meta="visitStatus(row.status)" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="校區" width="90">
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ campusLabel(row.campus_key) }}</template>
        </el-table-column>
        <el-table-column label="家長／孩子" min-width="150">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <router-link :to="`/visit-requests/${row.id}`" @click.stop>{{ row.parent_name }}</router-link>
            <span class="muted cell-sub">{{ row.child_name || '孩子姓名未填寫' }}</span>
            <span v-if="row.source && row.source !== 'web'" class="cell-sub source">{{ visitSourceLabel(row.source) }}補登</span>
            <span v-if="row.follow_up_at" class="cell-sub num" :class="{ 'is-due': followUpDue(row) }">
              {{ followUpDue(row) ? '到期待追蹤' : '預定聯絡' }} {{ formatDateTime(row.follow_up_at) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="參觀時間" width="260">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span v-if="row.slot" class="num">{{ formatSlotWhen(row.slot) }}</span>
            <span v-else class="muted">尚未排定</span>
            <span v-if="holdLabel(row)" class="cell-sub num hold" :class="{ 'is-due': holdIsUrgent(row.hold_expires_at) }">確認期限{{ holdLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="電話" width="140">
          <template #default="{ row }: { row: VisitRequestDetailOut }"><a class="num" :href="`tel:${row.phone}`" @click.stop>{{ row.phone }}</a></template>
        </el-table-column>
        <el-table-column label="承辦人" width="110" show-overflow-tooltip>
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span :class="{ muted: !row.assigned_staff_id }">{{ staffLabel(row.assigned_staff_id, staff) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="家長方便時段" min-width="140" show-overflow-tooltip>
          <template #default="{ row }: { row: VisitRequestDetailOut }">{{ contactTimeLabel(row.preferred_time) }}</template>
        </el-table-column>
        <el-table-column label="送出時間" width="150">
          <template #default="{ row }: { row: VisitRequestDetailOut }">
            <span class="num">{{ formatDateTime(row.created_at) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="requests-mobile">
        <el-skeleton v-if="loading" animated :rows="4" class="panel__body" />
        <ul v-else-if="requests.length" class="request-list">
          <li v-for="request in requests" :key="request.id">
            <div class="request-list__head"><router-link :to="`/visit-requests/${request.id}`">{{ request.parent_name }}<span aria-hidden="true"> →</span></router-link><StatusTag :meta="visitStatus(request.status)" /></div>
            <p v-if="request.slot" class="request-list__when">參觀時間 {{ formatSlotWhen(request.slot) }}</p>
            <p v-if="holdLabel(request)" class="request-list__follow hold" :class="{ 'is-due': holdIsUrgent(request.hold_expires_at) }">確認期限{{ holdLabel(request) }}</p>
            <p v-if="request.follow_up_at" class="request-list__follow" :class="{ 'is-due': followUpDue(request) }">{{ followUpDue(request) ? '到期待追蹤' : '預定聯絡' }} {{ formatDateTime(request.follow_up_at) }}</p>
            <p>{{ campusLabel(request.campus_key) }}校 · {{ request.child_name || '孩子姓名未填寫' }}</p>
            <p>承辦：{{ staffLabel(request.assigned_staff_id, staff) }}<template v-if="request.source && request.source !== 'web'"> · {{ visitSourceLabel(request.source) }}補登</template></p>
            <a class="request-list__phone" :href="`tel:${request.phone}`">{{ request.phone }}</a>
            <p v-if="request.preferred_time">方便時段：{{ contactTimeLabel(request.preferred_time) }}</p>
            <span class="hint">{{ formatDateTime(request.created_at) }} 送出</span>
          </li>
        </ul>
        <div v-else class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後，可在這裡聯絡並安排參觀。' }}</p><el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button></div>
      </div>

      <div class="pager" v-if="page > 1 || hasNext">
        <el-button size="small" :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint">第 {{ page }} 頁</span>
        <el-button size="small" :disabled="!hasNext || loading" @click="page += 1">下一頁</el-button>
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
.toolbar { align-items: flex-end; }
.status-tabs { display: flex; gap: 4px; margin-bottom: 16px; padding: 4px; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); scrollbar-width: none; }
.status-tabs::-webkit-scrollbar { display: none; }
.status-tab { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border: 0; border-radius: calc(var(--radius) - 2px); background: transparent; color: var(--ink-2); font: inherit; font-size: 14px; white-space: nowrap; cursor: pointer; transition: background-color 150ms var(--ease-out), color 150ms var(--ease-out); }
.status-tab:hover { background: var(--surface-2); color: var(--ink); }
.status-tab.is-active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
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
.cell-sub { display: block; font-size: 12px; line-height: 1.4; }
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
.request-list__phone { display: inline-flex; min-height: 44px; align-items: center; text-decoration: underline; font-variant-numeric: tabular-nums; }
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
  .status-tab { min-height: 44px; }
  .more-filters { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--ink-2); font: inherit; font-size: 14px; cursor: pointer; }
  .requests-filters__more { display: none; }
  .requests-filters.is-open .requests-filters__more { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; width: 100%; }
  .requests-filters__more .filter-field { flex: 1 1 140px; }
  .requests-filters__more .el-select, .created-range :deep(.el-date-editor) { width: 100%; }
  .requests-filters__more .created-range { flex-basis: 100%; }
  .export-scope { text-align: left; }
}
</style>
