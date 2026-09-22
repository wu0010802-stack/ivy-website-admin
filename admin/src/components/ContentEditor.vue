<script setup lang="ts">
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { formatDateTime } from '../api/labels'
import type { ContentEditorState } from '../composables/useContentItem'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

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

type Tone = 'success' | 'warning' | 'info'

const status = computed<{ tone: Tone; label: string; detail: string }>(() => {
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

// 發布是對外動作：按下去官網立刻換掉，後台沒有回到上一版的介面。
// 先講清楚「現在官網是哪一版」和「按下去會立刻生效」再問。
async function publishWithConfirm() {
  const current = isPublished.value
    ? `官網目前顯示的是 ${formatDateTime(latestRevisionAt.value)} 的版本。`
    : neverPublished.value
      ? '官網目前顯示的是預設文字。'
      : '官網目前顯示的是上一版。'
  try {
    await ElMessageBox.confirm(`${current}發布後家長立刻看到這一版。`, '發布到官網？', {
      confirmButtonText: isDirty.value ? '儲存並發布' : '發布',
      cancelButtonText: '先不要',
      type: 'warning',
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
      </div>

      <div class="editor__body panel" :inert="busy || undefined" :aria-busy="busy">
        <div class="panel__body">
          <slot />
        </div>
      </div>

      <div class="editor__actions" :class="{ 'is-dirty': isDirty }">
        <div class="editor__actions-state">
          <strong>{{ busy ? '正在處理，請稍候…' : isDirty ? '修改尚未儲存' : latestRevisionAt ? '內容已儲存' : '尚未建立內容' }}</strong>
          <span>儲存草稿不會更動官網，發布後才會公開。</span>
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
        <el-button
          :loading="publishing"
          :disabled="busy || !canPublish"
          class="editor__publish"
          @click="publishWithConfirm()"
        >
          {{ isDirty ? '儲存並發布到官網' : '發布到官網' }}
        </el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
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

.editor__status div {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.editor__actions-state { display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
.editor__actions-state span { color: var(--ink-3); }
.editor__actions.is-dirty .editor__actions-state strong { color: var(--brand-gold-ink); }
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
