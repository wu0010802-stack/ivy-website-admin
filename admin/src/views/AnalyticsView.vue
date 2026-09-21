<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const campusKey = ref('')
const funnel = ref<Record<string, number> | null>(null)

async function load() {
  if (!campusKey.value) return
  funnel.value = await api.get<Record<string, number>>(
    `/admin/analytics/funnel?campus_key=${campusKey.value}`
  )
}

watch(campusKey, load)

onMounted(() => {
  if (visibleCampusKeys.value.length > 0) {
    campusKey.value = visibleCampusKeys.value[0]
  }
})
</script>

<template>
  <div>
    <h2>成效統計</h2>
    <p style="color: var(--el-text-color-secondary)">
      去識別化事件計數；點擊類事件由訪客端回報，「已建立需求／已確認／已完成」只由伺服器內部流程產生，不接受偽造。
    </p>
    <el-select v-model="campusKey" style="margin-bottom: 1rem">
      <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
    </el-select>

    <el-descriptions v-if="funnel" :column="1" border>
      <el-descriptions-item label="LINE 點擊">{{ funnel.cta_click_line }}</el-descriptions-item>
      <el-descriptions-item label="電話點擊">{{ funnel.cta_click_phone }}</el-descriptions-item>
      <el-descriptions-item label="外部網站點擊">{{ funnel.cta_click_external }}</el-descriptions-item>
      <el-descriptions-item label="已建立需求">{{ funnel.request_created }}</el-descriptions-item>
      <el-descriptions-item label="已確認預約">{{ funnel.visit_confirmed }}</el-descriptions-item>
      <el-descriptions-item label="已完成參觀">{{ funnel.visit_completed }}</el-descriptions-item>
    </el-descriptions>
  </div>
</template>
