<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { formatDateTime } from '../api/labels'
import type { ErrorGroupListOut, ErrorGroupOut, ErrorGroupsResolvedOut } from '../api/types'
import { notifyError } from '../composables/notify'
import {
  ERROR_SOURCE_LABELS,
  ERROR_STATUS_TABS,
  errorTitle,
  formatRelativeTime,
  type ErrorStatusFilter,
} from '../utils/errorReportFormat'

// 系統狀態頁的「錯誤回報」（2026-11-05）：官網、後台與 API 的未處理錯誤，同一種錯誤一列。
// 標為已處理後，同一種錯誤再發生會自動回到「未處理」。後端：GET /admin/error-groups。

const emit = defineEmits<{ changed: [] }>()

const status = ref<ErrorStatusFilter>('open')
const data = ref<ErrorGroupListOut | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const expanded = ref<Set<number>>(new Set())
const resolving = ref<Set<number>>(new Set())
const resolvingAll = ref(false)

const items = computed(() => data.value?.items ?? [])
const openCount = computed(() => data.value?.open_count ?? 0)

async function load(options: { quiet?: boolean } = {}) {
  const quiet = Boolean(options.quiet) && data.value !== null
  if (!quiet) loading.value = true
  try {
    data.value = await api.get<ErrorGroupListOut>(`/admin/error-groups?status=${status.value}&limit=50`)
    loadError.value = null
  } catch (err) {
    const message = apiErrorMessage(err, '讀不到錯誤回報，請重新載入')
    if (quiet) notifyError(message)
    else loadError.value = message
  } finally {
    loading.value = false
  }
}

function setStatus(value: string | number | boolean | undefined) {
  status.value = value as ErrorStatusFilter
  void load()
}

function toggle(id: number) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

async function resolve(item: ErrorGroupOut) {
  if (resolving.value.has(item.id)) return
  resolving.value = new Set(resolving.value).add(item.id)
  try {
    await api.post<ErrorGroupOut>(`/admin/error-groups/${item.id}/resolve`)
    ElMessage.success('已標為已處理')
    await load({ quiet: true })
    emit('changed')
  } catch (err) {
    notifyError(apiErrorMessage(err, '沒有標成功，請稍後再試'))
  } finally {
    const next = new Set(resolving.value)
    next.delete(item.id)
    resolving.value = next
  }
}

async function resolveAll() {
  if (resolvingAll.value || !openCount.value) return
  try {
    await ElMessageBox.confirm(
      `目前 ${openCount.value} 種未處理的錯誤都會標為已處理；之後同一種錯誤再發生，會重新列在「未處理」。`,
      '全部標為已處理？',
      { confirmButtonText: '全部標為已處理', cancelButtonText: '先不要', type: 'warning', autofocus: false },
    )
  } catch {
    return
  }
  resolvingAll.value = true
  try {
    await api.post<ErrorGroupsResolvedOut>('/admin/error-groups/resolve-all')
    ElMessage.success('已全部標為已處理')
    await load({ quiet: true })
    emit('changed')
  } catch (err) {
    notifyError(apiErrorMessage(err, '沒有標成功，請稍後再試'))
  } finally {
    resolvingAll.value = false
  }
}

defineExpose({ reload: () => load({ quiet: true }) })
onMounted(() => load())
</script>

<template>
  <section id="errors" class="panel" aria-labelledby="status-errors">
    <div class="panel__head">
      <h2 id="status-errors">錯誤回報</h2>
      <div class="errors__tools">
        <el-radio-group :model-value="status" size="small" aria-label="錯誤狀態" @update:model-value="setStatus">
          <el-radio-button v-for="tab in ERROR_STATUS_TABS" :key="tab.key" :value="tab.key">
            {{ tab.label }}<template v-if="tab.key === 'open' && openCount">（{{ openCount }}）</template>
          </el-radio-button>
        </el-radio-group>
        <el-button v-if="openCount" size="small" :loading="resolvingAll" @click="resolveAll">全部標為已處理</el-button>
      </div>
    </div>

    <el-alert v-if="loadError && !data" type="error" :closable="false" show-icon :title="loadError" class="errors__alert">
      <el-button size="small" :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="3" class="errors__skeleton" />
    <p v-else-if="!items.length" class="empty-note errors__empty">目前沒有錯誤</p>
    <ul v-else class="error-list">
      <li v-for="item in items" :key="item.id" class="error-row" :data-id="item.id">
        <div class="error-row__head">
          <el-tag :type="item.source === 'api' ? 'danger' : 'info'" size="small" disable-transitions>{{ ERROR_SOURCE_LABELS[item.source] }}</el-tag>
          <span class="error-row__title">{{ errorTitle(item) }}</span>
        </div>
        <p class="error-row__meta">
          <span>頁面 <span class="mono">{{ item.path }}</span></span>
          <span class="num">{{ item.count }} 次</span>
          <span>最後發生 <time :datetime="item.last_seen_at" :title="formatDateTime(item.last_seen_at)">{{ formatRelativeTime(item.last_seen_at) }}</time></span>
          <span>首次發生 <time :datetime="item.first_seen_at" :title="formatDateTime(item.first_seen_at)">{{ formatDateTime(item.first_seen_at) }}</time></span>
        </p>
        <div class="error-row__actions">
          <el-button link type="primary" size="small" :aria-expanded="expanded.has(item.id)" :aria-controls="`error-detail-${item.id}`" @click="toggle(item.id)">
            {{ expanded.has(item.id) ? '收起堆疊' : '展開堆疊' }}
          </el-button>
          <el-button v-if="!item.resolved_at" size="small" :loading="resolving.has(item.id)" @click="resolve(item)">標為已處理</el-button>
          <span v-else class="hint">已於 {{ formatDateTime(item.resolved_at) }} 標為已處理</span>
        </div>
        <div v-if="expanded.has(item.id)" :id="`error-detail-${item.id}`" class="error-row__detail">
          <p class="hint">
            <template v-if="item.location">位置 <span class="mono">{{ item.location }}</span>　</template>
            <template v-if="item.release">版本 <span class="mono">{{ item.release }}</span>　</template>
            <template v-if="item.sample_user_agent">瀏覽器 {{ item.sample_user_agent }}</template>
          </p>
          <pre class="error-row__stack mono">{{ item.sample_stack || '（沒有堆疊）' }}</pre>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.errors__tools {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.errors__alert,
.errors__skeleton,
.errors__empty {
  margin: 16px 24px;
}

.errors__alert {
  width: auto;
}

.error-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.error-row {
  padding: 12px 24px;
  border-top: 1px solid var(--line);
}

.error-row:first-child {
  border-top: 0;
}

.error-row__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.error-row__head .el-tag {
  flex: none;
  margin-top: 2px;
}

.error-row__title {
  min-width: 0;
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.error-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.error-row__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: var(--text-sm);
}

.error-row__detail {
  margin-top: 8px;
}

.error-row__detail .hint {
  margin: 0 0 6px;
  overflow-wrap: anywhere;
}

.error-row__stack {
  margin: 0;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
}

/* 標題不要被右邊的頁籤、按鈕擠成兩行（390 寬實測「錯誤回／報」）：窄螢幕讓工具列換到標題下方。 */
.panel__head h2 {
  flex: none;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .panel__head {
    flex-wrap: wrap;
  }

  .errors__tools {
    justify-content: flex-start;
  }

  .error-row {
    padding: 12px 16px;
  }

  .errors__alert,
  .errors__skeleton,
  .errors__empty {
    margin: 12px 16px;
  }
}
</style>
