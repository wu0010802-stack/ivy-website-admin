import { computed, ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createFromVisitRequest, getOptions, listAdmissionsStaff, listContactLogs, listEvents, listRecords } from '../api/admissions'
import { ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { AdmissionsOptions, AdmissionsStaff, ContactLog, RecruitmentEvent, RecruitmentVisit, VisitRequestFullOut } from '../api/types'
import { notifyError } from './notify'
import { usePermissions } from './usePermissions'
import { useRequestSequence } from './useRequestSequence'

export type AdmissionsAvailability = 'yes' | 'no' | 'unknown'

// 預約明細的招生部分（招生規格第 10 節；2026-10-05 家庭頁規格 5.10 從 VisitDetailView 搬出來）。
// 有 admissions.read 才查；查詢成功＝招生可用、404＝招生未啟用、其他錯誤或沒查＝不確定（標記已到場照舊）。
// 已到場但還沒有招生訪視（上線前的舊預約、或招生訪視被刪掉）時，有 admissions.write 的人可以補建。
// 換案件或狀態變了（例如剛標記已到場）才重查；只是重讀明細不重查。
export function useFamilyAdmissions(detail: Ref<VisitRequestFullOut | null>, hooks: { reloadDetail: () => Promise<void> }) {
  const { can } = usePermissions()
  const canRead = computed(() => can('admissions.read'))
  const canWrite = computed(() => can('admissions.write'))
  const visit = ref<RecruitmentVisit | null>(null)
  const available = ref<AdmissionsAvailability>('unknown')
  const creating = ref(false)
  const requests = useRequestSequence()
  // 家庭版面（2026-10-05 家庭頁規格 5.1）：已到場、招生可用、查得到招生訪視、有 admissions.read。
  const isFamily = computed(() => detail.value?.status === 'completed' && available.value === 'yes' && visit.value !== null && canRead.value)
  const lookupFailed = ref(false)
  const events = ref<RecruitmentEvent[]>([])
  const contactLogs = ref<ContactLog[]>([])
  const staff = ref<AdmissionsStaff[]>([])
  const options = ref<AdmissionsOptions | null>(null)
  const extrasFailed = ref({ events: false, logs: false })
  const extraRequests = useRequestSequence()
  // 進行中的查詢：標記已到場要等它（只在查完仍是 unknown 才沿用舊行為）。
  let pending: Promise<void> | null = null

  async function fetchVisit() {
    const current = detail.value
    const request = requests.begin()
    visit.value = null
    available.value = 'unknown'
    lookupFailed.value = false
    if (!current || !canRead.value) return
    try {
      const rows = await listRecords({ campus_key: current.campus_key, visit_request_id: current.id, page: 1, page_size: 1 })
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      visit.value = Array.isArray(rows) ? (rows[0] ?? null) : null
      available.value = 'yes'
    } catch (err) {
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      // 404：招生入學未啟用，整區不顯示；其他錯誤在已到場的案件上提示讀不到、可以重讀（家庭頁規格 5.9）。
      if (err instanceof ApiError && err.status === 404) available.value = 'no'
      else lookupFailed.value = true
    }
  }

  /**
   * 家庭版面上遇到 409 時重讀招生訪視：不先清空畫面，回來才換掉（開著的對話框與打到一半的內容才不會被卸載）。
   * 失敗就保留現況；跟 lookup 共用請求序號，彼此較晚的才算數。
   */
  async function reload() {
    const current = detail.value
    if (!current || !canRead.value) return
    const request = requests.begin()
    try {
      const rows = await listRecords({ campus_key: current.campus_key, visit_request_id: current.id, page: 1, page_size: 1 })
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      visit.value = Array.isArray(rows) ? (rows[0] ?? null) : null
      if (isFamily.value) await loadExtras()
    } catch {
      // 保留現況；使用者可以再操作一次。
    }
  }

  function lookup(): Promise<void> {
    const run = fetchVisit().finally(() => {
      if (pending === run) pending = null
    })
    pending = run
    return run
  }

  /** 標記已到場前要等的查詢；沒有在查就是 null。 */
  const settled = (): Promise<void> | null => pending

  /** 家庭版面要的招生事件、參觀後聯絡、負責人名單、選項（家庭頁規格 5.4–5.6）。各自失敗互不影響。 */
  async function loadExtras() {
    const current = visit.value
    const request = extraRequests.begin()
    if (!current) return
    const [eventRows, logRows, staffRows, optionRows] = await Promise.allSettled([
      listEvents(current.id),
      listContactLogs(current.id),
      listAdmissionsStaff(current.campus_key),
      getOptions(current.campus_key),
    ])
    if (!extraRequests.isCurrent(request) || visit.value?.id !== current.id) return
    events.value = eventRows.status === 'fulfilled' && Array.isArray(eventRows.value) ? eventRows.value : []
    contactLogs.value = logRows.status === 'fulfilled' && Array.isArray(logRows.value) ? logRows.value : []
    staff.value = staffRows.status === 'fulfilled' && Array.isArray(staffRows.value) ? staffRows.value : []
    options.value = optionRows.status === 'fulfilled' ? optionRows.value : null
    extrasFailed.value = { events: eventRows.status === 'rejected', logs: logRows.status === 'rejected' }
  }

  /** 對話框存檔回傳的新版本；換了一筆（例如下一筆）就不套用。 */
  function replaceVisit(next: RecruitmentVisit) {
    if (visit.value?.id === next.id) visit.value = next
  }

  // 進入家庭版面、或換了一筆招生訪視才讀；離開家庭版面就清掉，下一筆不會看到上一筆的紀錄。
  watch(() => (isFamily.value ? (visit.value?.id ?? '') : ''), (visitId) => {
    if (visitId) {
      void loadExtras()
      return
    }
    extraRequests.begin()
    events.value = []
    contactLogs.value = []
    extrasFailed.value = { events: false, logs: false }
  })

  async function create() {
    const current = detail.value
    if (!current || creating.value) return
    creating.value = true
    try {
      const created = await createFromVisitRequest(current.id)
      if (detail.value?.id !== current.id) return
      visit.value = created
      ElMessage.success('已建立招生訪視')
    } catch (err) {
      notifyError(apiErrorMessage(err, '建立招生訪視失敗'))
      // 409：預約已不是已到場或已匿名化，重讀讓畫面跟上。
      if (err instanceof ApiError && err.status === 409) await hooks.reloadDetail()
    } finally {
      creating.value = false
    }
  }

  watch(() => `${detail.value?.id ?? ''}|${detail.value?.status ?? ''}`, () => void lookup())

  return {
    canRead, canWrite, visit, available, creating, lookup, settled, create,
    reload, isFamily, lookupFailed, events, contactLogs, staff, options, extrasFailed, loadExtras, replaceVisit,
  }
}
