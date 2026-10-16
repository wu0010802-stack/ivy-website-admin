<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { NearbyKindergarten, VillageFacts } from './villageFacts'

// 區域分析右欄的里卡片（2026-10-16 規格 §2.4）：標題＋副標，下面三段——孩子、我們、附近的幼兒園，每段兩欄 dl（左標籤、右數值）。
// 資料全部在 facts（villageFacts 組好的），這裡只畫：段狀態 loading 畫骨架、failed 寫「讀取失敗」加「重試」（只換掉那一段，
// 我們段只換在籍那一列，參觀那列一直在）；孩子段的 outside／no-population／unavailable 只寫 note、不畫數值列。
// 關閉：×、Esc（焦點在卡片內時）。從排行或表格選里時，外面呼叫 focusHeading 把焦點移到標題。
const props = defineProps<{ facts: VillageFacts }>()
const emit = defineEmits<{ close: []; 'open-records': [area: string]; retry: [section: 'kids' | 'ours'] }>()

// 本機構在 villageFacts 裡只用類型文字區分（kindLabel），地圖上本機構是金色點，卡片的點跟著用同一個色。
const OWN_LABEL = '本機構'
const id = useId()
const titleId = `${id}-title`
const kidsId = `${id}-kids`
const oursId = `${id}-ours`
const nearbyId = `${id}-nearby`

const heading = ref<HTMLElement | null>(null)
function focusHeading() {
  heading.value?.focus()
}
defineExpose({ focusHeading })

const kids = computed(() => props.facts.kids)
const ours = computed(() => props.facts.ours)
// null（幼兒園名單沒到、沒座標、半徑外或靠近邊界）與 []（查過、500 m 內沒有）都不畫這一段。
const nearby = computed(() => props.facts.nearby ?? [])
const dotClass = (item: NearbyKindergarten): string =>
  `village-card__dot--${item.kindLabel === OWN_LABEL ? 'own' : item.kind}`
const toneClass = (tone: 'up' | 'down' | undefined): string => (tone ? `village-card__value--${tone}` : '')

function openRecords() {
  const area = props.facts.ours.openRecordsArea
  if (area !== null) emit('open-records', area)
}
</script>

