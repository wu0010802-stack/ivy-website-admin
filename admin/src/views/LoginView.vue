<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Key } from '@element-plus/icons-vue'
import { api, ApiError, BASE_URL } from '../api/client'
import { authenticator, PasskeyError } from '../api/passkey'
import { SESSION_CHANGED_MESSAGE, loginLimitedMessage } from '../api/errors'
import type { AuthProviders } from '../api/types'
import { safeRedirectPath } from '../router/nav'
import { forgetLastUser, notePendingMethod, readLastMethod, readLastUser, type SignInMethod } from '../composables/lastSignIn'
import crestMarkUrl from '../assets/brand/ivy-crest-mark.webp'

// 登入頁 2026-11-19 改版（方向 1「後台的第一個畫面」）：登入頁就長在後台的殼裡。
// 左邊是收合的後台側欄，登入成功用 View Transition 原地展開成真的側欄、接上起始頁；
// 顏色、字、控制項跟後台內頁同一套。比稿在 design/admin-login-directions-20261119。

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ email: '', password: '' })
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FULL_EMAIL_HINT = '請輸入完整的 Email，例如 name@example.com'
// 欄位問題顯示在該欄下方；帳密錯誤、限流、連線這類整體結果才用上方那一列。
// 驗證刻意維持同步，重複按登入時第二次一定看得到 submitting。
const fieldErrors = reactive({ email: '', password: '' })
const emailInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)
watch(() => form.email, () => { fieldErrors.email = '' })
watch(() => form.password, () => { fieldErrors.password = '' })

