<script setup lang="ts">
// 每週開放規則、公開時間窗與休假日（規格 6.3）。系統每天依規則把時段補到
// 「最遠開放天數」；也可以按「依規則產生時段」立即補一段日期。存規則時，依
// 規則產生、還沒有人預約的時段會跟著新規則調整（規格 L227）；已有家長排入、
// 園方手動新增或手動關閉的時段不動。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowUp, Delete, Plus } from '@element-plus/icons-vue'
import { api } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import { attentionListPath, formatDate, formatTime, formatWeekday, slotSyncLines, type SlotSyncResult } from '../api/labels'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import { useRequestSequence } from '../composables/useRequestSequence'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

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
const exceptionBusy = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

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
// 存規則後新場次交給定期工作補（約一分鐘），不是馬上出現在清單：說明留在
// 面板裡，不放三秒就消失的訊息；一分多鐘後再請時段頁背景重讀一次，新場次
// 不必自己按重新整理就會出現。
const savedNote = ref('')
const REFILL_REFRESH_MS = 70_000
let refillTimer: ReturnType<typeof setTimeout> | undefined
function clearRefillTimer() {
  if (refillTimer !== undefined) clearTimeout(refillTimer)
  refillTimer = undefined
}
onBeforeUnmount(clearRefillTimer)
// 手機上日期區間只顯示一個月，雙月面板約 646px 會超出 390px 螢幕。手機的數字框
// 改用左右兩側的加減鈕，右側上下疊的小鈕在手機上只有 22px 高、點不準。
const narrow = useNarrowScreen()
const controlsPosition = computed(() => (narrow.value ? '' : 'right'))

const errorText = apiErrorMessage

function apply(result: Schedule) {
  schedule.value = result
  rules.value = result.rules.map((r) => ({ ...r }))
  leadHours.value = result.min_lead_hours
  advanceDays.value = result.max_advance_days
}

