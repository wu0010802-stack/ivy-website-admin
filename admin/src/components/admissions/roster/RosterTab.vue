<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createStudents, enterStudent, getRoster, leaveStudent, moveStudent, refundStudent, updateClass,
  type Roster, type RosterStudent,
} from '../../../api/roster'
import { apiErrorMessage, isVersionConflict } from '../../../api/errors'
import { notifyError, notifyWarning } from '../../../composables/notify'
import { usePermissions } from '../../../composables/usePermissions'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import RosterTable from './RosterTable.vue'
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
    roster.value = null
    error.value = apiErrorMessage(err, '無法讀取編班表，請重新載入。')
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
      <RosterTable
        :roster="roster"
        :can-write="canWrite"
        @set-class-target="saveClassTarget"
        @add="addStudents"
        @move="move"
        @open-student="openMenu"
        @edit-student="editStudent"
      />
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
    </section>
  </div>
</template>

<style scoped>
.roster-tab__loading {
  min-height: 160px;
}

.roster-tab__card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
</style>
