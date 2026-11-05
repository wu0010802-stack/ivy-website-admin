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

  // 遮罩：app 掛上後在閒置時間產生三張，toBlob 非同步編碼；三張都好才算好，還沒好之前的導覽直接換頁。
  // 一次閒置只畫一張、編好再排下一張：1024² 的 canvas 是同步畫的，三張擠在同一次閒置，4 倍降速時是一個 230–540ms 的長任務（分開後每張約 60–80ms，實測）。
  // 網址先留在這裡，要暈開的那一步（beforeResolve）才寫到 <html>（2026-11-05）：<html> 上的自訂屬性會繼承，一寫就整頁重算樣式
  // （/admission 載入時 826 個元素、4 倍降速 82ms，常剛好碰上開始捲動），而這三個變數只有暈開期間的 ::view-transition-new(root) 讀。
  let masksReady = false
  let maskUrls: string[] = []
  const MASK_SEEDS = [11, 23, 37]
  // 跨頁快取（2026-11-05）：主選單與頁尾是一般 <a>（整頁載入），原本每換一頁都重畫三張再 toBlob（手機 4 倍降速每頁 300–400ms）。
  // 同一個種子畫出同一張圖，所以第一次產生後把 PNG 存進 Cache Storage，之後的頁面三張都命中就直接用、不畫；
  // 沒命中照原本的流程產生再存；沒有 caches（非安全來源）或拋錯（部分無痕模式）就照原本的做法。
  // 快取名稱帶 buildId（2026-11-05 審查後補）：revealMaskCanvas 的輸出還取決於 watercolor.ts 的 deform、ellipse、tracePolygon、seededRandom，
  // 段落顏料、照片暈開、首頁滲接也共用這幾個函式，為了別處改它們時一定想不到要動這裡的版本號，回訪者就會一直拿到舊遮罩；
  // 每次部署 buildId 都不同，新部署第一次開頁重產一次（成本同快取之前的一頁），舊部署的快取在開頁時刪掉。
  // buildId 取不到時退回只用版本號，所以改上面的種子、1024 的尺寸或 revealMaskCanvas 時仍把版本號加一。
  // dev 的 buildId 固定是 'dev'（改了程式也不變），所以 dev 不用快取、每頁照原本的做法產生，改遮罩時看得到新圖。
  const MASK_CACHE_PREFIX = 'ivy-cur-enter-'
  const MASK_VERSION = 'v1'
  const buildId = useRuntimeConfig().app?.buildId
  const MASK_CACHE = `${MASK_CACHE_PREFIX}${MASK_VERSION}${buildId ? `-${buildId}` : ''}`
  // Cache Storage 卡住（設定檔或儲存異常時 open／match 不回應也不拋錯）時不能一直等：逾時就當沒命中、照原本的流程產生（不存）。
  const LOOKUP_TIMEOUT = 1500
  const maskKey = (seed: number) => `/__cur-enter-mask/${seed}-1024`
  const skipMasks = () => matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(forced-colors: active)').matches
  const whenIdle = (fn: () => void, fallbackDelay: number) => {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 4000 })
    else setTimeout(fn, fallbackDelay)
  }
  type Lookup = { cache?: Cache, blobs?: Blob[] }
  const lookupMasks = async (): Promise<Lookup> => {
    let cache: Cache | undefined
    try {
      if (import.meta.dev || typeof caches === 'undefined') return {}
      cache = await caches.open(MASK_CACHE)
      void caches.keys()
        .then((names) => Promise.all(names.filter((name) => name.startsWith(MASK_CACHE_PREFIX) && name !== MASK_CACHE).map((name) => caches.delete(name))))
        .catch(() => {})
      const hits = await Promise.all(MASK_SEEDS.map((seed) => cache!.match(maskKey(seed))))
      if (hits.some((hit) => !hit)) return { cache }
      return { cache, blobs: await Promise.all(hits.map((hit) => hit!.blob())) }
    } catch {
      return { cache }
    }
  }
  const lookupWithin = (ms: number): Promise<Lookup> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<Lookup>((resolve) => { timer = setTimeout(() => resolve({}), ms) })
    return Promise.race([lookupMasks(), timeout]).finally(() => clearTimeout(timer))
  }
  // 快取在 app 掛上時就開始查（非同步、不佔主執行緒），查完記在 looked。入口照舊是 whenIdle，masksReady 只會在閒置入口之後成立
  // （極早的點擊照舊直接換頁）。閒置時已經查好：沒命中的第一張就在這次閒置裡同步畫，和快取之前一樣；
  // 還沒查好：不能在查好的 then 裡畫（那是 Cache Storage 回應的一般工作，1024² 同步繪製 4 倍降速 60–80ms，可能正碰上捲動或點擊），
  // 改成查好後再排一次閒置、從頭再進來，每一張都只在閒置時段畫。
  let looked: Lookup | undefined = {} // 沒去查（掛上時是減少動態／強制色彩）就當沒命中
  let lookup: Promise<unknown> = Promise.resolve()
  const makeMasks = () => {
    if (masksReady || skipMasks()) return
    if (!looked) { void lookup.then(() => whenIdle(makeMasks, 100)); return }
    const { cache, blobs } = looked
    if (blobs) {
      maskUrls = blobs.map((blob) => URL.createObjectURL(blob))
      masksReady = true
      return
    }
    const urls: string[] = []
    const step = () => {
      const seed = MASK_SEEDS[urls.length]!
      revealMaskCanvas(seed).toBlob((blob) => {
        if (!blob) return
        urls.push(URL.createObjectURL(blob))
        void cache?.put(maskKey(seed), new Response(blob, { headers: { 'Content-Type': 'image/png' } })).catch(() => {})
        if (urls.length < MASK_SEEDS.length) { whenIdle(step, 100); return }
        maskUrls = urls
        masksReady = true
      })
    }
    step()
  }
  nuxtApp.hook('app:mounted', () => {
    if (!skipMasks()) {
      looked = undefined
      lookup = lookupWithin(LOOKUP_TIMEOUT).then((result) => { looked = result }, () => { looked = {} })
    }
    whenIdle(makeMasks, 1500)
  })

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
    maskUrls.forEach((url, i) => root.style.setProperty(`--cur-enter-blob-${i + 1}`, `url(${url})`))
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
