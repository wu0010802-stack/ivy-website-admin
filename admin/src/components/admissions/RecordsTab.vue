<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Plus, Search } from '@element-plus/icons-vue'
import { deleteRecord, getOptions, listRecords, transition, transitionRequest } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsOptions, RecruitmentVisit } from '../../api/types'
import { campusLabel, type TagTone } from '../../api/labels'
import { rocDate, termLabel } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, GRADES, MISSING_CHILD_NAME, NO_DEPOSIT_REASONS, SEMESTER_LABELS, WITHDRAWN_FROM_LABELS, transitionWarning, type TransitionTarget } from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import RecordDialog from './RecordDialog.vue'
import EventsDrawer from './EventsDrawer.vue'
import TransitionDialog from './TransitionDialog.vue'
import SeatDialog from './SeatDialog.vue'

// 訪視明細（園務 RecruitmentDetailTab＋AdmissionsRecordsPanel）。入學學年學期用頁首的篩選，
// 這裡不重複（本檔調整第 11 條）；月份與 vr 由頁面寫進網址（第 15、16 條），其餘篩選只在分頁內。
const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: Semester | null
  month: string
  visitRequestId: string
}>()
const emit = defineEmits<{ 'update:month': [value: string]; 'update:visitRequestId': [value: string]; 'clear-term': [] }>()

const PAGE_SIZE = 50
const CONFLICT_TEXT = '這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作'
// 園務收到 409 的原文（FunnelBoard.vue:240-292）；狀態轉換一律用這句。
const TRANSITION_CONFLICT_TEXT = '狀態已被其他人變更，已自動重新載入'

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const canConvert = computed(() => can('admissions.convert'))
const canSeeBooking = computed(() => can('booking.read'))
// 手機不固定操作欄（同園務），整張表在面板裡受控橫捲。
const narrow = useNarrowScreen()

const grade = ref('')
const source = ref('')
const referrer = ref('')
const hasDeposit = ref('')
const noDepositReason = ref('')
const search = ref('')
const keyword = ref('')
const page = ref(1)

