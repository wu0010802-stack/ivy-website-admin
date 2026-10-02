<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyError, notifyWarning } from '../composables/notify'
import { Plus } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, apiFieldError } from '../api/errors'
import { CAMPUS_KEYS, type Role, type UserOut } from '../api/types'
import { campusLabel, campusLabels, displayNameError, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER, roleLabel, staffLabel, staffWithEmail } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'
import UserActions from '../components/UserActions.vue'
import DisplayNameField from '../components/DisplayNameField.vue'
import { passwordHint, passwordOk, PASSWORD_MIN_LENGTH } from '../composables/passwordRules'
import { useRequestSequence } from '../composables/useRequestSequence'
import { renameVisitStaff } from '../composables/useVisitStaff'

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
const clearingId = ref<string | null>(null)

const operationBusy = computed(
  () => creating.value || savingScope.value || resetting.value || Boolean(togglingId.value) || Boolean(clearingId.value),
)
const visibleUsers = computed(() => sortedUsers.value.filter(user => {
  const text = [user.display_name ?? '', user.email, roleLabel(user.role), user.role === 'super_admin' ? '全部校區' : campusLabels(user.campus_keys)].join(' ').toLocaleLowerCase()
  return text.includes(search.value.trim().toLocaleLowerCase()) && (!status.value || (status.value === 'active') === user.is_active)
}))
// 還沒設定顯示名稱的人：名稱欄先用 Email @ 前面那段（灰字），清單上方說明怎麼補。
const unnamedCount = computed(() => users.value.filter(user => !user.display_name).length)

// 顯示名稱送出前的樣子：前後空白不算，空白＝不設定（後端存 null，畫面改用 Email）。
function normalizedName(value: string): string | null {
  return value.trim() || null
}

