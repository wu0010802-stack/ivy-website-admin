<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { RecruitmentVisit } from '../../api/types'
import type { Stage } from '../../admissions/constants'
import { usePermissions } from '../../composables/usePermissions'
import { moreCommands, stageAction, type MoreCommand } from './recordRowActions'

// 訪視明細一列的「標記預繳／標記註冊」與「更多」（2026-10-20 從 RecordsTab.vue 抽出）。
// 兩個根節點，直接排進呼叫端的操作列（卡片的 .record-card__actions、表格的 .records__actions），
// 版面規則留在 RecordsTab。compact 是表格的小按鈕、「更多」用文字鈕。
const props = defineProps<{
  row: RecruitmentVisit
  disabled: boolean
  compact?: boolean
}>()
const emit = defineEmits<{
  stage: [from: Stage, to: Stage]
  command: [command: MoreCommand]
}>()

const { can } = usePermissions()
const perms = computed(() => ({ canWrite: can('admissions.write'), canConvert: can('admissions.convert') }))
const action = computed(() => stageAction(props.row, perms.value))
const commands = computed(() => moreCommands(props.row, perms.value))
const size = computed(() => (props.compact ? 'small' : undefined))
</script>

<template>
  <el-button v-if="action" :size="size" type="primary" plain :disabled="disabled" @click="emit('stage', action.from, action.to)">{{ action.label }}</el-button>
  <el-dropdown
    v-if="commands.length"
    trigger="click"
    placement="bottom-end"
    :persistent="false"
    :popper-class="`records-more-menu records-more-menu--${row.id}`"
    @command="(command: MoreCommand) => emit('command', command)"
  >
    <el-button :size="size" :text="compact" :data-more="row.id" :disabled="disabled" :aria-label="`${row.child_name} 的更多動作`">
      更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="item in commands"
          :key="item.command"
          :command="item.command"
          :divided="item.command === 'delete' && commands.length > 1"
          :class="{ 'records-more__danger': item.command === 'delete' }"
        >{{ item.label }}</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
