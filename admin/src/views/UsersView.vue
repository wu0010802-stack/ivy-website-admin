<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../api/client'
import { CAMPUS_KEYS, type Role, type UserOut } from '../api/types'
import { campusLabel, campusLabels, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER, roleLabel } from '../api/labels'
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
const scopeRole = ref<Role>('campus_admin')
const scopeShared = ref(false)
const scopeExport = ref(false)
const resetTarget = ref<UserOut | null>(null)
const resetPassword = ref('')
const resetVisible = ref(false)
const resetting = ref(false)
const togglingId = ref<string | null>(null)

const operationBusy = computed(() => creating.value || savingScope.value || resetting.value || Boolean(togglingId.value))
const visibleUsers = computed(() => sortedUsers.value.filter(user => {
  const text = [user.email, roleLabel(user.role), user.role === 'super_admin' ? '全部校區' : campusLabels(user.campus_keys)].join(' ').toLocaleLowerCase()
  return text.includes(search.value.trim().toLocaleLowerCase()) && (!status.value || (status.value === 'active') === user.is_active)
}))

const form = reactive({
  email: '',
  password: '',
  role: 'campus_admin' as Role,
  campus_keys: [] as string[],
  shared_content: false,
  export_data: false,
})

// 總管理者逐人給的授權與可以接受的角色（後端 GRANTABLE_CAPABILITIES）：
// 「全站共用內容」只對會編內容的角色有意義；「匯出家長個資」只給看得到
// 案件的角色，2026-09-25 起不再依角色自動取得。
const SHARED_ROLES: Role[] = ['campus_admin', 'editor']
const EXPORT_ROLES: Role[] = ['campus_admin', 'reception']
function hasSharedGrant(u: UserOut): boolean {
  return (u.capabilities ?? []).includes('content.shared')
}
function hasExportGrant(u: UserOut): boolean {
  return (u.capabilities ?? []).includes('booking.export')
}
function grantsFor(role: Role, shared: boolean, exportData: boolean): string[] {
  const grants: string[] = []
  if (EXPORT_ROLES.includes(role) && exportData) grants.push('booking.export')
  if (SHARED_ROLES.includes(role) && shared) grants.push('content.shared')
  return grants
}
function sameGrants(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join() === [...b].sort().join()
}

const formValid = computed(
  () =>
    form.email.includes('@') &&
    form.password.length >= 12 &&
    (form.role === 'super_admin' || form.campus_keys.length > 0),
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

// 讓總管理者自己想 12 字密碼，實務上會出現「Ivy12345678」。給一顆產生鈕，
// 用瀏覽器亂數挑不易混淆的字元；產生後直接顯示明文讓人抄給對方。
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const passwordVisible = ref(false)
function generatePassword() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  form.password = Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('')
  passwordVisible.value = true
}

function openCreateDialog() {
  if (operationBusy.value || loading.value) return
  form.email = ''
  form.password = ''
  form.role = 'campus_admin'
  form.campus_keys = []
  form.shared_content = false
  form.export_data = false
  passwordVisible.value = false
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
      campus_keys: form.role === 'super_admin' ? [] : form.campus_keys,
      capabilities: grantsFor(form.role, form.shared_content, form.export_data),
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
  scopeRole.value = target.role
  scopeShared.value = hasSharedGrant(target)
  scopeExport.value = hasExportGrant(target)
  scopeSelection.value = [...target.campus_keys]
  scopeDialogVisible.value = true
}

async function submitScope() {
  if (!scopeTarget.value || operationBusy.value) return
  savingScope.value = true
  try {
    let updated = await api.patch<UserOut>(`/admin/users/${scopeTarget.value.id}/role`, {
      role: scopeRole.value,
      campus_keys: scopeRole.value === 'super_admin' ? [] : scopeSelection.value,
    })
    // 改角色時後端會先清掉新角色不適用的授權；剩下的跟畫面上勾的不同才送。
    const wanted = grantsFor(scopeRole.value, scopeShared.value, scopeExport.value)
    if (!sameGrants(wanted, updated.capabilities ?? [])) {
      updated = await api.patch<UserOut>(`/admin/users/${scopeTarget.value.id}/capabilities`, {
        capabilities: wanted,
      })
    }
    const idx = users.value.findIndex((u) => u.id === updated.id)
    if (idx !== -1) users.value[idx] = updated
    scopeDialogVisible.value = false
    ElMessage.success('已更新角色、校區與權限')
  } catch (err) {
    ElMessage.error(errorText(err, '更新角色、校區與權限失敗'))
  } finally {
    savingScope.value = false
  }
}

