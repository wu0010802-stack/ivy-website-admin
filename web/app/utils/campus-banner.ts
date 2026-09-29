import type { BookingContent } from '../types/site-content'

// 分校頁底部的預約橫幅（CampusPageMain 的 `.visit-banner`）。文字讀後台「預約文案
// → 分校頁底部的預約橫幅」三欄（2026-09-29 業主同意接上官網）；以前是寫死的字。
// 欄位空白時退回原本的字——內建預設內容與這三句相同，預設內容下畫面不變。
export const CAMPUS_BANNER_FALLBACK = {
  titleTemplate: '親自走一趟，感受{campusNameOrIvy}的日常。',
  body: '帶著孩子，也帶著你想了解的事。我們期待與你相遇。',
  buttonLabel: '預約校園參觀'
} as const

// 後台說明寫的是 {campusNameOrIvy}；{campus} 比較直覺，園方手打時也當成校名。
const CAMPUS_NAME_TOKEN = /\{(?:campusNameOrIvy|campus)\}/g

export type CampusBannerSource = Pick<BookingContent, 'bannerTitleTemplate' | 'bannerBody' | 'bannerButtonLabel'>

export interface CampusBannerCopy {
  title: string
  body: string
  buttonLabel: string
}

function filled(value: string | null | undefined, fallback: string): string {
  const text = value?.trim()
  return text ? text : fallback
}

export function campusBannerCopy(booking: Partial<CampusBannerSource> | null | undefined, campusName: string): CampusBannerCopy {
  const template = filled(booking?.bannerTitleTemplate, CAMPUS_BANNER_FALLBACK.titleTemplate)
  return {
    // 用函式替換：校名裡若有 `$&` 之類的字，字串替換會被當成特殊樣式。
    title: template.replace(CAMPUS_NAME_TOKEN, () => campusName),
    body: filled(booking?.bannerBody, CAMPUS_BANNER_FALLBACK.body),
    buttonLabel: filled(booking?.bannerButtonLabel, CAMPUS_BANNER_FALLBACK.buttonLabel)
  }
}
