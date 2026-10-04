<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { getBoard, getOptions } from '../../api/admissions'
import type { AdmissionsOptions, FunnelBoard as BoardData, FunnelCard as BoardCard } from '../../api/types'
import { currentTerm } from '../../admissions/academic'
import {
  STAGES, STAGE_EMPTY_TEXT, STAGE_LABELS, STAGE_TOKENS, canDragFrom, moveTargets, transitionBlockedText, transitionCapability,
  type Stage, type TransitionTarget,
} from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import FunnelCard from './FunnelCard.vue'
import TransitionDialog from './TransitionDialog.vue'
import RecordDialog from './RecordDialog.vue'
import EventsDrawer from './EventsDrawer.vue'

// 漏斗看板（園務 FunnelBoard／FunnelColumn／FunnelSummaryBar）。以入學學年學期圈範圍：
// 學年必填（API 需要），頁首選「不限學年」時用目前學年並說明（本檔調整第 18 條）；學期不選＝整學年。
// 換欄一律先跳確認框（園務 needsDialog 等於所有合法轉換），所以不做樂觀移動：
// 409 時重讀看板，卡片就停在伺服器的欄（Review Focus 3）。
const props = defineProps<{ campusKey: string; schoolYear: number | null; semester: Semester | null }>()
const emit = defineEmits<{ 'show-unscoped': [] }>()

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))
const defaultYear = currentTerm().schoolYear
const boardYear = computed(() => props.schoolYear ?? defaultYear)

const board = ref<BoardData | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

