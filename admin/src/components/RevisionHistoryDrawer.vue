<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { formatDateTime } from '../api/labels'
import { diffPayload, type FieldChange, type RevisionHistoryHandle, type RevisionSummary } from '../composables/useContentItem'

// 版本紀錄：列出最近幾次儲存，點一版看「還原後哪些欄位會變」，再選要
// 還原成草稿還是直接發布。還原是新增一版，不會刪掉任何歷史。
const props = withDefaults(defineProps<{
  history: RevisionHistoryHandle
  /** 表單有未儲存的修改：還原會蓋掉，要先問 */
  dirty: boolean
  busy: boolean
  /** 內容編輯只能還原成草稿再送審，不給「還原並發布」（後端也會擋）。預設可發布。 */
  canPublish?: boolean
}>(), { canPublish: true })
const open = defineModel<boolean>({ required: true })

const revisions = ref<RevisionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref<RevisionSummary | null>(null)
const selectedChanges = ref<FieldChange[] | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
let previewRequest = 0

const latestVersion = computed(() => revisions.value[0]?.version ?? 0)

async function load() {
  loading.value = true
  error.value = null
  selected.value = null
  selectedChanges.value = null
  try {
    revisions.value = await props.history.list()
  } catch {
    error.value = '無法讀取版本紀錄'
  } finally {
    loading.value = false
  }
}

watch(open, (value) => { if (value) void load() })

async function select(revision: RevisionSummary) {
  const request = ++previewRequest
  selected.value = revision
  selectedChanges.value = null
  previewError.value = null
  if (revision.version === latestVersion.value) {
    selectedChanges.value = []
    return
  }
  previewLoading.value = true
  try {
    const payload = await props.history.payloadOf(revision.id)
    if (request !== previewRequest) return
    selectedChanges.value = diffPayload(props.history.savedPayload(), payload)
  } catch {
    if (request === previewRequest) previewError.value = '無法讀取這一版的內容'
  } finally {
    if (request === previewRequest) previewLoading.value = false
  }
}

function tagOf(revision: RevisionSummary): string[] {
  const tags: string[] = []
  if (revision.is_published) tags.push('官網目前版本')
  if (revision.version === latestVersion.value) tags.push('最新草稿')
  return tags
}

async function restore(publish: boolean) {
  const revision = selected.value
  if (!revision) return
  const when = formatDateTime(revision.created_at)
  const lines = [
    publish
      ? `會把 ${when} 的內容另存成新的一版，並立刻發布到官網。`
      : `會把 ${when} 的內容另存成新的一版草稿，官網要等你按發布才會更新。`,
    '目前的版本仍會留在紀錄裡，隨時可以再還原回來。',
  ]
  if (props.dirty) lines.push('你還沒儲存的修改會被捨棄。')
  try {
    await ElMessageBox.confirm(lines.join('\n'), publish ? '還原並發布到官網？' : '還原成這一版？', {
      confirmButtonText: publish ? '還原並發布' : '還原成草稿',
      cancelButtonText: '先不要',
      type: publish ? 'warning' : 'info',
      customStyle: { whiteSpace: 'pre-line' },
    })
  } catch {
    return
  }
  const ok = await props.history.restore(revision.id, publish)
  if (ok) open.value = false
}
</script>

<template>
  <el-drawer v-model="open" title="版本紀錄" size="min(520px, 100vw)" append-to-body>
    <p class="hint history__lead">每次儲存都會留下一版。選一版可以看到還原後會改變哪些欄位。</p>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" :rows="5" animated />
    <p v-else-if="revisions.length === 0" class="hint">還沒有任何儲存紀錄。</p>

    <ol v-else class="history__list">
      <li v-for="revision in revisions" :key="revision.id">
        <button
          type="button"
          class="history__item"
          :class="{ 'is-selected': selected?.id === revision.id }"
          :aria-pressed="selected?.id === revision.id"
          @click="select(revision)"
        >
          <span class="history__when num">{{ formatDateTime(revision.created_at) }}</span>
          <span class="history__meta">第 {{ revision.version }} 版・{{ revision.created_by_email || '系統匯入或已刪除的帳號' }}</span>
          <span v-if="tagOf(revision).length" class="history__tags">
            <el-tag v-for="tag in tagOf(revision)" :key="tag" size="small" :type="tag === '官網目前版本' ? 'success' : 'info'" disable-transitions>{{ tag }}</el-tag>
          </span>
        </button>

        <div v-if="selected?.id === revision.id" class="history__preview" role="region" :aria-label="`第 ${revision.version} 版`">
          <p v-if="revision.version === latestVersion" class="hint">這就是目前最新儲存的內容，不需要還原。</p>
          <el-skeleton v-else-if="previewLoading" :rows="2" animated />
          <p v-else-if="previewError" class="hint">{{ previewError }}</p>
          <template v-else-if="selectedChanges">
            <p v-if="selectedChanges.length === 0" class="hint">內容與目前最新儲存的一樣。</p>
            <template v-else>
              <p class="hint">還原後會改變 {{ selectedChanges.length }} 個欄位：</p>
              <div class="publish-diff"><ul>
                <li v-for="change in selectedChanges.slice(0, 10)" :key="change.key">
                  <strong>{{ change.label }}</strong>
                  <span class="publish-diff__before">{{ change.before }}</span>
                  <span class="publish-diff__arrow" aria-hidden="true">→</span>
                  <span class="publish-diff__after">{{ change.after }}</span>
                </li>
              </ul></div>
              <p v-if="selectedChanges.length > 10" class="hint">還有 {{ selectedChanges.length - 10 }} 個欄位。</p>
            </template>
            <div class="history__actions">
              <el-button :disabled="busy" @click="restore(false)">還原成草稿</el-button>
              <el-button v-if="canPublish !== false" type="primary" :disabled="busy" @click="restore(true)">還原並發布</el-button>
            </div>
          </template>
        </div>
      </li>
    </ol>
  </el-drawer>
</template>

<style scoped>
.history__lead { margin: 0 0 16px; }
.history__list { list-style: none; margin: 0; padding: 0; }
.history__list > li + li { border-top: 1px solid var(--line); }
.history__item {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 12px 8px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.history__item:hover, .history__item.is-selected { background: var(--surface-3); }
.history__item:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.history__when { font-weight: 600; color: var(--ink); }
.history__meta { font-size: 13px; color: var(--ink-3); }
.history__tags { display: flex; gap: 6px; margin-top: 4px; }
.history__preview { padding: 4px 8px 16px; }
.history__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.history__actions .el-button + .el-button { margin-left: 0; }
</style>
