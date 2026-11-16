// 記住家長看過的校區（cookie ivy_campus，2026-11-16）的純函式；cookie 的讀寫在 composables/useRememberedCampus.ts。
// 這是功能偏好、不是追蹤：不看 DNT／GPC，也不送到任何第三方。

export const REMEMBERED_CAMPUS_COOKIE = 'ivy_campus'
/** 180 天。 */
export const REMEMBERED_CAMPUS_MAX_AGE = 180 * 24 * 60 * 60

/** 不寫入的頁面：後台與後台內嵌的草稿預覽，免得污染管理者自己的 cookie。 */
const NO_WRITE_PATH = /^\/(?:admin|preview)(?:\/|$)/i

export function rememberedCampusWritable(pathname: string): boolean {
  return !NO_WRITE_PATH.test(pathname)
}

/** cookie 值要是站內內容裡存在的校區 key；任何其他值（含被改過、數字、陣列）一律當作沒有。 */
export function validRememberedCampus(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null
}
