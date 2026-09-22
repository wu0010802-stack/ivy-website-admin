import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api/client'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhTw })

// 任何 API 回 401（session 過期、帳號被停權）都清掉登入狀態並導回登入
// 頁，並記住原本要去的路徑。在 app.use(createPinia()) 之後才註冊，
// useAuthStore() 才拿得到 store。
setUnauthorizedHandler(() => {
  const authStore = useAuthStore()
  if (!authStore.user) return
  authStore.clearSession()
  const current = router.currentRoute.value
  if (current.name === 'login') return
  void router.replace({
    name: 'login',
    query: current.fullPath !== '/' ? { redirect: current.fullPath } : undefined,
  })
})

app.mount('#app')