// 台灣時間的問候與日期（後台的人都在台灣；電腦時區設錯也照台灣時間）。
const now = new Date()
const taipei = Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', hour12: false })
    .formatToParts(now).map(part => [part.type, part.value]),
)
const hour = Number(taipei.hour) % 24
const greeting = hour >= 5 && hour < 11 ? '早安' : hour >= 11 && hour < 18 ? '午安' : '晚安'
const WEEKDAYS: Record<string, string> = { Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六', Sun: '日' }
const dateText = `${Number(taipei.month)}月${Number(taipei.day)}日 星期${WEEKDAYS[taipei.weekday ?? ''] ?? ''}`
const year = Number(taipei.year) || now.getFullYear()

const oauthErrors: Record<string, string> = {
  cancelled: '已取消 Google 登入，可重新選擇帳號或使用 Email 與密碼。',
  not_allowed: '這個 Google 帳號尚未綁定後台帳號，或綁定的帳號已停用。請先用 Email 與密碼登入，到「我的帳號」綁定 Google。',
  failed: 'Google 登入未完成或已逾時，請重新登入。',
  unavailable: 'Google 登入尚未啟用，請使用 Email 與密碼。',
  rate_limited: '嘗試次數過多，請 5 分鐘後再試。',
  line_cancelled: '已取消 LINE 登入，可重新登入或使用 Email 與密碼。',
  line_not_allowed: '這個 LINE 帳號尚未綁定後台帳號，或綁定的帳號已停用。請先用 Email 與密碼登入，到「我的帳號」綁定 LINE。',
  line_failed: 'LINE 登入未完成或已逾時，請重新登入。',
  // 回呼帶著 state 卻沒有握手 cookie：多半是 iPhone 從 Safari 發起、LINE App 把結果開在預設瀏覽器（2026-11-19）。
  // 在這個瀏覽器重按一次就會從這裡發起，LINE 也會回到這裡。
  line_other_browser: 'LINE 把登入結果開在另一個瀏覽器，這次沒有完成。請在這個瀏覽器再按一次「使用 LINE 登入」；手機上建議用預設的瀏覽器開後台。',
  line_unavailable: 'LINE 登入尚未啟用，請使用 Email 與密碼。',
}
const oauthErrorCode = typeof route.query.oauth_error === 'string' && Object.hasOwn(oauthErrors, route.query.oauth_error)
  ? route.query.oauth_error : ''
const oauthError = oauthErrorCode ? oauthErrors[oauthErrorCode] ?? null : null
const errorMessage = ref<string | null>(oauthError)
// 為什麼會在登入頁（router 與 router/unauthorized.ts 的 401 處理帶的 reason）。跟帳密錯誤的紅色
// 提示分開，用中性的資訊色：不是使用者做錯了什麼。
type ReasonNotice = { type: 'info' | 'warning'; text: string; reload?: boolean }
const REASON_NOTICES: Record<string, ReasonNotice> = {
  expired: { type: 'info', text: '登入已逾時，請重新登入；登入後會回到剛才的頁面。' },
  'other-user': { type: 'info', text: '這個瀏覽器已改用其他帳號登入，請重新登入。' },
  'session-changed': { type: 'info', text: SESSION_CHANGED_MESSAGE },
  signin: { type: 'info', text: '請先登入；登入後會直接開啟剛才的連結。' },
  offline: { type: 'warning', text: '連不上伺服器，請確認網路後重新整理這一頁；如果先前已經登入，重新整理後會回到剛才的頁面。', reload: true },
  password_reset: { type: 'info', text: '密碼已更新，請用新密碼登入。原本登入中的裝置都已登出。' },
}
const reasonNotice = computed(() => {
  const reason = route.query.reason
  return typeof reason === 'string' && Object.hasOwn(REASON_NOTICES, reason) ? REASON_NOTICES[reason] ?? null : null
})
function reloadPage() {
  window.location.reload()
}

const submitting = ref(false)
const showPassword = ref(false)
const capsLock = ref(false)
const forgotOpen = ref(false)
// 記住這台裝置（2026-11-19）：保持登入 30 天，期間沒用也不會登出；帳密、Google、LINE 都吃這個選擇。
// 預設不勾：沒勾時關掉瀏覽器就登出，共用電腦不會留著別人的登入。
const remember = ref(false)
const googleEnabled = ref(false)
const lineEnabled = ref(false)
// 指紋／臉部辨識登入（Passkey，2026-11-27）：後端有開、瀏覽器也支援才給按鈕。LINE 內建瀏覽器不支援。
const passkeyEnabled = ref(false)
const passkeyBusy = ref(false)
const providersLoaded = ref(false)

// 回訪者（composables/lastSignIn.ts）：這台瀏覽器上次登入的人。密碼重設後導回來時不帶
// （剛換密碼、其他裝置都被登出，照一般登入比較清楚）。
const lastUser = ref(route.query.reason === 'password_reset' ? null : readLastUser())
const lastMethod: SignInMethod | null = readLastMethod()
// LINE 的內建瀏覽器（從 LINE 群組通知點進來）：Google 不准在內建瀏覽器登入（disallowed_useragent），
// 改成請 LINE 用外部瀏覽器開這一頁；LINE 登入排第一。
const inLineApp = typeof navigator !== 'undefined' && /\bLine\//i.test(navigator.userAgent)
// 回訪者原本用 Google／LINE，但這次那個方式不能用（Google／LINE 登入錯誤導回來、在 LINE 裡用 Google）
// 就直接給密碼欄。
const passwordChosen = ref(Boolean(oauthError) || (lastMethod === 'google' && inLineApp))
const returningMethod = computed<SignInMethod>(() => {
  if (!lastUser.value || passwordChosen.value) return 'password'
  // 還在問有哪些登入方式時先照上次的畫；問到之後那個方式沒開，就退回密碼。
  if (lastMethod === 'google' && (!providersLoaded.value || googleEnabled.value)) return 'google'
  if (lastMethod === 'line' && (!providersLoaded.value || lineEnabled.value)) return 'line'
  return 'password'
})
const showEmailField = computed(() => !lastUser.value)
const greetingLine = computed(() => (lastUser.value ? `${greeting} ${lastUser.value.name}` : greeting))
const showPasswordForm = computed(() => returningMethod.value === 'password')

// 只接受站內路徑（規則在 nav.ts，router 從書籤恢復登入時也用同一條）。
const returnTo = computed(() => safeRedirectPath(route.query.redirect) ?? '/')
const redirectQuery = computed(() => {
  const params = new URLSearchParams({ redirect: returnTo.value })
  if (remember.value) params.set('remember', '1')
  return params.toString()
})
const googleLoginUrl = computed(() => `${BASE_URL}/auth/google/login?${redirectQuery.value}`)
const lineLoginUrl = computed(() => `${BASE_URL}/auth/line/login?${redirectQuery.value}`)
// LINE 內建瀏覽器的網址加 openExternalBrowser=1，LINE 會改用手機的預設瀏覽器開。
const externalBrowserUrl = computed(() => {
  if (typeof window === 'undefined') return '#'
  const url = new URL(window.location.href)
  url.searchParams.set('openExternalBrowser', '1')
  return url.toString()
})
// 回訪者從 Google／LINE 登入失敗導回來時給的是密碼欄；取消、逾時、結果開到別的瀏覽器這幾種，
// 另外留一個原地再試的連結（沒綁定、限流再按也沒用，不給）。
const retryProvider = computed<'google' | 'line' | null>(() => {
  if (!lastUser.value || !oauthErrorCode || ['not_allowed', 'line_not_allowed', 'rate_limited'].includes(oauthErrorCode)) return null
  if (oauthErrorCode.startsWith('line_')) return lineEnabled.value ? 'line' : null
  return googleEnabled.value && !inLineApp ? 'google' : null
})
const lineFirst = computed(() => inLineApp || lastMethod === 'line')
const oauthCount = computed(() => Number(googleEnabled.value) + Number(lineEnabled.value))
// Google 與 LINE 第一次都要先在後台內綁定（2026-10-06 起 Google 不再用 Email 自動綁定），入口旁要講清楚。
const oauthHint = computed(() => {
  const names = [googleEnabled.value && 'Google', lineEnabled.value && 'LINE'].filter(Boolean).join(' 或 ')
  return `第一次用 ${names}，要先以密碼登入，到「我的帳號」綁定`
})

function chooseOauth(method: 'google' | 'line') {
  notePendingMethod(method)
}
function usePasswordInstead() {
  passwordChosen.value = true
  void nextTick(() => passwordInput.value?.focus())
}
function switchAccount() {
  forgetLastUser()
  lastUser.value = null
  passwordChosen.value = false
  form.email = ''
  form.password = ''
  errorMessage.value = null
  void nextTick(() => emailInput.value?.focus())
}
function togglePassword() {
  showPassword.value = !showPassword.value
  passwordInput.value?.focus()
}
function trackCapsLock(event: KeyboardEvent) {
  capsLock.value = typeof event.getModifierState === 'function' && event.getModifierState('CapsLock')
}

// 密碼最多 128 字（後端 schemas 的 max_length），超過回 422：多半是貼錯內容。
const PASSWORD_TOO_LONG = '密碼太長（最多 128 字），請確認沒有貼錯內容'

/** 422 的 detail 是 FastAPI 的欄位錯誤陣列；回傳第一個出錯的本文欄位名稱。 */
function invalidField(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null
  const loc = (detail[0] as { loc?: unknown } | undefined)?.loc
  return Array.isArray(loc) && typeof loc[loc.length - 1] === 'string' ? (loc[loc.length - 1] as string) : null
}

// 同一個帳號 5 分鐘內密碼錯 10 次，密碼登入暫停 15 分鐘（2026-09-29 業主裁定）；
// Google／LINE 登入不受帳號鎖影響，有開放的才提示改用。來源限流／系統忙碌的
// 429 另有文案（loginLimitedMessage），不提示改用。
function limitedMessage(err: unknown): string {
  const alternatives = [googleEnabled.value && 'Google', lineEnabled.value && 'LINE'].filter(Boolean).join('／')
  return loginLimitedMessage(err, { verb: '登入', alternative: alternatives ? `可改用 ${alternatives} 登入` : undefined })
}

onMounted(async () => {
  // 進頁焦點：有滑鼠鍵盤的電腦才自動聚焦（手機一聚焦鍵盤就蓋住半個畫面）。
  // 新裝置在 Email；記得是誰、用密碼的在密碼欄。
  if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    ;(showEmailField.value ? emailInput : passwordInput).value?.focus({ preventScroll: true })
  }
  try {
    const providers = await api.get<AuthProviders>('/auth/providers')
    googleEnabled.value = providers.google === true
    lineEnabled.value = providers.line === true
    passkeyEnabled.value = providers.passkey === true && authenticator.supported() && !inLineApp
  } catch {
    // Provider availability must never block the existing password login.
    googleEnabled.value = false
    lineEnabled.value = false
  } finally {
    providersLoaded.value = true
  }
})

