<script setup lang="ts">
import { computed } from 'vue'
import type { PotentialShareYear } from '../../../api/types'
import { useNarrowScreen } from '../../../composables/useNarrowScreen'
import { yearTitle } from './potentialFormat'

// 市佔率走勢（2026-10-20）：admin 沒有圖表套件，手寫 SVG。縱軸從 0 起、頂端取 0.5% 的倍數；橫軸依學年排，缺的學年留空；
// 那一年沒有市佔率（沒有九月底的孩子數）就不畫點，線在那裡斷開。橫軸只標第一、最高、最新三個學年，數字在每個點的提示與
// 「各學年數字」表裡；兩個標籤貼太近時最高讓位。
// 幾何分寬窄兩套：窄螢幕（≤720px）的 viewBox 縮成 340 寬，SVG 在 360–390px 的手機上縮放接近 1，軸線文字與圓點才讀得到
// （寬版 520 擠進 358px 會縮到 0.69，字級剩約 9px）。
const props = defineProps<{ years: readonly PotentialShareYear[] }>()

const WIDE = { width: 520, height: 160, left: 44, right: 28, top: 14, bottom: 30, radius: 3.5 }
const NARROW = { width: 340, height: 170, left: 42, right: 22, top: 14, bottom: 30, radius: 5 }
const MIN_LABEL_GAP = 28

const narrow = useNarrowScreen()
const geo = computed(() => (narrow.value ? NARROW : WIDE))

interface Point {
  year: number
  x: number
  y: number
  title: string
}

const shared = computed(() => props.years.filter((year) => year.share !== null))
// 縱軸頂端（百分比）：最高的市佔率往上取到 0.5% 的倍數，至少 0.5%。
const top = computed(() => Math.max(0.5, Math.ceil(Math.max(0, ...shared.value.map((year) => year.share! * 100)) * 2) / 2))
const firstYear = computed(() => props.years[0]?.school_year ?? 0)
const span = computed(() => (props.years.at(-1)?.school_year ?? 0) - firstYear.value)

const plotWidth = computed(() => geo.value.width - geo.value.left - geo.value.right)
const xOf = (year: number) =>
  geo.value.left + (span.value === 0 ? plotWidth.value / 2 : ((year - firstYear.value) / span.value) * plotWidth.value)
const yOf = (share: number) => geo.value.top + (geo.value.height - geo.value.top - geo.value.bottom) * (1 - (share * 100) / top.value)
const baseline = computed(() => geo.value.height - geo.value.bottom)

const toPoint = (year: PotentialShareYear): Point => ({ year: year.school_year, x: xOf(year.school_year), y: yOf(year.share!), title: yearTitle(year) })
const points = computed(() => shared.value.map(toPoint))

// 沒有市佔率的學年把線切開；只剩一個點的段不畫線（點本身還在）。
const segments = computed(() => {
  const result: Point[][] = []
  let current: Point[] = []
  for (const year of props.years) {
    if (year.share === null) {
      if (current.length) result.push(current)
      current = []
    } else {
      current.push(toPoint(year))
    }
  }
  if (current.length) result.push(current)
  return result.filter((segment) => segment.length > 1)
})
const lines = computed(() => segments.value.map((segment) => segment.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')))

// 最高：同分取較新（同後端 best）；最新：最後一個有市佔率的學年。
const labels = computed(() => {
  const list = shared.value
  if (!list.length) return []
  const best = list.reduce((top, year) => (year.share! >= top.share! ? year : top))
  const wanted = [props.years[0]!.school_year, list.at(-1)!.school_year, best.school_year]
  const kept: { year: number; x: number }[] = []
  for (const year of new Set(wanted)) {
    const x = xOf(year)
    if (kept.every((label) => Math.abs(label.x - x) >= MIN_LABEL_GAP)) kept.push({ year, x })
  }
  return kept.sort((a, b) => a.x - b.x)
})

const ariaLabel = computed(() => {
  const last = props.years.at(-1)?.school_year
  return firstYear.value === last ? `${last} 學年市佔率走勢` : `${firstYear.value} 至 ${last} 學年市佔率走勢`
})
</script>

<template>
  <svg v-if="points.length" class="share-trend" role="img" :aria-label="ariaLabel" :viewBox="`0 0 ${geo.width} ${geo.height}`" width="100%">
    <line class="share-trend__grid" :x1="geo.left" :x2="geo.width - geo.right" :y1="geo.top" :y2="geo.top" />
    <line class="share-trend__axis" :x1="geo.left" :x2="geo.width - geo.right" :y1="baseline" :y2="baseline" />
    <text class="share-trend__y" :x="geo.left - 6" :y="geo.top + 4" text-anchor="end">{{ top.toFixed(1) }}%</text>
    <text class="share-trend__y" :x="geo.left - 6" :y="baseline + 4" text-anchor="end">0%</text>
    <polyline v-for="line in lines" :key="line" class="share-trend__line" :points="line" />
    <circle v-for="point in points" :key="point.year" class="share-trend__dot" :cx="point.x" :cy="point.y" :r="geo.radius">
      <title>{{ point.title }}</title>
    </circle>
    <text class="share-trend__axis-title" x="2" :y="geo.height - 8">學年</text>
    <text v-for="label in labels" :key="label.year" class="share-trend__x" :x="label.x" :y="geo.height - 8" text-anchor="middle">{{ label.year }}</text>
  </svg>
</template>

<style scoped>
.share-trend {
  display: block;
  height: auto;
  max-width: 560px;
  overflow: visible;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.share-trend__grid {
  stroke: var(--line);
  stroke-width: 1;
}

.share-trend__axis {
  stroke: var(--line-strong);
  stroke-width: 1;
}

.share-trend__line {
  fill: none;
  stroke: var(--el-color-primary);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.share-trend__dot {
  fill: var(--surface);
  stroke: var(--el-color-primary);
  stroke-width: 2;
}

.share-trend__y,
.share-trend__x,
.share-trend__axis-title {
  fill: var(--ink-3);
}
</style>
