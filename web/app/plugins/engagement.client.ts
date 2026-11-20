import { IDLE_MS, READ_ACTION, actionKeyOf, campaignOf, campusContactOf, classifySource, engagementSession, nextPage, rememberVisitKind, sectionKeyAt, sendEngagement, setCurrentVisit, startVisit, type EngagementVisit } from '../utils/engagement'
import { taipeiDay } from '#shared/attribution-cookie'
import { trackingAllowed } from '../utils/cta-analytics'
import { REMEMBERED_CAMPUS_COOKIE } from '../utils/remembered-campus'

/** 造訪開始時記住的校區（ivy_campus，不是 HttpOnly）；格式由 engagementSession 再驗一次。 */
function rememberedCampusCookie(cookie: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${REMEMBERED_CAMPUS_COOKIE}=([a-z]+)(?:;|$)`))
  return match?.[1]
}

// 內容興趣統計（2026-11-11）：各頁停留、捲動深度、各區塊停留、互動與單篇消息，後台「數據」頁看。
// 和瀏覽統計同一道閘（部署關閉、DNT／GPC 就不送）；分頁內的暫時代碼放 sessionStorage。
// 2026-11-18／19：回訪分類沿用 ivy_src；回報帶同源 cookie，官網代理從 ivy_src 附上同一瀏覽器的匿名代號，
// 造訪開始時記下 ivy_campus 記住的校區（docs/specs/2026-11-19-cookie-stats-design.md）。
// 每秒量一次、只在分頁看得見而且最近有操作時累計；切到背景、換頁、關分頁時把累計值送出去
// （同一次瀏覽會送多次，後端以瀏覽代碼留最新的一次）。
export default defineNuxtPlugin((app) => {
  const config = useRuntimeConfig()
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (!trackingAllowed(config.public.telemetryEnabled, nav)) return
  const device = matchMedia('(max-width: 760px)').matches ? 'mobile' as const : 'desktop' as const
  let storage: Storage | null = null
  try { storage = sessionStorage } catch { /* 被瀏覽器擋掉就不跨頁串接 */ }
  const navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
  const newArrival = navType === 'navigate' && (!document.referrer || new URL(document.referrer).origin !== location.origin)
  const session = engagementSession(storage,
    () => classifySource(document.referrer, location.search, location.origin, navigator.userAgent),
    () => campaignOf(location.search), { day: taipeiDay(new Date()), newArrival, pref: rememberedCampusCookie(document.cookie) },
  )

  let requestedVisitKind = false
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
    sendEngagement(visit)
  }
  const samePath = (a: string, b: string) => (a.replace(/\/+$/, '') || '/') === (b.replace(/\/+$/, '') || '/')
  function begin(path: string) {
    if (visit && samePath(visit.path, path)) return
    // 不統計的頁面（後台、預約修改頁…）不算進「第幾頁」。
    const started = startVisit(path, session, device)
    // 僅首次進到可統計頁時讀回訪分類（伺服器讀 HttpOnly 的 ivy_src，只回 true／false）；讀不到就保留未知。
    if (started && session.pages === 0 && !requestedVisitKind) {
      requestedVisitKind = true
      void $fetch<{ returning: boolean | null }>('/api/visit-kind', { credentials: 'same-origin' })
        .then(({ returning }) => {
          if (typeof returning === 'boolean') rememberVisitKind(storage, session, returning)
        }).catch(() => {})
    }
    visit = started ? startVisit(path, session, device, undefined, nextPage(storage, session)) : null
    setCurrentVisit(visit)
    lastTick = lastActivity = performance.now()
  }
  function schedule() {
    clearInterval(timer)
    timer = document.visibilityState === 'visible' ? setInterval(measure, 1000) : undefined
  }

  const router = useRouter()
  // 這一頁的瀏覽在元件 setup 之前就開始：元件一掛上就回報的進度（例如預約頁還原填到一半的資料）才記得到。
  // 換頁前把這一頁的累計送出去，換頁完成就開始新的一筆。第一次導覽的 from 是路由的起點，不是真的換頁。
  begin(location.pathname)
  router.beforeEach((to, from) => { if (visit && samePath(visit.path, from.path) && !samePath(to.path, from.path)) flush() })
  router.afterEach((to) => begin(to.path))
  app.hook('app:mounted', () => {
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
      const target = event.target instanceof Element ? event.target : null
      const key = actionKeyOf(target)
      if (key) visit?.action(key)
      const contact = campusContactOf(target)
      if (visit && contact) {
        visit.contact(contact.campus, contact.channel)
        flush()
      }
    }, { capture: true })
  })
})
