import { taipeiYmd } from './admission-classes'

type Ymd = ReturnType<typeof taipeiYmd>

/**
 * 常春藤營養餐點書（舊官網「幼兒餐點」頁嵌的 FlipBuilder 電子書）。
 * 2026-09-25 使用者裁定：菜單直接導向這本書，不抄菜色進網站；常春藤環境頁的按鈕
 * 依台北日期開到當月那一頁。書改版、頁數位移時只要改 MONTH_PAGE。
 */
export const MEAL_BOOK_URL = 'https://online.flipbuilder.com/nrpb/toby/index.html'

/** 每月一頁：1–6 月第 10–15 頁，7–12 月第 17–22 頁（第 16 頁是文章）。2026-09-25 逐頁核對。 */
const MONTH_PAGE = [10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22] as const

export function mealBookLink(when: Date | Ymd = new Date()) {
  const month = when instanceof Date ? taipeiYmd(when).month : when.month
  const page = MONTH_PAGE[month - 1]!
  return { month, page, href: `${MEAL_BOOK_URL}#p=${page}`, label: `看 ${month} 月菜單` }
}
