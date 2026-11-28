import { analyticsEnabled, analyticsIdsFromConfig } from '#shared/third-party-analytics'
import { trackingAllowed } from '../utils/cta-analytics'
import { whenUrlHasNoLiffCredentials } from '../utils/line-liff'
import { afterHeadRendered, createThirdPartyAnalytics, reusesPageInstance, whenPageSettled } from '../utils/third-party-analytics'

// GA4 與 Meta Pixel（2026-11-12，規格 docs/specs/2026-11-12-external-integrations-design.md 第 1 節）。
// 依 2026-10-03 裁定：有 cookie、不做同意橫幅、尊重 DNT／GPC，揭露寫在隱私權政策第 5 段。
// 2026-11-15 加 ChatGPT 廣告的 OpenAI 評估像素（NUXT_PUBLIC_OPENAI_PIXEL_ID），只回報預約成功。
// 2026-11-16 加 LINE Tag（NUXT_PUBLIC_LINE_TAG_ID）：頁面瀏覽與預約成功的 Conversion，不送個資。
// 全部預設關：四個 ID（NUXT_PUBLIC_GA_MEASUREMENT_ID、NUXT_PUBLIC_META_PIXEL_ID、NUXT_PUBLIC_OPENAI_PIXEL_ID、NUXT_PUBLIC_LINE_TAG_ID）都沒設或格式不符，這支外掛什麼都不做。
// 載入、暫停與清洗網址的細節見 utils/third-party-analytics.ts。
// 外部腳本等整頁 load 之後、主執行緒有空才載（whenPageSettled，2026-11-12 手機效能）；事件先排在 queue 裡，不會漏。
// 2026-11-28 在 LINE 裡預約（LIFF）：LINE 把家長帶進來的那一刻，網址的 hash 帶著 LINE 的 access token；
// Meta Pixel 會自己讀完整網址，所以整支外掛等網址乾淨了才啟動（whenUrlHasNoLiffCredentials）。平常的網址當下就啟動，行為不變。
export default defineNuxtPlugin((app) => {
  const ids = analyticsIdsFromConfig(useRuntimeConfig())
  if (!analyticsEnabled(ids)) return
  // 只看 DNT／GPC：第一方統計（telemetryEnabled）關掉不影響這裡，GA／Pixel 的開關是它們自己的 ID。
  if (!trackingAllowed(true, navigator as Navigator & { globalPrivacyControl?: boolean })) return
  // 需要 Nuxt 執行環境的先在這裡取好：等網址變乾淨才啟動時，已經不在外掛的 setup 裡。
  const router = useRouter()
  const headHooks = injectHead(app)?.hooks
  whenUrlHasNoLiffCredentials(window, (waited) => {
    const analytics = createThirdPartyAnalytics(ids, window, document, whenPageSettled)
    // 換頁前先暫停：GA 強化評估的「瀏覽器歷程變更」會在網址一變（pushState）當下就送，早於 page:finish。
    router.beforeEach((to) => { analytics.hold(to.path) })
    const pageView = () => analytics.pageView(location.href, location.pathname, document.title)
    // SPA 換頁：page:finish 當下新頁標題還沒寫進 DOM（unhead 排在 setTimeout 之後），等 dom:rendered 才送（見 afterHeadRendered）。
    // 取不到 head（不該發生）時 afterHeadRendered 退回 500ms 保底，不讓整支外掛失效。
    const pageViewAfterHead = afterHeadRendered(headHooks, pageView)
    router.afterEach((to, from, failure) => {
      analytics.settle(location.pathname)
      // 同一個頁面實例換網址（/visit ↔ /visit/<校>）不會有 page:finish：換頁完成後自己排一次。
      if (!failure && to.path !== from.path && reusesPageInstance(to, from)) pageViewAfterHead()
    })
    app.hook('page:finish', pageViewAfterHead)
    // 第一頁：標題是伺服器渲染好的，hydration 完成就送。等過網址變乾淨才啟動的（LIFF），這時早就掛載完了，直接送。
    if (waited) pageView()
    else app.hook('app:mounted', pageView)
  })
})
