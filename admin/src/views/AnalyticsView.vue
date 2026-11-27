<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AnalyticsToc from '../components/analytics/AnalyticsToc.vue'
import BookingAttributionPanel from '../components/analytics/BookingAttributionPanel.vue'
import BusinessProfilePanel from '../components/analytics/BusinessProfilePanel.vue'
import ContactHoursPanel from '../components/analytics/ContactHoursPanel.vue'
import CrawlerPanel from '../components/analytics/CrawlerPanel.vue'
import MonthlyPanel from '../components/analytics/MonthlyPanel.vue'
import NotFoundPanel from '../components/analytics/NotFoundPanel.vue'
import StatsHealthBanner from '../components/analytics/StatsHealthBanner.vue'
import { searchPeriod } from '../api/googleInsights'
import ContentInterestPanel from '../components/ContentInterestPanel.vue'
import CruxPanel from '../components/CruxPanel.vue'
import LineInsightsPanel from '../components/LineInsightsPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import SearchInsightsPanel from '../components/SearchInsightsPanel.vue'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'
import { usePermissions } from '../composables/usePermissions'
import {
  ANALYTICS_DAY_OPTIONS, ANALYTICS_DEVICE_OPTIONS, ANALYTICS_SECTIONS, ANALYTICS_TABS, DEFAULT_ANALYTICS_DAYS, DEFAULT_ANALYTICS_DEVICE, DEFAULT_ANALYTICS_TAB,
  type AnalyticsDays, type AnalyticsDevice, type AnalyticsTab, type InterestView,
} from '../components/analytics/filters'

// 成效統計：官網瀏覽與速度＋內容興趣，全站合計、不分校區。
// 2026-11-12：11-11 加了內容興趣後，這一頁是 18 張表排成一長條（約 7,500px），兩段各有一個期間選單。
// 改成四類（各回答一個問題）、整頁共用一組期間與裝置；三個選擇都寫在網址（router.replace，不堆歷史），
// 重新整理、傳給同事打開是同一個畫面。分類沿用案件列表與小技巧頁的 status-tabs（放不下就換行）。
// 「各校預約」「預約孩子的班別」2026-10-13 搬到招生統計 → 參觀預約；舊連結的 ?tab=booking 回到第一類。
const route = useRoute()
const router = useRouter()

function queryChoice<T extends string | number>(name: string, allowed: readonly T[], fallback: T) {
  return computed<T>({
    get: () => {
      const raw = route.query[name]
      return allowed.find((value) => String(value) === raw) ?? fallback
    },
    set: (value) => {
      const query = { ...route.query }
      if (value === fallback) delete query[name]
      else query[name] = String(value)
      void router.replace({ query }).catch(() => {})
    },
  })
}

const tab = queryChoice<AnalyticsTab>('tab', ANALYTICS_TABS.map((item) => item.key), DEFAULT_ANALYTICS_TAB)
const days = queryChoice<AnalyticsDays>('days', ANALYTICS_DAY_OPTIONS.map((item) => item.value), DEFAULT_ANALYTICS_DAYS)
// 「走到預約」頁尾的網站來源讀預約案件，期間跟整頁同一段：早於成效統計起算日就從起算日開始，
// 同一類裡不會一張表寫 11/13 起、另一張寫 10/24 起（2026-11-20）。
const bookingRange = computed(() => {
  const { start, end } = searchPeriod(days.value)
  return { from: start, to: end }
})
const bookingPeriod = computed(() => `${bookingRange.value.from.replaceAll('-', '/')}–${bookingRange.value.to.replaceAll('-', '/')}`)
const device = queryChoice<AnalyticsDevice>('device', ANALYTICS_DEVICE_OPTIONS.map((item) => item.value), DEFAULT_ANALYTICS_DEVICE)

