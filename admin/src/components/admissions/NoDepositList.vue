<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { getNoDepositRecords, noDepositExportPath, type NoDepositFilters } from '../../api/admissions'
import { apiErrorMessage } from '../../api/errors'
import { campusLabel } from '../../api/labels'
import type { NoDepositRecord } from '../../api/types'
import { taipeiToday } from '../../admissions/academic'
import { GRADES, NO_DEPOSIT_REASONS } from '../../admissions/constants'
import { NO_VALUE, priorityLabel } from '../../admissions/statsFormat'
import { notifyError } from '../../composables/notify'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { csvFilename, downloadServerCsv } from '../../utils/csv'

// 未預繳明細（園務 RecruitmentNoDepositTab 的「未預繳明細」；2026-10-01 使用者裁定統計頁要列名單）。
// 資料來自 GET /admin/admissions/no-deposit-records（C2b），母體同統計：未預繳且未退出。
// 篩選、表頭、tag、空狀態照園務原文；園務的三張數字卡在 StatsTab（用 /stats 的數字），這裡不重複。
// 「查看」帶這筆的月份切到訪視明細：B 的明細只吃 month、vr 兩個網址參數，帶不到單筆（C 計畫調整表）。
type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type Preset = Record<string, string | number>

const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: number | null
  /** 警示或行動入口指到「未預繳原因」時的 target_filter（priority、overdue_days），同園務 applyNoDepositFilter。 */
  preset?: Preset | null
  /** 這個範圍的未預繳總筆數（統計的 no_deposit_total），用來對照篩選後的筆數。 */
  overallTotal?: number
}>()
const emit = defineEmits<{ 'open-records': [filter: { month: string }] }>()

// 園務 RecruitmentStatsPanel 的 ndFilter.page_size。
const PAGE_SIZE = 50
// 畫面上只有「逾 14 天」一個開關（園務 onOverdueDaysChange）。
const OVERDUE_DAYS = 14
// 「全部潛力」在園務是空字串；官網用 'all'，el-select 才不會把它當成沒選而顯示 placeholder。
const PRIORITY_OPTIONS: readonly { label: string; value: PriorityFilter }[] = [
  { label: '高潛力優先', value: 'high' },
  { label: '全部潛力', value: 'all' },
  { label: '中潛力', value: 'medium' },
  { label: '低潛力', value: 'low' },
]
const PRIORITY_TAG_TYPES: Record<'high' | 'medium' | 'low', 'danger' | 'warning' | 'info'> = { high: 'danger', medium: 'warning', low: 'info' }

const headingId = useId()
const priority = ref<PriorityFilter>('high')
const reason = ref('')
const grade = ref('')
const overdueDays = ref<number | null>(null)
const coldOnly = ref(false)
const page = ref(1)

const records = ref<NoDepositRecord[]>([])
const total = ref(0)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()

function isPriorityFilter(value: unknown): value is PriorityFilter {
  return PRIORITY_OPTIONS.some((option) => option.value === value)
}

// 園務 applyNoDepositFilter：其餘篩選回預設，再套 target_filter，回第 1 頁。
function applyPreset(preset: Preset | null | undefined) {
  const wanted = preset?.priority
  priority.value = isPriorityFilter(wanted) ? wanted : 'high'
  const days = Number(preset?.overdue_days)
  overdueDays.value = Number.isInteger(days) && days > 0 ? days : null
  reason.value = ''
  grade.value = ''
  coldOnly.value = false
  page.value = 1
}

const { can } = usePermissions()
// 含孩子姓名與電訪回應的名單：要「匯出個資」授權（後端另外擋，這裡只是不顯示按鈕）。
const canExport = computed(() => can('booking.export'))

// 列表與 CSV 匯出送同一組篩選：畫面上篩好什麼，匯出的就是那一批。
function currentFilters(): NoDepositFilters {
  return {
    campus_key: props.campusKey,
    school_year: props.schoolYear,
    semester: props.semester,
    reason: reason.value || null,
    grade: grade.value || null,
    priority: priority.value === 'all' ? null : priority.value,
    overdue_days: overdueDays.value,
    cold_only: coldOnly.value || null,
  }
}