// 其他錯誤不顯示狀態碼（「登入失敗（502）」對員工沒有意義）。實際會碰到的是部署或
// 重啟時代理回的 502／503，和後端 500；後端 500 帶錯誤編號時附上，方便回報。代理的
// 錯誤本文是英文，不能直接顯示，所以不用 apiErrorMessage。
function otherLoginError(err: ApiError): string {
  if (err.status < 500) return '登入沒有完成，請稍後再試；一直不行請聯絡總管理者。'
  const detail = err.detail as { request_id?: unknown } | null
  const requestId = detail && typeof detail === 'object' && typeof detail.request_id === 'string' ? detail.request_id.slice(0, 8) : ''
  return `伺服器暫時無法回應，請稍後再試${requestId ? `（錯誤編號 ${requestId}）` : ''}`
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { updateCallbackDone: Promise<void>; finished: Promise<void> }
}

/**
 * 登入成功換到後台。支援 View Transition 的瀏覽器：登入頁左邊的側欄與後台的側欄同名
 * （view-transition-name: admin-side），原地展開成真的側欄、右邊淡入起始頁。
 * 不支援或設定了減少動態就直接換頁（跟改版前一樣）。
 */
async function enterAdmin() {
  // replace 而不是 push：登入頁不留在瀏覽紀錄裡。從通知信點進案件、登入後按
  // 「← 參觀案件」或返回鍵，才不會先退回登入頁、再被送到總覽。
  const go = async () => { await router.replace(returnTo.value); await nextTick() }
  const doc = document as ViewTransitionDocument
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (typeof doc.startViewTransition !== 'function' || reduce) {
    await go()
    return
  }
  const root = document.documentElement
  root.classList.add('is-entering-admin')
  const transition = doc.startViewTransition(go)
  void transition.finished.finally(() => root.classList.remove('is-entering-admin'))
  await transition.updateCallbackDone
}

