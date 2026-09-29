<script setup lang="ts">
import type { UserOut } from '../api/types'
import { staffWithEmail } from '../api/labels'
defineProps<{ user: UserOut; self: boolean; busy: boolean; pending: boolean }>()
defineEmits<{ scope: [user: UserOut]; toggle: [user: UserOut]; reset: [user: UserOut] }>()
</script>

<template>
  <span class="cell-actions user-actions">
    <!-- 自己的帳號不能在這裡改角色或停用；不留一排按不下去的鈕，直接指到「我的帳號」。 -->
    <span v-if="self" class="user-actions__self">自己的帳號請到<router-link to="/account">我的帳號</router-link>管理</span>
    <template v-else>
      <el-button :disabled="busy" @click="$emit('scope', user)">角色與校區</el-button>
      <el-button :disabled="busy" @click="$emit('reset', user)">重設密碼</el-button>
      <el-popconfirm v-if="user.is_active" :title="`停用後 ${staffWithEmail(user)} 就無法登入後台，已建立的內容不受影響。`" confirm-button-text="停用" cancel-button-text="先不要" confirm-button-type="danger" :width="280" @confirm="$emit('toggle', user)">
        <template #reference><el-button type="danger" plain :disabled="busy" :loading="pending">停用</el-button></template>
      </el-popconfirm>
      <el-button v-else type="primary" plain :disabled="busy" :loading="pending" @click="$emit('toggle', user)">恢復</el-button>
    </template>
  </span>
</template>

<style scoped>
.user-actions { display:inline-flex; flex-wrap:wrap; gap:8px; }
.user-actions .el-button + .el-button { margin-left:0; }
.user-actions__self { color:var(--ink-3); font-size:13px; line-height:1.45; text-align:left; }
.user-actions__self a { text-decoration:underline; text-underline-offset:2px; }
</style>
