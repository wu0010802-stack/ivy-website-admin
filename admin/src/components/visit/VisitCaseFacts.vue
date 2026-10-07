<script setup lang="ts">
import { computed } from 'vue'
import { ageLabel, consentRecordLabel, contactTimeLabel, formatDate, formatDateTime, partySizeLabel, referralSourceLabels } from '../../api/labels'
import { injectVisitCase } from '../../composables/useVisitCase'

// 家長資料表（2026-10-06 方向 C）：壓成一張兩欄表，孩子姓名與生日併一行。官網沒有的欄位（參觀人數、年齡、
// 方便時段、想了解的事、同意紀錄）只有舊資料或補登有值才列（第九輪）。家庭版面收合（家庭頁規格 5.3）。
// compact：預覽面板只列電話、孩子、Email。
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const vc = injectVisitCase()

interface Fact { label: string; text: string; href?: string; num?: boolean; pre?: boolean }

const facts = computed<Fact[]>(() => {
  const d = vc.detail
  if (!d) return []
  // 補登的姓名、生日各自選填：只有生日也要列出來。
  const child = [d.child_name, d.child_birthdate ? formatDate(d.child_birthdate) : ''].filter(Boolean).join('，') || '未填寫'
  const rows: Fact[] = [
    { label: '電話', text: d.phone, href: `tel:${d.phone}`, num: true },
    { label: '孩子', text: child },
    { label: 'Email', text: d.email || '未填寫', href: d.email ? `mailto:${d.email}` : undefined },
  ]
  if (props.compact) return rows
  rows.push({ label: '得知管道', text: referralSourceLabels(d.referral_sources) })
  if (d.party_size) rows.push({ label: '參觀人數', text: partySizeLabel(d.party_size) })
  if (d.age) rows.push({ label: '家長填的年齡', text: ageLabel(d.age) })
  if (d.preferred_time) rows.push({ label: '方便接電話時段', text: contactTimeLabel(d.preferred_time) })
  if (d.questions) rows.push({ label: '想了解的事', text: d.questions, pre: true })
  if (d.consent_given) rows.push({ label: '同意紀錄', text: consentRecordLabel(d) })
  if (vc.confirmedAtShown) rows.push({ label: '確認時間', text: formatDateTime(d.confirmed_at) })
  if (d.cancelled_at) rows.push({ label: '取消時間', text: formatDateTime(d.cancelled_at) })
  return rows
})
const collapsible = computed(() => Boolean(vc.familyVisit) && !props.compact)
const open = computed(() => !collapsible.value || vc.bookingDataOpen)
</script>

<template>
  <section v-if="vc.detail" class="panel detail__data case-facts">
    <div class="panel__head">
      <h2>{{ vc.bookingDataTitle }}</h2>
      <el-button
        v-if="collapsible"
        link
        type="primary"
        :aria-expanded="open ? 'true' : 'false'"
        aria-controls="visit-booking-data"
        @click="vc.bookingDataOpen = !vc.bookingDataOpen"
      >{{ open ? '收起' : '展開' }}</el-button>
      <span v-else class="hint">{{ vc.isWebCase ? '官網表單' : '園方補登' }}</span>
    </div>
    <dl v-show="open" id="visit-booking-data" class="case-facts__list">
      <template v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd :class="{ 'case-facts__pre': fact.pre }">
          <a v-if="fact.href" :href="fact.href" class="detail__link" :class="{ num: fact.num }">{{ fact.text }}</a>
          <template v-else>{{ fact.text }}</template>
        </dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.case-facts__list {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0;
  padding: 16px 20px;
}

.case-facts__list dt {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.case-facts__list dd {
  margin: 0;
  font-size: var(--text-base);
  overflow-wrap: anywhere;
}

.case-facts__pre {
  white-space: pre-wrap;
}

/* 觸控裝置的電話、Email 連結放大到 44px 好點。 */
@media (hover: none), (pointer: coarse) {
  .detail__link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}
</style>
