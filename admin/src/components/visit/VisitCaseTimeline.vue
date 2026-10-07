<script setup lang="ts">
import { computed } from 'vue'
import { formatDateTime } from '../../api/labels'
import { buildTimeline } from '../../api/visitTimeline'
import { arrivedAt } from '../../admissions/family'
import { injectVisitCase } from '../../composables/useVisitCase'

// 時間線（2026-10-06 方向 C）：聯絡紀錄與案件歷程合成一條，新的在上，輸入框固定在最上面。
// 家庭版面再併入參觀後聯絡與招生事件，沿用家庭頁規則：沒有輸入框（參觀後用處理區的「記錄聯絡」）。
// limit：預覽面板只列最新幾筆，其餘請打開完整案件頁（fullPath）。
const props = withDefaults(defineProps<{ limit?: number; fullPath?: string }>(), { limit: 0, fullPath: '' })
const vc = injectVisitCase()

const entries = computed(() => {
  const history = vc.detail?.history ?? []
  return buildTimeline({
    notes: vc.notes,
    history,
    staff: vc.staff,
    family: vc.familyVisit ? { logs: vc.familyLogs, events: vc.familyEvents, arrivedAt: arrivedAt(history) } : undefined,
  })
})
const shown = computed(() => (props.limit > 0 ? entries.value.slice(0, props.limit) : entries.value))
const hidden = computed(() => entries.value.length - shown.value.length)
const composing = computed(() => vc.canHandle && !vc.familyVisit)
// 招生那邊的紀錄讀不到時，清單空著不代表「還沒有紀錄」：只寫讀不到，由重新載入處理。
const historyFailed = computed(() => !!vc.familyVisit && (vc.extrasFailed.logs || vc.extrasFailed.events))

// 日期選擇器不給過去的時間：「下次聯絡」記在昨天沒有意義。
function disablePast(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

// 家長常說「明天再打」「過幾天」「下週」：一鍵帶入，時間都放上午 10 點。
function daysLaterAtTen(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(10, 0, 0, 0)
  return date
}

const followUpShortcuts = [
  { text: '明天 10:00', value: () => daysLaterAtTen(1) },
  { text: '3 天後', value: () => daysLaterAtTen(3) },
  // 週日按「下週一」是明天；週一按是七天後。
  { text: '下週一', value: () => daysLaterAtTen((8 - new Date().getDay()) % 7 || 7) },
]
</script>

<template>
  <section class="panel case-timeline detail__notes" aria-labelledby="case-timeline-title">
    <h2 id="case-timeline-title" class="visually-hidden">聯絡紀錄與案件歷程</h2>
    <div v-if="composing" class="notes__form case-timeline__compose">
      <el-input
        v-model="vc.newNote"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        placeholder="這次聯絡談了什麼？例如：已致電，家長希望週六上午，下週回覆"
        aria-label="新增聯絡紀錄"
        @keydown.meta.enter="vc.addNote()"
        @keydown.ctrl.enter="vc.addNote()"
      />
      <div class="notes__row">
        <span v-if="!vc.followUpTracked" class="hint notes__untracked">
          已到場或已取消的案件不會列入到期待追蹤。
        </span>
        <label v-else class="notes__follow">
          <span>下次聯絡</span>
          <el-date-picker
            v-model="vc.followUpAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss+08:00"
            format="MM/DD HH:mm"
            placeholder="不用再追"
            :disabled-date="disablePast"
            :default-time="new Date(2000, 0, 1, 10, 0, 0)"
            :shortcuts="followUpShortcuts"
            popper-class="notes__follow-popper"
            clearable
            style="width: 160px"
          />
        </label>
        <el-button type="primary" plain :loading="vc.pendingAction === 'note'" :disabled="!vc.newNote.trim() || vc.busy" @click="vc.addNote()">新增紀錄</el-button>
        <span class="hint notes__hint">按 ⌘／Ctrl＋Enter 也能送出</span>
      </div>
      <!-- 報讀區一直留在頁面上，提示出現或消失時報讀軟體才會念出來。 -->
      <div class="notes__status" role="status">
        <p v-if="vc.followUpPast" class="field-help notes__past">
          下次聯絡的時間已經過了：不改的話，記完這筆紀錄後案件仍會列在「到期待追蹤」。要再追就選新時間，不用再追就清空。
        </p>
      </div>
    </div>
    <p v-else-if="vc.familyVisit" class="hint case-timeline__note">
      參觀前記在預約、參觀後記在招生，這裡一起列{{ vc.canCreateAdmissions ? '；參觀後的聯絡用「記錄聯絡」記一筆' : '' }}。
    </p>
    <p v-if="vc.familyVisit && vc.extrasFailed.logs" class="hint case-timeline__note">
      參觀後的聯絡紀錄讀不到。<el-button link type="primary" @click="vc.family.loadExtras()">重新載入</el-button>
    </p>
    <p v-if="vc.familyVisit && vc.extrasFailed.events" class="hint case-timeline__note">
      招生的歷程讀不到。<el-button link type="primary" @click="vc.family.loadExtras()">重新載入</el-button>
    </p>

    <ol v-if="shown.length" class="case-timeline__list" aria-label="聯絡紀錄與案件歷程">
      <li
        v-for="entry in shown"
        :key="entry.key"
        class="timeline__item"
        :data-kind="entry.kind"
        :data-tone="entry.tone"
        :data-phase="entry.phase || undefined"
      >
        <span class="timeline__dot" aria-hidden="true" />
        <div class="timeline__body">
          <p class="timeline__head">
            <template v-if="entry.kind === 'note'">
              <span v-if="entry.person" class="notes__author" :title="entry.personEmail || undefined">{{ entry.person }}</span>
              <strong>{{ entry.title }}</strong>
            </template>
            <template v-else>
              <strong>{{ entry.title }}</strong>
              <span v-if="entry.person" class="timeline__actor" :title="entry.personEmail || undefined">{{ entry.person }}</span>
            </template>
            <span v-if="entry.phase" class="timeline__phase">{{ entry.phase === 'after' ? '參觀後' : '參觀前' }}</span>
            <span v-if="entry.source" class="timeline__source">{{ entry.source }}</span>
            <time class="timeline__time num">{{ formatDateTime(entry.at) }}</time>
          </p>
          <p v-if="entry.body" class="timeline__text">{{ entry.body }}</p>
          <p v-for="line in entry.lines" :key="line" class="timeline__change">{{ line }}</p>
          <p v-if="entry.reason" class="timeline__reason">原因：{{ entry.reason }}</p>
          <p v-if="entry.followUp" class="timeline__next num">{{ entry.followUp }}</p>
          <router-link v-if="entry.related" :to="`/visit-requests/${entry.related}`" class="timeline__link">查看關聯案件</router-link>
        </div>
      </li>
    </ol>
    <p v-else-if="!historyFailed" class="hint case-timeline__note">
      {{ composing ? '還沒有聯絡紀錄。每次致電或傳訊後記一筆，同事接手時才知道談到哪裡。' : '還沒有紀錄。' }}
    </p>
    <p v-if="hidden > 0 && fullPath" class="case-timeline__more">
      <router-link :to="fullPath">還有 {{ hidden }} 筆，打開完整案件頁</router-link>
    </p>
  </section>
</template>

<style scoped>
.case-timeline {
  padding: 0;
}

.case-timeline__compose {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}

.notes__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.notes__untracked {
  flex: 1 1 200px;
}

.notes__follow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.notes__hint {
  font-size: var(--text-xs);
}

.notes__past {
  margin: 0;
}

/* 報讀區沒有內容時不占位置：抵掉外層 flex 的間距（不能用 display: none，否則報讀軟體看不到它）。 */
.notes__status:empty {
  margin-top: -8px;
}

/* 觸控裝置沒有 ⌘／Ctrl 鍵，不顯示快捷鍵提示。 */
@media (hover: none), (pointer: coarse) {
  .notes__hint {
    display: none;
  }
}

.case-timeline__note {
  margin: 0;
  padding: 14px 20px 0;
}

/* 說明或空狀態是面板最後一段時，下緣補一樣的間距，不貼著面板邊。 */
.case-timeline__note:last-child {
  padding-bottom: 14px;
}

.case-timeline__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.timeline__item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.timeline__item:first-child {
  border-top: 0;
}

.timeline__dot {
  width: 10px;
  height: 10px;
  margin: 6px auto 0;
  border: 2px solid var(--line-strong);
  border-radius: 50%;
  background: var(--surface);
}

.timeline__item[data-tone='staff'] .timeline__dot {
  border-color: var(--admin-accent);
  background: var(--el-color-primary-light-9);
}

.timeline__item[data-tone='parent'] .timeline__dot {
  border-color: var(--status-live);
}

.timeline__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
  font-size: var(--text-base);
}

