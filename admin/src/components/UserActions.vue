<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import type { UserOut } from '../api/types'
import { staffWithEmail } from '../api/labels'
const props = defineProps<{ user: UserOut; self: boolean; busy: boolean; pending: boolean }>()
const emit = defineEmits<{ scope: [user: UserOut]; toggle: [user: UserOut]; reset: [user: UserOut]; clearLogins: [user: UserOut] }>()

type MoreCommand = 'clearLogins' | 'deactivate'

// 停用與解除綁定很少用、又會把人登出：收進每列的「更多」（2026-10-05 第九輪），
// 不再每一列都排一顆紅色「停用」。選了之後照舊先確認，確認鈕用危險色、不預設聚焦。
async function onMore(command: MoreCommand) {
  const who = staffWithEmail(props.user)
  const [message, title, confirmButtonText] =
    command === 'deactivate'
      ? [`停用後 ${who} 就無法登入後台，已建立的內容不受影響。之後可以再恢復。`, '停用這個帳號？', '停用']
      : [`解除 ${who} 的 Google／LINE 綁定，並登出對方所有裝置？LINE 要本人重新綁定；Google 用同一個 Email 登入時會自動重新綁定。`, '解除綁定並登出？', '解除並登出']
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText,
      cancelButtonText: '先不要',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
      autofocus: false,
    })
  } catch {
    return
  }
  if (command === 'deactivate') emit('toggle', props.user)
  else emit('clearLogins', props.user)
}
</script>

<template>
  <span class="cell-actions user-actions">
    <!-- 自己的帳號不能在這裡改角色或停用；不留一排按不下去的鈕，直接指到「我的帳號」。
         自己的 Google／LINE 綁定也要到「我的帳號」解除（需要重新驗證），這裡只處理別人的。 -->
    <span v-if="self" class="user-actions__self">自己的帳號請到<router-link to="/account">我的帳號</router-link>管理</span>
    <template v-else>
      <el-button :disabled="busy" @click="$emit('scope', user)">角色與校區</el-button>
      <el-button :disabled="busy" @click="$emit('reset', user)">重設密碼</el-button>
      <el-button v-if="!user.is_active" type="primary" plain :disabled="busy" :loading="pending" @click="$emit('toggle', user)">恢復</el-button>
      <el-dropdown
        v-if="user.is_active || user.line_linked || user.google_linked"
        trigger="click"
        placement="bottom-end"
        :disabled="busy"
        popper-class="user-more-menu"
        @command="onMore"
      >
        <el-button :disabled="busy" :loading="pending && user.is_active" data-test="user-more" :aria-label="`${staffWithEmail(user)} 的更多動作`">
          更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-if="user.line_linked || user.google_linked" command="clearLogins" data-test="clear-external-logins">解除綁定並登出</el-dropdown-item>
            <el-dropdown-item v-if="user.is_active" command="deactivate" :divided="user.line_linked || user.google_linked" class="user-more__danger" data-test="deactivate-user">停用帳號</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </span>
</template>

<style scoped>
.user-actions { display:inline-flex; flex-wrap:wrap; gap:8px; }
.user-actions .el-button + .el-button { margin-left:0; }
.user-actions__self { color:var(--ink-3); font-size:var(--text-sm); line-height:1.45; text-align:left; }
.user-actions__self a { text-decoration:underline; text-underline-offset:2px; }

:global(.user-more-menu .el-dropdown-menu__item.user-more__danger) {
  color: var(--el-color-danger);
}

:global(.user-more-menu .el-dropdown-menu__item.user-more__danger:not(.is-disabled):hover),
:global(.user-more-menu .el-dropdown-menu__item.user-more__danger:not(.is-disabled):focus) {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
</style>
