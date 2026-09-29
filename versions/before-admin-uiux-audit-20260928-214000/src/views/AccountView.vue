<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { api, ApiError } from '../api/client'
import { startLineLink } from '../api/oauth'
import { campusLabels, roleLabel } from '../api/labels'
import type { AuthProviders } from '../api/types'
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

const result = route.query.line_link
const notice = ref<Notice | null>(
  typeof result === 'string' && Object.hasOwn(LINK_RESULTS, result) ? LINK_RESULTS[result] ?? null : null,
)

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

async function link() {
  if (linking.value) return
  linking.value = true
  notice.value = null
  try {
    // 成功會整頁前往 LINE，按鈕維持 loading 直到離開。
    await startLineLink()
  } catch (err) {
    linking.value = false
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

async function unlinkGoogle() {
  if (googleUnlinking.value) return
  googleUnlinking.value = true
  notice.value = null
  try {
    await api.delete('/auth/google/link')
    setGoogleLinked(false)
    notice.value = { type: 'success', text: '已解除 Google 綁定。之後用同一個 Email 的 Google 帳號登入時，會重新綁定。' }
  } catch {
    notice.value = { type: 'error', text: '解除綁定失敗，請稍後再試。' }
  } finally {
    googleUnlinking.value = false
  }
}

async function unlink() {
  if (unlinking.value) return
  unlinking.value = true
  notice.value = null
  try {
    await api.delete('/auth/line/link')
    setLineLinked(false)
    notice.value = { type: 'success', text: '已解除 LINE 綁定，之後無法再用這個 LINE 登入。' }
  } catch {
    notice.value = { type: 'error', text: '解除綁定失敗，請稍後再試。' }
  } finally {
    unlinking.value = false
  }
}
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="查看自己的帳號資料，並設定登入方式。" />

    <el-alert v-if="notice" :type="notice.type" :title="notice.text" :closable="false" show-icon class="account__notice" />

    <template v-if="auth.user">
      <section class="panel">
        <div class="panel__head"><h2>帳號</h2></div>
        <div class="panel__body">
          <dl class="account__facts">
            <div><dt>Email</dt><dd>{{ auth.user.email }}</dd></div>
            <div><dt>角色</dt><dd>{{ roleLabel(auth.user.role) }}</dd></div>
            <div v-if="auth.user.role !== 'super_admin'"><dt>負責校區</dt><dd>{{ campusLabels(auth.user.campus_keys) || '尚未指定' }}</dd></div>
          </dl>
          <p class="field-help">Email、角色與校區由總管理者在「使用者」設定。</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head account__line-head">
          <h2>Google 登入</h2>
          <el-tag :type="auth.user.google_linked ? 'success' : 'info'" disable-transitions>
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
              @confirm="unlinkGoogle"
            >
              <template #reference>
                <el-button type="danger" plain data-test="google-unlink" :loading="googleUnlinking">解除綁定</el-button>
              </template>
            </el-popconfirm>
            <p v-if="googleEnabled" class="field-help">Google 帳號重建過、登入時顯示「沒有權限」時，先解除綁定，再用 Google 登入一次即可。</p>
          </template>
          <el-skeleton v-else-if="!providersLoaded" animated :rows="1" />
          <p v-else-if="googleEnabled">在登入頁按「使用 Google 登入」，用和這個帳號相同 Email 的 Gmail 或 Google Workspace 帳號登入，就會自動綁定。其他 Email 的 Google 帳號無法綁定。</p>
          <p v-else>Google 登入尚未啟用。</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head account__line-head">
          <h2>LINE 登入</h2>
          <el-tag :type="auth.user.line_linked ? 'success' : 'info'" disable-transitions>
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
              @confirm="unlink"
            >
              <template #reference>
                <el-button type="danger" plain :loading="unlinking">解除綁定</el-button>
              </template>
            </el-popconfirm>
          </template>
          <el-skeleton v-else-if="!providersLoaded" animated :rows="1" />
          <template v-else-if="lineEnabled">
            <p>綁定後可以在登入頁用 LINE 直接登入，Email 與密碼仍然可以用。按下後會前往 LINE 確認身分，完成後回到這一頁。</p>
            <el-button type="primary" data-test="line-link" :loading="linking" @click="link">綁定 LINE</el-button>
          </template>
          <p v-else>LINE 登入尚未啟用，啟用後這裡會出現綁定按鈕。</p>
          <p class="field-help">後台只記錄 LINE 提供的帳號識別碼，不讀取暱稱、大頭貼或 Email。</p>
        </div>
      </section>
    </template>
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
</style>
