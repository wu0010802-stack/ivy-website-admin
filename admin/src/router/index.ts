import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AdminLayout from '../layouts/AdminLayout.vue'
import LoginView from '../views/LoginView.vue'
import UsersView from '../views/UsersView.vue'
import HomeAboutView from '../views/HomeAboutView.vue'
import HomeHeroView from '../views/HomeHeroView.vue'
import SiteFooterView from '../views/SiteFooterView.vue'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', name: 'users', component: UsersView },
        { path: 'content/home-about', name: 'home-about', component: HomeAboutView },
        { path: 'content/home-hero', name: 'home-hero', component: HomeHeroView },
        { path: 'content/site-footer', name: 'site-footer', component: SiteFooterView },
        { path: 'media', name: 'media', component: MediaLibraryView },
        { path: 'booking', name: 'booking', component: BookingSettingsView },
        { path: 'slots', name: 'slots', component: VisitSlotsView },
        { path: 'visit-requests', name: 'visit-requests', component: VisitRequestsView },
        { path: 'visit-requests/:id', name: 'visit-detail', component: VisitDetailView },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  if (to.name === 'login') {
    if (authStore.user) return { name: 'users' }
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
