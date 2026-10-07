import type { DraftBaseline, FieldChange } from './useContentItem'

// 內容編輯底部動作列的那一句（2026-10-06 方向 D）：直接寫「草稿有 N 處修改：欄位A、欄位B」，
// 發布前不用另開差異框。比對基準見 useContentItem 的 DraftBaseline。

/** 動作列一次最多寫幾個欄位名，其餘收成「…」（完整清單放在 title）。 */
export const SUMMARY_MAX_FIELDS = 4

export interface DraftSummary {
  /** 「草稿有 2 處修改：」「改了 1 個欄位：」或一整句說明 */
  lead: string
  /** 欄位名，用「、」串；沒有就是空字串 */
  fields: string
  /** 完整欄位清單（滑過去看得到）；沒有就是空字串 */
  title: string
}

export function fieldList(changes: readonly FieldChange[], max = SUMMARY_MAX_FIELDS): string {
  const labels = changes.map((c) => c.label)
  return labels.length > max ? `${labels.slice(0, max).join('、')}…` : labels.join('、')
}

export function draftSummary(source: DraftBaseline['source'], changes: readonly FieldChange[], dirty: boolean): DraftSummary | null {
  const title = changes.map((c) => c.label).join('、')
  if (source === 'first') return { lead: '還沒發布過，發布後家長才會看到這份內容。', fields: '', title: '' }
  if (source === 'live') {
    if (changes.length) return { lead: `草稿有 ${changes.length} 處修改：`, fields: fieldList(changes), title }
    return dirty ? { lead: '內容和官網目前的一樣，還沒儲存。', fields: '', title: '' } : null
  }
  if (!dirty) return null
  return changes.length ? { lead: `改了 ${changes.length} 個欄位：`, fields: fieldList(changes), title } : { lead: '有未儲存的修改。', fields: '', title: '' }
}
