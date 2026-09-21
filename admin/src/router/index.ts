import { createRouter, createWebHistory } from 'vue-router'
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

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', name: 'dashboard', component: DashboardView },
        { path: 'users', name: 'users', component: UsersView },
        { path: 'content/home-about', name: 'home-about', component: HomeAboutView },
        { path: 'content/home-hero', name: 'home-hero', component: HomeHeroView },
        { path: 'content/site-footer', name: 'site-footer', component: SiteFooterView },
        { path: 'content/site-meta', name: 'site-meta', component: SiteMetaView },
        { path: 'content/home-campus-board', name: 'home-campus-board', component: HomeCampusBoardView },
        { path: 'content/booking-content', name: 'booking-content', component: BookingContentView },
        { path: 'content/day-experience', name: 'day-experience', component: DayExperienceView },
        { path: 'content/campus-profile', name: 'campus-profile', component: CampusProfileView },
        { path: 'content/campus-faq', name: 'campus-faq', component: CampusFaqView },
        { path: 'content/campus-tour', name: 'campus-tour', component: CampusTourView },
        { path: 'media', name: 'media', component: MediaLibraryView },
        { path: 'booking', name: 'booking', component: BookingSettingsView },
        { path: 'slots', name: 'slots', component: VisitSlotsView },
        { path: 'visit-requests', name: 'visit-requests', component: VisitRequestsView },
        { path: 'visit-requests/:id', name: 'visit-detail', component: VisitDetailView },
        { path: 'notifications', name: 'notifications', component: NotificationsView },
        { path: 'analytics', name: 'analytics', component: AnalyticsView },
        { path: 'audit', name: 'audit', component: AuditView },
        { path: 'policies', name: 'policies', component: PoliciesView },
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
    return { name: 'login' }
  }

  return true
})

export default router
