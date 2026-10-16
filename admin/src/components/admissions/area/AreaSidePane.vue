<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import AreaRanking from './AreaRanking.vue'
import VillageCard from './VillageCard.vue'
import type { PaneHead, RankingSection } from './areaPane'
import type { VillageFacts } from './villageFacts'

// 區域分析右欄的容器（2026-10-16 規格 §2.3～2.5）：選了里（facts 有值）就只畫里卡片；沒選時，同業模式畫 slot
// （AreaTab 放附近同業清單與園所異動），其他模式畫「標題＋摘要＋排行」，排行資料讀取中畫骨架、讀取失敗寫原因加重試。
// 選了里時同業 slot 留在 DOM 裡藏起來（v-show），關掉卡片後附近清單的搜尋字與展開列還在。
// 標題區黏在右欄頂端（只在 ≥1200px，那時右欄才內捲）；右欄的寬高由外層工作台決定（桌機高度同地圖，內容超出時欄內捲動）。
const props = withDefaults(defineProps<{
  head: PaneHead
  sections: RankingSection[]
  loading: boolean
  /** 排行資料的讀取失敗原因；空字串＝沒有失敗。 */
  failed: string
  facts: VillageFacts | null
  /** 同業模式：內容是 default slot，不畫排行。 */
  peers: boolean
  narrow: boolean
  /** 從地圖點選的里：aria-live 才報「已選取…」。排行或表格選里是焦點移到卡片標題，不重複報讀（規格 §2.4）。 */
  announce?: boolean
}>(), { announce: false })
const emit = defineEmits<{
  select: [code: string]
  close: []
  'open-records': [area: string]
  retry: []
  'retry-facts': [section: 'kids' | 'ours']
}>()

// 桌機排行 10 列、手機 5 列（D10），各附「顯示更多」到 20。
const RANKING_LIMIT = 10
const RANKING_LIMIT_NARROW = 5

const card = ref<InstanceType<typeof VillageCard> | null>(null)
/** 從排行或表格選里：等卡片畫出來，把焦點移到卡片標題。從地圖點選時不呼叫（不搶焦點），靠下面的 aria-live 報讀。 */
async function focusCard() {
  await nextTick()
  card.value?.focusHeading()
}
defineExpose({ focusCard })

const announcement = computed(() => (props.facts && props.announce ? `已選取${props.facts.title}` : ''))
</script>

<template>
  <div class="area-pane">
    <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    <VillageCard
      v-if="facts"
      ref="card"
      :facts="facts"
      @close="emit('close')"
      @open-records="emit('open-records', $event)"
      @retry="emit('retry-facts', $event)"
    />
    <header v-if="!facts" class="area-pane__head">
      <h2 class="area-pane__title">{{ head.title }}</h2>
      <p v-for="(line, index) in head.lines" :key="index" class="area-pane__line">{{ line }}</p>
      <slot name="head-extra" />
      <p v-if="head.note" class="hint area-pane__note">{{ head.note }}</p>
    </header>
    <!-- 同業模式的 slot（附近清單的搜尋字、種類、展開列都在裡面）在卡片顯示時只用 v-show 藏起來：用 v-if 會卸載再重掛，
         關掉卡片回來搜尋字就歸零。其他模式的排行沒有要保留的狀態，卡片顯示時不畫。 -->
    <div v-if="!facts || peers" v-show="!facts" class="area-pane__body">
      <slot v-if="peers" />
      <el-skeleton v-else-if="loading" :rows="6" animated />
      <el-alert v-else-if="failed" type="error" :closable="false" show-icon :title="failed">
        <el-button size="small" @click="emit('retry')">重試</el-button>
      </el-alert>
      <p v-else-if="head.empty" class="empty-note area-pane__empty">{{ head.empty }}</p>
      <AreaRanking v-else :sections="sections" :limit="narrow ? RANKING_LIMIT_NARROW : RANKING_LIMIT" @select="emit('select', $event)" />
    </div>
  </div>
</template>

<style scoped>
.area-pane {
  position: relative;
  min-width: 0;
  background: var(--surface);
}

.area-pane__head {
  display: grid;
  gap: 4px;
  padding: 12px 16px 8px;
  background: var(--surface);
}

.area-pane__title {
  margin: 0;
  font-size: var(--text-lg);
}

.area-pane__line,
.area-pane__note {
  margin: 0;
}

.area-pane__line {
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.area-pane__body {
  display: grid;
  gap: 12px;
  padding: 0 4px 12px;
  min-width: 0;
}

.area-pane__empty {
  margin: 0 12px;
}

/* 1200px 以下工作台單欄，右欄接在地圖下方、高度 auto 不內捲；寬螢幕右欄高度同地圖，內容超出時欄內捲動。 */
@media (min-width: 1200px) {
  .area-pane {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .area-pane__head {
    position: sticky;
    top: 0;
    z-index: 1;
  }
}
</style>