// 後三類共用同一個內容興趣面板（同一份資料）。兩個面板一進頁就各自讀好，換分類只是切換顯示；
// 在看「瀏覽與速度」時，內容興趣停在上一次看的那一類，不跟著重排。
// 2026-11-20 多了第五類「每月比較」：它自己一張表（一列一個月），不用期間與裝置選單。
const isInterestTab = (value: AnalyticsTab): value is InterestView => value !== 'traffic' && value !== 'monthly'
const onInterest = computed(() => isInterestTab(tab.value))
const onMonthly = computed(() => tab.value === 'monthly')
const interestView = ref<InterestView>(isInterestTab(tab.value) ? tab.value : 'content')
watch(tab, (value) => {
  if (isInterestTab(value)) interestView.value = value
})

// 只提示正在看的那一類：另一類在背景重讀不用寫出來。
// 2026-11-12 起兩個外部數據各掛在一類底下：Chrome 真實使用者（CrUX）在「瀏覽與速度」、Google 搜尋（Search Console）
// 在「怎麼來、怎麼逛」，切到那一類才向後端要（後端另有快取）。Google 搜尋跟著整頁的期間；CrUX 是 28 天滾動，
// 不隨期間變，所以不會有「更新中」。
// 這幾支外部數據的 API 要 admissions.stats_site（全站數字，只有總管理者有，backend/app/insights/routes.py）；
// 其他角色一律 403，面板會永遠停在「請重新載入」，所以沒有權限就不放（2026-11-12 QA M3）。
const { can } = usePermissions()
const showExternal = computed(() => can('admissions.stats_site'))
const updating = reactive({ traffic: false, interest: false, search: false })
const statusText = computed(() => {
  const busy =
    tab.value === 'traffic' ? updating.traffic
    : tab.value === 'journey' ? updating.interest || updating.search
    : updating.interest
  return busy ? '更新中…' : ''
})

// ---- 2026-11-26 第五輪：類內目次、換分類回到那一類的開頭 ----
// 黏住的頁首＋條件列底下那條線離視窗頂端多遠：目次捲到某一張表、換分類回到開頭，都讓內容停在這條線下面。
// 900px 以下條件列不黏，只算頁首。條件列的高度會變（視窗窄時條件換到第二行），所以每次現量。
const page = ref<HTMLElement | null>(null)
const bar = ref<HTMLElement | null>(null)
const contentStart = ref<HTMLElement | null>(null)
const DEFAULT_TOP_H = 64
const START_GAP = 20
function stickyLine(): number {
  const el = bar.value
  if (!el) return DEFAULT_TOP_H
  const topH = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || DEFAULT_TOP_H
  return getComputedStyle(el).position === 'sticky' ? topH + el.offsetHeight : topH
}
// 換分類時人常在頁面中段（條件列黏著）：新的那一類要從它開頭那一句答案看起，不是停在同樣的捲動位置
// （原本從「怎麼來、怎麼逛」3,000px 處換到「走到預約」，會落在最後面的「帶著記住的校區回來」）。
// 還在頁面最上面時不動。
watch(tab, async () => {
  await nextTick()
  const start = contentStart.value
  if (!start || window.scrollY <= 0) return
  // 開頭那一句和條件列之間留和平常一樣的間距（條件列的 margin-bottom）。
  const top = start.getBoundingClientRect().top - START_GAP
  const line = stickyLine()
  if (top < line) window.scrollTo({ top: Math.max(0, window.scrollY + top - line) })
})
// 用 Tab 走到被條件列蓋住的位置時，瀏覽器捲動要多留條件列的高度：高度寫成樣式變數，條件換行或目次出現時跟著變。
let barObserver: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !bar.value) return
  barObserver = new ResizeObserver(() => page.value?.style.setProperty('--analytics-bar-h', `${bar.value?.offsetHeight ?? 0}px`))
  barObserver.observe(bar.value)
})
onBeforeUnmount(() => barObserver?.disconnect())
</script>