// keep：動作後重讀，不切回骨架；換校或換學期時先清空，不讓上一校的卡片留在畫面上。
async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) board.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getBoard(props.campusKey, boardYear.value, props.semester)
    if (!requests.isCurrent(request)) return
    board.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
  } catch {
    if (!requests.isCurrent(request)) return
    board.value = null
    error.value = '無法讀取看板，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => [props.campusKey, boardYear.value, props.semester], () => void load(), { immediate: true })

function cardsOf(stage: Stage): BoardCard[] {
  return board.value?.columns?.[stage] ?? []
}
const count = (stage: Stage) => cardsOf(stage).length

// 摘要列三個比率：園務用「各欄目前張數」相除（不是累積漏斗）；分母 0 顯示「—」，不顯示 0（本檔調整第 20 條）。
function rate(numerator: number, denominator: number): string {
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—'
}
const summaryRates = computed(() => [
  { label: '預繳率', value: rate(count('deposited'), count('visited')), title: '已預繳 ÷ 已訪視（各欄目前張數）' },
  { label: '註冊率', value: rate(count('enrolled'), count('deposited')), title: '已註冊 ÷ 已預繳（各欄目前張數）' },
  { label: '退費率', value: rate(count('withdrawn'), count('enrolled')), title: '退預繳／退註冊 ÷ 已註冊（各欄目前張數，同園務）' },
])

function stageStyle(stage: Stage): Record<string, string> {
  return { '--stage-color': `var(${STAGE_TOKENS[stage]})` }
}

const canDrag = (stage: Stage) => canDragFrom(stage, can)
const targetsFor = (stage: Stage) => moveTargets(stage, can)

// ---- 拖曳（原生 HTML5 drag and drop）----
const dragging = ref<{ card: BoardCard; from: Stage } | null>(null)
const dropTarget = ref<Stage | null>(null)

function onDragStart(card: BoardCard, from: Stage) {
  dragging.value = { card, from }
}
function onDragEnd() {
  dragging.value = null
  dropTarget.value = null
}
function onDragOver(stage: Stage, event: DragEvent) {
  if (!dragging.value) return
  event.preventDefault()
  dropTarget.value = stage
}
function onDragLeave(stage: Stage) {
  if (dropTarget.value === stage) dropTarget.value = null
}
function onDrop(stage: Stage) {
  const current = dragging.value
  onDragEnd()
  if (current) requestMove(current.card, current.from, stage)
}

// ---- 換欄 ----
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function requestMove(card: BoardCard, from: Stage, to: Stage) {
  if (from === to) return
  const capability = transitionCapability(from, to)
  if (!capability) {
    ElMessage.warning(transitionBlockedText(from, to))
    return
  }
  if (!can(capability)) {
    ElMessage.warning('無權限執行此操作')
    return
  }
  transitionTarget.value = { card, from, to }
  transitionOpen.value = true
}

function onTransitioned() {
  void load({ keep: true })
}

// ---- 新增訪視、歷程 ----
const addOpen = ref(false)
const options = ref<AdmissionsOptions | null>(null)
async function openAdd() {
  addOpen.value = true
  // 來源、介紹者的建議清單（園務 FunnelAddVisit 先 fetchOptions）；讀不到不影響新增。
  if (options.value) return
  try {
    const result = await getOptions(props.campusKey)
    options.value = result && typeof result === 'object' && !Array.isArray(result) ? result : null
  } catch {
    options.value = null
  }
}
watch(() => props.campusKey, () => {
  options.value = null
})

const eventsOpen = ref(false)
const eventsFor = ref<BoardCard | null>(null)
function openEvents(card: BoardCard) {
  eventsFor.value = card
  eventsOpen.value = true
}
</script>

<template>
  <section class="funnel">
    <div class="toolbar funnel__toolbar">
      <p v-if="schoolYear === null" class="hint funnel__note">看板一次看一個學年：頁首選了「不限學年」，這裡先顯示 {{ defaultYear }} 學年。</p>
      <span class="toolbar__spacer" />
      <el-button :loading="loading" @click="load({ keep: true })">重新整理</el-button>
      <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openAdd">新增訪視</el-button>
    </div>

    <!-- 園務 FunnelBoard.vue:36-47：沒有入學學期的訪視不在任何看板，空看板不能謊稱「還沒有訪視紀錄」。 -->
    <el-alert
      v-if="board?.unscoped_count"
      type="info"
      :closable="false"
      show-icon
      class="funnel__notice"
      :title="`另有 ${board.unscoped_count} 筆訪視沒有填入學學期，不會出現在任何學年的看板。`"
    >
      <el-button link type="primary" @click="emit('show-unscoped')">到訪視明細處理</el-button>
    </el-alert>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="funnel__notice">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!board" :rows="6" animated />

    <template v-else>
      <div class="funnel__summary">
        <dl class="funnel__stats">
          <div v-for="stage in STAGES" :key="stage" class="funnel__stat" :style="stageStyle(stage)">
            <dt>{{ STAGE_LABELS[stage] }}</dt>
            <dd class="num">{{ count(stage) }}</dd>
          </div>
        </dl>
        <p class="funnel__rates">
          <span v-for="item in summaryRates" :key="item.label" :title="item.title"><strong class="num">{{ item.value }}</strong> {{ item.label }}</span>
        </p>
      </div>

      <div class="funnel__columns" :aria-busy="loading">
        <section
          v-for="stage in STAGES"
          :key="stage"
          class="funnel__column"
          :class="{ 'is-drop-target': dropTarget === stage }"
          :data-stage="stage"
          :style="stageStyle(stage)"
          :aria-label="`${STAGE_LABELS[stage]}，${count(stage)} 張`"
          @dragover="onDragOver(stage, $event)"
          @dragleave="onDragLeave(stage)"
          @drop.prevent="onDrop(stage)"
        >
          <header class="funnel__column-head">
            <span class="funnel__dot" aria-hidden="true" />
            <h3>{{ STAGE_LABELS[stage] }}</h3>
            <span class="funnel__count num">{{ count(stage) }}</span>
          </header>
          <p v-if="!count(stage)" class="hint funnel__empty">{{ STAGE_EMPTY_TEXT[stage] }}</p>
          <div v-else class="funnel__cards">
            <FunnelCard
              v-for="card in cardsOf(stage)"
              :key="card.id"
              :card="card"
              :stage="stage"
              :draggable="canDrag(stage)"
              :targets="targetsFor(stage)"
              :style="stageStyle(stage)"
              @open="openEvents(card)"
              @move="(to: Stage) => requestMove(card, stage, to)"
              @dragstart="onDragStart(card, stage)"
              @dragend="onDragEnd"
            />
          </div>
        </section>
      </div>
    </template>

    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="onTransitioned" @stale="onTransitioned" />
    <RecordDialog v-model="addOpen" mode="add" :campus-key="campusKey" :options="options" @saved="load({ keep: true })" />
    <EventsDrawer v-model="eventsOpen" :visit-id="eventsFor?.id ?? null" :child-name="eventsFor?.child_name ?? ''" @changed="load({ keep: true })" />
  </section>
</template>

<style scoped>
.funnel__toolbar {
  justify-content: flex-end;
}

.funnel__note {
  margin: 0;
}

.funnel__notice {
  margin-bottom: 16px;
}

.funnel__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-bottom: 16px;
}

.funnel__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}

.funnel__stat {
  display: grid;
  gap: 2px;
  min-width: 96px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--stage-color);
  border-radius: var(--radius);
  background: var(--surface);
}

.funnel__stat dt {
  color: var(--ink-3);
  font-size: 13px;
}

.funnel__stat dd {
  margin: 0;
  color: var(--ink);
  font-size: 20px;
  font-weight: 600;
}

.funnel__rates {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  color: var(--ink-2);
}

.funnel__rates strong {
  color: var(--ink);
}

/* 桌機四欄並排；中寬兩欄；手機（390px）四欄直向堆疊（規格第 10 節）。 */
.funnel__columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.funnel__column {
  display: grid;
  gap: 8px;
  min-width: 0;
  min-height: 160px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
}

.funnel__column.is-drop-target {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.funnel__column-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.funnel__column-head h3 {
  flex: 1;
  margin: 0;
  font-size: 14px;
}

.funnel__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--stage-color);
}

.funnel__count {
  min-width: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
  text-align: center;
}

.funnel__empty {
  margin: 0;
  line-height: 1.6;
}

.funnel__cards {
  display: grid;
  gap: 8px;
}

@media (max-width: 1100px) {
  .funnel__columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .funnel__columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .funnel__column {
    min-height: 0;
  }

  .funnel__stat {
    flex: 1 1 calc(50% - 8px);
    min-width: 0;
  }
}
</style>
