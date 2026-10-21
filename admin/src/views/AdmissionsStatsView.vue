<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import AdmissionsFilterBar from '../components/admissions/AdmissionsFilterBar.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { useAdmissionsAvailability } from '../admissions/useAdmissionsAvailability'
import { useAdmissionsFilters } from '../admissions/useAdmissionsFilters'

// 招生統計（2026-10-16 業主裁定）：原本是招生入學的「統計分析」分頁，抽成獨立的側欄頁，只有總管理者
// 看得到（側欄與路由 roles；後端 admissions.stats 才是真正的檢查）。內容不變，頁首的校區與入學學年學期
// 同招生入學，網址參數也同名（campus／sy／sem），兩頁之間帶得過去；子分頁與預約全程的篩選也寫在網址。
// 區域分析的地圖模式、選取的里與表格分頁（areaView）同樣寫在網址。
// 招生開關關閉時同招生入學，顯示「尚未啟用」。
const { campus, schoolYear, semester, sub, journey, areaView, visibleCampusKeys, defaultYear } = useAdmissionsFilters('stats')
const availability = useAdmissionsAvailability(campus)
const route = useRoute()
const router = useRouter()

// 「參觀預約」看預約案件的送出日或事件日，不分入學學年學期：兩個下拉停用（值保留，切回其他子分頁
// 還在），期間在子分頁裡選。預約全程同理（看預定參觀日）；招生潛力與市佔率列出所有學年，也不分；資料匯入是整校取代，也不分。
const termless = computed(() => sub.value === 'booking' || sub.value === 'journey' || sub.value === 'potential' || sub.value === 'imports')

// 統計的警示與行動入口「查看本月明細」、區域分析與退出原因分佈的「查看明細」：到招生入學的訪視明細，
// 帶校區、學年學期，以及月份、區域或退出原因（呼叫端只給其中一個，不疊成更窄的範圍）。
// 用 push 不用 replace：看完明細按上一頁回到統計離開時的子分頁。
function openRecords(filter: { month?: string; area?: string; withdraw?: string }) {
  const query: LocationQuery = {}
  for (const key of ['campus', 'sy', 'sem']) if (route.query[key] !== undefined) query[key] = route.query[key]!
  query.tab = 'records'
  if (filter.month) query.month = filter.month
  if (filter.area) query.area = filter.area
  if (filter.withdraw) query.wr = filter.withdraw
  void router.push({ path: '/admissions', query })
}
</script>

<template>
  <div class="page admissions-stats">
    <PageHeader lead="招生與參觀預約的統計：轉換、班別、來源、接待、區域與未預繳原因。" />

    <el-empty v-if="availability === 'off'" description="招生入學尚未啟用">
      <p class="admissions-stats__off">開啟後這裡會出現招生與參觀預約的統計。</p>
    </el-empty>
    <template v-else-if="availability === 'on'">
      <AdmissionsFilterBar
        v-model:campus="campus"
        v-model:school-year="schoolYear"
        v-model:semester="semester"
        :campus-keys="visibleCampusKeys"
        :default-year="defaultYear"
        :termless="termless"
      />
      <div class="admissions-stats__body">
        <StatsTab
          v-model:sub="sub"
          v-model:journey="journey"
          v-model:area-view="areaView"
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
.admissions-stats__off {
  margin: 0;
  color: var(--ink-3);
}

.admissions-stats__body {
  min-width: 0;
}
</style>
