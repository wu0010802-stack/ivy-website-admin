<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, ApiError } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import { campusLabel, formatDate } from '../../api/labels'
import type { HolidayApplyCampusOut, HolidayApplyOut, HolidayCalendarOut } from '../../api/types'
import { taipeiToday } from '../../admissions/academic'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 匯入國定假日（2026-10-14 規格 §2）：人事行政總處每年公布的「行政機關辦公日曆表」。
// 先從政府資料開放平台下載（連不到就上傳同一份 CSV），預覽後勾選要套用的日子與校區，
// 套用後這些日子變成休假日，不會開出參觀場次。星期一到五的假日一律建；週末的節日只有那校
// 每週固定場次有那一天才建；已經是休假日的不動。已約在這些日子的預約不會自動取消。
const props = defineProps<{ campusKeys: readonly string[]; defaultCampus: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [result: HolidayApplyOut] }>()

const thisYear = Number(taipeiToday().slice(0, 4))
const YEARS = [thisYear, thisYear + 1]
const WEEKDAYS = '一二三四五六日'

const year = ref(thisYear + 1)
const calendar = ref<HolidayCalendarOut | null>(null)
const loadError = ref('')
const loadingSource = ref<'open_data' | 'upload' | null>(null)
const selectedDates = ref<string[]>([])
const campuses = ref<string[]>([])
const preview = ref<HolidayApplyOut | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const applying = ref(false)
const applyError = ref('')
const result = ref<HolidayApplyOut | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const previews = useRequestSequence()

watch(open, value => {
  if (!value) return
  calendar.value = null
  loadError.value = ''
  preview.value = null
  result.value = null
  applyError.value = ''
  selectedDates.value = []
  campuses.value = props.defaultCampus ? [props.defaultCampus] : props.campusKeys.slice(0, 1)
}, { immediate: true })

const today = computed(() => taipeiToday())
const multiCampus = computed(() => props.campusKeys.length > 1)
const holidays = computed(() => calendar.value?.holidays ?? [])
const upcoming = computed(() => holidays.value.filter(h => h.date >= today.value))

function rocYear(value: number): number {
  return value - 1911
}
function dayText(date: string, weekday: number): string {
  return `${formatDate(date)}（${WEEKDAYS[weekday]}）`
}

function useCalendar(out: HolidayCalendarOut) {
  calendar.value = out
  // 預設勾選今天以後的每一天；已經過去的不能勾（後端也會略過）。
  selectedDates.value = out.holidays.filter(h => h.date >= today.value).map(h => h.date)
}

async function fetchOpenData() {
  loadingSource.value = 'open_data'
  loadError.value = ''
  try {
    useCalendar(await api.post<HolidayCalendarOut>('/admin/holiday-calendar/fetch', { year: year.value }))
  } catch (err) {
    const unreachable = err instanceof ApiError && err.status === 502
    loadError.value = unreachable
      ? '連不到政府資料開放平台。請到「政府資料開放平台」搜尋「行政機關辦公日曆表」，下載那一年的 CSV（不是 Google 行事曆專用的那份），再按「上傳 CSV」。'
      : apiErrorMessage(err, '下載失敗，請再試一次，或改用上傳 CSV。')
  } finally {
    loadingSource.value = null
  }
}

function chooseFile() {
  fileInput.value?.click()
}
async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  loadingSource.value = 'upload'
  loadError.value = ''
  try {
    const form = new FormData()
    form.append('file', file)
    useCalendar(await api.upload<HolidayCalendarOut>('/admin/holiday-calendar/parse', form))
  } catch (err) {
    loadError.value = apiErrorMessage(err, '讀不懂這個檔案，請確認是「行政機關辦公日曆表」的 CSV。')
  } finally {
    loadingSource.value = null
  }
}

const chosen = computed(() => holidays.value.filter(h => selectedDates.value.includes(h.date)))

function applyBody(dryRun: boolean) {
  return { campus_keys: [...campuses.value], holidays: chosen.value.map(h => ({ date: h.date, name: h.name })), dry_run: dryRun }
}

