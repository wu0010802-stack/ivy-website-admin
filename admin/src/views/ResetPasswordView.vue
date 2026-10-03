<script setup lang="ts">
// 同事點總管理者寄來的重設連結進來（/admin/reset-password#token=…），不需要登入。
// token 只放在網址 # 後面（不會送到伺服器、不進 log）；讀到就用 router.replace 清掉：
// router 自己記著目前位置，只改瀏覽器網址的話，之後寫進 history.state 的 back／current
// 還是帶著 token（同 web/app/pages/visit/manage.vue）。
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { formatShortDateTime } from '../api/labels'
import type { PasswordResetVerifyOut } from '../api/types'
import { PASSWORD_MAX_CHARS, passwordHint, passwordOk } from '../composables/passwordRules'
import crestUrl from '../assets/brand/ivy-crest.webp'

const route = useRoute()
const router = useRouter()

type PageState = 'checking' | 'ready' | 'invalid' | 'offline'
const state = ref<PageState>('checking')
const invalidMessage = ref('')
const account = ref<PasswordResetVerifyOut | null>(null)
const form = reactive({ next: '', confirm: '' })
const saving = ref(false)
const error = ref<string | null>(null)
let token = ''

const mismatch = computed(() => Boolean(form.confirm) && form.next !== form.confirm)
const valid = computed(() => passwordOk(form.next) && form.next === form.confirm)

const NO_TOKEN = '這個網址沒有重設連結的代碼（重新整理頁面後就會這樣）。請回到信裡再點一次連結；30 分鐘內、還沒設定過都可以再點。'

/** 410：連結不能用，後端的 message 已經說明原因與下一步。 */
function linkProblem(err: unknown): string | null {
  return err instanceof ApiError && err.status === 410
    ? apiErrorMessage(err, '這個重設連結已失效，請總管理者重新寄一次。')
    : null
}

function showInvalid(message: string) {
  invalidMessage.value = message
  state.value = 'invalid'
}

async function check() {
  state.value = 'checking'
  error.value = null
  try {
    account.value = await api.post<PasswordResetVerifyOut>('/auth/password-reset/verify', { token })
    state.value = 'ready'
  } catch (err) {
    const problem = linkProblem(err)
    if (problem) return showInvalid(problem)
    error.value = err instanceof ApiError ? apiErrorMessage(err, '暫時無法確認連結，請稍後再試。') : '連不上伺服器，請確認網路後再試一次。'
    state.value = 'offline'
  }
}

onMounted(async () => {
  token = new URLSearchParams(route.hash.replace(/^#/, '')).get('token') ?? ''
  if (route.hash) await router.replace({ path: route.path, query: route.query, hash: '' })
  if (!token) return showInvalid(NO_TOKEN)
  await check()
})

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = null
  try {
    await api.post('/auth/password-reset/complete', { token, new_password: form.next })
    token = ''
    await router.replace({ name: 'login', query: { reason: 'password_reset' } })
  } catch (err) {
    const problem = linkProblem(err)
    if (problem) return showInvalid(problem)
    // 422（例如超過 72 bytes 的 password_too_long）訊息是中文；其他錯誤給一般說法。
    error.value = apiErrorMessage(err, '密碼沒有更新，請稍後再試。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="reset">
    <main class="reset__card" aria-labelledby="reset-title">
      <img :src="crestUrl" alt="" class="reset__crest" width="64" height="64" />
      <h1 id="reset-title">設定新密碼</h1>

      <p v-if="state === 'checking'" class="reset__lead" role="status">正在確認連結…</p>

      <template v-else-if="state === 'invalid'">
        <el-alert type="warning" :closable="false" show-icon :title="invalidMessage" data-test="reset-invalid" />
        <router-link :to="{ name: 'login' }" class="reset__back">回登入頁</router-link>
      </template>

      <template v-else-if="state === 'offline'">
        <el-alert type="warning" :closable="false" show-icon :title="error ?? ''" />
        <el-button class="reset__retry" @click="check">再試一次</el-button>
      </template>

      <template v-else>
        <p class="reset__lead">帳號：<strong>{{ account?.email }}</strong><br />請在 {{ formatShortDateTime(account?.expires_at) }} 前設定完成。</p>
        <el-form label-position="top" :disabled="saving" @submit.prevent="submit">
          <!-- 讓密碼管理工具知道這是哪個帳號的新密碼。 -->
          <input class="visually-hidden" type="text" name="username" autocomplete="username" :value="account?.email" readonly tabindex="-1" aria-hidden="true" />
          <el-form-item label="新密碼" for="reset-new-password">
            <el-input id="reset-new-password" v-model="form.next" type="password" show-password autocomplete="new-password" :maxlength="PASSWORD_MAX_CHARS" />
            <span class="field-help" data-test="reset-password-hint">{{ passwordHint(form.next) }}</span>
          </el-form-item>
          <el-form-item label="再輸入一次新密碼" for="reset-confirm-password">
            <el-input id="reset-confirm-password" v-model="form.confirm" type="password" show-password autocomplete="new-password" :maxlength="PASSWORD_MAX_CHARS" />
            <!-- 不用 el-form-item 的 error 屬性：它要多等一個 tick 才畫出來，輸入時會慢半拍。 -->
            <span v-if="mismatch" class="reset__mismatch" role="alert">兩次輸入的新密碼不一樣</span>
          </el-form-item>
          <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="reset__error" />
          <el-button type="primary" size="large" native-type="submit" :loading="saving" :disabled="!valid" class="reset__submit">設定新密碼</el-button>
        </el-form>
        <p class="reset__foot">設定完成後，原本登入中的裝置都會登出，請用新密碼重新登入。</p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.reset {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  padding: 32px 16px;
  background: var(--login-bg);
}

.reset__card {
  width: min(100%, 420px);
  padding: 32px 28px 24px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
}

.reset__crest {
  display: block;
  margin: 0 auto 12px;
}

.reset__card h1 {
  margin-bottom: 16px;
  font-size: 24px;
  text-align: center;
}

.reset__lead {
  margin-bottom: 20px;
  line-height: 1.7;
}

.reset__back,
.reset__retry {
  display: inline-block;
  margin-top: 16px;
}

.reset__back {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.reset__mismatch {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.5;
}

.reset__error {
  margin-bottom: 16px;
}

.reset__submit {
  width: 100%;
}

.reset__foot {
  margin-top: 16px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
}
</style>
