<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsJourney } from '../../api/types'
import { cancelNote, cancelRows, exitRows } from '../../admissions/journeyFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 家庭在哪裡離開（2026-10-15 規格 §3.3）：沒走到「預繳過」的家庭恰好分成前九類，預繳後退出另兩列；
// 取消另有「距參觀日」的分區表（家長、園方、其他分開）。沒有取消就沒有第二張表。
// 缺取消時間而不納入的筆數：表在就接在表的說明後面；表整張沒資料（取消都缺時間）就改寫在離開表下面，數字不憑空消失。
const props = defineProps<{ data: AdmissionsJourney; csvName: (title: string) => string }>()
const EXIT_TITLE = '家庭在哪裡離開'
const CANCEL_TITLE = '取消時點（距參觀日）'
const CANCEL_CAPTION = '取消日距預定參觀日幾天（以目前的場次為準，改過期的算最後那個場次）；「其他」是取消原因沒記或舊流程留下的占位原因。'
const EXIT_COLUMNS: StatsColumn[] = [
  { key: 'kind', label: '類別', sticky: true },
  { key: 'count', label: '人數', kind: 'bar' },
  { key: 'timing', label: '時點' },
]
const CANCEL_COLUMNS: StatsColumn[] = [
  { key: 'bucket', label: '距參觀日', sticky: true },
  { key: 'parent', label: '家長', kind: 'count' },
  { key: 'staff', label: '園方', kind: 'count' },
  { key: 'other', label: '其他', kind: 'count' },
]
const exits = computed(() => exitRows(props.data))
const cancels = computed(() => cancelRows(props.data))
const note = computed(() => cancelNote(props.data))
const cancelCaption = computed(() => (note.value ? `${CANCEL_CAPTION} ${note.value}` : CANCEL_CAPTION))
</script>

<template>
  <div class="journey-exits">
    <StatsDimensionTable
      :title="EXIT_TITLE"
      :rows="exits"
      :columns="EXIT_COLUMNS"
      row-key="key"
      empty-text="這段期間沒有預約案件"
      :export-filename="csvName(EXIT_TITLE)"
      caption="沒走到「預繳過」的家庭恰好分成前九類；預繳後退出是預繳過裡的一部分，另外列在最後。觀察中的家庭只是還沒到逾期，不預測他們會不會預繳。"
    />
    <p v-if="!cancels.length && note" class="hint journey-exits__note">{{ note }}</p>
    <StatsDimensionTable
      v-if="cancels.length"
      :title="CANCEL_TITLE"
      :rows="cancels"
      :columns="CANCEL_COLUMNS"
      row-key="key"
      empty-text="這段期間沒有取消"
      :export-filename="csvName(CANCEL_TITLE)"
      :caption="cancelCaption"
    />
  </div>
</template>

<style scoped>
.journey-exits {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.journey-exits__note {
  margin: -8px 0 0;
}
</style>
