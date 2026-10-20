<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import ShareTrendChart from './ShareTrendChart.vue'
import {
  NOT_IMPORTED_TEXT, NO_CAMPUS_POINT_TEXT, NO_CHILDREN_TEXT, POTENTIAL_SOURCE_NOTE, bestSentence, elementarySentence, formatShare,
  shareCsv, shareSentence,
} from './potentialFormat'
import { getPotential } from '../../../api/admissions'
import { campusLabel } from '../../../api/labels'
import type { Potential } from '../../../api/types'
import { taipeiToday } from '../../../admissions/academic'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { notifyError } from '../../../composables/notify'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { buildCsv, csvFilename, downloadCsv } from '../../../utils/csv'
import { formatCount } from '../area/areaFormat'

// 招生潛力與市佔率（2026-10-20 規格 §5，第一波只有市佔率）：本校半徑內各學年的市佔率走勢與國小一年級對帳。
// 讀自己的 API、看所有學年（不分入學學年學期，頁首兩個下拉停用）；校區跟頁首。
// active：這是不是目前的子分頁。pane 看過之後一直掛著，不在這頁時換校區只記下要重讀，回來才讀（不在背景打 API）。
const props = withDefaults(defineProps<{ campusKey: string; active?: boolean }>(), { active: true })

const data = ref<Potential | null>(null)
const failed = ref(false)
const requests = useRequestSequence()
let pending = false

async function load() {
  pending = false
  const request = requests.begin()
  failed.value = false
  if (!props.campusKey) {
    data.value = null
    return
  }
  try {
    const result = await getPotential(props.campusKey)
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) {
      data.value = null
      failed.value = true
    }
  }
}

// 換校區：先清空再讀（不留別校的數字）。
function refresh() {
  data.value = null
  if (props.active) void load()
  else pending = true
}
watch(() => props.campusKey, refresh, { immediate: true })
watch(() => props.active, (active) => { if (active && pending) void load() })

const share = computed(() => data.value?.share ?? null)
const radius = computed(() => share.value?.radius_km ?? 3)
const latest = computed(() => share.value?.latest ?? null)
const best = computed(() => share.value?.best ?? null)
const years = computed(() => share.value?.years ?? [])
const elementary = computed(() => (share.value?.elementary_check ? elementarySentence(share.value.elementary_check, radius.value) : ''))

const titleId = useId()
const open = ref<string[]>([])

function exportCsv() {
  const { header, rows } = shareCsv(years.value, radius.value)
  try {
    downloadCsv(csvFilename('招生統計', '招生潛力與市佔率', campusLabel(props.campusKey), taipeiToday()), buildCsv(header, rows))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
}
</script>

<template>
  <section class="potential" aria-label="招生潛力與市佔率">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取招生潛力與市佔率，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!share" :rows="5" animated />
    <p v-else-if="share.status === 'not_imported'" class="empty-note">{{ NOT_IMPORTED_TEXT }}</p>
    <p v-else-if="share.status === 'no_campus_point'" class="empty-note">{{ NO_CAMPUS_POINT_TEXT(radius) }}</p>
    <div v-else class="potential-body">
      <section v-if="latest" class="potential-card" :aria-labelledby="titleId">
        <h3 :id="titleId" class="potential-card__title">{{ latest.school_year }} 學年市佔率（{{ radius }} 公里內 2–5 歲）</h3>
        <p class="potential-card__value num">{{ formatShare(latest.share) }}</p>
        <p class="potential-card__line num">{{ shareSentence(latest) }}</p>
        <p v-if="bestSentence(best, latest)" class="potential-card__line num">{{ bestSentence(best, latest) }}</p>
      </section>
      <p v-else class="empty-note potential-empty">{{ NO_CHILDREN_TEXT }}</p>

      <ShareTrendChart :years="years" />

      <el-collapse v-model="open" class="potential-years">
        <el-collapse-item title="各學年數字" name="years">
          <div class="potential-years__head">
            <el-button size="small" text data-test="potential-csv" aria-label="把「各學年數字」匯出 CSV" @click="exportCsv">匯出 CSV</el-button>
          </div>
          <table class="potential-table">
            <thead>
              <tr>
                <th scope="col">學年</th>
                <th scope="col">秋季註冊</th>
                <th scope="col">{{ radius }} 公里內 2–5 歲</th>
                <th scope="col">市佔率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="year in years" :key="year.school_year">
                <th scope="row" data-label="學年">{{ year.school_year }}{{ year.merged ? '*' : '' }}</th>
                <td class="num" data-label="秋季註冊">{{ formatCount(year.registered) }}</td>
                <td class="num" :data-label="`${radius} 公里內 2–5 歲`">{{ year.children === null ? NO_VALUE : formatCount(year.children) }}</td>
                <td class="num" data-label="市佔率">{{ formatShare(year.share) }}</td>
              </tr>
            </tbody>
          </table>
          <ul v-if="share.notes.length" class="hint potential-years__notes">
            <li v-for="note in share.notes" :key="note">{{ note }}</li>
          </ul>
        </el-collapse-item>
      </el-collapse>

      <p v-if="elementary" class="potential-elementary num" :class="{ 'potential-elementary--warn': share.elementary_check?.warn }">{{ elementary }}</p>
      <p class="hint potential-source">{{ POTENTIAL_SOURCE_NOTE(radius) }}</p>
    </div>
  </section>
</template>

<style scoped>
.potential {
  min-width: 0;
}

.potential-body {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.potential-card {
  display: grid;
  gap: 4px;
  max-width: 560px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.potential-card__title {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-base);
  font-weight: 600;
}

.potential-card__value {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-5xl);
  font-weight: 700;
  line-height: 1.2;
}

.potential-card__line {
  margin: 0;
  color: var(--ink-2);
}

.potential-years {
  max-width: 560px;
}

.potential-years__head {
  display: flex;
  justify-content: flex-end;
}

.potential-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.potential-table th,
.potential-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}

.potential-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.potential-table th:first-child {
  text-align: left;
}

.potential-table tbody th {
  font-weight: 600;
}

.potential-years__notes {
  margin: 8px 0 0;
  padding-left: 18px;
}

.potential-elementary {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* 偏離歷年平均時用警示字（--el-color-warning-dark-2 在白底 5.5:1，style.css 的註解） */
.potential-elementary--warn {
  color: var(--el-color-warning-dark-2);
}

.potential-source {
  max-width: 68ch;
  margin: 0;
}

/* 手機：卡片與圖滿版；各學年數字從表格改成一列一張小卡（2×2：欄名在上、數字在下），不必橫捲。 */
@media (max-width: 720px) {
  .potential-card,
  .potential-years {
    max-width: none;
  }

  .potential-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .potential-table,
  .potential-table tbody {
    display: block;
  }

  .potential-table tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 12px;
    margin-bottom: 8px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .potential-table th,
  .potential-table td {
    display: grid;
    padding: 0;
    border-bottom: 0;
    text-align: left;
    white-space: normal;
  }

  .potential-table th::before,
  .potential-table td::before {
    content: attr(data-label);
    color: var(--ink-3);
    font-size: var(--text-xs);
    font-weight: 400;
  }
}
</style>
