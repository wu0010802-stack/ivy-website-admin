<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { FunnelCard as BoardCard } from '../../api/types'
import { rocDate, termLabel } from '../../admissions/academic'
import { MISSING_CHILD_NAME, STAGE_LABELS, WITHDRAWN_FROM_LABELS, type Stage } from '../../admissions/constants'

// 看板卡片（園務 FunnelCard.vue:14-37）：姓名＋退出類型、年級、入學學期、官網預約標記。
// 官網沒有學號、預繳金對帳，那兩種徽章不做。滑鼠點整張卡開歷程；鍵盤走卡片裡真正的
// <button>（姓名），外層不設 role=button，否則裡面的「移到…」會被報讀器當成裝飾。
// 「移到…」是拖曳的鍵盤替代（規格第 10 節），只列允許且有權限的目的欄。
const props = defineProps<{ card: BoardCard; stage: Stage; draggable: boolean; targets: readonly Stage[] }>()
const emit = defineEmits<{ open: []; move: [to: Stage]; dragstart: []; dragend: [] }>()

const term = computed(() => termLabel(props.card.target_school_year, props.card.target_semester, 'short'))

function onDragStart(event: DragEvent) {
  if (!props.draggable) {
    event.preventDefault()
    return
  }
  // Firefox 沒有 setData 不會開始拖曳；看板自己記住拖的是哪張卡，不從 dataTransfer 讀。
  event.dataTransfer?.setData('text/plain', props.card.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('dragstart')
}
</script>

<template>
  <article
    class="funnel-card"
    :class="{ 'is-locked': !draggable }"
    :data-id="card.id"
    :draggable="draggable ? 'true' : 'false'"
    @click="emit('open')"
    @dragstart="onDragStart"
    @dragend="emit('dragend')"
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
      <el-tag v-if="term" type="warning" size="small" effect="light">{{ term }}</el-tag>
      <el-tag v-if="card.has_visit_request" type="primary" size="small" effect="plain">官網預約</el-tag>
    </div>
    <p class="funnel-card__meta">
      <span class="num">參觀 {{ rocDate(card.visit_date) || '—' }}</span>
      <span v-if="card.provisional_grade">・保留 {{ card.provisional_grade }}</span>
    </p>
  </article>
</template>

<style scoped>
.funnel-card {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--stage-color, var(--line-strong));
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: grab;
}

.funnel-card.is-locked {
  cursor: pointer;
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

.funnel-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.funnel-card__meta {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}

@media (pointer: coarse) {
  .funnel-card__move {
    min-height: 44px;
  }
}
</style>
