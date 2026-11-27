<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Close, Star } from '@element-plus/icons-vue'
import { notifyError } from '../composables/notify'
import { useAuthStore } from '../stores/auth'
import { SAVED_VIEW_LIMIT, SAVED_VIEW_NAME_MAX, snapshotKey, useSavedViews, type SavedView, type ViewSnapshot } from '../composables/useSavedViews'

// 常用篩選的下拉鈕：列出存過的條件（點了套用、× 刪掉），最下面把目前的條件存起來。
// 各列表自己決定條件長什麼樣（snapshot 是一包字串），這裡只管存、列、刪。
const props = defineProps<{
  /** 哪一個列表的（各列表各存各的） */
  scope: string
  /** 目前套用的條件，不含搜尋字與頁數 */
  current: ViewSnapshot
}>()
const emit = defineEmits<{ apply: [snapshot: ViewSnapshot] }>()

const auth = useAuthStore()
const { views, full, save, remove } = useSavedViews(props.scope, computed(() => auth.user?.id))
const currentKey = computed(() => snapshotKey(props.current))
const hasConditions = computed(() => currentKey.value !== '[]')
const activeId = computed(() => views.value.find(view => snapshotKey(view.snapshot) === currentKey.value)?.id)
const activeName = computed(() => views.value.find(view => view.id === activeId.value)?.name)

async function saveCurrent() {
  let name: string
  try {
    const result = await ElMessageBox.prompt('取一個看得懂的名字，之後在「常用篩選」點一下就套回這組條件。搜尋字不會存。', '存成常用篩選', {
      confirmButtonText: '儲存', cancelButtonText: '取消', inputPlaceholder: '例如：本週待追蹤',
      inputValidator: (value: string) => {
        const text = (value ?? '').trim()
        if (!text) return '請輸入名稱'
        if ([...text].length > SAVED_VIEW_NAME_MAX) return `名稱最多 ${SAVED_VIEW_NAME_MAX} 個字`
        if (full.value && !views.value.some(view => view.name === text)) return `最多存 ${SAVED_VIEW_LIMIT} 組，請先刪掉用不到的`
        return true
      },
    })
    name = (result as { value: string }).value
  } catch {
    return
  }
  if (save(name, props.current)) ElMessage.success(`已存成「${name.trim()}」`)
  else notifyError('這台裝置的瀏覽器存不了（可能是私密視窗），這次沒有存起來')
}

function onCommand(command: string | SavedView) {
  if (command === 'save') void saveCurrent()
  else if (typeof command !== 'string') emit('apply', { ...command.snapshot })
}
</script>

<template>
  <el-dropdown class="saved-views" trigger="click" @command="onCommand">
    <button type="button" class="saved-views__button" :class="{ 'is-active': activeId }" aria-label="常用篩選">
      <el-icon aria-hidden="true"><Star /></el-icon><span class="saved-views__name">{{ activeName ?? '常用篩選' }}</span>
      <el-icon class="saved-views__caret" aria-hidden="true"><ArrowDown /></el-icon>
    </button>
    <template #dropdown>
      <el-dropdown-menu class="saved-views__menu">
        <li v-if="!views.length" class="saved-views__empty">還沒有存過。先篩出常看的那一批，再按下面存起來。</li>
        <el-dropdown-item v-for="view in views" :key="view.id" :command="view" :class="{ 'is-current': view.id === activeId }">
          <span class="saved-views__item">{{ view.name }}</span>
          <button type="button" class="saved-views__remove" :aria-label="`刪除常用篩選「${view.name}」`" @click.stop="remove(view.id)">
            <el-icon aria-hidden="true"><Close /></el-icon>
          </button>
        </el-dropdown-item>
        <el-dropdown-item command="save" divided :disabled="!hasConditions || Boolean(activeId)">
          {{ activeId ? '目前的條件已經存過' : hasConditions ? '把目前的條件存起來' : '先套用篩選才能存' }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.saved-views { flex-shrink: 0; }
.saved-views__button {
  display: inline-flex; align-items: center; gap: 6px; max-width: 220px; min-height: var(--control-h); padding: 0 12px;
  border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--ink-2);
  font: inherit; font-size: var(--text-base); cursor: pointer;
}
.saved-views__button:hover { border-color: var(--el-color-primary-light-5); color: var(--ink); }
.saved-views__button.is-active { border-color: var(--el-color-primary); color: var(--admin-accent-strong); }
.saved-views__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.saved-views__caret { font-size: var(--text-xs); }
/* 手機那一列只夠搜尋框＋兩顆鈕：這顆只留星號（套用中的那組改用顏色表示），名稱在選單裡看。 */
@media (max-width: 640px) {
  .saved-views__button { padding: 0 10px; }
  .saved-views__name, .saved-views__caret { display: none; }
}
</style>

<style>
/* 下拉選單掛在 body 底下，scoped 樣式碰不到。 */
.saved-views__menu { min-width: 220px; max-width: 300px; }
.saved-views__menu .el-dropdown-menu__item { display: flex; align-items: center; gap: 8px; }
.saved-views__menu .el-dropdown-menu__item.is-current { font-weight: 600; }
.saved-views__item { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.saved-views__remove {
  display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; width: 28px; height: 28px; margin-right: -8px; padding: 0;
  border: 0; border-radius: var(--radius); background: none; color: inherit; cursor: pointer; opacity: 0.6;
}
.saved-views__remove:hover, .saved-views__remove:focus-visible { background: var(--el-fill-color); opacity: 1; }
.saved-views__empty { max-width: 260px; padding: 8px 16px; color: var(--el-text-color-secondary); font-size: var(--text-sm); line-height: 1.6; list-style: none; }
</style>
