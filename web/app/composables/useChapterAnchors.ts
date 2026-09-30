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
  // 章節區塊在簾幕裡是 sticky，捲動中量到的 top 不可靠，錨點位置交給 scrollIntoView（含 scroll-margin）；
  // track 不是 sticky，擦完的位置量得準。
  target.scrollIntoView()
  const revealed = track.getBoundingClientRect().bottom + window.scrollY - window.innerHeight
  if (revealed > window.scrollY) window.scrollTo(0, Math.ceil(revealed))
  return true
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

  let settle = 0
  onMounted(() => {
    document.addEventListener('click', onClick)
    const chapter = chapterForHref(location.href, location.origin, chapters.value)
    if (!chapter) return
    // 帶 hash 進站：路由的初始捲動與簾幕量測都在掛載前後，等兩幀版面穩定再補。
    settle = requestAnimationFrame(() => { settle = requestAnimationFrame(() => { scrollPastCurtain(chapter) }) })
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onClick)
    cancelAnimationFrame(settle)
  })
}
