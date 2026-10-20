// 成效統計（招生統計頁的預約統計分頁）專用的標籤。2026-10-20 從 labels.ts 拆出，
// 不跟著側欄進首次載入；來源與「怎麼知道我們」的標籤表仍在 labels.ts（案件頁也用）。
import { REFERRAL_SOURCE_LABELS, visitSourceLabel } from './labels'

// 成效統計（/admin/analytics/funnel）。unknown 是 2026-09-25 以前沒有記錄
// 來源、原因或入口的舊事件。
export const ANALYTICS_UNKNOWN = 'unknown'

// 公開點擊的入口代碼：按鈕在官網哪個區塊。要和後端 operations/models.py 的
// CTA_ENTRIES 一致（labelCoverage 測試會比對）。
export const CTA_ENTRY_LABELS: Record<string, string> = {
  header: '頁首預約鈕',
  menu: '選單面板',
  footer: '頁尾',
  home_campus_board: '首頁五校卡',
  campus_hero: '分校頁首屏',
  campus_info: '分校頁「來認識」',
  campus_contact: '分校頁交通與聯絡',
  campus_banner: '分校頁底部預約橫幅',
  campus_tour: '分校頁校園照片',
  admission: '入學資訊頁',
  environment: '常春藤環境頁',
  curriculum: '特色教學頁',
  about: '關於常春藤頁',
  news: '最新消息頁',
  anniversary: '30 週年頁',
  visit_page: '預約頁',
  visit_manage: '查詢／取消預約頁',
  other: '其他位置',
  unknown: '未記錄入口',
}

export function ctaEntryLabel(entry: string): string {
  return CTA_ENTRY_LABELS[entry] ?? entry
}

// visit_cancelled 的取消原因（後端 CANCEL_REASONS）。
export const CANCEL_REASON_LABELS: Record<string, string> = {
  parent: '家長自行取消',
  staff: '園方取消',
  hold_expired: '待確認逾期',
  unknown: '未記錄原因',
}

export function cancelReasonLabel(reason: string): string {
  return CANCEL_REASON_LABELS[reason] ?? reason
}

export function funnelSourceLabel(source: string): string {
  return source === ANALYTICS_UNKNOWN ? '未記錄來源' : visitSourceLabel(source)
}

export function funnelReferralLabel(referral: string): string {
  if (referral === ANALYTICS_UNKNOWN) return '未記錄'
  if (referral === 'none') return '未填寫'
  return REFERRAL_SOURCE_LABELS[referral] ?? referral
}
