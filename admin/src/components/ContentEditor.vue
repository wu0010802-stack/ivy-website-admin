<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { formatDateTime } from '../api/labels'
import type { ContentEditorState } from '../composables/useContentItem'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import ContentHistoryDrawer from './ContentHistoryDrawer.vue'

// 十個內容編輯頁共用的外殼：狀態列、載入骨架、表單插槽、黏底動作列，
// 以及「有未儲存修改就離開」的攔截。頁面只負責欄位本身。
const props = defineProps<{
  editor: ContentEditorState
  /** 尚未選校區等情況：不顯示表單，改顯示這段提示 */
  placeholder?: string
  /** 表單寬度，預設 640 */
  width?: 'narrow' | 'wide'
}>()

const loading = computed(() => props.editor.loading.value)
const loadError = computed(() => props.editor.loadError.value)
const saving = computed(() => props.editor.saving.value)
const publishing = computed(() => props.editor.publishing.value)
const isPublished = computed(() => props.editor.isPublished.value)
const isDirty = computed(() => props.editor.isDirty.value)
const neverPublished = computed(() => props.editor.neverPublished.value)
const latestRevisionAt = computed(() => props.editor.latestRevisionAt.value)
const busy = computed(() => saving.value || publishing.value)
const changes = computed(() => props.editor.changes?.value ?? [])
const previewUrl = computed(() => props.editor.previewUrl?.value ?? '')
const apiPath = computed(() => props.editor.apiPath?.value ?? '')
const historyOpen = ref(false)
const auth = useAuthStore()
// 內容編輯只能送審；總管理者與分校管理者可以直接發布、排程、審核。
const canPublishRole = computed(() => ['super_admin', 'campus_admin'].includes(auth.user?.role ?? ''))
const reviewStatus = computed(() => props.editor.reviewStatus?.value ?? 'draft')
const reviewNote = computed(() => props.editor.reviewNote?.value ?? null)
const pendingReview = computed(() => reviewStatus.value === 'pending_review' && !isDirty.value)
const scheduled = computed(() => (props.editor.schedules?.value ?? []).filter((j) => j.status === 'scheduled'))
const lastFailed = computed(() => (props.editor.schedules?.value ?? []).find((j) => j.status === 'failed') ?? null)
// 排程清單跟著內容一起換：切校區、重新載入、存檔後都重讀一次。
watch(
  () => [apiPath.value, props.editor.loading.value] as const,
  ([path, isLoading]) => {
    if (path && !isLoading && !props.editor.loadError.value) void props.editor.loadSchedules?.()
  },
  { immediate: true },
)
const scheduleOpen = ref(false)
const scheduleAt = ref<string | null>(null)

