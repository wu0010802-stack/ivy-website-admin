<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../api/client'
import { CAMPUS_KEYS, type Role, type UserOut } from '../api/types'
import { campusLabel, campusLabels, roleLabel } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'
import UserActions from '../components/UserActions.vue'
import { useRequestSequence } from '../composables/useRequestSequence'

const authStore = useAuthStore()
const isSuperAdmin = computed(() => authStore.user?.role === 'super_admin')

const users = ref<UserOut[]>([])
const loading = ref(false)
const loadError = ref('')
const search = ref('')
const status = ref('')
const savingScope = ref(false)
const requests = useRequestSequence()
const dialogVisible = ref(false)
const creating = ref(false)
const scopeDialogVisible = ref(false)
const scopeTarget = ref<UserOut | null>(null)
const scopeSelection = ref<string[]>([])
const togglingId = ref<string | null>(null)

const operationBusy = computed(() => creating.value || savingScope.value || Boolean(togglingId.value))
const visibleUsers = computed(() => sortedUsers.value.filter(user => {
  const text = [user.email, roleLabel(user.role), user.role === 'super_admin' ? '全部校區' : campusLabels(user.campus_keys)].join(' ').toLocaleLowerCase()
  return text.includes(search.value.trim().toLocaleLowerCase()) && (!status.value || (status.value === 'active') === user.is_active)
}))

const form = reactive({
  email: '',
  password: '',
  role: 'campus_admin' as Extract<Role, 'super_admin' | 'campus_admin'>,
  campus_keys: [] as string[],
})

const formValid = computed(
  () =>
    form.email.includes('@') &&
    form.password.length >= 12 &&
    (form.role !== 'campus_admin' || form.campus_keys.length > 0),
)

const sortedUsers = computed(() =>
  [...users.value].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1
    return a.email.localeCompare(b.email)
  }),
)

async function loadUsers() {
  if (!isSuperAdmin.value || operationBusy.value) return
  const request = requests.begin()
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.get<UserOut[]>('/admin/users')
    if (requests.isCurrent(request)) users.value = result
  } catch (err) {
    if (requests.isCurrent(request)) loadError.value = '無法讀取使用者清單，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && 'message' in detail) {
      return String((detail as { message: unknown }).message)
    }
    return fallback
  }
  return err instanceof Error ? err.message : fallback
}

function openCreateDialog() {
  if (operationBusy.value || loading.value) return
  form.email = ''
  form.password = ''
  form.role = 'campus_admin'
  form.campus_keys = []
  dialogVisible.value = true
}

async function submitCreate() {
  if (!formValid.value || operationBusy.value || loading.value) return
  creating.value = true
  try {
    const created = await api.post<UserOut>('/admin/users', {
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      campus_keys: form.role === 'campus_admin' ? form.campus_keys : [],
    })
    users.value.push(created)
    dialogVisible.value = false
    ElMessage.success(`已新增 ${created.email}`)
  } catch (err) {
    ElMessage.error(errorText(err, '新增使用者失敗'))
  } finally {
    creating.value = false
  }
}

async function toggleActive(target: UserOut) {
  if (operationBusy.value || isSelf(target)) return
  togglingId.value = target.id
  try {
    const updated = await api.patch<UserOut>(`/admin/users/${target.id}/active`, {
      is_active: !target.is_active,
    })
    const idx = users.value.findIndex((u) => u.id === updated.id)
    if (idx !== -1) users.value[idx] = updated
    ElMessage.success(updated.is_active ? `已恢復 ${updated.email} 的登入` : `已停用 ${updated.email}`)
  } catch (err) {
    ElMessage.error(errorText(err, '更新啟用狀態失敗'))
  } finally {
    togglingId.value = null
  }
}

function openScopeDialog(target: UserOut) {
  if (operationBusy.value) return
  scopeTarget.value = target
  scopeSelection.value = [...target.campus_keys]
  scopeDialogVisible.value = true
}

async function submitScope() {
  if (!scopeTarget.value || operationBusy.value) return
  savingScope.value = true
  try {
    const updated = await api.patch<UserOut>(`/admin/users/${scopeTarget.value.id}/scope`, {
      campus_keys: scopeSelection.value,
    })
    const idx = users.value.findIndex((u) => u.id === updated.id)
    if (idx !== -1) users.value[idx] = updated
    scopeDialogVisible.value = false
    ElMessage.success('已更新校區範圍')
  } catch (err) {
    ElMessage.error(errorText(err, '更新校區範圍失敗'))
  } finally {
    savingScope.value = false
  }
}

function isSelf(u: UserOut): boolean {
  return u.id === authStore.user?.id
}

onMounted(loadUsers)
</script>

