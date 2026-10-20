<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaPresale } from '../../../api/types'
import { notifyError } from '../../../composables/notify'
import { useNarrowScreen } from '../../../composables/useNarrowScreen'
import { buildCsv, downloadCsv } from '../../../utils/csv'
import {
  NO_PRESALE_TEXT, PRESALE_CAPTION, formatCount, presaleListNote, presaleSourceLine, presaleUnplacedNote,
} from './areaFormat'
import { PRESALE_COLUMNS, PRESALE_CSV_COLUMNS, presaleCsv, presaleCsvCell, presaleRows, type PresaleRow } from './presaleTable'

// 附近預售建案（2026-10-20 預售建案規格 P12）：本校半徑內在建的預售建案，依預計交屋由近到遠。資料是自己的 API
// （/area/presale），不依賴「里的變化」；讀取失敗與重試在這裡。寬螢幕是表格（和各里表同一個元件，可匯出 CSV），
// 手機（≤720px）收成卡片列表（沿用附近幼兒園清單的作法：窄螢幕不橫捲）。點案名＝在地圖上選取它所在的里。
const props = defineProps<{ data: AreaPresale | null; failed: boolean; csvName: (title: string) => string }>()
const emit = defineEmits<{ retry: []; 'select-village': [code: string] }>()

const COLLAPSED_ROWS = 10
const headingId = useId()
const narrow = useNarrowScreen()
const expanded = ref(false)

const radius = computed(() => props.data?.radius_km ?? 3)
const title = computed(() => `附近預售建案（本校 ${radius.value} 公里內）`)
const rows = computed(() => (props.data ? presaleRows(props.data) : []))
const shownCards = computed(() => (expanded.value ? rows.value : rows.value.slice(0, COLLAPSED_ROWS)))
const unavailable = computed(() => (props.data ? presaleListNote(props.data) : ''))
const emptyText = computed(() => NO_PRESALE_TEXT)
const summary = computed(() =>
  props.data && props.data.summary.cases
    ? `在建 ${formatCount(props.data.summary.cases)} 案、${formatCount(props.data.summary.households)} 戶。`
    : '',
)
const source = computed(() => (props.data ? presaleSourceLine(props.data) : ''))
const unplaced = computed(() => (props.data ? presaleUnplacedNote(props.data) : ''))
const filename = computed(() => props.csvName('附近預售建案'))

const select = (row: PresaleRow) => emit('select-village', row.village_code)

// 手機卡片的匯出（寬螢幕的表格自己有匯出鈕）：欄與格值同表格匯出。
function exportCsv() {
  const { header, rows: body } = presaleCsv(rows.value)
  try {
    downloadCsv(filename.value, buildCsv(header, body))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
}
</script>

<template>
  <div class="presale">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近預售建案，請重新載入。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="unavailable" class="empty-note">{{ unavailable }}</p>
    <template v-else>
      <StatsDimensionTable
        v-if="!narrow"
        :title="title"
        :rows="rows"
        :columns="PRESALE_COLUMNS"
        :csv-columns="PRESALE_CSV_COLUMNS"
        row-key="key"
        numbered
        :empty-text="emptyText"
        :caption="PRESALE_CAPTION"
        :export-filename="filename"
        :csv-cell="presaleCsvCell"
        :collapsed-rows="COLLAPSED_ROWS"
        name-action="選取所在的里"
        @name-action="select"
      >
        <template v-if="summary" #intro>
          <p class="presale__summary">{{ summary }}</p>
        </template>
      </StatsDimensionTable>

      <section v-else class="presale-cards" :aria-labelledby="headingId">
        <div class="presale-cards__head">
          <h3 :id="headingId" class="presale-cards__title">{{ title }}</h3>
          <el-button v-if="rows.length" size="small" text :aria-label="`把「${title}」匯出 CSV`" @click="exportCsv">匯出 CSV</el-button>
        </div>
        <p v-if="summary" class="presale__summary">{{ summary }}</p>
        <p class="hint presale-cards__caption">{{ PRESALE_CAPTION }}</p>
        <p v-if="!rows.length" class="empty-note">{{ emptyText }}</p>
        <ul v-else class="presale-cards__list">
          <li v-for="row in shownCards" :key="row.key" class="presale-cards__item">
            <button type="button" class="presale-cards__name" :aria-label="`選取所在的里：${row.name}`" @click="select(row)">{{ row.name }}</button>
            <span class="presale-cards__meta">{{ row.place }}・{{ formatCount(row.households) }} 戶・距本校 {{ row.distance }}</span>
            <span class="presale-cards__meta">預計交屋：{{ row.delivery }}</span>
            <span class="presale-cards__meta">建照日 {{ row.permit }}・{{ row.locate }}</span>
          </li>
        </ul>
        <el-button
          v-if="rows.length > COLLAPSED_ROWS"
          size="small"
          text
          type="primary"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          {{ expanded ? `只顯示前 ${COLLAPSED_ROWS} 案` : `顯示全部 ${rows.length} 案` }}
        </el-button>
      </section>

      <p v-if="unplaced" class="hint presale__note">{{ unplaced }}</p>
      <p v-if="source" class="hint presale__note">{{ source }}</p>
    </template>
  </div>
</template>

<style scoped>
.presale {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.presale__summary {
  margin: 0 0 8px;
  color: var(--ink-2);
}

.presale__note {
  margin: 0;
}

.presale-cards {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.presale-cards__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.presale-cards__title {
  margin: 0;
  font-size: var(--text-md);
}

.presale-cards__caption {
  margin: 0;
}

.presale-cards__list {
  display: grid;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.presale-cards__item {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
}

.presale-cards__item + .presale-cards__item {
  border-top: 1px solid var(--line);
}

.presale-cards__name {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.presale-cards__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
</style>