function disablePastDay(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

async function submitSchedule() {
  if (!scheduleAt.value || !props.editor.schedule) return
  if (await props.editor.schedule(scheduleAt.value)) scheduleOpen.value = false
}

async function rejectWithNote() {
  if (!props.editor.review) return
  try {
    const result = await ElMessageBox.prompt('寫下要修改的地方，編輯打開這一頁就看得到。', '退回這次送審？', {
      confirmButtonText: '退回',
      cancelButtonText: '先不要',
      inputType: 'textarea',
      inputValidator: (v: string) => Boolean((v ?? '').trim()) || '請寫下退回原因',
    })
    await props.editor.review('reject', (result as { value: string }).value.trim())
  } catch {
    /* 取消 */
  }
}

async function approve() {
  if (!props.editor.review) return
  try {
    await ElMessageBox.confirm('核准後這一版會立刻發布到官網。', '核准並發布？', {
      confirmButtonText: '核准並發布',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  await props.editor.review('approve')
}
const canShowHistory = computed(() => Boolean(apiPath.value && props.editor.restore && props.editor.publishRevision && latestRevisionAt.value))
const currentForm = computed(() => (props.editor.form?.value ?? {}) as Record<string, unknown>)

type Tone = 'success' | 'warning' | 'info'

const status = computed<{ tone: Tone; label: string; detail: string }>(() => {
  if (!isDirty.value && reviewStatus.value === 'pending_review') {
    return {
      tone: 'warning',
      label: '已送審，等待核准',
      detail: canPublishRole.value ? '內容編輯送上來的版本，檢查沒問題就核准發布，需要修改就退回並寫原因。' : '校區管理者核准後才會出現在官網；這段期間可以繼續修改，改完要重新送審。',
    }
  }
  if (!isDirty.value && reviewStatus.value === 'rejected') {
    return { tone: 'warning', label: '被退回', detail: reviewNote.value ? `原因：${reviewNote.value}` : '請修改後重新送審。' }
  }
  if (isDirty.value) {
    return { tone: 'warning', label: '有未儲存的修改', detail: '儲存草稿後才會保留；發布時會自動先儲存。' }
  }
  if (!latestRevisionAt.value) {
    return { tone: 'info', label: '尚未建立內容', detail: '填好後先儲存草稿；發布後，家長才會看到新內容。' }
  }
  if (isPublished.value) {
    return { tone: 'success', label: '官網顯示的是這一版', detail: `目前發布的版本儲存於 ${formatDateTime(latestRevisionAt.value)}。` }
  }
  return {
    tone: 'warning',
    label: '草稿尚未發布',
    detail: neverPublished.value
      ? `草稿儲存於 ${formatDateTime(latestRevisionAt.value)}，官網仍顯示預設文字。`
      : `草稿儲存於 ${formatDateTime(latestRevisionAt.value)}，官網仍是上一版。`,
  }
})

const canPublish = computed(() => isDirty.value || (Boolean(latestRevisionAt.value) && !isPublished.value))

// 發布是對外動作：按下去官網立刻換掉（改回要到「版本紀錄」）。
// 時間戳沒人記得住，改成列出「哪些欄位會變、變成什麼」再問；沒有未儲存
// 修改時（發布已存的草稿）至少講清楚官網現在是哪一版。
async function publishWithConfirm() {
  const current = isPublished.value
    ? `官網目前顯示的是 ${formatDateTime(latestRevisionAt.value)} 的版本。`
    : neverPublished.value
      ? '官網目前顯示的是預設文字。'
      : '官網目前顯示的是上一版。'
  const list = changes.value
  const message = list.length
    ? h('div', { class: 'publish-diff' }, [
        h('p', null, `這次會更新 ${list.length} 個欄位，發布後家長立刻看到：`),
        h('ul', null, list.slice(0, 8).map((c) => h('li', { key: c.key }, [
          h('strong', null, c.label),
          h('span', { class: 'publish-diff__before' }, c.before),
          h('span', { class: 'publish-diff__arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'publish-diff__after' }, c.after),
        ]))),
        list.length > 8 ? h('p', { class: 'hint' }, `還有 ${list.length - 8} 個欄位。`) : null,
        h('p', { class: 'hint' }, '發布後若要改回，可以在「版本紀錄」選舊版重新發布。'),
      ])
    : `${current}發布後家長立刻看到這一版。若要改回，可以在「版本紀錄」選舊版重新發布。`
  try {
    await ElMessageBox.confirm(message, '發布到官網？', {
      confirmButtonText: isDirty.value ? '儲存並發布' : '發布',
      cancelButtonText: '先不要',
      type: 'warning',
      customClass: list.length ? 'publish-confirm' : undefined,
    })
  } catch {
    return
  }
  await props.editor.saveAndPublish()
}

const { confirmLeave } = useUnsavedChanges(computed(() => !loading.value && !loadError.value && isDirty.value), busy)

defineExpose({ confirmLeave })
</script>

<template>
  <div class="editor" :class="{ 'editor--wide': width === 'wide' }">
    <div v-if="$slots.lead" class="page-lead"><slot name="lead" /></div>

    <div v-if="$slots.toolbar" class="toolbar"><slot name="toolbar" /></div>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" class="editor__alert">
      <el-button size="small" @click="editor.load()">重新載入</el-button>
    </el-alert>

    <el-empty v-else-if="placeholder" :description="placeholder" />

    <el-skeleton v-else-if="loading" :rows="6" animated class="editor__skeleton" />

    <template v-else>
      <div class="editor__status" :data-tone="status.tone" role="status">
        <span class="editor__dot" aria-hidden="true" />
        <div>
          <strong>{{ status.label }}</strong>
          <span>{{ status.detail }}</span>
        </div>
        <div class="editor__tools">
          <a
            v-if="previewUrl && latestRevisionAt && !isPublished"
            :href="previewUrl"
            target="_blank"
            rel="noopener"
            class="editor__tool"
          >預覽草稿 ↗</a>
          <el-button v-if="canShowHistory" text size="small" :disabled="busy" @click="historyOpen = true">版本紀錄</el-button>
        </div>
      </div>
      <div v-if="scheduled.length || lastFailed" class="editor__schedules">
        <p v-for="job in scheduled" :key="job.id">
          已排程 <strong class="num">{{ formatDateTime(job.publish_at) }}</strong> 發布第 {{ job.revision_version }} 版<template v-if="job.created_by_email">（{{ job.created_by_email }}）</template>
          <el-button v-if="canPublishRole && editor.cancelSchedule" text size="small" @click="editor.cancelSchedule!(job.id)">取消排程</el-button>
        </p>
        <p v-if="lastFailed && !scheduled.length" class="is-failed">
          {{ formatDateTime(lastFailed.publish_at) }} 的排程沒有發布：{{ lastFailed.error }}
        </p>
      </div>
      <ContentHistoryDrawer
        v-if="canShowHistory"
        v-model="historyOpen"
        :api-path="apiPath"
        :current="currentForm"
        :is-dirty="isDirty"
        :restore="editor.restore!"
        :publish-revision="editor.publishRevision!"
      />

      <div class="editor__body panel" :inert="busy || undefined" :aria-busy="busy">
        <div class="panel__body">
          <slot />
        </div>
      </div>

      <div class="editor__actions" :class="{ 'is-dirty': isDirty }">
        <div class="editor__actions-state" role="status">
          <span v-if="busy">正在處理，請稍候…</span>
          <span v-else-if="isDirty">{{ changes.length ? `改了 ${changes.length} 個欄位，` : '' }}儲存草稿不會更動官網，發布後才會公開。</span>
          <span v-else>儲存草稿不會更動官網，發布後才會公開。</span>
        </div>
        <div class="editor__buttons">
        <el-button v-if="isDirty" text :disabled="busy" @click="editor.reset()">還原修改</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="busy || !isDirty"
          @click="editor.save()"
        >
          儲存草稿
        </el-button>
        <template v-if="!canPublishRole">
          <el-button
            :loading="publishing"
            :disabled="busy || !latestRevisionAt && !isDirty || pendingReview"
            class="editor__publish"
            @click="editor.submitForReview?.()"
          >
            {{ pendingReview ? '已送審' : isDirty ? '儲存並送審' : '送審' }}
          </el-button>
        </template>
        <template v-else-if="pendingReview">
          <el-button :disabled="busy" @click="rejectWithNote">退回</el-button>
          <el-button type="success" :loading="publishing" :disabled="busy" @click="approve">核准並發布</el-button>
        </template>
        <template v-else>
          <el-button v-if="editor.schedule" :disabled="busy || !canPublish" @click="scheduleOpen = true">排程發布</el-button>
          <el-button
            :loading="publishing"
            :disabled="busy || !canPublish"
            class="editor__publish"
            @click="publishWithConfirm()"
          >
            {{ isDirty ? '儲存並發布到官網' : '發布到官網' }}
          </el-button>
        </template>
        </div>
      </div>
    </template>

    <el-dialog v-model="scheduleOpen" title="排程發布" width="400px" append-to-body>
      <p class="hint">選一個時間，到時自動把{{ isDirty ? '儲存後的' : '目前最新的' }}這一版發布到官網。之後再改內容不會影響這次排程。</p>
      <el-date-picker
        v-model="scheduleAt"
        type="datetime"
        value-format="YYYY-MM-DDTHH:mm:ss+08:00"
        format="YYYY/MM/DD HH:mm"
        :disabled-date="disablePastDay"
        :default-time="new Date(2000, 0, 1, 9, 0, 0)"
        placeholder="發布時間（台灣時間）"
        style="width: 100%"
      />
      <template #footer>
        <el-button @click="scheduleOpen = false">取消</el-button>
        <el-button type="primary" :loading="publishing" :disabled="!scheduleAt" @click="submitSchedule">{{ isDirty ? '儲存並排程' : '排程' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.editor__schedules { margin: -12px 0 20px; font-size: 13px; color: var(--ink-2); }
.editor__schedules p { margin: 0; }
.editor__schedules .is-failed { color: var(--el-color-danger); }
.editor {
  max-width: 720px;
}

.editor--wide {
  max-width: 1200px;
}

.editor__alert {
  margin-bottom: 16px;
}

.editor__status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 20px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-3);
  font-size: 13px;
  line-height: 1.45;
}

.editor__status > div:not(.editor__tools) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.editor__tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  white-space: nowrap;
}

.editor__tool {
  font-size: 13px;
}

.editor__status strong {
  color: var(--ink);
  font-weight: 600;
}

.editor__status span {
  color: var(--ink-3);
}

.editor__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--ink-3);
}

.editor__status[data-tone='success'] .editor__dot {
  background: var(--el-color-success);
}

.editor__status[data-tone='warning'] .editor__dot {
  background: var(--brand-gold);
  box-shadow: 0 0 0 1px var(--brand-gold-ink);
}

.editor__skeleton {
  padding: 20px 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}

.editor__actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 16px 0 max(16px, env(safe-area-inset-bottom));
  background: var(--surface-2);
  border-top: 1px solid var(--line);
}

.editor__actions.is-dirty {
  border-top-color: var(--line);
}

.editor__actions .el-button + .el-button {
  margin-left: 0;
}

.editor__actions-state { font-size: 13px; color: var(--ink-3); }
.editor__actions.is-dirty .editor__actions-state { color: var(--brand-gold-ink); }
.editor__buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }

@media (max-width: 720px) {
  .editor__actions {
    flex-wrap: wrap;
  }
  .editor__actions-state { font-size: 14px; }
  .editor__buttons { width: 100%; }
  .editor__buttons .el-button { flex: 1 0 auto; }
}
</style>
