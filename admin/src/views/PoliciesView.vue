<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'
import type { RetentionPolicyOut, RetentionReportOut, RetentionRunOut } from '../api/types'
import { RETENTION_CATEGORY_LABELS, RETENTION_TRIGGER_LABELS, formatDate, formatDateTime, staffEmail, staffLabel, staffOf } from '../api/labels'
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
// 會被清理的只有已結案的三種狀態；還沒結案的只算件數提醒。招生訪視是另一類紀錄（規格第 11 節），
// 天數可以留空＝不自動清理；試算與紀錄只在有設天數或有筆數時才列。
const CATEGORY_KEYS = ['cancelled', 'no_show', 'completed'] as const
type RetentionCountKey = keyof RetentionReportOut['counts']
type RetentionForm = Pick<RetentionPolicyOut, 'cancelled_days' | 'completed_days' | 'open_overdue_days' | 'auto_run_enabled' | 'admissions_days'>

const policy = ref<RetentionPolicyOut | null>(null)
const form = ref<RetentionForm>({ cancelled_days: 365, completed_days: 365, open_overdue_days: 365, auto_run_enabled: false, admissions_days: null })
const policyError = ref<string | null>(null)
const preview = ref<RetentionReportOut | null>(null)
const runs = ref<RetentionRunOut[]>([])
// 讀取中不顯示「還沒有清理紀錄」，免得網路慢時誤以為從沒清理過。
const runsLoading = ref(true)
const runsError = ref(false)
const saving = ref(false)
const running = ref(false)
const busy = computed(() => saving.value || running.value)

// undefined 與 null 都是「不自動清理」，不算修改。
const admissionsChanged = computed(() => (policy.value?.admissions_days ?? null) !== (form.value.admissions_days ?? null))

const dirty = computed(() => {
  const p = policy.value
  if (!p) return false
  return (
    p.cancelled_days !== form.value.cancelled_days ||
    p.completed_days !== form.value.completed_days ||
    p.open_overdue_days !== form.value.open_overdue_days ||
    p.auto_run_enabled !== form.value.auto_run_enabled ||
    admissionsChanged.value
  )
})
useUnsavedChanges(dirty, busy)

// 只切「每天自動清理」、天數沒動時，下方試算仍然是準的，照常顯示。
const daysDirty = computed(() => {
  const p = policy.value
  if (!p) return false
  return (
    p.cancelled_days !== form.value.cancelled_days ||
    p.completed_days !== form.value.completed_days ||
    p.open_overdue_days !== form.value.open_overdue_days ||
    admissionsChanged.value
  )
})

// 天數旁的換算，讓人不用自己除：365 →「約 1 年」、180 →「約 6 個月」。
function daysHint(days: number | null | undefined): string {
  if (!days) return ''
  if (days >= 365 && days % 365 === 0) return `約 ${days / 365} 年`
  return `約 ${Math.max(1, Math.round(days / 30.4))} 個月`
}

function applyPolicy(result: RetentionPolicyOut) {
  policy.value = result
  preview.value = result.preview
  form.value = {
    cancelled_days: result.cancelled_days,
    completed_days: result.completed_days,
    open_overdue_days: result.open_overdue_days,
    auto_run_enabled: result.auto_run_enabled,
    admissions_days: result.admissions_days ?? null,
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
  runsLoading.value = true
  runsError.value = false
  try {
    const result = await api.get<RetentionRunOut[]>('/admin/retention-runs?limit=30')
    if (!Array.isArray(result)) throw new Error('unexpected response')
    runs.value = result
  } catch {
    runsError.value = true
  } finally {
    runsLoading.value = false
  }
}

// 台灣日期（YYYY-MM-DD），和後端判斷「今天自動清理跑過沒」用同一個時區。
const taipeiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })

