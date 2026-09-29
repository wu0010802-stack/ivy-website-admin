<script setup lang="ts">
// 每週開放規則、公開時間窗與休假日（規格 6.3）。系統每天依規則把時段補到
// 「最遠開放天數」；也可以按「依規則產生時段」立即補一段日期。存規則時，依
// 規則產生、還沒有人預約的時段會跟著新規則調整（規格 L227）；已有家長排入、
// 園方手動新增或手動關閉的時段不動。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import { api } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import { attentionListPath, formatDate, formatWeekday, slotSyncLines, type SlotSyncResult } from '../api/labels'
import { useNarrowScreen } from '../composables/useNarrowScreen'

interface RuleRow { weekday: number; start_time: string; end_time: string; slot_minutes: number; capacity: number }
interface ExceptionRow { id: string; exception_date: string; reason: string | null }
interface Schedule { campus_key: string; min_lead_hours: number; max_advance_days: number; rules: RuleRow[]; exceptions: ExceptionRow[]; rules_extended_on?: string | null; version: number; slot_sync?: SlotSyncResult | null }

const props = defineProps<{ campusKey: string; canManage: boolean }>()
const emit = defineEmits<{ (e: 'slots-changed'): void }>()

const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']

const schedule = ref<Schedule | null>(null)
const rules = ref<RuleRow[]>([])
const leadHours = ref(24)
const advanceDays = ref(60)
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const error = ref<string | null>(null)

function taipeiDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.now() + offsetDays * 86400000))
}
const genRange = ref<[string, string]>([taipeiDate(), taipeiDate(28)])
const newException = ref({ date: taipeiDate(1), reason: '' })
// 設休假日時當天還有家長要來：留一個看得到、點得到的提醒，不是幾秒就消失的訊息。
const attentionNotice = ref<{ date: string; count: number } | null>(null)
// 改規則後，不在新規則內但已有家長排入的場次維持原樣（可能還開放新預約），
// 要園方自己決定：同樣留一個不會自動消失的提醒。
const keptBooked = ref(0)
watch(() => props.campusKey, () => { attentionNotice.value = null; keptBooked.value = 0 })
// 手機上日期區間只顯示一個月，雙月面板約 646px 會超出 390px 螢幕。
const narrow = useNarrowScreen()

const errorText = apiErrorMessage

async function load() {
  if (!props.campusKey) return
  loading.value = true
  error.value = null
  try {
    const result = await api.get<Schedule>(`/admin/visit-schedule/${props.campusKey}`)
    // 回應形狀不對（例如代理回了別的東西）就當讀取失敗，不讓畫面在
    // 計算「有沒有改過」時整個丟例外。
    if (!result || !Array.isArray(result.rules) || !Array.isArray(result.exceptions)) {
      schedule.value = null
      error.value = '無法讀取開放規則'
      return
    }
    schedule.value = result
    rules.value = result.rules.map((r) => ({ ...r }))
    leadHours.value = result.min_lead_hours
    advanceDays.value = result.max_advance_days
  } catch (err) {
    error.value = errorText(err, '無法讀取開放規則')
  } finally {
    loading.value = false
  }
}
watch(() => props.campusKey, load, { immediate: true })

const dirty = computed(() => {
  const s = schedule.value
  if (!s) return false
  return (
    s.min_lead_hours !== leadHours.value ||
    s.max_advance_days !== advanceDays.value ||
    JSON.stringify(s.rules.map(({ weekday, start_time, end_time, slot_minutes, capacity }) => ({ weekday, start_time, end_time, slot_minutes, capacity }))) !==
      JSON.stringify(rules.value.map(({ weekday, start_time, end_time, slot_minutes, capacity }) => ({ weekday, start_time, end_time, slot_minutes, capacity })))
  )
})

function slotsPerDay(rule: RuleRow): number {
  const [sh, sm] = rule.start_time.split(':').map(Number)
  const [eh, em] = rule.end_time.split(':').map(Number)
  const minutes = eh! * 60 + em! - (sh! * 60 + sm!)
  return minutes > 0 && rule.slot_minutes > 0 ? Math.floor(minutes / rule.slot_minutes) : 0
}

const rulesValid = computed(() => rules.value.every((r) => r.start_time < r.end_time && slotsPerDay(r) > 0))

function addRule() {
  const last = rules.value[rules.value.length - 1]
  rules.value.push(last ? { ...last, weekday: (last.weekday + 1) % 7 } : { weekday: 2, start_time: '09:30:00', end_time: '11:00:00', slot_minutes: 30, capacity: 1 })
}

