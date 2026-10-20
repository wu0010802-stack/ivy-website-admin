<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { formatDateTime } from '../api/labels'
import type { ContentEditorState, PublishJob } from '../composables/useContentItem'

// 內容編輯頁狀態列下方的排程列（2026-10-20 從 ContentEditor.vue 抽出，行為不變）：已排定的自動發布
// 與取消、最近一次沒發布或略過的原因與「知道了」、全站排程連結。排程清單也在這裡跟著內容重讀。
const props = defineProps<{
  editor: ContentEditorState
  /** 確認框標題裡的內容名稱（已加引號）。 */
  named: string
  /** 可以取消排程、按「知道了」（content.publish 而且不是唯讀）。 */
  canManage: boolean
}>()

const apiPath = computed(() => props.editor.apiPath?.value ?? '')
const latestRevisionId = computed(() => props.editor.latestRevisionId?.value ?? null)
const liveVersion = computed(() => props.editor.liveVersion?.value ?? null)
const isPublished = computed(() => props.editor.isPublished.value)
const isDirty = computed(() => props.editor.isDirty.value)
const neverPublished = computed(() => props.editor.neverPublished.value)
const scheduled = computed(() => (props.editor.schedules?.value ?? []).filter((j) => j.status === 'scheduled'))
// 最近一次到期的排程（清單依排程時間新到舊）；沒有發布（檢查不過）或略過
// （官網已是較新版本）時寫出原因。之後又成功排程發布、官網換過版本，或有人
// 按了「知道了」（後端 resolved，和總覽的待辦同一個定義）就不再提。
const lastUnpublished = computed(() => {
  const finished = (props.editor.schedules?.value ?? []).find((j) => j.status === 'done' || j.status === 'failed' || j.status === 'skipped')
  return finished && finished.status !== 'done' && !finished.resolved ? finished : null
})

const acknowledging = ref(false)
async function acknowledge(jobId: string) {
  if (!props.editor.acknowledgeSchedule) return
  acknowledging.value = true
  try {
    await props.editor.acknowledgeSchedule(jobId)
  } finally {
    acknowledging.value = false
  }
}
// 排程清單跟著內容一起換：切校區、重新載入、存檔後都重讀一次。
watch(
  () => [apiPath.value, props.editor.loading.value] as const,
  ([path, isLoading]) => {
    if (path && !isLoading && !props.editor.loadError.value) void props.editor.loadSchedules?.()
  },
  { immediate: true },
)

// 排程列只講時間與「會發布哪一份」，不寫版本號或帳號。到期時官網已經是排定的
// 那一版或更新的內容就會略過（後端 skip_reason），所以先看官網再講草稿：
// 官網就是最新一版，或官網版本不比排定的舊，到時都會略過；排的是較早的草稿時
// 講明不含之後存的修改，不知道官網是哪一版就不斷言一定會發布。
function scheduleTarget(job: PublishJob): string {
  const isLatest = !latestRevisionId.value || job.revision_id === latestRevisionId.value
  const live = liveVersion.value
  if (isLatest && isPublished.value) return '這份內容，但官網已經是這一版，到時會略過。'
  if (live !== null && live === job.revision_version) return '較早儲存的草稿，但這份已經在官網上，到時會略過。'
  if (isPublished.value || (live !== null && live > job.revision_version)) {
    return '較早儲存的草稿，但官網已經是更新的內容，到時會略過。'
  }
  if (!isLatest) {
    return live === null && !neverPublished.value
      ? '較早儲存的草稿（不含之後存的修改）；到時官網若已經是更新的內容就會略過。'
      : '較早儲存的草稿，不含之後存的修改。'
  }
  if (isDirty.value) return '上次儲存的草稿，不含還沒儲存的修改。'
  return '這份草稿。'
}

const cancellingId = ref<string | null>(null)
async function cancelSchedule(job: PublishJob) {
  if (!props.editor.cancelSchedule || cancellingId.value) return
  try {
    await ElMessageBox.confirm(
      `取消後 ${formatDateTime(job.publish_at)} 不會自動發布，草稿仍會保留。`,
      props.named ? `取消${props.named}的排程？` : '取消這個排程？',
      { confirmButtonText: '取消排程', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  cancellingId.value = job.id
  try {
    await props.editor.cancelSchedule(job.id)
  } finally {
    cancellingId.value = null
  }
}
</script>

<template>
  <div v-if="scheduled.length || lastUnpublished" class="editor__schedules">
    <p v-for="job in scheduled" :key="job.id" class="editor__schedule">
      <span>已排定 <strong class="num">{{ formatDateTime(job.publish_at) }}</strong> 自動發布{{ scheduleTarget(job) }}</span>
      <el-button
        v-if="canManage && editor.cancelSchedule"
        text
        size="small"
        :loading="cancellingId === job.id"
        :disabled="cancellingId !== null"
        @click="cancelSchedule(job)"
      >
        取消排程
      </el-button>
    </p>
    <p v-if="lastUnpublished && !scheduled.length" :class="lastUnpublished.status === 'failed' ? 'is-failed' : 'is-skipped'">
      {{ formatDateTime(lastUnpublished.publish_at) }} 的排程{{ lastUnpublished.status === 'failed' ? '沒有發布' : '已略過' }}：{{ lastUnpublished.error }}
      <el-button
        v-if="canManage && editor.acknowledgeSchedule"
        text
        size="small"
        :loading="acknowledging"
        @click="acknowledge(lastUnpublished.id)"
      >
        知道了
      </el-button>
    </p>
    <router-link to="/releases?tab=schedules" class="editor__schedules-all">查看全站排程</router-link>
  </div>
</template>

<style scoped>
.editor__schedules { margin: -12px 0 20px; font-size: var(--text-sm); color: var(--ink-2); }
.editor__schedules p { margin: 0; }
.editor__schedules .is-failed { color: var(--el-color-danger); }
.editor__schedules .is-skipped { color: var(--ink-2); }
.editor__schedules-all { display: inline-flex; align-items: center; min-height: 28px; font-size: var(--text-sm); }
/* 取消排程接在句子後面；按鈕在觸控裝置是 44px 高，不撐開句子的行距。 */
.editor__schedules .editor__schedule { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; }
</style>
