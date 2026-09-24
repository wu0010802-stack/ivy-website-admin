<script setup lang="ts">
import type { UserOut } from '../api/types'
defineProps<{ user: UserOut; self: boolean; busy: boolean; pending: boolean }>()
defineEmits<{ scope: [user: UserOut]; toggle: [user: UserOut]; reset: [user: UserOut] }>()
</script>

<template>
  <span class="cell-actions user-actions">
    <el-button :disabled="self || busy" :title="self ? '不能改自己的角色' : undefined" @click="$emit('scope', user)">角色與校區</el-button>
    <el-button v-if="!self" :disabled="busy" @click="$emit('reset', user)">重設密碼</el-button>
    <el-popconfirm v-if="user.is_active" :title="`停用後 ${user.email} 就無法登入後台，已建立的內容不受影響。`" confirm-button-text="停用" cancel-button-text="先不要" confirm-button-type="danger" :width="280" @confirm="$emit('toggle', user)">
      <template #reference><el-button type="danger" plain :disabled="self || busy" :loading="pending" :title="self ? '無法停用自己的帳號' : undefined">停用</el-button></template>
    </el-popconfirm>
    <el-button v-else type="primary" plain :disabled="busy" :loading="pending" @click="$emit('toggle', user)">恢復</el-button>
  </span>
</template>

<style scoped>
.user-actions { display:inline-flex; flex-wrap:wrap; gap:8px; }
.user-actions .el-button + .el-button { margin-left:0; }
</style>
