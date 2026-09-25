<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'
import type { RetentionPolicyOut, RetentionReportOut, RetentionRunOut } from '../api/types'
import { RETENTION_CATEGORY_LABELS, RETENTION_TRIGGER_LABELS, formatDate, formatDateTime } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

// 官網的描述、分享圖與是否允許收錄只以「網站標題與電話」（site_meta）為準，
// 有草稿與發布流程；這裡只讀官網目前發布中的值給總管理者核對。舊的
// /admin/site-settings 官網從來不讀，已不再使用。
interface PublishedSiteMeta {
  description?: string
  share_image?: string
  allow_indexing?: boolean
}

const siteMeta = ref<PublishedSiteMeta | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
// 官網從沒發布過任何內容（上線前的空站）：API 回 503 NO_PUBLISHED_CONTENT，
// 這是正常狀態，不當成讀取失敗叫人重新載入。
const neverPublished = ref(false)

async function loadSettings() {
  loading.value = true
  loadError.value = null
  neverPublished.value = false
  try {
    const site = await api.get<{ content?: { site_meta?: PublishedSiteMeta } }>('/public/site')
    siteMeta.value = site.content?.site_meta ?? null
  } catch (err) {
    siteMeta.value = null
    if (err instanceof ApiError && err.status === 503 && apiErrorCode(err) === 'NO_PUBLISHED_CONTENT') neverPublished.value = true
    else loadError.value = '無法讀取官網目前的設定，請重新載入。'
  } finally {
    loading.value = false
  }
}

// 官網沒有發布過 site_meta 時沿用內建設定：允許收錄（仍受部署設定限制）。
const allowIndexing = computed(() => siteMeta.value?.allow_indexing !== false)

// ---- 個資保存政策（規格 L282）----
// 會被清理的只有已結案的三種狀態；還沒結案的只算件數提醒。
const CATEGORY_KEYS = ['cancelled', 'no_show', 'completed'] as const
type RetentionForm = Pick<RetentionPolicyOut, 'cancelled_days' | 'completed_days' | 'open_overdue_days' | 'auto_run_enabled'>

const policy = ref<RetentionPolicyOut | null>(null)
const form = ref<RetentionForm>({ cancelled_days: 365, completed_days: 365, open_overdue_days: 365, auto_run_enabled: false })
const policyError = ref<string | null>(null)
const preview = ref<RetentionReportOut | null>(null)
const runs = ref<RetentionRunOut[]>([])
const runsError = ref(false)
const saving = ref(false)
const running = ref(false)
const busy = computed(() => saving.value || running.value)

const dirty = computed(() => {
  const p = policy.value
  if (!p) return false
  return (
    p.cancelled_days !== form.value.cancelled_days ||
    p.completed_days !== form.value.completed_days ||
    p.open_overdue_days !== form.value.open_overdue_days ||
    p.auto_run_enabled !== form.value.auto_run_enabled
  )
})
useUnsavedChanges(dirty, busy)

function applyPolicy(result: RetentionPolicyOut) {
  policy.value = result
  preview.value = result.preview
  form.value = {
    cancelled_days: result.cancelled_days,
    completed_days: result.completed_days,
    open_overdue_days: result.open_overdue_days,
    auto_run_enabled: result.auto_run_enabled,
  }
}

async function loadPolicy() {
  policyError.value = null
  try {
    const result = await api.get<RetentionPolicyOut>('/admin/site-policies/retention')
    // 回應形狀不對（例如代理回了別的東西）就當讀取失敗，不讓畫面整個丟例外。
    if (!result || typeof result.version !== 'number' || !result.preview) throw new Error('unexpected response')
    applyPolicy(result)
  } catch (err) {
    policy.value = null
    policyError.value = apiErrorMessage(err, '無法讀取個資保存政策，請重新載入。')
  }
}

async function loadRuns() {
  runsError.value = false
  try {
    const result = await api.get<RetentionRunOut[]>('/admin/retention-runs?limit=30')
    if (!Array.isArray(result)) throw new Error('unexpected response')
    runs.value = result
  } catch {
    runsError.value = true
  }
}

async function savePolicy() {
  if (!policy.value || !dirty.value || saving.value) return
  saving.value = true
  try {
    applyPolicy(
      await api.put<RetentionPolicyOut>('/admin/site-policies/retention', {
        expected_version: policy.value.version,
        ...form.value,
      }),
    )
    ElMessage.success('已儲存保存政策')
  } catch (err) {
    if (isVersionConflict(err)) {
      ElMessage.warning(`${apiErrorMessage(err, '保存政策剛被其他人修改')}，已載入最新的設定`)
      await loadPolicy()
    } else {
      ElMessage.error(apiErrorMessage(err, '儲存失敗'))
    }
  } finally {
    saving.value = false
  }
}

// 重新試算（依已儲存的天數）；清理前一定先看過最新的筆數。
async function refreshPreview(): Promise<boolean> {
  try {
    preview.value = await api.post<RetentionReportOut>('/admin/retention/dry-run')
    return true
  } catch {
    preview.value = null
    ElMessage.error('試算失敗，請重新整理後再試')
    return false
  }
}

