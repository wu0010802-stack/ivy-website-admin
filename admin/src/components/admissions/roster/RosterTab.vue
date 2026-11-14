<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getRoster, updateClass, type Roster } from '../../../api/roster'
import { apiErrorMessage, isVersionConflict } from '../../../api/errors'
import { notifyError, notifyWarning } from '../../../composables/notify'
import { usePermissions } from '../../../composables/usePermissions'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import RosterTable from './RosterTable.vue'

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
