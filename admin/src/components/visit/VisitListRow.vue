<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { VisitRequestDetailOut } from '../../api/types'
import { campusLabel, contactTimeLabel, formatShortDateTime, formatTime, visitDisplay, visitSourceLabel } from '../../api/labels'
import { attendanceDue, type AttendanceKind } from '../../composables/visitAttendance'
import { followUpDue, shortDay, taipeiDay, VISIT_PHASE_LABELS, visitPhase } from '../../utils/visitSchedule'

// 行程清單的一列（2026-10-06 方向 B）：時間＋接待狀態、家長・孩子、校區、電話、快速動作。
// 「到了／沒來」「填招生資料」與電話不包在連結裡（第九輪）；點列的空白處等同點家長名字。
// previewable（1280 以上）：沒按修飾鍵的左鍵點擊開右側預覽，⌘／Ctrl／中鍵照常開新分頁。
const props = defineProps<{
  row: VisitRequestDetailOut
  now: number
  to: RouteLocationRaw
  /** 今天／明天／昨天分組：時間欄只寫幾點 */
  dayOnly: boolean
  /** 照送出時間排（不分日期組）：寫「09/28 21:41 送出」 */
  showCreated: boolean
  multiCampus: boolean
  selected: boolean
  previewable: boolean
  canHandle: boolean
  canFillAdmissions: boolean
  batch: boolean
  checked: boolean
  busy: boolean
  locked: boolean
}>()
const emit = defineEmits<{ activate: []; attendance: [kind: AttendanceKind]; fill: []; toggle: [on: boolean] }>()

const phase = computed(() => visitPhase(props.row, props.now))
const stateLabel = computed(() => (phase.value === 'cancelled' ? visitDisplay(props.row).sub || '已取消' : VISIT_PHASE_LABELS[phase.value]))
const showAttendance = computed(() => props.canHandle && attendanceDue(props.row, props.now))
const showFill = computed(() => props.canFillAdmissions && props.row.status === 'completed')
const manualSource = computed(() => (props.row.source && props.row.source !== 'web' ? `${visitSourceLabel(props.row.source)}補登` : ''))
const followDue = computed(() => followUpDue(props.row, props.now))
const timeMain = computed(() => {
  const slot = props.row.slot
  if (!slot) return '沒有場次'
  return props.dayOnly ? formatTime(slot.start_time) : shortDay(slot.slot_date, taipeiDay(props.now))
})
const timeSub = computed(() => {
  const slot = props.row.slot
  return slot && !props.dayOnly ? `${formatTime(slot.start_time)}–${formatTime(slot.end_time)}` : ''
})

function onLinkClick(event: MouseEvent, navigate: (e?: MouseEvent) => unknown) {
  if (props.previewable && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    emit('activate')
    return
  }
  void navigate(event)
}

// 勾選框所在的格子（.visit-row__check）點歪了不算點進案件（原本表格勾選欄的規則）。
function onRowClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label, .el-checkbox, .visit-row__check')) return
  emit('activate')
}
</script>

<template>
  <li class="visit-row" :class="{ 'is-selected': selected, 'has-check': batch }" :data-phase="phase" @click="onRowClick">
    <span v-if="batch" class="visit-row__check">
      <el-checkbox
        v-if="showAttendance"
        :model-value="checked"
        :disabled="locked"
        :aria-label="`勾選 ${row.parent_name}`"
        @update:model-value="(on: string | number | boolean) => emit('toggle', Boolean(on))"
      />
    </span>
    <router-link v-slot="{ href, navigate }" :to="to" custom>
      <a :href="href" class="visit-row__main" :aria-current="selected ? 'true' : undefined" @click="onLinkClick($event, navigate)">
        <span class="visit-row__time">
          <b class="num">{{ timeMain }}</b>
          <small v-if="timeSub" class="num">{{ timeSub }}</small>
          <small v-if="stateLabel" class="visit-row__state" :data-phase="phase">{{ stateLabel }}</small>
        </span>
        <span class="visit-row__who">
          <span class="visit-row__name"><b>{{ row.parent_name }}</b><span class="visit-row__child">・{{ row.child_name || '孩子姓名未填寫' }}</span></span>
          <span v-if="multiCampus || manualSource" class="visit-row__meta">
            <span v-if="multiCampus" class="visit-row__campus-inline">{{ campusLabel(row.campus_key) }}校{{ manualSource ? ' · ' : '' }}</span>{{ manualSource }}
          </span>
          <span v-if="row.follow_up_at" class="visit-row__follow num" :class="{ 'is-due': followDue }">{{ followDue ? '到期待追蹤' : '預定聯絡' }} {{ formatShortDateTime(row.follow_up_at) }}</span>
          <span v-if="row.preferred_time" class="visit-row__meta">方便接電話時段：{{ contactTimeLabel(row.preferred_time) }}</span>
          <span v-if="showCreated" class="visit-row__meta num">{{ formatShortDateTime(row.created_at) }} 送出</span>
        </span>
      </a>
    </router-link>
    <span v-if="multiCampus" class="visit-row__campus">{{ campusLabel(row.campus_key) }}</span>
    <a class="visit-row__phone num" :href="`tel:${row.phone}`">{{ row.phone }}</a>
    <span class="visit-row__acts">
      <span v-if="showAttendance" class="attendance-actions" role="group" :aria-label="`${row.parent_name} 到了嗎？`">
        <el-button size="small" type="primary" plain :loading="busy" :disabled="locked" :aria-label="`標記 ${row.parent_name} 已到場`" @click="emit('attendance', 'complete')">到了</el-button>
        <el-button size="small" :disabled="locked" :aria-label="`標記 ${row.parent_name} 未到場`" @click="emit('attendance', 'no_show')">沒來</el-button>
      </span>
      <el-button v-else-if="showFill" size="small" link type="primary" :aria-label="`填招生資料：${row.parent_name}`" @click="emit('fill')">填招生資料</el-button>
    </span>
  </li>
