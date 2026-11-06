import { onBeforeUnmount, watch, type Ref } from 'vue'

/** el-tabs 對外的 tabNavRef 只用到 scrollToActiveTab。 */
export type ScrollableTabs = { tabNavRef?: { scrollToActiveTab?: () => unknown } | null } | null | undefined

/** 重試的影格數：Element Plus 的 ResizeObserver 要再排一個 rAF 才把分頁列標成可捲動，6 幀綽綽有餘。 */
export const SCROLL_ACTIVE_TAB_FRAMES = 6

/**
 * 網址直接帶後段分頁（例如招生統計 `?sub=potential`）時，讓窄螢幕的分頁列捲到選中的那一頁。
 *
 * Element Plus 2.14 的 tab-nav 掛載後只用 `setTimeout 0` 呼叫一次 scrollToActiveTab，
 * 但當下 `scrollable` 還是 false（要等 ResizeObserver → rAF 的 update() 才設），所以直接 return，
 * 選中的分頁留在可見範圍外、看不出自己在哪一頁（2026-11-06 正式站 QA）。點分頁時它自己會捲，
 * 只有掛載這一次要補：分頁列出現後連續幾幀再呼叫，可捲動之後才會真的移動；選中的分頁已在
 * 可見範圍內時呼叫不會改位置。
 */
export function useScrollActiveTabIntoView(tabs: Ref<ScrollableTabs>) {
  let frame = 0
  const cancel = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  watch(
    tabs,
    (instance) => {
      cancel()
      if (!instance || typeof requestAnimationFrame !== 'function') return
      let remaining = SCROLL_ACTIVE_TAB_FRAMES
      const tick = () => {
        frame = 0
        void instance.tabNavRef?.scrollToActiveTab?.()
        remaining -= 1
        if (remaining > 0) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    },
    { flush: 'post', immediate: true },
  )

  onBeforeUnmount(cancel)
}
