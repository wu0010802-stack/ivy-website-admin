<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createClass, createSnapshot, createStudents, deleteClass, enterStudent, getRoster, leaveStudent, moveStudent, refundStudent, restoreStudent, saveNextYearTargets, saveTierTargets, updateClass, updateStudent,
  type ClassCreate, type ClassUpdate, type Roster, type RosterStudent, type StudentsCreate, type StudentUpdate,
} from '../../../api/roster'
import { pendingStudents } from '../../../admissions/roster'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../../../api/errors'
import { notifyError, notifyWarning } from '../../../composables/notify'
import { usePermissions } from '../../../composables/usePermissions'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import ClassDialog from './ClassDialog.vue'
import DepositDialog from './DepositDialog.vue'
import DepositList from './DepositList.vue'
import GapTable from './GapTable.vue'
import SnapshotList from './SnapshotList.vue'
import RosterTable from './RosterTable.vue'
import StudentDialog from './StudentDialog.vue'
import StudentMenu from './StudentMenu.vue'

// 編班與缺額分頁（2026-11-15，規格 §8）：持有整張編班表與統計日期，動作交給子元件回報，
// 呼叫 API 後重新讀取。數字全由後端算好，前端不重算。
const props = defineProps<{ campusKey: string; schoolYear: number | null }>()

const { can } = usePermissions()
const canWrite = computed(() => can('admissions.write'))

const roster = ref<Roster | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const asOf = ref<string | null>(null)
const requests = useRequestSequence()

