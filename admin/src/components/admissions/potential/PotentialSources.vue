<script setup lang="ts">
import { computed } from 'vue'
import type { PotentialSource } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import AnalyticsExplainer from '../../analytics/AnalyticsExplainer.vue'
import { formatCount } from '../area/areaFormat'
import {
  bandLabel, deliveryText, detailSeats, distanceKm, noDataText, periodText, rangeBar, rangeScale, seats, sourceName,
} from './potentialFormat'

// 每年還能多招的三個來源（2026-10-20 第二、三波，版面 A）：來源、低／中／高、區間條；每列可展開「怎麼算」：
// 參數照 API 的 assumptions 列，下面接各來源自己的小表（停辦：各窗口與事件、現有的里：距離帶、新建案：逐案）。
// 沒有資料的列直接寫 API 的 reason；區間條的刻度上限取有數字的來源裡最大的 high，三條共用同一把尺。
const props = defineProps<{ sources: readonly PotentialSource[] }>()

const scale = computed(() => rangeScale(props.sources))

interface Row {
  source: PotentialSource
  ok: boolean
  bar: ReturnType<typeof rangeBar>
  label: string
}
const rows = computed<Row[]>(() =>
  props.sources.map((source) => ({
    source,
    ok: source.status === 'ok',
    bar: rangeBar(source, scale.value),
    label: `${sourceName(source.key)}：約 ${seats(source.mid)} 位，${seats(source.low)}～${seats(source.high)} 位`,
  })),
)

const percent = (value: number) => `${value.toFixed(2)}%`

// 「怎麼算」放不放：有參數，或有小表可看。
function hasHow(source: PotentialSource): boolean {
  if (source.assumptions.length) return true
  if (source.key === 'closures') return source.details.years.length > 0 || source.details.events.length > 0
  if (source.key === 'villages') return source.details.bands.length > 0
  return source.details.deliveries.length > 0
}
</script>