// 指紋／臉部辨識登入：不用先打 Email，瀏覽器會列出這台裝置上登記過的帳號。吃同一個「記住這台裝置」。
async function handlePasskey() {
  if (submitting.value || passkeyBusy.value) return
  errorMessage.value = null
  passkeyBusy.value = true
  try {
    await authStore.loginWithPasskey(remember.value)
  } catch (err) {
    passkeyBusy.value = false
    if (err instanceof PasskeyError) {
      // 自己按取消或逾時不提示；裝置或網址用不了才說明。
      if (err.reason !== 'cancelled') errorMessage.value = '這台裝置現在不能用指紋或臉部辨識登入，請改用密碼登入'
    } else if (err instanceof ApiError && err.status === 401) {
      errorMessage.value = '這組指紋或臉部辨識沒有登記在後台（可能已被刪除），請改用密碼登入，再到「我的帳號」重新登記'
    } else if (err instanceof ApiError && err.status === 429) {
      errorMessage.value = limitedMessage(err)
    } else if (err instanceof ApiError) {
      errorMessage.value = otherLoginError(err)
    } else {
      errorMessage.value = '無法連線到伺服器，請稍後再試'
    }
    return
  }
  try {
    await enterAdmin()
  } finally {
    passkeyBusy.value = false
  }
}