const rows = ref<RecruitmentVisit[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const pendingId = ref<string | null>(null)
const requests = useRequestSequence()

const options = ref<AdmissionsOptions | null>(null)
const optionRequests = useRequestSequence()

// 分頁內的篩選（不含頁首學年學期）：決定空狀態的說法。
const filtered = computed(() =>
  Boolean(props.month || props.visitRequestId || grade.value || source.value || referrer.value || hasDeposit.value || noDepositReason.value || keyword.value),
)
// 「清除篩選」連學年學期一起清（同園務），所以有選學年或學期也算有篩選。
const hasFilters = computed(() => filtered.value || props.schoolYear !== null || props.semester !== null || Boolean(search.value))
const hasNext = computed(() => rows.value.length === PAGE_SIZE)

const monthOptions = computed(() => {
  const months = options.value?.months ?? []
  return props.month && !months.includes(props.month) ? [props.month, ...months] : months
})

const emptyText = computed(() => {
  if (filtered.value) return '目前篩選條件下沒有訪視紀錄。'
  const campus = campusLabel(props.campusKey)
  if (props.schoolYear) return `${campus}在 ${termLabel(props.schoolYear, props.semester)}還沒有招生訪視。`
  if (props.semester) return `${campus}在各學年的${SEMESTER_LABELS[props.semester]}還沒有招生訪視。`
  return `${campus}還沒有招生訪視。`
})

async function load() {
  if (!props.campusKey) return
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await listRecords({
      campus_key: props.campusKey,
      month: props.month || null,
      grade: grade.value || null,
      target_school_year: props.schoolYear,
      target_semester: props.semester,
      source: source.value || null,
      referrer: referrer.value || null,
      has_deposit: hasDeposit.value === 'yes' ? true : hasDeposit.value === 'no' ? false : null,
      no_deposit_reason: noDepositReason.value || null,
      visit_request_id: props.visitRequestId || null,
      q: keyword.value || null,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    if (!requests.isCurrent(request)) return
    rows.value = Array.isArray(result) ? result : []
  } catch {
    if (!requests.isCurrent(request)) return
    rows.value = []
    error.value = '載入明細失敗'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

async function loadOptions() {
  if (!props.campusKey) return
  const request = optionRequests.begin()
  try {
    const result = await getOptions(props.campusKey)
    if (optionRequests.isCurrent(request)) options.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
  } catch {
    // 選項讀不到只少了下拉建議，列表照常。
    if (optionRequests.isCurrent(request)) options.value = null
  }
}

// 換校：來源、介紹者是各校自己的選項，一起清掉。
watch(() => props.campusKey, () => {
  // 上一校的名單不能留在載入遮罩下（同 FunnelBoard、IntakePlanTab）。
  rows.value = []
  options.value = null
  source.value = ''
  referrer.value = ''
  void loadOptions()
}, { immediate: true })

// 搜尋 300ms 防抖（同參觀案件列表）。
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    keyword.value = value.trim()
  }, 300)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

// 條件一變就回第一頁；已經在第一頁就直接重讀（避免同一次變動讀兩次）。
const filterKey = computed(() => JSON.stringify([
  props.campusKey, props.schoolYear, props.semester, props.month, props.visitRequestId,
  grade.value, source.value, referrer.value, hasDeposit.value, noDepositReason.value, keyword.value,
]))
watch(filterKey, () => {
  if (page.value !== 1) page.value = 1
  else void load()
})
watch(page, () => void load())
onMounted(load)

function setMonth(value: string | null | undefined) {
  emit('update:month', value ?? '')
}

function clearFilters() {
  grade.value = ''
  source.value = ''
  referrer.value = ''
  hasDeposit.value = ''
  noDepositReason.value = ''
  clearTimeout(searchTimer)
  search.value = ''
  keyword.value = ''
  emit('update:month', '')
  emit('update:visitRequestId', '')
  emit('clear-term')
}

function depositMeta(row: RecruitmentVisit): { label: string; tone: TagTone } {
  // 退出後 has_deposit 已清成 false，跟「從沒預繳」長得一樣，要另外標（園務總覽第 6 點）。
  if (row.withdrawn_at) return { label: `已${WITHDRAWN_FROM_LABELS[row.withdrawn_from ?? 'deposited'] ?? '退預繳'}`, tone: 'danger' }
  return row.has_deposit ? { label: '是', tone: 'success' } : { label: '否', tone: 'info' }
}

function rowClass({ row }: { row: RecruitmentVisit }): string {
  return row.has_deposit ? 'records-row--deposit' : ''
}

// ---- 表單與歷程 ----
const dialogOpen = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const editing = ref<RecruitmentVisit | null>(null)
const eventsOpen = ref(false)
const eventsFor = ref<RecruitmentVisit | null>(null)

function openAdd() {
  dialogMode.value = 'add'
  editing.value = null
  dialogOpen.value = true
}

function openEdit(row: RecruitmentVisit) {
  dialogMode.value = 'edit'
  editing.value = row
  dialogOpen.value = true
}

function openEvents(row: RecruitmentVisit) {
  eventsFor.value = row
  eventsOpen.value = true
}

// ---- 標記註冊（有 admissions.convert，且已預繳；園務「轉為學生」的位置）----
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function canEnroll(row: RecruitmentVisit): boolean {
  return canConvert.value && row.stage === 'deposited' && !row.anonymized_at
}

function openEnroll(row: RecruitmentVisit) {
  transitionTarget.value = { card: row, from: 'deposited', to: 'enrolled' }
  transitionOpen.value = true
}

function onSaved() {
  void load()
  // 新的月份、來源、介紹者要出現在篩選選項裡。
  void loadOptions()
}

// ---- 列操作：更多 ----
type MoreCommand = 'seat' | 'withdraw' | 'delete'

function needsConvert(row: RecruitmentVisit): boolean {
  return row.stage === 'enrolled' || (row.stage === 'withdrawn' && row.withdrawn_from === 'enrolled')
}

function moreCommands(row: RecruitmentVisit): { command: MoreCommand; label: string }[] {
  const items: { command: MoreCommand; label: string }[] = []
  // 已匿名化的列不能再變更（退出）；刪除與歷程照常。
  if (!row.anonymized_at) {
    // 保留座位只給已預繳、未註冊、未退出（規格 6.5）；已註冊不能清除保留，要改年級請先取消註冊。
    if (row.stage === 'deposited' && canWrite.value) items.push({ command: 'seat', label: row.provisional_grade ? '變更座位' : '保留座位' })
    // 退預繳要 write、退註冊要 convert（規格 6.3）；已訪視沒有可退的款項（園務 :610）。
    if (row.stage === 'deposited' && canWrite.value) items.push({ command: 'withdraw', label: '退預繳' })
    if (row.stage === 'enrolled' && canConvert.value) items.push({ command: 'withdraw', label: '退註冊' })
  }
  // 官網沒有學生檔，刪除已註冊或從已註冊退出的訪視等於退註冊，要 admissions.convert（後端 403，調整第 34 條）。
  if (canWrite.value && (!needsConvert(row) || canConvert.value)) items.push({ command: 'delete', label: '刪除' })
  return items
}

const seatOpen = ref(false)
const seatFor = ref<RecruitmentVisit | null>(null)

function onMore(row: RecruitmentVisit, command: MoreCommand) {
  if (command === 'seat') {
    seatFor.value = row
    seatOpen.value = true
  } else if (command === 'withdraw') void withdraw(row)
  else void remove(row)
}

function reportError(err: unknown, fallback: string, conflictText = CONFLICT_TEXT) {
  if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') {
    ElMessage.warning(ANONYMIZED_CONFLICT_TEXT)
    void load()
    return
  }
  if (isVersionConflict(err)) {
    ElMessage.info(conflictText)
    void load()
    return
  }
  ElMessage.error(apiErrorMessage(err, fallback))
  // 找不到（別人刪掉了）：重讀，讓那一列消失。
  if (err instanceof ApiError && err.status === 404) void load()
}

// 退出（園務 AdmissionsRecordsPanel.vue:128-166 的 prompt；文案依本檔調整第 9 條改寫）。
async function withdraw(row: RecruitmentVisit) {
  const from = row.stage === 'enrolled' ? 'enrolled' : 'deposited'
  const title = from === 'enrolled' ? '退註冊' : '退預繳'
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(`${transitionWarning(from, 'withdrawn')}。`, title, {
      confirmButtonText: '確認退出',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '請說明原因（必填）',
      inputValidator: (value: string) => Boolean(value && value.trim()) || '請填寫原因',
      type: 'warning',
    })
    reason = ((result as { value?: string }).value ?? '').trim()
  } catch {
    return
  }
  pendingId.value = row.id
  try {
    await transition(row.id, transitionRequest('withdrawn', row.version, { reason }))
    ElMessage.success(from === 'enrolled' ? '已退註冊' : '已退預繳')
    await load()
  } catch (err) {
    reportError(err, '退出失敗', TRANSITION_CONFLICT_TEXT)
  } finally {
    pendingId.value = null
  }
}

