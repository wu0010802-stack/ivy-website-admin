import type { Component } from 'vue'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AdminLayout from '../layouts/AdminLayout.vue'
import LoginView from '../views/LoginView.vue'
import UsersView from '../views/UsersView.vue'
import HomeAboutView from '../views/HomeAboutView.vue'
import HomeHeroView from '../views/HomeHeroView.vue'
import SiteFooterView from '../views/SiteFooterView.vue'
import SiteMetaView from '../views/SiteMetaView.vue'
import HomeCampusBoardView from '../views/HomeCampusBoardView.vue'
import BookingContentView from '../views/BookingContentView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'
import CampusProfileView from '../views/CampusProfileView.vue'
import CampusFaqView from '../views/CampusFaqView.vue'
import CampusTourView from '../views/CampusTourView.vue'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import DashboardView from '../views/DashboardView.vue'
import AnalyticsView from '../views/AnalyticsView.vue'
import AuditView from '../views/AuditView.vue'
import PoliciesView from '../views/PoliciesView.vue'
import { navItem } from './nav'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 限定角色；未設定代表所有登入者 */
    roles?: string[]
  }
}

// 路由標題與角色限制從側欄結構帶入，頁面標題、document.title、側欄
// 高亮三處共用同一份資料。
function page(path: string, name: string, component: Component): RouteRecordRaw {
  const item = navItem(name)
  return { path, name, component, meta: { title: item?.title, roles: item?.roles } }
}

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { title: '登入' } },
    {
      path: '/',
      component: AdminLayout,
      children: [
        page('', 'dashboard', DashboardView),
        page('users', 'users', UsersView),
        page('content/home-about', 'home-about', HomeAboutView),
        page('content/home-hero', 'home-hero', HomeHeroView),
        page('content/site-footer', 'site-footer', SiteFooterView),
        page('content/site-meta', 'site-meta', SiteMetaView),
        page('content/home-campus-board', 'home-campus-board', HomeCampusBoardView),
        page('content/booking-content', 'booking-content', BookingContentView),
        page('content/day-experience', 'day-experience', DayExperienceView),
        page('content/campus-profile', 'campus-profile', CampusProfileView),
        page('content/campus-faq', 'campus-faq', CampusFaqView),
        page('content/campus-tour', 'campus-tour', CampusTourView),
        page('media', 'media', MediaLibraryView),
        page('booking', 'booking', BookingSettingsView),
        page('slots', 'slots', VisitSlotsView),
        page('visit-requests', 'visit-requests', VisitRequestsView),
        {
          path: 'visit-requests/:id',
          name: 'visit-detail',
          component: VisitDetailView,
          meta: { title: '案件明細' },
        },
        page('notifications', 'notifications', NotificationsView),
        page('analytics', 'analytics', AnalyticsView),
        page('audit', 'audit', AuditView),
        page('policies', 'policies', PoliciesView),
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  if (to.name === 'login') {
    if (authStore.user) return { name: 'dashboard' }
    return true
  }

  if (!authStore.user) {
    await authStore.restoreSession()
  }

  if (!authStore.user) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined }
  }

  const roles = to.meta.roles
  if (roles && !roles.includes(authStore.user.role)) {
    return { name: 'dashboard' }
  }

  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title}｜常春藤官網後台` : '常春藤官網後台'
})

export default router
