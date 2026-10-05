<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyError, notifyWarning } from '../../composables/notify'
import { api, ApiError } from '../../api/client'
import { apiErrorMessage, isVersionConflict } from '../../api/errors'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { ADVANCE_OPTIONS, LEAD_OPTIONS, advanceLabel, leadLabel, slotSyncLines, type SlotSyncResult } from '../../api/labels'
import { useUnsavedChanges } from '../../composables/useUnsavedChanges'
import { COMMON_SESSIONS, WEEKDAY_NAMES, rulesToSessions, sessionName, sessionProblems, sessionsToRules, weekdaySummary, type RuleRow, type Session } from '../../utils/sessions'

interface Schedule { campus_key: string; min_lead_hours: number; max_advance_days: number; rules: RuleRow[]; version: number; slot_sync?: Partial<SlotSyncResult> | null }
interface BookingConfig { mode: string; version: number; line_url?: string | null; phone?: string | null; external_url?: string | null; message?: string | null }
interface Reason { code: string; message: string }

const props = defineProps<{ campusKey: string; canManage: boolean; canConfigureBooking: boolean }>()
const emit = defineEmits<{ saved: [] }>()

const TIME_OPTIONS = Array.from({ length: 23 }, (_, i) => {
  const total = 7 * 60 + i * 30
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})
const MINUTE_OPTIONS = [30, 45, 60, 90, 120]
const CAPACITY_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)

const schedule = ref<Schedule | null>(null)
const bookingConfig = ref<BookingConfig | null>(null)
const loadError = ref('')
const editing = ref(false)
const saving = ref(false)
const sessions = ref<Session[]>([])
const leadHours = ref(24)
const advanceDays = ref(60)
const snapshot = ref('')
const notReady = ref<Reason[]>([])
const keptBooked = ref(0)
const requests = useRequestSequence()

const savedSessions = computed(() => rulesToSessions(schedule.value?.rules ?? []))
const uniformMinutes = computed(() => new Set(sessions.value.map(s => s.minutes)).size <= 1)
const problems = computed(() => sessionProblems(sessions.value))
const isDirty = computed(() => editing.value && JSON.stringify([sessions.value, leadHours.value, advanceDays.value]) !== snapshot.value)
const opensBooking = computed(() => props.canConfigureBooking && bookingConfig.value !== null && bookingConfig.value.mode !== 'slots')
const { confirmLeave } = useUnsavedChanges(isDirty, saving)
defineExpose({ confirmLeave })

async function load() {
  const request = requests.begin()
  loadError.value = ''
  try {
    const loaded = await api.get<Schedule>(`/admin/visit-schedule/${props.campusKey}`)
    const config = props.canConfigureBooking ? await api.get<BookingConfig>(`/admin/booking-config/${props.campusKey}`) : null
    // 快速換校時，晚到的上一校回應不能蓋掉目前這一校（否則會把 A 校的規則存到 B 校）。
    if (!requests.isCurrent(request)) return
    schedule.value = loaded
    bookingConfig.value = config
  } catch {
    if (requests.isCurrent(request)) loadError.value = '讀不到這個校區的場次設定，請重新載入。'
  }
}
watch(() => props.campusKey, () => { editing.value = false; notReady.value = []; keptBooked.value = 0; schedule.value = null; bookingConfig.value = null; void load() }, { immediate: true })

function startEdit(preset?: readonly Session[]) {
  sessions.value = (preset ?? savedSessions.value).map(s => ({ ...s, weekdays: [...s.weekdays] }))
  leadHours.value = schedule.value?.min_lead_hours ?? 24
  advanceDays.value = schedule.value?.max_advance_days ?? 60
  snapshot.value = preset ? '' : JSON.stringify([sessions.value, leadHours.value, advanceDays.value])
  notReady.value = []
  editing.value = true
}
function addSession() {
  const last = sessions.value[sessions.value.length - 1]
  sessions.value.push({ start: last ? '14:30' : '10:00', minutes: last?.minutes ?? 60, capacity: last?.capacity ?? 1, weekdays: last ? [...last.weekdays] : [0, 1, 2, 3, 4] })
}
function toggleDay(session: Session, day: number) {
  session.weekdays = session.weekdays.includes(day) ? session.weekdays.filter(d => d !== day) : [...session.weekdays, day].sort((a, b) => a - b)
}
function setAllMinutes(minutes: number) {
  sessions.value.forEach(s => { s.minutes = minutes })
}
function timeOptions(current: string) {
  return TIME_OPTIONS.includes(current) ? TIME_OPTIONS : [...TIME_OPTIONS, current].sort()
}

