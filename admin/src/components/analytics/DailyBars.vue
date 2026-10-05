<script setup lang="ts">
import { computed, useId } from 'vue'

// 每日直條（DESIGN.md 招生入學統計：表格＋CSS 長條、不裝圖表套件，數字一定寫出來）。
// 直條只用來看起伏，每天的數字在下方「每日數字」。markers 是口徑改變的日子
// （例如 09/30 內頁開始計入），只畫期間內的。
export interface DailyPoint { day: string; value: number }
export interface DailyMarker { day: string; label: string }

const props = withDefaults(
  defineProps<{ title: string; points: readonly DailyPoint[]; unit: string; markers?: readonly DailyMarker[] }>(),
  { markers: () => [] },
)

const titleId = useId()
const short = (day: string) => day.slice(5).replace('-', '/')
const max = computed(() => Math.max(0, ...props.points.map((point) => point.value)))
const total = computed(() => props.points.reduce((sum, point) => sum + point.value, 0))
const first = computed(() => props.points[0]?.day ?? '')
const last = computed(() => props.points.at(-1)?.day ?? '')
const peak = computed(() =>
  props.points.reduce<DailyPoint | null>((best, point) => (!best || point.value > best.value ? point : best), null),
)
const visibleMarkers = computed(() => props.markers.filter((marker) => marker.day >= first.value && marker.day <= last.value))
const markedDays = computed(() => new Set(visibleMarkers.value.map((marker) => marker.day)))
// 點數多時不留縫：390px 手機圖表內寬約 324px，一年 365 天加 1px 縫會讓每根寬度歸零。
const DENSE_POINTS = 60
const dense = computed(() => props.points.length > DENSE_POINTS)
// 有數字的日子至少 1px 高，免得 1/300 四捨五入成 0% 看不見。
const height = (value: number) => (max.value ? `${Math.round((value / max.value) * 100)}%` : '0%')
const summary = computed(() =>
  peak.value
    ? `${props.title}：${short(first.value)}–${short(last.value)} 共 ${total.value} ${props.unit}，最多是 ${short(peak.value.day)} 的 ${peak.value.value} ${props.unit}`
    : `${props.title}：沒有資料`,
)
const newestFirst = computed(() => [...props.points].reverse())
</script>

<template>
  <figure class="daily-bars" :aria-labelledby="titleId">
    <figcaption :id="titleId" class="daily-bars__title">{{ title }}</figcaption>
    <p v-if="!points.length" class="hint">這段期間沒有資料。</p>
    <template v-else>
      <div
        class="daily-bars__plot"
        :class="{ 'is-dense': dense }"
        :style="{ '--n': points.length }"
        role="img"
        :aria-label="summary"
      >
        <span
          v-for="point in points"
          :key="point.day"
          class="daily-bars__col"
          :class="{ 'is-marked': markedDays.has(point.day) }"
          :title="`${short(point.day)}：${point.value} ${unit}`"
        >
          <span class="daily-bars__fill" :class="{ 'has-value': point.value > 0 }" :style="{ height: height(point.value) }" />
        </span>
      </div>
      <div class="daily-bars__axis hint num">
        <span>{{ short(first) }}</span><span>最多 {{ max }} {{ unit }}</span><span>{{ short(last) }}</span>
      </div>
      <p v-for="marker in visibleMarkers" :key="marker.day" class="hint daily-bars__marker">{{ short(marker.day) }} 起：{{ marker.label }}</p>
      <details class="daily-bars__table">
        <summary>每日數字</summary>
        <table>
          <thead><tr><th scope="col">日期</th><th scope="col">{{ unit }}</th></tr></thead>
          <tbody>
            <tr v-for="point in newestFirst" :key="point.day"><th scope="row" class="num">{{ short(point.day) }}</th><td class="num">{{ point.value }}</td></tr>
          </tbody>
        </table>
      </details>
    </template>
  </figure>
</template>

<style scoped>
.daily-bars {
  min-width: 0;
  margin: 0;
}

.daily-bars__title {
  margin-bottom: 8px;
  font-size: var(--text-base);
  font-weight: 500;
}

.daily-bars__plot {
  display: grid;
  grid-template-columns: repeat(var(--n), minmax(0, 1fr));
  align-items: end;
  gap: 1px;
  height: 96px;
  border-bottom: 1px solid var(--line);
}

.daily-bars__plot.is-dense {
  gap: 0;
}

.daily-bars__col {
  display: flex;
  align-items: flex-end;
  position: relative;
  min-width: 0;
  height: 100%;
}

/* 口徑改變的那天：左緣一條警示色細線，畫在直條上面才不會被填色蓋住。 */
.daily-bars__col.is-marked::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  width: 2px;
  background: var(--el-color-warning);
  pointer-events: none;
}

.daily-bars__fill {
  display: block;
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: var(--el-color-primary);
}

.daily-bars__fill.has-value {
  min-height: 1px;
}

.daily-bars__axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.daily-bars__marker {
  margin: 4px 0 0;
}

.daily-bars__table {
  margin-top: 8px;
  font-size: var(--text-sm);
}

.daily-bars__table table {
  width: 100%;
  max-width: 320px;
  border-collapse: collapse;
}

.daily-bars__table th,
.daily-bars__table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--line);
  font-weight: 400;
  text-align: left;
}

.daily-bars__table td {
  text-align: right;
}
</style>