async function handleSubmit() {
  if (submitting.value) return
  errorMessage.value = null
  const email = (lastUser.value ? lastUser.value.email : form.email).trim()
  // 帳號就是完整 Email；只打「admin」之類的會被後端以 422 擋下，
  // 先在這裡講清楚，不要讓人看到狀態碼。
  if (showEmailField.value) fieldErrors.email = !email ? '請輸入 Email' : EMAIL_PATTERN.test(email) ? '' : FULL_EMAIL_HINT
  fieldErrors.password = form.password ? '' : '請輸入密碼'
  if (fieldErrors.email || fieldErrors.password) {
    await nextTick()
    ;(fieldErrors.email ? emailInput : passwordInput).value?.focus()
    return
  }
  submitting.value = true
  try {
    await authStore.login(email, form.password, remember.value)
  } catch (err) {
    submitting.value = false
    if (err instanceof ApiError && err.status === 401) {
      errorMessage.value = '帳號或密碼錯誤'
      await nextTick()
      passwordInput.value?.select()
    } else if (err instanceof ApiError && err.status === 422 && invalidField(err.detail) === 'password') {
      fieldErrors.password = PASSWORD_TOO_LONG
      await nextTick()
      passwordInput.value?.focus()
    } else if (err instanceof ApiError && err.status === 422) {
      if (showEmailField.value) fieldErrors.email = FULL_EMAIL_HINT
      else errorMessage.value = '記住的 Email 不完整，請按「換帳號」重新輸入'
    } else if (err instanceof ApiError && err.status === 429) {
      errorMessage.value = limitedMessage(err)
    } else if (err instanceof ApiError) {
      errorMessage.value = otherLoginError(err)
    } else {
      errorMessage.value = '無法連線到伺服器，請稍後再試'
    }
    return
  }
  try {
    await enterAdmin()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <!-- 收合的後台側欄：登入後原地展開成真的側欄。五校名只是裝飾。 -->
    <aside class="login__rail">
      <div class="login__rail-brand">
        <img :src="crestMarkUrl" alt="" width="41" height="44" />
        <span class="login__rail-name"><strong>常春藤官網</strong><span>管理後台</span></span>
      </div>
      <p class="login__rail-campuses" aria-hidden="true">義華　明華　崇德　國際　仁武</p>
      <p class="login__rail-date num">{{ dateText }}</p>
    </aside>

    <div class="login__stage">
      <header class="login__top">
        <p class="login__site">常春藤官網後台</p>
        <p class="login__date num">{{ dateText }}</p>
      </header>

      <main class="login__main">
        <section class="login__panel" aria-labelledby="login-title">
          <h1 id="login-title" class="login__title">
            <span class="login__greet">{{ greetingLine }}</span>
            <span class="login__what">官網後台登入</span>
          </h1>

          <div v-if="lastUser" class="login__who" data-test="login-returning">
            <span class="login__avatar" aria-hidden="true">{{ (Array.from(lastUser.name)[0] ?? '').toUpperCase() }}</span>
            <span class="login__who-text">
              <strong>{{ lastUser.line }}</strong>
              <span>{{ returningMethod === 'password' ? lastUser.email : `上次用 ${returningMethod === 'line' ? 'LINE' : 'Google'} 登入` }}</span>
            </span>
            <button type="button" class="login__link" data-test="login-switch" @click="switchAccount">換帳號</button>
          </div>

          <div v-if="errorMessage" class="login__msg" data-kind="error" role="alert">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.2" /><circle cx="12" cy="16.2" r=".6" fill="currentColor" /></svg>
            <span>{{ errorMessage }}</span>
          </div>
          <div v-else-if="reasonNotice" class="login__msg" :data-kind="reasonNotice.type" role="status" data-test="login-reason">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".6" fill="currentColor" /></svg>
            <span>{{ reasonNotice.text }}</span>
            <button v-if="reasonNotice.reload" type="button" class="login__msg-action" @click="reloadPage">重新整理</button>
          </div>

          <form v-if="showPasswordForm" class="login__form" novalidate @submit.prevent="handleSubmit">
            <div v-if="showEmailField" class="login__field">
              <label class="login__label" for="admin-email">Email</label>
              <input
                id="admin-email"
                ref="emailInput"
                v-model="form.email"
                class="login__input"
                name="email"
                type="email"
                autocomplete="username"
                inputmode="email"
                autocapitalize="off"
                spellcheck="false"
                required
                :disabled="submitting"
                :aria-invalid="fieldErrors.email ? 'true' : undefined"
                :aria-describedby="fieldErrors.email ? 'admin-email-error' : undefined"
              />
              <p v-if="fieldErrors.email" id="admin-email-error" class="login__field-error">{{ fieldErrors.email }}</p>
            </div>
            <!-- 記得是誰時 Email 不再問，但留一個藏起來的帳號欄給密碼管理工具對應。 -->
            <input v-else class="visually-hidden" type="email" name="email" autocomplete="username" :value="lastUser?.email" readonly tabindex="-1" aria-hidden="true" />

            <div class="login__field login__field--password">
              <label class="login__label" for="current-password">密碼</label>
              <div class="login__password">
                <input
                  id="current-password"
                  ref="passwordInput"
                  v-model="form.password"
                  class="login__input"
                  name="password"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  required
                  :disabled="submitting"
                  :aria-invalid="fieldErrors.password ? 'true' : undefined"
                  :aria-describedby="fieldErrors.password ? 'current-password-error' : undefined"
                  @keydown="trackCapsLock"
                  @keyup="trackCapsLock"
                  @blur="capsLock = false"
                />
                <button type="button" class="login__eye" :aria-label="showPassword ? '隱藏密碼' : '顯示密碼'" :aria-pressed="showPassword" @click="togglePassword">
                  <svg v-if="!showPassword" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3.2" /></svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 4 19.5 20M9.9 9.6a3.2 3.2 0 0 0 4.4 4.7M6.6 7.2C4 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M10 5.7c.6-.1 1.3-.2 2-.2 6 0 9.5 6.5 9.5 6.5s-.8 1.5-2.3 3.1" /></svg>
                </button>
              </div>
              <!-- 畫面上在標籤右邊，鍵盤順序排在密碼欄之後：Email 按 Tab 直接到密碼。 -->
              <button type="button" class="login__link login__forgot" aria-controls="login-forgot" :aria-expanded="forgotOpen" @click="forgotOpen = !forgotOpen">忘記密碼</button>
              <p v-if="fieldErrors.password" id="current-password-error" class="login__field-error">{{ fieldErrors.password }}</p>
              <p v-if="capsLock" class="login__hint" data-test="login-caps">大寫鎖定是開著的</p>
              <p v-show="forgotOpen" id="login-forgot" class="login__hint">忘記密碼請聯絡總管理者重設。</p>
            </div>

            <div class="login__remember">
              <label data-test="login-remember"><input v-model="remember" type="checkbox" aria-describedby="login-remember-hint" :disabled="submitting" /><span>記住這台裝置 30 天</span></label>
              <span id="login-remember-hint">共用的電腦請不要勾</span>
            </div>

            <button type="submit" class="login__submit" :aria-busy="submitting"><span>登入</span></button>

            <p v-if="retryProvider" class="login__center">
              <a :href="retryProvider === 'line' ? lineLoginUrl : googleLoginUrl" class="login__link" data-test="login-retry-oauth" @click="chooseOauth(retryProvider)">{{ retryProvider === 'line' ? '使用 LINE 登入' : '使用 Google 登入' }}</a>
            </p>
          </form>

          <template v-else>
            <!-- 用 Google／LINE 繼續也吃「記住這台裝置」（網址帶 remember=1）。 -->
            <div class="login__remember">
              <label data-test="login-remember"><input v-model="remember" type="checkbox" aria-describedby="login-remember-hint" /><span>記住這台裝置 30 天</span></label>
              <span id="login-remember-hint">共用的電腦請不要勾</span>
            </div>
            <a
              v-if="returningMethod === 'line'"
              :href="lineLoginUrl"
              class="login__line-link login__continue"
              data-test="login-continue"
              @click="chooseOauth('line')"
            >
              <img src="/line-icon.png" alt="" width="48" height="48" />
              <span>用 LINE 繼續</span>
            </a>
            <a
              v-else
              :href="googleLoginUrl"
              class="login__google-link login__continue"
              data-test="login-continue"
              @click="chooseOauth('google')"
            >
              <img src="/google-g.png" alt="" width="20" height="20" />
              <span>用 Google 繼續</span>
            </a>
            <p class="login__center"><button type="button" class="login__link" data-test="login-use-password" @click="usePasswordInstead">改用密碼登入</button></p>
          </template>

          <div v-if="passkeyEnabled" class="login__passkey">
            <button type="button" class="login__google-link login__passkey-button" data-test="login-passkey" :disabled="submitting || passkeyBusy" :aria-busy="passkeyBusy" @click="handlePasskey">
              <el-icon aria-hidden="true"><Key /></el-icon>
              <span>用指紋或臉部辨識登入</span>
            </button>
          </div>

          <template v-if="!lastUser && (googleEnabled || lineEnabled)">
            <div class="login__divider">或</div>
            <div class="login__oauth" :class="{ 'is-single': oauthCount === 1 || inLineApp, 'is-line-first': lineFirst }">
              <template v-if="googleEnabled">
                <a v-if="inLineApp" :href="externalBrowserUrl" class="login__browser-link" data-test="login-open-browser">
                  <img src="/google-g.png" alt="" width="20" height="20" />
                  <span>用瀏覽器開啟，改用 Google 登入</span>
                </a>
                <a v-else :href="googleLoginUrl" class="login__google-link" @click="chooseOauth('google')">
                  <img src="/google-g.png" alt="" width="20" height="20" />
                  <span>使用 Google 登入</span>
                  <em v-if="lastMethod === 'google'" class="login__tag">上次使用</em>
                </a>
              </template>
              <a v-if="lineEnabled" :href="lineLoginUrl" class="login__line-link" @click="chooseOauth('line')">
                <img src="/line-icon.png" alt="" width="48" height="48" />
                <span>使用 LINE 登入</span>
                <em v-if="lastMethod === 'line'" class="login__tag">上次使用</em>
              </a>
            </div>
            <p class="login__note">{{ oauthHint }}</p>
          </template>
        </section>
      </main>

      <footer class="login__footer">© {{ year }} 常春藤教育機構</footer>
    </div>
  </div>
</template>

<style scoped>
/* 版型：左邊 64px 的側欄（跟後台收合後的圖示欄同寬、同色、品牌列同高），右邊是後台的淺色工作區。
   900px 以下（後台改成抽屜選單的寬度）側欄變成頂端的深色列。 */
.login {
  display: grid;
  grid-template-columns: var(--side-w-collapsed) minmax(0, 1fr);
  min-height: 100svh;
  background: var(--surface-2);
}

.login__rail {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100svh;
  overflow: hidden;
  background: var(--sidebar-bg);
  color: var(--sidebar-ink);
  /* 跟 AdminLayout 的 .side 同名：登入成功時由這條展開成真的側欄。 */
  view-transition-name: admin-side;
}

.login__rail-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--top-h);
  border-bottom: 1px solid var(--sidebar-line);
}

