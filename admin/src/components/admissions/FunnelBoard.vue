<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Search } from '@element-plus/icons-vue'
import { getBoard, getOptions } from '../../api/admissions'
import type { AdmissionsOptions, FunnelBoard as BoardData, FunnelCard as BoardCard } from '../../api/types'
import { currentTerm } from '../../admissions/academic'
import {
  STAGES, STAGE_EMPTY_TEXT, STAGE_LABELS, STAGE_TOKENS, canDragFrom, moveTargets, transitionBlockedText, transitionCapability,
  type Stage, type TransitionTarget,
} from '../../admissions/constants'
import type { Semester } from '../../admissions/useAdmissionsFilters'
import { notifyWarning } from '../../composables/notify'
import { awaitingAttendanceLink, hasAwaitingAttendance } from '../../composables/visitAttendance'
import { usePermissions } from '../../composables/usePermissions'
import { useRouter } from 'vue-router'
import { visitRequestPath } from '../../admissions/family'
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
const router = useRouter()
const canWrite = computed(() => can('admissions.write'))
const term = currentTerm()
const defaultYear = term.schoolYear
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

// 找幼生姓名：只在前端過濾已讀到的卡片（trim、不分大小寫）。比率一律用沒過濾的張數。
const query = ref('')
const keyword = computed(() => query.value.trim())
const filtering = computed(() => keyword.value !== '')
function visibleCards(stage: Stage): BoardCard[] {
  if (!filtering.value) return cardsOf(stage)
  const needle = keyword.value.toLowerCase()
  return cardsOf(stage).filter((card) => card.child_name.toLowerCase().includes(needle))
}
// 過濾中寫「符合數/總數」，欄位疊起來時的張數列也一樣。
const countText = (stage: Stage) => (filtering.value ? `${visibleCards(stage).length}/${count(stage)}` : String(count(stage)))
const columnLabel = (stage: Stage) =>
  filtering.value
    ? `${STAGE_LABELS[stage]}，符合「${keyword.value}」的 ${visibleCards(stage).length} 張，共 ${count(stage)} 張`
    : `${STAGE_LABELS[stage]}，${count(stage)} 張`
const searchStatus = computed(() =>
  filtering.value && board.value ? `符合「${keyword.value}」的卡片共 ${STAGES.reduce((sum, stage) => sum + visibleCards(stage).length, 0)} 張` : '',
)

// 三個比率：園務用「各欄目前張數」相除（不是累積漏斗）；名稱在前、附分子分母，分母 0 寫「—」不寫 0（本檔調整第 20 條）。
function rate(label: string, numerator: number, denominator: number, title: string) {
  if (!denominator) return { label, value: '—', fraction: '', title }
  return { label, value: `${((numerator / denominator) * 100).toFixed(1)}%`, fraction: `（${numerator}/${denominator}）`, title }
}
const summaryRates = computed(() => [
  rate('預繳率', count('deposited'), count('visited'), '已預繳 ÷ 已訪視（各欄目前張數）'),
  rate('註冊率', count('enrolled'), count('deposited'), '已註冊 ÷ 已預繳（各欄目前張數）'),
  rate('退費率', count('withdrawn'), count('enrolled'), '退預繳／退註冊 ÷ 已註冊（各欄目前張數，同園務）'),
])

