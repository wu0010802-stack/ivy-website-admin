<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import IntakePlanTab from '../components/admissions/IntakePlanTab.vue'
import ArrivalsTab from '../components/admissions/ArrivalsTab.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { getArrivals, getOptions } from '../api/admissions'
import { ApiError } from '../api/client'
import { usePermissions } from '../composables/usePermissions'
import { useRequestSequence } from '../composables/useRequestSequence'
import { schoolYearOptions } from '../admissions/academic'
import { SEMESTER_LABELS } from '../admissions/constants'
import { isAdmissionsTab, useAdmissionsFilters, type AdmissionsTab, type Semester } from '../admissions/useAdmissionsFilters'

// 招生入學（規格第 10 節）：頁首放校區與入學學年學期，五個分頁順序比照園務。
// 只掛載目前分頁，切回來時重新讀資料；各分頁自己用 useRequestSequence 擋舊回應。
const { campus, schoolYear, semester, tab, visitRequestId, month, visibleCampusKeys, defaultYear, clearTerm } = useAdmissionsFilters()
const { can } = usePermissions()
// 官網預約分頁讀 /admin/admissions/arrivals，需要 booking.read。
const canSeeArrivals = computed(() => can('booking.read'))
const multiCampus = computed(() => visibleCampusKeys.value.length > 1)
// 園務看板的學年選項：明年、今年、前一年、前兩年。
const yearOptions = computed(() => schoolYearOptions(defaultYear, [1, 0, -1, -2]))

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

// 「官網預約」分頁標籤上的待確認筆數（awaiting_total，清單最多 200 筆）；切校時只採用最後一次的結果。
const arrivalsCount = ref<number | null>(null)
const arrivalsRequests = useRequestSequence()
async function loadArrivalsCount() {
  arrivalsCount.value = null
  if (!campus.value || !canSeeArrivals.value) return
  const request = arrivalsRequests.begin()
  try {
    const result = await getArrivals(campus.value)
    if (arrivalsRequests.isCurrent(request)) arrivalsCount.value = result.awaiting_total
  } catch {
    // 數字只是提醒；讀不到就不顯示，分頁裡會再顯示錯誤。
  }
}
watch(campus, async (key) => {
  arrivalsCount.value = null
  arrivalsRequests.begin()
  await checkAvailability()
  if (campus.value === key && availability.value === 'on') await loadArrivalsCount()
}, { immediate: true })

// 沒有 booking.read 的人從網址帶 tab=arrivals 進來：退回漏斗看板。
watch([tab, canSeeArrivals], () => {
  if (tab.value === 'arrivals' && !canSeeArrivals.value) tab.value = 'funnel'
}, { immediate: true })

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
function goTab(next: AdmissionsTab) {
  tab.value = next
}
// 看板「另有 N 筆沒有填入學學期」→ 到訪視明細，並清掉學年學期篩選（園務 showUnscopedVisits）。
function showUnscoped() {
  clearTerm()
  tab.value = 'records'
}
// 官網預約分頁讀完清單會回報待確認筆數；標記到場後標籤上的數字跟著變。
function onArrivalsCount(count: number) {
  arrivalsCount.value = count
}
</script>

<template>
  <div class="page admissions">
    <PageHeader lead="參觀 → 預繳 → 註冊 ｜ 退預繳／退註冊 · 統計分析" />

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號還沒有負責的校區，請總管理者到「使用者」設定負責校區。" />
    <el-empty v-else-if="availability === 'off'" description="招生入學尚未啟用">
      <p class="admissions__off">開啟後這裡會出現漏斗看板、訪視明細、名額規劃與官網預約。</p>
    </el-empty>
    <template v-else-if="availability === 'on'">
      <div class="toolbar admissions__filters">
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
        <el-tab-pane label="名額規劃" name="intake" />
        <el-tab-pane v-if="canSeeArrivals" name="arrivals">
          <template #label>官網預約<span v-if="arrivalsCount" class="admissions__count num">{{ arrivalsCount }}</span></template>
        </el-tab-pane>
        <el-tab-pane label="統計分析" name="stats" />
      </el-tabs>

      <div class="admissions__body">
        <FunnelBoard v-if="tab === 'funnel'" :campus-key="campus" :school-year="schoolYear" :semester="semester" @show-unscoped="showUnscoped" />
        <RecordsTab
          v-if="tab === 'records'"
          v-model:month="month"
          v-model:visitRequestId="visitRequestId"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          @clear-term="clearTerm"
        />
        <IntakePlanTab v-if="tab === 'intake'" :campus-key="campus" :school-year="schoolYear" :semester="semester" />
        <ArrivalsTab v-if="tab === 'arrivals' && canSeeArrivals" :campus-key="campus" @count="onArrivalsCount" />
        <StatsTab v-if="tab === 'stats'" :campus-key="campus" :school-year="schoolYear" :semester="semester" @go="goTab" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.admissions__filters .el-select {
  width: 140px;
}

.admissions__tabs {
  margin-bottom: 8px;
}

/* 分頁頭只當切換用，內容由下方各分頁元件自己畫。 */
.admissions__tabs :deep(.el-tabs__content) {
  display: none;
}

.admissions__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--el-color-warning-light-8);
  color: var(--brand-gold-ink);
  font-size: 12px;
  font-weight: 600;
}

.admissions__off {
  margin: 0;
  color: var(--ink-3);
}

.admissions__body {
  min-width: 0;
}
</style>
