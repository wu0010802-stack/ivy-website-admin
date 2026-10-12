import { ref } from 'vue'
import { apiErrorMessage } from '../api/errors'
import { downloadServerCsv } from '../utils/csv'
import { notifyError } from './notify'

/**
 * 後端產生的 CSV（含個資、寫稽核、有筆數上限）的「匯出 CSV」鈕：按下去才組路徑與檔名（拿到的是
 * 當下畫面上的篩選），下載途中不能重按；筆數太多回 422 中文訊息、沒權限回 403，都用提示講清楚，
 * 不產生檔案。訪視明細與未預繳名單共用。
 */
export function useServerCsvExport(target: () => { path: string; filename: string }) {
  const exporting = ref(false)
  async function exportCsv() {
    if (exporting.value) return
    exporting.value = true
    try {
      const { path, filename } = target()
      await downloadServerCsv(path, filename)
    } catch (err) {
      notifyError(apiErrorMessage(err, '匯出失敗，請再試一次。'))
    } finally {
      exporting.value = false
    }
  }
  return { exporting, exportCsv }
}
