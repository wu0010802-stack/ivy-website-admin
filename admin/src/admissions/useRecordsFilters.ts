import { computed, ref, watch, type Ref } from 'vue'
import type { FollowUpScope, RecordFilters } from '../api/admissions'
import type { AdmissionsStaff } from '../api/types'
import { useDebouncedFn } from '../composables/useDebouncedFn'
import { areaApiParams, areaQuery, parseAreaQuery } from './areaFilter'
import { withdrawFilterLabel } from './constants'
import { FOLLOW_UP_SCOPE_LABELS, ownerLabel } from './followUp'
import type { Semester } from './useAdmissionsFilters'

// 訪視明細（RecordsTab）的篩選（2026-10-20 從 RecordsTab.vue 抽出，行為不變）：分頁內的篩選、
// 送給列表與 CSV 匯出的同一組條件、收合後的已套用標籤與「清除篩選」。月份、vr、區域、退出原因
// 由頁面寫進網址，這裡只讀 props、改的時候交給 updates 往上通知。

/** RecordsTab 的 props 裡和篩選有關的部分。 */
export interface RecordsFilterProps {
  campusKey: string
  schoolYear: number | null
  semester: Semester | null
  month: string
  visitRequestId: string
  area?: string
  withdrawCategory?: string
}

/** 網址上的條件由頁面持有：改的時候往上通知（對應 RecordsTab 的 update:* 與 clear-term）。 */
export interface RecordsFilterUpdates {
  month: (value: string) => void
  visitRequestId: (value: string) => void
  area: (value: string) => void
  withdrawCategory: (value: string) => void
  clearTerm: () => void
}

export interface ActiveFilter { key: string; label: string; clear: () => void }

const DEPOSIT_LABELS: Record<string, string> = { yes: '是', no: '否' }
const OWNER_FILTER_LABELS: Record<string, string> = { me: '我負責的', none: '未指派' }

