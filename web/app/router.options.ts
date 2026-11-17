// 換頁捲動（2026-09-29 手機審查 cross-cutting-1、home-bottom-news-1）。
// Nuxt 的 scrollBehavior 只能整支替換、沒有 hook 可掛，所以這裡照抄 Nuxt 4.6.2 的預設實作
// （node_modules/nuxt/dist/pages/runtime/router.options.js：同路徑 hash、scrollToTop meta、
// 等 page:loading:end 與換頁過場再捲、hash 的 scroll-margin），以下列出自訂差異：
//  (a) 初次載入／重新整理（Nuxt 會做第二次 force replace，from 被換成 START_LOCATION）：
//      預設會算出 {0,0}，瀏覽器原生還原後 300ms 左右又被拉回頁首。沒有 hash 時改成不捲，交給瀏覽器還原；
//      帶 hash 的網址只有第一次進站捲到錨點，重新整理與整頁上一頁／下一頁一樣交給瀏覽器還原到離開時的位置。
//  (b) SPA 返回首頁：首頁掛載後還在量測簾幕高度，scrollHeight 會先縮再長；太早還原會被夾住，
//      再被 scroll anchoring 推到頁尾。等高度連續 3 幀不變（最多 1 秒）才還原。
//  (c) 環境頁：等捲動模組與字型就緒才跳 hash 或還原位置；整頁離開的位置存於 history，
//      WebKit 遺失 history.state 時退回同分頁 sessionStorage 的相同 URL（只用於 reload / back_forward）。
// 升級 Nuxt 時要拿原檔比對，把預設行為的修正帶進來。
import type { RouterConfig } from 'nuxt/schema'
import { START_LOCATION, type RouteLocationNormalized, type RouterOptions, type RouterScrollBehavior } from 'vue-router'
import { isChangingPage } from '#app/components/utils'

type SavedPosition = Parameters<RouterScrollBehavior>[2]
type ScrollPosition = Exclude<Awaited<ReturnType<RouterScrollBehavior>>, false | void>
type HashScrollBehavior = NonNullable<RouterConfig['scrollBehaviorType']>

export default <RouterConfig>{
  async scrollBehavior(to, from, savedPosition) {
    const nuxtApp = useNuxtApp()
    const router = useRouter()
    // scrollBehaviorType 是 Nuxt 另外塞進 router.options 的設定，vue-router 的型別沒有它。
    const hashScrollBehaviour: HashScrollBehavior = (router.options as RouterOptions & RouterConfig).scrollBehaviorType ?? 'auto'
    // 環境頁在 onMounted 動態載入釘住敘事，版面高度就緒前還原會被截短。
    // Nuxt 的 auto restoration 不會由 Vue Router 存 scroll；環境頁在 beforeunload / pagehide 補記自己的 entry。
    const environment = to.path.replace(/\/$/, '') === '/environment'
    if (environment && (from === START_LOCATION || savedPosition)) {
      let entry = window.history.state?.environmentScroll
      if (!entry && from === START_LOCATION && _isRestoredLoad()) {
        try { entry = JSON.parse(sessionStorage.getItem(`ivy:environment-scroll:${to.fullPath}`) ?? 'null') } catch { /* 保留瀏覽器原生還原 */ }
      }
      const stored = entry?.path === to.fullPath && Number.isFinite(entry.top) && Number.isFinite(entry.left) ? { left: entry.left, top: entry.top } : null
      const restored = savedPosition ?? (from === START_LOCATION && _isRestoredLoad() ? stored ?? window.history.state?.scroll : null)
      await _waitForEnvironmentLayout()
      if (router.currentRoute.value.fullPath !== to.fullPath) return false
      if (restored) return { ...restored, behavior: 'instant' }
      if (from === START_LOCATION && (!to.hash || _isRestoredLoad())) return false
      return _calculatePosition(to, from, savedPosition, hashScrollBehaviour)
    }
    if (to.path.replace(/\/$/, '') === from.path.replace(/\/$/, '')) {
      if (from.hash && !to.hash) return savedPosition ?? { left: 0, top: 0 }
      if (to.hash) return { el: to.hash, top: _getHashElementScrollMarginTop(to.hash), behavior: hashScrollBehaviour }
      return false
    }
    if ((typeof to.meta.scrollToTop === 'function' ? to.meta.scrollToTop(to, from) : to.meta.scrollToTop) === false) return false
    // 差異 (a)：初次載入沒有 hash、或是重新整理／整頁返回就不捲（首頁在上面的同路徑分支已經是 false）；
    // 第一次帶 hash 進站照預設捲到錨點。
    if (from === START_LOCATION && (!to.hash || _isRestoredLoad())) return savedPosition ?? false
    if (from === START_LOCATION) return _calculatePosition(to, from, savedPosition, hashScrollBehaviour)
    // 差異 (b)：返回首頁要等版面量完才還原。
    const waitForLayout = (Boolean(savedPosition) && to.path === '/') || environment
    return new Promise((resolve) => {
      const doScroll = () => {
        requestAnimationFrame(async () => {
          if (router.currentRoute.value.fullPath !== to.fullPath) {
            resolve(false)
            return
          }
          if (waitForLayout) {
            if (environment) await _waitForEnvironmentLayout()
            else await _waitForStableHeight()
            if (router.currentRoute.value.fullPath !== to.fullPath) {
              resolve(false)
              return
            }
          }
          resolve(_calculatePosition(to, from, savedPosition, hashScrollBehaviour))
        })
      }
      nuxtApp.hooks.hookOnce('page:loading:end', () => {
        const transitionPromise = nuxtApp['~transitionPromise']
        if (transitionPromise) transitionPromise.then(doScroll)
        else doScroll()
      })
    })
  }
}