const form = reactive({
  email: '',
  display_name: '',
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

// 和登入頁同一套：按「建立帳號」才逐欄檢查，問題寫在該欄下方並把焦點移過去；
// 按鈕不預先停用，免得不知道是哪一欄沒填好。後端用 EmailStr 驗證，「a@b」
// 這種要在前端先擋，否則只會拿到英文的 422 訊息。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FULL_EMAIL_HINT = '請輸入完整的 Email，例如 name@example.com'
// 顯示名稱的長度與字元邊打邊檢查（DisplayNameField 自己寫原因），這裡只記後端另外
// 回的錯誤；一改就清掉。
const createErrors = reactive({ email: '', password: '', campus: '', display_name: '' })
const emailInput = ref<{ focus: () => void } | null>(null)
const nameInput = ref<{ focus: () => void } | null>(null)
const passwordInput = ref<{ focus: () => void } | null>(null)
const campusField = ref<HTMLElement | null>(null)
watch(() => form.email, () => { createErrors.email = '' })
watch(() => form.display_name, () => { createErrors.display_name = '' })
watch(() => form.password, () => { createErrors.password = '' })
watch(() => [form.role, form.campus_keys.length], () => { createErrors.campus = '' })

// 密碼規則與後端相同（passwordRules.ts：12 字以上、UTF-8 不超過 72 bytes）。
function passwordProblem(value: string): string {
  if (value.length < PASSWORD_MIN_LENGTH) return `密碼至少要 12 個字元（目前 ${value.length} 字），可以按「產生密碼」`
  return passwordOk(value) ? '' : passwordHint(value)
}

function validateCreate(): boolean {
  const email = form.email.trim()
  createErrors.email = !email ? '請輸入 Email' : EMAIL_PATTERN.test(email) ? '' : FULL_EMAIL_HINT
  createErrors.password = passwordProblem(form.password)
  createErrors.campus = form.role === 'super_admin' || form.campus_keys.length > 0 ? '' : '請至少勾選一個負責校區'
  return !createErrors.email && !displayNameError(form.display_name) && !createErrors.password && !createErrors.campus
}

async function focusFirstCreateError() {
  await nextTick()
  if (createErrors.email) emailInput.value?.focus()
  else if (displayNameError(form.display_name) || createErrors.display_name) nameInput.value?.focus()
  else if (createErrors.password) passwordInput.value?.focus()
  else if (createErrors.campus) campusField.value?.querySelector<HTMLInputElement>('input')?.focus()
}

// 後端 422 且指到 email 欄（EmailStr 不收的格式）：寫在 Email 欄下方，不顯示英文原文。
function emailRejected(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 422 || !Array.isArray(err.detail)) return false
  return err.detail.some((item: unknown) => {
    const loc = (item as { loc?: unknown } | null)?.loc
    return Array.isArray(loc) && loc.includes('email')
  })
}

// 總管理者可以管理所有帳號、看並匯出五校家長個資、執行無法復原的個資清理：
// 新增或升為總管理者前再確認一次。降級不必（後端會擋最後一位）。
const SUPER_ADMIN_POWERS = '可以管理所有帳號、看到並匯出五校家長資料，也能執行無法復原的個資清理'
async function confirmSuperAdmin(who: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(`總管理者${SUPER_ADMIN_POWERS}。只給確實需要的人。`, `確定讓 ${who} 成為總管理者？`, {
      confirmButtonText: '設為總管理者',
      cancelButtonText: '先不要',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}

// 全站共用內容授權實際涵蓋的範圍（nav.ts 裡標 shared 的各頁與共用素材）。
const SHARED_CONTENT_SCOPE = '共用內容包括首頁各區塊、入學資訊頁、預約文案、共用常見問題、頁尾文字、網站標題與電話，以及五校共用的素材。'
function sharedContentHelp(role: Role): string {
  return role === 'editor'
    ? '改完一樣要送審，由總管理者或有這項授權的校區管理者發布。'
    : '可以直接發布共用內容，也能審核內容編輯送上來的共用內容。'
}

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

// 讓總管理者自己想 12 字密碼，實務上會出現「Ivy12345678」。給一顆產生鈕，
// 用瀏覽器亂數挑不易混淆的字元；產生後直接顯示明文讓人抄給對方。
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomPassword(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('')
}
const passwordVisible = ref(false)
function generatePassword() {
  form.password = randomPassword()
  passwordVisible.value = true
}

// 新密碼只在這一次看得到（系統不寄信）：建立或重設成功後對話框不關，改成
// 顯示密碼與複製鈕，等總管理者自己按「完成」。
type SelectableInput = { focus: () => void; select: () => void } | null
const createdWho = ref('')
const createdPassword = ref('')
const createdInput = ref<SelectableInput>(null)
const resetDone = ref(false)
const resetResultInput = ref<SelectableInput>(null)

async function copyPassword(value: string, input: SelectableInput) {
  try {
    // 剪貼簿只在 HTTPS 或本機可用；失敗時選取密碼文字，讓人自己複製。
    await navigator.clipboard.writeText(value)
    ElMessage.success('已複製密碼')
  } catch {
    input?.focus()
    input?.select()
    notifyWarning('無法自動複製，已選取密碼，請手動複製')
  }
}

function openCreateDialog() {
  if (operationBusy.value || loading.value) return
  form.email = ''
  form.display_name = ''
  form.password = ''
  form.role = 'campus_admin'
  form.campus_keys = []
  form.shared_content = false
  form.export_data = false
  passwordVisible.value = false
  createErrors.email = ''
  createErrors.display_name = ''
  createErrors.password = ''
  createErrors.campus = ''
  clearCreated()
  dialogVisible.value = true
}

async function submitCreate() {
  if (createdPassword.value || operationBusy.value || loading.value) return
  if (!validateCreate()) {
    await focusFirstCreateError()
    return
  }
  const email = form.email.trim()
  const displayName = normalizedName(form.display_name)
  if (form.role === 'super_admin' && !(await confirmSuperAdmin(staffWithEmail({ display_name: displayName, email })))) return
  creating.value = true
  try {
    const created = await api.post<UserOut>('/admin/users', {
      email,
      display_name: displayName,
      password: form.password,
      role: form.role,
      campus_keys: form.role === 'super_admin' ? [] : form.campus_keys,
      capabilities: grantsFor(form.role, form.shared_content, form.export_data),
    })
    users.value.push(created)
    createdWho.value = staffWithEmail(created)
    createdPassword.value = form.password
  } catch (err) {
    const nameError = apiFieldError(err, 'display_name')
    if (emailRejected(err)) {
      createErrors.email = FULL_EMAIL_HINT
      await focusFirstCreateError()
    } else if (nameError) {
      createErrors.display_name = nameError
      await focusFirstCreateError()
    } else {
      notifyError(apiErrorMessage(err, '新增使用者失敗'))
    }
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
    ElMessage.success(updated.is_active ? `已恢復 ${staffWithEmail(updated)} 的登入` : `已停用 ${staffWithEmail(updated)}`)
  } catch (err) {
    notifyError(apiErrorMessage(err, '更新啟用狀態失敗'))
  } finally {
    togglingId.value = null
  }
}

function openScopeDialog(target: UserOut) {
  if (operationBusy.value) return
  scopeTarget.value = target
  scopeName.value = target.display_name ?? ''
  scopeNameServerError.value = ''
  scopeRole.value = target.role
  scopeShared.value = hasSharedGrant(target)
  scopeExport.value = hasExportGrant(target)
  scopeSelection.value = [...target.campus_keys]
  scopeDialogVisible.value = true
}

// 「角色與校區」對話框也可以替同事填或改顯示名稱（本人則在「我的帳號」自己改）。
// 名稱有變才另外送 PATCH …/display-name，沒變不送、不留操作紀錄。
const scopeName = ref('')
const scopeNameServerError = ref('')
const scopeNameInput = ref<{ focus: () => void } | null>(null)
watch(scopeName, () => { scopeNameServerError.value = '' })
const scopeNameChanged = computed(() => Boolean(scopeTarget.value) && normalizedName(scopeName.value) !== (scopeTarget.value?.display_name ?? null))

// 換角色時後端會收回個資匯出授權（總管理者要針對新職位重新決定），勾選框
// 跟著清掉並說明；改回原角色就恢復原狀。只改校區不影響。
const exportDroppedByRoleChange = computed(() =>
  Boolean(scopeTarget.value && scopeRole.value !== scopeTarget.value.role && hasExportGrant(scopeTarget.value)),
)
watch(scopeRole, (role) => {
  if (scopeTarget.value) scopeExport.value = role === scopeTarget.value.role && hasExportGrant(scopeTarget.value)
})

// 升為總管理者（原本不是）：單選下方先列出這個角色能做的事，儲存前再確認。
const promotingToSuperAdmin = computed(() => Boolean(scopeTarget.value && scopeRole.value === 'super_admin' && scopeTarget.value.role !== 'super_admin'))
const scopeMissingCampus = computed(() => scopeRole.value !== 'super_admin' && scopeSelection.value.length === 0)

function replaceUser(updated: UserOut) {
  const idx = users.value.findIndex((u) => u.id === updated.id)
  if (idx !== -1) users.value[idx] = updated
}

async function submitScope() {
  if (!scopeTarget.value || operationBusy.value || scopeMissingCampus.value) return
  if (displayNameError(scopeName.value)) {
    scopeNameInput.value?.focus()
    return
  }
  if (promotingToSuperAdmin.value && !(await confirmSuperAdmin(staffWithEmail(scopeTarget.value)))) return
  const target = scopeTarget.value
  const nameChanged = scopeNameChanged.value
  const campusKeys = scopeRole.value === 'super_admin' ? [] : scopeSelection.value
  const wanted = grantsFor(scopeRole.value, scopeShared.value, scopeExport.value)
  // 只改名稱時不送角色：後端每收到一次角色就記一筆「變更角色與校區」，沒改也會記。
  const onlyRenamed = nameChanged && scopeRole.value === target.role && sameGrants(campusKeys, target.campus_keys) && sameGrants(wanted, target.capabilities ?? [])
  savingScope.value = true
  try {
    // 名稱先存：改名失敗（例如後端說字數不對）時角色與校區都還沒動，改好再按一次儲存即可。
    if (nameChanged) {
      const renamed = await api.patch<UserOut>(`/admin/users/${target.id}/display-name`, { display_name: normalizedName(scopeName.value) })
      replaceUser(renamed)
      renameVisitStaff(renamed.id, renamed.display_name ?? null)
      scopeTarget.value = renamed
    }
    if (onlyRenamed) {
      scopeDialogVisible.value = false
      ElMessage.success('已更新顯示名稱')
      return
    }
    let updated = await api.patch<UserOut>(`/admin/users/${target.id}/role`, {
      role: scopeRole.value,
      campus_keys: campusKeys,
    })
    // 改角色時後端會先清掉新角色不適用的授權；剩下的跟畫面上勾的不同才送。
    if (!sameGrants(wanted, updated.capabilities ?? [])) {
      updated = await api.patch<UserOut>(`/admin/users/${target.id}/capabilities`, {
        capabilities: wanted,
      })
    }
    replaceUser(updated)
    scopeDialogVisible.value = false
    ElMessage.success(nameChanged ? '已更新顯示名稱、角色、校區與權限' : '已更新角色、校區與權限')
  } catch (err) {
    const nameError = apiFieldError(err, 'display_name')
    if (nameError) {
      scopeNameServerError.value = nameError
      scopeNameInput.value?.focus()
    } else {
      notifyError(apiErrorMessage(err, '更新角色、校區與權限失敗'))
    }
  } finally {
    savingScope.value = false
  }
}

function openReset(target: UserOut) {
  if (operationBusy.value) return
  resetTarget.value = target
  clearReset()
  resetVisible.value = true
}

function generateResetPassword() {
  resetPassword.value = randomPassword()
}

async function submitReset() {
  if (!resetTarget.value || resetDone.value || !passwordOk(resetPassword.value)) return
  resetting.value = true
  try {
    await api.post(`/admin/users/${resetTarget.value.id}/password`, { password: resetPassword.value })
    resetDone.value = true
  } catch (err) {
    // 自己的那一列沒有「重設密碼」（UserActions 只指到「我的帳號」）；後端對自己重設
    // 回 409 USE_CHANGE_PASSWORD 時，訊息本身就指向「我的帳號」。
    notifyError(apiErrorMessage(err, '重設密碼失敗'))
  } finally {
    resetting.value = false
  }
}

// 別人的帳號疑似被盜用時：清掉 LINE／Google 綁定並撤銷對方所有 session。自己的
// 綁定要到「我的帳號」解除（需要重新驗證），後端對自己呼叫回 409 USE_ACCOUNT_PAGE。
async function clearExternalLogins(target: UserOut) {
  if (operationBusy.value || isSelf(target)) return
  clearingId.value = target.id
  try {
    const updated = await api.post<UserOut>(`/admin/users/${target.id}/clear-external-logins`)
    const idx = users.value.findIndex((u) => u.id === updated.id)
    if (idx !== -1) users.value[idx] = updated
    ElMessage.success(`已解除 ${updated.email} 的 Google／LINE 綁定，對方所有裝置都已登出。`)
  } catch (err) {
    notifyError(apiErrorMessage(err, '解除綁定失敗'))
  } finally {
    clearingId.value = null
  }
}

function isSelf(u: UserOut): boolean {
  return u.id === authStore.user?.id
}

// 對話框關掉後不再留著明文密碼。
function clearCreated() {
  createdWho.value = ''
  createdPassword.value = ''
}
function clearReset() {
  resetPassword.value = ''
  resetDone.value = false
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
      <PageHeader lead="總管理者管理全部五校；其他角色只看得到被指定的校區。每個角色能做什麼，在新增使用者或調整角色時會一起列出。">
        <template #actions>
          <el-button type="primary" :icon="Plus" :disabled="operationBusy || loading" @click="openCreateDialog">新增使用者</el-button>
        </template>
      </PageHeader>

      <div class="filter-bar">
        <label class="filter-field filter-search"><span>搜尋使用者</span><el-input v-model="search" placeholder="名稱、Email、角色或校區" clearable /></label>
        <label class="filter-field"><span>帳號狀態</span><el-select v-model="status" placeholder="全部狀態"><el-option label="全部狀態" value="" /><el-option label="啟用中" value="active" /><el-option label="已停用" value="inactive" /></el-select></label>
      </div>
      <div class="list-summary" role="status"><span>{{ loading ? '正在讀取使用者…' : loadError ? '使用者尚未載入' : `顯示 ${visibleUsers.length} / ${users.length} 位使用者` }}</span><el-button :loading="loading" :disabled="operationBusy" @click="loadUsers">重新整理</el-button></div>
      <el-alert v-if="loadError" class="inline-error" type="error" :title="loadError" :closable="false" show-icon><el-button @click="loadUsers">重新載入</el-button></el-alert>
      <div v-else-if="loading" class="panel list-skeleton"><el-skeleton animated :rows="5" /></div>
      <template v-else>
      <p v-if="unnamedCount" class="hint users__unnamed" data-test="unnamed-hint">
        有 {{ unnamedCount }} 位還沒設定顯示名稱，名稱先用 Email @ 前面那段（灰字）。可以請本人到「我的帳號」設定，或按「角色與校區」替他填。
      </p>
      <div class="panel">
        <el-empty v-if="!visibleUsers.length" :description="search || status ? '找不到符合條件的使用者' : '尚未建立任何使用者'"><el-button v-if="search || status" @click="search = ''; status = ''">清除篩選</el-button></el-empty>
        <template v-else>
        <el-table class="data-table" :data="visibleUsers">
          <!-- 名稱在上、Email 小字在下：同事在承辦人、操作紀錄看到的是名稱，這裡對得起來。 -->
          <el-table-column label="名稱與 Email" min-width="220">
            <template #default="{ row }: { row: UserOut }">
              <span class="user-name" :class="{ 'is-inactive': !row.is_active }">
                <strong v-if="row.display_name" data-test="user-name">{{ row.display_name }}</strong>
                <span v-else class="muted" title="還沒設定顯示名稱，先用 Email @ 前面那段" data-test="user-name-fallback">{{ staffLabel(row) }}</span>
                <el-tag v-if="isSelf(row)" size="small" type="info" round class="self-tag">你</el-tag>
              </span>
              <span class="user-email">{{ row.email }}</span>
              <span v-if="loginLinks(row)" class="login-links" :title="`已綁定 ${loginLinks(row)} 登入`">{{ loginLinks(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="角色" min-width="140">
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
              <UserActions :user="row" :self="isSelf(row)" :busy="operationBusy" :pending="togglingId === row.id" @scope="openScopeDialog" @toggle="toggleActive" @reset="openReset" @clear-logins="clearExternalLogins" />
            </template>
          </el-table-column>
        </el-table>
        <ul class="mobile-records" aria-label="使用者清單">
          <li v-for="user in visibleUsers" :key="user.id" class="mobile-record">
            <div class="record-heading">
              <strong><span v-if="user.display_name">{{ user.display_name }}</span><span v-else class="muted" title="還沒設定顯示名稱，先用 Email @ 前面那段">{{ staffLabel(user) }}</span><el-tag v-if="isSelf(user)" size="small" type="info" class="self-tag">你</el-tag></strong>
              <el-tag :type="user.is_active ? 'success' : 'info'">{{ user.is_active ? '啟用中' : '已停用' }}</el-tag>
            </div>
            <dl class="record-meta"><dt>Email</dt><dd>{{ user.email }}</dd><dt>角色</dt><dd>{{ roleLabel(user.role) }}{{ hasSharedGrant(user) ? '・可編全站內容' : '' }}{{ hasExportGrant(user) ? '・可匯出個資' : '' }}</dd><dt>校區範圍</dt><dd>{{ user.role === 'super_admin' ? '全部校區' : campusLabels(user.campus_keys) || '尚未指定' }}</dd><dt>快速登入</dt><dd>{{ loginLinks(user) || '未綁定' }}</dd></dl>
            <div class="record-actions"><UserActions :user="user" :self="isSelf(user)" :busy="operationBusy" :pending="togglingId === user.id" @scope="openScopeDialog" @toggle="toggleActive" @reset="openReset" @clear-logins="clearExternalLogins" /></div>
          </li>
        </ul>
        </template>
      </div>
      </template>

      <el-dialog v-model="dialogVisible" title="新增使用者" width="480px" :show-close="!creating" :close-on-click-modal="!creating && !createdPassword" :close-on-press-escape="!creating" @closed="clearCreated">
        <div v-if="createdPassword" class="password-result" data-test="created-password">
          <el-alert type="success" :closable="false" show-icon :title="`已建立 ${createdWho}`" />
          <p class="hint">系統不會寄信。請用電話或當面把下面的密碼告訴對方；按「完成」關閉後，這裡不會再顯示。</p>
          <div class="password-row">
            <el-input ref="createdInput" :model-value="createdPassword" readonly aria-label="新帳號的密碼" class="password-result__value" />
            <el-button type="primary" plain @click="copyPassword(createdPassword, createdInput)">複製密碼</el-button>
          </div>
        </div>
        <el-form v-else label-position="top" class="user-form" :disabled="creating" @submit.prevent="submitCreate">
          <el-form-item label="Email" for="new-user-email" required :error="createErrors.email" :show-message="false">
            <el-input
              id="new-user-email"
              ref="emailInput"
              v-model="form.email"
              type="email"
              autocomplete="off"
              :aria-invalid="createErrors.email ? 'true' : undefined"
              :aria-describedby="createErrors.email ? 'new-user-email-error' : undefined"
            />
            <p v-if="createErrors.email" id="new-user-email-error" class="field-error">{{ createErrors.email }}</p>
          </el-form-item>
          <DisplayNameField ref="nameInput" v-model="form.display_name" input-id="new-user-display-name" :server-error="createErrors.display_name" />
          <el-form-item label="密碼" for="new-user-password" required :error="createErrors.password" :show-message="false">
            <div class="password-row">
              <el-input
                id="new-user-password"
                ref="passwordInput"
                v-model="form.password"
                :type="passwordVisible ? 'text' : 'password'"
                :show-password="!passwordVisible"
                autocomplete="new-password"
                :aria-invalid="createErrors.password ? 'true' : undefined"
                :aria-describedby="createErrors.password ? 'new-user-password-error' : undefined"
              />
              <el-button @click="generatePassword">產生密碼</el-button>
            </div>
            <p v-if="createErrors.password" id="new-user-password-error" class="field-error">{{ createErrors.password }}</p>
            <span v-else class="field-help" :class="{ 'is-ok': passwordOk(form.password) }">
              {{ passwordHint(form.password) }}建立後會顯示密碼與複製鈕，方便抄給對方。
            </span>
          </el-form-item>
          <el-form-item label="角色">
            <el-radio-group v-model="form.role" class="role-group" aria-label="角色">
              <div v-for="role in ROLE_ORDER" :key="role" class="role-option" :class="{ 'is-active': form.role === role }">
                <el-radio :value="role">{{ ROLE_LABELS[role] }}</el-radio>
                <p class="role-option__desc">{{ ROLE_DESCRIPTIONS[role] }}</p>
              </div>
            </el-radio-group>
            <el-alert v-if="form.role === 'super_admin'" class="super-admin-alert" type="warning" :closable="false" show-icon title="總管理者的權限最大">
              {{ SUPER_ADMIN_POWERS }}。建立前會再確認一次。
            </el-alert>
          </el-form-item>
          <el-form-item v-if="form.role !== 'super_admin'" label="負責校區" required :error="createErrors.campus" :show-message="false">
            <div ref="campusField" class="campus-field">
              <el-checkbox-group v-model="form.campus_keys" aria-label="負責校區">
                <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
              </el-checkbox-group>
              <p v-if="createErrors.campus" class="field-error">{{ createErrors.campus }}</p>
              <span v-else class="field-help">至少選一校；只看得到、改得到勾選的校區。</span>
            </div>
          </el-form-item>
          <el-form-item v-if="SHARED_ROLES.includes(form.role)">
            <el-checkbox v-model="form.shared_content">也可以編輯全站共用內容</el-checkbox>
            <span class="field-help">{{ SHARED_CONTENT_SCOPE }}{{ sharedContentHelp(form.role) }}</span>
          </el-form-item>
          <el-form-item v-if="EXPORT_ROLES.includes(form.role)">
            <el-checkbox v-model="form.export_data">可以匯出負責校區的家長個資（CSV）</el-checkbox>
            <span class="field-help">{{ EXPORT_HELP }}</span>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button v-if="createdPassword" type="primary" @click="dialogVisible = false">完成</el-button>
          <template v-else>
            <el-button :disabled="creating" @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="creating" @click="submitCreate">建立帳號</el-button>
          </template>
        </template>
      </el-dialog>

      <el-dialog v-model="scopeDialogVisible" :title="`${staffWithEmail(scopeTarget)} 的名稱、角色與校區`" width="480px" :show-close="!savingScope" :close-on-click-modal="!savingScope" :close-on-press-escape="!savingScope">
        <el-form label-position="top" class="user-form" :disabled="savingScope" @submit.prevent="submitScope">
          <DisplayNameField
            ref="scopeNameInput"
            v-model="scopeName"
            input-id="scope-user-display-name"
            :server-error="scopeNameServerError"
            help="同事在承辦人、聯絡紀錄、發布紀錄與操作紀錄看到的名字；本人也可以在「我的帳號」自己改。留空就用 Email @ 前面那段。"
          />
          <el-form-item label="角色">
            <el-radio-group v-model="scopeRole" class="role-group" aria-label="角色">
              <div v-for="role in ROLE_ORDER" :key="role" class="role-option" :class="{ 'is-active': scopeRole === role }">
                <el-radio :value="role">{{ ROLE_LABELS[role] }}</el-radio>
                <p class="role-option__desc">{{ ROLE_DESCRIPTIONS[role] }}</p>
              </div>
            </el-radio-group>
            <el-alert v-if="promotingToSuperAdmin" class="super-admin-alert" type="warning" :closable="false" show-icon title="總管理者的權限最大">
              {{ SUPER_ADMIN_POWERS }}。儲存前會再確認一次。
            </el-alert>
            <span v-if="exportDroppedByRoleChange" class="field-help" data-test="export-dropped">換角色會收回原本的個資匯出授權{{ EXPORT_ROLES.includes(scopeRole) ? '，新職位需要的話請在下方重新勾選' : '' }}。</span>
          </el-form-item>
          <el-form-item v-if="scopeRole !== 'super_admin'" label="負責校區" required :error="scopeMissingCampus ? '請至少勾選一個負責校區' : ''" :show-message="false">
            <div class="campus-field">
              <el-checkbox-group v-model="scopeSelection" aria-label="負責校區">
                <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
              </el-checkbox-group>
              <p v-if="scopeMissingCampus" id="scope-campus-error" class="field-error">請至少勾選一個負責校區，才能儲存。</p>
            </div>
          </el-form-item>
          <el-form-item v-if="SHARED_ROLES.includes(scopeRole)">
            <el-checkbox v-model="scopeShared">也可以編輯全站共用內容</el-checkbox>
            <span class="field-help">{{ SHARED_CONTENT_SCOPE }}{{ sharedContentHelp(scopeRole) }}</span>
          </el-form-item>
          <el-form-item v-if="EXPORT_ROLES.includes(scopeRole)">
            <el-checkbox v-model="scopeExport">可以匯出負責校區的家長個資（CSV）</el-checkbox>
            <span class="field-help">{{ EXPORT_HELP }}</span>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button :disabled="savingScope" @click="scopeDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="savingScope" :disabled="scopeMissingCampus" :aria-describedby="scopeMissingCampus ? 'scope-campus-error' : undefined" @click="submitScope">儲存</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="resetVisible" :title="`重設 ${staffWithEmail(resetTarget)} 的密碼`" width="440px" :show-close="!resetting" :close-on-click-modal="!resetting && !resetDone" :close-on-press-escape="!resetting" @closed="clearReset">
        <div v-if="resetDone" class="password-result" data-test="reset-password">
          <el-alert type="success" :closable="false" show-icon title="已重設密碼，對方所有裝置都已登出" />
          <p class="hint">系統不會寄信。請用電話或當面把下面的新密碼告訴 {{ staffWithEmail(resetTarget) }}；按「完成」關閉後，這裡不會再顯示。</p>
          <div class="password-row">
            <el-input ref="resetResultInput" :model-value="resetPassword" readonly aria-label="新密碼" class="password-result__value" />
            <el-button type="primary" plain @click="copyPassword(resetPassword, resetResultInput)">複製密碼</el-button>
          </div>
        </div>
        <template v-else>
          <p class="hint">重設後對方所有已登入的裝置會被登出。系統不會寄信；重設後會顯示新密碼與複製鈕，請用電話或當面告訴對方。</p>
          <div class="password-row">
            <el-input v-model="resetPassword" type="text" autocomplete="new-password" placeholder="12 字以上" aria-label="新密碼" :disabled="resetting" />
            <el-button :disabled="resetting" @click="generateResetPassword">產生密碼</el-button>
          </div>
          <span class="field-help" :class="{ 'is-ok': passwordOk(resetPassword) }">{{ passwordHint(resetPassword) }}</span>
        </template>
        <template #footer>
          <el-button v-if="resetDone" type="primary" @click="resetVisible = false">完成</el-button>
          <template v-else>
            <el-button :disabled="resetting" @click="resetVisible = false">取消</el-button>
            <el-button type="primary" :loading="resetting" :disabled="!passwordOk(resetPassword)" @click="submitReset">重設密碼</el-button>
          </template>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.password-row { display: flex; gap: 8px; width: 100%; }
.password-row .el-input { flex: 1; min-width: 0; }

/* 五個角色的說明一次列出，方便比較；說明放在 el-radio 外面，選項文字只有角色名。 */
.role-group { display: grid; gap: 2px; width: 100%; }
.role-option { padding: 2px 8px 6px; border-radius: var(--radius); }
.role-option.is-active { background: var(--surface-2); }
.role-option__desc { margin: 0; padding-left: 22px; color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.super-admin-alert { margin-top: 8px; line-height: 1.5; }

.campus-field { width: 100%; }

.field-error {
  margin: 0;
  padding-top: 4px;
  color: var(--el-color-danger);
  font-size: 13px;
  line-height: 1.45;
}

/* Element Plus 的勾選與單選預設不換行、固定 32px 高：長說明會被推到對話框外，
   手機上也點不準。允許換行，手機與觸控拉到 44px。 */
.user-form :deep(.el-checkbox),
.user-form :deep(.el-radio) {
  height: auto;
  min-height: 32px;
  max-width: 100%;
  white-space: normal;
}
.user-form :deep(.el-checkbox__label),
.user-form :deep(.el-radio__label) {
  min-width: 0;
  white-space: normal;
  line-height: 1.5;
}
.user-form :deep(.el-form-item__content > .el-checkbox) { margin-right: 0; }

.password-result { display: grid; gap: 12px; }
.password-result .hint { margin: 0; }
.password-result__value :deep(.el-input__inner) {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.04em;
}

@media (max-width: 720px), (pointer: coarse) {
  .user-form :deep(.el-checkbox),
  .user-form :deep(.el-radio) { min-height: 44px; }
  .role-option__desc { font-size: 13px; }
}

.self-tag {
  margin-left: 8px;
}

.login-links {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
}

/* 名稱一行、Email 小字一行；停用的帳號名稱也轉灰。 */
.user-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  overflow-wrap: anywhere;
}
.user-name strong { font-weight: 600; }
.user-name.is-inactive strong { color: var(--ink-3); }
.user-email {
  display: block;
  color: var(--ink-3);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.users__unnamed { margin: 0 0 12px; }

.field-help.is-ok {
  color: var(--el-color-success);
}
</style>
