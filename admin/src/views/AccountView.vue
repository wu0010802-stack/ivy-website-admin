<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { notifyError } from '../composables/notify'
import PageHeader from '../components/PageHeader.vue'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'
import DisplayNameField from '../components/DisplayNameField.vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, apiFieldError, loginLimitedMessage } from '../api/errors'
import { reauthRequiredMessage, startLineLink, type ReauthBody } from '../api/oauth'
import { campusLabels, displayNameError, GRANT_LABELS, ROLE_DESCRIPTIONS, roleLabel, staffLabel } from '../api/labels'
import type { AuthProviders, DisplayNameUpdateRequest, UserOut } from '../api/types'
import { renameVisitStaff } from '../composables/useVisitStaff'
import { useAuthStore } from '../stores/auth'

type Notice = { type: 'success' | 'info' | 'warning' | 'error'; text: string }

// 綁定 callback 帶回的結果碼；只認得這幾個，其他值一律不顯示。
const LINK_RESULTS: Record<string, Notice> = {
  linked: { type: 'success', text: '已綁定 LINE，下次可以在登入頁直接用 LINE 登入。' },
  cancelled: { type: 'info', text: '已取消綁定，帳號沒有任何變更。' },
  in_use: { type: 'error', text: '這個 LINE 帳號已經綁定另一個後台帳號。請先從那個帳號解除綁定，或改用其他 LINE 帳號。' },
  already: { type: 'warning', text: '這個帳號已經綁定其他 LINE，請先解除綁定再重新綁定。' },
  failed: { type: 'error', text: 'LINE 綁定未完成或已逾時，請重新操作。' },
  unavailable: { type: 'error', text: 'LINE 登入尚未啟用，暫時無法綁定。' },
}

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const lineEnabled = ref(false)
const googleEnabled = ref(false)
const providersLoaded = ref(false)
const linking = ref(false)
const unlinking = ref(false)
const googleUnlinking = ref(false)
// 本人更改密碼（與側欄鑰匙鈕同一個對話框）。後端對「重設自己的密碼」回
// 409 USE_CHANGE_PASSWORD 時，訊息會請人到這一頁來改。
const passwordOpen = ref(false)
// Google 與 LINE 都沒開放時，兩張「尚未啟用」的卡片佔掉主要版面、讀起來像自己漏做
// 了什麼，收成密碼區裡的一行。已綁定的那張照樣顯示，讓人可以解除。
const bothUnavailable = computed(() => providersLoaded.value && !googleEnabled.value && !lineEnabled.value)
const showGoogle = computed(() => Boolean(auth.user?.google_linked) || !bothUnavailable.value)
const showLine = computed(() => Boolean(auth.user?.line_linked) || !bothUnavailable.value)
const roleDescription = computed(() => (auth.user ? (ROLE_DESCRIPTIONS as Record<string, string>)[auth.user.role] ?? '' : ''))
// 總管理者逐人給的額外授權；只列認得的，不把代碼印出來。
const grants = computed(() => (auth.user?.capabilities ?? [])
  .filter(code => Object.hasOwn(GRANT_LABELS, code))
  .map(code => GRANT_LABELS[code]))

// 變更自己的登入方式（綁定／解除 LINE、解除 Google）前的重新驗證：登入超過
// 10 分鐘時後端回 403 REAUTH_REQUIRED，這裡請本人輸入目前的密碼再送一次。
// 只用 Google／LINE 登入、不知道密碼的人，重新登入後 10 分鐘內再操作即可。
type ReauthAction = 'link' | 'unlink-line' | 'unlink-google'
const REAUTH_LOCKED_ALTERNATIVE = '也可以登出後用 Google／LINE 重新登入，10 分鐘內再回來操作'
const reauth = reactive({
  open: false,
  action: null as ReauthAction | null,
  message: '',
  password: '',
  error: '',
  submitting: false,
})
const reauthInput = ref<{ focus: () => void } | null>(null)

