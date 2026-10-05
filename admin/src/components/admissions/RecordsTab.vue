<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import { ArrowDown, ArrowRight, Filter, Plus, Search } from '@element-plus/icons-vue'
import { deleteRecord, getOptions, listAdmissionsStaff, listRecords, type FollowUpScope } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsOptions, AdmissionsStaff, RecruitmentVisit } from '../../api/types'
import { campusLabel, type TagTone } from '../../api/labels'
import { rocDate, termLabel } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, GRADES, MISSING_CHILD_NAME, NO_DEPOSIT_REASONS, SEMESTER_LABELS, WITHDRAWN_FROM_LABELS, stageLabel, type Stage, type TransitionTarget } from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { FOLLOW_UP_SCOPES, FOLLOW_UP_SCOPE_LABELS, followUpText, isDue, ownerLabel } from '../../admissions/followUp'
import { notifyError, notifyWarning } from '../../composables/notify'
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

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const canConvert = computed(() => can('admissions.convert'))
const canSeeBooking = computed(() => can('booking.read'))
// 手機（2026-10-05）改成卡片清單，不再整張表橫捲；篩選只常駐搜尋。
const narrow = useNarrowScreen()

const grade = ref('')
const source = ref('')
const referrer = ref('')
const hasDeposit = ref('')
const noDepositReason = ref('')
// 參觀後追蹤（2026-10-04 規格 7.4）：追蹤狀態與負責人篩選。
const followUp = ref<FollowUpScope | ''>('')
const owner = ref('')
const staff = ref<AdmissionsStaff[]>([])
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
  Boolean(
    props.month || props.visitRequestId || grade.value || source.value || referrer.value || hasDeposit.value || noDepositReason.value
    || keyword.value || followUp.value || owner.value,
  ),
)
// 「清除篩選」連學年學期一起清（同園務），所以有選學年或學期也算有篩選。
const hasFilters = computed(() => filtered.value || props.schoolYear !== null || props.semester !== null || Boolean(search.value))
const hasNext = computed(() => rows.value.length === PAGE_SIZE)

const monthOptions = computed(() => {
  const months = options.value?.months ?? []
  return props.month && !months.includes(props.month) ? [props.month, ...months] : months
})

