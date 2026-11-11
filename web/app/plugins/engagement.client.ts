import { IDLE_MS, READ_ACTION, actionKeyOf, classifySource, engagementSession, sectionKeyAt, setCurrentVisit, startVisit, type EngagementVisit } from '../utils/engagement'
import { trackingAllowed } from '../utils/cta-analytics'

// 內容興趣統計（2026-11-11）：各頁停留、捲動深度、各區塊停留、互動與單篇消息，後台「數據」頁看。
// 和瀏覽統計同一道閘（部署關閉、DNT／GPC 就不送），不用 cookie；分頁內的暫時代碼放 sessionStorage。
// 每秒量一次、只在分頁看得見而且最近有操作時累計；切到背景、換頁、關分頁時把累計值送出去
// （同一次瀏覽會送多次，後端以瀏覽代碼留最新的一次）。
export default defineNuxtPlugin((app) => {
  const config = useRuntimeConfig()
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (!trackingAllowed(config.public.telemetryEnabled, nav)) return
  const device = matchMedia('(max-width: 760px)').matches ? 'mobile' as const : 'desktop' as const
  let storage: Storage | null = null
  try { storage = sessionStorage } catch { /* 被瀏覽器擋掉就不跨頁串接 */ }
  const session = engagementSession(storage, () => classifySource(document.referrer, location.search, location.origin, navigator.userAgent))

  let visit: EngagementVisit | null = null
  let lastTick = performance.now()
  let lastActivity = lastTick
  let timer: ReturnType<typeof setInterval> | undefined

  function measure() {
    const now = performance.now()
    const elapsed = now - lastTick
    lastTick = now
    if (!visit || document.visibilityState !== 'visible' || now - lastActivity > IDLE_MS) return
    const root = document.documentElement
    const depth = root.scrollHeight > 0 ? ((window.scrollY + window.innerHeight) / root.scrollHeight) * 100 : 0
    visit.tick(elapsed, sectionKeyAt(document, window.innerWidth, window.innerHeight), depth)
    const end = document.querySelector('[data-track-read]')
    if (end && end.getBoundingClientRect().bottom <= window.innerHeight) visit.mark(READ_ACTION)
  }
  function flush() {
    measure()
    const payload = visit?.takePayload()
    if (!payload) return
    void fetch('/api/telemetry', { method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {})
  }
  function begin() {
    if (visit?.path === location.pathname) return
    visit = startVisit(location.pathname, session, device)
    setCurrentVisit(visit)
    lastTick = lastActivity = performance.now()
  }
  function schedule() {
    clearInterval(timer)
    timer = document.visibilityState === 'visible' ? setInterval(measure, 1000) : undefined
  }

  const router = useRouter()
  // 換頁前把這一頁的累計送出去；換頁後舊的那筆就不再累計，等新頁面畫好再開始新的一筆。
  router.beforeEach((to, from) => { if (to.path !== from.path) flush() })
  router.afterEach((to, from) => { if (to.path !== from.path) { visit = null; setCurrentVisit(null) } })
  app.hook('page:finish', begin)
  app.hook('app:mounted', () => {
    begin()
    schedule()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
      else lastTick = lastActivity = performance.now()
      schedule()
    })
    addEventListener('pagehide', flush)
    const active = () => { lastActivity = performance.now() }
    for (const type of ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']) {
      addEventListener(type, active, { passive: true, capture: true })
    }
    // capture：在元件自己的 click 處理之前讀狀態，才分得出這一下是打開還是收起來。
    document.addEventListener('click', (event) => {
      const key = actionKeyOf(event.target instanceof Element ? event.target : null)
      if (key) visit?.action(key)
    }, { capture: true })
  })
})
