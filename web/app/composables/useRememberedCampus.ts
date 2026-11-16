import { REMEMBERED_CAMPUS_COOKIE, REMEMBERED_CAMPUS_MAX_AGE, rememberedCampusWritable, validRememberedCampus } from '~/utils/remembered-campus'

/**
 * 家長上次自己選的校區（cookie ivy_campus，2026-11-16）。
 * - 用 useCookie：SSR 與 client 讀到同一個值，第一個畫面就能用，不會有 hydration 差異。
 * - 不設 httpOnly（前端要寫）、Path=/、SameSite=Lax、非 dev 加 Secure、保存 180 天。
 * - 只有訪客主動選才呼叫 remember（頁首選單、首頁五校卡、預約頁選校卡）；自動輪播不算。
 * - allowed 傳入站內內容的校區 key，不認得的值一律忽略；/admin、/preview 底下不寫入。
 */
export function useRememberedCampus() {
  const cookie = useCookie<unknown>(REMEMBERED_CAMPUS_COOKIE, {
    maxAge: REMEMBERED_CAMPUS_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: !import.meta.dev,
    httpOnly: false
  })
  const route = useRoute()

  /** 記住的校區 key；沒記住或不在 allowed 裡回 null。 */
  function recall(allowed: readonly string[]): string | null {
    return validRememberedCampus(cookie.value, allowed)
  }

  function remember(key: string, allowed: readonly string[]): void {
    if (!rememberedCampusWritable(route.path)) return
    if (validRememberedCampus(key, allowed) === null) return
    if (cookie.value !== key) cookie.value = key
  }

  return { recall, remember }
}
