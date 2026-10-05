import { computed, ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createFromVisitRequest, listRecords } from '../api/admissions'
import { ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import type { RecruitmentVisit, VisitRequestFullOut } from '../api/types'
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
  // 進行中的查詢：標記已到場要等它（只在查完仍是 unknown 才沿用舊行為）。
  let pending: Promise<void> | null = null

  async function fetchVisit() {
    const current = detail.value
    const request = requests.begin()
    visit.value = null
    available.value = 'unknown'
    if (!current || !canRead.value) return
    try {
      const rows = await listRecords({ campus_key: current.campus_key, visit_request_id: current.id, page: 1, page_size: 1 })
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      visit.value = Array.isArray(rows) ? (rows[0] ?? null) : null
      available.value = 'yes'
    } catch (err) {
      if (!requests.isCurrent(request) || detail.value?.id !== current.id) return
      // 404：招生入學未啟用，整區不顯示；其他錯誤讀不到也不影響處理案件。
      if (err instanceof ApiError && err.status === 404) available.value = 'no'
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

  return { canRead, canWrite, visit, available, creating, lookup, settled, create }
}