</template>

<style scoped>
.visit-row {
  /* 勾選欄寬與欄距綁成變數：手機版主連結的 flex-basis、電話的縮排都要算進它們，否則主連結被擠到下一行。 */
  --check-w: 28px;
  --gap-x: 16px;

  display: flex;
  align-items: center;
  gap: 12px var(--gap-x);
  padding: 12px 18px;
  cursor: pointer;
}

.visit-row + .visit-row {
  border-top: 1px solid var(--line);
}

.visit-row:hover {
  background: var(--surface-2);
}

.visit-row.is-selected {
  background: var(--el-color-primary-light-9);
}

/* 選取列的底色是淺主色，預設連結色（accent-strong）在上面對比只有 4.43:1，要 4.5:1。 */
.visit-row.is-selected .visit-row__phone {
  color: var(--admin-accent-hover);
}

.visit-row__check {
  flex: none;
  width: var(--check-w);
}

.visit-row__main {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.visit-row__main:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.visit-row__time {
  display: grid;
  align-content: start;
  gap: 2px;
}

.visit-row__time b {
  font-weight: 700;

  /* 時間欄窄（手機 88px）：「10/01（週四）」「2025/12/31（週三）」只在「（」前換行，不把「週／四」拆成兩行。 */
  word-break: keep-all;
}

.visit-row__time small,
.visit-row__meta {
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.visit-row__state[data-phase='ended'] {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.visit-row__state[data-phase='ongoing'] {
  color: var(--status-live-ink);
  font-weight: 600;
}

.visit-row__who {
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.visit-row__name b {
  font-weight: 600;
}

.visit-row__child {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.visit-row__campus-inline {
  display: none;
}

.visit-row__follow {
  font-size: var(--text-xs);
  color: var(--ink-2);
  word-break: keep-all;
}

.visit-row__follow.is-due {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.visit-row__campus {
  flex: none;
  width: 40px;
  color: var(--ink-2);
}

.visit-row__phone {
  flex: none;
  width: 112px;
  font-variant-numeric: tabular-nums;
}

.visit-row__acts {
  display: flex;
  flex: none;
  justify-content: flex-end;
  min-width: 112px;
}

.attendance-actions {
  display: flex;
  gap: 6px;
}

.attendance-actions .el-button + .el-button {
  margin-left: 0;
}

/* 右側預覽打開、清單變窄時（容器查詢，外層 .visit-list）：校區欄併進家長那一格。 */
@container visit-list (max-width: 640px) {
  .visit-row__campus {
    display: none;
  }

  .visit-row__campus-inline {
    display: inline;
  }
}

/* 中寬（桌機寬度但右側預覽打開、清單約 540px）：電話不獨佔一欄，掉到家長那一欄的第三行
   （家長・孩子／校區・來源／電話），家長那一欄吃剩下的寬度，到了／沒來留在右側。
   手機（720px 以下）有自己的卡片版面，這裡不管。 */
@media (min-width: 721px) {
  @container visit-list (max-width: 640px) {
    .visit-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0 var(--gap-x);
    }

    .visit-row.has-check {
      grid-template-columns: var(--check-w) minmax(0, 1fr) auto;
    }

    .visit-row__check {
      grid-row: 1 / span 2;
      grid-column: 1;
    }

    .visit-row__main {
      grid-row: 1;
      grid-column: 1;
    }

    .visit-row.has-check .visit-row__main {
      grid-column: 2;
    }

    /* 縮排對齊家長那一欄：時間欄 120px＋主連結的欄距 12px。justify-self 不讓電話連結撐滿整格（點空白處會撥號）。 */
    .visit-row__phone {
      grid-row: 2;
      grid-column: 1;
      justify-self: start;
      width: auto;
      margin: 2px 0 0 132px;
    }

    .visit-row.has-check .visit-row__phone {
      grid-column: 2;
    }

    .visit-row__acts {
      grid-row: 1 / span 2;
      grid-column: 2;
      min-width: 0;
    }

    .visit-row.has-check .visit-row__acts {
      grid-column: 3;
    }
  }
}

/* 桌機寬度、名字欄被擠窄時（預覽打開、勾選框、長名字），孩子名整段一起換行，不從中間斷開（「測／試寶貝」）。 */
@media (min-width: 721px) {
  .visit-row__child {
    display: inline-block;
  }
}

/* 手機卡片：時間欄 88px 不折行，電話 44px 好點，到了／沒來各占一半。 */
@media (max-width: 720px) {
  .visit-row {
    flex-wrap: wrap;
    padding: 12px 14px;
  }

  .visit-row__main {
    flex-basis: calc(100% - var(--check-w) - var(--gap-x));
    grid-template-columns: 88px minmax(0, 1fr);
  }

  .visit-row:not(.has-check) .visit-row__main {
    flex-basis: 100%;
  }

  .visit-row__campus {
    display: none;
  }

  .visit-row__campus-inline {
    display: inline;
  }

  .visit-row__phone {
    display: inline-flex;
    align-items: center;
    width: auto;
    min-height: 44px;
    margin-left: 100px;
    text-decoration: underline;
  }

  /* 勾選欄佔了行首：電話仍要對齊家長那一欄（時間欄 88px＋欄距 12px 之後）。 */
  .visit-row.has-check .visit-row__phone {
    margin-left: calc(100px + var(--check-w) + var(--gap-x));
  }

  .visit-row__acts {
    flex-basis: 100%;
    justify-content: stretch;
  }

  .attendance-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }

  .visit-row__acts .el-button {
    min-height: 44px;
  }
}
</style>