<template>
  <div ref="page" class="page analytics">
    <PageHeader
      lead="官網有多少人看、看了什麼、從哪裡來、有沒有走到預約；全站五校合計。"
      more="「每月比較」可以和去年同月比。各校參觀預約的結果（五校比較、到場與取消、每日變化、來源與預約鈕點擊）與預約孩子的班別，在「招生統計 → 參觀預約」（限總管理者）。"
    />

    <StatsHealthBanner />
    <div ref="bar" class="analytics__bar">
      <div class="analytics__inner">
        <div class="analytics__row">
          <div class="status-tabs analytics__tabs" role="group" aria-label="要看哪一類統計">
            <button
              v-for="item in ANALYTICS_TABS"
              :key="item.key"
              type="button"
              class="status-tab"
              :class="{ 'is-active': tab === item.key }"
              :aria-pressed="tab === item.key"
              @click="tab = item.key"
            >{{ item.label }}</button>
          </div>
          <div v-if="!onMonthly" class="analytics__filters">
            <span class="hint analytics__status" role="status">{{ statusText }}</span>
            <el-select v-if="onInterest" v-model="device" class="analytics__device" aria-label="要看哪一種裝置的造訪" data-test="analytics-device">
              <el-option v-for="option in ANALYTICS_DEVICE_OPTIONS" :key="option.value" :value="option.value" :label="option.label" />
            </el-select>
            <el-radio-group v-model="days" class="analytics__days" aria-label="統計的期間">
              <el-radio-button v-for="option in ANALYTICS_DAY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <!-- 這一類有哪幾張表（2026-11-26）：點了捲到那一張，捲動時標出現在看到哪一張。 -->
        <AnalyticsToc class="analytics__toc" :sections="ANALYTICS_SECTIONS[tab]" :line="stickyLine" />
      </div>
    </div>
    <div ref="contentStart" class="analytics__start" aria-hidden="true" />

    <SiteTrafficPanel v-show="tab === 'traffic'" :days="days" @updating="updating.traffic = $event" />
    <CruxPanel v-if="showExternal" v-show="tab === 'traffic'" :active="tab === 'traffic'" />
    <!-- 找不到的網址、搜尋引擎與 AI 爬蟲（2026-11-20）：全站匿名計數，登入的帳號都看得到。 -->
    <NotFoundPanel v-show="tab === 'traffic'" :days="days" :active="tab === 'traffic'" />
    <CrawlerPanel v-show="tab === 'traffic'" :days="days" :active="tab === 'traffic'" />
    <ContentInterestPanel v-show="onInterest" :days="days" :device="device" :view="interestView" @updating="updating.interest = $event" />
    <BookingAttributionPanel v-if="showExternal && tab === 'convert'" :campus-key="null" :range="bookingRange" :period-label="bookingPeriod" />
    <ContactHoursPanel v-show="tab === 'convert'" :days="days" :active="tab === 'convert'" />
    <SearchInsightsPanel v-if="showExternal" v-show="tab === 'journey'" :days="days" :active="tab === 'journey'" @updating="updating.search = $event" />
    <!-- Google 商家檔案（2026-11-25）：按月、背景每天同步，不隨期間；同樣要 admissions.stats_site，接在 Google 搜尋後面。 -->
    <BusinessProfilePanel v-if="showExternal" v-show="tab === 'journey'" :active="tab === 'journey'" />
    <!-- LINE 好友與官網 LINE 按鈕（2026-11-16）：同樣要 admissions.stats_site，掛在「怎麼來、怎麼逛」。 -->
    <LineInsightsPanel v-if="showExternal" v-show="tab === 'journey'" :days="days" :active="tab === 'journey'" />
    <MonthlyPanel v-show="onMonthly" :active="onMonthly" />
  </div>
</template>

<style scoped>
/* 條件列：第一行分類在左、條件在右，第二行是這一類的目次（放不下一行時怎麼排，見下面的 @container 與 720px 以下）。
   整塊黏在頁首下面（2026-11-20）：一類有 1,400～8,000px，捲到中段也換得了分類與期間、看得到現在是哪一段。
   做法同招生統計的導覽列：底色用 box-shadow 往右鋪滿、clip-path 裁成一條（不用負邊距，不會多出橫向捲軸、不蓋到側欄）。 */
.analytics__bar {
  position: sticky;
  top: var(--top-h);
  z-index: 5;
  margin-bottom: 20px;
  padding-top: 10px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  box-shadow: 0 0 0 100vmax var(--surface-2);
  clip-path: inset(0 -100vmax 0 -28px);
  /* 條件列自己的寬度決定裡面怎麼排（見下面的 @container）：側欄收合與否內容區寬度差 196px，不能只看視窗寬度。 */
  container: analytics-bar / inline-size;
}