async function load(options: { reset?: boolean } = {}) {
  const request = requests.begin()
  if (options.reset) {
    records.value = []
    total.value = 0
  }
  failed.value = false
  if (!props.campusKey) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await getNoDepositRecords({ ...currentFilters(), page: page.value, page_size: PAGE_SIZE })
    if (!requests.isCurrent(request)) return
    records.value = result.records
    total.value = result.total
  } catch {
    if (!requests.isCurrent(request)) return
    records.value = []
    total.value = 0
    failed.value = true
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// CSV 由後端產生（含個資、寫稽核、有筆數上限）：筆數太多回 422 中文訊息，沒權限回 403，
// 都用提示講清楚，不產生檔案。
const exporting = ref(false)
async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    await downloadServerCsv(noDepositExportPath(currentFilters()), csvFilename('未預繳名單', campusLabel(props.campusKey), taipeiToday()))
  } catch (err) {
    notifyError(apiErrorMessage(err, '匯出失敗，請再試一次。'))
  } finally {
    exporting.value = false
  }
}

applyPreset(props.preset)

// 換校區或學年學期：回第 1 頁，清空再讀（不留別校的名單）。
watch(
  [() => props.campusKey, () => props.schoolYear, () => props.semester],
  () => {
    page.value = 1
    void load({ reset: true })
  },
  { immediate: true },
)

// StatsTab 每次都給新物件，同一個入口點第二次也會重新套用。
watch(
  () => props.preset,
  (preset) => {
    applyPreset(preset)
    void load()
  },
)

// 任何篩選改了都回第 1 頁再讀（園務 onNoDepositFilterChange）。
function refilter() {
  page.value = 1
  void load()
}
function setPriority(value: unknown) {
  priority.value = isPriorityFilter(value) ? value : 'all'
  refilter()
}
function setReason(value: unknown) {
  reason.value = typeof value === 'string' ? value : ''
  refilter()
}
function setGrade(value: unknown) {
  grade.value = typeof value === 'string' ? value : ''
  refilter()
}
function setOverdue(value: string | number | boolean) {
  overdueDays.value = value ? OVERDUE_DAYS : null
  refilter()
}
function setColdOnly(value: string | number | boolean) {
  coldOnly.value = Boolean(value)
  refilter()
}
function setPage(value: number) {
  page.value = value
  void load()
}
function showAllPriority() {
  priority.value = 'all'
  refilter()
}

const priorityFilterLabel = computed(() => PRIORITY_OPTIONS.find((option) => option.value === priority.value)?.label ?? '潛力')
// 園務原文；園務上方是圖表，官網是表格（「未預繳原因分佈」）。
const emptyText = computed(() =>
  priority.value === 'all'
    ? '目前篩選條件下沒有未預繳名單'
    : `目前「${priorityFilterLabel.value}」篩選下沒有名單，上方表格統計的是全部原因分布`,
)

const orDash = (value: string | null | undefined) => value || NO_VALUE

function openRecords(row: NoDepositRecord) {
  emit('open-records', { month: row.month })
}
</script>

