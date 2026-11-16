// 開場動畫「播過就 30 天內不再播」的 cookie（2026-11-16）。
// 原本只用 sessionStorage，每開一個新分頁就重播；現在播過一次寫 cookie，sessionStorage 留作後備
// （cookie 被擋時至少同一分頁不重播）。inline script 要寫，所以不能 httpOnly。
// 這是功能偏好、不是追蹤，不看 DNT／GPC。純函式與 inline script 片段都放這裡，
// entrance-policy.ts（首頁布幕）、inline-scripts.ts（/anniversary 開場）與 AnniversaryIntro.vue 共用。

export const ENTRANCE_SEEN_COOKIE = 'ivy_seen_entrance'
export const ANNI_INTRO_SEEN_COOKIE = 'ivy_seen_anni_intro'
/** 30 天。 */
export const SEEN_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/** useCookie 會把 `1` 解析成數字 1，所以字串與數字都收；其他值一律當沒看過。 */
export function seenCookieSet(value: unknown): boolean {
  return value === 1 || value === '1'
}

/** 要寫進 document.cookie 的字串；secure 為 true（https）才加 Secure。 */
export function seenCookieString(name: string, secure: boolean): string {
  return `${name}=1; Max-Age=${SEEN_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** inline script 用：document.cookie 裡已經有這個 cookie 嗎（運算式，回傳 boolean）。 */
export function seenCookieTest(name: string): string {
  return `/(?:^|;\\s*)${name}=1(?:;|$)/.test(document.cookie)`
}

/** inline script 用：寫入這個 cookie 的敘述（自己包 try，失敗不影響其他邏輯）。 */
export function seenCookieWrite(name: string): string {
  return `try{document.cookie='${name}=1; Max-Age=${SEEN_COOKIE_MAX_AGE}; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'')}catch(e){}`
}

// 這支檔案也被伺服器端的 CSP 雜湊計算 import（沒有 DOM 型別），所以用最小的結構型別，不寫 Document／Location。
interface CookieHost { cookie: string }
interface ProtocolHost { protocol: string }
const browser = globalThis as unknown as { document?: CookieHost; location?: ProtocolHost }

/** 瀏覽器端（Vue 元件）寫 cookie；失敗（cookie 被擋）安靜略過。 */
export function writeSeenCookie(name: string, doc: CookieHost | undefined = browser.document, loc: ProtocolHost | undefined = browser.location): void {
  try {
    if (doc) doc.cookie = seenCookieString(name, loc?.protocol === 'https:')
  } catch {
    // cookie 被擋就只靠 sessionStorage 後備
  }
}
