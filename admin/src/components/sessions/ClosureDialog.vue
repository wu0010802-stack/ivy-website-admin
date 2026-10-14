<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import { campusLabel, formatDate, formatWeekday } from '../../api/labels'
import type { VisitClosureCampusOut, VisitClosureOut } from '../../api/types'
import { taipeiToday } from '../../admissions/academic'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 停班停課（2026-10-14 規格 §3）：一天停課（可一次好幾校）。關閉那天所有場次、設成休假日；
// 勾「寄信請家長改約」時，有 Email 的家長收到附修改連結的停課通知，可以自己改約或取消
// （停課日不受線上修改期限限制）。沒有 Email 的照舊列在「待人工處理」，由櫃台來電。
// 從月曆某一天打開（fixed）時，日期與校區固定、原因帶那天的休假原因，用來補寄通知。
const props = defineProps<{
  campusKeys: readonly string[]
  defaultCampus: string
  fixed?: { date: string; campus: string; reason: string | null } | null
}>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [result: VisitClosureOut] }>()

const REASON_PRESETS = ['颱風停班停課', '臨時停課'] as const
const MAX_DAYS_AHEAD = 60

const day = ref(taipeiToday())
const campuses = ref<string[]>([])
const reason = ref<string>(REASON_PRESETS[0])
const notify = ref(true)
const preview = ref<VisitClosureOut | null>(null)
const previewError = ref('')
const previewLoading = ref(false)
const submitting = ref(false)
const submitError = ref('')
const result = ref<VisitClosureOut | null>(null)
const previews = useRequestSequence()

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function outOfRange(date: Date): boolean {
  const iso = localIso(date)
  const today = taipeiToday()
  return iso < today || iso > addDays(today, MAX_DAYS_AHEAD)
}


const reasonText = computed(() => reason.value.trim())
const multiCampus = computed(() => props.campusKeys.length > 1 && !props.fixed)
const emailEnabled = computed(() => preview.value?.parent_email_enabled !== false)
const sendMail = computed(() => notify.value && emailEnabled.value)
const title = computed(() => (props.fixed ? '寄停課通知' : '停班停課'))
const dayLabel = computed(() => (day.value ? `${formatDate(day.value)}（${formatWeekday(day.value)}）` : ''))

function body(dryRun: boolean) {
  return {
    closure_date: day.value,
    campus_keys: [...campuses.value],
    // dry run 不看原因；原因還沒填時先送一個佔位，不讓預覽卡在 422。
    reason: reasonText.value || REASON_PRESETS[0],
    notify_parents: notify.value,
    dry_run: dryRun,
  }
}

async function loadPreview() {
  const request = previews.begin()
  previewError.value = ''
  if (!day.value || !campuses.value.length) { preview.value = null; return }
  previewLoading.value = true
  try {
    const out = await api.post<VisitClosureOut>('/admin/visit-closures', body(true))
    if (previews.isCurrent(request)) preview.value = out
  } catch (err) {
    if (previews.isCurrent(request)) {
      preview.value = null
      previewError.value = apiErrorMessage(err, '讀不到這天的場次與預約，請再試一次。')
    }
  } finally {
    if (previews.isCurrent(request)) previewLoading.value = false
  }
}
watch([day, campuses, notify], () => { if (open.value && !result.value) void loadPreview() }, { deep: true })

/** 一校的預覽句：「關閉 3 場；已約 2 組，會寄停課通知給 1 位，1 位沒有 Email 要來電」。 */
function previewLine(row: VisitClosureCampusOut): string {
  const parts: string[] = []
  if (row.already_closed) parts.push('這天已經是休假日')
  parts.push(row.closed_slots ? `關閉 ${row.closed_slots} 場` : '沒有開放中的場次')
  if (!row.confirmed_requests) {
    parts.push('沒有已約的家長')
    return parts.join('；')
  }
  const people: string[] = [`已約 ${row.confirmed_requests} 組`]
  if (sendMail.value && row.notified) people.push(`會寄停課通知給 ${row.notified} 位`)
  if (sendMail.value && row.already_notified) people.push(`${row.already_notified} 位之前寄過，不重寄`)
  if (!sendMail.value && row.with_email) people.push(`${row.with_email} 位有 Email，但這次不寄信`)
  if (row.no_email) people.push(`${row.no_email} 位沒有 Email 要來電`)
  parts.push(people.join('，'))
  return parts.join('；')
}

