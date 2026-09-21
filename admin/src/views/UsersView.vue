<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../api/client'
import { CAMPUS_KEYS, type Role, type UserOut } from '../api/types'
import { campusLabel, campusLabels, roleLabel } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'

const authStore = useAuthStore()
const isSuperAdmin = computed(() => authStore.user?.role === 'super_admin')

const users = ref<UserOut[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const creating = ref(false)
const scopeDialogVisible = ref(false)
const scopeTarget = ref<UserOut | null>(null)
const scopeSelection = ref<string[]>([])
const togglingId = ref<string | null>(null)

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
  if (!isSuperAdmin.value) return
  loading.value = true
  try {
    users.value = await api.get<UserOut[]>('/admin/users')
  } catch (err) {
    ElMessage.error(errorText(err, '無法載入使用者列表'))
  } finally {
    loading.value = false
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
  form.email = ''
  form.password = ''
  form.role = 'campus_admin'
  form.campus_keys = []
  dialogVisible.value = true
}

async function submitCreate() {
  if (!formValid.value) return
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
  scopeTarget.value = target
  scopeSelection.value = [...target.campus_keys]
  scopeDialogVisible.value = true
}

async function submitScope() {
  if (!scopeTarget.value) return
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
          <el-button type="primary" :icon="Plus" @click="openCreateDialog">新增使用者</el-button>
        </template>
      </PageHeader>

      <div class="panel">
        <el-table :data="sortedUsers" v-loading="loading" empty-text="尚未建立任何使用者">
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
              <span class="cell-actions">
                <el-button v-if="row.role === 'campus_admin'" size="small" text @click="openScopeDialog(row)">
                  校區範圍
                </el-button>
                <el-popconfirm
                  v-if="row.is_active"
                  :title="`停用後 ${row.email} 就無法登入後台，已建立的內容不受影響。`"
                  confirm-button-text="停用"
                  cancel-button-text="先不要"
                  confirm-button-type="danger"
                  :width="280"
                  @confirm="toggleActive(row)"
                >
                  <template #reference>
                    <el-button
                      size="small"
                      text
                      type="danger"
                      :disabled="isSelf(row)"
                      :loading="togglingId === row.id"
                    >
                      停用
                    </el-button>
                  </template>
                </el-popconfirm>
                <el-button
                  v-else
                  size="small"
                  text
                  type="primary"
                  :loading="togglingId === row.id"
                  @click="toggleActive(row)"
                >
                  恢復
                </el-button>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog v-model="dialogVisible" title="新增使用者" width="440px">
        <el-form label-position="top" @submit.prevent="submitCreate">
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
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="creating" :disabled="!formValid" @click="submitCreate">建立帳號</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="scopeDialogVisible" :title="`${scopeTarget?.email ?? ''} 的校區範圍`" width="440px">
        <el-checkbox-group v-model="scopeSelection">
          <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
        </el-checkbox-group>
        <p class="hint" style="margin-top: 12px">
          {{ scopeSelection.length === 0 ? '沒有勾選任何校區時，這位使用者登入後看不到任何內容。' : '' }}
        </p>
        <template #footer>
          <el-button @click="scopeDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitScope">儲存</el-button>
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