.login__rail-brand img {
  width: 41px;
  height: 44px;
  object-fit: contain;
}

.login__rail-name {
  display: none;
}

.login__rail-campuses {
  margin: auto 0 24px;
  align-self: center;
  writing-mode: vertical-rl;
  color: var(--sidebar-muted);
  font-size: var(--text-xs);
  letter-spacing: 0.3em;
  line-height: 1;
}

.login__rail-date {
  display: none;
}

.login__stage {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
  min-height: 100svh;
}

.login__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: var(--top-h);
  padding: 8px 40px;
}

.login__top p {
  margin: 0;
}

.login__site {
  color: var(--ink);
  font-size: var(--text-base);
  font-weight: 600;
}

.login__date {
  color: var(--ink-2);
  font-size: var(--text-base);
}

.login__main {
  display: grid;
  align-content: center;
  justify-items: center;
  padding: 16px 24px 48px;
}

.login__panel {
  display: grid;
  gap: 18px;
  width: min(388px, 100%);
}

.login__title {
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
}

.login__greet {
  color: var(--ink);
  font-size: var(--text-display);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
}

.login__what {
  color: var(--ink-2);
  font-size: var(--text-lg);
  font-weight: 500;
  line-height: 1.4;
}

/* 回訪者 */
.login__who {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.login__avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--login-soft);
  color: var(--admin-accent-strong);
  font-size: var(--text-xl);
  font-weight: 700;
}

.login__who-text {
  display: grid;
  gap: 2px;
  min-width: 0;
  margin-right: auto;
}

.login__who-text strong {
  color: var(--ink);
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.3;
}