/** 送出後一校的結果句。 */
function resultLine(row: VisitClosureCampusOut): string {
  const parts = [row.closed_slots ? `關閉 ${row.closed_slots} 場` : row.already_closed ? '這天原本就是休假日' : '沒有開放中的場次']
  if (row.notified) parts.push(`寄出 ${row.notified} 封停課通知`)
  if (row.already_notified) parts.push(`${row.already_notified} 位之前已寄過`)
  const toCall = row.no_email + (result.value?.parent_email_enabled && notify.value ? 0 : row.with_email)
  if (toCall) parts.push(`${toCall} 位要來電`)
  return parts.join('，')
}
const toCallTotal = computed(() =>
  (result.value?.campuses ?? []).reduce(
    (sum, row) => sum + row.no_email + (result.value?.parent_email_enabled && notify.value ? 0 : row.with_email),
    0,
  ),
)

const missing = computed(() => {
  if (!day.value) return '請選日期'
  if (!campuses.value.length) return '請選校區'
  if (!reasonText.value) return '請填原因（會寫進給家長的信）'
  return ''
})
const canSubmit = computed(() => !missing.value && !submitting.value && !previewLoading.value && Boolean(preview.value))

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const out = await api.post<VisitClosureOut>('/admin/visit-closures', body(false))
    result.value = out
    emit('done', out)
  } catch (err) {
    submitError.value = apiErrorMessage(err, '停課沒有完成，請再試一次。')
  } finally {
    submitting.value = false
  }
}
// 每次打開都從頭來（放在最後：immediate 會立刻呼叫 loadPreview，用到上面宣告的 computed）。
watch(open, value => {
  if (!value) return
  result.value = null
  submitError.value = ''
  preview.value = null
  day.value = props.fixed?.date ?? taipeiToday()
  campuses.value = props.fixed ? [props.fixed.campus] : props.defaultCampus ? [props.defaultCampus] : props.campusKeys.slice(0, 1)
  // 從某一天補寄：原因帶那天的休假原因（沒填就寫「園方休假」）；新的停課預設颱風。
  reason.value = props.fixed ? props.fixed.reason?.trim().slice(0, 60) || '園方休假' : REASON_PRESETS[0]
  notify.value = true
  void loadPreview()
}, { immediate: true })
</script>

