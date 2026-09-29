<script setup lang="ts">
// 本人改密碼。成功後其他裝置登出，這個分頁保留登入。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'

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
const valid = computed(() => Boolean(form.current) && form.next.length >= 12 && form.next === form.confirm)

async function submit() {
  if (!valid.value) return
  saving.value = true
  error.value = null
  try {
    await api.post('/auth/change-password', { current_password: form.current, new_password: form.next })
    visible.value = false
    ElMessage.success('密碼已更新，其他裝置已登出')
  } catch (err) {
    error.value = err instanceof ApiError && typeof err.detail === 'string' ? err.detail : '更新失敗，請稍後再試'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="更改密碼" width="400px" append-to-body :close-on-click-modal="!saving">
    <el-form label-position="top" :disabled="saving" @submit.prevent="submit">
      <el-form-item label="目前的密碼">
        <el-input v-model="form.current" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="新密碼">
        <el-input v-model="form.next" type="password" show-password autocomplete="new-password" />
        <span class="field-help">至少 12 字元（目前 {{ form.next.length }} 字）。</span>
      </el-form-item>
      <el-form-item label="再輸入一次新密碼" :error="mismatch ? '兩次輸入的新密碼不一樣' : ''">
        <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" @keydown.enter="submit" />
      </el-form-item>
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!valid" @click="submit">更新密碼</el-button>
    </template>
  </el-dialog>
</template>
