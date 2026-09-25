import type { Campus } from '../types/site-content'

/** 預約回應裡的分校欄位；舊版 API 沒有這三欄，當作公開中、沒有電話。 */
export interface ParentVisitCampusFields {
  campus_key: string
  campus_name?: string
  campus_active?: boolean
  campus_phone?: string | null
}

export interface ParentVisitCampus {
  key: string
  /** 空字串＝不知道校名 */
  name: string
  phone: string | null
  /** 分校已停用（暫停開放）：官網沒有它的分校頁與預約頁 */
  paused: boolean
  /** 官網有這一校的分校頁與預約頁，可以連過去「聯絡」與「重新預約」 */
  listed: boolean
}

/**
 * 家長管理頁顯示的分校。停用的分校不在公開內容裡（首頁、頁尾、分校頁都沒有），
 * 改用預約回應帶的校名與電話；不能改列其他校區（家長可能打到別校），也不能連到
 * 已經 404 的分校頁或預約頁。
 */
export function parentVisitCampus(
  visit: ParentVisitCampusFields | null | undefined,
  campuses: readonly Pick<Campus, 'key' | 'name' | 'phone'>[] | undefined
): ParentVisitCampus | null {
  if (!visit) return null
  const published = campuses?.find(item => item.key === visit.campus_key)
  const paused = visit.campus_active === false
  return {
    key: visit.campus_key,
    name: published?.name || visit.campus_name || '',
    phone: published?.phone || visit.campus_phone || null,
    paused,
    listed: Boolean(published) && !paused
  }
}
