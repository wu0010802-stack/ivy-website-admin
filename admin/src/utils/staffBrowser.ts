// 「這台瀏覽器有人登入過後台」的記號（2026-11-20）：登入或恢復登入成功時寫一個 cookie，官網
// （web/shared/staff-browser.ts）讀到就不送第一方成效統計——園方自己看官網、上線驗證、測試預約都不該
// 算進「成效統計」。後台在 admin.ivykidschool.com、官網在 www.ivykidschool.com，所以寫在上層網域；
// 其他主機（本機、Railway 網址）只寫在這個主機（本機各埠共用 cookie，開發機一樣不會送）。
// 值固定是 1、不含帳號；登出不清：同一台瀏覽器之後看官網照樣不算訪客。

/** 名稱要和 web/shared/staff-browser.ts 的 STAFF_COOKIE 一致（staffBrowser.test.ts 會比對）。 */
export const STAFF_COOKIE = 'ivy_staff'
/** 約 400 天：Chrome 允許的 cookie 最長期限；每次登入都會再延長。 */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/** admin.<網域> → <網域>；其他主機回 null（只寫在目前主機）。 */
export function staffCookieDomain(hostname: string): string | null {
  const match = /^admin\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(hostname)
  return match ? match[1]! : null
}

export function staffCookie(location: Pick<Location, 'hostname' | 'protocol'>): string {
  const domain = staffCookieDomain(location.hostname)
  return [
    `${STAFF_COOKIE}=1`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    ...(domain ? [`Domain=${domain}`] : []),
    ...(location.protocol === 'https:' ? ['Secure'] : []),
  ].join('; ')
}

export function markStaffBrowser(target: { location: Pick<Location, 'hostname' | 'protocol'>; document: Pick<Document, 'cookie'> } = window): void {
  try {
    target.document.cookie = staffCookie(target.location)
  } catch {
    // 瀏覽器擋 cookie 時只是官網照常計入這台，不影響登入。
  }
}
