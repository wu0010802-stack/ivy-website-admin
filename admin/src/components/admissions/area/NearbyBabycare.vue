<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { AreaBabycare } from '../../../api/types'
import {
  babycareFeeText, babycareKindLabel, babycareMeta, babycareShortName, babycareSummaryText, campusNotLocatedReason, taipeiMonthDay,
  type RadiusKm,
} from './areaFormat'

// 附近托嬰中心（2026-10-14 規格 7.1）：本校半徑內營業中的托嬰中心與公共托育家園，後端已依距離排序。
// 行為同附近幼兒園：點一列展開地址與電話，同時請地圖移過去並打開該機構資訊（select）；再點一次只收合。
// 範圍（半徑）在區域分析工具列選，這裡的 radiusKm 只用來寫總結句的「N 公里內」。
// 核定與實際收托是官方回報的數字，來源沒給寫「—」。樣式照 NearbyKindergartens.vue 複製需要的部分
// （兩個元件各自 scoped，不為這幾十行抽共用檔）。
const props = defineProps<{ data: AreaBabycare | null; failed: boolean; radiusKm: RadiusKm }>()
const emit = defineEmits<{ select: [id: string]; retry: [] }>()

const PAGE = 20
const headingId = useId()
// 展開的詳情（dl）的 id，給展開鈕的 aria-controls 指；只有展開的那一列有 dl，id 跟著列的位置編。
const detailId = (index: number) => `${headingId}-detail-${index}`
const showAll = ref(false)
const expanded = ref<string | null>(null)

// 換校區或半徑（新資料）：收回「顯示更多」與展開。
watch(() => props.data, () => {
  showAll.value = false
  expanded.value = null
})

const items = computed(() => props.data?.items ?? [])
const visible = computed(() => (showAll.value ? items.value : items.value.slice(0, PAGE)))
const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法列出附近托嬰中心。` : ''
})
// 名單從未匯入（後端 synced_at 為 null）：空清單不代表附近沒有托嬰中心，寫原因。校區位置沒標出來的原因優先。
const notImported = computed(() => props.data?.synced_at === null)
const summary = computed(() => (props.data ? babycareSummaryText(props.data.summary, props.radiusKm) : ''))
// 月費對照：公告月費少於 3 所就沒有（空字串），整段不畫。
const feeText = computed(() => (props.data ? babycareFeeText(props.data.summary) : ''))

function choose(id: string) {
  const opening = expanded.value !== id
  expanded.value = opening ? id : null
  if (opening) emit('select', id)
}
</script>

<template>
  <section class="nearby nearby--babycare" :aria-labelledby="headingId">
    <h3 :id="headingId" class="nearby__title">附近托嬰中心</h3>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近托嬰中心。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="notLocated" class="nearby__empty">{{ notLocated }}</p>
    <p v-else-if="notImported" class="nearby__empty">托嬰名單尚未匯入。</p>
    <template v-else>
      <p class="nearby__summary num">{{ summary }}</p>
      <template v-if="feeText">
        <p class="nearby__fees num">{{ feeText }}</p>
        <p class="hint nearby__fees-note">準公共托育的家長另有政府補助，這裡是機構公告的平均月費。</p>
      </template>
      <ul v-if="visible.length" class="nearby__list">
        <li v-for="(item, index) in visible" :key="item.source_id" class="nearby__item">
          <button
            type="button"
            class="nearby__row"
            :aria-expanded="expanded === item.source_id"
            :aria-controls="expanded === item.source_id ? detailId(index) : undefined"
            @click="choose(item.source_id)"
          >
            <span class="nearby__line">
              <span class="nearby__name">{{ babycareShortName(item.name) }}</span>
              <el-tag size="small" type="info" effect="plain" round>{{ babycareKindLabel(item.kind) }}</el-tag>
              <el-tag v-if="item.quasi_public" size="small" type="success" effect="plain" round>準公共</el-tag>
              <el-tag v-if="item.evaluation_grade" size="small" type="info" effect="plain" round>評鑑 {{ item.evaluation_grade }}</el-tag>
            </span>
            <span class="nearby__meta num">{{ babycareMeta(item) }}</span>
          </button>
          <dl v-if="expanded === item.source_id" :id="detailId(index)" class="nearby__detail">
            <div><dt>地址</dt><dd>{{ item.address }}</dd></div>
            <div v-if="item.phone"><dt>電話</dt><dd>{{ item.phone }}</dd></div>
            <div v-if="item.fee_note"><dt>費用說明</dt><dd>{{ item.fee_note }}</dd></div>
            <div v-if="item.evaluation_year"><dt>評鑑</dt><dd>{{ item.evaluation_year }} 年評鑑</dd></div>
          </dl>
        </li>
      </ul>
      <el-button v-if="!showAll && items.length > PAGE" text @click="showAll = true">顯示更多（還有 {{ items.length - PAGE }} 所）</el-button>
      <p class="hint nearby__source">{{ data.source_note }}・{{ taipeiMonthDay(data.synced_at) }} 更新</p>
    </template>
  </section>
</template>

<style scoped>
.nearby {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.nearby__title {
  margin: 0;
  font-size: var(--text-md);
}

.nearby__summary {
  margin: 0;
  color: var(--ink);
}

.nearby__fees,
.nearby__fees-note {
  margin: 0;
}

.nearby__fees {
  color: var(--ink);
}

.nearby__list {
  display: grid;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.nearby__item + .nearby__item {
  border-top: 1px solid var(--line);
}

.nearby__row {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nearby__row:focus-visible {
  outline-offset: -2px;
}

.nearby__row:hover,
.nearby__row[aria-expanded='true'] {
  background: var(--surface-2);
}

.nearby__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.nearby__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.nearby__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.nearby__detail {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0 12px 10px;
  font-size: var(--text-sm);
}

.nearby__detail div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 8px;
}

.nearby__detail dt {
  color: var(--ink-3);
}

.nearby__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.nearby__empty {
  margin: 0;
  color: var(--ink-2);
}

.nearby__source {
  margin: 0;
}

@media (min-width: 1200px) {
  .nearby__list {
    max-height: 420px;
  }
}
</style>
