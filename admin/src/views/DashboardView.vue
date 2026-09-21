<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/client'

interface DashboardSummary {
  today_visits: number
  pending_follow_up: number
  pending_publish: number
  campuses_without_active_booking: string[]
  failed_notifications: number
}

const summary = ref<DashboardSummary | null>(null)

onMounted(async () => {
  summary.value = await api.get<DashboardSummary>('/admin/dashboard')
})
</script>

<template>
  <div>
    <h2>營運總覽</h2>
    <el-row :gutter="16" v-if="summary">
      <el-col :span="6">
        <el-statistic title="今日參觀" :value="summary.today_visits" />
      </el-col>
      <el-col :span="6">
        <el-statistic title="待跟進" :value="summary.pending_follow_up" />
      </el-col>
      <el-col :span="6">
        <el-statistic title="待發布內容" :value="summary.pending_publish" />
      </el-col>
      <el-col :span="6">
        <el-statistic title="通知寄送失敗" :value="summary.failed_notifications" />
      </el-col>
    </el-row>

    <div v-if="summary && summary.campuses_without_active_booking.length > 0" style="margin-top: 1.5rem">
      <el-alert type="warning" :closable="false">
        以下校區目前預約模式為暫停或尚未設定：
        {{ summary.campuses_without_active_booking.join('、') }}
      </el-alert>
    </div>
  </div>
</template>
