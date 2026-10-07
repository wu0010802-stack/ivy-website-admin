<script setup lang="ts">
import { computed } from 'vue'
import { Phone } from '@element-plus/icons-vue'
import { campusLabel, formatDateTime, formatSlotWhen, staffEmailById, staffLabelById, visitSourceLabel } from '../../api/labels'
import { stageMeta } from '../../admissions/constants'
import { arrivedLabel } from '../../admissions/family'
import { injectVisitCase } from '../../composables/useVisitCase'
import { relativeVisitTime } from '../../utils/visitSchedule'
import StatusTag from '../StatusTag.vue'
import VisitPrimaryAction from './VisitPrimaryAction.vue'

// 案件頁首（2026-10-06 方向 C）：家長・孩子、來源與最後處理、參觀時間與「結束了多久」、預定聯絡、
// 狀態；右邊（窄螢幕在下面）是撥號與這個階段的主動作。預覽面板用 compact：標題小一級、按鈕整排在下面。
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const vc = injectVisitCase()

// 只對預約正常的案件寫相對時間；結束後暖黃（還沒標記到場）。
const relative = computed(() => {
  const d = vc.detail
  if (!d?.slot || d.status !== 'confirmed') return null
  const result = relativeVisitTime(d.slot, vc.clockNow)
  return result.text ? result : null
})
const source = computed(() => {
  const d = vc.detail
  return d?.source && d.source !== 'web' ? `${visitSourceLabel(d.source)}補登` : '官網送出'
})
</script>

<template>
  <header v-if="vc.detail" class="detail__head case-hero" :class="{ 'case-hero--compact': compact }">
    <div class="case-hero__main">
      <h2 class="detail__title">{{ vc.detail.parent_name }}<span v-if="vc.detail.child_name" class="case-hero__child">・{{ vc.detail.child_name }}</span></h2>
      <p class="hint case-hero__sub">
        {{ campusLabel(vc.detail.campus_key) }}・{{ formatDateTime(vc.detail.created_at) }} {{ source }}<template v-if="vc.detail.created_by">（<span :title="staffEmailById(vc.detail.created_by, vc.staff) || undefined">{{ staffLabelById(vc.detail.created_by, vc.staff) }}</span> 登錄）</template>
      </p>
      <p v-if="vc.handled" class="hint detail__handled">最後處理：{{ vc.handled.who }}・{{ formatDateTime(vc.handled.at) }}・{{ vc.handled.what }}</p>
      <p v-if="vc.detail.related_request_id" class="hint">
        重新預約自 <router-link :to="`/visit-requests/${vc.detail.related_request_id}`">先前的案件</router-link>
      </p>
      <p v-if="vc.detail.slot" class="detail__when">
        <!-- 上一行是送出時間，這一行是參觀時間：兩個日期都沒有前綴，報讀要能分辨。 -->
        <span class="visually-hidden">參觀時間：</span>
        <span class="num">{{ formatSlotWhen(vc.detail.slot) }}</span>
        <small v-if="relative" class="case-hero__relative" :data-tone="relative.tone">{{ relative.text }}</small>
      </p>
      <p v-if="vc.detail.follow_up_at && vc.followUpTracked" class="detail__follow" :class="{ 'is-due': vc.followUpDue }">
        {{ vc.followUpDue ? '已到預定聯絡時間' : '預定聯絡' }} {{ formatDateTime(vc.detail.follow_up_at) }}
      </p>
    </div>
    <div class="case-hero__side">
      <div v-if="vc.familyPending" class="detail__status-pending" aria-hidden="true" />
      <div v-else-if="vc.familyVisit" class="detail__status">
        <StatusTag :meta="stageMeta(vc.familyVisit)" size="large" />
        <span class="detail__status-sub num">{{ arrivedLabel(vc.familyVisit.visit_date) }}</span>
      </div>
      <div v-else-if="vc.statusDisplay" class="detail__status">
        <StatusTag :meta="vc.statusDisplay" size="large" />
        <span v-if="vc.statusDisplay.sub" class="detail__status-sub" :data-tone="vc.statusDisplay.tone">{{ vc.statusDisplay.sub }}</span>
      </div>
      <VisitPrimaryAction :plain="compact" />
      <el-button
        v-if="vc.callPhone && !vc.familyPending"
        tag="a"
        :href="`tel:${vc.callPhone}`"
        link
        type="primary"
        :icon="Phone"
        class="detail__call"
        :aria-label="`撥號給家長 ${vc.callPhone}`"
      >撥號</el-button>
    </div>
  </header>
</template>

<style scoped>
.case-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 24px;
  margin-bottom: 24px;
}

.case-hero__main {
  flex: 1 1 320px;
  min-width: 0;
}

.detail__title {
  font-size: var(--text-4xl);
  line-height: 1.25;
}

.case-hero__sub {
  margin-top: 4px;
}

.detail__when {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin-top: 10px;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--ink);
}

.case-hero__relative {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--ink-2);
}

.case-hero__relative[data-tone='ended'] {
  color: var(--brand-gold-ink);
}

.case-hero__relative[data-tone='live'] {
  color: var(--status-live-ink);
}

.detail__follow {
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.detail__follow.is-due {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.case-hero__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  margin-left: auto;
}

.detail__status {
  display: grid;
  justify-items: end;
  gap: 4px;
}

.detail__status-sub {
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.detail__status-sub[data-tone='warning'] {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}

.detail__call {
  min-height: 32px;
}

.case-hero--compact {
  margin-bottom: 0;
  padding: 16px 20px;
}

.case-hero--compact .detail__title {
  font-size: var(--text-xl);
}

.case-hero--compact .detail__when {
  font-size: var(--text-base);
}

.case-hero--compact .case-hero__side {
  width: 100%;
  margin-left: 0;
  align-items: stretch;
}

.case-hero--compact .detail__status {
  justify-items: start;
}

@media (max-width: 900px) {
  .detail__title {
    font-size: var(--text-3xl);
  }

  .case-hero__side {
    width: 100%;
    margin-left: 0;
    align-items: stretch;
  }

  .detail__status {
    justify-items: start;
  }

  .detail__call {
    min-height: 44px;
  }
}
</style>
