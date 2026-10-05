import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElMessage, ElMessageBox, provideGlobalConfig } from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
// Element Plus 的元件 JS 按需引入（見 vite.config.ts），樣式仍整包、而且要在 style.css 之前載入：
// 按需帶樣式的話，元件 CSS 會跟著各頁 chunk 晚到、同權重下蓋掉 style.css 的覆寫（表格列高、
// 輸入框邊框都會變，2026-10-05 stack 視覺基準實測）。語系用 provideGlobalConfig 設成全域
// （等同過去 app.use(ElementPlus, { locale })）。
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
// 全域繁中語系；ElMessageBox／ElMessage 要 app.use 才拿得到 app context（語系、provide）。
provideGlobalConfig({ locale: zhTw }, app, true)
app.use(ElMessage)
app.use(ElMessageBox)

// 任何 API 回 401（閒置逾時、帳號被停權）都清掉登入狀態並導回登入頁，記住
// 原本要去的路徑；reason=expired 讓登入頁說明是逾時、登入後會回到剛才的頁面。
// 頁面有未儲存的修改時改成留在原頁請本人重新登入（見 router/unauthorized.ts）。
// 在 app.use(createPinia()) 之後才註冊，回呼裡的 useAuthStore() 才拿得到 store。
setUnauthorizedHandler(redirectToLoginOnUnauthorized(router))
// 有在操作（打字、點擊）就延長閒置期限，見 composables/sessionKeepAlive.ts。
startSessionKeepAlive()

app.mount('#app')
