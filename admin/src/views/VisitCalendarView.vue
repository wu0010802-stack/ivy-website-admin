<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
  /** 參觀人數；舊案件與沒問到的補登為 null */
  party_size?: number | null
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

const route = useRoute()
const router = useRouter()
const CALENDAR_PATH = route.path
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const { staff, load: loadStaff } = useVisitStaff()
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)
// 從其他頁帶 ?campus=renwu 進來就直接看那一校；切校時寫回網址（replace，不堆歷史），
// 重新整理或從案件返回都還是同一校。只管一校的帳號不必選。
const campusFromQuery = (value: unknown): string =>
  typeof value === 'string' && multiCampus.value && visibleCampusKeys.value.includes(value) ? value : ''
const campusFilter = ref(campusFromQuery(route.query.campus))

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
// role=grid 的格子要包在 role=row 裡（axe aria-required-children／parent）；列用
// display: contents，版面仍是同一個 7 欄 grid。
const gridWeeks = computed(() => Array.from({ length: 6 }, (_, i) => gridDays.value.slice(i * 7, i * 7 + 7)))

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
watch(campusFilter, campus => {
  if ((route.query.campus ?? '') === campus) return
  const query = { ...route.query }
  if (campus) query.campus = campus
  else delete query.campus
  void router.replace({ query })
})
watch(() => route.query.campus, value => {
  if (route.path !== CALENDAR_PATH) return
  const campus = campusFromQuery(value)
  if (campus !== campusFilter.value) campusFilter.value = campus
})
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

interface Chip { key: string; time: string; campus: string; name: string; status: string }

function chipsOf(day: string): Chip[] {
  return (slotsByDay.value.get(day) ?? []).flatMap((slot) =>
    slot.visits.map((v) => ({ key: v.id, time: formatTime(slot.start_time), campus: slot.campus_key, name: v.parent_name, status: v.status })),
  )
}

// 已經結束的場次不能再約，跟「時段與容量」頁的「仍有名額」同一個算法。
function slotEnded(slot: CalendarSlot): boolean {
  return new Date(`${slot.slot_date}T${slot.end_time}+08:00`).getTime() <= Date.now()
}

// 還能約幾組（名額以一組家庭計，不是人數）。
function openSeats(day: string): number {
  return (slotsByDay.value.get(day) ?? [])
    .filter((s) => !s.closed && !slotEnded(s))
    .reduce((sum, s) => sum + Math.max(s.capacity - s.booked_count, 0), 0)
}

// 待園方確認有期限（逾期會釋出名額），手機只剩數字點時也要看得出哪天有。
function pendingCount(day: string): number {
  return chipsOf(day).filter((chip) => chip.status === 'pending_confirmation').length
}

// 朗讀文字取代格子內容，格內的「可約 N 組」也要講到。
function dayLabel(day: string): string {
  const total = chipsOf(day).length
  const pending = pendingCount(day)
  const seats = openSeats(day)
  const booked = total ? `排入 ${total} 組${pending ? `，其中 ${pending} 組待園方確認` : ''}` : '沒有排入的家長'
  return `${formatDate(day)}，${booked}${seats ? `，可約 ${seats} 組` : ''}`
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

// 當天名單在月曆下方，桌機 1440×900 也在首屏以下：點了日期若名單不在畫面裡，
// 捲到名單標題，不然看起來像沒反應。名單標題在畫面上半多一點（手機上只露出標題與
// 第一個時段）也算看不到；已經看得到就不動，方便連續比較不同日期。
// 用鍵盤選日期（click 的 detail 為 0）不捲：焦點還在日期格上，捲走就看不到自己在哪。
const detailHeading = ref<HTMLElement | null>(null)
async function selectDay(day: string, event?: MouseEvent) {
  selectedDay.value = day
  if (day.slice(0, 7) !== month.value) month.value = day.slice(0, 7)
  await nextTick()
  const heading = detailHeading.value
  if (!heading || event?.detail === 0) return
  const { top } = heading.getBoundingClientRect()
  if (top < 0 || top > window.innerHeight * 0.6) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    heading.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }
}