<template>
  <el-dialog
    v-model="open"
    class="closure-dialog"
    :title="title"
    width="min(560px, calc(100vw - 32px))"
    top="5vh"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <template v-if="!result">
      <p class="hint closure__lead">
        {{ fixed ? '這天已經是休假日。寄停課通知給還約在這天的家長，請他們用信裡的連結改約或取消。' : '颱風或臨時停課時用：關閉這天所有場次，已約的家長不會被取消，寄信請他們自己改約或取消。' }}
      </p>
      <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
        <el-form-item label="停課日期" required>
          <el-date-picker v-model="day" type="date" value-format="YYYY-MM-DD" :disabled="Boolean(fixed)" :disabled-date="outOfRange" :clearable="false" aria-label="停課日期" data-test="closure-date" />
          <span class="field-help">{{ dayLabel }}</span>
        </el-form-item>
        <el-form-item v-if="multiCampus" label="校區" required>
          <el-checkbox-group v-model="campuses" class="closure__campuses" aria-label="停課的校區" data-test="closure-campuses">
            <el-checkbox v-for="key in campusKeys" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="原因（會寫進給家長的信）" required>
          <el-input v-model="reason" maxlength="60" show-word-limit placeholder="例如：颱風停班停課" data-test="closure-reason" />
          <div class="closure__presets">
            <el-button v-for="preset in REASON_PRESETS" :key="preset" size="small" :type="reason === preset ? 'primary' : 'default'" plain @click="reason = preset">{{ preset }}</el-button>
          </div>
        </el-form-item>
        <el-form-item class="closure__notify">
          <el-checkbox v-model="notify" :disabled="!emailEnabled" data-test="closure-notify">寄信請家長改約（信裡附修改連結，停課日不受線上修改期限限制）</el-checkbox>
          <span v-if="!emailEnabled" class="field-help">正式站還沒設定寄信，不會寄停課通知；已約的家長請逐一來電。</span>
        </el-form-item>
      </el-form>

      <section class="closure__preview" aria-live="polite" data-test="closure-preview">
        <h3>{{ fixed ? '會寄給誰' : '會發生什麼事' }}</h3>
        <p v-if="previewLoading" class="hint">正在計算…</p>
        <el-alert v-else-if="previewError" type="error" :closable="false" show-icon :title="previewError">
          <el-button size="small" @click="loadPreview">重新計算</el-button>
        </el-alert>
        <ul v-else-if="preview">
          <li v-for="row in preview.campuses" :key="row.campus_key"><strong>{{ campusLabel(row.campus_key) }}</strong>：{{ previewLine(row) }}</li>
        </ul>
      </section>
      <el-alert v-if="submitError" type="error" :closable="false" show-icon :title="submitError" class="closure__alert" />
    </template>

    <section v-else class="closure__result" data-test="closure-result">
      <el-alert type="success" :closable="false" show-icon :title="`${dayLabel}已${fixed ? '寄出停課通知' : '停課'}`" />
      <ul>
        <li v-for="row in result.campuses" :key="row.campus_key"><strong>{{ campusLabel(row.campus_key) }}</strong>：{{ resultLine(row) }}</li>
      </ul>
      <p v-if="toCallTotal" class="closure__call">
        還有 {{ toCallTotal }} 位家長要來電通知，他們列在
        <router-link to="/visit-requests?attention=1" @click="open = false">參觀案件的「待人工處理」</router-link>。
      </p>
    </section>

    <template #footer>
      <div class="closure__footer">
        <p class="closure__missing" aria-live="polite">{{ !result && missing ? `還不能送出：${missing}` : '' }}</p>
        <div class="closure__buttons">
          <template v-if="!result">
            <el-button :disabled="submitting" @click="open = false">取消</el-button>
            <el-button type="primary" :loading="submitting" :disabled="!canSubmit" data-test="closure-submit" @click="submit">{{ fixed ? '寄停課通知' : '確認停課' }}</el-button>
          </template>
          <el-button v-else type="primary" @click="open = false">完成</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.closure__lead { margin: 0 0 16px; }
.closure__campuses { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.closure__presets { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.closure__presets .el-button + .el-button { margin-left: 0; }
.closure__notify { margin-bottom: 8px; }
.closure__notify :deep(.el-checkbox) { height: auto; white-space: normal; align-items: flex-start; }
.closure__notify :deep(.el-checkbox__label) { line-height: 1.5; }
.closure__preview, .closure__result { padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.closure__preview h3 { margin: 0 0 8px; font-size: var(--text-base); }
.closure__preview ul, .closure__result ul { margin: 0; padding-left: 18px; }
.closure__preview li, .closure__result li { margin: 4px 0; overflow-wrap: anywhere; }
.closure__result ul { margin-top: 12px; }
.closure__alert { margin-top: 12px; }
.closure__call { margin: 12px 0 0; }
.closure__footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.closure__missing { margin: 0; color: var(--ink-3); font-size: var(--text-sm); text-align: left; }
.closure__buttons { display: flex; gap: 8px; margin-left: auto; }
.closure__buttons .el-button + .el-button { margin-left: 0; }
@media (max-width: 720px) {
  .closure__buttons { width: 100%; }
  .closure__buttons .el-button { flex: 1; min-height: 44px; }
}
</style>