async function load() {
  const request = requests.begin()
  if (!props.campusKey) return
  loading.value = true
  error.value = null
  try {
    const result = await api.get<Schedule>(`/admin/visit-schedule/${props.campusKey}`)
    if (!requests.isCurrent(request)) return
    // 回應形狀不對（例如代理回了別的東西）就當讀取失敗，不讓畫面在
    // 計算「有沒有改過」時整個丟例外。
    if (!result || !Array.isArray(result.rules) || !Array.isArray(result.exceptions)) {
      schedule.value = null
      rules.value = []
      error.value = '無法讀取開放規則'
      return
    }
    apply(result)
  } catch (err) {
    if (requests.isCurrent(request)) error.value = errorText(err, '無法讀取開放規則')
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}
// 換校時先清掉上一校的規則：讀到之前顯示骨架，不讓上一校的規則或「尚未設定」
// 暫時冒出來，被誤以為規則被清掉了。只採用最後一次讀取的回應。
watch(() => props.campusKey, () => {
  schedule.value = null
  rules.value = []
  attentionNotice.value = null
  keptBooked.value = 0
  savedNote.value = ''
  clearRefillTimer()
  void load()
}, { immediate: true })

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
// 規則改了還沒存：切校區（由時段頁呼叫 confirmLeave）、點側欄或關分頁都先確認。
const { confirmLeave } = useUnsavedChanges(dirty, saving)
// 存規則、產生時段、設或取消休假還在路上：時段頁先不讓換校，回應才不會顯示在
// 新選的那一校。
const busy = computed(() => saving.value || generating.value || exceptionBusy.value)
defineExpose({ confirmLeave, busy })

// 每週規則一學期才改幾次，時段清單才是每天要看的：預設收合成一行摘要。
// 有未儲存的修改時一律展開，不讓修改藏在收合的面板裡。
const open = ref(false)
const expanded = computed(() => open.value || dirty.value)
function toggle() {
  if (expanded.value && dirty.value) {
    ElMessage.info('每週規則還沒儲存，儲存後才能收合')
    return
  }
  open.value = !open.value
}

function timeRange(rule: RuleRow): string {
  return `${formatTime(rule.start_time)}–${formatTime(rule.end_time)}`
}

// 收合時的一行摘要：看得出有沒有規則、開哪幾天、家長能約多遠。
const summary = computed(() => {
  const s = schedule.value
  if (!s) return loading.value ? '讀取中…' : error.value ?? ''
  const parts: string[] = []
  if (s.rules.length === 0) {
    parts.push('尚未設定每週規則')
  } else {
    const days = [...new Set(s.rules.map((r) => r.weekday))].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join('、')
    const ranges = new Set(s.rules.map(timeRange))
    parts.push(ranges.size === 1 ? `${days} ${timeRange(s.rules[0]!)}` : `${days}，共 ${s.rules.length} 條規則`)
  }
  parts.push(`家長可約 ${s.min_lead_hours} 小時後到 ${s.max_advance_days} 天內的場次`)
  if (s.exceptions.length) parts.push(`休假日 ${s.exceptions.length} 天`)
  return parts.join('・')
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
    apply(result)
    const changes = slotSyncLines({ ...result.slot_sync, kept_booked: 0 })
    ElMessage.success(`已儲存開放規則。${changes.length ? `還沒有人預約的時段已跟著調整：${changes.join('、')}。` : ''}`)
    savedNote.value = result.rules.length
      ? `系統約一分鐘內會依新規則補上 ${result.max_advance_days} 天內的時段，下方清單會自動更新；要馬上開放，請按「依規則產生時段」。`
      : ''
    keptBooked.value = result.slot_sync?.kept_booked ?? 0
    if (result.slot_sync && changes.length) emit('slots-changed')
    clearRefillTimer()
    if (result.rules.length) {
      refillTimer = setTimeout(() => {
        refillTimer = undefined
        emit('slots-changed')
      }, REFILL_REFRESH_MS)
    }
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

// 收合時標題列的「依規則產生時段」：展開後把焦點移到產生時段那一列，
// 日期區間看得到、可以先改，再按一次才真的產生。
const generateRow = ref<HTMLElement | null>(null)
const generateHighlight = ref(false)
async function openGenerate() {
  open.value = true
  await nextTick()
  const row = generateRow.value
  if (!row) return
  row.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  row.querySelector<HTMLButtonElement>('.schedule__generate-button')?.focus()
  generateHighlight.value = true
  window.setTimeout(() => { generateHighlight.value = false }, 1600)
}

async function addException() {
  if (!newException.value.date || exceptionBusy.value) return
  try {
    await ElMessageBox.confirm('這一天的時段會全部關閉，不再接受新預約。已排入的家長不會自動取消，會列入參觀案件的「待人工處理」，請聯絡後改期。', `${formatDate(newException.value.date)} 設為休假？`, {
      confirmButtonText: '設為休假',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  exceptionBusy.value = true
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
  } finally {
    exceptionBusy.value = false
  }
}

// 取消休假會把當天的時段重新開給家長預約（還會依規則補場次），和設為休假
// 一樣先問一次；小小的文字鈕很容易誤觸。
async function removeException(row: ExceptionRow) {
  if (exceptionBusy.value) return
  try {
    await ElMessageBox.confirm('當天的時段會重新開放給家長預約，並依每週規則補上缺少的場次；手動關閉的時段維持關閉。', `取消 ${formatDate(row.exception_date)} 的休假？`, {
      confirmButtonText: '取消休假',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  exceptionBusy.value = true
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
  } finally {
    exceptionBusy.value = false
  }
}

function disablePast(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}
</script>

<template>
  <section class="panel schedule" :aria-busy="loading" aria-labelledby="schedule-title">
    <div class="panel__head schedule__head">
      <div class="schedule__heading">
        <h2 id="schedule-title">每週開放規則</h2>
        <p class="schedule__summary" :class="{ 'is-error': Boolean(error) }">
          <span v-if="dirty" class="dirty-note">有未儲存的修改・</span>{{ summary }}
        </p>
      </div>
      <div class="schedule__head-actions">
        <el-button v-if="error" :loading="loading" @click="load">重新載入</el-button>
        <el-button v-if="canManage && !expanded && schedule?.rules.length" @click="openGenerate">依規則產生時段…</el-button>
        <el-button
          :icon="expanded ? ArrowUp : ArrowDown"
          :aria-expanded="expanded ? 'true' : 'false'"
          aria-controls="schedule-body"
          @click="toggle"
        >
          {{ expanded ? '收合' : !canManage ? '查看規則' : schedule && !schedule.rules.length ? '設定每週規則' : '查看與修改' }}
        </el-button>
      </div>
    </div>
    <div v-show="expanded" id="schedule-body">
      <div v-if="error" class="panel__body schedule__error">
        <el-alert type="error" :closable="false" show-icon :title="error" description="請按上方「重新載入」再試一次。" />
      </div>
      <div v-if="!schedule && !error" class="panel__body">
        <el-skeleton animated :rows="3" />
      </div>
      <div v-else-if="schedule && !canManage" class="panel__body schedule__body">
        <!-- 唯讀帳號只列文字，不擺一整排停用的輸入框。 -->
        <p class="schedule__line">家長可預約：{{ schedule.min_lead_hours }} 小時後到 {{ schedule.max_advance_days }} 天內的場次。</p>
        <ul v-if="schedule.rules.length" class="rules rules--read">
          <li v-for="(rule, index) in schedule.rules" :key="index">
            {{ WEEKDAYS[rule.weekday] }} <span class="num">{{ timeRange(rule) }}</span>，每 {{ rule.slot_minutes }} 分鐘一場、每場 {{ rule.capacity }} 組（共 {{ slotsPerDay(rule) }} 場）
          </li>
        </ul>
        <p v-else class="hint">尚未設定每週規則。</p>
        <h3 class="schedule__sub">休假日與臨時封鎖</h3>
        <ul v-if="schedule.exceptions.length" class="exceptions">
          <li v-for="row in schedule.exceptions" :key="row.id">
            <span class="num">{{ formatDate(row.exception_date) }}（{{ formatWeekday(row.exception_date) }}）</span>
            <span>{{ row.reason || '未填原因' }}</span>
          </li>
        </ul>
        <p v-else class="hint">接下來沒有休假日。</p>
        <p class="hint">修改規則與休假日由校區管理者處理。</p>
      </div>
      <div v-else-if="schedule" class="panel__body schedule__body">
        <p class="hint">系統每天依規則把時段補到最遠開放天數；改規則時，還沒有人預約的時段會跟著調整。</p>
        <div class="schedule__window">
          <label class="schedule__field"><span class="schedule__label">最短提前</span>
            <el-input-number v-model="leadHours" :min="0" :max="336" :controls-position="controlsPosition" class="schedule__number" /> 小時
          </label>
          <label class="schedule__field"><span class="schedule__label">最遠開放</span>
            <el-input-number v-model="advanceDays" :min="1" :max="365" :controls-position="controlsPosition" class="schedule__number" /> 天
          </label>
          <span class="hint">家長只看得到這個範圍內的時段</span>
        </div>

        <p v-if="rules.length === 0" class="hint">還沒有規則。例如「週三 09:30–11:00，每 30 分鐘一場、每場 1 組」。</p>
        <ul class="rules">
          <li v-for="(rule, index) in rules" :key="index" class="rules__row">
            <div class="rules__when">
              <el-select v-model="rule.weekday" class="rules__weekday" aria-label="星期">
                <el-option v-for="(label, day) in WEEKDAYS" :key="day" :label="label" :value="day" />
              </el-select>
              <el-time-picker v-model="rule.start_time" value-format="HH:mm:ss" format="HH:mm" :clearable="false" class="rules__time" aria-label="開始時間" />
              <span aria-hidden="true">–</span>
              <el-time-picker v-model="rule.end_time" value-format="HH:mm:ss" format="HH:mm" :clearable="false" class="rules__time" aria-label="結束時間" />
            </div>
            <div class="rules__how">
              <span class="schedule__field"><span class="schedule__label">每場長度</span>
                <el-input-number v-model="rule.slot_minutes" :min="10" :max="240" :step="10" :controls-position="controlsPosition" class="schedule__number" aria-label="每場分鐘" /> 分鐘
              </span>
              <span class="schedule__field"><span class="schedule__label">每場名額</span>
                <el-input-number v-model="rule.capacity" :min="1" :max="200" :controls-position="controlsPosition" class="schedule__number" aria-label="每場名額" /> 組
              </span>
            </div>
            <div class="rules__foot">
              <span class="hint" :class="{ 'is-bad': slotsPerDay(rule) === 0 }">{{ slotsPerDay(rule) ? `共 ${slotsPerDay(rule)} 場` : '時間不夠一場' }}</span>
              <el-button text :icon="Delete" aria-label="刪除這條規則" class="rules__delete" @click="rules.splice(index, 1)" />
            </div>
          </li>
        </ul>
        <div class="schedule__actions">
          <el-button :icon="Plus" @click="addRule">新增規則</el-button>
          <el-button type="primary" :loading="saving" :disabled="!dirty || !rulesValid" @click="save">儲存規則</el-button>
          <span v-if="dirty" class="dirty-note" role="status">有未儲存的修改</span>
        </div>
        <el-alert v-if="savedNote" type="success" show-icon :closable="true" class="schedule__attention" :title="savedNote" @close="savedNote = ''" />
        <el-alert v-if="keptBooked" type="warning" show-icon :closable="true" class="schedule__attention" title="有已排入家長的場次不在新規則內" @close="keptBooked = 0">
          <p>{{ keptBooked }} 場不在新規則內，但已有家長排入，維持原樣、仍可能接受新預約。照常接待但不想再收新預約，請在下方時段清單把名額調成已占用的組數；這一場不能接待，就關閉時段後聯絡家長改期。</p>
        </el-alert>

        <p v-if="schedule.rules.length" class="hint">{{ schedule.rules_extended_on ? `上次自動補時段：${formatDate(schedule.rules_extended_on)}，補到 ${schedule.max_advance_days} 天內。` : '系統稍後會依規則自動補上時段。' }}整天不開放請設休假日；單一場次不開放可以在時段清單關閉，系統不會把它重新打開。</p>

        <div ref="generateRow" class="schedule__row schedule__generate" :class="{ 'is-highlight': generateHighlight }">
          <el-date-picker v-model="genRange" type="daterange" value-format="YYYY-MM-DD" :clearable="false" :disabled-date="disablePast" :single-panel="narrow" start-placeholder="開始" end-placeholder="結束" class="schedule__range" aria-label="產生時段的日期區間" />
          <el-button class="schedule__generate-button" :loading="generating" :disabled="rules.length === 0" @click="generate">依規則產生時段</el-button>
          <span class="hint">立即補一段日期；可以重複按，已存在的時段不會重複建立</span>
        </div>

        <h3 class="schedule__sub">休假日與臨時封鎖</h3>
        <el-alert v-if="attentionNotice" type="warning" show-icon :closable="true" class="schedule__attention" title="休假日當天還有家長要來" @close="attentionNotice = null">
          <p>{{ formatDate(attentionNotice.date) }} 還有 {{ attentionNotice.count }} 組家庭已排入。請聯絡家長後在案件頁處理：已確認的用「改期（換時段）」換到其他場次，待園方確認的先「退回聯絡中」再重新排入；不來了就取消預約。</p>
          <router-link :to="attentionListPath(campusKey)">查看待人工處理的案件 →</router-link>
        </el-alert>
        <ul v-if="schedule.exceptions.length" class="exceptions">
          <li v-for="row in schedule.exceptions" :key="row.id">
            <span class="num">{{ formatDate(row.exception_date) }}（{{ formatWeekday(row.exception_date) }}）</span>
            <span class="exceptions__reason">{{ row.reason || '未填原因' }}</span>
            <el-button text :disabled="exceptionBusy" @click="removeException(row)">取消休假</el-button>
          </li>
        </ul>
        <p v-else class="hint">接下來沒有休假日。</p>
        <div class="schedule__row schedule__exception">
          <el-date-picker v-model="newException.date" type="date" value-format="YYYY-MM-DD" :clearable="false" :disabled-date="disablePast" class="schedule__date" aria-label="休假日期" />
          <el-input v-model="newException.reason" placeholder="原因，例如：教師研習" maxlength="200" class="schedule__reason" aria-label="休假原因" />
          <el-button :loading="exceptionBusy" @click="addException">設為休假</el-button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.schedule { margin-bottom: 16px; }
.schedule__head { flex-wrap: wrap; align-items: center; }
.schedule__heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; flex: 1 1 320px; min-width: 0; }
.schedule__heading h2 { white-space: nowrap; }
.schedule__summary { min-width: 0; color: var(--ink-2); font-size: 13px; overflow-wrap: anywhere; }
.schedule__summary.is-error { color: var(--el-color-danger); }
.schedule__head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.schedule__head-actions .el-button + .el-button { margin-left: 0; }
/* 單欄格線要明寫 minmax(0,1fr)：日期區間的預設寬度會把整欄撐得比卡片還寬。 */
.schedule__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.schedule__window, .schedule__row, .schedule__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; font-size: 13px; color: var(--ink-2); }
.schedule__actions .el-button + .el-button { margin-left: 0; }
.schedule__field { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.schedule__number { width: 112px; }
.schedule__line { color: var(--ink-2); }
.rules, .exceptions { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rules__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding-bottom: 8px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--ink-2); }
.rules__when { display: grid; grid-template-columns: 96px 112px auto 112px; align-items: center; gap: 8px; }
/* 時間與日期選擇器的根節點在 tooltip 裡，吃不到 scoped 屬性，要從外層用 :deep
   指定寬度；Element Plus 預設固定 220px，會跟隔壁欄位疊在一起。 */
.rules__when :deep(.rules__time) { --el-date-editor-width: 100%; width: 100%; }
.rules__how { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
.rules__foot { display: inline-flex; align-items: center; gap: 8px 12px; }
.rules--read li { color: var(--ink-2); }
.exceptions li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; font-size: 14px; }
.exceptions__reason { min-width: 0; overflow-wrap: anywhere; }
.is-bad { color: var(--el-color-danger); }
.schedule__sub { margin: 8px 0 0; font-size: 14px; }
.schedule__attention p { margin: 0 0 4px; }
/* 日期區間的根節點是 .el-input__wrapper（預設 flex-grow:1），不收的話會撐滿整列。 */
.schedule__generate :deep(.schedule__range) { --el-date-editor-width: 300px; flex: 0 1 300px; width: 300px; max-width: 100%; }
.schedule__exception :deep(.schedule__date) { --el-date-editor-width: 160px; width: 160px; }
.schedule__reason { flex: 1 1 220px; min-width: 0; max-width: 320px; }
.schedule__generate { padding: 4px; margin: -4px; border-radius: var(--radius); transition: background-color 400ms var(--ease-out); }
.schedule__generate.is-highlight { background: var(--el-color-primary-light-9); }

@media (max-width: 720px) {
  .schedule__heading { flex-basis: 100%; }
  .schedule__summary { font-size: 14px; }
  .schedule__head-actions { width: 100%; }
  .schedule__window, .schedule__row, .schedule__actions, .rules__row { font-size: 14px; }
  .schedule__number { width: 128px; }
  /* 手機上星期、開始、結束排一列，其餘欄位各自換行；時鐘圖示讓位給時間。 */
  .rules__when { width: 100%; grid-template-columns: 84px minmax(0, 1fr) auto minmax(0, 1fr); }
  .rules__when :deep(.el-input__prefix) { display: none; }
  /* 「共 N 場」與刪除鈕同一列，不讓刪除鈕自己占一整列。 */
  .rules__foot { display: flex; width: 100%; justify-content: space-between; }
  .schedule__generate :deep(.schedule__range),
  .schedule__exception :deep(.schedule__date) { --el-date-editor-width: 100%; flex: 1 1 100%; width: 100%; }
  .schedule__reason { width: 100%; max-width: none; flex-basis: 100%; }
}
</style>
