import { publicPage, type TelemetryEvent } from '../../shared/telemetry'
import { bookingCtaCampus, contactClickKind, ctaEntryOf, ctaEvent, isCampusKey, sendCtaEvent, tracksClicks, trackingAllowed } from '../utils/cta-analytics'

export default defineNuxtPlugin((app) => {
  const config = useRuntimeConfig()
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (!trackingAllowed(config.public.telemetryEnabled, nav)) return
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
    if (page) send({ event: 'page_view', ...page })
  }
  app.hook('page:finish', pageView)
  app.hook('app:mounted', () => {
    pageView()
    // 標準 CWV 依 document 進入頁歸屬；不將 SPA 換頁當成新的 LCP。
    if (entryPage) void import('web-vitals').then(({ onLCP, onINP, onCLS }) => {
      const ids = new Map<string, string>()
      const report = (metric: { name: 'LCP' | 'INP' | 'CLS'; value: number; id: string }) => {
        if (!publicPage(location.pathname)) return
        if (!ids.has(metric.id)) ids.set(metric.id, crypto.randomUUID())
        send({ ...entryPage, event: metric.name, value: metric.value, id: ids.get(metric.id)! })
      }
      onLCP(report); onINP(report); onCLS(report)
    }).catch(() => {})
    document.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (!anchor) return
      const target = new URL(anchor.href, location.origin)
      const destination = target.origin === location.origin ? publicPage(target.pathname) : null
      if (publicPage(location.pathname) && destination?.page === 'visit') send({ event: 'visit_click', ...destination })
      if (!tracksClicks(location.pathname)) return
      if (anchor.hasAttribute('data-booking-cta')) return // BookingCta 已回報，避免重複。
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
