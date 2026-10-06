<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { campusLabel } from '../api/labels'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { useRoute, useRouter } from 'vue-router'
import { getOptions } from '../api/admissions'
import { ApiError } from '../api/client'
import { useRequestSequence } from '../composables/useRequestSequence'
import { schoolYearOptions } from '../admissions/academic'
import { SEMESTER_LABELS } from '../admissions/constants'
import { isAdmissionsTab, useAdmissionsFilters, type Semester } from '../admissions/useAdmissionsFilters'

// 招生入學（規格第 10 節）：頁首放校區與入學學年學期，分頁順序比照園務。2026-10-05 拿掉名額規劃與
// 官網預約兩個分頁（和園務分歧）：確認到場改在案件列表的「只看尚未確認到場」。2026-10-06 拿掉
// 官網延伸的「待追蹤」分頁：下次聯絡、負責人改在訪視明細的「追蹤」「負責人」篩選看。
// 只掛載目前分頁，切回來時重新讀資料；各分頁自己用 useRequestSequence 擋舊回應。
const {
  campus, schoolYear, semester, tab, visitRequestId, month, sub, visibleCampusKeys, defaultYear, clearTerm,
} = useAdmissionsFilters()
const route = useRoute()
const router = useRouter()

// 統計的警示與行動入口「查看本月明細」：切到訪視明細並帶月份（B2 的明細讀網址的 month）。
// 用 push 不用 replace：看完明細按上一頁回到統計。
function openRecords(filter: { month: string }) {
  void router.push({ query: { ...route.query, tab: 'records', month: filter.month } })
}
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)
// 學年選項取新增／編輯表單（+3…−1）與原本頁首（+1…−2）的聯集：入學學年填到後年、大後年的訪視也選得到。
const yearOptions = computed(() => schoolYearOptions(defaultYear, [3, 2, 1, 0, -1, -2]))

// 招生開關（WEBSITE_ADMISSIONS_ENABLED）：關閉時後端整組 /admin/admissions/* 回 404。
// 選定校區後先讀 options 判定：404 顯示「尚未啟用」空狀態，其他錯誤照常掛分頁
// （各分頁自己處理錯誤）。換校區重新判定，舊回應用 useRequestSequence 擋掉。
const availability = ref<'checking' | 'on' | 'off'>('checking')
const availabilityRequests = useRequestSequence()
async function checkAvailability() {
  if (!campus.value) return
  const request = availabilityRequests.begin()
  try {
    await getOptions(campus.value)
    if (availabilityRequests.isCurrent(request)) availability.value = 'on'
  } catch (err) {
    if (availabilityRequests.isCurrent(request)) availability.value = err instanceof ApiError && err.status === 404 ? 'off' : 'on'
  }
}

watch(campus, () => void checkAvailability(), { immediate: true })

// 手機：三個篩選收成一顆摘要鈕，點開才出現（390px 疊起來會占掉半個首屏）。
const narrow = useNarrowScreen()
const filtersOpen = ref(false)
const filterSummary = computed(() => {
  const parts: string[] = []
  if (multiCampus.value) parts.push(campusLabel(campus.value))
  parts.push(schoolYear.value === null ? '不限學年' : `${schoolYear.value} 學年`, semester.value ? SEMESTER_LABELS[semester.value] : '整學年')
  return parts.join('・')
})

function setTab(name: string | number) {
  if (isAdmissionsTab(name)) tab.value = name
}
// 使用者主動換校：vr 是某一校的預約 id，換校後清掉。不放在 useAdmissionsFilters：
// 預約明細的連結同時帶 campus 與 vr，從網址進來兩者都要保留。
function setCampus(value: string) {
  if (value !== campus.value) visitRequestId.value = ''
  campus.value = value
}
function setYear(value: number | null | undefined) {
  schoolYear.value = value ?? null
}
function setSemester(value: Semester | null | undefined) {
  semester.value = value ?? null
}
// 看板「另有 N 筆沒有填入學學期」→ 到訪視明細，並清掉學年學期篩選（園務 showUnscopedVisits）。
function showUnscoped() {
  clearTerm()
  tab.value = 'records'
}
</script>

<template>
  <div class="page admissions">
    <PageHeader lead="家長參觀之後的預繳、註冊追蹤與統計。" />

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號還沒有負責的校區，請總管理者到「使用者」設定負責校區。" />
    <el-empty v-else-if="availability === 'off'" description="招生入學尚未啟用">
      <p class="admissions__off">開啟後這裡會出現漏斗看板、訪視明細與統計分析。</p>
    </el-empty>
    <template v-else-if="availability === 'on'">
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
          <CampusSelect :model-value="campus" :keys="visibleCampusKeys" @update:model-value="setCampus" />
        </div>
        <div class="filter-field">
          <span>入學學年</span>
          <el-select :model-value="schoolYear ?? undefined" clearable placeholder="不限學年" aria-label="入學學年" @update:model-value="setYear">
            <el-option v-for="year in yearOptions" :key="year" :label="`${year} 學年`" :value="year" />
          </el-select>
        </div>
        <div class="filter-field">
          <span>入學學期</span>
          <el-select :model-value="semester ?? undefined" clearable placeholder="整學年" aria-label="入學學期" @update:model-value="setSemester">
            <el-option :value="1" :label="SEMESTER_LABELS[1]" />
            <el-option :value="2" :label="SEMESTER_LABELS[2]" />
          </el-select>
        </div>
      </div>

      <el-tabs :model-value="tab" class="admissions__tabs" @update:model-value="setTab">
        <el-tab-pane label="漏斗看板" name="funnel" />
        <el-tab-pane label="訪視明細" name="records" />
        <el-tab-pane label="統計分析" name="stats" />
      </el-tabs>

      <div class="admissions__body">
        <FunnelBoard
          v-if="tab === 'funnel'"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          @show-unscoped="showUnscoped"
        />
        <RecordsTab
          v-if="tab === 'records'"
          v-model:month="month"
          v-model:visitRequestId="visitRequestId"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          @clear-term="clearTerm"
        />
        <StatsTab
          v-if="tab === 'stats'"
          v-model:sub="sub"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          :campus-keys="visibleCampusKeys"
          @open-records="openRecords"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.admissions__filters .el-select {
  width: 140px;
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

.admissions__tabs {
  margin-bottom: 8px;
}

/* 分頁頭只當切換用，內容由下方各分頁元件自己畫。 */
.admissions__tabs :deep(.el-tabs__content) {
  display: none;
}

.admissions__off {
  margin: 0;
  color: var(--ink-3);
}

.admissions__body {
  min-width: 0;
}
</style>
