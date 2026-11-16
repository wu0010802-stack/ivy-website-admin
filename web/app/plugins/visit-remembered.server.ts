import { VISIT_REMEMBERED_HINT, hasRememberedVisitCookie } from '~/utils/visit-remembered'

// 這台裝置記住的預約（2026-11-16，VisitRememberedNotice.vue）：cookie 是 HttpOnly，前端讀不到。
// 每次伺服器渲染（不論第一頁是哪一頁）都把「請求有沒有帶這個 cookie」放進 payload，家長從首頁站內換頁到
// 預約頁時才知道要不要查。沒帶就完全不打 API。
export default defineNuxtPlugin(() => {
  useState(VISIT_REMEMBERED_HINT, () => hasRememberedVisitCookie(useRequestHeaders(['cookie']).cookie))
})