const canRun = computed(
  () => Boolean(policy.value?.real_run_allowed && preview.value && preview.value.total > 0 && !dirty.value),
)

function countLines(report: { counts: Partial<Record<string, number>> }): string {
  return CATEGORY_KEYS.map((key) => `${RETENTION_CATEGORY_LABELS[key]} ${report.counts[key] ?? 0} 筆`).join('、')
}

async function runRetention() {
  if (!canRun.value || running.value) return
  running.value = true
  try {
    if (!(await refreshPreview()) || !preview.value || preview.value.total === 0) return
    try {
      await ElMessageBox.confirm(
        `將匿名化 ${preview.value.total} 筆案件（${countLines(preview.value)}）：姓名、電話、孩子資料、問題與聯絡紀錄改成匿名文字。無法復原。`,
        '確定執行清理？',
        { confirmButtonText: '執行清理', cancelButtonText: '先不要', type: 'warning', confirmButtonClass: 'el-button--danger' },
      )
    } catch {
      return
    }
    try {
      const result = await api.post<RetentionReportOut>('/admin/retention/run')
      ElMessage.success(`已匿名化 ${result.total} 筆案件`)
    } catch (err) {
      ElMessage.error(apiErrorMessage(err, '無法確認清理結果，請看下方清理紀錄後再操作。'))
    }
    await Promise.all([loadPolicy(), loadRuns()])
  } finally {
    running.value = false
  }
}

function runDays(run: RetentionRunOut): string {
  const d = run.days
  return `取消／未到場 ${d.cancelled_days} 天、完成 ${d.completed_days} 天`
}