<template>
  <section class="village-card" :aria-labelledby="titleId" @keydown.esc="emit('close')">
    <header class="village-card__head">
      <div class="village-card__heading">
        <h2 :id="titleId" ref="heading" class="village-card__title" tabindex="-1">{{ facts.title }}</h2>
        <p v-if="facts.subtitle" class="village-card__subtitle">{{ facts.subtitle }}</p>
      </div>
      <button type="button" class="village-card__close" aria-label="關閉里卡片" @click="emit('close')">
        <span aria-hidden="true">×</span>
      </button>
    </header>

    <section class="village-card__section" :aria-labelledby="kidsId">
      <div class="village-card__section-head">
        <h3 :id="kidsId" class="village-card__section-title">孩子</h3>
        <span v-if="kids.mergeNote" class="village-card__merge">{{ kids.mergeNote }}</span>
      </div>
      <el-skeleton v-if="kids.state === 'loading'" :rows="3" animated />
      <p v-else-if="kids.state === 'failed'" class="village-card__failed">
        <span>讀取失敗</span>
        <el-button size="small" @click="emit('retry', 'kids')">重試</el-button>
      </p>
      <p v-else-if="kids.state !== 'ok'" class="hint village-card__note">{{ kids.note }}</p>
      <dl v-else class="village-card__rows">
        <div v-for="row in kids.rows" :key="row.label" class="village-card__row">
          <dt>{{ row.label }}</dt>
          <dd>
            <span class="village-card__value num" :class="toneClass(row.tone)">{{ row.value }}</span>
            <span v-if="row.detail" class="village-card__detail num">{{ row.detail }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <section class="village-card__section" :aria-labelledby="oursId">
      <h3 :id="oursId" class="village-card__section-title">我們</h3>
      <dl class="village-card__rows">
        <!-- 在籍名冊還在讀或讀取失敗：只換掉在籍這一列，參觀那列（來自頁面一開始就載入的區域分析）照寫。 -->
        <div v-if="ours.state === 'loading'" class="village-card__row">
          <dt>在籍</dt>
          <dd><el-skeleton :rows="1" animated /></dd>
        </div>
        <div v-else-if="ours.state === 'failed'" class="village-card__row">
          <dt>在籍</dt>
          <dd class="village-card__failed">
            <span>讀取失敗</span>
            <el-button size="small" @click="emit('retry', 'ours')">重試</el-button>
          </dd>
        </div>
        <div v-for="row in ours.rows" :key="row.label" class="village-card__row">
          <dt>{{ row.label }}</dt>
          <dd>
            <span class="village-card__value num" :class="toneClass(row.tone)">{{ row.value }}</span>
            <span v-if="row.detail" class="village-card__detail num">{{ row.detail }}</span>
          </dd>
        </div>
      </dl>
      <el-button v-if="ours.openRecordsArea !== null" class="village-card__records" type="primary" plain size="small" @click="openRecords">
        查看這個里的訪視
      </el-button>
    </section>

    <section v-if="nearby.length" class="village-card__section" :aria-labelledby="nearbyId">
      <h3 :id="nearbyId" class="village-card__section-title">附近的幼兒園</h3>
      <ul class="village-card__nearby">
        <li v-for="(item, index) in nearby" :key="index">
          <span class="village-card__dot" :class="dotClass(item)" aria-hidden="true" />
          <span class="village-card__nearby-name">{{ item.name }}</span>
          <span class="village-card__nearby-kind">{{ item.kindLabel }}</span>
          <span class="village-card__nearby-distance num">{{ item.distance }}</span>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.village-card {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 0 16px 16px;
  min-width: 0;
}

.village-card__head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 0 8px;
  background: var(--surface);
}

.village-card__heading {
  min-width: 0;
}

.village-card__title {
  margin: 0;
  font-size: var(--text-lg);
  overflow-wrap: anywhere;
}

.village-card__title:focus-visible {
  outline-offset: 2px;
}

.village-card__subtitle {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.village-card__close {
  flex: none;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-2xl);
  line-height: 1;
  cursor: pointer;
}

.village-card__close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.village-card__section {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.village-card__section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.village-card__section-title {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-weight: 600;
}

.village-card__merge {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.village-card__note,
.village-card__failed {
  margin: 0;
}

.village-card__failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.village-card__rows {
  display: grid;
  gap: 6px;
  margin: 0;
}

.village-card__row {
  display: grid;
  grid-template-columns: 9em minmax(0, 1fr);
  gap: 8px;
}

.village-card__row dt {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.village-card__row dd {
  display: grid;
  margin: 0;
  min-width: 0;
}

.village-card__value {
  overflow-wrap: anywhere;
  font-size: var(--text-base);
}

.village-card__value--up {
  color: var(--admin-accent-hover);
}

.village-card__value--down {
  color: var(--area-down-ink);
}

.village-card__detail {
  overflow-wrap: anywhere;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.village-card__records {
  justify-self: start;
}

.village-card__nearby {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.village-card__nearby li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
}

.village-card__dot {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.village-card__dot--public { background: var(--area-kind-public); }
.village-card__dot--nonprofit { background: var(--area-kind-nonprofit); }
.village-card__dot--quasi_public { background: var(--area-kind-quasi-public); }
.village-card__dot--private { background: var(--area-kind-private); }
.village-card__dot--own { background: var(--area-kind-own); border: 1px solid var(--area-kind-own-ink); }

.village-card__nearby-name {
  overflow-wrap: anywhere;
  font-weight: 600;
}

.village-card__nearby-kind,
.village-card__nearby-distance {
  color: var(--ink-3);
}
</style>
