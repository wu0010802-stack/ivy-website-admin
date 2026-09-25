import { useAuthStore } from '../stores/auth'

// 後端 UserOut.effective_capabilities：角色加上總管理者逐人給的授權算出來的
// 實際權限（backend/app/auth/permissions.py 同一張表）。前端只拿來決定要不要
// 顯示按鈕，不另抄一份角色表；真正的檢查仍在 API。校區範圍另看 campus_keys。
//
// 常用的幾個：
// - booking.handle：處理案件（聯絡紀錄、確認、取消、改期、補登…），含櫃台
// - booking.manage：時段、每週規則、休假日、預約設定與指派承辦人
// - booking.export：匯出家長個資（總管理者逐人授予）
// - content.manage：編輯分校內容（唯讀帳號沒有）
export function hasCapability(
  user: { effective_capabilities?: readonly string[] } | null | undefined,
  capability: string,
): boolean {
  return Boolean(user?.effective_capabilities?.includes(capability))
}

export function usePermissions() {
  const auth = useAuthStore()
  // 在 template 或 computed 裡呼叫都會追蹤 auth.user，換人登入時自動更新。
  const can = (capability: string): boolean => hasCapability(auth.user, capability)
  return { can }
}