async function openReauth(action: ReauthAction, message: string) {
  reauth.action = action
  reauth.message = message
  reauth.password = ''
  reauth.error = ''
  reauth.open = true
  await nextTick()
  reauthInput.value?.focus()
}

function closeReauth() {
  reauth.open = false
  reauth.password = ''
  reauth.error = ''
}

/** 需要重新驗證（403）或帳號鎖定中（429）時處理掉並回 true；其他錯誤交回呼叫端。 */
function handleReauthError(action: ReauthAction, err: unknown, withPassword: boolean): boolean {
  const message = reauthRequiredMessage(err)
  if (message) {
    // 已經帶了密碼還是 403：密碼不對，留在對話框讓本人重打。
    if (withPassword && reauth.open) reauth.error = message
    else void openReauth(action, message)
    return true
  }
  if (err instanceof ApiError && err.status === 429) {
    closeReauth()
    notice.value = { type: 'error', text: loginLimitedMessage(err, { verb: '驗證', alternative: REAUTH_LOCKED_ALTERNATIVE }) }
    return true
  }
  return false
}

async function submitReauth() {
  if (reauth.submitting || !reauth.action) return
  if (!reauth.password) {
    reauth.error = '請輸入目前的密碼。'
    return
  }
  const body: ReauthBody = { current_password: reauth.password }
  // 密碼只用這一次，不留在畫面狀態裡。
  reauth.password = ''
  reauth.error = ''
  reauth.submitting = true
  try {
    if (reauth.action === 'link') await link(body)
    else if (reauth.action === 'unlink-line') await unlink(body)
    else await unlinkGoogle(body)
  } finally {
    reauth.submitting = false
  }
}

const result = route.query.line_link
const notice = ref<Notice | null>(
  typeof result === 'string' && Object.hasOwn(LINK_RESULTS, result) ? LINK_RESULTS[result] ?? null : null,
)

// ---- 顯示名稱：同事在承辦人、聯絡紀錄、發布紀錄與操作紀錄看到的名字 ----
// 本人隨時可以改（PATCH /auth/me），留空＝不設定，畫面改用 Email @ 前面那段。
const nameDraft = ref(auth.user?.display_name ?? '')
const nameSaving = ref(false)
const nameServerError = ref('')
const nameInput = ref<{ focus: () => void } | null>(null)
const savedName = computed(() => auth.user?.display_name ?? null)
const nameDirty = computed(() => (nameDraft.value.trim() || null) !== savedName.value)
watch(nameDraft, () => { nameServerError.value = '' })
// 登入狀態重新讀取後名字變了（例如總管理者剛替你改過）：沒有正在修改時跟著換。
watch(savedName, (value, previous) => {
  if (!nameSaving.value && (nameDraft.value.trim() || null) === (previous ?? null)) nameDraft.value = value ?? ''
})

async function saveName() {
  if (!auth.user || nameSaving.value || !nameDirty.value) return
  if (displayNameError(nameDraft.value)) {
    nameInput.value?.focus()
    return
  }
  nameSaving.value = true
  try {
    const body: DisplayNameUpdateRequest = { display_name: nameDraft.value.trim() || null }
    const updated = await api.patch<UserOut>('/auth/me', body)
    auth.user = { ...auth.user, ...updated }
    nameDraft.value = updated.display_name ?? ''
    renameVisitStaff(updated.id, updated.display_name ?? null)
    ElMessage.success(updated.display_name ? `已更新顯示名稱，同事會看到「${updated.display_name}」` : `已清除顯示名稱，同事會看到「${staffLabel(updated)}」`)
  } catch (err) {
    const fieldError = apiFieldError(err, 'display_name')
    if (fieldError) {
      nameServerError.value = fieldError
      nameInput.value?.focus()
    } else {
      notifyError(apiErrorMessage(err, '顯示名稱沒有更新，請再試一次'))
    }
  } finally {
    nameSaving.value = false
  }
}

function setLineLinked(linked: boolean) {
  if (auth.user) auth.user = { ...auth.user, line_linked: linked }
}

function setGoogleLinked(linked: boolean) {
  if (auth.user) auth.user = { ...auth.user, google_linked: linked }
}