.login__who-text span {
  overflow: hidden;
  color: var(--ink-3);
  font-size: var(--text-base);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 整體結果（帳密錯誤、限流、被導回的原因）：表單裡的一列，不是浮出來的框。 */
.login__msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius);
  font-size: var(--text-md);
  line-height: 1.5;
}

.login__msg svg {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
}

.login__msg[data-kind='error'] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-dark-2);
  font-weight: 500;
}

.login__msg[data-kind='info'] {
  background: var(--login-soft);
  color: var(--ink);
}

.login__msg[data-kind='warning'] {
  flex-wrap: wrap;
  background: var(--el-color-warning-light-9);
  color: var(--ink);
}

.login__msg[data-kind='warning'] svg {
  color: var(--el-color-warning-dark-2);
}

.login__msg span {
  flex: 1;
  min-width: 0;
}

.login__msg-action {
  min-height: 32px;
  margin-left: 28px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-base);
  cursor: pointer;
}

/* 表單 */
.login__form {
  display: grid;
  gap: 18px;
}

.login__field {
  display: grid;
  gap: 7px;
}

/* 密碼欄：「忘記密碼」畫面上在標籤右邊、DOM 在密碼欄之後（鍵盤順序）。 */
.login__field--password {
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
}

.login__field--password > * {
  grid-column: 1 / -1;
}

.login__field--password > .login__label {
  grid-row: 1;
  grid-column: 1;
}

.login__field--password > .login__forgot {
  grid-row: 1;
  grid-column: 2;
  align-self: baseline;
}

.login__label {
  color: var(--ink);
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 1.3;
}

.login__input {
  width: 100%;
  height: 50px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-lg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  appearance: none;
}

.login__input:hover {
  border-color: var(--ink-3);
}

.login__input:focus-visible {
  border-color: var(--admin-accent);
  box-shadow: 0 0 0 3px var(--login-ring);
}

.login__input[aria-invalid='true'] {
  border-color: var(--el-color-danger);
}

.login__input:disabled {
  background: var(--surface);
  color: var(--ink-2);
  opacity: 1;
}

.login__password {
  position: relative;
}

.login__password .login__input {
  padding-right: 52px;
}

.login__eye {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: calc(var(--radius) - 2px);
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}

.login__eye:hover {
  color: var(--ink);
}

.login__eye svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.login__link {
  position: relative;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-base);
  line-height: 1.3;
  text-decoration: underline;
  text-decoration-color: var(--line-strong);
  text-underline-offset: 3px;
  cursor: pointer;
}

/* 文字連結的可點範圍補到 44px 高，不改排版。 */
.login__link::after {
  content: '';
  position: absolute;
  inset: -13px -8px;
}

.login__link:hover {
  color: var(--ink);
  text-decoration-color: currentColor;
}

/* 欄位錯誤：同步顯示、佔位，出現時把下面往下推。 */
.login__field-error,
.login__hint {
  margin: 0;
  font-size: var(--text-base);
  line-height: 1.45;
}

.login__field-error {
  color: var(--el-color-danger);
  font-weight: 500;
}

.login__hint {
  color: var(--ink-2);
}

/* 記住這台裝置（2026-11-19）：勾選框與字整個可點；提醒字跟在後面，窄的時候換到下一行。 */
.login__remember {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 12px;
  row-gap: 2px;
}

.login__remember label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  color: var(--ink);
  font-size: var(--text-base);
  cursor: pointer;
}

.login__remember input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--admin-accent-strong);
  cursor: pointer;
}

.login__remember input:disabled,
.login__remember input:disabled + span {
  cursor: default;
}

.login__remember > span {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.login__submit {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 52px;
  border: 0;
  border-radius: var(--radius);
  background: var(--admin-accent-strong);
  color: var(--surface);
  font: inherit;
  font-size: var(--text-lg);
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: background-color 0.15s, transform 0.1s;
}

.login__submit:hover {
  background: var(--admin-accent-hover);
}

.login__submit:active {
  transform: scale(0.985);
}

.login__submit[aria-busy='true'] {
  cursor: progress;
}

.login__submit[aria-busy='true'] > span {
  visibility: hidden;
}

.login__submit[aria-busy='true']::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  border: 2px solid var(--login-spinner-track);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: login-spin 0.7s linear infinite;
}

@keyframes login-spin {
  to { transform: rotate(1turn); }
}

.login__center {
  margin: 0;
  text-align: center;
}

/* 指紋／臉部辨識登入：樣子同 Google 那顆白底按鈕，佔整列。 */
.login__passkey-button {
  width: 100%;
  font-family: inherit;
  cursor: pointer;
}
.login__passkey-button:disabled {
  cursor: default;
  opacity: 0.6;
}
.login__passkey-button .el-icon {
  font-size: var(--text-xl);
}

.login__divider {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  line-height: 1;
}

