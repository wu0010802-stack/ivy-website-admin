<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RosterClass, RosterStudent } from '../../../api/roster'
import { rocDate } from '../../../admissions/roster'

// 點姓名開的選單（2026-11-15，規格 §8.1）：資訊、已入園、編輯資料、移到其他班級（給不方便拖拉的裝置）、
// 離園（在籍）或退預繳（預繳未入園）。位置貼著被點的那顆按鈕，點選單外面或按 Esc 收起。
const props = defineProps<{
  student: RosterStudent
  classLabel: string
  classes: RosterClass[]
  anchor: HTMLElement | null
  // 這位幼生所屬學年的班級才能選（下學年的預繳生還沒有今年的班）。
  canMove: boolean
}>()
const emit = defineEmits<{
  enter: []
  edit: []
  move: [classId: string]
  leave: []
  refund: []
  close: []
}>()

const menu = ref<HTMLElement | null>(null)
const style = ref<Record<string, string>>({})

const pending = computed(() => props.student.status === 'pending')
const canEnter = computed(() => pending.value && props.student.class_id !== null)
const underage = computed(() => (props.student.is_underage === null ? null : props.student.is_underage ? '是' : '否'))
const otherClasses = computed(() => props.classes.filter((room) => room.id !== props.student.class_id))

function place() {
  const rect = props.anchor?.getBoundingClientRect()
  if (!rect) return
  const width = menu.value?.offsetWidth ?? 240
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  style.value = { top: `${rect.bottom + 4}px`, left: `${left}px` }
}

function onPointerDown(event: Event) {
  const target = event.target as Node | null
  if (menu.value && target && !menu.value.contains(target) && !props.anchor?.contains(target)) emit('close')
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
onMounted(async () => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKey)
  await nextTick()
  place()
  menu.value?.querySelector<HTMLElement>('button')?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKey)
})

function pickClass(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) emit('move', value)
}
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="roster-menu" role="menu" :aria-label="`${student.child_name}的操作`" :style="style">
      <div class="roster-menu__info">
        <b>{{ student.child_name }}</b>
        <span>班級：{{ classLabel }}</span>
        <span v-if="student.deposit_date">預繳日期：{{ rocDate(student.deposit_date) }}</span>
        <span>生日：{{ student.birthday ? rocDate(student.birthday) : '未填' }}</span>
        <span v-if="underage !== null">不足齡：{{ underage }}<template v-if="student.birthday">（依生日）</template></span>
      </div>
      <button v-if="canEnter" type="button" role="menuitem" @click="emit('enter')">已入園</button>
      <button type="button" role="menuitem" @click="emit('edit')">編輯資料</button>
      <label v-if="canMove && otherClasses.length" class="roster-menu__move">
        移到其他班級
        <select aria-label="移到其他班級" @change="pickClass">
          <option value="">選擇班級</option>
          <option v-for="room in otherClasses" :key="room.id" :value="room.id">{{ room.name }}({{ room.class_code }})</option>
        </select>
      </label>
      <button v-if="pending" type="button" role="menuitem" class="is-danger" @click="emit('refund')">退預繳</button>
      <button v-else type="button" role="menuitem" class="is-danger" @click="emit('leave')">離園</button>
    </div>
  </Teleport>
</template>

<style scoped>
.roster-menu {
  position: fixed;
  z-index: 2100;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  max-width: calc(100vw - 16px);
  padding: 6px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.roster-menu__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.roster-menu__info b {
  color: var(--ink);
  font-size: var(--text-md);
}

.roster-menu button {
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-base);
  text-align: left;
  cursor: pointer;
}

.roster-menu button:hover,
.roster-menu button:focus-visible {
  background: var(--accent-bg);
  outline: 0;
}

.roster-menu .is-danger {
  color: var(--danger-ink);
}

.roster-menu__move {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.roster-menu__move select {
  height: 34px;
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  font: inherit;
  font-size: var(--text-base);
}
</style>
