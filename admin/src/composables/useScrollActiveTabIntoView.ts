import { onBeforeUnmount, watch, type Ref } from 'vue'

/** el-tabs 的元件實例：用到對外的 tabNavRef.scrollToActiveTab 與根元素 $el。 */
export type ScrollableTabs = {
  $el?: Element | null
  tabNavRef?: { scrollToActiveTab?: () => unknown } | null
} | null | undefined

/** 最多等幾幀：Element Plus 的 ResizeObserver 要再排一個 rAF 才把分頁列標成可捲動，通常 2–3 幀。 */
export const SCROLL_ACTIVE_TAB_FRAMES = 30

/**
 * 網址直接帶後段分頁（例如招生統計 `?sub=potential`）時，讓窄螢幕的分頁列捲到選中的那一頁。
 *
 * Element Plus 2.14 的 tab-nav 掛載後只用 `setTimeout 0` 呼叫一次 scrollToActiveTab，
 * 但當下 `scrollable` 還是 false（要等 ResizeObserver → rAF 的 update() 才設），所以直接 return，
 * 選中的分頁留在可見範圍外、看不出自己在哪一頁（2026-11-06 正式站 QA）。點分頁時它自己會捲，
 * 只有掛載這一次要補：逐幀等 `.el-tabs__nav-wrap` 出現 `is-scrollable`，再呼叫**一次**就停。
 *
 * 只能呼叫一次：分頁列的 transform 有 0.3 秒過場，動畫中途再呼叫會拿移動中的位置去算，
 * 多捲過頭（2026-11-06 第一版連續 6 幀呼叫，正式站「預約全程」被切掉左邊 24px）。
 * 一直沒變成可捲動（寬螢幕放得下）就不呼叫。
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
        if (instance.$el?.querySelector?.('.el-tabs__nav-wrap.is-scrollable')) {
          void instance.tabNavRef?.scrollToActiveTab?.()
          return
        }
        remaining -= 1
        if (remaining > 0) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    },
    { flush: 'post', immediate: true },
  )

  onBeforeUnmount(cancel)
}
