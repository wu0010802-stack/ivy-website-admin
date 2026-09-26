// 首頁五校卡「預約參觀Ｘ校」→ 預約頁：用 View Transition 把目前那張校園照片縮放到預約頁側欄的校區照片。
// 不開 Nuxt 的全站 experimental.viewTransition（那會讓每次換頁都淡入淡出），只有這一顆按鈕走這條路。
// 過程中 <html> 帶 .campus-morph：兩端的 view-transition-name 與預約頁照片的淡入動畫都掛在這個 class 底下
// （styles.css「選校 → 預約」），平常沒有任何元素有名字，不影響其他換頁。

export const CAMPUS_MORPH_CLASS = 'campus-morph'
const PAGE_TIMEOUT = 2500

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> }
}

export function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function canMorphCampusPhoto(doc: Document = document, win: Window = window): boolean {
  return typeof (doc as ViewTransitionDocument).startViewTransition === 'function'
    && !win.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !win.matchMedia('(forced-colors: active)').matches
}

/**
 * 啟動照片接續換頁。navigate 要在新頁面畫好後才 resolve；逾時就不再等，讓瀏覽器照常收尾。
 * 呼叫前應先確認 canMorphCampusPhoto()。
 */
export function morphCampusPhoto(source: HTMLElement, navigate: () => Promise<unknown>, doc: Document = document): Promise<void> {
  const root = doc.documentElement
  root.classList.add(CAMPUS_MORPH_CLASS)
  source.dataset.campusMorph = 'source'
  const transition = (doc as ViewTransitionDocument).startViewTransition!(async () => {
    // 舊畫面已經截好；拿掉來源標記，避免新舊兩頁同時有同名元素（例如導覽失敗留在首頁時）。
    delete source.dataset.campusMorph
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      navigate(),
      new Promise(resolve => { timer = setTimeout(resolve, PAGE_TIMEOUT) })
    ]).finally(() => clearTimeout(timer))
  })
  return transition.finished.catch(() => {}).finally(() => {
    delete source.dataset.campusMorph
    root.classList.remove(CAMPUS_MORPH_CLASS)
  })
}
