<script setup lang="ts">
import { computed } from 'vue'
import type { PotentialShareYear } from '../../../api/types'
import { yearTitle } from './potentialFormat'

// 市佔率走勢（2026-10-20）：admin 沒有圖表套件，手寫 SVG。縱軸從 0 起、頂端取 0.5% 的倍數；橫軸依學年排，缺的學年留空；
// 那一年沒有市佔率（沒有九月底的孩子數）就不畫點，線在那裡斷開。橫軸只標第一、最高、最新三個學年，數字在每個點的提示與
// 「各學年數字」表裡；兩個標籤貼太近時最高讓位。
const props = defineProps<{ years: readonly PotentialShareYear[] }>()

const WIDTH = 520
const HEIGHT = 160
const LEFT = 44
const RIGHT = 28
const TOP = 14
const BOTTOM = 30
const MIN_LABEL_GAP = 28

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

const xOf = (year: number) => LEFT + (span.value === 0 ? (WIDTH - LEFT - RIGHT) / 2 : ((year - firstYear.value) / span.value) * (WIDTH - LEFT - RIGHT))
const yOf = (share: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - (share * 100) / top.value)
const baseline = HEIGHT - BOTTOM

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
  <svg v-if="points.length" class="share-trend" role="img" :aria-label="ariaLabel" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" width="100%">
    <line class="share-trend__grid" :x1="LEFT" :x2="WIDTH - RIGHT" :y1="TOP" :y2="TOP" />
    <line class="share-trend__axis" :x1="LEFT" :x2="WIDTH - RIGHT" :y1="baseline" :y2="baseline" />
    <text class="share-trend__y" :x="LEFT - 6" :y="TOP + 4" text-anchor="end">{{ top.toFixed(1) }}%</text>
    <text class="share-trend__y" :x="LEFT - 6" :y="baseline + 4" text-anchor="end">0%</text>
    <polyline v-for="line in lines" :key="line" class="share-trend__line" :points="line" />
    <circle v-for="point in points" :key="point.year" class="share-trend__dot" :cx="point.x" :cy="point.y" r="3.5">
      <title>{{ point.title }}</title>
    </circle>
    <text class="share-trend__axis-title" x="2" :y="HEIGHT - 8">學年</text>
    <text v-for="label in labels" :key="label.year" class="share-trend__x" :x="label.x" :y="HEIGHT - 8" text-anchor="middle">{{ label.year }}</text>
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
