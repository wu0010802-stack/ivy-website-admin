<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import AdmissionsFilterBar from '../components/admissions/AdmissionsFilterBar.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import { useAdmissionsAvailability } from '../admissions/useAdmissionsAvailability'
import { useAdmissionsFilters } from '../admissions/useAdmissionsFilters'
import { conditionsOf } from '../admissions/statsNav'

// 招生統計（2026-10-16 業主裁定）：原本是招生入學的「統計分析」分頁，抽成獨立的側欄頁，只有總管理者
// 與被授權的分校管理者看得到（側欄與路由看 effective_capabilities；後端 admissions.stats 才是真正的檢查）。內容不變，頁首的校區與入學學年學期
// 同招生入學，網址參數也同名（campus／sy／sem），兩頁之間帶得過去；子分頁與預約全程的篩選也寫在網址。
// 區域分析的地圖模式、選取的里與表格分頁（areaView）同樣寫在網址。
// 招生開關關閉時同招生入學，顯示「尚未啟用」。
const { campus, schoolYear, semester, sub, journey, areaView, visibleCampusKeys, defaultYear } = useAdmissionsFilters('stats')
const availability = useAdmissionsAvailability(campus)
const route = useRoute()
const router = useRouter()

// 頁首條件只出現在目前分頁用得到的（2026-11-20，見 statsNav.ts）：不分入學學年學期的分頁（參觀預約、預約全程、
// 招生潛力、資料匯入）不顯示學年學期，五校一起看的分頁（五校比較、廣告成效）不顯示校區。值保留，切回去還在。
// 條件列放進 StatsTab 黏住的導覽列（#filters），和分類、分頁同一塊。
const conditions = computed(() => conditionsOf(sub.value))

// 統計的警示與行動入口「查看本月明細」、區域分析與退出原因分佈的「查看明細」：到招生入學的訪視明細，
// 帶校區、學年學期，以及月份、區域或退出原因（呼叫端只給其中一個，不疊成更窄的範圍）。
// 用 push 不用 replace：看完明細按上一頁回到統計離開時的子分頁。
// 五校周邊環境表點校區名：切到那一校的區域分析（網址由 useAdmissionsFilters 同步；換校區時選取的里會清掉）。
function openArea(campusKey: string) {
  campus.value = campusKey
  sub.value = 'area'
}

// 未預繳明細的「查看」另外帶那一筆的 id（open）：到了訪視明細直接開那一筆，不必再找一次人。
function openRecords(filter: { month?: string; area?: string; withdraw?: string; open?: string }) {
  const query: LocationQuery = {}
  for (const key of ['campus', 'sy', 'sem']) if (route.query[key] !== undefined) query[key] = route.query[key]!
  query.tab = 'records'
  if (filter.month) query.month = filter.month
  if (filter.area) query.area = filter.area
  if (filter.withdraw) query.wr = filter.withdraw
  if (filter.open) query.open = filter.open
  void router.push({ path: '/admissions', query })
}
</script>

<template>
  <div class="page admissions-stats">
    <el-empty v-if="availability === 'off'" description="招生入學尚未啟用">
      <p class="admissions-stats__off">開啟後這裡會出現招生與參觀預約的統計。</p>
    </el-empty>
    <template v-else-if="availability === 'on'">
      <StatsTab
        v-model:sub="sub"
        v-model:journey="journey"
        v-model:area-view="areaView"
        :campus-key="campus"
        :school-year="schoolYear"
        :semester="semester"
        :campus-keys="visibleCampusKeys"
        @open-records="openRecords"
        @open-area="openArea"
      >
        <template #filters>
          <AdmissionsFilterBar
            v-model:campus="campus"
            v-model:school-year="schoolYear"
            v-model:semester="semester"
            :campus-keys="visibleCampusKeys"
            :default-year="defaultYear"
            :hide-campus="!conditions.campus"
            :hide-term="!conditions.term"
            compact
          />
        </template>
      </StatsTab>
    </template>
  </div>
</template>

<style scoped>
.admissions-stats__off {
  margin: 0;
  color: var(--ink-3);
}
</style>
