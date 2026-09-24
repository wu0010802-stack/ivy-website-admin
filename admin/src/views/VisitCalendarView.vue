<script setup lang="ts">
// 接待日曆（規格 6.2）：已排時段的參觀依日期排開。與案件清單讀同一份
// 資料（/admin/visit-calendar 查的是 visit_requests），不另存日曆。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { campusLabel, formatTime, visitStatus } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import StatusTag from '../components/StatusTag.vue'

const router = useRouter()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const campusFilter = ref('')

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const month = ref(startOfMonth(new Date()))
const visits = ref<VisitRequestDetailOut[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadVersion = 0

// 月曆從週日開始，前後補齊整週。
const days = computed(() => {
  const first = month.value
  const gridStart = new Date(first)
  gridStart.setDate(1 - first.getDay())
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const gridEnd = new Date(last)
  gridEnd.setDate(last.getDate() + (6 - last.getDay()))
  const out: { date: Date; iso: string; inMonth: boolean }[] = []
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    out.push({ date: new Date(d), iso: isoDate(d), inMonth: d.getMonth() === first.getMonth() })
  }
  return out
})

const byDate = computed(() => {
  const map = new Map<string, VisitRequestDetailOut[]>()
  for (const v of visits.value) {
    if (!v.slot) continue
    const list = map.get(v.slot.slot_date) ?? []
    list.push(v)
    map.set(v.slot.slot_date, list)
  }
  return map
})

const todayIso = isoDate(new Date())
const monthLabel = computed(() => `${month.value.getFullYear()} 年 ${month.value.getMonth() + 1} 月`)
const upcoming = computed(() => visits.value.filter((v) => v.slot && v.slot.slot_date >= todayIso))

async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = null
  const grid = days.value
  const params = new URLSearchParams({ date_from: grid[0]!.iso, date_to: grid[grid.length - 1]!.iso })
  if (campusFilter.value) params.set('campus_key', campusFilter.value)
  try {
    const result = await api.get<VisitRequestDetailOut[]>(`/admin/visit-calendar?${params}`)
    if (version === loadVersion) visits.value = result
  } catch {
    if (version === loadVersion) {
      error.value = '無法讀取接待日曆，請重新載入。'
      visits.value = []
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

function shift(delta: number) {
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() + delta, 1)
}

watch([month, campusFilter], load)
onMounted(load)

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
</script>

<template>
  <div class="page">
    <PageHeader lead="已排入時段的參觀，依日期排開。待園方確認的也會列出，點一下進案件處理。" />

    <div class="toolbar cal-toolbar">
      <div class="cal-nav">
        <el-button :icon="ArrowLeft" aria-label="上個月" @click="shift(-1)" />
        <strong class="cal-month">{{ monthLabel }}</strong>
        <el-button :icon="ArrowRight" aria-label="下個月" @click="shift(1)" />
        <el-button text @click="month = startOfMonth(new Date())">回到本月</el-button>
      </div>
      <CampusSelect v-model="campusFilter" :keys="visibleCampusKeys" all-label="全部校區" />
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" style="margin-bottom: 16px">
      <el-button size="small" @click="load">重新載入</el-button>
    </el-alert>

    <div class="panel cal" v-loading="loading">
      <div class="cal__grid" role="grid" :aria-label="monthLabel">
        <div v-for="w in WEEKDAYS" :key="w" class="cal__weekday" role="columnheader">{{ w }}</div>
        <div
          v-for="day in days"
          :key="day.iso"
          class="cal__day"
          :class="{ 'is-out': !day.inMonth, 'is-today': day.iso === todayIso }"
          role="gridcell"
        >
          <span class="cal__date num">{{ day.date.getDate() }}</span>
          <button
            v-for="v in byDate.get(day.iso) ?? []"
            :key="v.id"
            type="button"
            class="cal__visit"
            :class="`is-${v.status}`"
            @click="router.push(`/visit-requests/${v.id}`)"
          >
            <span class="num">{{ formatTime(v.slot!.start_time) }}</span>
            {{ v.parent_name }}<template v-if="!campusFilter">・{{ campusLabel(v.campus_key) }}</template>
          </button>
        </div>
      </div>
    </div>

    <section class="section cal-list">
      <div class="section__title"><h2>接下來的參觀</h2></div>
      <p v-if="!loading && upcoming.length === 0" class="hint">這個月之後沒有已排定的參觀。</p>
      <ul v-else class="cal-list__items">
        <li v-for="v in upcoming" :key="v.id">
          <router-link :to="`/visit-requests/${v.id}`">
            <span class="num">{{ v.slot!.slot_date }} {{ formatTime(v.slot!.start_time) }}</span>
            {{ v.parent_name }}・{{ campusLabel(v.campus_key) }}
          </router-link>
          <StatusTag :meta="visitStatus(v.status)" size="small" />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.cal-toolbar { justify-content: space-between; align-items: center; }
.cal-nav { display: flex; align-items: center; gap: 8px; }
.cal-month { min-width: 8em; text-align: center; font-size: 16px; }
.cal { overflow: hidden; }
.cal__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cal__weekday { padding: 8px; font-size: 12px; color: var(--ink-3); text-align: center; border-bottom: 1px solid var(--line); }
.cal__day { min-height: 96px; padding: 6px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; }
.cal__day:nth-child(7n + 7) { border-right: 0; }
.cal__day.is-out { background: var(--surface-2); color: var(--ink-3); }
.cal__day.is-today .cal__date { color: var(--el-color-primary); font-weight: 700; }
.cal__date { font-size: 12px; }
.cal__visit { all: unset; cursor: pointer; display: block; padding: 2px 6px; border-radius: 4px; font-size: 12px; line-height: 1.5; background: var(--el-color-primary-light-9); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal__visit:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
.cal__visit.is-pending_confirmation { background: var(--el-color-warning-light-9); }
.cal__visit.is-completed, .cal__visit.is-no_show { background: var(--surface-2); color: var(--ink-2); }
.cal-list__items { list-style: none; margin: 0; padding: 0; }
.cal-list__items li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
@media (max-width: 720px) {
  .cal { display: none; }
}
</style>
