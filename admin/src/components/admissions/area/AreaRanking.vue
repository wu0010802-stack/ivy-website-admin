<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RankingSection } from './areaPane'

// 右欄排行（2026-10-16 規格 §2.3）：每列名次、里名＋距本校、右側數值與小字。有代碼的列是原生 button（點了選取那個里），
// 對不到里界的列（code 為 null）畫成不可點的文字。先顯示 limit 列（桌機 10、手機 5，D10），「顯示更多」展開到 20；
// 完整名單在下面的表格分頁，這裡不再往下加。
const props = defineProps<{ sections: RankingSection[]; limit: number }>()
const emit = defineEmits<{ select: [code: string] }>()

const MORE_LIMIT = 20
const expanded = ref(false)
// 換了一份排行（換模式、換範圍、資料重讀）：收回展開，新的排行從 limit 列開始看。
watch(() => props.sections, () => {
  expanded.value = false
})

const shown = computed(() => (expanded.value ? MORE_LIMIT : props.limit))
const visible = computed(() => props.sections.map((section) => ({ title: section.title, items: section.items.slice(0, shown.value) })))
const hasMore = computed(() => !expanded.value && props.sections.some((section) => section.items.length > props.limit))
</script>

<template>
  <div class="area-ranking">
    <section v-for="(section, sectionIndex) in visible" :key="sectionIndex" class="area-ranking__section">
      <h3 v-if="section.title" class="area-ranking__title">{{ section.title }}</h3>
      <ol class="area-ranking__list">
        <li v-for="(item, index) in section.items" :key="index" class="area-ranking__li">
          <component
            :is="item.code ? 'button' : 'div'"
            class="area-ranking__item"
            v-bind="item.code ? { type: 'button' } : {}"
            @click="item.code && emit('select', item.code)"
          >
            <span class="area-ranking__rank num">{{ index + 1 }}</span>
            <span class="area-ranking__place">
              <span class="area-ranking__name">{{ item.name }}</span>
              <span class="area-ranking__distance num">{{ item.distance }}</span>
            </span>
            <span class="area-ranking__figure">
              <span class="area-ranking__value num" :class="item.tone ? `area-ranking__value--${item.tone}` : ''">{{ item.value }}</span>
              <span v-if="item.detail" class="area-ranking__detail num">{{ item.detail }}</span>
            </span>
          </component>
        </li>
      </ol>
    </section>
    <el-button v-if="hasMore" class="area-ranking__more" text @click="expanded = true">顯示更多</el-button>
  </div>
</template>

<style scoped>
.area-ranking {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.area-ranking__section {
  display: grid;
  gap: 4px;
}

.area-ranking__title {
  margin: 0;
  padding: 0 12px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-weight: 600;
}

.area-ranking__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.area-ranking__li + .area-ranking__li {
  border-top: 1px solid var(--line);
}

.area-ranking__item {
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
}

button.area-ranking__item {
  cursor: pointer;
}

button.area-ranking__item:hover {
  background: var(--surface-2);
}

button.area-ranking__item:focus-visible {
  outline-offset: -2px;
}

.area-ranking__rank {
  color: var(--ink-3);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.area-ranking__place {
  display: grid;
  min-width: 0;
}

.area-ranking__name {
  overflow-wrap: anywhere;
  font-weight: 600;
}

.area-ranking__distance,
.area-ranking__detail {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.area-ranking__figure {
  display: grid;
  justify-items: end;
  text-align: right;
}

.area-ranking__value {
  font-weight: 600;
}

.area-ranking__value--up {
  color: var(--admin-accent-hover);
}

.area-ranking__value--down {
  color: var(--area-down-ink);
}

.area-ranking__more {
  justify-self: start;
}
</style>
