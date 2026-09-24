<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { campusLabel, formatDate, formatTime, formatWeekday, staffLabel, visitSourceLabel, visitStatus } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import { useVisitStaff } from '../composables/useVisitStaff'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import StatusTag from '../components/StatusTag.vue'

// 接待月曆：跟案件列表讀同一份資料（visit_slots＋visit_requests），只是
// 按日期排開。格子裡只放時間與家長稱呼，點日期在下方看當天完整名單。

interface CalendarVisit {
  id: string
  status: string
  parent_name: string
  child_name: string | null
  phone: string
  source: string
  assigned_staff_id: string | null
}

interface CalendarSlot {
  id: string
  campus_key: string
  slot_date: string
  start_time: string
  end_time: string
  capacity: number
  closed: boolean
  booked_count: number
  visits: CalendarVisit[]
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MAX_CHIPS = 3

const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const { staff, load: loadStaff } = useVisitStaff()
const campusFilter = ref('')

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
}

// 日期一律用 YYYY-MM-DD 字串與 UTC 正午的 Date 計算，避免時區讓格子錯一天。
function parse(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}
function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}
function addDays(value: string, days: number): string {
  const d = parse(value)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

const today = taipeiToday()
const month = ref(today.slice(0, 7)) // YYYY-MM
const selectedDay = ref(today)

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-')
  return `${y} 年 ${Number(m)} 月`
})

// 月曆從該月第一天所在那週的星期一開始，排滿 6 週（42 格）。
const gridDays = computed(() => {
  const first = `${month.value}-01`
  const weekday = (parse(first).getUTCDay() + 6) % 7 // 星期一＝0
  const start = addDays(first, -weekday)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
})

const slots = ref<CalendarSlot[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const days = gridDays.value
    const params = new URLSearchParams({ date_from: days[0]!, date_to: days[days.length - 1]! })
    if (campusFilter.value) params.set('campus_key', campusFilter.value)
    const result = await api.get<CalendarSlot[]>(`/admin/visit-calendar?${params}`)
    if (requests.isCurrent(request)) slots.value = result
  } catch (err) {
    if (requests.isCurrent(request)) {
      slots.value = []
      error.value = err instanceof ApiError && err.status === 404 ? '你沒有這個校區的權限。' : '無法讀取接待月曆，請重新載入。'
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([month, campusFilter], load)
onMounted(() => {
  load()
  void loadStaff()
})

const slotsByDay = computed(() => {
  const map = new Map<string, CalendarSlot[]>()
  for (const slot of slots.value) {
    const list = map.get(slot.slot_date) ?? []
    list.push(slot)
    map.set(slot.slot_date, list)
  }
  return map
})

interface Chip { key: string; time: string; name: string; status: string }

function chipsOf(day: string): Chip[] {
  return (slotsByDay.value.get(day) ?? []).flatMap((slot) =>
    slot.visits.map((v) => ({ key: v.id, time: formatTime(slot.start_time), name: v.parent_name, status: v.status })),
  )
}

function openSeats(day: string): number {
  return (slotsByDay.value.get(day) ?? [])
    .filter((s) => !s.closed)
    .reduce((sum, s) => sum + Math.max(s.capacity - s.booked_count, 0), 0)
}

function shiftMonth(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1, 12))
  month.value = iso(d).slice(0, 7)
  selectedDay.value = `${month.value}-01`
}

function goToday() {
  month.value = today.slice(0, 7)
  selectedDay.value = today
}

function selectDay(day: string) {
  selectedDay.value = day
  if (day.slice(0, 7) !== month.value) month.value = day.slice(0, 7)
}

const selectedSlots = computed(() => slotsByDay.value.get(selectedDay.value) ?? [])
const showCampus = computed(() => !campusFilter.value && visibleCampusKeys.value.length > 1)
</script>