<template>
  <section class="potential-sources" aria-label="每年還能多招的三個來源">
    <table class="source-table">
      <thead>
        <tr>
          <th scope="col" rowspan="2" class="source-table__name">來源</th>
          <th scope="colgroup" colspan="3">每年可多招（位）</th>
          <th scope="col" rowspan="2" class="source-table__range">區間</th>
        </tr>
        <tr>
          <th scope="col">低</th>
          <th scope="col">中</th>
          <th scope="col">高</th>
        </tr>
      </thead>
      <tbody v-for="row in rows" :key="row.source.key" class="source" :data-source="row.source.key">
        <tr class="source__row">
          <th scope="row" class="source__name">{{ sourceName(row.source.key) }}</th>
          <template v-if="row.ok">
            <td class="num source__figure" data-label="低">{{ seats(row.source.low) }}</td>
            <td class="num source__figure source__figure--mid" data-label="中">{{ seats(row.source.mid) }}</td>
            <td class="num source__figure" data-label="高">{{ seats(row.source.high) }}</td>
            <td class="source__range-cell" data-label="區間">
              <span class="source__bar" role="img" :aria-label="row.label">
                <span class="source__span" :style="{ left: percent(row.bar.left), width: percent(row.bar.width) }" />
                <span class="source__mid-mark" :style="{ left: percent(row.bar.mid) }" />
              </span>
            </td>
          </template>
          <td v-else colspan="4" class="source__nodata">{{ noDataText(row.source.reason) }}</td>
        </tr>
        <tr v-if="hasHow(row.source)" class="source__how">
          <td colspan="5">
            <AnalyticsExplainer summary="怎麼算">
              <dl v-if="row.source.assumptions.length" class="source__assumptions">
                <div v-for="item in row.source.assumptions" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>

              <template v-if="row.source.key === 'closures'">
                <table v-if="row.source.details.years.length" class="source-detail source__years">
                  <thead>
                    <tr><th scope="col">統計窗口</th><th scope="col">所數</th><th scope="col">每年可多招（位）</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="year in row.source.details.years" :key="year.school_year">
                      <th scope="row" data-label="統計窗口">{{ periodText(year.school_year) }}</th>
                      <td class="num" data-label="所數">{{ formatCount(year.events) }}</td>
                      <td class="num" data-label="每年可多招（位）">{{ detailSeats(year.weighted) }}</td>
                    </tr>
                  </tbody>
                </table>
                <table v-if="row.source.details.events.length" class="source-detail source__events">
                  <thead>
                    <tr>
                      <th scope="col">日期</th><th scope="col" class="text">園名</th><th scope="col">核定</th><th scope="col">距離</th><th scope="col">每年可多招（位）</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="event in row.source.details.events" :key="`${event.occurred_on}-${event.name}`">
                      <th scope="row" data-label="日期">{{ event.occurred_on }}</th>
                      <td class="text" data-label="園名">{{ event.name }}</td>
                      <td class="num" data-label="核定">{{ formatCount(event.approved_capacity) }}</td>
                      <td class="num" data-label="距離">{{ distanceKm(event.distance_m) }}</td>
                      <td class="num" data-label="每年可多招（位）">{{ detailSeats(event.weighted) }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>

              <table v-else-if="row.source.key === 'villages' && row.source.details.bands.length" class="source-detail source__bands">
                <thead>
                  <tr>
                    <th scope="col">距離</th><th scope="col">里數</th><th scope="col">2–5 歲孩子</th><th scope="col">在籍</th>
                    <th scope="col">照附近應有</th><th scope="col">缺口</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="band in row.source.details.bands" :key="band.band">
                    <th scope="row" data-label="距離">{{ bandLabel(band.band) }}</th>
                    <td class="num" data-label="里數">{{ formatCount(band.villages) }}</td>
                    <td class="num" data-label="2–5 歲孩子">{{ formatCount(band.kids) }}</td>
                    <td class="num" data-label="在籍">{{ band.enrolled === null ? NO_VALUE : formatCount(band.enrolled) }}</td>
                    <td class="num" data-label="照附近應有">{{ detailSeats(band.expected) }}</td>
                    <td class="num" data-label="缺口">{{ detailSeats(band.gap) }}</td>
                  </tr>
                </tbody>
              </table>

              <table v-else-if="row.source.key === 'presale' && row.source.details.deliveries.length" class="source-detail source__deliveries">
                <thead>
                  <tr>
                    <th scope="col">案名</th><th scope="col">戶數</th><th scope="col" class="text">預計交屋</th><th scope="col">距離</th>
                    <th scope="col">每年可多招（位）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="delivery in row.source.details.deliveries" :key="`${delivery.name}-${delivery.distance_m}`">
                    <th scope="row" data-label="案名">{{ delivery.name }}</th>
                    <td class="num" data-label="戶數">{{ formatCount(delivery.households) }}</td>
                    <td class="text" data-label="預計交屋">{{ deliveryText(delivery) }}</td>
                    <td class="num" data-label="距離">{{ distanceKm(delivery.distance_m) }}</td>
                    <td class="num" data-label="每年可多招（位）">{{ detailSeats(delivery.mid) }}</td>
                  </tr>
                </tbody>
              </table>
            </AnalyticsExplainer>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.potential-sources {
  min-width: 0;
  max-width: 760px;
}

.source-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.source-table > thead th {
  padding: 6px 10px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}

.source-table > thead tr:first-child th[colspan] {
  border-bottom: 1px solid var(--line);
  text-align: center;
}

.source-table > thead th.source-table__name,
.source-table > thead th.source-table__range {
  text-align: left;
}

.source > tr > th,
.source > tr > td {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.source__how > td {
  padding-top: 0;
}

.source__name {
  color: var(--ink);
  font-weight: 600;
  text-align: left;
}

.source__figure {
  color: var(--ink-2);
  text-align: right;
}

.source__figure--mid {
  color: var(--ink);
  font-weight: 700;
}

.source__nodata {
  color: var(--ink-3);
}

.source__range-cell {
  width: 38%;
  min-width: 140px;
}

/* 區間條：淡色一段是 low–high，實線是 mid；三列共用同一把尺。 */
.source__bar {
  position: relative;
  display: block;
  height: 14px;
  border-radius: 3px;
  background: var(--surface-3);
}

.source__span {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  background: color-mix(in oklch, var(--admin-accent), var(--surface) 65%);
}

.source__mid-mark {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 1px;
  background: var(--admin-accent-strong);
}

.source__assumptions {
  display: grid;
  gap: 4px;
  margin: 0;
}

.source__assumptions > div {
  display: grid;
  grid-template-columns: minmax(7em, 11em) minmax(0, 1fr);
  gap: 2px 12px;
}

.source__assumptions dt {
  color: var(--ink-3);
}

.source__assumptions dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.source-detail {
  width: 100%;
  margin-top: 6px;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.source-detail th,
.source-detail td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: right;
}

.source-detail thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 600;
}

.source-detail th:first-child,
.source-detail th.text,
.source-detail td.text {
  text-align: left;
}

.source-detail tbody th {
  font-weight: 400;
}

/* 手機：來源表一個來源一張卡（名稱在上、低／中／高三格、區間條滿版）；小表一列一張小卡，不必橫捲。 */
@media (max-width: 720px) {
  .potential-sources {
    max-width: none;
  }

  .source-table > thead,
  .source-detail > thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .source-table,
  .source-table > tbody,
  .source-detail,
  .source-detail > tbody {
    display: block;
  }

  .source {
    margin-bottom: 8px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .source > tr,
  .source-detail > tbody > tr {
    display: grid;
  }

  .source__row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px 12px;
  }

  .source > tr > th,
  .source > tr > td {
    display: grid;
    padding: 0;
    border-bottom: 0;
    text-align: left;
  }

  .source__name,
  .source__range-cell,
  .source__nodata {
    grid-column: 1 / -1;
  }

  .source__range-cell {
    width: auto;
    min-width: 0;
  }

  .source__how {
    margin-top: 6px;
  }

  .source__assumptions > div {
    grid-template-columns: minmax(0, 1fr);
  }

  .source__figure::before,
  .source-detail td::before,
  .source-detail tbody th::before {
    content: attr(data-label);
    color: var(--ink-3);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .source-detail > tbody > tr {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }

  .source-detail th,
  .source-detail td {
    display: grid;
    padding: 0;
    border-bottom: 0;
    text-align: left;
  }

  .source-detail th:first-child {
    grid-column: 1 / -1;
  }
}
</style>
