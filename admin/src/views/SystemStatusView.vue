<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { apiErrorCode, apiErrorMessage } from '../api/errors'
import { maskEmail } from '../api/labels'
import type { SystemEmailTestOut, SystemStatusItem, SystemStatusOut } from '../api/types'
import PageHeader from '../components/PageHeader.vue'
import { notifyError } from '../composables/notify'
import { useAuthStore } from '../stores/auth'
import {
  LEVEL_LABELS,
  LEVEL_TAG_TYPES,
  TEST_EMAIL_ERROR_TEXT,
  describeItem,
  formatClock,
  itemLabel,
  itemLink,
  type StatusSection,
} from '../utils/systemStatusFormat'

interface Row { item: SystemStatusItem; label: string; text: string; link: { to: string; label: string } | null }
interface Section { key: StatusSection; title: string; rows: Row[] }

const authStore = useAuthStore()
const data = ref<SystemStatusOut | null>(null)
// loading＝第一次載入（骨架）；refreshing＝按「重新整理」時舊資料留在畫面上。不自動輪詢（規格 S12）。
const loading = ref(true)
const refreshing = ref(false)
const loadError = ref<string | null>(null)
const sending = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)

function rowsOf(items: SystemStatusItem[], section: StatusSection): Row[] {
  return items.map((item) => ({ item, label: itemLabel(item, section), text: describeItem(item, section), link: itemLink(item, section) }))
}

const sections = computed<Section[]>(() => {
  const s = data.value
  if (!s) return []
  return [
    { key: 'services', title: '對外服務設定', rows: rowsOf(s.services, 'services') },
    { key: 'background', title: '背景工作', rows: rowsOf(s.background, 'background') },
    // 招生關閉時後端不回公開資料（datasets 為 null），整區不顯示。
    ...(s.datasets ? [{ key: 'datasets' as const, title: '公開資料', rows: rowsOf(s.datasets, 'datasets') }] : []),
    { key: 'notifications', title: '通知與發布', rows: rowsOf(s.notifications, 'notifications') },
  ]
})

// 能寄測試信：有設 SMTP，或測試環境寫進本機資料夾（sink）。兩者都沒有時按鈕停用。
const canSendTest = computed(() => {
  const row = data.value?.services.find((item) => item.key === 'smtp')
  return row !== undefined && (row.level === 'ok' || Boolean(row.detail?.sink))
})

async function load(options: { quiet?: boolean } = {}) {
  const quiet = Boolean(options.quiet) && data.value !== null
  if (quiet) refreshing.value = true
  else {
    loading.value = true
    loadError.value = null
  }
  try {
    data.value = await api.get<SystemStatusOut>('/admin/system-status')
    loadError.value = null
  } catch (err) {
    const message = apiErrorMessage(err, '讀不到系統狀態，請重新載入')
    if (quiet) notifyError(message)
    else loadError.value = message
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const failedTest = (error: string | null | undefined) => ({ ok: false, text: `測試信沒有寄出：${TEST_EMAIL_ERROR_TEXT[error ?? 'other'] ?? TEST_EMAIL_ERROR_TEXT.other}` })

async function sendTest() {
  if (sending.value) return
  sending.value = true
  testResult.value = null
  try {
    const result = await api.post<SystemEmailTestOut>('/admin/system-status/test-email')
    const email = authStore.user?.email
    testResult.value = result.ok
      ? { ok: true, text: `已寄到 ${email ? maskEmail(email) : '你的帳號 Email'}，請到信箱確認` }
      : failedTest(result.error)
  } catch (err) {
    // 按下去的當下寄信設定被拿掉（409）：和回應裡的 not_configured 同一句。其他錯誤（含 429 寄太多次）用後端的訊息。
    if (apiErrorCode(err) === 'EMAIL_NOT_CONFIGURED') testResult.value = failedTest('not_configured')
    else notifyError(apiErrorMessage(err, '測試信沒有寄出，請稍後再試'))
  } finally {
    sending.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="寄信、推播、背景排程與公開資料現在是否正常。設定要改，請技術人員在部署平台調整。">
      <template #actions>
        <span v-if="data" class="hint">資料時間 {{ formatClock(data.generated_at) }}</span>
        <el-button :loading="refreshing" :disabled="loading" @click="load({ quiet: true })">重新整理</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="loadError && !data" type="error" :closable="false" show-icon :title="loadError">
      <el-button :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="8" />

    <template v-else-if="data">
      <section v-for="section in sections" :key="section.key" class="panel" :aria-labelledby="`status-${section.key}`">
        <div class="panel__head"><h2 :id="`status-${section.key}`">{{ section.title }}</h2></div>
        <ul class="status-list">
          <li v-for="row in section.rows" :key="row.item.key" class="status-row" :data-key="row.item.key">
            <div class="status-row__head">
              <span class="status-row__name">{{ row.label }}</span>
              <el-tag :type="LEVEL_TAG_TYPES[row.item.level]" size="small" disable-transitions>{{ LEVEL_LABELS[row.item.level] }}</el-tag>
            </div>
            <p class="status-row__text">{{ row.text }}</p>
            <div v-if="row.link || row.item.key === 'smtp'" class="status-row__actions">
              <router-link v-if="row.link" :to="row.link.to">{{ row.link.label }}</router-link>
              <template v-if="row.item.key === 'smtp'">
                <el-button size="small" :loading="sending" :disabled="!canSendTest" @click="sendTest">寄一封測試信給我</el-button>
                <span v-if="!canSendTest" class="hint">尚未設定寄信</span>
                <p v-if="testResult" role="status" class="status-row__result" :class="{ 'is-failed': !testResult.ok }">{{ testResult.text }}</p>
              </template>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.status-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.status-row {
  padding: 12px 24px;
  border-top: 1px solid var(--line);
}

.status-row:first-child {
  border-top: 0;
}

.status-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-row__name {
  font-weight: 600;
  color: var(--ink);
}

.status-row__text {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.status-row__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: var(--text-sm);
}

.status-row__result {
  flex-basis: 100%;
  margin: 0;
  color: var(--ink-2);
}

.status-row__result.is-failed {
  color: var(--el-color-danger);
}
</style>
