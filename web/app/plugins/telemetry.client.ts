import { watch } from 'vue'
import { notFoundPath, notFoundRef } from '#shared/not-found'
import { publicPage, type TelemetryEvent } from '#shared/telemetry'
import { bookingCtaCampus, contactClickKind, ctaEntryOf, ctaEvent, isCampusKey, isSamePage, sendCtaEvent, statsAllowed, tracksClicks } from '../utils/cta-analytics'
import { newIdempotencyKey } from '../utils/idempotency-key'
import { reusesPageInstance } from '../utils/third-party-analytics'

export default defineNuxtPlugin((app) => {
  const config = useRuntimeConfig()
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  // 自動化瀏覽器、爬蟲、登入過後台的瀏覽器也不送（2026-11-20，見 statsAllowed）。
  if (!statsAllowed(config.public.telemetryEnabled, nav, document.cookie)) return
  // 404 等錯誤頁（例如關掉的 30 週年頁）不算瀏覽、也不送速度：網址對得到頁面，看到的卻是錯誤頁。
  const error = useError()
  const device = matchMedia('(max-width: 760px)').matches ? 'mobile' as const : 'desktop' as const
  const entryPage = publicPage(location.pathname)
  function send(event: Omit<TelemetryEvent, 'device'>) {
    void fetch('/api/telemetry', { method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...event, device }) }).catch(() => {})
  }
  let previousPath = ''
  function pageView() {
    if (previousPath === location.pathname) return
    previousPath = location.pathname
    const page = publicPage(previousPath)
    if (page && !error.value) send({ event: 'page_view', ...page })
  }
  app.hook('page:finish', pageView)
  // 找不到的網址（2026-11-20）：進站就是 404、或站內換頁到 404，各記一次（同一個路徑不重記）。
  // 「從哪裡來」只看 document.referrer（進站那一次），站內換頁一律算站內。
  let reportedNotFound = ''
  let firstLoad = true
  function notFound() {
    const status = error.value && 'statusCode' in error.value ? Number(error.value.statusCode) : 0
    if (status !== 404) return
    const path = notFoundPath(location.pathname)
    if (!path || path === reportedNotFound) return
    reportedNotFound = path
    const ref = firstLoad ? notFoundRef(document.referrer, location.origin) : 'internal'
    void fetch('/api/telemetry', { method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'not_found', path, ref }) }).catch(() => {})
  }
  watch(() => error.value, () => { notFound(); firstLoad = false })
  // 同一個頁面實例換網址（/visit ↔ /visit/<校>，預約頁的 definePageMeta key 固定）不會有 page:finish：
  // 換頁完成就記（2026-11-20；11-11 起五校預約頁的瀏覽因此只記到約四成）。和 GA 的補送同一個判斷。
  useRouter().afterEach((to, from, failure) => {
    if (!failure && to.path !== from.path && reusesPageInstance(to, from)) pageView()
  })
  app.hook('app:mounted', () => {
    pageView()
    notFound()
    firstLoad = false
    // 標準 CWV 依 document 進入頁歸屬；不將 SPA 換頁當成新的 LCP。
    if (entryPage) void import('web-vitals').then(({ onLCP, onINP, onCLS }) => {
      const ids = new Map<string, string>()
      const report = (metric: { name: 'LCP' | 'INP' | 'CLS'; value: number; id: string }) => {
        if (!publicPage(location.pathname) || error.value) return
        if (!ids.has(metric.id)) ids.set(metric.id, newIdempotencyKey())
        send({ ...entryPage, event: metric.name, value: metric.value, id: ids.get(metric.id)! })
      }
      onLCP(report); onINP(report); onCLS(report)
    }).catch(() => {})
    document.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (!anchor) return
      // 預約頁選校卡（2026-11-13 起是連到 /visit/<校> 的連結）是同一頁裡換步驟，不算從別處點進預約頁；
      // 原本的「下一步」按鈕也不記。卡片上的撥號連結是另一個 <a>，照常記。
      if (anchor.hasAttribute('data-visit-step')) return
      const target = new URL(anchor.href, location.origin)
      // 站內、而且不是連到目前這一頁（例如跳至主要內容的 #main）才算往預約頁。
      const destination = target.origin === location.origin && !isSamePage(target, location.origin, location.pathname) ? publicPage(target.pathname) : null
      if (publicPage(location.pathname) && destination?.page === 'visit') send({ event: 'visit_click', ...destination })
      if (!tracksClicks(location.pathname)) return
      // BookingCta 與預約頁聯絡步驟的按鈕已自己回報，避免重複。
      if (anchor.hasAttribute('data-booking-cta')) return
      const entry = ctaEntryOf(anchor)
      // 往官網預約表單的按鈕（頁首、五校卡、分校頁、BookingCta 的表單模式）。
      const booking = bookingCtaCampus(target, location.origin, location.pathname)
      if (booking) return sendCtaEvent(ctaEvent('booking_cta_clicked', booking.campus, entry))
      const campus = anchor.closest<HTMLElement>('[data-campus-key]')?.dataset.campusKey
      if (!isCampusKey(campus)) return
      const kind = contactClickKind(target)
      if (kind) sendCtaEvent(ctaEvent(kind, campus, entry))
    })
  })
})
