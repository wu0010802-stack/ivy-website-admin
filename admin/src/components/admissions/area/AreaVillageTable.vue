<script setup lang="ts">
import { computed, ref } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaEnrolled, AreaOpportunity, AreaTrends, VillageBoundaries } from '../../../api/types'
import { opportunitySummary, opportunityUnavailable, trendsSummary, trendsUnavailable } from './areaFormat'
import {
  defaultVillageSort, sortVillageRows, villageColumns, villageCsvCell, villageCsvColumns, villageHowText, villageSortOptions,
  villageTableRows, type VillageSort, type VillageTableRow,
} from './villageTable'

// 「各里」表（2026-10-16 區域分析工作台規格 §2.8）：招生機會、里的變化、在籍學生合成一張。
// 列、欄、排序、CSV 都在 villageTable.ts（純函式）；這裡接資料、管排序鈕與讀取失敗／讀取中的畫面。
// 排序是瀏覽動作，不寫網址（D11）：沒挑過就跟著「附近參觀到門檻」走，招生機會晚到或換半徑時預設會跟著變。
const props = defineProps<{
  trends: AreaTrends | null
  trendsFailed: boolean
  opportunity: AreaOpportunity | null
  opportunityFailed: boolean
  enrolled: AreaEnrolled | null
  /** 用來挑選取地圖的里代碼（合併組的第一個代碼可能不在里界檔裡）；沒給就用 codes[0]。 */
  boundaries?: VillageBoundaries | null
  csvName: (title: string) => string
}>()
const emit = defineEmits<{ 'select-village': [code: string]; 'retry-trends': []; 'retry-opportunity': [] }>()

// 3 公里內常有上百個里：先列 10 個，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const judged = computed(() => props.opportunity?.baseline?.judged === true)
const options = computed(() => villageSortOptions(judged.value))
const picked = ref<VillageSort | null>(null)
// 挑過的排序在目前選項裡才算數（門檻消失後「參觀偏少」不在了，退回預設）。
const sort = computed<VillageSort>(() =>
  picked.value !== null && options.value.some((option) => option.value === picked.value) ? picked.value : defaultVillageSort(judged.value),
)

const rows = computed(() => villageTableRows(props.trends, props.opportunity, props.enrolled, props.boundaries ?? null))
const sortedRows = computed(() => sortVillageRows(rows.value, sort.value))
const allChildren = computed(() => rows.value.every((row) => row.children !== null))
const columns = computed(() => villageColumns(judged.value, allChildren.value))
const csvColumns = computed(() => villageCsvColumns(allChildren.value))

const radiusKm = computed(() => (props.trends ?? props.opportunity)?.radius_km ?? 3)
const title = computed(() => `各里（本校 ${radiusKm.value} 公里內）`)
const caption = computed(() => villageHowText(props.trends, props.opportunity))
const emptyText = computed(
  () =>
    (props.trends && trendsUnavailable(props.trends)) ||
    (props.opportunity && opportunityUnavailable(props.opportunity)) ||
    `本校 ${radiusKm.value} 公里內沒有里的資料。`,
)

// 表格下方的補充：合併組、淨增算不出的原因、新屋只到區，以及沒算進來的參觀（3 公里外、沒填地址、沒對到里）。
const notes = computed(() =>
  [
    props.trends && !trendsUnavailable(props.trends) ? trendsSummary(props.trends)?.note : '',
    props.opportunity ? opportunitySummary(props.opportunity)?.note : '',
  ].filter((note): note is string => Boolean(note)),
)

// 兩份任何一份還在讀（沒資料也沒失敗）就顯示骨架，同里卡片：只有一份到時畫出來的表，欄位與預設排序會在另一份到時跳動。
// 讀取失敗的那份不等；兩份都讀不到只剩失敗句。
const waiting = computed(() => (!props.trends && !props.trendsFailed) || (!props.opportunity && !props.opportunityFailed))
const hasBase = computed(() => props.trends !== null || props.opportunity !== null)

const choose = (value: unknown) => {
  picked.value = value as VillageSort
}
const select = (row: VillageTableRow) => emit('select-village', row.code)
</script>

<template>
  <div class="village-table">
    <el-alert v-if="trendsFailed" class="trends-error" type="error" :closable="false" show-icon title="無法讀取里的變化，請重新載入。">
      <el-button size="small" @click="emit('retry-trends')">重新載入</el-button>
    </el-alert>
    <el-alert v-if="opportunityFailed" class="opportunity-error" type="error" :closable="false" show-icon title="無法讀取招生機會，請重新載入。">
      <el-button size="small" @click="emit('retry-opportunity')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-if="waiting" :rows="4" animated />
    <template v-else-if="hasBase">
      <StatsDimensionTable
        :title="title"
        :rows="sortedRows"
        :columns="columns"
        :csv-columns="csvColumns"
        row-key="key"
        numbered
        :empty-text="emptyText"
        :caption="caption"
        caption-collapsed
        :export-filename="csvName('各里')"
        :csv-cell="villageCsvCell"
        :collapsed-rows="COLLAPSED_ROWS"
        name-action="在地圖上選取"
        @name-action="select"
      >
        <template #intro>
          <el-radio-group class="village-table__sort" :model-value="sort" size="small" aria-label="各里排序" @update:model-value="choose">
            <el-radio-button v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
          </el-radio-group>
        </template>
      </StatsDimensionTable>
      <p v-for="note in notes" :key="note" class="hint village-table__note">{{ note }}</p>
    </template>
  </div>
</template>

<style scoped>
.village-table {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.village-table__sort {
  margin-bottom: 8px;
}

.village-table__note {
  margin: 0;
}
</style>