async function loadPreview() {
  const request = previews.begin()
  previewError.value = ''
  if (!chosen.value.length || !campuses.value.length) { preview.value = null; previewLoading.value = false; return }
  previewLoading.value = true
  try {
    const out = await api.post<HolidayApplyOut>('/admin/holiday-calendar/apply', applyBody(true))
    if (previews.isCurrent(request)) preview.value = out
  } catch (err) {
    if (previews.isCurrent(request)) {
      preview.value = null
      previewError.value = apiErrorMessage(err, '算不出會建幾天休假，請再試一次。')
    }
  } finally {
    if (previews.isCurrent(request)) previewLoading.value = false
  }
}
watch([selectedDates, campuses, calendar], () => { if (open.value && calendar.value && !result.value) void loadPreview() }, { deep: true })

function campusLine(row: HolidayApplyCampusOut, done: boolean): string {
  const parts = [row.created ? `${done ? '新增' : '會新增'} ${row.created} 天休假日` : done ? '沒有新增' : '不會新增']
  if (row.skipped_existing) parts.push(`${row.skipped_existing} 天原本就是休假日`)
  if (row.skipped_weekend) parts.push(`${row.skipped_weekend} 個週末節日這校沒有場次，略過`)
  if (row.affected_requests) parts.push(`${row.affected_dates.map(d => formatDate(d)).join('、')} 已有 ${row.affected_requests} 組預約，要通知家長改約`)
  return parts.join('；')
}

const missing = computed(() => {
  if (!calendar.value) return '先下載或上傳辦公日曆'
  if (!chosen.value.length) return '請至少勾一天'
  if (!campuses.value.length) return '請選校區'
  return ''
})
const canApply = computed(() => !missing.value && !applying.value && !previewLoading.value && Boolean(preview.value))
const affectedAfterApply = computed(() => (result.value?.campuses ?? []).some(row => row.affected_requests > 0))

