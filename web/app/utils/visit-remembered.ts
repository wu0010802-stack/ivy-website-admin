// 這台裝置記住的預約（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §3）。
// 後端發的 cookie：正式站 __Host-ivy_visit_remember（host_cookies 加前綴），其他環境 ivy_visit_remember。

export const VISIT_REMEMBERED_HINT = 'visit-remembered-hint'
const COOKIE = /(?:^|;\s*)(?:__Host-)?ivy_visit_remember=[^;]/

export function hasRememberedVisitCookie(header: string | undefined | null): boolean {
  return COOKIE.test(header ?? '')
}
