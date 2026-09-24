<script setup lang="ts">
// 版本紀錄：每次儲存都是一版。可以把舊版放回草稿（確認後再發布），或
// 直接把舊版發布回官網。內容還原不動預約設定、時段與案件。
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { formatDateTime } from '../api/labels'
import { diffPayload, type FieldChange } from '../composables/useContentItem'

interface RevisionSummary {
  id: string
  version: number
  created_at: string
  created_by_email: string | null
  is_published: boolean
  ever_published: boolean
  last_published_at: string | null
}

const props = defineProps<{
  modelValue: boolean
  apiPath: string
  /** 目前表單內容，用來列出「這一版跟現在差在哪」 */
  current: Record<string, unknown>
  isDirty: boolean
  restore: (revisionId: string) => Promise<boolean>
  publishRevision: (revisionId: string) => Promise<boolean>
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const visible = computed({ get: () => props.modelValue, set: (v: boolean) => emit('update:modelValue', v) })
const rows = ref<RevisionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const expanded = ref<string | null>(null)
const diff = ref<FieldChange[]>([])
const busy = ref(false)

// apiPath 形如 /admin/content-items/home_about?campus_key=yihua
function withSegment(segment: string): string {
  const [path, qs] = props.apiPath.split('?')
  return `${path}${segment}${qs ? `?${qs}` : ''}`
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await api.get<RevisionSummary[]>(withSegment('/revisions'))
    rows.value = Array.isArray(result) ? result : []
  } catch {
    error.value = '無法讀取版本紀錄'
  } finally {
    loading.value = false
  }
}

watch(visible, (open) => {
  if (open) {
    expanded.value = null
    load()
  }
})

async function toggle(row: RevisionSummary) {
  if (expanded.value === row.id) {
    expanded.value = null
    return
  }
  expanded.value = row.id
  diff.value = []
  try {
    const rev = await api.get<{ payload: Record<string, unknown> }>(withSegment(`/revisions/${row.id}`))
    diff.value = diffPayload(props.current, rev.payload)
  } catch {
    diff.value = []
  }
}

async function restore(row: RevisionSummary) {
  const note = props.isDirty ? '畫面上還沒儲存的修改會被這一版取代。' : ''
  try {
    await ElMessageBox.confirm(`${note}把第 ${row.version} 版放回草稿，官網不會馬上改變，確認後再發布。`, '放回草稿？', {
      confirmButtonText: '放回草稿',
      cancelButtonText: '先不要',
      type: props.isDirty ? 'warning' : 'info',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    if (await props.restore(row.id)) visible.value = false
  } finally {
    busy.value = false
  }
}

async function publishNow(row: RevisionSummary) {
  try {
    await ElMessageBox.confirm(`官網會立刻換回第 ${row.version} 版（${formatDateTime(row.created_at)} 儲存）。目前的草稿會保留。`, '直接發布這一版？', {
      confirmButtonText: '發布這一版',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    if (await props.publishRevision(row.id)) await load()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-drawer v-model="visible" title="版本紀錄" size="440px" append-to-body>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-skeleton v-else-if="loading" animated :rows="5" />
    <p v-else-if="rows.length === 0" class="hint">還沒有任何版本。</p>
    <ol v-else class="history" :aria-busy="busy">
      <li v-for="row in rows" :key="row.id" class="history__item">
        <div class="history__head">
          <strong>第 {{ row.version }} 版</strong>
          <el-tag v-if="row.is_published" type="success" size="small" round>官網目前這版</el-tag>
          <el-tag v-else-if="row.ever_published" type="info" size="small" round>曾經上線</el-tag>
          <el-tag v-else size="small" round effect="plain">草稿</el-tag>
        </div>
        <p class="hint num">{{ formatDateTime(row.created_at) }}・{{ row.created_by_email || '帳號已刪除' }}</p>
        <p v-if="row.last_published_at && !row.is_published" class="hint">上次上線 {{ formatDateTime(row.last_published_at) }}</p>
        <div class="history__actions">
          <el-button text size="small" @click="toggle(row)">{{ expanded === row.id ? '收起' : '和目前比較' }}</el-button>
          <el-button size="small" :disabled="busy" @click="restore(row)">放回草稿</el-button>
          <el-button v-if="!row.is_published" size="small" :disabled="busy" @click="publishNow(row)">直接發布這一版</el-button>
        </div>
        <div v-if="expanded === row.id" class="history__diff">
          <p v-if="diff.length === 0" class="hint">和畫面上的內容一樣。</p>
          <ul v-else>
            <li v-for="c in diff" :key="c.key">
              <strong>{{ c.label }}</strong>
              <span>現在：{{ c.before }}</span>
              <span>這一版：{{ c.after }}</span>
            </li>
          </ul>
        </div>
      </li>
    </ol>
  </el-drawer>
</template>

<style scoped>
.history { list-style: none; margin: 0; padding: 0; }
.history__item { padding: 12px 0; border-top: 1px solid var(--line); }
.history__item:first-child { border-top: 0; padding-top: 0; }
.history__head { display: flex; align-items: center; gap: 8px; }
.history__item .hint { margin: 2px 0 0; font-size: 12px; }
.history__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.history__actions .el-button + .el-button { margin-left: 0; }
.history__diff { margin-top: 8px; padding: 8px 10px; background: var(--surface-2); border-radius: var(--radius); font-size: 13px; }
.history__diff ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.history__diff li { display: grid; gap: 2px; }
.history__diff span { color: var(--ink-2); overflow-wrap: anywhere; }
</style>
