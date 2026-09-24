<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { api, ApiError, BASE_URL } from '../api/client'
import type { AuthProviders } from '../api/types'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ email: '', password: '' })
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const oauthErrors: Record<string, string> = {
  cancelled: '已取消 Google 登入，可重新選擇帳號或使用 Email 與密碼。',
  not_allowed: '這個 Google 帳號尚未取得後台權限或無法綁定，請改用帳密登入或聯絡總管理者。',
  failed: 'Google 登入未完成或已逾時，請重新登入。',
  unavailable: 'Google 登入尚未啟用，請使用 Email 與密碼。',
  rate_limited: '嘗試次數過多，請 5 分鐘後再試。',
}
const errorMessage = ref<string | null>(
  typeof route.query.oauth_error === 'string' && Object.hasOwn(oauthErrors, route.query.oauth_error)
    ? oauthErrors[route.query.oauth_error] ?? null : null,
)
const submitting = ref(false)
const googleEnabled = ref(false)
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
const googleLoginUrl = computed(() => `${BASE_URL}/auth/google/login?${new URLSearchParams({ redirect: returnTo.value })}`)

onMounted(async () => {
  try {
    const providers = await api.get<AuthProviders>('/auth/providers')
    googleEnabled.value = providers.google === true
  } catch {
    // Provider availability must never block the existing password login.
    googleEnabled.value = false
  }
})

async function handleSubmit() {
  if (submitting.value) return
  errorMessage.value = null
  if (!form.email.trim() || !form.password) {
    errorMessage.value = '請輸入 Email 與密碼'
    return
  }
  // 帳號就是完整 Email；只打「admin」之類的會被後端以 422 擋下，
  // 先在這裡講清楚，不要讓人看到狀態碼。
  if (!EMAIL_PATTERN.test(form.email.trim())) {
    errorMessage.value = '請輸入完整的 Email，例如 name@example.com'
    return
  }
  submitting.value = true
  try {
    await authStore.login(form.email.trim(), form.password)
    await router.push(returnTo.value)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      errorMessage.value = '帳號或密碼錯誤'
    } else if (err instanceof ApiError && err.status === 422) {
      errorMessage.value = '請輸入完整的 Email，例如 name@example.com'
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
    <div class="login__card">
      <div class="login__brand">
        <img src="/favicon.svg" alt="" width="40" height="40" />
        <h1>常春藤官網後台</h1>
        <p>管理五校官網內容與參觀預約</p>
      </div>

      <div v-if="googleEnabled" class="login__google">
        <a :href="googleLoginUrl" class="login__google-link">
          <img src="/google-g.png" alt="" width="20" height="20" />
          <span>使用 Google 登入</span>
        </a>
        <p>請使用已開通後台權限的 Google 帳號</p>
        <div class="login__divider">或使用 Email 與密碼</div>
      </div>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
        class="login__alert"
      />

      <el-form label-position="top" size="large" @submit.prevent="handleSubmit" novalidate>
        <el-form-item label="Email" for="admin-email">
          <el-input
            id="admin-email"
            name="email"
            v-model="form.email"
            type="email"
            autocomplete="username"
            required
            inputmode="email"
            autofocus
            :disabled="submitting"
          />
        </el-form-item>
        <el-form-item label="密碼" for="current-password">
          <el-input
            id="current-password"
            name="password"
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            required
            show-password
            :disabled="submitting"
          />
        </el-form-item>
        <el-button type="primary" size="large" native-type="submit" :loading="submitting" class="login__submit">
          登入
        </el-button>
      </el-form>

      <p class="login__foot">忘記密碼請聯絡總管理者，由總管理者替你建立新帳號密碼。</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100svh;
  padding: 24px 16px;
  background: var(--sidebar-bg);
}

.login__card {
  width: min(400px, 100%);
  padding: 32px 32px 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.login__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 24px;
  text-align: center;
}

.login__brand img {
  margin-bottom: 6px;
}

.login__brand h1 {
  font-size: 20px;
}

.login__brand p {
  font-size: 13px;
  color: var(--ink-3);
}

.login__alert {
  margin-bottom: 16px;
}

.login__submit {
  width: 100%;
}

.login__google-link {
  --google-button-fill: #fff;
  --google-button-stroke: #747775;
  --google-button-text: #1f1f1f;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--google-button-stroke);
  border-radius: var(--radius);
  background: var(--google-button-fill);
  color: var(--google-button-text);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}

.login__google-link:hover {
  border-color: var(--admin-accent-strong);
}

.login__google-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.login__google p {
  margin-top: 8px;
  color: var(--ink-3);
  font-size: 12px;
  text-align: center;
}

.login__divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 22px 0;
  color: var(--ink-3);
  font-size: 12px;
}

.login__divider::before,
.login__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.login__foot {
  margin-top: 20px;
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
}

@media (max-width: 480px) {
  .login__card {
    padding: 24px 20px 20px;
  }
}
</style>
