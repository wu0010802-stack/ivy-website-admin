<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Roster, RosterClassWithStudents, RosterStudent } from '../../../api/roster'
import { GRADE_ORDER, gapText, markOf, planText, sideParts } from '../../../admissions/roster'
import { useNumberDrafts } from './numberDrafts'

// 編班表（2026-11-15，規格 §8.1）：照各校原本的 Excel 編班表，一班一欄（姓名＋備註欄），年級分底色。
// 這個元件只畫畫面並把動作用事件交出去，資料與 API 由 RosterTab 管。數字全由後端算好。
// discard：動作被後端擋下時由 RosterTab 遞增，班級目標輸入框丟掉還沒存進去的字。
const props = defineProps<{ roster: Roster; canWrite: boolean; discard?: number }>()
const emit = defineEmits<{
  'open-student': [id: string, anchor: HTMLElement]
  'edit-student': [id: string]
  'edit-class': [id: string]
  'set-class-target': [classId: string, value: number | null]
  // 拖拉：classId 是 null＝拖回還沒編班；position 是目的班的第幾位（0 起算，超過就排最後）。
  move: [id: string, classId: string | null, position: number]
  // 格內新增（貼上多行＝多位）。
  add: [classId: string, names: string[]]
}>()

const MIN_ROWS = 31
const GRADE_SHORT: Record<string, string> = { 大班: '大', 中班: '中', 小班: '小', 幼幼班: '幼' }
const gradeIndex = (grade: string) => GRADE_ORDER.indexOf(grade as (typeof GRADE_ORDER)[number])

// 年級依序大中小幼，同年級照後端給的順序。
const classes = computed<RosterClassWithStudents[]>(() =>
  props.roster.classes
    .map((room, order) => ({ room, order }))
    .sort((a, b) => gradeIndex(a.room.grade) - gradeIndex(b.room.grade) || a.order - b.order)
    .map(({ room }) => room),
)
const startsGrade = (room: RosterClassWithStudents, index: number) => index === 0 || classes.value[index - 1]!.grade !== room.grade
const rowCount = computed(() =>
  Math.max(MIN_ROWS, props.roster.next_year.length + 1, ...classes.value.map((room) => room.students.length + 1)),
)
const nextHead = computed(() => `${props.roster.school_year + 1}/8月`)
const classLabel = (room: RosterClassWithStudents) => `${room.name}(${room.class_code})`

const gradeGroups = computed(() =>
  GRADE_ORDER.map((grade) => ({ grade, rooms: classes.value.filter((room) => room.grade === grade) }))
    .filter((group) => group.rooms.length > 0)
    .map((group) => ({ ...group, totals: props.roster.grade_totals[group.grade]! })),
)
const total = computed(() => classes.value.reduce((sum, room) => sum + room.count, 0))
const unassignedCount = computed(() => props.roster.unassigned.length)

const markClass = (student: RosterStudent) => {
  const mark = markOf(student)
  return mark ? `is-mark-${mark}` : ''
}
const side = (student: RosterStudent, grade: string) => sideParts(student, grade, props.roster.today, props.roster.school_year)

// 還沒編班的預繳生：班別與入園時段；缺的項目寫出來。
function termText(student: RosterStudent): string {
  if (student.planned_entry_date) return `${planText(student.planned_entry_date, props.roster.today)} 入園`
  const { target_school_year: year, target_semester: semester } = student
  if (year === null || semester === null) return '缺入學學期'
  const current = props.roster.school_year
  if (year === current && semester === 1) return '12–1月入園'
  if (year === current && semester === 2) return '2–7月入園'
  if (year === current + 1 && semester === 1) return '8月入園'
  return `${year} 學年${semester === 1 ? '上' : '下'}學期`
}

// ---- 格內新增：點班級最後一格空白，Enter 新增並停在下一格，貼上多行一次新增多位 ----
const adding = ref<string | null>(null)
const draft = ref('')
// 送出後輸入框會隨重讀搬到下一格；瀏覽器在移除舊輸入框時可能先送 blur，那一次不該收起。
let justSubmitted = false
const vFocus = { mounted: (el: HTMLElement) => { justSubmitted = false; el.focus() } }
const splitNames = (text: string) => text.split(/[\r\n\t]+/).map((name) => name.trim()).filter(Boolean)