const emptyText = computed(() => {
  // 後面的頁拿到空列表（最後一頁的資料被刪光）：不是「還沒有訪視」。
  if (page.value > 1) return '這一頁沒有訪視紀錄。'
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
      follow_up: followUp.value || null,
      owner: owner.value || null,
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
  const [result, people] = await Promise.allSettled([getOptions(props.campusKey), listAdmissionsStaff(props.campusKey)])
  if (!optionRequests.isCurrent(request)) return
  // 選項、負責人讀不到只少了下拉建議與名字，列表照常。
  const value = result.status === 'fulfilled' ? result.value : null
  options.value = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  staff.value = people.status === 'fulfilled' && Array.isArray(people.value) ? people.value : []
}

// 換校：來源、介紹者是各校自己的選項，一起清掉。
watch(() => props.campusKey, () => {
  // 上一校的名單不能留在載入遮罩下（同 FunnelBoard）。
  rows.value = []
  options.value = null
  staff.value = []
  source.value = ''
  referrer.value = ''
  owner.value = ''
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
  grade.value, source.value, referrer.value, hasDeposit.value, noDepositReason.value, keyword.value, followUp.value, owner.value,
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
  followUp.value = ''
  owner.value = ''
  clearTimeout(searchTimer)
  search.value = ''
  keyword.value = ''
  emit('update:month', '')
  emit('update:visitRequestId', '')
  emit('clear-term')
}

// ---- 篩選收合（2026-10-05，比照第九輪案件列表）----
// 九個篩選攤開會把表格推到很下面：桌機常駐搜尋、月份、預繳、追蹤，其餘收進「更多篩選」；
// 手機只常駐搜尋。收起時把收進去、已套用的條件列成可以逐一拿掉的標籤，展開時不重複列。
const moreFiltersOpen = ref(false)
const DEPOSIT_LABELS: Record<string, string> = { yes: '是', no: '否' }
const OWNER_FILTER_LABELS: Record<string, string> = { me: '我負責的', none: '未指派' }
interface ActiveFilter { key: string; label: string; clear: () => void }
const hiddenFilters = computed<ActiveFilter[]>(() => {
  const list: ActiveFilter[] = []
  if (narrow.value) {
    if (props.month) list.push({ key: 'month', label: `月份：${props.month}`, clear: () => setMonth('') })
    if (hasDeposit.value) list.push({ key: 'deposit', label: `預繳：${DEPOSIT_LABELS[hasDeposit.value] ?? hasDeposit.value}`, clear: () => { hasDeposit.value = '' } })
    if (followUp.value) list.push({ key: 'followUp', label: `追蹤：${FOLLOW_UP_SCOPE_LABELS[followUp.value]}`, clear: () => { followUp.value = '' } })
  }
  if (grade.value) list.push({ key: 'grade', label: `班別：${grade.value}`, clear: () => { grade.value = '' } })
  if (source.value) list.push({ key: 'source', label: `來源：${source.value}`, clear: () => { source.value = '' } })
  if (referrer.value) list.push({ key: 'referrer', label: `介紹者：${referrer.value}`, clear: () => { referrer.value = '' } })
  if (noDepositReason.value) list.push({ key: 'reason', label: `未預繳原因：${noDepositReason.value}`, clear: () => { noDepositReason.value = '' } })
  if (owner.value) {
    const name = OWNER_FILTER_LABELS[owner.value] ?? ownerLabel(owner.value, staff.value)
    list.push({ key: 'owner', label: `負責人：${name}`, clear: () => { owner.value = '' } })
  }
  return list
})
const showChips = computed(() => !moreFiltersOpen.value && hiddenFilters.value.length > 0)

// ---- 列的呈現 ----
// 「階段」欄取代原本的「預繳」「已註冊」兩欄：預繳欄連已註冊的也寫「是」，看不出走到哪一步。
// 色系同看板欄（灰 → 橙 → 綠）；退出後 has_deposit 已清成 false，寫清楚從哪一段退的（園務總覽第 6 點）。
const STAGE_TONES: Record<Stage, TagTone> = { visited: 'info', deposited: 'warning', enrolled: 'success', withdrawn: 'danger' }

function stageMeta(row: RecruitmentVisit): { label: string; tone: TagTone } {
  if (row.withdrawn_at || row.stage === 'withdrawn') return { label: `已${WITHDRAWN_FROM_LABELS[row.withdrawn_from ?? 'deposited'] ?? '退預繳'}`, tone: 'danger' }
  return { label: stageLabel(row.stage), tone: STAGE_TONES[row.stage] ?? 'info' }
}

function rowClass({ row }: { row: RecruitmentVisit }): string {
  return row.has_deposit ? 'records-row--deposit' : ''
}

// 表格只留追蹤要看的欄；其餘收進展開列（桌機）或卡片的「其他資料」（手機），空值不列。
interface InfoItem { label: string; value: string; wide?: boolean }
function extraInfo(row: RecruitmentVisit): InfoItem[] {
  const items: InfoItem[] = [
    { label: '地址', value: row.address || row.district || '' },
    { label: '介紹者', value: row.referrer ?? '' },
    { label: '收預繳人員', value: row.deposit_collector ?? '' },
    { label: '保留座位', value: row.provisional_grade ?? '' },
    { label: '註冊日期', value: rocDate(row.enrolled_on) },
    { label: '轉學期', value: row.transfer_term ? '是' : '' },
    { label: '未預繳原因', value: [row.no_deposit_reason, row.no_deposit_reason_detail].filter(Boolean).join('：') },
    { label: '退出原因', value: row.withdraw_reason ?? '', wide: true },
    { label: '電訪回應', value: row.parent_response ?? '', wide: true },
    { label: '備註', value: row.notes ?? '', wide: true },
  ]
  return items.filter((item) => item.value)
}
const hasExtraInfo = (row: RecruitmentVisit) => extraInfo(row).length > 0

// Element Plus 繁中語系的展開鈕念的是英文「Expand this row」，這張表自己補中文。
const tableLocale = {
  ...zhTw,
  el: { ...zhTw.el, table: { ...zhTw.el.table, expandRowLabel: '展開其他資料', collapseRowLabel: '收起其他資料' } },
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

// 桌機點姓名、手機按「歷程」（同看板點卡片）。
function openEvents(row: RecruitmentVisit) {
  eventsFor.value = row
  eventsOpen.value = true
}

// ---- 狀態轉換：標記預繳、標記註冊、退出都走看板同一個確認框 ----
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function openTransition(row: RecruitmentVisit, from: Stage, to: Stage) {
  transitionTarget.value = { card: row, from, to }
  transitionOpen.value = true
}

// 依階段的主要動作：已訪視 → 標記預繳（admissions.write）、已預繳 → 標記註冊（admissions.convert，
// 園務「轉為學生」的位置）。已匿名化的列不能再變更。
function stageAction(row: RecruitmentVisit): { label: string; from: Stage; to: Stage } | null {
  if (row.anonymized_at) return null
  if (row.stage === 'visited' && canWrite.value) return { label: '標記預繳', from: 'visited', to: 'deposited' }
  if (row.stage === 'deposited' && canConvert.value) return { label: '標記註冊', from: 'deposited', to: 'enrolled' }
  return null
}

function runStageAction(row: RecruitmentVisit) {
  const action = stageAction(row)
  if (action) openTransition(row, action.from, action.to)
}

function onSaved() {
  void load()
  // 新的月份、來源、介紹者要出現在篩選選項裡。
  void loadOptions()
}

// ---- 列操作：更多 ----
type MoreCommand = 'edit' | 'seat' | 'withdraw' | 'delete'

function needsConvert(row: RecruitmentVisit): boolean {
  return row.stage === 'enrolled' || (row.stage === 'withdrawn' && row.withdrawn_from === 'enrolled')
}

function moreCommands(row: RecruitmentVisit): { command: MoreCommand; label: string }[] {
  const items: { command: MoreCommand; label: string }[] = []
  // 已匿名化的列不能再變更（編輯、退出）；刪除與歷程照常。
  if (!row.anonymized_at) {
    if (canWrite.value) items.push({ command: 'edit', label: '編輯' })
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
  if (command === 'edit') openEdit(row)
  else if (command === 'seat') {
    seatFor.value = row
    seatOpen.value = true
  } else if (command === 'withdraw') openTransition(row, row.stage === 'enrolled' ? 'enrolled' : 'deposited', 'withdrawn')
  else void remove(row)
}

function reportError(err: unknown, fallback: string) {
  if (apiErrorCode(err) === 'RECRUITMENT_VISIT_ANONYMIZED') {
    notifyWarning(ANONYMIZED_CONFLICT_TEXT)
    void load()
    return
  }
  if (isVersionConflict(err)) {
    ElMessage.info(CONFLICT_TEXT)
    void load()
    return
  }
  notifyError(apiErrorMessage(err, fallback))
  // 找不到（別人刪掉了）：重讀，讓那一列消失。
  if (err instanceof ApiError && err.status === 404) void load()
}

// 刪除確認寫出對象與後果；危險色、不預設聚焦、取消鍵「先不要」（第七、九輪）。
function deleteMessage(row: RecruitmentVisit): string {
  const parts = ['歷程與參觀後的聯絡紀錄會一起刪除，統計也不再算這一筆。刪除後無法復原。']
  if (row.visit_request_id) parts.push('官網預約的案件不受影響。')
  return parts.join('')
}

async function remove(row: RecruitmentVisit) {
  const title = row.child_name === MISSING_CHILD_NAME ? '刪除這筆招生訪視？' : `刪除 ${row.child_name} 的招生訪視？`
  try {
    await ElMessageBox.confirm(deleteMessage(row), title, {
      confirmButtonText: '刪除',
      cancelButtonText: '先不要',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
      autofocus: false,
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
    <div class="toolbar records-filters" :class="{ 'is-open': moreFiltersOpen }">
      <div class="filter-field records-filters__search">
        <span>搜尋</span>
        <el-input v-model="search" clearable maxlength="100" :prefix-icon="Search" placeholder="姓名、地址或備註" aria-label="搜尋訪視" />
      </div>
      <template v-if="!narrow">
        <div class="filter-field">
          <span>月份</span>
          <el-select :model-value="month || undefined" clearable filterable placeholder="全部月份" aria-label="月份" @update:model-value="setMonth">
            <el-option v-for="item in monthOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </div>
        <div class="filter-field">
          <span>預繳</span>
          <el-select v-model="hasDeposit" clearable placeholder="不限" aria-label="預繳" class="records-filters__short">
            <el-option label="是" value="yes" />
            <el-option label="否" value="no" />
          </el-select>
        </div>
        <div class="filter-field">
          <span>追蹤</span>
          <el-select v-model="followUp" clearable placeholder="全部" aria-label="追蹤狀態" class="records-filters__short">
            <el-option v-for="item in FOLLOW_UP_SCOPES" :key="item" :label="FOLLOW_UP_SCOPE_LABELS[item]" :value="item" />
          </el-select>
        </div>
      </template>
      <button type="button" class="more-filters" :aria-expanded="moreFiltersOpen" aria-controls="records-more-filters" @click="moreFiltersOpen = !moreFiltersOpen">
        <el-icon aria-hidden="true"><Filter /></el-icon>{{ narrow ? '篩選' : '更多篩選' }}<span v-if="hiddenFilters.length" class="filter-count num">{{ hiddenFilters.length }}<span class="visually-hidden"> 個條件</span></span>
      </button>
      <el-button v-if="hasFilters && !showChips && !narrow" text class="records__clear" @click="clearFilters">清除篩選</el-button>
      <div id="records-more-filters" class="records-filters__more">
        <!-- 手機寬度只夠搜尋＋按鈕：月份、預繳、追蹤也收進來。 -->
        <template v-if="narrow">
          <div class="filter-field">
            <span>月份</span>
            <el-select :model-value="month || undefined" clearable filterable placeholder="全部月份" aria-label="月份" @update:model-value="setMonth">
              <el-option v-for="item in monthOptions" :key="item" :label="item" :value="item" />
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
            <span>追蹤</span>
            <el-select v-model="followUp" clearable placeholder="全部" aria-label="追蹤狀態">
              <el-option v-for="item in FOLLOW_UP_SCOPES" :key="item" :label="FOLLOW_UP_SCOPE_LABELS[item]" :value="item" />
            </el-select>
          </div>
        </template>
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
          <span>未預繳原因</span>
          <el-select v-model="noDepositReason" clearable placeholder="全部原因" aria-label="未預繳原因" class="records-filters__wide">
            <el-option v-for="item in NO_DEPOSIT_REASONS" :key="item" :label="item" :value="item" />
          </el-select>
        </div>
        <div class="filter-field">
          <span>負責人</span>
          <el-select v-model="owner" clearable placeholder="全部" aria-label="追蹤負責人">
            <el-option value="me" label="我負責的" />
            <el-option value="none" label="未指派" />
            <el-option v-for="person in staff" :key="person.id" :value="person.id" :label="person.display_name || person.email" />
          </el-select>
        </div>
        <el-button v-if="narrow && hasFilters" text class="records__clear" @click="clearFilters">清除篩選</el-button>
      </div>
    </div>
    <ul v-if="showChips" class="filter-chips" aria-label="已套用的篩選">
      <li v-for="chip in hiddenFilters" :key="chip.key">
        <button type="button" class="filter-chip" @click="chip.clear()">{{ chip.label }}<span aria-hidden="true" class="filter-chip__x">×</span><span class="visually-hidden">，拿掉這個條件</span></button>
      </li>
      <li><el-button text class="filter-chips__clear" @click="clearFilters">清除篩選</el-button></li>
    </ul>

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

      <template v-if="narrow">
        <div v-loading="loading" class="records-cards-wrap">
          <div v-if="!loading && !rows.length" class="records__empty">
            <strong>{{ emptyText }}</strong>
            <el-button v-if="page > 1" @click="page = 1">回到第 1 頁</el-button>
            <span v-else-if="!filtered" class="hint">手動新增，或在「官網預約」標記家長已到場後，訪視會出現在這裡。</span>
          </div>
          <ul v-else class="records-cards">
            <li v-for="row in rows" :key="row.id" class="record-card" :class="{ 'record-card--deposit': row.has_deposit }">
              <div class="record-card__top">
                <strong class="record-card__name">{{ row.child_name }}</strong>
                <el-tag v-if="row.child_name === MISSING_CHILD_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
                <el-tag v-if="row.anonymized_at" size="small" type="info" effect="plain" round>已匿名化</el-tag>
                <el-tag v-if="row.has_visit_request" size="small" type="primary" effect="plain" round>官網預約</el-tag>
                <router-link v-if="row.visit_request_id && canSeeBooking" :to="`/visit-requests/${row.visit_request_id}`" class="record-card__link">查看預約</router-link>
                <el-tag class="record-card__stage" :type="stageMeta(row).tone" size="small" effect="light" round>{{ stageMeta(row).label }}</el-tag>
              </div>
              <p class="record-card__meta">
                {{ row.grade || '班別未填' }}・<span class="num">{{ termLabel(row.target_school_year, row.target_semester) }}</span>・參觀 <span class="num">{{ rocDate(row.visit_date) || row.month || '—' }}</span>
              </p>
              <p class="record-card__meta">
                下次聯絡 <span class="num" :class="{ 'records__due': isDue(row.follow_up_at) }">{{ row.follow_up_at ? followUpText(row.follow_up_at) : '—' }}</span>・負責人：{{ ownerLabel(row.follow_up_owner_id, staff) }}
              </p>
              <details v-if="hasExtraInfo(row)" class="record-card__info">
                <summary><el-icon class="record-card__chevron" aria-hidden="true"><ArrowRight /></el-icon>其他資料</summary>
                <dl class="records__info">
                  <div v-for="item in extraInfo(row)" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
                </dl>
              </details>
              <div class="record-card__actions">
                <el-button @click="openEvents(row)">歷程</el-button>
                <el-button v-if="stageAction(row)" type="primary" plain :disabled="pendingId === row.id" @click="runStageAction(row)">{{ stageAction(row)!.label }}</el-button>
                <el-dropdown
                  v-if="moreCommands(row).length"
                  trigger="click"
                  placement="bottom-end"
                  :persistent="false"
                  :popper-class="`records-more-menu records-more-menu--${row.id}`"
                  @command="(command: MoreCommand) => onMore(row, command)"
                >
                  <el-button :data-more="row.id" :disabled="pendingId === row.id" :aria-label="`${row.child_name} 的更多動作`">
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
            </li>
          </ul>
        </div>
      </template>

      <el-config-provider v-else :locale="tableLocale">
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
          class="records-table"
          :row-class-name="rowClass"
          :row-expandable="hasExtraInfo"
          :empty-text="loading ? '' : emptyText"
        >
          <template #empty>
            <div v-if="!loading" class="records__empty">
              <strong>{{ emptyText }}</strong>
              <el-button v-if="page > 1" @click="page = 1">回到第 1 頁</el-button>
              <span v-else-if="!filtered" class="hint">手動新增，或在「官網預約」標記家長已到場後，訪視會出現在這裡。</span>
            </div>
          </template>
          <!-- 欄寬以 1280 寬桌機（表格約 962px）不橫捲為準；地址、介紹者、備註等收進展開列。 -->
          <el-table-column type="expand" width="36">
            <template #default="{ row }: { row: RecruitmentVisit }">
              <dl class="records__info records__info--table">
                <div v-for="item in extraInfo(row)" :key="item.label" :class="{ 'records__info-wide': item.wide }"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
              </dl>
            </template>
          </el-table-column>
          <el-table-column label="參觀日期" width="96">
            <template #default="{ row }: { row: RecruitmentVisit }"><span class="num">{{ rocDate(row.visit_date) || row.month || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="姓名" min-width="112">
            <template #default="{ row }: { row: RecruitmentVisit }">
              <!-- 點姓名開歷程（同看板點卡片）；編輯收進「更多」，操作欄才放得下一行。 -->
              <button type="button" class="records__name" @click="openEvents(row)">{{ row.child_name }}<span class="visually-hidden">，查看歷程</span></button>
              <el-tag v-if="row.child_name === MISSING_CHILD_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
              <el-tag v-if="row.anonymized_at" size="small" type="info" effect="plain" round>已匿名化</el-tag>
              <el-tag v-if="row.has_visit_request" size="small" type="primary" effect="plain" round>官網預約</el-tag>
              <router-link v-if="row.visit_request_id && canSeeBooking" :to="`/visit-requests/${row.visit_request_id}`" class="records__link">查看預約</router-link>
            </template>
          </el-table-column>
          <el-table-column label="階段" width="88">
            <template #default="{ row }: { row: RecruitmentVisit }">
              <el-tag :type="stageMeta(row).tone" size="small" effect="light" round>{{ stageMeta(row).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="班別" width="68">
            <template #default="{ row }: { row: RecruitmentVisit }">{{ row.grade || '—' }}</template>
          </el-table-column>
          <el-table-column label="入學學期" width="96">
            <template #default="{ row }: { row: RecruitmentVisit }"><span class="num">{{ termLabel(row.target_school_year, row.target_semester) }}</span></template>
          </el-table-column>
          <el-table-column label="下次聯絡" width="120">
            <template #default="{ row }: { row: RecruitmentVisit }">
              <span v-if="row.follow_up_at" class="num" :class="{ 'records__due': isDue(row.follow_up_at) }">{{ followUpText(row.follow_up_at) }}</span>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="負責人" width="88" show-overflow-tooltip>
            <template #default="{ row }: { row: RecruitmentVisit }">{{ ownerLabel(row.follow_up_owner_id, staff) }}</template>
          </el-table-column>
          <el-table-column label="來源" min-width="92" show-overflow-tooltip>
            <template #default="{ row }: { row: RecruitmentVisit }">{{ row.source || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="164" fixed="right">
            <template #default="{ row }: { row: RecruitmentVisit }">
              <div class="cell-actions records__actions">
                <el-button v-if="stageAction(row)" size="small" type="primary" plain :disabled="pendingId === row.id" @click="runStageAction(row)">{{ stageAction(row)!.label }}</el-button>
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
      </el-config-provider>
      <div v-if="page > 1 || hasNext" class="records__pager">
        <el-button :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint num">第 {{ page }} 頁</span>
        <el-button :disabled="!hasNext || loading" @click="page += 1">下一頁</el-button>
      </div>
    </div>

    <RecordDialog v-model="dialogOpen" :mode="dialogMode" :campus-key="campusKey" :record="editing" :options="options" @saved="onSaved" @stale="load" />
    <EventsDrawer v-model="eventsOpen" :visit-id="eventsFor?.id ?? null" :child-name="eventsFor?.child_name ?? ''" @changed="load" />
    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="load" @stale="load" />
    <SeatDialog v-model="seatOpen" :record="seatFor" @saved="load" @stale="load" />
  </section>
</template>

<style scoped>
.records-filters {
  align-items: flex-end;
}

.records-filters__search .el-input {
  width: 220px;
}

.toolbar .records-filters__short {
  width: 120px;
}

.toolbar .records-filters__wide {
  width: 220px;
}

.records-filters__more {
  display: none;
  flex-basis: 100%;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  padding-top: 4px;
}

.records-filters.is-open .records-filters__more {
  display: flex;
}

.more-filters {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  min-height: var(--control-h);
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-base);
  cursor: pointer;
}

.more-filters:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--ink);
}

.records-filters.is-open .more-filters {
  border-color: var(--el-color-primary);
  color: var(--admin-accent-strong);
}

.filter-count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--admin-accent-hover);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 20px;
  text-align: center;
}

/* 和輸入框底線對齊：篩選欄位上方有標籤，置中會比輸入框高半格。 */
.records__clear {
  align-self: flex-end;
  height: var(--control-h);
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: -4px 0 16px;
  padding: 0;
  list-style: none;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--admin-accent-hover);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.filter-chip:hover {
  border-color: var(--el-color-primary);
}

.filter-chip__x {
  font-size: var(--text-lg);
  line-height: 1;
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

/* 姓名是開歷程的按鈕，長得像連結。有預繳的列是淡綠底，連結色用深一階才夠 4.5:1。 */
.records__name {
  margin: 0 6px 0 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--admin-accent-hover);
  font: inherit;
  font-weight: 500;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.records__name:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.records__name ~ .el-tag {
  margin-right: 4px;
}

.records__link,
.record-card__link {
  color: var(--admin-accent-hover);
}

.records__link {
  display: block;
  margin-top: 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 操作欄固定一行，列高不再忽高忽低；靠右排，沒有主要動作的列「更多」也和上下列對齊。 */
.records__actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  white-space: nowrap;
}

.records__actions .el-button + .el-button {
  margin-left: 0;
}

/* 標記預繳／標記註冊的字用深一階的操作色：--el-color-primary 在淺藍底只有 4.4:1（axe 在手機卡片抓到）。 */
.records :deep(.el-button--primary.is-plain) {
  --el-button-text-color: var(--admin-accent-hover);
}

/* 有預繳的列淡綠底（園務 deposit-row）。 */
.records-table :deep(.records-row--deposit) td.el-table__cell {
  background: var(--el-color-success-light-9);
}

.records__due {
  color: var(--el-color-danger);
  font-weight: 600;
}

/* 展開列與手機「其他資料」：兩欄的定義清單，長文字（備註、電訪回應）占整行。 */
.records__info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 24px;
  margin: 0;
}

.records__info--table {
  padding: 4px 24px 4px 48px;
}

.records__info div {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
}

.records__info .records__info-wide {
  grid-column: 1 / -1;
}

.records__info dt {
  color: var(--ink-3);
}

.records__info dd {
  margin: 0;
  color: var(--ink);
  white-space: pre-line;
  overflow-wrap: anywhere;
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

.records-cards-wrap {
  min-height: 120px;
}

.records-cards {
  margin: 0;
  padding: 0;
  list-style: none;
}

.record-card {
  display: grid;
  gap: 4px;
  padding: 14px 16px;
}

.record-card + .record-card {
  border-top: 1px solid var(--line);
}

.record-card--deposit {
  background: var(--el-color-success-light-9);
}

.record-card__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.record-card__name {
  font-size: var(--text-lg);
  overflow-wrap: anywhere;
}

.record-card__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.record-card__stage {
  margin-left: auto;
}

.record-card__meta {
  margin: 0;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.record-card__info summary {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  color: var(--admin-accent-hover);
  list-style: none;
  cursor: pointer;
}

.record-card__info summary::-webkit-details-marker {
  display: none;
}

.record-card__chevron {
  transition: transform 150ms var(--ease-out);
}

.record-card__info[open] .record-card__chevron {
  transform: rotate(90deg);
}

.record-card__info .records__info {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding-bottom: 8px;
}

.record-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.record-card__actions .el-button + .el-button {
  margin-left: 0;
}

.record-card__actions > .el-button,
.record-card__actions > .el-dropdown {
  flex: 1 1 0;
}

.record-card__actions > .el-dropdown .el-button {
  width: 100%;
}

@media (max-width: 720px) {
  .records-filters__search {
    flex: 1 1 0;
  }

  .records-filters__search .el-input {
    width: 100%;
  }

  .records-filters__more .filter-field {
    flex: 1 1 140px;
  }

  .records-filters__more .el-select {
    width: 100%;
  }

  .filter-chip,
  .filter-chips__clear {
    min-height: 44px;
  }

  .records__pager {
    justify-content: space-between;
  }
}
</style>

<style>
/* 「更多」選單掛在 body 下：刪除用危險色；觸控裝置的選項 44px 高。 */
.records-more-menu .records-more__danger {
  color: var(--el-color-danger);
}

@media (pointer: coarse) {
  .records-more-menu .el-dropdown-menu__item {
    min-height: 44px;
  }
}
</style>