<template>
  <div class="page">
    <PageHeader lead="按日期看每個時段排了誰。點日期可以看當天完整名單，點家長進入案件處理。" />

    <div class="toolbar calendar__toolbar">
      <div class="calendar__nav">
        <el-button :icon="ArrowLeft" aria-label="上個月" @click="shiftMonth(-1)" />
        <strong class="calendar__month" aria-live="polite">{{ monthLabel }}</strong>
        <el-button :icon="ArrowRight" aria-label="下個月" @click="shiftMonth(1)" />
        <el-button text @click="goToday">今天</el-button>
      </div>
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" />
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div class="panel calendar" :aria-busy="loading" v-loading="loading">
      <div class="calendar__grid" role="grid" :aria-label="monthLabel">
        <div v-for="w in WEEKDAYS" :key="w" class="calendar__weekday" role="columnheader">{{ w }}</div>
        <button
          v-for="day in gridDays"
          :key="day"
          type="button"
          role="gridcell"
          class="calendar__day"
          :class="{
            'is-other': day.slice(0, 7) !== month,
            'is-today': day === today,
            'is-selected': day === selectedDay,
            'has-slots': slotsByDay.has(day),
          }"
          :aria-selected="day === selectedDay"
          :aria-label="`${formatDate(day)}，${chipsOf(day).length} 位家長`"
          @click="selectDay(day)"
        >
          <span class="calendar__date num">{{ Number(day.slice(8)) }}</span>
          <span v-for="chip in chipsOf(day).slice(0, MAX_CHIPS)" :key="chip.key" class="calendar__chip" :data-status="chip.status">
            <span class="num">{{ chip.time }}</span> {{ chip.name }}
          </span>
          <span v-if="chipsOf(day).length > MAX_CHIPS" class="calendar__more">還有 {{ chipsOf(day).length - MAX_CHIPS }} 位</span>
          <span v-if="slotsByDay.has(day) && openSeats(day) > 0" class="calendar__seats">可約 {{ openSeats(day) }} 位</span>
          <span v-if="chipsOf(day).length" class="calendar__dot" aria-hidden="true">{{ chipsOf(day).length }}</span>
        </button>
      </div>
    </div>

    <section class="section calendar__detail">
      <div class="section__title">
        <h2>{{ formatDate(selectedDay) }}（{{ formatWeekday(selectedDay) }}）</h2>
      </div>
      <p v-if="selectedSlots.length === 0" class="hint">
        這天沒有參觀時段。要開放時段請到 <router-link to="/slots">時段與容量</router-link>。
      </p>
      <div v-for="slot in selectedSlots" :key="slot.id" class="panel calendar__slot">
        <div class="panel__head">
          <h3 class="num">{{ formatTime(slot.start_time) }}–{{ formatTime(slot.end_time) }}<template v-if="showCampus">・{{ campusLabel(slot.campus_key) }}</template></h3>
          <span class="hint">{{ slot.closed ? '已關閉' : `已排 ${slot.booked_count}／${slot.capacity} 位` }}</span>
        </div>
        <ul v-if="slot.visits.length" class="calendar__visits">
          <li v-for="visit in slot.visits" :key="visit.id">
            <router-link :to="`/visit-requests/${visit.id}`" class="calendar__visit-name">{{ visit.parent_name }}</router-link>
            <span class="muted">{{ visit.child_name || '孩子姓名未填寫' }}</span>
            <a class="num" :href="`tel:${visit.phone}`">{{ visit.phone }}</a>
            <span class="muted">承辦：{{ staffLabel(visit.assigned_staff_id, staff) }}<template v-if="visit.source !== 'web'"> · {{ visitSourceLabel(visit.source) }}補登</template></span>
            <StatusTag :meta="visitStatus(visit.status)" size="small" />
          </li>
        </ul>
        <p v-else class="hint calendar__empty">還沒有人預約這個時段。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.calendar__toolbar { justify-content: space-between; align-items: center; }
.calendar__nav { display: flex; align-items: center; gap: 8px; }
.calendar__nav .el-button + .el-button { margin-left: 0; }
.calendar__month { min-width: 8em; text-align: center; font-size: 16px; }
.calendar { overflow: hidden; }
.calendar__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.calendar__weekday {
  padding: 8px;
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
  border-bottom: 1px solid var(--line);
}
.calendar__day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  min-height: 112px;
  padding: 6px;
  border: 0;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.calendar__day:nth-child(7n + 7) { border-right: 0; }
.calendar__day:hover { background: var(--surface-3); }
.calendar__day:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.calendar__day.is-other { background: var(--surface-2); color: var(--ink-3); }
.calendar__day.is-selected { box-shadow: inset 0 0 0 2px var(--el-color-primary); }
.calendar__date { font-size: 13px; font-weight: 600; }
.calendar__day.is-today .calendar__date {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: var(--el-color-white);
}
.calendar__chip {
  overflow: hidden;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--el-color-success-light-9);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.calendar__chip[data-status='pending_confirmation'] { background: var(--el-color-warning-light-9); }
.calendar__chip[data-status='completed'],
.calendar__chip[data-status='no_show'] { background: var(--surface-3); color: var(--ink-3); }
.calendar__more, .calendar__seats { font-size: 12px; color: var(--ink-3); }
.calendar__dot { display: none; }
.calendar__detail { margin-top: 24px; }
.calendar__slot { margin-bottom: 12px; }
.calendar__slot h3 { font-size: 15px; margin: 0; }
.calendar__visits { list-style: none; margin: 0; padding: 0; }
.calendar__visits li {
  display: grid;
  grid-template-columns: minmax(6em, 1fr) minmax(6em, 1fr) auto minmax(8em, 1.5fr) auto;
  gap: 4px 16px;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  font-size: 14px;
}
.calendar__visit-name { font-weight: 600; }
.calendar__visits li > .el-tag { justify-self: start; }
.calendar__empty { padding: 0 16px 12px; }

@media (max-width: 720px) {
  .calendar__day { min-height: 52px; align-items: center; padding: 4px 2px; }
  .calendar__chip, .calendar__more, .calendar__seats { display: none; }
  .calendar__day.has-slots .calendar__date { text-decoration: underline; text-underline-offset: 3px; }
  .calendar__dot {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px;
    background: var(--el-color-success);
    color: var(--el-color-white);
    font-size: 11px;
  }
  .calendar__visits li { grid-template-columns: minmax(0, 1fr) auto; }
}
</style>