function startAdd(room: RosterClassWithStudents) {
  if (!props.canWrite) return
  adding.value = room.id
  draft.value = ''
}
function submitDraft(room: RosterClassWithStudents) {
  const names = splitNames(draft.value)
  draft.value = ''
  if (!names.length) return
  justSubmitted = true
  emit('add', room.id, names)
}
function pasteInto(room: RosterClassWithStudents, event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  if (!/[\r\n\t]/.test(text.trim())) return
  event.preventDefault()
  const names = splitNames(text)
  if (!names.length) return
  justSubmitted = true
  emit('add', room.id, names)
}
function leaveAdd(room: RosterClassWithStudents) {
  if (justSubmitted) {
    justSubmitted = false
    return
  }
  if (draft.value.trim()) submitDraft(room)
  adding.value = null
}
function cancelAdd() {
  draft.value = ''
  adding.value = null
}

// ---- 拖拉（原生 HTML5 drag and drop，沿用 FunnelBoard 的寫法）----
const dragging = ref<string | null>(null)
const dropKey = ref<string | null>(null)

function startDrag(event: DragEvent, student: RosterStudent) {
  if (!props.canWrite) return
  dragging.value = student.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', student.id)
  }
}
function endDrag() {
  dragging.value = null
  dropKey.value = null
}
function overDrop(key: string, event: DragEvent) {
  if (!dragging.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropKey.value = key
}
function dropOn(classId: string | null, position: number) {
  const id = dragging.value
  endDrag()
  if (id) emit('move', id, classId, position)
}

function openStudent(event: MouseEvent, student: RosterStudent) {
  emit('open-student', student.id, event.currentTarget as HTMLElement)
}
// 班級目標：連續改好幾班時，重讀回來不能把下一班正在打的數字清掉（見 numberDrafts）。
const targets = useNumberDrafts((id) => props.roster.classes.find((room) => room.id === id)?.target_seats, () => props.roster, () => props.discard)
function changeTarget(room: RosterClassWithStudents, event: Event) {
  emit('set-class-target', room.id, targets.take(room.id, event))
}
</script>

<template>
  <div class="roster">
    <p class="roster-hint">
      <span v-if="canWrite">姓名可以直接拖到別班，或在同一班上下拖動調整順序；點姓名看資料與操作。</span>
      <span class="roster-legend">
        <b class="is-mark-new">綠＝新生</b><b class="is-mark-underage">橘＝不足齡</b><b class="is-mark-sped">紫＝特教生</b><b class="is-mark-indigenous">藍＝原住民</b>
      </span>
      <span><i class="roster-swatch" aria-hidden="true"></i>已預繳、還沒入園</span>
    </p>

    <div
      class="roster-tray"
      :class="{ 'is-drop': dropKey === 'tray' }"
      data-roster-tray
      @dragover="overDrop('tray', $event)"
      @dragleave="dropKey = null"
      @drop.prevent="dropOn(null, 0)"
    >
      <b>還沒編班的預繳生</b>
      <template v-if="roster.unassigned.length">
        <button
          v-for="student in roster.unassigned"
          :key="student.id"
          type="button"
          class="roster-chip"
          :class="markClass(student)"
          :draggable="canWrite"
          :data-student-id="student.id"
          @click="openStudent($event, student)"
          @dragstart="startDrag($event, student)"
          @dragend="endDrag"
        >{{ student.child_name }}<small>{{ student.grade ?? '缺班別' }}・{{ termText(student) }}</small></button>
      </template>
      <span v-else class="roster-muted">目前沒有。看板新增的預繳生會先出現在這裡，再拖進班級。</span>
    </div>

    <div class="roster-scroll">
      <table class="roster-table">
        <colgroup>
          <col class="roster-col-rn" />
          <template v-for="room in classes" :key="room.id"><col class="roster-col-name" /><col class="roster-col-note" /></template>
          <col class="roster-col-next" />
        </colgroup>
        <thead>
          <tr class="roster-row-class">
            <th class="roster-rn">班級</th>
            <th
              v-for="(room, index) in classes"
              :key="room.id"
              colspan="2"
              class="roster-ch"
              :class="[`is-grade-${gradeIndex(room.grade)}`, { 'is-grade-start': startsGrade(room, index), 'is-editable': canWrite, 'is-drop': dropKey === `head:${room.id}` }]"
              :data-class-id="room.id"
              @click="canWrite && emit('edit-class', room.id)"
              @dragover="overDrop(`head:${room.id}`, $event)"
              @dragleave="dropKey = null"
              @drop.prevent="dropOn(room.id, room.count)"
            >{{ classLabel(room) }}<small v-if="room.english_name">{{ room.english_name }}</small></th>
            <th class="roster-next-head is-grade-next is-grade-start">{{ nextHead }}</th>
          </tr>
          <tr>
            <th class="roster-rn">班導</th>
            <th v-for="(room, index) in classes" :key="room.id" colspan="2" :class="[`is-grade-${gradeIndex(room.grade)}`, { 'is-grade-start': startsGrade(room, index) }]">{{ room.head_teacher }}</th>
            <th class="is-grade-next is-grade-start"></th>
          </tr>
          <tr>
            <th class="roster-rn">副班導</th>
            <th v-for="(room, index) in classes" :key="room.id" colspan="2" :class="[`is-grade-${gradeIndex(room.grade)}`, { 'is-grade-start': startsGrade(room, index) }]">{{ room.assistant_teacher }}</th>
            <th class="is-grade-next is-grade-start"></th>
          </tr>
          <tr>
            <th class="roster-rn">美師</th>
            <th v-for="(room, index) in classes" :key="room.id" colspan="2" :class="[`is-grade-${gradeIndex(room.grade)}`, { 'is-grade-start': startsGrade(room, index) }]">{{ room.english_teacher }}</th>
            <th class="is-grade-next is-grade-start"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rowCount" :key="row">
            <th class="roster-rn">{{ row }}</th>
            <template v-for="(room, index) in classes" :key="room.id">
              <template v-if="room.students[row - 1]">
                <td
                  class="roster-name"
                  :class="{ 'is-pending': room.students[row - 1]!.status === 'pending', 'is-grade-start': startsGrade(room, index), 'is-drop': dropKey === `${room.id}:${row - 1}` }"
                  :data-class-id="room.id"
                  :data-index="row - 1"
                  @dragover="overDrop(`${room.id}:${row - 1}`, $event)"
                  @dragleave="dropKey = null"
                  @drop.prevent="dropOn(room.id, row - 1)"
                >
                  <button
                    type="button"
                    class="roster-kid"
                    :class="[markClass(room.students[row - 1]!), { 'is-dragging': dragging === room.students[row - 1]!.id }]"
                    :draggable="canWrite"
                    :data-student-id="room.students[row - 1]!.id"
                    @click="openStudent($event, room.students[row - 1]!)"
                    @dragstart="startDrag($event, room.students[row - 1]!)"
                    @dragend="endDrag"
                  >{{ room.students[row - 1]!.child_name }}</button>
                </td>
                <td
                  class="roster-note"
                  :class="{ 'is-pending': room.students[row - 1]!.status === 'pending', 'is-drop': dropKey === `${room.id}:${row - 1}` }"
                  :data-class-id="room.id"
                  :data-index="row - 1"
                  :title="canWrite ? '點一下編輯資料' : undefined"
                  @click="canWrite && emit('edit-student', room.students[row - 1]!.id)"
                  @dragover="overDrop(`${room.id}:${row - 1}`, $event)"
                  @dragleave="dropKey = null"
                  @drop.prevent="dropOn(room.id, row - 1)"
                ><template v-for="parts in [side(room.students[row - 1]!, room.grade)]" :key="0">{{ parts.text }}<span v-for="label in parts.labels" :key="label" class="roster-label">{{ label }}</span></template></td>
              </template>
              <template v-else-if="adding === room.id && row - 1 === room.students.length">
                <td class="roster-name" :class="{ 'is-grade-start': startsGrade(room, index) }" colspan="2" :data-class-id="room.id" :data-index="row - 1">
                  <input
                    v-model="draft"
                    v-focus
                    class="roster-cell-input"
                    placeholder="輸入姓名按 Enter，可貼上整欄"
                    aria-label="新增幼生姓名"
                    @keydown.enter.prevent="submitDraft(room)"
                    @keydown.esc="cancelAdd"
                    @paste="pasteInto(room, $event)"
                    @blur="leaveAdd(room)"
                  />
                </td>
              </template>
              <template v-else>
                <td
                  class="roster-name"
                  :class="{ 'is-grade-start': startsGrade(room, index), 'is-add': canWrite && row - 1 === room.students.length, 'is-drop': dropKey === `${room.id}:${row - 1}` }"
                  :data-class-id="room.id"
                  :data-index="row - 1"
                  :title="canWrite && row - 1 === room.students.length ? '點一下新增幼生' : undefined"
                  @click="row - 1 === room.students.length && startAdd(room)"
                  @dragover="overDrop(`${room.id}:${row - 1}`, $event)"
                  @dragleave="dropKey = null"
                  @drop.prevent="dropOn(room.id, row - 1)"
                ></td>
                <td
                  class="roster-note"
                  :class="{ 'is-drop': dropKey === `${room.id}:${row - 1}` }"
                  :data-class-id="room.id"
                  :data-index="row - 1"
                  @dragover="overDrop(`${room.id}:${row - 1}`, $event)"
                  @dragleave="dropKey = null"
                  @drop.prevent="dropOn(room.id, row - 1)"
                ></td>
              </template>
            </template>
            <td class="roster-next is-grade-start">
              <button
                v-if="roster.next_year[row - 1]"
                type="button"
                class="roster-kid is-mark-new"
                :data-student-id="roster.next_year[row - 1]!.id"
                @click="openStudent($event, roster.next_year[row - 1]!)"
              >{{ roster.next_year[row - 1]!.child_name }}({{ GRADE_SHORT[roster.next_year[row - 1]!.grade ?? ''] ?? '?' }})</button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="roster-rn">合計</th>
            <td v-for="(room, index) in classes" :key="room.id" colspan="2" :class="{ 'is-grade-start': startsGrade(room, index) }">{{ room.count }}</td>
            <td class="is-grade-start">{{ roster.next_year.length }}</td>
          </tr>
          <tr class="roster-sub">
            <th class="roster-rn">目標</th>
            <td v-for="(room, index) in classes" :key="room.id" colspan="2" :class="{ 'is-grade-start': startsGrade(room, index) }">
              <input
                v-if="canWrite"
                type="number"
                min="0"
                inputmode="numeric"
                class="roster-target"
                :aria-label="`${classLabel(room)}目標人數`"
                :value="targets.text(room.id)"
                @input="targets.take(room.id, $event)"
                @change="changeTarget(room, $event)"
              />
              <template v-else>{{ room.target_seats ?? '—' }}</template>
            </td>
            <td class="is-grade-start"></td>
          </tr>
          <tr class="roster-sub">
            <th class="roster-rn">缺額</th>
            <td v-for="(room, index) in classes" :key="room.id" colspan="2" :class="{ 'is-grade-start': startsGrade(room, index) }">
              <span :class="`is-gap-${gapText(room.gap).kind}`">{{ gapText(room.gap).text }}</span>
            </td>
            <td class="is-grade-start"></td>
          </tr>
          <tr>
            <th class="roster-rn">總計</th>
            <td v-for="group in gradeGroups" :key="group.grade" :colspan="group.rooms.length * 2" class="is-grade-start">{{ group.totals.count }}<small>舊生 {{ group.totals.returning }}、新生 {{ group.totals.new }}<template v-if="group.totals.pending">（其中還沒入園 {{ group.totals.pending }}）</template></small></td>
            <td class="is-grade-start"></td>
          </tr>
          <tr>
            <th class="roster-rn">總計</th>
            <td :colspan="classes.length * 2" class="is-grade-start">{{ total }}<small v-if="unassignedCount">另有 {{ unassignedCount }} 位預繳生還沒編班</small></td>
            <td class="is-grade-start"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.roster-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  align-items: center;
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.roster-legend b {
  margin-right: 14px;
  font-weight: 600;
}

.roster-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 4px;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  background: var(--roster-pending-bg);
  vertical-align: -2px;
}