// Nuxt 4.6.2 起改用 getElementById（hash 不再當 CSS 選擇器解析），照著跟進。
function _getHashElementScrollMarginTop(hash: string): number {
  const elem = document.getElementById(hash.slice(1))
  if (!elem) return 0
  return (Number.parseFloat(getComputedStyle(elem).scrollMarginTop) || 0) + (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)
}

function _calculatePosition(to: RouteLocationNormalized, from: RouteLocationNormalized, savedPosition: SavedPosition, defaultHashScrollBehaviour: HashScrollBehavior): ScrollPosition {
  if (savedPosition) return savedPosition
  if (to.hash) return { el: to.hash, top: _getHashElementScrollMarginTop(to.hash), behavior: isChangingPage(to, from) ? defaultHashScrollBehaviour : 'instant' }
  return { left: 0, top: 0 }
}

// 差異 (a) 用：這次整頁載入是重新整理或上一頁／下一頁（瀏覽器會自己還原捲動位置）。
function _isRestoredLoad(): boolean {
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  return entry?.type === 'reload' || entry?.type === 'back_forward'
}

// 差異 (b) 用：每幀讀一次 scrollHeight，連續 3 幀不變或滿 1 秒就放行。
// 不必暫關 overflow-anchor：等待期間捲動位置就算被 anchoring 移動，接著的還原也會用絕對位置蓋掉；
// 還原之後保留 anchoring，晚到的圖片才不會把畫面推走。
function _waitForStableHeight(ready = () => true, limit = 1000): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now()
    let last = -1
    let unchanged = 0
    const check = () => {
      const height = document.documentElement.scrollHeight
      unchanged = ready() && height === last ? unchanged + 1 : 0
      last = height
      if (unchanged >= 3 || performance.now() - started >= limit) resolve()
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

// 最多等三秒；腳本／字型失敗仍可跳到靜態內容。ready 是元件明確完成 layout 的訊號。
function _waitForEnvironmentLayout(): Promise<void> {
  return _waitForStableHeight(() => Boolean(document.querySelector('.renv[data-windows-ready]')) && document.fonts?.status !== 'loading', 3000)
}
