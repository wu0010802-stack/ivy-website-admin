import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AdminLayout from '../layouts/AdminLayout.vue'
import LoginView from '../views/LoginView.vue'
import UsersView from '../views/UsersView.vue'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AdminLayout,
      children: [{ path: '', name: 'users', component: UsersView }],
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
