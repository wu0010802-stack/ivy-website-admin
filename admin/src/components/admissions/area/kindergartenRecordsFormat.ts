import { NO_VALUE } from '../../../admissions/statsFormat'
import type { AreaEvaluationLatest, AreaKindergarten, AreaPenaltyRecord } from '../../../api/types'
import { formatCount } from './areaFormat'

// 附近幼兒園的裁罰與評鑑（2026-10-20 規格 C4、C11、C13）。人名一律不顯示：後端本來就沒有姓名，對象只有類別。

/** 規格 C13：清單下方的說明文字。 */
export const RECORDS_NOTE = '裁罰與評鑑是全國教保資訊網公開資料（裁罰經 kiang 整理）。裁罰對象為教保人員個人時，不代表園方受罰；人名一律不顯示。'
export const NO_RECORDS = '無公開紀錄'

export type PenaltyBadge = {
  text: string
  /** recent：近 3 年有裁罰（紅）；older：只有 3 年前的（淡色）；legacy：明細還沒匯入，沿用名單上的旗標。 */
  tone: 'recent' | 'older' | 'legacy'
}

/**
 * 列上的裁罰標籤。裁罰明細匯入過（imported）：近 3 年 N 件（N=0 不顯示）、只有 3 年前的寫「3 年前有裁罰」（淡色）；
 * 還沒匯入過：維持原本 kiang 名單的「有裁罰紀錄」旗標，不能因為新資料還沒來就把舊資訊拿掉。
 */
export function penaltyBadge(item: AreaKindergarten, imported: boolean): PenaltyBadge | null {
  if (!imported) return item.has_penalty ? { text: '有裁罰紀錄', tone: 'legacy' } : null
  if (item.penalties_recent > 0) return { text: `近 3 年裁罰 ${item.penalties_recent} 件`, tone: 'recent' }
  return item.has_older_penalty ? { text: '3 年前有裁罰', tone: 'older' } : null
}

const RESULT_PATTERN = /^(全數指標|部分指標)通過(基礎|追蹤)評鑑$/

/**
 * 評鑑結果的顯示：「全數指標通過追蹤評鑑」→「追蹤評鑑 全數指標通過」，學年度放前面（「112 學年 追蹤評鑑 全數指標通過」）。
 * 不是這個句型的（例如「全數指標改善完畢」）原文照放。
 */
export function evaluationResultText(result: string): string {
  const matched = RESULT_PATTERN.exec(result)
  return matched ? `${matched[2]}評鑑 ${matched[1]}通過` : result
}

/** 列上的評鑑小字（取最近一次）；沒有評鑑回空字串。 */
export function evaluationLine(latest: AreaEvaluationLatest | null | undefined): string {
  return latest ? `${latest.year} 學年 ${evaluationResultText(latest.result)}` : ''
}

/** 2026-01-27 → 2026/01/27（同教保資訊網的寫法）；沒有日期寫「—」。 */
export const slashDate = (iso: string | null | undefined): string => (iso ? iso.replaceAll('-', '/') : NO_VALUE)

const PERIOD_LABELS: Record<string, string> = { stop_enrollment: '停止招生', reduce_enrollment: '減少招收人數', closure: '停辦' }

/** 處分：罰鍰寫金額；停止招生、減少招收人數、停辦寫期間；其他寫來源原文。 */
export function punishmentText(record: AreaPenaltyRecord): string {
  if (record.kind === 'fine') return record.amount === null ? '罰鍰' : `罰鍰 ${formatCount(record.amount)} 元`
  if (record.kind === 'other') return record.punishment_text ?? '其他處分'
  const label = PERIOD_LABELS[record.kind] ?? record.kind
  return record.period_start && record.period_end ? `${label} ${slashDate(record.period_start)}–${slashDate(record.period_end)}` : label
}

/** 規格 C4：行為人（教保人員個人）寫「教保人員個人受罰」，負責人寫「園方受罰」，都不寫人名。 */
export function subjectText(subject: AreaPenaltyRecord['subject']): string {
  if (subject === 'staff') return '教保人員個人受罰'
  return subject === 'operator' ? '園方受罰' : NO_VALUE
}
