// 換頁捲動（2026-09-29 手機審查 cross-cutting-1、home-bottom-news-1）。
// Nuxt 的 scrollBehavior 只能整支替換、沒有 hook 可掛，所以這裡照抄 Nuxt 4.5.2 的預設實作
// （node_modules/nuxt/dist/pages/runtime/router.options.js：同路徑 hash、scrollToTop meta、
// 等 page:loading:end 與換頁過場再捲、hash 的 scroll-margin），只改兩處，都標了「差異」：
//  (a) 初次載入／重新整理（Nuxt 會做第二次 force replace，from 被換成 START_LOCATION）：
//      預設會算出 {0,0}，瀏覽器原生還原後 300ms 左右又被拉回頁首。沒有 hash 時改成不捲，交給瀏覽器還原。
//  (b) SPA 返回首頁：首頁掛載後還在量測簾幕高度，scrollHeight 會先縮再長；太早還原會被夾住，
//      再被 scroll anchoring 推到頁尾。等高度連續 3 幀不變（最多 1 秒）才還原。
// 升級 Nuxt 時要拿原檔比對，把預設行為的修正帶進來。
import type { RouterConfig } from 'nuxt/schema'
import { START_LOCATION, type RouteLocationNormalized, type RouterOptions, type RouterScrollBehavior } from 'vue-router'
import { isChangingPage } from '#app/components/utils'

type SavedPosition = Parameters<RouterScrollBehavior>[2]
type ScrollPosition = Exclude<Awaited<ReturnType<RouterScrollBehavior>>, false | void>
type HashScrollBehavior = NonNullable<RouterConfig['scrollBehaviorType']>

export default <RouterConfig>{
  scrollBehavior(to, from, savedPosition) {
    const nuxtApp = useNuxtApp()
    const router = useRouter()
    // scrollBehaviorType 是 Nuxt 另外塞進 router.options 的設定，vue-router 的型別沒有它。
    const hashScrollBehaviour: HashScrollBehavior = (router.options as RouterOptions & RouterConfig).scrollBehaviorType ?? 'auto'
    if (to.path.replace(/\/$/, '') === from.path.replace(/\/$/, '')) {
      if (from.hash && !to.hash) return savedPosition ?? { left: 0, top: 0 }
      if (to.hash) return { el: to.hash, top: _getHashElementScrollMarginTop(to.hash), behavior: hashScrollBehaviour }
      return false
    }
    if ((typeof to.meta.scrollToTop === 'function' ? to.meta.scrollToTop(to, from) : to.meta.scrollToTop) === false) return false
    // 差異 (a)：初次載入沒有 hash 就不捲（首頁在上面的同路徑分支已經是 false）；帶 hash 照預設捲到錨點。
    if (from === START_LOCATION && !to.hash) return savedPosition ?? false
    if (from === START_LOCATION) return _calculatePosition(to, from, savedPosition, hashScrollBehaviour)
    // 差異 (b)：返回首頁要等版面量完才還原。
    const waitForLayout = Boolean(savedPosition) && to.path === '/'
    return new Promise((resolve) => {
      const doScroll = () => {
        requestAnimationFrame(async () => {
          if (router.currentRoute.value.fullPath !== to.fullPath) {
            resolve(false)
            return
          }
          if (waitForLayout) {
            await _waitForStableHeight()
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

function _getHashElementScrollMarginTop(selector: string): number {
  try {
    const elem = document.querySelector(selector)
    if (elem) return (Number.parseFloat(getComputedStyle(elem).scrollMarginTop) || 0) + (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)
  } catch {}
  return 0
}

function _calculatePosition(to: RouteLocationNormalized, from: RouteLocationNormalized, savedPosition: SavedPosition, defaultHashScrollBehaviour: HashScrollBehavior): ScrollPosition {
  if (savedPosition) return savedPosition
  if (to.hash) return { el: to.hash, top: _getHashElementScrollMarginTop(to.hash), behavior: isChangingPage(to, from) ? defaultHashScrollBehaviour : 'instant' }
  return { left: 0, top: 0 }
}

// 差異 (b) 用：每幀讀一次 scrollHeight，連續 3 幀不變或滿 1 秒就放行。
// 不必暫關 overflow-anchor：等待期間捲動位置就算被 anchoring 移動，接著的還原也會用絕對位置蓋掉；
// 還原之後保留 anchoring，晚到的圖片才不會把畫面推走。
function _waitForStableHeight(): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now()
    let last = -1
    let unchanged = 0
    const check = () => {
      const height = document.documentElement.scrollHeight
      unchanged = height === last ? unchanged + 1 : 0
      last = height
      if (unchanged >= 3 || performance.now() - started >= 1000) resolve()
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}
