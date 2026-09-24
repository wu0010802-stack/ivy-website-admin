import { computed, ref } from 'vue'
import { api } from '../api/client'
import type { VisitStaffOut } from '../api/types'

// 可以承辦案件的同事。列表、明細與補登都要用，各自打一次沒必要；讀一次
// 後放在模組層共用。登出時由 auth store 清掉，下一個登入的人重新讀自己
// 看得到的名單。
const staff = ref<VisitStaffOut[]>([])
let pending: Promise<void> | null = null

export function resetVisitStaff(): void {
  staff.value = []
  pending = null
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

  /** 某個校區的案件可以指派給誰：啟用中、總管理者或有該校權限的人 */
  function assignableFor(campusKey: string) {
    return computed(() =>
      staff.value.filter((s) => s.is_active && (s.role === 'super_admin' || s.campus_keys.includes(campusKey))),
    )
  }

  return { staff, load, assignableFor }
}
