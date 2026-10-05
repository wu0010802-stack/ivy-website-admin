<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { FunnelCard as BoardCard } from '../../api/types'
import { rocDate, termLabel } from '../../admissions/academic'
import { MISSING_CHILD_NAME, STAGE_LABELS, WITHDRAWN_FROM_LABELS, type Stage } from '../../admissions/constants'
import { isDue } from '../../admissions/followUp'

// 看板卡片（園務 FunnelCard.vue:14-37）：姓名＋退出類型、年級、入學學期、官網預約標記。
// 官網沒有學號、預繳金對帳，那兩種徽章不做。滑鼠點整張卡開歷程；鍵盤走卡片裡真正的
// <button>（姓名），外層不設 role=button，否則裡面的「移到…」會被報讀器當成裝飾。
// 「移到…」是拖曳的鍵盤替代（規格第 10 節），只列允許且有權限的目的欄。滑鼠裝置平常收起、
// 指到卡片或鍵盤移進卡片才出現（Tab 仍走得到）；觸控裝置沒有 hover，一直顯示。
const props = defineProps<{ card: BoardCard; stage: Stage; draggable: boolean; targets: readonly Stage[] }>()
const emit = defineEmits<{ open: []; move: [to: Stage]; dragstart: []; dragend: [] }>()

const term = computed(() => termLabel(props.card.target_school_year, props.card.target_semester, 'short'))
// 下次聯絡（2026-10-04 參觀後追蹤規格 7.4）：已到期寫「該聯絡了」；已排定寫日期；沒排不標
// （不自動排之後，大多數卡片都沒排，標出來只是雜訊）。
const followUp = computed(() => {
  const at = props.card.follow_up_at
  if (!at) return null
  if (isDue(at)) return { text: '該聯絡了', due: true }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' }).format(new Date(at))
  return { text: `下次聯絡 ${day.replace('-', '/')}`, due: false }
})

const menuOpen = ref(false)
const dragging = ref(false)

function onDragStart(event: DragEvent) {
  if (!props.draggable) {
    event.preventDefault()
    return
  }
  dragging.value = true
  // Firefox 沒有 setData 不會開始拖曳；看板自己記住拖的是哪張卡，不從 dataTransfer 讀。
  event.dataTransfer?.setData('text/plain', props.card.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('dragstart')
}
</script>

<template>
  <article
    class="funnel-card"
    :class="{ 'is-locked': !draggable, 'is-menu-open': menuOpen, 'is-dragging': dragging }"
    :data-id="card.id"
    :draggable="draggable ? 'true' : 'false'"
    @click="emit('open')"
    @dragstart="onDragStart"
    @dragend="dragging = false; emit('dragend')"
  >
    <div class="funnel-card__head">
      <button type="button" class="funnel-card__open" :aria-label="`${card.child_name}（${STAGE_LABELS[stage]}），開啟歷程`">
        <strong class="funnel-card__name">{{ card.child_name }}</strong>
        <el-tag v-if="card.child_name === MISSING_CHILD_NAME" size="small" type="warning" effect="light" round>待補</el-tag>
      </button>
      <el-dropdown
        v-if="targets.length"
        trigger="click"
        placement="bottom-end"
        :persistent="false"
        :popper-class="`funnel-move-menu funnel-move-menu--${card.id}`"
        @command="(to: Stage) => emit('move', to)"
        @visible-change="(visible: boolean) => (menuOpen = visible)"
      >
        <el-button size="small" text class="funnel-card__move" :data-move="card.id" :aria-label="`把 ${card.child_name} 移到其他階段`" @click.stop>
          移到…<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="to in targets" :key="to" :command="to">{{ STAGE_LABELS[to] }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div class="funnel-card__tags">
      <el-tag v-if="card.withdrawn_from" type="danger" size="small" effect="light">{{ WITHDRAWN_FROM_LABELS[card.withdrawn_from] ?? card.withdrawn_from }}</el-tag>
      <el-tag v-if="card.grade" type="info" size="small" effect="light">{{ card.grade }}</el-tag>
      <!-- 入學學期用中性色：每張卡都有，用黃色會和「已預繳」欄色撞。 -->
      <el-tag v-if="term" type="info" size="small" effect="light">{{ term }}</el-tag>
      <el-tag v-if="card.has_visit_request" type="primary" size="small" effect="plain">官網預約</el-tag>
    </div>
    <p class="funnel-card__meta">
      <span class="num">參觀 {{ rocDate(card.visit_date) || '—' }}</span>
      <span v-if="card.provisional_grade">・保留 {{ card.provisional_grade }}</span>
    </p>
    <p v-if="followUp" class="funnel-card__follow num" :class="{ 'is-due': followUp.due }">{{ followUp.text }}</p>
  </article>
</template>

<style scoped>
.funnel-card {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  /* 卡片在哪一欄就是哪個階段，欄標題已有階段色點，卡片不再加左側色條。 */
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

/* 點得到的樣子：外框加深＋淡陰影，只換顏色與陰影，不動尺寸。 */
.funnel-card:hover,
.funnel-card.is-menu-open {
  border-color: var(--line-strong);
  box-shadow: var(--shadow-md);
}

.funnel-card:not(.is-locked):active,
.funnel-card.is-dragging {
  cursor: grabbing;
}

/* 看起來還是卡片裡的姓名；去掉預設按鈕外觀，focus 有可見外框。 */
.funnel-card__open {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: inherit;
}

.funnel-card__open:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: var(--radius);
}

/* 支援 :has 的瀏覽器把焦點框畫在整張卡上，鍵盤使用者看得出現在在哪一張。 */
@supports selector(:has(*)) {
  .funnel-card:has(.funnel-card__open:focus-visible) {
    border-color: var(--line-strong);
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
  }

  .funnel-card__open:focus-visible {
    outline: none;
  }
}

.funnel-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.funnel-card__name {
  min-width: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.funnel-card__move {
  flex: none;
}

/* 滑鼠裝置：「移到…」平常收起（保留位置、Tab 仍聚焦得到），指到卡片、焦點在卡片裡或選單開著才出現。 */
@media (hover: hover) and (pointer: fine) {
  .funnel-card__move {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s var(--ease-out);
  }

  .funnel-card:hover .funnel-card__move,
  .funnel-card:focus-within .funnel-card__move,
  .funnel-card.is-menu-open .funnel-card__move {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .funnel-card,
  .funnel-card__move {
    transition: none;
  }
}

.funnel-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.funnel-card__meta {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

@media (pointer: coarse) {
  .funnel-card__move {
    min-height: 44px;
  }
}

.funnel-card__follow {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-xs);
}

.funnel-card__follow.is-due {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
