import { computed, ref } from 'vue'
import { getOptions, listRecords } from '../api/admissions'
import type { AdmissionsOptions, RecruitmentVisit } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { notifyWarning } from './notify'
import { usePermissions } from './usePermissions'

// 標記已到場後接著打開招生資料表單（2026-10-06）：家長到了，當場就能補英文名字、父母職業、帶參觀老師、
// 來源分類、娃娃車這些紙本欄位，不必再到招生入學找這一筆。表單是招生入學的 RecordDialog（編輯模式）：
// 預約上有的資料，後端在同一個交易建立招生訪視時已經帶入（booking_link.fields_from_visit_request）。
// 關掉表單不影響到場與招生訪視，之後仍可在招生入學補。只在招生入學開著、能改招生資料時打開；
// 批次標記不打開（一次會跳好幾個）。

export const ARRIVAL_FORM_CANCEL_TEXT = '之後再填'

export type ArrivalFormResult = 'opened' | 'missing' | 'anonymized' | 'failed'

export function arrivalFormLead(parentName: string): string {
  return `已標記 ${parentName} 已到場。招生資料可以現在填，也可以之後到招生入學補。`
}

interface ArrivedRequest {
  id: string
  campus_key: string
  parent_name: string
}

export function useArrivalAdmissionsForm() {
  const auth = useAuthStore()
  const { can } = usePermissions()
  // 招生入學開著時，標記已到場才會建立招生訪視（後端看部署開關）；表單要能改招生資料才打得開。
  const opensForm = computed(() => Boolean(auth.features.admissions) && can('admissions.write'))
  const open = ref(false)
  const record = ref<RecruitmentVisit | null>(null)
  const options = ref<AdmissionsOptions | null>(null)
  const lead = ref('')

  /**
   * 標記已到場成功之後呼叫：用預約 id 找剛建立的招生訪視，找到就打開表單。
   * justArrived: false＝不是剛標記（案件列表已到場的列「填招生資料」）：表單上方不寫「已標記…已到場」
   * （lead 空白，取消鈕維持「取消」），打不開時也不說「已標記已到場」。預設 true，原本的呼叫端不變。
   * 回傳結果讓呼叫端接著處理：missing＝還沒有招生訪視（招生入學開著之前到場的舊案）。這時不是壞掉，
   * 只是要先建立；說明下一步（案件裡的「建立招生訪視」，同明細），畫面要把案件打開由呼叫端做。
   * anonymized＝已匿名化，後端不接受修改，不打開表單；failed＝讀不到（網路或權限）。
   */
  async function openFor(request: ArrivedRequest, { justArrived = true }: { justArrived?: boolean } = {}): Promise<ArrivalFormResult> {
    const cannotOpen = justArrived
      ? `已標記 ${request.parent_name} 已到場，但招生資料表單打不開；請到招生入學補填`
      : `${request.parent_name} 的招生資料表單打不開；請到招生入學查看`
    let found: RecruitmentVisit | undefined
    let loaded: AdmissionsOptions | null
    try {
      // 選項只用在帶參觀老師建議與來源分類下拉，讀不到也照樣打開表單。
      const [rows, optionRows] = await Promise.all([
        listRecords({ campus_key: request.campus_key, visit_request_id: request.id, page: 1, page_size: 1 }),
        getOptions(request.campus_key).catch(() => null),
      ])
      found = Array.isArray(rows) ? rows[0] : undefined
      loaded = optionRows
    } catch {
      notifyWarning(cannotOpen)
      return 'failed'
    }
    if (!found) {
      notifyWarning(justArrived ? cannotOpen : `${request.parent_name} 已到場，但還沒有招生訪視；請在案件裡按「建立招生訪視」`)
      return 'missing'
    }
    if (found.anonymized_at) {
      notifyWarning(`${request.parent_name} 的招生資料已依保存政策匿名化，不能再修改`)
      return 'anonymized'
    }
    record.value = found
    options.value = loaded
    lead.value = justArrived ? arrivalFormLead(request.parent_name) : ''
    open.value = true
    return 'opened'
  }

  return { opensForm, open, record, options, lead, openFor }
}
