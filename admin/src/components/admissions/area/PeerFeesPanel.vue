<script setup lang="ts">
import { computed, useId } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaPeerFees } from '../../../api/types'
import { campusNotLocatedReason } from './areaFormat'
import {
  PEER_AGES, SCHOOL_COLUMNS, SCHOOL_CSV_COLUMNS, feeLagNote, groupRows, itemRows, peerFeesSubtitle, peerSummaryText, schoolCsvCell,
  schoolRows, stripScale, type PeerAge,
} from './peerFeesFormat'

// 附近同業收費（2026-10-15 規格 7.1）：本校一學期公告收費在半徑內私立一般園所裡的位置。
// 排名、中位數、項目對照只和私立一般比（規格 F2）；準公共、公立、非營利只當背景。
// 落點條是裝飾（aria-hidden），等價資訊在「各所收費」表。年齡由 AreaTab 保管（換校區、半徑保留）。
const props = defineProps<{ data: AreaPeerFees | null; failed: boolean; age: PeerAge; csvName: (title: string) => string }>()
const emit = defineEmits<{ 'update:age': [value: PeerAge]; retry: [] }>()

const headingId = useId()
// 3 公里內私立與準公共常有四五十所：先列 10 列，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法比較附近同業收費。` : ''
})
const notImported = computed(() => props.data?.synced_at === null)
const subtitle = computed(() => {
  if (!props.data) return ''
  return [peerFeesSubtitle(props.data), feeLagNote(props.data.school_year, props.data.current_school_year)].filter(Boolean).join('。')
})
const summary = computed(() => (props.data ? peerSummaryText(props.data) : ''))
const strip = computed(() => (props.data ? stripScale(props.data) : null))
const groups = computed(() => (props.data ? groupRows(props.data) : []))
const items = computed(() => (props.data?.own ? itemRows(props.data) : []))
const schools = computed(() => (props.data ? schoolRows(props.data) : []))

function setAge(value: string | number | boolean | undefined) {
  const age = Number(value)
  if (age === 2 || age === 3 || age === 4 || age === 5) emit('update:age', age)
}
</script>

<template>
  <section class="peer-fees" :aria-labelledby="headingId">
    <div class="peer-fees__head">
      <h3 :id="headingId" class="peer-fees__title">附近同業收費</h3>
      <el-radio-group :model-value="age" size="small" aria-label="年齡" @update:model-value="setAge">
        <el-radio-button v-for="value in PEER_AGES" :key="value" :value="value">{{ value }} 歲</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近同業收費。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="notLocated" class="peer-fees__empty">{{ notLocated }}</p>
    <p v-else-if="notImported" class="peer-fees__empty">收費資料尚未匯入。</p>
    <template v-else>
      <p v-if="subtitle" class="hint peer-fees__subtitle">{{ subtitle }}</p>
      <p class="peer-fees__summary num">{{ summary }}</p>

      <div v-if="strip" class="peer-strip" aria-hidden="true">
        <div class="peer-strip__track">
          <span v-if="strip.median !== null" class="peer-strip__median" :style="{ left: `${strip.median}%` }" />
          <span
            v-for="point in strip.points"
            :key="point.id"
            class="peer-strip__dot"
            :class="{ 'is-own': point.own }"
            :style="{ left: `${point.left}%` }"
          />
        </div>
        <div class="peer-strip__ends num"><span>{{ strip.lowestText }}</span><span>{{ strip.highestText }}</span></div>
      </div>

      <div class="peer-table__scroll" role="region" tabindex="0" aria-label="各類型的公告收費（可左右捲動）">
        <table class="peer-table">
          <caption class="visually-hidden">各類型園所的公告收費</caption>
          <thead>
            <tr>
              <th scope="col">類型</th>
              <th scope="col" class="num">附近園所</th>
              <th scope="col" class="num">有公布收費</th>
              <th scope="col" class="num">中位數</th>
              <th scope="col" class="num">範圍</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in groups" :key="row.kind">
              <th scope="row">{{ row.label }}</th>
              <td class="num">{{ row.schools }}</td>
              <td class="num">{{ row.withFee }}</td>
              <td class="num">{{ row.median }}</td>
              <td class="num">{{ row.range }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint">準公共、公立、非營利的家長另有政府補助，這裡是園所公告收費，不是家長實付。</p>

      <template v-if="items.length">
        <div class="peer-table__scroll" role="region" tabindex="0" aria-label="本校與私立同業的逐項收費（可左右捲動）">
          <table class="peer-table">
            <caption class="visually-hidden">本校與私立同業中位數的逐項收費</caption>
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col" class="num">本校</th>
                <th scope="col" class="num">私立中位數</th>
                <th scope="col" class="num">差額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in items" :key="row.key">
                <th scope="row">{{ row.label }}</th>
                <td class="num">{{ row.own }}</td>
                <td class="num">{{ row.peer }}</td>
                <td class="num">{{ row.diff }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">各園項目歸類不一，總價比較較準。</p>
      </template>

      <StatsDimensionTable
        title="各所收費"
        :rows="schools"
        :columns="SCHOOL_COLUMNS"
        :csv-columns="SCHOOL_CSV_COLUMNS"
        :csv-cell="schoolCsvCell"
        row-key="source_id"
        empty-text="附近沒有公布收費的私立或準公共幼兒園。"
        :export-filename="csvName(`附近同業收費-${age} 歲`)"
        :collapsed-rows="COLLAPSED_ROWS"
      />
    </template>
  </section>
</template>

<style scoped>
.peer-fees {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.peer-fees__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.peer-fees__title {
  margin: 0;
  font-size: var(--text-md);
}

.peer-fees__subtitle,
.peer-fees__summary,
.peer-fees__empty {
  margin: 0;
}

.peer-fees__summary {
  color: var(--ink);
}

.peer-strip {
  --peer-own-dot: 14px;

  display: grid;
  gap: 4px;
  padding: 8px 0 0;
}

/* 軌道左右各縮一個本校點的半徑：兩端的點（最低、最高）整顆落在內容邊內，端點標籤也對齊點的外緣。 */
.peer-strip__track {
  position: relative;
  height: 20px;
  margin: 0 calc(var(--peer-own-dot) / 2);
  border-bottom: 1px solid var(--line-strong);
}

.peer-strip__dot,
.peer-strip__median {
  position: absolute;
  bottom: -5px;
  transform: translateX(-50%);
}

.peer-strip__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--area-kind-private);
}

.peer-strip__dot.is-own {
  z-index: 1;
  width: var(--peer-own-dot);
  height: var(--peer-own-dot);
  bottom: -7px;
  border: 2px solid var(--area-kind-own-ink);
  background: var(--area-kind-own);
}

.peer-strip__median {
  bottom: -2px;
  width: 2px;
  height: 22px;
  background: var(--ink-2);
}

.peer-strip__ends {
  display: flex;
  justify-content: space-between;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.peer-table__scroll {
  max-width: 100%;
  overflow-x: auto;
}

.peer-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.peer-table th,
.peer-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.peer-table th.num,
.peer-table td.num {
  text-align: right;
}

.peer-table thead th {
  color: var(--ink-2);
  font-weight: 600;
}
</style>
