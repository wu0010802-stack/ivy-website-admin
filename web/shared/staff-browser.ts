/**
 * 「這台瀏覽器有人登入過後台」的記號（2026-11-20）。後台登入成功時寫在上層網域（admin.ivykidschool.com →
 * ivykidschool.com），官網讀到就不送第一方成效統計（瀏覽、速度、內容興趣、預約鈕點擊）：園方自己看官網、
 * 上線驗證、測試預約都不該算進後台「成效統計」。GA／Pixel 等外部統計不看這個記號。
 * 不是 HttpOnly（官網要用 JS 讀）、值固定是 1、不含帳號。後台寫入的地方是 admin/src/utils/staffBrowser.ts，
 * 名稱要兩邊一致（admin 的 staffBrowser.test.ts 會比對）。
 */
export const STAFF_COOKIE = 'ivy_staff'

export function isStaffBrowser(cookie: string): boolean {
  return cookie.split(';').some((part) => part.trim() === `${STAFF_COOKIE}=1`)
}
