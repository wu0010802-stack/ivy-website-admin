import { isPlainLeftClick } from '~/utils/campusPhotoMorph'
import { CURRICULUM_ENTER_CLASS, CURRICULUM_ENTER_TIMEOUT, bloomGeometry, shouldBloomIntoCurriculum } from '~/utils/curriculumEnter'
import { CURRICULUM_PATH } from '~/utils/seo'
import { revealMaskCanvas } from '~/utils/watercolor'

// 進入特色教學頁的水彩暈開（2026-09-28 使用者選 A「中央暈開」；規則見 utils/curriculumEnter.ts）。
// 做法同 Nuxt 內建的 view transition（experimental.viewTransition），但只套這一條路徑：
// beforeResolve 先開始 View Transition、等瀏覽器拍好舊畫面才放行換頁，新頁 page:finish 後才讓瀏覽器拍新畫面。
// 舊頁是靜止截圖、新頁是 live，所以特色教學頁自己的顏料與照片暈開會在遮罩裡一起動。
// 注意：更新 DOM 這段期間瀏覽器暫停畫面更新，requestAnimationFrame 不會觸發，不能拿它來等（mock 實測）。
// 頁首主選單與頁尾是一般 <a>（整頁載入、不經過路由）：連到 /curriculum 而且這次會暈開時，才攔下來改走 router.push，
// 其他連結維持原本的整頁載入（同首頁 useChapterAnchors 的做法）。

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> }
}

export default defineNuxtPlugin((nuxtApp) => {
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function') return
  const root = document.documentElement
  const router = useRouter()

  // 遮罩：app 掛上後在閒置時間產生三張，toBlob 非同步編碼；三張都好才設定，還沒好之前的導覽直接換頁。
  // 一次閒置只畫一張、編好再排下一張：1024² 的 canvas 是同步畫的，三張擠在同一次閒置，4 倍降速時是一個 230–540ms 的長任務（分開後每張約 60–80ms，實測）。
  let masksReady = false
  const MASK_SEEDS = [11, 23, 37]
  const whenIdle = (fn: () => void, fallbackDelay: number) => {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 4000 })
    else setTimeout(fn, fallbackDelay)
  }
  const makeMasks = () => {
    if (masksReady || matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(forced-colors: active)').matches) return
    const urls: string[] = []
    const step = () => {
      revealMaskCanvas(MASK_SEEDS[urls.length]!).toBlob((blob) => {
        if (!blob) return
        urls.push(URL.createObjectURL(blob))
        if (urls.length < MASK_SEEDS.length) { whenIdle(step, 100); return }
        urls.forEach((url, i) => root.style.setProperty(`--cur-enter-blob-${i + 1}`, `url(${url})`))
        masksReady = true
      })
    }
    step()
  }
  nuxtApp.hook('app:mounted', () => whenIdle(makeMasks, 1500))

  // 上一頁／下一頁不播：vue-router 的 popstate 處理是非同步的，這裡的旗標會在守衛執行前立起來
  let popstate = false
  window.addEventListener('popstate', () => { popstate = true })

  const willBloom = (toPath: string, fromPath: string, initial: boolean) => shouldBloomIntoCurriculum(toPath, fromPath, {
    initial,
    popstate,
    supported: true,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    forcedColors: matchMedia('(forced-colors: active)').matches,
    masksReady
  })

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || !isPlainLeftClick(event)) return
    const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]')
    if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
    const url = new URL(anchor.href, location.href)
    if (url.origin !== location.origin || url.pathname !== CURRICULUM_PATH) return
    if (!willBloom(url.pathname, router.currentRoute.value.path, false)) return
    event.preventDefault()
    void router.push(url.pathname + url.search + url.hash)
  })

  let finish: (() => void) | undefined
  router.beforeResolve((to, from) => {
    if (!willBloom(to.path, from.path, from.matched.length === 0)) return
    const { x, y, size } = bloomGeometry(innerWidth, innerHeight)
    root.style.setProperty('--cur-enter-x', `${x}px`)
    root.style.setProperty('--cur-enter-y', `${y}px`)
    root.style.setProperty('--cur-enter-s', `${size}px`)
    root.classList.add(CURRICULUM_ENTER_CLASS)

    let changeRoute!: () => void
    const ready = new Promise<void>((resolve) => { changeRoute = resolve })
    const pageDone = new Promise<void>((resolve) => { finish = resolve })
    const timer = setTimeout(() => finish?.(), CURRICULUM_ENTER_TIMEOUT)
    const transition = doc.startViewTransition!(() => { changeRoute(); return pageDone })
    transition.finished.catch(() => {}).finally(() => {
      clearTimeout(timer)
      finish = undefined
      root.classList.remove(CURRICULUM_ENTER_CLASS)
    })
    return ready
  })
  router.afterEach(() => { popstate = false })
  nuxtApp.hook('page:finish', () => { finish?.() })
  nuxtApp.hook('vue:error', () => { finish?.() })
})