async function save(options: { open?: boolean } = {}) {
  if (!schedule.value || problems.value.length || saving.value) return
  const open = (options.open ?? true) && opensBooking.value
  if (open) {
    try {
      await ElMessageBox.confirm('家長從現在起可以在官網預約這些場次。', '儲存並開放線上預約？', { confirmButtonText: '儲存並開放', cancelButtonText: '先不要', type: 'info' })
    } catch { return }
  }
  saving.value = true
  notReady.value = []
  keptBooked.value = 0
  try {
    const result = await api.put<Schedule>(`/admin/visit-schedule/${props.campusKey}`, {
      expected_version: schedule.value.version,
      min_lead_hours: leadHours.value,
      max_advance_days: advanceDays.value,
      rules: sessionsToRules(sessions.value),
    })
    schedule.value = result
    editing.value = false
    const lines = slotSyncLines(result.slot_sync)
    ElMessage.success(lines.length ? `已儲存，${lines.join('，')}` : '已儲存')
    keptBooked.value = result.slot_sync?.kept_booked ?? 0
    emit('saved')
    if (open) await openBooking()
  } catch (err) {
    if (isVersionConflict(err)) {
      notifyWarning('場次剛被其他人修改，已重新載入最新設定')
      await load()
      startEdit()
    } else {
      notifyError(apiErrorMessage(err, '儲存失敗，請稍後再試'))
    }
  } finally {
    saving.value = false
  }
}

async function openBooking() {
  try {
    const config = await api.get<BookingConfig>(`/admin/booking-config/${props.campusKey}`)
    // 後端一律寫入這四個欄位，沒帶的會被清成空：把原值帶回去，只改預約方式。
    bookingConfig.value = await api.patch<BookingConfig>(`/admin/booking-config/${props.campusKey}`, {
      expected_version: config.version,
      mode: 'slots',
      line_url: config.line_url ?? null,
      phone: config.phone ?? null,
      external_url: config.external_url ?? null,
      message: config.message ?? null,
    })
    ElMessage.success('已開放線上預約')
  } catch (err) {
    const detail = err instanceof ApiError ? (err.detail as { code?: string; reasons?: Reason[] } | null) : null
    notReady.value = detail?.code === 'BOOKING_MODE_NOT_READY' ? detail.reasons ?? [] : [{ code: 'UNKNOWN', message: '開放線上預約失敗，請到「各校預約方式」再試一次' }]
  }
}
</script>