function openReset(target: UserOut) {
  if (operationBusy.value) return
  resetTarget.value = target
  resetPassword.value = ''
  resetVisible.value = true
}

function generateResetPassword() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  resetPassword.value = Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('')
}

async function submitReset() {
  if (!resetTarget.value || resetPassword.value.length < 12) return
  resetting.value = true
  try {
    await api.post(`/admin/users/${resetTarget.value.id}/password`, { password: resetPassword.value })
    resetVisible.value = false
    ElMessage.success(`已重設 ${resetTarget.value.email} 的密碼，對方所有裝置都已登出。請把新密碼告訴對方。`)
  } catch (err) {
    ElMessage.error(errorText(err, '重設密碼失敗'))
  } finally {
    resetting.value = false
  }
}

function isSelf(u: UserOut): boolean {
  return u.id === authStore.user?.id
}

const EXPORT_HELP = 'CSV 含家長姓名、電話、Email 與孩子資料，每次匯出都會留下操作紀錄。只開給確實需要的人。'

// 本人在「我的帳號」綁定的快速登入方式；總管理者只看得到有沒有綁，看不到對方的 Google／LINE 帳號。
function loginLinks(u: UserOut): string {
  return [u.google_linked ? 'Google' : '', u.line_linked ? 'LINE' : ''].filter(Boolean).join('・')
}

onMounted(loadUsers)
</script>

