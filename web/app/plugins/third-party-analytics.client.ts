import { analyticsEnabled, analyticsIdsFromConfig } from '#shared/third-party-analytics'
import { trackingAllowed } from '../utils/cta-analytics'
import { createThirdPartyAnalytics } from '../utils/third-party-analytics'

// GA4 與 Meta Pixel（2026-11-12，規格 docs/specs/2026-11-12-external-integrations-design.md 第 1 節）。
// 依 2026-10-03 裁定：有 cookie、不做同意橫幅、尊重 DNT／GPC，揭露寫在隱私權政策第 5 段。
// 全部預設關：兩個 ID（NUXT_PUBLIC_GA_MEASUREMENT_ID、NUXT_PUBLIC_META_PIXEL_ID）都沒設或格式不符，這支外掛什麼都不做。
// 載入、暫停與清洗網址的細節見 utils/third-party-analytics.ts。
export default defineNuxtPlugin((app) => {
  const ids = analyticsIdsFromConfig(useRuntimeConfig())
  if (!analyticsEnabled(ids)) return
  // 只看 DNT／GPC：第一方統計（telemetryEnabled）關掉不影響這裡，GA／Pixel 的開關是它們自己的 ID。
  if (!trackingAllowed(true, navigator as Navigator & { globalPrivacyControl?: boolean })) return
  const analytics = createThirdPartyAnalytics(ids)
  const router = useRouter()
  // 換頁前先暫停：GA 強化評估的「瀏覽器歷程變更」會在網址一變（pushState）當下就送，早於 page:finish。
  router.beforeEach((to) => { analytics.hold(to.path) })
  router.afterEach(() => { analytics.settle(location.pathname) })
  const pageView = () => analytics.pageView(location.href, location.pathname, document.title)
  // page:finish 時 Nuxt 的 head 已先同步更新 document.title（install-client-head 的 hook 註冊得比這裡早）。
  app.hook('page:finish', pageView)
  app.hook('app:mounted', pageView)
})
