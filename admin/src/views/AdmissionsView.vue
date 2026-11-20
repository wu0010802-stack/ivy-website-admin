<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AdmissionsFilterBar from '../components/admissions/AdmissionsFilterBar.vue'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import { lazyComponent } from '../composables/lazyComponent'
import { useAdmissionsAvailability } from '../admissions/useAdmissionsAvailability'
import { isAdmissionsTab, useAdmissionsFilters } from '../admissions/useAdmissionsFilters'

// 招生入學（規格第 10 節）：頁首放校區與入學學年學期，分頁順序比照園務。2026-10-05 拿掉名額規劃與
// 官網預約兩個分頁（和園務分歧）：確認到場改在案件列表的「只看尚未確認到場」。2026-10-06 拿掉
// 官網延伸的「待追蹤」分頁：下次聯絡、負責人改在訪視明細的「追蹤」「負責人」篩選看。
// 2026-10-16 統計分析抽成獨立的「招生統計」頁（AdmissionsStatsView，限總管理者），這裡只剩漏斗看板與訪視明細。
// 2026-11-16 編班與缺額的分頁名後面掛 Beta 標籤（還在試用，業主要求）；拿掉時連同三個單元測試與 stack 的分頁文字一起改回。
// 只掛載目前分頁，切回來時重新讀資料；各分頁自己用 useRequestSequence 擋舊回應。
// 預設是漏斗看板：訪視明細切過去才下載。
const RecordsTab = lazyComponent(() => import('../components/admissions/RecordsTab.vue'))
const RosterTab = lazyComponent(() => import('../components/admissions/roster/RosterTab.vue'))
const {
  campus, schoolYear, semester, tab, visitRequestId, month, area, withdraw, openRecordId, visibleCampusKeys, defaultYear, clearTerm,
} = useAdmissionsFilters()
const availability = useAdmissionsAvailability(campus)

function setTab(name: string | number) {
  if (isAdmissionsTab(name)) tab.value = name
}
// 使用者主動換校：vr 是某一校的預約 id，換校後清掉。不放在 useAdmissionsFilters：
// 預約明細的連結同時帶 campus 與 vr，從網址進來兩者都要保留。
function setCampus(value: string) {
  if (value !== campus.value) visitRequestId.value = ''
  campus.value = value
}
// 看板「另有 N 筆沒有填入學學期」→ 到訪視明細，並清掉學年學期篩選（園務 showUnscopedVisits）。
function showUnscoped() {
  clearTerm()
  tab.value = 'records'
}
</script>

<template>
  <div class="page admissions">
    <PageHeader lead="家長參觀之後的預繳與註冊追蹤。" />

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號還沒有負責的校區，請總管理者到「使用者」設定負責校區。" />
    <el-empty v-else-if="availability === 'off'" description="招生入學尚未啟用">
      <p class="admissions__off">開啟後這裡會出現漏斗看板與訪視明細。</p>
    </el-empty>
    <template v-else-if="availability === 'on'">
      <AdmissionsFilterBar
        v-model:school-year="schoolYear"
        v-model:semester="semester"
        :campus="campus"
        :campus-keys="visibleCampusKeys"
        :default-year="defaultYear"
        :hide-semester="tab === 'roster'"
        @update:campus="setCampus"
      />

      <el-tabs :model-value="tab" class="admissions__tabs" @update:model-value="setTab">
        <el-tab-pane label="漏斗看板" name="funnel" />
        <el-tab-pane label="訪視明細" name="records" />
        <el-tab-pane name="roster">
          <template #label>編班與缺額<el-tag class="admissions__beta" size="small" type="primary" effect="light" round disable-transitions>Beta</el-tag></template>
        </el-tab-pane>
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
          v-model:area="area"
          v-model:withdrawCategory="withdraw"
          v-model:openRecordId="openRecordId"
          :campus-key="campus"
          :school-year="schoolYear"
          :semester="semester"
          @clear-term="clearTerm"
        />
        <RosterTab v-if="tab === 'roster'" :campus-key="campus" :school-year="schoolYear" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.admissions__tabs {
  margin-bottom: 8px;
}

/* 分頁頭只當切換用，內容由下方各分頁元件自己畫。 */
.admissions__tabs :deep(.el-tabs__content) {
  display: none;
}

/* 分頁名後面的 Beta 標籤：顏色走 el-tag 的 primary（操作色），這裡只管間距與對齊。 */
.admissions__beta {
  margin-left: 6px;
  vertical-align: 1px;
}

/* 320px 寬的手機：加了 Beta 之後三個分頁會多出約 22px，Element Plus 會改成左右箭頭捲動、把目前分頁切掉；
   把分頁之間的留白收一點就放得下（360px 以上本來就放得下，不動）。 */
@media (max-width: 359px) {
  .admissions__tabs :deep(.el-tabs__item) {
    padding-inline: 12px;
  }

  .admissions__tabs :deep(.el-tabs__item:nth-child(2)) {
    padding-inline-start: 0;
  }

  .admissions__tabs :deep(.el-tabs__item:last-child) {
    padding-inline-end: 0;
  }
}

.admissions__off {
  margin: 0;
  color: var(--ink-3);
}

.admissions__body {
  min-width: 0;
}
</style>