<template>
  <div class="page">
    <el-alert v-if="!isSuperAdmin" title="只有總管理者可以管理使用者" type="warning" :closable="false" show-icon />

    <template v-else>
      <PageHeader lead="總管理者管理全部五校；其他角色只看得到被指定的校區。編輯改內容但不能發布、櫃台只處理參觀案件、唯讀只能查看。">
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
              <span v-if="loginLinks(row)" class="login-links" :title="`已綁定 ${loginLinks(row)} 登入`">{{ loginLinks(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="220">
            <template #default="{ row }: { row: UserOut }">
              {{ roleLabel(row.role) }}<el-tag v-if="hasSharedGrant(row)" size="small" type="warning" round class="self-tag" title="可以編輯全站共用內容">全站內容</el-tag><el-tag v-if="hasExportGrant(row)" size="small" type="danger" round class="self-tag" title="可以匯出家長個資">可匯出個資</el-tag>
            </template>
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
          <el-table-column label="操作" width="330" align="right">
            <template #default="{ row }: { row: UserOut }">
              <UserActions :user="row" :self="isSelf(row)" :busy="operationBusy" :pending="togglingId === row.id" @scope="openScopeDialog" @toggle="toggleActive" @reset="openReset" />
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="使用者清單">
          <li v-for="user in visibleUsers" :key="user.id" class="mobile-record">
            <div class="record-heading"><strong>{{ user.email }}<el-tag v-if="isSelf(user)" size="small" type="info" class="self-tag">你</el-tag></strong><el-tag :type="user.is_active ? 'success' : 'info'">{{ user.is_active ? '啟用中' : '已停用' }}</el-tag></div>
            <dl class="record-meta"><dt>角色</dt><dd>{{ roleLabel(user.role) }}{{ hasSharedGrant(user) ? '・可編全站內容' : '' }}{{ hasExportGrant(user) ? '・可匯出個資' : '' }}</dd><dt>校區範圍</dt><dd>{{ user.role === 'super_admin' ? '全部校區' : campusLabels(user.campus_keys) || '尚未指定' }}</dd><dt>快速登入</dt><dd>{{ loginLinks(user) || '未綁定' }}</dd></dl>
            <div class="record-actions"><UserActions :user="user" :self="isSelf(user)" :busy="operationBusy" :pending="togglingId === user.id" @scope="openScopeDialog" @toggle="toggleActive" @reset="openReset" /></div>
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
            <div class="password-row">
              <el-input v-model="form.password" :type="passwordVisible ? 'text' : 'password'" :show-password="!passwordVisible" autocomplete="new-password" />
              <el-button @click="generatePassword">產生密碼</el-button>
            </div>
            <span class="field-help" :class="{ 'is-ok': form.password.length >= 12 }">
              至少 12 字元（目前 {{ form.password.length }} 字）。建立後請把密碼抄給對方，這裡不會再顯示。
            </span>
          </el-form-item>
          <el-form-item label="角色">
            <el-radio-group v-model="form.role" class="role-group">
              <el-radio v-for="role in ROLE_ORDER" :key="role" :value="role">{{ ROLE_LABELS[role] }}</el-radio>
            </el-radio-group>
            <span class="field-help">{{ ROLE_DESCRIPTIONS[form.role] }}</span>
          </el-form-item>
          <el-form-item v-if="form.role !== 'super_admin'" label="負責校區">
            <el-checkbox-group v-model="form.campus_keys">
              <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item v-if="SHARED_ROLES.includes(form.role)">
            <el-checkbox v-model="form.shared_content">也可以編輯全站共用內容（首頁、頁尾、網站設定、共用素材）</el-checkbox>
            <span class="field-help">{{ form.role === 'editor' ? '改完一樣要送審，由總管理者核准發布。' : '可以直接發布共用內容，也能審核內容編輯送上來的共用內容。' }}</span>
          </el-form-item>
          <el-form-item v-if="EXPORT_ROLES.includes(form.role)">
            <el-checkbox v-model="form.export_data">可以匯出負責校區的家長個資（CSV）</el-checkbox>
            <span class="field-help">{{ EXPORT_HELP }}</span>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button :disabled="creating" @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="creating" :disabled="!formValid" @click="submitCreate">建立帳號</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="scopeDialogVisible" :title="`${scopeTarget?.email ?? ''} 的角色與校區`" width="460px" :show-close="!savingScope" :close-on-click-modal="!savingScope" :close-on-press-escape="!savingScope">
        <el-form label-position="top" :disabled="savingScope">
          <el-form-item label="角色">
            <el-radio-group v-model="scopeRole" class="role-group">
              <el-radio v-for="role in ROLE_ORDER" :key="role" :value="role">{{ ROLE_LABELS[role] }}</el-radio>
            </el-radio-group>
            <span class="field-help">{{ ROLE_DESCRIPTIONS[scopeRole] }}</span>
          </el-form-item>
          <el-form-item v-if="scopeRole !== 'super_admin'" label="負責校區">
            <el-checkbox-group v-model="scopeSelection">
              <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item v-if="SHARED_ROLES.includes(scopeRole)">
            <el-checkbox v-model="scopeShared">也可以編輯全站共用內容（首頁、頁尾、網站設定、共用素材）</el-checkbox>
            <span class="field-help">{{ scopeRole === 'editor' ? '改完一樣要送審，由總管理者核准發布。' : '可以直接發布共用內容，也能審核內容編輯送上來的共用內容。' }}</span>
          </el-form-item>
          <el-form-item v-if="EXPORT_ROLES.includes(scopeRole)">
            <el-checkbox v-model="scopeExport">可以匯出負責校區的家長個資（CSV）</el-checkbox>
            <span class="field-help">{{ EXPORT_HELP }}</span>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button :disabled="savingScope" @click="scopeDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="savingScope" :disabled="scopeRole !== 'super_admin' && scopeSelection.length === 0" @click="submitScope">儲存</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="resetVisible" :title="`重設 ${resetTarget?.email ?? ''} 的密碼`" width="440px" :show-close="!resetting" :close-on-click-modal="!resetting">
        <p class="hint">重設後對方所有已登入的裝置會被登出。系統不會寄信，請用電話或當面把新密碼告訴對方。</p>
        <div class="password-row">
          <el-input v-model="resetPassword" type="text" autocomplete="new-password" placeholder="至少 12 字元" />
          <el-button @click="generateResetPassword">產生密碼</el-button>
        </div>
        <template #footer>
          <el-button :disabled="resetting" @click="resetVisible = false">取消</el-button>
          <el-button type="primary" :loading="resetting" :disabled="resetPassword.length < 12" @click="submitReset">重設密碼</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.password-row { display: flex; gap: 8px; width: 100%; }
.role-group { display: grid; gap: 4px; }
.password-row .el-input { flex: 1; }

.self-tag {
  margin-left: 8px;
}

.login-links {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
}

.field-help.is-ok {
  color: var(--el-color-success);
}
</style>
