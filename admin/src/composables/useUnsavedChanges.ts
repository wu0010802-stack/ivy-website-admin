import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

// 目前畫面上有離頁保護的頁面。401 的集中處理（router/unauthorized.ts）要知道
// 有沒有未儲存的修改：有的話不能直接導去登入頁，否則修改就沒了。
const guardedPages = new Set<Readonly<Ref<boolean>>>()
// 使用者已經在別的對話框明確選了「放棄修改」：接下來那次離頁不再問一次。
let discarding = false

/** 登記一個頁面的 dirty 狀態；回傳取消登記的函式。 */
export function registerUnsavedChanges(isDirty: Readonly<Ref<boolean>>): () => void {
  guardedPages.add(isDirty)
  return () => {
    guardedPages.delete(isDirty)
  }
}

export function hasUnsavedChanges(): boolean {
  for (const isDirty of guardedPages) if (isDirty.value) return true
  return false
}

/** 在 fn 執行期間離頁不再詢問（使用者已經確認放棄修改）。 */
export async function leaveWithoutAsking<T>(fn: () => Promise<T>): Promise<T> {
  discarding = true
  try {
    return await fn()
  } finally {
    discarding = false
  }
}

/** 設定頁與內容頁共用離頁保護；同時觸發的離頁動作只詢問一次。 */
export function useUnsavedChanges(isDirty: Readonly<Ref<boolean>>, busy?: Readonly<Ref<boolean>>) {
  let pending: Promise<boolean> | null = null
  let unregister: (() => void) | null = null

  function confirmLeave(): Promise<boolean> {
    if (discarding) return Promise.resolve(true)
    if (busy?.value) {
      ElMessage.info('正在儲存，請稍候再離開。')
      return Promise.resolve(false)
    }
    if (!isDirty.value) return Promise.resolve(true)
    if (pending) return pending
    pending = ElMessageBox.confirm('這一頁有尚未儲存的修改，離開後會遺失。', '放棄修改？', {
      confirmButtonText: '放棄修改', cancelButtonText: '留在這頁', type: 'warning',
    }).then(() => true, () => false).finally(() => { pending = null })
    return pending
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!isDirty.value && !busy?.value) return
    event.preventDefault()
    event.returnValue = ''
  }

  onBeforeRouteLeave(confirmLeave)
  onMounted(() => {
    window.addEventListener('beforeunload', beforeUnload)
    unregister = registerUnsavedChanges(isDirty)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnload)
    unregister?.()
  })
  return { confirmLeave }
}
