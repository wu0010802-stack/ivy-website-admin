<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { usePermissions } from '../composables/usePermissions'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import WeeklySessionsCard from '../components/sessions/WeeklySessionsCard.vue'
import DayPanel from '../components/sessions/DayPanel.vue'
import { dayAriaLabel, dayChips, type CalendarSlot } from '../utils/calendarChips'

// 參觀場次：設定每週固定場次（上方卡片），並在月曆上看每天排了誰、停止／恢復某一場、
// 設休假、加開。跟案件列表讀同一份資料（visit_slots＋visit_requests），按日期排開。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MAX_CHIPS = 3

const route = useRoute()
const router = useRouter()
const CALENDAR_PATH = route.path
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const { can } = usePermissions()
const canManage = computed(() => can('booking.manage'))
const auth = useAuthStore()
const canConfigureBooking = computed(() => canManage.value && ['super_admin', 'campus_admin'].includes(auth.user?.role ?? ''))
// 從其他頁帶 ?campus=renwu 進來就直接看那一校；切校時寫回網址（replace，不堆歷史），
// 重新整理或從案件返回都還是同一校。只管一校的帳號不必選。
const campusFromQuery = (value: unknown): string =>
  typeof value === 'string' && visibleCampusKeys.value.includes(value) ? value : ''
// 一次看一個校區；沒指定時預設第一個可見校區。
const campusFilter = ref(campusFromQuery(route.query.campus) || visibleCampusKeys.value[0] || '')
const sessionsCard = ref<InstanceType<typeof WeeklySessionsCard> | null>(null)

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

type Holidays = Map<string, { id: string; reason: string | null }>
const holidays = ref<Holidays>(new Map())
// 只讀不寫：由 load 確認還是最後一次請求才寫入，換校時先選的那一校較晚回來不會蓋掉。
// 「全部校區」沒有單一校的休假，回空的。
async function loadHolidays(campus: string): Promise<Holidays> {
  if (!campus) return new Map()
  try {
    const schedule = await api.get<{ exceptions: { id: string; exception_date: string; reason: string | null }[] }>(`/admin/visit-schedule/${campus}`)
    return new Map(schedule.exceptions.map(e => [e.exception_date, { id: e.id, reason: e.reason }]))
  } catch {
    return new Map()
  }
}

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const days = gridDays.value
    const params = new URLSearchParams({ date_from: days[0]!, date_to: days[days.length - 1]! })
    if (campusFilter.value) params.set('campus_key', campusFilter.value)
    const [result, loadedHolidays] = await Promise.all([api.get<CalendarSlot[]>(`/admin/visit-calendar?${params}`), loadHolidays(campusFilter.value)])
    if (requests.isCurrent(request)) {
      slots.value = result
      holidays.value = loadedHolidays
    }
  } catch (err) {
    if (requests.isCurrent(request)) {
      slots.value = []
      holidays.value = new Map()
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
  if (campus && campus !== campusFilter.value) campusFilter.value = campus
})
// 有沒存的場次修改時切換校區前先問（離開頁面的詢問由卡片自己的離頁保護處理）。
async function switchCampus(campus: string) {
  if ((await sessionsCard.value?.confirmLeave()) === false) return
  campusFilter.value = campus
}
onMounted(() => {
  load()
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
const dayPanel = ref<{ $el: HTMLElement } | null>(null)
async function selectDay(day: string, event?: MouseEvent) {
  selectedDay.value = day
  if (day.slice(0, 7) !== month.value) month.value = day.slice(0, 7)
  await nextTick()
  const heading = dayPanel.value?.$el?.querySelector('h2') as HTMLElement | null | undefined
  if (!heading || event?.detail === 0) return
  const { top } = heading.getBoundingClientRect()
  if (top < 0 || top > window.innerHeight * 0.6) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    heading.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }
}

const selectedSlots = computed(() => slotsByDay.value.get(selectedDay.value) ?? [])
</script>

<template>
  <div class="page">
    <PageHeader lead="月曆上點一天，看誰要來、調整那天的場次。" more="上方設定每週固定的參觀場次；點月曆上的某一天，可以停止或恢復某一場、設休假、加開，也看得到那天有誰要來。" />

    <div class="toolbar calendar__toolbar">
      <div class="calendar__nav">
        <el-button :icon="ArrowLeft" aria-label="上個月" @click="shiftMonth(-1)" />
        <strong class="calendar__month" aria-live="polite">{{ monthLabel }}</strong>
        <el-button :icon="ArrowRight" aria-label="下個月" @click="shiftMonth(1)" />
        <el-button text @click="goToday">今天</el-button>
      </div>
      <CampusSelect :model-value="campusFilter" :keys="visibleCampusKeys" @update:model-value="switchCampus" />
    </div>

    <WeeklySessionsCard v-if="campusFilter" ref="sessionsCard" :campus-key="campusFilter" :can-manage="canManage" :can-configure-booking="canConfigureBooking" @saved="load" />

    <!-- 格子的顏色與手機的數字點各代表什麼；色塊與格內共用同一組樣式。 -->
    <ul class="calendar__legend" aria-label="圖例">
      <li><span class="calendar__swatch" data-kind="visit" aria-hidden="true" />有預約</li>
      <li><span class="calendar__swatch" data-kind="stopped" aria-hidden="true" />停止申請</li>
      <li><span class="calendar__swatch" data-kind="open" aria-hidden="true" />還可預約</li>
      <li><span class="calendar__swatch is-holiday" aria-hidden="true" />休假</li>
      <li class="calendar__legend-mobile"><span class="calendar__dot" aria-hidden="true">3</span>排入的組數</li>
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
              'is-holiday': holidays.has(day),
              'has-seats': dayChips(slotsByDay.get(day) ?? []).some(chip => chip.kind === 'open'),
            }"
            :aria-selected="day === selectedDay"
            :aria-label="dayAriaLabel(day, slotsByDay.get(day) ?? [], holidays.get(day)?.reason ?? (holidays.has(day) ? '' : null))"
            @click="selectDay(day, $event)"
          >
            <span class="calendar__date num">{{ Number(day.slice(8)) }}</span>
            <span v-if="holidays.has(day)" class="calendar__holiday">休假</span>
            <span v-for="chip in dayChips(slotsByDay.get(day) ?? []).slice(0, MAX_CHIPS)" :key="chip.key" class="calendar__chip" :data-kind="chip.kind" :data-status="chip.status" :class="{ 'is-ended': chip.ended }">{{ chip.text }}</span>
            <span v-if="dayChips(slotsByDay.get(day) ?? []).length > MAX_CHIPS" class="calendar__more">＋{{ dayChips(slotsByDay.get(day) ?? []).length - MAX_CHIPS }}</span>
            <span v-if="dayChips(slotsByDay.get(day) ?? []).some(chip => chip.kind === 'visit')" class="calendar__dot" aria-hidden="true">{{ dayChips(slotsByDay.get(day) ?? []).filter(chip => chip.kind === 'visit').length }}</span>
          </button>
        </div>
      </div>
    </div>

    <DayPanel v-if="campusFilter" ref="dayPanel" class="calendar__detail" :day="selectedDay" :campus-key="campusFilter" :slots="selectedSlots" :holiday="holidays.get(selectedDay) ?? null" :can-manage="canManage" @changed="load" />
  </div>