<template>
  <div class="page">
    <el-alert v-if="!isSuperAdmin" title="只有總管理者可以管理使用者" type="warning" :closable="false" show-icon />

    <template v-else>
      <PageHeader lead="總管理者可以管理全部五校；校區管理者只能看到並修改自己校區的內容與案件。">
        <template #actions>
          <el-button type="primary" :icon="Plus" :disabled="operationBusy || loading" @click="openCreateDialog">新增使用者</el-button>
        </template>
      </PageHeader>

      <div class="filter-bar">
        <label class="filter-field filter-search"><span>搜尋使用者</span><el-input v-model="search" placeholder="Email、角色或校區" clearable /></label>
        <label class="filter-field"><span>帳號狀態</span><el-select v-model="status" placeholder="全部狀態"><el-option label="全部狀態" value="" /><el-option label="啟用中" value="active" /><el-option label="已停用" value="inactive" /></el-select></label>
      </div>
      <div class="list-summary" role="status"><span>{{ loading ? '正在讀取使用者…' : loadError ? '使用者尚未載入' : `顯示 ${visibleUsers.length} / ${users.length} 位使用者` }}</span><el-button :loading="loading" :disabled="operationBusy" @click="loadUsers">重新整理</el-button></div>
      <el-alert v-if="loadError" class="inline-error" type="error" :title="loadError" :closable="false" show-icon><el-button @click="loadUsers">重新載入</el-button></el-alert>
      <div v-else-if="loading" class="panel list-skeleton"><el-skeleton animated :rows="5" /></div>
      <div v-else class="panel">
        <el-empty v-if="!visibleUsers.length" :description="search || status ? '找不到符合條件的使用者' : '尚未建立任何使用者'"><el-button v-if="search || status" @click="search = ''; status = ''">清除篩選</el-button></el-empty>
        <template v-else>
        <el-table class="data-table" :data="visibleUsers">
          <el-table-column label="Email" min-width="220">
            <template #default="{ row }: { row: UserOut }">
              <span :class="{ muted: !row.is_active }">{{ row.email }}</span>
              <el-tag v-if="isSelf(row)" size="small" type="info" round class="self-tag">你</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="130">
            <template #default="{ row }: { row: UserOut }">{{ roleLabel(row.role) }}</template>
          </el-table-column>
          <el-table-column label="校區範圍" min-width="180">
            <template #default="{ row }: { row: UserOut }">
              <span v-if="row.role === 'super_admin'" class="muted">全部校區</span>
              <span v-else-if="row.campus_keys.length === 0" class="muted">尚未指定</span>
              <span v-else>{{ campusLabels(row.campus_keys) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="狀態" width="100">
            <template #default="{ row }: { row: UserOut }">
              <el-tag :type="row.is_active ? 'success' : 'info'" size="small" round>
                {{ row.is_active ? '啟用中' : '已停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" align="right">
            <template #default="{ row }: { row: UserOut }">
              <UserActions :user="row" :self="isSelf(row)" :busy="operationBusy" :pending="togglingId === row.id" @scope="openScopeDialog" @toggle="toggleActive" />
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="使用者清單">
          <li v-for="user in visibleUsers" :key="user.id" class="mobile-record">
            <div class="record-heading"><strong>{{ user.email }}<el-tag v-if="isSelf(user)" size="small" type="info" class="self-tag">你</el-tag></strong><el-tag :type="user.is_active ? 'success' : 'info'">{{ user.is_active ? '啟用中' : '已停用' }}</el-tag></div>
            <dl class="record-meta"><dt>角色</dt><dd>{{ roleLabel(user.role) }}</dd><dt>校區範圍</dt><dd>{{ user.role === 'super_admin' ? '全部校區' : campusLabels(user.campus_keys) || '尚未指定' }}</dd></dl>
            <div class="record-actions"><UserActions :user="user" :self="isSelf(user)" :busy="operationBusy" :pending="togglingId === user.id" @scope="openScopeDialog" @toggle="toggleActive" /></div>
          </li>
        </ul>
        </template>
      </div>

      <el-dialog v-model="dialogVisible" title="新增使用者" width="440px" :show-close="!creating" :close-on-click-modal="!creating" :close-on-press-escape="!creating">
        <el-form label-position="top" :disabled="creating" @submit.prevent="submitCreate">
          <el-form-item label="Email">
            <el-input v-model="form.email" type="email" autocomplete="off" />
          </el-form-item>
          <el-form-item label="密碼">
            <el-input v-model="form.password" type="password" show-password autocomplete="new-password" />
            <span class="field-help" :class="{ 'is-ok': form.password.length >= 12 }">
              至少 12 字元（目前 {{ form.password.length }} 字）。建議建立後請對方自行更換。
            </span>
          </el-form-item>
          <el-form-item label="角色">
            <el-radio-group v-model="form.role">
              <el-radio value="campus_admin">校區管理者</el-radio>
              <el-radio value="super_admin">總管理者</el-radio>
            </el-radio-group>
            <span class="field-help">
              {{ form.role === 'super_admin' ? '可以管理全部校區、使用者與全站設定。' : '只能處理指定校區的內容與參觀案件。' }}
            </span>
          </el-form-item>
          <el-form-item v-if="form.role === 'campus_admin'" label="負責校區">
            <el-checkbox-group v-model="form.campus_keys">
              <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button :disabled="creating" @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="creating" :disabled="!formValid" @click="submitCreate">建立帳號</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="scopeDialogVisible" :title="`${scopeTarget?.email ?? ''} 的校區範圍`" width="440px" :show-close="!savingScope" :close-on-click-modal="!savingScope" :close-on-press-escape="!savingScope">
        <el-checkbox-group v-model="scopeSelection" :disabled="savingScope">
          <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
        </el-checkbox-group>
        <p class="hint" style="margin-top: 12px">
          {{ scopeSelection.length === 0 ? '沒有勾選任何校區時，這位使用者登入後看不到任何內容。' : '' }}
        </p>
        <template #footer>
          <el-button :disabled="savingScope" @click="scopeDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="savingScope" @click="submitScope">儲存</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.self-tag {
  margin-left: 8px;
}

.field-help.is-ok {
  color: var(--el-color-success);
}
</style>
