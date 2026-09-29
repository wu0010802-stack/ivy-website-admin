<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock, User } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError, BASE_URL } from '../api/client'
import type { AuthProviders } from '../api/types'
import crestUrl from '../assets/brand/ivy-crest.webp'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ email: '', password: '' })
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FULL_EMAIL_HINT = '請輸入完整的 Email，例如 name@example.com'
// 欄位問題顯示在該欄下方；帳密錯誤、限流、連線這類整體結果才用上方警示。
// 驗證刻意維持同步，重複按登入時第二次一定看得到 submitting。
const fieldErrors = reactive({ email: '', password: '' })
const emailInput = ref<{ focus: () => void } | null>(null)
const passwordInput = ref<{ focus: () => void } | null>(null)
watch(() => form.email, () => { fieldErrors.email = '' })
watch(() => form.password, () => { fieldErrors.password = '' })
const year = new Date().getFullYear()
const oauthErrors: Record<string, string> = {
  cancelled: '已取消 Google 登入，可重新選擇帳號或使用 Email 與密碼。',
  not_allowed: '這個 Google 帳號尚未取得後台權限或無法綁定，請改用帳密登入或聯絡總管理者。',
  failed: 'Google 登入未完成或已逾時，請重新登入。',
  unavailable: 'Google 登入尚未啟用，請使用 Email 與密碼。',
  rate_limited: '嘗試次數過多，請 5 分鐘後再試。',
  line_cancelled: '已取消 LINE 登入，可重新登入或使用 Email 與密碼。',
  line_not_allowed: '這個 LINE 帳號尚未綁定後台帳號，或綁定的帳號已停用。請先用 Email 與密碼登入，到「我的帳號」綁定 LINE。',
  line_failed: 'LINE 登入未完成或已逾時，請重新登入。',
  line_unavailable: 'LINE 登入尚未啟用，請使用 Email 與密碼。',
}
const errorMessage = ref<string | null>(
  typeof route.query.oauth_error === 'string' && Object.hasOwn(oauthErrors, route.query.oauth_error)
    ? oauthErrors[route.query.oauth_error] ?? null : null,
)
const submitting = ref(false)
const googleEnabled = ref(false)
const lineEnabled = ref(false)
const returnTo = computed(() => {
  const path = route.query.redirect
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return '/'
  // Only allow local router paths. The server independently validates this too.
  const pathname = path.split(/[?#]/)[0] ?? '/'
  if (
    /[\\\u0000-\u001f\u007f]/.test(path)
    || /%|(^|\/)\.{1,2}(\/|$)/.test(pathname)
    || pathname.replace(/\/+$/, '') === '/login'
  ) return '/'
  return path
})
const redirectQuery = computed(() => new URLSearchParams({ redirect: returnTo.value }).toString())
const googleLoginUrl = computed(() => `${BASE_URL}/auth/google/login?${redirectQuery.value}`)
const lineLoginUrl = computed(() => `${BASE_URL}/auth/line/login?${redirectQuery.value}`)
// LINE 沒有可信的 email，第一次一定要先在後台內綁定，入口旁要講清楚。
const oauthHints = computed(() => {
  if (googleEnabled.value && lineEnabled.value) {
    return ['Google：使用已開通後台權限的帳號', 'LINE：先用帳密登入，到「我的帳號」綁定']
  }
  return [googleEnabled.value ? '請使用已開通後台權限的 Google 帳號' : 'LINE 要先用帳密登入，在「我的帳號」綁定後才能使用']
})

onMounted(async () => {
  try {
    const providers = await api.get<AuthProviders>('/auth/providers')
    googleEnabled.value = providers.google === true
    lineEnabled.value = providers.line === true
  } catch {
    // Provider availability must never block the existing password login.
    googleEnabled.value = false
    lineEnabled.value = false
  }
})

async function handleSubmit() {
  if (submitting.value) return
  errorMessage.value = null
  const email = form.email.trim()
  // 帳號就是完整 Email；只打「admin」之類的會被後端以 422 擋下，
  // 先在這裡講清楚，不要讓人看到狀態碼。
  fieldErrors.email = !email ? '請輸入帳號（Email）' : EMAIL_PATTERN.test(email) ? '' : FULL_EMAIL_HINT
  fieldErrors.password = form.password ? '' : '請輸入密碼'
  if (fieldErrors.email || fieldErrors.password) {
    await nextTick()
    ;(fieldErrors.email ? emailInput : passwordInput).value?.focus()
    return
  }
  submitting.value = true
  try {
    await authStore.login(email, form.password)
    await router.push(returnTo.value)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      errorMessage.value = '帳號或密碼錯誤'
    } else if (err instanceof ApiError && err.status === 422) {
      fieldErrors.email = FULL_EMAIL_HINT
    } else if (err instanceof ApiError && err.status === 429) {
      errorMessage.value = '嘗試次數過多，請 5 分鐘後再試'
    } else if (err instanceof ApiError) {
      errorMessage.value = `登入失敗（${err.status}）`
    } else {
      errorMessage.value = '無法連線到伺服器，請稍後再試'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <main class="login__shell">
      <div class="login__brand">
        <img :src="crestUrl" alt="常春藤 IVY KIDS" width="714" height="760" class="login__crest" fetchpriority="high" />
      </div>

      <section class="login__card" aria-labelledby="login-title">
        <h1 id="login-title">官網後台登入</h1>

        <el-alert
          v-if="errorMessage"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
          class="login__alert"
        />

        <el-form label-position="top" size="large" class="login__form" @submit.prevent="handleSubmit" novalidate>
          <el-form-item label="帳號" for="admin-email" required :error="fieldErrors.email" :show-message="false">
            <el-input
              ref="emailInput"
              id="admin-email"
              name="email"
              v-model="form.email"
              type="email"
              autocomplete="username"
              required
              inputmode="email"
              placeholder="請輸入 Email"
              :prefix-icon="User"
              autofocus
              :disabled="submitting"
              :aria-invalid="fieldErrors.email ? 'true' : undefined"
              :aria-describedby="fieldErrors.email ? 'admin-email-error' : undefined"
            />
            <p v-if="fieldErrors.email" id="admin-email-error" class="login__field-error">{{ fieldErrors.email }}</p>
          </el-form-item>
          <el-form-item label="密碼" for="current-password" required :error="fieldErrors.password" :show-message="false">
            <el-input
              ref="passwordInput"
              id="current-password"
              name="password"
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              required
              placeholder="請輸入密碼"
              :prefix-icon="Lock"
              show-password
              :disabled="submitting"
              :aria-invalid="fieldErrors.password ? 'true' : undefined"
              :aria-describedby="fieldErrors.password ? 'current-password-error' : undefined"
            />
            <p v-if="fieldErrors.password" id="current-password-error" class="login__field-error">{{ fieldErrors.password }}</p>
          </el-form-item>
          <el-button type="primary" size="large" native-type="submit" :loading="submitting" class="login__submit">
            登入
          </el-button>
        </el-form>

        <template v-if="googleEnabled || lineEnabled">
          <div class="login__divider">或</div>
          <div class="login__oauth">
            <a v-if="googleEnabled" :href="googleLoginUrl" class="login__google-link">
              <img src="/google-g.png" alt="" width="20" height="20" />
              <span>使用 Google 登入</span>
            </a>
            <a v-if="lineEnabled" :href="lineLoginUrl" class="login__line-link">
              <img src="/line-icon.png" alt="" width="48" height="48" />
              <span>使用 LINE 登入</span>
            </a>
            <p>
              <template v-for="(hint, index) in oauthHints" :key="hint"><br v-if="index" />{{ hint }}</template>
            </p>
          </div>
        </template>

        <p class="login__foot">忘記密碼請聯絡總管理者重設。</p>
      </section>
    </main>

    <footer class="login__footer">
      <p class="login__footer-name">常春藤教育機構 ・ 官網後台</p>
      <p>© {{ year }} 常春藤教育機構 版權所有</p>
    </footer>
  </div>
</template>

<style scoped>
/* 版型比照園務系統（ivy-frontend）登入頁：左邊去背 logo、右邊登入卡、底部版權。
   標題寫「官網後台登入」而不是「管理員登入」，兩個系統長得像，靠標題分辨。 */
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  padding: clamp(32px, 6vw, 72px) 24px 32px;
  background: var(--login-bg);
}

.login__shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  align-items: center;
  gap: clamp(40px, 8vw, 96px);
  width: min(100%, 980px);
}

.login__brand {
  display: flex;
  justify-content: center;
}

.login__crest {
  width: min(100%, 420px);
  height: auto;
  filter: drop-shadow(0 10px 24px var(--login-crest-shadow));
}

.login__card {
  padding: 32px 28px 24px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
}

.login__card h1 {
  margin-bottom: 24px;
  font-size: 24px;
  text-align: center;
}

.login__alert {
  margin-bottom: 20px;
}

.login__form :deep(.el-form-item) {
  margin-bottom: 20px;
}

.login__form :deep(.el-form-item__label) {
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
}

.login__form :deep(.el-input__wrapper) {
  min-height: 52px;
  padding: 0 16px;
}

.login__form :deep(.el-input__inner) {
  font-size: 16px;
}

.login__form :deep(.el-input__prefix) {
  color: var(--ink-3);
  font-size: 18px;
}

/* 錯誤字自己畫：Element Plus 的是絕對定位的 12px（長提示會壓到下一欄標籤），
   而且延遲約 100ms 才出現。這裡同步顯示、佔位，出現時把下面往下推；
   el-form-item 只負責紅框（:error）。 */
.login__field-error {
  margin: 0;
  padding-top: 6px;
  color: var(--el-color-danger);
  font-size: 13px;
  line-height: 1.45;
}

.login__submit {
  width: 100%;
  min-height: 52px;
  margin-top: 4px;
  font-size: 16px;
  font-weight: 600;
}

.login__divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0 20px;
  color: var(--ink-3);
  font-size: 13px;
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
  gap: 10px;
}

.login__oauth p {
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}

.login__google-link {
  --google-button-fill: #fff;
  --google-button-stroke: #747775;
  --google-button-text: #1f1f1f;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 12px;
  border: 1px solid var(--google-button-stroke);
  border-radius: var(--radius);
  background: var(--google-button-fill);
  color: var(--google-button-text);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}

.login__google-link:hover {
  border-color: var(--admin-accent-strong);
  text-decoration: none;
}

.login__google-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

/* LINE 官方按鈕規範：#06C755 底、白色圖示與文字、8% 黑分隔線，
   hover／press 疊 10%／30% 黑。圖示取自官方素材包，比例不可改。 */
.login__line-link {
  --line-button-fill: #06c755;
  --line-button-ink: #fff;
  --line-button-separator: rgb(0 0 0 / 0.08);
  --line-button-overlay: transparent;
  display: flex;
  align-items: stretch;
  min-height: 48px;
  overflow: hidden;
  border-radius: var(--radius);
  background: linear-gradient(var(--line-button-overlay), var(--line-button-overlay)), var(--line-button-fill);
  color: var(--line-button-ink);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}

.login__line-link img {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-right: 1px solid var(--line-button-separator);
}

.login__line-link span {
  display: grid;
  flex: 1;
  place-items: center;
  /* 右側補一個圖示寬，文字才會落在整顆按鈕的正中央，與 Google 對齊。 */
  padding-right: 48px;
}

.login__line-link:hover {
  --line-button-overlay: rgb(0 0 0 / 0.1);
  text-decoration: none;
}

.login__line-link:active {
  --line-button-overlay: rgb(0 0 0 / 0.3);
}

.login__line-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.login__foot {
  margin-top: 20px;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}

.login__footer {
  position: relative;
  width: min(100%, 980px);
  margin-top: clamp(40px, 6vw, 64px);
  padding-top: 20px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

/* 兩端淡出的分隔線，畫在偽元素上，不當成文字的底色。 */
.login__footer::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: linear-gradient(to right, transparent, var(--line-strong), transparent);
}

.login__footer-name {
  margin-bottom: 2px;
  color: var(--ink);
  font-weight: 600;
}

@media (max-width: 900px) {
  .login {
    justify-content: flex-start;
    padding: 32px 16px 24px;
  }

  .login__shell {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    max-width: 440px;
  }

  .login__crest {
    width: min(56vw, 220px);
  }
}

@media (max-width: 420px) {
  .login__card {
    padding: 24px 18px 20px;
  }

  .login__card h1 {
    margin-bottom: 20px;
    font-size: 22px;
  }
}
</style>