</template>

<style scoped>
.calendar__toolbar { justify-content: space-between; align-items: center; }
.calendar__legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: -4px 0 12px; padding: 0; list-style: none; color: var(--ink-2); font-size: var(--text-sm); }
.calendar__legend li { display: inline-flex; align-items: center; gap: 6px; }
/* 桌機看格內色塊，手機只剩數字點：兩邊各列自己看得到的那幾種。 */
.calendar__legend li.calendar__legend-mobile { display: none; }
.calendar__swatch { flex-shrink: 0; width: 20px; height: 14px; border-radius: 3px; }
.calendar__legend-date { font-size: var(--text-sm); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.calendar__nav { display: flex; align-items: center; gap: 8px; }
.calendar__nav .el-button + .el-button { margin-left: 0; }
.calendar__month { min-width: 8em; text-align: center; font-size: var(--text-lg); }
.calendar { overflow: hidden; }
.calendar__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.calendar__row { display: contents; }
.calendar__weekday {
  padding: 8px;
  font-size: var(--text-xs);
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
.calendar__date { font-size: var(--text-sm); font-weight: 600; }
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
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--ink);
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 色塊：有預約是淡綠底＋綠色細框（2026-10-05 起不再用左側粗色條）；停止申請用紅底；
   還可預約只有灰框。四種都用同樣 1px 框，大小一致。圖例共用。 */
.calendar__chip, .calendar__swatch { border: 1px solid var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.calendar__chip[data-kind='stopped'], .calendar__swatch[data-kind='stopped'] { border-color: var(--el-color-danger); background: var(--el-color-danger); color: var(--surface); }
.calendar__chip[data-kind='open'], .calendar__swatch[data-kind='open'] { border-color: var(--line); background: transparent; color: var(--ink-3); }
.calendar__chip[data-status='completed'], .calendar__chip[data-status='no_show'] { border-color: var(--line-strong); background: var(--surface-3); color: var(--ink-3); }
/* 已結束的色塊不調淡：12px 小字一淡化就不到 4.5:1（DESIGN.md 規則）；已到場、未到場本來就是灰底。 */
.calendar__swatch.is-holiday { background: var(--surface-3); border: 1px solid var(--line-strong); }
.calendar__day.is-holiday { background: var(--surface-3); }
.calendar__holiday { font-size: var(--text-xs); color: var(--ink-3); }
.calendar__more { font-size: var(--text-xs); color: var(--ink-3); }
.calendar__dot { display: none; }
.calendar__detail { margin-top: 24px; }
@media (max-width: 720px) {
  .calendar__legend li { display: none; }
  .calendar__legend li.calendar__legend-mobile { display: inline-flex; }
  .calendar__day { min-height: 52px; align-items: center; padding: 4px 2px; }
  .calendar__chip, .calendar__more, .calendar__holiday { display: none; }
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
    font-size: var(--text-xs);
  }
}
</style>
