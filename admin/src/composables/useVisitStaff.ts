import { ref } from 'vue'
import { api } from '../api/client'
import type { VisitStaffOut } from '../api/types'

// 處理參觀案件的同事：把登錄的人、聯絡紀錄與歷程裡的 id 翻成名字。讀一次
// 後放在模組層共用。登出時由 auth store 清掉，下一個登入的人重新讀自己
// 看得到的名單。
const staff = ref<VisitStaffOut[]>([])
let pending: Promise<void> | null = null

export function resetVisitStaff(): void {
  staff.value = []
  pending = null
}

/** 改了某人的顯示名稱（自己在「我的帳號」或總管理者在「使用者」頁）：已讀好的
 * 名單跟著換，案件頁不必重新整理就看得到新名字。名單還沒讀過就不用管。 */
export function renameVisitStaff(userId: string, displayName: string | null): void {
  const found = staff.value.find((s) => s.id === userId)
  if (found) found.display_name = displayName
}

export function useVisitStaff() {
  function load(force = false): Promise<void> {
    if (pending && !force) return pending
    pending = api
      .get<VisitStaffOut[]>('/admin/visit-staff')
      .then((list) => { staff.value = Array.isArray(list) ? list : [] })
      .catch(() => { pending = null })
    return pending
  }

  return { staff, load }
}