async function apply() {
  if (!canApply.value) return
  applying.value = true
  applyError.value = ''
  try {
    const out = await api.post<HolidayApplyOut>('/admin/holiday-calendar/apply', applyBody(false))
    result.value = out
    emit('done', out)
  } catch (err) {
    applyError.value = apiErrorMessage(err, '套用失敗，請再試一次。')
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="holiday-dialog"
    title="匯入國定假日"
    width="min(640px, calc(100vw - 32px))"
    top="5vh"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!applying"
    :show-close="!applying"
  >
    <template v-if="!result">
      <p class="hint holiday__lead">用人事行政總處的「行政機關辦公日曆表」把國定假日與補假設成休假日，這些日子不會開出參觀場次。補行上班的週六不會加開。</p>

      <section class="holiday__source" aria-labelledby="holiday-source-title">
        <h3 id="holiday-source-title">1. 取得辦公日曆</h3>
        <div class="holiday__source-row">
          <el-select v-model="year" aria-label="年份" class="holiday__year" :disabled="Boolean(loadingSource)">
            <el-option v-for="y in YEARS" :key="y" :value="y" :label="`${y} 年（民國 ${rocYear(y)} 年）`" />
          </el-select>
          <el-button type="primary" :loading="loadingSource === 'open_data'" :disabled="Boolean(loadingSource)" data-test="holiday-fetch" @click="fetchOpenData">從政府資料開放平台下載</el-button>
          <el-button :loading="loadingSource === 'upload'" :disabled="Boolean(loadingSource)" data-test="holiday-upload" @click="chooseFile">上傳 CSV</el-button>
          <input ref="fileInput" type="file" accept=".csv,text/csv" class="visually-hidden" tabindex="-1" aria-hidden="true" data-test="holiday-file" @change="uploadFile">
        </div>
        <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" class="holiday__alert" />
        <p v-if="calendar" class="hint holiday__loaded" data-test="holiday-loaded">已讀取：{{ calendar.source_label }}（{{ holidays.length }} 天假日，今天以後 {{ upcoming.length }} 天）</p>
      </section>

      <template v-if="calendar">
        <section aria-labelledby="holiday-days-title">
          <h3 id="holiday-days-title">2. 勾選要設成休假的日子</h3>
          <el-checkbox-group v-model="selectedDates" class="holiday__days" aria-labelledby="holiday-days-title" data-test="holiday-days">
            <el-checkbox v-for="h in holidays" :key="h.date" :value="h.date" :disabled="h.date < today">
              <span class="num">{{ dayText(h.date, h.weekday) }}</span> {{ h.name }}<span v-if="h.date < today" class="holiday__past">已過</span>
            </el-checkbox>
          </el-checkbox-group>
        </section>

        <section v-if="multiCampus" aria-labelledby="holiday-campus-title">
          <h3 id="holiday-campus-title">3. 套用到哪些校區</h3>
          <el-checkbox-group v-model="campuses" class="holiday__campuses" aria-labelledby="holiday-campus-title" data-test="holiday-campuses">
            <el-checkbox v-for="key in campusKeys" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
          </el-checkbox-group>
        </section>

        <section class="holiday__preview" aria-live="polite" data-test="holiday-preview">
          <p v-if="previewLoading" class="hint">正在計算…</p>
          <el-alert v-else-if="previewError" type="error" :closable="false" show-icon :title="previewError" />
          <ul v-else-if="preview">
            <li v-for="row in preview.campuses" :key="row.campus_key"><strong>{{ campusLabel(row.campus_key) }}</strong>：{{ campusLine(row, false) }}</li>
          </ul>
        </section>
        <el-alert v-if="applyError" type="error" :closable="false" show-icon :title="applyError" class="holiday__alert" />
      </template>
    </template>

    <section v-else class="holiday__result" data-test="holiday-result">
      <el-alert type="success" :closable="false" show-icon title="已套用國定假日" />
      <ul>
        <li v-for="row in result.campuses" :key="row.campus_key"><strong>{{ campusLabel(row.campus_key) }}</strong>：{{ campusLine(row, true) }}</li>
      </ul>
      <p v-if="affectedAfterApply" class="holiday__call">已約在這些日子的預約不會自動取消：到月曆點那一天，用「寄停課通知」請家長改約，或逐筆聯絡。</p>
    </section>

    <template #footer>
      <div class="holiday__footer">
        <p class="holiday__missing" aria-live="polite">{{ !result && missing ? missing : '' }}</p>
        <div class="holiday__buttons">
          <template v-if="!result">
            <el-button :disabled="applying" @click="open = false">取消</el-button>
            <el-button type="primary" :loading="applying" :disabled="!canApply" data-test="holiday-apply" @click="apply">套用</el-button>
          </template>
          <el-button v-else type="primary" @click="open = false">完成</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.holiday__lead { margin: 0 0 16px; }
.holiday-dialog h3 { margin: 16px 0 8px; font-size: var(--text-base); }
.holiday__source h3 { margin-top: 0; }
.holiday__source-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.holiday__source-row .el-button + .el-button { margin-left: 0; }
.holiday__year { width: 220px; }
.holiday__alert { margin-top: 12px; }
.holiday__loaded { margin: 8px 0 0; }
.holiday__days { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0 16px; max-height: 280px; overflow-y: auto; padding: 4px 8px; border: 1px solid var(--line); border-radius: var(--radius); }
/* Element Plus 的勾選框不換行：長節日名（孔子誕辰紀念日/教師節）在兩欄時會被切掉。 */
.holiday__days :deep(.el-checkbox) { height: auto; min-height: 32px; margin-right: 0; white-space: normal; align-items: flex-start; padding: 4px 0; }
.holiday__days :deep(.el-checkbox__input) { margin-top: 3px; }
.holiday__days :deep(.el-checkbox__label) { line-height: 1.5; }
.holiday__past { margin-left: 6px; color: var(--ink-3); font-size: var(--text-sm); }
.holiday__campuses { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.holiday__preview, .holiday__result { margin-top: 16px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.holiday__preview:empty { display: none; }
.holiday__preview ul, .holiday__result ul { margin: 0; padding-left: 18px; }
.holiday__preview li, .holiday__result li { margin: 4px 0; overflow-wrap: anywhere; }
.holiday__result ul { margin-top: 12px; }
.holiday__call { margin: 12px 0 0; }
.holiday__footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.holiday__missing { margin: 0; color: var(--ink-3); font-size: var(--text-sm); text-align: left; }
.holiday__buttons { display: flex; gap: 8px; margin-left: auto; }
.holiday__buttons .el-button + .el-button { margin-left: 0; }
@media (max-width: 720px) {
  .holiday__year { width: 100%; }
  /* 「從政府資料開放平台下載」在 390 寬和上傳鈕並排會貼邊：手機各占一列。 */
  .holiday__source-row .el-button { flex: 1 1 100%; min-height: 44px; }
  .holiday__days { grid-template-columns: 1fr; max-height: 240px; }
  .holiday__days :deep(.el-checkbox) { min-height: 44px; align-items: center; }
  .holiday__days :deep(.el-checkbox__input) { margin-top: 0; }
  .holiday__buttons { width: 100%; }
  .holiday__buttons .el-button { flex: 1; min-height: 44px; }
}
</style>
