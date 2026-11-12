<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContentInterestPanel from '../components/ContentInterestPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'
import {
  ANALYTICS_DAY_OPTIONS, ANALYTICS_DEVICE_OPTIONS, ANALYTICS_TABS, DEFAULT_ANALYTICS_DAYS, DEFAULT_ANALYTICS_DEVICE, DEFAULT_ANALYTICS_TAB,
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
const device = queryChoice<AnalyticsDevice>('device', ANALYTICS_DEVICE_OPTIONS.map((item) => item.value), DEFAULT_ANALYTICS_DEVICE)

// 後三類共用同一個內容興趣面板（同一份資料）。兩個面板一進頁就各自讀好，換分類只是切換顯示；
// 在看「瀏覽與速度」時，內容興趣停在上一次看的那一類，不跟著重排。
const onInterest = computed(() => tab.value !== 'traffic')
const interestView = ref<InterestView>(tab.value === 'traffic' ? 'content' : tab.value)
watch(tab, (value) => {
  if (value !== 'traffic') interestView.value = value
})

// 只提示正在看的那一類：另一類在背景重讀不用寫出來。
const updating = reactive({ traffic: false, interest: false })
const statusText = computed(() => ((onInterest.value ? updating.interest : updating.traffic) ? '更新中…' : ''))
</script>

<template>
  <div class="page analytics">
    <PageHeader
      lead="官網有多少人看、看了什麼、從哪裡來、有沒有走到預約，全站五校合計。"
      more="各校參觀預約的結果（五校比較、到場與取消、每日變化、來源與預約鈕點擊）與預約孩子的班別，在「招生統計 → 參觀預約」（限總管理者）。"
    />

    <div class="analytics__bar">
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
      <div class="analytics__filters">
        <span class="hint analytics__status" role="status">{{ statusText }}</span>
        <el-select v-if="onInterest" v-model="device" class="analytics__device" aria-label="要看哪一種裝置的造訪" data-test="analytics-device">
          <el-option v-for="option in ANALYTICS_DEVICE_OPTIONS" :key="option.value" :value="option.value" :label="option.label" />
        </el-select>
        <el-radio-group v-model="days" class="analytics__days" aria-label="統計的期間">
          <el-radio-button v-for="option in ANALYTICS_DAY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <SiteTrafficPanel v-show="!onInterest" :days="days" @updating="updating.traffic = $event" />
    <ContentInterestPanel v-show="onInterest" :days="days" :device="device" :view="interestView" @updating="updating.interest = $event" />
  </div>
</template>

<style scoped>
/* 分類在左、條件在右；放不下時條件整組換到下一行靠右。 */
.analytics__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 20px;
}

.analytics__tabs {
  margin-bottom: 0;
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
  .analytics__tabs {
    width: 100%;
  }

  /* 四類排成兩列兩欄，每一顆 44px 高。 */
  .analytics__tabs .status-tab {
    flex: 1 1 40%;
    justify-content: center;
    min-height: 44px;
  }

  .analytics__filters {
    flex-wrap: wrap;
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
    flex: 1 1 120px;
    width: auto;
  }

  .analytics__days {
    flex: 2 1 220px;
  }

  .analytics__days :deep(.el-radio-button) {
    flex: 1;
  }

  .analytics__days :deep(.el-radio-button__inner) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 44px;
  }

  .analytics__device :deep(.el-select__wrapper) {
    min-height: 44px;
  }
}
</style>
