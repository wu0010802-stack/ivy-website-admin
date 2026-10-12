// 成效統計各表的「匯出 CSV」共用（2026-10-06）：資料已經在畫面上（去識別的統計數字），
// 在前端組檔，欄名與數字同畫面；檔名與下載失敗的提示在這裡統一。
import { taipeiToday } from '../../admissions/academic'
import { notifyError } from '../../composables/notify'
import { buildCsv, csvFilename, downloadCsv, type CsvCell } from '../../utils/csv'

/** 「成效統計-表名-範圍-期間-今天（台北）」。期間的「/」換成「-」，免得被 csvFilename 清成底線。 */
export function analyticsCsvName(title: string, scope: string, period: string): string {
  return csvFilename('成效統計', title, scope, period.replaceAll('/', '-'), taipeiToday())
}

export function saveAnalyticsCsv(filename: string, header: readonly string[], rows: readonly (readonly CsvCell[])[]): void {
  try {
    downloadCsv(filename, buildCsv(header, rows))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
}
