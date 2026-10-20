import { getCurrentInstance, onBeforeUnmount } from 'vue'

export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void
  /** 取消還沒跑的那一次（清除搜尋、還原條件時用，免得舊的字晚一步又套回去）。 */
  cancel: () => void
}

/** 停下來 `delay` 毫秒才執行一次（邊打字邊查會連發請求）；每次呼叫都重新計時、只用最後一次的參數。
 * 在元件 setup 裡呼叫時，元件卸載會自動取消還沒跑的那一次，不必各自 onBeforeUnmount 清計時器。 */
export function useDebouncedFn<A extends unknown[]>(fn: (...args: A) => void, delay: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const debounced = ((...args: A) => {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, delay)
  }) as DebouncedFn<A>
  debounced.cancel = cancel
  if (getCurrentInstance()) onBeforeUnmount(cancel)
  return debounced
}