async function save() {
  if (!rulesValid.value) return
  saving.value = true
  try {
    const result = await api.put<Schedule>(`/admin/visit-schedule/${props.campusKey}`, {
      expected_version: schedule.value?.version,
      min_lead_hours: leadHours.value,
      max_advance_days: advanceDays.value,
      rules: rules.value,
    })
    schedule.value = result
    rules.value = result.rules.map((r) => ({ ...r }))
    const changes = slotSyncLines({ ...result.slot_sync, kept_booked: 0 })
    ElMessage.success(`已儲存開放規則。${changes.length ? `還沒有人預約的時段已跟著調整：${changes.join('、')}。` : ''}系統稍後會依新規則補上 ${result.max_advance_days} 天內的時段；要馬上開放可以按「依規則產生時段」。`)
    keptBooked.value = result.slot_sync?.kept_booked ?? 0
    if (result.slot_sync && changes.length) emit('slots-changed')
  } catch (err) {
    if (isVersionConflict(err)) await offerReload(err)
    else ElMessage.error(errorText(err, '儲存失敗'))
  } finally {
    saving.value = false
  }
}

// 別人先存了規則：整份替換會把對方的修改蓋掉，所以不送出，請使用者重新載入
// 看過最新的規則再改（取消就留著自己的修改，可以先抄下來）。
async function offerReload(err: unknown) {
  try {
    await ElMessageBox.confirm(
      `${errorText(err, '開放規則剛被其他人修改')}。重新載入會顯示最新的規則，你這次還沒儲存的修改會捨棄。`,
      '規則已被更新',
      { confirmButtonText: '重新載入', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  await load()
}

async function generate() {
  if (dirty.value) {
    ElMessage.warning('規則還沒儲存，請先儲存再產生時段')
    return
  }
  generating.value = true
  try {
    const result = await api.post<{ created: number; skipped_existing: number; skipped_exception_days: number }>(
      `/admin/visit-schedule/${props.campusKey}/generate`,
      { date_from: genRange.value[0], date_to: genRange.value[1] },
    )
    const extra = [
      result.skipped_existing ? `${result.skipped_existing} 場已存在沒動` : '',
      result.skipped_exception_days ? `跳過 ${result.skipped_exception_days} 個休假日` : '',
    ].filter(Boolean).join('，')
    ElMessage.success(`新增 ${result.created} 場時段${extra ? `（${extra}）` : ''}`)
    emit('slots-changed')
  } catch (err) {
    ElMessage.error(errorText(err, '產生失敗'))
  } finally {
    generating.value = false
  }
}

async function addException() {
  if (!newException.value.date) return
  try {
    await ElMessageBox.confirm('這一天的時段會全部關閉，不再接受新預約。已排入的家長不會自動取消，會列入參觀案件的「待人工處理」，請聯絡後改期。', `${formatDate(newException.value.date)} 設為休假？`, {
      confirmButtonText: '設為休假',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const date = newException.value.date
    const result = await api.post<{ closed_slots: number; affected_requests: number }>(`/admin/visit-schedule/${props.campusKey}/exceptions`, {
      exception_date: date,
      reason: newException.value.reason.trim() || null,
    })
    ElMessage.success(result.closed_slots ? `已設為休假，關閉 ${result.closed_slots} 場時段` : '已設為休假')
    attentionNotice.value = result.affected_requests > 0 ? { date, count: result.affected_requests } : null
    newException.value.reason = ''
    await load()
    emit('slots-changed')
  } catch (err) {
    ElMessage.error(errorText(err, '設定失敗'))
  }
}

async function removeException(row: ExceptionRow) {
  try {
    const result = await api.delete<{ reopened_slots: number; created_slots: number }>(`/admin/visit-schedule/${props.campusKey}/exceptions/${row.id}`)
    const parts = [
      result?.reopened_slots ? `重新開放 ${result.reopened_slots} 場` : '',
      result?.created_slots ? `依規則補上 ${result.created_slots} 場` : '',
    ].filter(Boolean)
    ElMessage.success(`已取消休假${parts.length ? `，${parts.join('、')}` : ''}。手動關閉的時段維持關閉。`)
    if (attentionNotice.value?.date === row.exception_date) attentionNotice.value = null
    await load()
    emit('slots-changed')
  } catch (err) {
    ElMessage.error(errorText(err, '取消失敗'))
  }
}

function disablePast(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}
</script>

<template>
  <section class="panel schedule" :aria-busy="loading">
    <div class="panel__head">
      <h2>每週開放規則</h2>
      <span class="hint">系統每天依規則把時段補到最遠開放天數；改規則時，還沒有人預約的時段會跟著調整</span>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <div v-else class="panel__body schedule__body">
      <div class="schedule__window">
        <label>最短提前
          <el-input-number v-model="leadHours" :min="0" :max="336" :disabled="!canManage" size="small" controls-position="right" /> 小時
        </label>
        <label>最遠開放
          <el-input-number v-model="advanceDays" :min="1" :max="365" :disabled="!canManage" size="small" controls-position="right" /> 天
        </label>
        <span class="hint">家長只看得到這個範圍內的時段</span>
      </div>

      <p v-if="rules.length === 0" class="hint">還沒有規則。例如「週三 09:30–11:00，每 30 分鐘一場、每場 1 組」。</p>
      <ul class="rules">
        <li v-for="(rule, index) in rules" :key="index" class="rules__row">
          <el-select v-model="rule.weekday" :disabled="!canManage" size="small" style="width: 84px" aria-label="星期">
            <el-option v-for="(label, day) in WEEKDAYS" :key="day" :label="label" :value="day" />
          </el-select>
          <el-time-picker v-model="rule.start_time" value-format="HH:mm:ss" format="HH:mm" :clearable="false" :disabled="!canManage" size="small" style="width: 96px" aria-label="開始時間" />
          <span>–</span>
          <el-time-picker v-model="rule.end_time" value-format="HH:mm:ss" format="HH:mm" :clearable="false" :disabled="!canManage" size="small" style="width: 96px" aria-label="結束時間" />
          <span>每</span>
          <el-input-number v-model="rule.slot_minutes" :min="10" :max="240" :step="10" :disabled="!canManage" size="small" controls-position="right" style="width: 90px" aria-label="每場分鐘" />
          <span>分鐘一場，每場</span>
          <el-input-number v-model="rule.capacity" :min="1" :max="200" :disabled="!canManage" size="small" controls-position="right" style="width: 80px" aria-label="每場名額" />
          <span>組</span>
          <span class="hint" :class="{ 'is-bad': slotsPerDay(rule) === 0 }">{{ slotsPerDay(rule) ? `共 ${slotsPerDay(rule)} 場` : '時間不夠一場' }}</span>
          <el-button v-if="canManage" text :icon="Delete" aria-label="刪除這條規則" @click="rules.splice(index, 1)" />
        </li>
      </ul>
      <div v-if="canManage" class="schedule__actions">
        <el-button :icon="Plus" size="small" @click="addRule">新增規則</el-button>
        <el-button type="primary" size="small" :loading="saving" :disabled="!dirty || !rulesValid" @click="save">儲存規則</el-button>
      </div>
      <el-alert v-if="keptBooked" type="warning" show-icon :closable="true" class="schedule__attention" title="有已排入家長的場次不在新規則內" @close="keptBooked = 0">
        <p>{{ keptBooked }} 場不在新規則內，但已有家長排入，維持原樣、仍可能接受新預約。照常接待但不想再收新預約，請在下方時段清單把名額調成已占用的組數；這一場不能接待，就關閉時段後聯絡家長改期。</p>
      </el-alert>

      <p v-if="schedule?.rules.length" class="hint">{{ schedule.rules_extended_on ? `上次自動補時段：${formatDate(schedule.rules_extended_on)}，補到 ${schedule.max_advance_days} 天內。` : '系統稍後會依規則自動補上時段。' }}整天不開放請設休假日；單一場次不開放可以在時段清單關閉，系統不會把它重新打開。</p>

      <div v-if="canManage" class="schedule__generate">
        <el-date-picker v-model="genRange" type="daterange" value-format="YYYY-MM-DD" :clearable="false" :disabled-date="disablePast" :single-panel="narrow" start-placeholder="開始" end-placeholder="結束" size="small" />
        <el-button size="small" :loading="generating" :disabled="rules.length === 0" @click="generate">依規則產生時段</el-button>
        <span class="hint">立即補一段日期；可以重複按，已存在的時段不會重複建立</span>
      </div>

      <h3 class="schedule__sub">休假日與臨時封鎖</h3>
      <el-alert v-if="attentionNotice" type="warning" show-icon :closable="true" class="schedule__attention" title="休假日當天還有家長要來" @close="attentionNotice = null">
        <p>{{ formatDate(attentionNotice.date) }} 還有 {{ attentionNotice.count }} 組家庭已排入。請聯絡家長後在案件頁處理：已確認的用「改期（換時段）」換到其他場次，待園方確認的先「退回聯絡中」再重新排入；不來了就取消預約。</p>
        <router-link :to="attentionListPath(campusKey)">查看待人工處理的案件 →</router-link>
      </el-alert>
      <ul v-if="schedule?.exceptions.length" class="exceptions">
        <li v-for="row in schedule.exceptions" :key="row.id">
          <span class="num">{{ formatDate(row.exception_date) }}（{{ formatWeekday(row.exception_date) }}）</span>
          <span>{{ row.reason || '未填原因' }}</span>
          <el-button v-if="canManage" text size="small" @click="removeException(row)">取消休假</el-button>
        </li>
      </ul>
      <p v-else class="hint">接下來沒有休假日。</p>
      <div v-if="canManage" class="schedule__generate">
        <el-date-picker v-model="newException.date" type="date" value-format="YYYY-MM-DD" :clearable="false" :disabled-date="disablePast" size="small" aria-label="休假日期" />
        <el-input v-model="newException.reason" placeholder="原因，例如：教師研習" maxlength="200" size="small" style="width: 220px" />
        <el-button size="small" @click="addException">設為休假</el-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.schedule { margin-bottom: 16px; }
.schedule__body { display: grid; gap: 12px; }
.schedule__window, .schedule__generate, .schedule__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 13px; color: var(--ink-2); }
.schedule__window label { display: inline-flex; align-items: center; gap: 6px; }
.rules, .exceptions { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rules__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
.exceptions li { display: flex; gap: 12px; align-items: center; font-size: 14px; }
.is-bad { color: var(--el-color-danger); }
.schedule__sub { margin: 8px 0 0; font-size: 14px; }
.schedule__attention p { margin: 0 0 4px; }
</style>