onMounted(async () => {
  if (route.query.line_link !== undefined) {
    // 重新整理不要再跳一次結果提示。
    const { line_link: _, ...rest } = route.query
    void router.replace({ query: rest })
  }
  try {
    const providers = await api.get<AuthProviders>('/auth/providers')
    lineEnabled.value = providers.line === true
    googleEnabled.value = providers.google === true
  } catch {
    lineEnabled.value = false
    googleEnabled.value = false
  } finally {
    providersLoaded.value = true
  }
})

async function link(body?: ReauthBody) {
  if (linking.value) return
  linking.value = true
  notice.value = null
  try {
    // 成功會整頁前往 LINE，按鈕維持 loading 直到離開。
    await startLineLink(body)
    closeReauth()
  } catch (err) {
    linking.value = false
    if (handleReauthError('link', err, body !== undefined)) return
    closeReauth()
    if (err instanceof ApiError && err.status === 409) {
      setLineLinked(true)
      notice.value = { type: 'warning', text: '這個帳號已經綁定 LINE（可能是在其他分頁完成的）。要換成其他 LINE 請先解除綁定。' }
    } else if (err instanceof ApiError && err.status === 404) {
      lineEnabled.value = false
      notice.value = LINK_RESULTS.unavailable ?? null
    } else {
      notice.value = { type: 'error', text: '無法開始綁定，請稍後再試。' }
    }
  }
}

async function unlinkGoogle(body?: ReauthBody) {
  if (googleUnlinking.value) return
  googleUnlinking.value = true
  notice.value = null
  try {
    await (body ? api.delete('/auth/google/link', body) : api.delete('/auth/google/link'))
    closeReauth()
    setGoogleLinked(false)
    notice.value = { type: 'success', text: '已解除 Google 綁定。之後用同一個 Email 的 Google 帳號登入時，會重新綁定。' }
  } catch (err) {
    if (!handleReauthError('unlink-google', err, body !== undefined)) {
      closeReauth()
      notice.value = { type: 'error', text: '解除綁定失敗，請稍後再試。' }
    }
  } finally {
    googleUnlinking.value = false
  }
}

