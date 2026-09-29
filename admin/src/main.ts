import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { redirectToLoginOnUnauthorized } from './router/unauthorized'
import { setUnauthorizedHandler } from './api/client'
import { startSessionKeepAlive } from './composables/sessionKeepAlive'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhTw })

// 任何 API 回 401（閒置逾時、帳號被停權）都清掉登入狀態並導回登入頁，記住
// 原本要去的路徑；reason=expired 讓登入頁說明是逾時、登入後會回到剛才的頁面。
// 頁面有未儲存的修改時改成留在原頁請本人重新登入（見 router/unauthorized.ts）。
// 在 app.use(createPinia()) 之後才註冊，回呼裡的 useAuthStore() 才拿得到 store。
setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
// 有在操作（打字、點擊）就延長閒置期限，見 composables/sessionKeepAlive.ts。
startSessionKeepAlive()

app.mount('#app')