.roster-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}

.roster-tray > b {
  margin-right: 4px;
  font-size: var(--text-sm);
  font-weight: 600;
}

.roster-tray.is-drop {
  background: var(--accent-bg);
  outline: 2px dashed var(--admin-accent);
  outline-offset: -4px;
}

.roster-muted {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.roster-chip {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--roster-pending-bg);
  font-size: var(--text-base);
  cursor: pointer;
}

.roster-chip small {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.roster-scroll {
  max-height: min(82vh, 1040px);
  overflow: auto;
}

.roster-table {
  width: max-content;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.roster-col-rn { width: 56px; }
.roster-col-name { width: 86px; }
.roster-col-note { width: 104px; }
.roster-col-next { width: 128px; }

.roster-table th,
.roster-table td {
  height: 30px;
  padding: 0;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  font-weight: 400;
}

.roster-table thead {
  position: sticky;
  top: 0;
  z-index: 3;
}

.roster-table thead th {
  padding: 5px 6px;
  font-size: var(--text-sm);
  line-height: 1.35;
  text-align: center;
}

.roster-row-class th {
  font-size: var(--text-base);
  font-weight: 700;
}

.roster-row-class th small {
  display: block;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: 400;
}

.roster-ch.is-editable {
  cursor: pointer;
}

.roster-rn {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--surface-2) !important;
  border-right: 1px solid var(--line-strong) !important;
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: center;
}

thead .roster-rn {
  z-index: 4;
}

.is-grade-start {
  border-left: 2px solid var(--line-strong);
}

.is-grade-0 { background: var(--roster-grade-1) !important; }
.is-grade-1 { background: var(--roster-grade-2) !important; }
.is-grade-2 { background: var(--roster-grade-3) !important; }
.is-grade-3,
.is-grade-next { background: var(--roster-grade-4) !important; }

.roster-table td.is-pending {
  background: var(--roster-pending-bg);
}

.roster-note {
  padding: 0 4px !important;
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.roster-name,
.roster-next {
  white-space: nowrap;
}

.roster-next {
  padding: 0 8px !important;
}

.roster-kid {
  display: block;
  width: 100%;
  max-width: 100%;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  line-height: 29px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.roster-kid[draggable='true'] {
  cursor: grab;
}

.roster-kid.is-dragging {
  opacity: 0.35;
}

.roster-table th.is-drop {
  box-shadow: inset 0 -3px 0 var(--admin-accent);
}

.roster-table td.is-drop {
  box-shadow: inset 0 3px 0 var(--admin-accent);
}

.roster-name.is-add {
  cursor: cell;
}

.roster-name.is-add:hover {
  background: var(--accent-bg);
}

.roster-name.is-add:hover::after {
  padding-left: 8px;
  color: var(--admin-accent-hover);
  content: '＋ 新增';
  font-size: var(--text-xs);
}

.roster-cell-input {
  width: 100%;
  height: 29px;
  padding: 0 6px;
  border: 0;
  outline: 2px solid var(--admin-accent);
  outline-offset: -2px;
  background: var(--surface);
  font: inherit;
  font-size: var(--text-base);
}

.roster-kid:hover,
.roster-kid:focus-visible {
  background: var(--accent-bg);
  outline: 0;
}

.is-mark-new { color: var(--roster-mark-new); }
.is-mark-underage { color: var(--roster-mark-underage); }
.is-mark-sped { color: var(--roster-mark-sped); }
.is-mark-indigenous { color: var(--roster-mark-indigenous); }

.roster-label {
  display: inline-block;
  margin-left: 2px;
  padding: 0 3px;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  color: var(--ink-2);
  line-height: 16px;
}

.roster-table tfoot th,
.roster-table tfoot td {
  height: 34px;
  background: var(--surface-2);
  font-weight: 700;
  text-align: center;
}

.roster-table tfoot small {
  margin-left: 8px;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: 400;
}

.roster-sub th,
.roster-sub td {
  font-weight: 400;
}

.roster-target {
  width: 52px;
  height: 26px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: var(--warn-bg);
  font: inherit;
  font-weight: 700;
  text-align: center;
}

.is-gap-short { color: var(--danger-ink); font-weight: 700; }
.is-gap-over { color: var(--status-live-ink); font-weight: 700; }
.is-gap-full { font-weight: 700; }
</style>
