<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { authenticator, deletePasskey, finishRegistration, listPasskeys, PasskeyError, startRegistration } from '../api/passkey'
import type { PasskeyOut } from '../api/types'
import { notifyError } from '../composables/notify'
import { ReauthCancelled, useRememberedReauth } from '../composables/useRememberedReauth'
import { useAuthStore } from '../stores/auth'

// 「我的帳號」的指紋／臉部辨識登入（Passkey，2026-11-27）：列出登記過的裝置、登記這台、刪掉用不到的。
// 規則同 LINE／Google：只能登入後自己登記；登入超過 10 分鐘要再輸入一次密碼（後端 REAUTH_REQUIRED）。
const props = defineProps<{ enabled: boolean }>()

const auth = useAuthStore()
const passkeys = ref<PasskeyOut[]>([])
const loaded = ref(false)
const loadFailed = ref(false)
const adding = ref(false)
const removingId = ref<string | null>(null)
const supported = authenticator.supported()
const { reauth, run, submit: submitReauth, cancel: cancelReauth } = useRememberedReauth()
const reauthInput = ref<{ focus: () => void } | null>(null)
watch(() => reauth.open, async (open) => {
  if (!open) return
  await nextTick()
  reauthInput.value?.focus()
})

const dateFormat = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' })
const day = (iso: string | null | undefined) => (iso ? dateFormat.format(new Date(iso)) : '')
const rows = computed(() => passkeys.value.map(item => ({
  ...item,
  detail: [`${day(item.created_at)} 登記`, item.last_used_at ? `上次使用 ${day(item.last_used_at)}` : '還沒用過', item.backed_up ? '已同步到雲端' : ''].filter(Boolean).join('・'),
})))

function setCount(count: number) {
  if (auth.user) auth.user = { ...auth.user, passkey_count: count }
}

async function load() {
  loadFailed.value = false
  try {
    passkeys.value = await listPasskeys()
    setCount(passkeys.value.length)
  } catch {
    loadFailed.value = true
  } finally {
    loaded.value = true
  }
}
onMounted(load)

async function add() {
  if (adding.value) return
  adding.value = true
  try {
    // 只有第一步會被要求重新驗證；瀏覽器的指紋視窗在驗證通過之後才跳。
    const publicKey = await run(fields => startRegistration(fields))
    const created = await finishRegistration(publicKey)
    passkeys.value = [...passkeys.value, created]
    setCount(passkeys.value.length)
    ElMessage.success(`已登記「${created.name}」，下次可以在登入頁用指紋或臉部辨識登入`)
  } catch (err) {
    if (err instanceof ReauthCancelled) return
    if (err instanceof PasskeyError) {
      if (err.reason === 'duplicate') notifyError('這台裝置已經登記過了')
      else if (err.reason === 'unavailable') notifyError('這個瀏覽器或這台裝置不能登記，請確認裝置有設定螢幕鎖定（指紋、臉部辨識或密碼）')
      // 自己按取消或逾時：不提示。
      return
    }
    notifyError(err instanceof ApiError ? apiErrorMessage(err, '沒有登記成功，請再試一次') : '沒有登記成功，請再試一次')
  } finally {
    adding.value = false
  }
}