<template>
  <section class="panel sessions-card" aria-labelledby="sessions-card-title">
    <div class="panel__head">
      <h2 id="sessions-card-title">每週固定場次</h2>
      <el-button v-if="canManage && !editing && savedSessions.length" @click="startEdit()">修改場次</el-button>
    </div>
    <div class="panel__body">
      <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError"><el-button size="small" @click="load">重新載入</el-button></el-alert>

      <template v-else-if="!editing">
        <template v-if="savedSessions.length">
          <ul class="sessions-card__summary">
            <li v-for="s in savedSessions" :key="`${s.start}-${s.minutes}-${s.capacity}`">{{ sessionName(s.start) }}・每場 {{ s.capacity }} 組・{{ weekdaySummary(s.weekdays) }}</li>
          </ul>
          <p class="hint">家長最晚{{ leadLabel(schedule?.min_lead_hours ?? 24) }}預約，可預約 {{ advanceLabel(schedule?.max_advance_days ?? 60) }}的場次。</p>
        </template>
        <div v-else-if="schedule" class="sessions-card__empty">
          <p>還沒有固定場次。常用的是上午場 10:00、下午場 14:30，週一到週五，每場 1 組。</p>
          <!-- 兩顆並排在同一列：直排時 Element Plus 相鄰按鈕的左外距會讓第二顆往右縮一格。 -->
          <div v-if="canManage" class="sessions-card__empty-actions">
            <el-button type="primary" @click="startEdit(COMMON_SESSIONS)">套用常用場次</el-button>
            <el-button @click="startEdit([])">自己設定</el-button>
          </div>
          <p v-else class="hint">場次由校區管理者設定。</p>
        </div>
        <el-alert v-if="keptBooked" type="warning" :closable="false" show-icon :title="`${keptBooked} 場已有家長排入、但不在新規則內，仍會收新預約`">
          <p>要讓這幾場不再收新預約，請在月曆上點那一天，按該場的「停止申請」；已約好的家長照常參觀。</p>
        </el-alert>
        <el-alert v-if="notReady.length" type="warning" :closable="false" show-icon title="場次已儲存，但還不能開放線上預約">
          <ul><li v-for="r in notReady" :key="r.code">{{ r.message }}</li></ul>
          <router-link :to="`/booking?campus=${encodeURIComponent(campusKey)}`">到各校預約方式查看 →</router-link>
        </el-alert>
      </template>

      <form v-else class="sessions-card__edit" @submit.prevent="save()">
        <div v-for="(s, index) in sessions" :key="index" class="session-row">
          <label class="session-row__field"><span>場次時間</span>
            <el-select v-model="s.start" class="session-row__time" :aria-label="`第 ${index + 1} 個場次的時間`">
              <el-option v-for="t in timeOptions(s.start)" :key="t" :label="t" :value="t" />
            </el-select>
            <span class="session-row__name">{{ sessionName(s.start).split(' ')[0] }}</span>
          </label>
          <label class="session-row__field"><span>每場組數</span>
            <el-select v-model="s.capacity" class="session-row__capacity" :aria-label="`第 ${index + 1} 個場次每場幾組`">
              <el-option v-for="n in (CAPACITY_OPTIONS.includes(s.capacity) ? CAPACITY_OPTIONS : [...CAPACITY_OPTIONS, s.capacity])" :key="n" :label="`${n} 組`" :value="n" />
            </el-select>
          </label>
          <div class="session-row__days" role="group" :aria-label="`第 ${index + 1} 個場次開放的星期`">
            <button v-for="(name, day) in WEEKDAY_NAMES" :key="day" type="button" class="day-toggle" :aria-pressed="s.weekdays.includes(day)" @click="toggleDay(s, day)">{{ name }}</button>
          </div>
          <label v-if="!uniformMinutes" class="session-row__field"><span>每場多久</span>
            <el-select v-model="s.minutes"><el-option v-for="m in MINUTE_OPTIONS" :key="m" :label="`${m} 分鐘`" :value="m" /></el-select>
          </label>
          <el-button text :aria-label="`刪除${sessionName(s.start)}`" @click="sessions.splice(index, 1)">刪除</el-button>
        </div>
        <el-button @click="addSession">＋新增場次</el-button>

        <details class="sessions-card__advanced">
          <summary>進階設定</summary>
          <label v-if="uniformMinutes && sessions.length"><span>每場參觀約多久</span>
            <el-select :model-value="sessions[0]!.minutes" @update:model-value="setAllMinutes"><el-option v-for="m in MINUTE_OPTIONS" :key="m" :label="`${m} 分鐘`" :value="m" /></el-select>
          </label>
          <label><span>家長最晚何時預約</span>
            <el-select v-model="leadHours"><el-option v-for="h in (LEAD_OPTIONS as readonly number[]).includes(leadHours) ? LEAD_OPTIONS : [...LEAD_OPTIONS, leadHours]" :key="h" :label="leadLabel(h)" :value="h" /></el-select>
          </label>
          <label><span>最多可預約多久以後</span>
            <el-select v-model="advanceDays"><el-option v-for="d in (ADVANCE_OPTIONS as readonly number[]).includes(advanceDays) ? ADVANCE_OPTIONS : [...ADVANCE_OPTIONS, advanceDays]" :key="d" :label="advanceLabel(d)" :value="d" /></el-select>
          </label>
        </details>

        <ul v-if="problems.length" class="sessions-card__problems" role="alert"><li v-for="p in problems" :key="p">{{ p }}</li></ul>
        <div class="sessions-card__actions">
          <el-button @click="editing = false">取消</el-button>
          <el-button type="primary" native-type="submit" :loading="saving" :disabled="Boolean(problems.length) || !sessions.length">{{ opensBooking ? '儲存並開放線上預約' : '儲存' }}</el-button>
          <el-button v-if="opensBooking" :loading="saving" :disabled="Boolean(problems.length) || !sessions.length" @click="save({ open: false })">只儲存場次</el-button>
          <span v-if="!canConfigureBooking" class="hint">要讓家長在官網預約，請校區管理者到「各校預約方式」開放。</span>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.sessions-card { margin-bottom: 16px; }
.sessions-card__summary { margin: 0 0 8px; padding-left: 1.2em; }
.sessions-card__empty { display: grid; gap: 8px; justify-items: start; }
.sessions-card__empty-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.sessions-card__empty-actions .el-button + .el-button { margin-left: 0; }
.session-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.session-row__field { display: grid; gap: 4px; }
.session-row__time { width: 110px; }
.session-row__capacity { width: 96px; }
.session-row__days { display: flex; gap: 4px; }
.day-toggle { min-width: 36px; min-height: 36px; border: 1px solid var(--line-strong); border-radius: 18px; background: var(--surface); color: var(--ink); }
.day-toggle[aria-pressed='true'] { background: var(--admin-accent); color: var(--surface); border-color: var(--admin-accent); }
.sessions-card__advanced { margin-top: 12px; }
.sessions-card__advanced label { display: grid; gap: 4px; margin-top: 8px; max-width: 240px; }
.sessions-card__problems { color: var(--el-color-danger); }
.sessions-card__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
</style>
