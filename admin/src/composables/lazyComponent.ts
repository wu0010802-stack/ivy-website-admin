import { defineAsyncComponent, type AsyncComponentLoader, type Component, type ComponentPublicInstance } from 'vue'
import { reloadAfterChunkError } from '../router/chunkReload'

const Nothing = () => null

/**
 * 頁面裡點了才用到的大元件（打開才出現的對話框、不是預設的分頁）另切 chunk，進頁面時不必先下載。
 * 載入失敗比照換頁（router.onError）：部署換掉舊檔名時整頁重新載入目前網址（同一網址 10 秒內只一次，
 * 之後只提示）。給 errorComponent（空元件）開發模式才不會把載入錯誤再丟出去；錯誤仍由 Vue 記錄。
 */
export function lazyComponent<T extends Component = { new (): ComponentPublicInstance }>(loader: AsyncComponentLoader<T>): T {
  return defineAsyncComponent<T>({
    loader,
    errorComponent: Nothing,
    onError(error, _retry, fail) {
      reloadAfterChunkError(error, window.location.href)
      fail()
    },
  })
}