async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey || props.schoolYear === null) return
  const request = requests.begin()
  if (!options.keep) roster.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getRoster(props.campusKey, props.schoolYear, asOf.value)
    if (!requests.isCurrent(request)) return
    roster.value = result
  } catch (err) {
    if (!requests.isCurrent(request)) return
    if (options.keep && roster.value) {
      // 動作後重讀、或改統計日期失敗：畫面維持原狀，只提示原因；統計日期還原成畫面上這一份的，
      // 不然之後每次重讀都帶著被擋下的日期。
      asOf.value = roster.value.as_of === roster.value.today ? null : roster.value.as_of
      notifyError(apiErrorMessage(err, '無法讀取編班表，請重新載入。'))
    } else {
      roster.value = null
      error.value = apiErrorMessage(err, '無法讀取編班表，請重新載入。')
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 換校或換學年：統計日期回到今天、重新讀取。
watch(() => [props.campusKey, props.schoolYear], () => {
  asOf.value = null
  void load()
}, { immediate: true })

/** 動作失敗時的共同處理：別人先改過、對象剛被刪就重新載入，其他原樣顯示後端的說明。 */
async function onActionError(err: unknown, fallback: string) {
  if (isVersionConflict(err) || (err as { status?: number } | null)?.status === 404) {
    notifyWarning('資料剛被其他人更新，已重新載入', { duration: 5000 })
  } else {
    notifyError(apiErrorMessage(err, fallback))
  }
  await load({ keep: true })
}

async function saveClassTarget(classId: string, value: number | null) {
  const room = roster.value?.classes.find((item) => item.id === classId)
  if (!room || room.target_seats === value) return
  try {
    await updateClass(classId, { target_seats: value, expected_version: room.version })
    await load({ keep: true })
  } catch (err) {
    await onActionError(err, '無法儲存班級目標人數。')
  }
}

// ---- 找幼生 ----
function findStudent(id: string): RosterStudent | undefined {
  const data = roster.value
  if (!data) return undefined
  for (const room of data.classes) {
    const found = room.students.find((item) => item.id === id)
    if (found) return found
  }
  return [...data.unassigned, ...data.next_year, ...data.gone].find((item) => item.id === id)
}
function classLabelOf(student: RosterStudent): string {
  const room = roster.value?.classes.find((item) => item.id === student.class_id)
  return room ? `${room.name}(${room.class_code})` : '還沒編班'
}

// ---- 格內新增 ----
async function addStudents(classId: string, names: string[]) {
  const data = roster.value
  if (!data) return
  try {
    const result = await createStudents(props.campusKey, { school_year: data.school_year, names, class_id: classId })
    if (result.duplicates?.length) notifyWarning(`已有同名幼生：${result.duplicates.join('、')}`, { duration: 6000 })
    await load({ keep: true })
  } catch (err) {
    await onActionError(err, '無法新增幼生。')
  }
}

// ---- 拖拉移動（成功後可以復原）----
async function move(id: string, classId: string | null, position: number) {
  const student = findStudent(id)
  if (!student) return
  if (classId === null && student.status === 'enrolled') {
    notifyWarning('在籍幼生不能放回還沒編班，要離園請點姓名', { duration: 5000 })
    return
  }
  const origin = { classId: student.class_id, position: student.position ?? 0 }
  try {
    const moved = await moveStudent(id, { class_id: classId, position, expected_version: student.version })
    await load({ keep: true })
    ElMessage.success({
      message: h('span', ['已移動　', h('a', {
        class: 'roster-undo',
        href: '#',
        onClick: (event: Event) => { event.preventDefault(); void undoMove(id, origin, moved.version) },
      }, '復原')]),
      duration: 6000,
    })
  } catch (err) {
    await onActionError(err, '無法移動幼生。')
  }
}
async function undoMove(id: string, origin: { classId: string | null; position: number }, version: number) {
  try {
    await moveStudent(id, { class_id: origin.classId, position: origin.position, expected_version: version })
    await load({ keep: true })
  } catch (err) {
    await onActionError(err, '無法復原。')
  }
}

// ---- 點姓名的選單 ----
const menu = ref<{ id: string; anchor: HTMLElement } | null>(null)
const menuStudent = computed(() => (menu.value ? findStudent(menu.value.id) ?? null : null))
const editingStudentId = ref<string | null>(null)
const editingStudent = computed(() => (editingStudentId.value ? findStudent(editingStudentId.value) ?? null : null))
function openMenu(id: string, anchor: HTMLElement) {
  menu.value = { id, anchor }
}
function editStudent(id: string) {
  menu.value = null
  editingStudentId.value = id
}

async function runAction(action: () => Promise<unknown>, fallback: string) {
  menu.value = null
  try {
    await action()
    await load({ keep: true })
  } catch (err) {
    await onActionError(err, fallback)
  }
}
function enter(student: RosterStudent) {
  return runAction(() => enterStudent(student.id, student.version), '無法標記已入園。')
}
async function confirmThen(student: RosterStudent, verb: '離園' | '退預繳', message: string, action: () => Promise<unknown>) {
  menu.value = null
  try {
    await ElMessageBox.confirm(message, `${student.child_name} ${verb}？`, {
      confirmButtonText: verb,
      cancelButtonText: '先不要',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
      autofocus: false,
    })
  } catch {
    return
  }
  await runAction(action, `無法標記${verb}。`)
}
function leave(student: RosterStudent) {
  return confirmThen(student, '離園', '離園後會從班級拿掉，之後可以在「已離園、已退預繳」清單恢復。', () => leaveStudent(student.id, student.version))
}
function refund(student: RosterStudent) {
  return confirmThen(student, '退預繳', '退預繳後會從班級拿掉，之後可以在「已離園、已退預繳」清單恢復。', () => refundStudent(student.id, student.version))
}
function moveToClass(student: RosterStudent, classId: string) {
  const room = roster.value?.classes.find((item) => item.id === classId)
  if (!room) return Promise.resolve()
  return runAction(() => moveStudent(student.id, { class_id: classId, position: room.count, expected_version: student.version }), '無法移動幼生。')
}

// ---- 編輯資料、班級、補登預繳、恢復 ----
const view = ref<'roster' | 'deps'>('roster')
const pendingCount = computed(() => (roster.value ? pendingStudents(roster.value).length : 0))

const studentOpen = computed({
  get: () => editingStudent.value !== null,
  set: (open: boolean) => { if (!open) editingStudentId.value = null },
})
async function saveStudent(body: Omit<StudentUpdate, 'expected_version'>) {
  const student = editingStudent.value
  if (!student) return
  editingStudentId.value = null
  if (!Object.keys(body).length) return
  await runAction(() => updateStudent(student.id, { ...body, expected_version: student.version }), '無法儲存幼生資料。')
}

const classDialog = ref<{ id: string | null } | null>(null)
const classRoom = computed(() => roster.value?.classes.find((room) => room.id === classDialog.value?.id) ?? null)
const classOpen = computed({
  get: () => classDialog.value !== null,
  set: (open: boolean) => { if (!open) classDialog.value = null },
})
async function saveClass(body: ClassCreate | Omit<ClassUpdate, 'expected_version'>) {
  const room = classRoom.value
  classDialog.value = null
  if (!room) return runAction(() => createClass(props.campusKey, body as ClassCreate), '無法新增班級。')
  if (!Object.keys(body).length) return
  await runAction(() => updateClass(room.id, { ...body, expected_version: room.version }), '無法儲存班級。')
}
async function removeClass() {
  const room = classRoom.value
  if (!room) return
  try {
    await ElMessageBox.confirm(`刪除「${room.name}」？班上沒有幼生，刪除後無法復原。`, `刪除 ${room.name}？`, {
      confirmButtonText: '刪除班級',
      cancelButtonText: '先不要',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
      autofocus: false,
    })
  } catch {
    return
  }
  classDialog.value = null
  await runAction(() => deleteClass(room.id, room.version), '無法刪除班級。')
}

const depositOpen = ref(false)
async function saveDeposit(body: StudentsCreate) {
  menu.value = null
  try {
    const result = await createStudents(props.campusKey, body)
    depositOpen.value = false
    if (result.duplicates?.length) notifyWarning(`已有同名幼生：${result.duplicates.join('、')}`, { duration: 6000 })
    await load({ keep: true })
  } catch (err) {
    // 失敗時對話框留著，貼上的整份名單不用重貼；版本衝突之類才需要重讀。
    if (isVersionConflict(err) || (err as { status?: number } | null)?.status === 404) await onActionError(err, '無法補登預繳。')
    else notifyError(apiErrorMessage(err, '無法補登預繳。'))
  }
}
function restore(student: RosterStudent, classId: string | null) {
  return runAction(() => restoreStudent(student.id, student.version, classId), '無法恢復。')
}

// ---- 缺額統計：統計日期、三段目標、下學年年級目標、結算紀錄 ----
async function changeAsOf(date: string) {
  const data = roster.value
  if (!data) return
  asOf.value = date === data.today ? null : date
  await load({ keep: true })
}
async function saveNextTarget(grade: string, value: number | null) {
  const data = roster.value
  if (!data) return
  await runAction(() => saveNextYearTargets(props.campusKey, data.school_year, { [grade]: value }), '無法儲存下學年的目標人數。')
}
async function saveTier(block: 'current' | 'next', tiers: { base: number | null; boost: number | null; top: number | null }) {
  const data = roster.value
  if (!data) return
  const body = block === 'current' ? { school_year: data.school_year, semester: 2 } : { school_year: data.school_year + 1, semester: 1 }
  await runAction(() => saveTierTargets(props.campusKey, { ...body, ...tiers }), '無法儲存三段目標。')
}
async function saveSnapshot() {
  const data = roster.value
  if (!data) return
  const body = { school_year: data.school_year, as_of: data.as_of }
  try {
    try {
      await createSnapshot(props.campusKey, body)
    } catch (err) {
      if (apiErrorCode(err) !== 'ROSTER_SNAPSHOT_EXISTS') throw err
      try {
        await ElMessageBox.confirm('這一天已經有結算紀錄，要用現在算出來的數字覆蓋嗎？', '覆蓋結算紀錄？', {
          confirmButtonText: '覆蓋',
          cancelButtonText: '先不要',
          confirmButtonClass: 'el-button--danger',
          type: 'warning',
          autofocus: false,
        })
      } catch {
        return
      }
      await createSnapshot(props.campusKey, { ...body, overwrite: true })
    }
    ElMessage.success('已存成結算紀錄')
    await load({ keep: true })
  } catch (err) {
    await onActionError(err, '無法存成結算紀錄。')
  }
}

defineExpose({ reload: () => load({ keep: true }) })
</script>

<template>
  <el-empty v-if="schoolYear === null" description="請先選一個學年" />
  <div v-else class="roster-tab">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <div v-else-if="!roster" v-loading="loading" class="roster-tab__loading" />
    <section v-else class="roster-tab__card">
      <div class="roster-tab__head">
        <div class="roster-switch" role="group" aria-label="切換檢視">
          <button type="button" :class="{ 'is-on': view === 'roster' }" :aria-pressed="view === 'roster'" @click="view = 'roster'">編班表</button>
          <button type="button" :class="{ 'is-on': view === 'deps' }" :aria-pressed="view === 'deps'" @click="view = 'deps'">預繳名單 <span>{{ pendingCount }}</span></button>
        </div>
        <button v-if="canWrite && view === 'roster'" type="button" class="roster-tab__tool" @click="classDialog = { id: null }">新增班級</button>
      </div>
      <RosterTable
        v-if="view === 'roster'"
        :roster="roster"
        :can-write="canWrite"
        @set-class-target="saveClassTarget"
        @add="addStudents"
        @move="move"
        @open-student="openMenu"
        @edit-student="editStudent"
        @edit-class="classDialog = { id: $event }"
      />
      <DepositList
        v-else
        :roster="roster"
        :can-write="canWrite"
        @open-student="openMenu"
        @add-deposit="depositOpen = true"
        @restore="restore"
      />
    </section>
    <section v-if="roster" class="roster-tab__card roster-tab__stats">
      <div class="roster-tab__head"><h3>缺額統計</h3></div>
      <GapTable :roster="roster" :can-write="canWrite" @change-as-of="changeAsOf" @save-next-target="saveNextTarget" @save-tier="saveTier" @snapshot="saveSnapshot" />
      <SnapshotList :snapshots="roster.snapshots" />
    </section>
    <template v-if="roster">
      <StudentMenu
        v-if="menu && menuStudent && canWrite"
        :student="menuStudent"
        :class-label="classLabelOf(menuStudent)"
        :classes="roster.classes"
        :anchor="menu.anchor"
        :can-move="menuStudent.school_year === roster.school_year"
        @close="menu = null"
        @enter="enter(menuStudent)"
        @edit="editStudent(menuStudent.id)"
        @move="moveToClass(menuStudent, $event)"
        @leave="leave(menuStudent)"
        @refund="refund(menuStudent)"
      />
      <StudentDialog v-if="editingStudent" v-model="studentOpen" :student="editingStudent" :school-year="roster.school_year" @save="saveStudent" />
      <ClassDialog
        v-model="classOpen"
        :school-year="roster.school_year"
        :room="classRoom"
        :member-count="classRoom?.count ?? 0"
        @save="saveClass"
        @delete="removeClass"
      />
      <DepositDialog v-model="depositOpen" :school-year="roster.school_year" :today="roster.today" @save="saveDeposit" />
    </template>
  </div>
</template>

<style scoped>
.roster-tab__loading {
  min-height: 160px;
}

.roster-tab__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}

.roster-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.roster-switch button {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--text-base);
  cursor: pointer;
}

.roster-switch button.is-on {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: var(--shadow-md);
}

.roster-switch span {
  margin-left: 2px;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.roster-tab__tool {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-base);
  cursor: pointer;
}

.roster-tab__head h3 {
  margin: 0;
  font-size: var(--text-md);
}

.roster-tab__stats {
  margin-top: 16px;
}

.roster-tab__card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
</style>
