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
      <div style="display: flex; align-items: center; gap: 1.5rem">
        <strong>常春藤官網後台</strong>
        <nav style="display: flex; gap: 1rem">
          <router-link to="/">使用者管理</router-link>
          <router-link to="/content/home-about">關於常春藤</router-link>
          <router-link to="/content/home-hero">首頁 Hero</router-link>
          <router-link to="/content/site-footer">頁尾標語</router-link>
          <router-link to="/media">素材庫</router-link>
          <router-link to="/booking">預約設定</router-link>
        </nav>
      </div>
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
