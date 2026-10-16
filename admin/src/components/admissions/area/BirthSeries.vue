<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AreaTrendsBirthPeriod } from '../../../api/types'
import { barWidth } from '../../../admissions/statsFormat'
import { notifyError } from '../../../composables/notify'
import { buildCsv, downloadCsv } from '../../../utils/csv'
import { BIRTH_SERIES_NOTE, birthSeriesCsv, birthSeriesRows } from './birthSeriesFormat'

// 近幾年的出生數（2026-10-14 出生走勢規格 §4.3）：放在「里的變化」總結句下面、里表上面。長條只是輔助，
// 數字一定寫出來；最新一期在最上面。用自己的 ARIA table 而不是第二個 StatsDimensionTable：巢狀的
// 表會讓外層「里的變化」表的 thead／tbody 選擇器選到兩張表（計畫裁定 R1）。
const props = defineProps<{
  periods: readonly AreaTrendsBirthPeriod[]
  radiusKm: number
  /** 匯出 CSV 的完整檔名（呼叫端用 csvName('近幾年的出生數') 組）。 */
  csvName: string
}>()

const headingId = useId()
const title = computed(() => `近幾年的出生數（本校 ${props.radiusKm} 公里內）`)
const rows = computed(() => birthSeriesRows(props.periods))
const max = computed(() => Math.max(0, ...rows.value.map((row) => row.births)))

function exportCsv() {
  const { header, rows: lines } = birthSeriesCsv(props.periods)
  try {
    downloadCsv(props.csvName, buildCsv(header, lines))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
}
</script>

<template>
  <section v-if="rows.length" class="birth-series" :aria-labelledby="headingId">
    <div class="birth-series__head">
      <h3 :id="headingId" class="birth-series__title">{{ title }}</h3>
      <el-button size="small" text data-test="birth-series-csv" :aria-label="`把「${title}」匯出 CSV`" @click="exportCsv">
        匯出 CSV
      </el-button>
    </div>
    <div class="birth-series__table" role="table" :aria-label="title">
      <div class="birth-series__row birth-series__row--head" role="row">
        <span role="columnheader">期間</span>
        <span role="columnheader">出生數</span>
        <span role="columnheader">和前一期</span>
      </div>
      <div v-for="row in rows" :key="row.key" class="birth-series__row" role="row">
        <span role="rowheader" class="birth-series__period">
          <span class="birth-series__label"><span class="birth-series__part">{{ row.label_from }}～</span><span class="birth-series__part">{{ row.label_to }}</span></span>
          <small v-if="row.missing_text" class="birth-series__missing">{{ row.missing_text }}</small>
        </span>
        <span role="cell" class="birth-series__figure">
          <span class="birth-series__bar" aria-hidden="true">
            <span class="birth-series__fill" :style="{ width: barWidth(row.births, max) }" />
          </span>
          <span class="birth-series__number">{{ row.births_text }}</span>
        </span>
        <span role="cell" class="birth-series__change">{{ row.change_text }}</span>
      </div>
    </div>
    <p class="hint birth-series__note">{{ BIRTH_SERIES_NOTE }}</p>
  </section>
</template>

<style scoped>
.birth-series {
  min-width: 0;
  margin: 4px 0 12px;
}

.birth-series__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.birth-series__title {
  margin: 0 0 8px;
  font-size: var(--text-base);
  font-weight: 600;
}

.birth-series__table {
  max-width: 640px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.birth-series__row {
  display: grid;
  grid-template-columns: minmax(170px, 1.6fr) minmax(150px, 1.2fr) minmax(72px, auto);
  gap: 4px 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-size: var(--text-base);
}

.birth-series__row:last-child {
  border-bottom: 0;
}

.birth-series__row--head {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

/* 期間標籤只在「～」處換行，不把「115 年 9 月」拆成兩行 */
.birth-series__part {
  display: inline-block;
  white-space: nowrap;
}

.birth-series__missing {
  display: block;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.birth-series__figure {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.birth-series__bar {
  flex: none;
  width: 72px;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
}

.birth-series__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}

.birth-series__number,
.birth-series__change {
  font-variant-numeric: tabular-nums;
}

/* 固定寬度，長條左緣才不會因位數不同而漂移；要容得下 5 位數加千分位 */
.birth-series__number {
  min-width: 3.5em;
  text-align: right;
}

/* 表頭與其欄對齊：第 2、3 格（含表頭）一律靠右，期間欄維持靠左、可換行 */
.birth-series__row > :nth-child(2),
.birth-series__row > :nth-child(3) {
  text-align: right;
}

.birth-series__note {
  margin: 6px 0 0;
}

@media (max-width: 720px) {
  .birth-series__row {
    grid-template-columns: minmax(0, 1fr) 104px 64px;
    padding: 8px 10px;
  }

  .birth-series__bar {
    width: 40px;
  }
}
</style>
