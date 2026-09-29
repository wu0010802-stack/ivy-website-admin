import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

/** 設定頁與內容頁共用離頁保護；同時觸發的離頁動作只詢問一次。 */
export function useUnsavedChanges(isDirty: Readonly<Ref<boolean>>, busy?: Readonly<Ref<boolean>>) {
  let pending: Promise<boolean> | null = null

  function confirmLeave(): Promise<boolean> {
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
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
  return { confirmLeave }
}
