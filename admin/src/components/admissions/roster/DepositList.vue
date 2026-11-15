<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { Roster, RosterStudent } from '../../../api/roster'
import { GRADE_ORDER, markOf, pendingStudents, rocDate } from '../../../admissions/roster'

// 預繳名單（2026-11-15，規格 §8.2）：三組（Y 上、Y 下、Y+1 上）× 四個年級，另有「已離園、已退預繳」清單。
// 缺入學學期的預繳生另列一組，不會憑空消失。點姓名開同一個選單。
const props = defineProps<{ roster: Roster; canWrite: boolean }>()
const emit = defineEmits<{
  'open-student': [id: string, anchor: HTMLElement]
  'add-deposit': []
  restore: [student: RosterStudent, classId: string | null]
}>()

type Group = { key: string; label: string; sub: string; note: string; list: RosterStudent[]; showClass: boolean }

const groups = computed<Group[]>(() => {
  const year = props.roster.school_year
  const pending = pendingStudents(props.roster)
  const on = (y: number, s: number) => pending.filter((st) => st.target_school_year === y && st.target_semester === s)
  const result: Group[] = [
    { key: 'a', label: `${year}上預繳`, sub: '12–1月入園', note: '班別是入園時的班別', list: on(year, 1), showClass: true },
    { key: 'b', label: `${year}下預繳`, sub: '2–7月入園', note: '班別是入園時的班別', list: on(year, 2), showClass: true },
    { key: 'c', label: `${year + 1}上預繳`, sub: '8月入園', note: `班別是 ${year + 1} 學年的班別`, list: on(year + 1, 1), showClass: false },
  ]
  const lost = pending.filter((st) => st.target_school_year === null || st.target_semester === null)
  if (lost.length) result.push({ key: 'x', label: '缺入學學期', sub: '補上入學學期才會算進缺額統計', note: '', list: lost, showClass: true })
  return result
})

const classCode = (student: RosterStudent) => props.roster.classes.find((room) => room.id === student.class_id)?.class_code ?? '未編班'
const columnsOf = (group: Group) => {
  const cols: { grade: string; list: RosterStudent[] }[] = GRADE_ORDER.map((grade) => ({ grade, list: group.list.filter((st) => st.grade === grade) }))
  const noGrade = group.list.filter((st) => st.grade === null)
  if (noGrade.length) cols.push({ grade: '缺班別', list: noGrade })
  return cols
}
const dateOf = (student: RosterStudent) => (student.deposit_date ? rocDate(student.deposit_date).slice(4) : '')

// ---- 已離園、已退預繳 ----
const picked = reactive<Record<string, string>>({})
const pickedClass = (id: string) => picked[id] ?? ''
function pick(id: string, event: Event) {
  picked[id] = (event.target as HTMLSelectElement).value
}
function goneText(student: RosterStudent): string {
  const base = student.grade ?? '缺班別'
  return student.status === 'left'
    ? `${base}・離園 ${student.left_date ? rocDate(student.left_date) : ''}`
    : `${base}・退預繳 ${student.refunded_date ? rocDate(student.refunded_date) : ''}`
}
function restore(student: RosterStudent) {
  if (student.status === 'refunded') emit('restore', student, null)
  else if (pickedClass(student.id)) emit('restore', student, pickedClass(student.id))
}
</script>

<template>
  <div class="roster-deps">
    <div v-if="canWrite" class="roster-deps__bar">
      <button type="button" class="roster-deps__add" @click="emit('add-deposit')">補登預繳</button>
    </div>
    <section v-for="group in groups" :key="group.key" class="roster-dep">
      <div class="roster-dep__head">
        <b>{{ group.label }}</b>
        <span>{{ group.sub }}・共 {{ group.list.length }} 人<template v-if="group.note">・{{ group.note }}・右邊是預繳日期</template></span>
      </div>
      <div class="roster-dep__grid">
        <div v-for="col in columnsOf(group)" :key="col.grade" class="roster-dep__col">
          <h4>{{ col.grade }} <span>{{ col.list.length }}</span></h4>
          <ul>
            <li v-for="(student, index) in col.list" :key="student.id">
              <button type="button" class="roster-stu" :data-student-id="student.id" @click="emit('open-student', student.id, $event.currentTarget as HTMLElement)">
                <span class="roster-stu__n">{{ index + 1 }}</span>
                <span class="roster-stu__name" :class="markOf(student) ? `is-mark-${markOf(student)}` : ''">{{ student.child_name }}</span>
                <span v-if="group.showClass && student.is_underage" class="roster-tag is-underage">不足齡</span>
                <span v-if="group.showClass" class="roster-tag">{{ classCode(student) }}</span>
                <span class="roster-stu__since">{{ dateOf(student) }}</span>
              </button>
            </li>
            <li v-if="!col.list.length" class="roster-dep__empty">—</li>
          </ul>
        </div>
      </div>
    </section>

    <details class="roster-gone">
      <summary>已離園、已退預繳（{{ roster.gone.length }}）</summary>
      <ul>
        <li v-for="student in roster.gone" :key="student.id">
          <span>{{ student.child_name }}</span>
          <span class="roster-gone__meta">{{ goneText(student) }}</span>
          <template v-if="canWrite">
            <select v-if="student.status === 'left'" aria-label="選擇要回的班級" :value="pickedClass(student.id)" @change="pick(student.id, $event)">
              <option value="">選擇班級</option>
              <option v-for="room in roster.classes" :key="room.id" :value="room.id">{{ room.name }}({{ room.class_code }})</option>
            </select>
            <button type="button" :disabled="student.status === 'left' && !pickedClass(student.id)" @click="restore(student)">恢復</button>
          </template>
        </li>
        <li v-if="!roster.gone.length" class="roster-gone__meta">沒有紀錄</li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.roster-deps__bar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px 0;
}

.roster-deps__add,
.roster-gone button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.roster-gone button:disabled {
  color: var(--ink-3);
  cursor: not-allowed;
}

.roster-dep {
  border-bottom: 1px solid var(--line);
}

.roster-dep__head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 12px 16px 8px;
}

.roster-dep__head b {
  font-size: var(--text-md);
}

.roster-dep__head span {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.roster-dep__grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(190px, 1fr);
  padding: 0 6px 10px;
  overflow-x: auto;
}

.roster-dep__col h4 {
  margin: 0;
  padding: 4px 12px;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.roster-dep__col ul {
  max-width: 270px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.roster-dep__empty {
  padding: 2px 12px;
  color: var(--ink-3);
}

.roster-stu {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-height: 30px;
  padding: 2px 10px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.roster-stu:hover,
.roster-stu:focus-visible {
  background: var(--accent-bg);
  outline: 0;
}

.roster-stu__n {
  min-width: 18px;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.roster-stu__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster-stu__since {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.roster-tag {
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--ink-2);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.roster-tag.is-underage {
  border-color: var(--warn-line);
  background: var(--warn-bg);
  color: var(--warn-ink);
}

.is-mark-new { color: var(--roster-mark-new); }
.is-mark-underage { color: var(--roster-mark-underage); }
.is-mark-sped { color: var(--roster-mark-sped); }
.is-mark-indigenous { color: var(--roster-mark-indigenous); }

.roster-gone {
  padding: 4px 16px 16px;
}

.roster-gone summary {
  padding: 8px 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  cursor: pointer;
}

.roster-gone ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.roster-gone li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
  padding: 3px 0;
  font-size: var(--text-sm);
}

.roster-gone__meta {
  color: var(--ink-2);
}

.roster-gone select {
  height: 30px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  font: inherit;
  font-size: var(--text-sm);
}
</style>
