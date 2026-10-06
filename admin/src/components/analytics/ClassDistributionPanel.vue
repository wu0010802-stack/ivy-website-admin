<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ClassDistributionOut } from '../../api/types'
import { campusLabel } from '../../api/labels'
import { getClassDistribution, rangeKey, type DateRange } from '../../api/analytics'
import { currentTerm, schoolYearOptions } from '../../admissions/academic'
import type { StatsColumn } from '../../admissions/statsFormat'
import { useRequestSequence } from '../../composables/useRequestSequence'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import AnalyticsMeta from './AnalyticsMeta.vue'
import { analyticsCsvName } from './csvExport'

// 預約孩子的生日換算成某學年度的班別（GET /admin/analytics/class-distribution）。換算在後端
// （admissions/academic.grade_for_birthday，和招生入學、官網入學資訊頁共用案例
// contracts/ivy-recruitment/grade-cases.json），這裡只顯示。是年齡對照，不是報名或入學結果。
const props = defineProps<{ campusKey: string; range: DateRange | null; periodLabel: string; refreshToken?: number }>()

const baseYear = currentTerm().schoolYear
const yearOptions = schoolYearOptions(baseYear, [2, 1, 0, -1])
const schoolYear = ref(baseYear)
const data = ref<ClassDistributionOut | null>(null)
// 畫面上這批資料的校區與期間：重抓時舊資料還在，標題與期間不能先換成新的選擇。
const loadedCampus = ref('')
const loadedPeriod = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  const campus = props.campusKey
  const period = props.periodLabel
  try {
    const result = await getClassDistribution(campus, schoolYear.value, props.range)
    if (requests.isCurrent(request)) {
      data.value = result
      loadedCampus.value = campus
      loadedPeriod.value = period
    }
  } catch {
    if (!requests.isCurrent(request)) return
    data.value = null
    error.value = '無法讀取班別分布，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => `${props.campusKey}|${rangeKey(props.range)}|${schoolYear.value}|${props.refreshToken ?? 0}`, load, { immediate: true })

const COLUMNS: StatsColumn[] = [
  { key: 'label', label: '班別', sticky: true },
  { key: 'count', label: '預約案件', kind: 'bar' },
]
const rows = computed(() =>
  data.value
    ? [
        ...data.value.grades.map((row) => ({ key: row.grade, label: row.grade, count: row.count })),
        { key: 'out_of_range', label: '不在幼幼班～大班', count: data.value.out_of_range },
        { key: 'unrecorded', label: '沒有生日資料', count: data.value.unrecorded },
      ]
    : [],
)
</script>

<template>
  <section class="panel classes" :class="{ 'is-updating': loading && data }" aria-labelledby="class-dist-title" :aria-busy="loading">
    <div class="panel__head classes__head">
      <h2 id="class-dist-title">預約孩子的班別{{ data ? `・${campusLabel(loadedCampus)}校` : '' }}</h2>
      <label class="filter-field classes__year">
        <span>學年度</span>
        <el-select v-model="schoolYear" aria-label="換算的學年度">
          <el-option v-for="year in yearOptions" :key="year" :value="year" :label="`${year} 學年度`" />
        </el-select>
      </label>
    </div>
    <div class="panel__body classes__body">
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
      <el-skeleton v-else-if="loading && !data" animated :rows="3" aria-label="正在讀取班別分布" />
      <template v-else-if="data">
        <p v-if="data.total === 0" class="field-help">這段期間沒有預約案件。</p>
        <StatsDimensionTable
          v-else
          :title="`${data.school_year} 學年度的班別`"
          :rows="rows"
          :columns="COLUMNS"
          row-key="key"
          empty-text="沒有資料"
          :export-filename="analyticsCsvName('預約孩子的班別', `${campusLabel(loadedCampus)}-${data.school_year}學年度`, loadedPeriod)"
        />
        <AnalyticsMeta :period="loadedPeriod" unit="預約案件數（含已取消）" :as-of="data.as_of" />
        <AnalyticsExplainer>
          <p>依孩子生日換算：民國 Y/9/2～Y+1/9/1 出生為同一屆，8/1 起算新學年。這是年齡對照，不代表已報名或入學。</p>
          <p>「沒有生日資料」是舊案只填了年齡、補登時沒問生日，或已依保存政策匿名化。</p>
        </AnalyticsExplainer>
      </template>
    </div>
  </section>
</template>

<style scoped>
.classes.is-updating {
  opacity: 0.6;
}

.classes__head {
  flex-wrap: wrap;
  gap: 8px 12px;
}

.classes__year :deep(.el-select) {
  width: 140px;
}

.classes__body {
  display: grid;
  gap: 8px;
}

.classes__body > .hint,
.classes__body > .field-help {
  margin: 0;
}
</style>
