<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { landingPath } from '../router/nav'

// 網址打錯或頁面已移除：留在後台版面內，側欄與登入狀態都還在，
// 附一個回到起始頁的按鈕，不要讓人面對一片空白。
const router = useRouter()
const auth = useAuthStore()
const goHome = () => router.push({ path: landingPath(auth.user?.role) })
</script>

<template>
  <div class="page not-found">
    <el-result icon="warning" title="找不到這個頁面" sub-title="網址可能打錯了，或這個頁面已經不在了。">
      <template #extra>
        <el-button type="primary" @click="goHome">回到起始頁</el-button>
      </template>
    </el-result>
  </div>
</template>
