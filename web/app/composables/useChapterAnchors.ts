import { chapterForHref, type ChapterAnchor } from '~/utils/homeChapters'

/**
 * 首頁有些章節的錨點落在前一道簾幕擦除之前（例如 #life：錨點到了，畫面仍是「關於」）。
 * 章節設了 after（前一道簾幕的 track）時，連到它的站內連結（例如頁尾）與帶著 hash 進站，
 * 都改成先照錨點捲、再補到那道簾幕擦完的位置。其他錨點不經過這裡。
 */
export function scrollPastCurtain(chapter: ChapterAnchor): boolean {
  const target = document.getElementById(chapter.id)
  const track = chapter.after ? document.querySelector(chapter.after) : null
  if (!target || !track) return false
  // track 不是 sticky，擦完的位置量得準。
  const revealed = () => track.getBoundingClientRect().bottom + window.scrollY - window.innerHeight
  // 章節包在下一道簾幕的 sticky 裡、簾幕又在動：scrollIntoView 會量到釘住後的位置、捲過頭（#campuses 在 390 寬
  // 會落到標題、分頁、照片都在畫面上方，2026-10-12），直接捲到前一道簾幕擦完的位置。減少動態時沒有簾幕，照錨點捲。
  if (chapter.pinned && track.closest('[data-motion="on"]')) {
    window.scrollTo(0, Math.ceil(revealed()))
    return true
  }
  // 章節區塊在簾幕裡是 sticky，捲動中量到的 top 不可靠，錨點位置交給 scrollIntoView（含 scroll-margin）。
  target.scrollIntoView()
  const end = revealed()
  if (end > window.scrollY) window.scrollTo(0, Math.ceil(end))
  return true
}

function restoredLoad(): boolean {
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  return entry?.type === 'reload' || entry?.type === 'back_forward'
}

/** 每幀讀一次 scrollHeight，連續 3 幀不變或滿 1 秒就放行（同 router.options.ts 返回首頁的等法）。 */
function waitForStableHeight(): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now()
    let last = -1
    let unchanged = 0
    const check = () => {
      const height = document.documentElement.scrollHeight
      unchanged = height === last ? unchanged + 1 : 0
      last = height
      if (unchanged >= 3 || performance.now() - started >= 1000) resolve()
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

export function useChapterAnchors(chapters: Ref<ChapterAnchor[]>) {
  function onClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!anchor || (anchor as HTMLAnchorElement).target) return
    const chapter = chapterForHref(anchor.getAttribute('href')!, location.origin, chapters.value)
    if (!chapter) return
    event.preventDefault()
    // 保留 vue-router 的 history.state，只換網址上的 hash（用 router 會再觸發一次捲到原錨點）。
    if (location.hash !== `#${chapter.id}`) history.pushState(history.state, '', `#${chapter.id}`)
    scrollPastCurtain(chapter)
  }

  let disposed = false
  // 這一頁是整頁載入（hydration）還是站內換頁過來：只能在 setup 當下讀。
  const initialLoad = import.meta.client && useNuxtApp().isHydrating
  onMounted(() => {
    document.addEventListener('click', onClick)
    const chapter = chapterForHref(location.href, location.origin, chapters.value)
    if (!chapter) return
    // 重新整理、上一頁／下一頁：交給瀏覽器與路由還原到離開時的位置，不搶回章節（同 router.options.ts 差異 (a)）。
    // 整頁載入看 navigation timing；站內上一頁／下一頁時 vue-router 在 history.state 存了捲動位置。
    if (initialLoad ? restoredLoad() : history.state?.scroll) return
    // 帶 hash 進站、或從別頁連過來（關於頁的校名緞帶）：路由自己的錨點捲動與簾幕量測都在掛載前後，
    // 等版面連續幾幀不變再補（原本只等兩幀，從別頁換過來時會被路由晚到的捲動蓋掉，2026-10-12）。
    waitForStableHeight().then(() => { if (!disposed) scrollPastCurtain(chapter) })
  })
  onBeforeUnmount(() => {
    disposed = true
    document.removeEventListener('click', onClick)
  })
}
