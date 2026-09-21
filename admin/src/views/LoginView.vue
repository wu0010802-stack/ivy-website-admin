<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ApiError } from '../api/client'

const authStore = useAuthStore()
const router = useRouter()

const form = reactive({ email: '', password: '' })
const errorMessage = ref<string | null>(null)
const submitting = ref(false)

async function handleSubmit() {
  errorMessage.value = null
  submitting.value = true
  try {
    await authStore.login(form.email, form.password)
    router.push({ name: 'dashboard' })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      errorMessage.value = '帳號或密碼錯誤'
    } else if (err instanceof ApiError && err.status === 429) {
      errorMessage.value = '嘗試次數過多，請稍後再試'
    } else {
      errorMessage.value = err instanceof Error ? err.message : '登入失敗'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh">
    <el-card style="width: 360px">
      <template #header>常春藤官網後台登入</template>
      <el-form label-position="top" @submit.prevent="handleSubmit">
        <el-form-item label="Email">
          <el-input v-model="form.email" type="email" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密碼">
          <el-input v-model="form.password" type="password" autocomplete="current-password" show-password />
        </el-form-item>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" style="margin-bottom: 1rem" />
        <el-button type="primary" native-type="submit" :loading="submitting" style="width: 100%">
          登入
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>