async function remove(item: PasskeyOut) {
  if (removingId.value) return
  removingId.value = item.id
  try {
    await run(fields => deletePasskey(item.id, fields))
    passkeys.value = passkeys.value.filter(row => row.id !== item.id)
    setCount(passkeys.value.length)
    ElMessage.success(`已刪除「${item.name}」`)
  } catch (err) {
    if (err instanceof ReauthCancelled) return
    if (err instanceof ApiError && err.status === 404) {
      await load()
      return
    }
    notifyError(err instanceof ApiError ? apiErrorMessage(err, '沒有刪除成功，請再試一次') : '沒有刪除成功，請再試一次')
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="account-passkey-title" data-test="passkey-panel">
    <div class="panel__head passkeys__head">
      <h2 id="account-passkey-title">指紋／臉部辨識登入</h2>
      <el-tag v-if="loaded && !loadFailed" :type="passkeys.length ? 'success' : 'info'" disable-transitions>
        {{ passkeys.length ? `已登記 ${passkeys.length} 台` : '尚未登記' }}
      </el-tag>
    </div>
    <div class="panel__body passkeys">
      <p>在這台手機或電腦登記之後，登入頁按一下、過指紋或臉部辨識就能進來，不用打 Email 和密碼。Email 與密碼仍然可以用。</p>
      <el-skeleton v-if="!loaded" animated :rows="1" />
      <el-alert v-else-if="loadFailed" type="error" :closable="false" show-icon title="沒有讀到登記的裝置">
        <el-button size="small" @click="load">重新載入</el-button>
      </el-alert>
      <ul v-else-if="rows.length" class="passkeys__list">
        <li v-for="item in rows" :key="item.id" data-test="passkey-row">
          <div class="passkeys__text"><strong>{{ item.name }}</strong><span class="num">{{ item.detail }}</span></div>
          <el-popconfirm
            :title="`刪除後就不能再用「${item.name}」的指紋或臉部辨識登入；用它登入的其他裝置也會被登出。`"
            confirm-button-text="刪除" cancel-button-text="先不要" confirm-button-type="danger" :width="300" @confirm="remove(item)"
          >
            <template #reference>
              <el-button type="danger" plain size="small" :loading="removingId === item.id" :aria-label="`刪除 ${item.name}`">刪除</el-button>
            </template>
          </el-popconfirm>
        </li>
      </ul>
      <template v-if="loaded && !loadFailed">
        <el-button v-if="enabled && supported" type="primary" :plain="passkeys.length > 0" :loading="adding" data-test="passkey-add" @click="add">
          {{ passkeys.length ? '再登記這台裝置' : '登記這台裝置' }}
        </el-button>
        <p v-else-if="!enabled" data-test="passkey-disabled">這個網址目前不能登記。</p>
        <p v-else data-test="passkey-unsupported">這個瀏覽器不支援，請改用 Safari、Chrome 或 Edge 的新版本（LINE 內建的瀏覽器不行）。</p>
      </template>
      <p class="field-help">指紋與臉部資料只留在你的裝置上，後台只存一把對應的公開金鑰。每台裝置各登記一次；換手機後請刪掉舊的。</p>
    </div>

    <el-dialog
      v-model="reauth.open" title="確認是你本人" width="min(420px, 100%)" append-to-body
      :show-close="!reauth.submitting" :close-on-click-modal="false" :close-on-press-escape="!reauth.submitting" :before-close="cancelReauth"
    >
      <form class="passkeys__reauth" data-test="passkey-reauth-form" @submit.prevent="submitReauth">
        <p>{{ reauth.message }}</p>
        <label class="passkeys__reauth-field">
          <span>目前的密碼</span>
          <el-input ref="reauthInput" v-model="reauth.password" type="password" show-password autocomplete="current-password" :disabled="reauth.submitting" />
        </label>
        <p v-if="reauth.error" class="passkeys__reauth-error" role="alert">{{ reauth.error }}</p>
      </form>
      <template #footer>
        <el-button :disabled="reauth.submitting" @click="cancelReauth">取消</el-button>
        <el-button type="primary" :loading="reauth.submitting" @click="submitReauth">確認</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.passkeys__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.passkeys { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.passkeys p { margin: 0; }
.passkeys__list { align-self: stretch; margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: var(--radius); }
.passkeys__list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; }
.passkeys__list li + li { border-top: 1px solid var(--line); }
.passkeys__text { display: flex; flex-direction: column; min-width: 0; }
.passkeys__text span { color: var(--ink-2); font-size: var(--text-sm); }
.passkeys__reauth p { margin: 0 0 12px; }
.passkeys__reauth-field { display: flex; flex-direction: column; gap: 6px; }
.passkeys__reauth-error { margin-top: 8px !important; color: var(--el-color-danger); }
</style>