.analytics__inner {
  display: grid;
  gap: 4px;
}

.analytics__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  min-width: 0;
}

/* 目次那一排的底線疊在條件列的底線上（同招生統計的分頁列）。 */
.analytics__toc {
  margin-bottom: -1px;
}

/* 換分類時用來量「這一類從哪裡開始」的記號，不佔高度。 */
.analytics__start {
  height: 0;
}

/* 用 Tab 走到被黏住那一列蓋住的位置時，瀏覽器捲動要多留條件列的高度，焦點才不會藏在條件列底下。
   高度由頁面量好寫在 --analytics-bar-h（條件換行、目次出現時會變）。 */
@media (min-width: 901px) {
  .analytics :deep(:focus-visible) {
    scroll-margin-top: calc(var(--top-h) + var(--analytics-bar-h, 96px) + 12px);
  }
}

/* 桌機但內容區放不下「分類＋條件」一行（視窗約 1,150px 以下而且側欄展開）：條件不自己佔一行，
   改和目次同一行（目次在左、可左右捲，條件在右），黏住的高度維持兩行約 100px，不變成三行 144px。 */
@media (min-width: 901px) {
  @container analytics-bar (max-width: 899px) {
    .analytics__inner {
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: 16px;
    }

    .analytics__row {
      display: contents;
    }

    .analytics__tabs {
      grid-column: 1 / -1;
      justify-self: start;
    }

    .analytics__toc {
      grid-row: 2;
      grid-column: 1;
      align-self: end;
    }

    .analytics__filters {
      grid-row: 2;
      grid-column: 2;
      margin-left: 0;
      padding-bottom: 6px;
    }
  }
}

/* 900px 以下不黏：分類排成兩列、條件再一列、目次一列，加起來約 200px，會吃掉手機四分之一的畫面。 */
@media (max-width: 900px) {
  .analytics__bar {
    position: static;
    padding-top: 0;
    box-shadow: none;
    clip-path: none;
  }
}

.analytics__tabs {
  margin-bottom: 0;
}

/* 網站來源接在內容興趣面板後面：前一個兄弟不是 .panel，共用樣式的 .panel + .panel 間距吃不到，這裡補上。 */
.analytics > .attribution {
  margin-top: 20px;
}

.analytics__filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.analytics__device {
  width: 132px;
}

.analytics__days {
  flex-wrap: nowrap;
}

@media (max-width: 720px) {
  .analytics__row {
    gap: 8px;
  }

  /* 五類排成兩列：上面三顆、下面兩顆，每一顆 44px 高（2026-11-26；原本 2＋2＋1 三列，「每月比較」自己一列）。 */
  .analytics__tabs {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    width: 100%;
  }

  .analytics__tabs .status-tab {
    grid-column: span 2;
    justify-content: center;
    min-height: 44px;
    padding: 0 4px;
  }

  .analytics__tabs .status-tab:nth-child(n + 4) {
    grid-column: span 3;
  }

  /* 裝置與期間排同一列（原本各佔一列）：選單 1、期間 2 的比例，期間三顆平分。 */
  .analytics__filters {
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    margin-left: 0;
  }

  .analytics__status {
    flex-basis: 100%;
  }

  .analytics__status:empty {
    display: none;
  }

  .analytics__device {
    flex: 1 1 100px;
    width: auto;
    min-width: 0;
  }

  .analytics__days {
    flex: 2 1 190px;
    min-width: 0;
  }

  .analytics__days :deep(.el-radio-button) {
    flex: 1;
    min-width: 0;
  }

  .analytics__days :deep(.el-radio-button__inner) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 44px;
    padding-inline: 4px;
  }

  .analytics__device :deep(.el-select__wrapper) {
    min-height: 44px;
    padding-inline: 10px;
  }
}

/* 很窄的手機（360px 以下）：「怎麼來、怎麼逛」七個字要放進三分之一寬，字小一階。 */
@media (max-width: 380px) {
  .analytics__tabs .status-tab {
    padding: 0 2px;
    font-size: var(--text-sm);
  }
}
</style>
