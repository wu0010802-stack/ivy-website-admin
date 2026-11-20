<script setup lang="ts">
import { computed } from 'vue'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { formatRate } from '../../admissions/statsFormat'

// 月度走勢（2026-11-20）：園務總覽本來有「月度量體」「轉換率走勢」兩張圖，官網當初用月度明細表的長條代替，
// 十幾個月的預繳率要逐列比才看得出走勢。補回來，畫成上下兩格共用月份軸（不畫雙軸：兩種單位疊在同一格，
// 高低會被軸的比例誤導）。admin 沒有圖表套件，手寫 SVG（同 ShareTrendChart）；數字都寫在圖上，完整的表在下面。
// 那個月沒有參觀（預繳率 null）就不畫點，線在那裡斷開。手機只畫最近 6 個月，字才讀得到。
const props = defineProps<{
  rows: readonly { month: string; visit: number; visit_to_deposit_rate: number | null }[]
}>()

const NARROW_MONTHS = 6
const narrow = useNarrowScreen()
const shown = computed(() => (narrow.value ? props.rows.slice(-NARROW_MONTHS) : props.rows))
const trimmed = computed(() => shown.value.length < props.rows.length)

const geo = computed(() =>
  narrow.value
    ? { width: 340, left: 8, right: 8, rateTop: 30, rateBottom: 84, barTop: 124, barBottom: 180, height: 216, bar: 26 }
    : { width: 880, left: 12, right: 12, rateTop: 30, rateBottom: 92, barTop: 136, barBottom: 204, height: 240, bar: 30 },
)

const maxVisit = computed(() => Math.max(1, ...shown.value.map((row) => row.visit)))
const points = computed(() => {
  const { width, left, right, rateTop, rateBottom, barTop, barBottom } = geo.value
  const step = (width - left - right) / Math.max(1, shown.value.length)
  return shown.value.map((row, index) => {
    const [year = '', month = ''] = row.month.split('.')
    const previousYear = index > 0 ? shown.value[index - 1]!.month.split('.')[0] : null
    return {
      key: row.month,
      x: left + step * (index + 0.5),
      rate: row.visit_to_deposit_rate,
      rateY: row.visit_to_deposit_rate === null ? null : rateBottom - (row.visit_to_deposit_rate / 100) * (rateBottom - rateTop),
      visit: row.visit,
      barHeight: (row.visit / maxVisit.value) * (barBottom - barTop),
      monthLabel: `${Number(month)}月`,
      yearLabel: year !== previousYear ? `${year} 年` : '',
    }
  })
})

// 沒有預繳率的月份把線切開；只剩一個點的段不畫線（點本身還在）。
const lines = computed(() => {
  const segments: string[][] = []
  let current: string[] = []
  for (const point of points.value) {
    if (point.rateY === null) {
      if (current.length > 1) segments.push(current)
      current = []
    } else {
      current.push(`${point.x.toFixed(1)},${point.rateY.toFixed(1)}`)
    }
  }
  if (current.length > 1) segments.push(current)
  return segments.map((segment) => segment.join(' '))
})

const summary = computed(() => {
  const first = shown.value[0]
  const last = shown.value.at(-1)
  if (!first || !last) return '月度走勢'
  return `${first.month} 到 ${last.month} 各月的參觀→預繳率與參觀人數；最新一個月參觀 ${last.visit} 人、預繳率 ${formatRate(last.visit_to_deposit_rate)}。`
})
</script>

<template>
  <figure class="trend">
    <svg class="trend__svg" :viewBox="`0 0 ${geo.width} ${geo.height}`" role="img" :aria-label="summary">
      <text class="trend__title" :x="geo.left" y="12">參觀→預繳率</text>
      <line class="trend__grid" :x1="geo.left" :x2="geo.width - geo.right" :y1="(geo.rateTop + geo.rateBottom) / 2" :y2="(geo.rateTop + geo.rateBottom) / 2" />
      <text class="trend__axis" :x="geo.width - geo.right" :y="(geo.rateTop + geo.rateBottom) / 2 - 4" text-anchor="end">50%</text>
      <line class="trend__base" :x1="geo.left" :x2="geo.width - geo.right" :y1="geo.rateBottom" :y2="geo.rateBottom" />
      <polyline v-for="line in lines" :key="line" class="trend__line" :points="line" />
      <template v-for="point in points" :key="`rate-${point.key}`">
        <template v-if="point.rateY !== null">
          <circle class="trend__dot" :cx="point.x" :cy="point.rateY" r="3.5" />
          <text class="trend__value" :x="point.x" :y="point.rateY - 9" text-anchor="middle">{{ Math.round(point.rate!) }}%</text>
        </template>
      </template>

      <text class="trend__title" :x="geo.left" :y="geo.barTop - 18">參觀人數</text>
      <line class="trend__base" :x1="geo.left" :x2="geo.width - geo.right" :y1="geo.barBottom" :y2="geo.barBottom" />
      <template v-for="point in points" :key="`bar-${point.key}`">
        <rect class="trend__bar" :x="point.x - geo.bar / 2" :y="geo.barBottom - point.barHeight" :width="geo.bar" :height="point.barHeight" rx="3" />
        <text class="trend__count" :x="point.x" :y="geo.barBottom - point.barHeight - 5" text-anchor="middle">{{ point.visit }}</text>
        <text class="trend__axis" :x="point.x" :y="geo.barBottom + 15" text-anchor="middle">{{ point.monthLabel }}</text>
        <text v-if="point.yearLabel" class="trend__axis" :x="point.x" :y="geo.barBottom + 30" text-anchor="middle">{{ point.yearLabel }}</text>
      </template>
    </svg>
    <figcaption class="hint trend__note">
      最近一兩個月參觀的家長還沒到會預繳的時候，預繳率之後還會上來。<template v-if="trimmed">這裡只畫最近 {{ NARROW_MONTHS }} 個月，完整數字在下面的表。</template>
    </figcaption>
  </figure>
</template>

<style scoped>
.trend {
  margin: 0;
}

.trend__svg {
  display: block;
  width: 100%;
  max-width: 880px;
  height: auto;
}

.trend__title,
.trend__axis {
  fill: var(--ink-3);
  font-size: var(--text-xs);
}

.trend__value {
  fill: var(--ink);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.trend__count {
  fill: var(--ink-2);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.trend__grid {
  stroke: var(--line);
  stroke-dasharray: 3 4;
}

.trend__base {
  stroke: var(--line-strong);
}

.trend__line {
  fill: none;
  stroke: var(--admin-accent-hover);
  stroke-width: 2;
  stroke-linejoin: round;
}

.trend__dot {
  fill: var(--surface);
  stroke: var(--admin-accent-hover);
  stroke-width: 2;
}

.trend__bar {
  fill: var(--el-color-primary-light-7);
}

.trend__note {
  margin: 6px 0 0;
}
</style>
