<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <el-container style="min-height: 100vh">
    <el-header
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--el-border-color);
      "
    >
      <strong>常春藤官網後台</strong>
      <div style="display: flex; align-items: center; gap: 1rem">
        <span v-if="authStore.user">{{ authStore.user.email }}（{{ authStore.user.role }}）</span>
        <el-button size="small" @click="handleLogout">登出</el-button>
      </div>
    </el-header>
    <el-main>
      <router-view />
    </el-main>
  </el-container>
</template>
