<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ApiError } from '../api/client'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ email: '', password: '' })
const errorMessage = ref<string | null>(null)
const submitting = ref(false)

async function handleSubmit() {
  errorMessage.value = null
  if (!form.email.trim() || !form.password) {
    errorMessage.value = '請輸入 Email 與密碼'
    return
  }
  submitting.value = true
  try {
    await authStore.login(form.email.trim(), form.password)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
    router.push(redirect && redirect.startsWith('/') ? redirect : { name: 'dashboard' })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      errorMessage.value = '帳號或密碼錯誤'
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
    <form class="login__card" @submit.prevent="handleSubmit" novalidate>
      <div class="login__brand">
        <img src="/favicon.svg" alt="" width="40" height="40" />
        <h1>常春藤官網後台</h1>
        <p>管理五校官網內容與參觀預約</p>
      </div>

      <el-form label-position="top" size="large" @submit.prevent>
        <el-form-item label="Email">
          <el-input
            v-model="form.email"
            type="email"
            autocomplete="username"
            inputmode="email"
            autofocus
            :disabled="submitting"
          />
        </el-form-item>
        <el-form-item label="密碼">
          <el-input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            show-password
            :disabled="submitting"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
        class="login__alert"
      />

      <el-button type="primary" size="large" native-type="submit" :loading="submitting" class="login__submit">
        登入
      </el-button>

      <p class="login__foot">忘記密碼請聯絡總管理者重設。</p>
    </form>
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