onMounted(() => {
  void loadSettings()
  void loadPolicy()
  void loadRuns()
})
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="個資保存政策與清理紀錄，以及官網搜尋與分享設定的總覽。保存政策只有總管理者可以設定與執行。" />

    <section class="panel">
      <div class="panel__head"><h2>搜尋與分享</h2></div>
      <div class="panel__body">
        <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError"><el-button @click="loadSettings">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="loading" animated :rows="4" />
        <el-alert v-else-if="neverPublished" class="site-unpublished" type="info" :closable="false" show-icon title="官網還沒發布過任何內容">
          發布第一版內容之前，官網各頁會顯示「網站內容服務暫時無法使用」。網站描述、社群分享圖與是否允許搜尋引擎收錄在<router-link to="/content/site-meta">網站標題與電話</router-link>設定，發布後會顯示在這裡。
        </el-alert>
        <template v-else>
          <p class="page-lead">
            官網的網站描述、社群分享圖與是否允許搜尋引擎收錄，都在<router-link to="/content/site-meta">網站標題與電話</router-link>修改，發布後才會套用到官網。這裡顯示的是官網目前發布中的設定。
          </p>
          <dl class="seo-summary">
            <div>
              <dt>搜尋引擎收錄</dt>
              <dd>
                <strong>{{ allowIndexing ? '允許收錄' : '不允許收錄' }}</strong>
                <span class="field-help">要同時符合兩個條件官網才會被收錄：部署設定開啟正式索引，而且這裡是允許收錄。任一個關閉，各頁、robots.txt 與 sitemap.xml 都會請搜尋引擎不要收錄。</span>
              </dd>
            </div>
            <div>
              <dt>網站描述</dt>
              <dd>{{ siteMeta?.description || '沿用官網內建的描述' }}</dd>
            </div>
            <div>
              <dt>社群分享圖</dt>
              <dd>{{ siteMeta?.share_image ? '已選擇分享圖' : '沿用首頁大圖' }}</dd>
            </div>
            <div>
              <dt>家長同意的版本</dt>
              <dd>家長送出參觀需求時，案件會記錄當時發布中的<router-link to="/content/booking-content">預約文案</router-link>同意說明版本，在案件明細可以看到。</dd>
            </div>
          </dl>
          <p v-if="!siteMeta" class="field-help">官網還沒發布過網站標題與電話，目前沿用內建設定。</p>
        </template>
      </div>
    </section>

    <section class="panel retention-panel">
      <div class="panel__head"><h2>個資保存政策</h2></div>
      <div class="panel__body">
        <p class="page-lead">
          已結案的參觀案件，家長個資保留多久。保存期限從結案時間（取消、完成或標記未到場的時間）起算；到期的案件會把姓名、電話、孩子資料、問題與聯絡紀錄改成匿名文字，案件本身與統計數字保留。還沒結案的案件（新案、聯絡中、待確認、已確認）不論多久都不會清理。
        </p>
        <el-alert v-if="policyError" type="error" :closable="false" show-icon :title="policyError"><el-button @click="loadPolicy">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="!policy" animated :rows="4" />
        <template v-else>
          <el-form label-position="top" class="retention-form" @submit.prevent>
            <el-form-item label="已取消、未到場：結案後保留天數">
              <el-input-number v-model="form.cancelled_days" :min="30" :max="3650" :step="30" :disabled="busy" />
            </el-form-item>
            <el-form-item label="已完成參觀：完成後保留天數">
              <el-input-number v-model="form.completed_days" :min="30" :max="3650" :step="30" :disabled="busy" />
            </el-form-item>
            <el-form-item label="未結案提醒：送出超過幾天仍未結案">
              <el-input-number v-model="form.open_overdue_days" :min="30" :max="3650" :step="30" :disabled="busy" />
              <span class="field-help">這些案件不會被清理，只在下方列出件數，提醒先到參觀案件結案（取消、完成或未到場）。</span>
            </el-form-item>
            <el-form-item label="每天自動清理">
              <el-switch v-model="form.auto_run_enabled" :disabled="busy" active-text="開啟" inactive-text="關閉" />
              <span class="field-help">
                開啟後，系統每天（台灣時間）依上面的天數自動匿名化一次，並記在清理紀錄。
                <template v-if="!policy.real_run_allowed">目前部署設定沒有開放真正清理（WEBSITE_RETENTION_ALLOW_REAL_RUN），開啟也不會執行，需請系統管理者調整。</template>
              </span>
            </el-form-item>
            <div class="retention-form__actions">
              <el-button type="primary" :loading="saving" :disabled="!dirty || running" @click="savePolicy">儲存政策</el-button>
              <span v-if="policy.updated_at" class="field-help">
                上次修改 {{ formatDateTime(policy.updated_at) }}<template v-if="policy.updated_by_email">・{{ policy.updated_by_email }}</template>
              </span>
            </div>
          </el-form>

          <div class="retention__result">
            <div class="retention__preview">
              <p v-if="dirty">天數還沒儲存，儲存後才會重新試算。</p>
              <template v-else-if="preview">
                <p>依目前的政策，現在執行會處理 <strong class="num">{{ preview.total }}</strong> 筆：</p>
                <ul class="retention__counts">
                  <li v-for="key in CATEGORY_KEYS" :key="key">{{ RETENTION_CATEGORY_LABELS[key] }} <strong class="num">{{ preview.counts[key] ?? 0 }}</strong> 筆</li>
                </ul>
                <p v-if="preview.open_overdue_count > 0" class="retention__overdue">
                  另有 <strong class="num">{{ preview.open_overdue_count }}</strong> 筆送出超過 {{ policy.open_overdue_days }} 天仍未結案，不會被清理，請先到<router-link to="/visit-requests">參觀案件</router-link>處理。
                </p>
              </template>
              <p v-if="policy.last_scheduled_on" class="field-help">定期工作上次執行：{{ formatDate(policy.last_scheduled_on) }}</p>
            </div>
            <el-button
              type="danger"
              plain
              :loading="running"
              :disabled="!canRun || saving"
              @click="runRetention"
            >
              立即執行清理
            </el-button>
          </div>
          <p v-if="!policy.real_run_allowed" class="field-help">部署設定沒有開放真正清理，目前只能試算。</p>
        </template>
      </div>
    </section>

    <section class="panel">
      <div class="panel__head"><h2>清理紀錄</h2></div>
      <div class="panel__body">
        <el-alert v-if="runsError" type="error" :closable="false" show-icon title="無法讀取清理紀錄"><el-button @click="loadRuns">重新載入</el-button></el-alert>
        <p v-else-if="runs.length === 0" class="field-help">還沒有清理紀錄。手動或每天自動清理之後，會記在這裡。</p>
        <ol v-else class="retention-runs">
          <li v-for="run in runs" :key="run.id" class="retention-runs__item">
            <div class="retention-runs__head">
              <strong>{{ formatDateTime(run.created_at) }}</strong>
              <span>{{ RETENTION_TRIGGER_LABELS[run.trigger] ?? run.trigger }}<template v-if="run.actor_email">・{{ run.actor_email }}</template></span>
              <span class="retention-runs__real">已匿名化 {{ run.total }} 筆</span>
            </div>
            <p class="field-help">{{ countLines(run) }}<template v-if="run.open_overdue_count">；當時另有 {{ run.open_overdue_count }} 筆超過天數仍未結案</template></p>
            <p class="field-help">保留天數：{{ runDays(run) }}</p>
          </li>
        </ol>
      </div>
    </section>
  </div>
</template>

<style scoped>
.seo-summary {
  display: grid;
  gap: 12px;
  margin: 0 0 16px;
}

.seo-summary > div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
}

.seo-summary dt {
  color: var(--ink-3);
}

.seo-summary dd {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 600px) {
  .seo-summary > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}

.retention-form {
  display: grid;
  gap: 4px;
}

.retention-form :deep(.el-form-item__content) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.retention-form__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.retention__result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.retention__preview {
  min-width: 0;
}

.retention__preview p {
  margin: 0 0 4px;
}

.retention__counts {
  margin: 0 0 4px;
  padding-left: 20px;
}

.retention-runs {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.retention-runs__item {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.retention-runs__item p {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.retention-runs__head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.retention-runs__real {
  font-weight: 600;
}
</style>
