<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../api/client'
import { CAMPUS_KEYS, type Role, type UserOut } from '../api/types'

const authStore = useAuthStore()

const users = ref<UserOut[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const creating = ref(false)
const scopeDialogVisible = ref(false)
const scopeTarget = ref<UserOut | null>(null)
const scopeSelection = ref<string[]>([])

const campusKeys = CAMPUS_KEYS

const form = reactive({
  email: '',
  password: '',
  role: 'campus_admin' as Extract<Role, 'super_admin' | 'campus_admin'>,
  campus_keys: [] as string[],
})

function isSuperAdmin(): boolean {
  return authStore.user?.role === 'super_admin'
}

async function loadUsers() {
  if (!isSuperAdmin()) return
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
  creating.value = true
  try {
    const created = await api.post<UserOut>('/admin/users', {
      email: form.email,
      password: form.password,
      role: form.role,
      campus_keys: form.role === 'campus_admin' ? form.campus_keys : [],
    })
    users.value.push(created)
    dialogVisible.value = false
    ElMessage.success('已新增使用者')
  } catch (err) {
    ElMessage.error(errorText(err, '新增使用者失敗'))
  } finally {
    creating.value = false
  }
}

async function toggleActive(target: UserOut) {
  try {
    const updated = await api.patch<UserOut>(`/admin/users/${target.id}/active`, {
      is_active: !target.is_active,
    })
    const idx = users.value.findIndex((u) => u.id === updated.id)
    if (idx !== -1) users.value[idx] = updated
  } catch (err) {
    ElMessage.error(errorText(err, '更新啟用狀態失敗'))
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

onMounted(loadUsers)
</script>

<template>
  <div v-if="!isSuperAdmin()">
    <el-alert title="沒有權限" type="warning" :closable="false" />
  </div>
  <div v-else>
    <div style="display: flex; justify-content: space-between; margin-bottom: 1rem">
      <h2>使用者管理</h2>
      <el-button type="primary" @click="openCreateDialog">新增使用者</el-button>
    </div>

    <el-table :data="users" v-loading="loading" style="width: 100%">
      <el-table-column prop="email" label="Email" />
      <el-table-column prop="role" label="角色" />
      <el-table-column label="狀態">
        <template #default="{ row }">{{ row.is_active ? '啟用中' : '已停權' }}</template>
      </el-table-column>
      <el-table-column label="校區範圍">
        <template #default="{ row }">{{ row.campus_keys.join('、') || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <el-button size="small" @click="toggleActive(row)">
            {{ row.is_active ? '停權' : '復權' }}
          </el-button>
          <el-button v-if="row.role === 'campus_admin'" size="small" @click="openScopeDialog(row)">
            編輯校區範圍
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="新增使用者">
      <el-form label-position="top" @submit.prevent="submitCreate">
        <el-form-item label="Email">
          <el-input v-model="form.email" type="email" />
        </el-form-item>
        <el-form-item label="密碼（至少 12 字元）">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="總管理者" value="super_admin" />
            <el-option label="校區管理者" value="campus_admin" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.role === 'campus_admin'" label="校區範圍">
          <el-checkbox-group v-model="form.campus_keys">
            <el-checkbox v-for="key in campusKeys" :key="key" :value="key" :label="key" />
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">送出</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scopeDialogVisible" title="編輯校區範圍">
      <el-checkbox-group v-model="scopeSelection">
        <el-checkbox v-for="key in campusKeys" :key="key" :value="key" :label="key" />
      </el-checkbox-group>
      <template #footer>
        <el-button @click="scopeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitScope">儲存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
