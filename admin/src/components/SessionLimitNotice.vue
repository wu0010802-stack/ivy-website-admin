<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

// 登入滿 12 小時的硬上限（後端 SESSION_TTL）：閒置延長推不過去。剩 15 分鐘時在頁首
// 下方提醒先儲存（2026-10-03 第八輪 D12）。不提供「延長登入」：重新登入會撤銷這個
// session，要另做後端流程。到期之後由 router/unauthorized.ts 的「登入已逾時」接手。
const WARN_BEFORE_MS = 15 * 60 * 1000
const auth = useAuthStore()
const now = ref(Date.now())
const timer = window.setInterval(() => { now.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(timer))

const expiresAt = computed(() => (auth.sessionMaxExpiresAt ? Date.parse(auth.sessionMaxExpiresAt) : Number.NaN))
const shown = computed(() => {
  if (!auth.user || Number.isNaN(expiresAt.value)) return false
  const left = expiresAt.value - now.value
  return left > 0 && left <= WARN_BEFORE_MS
})
const clock = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' })
const until = computed(() => (Number.isNaN(expiresAt.value) ? '' : clock.format(new Date(expiresAt.value))))
</script>

<template>
  <el-alert
    v-if="shown"
    class="session-limit"
    type="warning"
    :closable="false"
    show-icon
    role="status"
    :title="`登入會在 ${until} 到期（每次登入最長 12 小時）`"
  >
    <p>還沒儲存的修改請先儲存。到期後要重新登入；這一頁的修改會留在畫面上，重新登入後再按一次儲存。</p>
  </el-alert>
</template>

<style scoped>
.session-limit { margin-bottom: 16px; }
.session-limit p { margin: 4px 0 0; }
</style>