async function remove(row: RecruitmentVisit) {
  try {
    await ElMessageBox.confirm(`確定刪除此筆記錄？「${row.child_name}」的歷程會一起刪除，無法復原。`, '確認', {
      confirmButtonText: '刪除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    })
  } catch {
    return
  }
  pendingId.value = row.id
  try {
    await deleteRecord(row.id, row.version)
    ElMessage.success('刪除成功')
    await load()
  } catch (err) {
    reportError(err, '刪除失敗')
  } finally {
    pendingId.value = null
  }
}
</script>

<template>
  <section class="records">
    <div class="toolbar records__filters">
      <div class="filter-field">
        <span>月份</span>
        <el-select :model-value="month || undefined" clearable filterable placeholder="全部月份" aria-label="月份" @update:model-value="setMonth">
          <el-option v-for="item in monthOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>班別</span>
        <el-select v-model="grade" clearable placeholder="全部班別" aria-label="班別">
          <el-option v-for="item in GRADES" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>來源</span>
        <el-select v-model="source" clearable filterable placeholder="全部來源" aria-label="來源">
          <el-option v-for="item in options?.sources ?? []" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>介紹者</span>
        <el-select v-model="referrer" clearable filterable placeholder="全部介紹者" aria-label="介紹者">
          <el-option v-for="item in options?.referrers ?? []" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>預繳</span>
        <el-select v-model="hasDeposit" clearable placeholder="不限" aria-label="預繳">
          <el-option label="是" value="yes" />
          <el-option label="否" value="no" />
        </el-select>
      </div>
      <div class="filter-field">
        <span>未預繳原因</span>
        <el-select v-model="noDepositReason" clearable placeholder="全部原因" aria-label="未預繳原因">
          <el-option v-for="item in NO_DEPOSIT_REASONS" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field records__search">
        <span>搜尋</span>
        <el-input v-model="search" clearable maxlength="100" :prefix-icon="Search" placeholder="姓名/地址/備註搜尋..." aria-label="搜尋訪視" />
      </div>
      <el-button v-if="hasFilters" text class="records__clear" @click="clearFilters">清除篩選</el-button>
    </div>

    <el-alert v-if="visitRequestId" type="info" :closable="false" show-icon class="records__notice" title="只顯示這筆官網預約建立的招生訪視。">
      <el-button size="small" @click="emit('update:visitRequestId', '')">顯示全部</el-button>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="records__notice">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div v-else class="panel" :aria-busy="loading">
      <div class="panel__head">
        <h2>訪視明細</h2>
        <div class="records__head-actions">
          <!-- 沒資料時不寫「本頁 0 筆」：空狀態已經說明原因，不顯示假的 0。 -->
          <span v-if="loading || rows.length" class="hint num">{{ loading ? '載入中…' : `本頁 ${rows.length} 筆` }}</span>
          <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openAdd">新增訪視</el-button>
        </div>
      </div>
      <el-table v-loading="loading" :data="rows" class="records-table" :row-class-name="rowClass" :empty-text="loading ? '' : emptyText">
        <template #empty>
          <div v-if="!loading" class="records__empty">
            <strong>{{ emptyText }}</strong>
            <span v-if="!filtered" class="hint">手動新增，或在「官網預約」標記家長已到場後，訪視會出現在這裡。</span>
          </div>
        </template>
        <el-table-column label="參觀日期" width="100">
          <template #default="{ row }: { row: RecruitmentVisit }"><span class="num">{{ rocDate(row.visit_date) || row.month || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="姓名" min-width="150">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <span class="records__name">{{ row.child_name }}</span>
            <el-tag v-if="row.child_name === MISSING_CHILD_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
            <el-tag v-if="row.anonymized_at" size="small" type="info" effect="plain" round>已匿名化</el-tag>
            <el-tag v-if="row.has_visit_request" size="small" type="primary" effect="plain" round>官網預約</el-tag>
            <router-link v-if="row.visit_request_id && canSeeBooking" :to="`/visit-requests/${row.visit_request_id}`" class="records__link">查看預約</router-link>
          </template>
        </el-table-column>
        <el-table-column label="班別" width="80">
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.grade || '—' }}</template>
        </el-table-column>
        <el-table-column label="入學學期" width="108">
          <template #default="{ row }: { row: RecruitmentVisit }"><span class="num">{{ termLabel(row.target_school_year, row.target_semester) }}</span></template>
        </el-table-column>
        <el-table-column label="預繳" width="96">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <el-tag :type="depositMeta(row).tone" size="small" effect="light" round>{{ depositMeta(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="地址" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.address || row.district || '—' }}</template>
        </el-table-column>
        <el-table-column label="來源" min-width="120" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.source || '—' }}</template>
        </el-table-column>
        <el-table-column label="介紹者" width="100" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.referrer || '—' }}</template>
        </el-table-column>
        <el-table-column label="已註冊" width="80">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <el-tag v-if="row.enrolled" type="success" size="small" effect="light" round>是</el-tag><span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="轉學期" width="80">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <el-tag v-if="row.transfer_term" type="warning" size="small" effect="light" round>是</el-tag><span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="未預繳原因" min-width="150" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.no_deposit_reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="備註" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.notes || '—' }}</template>
        </el-table-column>
        <el-table-column label="電訪回應" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: RecruitmentVisit }">{{ row.parent_response || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" :fixed="narrow ? false : 'right'">
          <template #default="{ row }: { row: RecruitmentVisit }">
            <div class="cell-actions records__actions">
              <el-button v-if="canWrite && !row.anonymized_at" size="small" text type="primary" :disabled="pendingId === row.id" @click="openEdit(row)">編輯</el-button>
              <el-button size="small" text @click="openEvents(row)">歷程</el-button>
              <el-button v-if="canEnroll(row)" size="small" text type="success" :disabled="pendingId === row.id" @click="openEnroll(row)">標記註冊</el-button>
              <el-dropdown
                v-if="moreCommands(row).length"
                trigger="click"
                placement="bottom-end"
                :persistent="false"
                :popper-class="`records-more-menu records-more-menu--${row.id}`"
                @command="(command: MoreCommand) => onMore(row, command)"
              >
                <el-button size="small" text :data-more="row.id" :disabled="pendingId === row.id" :aria-label="`${row.child_name} 的更多動作`">
                  更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-for="item in moreCommands(row)"
                      :key="item.command"
                      :command="item.command"
                      :divided="item.command === 'delete' && moreCommands(row).length > 1"
                      :class="{ 'records-more__danger': item.command === 'delete' }"
                    >{{ item.label }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="page > 1 || hasNext" class="records__pager">
        <el-button :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint num">第 {{ page }} 頁</span>
        <el-button :disabled="!hasNext || loading" @click="page += 1">下一頁</el-button>
      </div>
    </div>

    <RecordDialog v-model="dialogOpen" :mode="dialogMode" :campus-key="campusKey" :record="editing" :options="options" @saved="onSaved" @stale="load" />
    <EventsDrawer v-model="eventsOpen" :visit-id="eventsFor?.id ?? null" :child-name="eventsFor?.child_name ?? ''" />
    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="load" @stale="load" />
    <SeatDialog v-model="seatOpen" :record="seatFor" @saved="load" @stale="load" />
  </section>
</template>

<style scoped>
.records__filters {
  align-items: flex-end;
}

.records__search .el-input {
  width: 220px;
}

.records__clear {
  margin-bottom: 2px;
}

.records__notice {
  margin-bottom: 16px;
}

.records__head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.records__name {
  margin-right: 6px;
  overflow-wrap: anywhere;
}

.records__name + .el-tag,
.records__name + .el-tag + .el-tag {
  margin-right: 4px;
}

.records__link {
  display: block;
  margin-top: 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.records__actions {
  flex-wrap: wrap;
}

.records__actions .el-button + .el-button {
  margin-left: 0;
}

/* 有預繳的列淡綠底（園務 deposit-row）。 */
.records-table :deep(.records-row--deposit) td.el-table__cell {
  background: var(--el-color-success-light-9);
}

.records__empty {
  display: grid;
  gap: 6px;
  padding: 24px 16px;
  color: var(--ink-2);
  line-height: 1.6;
  text-align: center;
}

.records__pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

@media (max-width: 720px) {
  .records__search,
  .records__search .el-input {
    width: 100%;
  }

  .records__pager {
    justify-content: space-between;
  }
}
</style>

<style>
/* 「更多」選單掛在 body 下：刪除用危險色。 */
.records-more-menu .records-more__danger {
  color: var(--el-color-danger);
}
</style>