export function useRecordsFilters(
  props: RecordsFilterProps,
  updates: RecordsFilterUpdates,
  options: { narrow: Ref<boolean>; staff: Ref<AdmissionsStaff[]> },
) {
  const { narrow, staff } = options
  const grade = ref('')
  const source = ref('')
  const referrer = ref('')
  const hasDeposit = ref('')
  const noDepositReason = ref('')
  // 參觀後追蹤（2026-10-04 規格 7.4）：追蹤狀態與負責人篩選。
  const followUp = ref<FollowUpScope | ''>('')
  const owner = ref('')
  const search = ref('')
  const keyword = ref('')
  const areaFilter = computed(() => parseAreaQuery(props.area))

  // 分頁內的篩選（不含頁首學年學期）：決定空狀態的說法。
  const filtered = computed(() =>
    Boolean(
      props.month || props.visitRequestId || areaFilter.value || grade.value || source.value || referrer.value || hasDeposit.value || noDepositReason.value
      || props.withdrawCategory || keyword.value || followUp.value || owner.value,
    ),
  )
  // 「清除篩選」連學年學期一起清（同園務），所以有選學年或學期也算有篩選。
  const hasFilters = computed(() => filtered.value || props.schoolYear !== null || props.semester !== null || Boolean(search.value))

  // 列表與 CSV 匯出送同一組篩選：畫面上篩好什麼，匯出的就是那一批（同參觀案件）。
  // 新增篩選只改這裡，兩邊才不會各寫一份而漏掉（追蹤、負責人就差點漏）。
  function currentFilters(): RecordFilters {
    return {
      campus_key: props.campusKey,
      month: props.month || null,
      grade: grade.value || null,
      target_school_year: props.schoolYear,
      target_semester: props.semester,
      source: source.value || null,
      referrer: referrer.value || null,
      has_deposit: hasDeposit.value === 'yes' ? true : hasDeposit.value === 'no' ? false : null,
      no_deposit_reason: noDepositReason.value || null,
      withdraw_reason_category: props.withdrawCategory || null,
      visit_request_id: props.visitRequestId || null,
      q: keyword.value || null,
      follow_up: followUp.value || null,
      owner: owner.value || null,
      ...areaApiParams(areaFilter.value),
    }
  }

  // 搜尋 300ms 防抖（同參觀案件列表）。
  const applySearch = useDebouncedFn((value: string) => {
    keyword.value = value.trim()
  }, 300)
  watch(search, (value) => applySearch(value))

  // 條件一變就回第一頁（RecordsTab 監聽這個鍵）。
  // 區域用解析後的篩選：網址手改成認不得的寫法（視同沒篩）不會被當成條件變動而重讀、把頁碼拉回第一頁。
  const filterKey = computed(() => JSON.stringify([
    props.campusKey, props.schoolYear, props.semester, props.month, props.visitRequestId, areaFilter.value ? areaQuery(areaFilter.value) : '',
    grade.value, source.value, referrer.value, hasDeposit.value, noDepositReason.value, props.withdrawCategory ?? '', keyword.value, followUp.value, owner.value,
  ]))

  function setMonth(value: string | null | undefined) {
    updates.month(value ?? '')
  }

  function setWithdrawCategory(value: string | null | undefined) {
    updates.withdrawCategory(value ?? '')
  }

  function clearFilters() {
    grade.value = ''
    source.value = ''
    referrer.value = ''
    hasDeposit.value = ''
    noDepositReason.value = ''
    followUp.value = ''
    owner.value = ''
    applySearch.cancel()
    search.value = ''
    keyword.value = ''
    updates.month('')
    updates.visitRequestId('')
    updates.area('')
    updates.withdrawCategory('')
    updates.clearTerm()
  }

  // ---- 篩選收合（2026-10-05，比照第九輪案件列表）----
  // 九個篩選攤開會把表格推到很下面：桌機常駐搜尋、月份、預繳、追蹤，其餘收進「更多篩選」；
  // 手機只常駐搜尋。收起時把收進去、已套用的條件列成可以逐一拿掉的標籤，展開時不重複列。
  const moreFiltersOpen = ref(false)
  const hiddenFilters = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = []
    if (narrow.value) {
      if (props.month) list.push({ key: 'month', label: `月份：${props.month}`, clear: () => setMonth('') })
      if (hasDeposit.value) list.push({ key: 'deposit', label: `預繳：${DEPOSIT_LABELS[hasDeposit.value] ?? hasDeposit.value}`, clear: () => { hasDeposit.value = '' } })
      if (followUp.value) list.push({ key: 'followUp', label: `追蹤：${FOLLOW_UP_SCOPE_LABELS[followUp.value]}`, clear: () => { followUp.value = '' } })
    }
    if (grade.value) list.push({ key: 'grade', label: `班別：${grade.value}`, clear: () => { grade.value = '' } })
    if (source.value) list.push({ key: 'source', label: `來源：${source.value}`, clear: () => { source.value = '' } })
    if (referrer.value) list.push({ key: 'referrer', label: `家長介紹：${referrer.value}`, clear: () => { referrer.value = '' } })
    if (noDepositReason.value) list.push({ key: 'reason', label: `未預繳原因：${noDepositReason.value}`, clear: () => { noDepositReason.value = '' } })
    if (props.withdrawCategory) list.push({ key: 'withdraw', label: `退出原因：${withdrawFilterLabel(props.withdrawCategory)}`, clear: () => setWithdrawCategory('') })
    if (owner.value) {
      const name = OWNER_FILTER_LABELS[owner.value] ?? ownerLabel(owner.value, staff.value)
      list.push({ key: 'owner', label: `負責人：${name}`, clear: () => { owner.value = '' } })
    }
    return list
  })
  const showChips = computed(() => !moreFiltersOpen.value && hiddenFilters.value.length > 0)

  return {
    grade, source, referrer, hasDeposit, noDepositReason, followUp, owner, search, keyword, areaFilter,
    filtered, hasFilters, currentFilters, filterKey, setMonth, setWithdrawCategory, clearFilters,
    moreFiltersOpen, hiddenFilters, showChips,
  }
}