async function unlink(body?: ReauthBody) {
  if (unlinking.value) return
  unlinking.value = true
  notice.value = null
  try {
    await (body ? api.delete('/auth/line/link', body) : api.delete('/auth/line/link'))
    closeReauth()
    setLineLinked(false)
    notice.value = { type: 'success', text: '已解除 LINE 綁定，之後無法再用這個 LINE 登入。' }
  } catch (err) {
    if (!handleReauthError('unlink-line', err, body !== undefined)) {
      closeReauth()
      notice.value = { type: 'error', text: '解除綁定失敗，請稍後再試。' }
    }
  } finally {
    unlinking.value = false
  }
}
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="查看自己的帳號資料，設定同事看到的名字，並更改密碼、設定登入方式。" />

    <el-alert v-if="notice" :type="notice.type" :title="notice.text" :closable="false" show-icon class="account__notice" />

    <template v-if="auth.user">
      <section class="panel">
        <div class="panel__head"><h2>帳號</h2></div>
        <div class="panel__body">
          <dl class="account__facts">
            <div><dt>Email</dt><dd>{{ auth.user.email }}</dd></div>
            <div>
              <dt>角色</dt>
              <dd>{{ roleLabel(auth.user.role) }}<span v-if="roleDescription" class="account__role-desc">{{ roleDescription }}</span></dd>
            </div>
            <div v-if="auth.user.role !== 'super_admin'"><dt>負責校區</dt><dd>{{ campusLabels(auth.user.campus_keys) || '尚未指定' }}</dd></div>
            <div v-if="grants.length"><dt>額外授權</dt><dd>{{ grants.join('、') }}</dd></div>
          </dl>
          <p class="field-help">Email、角色與校區由總管理者在「使用者」設定。</p>
        </div>
      </section>

      <section class="panel" aria-labelledby="account-name-title">
        <div class="panel__head"><h2 id="account-name-title">顯示名稱</h2></div>
        <div class="panel__body">
          <el-form label-position="top" class="account__name" :disabled="nameSaving" @submit.prevent="saveName">
            <DisplayNameField
              ref="nameInput"
              v-model="nameDraft"
              input-id="account-display-name"
              :server-error="nameServerError"
              help="同事在承辦人、聯絡紀錄、發布紀錄與操作紀錄看到的名字，建議用園裡平常叫的稱呼。留空就用 Email @ 前面那段。"
            />
            <el-button type="primary" :loading="nameSaving" :disabled="!nameDirty" data-test="save-display-name" @click="saveName">儲存名稱</el-button>
          </el-form>
        </div>
      </section>

      <!-- 員工進「我的帳號」最常是要改密碼；側欄的鑰匙圖示保留，這裡是看得懂的入口。 -->
      <section class="panel">
        <div class="panel__head"><h2>密碼</h2></div>
        <div class="panel__body account__line">
          <p>用 Email 與密碼登入後台。更改後，其他電腦與手機上的登入會被登出，正在用的這個瀏覽器維持登入。</p>
          <el-button type="primary" plain data-test="change-password" @click="passwordOpen = true">更改密碼</el-button>
          <p class="field-help">忘記密碼請聯絡總管理者重設。</p>
          <p v-if="bothUnavailable" class="field-help" data-test="password-only">目前只開放 Email 與密碼登入。</p>
        </div>
      </section>

      <section v-if="showGoogle" class="panel">
        <div class="panel__head account__line-head">
          <h2>Google 登入</h2>
          <!-- 沒開放又沒綁定時不掛標籤：「尚未綁定」會讓人以為要自己去綁。 -->
          <el-tag v-if="auth.user.google_linked || googleEnabled" :type="auth.user.google_linked ? 'success' : 'info'" disable-transitions>
            {{ auth.user.google_linked ? '已綁定' : '尚未綁定' }}
          </el-tag>
        </div>
        <div class="panel__body account__line">
          <template v-if="auth.user.google_linked">
            <!-- 綁定會保留，但 Google 登入關掉時登入頁沒有 Google 按鈕，不能說「可以登入」。 -->
            <el-skeleton v-if="!providersLoaded" animated :rows="1" />
            <p v-else-if="googleEnabled">可以在登入頁用 Google 直接登入，Email 與密碼仍然可以用。</p>
            <p v-else data-test="google-disabled-linked">Google 登入目前未開放，綁定仍保留，可以解除。</p>
            <el-popconfirm
              title="解除後這個帳號不再記得目前的 Google 帳號；之後用同一個 Email 的 Google 帳號登入會重新綁定。"
              confirm-button-text="解除綁定"
              cancel-button-text="先不要"
              confirm-button-type="danger"
              :width="300"
              @confirm="unlinkGoogle()"
            >
              <template #reference>
                <el-button type="danger" plain data-test="google-unlink" :loading="googleUnlinking">解除綁定</el-button>
              </template>
            </el-popconfirm>
            <p v-if="googleEnabled" class="field-help">Google 帳號重建過、登入時顯示「沒有權限」時，先解除綁定，登出後再用 Google 登入一次即可。</p>
          </template>
          <el-skeleton v-else-if="!providersLoaded" animated :rows="1" />
          <!-- 登入中開登入頁會直接回到後台（router 恢復 session），所以要先登出。 -->
          <p v-else-if="googleEnabled">登出後在登入頁按「使用 Google 登入」，用和這個帳號相同 Email 的 Gmail 或 Google Workspace 帳號登入，就會自動綁定。其他 Email 的 Google 帳號無法綁定。</p>
          <p v-else>Google 登入尚未啟用。</p>
        </div>
      </section>

      <section v-if="showLine" class="panel">
        <div class="panel__head account__line-head">
          <h2>LINE 登入</h2>
          <el-tag v-if="auth.user.line_linked || lineEnabled" :type="auth.user.line_linked ? 'success' : 'info'" disable-transitions>
            {{ auth.user.line_linked ? '已綁定' : '尚未綁定' }}
          </el-tag>
        </div>
        <div class="panel__body account__line">
          <template v-if="auth.user.line_linked">
            <el-skeleton v-if="!providersLoaded" animated :rows="1" />
            <p v-else-if="lineEnabled">可以在登入頁用 LINE 直接登入，Email 與密碼仍然可以用。</p>
            <p v-else data-test="line-disabled-linked">LINE 登入目前未開放，綁定仍保留，可以解除。</p>
            <el-popconfirm
              title="解除後就不能再用這個 LINE 登入，Email 與密碼不受影響。"
              confirm-button-text="解除綁定"
              cancel-button-text="先不要"
              confirm-button-type="danger"
              :width="280"
              @confirm="unlink()"
            >
              <template #reference>
                <el-button type="danger" plain :loading="unlinking">解除綁定</el-button>
              </template>
            </el-popconfirm>
          </template>
          <el-skeleton v-else-if="!providersLoaded" animated :rows="1" />
          <template v-else-if="lineEnabled">
            <p>綁定後可以在登入頁用 LINE 直接登入，Email 與密碼仍然可以用。按下後會前往 LINE 確認身分，完成後回到這一頁。</p>
            <el-button type="primary" data-test="line-link" :loading="linking" @click="link()">綁定 LINE</el-button>
          </template>
          <p v-else>LINE 登入尚未啟用，啟用後這裡會出現綁定按鈕。</p>
          <p v-if="lineEnabled || auth.user.line_linked" class="field-help">後台只記錄 LINE 提供的帳號識別碼，不讀取暱稱、大頭貼或 Email。</p>
        </div>
      </section>
      <ChangePasswordDialog v-model="passwordOpen" />
    </template>

    <el-dialog
      v-model="reauth.open"
      title="確認是你本人"
      width="min(420px, 100%)"
      :show-close="!reauth.submitting"
      :close-on-click-modal="!reauth.submitting"
      :close-on-press-escape="!reauth.submitting"
      @closed="closeReauth"
    >
      <form class="account__reauth" data-test="reauth-form" @submit.prevent="submitReauth">
        <p>{{ reauth.message }}</p>
        <label class="account__reauth-field">
          <span>目前的密碼</span>
          <el-input
            ref="reauthInput"
            v-model="reauth.password"
            type="password"
            show-password
            autocomplete="current-password"
            maxlength="128"
            :disabled="reauth.submitting"
            data-test="reauth-password"
          />
        </label>
        <p v-if="reauth.error" class="account__reauth-error" role="alert" data-test="reauth-error">{{ reauth.error }}</p>
        <p class="field-help">只用 Google 或 LINE 登入、不知道密碼的話：先登出，再用 Google／LINE 重新登入，10 分鐘內回到這一頁操作就不用輸入密碼。</p>
      </form>
      <template #footer>
        <el-button :disabled="reauth.submitting" @click="closeReauth">取消</el-button>
        <el-button type="primary" data-test="reauth-submit" :loading="reauth.submitting" @click="submitReauth">確認</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.account__notice {
  margin-bottom: 16px;
}

.account__facts {
  display: grid;
  gap: 12px;
  margin: 0 0 12px;
}

.account__facts div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 12px;
}

.account__facts dt {
  color: var(--ink-3);
}

.account__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.account__name {
  display: grid;
  justify-items: start;
  gap: 4px;
}

.account__name :deep(.el-form-item) {
  width: 100%;
  max-width: 360px;
  margin-bottom: 8px;
}

.account__role-desc {
  display: block;
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
}

.account__line-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account__line {
  display: grid;
  justify-items: start;
  gap: 12px;
}

.account__line p {
  margin: 0;
}

.account__reauth {
  display: grid;
  gap: 12px;
}

.account__reauth p {
  margin: 0;
}

.account__reauth-field {
  display: grid;
  gap: 6px;
}

.account__reauth-error {
  color: var(--el-color-danger);
}
</style>