<template>
  <section class="stats-block nd" :aria-labelledby="headingId">
    <div class="nd-head">
      <h3 :id="headingId" class="stats-block__title">未預繳明細</h3>
      <div class="nd-filters">
        <!-- 三個選單都不 teleport：選項留在元件裡，單元測試才找得到。 -->
        <el-select
          :model-value="priority"
          aria-label="轉換潛力"
          size="small"
          class="nd-priority"
          :teleported="false"
          @update:model-value="setPriority"
        >
          <el-option v-for="option in PRIORITY_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-select
          :model-value="reason || undefined"
          placeholder="篩選原因"
          aria-label="篩選原因"
          clearable
          size="small"
          class="nd-reason"
          :teleported="false"
          @update:model-value="setReason"
        >
          <el-option v-for="item in NO_DEPOSIT_REASONS" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select
          :model-value="grade || undefined"
          placeholder="班別"
          aria-label="班別"
          clearable
          size="small"
          class="nd-grade"
          :teleported="false"
          @update:model-value="setGrade"
        >
          <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
        </el-select>
        <el-checkbox :model-value="overdueDays !== null" @update:model-value="setOverdue">只看逾 14 天待追</el-checkbox>
        <el-checkbox :model-value="coldOnly" @update:model-value="setColdOnly">只看冷名單</el-checkbox>
        <span class="nd-count">符合條件 {{ total }} 筆<template v-if="overallTotal !== undefined">，未預繳共 {{ overallTotal }} 筆</template></span>
        <el-button v-if="canExport" size="small" :icon="Download" :loading="exporting" @click="exportCsv">匯出 CSV</el-button>
      </div>
    </div>
    <p class="hint nd-caption">「查看」會切到訪視明細，並篩這筆的月份。</p>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取未預繳名單，請重新載入。">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <div v-else-if="!records.length" v-loading="loading" class="nd-empty">
      <template v-if="!loading">
        <p>{{ emptyText }}</p>
        <el-button v-if="priority !== 'all'" size="small" @click="showAllPriority">改看全部潛力</el-button>
      </template>
    </div>
    <div v-else v-loading="loading" class="nd-scroll" role="region" tabindex="0" aria-label="未預繳明細（可左右捲動）">
      <table class="nd-table">
        <thead>
          <tr>
            <th scope="col">月份</th>
            <th scope="col">姓名</th>
            <th scope="col">班別</th>
            <th scope="col">原因分類</th>
            <th scope="col">轉換潛力</th>
            <th scope="col">冷名單</th>
            <th scope="col">說明</th>
            <th scope="col">來源</th>
            <th scope="col">家長介紹</th>
            <th scope="col">電訪回應</th>
            <th scope="col">明細</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in records" :key="row.id">
            <td class="num">{{ row.month }}</td>
            <td>{{ row.child_name }}</td>
            <td>{{ orDash(row.grade) }}</td>
            <td>{{ row.no_deposit_reason ?? '未分類' }}</td>
            <td>
              <el-tag v-if="row.priority" :type="PRIORITY_TAG_TYPES[row.priority]" size="small">{{ priorityLabel(row.priority) }}</el-tag>
              <span v-else>{{ NO_VALUE }}</span>
            </td>
            <td><el-tag v-if="row.cold" type="info" size="small">冷</el-tag></td>
            <td class="nd-long">{{ orDash(row.no_deposit_reason_detail) }}</td>
            <td>{{ orDash(row.source) }}</td>
            <td>{{ orDash(row.referrer) }}</td>
            <td class="nd-long">{{ orDash(row.parent_response) }}</td>
            <td>
              <el-button
                link
                type="primary"
                size="small"
                :aria-label="`查看 ${row.month} 的訪視明細（${row.child_name}）`"
                @click="openRecords(row)"
              >
                查看
              </el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <el-pagination
      v-if="total > PAGE_SIZE"
      class="nd-pagination"
      :current-page="page"
      :page-size="PAGE_SIZE"
      :total="total"
      layout="prev, pager, next"
      @current-change="setPage"
    />
  </section>
</template>

<style scoped>
.nd {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.nd-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.stats-block__title {
  margin: 0;
  font-size: var(--text-md);
}

.nd-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.nd-priority {
  width: 140px;
}

.nd-reason {
  width: 200px;
}

.nd-grade {
  width: 100px;
}

.nd-count {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.nd-caption {
  margin: 0;
}

.nd-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-height: 72px;
  padding: 20px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-2);
  text-align: center;
}

.nd-empty p {
  margin: 0;
}

.nd-scroll {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.nd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.nd-table th,
.nd-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
  vertical-align: top;
}

.nd-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.nd-table tbody tr:last-child > td {
  border-bottom: 0;
}

/* 說明與電訪回應可能很長：換行，不把表格撐到無限寬。 */
.nd-table .nd-long {
  min-width: 160px;
  max-width: 280px;
  white-space: normal;
}

.nd-pagination {
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .nd-priority,
  .nd-reason,
  .nd-grade {
    width: 100%;
  }

  .nd-table th,
  .nd-table td {
    padding: 8px 10px;
  }
}
</style>