// 開啟每天自動清理，或開著時縮短保留天數：儲存後系統最快一分鐘內就會依新
// 設定匿名化，無法復原，要跟「立即執行清理」一樣先確認。試算只能依已儲存的
// 天數算，天數改過時不能說成「將處理 N 筆」。
async function confirmAutoCleanup(): Promise<boolean> {
  const p = policy.value
  if (!p || !form.value.auto_run_enabled) return true
  const oldAdmissions = p.admissions_days ?? null
  const newAdmissions = form.value.admissions_days ?? null
  // 招生訪視從「不自動清理」改成有天數＝開始清理，當成縮短；改回留空＝不再清理，當成延長。
  const admissionsShortened = newAdmissions !== null && (oldAdmissions === null || newAdmissions < oldAdmissions)
  const admissionsLengthened = oldAdmissions !== null && (newAdmissions === null || newAdmissions > oldAdmissions)
  const shortened = form.value.cancelled_days < p.cancelled_days || form.value.completed_days < p.completed_days || admissionsShortened
  const lengthened = form.value.cancelled_days > p.cancelled_days || form.value.completed_days > p.completed_days || admissionsLengthened
  const enabling = !p.auto_run_enabled
  if (!enabling && !shortened) return true
  const report = preview.value
  let count: string
  if (!report) count = '目前算不出會處理幾筆，確切筆數儲存後才知道。'
  else if (!shortened && !lengthened) count = `依目前天數會匿名化 ${report.total} 筆（${countLines(report)}）。`
  else if (shortened && !lengthened) count = `依舊天數有 ${report.total} 筆，縮短後會更多，確切筆數儲存後才知道。`
  else if (lengthened && !shortened) count = `依舊天數有 ${report.total} 筆，延長後會比較少，確切筆數儲存後才知道。`
  else count = `依舊天數有 ${report.total} 筆，改天數後筆數會變，確切筆數儲存後才知道。`
  let when: string
  if (!p.real_run_allowed) when = '目前系統還沒開放真正清理，儲存後還不會執行；等技術人員開放後，每天會自動執行一次。'
  else if (p.last_scheduled_on === taipeiDate.format(new Date())) when = '今天已經自動清理過，明天起依新設定每天執行一次。'
  else when = '儲存後約一分鐘內就會執行第一次，之後每天一次。'
  try {
    await ElMessageBox.confirm(
      `${when}${count}到期案件的姓名、電話、孩子資料、問題與聯絡紀錄會改成匿名文字，無法復原。${newAdmissions !== null && (enabling || admissionsShortened) ? '招生訪視到期會清除孩子與聯絡人的個資、備註、電訪回應與原因說明，統計數字保留。' : ''}`,
      enabling ? '確定開啟每天自動清理？' : '確定縮短保留天數？',
      {
        confirmButtonText: enabling ? '開啟自動清理' : '縮短保留天數',
        cancelButtonText: '先不要',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
    return true
  } catch {
    return false
  }
}

async function savePolicy() {
  if (!policy.value || !dirty.value || saving.value) return
  if (!(await confirmAutoCleanup())) return
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
      // 畫面會自動重讀，不顯示後端「請重新載入」的訊息，免得前後矛盾。
      ElMessage.warning('保存政策剛被其他人修改，已載入最新的設定；你的修改沒有儲存，請確認後再調整')
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

// 「立即執行清理」為什麼按不了：寫在灰框裡、緊貼按鈕，不讓停用鈕看起來像壞掉。
// 系統沒開放真正清理時，自動清理也一樣不會執行，合成一句講。
const runBlockedReason = computed(() => {
  const p = policy.value
  if (!p) return ''
  if (!p.real_run_allowed) return '目前系統還沒開放真正清理，只能試算筆數；每天自動清理也要等技術人員開放後才會開始。政策可以先設定好。'
  if (dirty.value) return '有修改還沒儲存，先儲存政策才能執行清理。'
  if (preview.value && preview.value.total === 0) return '目前沒有到期的案件，不需要清理。'
  return ''
})

// 後端一定帶 counts.admissions（預設 0）與 admissions_days（預設 null）；有設天數或有筆數才列招生訪視，
// 舊的清理紀錄（null／0）文字因此不變。
function reportKeys(counts: RetentionReportOut['counts'], admissionsDays: number | null | undefined): RetentionCountKey[] {
  return admissionsDays != null || counts.admissions > 0 ? [...CATEGORY_KEYS, 'admissions'] : [...CATEGORY_KEYS]
}

function countLines(report: Pick<RetentionReportOut, 'counts' | 'days'>): string {
  return reportKeys(report.counts, report.days.admissions_days).map((key) => `${RETENTION_CATEGORY_LABELS[key]} ${report.counts[key] ?? 0} 筆`).join('、')
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
  const base = `取消／未到場 ${d.cancelled_days} 天、完成 ${d.completed_days} 天`
  return d.admissions_days != null ? `${base}、招生訪視 ${d.admissions_days} 天` : base
}

onMounted(() => {
  void loadSettings()
  void loadPolicy()
  void loadRuns()
})
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="個資保存政策與清理紀錄，只有總管理者可以設定與執行。頁底另列官網搜尋與分享目前的設定，方便核對。" />

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
            <el-form-item label="已取消、未到場">
              <div class="days-field">
                <span>結案後保留</span>
                <el-input-number v-model="form.cancelled_days" :min="30" :max="3650" :step="30" :disabled="busy" aria-label="已取消、未到場：結案後保留幾天" />
                <span>天<span class="days-field__hint">（{{ daysHint(form.cancelled_days) }}）</span></span>
              </div>
            </el-form-item>
            <el-form-item label="已完成參觀">
              <div class="days-field">
                <span>完成後保留</span>
                <el-input-number v-model="form.completed_days" :min="30" :max="3650" :step="30" :disabled="busy" aria-label="已完成參觀：完成後保留幾天" />
                <span>天<span class="days-field__hint">（{{ daysHint(form.completed_days) }}）</span></span>
              </div>
            </el-form-item>
            <el-form-item label="未結案提醒">
              <div class="days-field">
                <span>送出超過</span>
                <el-input-number v-model="form.open_overdue_days" :min="30" :max="3650" :step="30" :disabled="busy" aria-label="未結案提醒：送出超過幾天仍未結案" />
                <span>天仍未結案<span class="days-field__hint">（{{ daysHint(form.open_overdue_days) }}）</span></span>
              </div>
              <span class="field-help">這些案件不會被清理，只在下方列出件數，提醒先到參觀案件結案（取消、完成或未到場）。</span>
            </el-form-item>
            <el-form-item label="招生訪視">
              <div class="days-field">
                <span>最後更新後保留</span>
                <el-input-number
                  v-model="form.admissions_days"
                  :min="30"
                  :max="3650"
                  :step="30"
                  :value-on-clear="null"
                  :disabled="busy"
                  placeholder="不自動清理"
                  aria-label="招生訪視：最後更新後保留幾天（留空＝不自動清理）"
                />
                <span>天<span class="days-field__hint">（{{ form.admissions_days ? daysHint(form.admissions_days) : '留空＝不自動清理' }}）</span></span>
              </div>
              <span class="field-help">招生入學頁的訪視紀錄，不隨參觀案件清理。到期會清除孩子姓名、生日、電話、聯絡人、地址、備註、電訪回應與原因說明，保留統計需要的欄位。天數請先跟園長確認；留空就不會自動清理。招生入學功能啟用後才會有招生訪視資料。</span>
            </el-form-item>
            <el-form-item label="每天自動清理">
              <el-switch v-model="form.auto_run_enabled" :disabled="busy" active-text="開啟" inactive-text="關閉" aria-label="每天自動清理" />
              <span class="field-help">開啟後，系統每天（台灣時間）依上面的天數自動匿名化一次，並記在清理紀錄。開啟或縮短天數時，儲存前會再確認一次。</span>
            </el-form-item>
            <div class="retention-form__actions">
              <el-button type="primary" :loading="saving" :disabled="!dirty || running" @click="savePolicy">儲存政策</el-button>
              <span v-if="policy.updated_at" class="field-help">
                上次修改 {{ formatDateTime(policy.updated_at) }}<template v-if="policy.updated_by_email || policy.updated_by_display_name">・<span :title="staffEmail(staffOf(policy, 'updated_by')) || undefined">{{ staffLabel(staffOf(policy, 'updated_by')) }}</span></template>
              </span>
            </div>
          </el-form>

          <div class="retention__result">
            <div class="retention__preview">
              <p v-if="daysDirty">天數還沒儲存，儲存後才會重新試算。</p>
              <template v-else-if="preview">
                <p>依目前的政策，現在執行會處理 <strong class="num">{{ preview.total }}</strong> 筆：</p>
                <ul class="retention__counts">
                  <li v-for="key in reportKeys(preview.counts, policy.admissions_days)" :key="key">{{ RETENTION_CATEGORY_LABELS[key] }} <strong class="num">{{ preview.counts[key] ?? 0 }}</strong> 筆</li>
                </ul>
                <p v-if="preview.open_overdue_count > 0" class="retention__overdue">
                  另有 <strong class="num">{{ preview.open_overdue_count }}</strong> 筆送出超過 {{ policy.open_overdue_days }} 天仍未結案，不會被清理，請先到<router-link to="/visit-requests">參觀案件</router-link>處理。
                </p>
              </template>
              <p v-if="policy.last_scheduled_on" class="field-help">上次自動清理：{{ formatDate(policy.last_scheduled_on) }}</p>
            </div>
            <div class="retention__run">
              <el-button
                type="danger"
                plain
                :loading="running"
                :disabled="!canRun || saving"
                :aria-describedby="runBlockedReason ? 'retention-run-reason' : undefined"
                @click="runRetention"
              >
                立即執行清理
              </el-button>
              <p v-if="runBlockedReason" id="retention-run-reason" class="field-help retention__blocked">{{ runBlockedReason }}</p>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section class="panel">
      <div class="panel__head"><h2>清理紀錄</h2></div>
      <div class="panel__body">
        <el-alert v-if="runsError" type="error" :closable="false" show-icon title="無法讀取清理紀錄"><el-button @click="loadRuns">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="runsLoading" class="retention-runs__loading" animated :rows="3" />
        <p v-else-if="runs.length === 0" class="field-help">還沒有清理紀錄。手動或每天自動清理之後，會記在這裡。</p>
        <ol v-else class="retention-runs">
          <li v-for="run in runs" :key="run.id" class="retention-runs__item">
            <div class="retention-runs__head">
              <strong>{{ formatDateTime(run.created_at) }}</strong>
              <span :title="staffEmail(staffOf(run, 'actor')) || undefined">{{ RETENTION_TRIGGER_LABELS[run.trigger] ?? run.trigger }}<template v-if="run.actor_email || run.actor_display_name">・{{ staffLabel(staffOf(run, 'actor')) }}</template></span>
              <span class="retention-runs__real">已匿名化 {{ run.total }} 筆</span>
            </div>
            <p class="field-help">{{ countLines(run) }}<template v-if="run.open_overdue_count">；當時另有 {{ run.open_overdue_count }} 筆超過天數仍未結案</template></p>
            <p class="field-help">保留天數：{{ runDays(run) }}</p>
          </li>
        </ol>
      </div>
    </section>

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
                <span class="field-help">允許收錄時，Google 等搜尋引擎才找得到官網；正式站也要由技術人員開放收錄，兩邊都開才會生效。任一邊沒開，官網各頁都會請搜尋引擎不要收錄。</span>
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
              <dd><span>2026-10-02 起官網預約與後台補登都不用勾選同意。在那之前送出的案件，案件明細仍看得到家長當時同意的<router-link to="/content/booking-content">預約文案</router-link>版本。</span></dd>
            </div>
          </dl>
          <p v-if="!siteMeta" class="field-help">官網還沒發布過網站標題與電話，目前沿用內建設定。</p>
        </template>
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

/* 「結案後保留 [365] 天（約 1 年）」：數字前後帶單位，窄螢幕照樣換行。 */
.days-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.days-field__hint {
  color: var(--ink-3);
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

/* 停用原因緊貼在按鈕下方、同一個灰框裡。 */
.retention__run {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 280px;
}

.retention__blocked {
  margin: 0;
}

@media (max-width: 720px) {
  .retention__run {
    max-width: none;
  }
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
