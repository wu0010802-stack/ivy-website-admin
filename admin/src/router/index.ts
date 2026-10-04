import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type RouteRecordRaw,
  type RouteRecordSingleView,
} from 'vue-router'
import { notifyError } from '../composables/notify'
import { useAuthStore } from '../stores/auth'
// 登入頁與外框直接打包進入口，打開後台第一眼就要用到；其他頁面點進去時才下載，
// 不必讓櫃台在手機上先下載一整包用不到的內容編輯頁。
import AdminLayout from '../layouts/AdminLayout.vue'
import LoginView from '../views/LoginView.vue'
import ResetPasswordView from '../views/ResetPasswordView.vue'
import { canSeeNavItem, landingPath, navItem, safeRedirectPath } from './nav'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 限定角色；未設定代表所有登入者 */
    roles?: string[]
    /** 共用內容頁，有「全站共用內容」授權也可進入 */
    shared?: boolean
    /** 不用登入就能開（重設密碼連結）；不恢復 session、不導去登入頁 */
    public?: boolean
  }
}

// 路由標題與角色限制從側欄結構帶入，頁面標題、document.title、側欄
// 高亮三處共用同一份資料。
function page(path: string, name: string, component: RouteRecordSingleView['component']): RouteRecordRaw {
  const item = navItem(name)
  return { path, name, component, meta: { title: item?.title, roles: item?.roles, shared: item?.shared } }
}

export const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { title: '登入' } },
  // 總管理者寄的重設密碼連結（2026-10-03）。不用登入，也不在側欄；靜態打包：網址帶 #token=，
  // 延遲載入失敗時 onError 會把整個網址（含代碼）寫進 sessionStorage，而且同網址重載不會生效。
  { path: '/reset-password', name: 'reset-password', component: ResetPasswordView, meta: { title: '設定新密碼', public: true } },
  {
    path: '/',
    component: AdminLayout,
    children: [
      page('', 'dashboard', () => import('../views/DashboardView.vue')),
      page('users', 'users', () => import('../views/UsersView.vue')),
      page('content/home-about', 'home-about', () => import('../views/HomeAboutView.vue')),
      page('content/home-hero', 'home-hero', () => import('../views/HomeHeroView.vue')),
      page('content/site-footer', 'site-footer', () => import('../views/SiteFooterView.vue')),
      page('content/site-meta', 'site-meta', () => import('../views/SiteMetaView.vue')),
      page('content/home-campus-board', 'home-campus-board', () => import('../views/HomeCampusBoardView.vue')),
      page('content/booking-content', 'booking-content', () => import('../views/BookingContentView.vue')),
      page('content/privacy-policy', 'privacy-policy', () => import('../views/PrivacyPolicyView.vue')),
      page('content/day-experience', 'day-experience', () => import('../views/DayExperienceView.vue')),
      page('content/home-news', 'home-news', () => import('../views/HomeNewsView.vue')),
      page('content/admission', 'admission-content', () => import('../views/AdmissionContentView.vue')),
      page('content/about-page', 'about-page', () => import('../views/AboutPageView.vue')),
      page('content/curriculum-page', 'curriculum-page', () => import('../views/CurriculumPageView.vue')),
      page('content/campus-profile', 'campus-profile', () => import('../views/CampusProfileView.vue')),
      // 官網已沒有顯示常見問題的頁面；舊書籤與待審項目的連結改到五校介紹。
      { path: 'content/campus-faq', redirect: to => ({ path: '/content/campus-profile', query: to.query }) },
      { path: 'content/shared-faq', redirect: '/content/campus-profile' },
      page('content/campus-news', 'campus-news', () => import('../views/CampusNewsView.vue')),
      page('content/campus-tour', 'campus-tour', () => import('../views/CampusTourView.vue')),
      page('media', 'media', () => import('../views/MediaLibraryView.vue')),
      page('releases', 'releases', () => import('../views/PublishHistoryView.vue')),
      page('booking', 'booking', () => import('../views/BookingSettingsView.vue')),
      { path: 'slots', redirect: to => ({ path: '/visit-calendar', query: to.query }) },
      page('visit-requests', 'visit-requests', () => import('../views/VisitRequestsView.vue')),
      page('visit-calendar', 'visit-calendar', () => import('../views/VisitCalendarView.vue')),
      page('admissions', 'admissions', () => import('../views/AdmissionsView.vue')),
      {
        path: 'visit-requests/:id',
        name: 'visit-detail',
        component: () => import('../views/VisitDetailView.vue'),
        meta: { title: '案件明細', roles: navItem('visit-requests')?.roles },
      },
      page('notifications', 'notifications', () => import('../views/NotificationsView.vue')),
      page('analytics', 'analytics', () => import('../views/AnalyticsView.vue')),
      page('audit', 'audit', () => import('../views/AuditView.vue')),
      page('policies', 'policies', () => import('../views/PoliciesView.vue')),
      page('line-notifications', 'line-notifications', () => import('../views/LineNotificationsView.vue')),
      // 每個登入者都能進，不放側欄選單；入口是側欄底部的使用者區塊（搜尋也找得到）。
      { path: 'account', name: 'account', component: () => import('../views/AccountView.vue'), meta: { title: '我的帳號' } },
      // 舊書籤、打錯字或改過名的網址。原本沒有這條，對不到路由時整頁空白、連側欄
      // 都沒有；放在外框裡，保留側欄並給一顆回起始頁的按鈕。明確的路徑排序都比它前面。
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue'), meta: { title: '找不到頁面' } },
    ],
  },
]

