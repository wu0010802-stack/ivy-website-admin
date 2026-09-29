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
// 原本要去的路徑，登入頁說明「閒置過久，請重新登入」；頁面有未儲存的修改時
// 改成留在原頁請本人重新登入。在 app.use(createPinia()) 之後才註冊，回呼裡的
// useAuthStore() 才拿得到 store。
setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
// 有在操作（打字、點擊）就延長閒置期限，見 composables/sessionKeepAlive.ts。
startSessionKeepAlive()

app.mount('#app')
