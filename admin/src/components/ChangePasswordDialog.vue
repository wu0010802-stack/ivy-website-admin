<script setup lang="ts">
// 本人改密碼。成功後其他裝置登出，這個瀏覽器保留登入（同一個 session，所有分頁共用）。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, loginLimitedMessage } from '../api/errors'
import { PASSWORD_MAX_CHARS, passwordHint, passwordOk } from '../composables/passwordRules'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
const visible = computed({ get: () => props.modelValue, set: (v: boolean) => emit('update:modelValue', v) })

const form = reactive({ current: '', next: '', confirm: '' })
const saving = ref(false)
const error = ref<string | null>(null)

watch(visible, (open) => {
  if (open) {
    form.current = ''
    form.next = ''
    form.confirm = ''
    error.value = null
  }
})

const mismatch = computed(() => Boolean(form.confirm) && form.next !== form.confirm)
const valid = computed(() => Boolean(form.current) && passwordOk(form.next) && form.next === form.confirm)

function failureText(err: unknown): string {
  // 目前的密碼跟登入共用帳號鎖（5 分鐘內錯 10 次，密碼驗證暫停 15 分鐘）。
  if (err instanceof ApiError && err.status === 429) return loginLimitedMessage(err, { verb: '驗證' })
  // 代理回的 HTML／英文原文（err.json 為 false）不直接顯示，交給 apiErrorMessage 用 fallback。
  if (err instanceof ApiError && typeof err.detail === 'string' && err.json) return err.detail
  // 422 欄位錯誤（例如新密碼超過 72 bytes 的 password_too_long，訊息是中文）。
  return apiErrorMessage(err, '更新失敗，請稍後再試')
}

async function submit() {
  if (!valid.value) return
  saving.value = true
  error.value = null
  try {
    await api.post('/auth/change-password', { current_password: form.current, new_password: form.next })
    visible.value = false
    ElMessage.success('密碼已更新，其他裝置已登出')
  } catch (err) {
    error.value = failureText(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="更改密碼" width="400px" append-to-body :close-on-click-modal="!saving">
    <el-form label-position="top" :disabled="saving" @submit.prevent="submit">
      <el-form-item label="目前的密碼">
        <el-input v-model="form.current" type="password" show-password autocomplete="current-password" :maxlength="PASSWORD_MAX_CHARS" />
      </el-form-item>
      <el-form-item label="新密碼">
        <el-input v-model="form.next" type="password" show-password autocomplete="new-password" :maxlength="PASSWORD_MAX_CHARS" />
        <span class="field-help" data-test="new-password-hint">{{ passwordHint(form.next) }}</span>
      </el-form-item>
      <el-form-item label="再輸入一次新密碼" :error="mismatch ? '兩次輸入的新密碼不一樣' : ''">
        <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" :maxlength="PASSWORD_MAX_CHARS" @keydown.enter="submit" />
      </el-form-item>
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!valid" @click="submit">更新密碼</el-button>
    </template>
  </el-dialog>
</template>
