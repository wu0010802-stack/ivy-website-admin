<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { campusLabels } from '../api/labels'
import { useAuthStore } from '../stores/auth'

interface DashboardSummary {
  today_visits: number
  pending_follow_up: number
  pending_publish: number
  campuses_without_active_booking: string[]
  failed_notifications: number
}

const authStore = useAuthStore()
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    summary.value = await api.get<DashboardSummary>('/admin/dashboard')
  } catch {
    error.value = '無法讀取總覽資料'
  } finally {
    loading.value = false
  }
}

const todayLabel = new Intl.DateTimeFormat('zh-TW', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
  timeZone: 'Asia/Taipei',
}).format(new Date())

const hasTodo = computed(() => {
  const s = summary.value
  if (!s) return false
  return (
    s.pending_follow_up > 0 ||
    s.pending_publish > 0 ||
    s.failed_notifications > 0 ||
    s.campuses_without_active_booking.length > 0
  )
})

onMounted(load)
</script>

<template>
  <div class="page">
    <p class="dash__date">{{ todayLabel }}</p>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="dash__alert">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <el-skeleton v-else-if="loading" animated :rows="3" />

    <template v-else-if="summary">
      <div class="stat-list">
        <router-link class="stat" to="/visit-requests?status=confirmed">
          <span class="stat__label">今日參觀</span>
          <span class="stat__value">{{ summary.today_visits }}</span>
          <span class="stat__hint">已確認、排在今天的案件</span>
        </router-link>
        <router-link class="stat" to="/visit-requests?status=new">
          <span class="stat__label">待處理需求</span>
          <span class="stat__value" :class="{ 'is-attention': summary.pending_follow_up > 0 }">
            {{ summary.pending_follow_up }}
          </span>
          <span class="stat__hint">家長送出、尚未聯絡確認</span>
        </router-link>
        <router-link class="stat" to="/content/home-hero">
          <span class="stat__label">未發布的草稿</span>
          <span class="stat__value" :class="{ 'is-attention': summary.pending_publish > 0 }">
            {{ summary.pending_publish }}
          </span>
          <span class="stat__hint">儲存過草稿但從未發布的內容</span>
        </router-link>
        <router-link class="stat" to="/notifications">
          <span class="stat__label">通知寄送失敗</span>
          <span class="stat__value" :class="{ 'is-danger': summary.failed_notifications > 0 }">
            {{ summary.failed_notifications }}
          </span>
          <span class="stat__hint">Email 沒有寄出的通知</span>
        </router-link>
      </div>

      <el-alert
        v-if="summary.campuses_without_active_booking.length > 0"
        type="warning"
        :closable="false"
        show-icon
        class="dash__alert"
      >
        <template #title>
          {{ campusLabels(summary.campuses_without_active_booking) }}目前暫停預約或尚未設定預約方式，官網上家長無法送出需求。
          <router-link to="/booking">前往各校預約方式</router-link>
        </template>
      </el-alert>

      <p v-if="!hasTodo" class="dash__clear">目前沒有待處理事項。</p>

      <section class="section">
        <div class="section__title"><h2>常用捷徑</h2></div>
        <div class="dash__links">
          <router-link to="/visit-requests">查看參觀案件</router-link>
          <router-link to="/slots">安排參觀時段</router-link>
          <router-link to="/media">上傳照片到素材庫</router-link>
          <router-link to="/content/campus-profile">修改各校資料</router-link>
          <router-link v-if="authStore.user?.role === 'super_admin'" to="/users">管理使用者</router-link>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dash__date {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--ink-3);
}

.dash__alert {
  margin-top: 20px;
}

.dash__alert a {
  display: inline-block;
  margin-left: 6px;
  font-weight: 500;
}

.dash__clear {
  margin-top: 20px;
  color: var(--ink-3);
}

.dash__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dash__links a {
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 13px;
}

.dash__links a:hover {
  text-decoration: none;
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}
</style>
