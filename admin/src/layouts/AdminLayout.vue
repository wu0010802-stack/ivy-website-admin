<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowDown } from '@element-plus/icons-vue'
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
        <nav style="display: flex; gap: 1rem; flex-wrap: wrap; max-width: 900px">
          <router-link to="/">總覽</router-link>
          <router-link to="/users">使用者管理</router-link>
          <el-dropdown>
            <span class="el-dropdown-link" style="cursor: pointer; color: var(--el-color-primary)">
              內容管理 <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item><router-link to="/content/home-about">關於常春藤</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/home-hero">首頁 Hero</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/home-campus-board">首頁五校區塊</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/day-experience">孩子的一天</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/campus-profile">五校介紹</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/campus-faq">各校 FAQ</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/campus-tour">校園探索</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/booking-content">預約文案</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/site-footer">頁尾文字</router-link></el-dropdown-item>
                <el-dropdown-item><router-link to="/content/site-meta">網站標題／電話</router-link></el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <router-link to="/media">素材庫</router-link>
          <router-link to="/booking">預約設定</router-link>
          <router-link to="/slots">時段管理</router-link>
          <router-link to="/visit-requests">參觀案件</router-link>
          <router-link to="/notifications">站內通知</router-link>
          <router-link to="/analytics">成效統計</router-link>
          <router-link to="/audit">操作紀錄</router-link>
          <router-link to="/policies">設定與政策</router-link>
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