// 看板全空、還有場次已過卻沒標記到場的預約：多半是還沒標記，不是沒有人來參觀。標記已到場建立的訪視
// 入學學期是當天的學期（booking_link.fields_from_visit_request），只在看板涵蓋目前學期時提示。
// 2026-10-05 拿掉「官網預約」分頁後連到案件列表的「只看尚未確認到場」；有沒有這種預約要 booking.read。
const emptyCurrentTerm = computed(
  () =>
    Boolean(board.value) &&
    STAGES.every((stage) => count(stage) === 0) &&
    boardYear.value === term.schoolYear &&
    (props.semester === null || props.semester === term.semester),
)
const awaitingAttendance = ref(false)
const awaitingRequests = useRequestSequence()
watch([emptyCurrentTerm, () => props.campusKey], async ([empty]) => {
  const request = awaitingRequests.begin()
  awaitingAttendance.value = false
  if (!empty || !can('booking.read')) return
  try {
    const found = await hasAwaitingAttendance(props.campusKey)
    if (awaitingRequests.isCurrent(request)) awaitingAttendance.value = found
  } catch {
    // 只是提醒；讀不到就不顯示。
  }
}, { immediate: true })
const showAttendanceHint = computed(() => emptyCurrentTerm.value && awaitingAttendance.value)

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
    notifyWarning(transitionBlockedText(from, to))
    return
  }
  if (!can(capability)) {
    notifyWarning('無權限執行此操作')
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
// 有預約、看得到預約的開預約明細（家庭頁）；手動新增或沒有 booking.read 的照舊開歷程抽屜（家庭頁規格 6.1）。
function openEvents(card: BoardCard) {
  const path = visitRequestPath(card.visit_request_id, can)
  if (path) {
    void router.push(path)
    return
  }
  eventsFor.value = card
  eventsOpen.value = true
}
</script>

<template>
  <section class="funnel">
    <!-- 一列：左邊比率（名稱在前、附分子分母）與說明，右邊找姓名、重新整理、新增訪視。窄螢幕自然換行。 -->
    <div class="toolbar funnel__toolbar">
      <div class="funnel__overview">
        <template v-if="board">
          <p class="funnel__rates">
            <span v-for="item in summaryRates" :key="item.label" class="funnel__rate" :title="item.title">
              {{ item.label }} <strong class="num">{{ item.value }}</strong><span v-if="item.fraction" class="num">{{ item.fraction }}</span>
            </span>
          </p>
          <p class="hint funnel__note">依各欄目前張數相除，和「統計分析」的轉換率算法不同。</p>
        </template>
        <p v-if="schoolYear === null" class="hint funnel__note">看板一次看一個學年：頁首選了「不限學年」，這裡先顯示 {{ defaultYear }} 學年。</p>
      </div>
      <div class="funnel__actions">
        <el-input v-model="query" class="funnel__search" clearable placeholder="找幼生姓名" aria-label="找幼生姓名" :prefix-icon="Search" />
        <el-button :loading="loading" @click="load({ keep: true })">重新整理</el-button>
        <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openAdd">新增訪視</el-button>
      </div>
      <p class="visually-hidden" aria-live="polite">{{ searchStatus }}</p>
    </div>

    <el-alert
      v-if="showAttendanceHint"
      type="info"
      :closable="false"
      show-icon
      class="funnel__notice"
      title="還有場次已過、還沒標記到場的參觀預約。標記已到場後，家長會自動出現在「已訪視」。"
    >
      <router-link :to="awaitingAttendanceLink(campusKey)">去標記到場</router-link>
    </el-alert>

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
      <!-- 各欄張數桌機已寫在欄標題，不再另排一列數字卡（2026-10-05 第九輪）；欄位疊起來的窄螢幕
           看不到每一欄的標題，才在這裡留一行精簡的張數。 -->
      <dl class="funnel__stats">
        <div v-for="stage in STAGES" :key="stage" class="funnel__stat" :style="stageStyle(stage)">
          <dt><span class="funnel__dot" aria-hidden="true" />{{ STAGE_LABELS[stage] }}</dt>
          <dd class="num">{{ countText(stage) }}</dd>
        </div>
      </dl>

      <div class="funnel__columns" :aria-busy="loading">
        <section
          v-for="stage in STAGES"
          :key="stage"
          class="funnel__column"
          :class="{ 'is-drop-target': dropTarget === stage }"
          :data-stage="stage"
          :style="stageStyle(stage)"
          :aria-label="columnLabel(stage)"
          @dragover="onDragOver(stage, $event)"
          @dragleave="onDragLeave(stage)"
          @drop.prevent="onDrop(stage)"
        >
          <header class="funnel__column-head">
            <span class="funnel__dot" aria-hidden="true" />
            <h3>{{ STAGE_LABELS[stage] }}</h3>
            <span class="funnel__count num">{{ countText(stage) }}</span>
          </header>
          <!-- 找姓名時沒有符合的欄不寫園務的空狀態，免得像是這一欄本來就空。 -->
          <p v-if="filtering && !visibleCards(stage).length" class="hint funnel__empty">沒有符合「{{ keyword }}」的卡片</p>
          <p v-else-if="!count(stage)" class="hint funnel__empty">{{ STAGE_EMPTY_TEXT[stage] }}</p>
          <div v-else class="funnel__cards">
            <FunnelCard
              v-for="card in visibleCards(stage)"
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
  align-items: flex-start;
}

.funnel__overview {
  display: grid;
  flex: 1 1 320px;
  gap: 2px;
  min-width: 0;
}

.funnel__note {
  margin: 0;
}

.funnel__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.funnel__actions .el-button + .el-button {
  margin-left: 0;
}

.funnel__search {
  width: 200px;
}

.funnel__notice {
  margin-bottom: 16px;
}

.funnel__stats {
  display: none;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0 0 16px;
}

.funnel__stat {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.funnel__stat dt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.funnel__stat dd {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-lg);
  font-weight: 600;
}

.funnel__rates {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
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
  /* 欄位被 min-height 撐高時不把多出來的高度分給標題列，各欄標題才會對齊。 */
  align-content: start;
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
  font-size: var(--text-base);
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
  font-size: var(--text-xs);
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

  .funnel__stats {
    display: flex;
  }
}

@media (max-width: 720px) {
  .funnel__actions {
    width: 100%;
  }

  .funnel__search {
    flex: 1 1 140px;
    width: auto;
  }

  .funnel__columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .funnel__column {
    min-height: 0;
  }
}
</style>