const selectedSlots = computed(() => slotsByDay.value.get(selectedDay.value) ?? [])
const showCampus = computed(() => !campusFilter.value && multiCampus.value)
// 正在看某一校時，連到時段頁也帶著那一校。
const slotsLink = computed(() => (campusFilter.value ? { path: '/slots', query: { campus: campusFilter.value } } : '/slots'))
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
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" :all-label="multiCampus ? '全部校區' : undefined" />
    </div>

    <!-- 格子的顏色與手機的數字點各代表什麼；色塊與格內共用同一組樣式。 -->
    <ul class="calendar__legend" aria-label="圖例">
      <li><span class="calendar__swatch" data-status="pending_confirmation" aria-hidden="true" />待園方確認</li>
      <li><span class="calendar__swatch" data-status="confirmed" aria-hidden="true" />已確認</li>
      <li><span class="calendar__swatch" data-status="completed" aria-hidden="true" />已完成或未到場</li>
      <li class="calendar__legend-mobile"><span class="calendar__dot" aria-hidden="true">3</span>排入的組數</li>
      <li class="calendar__legend-mobile"><span class="calendar__dot is-pending" aria-hidden="true">3</span>其中有待園方確認</li>
      <li class="calendar__legend-mobile"><span class="calendar__legend-date num" aria-hidden="true">15</span>還有名額可約</li>
    </ul>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div class="panel calendar" :aria-busy="loading" v-loading="loading">
      <div class="calendar__grid" role="grid" :aria-label="monthLabel">
        <div class="calendar__row" role="row">
          <div v-for="w in WEEKDAYS" :key="w" class="calendar__weekday" role="columnheader">{{ w }}</div>
        </div>
        <div v-for="(week, index) in gridWeeks" :key="index" class="calendar__row" role="row">
          <button
            v-for="day in week"
            :key="day"
            type="button"
            role="gridcell"
            class="calendar__day"
            :class="{
              'is-other': day.slice(0, 7) !== month,
              'is-today': day === today,
              'is-selected': day === selectedDay,
              'has-seats': openSeats(day) > 0,
            }"
            :aria-selected="day === selectedDay"
            :aria-label="dayLabel(day)"
            @click="selectDay(day, $event)"
          >
            <span class="calendar__date num">{{ Number(day.slice(8)) }}</span>
            <span v-for="chip in chipsOf(day).slice(0, MAX_CHIPS)" :key="chip.key" class="calendar__chip" :data-status="chip.status">
              <span class="num">{{ chip.time }}</span> <span v-if="showCampus" class="calendar__chip-campus">{{ campusLabel(chip.campus) }}</span> {{ chip.name }}
            </span>
            <span v-if="chipsOf(day).length > MAX_CHIPS" class="calendar__more">還有 {{ chipsOf(day).length - MAX_CHIPS }} 組</span>
            <span v-if="openSeats(day) > 0" class="calendar__seats">可約 {{ openSeats(day) }} 組</span>
            <span v-if="chipsOf(day).length" class="calendar__dot" :class="{ 'is-pending': pendingCount(day) > 0 }" aria-hidden="true">{{ chipsOf(day).length }}</span>
          </button>
        </div>
      </div>
    </div>

    <section class="section calendar__detail">
      <div class="section__title">
        <h2 ref="detailHeading">{{ formatDate(selectedDay) }}（{{ formatWeekday(selectedDay) }}）</h2>
      </div>
      <p v-if="selectedSlots.length === 0" class="hint">
        這天沒有參觀時段。要開放時段請到 <router-link :to="slotsLink">時段與容量</router-link>。
      </p>
      <div v-for="slot in selectedSlots" :key="slot.id" class="panel calendar__slot">
        <div class="panel__head">
          <h3 class="num">{{ formatTime(slot.start_time) }}–{{ formatTime(slot.end_time) }}<template v-if="showCampus">・{{ campusLabel(slot.campus_key) }}</template></h3>
          <span class="hint">{{ slot.closed ? '已關閉' : `已排 ${slot.booked_count}／${slot.capacity} 組` }}</span>
        </div>
        <ul v-if="slot.visits.length" class="calendar__visits">
          <li v-for="visit in slot.visits" :key="visit.id">
            <router-link :to="`/visit-requests/${visit.id}`" class="calendar__visit-name">{{ visit.parent_name }}</router-link>
            <span class="muted calendar__visit-child">{{ visit.child_name || '孩子姓名未填寫' }}<template v-if="visit.party_size"> · {{ visit.party_size }} 人參觀</template></span>
            <a class="num calendar__visit-phone" :href="`tel:${visit.phone}`">{{ visit.phone }}</a>
            <span class="muted calendar__visit-staff">承辦：{{ staffLabel(visit.assigned_staff_id, staff) }}<template v-if="visit.source !== 'web'"> · {{ visitSourceLabel(visit.source) }}補登</template></span>
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
.calendar__legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: -4px 0 12px; padding: 0; list-style: none; color: var(--ink-2); font-size: 13px; }
.calendar__legend li { display: inline-flex; align-items: center; gap: 6px; }
/* 桌機看格內色塊，手機只剩數字點：兩邊各列自己看得到的那幾種。 */
.calendar__legend li.calendar__legend-mobile { display: none; }
.calendar__swatch { flex-shrink: 0; width: 20px; height: 14px; border-radius: 3px; }
.calendar__legend-date { font-size: 13px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.calendar__nav { display: flex; align-items: center; gap: 8px; }
.calendar__nav .el-button + .el-button { margin-left: 0; }
.calendar__month { min-width: 8em; text-align: center; font-size: 16px; }
.calendar { overflow: hidden; }
.calendar__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.calendar__row { display: contents; }
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
  padding: 2px 6px 2px 8px;
  border-radius: 4px;
  color: var(--ink);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 狀態色：淡底之外左側加一道實色，淡綠與淡黃並排時也分得出來。圖例共用。 */
.calendar__chip, .calendar__swatch { background: var(--el-color-success-light-9); box-shadow: inset 3px 0 0 var(--el-color-success); }
.calendar__chip[data-status='pending_confirmation'],
.calendar__swatch[data-status='pending_confirmation'] { background: var(--el-color-warning-light-9); box-shadow: inset 3px 0 0 var(--el-color-warning); }
.calendar__chip[data-status='completed'],
.calendar__chip[data-status='no_show'],
.calendar__swatch[data-status='completed'] { background: var(--surface-3); box-shadow: inset 3px 0 0 var(--line-strong); }
.calendar__chip[data-status='completed'],
.calendar__chip[data-status='no_show'] { color: var(--ink-3); }
/* 全部校區時，家長前面標校名（淡一階，不搶家長稱呼）。 */
.calendar__chip-campus { color: var(--ink-2); }
.calendar__more, .calendar__seats { font-size: 12px; color: var(--ink-3); }
.calendar__dot { display: none; }
.calendar__detail { margin-top: 24px; }
/* 點日期後捲到這裡，標題不要被黏在上方的頁首蓋住。 */
.calendar__detail h2 { scroll-margin-top: calc(var(--top-h) + 16px); }
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
  .calendar__legend li { display: none; }
  .calendar__legend li.calendar__legend-mobile { display: inline-flex; }
  .calendar__day { min-height: 52px; align-items: center; padding: 4px 2px; }
  .calendar__chip, .calendar__more, .calendar__seats { display: none; }
  /* 底線＝桌機格內的「可約 N 組」：已關閉（含休假日）或已結束的時段不算。 */
  .calendar__day.has-seats .calendar__date { text-decoration: underline; text-underline-offset: 3px; }
  .calendar__dot {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 10px;
    background: var(--el-color-success);
    color: var(--el-color-white);
    font-size: 12px;
  }
  /* 有待園方確認的日子改暖黃（與側欄待處理數字同色），一眼看出哪天要先處理。 */
  .calendar__dot.is-pending { background: var(--brand-gold); color: var(--ink); font-weight: 600; }
  /* 每筆：家長＋狀態、可撥號的電話、灰字的孩子與承辦。 */
  .calendar__visits li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name status' 'phone phone' 'child child' 'staff staff'; gap: 0 12px; }
  /* 點家長進案件是這裡最主要的動作，觸控範圍跟電話一樣 44px。 */
  .calendar__visit-name { grid-area: name; display: inline-flex; align-items: center; min-height: 44px; justify-self: start; }
  .calendar__visits li > .el-tag { grid-area: status; justify-self: end; }
  .calendar__visit-phone { grid-area: phone; display: inline-flex; align-items: center; min-height: 44px; justify-self: start; }
  .calendar__visit-child { grid-area: child; }
  .calendar__visit-staff { grid-area: staff; }
}
</style>