/**
 * 每次換頁的登入與角色檢查。匯出給測試用同一份規則建 router。
 * 被導回登入頁時帶 reason，登入頁據此說明原因：signin＝連結要先登入、
 * offline＝連不上伺服器（session 可能還有效）、expired＝用到一半逾時（router/unauthorized.ts）。
 */
export async function authGuard(to: RouteLocationNormalized): Promise<boolean | RouteLocationRaw> {
  // 不用登入的頁面：不恢復 session、不導去登入頁（重設連結常從信箱 App 的內建瀏覽器開）。
  if (to.meta.public) return true
  const authStore = useAuthStore()

  if (to.name === 'login') {
    if (authStore.user && authStore.logoutPending) {
      // 按了登出、目前頁面的未儲存攔截也答應了才會走到這裡。登出失敗會丟錯：
      // 換頁中止、留在原頁，由 AdminLayout 提示再按一次。
      await authStore.logout()
      return true
    }
    // 重設完成後導回來：瀏覽器裡的 cookie 可能是別人（例如總管理者）的 session，
    // 恢復它會直接進別人的帳號、看不到「密碼已更新」。
    if (to.query.reason === 'password_reset') return true
    // 從書籤直接開登入頁、或在別的分頁重新登入後重新整理這一頁時，cookie 裡的
    // session 可能還有效：先試著恢復，不要讓人再登入一次（每次都會多建一個
    // session）。/auth/me 回 401 時 router/unauthorized.ts 的處理看到沒有登入者就不動作，不會繞圈。
    let reachable = true
    if (!authStore.user) {
      try {
        await authStore.restoreSession()
      } catch {
        // 連不上伺服器就先顯示登入頁
        reachable = false
      }
    }
    if (authStore.user) return safeRedirectPath(to.query.redirect) ?? landingPath(authStore.user.role)
    // 斷線時被導來、之後伺服器恢復了但 session 已經失效（按了「重新整理」）：網址還帶
    // reason=offline，登入頁會一直說連不上伺服器。改成一般的「請先登入」。
    if (reachable && to.query.reason === 'offline') {
      const { reason: _, ...query } = to.query
      return { name: 'login', query: query.redirect ? { ...query, reason: 'signin' } : query, replace: true }
    }
    return true
  }

  // 直接開後台首頁不必帶 redirect，也不必說明；其他網址要記住、登入後回來。
  const redirect = to.fullPath !== '/' ? { redirect: to.fullPath } : {}
  if (!authStore.user) {
    try {
      await authStore.restoreSession()
    } catch {
      return { name: 'login', query: { ...redirect, reason: 'offline' } }
    }
  }

  if (!authStore.user) {
    return { name: 'login', query: to.fullPath !== '/' ? { ...redirect, reason: 'signin' } : undefined }
  }

  const roles = to.meta.roles
  if (roles && !canSeeNavItem({ name: '', path: to.path, title: '', roles, shared: to.meta.shared }, authStore.user)) {
    const landing = landingPath(authStore.user.role)
    if (to.path === landing) return true
    // 只有明確連進來的頁面被擋才說明（通知信、同事貼的網址、書籤），AdminLayout
    // 讀 denied 顯示一次提示。'/' 是預設入口：編輯與唯讀登入後本來就會經過這裡
    // 被送到起始頁，不算被拒。
    if (to.path === '/') return { path: landing }
    return { path: landing, query: { denied: String(to.name ?? '') } }
  }

  return true
}

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
})

router.beforeEach(authGuard)

router.afterEach((to, _from, failure) => {
  if (failure) return
  document.title = to.meta.title ? `${to.meta.title}｜常春藤官網後台` : '常春藤官網後台'
})

// 頁面改成點進去才下載之後，部署會換掉舊的檔名：一直開著後台的人換頁會遇到
// 「Failed to fetch dynamically imported module」。整頁重新載入要去的網址，拿到
// 新版就好；同一個網址 10 秒內只重載一次，真的斷線時不會無限重整。頁面附帶的樣式檔
// 載入失敗時 Vite 丟的是「Unable to preload CSS for …」，一樣處理。
const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i
const CHUNK_RELOAD_KEY = 'ivy-admin-chunk-reload'

export function reloadAfterChunkError(
  error: unknown,
  href: string,
  navigate: (href: string) => void = url => window.location.assign(url),
): boolean {
  if (!(error instanceof Error) || !CHUNK_LOAD_ERROR.test(error.message)) return false
  let reloadedJustNow: boolean
  try {
    const last = JSON.parse(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 'null') as { href?: string; at?: number } | null
    reloadedJustNow = last?.href === href && Date.now() - (last.at ?? 0) < 10_000
    if (!reloadedJustNow) sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ href, at: Date.now() }))
  } catch {
    // 記不住有沒有重載過（私密視窗、封鎖網站資料）：當成剛重載過，不冒無限重整的險。
    reloadedJustNow = true
  }
  if (reloadedJustNow) {
    notifyError('頁面沒有載入成功，請確認網路後重新整理這一頁', { duration: 0 })
    return true
  }
  navigate(href)
  return true
}

router.onError((error, to) => {
  reloadAfterChunkError(error, router.resolve(to).href)
})

export default router
