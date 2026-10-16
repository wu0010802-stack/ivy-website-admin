<script setup lang="ts">
import { computed, ref } from 'vue'
import { campusLabel } from '../../api/labels'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import CampusSelect from '../CampusSelect.vue'
import { schoolYearOptions } from '../../admissions/academic'
import { SEMESTER_LABELS } from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'

// 招生入學與招生統計的頁首篩選：校區、入學學年、入學學期（2026-10-16 從 AdmissionsView 抽出，兩頁共用）。
// termless：目前的內容不分入學學年學期（招生統計的參觀預約、預約全程），兩個下拉停用並寫明，值保留。
const props = defineProps<{
  campus: string
  schoolYear: number | null
  semester: Semester | null
  campusKeys: readonly string[]
  defaultYear: number
  termless?: boolean
}>()
const emit = defineEmits<{
  'update:campus': [value: string]
  'update:schoolYear': [value: number | null]
  'update:semester': [value: Semester | null]
}>()

const multiCampus = computed(() => props.campusKeys.length > 1)
// 學年選項取新增／編輯表單（+3…−1）與原本頁首（+1…−2）的聯集：入學學年填到後年、大後年的訪視也選得到。
const yearOptions = computed(() => schoolYearOptions(props.defaultYear, [3, 2, 1, 0, -1, -2]))

// 手機：三個篩選收成一顆摘要鈕，點開才出現（390px 疊起來會占掉半個首屏）。
const narrow = useNarrowScreen()
const filtersOpen = ref(false)
const filterSummary = computed(() => {
  const parts: string[] = []
  if (multiCampus.value) parts.push(campusLabel(props.campus))
  if (props.termless) parts.push('不分學年學期')
  else parts.push(props.schoolYear === null ? '不限學年' : `${props.schoolYear} 學年`, props.semester ? SEMESTER_LABELS[props.semester] : '整學年')
  return parts.join('・')
})
</script>

<template>
  <button
    v-if="narrow"
    type="button"
    class="admissions__summary"
    :aria-expanded="filtersOpen"
    aria-controls="admissions-filters"
    @click="filtersOpen = !filtersOpen"
  >
    <span class="admissions__summary-text">{{ filterSummary }}</span>
    <span class="admissions__summary-action">{{ filtersOpen ? '收起' : '更改條件' }}</span>
  </button>
  <div v-if="!narrow || filtersOpen" id="admissions-filters" class="toolbar admissions__filters">
    <div class="filter-field">
      <span v-if="multiCampus">校區</span>
      <CampusSelect :model-value="campus" :keys="campusKeys" @update:model-value="emit('update:campus', $event)" />
    </div>
    <div class="filter-field">
      <span>入學學年</span>
      <el-select
        :model-value="schoolYear ?? undefined"
        clearable
        placeholder="不限學年"
        aria-label="入學學年"
        :disabled="termless"
        @update:model-value="emit('update:schoolYear', $event ?? null)"
      >
        <el-option v-for="year in yearOptions" :key="year" :label="`${year} 學年`" :value="year" />
      </el-select>
    </div>
    <div class="filter-field">
      <span>入學學期</span>
      <el-select
        :model-value="semester ?? undefined"
        clearable
        placeholder="整學年"
        aria-label="入學學期"
        :disabled="termless"
        @update:model-value="emit('update:semester', $event ?? null)"
      >
        <el-option :value="1" :label="SEMESTER_LABELS[1]" />
        <el-option :value="2" :label="SEMESTER_LABELS[2]" />
      </el-select>
    </div>
    <p v-if="termless" class="admissions__scope-note hint">這個分頁不分入學學年學期</p>
  </div>
</template>

<style scoped>
.admissions__filters .el-select {
  width: 140px;
}

.admissions__scope-note {
  align-self: flex-end;
  margin: 0;
  padding-bottom: 6px;
}

.admissions__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  margin-bottom: 8px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-base);
  text-align: left;
  cursor: pointer;
}

.admissions__summary-text {
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.admissions__summary-action {
  flex: none;
  color: var(--el-color-primary);
  font-size: var(--text-sm);
}
</style>