.timeline__head strong {
  font-weight: 600;
}

.notes__author,
.timeline__actor {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.timeline__item[data-kind='note'] .notes__author {
  color: var(--ink);
  font-size: var(--text-base);
  font-weight: 600;
}

.timeline__phase,
.timeline__source {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.timeline__time {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.timeline__text {
  margin: 4px 0 0;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.timeline__change,
.timeline__reason {
  margin: 2px 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.timeline__reason {
  white-space: pre-wrap;
}

.timeline__next {
  margin: 6px 0 0;
  color: var(--brand-gold-ink);
  font-size: var(--text-sm);
}

.timeline__link {
  display: inline-block;
  margin-top: 2px;
  font-size: var(--text-sm);
}

.case-timeline__more {
  margin: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
}

@media (max-width: 720px) {
  .case-timeline__compose,
  .case-timeline__note,
  .case-timeline__more,
  .timeline__item {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>

<style>
/* 下次聯絡的快捷選項預設排在日曆左側，面板會比手機畫面寬；窄螢幕改排在日曆上方一列。
   選擇面板掛在 body 下，scoped 樣式碰不到，用 popper-class 限定。 */
/* 觸控裝置（含平板）的快捷選項放大到 44px 高，手指點得到。 */
@media (pointer: coarse) {
  .notes__follow-popper .el-picker-panel__shortcut {
    min-height: 44px;
  }
}

@media (max-width: 480px) {
  .notes__follow-popper .el-date-picker.has-sidebar {
    width: 322px;
  }

  .notes__follow-popper .el-picker-panel__sidebar {
    position: static;
    display: flex;
    flex-wrap: wrap;
    width: auto;
    padding: 4px 8px;
    border-right: 0;
    border-bottom: 1px solid var(--el-datepicker-inner-border-color);
  }

  .notes__follow-popper .el-picker-panel__shortcut {
    width: auto;
    min-height: 44px;
    padding: 0 10px;
  }

  .notes__follow-popper .el-picker-panel__sidebar + .el-picker-panel__body {
    margin-left: 0;
  }
}
</style>
