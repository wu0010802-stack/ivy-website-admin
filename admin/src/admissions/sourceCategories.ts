// 來源分類（2026-10-06 收斂）：資料庫、API、匯出照存園務九類代碼（constants.py SOURCE_CATEGORIES，
// 也就是園務招生獎金的點數目錄），表單只列這六個「孩子從哪裡來」，文字縮短。不列的三類是獎金怎麼分
// （在校兄姊二人均分、邀約來園——原本招生人、到家中收預繳），官網不算獎金；舊資料選過的照樣顯示園務原文。
export const SOURCE_CATEGORY_CHOICES = [
  ['sibling_current', '在校生弟妹'],
  ['sibling_graduate', '畢業生弟妹'],
  ['referral', '家長介紹／社區招生'],
  ['self_report', '自報生（廣告、鄰居、網路、活動）'],
  ['invite_success', '邀約來園'],
  ['returning', '舊生復學'],
] as const

const SHORT_LABELS: Record<string, string> = Object.fromEntries(SOURCE_CATEGORY_CHOICES)

// 顯示文字：六項用短標籤，其餘用 options.source_categories 的園務原文，都查不到就顯示代碼。
export function sourceCategoryLabel(code: string, ivyLabels?: Record<string, string> | null): string {
  return SHORT_LABELS[code] ?? ivyLabels?.[code] ?? code
}

// 表單下拉：六項；這筆正在用不列的類別時附在最後，下拉才顯示得出文字，也不會被默默清掉。
export function sourceCategoryOptions(inUse: (string | null | undefined)[], ivyLabels?: Record<string, string> | null): [string, string][] {
  const items: [string, string][] = SOURCE_CATEGORY_CHOICES.map(([code, label]) => [code, label])
  for (const code of new Set(inUse)) {
    if (code && !(code in SHORT_LABELS)) items.push([code, sourceCategoryLabel(code, ivyLabels)])
  }
  return items
}
