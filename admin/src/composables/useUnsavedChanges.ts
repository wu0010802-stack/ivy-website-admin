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

export interface UnsavedChangesOptions {
  /**
   * 離頁時可以先存草稿：只有內容編輯頁傳（存草稿不會動到官網）。預約設定、個資
   * 政策這些一存就直接上線的頁面不傳，離頁框維持「放棄修改／留在這頁」。
   */
  saveDraft?: () => Promise<boolean>
  /** 現在能不能存草稿（唯讀、版本衝突時不行）；沒給就當可以 */
  canSaveDraft?: Readonly<Ref<boolean>>
}

/** 設定頁與內容頁共用離頁保護；同時觸發的離頁動作只詢問一次。 */
export function useUnsavedChanges(isDirty: Readonly<Ref<boolean>>, busy?: Readonly<Ref<boolean>>, options: UnsavedChangesOptions = {}) {
  let pending: Promise<boolean> | null = null
  let unregister: (() => void) | null = null

  /**
   * allowSave：真的離開這個路由時才給「儲存草稿並離開」。分校內容切校也會呼叫
   * confirmLeave，那時校區已經換成新的一校，存草稿會把舊校的表單送到新校，所以不給。
   */
  function confirmLeave(opts: { allowSave?: boolean } = {}): Promise<boolean> {
    if (discarding) return Promise.resolve(true)
    if (busy?.value) {
      ElMessage.info('正在儲存，請稍候再離開。')
      return Promise.resolve(false)
    }
    if (!isDirty.value) return Promise.resolve(true)
    if (pending) return pending
    const saveDraft = opts.allowSave && (options.canSaveDraft?.value ?? true) ? options.saveDraft : undefined
    pending = (saveDraft ? askSaveOrDiscard(saveDraft) : ElMessageBox.confirm('這一頁有尚未儲存的修改，離開後會遺失。', '放棄修改？', {
      confirmButtonText: '放棄修改', cancelButtonText: '留在這頁', type: 'warning', confirmButtonClass: 'el-button--danger', autofocus: false,
    }).then(() => true, () => false)).finally(() => { pending = null })
    return pending
  }

  // 三個選擇：儲存草稿並離開（存成功才離開；失敗就留在原頁，錯誤沿用存檔的提示）、
  // 放棄修改、關掉對話框（X／Esc）就是留在這頁。
  async function askSaveOrDiscard(saveDraft: () => Promise<boolean>): Promise<boolean> {
    let saved = false
    try {
      await ElMessageBox.confirm('這一頁有尚未儲存的修改。儲存草稿不會更動官網；放棄修改就會遺失。', '離開前要儲存嗎？', {
        confirmButtonText: '儲存草稿並離開',
        cancelButtonText: '放棄修改',
        distinguishCancelAndClose: true,
        type: 'warning',
        beforeClose: (action, instance, done) => {
          if (action !== 'confirm') return done()
          instance.confirmButtonLoading = true
          void saveDraft().then((ok) => {
            saved = ok
          }).finally(() => {
            instance.confirmButtonLoading = false
            done()
          })
        },
      })
      return saved
    } catch (action) {
      return action === 'cancel'
    }
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!isDirty.value && !busy?.value) return
    event.preventDefault()
    event.returnValue = ''
  }

  onBeforeRouteLeave(() => confirmLeave({ allowSave: true }))
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