.login__divider::before,
.login__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.login__oauth {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.login__oauth.is-single {
  grid-template-columns: 1fr;
}

.login__oauth.is-line-first .login__line-link {
  order: -1;
}

.login__note {
  margin: -6px 0 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
  line-height: 1.5;
  text-align: center;
  text-wrap: balance;
}

/* Google、LINE 按鈕的顏色依官方規範，token 在 style.css（第三方品牌規範色，不跟主題）。 */
.login__google-link,
.login__line-link,
.login__browser-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 48px;
  padding: 0 12px;
  border-radius: var(--radius);
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  transition: border-color 0.15s, transform 0.1s;
}

.login__google-link:active,
.login__line-link:active {
  transform: scale(0.985);
}

.login__google-link {
  border: 1px solid var(--google-button-stroke);
  background: var(--google-button-fill);
  color: var(--google-button-text);
}

.login__google-link:hover {
  border-color: var(--admin-accent-strong);
  text-decoration: none;
}

.login__google-link img,
.login__browser-link img {
  width: 18px;
  height: 18px;
}

/* LINE 官方按鈕規範（色值見 style.css）：綠底、白色圖示與文字，hover／press 疊 10%／30% 黑。
   圖示取自官方素材包，比例不可改。 */
.login__line-link {
  --line-button-overlay: transparent;
  background: linear-gradient(var(--line-button-overlay), var(--line-button-overlay)), var(--line-button-fill);
  color: var(--line-button-ink);
}

.login__line-link img {
  width: 30px;
  height: 30px;
  margin: 0 -4px 0 -6px;
}

.login__line-link:hover {
  --line-button-overlay: var(--line-button-hover-overlay);
  text-decoration: none;
}

.login__line-link:active {
  --line-button-overlay: var(--line-button-press-overlay);
}

.login__browser-link {
  border: 1px dashed var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  font-weight: 500;
}

.login__browser-link:hover {
  border-color: var(--ink-3);
  text-decoration: none;
}

.login__continue {
  min-height: 52px;
  font-size: var(--text-lg);
}

.login__tag {
  position: absolute;
  top: -9px;
  right: 10px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--surface);
  font-size: var(--text-xs);
  font-style: normal;
  font-weight: 600;
  line-height: 1.1;
}

.login__link:focus-visible,
.login__remember input:focus-visible,
.login__eye:focus-visible,
.login__submit:focus-visible,
.login__msg-action:focus-visible,
.login__google-link:focus-visible,
.login__line-link:focus-visible,
.login__browser-link:focus-visible {
  outline: 2px solid var(--admin-accent-strong);
  outline-offset: 2px;
}

.login__footer {
  padding: 0 40px 24px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  text-align: right;
}

/* 矮的筆電（1366×657、1280×720）：登入鈕要在第一屏。 */
@media (min-width: 901px) and (max-height: 720px) {
  .login__main { padding-bottom: 16px; }
  .login__panel { gap: 14px; }
  .login__title { gap: 6px; margin-bottom: 6px; }
  .login__greet { font-size: var(--text-display-sm); }
  .login__form { gap: 14px; }
  .login__input { height: 46px; }
  .login__submit { height: 48px; }
  .login__footer { padding-bottom: 14px; }
}

/* 900px 以下後台是抽屜選單：側欄變成頂端的深色列，帶品牌名與日期。 */
@media (max-width: 900px) {
  .login {
    display: block;
  }

  .login__rail {
    position: static;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    height: 60px;
    padding: 0 16px;
    view-transition-name: none;
  }

  .login__rail-brand {
    gap: 10px;
    min-height: 0;
    border: 0;
  }

  .login__rail-brand img {
    width: 34px;
    height: 36px;
  }

  .login__rail-name {
    display: grid;
    gap: 2px;
  }

  .login__rail-name strong {
    font-size: var(--text-md);
    font-weight: 600;
    line-height: 1.2;
  }

  .login__rail-name span {
    color: var(--sidebar-muted);
    font-size: var(--text-xs);
  }

  .login__rail-campuses,
  .login__top {
    display: none;
  }

  .login__rail-date {
    display: block;
    margin: 0;
    color: var(--sidebar-muted);
    font-size: var(--text-sm);
  }

  .login__stage {
    min-height: calc(100svh - 60px);
  }

  .login__main {
    align-content: start;
    padding: 28px 20px 24px;
  }

  .login__greet {
    font-size: var(--text-display-sm);
  }

  .login__title {
    gap: 6px;
    margin-bottom: 4px;
  }

  .login__footer {
    padding: 0 20px 20px;
    text-align: center;
  }
}

@media (max-width: 420px) {
  .login__oauth {
    gap: 8px;
  }

  .login__oauth:not(.is-single) a {
    gap: 7px;
    padding: 0 8px;
    font-size: var(--text-base);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login__submit[aria-busy='true']::after {
    animation-duration: 1.6s;
  }
}
</style>
